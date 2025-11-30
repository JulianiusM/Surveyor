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
import {EntityManager, FindOptionsWhere, IsNull, MoreThanOrEqual} from 'typeorm';
import {ensureOneByObjectsAuthed, findOneByObjectsAuthed} from "../utils/relation-upsert";

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
            owner: {id: ownerId},
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
    return await AppDataSource.getRepository(Event).findBy({owner: {id: ownerId}});
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

export async function getActiveEventsByOwnerId(ownerId: number) {
    const today = new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'
    return await AppDataSource.getRepository(Event).find({
        where: {
            owner: {id: ownerId},
            endDate: MoreThanOrEqual(today),
        },
        order: {startDate: 'ASC'},
    });
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
        let reg = await findOneByObjectsAuthed(repo, {
            relations: {event: eventId},
            party: {user: actor.userId, guest: actor.guestId}
        });
        if (reg) {
            reg.arrivalDate = arrivalDate;
            reg.departureDate = departureDate;
            reg = await repo.save(reg);
        } else {
            reg = await ensureOneByObjectsAuthed(repo, {
                relations: {event: eventId},
                columns: {arrivalDate, departureDate},
                party: {user: actor.userId, guest: actor.guestId}
            });
        }
        await replaceDietaryChoicesTx(manager, reg.id, dietaryChoices, dietaryAllergies);
        return reg.id;
    });
}

export async function getRegistrationFor(actor: { userId?: number; guestId?: number }, eventId: string) {
    const where: FindOptionsWhere<EventRegistration> = {event: {id: eventId}};
    if (actor.userId) where.user = {id: actor.userId};
    if (actor.guestId) where.guest = {id: actor.guestId};
    return await AppDataSource.getRepository(EventRegistration).findOne({
        where,
        relations: ['dietaryChoices'], // pull normalized rows
        order: {id: 'DESC'},
    });
}

export async function getRegistrationsForEvent(eventId: string) {
    return await AppDataSource.getRepository(EventRegistration).findBy({event: {id: eventId}});
}

export async function getEventParticipants(eventId: string) {
    const repo = AppDataSource.getRepository(EventRegistration);
    const rows = await repo.find({
        where: {event: {id: eventId}},
        relations: ['user', 'guest', 'dietaryChoices'],
        order: {id: 'ASC'},
    });
    return rows.map((r) => ({
        userId: r.user?.id ?? null,
        guestId: r.guest?.id ?? null,
        name: r.user?.name || r.user?.username || r.guest?.username || '—',
        arrivalDate: r.arrivalDate,
        departureDate: r.departureDate,
        dietaryChoices: r.dietaryChoices ?? null,
    }));
}

export async function deleteRegistrationFor(eventId: string, actor: { userId?: number; guestId?: number }) {
    const repo = AppDataSource.getRepository(EventRegistration);
    if (actor.userId) {
        await repo.delete({event: {id: eventId}, user: {id: actor.userId}});
    } else if (actor.guestId) {
        await repo.delete({event: {id: eventId}, guest: {id: actor.guestId}});
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
    await repo.delete({registration: {id: registrationId}});
    if (!choices || !choices.length) return;
    const unique = Array.from(new Set(choices));
    const rows = unique.map(c => repo.create({registration: {id: registrationId}, choice: c, additionalInfo}));
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
                user: {id: actor.userId ?? IsNull()},
                guest: {id: actor.guestId ?? IsNull()},
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

    const registrations = await regRepo.countBy({event: {id: eventId}});
    return registrations >= event.maxParticipants;
}

export async function isRegisteredForEvent(actor: { userId?: number; guestId?: number }, eventId: string) {
    if (!actor.userId && !actor.guestId) return false;

    const repo = AppDataSource.getRepository(EventRegistration);
    return await repo.exists({
        where: {event: {id: eventId}, user: {id: actor.userId ?? IsNull()}, guest: {id: actor.guestId ?? IsNull()}}
    }) || await AppDataSource.getRepository(Event).exists({
        where: {id: eventId, owner: {id: actor.userId}}
    });
}

// ---------------- Associated content (event-scoped) ----------------
// Uses raw where clause on event_id (works once the column exists).

export async function getActivityPlansForEvent(eventId: string) {
    return await AppDataSource.getRepository(ActivityPlan).findBy({event: {id: eventId}});
}

export async function getPackingListsForEvent(eventId: string) {
    return await AppDataSource.getRepository(PackingList).findBy({event: {id: eventId}});
}

export async function getDriverListsForEvent(eventId: string) {
    return await AppDataSource.getRepository(DriversList).findBy({event: {id: eventId}});
}
