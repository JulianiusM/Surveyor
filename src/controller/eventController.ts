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
import {
    applyEntityAdministrator, archiveEntity, assertEditableEntityFields, classifyArchiveCommandError, comparisonToken, completeDefaults,
    entityMethodPermission, getArchivePresentations, getArchiveView, getEntityPropertyPresentation, permissionDefinitions,
    requireFieldComparison, restoreEntity, setAutomaticArchival,
} from "./entityAdminController";
import {getAccountPageEntry, hasAccountProfile} from './userController';
import crypto from 'node:crypto';
import path from 'node:path';
// Business logic for the Event routes
import Joi from 'joi';
import type {EntityManager} from 'typeorm';

import {Event} from "../modules/database/entities/event/Event";
import {EventRegistration} from "../modules/database/entities/event/EventRegistration";
import {ALLOWED_DIETARY} from "../modules/database/entities/event/EventRegistrationDietary";
import * as invoiceService from "../modules/database/services/EventInvoiceService";
import {invoicePresentation} from '../modules/invoice/presentation';

import * as eventService from '../modules/database/services/EventService';
import * as adminService from '../modules/database/services/EntityAdminService';
import * as userService from '../modules/database/services/UserService';
import * as lifecycleService from '../modules/database/services/EntityLifecycleService';
import activityController from './activityController';
import driversController from './driversController';
import {deletePackingList} from './packingController';
import * as activityService from '../modules/database/services/ActivityService';
import * as driverService from '../modules/database/services/DriverService';
import * as packingService from '../modules/database/services/PackingService';
import {archiveKey} from '../modules/archive/policy';
import {ApiProblem} from '../modules/api/problem';
import {APIError, ValidationError} from '../modules/lib/errors';
import {checkNewImage, performImageSwap, removeImage} from "../modules/lib/fileCommons";
import {getInitialPerms, PERM} from '../modules/lib/permissions';
import {
    buildDateTotals,
    convertToSingleList,
    ENTITIES,
    getResource,
    getHeaderImageVersion,
    isWithinWindow,
    normalizeToArray,
    rewriteISOToZone
} from "../modules/lib/util";
import {can, evaluateEntities, evaluateSubject, getEntityPermissionQueryScope, isOwner, saveDefaultPermsFromBody} from "../modules/permissionEngine";
import {requireSessionProfileId} from '../modules/lib/session';
import {safeFrontendReturn} from '../modules/lib/frontendIdentity';
import {projectOverviewCard} from '../modules/overview/api';
import type {DIETARY, EventLinkOption, EventLinkOptionsQuery, EventLinkOptionsResult, EventMethod} from "../types/EventTypes";
import type {EntityAdministratorCommand, PermBundle, PermType, PermView, SessionLike} from "../types/PermissionTypes";
import type {components} from '../types/api/v1';
import type {ApiResponsePreparer} from '../types/ApiTransportTypes';
import type {EntityMutationOutcome} from '../types/EntityPropertyTypes';
import type {EntityBase} from "../types/UserTypes";
import {WithRequired} from "../types/UtilTypes";

// Template constant for create errors
const CREATE_TEMPLATE = 'event/event-create';

/** One declaration selects method grants for native middleware, v1 commands and
 * capabilities. This preserves the existing independent bits and the participant
 * export's combined requirement; profile/account/participant admission remains
 * with the native route or shared operation rather than being inferred here. */
const eventMethodPermissions: Record<EventMethod, readonly PermType[]> = {
    register: ['ACCESS_REGISTRATION'], admin: ['ACCESS_ADMIN'], participants: ['ACCESS_PARTICIPANTS'],
    manageRegistrations: ['MANAGE_REGISTRATIONS'], items: ['ACCESS_ITEMS'], manageAssignments: ['MANAGE_ASSIGNMENTS'],
    exportParticipants: ['DATA_EXPORT', 'ACCESS_PARTICIPANTS'],
    managePermissions: [entityMethodPermission('managePermissions')],
    editHeader: [entityMethodPermission('editHeader')], duplicate: [entityMethodPermission('duplicate')],
};

/** Translate this owner's complete grant choice to the existing native middleware bitmask. */
export function eventMethodPermission(method: EventMethod): number {
    return eventMethodPermissions[method].reduce((mask, key) => mask | PERM[key], 0);
}

/** The permission engine interprets grants; this owner selects every required method bit. */
function mayPerformEventMethod(permissions: PermView, method: EventMethod): boolean {
    return permissions.all(...eventMethodPermissions[method]);
}

/** Related content requires own attendance or assignment-management authority.
 * Page/method admission and each child's lifecycle grants remain separate checks. */
function mayReadEventChildren(registration: EventRegistration | null, managesAssignments: boolean): boolean {
    return Boolean(registration || managesAssignments);
}

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

/**
 * Authorize the actual attachment target through the common event method policy.
 * A selected URL is discovery only; creation/relink adapters call this owner again.
 *
 * @param manager Transaction used for current permission evidence by a locked caller.
 * @param knownEvent That caller's selected, locked event row; null means the row
 * disappeared, while undefined retains the native lookup. The row belongs to eventId.
 */
export async function authorizeEventLink(eventId: string | null | undefined, session: SessionLike,
                                         manager?: EntityManager, knownEvent?: Event | null): Promise<Event | null> {
    requireSessionProfileId(session);
    if (eventId === null || eventId === undefined || eventId === '') return null;
    const {error} = Joi.string().uuid().validate(eventId);
    if (error) throw new APIError('Invalid event.', {}, 400);

    // Native callers keep their existing lookup. A controller operating under a
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
 * Resolve an optional initial selection without disclosing a rejected event. Native
 * forms and migrating features share this read projection; submitting an event still
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
    if (error || (value.from && value.to && value.from > value.to)) throw new APIError('Invalid event filters.', {}, 400);
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

function preprocessCreate(body: any): WithRequired<Partial<Event>, 'title' | 'startDate' | 'endDate'> {
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

// Native and versioned creation both persist defaults after the Event commit.
async function afterCreateItems(id: string, data: any, inputFormat?: 'permissionKeys' | 'masks') {
    await saveDefaultPermsFromBody(ENTITIES.EVENT, id, data._body, {inputFormat});
}

/**
 * Adapt generated multipart values to the existing Event creation owners. Native
 * creation and defaults remain separate commits; entering those owners makes a
 * later failure uncertain, never proof that an Event or uploaded image is absent.
 */
export async function createEvent(body: components['schemas']['EventCreateInput'], file: Express.Multer.File | undefined,
    session: SessionLike): Promise<components['schemas']['EventCreated']> {
    requireEventCreation(session);
    let parsed: ReturnType<typeof preprocessCreate>;
    try {
        // JSON booleans and nullable controls select the same native form values.
        // The native parser remains the single owner of cross-field validation.
        const nativeBody = {...body, maxParticipants: body.maxParticipants ?? '',
            requireDietaryInfo: body.requireDietaryInfo ? 'on' : '', allowDietComment: body.allowDietComment ? 'on' : '',
            allowRegDateUpdatesAfterDeadline: body.allowRegDateUpdatesAfterDeadline ? 'on' : '',
            allowRegCancelationAfterDeadline: body.allowRegCancelationAfterDeadline ? 'on' : '',
            allowRegDietUpdateAfterDeadline: body.allowRegDietUpdateAfterDeadline ? 'on' : ''};
        delete (nativeBody as Partial<typeof nativeBody>).defaultPermissions;
        checkNewImage(file);
        parsed = preprocessCreate(nativeBody);
    } catch (error) {
        // No creation has started. This upload cannot be referenced by an Event.
        if (file) removeImage(file.path);
        throw error;
    }

    const data = {...parsed, ...(file ? {headerImg: path.relative(process.cwd(), file.path)} : {}),
        _body: {defaultPerms: body.defaultPermissions}};
    try {
        // Preserve the inherited order and partial outcomes; no new encompassing
        // transaction or later session/roster read changes the business boundary.
        const id = await createEntity(session.profile!.id, data);
        await afterCreateItems(id, data, 'masks');
        return {id};
    } catch {
        // The client keeps its draft and must review before another deliberate
        // creation. Retain an image that an already committed Event may reference.
        throw new ApiProblem('WORKFLOW_OUTCOME_UNKNOWN');
    }
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
    const managesAssignments = await can({
        entity: {
            entityId: event.id,
            ownerId: event.ownerId,
            entityType: "event"
        },
        kind: "entity"
    }, req.session, eventMethodPermission('manageAssignments'));
    const shouldShowScoped = mayReadEventChildren(registration, managesAssignments);
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
    const isFull = eventCapacityReached(event.maxParticipants, participants.length);

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

/** Validate and save current-profile attendance through the unchanged native lifecycle.
 * Stable causes let the versioned adapter localize known rejections while native
 * callers retain their original literal messages, statuses and registration order. */
async function registerAttendance(event: Event, body: any, req: {session: SessionLike; resource?: Record<string, unknown>}) {
    if (!event) throw new APIError('Event not found', body, 404);
    const session = req.session;
    if (!session.profile) throw new APIError('Authentication required', body, 401);

    // Deny registration if not already registered (allow updates to registration)
    const registration = await eventService.getRegistrationFor(session.profile.id, event.id);
    if (!registration && await isEventFull(event.id)) {
        throw new APIError('Event is full', body, 403, {cause: 'EVENT_FULL'});
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
                throw new APIError('Date updates not allowed after deadline has passed', {}, 403, {cause: 'EVENT_DATE_UPDATES_CLOSED'});
            }
            // Are diet updates allowed?
            if (!event.allowRegDietUpdateAfterDeadline && !isDietaryEqual(registration, dietary, value.allergyNotes, value.dietComment)) {
                throw new APIError('Diet updates not allowed after deadline has passed', {}, 403, {cause: 'EVENT_DIET_UPDATES_CLOSED'});
            }
        } else {
            bypass = await canBypassDeadlineWithToken(event.id, body.regToken ?? req.resource?.regToken ?? null);
            if (!bypass.ok) {
                // owners/co-organizers may bypass via permission in your middleware;
                // if you still reach here, reject:
                throw new APIError('Registration deadline has passed', {}, 403, {cause: 'EVENT_DEADLINE_PASSED'});
            }
        }
    }

    if (!isWithinWindow(event.startDate, event.endDate, value.arrivalDate, value.departureDate)) {
        throw new APIError('Arrival/Departure must be within event dates', body, 400, {cause: 'EVENT_DATES_INVALID'});
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
            if (!link || bypassStatus(link) !== 'active') throw new APIError('This link has already been used', {}, 409, {cause: 'EVENT_TOKEN_USED'});
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

/** Keep the native dietary combinations and note requirements under one business owner. */
function checkMeals(dietary: DIETARY[], allergyNotes: string, dietComment: string, body: any) {
    // A selected supplementary category needs its own note before meal-combination checks.
    if (dietary.includes("ALLERGIES") && !allergyNotes) {
        throw new APIError('Allergies require additional information', body, 400, {cause: 'EVENT_ALLERGY_INFO_REQUIRED'});
    }
    if (dietary.includes("COMMENT") && !dietComment) {
        throw new APIError('Comment requires additional information', body, 400, {cause: 'EVENT_COMMENT_REQUIRED'});
    }

    // Supplementary requirements do not substitute for a selected meal preference.
    const meals = dietary.filter(d =>
        ['MEAT', 'FISH', 'VEGETARIAN', 'VEGAN'].includes(d)
    );

    if (dietary.length > 0 && meals.length === 0) {
        throw new APIError('At least one meal preference must be selected.', body, 400, {cause: 'EVENT_MEAL_REQUIRED'});
    }

    if (meals.includes('VEGETARIAN')) {
        if (meals.includes('MEAT') || meals.includes('FISH') || meals.includes('VEGAN')) {
            throw new APIError('Vegetarian cannot be combined with meat, fish or vegan.', body, 400, {cause: 'EVENT_VEGETARIAN_CONFLICT'});
        }
    }

    if (meals.includes('VEGAN')) {
        if (meals.includes('MEAT') || meals.includes('FISH') || meals.includes('VEGETARIAN')) {
            throw new APIError('Vegan cannot be combined with meat, fish or vegetarian.', body, 400, {cause: 'EVENT_VEGAN_CONFLICT'});
        }
    }
}

/** Cancel the active profile's attendance under its independent post-deadline rule. */
async function cancelRegistration(event: Event, session: SessionLike) {
    // Cancellation has its own event flag; date/diet update flags confer no cancellation right.
    if (event.bindingDeadline && new Date(Date.parse(event.bindingDeadline)) < new Date() && !event.allowRegCancelationAfterDeadline) {
        throw new APIError('Cancellation is not allowed after registration deadline has passed', {}, 403, {cause: 'EVENT_CANCELLATION_CLOSED'});
    }
    if (session.profile?.id) {
        await eventService.deleteRegistrationFor(event.id, session.profile.id);
    } else {
        throw new APIError('Authentication required', {}, 401);
    }
    return 'Registration cancelled';
}

/* ----------------------- API: Organizer edit ----------------------- */

/** Normalize sparse Event properties under the existing field policy and locked current date/deadline context.
 * Native calls retain their service-managed transaction; a versioned caller can supply its existing
 * transaction so reviewed comparison and final result preparation share that lock. */
async function updateEventSettings(event: Event, body: any, permData?: Pick<PermBundle, 'entity'>, manager?: EntityManager) {
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
        catch { throw new APIError('Invalid time zone.', {}, 400, {cause: 'EVENT_TIMEZONE_INVALID'}); }
        patch.timezone = value.deadlineTz || null;
    }
    async function updateLocked(manager: import('typeorm').EntityManager): Promise<void> {
        const current = await eventService.lockEvent(manager, event.id);
        if (!current) throw new APIError('Event not found', {}, 404);
        const startDate = patch.startDate ?? current.startDate;
        const endDate = patch.endDate ?? current.endDate;
        if (startDate > endDate) throw new APIError('Start date must be before end date', {}, 400, {cause: 'EVENT_START_AFTER_END'});
        // An omitted deadline is never rewritten. A supplied local deadline uses the submitted
        // zone or the locked row's current zone, avoiding an earlier request-load snapshot.
        if (value.bindingDeadline !== undefined) {
            try {
                patch.bindingDeadline = value.bindingDeadline
                    ? rewriteISOToZone(value.bindingDeadline, value.deadlineTz || current.timezone || 'UTC') : null;
                if (patch.bindingDeadline && !Number.isFinite(Date.parse(patch.bindingDeadline))) throw new Error('Invalid deadline');
            } catch {
                throw new APIError('Invalid binding deadline or time zone.', {}, 400, {cause: 'EVENT_DEADLINE_INVALID'});
            }
        }
        await eventService.updateEventProperties(event.id, patch, manager);
    }
    // Versioned metadata supplies its existing lock/field comparison transaction.
    // Native callers retain the original service-managed transaction unchanged.
    if (manager) await updateLocked(manager);
    else await eventService.withEventTransaction(updateLocked);
    return 'Event updated';
}

async function updateSettings(id: string, body: any) {
    await saveDefaultPermsFromBody(ENTITIES.EVENT, id, body);
    return 'Settings saved';
}

/** One capacity policy serves native/v1 presentation and registration admission.
 * Missing limits remain unlimited, while a persisted zero still closes admission.
 * Callers supply their existing count so this rule introduces no read or lock. */
function eventCapacityReached(limit: number | null | undefined, registrationCount: number): boolean {
    return limit != null && registrationCount >= limit;
}

/** Capacity is policy over persisted event limits and registration counts. */
export async function isEventFull(eventId: string): Promise<boolean> {
    const event = await eventService.getEventById(eventId);
    if (!event) throw new APIError('Event not found', {}, 404);
    // Preserve the existing unlimited-event shortcut and separate count read;
    // consolidating presentation policy does not strengthen its concurrency guarantee.
    const registrationCount = event.maxParticipants == null ? 0 : await eventService.getEventRegistrationCount(eventId);
    return eventCapacityReached(event.maxParticipants, registrationCount);
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

/** Issue the existing single-use registration link for an admitted full-account organizer. */
async function createDeadlineBypassLink(event: Event, body: any, session: SessionLike) {
    if (!event) throw new APIError('Event not found', body, 404);
    if (!session.auth?.user) throw new APIError('Must be logged in', body, 401, {cause: 'EVENT_LINK_ACCOUNT_REQUIRED'});

    // Account-only issuance is an action rejection for a valid guest, never session expiry.
    // Preserve the native optional-expiry parser and fixed single-use persistence behavior.
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

/** Update one event-scoped registration within the Event's inclusive date window.
 * Native route middleware and the versioned method adapter independently enforce
 * MANAGE_REGISTRATIONS before calling this shared validation/persistence owner. */
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

    // Organizer edits retain the same date-window policy as self-registration,
    // while removal and cancellation have their own separately admitted operations.
    if (!isWithinWindow(event.startDate, event.endDate, value.arrivalDate, value.departureDate)) {
        throw new APIError('Arrival/Departure must be within event dates', body, 400, {cause: 'EVENT_DATES_INVALID'});
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

/** Interpret nullable persistence evidence without leaking ORM data or database errors. */
function requireEvent(event: Event | null): Event {
    if (!event) throw new ApiProblem('NOT_FOUND');
    return event;
}

/** Every Event method uses the same event participant audience as native middleware. */
async function eventPermissions(event: Event, session: SessionLike, manager?: EntityManager): Promise<PermView> {
    return evaluateSubject({kind: 'entity', entity: {
        entityType: 'event', entityId: event.id, ownerId: event.ownerId, eventId: event.id,
    }}, session, undefined, manager);
}

/** Creation remains account-only even when an independently authorized duplicate supplied its draft. */
export function requireEventCreation(session: SessionLike): void {
    if (!session.profile) throw new ApiProblem('AUTH_REQUIRED');
    if (!hasAccountProfile(session)) throw new ApiProblem('FORBIDDEN');
}

/** Form definitions reuse the shared maintained permission/preset catalog. */
export function eventFormContext(): components['schemas']['EventCreateContext'] {
    return {defaults: completeDefaults(getInitialPerms('event')), ...permissionDefinitions()};
}

/** Project account-page admission without creating an anonymous session or exposing Event content. */
export function readEventCreateEntry(session: SessionLike, returnTo?: unknown): components['schemas']['EventCreateEntry'] {
    const target = safeFrontendReturn(returnTo ?? '/frontend-pilot/event/create');
    const entry = getAccountPageEntry(session, '/frontend-pilot/users/login', target);
    return {entry, context: entry.kind === 'render' ? eventFormContext() : null};
}

/** Account-only initial forms and public duplicate forms share the same static definitions. */
export function readEventCreateContext(session: SessionLike): components['schemas']['EventCreateContext'] {
    requireEventCreation(session);
    return eventFormContext();
}

/** The guest form intentionally receives only the existing public Event title. */
export async function readEventGuestEntry(id: string): Promise<components['schemas']['GuestEntry']> {
    const event = requireEvent(await eventService.getEventById(id));
    return {id: event.id, title: event.title};
}

/**
 * Share native page admission between SSR and client navigation. A token is
 * navigation state only: neither guest entry nor prefetch consumes its use.
 * Administration admission and the roster's later method grant stay separate.
 */
export async function readEventResourceEntry(id: string, view: 'detail' | 'guest' | 'admin', session: SessionLike,
    regToken?: string): Promise<components['schemas']['EventResourceEntry']> {
    return eventService.withEventReadSnapshot(id, async function readEntry(manager, row) {
        if (!row) return {entry: {kind: 'denied', status: 404, messageKey: 'event.notFound'}, guest: null};
        const detailUrl = `/frontend-pilot/event/${encodeURIComponent(id)}`;
        const tokenQuery = regToken ? `?${new URLSearchParams({regToken})}` : '';
        if (view === 'guest') {
            return session.profile
                ? {entry: {kind: 'redirect', url: `${detailUrl}${tokenQuery}`, notice: null}, guest: null}
                : {entry: {kind: 'render'}, guest: {id: row.id, title: row.title}};
        }
        if (!session.profile) {
            return {entry: {kind: 'redirect', url: `${detailUrl}/guest${tokenQuery}`, notice: null}, guest: null};
        }
        // Native Event detail admits an active profile independently of ACCESS_VIEW.
        // Its admin route additionally requires ACCESS_ADMIN; no roster data enters admission.
        if (view === 'admin' && !mayPerformEventMethod(await eventPermissions(row, session, manager), 'admin')) {
            return {entry: {kind: 'denied', status: 403, messageKey: 'problem.forbidden'}, guest: null};
        }
        return {entry: {kind: 'render'}, guest: null};
    });
}

/** Project only the current profile's attendance and its normalized dietary values. */
function projectRegistration(registration: EventRegistration | null): components['schemas']['EventRegistration'] | null {
    if (!registration) return null;
    const dietary = registration.dietaryChoices ?? [];
    return {id: String(registration.id), arrivalDate: registration.arrivalDate, departureDate: registration.departureDate,
        dietary: dietary.map(choice => choice.choice),
        allergyNotes: dietary.find(choice => choice.choice === 'ALLERGIES')?.additionalInfo ?? '',
        dietComment: dietary.find(choice => choice.choice === 'COMMENT')?.additionalInfo ?? ''};
}

/** Header storage references stay private; clients receive a route and opaque version only. */
function eventHeader(event: Event) {
    return {headerUrl: event.headerImg ? `/api/v1/events/${encodeURIComponent(event.id)}/header` : null,
        headerVersion: getHeaderImageVersion(event.headerImg)};
}

/** Convert shared archival presentation into the existing frontend lifecycle contract. */
async function eventArchive(event: Event, session: SessionLike, manager: EntityManager) {
    const reference = {type: 'event' as const, id: event.id};
    const snapshot = await lifecycleService.getArchiveSnapshot([reference], manager);
    const presentations = await getArchivePresentations([reference], session, snapshot, manager);
    return presentations.get(archiveKey(reference))!;
}

/** Event detail deliberately omits other registrations, invoice data and management baselines. */
export async function readEvent(id: string, session: SessionLike, view: 'detail' | 'admin' = 'detail'): Promise<components['schemas']['EventView']> {
    requireSessionProfileId(session);
    return eventService.withEventReadSnapshot(id, async function readDetail(manager, row) {
        const event = requireEvent(row);
        const permissions = await eventPermissions(event, session, manager);
        if (view === 'admin' && !mayPerformEventMethod(permissions, 'admin')) throw new ApiProblem('FORBIDDEN');
        // Select only own attendance and a cardinality; never load the native invoice/roster aggregate.
        const registration = await eventService.getRegistrationFor(session.profile!.id, id, manager);
        const registrationCount = await eventService.getEventRegistrationCount(id, manager);
        const archive = await eventArchive(event, session, manager);
        const properties = await getEntityPropertyPresentation('event', event, session, manager);
        return {id, title: event.title, description: event.description ?? null, ...eventHeader(event),
            startDate: event.startDate, endDate: event.endDate, location: event.location ?? null,
            bindingDeadline: event.bindingDeadline ? new Date(event.bindingDeadline).toISOString() : null,
            timezone: event.timezone || 'UTC', maxParticipants: event.maxParticipants ?? null,
            requireDietaryInfo: Boolean(event.requireDietaryInfo), allowDietComment: Boolean(event.allowDietComment),
            allowRegDateUpdatesAfterDeadline: Boolean(event.allowRegDateUpdatesAfterDeadline),
            allowRegCancelationAfterDeadline: Boolean(event.allowRegCancelationAfterDeadline),
            allowRegDietUpdateAfterDeadline: Boolean(event.allowRegDietUpdateAfterDeadline),
            registrationCount, isFull: eventCapacityReached(event.maxParticipants, registrationCount),
            hasInvoicePools: Boolean(registration && await invoiceService.hasEventPools(id, manager)),
            registration: projectRegistration(registration), capabilities: {
                register: mayPerformEventMethod(permissions, 'register'), admin: mayPerformEventMethod(permissions, 'admin'),
                participants: mayPerformEventMethod(permissions, 'participants'), manageRegistrations: mayPerformEventMethod(permissions, 'manageRegistrations'),
                manageAssignments: mayPerformEventMethod(permissions, 'manageAssignments'),
                items: mayPerformEventMethod(permissions, 'items'), settings: properties.canEditProperties || properties.canEditHeader
                    || properties.canManagePermissions || properties.canDuplicate || properties.canDelete || archive.canManage || Boolean(properties.exportUrl),
                exportParticipants: mayPerformEventMethod(permissions, 'exportParticipants'),
            }, archive: {direct: archive.directArchived, inherited: Boolean(archive.inheritedFromEventId),
                archivedAt: event.archivedAt?.toISOString() ?? null, autoArchivePaused: archive.autoArchivePaused, eventUrl: null}};
    });
}

/** Trim only the existing title field before generated length validation, retaining unknown-field rejection. */
export function normalizeEventMetadataPatch(body: unknown): unknown {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
    const patch = {...body as Record<string, unknown>};
    if (typeof patch.title === 'string') patch.title = patch.title.trim();
    return patch;
}

/** Preserve public DATA_DUPLICATE admission while copying only the native Event form surface. */
export async function readEventDuplicate(id: string, session: SessionLike): Promise<components['schemas']['EventDuplicate']> {
    return eventService.withEventReadSnapshot(id, async function readDuplicate(manager, row) {
        const event = requireEvent(row);
        if (!mayPerformEventMethod(await eventPermissions(event, session, manager), 'duplicate')) throw new ApiProblem('FORBIDDEN');
        // Source attendance, invoices, images and archival state never become new-event input.
        return {values: {title: event.title, description: event.description ?? '',
            startDate: event.startDate, endDate: event.endDate, location: event.location ?? '',
            // Native duplication inserts the persisted timestamp directly into datetime-local;
            // the browser presents an empty control. Do not silently change that copied draft.
            bindingDeadline: '', deadlineTz: event.timezone || 'UTC',
            maxParticipants: event.maxParticipants || null, requireDietaryInfo: Boolean(event.requireDietaryInfo),
            allowDietComment: Boolean(event.allowDietComment),
            allowRegDateUpdatesAfterDeadline: Boolean(event.allowRegDateUpdatesAfterDeadline),
            allowRegCancelationAfterDeadline: Boolean(event.allowRegCancelationAfterDeadline),
            allowRegDietUpdateAfterDeadline: Boolean(event.allowRegDietUpdateAfterDeadline),
            defaultPermissions: completeDefaults(await adminService.getDefaultPerms('event', id, manager))}, formContext: eventFormContext()};
    });
}

/** Obtain only fields admitted by the existing shared entity-property policy. */
async function eventMetadata(event: Event, session: SessionLike, manager: EntityManager): Promise<components['schemas']['EventMetadata']> {
    const properties = await getEntityPropertyPresentation('event', event, session, manager, 'method');
    if (!properties.editableFields.length) throw new ApiProblem('FORBIDDEN');
    const values = {...properties.values} as components['schemas']['EventMetadataValues'];
    // MariaDB tinyint columns can arrive as numeric flags. The machine wire
    // contract uses booleans while field omission still follows the shared policy.
    for (const field of ['requireDietaryInfo', 'allowDietComment', 'allowRegDateUpdatesAfterDeadline',
        'allowRegCancelationAfterDeadline', 'allowRegDietUpdateAfterDeadline'] as const) {
        if (Object.hasOwn(values, field)) values[field] = Boolean(values[field]);
    }
    return {id: event.id, values, editableFields: properties.editableFields as components['schemas']['EventMetadata']['editableFields'],
        editToken: comparisonToken('event-metadata', event.id, session, values)};
}

/** Native Event property methods are publicly grantable; disclose only their permitted field baseline. */
export async function readEventMetadata(id: string, session: SessionLike): Promise<components['schemas']['EventMetadata']> {
    return eventService.withEventReadSnapshot(id, async function readMetadata(manager, row) {
        return eventMetadata(requireEvent(row), session, manager);
    });
}

/** Direct controller callers receive the saved permitted metadata projection. */
export function patchEventMetadata(id: string, patch: components['schemas']['EventMetadataPatch'], token: string | undefined,
    session: SessionLike): Promise<components['schemas']['EventMetadata']>;
/** HTTP adapters prepare their exact generated receipt while the write can still roll back. */
export function patchEventMetadata<Result>(id: string, patch: components['schemas']['EventMetadataPatch'], token: string | undefined,
    session: SessionLike, prepareResult: ApiResponsePreparer<'updateEventMetadata', 200, Result>): Promise<Result>;
/** Recheck current grants and selected-field comparisons under the existing Event lock. */
export async function patchEventMetadata<Result>(id: string, patch: components['schemas']['EventMetadataPatch'], token: string | undefined,
    session: SessionLike, prepareResult?: ApiResponsePreparer<'updateEventMetadata', 200, Result>): Promise<components['schemas']['EventMetadata'] | Result> {
    return eventService.withEventTransaction(async function saveMetadata(manager) {
        const event = requireEvent(await eventService.lockEvent(manager, id));
        const permissions = await eventPermissions(event, session, manager);
        // Authorization precedes comparison, so revoked fields cannot leak their current hash/value.
        assertEditableEntityFields('event', patch, permissions);
        const baseline = await eventMetadata(event, session, manager);
        requireFieldComparison(token, baseline.editToken, Object.keys(patch));
        await updateEventSettings(event, patch, {entity: permissions}, manager);
        const saved = await eventMetadata(requireEvent(await eventService.getEventById(id, manager)), session, manager);
        // A malformed projection/serialization rejects before commit; only the
        // already prepared receipt leaves the actual HTTP adapter's transaction.
        return prepareResult ? prepareResult(saved) : saved;
    });
}

/** Run only new adapter admission under the existing root lock; business operations retain their owners. */
async function withEventManagement<T>(id: string, session: SessionLike,
    operation: (manager: EntityManager, event: Event, permissions: PermView) => Promise<T>): Promise<T> {
    return eventService.withEventTransaction(async function manageEvent(manager) {
        const event = requireEvent(await eventService.lockEvent(manager, id));
        return operation(manager, event, await eventPermissions(event, session, manager));
    });
}

/** Settings hashes contain only method-permitted shared fields, never hidden participant data. */
async function eventSettingsToken(event: Event, session: SessionLike, manager: EntityManager, access: boolean): Promise<string> {
    const defaults = access ? completeDefaults(await adminService.getDefaultPerms('event', event.id, manager)) : null;
    return comparisonToken('event-settings', event.id, session, {header: event.headerImg ?? null,
        ...(defaults ? Object.fromEntries(Object.entries(defaults).map(([key, value]) => [`default:${key}`, value])) : {}),
        ...(access ? {newAdmin: null} : {})});
}

/** Keep permission administration separate from ordinary metadata/settings visibility. */
export async function readEventSettings(id: string, session: SessionLike): Promise<components['schemas']['EventSettings']> {
    requireSessionProfileId(session);
    /** Select permitted settings and their tokens from one read snapshot. */
    return eventService.withEventReadSnapshot(id, async function readSettings(manager, row) {
        const event = requireEvent(row);
        const properties = await getEntityPropertyPresentation('event', event, session, manager);
        const archive = await eventArchive(event, session, manager);
        // Export has its existing combined method grant, independent of admin
        // entry or edit rights. Admit that Actions-only dialog without disclosing
        // metadata, audience values or administrator comparison baselines.
        if (!(properties.canEditProperties || properties.canEditHeader || properties.canManagePermissions
            || properties.canDuplicate || properties.canDelete || archive.canManage || properties.exportUrl)) throw new ApiProblem('FORBIDDEN');
        // Ordinary editors never receive audience/admin values or their guessable comparison hashes.
        let access: components['schemas']['PackingAccess'] | null = null;
        if (properties.canManagePermissions) {
            const administrators = await adminService.listAdmins('event', id, manager);
            access = {defaults: completeDefaults(await adminService.getDefaultPerms('event', id, manager)), ...permissionDefinitions(),
                admins: administrators.map(admin => ({profileId: admin.profileId, name: admin.profile.name,
                    isGuest: Boolean(admin.profile.guestId), mask: admin.perms,
                    editToken: comparisonToken('event-admin', `${id}:${admin.profileId}`, session, {mask: admin.perms})}))};
        }
        return {id, title: event.title, ...eventHeader(event),
            settingsToken: await eventSettingsToken(event, session, manager, properties.canManagePermissions),
            editableFields: properties.editableFields as components['schemas']['EventSettings']['editableFields'],
            capabilities: {editHeader: properties.canEditHeader, managePermissions: properties.canManagePermissions,
                duplicate: properties.canDuplicate, remove: properties.canDelete, manageArchive: archive.canManage,
                archive: archive.canArchive, restore: archive.canRestore, manageAutomation: archive.canManageAutomation,
                export: Boolean(properties.exportUrl)},
            archive: {direct: archive.directArchived, inherited: Boolean(archive.inheritedFromEventId),
                archivedAt: event.archivedAt?.toISOString() ?? null, autoArchivePaused: archive.autoArchivePaused, eventUrl: null}, access};
    });
}

/** Native registration retains its capacity/deadline/dietary checks and transactional token consumption. */
export async function saveEventRegistration(id: string, body: components['schemas']['EventRegistrationInput'], session: SessionLike) {
    requireSessionProfileId(session);
    const event = requireEvent(await eventService.getEventById(id));
    if (!mayPerformEventMethod(await eventPermissions(event, session), 'register')) throw new ApiProblem('FORBIDDEN');
    // The captured actor is passed explicitly; no mutable Express session is consulted after admission.
    await registerAttendance(event, body, {session});
    return {changed: true};
}

/** Cancellation retains native profile admission, deadline policy and an absent-attendance no-op. */
export async function cancelEventRegistration(id: string, session: SessionLike) {
    requireSessionProfileId(session);
    const event = requireEvent(await eventService.getEventById(id));
    // The native Event root has no parent eventId, so its participant middleware
    // adds no attendance requirement. Repeated own-profile cancellation succeeds;
    // the shared operation still rejects a closed deadline before its scoped delete.
    await cancelRegistration(event, session);
    return {changed: true};
}

/** Authorize a named native Event method without disclosing its protected operation data first. */
async function requireEventMethod(id: string, session: SessionLike, method: EventMethod): Promise<Event> {
    const event = requireEvent(await eventService.getEventById(id));
    if (!mayPerformEventMethod(await eventPermissions(event, session), method)) throw new ApiProblem('FORBIDDEN');
    return event;
}

/** Roster/totals reuse the existing export/participant owner and explicitly project each private field. */
export async function readEventParticipants(id: string, session: SessionLike): Promise<components['schemas']['EventParticipants']> {
    const event = await requireEventMethod(id, session, 'participants');
    const data = await getParticipantsExtended(event);
    return {participants: data.participants.map(participant => ({id: String(participant.id), profileId: participant.profileId,
        name: participant.name, email: participant.email ?? null, arrivalDate: participant.arrivalDate, departureDate: participant.departureDate,
        dietary: (participant.dietaryChoices ?? []).map(choice => ({choice: choice.choice, additionalInfo: choice.additionalInfo ?? null}))})),
        totals: Object.entries(data.totals).map(([key, count]) => ({key, count})),
        dateTotals: Object.entries(data.dateTotals).map(([date, count]) => ({date, count})),
        allergies: data.allergies, comments: data.comments, generatedAt: data.generatedAt};
}

/** Organizer edits retain native date validation and event-scoped persistence. */
export async function editEventRegistration(id: string, registrationId: string,
    body: components['schemas']['EventRegistrationDates'], session: SessionLike) {
    const event = await requireEventMethod(id, session, 'manageRegistrations');
    await updateRegistrationDates(event, registrationId, body);
    return {changed: true};
}

/** Organizer removal remains distinct from self-cancellation and its deadline policy. */
export async function removeEventRegistration(id: string, registrationId: string, session: SessionLike) {
    const event = await requireEventMethod(id, session, 'manageRegistrations');
    const changed = await deleteRegistration(event, registrationId);
    if (!changed) throw new ApiProblem('NOT_FOUND');
    return {changed};
}

/** Only registration managers may read bearer links; status comes from the existing controller rule. */
export async function readEventRegistrationLinks(id: string, session: SessionLike): Promise<components['schemas']['EventRegistrationLinks']> {
    const event = await requireEventMethod(id, session, 'manageRegistrations');
    const links = await listDeadlineBypassLinks(event);
    return {items: links.map(link => ({...link, createdAt: link.createdAt.toISOString(),
        expiresAt: link.expiresAt?.toISOString() ?? null, revokedAt: link.revokedAt?.toISOString() ?? null,
        profileId: link.profileId ?? null, status: link.status as components['schemas']['EventRegistrationLink']['status']}))};
}

/** Link creation retains the native account-only, single-use command without a postcommit read. */
export async function addEventRegistrationLink(id: string, body: components['schemas']['EventRegistrationLinkInput'], session: SessionLike) {
    const event = await requireEventMethod(id, session, 'manageRegistrations');
    return createDeadlineBypassLink(event, body, session);
}

/** Revocation uses the existing event-scoped write and never grants roster or registration authority. */
export async function revokeEventRegistrationLink(id: string, linkId: string, session: SessionLike) {
    const event = await requireEventMethod(id, session, 'manageRegistrations');
    await revokeDeadlineBypassLink(event, linkId);
    return {changed: true};
}

/** Event cards share native membership and archival decoration, without private Overview placement. */
export async function readEventThingsToDo(id: string, session: SessionLike, view: 'detail' | 'admin' = 'detail'): Promise<components['schemas']['EventThingsToDo']> {
    const event = await requireEventMethod(id, session, view === 'admin' ? 'admin' : 'items');
    const profileId = requireSessionProfileId(session);
    const registration = await eventService.getRegistrationFor(profileId, id);
    const manages = mayPerformEventMethod(await eventPermissions(event, session), 'manageAssignments');
    // The native detail reveals children only after registration or assignment-management admission.
    if (!mayReadEventChildren(registration, manages)) return {items: []};
    const [activityPlans, packingLists, driversLists] = await Promise.all([
        eventService.getActivityPlansForEvent(id), eventService.getPackingListsForEvent(id), eventService.getDriverListsForEvent(id),
    ]);
    const related = convertToSingleList({activityPlans, packingLists, driversLists});
    const decorated = await getArchiveView({type: 'event', id}, related, session);
    return {items: decorated.relatedEntities.map(card => projectOverviewCard(card, session, view === 'admin', true))};
}

/**
 * Delete an owned child selected from the admitted Event host. Discovery scopes
 * the command; the feature's existing deletion owner retains persistence/cascades.
 * This does not route permanent deletion through archival or promise a new relink lock.
 */
export async function deleteEventChild(id: string, entityType: 'activity' | 'drivers' | 'packing', entityId: string,
    session: SessionLike, view: 'detail' | 'admin' = 'detail'): Promise<components['schemas']['MutationResult']> {
    const permitted = await readEventThingsToDo(id, session, view);
    if (!permitted.items.some(card => card.type === entityType && card.id === entityId)) throw new ApiProblem('NOT_FOUND');

    // A displayed child is neither deletion authority nor an enduring parent
    // relationship. Resolve its current row and require actual profile ownership.
    const child = entityType === 'activity' ? await activityService.getActivityPlanById(entityId)
        : entityType === 'drivers' ? await driverService.getDriversListById(entityId)
            : await packingService.getPackingListById(entityId);
    if (!child || child.eventId !== id) throw new ApiProblem('NOT_FOUND');
    if (!isOwner(session, child.ownerId)) throw new ApiProblem('FORBIDDEN');

    try {
        // Packing already owns its versioned deletion/file completion. The other
        // existing hooks use only this admitted profile and their feature row;
        // no Express lifecycle object is read or mutated by those deletion hooks.
        if (entityType === 'packing') return await deletePackingList(entityId, session, id);
        if (entityType === 'activity') await activityController.deleteEntity(child as import('../modules/database/entities/activity/ActivityPlan').ActivityPlan, session as Request['session']);
        else await driversController.deleteEntity(child as import('../modules/database/entities/drivers/DriversList').DriversList, session as Request['session']);
        if (child.headerImg) removeImage(child.headerImg);
        return {changed: true};
    } catch (error) {
        // The Packing owner compares its parent under the existing root lock
        // before deletion. That explicit stale-host result proves no write began.
        if (error instanceof ApiProblem && error.code === 'ENTITY_CONTEXT_CHANGED') throw error;
        // Neither an interrupted database completion nor failed delivery proves
        // rollback. The SPA must not automatically repeat an irreversible command.
        throw new ApiProblem('WORKFLOW_OUTCOME_UNKNOWN');
    }
}

/** Scoped child lifecycle commands keep relationship admission outside the shared archive policy. */
export async function setEventChildArchived(id: string, entityType: 'activity' | 'drivers' | 'packing', entityId: string,
    archived: boolean, session: SessionLike, view: 'detail' | 'admin' = 'detail') {
    const permitted = await readEventThingsToDo(id, session, view);
    // A URL cannot supply a foreign child. The shared lifecycle owner independently
    // rechecks current child ownership/grants and preserves inherited archive rules.
    if (!permitted.items.some(card => card.type === entityType && card.id === entityId)) throw new ApiProblem('NOT_FOUND');
    /** Recheck the locked relationship and parent admission before its lifecycle write commits. */
    async function prepareArchive(manager: EntityManager, outcome: EntityMutationOutcome) {
        await requireEventChildScope(id, outcome, session, manager, view);
        return {changed: true};
    }
    try {
        if (archived) return await archiveEntity({type: entityType, id: entityId}, {}, session, undefined, {prepare: prepareArchive});
        return await restoreEntity({type: entityType, id: entityId}, {}, session, {prepare: prepareArchive});
    } catch (error) {
        throw classifyArchiveCommandError(error, archived);
    }
}

/** A preflight may become obsolete while waiting for the shared lifecycle lock. */
async function requireEventChildScope(id: string, outcome: EntityMutationOutcome, session: SessionLike,
    manager: EntityManager, view: 'detail' | 'admin'): Promise<void> {
    if (outcome.root.eventId !== id) throw new ApiProblem('ENTITY_CONTEXT_CHANGED');
    const event = requireEvent(await eventService.getEventById(id, manager));
    const permissions = await eventPermissions(event, session, manager);
    if (!mayPerformEventMethod(permissions, view === 'admin' ? 'admin' : 'items')) throw new ApiProblem('FORBIDDEN');
    // Native child discovery requires own attendance or assignment management,
    // independently of the child's archive authority already checked by its owner.
    const registration = await eventService.getRegistrationFor(requireSessionProfileId(session), id, manager);
    if (!mayReadEventChildren(registration, mayPerformEventMethod(permissions, 'manageAssignments'))) throw new ApiProblem('FORBIDDEN');
}

/** Scheduling remains the existing lifecycle owner's decision, separate from archive/restore. */
export async function setEventAutomaticArchival(id: string, body: components['schemas']['EventAutomaticArchivalInput'], session: SessionLike) {
    // The existing completion hook prepares the fixed acknowledgement before commit.
    function prepareAutomatic() { return {changed: true}; }
    return setAutomaticArchival({type: 'event', id}, body, session, {prepare: prepareAutomatic});
}

/** A scoped child URL never substitutes for shared scheduling ownership or current membership. */
export async function setEventChildAutomaticArchival(id: string, entityType: 'activity' | 'drivers' | 'packing', entityId: string,
    body: components['schemas']['EventAutomaticArchivalInput'], session: SessionLike, view: 'detail' | 'admin' = 'detail') {
    const permitted = await readEventThingsToDo(id, session, view);
    if (!permitted.items.some(card => card.type === entityType && card.id === entityId)) throw new ApiProblem('NOT_FOUND');
    /** Reject a relinked child inside the existing lifecycle transaction. */
    async function prepareAutomatic(manager: EntityManager, outcome: EntityMutationOutcome) {
        await requireEventChildScope(id, outcome, session, manager, view);
        return {changed: true};
    }
    return setAutomaticArchival({type: entityType, id: entityId}, body, session, {prepare: prepareAutomatic});
}

/** Publicly granted access management receives only its own current audience baselines. */
export async function readEventDefaultsBaseline(id: string, session: SessionLike): Promise<components['schemas']['PackingDefaultsBaseline']> {
    return eventService.withEventReadSnapshot(id, async function readDefaults(manager, row) {
        const event = requireEvent(row);
        if (!mayPerformEventMethod(await eventPermissions(event, session, manager), 'managePermissions')) throw new ApiProblem('FORBIDDEN');
        const defaultPermissions = completeDefaults(await adminService.getDefaultPerms('event', id, manager));
        return {defaultPermissions, editToken: await eventSettingsToken(event, session, manager, true)};
    });
}

/** Shared permission persistence keeps sparse audience updates and current locked authorization. */
export async function updateEventDefaults(id: string, body: components['schemas']['PermissionDefaultsPatch'], session: SessionLike, token?: string) {
    /** Recheck method authority and selected audiences before shared mask persistence. */
    return withEventManagement(id, session, async function saveDefaults(manager, event, permissions) {
        if (!mayPerformEventMethod(permissions, 'managePermissions')) throw new ApiProblem('FORBIDDEN');
        // Only submitted audiences participate in comparison and writes; omitted grants survive.
        const current = completeDefaults(await adminService.getDefaultPerms('event', id, manager));
        requireFieldComparison(token, await eventSettingsToken(event, session, manager, true), Object.keys(body).map(key => `default:${key}`));
        await saveDefaultPermsFromBody('event', id, {defaultPerms: body}, {manager, inputFormat: 'masks'});
        return {changed: Object.keys(body).some(key => body[key as keyof typeof body] !== current[key as keyof typeof current])};
    });
}

/** Existing grants and absent grants use independent comparison fields. */
function eventAdministratorToken(id: string, profileId: string, mask: number | null, session: SessionLike): string {
    return mask === null ? comparisonToken('event-settings', id, session, {newAdmin: null})
        : comparisonToken('event-admin', `${id}:${profileId}`, session, {mask});
}

/** Disclose one administrator mask only after the method grant, independently of page admission. */
export async function readEventAdminBaseline(id: string, profileId: string, session: SessionLike): Promise<components['schemas']['PackingAdminBaseline']> {
    return eventService.withEventReadSnapshot(id, async function readAdministrator(manager, row) {
        const event = requireEvent(row);
        if (!mayPerformEventMethod(await eventPermissions(event, session, manager), 'managePermissions')) throw new ApiProblem('FORBIDDEN');
        if (!await userService.getProfileById(profileId, manager)) throw new ApiProblem('NOT_FOUND');
        const current = await adminService.getAdminGrant('event', id, profileId, manager);
        const mask = current?.perms ?? null;
        return {mask, editToken: eventAdministratorToken(id, profileId, mask, session)};
    });
}

/** Delegate administrator semantics to the existing shared owner after reviewing its current mask. */
export async function setEventAdmin(id: string, profileId: string, mask: number | null, session: SessionLike, token?: string) {
    return withEventManagement(id, session, async function saveAdministrator(manager, event, permissions) {
        if (!mayPerformEventMethod(permissions, 'managePermissions')) throw new ApiProblem('FORBIDDEN');
        let previousMask: number | null = null;
        /** Shared profile admission precedes this callback's comparison and selected command. */
        async function reviewAdministrator(): Promise<EntityAdministratorCommand> {
            const current = await adminService.getAdminGrant('event', id, profileId, manager);
            previousMask = current?.perms ?? null;
            requireFieldComparison(token, eventAdministratorToken(id, profileId, previousMask, session), [current ? 'mask' : 'newAdmin']);
            return mask === null ? {kind: 'remove'} : {kind: current ? 'update' : 'add', mask, createdBy: session.profile?.userId};
        }
        const outcome = await applyEntityAdministrator('event', id, profileId,
            mask === null ? {kind: 'remove'} : {kind: 'add', mask, createdBy: session.profile?.userId}, manager, reviewAdministrator);
        if (outcome === 'profile-missing') throw new ApiProblem('NOT_FOUND');
        if (outcome === 'mask-required') throw new ApiProblem('VALIDATION_FAILED');
        return {changed: previousMask !== mask};
    });
}

/** Reuse native secure account-profile search; no guest credentials or raw addresses enter options. */
export async function searchEventProfiles(id: string, query: string, session: SessionLike): Promise<components['schemas']['PackingProfileOptions']> {
    await requireEventMethod(id, session, 'managePermissions');
    return (await userService.searchUsersSecure(query)).map(profile => ({profileId: profile.id, name: profile.name,
        username: profile.username, isGuest: false}));
}

/** Method-only image writers receive a reference hash without protected image bytes. */
export async function readEventHeaderBaseline(id: string, session: SessionLike): Promise<components['schemas']['PackingHeaderBaseline']> {
    const event = await requireEventMethod(id, session, 'editHeader');
    return {editToken: comparisonToken('event-settings', id, session, {header: event.headerImg ?? null})};
}

/** Shared image replacement owns validation and cleanup; the adapter owns grants/comparison under its lock. */
export async function setEventHeader(id: string, file: Express.Multer.File | undefined, session: SessionLike, token?: string) {
    /** Persist the selected reference before the shared owner retires the confirmed previous file. */
    async function persistHeader(eventId: string, path?: string | null) {
        return withEventManagement(eventId, session, async function saveHeader(manager, event, permissions) {
            if (!mayPerformEventMethod(permissions, 'editHeader')) throw new ApiProblem('FORBIDDEN');
            requireFieldComparison(token, comparisonToken('event-settings', id, session, {header: event.headerImg ?? null}), ['header']);
            await eventService.updateHeaderImage(id, path, manager);
            return {previousImage: event.headerImg, changed: Boolean(file || event.headerImg)};
        });
    }
    const receipt = await performImageSwap({id}, persistHeader, file);
    return {changed: receipt.changed};
}

/** Native Event image reads precede page admission; storage paths remain internal to the binary adapter. */
export async function readEventHeaderPath(id: string, _session: SessionLike): Promise<string> {
    const event = requireEvent(await eventService.getEventById(id));
    if (!event.headerImg) throw new ApiProblem('NOT_FOUND');
    return event.headerImg;
}

/** Archival reuses its authoritative shared operation and preserves children and financial records. */
export async function setEventArchived(id: string, archived: boolean, session: SessionLike) {
    requireSessionProfileId(session);
    // Prepare an invariant result through the existing transaction completion hook.
    function prepareArchive() { return {changed: true}; }
    try {
        if (archived) return await archiveEntity({type: 'event', id}, {}, session, undefined, {prepare: prepareArchive});
        return await restoreEntity({type: 'event', id}, {}, session, {prepare: prepareArchive});
    } catch (error) {
        throw classifyArchiveCommandError(error, archived);
    }
}

/** Permanent deletion preserves native owner admission and existing record/file operation ordering. */
export async function removeEvent(id: string, session: SessionLike) {
    const profileId = requireSessionProfileId(session);
    const event = requireEvent(await eventService.getEventById(id));
    if (event.ownerId !== profileId) throw new ApiProblem('FORBIDDEN');
    await eventService.deleteEvent(id);
    if (event.headerImg) removeImage(event.headerImg);
    return {changed: true};
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
