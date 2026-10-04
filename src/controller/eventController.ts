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

// controllers/eventController.ts
import {Request} from "express";
import {assertEditableEntityFields, getArchiveView} from "./entityAdminController";
import crypto from 'node:crypto';
// Business logic for the Event routes
import Joi from 'joi';

import {Event} from "../modules/database/entities/event/Event";
import {EventRegistration} from "../modules/database/entities/event/EventRegistration";
import {ALLOWED_DIETARY} from "../modules/database/entities/event/EventRegistrationDietary";
import * as invoiceService from "../modules/database/services/EventInvoiceService";
import {invoicePresentation} from '../modules/invoice/presentation';

import * as eventService from '../modules/database/services/EventService';
import {APIError, ValidationError} from '../modules/lib/errors';
import {performImageSwap} from "../modules/lib/fileCommons";
import {PERM} from '../modules/lib/permissions';
import {
    buildDateTotals,
    convertToSingleList,
    ENTITIES,
    getResource,
    isWithinWindow,
    normalizeToArray,
    rewriteISOToZone
} from "../modules/lib/util";
import {can, evaluateEntities, getEntityPermissionQueryScope, saveDefaultPermsFromBody} from "../modules/permissionEngine";
import {requireSessionProfileId} from '../modules/lib/session';
import type {DIETARY, EventLinkOption, EventLinkOptionsQuery, EventLinkOptionsResult} from "../types/EventTypes";
import type {PermBundle, SessionLike} from "../types/PermissionTypes";
import type {EntityBase} from "../types/UserTypes";
import {WithRequired} from "../types/UtilTypes";

// Template constant for create errors
const CREATE_TEMPLATE = 'event/event-create';

// A grant can be revoked between candidate discovery and evaluation. Cursor positions may
// therefore refer to a now-private event: encrypt them rather than exposing an encoded ID.
// They are process-local navigation state; a restart simply requires restarting the search.
const eventCursorKey = crypto.randomBytes(32);

/** Reject impossible calendar dates as well as malformed strings before SQL sees them. */
function validateCalendarDate(value: string, helpers: Joi.CustomHelpers): string | Joi.ErrorReport {
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
        throw new APIError('Search expired or changed. Reset filters and try again.', {}, 400);
    }
}

export function projectEventLinkOption(event: Event): EventLinkOption {
    return {
        id: event.id, title: event.title, description: event.description ?? undefined,
        startDate: event.startDate, endDate: event.endDate, archived: event.archivedAt !== null,
        deadlinePassed: !!event.bindingDeadline && new Date(event.bindingDeadline).getTime() < Date.now(),
    };
}

/** Shared authority for a selected target, including the actual submitted creation target. */
export async function authorizeEventLink(eventId: string | null | undefined, session: SessionLike): Promise<Event | null> {
    requireSessionProfileId(session);
    if (eventId === null || eventId === undefined || eventId === '') return null;
    const {error} = Joi.string().uuid().validate(eventId);
    if (error) throw new APIError('Invalid event.', {}, 400);
    const event = await eventService.getEventById(eventId);
    if (!event) throw new APIError('Event not found.', {}, 404);
    const allowed = await can({kind: 'entity', entity: {
        entityType: 'event', entityId: event.id, ownerId: event.ownerId, eventId: event.id,
    }}, session, PERM.MANAGE_ASSIGNMENTS);
    if (!allowed) throw new APIError('Not allowed to attach entities to this event.', {}, 403);
    return event;
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
    if (error || (value.from && value.to && value.from > value.to)) throw new APIError('Invalid event filters.', {}, 400);
    const {cursor, selectedId, ...filters} = value as EventLinkOptionsQuery;
    const scope = JSON.stringify({profileId, ...filters});
    let position = cursor ? decodeEventCursor(cursor, scope) : undefined;
    const result: EventLinkOptionsResult = {items: [], nextCursor: null};
    if (selectedId) {
        // An unauthorized formerly selected event is omitted, never echoed with a title.
        try { result.selected = projectEventLinkOption((await authorizeEventLink(selectedId, session))!); }
        catch (error) {
            if (!(error instanceof APIError)) throw error;
            result.selected = null;
        }
    }
    // SQL prefilters the engine's exact one-bit eligibility inputs before LIMIT. Thousands
    // of denied rows therefore do not become empty user-facing pages. A final evaluation is
    // still required because grants may change between SQL discovery and this batch read.
    const permissionScope = getEntityPermissionQueryScope(session, 'MANAGE_ASSIGNMENTS');
    const referenceTime = new Date();
    while (true) {
        const candidates = await eventService.getEventLinkCandidates(filters, permissionScope, referenceTime, position);
        if (!candidates.length) return result;
        const descriptors = candidates.map(event => ({entityType: 'event' as const, entityId: event.id, ownerId: event.ownerId, eventId: event.id}));
        const permissions = await evaluateEntities(descriptors, session);
        for (const event of candidates) {
            if (!permissions.get(`event:${event.id}`)?.has('MANAGE_ASSIGNMENTS')) {
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

function preprocessCreate(body: any): Partial<Event> {
    // Basic date validation as strings (YYYY-MM-DD) to match existing patterns
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;

    const schema = Joi.object({
        title: Joi.string().required(),
        description: Joi.string().max(16000).allow(''),
        startDate: Joi.string().pattern(datePattern).required(),
        endDate: Joi.string().pattern(datePattern).required(),
        location: Joi.string().max(255).allow(''),
        // HTML datetime-local comes as 'YYYY-MM-DDTHH:mm' (no seconds or TZ) — let backend parse/normalize
        bindingDeadline: Joi.string().allow(''),
        allowRegDateUpdatesAfterDeadline: Joi.string().allow('').allow('on'),
        allowRegCancelationAfterDeadline: Joi.string().allow('').allow('on'),
        requireDietaryInfo: Joi.allow('').allow('on'),
        allowDietComment: Joi.allow('').allow('on'),
        allowRegDietUpdateAfterDeadline: Joi.allow('').allow('on'),
        maxParticipants: Joi.number().positive().allow('').optional(),
        deadlineTz: Joi.string().allow(''),
    });

    const {error, value} = schema.validate(
        body,
        {abortEarly: false, allowUnknown: true}
    );

    if (error) {
        const msg = error.details.map((d: any) => d.message).join(', ');
        throw new ValidationError(CREATE_TEMPLATE, msg, {body});
    }

    if (value.startDate > value.endDate) {
        throw new ValidationError(CREATE_TEMPLATE, 'Start date must be before end date', {body});
    }

    const timedDeadline = value.bindingDeadline ? rewriteISOToZone(value.bindingDeadline, value.deadlineTz || 'UTC') : undefined;

    return {
        title: value.title,
        description: value.description || null,
        startDate: value.startDate,
        endDate: value.endDate,
        location: value.location || null,
        bindingDeadline: timedDeadline || null,
        allowRegDateUpdatesAfterDeadline: value.allowRegDateUpdatesAfterDeadline === 'on',
        allowRegCancelationAfterDeadline: value.allowRegCancelationAfterDeadline === 'on',
        requireDietaryInfo: value.requireDietaryInfo === 'on',
        allowDietComment: value.allowDietComment === 'on',
        allowRegDietUpdateAfterDeadline: value.allowRegDietUpdateAfterDeadline === 'on',
        maxParticipants: value.maxParticipants || null,
        timezone: value.deadlineTz || null,
    };
}

/*  ---- Transaction handled in service ---- */
async function createEntity(ownerId: string, eventData: WithRequired<Partial<Event>, "title" | "startDate" | "endDate">) {
    return await eventService.createEventTx(ownerId, eventData);
}

// No-op — nothing else created alongside the event at this step
async function afterCreateItems(id: string, data: any) {
    await saveDefaultPermsFromBody(ENTITIES.EVENT, id, data._body);
}

/**
 * Data for the view page.
 * Returns the event plus the current actor’s registration (if any).
 */
async function fetchForView(event: Event, req: Request) {
    const session = req.session;
    let registration = await eventService.getRegistrationFor(session.profile!.id, event.id);

    // Associated plans/lists (will be empty until event_id exists in schema)
    // Only show lists/plans once the actor is registered (or is owner)
    const isOwner = await can({
        entity: {
            entityId: event.id,
            ownerId: event.ownerId,
            entityType: "event"
        },
        kind: "entity"
    }, req.session, PERM.MANAGE_ASSIGNMENTS);
    const shouldShowScoped = !!(isOwner || registration);
    const [activityPlans, packingLists, driverLists] = shouldShowScoped ? await Promise.all([
        eventService.getActivityPlansForEvent(event.id),
        eventService.getPackingListsForEvent(event.id),
        eventService.getDriverListsForEvent(event.id),
    ]) : [[], [], []];
    const invoicePools = shouldShowScoped ? await invoiceService.listPools(event.id) : [];
    const participantPools = registration ? await invoiceService.getParticipantPools(event.id, registration.id) : [];
    const participantInvoices = registration
        ? invoicePools.flatMap((p) => (p.invoices || []).filter((inv) => inv.registrationId === registration.id))
        : [];

    // Organizers also see participants list
    const participants = await eventService.getEventParticipants(event.id);
    const isFull = (event.maxParticipants ?? Number.MAX_SAFE_INTEGER) <= participants.length;

    const relatedEntities = convertToSingleList({activityPlans, packingLists, driversLists: driverLists});
    // The event notice and its attached cards must share one archival snapshot. Children
    // inherit an event archive without copying timestamps, so decorating them independently
    // could otherwise show conflicting state during a concurrent archive/restore request.
    // Return this as page data for explicit mixin arguments, not optional request locals.
    const archiveView = await getArchiveView({type: 'event', id: event.id}, relatedEntities, req.session);

    return {
        event,
        registration,
        participants,
        activityPlans,
        packingLists,
        driverLists,
        invoicePools,
        invoiceUi: invoicePresentation,
        participantPools,
        participantInvoices,
        isFull,
        ...archiveView,
        regToken: getResource(req, 'regToken'),
    };
}

/**
 * Provide data for duplication form.
 * For now, just return the source event; the view can prefill fields.
 */
async function fetchForDuplicate(event: Event, _session: Request['session']) {
    return event;
}

async function deleteEntity(event: Event, _session: Request['session']) {
    return await (eventService as any).deleteEvent(event.id);
}

async function registerAttendance(event: Event, body: any, req: Request) {
    if (!event) throw new APIError('Event not found', body, 404);
    const session = req.session;
    if (!session.profile) throw new APIError('Authentication required', body, 401);

    // Deny registration if not already registered (allow updates to registration)
    const registration = await eventService.getRegistrationFor(session.profile.id, event.id);
    if (!registration && await isEventFull(event.id)) {
        throw new APIError('Event is full', body, 403);
    }

    const schema = Joi.object({
        arrivalDate: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
        departureDate: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
        dietary: Joi.alternatives().try(
            Joi.array().items(Joi.string().valid(...ALLOWED_DIETARY).uppercase()),
            Joi.string().valid(...ALLOWED_DIETARY).uppercase() // handles single value form-post
        ).optional(),
        allergyNotes: Joi.string().max(4000).allow(''),
        dietComment: Joi.string().max(4000).allow(''),
    });
    const {error, value} = schema.validate(body, {abortEarly: false, allowUnknown: true});
    if (error) {
        const msg = error.details.map(d => d.message).join(', ');
        throw new APIError(msg, body, 400);
    }

    const dietary: DIETARY[] = normalizeToArray(value.dietary);

    // Deny registration if past binding deadline
    let bypass: { ok: boolean; linkId?: string } = {ok: false};
    if (event.bindingDeadline && new Date(Date.parse(event.bindingDeadline)) < new Date()) {
        if (registration) {
            // Are date updates allowed?
            if (!event.allowRegDateUpdatesAfterDeadline && (registration.arrivalDate !== value.arrivalDate || registration.departureDate !== value.departureDate)) {
                throw new APIError('Date updates not allowed after deadline has passed', {}, 403);
            }
            // Are diet updates allowed?
            if (!event.allowRegDietUpdateAfterDeadline && !isDietaryEqual(registration, dietary, value.allergyNotes, value.dietComment)) {
                throw new APIError('Diet updates not allowed after deadline has passed', {}, 403);
            }
        } else {
            bypass = await canBypassDeadlineWithToken(event.id, body.regToken ?? getResource(req, 'regToken') ?? null);
            if (!bypass.ok) {
                // owners/co-organizers may bypass via permission in your middleware;
                // if you still reach here, reject:
                throw new APIError('Registration deadline has passed', {}, 403);
            }
        }
    }

    if (!isWithinWindow(event.startDate, event.endDate, value.arrivalDate, value.departureDate)) {
        throw new APIError('Arrival/Departure must be within event dates', body, 400);
    }

    const allergyNotes: string = value.allergyNotes || '';
    const dietComment: string = value.dietComment || '';
    checkMeals(dietary, allergyNotes, dietComment, body);


    const profileId = session.profile.id;
    await eventService.withEventTransaction(async function saveRegistration(manager) {
        // The earlier eligibility read is only a preview. Recheck the token while holding
        // its row lock so simultaneous submissions cannot both spend its final use. The
        // controller owns that policy; DBAL only reads/locks and records the decided write.
        if (bypass.ok && bypass.linkId) {
            const link = await eventService.lockDeadlineBypassLink(manager, event.id, bypass.linkId);
            if (!link || bypassStatus(link) !== 'active') throw new APIError('This link has already been used', {}, 409);
            await eventService.consumeDeadlineBypassToken(link.id, profileId, manager);
        }
        // Consumption and attendance commit together. A failed attendance write also
        // rolls back token usage, leaving the same link available for a corrected retry.
        await eventService.register(event.id, value.arrivalDate, value.departureDate, profileId, dietary,
            allergyNotes?.trim() || null, dietComment?.trim() || null, manager);
    });
    return 'Registration saved';
}

function isDietaryEqual(reg: EventRegistration, dietary: DIETARY[], allergyNotes: string, dietComment: string) {
    const localDiets: Set<DIETARY> = new Set();
    let localAllergy;
    let localComment;

    for (const choice of reg.dietaryChoices) {
        localDiets.add(choice.choice);
        if (choice.choice === "ALLERGIES") {
            localAllergy = choice.additionalInfo;
        } else if (choice.choice === "COMMENT") {
            localComment = choice.additionalInfo;
        }
    }

    let ok = true;
    for (const choice of dietary) {
        if (!localDiets.delete(choice)) {
            ok = false;
            break;
        }
    }

    return ok && localDiets.size === 0 && allergyNotes === localAllergy && dietComment === localComment;
}

function checkMeals(dietary: DIETARY[], allergyNotes: string, dietComment: string, body: any) {
    if (dietary.includes("ALLERGIES") && !allergyNotes) {
        throw new APIError('Allergies require additional information', body, 400);
    }
    if (dietary.includes("COMMENT") && !dietComment) {
        throw new APIError('Comment requires additional information', body, 400);
    }

    const meals = dietary.filter(d =>
        ['MEAT', 'FISH', 'VEGETARIAN', 'VEGAN'].includes(d)
    );

    if (dietary.length > 0 && meals.length === 0) {
        throw new APIError('At least one meal preference must be selected.', body, 400);
    }

    if (meals.includes('VEGETARIAN')) {
        if (meals.includes('MEAT') || meals.includes('FISH') || meals.includes('VEGAN')) {
            throw new APIError('Vegetarian cannot be combined with meat, fish or vegan.', body, 400);
        }
    }

    if (meals.includes('VEGAN')) {
        if (meals.includes('MEAT') || meals.includes('FISH') || meals.includes('VEGETARIAN')) {
            throw new APIError('Vegan cannot be combined with meat, fish or vegetarian.', body, 400);
        }
    }
}

async function cancelRegistration(event: Event, session: Request['session']) {
    if (event.bindingDeadline && new Date(Date.parse(event.bindingDeadline)) < new Date() && !event.allowRegCancelationAfterDeadline) {
        throw new APIError('Cancellation is not allowed after registration deadline has passed', {}, 403);
    }
    if (session.profile?.id) {
        await eventService.deleteRegistrationFor(event.id, session.profile.id);
    } else {
        throw new APIError('Authentication required', {}, 401);
    }
    return 'Registration cancelled';
}

/* ----------------------- API: Organizer edit ----------------------- */

async function updateEventSettings(event: Event, body: any, permData?: PermBundle) {
    if (!event) throw new APIError('Event not found', {}, 404);
    const normalizedBody = {...body};
    // Retain the old date aliases at this request boundary only. The shared permission
    // policy and persistence see one canonical field name for each editable property.
    if (normalizedBody.startDate === undefined && normalizedBody.start !== undefined) normalizedBody.startDate = normalizedBody.start;
    if (normalizedBody.endDate === undefined && normalizedBody.end !== undefined) normalizedBody.endDate = normalizedBody.end;
    delete normalizedBody.start;
    delete normalizedBody.end;
    if (!permData) throw new APIError('Not allowed', {}, 403);
    assertEditableEntityFields('event', normalizedBody, permData.entity);

    const checkbox = Joi.boolean().truthy('on').falsy('off', '');
    const date = Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).custom(validateCalendarDate);
    const schema = Joi.object({
        title: Joi.string().trim().min(1).max(255),
        description: Joi.string().max(16000).allow('', null),
        startDate: date, endDate: date,
        location: Joi.string().max(255).allow('', null),
        bindingDeadline: Joi.string().allow('', null),
        allowRegDateUpdatesAfterDeadline: checkbox,
        allowRegCancelationAfterDeadline: checkbox,
        requireDietaryInfo: checkbox,
        allowDietComment: checkbox,
        allowRegDietUpdateAfterDeadline: checkbox,
        maxParticipants: Joi.number().integer().positive().allow('', null),
        deadlineTz: Joi.string().max(255).allow(''),
    }).min(1).unknown(false);
    const {error, value} = schema.validate(normalizedBody, {abortEarly: false});
    if (error) throw new APIError(error.message, {}, 400);
    const patch: Partial<Event> = {};
    for (const field of ['title', 'description', 'startDate', 'endDate', 'location',
        'allowRegDateUpdatesAfterDeadline', 'allowRegCancelationAfterDeadline',
        'requireDietaryInfo', 'allowDietComment', 'allowRegDietUpdateAfterDeadline'] as const) {
        if (value[field] !== undefined) Object.assign(patch, {[field]: value[field] === '' ? null : value[field]});
    }
    if (value.maxParticipants !== undefined) patch.maxParticipants = value.maxParticipants || null;
    if (value.deadlineTz !== undefined) {
        try { new Intl.DateTimeFormat('en', {timeZone: value.deadlineTz || 'UTC'}); }
        catch { throw new APIError('Invalid time zone.', {}, 400); }
        patch.timezone = value.deadlineTz || null;
    }
    async function updateLocked(manager: import('typeorm').EntityManager): Promise<void> {
        const current = await eventService.lockEvent(manager, event.id);
        if (!current) throw new APIError('Event not found', {}, 404);
        const startDate = patch.startDate ?? current.startDate;
        const endDate = patch.endDate ?? current.endDate;
        if (startDate > endDate) throw new APIError('Start date must be before end date', {}, 400);
        // An omitted deadline is never rewritten. A supplied local deadline uses the submitted
        // zone or the locked row's current zone, avoiding an earlier request-load snapshot.
        if (value.bindingDeadline !== undefined) {
            try {
                patch.bindingDeadline = value.bindingDeadline
                    ? rewriteISOToZone(value.bindingDeadline, value.deadlineTz || current.timezone || 'UTC') : null;
                if (patch.bindingDeadline && !Number.isFinite(Date.parse(patch.bindingDeadline))) throw new Error('Invalid deadline');
            } catch {
                throw new APIError('Invalid binding deadline or time zone.', {}, 400);
            }
        }
        await eventService.updateEventProperties(event.id, patch, manager);
    }
    await eventService.withEventTransaction(updateLocked);
    return 'Event updated';
}

async function updateSettings(id: string, body: any) {
    await saveDefaultPermsFromBody(ENTITIES.EVENT, id, body);
    return 'Settings saved';
}

/** Capacity is policy over persisted event limits and registration counts. */
export async function isEventFull(eventId: string): Promise<boolean> {
    const event = await eventService.getEventById(eventId);
    if (!event) throw new APIError('Event not found', {}, 404);
    // Optional/NULL limits both mean unlimited. Keep zero meaningful for persisted data,
    // rather than using a truthiness check that would accidentally turn zero into unlimited.
    return event.maxParticipants != null && await eventService.getEventRegistrationCount(eventId) >= event.maxParticipants;
}

/** Keep display, preview and locked consumption aligned on the same eligibility rule. */
function bypassStatus(link: import('../modules/database/entities/event/EventRegBypassLink').EventRegBypassLink) {
    if (link.revokedAt) return 'revoked';
    if (link.expiresAt && link.expiresAt < new Date()) return 'expired';
    if (link.usedCount >= link.maxUses) return 'consumed';
    return 'active';
}

/** Eligibility and display status share one controller rule; the service only returns rows. */
export async function canBypassDeadlineWithToken(eventId: string, token?: string | null): Promise<{ok: boolean; linkId?: string}> {
    if (!token) return {ok: false};
    const link = await eventService.getDeadlineBypassToken(eventId, token);
    return link && bypassStatus(link) === 'active' ? {ok: true, linkId: link.id} : {ok: false};
}

async function listDeadlineBypassLinks(event: Event) {
    const links = await eventService.listDeadlineBypassLinks(event.id);
    return links.map(function presentLink(link) {
        return {id: link.id, token: link.token, createdAt: link.track.createdAt, expiresAt: link.expiresAt,
            revokedAt: link.revokedAt, used: link.usedCount > 0 || !!link.usedAt, profileId: link.profileId, status: bypassStatus(link)};
    });
}

async function createDeadlineBypassLink(event: Event, body: any, session: Request['session']) {
    if (!event) throw new APIError('Event not found', body, 404);
    if (!session.auth?.user) throw new APIError('Must be logged in', body, 401);

    const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
    return await eventService.createDeadlineBypassLink(
        event.id,
        session.auth.user.id,
        {expiresAt, maxUses: 1}
    );
}

async function revokeDeadlineBypassLink(event: Event, linkId: string) {
    await eventService.revokeDeadlineBypassLink(event.id, linkId);
}

async function getParticipants(event: Event) {
    return await eventService.getEventParticipants(event.id);
}

async function deleteRegistration(event: Event, registrationId: string) {
    return await eventService.deleteRegistration(event.id, registrationId);
}

// Update registration arrival and departure dates
// Note: Permission check for MANAGE_REGISTRATIONS is enforced at the route level
async function updateRegistrationDates(event: Event, registrationId: string, body: any, permData?: PermBundle) {
    const schema = Joi.object({
        arrivalDate: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
        departureDate: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
    });
    const {error, value} = schema.validate(body, {abortEarly: false, allowUnknown: true});
    if (error) {
        const msg = error.details.map((d) => d.message).join(', ');
        throw new APIError(msg, body, 400);
    }

    if (!isWithinWindow(event.startDate, event.endDate, value.arrivalDate, value.departureDate)) {
        throw new APIError('Arrival/Departure must be within event dates', body, 400);
    }

    const updated = await eventService.updateRegistrationDates(event.id, Number(registrationId), value.arrivalDate, value.departureDate);
    if (!updated) throw new APIError('Registration not found', {}, 404);
    return 'Registration updated';
}

async function getParticipantsExtended(event: Event) {
    const participants = await eventService.getEventParticipants(event.id);
    const totals: Record<string, number> = {};
    const allergies: Set<string> = new Set();
    const comments: Set<string> = new Set();
    for (const p of participants) {
        const choices = new Set(p.dietaryChoices.map(c => c.choice));
        const allergy = p.dietaryChoices.find(c => c.choice === "ALLERGIES")?.additionalInfo;
        if (allergy) {
            aggregateInfos(allergies, allergy);
        }

        const comment = p.dietaryChoices.find(c => c.choice === "COMMENT")?.additionalInfo;
        if (comment) {
            aggregateInfos(comments, comment);
        }

        countChoices(choices, totals);
    }
    const dateTotals: Record<string, number> = buildDateTotals(event.startDate, event.endDate, participants);
    return {
        event: event,
        participants: participants,
        totals: totals,
        dateTotals: dateTotals,
        allergies: [...allergies],
        comments: [...comments],
        generatedAt: new Date().toISOString(),
    }
}

function aggregateInfos(infoSet: Set<string>, infoString: string) {
    const coms = infoString.split(';')
        .map(v => v.trim())
        .filter(Boolean);
    for (const com of coms) {
        infoSet.add(com);
    }
}

function countChoices(choices: Set<DIETARY>, totals: Record<string, number>) {
    const hasMeat = choices.has('MEAT');
    const hasFish = choices.has('FISH');

    if (hasMeat && hasFish) {
        totals['MEAT_OR_FISH'] = (totals['MEAT_OR_FISH'] || 0) + 1;
    } else {
        if (hasMeat) totals['JUST_MEAT'] = (totals['JUST_MEAT'] || 0) + 1;
        if (hasFish) totals['JUST_FISH'] = (totals['JUST_FISH'] || 0) + 1;
    }

    // Count all remaining dietary choices normally.
    for (const choice of choices) {
        if (choice === 'MEAT' || choice === 'FISH') continue;
        totals[choice] = (totals[choice] || 0) + 1;
    }
}

async function updateHeaderImg(entity: EntityBase, file?: Express.Multer.File) {
    await performImageSwap(entity, eventService.updateHeaderImage, file);
    return 'Image updated';
}

async function deleteHeaderImg(entity: EntityBase) {
    await performImageSwap(entity, eventService.updateHeaderImage);
    return 'Image deleted';
}

export default {
    preprocessCreate,
    createEntity,
    afterCreateItems,
    fetchForView,
    fetchForDuplicate,
    deleteEntity,

    registerAttendance,
    cancelRegistration,
    updateEventSettings,
    updateSettings,

    listDeadlineBypassLinks,
    createDeadlineBypassLink,
    revokeDeadlineBypassLink,

    getParticipants,
    deleteRegistration,
    updateRegistrationDates,
    getParticipantsExtended,

    updateHeaderImg,
    deleteHeaderImg,
};
