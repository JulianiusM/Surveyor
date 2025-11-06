// controllers/eventController.ts
// Business logic for the Event routes
import Joi from 'joi';

import * as eventService from '../modules/database/services/EventService';
import {APIError, ValidationError} from '../modules/lib/errors';
import {isWithinWindow, rewriteISOToZone} from "../modules/lib/util";

import {Event} from "../modules/database/entities/event/Event";
import type {DIETARY} from "../types/EventTypes";
import {Request} from "express";

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
async function afterCreateItems() {
}

/**
 * Data for the view page.
 * Returns the event plus the current actor’s registration (if any).
 */
async function fetchForView(event: Event, session: Request['session']) {
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

    // Organizers also see participants list
    const participants = await eventService.getRegistrationsForEvent(event.id);
    const isFull = (event.maxParticipants ?? Number.MAX_SAFE_INTEGER) <= participants.length;

    return {
        event,
        registration,
        participants,
        activityPlans,
        packingLists,
        driverLists,
        isFull,
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

async function registerAttendance(event: Event, body: any, session: Request['session']) {
    if (!event) throw new APIError('Event not found', body, 404);

    // Deny registration if not already registered (allow updates to registration)
    if (await eventService.isEventFull(event.id) && !(await eventService.isRegisteredForEvent({
        guestId: session.guest?.id,
        userId: session.user?.id,
    }, event.id))) throw new APIError('Event is full', body, 403);

    const schema = Joi.object({
        arrivalDate: Joi.string().pattern(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/).required(),
        departureDate: Joi.string().pattern(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/).required(),
        dietary: Joi.alternatives().try(
            Joi.array().items(Joi.string().valid('MEAT', 'FISH', 'VEGETARIAN', 'VEGAN', 'HALAL', 'KOSHER', 'ALLERGIES').uppercase()),
            Joi.string().valid('MEAT', 'FISH', 'VEGETARIAN', 'VEGAN', 'HALAL', 'KOSHER', 'ALLERGIES').uppercase() // handles single value form-post
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
        await eventService.registerUser(event.id, session.user.id, value.arrivalDate, value.departureDate, dietary, allergyNotes.trim() || null);
    } else if (session.guest?.id) {
        await eventService.registerGuest(event.id, session.guest.id, value.arrivalDate, value.departureDate, dietary, allergyNotes.trim() || null);
    } else {
        throw new APIError('Authentication required', body, 401);
    }

    return 'Registration saved';
}

async function cancelRegistration(eventId: string, session: Request['session']) {
    if (session.user?.id) {
        await eventService.deleteRegistrationFor(eventId, {userId: session.user.id});
    } else if (session.guest?.id) {
        await eventService.deleteRegistrationFor(eventId, {guestId: session.guest.id});
    } else {
        throw new APIError('Authentication required', {}, 401);
    }
    return 'Registration cancelled';
}

/* ----------------------- API: Organizer edit ----------------------- */

async function updateEventSettings(event: Event, body: any) {
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

    const {error, value} = schema.validate(body, {abortEarly: false, allowUnknown: true});
    if (error) {
        const msg = error.details.map(d => d.message).join(', ');
        throw new APIError(msg, body, 400);
    }

    // Load current for cross-field checks
    if (!event) throw new APIError('Event not found', body, 404);

    const start = value.startDate || event.startDate;
    const end = value.endDate || event.endDate;
    if (start && end && start > end) {
        throw new APIError('Start date must be before end date', {start, end}, 400);
    }

    const timedDeadline = value.bindingDeadline ? rewriteISOToZone(value.bindingDeadline, value.deadlineTz || 'UTC') : undefined;

    await eventService.updateEventMeta(event.id, {
        location: value.location || null,
        bindingDeadline: timedDeadline || null,
        requireDietaryInfo: value.requireDietaryInfo === 'on',
        maxParticipants: value.maxParticipants || null,
        timezone: value.deadlineTz || null,
    });
    if (value.title !== undefined) await eventService.updateEventTitle(event.id, value.title || event.title);
    if (value.description !== undefined) await eventService.updateEventDescription(event.id, value.description || null);
    // Optionally persist start/end if changed (add a meta helper if you prefer keeping them together):
    await eventService.updateEventDates(event.id, start, end);

    return 'Event updated';
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
};
