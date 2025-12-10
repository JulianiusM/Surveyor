import {EntityManager, In, Not} from "typeorm";
import type {PlanParticipant, PlanParticipantRow, SlotAssignmentMap} from "../../../types/ActivityTypes";
import {AssignmentCandidate} from "../../activity/availability";
import {toParticipantKey} from "../../activity/requirements";
import {generateUniqueId} from "../../lib/util";
import {AppDataSource} from "../dataSource";
import {ActivityAssignment} from "../entities/activity/ActivityAssignment";
import {ActivityAssignmentRole} from "../entities/activity/ActivityAssignmentRole";
import {ActivityPlan} from "../entities/activity/ActivityPlan";
import {ActivityRole} from "../entities/activity/ActivityRole";
import {ActivityPlanTextField} from "../entities/activity/ActivityPlanTextField";
import {ActivitySlot} from "../entities/activity/ActivitySlot";
import {ActivitySlotRole} from "../entities/activity/ActivitySlotRole";
import {ensureOneByObjectsAuthed} from "../utils/relation-upsert";
import * as entityAdminService from "./EntityAdminService";

// ─────────────────────────────────────────────────────────────────────────────
// Role & Assignment helpers
// ─────────────────────────────────────────────────────────────────────────────

export async function ensureRoleId(planId: string, roleNames: string[] | string, isDefault?: boolean, description?: string): Promise<ActivityRole[]> {
    return await AppDataSource.transaction(async (manager) => {
        const repo = manager.getRepository(ActivityRole);
        if (!Array.isArray(roleNames)) {
            roleNames = [roleNames];
        }
        const roles = await repo.findBy({name: In(roleNames), plan: {id: planId}});

        for (const name of roleNames) {
            if (roles.find(val => val.name === name)) continue;

            roles.push(repo.create({
                name: name,
                isDefault: isDefault === undefined ? name === "default" : isDefault,
                description: description,
                plan: {id: planId}
            }));
        }

        return await repo.save(roles);
    });
}

export async function ensureAssignment(
    slotId: string,
    userId?: number | null,
    guestId?: number | null
): Promise<number> {
    if (!slotId) throw new Error("slotId is required");

    const repo = AppDataSource.getRepository(ActivityAssignment);
    const planId = (
        await AppDataSource.getRepository(ActivitySlot).findOneOrFail({
            where: {id: slotId},
            relations: {plan: true},
            select: {id: true, plan: {id: true}},
        })
    ).plan.id;

    const entity = await ensureOneByObjectsAuthed(repo, {
        relations: {slot: slotId, plan: planId},
        // no extra scalar columns in this case
        party: {
            user: userId,
            guest: guestId,
        },
    });

    return entity.id;
}

export async function assignRole(assignmentId: number, roleName: string[] | string, manager?: EntityManager) {
    async function doAssign(manager: EntityManager): Promise<void> {
        const repo = manager.getRepository(ActivityAssignmentRole);
        const ass = await manager.getRepository(ActivityAssignment).findOneBy({id: assignmentId});
        if (!ass) throw new Error("assignment not found");

        const roles = await ensureRoleId(ass.planId, roleName);

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
        relations: {plan: true},
        select: {id: true, plan: {id: true}},
    });
    if (!assignment) return false;

    // Find role by name AND planId to avoid cross-plan conflicts
    const role = await AppDataSource.getRepository(ActivityRole).findOne({
        where: {name: roleName, plan: {id: assignment.plan.id}},
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
    return AppDataSource.getRepository(ActivityRole).findBy({plan: {id: planId}, name: Not("default")});
}

export async function updateRoleAssignments(slotId: string, assign: {
    assignmentId: number | null,
    role: string
}[]) {
    await AppDataSource.transaction(async (manager) => {
        const repo = manager.getRepository(ActivityAssignmentRole);
        const assRepo = manager.getRepository(ActivityAssignment);

        // 1. Get all assignments for this slot
        const assignments = await assRepo.find({
            where: {slot: {id: slotId}}, // relations ARE allowed in find()
            select: ["id"],
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
            const ass = await assRepo.findOneBy({id: part.assignmentId, slot: {id: slotId}});
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
    ownerId: number,
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
    ownerId: number,
    title: string,
    desc: string,
    startDate: string,
    endDate: string,
    slots: Partial<ActivitySlot>[],
    eventId?: string,
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
            ...(eventId !== undefined ? {event: {id: eventId}} : {}),
        });

        if (slots.length) {
            const slotEntities = slots.map((s) =>
                slotRepo.create({
                    id: generateUniqueId(),
                    plan: {id},
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
        relations: ['event'],
    });
}

export async function deleteActivityPlan(id: string) {
    await AppDataSource.getRepository(ActivityPlan).delete(id);
}

export async function getActivityPlansByUserId(userId: number) {
    return await AppDataSource.getRepository(ActivityPlan).find({
        where: {owner: {id: userId}},
        relations: ['event', 'owner'],
    });
}

export async function updateActivityPlanDescription(
    planId: string,
    description: string
) {
    await AppDataSource.getRepository(ActivityPlan).update(planId, {description});
}

export async function getActivityPlanTextFields(planId: string) {
    return await AppDataSource.getRepository(ActivityPlanTextField).find({
        where: {plan: {id: planId}},
        order: {createdAt: "ASC"},
    });
}

export async function getActivityPlanTextFieldById(id: string) {
    return await AppDataSource.getRepository(ActivityPlanTextField).findOne({
        where: {id},
        relations: ["plan"],
    });
}

export async function createActivityPlanTextField(planId: string, title: string, text: string) {
    const repo = AppDataSource.getRepository(ActivityPlanTextField);
    const field = repo.create({
        id: generateUniqueId(),
        plan: {id: planId},
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

export async function getManagedPlansForUser(userId: number) {
    const ids = await entityAdminService.getIdsForUser('activity', userId);
    const today = new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'
    return await AppDataSource.getRepository(ActivityPlan).find({
        where: [
            {
                owner: {id: userId},
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

export async function addActivitySlot(planId: string, slot: Partial<ActivitySlot>) {
    const repo = AppDataSource.getRepository(ActivitySlot);
    const slotEntity = repo.create({
        id: slot.id,
        plan: {id: planId},
        title: slot.title,
        description: slot.description,
        day: slot.day,
        pos: slot.pos,
        startTime: slot.startTime,
        endTime: slot.endTime,
        maxAssignees: slot.maxAssignees,
    });
    await repo.save(slotEntity);
}

export async function addActivitySlots(planId: string, slots: Partial<ActivitySlot>[]) {
    const repo = AppDataSource.getRepository(ActivitySlot);
    const slotEntities = slots.map((s) =>
        repo.create({
            id: s.id,
            plan: {id: planId},
            title: s.title,
            description: s.description,
            day: s.day,
            pos: s.pos,
            startTime: s.startTime,
            endTime: s.endTime,
            maxAssignees: s.maxAssignees,
        })
    );
    await repo.save(slotEntities);
}

export async function getActivitySlotsFlat(planId: string) {
    const repo = AppDataSource.getRepository(ActivitySlot);

    const slots = await repo
        .createQueryBuilder("s")
        //.leftJoin("s.assignments", "a", "a.planId = :planId", {planId})
        .loadRelationCountAndMap(
            "s.assignedCount",
            "s.activityAssignments",
            "a",
            (qb) => qb.where("a.plan_id = :planId", {planId})
        )
        .where("s.plan_id = :planId", {planId})
        .orderBy("s.day", "ASC")
        .addOrderBy("s.start_time IS NULL", "ASC")
        .addOrderBy("s.start_time", "ASC")
        .addOrderBy("s.pos", "ASC")
        .getMany(); // entities now have s.assignedCount

    // Type hint: (ActivitySlot & { assignedCount: number })[]
    // Group slots by day using reduce (Object.groupBy not available in Node.js 24)
    return slots as (ActivitySlot & { assignedCount: number })[];
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
            repo.update({id: o.slotId, plan: {id: planId},}, {pos: o.pos})
        )
    );
}

export async function getLastActivitySlotNumber(planId: string, date: string) {
    return await AppDataSource.getRepository(ActivitySlot).maximum("pos", {plan: {id: planId}, day: date}) ?? 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Role-based assignment wrappers
// ─────────────────────────────────────────────────────────────────────────────

export async function assignActivityAssignmentRoleToUser(
    slotId: string,
    userId: number,
    roleName = "default"
) {
    const assignmentId = await ensureAssignment(slotId, userId, undefined);
    await assignRole(assignmentId, roleName);
}

export async function assignActivityAssignmentRoleToGuest(
    slotId: string,
    guestId: number,
    roleName = "default"
) {
    const assignmentId = await ensureAssignment(slotId, undefined, guestId);
    await assignRole(assignmentId, roleName);
}

export async function unassignActivityAssignmentRoleFromUser(
    slotId: string,
    userId: number,
    roleName = "default"
) {
    const assignment = await AppDataSource.getRepository(ActivityAssignment).findOne({
        where: {slot: {id: slotId}, user: {id: userId}},
    });

    if (assignment) {
        await doUnassignRole(assignment.id, roleName);
    }
}

export async function unassignActivityAssignmentRoleFromGuest(
    slotId: string,
    guestId: number,
    roleName = "default"
) {
    const assignment = await AppDataSource.getRepository(ActivityAssignment).findOne({
        where: {slot: {id: slotId}, guest: {id: guestId}},
    });

    if (assignment) {
        await doUnassignRole(assignment.id, roleName);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Legacy Compatibility
// ─────────────────────────────────────────────────────────────────────────────

export const assignActivitySlotToUser = assignActivityAssignmentRoleToUser;
export const unassignActivitySlotUser = unassignActivityAssignmentRoleFromUser;
export const assignActivitySlotToGuest = assignActivityAssignmentRoleToGuest;
export const unassignActivitySlotGuest = unassignActivityAssignmentRoleFromGuest;

export async function getActivitySlotAssignmentsForUser(planId: string, userId: number) {
    const assignments = await AppDataSource.getRepository(ActivityAssignment).find({
        select: ["slot"],
        where: {plan: {id: planId}, user: {id: userId}},
        relations: ["slot"]
    });

    return assignments.map(a => a.slot.id);
}

export async function getActivitySlotAssignmentsForGuest(planId: string, guestId: number) {
    const assignments = await AppDataSource.getRepository(ActivityAssignment).find({
        select: ["slot"],
        where: {plan: {id: planId}, guest: {id: guestId}},
        relations: ["slot"]
    });

    return assignments.map(a => a.slot.id);
}

export async function getParticipantAssignmentsWithSlots(planId: string): Promise<Record<string, AssignmentCandidate[]>> {
    const repo = AppDataSource.getRepository(ActivityAssignment);
    const assignments = await repo.find({
        where: {plan: {id: planId}},
        relations: {slot: true, user: true, guest: true},
        select: {
            id: true,
            slot: {
                id: true,
                day: true,
                startTime: true,
                endTime: true,
                pos: true,
                isArrivalEvening: true,
                isDepartureMorning: true
            },
            user: {id: true},
            guest: {id: true},
        },
    });

    const map: Record<string, AssignmentCandidate[]> = {};
    for (const assignment of assignments) {
        const participantKey = toParticipantKey({userId: assignment.user?.id, guestId: assignment.guest?.id});
        if (!map[participantKey]) map[participantKey] = [];
        map[participantKey].push({
            id: assignment.slot.id,
            day: assignment.slot.day,
            startTime: assignment.slot.startTime,
            endTime: assignment.slot.endTime,
            pos: assignment.slot.pos,
            isArrivalEvening: assignment.slot.isArrivalEvening,
            isDepartureMorning: assignment.slot.isDepartureMorning,
        });
    }

    return map;
}

export async function getActivitySlotAssignmentById(assignId: number) {
    return await AppDataSource.getRepository(ActivityAssignment).findOne({
        where: {id: assignId},
        relations: ['slot']
    })
}

// ─────────────────────────────────────────────────────────────────────────────
// Aggregates
// ─────────────────────────────────────────────────────────────────────────────

export async function getActivitySlotAssignees(planId: string): Promise<SlotAssignmentMap> {
    const repo = AppDataSource.getRepository(ActivityAssignment);

    // Use QueryBuilder to avoid DISTINCT alias issues in MySQL/MariaDB when loading nested relations.
    const assignments = await AppDataSource.getRepository(ActivityAssignment)
        .createQueryBuilder('aa')
        .innerJoinAndSelect('aa.slot', 'slot')
        .leftJoinAndSelect('aa.user', 'user')
        .leftJoinAndSelect('aa.guest', 'guest')
        .leftJoinAndSelect('aa.activityAssignmentRoles', 'aar')
        .leftJoinAndSelect('aar.role', 'role')
        .where('aa.plan_id = :planId', {planId})
        .getMany();

    const map: SlotAssignmentMap = {};

    for (const assignment of assignments) {
        const slotId = assignment.slot.id;

        const name =
            assignment.user?.name ??
            assignment.user?.username ??
            assignment.guest?.username ??
            "—";

        const roles = assignment.activityAssignmentRoles.map(
            (ar) => ar.role.name
        );

        const assignee = {
            id: assignment.id,
            user_id: assignment.user?.id ?? null,
            guest_id: assignment.guest?.id ?? null,
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
        relations: ['event']
    });

    // Get assigned participants
    const qb = AppDataSource
        .getRepository(ActivityAssignment)
        .createQueryBuilder("aa")
        .leftJoin("aa.user", "user")
        .leftJoin("aa.guest", "guest")
        .leftJoin("aa.activityAssignmentRoles", "ar")
        .leftJoin("ar.role", "role")
        .where("aa.plan_id = :planId", {planId})
        .select([
            `COALESCE(user.name, user.username, guest.username) AS name`,
            `COUNT(DISTINCT aa.id) AS count`,
            `GROUP_CONCAT(DISTINCT role.name ORDER BY role.name) AS roles`
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
        const eventService = await import("./EventService");
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
            where: {plan: {id: planId}},
            relations: ['user', 'guest', 'activityAssignmentRoles', 'activityAssignmentRoles.role'],
        });

    const roleMap = new Map<string, Set<number>>();

    for (const assignment of assignments) {
        let participantKey: string | null = null;
        if (assignment.user?.id) {
            participantKey = `user:${assignment.user.id}`;
        } else if (assignment.guest?.id) {
            participantKey = `guest:${assignment.guest.id}`;
        }

        if (!participantKey) continue;

        if (!roleMap.has(participantKey)) {
            roleMap.set(participantKey, new Set());
        }

        for (const assignmentRole of assignment.activityAssignmentRoles || []) {
            if (assignmentRole.role?.id) {
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
        .innerJoinAndSelect('sr.slot', 'slot')
        .innerJoinAndSelect('sr.role', 'role')
        .innerJoin('slot.plan', 'plan')
        .where('plan.id = :planId', {planId});

    const slotRoles = await qb.getMany();

    const map: Record<string, { id: number; name: string }[]> = {};
    for (const sr of slotRoles) {
        const slotId = sr.slot.id;
        if (!map[slotId]) map[slotId] = [];
        map[slotId].push({id: sr.role.id, name: sr.role.name});
    }
    return map;
}


export async function addActivitySlotRoles(slotId: string, roles: number[]) {
    const repo = AppDataSource.getRepository(ActivitySlotRole);
    const entries = roles.map((roleId) =>
        repo.create({slot: {id: slotId}, role: {id: roleId}, maxQty: 1})
    );
    await repo.save(entries);
}

export async function updateActivitySlotRoles(slotId: string, roles: number[]) {
    await AppDataSource.transaction(async (manager) => {
        const repo = manager.getRepository(ActivitySlotRole);

        // 1. Get all roles for this slot
        const currentRoles = await repo.find({
            where: {slot: {id: slotId}}, // relations ARE allowed in find()
            select: ["id", "role"],
            relations: ["role"]
        });

        const toDelete = currentRoles.filter(r => !roles.includes(r.id));
        const toCreate = roles.filter(id => !currentRoles.map(r => r.roleId).includes(id))

        if (toDelete.length > 0) {
            await repo.remove(toDelete);
        }

        const newRoles: ActivitySlotRole[] = [];
        for (const roleId of toCreate) {
            newRoles.push(repo.create({slot: {id: slotId}, role: {id: roleId}, maxQty: 1}));
        }

        await repo.save(newRoles);
    });
}
