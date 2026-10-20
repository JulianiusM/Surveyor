<script setup lang="ts">
import {computed, onBeforeUnmount, ref, shallowRef, watch} from 'vue';
import {useRoute} from 'vue-router';
import type {components} from '../../../types/api/v1';
import type {ActivityAssignmentReview} from '../../../types/FrontendActivityTypes';
import {usePilot} from '../../app/context';
import {activityKeys, overviewKeys} from '../../app/queryKeys';
import {evictQueryFamilies, retireQueryFamily} from '../../app/queryCache';
import {ApiFailure} from '../../app/transport';
import {useListCommands, useListDetail} from '../../composables/listDetail';
import {usePageTitle} from '../../composables/pageTitle';
import {useActivityApi} from './api';
import {activitySlotLabel} from './presentation';
import ActivitySchedule from './ActivitySchedule.vue';
import ActivityParticipants from './ActivityParticipants.vue';
import ActivityTextFields from './ActivityTextFields.vue';
import ActivitySlotEditor from './ActivitySlotEditor.vue';
import ActivityRoleAssignments from './ActivityRoleAssignments.vue';
import ActivityWarnings from './ActivityWarnings.vue';
import ActivitySettings from './ActivitySettings.vue';
import ActivityRequirements from './ActivityRequirements.vue';
import ActivityRecommendations from './ActivityRecommendations.vue';
import EntityHeader from '../../components/EntityHeader.vue';
import EntityDescription from '../../components/EntityDescription.vue';
import EntityDetailReadState from '../../components/EntityDetailReadState.vue';
import EntityListToolbar from '../../components/EntityListToolbar.vue';
import CommandFeedback from '../../components/CommandFeedback.vue';
import StatusNotice from '../../components/StatusNotice.vue';
import AppTabList from '../../components/AppTabList.vue';

// A single detail/read/command owner covers the schedule. Specialized editors retain their
// own drafts beneath its departure protection; ordinary refresh never resets them.
const route = useRoute();
const context = usePilot();
const {messages} = context;
const api = useActivityApi(context);
const planId = computed(() => String(route.params.planId).toLowerCase());
const key = computed(() => activityKeys.detail(context.session.value?.context, planId.value));
const tab = ref('schedule');
const settingsOpen = ref(false);
const editor = ref<{id?: string; day: string} | null>(null);
const roleSlotId = ref<string | null>(null);
const review = shallowRef<ActivityAssignmentReview | null>(null);
const reviewOpen = ref(false);
const previewPending = ref(false);
const requirementMode = ref<components['schemas']['ActivityView']['assignmentMode'] | null>(null);
let previewAbort: AbortController | undefined;
let active = true;
onBeforeUnmount(() => { active = false; previewAbort?.abort(); });
const {list, data, denied, refresh: readDetail, isActive} = useListDetail({resourceId: planId, queryKey: key,
    resourceFamily: () => activityKeys.resource(context.session.value?.context, planId.value), read: api.activity.bind(api), denied: revokeAccess});
const {command, blocked: commandBlocked, readAction, retryAt, refresh, retireSettingsAccess, denyInlineEdit} = useListCommands({active: isActive, denied: () => denied.value,
    reading: () => list.isFetching.value, error: () => list.error.value, refresh: readFresh},
{dirty: () => false, busy: () => previewPending.value, unknownMessage: 'draft.leaveUnknown'});
const blocked = computed(() => commandBlocked.value || previewPending.value);
const editingSlot = computed(() => data.value?.slots.find(slot => slot.id === editor.value?.id));
const tabs = computed(() => [
    {key: 'schedule', label: messages.value.t('activity.schedule'), id: 'activity-schedule-tab', controls: 'tab-schedule', icon: 'bi-calendar3'},
    ...(data.value?.participants.length ? [
        {key: 'participants', label: messages.value.t('activity.participants'), id: 'activity-participants-tab', controls: 'tab-participants', icon: 'bi-people-fill'},
    ] : []),
    ...(data.value?.capabilities.rulesWorkspace ? [
        {key: 'rules', label: messages.value.t('activity.rules'), id: 'activity-rules-tab', controls: 'tab-rules', icon: 'bi-sliders'},
    ] : []),
]);
const roleSlot = computed(() => data.value?.slots.find(slot => slot.id === roleSlotId.value));
const warningBlocked = computed(() => review.value?.preview.warnings.some(warning => warning.confirmable === false) ?? false);
const readHeader = api.header.bind(api);
usePageTitle(() => messages.value.t('activity.documentTitle', {title: data.value?.title ?? messages.value.t('app.activity')}), true);

/** Basic commands refresh the admitted detail and its requirement dependency.
 * Recommendation snapshots react separately to the same detail value change. */
async function readFresh(): Promise<void> {
    const previous = data.value;
    await readDetail();
    // Pure requirement recalculation follows changed assignments/slots/dates.
    // Its editor retains dirty values; ordinary polling cannot run maintenance.
    if (data.value !== previous && data.value?.capabilities.manageRequirements)
        void context.queryClient.invalidateQueries({queryKey: activityKeys.requirements(context.session.value?.context, planId.value), exact: true});
}

/** Denial retires private server snapshots and pending warning authority together.
 * Existing command leases still settle under their captured actor without replay. */
function revokeAccess(failure: Error): void {
    settingsOpen.value = false;
    editor.value = null;
    roleSlotId.value = null;
    review.value = null;
    reviewOpen.value = false;
    previewAbort?.abort();
    const actor = context.capture().context;
    void retireQueryFamily(context.queryClient, activityKeys.resource(actor, planId.value), failure);
    void evictQueryFamilies(context.queryClient, [activityKeys.events(actor), overviewKeys.all(actor)]);
}
watch([planId, context.epoch], () => {
    command.acknowledge();
    settingsOpen.value = false;
    editor.value = null;
    roleSlotId.value = null;
    review.value = null;
    reviewOpen.value = false;
    tab.value = 'schedule';
    requirementMode.value = null;
    previewAbort?.abort();
});
watch(tabs, reconcileSelectedTab);

/** Preserve a selected panel only while the current projection still admits it.
 * Empty/redacted participant data and withdrawn Rules access both fall back to
 * Schedule without replacing its mounted controls or unrelated feature drafts. */
function reconcileSelectedTab(): void {
    // The same tab list drives the shared controls and this feature's selection.
    // A valid local choice survives refreshes, including newly available panels.
    if (!tabs.value.some(candidate => candidate.key === tab.value)) tab.value = 'schedule';
}

watch(() => [!!(data.value?.currentEventId && data.value.capabilities.rulesWorkspace && data.value.capabilities.manageRequirements),
    !!(data.value?.currentEventId && data.value.capabilities.rulesWorkspace && data.value.capabilities.manageRecommendations)],
    /** Release private snapshots when a fresh detail receipt withdraws advanced admission. */
    function retireAdvancedCapabilities([requirements, recommendations], [previousRequirements, previousRecommendations]) {
        // Unlinking can retain management grants while releasing Event participant
        // context. Either loss retires that private family without denying the schedule.
        const actor = context.session.value?.context;
        const families: (readonly unknown[])[] = [];
        if (previousRequirements && requirements === false) {
            requirementMode.value = null;
            families.push(activityKeys.requirements(actor, planId.value));
        }
        if (previousRecommendations && recommendations === false) families.push(activityKeys.recommendations(actor, planId.value));
        if (families.length) void evictQueryFamilies(context.queryClient, families);
    });

/** Advanced commands retain their own confirmed outcomes. The detail query owns
 * any failed follow-up or denial, so event delivery must not reject the command. */
async function advancedChanged(): Promise<void> {
    try {
        // Refresh only the schedule/participant projection. Recommendation
        // maintenance remains with its explicit native-equivalent lifecycle.
        await readFresh();
    } catch {
        // The existing detail state presents the failure and retires denied data.
    }
}

/** Losing settings authority does not imply loss of detail/participation access. */
async function settingsAccessLost(): Promise<void> {
    settingsOpen.value = false;
    const actor = context.session.value?.context;
    await retireSettingsAccess({resourceId: planId.value, currentResource: () => planId.value,
        families: [activityKeys.editors(actor, planId.value)]});
}
function openEditor(day: string, id?: string): void { if (!blocked.value) editor.value = {day, id}; }
/** The shared inline owner supplies its captured value/token; persist just that
 * field so sibling draft values never become incidental updates. */
async function patch(slot: components['schemas']['ActivitySlotView'], field: 'title' | 'description' | 'maxAssignees', value: string, token: string): Promise<boolean> {
    return !!await command.run(scope => api.updateSlot(planId.value, slot.id, {[field]: value}, token, scope), true, false,
        {success: 'common.updated'});
}
/** Submit one captured day-order gesture without optimistic DOM persistence. */
async function reorder(order: components['schemas']['ActivityOrderInput']['order'], token: string): Promise<unknown> {
    return command.run(scope => api.reorder(planId.value, order, token, scope), true, false,
        {success: 'common.orderSaved'});
}
/** Confirm the native destructive slot action before its independent server check. */
async function removeSlot(slot: components['schemas']['ActivitySlotView']): Promise<void> {
    // Existing controller deletion retains its own assignment cleanup semantics.
    if (!blocked.value && slot.capabilities.remove && window.confirm(messages.value.t('activity.deleteSlot')))
        await command.run(scope => api.deleteSlot(planId.value, slot.id, scope), true, false, {success: 'common.removed'});
}
/** Organizer removal remains immediate and operates on an admitted assignment ID. */
async function removeAssignment(id: string): Promise<void> {
    if (!blocked.value) await command.run(scope => api.removeAssignment(planId.value, id, scope), true, false,
        {success: 'common.removed'});
}

/** Read fresh warnings before Join or an available named role. Native role review
 * concerns the role's unoccupied position even when the actor already joined. */
async function assign(slot: components['schemas']['ActivitySlotView'], assigned: boolean, role?: string): Promise<void> {
    if (blocked.value) return;
    if (!assigned) {
        await command.run(scope => api.assign(planId.value, slot.id, {assigned, ...(role ? {role} : {})}, scope), true, false,
            {success: 'common.updated'});
        return;
    }
    const scope = context.capture();
    const resource = planId.value;
    previewAbort?.abort();
    const controller = new AbortController();
    previewAbort = controller;
    previewPending.value = true;
    try {
        const preview = await api.warnings(resource, slot.id, scope, controller.signal);
        // A canceled/retired read cannot attach warnings or a token to another
        // actor/plan. Cancellation preserves the previous review without a write.
        if (!active || controller.signal.aborted || !context.isCurrent(scope) || resource !== planId.value || denied.value) return;
        review.value = {slotId: slot.id, title: activitySlotLabel(slot, messages.value.t), assigned, role, preview};
        if (preview.warnings.length) reviewOpen.value = true;
        else {
            previewPending.value = false;
            await confirmAssignment();
        }
    } catch (failure) {
        if (active && context.isCurrent(scope) && !controller.signal.aborted)
            command.setError(failure instanceof ApiFailure ? failure : 'state.loadFailed');
    } finally {
        if (previewAbort === controller) previewPending.value = false;
    }
}

/** A confirmation consumes exactly the reviewed intent/digest once. Rejection
 * closes it; the next deliberate Join performs a new read and fresh review. */
async function confirmAssignment(): Promise<void> {
    const intent = review.value;
    if (!intent || warningBlocked.value || blocked.value) return;
    reviewOpen.value = false;
    const input = {assigned: intent.assigned, ...(intent.role ? {role: intent.role} : {}),
        ...(intent.preview.overlapConfirmation ? {overlapConfirmation: intent.preview.overlapConfirmation} : {})};
    await command.run(scope => api.assign(planId.value, intent.slotId, input, scope), true, false,
        {success: 'common.updated'});
}
</script>

<template>
    <section class="card bg-dark text-white mb-3" :aria-busy="!!data && list.isFetching.value">
        <EntityHeader
            :resource-id="planId"
            :title="data?.title || messages.t('app.activity')"
            icon="bi-calendar-check"
            :image-version="data?.headerVersion"
            :image-query-key="key"
            :read-image="readHeader"
            :image-enabled="!!data && !denied"
            :parent-url="data?.currentEventUrl"
            :settings-available="!!data?.capabilities.manageSettings"
            :settings-disabled="blocked"
            @settings="settingsOpen = true"
        />
        <div class="card-body">
            <CommandFeedback :feedback="command.feedback" />
            <EntityDetailReadState
                :denied="denied"
                :error="list.error.value"
                :has-data="!!data"
                :pending="list.isPending.value"
                :last-updated-at="list.data.value ? list.dataUpdatedAt.value : undefined"
                :retry-at="retryAt"
                :skeleton="route.meta.loadingSkeleton"
            />
            <template v-if="data">
                <StatusNotice v-if="data.archived || data.inheritedArchived" kind="info">{{ messages.t('packing.archived') }}</StatusNotice>
                <EntityDescription :description="data.description" separator />
                <ActivityTextFields
                    :key="planId"
                    :plan-id="planId"
                    :fields="data.textFields"
                    :manage="data.capabilities.manageRequirements"
                    :disabled="blocked"
                    :refresh="readFresh"
                />
                <AppTabList v-model="tab" :tabs="tabs" variant="tabs" class="mb-3" />
                <div v-show="tab === 'schedule'" id="tab-schedule" role="tabpanel" aria-labelledby="activity-schedule-tab">
                    <ActivitySchedule
                        :key="planId"
                        :view="data"
                        :disabled="blocked"
                        :patch="patch"
                        :reorder="reorder"
                        @edit="openEditor($event.day, $event.id)"
                        @add="openEditor($event)"
                        @remove="removeSlot"
                        @assign="assign"
                        @denied="denyInlineEdit"
                        @remove-assignment="removeAssignment"
                        @roles="roleSlotId = $event.id"
                    />
                </div>
                <div v-if="data.participants.length" v-show="tab === 'participants'" id="tab-participants"
                    role="tabpanel" aria-labelledby="activity-participants-tab">
                    <ActivityParticipants
                        :key="planId + '-participants'"
                        :participants="data.participants"
                        :assignment-mode="data.assignmentMode"
                    />
                </div>
                <!-- Keep admitted advanced workspaces mounted across local tabs.
                Native initializes these on page entry; ordinary detail polling must
                never repeat recommendation maintenance or replace their drafts. -->
                <div v-if="data.capabilities.rulesWorkspace" v-show="tab === 'rules'" id="tab-rules" role="tabpanel" aria-labelledby="activity-rules-tab">
                    <h4 class="mb-3">{{ messages.t('activity.rules') }}</h4>
                    <p class="small text-secondary mb-4">{{ messages.t('activity.rulesDescription') }}</p>
                    <ActivityRequirements v-if="data.currentEventId && data.capabilities.manageRequirements"
                        :key="planId + ':requirements:' + context.epoch.value"
                        :plan-id="planId" :disabled="blocked" @mode="requirementMode = $event"
                        @changed="advancedChanged" @denied="advancedChanged" />
                    <ActivityRecommendations v-if="data.currentEventId && data.capabilities.manageRecommendations"
                        :key="planId + ':recommendations:' + context.epoch.value"
                        :plan-id="planId" :view="data" :assignment-mode="requirementMode ?? data.assignmentMode" :disabled="blocked"
                        @changed="advancedChanged" @denied="advancedChanged" />
                </div>
                <EntityListToolbar :refresh-label="messages.t('common.refresh')" :state="readAction" @refresh="refresh" />
            </template>
        </div>
    </section>
    <ActivitySettings
        v-if="settingsOpen && !denied"
        :key="planId"
        :plan-id="planId"
        :plan-title="data?.title"
        :metadata-available="!!(data?.capabilities.editTitle || data?.capabilities.editDescription || data?.capabilities.editDates)"
        @close="settingsOpen = false"
        @saved="refresh"
        @access-lost="settingsAccessLost"
    />
    <ActivitySlotEditor
        v-if="editor && data"
        :key="planId + ':' + (editor.id ?? editor.day)"
        :plan-id="planId"
        :day="editor.day"
        :slot="editingSlot"
        :all-roles="data.allRoles"
        :role-creation-admission="data.capabilities.roleCreationAdmission"
        :disabled="blocked || (!editor.id && !data.capabilities.addSlot)"
        :refresh="readFresh"
        @close="editor = null"
    />
    <ActivityRoleAssignments
        v-if="roleSlot"
        :key="roleSlot.id"
        :plan-id="planId"
        :slot="roleSlot"
        :all-roles="data?.allRoles ?? []"
        :refresh="readFresh"
        @close="roleSlotId = null"
    />
    <ActivityWarnings
        :open="reviewOpen"
        :title="review?.title ?? ''"
        :warnings="review?.preview.warnings ?? []"
        :slots="data?.slots ?? []"
        :pending="command.pending.value"
        :blocked="warningBlocked"
        @close="reviewOpen = false"
        @confirm="confirmAssignment"
    />
</template>
