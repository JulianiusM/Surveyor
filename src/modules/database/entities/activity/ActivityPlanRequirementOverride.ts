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

import {Column, Entity, Index, JoinColumn, ManyToOne, RelationId,} from "typeorm";
import {NumericProfileBase} from "../abstract/Base";
import {ParentEntityRelation} from "../abstract/BaseEntity";
import {ActivityPlan} from "./ActivityPlan";
import {ActivityRole} from "./ActivityRole";

@Entity("activity_plan_requirement_overrides", {schema: "surveyor"})
@Index("uk_plan_participant_role", ["entity", "profile", "role"], {unique: true})
export class ActivityPlanRequirementOverride extends NumericProfileBase implements ParentEntityRelation {
    @Column("smallint", {name: "required_shifts"})
    requiredShifts!: number;

    @RelationId((a: ActivityPlanRequirementOverride) => a.entity)
    entityId!: string;

    @ManyToOne(
        () => ActivityPlan,
        {onDelete: "CASCADE", onUpdate: "CASCADE"}
    )
    @JoinColumn([{name: "entity_id", referencedColumnName: "id"}])
    entity!: ActivityPlan;

    @RelationId((override: ActivityPlanRequirementOverride) => override.role)
    roleId?: number | null;

    @ManyToOne(() => ActivityRole, {
        onDelete: "RESTRICT",
        onUpdate: "CASCADE",
        nullable: true,
    })
    @JoinColumn([{name: "role_id", referencedColumnName: "id"}])
    role?: ActivityRole | null;
}
