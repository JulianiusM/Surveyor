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
import type {ConfirmedInvoiceChange} from '../../types/InvoicePoolTypes';
import type {EventInvoicePool} from '../database/entities/event/EventInvoicePool';
import {APIError, ExpectedError} from '../lib/errors';

/** Preserve the export's existing event boundary and requirement for a saved calculation. */
export function assertInvoiceSharesExportable(pool: EventInvoicePool | null, eventId: string): asserts pool is EventInvoicePool {
    // A foreign pool receives the same not-found response, without revealing another event's data.
    if (!pool || pool.eventId !== eventId) throw new ExpectedError(invoiceText('invoicePoolNotFound'), 'error', 404);
    // An open pool has no authoritative share snapshot. This read-only export must never calculate one.
    if (pool.status !== 'CLOSED') throw new ExpectedError(invoiceText('calculateAndCloseBeforeExporting'), 'warning', 409);
}

/** Validate finite safe integer-cent arithmetic used for settlement projection. */
export function invoiceCents(amount: number): number {
    // Bound integer-cent arithmetic before it is used for cumulative settlement credits.
    const cents = Math.round(amount * 100);
    if (!Number.isFinite(amount) || !Number.isSafeInteger(cents)) {
        throw new APIError(invoiceText('invoiceAmountsMustBeFiniteAndWithinTheSupported'), {}, 400);
    }
    return cents;
}

/** Reject nonpositive, out-of-range, or excess-precision invoice amounts. */
export function assertPositiveInvoiceAmount(amount: number): void {
    const cents = invoiceCents(amount);
    // Allow binary floating-point representation noise, but reject user amounts with additional decimal digits.
    const centTolerance = Number.EPSILON * Math.max(1, Math.abs(amount * 100)) * 4;
    if (cents <= 0 || amount > 99999999.99 || Math.abs(amount * 100 - cents) > centTolerance) {
        throw new APIError(invoiceText('enterAPositiveAmountWithAtMostTwoDecimal'), {}, 400);
    }
}

/** Protect existing correction and retraction commands against unconfirmed or stale revisions. */
export function assertConfirmedInvoiceChange(pool: EventInvoicePool, confirmation: ConfirmedInvoiceChange): void {
    // Preserve the pre-existing accepted-invoice revision contract; new UI confirmation gates add no API fields.
    if (confirmation?.confirmed !== true) throw new APIError(invoiceText('confirmThisInvoiceChangeBeforeContinuing'), {}, 400);
    if (!Number.isSafeInteger(confirmation.expectedRevision) || confirmation.expectedRevision < 0) {
        throw new APIError(invoiceText('currentRevisionRequired'), {}, 400);
    }
    // This check must execute against the locked row so an acknowledged review cannot overwrite concurrent edits.
    if (pool.calculationRevision !== confirmation.expectedRevision) {
        throw new APIError(invoiceText('thePoolChangedReloadAndReviewTheInvoiceAgain'), {}, 409);
    }
}
