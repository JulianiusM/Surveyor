<script setup lang="ts">
import {computed, reactive, ref, watch} from 'vue';
import {useRoute} from 'vue-router';
import type {components} from '../../../types/api/v1';
import type {FrontendListPendingControl, FrontendListQuickAddValues} from '../../../types/FrontendListTypes';
import {useDriversApi} from './api';
import {useFrontend} from '../../app/context';
import {evictQueryFamilies, retireQueryFamily} from '../../app/queryCache';
import {overviewKeys, driversKeys} from '../../app/queryKeys';
import {usePageTitle} from '../../composables/pageTitle';
import {listProblemKey, useListCommands, useListDetail} from '../../composables/listDetail';
import {useListReorder} from '../../composables/listReorder';
import {useListActions} from '../../composables/listActions';
import ActionButton from '../../components/ActionButton.vue';
import InlineCell from '../../components/InlineCell.vue';
import StatusNotice from '../../components/StatusNotice.vue';
import CommandFeedback from '../../components/CommandFeedback.vue';
import EntityDetailReadState from '../../components/EntityDetailReadState.vue';
import DriversSettings from './DriversSettings.vue';
import EntityHeader from '../../components/EntityHeader.vue';
import EntityDescription from '../../components/EntityDescription.vue';
import EntityAssignees from '../../components/EntityAssignees.vue';
import EntityAssignmentActions from '../../components/EntityAssignmentActions.vue';
import EntityQuickAdd from '../../components/EntityQuickAdd.vue';
import EntityListCounters from '../../components/EntityListCounters.vue';
import RefreshButton from '../../components/RefreshButton.vue';
import FormField from '../../components/FormField.vue';

type Item = components['schemas']['DriversItemView'];
const route = useRoute();
const context = useFrontend();
const api = useDriversApi(context);
const {messages} = context;
const listId = computed(() => String(route.params.listId).toLowerCase());
const key = computed(() => driversKeys.detail(context.session.value?.context, listId.value));
const editorOpen = ref(false);
const editing = ref(0);
const freshItem = reactive<FrontendListQuickAddValues>({description: '', maxAssignees: 1});
// Presentation identity only: the shared command remains the sole authority for
// pending/unknown work. Sibling row controls must not claim another action's focus.
const pendingControl = ref<FrontendListPendingControl | null>(null);
const quickAddDirty = computed(
    () => !!freshItem.description || freshItem.maxAssignees !== 1,
);
// Matching lists share read lifetime and recovery; Drivers retains its own
// passenger and ride policy, private draft and denied-query retirement.
const {list, data, denied, refresh: refreshCurrentList, isActive} = useListDetail({
    resourceId: listId, queryKey: key,
    resourceFamily: () => driversKeys.resource(context.session.value?.context, listId.value),
    read: api.drivers.bind(api), denied: revokeAccess,
});
usePageTitle(() => data.value?.title || messages.value.t('drivers.items'));
const items = computed(() =>
    [...(data.value?.items ?? [])].sort(
        (a, b) => a.position - b.position,
    ),
);
// The shared displayed header owns binary lifetime/recovery. Drivers still
// supplies its admitted version, exact detail key and generated image operation.
const readHeader = api.header.bind(api);

const {command, blocked, readAction, retryAt, refresh, retireSettingsAccess, reviewUnknownCreation, denyInlineEdit} = useListCommands({
    active: isActive, denied: () => denied.value, reading: () => list.isFetching.value,
    error: () => list.error.value, refresh: refreshCurrentList,
}, {
    // Descendant Settings and inline editors delegate their global guards here.
    // The command owner combines all mounted input into one departure decision.
    dirty: () => quickAddDirty.value,
    unknownMessage: 'draft.leaveUnknown',
    problemKey: listProblemKey,
});

const {assign, removeItem, removeAssignment, addItem} = useListActions({
    command, pendingControl,
    assign: (itemId, assigned, scope) => api.assign(listId.value, itemId, assigned, scope),
    removeItem: (itemId, scope) => api.deleteItem(listId.value, itemId, scope),
    removeAssignment: (assignmentId, scope) => api.removeAssignment(listId.value, assignmentId, scope),
    addItem(scope) {
        // The offering profile supplies its readonly title. Keep the raw
        // description and optional blank-capacity default in this feature collector.
        return api.addItem(listId.value, {title: context.session.value?.activeProfile?.name ?? '',
            description: freshItem.description, maxAssignees: Number(freshItem.maxAssignees) || 1}, scope);
    },
    resetItem() { Object.assign(freshItem, {description: '', maxAssignees: 1}); },
    messages: {assigned: 'drivers.itemAssigned', unassigned: 'drivers.itemUnassigned',
        confirmDelete: 'drivers.confirmDeleteItem', deleted: 'drivers.itemDeleted'},
});

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
    await retireSettingsAccess({resourceId: listId.value, currentResource: () => listId.value,
        families: [driversKeys.editors(actor, listId.value)]});
}
/** Preserve the treatment of historical null capacities (IMP-026). */
function isFull(item: Item): boolean {
    return item.assignedCount >= (item.maxAssignees ?? 0);
}
/** Adapt one reviewed inline field without replacing unrelated item values.
 * The editor supplies its captured token; raw capacity input is deliberately
 * left to the shared server/SQL boundary instead of coerced by this component. */
async function patch(
    item: Item,
    field: 'description' | 'maxAssignees',
    value: string,
    token: string,
): Promise<boolean> {
    // The driver name belongs to the offering profile and is never an inline
    // field. Capacity keeps the raw number input so signed-integer DB
    // conversion is not replaced by JavaScript coercion or rounding.
    const patch =
        field === 'maxAssignees'
            ? {maxAssignees: value}
            : {description: value || null};
    return !!(await command.run((scope) =>
        api.updateItem(listId.value, item.id, patch, token, scope),
        true, false, {success: 'common.updated'},
    ));
}


const reorder = useListReorder({
    available: () => !!data.value?.capabilities.reorder && !blocked.value && !editing.value,
    ids: () => items.value.map(item => item.id), token: () => data.value?.orderToken,
    submit: (ids, token) => command.run(scope => api.reorder(listId.value, ids, token, scope), true, false,
        {success: 'common.orderSaved'}),
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
        >
            <template #actions><RefreshButton :state="readAction" @refresh="refresh" /></template>
        </EntityHeader>
        <div class="card-body">
            <!-- Item/assignment commands present transient feedback in the
                 shared page alert host; durable reconciliation stays beside the list. -->
            <CommandFeedback :feedback="command.feedback" :disabled="command.pending.value || command.recovering.value"
                :creation-review="{required: command.reviewRequired.value, message: 'drivers.reviewUnknownItem', state: readAction, paragraphClass: 'mb-2'}"
                @review-creation="reviewUnknownCreation('drivers.confirmUnknownReviewed')" />
            <EntityDetailReadState :denied="denied" :error="list.error.value" :has-data="!!data" :pending="list.isPending.value" :refreshing="list.isFetching.value"
                :last-updated-at="list.data.value ? list.dataUpdatedAt.value : undefined" :retry-at="retryAt" :skeleton="route.meta.loadingSkeleton" />
            <template v-if="data">
                <StatusNotice v-if="data.archived || data.inheritedArchived" kind="info">{{
                    messages.t('packing.archived')
                }}</StatusNotice>
                <EntityDescription :description="data.description" separator />
                <EntityListCounters :participants="data.counters.participants" :items="data.items.length"
                    :open="data.counters.open" :empty="data.counters.empty" :participants-label="messages.t('packing.participants')"
                    :items-label="messages.t('drivers.items')" :open-label="messages.t('packing.open')" :empty-label="messages.t('drivers.empty')" />
            </template>
            <!-- The scrolling container retains its editing hint and table;
                 Refresh stays in the entity heading independently of data. -->
            <div class="table-responsive">
                <small class="d-block mb-1 text-info fst-italic fw-light">{{ messages.t('packing.inlineHint') }}</small>
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
                                <!-- The heading separates every capacity word
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
                                :class="reorder.classes(item.id)"
                                @dragstart="reorder.begin(item.id, $event)"
                                @dragend="reorder.reset"
                                @dragover="reorder.over(item.id, $event)"
                                @dragleave="reorder.leave(item.id, $event)"
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
                                        :disabled="blocked" :pending-assignment-id="command.pending.value && pendingControl?.kind === 'assignment' ? pendingControl.id : null"
                                        :remove-label="messages.t('packing.removeAssignment')" @remove="removeAssignment" />
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
                                    <!-- Matching list controls share method availability;
                                         server admission remains authoritative on command. -->
                                    <EntityAssignmentActions :available="data.capabilities.selfAssign"
                                        :assigned="item.selfAssigned" :full="isFull(item)" :disabled="blocked"
                                        :pending="command.pending.value && pendingControl?.kind === 'assign' && pendingControl.id === item.id"
                                        :assign-label="messages.t('drivers.take')" :remove-label="messages.t('drivers.remove')"
                                        :full-label="messages.t('packing.full')" @toggle="assign(item)" />
                                    <ActionButton
                                        v-if="item.capabilities.removeItem"
                                        class="btn-sm ms-1"
                                        variant="outline-danger"
                                        :pending="command.pending.value && pendingControl?.kind === 'delete' && pendingControl.id === item.id"
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
                    <EntityQuickAdd v-model:description="freshItem.description" v-model:capacity="freshItem.maxAssignees"
                        :pending="command.pending.value && pendingControl?.kind === 'add'"
                        :disabled="blocked" hint-class="text-muted" @submit="addItem">
                        <FormField id="quick-title" class="col-md-4" :name="null"
                            :model-value="context.session.value?.activeProfile?.name ?? ''" :label="messages.t('drivers.driver')"
                            :pending="command.pending.value && pendingControl?.kind === 'add'"
                            read-only control-class="text-secondary" required :required-marker="false" :disabled="blocked" />
                    </EntityQuickAdd>
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
