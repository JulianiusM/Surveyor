/*
 * Copyright 2026 Julian Malovanij
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import type {StructuredEmailContent} from '../email';

export interface InvoiceSettlementNotice {
    eventTitle: string;
    poolName: string;
    eventUrl: string;
    actor: string;
    reason: 'closed' | 'recalculated' | 'requested';
    needsRecalculation: boolean;
    share: {
        baseShareAmount: number;
        extraAmount: number;
        invoiceCreditAmount: number;
        paymentCreditAmount: number;
        shareAmount: number;
        isPaid: boolean;
        note?: string | null;
    };
}

/** Describe the persisted settlement, including money already received or paid out. */
export function buildInvoiceSettlementEmail(input: InvoiceSettlementNotice): StructuredEmailContent {
    const {share} = input;
    const remaining = share.isPaid ? 0 : share.shareAmount;
    const settled = remaining === 0;
    const money = (amount: number) => amount.toFixed(2);
    const notes = (share.note || '').split(' • ').filter(Boolean);
    const introduction = input.reason === 'closed'
        ? 'The invoice pool has been closed and your share has been calculated.'
        : input.reason === 'recalculated'
            ? 'The invoice pool has been recalculated. Previously recorded payments and payouts have been carried forward.'
            : 'An organizer requested an update on your saved invoice-pool settlement.';
    return {
        eyebrow: 'Invoice pool settlement',
        heading: settled ? 'Your pool share is settled' : `You ${remaining < 0 ? 'are owed' : 'owe'} ${money(Math.abs(remaining))}`,
        preheader: settled ? `There is no outstanding balance for ${input.poolName}.` : `Your remaining balance for ${input.poolName}.`,
        paragraphs: [introduction, ...(settled ? ['No payment or payout is currently outstanding for this share.'] : [])],
        details: [
            {label: 'Event', value: input.eventTitle},
            {label: 'Pool', value: input.poolName},
            {label: 'Status', value: share.isPaid ? 'Paid' : settled ? 'Settled' : 'Outstanding'},
            {label: 'Calculated share', value: money(share.baseShareAmount + share.extraAmount - share.invoiceCreditAmount)},
            {label: 'Previously settled', value: money(share.paymentCreditAmount)},
            ...(share.isPaid && share.shareAmount !== 0 ? [{label: 'Settled in this calculation', value: money(share.shareAmount)}] : []),
            {label: settled ? 'Remaining to settle' : remaining < 0 ? 'Amount owed to you' : 'Amount due', value: money(Math.abs(remaining))},
            {label: 'Updated by', value: input.actor},
        ],
        sections: notes.length ? [{title: 'Calculation breakdown', items: notes}] : undefined,
        action: {label: 'View invoice pool', url: input.eventUrl},
        notice: input.needsRecalculation
            ? 'Pool inputs have changed since this calculation. These amounts and payment states describe the saved settlement; a new calculation may change the balance.'
            : 'Positive settled amounts are payments received from you; negative settled amounts are payouts already made to you.',
    };
}
