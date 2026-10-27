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

// src/backend/controller/entityAdminController.ts
import Joi from 'joi';
import {coerceLimit, getHeaderImageVersion, maskEmail, SQL_ALLOW_LIST, sameUuid, uuidKey, resolveCompleteUuidOrder} from '../modules/lib/util';
import type {UserInfo} from '../../types/UserTypes';
import {comparisonActor, comparisonToken, requireComparisonToken, requireFieldComparison} from '../modules/api/transport';
import {getLockedListAssignment} from '../modules/database/services/ListService';
import type {ListPersistenceType, ListRootRows} from '../../types/ListPersistenceTypes';
import type {ListItemCommandOperations} from '../../types/EntityPropertyTypes';
import type {components} from '../../types/api/v1';
import {ApiProblem} from '../modules/api/problem';
import {archiveKey} from '../modules/archive/policy';
import {getArchivePresentations} from '../modules/entityArchival';
import {getEntityViewAdmission, projectCurrentEntityEvent, projectEntitySettingsEvent} from '../modules/event/linkage';
import type {EntityManager} from 'typeorm';
import {Profile} from "../modules/database/entities/user/Profile";
import type {Event} from '../modules/database/entities/event/Event';
import * as entityAdminService from '../modules/database/services/EntityAdminService';
import * as eventService from '../modules/database/services/EventService';
import * as lifecycleService from '../modules/database/services/EntityLifecycleService';
import * as userService from '../modules/database/services/UserService';
import {APIError} from '../modules/lib/errors';
import {getInitialPerms, getPresetMask, PERM, toMask} from "../modules/lib/permissions";
import {requireSessionProfileId} from '../modules/lib/session';
import {assertEditableEntityFields, entityMethodPermission, entityPropertyFields, entityPropertyPermission, permissionDefinitions, evaluateEntities, evaluateSubject, isOwner, saveDefaultPermsFromBody, entityPermissionKey} from '../modules/permissionEngine';
import type {BasicEntityPropertyValues, BasicEntityPropertyField, BasicEntityPropertyPatch, EntityPropertyField, EntityPropertyPresentation, EntityDefaultReviewOptions, EntityAdministratorReviewOptions, ListReadOperations} from '../../types/EntityPropertyTypes';
import type {LockedArchiveContext} from '../../types/ArchiveTypes';
import type {EntityAdministratorCommand, EntityAdministratorOutcome, PermType, PermView, SessionLike} from '../../types/PermissionTypes';
import type {EntityBase} from '../../types/UserTypes';
import type {CombEntityType, EntityType} from "../../types/UtilTypes";

type ListType = 'packing' | 'drivers';
type ListRoot = EntityBase & {archivedAt?: Date | null; event?: {archivedAt?: Date | null} | null};
type ListReadRoot = EntityBase & {archivedAt?: Date | null; event?: Event | null};
type ListReadItem = {id: string; pos: number};

/** Patch only freshly authorized fields of a locked, root-scoped item.
 * Feature callbacks retain their field set, disclosure/token owner and sparse persistence rules. */
export async function updateListItem<Type extends ListPersistenceType, Patch extends object, Values extends object>(
    itemId: string, body: Patch, token: string | undefined, session: SessionLike,
    manager: EntityManager, list: ListRootRows[Type], operations: ListItemCommandOperations<Type, Patch, Values>,
): Promise<{changed: boolean}> {
    const {item} = await getLockedListAssignment(operations.type, manager, itemId, session.profile?.id);
    if (!item || !sameUuid(item.entityId, list.id)) throw new ApiProblem('NOT_FOUND');
    const permissions = await listItemPermissions(operations.type, manager, list, item, session);

    // Method authority precedes comparison, using the same feature-specific field policy as its baseline.
    for (const field of Object.keys(body) as (keyof Patch)[]) {
        if (!operations.mayEditField(permissions, field)) throw new ApiProblem('FORBIDDEN');
    }
    const projection = operations.projectItem(item, permissions);
    requireFieldComparison(token, operations.itemToken(list, item, session, projection.values), Object.keys(body));

    // Keep numeric drafts and retained assignments in the existing feature persistence operation.
    const changed = await operations.applyPatch(item.id, body, {kind: 'versioned', manager, item});
    return {changed};
}

/** Delete one locked item only after its actual method grant, retaining the feature's existing cascades. */
export async function deleteListItem<Type extends ListPersistenceType, Patch extends object, Values extends object>(
    itemId: string, session: SessionLike, manager: EntityManager,
    list: ListRootRows[Type], operations: ListItemCommandOperations<Type, Patch, Values>,
): Promise<{changed: boolean}> {
    const {item} = await getLockedListAssignment(operations.type, manager, itemId, session.profile?.id);
    if (!item || !sameUuid(item.entityId, list.id)) throw new ApiProblem('NOT_FOUND');
    // The root relationship supplies scope, while the item's effective grants supply deletion authority.
    if (!operations.capabilities(await listItemPermissions(operations.type, manager, list, item, session)).removeItem) throw new ApiProblem('FORBIDDEN');
    await operations.deleteItem(item.id, manager);
    return {changed: true};
}

/** Compare one complete locked order before the feature's existing per-row write operation.
 * Unchanged reviewed orders perform no timestamp-only write; direct partial ordering stays separate. */
export async function reorderListItems<Type extends ListPersistenceType, Patch extends object, Values extends object>(
    body: {itemIds: string[]}, token: string | undefined, session: SessionLike, manager: EntityManager,
    list: ListRootRows[Type], permissions: PermView, operations: ListItemCommandOperations<Type, Patch, Values>,
): Promise<{changed: boolean}> {
    if (!operations.mayPerform(permissions, 'reorderItems')) throw new ApiProblem('FORBIDDEN');
    // Hold every compared child lock through the same root-coordinated write sequence.
    const items = await operations.items(manager, list.id, true);
    requireComparisonToken(token, operations.orderToken(list, items, session));
    const ordered = resolveCompleteUuidOrder(body.itemIds, items);
    if (!ordered) throw new ApiProblem('RESOURCE_CONFLICT');

    // Preserve each feature's existing sequential/concurrent DBAL write implementation.
    const changed = ordered.some((item, position) => !sameUuid(items[position]?.id, item.id));
    if (changed) await operations.reorder(list.id, ordered.map((item, position) => ({itemId: item.id, position})), manager);
    return {changed};
}

/** Validate opaque numeric assignment handles before the caller enters its root transaction. */
export function requireListAssignmentHandle(assignmentId: string): void {
    if (!/^[1-9][0-9]*$/.test(assignmentId) || !Number.isSafeInteger(Number(assignmentId))) throw new ApiProblem('VALIDATION_FAILED');
}

/** Remove a root-scoped assignment after locking its actual item and checking the feature's removal grant. */
export async function deleteListAssignment<Type extends ListPersistenceType, Patch extends object, Values extends object>(
    assignmentId: string, session: SessionLike, manager: EntityManager,
    list: ListRootRows[Type], operations: ListItemCommandOperations<Type, Patch, Values>,
): Promise<{changed: boolean}> {
    const assignment = await operations.assignment(Number(assignmentId), manager);
    if (!assignment || !sameUuid(assignment.item.entityId, list.id)) throw new ApiProblem('NOT_FOUND');
    // A membership on another root supplies neither scope nor item authority.
    const {item} = await getLockedListAssignment(operations.type, manager, assignment.itemId, session.profile?.id);
    if (!item || !operations.capabilities(await listItemPermissions(operations.type, manager, list, item, session)).removeAssignments) throw new ApiProblem('FORBIDDEN');
    await operations.deleteAssignment(String(assignmentId), manager);
    return {changed: true};
}

/** Root field projection discloses only values permitted by the existing shared property policy. */
export function listMetadataProjection<Type extends ListType>(type: Type, list: ListRoot, permissions: PermView) {
    const values: BasicEntityPropertyValues = {};
    const editableFields: BasicEntityPropertyField[] = [];
    // Copy each value only after its direct field grant, retaining title/description disclosure order.
    for (const field of ['title', 'description'] as const) {
        if (!permissions.has(entityPropertyPermission(type, field)!)) continue;
        editableFields.push(field);
        if (field === 'title') values.title = list.title;
        else values.description = list.description ?? null;
    }
    return {entityType: type, id: list.id, values, editableFields, currentEventId: list.eventId ?? null,
        archived: Boolean(list.archivedAt), inheritedArchived: Boolean(list.event?.archivedAt)};
}

/** Presentation context hashes retain conditional reads while sparse writes compare submitted fields only. */
export function listMetadataResult<Type extends ListType>(type: Type, list: ListRoot, permissions: PermView, session: SessionLike) {
    const data = listMetadataProjection(type, list, permissions);
    const etag = comparisonToken(`${type}-meta`, list.id, session, {...data.values,
        currentEventId: data.currentEventId, archived: data.archived, inheritedArchived: data.inheritedArchived});
    return {data, etag};
}

/** Reuse form trimming/clearing before generated validation; JSON omission never becomes a stored undefined. */
export function normalizeListMetadataPatch(body: unknown): unknown {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
    const fields = {...body} as Record<string, unknown>;
    // JSON cannot carry undefined, so v1 treats these keys as omitted. The separate
    // direct adapter retains its original own-key validation.
    for (const [key, value] of Object.entries(fields)) if (value === undefined) delete fields[key];
    // Keep the existing form semantics: trim titles and interpret an empty description as an explicit clear.
    if (typeof fields.title === 'string') fields.title = fields.title.trim();
    if (fields.description === '') fields.description = null;
    return fields;
}

/** Reject a disappeared or reassociated root after the DBAL acquires its existing parent/root locks. */
export function assertListContext(context: LockedArchiveContext): void {
    if (!context.root) throw new ApiProblem('NOT_FOUND');
    if (context.initialEventId !== context.root.eventId && !sameUuid(context.initialEventId, context.root.eventId)
        || (context.root.eventId && !context.parents.has(uuidKey(context.root.eventId)))) throw new ApiProblem('ENTITY_CONTEXT_CHANGED');
}

/** Evaluate current root grants on the supplied snapshot, independently of page/profile admission. */
export function listPermissions(type: ListType, manager: EntityManager, list: EntityBase,
    session: SessionLike, caches?: import('../../types/PermissionTypes').PermEngineCaches): Promise<PermView> {
    comparisonActor(session);
    return evaluateSubject({kind: 'entity', entity: {entityType: type, entityId: list.id,
        ownerId: list.ownerId, eventId: list.eventId}}, session, caches, manager);
}

/** Page reads require an actor and the existing feature admission before any detail projection. */
export async function authorizeListRead(type: ListType, manager: EntityManager, list: EntityBase,
    session: SessionLike, caches?: import('../../types/PermissionTypes').PermEngineCaches): Promise<PermView> {
    if (!session.profile?.id) throw new ApiProblem('AUTH_REQUIRED');
    const permissions = await listPermissions(type, manager, list, session, caches);
    if (await getEntityViewAdmission(type, list, session, manager, permissions) !== 'render') throw new ApiProblem('FORBIDDEN');
    return permissions;
}

/** Common item subject construction leaves each feature's method/fallback grants with its policy table. */
export function listItemPermissions(type: ListType, manager: EntityManager, list: EntityBase,
    item: {id: string; profileId: string}, session: SessionLike,
    caches?: import('../../types/PermissionTypes').PermEngineCaches): Promise<PermView> {
    return evaluateSubject({kind: 'item', item: {entityType: `${type}Item`, entityId: item.id,
        ownerId: item.profileId, eventId: list.eventId}, parent: {entityType: type, entityId: list.id,
        ownerId: list.ownerId, eventId: list.eventId}}, session, caches, manager);
}

/** Project authorized header addresses and opaque versions, never stored filesystem paths. */
export function listHeaderProjection(type: ListType, list: EntityBase) {
    return {headerUrl: list.headerImg ? `/api/v1/${type}-lists/${encodeURIComponent(list.id)}/header` : null,
        headerVersion: getHeaderImageVersion(list.headerImg)};
}

/** Settings admission preserves independent ownership and account-only duplication without exposing ACL data. */
export function mayOpenListSettings(type: ListType, list: EntityBase, permissions: PermView, session: SessionLike): boolean {
    return permissions.has(entityPropertyPermission(type, 'title')!)
        || permissions.has(entityPropertyPermission(type, 'description')!)
        || permissions.allow(entityMethodPermission('editHeader'))
        || permissions.allow(entityMethodPermission('changeEvent'))
        || permissions.allow(entityMethodPermission('managePermissions'))
        || isOwner(session, list.ownerId)
        || Boolean(session.auth?.user && permissions.allow(entityMethodPermission('duplicate')));
}

/** Include private audience hashes only when the already admitted caller may manage that matrix. */
export async function listSettingsToken(type: ListType, manager: EntityManager, list: EntityBase,
    session: SessionLike, includeAccess = false): Promise<string> {
    const defaults = includeAccess ? completeDefaults(await entityAdminService.getDefaultPerms(type, list.id, manager)) : null;
    return comparisonToken(`${type}-settings`, uuidKey(list.id), session, {...(defaults ? defaultPermissionValues(defaults) : {}),
        header: list.headerImg ?? null, eventId: list.eventId ?? null, ...(includeAccess ? {newAdmin: null} : {})});
}

/** Read root metadata in the feature's existing snapshot after its profile admission.
 * Independent editors receive their permitted baseline; noneditors retain page admission. */
export async function readListMetadata<Type extends ListType, Root extends ListReadRoot, Item extends ListReadItem, Description>(
    type: Type, id: string, session: SessionLike, operations: ListReadOperations<Root, Item, Description>) {
    // Mixed metadata retains its profile requirement before any database read.
    operations.requireProfile(session);

    /** Evaluate fields before falling back to the existing page-admission check. */
    async function readSnapshot(manager: EntityManager, row: Root | null) {
        const list = operations.requireRoot(row);
        const permissions = await listPermissions(type, manager, list, session);
        // A separately granted editor does not need the linked detail page.
        if (!listMetadataProjection(type, list, permissions).editableFields.length) await authorizeListRead(type, manager, list, session);
        return listMetadataResult(type, list, permissions, session);
    }
    return operations.withSnapshot(id, readSnapshot);
}

/** Read only the independently granted description without adding profile/page admission.
 * The feature's existing projector supplies the same token used by its metadata writer. */
export async function readListDescription<Root extends ListReadRoot, Item extends ListReadItem, Description>(
    type: ListType, id: string, session: SessionLike, operations: ListReadOperations<Root, Item, Description>): Promise<Description> {
    /** Resolve the root and current method grant before projecting this one field. */
    async function readDescription(manager: EntityManager, row: Root | null) {
        const list = operations.requireRoot(row);
        const permissions = await listPermissions(type, manager, list, session);
        if (!operations.mayPerform(permissions, 'editDescription')) throw new ApiProblem('FORBIDDEN');
        return operations.descriptionBaseline(list, session);
    }
    return operations.withSnapshot(id, readDescription);
}

/** Read complete ID/position evidence only after the feature's independent reorder grant.
 * Its existing item query and read/write token owner retain ordering and identity semantics. */
export async function readListOrderBaseline<Root extends ListReadRoot, Item extends ListReadItem, Description>(
    type: ListType, id: string, session: SessionLike, operations: ListReadOperations<Root, Item, Description>) {
    /** Keep scope, current authority and ordered items inside the same read snapshot. */
    async function readSnapshot(manager: EntityManager, row: Root | null) {
        const list = operations.requireRoot(row);
        const permissions = await listPermissions(type, manager, list, session);
        if (!operations.mayPerform(permissions, 'reorderItems')) throw new ApiProblem('FORBIDDEN');
        const items = await operations.items(manager, id);

        // Titles, assignments and parent fields never enter a method-only baseline.
        return {items: items.map(item => ({id: item.id, position: item.pos})), orderToken: operations.orderToken(list, items, session)};
    }
    return operations.withSnapshot(id, readSnapshot);
}

/** Build the public creation permission definitions for one feature without resource reads or admission. */
export function entityCreationPermissionContext(type: Exclude<EntityType, 'survey'>): components['schemas']['EntityCreationContext'] {
    return {defaults: completeDefaults(getInitialPerms(type)), ...permissionDefinitions()};
}

/** Read and project an already admitted settings ACL, preserving administrator-before-default reads.
 * Callers retain grants/snapshots and explicitly select their existing token identity. */
export async function readEntitySettingsAccess(type: Exclude<EntityType, 'survey'>, id: string, session: SessionLike,
    manager?: EntityManager, comparisonId = id): Promise<components['schemas']['EntityAccess']> {
    // Keep both reads on the caller's optional manager. Activity deliberately
    // retains its direct path rather than acquiring a list/Event snapshot here.
    const admins = await entityAdminService.listAdmins(type, id, manager);
    const defaults = completeDefaults(await entityAdminService.getDefaultPerms(type, id, manager));

    // Each feature supplies its existing comparison reference. The shared token
    // owner keys typed UUID components consistently with narrow reads and writes.
    return {
        defaults,
        ...permissionDefinitions(),
        admins: admins.map(admin => ({
            profileId: admin.profileId,
            name: admin.profile.name,
            isGuest: Boolean(admin.profile.guestId),
            mask: admin.perms,
            editToken: entityAdministratorToken(type, comparisonId, admin.profileId, admin.perms, session),
        })),
    };
}

/** Read the matching list settings workflow on its existing feature snapshot.
 * Profile admission precedes reads; parent, lifecycle and ACL projections retain
 * their independent privacy checks and the original request/stored ID spellings. */
export async function readListSettings<Root extends ListReadRoot, Item extends ListReadItem, Description>(
    type: ListType, id: string, session: SessionLike, operations: ListReadOperations<Root, Item, Description>) {
    // Public writers use narrow baselines; the full setup remains profile-only.
    operations.requireProfile(session);

    /** Build settings from this admitted root, keeping parent/lifecycle/ACL reads
     * on the supplied snapshot manager and disclosing each private region only
     * after its existing grant. Comparison scopes retain their original IDs. */
    async function readSettings(manager: EntityManager, row: Root | null) {
        const list = operations.requireRoot(row);
        const permissions = await listPermissions(type, manager, list, session);
        if (!mayOpenListSettings(type, list, permissions, session)) throw new ApiProblem('FORBIDDEN');

        // Child management never discloses parent fields without the parent's own grants.
        let currentEvent: ReturnType<typeof projectEntitySettingsEvent> = null;
        if (list.event) {
            const views = await evaluateEntities([{entityType: 'event', entityId: list.event.id, ownerId: list.event.ownerId, eventId: list.event.id}], session, manager);
            currentEvent = projectEntitySettingsEvent(projectCurrentEntityEvent(list.event, views.get(entityPermissionKey('event', list.event.id))!));
        }

        // Resolve lifecycle only after parent projection, on this same manager.
        const reference = {type, id};
        const snapshot = await lifecycleService.getArchiveSnapshot([reference], manager);
        const archive = (await getArchivePresentations([reference], session, snapshot, manager)).get(archiveKey(reference))!;

        // ACL identities and their tokens require permission management. Preserve
        // administrator-before-default reads and the loaded-root comparison scope.
        let access: components['schemas']['EntityAccess'] | null = null;
        if (operations.mayPerform(permissions, 'managePermissions')) {
            access = await readEntitySettingsAccess(type, id, session, manager, list.id);
        }

        // Settings review shares the stored root identity. Keep this later read,
        // field order and method checks after the independently admitted ACL projection.
        return {
            id,
            title: list.title,
            settingsToken: await listSettingsToken(type, manager, list, session, operations.mayPerform(permissions, 'managePermissions')),
            ...listHeaderProjection(type, list),
            editableFields: listMetadataProjection(type, list, permissions).editableFields,
            capabilities: {
                editHeader: operations.mayPerform(permissions, 'editHeader'),
                linkEvent: operations.mayPerform(permissions, 'changeEvent'),
                managePermissions: operations.mayPerform(permissions, 'managePermissions'),
                duplicate: Boolean(session.auth?.user && operations.mayPerform(permissions, 'duplicate')),
                // Deletion is profile-owned, including guest owners.
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
    }
    return operations.withSnapshot(id, readSettings);
}

/** Fill absent audience masks for presentation; sparse writes retain omission. */
export function completeDefaults(defaults: Partial<components['schemas']['PermissionDefaults']>): components['schemas']['PermissionDefaults'] {
    return {public: defaults.public ?? 0, guest: defaults.guest ?? 0,
        authenticated: defaults.authenticated ?? 0, participant: defaults.participant ?? 0};
}

/** Use one audience-field vocabulary in full settings, narrow baselines and sparse writes. */
export function defaultPermissionValues(defaults: components['schemas']['PermissionDefaults']): Record<string, number> {
    return Object.fromEntries(Object.entries(defaults).map(([audience, mask]) => [`default:${audience}`, mask]));
}

/** Read already admitted permission data; feature owners retain their page/method checks and snapshots. */
export async function readEntityDefaultsBaseline(type: EntityType, id: string, session: SessionLike,
    manager?: EntityManager, comparison: EntityDefaultReviewOptions = {}) {
    // Read masks first; Event's explicit token callback retains its subsequent full-settings read.
    const defaultPermissions = completeDefaults(await entityAdminService.getDefaultPerms(type, id, manager));
    const editToken = comparison.prepareToken ? await comparison.prepareToken()
        : comparisonToken(`${type}-settings`, uuidKey(comparison.comparisonId ?? id), session, defaultPermissionValues(defaultPermissions));
    return {defaultPermissions, editToken};
}

/** Compare submitted audiences and persist only their numeric masks on the feature's existing manager. */
export async function updateEntityDefaults(type: EntityType, id: string,
    defaults: components['schemas']['PermissionDefaultsPatch'], session: SessionLike, token?: string,
    manager?: EntityManager, comparison: EntityDefaultReviewOptions = {}) {
    // Omitted audiences retain their original values and never enter the comparison.
    const current = completeDefaults(await entityAdminService.getDefaultPerms(type, id, manager));
    const currentToken = comparison.prepareToken ? await comparison.prepareToken()
        : comparisonToken(`${type}-settings`, uuidKey(comparison.comparisonId ?? id), session, defaultPermissionValues(current));
    requireFieldComparison(token, currentToken, Object.keys(defaults).map(audience => `default:${audience}`));

    // The existing collector retains all storage semantics; this owner shares only
    // the versioned review and result policy, without adding a transaction or lock.
    await saveDefaultPermsFromBody(type, id, {defaultPerms: defaults}, {manager, inputFormat: 'masks'});
    return {changed: Object.keys(defaults).some(audience => defaults[audience as keyof typeof defaults]
        !== current[audience as keyof typeof current])};
}

/** Keep existing zero grants distinct from an absent row in every feature's comparison scope. */
export function entityAdministratorToken(type: EntityType, id: string, profileId: string,
    mask: number | null, session: SessionLike): string {
    // Normalize resource/profile references before hashing; submitted token bytes
    // and captured actor/context evidence retain their exact comparison semantics.
    return mask === null ? comparisonToken(`${type}-settings`, uuidKey(id), session, {newAdmin: null})
        : comparisonToken(`${type}-admin`, `${uuidKey(id)}:${uuidKey(profileId)}`, session, {mask});
}

/** Features admit the method first; then this owner preserves profile-first baseline disclosure. */
export async function readEntityAdministratorBaseline(type: EntityType, id: string,
    profileId: string, session: SessionLike, manager?: EntityManager,
    comparison: Pick<EntityAdministratorReviewOptions, 'comparisonId'> = {}) {
    // A missing profile precedes grant disclosure. An existing zero mask remains a real baseline.
    if (!await userService.getProfileById(profileId, manager)) throw new ApiProblem('NOT_FOUND');
    const current = await entityAdminService.getAdminGrant(type, id, profileId, manager);
    const mask = current?.perms ?? null;
    return {mask, editToken: entityAdministratorToken(type, comparison.comparisonId ?? id, profileId, mask, session)};
}

/**
 * Apply one reviewed administrator command after feature admission. Locked callers
 * validate profile existence before review; Activity explicitly retains its legacy
 * review-first order. No transaction, lock, save interceptor or receipt is introduced.
 */
export async function updateEntityAdministrator(type: EntityType, id: string, profileId: string,
    mask: number | null, session: SessionLike, token?: string, manager?: EntityManager,
    comparison: EntityAdministratorReviewOptions = {}) {
    let previousMask: number | null = null;
    /** Compare exactly the existing row or new-grant marker before selecting persistence. */
    async function reviewGrant(): Promise<EntityAdministratorCommand> {
        const current = await entityAdminService.getAdminGrant(type, id, profileId, manager);
        previousMask = current?.perms ?? null;
        requireFieldComparison(token, entityAdministratorToken(type, comparison.comparisonId ?? id, profileId, previousMask, session),
            [current ? 'mask' : 'newAdmin']);
        return mask === null ? {kind: 'remove'}
            : {kind: current ? 'update' : 'add', mask, createdBy: session.profile?.userId};
    }

    // The caller explicitly selects its recorded validation order. In particular,
    // sharing this implementation must not add locking to Activity's direct path.
    const initial: EntityAdministratorCommand = mask === null ? {kind: 'remove'}
        : {kind: 'add', mask, createdBy: session.profile?.userId};
    const outcome = comparison.reviewOrder === 'review-first'
        ? await applyEntityAdministrator(type, id, profileId, await reviewGrant(), manager)
        : await applyEntityAdministrator(type, id, profileId, initial, manager, reviewGrant);
    if (outcome === 'profile-missing') throw new ApiProblem('NOT_FOUND');
    if (outcome === 'mask-required') throw new ApiProblem('VALIDATION_FAILED');
    return {changed: previousMask !== mask};
}

/** Render a valid instant as edit-parser wall time, falling back to UTC for an
 * unsupported zone. Missing/invalid instants have no input value and return null. */
export function deadlineInputValue(value: unknown, timezone: unknown): string | null {
    // Missing/invalid instants have no edit value. Formatting never turns them
    // into a default date or rewrites the persisted deadline.
    if (!value) return null;
    const date = new Date(value as string | Date);
    if (!Number.isFinite(date.getTime())) return null;
    // Use the selected zone when Intl accepts it; the existing UTC fallback
    // keeps a valid instant editable even if its stored zone is unsupported.
    let formatter: Intl.DateTimeFormat;
    try {
        formatter = new Intl.DateTimeFormat('en-CA', {timeZone: String(timezone || 'UTC'), hourCycle: 'h23',
            year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'});
    } catch {
        formatter = new Intl.DateTimeFormat('en-CA', {timeZone: 'UTC', hourCycle: 'h23',
            year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'});
    }
    // Build the datetime-local wall value from named parts, independent of
    // locale punctuation or the server's own display zone.
    const parts = new Map(formatter.formatToParts(date).map(part => [part.type, part.value]));
    return `${parts.get('year')}-${parts.get('month')}-${parts.get('day')}T${parts.get('hour')}:${parts.get('minute')}:${parts.get('second')}`;
}

/** Shared title/description normalization for the otherwise undated root features. */
export function normalizeBasicProperties(body: unknown): BasicEntityPropertyPatch {
    const schema = Joi.object({title: Joi.string().trim().min(1).max(255), description: Joi.string().max(16000).allow('', null)})
        .min(1).unknown(false).required();
    const {value, error} = schema.validate(body, {abortEarly: false});
    if (error) {
        // Preserve shared validation while identifying only the authored field
        // and rule for an actionable, value-free versioned explanation.
        const detail = error.details[0];
        const cause = detail?.path[0] === 'title' ? 'ENTITY_TITLE_INVALID'
            : detail?.path[0] === 'description' && detail.type === 'string.max' ? 'ENTITY_DESCRIPTION_TOO_LONG' : undefined;
        throw new APIError(error.message, {}, 400, {cause});
    }
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
    assertEditableEntityFields(type, body, permissions, isOwner(session, entity.ownerId));
}

/** Only editable values enter the projection. Ordinary pages retain profile-based
 * control admission; a method baseline exposes only independently granted fields
 * using the same policy/formatter, without granting broader page access. */
export async function getEntityPropertyPresentation(type: EntityType, entity: EntityBase, session: SessionLike,
    manager?: EntityManager, fieldScope: 'page' | 'method' = 'page'): Promise<EntityPropertyPresentation> {
    const permissions = await evaluateSubject({kind: 'entity', entity: {
        entityType: type, entityId: entity.id, ownerId: entity.ownerId,
        eventId: type === 'event' ? entity.id : entity.eventId,
    }}, session, undefined, manager);
    const owner = isOwner(session, entity.ownerId);
    const editableFields: EntityPropertyField[] = [];
    const values: EntityPropertyPresentation['values'] = {};
    // Project each individually admitted field, preserving Survey ownership and
    // the distinction between page controls and independently granted method baselines.
    const source = entity as EntityBase & Record<string, unknown>;
    for (const [field, permission] of entityPropertyFields(type)) {
        if (fieldScope === 'page' && !session.profile || !(type === 'survey' ? owner : permissions.has(permission))) continue;
        const key = field as EntityPropertyField;
        editableFields.push(key);
        const value = source[key === 'deadlineTz' ? 'timezone' : key];
        values[key] = value instanceof Date ? value.toISOString() : value as string | number | boolean | null ?? null;
        if (key === 'bindingDeadline') values[key] = deadlineInputValue(value, source.timezone);
        if (key === 'deadlineTz') values[key] = (value as string) || 'UTC';
    }
    // The saved relationship supplies identity only. Parent labels/navigation
    // require the parent's own permission view on this same optional manager.
    const canLinkEvent = !!session.profile && ['activity', 'packing', 'drivers'].includes(type) && permissions.has(entityMethodPermission('changeEvent'));
    let currentEvent: EntityPropertyPresentation['currentEvent'] = null;
    if (session.profile && entity.eventId) {
        currentEvent = {id: entity.eventId};
        const event = await eventService.getEventById(entity.eventId, manager);
        if (event) {
            const parentPermissions = await evaluateSubject({kind: 'entity', entity: {
                entityType: 'event', entityId: event.id, ownerId: event.ownerId, eventId: event.id,
            }}, session, undefined, manager);
            currentEvent = projectCurrentEntityEvent(event, parentPermissions);
        }
    }
    // Capabilities retain their distinct actor/method requirements; having one
    // editable value does not imply export, deletion, duplication or ACL authority.
    return {
        entityType: type, id: entity.id, updateUrl: `/api/${type}/${entity.id}/update`,
        eventUrl: canLinkEvent ? `/api/${type}/${entity.id}/event` : undefined,
        exportUrl: type === 'activity' && permissions.has('DATA_EXPORT') ? `/activity/${entity.id}/export/schedule`
            : type === 'event' && permissions.has('DATA_EXPORT') && permissions.has('ACCESS_PARTICIPANTS') ? `/event/${entity.id}/export/participants` : undefined,
        exportLabel: type === 'activity' ? 'Export schedule' : 'Export participants',
        values, editableFields, canEditProperties: editableFields.length > 0, canLinkEvent,
        canEditHeader: !!session.profile && permissions.has(entityMethodPermission('editHeader')),
        canDuplicate: !!session.auth?.user && permissions.has(entityMethodPermission('duplicate')),
        canDelete: owner, canManagePermissions: type !== 'survey' && !!session.profile && permissions.has(entityMethodPermission('managePermissions')), currentEvent,
    };
}

/** Adapt the shared method declaration to the permission middleware's bitmask input. */
export function requiredAdminManagePerm() {
    return PERM[entityMethodPermission('managePermissions')];
}

/** One controller-owned administrator operation for normalized direct/versioned intent.
 * The profile check and required mask have one owner. A versioned caller may
 * compare its reviewed grant and choose add/update inside its existing locked
 * transaction; direct callers retain their direct command and persistence defaults.
 * Domain outcomes leave each adapter's established error/feedback shape unchanged. */
export async function applyEntityAdministrator(
    entityType: CombEntityType, entityId: string, profileId: string,
    command: EntityAdministratorCommand, manager?: EntityManager,
    reviewCurrentGrant?: () => Promise<EntityAdministratorCommand | void>,
): Promise<EntityAdministratorOutcome> {
    // Both adapters retain profile-first diagnostics. The optional review callback
    // runs only after this evidence and inside the supplied caller transaction.
    const profile = await userService.getProfileById(profileId, manager);
    if (!profile) return 'profile-missing';

    const approved = await reviewCurrentGrant?.() ?? command;
    if (approved.kind !== 'remove' && approved.mask === undefined) return 'mask-required';

    // Persist normalized intent through the existing DBAL. Zero is a stored mask;
    // only an explicit remove command selects deletion.
    if (approved.kind === 'remove') {
        await entityAdminService.removeAdmin(entityType, entityId, profileId, manager);
    } else if (approved.kind === 'add') {
        await entityAdminService.addAdmin(entityType, entityId, profile.id, approved.mask!, approved.createdBy, manager);
    } else {
        await entityAdminService.updateAdminPerms(entityType, entityId, profileId, approved.mask!, manager);
    }
    return 'saved';
}

/** Direct adapters preserve the original profile-first errors and operation receipts. */
function requireAdministratorOutcome(outcome: EntityAdministratorOutcome): void {
    if (outcome === 'profile-missing') throw new Error('Not Found');
    if (outcome === 'mask-required') throw new Error('Either mask or perms must be provided');
}

/** Add one administrator using the form collector and direct error interpretation. */
export async function addAdmin(entityType: CombEntityType, entityId: string, body: any, creator?: Profile | null) {
    const schema = Joi.object({
        profileId: Joi.string().uuid().required(),
        preset: Joi.string().trim().optional(),
        perms: Joi.array().items(Joi.string()).optional(),     // explicit keys override preset
        mask: Joi.number().integer().min(0).optional(),        // optional direct mask
    });

    const {value, error} = schema.validate(body, {abortEarly: false, allowUnknown: true});
    if (error) throw new Error(error.details.map(d => d.message).join(', '));

    // Choose mask: explicit mask > perms keys > preset > 0
    let mask = 0;
    if (typeof value.mask === 'number') mask = value.mask;
    else if (Array.isArray(value.perms)) mask = toMask(value.perms);
    else if (value.preset) {
        const presetMask = (getPresetMask(value.preset)) ?? 0;
        mask = presetMask;
    }

    const outcome = await applyEntityAdministrator(entityType, entityId, value.profileId,
        {kind: 'add', mask, createdBy: creator?.userId});
    requireAdministratorOutcome(outcome);
    return 'Admin added';
}

/** Decode mask/key form input and preserve its validation wording. The common
 * command owner checks target existence before reporting a missing mask. */
export async function updateAdmin(entityType: CombEntityType, entityId: string, profileId: string, body: any) {
    const schema = Joi.object({
        perms: Joi.array().items(Joi.string()).optional(),
        mask: Joi.number().integer().min(0).optional(),
    });

    const {value, error} = schema.validate(body, {abortEarly: false, allowUnknown: true});
    if (error) throw new Error(error.details.map(d => d.message).join(', '));

    let mask: number | undefined;
    if (typeof value.mask === 'number') mask = value.mask;
    else if (Array.isArray(value.perms)) mask = toMask(value.perms);

    const outcome = await applyEntityAdministrator(entityType, entityId, profileId, {kind: 'update', mask});
    requireAdministratorOutcome(outcome);
    return 'Permissions updated';
}

/** Direct removal shares profile-first validation and persistence, while keeping
 * its established literal acknowledgement even when no grant row remains. */
export async function removeAdmin(entityType: CombEntityType, entityId: string, profileId: string) {
    const outcome = await applyEntityAdministrator(entityType, entityId, profileId, {kind: 'remove'});
    requireAdministratorOutcome(outcome);
    return 'Admin removed';
}

/** Admit the existing search shape and project safe account-only choices in one business owner. */
export async function searchUsers(q: string, limit = 10): Promise<UserInfo[]> {
    // Preserve trimming, the existing minimum/character rule and bounded limit before SQL.
    const query = String(q || '').trim();
    if (!query || !SQL_ALLOW_LIST.test(query)) return [];
    const rows = await userService.queryUserProfiles(query, coerceLimit(limit, 10, 25));
    // Account candidates retain the legacy masked-mail fallback without exposing full ORM records.
    return rows.map(profile => ({id: profile.id, name: profile.name,
        username: profile.user?.username ?? profile.guest?.username ?? '-',
        email: profile.user?.email ? maskEmail(profile.user.email)
            : profile.guest?.email ? maskEmail(profile.guest.email) : '-'}));
}

/** Project the same admitted account search into feature options without exposing even masked email fields. */
export async function searchEntityProfiles(query: string): Promise<components['schemas']['EntityAdministratorProfileOptions']> {
    // Retain the established search and masking work; only this shared wire projection removes the unused address.
    return (await searchUsers(query)).map(profile => ({profileId: profile.id, name: profile.name,
        username: profile.username, isGuest: false}));
}
