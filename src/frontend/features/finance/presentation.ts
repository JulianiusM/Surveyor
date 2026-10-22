import type {LocalizationContext} from '../../../types/LocalizationTypes';
import type {components} from '../../../types/api/v1';

/** Money formatting changes presentation only; signed balances remain server-owned. */
export function financeMoney(amount: string, locale: string): string {
    return new Intl.NumberFormat(locale, {minimumFractionDigits: 2, maximumFractionDigits: 2}).format(Number(amount));
}

/** Invoice timestamps are instants; missing legacy evidence remains visibly absent. */
export function financeDate(value: string | null, locale: string): string {
    if (!value) return '—';
    return new Intl.DateTimeFormat(locale, {dateStyle: 'medium'}).format(new Date(value));
}

/** Status codes retain separate lifecycle meanings in both authorized histories. */
export function invoiceStatus(status: string, messages: LocalizationContext): string {
    switch (status) {
        case 'NEW': return messages.t('finance.awaitingReview');
        case 'APPROVED': return messages.t('finance.accepted');
        case 'REJECTED': return messages.t('finance.rejected');
        case 'RETRACTED': return messages.t('finance.retracted');
        default: return messages.t('finance.closed');
    }
}

/** Badge colors follow lifecycle state independently of translated labels. */
export function invoiceStatusClass(status: string): string {
    return status === 'NEW' ? 'bg-warning text-dark' : status === 'APPROVED' ? 'bg-success'
        : status === 'REJECTED' ? 'bg-danger' : 'bg-secondary';
}

// The four existing journeys retain their own complete messages. One selector
// keeps ledger actions, signed confirmation and successful receipts consistent.
const settlementMessages = {
    payment: {action: 'finance.recordPayment', confirmation: 'finance.confirmRecordPayment', notice: 'finance.paymentRecorded'},
    refund: {action: 'finance.recordRefund', confirmation: 'finance.confirmRecordRefund', notice: 'finance.refundRecorded'},
    reversePayment: {action: 'finance.reversePayment', confirmation: 'finance.confirmReversePayment', notice: 'finance.paymentRecordRemoved'},
    reverseRefund: {action: 'finance.reverseRefund', confirmation: 'finance.confirmReverseRefund', notice: 'finance.refundRecordRemoved'},
} as const;

/** Select existing action, review and receipt wording for a saved signed
 * balance. The server owns its paid marker and financial calculation. */
export function financeSettlementMessages(share: components['schemas']['FinanceShare']) {
    const refund = Number(share.amount) < 0;
    // A nonzero paid share reverses its recorded transfer in the same direction.
    if (share.isPaid) return refund ? settlementMessages.reverseRefund : settlementMessages.reversePayment;
    return refund ? settlementMessages.refund : settlementMessages.payment;
}
