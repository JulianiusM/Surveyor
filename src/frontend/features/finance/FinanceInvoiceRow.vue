<script setup lang="ts">
import {computed, ref} from 'vue';
import type {components} from '../../../types/api/v1';
import type {FinanceInvoiceRowProps} from '../../../types/FrontendFinanceReviewTypes';
import {useFrontend} from '../../app/context';
import {financeDate, financeMoney, invoiceStatus, invoiceStatusClass} from './presentation';
import {useFinanceInvoiceReview} from './invoiceReview';
import {protectFinanceNumberFromScroll} from './numbers';
import FinanceInvoiceReview from './FinanceInvoiceReview.vue';
import ActionButton from '../../components/ActionButton.vue';
import FormField from '../../components/FormField.vue';

type Invoice = components['schemas']['FinanceInvoice'];
// The history keys source/audience changes separately. Only an admitted live
// management caller creates the existing review owner; personal and inspection
// rows receive their same read-only evidence without gaining command authority.
const props = defineProps<FinanceInvoiceRowProps>();
const emit = defineEmits<{retract: [invoice: Invoice]; closeInvoice: [invoice: Invoice];
    review: [invoice: Invoice, action: 'approve' | 'decline' | 'revise' | 'reject' | 'close']}>();
const {messages, locale} = useFrontend();
const confirmationOpen = ref(false);
const review = props.admin && !props.readOnly && props.eventId && props.pool && props.refreshSaved
    ? useFinanceInvoiceReview({
        get eventId() { return props.eventId!; }, get invoice() { return props.invoice; },
        get currentInvoice() { return props.invoice; }, get pool() { return props.pool!; },
        action: 'approve', inline: true, get open() { return confirmationOpen.value; },
        get active() { return !props.disabled; }, refresh: () => props.refreshSaved!(),
    }, {close: () => { confirmationOpen.value = false; }, saved: () => {
        // This row remains mounted and renders the command's same receipt.
    }}) : null;
// A saved status can change before the initiating command/read settles. Keep
// that same row locked across NEW/accepted markup without blocking later edits.
const rowBlocked = computed(() => !!props.disabled || !!review && (review.command.pending.value
    || review.command.recovering.value || review.command.uncertain.value));

/** Open only the final gate after the row owner captures relevant input. */
function beginNew(action: 'approve' | 'decline'): void {
    if (review?.beginInline(action)) confirmationOpen.value = true;
}
</script>

<template>
    <tr v-show="visible" :data-finance-invoice="invoice.id">
        <td :data-label="messages.t('finance.invoice2')">
            <strong>{{ messages.t('finance.invoiceReference', {id: invoice.id}) }}</strong>
            <small class="text-secondary d-block">
                {{ admin ? messages.t(invoice.organizerRecorded ? 'finance.recordedDate' : 'finance.submittedDate', {date: financeDate(invoice.createdAt, locale)}) : financeDate(invoice.createdAt, locale) }}
            </small>
            <small v-if="!admin && invoice.organizerRecorded" class="text-secondary d-block">
                {{ messages.t('finance.recordedBy', {participantName: recorderName}) }}
            </small>
        </td>
        <td :data-label="messages.t(admin ? 'finance.participantSource' : 'finance.pool')">
            <strong v-if="admin" class="d-block">{{ invoice.participantName ?? messages.t('finance.poolExpense') }}</strong>
            <template v-else>{{ invoice.poolName }}</template>
            <small v-if="admin && invoice.organizerRecorded" class="text-secondary d-block">
                {{ messages.t('finance.recordedBy', {participantName: recorderName}) }}
            </small>
            <small v-if="admin && invoice.participantEmail && invoice.participantEmail !== '—'" class="text-secondary d-block">{{ invoice.participantEmail }}</small>
        </td>
        <td :class="admin ? 'invoice-cell-wide' : undefined" :data-label="messages.t(admin ? 'finance.submittedDetails' : 'finance.amount')">
            <template v-if="admin">
                <strong class="d-block">{{ financeMoney(invoice.amount, locale) }}</strong>
                <small class="text-secondary invoice-description">{{ invoice.description || messages.t('finance.noDescription') }}</small>
            </template>
            <template v-else>
                <strong class="d-block">{{ financeMoney(invoice.correctedAmount ?? invoice.amount, locale) }}</strong>
                <small v-if="invoice.correctedAmount !== null" class="text-secondary">
                    {{ messages.t('finance.original2', {fmtMoney: financeMoney(invoice.amount, locale)}) }}
                </small>
            </template>
        </td>
        <td class="invoice-cell-wide" :data-label="messages.t(admin ? 'finance.organizerReview' : 'finance.description')">
            <!-- NEW inputs stay in this row's one review owner. Buttons alone
                 choose which captured payload enters the final gate. -->
            <div v-if="review && invoice.status === 'NEW' && !readOnly" class="invoice-review-fields" @wheel.capture.passive="protectFinanceNumberFromScroll">
                <FormField :id="`${review.id}-inline-amount`" v-model="review.draft.amount" :name="null" type="number" lexical-number
                    min="0.01" step="0.01" input-mode="decimal" control-class="form-control-sm invoice-corrected-amount" label-class="small mb-1"
                    :label="messages.t('finance.correctedAmount2')" :placeholder="messages.t('finance.keep', {fmtMoney: financeMoney(invoice.amount, locale)})"
                    :disabled="review.actionState.disabled.value || confirmationOpen" />
                <FormField :id="`${review.id}-inline-description`" v-model="review.draft.description" :name="null" multiline :rows="2"
                    class="mt-2" control-class="form-control-sm invoice-corrected-description" label-class="small mb-1" :max-length="4000"
                    :label="messages.t('finance.correctedDescription2')" :placeholder="messages.t('finance.leaveBlankToKeepSubmittedDescription')"
                    :disabled="review.actionState.disabled.value || confirmationOpen" />
                <FormField :id="`${review.id}-inline-reason`" v-model="review.draft.reason" :name="null" multiline :rows="2"
                    class="mt-2" control-class="form-control-sm invoice-rejection-reason" label-class="small mb-1" :max-length="4000"
                    :label="messages.t('finance.rejectionReason')" :placeholder="messages.t('finance.requiredWhenRejecting')"
                    :disabled="review.actionState.disabled.value || confirmationOpen" />
            </div>
            <template v-else-if="admin">
                <strong v-if="invoice.correctedAmount !== null" class="d-block">{{ financeMoney(invoice.correctedAmount, locale) }}</strong>
                <small v-if="invoice.correctedAmount !== null" class="text-secondary d-block">
                    {{ messages.t('finance.original2', {fmtMoney: financeMoney(invoice.amount, locale)}) }}
                </small>
                <small v-if="invoice.correctedDescription !== null" class="d-block invoice-description">{{ invoice.correctedDescription }}</small>
                <span v-if="invoice.correctedAmount === null && invoice.correctedDescription === null" class="text-secondary small">{{ messages.t('finance.noCorrections') }}</span>
            </template>
            <template v-else>
                <span class="d-block invoice-description">{{ (invoice.correctedDescription ?? invoice.description) || messages.t('finance.noDescription') }}</span>
                <small v-if="invoice.correctedDescription !== null && invoice.description" class="text-secondary d-block">
                    {{ messages.t('finance.originalDescription', {description: invoice.description}) }}
                </small>
            </template>
        </td>
        <td :data-label="messages.t('finance.status')">
            <span class="badge" :class="invoiceStatusClass(invoice.status)">{{ invoiceStatus(invoice.status, messages) }}</span>
            <small v-if="invoice.rejectionReason" class="text-danger-emphasis d-block mt-2"><strong v-if="!admin">{{ messages.t('finance.reason') }}</strong>{{ invoice.rejectionReason }}</small>
        </td>
        <td :data-label="messages.t('finance.proof')">
            <a v-if="invoice.proofUrl" class="text-info" :href="invoice.proofUrl" :title="invoice.proofOriginalName || messages.t('finance.invoiceProof')"
                target="_blank" rel="noopener noreferrer">
                <i class="bi bi-file-earmark-text me-1" aria-hidden="true"></i>{{ messages.t('finance.viewProof') }}
            </a>
            <span v-else class="text-secondary">{{ messages.t(invoice.organizerRecorded && !invoice.proofOriginalName ? 'finance.noProofAttached' : 'finance.proofExpired') }}</span>
        </td>
        <td v-if="admin && !readOnly" class="invoice-cell-actions" :data-label="messages.t('finance.actions')">
            <div class="frontend-action-row flex-wrap gap-1">
                <template v-if="invoice.status === 'NEW'">
                    <ActionButton variant="success" class="btn-sm" :disabled="disabled" :state="review?.actionState"
                        :pending="review?.command.pending.value && review.operation.value === 'approve'"
                        @click="review ? beginNew('approve') : emit('review', invoice, 'approve')">
                        <i class="bi bi-check2 me-1" aria-hidden="true"></i>{{ messages.t('finance.accept') }}
                    </ActionButton>
                    <ActionButton variant="outline-danger" class="btn-sm" :disabled="disabled" :state="review?.actionState"
                        :pending="review?.command.pending.value && review.operation.value === 'decline'"
                        @click="review ? beginNew('decline') : emit('review', invoice, 'decline')">
                        <i class="bi bi-x-lg me-1" aria-hidden="true"></i>{{ messages.t('finance.reject') }}
                    </ActionButton>
                </template>
                <template v-else-if="invoice.status === 'APPROVED' || invoice.status === 'CLOSED'">
                    <ActionButton variant="outline-light" class="btn-sm" :disabled="rowBlocked" @click="emit('review', invoice, 'revise')">
                        <i class="bi bi-pencil me-1" aria-hidden="true"></i>{{ messages.t('finance.correct') }}
                    </ActionButton>
                    <ActionButton variant="outline-danger" class="btn-sm" :disabled="rowBlocked" @click="emit('review', invoice, 'reject')">
                        <i class="bi bi-x-circle me-1" aria-hidden="true"></i>{{ messages.t('finance.rejectFromPool') }}
                    </ActionButton>
                    <ActionButton v-if="invoice.status === 'APPROVED'" variant="outline-light" class="btn-sm" :disabled="rowBlocked" @click="emit('review', invoice, 'close')">
                        <i class="bi bi-check2-circle me-1" aria-hidden="true"></i>{{ messages.t('common.close') }}
                    </ActionButton>
                </template>
                <span v-else class="text-secondary small">{{ messages.t('finance.noActions') }}</span>
            </div>
        </td>
        <td v-else-if="!readOnly" class="invoice-cell-actions" :data-label="messages.t('finance.actions')">
            <ActionButton v-if="invoice.canRetract" variant="outline-danger" class="btn-sm" :disabled="disabled" @click="emit('retract', invoice)">
                <i class="bi bi-arrow-counterclockwise me-1" aria-hidden="true"></i>
                {{ messages.t('finance.retract') }}
            </ActionButton>
            <ActionButton v-else-if="invoice.canClose"
                variant="outline-success" class="btn-sm" :disabled="disabled" @click="emit('closeInvoice', invoice)">
                <i class="bi bi-check2-circle me-1" aria-hidden="true"></i>
                {{ messages.t('common.close') }}
            </ActionButton>
            <span v-else class="text-secondary small">{{ messages.t('finance.noActions') }}</span>
        </td>
    </tr>
    <!-- This same owner survives saved status changes and hidden filter/page
         rows. Source retirement unmounts it and releases the private fields. -->
    <FinanceInvoiceReview v-if="review && pool && eventId && refreshSaved" :owner="review"
        :event-id="eventId" :invoice="invoice" :current-invoice="invoice" :pool="pool"
        action="approve" inline :open="confirmationOpen" :active="!disabled" :refresh="refreshSaved" />
</template>
