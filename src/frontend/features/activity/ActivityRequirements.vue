<script setup lang="ts">
import {computed, ref, shallowRef, watch} from 'vue';
import type {ActivityRequirementConfiguration, ActivityRequirementDraft} from '../../../types/FrontendActivityRequirementTypes';
import {calculateBaselineRequirementForPlan, hasValidRequirementValues} from '../../../modules/activity/requirements';
import {usePilot} from '../../app/context';
import {activityKeys} from '../../app/queryKeys';
import {retireQueryFamily} from '../../app/queryCache';
import {useListCommands, useListDetail} from '../../composables/listDetail';
import {useActivityApi} from './api';
import {activityDateLabel, activityParticipantName} from './presentation';
import {analyzeRequirementDraft, createRequirementDraft, requirementCoverage, requirementInput, requirementAnalysisInput} from './requirements';
import ActivityParticipants from './ActivityParticipants.vue';
import ActionButton from '../../components/ActionButton.vue';
import FormField from '../../components/FormField.vue';
import CommandFeedback from '../../components/CommandFeedback.vue';
import EntityDetailReadState from '../../components/EntityDetailReadState.vue';
import StatusNotice from '../../components/StatusNotice.vue';

// Requirements own this independent unsaved form. Background reads may refresh
// clean controls, but never replace a dirty draft or its calculation context.
const props = defineProps<{planId: string; disabled?: boolean}>();
const emit = defineEmits<{changed: []; denied: []; mode: [mode: ActivityRequirementDraft['assignmentMode'] | null]}>();
const context = usePilot();
const {messages} = context;
const api = useActivityApi(context);
const planId = computed(() => props.planId);
const key = computed(() => activityKeys.requirements(context.session.value?.context, props.planId));
const draft = ref<ActivityRequirementDraft | null>(null);
const configuration = shallowRef<ActivityRequirementConfiguration | null>(null);
const dirty = ref(false);
const calculation = ref<{baseline: number; difference: number; reason?: string} | null>(null);
let nextOverride = 0;
const {list, data, denied, refresh: readFresh, isActive} = useListDetail({resourceId: planId, queryKey: key,
    resourceFamily: () => activityKeys.resource(context.session.value?.context, props.planId),
    read: async (id, scope, signal) => ({data: await api.requirements(id, scope, signal), etag: null}),
    denied: revokeRequirements});
const {command, refresh, readAction, retryAt} = useListCommands({active: isActive, denied: () => denied.value,
    reading: () => list.isFetching.value, error: () => list.error.value, refresh: readFresh},
{dirty: () => dirty.value, unknownMessage: 'draft.leaveUnknown'});
const blocked = computed(() => props.disabled || command.action.disabled.value || !draft.value);
const analysis = computed(() => configuration.value && draft.value ? analyzeRequirementDraft(configuration.value, draft.value) : null);
const coverage = computed(() => analysis.value && draft.value ? requirementCoverage(analysis.value.capacitySummary, draft.value, messages.value.t) : null);
const targets = computed(() => [...(configuration.value?.overrideTargets ?? [])].sort((a, b) => targetLabel(a).localeCompare(targetLabel(b))));
function targetLabel(target: ActivityRequirementConfiguration['overrideTargets'][number]): string {
    return activityParticipantName(target.label, messages.value.t, target.nameIsFallback, target.profileId);
}
// Native live coverage also gates Auto-generate from the unsaved mode. Publish
// that presentation input only; this form remains the sole requirement draft.
watch(() => draft.value?.assignmentMode ?? null, mode => emit('mode', mode), {immediate: true});

/** A validated denial releases this editor's private snapshots and lexical
 * values while shared command protection retains any outstanding receipt. */
function revokeRequirements(failure: Error): void {
    // Lost read authority retires both the independent draft and its cached
    // calculation inputs. Clearing only rendered controls leaves private data
    // available to later cache observers in this same actor/resource family.
    draft.value = null;
    configuration.value = null;
    dirty.value = false;
    calculation.value = null;
    nextOverride = 0;
    void retireQueryFamily(context.queryClient, key.value, failure);
    emit('denied');
}

/** Only clean, explicitly reloaded or newly admitted forms accept a snapshot. */
function accept(config: ActivityRequirementConfiguration): void {
    // Each override key is local DOM identity only; persisted IDs stay separate.
    configuration.value = config;
    draft.value = createRequirementDraft(config);
    nextOverride = draft.value.overrides.length;
    dirty.value = false;
    calculation.value = null;
}
// A newly mounted editor can already have an admitted cached configuration.
// Initialize it now: an equal background GET keeps that cache object's identity
// and cannot trigger this watcher later. Dirty controls retain their own values.
watch(data, config => {
    if (config && (!draft.value || !dirty.value)) accept(config);
}, {immediate: true});
watch([planId, context.epoch], () => {
    // A new resource/actor releases this draft rather than carrying profile IDs
    // or private requirement values into another admission journey.
    draft.value = null;
    configuration.value = null;
    dirty.value = false;
    calculation.value = null;
    command.acknowledge();
});
function markDirty(): void { dirty.value = true; calculation.value = null; }
/** Resolve only names from this form's admitted role catalog. */
function roleTitle(id: string): string {
    // A removed catalog entry retains its opaque saved identity for display;
    // the label does not create or authorize a role relationship.
    return configuration.value?.allRoles.find(role => role.id === id)?.title ?? String(id);
}
/** Former-event overrides remain visible but cannot be edited in place. */
function retained(profileId: string): boolean {
    // A blank new selection is incomplete rather than a retained saved profile.
    return !!profileId && !targets.value.some(target => target.profileId === profileId);
}
function selectedProfile(event: Event): string { return (event.target as HTMLSelectElement).value.replace(/^profile:/, ''); }

/** Attendance labels share the approved civil-day presentation without changing IDs. */
function attendance(profileId: string): string {
    const target = targets.value.find(person => person.profileId === profileId);
    if (!target) return '';
    if (!target.arrivalDate && !target.departureDate) return messages.value.t('activity.requirements.fullAttendance');
    return (target.arrivalDate ? activityDateLabel(target.arrivalDate, messages.value.locale) : messages.value.t('activity.attendanceStart'))
        + ' – ' + (target.departureDate ? activityDateLabel(target.departureDate, messages.value.locale) : messages.value.t('activity.attendanceEnd'));
}
function addOverride(): void {
    if (blocked.value || !targets.value.length || !draft.value) return;
    draft.value.overrides.push({key: nextOverride++, profileId: '', roleId: '', value: '0'});
    markDirty();
}
/** Remove one deliberately selected local row without persisting other changes. */
function removeOverride(key: number): void {
    if (blocked.value || !draft.value) return;
    // Local row identity stays independent of persisted override IDs, including
    // newly added rows which have not received a server identity yet.
    draft.value.overrides = draft.value.overrides.filter(row => row.key !== key);
    markDirty();
}

/** Calculate changes this form only. Existing fixed zero/role/participant rules
 * participate in the shared engine before it selects the closest integer baseline. */
function calculate(): void {
    if (blocked.value || !configuration.value || !draft.value) return;
    const input = requirementAnalysisInput(configuration.value, draft.value);
    if (!hasValidRequirementValues(input.roleRequirements, input.overrides, [])) {
        command.setError('activity.requirements.invalidCalculation');
        return;
    }
    // The engine supplies both the baseline and complete duration table; copying
    // a rounded formula here would diverge from role/override precedence.
    const result = calculateBaselineRequirementForPlan({plan: {...configuration.value.plan, roundingMode: input.plan.roundingMode},
        participants: input.participants, slots: input.slots,
        roleRequirements: input.roleRequirements, overrides: input.overrides});
    draft.value.generalRequiredShifts = String(result.baseline);
    const values = new Map(result.stayRequirements.map(row => [row.stayDays, row.requiredShifts]));
    for (const row of draft.value.stays) row.value = String(values.get(row.stayDays) ?? '');
    markDirty();
    calculation.value = {baseline: result.baseline, difference: result.projectedDifference, reason: result.diagnostics.reason};
}

/** Reload obtains discard consent before a real read. A failed read retains the
 * exact controls, and cancellation neither dispatches nor clears their values. */
async function reload(): Promise<void> {
    if (!readAction.isAvailable() || command.pending.value || command.recovering.value) return;
    if (dirty.value && !window.confirm(messages.value.t('activity.requirements.discard'))) return;
    // Equal server JSON may retain its cache object identity. Explicit reload
    // must still adopt that freshly read snapshot after successful consent.
    if (await refresh() && data.value) accept(data.value);
}

/** Save reuses the existing whole-configuration operation. Only its validated
 * receipt releases the draft; failed follow-up delivery remains confirmed saved. */
async function save(): Promise<void> {
    if (blocked.value || !dirty.value || !draft.value) return;
    if (draft.value.overrides.some(row => !row.profileId)) {
        command.setError('activity.requirements.invalidOverride');
        return;
    }
    const input = requirementInput(draft.value);
    const resource = props.planId;
    await command.run(async scope => {
        const result = await api.saveRequirements(resource, input, scope);
        // Do not publish an old actor's draft into a later visit. The command
        // owner independently retains pending/unknown status through retirement.
        if (isActive() && context.isCurrent(scope) && resource === props.planId) {
            dirty.value = false;
            calculation.value = null;
            emit('changed');
        }
        return result;
    }, true, false, {success: 'activity.requirements.saved'});
}
</script>

<template>
    <div class="mb-3">
        <span class="badge bg-light text-dark me-2">{{ messages.t('activity.requirements.stepOne') }}</span>
        <span class="fw-semibold">{{ messages.t('activity.requirements.configure') }}</span>
    </div>
    <div id="requirementPanel" class="card text-bg-dark border border-secondary-subtle mb-4">
        <div class="card-header d-flex justify-content-between align-items-center">
            <span class="d-flex align-items-center gap-2">
                <i class="bi bi-gear-wide-connected" aria-hidden="true"></i><span>{{ messages.t('activity.requirements.settings') }}</span></span>
            <div class="pilot-action-row">
                <ActionButton type="button" class="btn-sm" variant="outline-secondary" data-requirements-refresh
                    :pending="readAction.pending.value" :show-spinner="false"
                    :disabled="readAction.disabled.value || command.pending.value || command.recovering.value" @click="reload">
                    <i class="bi bi-arrow-clockwise me-1" aria-hidden="true"></i>{{ messages.t('activity.requirements.reload') }}</ActionButton>
                <ActionButton type="button" class="btn-sm" variant="success" data-requirements-save
                    :pending="command.pending.value" :show-spinner="false" :disabled="blocked || !dirty" @click="save">
                    <i class="bi bi-save me-1" aria-hidden="true"></i>{{ messages.t('activity.requirements.saveSettings') }}</ActionButton>
            </div>
        </div>
        <div class="card-body">
            <CommandFeedback :feedback="command.feedback" />
            <EntityDetailReadState :denied="denied" :error="list.error.value" :has-data="!!configuration" :pending="list.isPending.value"
                :last-updated-at="list.data.value ? list.dataUpdatedAt.value : undefined" :retry-at="retryAt" />
            <template v-if="draft && configuration && analysis && coverage">
                <p class="text-secondary small mb-3">{{ messages.t('activity.requirements.description') }}</p>
                <!-- Live coverage belongs to the unsaved controls. Saved badges
                describe persistence only, never a promise of timetable feasibility. -->
                <StatusNotice id="requirementCoverageStatus" class="requirement-coverage-status py-2 px-3" :kind="coverage.variant"
                    role="status" aria-live="polite" :data-coverage-state="coverage.state">
                    <div class="d-flex flex-wrap align-items-center justify-content-between gap-2">
                        <div class="d-flex align-items-start gap-2">
                            <i class="bi mt-1" :class="coverage.icon" data-coverage-icon aria-hidden="true"></i>
                            <div><strong class="d-block" data-coverage-title>{{ coverage.title }}</strong><small data-coverage-detail>{{ coverage.detail }}</small></div>
                        </div>
                        <div class="d-flex flex-wrap gap-1" data-coverage-counts>
                            <span class="badge" :class="dirty ? 'bg-warning text-dark' : 'bg-light text-dark'" data-requirements-dirty>{{ messages.t(dirty ? 'activity.requirements.unsaved' : 'activity.requirements.savedBadge') }}</span>
                            <span class="badge bg-dark text-white">{{ messages.t('activity.requirements.capacityCount', {count: analysis.capacitySummary.availableSlots}) }}</span>
                            <span class="badge bg-dark text-white">{{ messages.t('activity.requirements.requiredCount', {count: analysis.capacitySummary.requiredSlots}) }}</span>
                            <span v-if="analysis.capacitySummary.hypotheticalRoleCoverage?.openRoleCount" class="badge"
                                :class="analysis.capacitySummary.hypotheticalRoleCoverage.unfilledRoleCount ? 'bg-danger text-white' : 'bg-info text-dark'">{{ analysis.capacitySummary.hypotheticalRoleCoverage.unfilledRoleCount
                                    ? messages.t('activity.requirements.unfilledRoles', {count: analysis.capacitySummary.hypotheticalRoleCoverage.unfilledRoleCount})
                                    : messages.t('activity.requirements.modeledRoles', {count: analysis.capacitySummary.hypotheticalRoleCoverage.filledRoleCount}) }}</span>
                        </div>
                    </div>
                </StatusNotice>
                <StatusNotice v-if="calculation" :kind="calculation.difference || calculation.reason ? 'warning' : 'info'" transient placement="notification">
                    {{ messages.t('activity.requirements.calculated', {baseline: calculation.baseline}) }}
                    {{ calculation.difference ? messages.t('activity.requirements.closestBaseline', {count: Math.abs(calculation.difference)}) : messages.t('activity.requirements.exactBaseline') }}
                    <template v-if="calculation.reason === 'fixed-requirements-fill-capacity'">{{ messages.t('activity.requirements.fixedBaseline') }}</template>
                    <template v-if="calculation.reason === 'no-stay-based-participants'">{{ messages.t('activity.requirements.noBaselineParticipants') }}</template>
                </StatusNotice>
                <form id="requirementForm" @input="markDirty" @change="markDirty" @submit.prevent="save">
                    <div class="row g-3">
                        <FormField id="assignmentMode" class="col-sm-6 col-xl-3" :label="messages.t('activity.requirements.mode')" label-class="">
                            <template #control><select id="assignmentMode" v-model="draft.assignmentMode" class="form-select form-select-sm text-bg-dark" :disabled="blocked">
                                <option value="FREE">{{ messages.t('activity.requirements.free') }}</option><option value="REQUIRED">{{ messages.t('activity.requirements.required') }}</option>
                            </select></template>
                        </FormField>
                        <FormField id="requiredShifts" v-model="draft.generalRequiredShifts" :name="null"
                            class="col-sm-6 col-xl-3" type="number" lexical-number :min="0"
                            :label="messages.t('activity.requirements.baseline')" label-class=""
                            control-class="form-control-sm" group-class="input-group-sm"
                            :placeholder="messages.t('activity.requirements.baselinePlaceholder')" :disabled="blocked"
                            :pending="command.pending.value">
                            <template #append>
                                <ActionButton type="button" variant="outline-info" data-requirements-baseline-calc :disabled="blocked" @click="calculate"><i class="bi bi-calculator me-1" aria-hidden="true"></i>{{ messages.t('activity.requirements.calculate') }}</ActionButton>
                            </template>
                        </FormField>
                        <FormField id="roundingMode" class="col-sm-6 col-xl-3" :label="messages.t('activity.requirements.rounding')" label-class="">
                            <template #control><select id="roundingMode" v-model="draft.roundingMode" class="form-select form-select-sm text-bg-dark" :disabled="blocked">
                                <option value="">{{ messages.t('common.none') }}</option><option value="CEIL">{{ messages.t('activity.requirements.ceil') }}</option><option value="ROUND">{{ messages.t('activity.requirements.round') }}</option><option value="FLOOR">{{ messages.t('activity.requirements.floor') }}</option>
                            </select></template>
                        </FormField>
                        <FormField id="bindingDeadline" v-model="draft.bindingDeadline" :name="null"
                            class="col-sm-6 col-xl-3" type="datetime-local" :label="messages.t('activity.requirements.deadline')"
                            label-class="" control-class="form-control-sm" :placeholder="messages.t('activity.requirements.optional')" :disabled="blocked"
                            :pending="command.pending.value" />
                    </div>
                    <hr />
                    <h6 class="pilot-section-heading">
                        <span>{{ messages.t('activity.requirements.stays') }}</span>
                        <small class="text-secondary">{{ messages.t('activity.requirements.staysHint') }}</small>
                    </h6>
                    <p class="text-secondary small mb-2">{{ messages.t('activity.requirements.staysDescription') }}</p>
                    <div class="stay-requirement-scroll border border-secondary-subtle rounded p-2">
                        <div id="stayRequirementList" class="stay-requirement-grid">
                            <FormField v-for="row in draft.stays" :id="'stayRequirement-' + row.stayDays" :key="row.stayDays"
                                v-model="row.value" :name="null" class="stay-requirement-item d-grid gap-1" type="number" lexical-number :min="0" :step="1"
                                :label="messages.t('activity.dayCount', {count: row.stayDays})" label-class="small mb-0 text-nowrap"
                                control-class="form-control-sm" :control-data="{'data-stay-days': row.stayDays}"
                                :aria-label="messages.t('activity.requirements.stayLabel', {count: row.stayDays})" :disabled="blocked"
                                :pending="command.pending.value" />
                            <span v-if="!draft.stays.length" class="text-secondary small">{{ messages.t('activity.requirements.noStays') }}</span>
                        </div>
                    </div>
                    <!-- These switches persist independently of coverage demand.
                    They retain the native assignment/attendance policy meanings. -->
                    <div class="form-check form-switch my-3">
                        <input id="allowOverfill" v-model="draft.allowOverfillAfterFull" type="checkbox" role="switch"
                            class="form-check-input" :disabled="blocked" />
                        <label for="allowOverfill" class="form-check-label">{{ messages.t('activity.requirements.overfill') }}</label>
                        <div class="form-text text-secondary">{{ messages.t('activity.requirements.overfillHint') }}</div>
                    </div>
                    <div class="form-check form-switch mb-3">
                        <input id="allowExternalAssignees" v-model="draft.allowExternalAssignees" type="checkbox" role="switch"
                            class="form-check-input" :disabled="blocked" />
                        <label for="allowExternalAssignees" class="form-check-label">{{ messages.t('activity.requirements.external') }}</label>
                        <div class="form-text text-secondary">{{ messages.t('activity.requirements.externalHint') }}</div>
                    </div>
                    <div class="row g-3">
                        <div class="col-md-6">
                            <div class="form-check form-switch">
                                <input id="allowArrivalEvening" v-model="draft.allowArrivalDayEvening" type="checkbox" role="switch"
                                    class="form-check-input" :disabled="blocked" />
                                <label for="allowArrivalEvening" class="form-check-label">{{ messages.t('activity.requirements.arrival') }}</label>
                            </div>
                        </div>
                        <div class="col-md-6">
                            <div class="form-check form-switch">
                                <input id="allowDepartureMorning" v-model="draft.allowDepartureDayMorning" type="checkbox" role="switch"
                                    class="form-check-input" :disabled="blocked" />
                                <label for="allowDepartureMorning" class="form-check-label">{{ messages.t('activity.requirements.departure') }}</label>
                            </div>
                        </div>
                    </div>
                    <hr />
                    <h6 class="pilot-section-heading">
                        <span>{{ messages.t('activity.requirements.roles') }}</span>
                        <small class="text-secondary">{{ messages.t('activity.requirements.rolesHint') }}</small>
                    </h6>
                    <div id="roleRequirementList" class="row g-2">
                        <FormField v-for="row in draft.roles" :id="'roleRequirement-' + row.roleId" :key="row.roleId"
                            v-model="row.value" :name="null" class="col-md-3 d-grid gap-1" type="number" lexical-number :min="0" :step="1" placeholder="0"
                            :label="roleTitle(row.roleId)" label-class="small mb-0" control-class="form-control-sm"
                            :control-data="{'data-role-id': row.roleId}" :disabled="blocked"
                            :pending="command.pending.value" />
                    </div>
                    <hr />
                    <h6 class="pilot-section-heading mb-2">
                        <span>{{ messages.t('activity.requirements.overrides') }}</span>
                        <ActionButton type="button" class="btn-sm" variant="outline-info" data-add-override
                            :disabled="blocked || !targets.length"
                            :title="!targets.length ? messages.t('activity.requirements.registerForOverrides') : undefined"
                            @click="addOverride">
                            <i class="bi bi-plus-lg me-1" aria-hidden="true"></i>{{ messages.t('activity.requirements.addOverride') }}</ActionButton>
                    </h6>
                    <p class="text-secondary small mb-2">{{ messages.t('activity.requirements.overridesDescription') }}</p>
                    <div id="overrideList" class="override-list-scroll">
                        <div v-if="!targets.length" class="text-secondary small" data-empty-state>{{ messages.t('activity.requirements.noTargets') }}</div>
                        <div v-else-if="!draft.overrides.length" class="text-secondary small" data-empty-state>{{ messages.t('activity.requirements.noOverrides') }}</div>
                        <div v-for="row in draft.overrides" :key="row.key" class="row g-2 align-items-end override-row border border-secondary-subtle rounded p-2 mx-0" :data-override-id="row.id">
                            <FormField :id="'overrideParticipant-' + row.key" class="col-12 col-lg-7 d-grid gap-1" :label="messages.t('activity.participant')" label-class="small mb-0">
                                <template #control><select :id="'overrideParticipant-' + row.key" :value="row.profileId ? 'profile:' + row.profileId : ''" class="form-select form-select-sm text-bg-dark" data-override-target="participant" :disabled="blocked || !targets.length" @change="row.profileId = selectedProfile($event)">
                                    <option value="" disabled>{{ messages.t(targets.length ? 'activity.requirements.chooseParticipant' : 'activity.requirements.noParticipants') }}</option>
                                    <option v-for="target in targets" :key="target.key" :value="'profile:' + target.profileId">{{ targetLabel(target) }}{{ attendance(target.profileId ?? '') ? ' — ' + attendance(target.profileId ?? '') : '' }}</option>
                                    <option v-if="retained(row.profileId)" :value="'profile:' + row.profileId" data-retained="true">{{ row.profileName || messages.t('activity.requirements.notRegistered', {id: row.profileId}) }}</option>
                                </select></template>
                                <div class="form-text small override-attendance-hint mt-1" :class="retained(row.profileId) ? 'text-warning' : 'text-secondary'">{{ !row.profileId ? messages.t('activity.requirements.selectHint') : retained(row.profileId) ? messages.t('activity.requirements.retainedHint') : attendance(row.profileId) }}</div>
                            </FormField>
                            <FormField :id="'overrideRole-' + row.key" class="col-12 col-sm-5 col-lg-2 d-grid gap-1" :label="messages.t('activity.requirements.optionalRole')" label-class="small mb-0">
                                <template #control><select :id="'overrideRole-' + row.key" v-model="row.roleId" class="form-select form-select-sm text-bg-dark" data-override-target="role" :disabled="blocked || retained(row.profileId)"><option value="">{{ messages.t('activity.requirements.anyRole') }}</option><option v-for="role in configuration.allRoles" :key="role.id" :value="String(role.id)">{{ role.title }}</option></select></template>
                            </FormField>
                            <FormField :id="'overrideRequired-' + row.key" v-model="row.value" :name="null"
                                class="col-9 col-sm-5 col-lg-2 d-grid gap-1" type="number" lexical-number :min="0" :step="1"
                                :label="messages.t('activity.requirements.requiredShifts')" label-class="small mb-0" control-class="form-control-sm"
                                :control-data="{'data-override-target': 'required'}" :disabled="blocked || retained(row.profileId)"
                                :pending="command.pending.value" />
                            <div class="col-3 col-sm-2 col-lg-1 d-grid">
                                <ActionButton type="button" class="btn-sm w-100" variant="outline-danger"
                                    :aria-label="messages.t('activity.requirements.removeOverride')"
                                    :disabled="blocked || retained(row.profileId)" @click="removeOverride(row.key)">
                                    <i class="bi bi-x-lg" aria-hidden="true"></i>
                                </ActionButton>
                            </div>
                        </div>
                    </div>
                    <div class="d-flex flex-wrap justify-content-end align-items-center gap-2 border-top border-secondary-subtle mt-3 pt-3">
                        <small class="text-secondary me-auto">{{ messages.t('activity.requirements.saveHint') }}</small>
                        <ActionButton type="button" variant="success" data-requirements-save
                            :pending="command.pending.value" :show-spinner="false" :disabled="blocked || !dirty" @click="save">
                            <i class="bi bi-save me-1" aria-hidden="true"></i>{{ messages.t('activity.requirements.saveRequirements') }}</ActionButton>
                    </div>
                </form>
            </template>
        </div>
    </div>
    <template v-if="draft && analysis">
        <hr />
        <h6 class="pilot-section-heading mt-3">
            <span><span class="badge bg-light text-dark me-2">{{ messages.t('activity.requirements.stepTwo') }}</span>{{ messages.t('activity.requirements.checkCoverage') }}</span>
            <small class="text-secondary">{{ messages.t('activity.requirements.progressHint') }}</small>
        </h6>
        <ActivityParticipants
            id="requirement-participant-status"
            :heading="false"
            :participants="analysis.participants"
            :assignment-mode="draft.assignmentMode"
            localize-attendance
        />
    </template>
</template>
