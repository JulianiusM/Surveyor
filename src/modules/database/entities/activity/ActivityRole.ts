import {Column, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn, RelationId, Unique,} from "typeorm";
import {ActivityAssignmentRole} from "./ActivityAssignmentRole";
import {ActivitySlotRole} from "./ActivitySlotRole";
import {ActivityPlanRequirement} from "./ActivityPlanRequirement";
import {ActivityPlanRequirementOverride} from "./ActivityPlanRequirementOverride";
import {ActivityPlan} from "./ActivityPlan";

@Unique("act_roles_name_plan", ["name", "plan"])
@Entity("activity_roles", {schema: "surveyor"})
export class ActivityRole {
    @PrimaryGeneratedColumn({type: "int", name: "id"})
    id!: number;

    @Column("varchar", {name: "name", unique: true, length: 50})
    name!: string;

    @Column("text", {name: "description", nullable: true})
    description: string | null;

    @Column("tinyint", {name: "is_default", width: 1, default: () => "'0'"})
    isDefault: boolean;

    @RelationId((role: ActivityRole) => role.plan)
    planId!: string;

    @ManyToOne(
        () => ActivityPlan,
        (activityPlans) => activityPlans.roles,
        {onDelete: "CASCADE", onUpdate: "NO ACTION"}
    )
    @JoinColumn([{name: "plan_id", referencedColumnName: "id"}])
    plan!: ActivityPlan;

    @OneToMany(
        () => ActivityAssignmentRole,
        (activityAssignmentRoles) => activityAssignmentRoles.role
    )
    activityAssignmentRoles: ActivityAssignmentRole[];

    @OneToMany(
        () => ActivitySlotRole,
        (activitySlotRole) => activitySlotRole.role
    )
    activitySlotRoles: ActivitySlotRole[];

    @OneToMany(
        () => ActivityPlanRequirement,
        (activityPlanRequirements) => activityPlanRequirements.role
    )
    activityPlanRequirements: ActivityPlanRequirement[];

    @OneToMany(
        () => ActivityPlanRequirementOverride,
        (activityPlanRequirementOverrides) => activityPlanRequirementOverrides.role
    )
    activityPlanRequirementOverrides: ActivityPlanRequirementOverride[];
}
