<script setup lang="ts">
import {parameterFieldAttributes} from '../../../../.generated/api/v1/policy.mjs';
import {computed, inject, onBeforeUnmount, ref, watch} from 'vue';
import {RouterLink, useRoute, useRouter} from 'vue-router';
import {useQuery} from '@tanstack/vue-query';
import {useActionState, useFrontend} from '../../app/context';
import {useHelpApi} from './api';
import {usePageTitle} from '../../composables/pageTitle';
import {isOrdinaryNavigation} from '../../composables/pageEntry';
import {pageReadinessKey} from '../../composables/pageNavigation';
import {useReadRetry, useReadRetryAt} from '../../composables/feedback';
import {helpKeys} from '../../app/queryKeys';
import {useQueryAdmission} from '../../app/queryCache';
import {ApiFailure} from '../../app/transport';
import {frontendHelpUrl, resolveFrontendHelpQuery} from '../../../common/lib/helpNavigation';
import {createTranslator} from '../../../common/localization/translator';
import PageMessage from '../../components/PageMessage.vue';
import StatusNotice from '../../components/StatusNotice.vue';
import LoadingSkeleton from '../../components/LoadingSkeleton.vue';
import RefreshButton from '../../components/RefreshButton.vue';

const context = useFrontend();
const api = useHelpApi(context);
const {messages, locale} = context;
const englishMessages = createTranslator('en');
const route = useRoute();
const router = useRouter();
// Explicit path aliases and ordinary frontend query links share the SSR resolver.
// Ignored parameters must never become a different article/search after hydration.
const query = computed(() => resolveFrontendHelpQuery(route.params.doc, route.query));
const search = ref(query.value.q ?? '');
watch(() => query.value.q, value => { search.value = value ?? ''; });
const key = computed(() => helpKeys.page(context.session.value?.context, locale.value, query.value));
const readAdmission = useQueryAdmission(context, key, computed(() => context.hydrated.value));
const help = useQuery({
    queryKey: key,
    queryFn: ({signal}) => api.help(query.value, context.capture(), signal),
    initialData: () => context.initialDocumentFor(route.fullPath)?.help?.locale === locale.value
        ? context.initialDocumentFor(route.fullPath)?.help : undefined,
    staleTime: Infinity,
    ...readAdmission,
});
// A language switch must never display an old translated body under the new interface language.
const page = computed(() => help.data.value?.locale === locale.value ? help.data.value : undefined);
// Source language is independent of the selected interface. Fallback is already
// decided by the trusted renderer, so SSR, hydration and no-JavaScript reads agree.
const contentLocale = computed(() => page.value?.contentLocale ?? locale.value);
function isEnglishFallback(sourceLocale?: string): boolean {
    return locale.value !== 'en' && sourceLocale === 'en';
}
/** Keep a result's section sentence in its actual source language so its lang
 * attribute describes both the introductory words and the authored heading. */
function sectionDescription(title: string, sourceLocale?: string): string {
    const translator = isEnglishFallback(sourceLocale) ? englishMessages : messages.value;
    return translator.t('help.inSection', {title});
}
// A validated missing-document rejection owns the complete Error page. An
// unconfirmed transport/read failure instead retains the warning and confirmed article.
const notFound = computed(() => help.error.value instanceof ApiFailure && help.error.value.problem?.code === 'NOT_FOUND');
// Skeletons describe missing authority only. Complete SSR/cached articles remain mounted
// during reads, and a terminal read error must never be accompanied by indefinite loading.
const initialLoading = computed(() => !page.value && help.isPending.value && !help.error.value);
const pageTitle = computed(() => {
    if (notFound.value) return messages.value.t('common.errorTitle');
    return page.value?.searchResults !== undefined ? messages.value.t('help.searchTitle')
        : page.value?.title ?? messages.value.t('help.title');
});
const retryAvailable = useReadRetry(() => help.error.value);
const retryAt = useReadRetryAt(() => help.error.value, retryAvailable);
usePageTitle(pageTitle);

/** Only release-shipped help links become SPA destinations. Files and external links retain document navigation. */
function helpRoute(href: string): string {
    return frontendHelpUrl(href, locale.value);
}

// Rewrite only already validated, fixed-source anchors. SSR and enhanced navigation share the same
// destinations; no DOM parser, arbitrary HTML execution or browser-only globals are needed here.
const content = computed(() => (page.value?.content ?? '').replace(/href="(\/help(?:[/?][^"]*)?)"/gu,
    (_match, href: string) => `href="${helpRoute(href.replaceAll('&amp;', '&')).replaceAll('&', '&amp;')}"`));
function submitSearch(): void {
    void router.push({path: '/help', query: {
        q: search.value, locale: locale.value,
    }});
}
/** Static help does not poll. Deliberate Refresh and failed-read recovery use
 * the same server cooldown and current article/locale key.
 * Refetch retains the mounted search draft and never navigates or replays a command. */
const retryAction = useActionState({eligible: () => context.mayRead() && retryAvailable.value,
    pending: () => help.isFetching.value});

async function retryHelp(): Promise<void> {
    if (!retryAction.isAvailable()) return;
    await help.refetch();
}
/** Enhance ordinary reviewed article links only. Modified clicks and packaged
 * image/full-size links keep their href, while article navigation retains
 * the selected interface locale through the shared Help URL adapter. */
function followContentLink(event: MouseEvent): void {
    const anchor = (event.target as Element | null)?.closest('a');
    if (!anchor || !isOrdinaryNavigation(event, anchor)) return;
    const href = anchor.getAttribute('href') ?? '';
    const target = helpRoute(href);
    // Help assets share the route namespace but remain separate files.
    // Do not route a full-size image link into the article component.
    if (!target.startsWith('/help') || target.startsWith('/help/assets/')) return;
    event.preventDefault();
    void router.push(target);
}

// The locale query and ignored parameters do not identify another article
// visit. Only the resolved article/search, actual path and requested fragment do.
const anchorVisit = computed(() => JSON.stringify([route.path, query.value, route.hash]));
// Router alone owns anchors and browser restoration. A late read signals its
// rendered readiness instead of replaying the fragment over a saved position.
const pageReadiness = inject(pageReadinessKey, undefined);
const releaseReadiness = pageReadiness?.register({destination: computed(() => route.fullPath),
    ready: computed(() => !!page.value || !!help.error.value)});
onBeforeUnmount(() => releaseReadiness?.());

const articleRegion = ref<HTMLElement | null>(null);
const retainedReadingHeight = ref<number>();
let readableVisit: string | undefined;
watch(() => [page.value, anchorVisit.value, help.error.value], retainReadingSpace, {immediate: true});

/** Reserve only the last readable visit's space while its translation loads.
 * Hiding old-language content must not shorten the document and clamp the
 * browser's scroll position. This measures presentation only, with no saved
 * scroll, copied article data or request state; new visits and terminal reads
 * release it. The pre-render watcher measures the still-mounted old content. */
function retainReadingSpace(): void {
    if (page.value) {
        readableVisit = anchorVisit.value;
        retainedReadingHeight.value = undefined;
        return;
    }
    // A different article/search owns fresh navigation. Failed reads also release
    // the temporary placeholder rather than leaving a large empty document.
    if (readableVisit !== anchorVisit.value || help.error.value) {
        retainedReadingHeight.value = undefined;
        return;
    }
    if (retainedReadingHeight.value === undefined && articleRegion.value) {
        retainedReadingHeight.value = articleRegion.value.getBoundingClientRect().height;
    }
}

</script>

<template>
    <!-- A missing document keeps its explanation while explicit read recovery
         is offered. Its action shares the responsive notice layout and lifetime. -->
    <PageMessage v-if="notFound" kind="error" renewal="help.notFound" :message="messages.t('help.notFound')"
        :transient="false" :action="{state: retryAction, label: messages.t('common.retry')}" @action="retryHelp" />
    <section v-else ref="articleRegion" class="card bg-dark text-white mb-3"
        :style="{minHeight: retainedReadingHeight === undefined ? undefined : `${retainedReadingHeight}px`}">
        <div class="card-header d-flex justify-content-between align-items-center gap-2">
            <h1 class="card-title mb-0" :lang="contentLocale"><i class="bi bi-question-circle me-2" aria-hidden="true"></i>{{ pageTitle }}</h1>
            <div class="frontend-action-row">
                <RouterLink :to="helpRoute('/help')" class="btn btn-sm btn-outline-light">
                    <i class="bi bi-house me-1" aria-hidden="true"></i>{{ messages.t('help.home') }}
                </RouterLink>
                <RefreshButton v-if="page" :state="retryAction" @refresh="retryHelp" />
            </div>
        </div>
        <div class="card-body">
            <StatusNotice v-if="page?.fallbackToEnglish" class="help-language-fallback">{{
                messages.t('help.englishFallbackNotice')
            }}</StatusNotice>
            <div class="row g-3">
                <aside class="col-lg-3">
                    <section class="card bg-dark text-white mb-3">
                        <div class="card-header"><h2 class="h5 mb-0"><i class="bi bi-search me-2" aria-hidden="true"></i>{{ messages.t('help.searchTitle') }}</h2></div>
                        <div class="card-body">
                            <form action="/help" method="get" role="search" @submit.prevent="submitSearch">
                                <label class="form-label visually-hidden" for="frontend-help-search">{{ messages.t('help.searchLabel') }}</label>
                                <input type="hidden" name="locale" :value="locale" />
                                <div class="input-group">
                                    <input id="frontend-help-search" v-model="search" class="form-control text-bg-dark" type="search" name="q"
                                           :maxlength="parameterFieldAttributes.getHelpPage.query.q.maxLength" required :placeholder="messages.t('help.searchPlaceholder')" />
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
                                                :aria-current="page.currentDoc === doc.path ? 'page' : undefined">
                                        <span :lang="doc.contentLocale ?? locale">{{ doc.title }}</span>
                                        <!-- Keep a real text separator: Vue can remove template whitespace
                                             between these language segments during compilation. -->
                                        <span v-if="isEnglishFallback(doc.contentLocale)" class="small ms-1">{{ ' ' }}({{ messages.t('help.englishFallbackLabel') }})</span>
                                    </RouterLink>
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
                </aside>
                <!-- Initial skeleton status stays outside a busy subtree so its announcement
                     is delivered while loading. Confirmed content may be busy during refresh. -->
                <div class="col-lg-9" :aria-busy="!!page && help.isFetching.value">
                    <StatusNotice v-if="help.error.value" kind="danger"
                        :read-error="help.error.value" :retry-at="retryAt"
                        :last-updated-at="page ? help.dataUpdatedAt.value : undefined"
                        :action="{state: retryAction, label: messages.t('common.retry')}" @action="retryHelp">{{
                        messages.t(page ? 'state.stale' : 'state.loadFailed')
                    }}</StatusNotice>
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
                                            <h3 class="h5 mb-1">
                                                <span :lang="result.contentLocale ?? locale">{{ result.title }}</span>
                                                <span v-if="isEnglishFallback(result.contentLocale)" class="small ms-1">{{ ' ' }}({{ messages.t('help.englishFallbackLabel') }})</span>
                                            </h3>
                                            <i class="bi bi-chevron-right" aria-hidden="true"></i>
                                        </div>
                                        <p v-if="result.sectionTitle" class="small text-info mb-1" :lang="result.contentLocale ?? locale">{{ sectionDescription(result.sectionTitle, result.contentLocale) }}</p>
                                        <p class="mb-0" :lang="result.contentLocale ?? locale">{{ result.excerpt }}</p>
                                    </RouterLink>
                                </div>
                            </template>
                        </div>
                    </div>
                    <div v-else-if="page" class="row g-3">
                        <article :lang="contentLocale" :class="page.toc.length ? 'col-xl-9' : 'col-12'">
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
                                       :lang="contentLocale" :class="{'help-toc-level-3': entry.level === 3}">{{ entry.title }}</a>
                                </div>
                            </nav>
                        </aside>
                    </div>
                </div>
            </div>
        </div>
    </section>
</template>
