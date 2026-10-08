<script setup lang="ts">
import {computed, onBeforeUnmount, ref, watch} from 'vue';
import {useRoute, useRouter} from 'vue-router';
import type {RouteLocationNormalized} from 'vue-router';
import {useQuery} from '@tanstack/vue-query';
import type {components, paths} from '../../../types/api/v1';
import {useOverviewApi} from './api';
import {usePackingApi} from '../packing/api';
import {usePilot, refreshInterval} from '../../app/context';
import {useCommand} from '../../composables/command';
import {useDebouncedValue} from '../../composables/debounced';
import {ObsoleteRequestError} from '../../app/transport';
import {overviewKeys} from '../../app/queryKeys';
import ActionButton from '../../components/ActionButton.vue';
import StatusNotice from '../../components/StatusNotice.vue';
import LoadingSkeleton from '../../components/LoadingSkeleton.vue';
import OverviewCard from './OverviewCard.vue';
import OverviewItems from './OverviewItems.vue';

const props = withDefaults(defineProps<{
    collection: components['schemas']['OverviewRegion']['collection'];
    region: components['schemas']['OverviewRegion']['region'];
    active?: boolean;
}>(), {active: true});
const emit = defineEmits<{counts: [total: number, hidden: number]}>();
const context = usePilot();
const api = useOverviewApi(context);
const packingApi = usePackingApi(context);
const {messages} = context;
const jitter = context.browser ? Math.round(Math.random() * 3000) : 0;
const route = useRoute();
const router = useRouter();
// TODO (docs/FRONTEND_PILOT.md): Complete the remaining Overview migration before its
// default-route cutover; non-packing administration stays with its native feature owner meanwhile.
let pendingNavigation: RouteLocationNormalized | undefined;
let readGeneration = 0;
const searchPending = ref(false);
const removeNavigationStart = router.beforeEach(rememberNavigation);
const removeNavigationFinish = router.afterEach(finishNavigation);
const removeNavigationError = router.onError((_error, to) => finishNavigation(to));
onBeforeUnmount(() => {
    readGeneration++;
    removeNavigationStart();
    removeNavigationFinish();
    removeNavigationError();
});
const title = computed(() =>
    messages.value.t(props.collection === 'participant' ? 'overview.participation' : 'overview.managed'),
);
const prefix = computed(() => props.collection + '_' + props.region + '_');
type Query = NonNullable<paths['/overview']['get']['parameters']['query']>;
function parameter(name: string): string | undefined {
    const value = route.query[prefix.value + name];
    return typeof value === 'string' ? value : undefined;
}
const query = computed<Query>(() => ({
    collection: props.collection,
    region: props.region,
    q: parameter('q'),
    type: parameter('type') as Query['type'],
    page: parameter('page'),
    childPage: parameter('childPage'),
    eventId: parameter('event'),
}));
const search = ref(query.value.q ?? '');
useDebouncedValue(search, 300, finishTypedSearch);
watch(
    () => query.value.q,
    (value) => {
        // Back may commit while the next typed search is still debouncing. Preserve
        // that input; its filter will apply to the settled/pending destination below.
        if (!searchPending.value) search.value = value ?? '';
    },
);
const overview = useQuery({
    queryKey: computed(() => overviewKeys.region(context.session.value?.context, context.locale.value, query.value)),
    enabled: computed(() => props.active !== false && context.hydrated.value && context.ready.value && context.visible.value),
    queryFn: ({signal}) => loadOverview(signal),
    initialData: () => context.initialDocumentFor(route.fullPath)?.session.locale === context.locale.value
        ? context.initialDocumentFor(route.fullPath)?.overview?.find(value => value.collection === props.collection && value.region === props.region) : undefined,
    refetchOnMount: 'always',
    refetchInterval: (value) =>
        props.active !== false && context.visible.value
            ? refreshInterval(value.state.error, value.state.fetchFailureCount, jitter) : false,
});
// Every mounted region resolves independently. Keep confirmed cards and focused filters
// during background refreshes; only missing, pending authority receives card shapes.
const initialLoading = computed(() => props.active !== false && !overview.data.value
    && overview.isPending.value && !overview.error.value);
const filterTypes = computed(() => {
    const types = overview.data.value?.availableTypes ?? [];
    const selected = overview.data.value?.type;
    // A saved filter can outlive its last visible member after another client's edit or a
    // personal hide. Retain the validated choice so an empty result does not claim All types.
    return selected && selected !== 'all' && !types.includes(selected) ? [...types, selected] : types;
});
watch(overview.data, (value) => {
    if (value) emit('counts', value.totalEntities, value.hiddenEntities);
}, {immediate: true});
// A private preference can change both collection appearances. Refresh all mounted regions
// together; server-owned placement remains separate from authoritative archival.
async function refresh(): Promise<void> {
    await context.queryClient.refetchQueries(
        {
            queryKey: overviewKeys.all(context.session.value?.context),
            type: 'active',
        },
        {throwOnError: true},
    );
}
const command = useCommand(refresh);
const blocked = computed(() => command.pending.value || command.uncertain.value);

/** Capture a read before awaiting its response. Input retires the generation immediately,
 * so even a transport that finishes after cancellation cannot publish obsolete results. */
async function loadOverview(signal: AbortSignal): Promise<components['schemas']['OverviewRegion']> {
    const generation = readGeneration;
    const requested = {...query.value};
    const result = await api.overview(requested, context.capture(), signal);
    if (generation !== readGeneration) throw new ObsoleteRequestError();
    return result;
}

function rememberNavigation(to: RouteLocationNormalized): void {
    pendingNavigation = to;
    // Back/Forward can start outside this component. Only changed parameters for this
    // region retire its requests; another region's navigation must leave them running.
    const parameters = ['q', 'type', 'page', 'childPage', 'event'];
    if (parameters.some(name => to.query[prefix.value + name] !== route.query[prefix.value + name])) {
        retireReads();
    }
}

function finishNavigation(to: RouteLocationNormalized): void {
    if (pendingNavigation === to) pendingNavigation = undefined;
}

/** Cancel this region's previous reads before the native debounce expires. Other regions
 * retain their independent requests, and the last confirmed cards stay readable. */
function retireReads(): void {
    readGeneration++;
    void context.queryClient.cancelQueries({queryKey: overviewKeys.regionFamily(
        context.session.value?.context, context.locale.value, props.collection, props.region,
    )});
}

function editSearch(event: Event): void {
    search.value = (event.target as HTMLInputElement).value;
    if (blocked.value) return;
    searchPending.value = true;
    retireReads();
}

function submitSearch(): void {
    if (blocked.value) return;
    searchPending.value = false;
    void navigate({q: search.value || undefined, page: undefined, childPage: undefined}, 'replace');
}

function finishTypedSearch(value: string): void {
    if (searchPending.value && value === search.value) submitSearch();
}
watch(() => props.active, active => {
    if (active !== false) return;
    searchPending.value = false;
    retireReads();
});
function navigationQuery(values: Record<string, string | undefined>) {
    // Native typing during Back targets the requested destination rather than the
    // still-rendered old event. Merge only this region into the latest whole-page URL.
    const next = {...(pendingNavigation?.query ?? route.query)};
    for (const [key, value] of Object.entries(values)) {
        if (value === undefined) delete next[prefix.value + key];
        else next[prefix.value + key] = value;
    }
    return next;
}
function navigationHref(values: Record<string, string | undefined>): string {
    return router.resolve({path: '/frontend-pilot', query: navigationQuery(values)}).href;
}
/** Filters replace the current history entry; page/event navigation creates an entry.
 * The shared command guard retains pending controls while Vue Router owns navigation. */
async function navigate(values: Record<string, string | undefined>, history: 'push' | 'replace' = 'push'): Promise<void> {
    if (blocked.value) return;
    searchPending.value = false;
    retireReads();
    const destination = {path: '/frontend-pilot', query: navigationQuery(values)};
    if (router.resolve(destination).fullPath === route.fullPath) {
        // Enter/Search remains an explicit read even when the filter URL is unchanged.
        await overview.refetch();
        return;
    }
    if (history === 'replace') await router.replace(destination);
    else await router.push(destination);
}
// GET search submits this region's controls, preserves other regions and the selected
// event, and drops both old pagers. Navigation needs no server-held per-tab state.
const nativeSearchFields = computed(() => Object.entries(route.query).filter(([key, value]) => typeof value === 'string'
    && !['q', 'type', 'page', 'childPage'].some(name => key === prefix.value + name)) as Array<[string, string]>);
function pageHref(next: number): string {
    return navigationHref({[overview.data.value?.parent ? 'childPage' : 'page']: String(next)});
}
function expandHref(card: components['schemas']['OverviewCard']): string {
    return navigationHref({event: card.id, childPage: undefined});
}
function filterType(event: Event): void {
    const type = (event.target as HTMLSelectElement).value;
    // Native type buttons submit the search field's current draft as well. Preserve that
    // behavior and reset both pagers without disturbing the selected event or other regions.
    void navigate({q: search.value || undefined, type: type === 'all' ? undefined : type,
        page: undefined, childPage: undefined}, 'replace');
}
async function setVisibility(
    card: components['schemas']['OverviewCard'],
    value: components['schemas']['OverviewVisibilityInput']['visibility'],
): Promise<void> {
    await command.run((scope) => api.visibility(card.type, card.id, value, scope));
}
async function archive(card: components['schemas']['OverviewCard'], restore: boolean): Promise<void> {
    if (
        window.confirm(
            messages.value.t(
                restore
                    ? 'packing.confirmRestore'
                    : card.inheritedArchived
                      ? 'packing.confirmArchiveIndependent'
                      : 'packing.confirmArchive',
            ),
        )
    )
        await command.run((scope) => packingApi.archive(card.id, restore, scope));
}
async function remove(card: components['schemas']['OverviewCard']): Promise<void> {
    if (window.confirm(messages.value.t('packing.confirmDelete')))
        await command.run((scope) => packingApi.deletePacking(card.id, scope));
}
function page(next: number): void {
    void navigate({[overview.data.value?.parent ? 'childPage' : 'page']: String(next)});
}
</script>
<template>
    <!-- Keep initial skeleton status unsuppressed; only confirmed content is busy
         during background reads, which leave cards and focused controls mounted. -->
    <section class="js-overview-region" :data-collection="collection" :data-region="region"
        :aria-busy="!!overview.data.value && overview.isFetching.value">
        <StatusNotice v-if="command.error.value" kind="danger">{{ command.error.value }}</StatusNotice
        ><StatusNotice v-if="command.notice.value" kind="warning">{{
            messages.t(command.notice.value)
        }}</StatusNotice>
        <StatusNotice v-if="overview.error.value" kind="warning">{{
            messages.t('state.loadFailed')
        }}</StatusNotice>
        <form
            class="d-flex flex-wrap gap-2 mb-3 align-items-center"
            method="get" action="/frontend-pilot"
            @submit.prevent="submitSearch"
        >
            <input v-for="[name, value] in nativeSearchFields" :key="name" type="hidden" :name="name" :value="value" />
            <div class="input-group input-group-sm" style="max-width: 320px">
                <span class="input-group-text"><i class="bi bi-search" aria-hidden="true"></i></span
                ><input
                    :value="search"
                    @input="editSearch"
                    :name="prefix + 'q'"
                    class="form-control"
                    type="search"
                    maxlength="200"
                    :aria-label="
                        messages.t('overview.collectionSearch', {
                            title: title.toLocaleLowerCase(context.locale.value),
                        })
                    "
                    :placeholder="
                        messages.t('overview.collectionSearch', {
                            title: title.toLocaleLowerCase(context.locale.value),
                        }) + '…'
                    "
                />
            </div>
            <ActionButton type="submit" class="btn-sm" variant="outline-secondary">{{
                messages.t('overview.search')
            }}</ActionButton>
            <!-- Type selection uses the server's region membership, independent of search.
                 Changing either filter restarts both pagers and preserves other regions. -->
            <label class="visually-hidden" :for="prefix + 'type'">{{
                messages.t('overview.filterByType')
            }}</label>
            <select
                :id="prefix + 'type'"
                :name="prefix + 'type'"
                class="form-select form-select-sm"
                style="width: auto"
                :value="query.type ?? 'all'"
                @change="filterType"
            >
                <option value="all">{{ messages.t('overview.allTypes') }}</option>
                <option v-for="type in filterTypes" :key="type" :value="type">{{
                    messages.t(`overview.types.${type}`)
                }}</option>
            </select>
            <span v-if="overview.data.value" class="small text-body-secondary" aria-live="polite">{{
                messages.t('overview.matching', {count: overview.data.value.matchingEntities})
            }}</span>
            <a
                v-if="query.q || (query.type && query.type !== 'all')"
                class="btn btn-sm btn-outline-secondary"
                :href="navigationHref({q: undefined, type: undefined, page: undefined, childPage: undefined})"
                @click.prevent="navigate({q: undefined, type: undefined, page: undefined, childPage: undefined}, 'replace')"
                >{{ messages.t('overview.clear') }}</a
            ><ActionButton
                class="btn-sm ms-auto"
                variant="outline-secondary"
                :pending="overview.isFetching.value"
                @click="command.reconcile()"
                >{{ messages.t('common.refresh') }}</ActionButton
            >
        </form>
        <LoadingSkeleton v-if="initialLoading" variant="cards" />
        <template v-if="overview.data.value">
            <template v-if="overview.data.value.parent">
                <a
                    class="btn btn-sm mb-3 btn-outline-secondary"
                    :href="navigationHref({event: undefined, childPage: undefined})"
                    @click.prevent="navigate({event: undefined, childPage: undefined})"
                >
                    <i class="bi bi-arrow-left me-1" aria-hidden="true"></i>{{ messages.t('overview.back') }}
                </a>
                <OverviewCard
                    :card="overview.data.value.parent"
                    :disabled="blocked"
                    @visibility="setVisibility(overview.data.value.parent, $event)"
                    @archive="archive(overview.data.value.parent, $event)"
                    @remove="remove(overview.data.value.parent)"
                >
                    <div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3">
                        <h4 class="h5 mb-0">
                            {{
                                messages.t('overview.linkedHeading', {
                                    title,
                                    count: overview.data.value.totalChildren,
                                })
                            }}
                        </h4>
                        <a
                            v-if="query.q || (query.type && query.type !== 'all')"
                            class="btn btn-sm btn-outline-secondary"
                            :href="navigationHref({q: undefined, type: undefined, page: undefined, childPage: undefined})"
                            @click.prevent="navigate({q: undefined, type: undefined, page: undefined, childPage: undefined}, 'replace')"
                            >{{ messages.t('overview.showAllLinked') }}</a
                        >
                    </div>
                    <OverviewItems
                        :view="overview.data.value"
                        :disabled="blocked"
                        :page-href="pageHref"
                        :expand-href="expandHref"
                        @visibility="setVisibility"
                        @archive="archive"
                        @remove="remove"
                        @page="page"
                    />
                </OverviewCard>
            </template>
            <OverviewItems
                v-else
                :view="overview.data.value"
                :disabled="blocked"
                :page-href="pageHref"
                :expand-href="expandHref"
                @visibility="setVisibility"
                @archive="archive"
                @remove="remove"
                @expand="navigate({event: $event.id, childPage: undefined})"
                @page="page"
            />
        </template>
    </section>
</template>
