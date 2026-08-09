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

import {EntitySubscriberInterface, EventSubscriber, InsertEvent} from "typeorm";
import {ActivityAssignment} from "../entities/activity/ActivityAssignment";
import {ActivityAssignmentRole} from "../entities/activity/ActivityAssignmentRole";
import {ActivitySlotRole} from "../entities/activity/ActivitySlotRole";

/**
 * Enforces slot-role capacity before inserting ActivityAssignmentRole.
 * Robust against RelationId fields not being present in beforeInsert.
 */
@EventSubscriber()
export class ActivityAssignmentRolesSubscriber
    implements EntitySubscriberInterface<ActivityAssignmentRole> {

    listenTo() {
        return ActivityAssignmentRole;
    }

    async beforeInsert(event: InsertEvent<ActivityAssignmentRole>) {
        const {entity, manager} = event;
        if (!entity) return;

        // RelationId fields may be undefined in beforeInsert; fall back to relation object ids.
        const assignmentId = entity.assignmentId ?? entity.assignment?.id;
        const roleId = entity.roleId ?? entity.role?.id;

        if (!assignmentId) {
            throw new Error("ActivityAssignmentRole.beforeInsert: missing assignmentId");
        }
        if (!roleId) {
            throw new Error("ActivityAssignmentRole.beforeInsert: missing roleId");
        }

        // Step 1: Fetch the assignment to obtain slot_id (flat query, no nested relations)
        const assignment = await manager
            .getRepository(ActivityAssignment)
            .createQueryBuilder("aa")
            .select(["aa.id", "aa.item_id"])
            .where("aa.id = :id", {id: assignmentId})
            .getOne();

        if (!assignment) {
            throw new Error("Assignment not found");
        }

        const slotId = assignment.itemId;

        // Step 2: Fetch slot-role capacity for this (slot, role); avoid nested relation in WHERE
        const slotRole = await manager
            .getRepository(ActivitySlotRole)
            .createQueryBuilder("sr")
            .select(["sr.id", "sr.max_qty"])
            .where("sr.item_id = :slotId AND sr.role_id = :roleId", {slotId, roleId})
            .getOne();

        // Step 3: Count how many times this role is already assigned in the same slot
        const currentCount = await manager
            .createQueryBuilder(ActivityAssignmentRole, "ar")
            .innerJoin(ActivityAssignment, "aa", "aa.id = ar.assignment_id")
            .where("aa.item_id = :slotId", {slotId})
            .andWhere("ar.role_id = :roleId", {roleId})
            .getCount();

        // Only enforce when a slotRole row exists and max_qty is set
        if (slotRole?.maxQty != null && currentCount >= slotRole.maxQty) {
            throw new Error("Role capacity reached for this slot");
        }
    }
}
