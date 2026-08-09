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

import {Entity, JoinColumn, ManyToOne, RelationId, Unique} from "typeorm";
import {NumericBase} from "../abstract/TrackedBase";
import {ActivityAssignment} from "./ActivityAssignment";
import {ActivityRole} from "./ActivityRole";

@Unique("unique_act_ass_role_map", ["assignment", "role"])
@Entity("activity_assignment_roles", {schema: "surveyor"})
export class ActivityAssignmentRole extends NumericBase {
    @RelationId((aa: ActivityAssignmentRole) => aa.assignment)
    assignmentId!: number;

    @ManyToOne(
        () => ActivityAssignment,
        (activityAssignments) => activityAssignments.activityAssignmentRoles,
        {onDelete: "CASCADE", onUpdate: "CASCADE"}
    )
    @JoinColumn([{name: "assignment_id", referencedColumnName: "id"}])
    assignment!: ActivityAssignment;

    @RelationId((aa: ActivityAssignmentRole) => aa.role)
    roleId!: number;

    @ManyToOne(() => ActivityRole, {
        onDelete: "RESTRICT",
        onUpdate: "CASCADE",
    })
    @JoinColumn([{name: "role_id", referencedColumnName: "id"}])
    role!: ActivityRole;
}
