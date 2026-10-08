<script setup lang="ts">
import {computed, onMounted, reactive, ref, shallowRef, watch} from 'vue';
import {useRoute} from 'vue-router';
import {useQuery} from '@tanstack/vue-query';
import type {components} from '../../../types/api/v1';
import type {PilotRead} from '../../../types/FrontendPilotUiTypes';
import {usePackingApi} from './api';
import {usePilot, refreshInterval, canRetryRead} from '../../app/context';
import {ApiFailure} from '../../app/transport';
import {evictPackingResource} from '../../app/queryCache';
import {belongsToQueryFamily, packingKeys} from '../../app/queryKeys';
import {usePageTitle} from '../../composables/pageTitle';
import {readPacked, writePacked} from '../../composables/packed';
import {useCommand} from '../../composables/command';
import {usePackingHeader} from '../../composables/packingHeader';
import ActionButton from '../../components/ActionButton.vue';
import InlineCell from '../../components/InlineCell.vue';
import StatusNotice from '../../components/StatusNotice.vue';
import LoadingSkeleton from '../../components/LoadingSkeleton.vue';
import PackingSettings from './PackingSettings.vue';

type Item = components['schemas']['PackingItemView'];
type ListRead = PilotRead<components['schemas']['PackingListView']>;
const route = useRoute();
const context = usePilot();
const api = usePackingApi(context);
const {messages} = context;
const listId = computed(() => String(route.params.listId).toLowerCase());
const key = computed(() => packingKeys.detail(context.session.value?.context, listId.value, context.locale.value));
const jitter = context.browser ? Math.round(Math.random() * 3000) : 0;
const editorOpen = ref(false);
const packed = ref<Record<string, boolean>>({});
const editing = ref(0);
const accessRevoked = ref(false);
const freshItem = reactive({title: '', description: '', maxAssignees: 1});
const quickAddDirty = computed(
    () => !!freshItem.title || !!freshItem.description || freshItem.maxAssignees !== 1,
);
const dragged = ref<{id: string; token: string; ids: string[]} | null>(null);
// A locale read must not unmount this list's focused drafts. Keep the previously
// authorized read only within its query family, including a failed locale read.
const previousList = shallowRef<{
    query: Parameters<typeof belongsToQueryFamily>[0];
    result: ListRead;
} | null>(null);
const list = useQuery({
    queryKey: key,
    enabled: computed(
        () => context.hydrated.value && context.ready.value && context.visible.value && !accessRevoked.value,
    ),
    queryFn: ({signal, queryKey}) =>
        api.packing(
            listId.value,
            context.capture(),
            signal,
            context.queryClient.getQueryData<PilotRead<components['schemas']['PackingListView']>>(queryKey),
        ),
    refetchInterval: (query) =>
        context.visible.value
            ? refreshInterval(query.state.error, query.state.fetchFailureCount, jitter)
            : false,
    refetchIntervalInBackground: false,
    placeholderData(previous, previousQuery) {
        if (!previous || !previousQuery || !belongsToQueryFamily(previousQuery,
            packingKeys.resource(context.session.value?.context, listId.value))) {
            previousList.value = null;
            return undefined;
        }
        // TanStack drops a placeholder after a terminal read failure. Retain the
        // same scoped response for the stale view; the failed read remains visible.
        previousList.value = {query: previousQuery, result: previous};
        return previous;
    },
});
const denied = computed(
    () =>
        accessRevoked.value ||
        (list.error.value instanceof ApiFailure && [401, 403, 404].includes(list.error.value.status)),
);
const data = computed(() => {
    if (denied.value) return null;
    if (list.data.value) return list.data.value.data;
    const previous = previousList.value;
    return previous && belongsToQueryFamily(previous.query,
        packingKeys.resource(context.session.value?.context, listId.value)) ? previous.result.data : undefined;
});
const initialLoading = computed(() => !denied.value && !data.value && list.isPending.value);
usePageTitle(() => data.value?.title || messages.value.t('packing.items'));
const items = computed(() =>
    [...(data.value?.items ?? [])].sort(
        (a, b) => Number(b.requiredByAll) - Number(a.requiredByAll) || a.position - b.position,
    ),
);
const header = usePackingHeader(
    listId,
    computed(() => data.value?.headerVersion),
);
const command = useCommand(async () => {
    await list.refetch({throwOnError: true});
}, false, {
    // Descendant Settings and inline editors delegate their global guards here.
    // The command owner combines all mounted input into one departure decision.
    dirty: () => quickAddDirty.value,
    unknownMessage: 'draft.leaveUnknown',
});
const blocked = computed(() => command.pending.value || command.uncertain.value);
const canEdit = computed(
    () =>
        data.value?.capabilities.reorder ||
        items.value.some(
            (item) =>
                item.capabilities.editTitle ||
                item.capabilities.editDescription ||
                item.capabilities.editCapacity,
        ),
);
function storage(): Storage | undefined {
    try {
        return context.browser ? window.localStorage : undefined;
    } catch {
        return undefined;
    }
}
function loadPacked(): void {
    packed.value = Object.fromEntries(
        items.value.map((item) => [item.id, readPacked(storage(), listId.value, item.id)]),
    );
}
watch(() => items.value.map((item) => item.id).join('|'), loadPacked);
watch(listId, () => {
    // The route guard has accepted leaving this resource. An unknown command belongs to
    // its previous list and must not block a fresh quick-add or assignment on the new list.
    command.acknowledge();
    editorOpen.value = false;
    accessRevoked.value = false;
    previousList.value = null;
    dragged.value = null;
    Object.assign(freshItem, {title: '', description: '', maxAssignees: 1});
    loadPacked();
});
function revokeAccess(): void {
    accessRevoked.value = true;
    previousList.value = null;
    editorOpen.value = false;
    void evictPackingResource(context.queryClient, context.capture().context, listId.value);
}
async function settingsAccessLost(): Promise<void> {
    editorOpen.value = false;
    const actor = context.session.value?.context;
    const resource = listId.value;
    // Losing edit authority does not prove that reading or self-assignment was revoked.
    // Cancel and remove editor projections across locales, then let the list endpoint
    // authoritatively decide which remaining view/actions this profile can still use.
    const editors = {queryKey: packingKeys.editors(actor, resource)};
    await context.queryClient.cancelQueries(editors);
    context.queryClient.removeQueries(editors);
    if (!context.ready.value || resource !== listId.value || actor !== context.session.value?.context) return;
    await refresh();
}
watch(list.error, (failure) => {
    if (failure instanceof ApiFailure && [401, 403, 404].includes(failure.status)) revokeAccess();
});
onMounted(loadPacked);
function togglePacked(itemId: string, event: Event): void {
    const selected = (event.target as HTMLInputElement).checked;
    packed.value[itemId] = selected;
    writePacked(storage(), listId.value, itemId, selected);
}
/** Preserve the native treatment of historical null capacities (IMP-025). */
function isFull(item: Item): boolean {
    return item.assignedCount >= (item.maxAssignees ?? 0);
}
async function refresh(): Promise<void> {
    if (!canRetryRead(list.error.value)) return;
    await command.reconcile().catch(() => {
        command.notice.value = 'state.stale';
    });
}
async function patch(
    item: Item,
    field: 'title' | 'description' | 'maxAssignees',
    value: string,
    token: string,
): Promise<boolean> {
    // Native inline editing permits an empty item title. Only clearing the optional
    // description uses null; creating a new item still requires its title.
    const patch =
        field === 'maxAssignees'
            ? {maxAssignees: Number(value)}
            : field === 'title'
              ? {title: value}
              : {description: value || null};
    return !!(await command.run((scope) =>
        api.updateItem(listId.value, item.id, patch, token, scope),
    ));
}
async function assign(item: Item): Promise<void> {
    await command.run((scope) => api.assign(listId.value, item.id, !item.selfAssigned, scope));
}
async function toggleRequired(item: Item, event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const value = input.checked;
    // The checkbox remains authoritative until a confirmed response has been refreshed.
    input.checked = item.requiredByAll;
    await command.run((scope) =>
        api.updateItem(listId.value, item.id, {requiredByAll: value}, item.editToken, scope),
    );
}
async function removeItem(item: Item): Promise<void> {
    if (window.confirm(messages.value.t('packing.confirmDeleteItem'))) {
        await command.run((scope) => api.deleteItem(listId.value, item.id, scope));
    }
}
async function removeAssignment(assignmentId: string): Promise<void> {
    if (window.confirm(messages.value.t('packing.confirmRemoveAssignment'))) {
        await command.run((scope) => api.removeAssignment(listId.value, assignmentId, scope));
    }
}
async function addItem(): Promise<void> {
    const result = await command.run((scope) =>
        api.addItem(
            listId.value,
            {
                // Quick-add posts raw native form values. Creation's collection-row
                // trimming is a different workflow; a blank optional capacity uses one.
                title: freshItem.title,
                description: freshItem.description,
                maxAssignees: Number(freshItem.maxAssignees) || 1,
                requiredByAll: false,
            },
            scope,
        ),
        true,
        true,
    );
    if (result) Object.assign(freshItem, {title: '', description: '', maxAssignees: 1});
}
async function reviewUnknownItem(): Promise<void> {
    // A read reveals current rows, but cannot prove which one a lost creation response added.
    // Keep the captured input blocked until the user reviews that list and acknowledges it.
    await refresh();
    if (!list.error.value && window.confirm(messages.value.t('packing.confirmUnknownReviewed'))) {
        command.acknowledge();
    }
}
function beginDrag(item: Item, event: DragEvent): void {
    if (!data.value?.capabilities.reorder || blocked.value || editing.value) {
        event.preventDefault();
        return;
    }
    dragged.value = {
        id: item.id,
        token: data.value.orderToken,
        ids: items.value.map((current) => current.id),
    };
    event.dataTransfer?.setData('text/plain', item.id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
}
async function drop(item: Item, event: DragEvent): Promise<void> {
    event.preventDefault();
    const original = dragged.value;
    dragged.value = null;
    if (
        !original ||
        original.id === item.id ||
        !data.value?.capabilities.reorder ||
        blocked.value ||
        editing.value
    )
        return;
    const ids = original.ids.filter((id) => id !== original.id);
    ids.splice(ids.indexOf(item.id), 0, original.id);
    await command.run((scope) => api.reorder(listId.value, ids, original.token, scope));
}
</script>

<template>
    <section class="card bg-dark text-white mb-3" :aria-busy="!!data && list.isFetching.value">
        <div class="card-header p-0">
            <img
                v-if="header"
                :src="header"
                :alt="data?.title"
                class="card-img-top"
                style="object-fit: cover; height: 250px"
            />
            <div class="entity-header-layout p-3 gap-3">
                <div v-if="data?.currentEventUrl" class="entity-header-parent btn-group d-md-inline d-none">
                    <a class="btn btn-outline-light" :href="data.currentEventUrl">
                        <i class="bi bi-arrow-left-circle me-1" aria-hidden="true"></i
                        >{{ messages.t('packing.goToEvent') }}
                    </a>
                </div>
                <h1 class="mb-0 text-center">
                    <i class="bi bi-bag-check-check me-2" aria-hidden="true"></i
                    >{{ data?.title || messages.t('packing.items') }}
                </h1>
                <div v-if="data?.currentEventUrl" class="btn-group d-md-none">
                    <a class="btn btn-outline-light" :href="data.currentEventUrl">
                        <i class="bi bi-arrow-left-circle me-1" aria-hidden="true"></i
                        >{{ messages.t('packing.goToEvent') }}
                    </a>
                </div>
                <ActionButton
                    v-if="data?.capabilities.manageSettings"
                    variant="outline-light"
                    :disabled="blocked"
                    @click="editorOpen = true"
                >
                    <i class="bi bi-gear me-1" aria-hidden="true"></i>{{ messages.t('packing.edit') }}
                </ActionButton>
            </div>
        </div>
        <div class="card-body">
            <StatusNotice v-if="command.error.value" kind="danger">{{ command.error.value }}</StatusNotice>
            <StatusNotice
                v-if="command.notice.value"
                :kind="command.notice.value === 'state.saved' ? 'success' : 'warning'"
                >{{ messages.t(command.notice.value) }}
                <template v-if="command.uncertain.value && quickAddDirty">
                    <p class="mb-2">{{ messages.t('packing.reviewUnknownItem') }}</p>
                    <ActionButton variant="outline-warning" :pending="list.isFetching.value" @click="reviewUnknownItem">
                        {{ messages.t('draft.review') }}
                    </ActionButton>
                </template>
            </StatusNotice
            >
            <StatusNotice v-if="denied" kind="danger">{{ messages.t('state.forbidden') }}</StatusNotice>
            <StatusNotice v-else-if="list.error.value" kind="warning">{{
                messages.t(data ? 'state.stale' : 'state.loadFailed')
            }}</StatusNotice>
            <!-- Shape the missing detail region without inventing items or capabilities.
                 Loaded rows and drafts remain mounted throughout background reads. -->
            <LoadingSkeleton v-if="initialLoading" variant="table" :rows="4" />
            <template v-if="data">
                <StatusNotice v-if="data.archived || data.inheritedArchived" kind="info">{{
                    messages.t('packing.archived')
                }}</StatusNotice>
                <template v-if="data.description"
                    ><p id="planDesc" class="pilot-description mb-0">{{ data.description }}</p>
                    <hr class="my-3"
                /></template>
                <div
                    class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3"
                    data-packing-counters
                >
                    <span class="fs-6 fw-semibold text-nowrap"
                        ><i class="bi bi-people-fill me-1" aria-hidden="true"></i
                        >{{ messages.t('packing.participants') }}:
                        <span class="badge bg-light text-dark ms-1">{{
                            data.counters.participants
                        }}</span></span
                    >
                    <span class="fs-6 fw-semibold text-nowrap"
                        ><i class="bi bi-card-checklist me-1" aria-hidden="true"></i
                        >{{ messages.t('packing.items') }}:
                        <span class="badge bg-light text-dark ms-1">{{ data.items.length }}</span>
                        <span class="badge bg-secondary-subtle text-secondary-emphasis ms-1"
                            ><i class="bi bi-box-arrow-up-right me-1" aria-hidden="true"></i
                            >{{ data.counters.open }} {{ messages.t('packing.open') }}</span
                        >
                        <span class="badge bg-danger-subtle text-danger-emphasis ms-1"
                            ><i class="bi bi-slash-circle me-1" aria-hidden="true"></i
                            >{{ data.counters.empty }} {{ messages.t('packing.unassigned') }}</span
                        ></span
                    >
                </div>
            </template>
            <div class="d-flex justify-content-between align-items-center mb-1">
                <small v-if="canEdit" class="text-info fst-italic fw-light">{{
                    messages.t('packing.inlineHint')
                }}</small>
                <ActionButton
                    class="btn-sm ms-auto"
                    variant="outline-secondary"
                    :pending="list.isFetching.value"
                    :disabled="(blocked && !command.uncertain.value) || !canRetryRead(list.error.value)"
                    :aria-label="messages.t('common.refresh')"
                    :title="messages.t('common.refresh')"
                    @click="refresh"
                    ><i class="bi bi-arrow-clockwise" aria-hidden="true"></i
                ></ActionButton>
            </div>
            <template v-if="data">
                <div class="table-responsive">
                    <table
                        class="table table-dark table-bordered table-hover align-middle pilot-packed-table"
                    >
                        <thead>
                            <tr>
                                <th scope="col" class="text-center w-5">
                                    {{ messages.t('packing.packed') }}
                                </th>
                                <th scope="col" class="text-center w-25">
                                    {{ messages.t('packing.assignees') }}
                                </th>
                                <th scope="col" class="text-center w-25">{{ messages.t('packing.item') }}</th>
                                <th scope="col" class="text-center w-20">
                                    {{ messages.t('packing.description') }}
                                </th>
                                <th scope="col" class="text-center text-nowrap w-10">
                                    {{ messages.t('packing.capacity') }}
                                </th>
                                <th scope="col" class="text-center w-15">
                                    {{ messages.t('packing.action') }}
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr
                                v-for="item in items"
                                :key="item.id"
                                :data-item-id="item.id"
                                :draggable="data.capabilities.reorder && !blocked && !editing"
                                :class="
                                    packed[item.id] ? 'table-success' : item.requiredByAll ? 'table-info' : ''
                                "
                                @dragstart="beginDrag(item, $event)"
                                @dragend="dragged = null"
                                @dragover.prevent
                                @drop="drop(item, $event)"
                            >
                                <td class="text-center">
                                    <input
                                        class="form-check-input"
                                        type="checkbox"
                                        :checked="packed[item.id] || false"
                                        :aria-label="messages.t('packing.packed') + ' ' + item.title"
                                        @change="togglePacked(item.id, $event)"
                                    />
                                </td>
                                <td class="text-center">
                                    <span v-if="item.requiredByAll" class="badge bg-info fs-6"
                                        ><i class="bi bi-people-fill me-1" aria-hidden="true"></i
                                        >{{ messages.t('packing.everyone') }}</span
                                    >
                                    <ul v-else class="list-unstyled mb-0">
                                        <li
                                            v-for="(assignee, index) in item.assignees"
                                            :key="assignee.assignmentId ?? index"
                                            class="d-flex align-items-center gap-1"
                                        >
                                            <i class="bi bi-person-fill" aria-hidden="true"></i
                                            ><span class="flex-grow-1">{{ assignee.name }}</span>
                                            <ActionButton
                                                v-if="
                                                    item.capabilities.removeAssignments &&
                                                    assignee.assignmentId !== null
                                                "
                                                class="btn-sm"
                                                variant="outline-danger"
                                                :disabled="blocked"
                                                :aria-label="messages.t('packing.removeAssignment')"
                                                @click="removeAssignment(assignee.assignmentId)"
                                                >&times;</ActionButton
                                            >
                                        </li>
                                    </ul>
                                </td>
                                <InlineCell
                                    :value="item.title"
                                    :token="item.editToken"
                                    :editable="item.capabilities.editTitle"
                                    :disabled="blocked"
                                    :label="messages.t('packing.title')"
                                    :max-length="255"
                                    :save="(value, token) => patch(item, 'title', value, token)"
                                    @editing="editing += $event ? 1 : -1"
                                />
                                <InlineCell
                                    :value="item.description"
                                    :token="item.editToken"
                                    :editable="item.capabilities.editDescription"
                                    :disabled="blocked"
                                    :label="messages.t('packing.description')"
                                    :max-length="65535"
                                    :save="(value, token) => patch(item, 'description', value, token)"
                                    @editing="editing += $event ? 1 : -1"
                                />
                                <InlineCell
                                    class="text-center"
                                    :value="item.maxAssignees"
                                    :token="item.editToken"
                                    :editable="item.capabilities.editCapacity"
                                    :disabled="blocked"
                                    :label="messages.t('packing.capacity')"
                                    numeric
                                    :save="(value, token) => patch(item, 'maxAssignees', value, token)"
                                    @editing="editing += $event ? 1 : -1"
                                >
                                    {{ item.assignedCount }} / {{ item.maxAssignees }}
                                </InlineCell>
                                <td class="text-center">
                                    <div
                                        v-if="item.capabilities.editRequired"
                                        class="form-check form-switch d-flex align-items-center justify-content-center me-2"
                                    >
                                        <input
                                            class="form-check-input"
                                            type="checkbox"
                                            role="switch"
                                            :checked="item.requiredByAll"
                                            :disabled="blocked"
                                            :aria-label="messages.t('packing.all')"
                                            @change="toggleRequired(item, $event)"
                                        />
                                        <span class="ms-1 small">{{ messages.t('packing.all') }}</span>
                                    </div>
                                    <template v-if="data.capabilities.selfAssign && item.selfAssigned">
                                        <ActionButton
                                            class="btn-sm"
                                            variant="outline-danger"
                                            :disabled="blocked"
                                            @click="assign(item)"
                                            >{{ messages.t('packing.unassign') }}</ActionButton
                                        >
                                        <span v-if="isFull(item)" class="badge bg-secondary ms-1">{{
                                            messages.t('packing.full')
                                        }}</span>
                                    </template>
                                    <span v-else-if="item.requiredByAll" class="badge bg-info ms-1">{{
                                        messages.t('packing.everyone')
                                    }}</span>
                                    <ActionButton
                                        v-else-if="data.capabilities.selfAssign && !isFull(item)"
                                        class="btn-sm"
                                        variant="outline-success"
                                        :disabled="blocked"
                                        @click="assign(item)"
                                        >{{ messages.t('packing.assign') }}</ActionButton
                                    >
                                    <span v-else-if="isFull(item)" class="badge bg-secondary">{{
                                        messages.t('packing.full')
                                    }}</span>
                                    <ActionButton
                                        v-if="item.capabilities.removeItem"
                                        class="btn-sm ms-1"
                                        variant="outline-danger"
                                        :disabled="blocked"
                                        :aria-label="messages.t('packing.deleteItem')"
                                        @click="removeItem(item)"
                                        ><i class="bi bi-trash" aria-hidden="true"></i
                                    ></ActionButton>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                <template v-if="data.capabilities.addItem">
                    <hr />
                    <div class="card bg-dark text-light border-secondary mb-3">
                        <div class="card-header p-2 d-flex align-items-center">
                            <i class="bi bi-plus-circle me-2" aria-hidden="true"></i>
                            <span class="flex-grow-1">{{ messages.t('packing.addNewItem') }}</span>
                            <small class="text-info fst-italic ms-2">{{
                                messages.t('packing.fillAllFields')
                            }}</small>
                        </div>
                        <form class="card-body row gy-2 gx-2 align-items-end" @submit.prevent="addItem">
                            <div class="col-md-4">
                                <label class="form-label mb-1" for="quick-title"
                                    >{{ messages.t('packing.title') }} *</label
                                ><input
                                    id="quick-title"
                                    v-model="freshItem.title"
                                    class="form-control text-bg-dark"
                                    :placeholder="messages.t('packing.itemExample')"
                                    required
                                    maxlength="255"
                                    :disabled="blocked"
                                />
                            </div>
                            <div class="col-md-4">
                                <label class="form-label mb-1" for="quick-description">{{
                                    messages.t('packing.description')
                                }}</label
                                ><input
                                    id="quick-description"
                                    v-model="freshItem.description"
                                    class="form-control text-bg-dark"
                                    :placeholder="messages.t('packing.optional')"
                                    maxlength="65535"
                                    :disabled="blocked"
                                />
                            </div>
                            <div class="col-md-2">
                                <label class="form-label mb-1" for="quick-max">{{
                                    messages.t('packing.maxNumber')
                                }}</label
                                ><input
                                    id="quick-max"
                                    v-model.number="freshItem.maxAssignees"
                                    type="number"
                                    min="1"
                                    class="form-control text-bg-dark"
                                    :disabled="blocked"
                                />
                            </div>
                            <div class="col-md-2 d-grid">
                                <ActionButton type="submit" variant="success" :disabled="blocked"
                                    ><i class="bi bi-check-lg me-1" aria-hidden="true"></i
                                    >{{ messages.t('packing.add') }}</ActionButton
                                >
                            </div>
                        </form>
                    </div>
                </template>
            </template>
        </div>
    </section>
    <PackingSettings
        v-if="editorOpen && !denied"
        :key="listId"
        :list-id="listId"
        :list-title="data?.title"
        :metadata-available="!!(data?.capabilities.editTitle || data?.capabilities.editDescription)"
        @close="editorOpen = false"
        @saved="refresh"
        @access-lost="settingsAccessLost"
    />
</template>
