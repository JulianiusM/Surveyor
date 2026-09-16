/*
 * Copyright 2026 Julian Malovanij
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import {EntityManager, EntityTarget, Repository, type ObjectLiteral, type SelectQueryBuilder} from 'typeorm';
import type {ArchiveReference, ArchiveState} from '../../../types/ArchiveTypes';
import type {EntityType} from '../../../types/UtilTypes';
import {archiveKey, automaticArchiveCutoff, isEffectivelyArchived} from '../../archive/policy';
import {APIError} from '../../lib/errors';
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

/** Only lifecycle metadata is loaded; assignments, invoices and files stay outside this service. */
interface ArchiveTarget {
    id: string;
    ownerId: string;
    eventId: string | null;
    archivedAt: Date | null;
    autoArchivePaused: boolean;
    endDate: string | null;
}

function getRootDescriptor(type: EntityType) {
    // Runtime inputs can reach this boundary despite the TypeScript union. Reject
    // unknown keys before selecting a repository, including Object prototype keys.
    if (!Object.hasOwn(roots, type)) {
        throw new APIError('Invalid entity type.', {}, 400);
    }
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

function rootHasDates(type: EntityType): boolean {
    return getRootDescriptor(type).dated;
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
 * Give an archival or personal-preference command a current, stable target.
 * Every linked command locks the event before its child, so competing commands use
 * the same order and cannot observe a parent restoration halfway through a child write.
 * The initial relationship lookup only decides which parent to lock; it is not the
 * state passed to the callback. We reload and check the root after acquiring locks.
 *
 * Domain deletion still uses its normal repository DELETE. Database row locks make
 * it wait if this transaction came first; if deletion wins, the locking read returns
 * no root and the command fails with 404. This helper does not perform deletion or
 * promise cleanup of the separately stored polymorphic visibility preferences.
 */
export async function withLockedArchiveTarget<T>(
    ref: ArchiveReference,
    action: (manager: EntityManager, root: ArchiveTarget, parent: ArchiveTarget | null) => Promise<T>,
): Promise<T> {
    async function lockAndRun(manager: EntityManager): Promise<T> {
        // Discover the parent without locking the child first. Reversing the order
        // here would conflict with other commands that already hold the event lock.
        const [initial] = await loadArchiveTargets(manager, ref.type, [ref.id]);
        if (!initial) {
            throw new APIError('Entity not found.', {}, 404);
        }

        let parent: ArchiveTarget | null = null;
        if (initial.eventId) {
            parent = await lockTarget(manager, {type: 'event', id: initial.eventId});
        }
        const root = await lockTarget(manager, ref);
        if (!root) {
            throw new APIError('Entity not found.', {}, 404);
        }
        if (root.eventId !== initial.eventId || (root.eventId && !parent)) {
            // A concurrent relink invalidates the parent lock we chose. Ask the
            // caller to reload instead of writing against an unlocked new parent.
            throw new APIError('The linked event changed. Reload and try again.', {}, 409);
        }
        return action(manager, root, parent);
    }

    // Each statement sees committed changes after waiting for locks. In particular,
    // the callback's overview-membership check must not use the initial lookup's view.
    return AppDataSource.transaction('READ COMMITTED', lockAndRun);
}

function hasIndependentAutomaticSchedule(ref: ArchiveReference, root: ArchiveTarget): boolean {
    // A linked activity plan's own dates never schedule its archival independently;
    // it follows the event even if its period ends earlier or later than the event's.
    return rootHasDates(ref.type) && root.eventId === null;
}

function projectState(ref: ArchiveReference, root: ArchiveTarget, parent: ArchiveTarget | null): ArchiveState {
    // Keep stored direct state and effective inherited state distinct. Restoring an
    // event removes inheritance but must preserve any child archived on its own.
    // Raw MariaDB boolean columns arrive as numbers, so normalize the pause flag.
    return {
        archived: isEffectivelyArchived(root.archivedAt, parent?.archivedAt ?? null),
        directArchived: root.archivedAt !== null,
        inheritedFromEventId: parent?.archivedAt ? parent.id : null,
        eventId: root.eventId,
        ownerId: root.ownerId,
        autoArchivePaused: Boolean(root.autoArchivePaused),
        hasAutomaticSchedule: hasIndependentAutomaticSchedule(ref, root),
    };
}

/**
 * Resolve each requested root once, including events absent from the user's overview.
 * All reads use one snapshot: an event and its children must never show opposite
 * lifecycle states because the event changed between separate queries.
 */
export async function getArchiveStates(refs: ArchiveReference[], manager?: EntityManager): Promise<Map<string, ArchiveState>> {
    if (!refs.length) {
        return new Map();
    }

    async function readSnapshot(manager: EntityManager): Promise<Map<string, ArchiveState>> {
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

        const states = new Map<string, ArchiveState>();
        // Phase 4: derive all effective states from the completed snapshot. Resolve
        // inheritance only after every parent is available, independent of input order.
        for (const [key, {ref, root}] of targets) {
            let parent: ArchiveTarget | null = null;
            if (root.eventId) {
                parent = targets.get(archiveKey({type: 'event', id: root.eventId}))?.root ?? null;
            }
            states.set(key, projectState(ref, root, parent));
        }
        return states;
    }

    // An overview already owns the read snapshot used for membership, counts and
    // pagination. Reuse it so its cards cannot acquire a different archive state
    // between selection and presentation. Ordinary callers still get one snapshot.
    return manager ? readSnapshot(manager) : AppDataSource.transaction('REPEATABLE READ', readSnapshot);
}

/** Set direct lifecycle state only. Repeated requests retain the first timestamp. */
export async function archiveEntity(ref: ArchiveReference, now: Date = new Date()): Promise<ArchiveState> {
    if (!Number.isFinite(now.getTime())) {
        throw new Error('Invalid archival time.');
    }
    return withLockedArchiveTarget(ref, async function archive(manager, root, parent) {
        // The event timestamp itself governs every attached entity immediately;
        // copying timestamps to children would lose their independent archive state.
        // An already archived root keeps its timestamp when a request is retried.
        if (!root.archivedAt) {
            await getRootRepository(manager, ref.type).update(ref.id, {archivedAt: now});
            root.archivedAt = now;
        }
        return projectState(ref, root, parent);
    });
}

/** Restoration changes only this root; a child cannot undo its event's archival. */
export async function restoreEntity(ref: ArchiveReference): Promise<ArchiveState> {
    return withLockedArchiveTarget(ref, async function restore(manager, root, parent) {
        // A child's own timestamp cannot override an archived event. Returning a
        // conflict keeps the restore action honest instead of reporting a still-hidden
        // inherited archive as successfully restored.
        if (parent?.archivedAt) {
            throw new APIError('Restore the linked event before restoring this entity.', {eventId: parent.id}, 409);
        }

        // Pausing and restoring are one write, so the next hourly run cannot undo a
        // manual restoration of an already expired period. The pause persists until
        // an organizer explicitly resumes it; ordinary date edits do not clear it.
        // Linked plans have no independent schedule to pause.
        const pauseAutomaticArchival = hasIndependentAutomaticSchedule(ref, root);
        const patch = pauseAutomaticArchival ? {archivedAt: null, autoArchivePaused: true} : {archivedAt: null};
        await getRootRepository(manager, ref.type).update(ref.id, patch);
        root.archivedAt = null;
        if (pauseAutomaticArchival) {
            root.autoArchivePaused = true;
        }
        return projectState(ref, root, parent);
    });
}

/** Set an explicit value instead of toggling, making retried requests idempotent. */
export async function setAutomaticArchivalPaused(ref: ArchiveReference, paused: boolean): Promise<ArchiveState> {
    return withLockedArchiveTarget(ref, async function setPause(manager, root, parent) {
        if (!hasIndependentAutomaticSchedule(ref, root)) {
            throw new APIError('Automatic archival is controlled by an event or a standalone activity plan.', {}, 409);
        }
        // This changes scheduling only. Resuming an expired root lets the next sweep
        // archive it; pausing an archived root does not implicitly restore it.
        await getRootRepository(manager, ref.type).update(ref.id, {autoArchivePaused: paused} as Partial<ArchiveTarget>);
        root.autoArchivePaused = paused;
        return projectState(ref, root, parent);
    });
}

/** Archive eligible dated roots in bounded batches using one captured UTC cutoff. */
export async function archiveExpiredEntities(afterDays: number, now: Date = new Date()): Promise<number> {
    // Capture one date boundary and timestamp for the entire sweep. Crossing UTC
    // midnight while processing batches must not change which end dates are due.
    const cutoff = automaticArchiveCutoff(afterDays, now);
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
