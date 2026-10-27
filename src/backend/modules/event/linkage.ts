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

import Joi from 'joi';
import crypto from 'node:crypto';
import type {EntityManager} from 'typeorm';
import type {Event} from '../database/entities/event/Event';
import type {EventLinkOption, EventLinkOptionsQuery, EventLinkOptionsResult} from '../../../types/EventTypes';
import type {EntityDescriptor, PermView, SessionLike} from '../../../types/PermissionTypes';
import type {EntityEventChangeResult, EntityMutationCompletion, EntityPropertyPresentation} from '../../../types/EntityPropertyTypes';
import type {EntityBase, EntityViewAdmission} from '../../../types/UserTypes';
import type {EntityType} from '../../../types/UtilTypes';
import type {LockedArchiveContext} from '../../../types/ArchiveTypes';
import {eventMethodCandidatePermission, eventMethodPermission, mayPerformEventMethod, entityPermissionKey} from '../permissionEngine';
import {sameUuid, uuidKey} from '../lib/util';
import {requireSessionProfileId} from '../lib/session';
import {APIError} from '../lib/errors';
import {can, entityMethodPermission, evaluateEntities, evaluateSubject, getEntityPermissionQueryScope} from '../permissionEngine';
import * as eventService from '../database/services/EventService';
import * as lifecycleService from '../database/services/EntityLifecycleService';
import {invalidateGeneratedRecommendations} from '../database/services/ActivityRecommendationService';
import {archiveKey} from '../archive/policy';
import {getArchivePresentations, requireLockedArchiveRoot} from '../entityArchival';

/** JSON Event selectors use explicit null descriptions; domain selection retains its optional value contract. */
export function projectEntityEventOption(event: EventLinkOption) {
    return {...event, description: event.description ?? null};
}

/** Adapt the one authorized Event search to the shared list-selector representation. */
export async function searchEntityEvents(query: unknown, session: SessionLike) {
    const result = await getEventLinkOptions(query, session);
    return {items: result.items.map(projectEntityEventOption),
        selected: result.selected ? projectEntityEventOption(result.selected) : null, nextCursor: result.nextCursor};
}

// A grant can be revoked between candidate discovery and evaluation. Cursor positions may
// therefore refer to a now-private event: encrypt them rather than exposing an encoded ID.
// They are process-local navigation state; a restart simply requires restarting the search.
const eventCursorKey = crypto.randomBytes(32);

/** Reject impossible calendar dates as well as malformed strings before SQL sees them. */
export function validateCalendarDate(value: string, helpers: Joi.CustomHelpers): string | Joi.ErrorReport {
    const date = new Date(`${value}T00:00:00Z`);
    if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() < 1000 || date.toISOString().slice(0, 10) !== value) return helpers.error('any.invalid');
    return value;
}

/** Authenticate both the seek position and the profile/filter scope as one opaque token. */
function encodeEventCursor(position: {startDate: string; id: string}, scope: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', eventCursorKey, iv);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify({position, scope}), 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
}

/** Reject changed filters, another profile's token, and modified bytes before querying. */
function decodeEventCursor(token: string, scope: string): {startDate: string; id: string} {
    try {
        // Reassemble the original IV/tag/ciphertext envelope. GCM must authenticate
        // the bytes before their decoded seek position can become query input.
        const bytes = Buffer.from(token, 'base64url');
        const decipher = crypto.createDecipheriv('aes-256-gcm', eventCursorKey, bytes.subarray(0, 12));
        decipher.setAuthTag(bytes.subarray(12, 28));
        const decoded = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8'));
        // A valid process-local token still belongs to its captured actor/filter
        // scope; another search must restart rather than adopt that position.
        if (decoded.scope !== scope) throw new Error('Cursor scope changed');
        return decoded.position;
    } catch {
        // Malformed, tampered and stale-scope tokens share the existing bounded
        // reset diagnostic; cryptographic/parser details stay private.
        throw new APIError('Search expired or changed. Reset filters and try again.', {}, 400, {cause: 'EVENT_SEARCH_EXPIRED'});
    }
}

export function projectEventLinkOption(event: Event): EventLinkOption {
    return {
        id: event.id, title: event.title, description: event.description ?? undefined,
        startDate: event.startDate, endDate: event.endDate, archived: event.archivedAt !== null,
        deadlinePassed: !!event.bindingDeadline && new Date(event.bindingDeadline).getTime() < Date.now(),
    };
}

/**
 * Authorize the actual attachment target through the common event method policy.
 * A selected URL is discovery only; creation/relink adapters call this owner again.
 *
 * @param manager Transaction used for current permission evidence by a locked caller.
 * @param knownEvent That caller's selected, locked event row; null means the row
 * disappeared, while undefined retains the ordinary lookup. The row belongs to eventId.
 */
export async function authorizeEventLink(eventId: string | null | undefined, session: SessionLike,
                                         manager?: EntityManager, knownEvent?: Event | null): Promise<Event | null> {
    requireSessionProfileId(session);
    if (eventId === null || eventId === undefined || eventId === '') return null;
    const {error} = Joi.string().uuid().validate(eventId);
    if (error) throw new APIError('Invalid event.', {}, 400);

    // Direct callers keep their existing lookup. A controller operating under a
    // DBAL-managed parent lock supplies that exact row and transaction instead;
    // both paths apply this same attachment policy without another permission owner.
    const event = knownEvent === undefined ? await eventService.getEventById(eventId) : knownEvent;
    if (!event) throw new APIError('Event not found.', {}, 404);

    // Ownership, individual grants and audience membership all use the same engine.
    const allowed = await can({kind: 'entity', entity: {
        entityType: 'event', entityId: event.id, ownerId: event.ownerId, eventId: event.id,
    }}, session, eventMethodPermission('manageAssignments'), undefined, manager);
    if (!allowed) throw new APIError('Not allowed to attach entities to this event.', {}, 403);
    return event;
}

/**
 * Resolve an optional initial selection without disclosing a rejected event. Direct calls
 * forms and features share this read projection; submitting an event still
 * performs its own mandatory authorization. Operational failures must remain errors.
 */
export async function readEventLinkSelection(input: unknown, session: SessionLike): Promise<EventLinkOption | null> {
    if (typeof input !== 'string' || input === '') return null;
    try {
        const event = await authorizeEventLink(input, session);
        return event ? projectEventLinkOption(event) : null;
    } catch (error) {
        if (!(error instanceof APIError)) throw error;
        return null;
    }
}

/** Search all historical states without turning candidate discovery into an ACL implementation. */
export async function getEventLinkOptions(query: unknown, session: SessionLike): Promise<EventLinkOptionsResult> {
    const profileId = requireSessionProfileId(session);
    const schema = Joi.object({
        q: Joi.string().trim().max(200).allow('').default(''),
        from: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).custom(validateCalendarDate),
        to: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).custom(validateCalendarDate),
        period: Joi.string().valid('all', 'upcoming', 'ongoing', 'ended').default('all'),
        archive: Joi.string().valid('all', 'active', 'archived').default('all'),
        deadline: Joi.string().valid('all', 'open', 'passed').default('all'),
        cursor: Joi.string().max(2048), selectedId: Joi.string().uuid().custom(uuidKey),
    }).unknown(false).required();
    const {value, error} = schema.validate(query);
    if (error || (value.from && value.to && value.from > value.to)) throw new APIError('Invalid event filters.', {}, 400,
        {cause: !error ? 'EVENT_SEARCH_RANGE_INVALID' : undefined});
    const {cursor, selectedId, ...filters} = value as EventLinkOptionsQuery;
    const scope = JSON.stringify({profileId, ...filters});
    let position = cursor ? decodeEventCursor(cursor, scope) : undefined;
    const result: EventLinkOptionsResult = {items: [], nextCursor: null};
    if (selectedId) {
        // An unauthorized formerly selected event is omitted, never echoed with a title.
        result.selected = await readEventLinkSelection(selectedId, session);
    }
    // SQL prefilters the engine's exact one-bit eligibility inputs before LIMIT. Thousands
    // of denied rows therefore do not become empty user-facing pages. A final evaluation is
    // still required because grants may change between SQL discovery and this batch read.
    // The SQL candidate filter uses a necessary bit; the controller still checks
    // the complete method rule after loading candidates, before disclosure.
    const permissionScope = getEntityPermissionQueryScope(session, eventMethodCandidatePermission('manageAssignments'));
    const referenceTime = new Date();
    while (true) {
        const candidates = await eventService.getEventLinkCandidates(filters, permissionScope, referenceTime, position);
        if (!candidates.length) return result;
        const descriptors = candidates.map(event => ({entityType: 'event' as const, entityId: event.id, ownerId: event.ownerId, eventId: event.id}));
        const permissions = await evaluateEntities(descriptors, session);
        for (const event of candidates) {
            const permission = permissions.get(entityPermissionKey('event', event.id));
            if (!permission || !mayPerformEventMethod(permission, 'manageAssignments')) {
                position = {startDate: event.startDate, id: event.id};
                continue;
            }
            // Read one authorized lookahead result. Only then emit a continuation after the
            // last displayed item, avoiding a misleading Next page button on a terminal page.
            if (result.items.length === 25) {
                result.nextCursor = encodeEventCursor(position!, scope);
                return result;
            }
            result.items.push(projectEventLinkOption(event));
            position = {startDate: event.startDate, id: event.id};
        }
        if (candidates.length < 100) return result;
    }
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

/** Normalize only already disclosed parent fields to the settings wire shape.
 * A missing parent stays null; this projection performs no reads or grant decisions. */
export function projectEntitySettingsEvent(parent: EntityPropertyPresentation['currentEvent']) {
    if (!parent) return null;
    return {id: parent.id, title: parent.title ?? null, startDate: parent.startDate ?? null,
        endDate: parent.endDate ?? null, url: parent.url?.replace(/^\/event(?=\/|$)/u, '/event') ?? null};
}

/** Shared optimistic-context validation for root property controllers, under their row lock. */
export function assertEntityPropertyContext(entity: EntityBase | null, expectedEventId?: string | null): asserts entity is EntityBase {
    if (!entity) throw new APIError('Entity not found.', {}, 404);
    if (expectedEventId !== undefined && (entity.eventId ?? null) !== expectedEventId
        && !sameUuid(entity.eventId, expectedEventId)) throw new APIError('The linked event changed. Reload and try again.', {}, 409);
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
    const schema = Joi.object({eventId: Joi.string().uuid().custom(uuidKey).allow(null).required(), expectedEventId: Joi.string().uuid().custom(uuidKey).allow(null).required()}).unknown(false).required();
    const {value, error} = schema.validate(body);
    if (error) throw new APIError(error.message, {}, 400);
    const reference = {type, id: entity.id};

    /** Decide against this transaction's locked relationship and current grants;
     * persistence and any recommendation invalidation use the same manager. */
    async function changeLocked(manager: EntityManager, context: LockedArchiveContext) {
        // Source and destination authority remain independent. A selected event
        // must exist and permit attachment even for an unchanged relationship.
        const root = requireLockedArchiveRoot(context);
        const target = value.eventId ? context.parents.get(uuidKey(value.eventId)) : null;
        if (value.eventId && !target) throw new APIError('Event not found.', {}, 404);
        const descriptors: EntityDescriptor[] = [{entityType: type, entityId: root.id, ownerId: root.ownerId, eventId: root.eventId}];
        if (target) descriptors.push({entityType: 'event', entityId: target.id, ownerId: target.ownerId, eventId: target.id});
        const permissions = await evaluateEntities(descriptors, session, manager);
        if (!permissions.get(entityPermissionKey(type, root.id))?.has(entityMethodPermission('changeEvent'))) throw new APIError('Not allowed to change the linked event.', {}, 403);
        if (target && !permissions.get(entityPermissionKey('event', target.id))?.has('MANAGE_ASSIGNMENTS')) throw new APIError('Not allowed to attach entities to this event.', {}, 403);

        // An authorized unchanged choice performs no write. Direct and versioned both
        // retain this harmless outcome before expected-parent/token comparison;
        // only an actual relationship change needs the reviewed precondition.
        const eventId = target?.id ?? null;
        const changed = root.eventId !== eventId && !sameUuid(root.eventId, eventId);
        let resultingRoot = root;
        if (changed) {
            if (root.eventId !== value.expectedEventId && !sameUuid(root.eventId, value.expectedEventId)) throw new APIError('The linked event changed. Reload and try again.', {}, 409);

            // Versioned adapters can require a reviewed settings token inside these same locks.
            await validateReviewedContext?.(manager);
            // Invalidating under the plan lock prevents an old job from surviving A-to-B-to-A.
            // If persistence later rolls back, conservative cancellation cannot corrupt saved work.
            invalidateContext?.(root.id);
            await lifecycleService.updateEventAssociation(manager, reference, eventId);
            if (type === 'activity') await invalidateGeneratedRecommendations(manager, root.id);
            resultingRoot = {...root, eventId};
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
