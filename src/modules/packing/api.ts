/*
 * Copyright 2026 Julian Malovanij
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy at http://www.apache.org/licenses/LICENSE-2.0
 */

import {createHash} from 'node:crypto';
import type {EntityManager} from 'typeorm';
import type {components, operations} from '../../types/api/v1';
import type {Entity} from '../../types/UserTypes';
import {getOverviewRegion, setPersonalVisibility} from '../../controller/userController';
import type {PermView, SessionLike} from '../../types/PermissionTypes';
import type {LockedArchiveContext} from '../../types/ArchiveTypes';
import type {PackingList} from '../database/entities/packing/PackingList';
import type {Event} from '../database/entities/event/Event';
import type {PackingItem} from '../database/entities/packing/PackingItem';
import {archiveEntity, restoreEntity, changeEntityEvent, getAuthorizedEventUrl} from '../../controller/entityAdminController';
import {getEventLinkOptions} from '../../controller/eventController';
import {ApiProblem} from '../api/problem';
import {validateApiInput} from '../api/transport';
import * as packingService from '../database/services/PackingService';
import * as lifecycleService from '../database/services/EntityLifecycleService';
import * as adminService from '../database/services/EntityAdminService';
import * as userService from '../database/services/UserService';
import {evaluateEntities, evaluateSubject} from '../permissionEngine';
import {getInitialPerms, getPermMeta, getPresets} from '../lib/permissions';
import {generateUniqueId, getHeaderImageVersion} from '../lib/util';
import {checkNewImage, removeImage} from '../lib/fileCommons';
import {APIError} from '../lib/errors';

/** Hash only canonical machine data; localized labels never invalidate a metadata edit token. */
function entityTag(scope: string, value: unknown): string {
    return `"${scope}-${createHash('sha256').update(JSON.stringify(value)).digest('base64url')}"`;
}

/** Require the already admitted actor; this module never re-reads a mutable Express session. */
function actorId(session: SessionLike): string {
    if (!session.profile?.id) throw new ApiProblem('AUTH_REQUIRED');
    return session.profile.id;
}

/** Interpret nullable DB evidence here, keeping missing-resource policy outside the DBAL. */
function requireList(list: PackingList | null): PackingList {
    if (!list) throw new ApiProblem('NOT_FOUND');
    return list;
}

/**
 * Evaluate authority in the same transaction as the projection or write. Page admission and
 * assignment permission deliberately differ: standalone/profile and event-participant reads
 * remain available even when ACCESS_VIEW has not been granted for an assignment command.
 */
async function authorizeRead(manager: EntityManager, list: PackingList, session: SessionLike): Promise<PermView> {
    const profileId = actorId(session);
    const views = await evaluateEntities([{
        entityType: 'packing', entityId: list.id, ownerId: list.ownerId, eventId: list.eventId,
    }], session, manager);
    const permissions = views.get(`packing:${list.id}`)!;
    if (list.eventId && !permissions.has('ACCESS_VIEW') && list.event?.ownerId !== profileId
        && !await packingService.getPackingEventRegistration(manager, list.eventId, profileId)) {
        throw new ApiProblem('FORBIDDEN');
    }
    return permissions;
}

/** Project editable fields individually; an editor never receives a hidden field through a convenient full object. */
function metadataProjection(list: PackingList, permissions: PermView): components['schemas']['PackingMetadata'] {
    const values: components['schemas']['PackingMetadata']['values'] = {};
    const editableFields: components['schemas']['PackingMetadata']['editableFields'] = [];
    if (permissions.has('EDIT_TITLE')) {
        editableFields.push('title');
        values.title = list.title;
    }
    if (permissions.has('EDIT_DESC')) {
        editableFields.push('description');
        values.description = list.description ?? null;
    }
    return {
        entityType: 'packing', id: list.id, values, editableFields,
        currentEventId: list.eventId ?? null,
        archived: Boolean(list.archivedAt), inheritedArchived: Boolean(list.event?.archivedAt),
    };
}

/** Include authority/context as well as the monotonic metadata counter, without coupling to assignment activity. */
function metadataResult(list: PackingList, permissions: PermView, session: SessionLike) {
    const data = metadataProjection(list, permissions);
    const etag = entityTag('packing-meta', {
        data, revision: list.metadataRevision, profileId: actorId(session), permissions: permissions.mask,
        archivedAt: list.archivedAt, inheritedArchivedAt: list.event?.archivedAt ?? null,
    });
    return {data, etag};
}

/**
 * Read every displayed row/count and authorization input in one snapshot. Only visible names,
 * machine values and action capabilities leave this projection, never ORM entities or account data.
 */
export async function readPackingList(id: string, session: SessionLike) {
    async function readSnapshot(manager: EntityManager, row: PackingList | null) {
        const list = requireList(row);
        const permissions = await authorizeRead(manager, list, session);
        // Child admission never implies permission to open its parent. Reuse the native URL
        // policy, but evaluate the captured parent inside this projection's existing snapshot.
        let currentEventUrl: string | null = null;
        if (list.event) {
            const parentViews = await evaluateEntities([{
                entityType: 'event', entityId: list.event.id, ownerId: list.event.ownerId, eventId: list.event.id,
            }], session, manager);
            currentEventUrl = getAuthorizedEventUrl(list.event.id, parentViews.get(`event:${list.event.id}`)!);
        }
        const {items, assignments} = await packingService.getPackingSnapshotRows(manager, id);
        const profileId = actorId(session);
        const participants = new Set<string>();
        let open = 0;
        let empty = 0;
        const itemRows: components['schemas']['PackingItemView'][] = [];
        for (const item of items) {
            const itemPermissions = await packingItemPermissions(manager, list, item, session);
            const capabilities = itemCapabilities(itemPermissions);
            const assigned = assignments.filter(assignment => assignment.itemId === item.id);
            if (!item.requiredByAll) {
                for (const assignment of assigned) participants.add(assignment.profileId);
                if (!assigned.length) empty++;
                if (assigned.length < (item.maxAssignees ?? 0)) open++;
            }
            itemRows.push({
                id: item.id, title: item.title, description: item.description ?? null, position: item.pos,
                requiredByAll: Boolean(item.requiredByAll), maxAssignees: item.maxAssignees ?? null,
                assignedCount: assigned.length, selfAssigned: assigned.some(assignment => assignment.profileId === profileId),
                assignees: assigned.map(assignment => ({name: assignment.profile.name || '—', assignmentId: capabilities.removeAssignments ? assignment.id : null})),
                capabilities, editToken: itemEditToken(list, item, itemPermissions, session),
            });
        }
        const data: components['schemas']['PackingListView'] = {
            entityType: 'packing', id: list.id, title: list.title, description: list.description ?? null,
            ...headerProjection(list),
            currentEventId: list.eventId ?? null, currentEventUrl,
            archived: Boolean(list.archivedAt), inheritedArchived: Boolean(list.event?.archivedAt),
            capabilities: {editTitle: permissions.has('EDIT_TITLE'), editDescription: permissions.has('EDIT_DESC'), selfAssign: permissions.has('ACCESS_VIEW'),
                addItem: permissions.has('ITEM_ADD'), reorder: permissions.has('ITEM_EDIT'), manageSettings: mayOpenSettings(list, permissions, session)},
            orderToken: orderEditToken(list, items, permissions, session),
            counters: {participants: participants.size, open, empty}, items: itemRows,
        };
        return {data, etag: entityTag('packing-view', {data, profileId})};
    }
    return packingService.withPackingReadSnapshot(id, readSnapshot);
}

/** Read the metadata edit representation independently of changing item counts. */
export async function readPackingMetadata(id: string, session: SessionLike) {
    async function readSnapshot(manager: EntityManager, row: PackingList | null) {
        const list = requireList(row);
        return metadataResult(list, await authorizeRead(manager, list, session), session);
    }
    return packingService.withPackingReadSnapshot(id, readSnapshot);
}

/** Preserve existing trim/clear behavior before applying the one generated structural validator. */
export function preparePackingMetadataPatch(body: unknown): components['schemas']['PackingMetadataPatch'] {
    let normalized = body;
    if (body && typeof body === 'object' && !Array.isArray(body)) {
        const fields = {...body} as Record<string, unknown>;
        // Native/legacy adapters may construct optional keys with undefined. JSON cannot carry
        // those values; treat them as omitted so an empty adapter payload still fails minProperties.
        for (const [key, value] of Object.entries(fields)) if (value === undefined) delete fields[key];
        if (typeof fields.title === 'string') fields.title = fields.title.trim();
        if (fields.description === '') fields.description = null;
        normalized = fields;
    }
    validateApiInput('updatePackingMetadata', normalized);
    return normalized as components['schemas']['PackingMetadataPatch'];
}

/** Reject a parent changed after discovery while the DBAL holds parents before the packing root. */
function assertLockedContext(context: LockedArchiveContext): void {
    if (!context.root) throw new ApiProblem('NOT_FOUND');
    if (context.initialEventId !== context.root.eventId
        || (context.root.eventId && !context.parents.has(context.root.eventId))) {
        throw new ApiProblem('ENTITY_CONTEXT_CHANGED');
    }
}

/**
 * Save a narrow, reviewed metadata patch. Authorization is re-evaluated inside the root transaction
 * before revealing a stale token, and the same transaction advances the revision and returns its baseline.
 */
export async function patchPackingMetadata(id: string, body: unknown, ifMatch: string | undefined, session: SessionLike) {
    const patch = preparePackingMetadataPatch(body);
    async function updateLocked(manager: EntityManager, context: LockedArchiveContext) {
        assertLockedContext(context);
        const list = requireList(await packingService.getPackingSnapshotRoot(manager, id));
        const permissions = await authorizeRead(manager, list, session);
        if (Object.hasOwn(patch, 'title') && !permissions.has('EDIT_TITLE')
            || Object.hasOwn(patch, 'description') && !permissions.has('EDIT_DESC')) throw new ApiProblem('FORBIDDEN');
        if (!ifMatch) throw new ApiProblem('PRECONDITION_REQUIRED');
        // Require the exact single strong tag returned for this actor's machine-only metadata representation.
        if (ifMatch !== metadataResult(list, permissions, session).etag) throw new ApiProblem('PRECONDITION_FAILED');
        await packingService.updatePackingListProperties(id, patch, manager);
        const saved = requireList(await packingService.getPackingSnapshotRoot(manager, id));
        return metadataResult(saved, permissions, session);
    }
    return lifecycleService.withLockedArchiveTarget({type: 'packing', id}, updateLocked);
}

/**
 * Apply desired self-membership for the captured actor. Parent/root/item lock ordering protects
 * relinking and capacity, while a repeated successful assignment remains valid even when now full.
 */
export async function setPackingSelfAssignment(listId: string, itemId: string, assigned: boolean, session: SessionLike): Promise<components['schemas']['PackingAssignmentResult']> {
    const profileId = actorId(session);
    async function assignLocked(manager: EntityManager, context: LockedArchiveContext) {
        assertLockedContext(context);
        const list = requireList(await packingService.getPackingSnapshotRoot(manager, listId));
        const permissions = await authorizeRead(manager, list, session);
        if (!permissions.has('ACCESS_VIEW')) throw new ApiProblem('FORBIDDEN');
        const {item, existing, count} = await packingService.getLockedPackingAssignment(manager, itemId, profileId);
        if (!item || item.entityId !== listId) throw new ApiProblem('NOT_FOUND');
        let assignedCount = count;
        if (assigned && !existing) {
            if (typeof item.maxAssignees === 'number' && count >= item.maxAssignees) throw new ApiProblem('PACKING_ITEM_FULL', {itemId});
            await packingService.assignPackingItem(itemId, profileId, manager);
            assignedCount++;
        } else if (!assigned && existing) {
            // Older data can contain duplicate rows; DELETE removes all matching self-memberships.
            assignedCount -= await packingService.unassignPackingItem(itemId, profileId, manager);
        }
        return {listId, itemId, selfAssigned: assigned, assignedCount, maxAssignees: item.maxAssignees ?? null};
    }
    return lifecycleService.withLockedArchiveTarget({type: 'packing', id: listId}, assignLocked);
}

/** Item grants retain their own creator/ACL and the deliberately asymmetric parent fallbacks. */
async function packingItemPermissions(manager: EntityManager, list: PackingList, item: PackingItem, session: SessionLike): Promise<PermView> {
    return evaluateSubject({kind: 'item', item: {entityType: 'packingItem', entityId: item.id, ownerId: item.profileId, eventId: list.eventId},
        parent: {entityType: 'packing', entityId: list.id, ownerId: list.ownerId, eventId: list.eventId}}, session, undefined, manager);
}

function itemCapabilities(permissions: PermView): components['schemas']['PackingItemView']['capabilities'] {
    return {
        editTitle: permissions.allow('EDIT_TITLE', 'ITEM_EDIT'),
        editDescription: permissions.allow('EDIT_DESC', ['ITEM_EDIT', 'ITEM_EDIT_DESC']),
        editCapacity: permissions.allow('EDIT_CAPACITY', 'ITEM_EDIT'),
        // ITEM_EDIT_META alone has never opened Everyone in packing; preserve that exception.
        editRequired: permissions.allow('EDIT_META', 'ITEM_EDIT'),
        removeItem: permissions.allow('ITEM_DELETE', 'ITEM_DELETE'),
        removeAssignments: permissions.allow('MANAGE_ASSIGNMENTS'),
    };
}

function itemEditToken(list: PackingList, item: PackingItem, permissions: PermView, session: SessionLike): string {
    return entityTag('packing-item', {id: item.id, title: item.title, description: item.description ?? null,
        maxAssignees: item.maxAssignees ?? null, requiredByAll: Boolean(item.requiredByAll),
        context: list.metadataRevision, eventId: list.eventId, actor: actorId(session), mask: permissions.mask, parentMask: permissions.parentMask});
}

function orderEditToken(list: PackingList, items: PackingItem[], permissions: PermView, session: SessionLike): string {
    return entityTag('packing-order', {items: items.map(item => [item.id, item.pos]), eventId: list.eventId,
        context: list.metadataRevision, actor: actorId(session), canReorder: permissions.has('ITEM_EDIT')});
}

function requireEditToken(expected: string | undefined, current: string): void {
    if (!expected) throw new ApiProblem('PRECONDITION_REQUIRED');
    if (expected !== current) throw new ApiProblem('PRECONDITION_FAILED');
}

function headerProjection(list: PackingList) {
    return {headerUrl: list.headerImg ? `/api/v1/packing-lists/${encodeURIComponent(list.id)}/header` : null,
        headerVersion: getHeaderImageVersion(list.headerImg)};
}

function mayOpenSettings(list: PackingList, permissions: PermView, session: SessionLike): boolean {
    return permissions.any('EDIT_TITLE', 'EDIT_DESC', 'EDIT_META', 'MANAGE_PERMISSIONS')
        || Boolean(session.auth?.user && (permissions.has('DATA_DUPLICATE') || list.ownerId === session.profile?.id));
}

/** Parent/root locks serialize management with relinking. DBAL owns locks; this controller owns every decision. */
async function withPackingManagement<T>(id: string, session: SessionLike,
    operation: (manager: EntityManager, list: PackingList, permissions: PermView) => Promise<T>): Promise<T> {
    async function manageLocked(manager: EntityManager, context: LockedArchiveContext): Promise<T> {
        assertLockedContext(context);
        const list = requireList(await packingService.getPackingSnapshotRoot(manager, id));
        return operation(manager, list, await authorizeRead(manager, list, session));
    }
    return lifecycleService.withLockedArchiveTarget({type: 'packing', id}, manageLocked);
}

function completeDefaults(defaults: Partial<components['schemas']['PermissionDefaults']>): components['schemas']['PermissionDefaults'] {
    return {public: defaults.public ?? 0, guest: defaults.guest ?? 0, authenticated: defaults.authenticated ?? 0, participant: defaults.participant ?? 0};
}

function permissionDefinitions() {
    return {permissions: getPermMeta().map(({key, bit}) => ({key, bit})), presets: getPresets().map(({key, mask}) => ({key, mask}))};
}

/** Only a full account may create/duplicate; an administrator guest retains all other granted actions. */
export function requirePackingCreation(session: SessionLike): void {
    actorId(session);
    if (!session.auth?.user) throw new ApiProblem('FORBIDDEN');
}

export function readPackingCreateContext(session: SessionLike): components['schemas']['PackingCreateContext'] {
    requirePackingCreation(session);
    return {defaults: completeDefaults(getInitialPerms('packing')), ...permissionDefinitions()};
}

/** A multipart creation is one command: all rows/defaults commit together, never a half-created image step. */
export async function createPackingList(body: components['schemas']['PackingCreateInput'], file: Express.Multer.File | undefined, session: SessionLike): Promise<components['schemas']['PackingCreated']> {
    requirePackingCreation(session);
    checkNewImage(file);
    async function createLocked(manager: EntityManager, event: Event | null) {
        if (body.eventId && !event) throw new ApiProblem('NOT_FOUND');
        if (event) {
            const views = await evaluateEntities([{entityType: 'event', entityId: event.id, ownerId: event.ownerId, eventId: event.id}], session, manager);
            if (!views.get(`event:${event.id}`)?.has('MANAGE_ASSIGNMENTS')) throw new ApiProblem('FORBIDDEN');
        }
        const id = await packingService.createPackingListTx(actorId(session), body.title, body.description,
            body.items.map((item, pos) => ({...item, id: generateUniqueId(), pos})), body.eventId ?? undefined, file?.path, manager);
        await adminService.updatePerms('packing', id, body.defaultPermissions, manager);
        return {id};
    }
    return packingService.withPackingCreationTransaction(body.eventId, createLocked);
}

export async function readPackingDuplicate(id: string, session: SessionLike): Promise<components['schemas']['PackingDuplicate']> {
    requirePackingCreation(session);
    return packingService.withPackingReadSnapshot(id, async function readDuplicate(manager, row) {
        const list = requireList(row);
        const permissions = await authorizeRead(manager, list, session);
        if (!permissions.has('DATA_DUPLICATE')) throw new ApiProblem('FORBIDDEN');
        const {items} = await packingService.getPackingSnapshotRows(manager, id);
        return {title: list.title, description: list.description ?? null, eventId: null,
            items: items.map(item => ({title: item.title, description: item.description ?? null, maxAssignees: item.maxAssignees ?? null, requiredByAll: Boolean(item.requiredByAll)})),
            defaultPermissions: completeDefaults(await adminService.getDefaultPerms('packing', id, manager))};
    });
}

/** Project settings separately, omitting the administrator matrix entirely without MANAGE_PERMISSIONS. */
export async function readPackingSettings(id: string, session: SessionLike): Promise<components['schemas']['PackingSettings']> {
    return packingService.withPackingReadSnapshot(id, async function readSettings(manager, row) {
        const list = requireList(row);
        const permissions = await authorizeRead(manager, list, session);
        if (!mayOpenSettings(list, permissions, session)) throw new ApiProblem('FORBIDDEN');
        let currentEvent: components['schemas']['PackingCurrentEvent'] | null = null;
        if (list.event) {
            const views = await evaluateEntities([{entityType: 'event', entityId: list.event.id, ownerId: list.event.ownerId, eventId: list.event.id}], session, manager);
            const parentPermissions = views.get(`event:${list.event.id}`)!;
            const disclose = parentPermissions.any('ACCESS_VIEW', 'MANAGE_ASSIGNMENTS');
            currentEvent = {id: list.event.id, title: disclose ? list.event.title : null, startDate: disclose ? list.event.startDate : null,
                endDate: disclose ? list.event.endDate : null, url: getAuthorizedEventUrl(list.event.id, parentPermissions)};
        }
        let access: components['schemas']['PackingAccess'] | null = null;
        if (permissions.has('MANAGE_PERMISSIONS')) {
            const admins = await adminService.listAdmins('packing', id, manager);
            access = {defaults: completeDefaults(await adminService.getDefaultPerms('packing', id, manager)), ...permissionDefinitions(),
                admins: admins.map(admin => ({profileId: admin.profileId, name: admin.profile.name, isGuest: Boolean(admin.profile.guestId), mask: admin.perms}))};
        }
        return {id, title: list.title, settingsToken: await settingsEditToken(manager, list, permissions, session), ...headerProjection(list), editableFields: metadataProjection(list, permissions).editableFields,
            capabilities: {editHeader: permissions.has('EDIT_META'), linkEvent: permissions.has('EDIT_META'), managePermissions: permissions.has('MANAGE_PERMISSIONS'),
                duplicate: Boolean(session.auth?.user && permissions.has('DATA_DUPLICATE')), remove: Boolean(session.auth?.user && list.ownerId === actorId(session)),
                manageArchive: permissions.has('EDIT_META'), archive: permissions.has('EDIT_META') && !list.archivedAt, restore: permissions.has('EDIT_META') && Boolean(list.archivedAt) && !list.event?.archivedAt},
            currentEvent, archive: {direct: Boolean(list.archivedAt), inherited: Boolean(list.event?.archivedAt), archivedAt: list.archivedAt?.toISOString() ?? null,
                autoArchivePaused: false, eventUrl: currentEvent?.url ?? null}, access};
    });
}

export async function createPackingItem(id: string, body: components['schemas']['PackingNewItem'], session: SessionLike): Promise<components['schemas']['PackingCreated']> {
    return withPackingManagement(id, session, async function addItem(manager, list, permissions) {
        if (!permissions.has('ITEM_ADD')) throw new ApiProblem('FORBIDDEN');
        const {items} = await packingService.getPackingSnapshotRows(manager, id);
        const itemId = generateUniqueId();
        await packingService.createPackingItem(id, {...body, id: itemId, pos: Math.max(0, ...items.map(item => item.pos)) + 1}, actorId(session), manager);
        return {id: itemId};
    });
}

export async function updatePackingItem(id: string, itemId: string, body: components['schemas']['PackingItemPatch'], token: string | undefined, session: SessionLike): Promise<components['schemas']['MutationResult']> {
    return withPackingManagement(id, session, async function patchItem(manager, list) {
        const {item} = await packingService.getLockedPackingAssignment(manager, itemId, actorId(session));
        if (!item || item.entityId !== id) throw new ApiProblem('NOT_FOUND');
        const permissions = await packingItemPermissions(manager, list, item, session);
        const capabilities = itemCapabilities(permissions);
        if (Object.hasOwn(body, 'title') && !capabilities.editTitle || Object.hasOwn(body, 'description') && !capabilities.editDescription
            || Object.hasOwn(body, 'maxAssignees') && !capabilities.editCapacity || Object.hasOwn(body, 'requiredByAll') && !capabilities.editRequired) throw new ApiProblem('FORBIDDEN');
        requireEditToken(token, itemEditToken(list, item, permissions, session));
        const changed = Object.entries(body).some(([key, value]) => item[key as keyof PackingItem] !== value);
        if (changed) await packingService.updatePackingItem(itemId, body, manager);
        return {changed};
    });
}

export async function deletePackingItem(id: string, itemId: string, session: SessionLike): Promise<components['schemas']['MutationResult']> {
    return withPackingManagement(id, session, async function removeItem(manager, list) {
        const {item} = await packingService.getLockedPackingAssignment(manager, itemId, actorId(session));
        if (!item || item.entityId !== id) throw new ApiProblem('NOT_FOUND');
        if (!itemCapabilities(await packingItemPermissions(manager, list, item, session)).removeItem) throw new ApiProblem('FORBIDDEN');
        await packingService.deletePackingItem(itemId, manager);
        return {changed: true};
    });
}

export async function reorderPackingItems(id: string, body: components['schemas']['PackingItemOrder'], token: string | undefined, session: SessionLike): Promise<components['schemas']['MutationResult']> {
    return withPackingManagement(id, session, async function reorder(manager, list, permissions) {
        if (!permissions.has('ITEM_EDIT')) throw new ApiProblem('FORBIDDEN');
        const {items} = await packingService.getPackingSnapshotRows(manager, id);
        requireEditToken(token, orderEditToken(list, items, permissions, session));
        if (body.itemIds.length !== items.length || body.itemIds.some(itemId => !items.some(item => item.id === itemId))) throw new ApiProblem('RESOURCE_CONFLICT');
        const changed = body.itemIds.some((itemId, position) => items[position]?.id !== itemId);
        if (changed) await packingService.reorderPackingItems(id, body.itemIds.map((itemId, position) => ({itemId, position})), manager);
        return {changed};
    });
}

export async function deletePackingAssignment(id: string, assignmentId: number, session: SessionLike): Promise<components['schemas']['MutationResult']> {
    if (!Number.isSafeInteger(assignmentId)) throw new ApiProblem('VALIDATION_FAILED');
    return withPackingManagement(id, session, async function removeAssignment(manager, list) {
        const assignment = await packingService.getPackingAssignmentById(assignmentId, manager);
        if (!assignment || assignment.item.entityId !== id) throw new ApiProblem('NOT_FOUND');
        // Lock the actual item as self-assignment does; a membership on another root never supplies authority.
        const {item} = await packingService.getLockedPackingAssignment(manager, assignment.itemId, actorId(session));
        if (!item || !itemCapabilities(await packingItemPermissions(manager, list, item, session)).removeAssignments) throw new ApiProblem('FORBIDDEN');
        await packingService.deletePackingAssignment(String(assignmentId), manager);
        return {changed: true};
    });
}

export async function updatePackingDefaults(id: string, body: components['schemas']['PermissionDefaults'], session: SessionLike, token?: string): Promise<components['schemas']['MutationResult']> {
    return withPackingManagement(id, session, async function saveDefaults(manager, list, permissions) {
        if (!permissions.has('MANAGE_PERMISSIONS')) throw new ApiProblem('FORBIDDEN');
        requireEditToken(token, await settingsEditToken(manager, list, permissions, session));
        const current = completeDefaults(await adminService.getDefaultPerms('packing', id, manager));
        await adminService.updatePerms('packing', id, body, manager);
        return {changed: Object.keys(body).some(key => body[key as keyof typeof body] !== current[key as keyof typeof current])};
    });
}

export async function setPackingAdmin(id: string, profileId: string, mask: number | null, session: SessionLike, token?: string): Promise<components['schemas']['MutationResult']> {
    return withPackingManagement(id, session, async function saveAdmin(manager, list, permissions) {
        if (!permissions.has('MANAGE_PERMISSIONS')) throw new ApiProblem('FORBIDDEN');
        requireEditToken(token, await settingsEditToken(manager, list, permissions, session));
        if (!await userService.getProfileById(profileId, manager)) throw new ApiProblem('NOT_FOUND');
        const admins = await adminService.listAdmins('packing', id, manager);
        const current = admins.find(admin => admin.profileId === profileId);
        if (mask === null) {
            await adminService.removeAdmin('packing', id, profileId, manager);
            return {changed: Boolean(current)};
        }
        if (current) await adminService.updateAdminPerms('packing', id, profileId, mask, manager);
        else await adminService.addAdmin('packing', id, profileId, mask, session.profile?.userId, manager);
        return {changed: !current || current.perms !== mask};
    });
}

export async function searchPackingProfiles(id: string, query: string, session: SessionLike): Promise<components['schemas']['PackingProfileOptions']> {
    await packingService.withPackingReadSnapshot(id, async function requireManagement(manager, row) {
        if (!(await authorizeRead(manager, requireList(row), session)).has('MANAGE_PERMISSIONS')) throw new ApiProblem('FORBIDDEN');
    });
    // Reuse the native account-only secure search; no guest-token discovery or raw emails enter this DTO.
    return (await userService.searchUsersSecure(query)).map(profile => ({profileId: profile.id, name: profile.name, username: profile.username, isGuest: false}));
}

export async function searchPackingEvents(query: unknown, session: SessionLike): Promise<components['schemas']['PackingEventOptions']> {
    const result = await getEventLinkOptions(query, session);
    function project(event: NonNullable<typeof result.selected>): components['schemas']['PackingEventOption'] {
        return {...event, description: event.description ?? null};
    }
    return {items: result.items.map(project), selected: result.selected ? project(result.selected) : null, nextCursor: result.nextCursor};
}

/** Shared lifecycle/controller owners remain authoritative; adapt only their conflict into the stable contract. */
export async function changePackingEvent(id: string, body: components['schemas']['PackingEventChange'], session: SessionLike, token?: string): Promise<components['schemas']['PackingEventChanged']> {
    const list = requireList(await packingService.getPackingListById(id));
    try {
        async function validateContext(manager: EntityManager): Promise<void> {
            const current = requireList(await packingService.getPackingSnapshotRoot(manager, id));
            const permissions = await authorizeRead(manager, current, session);
            requireEditToken(token, await settingsEditToken(manager, current, permissions, session));
        }
        const result = await changeEntityEvent('packing', list, body, session, undefined, validateContext);
        return {changed: result.changed, canView: !result.redirectUrl};
    } catch (error) {
        if (error instanceof APIError && error.status === 409) throw new ApiProblem('RESOURCE_CONFLICT');
        throw error;
    }
}

export async function setPackingArchived(id: string, archived: boolean, session: SessionLike): Promise<components['schemas']['MutationResult']> {
    try {
        if (archived) await archiveEntity({type: 'packing', id}, {}, session);
        else await restoreEntity({type: 'packing', id}, {}, session);
        return {changed: true};
    } catch (error) {
        if (error instanceof APIError && error.status === 409) {
            // The shared restore owner supplies eventId only for inherited archival; a
            // concurrent parent change is a different recovery action and message.
            throw new ApiProblem(!archived && Object.hasOwn(error.data, 'eventId') ? 'ARCHIVE_INHERITED' : 'ENTITY_CONTEXT_CHANGED');
        }
        throw error;
    }
}

/** File replacement persists under the same root lock; unlinking the previous file occurs only after commit. */
export async function setPackingHeader(id: string, file: Express.Multer.File | undefined, session: SessionLike, token?: string): Promise<components['schemas']['MutationResult']> {
    checkNewImage(file);
    const result = await withPackingManagement(id, session, async function replaceHeader(manager, list, permissions) {
        if (!permissions.has('EDIT_META')) throw new ApiProblem('FORBIDDEN');
        requireEditToken(token, await settingsEditToken(manager, list, permissions, session));
        await packingService.updateHeaderImage(id, file?.path ?? null, manager);
        return {oldPath: list.headerImg, changed: Boolean(file || list.headerImg)};
    });
    if (result.oldPath) removeImage(result.oldPath);
    return {changed: result.changed};
}

export async function readPackingHeaderPath(id: string, session: SessionLike): Promise<string> {
    return packingService.withPackingReadSnapshot(id, async function headerPath(manager, row) {
        const list = requireList(row);
        await authorizeRead(manager, list, session);
        if (!list.headerImg) throw new ApiProblem('NOT_FOUND');
        return list.headerImg;
    });
}

/** Hard deletion stays the simple feature repository operation, separate from archival coordination. */
export async function deletePackingList(id: string, session: SessionLike): Promise<components['schemas']['MutationResult']> {
    requirePackingCreation(session);
    const oldPath = await packingService.withPackingListLock(id, async function removeList(manager, row) {
        const list = requireList(row);
        if (list.ownerId !== actorId(session)) throw new ApiProblem('FORBIDDEN');
        await packingService.deletePackingList(id, manager);
        return list.headerImg;
    });
    if (oldPath) removeImage(oldPath);
    return {changed: true};
}

/** Settings drafts cover the reviewed ACL/image/context together. This token contains no translated presentation values. */
async function settingsEditToken(manager: EntityManager, list: PackingList, permissions: PermView, session: SessionLike): Promise<string> {
    const defaults = completeDefaults(await adminService.getDefaultPerms('packing', list.id, manager));
    const admins = (await adminService.listAdmins('packing', list.id, manager)).map(admin => [admin.profileId, admin.perms]).sort();
    return entityTag('packing-settings', {defaults, admins, header: list.headerImg ?? null, eventId: list.eventId,
        context: list.metadataRevision, actor: actorId(session), permissions: permissions.mask});
}

/** The pilot landing page shares the native mixed overview; packing commands remain feature-owned. */
export async function readPackingOverview(query: operations['getPackingOverview']['parameters']['query'], session: SessionLike): Promise<components['schemas']['PackingOverviewRegion']> {
    const prefix = `${query.collection}_${query.region}_`;
    // The collection badges count every authorized entity type. An absent filter must therefore
    // read those same roots, including an event's non-packing children, rather than silently
    // narrowing the cards while retaining the native all-type counts.
    const navigation: Record<string, string> = {collection: query.collection, region: query.region, [`${prefix}type`]: query.type ?? 'all'};
    for (const key of ['q', 'page', 'childPage'] as const) if (query[key] !== undefined) navigation[`${prefix}${key}`] = query[key];
    if (query.eventId) navigation[`${prefix}event`] = query.eventId;
    const region = await getOverviewRegion(session, navigation);
    function projectCard(card: Entity): components['schemas']['PackingOverviewCard'] {
        const packingCard = card.type === 'packing';
        const ownerActions = packingCard && region.collection === 'owner' && Boolean(session.auth?.user) && card.ownerId === session.profile?.id;
        return {id: card.id, type: card.type, title: card.title, description: card.description ?? null,
            url: packingCard ? `/frontend-pilot/packing/${encodeURIComponent(card.id)}` : card.url,
            headerUrl: card.imageUrl ? packingCard ? `/api/v1/packing-lists/${encodeURIComponent(card.id)}/header` : card.imageUrl : null,
            headerVersion: card.imageVersion ?? null, eventContext: card.eventContext ?? null,
            visibility: card.visibility ?? 'default', overviewHidden: Boolean(card.overviewHidden),
            archived: Boolean(card.archive?.archived), inheritedArchived: Boolean(card.archive?.inheritedFromEventId),
            capabilities: {archive: packingCard && Boolean(card.archive?.canArchive), restore: packingCard && Boolean(card.archive?.canRestore),
                duplicate: ownerActions, remove: ownerActions},
            children: card.overview ? {total: card.overview.total, matching: card.overview.matching} : null};
    }
    return {collection: region.collection, region: region.region, q: region.q, type: region.type, availableTypes: region.availableTypes,
        page: region.page, childPage: region.childPage,
        eventId: region.eventId ?? null, pageSize: region.pageSize, totalEntities: region.totalEntities, hiddenEntities: region.hiddenEntities,
        regionEntities: region.regionEntities, matchingEntities: region.matchingEntities, totalCards: region.totalCards, totalChildren: region.totalChildren,
        hasPrevious: Boolean(region.previousUrl), hasNext: Boolean(region.nextUrl), parent: region.parent ? projectCard(region.parent) : null,
        items: region.items.map(projectCard)};
}

/** Desired personal visibility is naturally retryable and cannot select a different acting profile. */
export async function setPackingVisibility(entityType: components['schemas']['PackingOverviewCard']['type'], id: string, body: components['schemas']['PackingVisibilityInput'], session: SessionLike): Promise<components['schemas']['PackingVisibilityResult']> {
    try {
        const result = await setPersonalVisibility(entityType, id, body, session);
        return {visibility: result.visibility, overviewHidden: result.overviewHidden, archived: Boolean(result.archive?.archived)};
    } catch (error) {
        if (error instanceof APIError && error.status === 409) throw new ApiProblem('ENTITY_CONTEXT_CHANGED');
        throw error;
    }
}
