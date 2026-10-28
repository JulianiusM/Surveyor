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

import {
    projectEntityEventOption, readAuthorizedEventUrl, authorizeEventLink, readEventLinkSelection,
    changeEntityEvent, getEntityViewAdmission,
} from '../modules/event/linkage';
import {withListRootLock, getLockedListAssignment, withListCreationTransaction} from '../modules/database/services/ListService';
import {applyListMembership} from '../modules/lists/membership';
import {saveListMetadata, listPermissions, assertListContext,
    listDescriptionBaseline, mayEditListMetadataField} from '../modules/lists/metadata';
import {
    readListItemEditBaseline, readListHeaderBaseline, readListHeaderPath, listHeaderToken,
    readListMetadata, readListDescription, readListOrderBaseline, readListSettings,
    authorizeListRead, listItemPermissions,
    listHeaderProjection, mayOpenListSettings, listSettingsToken,
    readEntityDefaultsBaseline, updateEntityDefaults, readEntityAdministratorBaseline, updateEntityAdministrator,
    updateListItem, deleteListItem, reorderListItems, requireListAssignmentHandle, deleteListAssignment,
    searchEntityProfiles, completeDefaults, normalizeBasicProperties, entityCreationPermissionContext,
} from './entityAdminController';
import type {
    ListItemCommandOperations, EntityMutationOutcome, ListReadOperations,
} from '../../types/EntityPropertyTypes';

import {hasAccountProfile} from './userController';
import {Request} from "express";
import type {EntityManager} from 'typeorm';
import {comparisonToken, comparisonActor, requireFieldComparison, entityTag} from '../modules/api/transport';
import {classifyArchiveCommandError, archiveEntity, restoreEntity} from '../modules/entityArchival';
import {
    entityMethodPermission, saveDefaultPermsFromBody, evaluateSubject, isOwner,
} from '../modules/permissionEngine';

import type {components} from '../../types/api/v1';
import type {PermissionFieldRule, PermEngineCaches, PermView, SessionLike} from '../../types/PermissionTypes';
import type {LockedArchiveContext} from '../../types/ArchiveTypes';

import type {Event} from '../modules/database/entities/event/Event';
import Joi from 'joi';
import {PackingItem} from "../modules/database/entities/packing/PackingItem";
import {PackingList} from "../modules/database/entities/packing/PackingList";

import * as packingService from '../modules/database/services/PackingService';
import * as lifecycleService from '../modules/database/services/EntityLifecycleService';
import * as adminService from '../modules/database/services/EntityAdminService';

import {ApiProblem} from '../modules/api/problem';
import {APIError, ValidationError} from '../modules/lib/errors';
import {performImageSwap, checkNewImage, removeImage} from "../modules/lib/fileCommons";
import {ENTITIES, generateUniqueId, sameUuid, uuidKey, groupByUuid, countListItems} from '../modules/lib/util';
import type {EntityBase} from "../../types/UserTypes";
import type {PackingMethod} from '../../types/PackingTypes';

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
        counters: countListItems(items.filter(item => !item.requiredByAll), new Map(Object.entries(assigneeLists)))
    };
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
    await saveListMetadata('packing', id, normalizeBasicProperties({description: body.description}), {kind: 'direct', expectedEventId});
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
    await applyListMembership('packing', body.itemId, profileId, false);
}

/**
 * Admit the direct item before its shared feature operation checks the locked snapshot:
 * absence is a 404, an existing assignment is an idempotent retry, then capacity constrains
 * a new assignment. The DBAL keeps the item lock until the approved insertion commits.
 */
async function assignItem(itemId: string, profileId: string): Promise<void> {
    await packingService.withPackingAssignmentLock(itemId, profileId, async function assignLocked(manager, item, existing, count) {
        if (!item) throw new APIError('Packing item not found', {itemId}, 404);
        await applyListMembership('packing', itemId, profileId, true, {manager, item, existing, count}, 'direct');
    });
}

/** Normalize all submitted fields before acquiring a lock; omitted fields remain unchanged. */
async function updateProperties(entity: EntityBase, body: unknown) {
    await saveListMetadata('packing', entity.id, normalizeBasicProperties(body), {kind: 'direct', expectedEventId: entity.eventId ?? null});
    return 'Properties updated';
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
        const permissions = await authorizeListRead('packing', manager, list, session, caches);

        // Child admission never implies permission to open its parent. Reuse the authorized Event URL
        // policy, but evaluate the captured parent inside this projection's existing snapshot.
        const currentEventUrl = await readAuthorizedEventUrl(list.event, session, manager);

        // Group persisted assignments once before building rows and shared counters.
        const {items, assignments} = await packingService.getPackingSnapshotRows(manager, id);
        const assignmentsByItem = groupByUuid(assignments, assignment => assignment.itemId);

        const profileId = actorId(session);
        const itemRows: components['schemas']['PackingItemView'][] = [];
        for (const item of items) {
            const itemPermissions = await listItemPermissions('packing', manager, list, item, session, caches);
            const capabilities = itemCapabilities(itemPermissions);
            const assigned = assignmentsByItem.get(uuidKey(item.id)) ?? [];
            itemRows.push({
                id: item.id,
                title: item.title,
                description: item.description ?? null,
                position: item.pos,
                requiredByAll: Boolean(item.requiredByAll),
                maxAssignees: item.maxAssignees ?? null,
                assignedCount: assigned.length,
                selfAssigned: assigned.some(assignment => sameUuid(assignment.profileId, profileId)),

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
            ...listHeaderProjection('packing', list),

            currentEventId: list.eventId ?? null,
            currentEventUrl,
            archived: Boolean(list.archivedAt),
            inheritedArchived: Boolean(list.event?.archivedAt),

            capabilities: {
                editTitle: mayEditListMetadataField('packing', permissions, 'title'),
                editDescription: mayEditListMetadataField('packing', permissions, 'description'),
                selfAssign: mayPerformPackingMethod(permissions, 'selfAssignment'),
                addItem: mayPerformPackingMethod(permissions, 'addItem'),
                reorder: mayPerformPackingMethod(permissions, 'reorderItems'),
                manageSettings: mayOpenListSettings('packing', list, permissions, session)
            },
            orderToken: orderEditToken(list, items, session),
            counters: countListItems(itemRows.filter(item => !item.requiredByAll), assignmentsByItem),
            items: itemRows,
        };
        return {data, etag: entityTag('packing-view', {data, profileId})};
    }
    return packingService.withPackingReadSnapshot(id, readSnapshot);
}

/** Supply only the feature's existing snapshot, method and comparison owners. */
const packingListReadOperations: ListReadOperations<PackingList, PackingItem, components['schemas']['EntityDescriptionBaseline']> = {
    withSnapshot: packingService.withPackingReadSnapshot,
    requireRoot: requireList,
    requireProfile: actorId,
    mayPerform: mayPerformPackingMethod,
    descriptionBaseline: (list, session) => listDescriptionBaseline('packing', list, session),
    items: packingService.getPackingSnapshotItems,
    orderToken: orderEditToken,
};

/** Read the metadata edit representation independently of changing item counts. */
export async function readPackingMetadata(id: string, session: SessionLike) {
    return readListMetadata('packing', id, session, packingListReadOperations);
}

/**
 * Supply an independently authorized item editor's current values without requiring
 * linked detail-page admission. Method policy filters both values and token hashes;
 * no assignments, other item fields, list metadata, parent or ACL projection leaves
 * this snapshot. Existing invalid/missing root scope is checked before item authority.
 */
export async function readPackingItemEditBaseline(id: string, itemId: string, session: SessionLike):
    Promise<components['schemas']['PackingItemEditBaseline']> {
    return readListItemEditBaseline(id, itemId, session, packingListReadOperations, listItemCommandOperations);
}

/** A reorder grant discloses only the compared order. Use the existing method
 * policy and read snapshot; item titles, assignments and parent details remain private. */
export async function readPackingItemOrderBaseline(id: string, session: SessionLike):
    Promise<components['schemas']['ListOrderBaseline']> {
    return readListOrderBaseline('packing', id, session, packingListReadOperations);
}

/**
 * Receive one already normalized, generated-schema-validated command. The HTTP
 * adapter owns structural diagnostics; no second validator runs inside the operation.
 * Form Joi diagnostics remain in their compatibility decoder.
 */
export async function patchPackingMetadata(id: string, patch: components['schemas']['BasicEntityMetadataPatch'], ifMatch: string | undefined, session: SessionLike) {
    actorId(session);
    return saveListMetadata('packing', id, patch, {kind: 'versioned', ifMatch, session});
}

/** Read only the independently granted description in a coherent snapshot.
 * The returned field token also serves conditional reads after fresh authority. */
export async function readPackingDescription(id: string, session: SessionLike): Promise<components['schemas']['EntityDescriptionBaseline']> {
    return readListDescription('packing', id, session, packingListReadOperations);
}

/** Validated description-only JSON reaches the same metadata persistence owner.
 * Construct the bounded command explicitly so this adapter cannot accidentally
 * forward another root property when a future caller supplies a wider object. */
export async function patchPackingDescription(id: string, patch: components['schemas']['EntityDescriptionPatch'], ifMatch: string | undefined, session: SessionLike) {
    return saveListMetadata('packing', id, {description: patch.description}, {kind: 'description', ifMatch, session, mayPerform: mayPerformPackingMethod});
}

/**
 * Apply desired self-membership for the captured actor. Parent/root/item lock ordering protects
 * relinking and capacity, while a repeated successful assignment remains valid even when now full.
 */
export async function setPackingSelfAssignment(listId: string, itemId: string, assigned: boolean, session: SessionLike): Promise<components['schemas']['ListAssignmentResult']> {
    const profileId = actorId(session);
    /** Recheck the captured actor against the locked relationship before reading
     * item/count evidence and applying the common desired-membership policy. */
    async function assignLocked(manager: EntityManager, context: LockedArchiveContext) {
        assertListContext(context);
        const list = requireList(await packingService.getPackingSnapshotRoot(manager, listId));
        const permissions = await listPermissions('packing', manager, list, session);
        if (!mayPerformPackingMethod(permissions, 'selfAssignment')) throw new ApiProblem('FORBIDDEN');

        // Lock the actual child after its current parent/root, then apply the
        // shared idempotency/capacity policy to that same assignment snapshot.
        const {item, existing, count} = await getLockedListAssignment('packing', manager, itemId, profileId);
        if (!item || !sameUuid(item.entityId, list.id)) throw new ApiProblem('NOT_FOUND');
        const assignedCount = await applyListMembership('packing', item.id, profileId, assigned, {manager, item, existing, count}, 'versioned');
        return {listId: list.id, itemId: item.id, selfAssigned: assigned, assignedCount, maxAssignees: item.maxAssignees ?? null};
    }
    return lifecycleService.withLockedArchiveTarget({type: 'packing', id: listId}, assignLocked);
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

/** Keep visible rendered controls separate from actual method authority. These
 * flags describe presentation; every command still evaluates current grants. */
function itemCapabilities(permissions: PermView): components['schemas']['PackingItemView']['capabilities'] {
    // The shared editor is offered only when the existing attribute method can
    // accept that field. Display-only grants never imply mutation authority.
    const editTitle = mayEditItemField(permissions, 'title');
    const editCapacity = mayEditItemField(permissions, 'maxAssignees');
    return {
        showTitleEdit: editTitle,
        showCapacityEdit: editCapacity,
        editTitle,
        editDescription: mayEditItemField(permissions, 'description'),
        editCapacity,
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

/** Parent/root locks serialize management with relinking. DBAL owns locks; this controller owns every decision. */
async function withPackingManagement<T>(id: string, session: SessionLike,
    operation: (manager: EntityManager, list: PackingList, permissions: PermView) => Promise<T>): Promise<T> {
    /** A root/parent wait may change both the relationship and effective grants.
     * Every selected command receives current evidence from this same manager. */
    async function manageLocked(manager: EntityManager, context: LockedArchiveContext): Promise<T> {
        assertListContext(context);
        const list = requireList(await packingService.getPackingSnapshotRoot(manager, id));
        const permissions = await listPermissions('packing', manager, list, session);
        return operation(manager, list, permissions);
    }
    return lifecycleService.withLockedArchiveTarget({type: 'packing', id}, manageLocked);
}

// Only existing Packing policy/projection/persistence choices vary inside the shared item workflows.
const listItemCommandOperations: ListItemCommandOperations<'packing', components['schemas']['PackingItemPatch'],
    components['schemas']['PackingItemEditBaseline']['values']> = {
    type: 'packing', item: (manager, id) => packingService.getPackingItemById(id, manager), mayEditField: mayEditItemField, projectItem: itemEditProjection, itemToken: itemEditToken,
    applyPatch: applyPackingItemPatch, capabilities: itemCapabilities, deleteItem,
    mayPerform: mayPerformPackingMethod, items: packingService.getPackingSnapshotItems, orderToken: orderEditToken,
    reorder: reorderItems, assignment: packingService.getPackingAssignmentById, deleteAssignment,
};

/** Creation POST requires an account, including when a public/guest duplicate GET supplied its draft. */
export function requirePackingCreation(session: SessionLike): void {
    actorId(session);
    if (!hasAccountProfile(session)) throw new ApiProblem('FORBIDDEN');
}

/** Public form definitions contain no resource data; duplicate GET can use them without an account. */
export function packingFormContext(): components['schemas']['EntityCreationContext'] {
    return entityCreationPermissionContext('packing');
}

/** An initial creation form still requires the admitted account profile;
 * public duplication has its separate access to the same static definitions. */
export function readPackingCreateContext(session: SessionLike): components['schemas']['EntityCreationContext'] {
    requirePackingCreation(session);
    return packingFormContext();
}

/** Commit the initial database rows/defaults together; request-image cleanup remains with the HTTP owner. */
export async function createPackingList(
    body: components['schemas']['PackingCreateInput'],
    file: Express.Multer.File | undefined,
    session: SessionLike
): Promise<components['schemas']['EntityCreationResult']> {
    requirePackingCreation(session);
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
    return withListCreationTransaction(body.eventId, createLocked);
}

/** Duplicate GET depends only on DATA_DUPLICATE, independently of detail admission and creation POST. */
export async function readPackingDuplicate(id: string, session: SessionLike, eventId?: unknown): Promise<components['schemas']['PackingDuplicate']> {
    return packingService.withPackingReadSnapshot(id,
    /** Read the granted duplication form/defaults in this source snapshot;
     * a destination parent comes solely from its independently admitted URL selection. */
    async function readDuplicate(manager, row) {
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
            formContext: packingFormContext(),
            ...(eventId !== undefined ? {selectedEvent: selected ? projectEntityEventOption(selected) : null} : {})};
    });
}

/** Project settings separately, omitting the administrator matrix entirely without MANAGE_PERMISSIONS. */
export async function readPackingSettings(id: string, session: SessionLike): Promise<components['schemas']['ListSettings']> {
    return readListSettings('packing', id, session, packingListReadOperations);
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
export async function createPackingItem(id: string, body: components['schemas']['PackingNewItem'], session: SessionLike): Promise<components['schemas']['EntityCreationResult']> {
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
    return withPackingManagement(id, session, function patchItem(manager, list) {
        return updateListItem(itemId, body, token, session, manager, list, listItemCommandOperations);
    });
}

/** Scope the locked item to the requested root, then require its actual delete
 * method grant. The shared hard-delete operation retains its existing cascades. */
export async function deletePackingItem(id: string, itemId: string, session: SessionLike): Promise<components['schemas']['MutationResult']> {
    return withPackingManagement(id, session, function removeItem(manager, list) {
        return deleteListItem(itemId, session, manager, list, listItemCommandOperations);
    });
}

/** Review one complete stored order under the exclusive root/item locks.
 * That root lock coordinates creation/removal and direct assignment consumers;
 * the direct reorder adapter retains its independent partial-order contract. */
export async function reorderPackingItems(
    id: string,
    body: components['schemas']['ListItemOrderInput'],
    token: string | undefined,
    session: SessionLike
): Promise<components['schemas']['MutationResult']> {
    return withPackingManagement(id, session, function reorder(manager, list, permissions) {
        return reorderListItems(body, token, session, manager, list, permissions, listItemCommandOperations);
    });
}

/** Resolve an opaque assignment handle within this root before checking its
 * item's removal grant. Public method authority does not expose an assignment
 * roster or create personal membership; deletion uses the existing operation. */
export async function deletePackingAssignment(id: string, assignmentId: string, session: SessionLike): Promise<components['schemas']['MutationResult']> {
    requireListAssignmentHandle(assignmentId);
    return withPackingManagement(id, session, function removeAssignment(manager, list) {
        return deleteListAssignment(assignmentId, session, manager, list, listItemCommandOperations);
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
        return updateEntityDefaults('packing', id, body, session, token, manager, {comparisonId: list.id});
    });
}

/** Independently granted permission management discloses its audience masks alone. */
export async function readPackingDefaultsBaseline(id: string, session: SessionLike): Promise<components['schemas']['EntityPermissionDefaultsBaseline']> {
    async function readDefaults(manager: EntityManager, row: PackingList | null) {
        const list = requireList(row);
        if (!mayPerformPackingMethod(await listPermissions('packing', manager, list, session), 'managePermissions')) throw new ApiProblem('FORBIDDEN');
        return readEntityDefaultsBaseline('packing', id, session, manager, {comparisonId: list.id});
    }
    return packingService.withPackingReadSnapshot(id, readDefaults);
}

/** Check method authority before target existence, then disclose only that target's
 * mask/new-grant marker. The same single-target DBAL read serves locked writes. */
export async function readPackingAdminBaseline(id: string, profileId: string, session: SessionLike): Promise<components['schemas']['EntityAdministratorBaseline']> {
    async function readAdministrator(manager: EntityManager, row: PackingList | null) {
        const list = requireList(row);
        if (!mayPerformPackingMethod(await listPermissions('packing', manager, list, session), 'managePermissions')) throw new ApiProblem('FORBIDDEN');
        return readEntityAdministratorBaseline('packing', id, profileId, session, manager, {comparisonId: list.id});
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
        if (!mayPerformPackingMethod(permissions, 'managePermissions')) throw new ApiProblem('FORBIDDEN');
        return updateEntityAdministrator('packing', id, profileId, mask, session, token, manager, {comparisonId: list.id});
    });
}

/** Authorize scoped administrator discovery before using the secure
 * account search. Its projected options exclude guest credentials and raw emails;
 * the route uses the shared per-IP limiter and admitted API context. */
export async function searchPackingProfiles(id: string, query: string, session: SessionLike): Promise<components['schemas']['EntityAdministratorProfileOptions']> {
    await packingService.withPackingReadSnapshot(id, async function requireManagement(manager, row) {
        if (!mayPerformPackingMethod(await listPermissions('packing', manager, requireList(row), session), 'managePermissions')) throw new ApiProblem('FORBIDDEN');
    });
    // Reuse the account-only secure search; no guest-token discovery or raw emails enter this DTO.
    return searchEntityProfiles(query);
}

/** Shared lifecycle/controller owners remain authoritative; adapt only their conflict into the stable contract. */
export async function changePackingEvent(
    id: string,
    body: components['schemas']['EntityEventChangeInput'],
    session: SessionLike,
    token?: string
): Promise<components['schemas']['EntityEventChangeResult']> {
    actorId(session);
    const list = requireList(await packingService.getPackingListById(id));
    try {
        /** The shared relink owner already checked source/target method authority;
         * compare only this actor's reviewed association inside those same locks. */
        async function validateContext(manager: EntityManager): Promise<void> {
            const current = requireList(await packingService.getPackingSnapshotRoot(manager, id));
            await listPermissions('packing', manager, current, session);
            requireFieldComparison(token, await listSettingsToken('packing', manager, current, session), ['eventId']);
        }

        /** Use the shared admission owner and this transaction's resulting association for the exact v1 receipt. */
        async function prepareEventCompletion(manager: EntityManager, outcome: EntityMutationOutcome): Promise<components['schemas']['EntityEventChangeResult']> {
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
    /** Save the reviewed header through root management and return its prior
     * path after commit; the shared swap owner retains upload-failure cleanup. */
    async function persistApprovedHeader(listId: string, path?: string | null) {
        return withPackingManagement(listId, session,
        /** Compare the locked header grant/evidence before writing only its stored reference. */
        async function replaceHeader(manager, list, permissions) {
            // A valid upload still needs current method authority and the
            // captured actor-bound comparison before its reference is persisted.
            if (!mayPerformPackingMethod(permissions, 'editHeader')) throw new ApiProblem('FORBIDDEN');
            requireFieldComparison(token, listHeaderToken('packing', list, session), ['header']);

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

/** A header writer receives only its reviewed field token after a current
 * method check. Upload preflight uses this operation without protected byte reads. */
export async function readPackingHeaderBaseline(id: string, session: SessionLike): Promise<components['schemas']['EntityHeaderBaseline']> {
    return readListHeaderBaseline('packing', id, session, packingListReadOperations);
}

/** Resolve the stored image only for an actor admitted to the full detail read.
 * Method-only header writers must use their hash baseline rather than this path. */
export async function readPackingHeaderPath(id: string, session: SessionLike): Promise<string> {
    return readListHeaderPath('packing', id, session, packingListReadOperations);
}

/** Hard deletion stays the simple feature repository operation, separate from archival coordination. */
export async function deletePackingList(id: string, session: SessionLike, expectedEventId?: string): Promise<components['schemas']['MutationResult']> {
    actorId(session);
    const oldPath = await withListRootLock('packing', id, async function removeList(manager, row) {
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
