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

import {invoiceText, invoiceRejectionCause} from './wording';
import type {EntityManager} from 'typeorm';
import type {EventInvoicePool} from '../database/entities/event/EventInvoicePool';
import type {EventInvoice} from '../database/entities/event/EventInvoice';
import * as invoiceService from '../database/services/EventInvoiceService';
import {APIError} from '../lib/errors';
import {formatAmount} from '../lib/util';
import {resolveEmailRecipientName} from '../email';
import type {InvoiceProof, InvoiceCorrections, InvoiceRevision, ConfirmedInvoiceChange,
    InvoiceManagementContext} from '../../../types/InvoicePoolTypes';
import {requireLockedPool, assertLockedParticipant, savePoolChange, withInvoicePoolOperation} from './state';
import {assertPositiveInvoiceAmount, assertConfirmedInvoiceChange} from './validation';
import {attachInvoiceProof, withInvoiceProofUpload} from './proofs';

/** Apply participant submission policy to the already loaded pool before proof
 * attribution. The locked operation repeats lifecycle and membership checks. */
export function assertParticipantInvoiceSubmission(pool: EventInvoicePool, registrationId: number, body: object,
    file?: Pick<Express.Multer.File, 'mimetype'>): asserts file is Pick<Express.Multer.File, 'mimetype'> {
    // Keep the early 400 distinct from a concurrent closure's locked 409.
    assertInvoiceSubmissionsOpen(pool, body, 400);
    const isAssigned = pool.assignAll || pool.assignments?.some((assignment) => assignment.registration.id === registrationId);
    if (!isAssigned) throw new APIError(invoiceText('notAllowedForThisPool'), body, 403);
    // A participant's proof remains mandatory, after pool eligibility has won
    // any competing rejection. Organizer proof admission stays optional.
    if (!file) throw new APIError(invoiceText('proofRequired'), body, 400, {cause: invoiceRejectionCause('proofRequired')});
    const isValidProof = file.mimetype === 'application/pdf' || file.mimetype.startsWith('image/');
    if (!isValidProof) {
        throw new APIError(invoiceText('unsupportedProofType'), body, 400, {cause: invoiceRejectionCause('unsupportedProofType')});
    }
}

/** The same open-state rule retains each caller's existing rejection status and
 * diagnostic data; it performs no reads and never replaces locked admission. */
function assertInvoiceSubmissionsOpen(pool: EventInvoicePool, data: object, status: 400 | 409): void {
    if (pool.status !== 'OPEN') throw new APIError(invoiceText('poolIsClosedForInvoiceSubmissions'), data, status,
        {cause: invoiceRejectionCause('poolIsClosedForInvoiceSubmissions', status)});
}

/** Select a reviewable invoice before parsing corrections or rejection text.
 * The locked transition uses the same state predicate and reports its own race. */
export function requireInvoiceForReview(invoice: EventInvoice | null, decision: 'accept' | 'reject', data: object): EventInvoice {
    // Resolve absence before lifecycle so a completed review keeps its precise
    // action diagnostic without exposing or parsing a replacement form first.
    if (!invoice) throw new APIError(invoiceText('invoiceNotFound'), {}, 404);
    if (!isInvoiceAwaitingReview(invoice)) {
        const key = decision === 'accept' ? 'onlyInvoicesAwaitingReviewCanBeAccepted' : 'onlyInvoicesAwaitingReviewCanBeRejected';
        throw new APIError(invoiceText(key), data, 409, {cause: invoiceRejectionCause(key, 409)});
    }
    return invoice;
}

/** Review ownership is shared by early preflight and the locked winner check. */
function isInvoiceAwaitingReview(invoice: EventInvoice): boolean {
    return invoice.status === 'NEW';
}

/** Resolve invoice closure before actor lookup. An already closed invoice is
 * an idempotent no-op; the two established rejection messages stay stage-specific. */
export function requireInvoiceForClosure(invoice: EventInvoice | null, locked = false): EventInvoice | null {
    // Terminal idempotence precedes request actor lookup and any update. The
    // locked winner path uses the same decision with its established wording.
    if (!invoice) throw new APIError(invoiceText('invoiceNotFound'), {}, 404);
    if (invoice.status === 'CLOSED') return null;
    if (invoice.status !== 'APPROVED') {
        const key = locked ? 'onlyAcceptedInvoicesCanBeClosed' : 'invoicesMustBeAcceptedBeforeClosing';
        throw new APIError(invoiceText(key), {}, 400, {cause: invoiceRejectionCause(key)});
    }
    return invoice;
}

/** Apply submitter ownership after request admission has selected whether its
 * organizer grant may override self-service closure. */
export function assertInvoiceClosureActor(invoice: EventInvoice, actorRegistrationId: number | undefined, canManage: boolean): void {
    const isSubmitter = actorRegistrationId !== undefined && actorRegistrationId === invoice.registrationId;
    if (!canManage && !isSubmitter) {
        throw new APIError(invoiceText('youCanOnlyCloseYourOwnAcceptedInvoicesUnless'), {}, 403);
    }
}

/** The creator owns proof validation; persistence receives already selected attribution and status. */
export async function persistSubmittedInvoice(poolId: string, registrationId: number, amount: number, description: string | null, proof: InvoiceProof = null): Promise<number> {
    /** Retain upload ownership through all admission, persistence and receipt work. */
    return withInvoiceProofUpload(proof, async function persistOwnedProof() {
        /** Evaluate this operation and apply its writes while the DBAL holds the pool’s root lock. */
        async function submitLocked(manager: EntityManager, row: EventInvoicePool | null): Promise<number> {
            // The DBAL holds the pool lock throughout policy checks and dependent writes.
            const pool = requireLockedPool(row);
            // Recheck submission eligibility after acquiring the lock, including concurrent closure or membership edits.
            assertInvoiceSubmissionsOpen(pool, {}, 409);
            await assertLockedParticipant(manager, pool, registrationId);
            // New participant costs require review and retain the original proof and submitted amount.
            await attachInvoiceProof(proof, manager);
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
    }, proof?.path);
}

/** Record an accepted organizer invoice, optionally attributing its payment to an eligible participant. */
export async function persistOrganizerInvoice(poolId: string, profileId: string, amount: number, description: string,
    proof: InvoiceProof = null, registrationId?: number, management?: InvoiceManagementContext): Promise<number> {
    /** Retain upload ownership through all admission, persistence and receipt work. */
    return withInvoiceProofUpload(proof, async function persistOwnedProof() {
        // Organizer costs are already accepted, but still obey the shared money and description constraints.
        if (typeof profileId !== 'string' || !profileId.trim()) throw new APIError(invoiceText('organizerProfileNotFound'), {}, 401);
        assertPositiveInvoiceAmount(amount);
        if (typeof description !== 'string' || !description.trim() || description.trim().length > 4000) {
            throw new APIError(invoiceText('enterADescriptionOfUpToCharacters'), {}, 400, {cause: invoiceRejectionCause('enterADescriptionOfUpToCharacters')});
        }
        // Direct domain callers obey the same explicit-ID contract as multipart requests; zero never means attribution.
        if (registrationId !== undefined && (!Number.isSafeInteger(registrationId) || registrationId <= 0)) {
            throw new APIError(invoiceText('participantNotAssignedToThisPool'), {}, 400, {cause: invoiceRejectionCause('participantNotAssignedToThisPool')});
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
            await attachInvoiceProof(proof, manager);
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
        return withInvoicePoolOperation(poolId, submitLocked, management);
    }, proof?.path);
}

/** Review decisions are checked again under the pool lock, so only the winning decision is notified. */
export async function acceptSavedInvoice(poolId: string, invoiceId: number, corrections: InvoiceCorrections = {},
    management?: InvoiceManagementContext): Promise<boolean> {
    /** Evaluate this operation and apply its writes while the DBAL holds the pool’s root lock. */
    async function acceptLocked(manager: EntityManager, row: EventInvoicePool | null): Promise<boolean> {
        // The DBAL holds the pool lock throughout policy checks and dependent writes.
        const pool = requireLockedPool(row);
        // Read the current review state within this pool; preloaded request data cannot authorize a stale transition.
        const invoice = await invoiceService.getInvoiceWithRegistration(poolId, invoiceId, manager);
        if (!invoice) throw new APIError(invoiceText('invoiceNotFound'), {}, 404);
        if (!isInvoiceAwaitingReview(invoice)) return false;
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
    return withInvoicePoolOperation(poolId, acceptLocked, management);
}

/** Close an accepted invoice idempotently without replacing calculated share rows. */
export async function closeSavedInvoice(poolId: string, invoiceId: number,
    management?: InvoiceManagementContext): Promise<boolean> {
    /** Evaluate this operation and apply its writes while the DBAL holds the pool’s root lock. */
    async function closeLocked(manager: EntityManager, row: EventInvoicePool | null): Promise<boolean> {
        // The DBAL holds the pool lock throughout policy checks and dependent writes.
        requireLockedPool(row);
        // Read the current review state within this pool; preloaded request data cannot authorize a stale transition.
        const invoice = requireInvoiceForClosure(await invoiceService.getInvoiceWithRegistration(poolId, invoiceId, manager), true);
        if (!invoice) return false;
        // Closing retains the accepted cost; refresh aggregates without changing saved shares or pool inputs.
        invoice.status = 'CLOSED';
        await invoiceService.saveInvoice(invoice, manager);
        await invoiceService.refreshPoolTotals(manager, poolId);
        return true;
    }
    return withInvoicePoolOperation(poolId, closeLocked, management);
}

/** Reject an unreviewed invoice while retaining its submitted evidence and review history. */
export async function rejectSavedInvoice(poolId: string, invoiceId: number, rejectionReason: string,
    management?: InvoiceManagementContext): Promise<boolean> {
    /** Evaluate this operation and apply its writes while the DBAL holds the pool’s root lock. */
    async function rejectLocked(manager: EntityManager, row: EventInvoicePool | null): Promise<boolean> {
        // The DBAL holds the pool lock throughout policy checks and dependent writes.
        const pool = requireLockedPool(row);
        // Read the current review state within this pool; preloaded request data cannot authorize a stale transition.
        const invoice = await invoiceService.getInvoiceWithRegistration(poolId, invoiceId, manager);
        if (!invoice) throw new APIError(invoiceText('invoiceNotFound'), {}, 404);
        if (!isInvoiceAwaitingReview(invoice)) return false;
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
    return withInvoicePoolOperation(poolId, rejectLocked, management);
}

/** Apply validated effective corrections only against the matching locked pool revision. */
export async function reviseSavedInvoice(poolId: string, invoiceId: number, corrections: InvoiceRevision,
    confirmation: ConfirmedInvoiceChange, management?: InvoiceManagementContext): Promise<EventInvoice> {
    // Validate correction values before the transaction; original amount, description, and proof remain untouched.
    if (corrections?.correctedAmount !== null) assertPositiveInvoiceAmount(corrections?.correctedAmount);
    if (corrections?.correctedDescription !== null && (typeof corrections?.correctedDescription !== 'string'
        || corrections.correctedDescription.trim().length > 4000)) {
        throw new APIError(invoiceText('enterACorrectionDescriptionOfUpToCharactersOr'), {}, 400, {cause: invoiceRejectionCause('enterACorrectionDescriptionOfUpToCharactersOr')});
    }
    /** Evaluate this operation and apply its writes while the DBAL holds the pool’s root lock. */
    async function reviseLocked(manager: EntityManager, row: EventInvoicePool | null): Promise<EventInvoice> {
        // The DBAL holds the pool lock throughout policy checks and dependent writes.
        const pool = requireLockedPool(row);
        assertConfirmedInvoiceChange(pool, confirmation);
        // Read the current review state within this pool; preloaded request data cannot authorize a stale transition.
        const invoice = await invoiceService.getInvoiceWithRegistration(poolId, invoiceId, manager);
        if (!invoice) throw new APIError(invoiceText('invoiceNotFound'), {}, 404);
        if (invoice.status !== 'APPROVED' && invoice.status !== 'CLOSED') throw new APIError(invoiceText('onlyAcceptedOrClosedInvoicesCanBeCorrected'), {}, 409, {cause: invoiceRejectionCause('onlyAcceptedOrClosedInvoicesCanBeCorrected', 409)});
        // Null restores the submitted value. Accepted and Closed records keep their existing lifecycle state.
        invoice.correctedAmount = corrections.correctedAmount === null ? null : formatAmount(corrections.correctedAmount);
        invoice.correctedDescription = corrections.correctedDescription?.trim() || null;
        const saved = await invoiceService.saveInvoice(invoice, manager);
        // Invalidate previews and closed-pool inputs after persistence, inside the same transaction.
        await savePoolChange(manager, pool);
        return saved;
    }
    return withInvoicePoolOperation(poolId, reviseLocked, management);
}

/** Exclude a counted invoice from future calculation without deleting its original evidence. */
export async function rejectAcceptedSavedInvoice(poolId: string, invoiceId: number, reason: string,
    confirmation: ConfirmedInvoiceChange, management?: InvoiceManagementContext): Promise<EventInvoice> {
    // Reject an accepted cost only with a meaningful bounded reason; retain all original evidence.
    if (typeof reason !== 'string' || !reason.trim() || reason.trim().length > 4000) throw new APIError(invoiceText('rejectionReasonRequired'), {}, 400, {cause: invoiceRejectionCause('rejectionReasonRequired')});
    /** Evaluate this operation and apply its writes while the DBAL holds the pool’s root lock. */
    async function rejectLocked(manager: EntityManager, row: EventInvoicePool | null): Promise<EventInvoice> {
        // The DBAL holds the pool lock throughout policy checks and dependent writes.
        const pool = requireLockedPool(row);
        assertConfirmedInvoiceChange(pool, confirmation);
        // Read the current review state within this pool; preloaded request data cannot authorize a stale transition.
        const invoice = await invoiceService.getInvoiceWithRegistration(poolId, invoiceId, manager);
        if (!invoice) throw new APIError(invoiceText('invoiceNotFound'), {}, 404);
        if (invoice.status !== 'APPROVED' && invoice.status !== 'CLOSED') throw new APIError(invoiceText('onlyAcceptedOrClosedInvoicesCanBeRemovedFrom'), {}, 409, {cause: invoiceRejectionCause('onlyAcceptedOrClosedInvoicesCanBeRemovedFrom', 409)});
        invoice.status = 'REJECTED';
        // Exclude the cost and its invoice credit from the next calculation, while keeping current shares unchanged.
        invoice.rejectionReason = reason.trim();
        const saved = await invoiceService.saveInvoice(invoice, manager);
        // Invalidate previews and closed-pool inputs after persistence, inside the same transaction.
        await savePoolChange(manager, pool);
        return saved;
    }
    return withInvoicePoolOperation(poolId, rejectLocked, management);
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
        if (invoice.status !== 'NEW') throw new APIError(invoiceText('onlyInvoicesAwaitingReviewCanBeRetracted'), {}, 409, {cause: invoiceRejectionCause('onlyInvoicesAwaitingReviewCanBeRetracted', 409)});
        // Retraction is permitted only for the submitter of an unreviewed cost; it is never a deletion.
        invoice.status = 'RETRACTED';
        const saved = await invoiceService.saveInvoice(invoice, manager);
        // Unreviewed invoices never contributed to shares, so retraction advances the revision without marking them stale.
        await savePoolChange(manager, pool, false);
        return saved;
    }
    return invoiceService.withLockedPool(poolId, retractLocked);
}
