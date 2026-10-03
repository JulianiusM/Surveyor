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

// TypeORM-based implementation of the event module
import {EntityManager, IsNull, MoreThanOrEqual} from 'typeorm';
import type {DIETARY, EventLinkOptionsQuery, ParticipantRow} from "../../../types/EventTypes";
import type {EntityPermissionQueryScope} from '../../../types/PermissionTypes';
import {WithRequired} from "../../../types/UtilTypes";
import {generateUniqueId, generateUniqueToken, now} from '../../lib/util';
import {AppDataSource} from '../dataSource';
import {ActivityPlan} from "../entities/activity/ActivityPlan";
import {DriversList} from "../entities/drivers/DriversList";
import {Event} from '../entities/event/Event';
import {EventRegBypassLink} from "../entities/event/EventRegBypassLink";
import {EventRegistration} from '../entities/event/EventRegistration';
import {EventRegistrationDietary} from "../entities/event/EventRegistrationDietary";
import {PackingList} from "../entities/packing/PackingList";
import * as entityAdminService from "./EntityAdminService";
import {invalidateEventPools, lockEventPools, registerForDefaultPools} from "./EventInvoiceService";

// ─────────────────────────────────────────────────────────────────────────────
// Events (CRUD)
// ─────────────────────────────────────────────────────────────────────────────

export async function createEventTx(
    ownerId: string,
    eventData: WithRequired<Partial<Event>, "title" | "startDate" | "endDate">,
) {
    return await AppDataSource.transaction('READ COMMITTED', async (manager) => {
        const id = generateUniqueId();
        const repo = manager.getRepository(Event);

        const ev = repo.create({
            id,
            owner: {id: ownerId},
            ...eventData
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

export async function getEventsByOwnerId(ownerId: string) {
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
    allowRegDateUpdateAfterDeadline?: boolean;
    allowRegCancelAfterDeadline?: boolean;
    requireDietaryInfo?: boolean;
    allowDietComment?: boolean;
    allowDietUpdateAfterDeadline?: boolean;
    maxParticipants?: number;
    timezone?: string | null;
}) {
    const patch: Partial<Event> = {};
    if (fields.location !== undefined) patch.location = fields.location;
    if (fields.maxParticipants !== undefined) patch.maxParticipants = fields.maxParticipants;
    if (fields.bindingDeadline !== undefined) patch.bindingDeadline = fields.bindingDeadline;
    if (fields.allowRegDateUpdateAfterDeadline !== undefined) patch.allowRegDateUpdatesAfterDeadline = fields.allowRegDateUpdateAfterDeadline;
    if (fields.allowRegCancelAfterDeadline !== undefined) patch.allowRegCancelationAfterDeadline = fields.allowRegCancelAfterDeadline;
    if (fields.requireDietaryInfo !== undefined) patch.requireDietaryInfo = fields.requireDietaryInfo;
    if (fields.allowDietComment !== undefined) patch.allowDietComment = fields.allowDietComment;
    if (fields.allowDietUpdateAfterDeadline !== undefined) patch.allowRegDietUpdateAfterDeadline = fields.allowDietUpdateAfterDeadline;
    if (fields.timezone !== undefined) patch.timezone = fields.timezone;
    if (Object.keys(patch).length === 0) return;
    await AppDataSource.getRepository(Event).update(eventId, patch);
}

export async function updateEventDates(eventId: string, startDate: string, endDate: string) {
    await AppDataSource.getRepository(Event).update(eventId, {startDate, endDate});
}

export async function getActiveEventsByOwnerId(ownerId: string) {
    const today = new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'
    return await AppDataSource.getRepository(Event).find({
        where: {
            owner: {id: ownerId},
            endDate: MoreThanOrEqual(today),
            archivedAt: IsNull(),
        },
        order: {startDate: 'ASC'},
    });
}

export async function getActiveManagedEvents(profileId: string) {
    // Legacy active-membership query: deliberately narrower than the administration overview.
    // Interactive creation/linking uses permission-filtered getEventLinkCandidates instead,
    // so this helper's date and archival restrictions do not define selectable destinations.
    const today = new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'
    return entityAdminService.createManagedEntityQuery(AppDataSource.getRepository(Event), 'event', profileId)
        .andWhere('entity.endDate >= :today', {today})
        .andWhere('entity.archivedAt IS NULL')
        .orderBy('entity.startDate', 'ASC').getMany();
}

/** Database transaction boundary shared by controller-orchestrated event writes. */
export async function withEventTransaction<T>(action: (manager: EntityManager) => Promise<T>): Promise<T> {
    return AppDataSource.transaction('READ COMMITTED', action);
}

/** Lock the latest persisted row; absence is returned for the controller to interpret. */
export async function lockEvent(manager: EntityManager, eventId: string): Promise<Event | null> {
    return manager.getRepository(Event).findOne({where: {id: eventId}, lock: {mode: 'pessimistic_write'}});
}

/** Store an already normalized patch using the controller's current locking transaction. */
export async function updateEventProperties(eventId: string, patch: Partial<Event>, manager: EntityManager = AppDataSource.manager): Promise<void> {
    await manager.getRepository(Event).update(eventId, patch);
}

/**
 * Bounded candidates, not authorized options. The controller batches the existing permission
 * engine over these rows; filtering by overview membership here would miss audience grants.
 * A stable date/id seek lets it continue past denied candidates without exposing their identity.
 */
export async function getEventLinkCandidates(
    filters: EventLinkOptionsQuery,
    scope: EntityPermissionQueryScope,
    referenceTime: Date,
    after?: {startDate: string; id: string},
    limit = 100,
): Promise<Event[]> {
    const query = AppDataSource.getRepository(Event).createQueryBuilder('event');
    entityAdminService.addEntityPermissionCandidates(query, 'event', scope, 'event.id');
    // Calendar filters use one controller-captured UTC day; deadlines compare instants.
    // The same clock is reused across candidate batches so midnight cannot shift a page.
    const today = referenceTime.toISOString().slice(0, 10);
    if (filters.q) {
        // Search text is literal, not SQL's pattern language. Escape the chosen escape
        // character first as part of the same replacement, then add only our own wildcards.
        const term = `%${filters.q.replace(/[!%_]/g, '!$&')}%`;
        query.andWhere("(event.title LIKE :term ESCAPE '!' OR event.description LIKE :term ESCAPE '!')", {term});
    }
    // From/to select overlapping date periods, rather than only events beginning inside them.
    if (filters.from) query.andWhere('event.endDate >= :from', {from: filters.from});
    if (filters.to) query.andWhere('event.startDate <= :to', {to: filters.to});
    if (filters.period === 'upcoming') query.andWhere('event.startDate > :today', {today});
    if (filters.period === 'ongoing') query.andWhere('event.startDate <= :today AND event.endDate >= :today', {today});
    if (filters.period === 'ended') query.andWhere('event.endDate < :today', {today});
    // Archive and deadline are independent dimensions; neither implies a calendar period.
    if (filters.archive === 'active') query.andWhere('event.archivedAt IS NULL');
    if (filters.archive === 'archived') query.andWhere('event.archivedAt IS NOT NULL');
    if (filters.deadline === 'open') query.andWhere('(event.bindingDeadline IS NULL OR event.bindingDeadline >= :now)', {now: referenceTime});
    if (filters.deadline === 'passed') query.andWhere('event.bindingDeadline < :now', {now: referenceTime});
    if (after) query.andWhere('(event.startDate > :start OR (event.startDate = :start AND event.id > :id))', {start: after.startDate, id: after.id});
    return query.orderBy('event.startDate', 'ASC').addOrderBy('event.id', 'ASC').take(limit).getMany();
}

/**
 * Load every owned or explicitly administered event, including ended and archived ones.
 * The overview controller decides main/hidden placement after loading lifecycle state;
 * filtering dates here would make delegated administrators lose historical access.
 */
export async function getManagedEvents(profileId: string) {
    return entityAdminService.createManagedEntityQuery(AppDataSource.getRepository(Event), 'event', profileId)
        .orderBy('entity.startDate', 'ASC').getMany();
}

// ─────────────────────────────────────────────────────────────────────────────
// Registrations (no validation — controller handles it)
// ─────────────────────────────────────────────────────────────────────────────

export async function register(
    eventId: string,
    arrivalDate: string,
    departureDate: string,
    profileId: string,
    dietaryChoices?: DIETARY[] | null,
    dietaryAllergies?: string | null,
    dietComment?: string | null,
    manager?: EntityManager,
) {
    async function persistRegistration(manager: EntityManager) {
        await lockEventPools(manager, eventId);
        const repo = manager.getRepository(EventRegistration);
        let reg = await repo.findOneBy({event: {id: eventId}, profile: {id: profileId}});
        if (reg) {
            reg.arrivalDate = arrivalDate;
            reg.departureDate = departureDate;
            reg = await repo.save(reg);
        } else {
            reg = repo.create({
                event: {id: eventId},
                profile: {id: profileId},
                arrivalDate: arrivalDate,
                departureDate: departureDate
            });
            reg = await repo.save(reg);
        }
        await replaceDietaryChoicesTx(manager, reg.id, dietaryChoices, dietaryAllergies, dietComment);
        await registerForDefaultPools(manager, reg);
        await invalidateEventPools(manager, eventId);
        return reg.id;
    }
    return manager ? persistRegistration(manager) : withEventTransaction(persistRegistration);
}

export async function getRegistrationFor(profileId: string, eventId: string) {
    return await AppDataSource.getRepository(EventRegistration).findOne({
        where: {event: {id: eventId}, profile: {id: profileId}},
        relations: {
            dietaryChoices: true
        }, // pull normalized rows
        order: {id: 'DESC'},
    });
}

export async function getRegistrationsForEvent(eventId: string) {
    return await AppDataSource.getRepository(EventRegistration).findBy({event: {id: eventId}});
}

export async function getEventParticipants(eventId: string): Promise<ParticipantRow[]> {
    const repo = AppDataSource.getRepository(EventRegistration);
    const rows = await repo.find({
        where: {event: {id: eventId}},
        relations: {
            profile: {
                user: true,
                guest: true,
            },
            dietaryChoices: true
        },
        order: {id: 'ASC'},
    });
    return rows.map((r): ParticipantRow => ({
        id: r.id,
        profileId: r.profile.id ?? null,
        name: r.profile.name?.trim() || r.profile.user?.name?.trim() || r.profile.user?.username || r.profile.guest?.username || '—',
        email: r.profile.user?.email || r.profile.guest?.email || '—',
        arrivalDate: r.arrivalDate,
        departureDate: r.departureDate,
        dietaryChoices: r.dietaryChoices ?? null,
    }));
}

export async function deleteRegistrationFor(eventId: string, profileId: string) {
    await AppDataSource.transaction('READ COMMITTED', async (manager) => {
        await lockEventPools(manager, eventId);
        const result = await manager.getRepository(EventRegistration).delete({event: {id: eventId}, profile: {id: profileId}});
        if (result.affected) await invalidateEventPools(manager, eventId);
    });
}

// Replace all dietary rows for a registration
async function replaceDietaryChoicesTx(
    manager: EntityManager,
    registrationId: number,
    choices?: DIETARY[] | null,
    allergyInfo?: string | null,
    dietComment?: string | null,
) {
    const repo = manager.getRepository(EventRegistrationDietary);
    await repo.delete({registration: {id: registrationId}});
    if (!choices || !choices.length) return;
    const unique = Array.from(new Set(choices));
    const rows = unique.map(c => repo.create({
        registration: {id: registrationId},
        choice: c,
        additionalInfo: c === "ALLERGIES" ? allergyInfo : dietComment
    }));
    await repo.save(rows);
}

export async function replaceDietaryChoices(
    registrationId: number,
    choices?: DIETARY[] | null,
    allergy?: string | null,
    comment?: string | null,
) {
    await AppDataSource.transaction('READ COMMITTED', async (manager) => {
        await replaceDietaryChoicesTx(manager, registrationId, choices, allergy, comment);
    });
}

/**
 * Get all Events a profile is registered at.
 * - Sorted by event start date descending.
 */
export async function getRegisteredEventsFor(profileId: string): Promise<Event[]> {
    // Preserve the profile's registration relation for existing overview consumers;
    // other participants' registrations are not needed in this collection.
    return getEventParticipationQuery(profileId)
        .leftJoinAndSelect('event.registrations', 'registrations', 'registrations.profile_id = :profileId', {profileId})
        .orderBy('event.startDate', 'DESC').getMany();
}

/**
 * Registration defines participation regardless of dates or archival state.
 * Return a query so overview discovery can load events while a visibility write
 * can add a single event ID and check membership using its transaction manager.
 */
export function getEventParticipationQuery(profileId: string, manager: EntityManager = AppDataSource.manager) {
    return manager.getRepository(Event).createQueryBuilder('event')
        .whereExists(manager.getRepository(EventRegistration).createQueryBuilder('registration')
            .where('registration.event_id = event.id')
            .andWhere('registration.profile_id = :profileId', {profileId}));
}

export async function deleteRegistration(eventId: string, regId: string | number) {
    return AppDataSource.transaction('READ COMMITTED', async (manager) => {
        await lockEventPools(manager, eventId);
        const res = await manager.getRepository(EventRegistration).delete({id: Number(regId), event: {id: eventId}});
        if (res.affected) await invalidateEventPools(manager, eventId);
        return (res?.affected ?? 0) > 0;
    });
}

export async function updateRegistrationDates(eventId: string, regId: number, arrivalDate: string, departureDate: string) {
    return AppDataSource.transaction('READ COMMITTED', async (manager) => {
        await lockEventPools(manager, eventId);
        const repo = manager.getRepository(EventRegistration);
        const reg = await repo.findOne({where: {id: regId, event: {id: eventId}}});
        if (!reg) return false;
        reg.arrivalDate = arrivalDate;
        reg.departureDate = departureDate;
        await repo.save(reg);
        await invalidateEventPools(manager, eventId);
        return true;
    });
}

/** Raw cardinality; capacity decisions belong to the event controller. */
export async function getEventRegistrationCount(eventId: string): Promise<number> {
    return AppDataSource.getRepository(EventRegistration).countBy({event: {id: eventId}});
}

export async function isRegisteredForEvent(profileId: string, eventId: string) {
    const repo = AppDataSource.getRepository(EventRegistration);

    // Check if profile is registered (use separate queries for clarity)
    let isRegistered = await repo.exists({
        where: {event: {id: eventId}, profile: {id: profileId}}
    });

    // Also check if profile is the event owner
    if (!isRegistered) {
        isRegistered = await AppDataSource.getRepository(Event).exists({
            where: {id: eventId, owner: {id: profileId}}
        });
    }

    return isRegistered;
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

// ---------- Registration Bypass Links ----------
export async function createDeadlineBypassLink(
    eventId: string,
    createdBy: number,
    opts?: { expiresAt?: Date | null; maxUses?: number }
) {
    const token = generateUniqueToken();
    const repo = AppDataSource.getRepository(EventRegBypassLink);
    const row = repo.create({
        id: generateUniqueId(),
        event: {id: eventId},
        token,
        createdBy,
        maxUses: opts?.maxUses ?? 1,
        usedCount: 0,
        expiresAt: opts?.expiresAt ?? null,
    });
    await repo.save(row);
    return {id: row.id, token: row.token};
}

export async function listDeadlineBypassLinks(eventId: string) {
    return AppDataSource.getRepository(EventRegBypassLink).find({where: {event: {id: eventId}}, order: {track: {createdAt: 'DESC'}}});
}

export async function revokeDeadlineBypassLink(eventId: string, linkId: string) {
    const repo = AppDataSource.getRepository(EventRegBypassLink);
    await repo.update({id: linkId, event: {id: eventId}}, {revokedAt: now()});
}

/** Load token state; deadline, revocation and usage checks are controller policy. */
export async function getDeadlineBypassToken(eventId: string, token: string) {
    return AppDataSource.getRepository(EventRegBypassLink).findOne({where: {event: {id: eventId}, token}});
}

/** Lock token data on the controller's registration transaction before checking eligibility. */
export async function lockDeadlineBypassLink(manager: EntityManager, eventId: string, linkId: string): Promise<EventRegBypassLink | null> {
    return manager.getRepository(EventRegBypassLink).findOne({
        where: {id: linkId, event: {id: eventId}}, lock: {mode: 'pessimistic_write'},
    });
}

/**
 * Record consumption after the controller checks the locked row. The caller must use the
 * same transaction for this write and registration: failure rolls both operations back.
 */
export async function consumeDeadlineBypassToken(
    linkId: string,
    profileId: string,
    manager: EntityManager,
): Promise<void> {
    await manager.getRepository(EventRegBypassLink).createQueryBuilder()
        .update(EventRegBypassLink)
        .set({usedCount: () => 'used_count + 1', profile: {id: profileId}, usedAt: () => 'CURRENT_TIMESTAMP'})
        .where('id = :id', {id: linkId})
        .execute();
}

export async function updateHeaderImage(eventId: string, headerImg?: string | null) {
    await AppDataSource.getRepository(Event).update(eventId, {headerImg});
}
