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

import {readEntityDefaultsBaseline, updateEntityDefaults, readEntityAdministratorBaseline, updateEntityAdministrator} from './entityAdminController';

import {eventMethodPermission, mayPerformEventMethod} from '../modules/permissionEngine';
import {validateCalendarDate} from '../modules/event/linkage';


// controllers/eventController.ts
import {hasAccountProfile} from './userController';import {Request} from "express";
import {comparisonToken, requireFieldComparison} from '../modules/api/transport';
import {searchEntityProfiles, completeDefaults, defaultPermissionValues, getEntityPropertyPresentation, readEntitySettingsAccess, entityCreationPermissionContext} from './entityAdminController';
import {archiveEntity, classifyArchiveCommandError, getArchivePresentations, getArchiveView, restoreEntity, setAutomaticArchival} from '../modules/entityArchival';
import {assertEditableEntityFields} from '../modules/permissionEngine';

import path from 'node:path';
import pdfmake, {type TCreatedPdf} from 'pdfmake';
import type {Content, Table, TableCell, TDocumentDefinitions} from 'pdfmake/interfaces';
import {PAGE_MARGINS, FONT_SIZE_BASE, FONT_SIZE_SMALL, FONT_SIZE_TITLE, FONT_SIZE_SECTION, formatDateTime, keyValueLine} from '../modules/lib/pdf';
import type {ParticipantRow} from '../../types/EventTypes';
// Business logic for the Event routes
import Joi from 'joi';
import type {EntityManager} from 'typeorm';

import {Event} from "../modules/database/entities/event/Event";
import {EventRegistration} from "../modules/database/entities/event/EventRegistration";
import {eventDietaryChoices, eventDietaryGroups} from '../../common/generated/domainChoices';
import * as invoiceService from "../modules/database/services/EventInvoiceService";
import {invoicePresentation} from '../modules/invoice/presentation';
import {isParticipantSubmissionPool} from '../modules/invoice/state';

import * as eventService from '../modules/database/services/EventService';
import * as adminService from '../modules/database/services/EntityAdminService';

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
import {
    buildDateTotals,
    projectEventParticipants,
    convertToSingleList,
    ENTITIES,
    getResource,
    getHeaderImageVersion,
    isWithinWindow,
    normalizeToArray,
    rewriteISOToZone,
    uuidKey
} from "../modules/lib/util";
import {can, evaluateSubject, isOwner, saveDefaultPermsFromBody} from '../modules/permissionEngine';
import {requireSessionProfileId} from '../modules/lib/session';
import {projectEntityCard} from '../modules/lib/util';
import type {DIETARY, EventMethod} from '../../types/EventTypes';
import type {PermBundle, PermView, SessionLike} from '../../types/PermissionTypes';
import type {components} from '../../types/api/v1';
import type {ApiResponsePreparer} from '../../types/ApiTransportTypes';
import type {EntityMutationOutcome} from '../../types/EntityPropertyTypes';
import type {EntityBase} from "../../types/UserTypes";
import {WithRequired} from "../../types/UtilTypes";

// Template constant for create errors
const CREATE_TEMPLATE = 'event/event-create';


/** Related content requires own attendance or assignment-management authority.
 * Page/method admission and each child's lifecycle grants remain separate checks. */
function mayReadEventChildren(registration: EventRegistration | null, managesAssignments: boolean): boolean {
    return Boolean(registration || managesAssignments);
}

/** Identify only authored Event property rejections from the existing validator.
 * Controller prose, submitted values and validation rules stay with their owner;
 * versioned adapters receive a finite reason for an already rejected request. */
function eventPropertyRejectionCause(error: Joi.ValidationError): string | undefined {
    // Generated structural validation precedes this shared validation boundary, but
    // calendar semantics, trim checks and string lengths still apply here.
    const detail = error.details[0];
    switch (detail?.path[0]) {
        case 'title': return 'EVENT_TITLE_INVALID';
        case 'startDate':
        case 'endDate': return 'EVENT_CALENDAR_DATE_INVALID';
        case 'maxParticipants': return 'EVENT_PARTICIPANT_LIMIT_INVALID';
        case 'description': return detail.type === 'string.max' ? 'EVENT_DESCRIPTION_TOO_LONG' : undefined;
        case 'location': return detail.type === 'string.max' ? 'EVENT_LOCATION_TOO_LONG' : undefined;
        case 'deadlineTz': return 'EVENT_TIMEZONE_INVALID';
        default: return undefined;
    }
}

/** Validate the legacy creation form and its lexical date range, then normalize
 * deadline wall time, checkbox values and empty fields for the existing persistence contract. */
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

    // Compare the validated civil-date strings before converting a separately
    // zoned deadline; the form retains its original diagnostic and submitted body.
    if (value.startDate > value.endDate) {
        throw new ValidationError(CREATE_TEMPLATE, 'Start date must be before end date', {body});
    }

    // A supplied datetime-local value uses its selected zone. Omission/empty
    // input stays absent here and becomes the existing stored null below.
    const timedDeadline = value.bindingDeadline ? rewriteISOToZone(value.bindingDeadline, value.deadlineTz || 'UTC') : undefined;

    // Only the literal form checkbox value enables a switch. Empty optional
    // scalars keep their established null representation rather than a new default.
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

// Direct and versioned creation both persist defaults after the Event commit.
async function afterCreateItems(id: string, data: any, inputFormat?: 'permissionKeys' | 'masks') {
    await saveDefaultPermsFromBody(ENTITIES.EVENT, id, data._body, {inputFormat});
}

/**
 * Adapt generated multipart values to the existing Event creation owners. Direct calls
 * creation and defaults remain separate commits; entering those owners makes a
 * later failure uncertain, never proof that an Event or uploaded image is absent.
 */
export async function createEvent(body: components['schemas']['EventCreateInput'], file: Express.Multer.File | undefined,
    session: SessionLike): Promise<components['schemas']['EventCreated']> {
    requireEventCreation(session);
    let parsed: ReturnType<typeof preprocessCreate>;
    try {
        // JSON booleans and nullable controls select the same form values.
        // The form parser remains the single owner of cross-field validation.
        const formBody = {...body, maxParticipants: body.maxParticipants ?? '',
            requireDietaryInfo: body.requireDietaryInfo ? 'on' : '', allowDietComment: body.allowDietComment ? 'on' : '',
            allowRegDateUpdatesAfterDeadline: body.allowRegDateUpdatesAfterDeadline ? 'on' : '',
            allowRegCancelationAfterDeadline: body.allowRegCancelationAfterDeadline ? 'on' : '',
            allowRegDietUpdateAfterDeadline: body.allowRegDietUpdateAfterDeadline ? 'on' : ''};
        delete (formBody as Partial<typeof formBody>).defaultPermissions;
        checkNewImage(file);
        parsed = preprocessCreate(formBody);
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
    // Reuse the already admitted request-local pool rows for submission choices;
    // their business predicate is shared with the versioned Finance projection.
    const participantPools = registration
        ? invoicePools.filter(pool => isParticipantSubmissionPool(pool, registration.id)) : [];
    const participantInvoices = registration
        ? invoicePools.flatMap((p) => (p.invoices || []).filter((inv) => inv.registrationId === registration.id))
        : [];

    // Organizers also see participants list
    const participants = await eventService.getEventParticipantRows(event.id).then(projectEventParticipants);
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

/** Validate and save current-profile attendance through the shared attendance lifecycle.
 * Stable causes let the versioned adapter localize known rejections while direct calls
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
            Joi.array().items(Joi.string().valid(...eventDietaryChoices).uppercase()),
            Joi.string().valid(...eventDietaryChoices).uppercase() // handles single value form-post
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
    await eventService.withEventTransaction(
    /** Recheck/consume an admitted bypass link and save attendance on one manager,
     * so a rejected registration cannot spend its token independently. */
    async function saveRegistration(manager) {
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

/** Compare saved dietary choices and authored notes without rewriting unchanged registration inputs. */
function isDietaryEqual(reg: EventRegistration, dietary: DIETARY[], allergyNotes: string, dietComment: string) {
    // Separate stored choices from special allergy/comment text before comparing the submitted set.
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

/** Keep the dietary combinations and note requirements under one business owner. */
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
        eventDietaryGroups.meal.some(choice => choice === d)
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
 * Direct calls retain their service-managed transaction; a versioned caller can supply its existing
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
    if (error) throw new APIError(error.message, {}, 400, {cause: eventPropertyRejectionCause(error)});
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
    /** Merge the sparse Event patch with its locked date/zone context before
     * writing; omitted deadlines stay unchanged and supplied invalid deadlines reject. */
    async function updateLocked(manager: import('typeorm').EntityManager): Promise<void> {
        // The request's earlier Event row cannot choose current omitted values
        // after another editor has committed a date or timezone change.
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
        // Persist only the already normalized sparse patch after every range
        // and deadline check has completed on this transaction's context.
        await eventService.updateEventProperties(event.id, patch, manager);
    }
    // Versioned metadata supplies its existing lock/field comparison transaction.
    // Direct callers retain the original service-managed transaction unchanged.
    if (manager) await updateLocked(manager);
    else await eventService.withEventTransaction(updateLocked);
    return 'Event updated';
}

async function updateSettings(id: string, body: any) {
    await saveDefaultPermsFromBody(ENTITIES.EVENT, id, body);
    return 'Settings saved';
}

/** One capacity policy serves direct/versioned presentation and registration admission.
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

/** Present existing registration links with the shared lifecycle status, without changing token state. */
async function listDeadlineBypassLinks(event: Event) {
    // Load only this event links, then project existing usage/revocation/expiry evidence.
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
    // Preserve the shared optional-expiry parser and fixed single-use persistence behavior.
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
    return await eventService.getEventParticipantRows(event.id).then(projectEventParticipants);
}

async function deleteRegistration(event: Event, registrationId: string) {
    return await eventService.deleteRegistration(event.id, registrationId);
}

/** Update one event-scoped registration within the Event's inclusive date window.
 * Document route middleware and the versioned method adapter independently enforce
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

/** Aggregate registered participants, dietary details and date totals for the existing export projection. */
async function getParticipantsExtended(event: Event) {
    // Read the current roster before counting choices and collecting unique authored notes.
    const participants = await eventService.getEventParticipantRows(event.id).then(projectEventParticipants);
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

/** Split semicolon-delimited authored notes into trimmed unique export entries. */
function aggregateInfos(infoSet: Set<string>, infoString: string) {
    // Ignore empty fragments while retaining each distinct note in the supplied aggregation set.
    const coms = infoString.split(';')
        .map(v => v.trim())
        .filter(Boolean);
    for (const com of coms) {
        infoSet.add(com);
    }
}

/** Increment the supplied dietary totals once per selected choice, keeping
 * combined meat/fish participation exclusive from the individual meat/fish buckets. */
function countChoices(choices: Set<DIETARY>, totals: Record<string, number>) {
    const hasMeat = choices.has('MEAT');
    const hasFish = choices.has('FISH');

    // A participant selecting both contributes to the combined category only;
    // a single selection keeps its existing individual category.
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

/** Every Event method uses the same event participant audience as permission middleware. */
async function eventPermissions(event: Event, session: SessionLike, manager?: EntityManager): Promise<PermView> {
    return evaluateSubject({kind: 'entity', entity: {
        entityType: 'event', entityId: event.id, ownerId: event.ownerId, eventId: event.id,
    }}, session, undefined, manager);
}

/** Evaluate Event administration in the caller's existing read snapshot.
 * Common route composition asks only this named policy; it never reads roster
 * data or substitutes detail-page admission for the independent admin grant. */
export async function canAccessEventAdministration(event: Event, actor: SessionLike, manager: EntityManager): Promise<boolean> {
    // Preserve the same current method policy and connection used by prior entry admission.
    return mayPerformEventMethod(await eventPermissions(event, actor, manager), 'admin');
}

/** Creation remains account-only even when an independently authorized duplicate supplied its draft. */
export function requireEventCreation(session: SessionLike): void {
    if (!session.profile) throw new ApiProblem('AUTH_REQUIRED');
    if (!hasAccountProfile(session)) throw new ApiProblem('FORBIDDEN');
}

/** Form definitions reuse the shared maintained permission/preset catalog. */
export function eventFormContext(): components['schemas']['EventCreateContext'] {
    return entityCreationPermissionContext('event');
}

/** Account-only initial forms and public duplicate forms share the same static definitions. */
export function readEventCreateContext(session: SessionLike): components['schemas']['EventCreateContext'] {
    requireEventCreation(session);
    return eventFormContext();
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
        // Select only own attendance and a cardinality; never load the full invoice/roster aggregate.
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

/** Preserve public DATA_DUPLICATE admission while copying only the Event form surface. */
export async function readEventDuplicate(id: string, session: SessionLike): Promise<components['schemas']['EventDuplicate']> {
    return eventService.withEventReadSnapshot(id,
    /** Read only the granted Event form/defaults in this snapshot, retaining its
     * empty copied deadline and excluding source attendance, files and lifecycle state. */
    async function readDuplicate(manager, row) {
        const event = requireEvent(row);
        if (!mayPerformEventMethod(await eventPermissions(event, session, manager), 'duplicate')) throw new ApiProblem('FORBIDDEN');
        // Source attendance, invoices, images and archival state never become new-event input.
        return {values: {title: event.title, description: event.description ?? '',
            startDate: event.startDate, endDate: event.endDate, location: event.location ?? '',
            // Duplication inserts the persisted timestamp directly into datetime-local;
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

/** Event property methods are publicly grantable; disclose only their permitted field baseline. */
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
    return comparisonToken('event-settings', uuidKey(event.id), session, {header: event.headerImg ?? null,
        ...(defaults ? defaultPermissionValues(defaults) : {}),
        ...(access ? {newAdmin: null} : {})});
}

/** Keep permission administration separate from ordinary metadata/settings visibility. */
export async function readEventSettings(id: string, session: SessionLike): Promise<components['schemas']['EventSettings']> {
    requireSessionProfileId(session);
    return eventService.withEventReadSnapshot(id,
    /** Compose admitted settings, protected access data and comparison tokens
     * from one snapshot, retaining export-only entry without broader editor authority. */
    async function readSettings(manager, row) {
        // Resolve current field and lifecycle capabilities before deciding which
        // settings surface this actor may open; no ACL matrix is read yet.
        const event = requireEvent(row);
        const properties = await getEntityPropertyPresentation('event', event, session, manager);
        const archive = await eventArchive(event, session, manager);
        // Export has its existing combined method grant, independent of admin
        // entry or edit rights. Admit that Actions-only dialog without disclosing
        // metadata, audience values or administrator comparison baselines.
        if (!(properties.canEditProperties || properties.canEditHeader || properties.canManagePermissions
            || properties.canDuplicate || properties.canDelete || archive.canManage || properties.exportUrl)) throw new ApiProblem('FORBIDDEN');
        // Ordinary editors never receive audience/admin values or their guessable comparison hashes.
        let access: components['schemas']['EntityAccess'] | null = null;
        if (properties.canManagePermissions) {
            access = await readEntitySettingsAccess('event', id, session, manager);
        }
        // Keep the existing projection/read order: permitted ACL rows/defaults
        // precede the settings token, while header/archive output uses this snapshot.
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

/** Registration retains its capacity/deadline/dietary checks and transactional token consumption. */
export async function saveEventRegistration(id: string, body: components['schemas']['EventRegistrationInput'], session: SessionLike) {
    requireSessionProfileId(session);
    const event = requireEvent(await eventService.getEventById(id));
    if (!mayPerformEventMethod(await eventPermissions(event, session), 'register')) throw new ApiProblem('FORBIDDEN');
    // The captured actor is passed explicitly; no mutable Express session is consulted after admission.
    await registerAttendance(event, body, {session});
    return {changed: true};
}

/** Cancellation retains profile admission, deadline policy and an absent-attendance no-op. */
export async function cancelEventRegistration(id: string, session: SessionLike) {
    requireSessionProfileId(session);
    const event = requireEvent(await eventService.getEventById(id));
    // The Event root has no parent eventId, so its participant middleware
    // adds no attendance requirement. Repeated own-profile cancellation succeeds;
    // the shared operation still rejects a closed deadline before its scoped delete.
    await cancelRegistration(event, session);
    return {changed: true};
}

/** Authorize a named Event method without disclosing its protected operation data first. */
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

/** Organizer edits retain date validation and event-scoped persistence. */
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

/** Link creation retains the account-only, single-use command without a postcommit read. */
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

/** Event cards share membership and archival decoration, without private Overview placement. */
export async function readEventThingsToDo(id: string, session: SessionLike, view: 'detail' | 'admin' = 'detail'): Promise<components['schemas']['EventThingsToDo']> {
    const event = await requireEventMethod(id, session, view === 'admin' ? 'admin' : 'items');
    const profileId = requireSessionProfileId(session);
    const registration = await eventService.getRegistrationFor(profileId, id);
    const manages = mayPerformEventMethod(await eventPermissions(event, session), 'manageAssignments');
    // The detail projection reveals children only after registration or assignment-management admission.
    if (!mayReadEventChildren(registration, manages)) return {items: []};
    const [activityPlans, packingLists, driversLists] = await Promise.all([
        eventService.getActivityPlansForEvent(id), eventService.getPackingListsForEvent(id), eventService.getDriverListsForEvent(id),
    ]);
    const related = convertToSingleList({activityPlans, packingLists, driversLists});
    const decorated = await getArchiveView({type: 'event', id}, related, session);
    return {items: decorated.relatedEntities.map(card => projectEntityCard(card, isOwner(session, card.ownerId), view === 'admin', true))};
}

/**
 * Delete an owned child selected from the admitted Event host. Discovery scopes
 * the command; the feature's existing deletion owner retains persistence/cascades.
 * This does not route permanent deletion through archival or promise a new relink lock.
 */
export async function deleteEventChild(id: string, entityType: 'activity' | 'drivers' | 'packing', entityId: string,
    session: SessionLike, view: 'detail' | 'admin' = 'detail'): Promise<components['schemas']['MutationResult']> {
    const permitted = await readEventThingsToDo(id, session, view);
    if (!permitted.items.some(card => archiveKey(card) === archiveKey({type: entityType, id: entityId}))) throw new ApiProblem('NOT_FOUND');

    // A displayed child is neither deletion authority nor an enduring parent
    // relationship. Resolve its current row and require actual profile ownership.
    const child = entityType === 'activity' ? await activityService.getActivityPlanById(entityId)
        : entityType === 'drivers' ? await driverService.getDriversListById(entityId)
            : await packingService.getPackingListById(entityId);
    if (!child?.eventId || archiveKey({type: 'event', id: child.eventId}) !== archiveKey({type: 'event', id})) throw new ApiProblem('NOT_FOUND');
    if (!isOwner(session, child.ownerId)) throw new ApiProblem('FORBIDDEN');

    try {
        // Packing already owns its versioned deletion/file completion. The other
        // existing hooks use only this admitted profile and their feature row;
        // no Express lifecycle object is read or mutated by those deletion hooks.
        if (entityType === 'packing') return await deletePackingList(entityId, session, child.eventId);
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
    if (!permitted.items.some(card => archiveKey(card) === archiveKey({type: entityType, id: entityId}))) throw new ApiProblem('NOT_FOUND');
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
    if (!outcome.root.eventId || archiveKey({type: 'event', id: outcome.root.eventId}) !== archiveKey({type: 'event', id})) throw new ApiProblem('ENTITY_CONTEXT_CHANGED');
    const event = requireEvent(await eventService.getEventById(id, manager));
    const permissions = await eventPermissions(event, session, manager);
    if (!mayPerformEventMethod(permissions, view === 'admin' ? 'admin' : 'items')) throw new ApiProblem('FORBIDDEN');
    // Child discovery requires own attendance or assignment management,
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
    if (!permitted.items.some(card => archiveKey(card) === archiveKey({type: entityType, id: entityId}))) throw new ApiProblem('NOT_FOUND');
    /** Reject a relinked child inside the existing lifecycle transaction. */
    async function prepareAutomatic(manager: EntityManager, outcome: EntityMutationOutcome) {
        await requireEventChildScope(id, outcome, session, manager, view);
        return {changed: true};
    }
    return setAutomaticArchival({type: entityType, id: entityId}, body, session, {prepare: prepareAutomatic});
}

/** Publicly granted access management receives only its own current audience baselines. */
export async function readEventDefaultsBaseline(id: string, session: SessionLike): Promise<components['schemas']['EntityPermissionDefaultsBaseline']> {
    return eventService.withEventReadSnapshot(id, /** Read an admitted Event audience baseline with its original full settings comparison scope. */
async function readDefaults(manager, row) {
        // Check current method authority on this snapshot before reading masks or constructing comparison evidence.
        const event = requireEvent(row);
        if (!mayPerformEventMethod(await eventPermissions(event, session, manager), 'managePermissions')) throw new ApiProblem('FORBIDDEN');
        return readEntityDefaultsBaseline('event', id, session, manager, {prepareToken: () => eventSettingsToken(event, session, manager, true)});
    });
}

/** Shared permission persistence keeps sparse audience updates and current locked authorization. */
export async function updateEventDefaults(id: string, body: components['schemas']['PermissionDefaultsPatch'], session: SessionLike, token?: string) {
    return withEventManagement(id, session, /** Apply admitted sparse Event audience changes on the existing management transaction. */
async function saveDefaults(manager, event, permissions) {
        // Recheck the Event method grant before the shared reviewed-default operation reads or writes masks.
        if (!mayPerformEventMethod(permissions, 'managePermissions')) throw new ApiProblem('FORBIDDEN');
        return updateEntityDefaults('event', id, body, session, token, manager, {prepareToken: () => eventSettingsToken(event, session, manager, true)});
    });
}

/** Disclose one administrator mask only after the method grant, independently of page admission. */
export async function readEventAdminBaseline(id: string, profileId: string, session: SessionLike): Promise<components['schemas']['EntityAdministratorBaseline']> {
    return eventService.withEventReadSnapshot(id, async function readAdministrator(manager, row) {
        const event = requireEvent(row);
        if (!mayPerformEventMethod(await eventPermissions(event, session, manager), 'managePermissions')) throw new ApiProblem('FORBIDDEN');
        return readEntityAdministratorBaseline('event', id, profileId, session, manager);
    });
}

/** Delegate administrator semantics to the existing shared owner after reviewing its current mask. */
export async function setEventAdmin(id: string, profileId: string, mask: number | null, session: SessionLike, token?: string) {
    return withEventManagement(id, session, async function saveAdministrator(manager, event, permissions) {
        if (!mayPerformEventMethod(permissions, 'managePermissions')) throw new ApiProblem('FORBIDDEN');
        return updateEntityAdministrator('event', id, profileId, mask, session, token, manager);
    });
}

/** Reuse secure account-profile search; no guest credentials or raw addresses enter options. */
export async function searchEventProfiles(id: string, query: string, session: SessionLike): Promise<components['schemas']['EntityAdministratorProfileOptions']> {
    await requireEventMethod(id, session, 'managePermissions');
    return searchEntityProfiles(query);
}

/** Method-only image writers receive a reference hash without protected image bytes. */
export async function readEventHeaderBaseline(id: string, session: SessionLike): Promise<components['schemas']['EntityHeaderBaseline']> {
    const event = await requireEventMethod(id, session, 'editHeader');
    return {editToken: comparisonToken('event-settings', uuidKey(event.id), session, {header: event.headerImg ?? null})};
}

/** Shared image replacement owns validation and cleanup; the adapter owns grants/comparison under its lock. */
export async function setEventHeader(id: string, file: Express.Multer.File | undefined, session: SessionLike, token?: string) {
    /** Persist the selected reference before the shared owner retires the confirmed previous file. */
    async function persistHeader(eventId: string, path?: string | null) {
        return withEventManagement(eventId, session, async function saveHeader(manager, event, permissions) {
            if (!mayPerformEventMethod(permissions, 'editHeader')) throw new ApiProblem('FORBIDDEN');
            requireFieldComparison(token, comparisonToken('event-settings', uuidKey(event.id), session, {header: event.headerImg ?? null}), ['header']);
            await eventService.updateHeaderImage(id, path, manager);
            return {previousImage: event.headerImg, changed: Boolean(file || event.headerImg)};
        });
    }
    const receipt = await performImageSwap({id}, persistHeader, file);
    return {changed: receipt.changed};
}

/** Event image reads precede page admission; storage paths remain internal to the binary adapter. */
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

/** Permanent deletion preserves shared owner admission and existing record/file operation ordering. */
export async function removeEvent(id: string, session: SessionLike) {
    const profileId = requireSessionProfileId(session);
    const event = requireEvent(await eventService.getEventById(id));
    if (event.ownerId !== profileId) throw new ApiProblem('FORBIDDEN');
    // Reuse the original deletion operation after this adapter's owner check;
    // header cleanup retains its established position after record deletion.
    await deleteEntity(event, session as Request['session']);
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

const FONT_SIZE_SUBSECTION = 9;

const CHIP_MAX_PER_ROW = 7;

function asText(value: string | number | null | undefined): string {
    if (value === null || value === undefined) return '—';
    const text = String(value).trim();
    return text.length ? text : '—';
}

/** Divide admitted chip values into ordered rows without changing the source. */
function chunk<T>(values: T[], size: number): T[][] {
    // Each slice owns only this display row; caller order remains unchanged.
    const chunks: T[][] = [];
    for (let i = 0; i < values.length; i += size) chunks.push(values.slice(i, i + size));
    return chunks;
}

/** Describe one text-only badge with the export's shared typography and padding. */
function chip(text: string): Content {
    // A borderless one-cell table keeps the badge together across PDF layout.
    return {
        table: {
            widths: ['auto'],
            body: [[{
                text,
                bold: true,
                fontSize: FONT_SIZE_SMALL,
                color: '#111827',
                fillColor: '#e5e7eb',
                margin: [0, 0, 0, 0]
            }]],
        },
        layout: {
            hLineWidth: () => 0,
            vLineWidth: () => 0,
            hLineColor: () => '#e5e7eb',
            vLineColor: () => '#e5e7eb',
            paddingLeft: () => 6,
            paddingRight: () => 6,
            paddingTop: () => 2,
            paddingBottom: () => 2,
        },
        margin: [0, 0, 4, 4],
    } as Content;
}

/** Render nonempty values as bounded badge rows, retaining the empty marker. */
function chipGrid(values: Array<string | number | null | undefined>, maxPerRow = CHIP_MAX_PER_ROW): Content {
    // Normalize before grouping so absent values consume no visual column.
    const items = values.map(asText).filter((value) => value !== '—');
    if (!items.length) return {text: '—', color: '#6b7280'};

    return {
        stack: chunk(items, maxPerRow).map((row) => ({
            columns: row.map((value) => ({width: 'auto', ...(chip(String(value)) as object)})),
            columnGap: 4,
            margin: [0, 0, 0, 4],
        })),
    } as Content;
}

function participantDates(participant: ParticipantRow): string {
    return `${participant.arrivalDate} -> ${participant.departureDate}`;
}

/** Select only supported saved dietary choices for this participant's export. */
function participantDietaryChoices(participant: ParticipantRow): Array<string> {
    // Unknown persisted labels never become a new dietary badge.
    return (participant.dietaryChoices || [])
        .map((choice) => choice.choice)
        .filter((choice): choice is (typeof eventDietaryChoices)[number] => eventDietaryChoices.includes(choice as (typeof eventDietaryChoices)[number]));
}

/** Return the first saved allergy note or the shared absent-value marker. */
function participantAllergyText(participant: ParticipantRow): string {
    // Keep the note paired with its dietary choice rather than another free text.
    const allergyChoice = participant.dietaryChoices?.find((choice) => choice.choice === 'ALLERGIES');
    return asText(allergyChoice?.additionalInfo);
}

/** Return the first saved participant comment or the shared absence marker. */
function participantCommentText(participant: ParticipantRow): string {
    // Comments remain separate from medical/dietary notes in the export.
    const commentChoice = participant.dietaryChoices?.find((choice) => choice.choice === 'COMMENT');
    return asText(commentChoice?.additionalInfo);
}

/** Compose this participant's accepted dietary badges in their saved order. */
function participantDietaryContent(participant: ParticipantRow): Content {
    // Empty dietary evidence uses one marker rather than an empty nested stack.
    const choices = participantDietaryChoices(participant);
    if (!choices.length) return {text: '—', color: '#6b7280'};

    return {
        stack: choices.map((choice) => chip(choice)),
        margin: [0, 0, 0, 0],
    };
}

/** Project one already-authorized participant into the five export columns. */
function buildParticipantRow(participant: ParticipantRow): TableCell[] {
    // Normalize contact/notes independently; neither note substitutes for the other.
    const email = participant.email ?? '—';
    const allergy = participantAllergyText(participant);
    const comment = participantCommentText(participant);
    const infoStack: Content[] = [];
    if (allergy !== '—') {
        infoStack.push({text: 'Allergies:', color: '#aa0000', fontSize: FONT_SIZE_SUBSECTION},
            {text: allergy, fontSize: FONT_SIZE_BASE, marginBottom: 4});
    }
    if (comment !== '—') {
        infoStack.push({text: 'Comment:', color: '#cc9911', fontSize: FONT_SIZE_SUBSECTION},
            {text: comment, fontSize: FONT_SIZE_BASE});
    }
    if (infoStack.length === 0) {
        infoStack.push({text: '—', fontSize: FONT_SIZE_BASE});
    }

    // Preserve column order and mail-link behavior after the optional note stack.
    return [
        {text: participant.name, fontSize: FONT_SIZE_BASE},
        email === '—'
            ? {text: '—', color: '#6b7280', fontSize: FONT_SIZE_BASE}
            : {text: email, link: `mailto:${email}`, fontSize: FONT_SIZE_BASE},
        {text: participantDates(participant), fontSize: FONT_SIZE_SMALL},
        participantDietaryContent(participant),
        {stack: infoStack}
    ];
}

/** Build a repeatable-header participant table, including its five-column empty row. */
export function buildParticipantsTable(participants: ParticipantRow[]): Table {
    // Header and data share the same fixed column order and export widths.
    const body: TableCell[][] = [
        [
            {text: 'Name', bold: true, fillColor: '#e5e7eb'},
            {text: 'Email', bold: true, fillColor: '#e5e7eb'},
            {text: 'Dates', bold: true, fillColor: '#e5e7eb'},
            {text: 'Dietary', bold: true, fillColor: '#e5e7eb'},
            {text: 'Information', bold: true, fillColor: '#e5e7eb'},
        ],
    ];

    if (!participants.length) {
        body.push([
            {text: 'No registrations yet.', colSpan: 5, italics: true, color: '#6b7280', margin: [0, 6, 0, 6]},
            {},
            {},
            {},
            {},
        ]);
    } else {
        for (const participant of participants) body.push(buildParticipantRow(participant));
    }

    return {
        headerRows: 1,
        widths: [70, 115, 45, 55, 200],
        body,
        dontBreakRows: true,
    };
}

/** Compose available event metadata with separators only between real values. */
function buildEventInfoInline(event: Event): Content {
    // The local accumulator omits absent fields without leaving stray bullets.
    const fragments: Content[] = [];
    const push = (label: string, value?: string | null) => {
        if (!value) return;
        if (fragments.length) fragments.push({text: ' • ', color: '#9ca3af'});
        fragments.push({text: [{text: `${label}: `, bold: true}, {text: value}]});
    };

    if (event.location) push('Location', asText(event.location) === '—' ? null : asText(event.location));
    push('Dates', `${asText(event.startDate)} -> ${asText(event.endDate)}`);
    if (event.bindingDeadline) {
        push('Binding deadline', formatDateTime(event.bindingDeadline, event.timezone));
        push('Timezone', asText(event.timezone));
    }

    return {
        text: fragments,
        fontSize: FONT_SIZE_BASE,
        lineHeight: 1.12,
        margin: [0, 0, 0, 4],
    };
}

/** Display only positive totals through the existing common badge layout. */
function buildTotalsStack(values: Record<string, number>): Content {
    // Zero categories remain omitted; grouping never changes the supplied totals.
    const items = Object.entries(values)
        .filter(([, count]) => count > 0)
        .map(([key, count]) => `${key}: ${count}`);

    return chipGrid(items, 8);
}

/** Assemble the authorized participant document with existing sections, table
 * and pagination. The caller-owned date totals receive the established Total row. */
export function buildParticipantsPdfDefinition(
    data: {
        event: Event;
        participants: ParticipantRow[];
        totals: Record<string, number>;
        dateTotals: Record<string, number>;
        allergies: string[];
        comments: string[];
        generatedAt: string;
    },
): TDocumentDefinitions {
    // Retain the existing input update before composing the summary and table.
    data.dateTotals['Total'] = data.participants.length;
    const content: Content[] = [
        {text: data.event.title, style: 'title', margin: [0, 0, 0, 8]},
        {text: 'Event info', style: 'sectionTitle', margin: [0, 0, 0, 4]},
        buildEventInfoInline(data.event),
        data.event.description ? keyValueLine('Description', data.event.description) : '',
        {text: 'Participants', style: 'sectionTitle', margin: [0, 8, 0, 4]},
        buildTotalsStack(data.dateTotals),
        {text: 'Dietary totals', style: 'subsectionTitle', margin: [0, 4, 0, 4]},
        buildTotalsStack(data.totals),
        {
            table: buildParticipantsTable(data.participants),
            layout: {
                hLineWidth: (i: number, node: {
                    table?: { body?: unknown[] }
                }) => (i === 0 || i === 1 || i === (node.table?.body?.length || 0) ? 1 : 0.5),
                vLineWidth: () => 0.5,
                hLineColor: () => '#d1d5db',
                vLineColor: () => '#d1d5db',
                paddingLeft: () => 6,
                paddingRight: () => 6,
                paddingTop: () => 4,
                paddingBottom: () => 4,
            },
            margin: [0, 0, 0, 8],
        },
    ];

    // Document-wide styles and footer apply after feature content is prepared.
    return {
        pageSize: 'A4',
        pageOrientation: 'portrait',
        pageMargins: PAGE_MARGINS,
        content,
        defaultStyle: {fontSize: FONT_SIZE_BASE},
        styles: {
            title: {fontSize: FONT_SIZE_TITLE, bold: true},
            sectionTitle: {fontSize: FONT_SIZE_SECTION, bold: true},
            subsectionTitle: {fontSize: FONT_SIZE_SUBSECTION, bold: true},
        },
        footer: (currentPage, pageCount) => ({
            columns: [
                {
                    text: `Generated: ${formatDateTime(data.generatedAt)} UTC`,
                    fontSize: FONT_SIZE_SMALL,
                    color: '#6b7280'
                },
                {
                    text: `Page ${currentPage} / ${pageCount}`,
                    alignment: 'right',
                    fontSize: FONT_SIZE_SMALL,
                    color: '#6b7280'
                },
            ],
            margin: [28, 0, 28, 16],
        }),
    };
}

export function createParticipantsPdf(
    data: {
        event: Event;
        participants: ParticipantRow[];
        totals: Record<string, number>;
        dateTotals: Record<string, number>;
        allergies: string[];
        comments: string[];
        generatedAt: string;
    },
): TCreatedPdf {
    return pdfmake.createPdf(buildParticipantsPdfDefinition(data));
}
