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
import {saveListMetadata, listMetadataResult, listPermissions, assertListContext,
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
import {DriversItem} from "../modules/database/entities/drivers/DriversItem";
import {DriversList} from "../modules/database/entities/drivers/DriversList";

import * as driverService from '../modules/database/services/DriverService';
import * as lifecycleService from '../modules/database/services/EntityLifecycleService';
import * as adminService from '../modules/database/services/EntityAdminService';

import {ApiProblem} from '../modules/api/problem';
import {APIError, ValidationError} from '../modules/lib/errors';
import {performImageSwap, checkNewImage, removeImage} from "../modules/lib/fileCommons";
import {ENTITIES, generateUniqueId, sameUuid, uuidKey, groupByUuid, countListItems} from '../modules/lib/util';
import type {EntityBase} from "../../types/UserTypes";
import type {DriversCommandPreparation, DriversMethod} from '../../types/DriversTypes';

// Template constant for create errors
const CREATE_TEMPLATE = 'drivers/drivers-create';

/** Decode Drivers creation with the existing optional parent, description and field defaults. */
function preprocessCreate(body: any): Partial<DriversList> {
    // Preserve form coercion and validation before selecting only the supported root fields.
    const schema = Joi.object({
        title: Joi.string().required(),
        description: Joi.string().allow('').optional(),
        event_id: Joi.string().uuid().allow('').optional(),
    });

    const {error, value} = schema.validate(
        {
            title: body.title,
            description: body.description,
            event_id: body.event_id
        },
        {abortEarly: false, allowUnknown: true}
    );
    if (error) {
        const msg = error.details.map((d: any) => d.message).join(', ');
        throw new ValidationError(CREATE_TEMPLATE, msg, {body});
    }

    return {
        title: value.title,
        description: value.description || null,
        eventId: value.event_id || null,
    };
}

/** Share root creation between adapters. Direct creation keeps its original
 * later defaults hook; the versioned command supplies its existing transaction. */
async function createEntity(
    ownerId: string,
    listData: Partial<DriversList>,
    manager?: EntityManager,
) {
    return await driverService.createDriversList(
        ownerId,
        listData.title!,
        listData.description!,
        listData.eventId,
        listData.headerImg,
        undefined, manager,
    );
}

async function afterCreateItems(id: string, data: any) {
    await updateSettings(id, data._body);
}

/** Preserve shared read order and renderer data while sharing only the counter
 * policy with the versioned snapshot projection. Neither read changes membership. */
async function fetchForView(list: DriversList, req: Request) {
    // Caller admission has already supplied the active profile.
    // Keep these existing independent reads and their original failure ordering.
    const items = await driverService.getDriversItems(list.id);
    const session = req.session;

    const assignments = await driverService.getDriversAssignments(list.id, session.profile!.id)

    const assigneeLists = await driverService.getDriversItemAssignees(list.id);

    return {
        list,
        items,
        assignments,
        assigneeLists,
        counters: countListItems(items, new Map(Object.entries(assigneeLists)))
    };
}

async function fetchForDuplicate(list: DriversList, session: Request['session']) {
    return await driverService.getDriversItems(list.id);
}

async function deleteEntity(list: DriversList, session: SessionLike, manager?: EntityManager) {
    return await driverService.deleteDriversList(list.id, manager);
}

// ---------- API ----------
// API-specific controllers
async function updateDescription(id: string, body: any, expectedEventId?: string | null) {
    await saveListMetadata('drivers', id, normalizeBasicProperties({description: body.description}), {kind: 'direct', expectedEventId});
    return 'Description updated';
}


async function reorderItems(id: string, order: Array<{ itemId: string; position: number }>, manager?: EntityManager) {
    await driverService.reorderDriversItems(id, order, manager);
    return 'Order saved';
}


/** Decode Quick Add's original defaults, numeric fallback and diagnostics;
 * the admitted profile and stored position reach the shared offer creator. */
async function quickAddItem(list: DriversList, body: any, session: Request['session']) {
    const {title = '', description = '', maxAssignees = '1'} = body;
    if (!title) throw new APIError('Title required', body, 400);

    // Preserve operation ordering: read the position before its original profile
    // diagnostic, then share construction/persistence with the versioned adapter.
    const last = Number(await driverService.getLastDriversItemNumber(list.id)) || 0;
    if (!session.profile) throw new APIError('Not logged in', body, 400);
    await addDriversItem(list.id, {title, description, maxAssignees: Number(maxAssignees) || 1}, session.profile.id, undefined, last + 1);

    return 'Item added';
}


async function updateItemDescription(itemId: string, body: any) {
    await applyDriversItemPatch(itemId, {description: body.description}, {kind: 'direct', body});
    return 'Description updated';
}


/** Direct attribute edits retain their raw scalar and allowlist. The common
 * sparse write preserves passengers and the original vanished-row diagnostic. */
async function updateItemAttr(itemId: string, body: any) {
    const {field, value} = body;
    const allowed: any = {title: 1, description: 1, maxAssignees: 1};

    // Allow only the shared method's three columns before forwarding any value.
    if (!allowed[field]) throw new APIError('Invalid field', body, 400);

    await applyDriversItemPatch(itemId, {[field]: value}, {kind: 'direct', body});
    return 'Item updated';
}

async function deleteAssignment(assignId: string | number, manager?: EntityManager) {
    await driverService.deleteDriversAssignment(Number(assignId), manager);
    return 'Assignment removed';
}

async function updateSettings(id: string, body: any, manager?: EntityManager, inputFormat?: 'permissionKeys' | 'masks') {
    await saveDefaultPermsFromBody(ENTITIES.DRIVERS, id, body, {manager, inputFormat});
    return 'Settings saved';
}


async function deleteItem(itemId: string, manager?: EntityManager) {
    await driverService.deleteDriversItem(itemId, manager);
    return 'Item deleted';
}

async function updateHeaderImg(entity: EntityBase, file?: Express.Multer.File) {
    await performImageSwap(entity, driverService.updateHeaderImage, file);
    return 'Image updated';
}

async function deleteHeaderImg(entity: EntityBase) {
    await performImageSwap(entity, driverService.updateHeaderImage);
    return 'Image deleted';
}

/** Select the feature's shared membership owners for the direct operation adapters.
 * The mapping exposes body-shaped operations with explicit profile and ride identifiers. */
function getAssignmentAccessMapping() {
    // Both transports retain the same capacity/idempotency policy; only direct
    // removal preserves the original unlocked deletion and feedback adapter.
    return {
        assign: (body: any, profileId: string) => assignItem(body.itemId, profileId),
        unassign: unassignItem,
    };
}

/** Direct removal retains its original unlocked desired-membership deletion. */
async function unassignItem(body: any, profileId: string): Promise<void> {
    await applyListMembership('drivers', body.itemId, profileId, false);
}

/**
 * Admit the direct item before its shared feature operation checks the locked snapshot:
 * absence is a 404, an existing assignment is an idempotent retry, then capacity constrains
 * a new assignment. The DBAL keeps the item lock until the approved insertion commits.
 */
async function assignItem(itemId: string, profileId: string): Promise<void> {
    await driverService.withDriversAssignmentLock(itemId, profileId, async function assignLocked(manager, item, existing, count) {
        if (!item) throw new APIError('Drivers item not found', {itemId}, 404);
        await applyListMembership('drivers', itemId, profileId, true, {manager, item, existing, count});
    });
}

/** Normalize all submitted fields before acquiring a lock; omitted fields remain unchanged. */
async function updateProperties(entity: EntityBase, body: unknown) {
    await saveListMetadata('drivers', entity.id, normalizeBasicProperties(body), {kind: 'direct', expectedEventId: entity.eventId ?? null});
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

    updateHeaderImg,
    deleteHeaderImg,

    getAssignmentAccessMapping,
}


/**
 * One method policy drives named controller checks and action
 * capabilities. Preserve method differences: attr accepts description through
 * EDIT_META, while its dedicated description action uses EDIT_DESC. The driver
 * name is profile-derived and is never an editable item title in the detail view.
 * Cross-feature methods consume the existing administration controller's shared
 * declarations, also used by direct callers and the shared relink operation.
 */
const driversMethodPermissions: Record<DriversMethod, PermissionFieldRule> = {
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
    editItemAttr: {permission: 'EDIT_META', parent: 'ITEM_EDIT'},
    deleteItem: {permission: 'ITEM_DELETE', parent: 'ITEM_DELETE'},
    deleteAssignment: {permission: 'MANAGE_ASSIGNMENTS'},
};

/** Return an adapter's rule without exposing the mutable controller-owned policy. */
export function driversMethodPermission(method: DriversMethod): PermissionFieldRule {
    const rule = driversMethodPermissions[method];
    return {...rule, ...(Array.isArray(rule.parent) ? {parent: [...rule.parent]} : {})};
}

/** The engine interprets item fallback and ownership; this owner chooses the method. */
function mayPerformDriversMethod(permissions: PermView, method: DriversMethod): boolean {
    const rule = driversMethodPermissions[method];
    return permissions.allow(rule.permission, rule.parent);
}

const itemFieldMethods: Record<keyof components['schemas']['DriversItemPatch'], DriversMethod> = {
    title: 'editItemTitle', description: 'editItemDescription',
    maxAssignees: 'editItemCapacity',
};

/** Resolve each submitted item field through the central shared method rule,
 * including the distinct description action and its allowed parent fallbacks. */
function mayEditItemField(permissions: PermView, field: keyof components['schemas']['DriversItemPatch']): boolean {
    return mayPerformDriversMethod(permissions, itemFieldMethods[field]);
}

/** Require the already admitted actor; this module never re-reads a mutable Express session. */
function actorId(session: SessionLike): string {
    if (!session.profile?.id) throw new ApiProblem('AUTH_REQUIRED');
    return session.profile.id;
}

/** Interpret nullable DB evidence here, keeping missing-resource policy outside the DBAL. */
function requireList(list: DriversList | null): DriversList {
    if (!list) throw new ApiProblem('NOT_FOUND');
    return list;
}

/**
 * Read every displayed row/count and authorization input in one snapshot. Only visible names,
 * machine values and action capabilities leave this projection, never ORM entities or account data.
 */
export async function readDriversList(id: string, session: SessionLike) {
    /** Admit the page and assemble every row/counter in this repeatable-read
     * snapshot. Its caches live only for this projection, never a later command. */
    async function readSnapshot(manager: EntityManager, row: DriversList | null) {
        const list = requireList(row);
        // Cache only within this repeatable-read projection. Writes always start their own
        // authorization evaluation after acquiring locks, never reusing a page's permission view.
        const caches: PermEngineCaches = {participant: new Map(), defaults: new Map(), userPerms: new Map()};
        const permissions = await authorizeListRead('drivers', manager, list, session, caches);

        // Child admission never implies permission to open its parent. Reuse the authorized Event URL
        // policy, but evaluate the captured parent inside this projection's existing snapshot.
        const currentEventUrl = await readAuthorizedEventUrl(list.event, session, manager);

        // Group persisted assignments once before building rows and shared counters.
        const {items, assignments} = await driverService.getDriversSnapshotRows(manager, id);
        const assignmentsByItem = groupByUuid(assignments, assignment => assignment.itemId);

        const profileId = actorId(session);
        const itemRows: components['schemas']['DriversItemView'][] = [];
        for (const item of items) {
            const itemPermissions = await listItemPermissions('drivers', manager, list, item, session, caches);
            const capabilities = itemCapabilities(itemPermissions);
            const assigned = assignmentsByItem.get(uuidKey(item.id)) ?? [];
            itemRows.push({
                id: item.id,
                description: item.description ?? null,
                position: item.pos,
                driverName: item.profile.name,
                maxAssignees: item.maxAssignees ?? null,
                assignedCount: assigned.length,
                selfAssigned: assigned.some(assignment => sameUuid(assignment.profileId, profileId)),

                // Names are visible content; removable handles need their own method grant.
                assignees: assigned.map(assignment => ({name: assignment.profile.name, assignmentId: capabilities.removeAssignments ? String(assignment.id) : null})),

                capabilities,
                // Hidden titles must not leak guessable comparison hashes to a
                // viewer without the matching item-field method grant.
                editToken: itemEditToken(list, item, session, itemEditProjection(item, itemPermissions).values),
            });
        }

        const data: components['schemas']['DriversListView'] = {
            entityType: 'drivers',
            id: list.id,
            title: list.title,
            description: list.description ?? null,
            ...listHeaderProjection('drivers', list),

            currentEventId: list.eventId ?? null,
            currentEventUrl,
            archived: Boolean(list.archivedAt),
            inheritedArchived: Boolean(list.event?.archivedAt),

            capabilities: {
                editTitle: mayEditListMetadataField('drivers', permissions, 'title'),
                editDescription: mayEditListMetadataField('drivers', permissions, 'description'),
                selfAssign: mayPerformDriversMethod(permissions, 'selfAssignment'),
                addItem: mayPerformDriversMethod(permissions, 'addItem'),
                reorder: mayPerformDriversMethod(permissions, 'reorderItems'),
                manageSettings: mayOpenListSettings('drivers', list, permissions, session)
            },
            orderToken: orderEditToken(list, items, session),
            counters: countListItems(itemRows, assignmentsByItem),
            items: itemRows,
        };
        return {data, etag: entityTag('drivers-view', {data, profileId})};
    }
    return driverService.withDriversReadSnapshot(id, readSnapshot);
}

/** Supply only the feature's existing snapshot, method and comparison owners. */
const driversListReadOperations: ListReadOperations<DriversList, DriversItem, components['schemas']['EntityDescriptionBaseline']> = {
    withSnapshot: driverService.withDriversReadSnapshot,
    requireRoot: requireList,
    requireProfile: actorId,
    mayPerform: mayPerformDriversMethod,
    descriptionBaseline: (list, session) => listDescriptionBaseline('drivers', list, session),
    items: driverService.getDriversSnapshotItems,
    orderToken: orderEditToken,
};

/** Read the metadata edit representation independently of changing item counts. */
export async function readDriversMetadata(id: string, session: SessionLike) {
    return readListMetadata('drivers', id, session, driversListReadOperations);
}

/**
 * Supply an independently authorized item editor's current values without requiring
 * linked detail-page admission. Method policy filters both values and token hashes;
 * no assignments, other item fields, list metadata, parent or ACL projection leaves
 * this snapshot. Existing invalid/missing root scope is checked before item authority.
 */
export async function readDriversItemEditBaseline(id: string, itemId: string, session: SessionLike):
    Promise<components['schemas']['DriversItemEditBaseline']> {
    return readListItemEditBaseline(id, itemId, session, driversListReadOperations, listItemCommandOperations);
}

/** A reorder grant discloses only the compared order. Use the existing method
 * policy and read snapshot; item titles, assignments and parent details remain private. */
export async function readDriversItemOrderBaseline(id: string, session: SessionLike):
    Promise<components['schemas']['DriversOrderEditBaseline']> {
    return readListOrderBaseline('drivers', id, session, driversListReadOperations);
}

/**
 * Receive one already normalized, generated-schema-validated command. The HTTP
 * adapter owns structural diagnostics; no second validator runs inside the operation.
 * Form Joi diagnostics remain in their compatibility decoder.
 */
export async function patchDriversMetadata(id: string, patch: components['schemas']['DriversMetadataPatch'], ifMatch: string | undefined, session: SessionLike,
    prepare?: DriversCommandPreparation<ReturnType<typeof listMetadataResult<'drivers'>>>) {
    actorId(session);
    return saveListMetadata('drivers', id, patch, {kind: 'versioned', ifMatch, session, prepare});
}

/** Read only the independently granted description in a coherent snapshot.
 * The returned field token also serves conditional reads after fresh authority. */
export async function readDriversDescription(id: string, session: SessionLike): Promise<components['schemas']['DriversDescriptionBaseline']> {
    return readListDescription('drivers', id, session, driversListReadOperations);
}

/** Validated description-only JSON reaches the same metadata persistence owner.
 * Construct the bounded command explicitly so this adapter cannot accidentally
 * forward another root property when a future caller supplies a wider object. */
export async function patchDriversDescription(id: string, patch: components['schemas']['DriversDescriptionPatch'], ifMatch: string | undefined, session: SessionLike,
    prepare?: DriversCommandPreparation<components['schemas']['DriversDescriptionBaseline']>) {
    return saveListMetadata('drivers', id, {description: patch.description}, {kind: 'description', ifMatch, session, prepare, mayPerform: mayPerformDriversMethod});
}

/**
 * Apply desired self-membership for the captured actor. Parent/root/item lock ordering protects
 * relinking and capacity, while a repeated successful assignment remains valid even when now full.
 */
export async function setDriversSelfAssignment(listId: string, itemId: string, assigned: boolean, session: SessionLike,
    prepare?: DriversCommandPreparation<components['schemas']['DriversAssignmentResult']>): Promise<components['schemas']['DriversAssignmentResult']> {
    const profileId = actorId(session);
    /** Recheck the captured actor against the locked relationship before reading
     * item/count evidence and applying the common desired-membership policy. */
    async function assignLocked(manager: EntityManager, context: LockedArchiveContext) {
        assertListContext(context);
        const list = requireList(await driverService.getDriversSnapshotRoot(manager, listId));
        const permissions = await listPermissions('drivers', manager, list, session);
        if (!mayPerformDriversMethod(permissions, 'selfAssignment')) throw new ApiProblem('FORBIDDEN');

        // Lock the actual child after its current parent/root, then apply the
        // shared idempotency/capacity policy to that same assignment snapshot.
        const {item, existing, count} = await getLockedListAssignment('drivers', manager, itemId, profileId);
        if (!item || !sameUuid(item.entityId, list.id)) throw new ApiProblem('NOT_FOUND');
        const assignedCount = await applyListMembership('drivers', item.id, profileId, assigned, {manager, item, existing, count}, 'versioned');
        const result = {listId: list.id, itemId: item.id, selfAssigned: assigned, assignedCount, maxAssignees: item.maxAssignees ?? null};
        prepare?.(result);
        return result;
    }
    return lifecycleService.withLockedArchiveTarget({type: 'drivers', id: listId}, assignLocked);
}

/**
 * Direct and versioned item adapters share sparse persistence and retain assignments when
 * reducing capacity. V1 compares its locked baseline; the direct operation sends the raw scalar and
 * preserves its original vanished-row diagnostic.
 */
async function applyDriversItemPatch(itemId: string, fields: components['schemas']['DriversItemPatch'],
    context: {kind: 'direct'; body: any} | {kind: 'versioned'; manager: EntityManager; item: DriversItem}): Promise<boolean> {
    // Direct edits always issue their original sparse write. Versioned edits skip
    // an unchanged value while retaining every existing passenger assignment.
    const changed = context.kind === 'direct'
        || Object.entries(fields).some(([key, value]) => (context.item[key as keyof DriversItem] ?? null) !== value);
    if (changed) {
        const saved = await driverService.updateDriversItem(itemId, driversItemPersistenceFields(fields),
            context.kind === 'versioned' ? context.manager : undefined);
        if (!saved && context.kind === 'direct') throw new APIError('Unknown error while saving', context.body, 500);
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
function driversItemPersistenceFields(body: components['schemas']['DriversItemPatch']): Partial<DriversItem> {
    return {...body} as Partial<DriversItem>;
}

/** Keep visible rendered controls separate from actual method authority. These
 * flags describe presentation; every command still evaluates current grants. */
function itemCapabilities(permissions: PermView): components['schemas']['DriversItemView']['capabilities'] {
    return {
        // Drivers uses the same metadata grant for its capacity control and
        // direct attr command; title remains absent from the visible ride columns.
        showCapacityEdit: mayEditItemField(permissions, 'maxAssignees'),
        editTitle: mayEditItemField(permissions, 'title'),
        editDescription: mayEditItemField(permissions, 'description'),
        editCapacity: mayEditItemField(permissions, 'maxAssignees'),
        removeItem: mayPerformDriversMethod(permissions, 'deleteItem'),
        removeAssignments: mayPerformDriversMethod(permissions, 'deleteAssignment'),
    };
}

/** Keep canonical persisted edit values in one owner for full-detail and minimal
 * baselines. Numeric drafts remain confined to mutation input/persistence. */
function itemEditValues(item: DriversItem): Required<components['schemas']['DriversItemEditBaseline']['values']> {
    return {
        title: item.title,
        description: item.description ?? null,
        maxAssignees: item.maxAssignees ?? null
    };
}

/** Filtering follows actual command grants, including the shared EDIT_META/EDIT_DESC
 * asymmetry. The stored title appears only in an independently permitted edit baseline. */
function itemEditProjection(item: DriversItem, permissions: PermView):
    Pick<components['schemas']['DriversItemEditBaseline'], 'values' | 'editableFields'> {
    const current = itemEditValues(item);
    const values: components['schemas']['DriversItemEditBaseline']['values'] = {};
    const editableFields: components['schemas']['DriversItemEditBaseline']['editableFields'] = [];
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
    return {values, editableFields};
}

/** Scope and actor stay identical across baseline adapters. A minimal baseline
 * hashes only its permitted projection; writes compare only submitted fields. */
function itemEditToken(list: DriversList, item: DriversItem, session: SessionLike,
    values: components['schemas']['DriversItemEditBaseline']['values'] = itemEditValues(item)): string {
    return comparisonToken('drivers-item', `${list.id}:${item.id}`, session, values);
}

/** Order comparisons bind this root, actor and complete stored ID/position set.
 * Unrelated field edits do not stale ordering, but additions/removals/reorders do. */
function orderEditToken(list: DriversList, items: DriversItem[], session: SessionLike): string {
    return entityTag('drivers-order', {id: list.id, items: items.map(item => [item.id, item.pos]), actor: comparisonActor(session)});
}

/** Parent/root locks serialize management with relinking. DBAL owns locks; this controller owns every decision. */
async function withDriversManagement<T>(id: string, session: SessionLike,
    operation: (manager: EntityManager, list: DriversList, permissions: PermView) => Promise<T>,
    prepare?: DriversCommandPreparation<T>): Promise<T> {
    /** A root/parent wait may change both the relationship and effective grants.
     * Every selected command receives current evidence from this same manager. */
    async function manageLocked(manager: EntityManager, context: LockedArchiveContext): Promise<T> {
        assertListContext(context);
        const list = requireList(await driverService.getDriversSnapshotRoot(manager, id));
        const permissions = await listPermissions('drivers', manager, list, session);
        const result = await operation(manager, list, permissions);
        // Serialization/contract validation belongs to the new transport and must
        // succeed while this transaction can still reject the whole command.
        prepare?.(result);
        return result;
    }
    return lifecycleService.withLockedArchiveTarget({type: 'drivers', id}, manageLocked);
}

// Only existing Drivers policy/projection/persistence choices vary inside the shared item workflows.
const listItemCommandOperations: ListItemCommandOperations<'drivers', components['schemas']['DriversItemPatch'],
    components['schemas']['DriversItemEditBaseline']['values']> = {
    type: 'drivers', item: driverService.getDriversSnapshotItem, mayEditField: mayEditItemField, projectItem: itemEditProjection, itemToken: itemEditToken,
    applyPatch: applyDriversItemPatch, capabilities: itemCapabilities, deleteItem,
    mayPerform: mayPerformDriversMethod, items: driverService.getDriversSnapshotItems, orderToken: orderEditToken,
    reorder: reorderItems, assignment: driverService.getDriversAssignmentById, deleteAssignment,
};

/** Creation POST requires an account, including when a public/guest duplicate GET supplied its draft. */
export function requireDriversCreation(session: SessionLike): void {
    actorId(session);
    if (!hasAccountProfile(session)) throw new ApiProblem('FORBIDDEN');
}

/** Public form definitions contain no resource data; duplicate GET can use them without an account. */
export function driversFormContext(): components['schemas']['DriversCreateContext'] {
    return entityCreationPermissionContext('drivers');
}

/** An initial creation form still requires the admitted account profile;
 * public duplication has its separate access to the same static definitions. */
export function readDriversCreateContext(session: SessionLike): components['schemas']['DriversCreateContext'] {
    requireDriversCreation(session);
    return driversFormContext();
}

/** Create an empty ride list through the shared metadata/default owners. The
 * new adapter prepares its declared receipt while the command can still roll back. */
export async function createDriversList(
    body: components['schemas']['DriversCreateInput'],
    file: Express.Multer.File | undefined,
    session: SessionLike,
    prepare?: DriversCommandPreparation<components['schemas']['DriversCreated']>
): Promise<components['schemas']['DriversCreated']> {
    requireDriversCreation(session);
    checkNewImage(file);
    /** The optional parent is already locked. Apply shared attachment admission
     * before committing the root and authored defaults together. */
    async function createLocked(manager: EntityManager, event: Event | null) {
        // Direct submission and versioned commands use the event controller's same attachment
        // policy. The v1 adapter supplies its already locked parent and manager.
        await authorizeEventLink(body.eventId, session, manager, event);
        const id = await createEntity(actorId(session), {...body, eventId: body.eventId ?? undefined, description: body.description ?? undefined, headerImg: file?.path}, manager);
        await updateSettings(id, {defaultPerms: body.defaultPermissions}, manager, 'masks');
        const result = {id};
        prepare?.(result);
        return result;
    }
    return withListCreationTransaction(body.eventId, createLocked);
}

/** Duplicate GET depends only on DATA_DUPLICATE, independently of detail admission and creation POST. */
export async function readDriversDuplicate(id: string, session: SessionLike, eventId?: unknown): Promise<components['schemas']['DriversDuplicate']> {
    return driverService.withDriversReadSnapshot(id,
    /** Read the granted source form/defaults without copying offers or memberships;
     * only independently admitted destination selection can seed a new parent. */
    async function readDuplicate(manager, row) {
        const list = requireList(row);
        const permissions = await evaluateSubject({kind: 'entity', entity: {
            entityType: 'drivers', entityId: list.id, ownerId: list.ownerId, eventId: list.eventId,
        }}, session, undefined, manager);
        if (!mayPerformDriversMethod(permissions, 'duplicate')) throw new ApiProblem('FORBIDDEN');

        // Copy the form surface only. Assignments, administrators, header,
        // archive state and event membership remain associated with the source.
        const selected = await readEventLinkSelection(eventId, session);
        return {title: list.title, description: list.description ?? null, eventId: null,
            defaultPermissions: completeDefaults(await adminService.getDefaultPerms('drivers', id, manager)),
            // The source's parent is deliberately excluded. Only a separately
            // admitted URL selection may seed the destination creation draft.
            formContext: driversFormContext(),
            ...(eventId !== undefined ? {selectedEvent: selected ? projectEntityEventOption(selected) : null} : {})};
    });
}

/** Project settings separately, omitting the administrator matrix entirely without MANAGE_PERMISSIONS. */
export async function readDriversSettings(id: string, session: SessionLike): Promise<components['schemas']['DriversSettings']> {
    return readListSettings('drivers', id, session, driversListReadOperations);
}

/**
 * Add one offer through the common creator/persistence operation. Direct Quick
 * Add and the new adapter both use the next stored position and the admitted
 * profile as the driver; direct callers retain their original position read order.
 */
async function addDriversItem(id: string, fields: Partial<DriversItem>, profileId: string, manager?: EntityManager, position?: number): Promise<string> {
    // The stored position and profile relationship match Quick Add. The
    // browser label is presentation; the admitted profile is the driver's identity.
    const itemId = generateUniqueId();
    const pos = position ?? (Number(await driverService.getLastDriversItemNumber(id, manager)) || 0) + 1;
    await driverService.createDriversItem(id, profileId, {...fields, id: itemId, pos}, manager);
    return itemId;
}

/** A versioned add has method authority independently of linked detail-page admission. */
export async function createDriversItem(id: string, body: components['schemas']['DriversNewItem'], session: SessionLike,
    prepare?: DriversCommandPreparation<components['schemas']['DriversCreated']>): Promise<components['schemas']['DriversCreated']> {
    actorId(session);
    return withDriversManagement(id, session, async function addItem(manager, list, permissions) {
        if (!mayPerformDriversMethod(permissions, 'addItem')) throw new ApiProblem('FORBIDDEN');
        const itemId = await addDriversItem(id, body, actorId(session), manager);
        return {id: itemId};
    }, prepare);
}

/** Update only submitted fields after root/item locks and fresh method checks.
 * Actor/resource-bound comparisons precede shared sparse persistence; a method
 * grant remains independent of page admission and public actors need no fake profile. */
export async function updateDriversItem(
    id: string,
    itemId: string,
    body: components['schemas']['DriversItemPatch'],
    token: string | undefined,
    session: SessionLike,
    prepare?: DriversCommandPreparation<components['schemas']['MutationResult']>
): Promise<components['schemas']['MutationResult']> {
    return withDriversManagement(id, session, function patchItem(manager, list) {
        return updateListItem(itemId, body, token, session, manager, list, listItemCommandOperations);
    }, prepare);
}

/** Scope the locked item to the requested root, then require its actual delete
 * method grant. The shared hard-delete operation retains its existing cascades. */
export async function deleteDriversItem(id: string, itemId: string, session: SessionLike,
    prepare?: DriversCommandPreparation<components['schemas']['MutationResult']>): Promise<components['schemas']['MutationResult']> {
    return withDriversManagement(id, session, function removeItem(manager, list) {
        return deleteListItem(itemId, session, manager, list, listItemCommandOperations);
    }, prepare);
}

/** Review one complete stored order under the exclusive root/item locks.
 * Versioned item/membership writers use the same root-first path. Legacy direct
 * assignment keeps its separate lock order; direct reorder keeps its partial-order contract. */
export async function reorderDriversItems(
    id: string,
    body: components['schemas']['DriversItemOrder'],
    token: string | undefined,
    session: SessionLike,
    prepare?: DriversCommandPreparation<components['schemas']['MutationResult']>
): Promise<components['schemas']['MutationResult']> {
    return withDriversManagement(id, session, function reorder(manager, list, permissions) {
        return reorderListItems(body, token, session, manager, list, permissions, listItemCommandOperations);
    }, prepare);
}

/** Resolve an opaque assignment handle within this root before checking its
 * item's removal grant. Public method authority does not expose an assignment
 * roster or create personal membership; deletion uses the existing operation. */
export async function deleteDriversAssignment(id: string, assignmentId: string, session: SessionLike,
    prepare?: DriversCommandPreparation<components['schemas']['MutationResult']>): Promise<components['schemas']['MutationResult']> {
    requireListAssignmentHandle(assignmentId);
    return withDriversManagement(id, session, function removeAssignment(manager, list) {
        return deleteListAssignment(assignmentId, session, manager, list, listItemCommandOperations);
    }, prepare);
}

/** Compare only submitted audience masks under the root/ACL coordination lock.
 * Recheck management authority before reading evidence, then use the common
 * matrix owner with its explicitly validated numeric-mask collector. */
export async function updateDriversDefaults(
    id: string,
    body: components['schemas']['PermissionDefaultsPatch'],
    session: SessionLike,
    token?: string,
    prepare?: DriversCommandPreparation<components['schemas']['MutationResult']>
): Promise<components['schemas']['MutationResult']> {
    return withDriversManagement(id, session, async function saveDefaults(manager, list, permissions) {
        if (!mayPerformDriversMethod(permissions, 'managePermissions')) throw new ApiProblem('FORBIDDEN');
        return updateEntityDefaults('drivers', id, body, session, token, manager, {comparisonId: list.id});
    }, prepare);
}

/** Independently granted permission management discloses its audience masks alone. */
export async function readDriversDefaultsBaseline(id: string, session: SessionLike): Promise<components['schemas']['DriversDefaultsBaseline']> {
    async function readDefaults(manager: EntityManager, row: DriversList | null) {
        const list = requireList(row);
        if (!mayPerformDriversMethod(await listPermissions('drivers', manager, list, session), 'managePermissions')) throw new ApiProblem('FORBIDDEN');
        return readEntityDefaultsBaseline('drivers', id, session, manager, {comparisonId: list.id});
    }
    return driverService.withDriversReadSnapshot(id, readDefaults);
}

/** Check method authority before target existence, then disclose only that target's
 * mask/new-grant marker. The same single-target DBAL read serves locked writes. */
export async function readDriversAdminBaseline(id: string, profileId: string, session: SessionLike): Promise<components['schemas']['DriversAdminBaseline']> {
    async function readAdministrator(manager: EntityManager, row: DriversList | null) {
        const list = requireList(row);
        if (!mayPerformDriversMethod(await listPermissions('drivers', manager, list, session), 'managePermissions')) throw new ApiProblem('FORBIDDEN');
        return readEntityAdministratorBaseline('drivers', id, profileId, session, manager, {comparisonId: list.id});
    }
    return driverService.withDriversReadSnapshot(id, readAdministrator);
}

/**
 * Create, update or remove one administrator grant after rechecking the admitted actor
 * under the parent/root locks. Existing grants compare their own mask; absent grants
 * compare the settings baseline. A null mask removes the grant and reports a missing
 * grant as an unchanged result. The DBAL owns only the selected persistence operation.
 */
export async function setDriversAdmin(
    id: string,
    profileId: string,
    mask: number | null,
    session: SessionLike,
    token?: string,
    prepare?: DriversCommandPreparation<components['schemas']['MutationResult']>
): Promise<components['schemas']['MutationResult']> {
    return withDriversManagement(id, session, async function saveAdmin(manager, list, permissions) {
        if (!mayPerformDriversMethod(permissions, 'managePermissions')) throw new ApiProblem('FORBIDDEN');
        return updateEntityAdministrator('drivers', id, profileId, mask, session, token, manager, {comparisonId: list.id});
    }, prepare);
}

/** Authorize scoped administrator discovery before using the secure
 * account search. Its projected options exclude guest credentials and raw emails;
 * the route uses the shared per-IP limiter and admitted API context. */
export async function searchDriversProfiles(id: string, query: string, session: SessionLike): Promise<components['schemas']['DriversProfileOptions']> {
    await driverService.withDriversReadSnapshot(id, async function requireManagement(manager, row) {
        if (!mayPerformDriversMethod(await listPermissions('drivers', manager, requireList(row), session), 'managePermissions')) throw new ApiProblem('FORBIDDEN');
    });
    // Reuse the account-only secure search; no guest-token discovery or raw emails enter this DTO.
    return searchEntityProfiles(query);
}

/** Shared lifecycle/controller owners remain authoritative; adapt only their conflict into the stable contract. */
export async function changeDriversEvent(
    id: string,
    body: components['schemas']['DriversEventChange'],
    session: SessionLike,
    token?: string,
    prepare?: DriversCommandPreparation<components['schemas']['DriversEventChanged']>
): Promise<components['schemas']['DriversEventChanged']> {
    actorId(session);
    const list = requireList(await driverService.getDriversListById(id));
    try {
        /** The shared relink owner already checked source/target method authority;
         * compare only this actor's reviewed association inside those same locks. */
        async function validateContext(manager: EntityManager): Promise<void> {
            const current = requireList(await driverService.getDriversSnapshotRoot(manager, id));
            await listPermissions('drivers', manager, current, session);
            requireFieldComparison(token, await listSettingsToken('drivers', manager, current, session), ['eventId']);
        }

        /** Use the shared admission owner and this transaction's resulting association for the exact v1 receipt. */
        async function prepareEventCompletion(manager: EntityManager, outcome: EntityMutationOutcome): Promise<components['schemas']['DriversEventChanged']> {
            // Membership and grants must be read on the mutation's connection, so a failed
            // projection still rolls back the relink rather than rejecting a committed write.
            const canView = await getEntityViewAdmission('drivers', outcome.root, session, manager) === 'render';
            const result = {changed: outcome.changed, canView};
            prepare?.(result);
            return result;
        }
        return await changeEntityEvent('drivers', list, body, session, undefined, validateContext, {prepare: prepareEventCompletion});
    } catch (error) {
        if (error instanceof APIError && error.status === 409) throw new ApiProblem('RESOURCE_CONFLICT');
        throw error;
    }
}

/**
 * Adapt Drivers archive/restore command to the existing lifecycle controller, keeping
 * its locked authorization and persistence authoritative. The response acknowledges the
 * completed command as the shared workflow does; parent changes and inherited archival
 * retain their separate recovery codes. This operation never performs hard deletion.
 */
export async function setDriversArchived(id: string, archived: boolean, session: SessionLike,
    prepare?: DriversCommandPreparation<components['schemas']['MutationResult']>): Promise<components['schemas']['MutationResult']> {
    actorId(session);

    /** Preserve the existing command acknowledgement, including harmless repeated archive requests. */
    function prepareArchiveCompletion(): components['schemas']['MutationResult'] {
        const result = {changed: true};
        prepare?.(result);
        return result;
    }
    try {
        // The shared owner performs its original business checks/write and prepares
        // this invariant receipt before commit. Drivers needs no later archive DTO.
        const completion = {prepare: prepareArchiveCompletion};
        if (archived) return await archiveEntity({type: 'drivers', id}, {}, session, undefined, completion);
        return await restoreEntity({type: 'drivers', id}, {}, session, completion);
    } catch (error) {
        throw classifyArchiveCommandError(error, archived);
    }
}

/** File replacement persists under the same root lock; unlinking the previous file occurs only after commit. */
export async function setDriversHeader(
    id: string,
    file: Express.Multer.File | undefined,
    session: SessionLike,
    token?: string,
    prepare?: DriversCommandPreparation<components['schemas']['MutationResult']>
): Promise<components['schemas']['MutationResult']> {
    /** Persist the reviewed header through existing root management, returning
     * its prior path after commit so the file-swap owner can retire it safely. */
    async function persistApprovedHeader(listId: string, path?: string | null) {
        return withDriversManagement(listId, session,
        /** Compare current header evidence, save its reference and prepare the receipt inside the lock. */
        async function replaceHeader(manager, list, permissions) {
            // Upload existence does not replace current method authority or the
            // actor-bound comparison on this freshly locked root.
            if (!mayPerformDriversMethod(permissions, 'editHeader')) throw new ApiProblem('FORBIDDEN');
            requireFieldComparison(token, listHeaderToken('drivers', list, session), ['header']);

            await driverService.updateHeaderImage(listId, path, manager);

            // The receipt leaves this callback only after commit. The existing
            // image-swap owner can then remove the confirmed previous file, and
            // retains its file cleanup of this upload when persistence fails.
            const changed = Boolean(file || list.headerImg);
            prepare?.({changed});
            return {previousImage: list.headerImg, changed};
        });
    }

    const result = await performImageSwap({id}, persistApprovedHeader, file);
    return {changed: result.changed};
}

/** A header writer receives only its reviewed field token after a current
 * method check. Upload preflight uses this operation without protected byte reads. */
export async function readDriversHeaderBaseline(id: string, session: SessionLike): Promise<components['schemas']['DriversHeaderBaseline']> {
    return readListHeaderBaseline('drivers', id, session, driversListReadOperations);
}

/** Resolve the stored image only for an actor admitted to the full detail read.
 * Method-only header writers must use their hash baseline rather than this path. */
export async function readDriversHeaderPath(id: string, session: SessionLike): Promise<string> {
    return readListHeaderPath('drivers', id, session, driversListReadOperations);
}

/** Hard deletion stays the simple feature repository operation, separate from archival coordination. */
export async function deleteDriversList(id: string, session: SessionLike, expectedEventId?: string,
    prepare?: DriversCommandPreparation<components['schemas']['MutationResult']>): Promise<components['schemas']['MutationResult']> {
    actorId(session);
    const oldPath = await withListRootLock('drivers', id, async function removeList(manager, row) {
        const list = requireList(row);
        // An Event-hosted command must still address this parent when the existing
        // root lock is acquired. Ordinary Drivers deletion has no parent condition.
        if (expectedEventId !== undefined && list.eventId !== expectedEventId) throw new ApiProblem('ENTITY_CONTEXT_CHANGED');
        // Check the locked current owner, independently of account-only creation admission
        // and administrator grants. Profile ownership also includes an established guest.
        if (!isOwner(session, list.ownerId)) throw new ApiProblem('FORBIDDEN');
        await deleteEntity(list, session, manager);
        prepare?.({changed: true});
        return list.headerImg;
    });
    if (oldPath) removeImage(oldPath);
    return {changed: true};
}
