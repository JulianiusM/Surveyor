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
import {archiveKey} from '../modules/archive/policy';
import {Profile} from "../modules/database/entities/user/Profile";
import * as entityAdminService from '../modules/database/services/EntityAdminService';
import * as lifecycleService from '../modules/database/services/EntityLifecycleService';
import * as userService from '../modules/database/services/UserService';
import {APIError} from '../modules/lib/errors';
import {getPresetMask, PERM, toMask} from "../modules/lib/permissions";
import {requireSessionProfileId} from '../modules/lib/session';
import {evaluateEntities} from '../modules/permissionEngine';
import type {ArchivePresentation, ArchiveReference, ArchiveState} from '../types/ArchiveTypes';
import type {EntityDescriptor, PermView, SessionLike} from '../types/PermissionTypes';
import type {Entity} from '../types/UserTypes';
import type {CombEntityType} from "../types/UtilTypes";

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
 * Build card and page capabilities from one lifecycle snapshot and batched permissions.
 * The result is keyed by archiveKey(type + id), so callers can join it to heterogeneous
 * overview cards without making their templates interpret permissions or inherited state.
 * Only requested roots are returned; additional parent events are internal permission inputs.
 */
export async function getArchivePresentations(references: ArchiveReference[], session: SessionLike): Promise<Map<string, ArchivePresentation>> {
    // LifecycleService also returns the linked events from this snapshot. Include those
    // parents in the permission batch even when the user's overview contains only a child.
    // This lets us offer a restoration link without assuming that child access grants event access.
    const states = await lifecycleService.getArchiveStates(references);
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

/**
 * Authenticate and authorize every mutation independently of any previously rendered button.
 * Using the same presentation rule keeps survey ownership and EDIT_META checks in one place.
 * Missing roots are 404, existing roots without authority are 403, and missing sessions are 401.
 * State-dependent conflicts (for example, an archived parent) remain the service's decision
 * inside its transaction, because that state can change after this permission read.
 */
async function requireArchiveManagement(reference: ArchiveReference, session: SessionLike): Promise<void> {
    requireSessionProfileId(session);
    const presentations = await getArchivePresentations([reference], session);
    const state = presentations.get(archiveKey(reference));
    if (!state) {
        throw new APIError('Entity not found', {}, 404);
    }
    if (!state.canManage) {
        throw new APIError('Not allowed to manage archival', {}, 403);
    }
}

/**
 * Archive an authorized root using an empty command body. The service changes lifecycle
 * metadata only; business records, attachments and private placement choices remain intact.
 * Return a fresh presentation after persistence so the response includes updated capabilities.
 */
export async function archiveEntity(reference: ArchiveReference, body: unknown, session: SessionLike) {
    validateArchiveBody(Joi.object({}).unknown(false), body);
    await requireArchiveManagement(reference, session);
    await lifecycleService.archiveEntity(reference);
    const presentations = await getArchivePresentations([reference], session);
    return presentations.get(archiveKey(reference));
}

/**
 * Clear direct archival through the service's parent-state and automation-pause rules.
 * This restores visibility eligibility, not a deleted entity, and does not reset anyone's
 * private hide/show preference. Reload capabilities because restoration can also pause automation.
 */
export async function restoreEntity(reference: ArchiveReference, body: unknown, session: SessionLike) {
    validateArchiveBody(Joi.object({}).unknown(false), body);
    await requireArchiveManagement(reference, session);
    await lifecycleService.restoreEntity(reference);
    const presentations = await getArchivePresentations([reference], session);
    return presentations.get(archiveKey(reference));
}

/**
 * Persist an explicit pause/resume choice instead of a toggle that retries could reverse.
 * This command does not archive or restore immediately. The service rejects roots whose
 * automatic schedule is controlled by their event, or which have no date-based schedule.
 */
export async function setAutomaticArchival(reference: ArchiveReference, body: unknown, session: SessionLike) {
    const schema = Joi.object<{paused: boolean}>({paused: Joi.boolean().required()}).unknown(false);
    const value = validateArchiveBody(schema, body);
    await requireArchiveManagement(reference, session);
    await lifecycleService.setAutomaticArchivalPaused(reference, value.paused);
    const presentations = await getArchivePresentations([reference], session);
    return presentations.get(archiveKey(reference));
}
