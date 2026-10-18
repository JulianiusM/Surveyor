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
import type {EntityManager} from 'typeorm';
import type {EventInvoicePool} from '../database/entities/event/EventInvoicePool';
import type {EventInvoice} from '../database/entities/event/EventInvoice';
import * as invoiceService from '../database/services/EventInvoiceService';
import {APIError} from '../lib/errors';
import {formatAmount} from '../lib/util';
import {resolveEmailRecipientName} from '../email';
import type {InvoiceProof, InvoiceCorrections, InvoiceRevision, ConfirmedInvoiceChange} from '../../types/InvoicePoolTypes';
import {requireLockedPool, assertLockedParticipant, savePoolChange} from './state';
import {assertPositiveInvoiceAmount, assertConfirmedInvoiceChange} from './validation';

/** The creator owns proof validation; persistence receives already selected attribution and status. */
export async function persistSubmittedInvoice(poolId: string, registrationId: number, amount: number, description: string | null, proof: InvoiceProof = null): Promise<number> {
    /** Evaluate this operation and apply its writes while the DBAL holds the pool’s root lock. */
    async function submitLocked(manager: EntityManager, row: EventInvoicePool | null): Promise<number> {
        // The DBAL holds the pool lock throughout policy checks and dependent writes.
        const pool = requireLockedPool(row);
        // Recheck submission eligibility after acquiring the lock, including concurrent closure or membership edits.
        if (pool.status !== 'OPEN') throw new APIError(invoiceText('poolIsClosedForInvoiceSubmissions'), {}, 409);
        await assertLockedParticipant(manager, pool, registrationId);
        // New participant costs require review and retain the original proof and submitted amount.
        const invoice = await invoiceService.saveInvoice({
            pool: {id: poolId}, registration: {id: registrationId}, amount: formatAmount(amount),
            description: description || null, status: 'NEW', correctedAmount: null, correctedDescription: null,
            rejectionReason: null, proofPath: proof?.path || null, proofOriginalName: proof?.originalName || null,
            proofMimeType: proof?.mimeType || null,
        }, manager);
        // Invalidate previews and closed-pool inputs after persistence, inside the same transaction.
        await savePoolChange(manager, pool);
        return invoice.id;
    }
    return invoiceService.withLockedPool(poolId, submitLocked);
}

/** Record an accepted organizer invoice, optionally attributing its payment to an eligible participant. */
export async function persistOrganizerInvoice(poolId: string, profileId: string, amount: number, description: string,
    proof: InvoiceProof = null, registrationId?: number): Promise<number> {
    // Organizer costs are already accepted, but still obey the shared money and description constraints.
    if (typeof profileId !== 'string' || !profileId.trim()) throw new APIError(invoiceText('organizerProfileNotFound'), {}, 401);
    assertPositiveInvoiceAmount(amount);
    if (typeof description !== 'string' || !description.trim() || description.trim().length > 4000) {
        throw new APIError(invoiceText('enterADescriptionOfUpToCharacters'), {}, 400);
    }
    // Direct domain callers obey the same explicit-ID contract as multipart requests; zero never means attribution.
    if (registrationId !== undefined && (!Number.isSafeInteger(registrationId) || registrationId <= 0)) {
        throw new APIError(invoiceText('participantNotAssignedToThisPool'), {}, 400);
    }
    /** Evaluate this operation and apply its writes while the DBAL holds the pool’s root lock. */
    async function submitLocked(manager: EntityManager, row: EventInvoicePool | null): Promise<number> {
        // The DBAL holds the pool lock throughout policy checks and dependent writes.
        const pool = requireLockedPool(row);
        // Resolve the authenticated recorder independently from the optional person who paid the expense.
        const profile = await invoiceService.getProfile(profileId, manager);
        if (!profile) throw new APIError(invoiceText('organizerProfileNotFound'), {}, 401);
        // Repeat event and pool eligibility inside the root lock. A concurrent assignment removal or foreign ID
        // rejects the complete creation rather than silently omitting credit or adding participant membership.
        if (registrationId !== undefined) await assertLockedParticipant(manager, pool, registrationId);
        // Save a display-name snapshot so the cost remains traceable if the recorder later changes profile data.
        const name = resolveEmailRecipientName(profile.name, profile.user?.name, profile.user?.username, profile.guest?.username) || invoiceText('organizer');
        const invoice = await invoiceService.saveInvoice({
            pool: {id: poolId}, registration: registrationId === undefined ? null : {id: registrationId},
            recordedByProfile: profile, recordedByName: name.slice(0, 50),
            amount: formatAmount(amount), description: description.trim(), status: 'APPROVED',
            correctedAmount: null, correctedDescription: null, rejectionReason: null,
            proofPath: proof?.path || null, proofOriginalName: proof?.originalName || null, proofMimeType: proof?.mimeType || null,
        }, manager);
        // Registration attribution reuses existing personal credit/history rules. Unattributed entries stay shared costs.
        // Invalidate previews and closed-pool inputs after persistence, inside the same transaction.
        await savePoolChange(manager, pool);
        return invoice.id;
    }
    return invoiceService.withLockedPool(poolId, submitLocked);
}

/** Review decisions are checked again under the pool lock, so only the winning decision is notified. */
export async function acceptSavedInvoice(poolId: string, invoiceId: number, corrections: InvoiceCorrections = {}): Promise<boolean> {
    /** Evaluate this operation and apply its writes while the DBAL holds the pool’s root lock. */
    async function acceptLocked(manager: EntityManager, row: EventInvoicePool | null): Promise<boolean> {
        // The DBAL holds the pool lock throughout policy checks and dependent writes.
        const pool = requireLockedPool(row);
        // Read the current review state within this pool; preloaded request data cannot authorize a stale transition.
        const invoice = await invoiceService.getInvoiceWithRegistration(poolId, invoiceId, manager);
        if (!invoice) throw new APIError(invoiceText('invoiceNotFound'), {}, 404);
        if (invoice.status !== 'NEW') return false;
        // Only the winning NEW-to-accepted transition writes corrections and clears a prior rejection reason.
        invoice.status = 'APPROVED';
        invoice.correctedAmount = corrections.correctedAmount == null ? null : formatAmount(corrections.correctedAmount);
        invoice.correctedDescription = corrections.correctedDescription || null;
        invoice.rejectionReason = null;
        await invoiceService.saveInvoice(invoice, manager);
        // Invalidate previews and closed-pool inputs after persistence, inside the same transaction.
        await savePoolChange(manager, pool);
        return true;
    }
    return invoiceService.withLockedPool(poolId, acceptLocked);
}

/** Close an accepted invoice idempotently without replacing calculated share rows. */
export async function closeSavedInvoice(poolId: string, invoiceId: number): Promise<boolean> {
    /** Evaluate this operation and apply its writes while the DBAL holds the pool’s root lock. */
    async function closeLocked(manager: EntityManager, row: EventInvoicePool | null): Promise<boolean> {
        // The DBAL holds the pool lock throughout policy checks and dependent writes.
        const pool = requireLockedPool(row);
        // Read the current review state within this pool; preloaded request data cannot authorize a stale transition.
        const invoice = await invoiceService.getInvoiceWithRegistration(poolId, invoiceId, manager);
        if (!invoice) throw new APIError(invoiceText('invoiceNotFound'), {}, 404);
        if (invoice.status === 'CLOSED') return false;
        if (invoice.status !== 'APPROVED') throw new APIError(invoiceText('onlyAcceptedInvoicesCanBeClosed'), {}, 400);
        // Closing retains the accepted cost; refresh aggregates without changing saved shares or pool inputs.
        invoice.status = 'CLOSED';
        await invoiceService.saveInvoice(invoice, manager);
        await invoiceService.refreshPoolTotals(manager, poolId);
        return true;
    }
    return invoiceService.withLockedPool(poolId, closeLocked);
}

/** Reject an unreviewed invoice while retaining its submitted evidence and review history. */
export async function rejectSavedInvoice(poolId: string, invoiceId: number, rejectionReason: string): Promise<boolean> {
    /** Evaluate this operation and apply its writes while the DBAL holds the pool’s root lock. */
    async function rejectLocked(manager: EntityManager, row: EventInvoicePool | null): Promise<boolean> {
        // The DBAL holds the pool lock throughout policy checks and dependent writes.
        const pool = requireLockedPool(row);
        // Read the current review state within this pool; preloaded request data cannot authorize a stale transition.
        const invoice = await invoiceService.getInvoiceWithRegistration(poolId, invoiceId, manager);
        if (!invoice) throw new APIError(invoiceText('invoiceNotFound'), {}, 404);
        if (invoice.status !== 'NEW') return false;
        // Preserve the original invoice and proof in history while excluding this rejected cost from calculation.
        invoice.status = 'REJECTED';
        invoice.rejectionReason = rejectionReason;
        invoice.correctedAmount = null;
        invoice.correctedDescription = null;
        await invoiceService.saveInvoice(invoice, manager);
        // Invalidate previews and closed-pool inputs after persistence, inside the same transaction.
        await savePoolChange(manager, pool);
        return true;
    }
    return invoiceService.withLockedPool(poolId, rejectLocked);
}

/** Apply validated effective corrections only against the matching locked pool revision. */
export async function reviseSavedInvoice(poolId: string, invoiceId: number, corrections: InvoiceRevision, confirmation: ConfirmedInvoiceChange): Promise<EventInvoice> {
    // Validate correction values before the transaction; original amount, description, and proof remain untouched.
    if (corrections?.correctedAmount !== null) assertPositiveInvoiceAmount(corrections?.correctedAmount);
    if (corrections?.correctedDescription !== null && (typeof corrections?.correctedDescription !== 'string'
        || corrections.correctedDescription.trim().length > 4000)) {
        throw new APIError(invoiceText('enterACorrectionDescriptionOfUpToCharactersOr'), {}, 400);
    }
    /** Evaluate this operation and apply its writes while the DBAL holds the pool’s root lock. */
    async function reviseLocked(manager: EntityManager, row: EventInvoicePool | null): Promise<EventInvoice> {
        // The DBAL holds the pool lock throughout policy checks and dependent writes.
        const pool = requireLockedPool(row);
        assertConfirmedInvoiceChange(pool, confirmation);
        // Read the current review state within this pool; preloaded request data cannot authorize a stale transition.
        const invoice = await invoiceService.getInvoiceWithRegistration(poolId, invoiceId, manager);
        if (!invoice) throw new APIError(invoiceText('invoiceNotFound'), {}, 404);
        if (invoice.status !== 'APPROVED' && invoice.status !== 'CLOSED') throw new APIError(invoiceText('onlyAcceptedOrClosedInvoicesCanBeCorrected'), {}, 409);
        // Null restores the submitted value. Accepted and Closed records keep their existing lifecycle state.
        invoice.correctedAmount = corrections.correctedAmount === null ? null : formatAmount(corrections.correctedAmount);
        invoice.correctedDescription = corrections.correctedDescription?.trim() || null;
        const saved = await invoiceService.saveInvoice(invoice, manager);
        // Invalidate previews and closed-pool inputs after persistence, inside the same transaction.
        await savePoolChange(manager, pool);
        return saved;
    }
    return invoiceService.withLockedPool(poolId, reviseLocked);
}

/** Exclude a counted invoice from future calculation without deleting its original evidence. */
export async function rejectAcceptedSavedInvoice(poolId: string, invoiceId: number, reason: string, confirmation: ConfirmedInvoiceChange): Promise<EventInvoice> {
    // Reject an accepted cost only with a meaningful bounded reason; retain all original evidence.
    if (typeof reason !== 'string' || !reason.trim() || reason.trim().length > 4000) throw new APIError(invoiceText('rejectionReasonRequired'), {}, 400);
    /** Evaluate this operation and apply its writes while the DBAL holds the pool’s root lock. */
    async function rejectLocked(manager: EntityManager, row: EventInvoicePool | null): Promise<EventInvoice> {
        // The DBAL holds the pool lock throughout policy checks and dependent writes.
        const pool = requireLockedPool(row);
        assertConfirmedInvoiceChange(pool, confirmation);
        // Read the current review state within this pool; preloaded request data cannot authorize a stale transition.
        const invoice = await invoiceService.getInvoiceWithRegistration(poolId, invoiceId, manager);
        if (!invoice) throw new APIError(invoiceText('invoiceNotFound'), {}, 404);
        if (invoice.status !== 'APPROVED' && invoice.status !== 'CLOSED') throw new APIError(invoiceText('onlyAcceptedOrClosedInvoicesCanBeRemovedFrom'), {}, 409);
        invoice.status = 'REJECTED';
        // Exclude the cost and its invoice credit from the next calculation, while keeping current shares unchanged.
        invoice.rejectionReason = reason.trim();
        const saved = await invoiceService.saveInvoice(invoice, manager);
        // Invalidate previews and closed-pool inputs after persistence, inside the same transaction.
        await savePoolChange(manager, pool);
        return saved;
    }
    return invoiceService.withLockedPool(poolId, rejectLocked);
}

/** Allow only an invoice’s authenticated submitter to withdraw it before organizer review. */
export async function retractSavedInvoice(poolId: string, invoiceId: number, profileId: string, confirmation: ConfirmedInvoiceChange): Promise<EventInvoice> {
    // The authenticated profile is explicit input; route visibility alone is not an ownership check.
    if (!profileId) throw new APIError(invoiceText('logInToRetractYourInvoice'), {}, 401);
    /** Evaluate this operation and apply its writes while the DBAL holds the pool’s root lock. */
    async function retractLocked(manager: EntityManager, row: EventInvoicePool | null): Promise<EventInvoice> {
        // The DBAL holds the pool lock throughout policy checks and dependent writes.
        const pool = requireLockedPool(row);
        assertConfirmedInvoiceChange(pool, confirmation);
        // Read the current review state within this pool; preloaded request data cannot authorize a stale transition.
        const invoice = await invoiceService.getInvoiceWithRegistration(poolId, invoiceId, manager);
        if (!invoice) throw new APIError(invoiceText('invoiceNotFound'), {}, 404);
        if (!invoice.registration || invoice.registration.profileId !== profileId) throw new APIError(invoiceText('youCanOnlyRetractYourOwnInvoice'), {}, 403);
        if (invoice.status !== 'NEW') throw new APIError(invoiceText('onlyInvoicesAwaitingReviewCanBeRetracted'), {}, 409);
        // Retraction is permitted only for the submitter of an unreviewed cost; it is never a deletion.
        invoice.status = 'RETRACTED';
        const saved = await invoiceService.saveInvoice(invoice, manager);
        // Unreviewed invoices never contributed to shares, so retraction advances the revision without marking them stale.
        await savePoolChange(manager, pool, false);
        return saved;
    }
    return invoiceService.withLockedPool(poolId, retractLocked);
}
