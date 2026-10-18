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

import {EntityManager, In, Not} from "typeorm";
import type {ActivityPropertyPatch, PlanParticipant, PlanParticipantRow, SlotAssignmentMap} from "../../../types/ActivityTypes";
import {AssignmentCandidate} from "../../activity/availability";
import {toParticipantKey} from "../../activity/requirements";
import {generateUniqueId} from "../../lib/util";
import {AppDataSource} from "../dataSource";
import {ActivityAssignment} from "../entities/activity/ActivityAssignment";
import {ActivityAssignmentRole} from "../entities/activity/ActivityAssignmentRole";
import {ActivityPlan} from "../entities/activity/ActivityPlan";
import {ActivityPlanTextField} from "../entities/activity/ActivityPlanTextField";
import {ActivityRole} from "../entities/activity/ActivityRole";
import {ActivitySlot} from "../entities/activity/ActivitySlot";
import {ActivitySlotRole} from "../entities/activity/ActivitySlotRole";
import {EventRegistration} from "../entities/event/EventRegistration";
import {Event} from '../entities/event/Event';
import {ActivityAssignmentRecommendation} from '../entities/activity/ActivityAssignmentRecommendation';
import * as entityAdminService from "./EntityAdminService";
import * as eventService from "./EventService";

/**
 * Transaction ownership stays at the database boundary; the named callback belongs to
 * the controller and performs decisions between these reads and writes. A supplied manager
 * must be reused by every operation so validation never observes a different transaction.
 */
export async function withActivityTransaction<T>(work: (manager: EntityManager) => Promise<T>): Promise<T> {
    // Discovery before a lock wait must not pin a repeatable-read snapshot of the old event.
    return AppDataSource.transaction('READ COMMITTED', work);
}

/** A calculation is assembled from one snapshot; workers receive plain values after this read ends. */
export async function withActivityReadSnapshot<T>(work: (manager: EntityManager) => Promise<T>): Promise<T> {
    return AppDataSource.transaction('REPEATABLE READ', work);
}

/**
 * Serialize linked-plan writers through their event before acquiring child locks, matching
 * event reassociation's parent-before-child order. Lock sibling roots and commitment rows too:
 * ordinary repository deletion remains simple and waits on these same database row locks.
 * A changed discovery relationship is returned for the controller to reject, never interpreted here.
 */
export async function lockActivityContext(manager: EntityManager, planId: string) {
    const repo = manager.getRepository(ActivityPlan);
    const initial = await repo.findOneBy({id: planId});
    const initialEventId = initial?.eventId ?? null;
    let planIds = [planId];
    if (initialEventId) {
        await manager.getRepository(Event).findOne({where: {id: initialEventId}, lock: {mode: 'pessimistic_write'}});
        const siblings = await repo.find({
            where: {event: {id: initialEventId}}, order: {id: 'ASC'}, lock: {mode: 'pessimistic_write'},
        });
        planIds = [...new Set([planId, ...siblings.map((plan) => plan.id)])].sort();
    }
    const plan = await lockActivityPlan(manager, planId);
    // Rejecting a concurrent reassociation is the controller's responsibility. Avoid taking
    // locks in its new event before that decision, which would invert the parent lock order.
    if (plan && (plan.eventId ?? null) === initialEventId) {
        await manager.getRepository(ActivitySlot).find({
            where: {entity: {id: In(planIds)}}, select: {id: true}, order: {id: 'ASC'}, lock: {mode: 'pessimistic_write'},
        });
        await manager.getRepository(ActivityAssignment).find({
            where: {entity: {id: In(planIds)}}, select: {id: true}, order: {id: 'ASC'}, lock: {mode: 'pessimistic_write'},
        });
        await manager.getRepository(ActivityAssignmentRecommendation).find({
            where: {entity: {id: In(planIds)}}, select: {id: true}, order: {id: 'ASC'}, lock: {mode: 'pessimistic_write'},
        });
        if (initialEventId) {
            await manager.getRepository(EventRegistration).find({
                where: {event: {id: initialEventId}}, select: {id: true}, order: {id: 'ASC'}, lock: {mode: 'pessimistic_write'},
            });
        }
    }
    return {initialEventId, plan};
}

/** Membership is the saved event relationship, independent of archival or personal overview placement. */
export async function getLinkedActivityPlans(eventId: string, planId: string, manager: EntityManager = AppDataSource.manager) {
    return manager.getRepository(ActivityPlan).find({
        where: {event: {id: eventId}, id: Not(planId)}, order: {id: 'ASC'},
    });
}

/** Batched assignment data for controller-owned collision projections; no eligibility decisions. */
export async function getAssignmentsForPlans(planIds: string[], manager: EntityManager = AppDataSource.manager) {
    if (!planIds.length) return [];
    return manager.getRepository(ActivityAssignment).find({
        where: {entity: {id: In(planIds)}}, relations: {item: true, profile: true}, order: {id: 'ASC'},
    });
}

/** Root-before-slot lock order is shared with entity relinking and activity date edits. */
export async function lockActivityPlan(manager: EntityManager, planId: string): Promise<ActivityPlan | null> {
    return manager.getRepository(ActivityPlan).findOne({where: {id: planId}, lock: {mode: 'pessimistic_write'}});
}

/** Lock the requested child rows after their plan root; absence is returned for controller interpretation. */
export async function getLockedActivitySlots(manager: EntityManager, ids: string[]): Promise<ActivitySlot[]> {
    if (!ids.length) return [];
    return manager.getRepository(ActivitySlot).find({where: {id: In(ids)}, lock: {mode: 'pessimistic_write'}});
}

/** Read locked signup/role snapshots so capacity and reassignment decisions share one transaction. */
export async function getLockedPlanAssignments(manager: EntityManager, planId: string, itemId?: string): Promise<ActivityAssignment[]> {
    return manager.getRepository(ActivityAssignment).find({
        where: {entity: {id: planId}, ...(itemId ? {item: {id: itemId}} : {})},
        relations: {item: true, profile: true, activityAssignmentRoles: {role: true}},
        lock: {mode: 'pessimistic_write'},
    });
}

/** Return membership data for the event selected from the locked plan, without deciding eligibility. */
export async function getRegisteredProfileIds(manager: EntityManager, eventId: string): Promise<string[]> {
    const registrations = await manager.getRepository(EventRegistration).findBy({event: {id: eventId}});
    return registrations.map((registration) => registration.profileId);
}

/** Load configured role limits under the already-held root/slot locks. */
export async function getConfiguredSlotRoles(manager: EntityManager, slotId: string): Promise<ActivitySlotRole[]> {
    return manager.getRepository(ActivitySlotRole).find({
        where: {item: {id: slotId}}, relations: {role: true}, lock: {mode: 'pessimistic_write'},
    });
}

/** Return a nullable role lookup; callers decide whether a missing role can be created. */
export async function getActivityRoleByName(manager: EntityManager, planId: string, title: string): Promise<ActivityRole | null> {
    return manager.getRepository(ActivityRole).findOneBy({entity: {id: planId}, title});
}

/** Insert the validated assignment/role link; uniqueness and foreign keys remain database constraints. */
export async function saveActivityAssignmentRole(
    manager: EntityManager, planId: string, itemId: string, profileId: string, roleId: number, assignmentId?: number,
): Promise<void> {
    if (assignmentId === undefined) {
        const repo = manager.getRepository(ActivityAssignment);
        const assignment = await repo.save(repo.create({entity: {id: planId}, item: {id: itemId}, profile: {id: profileId}}));
        assignmentId = assignment.id;
    }
    const roleRepo = manager.getRepository(ActivityAssignmentRole);
    await roleRepo.save(roleRepo.create({assignment: {id: assignmentId}, role: {id: roleId}}));
}

/** Apply the controller's complete write set without interpreting recommendation rules. */
export async function writeAssignmentChanges(
    manager: EntityManager, planId: string, removals: number[], additions: {itemId: string; profileId: string; roleId: number}[],
): Promise<void> {
    if (removals.length) await manager.getRepository(ActivityAssignment).delete(removals);
    if (!additions.length) return;
    for (const addition of additions) {
        await saveActivityAssignmentRole(manager, planId, addition.itemId, addition.profileId, addition.roleId);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Role & Assignment helpers
// ─────────────────────────────────────────────────────────────────────────────

export async function ensureRoleId(planId: string, roleNames: string[] | string, isDefault?: boolean, description?: string, manager?: EntityManager): Promise<ActivityRole[]> {
    async function persistRoles(manager: EntityManager): Promise<ActivityRole[]> {
        const repo = manager.getRepository(ActivityRole);
        if (!Array.isArray(roleNames)) {
            roleNames = [roleNames];
        }
        const roles = await repo.findBy({title: In(roleNames), entity: {id: planId}});

        for (const name of roleNames) {
            if (roles.some(val => val.title === name)) continue;

            roles.push(repo.create({
                title: name,
                isDefault: isDefault ?? false,
                description: description,
                entity: {id: planId}
            }));
        }

        return await repo.save(roles);
    }
    return manager ? persistRoles(manager) : AppDataSource.transaction(persistRoles);
}

export async function ensureAssignment(
    itemId: string,
    profileId: string
): Promise<number | null> {
    const repo = AppDataSource.getRepository(ActivityAssignment);
    const slot = await AppDataSource.getRepository(ActivitySlot).findOne({
            where: {id: itemId},
            relations: {entity: true},
            select: {id: true, entity: {id: true}},
        });
    if (!slot) return null;
    const planId = slot.entity.id;

    let ass = await repo.findOneBy({
        item: {id: itemId},
        profile: {id: profileId}
    });

    if (ass) {
        return ass.id;
    }

    ass = repo.create({item: {id: itemId}, entity: {id: planId}, profile: {id: profileId}});

    return (await repo.save(ass)).id
}

export async function getAllRoles(planId: string, manager: EntityManager = AppDataSource.manager) {
    return manager.getRepository(ActivityRole).findBy({entity: {id: planId}, title: Not("default")});
}

/** Replace the supplied assignments' role links with a controller-validated set of IDs. */
export async function replaceActivityAssignmentRoles(
    manager: EntityManager, assignmentIds: number[], entries: {assignmentId: number; roleId: number}[],
): Promise<void> {
    const repo = manager.getRepository(ActivityAssignmentRole);
    if (assignmentIds.length) await repo.delete({assignment: {id: In(assignmentIds)}});
    const rows = entries.map((entry) => repo.create({assignment: {id: entry.assignmentId}, role: {id: entry.roleId}}));
    if (rows.length) await repo.save(rows);
}

export async function createActivityPlan(
    id: string,
    ownerId: string,
    title: string,
    desc: string,
    startDate: string,
    endDate: string,
    eventId?: string,
) {
    const repo = AppDataSource.getRepository(ActivityPlan);
    const plan = repo.create({
        id,
        owner: {id: ownerId},
        title,
        description: desc,
        startDate,
        endDate,
        ...(eventId !== undefined ? {event: {id: eventId}} : {}),
    });
    await repo.save(plan);
}

export async function createActivityPlanTx(
    ownerId: string,
    title: string,
    desc: string,
    startDate: string,
    endDate: string,
    slots: Partial<ActivitySlot>[],
    eventId?: string,
    headerImg?: string | null,
) {
    return await AppDataSource.transaction(async (manager) => {
        const id = generateUniqueId();
        const planRepo = manager.getRepository(ActivityPlan);
        const slotRepo = manager.getRepository(ActivitySlot);

        await planRepo.insert({
            id,
            owner: {id: ownerId},
            title,
            description: desc,
            startDate,
            endDate,
            headerImg,
            ...(eventId !== undefined ? {event: {id: eventId}} : {}),
        });

        if (slots.length) {
            const slotEntities = slots.map((s) =>
                slotRepo.create({
                    id: generateUniqueId(),
                    entity: {id: id},
                    title: s.title,
                    description: s.description,
                    day: s.day,
                    pos: s.pos,
                    startTime: s.startTime,
                    endTime: s.endTime,
                    maxAssignees: s.maxAssignees,
                })
            );
            await slotRepo.save(slotEntities);
        }

        return id;
    });
}

export async function getActivityPlanById(id: string, manager: EntityManager = AppDataSource.manager) {
    return await manager.getRepository(ActivityPlan).findOne({
        where: {id},
        relations: {
            event: true
        },
    });
}

export async function deleteActivityPlan(id: string) {
    await AppDataSource.getRepository(ActivityPlan).delete(id);
}

export async function getActivityPlansByProfileId(profileId: string) {
    return await AppDataSource.getRepository(ActivityPlan).find({
        where: {owner: {id: profileId}},
        relations: {
            event: true,
            owner: true
        },
    });
}

export async function getActivityPlansByParticipant(profileId: string) {
    return getActivityParticipationQuery(profileId).getMany();
}

/**
 * Build the existing assignment-based participation query without executing it.
 * Overview discovery loads every matching plan; personal visibility adds one plan ID
 * and checks existence using its transaction manager. Sharing this predicate keeps
 * those two entry points consistent without loading an entire overview for a write.
 */
export function getActivityParticipationQuery(profileId: string, manager: EntityManager = AppDataSource.manager) {
    // EXISTS returns each plan once even when the profile has several assignments.
    return manager.getRepository(ActivityPlan).createQueryBuilder('plan')
        .whereExists(manager.getRepository(ActivityAssignment)
            .createQueryBuilder("ass")
            .where("ass.entity_id = plan.id")
            .andWhere("ass.profile_id = :profileId", {profileId: profileId})
        );
}

export async function updateActivityPlanDescription(
    planId: string,
    description: string
) {
    await updateActivityPlanProperties(planId, {description});
}

/** Persist an already validated root-property patch in the caller's transaction. */
export async function updateActivityPlanProperties(
    planId: string,
    patch: ActivityPropertyPatch,
    manager: EntityManager = AppDataSource.manager,
): Promise<void> {
    await manager.getRepository(ActivityPlan).update(planId, patch);
}

/** Read only: the controller decides whether an excluded slot makes a proposed range invalid. */
export async function hasActivitySlotsOutsideRange(
    manager: EntityManager, planId: string, startDate: string, endDate: string,
): Promise<boolean> {
    return manager.getRepository(ActivitySlot).createQueryBuilder('slot')
        .where('slot.entity_id = :planId', {planId})
        .andWhere('(slot.day < :startDate OR slot.day > :endDate)', {startDate, endDate})
        .getExists();
}

export async function getActivityPlanTextFields(planId: string) {
    return await AppDataSource.getRepository(ActivityPlanTextField).find({
        where: {entity: {id: planId}},
        order: {track: {createdAt: "ASC"}},
    });
}

export async function getActivityPlanTextFieldById(id: string) {
    return await AppDataSource.getRepository(ActivityPlanTextField).findOne({
        where: {id},
        relations: {
            entity: true
        },
    });
}

export async function createActivityPlanTextField(planId: string, title: string, text: string) {
    const repo = AppDataSource.getRepository(ActivityPlanTextField);
    const field = repo.create({
        id: generateUniqueId(),
        entity: {id: planId},
        title,
        text,
    });
    await repo.save(field);
    return field;
}

export async function updateActivityPlanTextField(id: string, text: string, title?: string) {
    const repo = AppDataSource.getRepository(ActivityPlanTextField);
    const updates: Partial<ActivityPlanTextField> = {text};
    if (title !== undefined) updates.title = title;
    await repo.update(id, updates);
}

export async function deleteActivityPlanTextField(id: string) {
    await AppDataSource.getRepository(ActivityPlanTextField).delete(id);
}

export async function updateHeaderImage(id: string, headerImg?: string | null) {
    await AppDataSource.getRepository(ActivityPlan).update(id, {headerImg});
}

export async function getManagedPlans(profileId: string) {
    // Ownership and explicit administration assignments define overview membership.
    // The permission engine separately decides which actions each member may perform.
    return entityAdminService.createManagedEntityQuery(AppDataSource.getRepository(ActivityPlan), 'activity', profileId).getMany();
}

// ─────────────────────────────────────────────────────────────────────────────
// Slot CRUD
// ─────────────────────────────────────────────────────────────────────────────

export async function addActivitySlot(planId: string, slot: Partial<ActivitySlot>, profileId: string) {
    await addActivitySlots(planId, [slot], profileId);
}

export async function addActivitySlots(planId: string, slots: Partial<ActivitySlot>[], profileId: string, manager?: EntityManager) {
    async function saveSlots(manager: EntityManager): Promise<void> {
        const repo = manager.getRepository(ActivitySlot);
        const slotEntities: ActivitySlot[] = [];
        for (const slot of slots) {
            slotEntities.push(repo.create({
                id: slot.id,
                entity: {id: planId},
                title: slot.title,
                description: slot.description,
                day: slot.day,
                pos: slot.pos,
                startTime: slot.startTime,
                endTime: slot.endTime,
                maxAssignees: slot.maxAssignees,
                profile: {id: profileId},
            }));
        }
        await repo.save(slotEntities);
    }
    if (manager) await saveSlots(manager);
    else await AppDataSource.transaction(saveSlots);
}

export async function getActivitySlotsFlat(planId: string, manager: EntityManager = AppDataSource.manager) {
    const repo = manager.getRepository(ActivitySlot);

    const {entities: slots, raw} = await repo
        .createQueryBuilder("s")
        //.leftJoin("s.assignments", "a", "a.planId = :planId", {planId})
        .addSelect((qb) =>
                qb.select("COUNT(*)")
                    .from("activity_assignments", "a")
                    .where("a.item_id = s.id"),
            "assignedCount"
        )
        .where("s.entity_id = :planId", {planId})
        .orderBy("s.day", "ASC")
        .addOrderBy("s.start_time IS NULL", "ASC")
        .addOrderBy("s.start_time", "ASC")
        .addOrderBy("s.pos", "ASC")
        .getRawAndEntities(); // entities now have s.assignedCount

    // Type hint: (ActivitySlot & { assignedCount: number })[]
    // Group slots by day using reduce (Object.groupBy not available in Node.js 24)
    return slots.map((slot, i) => ({
        ...slot,
        assignedCount: Number(raw[i].assignedCount),
    })) as (ActivitySlot & { assignedCount: number })[];
}

export async function getActivitySlots(planId: string) {
    // Type hint: (ActivitySlot & { assignedCount: number })[]
    // Group slots by day using reduce (Object.groupBy not available in Node.js 24)
    const typedSlots = await getActivitySlotsFlat(planId);
    const grouped: Record<string, (ActivitySlot & { assignedCount: number })[]> = {};

    for (const slot of typedSlots) {
        const day = slot.day;
        if (!grouped[day]) {
            grouped[day] = [];
        }
        grouped[day].push(slot);
    }

    return grouped;
}

export async function getActivitySlotById(slotId: string, manager: EntityManager = AppDataSource.manager) {
    return await manager.getRepository(ActivitySlot).findOneBy({id: slotId});
}

export async function updateActivitySlot(slotId: string, fields: Partial<ActivitySlot>, manager: EntityManager = AppDataSource.manager) {
    const repo = manager.getRepository(ActivitySlot);

    // Build partial update object conditionally
    const updateData: Partial<ActivitySlot> = {};

    if (fields.title !== undefined) updateData.title = fields.title;
    if (fields.description !== undefined) updateData.description = fields.description;
    if (fields.maxAssignees !== undefined) updateData.maxAssignees = fields.maxAssignees;
    if (fields.pos !== undefined) updateData.pos = fields.pos;
    if (fields.startTime !== undefined) updateData.startTime = fields.startTime;
    if (fields.endTime !== undefined) updateData.endTime = fields.endTime;
    if (fields.day !== undefined) updateData.day = fields.day;

    if (Object.keys(updateData).length === 0) return;

    const result = await repo.update(slotId, updateData);
    return result.affected === 1;
}

export async function deleteActivitySlot(slotId: string) {
    await AppDataSource.getRepository(ActivitySlot).delete(slotId);
}

export async function reorderActivitySlots(planId: string, order: { slotId: string, pos: number }[]) {
    const repo = AppDataSource.getRepository(ActivitySlot);
    await Promise.all(
        order.map((o) =>
            repo.update({id: o.slotId, entity: {id: planId},}, {pos: o.pos})
        )
    );
}

export async function getLastActivitySlotNumber(planId: string, date: string) {
    return (await AppDataSource.getRepository(ActivitySlot).maximum("pos", {
        entity: {id: planId},
        day: date
    })) ?? 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Role-based assignment wrappers
// ─────────────────────────────────────────────────────────────────────────────

export async function getActivitySlotAssignments(planId: string, profileId: string) {
    const assignments = await AppDataSource.getRepository(ActivityAssignment).find({
        select: {
            item: true
        },
        where: {entity: {id: planId}, profile: {id: profileId}},
        relations: {
            item: true
        }
    });

    return assignments.map(a => a.item.id);
}

export async function getParticipantAssignmentsWithSlots(planId: string, manager: EntityManager = AppDataSource.manager): Promise<Record<string, AssignmentCandidate[]>> {
    const repo = manager.getRepository(ActivityAssignment);
    const assignments = await repo.find({
        where: {entity: {id: planId}},
        relations: {item: true, profile: true, activityAssignmentRoles: {role: true}},
    });

    const map: Record<string, AssignmentCandidate[]> = {};
    for (const assignment of assignments) {
        const participantKey = toParticipantKey({profileId: assignment.profile.id});
        if (!map[participantKey]) map[participantKey] = [];
        map[participantKey].push({
            id: assignment.item.id,
            day: assignment.item.day,
            startTime: assignment.item.startTime,
            endTime: assignment.item.endTime,
            pos: assignment.item.pos,
            isArrivalEvening: assignment.item.isArrivalEvening,
            isDepartureMorning: assignment.item.isDepartureMorning,
            hasNamedRole: assignment.activityAssignmentRoles.some(({role}) => !role.isDefault),
        });
    }

    return map;
}

export async function getActivitySlotAssignmentById(assignId: number) {
    return await AppDataSource.getRepository(ActivityAssignment).findOne({
        where: {id: assignId},
        relations: {
            item: true
        }
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Aggregates
// ─────────────────────────────────────────────────────────────────────────────

export async function getActivitySlotAssignees(planId: string, manager: EntityManager = AppDataSource.manager): Promise<SlotAssignmentMap> {
    // Use QueryBuilder to avoid DISTINCT alias issues in MySQL/MariaDB when loading nested relations.
    const assignments = await manager.getRepository(ActivityAssignment)
        .createQueryBuilder('aa')
        .innerJoinAndSelect('aa.item', 'slot')
        .leftJoinAndSelect('aa.profile', 'profile')
        .leftJoinAndSelect('aa.activityAssignmentRoles', 'aar')
        .leftJoinAndSelect('aar.role', 'role')
        .where('aa.entity_id = :planId', {planId})
        .getMany();

    const map: SlotAssignmentMap = {};

    for (const assignment of assignments) {
        const slotId = assignment.item.id;

        const name = assignment.profile.name ?? "—";

        const roles = assignment.activityAssignmentRoles.map(
            (ar) => ar.role.title
        );

        const assignee = {
            id: assignment.id,
            profileId: assignment.profile.id,
            name,
            roles,
        };

        if (!map[slotId]) map[slotId] = [];
        map[slotId].push(assignee);
    }

    return map;
}

export async function getActivityPlanParticipants(planId: string): Promise<PlanParticipant[]> {
    const plan = await AppDataSource.getRepository(ActivityPlan).findOne({
        where: {id: planId},
        relations: {
            event: true
        }
    });

    // Get assigned participants
    const qb = AppDataSource
        .getRepository(ActivityAssignment)
        .createQueryBuilder("aa")
        .leftJoin("aa.profile", "profile")
        .leftJoin("aa.activityAssignmentRoles", "ar")
        .leftJoin("ar.role", "role")
        .where("aa.entity_id = :planId", {planId})
        .select([
            `profile.name AS name`,
            `COUNT(DISTINCT aa.id) AS count`,
            `GROUP_CONCAT(DISTINCT role.title ORDER BY role.title) AS roles`
        ])
        .groupBy("name");

    const assignedRaw: PlanParticipantRow[] = await qb.getRawMany();
    const participantMap = new Map<string, PlanParticipant>();

    // Add assigned participants to map
    for (const r of assignedRaw) {
        participantMap.set(r.name, {
            name: r.name,
            count: Number(r.count),
            roles: r.roles ? r.roles.split(",") : [],
        });
    }

    // If plan is associated with an event, also include all event participants
    if (plan?.event?.id) {
        const eventParticipants = await eventService.getEventParticipants(plan.event.id);

        for (const ep of eventParticipants) {
            const name = ep.name || 'Unknown';
            if (!participantMap.has(name)) {
                // Add event participant who hasn't been assigned yet
                participantMap.set(name, {
                    name,
                    count: 0,
                    roles: [],
                });
            }
        }
    }

    return Array.from(participantMap.values());
}

export async function getParticipantRolesForPlan(planId: string, manager: EntityManager = AppDataSource.manager): Promise<{
    participantKey: string;
    roleIds: number[]
}[]> {
    const assignments = await manager
        .getRepository(ActivityAssignment)
        .find({
            where: {entity: {id: planId}},
            relations: {
                profile: true,

                activityAssignmentRoles: {
                    role: true
                }
            },
        });

    const roleMap = new Map<string, Set<number>>();

    for (const assignment of assignments) {
        let participantKey: string | null = null;
        if (assignment.profile?.id) {
            participantKey = `profile:${assignment.profile.id}`;
        }

        if (!participantKey) continue;

        if (!roleMap.has(participantKey)) {
            roleMap.set(participantKey, new Set());
        }

        for (const assignmentRole of assignment.activityAssignmentRoles || []) {
            if (assignmentRole.role?.id && !assignmentRole.role.isDefault) {
                roleMap.get(participantKey)!.add(Number(assignmentRole.role.id));
            }
        }
    }

    return Array.from(roleMap.entries()).map(([participantKey, roleIds]) => ({
        participantKey,
        roleIds: Array.from(roleIds),
    }));
}

export async function deleteActivitySlotAssignment(assignId: number, manager: EntityManager = AppDataSource.manager) {
    return await manager.getRepository(ActivityAssignment).delete(assignId);
}

export async function getActivitySlotRoles(planId: string) {
    // Avoid TypeORM's DISTINCT subquery on MySQL/MariaDB that can mis-alias primary keys
    // when using Repository.find with nested relations. Use an explicit QueryBuilder instead.
    const qb = AppDataSource.getRepository(ActivitySlotRole)
        .createQueryBuilder('sr')
        .innerJoinAndSelect('sr.item', 'slot')
        .innerJoinAndSelect('sr.role', 'role')
        .innerJoin('slot.entity', 'plan')
        .where('plan.id = :planId', {planId});

    const slotRoles = await qb.getMany();

    const assignedRows: Array<{slotId: string; roleId: string; assignedQty: string}> = await AppDataSource
        .getRepository(ActivityAssignmentRole)
        .createQueryBuilder('assignmentRole')
        .innerJoin('assignmentRole.assignment', 'assignment')
        .innerJoin('assignment.item', 'slot')
        .innerJoin('assignmentRole.role', 'assignedRole')
        .where('assignment.entity_id = :planId', {planId})
        .andWhere('assignedRole.is_default = :isDefault', {isDefault: false})
        .select('slot.id', 'slotId')
        .addSelect('assignedRole.id', 'roleId')
        .addSelect('COUNT(DISTINCT assignment.id)', 'assignedQty')
        .groupBy('slot.id')
        .addGroupBy('assignedRole.id')
        .getRawMany();
    const assignedBySlotRole = new Map(
        assignedRows.map((row) => [`${row.slotId}:${row.roleId}`, Number(row.assignedQty)]),
    );

    const map: Record<string, { id: number; name: string; maxQty: number; assignedQty: number }[]> = {};
    for (const sr of slotRoles) {
        const slotId = sr.item.id;
        if (!map[slotId]) map[slotId] = [];
        map[slotId].push({
            id: sr.role.id,
            name: sr.role.title,
            maxQty: sr.maxQty ?? 0,
            assignedQty: assignedBySlotRole.get(`${slotId}:${sr.role.id}`) ?? 0,
        });
    }
    return map;
}


export async function addActivitySlotRoles(slotId: string, roles: number[]) {
    const repo = AppDataSource.getRepository(ActivitySlotRole);
    const entries = roles.map((roleId) =>
        repo.create({item: {id: slotId}, role: {id: roleId}, maxQty: 1})
    );
    await repo.save(entries);
}

export async function updateActivitySlotRoles(slotId: string, roles: number[]) {
    await AppDataSource.transaction(async (manager) => {
        const repo = manager.getRepository(ActivitySlotRole);

        // 1. Get all roles for this slot
        const currentRoles = await repo.find({
            where: {item: {id: slotId}}, // relations ARE allowed in find()
            select: {
                id: true,
                role: true
            },
            relations: {
                role: true
            }
        });

        const toDelete = currentRoles.filter(r => !roles.includes(r.id));
        const toCreate = roles.filter(id => !currentRoles.map(r => r.roleId).includes(id))

        if (toDelete.length > 0) {
            await repo.remove(toDelete);
        }

        const newRoles: ActivitySlotRole[] = [];
        for (const roleId of toCreate) {
            newRoles.push(repo.create({item: {id: slotId}, role: {id: roleId}, maxQty: 1}));
        }

        await repo.save(newRoles);
    });
}

/** Delete one already selected role link without deciding whether its signup should survive. */
export async function deleteActivityAssignmentRole(manager: EntityManager, id: number): Promise<void> {
    await manager.getRepository(ActivityAssignmentRole).delete(id);
}
