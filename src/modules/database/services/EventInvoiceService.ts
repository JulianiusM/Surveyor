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

import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
import {format, subMonths} from "date-fns";
import {EntityManager} from "typeorm";
import type {InvoicePoolCalculationSnapshot, InvoicePoolDistribution, InvoicePoolStatus} from "../../../types/InvoicePoolTypes";
import {APIError} from "../../lib/errors";
import {validateInvoiceFactor} from "../../lib/invoiceDistribution";
import {formatAmount, resolveInvoiceAmount, toAmount} from "../../lib/util";
import settings from "../../settings";
import {AppDataSource} from "../dataSource";
import {Event} from "../entities/event/Event";
import {EventInvoice, InvoiceStatus} from "../entities/event/EventInvoice";
import {EventInvoicePool} from "../entities/event/EventInvoicePool";
import {EventInvoiceShare} from "../entities/event/EventInvoiceShare";
import {EventInvoiceSurcharge} from "../entities/event/EventInvoiceSurcharge";
import {EventPoolAssignment} from "../entities/event/EventPoolAssignment";
import {EventPoolTakeover} from "../entities/event/EventPoolTakeover";
import {EventRegistration} from "../entities/event/EventRegistration";

// Separate relation queries avoid multiplying all child collections into one large join.
// A repeatable-read transaction keeps the revision, settings, and saved shares in one snapshot.
async function loadPool(poolId: string) {
    return AppDataSource.transaction("REPEATABLE READ", (manager) => manager.getRepository(EventInvoicePool).findOne({
        where: {id: poolId},
        relationLoadStrategy: "query",
        relations: {
            event: true,
            assignments: {registration: true},
            invoices: {registration: true},
            shares: {registration: true},
            takeovers: {payerRegistration: true, beneficiaryRegistration: true},
            surcharges: {registration: true},
        },
    }));
}

export interface InvoiceCorrections {
    correctedAmount?: number | null;
    correctedDescription?: string | null;
}

export interface InvoiceSharePayload {
    registrationId: number;
    baseShareAmount: number;
    extraAmount: number;
    invoiceCreditAmount: number;
    shareAmount: number;
    note?: string | null;
}

export interface ProjectedInvoiceShare extends InvoiceSharePayload {
    paymentCreditAmount: number;
    isPaid: boolean;
    paidAt: Date | null;
}

type PreviousInvoiceShare = Pick<EventInvoiceShare, "registrationId" | "shareAmount" | "isPaid">
    & Partial<Pick<EventInvoiceShare, "paymentCreditAmount" | "paidAt">>;

function invoiceCents(amount: number): number {
    const cents = Math.round(amount * 100);
    if (!Number.isFinite(amount) || !Number.isSafeInteger(cents)) {
        throw new APIError("Invoice amounts must be finite and within the supported range", {}, 400);
    }
    return cents;
}

/** Project the remaining balance while keeping settled money with its actual payer. */
export function projectInvoiceShares(
    previousShares: readonly PreviousInvoiceShare[],
    newGrossPayloads: readonly InvoiceSharePayload[],
    existingRegistrationIds?: readonly number[],
): ProjectedInvoiceShare[] {
    const payments = new Map<number, number>();
    const paidDates = new Map<number, Date | null>();
    for (const share of previousShares) {
        const previousPayment = invoiceCents(share.paymentCreditAmount ?? 0)
            + (share.isPaid ? invoiceCents(share.shareAmount) : 0);
        payments.set(share.registrationId, (payments.get(share.registrationId) ?? 0) + previousPayment);
        if (share.paidAt) paidDates.set(share.registrationId, share.paidAt);
    }
    const remainingPayments = new Map(payments);
    const validIds = existingRegistrationIds ? new Set(existingRegistrationIds) : null;
    const seenIds = new Set<number>();
    const projected: ProjectedInvoiceShare[] = [];
    const project = (payload: InvoiceSharePayload): ProjectedInvoiceShare => {
        const paymentCents = payments.get(payload.registrationId) ?? 0;
        const remainderCents = invoiceCents(payload.baseShareAmount) + invoiceCents(payload.extraAmount)
            - invoiceCents(payload.invoiceCreditAmount) - paymentCents;
        return {
            ...payload,
            paymentCreditAmount: paymentCents / 100,
            shareAmount: remainderCents / 100,
            isPaid: remainderCents === 0,
            paidAt: remainderCents === 0 ? paidDates.get(payload.registrationId) ?? null : null,
        };
    };
    for (const payload of newGrossPayloads) {
        if (seenIds.has(payload.registrationId)) throw new APIError("Duplicate payer in invoice calculation", {}, 400);
        if (validIds && !validIds.has(payload.registrationId)) throw new APIError("Calculation participant no longer belongs to this event", {}, 409);
        seenIds.add(payload.registrationId);
        remainingPayments.delete(payload.registrationId);
        projected.push(project(payload));
    }
    for (const [registrationId, paymentCents] of remainingPayments) {
        if (paymentCents === 0 || (validIds && !validIds.has(registrationId))) continue;
        projected.push(project({
            registrationId,
            baseShareAmount: 0,
            extraAmount: 0,
            invoiceCreditAmount: 0,
            shareAmount: 0,
            note: "No current allocated costs. Previous payments remain with this participant.",
        }));
    }
    return projected;
}

async function lockPool(manager: EntityManager, poolId: string): Promise<EventInvoicePool> {
    const pool = await manager.getRepository(EventInvoicePool).findOne({
        where: {id: poolId}, lock: {mode: "pessimistic_write"},
    });
    if (!pool) throw new APIError("Pool not found", {}, 404);
    return pool;
}

async function invalidatePool(manager: EntityManager, pool: EventInvoicePool): Promise<void> {
    pool.calculationRevision++;
    pool.needsRecalculation = pool.status === "CLOSED";
    await manager.getRepository(EventInvoicePool).save(pool);
}

async function assertPoolParticipant(manager: EntityManager, pool: EventInvoicePool, registrationId: number): Promise<void> {
    const registration = await manager.getRepository(EventRegistration).findOneBy({id: registrationId, event: {id: pool.eventId}});
    const assignment = pool.assignAll || await manager.getRepository(EventPoolAssignment).findOneBy({pool: {id: pool.id}, registration: {id: registrationId}});
    if (!registration || !assignment) throw new APIError("Participant not assigned to this pool", {}, 400);
}

function externalCalculationFingerprint(registrations: EventRegistration[], invoices: EventInvoice[]): string {
    const inputs = {
        registrations: [...registrations].sort((left, right) => left.id - right.id)
            .map((registration) => [registration.id, registration.arrivalDate, registration.departureDate]),
        invoices: invoices.filter((invoice) => invoice.status === "APPROVED" || invoice.status === "CLOSED")
            .sort((left, right) => left.id - right.id)
            .map((invoice) => [invoice.id, invoice.registrationId, invoiceCents(resolveInvoiceAmount(invoice.amount, invoice.correctedAmount))]),
    };
    return createHash("sha256").update(JSON.stringify(inputs)).digest("hex");
}

async function captureCalculationSnapshot(manager: EntityManager, pool: EventInvoicePool): Promise<InvoicePoolCalculationSnapshot> {
    const [assignments, surcharges, takeovers, registrations, invoices] = await Promise.all([
        manager.getRepository(EventPoolAssignment).find({where: {pool: {id: pool.id}}, order: {id: "ASC"}}),
        manager.getRepository(EventInvoiceSurcharge).find({where: {pool: {id: pool.id}}, order: {id: "ASC"}}),
        manager.getRepository(EventPoolTakeover).find({where: {pool: {id: pool.id}}, order: {id: "ASC"}}),
        manager.getRepository(EventRegistration).findBy({event: {id: pool.eventId}}),
        manager.getRepository(EventInvoice).findBy({pool: {id: pool.id}}),
    ]);
    return {
        version: 1,
        settings: {
            distributionMethod: pool.distributionMethod,
            description: pool.description ?? null,
            isDefault: Boolean(pool.isDefault),
            assignAll: Boolean(pool.assignAll),
            subtractPersonalInvoices: Boolean(pool.subtractPersonalInvoices),
            sendCalculationEmails: Boolean(pool.sendCalculationEmails),
            roundUpShares: pool.roundUpShares === undefined ? true : Boolean(pool.roundUpShares),
        },
        assignments: assignments.map((assignment) => ({
            registrationId: assignment.registrationId, factor: assignment.factor, isExempt: Boolean(assignment.isExempt),
        })),
        surcharges: surcharges.map((surcharge) => ({
            registrationId: surcharge.registrationId,
            amount: toAmount(surcharge.amount),
            note: surcharge.note,
            subtractFromPool: Boolean(surcharge.subtractFromPool),
        })),
        takeovers: takeovers.map((takeover) => ({
            payerRegistrationId: takeover.payerRegistrationId, beneficiaryRegistrationId: takeover.beneficiaryRegistrationId,
        })),
        externalFingerprint: externalCalculationFingerprint(registrations, invoices),
        externalRegistrationIds: registrations.map((registration) => registration.id),
    };
}

async function changePool<T>(poolId: string, change: (manager: EntityManager, pool: EventInvoicePool) => Promise<T>): Promise<T> {
    return AppDataSource.transaction("READ COMMITTED", async (manager) => {
        const pool = await lockPool(manager, poolId);
        const result = await change(manager, pool);
        await invalidatePool(manager, pool);
        await refreshPoolTotals(manager, poolId);
        return result;
    });
}

// Lock pools before their registrations so registration edits and calculations use the same order.
export async function lockEventPools(manager: EntityManager, eventId: string): Promise<EventInvoicePool[]> {
    const pools = await manager.getRepository(EventInvoicePool).find({
        where: {event: {id: eventId}}, order: {id: "ASC"},
    });
    const lockedPools: EventInvoicePool[] = [];
    for (const pool of pools) lockedPools.push(await lockPool(manager, pool.id));
    return lockedPools;
}

// Attendance and registration changes also affect dynamic pool membership and distribution weights.
export async function invalidateEventPools(manager: EntityManager, eventId: string): Promise<void> {
    const pools = await lockEventPools(manager, eventId);
    for (const pool of pools) {
        await invalidatePool(manager, pool);
        await refreshPoolTotals(manager, pool.id);
    }
}

// Best-effort cleanup to avoid orphaned uploads when retained invoice records expire.
async function deleteProofFile(proofPath?: string | null): Promise<void> {
    if (!proofPath) return;
    const invoiceRoot = path.resolve(process.cwd(), settings.value.invoiceDir);
    const normalized = path.resolve(process.cwd(), proofPath);
    const relativePath = path.relative(invoiceRoot, normalized);
    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
        console.warn(`[invoice-retention] Skipped proof outside configured invoice directory: ${proofPath}`);
        return;
    }
    await fs.promises.unlink(normalized).catch(() => undefined);
}

/**
 * Permanently remove invoices after their event's configured retention window.
 * This query is event-wide so cleanup does not depend on somebody opening a pool.
 */
export async function purgeExpiredInvoices(retentionMonths: number, now: Date = new Date()): Promise<number> {
    if (!Number.isInteger(retentionMonths) || retentionMonths < 0) {
        throw new Error('Invoice retention months must be a non-negative integer');
    }

    const cutoffDate = format(subMonths(now, retentionMonths), 'yyyy-MM-dd');
    const repo = AppDataSource.getRepository(EventInvoice);
    const expiredInvoices = await repo.createQueryBuilder('invoice')
        .innerJoinAndSelect('invoice.pool', 'pool')
        .innerJoinAndSelect('pool.event', 'event')
        .where('event.endDate <= :cutoffDate', {cutoffDate})
        .getMany();

    if (!expiredInvoices.length) return 0;

    await Promise.all(expiredInvoices.map((invoice) => deleteProofFile(invoice.proofPath)));
    const poolIds = Array.from(new Set(expiredInvoices.map((invoice) => invoice.pool.id)));
    for (const poolId of poolIds) {
        await AppDataSource.transaction("READ COMMITTED", async (manager) => {
            const pool = await lockPool(manager, poolId);
            await manager.getRepository(EventInvoice).delete(expiredInvoices.filter((invoice) => invoice.pool.id === poolId).map((invoice) => invoice.id));
            // Retention preserves the settlement snapshot, but must invalidate in-flight calculations.
            pool.calculationRevision++;
            await manager.getRepository(EventInvoicePool).save(pool);
            await refreshPoolTotals(manager, poolId);
        });
    }
    return expiredInvoices.length;
}

export async function listPools(eventId: string) {
    return AppDataSource.transaction("REPEATABLE READ", (manager) => manager.getRepository(EventInvoicePool).find({
        where: {event: {id: eventId}},
        relationLoadStrategy: "query",
        relations: {
            assignments: {registration: true},
            invoices: {registration: true},
            shares: {registration: true},
            takeovers: {payerRegistration: true, beneficiaryRegistration: true},
            surcharges: {registration: true},
        },
        order: {track: {createdAt: "ASC"}},
    }));
}

export async function createPool(
    eventId: string,
    name: string,
    description: string | undefined,
    distribution: InvoicePoolDistribution,
    isDefault: boolean,
    assignAll: boolean,
    subtractPersonalInvoices: boolean,
    registrationIds: number[] = [],
    sendCalculationEmails = true,
    roundUpShares = true,
) {
    return AppDataSource.transaction("READ COMMITTED", async (manager) => {
        const poolRepo = manager.getRepository(EventInvoicePool);
        const assignmentRepo = manager.getRepository(EventPoolAssignment);
        const pool = poolRepo.create({
            event: {id: eventId} as Event,
            name,
            description: description || null,
            distributionMethod: distribution,
            isDefault,
            assignAll,
            subtractPersonalInvoices,
            sendCalculationEmails,
            roundUpShares,
            status: "OPEN" as InvoicePoolStatus,
            totalAmount: 0,
            openAmount: 0,
            outstandingAmount: 0,
            creditAmount: 0,
            additionalAmount: 0,
            surchargeOffsetAmount: 0,
            payableAmount: 0,
        });
        const saved = await poolRepo.save(pool);
        if (!assignAll && registrationIds.length) {
            const rows = registrationIds.map((id) => assignmentRepo.create({
                pool: saved,
                registration: {id} as EventRegistration,
            }));
            await assignmentRepo.save(rows);
        }
        return saved.id;
    });
}

export async function updatePoolSettings(poolId: string, distribution: InvoicePoolDistribution, description?: string, sendCalculationEmails?: boolean, roundUpShares?: boolean) {
    await AppDataSource.transaction("READ COMMITTED", async (manager) => {
        const pool = await lockPool(manager, poolId);
        const inputsChanged = pool.distributionMethod !== distribution
            || (description !== undefined && (pool.description ?? "") !== description)
            || (roundUpShares !== undefined && Boolean(pool.roundUpShares) !== roundUpShares);
        pool.distributionMethod = distribution;
        if (description !== undefined) pool.description = description;
        if (sendCalculationEmails !== undefined) pool.sendCalculationEmails = sendCalculationEmails;
        if (roundUpShares !== undefined) pool.roundUpShares = roundUpShares;
        pool.calculationRevision++;
        if (inputsChanged && pool.status === "CLOSED") pool.needsRecalculation = true;
        await manager.getRepository(EventInvoicePool).save(pool);
    });
}

export async function getTakeovers(poolId: string) {
    return AppDataSource.getRepository(EventPoolTakeover).find({
        where: {pool: {id: poolId}},
        relations: {payerRegistration: true, beneficiaryRegistration: true},
        order: {id: "ASC"},
    });
}

// Allow a payer to declare which participants they will cover. Admins may reassign; participants cannot override others.
export async function updateTakeovers(
    poolId: string,
    payerRegistrationId: number,
    beneficiaryIds: number[],
    allowReassign: boolean,
) {
    return AppDataSource.transaction("READ COMMITTED", async (manager) => {
        const takeoverRepo = manager.getRepository(EventPoolTakeover);

        const pool = await lockPool(manager, poolId);
        if (!allowReassign && pool.status === "CLOSED") {
            throw new APIError("Pool is closed. Contact an organizer to change payment coverage.", {}, 409);
        }

        // Fetch current takeovers so we can diff them; the controller owns validation of who may edit.
        const existing = await takeoverRepo.find({where: {pool: {id: poolId}}});

        // Keep track of current mappings after applying removals so conflict checks stay accurate.
        const normalizedBeneficiaries = Array.from(new Set(beneficiaryIds.map(Number)));
        await assertPoolParticipant(manager, pool, payerRegistrationId);
        for (const beneficiaryId of normalizedBeneficiaries) {
            if (beneficiaryId === payerRegistrationId) throw new APIError("Participants cannot cover themselves", {}, 400);
            await assertPoolParticipant(manager, pool, beneficiaryId);
        }
        if (normalizedBeneficiaries.length && existing.some((takeover) => takeover.beneficiaryRegistrationId === payerRegistrationId)) {
            throw new APIError("Participants whose share is taken over cannot cover others", {}, 400);
        }
        if (existing.some((takeover) => normalizedBeneficiaries.includes(takeover.payerRegistrationId))) {
            throw new APIError("Clear a participant's existing takeovers before covering their share", {}, 400);
        }
        if (!allowReassign && existing.some((takeover) => normalizedBeneficiaries.includes(takeover.beneficiaryRegistrationId)
            && takeover.payerRegistrationId !== payerRegistrationId)) {
            throw new APIError("One or more participants are already covered by someone else", {}, 409);
        }
        const removed: { payerId: number; beneficiaryId: number }[] = [];
        const added: { payerId: number; beneficiaryId: number }[] = [];
        const toDelete = new Set<number>();

        for (const takeover of existing) {
            const isPayer = takeover.payerRegistrationId === payerRegistrationId;
            const beneficiaryDesired = normalizedBeneficiaries.includes(takeover.beneficiaryRegistrationId);
            const conflictingClaim = allowReassign && beneficiaryDesired && takeover.payerRegistrationId !== payerRegistrationId;
            if ((isPayer && !beneficiaryDesired) || conflictingClaim) {
                removed.push({
                    payerId: takeover.payerRegistrationId,
                    beneficiaryId: takeover.beneficiaryRegistrationId
                });
                toDelete.add(takeover.id);
            }
        }

        // Drop removed/conflicting rows once before inserting replacements to avoid duplicates.
        if (toDelete.size) {
            await takeoverRepo.delete(Array.from(toDelete));
        }

        const remaining = existing.filter((t) => !toDelete.has(t.id));
        toDelete.clear();

        // Ensure uniqueness per beneficiary by removing conflicting rows before inserting the new mapping when allowed.
        // First pass: identify conflicting rows and prepare new takeovers
        const takeoversToBeSaved: Array<{ payerId: number; beneficiaryId: number }> = [];
        for (const beneficiaryId of normalizedBeneficiaries) {
            const conflicting = remaining.find(
                (t) => t.beneficiaryRegistrationId === beneficiaryId && t.payerRegistrationId !== payerRegistrationId,
            );
            if (conflicting && allowReassign) {
                removed.push({
                    payerId: conflicting.payerRegistrationId,
                    beneficiaryId: conflicting.beneficiaryRegistrationId
                });
                toDelete.add(conflicting.id);
            }

            const alreadyCoveredByPayer = remaining.some(
                (t) => t.payerRegistrationId === payerRegistrationId && t.beneficiaryRegistrationId === beneficiaryId,
            );
            if (!alreadyCoveredByPayer) {
                added.push({payerId: payerRegistrationId, beneficiaryId});
                takeoversToBeSaved.push({payerId: payerRegistrationId, beneficiaryId});
            }
        }

        // Delete conflicting rows first to prevent unique constraint violations
        if (toDelete.size) {
            await takeoverRepo.delete(Array.from(toDelete));
        }

        // Then insert new takeovers in a batch for better performance
        if (takeoversToBeSaved.length > 0) {
            const newTakeovers = takeoversToBeSaved.map(takeover =>
                takeoverRepo.create({
                    pool: {id: poolId} as EventInvoicePool,
                    payerRegistration: {id: takeover.payerId} as EventRegistration,
                    beneficiaryRegistration: {id: takeover.beneficiaryId} as EventRegistration,
                })
            );
            await takeoverRepo.save(newTakeovers);
        }

        if (added.length || removed.length) await invalidatePool(manager, pool);
        return {added, removed};
    });
}

export async function submitInvoice(
    poolId: string,
    registrationId: number,
    amount: number,
    description: string | null,
    proof: { path: string; originalName: string; mimeType: string } | null,
) {
    return changePool(poolId, async (manager, pool) => {
        if (pool.status !== "OPEN") throw new APIError("Pool is closed for invoice submissions", {}, 409);
        await assertPoolParticipant(manager, pool, registrationId);
        const invoiceRepo = manager.getRepository(EventInvoice);
        const invoice = invoiceRepo.create({
            pool: {id: poolId} as EventInvoicePool,
            registration: {id: registrationId} as EventRegistration,
            amount: formatAmount(amount),
            description: description || null,
            status: "NEW" as InvoiceStatus,
            correctedAmount: null,
            correctedDescription: null,
            rejectionReason: null,
            proofPath: proof?.path || null,
            proofOriginalName: proof?.originalName || null,
            proofMimeType: proof?.mimeType || null,
        });
        await invoiceRepo.save(invoice);
        return invoice.id;
    });
}

export async function approveInvoice(poolId: string, invoiceId: number, corrections: InvoiceCorrections = {}) {
    return changePool(poolId, async (manager) => {
        const repo = manager.getRepository(EventInvoice);
        const invoice = await repo.findOne({where: {id: invoiceId, pool: {id: poolId}}});
        if (!invoice) throw new Error("Invoice not found");
        if (invoice.status !== "NEW") return false;
        invoice.status = "APPROVED";
        invoice.correctedAmount = corrections.correctedAmount === null || corrections.correctedAmount === undefined
            ? null
            : formatAmount(corrections.correctedAmount);
        invoice.correctedDescription = corrections.correctedDescription || null;
        invoice.rejectionReason = null;
        await repo.save(invoice);
        return true;
    });
}

export async function closeInvoice(poolId: string, invoiceId: number) {
    // Invoice reimbursement does not change the approved amount or participant credit.
    return AppDataSource.transaction("READ COMMITTED", async (manager) => {
        await lockPool(manager, poolId);
        const repo = manager.getRepository(EventInvoice);
        const invoice = await repo.findOne({where: {id: invoiceId, pool: {id: poolId}}});
        if (!invoice) throw new Error("Invoice not found");
        if (invoice.status === "CLOSED") return false;
        if (invoice.status !== "APPROVED") throw new APIError("Only approved invoices can be marked paid", {}, 400);
        invoice.status = "CLOSED";
        await repo.save(invoice);
        await refreshPoolTotals(manager, poolId);
        return true;
    });
}

export async function declineInvoice(poolId: string, invoiceId: number, rejectionReason: string) {
    return changePool(poolId, async (manager) => {
        const repo = manager.getRepository(EventInvoice);
        const invoice = await repo.findOne({where: {id: invoiceId, pool: {id: poolId}}});
        if (!invoice) throw new Error("Invoice not found");
        if (invoice.status !== "NEW") return false;
        invoice.status = "REJECTED";
        invoice.rejectionReason = rejectionReason;
        invoice.correctedAmount = null;
        invoice.correctedDescription = null;
        await repo.save(invoice);
        return true;
    });
}

// Controller provides selected invoices and calculated shares; service keeps the transaction atomic
export async function closePool(
    poolId: string,
    approvedInvoiceIds: number[],
    sharePayloads: InvoiceSharePayload[],
    recalculate = false,
    expectedRevision?: number,
): Promise<EventInvoiceShare[]> {
    return AppDataSource.transaction("READ COMMITTED", async (manager) => {
        const poolRepo = manager.getRepository(EventInvoicePool);
        const shareRepo = manager.getRepository(EventInvoiceShare);

        const pool = await lockPool(manager, poolId);
        if (expectedRevision !== undefined && pool.calculationRevision !== expectedRevision) {
            throw new APIError("Pool inputs changed during calculation. Reload and calculate again.", {}, 409);
        }
        if (recalculate && pool.status !== "CLOSED") throw new APIError("Only closed pools can be recalculated", {}, 409);
        if (!recalculate && pool.status === "CLOSED") throw new APIError("Pool is already closed", {}, 409);

        const [previousShares, registrations] = await Promise.all([
            shareRepo.find({where: {pool: {id: poolId}}}),
            manager.getRepository(EventRegistration).findBy({event: {id: pool.eventId}}),
        ]);
        const projectedShares = projectInvoiceShares(previousShares, sharePayloads, registrations.map((registration) => registration.id));
        await shareRepo.delete({pool: {id: poolId}});
        if (projectedShares.length) {
            const rows = projectedShares.map((payload) => shareRepo.create({
                pool: {id: poolId} as EventInvoicePool,
                registration: {id: payload.registrationId} as EventRegistration,
                baseShareAmount: payload.baseShareAmount,
                extraAmount: payload.extraAmount,
                invoiceCreditAmount: payload.invoiceCreditAmount,
                paymentCreditAmount: payload.paymentCreditAmount,
                shareAmount: payload.shareAmount,
                note: payload.note || null,
                isPaid: payload.isPaid,
                paidAt: payload.paidAt,
            }));
            await shareRepo.save(rows);
        }

        pool.status = "CLOSED";
        pool.closedAt = new Date();
        pool.needsRecalculation = false;
        pool.calculationRevision++;
        pool.calculationSnapshot = await captureCalculationSnapshot(manager, pool);
        await poolRepo.save(pool);
        await refreshPoolTotals(manager, poolId);
        return shareRepo.find({where: {pool: {id: poolId}}, order: {id: "ASC"}});
    });
}

export async function rollbackPoolChanges(poolId: string, expectedRevision?: number): Promise<{needsRecalculation: boolean; externalChanges: boolean}> {
    return AppDataSource.transaction("READ COMMITTED", async (manager) => {
        const pool = await lockPool(manager, poolId);
        if (pool.status !== "CLOSED") throw new APIError("Only calculated pools have saved inputs to restore", {}, 409);
        if (expectedRevision !== undefined && pool.calculationRevision !== expectedRevision) {
            throw new APIError("Pool changed before rollback. Reload and try again.", {}, 409);
        }
        const snapshot = pool.calculationSnapshot;
        if (!snapshot || snapshot.version !== 1) {
            throw new APIError("No previous input snapshot is available. Calculate the pool first.", {}, 409);
        }
        const [registrations, invoices] = await Promise.all([
            manager.getRepository(EventRegistration).findBy({event: {id: pool.eventId}}),
            manager.getRepository(EventInvoice).findBy({pool: {id: poolId}}),
        ]);
        const validIds = new Set(registrations.map((registration) => registration.id));
        const externalChanges = externalCalculationFingerprint(registrations, invoices) !== snapshot.externalFingerprint;
        const assignmentRepo = manager.getRepository(EventPoolAssignment);
        const surchargeRepo = manager.getRepository(EventInvoiceSurcharge);
        const takeoverRepo = manager.getRepository(EventPoolTakeover);

        await assignmentRepo.delete({pool: {id: poolId}});
        const assignments = snapshot.assignments.filter((assignment) => validIds.has(assignment.registrationId));
        // New event participants remain automatically assigned to pools that were already defaults.
        if (snapshot.settings.isDefault) {
            const previousIds = new Set(snapshot.externalRegistrationIds);
            for (const registration of registrations) {
                if (!previousIds.has(registration.id)) assignments.push({registrationId: registration.id, factor: 1, isExempt: false});
            }
        }
        if (assignments.length) {
            await assignmentRepo.save(assignments.map((assignment) => assignmentRepo.create({
                pool: {id: poolId} as EventInvoicePool,
                registration: {id: assignment.registrationId} as EventRegistration,
                factor: assignment.factor,
                isExempt: assignment.isExempt,
            })));
        }
        const assignedIds = snapshot.settings.assignAll ? validIds : new Set(assignments.map((assignment) => assignment.registrationId));

        await surchargeRepo.delete({pool: {id: poolId}});
        const surcharges = snapshot.surcharges.filter((surcharge) => assignedIds.has(surcharge.registrationId));
        if (surcharges.length) {
            await surchargeRepo.save(surcharges.map((surcharge) => surchargeRepo.create({
                pool: {id: poolId} as EventInvoicePool,
                registration: {id: surcharge.registrationId} as EventRegistration,
                amount: formatAmount(surcharge.amount),
                note: surcharge.note,
                subtractFromPool: surcharge.subtractFromPool,
            })));
        }
        await takeoverRepo.delete({pool: {id: poolId}});
        const takeovers = snapshot.takeovers.filter((takeover) => assignedIds.has(takeover.payerRegistrationId)
            && assignedIds.has(takeover.beneficiaryRegistrationId));
        if (takeovers.length) {
            await takeoverRepo.save(takeovers.map((takeover) => takeoverRepo.create({
                pool: {id: poolId} as EventInvoicePool,
                payerRegistration: {id: takeover.payerRegistrationId} as EventRegistration,
                beneficiaryRegistration: {id: takeover.beneficiaryRegistrationId} as EventRegistration,
            })));
        }
        Object.assign(pool, snapshot.settings);
        pool.roundUpShares = snapshot.settings.roundUpShares ?? true;
        const needsRecalculation = externalChanges || snapshot.settings.roundUpShares === undefined;
        pool.needsRecalculation = needsRecalculation;
        pool.calculationRevision++;
        await manager.getRepository(EventInvoicePool).save(pool);
        await refreshPoolTotals(manager, poolId);
        return {needsRecalculation, externalChanges};
    });
}

export async function updateAssignments(
    poolId: string,
    isDefault: boolean,
    assignAll: boolean,
    subtractPersonalInvoices: boolean,
    allowedRegistrationIds: number[],
    exemptRegistrationIds: number[],
    participantFactors: Record<number, number> = {},
) {
    await AppDataSource.transaction("READ COMMITTED", async (manager) => {
        const assignmentRepo = manager.getRepository(EventPoolAssignment);
        const takeoverRepo = manager.getRepository(EventPoolTakeover);
        const surchargeRepo = manager.getRepository(EventInvoiceSurcharge);

        const pool = await lockPool(manager, poolId);

        pool.isDefault = isDefault;
        pool.assignAll = assignAll;
        pool.subtractPersonalInvoices = subtractPersonalInvoices;
        const eventIds = (await manager.getRepository(EventRegistration).find({where: {event: {id: pool.eventId}}})).map((r) => r.id);
        const validIds = Array.from(new Set(assignAll ? eventIds : allowedRegistrationIds));
        if (validIds.some((id) => !eventIds.includes(id))) throw new APIError("Participant does not belong to this event", {}, 400);
        for (const [id, factor] of Object.entries(participantFactors)) {
            if (!validIds.includes(Number(id))) throw new APIError("Factor participant is not assigned to this pool", {}, 400);
            validateInvoiceFactor(factor);
        }
        const existingAssignments = await assignmentRepo.find({where: {pool: {id: poolId}}});
        const existingFactors = new Map(existingAssignments.map((assignment) => [assignment.registrationId, assignment.factor]));
        await assignmentRepo.delete({pool: {id: poolId}});
        const effectiveIds = validIds;
        if (effectiveIds.length) {
            const rows = effectiveIds.map((id) => assignmentRepo.create({
                pool: {id: poolId} as EventInvoicePool,
                registration: {id} as EventRegistration,
                isExempt: exemptRegistrationIds.includes(id),
                factor: participantFactors[id] ?? existingFactors.get(id) ?? 1,
            }));
            await assignmentRepo.save(rows);
        }

        // Keep takeover mappings consistent with the new assignment scope.
        const invalidTakeovers = await takeoverRepo.find({where: {pool: {id: poolId}}});
        const toDrop = invalidTakeovers.filter(
            (t) => !validIds.includes(t.payerRegistrationId) || !validIds.includes(t.beneficiaryRegistrationId),
        );
        if (toDrop.length) {
            await takeoverRepo.delete(toDrop.map((t) => t.id));
        }

        // Drop surcharges for participants that are no longer assigned so the UI stays consistent.
        const invalidSurcharges = await surchargeRepo.find({where: {pool: {id: poolId}}});
        const surchargeDropIds = invalidSurcharges
            .filter((s) => !validIds.includes(s.registrationId))
            .map((s) => s.id);
        if (surchargeDropIds.length) {
            await surchargeRepo.delete(surchargeDropIds);
        }
        await invalidatePool(manager, pool);
        await refreshPoolTotals(manager, poolId);
    });
}

// Signed adjustments remain editable after closure and invalidate the saved calculation.
export async function addSurcharge(
    poolId: string,
    registrationId: number,
    amount: number,
    note: string,
    subtractFromPool: boolean,
) {
    if (!Number.isFinite(amount) || amount === 0 || Math.abs(amount) > 99999999.99) {
        throw new APIError("Enter a non-zero surcharge or rebate within the supported amount range", {}, 400);
    }
    return changePool(poolId, async (manager, pool) => {
        await assertPoolParticipant(manager, pool, registrationId);
        const repo = manager.getRepository(EventInvoiceSurcharge);
        const row = repo.create({
            pool: {id: poolId} as EventInvoicePool,
            registration: {id: registrationId} as EventRegistration,
            amount: formatAmount(amount),
            note,
            subtractFromPool,
        });
        await repo.save(row);
        return row;
    });
}

// Remove a surcharge that was added earlier so the pool can be recalculated cleanly.
export async function removeSurcharge(poolId: string, surchargeId: number) {
    return changePool(poolId, async (manager) => {
        const repo = manager.getRepository(EventInvoiceSurcharge);
        const existing = await repo.findOne({where: {id: surchargeId, pool: {id: poolId}}});
        if (!existing) return;
        await repo.remove(existing);
    });
}

export async function setSharePaid(poolId: string, shareId: number, isPaid: boolean) {
    await AppDataSource.transaction("READ COMMITTED", async (manager) => {
        const pool = await lockPool(manager, poolId);
        if (pool.status !== "CLOSED") {
            throw new APIError("Calculate the pool before recording share payments", {}, 409);
        }
        const repo = manager.getRepository(EventInvoiceShare);
        const share = await repo.findOne({where: {id: shareId, pool: {id: poolId}}});
        if (!share) throw new Error("Share not found");
        share.isPaid = isPaid;
        share.paidAt = isPaid ? new Date() : null;
        await repo.save(share);
        pool.calculationRevision++;
        await manager.getRepository(EventInvoicePool).save(pool);
        await refreshPoolTotals(manager, poolId);
    });
}

export async function recalcPoolTotals(poolId: string) {
    await AppDataSource.transaction("READ COMMITTED", async (manager) => {
        await lockPool(manager, poolId);
        await refreshPoolTotals(manager, poolId);
    });
}

async function refreshPoolTotals(manager: EntityManager, poolId: string) {
    const poolRepo = manager.getRepository(EventInvoicePool);
    const invoiceRepo = manager.getRepository(EventInvoice);
    const shareRepo = manager.getRepository(EventInvoiceShare);
    const surchargeRepo = manager.getRepository(EventInvoiceSurcharge);

    const [invoices, shares, pool, surcharges] = await Promise.all([
        invoiceRepo.find({where: {pool: {id: poolId}}}),
        shareRepo.find({where: {pool: {id: poolId}}}),
        poolRepo.findOne({where: {id: poolId}}),
        surchargeRepo.find({where: {pool: {id: poolId}}}),
    ]);
    if (!pool) return;

    const invoiceTotal = invoices.filter(inv => inv.status === "APPROVED" || inv.status === "CLOSED")
        .reduce((sum, inv) => sum + resolveInvoiceAmount(inv.amount, inv.correctedAmount), 0);
    const openAmount = invoices
        .filter((inv) => inv.status === "APPROVED")
        .reduce((sum, inv) => sum + resolveInvoiceAmount(inv.amount, inv.correctedAmount), 0);
    const extraAmount = surcharges
        .filter(s => !s.subtractFromPool)
        .reduce((sum, s) => sum + toAmount(s.amount), 0);
    const subtractiveAmount = surcharges
        .filter((s) => s.subtractFromPool)
        .reduce((sum, s) => sum + toAmount(s.amount), 0);
    const outstandingAmount = shares
        .filter((s) => !s.isPaid)
        .reduce((sum, s) => sum + Math.max(toAmount(s.shareAmount), 0), 0);
    const creditAmount = shares
        .filter((s) => !s.isPaid)
        .reduce((sum, s) => sum + Math.abs(Math.min(toAmount(s.shareAmount), 0)), 0);

    pool.invoiceAmount = toAmount(invoiceTotal);
    pool.additionalAmount = toAmount(extraAmount);
    pool.surchargeOffsetAmount = toAmount(subtractiveAmount);
    const payable = invoiceTotal - subtractiveAmount;
    pool.payableAmount = toAmount(payable);
    pool.openAmount = toAmount(openAmount);
    pool.outstandingAmount = toAmount(outstandingAmount);
    pool.creditAmount = toAmount(creditAmount);
    pool.totalAmount = pool.invoiceAmount + pool.additionalAmount
    await poolRepo.save(pool);
}

export async function getParticipantPools(eventId: string, registrationId: number) {
    const pools = await listPools(eventId);
    return pools.filter((p) => p.status === "OPEN" && (p.assignAll || p.assignments.some((a) => a.registrationId === registrationId)));
}

export async function getPoolWithInvoices(poolId: string) {
    return loadPool(poolId);
}

export async function getApprovedInvoices(poolId: string) {
    return AppDataSource.getRepository(EventInvoice).find({where: {pool: {id: poolId}, status: "APPROVED"}});
}

export async function getInvoiceWithRegistration(poolId: string, invoiceId: number) {
    return AppDataSource.getRepository(EventInvoice).findOne({
        where: {id: invoiceId, pool: {id: poolId}},
        relations: {registration: {profile: {user: true, guest: true}}},
    });
}

export async function getShareWithRegistration(poolId: string, shareId: number) {
    return AppDataSource.getRepository(EventInvoiceShare).findOne({
        where: {id: shareId, pool: {id: poolId}},
        relations: {registration: {profile: {user: true, guest: true}}},
    });
}

/**
 * Create an EventPoolAssignment for each EventInvoicePool with isDefault = true
 * for the given eventId.
 */
export async function registerForDefaultPools(
    manager: EntityManager,
    reg: EventRegistration
): Promise<EventPoolAssignment[]> {
    const poolRepo = manager.getRepository(EventInvoicePool);
    const assignmentRepo = manager.getRepository(EventPoolAssignment);

    // Get eventId - load event relation only if needed
    let eventId: string;
    if (reg.event) {
        eventId = reg.event.id;
    } else {
        // Query just for the event relation
        const regWithEvent = await manager
            .createQueryBuilder(EventRegistration, 'reg')
            .select('reg.id')
            .leftJoinAndSelect('reg.event', 'event')
            .where('reg.id = :id', {id: reg.id})
            .getOne();

        if (!regWithEvent?.event) {
            return [];
        }
        eventId = regWithEvent.event.id;
    }

    // 1. Load all default pools
    const defaultPools = await poolRepo.find({
        where: {isDefault: true, event: {id: eventId}},
    });

    if (defaultPools.length === 0) {
        return [];
    }

    const existing = await assignmentRepo.find({where: {registration: {id: reg.id}}});
    const existingPoolIds = new Set(existing.map((assignment) => assignment.poolId));

    // 2. Create assignments in memory
    const assignments = defaultPools
        .filter(pool => !existingPoolIds.has(pool.id))
        .map(pool =>
            assignmentRepo.create({
                registration: reg,
                pool,
            }),
        );

    // 3. Save in one batch
    return assignmentRepo.save(assignments);
}
