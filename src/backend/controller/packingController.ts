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

import {Request} from "express";
import type {EntityManager} from 'typeorm';
import {
    readEntityAdministratorBaseline,
    readEntityPermissionDefaults,
    setReviewedEntityAdministrator,
    updateEntityPermissionDefaults,
    permissionDefaultComparisonValues,
    comparisonToken,
    comparisonActor,
    classifyArchiveCommandError,
    requireFieldComparison,
    entityTag,
    completeDefaults,
    permissionDefinitions,
    archiveEntity,
    assertEntityPropertyContext,
    changeEntityEvent,
    entityPropertyPermission,
    entityMethodPermission,
    getArchivePresentations,
    getAuthorizedEventUrl,
    getEntityViewAdmission,
    getEntityResourceEntry,
    getEntityCreationAdmission,
    getEntityCreationContext,
    normalizeBasicProperties,
    projectCurrentEntityEvent,
    projectGuestEntry,
    requireEntityCreation,
    restoreEntity,
} from './entityAdminController';
import {authorizeEventLink, getEventLinkOptions, readEventLinkSelection} from './eventController';
import type {components} from '../../types/api/v1';
import type {PermissionFieldRule, PermEngineCaches, PermView} from '../../types/PermissionTypes';
import type {LockedArchiveContext} from '../../types/ArchiveTypes';
import type {EventLinkOption} from '../../types/EventTypes';
import type {Event} from '../modules/database/entities/event/Event';
import type {PackingAssignment} from '../modules/database/entities/packing/PackingAssignment';
import type {BasicEntityPropertyPatch, EntityMutationOutcome} from '../../types/EntityPropertyTypes';
import Joi from 'joi';
import {PackingItem} from "../modules/database/entities/packing/PackingItem";
import {PackingList} from "../modules/database/entities/packing/PackingList";

import * as packingService from '../modules/database/services/PackingService';
import * as lifecycleService from '../modules/database/services/EntityLifecycleService';
import * as adminService from '../modules/database/services/EntityAdminService';
import * as userService from '../modules/database/services/UserService';
import {ApiProblem} from '../modules/api/problem';
import {APIError, ValidationError} from '../modules/lib/errors';
import {performImageSwap} from "../modules/lib/fileCommons";
import {checkNewImage, removeImage} from '../modules/lib/fileCommons';
import {ENTITIES, generateUniqueId, getHeaderImageVersion} from "../modules/lib/util";
import {saveDefaultPermsFromBody, evaluateEntities, evaluateSubject, isOwner} from "../modules/permissionEngine";
import {SessionLike} from "../../types/PermissionTypes";
import type {EntityBase} from "../../types/UserTypes";
import type {PackingMethod} from '../../types/PackingTypes';
import {archiveKey} from '../modules/archive/policy';

// Template constant for create errors
const CREATE_TEMPLATE = 'packing/packing-create';

/** Decode the established form before its creation hook runs. Keep its
 * JSON item collector, Joi coercion and renderer diagnostics separate from v1's
 * generated request validation; both adapters later use the same creation owner. */
function preprocessCreate(body: any): Omit<Partial<PackingList>, 'items' | 'eventId'> & { items: Partial<PackingItem>[]; eventId: string | null } {
    // Form item controls submit one serialized collection. Decode it before
    // coercion so malformed JSON retains the form's contextual diagnostic.
    let items;
    try {
        items = JSON.parse(body.items || '[]');
    } catch {
        throw new ValidationError(CREATE_TEMPLATE, 'Invalid items JSON', {body});
    }

    // Preserve the direct adapter's Joi coercion and combined field diagnostics;
    // the versioned adapter validates its own machine values before shared creation.
    const itemSchema = Joi.object({
        title: Joi.string().required(),
        description: Joi.string().allow(''),
        maxAssignees: Joi.number().integer().min(1).required(),
        requiredByAll: Joi.boolean().required()
    });

    const schema = Joi.object({
        title: Joi.string().required(),
        description: Joi.string().allow('').optional(),
        items: Joi.array().items(itemSchema).min(1).required(),
        event_id: Joi.string().uuid().allow('').optional(),
    });

    const {error, value} = schema.validate(
        {
            title: body.title,
            description: body.description,
            items,
            event_id: body.event_id,
        },
        {abortEarly: false, allowUnknown: true}
    );
    if (error) {
        const msg = error.details.map((d: any) => d.message).join(', ');
        throw new ValidationError(CREATE_TEMPLATE, msg, {body});
    }

    // Normalize optional form blanks once at this adapter boundary. Persistence
    // receives domain columns rather than the form event_id field name.
    return {
        title: value.title,
        description: value.description || null,
        items: value.items,
        eventId: value.event_id || null,
    };
}

/**
 * Both creation adapters reach this owner. Form decoding retains its original
 * coercion and ignored position spelling; v1 supplies validated machine values and
 * explicit positions. A supplied manager keeps rows inside v1's parent/defaults
 * transaction, while the direct creation hook retains its established transaction.
 */
async function createEntity(
    ownerId: string,
    listData: Omit<Partial<PackingList>, 'items' | 'eventId'> & { items: Partial<PackingItem>[]; eventId?: string | null },
    manager?: EntityManager,
    transport: 'direct' | 'versioned' = 'direct',
) {
    // Fresh row identities and adapter-specific coercion stay in this controller;
    // the existing service persists the complete root/item set atomically.
    const items: Partial<PackingItem>[] = [];
    for (const [position, item] of listData.items.entries()) {
        items.push({
            id: generateUniqueId(),
            title: item.title!,
            description: transport === 'direct' ? item.description || '' : item.description,
            maxAssignees: transport === 'direct' ? Number(item.maxAssignees) || 1 : item.maxAssignees,
            requiredByAll: Boolean(item.requiredByAll),
            // The position/pos mismatch is an inherited defect, preserved
            // as reference behavior. Fixing it requires a separate product decision.
            ...(transport === 'versioned' ? {pos: position} : {}),
        });
    }

    return await packingService.createPackingListTx(
        ownerId,
        listData.title!,
        listData.description!,
        items,
        listData.eventId,
        listData.headerImg,
        manager,
    );
}

/** Direct creation initializes submitted audience grants after its existing row transaction. */
async function afterCreateItems(id: string, data: any) {
    await updateSettings(id, data._body);
}

/** Assemble shared presentation data through its existing reads. Shared counters
 * consume the same row/assignee evidence as v1 without changing read order
 * or making this compatibility hook adopt the versioned snapshot protocol. */
async function fetchForView(list: PackingList, req: Request) {
    const items = await packingService.getPackingItems(list.id);
    const session = req.session;

    const assignments = await packingService.getPackingAssignments(list.id, session.profile!.id);

    const assigneeLists = await packingService.getPackingItemAssignees(list.id);
    return {
        list,
        items,
        assignments,
        assigneeLists,
        counters: packingCounters(items, new Map(Object.entries(assigneeLists)))
    };
}

/**
 * Direct and versioned projections use one counter policy: Everyone rows do not contribute
 * participants/open/empty, nullable capacity is not an open slot, and historical
 * assignees without a profile use their visible-name identity fallback.
 */
function packingCounters(items: readonly (Pick<PackingItem, 'id' | 'requiredByAll' | 'maxAssignees'> & {assignedCount: number})[],
    assignees: ReadonlyMap<string, readonly {profileId?: string | null; name?: string}[]>) {
    const participants = new Set<string | undefined>();
    let open = 0;
    let empty = 0;
    for (const item of items) {
        if (item.requiredByAll) continue;
        for (const assignment of assignees.get(item.id) ?? []) {
            participants.add(assignment.profileId ? `p_${assignment.profileId}` : assignment.name);
        }
        if (item.assignedCount === 0) empty++;
        if (item.assignedCount < (item.maxAssignees ?? 0)) open++;
    }
    return {participants: participants.size, open, empty};
}

/** Duplication copies item content through the existing form hook;
 * assignments and their identities remain attached to the original list. */
async function fetchForDuplicate(list: PackingList, session: Request['session']) {
    return await packingService.getPackingItems(list.id);
}

/** The common hard-delete owner checks profile ownership before the simple
 * repository deletion. A supplied manager retains the versioned caller's lock. */
async function deleteEntity(list: PackingList, session: SessionLike, manager?: EntityManager) {
    // Deletion is profile-owned, including guest owners; an administrator's full
    // permission mask does not transfer ownership. Both transports use this check.
    if (!isOwner(session, list.ownerId)) throw new APIError('Forbidden', {}, 403);
    return await packingService.deletePackingList(list.id, manager);
}

// ---------- API ----------
// Direct controller entry points retain form-shaped input; named versioned
// operations live below and reuse the same business operations.
/** Keep the description collector and success text, while the shared
 * metadata owner checks the captured parent and persists the normalized field. */
async function updateDescription(id: string, body: any, expectedEventId?: string | null) {
    await savePackingMetadata(id, normalizeBasicProperties({description: body.description}), {kind: 'direct', expectedEventId});
    return 'Description updated';
}

/** Direct order payloads retain their partial/non-dense per-row behavior.
 * Versioned callers validate their complete order first and supply their manager. */
async function reorderItems(id: string, order: any, manager?: EntityManager) {
    await packingService.reorderPackingItems(id, order, manager);
    return 'Order saved';
}

/** Preserve Quick Add's title check and numeric fallback. Its admitted
 * profile becomes the item creator through the same owner used by v1 creation. */
async function quickAddItem(list: PackingList, body: any, session: SessionLike) {
    const {title = '', description = '', maxAssignees = '1'} = body;
    if (!title) throw new APIError('Title required', body, 400);

    await addPackingItem(list.id, {
        title,
        description,
        maxAssignees: Number(maxAssignees) || 1,
    }, session.profile!.id, 'direct');
    return 'Item added';
}

/** The description method forwards its raw draft and original errors;
 * sparse item persistence and vanished-row handling stay in the shared owner. */
async function updateItemDescription(itemId: string, body: any) {
    await applyPackingItemPatch(itemId, {description: body.description}, {kind: 'direct', body});
    return 'Description updated';
}

/** Restrict the direct attribute collector to its original three fields.
 * Raw number-control strings reach the shared persistence boundary unchanged. */
async function updateItemAttr(itemId: string, body: any) {
    const {field, value} = body;
    const allowed: Record<string, boolean> = {title: true, description: true, maxAssignees: true};

    if (!allowed[field]) throw new APIError('Invalid field', body, 400);

    await applyPackingItemPatch(itemId, {[field]: value}, {kind: 'direct', body});
    return 'Item updated';
}

/** Everyone is a distinct direct adapter: preserve the raw flag and its
 * successful acknowledgement when the item has disappeared. */
async function updateRequired(itemId: string, body: any) {
    const {flag} = body;
    // This direct action acknowledges a vanished row and forwards its raw flag.
    // The shared operation preserves that outcome through the adapter option.
    await applyPackingItemPatch(itemId, {requiredByAll: flag}, {kind: 'direct', body, acknowledgeMissing: true});
    return 'Requirement updated';
}

/** Direct and versioned removal share the simple assignment deletion. V1 supplies
 * its transaction after authorizing the selected item and root relationship. */
async function deleteAssignment(assignId: string, manager?: EntityManager) {
    await packingService.deletePackingAssignment(assignId, manager);
    return 'Assignment removed';
}

/** Route both audience collectors to the established permission-matrix owner.
 * Form input uses permission keys; only validated v1 commands opt into masks. */
async function updateSettings(id: string, body: any, manager?: EntityManager, inputFormat?: 'permissionKeys' | 'masks') {
    await saveDefaultPermsFromBody(ENTITIES.PACKING, id, body, {manager, inputFormat});
    return 'Settings saved';
}

/** Share hard item deletion without routing it through archival operations.
 * The existing foreign-key cascades, rather than this adapter, remove assignments. */
async function deleteItem(itemId: string, manager?: EntityManager) {
    await packingService.deletePackingItem(itemId, manager);
    return 'Item deleted';
}

/** Image replacement uses the shared file-swap policy and keeps its
 * existing direct persistence callback and literal success response. */
async function updateHeaderImg(entity: EntityBase, file?: Express.Multer.File) {
    await performImageSwap(entity, packingService.updateHeaderImage, file);
    return 'Image updated';
}

/** Direct removal is the same image-swap operation with no new upload. */
async function deleteHeaderImg(entity: EntityBase) {
    await performImageSwap(entity, packingService.updateHeaderImage);
    return 'Image deleted';
}

/** Bind the direct assignment operations to its body-shaped compatibility
 * adapters; versioned desired-membership commands use the shared owner directly. */
function getAssignmentAccessMapping() {
    return {
        assign: assignDirectItem,
        unassign: unassignItem,
    };
}

/** Decode only the established form body; membership policy remains in assignItem. */
async function assignDirectItem(body: any, profileId: string): Promise<void> {
    await assignItem(body.itemId, profileId);
}

/** Direct assignment actions return no payload; v1 alone projects the DBAL deletion count. */
async function unassignItem(body: any, profileId: string): Promise<void> {
    await applyPackingMembership(body.itemId, profileId, false);
}

/**
 * Assignment policy belongs to the controller. Check the locked DB snapshot in this order:
 * absence is a 404, an existing assignment is an idempotent retry, then capacity constrains
 * a new assignment. The DBAL keeps the item lock until the approved insertion commits.
 */
async function assignItem(itemId: string, profileId: string): Promise<void> {
    await packingService.withPackingAssignmentLock(itemId, profileId, async function assignLocked(manager, item, existing, count) {
        if (!item) throw new APIError('Packing item not found', {itemId}, 404);
        await applyPackingMembership(itemId, profileId, true, {manager, item, existing, count}, 'direct');
    });
}

/** Normalize all submitted fields before acquiring a lock; omitted fields remain unchanged. */
async function updateProperties(entity: EntityBase, body: unknown) {
    await savePackingMetadata(entity.id, normalizeBasicProperties(body), {kind: 'direct', expectedEventId: entity.eventId ?? null});
    return 'Properties updated';
}

/**
 * Preserve the shared capacity decision without versioned admission or error policy.
 * The caller checks existing membership first; nullable historical capacity stays unrestricted.
 */
export function hasPackingItemCapacity(item: PackingItem, count: number): boolean {
    return !(typeof item.maxAssignees === 'number' && count >= item.maxAssignees);
}

export default {
    updateProperties,
    preprocessCreate,
    createEntity,
    afterCreateItems,
    fetchForView,
    fetchForDuplicate,
    deleteEntity,

    updateDescription,
    reorderItems,
    quickAddItem,
    updateItemDescription,
    updateItemAttr,
    deleteAssignment,
    updateSettings,
    deleteItem,
    updateRequired,

    updateHeaderImg,
    deleteHeaderImg,

    getAssignmentAccessMapping,
}

/**
 * One method policy drives named controller checks and action
 * capabilities. Preserve method differences: attr accepts description through
 * EDIT_META, its dedicated description action uses EDIT_DESC, and ITEM_EDIT_META
 * does not grant Everyone. Display-only title/capacity grants remain independent.
 * Cross-feature methods consume the existing administration controller's shared
 * declarations, also used by direct callers and the shared relink operation.
 */
const packingMethodPermissions: Record<PackingMethod, PermissionFieldRule> = {
    selfAssignment: {permission: 'ACCESS_VIEW'},
    addItem: {permission: 'ITEM_ADD'},
    reorderItems: {permission: 'ITEM_EDIT'},
    editDescription: {permission: 'EDIT_DESC'},
    editHeader: {permission: entityMethodPermission('editHeader')},
    changeEvent: {permission: entityMethodPermission('changeEvent')},
    managePermissions: {permission: entityMethodPermission('managePermissions')},
    duplicate: {permission: entityMethodPermission('duplicate')},
    editItemTitle: {permission: 'EDIT_META', parent: 'ITEM_EDIT'},
    editItemDescription: {permission: 'EDIT_DESC', parent: ['ITEM_EDIT', 'ITEM_EDIT_DESC']},
    editItemCapacity: {permission: 'EDIT_META', parent: 'ITEM_EDIT'},
    editItemRequired: {permission: 'EDIT_META', parent: 'ITEM_EDIT'},
    editItemAttr: {permission: 'EDIT_META', parent: 'ITEM_EDIT'},
    deleteItem: {permission: 'ITEM_DELETE', parent: 'ITEM_DELETE'},
    deleteAssignment: {permission: 'MANAGE_ASSIGNMENTS'},
};

/** Return an adapter's rule without exposing the mutable controller-owned policy. */
export function packingMethodPermission(method: PackingMethod): PermissionFieldRule {
    const rule = packingMethodPermissions[method];
    return {...rule, ...(Array.isArray(rule.parent) ? {parent: [...rule.parent]} : {})};
}

/** The engine interprets item fallback and ownership; this owner chooses the method. */
function mayPerformPackingMethod(permissions: PermView, method: PackingMethod): boolean {
    const rule = packingMethodPermissions[method];
    return permissions.allow(rule.permission, rule.parent);
}

const itemFieldMethods: Record<keyof components['schemas']['PackingItemPatch'], PackingMethod> = {
    title: 'editItemTitle', description: 'editItemDescription',
    maxAssignees: 'editItemCapacity', requiredByAll: 'editItemRequired',
};

/** Resolve each submitted item field through the central shared method rule,
 * including the distinct description action and its allowed parent fallbacks. */
function mayEditItemField(permissions: PermView, field: keyof components['schemas']['PackingItemPatch']): boolean {
    return mayPerformPackingMethod(permissions, itemFieldMethods[field]);
}

/** Root property fields retain the existing entity-property policy; an item
 * grant or description-only method never broadens the mixed property adapter. */
function mayEditMetadataField(permissions: PermView, field: keyof components['schemas']['PackingMetadataPatch']): boolean {
    return permissions.has(entityPropertyPermission('packing', field)!);
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

/** Field grants and page admission are separate contracts. Public grant-only
 * methods need no fabricated session principal; operations with a profile contract
 * still require actorId explicitly before using the same current method grants. */
async function packingPermissions(manager: EntityManager, list: PackingList, session: SessionLike, caches?: PermEngineCaches): Promise<PermView> {
    comparisonActor(session);
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
    /** Admit the page and assemble every row/counter in this repeatable-read
     * snapshot. Its caches live only for this projection, never a later command. */
    async function readSnapshot(manager: EntityManager, row: PackingList | null) {
        const list = requireList(row);
        // Cache only within this repeatable-read projection. Writes always start their own
        // authorization evaluation after acquiring locks, never reusing a page's permission view.
        const caches: PermEngineCaches = {participant: new Map(), defaults: new Map(), userPerms: new Map()};
        const permissions = await authorizeRead(manager, list, session, caches);

        // Child admission never implies permission to open its parent. Reuse the authorized Event URL
        // policy, but evaluate the captured parent inside this projection's existing snapshot.
        let currentEventUrl: string | null = null;
        if (list.event) {
            const parentViews = await evaluateEntities([{
                entityType: 'event', entityId: list.event.id, ownerId: list.event.ownerId, eventId: list.event.id,
            }], session, manager);
            const eventUrl = getAuthorizedEventUrl(list.event.id, parentViews.get(`event:${list.event.id}`)!);
            // Preserve the shared owner's admission and selected admin/detail path;
            // this versioned projection supplies the corresponding Vue destination.
            currentEventUrl = eventUrl?.replace(/^\/event(?=\/|$)/u, '/event') ?? null;
        }

        // Group persisted assignments once before building rows and shared counters.
        const {items, assignments} = await packingService.getPackingSnapshotRows(manager, id);
        const assignmentsByItem = new Map<string, typeof assignments>();
        for (const assignment of assignments) {
            const rows = assignmentsByItem.get(assignment.itemId) ?? [];
            rows.push(assignment);
            assignmentsByItem.set(assignment.itemId, rows);
        }

        const profileId = actorId(session);
        const itemRows: components['schemas']['PackingItemView'][] = [];
        for (const item of items) {
            const itemPermissions = await packingItemPermissions(manager, list, item, session, caches);
            const capabilities = itemCapabilities(itemPermissions);
            const assigned = assignmentsByItem.get(item.id) ?? [];
            itemRows.push({
                id: item.id,
                title: item.title,
                description: item.description ?? null,
                position: item.pos,
                requiredByAll: Boolean(item.requiredByAll),
                maxAssignees: item.maxAssignees ?? null,
                assignedCount: assigned.length,
                selfAssigned: assigned.some(assignment => assignment.profileId === profileId),

                // Names are visible content; removable handles need their own method grant.
                assignees: assigned.map(assignment => ({name: assignment.profile.name || '—', assignmentId: capabilities.removeAssignments ? String(assignment.id) : null})),

                capabilities,
                editToken: itemEditToken(list, item, session),
            });
        }

        const data: components['schemas']['PackingListView'] = {
            entityType: 'packing',
            id: list.id,
            title: list.title,
            description: list.description ?? null,
            ...headerProjection(list),

            currentEventId: list.eventId ?? null,
            currentEventUrl,
            archived: Boolean(list.archivedAt),
            inheritedArchived: Boolean(list.event?.archivedAt),

            capabilities: {
                editTitle: mayEditMetadataField(permissions, 'title'),
                editDescription: mayEditMetadataField(permissions, 'description'),
                selfAssign: mayPerformPackingMethod(permissions, 'selfAssignment'),
                addItem: mayPerformPackingMethod(permissions, 'addItem'),
                reorder: mayPerformPackingMethod(permissions, 'reorderItems'),
                manageSettings: mayOpenSettings(list, permissions, session)
            },
            orderToken: orderEditToken(list, items, session),
            counters: packingCounters(itemRows, assignmentsByItem),
            items: itemRows,
        };
        return {data, etag: entityTag('packing-view', {data, profileId})};
    }
    return packingService.withPackingReadSnapshot(id, readSnapshot);
}

/** Read the metadata edit representation independently of changing item counts. */
export async function readPackingMetadata(id: string, session: SessionLike) {
    // Mixed root properties include event/archive context and retain their profile boundary.
    actorId(session);

    /** Evaluate independently editable root fields within the read snapshot;
     * a noneditor must additionally satisfy the detail-page admission. */
    async function readSnapshot(manager: EntityManager, row: PackingList | null) {
        const list = requireList(row);
        const permissions = await packingPermissions(manager, list, session);
        // A separately authorized editor needs its own permitted baseline even when
        // the linked detail page is unavailable. A noneditor still needs page admission.
        if (!metadataProjection(list, permissions).editableFields.length) await authorizeRead(manager, list, session);
        return metadataResult(list, permissions, session);
    }
    return packingService.withPackingReadSnapshot(id, readSnapshot);
}

/**
 * Supply an independently authorized item editor's current values without requiring
 * linked detail-page admission. Method policy filters both values and token hashes;
 * no assignments, other item fields, list metadata, parent or ACL projection leaves
 * this snapshot. Existing invalid/missing root scope is checked before item authority.
 */
export async function readPackingItemEditBaseline(id: string, itemId: string, session: SessionLike):
    Promise<components['schemas']['PackingItemEditBaseline']> {
    comparisonActor(session);

    /** Resolve the actual child/root scope before projecting its currently
     * writable values. This snapshot does not query private assignment evidence. */
    async function readSnapshot(manager: EntityManager, row: PackingList | null): Promise<components['schemas']['PackingItemEditBaseline']> {
        const list = requireList(row);
        const item = await packingService.getPackingItemById(itemId, manager);
        if (!item || item.entityId !== id) throw new ApiProblem('NOT_FOUND');
        const permissions = await packingItemPermissions(manager, list, item, session);
        const projection = itemEditProjection(item, permissions);
        if (!projection.editableFields.length) throw new ApiProblem('FORBIDDEN');

        return {id: item.id, ...projection, editToken: itemEditToken(list, item, session, projection.values)};
    }
    return packingService.withPackingReadSnapshot(id, readSnapshot);
}

/** A reorder grant discloses only the compared order. Use the existing method
 * policy and read snapshot; item titles, assignments and parent details remain private. */
export async function readPackingItemOrderBaseline(id: string, session: SessionLike):
    Promise<components['schemas']['PackingOrderEditBaseline']> {
    /** Method authority admits the compared IDs/positions alone. Ordered item
     * reads share this root/grant snapshot without an assignment-roster query. */
    async function readSnapshot(manager: EntityManager, row: PackingList | null): Promise<components['schemas']['PackingOrderEditBaseline']> {
        const list = requireList(row);
        const permissions = await packingPermissions(manager, list, session);
        if (!mayPerformPackingMethod(permissions, 'reorderItems')) throw new ApiProblem('FORBIDDEN');
        const items = await packingService.getPackingSnapshotItems(manager, id);

        return {items: items.map(item => ({id: item.id, position: item.pos})), orderToken: orderEditToken(list, items, session)};
    }
    return packingService.withPackingReadSnapshot(id, readSnapshot);
}

/**
 * Normalize the existing form trim/clear semantics independently of transport errors.
 * Versioned JSON applies trim/clear before its generated validator. The unchanged
 * shared controller retains Joi's distinct optional-value and error semantics.
 */
export function normalizePackingMetadataPatch(body: unknown): unknown {
    let normalized = body;
    if (body && typeof body === 'object' && !Array.isArray(body)) {
        const fields = {...body} as Record<string, unknown>;
        // JSON cannot carry undefined. The v1 input therefore treats these values as omitted;
        // the direct adapter separately preserves its original optional own-key semantics.
        for (const [key, value] of Object.entries(fields)) if (value === undefined) delete fields[key];
        if (typeof fields.title === 'string') fields.title = fields.title.trim();
        if (fields.description === '') fields.description = null;
        normalized = fields;
    }
    return normalized;
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
 * Receive one already normalized, generated-schema-validated command. The HTTP
 * adapter owns structural diagnostics; no second validator runs inside the operation.
 * Form Joi diagnostics remain in their compatibility decoder.
 */
export async function patchPackingMetadata(id: string, patch: components['schemas']['PackingMetadataPatch'], ifMatch: string | undefined, session: SessionLike) {
    actorId(session);
    return savePackingMetadata(id, patch, {kind: 'versioned', ifMatch, session});
}

/** The description method has its own EDIT_DESC grant, independent of
 * principal-only root properties. Its baseline discloses that field alone. */
function descriptionBaseline(list: PackingList, session: SessionLike): components['schemas']['PackingDescriptionBaseline'] {
    const description = list.description ?? null;
    return {description, editToken: comparisonToken('packing-meta', list.id, session, {description})};
}

/** Read only the independently granted description in a coherent snapshot.
 * The returned field token also serves conditional reads after fresh authority. */
export async function readPackingDescription(id: string, session: SessionLike): Promise<components['schemas']['PackingDescriptionBaseline']> {
    async function readDescription(manager: EntityManager, row: PackingList | null) {
        const list = requireList(row);
        const permissions = await packingPermissions(manager, list, session);
        if (!mayPerformPackingMethod(permissions, 'editDescription')) throw new ApiProblem('FORBIDDEN');
        return descriptionBaseline(list, session);
    }
    return packingService.withPackingReadSnapshot(id, readDescription);
}

/** Validated description-only JSON reaches the same metadata persistence owner.
 * Construct the bounded command explicitly so this adapter cannot accidentally
 * forward another root property when a future caller supplies a wider object. */
export async function patchPackingDescription(id: string, patch: components['schemas']['PackingDescriptionPatch'], ifMatch: string | undefined, session: SessionLike) {
    return savePackingMetadata(id, {description: patch.description}, {kind: 'description', ifMatch, session});
}

/**
 * One metadata operation serves both adapters. Direct entry points already apply the shared
 * property/method policy and retain their captured-parent check and root-only lock.
 * Versioned JSON adds current field grants, reviewed values and parent locks. Neither
 * adapter owns an independent property write or changes the other's wire contract.
 */
async function savePackingMetadata(id: string, patch: BasicEntityPropertyPatch, context: {kind: 'direct'; expectedEventId?: string | null}): Promise<void>;
async function savePackingMetadata(
    id: string,
    patch: components['schemas']['PackingMetadataPatch'],
    context: {kind: 'versioned'; ifMatch?: string; session: SessionLike}
): Promise<ReturnType<typeof metadataResult>>;
async function savePackingMetadata(
    id: string,
    patch: components['schemas']['PackingDescriptionPatch'],
    context: {kind: 'description'; ifMatch?: string; session: SessionLike}
): Promise<components['schemas']['PackingDescriptionBaseline']>;
async function savePackingMetadata(id: string, patch: BasicEntityPropertyPatch,
    context: {kind: 'direct'; expectedEventId?: string | null} | {kind: 'versioned' | 'description'; ifMatch?: string; session: SessionLike}): Promise<void | ReturnType<typeof metadataResult> | components['schemas']['PackingDescriptionBaseline']> {
    /** Interpret the caller's locked root once, then persist only its normalized
     * sparse command. Each adapter retains its own admission/diagnostic boundary. */
    async function persistMetadata(manager: EntityManager, row: PackingList | null) {
        let permissions: PermView | undefined;
        if (context.kind === 'direct') {
            assertEntityPropertyContext(row, context.expectedEventId);
        } else {
            const list = requireList(row);
            // Independently granted actions never require detail-page admission.
            // Field grants bound metadata projections; the description adapter
            // carries only its single independently authorized method field.
            permissions = await packingPermissions(manager, list, context.session);
            if (context.kind === 'description') {
                if (!mayPerformPackingMethod(permissions, 'editDescription')) throw new ApiProblem('FORBIDDEN');
                requireFieldComparison(context.ifMatch, descriptionBaseline(list, context.session).editToken, ['description']);
            } else {
                for (const field of Object.keys(patch) as (keyof typeof patch)[]) {
                    if (!mayEditMetadataField(permissions, field)) throw new ApiProblem('FORBIDDEN');
                }
                requireFieldComparison(context.ifMatch, metadataResult(list, permissions, context.session).etag, Object.keys(patch));
            }
        }

        await packingService.updatePackingListProperties(id, patch, manager);
        if (context.kind !== 'direct') {
            const saved = requireList(await packingService.getPackingSnapshotRoot(manager, id));
            if (context.kind === 'description') return descriptionBaseline(saved, context.session);
            return metadataResult(saved, permissions!, context.session);
        }
    }

    if (context.kind === 'direct') return packingService.withPackingListLock(id, persistMetadata);

    /** The DBAL acquired parents before the root. Reject a changed relationship
     * before passing that same transaction into the shared metadata operation. */
    async function updateLocked(manager: EntityManager, locked: LockedArchiveContext) {
        assertLockedContext(locked);
        return persistMetadata(manager, await packingService.getPackingSnapshotRoot(manager, id));
    }
    return lifecycleService.withLockedArchiveTarget({type: 'packing', id}, updateLocked);
}

/**
 * Apply desired self-membership for the captured actor. Parent/root/item lock ordering protects
 * relinking and capacity, while a repeated successful assignment remains valid even when now full.
 */
export async function setPackingSelfAssignment(listId: string, itemId: string, assigned: boolean, session: SessionLike): Promise<components['schemas']['PackingAssignmentResult']> {
    const profileId = actorId(session);
    /** Recheck the captured actor against the locked relationship before reading
     * item/count evidence and applying the common desired-membership policy. */
    async function assignLocked(manager: EntityManager, context: LockedArchiveContext) {
        assertLockedContext(context);
        const list = requireList(await packingService.getPackingSnapshotRoot(manager, listId));
        const permissions = await packingPermissions(manager, list, session);
        if (!mayPerformPackingMethod(permissions, 'selfAssignment')) throw new ApiProblem('FORBIDDEN');

        // Lock the actual child after its current parent/root, then apply the
        // shared idempotency/capacity policy to that same assignment snapshot.
        const {item, existing, count} = await packingService.getLockedPackingAssignment(manager, itemId, profileId);
        if (!item || item.entityId !== listId) throw new ApiProblem('NOT_FOUND');
        const assignedCount = await applyPackingMembership(itemId, profileId, assigned, {manager, item, existing, count}, 'versioned');
        return {listId, itemId, selfAssigned: assigned, assignedCount, maxAssignees: item.maxAssignees ?? null};
    }
    return lifecycleService.withLockedArchiveTarget({type: 'packing', id: listId}, assignLocked);
}

/**
 * Both assignment adapters apply the same membership/capacity decision under their
 * actual item lock. Direct unassignment retains its original unlocked DELETE.
 * Existing membership is checked before capacity so a successful retry stays valid when full.
 * Historical nullable capacity remains unrestricted, and Everyone never changes this policy.
 */
async function applyPackingMembership(itemId: string, profileId: string, assigned: boolean,
    snapshot?: {manager: EntityManager; item: PackingItem; existing: PackingAssignment | null; count: number},
    transport: 'direct' | 'versioned' = 'direct'): Promise<number> {
    if (!assigned) {
        // DELETE removes every historical duplicate membership. The direct adapter
        // ignores the count; v1 projects the count from its current locked snapshot.
        const removed = await packingService.unassignPackingItem(itemId, profileId, snapshot?.manager);
        return (snapshot?.count ?? removed) - removed;
    }

    const {manager, item, existing, count} = snapshot!;
    if (existing) return count;
    if (!hasPackingItemCapacity(item, count)) {
        if (transport === 'versioned') throw new ApiProblem('PACKING_ITEM_FULL', {itemId});
        throw new APIError('This packing item is already fully assigned', {itemId}, 409);
    }
    await packingService.assignPackingItem(itemId, profileId, manager);
    return count + 1;
}

/**
 * Direct and versioned item adapters share sparse persistence and retain assignments when
 * reducing capacity. V1 compares its locked baseline; the direct operation sends the raw scalar and
 * preserves its original vanished-row diagnostic (Everyone acknowledges that case).
 */
async function applyPackingItemPatch(itemId: string, fields: components['schemas']['PackingItemPatch'],
    context: {kind: 'direct'; body: any; acknowledgeMissing?: boolean} | {kind: 'versioned'; manager: EntityManager; item: PackingItem}): Promise<boolean> {
    const changed = context.kind === 'direct'
        || Object.entries(fields).some(([key, value]) => (context.item[key as keyof PackingItem] ?? null) !== value);
    if (changed) {
        if (context.kind === 'direct' && context.acknowledgeMissing) {
            // Direct Everyone forwards even an omitted/raw flag to its direct
            // column update. Preserve that ORM write and automatic metadata;
            // the sparse updater intentionally skips an omitted business field.
            await packingService.togglePackingItemRequiredByAll(itemId, fields.requiredByAll!);
            return true;
        }
        const saved = await packingService.updatePackingItem(itemId, packingItemPersistenceFields(fields),
            context.kind === 'versioned' ? context.manager : undefined);
        if (!saved && context.kind === 'direct' && !context.acknowledgeMissing) {
            throw new APIError('Unknown error while saving', context.body, 500);
        }
    }
    return changed;
}

/**
 * Retain the established number-control transport at the persistence boundary.
 * TypeORM's entity describes the integer after retrieval, while its parameterized update
 * also accepts the raw numeric string. Passing that draft unchanged preserves
 * MariaDB's half-away rounding, signed bounds and configured invalid-input handling; there is no
 * competing JavaScript converter or copied SQL range. The generated closed request
 * shape and locked field authorization have already constrained the supplied fields.
 * Keep this one transport-to-persistence assertion private to the operation owner.
 */
function packingItemPersistenceFields(body: components['schemas']['PackingItemPatch']): Partial<PackingItem> {
    return {...body} as Partial<PackingItem>;
}

/** Item grants retain their own creator/ACL and the deliberately asymmetric parent fallbacks. */
async function packingItemPermissions(manager: EntityManager, list: PackingList, item: PackingItem, session: SessionLike, caches?: PermEngineCaches): Promise<PermView> {
    return evaluateSubject({kind: 'item', item: {entityType: 'packingItem', entityId: item.id, ownerId: item.profileId, eventId: list.eventId},
        parent: {entityType: 'packing', entityId: list.id, ownerId: list.ownerId, eventId: list.eventId}}, session, caches, manager);
}

/** Keep visible rendered controls separate from actual method authority. These
 * flags describe presentation; every command still evaluates current grants. */
function itemCapabilities(permissions: PermView): components['schemas']['PackingItemView']['capabilities'] {
    return {
        // The original rendered controls and the attribute operation deliberately have different
        // grants. Preserve that visible UI without implying command authority.
        showTitleEdit: permissions.allow('EDIT_TITLE', 'ITEM_EDIT'),
        showCapacityEdit: permissions.allow('EDIT_CAPACITY', 'ITEM_EDIT'),
        editTitle: mayEditItemField(permissions, 'title'),
        editDescription: mayEditItemField(permissions, 'description'),
        editCapacity: mayEditItemField(permissions, 'maxAssignees'),
        editRequired: mayEditItemField(permissions, 'requiredByAll'),
        removeItem: mayPerformPackingMethod(permissions, 'deleteItem'),
        removeAssignments: mayPerformPackingMethod(permissions, 'deleteAssignment'),
    };
}

/** Keep canonical persisted edit values in one owner for full-detail and minimal
 * baselines. Numeric drafts remain confined to mutation input/persistence. */
function itemEditValues(item: PackingItem): Required<components['schemas']['PackingItemEditBaseline']['values']> {
    return {
        title: item.title,
        description: item.description ?? null,
        maxAssignees: item.maxAssignees ?? null,
        requiredByAll: Boolean(item.requiredByAll)
    };
}

/** Filtering follows actual command grants, including the shared EDIT_META/EDIT_DESC
 * asymmetry. Display-only title/capacity grants must not reveal an edit baseline. */
function itemEditProjection(item: PackingItem, permissions: PermView):
    Pick<components['schemas']['PackingItemEditBaseline'], 'values' | 'editableFields'> {
    const current = itemEditValues(item);
    const values: components['schemas']['PackingItemEditBaseline']['values'] = {};
    const editableFields: components['schemas']['PackingItemEditBaseline']['editableFields'] = [];
    if (mayEditItemField(permissions, 'title')) {
        editableFields.push('title');
        values.title = current.title;
    }
    if (mayEditItemField(permissions, 'description')) {
        editableFields.push('description');
        values.description = current.description;
    }
    if (mayEditItemField(permissions, 'maxAssignees')) {
        editableFields.push('maxAssignees');
        values.maxAssignees = current.maxAssignees;
    }
    if (mayEditItemField(permissions, 'requiredByAll')) {
        editableFields.push('requiredByAll');
        values.requiredByAll = current.requiredByAll;
    }
    return {values, editableFields};
}

/** Scope and actor stay identical across baseline adapters. A minimal baseline
 * hashes only its permitted projection; writes compare only submitted fields. */
function itemEditToken(list: PackingList, item: PackingItem, session: SessionLike,
    values: components['schemas']['PackingItemEditBaseline']['values'] = itemEditValues(item)): string {
    return comparisonToken('packing-item', `${list.id}:${item.id}`, session, values);
}

/** Order comparisons bind this root, actor and complete stored ID/position set.
 * Unrelated field edits do not stale ordering, but additions/removals/reorders do. */
function orderEditToken(list: PackingList, items: PackingItem[], session: SessionLike): string {
    return entityTag('packing-order', {id: list.id, items: items.map(item => [item.id, item.pos]), actor: comparisonActor(session)});
}

/** Complete-order commands require an exact strong token, unlike sparse field
 * commands that compare only their submitted hashes. Missing and stale differ. */
function requireEditToken(expected: string | undefined, current: string): void {
    if (!expected) throw new ApiProblem('PRECONDITION_REQUIRED');
    if (expected !== current) throw new ApiProblem('PRECONDITION_FAILED');
}

/** Expose an authorized download route and opaque image version, never the
 * persisted storage path. The byte route independently checks read admission. */
function headerProjection(list: PackingList) {
    return {
        headerUrl: list.headerImg ? `/api/v1/packing-lists/${encodeURIComponent(list.id)}/header` : null,
        headerVersion: getHeaderImageVersion(list.headerImg)
    };
}

/** Preserve settings admission, including independent owner deletion and
 * account-only duplication. Opening setup does not grant its private ACL matrix. */
function mayOpenSettings(list: PackingList, permissions: PermView, session: SessionLike): boolean {
    // Screen admission follows its existing field/method owners without copying their grants.
    // Profile-owned deletion remains independent of the account-only duplicate action.
    return mayEditMetadataField(permissions, 'title')
        || mayEditMetadataField(permissions, 'description')
        || mayPerformPackingMethod(permissions, 'editHeader')
        || mayPerformPackingMethod(permissions, 'changeEvent')
        || mayPerformPackingMethod(permissions, 'managePermissions')
        || isOwner(session, list.ownerId)
        || Boolean(session.auth?.user && mayPerformPackingMethod(permissions, 'duplicate'));
}

/** Parent/root locks serialize management with relinking. DBAL owns locks; this controller owns every decision. */
async function withPackingManagement<T>(id: string, session: SessionLike,
    operation: (manager: EntityManager, list: PackingList, permissions: PermView) => Promise<T>): Promise<T> {
    /** A root/parent wait may change both the relationship and effective grants.
     * Every selected command receives current evidence from this same manager. */
    async function manageLocked(manager: EntityManager, context: LockedArchiveContext): Promise<T> {
        assertLockedContext(context);
        const list = requireList(await packingService.getPackingSnapshotRoot(manager, id));
        const permissions = await packingPermissions(manager, list, session);
        return operation(manager, list, permissions);
    }
    return lifecycleService.withLockedArchiveTarget({type: 'packing', id}, manageLocked);
}

/**
 * Project account-only creation admission without requiring a profile at the API
 * transport boundary. Public duplicate GET deliberately remains independently grantable;
 * its later submission asks this operation with the exact duplicate URL as returnTo.
 */
export async function readPackingCreateEntry(session: SessionLike, returnTo?: unknown, eventId?: unknown): Promise<components['schemas']['PackingCreateEntry']> {
    const entry = getEntityCreationAdmission('packing', session, returnTo);
    // An initial URL is context, not a draft selection. Match the form by
    // omitting missing/forbidden events before the client captures its baseline.
    const selected = entry.kind === 'render' ? await readEventLinkSelection(eventId, session) : null;
    const selectedEvent = selected ? projectPackingEventOption(selected) : null;
    // Ordinary reads retain their previous wire shape so a mounted compatible
    // client can still admit and finish an existing draft after folder replacement.
    return {entry, context: entry.kind === 'render' ? getEntityCreationContext('packing') : null,
        ...(eventId !== undefined ? {selectedEvent} : {})};
}

/**
 * Public guest-title reads and registration share this feature-owned projection. They
 * deliberately do not apply the page-entry redirect for an already authenticated actor:
 * that redirect belongs to guest-page admission, not the existing registration command.
 * Missing-row policy remains here while the database service returns nullable evidence.
 */
export async function readPackingGuestEntry(id: string): Promise<components['schemas']['GuestEntry']> {
    return projectGuestEntry(requireList(await packingService.getPackingListById(id)));
}

/**
 * Read only the current root and shared page policy in one snapshot. Detail admission
 * discloses no protected rows; guest entry discloses exactly the public title.
 * Both initial HTML and client navigation consume this operation, while subsequent
 * projection/command operations independently authorize their own current snapshot.
 */
export async function readPackingResourceEntry(id: string, view: 'detail' | 'guest', session: SessionLike): Promise<components['schemas']['PackingResourceEntry']> {
    /** Retain the read snapshot while the common flow evaluates current admission. */
    async function readEntry(manager: EntityManager, list: PackingList | null): Promise<components['schemas']['PackingResourceEntry']> {
        // This manager keeps linked-event membership and grants in the same snapshot.
        return getEntityResourceEntry('packing', list, view, session, {manager});
    }
    return packingService.withPackingReadSnapshot(id, readEntry);
}

/** An initial creation form still requires the admitted account profile;
 * public duplication has its separate access to the same static definitions. */
export function readPackingCreateContext(session: SessionLike): components['schemas']['PackingCreateContext'] {
    requireEntityCreation('packing', session);
    return getEntityCreationContext('packing');
}

/** A multipart creation is one command: all rows/defaults commit together, never a half-created image step. */
export async function createPackingList(
    body: components['schemas']['PackingCreateInput'],
    file: Express.Multer.File | undefined,
    session: SessionLike
): Promise<components['schemas']['PackingCreated']> {
    requireEntityCreation('packing', session);
    checkNewImage(file);
    /** The optional parent is already locked. Apply shared attachment admission
     * before committing the root, initial rows and authored defaults together. */
    async function createLocked(manager: EntityManager, event: Event | null) {
        // Direct submission and versioned commands use the event controller's same attachment
        // policy. The v1 adapter supplies its already locked parent and manager.
        await authorizeEventLink(body.eventId, session, manager, event);
        const id = await createEntity(actorId(session), {...body, headerImg: file?.path}, manager, 'versioned');
        await updateSettings(id, {defaultPerms: body.defaultPermissions}, manager, 'masks');
        return {id};
    }
    return packingService.withPackingCreationTransaction(body.eventId, createLocked);
}

/** Duplicate GET depends only on DATA_DUPLICATE, independently of detail admission and creation POST. */
export async function readPackingDuplicate(id: string, session: SessionLike, eventId?: unknown): Promise<components['schemas']['PackingDuplicate']> {
    return packingService.withPackingReadSnapshot(id, async function readDuplicate(manager, row) {
        const list = requireList(row);
        const permissions = await evaluateSubject({kind: 'entity', entity: {
            entityType: 'packing', entityId: list.id, ownerId: list.ownerId, eventId: list.eventId,
        }}, session, undefined, manager);
        if (!mayPerformPackingMethod(permissions, 'duplicate')) throw new ApiProblem('FORBIDDEN');

        // Copy the form surface only. Assignments, administrators, header,
        // archive state and event membership remain associated with the source.
        const items = await packingService.getPackingSnapshotItems(manager, id);
        const selected = await readEventLinkSelection(eventId, session);
        return {title: list.title, description: list.description ?? null, eventId: null,
            items: items.map(item => ({title: item.title, description: item.description ?? null, maxAssignees: item.maxAssignees ?? null, requiredByAll: Boolean(item.requiredByAll)})),
            defaultPermissions: completeDefaults(await adminService.getDefaultPerms('packing', id, manager)),
            // The source's parent is deliberately excluded. Only a separately
            // admitted URL selection may seed the destination creation draft.
            formContext: getEntityCreationContext('packing'),
            ...(eventId !== undefined ? {selectedEvent: selected ? projectPackingEventOption(selected) : null} : {})};
    });
}

/** Project settings separately, omitting the administrator matrix entirely without MANAGE_PERMISSIONS. */
export async function readPackingSettings(id: string, session: SessionLike): Promise<components['schemas']['PackingSettings']> {
    // Public writers use field baselines above; the full setup projection remains profile-only.
    actorId(session);
    return packingService.withPackingReadSnapshot(id, async function readSettings(manager, row) {
        const list = requireList(row);
        const permissions = await packingPermissions(manager, list, session);
        if (!mayOpenSettings(list, permissions, session)) throw new ApiProblem('FORBIDDEN');

        // Linking a parent does not grant access to its identifying fields. Keep the established
        // disclosure policy even when this profile may manage the packing list itself.
        let currentEvent: components['schemas']['PackingCurrentEvent'] | null = null;
        if (list.event) {
            const views = await evaluateEntities([{entityType: 'event', entityId: list.event.id, ownerId: list.event.ownerId, eventId: list.event.id}], session, manager);
            const parent = projectCurrentEntityEvent(list.event, views.get(`event:${list.event.id}`)!);
            currentEvent = {
                id: parent.id,
                title: parent.title ?? null,
                startDate: parent.startDate ?? null,
                endDate: parent.endDate ?? null,
                url: parent.url?.replace(/^\/event(?=\/|$)/u, '/event') ?? null,
            };
        }

        // Overview cards and v1 settings consume the same lifecycle presentation
        // policy. Both its persisted state and permission inputs use this read's
        // existing snapshot, rather than introducing a second lifecycle authority.
        const reference = {type: 'packing' as const, id};
        const snapshot = await lifecycleService.getArchiveSnapshot([reference], manager);
        const archive = (await getArchivePresentations([reference], session, snapshot, manager)).get(archiveKey(reference))!;

        // Do not disclose administrator identities or their edit baselines without the
        // corresponding grant. The settings token follows the same visibility boundary.
        let access: components['schemas']['PackingAccess'] | null = null;
        if (mayPerformPackingMethod(permissions, 'managePermissions')) {
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
            settingsToken: await settingsEditToken(manager, list, session, mayPerformPackingMethod(permissions, 'managePermissions')),
            ...headerProjection(list),
            editableFields: metadataProjection(list, permissions).editableFields,
            capabilities: {
                editHeader: mayPerformPackingMethod(permissions, 'editHeader'),
                linkEvent: mayPerformPackingMethod(permissions, 'changeEvent'),
                managePermissions: mayPerformPackingMethod(permissions, 'managePermissions'),
                duplicate: Boolean(session.auth?.user && mayPerformPackingMethod(permissions, 'duplicate')),
                // Deletion is profile-owned; guest owners have the same authority.
                remove: isOwner(session, list.ownerId),
                manageArchive: archive.canManage,
                archive: archive.canArchive,
                restore: archive.canRestore,
            },
            currentEvent,
            archive: {
                direct: archive.directArchived,
                inherited: Boolean(archive.inheritedFromEventId),
                archivedAt: list.archivedAt?.toISOString() ?? null,
                autoArchivePaused: archive.autoArchivePaused,
                eventUrl: currentEvent?.url ?? null,
            },
            access,
        };
    });
}

/**
 * Add one item through the common creator/persistence operation. Direct Quick Add
 * retains its ignored position spelling (pos defaults to zero); the v1 adapter's
 * approved order uses the next stored position under its existing root transaction.
 */
async function addPackingItem(id: string, fields: Partial<PackingItem>, profileId: string,
    transport: 'direct' | 'versioned', manager?: EntityManager): Promise<string> {
    const itemId = generateUniqueId();
    const pos = transport === 'versioned' ? Math.max(0, await packingService.getLastPackingItemNumber(id, manager)) + 1 : undefined;
    await packingService.createPackingItem(id, {...fields, id: itemId, ...(pos !== undefined ? {pos} : {})}, profileId, manager);
    return itemId;
}

/** A versioned add has method authority independently of linked detail-page admission. */
export async function createPackingItem(id: string, body: components['schemas']['PackingNewItem'], session: SessionLike): Promise<components['schemas']['PackingCreated']> {
    actorId(session);
    return withPackingManagement(id, session, async function addItem(manager, list, permissions) {
        if (!mayPerformPackingMethod(permissions, 'addItem')) throw new ApiProblem('FORBIDDEN');
        const itemId = await addPackingItem(id, body, actorId(session), 'versioned', manager);
        return {id: itemId};
    });
}

/** Update only submitted fields after root/item locks and fresh method checks.
 * Actor/resource-bound comparisons precede shared sparse persistence; a method
 * grant remains independent of page admission and public actors need no fake profile. */
export async function updatePackingItem(
    id: string,
    itemId: string,
    body: components['schemas']['PackingItemPatch'],
    token: string | undefined,
    session: SessionLike
): Promise<components['schemas']['MutationResult']> {
    return withPackingManagement(id, session, async function patchItem(manager, list) {
        const {item} = await packingService.getLockedPackingAssignment(manager, itemId, session.profile?.id);
        if (!item || item.entityId !== id) throw new ApiProblem('NOT_FOUND');
        const permissions = await packingItemPermissions(manager, list, item, session);

        for (const field of Object.keys(body) as (keyof typeof body)[]) {
            if (!mayEditItemField(permissions, field)) throw new ApiProblem('FORBIDDEN');
        }

        // Compare submitted values within the same freshly permitted projection
        // that supplied the baseline. Public scopes also bind its available fields.
        const projection = itemEditProjection(item, permissions);
        requireFieldComparison(token, itemEditToken(list, item, session, projection.values), Object.keys(body));

        // The shared owner retains numeric-draft and assignment-retention behavior.
        const changed = await applyPackingItemPatch(itemId, body, {kind: 'versioned', manager, item});
        return {changed};
    });
}

/** Scope the locked item to the requested root, then require its actual delete
 * method grant. The shared hard-delete operation retains its existing cascades. */
export async function deletePackingItem(id: string, itemId: string, session: SessionLike): Promise<components['schemas']['MutationResult']> {
    return withPackingManagement(id, session, async function removeItem(manager, list) {
        const {item} = await packingService.getLockedPackingAssignment(manager, itemId, session.profile?.id);
        if (!item || item.entityId !== id) throw new ApiProblem('NOT_FOUND');

        // A root relationship is scope evidence, not the item's delete authority.
        if (!itemCapabilities(await packingItemPermissions(manager, list, item, session)).removeItem) throw new ApiProblem('FORBIDDEN');
        await deleteItem(itemId, manager);
        return {changed: true};
    });
}

/** Review one complete stored order under the exclusive root/item locks.
 * That root lock coordinates creation/removal and direct assignment consumers;
 * the direct reorder adapter retains its independent partial-order contract. */
export async function reorderPackingItems(
    id: string,
    body: components['schemas']['PackingItemOrder'],
    token: string | undefined,
    session: SessionLike
): Promise<components['schemas']['MutationResult']> {
    return withPackingManagement(id, session, async function reorder(manager, list, permissions) {
        if (!mayPerformPackingMethod(permissions, 'reorderItems')) throw new ApiProblem('FORBIDDEN');

        // Retain every compared child lock through the shared per-row writes.
        const items = await packingService.getPackingSnapshotItems(manager, id, true);
        requireEditToken(token, orderEditToken(list, items, session));

        // Versioned ordering requires one complete reviewed row set. The API locks
        // its compared values; direct reorder retains its original partial/non-dense contract.
        const currentItemIds = new Set(items.map(item => item.id));
        if (body.itemIds.length !== items.length || new Set(body.itemIds).size !== items.length
            || body.itemIds.some(itemId => !currentItemIds.has(itemId))) throw new ApiProblem('RESOURCE_CONFLICT');

        // Avoid timestamp-only writes when the reviewed complete order is unchanged.
        const changed = body.itemIds.some((itemId, position) => items[position]?.id !== itemId);
        if (changed) await reorderItems(id, body.itemIds.map((itemId, position) => ({itemId, position})), manager);
        return {changed};
    });
}

/** Resolve an opaque assignment handle within this root before checking its
 * item's removal grant. Public method authority does not expose an assignment
 * roster or create personal membership; deletion uses the existing operation. */
export async function deletePackingAssignment(id: string, assignmentId: string, session: SessionLike): Promise<components['schemas']['MutationResult']> {
    if (!/^[1-9][0-9]*$/.test(assignmentId) || !Number.isSafeInteger(Number(assignmentId))) throw new ApiProblem('VALIDATION_FAILED');
    return withPackingManagement(id, session, async function removeAssignment(manager, list) {
        const assignment = await packingService.getPackingAssignmentById(Number(assignmentId), manager);
        if (!assignment || assignment.item.entityId !== id) throw new ApiProblem('NOT_FOUND');
        // Lock the actual item as self-assignment does; a membership on another root never supplies authority.
        const {item} = await packingService.getLockedPackingAssignment(manager, assignment.itemId, session.profile?.id);
        if (!item || !itemCapabilities(await packingItemPermissions(manager, list, item, session)).removeAssignments) throw new ApiProblem('FORBIDDEN');
        await deleteAssignment(String(assignmentId), manager);
        return {changed: true};
    });
}

/** Compare only submitted audience masks under the root/ACL coordination lock.
 * Recheck management authority before reading evidence, then use the common
 * matrix owner with its explicitly validated numeric-mask collector. */
export async function updatePackingDefaults(
    id: string,
    body: components['schemas']['PermissionDefaultsPatch'],
    session: SessionLike,
    token?: string
): Promise<components['schemas']['MutationResult']> {
    return withPackingManagement(id, session, async function saveDefaults(manager, list, permissions) {
        if (!mayPerformPackingMethod(permissions, 'managePermissions')) throw new ApiProblem('FORBIDDEN');

        // The common owner retains sparse comparison/write semantics in this transaction.
        return updateEntityPermissionDefaults('packing', id, body, session, token, {manager, comparisonId: list.id});
    });
}

/** Independently granted permission management discloses its audience masks alone. */
export async function readPackingDefaultsBaseline(id: string, session: SessionLike): Promise<components['schemas']['PackingDefaultsBaseline']> {
    async function readDefaults(manager: EntityManager, row: PackingList | null) {
        const list = requireList(row);
        if (!mayPerformPackingMethod(await packingPermissions(manager, list, session), 'managePermissions')) throw new ApiProblem('FORBIDDEN');
        return readEntityPermissionDefaults('packing', id, session, {manager, comparisonId: list.id});
    }
    return packingService.withPackingReadSnapshot(id, readDefaults);
}

/** Check method authority before target existence, then disclose only that target's
 * mask/new-grant marker. The same single-target DBAL read serves locked writes. */
export async function readPackingAdminBaseline(id: string, profileId: string, session: SessionLike): Promise<components['schemas']['PackingAdminBaseline']> {
    async function readAdministrator(manager: EntityManager, row: PackingList | null) {
        const list = requireList(row);
        if (!mayPerformPackingMethod(await packingPermissions(manager, list, session), 'managePermissions')) throw new ApiProblem('FORBIDDEN');

        // Profile validation and the minimal grant projection share one controller owner.
        return readEntityAdministratorBaseline('packing', id, profileId, session, {manager, comparisonId: list.id});
    }
    return packingService.withPackingReadSnapshot(id, readAdministrator);
}

/**
 * Create, update or remove one administrator grant after rechecking the admitted actor
 * under the parent/root locks. Existing grants compare their own mask; absent grants
 * compare the settings baseline. A null mask removes the grant and reports a missing
 * grant as an unchanged result. The DBAL owns only the selected persistence operation.
 */
export async function setPackingAdmin(
    id: string,
    profileId: string,
    mask: number | null,
    session: SessionLike,
    token?: string
): Promise<components['schemas']['MutationResult']> {
    return withPackingManagement(id, session, async function saveAdmin(manager, list, permissions) {
        // Require permission before disclosing profile or administrator evidence.
        if (!mayPerformPackingMethod(permissions, 'managePermissions')) throw new ApiProblem('FORBIDDEN');
        // The shared controller validates the profile before reviewing this locked grant.
        return setReviewedEntityAdministrator('packing', id, profileId, mask, session, token, {manager, comparisonId: list.id});
    });
}

/** Authorize scoped administrator discovery before using the secure
 * account search. Its projected options exclude guest credentials and raw emails;
 * the route uses the shared per-IP limiter and admitted API context. */
export async function searchPackingProfiles(id: string, query: string, session: SessionLike): Promise<components['schemas']['PackingProfileOptions']> {
    await packingService.withPackingReadSnapshot(id, async function requireManagement(manager, row) {
        if (!mayPerformPackingMethod(await packingPermissions(manager, requireList(row), session), 'managePermissions')) throw new ApiProblem('FORBIDDEN');
    });
    // Reuse the account-only secure search; no guest-token discovery or raw emails enter this DTO.
    return (await userService.searchUsersSecure(query)).map(profile => ({profileId: profile.id, name: profile.name, username: profile.username, isGuest: false}));
}

/** The shared option omits absent descriptions; the JSON contract represents them
 * explicitly as null. Discovery and initial form admission share that projection. */
function projectPackingEventOption(event: EventLinkOption): components['schemas']['PackingEventOption'] {
    return {...event, description: event.description ?? null};
}

/** Reuse event-picker admission, filtering and selected-value rules.
 * Only the nullable-description spelling is adapted for the JSON contract. */
export async function searchPackingEvents(query: unknown, session: SessionLike): Promise<components['schemas']['PackingEventOptions']> {
    const result = await getEventLinkOptions(query, session);
    return {items: result.items.map(projectPackingEventOption),
        selected: result.selected ? projectPackingEventOption(result.selected) : null, nextCursor: result.nextCursor};
}

/** Shared lifecycle/controller owners remain authoritative; adapt only their conflict into the stable contract. */
export async function changePackingEvent(
    id: string,
    body: components['schemas']['PackingEventChange'],
    session: SessionLike,
    token?: string
): Promise<components['schemas']['PackingEventChanged']> {
    actorId(session);
    const list = requireList(await packingService.getPackingListById(id));
    try {
        /** The shared relink owner already checked source/target method authority;
         * compare only this actor's reviewed association inside those same locks. */
        async function validateContext(manager: EntityManager): Promise<void> {
            const current = requireList(await packingService.getPackingSnapshotRoot(manager, id));
            const permissions = await packingPermissions(manager, current, session);
            requireFieldComparison(token, await settingsEditToken(manager, current, session), ['eventId']);
        }

        /** Use the shared admission owner and this transaction's resulting association for the exact v1 receipt. */
        async function prepareEventCompletion(manager: EntityManager, outcome: EntityMutationOutcome): Promise<components['schemas']['PackingEventChanged']> {
            // Membership and grants must be read on the mutation's connection, so a failed
            // projection still rolls back the relink rather than rejecting a committed write.
            const canView = await getEntityViewAdmission('packing', outcome.root, session, manager) === 'render';
            return {changed: outcome.changed, canView};
        }
        return await changeEntityEvent('packing', list, body, session, undefined, validateContext, {prepare: prepareEventCompletion});
    } catch (error) {
        if (error instanceof APIError && error.status === 409) throw new ApiProblem('RESOURCE_CONFLICT');
        throw error;
    }
}

/**
 * Adapt Packing's archive/restore command to the existing lifecycle controller, keeping
 * its locked authorization and persistence authoritative. The response acknowledges the
 * completed command as the shared workflow does; parent changes and inherited archival
 * retain their separate recovery codes. This operation never performs hard deletion.
 */
export async function setPackingArchived(id: string, archived: boolean, session: SessionLike): Promise<components['schemas']['MutationResult']> {
    actorId(session);

    /** Preserve the existing command acknowledgement, including harmless repeated archive requests. */
    function prepareArchiveCompletion(): components['schemas']['MutationResult'] {
        return {changed: true};
    }
    try {
        // The shared owner performs its original business checks/write and prepares
        // this invariant receipt before commit. Packing needs no later archive DTO.
        const completion = {prepare: prepareArchiveCompletion};
        if (archived) return await archiveEntity({type: 'packing', id}, {}, session, undefined, completion);
        return await restoreEntity({type: 'packing', id}, {}, session, completion);
    } catch (error) {
        throw classifyArchiveCommandError(error, archived);
    }
}

/** File replacement persists under the same root lock; unlinking the previous file occurs only after commit. */
export async function setPackingHeader(
    id: string,
    file: Express.Multer.File | undefined,
    session: SessionLike,
    token?: string
): Promise<components['schemas']['MutationResult']> {
    async function persistApprovedHeader(listId: string, path?: string | null) {
        return withPackingManagement(listId, session, async function replaceHeader(manager, list, permissions) {
            if (!mayPerformPackingMethod(permissions, 'editHeader')) throw new ApiProblem('FORBIDDEN');
            requireFieldComparison(token, headerEditToken(list, session), ['header']);

            await packingService.updateHeaderImage(listId, path, manager);

            // The receipt leaves this callback only after commit. The existing
            // image-swap owner can then remove the confirmed previous file, and
            // retains its file cleanup of this upload when persistence fails.
            return {previousImage: list.headerImg, changed: Boolean(file || list.headerImg)};
        });
    }

    const result = await performImageSwap({id}, persistApprovedHeader, file);
    return {changed: result.changed};
}

/** A header writer compares the stored reference hash without receiving its path,
 * bytes or the list/parent projection. Existing profile settings tokens still match. */
function headerEditToken(list: PackingList, session: SessionLike): string {
    return comparisonToken('packing-settings', list.id, session, {header: list.headerImg ?? null});
}

/** A header writer receives only its reviewed field token after a current
 * method check. Upload preflight uses this operation without protected byte reads. */
export async function readPackingHeaderBaseline(id: string, session: SessionLike): Promise<components['schemas']['PackingHeaderBaseline']> {
    async function readHeaderVersion(manager: EntityManager, row: PackingList | null) {
        const list = requireList(row);
        if (!mayPerformPackingMethod(await packingPermissions(manager, list, session), 'editHeader')) throw new ApiProblem('FORBIDDEN');
        return {editToken: headerEditToken(list, session)};
    }
    return packingService.withPackingReadSnapshot(id, readHeaderVersion);
}

/** Resolve the stored image only for an actor admitted to the full detail read.
 * Method-only header writers must use their hash baseline rather than this path. */
export async function readPackingHeaderPath(id: string, session: SessionLike): Promise<string> {
    return packingService.withPackingReadSnapshot(id, async function headerPath(manager, row) {
        const list = requireList(row);
        await authorizeRead(manager, list, session);
        if (!list.headerImg) throw new ApiProblem('NOT_FOUND');
        return list.headerImg;
    });
}

/** Hard deletion stays the simple feature repository operation, separate from archival coordination. */
export async function deletePackingList(id: string, session: SessionLike, expectedEventId?: string): Promise<components['schemas']['MutationResult']> {
    actorId(session);
    const oldPath = await packingService.withPackingListLock(id, async function removeList(manager, row) {
        const list = requireList(row);
        // An Event-hosted command must still address this parent when the existing
        // root lock is acquired. Ordinary Packing deletion has no parent condition.
        if (expectedEventId !== undefined && list.eventId !== expectedEventId) throw new ApiProblem('ENTITY_CONTEXT_CHANGED');
        // Check the locked current owner, independently of account-only creation admission
        // and administrator grants. Profile ownership also includes an established guest.
        await deleteEntity(list, session, manager);
        return list.headerImg;
    });
    if (oldPath) removeImage(oldPath);
    return {changed: true};
}

/** Setup baselines compare fields independently; administrator rows carry their own bounded mask token. */
async function settingsEditToken(manager: EntityManager, list: PackingList, session: SessionLike, includeAccess = false): Promise<string> {
    // A field hash of a small permission mask is guessable. Omit access baselines entirely
    // unless this actor may view/manage them, just as the visible administrator matrix is omitted.
    const defaults = includeAccess ? completeDefaults(await adminService.getDefaultPerms('packing', list.id, manager)) : null;
    return comparisonToken('packing-settings', list.id, session, {
        ...(defaults ? permissionDefaultComparisonValues(defaults) : {}),
        header: list.headerImg ?? null, eventId: list.eventId ?? null, ...(includeAccess ? {newAdmin: null} : {}),
    });
}
