// controllers/eventController.ts
// Business logic for the Event routes
import Joi from 'joi';

import * as eventService from '../modules/database/services/EventService';
import * as invoiceService from "../modules/database/services/EventInvoiceService";
import {APIError, ValidationError} from '../modules/lib/errors';
import {buildDateTotals, ENTITIES, getResource, isWithinWindow, rewriteISOToZone} from "../modules/lib/util";
import {purgeExpiredProofs} from "./eventPoolController";

import {Event} from "../modules/database/entities/event/Event";
import type {DIETARY} from "../types/EventTypes";
import {Request} from "express";
import {ALLOWED_DIETARY} from "../modules/database/entities/event/EventRegistrationDietary";
import {saveDefaultPermsFromBody} from "../modules/permissionEngine";
import type {PermBundle} from "../types/PermissionTypes";

// Template constant for create errors
const CREATE_TEMPLATE = 'event/event-create';

function preprocessCreate(body: any): Partial<Event> {
    // Basic date validation as strings (YYYY-MM-DD) to match existing patterns
    const datePattern = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

    const schema = Joi.object({
        title: Joi.string().required(),
        description: Joi.string().max(2000).allow(''),
        startDate: Joi.string().pattern(datePattern).required(),
        endDate: Joi.string().pattern(datePattern).required(),
        location: Joi.string().max(255).allow(''),
        // HTML datetime-local comes as 'YYYY-MM-DDTHH:mm' (no seconds or TZ) — let backend parse/normalize
        bindingDeadline: Joi.string().allow(''),
        requireDietaryInfo: Joi.allow('').allow('on'),
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
        requireDietaryInfo: value.requireDietaryInfo === 'on',
        maxParticipants: value.maxParticipants || null,
        timezone: value.deadlineTz || null,
    };
}

/*  ---- Transaction handled in service ---- */
async function createEntity(ownerId: number, eventData: Partial<Event>) {
    return await eventService.createEventTx(ownerId,
        eventData.title!,
        eventData.description!,
        eventData.startDate!,
        eventData.endDate!,
        eventData.location!,
        eventData.bindingDeadline!,
        eventData.requireDietaryInfo!,
        eventData.maxParticipants!,
        eventData.timezone!,
    );
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
    const registration = session.user
        ? await eventService.getRegistrationFor({userId: session.user.id}, event.id)
        : session.guest
            ? await eventService.getRegistrationFor({guestId: session.guest.id}, event.id)
            : null;

    // Associated plans/lists (will be empty until event_id exists in schema)
    // Only show lists/plans once the actor is registered (or is owner)
    const isOwner = session.user ? session.user.id == event.ownerId : false;
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

    // Deny registration if not already registered (allow updates to registration)
    if (await eventService.isEventFull(event.id) && !(await eventService.isRegisteredForEvent({
        guestId: session.guest?.id,
        userId: session.user?.id,
    }, event.id))) throw new APIError('Event is full', body, 403);

    // Deny registration if past binding deadline
    let bypass: { ok: boolean; linkId?: string } = {ok: false};
    if (event.bindingDeadline && new Date(Date.parse(event.bindingDeadline)) < new Date()) {
        bypass = await eventService.canBypassDeadlineWithToken(event.id, body.regToken ?? getResource(req, 'regToken') ?? null);
        if (!bypass.ok) {
            // owners/co-organizers may bypass via permission in your middleware;
            // if you still reach here, reject:
            throw new APIError('Registration deadline has passed', {}, 403);
        }
    }

    const schema = Joi.object({
        arrivalDate: Joi.string().pattern(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/).required(),
        departureDate: Joi.string().pattern(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/).required(),
        dietary: Joi.alternatives().try(
            Joi.array().items(Joi.string().valid(...ALLOWED_DIETARY).uppercase()),
            Joi.string().valid(...ALLOWED_DIETARY).uppercase() // handles single value form-post
        ).optional(),
        allergyNotes: Joi.string().max(255).allow(''),
    });
    const {error, value} = schema.validate(body, {abortEarly: false, allowUnknown: true});
    if (error) {
        const msg = error.details.map(d => d.message).join(', ');
        throw new APIError(msg, body, 400);
    }

    if (!isWithinWindow(event.startDate, event.endDate, value.arrivalDate, value.departureDate)) {
        throw new APIError('Arrival/Departure must be within event dates', body, 400);
    }

    const dietary: DIETARY[] = Array.isArray(value.dietary) ? value.dietary : (value.dietary ? [value.dietary] : []);
    const allergyNotes: string = value.allergyNotes || '';

    if (session.user?.id) {
        await eventService.registerUser(event.id, session.user.id, value.arrivalDate, value.departureDate, dietary, allergyNotes.trim() || null, bypass);
    } else if (session.guest?.id) {
        await eventService.registerGuest(event.id, session.guest.id, value.arrivalDate, value.departureDate, dietary, allergyNotes.trim() || null, bypass);
    } else {
        throw new APIError('Authentication required', body, 401);
    }

    return 'Registration saved';
}

async function cancelRegistration(event: Event, session: Request['session']) {
    if (session.user?.id) {
        await eventService.deleteRegistrationFor(event.id, {userId: session.user.id});
    } else if (session.guest?.id) {
        await eventService.deleteRegistrationFor(event.id, {guestId: session.guest.id});
    } else {
        throw new APIError('Authentication required', {}, 401);
    }
    return 'Registration cancelled';
}

/* ----------------------- API: Organizer edit ----------------------- */

async function updateEventSettings(event: Event, body: any, permData?: PermBundle) {
    const normalizedBody = {...body};
    if (normalizedBody.startDate === undefined && normalizedBody.start !== undefined) {
        normalizedBody.startDate = normalizedBody.start;
    }
    if (normalizedBody.endDate === undefined && normalizedBody.end !== undefined) {
        normalizedBody.endDate = normalizedBody.end;
    }

    // Permission check
    if (!permData ||
        ((normalizedBody.location !== undefined
                || normalizedBody.startDate !== undefined
                || normalizedBody.endDate !== undefined
                || normalizedBody.bindingDeadline !== undefined
                || normalizedBody.deadlineTz !== undefined) && !permData.entity.has("EDIT_META"))
        || (normalizedBody.title !== undefined && !permData.entity.has("EDIT_TITLE"))
        || (normalizedBody.description !== undefined && !permData.entity.has("EDIT_DESC"))
        || (normalizedBody.requireDietaryInfo !== undefined && !permData.entity.has("MANAGE_REQUIREMENTS"))
        || (normalizedBody.maxParticipants !== undefined && !permData.entity.has("EDIT_CAPACITY"))
    ) {
        throw new APIError("Not allowed", normalizedBody, 403);
    }

    const schema = Joi.object({
        title: Joi.string().max(255).allow(''),
        description: Joi.string().max(2000).allow(''),
        startDate: Joi.string().pattern(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/).allow(''),
        endDate: Joi.string().pattern(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/).allow(''),
        location: Joi.string().max(255).allow(''),
        bindingDeadline: Joi.string().allow(''),
        requireDietaryInfo: Joi.allow('').allow('on'),
        maxParticipants: Joi.number().positive().allow('').optional(),
        deadlineTz: Joi.string().allow(''),
    });

    const {error, value} = schema.validate(normalizedBody, {abortEarly: false, allowUnknown: true});
    if (error) {
        const msg = error.details.map(d => d.message).join(', ');
        throw new APIError(msg, normalizedBody, 400);
    }

    // Load current for cross-field checks
    if (!event) throw new APIError('Event not found', normalizedBody, 404);

    const start = value.startDate || event.startDate;
    const end = value.endDate || event.endDate;
    if (start && end && start > end) {
        throw new APIError('Start date must be before end date', {start, end}, 400);
    }

    const timedDeadline = value.bindingDeadline ? rewriteISOToZone(value.bindingDeadline, value.deadlineTz || 'UTC') : undefined;

    const update: {
        location?: string | null;
        bindingDeadline?: string | null;
        requireDietaryInfo?: boolean;
        maxParticipants?: number;
        timezone?: string | null;
    } = {};
    if (value.location !== undefined) update.location = value.location || null;
    // Keep existing deadline unless the field was explicitly submitted.
    if (value.bindingDeadline !== undefined) update.bindingDeadline = timedDeadline || null;
    if (value.requireDietaryInfo !== undefined) update.requireDietaryInfo = value.requireDietaryInfo === 'on';
    if (value.maxParticipants !== undefined) update.maxParticipants = value.maxParticipants || null;
    if (value.deadlineTz !== undefined) update.timezone = value.deadlineTz || null;

    await eventService.updateEventMeta(event.id, update);
    if (value.title !== undefined) await eventService.updateEventTitle(event.id, value.title || event.title);
    if (value.description !== undefined) await eventService.updateEventDescription(event.id, value.description || null);
    // Optionally persist start/end if changed (add a meta helper if you prefer keeping them together):
    await eventService.updateEventDates(event.id, start, end);

    return 'Event updated';
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
    if (!session.user) throw new APIError('Must be logged in', body, 401);

    const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
    return await eventService.createDeadlineBypassLink(
        event.id,
        session.user.id,
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
        arrivalDate: Joi.string().pattern(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/).required(),
        departureDate: Joi.string().pattern(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/).required(),
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
    for (const p of participants) {
        for (const k of p.dietaryChoices) totals[k.choice] = (totals[k.choice] || 0) + 1;
    }
    const dateTotals: Record<string, number> = buildDateTotals(event.startDate, event.endDate, participants);
    return {
        event: event,
        participants: participants,
        totals: totals,
        dateTotals: dateTotals,
        generatedAt: new Date().toISOString(),
    }
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
};
