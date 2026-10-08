<script setup lang="ts">
import {computed, nextTick, ref, watch} from 'vue';
import {RouterLink, useRoute, useRouter} from 'vue-router';
import {useQuery} from '@tanstack/vue-query';
import {usePilot} from '../../app/context';
import {useHelpApi} from './api';
import {usePageTitle} from '../../composables/pageTitle';
import {helpKeys} from '../../app/queryKeys';
import StatusNotice from '../../components/StatusNotice.vue';
import LoadingSkeleton from '../../components/LoadingSkeleton.vue';

const context = usePilot();
const api = useHelpApi(context);
const {messages, locale} = context;
const route = useRoute();
const router = useRouter();
const query = computed(() => ({
    // Native help normalizes before searching. Match that behavior for an enhanced deep link too.
    ...(typeof route.query.q === 'string' ? {q: route.query.q.trim().replace(/\s+/gu, ' ').slice(0, 100)} : {}),
    ...(typeof route.query.doc === 'string' ? {doc: route.query.doc}
        : typeof route.params.doc === 'string' ? {doc: route.params.doc} : {}),
}));
const search = ref(query.value.q ?? '');
watch(() => query.value.q, value => { search.value = value ?? ''; });
const help = useQuery({
    queryKey: computed(() => helpKeys.page(context.session.value?.context, locale.value, query.value)),
    queryFn: ({signal}) => api.help(query.value, context.capture(), signal),
    initialData: () => context.initialDocumentFor(route.fullPath)?.help?.locale === locale.value
        ? context.initialDocumentFor(route.fullPath)?.help : undefined,
    staleTime: Infinity,
    enabled: computed(() => context.hydrated.value && context.ready.value),
});
// A language switch must never display an old translated body under the new interface language.
const page = computed(() => help.data.value?.locale === locale.value ? help.data.value : undefined);
// Skeletons describe missing authority only. Complete SSR/cached articles remain mounted
// during reads, and a terminal read error must never be accompanied by indefinite loading.
const initialLoading = computed(() => !page.value && help.isPending.value && !help.error.value);
const listId = computed(() => typeof route.query.list === 'string' ? route.query.list.toLowerCase() : null);
const pageTitle = computed(() => page.value?.searchResults !== undefined ? messages.value.t('help.searchTitle')
    : page.value?.title ?? messages.value.t('help.title'));
usePageTitle(pageTitle);

/** Only release-shipped help links become SPA destinations. Files and external links stay native. */
function helpRoute(href: string): string {
    if (!href.startsWith('/help')) return href;
    const source = new URL(href, 'https://help.invalid');
    const match = /^\/help(?:\/([a-z0-9_-]+))?$/iu.exec(source.pathname);
    if (!match || match[1] === 'assets') return href;
    const params = new URLSearchParams();
    if (match[1]) params.set('doc', match[1]);
    if (listId.value) params.set('list', listId.value);
    params.set('locale', locale.value);
    return `/frontend-pilot/help?${params.toString()}${source.hash}`;
}

// Rewrite only already validated, fixed-source anchors. SSR and enhanced navigation share the same
// destinations; no DOM parser, arbitrary HTML execution or browser-only globals are needed here.
const content = computed(() => (page.value?.content ?? '').replace(/href="(\/help(?:[/?][^"]*)?)"/gu,
    (_match, href: string) => `href="${helpRoute(href.replaceAll('&amp;', '&')).replaceAll('&', '&amp;')}"`));
function submitSearch(): void {
    void router.push({path: '/frontend-pilot/help', query: {
        q: search.value, locale: locale.value, ...(listId.value ? {list: listId.value} : {}),
    }});
}
function followContentLink(event: MouseEvent): void {
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const anchor = (event.target as Element | null)?.closest('a');
    if (!anchor || anchor.target || anchor.hasAttribute('download')) return;
    const href = anchor.getAttribute('href') ?? '';
    const target = helpRoute(href);
    if (!target.startsWith('/frontend-pilot/help')) return;
    event.preventDefault();
    void router.push(target);
}
watch(() => [pageTitle.value, route.hash], async () => {
    if (!context.browser) return;
    await nextTick();
    if (route.hash) {
        try { document.getElementById(decodeURIComponent(route.hash.slice(1)))?.scrollIntoView(); }
        catch { /* An invalid fragment must not interrupt otherwise readable help. */ }
    }
}, {immediate: true});
</script>

<template>
    <section class="card bg-dark text-white mb-3">
        <div class="card-header d-flex justify-content-between align-items-center gap-2">
            <h1 class="card-title mb-0"><i class="bi bi-question-circle me-2" aria-hidden="true"></i>{{ pageTitle }}</h1>
            <RouterLink :to="helpRoute('/help')" class="btn btn-sm btn-outline-light">
                <i class="bi bi-house me-1" aria-hidden="true"></i>{{ messages.t('help.home') }}
            </RouterLink>
        </div>
        <div class="card-body">
            <div class="row g-3">
                <aside class="col-lg-3">
                    <section class="card bg-dark text-white mb-3">
                        <div class="card-header"><h2 class="h5 mb-0"><i class="bi bi-search me-2" aria-hidden="true"></i>{{ messages.t('help.searchTitle') }}</h2></div>
                        <div class="card-body">
                            <form action="/frontend-pilot/help" method="get" role="search" @submit.prevent="submitSearch">
                                <label class="form-label visually-hidden" for="pilot-help-search">{{ messages.t('help.searchLabel') }}</label>
                                <input type="hidden" name="locale" :value="locale" />
                                <input v-if="listId" type="hidden" name="list" :value="listId" />
                                <div class="input-group">
                                    <input id="pilot-help-search" v-model="search" class="form-control text-bg-dark" type="search" name="q"
                                           maxlength="100" required :placeholder="messages.t('help.searchPlaceholder')" />
                                    <button class="btn btn-primary" type="submit" :aria-label="messages.t('help.searchTitle')"><i class="bi bi-search" aria-hidden="true"></i></button>
                                </div>
                            </form>
                        </div>
                    </section>
                    <nav v-if="page" class="card bg-dark text-white" :aria-label="messages.t('help.topics')">
                        <div class="card-header"><h2 class="h5 mb-0"><i class="bi bi-list-check me-2" aria-hidden="true"></i>{{ messages.t('help.topics') }}</h2></div>
                        <div class="card-body p-0">
                            <div v-for="group in page.docsGroups" :key="group.title" class="help-nav-group">
                                <h3 class="help-nav-heading">{{ group.title }}</h3>
                                <div class="list-group list-group-flush">
                                    <RouterLink v-for="doc in group.docs" :key="doc.path" :to="helpRoute(doc.url)"
                                                class="list-group-item list-group-item-action"
                                                :class="page.currentDoc === doc.path ? 'active bg-primary' : 'bg-dark text-white border-secondary'"
                                                :aria-current="page.currentDoc === doc.path ? 'page' : undefined">{{ doc.title }}</RouterLink>
                                </div>
                            </div>
                        </div>
                    </nav>
                    <!-- The article owns the accessible loading announcement. This companion
                         shape reserves the topic column without duplicating its live status. -->
                    <section v-else-if="initialLoading" class="card bg-dark text-white" aria-hidden="true">
                        <div class="card-header"><h2 class="h5 mb-0">{{ messages.t('help.topics') }}</h2></div>
                        <div class="card-body"><LoadingSkeleton :rows="6" /></div>
                    </section>
                    <RouterLink v-if="listId" :to="`/frontend-pilot/packing/${listId}`" class="d-inline-block mt-3">
                        <i class="bi bi-arrow-left me-1" aria-hidden="true"></i>{{ messages.t('app.returnToPacking') }}
                    </RouterLink>
                </aside>
                <!-- Initial skeleton status stays outside a busy subtree so its announcement
                     is delivered while loading. Confirmed content may be busy during refresh. -->
                <div class="col-lg-9" :aria-busy="!!page && help.isFetching.value">
                    <StatusNotice v-if="help.error.value" kind="danger">{{ messages.t('state.loadFailed') }}</StatusNotice>
                    <LoadingSkeleton v-if="initialLoading" variant="article" />
                    <div v-else-if="page && page.searchResults !== undefined" class="card bg-dark text-white">
                        <div class="card-body help-search-results">
                            <h2>{{ messages.t('help.searchResults') }}</h2>
                            <p v-if="!page.searchQuery" class="mb-0">{{ messages.t('help.searchPrompt') }}</p>
                            <StatusNotice v-else-if="!page.searchResults.length" no-margin>{{ messages.t('help.noMatches', {query: page.searchQuery}) }}</StatusNotice>
                            <template v-else>
                                <p class="text-secondary" role="status">{{ messages.t('help.matchedCount', {count: page.searchResults.length, query: page.searchQuery ?? ''}) }}</p>
                                <div class="list-group">
                                    <RouterLink v-for="result in page.searchResults" :key="result.url" :to="helpRoute(result.url)"
                                                class="list-group-item list-group-item-action bg-dark text-white border-secondary">
                                        <div class="d-flex justify-content-between align-items-start gap-2">
                                            <h3 class="h5 mb-1">{{ result.title }}</h3><i class="bi bi-chevron-right" aria-hidden="true"></i>
                                        </div>
                                        <p v-if="result.sectionTitle" class="small text-info mb-1">{{ messages.t('help.inSection', {title: result.sectionTitle}) }}</p>
                                        <p class="mb-0">{{ result.excerpt }}</p>
                                    </RouterLink>
                                </div>
                            </template>
                        </div>
                    </div>
                    <div v-else-if="page" class="row g-3">
                        <article :class="page.toc.length ? 'col-xl-9' : 'col-12'">
                            <div class="card bg-dark text-white">
                                <!-- This HTML is the existing server's validated, release-shipped Markdown. -->
                                <div class="card-body help-content" @click="followContentLink" v-html="content"></div>
                            </div>
                        </article>
                        <aside v-if="page.toc.length" class="col-xl-3">
                            <nav class="card bg-dark text-white help-toc" :aria-label="messages.t('help.onPage')">
                                <div class="card-header"><h2 class="h6 mb-0">{{ messages.t('help.onPage') }}</h2></div>
                                <div class="list-group list-group-flush">
                                    <a v-for="entry in page.toc" :key="entry.id" :href="`#${entry.id}`"
                                       class="list-group-item list-group-item-action bg-dark text-white border-secondary"
                                       :class="{'help-toc-level-3': entry.level === 3}">{{ entry.title }}</a>
                                </div>
                            </nav>
                        </aside>
                    </div>
                </div>
            </div>
        </div>
    </section>
</template>
