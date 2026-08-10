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
// Business logic for the Event routes
import Joi from 'joi';

import {Event} from "../modules/database/entities/event/Event";
import {EventRegistration} from "../modules/database/entities/event/EventRegistration";
import {ALLOWED_DIETARY} from "../modules/database/entities/event/EventRegistrationDietary";
import * as invoiceService from "../modules/database/services/EventInvoiceService";

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
import {can, saveDefaultPermsFromBody} from "../modules/permissionEngine";
import type {DIETARY} from "../types/EventTypes";
import type {PermBundle} from "../types/PermissionTypes";
import type {EntityBase} from "../types/UserTypes";
import {WithRequired} from "../types/UtilTypes";
import {purgeExpiredProofs} from "./eventPoolController";

// Template constant for create errors
const CREATE_TEMPLATE = 'event/event-create';

function preprocessCreate(body: any): Partial<Event> {
    // Basic date validation as strings (YYYY-MM-DD) to match existing patterns
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;

    const schema = Joi.object({
        title: Joi.string().required(),
        description: Joi.string().max(2000).allow(''),
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
    await Promise.all(invoicePools.map(purgeExpiredProofs));
    const participantPools = registration ? await invoiceService.getParticipantPools(event.id, registration.id) : [];
    const participantInvoices = registration
        ? invoicePools.flatMap((p) => (p.invoices || []).filter((inv) => inv.registrationId === registration.id))
        : [];

    // Organizers also see participants list
    const participants = await eventService.getEventParticipants(event.id);
    const isFull = (event.maxParticipants ?? Number.MAX_SAFE_INTEGER) <= participants.length;

    const relatedEntities = convertToSingleList({activityPlans, packingLists, driversLists: driverLists});

    return {
        event,
        registration,
        participants,
        activityPlans,
        packingLists,
        driverLists,
        invoicePools,
        participantPools,
        participantInvoices,
        isFull,
        relatedEntities,
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
    if (!registration && await eventService.isEventFull(event.id)) {
        throw new APIError('Event is full', body, 403);
    }

    const schema = Joi.object({
        arrivalDate: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
        departureDate: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
        dietary: Joi.alternatives().try(
            Joi.array().items(Joi.string().valid(...ALLOWED_DIETARY).uppercase()),
            Joi.string().valid(...ALLOWED_DIETARY).uppercase() // handles single value form-post
        ).optional(),
        allergyNotes: Joi.string().max(255).allow(''),
        dietComment: Joi.string().max(255).allow(''),
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
            bypass = await eventService.canBypassDeadlineWithToken(event.id, body.regToken ?? getResource(req, 'regToken') ?? null);
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


    await eventService.register(event.id, value.arrivalDate, value.departureDate, session.profile.id, dietary, allergyNotes?.trim() || null, dietComment?.trim() || null, bypass);
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
    const normalizedBody = {...body};
    if (normalizedBody.startDate === undefined) {
        normalizedBody.startDate = normalizedBody.start;
    }
    if (normalizedBody.endDate === undefined) {
        normalizedBody.endDate = normalizedBody.end;
    }

    if (!event) throw new APIError('Event not found', normalizedBody, 404);
    checkUpdateSettingsPerms(normalizedBody, permData);

    const schema = Joi.object({
        title: Joi.string().max(255).allow(''),
        description: Joi.string().max(2000).allow(''),
        startDate: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).allow(''),
        endDate: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).allow(''),
        location: Joi.string().max(255).allow(''),
        bindingDeadline: Joi.string().allow(''),
        allowRegDateUpdatesAfterDeadline: Joi.string().allow('').allow('on'),
        allowRegCancelationAfterDeadline: Joi.string().allow('').allow('on'),
        requireDietaryInfo: Joi.allow('').allow('on'),
        allowDietComment: Joi.allow('').allow('on'),
        allowRegDietUpdateAfterDeadline: Joi.allow('').allow('on'),
        maxParticipants: Joi.number().positive().allow('').optional(),
        deadlineTz: Joi.string().allow(''),
    });

    const {error, value} = schema.validate(normalizedBody, {abortEarly: false, allowUnknown: true});
    if (error) {
        const msg = error.details.map(d => d.message).join(', ');
        throw new APIError(msg, normalizedBody, 400);
    }

    const start = value.startDate || event.startDate;
    const end = value.endDate || event.endDate;
    if (start && end && start > end) {
        throw new APIError('Start date must be before end date', {start, end}, 400);
    }

    const timedDeadline = value.bindingDeadline ? rewriteISOToZone(value.bindingDeadline, value.deadlineTz || 'UTC') : undefined;

    const update: {
        location?: string | null;
        bindingDeadline?: string | null;
        allowRegDateUpdateAfterDeadline?: boolean;
        allowRegCancelAfterDeadline?: boolean;
        requireDietaryInfo?: boolean;
        allowDietComment?: boolean;
        allowDietUpdateAfterDeadline?: boolean;
        maxParticipants?: number;
        timezone?: string | null;
    } = {};
    if (value.location !== undefined) update.location = value.location || null;
    // Keep existing deadline unless the field was explicitly submitted.
    if (value.bindingDeadline !== undefined) update.bindingDeadline = timedDeadline || null;
    if (value.allowRegDateUpdatesAfterDeadline !== undefined) update.allowRegDateUpdateAfterDeadline = value.allowRegDateUpdatesAfterDeadline === 'on';
    if (value.allowRegCancelationAfterDeadline !== undefined) update.allowRegCancelAfterDeadline = value.allowRegCancelationAfterDeadline === 'on';
    if (value.requireDietaryInfo !== undefined) update.requireDietaryInfo = value.requireDietaryInfo === 'on';
    if (value.allowDietComment !== undefined) update.allowDietComment = value.allowDietComment === 'on';
    if (value.allowRegDietUpdateAfterDeadline !== undefined) update.allowDietUpdateAfterDeadline = value.allowRegDietUpdateAfterDeadline === 'on';
    if (value.maxParticipants !== undefined) update.maxParticipants = value.maxParticipants || null;
    if (value.deadlineTz !== undefined) update.timezone = value.deadlineTz || null;

    await eventService.updateEventMeta(event.id, update);
    if (value.title !== undefined) await eventService.updateEventTitle(event.id, value.title || event.title);
    if (value.description !== undefined) await eventService.updateEventDescription(event.id, value.description || null);
    // Optionally persist start/end if changed (add a meta helper if you prefer keeping them together):
    await eventService.updateEventDates(event.id, start, end);

    return 'Event updated';
}

function checkUpdateSettingsPerms(normalizedBody: any, permData?: PermBundle) {
    // Permission check
    if (!permData ||
        ((normalizedBody.location !== undefined
            || normalizedBody.startDate !== undefined
            || normalizedBody.endDate !== undefined
            || normalizedBody.bindingDeadline !== undefined
            || normalizedBody.deadlineTz !== undefined
            || normalizedBody.allowRegDateUpdateAfterDeadline !== undefined
            || normalizedBody.allowRegCancelAfterDeadline !== undefined) && !permData.entity.has("EDIT_META"))
        || (normalizedBody.title !== undefined && !permData.entity.has("EDIT_TITLE"))
        || (normalizedBody.description !== undefined && !permData.entity.has("EDIT_DESC"))
        || ((normalizedBody.requireDietaryInfo !== undefined
            || normalizedBody.allowDietComment !== undefined
            || normalizedBody.allowDietUpdateAfterDeadline !== undefined) && !permData.entity.has("MANAGE_REQUIREMENTS"))
        || (normalizedBody.maxParticipants !== undefined && !permData.entity.has("EDIT_CAPACITY"))
    ) {
        throw new APIError("Not allowed", normalizedBody, 403);
    }
}

async function updateSettings(id: string, body: any) {
    await saveDefaultPermsFromBody(ENTITIES.EVENT, id, body);
    return 'Settings saved';
}

async function listDeadlineBypassLinks(event: Event) {
    return await eventService.listDeadlineBypassLinks(event.id);
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

    await eventService.updateRegistrationDates(event.id, Number(registrationId), value.arrivalDate, value.departureDate);
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
