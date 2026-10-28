/* Copyright 2026 Julian Malovanij. Licensed under the Apache License, Version 2.0. */

import Joi from 'joi';
import type {EntityManager} from 'typeorm';
import type {Event} from '../database/entities/event/Event';
import type {EventRegistration} from '../database/entities/event/EventRegistration';
import type {EventRegBypassLink} from '../database/entities/event/EventRegBypassLink';
import type {DIETARY} from '../../../types/EventTypes';
import type {SessionLike} from '../../../types/PermissionTypes';
import {eventDietaryChoices, eventDietaryGroups} from '../../../common/generated/domainChoices';
import * as eventService from '../database/services/EventService';
import {APIError} from '../lib/errors';
import {isWithinWindow, normalizeToArray} from '../lib/util';

/** Validate and persist current-profile attendance against one locked Event context.
 * Root and pool coordination precede deadline-token locking. All decisions and
 * dependent writes use the service-owned transaction and its current rows. */
export async function registerAttendance(event: Event, body: any, session: SessionLike, regToken?: string | null) {
    if (!event) throw new APIError('Event not found', body, 404);
    if (!session.profile) throw new APIError('Authentication required', body, 401);
    const profileId = session.profile.id;

    /** Decide admission and save attendance while the DBAL retains root/pool locks. */
    async function saveRegistration(manager: EntityManager, current: Event | null): Promise<void> {
        // Missing/deleted Events remain a feature rejection; the DBAL only returns rows.
        if (!current) throw new APIError('Event not found', body, 404);
        const registration = await eventService.getRegistrationFor(profileId, current.id, manager);
        const count = registration || current.maxParticipants == null
            ? 0 : await eventService.getEventRegistrationCount(current.id, manager);
        if (!registration && eventCapacityReached(current.maxParticipants, count)) {
            throw new APIError('Event is full', body, 403, {cause: 'EVENT_FULL'});
        }

        // Preserve the admitted command shape and meal policy; validation does not
        // create an anonymous identity or choose a submitted profile as the actor.
        const schema = Joi.object({
            arrivalDate: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
            departureDate: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
            dietary: Joi.alternatives().try(
                Joi.array().items(Joi.string().valid(...eventDietaryChoices).uppercase()),
                Joi.string().valid(...eventDietaryChoices).uppercase()
            ).optional(),
            allergyNotes: Joi.string().max(4000).allow(''),
            dietComment: Joi.string().max(4000).allow(''),
        });
        const {error, value} = schema.validate(body, {abortEarly: false, allowUnknown: true});
        if (error) throw new APIError(error.details.map(detail => detail.message).join(', '), body, 400);
        const dietary: DIETARY[] = normalizeToArray(value.dietary);
        const allergyNotes: string = value.allergyNotes || '';
        const dietComment: string = value.dietComment || '';

        // Date, dietary and new-attendee deadline rules remain independent. A
        // bypass token supplies deadline eligibility only, never a capacity override.
        let bypass: {ok: boolean; linkId?: string} = {ok: false};
        if (current.bindingDeadline && Date.parse(current.bindingDeadline) < Date.now()) {
            if (registration) {
                if (!current.allowRegDateUpdatesAfterDeadline
                    && (registration.arrivalDate !== value.arrivalDate || registration.departureDate !== value.departureDate)) {
                    throw new APIError('Date updates not allowed after deadline has passed', {}, 403, {cause: 'EVENT_DATE_UPDATES_CLOSED'});
                }
                if (!current.allowRegDietUpdateAfterDeadline && !isDietaryEqual(registration, dietary, allergyNotes, dietComment)) {
                    throw new APIError('Diet updates not allowed after deadline has passed', {}, 403, {cause: 'EVENT_DIET_UPDATES_CLOSED'});
                }
            } else {
                bypass = await canBypassDeadlineWithToken(current.id, regToken, manager);
                if (!bypass.ok) throw new APIError('Registration deadline has passed', {}, 403, {cause: 'EVENT_DEADLINE_PASSED'});
            }
        }
        if (!isWithinWindow(current.startDate, current.endDate, value.arrivalDate, value.departureDate)) {
            throw new APIError('Arrival/Departure must be within event dates', body, 400, {cause: 'EVENT_DATES_INVALID'});
        }
        checkMeals(dietary, allergyNotes, dietComment, body);

        // The root and all existing pool locks are already held. Token expiry,
        // revocation and final use are rechecked before attendance can consume it.
        if (bypass.ok && bypass.linkId) {
            const link = await eventService.lockDeadlineBypassLink(manager, current.id, bypass.linkId);
            if (!link || bypassStatus(link) !== 'active') {
                throw new APIError('This link has already been used', {}, 409, {cause: 'EVENT_TOKEN_USED'});
            }
            await eventService.consumeDeadlineBypassToken(link.id, profileId, manager);
        }
        // Every dependent write shares this commit. Re-entering pool coordination
        // reuses the same connection and already-held locks; rollback cannot spend a token.
        await eventService.register(current.id, value.arrivalDate, value.departureDate, profileId, dietary,
            normalizeDietaryNote(allergyNotes), normalizeDietaryNote(dietComment), manager);
    }
    await eventService.withLockedRegistration(event.id, saveRegistration);
    return 'Registration saved';
}

/** Keep comparison and persistence on the same absent/blank note representation.
 * This is the existing save normalization, not a new input-admission rule. */
function normalizeDietaryNote(value: string | null | undefined): string | null {
    return value?.trim() || null;
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

    return ok && localDiets.size === 0
        && normalizeDietaryNote(allergyNotes) === normalizeDietaryNote(localAllergy)
        && normalizeDietaryNote(dietComment) === normalizeDietaryNote(localComment);
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
export async function cancelRegistration(event: Event, session: SessionLike) {
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

/** One capacity policy serves presentation and registration admission.
 * Missing limits remain unlimited, while a persisted zero still closes admission.
 * Callers supply their existing count so this rule introduces no read or lock. */
export function eventCapacityReached(limit: number | null | undefined, registrationCount: number): boolean {
    return limit != null && registrationCount >= limit;
}

/** Capacity is policy over persisted event limits and registration counts. */
export async function isEventFull(eventId: string): Promise<boolean> {
    const event = await eventService.getEventById(eventId);
    if (!event) throw new APIError('Event not found', {}, 404);
    // Presentation is a read-only snapshot. Admission separately retains the root
    // lock while this same capacity policy decides whether a new row may be saved.
    const registrationCount = event.maxParticipants == null ? 0 : await eventService.getEventRegistrationCount(eventId);
    return eventCapacityReached(event.maxParticipants, registrationCount);
}

/** Keep display, preview and locked consumption aligned on the same eligibility rule. */
function bypassStatus(link: EventRegBypassLink) {
    if (link.revokedAt) return 'revoked';
    if (link.expiresAt && link.expiresAt < new Date()) return 'expired';
    if (link.usedCount >= link.maxUses) return 'consumed';
    return 'active';
}

/** Eligibility and display share this feature rule; the service only returns rows. */
export async function canBypassDeadlineWithToken(eventId: string, token?: string | null, manager?: EntityManager): Promise<{ok: boolean; linkId?: string}> {
    if (!token) return {ok: false};
    const link = await eventService.getDeadlineBypassToken(eventId, token, manager);
    return link && bypassStatus(link) === 'active' ? {ok: true, linkId: link.id} : {ok: false};
}

/** Present existing registration links with the shared lifecycle status, without changing token state. */
export async function listDeadlineBypassLinks(event: Event) {
    // Load only this event links, then project existing usage/revocation/expiry evidence.
    const links = await eventService.listDeadlineBypassLinks(event.id);
    return links.map(function presentLink(link) {
        return {id: link.id, token: link.token, createdAt: link.track.createdAt, expiresAt: link.expiresAt,
            revokedAt: link.revokedAt, used: link.usedCount > 0 || !!link.usedAt, profileId: link.profileId, status: bypassStatus(link)};
    });
}

/** Issue a bounded-use deadline link for an admitted full-account organizer. */
export async function createDeadlineBypassLink(event: Event, body: any, session: SessionLike) {
    if (!event) throw new APIError('Event not found', body, 404);
    if (!session.auth?.user) throw new APIError('Must be logged in', body, 401, {cause: 'EVENT_LINK_ACCOUNT_REQUIRED'});

    // Account-only issuance is an action rejection for a valid guest, never session expiry.
    // Validate the requested whole-number Uses count before allocating a link.
    const maxUses = body.maxUses === undefined ? 1 : body.maxUses;
    if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 32767) {
        throw new APIError('Uses must be a whole number between 1 and 32767', {}, 400);
    }
    const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
    return await eventService.createDeadlineBypassLink(
        event.id,
        session.auth.user.id,
        {expiresAt, maxUses}
    );
}

export async function revokeDeadlineBypassLink(event: Event, linkId: string) {
    await eventService.revokeDeadlineBypassLink(event.id, linkId);
}

/** Update one event-scoped registration within the Event's inclusive date window.
 * The coordinating controller enforces MANAGE_REGISTRATIONS before calling this
 * shared attendance validation/persistence owner. */
export async function updateRegistrationDates(event: Event, registrationId: string, body: any) {
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

