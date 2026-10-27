<script setup lang="ts">
import {fieldAttributes as invoiceFields} from '../../../../.generated/api/v1/browser/validateFinanceOrganizerInvoiceInput.mjs';
import {proofFileAccept} from '../../../common/lib/fileMedia';
import {computed, reactive, ref, useId, watch} from 'vue';
import type {components} from '../../../types/api/v1';
import {useActionState, useFrontend} from '../../app/context';
import {useCommand, useCommandReview} from '../../composables/command';
import {useFinanceApi} from './api';
import {financeDecimal, protectFinanceNumberFromScroll} from './numbers';
import FinanceHistory from './FinanceHistory.vue';
import ActionButton from '../../components/ActionButton.vue';
import AppDialog from '../../components/AppDialog.vue';
import CommandFeedback from '../../components/CommandFeedback.vue';
import FileField from '../../components/FileField.vue';
import FormField from '../../components/FormField.vue';

// This expense has one draft and exact optional File. Paid-by attribution never
// substitutes the authenticated recorder; the shared controller records both.
const props = defineProps<{
    eventId: string;
    pool: components['schemas']['FinancePool'];
    participants: NonNullable<components['schemas']['FinanceView']['participants']>;
    invoices?: components['schemas']['FinanceInvoice'][];
    open: boolean;
    active: boolean;
    refresh: () => Promise<void>;
}>();
const emit = defineEmits<{close: []; history: []}>();
const context = useFrontend();
const {messages} = context;
const api = useFinanceApi(context);
const id = useId();
const form = ref<HTMLFormElement | null>(null);
const draft = reactive({amount: '', description: '', registrationId: ''});
const proof = ref<File | null>(null);
const command = useCommand(props.refresh, true, {dirty: () => !!draft.amount || !!draft.description || !!draft.registrationId || !!proof.value,
    unknownMessage: 'draft.leaveUnknown', recoveryEligible: () => props.active});

/** Inspection refreshes saved history without resubmitting this creation. Its
 * acknowledgement remains an explicit human decision, never a row heuristic. */
const {inspected, inspect: inspectHistory, acknowledge} = useCommandReview(command, () => props.refresh(), {
    eligible: () => recovery.isAvailable(), release: releaseDraft, afterInspect: () => { emit('history'); },
});
const action = useActionState({eligible: () => props.active, blocked: () => command.action.disabled.value});
const recovery = useActionState({eligible: () => props.active, blocked: () => command.recoveryAction.disabled.value,
    pending: () => command.recovering.value});
const eligible = computed(() => props.participants.filter(participant => props.pool.assignAll
    || (props.pool.registrationIds ?? []).includes(participant.id)));
watch([() => props.eventId, () => props.pool.id, context.epoch, () => context.session.value?.context], releaseDraft);

function releaseDraft(): void {
    draft.amount = ''; draft.description = ''; draft.registrationId = ''; proof.value = null; inspected.value = false;
}
function close(): void {
    if (!command.mayLeave()) return;
    if (command.uncertain.value) command.acknowledge();
    releaseDraft();
    emit('close');
}



/** Capture one organizer expense before locking its controls. Optional proof
 * and participant attribution remain absent when the user selected neither. */
async function submit(): Promise<void> {
    if (!action.isAvailable() || !form.value?.reportValidity()) return;
    if (!draft.description.trim()) {
        command.setError('finance.enterADescriptionForThisExpense');
        return;
    }
    const input = {amount: financeDecimal(draft.amount), description: draft.description.trim(),
        ...(draft.registrationId ? {registrationId: draft.registrationId} : {})};
    const poolId = props.pool.id;
    const file = proof.value;
    inspected.value = false;
    // A transfer callback is progress only. Generated application confirmation
    // alone releases the expense; unknown delivery never uploads it a second time.
    const result = await command.run(scope => api.record(props.eventId, poolId, input, file, scope, transferProgress),
        true, true, {success: props.pool.status === 'CLOSED' ? 'finance.expenseAddedClosed' : 'finance.expenseAddedAndAccepted'});
    if (!result) return;
    releaseDraft();
    emit('history');
}
function transferProgress(): void { /* The shared command pending state covers transfer and application confirmation. */ }
</script>

<template>
    <AppDialog content-class="text-white finance-dialog" :open="open"
        :title="messages.t('finance.poolDialogTitle', {title: messages.t('finance.addInvoiceAmount'), name: pool.name})"
        :pending="command.pending.value || command.recovering.value" @close="close">
        <CommandFeedback :feedback="command.feedback" :part="command.uncertain.value ? 'error' : 'all'" />
        <CommandFeedback :feedback="command.feedback" part="uncertain"
            unknown-message="finance.weCouldNotConfirmWhetherYourInvoiceWasSaved"
            :action="{state: recovery, label: messages.t('finance.checkInvoiceHistory')}" @action="inspectHistory">
            <template #uncertainActions>
                <!-- History inspection blocks this local acknowledgement, but
                     its pending read belongs only to the inspection control. -->
                <ActionButton v-if="inspected" variant="outline-warning" :disabled="recovery.disabled.value" @click="acknowledge">
                    {{ messages.t('finance.reviewedHistory') }}
                </ActionButton>
            </template>
        </CommandFeedback>
        <FinanceHistory v-if="inspected && command.uncertain.value" :invoices="invoices ?? []" admin read-only disabled @refresh="inspectHistory" />
        <form ref="form" :id="`${id}-form`" enctype="multipart/form-data" @submit.prevent="submit"
              @wheel.capture.passive="protectFinanceNumberFromScroll" data-finance-organizer-invoice>
            <p class="small">{{ messages.t('finance.addASharedPoolExpenseWithoutRegisteringForThe') }}</p>
            <p v-if="pool.status === 'CLOSED'" class="text-warning small">{{ messages.t('finance.thisAddsASavedCostExistingSharesStayUnchanged') }}</p>
            <fieldset class="border-0 p-0 m-0" :disabled="action.disabled.value">
                <FormField :id="`${id}-amount`" v-model="draft.amount" name="amount" type="number" lexical-number
                    input-mode="decimal" min="0.01" max="99999999.99" step="0.01" class="mb-3"
                    :label="messages.t('finance.amount')" required :required-marker="false"
                    :pending="command.pending.value" />
                <FormField :id="`${id}-participant`" class="mb-3" :label="messages.t('finance.paidByParticipantOptional')">
                    <template #control>
                        <select :id="`${id}-participant`" v-model="draft.registrationId" name="registrationId" class="form-select text-bg-dark"
                            :aria-describedby="`${id}-participant-help`">
                            <option value="">{{ messages.t('finance.sharedOrganizerExpense') }}</option>
                            <!-- Retain an invalidated local choice visibly until the
                                 user changes it; the controller rechecks membership. -->
                            <option v-if="draft.registrationId && !eligible.some(participant => String(participant.id) === draft.registrationId)"
                                :value="draft.registrationId" disabled>
                                {{ participants.find(participant => String(participant.id) === draft.registrationId)?.name ?? draft.registrationId }}
                            </option>
                            <option v-for="participant in eligible" :key="participant.id" :value="String(participant.id)">{{ participant.name }}</option>
                        </select>
                    </template>
                    <small :id="`${id}-participant-help`" class="text-secondary">{{ messages.t('finance.organizerInvoiceAttributionHelp') }}</small>
                </FormField>
                <FormField :id="`${id}-description`" v-model="draft.description" class="mb-3" name="description"
                    :label="messages.t('finance.description')" multiline :rows="3" :max-length="invoiceFields.description.maxLength" required :required-marker="false"
                    :pending="command.pending.value" />
                <FileField :id="`${id}-proof`" name="proof" class="mb-3" :label="messages.t('finance.proofOptional')"
                    :selected-file="proof" :accept="proofFileAccept" :described-by="`${id}-proof-help`" @choose="proof = $event">
                    <small :id="`${id}-proof-help`" class="text-secondary">{{ messages.t('finance.attachAnImageOrPDFReceiptOrLeaveThis') }}</small>
                </FileField>
            </fieldset>
        </form>
        <template #bodyActions>
            <ActionButton variant="secondary" :disabled="command.pending.value || command.recovering.value" @click="close">{{ messages.t('common.cancel') }}</ActionButton>
            <ActionButton type="submit" :form="`${id}-form`" :state="action"
                :pending="command.pending.value">{{ messages.t('finance.addExpense') }}</ActionButton>
        </template>
    </AppDialog>
</template>
