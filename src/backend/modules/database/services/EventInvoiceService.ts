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

import {And, EntityManager, Equal, IsNull, LessThanOrEqual, MoreThan, Not, Raw, type DeepPartial} from 'typeorm';
import type {InvoicePoolDistribution, InvoicePoolSubmissionState, ProjectedInvoiceShare} from '../../../../types/InvoicePoolTypes';
import {formatAmount, invoiceCostTotals, toAmount} from '../../lib/util';
import {AppDataSource} from '../dataSource';
import {Event} from '../entities/event/Event';
import {EventInvoice} from '../entities/event/EventInvoice';
import {EventInvoicePool} from '../entities/event/EventInvoicePool';
import {EventInvoiceShare} from '../entities/event/EventInvoiceShare';
import {EventInvoiceSurcharge} from '../entities/event/EventInvoiceSurcharge';
import {EventPoolAssignment} from '../entities/event/EventPoolAssignment';
import {EventPoolTakeover} from '../entities/event/EventPoolTakeover';
import {EventRegistration} from '../entities/event/EventRegistration';
import {Profile} from '../entities/user/Profile';
import {InvoiceProofFile} from '../entities/event/InvoiceProofFile';
import type {InvoiceProofOperation} from '../../../../types/InvoiceProofTypes';
import {lockEvent} from './EventService';

/** Load the pool and its relation collections from one repeatable-read database snapshot. */
async function loadPool(poolId: string) {
    /** Read relation collections separately without mixing their revisions or multiplying joined rows. */
    async function readSnapshot(manager: EntityManager) {
        // Separate queries keep large invoice/share collections from multiplying one another in a join.
        return manager.getRepository(EventInvoicePool).findOne({
            where: {id: poolId},
            relationLoadStrategy: "query",
            relations: {
                event: true,
                assignments: {registration: true},
                invoices: {registration: true, recordedByProfile: true},
                shares: {registration: true},
                takeovers: {payerRegistration: true, beneficiaryRegistration: true},
                surcharges: {registration: true},
            },
        });
    }
    // All relation queries see the same revision, settings, and saved shares until this read finishes.
    return AppDataSource.transaction("REPEATABLE READ", readSnapshot);
}

/**
 * Own the transaction and root lock without interpreting missing rows or deciding business policy.
 * The named controller-layer operation reads and writes through this module using the same manager.
 */
export async function withLockedPool<T>(
    poolId: string,
    operation: (manager: EntityManager, pool: EventInvoicePool | null) => Promise<T>,
    eventId?: string,
): Promise<T> {
    /** Retain the root lock throughout the caller's checks and writes. */
    async function runLocked(manager: EntityManager): Promise<T> {
        // Management callers retain the Event fence before waiting for the pool.
        // Matching ACL/default writers use that same row until this commit;
        // the feature callback still owns absence, scope and grant decisions.
        if (eventId) await lockEvent(manager, eventId);
        // Missing rows remain raw data: only the owning feature operation decides the context-specific error.
        const pool = await lockPool(manager, poolId);
        return operation(manager, pool);
    }
    // Commit or roll back the complete operation; never release the lock between its checks and persistence.
    return AppDataSource.transaction("READ COMMITTED", runLocked);
}

async function lockPool(manager: EntityManager, poolId: string): Promise<EventInvoicePool | null> {
    return manager.getRepository(EventInvoicePool).findOne({
        where: {id: poolId}, lock: {mode: "pessimistic_write"},
    });
}

export async function savePool(pool: EventInvoicePool, manager: EntityManager): Promise<void> {
    await manager.getRepository(EventInvoicePool).save(pool);
}

export async function saveInvoice(values: DeepPartial<EventInvoice>, manager: EntityManager): Promise<EventInvoice> {
    const repo = manager.getRepository(EventInvoice);
    return repo.save(repo.create(values));
}

/** Reserve already selected file ownership before the uploader writes bytes.
 * Duplicate identities retain their existing state rather than reopening deletion. */
export async function insertProofFile(values: DeepPartial<InvoiceProofFile>, manager: EntityManager = AppDataSource.manager): Promise<void> {
    // The feature supplies the identity/path/state; this boundary only persists the reservation.
    await manager.getRepository(InvoiceProofFile).createQueryBuilder().insert().values(values).orIgnore().execute();
}

/** Read one ownership record, optionally retaining its write fence on a caller transaction. */
export async function getProofFile(id: string, manager: EntityManager = AppDataSource.manager, lock = false): Promise<InvoiceProofFile | null> {
    return manager.getRepository(InvoiceProofFile).findOne({where: {id}, ...(lock ? {lock: {mode: 'pessimistic_write' as const}} : {})});
}

/** Retain the proof row fence while the supplied named feature operation chooses its transition. */
export async function withProofFileTransaction<Result>(id: string, operation: InvoiceProofOperation<Result>): Promise<Result> {
    // READ COMMITTED observes invoices attached before this fence was acquired; no
    // feature callback can accidentally query through an earlier repeatable snapshot.
    async function runLocked(manager: EntityManager): Promise<Result> {
        return operation(manager, await getProofFile(id, manager, true));
    }
    return AppDataSource.transaction('READ COMMITTED', runLocked);
}

/** Persist a feature-selected transition without deciding eligibility or touching files. */
export async function saveProofFile(row: InvoiceProofFile, manager: EntityManager): Promise<void> {
    await manager.getRepository(InvoiceProofFile).save(row);
}

/** Remove completed ownership evidence only after the feature confirms filesystem completion. */
export async function deleteProofFile(id: string, manager: EntityManager): Promise<void> {
    await manager.getRepository(InvoiceProofFile).delete(id);
}

/** Page raw ownership records without hydrating invoice graphs or losing retry state. */
export async function getProofFilesPage(afterId?: string, limit = 100,
    manager: EntityManager = AppDataSource.manager): Promise<InvoiceProofFile[]> {
    return manager.getRepository(InvoiceProofFile).find({
        where: afterId ? {id: MoreThan(afterId)} : undefined, order: {id: 'ASC'}, take: limit,
    });
}

/** Return every live stored spelling; the proof owner compares filesystem identities.
 * DISTINCT protects legacy shared paths without choosing one invoice as the owner. */
export async function getInvoiceProofReferences(manager: EntityManager = AppDataSource.manager): Promise<string[]> {
    // Read only the reference column so cleanup never needs sensitive original names or invoice amounts.
    const rows = await manager.getRepository(EventInvoice).createQueryBuilder('invoice')
        .select('invoice.proof_path', 'path').distinct(true)
        .where({proofPath: And(Not(IsNull()), Not(''))}).getRawMany<{path: string}>();
    return rows.map(row => row.path);
}

/** Protect the ordinary stored spelling without scanning the installation's proof inventory. */
export async function hasInvoiceProofReference(paths: readonly string[], manager: EntityManager = AppDataSource.manager): Promise<boolean> {
    if (!paths.length) return false;
    // The native existence operation retains the supplied manager. BINARY is
    // necessary because ordinary collation equality aliases distinct proof paths.
    return manager.getRepository(EventInvoice).existsBy({
        proofPath: Raw(alias => `BINARY ${alias} IN (:...paths)`, {paths}),
    });
}

/** Page legacy aliases only when an exact reference did not protect a cleanup candidate. */
export async function getInvoiceProofReferencePage(afterId: number, manager: EntityManager = AppDataSource.manager): Promise<{id: number; path: string}[]> {
    const rows = await manager.getRepository(EventInvoice).createQueryBuilder('invoice')
        .select('invoice.id', 'id').addSelect('invoice.proof_path', 'path')
        .where({id: MoreThan(afterId), proofPath: And(Not(IsNull()), Not(''))})
        .orderBy('invoice.id', 'ASC').limit(1000).getRawMany<{id: number; path: string}>();
    return rows.map(row => ({id: Number(row.id), path: row.path}));
}

/** Execute one fixed advisory-lock function through the held connection's builder.
 * The native dummy source supplies exactly one row without reading application
 * tables, including an empty ledger or schema. Values remain bound to this runner. */
async function proofMaintenanceScalar(manager: EntityManager, operation: 'acquire' | 'release', name: string) {
    // Every identifier/function is a closed constant. Only the lock name is
    // supplied data, and it remains bound rather than becoming query syntax.
    const expression = operation === 'acquire' ? 'GET_LOCK(:proofMaintenanceName, 0)' : 'RELEASE_LOCK(:proofMaintenanceName)';
    const row = await manager.createQueryBuilder().select(expression, 'value')
        .fromDummy().setParameter('proofMaintenanceName', name)
        .getRawOne<{value: number | string | null}>();
    return row!.value;
}

/** Serialize offline maintenance commands on one held connection without moving
 * filesystem or manifest decisions into persistence. A busy lock returns null. */
export async function withProofMaintenanceLock<Result>(operation: () => Promise<Result>): Promise<{result: Result} | null> {
    const runner = AppDataSource.createQueryRunner();
    await runner.connect();
    const name = `surveyor-proof-maintenance:${String(AppDataSource.options.database)}`.slice(0, 64);
    let acquired = false;
    try {
        // MariaDB advisory locks belong to the connection, so retain this runner
        // through the caller's filesystem work and release before returning it.
        acquired = Number(await proofMaintenanceScalar(runner.manager, 'acquire', name)) === 1;
        return acquired ? {result: await operation()} : null;
    } finally {
        try { if (acquired) await proofMaintenanceScalar(runner.manager, 'release', name); }
        finally { await runner.release(); }
    }
}

export async function saveShare(share: EventInvoiceShare, manager: EntityManager): Promise<void> {
    await manager.getRepository(EventInvoiceShare).save(share);
}

/** Load calculation/rollback records under the caller's root lock; repository details stay here. */
export async function getCalculationRows(manager: EntityManager, pool: EventInvoicePool) {
    // Every collection uses the supplied transaction manager, retaining the caller's locked view of inputs.
    const [assignments, surcharges, takeovers, registrations, invoices, shares] = await Promise.all([
        manager.getRepository(EventPoolAssignment).find({where: {pool: {id: pool.id}}, order: {id: "ASC"}}),
        manager.getRepository(EventInvoiceSurcharge).find({where: {pool: {id: pool.id}}, order: {id: "ASC"}}),
        manager.getRepository(EventPoolTakeover).find({where: {pool: {id: pool.id}}, order: {id: "ASC"}}),
        manager.getRepository(EventRegistration).findBy({event: {id: pool.eventId}}),
        manager.getRepository(EventInvoice).findBy({pool: {id: pool.id}}),
        manager.getRepository(EventInvoiceShare).find({where: {pool: {id: pool.id}}, order: {id: "ASC"}}),
    ]);
    return {assignments, surcharges, takeovers, registrations, invoices, shares};
}

/** Return raw membership records; the corresponding feature operation decides whether they authorize an action. */
export async function getPoolMembership(manager: EntityManager, pool: EventInvoicePool, registrationId: number) {
    const registration = await manager.getRepository(EventRegistration).findOneBy({id: registrationId, event: {id: pool.eventId}});
    const assignment = await manager.getRepository(EventPoolAssignment).findOneBy({pool: {id: pool.id}, registration: {id: registrationId}});
    return {registration, assignment};
}

export async function getProfile(profileId: string, manager: EntityManager): Promise<Profile | null> {
    return manager.getRepository(Profile).findOne({where: {id: profileId}, relations: {user: true, guest: true}});
}

/** Replace a pool's controller-selected assignment rows on its existing transaction. */
export async function replaceAssignments(poolId: string, values: {registrationId: number; isExempt: boolean; factor: number}[], manager: EntityManager): Promise<void> {
    // Delete the previous collection before materializing the replacement, including
    // the empty-input case; validation and factor policy remain with the caller.
    const repo = manager.getRepository(EventPoolAssignment);
    await repo.delete({pool: {id: poolId}});
    const rows = values.map(value => repo.create({
        pool: {id: poolId}, registration: {id: value.registrationId}, isExempt: value.isExempt, factor: value.factor,
    }));
    if (rows.length) await repo.save(rows);
}

/** Replace the admitted surcharge collection using the caller's transaction manager. */
export async function replaceSurcharges(poolId: string, values: {registrationId: number; amount: number; note: string; subtractFromPool: boolean}[], manager: EntityManager): Promise<void> {
    // Persist the already selected amounts in the existing decimal storage format;
    // this replacement performs no settlement calculation or independent commit.
    const repo = manager.getRepository(EventInvoiceSurcharge);
    await repo.delete({pool: {id: poolId}});
    const rows = values.map(value => repo.create({
        pool: {id: poolId}, registration: {id: value.registrationId},
        amount: formatAmount(value.amount), note: value.note, subtractFromPool: value.subtractFromPool,
    }));
    if (rows.length) await repo.save(rows);
}

export async function deleteTakeovers(ids: number[], manager: EntityManager): Promise<void> {
    if (ids.length) await manager.getRepository(EventPoolTakeover).delete(ids);
}

/** Insert the supplied payer/beneficiary relationships without replacing other rows. */
export async function insertTakeovers(poolId: string, values: {payerId: number; beneficiaryId: number}[], manager: EntityManager): Promise<void> {
    // Translate admitted identifiers into ORM relations and avoid an empty save;
    // graph validity and payment policy have already been decided by the caller.
    const repo = manager.getRepository(EventPoolTakeover);
    const rows = values.map(value => repo.create({
        pool: {id: poolId}, payerRegistration: {id: value.payerId}, beneficiaryRegistration: {id: value.beneficiaryId},
    }));
    if (rows.length) await repo.save(rows);
}

/** Replace one pool's takeover collection inside the supplied persistence unit. */
export async function replaceTakeovers(poolId: string, values: {payerRegistrationId: number; beneficiaryRegistrationId: number}[], manager: EntityManager): Promise<void> {
    // Removal and shared insertion use the same manager; an empty collection clears
    // existing rows while leaving rollback/commit ownership with the caller.
    await manager.getRepository(EventPoolTakeover).delete({pool: {id: poolId}});
    const rows = values.map(value => ({payerId: value.payerRegistrationId, beneficiaryId: value.beneficiaryRegistrationId}));
    await insertTakeovers(poolId, rows, manager);
}

export async function saveSurcharge(poolId: string, registrationId: number, amount: number, note: string, subtractFromPool: boolean, manager: EntityManager) {
    const repo = manager.getRepository(EventInvoiceSurcharge);
    return repo.save(repo.create({pool: {id: poolId}, registration: {id: registrationId}, amount: formatAmount(amount), note, subtractFromPool}));
}

export async function deleteSurcharges(ids: number[], manager: EntityManager): Promise<void> {
    if (ids.length) await manager.getRepository(EventInvoiceSurcharge).delete(ids);
}

export async function getSurcharge(poolId: string, surchargeId: number, manager: EntityManager) {
    return manager.getRepository(EventInvoiceSurcharge).findOneBy({id: surchargeId, pool: {id: poolId}});
}

export async function deleteSurcharge(poolId: string, surchargeId: number, manager: EntityManager): Promise<void> {
    await manager.getRepository(EventInvoiceSurcharge).delete({id: surchargeId, pool: {id: poolId}});
}

/** Replace a feature-projected share collection within the caller's existing transaction. */
export async function replaceShares(poolId: string, values: ProjectedInvoiceShare[], manager: EntityManager): Promise<EventInvoiceShare[]> {
    const repo = manager.getRepository(EventInvoiceShare);
    // Projection and settlement carry-forward are already complete; this method only replaces their rows.
    await repo.delete({pool: {id: poolId}});
    const rows = values.map(value => repo.create({
        ...value, pool: {id: poolId}, registration: {id: value.registrationId}, note: value.note || null,
    }));
    if (rows.length) await repo.save(rows);
    // Reload generated identifiers for post-commit consumers without exposing repository objects.
    return repo.find({where: {pool: {id: poolId}}, order: {id: "ASC"}});
}

/** Select by the retention module's cutoff; file policy and scheduling stay outside DBAL. */
export async function getExpiredInvoices(cutoffDate: string): Promise<EventInvoice[]> {
    return AppDataSource.getRepository(EventInvoice).createQueryBuilder('invoice')
        .innerJoinAndSelect('invoice.pool', 'pool')
        .innerJoinAndSelect('pool.event', 'event')
        .where({pool: {event: {endDate: LessThanOrEqual(cutoffDate)}}}).getMany();
}

export async function deleteInvoices(ids: number[], manager: EntityManager): Promise<void> {
    if (ids.length) await manager.getRepository(EventInvoice).delete(ids);
}

/** Lock event pools in a stable order shared with registration writes and invoice calculations. */
export async function lockEventPools(manager: EntityManager, eventId: string): Promise<EventInvoicePool[]> {
    // Stable ordering prevents two registration/calculation transactions from taking opposite root locks.
    const pools = await manager.getRepository(EventInvoicePool).find({
        where: {event: {id: eventId}}, order: {id: "ASC"},
    });
    const lockedPools: EventInvoicePool[] = [];
    for (const pool of pools) {
        const locked = await lockPool(manager, pool.id);
        if (locked) lockedPools.push(locked);
    }
    return lockedPools;
}

/** Invalidate cached calculation revisions after persisted registration or attendance inputs change. */
export async function invalidateEventPools(manager: EntityManager, eventId: string): Promise<void> {
    // These materialized revisions and totals describe persisted inputs; no share is recalculated here.
    const pools = await lockEventPools(manager, eventId);
    for (const pool of pools) {
        pool.calculationRevision++;
        pool.needsRecalculation = pool.status === "CLOSED";
        await savePool(pool, manager);
        await refreshPoolTotals(manager, pool.id);
    }
}

/** Read only Event pool existence; no invoice, assignment, share or amount data is loaded. */
export async function hasEventPools(eventId: string, manager: EntityManager = AppDataSource.manager): Promise<boolean> {
    return manager.getRepository(EventInvoicePool).exists({where: {event: {id: eventId}}});
}

/** Load an event's invoice pools and their collections from one repeatable-read snapshot. */
export async function listPools(eventId: string) {
    /** Hydrate the existing list contract without multiplying independent child collections. */
    async function readSnapshot(manager: EntityManager) {
        // Query-loaded collections retain the creation ordering while avoiding a large multi-collection join.
        return manager.getRepository(EventInvoicePool).find({
            where: {event: {id: eventId}},
            relationLoadStrategy: "query",
            relations: {
                assignments: {registration: true},
                invoices: {registration: true, recordedByProfile: true},
                shares: {registration: true},
                takeovers: {payerRegistration: true, beneficiaryRegistration: true},
                surcharges: {registration: true},
            },
            order: {track: {createdAt: "ASC"}},
        });
    }
    // Hold one database snapshot for the complete list, including every pool's cached totals and shares.
    return AppDataSource.transaction("REPEATABLE READ", readSnapshot);
}

/** Persist validated pool settings and optional explicit assignments as one creation transaction. */
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
    status: InvoicePoolSubmissionState = 'OPEN',
    manager?: EntityManager,
) {
    /** Insert the root before its explicit assignment rows; either both are saved or neither is. */
    async function persistCreation(manager: EntityManager) {
        const poolRepo = manager.getRepository(EventInvoicePool);
        const assignmentRepo = manager.getRepository(EventPoolAssignment);
        // Business validation and checkbox normalization have already happened in the request module.
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
            // Persist the requested initial state in this transaction; organizer-only pools never need an OPEN interval.
            status,
            totalAmount: 0,
            openAmount: 0,
            outstandingAmount: 0,
            creditAmount: 0,
            additionalAmount: 0,
            surchargeOffsetAmount: 0,
            payableAmount: 0,
        });
        const saved = await poolRepo.save(pool);
        // Assign-all membership is dynamic; only explicitly selected membership needs stored assignment rows.
        if (!assignAll && registrationIds.length) {
            const rows = registrationIds.map((id) => assignmentRepo.create({
                pool: saved,
                registration: {id} as EventRegistration,
            }));
            await assignmentRepo.save(rows);
        }
        return saved.id;
    }
    // The returned identifier belongs to a fully committed creation, including its assignment collection.
    return manager ? persistCreation(manager) : AppDataSource.transaction("READ COMMITTED", persistCreation);
}

export async function getTakeovers(poolId: string, manager: EntityManager = AppDataSource.manager) {
    return manager.getRepository(EventPoolTakeover).find({
        where: {pool: {id: poolId}},
        relations: {payerRegistration: true, beneficiaryRegistration: true},
        order: {id: "ASC"},
    });
}

/** Rebuild persisted aggregate columns; the corresponding feature operation chooses when to refresh them. */
export async function recalcPoolTotals(poolId: string): Promise<void> {
    /** Refresh only a still-existing locked root; absence is intentionally an idempotent database no-op. */
    async function refreshLocked(manager: EntityManager, pool: EventInvoicePool | null): Promise<void> {
        if (pool) await refreshPoolTotals(manager, poolId);
    }
    await withLockedPool(poolId, refreshLocked);
}

/** Rebuild the pool's materialized aggregate columns from its persisted invoice, adjustment, and share rows. */
export async function refreshPoolTotals(manager: EntityManager, poolId: string) {
    const poolRepo = manager.getRepository(EventInvoicePool);
    const invoiceRepo = manager.getRepository(EventInvoice);
    const shareRepo = manager.getRepository(EventInvoiceShare);
    const surchargeRepo = manager.getRepository(EventInvoiceSurcharge);

    // Read all aggregate sources through the caller's manager so a transaction never mixes committed versions.
    const [invoices, shares, pool, surcharges] = await Promise.all([
        invoiceRepo.find({where: {pool: {id: poolId}}}),
        shareRepo.find({where: {pool: {id: poolId}}}),
        poolRepo.findOne({where: {id: poolId}}),
        surchargeRepo.find({where: {pool: {id: poolId}}}),
    ]);
    if (!pool) return;

    // Invoice totals retain accepted/closed costs and distinguish additional from redistributed adjustments.
    const {invoiceTotal, openAmount, extraAmount, subtractiveAmount} = invoiceCostTotals(invoices, surcharges);
    // Transfer totals include unsettled rows only. The legacy credit column stores a refund magnitude;
    // signed presentation is owned by the invoice presenter and never changes the saved share amount.
    const outstandingAmount = shares
        .filter((s) => !s.isPaid)
        .reduce((sum, s) => sum + Math.max(toAmount(s.shareAmount), 0), 0);
    const creditAmount = shares
        .filter((s) => !s.isPaid)
        .reduce((sum, s) => sum + Math.abs(Math.min(toAmount(s.shareAmount), 0)), 0);

    // Persist derived columns together; no lifecycle, authorization, or request-specific decision happens here.
    pool.invoiceAmount = toAmount(invoiceTotal);
    pool.additionalAmount = toAmount(extraAmount);
    pool.surchargeOffsetAmount = toAmount(subtractiveAmount);
    const payable = invoiceTotal - subtractiveAmount;
    pool.payableAmount = toAmount(payable);
    pool.openAmount = toAmount(openAmount);
    pool.outstandingAmount = toAmount(outstandingAmount);
    pool.creditAmount = toAmount(creditAmount);
    pool.totalAmount = pool.invoiceAmount + pool.additionalAmount;
    await poolRepo.save(pool);
}

export async function getPoolWithInvoices(poolId: string) {
    return loadPool(poolId);
}

export async function getApprovedInvoices(poolId: string) {
    return AppDataSource.getRepository(EventInvoice).find({where: {pool: {id: poolId}, status: "APPROVED"}});
}

export async function getInvoiceWithRegistration(poolId: string, invoiceId: number, manager: EntityManager = AppDataSource.manager) {
    return manager.getRepository(EventInvoice).findOne({
        where: {id: invoiceId, pool: {id: poolId}},
        relations: {registration: {profile: {user: true, guest: true}}, recordedByProfile: {user: true, guest: true}},
    });
}

export async function getShareWithRegistration(poolId: string, shareId: number, manager: EntityManager = AppDataSource.manager) {
    return manager.getRepository(EventInvoiceShare).findOne({
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
            .where({id: Equal(reg.id)})
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
