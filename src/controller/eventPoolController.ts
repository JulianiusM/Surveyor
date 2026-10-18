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

import {Request} from 'express';
import fs from 'node:fs';
import path from 'node:path';
import {Event} from '../modules/database/entities/event/Event';
import * as invoiceService from '../modules/database/services/EventInvoiceService';
import * as eventService from '../modules/database/services/EventService';

import {APIError} from '../modules/lib/errors';
import {resolveActorLabel} from '../modules/lib/util';
import * as poolOperations from '../modules/invoice/poolOperations';
import * as invoiceOperations from '../modules/invoice/invoiceOperations';
import {savePoolTakeovers} from '../modules/invoice/takeovers';
import {
    preparePoolCreation, preparePoolAssignments, prepareTakeoverRequest, preparePoolSettings,
    prepareSurchargeRequest, prepareSubmittedInvoice, prepareOrganizerInvoice, prepareInvoiceAcceptance,
    prepareInvoiceRejection, prepareConfirmedInvoiceChange, prepareCalculationOptions,
    prepareInvoiceRevision, prepareAcceptedInvoiceRejection, prepareSharesPdfOptions, preparePoolSubmissionState,
} from '../modules/invoice/requests';
import {preparePoolCalculation as calculatePoolInputs, buildPoolCalculationPreview} from '../modules/invoice/calculation';
import {
    notifyTakeoverChanges, notifySavedInvoiceChange, notifyAcceptedInvoice, notifyClosedInvoice,
    notifyRejectedInvoice, notifyShareSettlement, notifySubmittedInvoice, notifyPoolShareSettlements,
} from '../modules/invoice/notifications';
import {getInvoiceProofPath} from '../modules/invoice/proofs';
import {assertInvoiceSharesExportable} from '../modules/invoice/validation';
import {invoiceText} from '../modules/invoice/wording';
import {invoiceSettledShareNotice} from '../modules/invoice/presentation';
import type {InvoiceSharesPdfData} from '../types/InvoicePoolTypes';
import type {PermBundle} from '../types/PermissionTypes';

// Resolve the registration ID for the current actor so validation stays localized.
/** Resolve authenticated event membership for ownership-sensitive invoice operations. */
async function getActorRegistrationId(event: Event, session: Request['session']) {
    if (!session.profile) return undefined;

    const registration = await eventService.getRegistrationFor(session.profile.id, event.id);
    return registration?.id;
}

// Pull the pool and ensure it belongs to the current event.
/** Load a pool within the current event before invoking any feature operation. */
async function ensurePool(event: Event, poolId: string) {
    const pool = await invoiceService.getPoolWithInvoices(poolId);
    if (pool?.event.id !== event.id) {
        throw new APIError(invoiceText('poolNotFound'), {}, 404);
    }
    return pool;
}

// Verify a registration is currently allowed in the pool so surcharge updates cannot target removed participants.
/** Reject an adjustment for a registration outside the requested pool. */
async function assertRegistrationAllowed(pool: Awaited<ReturnType<typeof ensurePool>>, registrationId: number) {
    const assignedIds = pool.assignAll
        ? (await eventService.getRegistrationsForEvent(pool.event.id)).map((r) => r.id)
        : pool.assignments.map((a) => a.registrationId);
    if (!assignedIds.includes(registrationId)) throw new APIError(invoiceText('participantNotAssignedToThisPool'), {}, 400);
}

// Create a new invoice pool with optional default/assign-all behavior and explicit participant list.
/** Orchestrate validated pool creation using current event registrations and the existing DBAL. */
async function createInvoicePool(event: Event, body: unknown) {
    // Load event membership once; the request module normalizes only registrations from that event.
    const registrations = await eventService.getRegistrationsForEvent(event.id);
    const value = preparePoolCreation(body, registrations);
    // Persist the validated creation plan through the existing DBAL entry point.
    return invoiceService.createPool(event.id, value.name, value.description, value.distribution,
        value.isDefault, value.assignAll, value.subtractPersonalInvoices, value.registrationIds,
        value.sendCalculationEmails, value.roundUpShares, value.status);
}

/** Normalize pool settings and delegate the locked input update. */
async function updatePoolSettings(event: Event, poolId: string, body: any) {
    await ensurePool(event, poolId);

    const value = preparePoolSettings(body);

    await poolOperations.saveInvoicePoolSettings(poolId, value.distribution, value.description,
        value.sendCalculationEmails === undefined ? undefined : value.sendCalculationEmails === true || value.sendCalculationEmails === 'on',
        value.roundUpShares === undefined ? undefined : value.roundUpShares === true || value.roundUpShares === 'on');
}

/** Orchestrate an explicit change between the two uncalculated pool states within the requested event. */
async function changePoolSubmissionState(event: Event, poolId: string, body: unknown): Promise<void> {
    // Resolve event ownership before delegating any lifecycle write; UI confirmation is not an authorization boundary.
    await ensurePool(event, poolId);
    const value = preparePoolSubmissionState(body);
    // The operation repeats lifecycle and revision checks under the same pool lock used by submissions and calculation.
    await poolOperations.savePoolSubmissionState(poolId, value.status, value.expectedRevision);
}

// Save calculation inputs independently; closed pools keep their shares until recalculation.
/** Normalize current event membership and delegate assignment, factor, and exemption changes. */
async function updatePoolAssignments(event: Event, poolId: string, body: any) {
    // Confirm event ownership before using current registration data to interpret assignment fields.
    const pool = await ensurePool(event, poolId);
    const registrations = await eventService.getRegistrationsForEvent(event.id);
    const value = preparePoolAssignments(pool, body, registrations);
    // Membership-dependent checks repeat under the root lock inside the domain operation.
    await poolOperations.saveInvoicePoolAssignments(poolId, value.isDefault, value.assignAll,
        value.subtractPersonalInvoices, value.registrationIds, value.exemptIds, value.participantFactors);
}

// Signed adjustments are applied after the weighted base split.
/** Validate a signed adjustment and delegate its locked persistence. */
async function addPoolSurcharge(event: Event, poolId: string, body: any) {
    const pool = await ensurePool(event, poolId);
    const value = prepareSurchargeRequest(body);

    const registrationId = Number(value.registrationId);
    const cleanedNote = (value.note as string).trim();
    if (!cleanedNote) throw new APIError(invoiceText('noteIsRequired'), body, 400);
    await assertRegistrationAllowed(pool, registrationId);
    const subtractFromPool = value.subtractFromPool === true || value.subtractFromPool === 'on';
    await poolOperations.savePoolSurcharge(poolId, registrationId, Number(value.amount), cleanedNote, subtractFromPool);
}

// Remove an adjustment, invalidating previously calculated shares when necessary.
/** Check event ownership before delegating an idempotent adjustment deletion. */
async function removePoolSurcharge(event: Event, poolId: string, surchargeId: string) {
    await ensurePool(event, poolId);
    await poolOperations.deletePoolSurcharge(poolId, Number(surchargeId));
}

// Update takeover mappings from either participants or administrators, respecting the "covered participants cannot cover others" rule.
/** Save authorized coverage inputs, notifying immediately only while no calculation has been saved. */
async function updateTakeovers(event: Event, poolId: string, body: any, session: Request['session'], allowReassign: boolean) {
    // Request authorization and membership are explicit inputs to the takeover business module.
    const pool = await ensurePool(event, poolId);
    const registrations = await eventService.getRegistrationsForEvent(event.id);
    const actorId = await getActorRegistrationId(event, session);
    const value = prepareTakeoverRequest(pool, body, registrations, actorId, allowReassign);
    // Commit the input diff first. The locked result distinguishes applied planning changes from
    // closed-pool edits, which leave the saved shares and applied coverage pending recalculation.
    const changes = await savePoolTakeovers(poolId, value.payerId, value.beneficiaryIds, allowReassign);
    if (!changes.applied || (!changes.added.length && !changes.removed.length)) return;
    // Notify only applied changes after commit; mail failures cannot undo their persisted inputs.
    try {
        const participants = await eventService.getEventParticipants(event.id);
        await notifyTakeoverChanges(event, pool, changes, resolveActorLabel(session), participants);
    } catch (error) {
        console.error(invoiceText('takeoverNotificationFailed'), error);
    }
}

// Validate and submit a new invoice with its proof file attached.
/** Coordinate participant eligibility, proof attribution, locked submission, and a post-commit receipt. */
async function submitInvoice(event: Event, poolId: string, body: any, session: Request['session'], file?: Express.Multer.File | undefined) {
    // Resolve authenticated membership before normalizing invoice fields and checking this pool's eligibility.
    const regId = await getActorRegistrationId(event, session);
    if (!regId) throw new APIError(invoiceText('mustBeRegisteredToSubmit'), body, 401);
    const value = prepareSubmittedInvoice(body);

    const pool = await ensurePool(event, poolId);
    if (pool.status !== 'OPEN') throw new APIError(invoiceText('poolIsClosedForInvoiceSubmissions'), body, 400);
    const isAssigned = pool.assignAll || pool.assignments?.some((a) => a.registration.id === regId);
    if (!isAssigned) throw new APIError(invoiceText('notAllowedForThisPool'), body, 403);
    // Participant uploads keep their established mandatory proof and accepted MIME types.
    if (!file) throw new APIError(invoiceText('proofRequired'), body, 400);
    const isValidProof = file.mimetype === 'application/pdf' || file.mimetype.startsWith('image/');
    if (!isValidProof) {
        // Clean up unexpected uploads immediately to avoid orphan files
        void fs.promises.unlink(file.path).catch(() => undefined);
        throw new APIError(invoiceText('unsupportedProofType'), body, 400);
    }
    // Give the locked operation a portable proof descriptor; only a successful save can produce a receipt.
    const proofPath = path.relative(process.cwd(), file.path);
    const invoiceId = await invoiceOperations.persistSubmittedInvoice(poolId, regId, value.amount, value.description || null, {
        path: proofPath,
        originalName: file.originalname,
        mimeType: file.mimetype,
    });
    // Load persisted attribution after commit and prepare the receipt independently of SMTP delivery.
    try {
        const invoice = await invoiceService.getInvoiceWithRegistration(poolId, invoiceId);
        notifySubmittedInvoice(event, pool, invoice, value);
    } catch (error) {
        console.error(invoiceText('receiptPreparationFailed'), error);
    }
}

// Organizers can enter a shared pool cost without becoming an event participant.
/** Coordinate an accepted organizer expense and clean a rejected request’s optional upload. */
async function addOrganizerInvoice(event: Event, poolId: string, body: any, session: Request['session'], file?: Express.Multer.File) {
    // Organizers may record an accepted pool cost without registering, using optional bounded proof input.
    try {
        if (!session.profile?.id) throw new APIError(invoiceText('logInToRecordAPoolCost'), {}, 401);
        await ensurePool(event, poolId);
        const value = prepareOrganizerInvoice(body);
        if (file && !['application/pdf', 'image/jpeg', 'image/png', 'image/gif'].includes(file.mimetype)) {
            throw new APIError(invoiceText('unsupportedProofType'), {}, 400);
        }
        // Preserve the organizer recorder separately from optional paid-by attribution. The existing domain operation
        // repeats participant eligibility under the pool lock; absent attribution retains the shared-cost behavior.
        return await invoiceOperations.persistOrganizerInvoice(poolId, session.profile.id, value.amount, value.description, file ? {
            path: path.relative(process.cwd(), file.path), originalName: file.originalname, mimeType: file.mimetype,
        } : null, value.registrationId);
    } catch (error) {
        // A rejected cost must not leave its newly uploaded optional proof orphaned.
        if (file) await fs.promises.unlink(file.path).catch(() => undefined);
        throw error;
    }
}

// Accept an invoice, preserve optional organizer corrections, and notify the submitter.
/** Normalize organizer corrections and notify only a successfully committed acceptance. */
async function approveInvoice(
    event: Event,
    poolId: string,
    invoiceId: string,
    body: any,
    session: Request['session'],
) {
    const pool = await ensurePool(event, poolId);
    // Load the pool-scoped record for ownership checks and the post-commit notification context.
    const invoice = await invoiceService.getInvoiceWithRegistration(poolId, Number(invoiceId));
    if (!invoice) throw new APIError(invoiceText('invoiceNotFound'), {}, 404);
    if (invoice.status !== 'NEW') throw new APIError(invoiceText('onlyInvoicesAwaitingReviewCanBeAccepted'), body, 409);
    const {correctedAmount, correctedDescription} = prepareInvoiceAcceptance(body);
    // Repeat the review decision under the root lock; notify only the request that wins the transition.
    const accepted = await invoiceOperations.acceptSavedInvoice(poolId, Number(invoiceId), {correctedAmount, correctedDescription});
    if (!accepted) throw new APIError(invoiceText('invoiceWasAlreadyReviewedReloadToSeeTheSaved'), {}, 409);
    notifyAcceptedInvoice(event, pool, invoice, correctedAmount, correctedDescription, session);
}

// Close an approved invoice and inform the creator who performed the action.
/** Authorize invoice closure by its submitter or an organizer and notify after the locked transition. */
async function closeInvoice(
    event: Event,
    poolId: string,
    invoiceId: string,
    session: Request['session'],
    permData?: PermBundle,
    allowManageOverride = true,
) {
    const pool = await ensurePool(event, poolId);
    // Load the pool-scoped record for ownership checks and the post-commit notification context.
    const invoice = await invoiceService.getInvoiceWithRegistration(poolId, Number(invoiceId));
    if (!invoice) throw new APIError(invoiceText('invoiceNotFound'), {}, 404);
    if (invoice.status === 'CLOSED') return;
    if (invoice.status !== 'APPROVED') {
        throw new APIError(invoiceText('invoicesMustBeAcceptedBeforeClosing'), {}, 400);
    }
    // Closing may be performed by the submitter or an authorized organizer; self-close forbids the override.
    const actorRegId = await getActorRegistrationId(event, session);
    const canManage = allowManageOverride && (permData?.entity?.has('MANAGE_ASSIGNMENTS') ?? false);
    const isSubmitter = actorRegId !== undefined && actorRegId === invoice.registrationId;
    if (!canManage && !isSubmitter) {
        throw new APIError(invoiceText('youCanOnlyCloseYourOwnAcceptedInvoicesUnless'), {}, 403);
    }
    // The domain retains the accepted cost and treats an already closed row idempotently.
    const closed = await invoiceOperations.closeSavedInvoice(poolId, Number(invoiceId));
    if (!closed) return;
    notifyClosedInvoice(event, pool, invoice, session);
}

// Reject an invoice without deleting its audit history or proof.
/** Normalize a rejection reason and notify only a successfully committed review decision. */
async function declineInvoice(
    event: Event,
    poolId: string,
    invoiceId: string,
    body: any,
    session: Request['session'],
) {
    const pool = await ensurePool(event, poolId);
    // Load the pool-scoped record for ownership checks and the post-commit notification context.
    const invoice = await invoiceService.getInvoiceWithRegistration(poolId, Number(invoiceId));
    if (!invoice) throw new APIError(invoiceText('invoiceNotFound'), {}, 404);
    if (invoice.status !== 'NEW') throw new APIError(invoiceText('onlyInvoicesAwaitingReviewCanBeRejected'), body, 409);
    const value = prepareInvoiceRejection(body);

    // The locked decision retains invoice evidence and excludes this cost; notification follows successful commit.
    const declined = await invoiceOperations.rejectSavedInvoice(poolId, Number(invoiceId), value.rejectionReason);
    if (!declined) throw new APIError(invoiceText('invoiceWasAlreadyReviewedReloadToSeeTheSaved'), {}, 409);
    notifyRejectedInvoice(event, pool, invoice, value.rejectionReason, session);
}

/** Coordinate a revision-checked correction while retaining submitted invoice evidence. */
async function reviseInvoice(event: Event, poolId: string, invoiceId: string, body: any, session: Request['session']) {
    const value = prepareInvoiceRevision(body);
    const pool = await ensurePool(event, poolId);
    // Load the pool-scoped record for ownership checks and the post-commit notification context.
    const invoice = await invoiceService.getInvoiceWithRegistration(poolId, Number(invoiceId));
    if (!invoice) throw new APIError(invoiceText('invoiceNotFound'), {}, 404);
    // Delegate the revision-checked mutation, then describe its committed result to the saved contact.
    const saved = await invoiceOperations.reviseSavedInvoice(poolId, Number(invoiceId), {
        correctedAmount: value.correctedAmount, correctedDescription: value.correctedDescription || null,
    }, value);
    notifySavedInvoiceChange(event, pool, invoice, saved, 'corrected', session);
}

/** Coordinate a revision-checked removal from calculated costs without deleting history. */
async function rejectAcceptedInvoice(event: Event, poolId: string, invoiceId: string, body: any, session: Request['session']) {
    const value = prepareAcceptedInvoiceRejection(body);
    const pool = await ensurePool(event, poolId);
    // Load the pool-scoped record for ownership checks and the post-commit notification context.
    const invoice = await invoiceService.getInvoiceWithRegistration(poolId, Number(invoiceId));
    if (!invoice) throw new APIError(invoiceText('invoiceNotFound'), {}, 404);
    // Delegate the revision-checked mutation, then describe its committed result to the saved contact.
    const saved = await invoiceOperations.rejectAcceptedSavedInvoice(poolId, Number(invoiceId), value.rejectionReason, value);
    notifySavedInvoiceChange(event, pool, invoice, saved, 'rejected', session);
}

/** Coordinate an authenticated submitter’s revision-checked withdrawal before review. */
async function retractInvoice(event: Event, poolId: string, invoiceId: string, body: any, session: Request['session']) {
    if (!session.profile?.id) throw new APIError(invoiceText('logInToRetractYourInvoice'), {}, 401);
    const value = prepareConfirmedInvoiceChange(body);
    const pool = await ensurePool(event, poolId);
    // Load the pool-scoped record for ownership checks and the post-commit notification context.
    const invoice = await invoiceService.getInvoiceWithRegistration(poolId, Number(invoiceId));
    if (!invoice) throw new APIError(invoiceText('invoiceNotFound'), {}, 404);
    // Delegate the revision-checked mutation, then describe its committed result to the saved contact.
    const saved = await invoiceOperations.retractSavedInvoice(poolId, Number(invoiceId), session.profile.id, value);
    notifySavedInvoiceChange(event, pool, invoice, saved, 'retracted', session);
}

/** Load calculation inputs and return the shared module’s read-only preview. */
async function previewPool(event: Event, poolId: string) {
    // Hydrate one authorized pool and its event participants, then return the domain's read-only DTO.
    const pool = await ensurePool(event, poolId);
    const participants = await eventService.getEventParticipants(event.id);
    const registrations = await eventService.getRegistrationsForEvent(event.id);
    return buildPoolCalculationPreview(pool, participants, registrations);
}

/** Apply allocation inputs atomically, then notify applied coverage and optional settlement results. */
async function closePool(event: Event, poolId: string, body: any = {}, session?: Request['session'], recalculate = false) {
    const options = prepareCalculationOptions(body);
    // Fetch authorized source data once, then let the calculation module build allocations and provenance.
    const pool = await ensurePool(event, poolId);
    const participants = await eventService.getEventParticipants(event.id);
    const registrations = await eventService.getRegistrationsForEvent(event.id);
    const {sharePayloads, approvedInvoiceIds, explanation} = calculatePoolInputs(pool, participants, registrations);
    // A preview must still match its input revision; the commit repeats the comparison under its lock.
    if (options.expectedRevision !== undefined && options.expectedRevision !== pool.calculationRevision) {
        throw new APIError(invoiceText('thePreviewIsOutOfDatePreviewTheCalculation'), {}, 409);
    }
    // Persist shares, cumulative settlement credits, and saved calculation inputs in one locked transaction.
    const committed = await poolOperations.commitPoolCalculation(poolId, approvedInvoiceIds, sharePayloads, recalculate, pool.calculationRevision, explanation);
    // Capture this exact committed calculation for mandatory history notices, even if another request edits the pool afterward.
    const committedPool = {...pool, status: 'CLOSED' as const, needsRecalculation: false,
        shares: committed.shares, calculationSnapshot: committed.calculationSnapshot};
    const affectedRegistrationIds = committed.settledShareImpacts.map(impact => impact.registrationId);
    // Coverage notices describe the old-to-new applied snapshot, never the intermediate staged edits.
    // They remain independent of the calculation-email preference, matching immediate planning notices.
    try {
        await notifyTakeoverChanges(event, pool, committed.takeoverChanges, resolveActorLabel(session), participants);
    } catch (error) {
        console.error(invoiceText('takeoverNotificationFailed'), error);
    }
    // Historic payers must hear that exemption or coverage changed their saved responsibility, independently of bulk preferences.
    // Delivery is post-commit and cannot erase their retained payment/refund row or roll back the allocation.
    if (affectedRegistrationIds.length) {
        try {
            const contacts = new Map(participants.map(participant => [Number(participant.id), participant]));
            notifyPoolShareSettlements(event, committedPool, contacts, 'responsibility-changed', session,
                {registrationIds: affectedRegistrationIds});
        } catch (error) {
            console.error(invoiceText('settlementNotificationFailed'), error);
        }
    }
    // The settlement preference applies only after commit; delivery failures cannot undo calculation.
    const sendEmails = options.sendEmails === undefined ? pool.sendCalculationEmails : options.sendEmails === true || options.sendEmails === 'on';
    if (sendEmails) {
        try {
            await notifyPoolShares(event, poolId, {expectedRevision: pool.calculationRevision + 1}, session,
                recalculate ? 'recalculated' : 'closed', affectedRegistrationIds);
        } catch (error) {
            console.error(invoiceText('settlementNotificationFailed'), error);
        }
    }
}

/** Delegate restoration of saved pool inputs while retaining shares and settlements. */
async function rollbackPoolChanges(event: Event, poolId: string, body: any = {}) {
    await ensurePool(event, poolId);
    const options = prepareCalculationOptions(body);
    return poolOperations.restorePoolCalculationInputs(poolId, options.expectedRevision);
}

/** Resolve saved share and contact data before requesting settlement notices. */
async function notifyPoolShares(event: Event, poolId: string, body: any = {}, session?: Request['session'],
    reason: 'closed' | 'recalculated' | 'requested' = 'requested', excludedRegistrationIds: readonly number[] = []) {
    const options = prepareCalculationOptions(body);
    // Notifications describe the saved calculation; load contact data without recalculating any shares.
    const participants = new Map((await eventService.getEventParticipants(event.id)).map((participant) => [Number(participant.id), participant]));
    const pool = await ensurePool(event, poolId);
    if (pool.status !== 'CLOSED') throw new APIError(invoiceText('closeThePoolBeforeSendingSettlementEmails'), {}, 400);
    if (options.expectedRevision !== undefined && options.expectedRevision !== pool.calculationRevision) {
        throw new APIError(invoiceText('theSettlementChangedReloadBeforeSendingEmails'), {}, 409);
    }
    // The notification module owns message construction and non-blocking delivery for reachable payers.
    return notifyPoolShareSettlements(event, pool, participants, reason, session, {excludedRegistrationIds});
}

// Toggle payment state of a share and inform the participant with actor attribution.
/** Delegate a settlement-status change and describe the signed saved balance to its payer. */
async function markSharePaid(event: Event, poolId: string, shareId: string, isPaid: boolean, session: Request['session']) {
    const pool = await ensurePool(event, poolId);
    const share = await invoiceService.getShareWithRegistration(poolId, Number(shareId));
    if (!share) throw new APIError(invoiceText('shareNotFound'), {}, 404);
    // The domain updates status and date only, retaining the original signed calculated balance.
    await poolOperations.recordShareSettlement(poolId, Number(shareId), isPaid);
    notifyShareSettlement(event, pool, share, isPaid, session);
}

// Serve invoice proof files securely with authentication and permission checks
/** Resolve authenticated request context before delegating proof ownership and filesystem checks. */
export async function serveInvoiceProof(event: Event, poolId: string, invoiceId: string, session: Request['session'], permData?: PermBundle) {
    if (!session.profile) throw new APIError(invoiceText('logInToViewInvoiceProofs'), {}, 401);
    await ensurePool(event, poolId);
    // Load the pool-scoped record for ownership checks and the post-commit notification context.
    const invoice = await invoiceService.getInvoiceWithRegistration(poolId, Number(invoiceId));
    // Delegate ownership and file-boundary policy after collecting the authenticated request context.
    const actorRegId = await getActorRegistrationId(event, session);
    return getInvoiceProofPath(invoice, actorRegId, permData?.entity?.has('MANAGE_ASSIGNMENTS') ?? false);
}

/** Load a saved share export through DBAL and the invoice feature's export policy. */
async function getInvoiceSharesPdfData(event: Event, poolId: string, query: unknown = {}): Promise<InvoiceSharesPdfData> {
    // Normalize layout preferences in the existing request module before loading the authorized saved data.
    const pdfOptions = prepareSharesPdfOptions(query);
    // Validate the event boundary and frozen calculation before loading any participant names.
    const pool = await invoiceService.getPoolWithInvoices(poolId);
    assertInvoiceSharesExportable(pool, event.id);
    // Current names decorate saved rows only; every amount and calculation input stays frozen.
    const participants = await eventService.getEventParticipants(event.id);
    const names = new Map(participants.map(participant => [participant.id, participant.name]));
    const shares = pool.shares.map(share => ({
        ...share, name: names.get(share.registrationId) ?? invoiceText('participant', {id: share.registrationId}),
        // Preserve the same frozen responsibility/history notice shown in both in-app share ledgers.
        settledShareNotice: invoiceSettledShareNotice(pool, share, participants),
    })).sort((left, right) => left.name.localeCompare(right.name) || left.registrationId - right.registrationId);
    // Pass the saved explanation explicitly, retaining the missing-input fallback for legacy snapshots.
    // The exporter receives frozen adjustment modes alongside the saved explanation, including older snapshots.
    return {event, pool, shares, explanation: pool.calculationSnapshot?.explanation,
      savedAdjustments: pool.calculationSnapshot?.surcharges, generatedAt: new Date().toISOString(), pdfOptions};
}

// Replace the saved calculation atomically while the pool remains closed to new uploads.
/** Coordinate replacement of a closed pool’s saved calculation through the shared commit flow. */
async function recalculatePool(event: Event, poolId: string, body: any = {}, session?: Request['session']) {
    const pool = await ensurePool(event, poolId);
    if (pool.status !== 'CLOSED') {
        throw new APIError(invoiceText('onlyClosedPoolsCanBeRecalculated'), {}, 400);
    }

    await closePool(event, poolId, body, session, true);
}

export default {
    createInvoicePool,
    updatePoolSettings,
    changePoolSubmissionState,
    updatePoolAssignments,
    addPoolSurcharge,
    removePoolSurcharge,
    submitInvoice,
    addOrganizerInvoice,
    reviseInvoice,
    rejectAcceptedInvoice,
    retractInvoice,
    approveInvoice,
    closeInvoice,
    declineInvoice,
    closePool,
    recalculatePool,
    previewPool,
    rollbackPoolChanges,
    notifyPoolShares,
    markSharePaid,
    getInvoiceSharesPdfData,
    updateTakeovers,
    serveInvoiceProof
};
