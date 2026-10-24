<script setup lang="ts">
import {computed, reactive, ref, useId, watch} from 'vue';
import type {components} from '../../../types/api/v1';
import {useActionState, usePilot} from '../../app/context';
import {useCommand} from '../../composables/command';
import {useFinanceApi} from './api';
import {useFinanceDraft} from './drafts';
import FinanceEnrollmentFields from './FinanceEnrollmentFields.vue';
import ActionButton from '../../components/ActionButton.vue';
import AppDialog from '../../components/AppDialog.vue';
import CommandFeedback from '../../components/CommandFeedback.vue';
import FormField from '../../components/FormField.vue';

// Creation and settings share only their matching base fields. Allocation is
// creation input here; its later independent save belongs to FinanceAssignments.
const props = defineProps<{
    eventId: string;
    pool?: components['schemas']['FinancePool'];
    participants: NonNullable<components['schemas']['FinanceView']['participants']>;
    pools?: components['schemas']['FinancePool'][];
    open: boolean;
    active: boolean;
    refresh: () => Promise<void>;
}>();
const emit = defineEmits<{close: []; saved: []}>();
const context = usePilot();
const {messages} = context;
const api = useFinanceApi(context);
const id = useId();
const form = ref<HTMLFormElement | null>(null);
const inspected = ref(false);
const draft = reactive(initialDraft());
const baseline = ref(JSON.stringify(draft));
const dirty = computed(() => JSON.stringify(draft) !== baseline.value);
const command = useCommand(props.refresh, true, {dirty: () => dirty.value, unknownMessage: 'draft.leaveUnknown',
    recoveryEligible: () => props.active});
useFinanceDraft(() => props.pool?.id, () => dirty.value || command.pending.value || command.uncertain.value);
const action = useActionState({eligible: () => props.active && (!props.pool || !!props.pool.settings),
    blocked: () => command.action.disabled.value});
const recovery = useActionState({eligible: () => props.active, blocked: () => command.recoveryAction.disabled.value,
    pending: () => command.recovering.value});
watch(() => props.pool, updateSavedBaseline);
watch([() => props.participants, command.pending, command.uncertain], synchronizeParticipants);
watch([() => props.eventId, context.epoch, () => context.session.value?.context], resetDraft);

/** Seed one admitted form from saved settings. The creation defaults match the
 * native form, including initial participant selection and rounded shares. */
function initialDraft() {
    const settings = props.pool?.settings;
    // Existing pool names and allocation flags are not part of a settings save.
    return {name: '', status: 'OPEN' as 'OPEN' | 'ORGANIZER_ONLY', description: props.pool?.description ?? '',
        distribution: settings?.distribution ?? 'TIME_BASED', roundUpShares: settings?.roundUpShares ?? true,
        sendCalculationEmails: settings?.sendCalculationEmails ?? true, assignAll: true, isDefault: false,
        subtractPersonalInvoices: true, registrations: props.participants.map(participant => participant.id)};
}

/** Refresh may update an untouched form; a real local draft retains its values
 * until its own save or explicit discard, even while sibling forms are saved. */
function updateSavedBaseline(): void {
    if (command.pending.value || command.uncertain.value) return;
    const retainDraft = dirty.value;
    const saved = initialDraft();
    // The last admitted source becomes the discard baseline even when a local
    // draft must remain visible. It never replaces pending/unknown submitted work.
    baseline.value = JSON.stringify(saved);
    if (!retainDraft) Object.assign(draft, saved);
}
function resetDraft(): void { Object.assign(draft, initialDraft()); baseline.value = JSON.stringify(draft); inspected.value = false; }

/** Restore this form's last confirmed/admitted values. A failed follow-up read
 * can leave props older than a completed settings save; Close and Discard must
 * not silently offer those old settings again when the dialog is reopened. */
function restoreDraft(): void {
    // Creation has no saved pool and retains its independent default/reset
    // lifecycle, including the latest automatically enrolled participant choices.
    if (!props.pool) { resetDraft(); return; }
    Object.assign(draft, JSON.parse(baseline.value));
    inspected.value = false;
}

/** Reconcile creation enrollment with the admitted roster. Automatic selection
 * includes current people; explicit choices retain surviving IDs without adding
 * newcomers or submitting removed, no-longer-rendered checkbox values. */
function synchronizeParticipants(): void {
    if (props.pool || command.pending.value || command.uncertain.value) return;
    const registrations = props.participants.map(participant => participant.id);
    const admitted = new Set(registrations);
    // Pending/unknown submission owns its captured values. Otherwise release
    // retired IDs from both the visible draft and its clean comparison baseline.
    draft.registrations = draft.assignAll ? registrations : draft.registrations.filter(id => admitted.has(id));
    const saved = JSON.parse(baseline.value);
    saved.registrations = saved.assignAll ? registrations : saved.registrations.filter((id: string) => admitted.has(id));
    baseline.value = JSON.stringify(saved);
}

/** Default controls future enrollment independently of the current selection.
 * Partial current membership remains a valid draft for an automatic default. */
function updateDefault(value: boolean): void {
    draft.isDefault = value;
}
/** Assign-all controls only the current chooser and its automatic selections. */
function updateAssignAll(value: boolean): void {
    draft.assignAll = value;
    // Checking All restores the current participant selection without saving
    // anything or changing the independent future-enrollment default.
    if (draft.assignAll) draft.registrations = props.participants.map(participant => participant.id);
}
function close(): void {
    if (!command.mayLeave()) return;
    if (command.uncertain.value) command.acknowledge();
    restoreDraft();
    emit('close');
}

/** Save only this form's fields through the existing business owner. A saved
 * response releases completed input even if its following authority read fails. */
async function save(): Promise<void> {
    if (!action.isAvailable() || !form.value?.reportValidity()) return;
    const settings = {description: draft.description, distribution: draft.distribution,
        roundUpShares: draft.roundUpShares, sendCalculationEmails: draft.sendCalculationEmails};
    const pool = props.pool;
    inspected.value = false;
    // Capture this independent save before disabling its mounted controls.
    const creation = {...settings, name: draft.name, status: draft.status, assignAll: draft.assignAll,
        isDefault: draft.isDefault, subtractPersonalInvoices: draft.subtractPersonalInvoices,
        registrations: [...draft.registrations]};
    const result = await command.run(scope => pool ? api.settings(props.eventId, pool.id, settings, scope)
        : api.createPool(props.eventId, creation, scope), true, true, {success: pool
        ? pool.status === 'CLOSED' ? 'finance.poolSettingsSavedClosed' : 'finance.poolSettingsSaved' : 'finance.poolCreated'});
    if (!result) return;
    // A settings confirmation adopts the submitted values, never a stale read.
    if (pool) baseline.value = JSON.stringify(draft); else resetDraft();
    emit('saved');
    // Creation is complete once its write is confirmed. A failed following GET
    // must not keep a blank creation form open or invite another submission.
    if (!pool) emit('close');
}

/** Unknown delivery needs a deliberate fresh saved-data inspection. The review
 * action acknowledges that ambiguity without replaying creation or settings. */
async function inspectSaved(): Promise<void> {
    if (recovery.isAvailable() && await command.reconcileSafely(props.refresh)) inspected.value = true;
}
function acknowledge(): void {
    if (!inspected.value || command.pending.value || command.recovering.value) return;
    command.acknowledge();
    resetDraft();
}
</script>

<template>
    <AppDialog content-class="text-white finance-dialog" :open="open" :title="messages.t(pool ? 'finance.poolSettings' : 'finance.createANewPool')" :subtitle="pool?.name"
        :pending="command.pending.value || command.recovering.value" standard @close="close">
        <!-- The shared dialog keeps this receipt renderer mounted across Close,
             moving confirmed feedback to the page host without copying it. -->
        <template #feedback>
            <CommandFeedback :feedback="command.feedback" :part="command.uncertain.value ? 'error' : 'all'" />
        </template>
        <CommandFeedback :feedback="command.feedback" part="uncertain"
            :action="{state: recovery, label: messages.t('common.refresh')}" @action="inspectSaved">
            <template #uncertainActions>
                <!-- Acknowledgement changes local review only. Another saved
                     read blocks it without assigning that read's pending focus. -->
                <ActionButton v-if="inspected" variant="outline-warning" :disabled="recovery.disabled.value" @click="acknowledge">
                    {{ messages.t('draft.review') }}
                </ActionButton>
            </template>
        </CommandFeedback>
        <div v-if="inspected && command.uncertain.value" class="border border-secondary-subtle rounded-3 p-3 mb-3">
            <template v-if="pool">
                <strong>{{ pool.name }}</strong>
                <p class="mb-0">{{ pool.description }}</p>
                <p class="mb-0">{{ messages.t('finance.shareDistributionMode') }}: {{ messages.t(pool.settings?.distribution === 'EQUAL'
                    ? 'finance.distributeAmongParticipants' : pool.settings?.distribution === 'NIGHTS'
                        ? 'finance.distributeAmongNightsStayed' : 'finance.distributeAmongDaysAttended') }}</p>
                <p class="mb-0">{{ messages.t('finance.roundBaseSharesUp') }}: {{ messages.t(pool.settings?.roundUpShares ? 'common.yes' : 'common.no') }}</p>
                <p class="mb-0">{{ messages.t('finance.sendCalculationEmailsAutomatically') }}: {{ messages.t(pool.settings?.sendCalculationEmails ? 'common.yes' : 'common.no') }}</p>
            </template>
            <template v-else>
                <p class="fw-semibold">{{ messages.t('finance.invoicePools') }}</p>
                <ul class="mb-0"><li v-for="savedPool in pools ?? []" :key="savedPool.id">{{ savedPool.name }} — {{ savedPool.description }}</li></ul>
            </template>
        </div>
        <form ref="form" :id="`${id}-form`" @submit.prevent="save" data-finance-pool-editor>
            <fieldset class="border-0 p-0 m-0" :disabled="action.disabled.value">
                <p v-if="pool?.status === 'CLOSED'" class="small text-warning">{{ messages.t('finance.saveYourChangesHereThenPreviewRecalculatePoolExisting') }}</p>
                <div class="row g-3">
                    <template v-if="!pool">
                        <FormField :id="`${id}-name`" v-model="draft.name" class="col-12" name="name"
                            :label="messages.t('finance.poolName2')" required :required-marker="false" :max-length="255"
                            :pending="command.pending.value" />
                        <FormField :id="`${id}-status`" class="col-12" :label="messages.t('finance.poolSubmissionState')">
                            <template #control>
                                <select :id="`${id}-status`" v-model="draft.status" name="status" class="form-select text-bg-dark" required>
                                    <option value="OPEN">{{ messages.t('finance.openForInvoices') }}</option>
                                    <option value="ORGANIZER_ONLY">{{ messages.t('finance.organizerInvoicesOnly') }}</option>
                                </select>
                            </template>
                            <p class="text-secondary small mt-2 mb-0">{{ messages.t('finance.poolSubmissionStateHelp') }}</p>
                        </FormField>
                    </template>
                    <!-- Creation and later settings compose this one field group;
                         their commands never collect another form's draft. -->
                    <FormField :id="`${id}-distribution`" class="col-12" :label="messages.t('finance.shareDistributionMode')">
                        <template #control>
                            <select :id="`${id}-distribution`" v-model="draft.distribution" name="distribution" class="form-select text-bg-dark" required>
                                <option value="TIME_BASED">{{ messages.t('finance.distributeAmongDaysAttended') }}</option>
                                <option value="NIGHTS">{{ messages.t('finance.distributeAmongNightsStayed') }}</option>
                                <option value="EQUAL">{{ messages.t('finance.distributeAmongParticipants') }}</option>
                            </select>
                        </template>
                    </FormField>
                    <FormField :id="`${id}-description`" v-model="draft.description" class="col-12" name="description"
                        :label="messages.t('finance.description')"
                        :pending="command.pending.value" />
                    <div class="col-12">
                        <div class="form-check form-switch">
                            <input :id="`${id}-rounding`" v-model="draft.roundUpShares" type="checkbox" name="roundUpShares" class="form-check-input" />
                            <label class="form-check-label" :for="`${id}-rounding`">{{ messages.t('finance.roundBaseSharesUp') }}</label>
                        </div>
                        <p class="text-secondary small mt-2 mb-0">{{ messages.t('finance.selectedRoundEachBaseShareUpToTheNext') }}</p>
                    </div>
                    <div v-if="pool" class="col-12">
                        <div class="form-check form-switch">
                            <input :id="`${id}-emails`" v-model="draft.sendCalculationEmails" type="checkbox" name="sendCalculationEmails" class="form-check-input" />
                            <label class="form-check-label" :for="`${id}-emails`">{{ messages.t('finance.sendCalculationEmailsAutomatically') }}</label>
                        </div>
                        <p class="text-secondary small mt-2 mb-0">{{ messages.t('finance.useThisAsTheDefaultWhenClosingOrRecalculating') }}</p>
                    </div>
                    <template v-else>
                        <div class="col-12">
                            <p class="form-label text-secondary">{{ messages.t('finance.allocation') }}</p>
                            <FinanceEnrollmentFields
                                :assign-all="draft.assignAll" :is-default="draft.isDefault" :subtract-personal-invoices="draft.subtractPersonalInvoices"
                                :all-id="`${id}-all`" :default-id="`${id}-default`" :subtract-id="`${id}-subtract`"
                                all-name="assignAll" default-name="isDefault" subtract-name="subtractPersonalInvoices"
                                :all-label="messages.t('finance.assignToAllParticipants')"
                                :default-label="messages.t('finance.makeThisTheDefaultPool')"
                                :subtract-label="messages.t('finance.deductSubmitterInvoicesFromTheirShare')"
                                subtract-class="mt-2"
                                @update:assign-all="updateAssignAll" @update:is-default="updateDefault"
                                @update:subtract-personal-invoices="draft.subtractPersonalInvoices = $event"
                            >
                                <template #afterDefault>
                                    <small class="text-secondary">{{ messages.t('finance.defaultPoolsAutomaticallyIncludeFutureParticipantsWithoutReopeningAssignments') }}</small>
                                </template>
                            </FinanceEnrollmentFields>
                        </div>
                        <div class="col-12">
                            <p class="form-label">{{ messages.t('finance.limitToParticipantsDisabledWhenAssignedToAll') }}</p>
                            <div class="assignments-list border border-secondary-subtle rounded-3 p-2 bg-black text-white">
                                <div v-for="participant in participants" :key="participant.id" class="form-check">
                                    <input :id="`${id}-participant-${participant.id}`" v-model="draft.registrations" :value="participant.id"
                                        type="checkbox" name="registrations" class="form-check-input" :disabled="draft.assignAll" />
                                    <label class="form-check-label" :for="`${id}-participant-${participant.id}`">
                                        {{ messages.t('finance.nameAndEmail', {name: participant.name, email: participant.email ?? ''}) }}
                                    </label>
                                </div>
                                <p v-if="!participants.length" class="text-secondary small mb-0">{{ messages.t('finance.noParticipantsYet') }}</p>
                            </div>
                        </div>
                    </template>
                </div>
            </fieldset>
        </form>
        <template #footer>
            <ActionButton v-if="pool" variant="outline-secondary" :disabled="command.action.disabled.value" @click="restoreDraft">{{ messages.t('finance.discardEdits') }}</ActionButton>
            <ActionButton variant="secondary" :disabled="command.pending.value || command.recovering.value" @click="close">{{ messages.t(pool ? 'common.close' : 'common.cancel') }}</ActionButton>
            <ActionButton type="submit" :form="`${id}-form`" :state="action"
                :pending="command.pending.value" :show-spinner="false">
                {{ messages.t(pool ? 'finance.savePoolSettings' : 'finance.addPool') }}
            </ActionButton>
        </template>
    </AppDialog>
</template>
