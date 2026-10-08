/*
 * Copyright 2026 Julian Malovanij
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy at http://www.apache.org/licenses/LICENSE-2.0
 */

import {createHash} from 'node:crypto';
import type {EntityManager} from 'typeorm';
import type {components} from '../../types/api/v1';
import type {PermissionFieldRule, PermEngineCaches, PermView, SessionLike} from '../../types/PermissionTypes';
import type {LockedArchiveContext} from '../../types/ArchiveTypes';
import type {PackingList} from '../database/entities/packing/PackingList';
import type {Event} from '../database/entities/event/Event';
import type {PackingItem} from '../database/entities/packing/PackingItem';
import type {PackingAssignment} from '../database/entities/packing/PackingAssignment';
import {archiveEntity, restoreEntity, changeEntityEvent, entityPropertyPermission, getAuthorizedEventUrl, getEntityViewAdmission} from '../../controller/entityAdminController';
import {getAccountPageEntry, hasAccountProfile} from '../../controller/userController';
import {getEventLinkOptions} from '../../controller/eventController';
import {ApiProblem} from '../api/problem';
import {validateApiInput} from '../api/transport';
import * as packingService from '../database/services/PackingService';
import * as lifecycleService from '../database/services/EntityLifecycleService';
import * as adminService from '../database/services/EntityAdminService';
import * as userService from '../database/services/UserService';
import {evaluateEntities, evaluateSubject, isOwner} from '../permissionEngine';
import {getInitialPerms, getPermMeta, getPresets} from '../lib/permissions';
import {generateUniqueId, getHeaderImageVersion} from '../lib/util';
import {checkNewImage, removeImage} from '../lib/fileCommons';
import {APIError} from '../lib/errors';
import {safeFrontendReturn} from '../lib/frontendIdentity';

// This is the native packing field policy. Both API generations and capability
// projection consume it; a UI capability is never a separate authorization rule.
const itemFieldPermissions: Record<keyof components['schemas']['PackingItemPatch'], PermissionFieldRule> = {
    title: {permission: 'EDIT_TITLE', parent: 'ITEM_EDIT'},
    description: {permission: 'EDIT_DESC', parent: ['ITEM_EDIT', 'ITEM_EDIT_DESC']},
    maxAssignees: {permission: 'EDIT_CAPACITY', parent: 'ITEM_EDIT'},
    // ITEM_EDIT_META alone has never opened Everyone in packing.
    requiredByAll: {permission: 'EDIT_META', parent: 'ITEM_EDIT'},
};

/** Return a detached declaration so route adapters cannot mutate the authoritative field policy. */
export function packingItemFieldPermission(field: keyof components['schemas']['PackingItemPatch']): PermissionFieldRule {
    const rule = itemFieldPermissions[field];
    return {...rule, ...(Array.isArray(rule.parent) ? {parent: [...rule.parent]} : {})};
}

function mayEditItemField(permissions: PermView, field: keyof components['schemas']['PackingItemPatch']): boolean {
    const rule = itemFieldPermissions[field];
    return permissions.allow(rule.permission, rule.parent);
}

function mayEditMetadataField(permissions: PermView, field: keyof components['schemas']['PackingMetadataPatch']): boolean {
    return permissions.has(entityPropertyPermission('packing', field)!);
}

/** Hash only canonical machine data; localized labels never invalidate a metadata edit token. */
function entityTag(scope: string, value: unknown): string {
    return `"${scope}-${createHash('sha256').update(JSON.stringify(value)).digest('base64url')}"`;
}

/**
 * Capture field values as hashes, without counters or a stored edit history. Tokens contain no
 * submitted values or private record identifiers. Their scope also binds them to this resource
 * and actor; fresh authorization is still mandatory before any comparison is inspected.
 */
function comparisonToken(scope: string, id: string, session: SessionLike, values: Record<string, unknown>): string {
    const context = entityTag(scope, {id, actor: actorId(session)});
    const fields = Object.fromEntries(Object.entries(values).map(([field, value]) => [field, entityTag('field', value)]));
    return `"edit-${Buffer.from(JSON.stringify({context, fields})).toString('base64url')}"`;
}

/** Compare only submitted fields so independent edits can complete without overwriting one another. */
function requireFieldComparison(expected: string | undefined, current: string, fields: string[]): void {
    if (!expected) throw new ApiProblem('PRECONDITION_REQUIRED');
    function decode(token: string): {context: string; fields: Record<string, string>} | null {
        // One operation's token has only a few hashes. Bound decoding before allocating or parsing
        // user input, and accept only our single strong tag rather than wildcard/list/weak tags.
        if (token.length > 4096 || !/^"edit-[A-Za-z0-9_-]+"$/.test(token)) return null;
        try {
            const value = JSON.parse(Buffer.from(token.slice(6, -1), 'base64url').toString('utf8')) as unknown;
            if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
            const data = value as {context?: unknown; fields?: unknown};
            if (typeof data.context !== 'string' || !data.fields || typeof data.fields !== 'object' || Array.isArray(data.fields)) return null;
            const hashes = data.fields as Record<string, unknown>;
            if (!Object.values(hashes).every(hash => typeof hash === 'string' && /^"field-[A-Za-z0-9_-]{43}"$/.test(hash))) return null;
            return {context: data.context, fields: hashes as Record<string, string>};
        } catch { return null; }
    }
    const baseline = decode(expected);
    const latest = decode(current);
    if (!baseline || !latest || baseline.context !== latest.context
        || fields.some(field => !Object.hasOwn(baseline.fields, field) || baseline.fields[field] !== latest.fields[field])) {
        throw new ApiProblem('PRECONDITION_FAILED');
    }
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
async function authorizeRead(manager: EntityManager, list: PackingList, session: SessionLike, caches?: PermEngineCaches): Promise<PermView> {
    actorId(session);
    const permissions = await packingPermissions(manager, list, session, caches);
    if (await getEntityViewAdmission('packing', list, session, manager, permissions) !== 'render') {
        throw new ApiProblem('FORBIDDEN');
    }
    return permissions;
}

/** Field grants and page admission are separate native contracts; use fresh transaction-local evidence for both. */
async function packingPermissions(manager: EntityManager, list: PackingList, session: SessionLike, caches?: PermEngineCaches): Promise<PermView> {
    actorId(session);
    return evaluateSubject({kind: 'entity', entity: {
        entityType: 'packing', entityId: list.id, ownerId: list.ownerId, eventId: list.eventId,
    }}, session, caches, manager);
}

/** Project editable fields individually; an editor never receives a hidden field through a convenient full object. */
function metadataProjection(list: PackingList, permissions: PermView): components['schemas']['PackingMetadata'] {
    const values: components['schemas']['PackingMetadata']['values'] = {};
    const editableFields: components['schemas']['PackingMetadata']['editableFields'] = [];
    if (mayEditMetadataField(permissions, 'title')) {
        editableFields.push('title');
        values.title = list.title;
    }
    if (mayEditMetadataField(permissions, 'description')) {
        editableFields.push('description');
        values.description = list.description ?? null;
    }
    return {
        entityType: 'packing', id: list.id, values, editableFields,
        currentEventId: list.eventId ?? null,
        archived: Boolean(list.archivedAt), inheritedArchived: Boolean(list.event?.archivedAt),
    };
}

/** An edit baseline contains current editable values; unrelated item, lifecycle and ACL edits do not stale it. */
function metadataResult(list: PackingList, permissions: PermView, session: SessionLike) {
    const data = metadataProjection(list, permissions);
    // The additional presentation hashes keep conditional reads correct. Writes compare only
    // title/description, so a different event or archive badge does not invalidate those edits.
    const etag = comparisonToken('packing-meta', list.id, session, {...data.values,
        currentEventId: data.currentEventId, archived: data.archived, inheritedArchived: data.inheritedArchived});
    return {data, etag};
}

/**
 * Read every displayed row/count and authorization input in one snapshot. Only visible names,
 * machine values and action capabilities leave this projection, never ORM entities or account data.
 */
export async function readPackingList(id: string, session: SessionLike) {
    async function readSnapshot(manager: EntityManager, row: PackingList | null) {
        const list = requireList(row);
        // Cache only within this repeatable-read projection. Writes always start their own
        // authorization evaluation after acquiring locks, never reusing a page's permission view.
        const caches: PermEngineCaches = {participant: new Map(), defaults: new Map(), userPerms: new Map()};
        const permissions = await authorizeRead(manager, list, session, caches);

        // Child admission never implies permission to open its parent. Reuse the native URL
        // policy, but evaluate the captured parent inside this projection's existing snapshot.
        let currentEventUrl: string | null = null;
        if (list.event) {
            const parentViews = await evaluateEntities([{
                entityType: 'event', entityId: list.event.id, ownerId: list.event.ownerId, eventId: list.event.id,
            }], session, manager);
            currentEventUrl = getAuthorizedEventUrl(list.event.id, parentViews.get(`event:${list.event.id}`)!);
        }

        // Group persisted assignments once before building rows and native counters.
        const {items, assignments} = await packingService.getPackingSnapshotRows(manager, id);
        const assignmentsByItem = new Map<string, typeof assignments>();
        for (const assignment of assignments) {
            const rows = assignmentsByItem.get(assignment.itemId) ?? [];
            rows.push(assignment);
            assignmentsByItem.set(assignment.itemId, rows);
        }

        const profileId = actorId(session);
        const participants = new Set<string>();
        let open = 0;
        let empty = 0;
        const itemRows: components['schemas']['PackingItemView'][] = [];
        for (const item of items) {
            const itemPermissions = await packingItemPermissions(manager, list, item, session, caches);
            const capabilities = itemCapabilities(itemPermissions);
            const assigned = assignmentsByItem.get(item.id) ?? [];
            if (!item.requiredByAll) {
                for (const assignment of assigned) participants.add(assignment.profileId);
                if (!assigned.length) empty++;
                if (assigned.length < (item.maxAssignees ?? 0)) open++;
            }
            itemRows.push({
                id: item.id, title: item.title, description: item.description ?? null, position: item.pos,
                requiredByAll: Boolean(item.requiredByAll), maxAssignees: item.maxAssignees ?? null,
                assignedCount: assigned.length, selfAssigned: assigned.some(assignment => assignment.profileId === profileId),
                assignees: assigned.map(assignment => ({name: assignment.profile.name || '—', assignmentId: capabilities.removeAssignments ? String(assignment.id) : null})),
                capabilities, editToken: itemEditToken(list, item, session),
            });
        }

        const data: components['schemas']['PackingListView'] = {
            entityType: 'packing', id: list.id, title: list.title, description: list.description ?? null,
            ...headerProjection(list),
            currentEventId: list.eventId ?? null, currentEventUrl,
            archived: Boolean(list.archivedAt), inheritedArchived: Boolean(list.event?.archivedAt),
            capabilities: {editTitle: mayEditMetadataField(permissions, 'title'), editDescription: mayEditMetadataField(permissions, 'description'), selfAssign: permissions.has('ACCESS_VIEW'),
                addItem: permissions.has('ITEM_ADD'), reorder: permissions.has('ITEM_EDIT'), manageSettings: mayOpenSettings(list, permissions, session)},
            orderToken: orderEditToken(list, items, session),
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
 * before comparing touched fields, and the same transaction returns the new current-value baseline.
 */
export async function patchPackingMetadata(id: string, body: unknown, ifMatch: string | undefined, session: SessionLike, compare = true, expectedEventId?: string | null,
    expectedValues?: components['schemas']['PackingMetadataPatch']) {
    const patch = preparePackingMetadataPatch(body);
    async function updateLocked(manager: EntityManager, context: LockedArchiveContext) {
        assertLockedContext(context);
        const list = requireList(await packingService.getPackingSnapshotRoot(manager, id));
        if (expectedEventId !== undefined && (list.eventId ?? null) !== expectedEventId) throw new ApiProblem('ENTITY_CONTEXT_CHANGED');
        const permissions = compare ? await authorizeRead(manager, list, session) : await packingPermissions(manager, list, session);
        // Structural validation already closed the field set. Check every submitted
        // grant before inspecting comparison evidence or performing persistence.
        for (const field of Object.keys(patch) as (keyof typeof patch)[]) {
            if (!mayEditMetadataField(permissions, field)) throw new ApiProblem('FORBIDDEN');
        }

        if (expectedValues) requirePackingFieldValues(list, expectedValues);
        if (compare) requireFieldComparison(ifMatch, metadataResult(list, permissions, session).etag, Object.keys(patch));

        // Persistence and the returned baseline use the same locked transaction.
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
        const assignedCount = await applyPackingMembership(manager, item, existing, count, assigned, profileId);
        return {listId, itemId, selfAssigned: assigned, assignedCount, maxAssignees: item.maxAssignees ?? null};
    }
    return lifecycleService.withLockedArchiveTarget({type: 'packing', id: listId}, assignLocked);
}

/**
 * Both native and versioned commands apply membership while holding the actual item lock.
 * Existing membership is checked before capacity so a successful retry stays valid when full.
 * Historical nullable capacity remains unrestricted, and Everyone never changes this policy.
 */
export async function applyPackingMembership(manager: EntityManager, item: PackingItem, existing: PackingAssignment | null,
    count: number, assigned: boolean, profileId: string): Promise<number> {
    if (assigned && !existing) {
        if (typeof item.maxAssignees === 'number' && count >= item.maxAssignees) throw new ApiProblem('PACKING_ITEM_FULL', {itemId: item.id});
        await packingService.assignPackingItem(item.id, profileId, manager);
        return count + 1;
    }
    // Older data can contain duplicate rows; DELETE removes every matching self-membership.
    if (!assigned && existing) return count - await packingService.unassignPackingItem(item.id, profileId, manager);
    return count;
}

/** Persist a sparse approved item patch under the caller's item lock; capacity reductions retain assignments. */
export async function applyPackingItemPatch(manager: EntityManager, item: PackingItem, body: components['schemas']['PackingItemPatch']): Promise<boolean> {
    const changed = Object.entries(body).some(([key, value]) => (item[key as keyof PackingItem] ?? null) !== value);
    if (changed) await packingService.updatePackingItem(item.id, body, manager);
    return changed;
}

/**
 * Native packing forms send their original values instead of a versioned transport token.
 * Compare them inside the same lock as v1. An empty description and a nullable historical
 * description are visually identical in that form, so normalize only that deliberate case.
 */
export function requirePackingFieldValues(current: PackingList | PackingItem,
    expected: components['schemas']['PackingItemPatch'] | components['schemas']['PackingMetadataPatch']): void {
    for (const [field, original] of Object.entries(expected)) {
        if (!['title', 'description', 'maxAssignees', 'requiredByAll'].includes(field)) throw new ApiProblem('VALIDATION_FAILED');
        if ((field === 'title' || field === 'description') && typeof original !== 'string' && !(field === 'description' && original === null)
            || field === 'maxAssignees' && original !== null && (typeof original !== 'number' || !Number.isInteger(original))
            || field === 'requiredByAll' && typeof original !== 'boolean') throw new ApiProblem('VALIDATION_FAILED');
        const value = current[field as keyof typeof current];
        if ((field === 'description' ? value ?? '' : value ?? null) !== (field === 'description' ? original ?? '' : original)) {
            throw new ApiProblem('PRECONDITION_FAILED');
        }
    }
}

/** Item grants retain their own creator/ACL and the deliberately asymmetric parent fallbacks. */
async function packingItemPermissions(manager: EntityManager, list: PackingList, item: PackingItem, session: SessionLike, caches?: PermEngineCaches): Promise<PermView> {
    return evaluateSubject({kind: 'item', item: {entityType: 'packingItem', entityId: item.id, ownerId: item.profileId, eventId: list.eventId},
        parent: {entityType: 'packing', entityId: list.id, ownerId: list.ownerId, eventId: list.eventId}}, session, caches, manager);
}

function itemCapabilities(permissions: PermView): components['schemas']['PackingItemView']['capabilities'] {
    return {
        editTitle: mayEditItemField(permissions, 'title'),
        editDescription: mayEditItemField(permissions, 'description'),
        editCapacity: mayEditItemField(permissions, 'maxAssignees'),
        editRequired: mayEditItemField(permissions, 'requiredByAll'),
        removeItem: permissions.allow('ITEM_DELETE', 'ITEM_DELETE'),
        removeAssignments: permissions.allow('MANAGE_ASSIGNMENTS'),
    };
}

function itemEditToken(list: PackingList, item: PackingItem, session: SessionLike): string {
    return comparisonToken('packing-item', `${list.id}:${item.id}`, session, {title: item.title, description: item.description ?? null,
        maxAssignees: item.maxAssignees ?? null, requiredByAll: Boolean(item.requiredByAll)});
}

function orderEditToken(list: PackingList, items: PackingItem[], session: SessionLike): string {
    return entityTag('packing-order', {id: list.id, items: items.map(item => [item.id, item.pos]), actor: actorId(session)});
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
    // Settings expose profile-owned deletion independently of the account-only duplicate action.
    return permissions.any('EDIT_TITLE', 'EDIT_DESC', 'EDIT_META', 'MANAGE_PERMISSIONS')
        || isOwner(session, list.ownerId)
        || Boolean(session.auth?.user && permissions.has('DATA_DUPLICATE'));
}

/** Parent/root locks serialize management with relinking. DBAL owns locks; this controller owns every decision. */
async function withPackingManagement<T>(id: string, session: SessionLike,
    operation: (manager: EntityManager, list: PackingList, permissions: PermView) => Promise<T>, requireReadAdmission = true): Promise<T> {
    async function manageLocked(manager: EntityManager, context: LockedArchiveContext): Promise<T> {
        assertLockedContext(context);
        const list = requireList(await packingService.getPackingSnapshotRoot(manager, id));
        // Native mutation routes admit exact grants independently of page access. Preserve that
        // deliberate exception while sharing every locked scope and field check with v1.
        const permissions = requireReadAdmission ? await authorizeRead(manager, list, session) : await packingPermissions(manager, list, session);
        return operation(manager, list, permissions);
    }
    return lifecycleService.withLockedArchiveTarget({type: 'packing', id}, manageLocked);
}

function completeDefaults(defaults: Partial<components['schemas']['PermissionDefaults']>): components['schemas']['PermissionDefaults'] {
    return {public: defaults.public ?? 0, guest: defaults.guest ?? 0, authenticated: defaults.authenticated ?? 0, participant: defaults.participant ?? 0};
}

function permissionDefinitions() {
    return {permissions: getPermMeta().map(({key, bit}) => ({key, bit})), presets: getPresets().map(({key, mask}) => ({key, mask}))};
}

/** Creation POST requires an account, including when a public/guest duplicate GET supplied its draft. */
export function requirePackingCreation(session: SessionLike): void {
    actorId(session);
    if (!hasAccountProfile(session)) throw new ApiProblem('FORBIDDEN');
}

/**
 * Project native account-only creation admission without requiring a profile at the API
 * transport boundary. Public duplicate GET deliberately remains independently grantable;
 * its later submission asks this operation with the exact duplicate URL as returnTo.
 */
export function readPackingCreateEntry(session: SessionLike, returnTo?: unknown): components['schemas']['PackingCreateEntry'] {
    const target = safeFrontendReturn(returnTo ?? '/frontend-pilot/packing/create');
    const entry = getAccountPageEntry(session, '/frontend-pilot/users/login', target);
    return {entry, context: entry.kind === 'render' ? packingFormContext() : null};
}

/**
 * Read only the current root and shared page policy in one snapshot. Detail admission
 * discloses no protected rows; guest entry discloses exactly the native public title.
 * Both initial HTML and client navigation consume this operation, while subsequent
 * projection/command operations independently authorize their own current snapshot.
 */
export async function readPackingResourceEntry(id: string, view: 'detail' | 'guest', session: SessionLike): Promise<components['schemas']['PackingResourceEntry']> {
    async function readEntry(manager: EntityManager, list: PackingList | null): Promise<components['schemas']['PackingResourceEntry']> {
        if (!list) return {entry: {kind: 'denied', status: 404, messageKey: 'packing.notFound'}, guest: null};
        const detailUrl = `/frontend-pilot/packing/${encodeURIComponent(list.id)}`;
        if (view === 'guest') {
            return session.profile ? {entry: {kind: 'redirect', url: detailUrl, notice: null}, guest: null}
                : {entry: {kind: 'render'}, guest: {id: list.id, title: list.title}};
        }
        const admission = await getEntityViewAdmission('packing', list, session, manager);
        if (admission === 'guest') return {entry: {kind: 'redirect', url: `${detailUrl}/guest`, notice: null}, guest: null};
        if (admission === 'event-registration-required') {
            return {entry: {kind: 'denied', status: 400, messageKey: 'packing.eventRegistrationRequired'}, guest: null};
        }
        return {entry: {kind: 'render'}, guest: null};
    }
    return packingService.withPackingReadSnapshot(id, readEntry);
}

/** Public form definitions contain no resource data; native duplicate GET can use them without an account. */
export function packingFormContext(): components['schemas']['PackingCreateContext'] {
    return {defaults: completeDefaults(getInitialPerms('packing')), ...permissionDefinitions()};
}

export function readPackingCreateContext(session: SessionLike): components['schemas']['PackingCreateContext'] {
    requirePackingCreation(session);
    return packingFormContext();
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

/** Native duplicate GET depends only on DATA_DUPLICATE, independently of detail admission and creation POST. */
export async function readPackingDuplicate(id: string, session: SessionLike): Promise<components['schemas']['PackingDuplicate']> {
    return packingService.withPackingReadSnapshot(id, async function readDuplicate(manager, row) {
        const list = requireList(row);
        const permissions = await evaluateSubject({kind: 'entity', entity: {
            entityType: 'packing', entityId: list.id, ownerId: list.ownerId, eventId: list.eventId,
        }}, session, undefined, manager);
        if (!permissions.has('DATA_DUPLICATE')) throw new ApiProblem('FORBIDDEN');

        // Copy the native form surface only. Assignments, administrators, header,
        // archive state and event membership remain associated with the source.
        const {items} = await packingService.getPackingSnapshotRows(manager, id);
        return {title: list.title, description: list.description ?? null, eventId: null,
            items: items.map(item => ({title: item.title, description: item.description ?? null, maxAssignees: item.maxAssignees ?? null, requiredByAll: Boolean(item.requiredByAll)})),
            defaultPermissions: completeDefaults(await adminService.getDefaultPerms('packing', id, manager)),
            formContext: packingFormContext()};
    });
}

/** Project settings separately, omitting the administrator matrix entirely without MANAGE_PERMISSIONS. */
export async function readPackingSettings(id: string, session: SessionLike): Promise<components['schemas']['PackingSettings']> {
    return packingService.withPackingReadSnapshot(id, async function readSettings(manager, row) {
        const list = requireList(row);
        const permissions = await authorizeRead(manager, list, session);
        if (!mayOpenSettings(list, permissions, session)) throw new ApiProblem('FORBIDDEN');

        // Linking a parent does not grant access to its identifying fields. Keep the native
        // disclosure policy even when this profile may manage the packing list itself.
        let currentEvent: components['schemas']['PackingCurrentEvent'] | null = null;
        if (list.event) {
            const views = await evaluateEntities([{entityType: 'event', entityId: list.event.id, ownerId: list.event.ownerId, eventId: list.event.id}], session, manager);
            const parentPermissions = views.get(`event:${list.event.id}`)!;
            const disclose = parentPermissions.any('ACCESS_VIEW', 'MANAGE_ASSIGNMENTS');
            currentEvent = {
                id: list.event.id,
                title: disclose ? list.event.title : null,
                startDate: disclose ? list.event.startDate : null,
                endDate: disclose ? list.event.endDate : null,
                url: getAuthorizedEventUrl(list.event.id, parentPermissions),
            };
        }

        // Do not disclose administrator identities or their edit baselines without the
        // corresponding grant. The settings token follows the same visibility boundary.
        let access: components['schemas']['PackingAccess'] | null = null;
        if (permissions.has('MANAGE_PERMISSIONS')) {
            const admins = await adminService.listAdmins('packing', id, manager);
            access = {
                defaults: completeDefaults(await adminService.getDefaultPerms('packing', id, manager)),
                ...permissionDefinitions(),
                admins: admins.map(admin => ({
                    profileId: admin.profileId,
                    name: admin.profile.name,
                    isGuest: Boolean(admin.profile.guestId),
                    mask: admin.perms,
                    editToken: comparisonToken('packing-admin', `${id}:${admin.profileId}`, session, {mask: admin.perms}),
                })),
            };
        }

        return {
            id,
            title: list.title,
            settingsToken: await settingsEditToken(manager, list, session, permissions.has('MANAGE_PERMISSIONS')),
            ...headerProjection(list),
            editableFields: metadataProjection(list, permissions).editableFields,
            capabilities: {
                editHeader: permissions.has('EDIT_META'),
                linkEvent: permissions.has('EDIT_META'),
                managePermissions: permissions.has('MANAGE_PERMISSIONS'),
                duplicate: Boolean(session.auth?.user && permissions.has('DATA_DUPLICATE')),
                // Native deletion is profile-owned; guest owners have the same authority.
                remove: isOwner(session, list.ownerId),
                manageArchive: permissions.has('EDIT_META'),
                archive: permissions.has('EDIT_META') && !list.archivedAt,
                restore: permissions.has('EDIT_META') && Boolean(list.archivedAt) && !list.event?.archivedAt,
            },
            currentEvent,
            archive: {
                direct: Boolean(list.archivedAt),
                inherited: Boolean(list.event?.archivedAt),
                archivedAt: list.archivedAt?.toISOString() ?? null,
                autoArchivePaused: false,
                eventUrl: currentEvent?.url ?? null,
            },
            access,
        };
    });
}

export async function createPackingItem(id: string, body: components['schemas']['PackingNewItem'], session: SessionLike, requireReadAdmission = true): Promise<components['schemas']['PackingCreated']> {
    return withPackingManagement(id, session, async function addItem(manager, list, permissions) {
        if (!permissions.has('ITEM_ADD')) throw new ApiProblem('FORBIDDEN');
        const {items} = await packingService.getPackingSnapshotRows(manager, id);
        const itemId = generateUniqueId();
        await packingService.createPackingItem(id, {...body, id: itemId, pos: Math.max(0, ...items.map(item => item.pos)) + 1}, actorId(session), manager);
        return {id: itemId};
    }, requireReadAdmission);
}

export async function updatePackingItem(id: string, itemId: string, body: components['schemas']['PackingItemPatch'], token: string | undefined, session: SessionLike, compare = true,
    expectedValues?: components['schemas']['PackingItemPatch']): Promise<components['schemas']['MutationResult']> {
    return withPackingManagement(id, session, async function patchItem(manager, list) {
        const {item} = await packingService.getLockedPackingAssignment(manager, itemId, actorId(session));
        if (!item || item.entityId !== id) throw new ApiProblem('NOT_FOUND');
        const permissions = await packingItemPermissions(manager, list, item, session);

        for (const field of Object.keys(body) as (keyof typeof body)[]) {
            if (!mayEditItemField(permissions, field)) throw new ApiProblem('FORBIDDEN');
        }

        if (expectedValues) requirePackingFieldValues(item, expectedValues);
        // Native forms predate conditional API writes. Their adapter still uses these exact
        // locked scope, authorization and persistence checks, while v1 requires a reviewed baseline.
        if (compare) requireFieldComparison(token, itemEditToken(list, item, session), Object.keys(body));

        const changed = await applyPackingItemPatch(manager, item, body);
        return {changed};
    }, compare);
}

export async function deletePackingItem(id: string, itemId: string, session: SessionLike, requireReadAdmission = true): Promise<components['schemas']['MutationResult']> {
    return withPackingManagement(id, session, async function removeItem(manager, list) {
        const {item} = await packingService.getLockedPackingAssignment(manager, itemId, actorId(session));
        if (!item || item.entityId !== id) throw new ApiProblem('NOT_FOUND');
        if (!itemCapabilities(await packingItemPermissions(manager, list, item, session)).removeItem) throw new ApiProblem('FORBIDDEN');
        await packingService.deletePackingItem(itemId, manager);
        return {changed: true};
    }, requireReadAdmission);
}

export async function reorderPackingItems(id: string, body: components['schemas']['PackingItemOrder'], token: string | undefined, session: SessionLike, compare = true): Promise<components['schemas']['MutationResult']> {
    return withPackingManagement(id, session, async function reorder(manager, list, permissions) {
        if (!permissions.has('ITEM_EDIT')) throw new ApiProblem('FORBIDDEN');
        const {items} = await packingService.getPackingSnapshotRows(manager, id);
        if (compare) requireEditToken(token, orderEditToken(list, items, session));
        // Native transport predates edit tokens, but still submits every row once. Verify this
        // after locking so an addition/deletion or a duplicate/foreign ID cannot yield a partial order.
        if (body.itemIds.length !== items.length || new Set(body.itemIds).size !== items.length
            || body.itemIds.some(itemId => !items.some(item => item.id === itemId))) throw new ApiProblem('RESOURCE_CONFLICT');
        const changed = body.itemIds.some((itemId, position) => items[position]?.id !== itemId);
        if (changed) await packingService.reorderPackingItems(id, body.itemIds.map((itemId, position) => ({itemId, position})), manager);
        return {changed};
    }, compare);
}

export async function deletePackingAssignment(id: string, assignmentId: string, session: SessionLike, requireReadAdmission = true): Promise<components['schemas']['MutationResult']> {
    if (!/^[1-9][0-9]*$/.test(assignmentId) || !Number.isSafeInteger(Number(assignmentId))) throw new ApiProblem('VALIDATION_FAILED');
    return withPackingManagement(id, session, async function removeAssignment(manager, list) {
        const assignment = await packingService.getPackingAssignmentById(Number(assignmentId), manager);
        if (!assignment || assignment.item.entityId !== id) throw new ApiProblem('NOT_FOUND');
        // Lock the actual item as self-assignment does; a membership on another root never supplies authority.
        const {item} = await packingService.getLockedPackingAssignment(manager, assignment.itemId, actorId(session));
        if (!item || !itemCapabilities(await packingItemPermissions(manager, list, item, session)).removeAssignments) throw new ApiProblem('FORBIDDEN');
        await packingService.deletePackingAssignment(String(assignmentId), manager);
        return {changed: true};
    }, requireReadAdmission);
}

export async function updatePackingDefaults(id: string, body: components['schemas']['PermissionDefaultsPatch'], session: SessionLike, token?: string, compare = true): Promise<components['schemas']['MutationResult']> {
    return withPackingManagement(id, session, async function saveDefaults(manager, list, permissions) {
        if (!permissions.has('MANAGE_PERMISSIONS')) throw new ApiProblem('FORBIDDEN');
        if (compare) requireFieldComparison(token, await settingsEditToken(manager, list, session, true), Object.keys(body).map(key => `default:${key}`));
        const current = completeDefaults(await adminService.getDefaultPerms('packing', id, manager));
        await adminService.updatePerms('packing', id, body, manager);
        return {changed: Object.keys(body).some(key => body[key as keyof typeof body] !== current[key as keyof typeof current])};
    }, compare);
}

export async function setPackingAdmin(id: string, profileId: string, mask: number | null, session: SessionLike, token?: string): Promise<components['schemas']['MutationResult']> {
    return withPackingManagement(id, session, async function saveAdmin(manager, list, permissions) {
        if (!permissions.has('MANAGE_PERMISSIONS')) throw new ApiProblem('FORBIDDEN');
        if (!await userService.getProfileById(profileId, manager)) throw new ApiProblem('NOT_FOUND');
        const admins = await adminService.listAdmins('packing', id, manager);
        const current = admins.find(admin => admin.profileId === profileId);
        // Existing profiles have their own baseline. A new grant uses the settings token's
        // absent marker; discovering a grant created by another client requires explicit review.
        if (current) requireFieldComparison(token, comparisonToken('packing-admin', `${id}:${profileId}`, session, {mask: current.perms}), ['mask']);
        else requireFieldComparison(token, await settingsEditToken(manager, list, session, true), ['newAdmin']);
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
            requireFieldComparison(token, await settingsEditToken(manager, current, session), ['eventId']);
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
export async function setPackingHeader(id: string, file: Express.Multer.File | undefined, session: SessionLike, token?: string, compare = true): Promise<components['schemas']['MutationResult']> {
    checkNewImage(file);
    const result = await withPackingManagement(id, session, async function replaceHeader(manager, list, permissions) {
        if (!permissions.has('EDIT_META')) throw new ApiProblem('FORBIDDEN');
        if (compare) requireFieldComparison(token, await settingsEditToken(manager, list, session), ['header']);
        await packingService.updateHeaderImage(id, file?.path ?? null, manager);
        return {oldPath: list.headerImg, changed: Boolean(file || list.headerImg)};
    }, compare);
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
    actorId(session);
    const oldPath = await packingService.withPackingListLock(id, async function removeList(manager, row) {
        const list = requireList(row);
        // Check the locked current owner, independently of account-only creation admission
        // and administrator grants. Profile ownership also includes an established guest.
        if (!isOwner(session, list.ownerId)) throw new ApiProblem('FORBIDDEN');
        await packingService.deletePackingList(id, manager);
        return list.headerImg;
    });
    if (oldPath) removeImage(oldPath);
    return {changed: true};
}

/** Setup baselines compare fields independently; administrator rows carry their own bounded mask token. */
async function settingsEditToken(manager: EntityManager, list: PackingList, session: SessionLike, includeAccess = false): Promise<string> {
    // A field hash of a small permission mask is guessable. Omit access baselines entirely
    // unless this actor may view/manage them, just as the visible administrator matrix is omitted.
    const defaults = includeAccess ? completeDefaults(await adminService.getDefaultPerms('packing', list.id, manager)) : {};
    return comparisonToken('packing-settings', list.id, session, {
        ...Object.fromEntries(Object.entries(defaults).map(([audience, value]) => [`default:${audience}`, value])),
        header: list.headerImg ?? null, eventId: list.eventId ?? null, ...(includeAccess ? {newAdmin: null} : {}),
    });
}
