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

import {Column, Entity, JoinColumn, ManyToOne, RelationId, Unique} from "typeorm";
import {ParentItemRelation} from "../abstract/BaseEntity";
import {NumericBase} from "../abstract/TrackedBase";
import {ActivityRole} from "./ActivityRole";
import {ActivitySlot} from "./ActivitySlot";

@Unique("unique_act_slot_role_map", ["item", "role"])
@Entity("activity_slot_role", {schema: "surveyor"})
export class ActivitySlotRole extends NumericBase implements ParentItemRelation {
    @Column("smallint", {name: "max_qty"})
    maxQty?: number;

    @RelationId((a: ActivitySlotRole) => a.item)
    itemId!: string;

    @ManyToOne(
        () => ActivitySlot,
        (activitySlots) => activitySlots.activitySlotRoles,
        {onDelete: "CASCADE", onUpdate: "CASCADE"}
    )
    @JoinColumn([{name: "item_id", referencedColumnName: "id"}])
    item!: ActivitySlot;

    @RelationId((a: ActivitySlotRole) => a.role)
    roleId!: number;

    @ManyToOne(() => ActivityRole, {
        onDelete: "RESTRICT",
        onUpdate: "CASCADE",
    })
    @JoinColumn([{name: "role_id", referencedColumnName: "id"}])
    role!: ActivityRole;
}
