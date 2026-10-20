<script setup lang="ts">
import {computed, reactive, ref, useId, watch} from 'vue';
import type {components} from '../../../types/api/v1';
import type {PilotPlainMessageKey, PilotRequestScope} from '../../../types/FrontendPilotUiTypes';
import {useActionState, usePilot} from '../../app/context';
import {useCommand} from '../../composables/command';
import {useFinanceApi} from './api';
import {financeDecimal, protectFinanceNumberFromScroll} from './numbers';
import {financeMoney} from './presentation';
import FinanceHistory from './FinanceHistory.vue';
import ActionButton from '../../components/ActionButton.vue';
import AppDialog from '../../components/AppDialog.vue';
import CommandFeedback from '../../components/CommandFeedback.vue';
import FormField from '../../components/FormField.vue';

// One selected invoice owns its edit/review lifetime. Fresh reads never replace
// the captured revision or original evidence behind a confirmation already open.
const props = defineProps<{
    eventId: string;
    invoice: components['schemas']['FinanceInvoice'];
    currentInvoice?: components['schemas']['FinanceInvoice'];
    pool: components['schemas']['FinancePool'];
    action: 'approve' | 'decline' | 'revise' | 'reject' | 'close';
    open: boolean;
    active: boolean;
    refresh: () => Promise<void>;
}>();
const emit = defineEmits<{close: []; saved: [notice: PilotPlainMessageKey]}>();
const context = usePilot();
const {messages, locale} = context;
const api = useFinanceApi(context);
const id = useId();
const form = ref<HTMLFormElement | null>(null);
const invoice = ref({...props.invoice});
const closedPool = ref(props.pool.status === 'CLOSED');
const operation = ref(props.action);
const reviewing = ref(false);
const inspected = ref(false);
const completed = ref(false);
const draft = reactive(initialDraft());
const baseline = ref(JSON.stringify(draft));
const capturedRevision = ref<components['schemas']['FinanceRevisionInput'] | null>(null);
const capturedRejection = ref<components['schemas']['FinanceAcceptedRejectionInput'] | null>(null);
const retroactive = computed(() => operation.value === 'revise' || operation.value === 'reject');
const rejection = computed(() => operation.value === 'decline' || operation.value === 'reject');
const command = useCommand(props.refresh, true, {dirty: () => JSON.stringify(draft) !== baseline.value,
    unknownMessage: 'draft.leaveUnknown', recoveryEligible: () => props.active});
const actionState = useActionState({eligible: () => props.active && !completed.value, blocked: () => command.action.disabled.value});
const recovery = useActionState({eligible: () => props.active, blocked: () => command.recoveryAction.disabled.value,
    pending: () => command.recovering.value});
const title = computed(() => reviewing.value ? 'finance.confirmInvoiceChange' : operation.value === 'revise'
    ? 'finance.correctInvoice' : operation.value === 'reject' ? 'finance.rejectInvoiceFromPool'
        : operation.value === 'approve' ? 'finance.accept' : operation.value === 'decline' ? 'finance.reject' : 'finance.close');
const effectiveAmount = computed(() => draft.amount ? draft.amount : invoice.value.correctedAmount ?? invoice.value.amount);
watch([() => props.invoice.id, () => props.action], resetSelection);

function initialDraft() {
    // Saved wire precision must not change the former clean form spelling.
    // Subsequent edits retain their exact lexical value until explicit reset.
    return {amount: props.action === 'revise' ? financeDecimal(props.invoice.correctedAmount ?? props.invoice.amount) : '',
        description: props.action === 'revise' ? props.invoice.correctedDescription ?? props.invoice.description ?? '' : '', reason: ''};
}

/** A different row or action starts a distinct review. Revalidation of the same
 * selected row preserves the original capture and all unfinished lexical input. */
function resetSelection(): void {
    invoice.value = {...props.invoice}; operation.value = props.action; closedPool.value = props.pool.status === 'CLOSED';
    Object.assign(draft, initialDraft()); baseline.value = JSON.stringify(draft);
    reviewing.value = false; inspected.value = false; completed.value = false;
    capturedRevision.value = null; capturedRejection.value = null;
}
function close(): void {
    if (!command.mayLeave()) return;
    if (command.uncertain.value) command.acknowledge();
    emit('close');
}

/** Freeze a retroactive change for its distinct final confirmation. Both review
 * stages keep the original pool revision rather than adopting a refresh token. */
async function submit(): Promise<void> {
    if (!actionState.isAvailable() || !form.value) return;
    // Native NEW acceptance reads optional numeric corrections from a row's
    // button, without HTML step/min validation. Preserve its positive-number
    // contract; generated validation and the shared controller decide admission.
    if (operation.value !== 'approve' && !form.value.reportValidity()) return;
    if (rejection.value && !draft.reason.trim()) {
        command.setError('finance.enterARejectionReasonBeforeRejectingThisInvoice');
        return;
    }
    if (retroactive.value && !reviewing.value) {
        // Blank correction text restores the original description. Rejection
        // carries only its own required reason and cannot leak a correction.
        capturedRevision.value = {confirmed: true, expectedRevision: invoice.value.revision,
            correctedAmount: financeDecimal(draft.amount), correctedDescription: draft.description.trim() || null};
        capturedRejection.value = {confirmed: true, expectedRevision: invoice.value.revision, rejectionReason: draft.reason.trim()};
        reviewing.value = true;
        return;
    }
    await save();
}

/** Dispatch exactly the reviewed operation once. Original evidence stays in the
 * server audit record; neither correction nor invoice closure settles a share. */
async function save(): Promise<void> {
    const row = invoice.value;
    const selected = operation.value;
    const acceptance = {...(draft.amount ? {correctedAmount: financeDecimal(draft.amount)} : {}),
        ...(draft.description.trim() ? {correctedDescription: draft.description.trim()} : {})};
    const decline = {rejectionReason: draft.reason.trim()};
    const revision = capturedRevision.value;
    const rejected = capturedRejection.value;
    if (selected === 'revise' && !revision || selected === 'reject' && !rejected) return;
    inspected.value = false;
    // All fields, action and revision were captured before pending disables the
    // form. Refresh may fail after confirmation without changing that outcome.
    const notice = successNotice(selected);
    const result = await command.run(dispatch, true, true, {success: notice});
    if (!result) return;
    // Retain a failed-read warning with its actual command owner. The completed
    // fields remain visible and locked; closing cannot offer the saved write again.
    baseline.value = JSON.stringify(draft);
    completed.value = true;
    if (command.outcome.value?.refresh !== 'failed') {
        // The dialog retires on normal confirmation. Its parent receives the
        // completed notice for the persistent common host before this unmounts.
        emit('saved', notice);
        emit('close');
    }

    /** Select one authored transport operation from the captured review. */
    function dispatch(scope: PilotRequestScope) {
        // Every branch receives only the fields admitted for its reviewed action.
        if (selected === 'approve') return api.approve(props.eventId, row.poolId, row.id, acceptance, scope);
        if (selected === 'decline') return api.decline(props.eventId, row.poolId, row.id, decline, scope);
        if (selected === 'revise') return api.revise(props.eventId, row.poolId, row.id, revision!, scope);
        if (selected === 'reject') return api.rejectAccepted(props.eventId, row.poolId, row.id, rejected!, scope);
        return api.organizerClose(props.eventId, row.poolId, row.id, scope);
    }
}

/** Report the existing action-specific receipt, including the closed-pool
 * distinction that changing source inputs leaves saved shares unchanged. */
function successNotice(action: typeof props.action): PilotPlainMessageKey {
    if (action === 'approve') return 'finance.invoiceAccepted2';
    if (action === 'decline') return 'finance.invoiceRejected2';
    if (action === 'close') return 'finance.invoiceClosed2';
    // Retroactive source changes have a separate recalculation reminder.
    if (action === 'revise') return closedPool.value ? 'finance.invoiceCorrectedClosed' : 'finance.invoiceCorrected';
    return closedPool.value ? 'finance.invoiceRejectedClosed' : 'finance.invoiceRejectedFromThePool';
}

/** A stale review must be explicitly abandoned and reopened from current data.
 * Inspection alone never upgrades this review's captured calculation revision. */
async function inspectSaved(): Promise<void> {
    if (recovery.isAvailable() && await command.reconcileSafely(props.refresh)) inspected.value = true;
}
function acknowledge(): void {
    if (!inspected.value || command.pending.value || command.recovering.value) return;
    command.acknowledge();
    emit('close');
}
</script>

<template>
    <AppDialog content-class="text-white finance-dialog" :open="open" :title="messages.t(title)" :pending="command.pending.value || command.recovering.value" standard @close="close">
        <CommandFeedback :feedback="command.feedback" :part="command.uncertain.value ? 'error' : 'all'" />
        <CommandFeedback :feedback="command.feedback" part="uncertain" :action="{state: recovery, label: messages.t('common.refresh')}" @action="inspectSaved">
            <template #uncertain>
                <ActionButton v-if="inspected" variant="outline-warning" class="mt-2" :state="recovery" @click="acknowledge">{{ messages.t('draft.review') }}</ActionButton>
            </template>
        </CommandFeedback>
        <FinanceHistory v-if="inspected && command.uncertain.value" :invoices="currentInvoice ? [currentInvoice] : []" admin read-only disabled @refresh="inspectSaved" />
        <p class="fw-semibold">{{ messages.t('finance.countedInvoiceDetails', {invoiceId: invoice.id,
            amount: financeMoney(invoice.correctedAmount ?? invoice.amount, locale)}) }} — {{ invoice.poolName }}</p>
        <p class="small invoice-description">{{ invoice.description || messages.t('finance.noDescription') }}</p>
        <form ref="form" :id="`${id}-form`" :novalidate="operation === 'approve'" @submit.prevent="submit"
              @wheel.capture.passive="protectFinanceNumberFromScroll" data-finance-invoice-review>
            <!-- The first stage remains mounted behind final review, preserving
                 its exact input and caret lifecycle when Back to edit is used. -->
            <fieldset v-show="!reviewing" class="border-0 p-0 m-0" :disabled="actionState.disabled.value || reviewing">
                <template v-if="operation === 'approve' || operation === 'revise'">
                    <p v-if="operation === 'revise'" class="small text-secondary">{{ messages.t('finance.correctTheEffectiveAmountOrDescriptionTheOriginalInvoice') }}</p>
                    <FormField :id="`${id}-amount`" v-model="draft.amount" name="correctedAmount" type="number" lexical-number
                        input-mode="decimal" min="0.01" :max="operation === 'revise' ? '99999999.99' : undefined" step="0.01" class="mb-3"
                        :label="messages.t(operation === 'approve' ? 'finance.correctedAmount2' : 'finance.amount')"
                        :required="operation === 'revise'" :required-marker="false"
                        :placeholder="operation === 'approve' ? messages.t('finance.keep', {fmtMoney: financeMoney(invoice.amount, locale)}) : undefined" />
                    <FormField :id="`${id}-description`" v-model="draft.description" class="mb-3" name="correctedDescription" multiline :rows="3"
                        :label="messages.t(operation === 'approve' ? 'finance.correctedDescription2' : 'finance.description')" :max-length="4000"
                        :placeholder="operation === 'approve' ? messages.t('finance.leaveBlankToKeepSubmittedDescription') : undefined">
                        <small v-if="operation === 'revise'" class="text-secondary">{{ messages.t('finance.leaveThisEmptyToRestoreTheOriginalDescription') }}</small>
                    </FormField>
                </template>
                <template v-if="rejection">
                    <p v-if="operation === 'reject'" class="small text-secondary">{{ messages.t('finance.rejectingRemovesThisAcceptedCostFromThePoolTotal') }}</p>
                    <FormField :id="`${id}-reason`" v-model="draft.reason" name="rejectionReason" class="mb-3" multiline :rows="3"
                        :label="messages.t('finance.rejectionReason')" :max-length="4000" required :required-marker="false" />
                </template>
                <p v-if="operation === 'approve' || operation === 'decline' || operation === 'close'">
                    {{ messages.t(operation === 'approve' ? 'finance.confirmAcceptInvoice' : operation === 'decline'
                        ? 'finance.confirmRejectInvoice' : 'finance.confirmCloseInvoice', {amount: financeMoney(effectiveAmount, locale)}) }}
                </p>
            </fieldset>
            <template v-if="reviewing">
                <template v-if="operation === 'revise'">
                    <p><strong>{{ messages.t('finance.newAmount') }}: </strong>{{ financeMoney(capturedRevision?.correctedAmount ?? invoice.amount, locale) }}</p>
                    <p class="invoice-description"><strong>{{ messages.t('finance.description') }}: </strong>{{ (capturedRevision?.correctedDescription ?? invoice.description) || messages.t('finance.noDescription') }}</p>
                </template>
                <p v-else class="invoice-description"><strong>{{ messages.t('finance.rejectionReason') }}: </strong>{{ capturedRejection?.rejectionReason }}</p>
                <p v-if="closedPool" class="text-warning small">{{ messages.t('finance.existingSharesAndPaymentsStayUnchangedRecalculateThisClosed') }}</p>
                <p class="small text-secondary">{{ messages.t('finance.theChangeIsSavedOnlyAfterYouConfirmBelow') }}</p>
            </template>
        </form>
        <template #footer>
            <ActionButton v-if="reviewing && !completed" variant="secondary" :disabled="command.pending.value || command.recovering.value || command.uncertain.value" @click="reviewing = false">
                {{ messages.t('finance.backToEdit') }}
            </ActionButton>
            <ActionButton v-else variant="secondary" :disabled="command.pending.value || command.recovering.value" @click="close">{{ messages.t(completed ? 'common.close' : 'common.cancel') }}</ActionButton>
            <ActionButton v-if="!completed" type="submit" :form="`${id}-form`" :state="actionState" :variant="rejection ? 'danger' : reviewing ? 'warning' : 'primary'">
                {{ messages.t(retroactive && !reviewing ? 'finance.continue' : operation === 'revise' ? 'finance.confirmCorrection'
                    : operation === 'reject' ? 'finance.confirmRejection' : 'finance.confirm') }}
            </ActionButton>
        </template>
    </AppDialog>
</template>
