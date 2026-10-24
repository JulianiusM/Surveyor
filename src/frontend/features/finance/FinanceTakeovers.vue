<script setup lang="ts">
import {computed, ref, useId, watch} from 'vue';
import type {components} from '../../../types/api/v1';
import {useActionState, usePilot} from '../../app/context';
import {useCommand} from '../../composables/command';
import {useFinanceApi} from './api';
import ActionButton from '../../components/ActionButton.vue';
import AppDialog from '../../components/AppDialog.vue';
import CommandFeedback from '../../components/CommandFeedback.vue';
import FormField from '../../components/FormField.vue';
import StatusNotice from '../../components/StatusNotice.vue';

// Both audiences share one chooser interaction. The server owns the admitted
// roster and actual authority; personal callers can submit only their own payer.
const props = defineProps<{
    eventId: string;
    pool: components['schemas']['FinancePool'];
    registrationId: string | null;
    initialPayerId?: string;
    admin: boolean;
    open: boolean;
    active: boolean;
    refresh: () => Promise<void>;
}>();
const emit = defineEmits<{close: []}>();
const context = usePilot();
const {messages} = context;
const api = useFinanceApi(context);
const id = useId();
const payerId = ref('');
const selected = ref<string[]>([]);
const baseline = ref<string[]>([]);
const search = ref('');
// Keep only the current payer's submitted form baseline. If its confirmed write
// outlived a failed read, changing payer first needs authoritative current inputs;
// this form never maintains a parallel map of coverage/reassignment rules.
const savedReadRequired = ref(false);
const dirty = computed(() => selected.value.length !== baseline.value.length || selected.value.some(value => !baseline.value.includes(value)));
const choices = computed(() => props.pool.coverageChoices ?? []);
const groups = computed(() => props.pool.currentCoverageGroups ?? []);
const payerCovered = computed(() => groups.value.some(group => group.beneficiaries.some(person => person.id === payerId.value)));
const command = useCommand(props.refresh, false, {dirty: () => dirty.value, unknownMessage: 'draft.leaveUnknown', recoveryEligible: () => props.active});
const action = useActionState({eligible: () => props.active && (props.admin || props.pool.status === 'OPEN') && choices.value.some(person => person.id === payerId.value),
    blocked: () => command.action.disabled.value});
const filtered = computed(filteredChoices);
const summary = computed(coverageSummary);

/** Filter admitted beneficiary names/contact text without losing hidden
 * selections or offering the selected payer as their own beneficiary. */
function filteredChoices() {
    // Search affects display only; the save captures the full selection.
    const needle = search.value.trim().toLocaleLowerCase();
    return choices.value.filter(person => person.id !== payerId.value && `${person.name} ${person.email ?? ''}`.toLocaleLowerCase().includes(needle));
}
/** Distinguish a selected payer with no beneficiaries from no selected payer. */
function coverageSummary(): string {
    const payer = choices.value.find(person => person.id === payerId.value);
    if (!payer) return messages.value.t('finance.chooseAPayerToManageCoverage');
    // The native responsibility summary remains meaningful even for self-only
    // coverage, including the participant view without an editable payer field.
    return selected.value.length ? messages.value.t('finance.payerCoversOthers', {payer: payer.name, count: selected.value.length})
        : messages.value.t('finance.payerCoversSelf', {payer: payer.name});
}
watch([() => props.pool, () => props.registrationId], receiveSaved, {immediate: true});
watch(() => props.open, selectInitialPayer);

/** Fresh admitted inputs replace the saved baseline without replacing an
 * unfinished beneficiary selection. A pending write/read owns its own adoption. */
function receiveSaved(): void {
    // A refresh can update availability and the saved roster, while this
    // payer's unfinished selection remains independently owned until save/close.
    if (command.pending.value || command.recovering.value || command.uncertain.value) return;
    const unfinished = dirty.value;
    savedReadRequired.value = false;
    if (!unfinished) accept();
    else baseline.value = savedSelection();
}

/** A row-level Edit shortcut opens its exact payer without another selection. */
async function selectInitialPayer(open: boolean): Promise<void> {
    if (!open || !props.admin || !props.initialPayerId || command.pending.value || command.recovering.value) return;
    const next = props.initialPayerId;
    if (next === payerId.value || !await ensureSavedInputs()) return;
    // Only a deliberate opening adopts the shortcut; polling cannot change it.
    if (props.open && props.initialPayerId === next) { payerId.value = next; accept(); }
}

/** Load only this payer's existing current input mapping. Applied closed-pool
 * coverage is presented separately and cannot become the next-input baseline. */
function accept(): void {
    if (!props.admin) payerId.value = props.registrationId ?? '';
    else if (!choices.value.some(person => person.id === payerId.value)) payerId.value = choices.value[0]?.id ?? '';
    // Clone the identity list; no query DTO becomes a mutable form model.
    selected.value = savedSelection();
    baseline.value = [...selected.value];
}
/** Read only the selected payer's current saved input, never applied coverage. */
function savedSelection(): string[] {
    // Missing coverage means an empty beneficiary selection, not a missing payer.
    return groups.value.find(group => group.payerId === payerId.value)?.beneficiaries.map(person => person.id) ?? [];
}

/** A confirmed selection cannot be discarded for another payer's stale Query
 * inputs. Reuse protected recovery before switching, without replaying a write. */
async function ensureSavedInputs(): Promise<boolean> {
    if (!savedReadRequired.value) return true;
    if (!props.active || !await command.recover(props.refresh)) return false;
    // The protected read blocks simultaneous switches, saves and dismissal.
    // Successful current-context delivery supersedes this submitted baseline.
    savedReadRequired.value = false;
    command.acknowledge();
    return true;
}

/** A different organizer payer owns a different draft. Cancellation restores
 * the displayed select rather than sending hidden values for the former payer. */
async function changePayer(event: Event): Promise<void> {
    const control = event.target as HTMLSelectElement;
    const next = control.value;
    // Keep the visible select consistent with its current selection while a
    // required saved-input read waits or fails.
    control.value = payerId.value;
    if (!command.mayLeave() || !await ensureSavedInputs()) return;
    // Explicit departure acknowledges this form's old uncertainty and releases
    // only its former payer selection, without touching other pool editors.
    command.acknowledge(); payerId.value = next; search.value = ''; accept();
}
function covering(id: string): components['schemas']['FinanceCoverageGroup'] | undefined {
    // Query the admitted current inputs, never the applied closed snapshot.
    return groups.value.find(group => group.beneficiaries.some(person => person.id === id));
}

/** Explain unavailable choices from admitted coverage facts, matching native
 * one-level selection rules without replacing server validation or permission. */
function blockedReason(personId: string): string | null {
    // Existing legacy coverage can still be cleared from a covered payer. Only
    // new beneficiaries are unavailable; the shared operation permits cleanup.
    if (payerCovered.value && !baseline.value.includes(personId)) return messages.value.t('finance.thisPayerIsAlreadyCoveredBySomeoneElse');
    if (groups.value.some(group => group.payerId === personId && group.beneficiaries.length)) return messages.value.t('finance.alreadyCoversAnotherParticipantClearThatCoverageFirst');
    // Organizers may reassign a covered beneficiary; participants may not.
    const owner = covering(personId);
    if (!props.admin && owner && owner.payerId !== payerId.value) return messages.value.t('finance.coveredByParticipant', {payer: owner.payerName});
    return null;
}
function reassignNotice(personId: string): string | null {
    const owner = covering(personId);
    return props.admin && owner && owner.payerId !== payerId.value
        ? messages.value.t('finance.coveredByParticipantReassign', {payer: owner.payerName}) : null;
}

/** Capture one payer's exact beneficiaries. Changing closed inputs never
 * calculates or rewrites saved payer balances and recorded transfers. */
async function save(event: Event): Promise<void> {
    if (!action.isAvailable() || !(event.target as HTMLFormElement).reportValidity()) return;
    const input = {payerId: payerId.value, beneficiaries: [...selected.value]};
    // Only confirmed persistence adopts this input baseline. Unknown delivery
    // remains locked until an explicit fresh read; it is never automatically replayed.
    const saved = await command.run(scope => api.takeovers(props.eventId, props.pool.id, input, props.admin, scope), true, false,
        {success: props.pool.status === 'CLOSED' ? 'finance.takeoversSavedClosed' : 'finance.takeoversSaved'});
    // A confirmed write is final even when its follow-up read cannot deliver.
    // Do not replace it with the precommand pool still held in props.
    if (saved) {
        baseline.value = [...selected.value];
        savedReadRequired.value = command.outcome.value?.refresh === 'failed';
    }
}
async function refresh(): Promise<void> {
    if (!props.active) return;
    const refreshed = savedReadRequired.value ? await ensureSavedInputs() : await command.reconcileSafely(props.refresh);
    if (refreshed) receiveSaved();
}
/** Acknowledged dismissal releases only this payer's unfinished selection. */
function close(): void {
    if (!command.mayLeave()) return;
    // Restore the saved projection after the pending/unknown departure guard.
    command.acknowledge(); selected.value = [...baseline.value]; emit('close');
}
</script>

<template>
    <AppDialog content-class="text-white finance-dialog finance-takeover-dialog" :open="open"
               :title="messages.t('finance.poolDialogTitle', {title: messages.t('finance.manageTakeovers2'), name: pool.name})"
               :pending="command.pending.value || command.recovering.value" @close="close">
        <CommandFeedback :feedback="command.feedback" :part="command.uncertain.value ? 'error' : 'all'" />
        <CommandFeedback :feedback="command.feedback" part="uncertain" :action="{state: command.recoveryAction, label: messages.t('common.refresh')}" @action="refresh" />
        <p class="small text-secondary">{{ messages.t('finance.chooseAPayerThenTheParticipantsTheyWillCover') }}</p>
        <StatusNotice kind="info" class="small">
            {{ messages.t(pool.status === 'CLOSED'
                ? 'finance.theseChangesAffectTheNextCalculationRecordedPaymentsStay'
                : 'finance.saveCoverageForOnePayerAtATimeCovered') }}
        </StatusNotice>
        <p v-if="!admin && pool.status !== 'OPEN'" class="small text-warning">{{ messages.t('finance.participantTakeoverChangesAreOnlyAvailableWhileThePool') }}</p>
        <div class="border border-secondary-subtle rounded-3 p-3 mb-3">
            <strong class="d-block">{{ messages.t('finance.selectedCoverage') }}</strong>
            <span class="small text-secondary" role="status">{{ summary }}</span>
        </div>
        <form :id="`${id}-form`" data-finance-takeovers @submit.prevent="save">
            <fieldset class="border-0 p-0 m-0" :disabled="action.disabled.value && !!payerId">
                <legend class="visually-hidden">{{ messages.t('finance.manageTakeovers2') }}</legend>
                <FormField v-if="admin" :id="`${id}-payer`" class="mb-3" :label="messages.t('finance.payer')">
                    <template #control>
                        <select :id="`${id}-payer`" :value="payerId" class="form-select text-bg-dark"
                                :disabled="!active || command.action.disabled.value" @change="changePayer">
                            <option v-for="person in choices" :key="person.id" :value="person.id">{{ person.name }}</option>
                        </select>
                    </template>
                </FormField>
                <p v-if="payerCovered" class="small text-warning">{{ messages.t('finance.thisPayerIsAlreadyCoveredBySomeoneElse') }}</p>
                <FormField :id="`${id}-search`" v-model="search" type="search" class="mb-3" :label="messages.t('finance.searchParticipants')" :placeholder="messages.t('finance.typeToFilter')"
                    :pending="command.pending.value" />
                <div class="list-group list-group-flush border border-secondary-subtle rounded-3">
                    <label v-for="person in filtered" :key="person.id" :for="`${id}-person-${person.id}`"
                        class="list-group-item bg-dark text-white d-flex align-items-start gap-3 py-3" :data-finance-beneficiary="person.id">
                        <input :id="`${id}-person-${person.id}`" v-model="selected" :value="person.id" type="checkbox"
                            class="form-check-input mt-1 flex-shrink-0" :disabled="!!blockedReason(person.id)" />
                        <span>
                            <strong class="d-block">{{ person.name }}</strong>
                            <small v-if="person.email" class="text-secondary d-block">{{ person.email }}</small>
                            <small v-if="blockedReason(person.id) || reassignNotice(person.id)" class="text-warning d-block mt-1">{{ blockedReason(person.id) || reassignNotice(person.id) }}</small>
                        </span>
                    </label>
                </div>
                <p v-if="choices.length < 2" class="small text-secondary mt-2">{{ messages.t('finance.noOtherParticipantsAreAssignedToThisPool') }}</p>
            </fieldset>
        </form>
        <template #footer>
            <ActionButton variant="secondary" :disabled="command.pending.value || command.recovering.value" @click="close">{{ messages.t('common.close') }}</ActionButton>
            <ActionButton :form="`${id}-form`" type="submit" :state="action"
                :pending="command.pending.value" :show-spinner="false"><i class="bi bi-save me-1" aria-hidden="true"></i>{{ messages.t('finance.saveChanges') }}</ActionButton>
        </template>
    </AppDialog>
</template>

<style>
/* Native takeover editing reserves the desktop viewport for its coverage picker.
   The shared phone fullscreen rule and body-local scrolling remain its owners. */
@media (min-width: 576px) {
    .finance-takeover-dialog { height: calc(100dvh - 3.5rem); }
}
</style>
