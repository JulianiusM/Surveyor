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

import {Entity, JoinColumn, ManyToOne, OneToMany, RelationId,} from "typeorm";
import {DefaultNumericEntityItemAssignment} from "../abstract/ProfileEntityItemAssignment";
import {ActivityAssignmentRole} from "./ActivityAssignmentRole";
import {ActivityPlan} from "./ActivityPlan";
import {ActivitySlot} from "./ActivitySlot";

@Entity("activity_assignments", {schema: "surveyor"})
export class ActivityAssignment extends DefaultNumericEntityItemAssignment {
    @OneToMany(
        () => ActivityAssignmentRole,
        (activityAssignmentRoles) => activityAssignmentRoles.assignment
    )
    activityAssignmentRoles: ActivityAssignmentRole[];

    @RelationId((a: ActivityAssignment) => a.item)
    itemId!: string;

    @ManyToOne(
        () => ActivitySlot,
        {onDelete: "CASCADE", onUpdate: "CASCADE"}
    )
    @JoinColumn([{name: "item_id", referencedColumnName: "id"}])
    item!: ActivitySlot;

    @RelationId((a: ActivityAssignment) => a.entity)
    entityId!: string;

    @ManyToOne(
        () => ActivityPlan,
        {onDelete: "CASCADE", onUpdate: "CASCADE"}
    )
    @JoinColumn([{name: "entity_id", referencedColumnName: "id"}])
    entity!: ActivityPlan;
}
