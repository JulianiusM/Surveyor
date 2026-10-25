<script setup lang="ts">
import type {FinanceInvoiceReviewInput, FinanceInvoiceReviewOwner} from '../../../types/FrontendFinanceReviewTypes';
import type {FrontendPlainMessageKey} from '../../../types/FrontendUiTypes';
import {useFrontend} from '../../app/context';
import {financeMoney} from './presentation';
import {protectFinanceNumberFromScroll} from './numbers';
import {useFinanceInvoiceReview} from './invoiceReview';
import FinanceHistory from './FinanceHistory.vue';
import ActionButton from '../../components/ActionButton.vue';
import AppDialog from '../../components/AppDialog.vue';
import CommandFeedback from '../../components/CommandFeedback.vue';
import FormField from '../../components/FormField.vue';

// An inline row supplies its existing feature owner. Standalone retroactive
// dialogs create that same owner once for their captured selection instead.
const props = defineProps<FinanceInvoiceReviewInput & {owner?: FinanceInvoiceReviewOwner}>();
const emit = defineEmits<{close: []; saved: [notice: FrontendPlainMessageKey]}>();
const {messages, locale} = useFrontend();
const owner = props.owner ?? useFinanceInvoiceReview(props, {
    close: () => emit('close'), saved: notice => emit('saved', notice),
});
const {id, form, invoice, closedPool, operation, reviewing, inspected, completed, draft,
    capturedRevision, capturedRejection, capturedNew, retroactive, rejection, command, actionState, recovery,
    title, effectiveAmount, submit, close, inspectSaved, acknowledge} = owner;
</script>

<template>
    <AppDialog content-class="text-white finance-dialog" :open="open" :title="messages.t(title)" :pending="command.pending.value || command.recovering.value" @close="close">
        <!-- Inline row owners persist through status/read updates. Their same
             receipt moves between this dialog and the page host on Close. -->
        <template v-if="inline" #feedback>
            <CommandFeedback :feedback="command.feedback" :part="command.uncertain.value ? 'error' : 'all'" />
        </template>
        <CommandFeedback v-if="!inline" :feedback="command.feedback" :part="command.uncertain.value ? 'error' : 'all'" />
        <CommandFeedback :feedback="command.feedback" part="uncertain" :action="{state: recovery, label: messages.t('common.refresh')}" @action="inspectSaved">
            <template #uncertainActions>
                <!-- Local acknowledgement stays blocked during a saved-data read
                     without borrowing that read action's spinner or focus. -->
                <ActionButton v-if="inspected" variant="outline-warning" :disabled="recovery.disabled.value" @click="acknowledge">{{ messages.t('draft.review') }}</ActionButton>
            </template>
        </CommandFeedback>
        <FinanceHistory v-if="inspected && command.uncertain.value" :invoices="currentInvoice ? [currentInvoice] : []" :admin="!participant" read-only disabled @refresh="inspectSaved" />
        <!-- Immediate presentation is shared with Close, independently of the
             inline flag which owns NEW row drafts and cancellation semantics. -->
        <p v-if="inline || operation === 'close'" class="fw-semibold">{{ messages.t('finance.invoiceNumber', {id: invoice.id}) }}</p>
        <p v-else class="fw-semibold">{{ messages.t('finance.countedInvoiceDetails', {invoiceId: invoice.id,
            amount: financeMoney(invoice.correctedAmount ?? invoice.amount, locale)}) }}</p>
        <p v-if="!inline && !retroactive && operation !== 'close'" class="small invoice-description">{{ invoice.description || messages.t('finance.noDescription') }}</p>
        <!-- Confirmation keeps an entered correction's lexical spelling;
             its untouched/rejected subject uses the displayed localized amount. -->
        <p v-if="inline">{{ messages.t(operation === 'approve' ? 'finance.confirmAcceptInvoice' : 'finance.confirmRejectInvoice', {
            amount: capturedNew?.action === 'approve' && capturedNew.amount ? capturedNew.amount : financeMoney(invoice.amount, locale),
        }) }}</p>
        <form ref="form" :id="`${id}-form`" :novalidate="operation === 'approve'" @submit.prevent="submit"
              @wheel.capture.passive="protectFinanceNumberFromScroll" data-finance-invoice-review>
            <!-- The first stage remains mounted behind final review, preserving
                 its exact input and caret lifecycle when Back to edit is used. -->
            <fieldset v-if="!inline" v-show="!reviewing" class="border-0 p-0 m-0" :disabled="actionState.disabled.value || reviewing">
                <template v-if="operation === 'approve' || operation === 'revise'">
                    <p v-if="operation === 'revise'" class="small text-secondary">{{ messages.t('finance.correctTheEffectiveAmountOrDescriptionTheOriginalInvoice') }}</p>
                    <FormField :id="`${id}-amount`" v-model="draft.amount" name="correctedAmount" type="number" lexical-number
                        input-mode="decimal" min="0.01" :max="operation === 'revise' ? '99999999.99' : undefined" step="0.01" class="mb-3"
                        :label="messages.t(operation === 'approve' ? 'finance.correctedAmount2' : 'finance.amount')"
                        :required="operation === 'revise'" :required-marker="false"
                        :placeholder="operation === 'approve' ? messages.t('finance.keep', {fmtMoney: financeMoney(invoice.amount, locale)}) : undefined"
                        :pending="command.pending.value" />
                    <FormField :id="`${id}-description`" v-model="draft.description" class="mb-3" name="correctedDescription" multiline :rows="3"
                        :label="messages.t(operation === 'approve' ? 'finance.correctedDescription2' : 'finance.description')" :max-length="4000"
                        :placeholder="operation === 'approve' ? messages.t('finance.leaveBlankToKeepSubmittedDescription') : undefined"
                        :pending="command.pending.value">
                        <small v-if="operation === 'revise'" class="text-secondary">{{ messages.t('finance.leaveThisEmptyToRestoreTheOriginalDescription') }}</small>
                    </FormField>
                </template>
                <template v-if="rejection">
                    <p v-if="operation === 'reject'" class="small text-secondary">{{ messages.t('finance.rejectingRemovesThisAcceptedCostFromThePoolTotal') }}</p>
                    <FormField :id="`${id}-reason`" v-model="draft.reason" name="rejectionReason" class="mb-3" multiline :rows="3"
                        :label="messages.t('finance.rejectionReason')" :max-length="4000" required :required-marker="false"
                        :pending="command.pending.value" />
                </template>
                <!-- Own-history Close supplies no amount to this question.
                     Keep that inherited presentation separate from organizer Close;
                     the unchanged submitted/effective evidence stays in its row. -->
                <p v-if="operation === 'approve' || operation === 'decline' || operation === 'close'">
                    {{ messages.t(operation === 'approve' ? 'finance.confirmAcceptInvoice' : operation === 'decline'
                        ? 'finance.confirmRejectInvoice' : 'finance.confirmCloseInvoice', {amount: participant && operation === 'close'
                            ? '' : financeMoney(operation === 'close' ? invoice.amount : effectiveAmount, locale)}) }}
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
            <ActionButton v-if="!completed" type="submit" :form="`${id}-form`" :state="actionState"
                :pending="command.pending.value" :show-spinner="false"
                :variant="inline || operation === 'close' || reviewing ? 'warning' : rejection ? 'danger' : 'primary'">
                {{ messages.t(operation === 'close' ? 'finance.close' : inline ? operation === 'approve' ? 'finance.accept' : 'finance.reject' : retroactive && !reviewing ? 'finance.continue' : operation === 'revise' ? 'finance.confirmCorrection'
                    : operation === 'reject' ? 'finance.confirmRejection' : 'finance.confirm') }}
            </ActionButton>
        </template>
    </AppDialog>
</template>
