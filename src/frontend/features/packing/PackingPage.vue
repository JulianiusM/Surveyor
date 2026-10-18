<script setup lang="ts">
import {computed, onBeforeUnmount, onMounted, reactive, ref, watch} from 'vue';
import {useRoute} from 'vue-router';
import type {components} from '../../../types/api/v1';
import {usePackingApi} from './api';
import {useActionState, usePilot} from '../../app/context';
import {evictQueryFamilies, retireQueryFamily} from '../../app/queryCache';
import {overviewKeys, packingKeys} from '../../app/queryKeys';
import {usePageTitle} from '../../composables/pageTitle';
import {readPacked, writePacked} from './packed';
import {useCommand} from '../../composables/command';
import {useReadRetry, useReadRetryAt} from '../../composables/feedback';
import {useListDetail} from '../../composables/listDetail';
import {useListReorder} from '../../composables/listReorder';
import ActionButton from '../../components/ActionButton.vue';
import InlineCell from '../../components/InlineCell.vue';
import StatusNotice from '../../components/StatusNotice.vue';
import CommandFeedback from '../../components/CommandFeedback.vue';
import LoadingSkeleton from '../../components/LoadingSkeleton.vue';
import PackingSettings from './PackingSettings.vue';
import EntityHeader from '../../components/EntityHeader.vue';
import EntityAssignees from '../../components/EntityAssignees.vue';
import EntityAssignmentActions from '../../components/EntityAssignmentActions.vue';

type Item = components['schemas']['PackingItemView'];
const route = useRoute();
const context = usePilot();
// Personal failure fallback still belongs to this mounted actor, even though its
// successfully persisted native keys deliberately remain independent of profile.
const packedScope = context.capture();
const api = usePackingApi(context);
const {messages} = context;
const listId = computed(() => String(route.params.listId).toLowerCase());
const key = computed(() => packingKeys.detail(context.session.value?.context, listId.value));
const editorOpen = ref(false);
let active = true;
onBeforeUnmount(retirePage);

/** Commands keep their admitted root status after this view retires. Its private
 * query observer must not start a fresh read after denial or component retirement. */
function retirePage(): void {
    active = false;
    resetPacked();
}
const packed = ref<Record<string, boolean>>({});
// Values stay in the existing personal checklist. This set records only which
// explicit changes could not be persisted; it is not another copy of those values.
const pendingPackedWrites = reactive(new Set<string>());
const packedReadFailed = ref(false);
const packedStorageUnavailable = computed(() => packedReadFailed.value || pendingPackedWrites.size > 0);
const editing = ref(0);
const freshItem = reactive({title: '', description: '', maxAssignees: 1});
const quickAddDirty = computed(
    () => !!freshItem.title || !!freshItem.description || freshItem.maxAssignees !== 1,
);
// Packing and Drivers share request lifetime and recovery. Personal packed state
// and the feature's denied-query policy remain owned by this mounted page.
const {list, data, denied, refresh: refreshCurrentList} = useListDetail({
    resourceId: listId, queryKey: key,
    resourceFamily: () => packingKeys.resource(context.session.value?.context, listId.value),
    read: api.packing.bind(api), denied: revokeAccess,
});
const retryAvailable = useReadRetry(() => list.error.value);
const retryAt = useReadRetryAt(() => list.error.value, retryAvailable);
// Native Pug escapes each line and inserts explicit breaks. Keep normal text
// whitespace; pre-wrap would preserve extra spaces/tabs and change native wrapping.
const descriptionLines = computed(() => data.value?.description?.split('\n') ?? []);
const initialLoading = computed(() => !denied.value && !data.value && list.isPending.value);
usePageTitle(() => data.value?.title || messages.value.t('packing.items'));
const items = computed(() =>
    [...(data.value?.items ?? [])].sort(
        (a, b) => Number(b.requiredByAll) - Number(a.requiredByAll) || a.position - b.position,
    ),
);
// The shared displayed header owns binary lifetime/recovery. Packing still
// supplies its admitted version, exact detail key and generated image operation.
const readHeader = api.header.bind(api);

async function refreshAfterCommand(): Promise<void> {
    // A completed write can settle after a concurrent read retires this view's
    // authority. Do not start an automatic private follow-up in that circumstance.
    if (!active || denied.value) return;
    await refreshCurrentList();
}

/** Native Packing HTTP permission failures use the same "Not allowed" wording.
 * Project only its validated known code; contextual errors and future safe server
 * details keep their own presentation, rejection and uncertainty semantics. */
function packingProblemKey(problem: components['schemas']['Problem']) {
    if (problem.code === 'FORBIDDEN') return 'common.notAllowed';
}

const command = useCommand(refreshAfterCommand, false, {
    // Descendant Settings and inline editors delegate their global guards here.
    // The command owner combines all mounted input into one departure decision.
    dirty: () => quickAddDirty.value,
    unknownMessage: 'draft.leaveUnknown',
    problemKey: packingProblemKey,
});
const blocked = computed(() => command.action.disabled.value);
const readAction = useActionState({eligible: mayRefreshList, pending: () => list.isFetching.value,
    blocked: () => command.recoveryAction.disabled.value});

function mayRefreshList(): boolean { return active && context.mayRead() && retryAvailable.value; }

/** Packed state is optional browser-local presentation using the native keys.
 * SSR never probes browser storage. A rejected getter becomes an unavailable
 * receipt, keeping shared commands usable while the page visibly explains failure. */
function storage(): Storage | undefined {
    try {
        return context.browser ? window.localStorage : undefined;
    } catch {
        return undefined;
    }
}
/** Reconcile admitted rows with readable storage while retaining only current-tab failure fallback.
 * Healthy missing keys remain unchecked; outstanding failed writes keep the user's explicit value. */
function loadPacked(): void {
    if (!mayChangePacked()) return;
    const currentStorage = storage();
    const nextPacked: Record<string, boolean> = {};
    const liveItems = new Set<string>();
    let failed = !currentStorage;

    // Read healthy keys even when another item has an outstanding failed write.
    // A storage error supplies no new value, so preserve that row's current memory.
    for (const item of items.value) {
        liveItems.add(item.id);
        const result = readPacked(currentStorage, listId.value, item.id);
        failed ||= !result.available;
        nextPacked[item.id] = pendingPackedWrites.has(item.id) || !result.available
            ? packed.value[item.id] ?? false : result.packed;
    }

    // Removed rows leave no pending preference or warning behind. Background
    // reconciliation performs reads only; it never replays a failed local write.
    for (const itemId of pendingPackedWrites) {
        if (!liveItems.has(itemId)) pendingPackedWrites.delete(itemId);
    }
    packed.value = nextPacked;
    packedReadFailed.value = failed;
}
watch(() => items.value.map((item) => item.id).join('|'), loadPacked);
watch([listId, context.epoch, () => context.session.value?.context], resetPacked, {flush: 'sync'});

/** Temporary preference evidence belongs to this mounted actor/list visit only.
 * Persisted keys retain their native cross-profile behavior after a fresh mount. */
function resetPacked(): void {
    packed.value = {};
    pendingPackedWrites.clear();
    packedReadFailed.value = false;
}

/** Admit personal preference work only for this live actor and currently rendered list/row.
 * Detached DOM listeners can run after navigation, deletion or unmount without a visible notice. */
function mayChangePacked(itemId?: string): boolean {
    // Retained same-resource content stays usable during ordinary server-read
    // failure. Actual actor retirement or denied/foreign data closes local mutation.
    if (!context.browser || !active || !context.isCurrent(packedScope) || data.value?.id !== listId.value) return false;
    return itemId === undefined || items.value.some(item => item.id === itemId);
}

/** Bind user-initiated preference work to its live rendered control as well as current admission.
 * A retired checkbox or Retry must never act on a later list's pending personal choices. */
function mayChangePackedFrom(event: Event, itemId?: string): boolean {
    if (!mayChangePacked(itemId)) return false;

    // currentTarget is the actual input/button even when the click starts in a
    // child element. Removed controls keep listeners but lose this live ownership.
    const control = event.currentTarget as HTMLElement | null;
    return !!control?.isConnected && control.dataset.packedList === listId.value;
}

/** Explicit recovery retries only unsaved personal checks, then verifies readable storage.
 * It makes no HTTP request and leaves the durable warning in place for any remaining failure. */
function retryPackedStorage(event: MouseEvent): void {
    if (!mayChangePackedFrom(event)) return;
    // A pending DOM update may have removed a row since the last checklist watch.
    // Prune through current admitted data before any failed preference is retried.
    loadPacked();
    const currentStorage = storage();

    // Each failed change retains its current selected value. Do not save untouched
    // rows or invent an automatic retry policy for ordinary background list reads.
    for (const itemId of pendingPackedWrites) {
        if (writePacked(currentStorage, listId.value, itemId, packed.value[itemId] ?? false)) {
            pendingPackedWrites.delete(itemId);
        }
    }

    // Successful writes alone cannot certify that reading preferences works again.
    // Reuse the normal reconciliation owner to retire only actual recovered failures.
    loadPacked();
}
watch(listId, () => {
    // The route guard has accepted leaving this resource. An unknown command belongs to
    // its previous list and must not block a fresh quick-add or assignment on the new list.
    command.acknowledge();
    editorOpen.value = false;
    reorder.reset();
    Object.assign(freshItem, {title: '', description: '', maxAssignees: 1});
    loadPacked();
});
function revokeAccess(failure: Error): void {
    editorOpen.value = false;
    // A denied resource retires temporary personal choices immediately, before
    // a later admitted recovery can restore only its actual persisted native keys.
    resetPacked();
    // This feature owns the containing projections to retire. Cache lifetime is
    // shared, without teaching its generic owner any Packing or Overview policy.
    const actor = context.capture().context;
    // Preserve observed error-only queries so same-route recovery remains attached.
    // Removing the current Query would leave its disabled observer's Refresh stale.
    void retireQueryFamily(context.queryClient, packingKeys.resource(actor, listId.value), failure);
    void evictQueryFamilies(context.queryClient, [packingKeys.events(actor), overviewKeys.all(actor)]);
}
/** Retire settings authority independently of detail admission. A fresh list read
 * decides which page/self-membership actions remain available; cancellation and
 * route/actor checks prevent this retired editor from refreshing another list. */
async function settingsAccessLost(): Promise<void> {
    editorOpen.value = false;
    const actor = context.session.value?.context;
    const resource = listId.value;
    // Losing edit authority does not prove that reading or self-assignment was revoked.
    // Cancel and remove editor projections, then let the list endpoint
    // authoritatively decide which remaining view/actions this profile can still use.
    const editors = {queryKey: packingKeys.editors(actor, resource)};
    await context.queryClient.cancelQueries(editors);
    context.queryClient.removeQueries(editors);

    if (!context.mayRead() || resource !== listId.value || actor !== context.session.value?.context) return;
    await refresh();
}
onMounted(loadPacked);
/** Apply the personal checkbox immediately, retaining failed persistence as visible pending work. */
function togglePacked(itemId: string, event: Event): void {
    if (!mayChangePackedFrom(event, itemId)) return;
    const checkbox = event.currentTarget as HTMLInputElement;
    const selected = checkbox.checked;

    // Shared assignments never change here. The local choice remains usable even
    // when a quota/security failure prevents updating its established browser key.
    packed.value[itemId] = selected;
    if (writePacked(storage(), listId.value, itemId, selected)) pendingPackedWrites.delete(itemId);
    else pendingPackedWrites.add(itemId);
}
/** Preserve the native treatment of historical null capacities (IMP-025). */
function isFull(item: Item): boolean {
    return item.assignedCount >= (item.maxAssignees ?? 0);
}
/** Recover through an actually dispatched list read, honoring its deadline.
 * Command reconciliation owns confirmed/unknown status; failed recovery keeps
 * the existing stale presentation and never repeats the original write. */
async function refresh(): Promise<boolean> {
    if (!readAction.isAvailable()) return false;
    try {
        return await command.reconcile(refreshCurrentList);
    } catch {
        command.notice.value = 'state.stale';
        return false;
    }
}
/** Adapt one reviewed inline field without replacing unrelated item values.
 * The editor supplies its captured token; raw native capacity input is deliberately
 * left to the shared server/SQL boundary instead of coerced by this component. */
async function patch(
    item: Item,
    field: 'title' | 'description' | 'maxAssignees',
    value: string,
    token: string,
): Promise<boolean> {
    // Native inline editing permits an empty item title. Only clearing the optional
    // description uses null; creating a new item still requires its title. Capacity
    // keeps the number control's raw draft: Number('') would silently save zero and
    // JavaScript rounding would differ from the native signed-integer DB conversion.
    const patch =
        field === 'maxAssignees'
            ? {maxAssignees: value}
            : field === 'title'
              ? {title: value}
              : {description: value || null};
    return !!(await command.run((scope) =>
        api.updateItem(listId.value, item.id, patch, token, scope),
        true, false, {presentation: 'inline', success: field === 'description' ? 'common.descriptionUpdated' : 'common.updated'},
    ));
}

/** Keep the original browser's local permission feedback without pretending its
 * visible title/capacity affordance grants the actual metadata write. No HTTP
 * operation is admitted; the server remains authoritative for every real save. */
function denyInlineEdit(source?: Event): void {
    command.captureFeedback(source);
    command.setError('packing.inlineMetadataDenied', 'transient', 'inline');
}
/** Submit the desired opposite membership of the admitted row, not a body actor.
 * The server owns idempotency and capacity; unknown delivery is reviewed through
 * the shared command owner instead of automatically toggled or retried. */
async function assign(item: Item): Promise<void> {
    await command.run((scope) => api.assign(listId.value, item.id, !item.selfAssigned, scope), true, false,
        {presentation: 'inline', success: item.selfAssigned ? 'packing.itemUnassigned' : 'packing.itemAssigned'});
}
/** Capture the requested Everyone value while displaying the last admitted row.
 * The existing item token protects this sparse write; a later admitted list read
 * supplies a replacement shared value, rather than an optimistic checkbox. */
async function toggleRequired(item: Item, event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const value = input.checked;

    // Retain the last admitted item value while the requested change is pending,
    // rejected or uncertain. The captured DOM choice is command input only.
    input.checked = item.requiredByAll;
    await command.run((scope) =>
        api.updateItem(listId.value, item.id, {requiredByAll: value}, item.editToken, scope),
        true, false, {presentation: 'inline', success: 'common.updated'},
    );
}
/** Native item deletion needs deliberate confirmation before its independently authorized command. */
async function removeItem(item: Item): Promise<void> {
    if (window.confirm(messages.value.t('packing.confirmDeleteItem'))) {
        await command.run((scope) => api.deleteItem(listId.value, item.id, scope), true, false,
            {presentation: 'inline', success: 'packing.itemDeleted'});
    }
}
async function removeAssignment(assignmentId: string): Promise<void> {
    // Native manager removal submits immediately; its server permission/ownership
    // checks remain authoritative and the shared command still prevents replay.
    await command.run((scope) => api.removeAssignment(listId.value, assignmentId, scope), true, false,
        {presentation: 'inline', success: 'common.removed'});
}
/** Submit the native Quick Add draft once through the shared creation command.
 * Only a confirmed result clears the entered fields; a missing response retains
 * both that draft and explicit review, since a read cannot identify its new row. */
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
        {presentation: 'inline', success: 'common.added'},
    );

    // Confirmation still counts when the follow-up read fails. Unknown delivery
    // yields no result here and must keep the captured creation draft for review.
    if (result) Object.assign(freshItem, {title: '', description: '', maxAssignees: 1});
}

/** Read the current list and obtain deliberate acknowledgement of an unknown
 * Quick Add outcome. This releases its retained status without issuing another
 * creation or treating absence from the refreshed list as proof of failure. */
async function reviewUnknownItem(): Promise<void> {
    // A read reveals current rows, but cannot prove which one a lost creation response added.
    // Keep the captured input blocked until the user reviews that list and acknowledges it.
    const reconciled = await refresh();
    if (reconciled && !list.error.value && window.confirm(messages.value.t('packing.confirmUnknownReviewed'))) {
        command.acknowledge();
    }
}

const reorder = useListReorder({
    available: () => !!data.value?.capabilities.reorder && !blocked.value && !editing.value,
    ids: () => items.value.map(item => item.id), token: () => data.value?.orderToken,
    submit: (ids, token) => command.run(scope => api.reorder(listId.value, ids, token, scope), true, false,
        {presentation: 'inline', success: 'common.orderSaved'}),
});
</script>

<template>
    <section class="card bg-dark text-white mb-3" :aria-busy="!!data && list.isFetching.value">
        <EntityHeader
            :resource-id="listId"
            :title="data?.title || messages.t('packing.items')"
            icon="bi-bag-check-check"
            :image-version="data?.headerVersion"
            :image-query-key="key"
            :read-image="readHeader"
            :image-enabled="!!data && !denied"
            :parent-url="data?.currentEventUrl"
            :settings-available="!!data?.capabilities.manageSettings"
            :settings-disabled="blocked"
            @settings="editorOpen = true"
        />
        <div class="card-body">
            <!-- Native item/assignment commands present transient feedback in the
                 shared page alert host; durable reconciliation stays beside the list. -->
            <CommandFeedback :feedback="command.feedback" :disabled="command.pending.value || command.recovering.value">
                <template #notice>
                    <template v-if="command.uncertain.value && command.reviewRequired.value">
                        <p class="mb-2">{{ messages.t('packing.reviewUnknownItem') }}</p>
                        <ActionButton variant="outline-warning" :state="readAction" @click="reviewUnknownItem">
                            {{ messages.t('draft.review') }}
                        </ActionButton>
                    </template>
                </template>
            </CommandFeedback>
            <StatusNotice v-if="denied" kind="danger" :retry-at="retryAt" :read-error="list.error.value">
                {{ messages.t('state.forbidden') }}
            </StatusNotice>
            <StatusNotice v-else-if="list.error.value" kind="warning"
                :last-updated-at="list.data.value ? list.dataUpdatedAt.value : undefined"
                :retry-at="retryAt" :read-error="list.error.value">{{
                messages.t(data ? 'state.stale' : 'state.loadFailed')
            }}</StatusNotice>
            <!-- Shape the missing detail region without inventing items or capabilities.
                 Loaded rows and drafts remain mounted throughout background reads. -->
            <LoadingSkeleton v-if="initialLoading" v-bind="route.meta.loadingSkeleton" />
            <template v-if="data">
                <!-- Storage failures are durable and cannot expire into silent loss.
                     Retry touches only personal checks, keeping server commands independent. -->
                <StatusNotice v-if="packedStorageUnavailable" kind="warning" data-packed-storage-warning>
                    {{ messages.t('packing.packedStorageUnavailable') }}
                    <ActionButton class="btn-sm ms-2" variant="outline-warning" :data-packed-list="listId"
                        @click="retryPackedStorage">
                        {{ messages.t('common.retry') }}
                    </ActionButton>
                </StatusNotice>
                <StatusNotice v-if="data.archived || data.inheritedArchived" kind="info">{{
                    messages.t('packing.archived')
                }}</StatusNotice>
                <template v-if="data.description"
                    ><p id="planDesc" class="mb-0 mt-2"
                        ><template v-for="(line, index) in descriptionLines" :key="index"
                            >{{ line }}<br v-if="index < descriptionLines.length - 1"
                        /></template></p
                    >
                    <hr class="mb-1 mt-0"
                /></template>
                <!-- Badge margins own the native counter gaps. Keep labels and
                     adjacent badges together so template whitespace adds no gap. -->
                <div
                    class="d-flex justify-content-between align-items-center mb-3"
                >
                    <span class="fs-6 fw-semibold"
                        ><i class="bi bi-people-fill me-1" aria-hidden="true"></i
                        >{{ messages.t('packing.participants') }}:<span class="badge bg-light text-dark ms-1">{{
                            data.counters.participants
                        }}</span></span
                    >
                    <span class="fs-6 fw-semibold"
                        ><i class="bi bi-card-checklist me-1" aria-hidden="true"></i
                        >{{ messages.t('packing.items') }}:<span class="badge bg-light text-dark ms-1">{{ data.items.length }}</span
                        ><span class="badge bg-secondary-subtle text-secondary-emphasis ms-1"
                            ><i class="bi bi-box-arrow-up-right me-1" aria-hidden="true"></i
                            >{{ data.counters.open }} {{ messages.t('packing.open') }}</span
                        ><span class="badge bg-danger-subtle text-danger-emphasis ms-1"
                            ><i class="bi bi-slash-circle me-1" aria-hidden="true"></i
                            >{{ data.counters.empty }} {{ messages.t('packing.unassigned') }}</span
                        ></span
                    >
                </div>
            </template>
            <!-- The native scrolling container owns its editing hint as well as the
                 table. Keep the approved read control in that row, including before
                 data arrives; horizontal scrolling must not create a fixed hint. -->
            <div class="table-responsive">
                <div class="d-flex justify-content-between align-items-center mb-1">
                    <small class="text-info fst-italic fw-light">{{
                        messages.t('packing.inlineHint')
                    }}</small>
                    <ActionButton
                        class="btn-sm ms-auto"
                        variant="outline-secondary"
                        :state="readAction"
                        :aria-label="messages.t('common.refresh')"
                        :title="messages.t('common.refresh')"
                        @click="refresh"
                        ><i class="bi bi-arrow-clockwise" aria-hidden="true"></i
                    ></ActionButton>
                </div>
                <template v-if="data">
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
                                @dragstart="reorder.begin(item.id, $event)"
                                @dragend="reorder.reset"
                                @dragover.prevent
                                @drop="reorder.drop(item.id, $event)"
                            >
                                <td class="text-center">
                                    <input
                                        class="form-check-input"
                                        type="checkbox"
                                        :data-packed-list="listId"
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
                                    <EntityAssignees v-else :assignees="item.assignees"
                                        :removable="item.capabilities.removeAssignments" :disabled="blocked"
                                        :remove-label="messages.t('packing.removeAssignment')" @remove="removeAssignment" />
                                </td>
                                <!-- Native item editors have no HTML length caps. Their
                                     generated command shape remains independent of the
                                     root metadata editor's explicit native limits. -->
                                <InlineCell
                                    :value="item.title"
                                    :token="item.editToken"
                                    :editable="item.capabilities.showTitleEdit"
                                    :write-admission="item.capabilities.editTitle"
                                    :disabled="blocked"
                                    :label="messages.t('packing.title')"
                                    :save="(value, token) => patch(item, 'title', value, token)"
                                    @editing="editing += $event ? 1 : -1"
                                    @denied="denyInlineEdit"
                                />
                                <InlineCell
                                    :value="item.description"
                                    :token="item.editToken"
                                    :editable="item.capabilities.editDescription"
                                    :disabled="blocked"
                                    :label="messages.t('packing.description')"
                                    :save="(value, token) => patch(item, 'description', value, token)"
                                    @editing="editing += $event ? 1 : -1"
                                />
                                <InlineCell
                                    class="text-center"
                                    :value="item.maxAssignees"
                                    :token="item.editToken"
                                    :editable="item.capabilities.showCapacityEdit"
                                    :write-admission="item.capabilities.editCapacity"
                                    :disabled="blocked"
                                    :label="messages.t('packing.capacity')"
                                    numeric
                                    :save="(value, token) => patch(item, 'maxAssignees', value, token)"
                                    @editing="editing += $event ? 1 : -1"
                                    @denied="denyInlineEdit"
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
                                            :aria-label="messages.t('common.all')"
                                            @change="toggleRequired(item, $event)"
                                        />
                                        <span class="ms-1 small">{{ messages.t('common.all') }}</span>
                                    </div>
                                    <!-- Native admission displays these personal controls
                                         even when the independent write grant is absent.
                                         Preserve that presentation; the server rechecks
                                         ACCESS_VIEW before every assignment command. -->
                                    <EntityAssignmentActions :assigned="item.selfAssigned" :full="isFull(item)" :disabled="blocked"
                                        :everyone="item.requiredByAll ? messages.t('packing.everyone') : undefined"
                                        :assign-label="messages.t('packing.assign')" :remove-label="messages.t('packing.unassign')"
                                        :full-label="messages.t('packing.full')" @toggle="assign(item)" />
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
                </template>
            </div>
            <template v-if="data">
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
