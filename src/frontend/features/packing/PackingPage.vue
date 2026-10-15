<script setup lang="ts">
import {computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch} from 'vue';
import {useRoute} from 'vue-router';
import {useQuery} from '@tanstack/vue-query';
import type {components} from '../../../types/api/v1';
import type {PilotRead} from '../../../types/FrontendPilotUiTypes';
import type {QueryFunctionContext} from '@tanstack/vue-query';
import {usePackingApi} from './api';
import {useActionState, usePilot, refreshInterval} from '../../app/context';
import {isReadDenial, ObsoleteRequestError} from '../../app/transport';
import {evictQueryFamilies, observeQueryReads, refetchFreshQuery, retireQueryFamily, useQueryAdmission} from '../../app/queryCache';
import {belongsToQueryFamily, overviewKeys, packingKeys} from '../../app/queryKeys';
import {usePageTitle} from '../../composables/pageTitle';
import {readPacked, writePacked} from './packed';
import {useCommand} from '../../composables/command';
import {useAuthorizedImage} from '../../composables/authorizedImage';
import {useReadRetry, useReadRetryAt} from '../../composables/feedback';
import ActionButton from '../../components/ActionButton.vue';
import InlineCell from '../../components/InlineCell.vue';
import StatusNotice from '../../components/StatusNotice.vue';
import CommandFeedback from '../../components/CommandFeedback.vue';
import LoadingSkeleton from '../../components/LoadingSkeleton.vue';
import PackingSettings from './PackingSettings.vue';

type Item = components['schemas']['PackingItemView'];
type ListRead = PilotRead<components['schemas']['PackingListView']>;
const route = useRoute();
const context = usePilot();
// Personal failure fallback still belongs to this mounted actor, even though its
// successfully persisted native keys deliberately remain independent of profile.
const packedScope = context.capture();
const api = usePackingApi(context);
const {messages} = context;
const listId = computed(() => String(route.params.listId).toLowerCase());
const key = computed(() => packingKeys.detail(context.session.value?.context, listId.value));
const jitter = context.browser ? Math.round(Math.random() * 3000) : 0;
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
const accessRevoked = ref(false);
const freshItem = reactive({title: '', description: '', maxAssignees: 1});
const quickAddDirty = computed(
    () => !!freshItem.title || !!freshItem.description || freshItem.maxAssignees !== 1,
);
const dragged = ref<{id: string; token: string; ids: string[]} | null>(null);
// A language refresh shares the same machine-state cache and must not unmount focused drafts.
// Keep a previous read only within this actor/resource family, including a failed refresh.
const previousList = shallowRef<{
    query: Parameters<typeof belongsToQueryFamily>[0];
    result: ListRead;
} | null>(null);
const readAdmission = useQueryAdmission(context, key,
    computed(() => context.hydrated.value && context.visible.value && !accessRevoked.value));
const list = useQuery({
    queryKey: key,
    ...readAdmission,
    queryFn: readList,
    refetchInterval: (query) =>
        context.mayRead() && context.visible.value
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

/** A denial suspends ordinary polling, but explicit recovery still performs a real
 * current read. Only that admitted response can restore the protected projection;
 * neither an old cache hit nor a no-op command reconciliation grants authority. */
async function readList({signal, queryKey}: QueryFunctionContext<readonly unknown[]>): Promise<ListRead> {
    const scope = context.capture();
    const resource = listId.value;
    const result = await api.packing(resource, scope, signal,
        context.queryClient.getQueryData<ListRead>(queryKey));
    if (!active || signal.aborted || !context.isCurrent(scope) || resource !== listId.value)
        throw new ObsoleteRequestError();
    accessRevoked.value = false;
    return result;
}
const retryAvailable = useReadRetry(() => list.error.value);
const retryAt = useReadRetryAt(() => list.error.value, retryAvailable);
const denied = computed(
    () =>
        accessRevoked.value ||
        isReadDenial(list.error.value),
);
// A temporary read failure may retain only this actor/resource's last confirmed
// list. A validated denial closes that fallback immediately; a warm cache entry
// from another resource family never supplies display or command authority.
const data = computed(() => {
    if (denied.value) return null;
    if (list.data.value) return list.data.value.data;
    const previous = previousList.value;
    return previous && belongsToQueryFamily(previous.query,
        packingKeys.resource(context.session.value?.context, listId.value)) ? previous.result.data : undefined;
});
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
const headerImage = useAuthorizedImage(
    listId,
    computed(() => data.value?.headerVersion),
    api.header.bind(api),
);
const header = headerImage.source;
// A same-version JSON response may retain its object through structural sharing.
// Observe actual success so manual Refresh and polling can recover a missing
// image. Canceled/idle reads and manual aliases are no new read receipt.
const stopListReads = observeQueryReads<ListRead>(context.queryClient, () => key.value, recoverHeaderAfterRead);
onBeforeUnmount(stopListReads);

function recoverHeaderAfterRead(): void {
    if (active && data.value && !list.isFetching.value && !list.error.value) void headerImage.refresh();
}

async function refreshAfterCommand(): Promise<void> {
    // A completed write can settle after a concurrent read retires this view's
    // authority. Do not start an automatic private follow-up in that circumstance.
    if (!active || denied.value) return;
    await refreshCurrentList();
}

/** Explicit Refresh is a fresh authority read even while ordinary polling is
 * suspended by denial. The shared command owner retains any unknown status until
 * this actual GET succeeds; its normal post-write callback remains narrower. */
async function refreshCurrentList(): Promise<void> {
    if (!active || !context.mayRead()) throw new ObsoleteRequestError();
    const scope = context.capture();
    const resource = listId.value;
    await refetchFreshQuery<ListRead>(context.queryClient, key.value, refetchList, mayRead);

    function mayRead(): boolean {
        return active && resource === listId.value && context.mayRead(scope);
    }
}

function refetchList(): Promise<unknown> {
    return list.refetch({throwOnError: true});
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
    accessRevoked.value = false;
    previousList.value = null;
    dragged.value = null;
    Object.assign(freshItem, {title: '', description: '', maxAssignees: 1});
    loadPacked();
});
function revokeAccess(failure: Error): void {
    accessRevoked.value = true;
    previousList.value = null;
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
watch(list.error, (failure) => {
    if (isReadDenial(failure)) revokeAccess(failure);
}, {flush: 'sync'});
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

/** Begin one gesture only when current page state admits reordering. Capture
 * the row membership and order token together so a later poll cannot replace
 * the reviewed baseline consumed by drop. Server authorization remains separate. */
function beginDrag(item: Item, event: DragEvent): void {
    if (!data.value?.capabilities.reorder || blocked.value || editing.value) {
        event.preventDefault();
        return;
    }

    // Freeze the gesture's original row set and comparison evidence before the
    // browser starts moving it; the transfer payload identifies only this item.
    dragged.value = {
        id: item.id,
        token: data.value.orderToken,
        ids: items.value.map((current) => current.id),
    };
    event.dataTransfer?.setData('text/plain', item.id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
}
/** Submit the drag-start membership and token, even when polling updates the
 * displayed rows during the gesture. The server compares that reviewed order;
 * this one drop consumes the gesture and cannot silently adopt a newer baseline. */
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
    await command.run((scope) => api.reorder(listId.value, ids, original.token, scope), true, false,
        {presentation: 'inline', success: 'common.orderSaved'});
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
            <!-- Follow the fixed native flex layout, including its empty desktop
                 parent track. Migration must not center/reflow the native header
                 by changing the reference template or its shared stylesheet. -->
            <div class="p-3 d-flex flex-column flex-md-row align-items-md-center justify-content-between gap-3">
                <div v-if="data?.currentEventUrl" class="btn-group d-md-inline d-none">
                    <a class="btn btn-outline-light" :href="data.currentEventUrl">
                        <i class="bi bi-arrow-left-circle me-1" aria-hidden="true"></i
                        >{{ messages.t('packing.goToEvent') }}
                    </a>
                </div>
                <div v-else class="d-none d-md-inline"></div>
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
            <!-- Native item/assignment commands present transient feedback in the
                 shared page alert host; durable reconciliation stays beside the list. -->
            <CommandFeedback :feedback="command.feedback" :disabled="command.pending.value || command.recovering.value">
                <template #notice>
                    <template v-if="command.uncertain.value && quickAddDirty">
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
            <LoadingSkeleton v-if="initialLoading" variant="table" :rows="4" />
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
                                @dragstart="beginDrag(item, $event)"
                                @dragend="dragged = null"
                                @dragover.prevent
                                @drop="drop(item, $event)"
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
                                    <template v-if="item.selfAssigned">
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
                                        v-else-if="!isFull(item)"
                                        class="btn-sm"
                                        variant="outline-success"
                                        :disabled="blocked"
                                        @click="assign(item)"
                                        >{{ messages.t('packing.assign') }}</ActionButton
                                    >
                                    <span v-else class="badge bg-secondary">{{
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
