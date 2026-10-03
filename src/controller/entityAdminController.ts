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

// src/controller/entityAdminController.ts
import Joi from 'joi';
import {archiveKey, automaticArchiveCutoff, isEffectivelyArchived} from '../modules/archive/policy';
import type {EntityManager} from 'typeorm';
import {invalidateGeneratedRecommendations} from '../modules/database/services/ActivityRecommendationService';
import {Profile} from "../modules/database/entities/user/Profile";
import * as entityAdminService from '../modules/database/services/EntityAdminService';
import * as eventService from '../modules/database/services/EventService';
import * as lifecycleService from '../modules/database/services/EntityLifecycleService';
import * as userService from '../modules/database/services/UserService';
import {APIError} from '../modules/lib/errors';
import {getPresetMask, PERM, toMask} from "../modules/lib/permissions";
import {requireSessionProfileId} from '../modules/lib/session';
import {evaluateEntities, evaluateSubject} from '../modules/permissionEngine';
import type {BasicEntityPropertyPatch, EntityPropertyField, EntityPropertyPresentation} from '../types/EntityPropertyTypes';
import type {ArchivePresentation, ArchiveReference, ArchiveSnapshotEntry, ArchiveState, ArchiveTarget, LockedArchiveContext} from '../types/ArchiveTypes';
import type {EntityDescriptor, PermType, PermView, SessionLike} from '../types/PermissionTypes';
import type {Entity, EntityBase} from '../types/UserTypes';
import type {CombEntityType, EntityType} from "../types/UtilTypes";

// One closed field policy drives both renderer projection and request authorization.
// Feature controllers retain normalization and domain checks; arbitrary property bags are rejected.
const basicPropertyPermissions: Partial<Record<EntityPropertyField, PermType>> = {
    title: 'EDIT_TITLE', description: 'EDIT_DESC',
};
const eventPropertyPermissions: Partial<Record<EntityPropertyField, PermType>> = {
    ...basicPropertyPermissions,
    startDate: 'EDIT_META', endDate: 'EDIT_META', location: 'EDIT_META',
    bindingDeadline: 'EDIT_META', deadlineTz: 'EDIT_META',
    allowRegDateUpdatesAfterDeadline: 'EDIT_META', allowRegCancelationAfterDeadline: 'EDIT_META',
    maxParticipants: 'EDIT_CAPACITY', requireDietaryInfo: 'MANAGE_REQUIREMENTS',
    allowDietComment: 'MANAGE_REQUIREMENTS', allowRegDietUpdateAfterDeadline: 'MANAGE_REQUIREMENTS',
};

function propertyPermissions(type: EntityType): Partial<Record<EntityPropertyField, PermType>> {
    if (type === 'event') return eventPropertyPermissions;
    if (type === 'activity') return {...basicPropertyPermissions, startDate: 'EDIT_META', endDate: 'EDIT_META'};
    return basicPropertyPermissions;
}

/** Render the stored instant as local wall time in the same zone used by the edit parser. */
function deadlineInputValue(value: unknown, timezone: unknown): string | null {
    if (!value) return null;
    const date = new Date(value as string | Date);
    if (!Number.isFinite(date.getTime())) return null;
    let formatter: Intl.DateTimeFormat;
    try {
        formatter = new Intl.DateTimeFormat('en-CA', {timeZone: String(timezone || 'UTC'), hourCycle: 'h23',
            year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'});
    } catch {
        formatter = new Intl.DateTimeFormat('en-CA', {timeZone: 'UTC', hourCycle: 'h23',
            year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'});
    }
    const parts = new Map(formatter.formatToParts(date).map(part => [part.type, part.value]));
    return `${parts.get('year')}-${parts.get('month')}-${parts.get('day')}T${parts.get('hour')}:${parts.get('minute')}:${parts.get('second')}`;
}

/** Reject forbidden and unsupported fields before any feature persistence can run. */
export function assertEditableEntityFields(type: EntityType, body: unknown, permissions: PermView, owner = false): void {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new APIError('Invalid property update.', {}, 400);
    const policy = propertyPermissions(type);
    for (const field of Object.keys(body)) {
        if (!Object.hasOwn(policy, field)) throw new APIError('Unknown entity property.', {field}, 400);
        const allowed = type === 'survey' ? owner : permissions.has(policy[field as EntityPropertyField]!);
        if (!allowed) throw new APIError('Not allowed to edit this property.', {field}, 403);
    }
}

/** Shared title/description normalization for the otherwise undated root features. */
export function normalizeBasicProperties(body: unknown): BasicEntityPropertyPatch {
    const schema = Joi.object({title: Joi.string().trim().min(1).max(255), description: Joi.string().max(16000).allow('', null)})
        .min(1).unknown(false).required();
    const {value, error} = schema.validate(body, {abortEarly: false});
    if (error) throw new APIError(error.message, {}, 400);
    if (value.description === '') value.description = null;
    return value;
}

/** Resolve the current profile against the persisted parent, never a proposed association. */
export async function requireEntityPropertyUpdate(type: EntityType, entity: EntityBase, body: unknown, session: SessionLike) {
    requireSessionProfileId(session);
    const permissions = await evaluateSubject({kind: 'entity', entity: {
        entityType: type, entityId: entity.id, ownerId: entity.ownerId,
        eventId: type === 'event' ? entity.id : entity.eventId,
    }}, session);
    assertEditableEntityFields(type, body, permissions, session.profile?.id === entity.ownerId);
}

/** Only editable values enter renderer data; action flags reflect their existing API guards. */
export async function getEntityPropertyPresentation(type: EntityType, entity: EntityBase, session: SessionLike): Promise<EntityPropertyPresentation> {
    const permissions = await evaluateSubject({kind: 'entity', entity: {
        entityType: type, entityId: entity.id, ownerId: entity.ownerId,
        eventId: type === 'event' ? entity.id : entity.eventId,
    }}, session);
    const owner = !!session.profile && session.profile.id === entity.ownerId;
    const editableFields: EntityPropertyField[] = [];
    const values: EntityPropertyPresentation['values'] = {};
    const source = entity as EntityBase & Record<string, unknown>;
    for (const [field, permission] of Object.entries(propertyPermissions(type))) {
        if (!session.profile || !(type === 'survey' ? owner : permissions.has(permission))) continue;
        const key = field as EntityPropertyField;
        editableFields.push(key);
        const value = source[key === 'deadlineTz' ? 'timezone' : key];
        values[key] = value instanceof Date ? value.toISOString() : value as string | number | boolean | null ?? null;
        if (key === 'bindingDeadline') values[key] = deadlineInputValue(value, source.timezone);
        if (key === 'deadlineTz') values[key] = (value as string) || 'UTC';
    }
    const canLinkEvent = !!session.profile && ['activity', 'packing', 'drivers'].includes(type) && permissions.has('EDIT_META');
    let currentEvent: EntityPropertyPresentation['currentEvent'] = null;
    if (session.profile && entity.eventId) {
        currentEvent = {id: entity.eventId};
        const event = await eventService.getEventById(entity.eventId);
        if (event) {
            const parentPermissions = await evaluateSubject({kind: 'entity', entity: {
                entityType: 'event', entityId: event.id, ownerId: event.ownerId, eventId: event.id,
            }}, session);
            if (parentPermissions.has('ACCESS_VIEW') || parentPermissions.has('MANAGE_ASSIGNMENTS')) {
                currentEvent = {id: event.id, title: event.title, startDate: event.startDate, endDate: event.endDate};
                if (parentPermissions.has('ACCESS_VIEW')) currentEvent.url = `/event/${event.id}`;
            }
        }
    }
    return {
        entityType: type, id: entity.id, updateUrl: `/api/${type}/${entity.id}/update`,
        eventUrl: canLinkEvent ? `/api/${type}/${entity.id}/event` : undefined,
        exportUrl: type === 'activity' && permissions.has('DATA_EXPORT') ? `/activity/${entity.id}/export/schedule`
            : type === 'event' && permissions.has('DATA_EXPORT') && permissions.has('ACCESS_PARTICIPANTS') ? `/event/${entity.id}/export/participants` : undefined,
        exportLabel: type === 'activity' ? 'Export schedule' : 'Export participants',
        values, editableFields, canEditProperties: editableFields.length > 0, canLinkEvent,
        canEditHeader: !!session.profile && permissions.has('EDIT_META'),
        canDuplicate: !!session.auth?.user && permissions.has('DATA_DUPLICATE'),
        canDelete: owner, canManagePermissions: type !== 'survey' && !!session.profile && permissions.has('MANAGE_PERMISSIONS'), currentEvent,
    };
}

/** Shared optimistic-context validation for root property controllers, under their row lock. */
export function assertEntityPropertyContext(entity: EntityBase | null, expectedEventId?: string | null): asserts entity is EntityBase {
    if (!entity) throw new APIError('Entity not found.', {}, 404);
    if (expectedEventId !== undefined && (entity.eventId ?? null) !== expectedEventId) throw new APIError('The linked event changed. Reload and try again.', {}, 409);
}

/** Interpret locking reads; the controller rejects deletion or a parent changed after discovery. */
export function requireLockedArchiveRoot(context: LockedArchiveContext): ArchiveTarget {
    const root = context.root;
    if (!root || context.initialEventId === undefined) throw new APIError('Entity not found.', {}, 404);
    if (root.eventId !== context.initialEventId || (root.eventId && !context.parents.has(root.eventId))) {
        throw new APIError('The linked event changed. Reload and try again.', {}, 409);
    }
    return root;
}

/** Explicit association command; old-parent authority is checked inside the locking transaction. */
export async function changeEntityEvent(type: EntityType, entity: EntityBase, body: unknown, session: SessionLike, invalidateContext?: (id: string) => void) {
    requireSessionProfileId(session);
    if (!['activity', 'packing', 'drivers'].includes(type)) throw new APIError('This entity cannot be linked to an event.', {}, 400);
    const schema = Joi.object({eventId: Joi.string().uuid().lowercase().allow(null).required(), expectedEventId: Joi.string().uuid().lowercase().allow(null).required()}).unknown(false).required();
    const {value, error} = schema.validate(body);
    if (error) throw new APIError(error.message, {}, 400);
    const reference = {type, id: entity.id};
    async function changeLocked(manager: EntityManager, context: LockedArchiveContext) {
        const root = requireLockedArchiveRoot(context);
        const target = value.eventId ? context.parents.get(value.eventId) : null;
        if (value.eventId && !target) throw new APIError('Event not found.', {}, 404);
        const descriptors: EntityDescriptor[] = [{entityType: type, entityId: root.id, ownerId: root.ownerId, eventId: root.eventId}];
        if (target) descriptors.push({entityType: 'event', entityId: target.id, ownerId: target.ownerId, eventId: target.id});
        const permissions = await evaluateEntities(descriptors, session, manager);
        if (!permissions.get(`${type}:${root.id}`)?.has('EDIT_META')) throw new APIError('Not allowed to change the linked event.', {}, 403);
        if (target && !permissions.get(`event:${target.id}`)?.has('MANAGE_ASSIGNMENTS')) throw new APIError('Not allowed to attach entities to this event.', {}, 403);
        // Retrying a committed choice is harmless but still requires current authority.
        if (root.eventId === value.eventId) return {changed: false, root};
        if (root.eventId !== value.expectedEventId) throw new APIError('The linked event changed. Reload and try again.', {}, 409);
        // Invalidating under the plan lock prevents an old job from surviving A-to-B-to-A.
        // If persistence later rolls back, conservative cancellation cannot corrupt saved work.
        invalidateContext?.(root.id);
        await lifecycleService.updateEventAssociation(manager, reference, value.eventId);
        if (type === 'activity') await invalidateGeneratedRecommendations(manager, root.id);
        return {changed: true, root: {...root, eventId: value.eventId}};
    }
    const {changed, root} = await lifecycleService.withLockedArchiveTarget(reference, changeLocked, value.eventId ? [value.eventId] : []);
    const archive = (await getArchivePresentations([reference], session)).get(archiveKey(reference));
    // Re-evaluate the resulting relationship, including unlink, using the same admission
    // contract as the page route. Stored old-event grants no longer describe the new page.
    const redirectUrl = await canAccessEntityView(type, root, session) ? undefined : '/users/dashboard';
    return {archive, redirectUrl, changed};
}

/**
 * Shared guest-flow page admission, also used after reassociation. A profile may open a
 * standalone entity. Attached roots additionally admit event members or an explicit child
 * ACCESS_VIEW grant; linking alone never grants admission to an unregistered editor.
 */
export async function canAccessEntityView(type: EntityType, entity: Pick<EntityBase, 'id' | 'ownerId' | 'eventId'>, session: SessionLike): Promise<boolean> {
    if (!session.profile) return false;
    if (!entity.eventId) return true;
    if (await eventService.isRegisteredForEvent(session.profile.id, entity.eventId)) return true;
    const permissions = await evaluateSubject({kind: 'entity', entity: {
        entityType: type, entityId: entity.id, ownerId: entity.ownerId, eventId: entity.eventId,
    }}, session);
    return permissions.has('ACCESS_VIEW');
}

const REQ_PERM = PERM.MANAGE_PERMISSIONS;

export function requiredAdminManagePerm() {
    return REQ_PERM;
}

/** POST /admins — add admin (create or upsert) */
export async function addAdmin(entityType: CombEntityType, entityId: string, body: any, creator?: Profile | null) {
    const schema = Joi.object({
        profileId: Joi.string().uuid().required(),
        preset: Joi.string().trim().optional(),
        perms: Joi.array().items(Joi.string()).optional(),     // explicit keys override preset
        mask: Joi.number().integer().min(0).optional(),        // optional direct mask
    });

    const {value, error} = schema.validate(body, {abortEarly: false, allowUnknown: true});
    if (error) throw new Error(error.details.map(d => d.message).join(', '));

    const profile: Profile | null = await userService.getProfileById(value.profileId);
    if (!profile) {
        throw new Error("Not Found");
    }

    // Choose mask: explicit mask > perms keys > preset > 0
    let mask = 0;
    if (typeof value.mask === 'number') mask = value.mask;
    else if (Array.isArray(value.perms)) mask = toMask(value.perms);
    else if (value.preset) {
        const presetMask = (getPresetMask(value.preset)) ?? 0;
        mask = presetMask;
    }

    await entityAdminService.addAdmin(entityType, entityId, profile.id, mask, creator?.userId);
    return 'Admin added';
}

export async function updateAdmin(entityType: CombEntityType, entityId: string, profileId: string, body: any) {
    const schema = Joi.object({
        perms: Joi.array().items(Joi.string()).optional(),
        mask: Joi.number().integer().min(0).optional(),
    });

    const {value, error} = schema.validate(body, {abortEarly: false, allowUnknown: true});
    if (error) throw new Error(error.details.map(d => d.message).join(', '));

    const profile: Profile | null = await userService.getProfileById(profileId);
    if (!profile) {
        throw new Error("Not Found");
    }

    let mask = 0;
    if (typeof value.mask === 'number') mask = value.mask;
    else if (Array.isArray(value.perms)) mask = toMask(value.perms);
    else throw new Error('Either mask or perms must be provided');

    await entityAdminService.updateAdminPerms(entityType, entityId, profileId, mask);
    return 'Permissions updated';
}

export async function removeAdmin(entityType: CombEntityType, entityId: string, profileId: string) {
    const profile: Profile | null = await userService.getProfileById(profileId);
    if (!profile) {
        throw new Error("Not Found");
    }

    await entityAdminService.removeAdmin(entityType, entityId, profileId);
    return 'Admin removed';
}

/** Optional: GET /users/search?q=… — simple typeahead */
export async function searchUsers(q: string, limit: number = 10) {
    const query = String(q || '').trim();
    if (!query) return [];
    return await userService.searchUsersSecure(query, limit) ?? [];
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
        return state.ownerId === session.profile.id;
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
): Promise<Map<string, ArchivePresentation>> {
    // LifecycleService also returns the linked events from this snapshot. Include those
    // parents in the permission batch even when the user's overview contains only a child.
    // This lets us offer a restoration link without assuming that child access grants event access.
    // Paged overview reads already own a coherent lifecycle/placement snapshot. Reuse that
    // projection rather than rereading archival after page selection and contradicting it.
    const states = await getArchiveStates(references, snapshot);
    const permissionTargets = new Map<string, ArchiveReference>();
    for (const reference of references) {
        permissionTargets.set(archiveKey(reference), reference);
    }
    for (const state of states.values()) {
        if (state.eventId) {
            const event: ArchiveReference = {type: 'event', id: state.eventId};
            permissionTargets.set(archiveKey(event), event);
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
    const permissions = await evaluateEntities(descriptors, session);

    const presentations = new Map<string, ArchivePresentation>();
    for (const reference of references) {
        const key = archiveKey(reference);
        const state = states.get(key);
        if (!state) {
            // A root deleted after overview discovery must not leave behind an actionable card.
            continue;
        }
        const canManage = mayManageArchival(reference, state, session, permissions.get(key));
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
            const eventKey = archiveKey({type: 'event', id: state.inheritedFromEventId});
            if (permissions.get(eventKey)?.has('ACCESS_VIEW')) {
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
    const allowed = reference.type === 'survey' ? root.ownerId === session.profile?.id
        : permissions.get(archiveKey(reference))?.has('EDIT_META');
    if (!allowed) throw new APIError('Not allowed to manage archival', {}, 403);
}

/** The controller owns the independent-schedule rule; stored dates remain database data. */
function hasIndependentSchedule(reference: ArchiveReference, root: ArchiveTarget): boolean {
    return (reference.type === 'event' || reference.type === 'activity') && root.eventId === null;
}

/** Set only direct archival; retries preserve the first timestamp and never copy it to children. */
export async function archiveEntity(reference: ArchiveReference, body: unknown, session: SessionLike, now: Date = new Date()) {
    validateArchiveBody(Joi.object({}).unknown(false), body);
    requireSessionProfileId(session);
    if (!Number.isFinite(now.getTime())) throw new APIError('Invalid archival time.', {}, 400);
    async function archiveLocked(manager: EntityManager, context: LockedArchiveContext): Promise<void> {
        const root = requireLockedArchiveRoot(context);
        await requireArchiveManagement(reference, root, session, manager);
        if (!root.archivedAt) await lifecycleService.updateLifecycleMetadata(manager, reference, {archivedAt: now});
    }
    await lifecycleService.withLockedArchiveTarget(reference, archiveLocked);
    return (await getArchivePresentations([reference], session)).get(archiveKey(reference));
}

/**
 * A child cannot undo its parent's archive. Restoration also pauses an independent automatic
 * schedule in the same write, so the next sweep cannot immediately undo this explicit action.
 */
export async function restoreEntity(reference: ArchiveReference, body: unknown, session: SessionLike) {
    validateArchiveBody(Joi.object({}).unknown(false), body);
    requireSessionProfileId(session);
    async function restoreLocked(manager: EntityManager, context: LockedArchiveContext): Promise<void> {
        const root = requireLockedArchiveRoot(context);
        await requireArchiveManagement(reference, root, session, manager);
        const parent = root.eventId ? context.parents.get(root.eventId) : null;
        if (parent?.archivedAt) throw new APIError('Restore the linked event before restoring this entity.', {eventId: parent.id}, 409);
        const patch = hasIndependentSchedule(reference, root) ? {archivedAt: null, autoArchivePaused: true} : {archivedAt: null};
        await lifecycleService.updateLifecycleMetadata(manager, reference, patch);
    }
    await lifecycleService.withLockedArchiveTarget(reference, restoreLocked);
    return (await getArchivePresentations([reference], session)).get(archiveKey(reference));
}

/** Explicit pause/resume affects scheduling only, never the current archive timestamp. */
export async function setAutomaticArchival(reference: ArchiveReference, body: unknown, session: SessionLike) {
    const schema = Joi.object<{paused: boolean}>({paused: Joi.boolean().required()}).unknown(false);
    const value = validateArchiveBody(schema, body);
    requireSessionProfileId(session);
    async function setPauseLocked(manager: EntityManager, context: LockedArchiveContext): Promise<void> {
        const root = requireLockedArchiveRoot(context);
        await requireArchiveManagement(reference, root, session, manager);
        if (!hasIndependentSchedule(reference, root)) throw new APIError('Automatic archival is controlled by an event or a standalone activity plan.', {}, 409);
        await lifecycleService.updateLifecycleMetadata(manager, reference, {autoArchivePaused: value.paused});
    }
    await lifecycleService.withLockedArchiveTarget(reference, setPauseLocked);
    return (await getArchivePresentations([reference], session)).get(archiveKey(reference));
}

/** Scheduled orchestration validates one clock/cutoff before the DBAL's conditional batch writes. */
export async function archiveExpiredEntities(afterDays: number, now: Date = new Date()): Promise<number> {
    return lifecycleService.archiveExpiredEntities(automaticArchiveCutoff(afterDays, now), now);
}
