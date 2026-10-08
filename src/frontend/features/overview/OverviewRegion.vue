<script setup lang="ts">
import {computed, ref, watch} from 'vue';
import {useRoute, useRouter} from 'vue-router';
import {useQuery} from '@tanstack/vue-query';
import type {components, paths} from '../../../types/api/v1';
import {useOverviewApi} from './api';
import {usePackingApi} from '../packing/api';
import {usePilot, refreshInterval} from '../../app/context';
import {useCommand} from '../../composables/command';
import {overviewKeys} from '../../app/queryKeys';
import ActionButton from '../../components/ActionButton.vue';
import StatusNotice from '../../components/StatusNotice.vue';
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
watch(
    () => query.value.q,
    (value) => {
        search.value = value ?? '';
    },
);
const overview = useQuery({
    queryKey: computed(() => overviewKeys.region(context.session.value?.context, context.locale.value, query.value)),
    enabled: computed(() => props.active !== false && context.hydrated.value && context.ready.value && context.visible.value),
    queryFn: ({signal}) => api.overview(query.value, context.capture(), signal),
    initialData: () => context.bootstrap.initialUrl === route.fullPath
        && context.bootstrap.session.context === context.session.value?.context
        && context.bootstrap.session.locale === context.locale.value
        ? context.bootstrap.overview?.find(value => value.collection === props.collection && value.region === props.region) : undefined,
    refetchOnMount: 'always',
    refetchInterval: (value) =>
        props.active !== false && context.visible.value
            ? refreshInterval(value.state.error, value.state.fetchFailureCount, jitter) : false,
});
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
function navigationQuery(values: Record<string, string | undefined>) {
    const next = {...route.query};
    for (const [key, value] of Object.entries(values)) {
        if (value === undefined) delete next[prefix.value + key];
        else next[prefix.value + key] = value;
    }
    return next;
}
function navigationHref(values: Record<string, string | undefined>): string {
    return router.resolve({path: '/frontend-pilot', query: navigationQuery(values)}).href;
}
async function navigate(values: Record<string, string | undefined>): Promise<void> {
    await router.push({path: '/frontend-pilot', query: navigationQuery(values)});
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
        page: undefined, childPage: undefined});
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
    <section class="js-overview-region" :data-collection="collection" :data-region="region">
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
            @submit.prevent="navigate({q: search || undefined, page: undefined, childPage: undefined})"
        >
            <input v-for="[name, value] in nativeSearchFields" :key="name" type="hidden" :name="name" :value="value" />
            <div class="input-group input-group-sm" style="max-width: 320px">
                <span class="input-group-text"><i class="bi bi-search" aria-hidden="true"></i></span
                ><input
                    v-model="search"
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
                @click.prevent="navigate({q: undefined, type: undefined, page: undefined, childPage: undefined})"
                >{{ messages.t('overview.clear') }}</a
            ><ActionButton
                class="btn-sm ms-auto"
                variant="outline-secondary"
                :pending="overview.isFetching.value"
                @click="command.reconcile()"
                >{{ messages.t('common.refresh') }}</ActionButton
            >
        </form>
        <p v-if="!overview.data.value && !overview.error.value">{{ messages.t('common.loading') }}</p>
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
                            @click.prevent="navigate({q: undefined, type: undefined, page: undefined, childPage: undefined})"
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
