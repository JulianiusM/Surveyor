import fs from "fs";
import path from "path";
import {AppDataSource} from "../dataSource";
import {EventInvoicePool} from "../entities/event/EventInvoicePool";
import {EventInvoice, InvoiceStatus} from "../entities/event/EventInvoice";
import {EventPoolAssignment} from "../entities/event/EventPoolAssignment";
import {EventInvoiceShare} from "../entities/event/EventInvoiceShare";
import {EventRegistration} from "../entities/event/EventRegistration";
import {Event} from "../entities/event/Event";
import {EventPoolTakeover} from "../entities/event/EventPoolTakeover";
import {EventInvoiceSurcharge} from "../entities/event/EventInvoiceSurcharge";
import {formatAmount, toAmount} from "../../lib/util";
import type {InvoicePoolDistribution, InvoicePoolStatus} from "../../../types/InvoicePoolTypes";
import {EntityManager} from "typeorm";

// Centralized pool loader to keep relation loading consistent across controllers
async function loadPool(poolId: string) {
    const pool = await AppDataSource.getRepository(EventInvoicePool).findOne({
        where: {id: poolId},
        relations: {
            event: true,
            assignments: {registration: true},
            invoices: {registration: true},
            shares: {registration: true},
            takeovers: {payerRegistration: true, beneficiaryRegistration: true},
            surcharges: {registration: true},
        },
    });
    return pool;
}

// Best-effort cleanup to avoid orphaned uploads when invoices are declined or pools removed
function deleteProofFile(proofPath?: string | null) {
    if (!proofPath) return;
    const normalized = path.isAbsolute(proofPath) ? proofPath : path.join(process.cwd(), proofPath);
    void fs.promises.unlink(normalized).catch(() => undefined);
}

/**
 * Remove persisted proof metadata and delete associated files. The caller owns the
 * business rule for when this should happen (e.g., expiry windows or declines).
 */
export async function clearInvoiceProofs(invoices: EventInvoice[]) {
    if (!invoices.length) return;
    const repo = AppDataSource.getRepository(EventInvoice);
    invoices.forEach((inv) => {
        deleteProofFile(inv.proofPath);
        inv.proofPath = null;
        inv.proofOriginalName = null;
        inv.proofMimeType = null;
    });
    await repo.save(invoices);
}

export async function listPools(eventId: string) {
    const pools = await AppDataSource.getRepository(EventInvoicePool).find({
        where: {event: {id: eventId}},
        relations: {
            assignments: {registration: true},
            invoices: {registration: true},
            shares: {registration: true},
            takeovers: {payerRegistration: true, beneficiaryRegistration: true},
            surcharges: {registration: true},
        },
        order: {createdAt: "ASC"},
    });
    return pools;
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
        const poolRepo = manager.getRepository(EventInvoicePool);
        const takeoverRepo = manager.getRepository(EventPoolTakeover);

        const pool = await poolRepo.findOne({where: {id: poolId}});
        if (!pool) throw new Error("Pool not found");

        // Fetch current takeovers so we can diff them; the controller owns validation of who may edit.
        const existing = await takeoverRepo.find({where: {pool: {id: poolId}}});

        // Keep track of current mappings after applying removals so conflict checks stay accurate.
        const normalizedBeneficiaries = Array.from(new Set(beneficiaryIds.map(Number)));
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
    const invoiceRepo = AppDataSource.getRepository(EventInvoice);
    const invoice = invoiceRepo.create({
        pool: {id: poolId} as EventInvoicePool,
        registration: {id: registrationId} as EventRegistration,
        amount: formatAmount(amount),
        description: description || null,
        status: "NEW" as InvoiceStatus,
        proofPath: proof?.path || null,
        proofOriginalName: proof?.originalName || null,
        proofMimeType: proof?.mimeType || null,
    });
    await invoiceRepo.save(invoice);
    await recalcPoolTotals(poolId);
    return invoice.id;
}

export async function approveInvoice(poolId: string, invoiceId: number) {
    const repo = AppDataSource.getRepository(EventInvoice);
    const invoice = await repo.findOne({where: {id: invoiceId, pool: {id: poolId}}});
    if (!invoice) throw new Error("Invoice not found");
    if (invoice.status !== "NEW") return;
    invoice.status = "APPROVED";
    await repo.save(invoice);
    await recalcPoolTotals(poolId);
}

export async function closeInvoice(poolId: string, invoiceId: number) {
    const repo = AppDataSource.getRepository(EventInvoice);
    const invoice = await repo.findOne({where: {id: invoiceId, pool: {id: poolId}}});
    if (!invoice) throw new Error("Invoice not found");
    if (invoice.status === "CLOSED") return;
    invoice.status = "CLOSED";
    await repo.save(invoice);
    await recalcPoolTotals(poolId);
}

export async function declineInvoice(poolId: string, invoiceId: number) {
    const repo = AppDataSource.getRepository(EventInvoice);
    const invoice = await repo.findOne({
        where: {id: invoiceId, pool: {id: poolId}},
        relations: {registration: {user: true, guest: true}},
    });
    if (!invoice) throw new Error("Invoice not found");
    const email = invoice.registration.user?.email || invoice.registration.guest?.email;
    deleteProofFile(invoice.proofPath);
    await repo.remove(invoice);
    await recalcPoolTotals(poolId);
    return email;
}

// Controller provides selected invoices and calculated shares; service keeps the transaction atomic
export async function closePool(
    poolId: string,
    approvedInvoiceIds: number[],
    sharePayloads: {
        registrationId: number;
        baseShareAmount: number;
        extraAmount: number;
        invoiceCreditAmount: number;
        shareAmount: number;
        note?: string | null;
    }[],
) {
    await AppDataSource.transaction("READ COMMITTED", async (manager) => {
        const poolRepo = manager.getRepository(EventInvoicePool);
        const shareRepo = manager.getRepository(EventInvoiceShare);
        const invoiceRepo = manager.getRepository(EventInvoice);

        const pool = await poolRepo.findOne({where: {id: poolId}});
        if (!pool) throw new Error("Pool not found");
        if (pool.status === "CLOSED") return;

        await shareRepo.delete({pool: {id: poolId}});
        if (sharePayloads.length) {
            const rows = sharePayloads.map((payload) => shareRepo.create({
                pool: {id: poolId} as EventInvoicePool,
                registration: {id: payload.registrationId} as EventRegistration,
                baseShareAmount: payload.baseShareAmount,
                extraAmount: payload.extraAmount,
                invoiceCreditAmount: payload.invoiceCreditAmount,
                shareAmount: payload.shareAmount,
                note: payload.note || null,
                isPaid: false,
            }));
            await shareRepo.save(rows);
        }

        pool.status = "CLOSED";
        pool.closedAt = new Date();
        await poolRepo.save(pool);
    });
    await recalcPoolTotals(poolId);
}

// Reopen a closed pool to allow recalculation of shares
// Uses transaction to prevent race conditions during concurrent recalculation attempts
export async function reopenPool(poolId: string) {
    await AppDataSource.transaction("SERIALIZABLE", async (manager) => {
        const poolRepo = manager.getRepository(EventInvoicePool);
        const pool = await poolRepo.findOne({where: {id: poolId}, lock: {mode: "pessimistic_write"}});
        if (!pool) throw new Error("Pool not found");
        if (pool.status !== "CLOSED") throw new Error("Pool is not closed");

        pool.status = "OPEN";
        pool.closedAt = null; // Clear closed timestamp for consistency
        await poolRepo.save(pool);
    });
}

export async function updateAssignments(
    poolId: string,
    isDefault: boolean,
    assignAll: boolean,
    subtractPersonalInvoices: boolean,
    allowedRegistrationIds: number[],
    exemptRegistrationIds: number[],
) {
    await AppDataSource.transaction("READ COMMITTED", async (manager) => {
        const poolRepo = manager.getRepository(EventInvoicePool);
        const assignmentRepo = manager.getRepository(EventPoolAssignment);
        const takeoverRepo = manager.getRepository(EventPoolTakeover);
        const surchargeRepo = manager.getRepository(EventInvoiceSurcharge);

        const pool = await poolRepo.findOne({where: {id: poolId}});
        if (!pool) throw new Error("Pool not found");

        pool.isDefault = isDefault;
        pool.assignAll = assignAll;
        pool.subtractPersonalInvoices = subtractPersonalInvoices;
        const validIds = allowedRegistrationIds.length
            ? allowedRegistrationIds
            : (await manager.getRepository(EventRegistration).find({where: {event: {id: pool.eventId}}})).map((r) => r.id);
        await assignmentRepo.delete({pool: {id: poolId}});
        const effectiveIds = pool.assignAll && !allowedRegistrationIds.length ? validIds : allowedRegistrationIds;
        if (effectiveIds.length) {
            const rows = effectiveIds.map((id) => assignmentRepo.create({
                pool: {id: poolId} as EventInvoicePool,
                registration: {id} as EventRegistration,
                isExempt: exemptRegistrationIds.includes(id),
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
        await poolRepo.save(pool);
    });
}

// Add a participant-specific surcharge before closing the pool.
export async function addSurcharge(
    poolId: string,
    registrationId: number,
    amount: number,
    note: string,
    subtractFromPool: boolean,
) {
    const repo = AppDataSource.getRepository(EventInvoiceSurcharge);
    const row = repo.create({
        pool: {id: poolId} as EventInvoicePool,
        registration: {id: registrationId} as EventRegistration,
        amount: formatAmount(amount),
        note,
        subtractFromPool,
    });
    await repo.save(row);
    await recalcPoolTotals(poolId);
    return row;
}

// Remove a surcharge that was added earlier so the pool can be recalculated cleanly.
export async function removeSurcharge(poolId: string, surchargeId: number) {
    const repo = AppDataSource.getRepository(EventInvoiceSurcharge);
    const existing = await repo.findOne({where: {id: surchargeId, pool: {id: poolId}}});
    if (!existing) return;
    await repo.remove(existing);
    await recalcPoolTotals(poolId);
}

export async function setSharePaid(poolId: string, shareId: number, isPaid: boolean) {
    const repo = AppDataSource.getRepository(EventInvoiceShare);
    const share = await repo.findOne({where: {id: shareId, pool: {id: poolId}}});
    if (!share) throw new Error("Share not found");
    share.isPaid = isPaid;
    share.paidAt = isPaid ? new Date() : null;
    await repo.save(share);
    await recalcPoolTotals(poolId);
}

export async function recalcPoolTotals(poolId: string) {
    const poolRepo = AppDataSource.getRepository(EventInvoicePool);
    const invoiceRepo = AppDataSource.getRepository(EventInvoice);
    const shareRepo = AppDataSource.getRepository(EventInvoiceShare);
    const surchargeRepo = AppDataSource.getRepository(EventInvoiceSurcharge);

    const [invoices, shares, pool, surcharges] = await Promise.all([
        invoiceRepo.find({where: {pool: {id: poolId}}}),
        shareRepo.find({where: {pool: {id: poolId}}}),
        poolRepo.findOne({where: {id: poolId}}),
        surchargeRepo.find({where: {pool: {id: poolId}}}),
    ]);
    if (!pool) return;

    const invoiceTotal = invoices.filter(inv => inv.status !== "NEW")
        .reduce((sum, inv) => sum + toAmount(inv.amount), 0);
    const openAmount = invoices
        .filter((inv) => inv.status === "APPROVED")
        .reduce((sum, inv) => sum + toAmount(inv.amount), 0);
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
    const payable = Math.max(invoiceTotal - subtractiveAmount, 0);
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
        relations: {registration: {user: true, guest: true}},
    });
}

export async function getShareWithRegistration(poolId: string, shareId: number) {
    return AppDataSource.getRepository(EventInvoiceShare).findOne({
        where: {id: shareId, pool: {id: poolId}},
        relations: {registration: {user: true, guest: true}},
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

    // Load the registration with event relation if not already loaded
    if (!reg.event) {
        const regRepo = manager.getRepository(EventRegistration);
        const fullReg = await regRepo.findOne({
            where: {id: reg.id},
            relations: {event: true}
        });
        if (!fullReg || !fullReg.event) {
            return [];
        }
        reg = fullReg;
    }

    // 1. Load all default pools
    const defaultPools = await poolRepo.find({
        where: {isDefault: true, event: {id: reg.event.id}},
    });

    if (defaultPools.length === 0) {
        return [];
    }

    // (Optional) If you want to avoid duplicates per event, load existing assignments
    // const existing = await assignmentRepo.find({
    //     where: { event: { id: eventId } },
    //     relations: { pool: true },
    // });
    // const existingPoolIds = new Set(existing.map(a => a.pool.id));

    // 2. Create assignments in memory
    const assignments = defaultPools
        // .filter(pool => !existingPoolIds.has(pool.id)) // uncomment if you want deduplication
        .map(pool =>
            assignmentRepo.create({
                registration: reg,
                pool,
            }),
        );

    // 3. Save in one batch
    return assignmentRepo.save(assignments);
}
