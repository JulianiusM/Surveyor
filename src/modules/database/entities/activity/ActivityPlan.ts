import {Column, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn, RelationId,} from "typeorm";
import {ActivityAssignment} from "./ActivityAssignment";
import {User} from "../user/User";
import {ActivitySlot} from "./ActivitySlot";
import {ActivityPlanRequirement} from "./ActivityPlanRequirement";
import {ActivityPlanRequirementOverride} from "./ActivityPlanRequirementOverride";
import {ActivityAssignmentRecommendation} from "./ActivityAssignmentRecommendation";
import {Event} from "../event/Event";

@Entity("activity_plans", {schema: "surveyor"})
export class ActivityPlan {
    @PrimaryGeneratedColumn("uuid", {name: "id"})
    id!: string;

    @Column("varchar", {name: "title", length: 255})
    title!: string;

    @Column("text", {name: "description", nullable: true})
    description?: string | null;

    @Column("date", {name: "start_date"})
    startDate!: string;

    @Column("date", {name: "end_date"})
    endDate!: string;

    @Column('simple-enum', {name: 'assignment_mode', enum: ['FREE', 'REQUIRED'], default: 'FREE'})
    assignmentMode!: 'FREE' | 'REQUIRED';

    @Column('smallint', {name: 'general_required_shifts', nullable: true})
    generalRequiredShifts?: number | null;

    @Column("tinyint", {name: "allow_overfill_after_full", width: 1, default: () => 0})
    allowOverfillAfterFull!: boolean;

    @Column('simple-enum', {name: 'rounding_mode', enum: ['CEIL', 'ROUND', 'FLOOR'], nullable: true})
    roundingMode?: 'CEIL' | 'ROUND' | 'FLOOR' | null;

    @Column("timestamp", {name: "binding_deadline", nullable: true})
    bindingDeadline?: Date | null;

    @Column("tinyint", {name: "allow_arrival_day_evening", width: 1, default: () => 1})
    allowArrivalDayEvening!: boolean;

    @Column("tinyint", {name: "allow_departure_day_morning", width: 1, default: () => 1})
    allowDepartureDayMorning!: boolean;

    @Column("timestamp", {
        name: "created_at",
        nullable: true,
        default: () => "CURRENT_TIMESTAMP",
    })
    createdAt: Date | null;

    @Column("timestamp", {
        name: "updated_at",
        nullable: true,
        default: () => "CURRENT_TIMESTAMP",
    })
    updatedAt: Date | null;

    @OneToMany(
        () => ActivityAssignment,
        (activityAssignments) => activityAssignments.plan
    )
    activityAssignments: ActivityAssignment[];

    @RelationId((a: ActivityPlan) => a.owner)
    ownerId!: number;

    @ManyToOne(() => User, (users) => users.activityPlans, {
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
    })
    @JoinColumn([{name: "owner_id", referencedColumnName: "id"}])
    owner!: User;

    @RelationId((a: ActivityPlan) => a.event)
    eventId?: string;

    @ManyToOne(() => Event, (event) => event.activityPlans, {
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
    })
    @JoinColumn([{name: "event_id", referencedColumnName: "id"}])
    event?: Event;

    @OneToMany(() => ActivitySlot, (activitySlots) => activitySlots.plan)
    activitySlots: ActivitySlot[];

    @OneToMany(
        () => ActivityPlanRequirement,
        (activityPlanRequirements) => activityPlanRequirements.plan
    )
    activityPlanRequirements: ActivityPlanRequirement[];

    @OneToMany(
        () => ActivityPlanRequirementOverride,
        (activityPlanRequirementOverrides) => activityPlanRequirementOverrides.plan
    )
    activityPlanRequirementOverrides: ActivityPlanRequirementOverride[];

    @OneToMany(
        () => ActivityAssignmentRecommendation,
        (recommendation) => recommendation.plan
    )
    activityAssignmentRecommendations: ActivityAssignmentRecommendation[];
}
