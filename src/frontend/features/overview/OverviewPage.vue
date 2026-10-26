<script setup lang="ts">
import {computed, onBeforeUnmount, ref, watch} from 'vue';
import {RouterLink, useRoute, useRouter} from 'vue-router';
import type {LocationQuery} from 'vue-router';
import {useFrontend} from '../../app/context';
import {usePageTitle} from '../../composables/pageTitle';
import {isOrdinaryNavigation, navigatePageEntry} from '../../composables/pageEntry';
import type {components} from '../../../types/api/v1';
import type {FrontendOverviewCountRead, FrontendRequestScope} from '../../../types/FrontendUiTypes';
import {overviewKeys} from '../../app/queryKeys';
import {overviewQueryParameters} from './api';
import {frontendOverviewPath, frontendOverviewPageEntry} from '../../../common/lib/frontendIdentity';
import OverviewRegion from './OverviewRegion.vue';
import AppAccordionButton from '../../components/AppAccordionButton.vue';
import RefreshButton from '../../components/RefreshButton.vue';
const context = useFrontend();
const {messages} = context;
const route = useRoute();
const router = useRouter();
const entry = computed(() => {
    const session = context.session.value;
    return session ? frontendOverviewPageEntry(session,
        typeof route.query.next === 'string' ? route.query.next : route.fullPath) : null;
});
watch(entry, followAdmission, {immediate: true});

/** Warm navigation uses the same admitted identity and Login/notice delivery as
 * the document route. No collection mounts or sends a private read beforehand. */
async function followAdmission(outcome: components['schemas']['PageEntryOutcome'] | null): Promise<void> {
    // A leaving component can observe the destination's route before unmount.
    // Never reinterpret that later visit as another Dashboard return URL.
    if (context.browser && outcome?.kind === 'redirect'
        && route.matched.some(record => record.path === frontendOverviewPath)) await navigatePageEntry(context, router, outcome);
}
usePageTitle(() => messages.value.t('overview.documentTitle'), true);
const hidden = ref<Record<string, boolean>>({});
const open = ref<Record<string, boolean>>({participant: true, owner: true});
type Region = components['schemas']['OverviewRegion'];
// Retain only admission receipts. Numeric membership remains owned by QueryClient,
// so denial/eviction cannot leave a second server snapshot alive in the parent.
const countSources = ref<Partial<Record<Region['collection'], Partial<Record<Region['region'], FrontendOverviewCountRead>>>>>({});
const cacheRevision = ref(0);
const stopCountCache = context.queryClient.getQueryCache().subscribe(refreshCountCache);
onBeforeUnmount(stopCountCache);
seedInitialCounts();
const counts = computed(collectionCounts);
watch([context.epoch, context.locale], retireCountSources, {flush: 'sync'});

function refreshCountCache(): void {
    cacheRevision.value++;
}

/** Seed only this validated initial document before SSR renders collection badges.
 * Cache owns its DTOs; receipts reference the same keys later used by region observers.
 * A later SPA visit cannot reuse this bootstrap after its document/actor retires. */
function seedInitialCounts(): void {
    const initial = context.initialDocumentFor(route.fullPath);
    if (!initial || initial.session.locale !== context.locale.value) return;

    // Sharing URL decoding prevents a second SSR-only key shape or numeric count store.
    const scope = context.capture();
    for (const projection of initial.overview ?? []) {
        const parameters = overviewQueryParameters(route.query, projection.collection, projection.region);
        const key = overviewKeys.region(scope.context, scope.locale, parameters);
        context.queryClient.setQueryData(key, projection);
        const updatedAt = context.queryClient.getQueryState(key)!.dataUpdatedAt;
        updateCounts(projection.collection, projection.region, {scope, key, updatedAt}, scope);
    }
}

/** Derive each collection from its newest still-admitted region receipt. Temporary
 * errors retain readable cached data; denial or eviction removes that source. An
 * independently admitted sibling remains usable, while missing authority stays unknown. */
function collectionCounts(): Partial<Record<Region['collection'], {total: number; hidden: number}>> {
    // Cache notifications make the otherwise nonreactive QueryClient lookup observable.
    cacheRevision.value;
    const result: Partial<Record<Region['collection'], {total: number; hidden: number}>> = {};
    for (const collection of ['participant', 'owner'] as const) {
        let newest: FrontendOverviewCountRead | undefined;
        let projection: Region | undefined;
        for (const source of Object.values(countSources.value[collection] ?? {})) {
            if (!context.isCurrent(source.scope, true) || newest && newest.updatedAt > source.updatedAt) continue;
            const cached = context.queryClient.getQueryData<Region>(source.key);
            if (!cached || cached.collection !== collection) continue;
            newest = source;
            projection = cached;
        }
        if (projection) result[collection] = {total: projection.totalEntities, hidden: projection.hiddenEntities};
    }
    return result;
}

/** Actor/language replacement retires presentation references as well as their queries. */
function retireCountSources(): void {
    countSources.value = {};
}
watch(() => route.query, receiveHiddenNavigation, {immediate: true});

/** Saved hidden-region links admit disclosure independently of main-region counts. */
function receiveHiddenNavigation(query: LocationQuery): void {
    // Each collection owns its own URL fields; a selected hidden event opens its region.
    for (const collection of ['participant', 'owner']) {
        hidden.value[collection] = query[collection + '_hidden_open'] === '1'
            || typeof query[collection + '_hidden_event'] === 'string';
    }
}

/** Accept only the current region's admitted read or denial. A late old actor/locale
 * cannot remove a new receipt, and retiring one region preserves sibling authority. */
function updateCounts(collection: Region['collection'], region: Region['region'],
                      source: FrontendOverviewCountRead | null, scope: FrontendRequestScope): void {
    if (!context.isCurrent(scope, true)) return;
    // Store a reference to source authority, never the server's numeric membership.
    const sources = countSources.value[collection] ?? {};
    if (source) sources[region] = source;
    else delete sources[region];
    countSources.value[collection] = sources;
}
/** A disclosed region has an ordinary saved URL as well as an enhanced current-tab action. */
async function toggleHidden(event: MouseEvent, collection: string): Promise<void> {
    if (!isOrdinaryNavigation(event)) return;
    event.preventDefault();
    await router.push({query: hiddenQuery(collection)});
}

/** Saved hrefs and enhanced toggles share the hidden-region reset. Filters remain
 * usable on reopening, while the selected parent and its obsolete child pager are discarded. */
function hiddenQuery(collection: string) {
    const query = {...route.query};
    const prefix = collection + '_hidden_';
    if (hidden.value[collection]) {
        delete query[prefix + 'open'];
        delete query[prefix + 'event'];
        delete query[prefix + 'childPage'];
    } else query[prefix + 'open'] = '1';
    return query;
}
function hiddenHref(collection: string): string {
    return router.resolve({path: frontendOverviewPath, query: hiddenQuery(collection)}).href;
}
</script>
<template>
    <section v-if="entry?.kind === 'render'" class="card bg-dark text-white mb-3">
        <!-- The greeting belongs inside this italic wrapper. Its
             trailing margin belongs after the greeting, rather than between icon/text. -->
        <h1 class="card-header text-center">
            <i class="bi bi-house-door-fill me-2">{{
                messages.t('overview.title', {name: context.session.value?.activeProfile?.name ?? ''})
            }}</i>
        </h1>
        <div class="card-body">
            <p v-if="!context.session.value?.activeProfile" class="text-center">
                <RouterLink class="btn btn-primary" to="/users/login">{{
                    messages.t('app.login')
                }}</RouterLink
                ><RouterLink class="btn btn-outline-light ms-2" to="/users/register">{{
                    messages.t('app.register')
                }}</RouterLink>
            </p>
            <template v-else>
                <section
                    v-for="collection in ['participant', 'owner'] as const"
                    :key="collection"
                >
                    <!-- The shared accordion owns the collection spacing; adding
                         another section margin would change the dashboard layout rhythm. -->
                    <h2 class="text-center">
                        <i
                            class="bi me-2"
                            :class="collection === 'participant' ? 'bi-clipboard-check' : 'bi-shield-check'"
                            aria-hidden="true"
                        ></i
                        >{{
                            messages.t(
                                collection === 'participant' ? 'overview.participation' : 'overview.managed',
                            )
                        }}
                    </h2>
                    <p class="text-center">
                        {{
                            messages.t(
                                collection === 'participant'
                                    ? 'overview.participationHint'
                                    : 'overview.managedHint',
                            )
                        }}
                    </p>
                    <hr />
                    <div class="accordion accordion-dark">
                        <div class="accordion-item entity-overview overflow-visible">
                            <OverviewRegion
                                :collection="collection"
                                region="main"
                                :active="open[collection]"
                                :collapse-id="'overview-' + collection"
                                @counts="(source, scope) => updateCounts(collection, 'main', source, scope)"
                            >
                                <template #header="{refreshAction, refresh}">
                                    <h2 class="accordion-header frontend-accordion-heading d-flex align-items-center">
                                        <AppAccordionButton
                                            :expanded="open[collection]"
                                            :controls="'overview-' + collection"
                                            @click="open[collection] = !open[collection]"
                                        >
                                            <i
                                                class="bi me-2"
                                                :class="
                                                    collection === 'participant'
                                                        ? 'bi-clipboard-check'
                                                        : 'bi-shield-check'
                                                "
                                                aria-hidden="true"
                                            ></i>
                                            {{
                                                messages.t(
                                                    collection === 'participant'
                                                        ? 'overview.participation'
                                                        : 'overview.managed',
                                                )
                                            }}
                                            <span v-if="counts[collection]" class="badge bg-secondary ms-2">{{
                                                counts[collection].total
                                            }}</span>
                                            <!-- Unknown counts are not empty membership. The region announces
                                                 loading; keep this inline placeholder free of another live status. -->
                                            <span v-else class="badge bg-secondary ms-2" aria-hidden="true">…</span>
                                        </AppAccordionButton>
                                        <RefreshButton class="mx-2" :state="refreshAction" @refresh="refresh" />
                                    </h2>
                                </template>
                                <template #default>
                                    <!-- An explicitly opened hidden region may start before main-region
                                         counts arrive. Confirmed membership retains the empty rule. -->
                                    <div v-if="counts[collection]?.total || (!counts[collection] && hidden[collection])" class="mt-4">
                                        <h3 class="h5">
                                            <a
                                                class="btn btn-outline-secondary"
                                                :aria-expanded="!!hidden[collection]"
                                                :aria-controls="'overview-' + collection + '-hidden'"
                                                :href="hiddenHref(collection)"
                                                @click="toggleHidden($event, collection)"
                                            >
                                                <i class="bi bi-archive me-2" aria-hidden="true"></i
                                                >{{ messages.t('overview.hidden') }}
                                                <span v-if="counts[collection]" class="badge bg-secondary ms-2">{{
                                                    counts[collection].hidden
                                                }}</span>
                                                <span v-else class="badge bg-secondary ms-2" aria-hidden="true">…</span>
                                            </a>
                                        </h3>
                                        <div
                                            v-if="hidden[collection]"
                                            :id="'overview-' + collection + '-hidden'"
                                        >
                                            <p class="small text-body-secondary">
                                                {{ messages.t('overview.hiddenHint') }}
                                            </p>
                                            <OverviewRegion
                                                :collection="collection"
                                                region="hidden"
                                                :active="open[collection]"
                                                @counts="
                                                    (source, scope) =>
                                                        updateCounts(collection, 'hidden', source, scope)
                                                "
                                            />
                                        </div>
                                    </div>
                                </template>
                            </OverviewRegion>
                        </div>
                    </div>
                </section>
            </template>
        </div>
    </section>
</template>
