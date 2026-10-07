<script setup lang="ts">
import {computed, ref, watch} from 'vue';
import {useRoute, useRouter} from 'vue-router';
import {useQuery} from '@tanstack/vue-query';
import type {components, paths} from '../../../types/api/v1';
import {usePilot, refreshInterval} from '../../app/context';
import {useCommand} from '../../composables/command';
import ActionButton from '../../components/ActionButton.vue';
import StatusNotice from '../../components/StatusNotice.vue';
import OverviewCard from './OverviewCard.vue';
import OverviewItems from './OverviewItems.vue';

const props = defineProps<{
    collection: components['schemas']['PackingOverviewRegion']['collection'];
    region: components['schemas']['PackingOverviewRegion']['region'];
}>();
const emit = defineEmits<{counts: [total: number, hidden: number]}>();
const context = usePilot();
const {messages} = context;
const route = useRoute();
const router = useRouter();
const title = computed(() =>
    messages.value.t(props.collection === 'participant' ? 'overview.participation' : 'overview.managed'),
);
const prefix = computed(() => props.collection + '_' + props.region + '_');
type Query = NonNullable<paths['/packing-lists/overview']['get']['parameters']['query']>;
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
    queryKey: computed(() => [
        'v1',
        context.session.value?.context,
        context.locale.value,
        'packing',
        'overview',
        query.value,
    ]),
    enabled: computed(() => context.hydrated.value && context.ready.value && context.visible.value),
    queryFn: ({signal}) => context.api.overview(query.value, context.capture(), signal),
    refetchOnMount: 'always',
    refetchInterval: (value) =>
        context.visible.value ? refreshInterval(value.state.error, value.state.fetchFailureCount, 0) : false,
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
});
// A private preference can change both collection appearances. Refresh all mounted regions
// together; server-owned placement remains separate from authoritative archival.
async function refresh(): Promise<void> {
    await context.queryClient.refetchQueries(
        {
            queryKey: ['v1'],
            predicate: (value) => value.queryKey[3] === 'packing' && value.queryKey[4] === 'overview',
            type: 'active',
        },
        {throwOnError: true},
    );
}
const command = useCommand(refresh);
const blocked = computed(() => command.pending.value || command.uncertain.value);
async function navigate(values: Record<string, string | undefined>): Promise<void> {
    const next = {...route.query};
    for (const [key, value] of Object.entries(values)) {
        if (value === undefined) delete next[prefix.value + key];
        else next[prefix.value + key] = value;
    }
    await router.push({path: '/frontend-pilot', query: next});
}
function filterType(event: Event): void {
    const type = (event.target as HTMLSelectElement).value;
    // Native type buttons submit the search field's current draft as well. Preserve that
    // behavior and reset both pagers without disturbing the selected event or other regions.
    void navigate({q: search.value || undefined, type: type === 'all' ? undefined : type,
        page: undefined, childPage: undefined});
}
async function setVisibility(
    card: components['schemas']['PackingOverviewCard'],
    value: components['schemas']['PackingVisibilityInput']['visibility'],
): Promise<void> {
    await command.run((scope) => context.api.visibility(card.type, card.id, value, scope));
}
async function archive(card: components['schemas']['PackingOverviewCard'], restore: boolean): Promise<void> {
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
        await command.run((scope) => context.api.archive(card.id, restore, scope));
}
async function remove(card: components['schemas']['PackingOverviewCard']): Promise<void> {
    if (window.confirm(messages.value.t('packing.confirmDelete')))
        await command.run((scope) => context.api.deletePacking(card.id, scope));
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
            @submit.prevent="navigate({q: search || undefined, page: undefined, childPage: undefined})"
        >
            <div class="input-group input-group-sm" style="max-width: 320px">
                <span class="input-group-text"><i class="bi bi-search" aria-hidden="true"></i></span
                ><input
                    v-model="search"
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
            <ActionButton
                v-if="query.q || (query.type && query.type !== 'all')"
                class="btn-sm"
                variant="outline-secondary"
                @click="navigate({q: undefined, type: undefined, page: undefined, childPage: undefined})"
                >{{ messages.t('overview.clear') }}</ActionButton
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
                <ActionButton
                    class="btn-sm mb-3"
                    variant="outline-secondary"
                    @click="navigate({event: undefined, childPage: undefined})"
                >
                    <i class="bi bi-arrow-left me-1" aria-hidden="true"></i>{{ messages.t('overview.back') }}
                </ActionButton>
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
                        <ActionButton
                            v-if="query.q || (query.type && query.type !== 'all')"
                            class="btn-sm"
                            variant="outline-secondary"
                            @click="navigate({q: undefined, type: undefined, page: undefined, childPage: undefined})"
                            >{{ messages.t('overview.showAllLinked') }}</ActionButton
                        >
                    </div>
                    <OverviewItems
                        :view="overview.data.value"
                        :disabled="blocked"
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
                @visibility="setVisibility"
                @archive="archive"
                @remove="remove"
                @expand="navigate({event: $event.id, childPage: undefined})"
                @page="page"
            />
        </template>
    </section>
</template>
