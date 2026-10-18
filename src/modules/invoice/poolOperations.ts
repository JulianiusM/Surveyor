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
import {createHash} from 'node:crypto';
import type {EntityManager} from 'typeorm';
import type {EventInvoicePool} from '../database/entities/event/EventInvoicePool';
import type {EventRegistration} from '../database/entities/event/EventRegistration';
import type {EventInvoice} from '../database/entities/event/EventInvoice';
import * as invoiceService from '../database/services/EventInvoiceService';
import {APIError} from '../lib/errors';
import {resolveInvoiceAmount, toAmount} from '../lib/util';
import type {InvoicePoolDistribution, InvoiceCalculationExplanation, InvoicePoolCalculationSnapshot, InvoiceSharePayload, InvoicePoolCalculationCommit, InvoicePoolSubmissionState, InvoiceSettledShareImpact} from '../../types/InvoicePoolTypes';
import {requireLockedPool, assertLockedParticipant, savePoolChange} from './state';
import {invoiceCents} from './validation';
import {validateInvoiceFactor} from './distribution';
import {collectSettledRegistrationIds, projectInvoiceShares} from './settlements';
import {comparePoolTakeovers, invoiceAppliedTakeovers, invoiceHasAppliedTakeoverEvidence, invoiceSettledShareImpact} from './coverage';

/** Update allocation settings under the pool lock, distinguishing notification-only changes. */
export async function saveInvoicePoolSettings(poolId: string, distribution: InvoicePoolDistribution, description?: string, sendCalculationEmails?: boolean, roundUpShares?: boolean): Promise<void> {
    /** Evaluate this operation and apply its writes while the DBAL holds the pool’s root lock. */
    async function updateLocked(manager: EntityManager, row: EventInvoicePool | null): Promise<void> {
        // The DBAL holds the root lock; decisions below use the current persisted pool state.
        const pool = requireLockedPool(row);
        // Notification preferences do not invalidate the calculation; allocation and rounding changes do.
        const inputsChanged = pool.distributionMethod !== distribution
            || (description !== undefined && (pool.description ?? '') !== description)
            || (roundUpShares !== undefined && Boolean(pool.roundUpShares) !== roundUpShares);
        // Apply only supplied optional fields, then advance the revision and refresh stored aggregates.
        pool.distributionMethod = distribution;
        if (description !== undefined) pool.description = description;
        if (sendCalculationEmails !== undefined) pool.sendCalculationEmails = sendCalculationEmails;
        if (roundUpShares !== undefined) pool.roundUpShares = roundUpShares;
        await savePoolChange(manager, pool, inputsChanged);
    }
    await invoiceService.withLockedPool(poolId, updateLocked);
}

/** Change an uncalculated pool's independent submission-access state without replacing costs or allocations. */
export async function savePoolSubmissionState(poolId: string, status: InvoicePoolSubmissionState, expectedRevision: number): Promise<void> {
    /** Evaluate the submission transition while DBAL holds the same root lock used by invoice creation. */
    async function changeLocked(manager: EntityManager, row: EventInvoicePool | null): Promise<void> {
        const pool = requireLockedPool(row);
        // A financial close is authoritative. This operation never reopens calculated shares or bypasses their workflow.
        if (pool.status === 'CLOSED') throw new APIError(invoiceText('participantInvoiceAccessOnlyBeforeCalculation'), {}, 409);
        if (pool.calculationRevision !== expectedRevision) throw new APIError(invoiceText('poolChangedBeforeSubmissionState'), {}, 409);
        if (pool.status === status) return;
        // Invalidate outstanding previews while keeping every cost and allocation input; this is not a calculation edit.
        pool.status = status;
        await savePoolChange(manager, pool, false);
    }
    await invoiceService.withLockedPool(poolId, changeLocked);
}

/** Validate current membership, retain factors, and prune only removed members’ allocation inputs. */
export async function saveInvoicePoolAssignments(poolId: string, isDefault: boolean, assignAll: boolean, subtractPersonalInvoices: boolean,
    allowedRegistrationIds: number[], exemptRegistrationIds: number[], participantFactors: Record<number, number> = {}): Promise<void> {
    /** Evaluate this operation and apply its writes while the DBAL holds the pool’s root lock. */
    async function updateLocked(manager: EntityManager, row: EventInvoicePool | null): Promise<void> {
        // The DBAL holds the root lock; decisions below use the current persisted pool state.
        const pool = requireLockedPool(row);
        // Validate every requested member and factor against event membership inside this transaction.
        const records = await invoiceService.getCalculationRows(manager, pool);
        const eventIds = records.registrations.map(registration => registration.id);
        const validIds = Array.from(new Set(assignAll ? eventIds : allowedRegistrationIds));
        if (validIds.some(id => !eventIds.includes(id))) throw new APIError(invoiceText('participantDoesNotBelongToThisEvent'), {}, 400);
        for (const [id, factor] of Object.entries(participantFactors)) {
            if (!validIds.includes(Number(id))) throw new APIError(invoiceText('factorParticipantIsNotAssignedToThisPool'), {}, 400);
            try { validateInvoiceFactor(factor); }
            catch (error) { throw new APIError(error instanceof Error ? error.message : invoiceText('invalidFactor'), {}, 400); }
        }
        // Assignment replacement must retain saved factors when a request only changes membership.
        // Removing a member also removes coverage and adjustments that would otherwise outlive it.
        const existingFactors = new Map(records.assignments.map(assignment => [assignment.registrationId, assignment.factor]));
        const assignments = validIds.map(registrationId => ({
            registrationId, isExempt: exemptRegistrationIds.includes(registrationId),
            factor: participantFactors[registrationId] ?? existingFactors.get(registrationId) ?? 1,
        }));
        await invoiceService.replaceAssignments(poolId, assignments, manager);
        // Prune only dependent allocation inputs for removed members; keep invoices and saved settlements.
        const droppedTakeovers = records.takeovers.filter(takeover => !validIds.includes(takeover.payerRegistrationId)
            || !validIds.includes(takeover.beneficiaryRegistrationId)).map(takeover => takeover.id);
        const droppedSurcharges = records.surcharges.filter(surcharge => !validIds.includes(surcharge.registrationId)).map(surcharge => surcharge.id);
        await invoiceService.deleteTakeovers(droppedTakeovers, manager);
        await invoiceService.deleteSurcharges(droppedSurcharges, manager);
        // Save the requested allocation flags and mark closed-pool shares stale without replacing them.
        pool.isDefault = isDefault;
        pool.assignAll = assignAll;
        pool.subtractPersonalInvoices = subtractPersonalInvoices;
        await savePoolChange(manager, pool);
    }
    await invoiceService.withLockedPool(poolId, updateLocked);
}

/** Identify newly restricted recorded payers from old and new applied evidence, never staged edits. */
function appliedSettledShareChanges(pool: EventInvoicePool, snapshot: InvoicePoolCalculationSnapshot): InvoiceSettledShareImpact[] {
    const previous = pool.calculationSnapshot;
    // Unknown legacy responsibility cannot prove a change. Establish evidence without speculative notices.
    if (!previous || !invoiceHasAppliedTakeoverEvidence(pool)) return [];
    const previousPool = {status: 'CLOSED', calculationSnapshot: {...previous, settledRegistrationIds: snapshot.settledRegistrationIds}};
    const nextPool = {status: 'CLOSED', calculationSnapshot: snapshot};
    const impacts: InvoiceSettledShareImpact[] = [];
    // The newly collected history also proves a transfer on the previous row, before its first ID snapshot existed.
    // Reuse the same frozen responsibility resolver as the UI and email wording instead of duplicating its rules.
    for (const registrationId of snapshot.settledRegistrationIds || []) {
        const before = invoiceSettledShareImpact(previousPool, registrationId);
        const after = invoiceSettledShareImpact(nextPool, registrationId);
        // A saved pair list alone certifies coverage changes, but cannot establish an old exemption flag.
        if (after?.reason === 'exempt' && !Array.isArray(previous.assignments)
            && !Array.isArray(previous.explanation?.contributions)) continue;
        if (after && (before?.reason !== after.reason || before.payerRegistrationId !== after.payerRegistrationId)) impacts.push(after);
    }
    return impacts;
}

/** Save shares, active carried-settlement identity and provenance atomically, returning only actually applied changes. */
export async function commitPoolCalculation(poolId: string, _approvedInvoiceIds: number[], sharePayloads: InvoiceSharePayload[],
    recalculate = false, expectedRevision?: number, explanation?: InvoiceCalculationExplanation): Promise<InvoicePoolCalculationCommit> {
    /** Evaluate this operation and apply its writes while the DBAL holds the pool’s root lock. */
    async function calculateLocked(manager: EntityManager, row: EventInvoicePool | null): Promise<InvoicePoolCalculationCommit> {
        // The DBAL holds the root lock; decisions below use the current persisted pool state.
        const pool = requireLockedPool(row);
        // Reject stale previews and invalid transitions before replacing any share rows.
        if (expectedRevision !== undefined && pool.calculationRevision !== expectedRevision) throw new APIError(invoiceText('poolInputsChangedDuringCalculationReloadAndCalculateAgain'), {}, 409);
        if (recalculate && pool.status !== 'CLOSED') throw new APIError(invoiceText('onlyClosedPoolsCanBeRecalculated'), {}, 409);
        if (!recalculate && pool.status === 'CLOSED') throw new APIError(invoiceText('poolIsAlreadyClosed'), {}, 409);
        const rows = await invoiceService.getCalculationRows(manager, pool);
        // Compare the final pending inputs with the applied snapshot read under this same lock.
        // First closure already notified its planning edits. Older snapshots may certify coverage
        // through their frozen contribution attribution even when their takeover list is missing.
        const snapshot = captureCalculationSnapshot(pool, rows, explanation);
        const registrationIds = rows.registrations.map(registration => registration.id);
        // Nonzero carried credits need a visible correcting balance. Once consumed, their old history IDs expire.
        // Derive this under the lock from actual signed transfers, retaining the existing hard-deletion boundary.
        snapshot.settledRegistrationIds = collectSettledRegistrationIds(rows.shares, registrationIds);
        // A legacy snapshot without either source cannot prove an old responsibility. Establish
        // its first baseline without speculative notices, using the same saved-source selector as views.
        const takeoverChanges = recalculate && invoiceHasAppliedTakeoverEvidence(pool)
            ? comparePoolTakeovers(invoiceAppliedTakeovers(pool), snapshot.takeovers)
            : {added: [], removed: []};
        const settledShareImpacts = recalculate ? appliedSettledShareChanges(pool, snapshot) : [];
        // Carry signed settlements forward once, including refund-only rows for former payers.
        const projected = projectInvoiceShares(rows.shares, sharePayloads, registrationIds);
        const saved = await invoiceService.replaceShares(poolId, projected, manager);
        // Commit the new shares and their numeric provenance atomically; input rollback keeps this snapshot.
        pool.status = 'CLOSED';
        pool.closedAt = new Date();
        pool.needsRecalculation = false;
        pool.calculationRevision++;
        pool.calculationSnapshot = snapshot;
        await invoiceService.savePool(pool, manager);
        await invoiceService.refreshPoolTotals(manager, poolId);
        // The DBAL resolves this result after commit. The controller can now notify the actual
        // applied delta without relying on its earlier, potentially stale pool read.
        return {shares: saved, takeoverChanges, settledShareImpacts, calculationSnapshot: snapshot};
    }
    return invoiceService.withLockedPool(poolId, calculateLocked);
}

/** Restore pool-local inputs without undoing attendance, invoice edits, or recorded settlements. */
export async function restorePoolCalculationInputs(poolId: string, expectedRevision?: number): Promise<{needsRecalculation: boolean; externalChanges: boolean}> {
    /** Evaluate this operation and apply its writes while the DBAL holds the pool’s root lock. */
    async function restoreLocked(manager: EntityManager, row: EventInvoicePool | null) {
        // The DBAL holds the root lock; decisions below use the current persisted pool state.
        const pool = requireLockedPool(row);
        // A rollback requires the matching saved input snapshot and the current pool revision.
        if (pool.status !== 'CLOSED') throw new APIError(invoiceText('onlyCalculatedPoolsHaveSavedInputsToRestore'), {}, 409);
        if (expectedRevision !== undefined && pool.calculationRevision !== expectedRevision) throw new APIError(invoiceText('poolChangedBeforeRollbackReloadAndTryAgain'), {}, 409);
        const snapshot = pool.calculationSnapshot;
        if (!snapshot || snapshot.version !== 1 || !invoiceHasAppliedTakeoverEvidence(pool)) {
            throw new APIError(invoiceText('noPreviousInputSnapshotIsAvailableCalculateThePool'), {}, 409);
        }
        // Legacy numeric explanations can certify coverage when their explicit list is missing.
        // Use only that saved evidence; never restore current pending inputs as a guessed old baseline.
        const appliedTakeovers = invoiceAppliedTakeovers(pool);
        const rows = await invoiceService.getCalculationRows(manager, pool);
        const validIds = new Set(rows.registrations.map(registration => registration.id));
        // Compare attendance and counted invoices separately: restoring local settings cannot undo them.
        const externalChanges = externalCalculationFingerprint(rows.registrations, rows.invoices) !== snapshot.externalFingerprint;
        const assignments = snapshot.assignments.filter(assignment => validIds.has(assignment.registrationId));
        // Default pools must retain registrations added since the snapshot; a rollback cannot erase
        // the default membership that those registrations received when they joined the event.
        if (snapshot.settings.isDefault) {
            const previousIds = new Set(snapshot.externalRegistrationIds);
            for (const registration of rows.registrations) {
                if (!previousIds.has(registration.id)) assignments.push({registrationId: registration.id, factor: 1, isExempt: false});
            }
        }
        const assignedIds = snapshot.settings.assignAll ? validIds : new Set(assignments.map(assignment => assignment.registrationId));
        // Restore only inputs whose registrations still exist; never write share or payment rows here.
        await invoiceService.replaceAssignments(poolId, assignments, manager);
        await invoiceService.replaceSurcharges(poolId, snapshot.surcharges.filter(surcharge => assignedIds.has(surcharge.registrationId)), manager);
        await invoiceService.replaceTakeovers(poolId, appliedTakeovers.filter(takeover => assignedIds.has(takeover.payerRegistrationId)
            && assignedIds.has(takeover.beneficiaryRegistrationId)), manager);
        // Legacy snapshots have no rounding evidence and therefore still require a new calculation.
        Object.assign(pool, snapshot.settings);
        pool.roundUpShares = snapshot.settings.roundUpShares ?? true;
        const needsRecalculation = externalChanges || snapshot.settings.roundUpShares === undefined;
        pool.needsRecalculation = needsRecalculation;
        // Keep shares, payment markers, and their numeric explanation unchanged by input rollback.
        await savePoolChange(manager, pool, false);
        return {needsRecalculation, externalChanges};
    }
    return invoiceService.withLockedPool(poolId, restoreLocked);
}

/** Persist a bounded signed adjustment after checking current locked pool membership. */
export async function savePoolSurcharge(poolId: string, registrationId: number, amount: number, note: string, subtractFromPool: boolean) {
    // Signed adjustments must be finite, nonzero, and fit the existing money-column bounds.
    if (!Number.isFinite(amount) || amount === 0 || Math.abs(amount) > 99999999.99) throw new APIError(invoiceText('enterANonZeroSurchargeOrRebateWithinThe'), {}, 400);
    /** Evaluate this operation and apply its writes while the DBAL holds the pool’s root lock. */
    async function addLocked(manager: EntityManager, row: EventInvoicePool | null) {
        // The DBAL holds the root lock; decisions below use the current persisted pool state.
        const pool = requireLockedPool(row);
        await assertLockedParticipant(manager, pool, registrationId);
        // Persist the adjustment after locked membership validation, then invalidate saved allocation inputs.
        const saved = await invoiceService.saveSurcharge(poolId, registrationId, amount, note, subtractFromPool, manager);
        await savePoolChange(manager, pool);
        return saved;
    }
    return invoiceService.withLockedPool(poolId, addLocked);
}

/** Delete an existing adjustment idempotently and invalidate allocation inputs atomically. */
export async function deletePoolSurcharge(poolId: string, surchargeId: number): Promise<void> {
    /** Evaluate this operation and apply its writes while the DBAL holds the pool’s root lock. */
    async function removeLocked(manager: EntityManager, row: EventInvoicePool | null): Promise<void> {
        // The DBAL holds the root lock; decisions below use the current persisted pool state.
        const pool = requireLockedPool(row);
        // Preserve the existing idempotent deletion contract without invalidating a preview twice.
        if (!await invoiceService.getSurcharge(poolId, surchargeId, manager)) return;
        // Deletion and revision invalidation commit together; saved shares remain available for settlement.
        await invoiceService.deleteSurcharge(poolId, surchargeId, manager);
        await savePoolChange(manager, pool);
    }
    await invoiceService.withLockedPool(poolId, removeLocked);
}

/** No new API confirmation/revision fields: the approved confirmation gate belongs to the frontend. */
export async function recordShareSettlement(poolId: string, shareId: number, isPaid: boolean): Promise<void> {
    /** Evaluate this operation and apply its writes while the DBAL holds the pool’s root lock. */
    async function settleLocked(manager: EntityManager, row: EventInvoicePool | null): Promise<void> {
        // The DBAL holds the root lock; decisions below use the current persisted pool state.
        const pool = requireLockedPool(row);
        if (pool.status !== 'CLOSED') throw new APIError(invoiceText('calculateThePoolBeforeRecordingSharePayments'), {}, 409);
        // Resolve the share in this pool under the same lock used by recalculation and input edits.
        const share = await invoiceService.getShareWithRegistration(poolId, shareId, manager);
        if (!share) throw new APIError(invoiceText('shareNotFound'), {}, 404);
        // Settlement changes only status and timestamp. The signed calculated shareAmount is immutable here.
        share.isPaid = isPaid;
        share.paidAt = isPaid ? new Date() : null;
        await invoiceService.saveShare(share, manager);
        await savePoolChange(manager, pool, false);
    }
    await invoiceService.withLockedPool(poolId, settleLocked);
}

type CalculationRecords = Awaited<ReturnType<typeof invoiceService.getCalculationRows>>;

/** Hash only external attendance and counted invoice inputs in deterministic order. */
function externalCalculationFingerprint(registrations: EventRegistration[], invoices: EventInvoice[]): string {
    // Sort a minimal input projection so query order and unrelated invoice fields cannot change the digest.
    const inputs = {
        registrations: [...registrations].sort((left, right) => left.id - right.id)
            .map(registration => [registration.id, registration.arrivalDate, registration.departureDate]),
        invoices: invoices.filter(invoice => invoice.status === 'APPROVED' || invoice.status === 'CLOSED')
            .sort((left, right) => left.id - right.id)
            .map(invoice => [invoice.id, invoice.registrationId, invoiceCents(resolveInvoiceAmount(invoice.amount, invoice.correctedAmount))]),
    };
    // Keep external evidence opaque; rollback compares the fingerprint rather than exposing private invoice data.
    return createHash('sha256').update(JSON.stringify(inputs)).digest('hex');
}

/** Snapshot selection and retention policy are business concerns; the DBAL stores the resulting JSON. */
function captureCalculationSnapshot(pool: EventInvoicePool, rows: CalculationRecords, explanation?: InvoiceCalculationExplanation): InvoicePoolCalculationSnapshot {
    // Persist value copies of pool-local inputs and the exact calculation explanation, with a versioned contract.
    return {
        version: 1,
        settings: {
            distributionMethod: pool.distributionMethod, description: pool.description ?? null,
            isDefault: Boolean(pool.isDefault), assignAll: Boolean(pool.assignAll), subtractPersonalInvoices: Boolean(pool.subtractPersonalInvoices),
            sendCalculationEmails: Boolean(pool.sendCalculationEmails), roundUpShares: pool.roundUpShares === undefined ? true : Boolean(pool.roundUpShares),
        },
        assignments: rows.assignments.map(assignment => ({registrationId: assignment.registrationId, factor: assignment.factor, isExempt: Boolean(assignment.isExempt)})),
        surcharges: rows.surcharges.map(surcharge => ({
            registrationId: surcharge.registrationId, amount: toAmount(surcharge.amount), note: surcharge.note, subtractFromPool: Boolean(surcharge.subtractFromPool),
        })),
        takeovers: rows.takeovers.map(takeover => ({payerRegistrationId: takeover.payerRegistrationId, beneficiaryRegistrationId: takeover.beneficiaryRegistrationId})),
        // Event attendance and counted invoices are detection-only; rollback never restores those records.
        externalFingerprint: externalCalculationFingerprint(rows.registrations, rows.invoices),
        externalRegistrationIds: rows.registrations.map(registration => registration.id),
        explanation,
    };
}
