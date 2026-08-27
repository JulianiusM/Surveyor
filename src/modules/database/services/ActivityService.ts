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
import type {PlanParticipant, PlanParticipantRow, SlotAssignmentMap} from "../../../types/ActivityTypes";
import {AssignmentCandidate} from "../../activity/availability";
import {toParticipantKey} from "../../activity/requirements";
import {APIError} from "../../lib/errors";
import {generateUniqueId} from "../../lib/util";
import {AppDataSource} from "../dataSource";
import {ActivityAssignment} from "../entities/activity/ActivityAssignment";
import {ActivityAssignmentRole} from "../entities/activity/ActivityAssignmentRole";
import {ActivityPlan} from "../entities/activity/ActivityPlan";
import {ActivityPlanTextField} from "../entities/activity/ActivityPlanTextField";
import {ActivityRole} from "../entities/activity/ActivityRole";
import {ActivitySlot} from "../entities/activity/ActivitySlot";
import {ActivitySlotRole} from "../entities/activity/ActivitySlotRole";
import * as entityAdminService from "./EntityAdminService";
import * as eventService from "./EventService";

// ─────────────────────────────────────────────────────────────────────────────
// Role & Assignment helpers
// ─────────────────────────────────────────────────────────────────────────────

export async function ensureRoleId(planId: string, roleNames: string[] | string, isDefault?: boolean, description?: string): Promise<ActivityRole[]> {
    return await AppDataSource.transaction(async (manager) => {
        const repo = manager.getRepository(ActivityRole);
        if (!Array.isArray(roleNames)) {
            roleNames = [roleNames];
        }
        const roles = await repo.findBy({title: In(roleNames), entity: {id: planId}});

        for (const name of roleNames) {
            if (roles.some(val => val.title === name)) continue;

            roles.push(repo.create({
                title: name,
                isDefault: isDefault ?? name === "default",
                description: description,
                entity: {id: planId}
            }));
        }

        return await repo.save(roles);
    });
}

export async function ensureAssignment(
    itemId: string,
    profileId: string
): Promise<number> {
    if (!itemId) throw new Error("itemId is required");

    const repo = AppDataSource.getRepository(ActivityAssignment);
    const planId = (
        await AppDataSource.getRepository(ActivitySlot).findOneOrFail({
            where: {id: itemId},
            relations: {entity: true},
            select: {id: true, entity: {id: true}},
        })
    ).entity.id;

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

export async function assignRole(assignmentId: number, roleName: string[] | string, manager?: EntityManager) {
    async function doAssign(manager: EntityManager): Promise<void> {
        const repo = manager.getRepository(ActivityAssignmentRole);
        const ass = await manager.getRepository(ActivityAssignment).findOneBy({id: assignmentId});
        if (!ass) throw new Error("assignment not found");

        const roles = await ensureRoleId(ass.entityId, roleName);

        const newRoles: ActivityAssignmentRole[] = [];
        for (const role of roles) {
            const exists = await repo
                .createQueryBuilder('aar')
                .where('aar.assignment_id = :aid AND aar.role_id = :rid', {aid: assignmentId, rid: role.id})
                .getExists();

            if (!exists) {
                newRoles.push(repo.create({assignment: {id: assignmentId}, role: {id: role.id}}));
            }
        }
        await repo.save(newRoles);
    }

    if (manager) return await doAssign(manager);
    return AppDataSource.transaction(doAssign);
}

export async function doUnassignRole(assignmentId: number, roleName: string) {
    // Get assignment to find planId
    const assignment = await AppDataSource.getRepository(ActivityAssignment).findOne({
        where: {id: assignmentId},
        relations: {entity: true},
        select: {id: true, entity: {id: true}},
    });
    if (!assignment) return false;

    // Find role by name AND planId to avoid cross-plan conflicts
    const role = await AppDataSource.getRepository(ActivityRole).findOne({
        where: {title: roleName, entity: {id: assignment.entity.id}},
    });
    if (!role) return false;

    const aarRepo = AppDataSource.getRepository(ActivityAssignmentRole);
    await aarRepo.delete({assignment: {id: assignmentId}, role: {id: role.id}});

    const remaining = await aarRepo.count({where: {assignment: {id: assignmentId}}});

    if (remaining === 0 || roleName === "default") {
        await AppDataSource.getRepository(ActivityAssignment).delete(assignmentId);
    }

    return true;
}

export async function getAllRoles(planId: string) {
    return AppDataSource.getRepository(ActivityRole).findBy({entity: {id: planId}, title: Not("default")});
}

export async function updateRoleAssignments(slotId: string, assign: {
    assignmentId: number | null,
    role: string
}[]) {
    await AppDataSource.transaction(async (manager) => {
        const repo = manager.getRepository(ActivityAssignmentRole);
        const assRepo = manager.getRepository(ActivityAssignment);
        const configuredRoles = await manager.getRepository(ActivitySlotRole).find({
            where: {item: {id: slotId}},
            relations: {role: true},
        });
        const roleLimits = new Map(configuredRoles.map((slotRole) => [slotRole.role.title, slotRole.maxQty ?? 0]));
        const requestedCounts = new Map<string, number>();
        for (const entry of assign) {
            if (!entry.assignmentId || entry.role === "default") continue;
            const maxQty = roleLimits.get(entry.role);
            if (maxQty == null) {
                throw new APIError('Activity role is not available for this slot', {slotId, role: entry.role}, 400);
            }
            const requestedCount = (requestedCounts.get(entry.role) ?? 0) + 1;
            if (requestedCount > maxQty) {
                throw new APIError('This activity role is already full', {slotId, role: entry.role}, 409);
            }
            requestedCounts.set(entry.role, requestedCount);
        }

        // 1. Get all assignments for this slot
        const assignments = await assRepo.find({
            where: {item: {id: slotId}}, // relations ARE allowed in find()
            select: {
                id: true
            },
        });

        const assignmentIds = assignments.map(a => a.id);
        if (assignmentIds.length === 0) {
            // nothing to delete
            return;
        }

        // 2. Delete all roles for those assignments
        await repo.delete({assignment: {id: In(assignmentIds)}});

        for (const part of assign) {
            if (!part.assignmentId) continue;
            const ass = await assRepo.findOneBy({id: part.assignmentId, item: {id: slotId}});
            if (!ass) throw new Error("Assignment not found");
            await assignRole(part.assignmentId, part.role, manager);
        }
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Plan CRUD
// ─────────────────────────────────────────────────────────────────────────────

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

export async function getActivityPlanById(id: string) {
    return await AppDataSource.getRepository(ActivityPlan).findOne({
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
    return await AppDataSource.getRepository(ActivityPlan).createQueryBuilder('plan')
        .whereExists(AppDataSource.getRepository(ActivityAssignment)
            .createQueryBuilder("ass")
            .where("ass.entity_id = plan.id")
            .andWhere("ass.profile_id = :profileId", {profileId: profileId})
        ).getMany();
}

export async function updateActivityPlanDescription(
    planId: string,
    description: string
) {
    await AppDataSource.getRepository(ActivityPlan).update(planId, {description});
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
    const ids = await entityAdminService.getIds('activity', profileId);
    return await AppDataSource.getRepository(ActivityPlan).find({
        where: [
            {
                owner: {id: profileId},
            },
            {
                id: In(ids),
            }
        ],
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Slot CRUD
// ─────────────────────────────────────────────────────────────────────────────

export async function addActivitySlot(planId: string, slot: Partial<ActivitySlot>, profileId: string) {
    const repo = AppDataSource.getRepository(ActivitySlot);
    const slotEntity = repo.create({
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
    });
    await repo.save(slotEntity);
}

export async function addActivitySlots(planId: string, slots: Partial<ActivitySlot>[], profileId: string) {
    const repo = AppDataSource.getRepository(ActivitySlot);
    const slotEntities = slots.map((s) =>
        repo.create({
            id: s.id,
            entity: {id: planId},
            title: s.title,
            description: s.description,
            day: s.day,
            pos: s.pos,
            startTime: s.startTime,
            endTime: s.endTime,
            maxAssignees: s.maxAssignees,
            profile: {id: profileId},
        })
    );
    await repo.save(slotEntities);
}

export async function getActivitySlotsFlat(planId: string) {
    const repo = AppDataSource.getRepository(ActivitySlot);

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

export async function getActivitySlotById(slotId: string) {
    return await AppDataSource.getRepository(ActivitySlot).findOneBy({id: slotId});
}

export async function updateActivitySlot(slotId: string, fields: Partial<ActivitySlot>) {
    const repo = AppDataSource.getRepository(ActivitySlot);

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

export async function assignActivityAssignmentRole(
    itemId: string,
    profileId: string,
    roleName = "default"
) {
    await AppDataSource.transaction(async (manager) => {
        const slot = await manager.getRepository(ActivitySlot).findOne({
            where: {id: itemId},
            lock: {mode: 'pessimistic_write'},
        });
        if (!slot) throw new APIError('Activity slot not found', {itemId}, 404);

        const plan = await manager.getRepository(ActivityPlan).findOne({
            where: {id: slot.entityId},
            lock: {mode: 'pessimistic_write'},
        });
        if (!plan) throw new APIError('Activity plan not found', {itemId}, 404);

        const assignmentRepo = manager.getRepository(ActivityAssignment);
        let assignment = await assignmentRepo.findOneBy({
            item: {id: itemId},
            profile: {id: profileId},
        });

        if (!assignment) {
            if (!plan.allowOverfillAfterFull && typeof slot.maxAssignees === 'number') {
                const assignedCount = await assignmentRepo.countBy({item: {id: itemId}});
                if (assignedCount >= slot.maxAssignees) {
                    throw new APIError('This activity slot is already full', {itemId}, 409);
                }
            }
            assignment = await assignmentRepo.save(assignmentRepo.create({
                item: {id: itemId},
                entity: {id: plan.id},
                profile: {id: profileId},
            }));
        }

        const roleRepo = manager.getRepository(ActivityRole);
        let role = await roleRepo.findOneBy({title: roleName, entity: {id: plan.id}});
        if (!role) {
            if (roleName !== 'default') {
                throw new APIError('Activity role is not available for this plan', {itemId, roleName}, 400);
            }
            role = await roleRepo.save(roleRepo.create({
                title: 'default',
                isDefault: true,
                entity: {id: plan.id},
            }));
        }

        const assignmentRoleRepo = manager.getRepository(ActivityAssignmentRole);
        const existingRole = await assignmentRoleRepo.findOneBy({
            assignment: {id: assignment.id},
            role: {id: role.id},
        });
        if (existingRole) return;

        if (roleName !== 'default') {
            const slotRole = await manager.getRepository(ActivitySlotRole).findOne({
                where: {item: {id: itemId}, role: {id: role.id}},
                lock: {mode: 'pessimistic_write'},
            });
            if (!slotRole) {
                throw new APIError('Activity role is not available for this slot', {itemId, roleName}, 400);
            }

            // Overfill applies to the slot's participant capacity only. Named role
            // quotas remain hard constraints because roles are assigned manually.
            if (typeof slotRole.maxQty === 'number') {
                const roleCount = await assignmentRoleRepo
                    .createQueryBuilder('assignmentRole')
                    .innerJoin('assignmentRole.assignment', 'assignment')
                    .where('assignment.item_id = :itemId', {itemId})
                    .andWhere('assignmentRole.role_id = :roleId', {roleId: role.id})
                    .getCount();
                if (roleCount >= slotRole.maxQty) {
                    throw new APIError('This activity role is already full', {itemId, roleName}, 409);
                }
            }
        }

        await assignmentRoleRepo.save(assignmentRoleRepo.create({
            assignment: {id: assignment.id},
            role: {id: role.id},
        }));
    });
}

export async function unassignActivityAssignmentRole(
    itemId: string,
    profileId: string,
    roleName = "default"
) {
    const assignment = await AppDataSource.getRepository(ActivityAssignment).findOne({
        where: {item: {id: itemId}, profile: {id: profileId}},
    });

    if (assignment) {
        await doUnassignRole(assignment.id, roleName);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Legacy Compatibility
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

export async function getParticipantAssignmentsWithSlots(planId: string): Promise<Record<string, AssignmentCandidate[]>> {
    const repo = AppDataSource.getRepository(ActivityAssignment);
    const assignments = await repo.find({
        where: {entity: {id: planId}},
        relations: {item: true, profile: true},
        select: {
            id: true,
            item: {
                id: true,
                day: true,
                startTime: true,
                endTime: true,
                pos: true,
                isArrivalEvening: true,
                isDepartureMorning: true
            },
            profile: true,
        },
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

export async function getActivitySlotAssignees(planId: string): Promise<SlotAssignmentMap> {
    // Use QueryBuilder to avoid DISTINCT alias issues in MySQL/MariaDB when loading nested relations.
    const assignments = await AppDataSource.getRepository(ActivityAssignment)
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

export async function getParticipantRolesForPlan(planId: string): Promise<{
    participantKey: string;
    roleIds: number[]
}[]> {
    const assignments = await AppDataSource
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

export async function deleteActivitySlotAssignment(assignId: number) {
    return await AppDataSource.getRepository(ActivityAssignment).delete(assignId);
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
