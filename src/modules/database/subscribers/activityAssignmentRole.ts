import {EntitySubscriberInterface, EventSubscriber, InsertEvent,} from "typeorm";
import {ActivityAssignmentRole} from "../entities/activity/ActivityAssignmentRole";
import {ActivityAssignment} from "../entities/activity/ActivityAssignment";
import {ActivitySlotRole} from "../entities/activity/ActivitySlotRole";

@EventSubscriber()
export class ActivityAssignmentRolesSubscriber
    implements EntitySubscriberInterface<ActivityAssignmentRole> {

    listenTo() {
        return ActivityAssignmentRole;
    }

    async beforeInsert(event: InsertEvent<ActivityAssignmentRole>) {
        const {entity, manager} = event;

        // Step 1: Get slot_id from assignment
        const assignment = await manager.findOne(ActivityAssignment, {
            where: {id: entity.assignmentId},
            select: ["slotId"],
        });

        if (!assignment) {
            throw new Error(`Assignment with ID ${entity.assignmentId} not found`);
        }

        const slotId = assignment.slotId;

        // Step 2: Get max_qty for the role in this slot
        const slotRole = await manager.findOne(ActivitySlotRole, {
            where: {
                slotId: slotId,
                roleId: entity.roleId,
            },
            select: ["maxQty"],
        });

        // No cap means insert is allowed
        if (!slotRole || slotRole.maxQty === null) return;

        // Step 3: Count how many times this role is already assigned in the slot
        const currentCount = await manager
            .createQueryBuilder(ActivityAssignmentRole, "ar")
            .innerJoin(ActivityAssignment, "aa", "aa.id = ar.assignmentId")
            .where("aa.slotId = :slotId", {slotId})
            .andWhere("ar.roleId = :roleId", {roleId: entity.roleId})
            .getCount();

        if (currentCount >= slotRole.maxQty) {
            throw new Error("Role capacity reached for this slot");
        }
    }
}
