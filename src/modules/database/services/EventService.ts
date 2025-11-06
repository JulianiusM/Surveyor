// TypeORM-based implementation of the event module
import {AppDataSource} from '../dataSource';
import {Event} from '../entities/event/Event';
import {EventRegistration} from '../entities/event/EventRegistration';
import {generateUniqueId} from '../../lib/util';
import {ActivityPlan} from "../entities/activity/ActivityPlan";
import {PackingList} from "../entities/packing/PackingList";
import {DriversList} from "../entities/drivers/DriversList";
import {EventRegistrationDietary} from "../entities/event/EventRegistrationDietary";
import type {DIETARY} from "../../../types/EventTypes";
import {EntityManager, FindOptionsWhere, IsNull} from 'typeorm';

// ─────────────────────────────────────────────────────────────────────────────
// Events (CRUD)
// ─────────────────────────────────────────────────────────────────────────────

export async function createEventTx(
    ownerId: number,
    title: string,
    desc: string | null,
    startDate: string,       // 'YYYY-MM-DD'
    endDate: string,         // 'YYYY-MM-DD'
    location: string | null,
    bindingDeadline: string | null, // ISO-like string from <input type="datetime-local">, may be null/empty
    requireDietaryInfo: boolean,
    maxParticipants: number | null,
    timezone: string | null,
) {
    return await AppDataSource.transaction('READ COMMITTED', async (manager) => {
        const id = generateUniqueId();
        const repo = manager.getRepository(Event);

        const ev = repo.create({
            id,
            ownerId,
            title,
            description: desc,
            startDate,
            endDate,
            location,
            timezone,
            bindingDeadline: bindingDeadline,
            requireDietaryInfo: requireDietaryInfo,
            maxParticipants: maxParticipants,
        });

        await repo.save(ev);
        return id;
    });
}

export async function deleteEvent(eventId: string) {
    await AppDataSource.getRepository(Event).delete(eventId);
}

export async function getEventById(eventId: string) {
    return await AppDataSource.getRepository(Event).findOneBy({id: eventId});
}

export async function getEventsByOwnerId(ownerId: number) {
    return await AppDataSource.getRepository(Event).findBy({ownerId});
}

export async function updateEventTitle(eventId: string, title: string) {
    await AppDataSource.getRepository(Event).update(eventId, {title});
}

export async function updateEventDescription(eventId: string, description: string | null) {
    await AppDataSource.getRepository(Event).update(eventId, {description});
}

export async function updateEventMeta(eventId: string, fields: {
    location?: string | null;
    bindingDeadline?: string | null;
    requireDietaryInfo?: boolean;
    maxParticipants?: number;
    timezone?: string | null;
}) {
    const patch: Partial<Event> = {};
    if (fields.location !== undefined) patch.location = fields.location;
    if (fields.maxParticipants !== undefined) patch.maxParticipants = fields.maxParticipants;
    if (fields.bindingDeadline !== undefined) patch.bindingDeadline = fields.bindingDeadline;
    if (fields.requireDietaryInfo !== undefined) patch.requireDietaryInfo = fields.requireDietaryInfo;
    if (fields.timezone !== undefined) patch.timezone = fields.timezone;
    if (Object.keys(patch).length === 0) return;
    await AppDataSource.getRepository(Event).update(eventId, patch);
}

export async function updateEventDates(eventId: string, startDate: string, endDate: string) {
    await AppDataSource.getRepository(Event).update(eventId, {startDate, endDate});
}

// ─────────────────────────────────────────────────────────────────────────────
// Registrations (no validation — controller handles it)
// ─────────────────────────────────────────────────────────────────────────────

export async function registerUser(
    eventId: string,
    userId: number,
    arrivalDate: string,
    departureDate: string,
    dietaryChoices?: DIETARY[] | null,
    dietaryAllergies?: string | null
) {
    return register(eventId, arrivalDate, departureDate, {userId}, dietaryChoices, dietaryAllergies);
}

export async function registerGuest(
    eventId: string,
    guestId: number,
    arrivalDate: string,
    departureDate: string,
    dietaryChoices?: DIETARY[] | null,
    dietaryAllergies?: string | null
) {
    return register(eventId, arrivalDate, departureDate, {guestId}, dietaryChoices, dietaryAllergies);
}

export async function register(
    eventId: string,
    arrivalDate: string,
    departureDate: string,
    actor: { userId?: number, guestId?: number },
    dietaryChoices?: DIETARY[] | null,
    dietaryAllergies?: string | null
) {
    if (!actor.userId && !actor.guestId) return undefined;
    return await AppDataSource.transaction('READ COMMITTED', async (manager) => {
        const repo = manager.getRepository(EventRegistration);
        let reg = await repo.findOne({where: {eventId, guestId: actor.guestId, userId: actor.userId}});
        if (reg) {
            reg.arrivalDate = arrivalDate;
            reg.departureDate = departureDate;
            reg = await repo.save(reg);
        } else {
            reg = repo.create({
                eventId, guestId: actor.guestId, userId: actor.userId, arrivalDate, departureDate,
            });
            reg = await repo.save(reg);
        }
        await replaceDietaryChoicesTx(manager, reg.id, dietaryChoices, dietaryAllergies);
        return reg.id;
    });
}

export async function getRegistrationFor(actor: { userId?: number; guestId?: number }, eventId: string) {
    const where: FindOptionsWhere<EventRegistration> = {eventId};
    if (actor.userId) where.userId = actor.userId;
    if (actor.guestId) where.guestId = actor.guestId;
    return await AppDataSource.getRepository(EventRegistration).findOne({
        where,
        relations: ['dietaryChoices'], // pull normalized rows
        order: {id: 'DESC'},
    });
}

export async function getRegistrationsForEvent(eventId: string) {
    return await AppDataSource.getRepository(EventRegistration).findBy({eventId});
}

export async function getEventParticipants(eventId: string) {
    const repo = AppDataSource.getRepository(EventRegistration);
    const rows = await repo.find({
        where: {eventId},
        relations: ['user', 'guest', 'dietaryChoices'],
        order: {id: 'ASC'},
    });
    return rows.map((r) => ({
        userId: r.userId ?? null,
        guestId: r.guestId ?? null,
        name: r.user?.name || r.user?.username || r.guest?.username || '—',
        arrivalDate: r.arrivalDate,
        departureDate: r.departureDate,
        dietaryChoices: r.dietaryChoices ?? null,
    }));
}

export async function deleteRegistrationFor(eventId: string, actor: { userId?: number; guestId?: number }) {
    const repo = AppDataSource.getRepository(EventRegistration);
    if (actor.userId) {
        await repo.delete({eventId, userId: actor.userId});
    } else if (actor.guestId) {
        await repo.delete({eventId, guestId: actor.guestId});
    }
}

// Replace all dietary rows for a registration
async function replaceDietaryChoicesTx(
    manager: EntityManager,
    registrationId: number,
    choices?: DIETARY[] | null,
    additionalInfo?: string | null
) {
    const repo = manager.getRepository(EventRegistrationDietary);
    await repo.delete({registrationId});
    if (!choices || !choices.length) return;
    const unique = Array.from(new Set(choices));
    const rows = unique.map(c => repo.create({registrationId, choice: c, additionalInfo}));
    await repo.save(rows);
}

export async function replaceDietaryChoices(
    registrationId: number,
    choices?: DIETARY[] | null,
    additionalInfo?: string | null
) {
    await AppDataSource.transaction('READ COMMITTED', async (manager) => {
        await replaceDietaryChoicesTx(manager, registrationId, choices, additionalInfo);
    });
}

/**
 * Get all Events a user or guest is registered at.
 * - If both userId and guestId are provided, results are OR-combined.
 * - Sorted by event start date descending.
 */
export async function getRegisteredEventsFor(actor: { userId?: number; guestId?: number }): Promise<Event[]> {
    if (!actor.userId && !actor.guestId) return [];

    const repo = AppDataSource.getRepository(Event);
    return repo.find({
        where: {
            registrations: {
                userId: actor.userId ?? IsNull(),
                guestId: actor.guestId ?? IsNull(),
            }
        },
        relations: ['registrations'],
        order: {startDate: 'DESC'},
    });
}

export async function isEventFull(eventId: string): Promise<boolean> {
    const eventRepo = AppDataSource.getRepository(Event);
    const regRepo = AppDataSource.getRepository(EventRegistration);

    const event = await eventRepo.findOne({
        where: {id: eventId},
        select: {id: true, maxParticipants: true},
    });
    if (!event) throw new Error("Event not found");

    // null => unlimited
    if (event.maxParticipants == null) return false;

    const registrations = await regRepo.countBy({eventId});
    return registrations >= event.maxParticipants;
}

export async function isRegisteredForEvent(actor: { userId?: number; guestId?: number }, eventId: string) {
    if (!actor.userId && !actor.guestId) return false;

    const repo = AppDataSource.getRepository(EventRegistration);
    return await repo.exists({
        where: {eventId, userId: actor.userId ?? IsNull(), guestId: actor.guestId ?? IsNull()}
    });
}

// ---------------- Associated content (event-scoped) ----------------
// Uses raw where clause on event_id (works once the column exists).

export async function getActivityPlansForEvent(eventId: string) {
    return await AppDataSource.getRepository(ActivityPlan).findBy({eventId});
}

export async function getPackingListsForEvent(eventId: string) {
    return await AppDataSource.getRepository(PackingList).findBy({eventId});
}

export async function getDriverListsForEvent(eventId: string) {
    return await AppDataSource.getRepository(DriversList).findBy({eventId});
}
