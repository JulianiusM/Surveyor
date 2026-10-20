<script setup lang="ts">
import {computed, nextTick, reactive, ref, useId, watch} from 'vue';
import type {components} from '../../../types/api/v1';
import {useActionState, usePilot} from '../../app/context';
import {useCommand} from '../../composables/command';
import {useFinanceApi} from './api';
import {financeDecimal, protectFinanceNumberFromScroll} from './numbers';
import FinanceEnrollmentFields from './FinanceEnrollmentFields.vue';
import ActionButton from '../../components/ActionButton.vue';
import AppDialog from '../../components/AppDialog.vue';
import CommandFeedback from '../../components/CommandFeedback.vue';
import FormField from '../../components/FormField.vue';

// Membership, factors and exemptions form one independent saved-input boundary.
// Current totals/shares come from the server and are never rebuilt from this draft.
const props = defineProps<{
    eventId: string;
    pool: components['schemas']['FinancePool'];
    participants: NonNullable<components['schemas']['FinanceView']['participants']>;
    open: boolean;
    active: boolean;
    refresh: () => Promise<void>;
}>();
const emit = defineEmits<{close: []}>();
const context = usePilot();
const {messages} = context;
const api = useFinanceApi(context);
const id = useId();
const search = ref('');
const dirty = ref(false);
const draft = reactive({assignAll: false, isDefault: false, subtractPersonalInvoices: true,
    rows: [] as Array<{id: string; name: string; email: string | null; selected: boolean; factor: string; exempt: boolean}>});
// This form's saved input baseline survives a confirmed write whose following
// Query read fails. It contains only form fields, never a second finance projection.
const baseline = ref('');
const command = useCommand(props.refresh, false, {dirty: () => dirty.value, unknownMessage: 'draft.leaveUnknown', recoveryEligible: () => props.active});
const action = useActionState({eligible: () => props.active, blocked: () => command.action.disabled.value});
const visible = computed(visibleRows);
watch([() => props.pool, () => props.participants], receiveSaved, {immediate: true});

/** Search only presentation; every factor node remains mounted for native
 * validity checks and to preserve an unfinished value when filtering changes. */
function visibleRows() {
    // Admitted email/name text is data, never a query or permission input.
    const needle = search.value.trim().toLocaleLowerCase();
    return draft.rows.filter(row => `${row.name} ${row.email ?? ''}`.toLocaleLowerCase().includes(needle));
}
/** An admitted read updates the saved form baseline. Dirty controls remain
 * independent; a pending or unknown write retains its own submitted baseline. */
function receiveSaved(): void {
    if (command.pending.value || command.uncertain.value) return;
    const unfinished = dirty.value;
    const saved = savedDraft();
    baseline.value = JSON.stringify(saved);
    if (!unfinished) Object.assign(draft, saved);
    else synchronizeParticipants();
}

/** Copy one admitted participant's saved input into a lexical local row. */
function participantDraft(person: typeof props.participants[number]) {
    // An absent explicit assignment retains the existing factor-one default.
    // Wire precision does not add trailing zeroes to this clean native-like form;
    // live lexical input is retained separately until this editor releases it.
    const assignment = props.pool.assignments?.find(row => row.registrationId === person.id);
    return {...person, selected: props.pool.assignAll || !!assignment,
        factor: financeDecimal(assignment?.factor ?? '1'), exempt: assignment?.isExempt ?? false};
}

/** Adopt saved fields only while clean. A sibling save, polling or locale read
 * cannot replace lexical factors and selections belonging to this form. */
function savedDraft() {
    // Keep actual admitted membership distinct from the checkbox's assign-all
    // projection, and retain disabled per-person values for local reselection.
    return {assignAll: props.pool.assignAll, isDefault: props.pool.isDefault,
        subtractPersonalInvoices: props.pool.settings?.subtractPersonalInvoices ?? true,
        rows: props.participants.map(participantDraft)};
}
/** Reconcile the admitted roster while preserving each surviving participant's
 * independently edited factor, exemption and selection. Names/contact fields
 * follow the fresh roster, and newly admitted people gain ordinary saved defaults. */
function synchronizeParticipants(): void {
    const current = new Map(draft.rows.map(row => [row.id, row]));
    // A removed registration cannot retain a displayed private roster entry;
    // stable IDs keep surviving lexical fields attached to the same person.
    draft.rows = props.participants.map(person => {
        const previous = current.get(person.id);
        return previous ? {...previous, ...person} : participantDraft(person);
    });
}
/** Explicit discard restores this form's latest saved input, including a
 * confirmed submission newer than the last successfully delivered Query. */
function restoreSaved(): void {
    Object.assign(draft, JSON.parse(baseline.value));
    dirty.value = false;
}
function markDirty(): void { dirty.value = true; }
/** Assign-all changes the rendered selection without replacing the remembered
 * individual draft. Switching it off restores those deliberate selections. */
function toggleAll(value: boolean): void {
    draft.assignAll = value;
    dirty.value = true;
}
function updateDefault(value: boolean): void { draft.isDefault = value; dirty.value = true; }
function updateInvoiceDeduction(value: boolean): void { draft.subtractPersonalInvoices = value; dirty.value = true; }
function selectRow(row: typeof draft.rows[number], event: Event): void {
    row.selected = (event.target as HTMLInputElement).checked;
    dirty.value = true;
}
function discard(): void {
    if (!action.isAvailable()) return;
    restoreSaved();
    command.setInformation('finance.unsavedEditsDiscardedTheFormNowShowsItsSaved');
}

/** A filtered required factor must remain reachable when native validation
 * rejects it. Reveal the row before the browser tries to focus its control. */
async function revealInvalid(event: Event): Promise<void> {
    const control = event.target as HTMLInputElement;
    if (!search.value || !control.closest('[data-finance-assignment]')) return;
    // Suppress this hidden-control focus attempt, then use the same validity
    // message once the ordinary search has exposed the original mounted node.
    event.preventDefault(); search.value = '';
    await nextTick(); control.reportValidity();
}

/** Submit selected factors/exemptions only; deselected controls retain their
 * displayed draft without silently contributing to a saved membership request. */
async function save(event: Event): Promise<void> {
    if (!action.isAvailable() || !(event.target as HTMLFormElement).reportValidity()) return;
    const selected = draft.rows.filter(row => draft.assignAll || row.selected);
    const input = {assignAll: draft.assignAll, isDefault: draft.isDefault, subtractPersonalInvoices: draft.subtractPersonalInvoices,
        registrations: selected.map(row => row.id), exemptions: selected.filter(row => row.exempt).map(row => row.id),
        participantFactors: Object.fromEntries(selected.map(row => [row.id, financeDecimal(row.factor, 4)]))};
    // This input save leaves a closed pool's saved shares and payments intact.
    const saved = await command.run(scope => api.assignments(props.eventId, props.pool.id, input, scope), true, false,
        {success: props.pool.status === 'CLOSED' ? 'finance.participantsAndFactorsSavedClosed' : 'finance.participantsAndFactorsSaved'});
    // Keep the confirmed submitted controls even when the following read failed.
    // A later authoritative snapshot may update this newly clean form.
    if (saved) {
        // The follow-up read can admit another registration while pending kept
        // the submitted controls fixed. Include it now without losing old input.
        synchronizeParticipants();
        // Deselected factor/exemption fields were not submitted. Preserve their
        // visible local values until dismissal, but discard restores their absent
        // assignment defaults instead of treating those values as persisted.
        baseline.value = JSON.stringify({...draft, rows: draft.rows.map(row => ({...row,
            selected: draft.assignAll || row.selected,
            factor: draft.assignAll || row.selected ? row.factor : '1',
            exempt: (draft.assignAll || row.selected) && row.exempt}))});
        dirty.value = false;
    }
}
async function refresh(): Promise<void> {
    if (props.active && await command.reconcileSafely(props.refresh)) receiveSaved();
}
/** Close only after this form's pending/unknown/dirty departure decision. */
function close(): void {
    if (!command.mayLeave()) return;
    // Explicit dismissal releases this draft alone; sibling editors stay mounted.
    command.acknowledge(); restoreSaved(); emit('close');
}
</script>

<template>
    <AppDialog content-class="text-white finance-dialog" :open="open" :title="messages.t('finance.participantsFactors')" :subtitle="pool.name" standard
               :pending="command.pending.value || command.recovering.value" @close="close">
        <CommandFeedback :feedback="command.feedback" :part="command.uncertain.value ? 'error' : 'all'" />
        <CommandFeedback :feedback="command.feedback" part="uncertain" :action="{state: command.recoveryAction, label: messages.t('common.refresh')}" @action="refresh" />
        <p v-if="pool.status === 'CLOSED'" class="small text-warning">{{ messages.t('finance.saveYourChangesHereThenPreviewRecalculatePoolExisting') }}</p>
        <form :id="`${id}-form`" data-finance-assignments @submit.prevent="save"
              @invalid.capture="revealInvalid" @wheel.capture.passive="protectFinanceNumberFromScroll">
            <fieldset class="border-0 p-0 m-0" :disabled="action.disabled.value">
                <legend class="visually-hidden">{{ messages.t('finance.participantsFactors') }}</legend>
                <FinanceEnrollmentFields
                    :assign-all="draft.assignAll" :is-default="draft.isDefault" :subtract-personal-invoices="draft.subtractPersonalInvoices"
                    :all-id="`${id}-all`" :default-id="`${id}-default`" :subtract-id="`${id}-subtract`"
                    all-name="assignAll" default-name="isDefault" subtract-name="subtractPersonalInvoices"
                    :all-label="messages.t('finance.assignToAllParticipants')"
                    :default-label="messages.t('finance.defaultForNewParticipants')"
                    :subtract-label="messages.t('finance.deductSubmitterInvoicesFromTheirShare')"
                    @update:assign-all="toggleAll" @update:is-default="updateDefault"
                    @update:subtract-personal-invoices="updateInvoiceDeduction"
                >
                    <p class="small text-secondary mt-2">{{ messages.t('finance.defaultPoolsAutomaticallyIncludeFutureParticipantsEachNewParticipant') }}</p>
                </FinanceEnrollmentFields>
                <div class="border border-secondary-subtle rounded-3 p-3 mb-3">
                    <strong>{{ messages.t('finance.shareFactors') }}</strong>
                    <p class="small mb-1">{{ messages.t('finance.isTheDefaultGivesMoreWeightGivesHalfThe') }}</p>
                    <p class="small text-secondary mb-0">{{ messages.t('finance.factorsApplyToTheParticipantDaysAttendedOrNights') }}</p>
                </div>
                <FormField :id="`${id}-search`" v-model="search" type="search" class="mb-2"
                           :label="messages.t('finance.searchParticipants')" :placeholder="messages.t('finance.filterByNameOrEmail')" />
                <div class="pool-participant-list border border-secondary-subtle rounded-3 bg-black">
                    <div v-for="row in draft.rows" v-show="visible.includes(row)" :key="row.id" class="pool-participant-row p-3 border-bottom border-secondary-subtle" :data-finance-assignment="row.id">
                        <div class="form-check mb-0">
                            <input :id="`${id}-registration-${row.id}`" :checked="draft.assignAll || row.selected" class="form-check-input"
                                   type="checkbox" :disabled="draft.assignAll" @change="selectRow(row, $event)" />
                            <label :for="`${id}-registration-${row.id}`" class="form-check-label">
                                <strong class="d-block">{{ row.name }}</strong>
                                <small class="text-secondary">{{ row.email }}</small>
                            </label>
                        </div>
                        <FormField :id="`${id}-factor-${row.id}`" v-model="row.factor" :name="null" type="number" lexical-number
                            input-mode="decimal" min="0" max="1000" step="0.0001" required :disabled="!draft.assignAll && !row.selected"
                            class="pool-factor-field" control-class="form-control-sm" label-class="small mb-1"
                            :label="messages.t('finance.shareFactor')" :required-marker="false" :described-by="`${id}-factor-help`"
                            @update:model-value="markDirty" />
                        <div class="form-check form-switch mb-0">
                            <input :id="`${id}-exempt-${row.id}`" v-model="row.exempt" class="form-check-input" type="checkbox" :disabled="!draft.assignAll && !row.selected" @change="markDirty" />
                            <label :for="`${id}-exempt-${row.id}`" class="form-check-label">{{ messages.t('finance.exempt') }}</label>
                        </div>
                    </div>
                    <p v-if="!draft.rows.length" class="small text-secondary p-3 mb-0">{{ messages.t('finance.noParticipantsYet') }}</p>
                </div>
                <p :id="`${id}-factor-help`" class="small text-secondary mt-2 mb-0">{{ messages.t('finance.factorsCanBeToWithUpToFourDecimal') }}</p>
            </fieldset>
        </form>
        <template #footer>
            <ActionButton variant="outline-secondary" :state="action" @click="discard">{{ messages.t('finance.discardEdits') }}</ActionButton>
            <ActionButton variant="secondary" :disabled="command.pending.value || command.recovering.value" @click="close">{{ messages.t('common.close') }}</ActionButton>
            <ActionButton :form="`${id}-form`" type="submit" :state="action">{{ messages.t('finance.saveParticipantsFactors') }}</ActionButton>
        </template>
    </AppDialog>
</template>
