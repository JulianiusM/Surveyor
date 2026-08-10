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
import {EntityManager, In, MoreThanOrEqual} from 'typeorm';
import type {DIETARY, ParticipantRow} from "../../../types/EventTypes";
import {WithRequired} from "../../../types/UtilTypes";
import {ExpectedError} from "../../lib/errors";
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
import {registerForDefaultPools} from "./EventInvoiceService";

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
        },
        order: {startDate: 'ASC'},
    });
}

export async function getActiveManagedEvents(profileId: string) {
    const ids = await entityAdminService.getIds('event', profileId);
    const today = new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'
    return await AppDataSource.getRepository(Event).find({
        where: [
            {
                owner: {id: profileId},
                endDate: MoreThanOrEqual(today),
            },
            {
                id: In(ids),
                endDate: MoreThanOrEqual(today),
            }
        ],
        order: {startDate: 'ASC'},
    });
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
    bypass?: { ok: boolean, linkId?: string },
) {
    return await AppDataSource.transaction('READ COMMITTED', async (manager) => {
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
        if (bypass && bypass.ok && bypass.linkId) {
            const ok = await consumeDeadlineBypassToken(bypass.linkId, profileId);
            if (!ok) throw new ExpectedError('This link has already been used', 'error', 409);
        }
        await registerForDefaultPools(manager, reg)
        return reg.id;
    });
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
        name: r.profile.name || '—',
        email: r.profile.user?.email || r.profile.guest?.email || '—',
        arrivalDate: r.arrivalDate,
        departureDate: r.departureDate,
        dietaryChoices: r.dietaryChoices ?? null,
    }));
}

export async function deleteRegistrationFor(eventId: string, profileId: string) {
    const repo = AppDataSource.getRepository(EventRegistration);
    await repo.delete({event: {id: eventId}, profile: {id: profileId}});
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
    const repo = AppDataSource.getRepository(Event);
    return repo.find({
        where: {
            registrations: {
                profile: {id: profileId},
            }
        },
        relations: {
            registrations: true
        },
        order: {startDate: 'DESC'},
    });
}

export async function deleteRegistration(eventId: string, regId: string | number) {
    const repo = AppDataSource.getRepository(EventRegistration);

    // Only delete within the event scope
    const res = await repo.delete({id: Number(regId), event: {id: eventId}});
    return (res?.affected ?? 0) > 0;
}

export async function updateRegistrationDates(eventId: string, regId: number, arrivalDate: string, departureDate: string) {
    const repo = AppDataSource.getRepository(EventRegistration);
    const reg = await repo.findOne({where: {id: regId, event: {id: eventId}}});
    if (!reg) throw new ExpectedError('Registration not found', 'error', 404);
    reg.arrivalDate = arrivalDate;
    reg.departureDate = departureDate;
    await repo.save(reg);
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
        maxUses: Math.max(1, Number(opts?.maxUses ?? 1)),
        usedCount: 0,
        expiresAt: opts?.expiresAt ?? null,
    });
    await repo.save(row);
    return {id: row.id, token: row.token};
}

export async function listDeadlineBypassLinks(eventId: string) {
    const repo = AppDataSource.getRepository(EventRegBypassLink);
    const rows = await repo.find({where: {event: {id: eventId}}, order: {track: {createdAt: 'DESC'}}});
    return rows.map(r => ({
        id: r.id,
        token: r.token, // you may redact on the UI if preferred
        createdAt: r.track.createdAt,
        expiresAt: r.expiresAt,
        revokedAt: r.revokedAt,
        used: r.usedCount > 0 || !!r.usedAt,
        profileId: r.profileId,
        status: calculateBypassLinkStatus(r)
    }));
}

function calculateBypassLinkStatus(r: EventRegBypassLink) {
    if (r.revokedAt) {
        return 'revoked'
    } else if (r.expiresAt && r.expiresAt < now()) {
        return 'expired';
    } else if (r.usedCount >= r.maxUses) {
        return 'consumed';
    }
    return 'active';
}

export async function revokeDeadlineBypassLink(eventId: string, linkId: string) {
    const repo = AppDataSource.getRepository(EventRegBypassLink);
    await repo.update({id: linkId, event: {id: eventId}}, {revokedAt: now()});
}

export async function validateDeadlineBypassToken(eventId: string, token: string) {
    const repo = AppDataSource.getRepository(EventRegBypassLink);
    const row = await repo.findOne({where: {event: {id: eventId}, token}});
    if (!row) return null;
    if (row.revokedAt) return null;
    if (row.expiresAt && row.expiresAt < now()) return null;
    if (row.usedCount >= row.maxUses) return null;
    return row;
}

/**
 * Consume token in a race-safe way. Write who used it.
 * Returns true if consumed; false otherwise.
 */
export async function consumeDeadlineBypassToken(
    linkId: string,
    profileId: string
): Promise<boolean> {
    return await AppDataSource.transaction(async (manager) => {
        const repo = manager.getRepository(EventRegBypassLink);
        // SELECT ... FOR UPDATE could be used as well; here we use an atomic UPDATE condition.
        const res = await repo.createQueryBuilder()
            .update(EventRegBypassLink)
            .set({
                usedCount: () => 'used_count + 1',
                profile: {id: profileId},
                usedAt: () => 'CURRENT_TIMESTAMP',
            })
            .where('id = :id', {id: linkId})
            .andWhere('revoked_at IS NULL')
            .andWhere('(expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)')
            .andWhere('used_count < max_uses')
            .execute();

        return (res.affected ?? 0) > 0;
    });
}

/** Helper used by registration to decide deadline enforcement */
export async function canBypassDeadlineWithToken(
    eventId: string,
    token?: string | null
): Promise<{ ok: boolean; linkId?: string }> {
    if (!token) return {ok: false};
    const row = await validateDeadlineBypassToken(eventId, token);
    if (!row) return {ok: false};
    return {ok: true, linkId: row.id};
}

export async function updateHeaderImage(eventId: string, headerImg?: string | null) {
    await AppDataSource.getRepository(Event).update(eventId, {headerImg});
}