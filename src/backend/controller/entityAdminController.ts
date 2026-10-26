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
import {coerceLimit, getHeaderImageVersion, maskEmail, SQL_ALLOW_LIST} from '../modules/lib/util';
import type {UserInfo} from '../../types/UserTypes';
import {createHash} from 'node:crypto';
import type {components} from '../../types/api/v1';
import {ApiProblem, declaredApiProblem} from '../modules/api/problem';
import {contractValidator} from '../modules/api/contracts';
import {archiveKey, automaticArchiveCutoff, isEffectivelyArchived} from '../modules/archive/policy';
import type {EntityManager} from 'typeorm';
import {invalidateGeneratedRecommendations} from '../modules/database/services/ActivityRecommendationService';
import {Profile} from "../modules/database/entities/user/Profile";
import type {Event} from '../modules/database/entities/event/Event';
import * as entityAdminService from '../modules/database/services/EntityAdminService';
import * as eventService from '../modules/database/services/EventService';
import * as lifecycleService from '../modules/database/services/EntityLifecycleService';
import * as userService from '../modules/database/services/UserService';
import {APIError} from '../modules/lib/errors';
import {getPermMeta, getPresets, getPresetMask, PERM, toMask} from "../modules/lib/permissions";
import {requireSessionProfileId} from '../modules/lib/session';
import {evaluateEntities, evaluateSubject, saveDefaultPermsFromBody} from '../modules/permissionEngine';
import type {BasicEntityPropertyPatch, EntityEventChangeResult, EntityMutationCompletion, EntityPropertyField, EntityPropertyPresentation, EntityDefaultReviewOptions, EntityAdministratorReviewOptions} from '../../types/EntityPropertyTypes';
import type {ArchivePresentation, ArchiveReference, ArchiveSnapshotEntry, ArchiveState, ArchiveTarget, LockedArchiveContext} from '../../types/ArchiveTypes';
import type {EntityAdministratorCommand, EntityAdministratorOutcome, EntityDescriptor, PermType, PermView, SessionLike} from '../../types/PermissionTypes';
import type {Entity, EntityBase, EntityViewAdmission} from '../../types/UserTypes';
import type {CombEntityType, EntityType} from "../../types/UtilTypes";

type ListType = 'packing' | 'drivers';
type ListRoot = EntityBase & {archivedAt?: Date | null; event?: {archivedAt?: Date | null} | null};

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

// These methods are already shared by feature operations. Keep their grant
// definitions in this controller so a migrated capability/command cannot drift
// from the direct adapter while retaining each method's distinct admission checks.
const entityMethodPermissions = {
    editHeader: 'EDIT_META',
    changeEvent: 'EDIT_META',
    managePermissions: 'MANAGE_PERMISSIONS',
    duplicate: 'DATA_DUPLICATE',
} as const;

/** Return the existing shared method's grant without exposing mutable policy.
 * Callers still own profile/page admission and the permission engine owns grant
 * evaluation; choosing one method never grants another method's authority. */
export function entityMethodPermission(method: keyof typeof entityMethodPermissions): PermType {
    return entityMethodPermissions[method];
}

/** Hash canonical machine data; translated labels do not change edit evidence. */
export function entityTag(scope: string, value: unknown): string {
    return `"${scope}-${createHash('sha256').update(JSON.stringify(value)).digest('base64url')}"`;
}

/**
 * Preserve profile and frontend-context comparison scopes without creating an
 * anonymous identity. Current grants remain mandatory for public baselines.
 */
export function comparisonActor(session: SessionLike): string | {context: string} | null {
    if (session.profile?.id) return session.profile.id;
    if ('context' in session && typeof session.context === 'string' && session.context) {
        return {context: session.context};
    }
    if (!session.auth?.user && !session.auth?.guest) return null;
    throw new ApiProblem('AUTH_REQUIRED');
}

/**
 * Bind hashed current values to an operation, resource and admitted actor. Public
 * projections also bind their available field set; tokens never grant authority.
 */
export function comparisonToken(scope: string, id: string, session: SessionLike, values: Record<string, unknown>): string {
    // Only field hashes leave the owner, never the underlying private values.
    const actor = comparisonActor(session);
    const context = entityTag(scope, {id, actor,
        ...(actor === null ? {fields: Object.keys(values).sort()} : {})});
    const fields = Object.fromEntries(Object.entries(values).map(([field, value]) => [field, entityTag('field', value)]));
    return `"edit-${Buffer.from(JSON.stringify({context, fields})).toString('base64url')}"`;
}

/** Root field projection discloses only values permitted by the existing shared property policy. */
export function listMetadataProjection<Type extends ListType>(type: Type, list: ListRoot, permissions: PermView) {
    const values: components['schemas']['PackingMetadata']['values'] = {};
    const editableFields: components['schemas']['PackingMetadata']['editableFields'] = [];
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
    if (context.initialEventId !== context.root.eventId
        || (context.root.eventId && !context.parents.has(context.root.eventId))) throw new ApiProblem('ENTITY_CONTEXT_CHANGED');
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
        || list.ownerId === session.profile?.id
        || Boolean(session.auth?.user && permissions.allow(entityMethodPermission('duplicate')));
}

/** Include private audience hashes only when the already admitted caller may manage that matrix. */
export async function listSettingsToken(type: ListType, manager: EntityManager, list: EntityBase,
    session: SessionLike, includeAccess = false): Promise<string> {
    const defaults = includeAccess ? completeDefaults(await entityAdminService.getDefaultPerms(type, list.id, manager)) : null;
    return comparisonToken(`${type}-settings`, list.id, session, {...(defaults ? defaultPermissionValues(defaults) : {}),
        header: list.headerImg ?? null, eventId: list.eventId ?? null, ...(includeAccess ? {newAdmin: null} : {})});
}

/**
 * Compare selected fields with the freshly authorized locked baseline. Missing
 * review is 428; malformed, foreign or changed evidence is 412. Other fields may
 * change independently without rejecting this sparse edit.
 */
export function requireFieldComparison(expected: string | undefined, current: string, fields: string[]): void {
    if (!expected) throw new ApiProblem('PRECONDITION_REQUIRED');

    /** Decode only the bounded generated envelope and its private hash shape. */
    function decode(token: string): {context: string; fields: Record<string, string>} | null {
        // Validate before allocating decoded bytes; request and response bounds
        // come from the same authored contract rather than a second limit.
        if (!contractValidator('FieldComparisonToken')(token)) return null;

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

    // Both tokens must describe this actor/resource and every submitted field.
    const baseline = decode(expected);
    const latest = decode(current);
    if (!baseline || !latest || baseline.context !== latest.context
        || fields.some(field => !Object.hasOwn(baseline.fields, field) || baseline.fields[field] !== latest.fields[field])) {
        throw new ApiProblem('PRECONDITION_FAILED');
    }
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
        : comparisonToken(`${type}-settings`, comparison.comparisonId ?? id, session, defaultPermissionValues(defaultPermissions));
    return {defaultPermissions, editToken};
}

/** Compare submitted audiences and persist only their numeric masks on the feature's existing manager. */
export async function updateEntityDefaults(type: EntityType, id: string,
    defaults: components['schemas']['PermissionDefaultsPatch'], session: SessionLike, token?: string,
    manager?: EntityManager, comparison: EntityDefaultReviewOptions = {}) {
    // Omitted audiences retain their original values and never enter the comparison.
    const current = completeDefaults(await entityAdminService.getDefaultPerms(type, id, manager));
    const currentToken = comparison.prepareToken ? await comparison.prepareToken()
        : comparisonToken(`${type}-settings`, comparison.comparisonId ?? id, session, defaultPermissionValues(current));
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
    return mask === null ? comparisonToken(`${type}-settings`, id, session, {newAdmin: null})
        : comparisonToken(`${type}-admin`, `${id}:${profileId}`, session, {mask});
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

/** Project the maintained permission/preset definitions for all creation/settings callers. */
export function permissionDefinitions() {
    return {permissions: getPermMeta().map(({key, bit}) => ({key, bit})), presets: getPresets().map(({key, mask}) => ({key, mask}))};
}

function propertyPermissions(type: EntityType): Partial<Record<EntityPropertyField, PermType>> {
    if (type === 'event') return eventPropertyPermissions;
    if (type === 'activity') return {...basicPropertyPermissions, startDate: 'EDIT_META', endDate: 'EDIT_META'};
    return basicPropertyPermissions;
}

/** Read one established field declaration without exposing the mutable policy to adapters. */
export function entityPropertyPermission(type: EntityType, field: EntityPropertyField): PermType | undefined {
    return propertyPermissions(type)[field];
}

/** Render the stored instant as local wall time in the same zone used by the edit parser. */
export function deadlineInputValue(value: unknown, timezone: unknown): string | null {
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
    assertEditableEntityFields(type, body, permissions, session.profile?.id === entity.ownerId);
}

/** A known parent relationship or assignment-management grant alone does not authorize navigation. */
export function getAuthorizedEventUrl(eventId: string, permissions: PermView): string | null {
    return permissions.has('ACCESS_VIEW') ? `/event/${encodeURIComponent(eventId)}` : null;
}

/** Share parent-field disclosure without granting navigation from a relationship.
 * Shared presentation omits protected labels/dates; versioned adapters may map
 * those absent fields to their authored null shape. Only ACCESS_VIEW supplies a URL. */
export function projectCurrentEntityEvent(
    event: Pick<Event, 'id' | 'title' | 'startDate' | 'endDate'>,
    permissions: PermView,
): NonNullable<EntityPropertyPresentation['currentEvent']> {
    const current: NonNullable<EntityPropertyPresentation['currentEvent']> = {id: event.id};
    if (permissions.has('ACCESS_VIEW') || permissions.has('MANAGE_ASSIGNMENTS')) {
        current.title = event.title;
        current.startDate = event.startDate;
        current.endDate = event.endDate;

        // Field visibility and permission to follow the parent link are separate.
        const url = getAuthorizedEventUrl(event.id, permissions);
        if (url) current.url = url;
    }
    return current;
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
    const owner = !!session.profile && session.profile.id === entity.ownerId;
    const editableFields: EntityPropertyField[] = [];
    const values: EntityPropertyPresentation['values'] = {};
    const source = entity as EntityBase & Record<string, unknown>;
    for (const [field, permission] of Object.entries(propertyPermissions(type))) {
        if (fieldScope === 'page' && !session.profile || !(type === 'survey' ? owner : permissions.has(permission))) continue;
        const key = field as EntityPropertyField;
        editableFields.push(key);
        const value = source[key === 'deadlineTz' ? 'timezone' : key];
        values[key] = value instanceof Date ? value.toISOString() : value as string | number | boolean | null ?? null;
        if (key === 'bindingDeadline') values[key] = deadlineInputValue(value, source.timezone);
        if (key === 'deadlineTz') values[key] = (value as string) || 'UTC';
    }
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

/** Change one explicit association through the shared direct/versioned owner.
 * Normalize the submitted old/new parent first, then evaluate source/target
 * authority under the DBAL's parent/root locks. Authorized unchanged choices
 * acknowledge a no-op before comparison; actual changes additionally require the
 * captured relationship and any versioned reviewed-token callback. Controller errors,
 * post-change archival presentation and view-admission redirects remain intact. */
export function changeEntityEvent(type: EntityType, entity: EntityBase, body: unknown, session: SessionLike,
    invalidateContext?: (id: string) => void, validateReviewedContext?: (manager: EntityManager) => Promise<void>): Promise<EntityEventChangeResult>;
/** A feature receipt replaces only postcommit presentation, sharing the same locked business operation. */
export function changeEntityEvent<Result>(type: EntityType, entity: EntityBase, body: unknown, session: SessionLike,
    invalidateContext: ((id: string) => void) | undefined,
    validateReviewedContext: ((manager: EntityManager) => Promise<void>) | undefined,
    completion: EntityMutationCompletion<Result>): Promise<Result>;
/** Keep shared presentation compatible while preparing an explicit feature completion before its final commit. */
export async function changeEntityEvent<Result>(type: EntityType, entity: EntityBase, body: unknown, session: SessionLike,
    invalidateContext?: (id: string) => void, validateReviewedContext?: (manager: EntityManager) => Promise<void>,
    completion?: EntityMutationCompletion<Result>): Promise<EntityEventChangeResult | Result> {
    // Admit the existing profile/feature contract and normalize the explicit
    // relationship command before asking the DBAL to choose its parent locks.
    requireSessionProfileId(session);
    if (!['activity', 'packing', 'drivers'].includes(type)) throw new APIError('This entity cannot be linked to an event.', {}, 400);
    const schema = Joi.object({eventId: Joi.string().uuid().lowercase().allow(null).required(), expectedEventId: Joi.string().uuid().lowercase().allow(null).required()}).unknown(false).required();
    const {value, error} = schema.validate(body);
    if (error) throw new APIError(error.message, {}, 400);
    const reference = {type, id: entity.id};

    /** Decide against this transaction's locked relationship and current grants;
     * persistence and any recommendation invalidation use the same manager. */
    async function changeLocked(manager: EntityManager, context: LockedArchiveContext) {
        // Source and destination authority remain independent. A selected event
        // must exist and permit attachment even for an unchanged relationship.
        const root = requireLockedArchiveRoot(context);
        const target = value.eventId ? context.parents.get(value.eventId) : null;
        if (value.eventId && !target) throw new APIError('Event not found.', {}, 404);
        const descriptors: EntityDescriptor[] = [{entityType: type, entityId: root.id, ownerId: root.ownerId, eventId: root.eventId}];
        if (target) descriptors.push({entityType: 'event', entityId: target.id, ownerId: target.ownerId, eventId: target.id});
        const permissions = await evaluateEntities(descriptors, session, manager);
        if (!permissions.get(`${type}:${root.id}`)?.has(entityMethodPermission('changeEvent'))) throw new APIError('Not allowed to change the linked event.', {}, 403);
        if (target && !permissions.get(`event:${target.id}`)?.has('MANAGE_ASSIGNMENTS')) throw new APIError('Not allowed to attach entities to this event.', {}, 403);

        // An authorized unchanged choice performs no write. Direct and versioned both
        // retain this harmless outcome before expected-parent/token comparison;
        // only an actual relationship change needs the reviewed precondition.
        const changed = root.eventId !== value.eventId;
        let resultingRoot = root;
        if (changed) {
            if (root.eventId !== value.expectedEventId) throw new APIError('The linked event changed. Reload and try again.', {}, 409);

            // Versioned adapters can require a reviewed settings token inside these same locks.
            await validateReviewedContext?.(manager);
            // Invalidating under the plan lock prevents an old job from surviving A-to-B-to-A.
            // If persistence later rolls back, conservative cancellation cannot corrupt saved work.
            invalidateContext?.(root.id);
            await lifecycleService.updateEventAssociation(manager, reference, value.eventId);
            if (type === 'activity') await invalidateGeneratedRecommendations(manager, root.id);
            resultingRoot = {...root, eventId: value.eventId};
        }

        // A prepared receipt uses the resulting association on this same manager.
        // Failure still rolls back the write; an authorized no-op reaches this step
        // without examining expected-parent or comparison evidence above.
        const outcome = {changed, root: resultingRoot};
        const prepared = completion ? await completion.prepare(manager, outcome) : undefined;
        return {...outcome, prepared};
    }

    // The DBAL commits only after the locked action and any explicit receipt
    // preparation finish. Direct callers retain their existing later projection.
    const {changed, root, prepared} = await lifecycleService.withLockedArchiveTarget(reference, changeLocked, value.eventId ? [value.eventId] : []);
    // The supplied callback has already prepared its exact result, including a
    // legitimate undefined result. No later query can reject that completed write.
    if (completion) return prepared as Result;

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
export async function getEntityViewAdmission(type: EntityType, entity: Pick<EntityBase, 'id' | 'ownerId' | 'eventId'>,
    session: SessionLike, manager?: EntityManager, knownPermissions?: PermView): Promise<EntityViewAdmission> {
    // The linked-event rejection deliberately precedes guest registration. A missing
    // profile must not turn an attached entity's document 400 into a standalone login redirect.
    if (!session.profile) return entity.eventId ? 'event-registration-required' : 'guest';
    if (!entity.eventId) return 'render';
    if (await eventService.isRegisteredForEvent(session.profile.id, entity.eventId, manager)) return 'render';
    // Snapshot callers reuse their existing permission view and transaction, preventing
    // admission from combining a projection with membership from a different DB snapshot.
    const permissions = knownPermissions ?? await evaluateSubject({kind: 'entity', entity: {
        entityType: type, entityId: entity.id, ownerId: entity.ownerId, eventId: entity.eventId,
    }}, session, undefined, manager);
    return permissions.has('ACCESS_VIEW') ? 'render' : 'event-registration-required';
}

/** Boolean compatibility adapter for existing direct callers and reassociation redirects. */
export async function canAccessEntityView(type: EntityType, entity: Pick<EntityBase, 'id' | 'ownerId' | 'eventId'>, session: SessionLike): Promise<boolean> {
    return await getEntityViewAdmission(type, entity, session) === 'render';
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
export async function searchEntityProfiles(query: string): Promise<components['schemas']['PackingProfileOptions']> {
    // Retain the established search and masking work; only this shared wire projection removes the unused address.
    return (await searchUsers(query)).map(profile => ({profileId: profile.id, name: profile.name,
        username: profile.username, isGuest: false}));
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
    manager?: EntityManager,
): Promise<Map<string, ArchivePresentation>> {
    // Reuse an existing overview/transaction snapshot. Without one, direct callers
    // keep their ordinary reads; a supplied manager keeps lifecycle and grants in
    // the versioned caller's same transaction, rather than starting a second read.
    const currentSnapshot = snapshot ?? (manager ? await lifecycleService.getArchiveSnapshot(references, manager) : undefined);
    const states = await getArchiveStates(references, currentSnapshot);

    // Linked events are internal permission inputs, including when discovery
    // selected only a child. Parent restoration links require their own view grant.
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
    const permissions = await evaluateEntities(descriptors, session, manager);

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
        const parent = root.eventId ? context.parents.get(root.eventId) : null;
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
