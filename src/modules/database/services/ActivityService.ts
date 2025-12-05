import {AppDataSource} from "../dataSource";
import {ActivityPlan} from "../entities/activity/ActivityPlan";
import {ActivitySlot} from "../entities/activity/ActivitySlot";
import {ActivityAssignment} from "../entities/activity/ActivityAssignment";
import {ActivityAssignmentRole} from "../entities/activity/ActivityAssignmentRole";
import {Role} from "../entities/user/Role";
import {generateUniqueId} from "../../lib/util";
import {ActivitySlotRole} from "../entities/activity/ActivitySlotRole";
import type {PlanParticipant, PlanParticipantRow, SlotAssignmentMap} from "../../../types/ActivityTypes";
import {ensureOneByObjectsAuthed} from "../utils/relation-upsert";
import * as entityAdminService from "./EntityAdminService";
import {In} from "typeorm";

// ─────────────────────────────────────────────────────────────────────────────
// Role & Assignment helpers
// ─────────────────────────────────────────────────────────────────────────────

export async function ensureRoleId(roleName = "default"): Promise<number> {
    const repo = AppDataSource.getRepository(Role);
    const role = await repo.findOne({where: {name: roleName}});
    if (role) return role.id;

    const newRole = repo.create({
        name: roleName,
        isDefault: roleName === "default",
    });
    const saved = await repo.save(newRole);
    return saved.id;
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

export async function assignRole(assignmentId: number, roleName: string) {
    const roleId = await ensureRoleId(roleName);
    const repo = AppDataSource.getRepository(ActivityAssignmentRole);

    const exists = await repo
        .createQueryBuilder('aar')
        .where('aar.assignment_id = :aid AND aar.role_id = :rid', {aid: assignmentId, rid: roleId})
        .getExists();

    if (!exists) {
        const role = repo.create({assignment: {id: assignmentId}, role: {id: roleId}});
        await repo.save(role);
    }
}

export async function doUnassignRole(assignmentId: number, roleName: string) {
    const role = await AppDataSource.getRepository(Role).findOne({
        where: {name: roleName},
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
    const qb = AppDataSource
        .getRepository(ActivityAssignment)
        .createQueryBuilder("aa")
        .leftJoin("aa.user", "user")
        .leftJoin("aa.guest", "guest")
        .leftJoin("aa.activityAssignmentRoles", "ar")
        .leftJoin("ar.role", "role")
        .where("aa.plan_id = :planId", {planId})
        .select([
            `COALESCE(user.username, guest.username) AS name`,
            `COUNT(DISTINCT aa.id) AS count`,
            `GROUP_CONCAT(DISTINCT role.name ORDER BY role.name) AS roles`
        ])
        .groupBy("name");

    const raw: PlanParticipantRow[] = await qb.getRawMany();

    return raw.map((r) => ({
        name: r.name,
        count: Number(r.count),
        roles: r.roles ? r.roles.split(",") : [],
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
