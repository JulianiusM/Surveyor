<script setup lang="ts">
import {computed, onBeforeUnmount, reactive, ref, shallowRef, watch} from 'vue';
import type {components} from '../../../types/api/v1';
import type {PilotPlainMessageKey} from '../../../types/FrontendPilotUiTypes';
import type {ActivityManualRecommendation, ActivityRecommendationDraftRow, ActivityRecommendationRow} from '../../../types/FrontendActivityRecommendationTypes';
import {usePilot} from '../../app/context';
import {useDraftProtection} from '../../composables/command';
import ActionButton from '../../components/ActionButton.vue';
import StatusNotice from '../../components/StatusNotice.vue';
import AppDialog from '../../components/AppDialog.vue';
import FormField from '../../components/FormField.vue';
import {activityDateLabel, activityParticipantName, activityWarningLabel} from './presentation';
import {manualRecommendationRows, RecommendationDraftError, rolelessRecommendationAssignments} from './recommendationDraft';

// A manual dialog retains its own selections. Preview never persists either leg;
// the containing review receives both rows together only after explicit staging.
const props = defineProps<{slotId: string; workspace: components['schemas']['ActivityRecommendations'];
    view: components['schemas']['ActivityView']; rows: ActivityRecommendationDraftRow[]; disabled: boolean;
    preview(rows: ActivityRecommendationRow[]): Promise<components['schemas']['ActivityWarning'][]>}>();
const emit = defineEmits<{close: []; stage: [rows: ActivityRecommendationRow[]]}>();
const context = usePilot();
const {messages} = context;
const form = reactive<ActivityManualRecommendation>({targetSlotId: props.slotId, operation: 'ASSIGN', profileId: '', sourceItemId: '', swapProfileId: ''});
const warnings = shallowRef<components['schemas']['ActivityWarning'][]>([]);
const issue = ref<PilotPlainMessageKey | null>(null);
let active = true;
let sequence = 0;
onBeforeUnmount(() => { active = false; sequence++; });
useDraftProtection({dirty: () => !!form.profileId || form.operation !== 'ASSIGN', unknownMessage: 'draft.leaveUnknown'});
const target = computed(() => props.workspace.slots.find(slot => slot.id === props.slotId));
const participants = computed(() => props.workspace.participantOptions.filter(isAvailableParticipant));
/** Match native attendance/source option filtering without granting authority. */
function isAvailableParticipant(person: components['schemas']['ActivityRecommendations']['participantOptions'][number]): boolean {
    // Preserve the native option filter. Warning and submission decisions remain
    // server-owned, including its attendance and roleless-source checks.
    if (!person.profileId || props.workspace.existingAssignments.some(assignment => assignment.item.id === props.slotId && assignment.profile.id === person.profileId)) return false;
    const day = target.value?.day;
    if (day && (person.arrivalDate && day < person.arrivalDate || person.departureDate && day > person.departureDate)) return false;
    return form.operation === 'ASSIGN' || rolelessRecommendationAssignments(props.workspace, person.profileId).some(assignment => assignment.item.id !== props.slotId);
}
const sources = computed(() => rolelessRecommendationAssignments(props.workspace, form.profileId).filter(assignment => assignment.item.id !== props.slotId));
const swaps = computed(() => rolelessRecommendationAssignments(props.workspace).filter(assignment => assignment.item.id === props.slotId));
const ready = computed(() => !!form.profileId && (form.operation === 'ASSIGN' || !!form.sourceItemId)
    && (form.operation !== 'SWAP' || !!form.swapProfileId));
watch([participants, sources, swaps], reconcileSelections);

/** A fresh admitted snapshot can release a participant or source assignment.
 * Clear only those unavailable choices so visible controls and staged IDs agree. */
function reconcileSelections(): void {
    // Preserve the operation and every still-valid choice. Dependent source
    // input belongs to its selected participant and retires with that choice.
    if (form.profileId && !participants.value.some(person => person.profileId === form.profileId)) {
        form.profileId = '';
        form.sourceItemId = '';
    }
    if (form.sourceItemId && !sources.value.some(assignment => assignment.item.id === form.sourceItemId)) form.sourceItemId = '';
    if (form.swapProfileId && !swaps.value.some(assignment => assignment.profile.id === form.swapProfileId)) form.swapProfileId = '';
}

/** Release only choices whose controlling selection changed. Other deliberate
 * input remains visible and always matches the values used for preview/staging. */
function changeOperation(): void {
    form.profileId = '';
    form.sourceItemId = '';
    form.swapProfileId = '';
}
function changeParticipant(): void { form.sourceItemId = ''; }
function close(): void { emit('close'); }

/** Every selection gets a generation-bound preview. A late warning cannot attach
 * to newer selections, a closed dialog or a replaced authorized workspace. */
async function checkWarnings(): Promise<void> {
    const request = ++sequence;
    warnings.value = [];
    issue.value = null;
    if (!ready.value || props.disabled || !context.mayRead()) return;
    try {
        // Build both swap legs before requesting the complete batch projection.
        const rows = manualRecommendationRows(props.workspace, props.rows, {...form});
        const result = await props.preview(rows);
        if (active && request === sequence) warnings.value = result;
    } catch (failure) {
        if (active && request === sequence) issue.value = failure instanceof RecommendationDraftError
            ? failure.messageKey : 'activity.recommendations.warningsFailed';
    }
}
watch(() => [form.operation, form.profileId, form.sourceItemId, form.swapProfileId, props.rows, props.workspace], checkWarnings);

/** Staging changes the local review only. Saving later obtains a new preview and
 * explicit overlap acknowledgement for that exact immutable batch. */
function stage(): void {
    if (props.disabled) return;
    if (!ready.value) { issue.value = 'activity.recommendations.selectEvery'; return; }
    try {
        // Construct every leg before publishing; a failed swap choice cannot
        // leave a half-operation in the containing draft.
        emit('stage', manualRecommendationRows(props.workspace, props.rows, {...form}));
    } catch (failure) {
        issue.value = failure instanceof RecommendationDraftError ? failure.messageKey : 'activity.recommendations.selectParticipant';
    }
}
/** Append shared civil-day attendance labels to the admitted participant name. */
function participantLabel(person: components['schemas']['ActivityRecommendations']['participantOptions'][number]): string {
    // Missing bounds retain native start/end wording; the submitted profile ID
    // stays separate from this purely presentational label.
    const arrival = person.arrivalDate ? activityDateLabel(person.arrivalDate, messages.value.locale) : '';
    const departure = person.departureDate ? activityDateLabel(person.departureDate, messages.value.locale) : '';
    return activityParticipantName(person.label, messages.value.t, person.nameIsFallback, person.profileId)
        + (arrival || departure ? ` (${arrival || messages.value.t('activity.attendanceStart')} – ${departure || messages.value.t('activity.attendanceEnd')})` : '');
}
</script>

<template>
    <AppDialog
        id="addRecommendationModal"
        :open="true"
        :title="messages.t('activity.recommendations.add')"
        title-icon="bi-plus-circle"
        standard
        :fullscreen-on-small="false"
        :pending="disabled"
        @close="close">
        <div>
            <input id="addRecommendationSlotId" type="hidden" :value="slotId" />
            <FormField
                id="addRecommendationOperation"
                :label="messages.t('activity.recommendations.operation')"
                label-class=""
                class="mb-3">
                <template #control>
                    <select
                        id="addRecommendationOperation"
                        v-model="form.operation"
                        class="form-select form-select-sm text-bg-dark"
                        :disabled="disabled"
                        @change="changeOperation">
                        <option value="ASSIGN">{{ messages.t('activity.recommendations.newAssignment') }}</option>
                        <option value="REASSIGN">{{ messages.t('activity.recommendations.moveAssignment') }}</option>
                        <option value="SWAP">{{ messages.t('activity.recommendations.swapAssignments') }}</option>
                    </select>
                </template>
            </FormField>
            <FormField
                id="addRecommendationParticipant"
                :label="messages.t('activity.recommendations.participant')"
                label-class=""
                class="mb-3">
                <template #control>
                    <select
                        id="addRecommendationParticipant"
                        :value="form.profileId ? 'profile:' + form.profileId : ''"
                        required
                        class="form-select form-select-sm text-bg-dark"
                        :disabled="disabled"
                        @change="form.profileId = ($event.target as HTMLSelectElement).value.replace(/^profile:/, ''); changeParticipant()">
                        <option value="">{{ messages.t('activity.recommendations.choose') }}</option>
                        <option
                            v-for="person in participants"
                            :key="person.profileId ?? person.key"
                            :value="'profile:' + person.profileId">{{ participantLabel(person) }}</option>
                    </select>
                </template>
            </FormField>
            <FormField
                v-if="form.operation !== 'ASSIGN'"
                id="addRecommendationSource"
                :label="messages.t('activity.recommendations.source')"
                label-class=""
                class="mb-3"
                data-source-assignment-group>
                <template #control>
                    <select
                        id="addRecommendationSource"
                        v-model="form.sourceItemId"
                        class="form-select form-select-sm text-bg-dark"
                        :disabled="disabled">
                        <option value="">{{ messages.t('activity.recommendations.chooseSource') }}</option>
                        <option
                            v-for="assignment in sources"
                            :key="assignment.item.id"
                            :value="assignment.item.id">{{ assignment.item.title }}</option>
                    </select>
                </template>
            </FormField>
            <FormField
                v-if="form.operation === 'SWAP'"
                id="addRecommendationSwapParticipant"
                :label="messages.t('activity.recommendations.swapParticipant')"
                label-class=""
                class="mb-3"
                data-swap-assignment-group>
                <template #control>
                    <select
                        id="addRecommendationSwapParticipant"
                        v-model="form.swapProfileId"
                        class="form-select form-select-sm text-bg-dark"
                        :disabled="disabled">
                        <option value="">{{ messages.t('activity.recommendations.chooseSwap') }}</option>
                        <option
                            v-for="assignment in swaps"
                            :key="assignment.profile.id"
                            :value="assignment.profile.id">{{ assignment.profile.name }}</option>
                    </select>
                </template>
            </FormField>
            <StatusNotice
                v-if="form.operation === 'SWAP' && !swaps.length"
                kind="warning"
                class="py-2 px-3"
                data-add-warning>
                <i class="bi bi-exclamation-triangle me-2" aria-hidden="true"></i><span>{{ messages.t('activity.recommendations.swapNeedsSource') }}</span>
            </StatusNotice>
            <StatusNotice v-if="warnings.length" kind="warning" class="py-2 px-3" data-add-warning>
                <i class="bi bi-exclamation-triangle me-2" aria-hidden="true"></i><span>{{ warnings.map(warning => activityWarningLabel(warning, view.slots, messages.t)).join(' ') }}</span>
            </StatusNotice>
            <StatusNotice v-if="issue" kind="warning" class="py-2 px-3" data-add-warning>
                <i class="bi bi-exclamation-triangle me-2" aria-hidden="true"></i><span>{{ messages.t(issue) }}</span>
            </StatusNotice>
        </div>
        <template #footer>
            <ActionButton
                type="button"
                class="btn-sm" variant="outline-secondary"
                :disabled="disabled"
                @click="close">{{ messages.t('common.cancel') }}</ActionButton>
            <ActionButton
                id="addRecommendationConfirm"
                type="button"
                class="btn-sm" variant="primary"
                :disabled="disabled"
                @click="stage">
                <i class="bi bi-check2 me-1" aria-hidden="true"></i>{{ messages.t('activity.recommendations.stage') }}</ActionButton>
        </template>
    </AppDialog>
</template>
