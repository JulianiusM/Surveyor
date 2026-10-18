/*
 * Copyright 2026 Julian Malovanij
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import {EntityManager, EntityTarget, Repository, type ObjectLiteral, type SelectQueryBuilder} from 'typeorm';
import type {ArchiveMetadataPatch, ArchiveReference, ArchiveSnapshotEntry, ArchiveTarget, LockedArchiveContext} from '../../../types/ArchiveTypes';
import type {EntityType} from '../../../types/UtilTypes';
import {archiveKey} from '../../archive/policy';
import {AppDataSource} from '../dataSource';
import {BaseEntity} from '../entities/abstract/BaseEntity';
import {ActivityPlan} from '../entities/activity/ActivityPlan';
import {DriversList} from '../entities/drivers/DriversList';
import {Event} from '../entities/event/Event';
import {PackingList} from '../entities/packing/PackingList';
import {Survey} from '../entities/surveys/Survey';

// This is the archive service's closed list of overview roots. The descriptor
// records schema differences once: only linked roots have event_id, and only dated
// roots have end_date/auto_archive_paused. Callers pass a type instead of choosing
// tables or reproducing those differences. Domain services retain actual deletion.
const roots: Record<EntityType, {entity: EntityTarget<BaseEntity>; linked: boolean; dated: boolean}> = {
    event: {entity: Event, linked: false, dated: true},
    activity: {entity: ActivityPlan, linked: true, dated: true},
    packing: {entity: PackingList, linked: true, dated: false},
    drivers: {entity: DriversList, linked: true, dated: false},
    survey: {entity: Survey, linked: false, dated: false},
};

// Bound the automatic sweep's memory use and query size without loading full entities.
const BATCH_SIZE = 200;

/** The type is already validated by the controller; this lookup only maps schema metadata. */
function getRootDescriptor(type: EntityType) {
    return roots[type];
}

/** Share repository selection with the existing profile-overview membership queries. */
export function getRootRepository(manager: EntityManager, type: EntityType): Repository<BaseEntity> {
    return manager.getRepository(getRootDescriptor(type).entity);
}

/**
 * Add the lifecycle inputs used by bounded overview queries before their LIMIT.
 * Only this service knows which root tables can inherit an event's state. The
 * profile service composes placement with its private preference, while this
 * projection is the SQL counterpart of isEffectivelyArchived. Integration cases
 * compare both paths so pagination cannot silently introduce a different policy.
 */
export function addOverviewArchiveProjection<T extends ObjectLiteral>(query: SelectQueryBuilder<T>, type: EntityType): void {
    const descriptor = getRootDescriptor(type);
    const alias = query.alias;
    if (descriptor.linked) {
        query.leftJoin(Event, 'overviewArchiveParent', `${alias}.event_id = overviewArchiveParent.id`)
            // UUID-only intermediate identities use one byte per character. The
            // stored column and indexed relationship remain unchanged.
            .addSelect(`CONVERT(${alias}.event_id USING ascii)`, 'eventId')
            .addSelect(`(${alias}.archived_at IS NOT NULL OR overviewArchiveParent.archived_at IS NOT NULL)`, 'effectiveArchived');
    } else {
        query.addSelect('NULL', 'eventId')
            .addSelect(`(${alias}.archived_at IS NOT NULL)`, 'effectiveArchived');
    }
}

function archiveTargetQuery(manager: EntityManager, type: EntityType) {
    const descriptor = getRootDescriptor(type);
    // Normalize every root to one small raw-row shape. SQL aliases are intentional:
    // getRawMany does not hydrate entity properties or follow TypeORM relations.
    // NULL/0 stand in for columns that do not exist on undated or unlinked roots.
    return getRootRepository(manager, type).createQueryBuilder('root')
        .select('root.id', 'id')
        .addSelect('root.owner_id', 'ownerId')
        .addSelect('root.archived_at', 'archivedAt')
        .addSelect(descriptor.linked ? 'root.event_id' : 'NULL', 'eventId')
        .addSelect(descriptor.dated ? 'root.auto_archive_paused' : '0', 'autoArchivePaused')
        .addSelect(descriptor.dated ? 'root.end_date' : 'NULL', 'endDate');
}

async function loadArchiveTargets(manager: EntityManager, type: EntityType, ids: string[]): Promise<ArchiveTarget[]> {
    // Apart from avoiding a query, this prevents generating an invalid IN () clause
    // when no additional event parents need to be loaded.
    if (!ids.length) {
        return [];
    }
    return archiveTargetQuery(manager, type)
        .where('root.id IN (:...ids)', {ids})
        .getRawMany<ArchiveTarget>();
}

async function lockTarget(manager: EntityManager, ref: ArchiveReference): Promise<ArchiveTarget | null> {
    // Called only inside a transaction. The row lock lasts through its write/commit;
    // ordinary UPDATE and DELETE statements on this root must wait for it as well.
    const target = await archiveTargetQuery(manager, ref.type)
        .where('root.id = :id', {id: ref.id})
        .setLock('pessimistic_write')
        .getRawOne<ArchiveTarget>();
    return target ?? null;
}

/**
 * Open one transaction and load a stable root/parent snapshot without interpreting it.
 * Discovery happens before any child lock. Existing and requested parents are then locked
 * in ascending ID order before the root, matching every lifecycle/association writer.
 *
 * The callback receives nullable reads and the discovered relationship so its controller
 * can distinguish deletion, a concurrent relink, and missing destinations. Throwing there
 * rolls back the transaction; this DBAL never chooses a status code or an allowed action.
 */
export async function withLockedArchiveTarget<T>(
    ref: ArchiveReference,
    action: (manager: EntityManager, context: LockedArchiveContext) => Promise<T>,
    additionalEventIds: string[] = [],
): Promise<T> {
    async function lockAndRun(manager: EntityManager): Promise<T> {
        const [initial] = await loadArchiveTargets(manager, ref.type, [ref.id]);
        const parentIds = new Set(additionalEventIds);
        if (initial?.eventId) parentIds.add(initial.eventId);
        const parents = new Map<string, ArchiveTarget>();
        for (const id of [...parentIds].sort()) {
            const parent = await lockTarget(manager, {type: 'event', id});
            if (parent) parents.set(id, parent);
        }
        const root = await lockTarget(manager, ref);
        return action(manager, {initialEventId: initial?.eventId, root, parents});
    }
    // Locking reads after a wait must see the committed relationship, not discovery's snapshot.
    return AppDataSource.transaction('READ COMMITTED', lockAndRun);
}

/** Persist controller-normalized lifecycle columns on the caller's locked transaction. */
export async function updateLifecycleMetadata(manager: EntityManager, ref: ArchiveReference, patch: ArchiveMetadataPatch): Promise<void> {
    await getRootRepository(manager, ref.type).update(ref.id, patch);
}

/** Persist only the relationship. The controller coordinates any affected domain records. */
export async function updateEventAssociation(manager: EntityManager, ref: ArchiveReference, eventId: string | null): Promise<void> {
    await manager.createQueryBuilder().relation(getRootDescriptor(ref.type).entity, 'event').of(ref.id).set(eventId);
}

/**
 * Resolve each requested root once, including events absent from the user's overview.
 * All reads use one snapshot: an event and its children must never show opposite
 * lifecycle states because the event changed between separate queries.
 */
export async function getArchiveSnapshot(refs: ArchiveReference[], manager?: EntityManager): Promise<Map<string, ArchiveSnapshotEntry>> {
    if (!refs.length) {
        return new Map();
    }

    async function readSnapshot(manager: EntityManager): Promise<Map<string, ArchiveSnapshotEntry>> {
        // Phase 1: group and deduplicate overview references so repeated cards in
        // administration/participation require only one metadata read per root.
        const idsByType = new Map<EntityType, Set<string>>();
        for (const ref of refs) {
            let ids = idsByType.get(ref.type);
            if (!ids) {
                ids = new Set();
                idsByType.set(ref.type, ids);
            }
            ids.add(ref.id);
        }

        const targets = new Map<string, {ref: ArchiveReference; root: ArchiveTarget}>();
        // Phase 2: read each entity table once. The composite key keeps different
        // root types distinct without exposing their persistence model to callers.
        for (const [type, ids] of idsByType) {
            const rows = await loadArchiveTargets(manager, type, Array.from(ids));
            for (const root of rows) {
                const ref = {type, id: root.id};
                targets.set(archiveKey(ref), {ref, root});
            }
        }

        const missingParentIds = new Set<string>();
        // Phase 3: add governing events absent from the requested overview. A user
        // can participate in a child without having a separate card for its event.
        // These event rows are lifecycle inputs, not permission to display a new card.
        for (const {root} of targets.values()) {
            if (root.eventId && !targets.has(archiveKey({type: 'event', id: root.eventId}))) {
                missingParentIds.add(root.eventId);
            }
        }
        const parents = await loadArchiveTargets(manager, 'event', Array.from(missingParentIds));
        for (const root of parents) {
            const ref: ArchiveReference = {type: 'event', id: root.id};
            targets.set(archiveKey(ref), {ref, root});
        }

        const states = new Map<string, ArchiveSnapshotEntry>();
        // Phase 4: pair raw roots with their parent rows in the completed snapshot. Resolve
        // relationships only after every parent is available, independent of input order.
        for (const [key, {ref, root}] of targets) {
            let parent: ArchiveTarget | null = null;
            if (root.eventId) {
                parent = targets.get(archiveKey({type: 'event', id: root.eventId}))?.root ?? null;
            }
            states.set(key, {reference: ref, root, parent});
        }
        return states;
    }

    // An overview already owns the read snapshot used for membership, counts and
    // pagination. Reuse it so its cards cannot acquire a different archive state
    // between selection and presentation. Ordinary callers still get one snapshot.
    return manager ? readSnapshot(manager) : AppDataSource.transaction('REPEATABLE READ', readSnapshot);
}

/** Archive eligible dated roots in bounded batches using one captured UTC cutoff. */
export async function archiveExpiredEntities(cutoff: string, now: Date): Promise<number> {
    // The controller supplies one validated cutoff and timestamp. SQL retains every
    // predicate in the write so concurrent changes cannot satisfy an earlier stale read.
    let archived = 0;
    for (const type of ['event', 'activity'] as const) {
        let previous: {id: string; endDate: string} | undefined;
        while (true) {
            const candidates = archiveTargetQuery(AppDataSource.manager, type)
                .where('root.archived_at IS NULL')
                .andWhere('root.auto_archive_paused = 0')
                .andWhere('root.end_date <= :cutoff', {cutoff});
            if (type === 'activity') {
                // Attached plans inherit the event timestamp. Their own end date
                // cannot make them disappear while the event remains active.
                candidates.andWhere('root.event_id IS NULL');
            }
            if (previous) {
                // Both fields form the cursor because many entities can share an
                // end date. UUID order provides a deterministic tie breaker.
                candidates.andWhere(
                    '(root.end_date > :lastDate OR (root.end_date = :lastDate AND root.id > :lastId))',
                    {lastDate: previous.endDate, lastId: previous.id},
                );
            }
            const rows = await candidates
                .orderBy('root.end_date', 'ASC')
                .addOrderBy('root.id', 'ASC')
                .limit(BATCH_SIZE)
                .getRawMany<ArchiveTarget>();
            if (!rows.length) {
                break;
            }

            // Selection does not authorize a later write. Recheck every condition
            // atomically so concurrent restoration, date edits, linking or another
            // process's sweep cannot archive an ineligible root or count it twice.
            for (const root of rows) {
                const update = getRootRepository(AppDataSource.manager, type).createQueryBuilder().update()
                    .set({archivedAt: now})
                    .where('id = :id', {id: root.id})
                    .andWhere('archived_at IS NULL')
                    .andWhere('auto_archive_paused = 0')
                    .andWhere('end_date <= :cutoff', {cutoff});
                if (type === 'activity') {
                    update.andWhere('event_id IS NULL');
                }
                // Count writes that still qualified, not earlier candidates; another
                // process may already have archived or an organizer restored a row.
                archived += (await update.execute()).affected ?? 0;
            }

            // A stable keyset avoids OFFSET skipping rows after earlier updates
            // remove them from the candidate set. The eligibility index uses this order.
            const last = rows[rows.length - 1];
            previous = {id: last.id, endDate: last.endDate!};
        }
    }
    return archived;
}
