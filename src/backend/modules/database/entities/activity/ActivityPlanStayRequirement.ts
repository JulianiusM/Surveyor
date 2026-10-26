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

import {Column, Entity, Index, JoinColumn, ManyToOne, RelationId} from "typeorm";
import {ParentEntityRelation} from "../abstract/BaseEntity";
import {NumericBase} from "../abstract/TrackedBase";
import {ActivityPlan} from "./ActivityPlan";

@Entity("activity_plan_stay_requirements", {schema: "surveyor"})
@Index("uk_activity_plan_stay_days", ["entity", "stayDays"], {unique: true})
export class ActivityPlanStayRequirement extends NumericBase implements ParentEntityRelation {
    @Column("smallint", {name: "stay_days"})
    stayDays!: number;

    @Column("smallint", {name: "required_shifts"})
    requiredShifts!: number;

    @RelationId((requirement: ActivityPlanStayRequirement) => requirement.entity)
    entityId!: string;

    @ManyToOne(() => ActivityPlan, {onDelete: "CASCADE", onUpdate: "CASCADE"})
    @JoinColumn([{name: "entity_id", referencedColumnName: "id"}])
    entity!: ActivityPlan;
}
