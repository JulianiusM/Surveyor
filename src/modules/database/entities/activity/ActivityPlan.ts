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

import {Column, Entity, JoinColumn, ManyToOne, OneToMany, RelationId,} from "typeorm";
import {DefaultEntity} from "../abstract/BaseEntity";
import {Event} from "../event/Event";
import {ActivityAssignment} from "./ActivityAssignment";
import {ActivityAssignmentRecommendation} from "./ActivityAssignmentRecommendation";
import {ActivityPlanRequirement} from "./ActivityPlanRequirement";
import {ActivityPlanRequirementOverride} from "./ActivityPlanRequirementOverride";
import {ActivityPlanStayRequirement} from "./ActivityPlanStayRequirement";
import {ActivityPlanTextField} from "./ActivityPlanTextField";
import {ActivityRole} from "./ActivityRole";
import {ActivitySlot} from "./ActivitySlot";

@Entity("activity_plans", {schema: "surveyor"})
export class ActivityPlan extends DefaultEntity {
    @Column("date", {name: "start_date"})
    startDate!: string;

    @Column("date", {name: "end_date"})
    endDate!: string;

    @Column('simple-enum', {name: 'assignment_mode', enum: ['FREE', 'REQUIRED'], default: 'FREE'})
    assignmentMode!: 'FREE' | 'REQUIRED';

    @Column('smallint', {name: 'general_required_shifts', nullable: true})
    generalRequiredShifts?: number | null;

    @Column("tinyint", {
        name: "allow_overfill_after_full",
        default: () => 0
    })
    allowOverfillAfterFull!: boolean;

    @Column("tinyint", {
        name: "allow_external_assignees",
        default: () => 0
    })
    allowExternalAssignees!: boolean;

    @Column('simple-enum', {name: 'rounding_mode', enum: ['CEIL', 'ROUND', 'FLOOR'], nullable: true})
    roundingMode?: 'CEIL' | 'ROUND' | 'FLOOR' | null;

    @Column("timestamp", {name: "binding_deadline", nullable: true})
    bindingDeadline?: Date | null;

    @Column("tinyint", {
        name: "allow_arrival_day_evening",
        default: () => "1"
    })
    allowArrivalDayEvening!: boolean;

    @Column("tinyint", {
        name: "allow_departure_day_morning",
        default: () => "1"
    })
    allowDepartureDayMorning!: boolean;

    @OneToMany(
        () => ActivityAssignment,
        (activityAssignments) => activityAssignments.entity
    )
    assignments: ActivityAssignment[];

    @RelationId((r: ActivityPlan) => r.event)
    eventId?: string;

    @ManyToOne(() => Event, {onDelete: "CASCADE", onUpdate: "CASCADE"})
    @JoinColumn([{name: "event_id", referencedColumnName: "id"}])
    event?: Event;

    @OneToMany(() => ActivitySlot, (activitySlots) => activitySlots.entity)
    items: ActivitySlot[];

    @OneToMany(() => ActivityRole, (role) => role.entity)
    roles?: ActivityRole[];

    @OneToMany(
        () => ActivityPlanRequirement,
        (activityPlanRequirements) => activityPlanRequirements.entity
    )
    activityPlanRequirements: ActivityPlanRequirement[];

    @OneToMany(
        () => ActivityPlanRequirementOverride,
        (activityPlanRequirementOverrides) => activityPlanRequirementOverrides.entity
    )
    activityPlanRequirementOverrides: ActivityPlanRequirementOverride[];

    @OneToMany(
        () => ActivityPlanStayRequirement,
        (stayRequirement) => stayRequirement.entity
    )
    activityPlanStayRequirements: ActivityPlanStayRequirement[];

    @OneToMany(
        () => ActivityAssignmentRecommendation,
        (recommendation) => recommendation.entity
    )
    activityAssignmentRecommendations: ActivityAssignmentRecommendation[];

    @OneToMany(() => ActivityPlanTextField, (textField) => textField.entity)
    textFields?: ActivityPlanTextField[];
}
