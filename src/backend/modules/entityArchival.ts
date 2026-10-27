/*
 * Copyright 2026 Julian Malovanij
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import Joi from 'joi';
import type {EntityManager} from 'typeorm';
import {archiveKey, automaticArchiveCutoff, isEffectivelyArchived, validateArchiveAfterDays} from './archive/policy';
import {ApiProblem, declaredApiProblem} from './api/problem';
import {APIError} from './lib/errors';
import {requireSessionProfileId} from './lib/session';
import {entityPermissionKey, evaluateEntities, isOwner} from './permissionEngine';
import {sameUuid, uuidKey} from './lib/util';
import * as lifecycleService from './database/services/EntityLifecycleService';
import type {ArchivePresentation, ArchiveReference, ArchiveSnapshotEntry, ArchiveState, ArchiveTarget, LockedArchiveContext} from '../../types/ArchiveTypes';
import type {EntityDescriptor, PermView, SessionLike} from '../../types/PermissionTypes';
import type {EntityMutationCompletion} from '../../types/EntityPropertyTypes';
import type {Entity} from '../../types/UserTypes';
import settings from './settings';

const ARCHIVE_INTERVAL_MS = 60 * 60 * 1000;
// These guards are local to this application process. Database eligibility checks
// remain necessary because another process may run the same sweep concurrently.
let archivalTimer: NodeJS.Timeout | undefined;
let running: Promise<number> | undefined;

/** Run one metadata-only sweep with the initialized settings and a single captured time. */
export async function runEntityArchival(now: Date = new Date()): Promise<number> {
    // A disabled job still rejects invalid configuration consistently at startup.
    // The switch stops automatic writes only; manual archival is a separate API path.
    validateArchiveAfterDays(settings.value.autoArchiveAfterDays, now);
    if (!settings.value.autoArchiveEnabled) {
        return 0;
    }

    // Startup and timer calls share the same in-flight sweep. SQL eligibility
    // rechecks additionally protect against another application process's job.
    if (running) {
        return running;
    }
    running = archiveExpiredEntities(settings.value.autoArchiveAfterDays, now);
    try {
        const archived = await running;
        if (archived > 0) {
            console.log(`[entity-archival] Archived ${archived} entit${archived === 1 ? 'y' : 'ies'}.`);
        }
        return archived;
    } finally {
        // Release the guard after both success and failure. A rejected sweep must not
        // leave the hourly job permanently attached to the same rejected promise.
        running = undefined;
    }
}

async function runScheduledArchival(): Promise<void> {
    try {
        await runEntityArchival();
    } catch (error) {
        // Timer failures are logged without terminating the server; the next tick can
        // retry. The initial startup sweep deliberately propagates errors instead.
        console.error('[entity-archival] Archival failed:', error);
    }
}

/** Catch up after downtime, then follow the app's immediate/hourly job convention. */
export async function startEntityArchivalJob(): Promise<void> {
    // Complete the first sweep before serving requests, including periods that ended
    // while the application was offline. Startup must not silently skip schema errors.
    await runEntityArchival();
    if (archivalTimer) {
        // Repeated initialization may request another catch-up sweep, but must never
        // register a second hourly timer in this process.
        return;
    }
    archivalTimer = setInterval(runScheduledArchival, ARCHIVE_INTERVAL_MS);
    // The maintenance timer should not keep an otherwise stopped process alive.
    archivalTimer.unref();
}

/** Interpret locking reads; the controller rejects deletion or a parent changed after discovery. */
export function requireLockedArchiveRoot(context: LockedArchiveContext): ArchiveTarget {
    const root = context.root;
    if (!root || context.initialEventId === undefined) throw new APIError('Entity not found.', {}, 404);
    if (root.eventId !== context.initialEventId && !sameUuid(root.eventId, context.initialEventId)
        || (root.eventId && !context.parents.has(uuidKey(root.eventId)))) {
        throw new APIError('The linked event changed. Reload and try again.', {}, 409);
    }
    return root;
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared entity lifecycle administration
// Archival changes discovery, while deletion remains a separate owner action.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve archival authority for an existing root, using the same rule for pages and commands.
 * Surveys deliberately retain their owner-only administration model. Other roots use
 * the permission engine's effective EDIT_META grant, which already includes ownership.
 * Anonymous viewers may read an archival notice but must never receive management controls.
 */
function mayManageArchival(reference: ArchiveReference, state: ArchiveState, session: SessionLike, permissions?: PermView): boolean {
    if (!session.profile) {
        return false;
    }
    if (reference.type === 'survey') {
        return isOwner(session, state.ownerId);
    }
    return permissions?.has('EDIT_META') ?? false;
}

/**
 * Derive lifecycle policy from raw, coherent reads. The DBAL supplies both timestamps;
 * deciding inheritance and independent scheduling stays in this controller. Overview
 * callers pass their existing snapshot so projection cannot race their page/count reads.
 */
export async function getArchiveStates(references: ArchiveReference[], snapshot?: Map<string, ArchiveSnapshotEntry>): Promise<Map<string, ArchiveState>> {
    const inputs = snapshot ?? await lifecycleService.getArchiveSnapshot(references);
    const states = new Map<string, ArchiveState>();
    for (const [key, {reference, root, parent}] of inputs) {
        states.set(key, {
            archived: isEffectivelyArchived(root.archivedAt, parent?.archivedAt ?? null),
            directArchived: root.archivedAt !== null,
            inheritedFromEventId: parent?.archivedAt ? parent.id : null,
            eventId: root.eventId,
            ownerId: root.ownerId,
            autoArchivePaused: Boolean(root.autoArchivePaused),
            hasAutomaticSchedule: hasIndependentSchedule(reference, root),
        });
    }
    return states;
}

/**
 * Build card and page capabilities from one lifecycle snapshot and batched permissions.
 * The result is keyed by archiveKey(type + id), so callers can join it to heterogeneous
 * overview cards without making their templates interpret permissions or inherited state.
 * Only requested roots are returned; additional parent events are internal permission inputs.
 */
export async function getArchivePresentations(
    references: ArchiveReference[],
    session: SessionLike,
    snapshot?: Map<string, ArchiveSnapshotEntry>,
    manager?: EntityManager,
): Promise<Map<string, ArchivePresentation>> {
    // Reuse an existing overview/transaction snapshot. Without one, direct callers
    // keep their ordinary reads; a supplied manager keeps lifecycle and grants in
    // the versioned caller's same transaction, rather than starting a second read.
    const currentSnapshot = snapshot ?? await lifecycleService.getArchiveSnapshot(references, manager);
    const states = await getArchiveStates(references, currentSnapshot);

    // Linked events are internal permission inputs, including when discovery
    // selected only a child. Parent restoration links require their own view grant.
    const permissionTargets = new Map<string, ArchiveReference>();
    for (const reference of references) {
        // Queries resolve equivalent UUID spellings to one stored row. Use that
        // exact descriptor ID for permission inputs rather than the caller's alias.
        const stored = currentSnapshot.get(archiveKey(reference))?.reference;
        if (stored) permissionTargets.set(archiveKey(stored), stored);
    }
    for (const state of states.values()) {
        if (state.eventId) {
            const event: ArchiveReference = {type: 'event', id: state.eventId};
            const stored = currentSnapshot.get(archiveKey(event))?.reference;
            if (stored) permissionTargets.set(archiveKey(stored), stored);
        }
    }

    // Describe each existing root once for the shared permission evaluator. Surveys bypass
    // this path because their archival authority comes from ownership, not shared ACL grants.
    // For an event, its own ID supplies participant-audience membership; children use eventId.
    const descriptors: EntityDescriptor[] = [];
    for (const [key, reference] of permissionTargets) {
        const state = states.get(key);
        if (!state || reference.type === 'survey') {
            continue;
        }
        descriptors.push({
            entityType: reference.type,
            entityId: reference.id,
            ownerId: state.ownerId,
            eventId: reference.type === 'event' ? reference.id : state.eventId,
        });
    }
    const permissions = await evaluateEntities(descriptors, session, manager);

    const presentations = new Map<string, ArchivePresentation>();
    for (const reference of references) {
        const key = archiveKey(reference);
        const state = states.get(key);
        if (!state) {
            // A root deleted after overview discovery must not leave behind an actionable card.
            continue;
        }
        const stored = permissionTargets.get(key)!;
        const canManage = mayManageArchival(reference, state, session,
            permissions.get(entityPermissionKey(stored.type, stored.id)));
        // Keep authority distinct from currently available commands. An inherited archive
        // still allows a child to gain its own archive marker, but only restoring the parent
        // can remove inheritance. Automation controls exist only for independently dated roots.
        const presentation: ArchivePresentation = {
            ...state,
            canManage,
            canArchive: canManage && !state.directArchived,
            canRestore: canManage && state.directArchived && !state.inheritedFromEventId,
            canManageAutomation: canManage && state.hasAutomaticSchedule,
        };

        // Explain the governing event only to a viewer who may open it. Do not expose an
        // actionable parent link merely because the child is visible or independently owned.
        if (state.inheritedFromEventId) {
            const event = permissionTargets.get(archiveKey({type: 'event', id: state.inheritedFromEventId}));
            if (event && permissions.get(entityPermissionKey(event.type, event.id))?.has('ACCESS_VIEW')) {
                presentation.eventUrl = `/event/${state.inheritedFromEventId}`;
            }
        }
        presentations.set(key, presentation);
    }
    return presentations;
}

/**
 * Prepare explicit renderer data for an entity page and its attached overview cards.
 * One presentation read gives the root notice and children a consistent lifecycle snapshot
 * during concurrent event archival. Missing children are omitted after permanent deletion;
 * the caller's original entity/card objects are left unchanged.
 */
export async function getArchiveView(reference: ArchiveReference, related: Entity[], session: SessionLike) {
    const states = await getArchivePresentations([reference, ...related], session);
    const relatedEntities: Entity[] = [];
    for (const item of related) {
        const archive = states.get(archiveKey(item));
        if (archive) {
            relatedEntities.push({...item, archive});
        }
    }
    return {archive: states.get(archiveKey(reference)), relatedEntities};
}

/**
 * Validate a command's narrow JSON contract, never a patch to persisted lifecycle fields.
 * Callers supply schemas that reject unknown keys. Disable coercion so values such as
 * "false" cannot silently become an accepted automation choice; absent bodies become {}.
 */
function validateArchiveBody<T>(schema: Joi.ObjectSchema<T>, body: unknown): T {
    const {error, value} = schema.validate(body ?? {}, {abortEarly: false, convert: false});
    if (error) {
        throw new APIError('Invalid archive request', {}, 400);
    }
    return value;
}

/** Check current authority against the locked relationship, including survey's owner exception. */
async function requireArchiveManagement(reference: ArchiveReference, root: ArchiveTarget, session: SessionLike, manager: EntityManager): Promise<void> {
    const descriptors: EntityDescriptor[] = [{entityType: reference.type, entityId: root.id, ownerId: root.ownerId,
        eventId: reference.type === 'event' ? root.id : root.eventId}];
    const permissions = await evaluateEntities(descriptors, session, manager);
    const allowed = reference.type === 'survey' ? isOwner(session, root.ownerId)
        : permissions.get(entityPermissionKey(reference.type, root.id))?.has('EDIT_META');
    if (!allowed) throw new APIError('Not allowed to manage archival', {}, 403);
}

/** The controller owns the independent-schedule rule; stored dates remain database data. */
function hasIndependentSchedule(reference: ArchiveReference, root: ArchiveTarget): boolean {
    return (reference.type === 'event' || reference.type === 'activity') && root.eventId === null;
}

/** Set only direct archival; retries preserve the first timestamp and never copy it to children. */
export function archiveEntity(reference: ArchiveReference, body: unknown, session: SessionLike,
    now?: Date): Promise<ArchivePresentation | undefined>;

/** A feature can prepare its receipt under the existing archive lock without requesting shared presentation. */
export function archiveEntity<Result>(reference: ArchiveReference, body: unknown, session: SessionLike,
    now: Date | undefined, completion: EntityMutationCompletion<Result>): Promise<Result>;

/** Share archival policy and persistence, selecting prepared completion only when explicitly requested. */
export async function archiveEntity<Result>(reference: ArchiveReference, body: unknown, session: SessionLike,
    now: Date = new Date(), completion?: EntityMutationCompletion<Result>): Promise<ArchivePresentation | undefined | Result> {
    // Preserve command/profile/clock admission before the DBAL obtains lifecycle locks.
    validateArchiveBody(Joi.object({}).unknown(false), body);
    requireSessionProfileId(session);
    if (!Number.isFinite(now.getTime())) throw new APIError('Invalid archival time.', {}, 400);

    /** Authorize the current root and prepare a requested receipt before the direct marker commits. */
    async function archiveLocked(manager: EntityManager, context: LockedArchiveContext): Promise<Result | undefined> {
        const root = requireLockedArchiveRoot(context);
        await requireArchiveManagement(reference, root, session, manager);

        // Repeated archive commands retain the first timestamp and perform no additional write.
        const changed = !root.archivedAt;
        if (changed) await lifecycleService.updateLifecycleMetadata(manager, reference, {archivedAt: now});
        const outcome = {changed, root: changed ? {...root, archivedAt: now} : root};
        return completion ? completion.prepare(manager, outcome) : undefined;
    }
    const prepared = await lifecycleService.withLockedArchiveTarget(reference, archiveLocked);

    // Explicit feature receipts already passed their fallible preparation before commit.
    // The original presentation read remains the default for direct archive callers.
    if (completion) return prepared as Result;
    return (await getArchivePresentations([reference], session)).get(archiveKey(reference));
}

/**
 * A child cannot undo its parent's archive. Restoration also pauses an independent automatic
 * schedule in the same write, so the next sweep cannot immediately undo this explicit action.
 */
export function restoreEntity(reference: ArchiveReference, body: unknown, session: SessionLike): Promise<ArchivePresentation | undefined>;

/** Prepare an explicit feature receipt inside the shared restoration transaction. */
export function restoreEntity<Result>(reference: ArchiveReference, body: unknown, session: SessionLike,
    completion: EntityMutationCompletion<Result>): Promise<Result>;

/** Keep restoration presentation compatible while allowing precommit feature completion. */
export async function restoreEntity<Result>(reference: ArchiveReference, body: unknown, session: SessionLike,
    completion?: EntityMutationCompletion<Result>): Promise<ArchivePresentation | undefined | Result> {
    // Restoration accepts only its existing narrow command and an admitted profile.
    validateArchiveBody(Joi.object({}).unknown(false), body);
    requireSessionProfileId(session);

    /** Recheck parent inheritance, perform the established patch and prepare its receipt under the lock. */
    async function restoreLocked(manager: EntityManager, context: LockedArchiveContext): Promise<Result | undefined> {
        const root = requireLockedArchiveRoot(context);
        await requireArchiveManagement(reference, root, session, manager);
        const parent = root.eventId ? context.parents.get(uuidKey(root.eventId)) : null;
        if (parent?.archivedAt) throw new APIError('Restore the linked event before restoring this entity.', {eventId: parent.id}, 409);

        // Preserve the existing restoration write, including an independent schedule's pause.
        // Receipt preparation uses the resulting root before this transaction can commit.
        const patch = hasIndependentSchedule(reference, root) ? {archivedAt: null, autoArchivePaused: true} : {archivedAt: null};
        await lifecycleService.updateLifecycleMetadata(manager, reference, patch);
        return completion ? completion.prepare(manager, {changed: true, root: {...root, ...patch}}) : undefined;
    }
    const prepared = await lifecycleService.withLockedArchiveTarget(reference, restoreLocked);

    // The explicit completion replaces only unused postcommit presentation; direct defaults remain intact.
    if (completion) return prepared as Result;
    return (await getArchivePresentations([reference], session)).get(archiveKey(reference));
}

/** Direct pause/resume retains its existing postcommit presentation. */
export function setAutomaticArchival(reference: ArchiveReference, body: unknown, session: SessionLike): Promise<ArchivePresentation | undefined>;

/** A scoped adapter can prepare its acknowledgement under the existing lifecycle locks. */
export function setAutomaticArchival<Result>(reference: ArchiveReference, body: unknown, session: SessionLike,
    completion: EntityMutationCompletion<Result>): Promise<Result>;

/** Explicit pause/resume affects scheduling only, never the current archive timestamp. */
export async function setAutomaticArchival<Result>(reference: ArchiveReference, body: unknown, session: SessionLike,
    completion?: EntityMutationCompletion<Result>): Promise<ArchivePresentation | undefined | Result> {
    // Admission and the schedule rule remain in their existing controller owner.
    const schema = Joi.object<{paused: boolean}>({paused: Joi.boolean().required()}).unknown(false);
    const value = validateArchiveBody(schema, body);
    requireSessionProfileId(session);
    async function setPauseLocked(manager: EntityManager, context: LockedArchiveContext): Promise<Result | undefined> {
        const root = requireLockedArchiveRoot(context);
        await requireArchiveManagement(reference, root, session, manager);
        if (!hasIndependentSchedule(reference, root)) throw new APIError('Automatic archival is controlled by an event or a standalone activity plan.', {}, 409, {cause: 'ARCHIVE_SCHEDULE_UNAVAILABLE'});
        await lifecycleService.updateLifecycleMetadata(manager, reference, {autoArchivePaused: value.paused});
        // The feature can recheck its captured parent scope and serialize a reply
        // before commit; direct callers keep their original presentation below.
        return completion ? completion.prepare(manager, {changed: root.autoArchivePaused !== value.paused,
            root: {...root, autoArchivePaused: value.paused}}) : undefined;
    }
    const prepared = await lifecycleService.withLockedArchiveTarget(reference, setPauseLocked);
    if (completion) return prepared as Result;
    return (await getArchivePresentations([reference], session)).get(archiveKey(reference));
}

/** Keep inherited restoration distinct from a changed root/parent relationship. */
export function classifyArchiveCommandError(error: unknown, archived: boolean): unknown {
    if (error instanceof ApiProblem) return error;
    // A controller-owned schedule diagnostic is more specific than the generic
    // parent-change fallback. Controller prose/data never cross this adapter.
    const declared = declaredApiProblem(error);
    if (declared) return declared;
    if (error instanceof APIError && error.status === 409) {
        return new ApiProblem(!archived && Object.hasOwn(error.data, 'eventId') ? 'ARCHIVE_INHERITED' : 'ENTITY_CONTEXT_CHANGED');
    }
    return error;
}

/** Scheduled orchestration validates one clock/cutoff before the DBAL's conditional batch writes. */
export async function archiveExpiredEntities(afterDays: number, now: Date = new Date()): Promise<number> {
    return lifecycleService.archiveExpiredEntities(automaticArchiveCutoff(afterDays, now), now);
}
