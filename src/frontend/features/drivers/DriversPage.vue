<script setup lang="ts">
import {computed, onBeforeUnmount, reactive, ref, watch} from 'vue';
import {useRoute} from 'vue-router';
import type {components} from '../../../types/api/v1';
import {useDriversApi} from './api';
import {useActionState, usePilot} from '../../app/context';
import {evictQueryFamilies, retireQueryFamily} from '../../app/queryCache';
import {overviewKeys, driversKeys} from '../../app/queryKeys';
import {usePageTitle} from '../../composables/pageTitle';
import {useCommand} from '../../composables/command';
import {useReadRetry, useReadRetryAt} from '../../composables/feedback';
import {useListDetail} from '../../composables/listDetail';
import {useListReorder} from '../../composables/listReorder';
import ActionButton from '../../components/ActionButton.vue';
import InlineCell from '../../components/InlineCell.vue';
import StatusNotice from '../../components/StatusNotice.vue';
import CommandFeedback from '../../components/CommandFeedback.vue';
import LoadingSkeleton from '../../components/LoadingSkeleton.vue';
import DriversSettings from './DriversSettings.vue';
import EntityHeader from '../../components/EntityHeader.vue';
import EntityAssignees from '../../components/EntityAssignees.vue';
import EntityAssignmentActions from '../../components/EntityAssignmentActions.vue';

type Item = components['schemas']['DriversItemView'];
const route = useRoute();
const context = usePilot();
const api = useDriversApi(context);
const {messages} = context;
const listId = computed(() => String(route.params.listId).toLowerCase());
const key = computed(() => driversKeys.detail(context.session.value?.context, listId.value));
const editorOpen = ref(false);
let active = true;
onBeforeUnmount(retirePage);

/** Commands keep their admitted root status after this view retires. Its private
 * query observer must not start a fresh read after denial or component retirement. */
function retirePage(): void {
    active = false;
}
const editing = ref(0);
const freshItem = reactive({description: '', maxAssignees: 1});
const quickAddDirty = computed(
    () => !!freshItem.description || freshItem.maxAssignees !== 1,
);
// Matching lists share read lifetime and recovery; Drivers retains its own
// passenger and ride policy, private draft and denied-query retirement.
const {list, data, denied, refresh: refreshCurrentList} = useListDetail({
    resourceId: listId, queryKey: key,
    resourceFamily: () => driversKeys.resource(context.session.value?.context, listId.value),
    read: api.drivers.bind(api), denied: revokeAccess,
});
const retryAvailable = useReadRetry(() => list.error.value);
const retryAt = useReadRetryAt(() => list.error.value, retryAvailable);
// Native Pug escapes each line and inserts explicit breaks. Keep normal text
// whitespace; pre-wrap would preserve extra spaces/tabs and change native wrapping.
const descriptionLines = computed(() => data.value?.description?.split('\n') ?? []);
const initialLoading = computed(() => !denied.value && !data.value && list.isPending.value);
usePageTitle(() => data.value?.title || messages.value.t('drivers.items'));
const items = computed(() =>
    [...(data.value?.items ?? [])].sort(
        (a, b) => a.position - b.position,
    ),
);
// The shared displayed header owns binary lifetime/recovery. Drivers still
// supplies its admitted version, exact detail key and generated image operation.
const readHeader = api.header.bind(api);

async function refreshAfterCommand(): Promise<void> {
    // A completed write can settle after a concurrent read retires this view's
    // authority. Do not start an automatic private follow-up in that circumstance.
    if (!active || denied.value) return;
    await refreshCurrentList();
}

/** Native Drivers HTTP permission failures use the same "Not allowed" wording.
 * Project only its validated known code; contextual errors and future safe server
 * details keep their own presentation, rejection and uncertainty semantics. */
function driversProblemKey(problem: components['schemas']['Problem']) {
    if (problem.code === 'FORBIDDEN') return 'common.notAllowed';
}

const command = useCommand(refreshAfterCommand, false, {
    // Descendant Settings and inline editors delegate their global guards here.
    // The command owner combines all mounted input into one departure decision.
    dirty: () => quickAddDirty.value,
    unknownMessage: 'draft.leaveUnknown',
    problemKey: driversProblemKey,
});
const blocked = computed(() => command.action.disabled.value);
const readAction = useActionState({eligible: mayRefreshList, pending: () => list.isFetching.value,
    blocked: () => command.recoveryAction.disabled.value});

function mayRefreshList(): boolean { return active && context.mayRead() && retryAvailable.value; }

watch(listId, () => {
    // The route guard has accepted leaving this resource. An unknown command belongs to
    // its previous list and must not block a fresh quick-add or assignment on the new list.
    command.acknowledge();
    editorOpen.value = false;
    reorder.reset();
    Object.assign(freshItem, {description: '', maxAssignees: 1});
});
function revokeAccess(failure: Error): void {
    editorOpen.value = false;
    // This feature owns the containing projections to retire. Cache lifetime is
    // shared, without teaching its generic owner any Drivers or Overview policy.
    const actor = context.capture().context;
    // Preserve observed error-only queries so same-route recovery remains attached.
    // Removing the current Query would leave its disabled observer's Refresh stale.
    void retireQueryFamily(context.queryClient, driversKeys.resource(actor, listId.value), failure);
    void evictQueryFamilies(context.queryClient, [driversKeys.events(actor), overviewKeys.all(actor)]);
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
    const editors = {queryKey: driversKeys.editors(actor, resource)};
    await context.queryClient.cancelQueries(editors);
    context.queryClient.removeQueries(editors);

    if (!context.mayRead() || resource !== listId.value || actor !== context.session.value?.context) return;
    await refresh();
}
/** Preserve the native treatment of historical null capacities (IMP-026). */
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
    field: 'description' | 'maxAssignees',
    value: string,
    token: string,
): Promise<boolean> {
    // The driver name belongs to the offering profile and is never an inline
    // field. Capacity keeps the raw number input so native signed-integer DB
    // conversion is not replaced by JavaScript coercion or rounding.
    const patch =
        field === 'maxAssignees'
            ? {maxAssignees: value}
            : {description: value || null};
    return !!(await command.run((scope) =>
        api.updateItem(listId.value, item.id, patch, token, scope),
        true, false, {presentation: 'inline', success: 'common.updated'},
    ));
}

/** Keep the original browser's local permission feedback without pretending its
 * visible capacity affordance grants the actual metadata write. No HTTP
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
        {presentation: 'inline', success: item.selfAssigned ? 'drivers.itemUnassigned' : 'drivers.itemAssigned'});
}
/** Native item deletion needs deliberate confirmation before its independently authorized command. */
async function removeItem(item: Item): Promise<void> {
    if (window.confirm(messages.value.t('drivers.confirmDeleteItem'))) {
        await command.run((scope) => api.deleteItem(listId.value, item.id, scope), true, false,
            {presentation: 'inline', success: 'drivers.itemDeleted'});
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
                // The readonly native title comes from this captured active
                // profile. Authorship itself remains assigned by the server.
                title: context.session.value?.activeProfile?.name ?? '',
                description: freshItem.description,
                maxAssignees: Number(freshItem.maxAssignees) || 1,
            },
            scope,
        ),
        true,
        true,
        {presentation: 'inline', success: 'common.added'},
    );

    // Confirmation still counts when the follow-up read fails. Unknown delivery
    // yields no result here and must keep the captured creation draft for review.
    if (result) Object.assign(freshItem, {description: '', maxAssignees: 1});
}

/** Read the current list and obtain deliberate acknowledgement of an unknown
 * Quick Add outcome. This releases its retained status without issuing another
 * creation or treating absence from the refreshed list as proof of failure. */
async function reviewUnknownItem(): Promise<void> {
    // A read reveals current rows, but cannot prove which one a lost creation response added.
    // Keep the captured input blocked until the user reviews that list and acknowledges it.
    const reconciled = await refresh();
    if (reconciled && !list.error.value && window.confirm(messages.value.t('drivers.confirmUnknownReviewed'))) {
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
            :title="data?.title || messages.t('drivers.items')"
            icon="bi-car-front"
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
                        <p class="mb-2">{{ messages.t('drivers.reviewUnknownItem') }}</p>
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
                        >{{ messages.t('drivers.items') }}:<span class="badge bg-light text-dark ms-1">{{ data.items.length }}</span
                        ><span class="badge bg-secondary-subtle text-secondary-emphasis ms-1"
                            ><i class="bi bi-box-arrow-up-right me-1" aria-hidden="true"></i
                            >{{ data.counters.open }} {{ messages.t('packing.open') }}</span
                        ><span class="badge bg-danger-subtle text-danger-emphasis ms-1"
                            ><i class="bi bi-slash-circle me-1" aria-hidden="true"></i
                            >{{ data.counters.empty }} {{ messages.t('drivers.empty') }}</span
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
                        class="table table-dark table-bordered table-hover align-middle"
                    >
                        <thead>
                            <tr>
                                <th scope="col" class="text-center w-20">{{ messages.t('drivers.driver') }}</th>
                                <th scope="col" class="text-center w-20">
                                    {{ messages.t('packing.description') }}
                                </th>
                                <th scope="col" class="text-center w-25">{{ messages.t('packing.assignees') }}</th>
                                <!-- Native separates every capacity-heading word
                                     with nonbreaking spaces; keep that same
                                     minimum width in the scrolling mobile table. -->
                                <th scope="col" class="text-center text-nowrap w-10">
                                    {{ messages.t('packing.capacity') }}
                                </th>
                                <th scope="col" class="text-center w-25">
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
                                @dragstart="reorder.begin(item.id, $event)"
                                @dragend="reorder.reset"
                                @dragover.prevent
                                @drop="reorder.drop(item.id, $event)"
                            >
                                <td>{{ item.driverName }}</td>
                                <InlineCell
                                    :value="item.description"
                                    :token="item.editToken"
                                    :editable="item.capabilities.editDescription"
                                    :disabled="blocked"
                                    :label="messages.t('packing.description')"
                                    :save="(value, token) => patch(item, 'description', value, token)"
                                    @editing="editing += $event ? 1 : -1"
                                />
                                <td class="text-center">
                                    <EntityAssignees :assignees="item.assignees" :removable="item.capabilities.removeAssignments"
                                        :disabled="blocked" :remove-label="messages.t('packing.removeAssignment')" @remove="removeAssignment" />
                                </td>
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
                                    <!-- Native admission displays these personal controls
                                         even when the independent write grant is absent.
                                         Preserve that presentation; the server rechecks
                                         ACCESS_VIEW before every assignment command. -->
                                    <EntityAssignmentActions :assigned="item.selfAssigned" :full="isFull(item)" :disabled="blocked"
                                        :assign-label="messages.t('drivers.take')" :remove-label="messages.t('drivers.remove')"
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
                            <small class="text-muted fst-italic ms-2">{{
                                messages.t('packing.fillAllFields')
                            }}</small>
                        </div>
                        <form class="card-body row gy-2 gx-2 align-items-end" @submit.prevent="addItem">
                            <div class="col-md-4">
                                <label class="form-label mb-1" for="quick-title">{{ messages.t('drivers.driver') }}</label>
                                <input id="quick-title" :value="context.session.value?.activeProfile?.name ?? ''"
                                    class="form-control text-bg-dark text-secondary" readonly required :disabled="blocked" />
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
    <DriversSettings
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
