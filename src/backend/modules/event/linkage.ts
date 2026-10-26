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
import type {EventMethod, EventLinkOption, EventLinkOptionsQuery, EventLinkOptionsResult} from '../../../types/EventTypes';
import type {PermType, PermView, SessionLike} from '../../../types/PermissionTypes';
import {entityMethodPermission} from '../../controller/entityAdminController';
import {PERM} from '../lib/permissions';
import {requireSessionProfileId} from '../lib/session';
import {APIError} from '../lib/errors';
import {can, evaluateEntities, getEntityPermissionQueryScope} from '../permissionEngine';
import * as eventService from '../database/services/EventService';

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

/** One declaration selects method grants for permission middleware, v1 commands and
 * capabilities. This preserves the existing independent bits and the participant
 * export's combined requirement; profile/account/participant admission remains
 * with the document route or shared operation rather than being inferred here. */
const eventMethodPermissions: Record<EventMethod, readonly PermType[]> = {
    register: ['ACCESS_REGISTRATION'], admin: ['ACCESS_ADMIN'], participants: ['ACCESS_PARTICIPANTS'],
    manageRegistrations: ['MANAGE_REGISTRATIONS'], items: ['ACCESS_ITEMS'], manageAssignments: ['MANAGE_ASSIGNMENTS'],
    exportParticipants: ['DATA_EXPORT', 'ACCESS_PARTICIPANTS'],
    managePermissions: [entityMethodPermission('managePermissions')],
    editHeader: [entityMethodPermission('editHeader')], duplicate: [entityMethodPermission('duplicate')],
};

/** Translate this owner's complete grant choice to the existing permission middleware bitmask. */
export function eventMethodPermission(method: EventMethod): number {
    return eventMethodPermissions[method].reduce((mask, key) => mask | PERM[key], 0);
}

/** The permission engine interprets grants; this owner selects every required method bit. */
export function mayPerformEventMethod(permissions: PermView, method: EventMethod): boolean {
    return permissions.all(...eventMethodPermissions[method]);
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
        const bytes = Buffer.from(token, 'base64url');
        const decipher = crypto.createDecipheriv('aes-256-gcm', eventCursorKey, bytes.subarray(0, 12));
        decipher.setAuthTag(bytes.subarray(12, 28));
        const decoded = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8'));
        if (decoded.scope !== scope) throw new Error('Cursor scope changed');
        return decoded.position;
    } catch {
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
        cursor: Joi.string().max(2048), selectedId: Joi.string().uuid().lowercase(),
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
    const permissionScope = getEntityPermissionQueryScope(session, eventMethodPermissions.manageAssignments[0]!);
    const referenceTime = new Date();
    while (true) {
        const candidates = await eventService.getEventLinkCandidates(filters, permissionScope, referenceTime, position);
        if (!candidates.length) return result;
        const descriptors = candidates.map(event => ({entityType: 'event' as const, entityId: event.id, ownerId: event.ownerId, eventId: event.id}));
        const permissions = await evaluateEntities(descriptors, session);
        for (const event of candidates) {
            const permission = permissions.get(`event:${event.id}`);
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
