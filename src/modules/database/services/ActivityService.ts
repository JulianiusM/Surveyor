import {AppDataSource} from "../dataSource";
import {ActivityPlan} from "../entities/activity/ActivityPlan";
import {ActivitySlot} from "../entities/activity/ActivitySlot";
import {ActivityAssignment} from "../entities/activity/ActivityAssignment";
import {ActivityAssignmentRole} from "../entities/activity/ActivityAssignmentRole";
import {Role} from "../entities/user/Role";
import {generateUniqueId} from "../../lib/util";
import {ActivitySlotRole} from "../entities/activity/ActivitySlotRole";
import {PlanParticipant, PlanParticipantRow, SlotAssignmentMap} from "../../../types/ActivityTypes";

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
    userId: number | null = null,
    guestId: number | null = null
): Promise<number> {
    if (!slotId) throw new Error("slotId is required");

    const repo = AppDataSource.getRepository(ActivityAssignment);
    const planId = (
        await AppDataSource.getRepository(ActivitySlot).findOneOrFail({
            where: {id: slotId},
            select: ["planId"],
        })
    ).planId;

    const where = {
        slotId,
        planId,
        userId: userId ?? undefined,
        guestId: guestId ?? undefined,
    };

    let assignment = await repo.findOne({where});

    if (!assignment) {
        assignment = repo.create(where);
        await repo.save(assignment);
    }

    return assignment.id;
}

export async function assignRole(assignmentId: number, roleName: string) {
    const roleId = await ensureRoleId(roleName);
    const repo = AppDataSource.getRepository(ActivityAssignmentRole);

    const exists = await repo.findOne({where: {assignmentId, roleId}});
    if (!exists) {
        const role = repo.create({assignmentId, roleId});
        await repo.save(role);
    }
}

export async function doUnassignRole(assignmentId: number, roleName: string) {
    const role = await AppDataSource.getRepository(Role).findOne({
        where: {name: roleName},
    });
    if (!role) return false;

    const aarRepo = AppDataSource.getRepository(ActivityAssignmentRole);
    await aarRepo.delete({assignmentId, roleId: role.id});

    const remaining = await aarRepo.count({where: {assignmentId}});

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
    allowGuestAdd: boolean,
    guestManage: boolean
) {
    const repo = AppDataSource.getRepository(ActivityPlan);
    const plan = repo.create({
        id,
        ownerId,
        title,
        description: desc,
        startDate,
        endDate,
        allowGuestAdd,
        guestManage,
    });
    await repo.save(plan);
}

export async function createActivityPlanTx(
    ownerId: number,
    title: string,
    desc: string,
    startDate: string,
    endDate: string,
    allowGuestAdd: boolean,
    guestManage: boolean,
    slots: any[]
) {
    return await AppDataSource.transaction(async (manager) => {
        const id = generateUniqueId();
        const planRepo = manager.getRepository(ActivityPlan);
        const slotRepo = manager.getRepository(ActivitySlot);

        await planRepo.insert({
            id,
            ownerId,
            title,
            description: desc,
            startDate,
            endDate,
            allowGuestAdd,
            guestManage,
        });

        if (slots.length) {
            const slotEntities = slots.map((s) =>
                slotRepo.create({
                    id: generateUniqueId(),
                    planId: id,
                    title: s.title,
                    description: s.description,
                    day: s.date,
                    pos: s.position,
                    maxAssignees: s.maxAssignees,
                })
            );
            await slotRepo.save(slotEntities);
        }

        return id;
    });
}

export async function getActivityPlanById(id: string) {
    return await AppDataSource.getRepository(ActivityPlan).findOne({where: {id}});
}

export async function deleteActivityPlan(id: string) {
    await AppDataSource.getRepository(ActivityPlan).delete(id);
}

export async function updateActivityPlanFlags(
    planId: string,
    allowAdd: boolean,
    guestManage: boolean
) {
    await AppDataSource.getRepository(ActivityPlan).update(planId, {
        allowGuestAdd: allowAdd,
        guestManage,
    });
}

export async function getActivityPlansByUserId(userId: number) {
    return await AppDataSource.getRepository(ActivityPlan).find({
        where: {ownerId: userId},
    });
}

export async function updateActivityPlanDescription(
    planId: string,
    description: string
) {
    await AppDataSource.getRepository(ActivityPlan).update(planId, {description});
}

// ─────────────────────────────────────────────────────────────────────────────
// Slot CRUD
// ─────────────────────────────────────────────────────────────────────────────

export async function addActivitySlot(planId: string, slot: Partial<ActivitySlot>) {
    const repo = AppDataSource.getRepository(ActivitySlot);
    const slotEntity = repo.create({
        id: slot.id,
        planId,
        title: slot.title,
        description: slot.description,
        day: slot.day,
        pos: slot.pos,
        maxAssignees: slot.maxAssignees,
    });
    await repo.save(slotEntity);
}

export async function addActivitySlots(planId: string, slots: any[]) {
    const repo = AppDataSource.getRepository(ActivitySlot);
    const slotEntities = slots.map((s) =>
        repo.create({
            id: s.id,
            planId,
            title: s.title,
            description: s.description,
            day: s.date,
            pos: s.position,
            maxAssignees: s.maxAssignees,
        })
    );
    await repo.save(slotEntities);
}

export async function getActivitySlots(planId: string) {
    const repo = AppDataSource.getRepository(ActivitySlot);

    const slots = await repo
        .createQueryBuilder("s")
        .leftJoinAndSelect(
            (qb) =>
                qb
                    .from(ActivityAssignment, "a")
                    .select("a.slotId", "slotId")
                    .addSelect("COUNT(*)", "cnt")
                    .where("a.planId = :planId", {planId})
                    .groupBy("a.slotId"),
            "ac",
            "ac.slotId = s.id"
        )
        .where("s.planId = :planId", {planId})
        .orderBy("s.pos", "ASC")
        .getRawMany();

    slots.forEach((s) => {
        s.date = s.day;
        s.position = s.pos;
        s.assigned_count = Number(s.cnt) || 0;
    });

    return Object.groupBy(slots, (s) => s.date);
}

export async function updateActivitySlot(slotId: string, fields: any) {
    const repo = AppDataSource.getRepository(ActivitySlot);

    // Build partial update object conditionally
    const updateData: Partial<ActivitySlot> = {};

    if (fields.title !== undefined) updateData.title = fields.title;
    if (fields.description !== undefined) updateData.description = fields.description;
    if (fields.maxAssignees !== undefined) updateData.maxAssignees = fields.maxAssignees;
    if (fields.position !== undefined) updateData.pos = fields.position;

    if (Object.keys(updateData).length === 0) return;

    const result = await repo.update(slotId, updateData);
    return result.affected === 1;
}

export async function deleteActivitySlot(slotId: string) {
    await AppDataSource.getRepository(ActivitySlot).delete(slotId);
}

export async function reorderActivitySlots(planId: string, order: any[]) {
    const repo = AppDataSource.getRepository(ActivitySlot);
    await Promise.all(
        order.map((o) =>
            repo.update({id: o.slotId, planId}, {pos: o.position})
        )
    );
}

export async function getLastActivitySlotNumber(planId: string, date: string) {
    const res = await AppDataSource.getRepository(ActivitySlot)
        .createQueryBuilder("s")
        .select("MAX(s.pos)", "max")
        .where("s.planId = :planId AND s.day = :day", {planId, day: date})
        .getRawOne();
    return res?.max ?? 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Role-based assignment wrappers
// ─────────────────────────────────────────────────────────────────────────────

export async function assignActivityAssignmentRoleToUser(
    slotId: string,
    userId: number,
    roleName = "default"
) {
    const assignmentId = await ensureAssignment(slotId, userId, null);
    await assignRole(assignmentId, roleName);
}

export async function assignActivityAssignmentRoleToGuest(
    slotId: string,
    guestId: number,
    roleName = "default"
) {
    const assignmentId = await ensureAssignment(slotId, null, guestId);
    await assignRole(assignmentId, roleName);
}

export async function unassignActivityAssignmentRoleFromUser(
    slotId: string,
    userId: number,
    roleName = "default"
) {
    const assignment = await AppDataSource.getRepository(ActivityAssignment).findOne({
        where: {slotId, userId},
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
        where: {slotId, guestId},
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
        select: ["slotId"],
        where: {planId, userId}
    });

    return assignments.map(a => a.slotId);
}

export async function getActivitySlotAssignmentsForGuest(planId: string, guestId: number) {
    const assignments = await AppDataSource.getRepository(ActivityAssignment).find({
        select: ["slotId"],
        where: {planId, guestId}
    });

    return assignments.map(a => a.slotId);
}

// ─────────────────────────────────────────────────────────────────────────────
// Aggregates
// ─────────────────────────────────────────────────────────────────────────────

export async function getActivitySlotAssignees(planId: string): Promise<SlotAssignmentMap> {
    const qb = AppDataSource
        .getRepository(ActivityAssignment)
        .createQueryBuilder("aa")
        .leftJoinAndSelect("aa.user", "user")
        .leftJoinAndSelect("aa.guest", "guest")
        .leftJoinAndSelect("aa.activityAssignmentRoles", "ar")
        .leftJoinAndSelect("ar.role", "role")
        .where("aa.planId = :planId", {planId});

    const assignments = await qb.getMany();

    const map: SlotAssignmentMap = {};

    for (const assignment of assignments) {
        const slotId = (assignment as any).slotId; // or assignment.slot?.id if relation loaded

        const name =
            assignment.user?.username ??
            assignment.guest?.username ??
            "—";

        const roles = assignment.activityAssignmentRoles.map((ar) => ar.role.name);

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
        .where("aa.planId = :planId", {planId})
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
    const rows = await AppDataSource.query(
        `SELECT sl.slot_id as slot_id,
                r.id       as role_id,
                r.name     as role_name
         FROM activity_slot_role sl
                  JOIN activity_slots slots ON slots.id = sl.slot_id
                  JOIN roles r ON r.id = sl.role_id
         WHERE slots.plan_id = ?`,
        [planId]
    );

    const map: any = {};
    rows.forEach((r: any) => {
        if (!map[r.slot_id]) map[r.slot_id] = [];
        map[r.slot_id].push({id: r.role_id, name: r.role_name});
    });

    return map;
}

export async function addActivitySlotRoles(slotId: string, roles: number[]) {
    const repo = AppDataSource.getRepository(ActivitySlotRole);
    const entries = roles.map((roleId) =>
        repo.create({slotId, roleId, maxQty: 1})
    );
    await repo.save(entries);
}
