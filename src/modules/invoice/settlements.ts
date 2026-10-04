/*
 * Copyright 2026 Julian Malovanij
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {invoiceText} from './wording';
import type {PreviousInvoiceShare, InvoiceSharePayload, ProjectedInvoiceShare} from '../../types/InvoicePoolTypes';
import {APIError} from '../lib/errors';
import {invoiceCents} from './validation';

/** Accumulate each actual payer's signed recorded transfers once at the established cent precision. */
function collectRecordedPayments(previousShares: readonly PreviousInvoiceShare[],
    existingRegistrationIds?: readonly number[]): Map<number, number> {
    const validIds = existingRegistrationIds ? new Set(existingRegistrationIds) : null;
    const payments = new Map<number, number>();
    // A saved credit already includes earlier calculations. Add only this row's newly recorded balance.
    // Refunds remain negative, so a completed correcting transfer can consume the carried credit exactly.
    for (const share of previousShares) {
        if (validIds && !validIds.has(share.registrationId)) continue;
        const paymentCents = invoiceCents(share.paymentCreditAmount ?? 0)
            + (share.isPaid ? invoiceCents(share.shareAmount) : 0);
        payments.set(share.registrationId, (payments.get(share.registrationId) ?? 0) + paymentCents);
    }
    return payments;
}

/** Identify payers with a nonzero carried settlement; completed corrections clear the saved history marker. */
export function collectSettledRegistrationIds(previousShares: readonly PreviousInvoiceShare[],
    existingRegistrationIds?: readonly number[]): number[] {
    const payments = collectRecordedPayments(previousShares, existingRegistrationIds);
    const registrationIds: number[] = [];
    // Numeric settlement evidence is authoritative. Old IDs or dates cannot keep a consumed credit alive.
    for (const [registrationId, paymentCents] of payments) {
        if (paymentCents !== 0) registrationIds.push(registrationId);
    }
    // Stable identity ordering keeps preview and commit independent from database row order.
    return registrationIds.sort((first, second) => first - second);
}

/** Project calculated balances while keeping cumulative signed settlements with the payer who made them. */
export function projectInvoiceShares(
    previousShares: readonly PreviousInvoiceShare[],
    newGrossPayloads: readonly InvoiceSharePayload[],
    existingRegistrationIds?: readonly number[],
): ProjectedInvoiceShare[] {
    // Use the same signed accumulation as saved active-history IDs; dates do not create financial credits.
    const payments = collectRecordedPayments(previousShares, existingRegistrationIds);
    const paidDates = new Map<number, Date | null>();
    for (const share of previousShares) {
        if (share.paidAt) paidDates.set(share.registrationId, share.paidAt);
    }
    // Track credits not consumed by a current allocation so former payers can still receive their refund.
    const remainingPayments = new Map(payments);
    const validIds = existingRegistrationIds ? new Set(existingRegistrationIds) : null;
    const seenIds = new Set<number>();
    const projected: ProjectedInvoiceShare[] = [];
    /** Deduct one payer’s cumulative signed settlements from their new gross allocation. */
    function project(payload: InvoiceSharePayload): ProjectedInvoiceShare {
        // Calculate in integer cents, deducting the payer's own signed credit from their new gross share.
        const paymentCents = payments.get(payload.registrationId) ?? 0;
        const remainderCents = invoiceCents(payload.baseShareAmount) + invoiceCents(payload.extraAmount)
            - invoiceCents(payload.invoiceCreditAmount) - paymentCents;
        // A zero calculated balance needs no transfer; otherwise the new row begins unsettled.
        // When the correcting transfer consumed all credit, a zero allocation is ordinary again, without a historic date.
        return {
            ...payload,
            paymentCreditAmount: paymentCents / 100,
            shareAmount: remainderCents / 100,
            isPaid: remainderCents === 0,
            paidAt: remainderCents === 0 && paymentCents !== 0 ? paidDates.get(payload.registrationId) ?? null : null,
        };
    };
    // Reject duplicate or departed payers before projecting each current allocation.
    for (const payload of newGrossPayloads) {
        if (seenIds.has(payload.registrationId)) throw new APIError(invoiceText('duplicatePayerInInvoiceCalculation'), {}, 400);
        if (validIds && !validIds.has(payload.registrationId)) throw new APIError(invoiceText('calculationParticipantNoLongerBelongsToThisEvent'), {}, 409);
        seenIds.add(payload.registrationId);
        remainingPayments.delete(payload.registrationId);
        projected.push(project(payload));
    }
    // Preserve a former payer only while a signed credit still requires a correcting refund or payment.
    // Completing that correction removes the orphan row; currently allocated zero rows remain above.
    for (const [registrationId, paymentCents] of remainingPayments) {
        if (paymentCents === 0 || (validIds && !validIds.has(registrationId))) continue;
        projected.push(project({
            registrationId,
            baseShareAmount: 0,
            extraAmount: 0,
            invoiceCreditAmount: 0,
            shareAmount: 0,
            note: invoiceText('noCurrentAllocatedCostsPreviousPaymentsRemainWithThis'),
        }));
    }
    return projected;
}
