import {Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, RelationId} from "typeorm";
import {ActivityRole} from "./ActivityRole";
import {ActivityPlan} from "./ActivityPlan";

@Entity("activity_plan_requirements", {schema: "surveyor"})
@Index("uk_plan_role", ["plan", "role"], {unique: true})
export class ActivityPlanRequirement {
    @PrimaryGeneratedColumn({type: "int", name: "id"})
    id!: number;

    @Column("smallint", {name: "required_shifts"})
    requiredShifts!: number;

    @RelationId((a: ActivityPlanRequirement) => a.role)
    roleId!: string;

    @ManyToOne(() => ActivityRole, (roles) => roles.activitySlotRoles, {
        onDelete: "RESTRICT",
        onUpdate: "CASCADE",
    })
    @JoinColumn([{name: "role_id", referencedColumnName: "id"}])
    role!: ActivityRole;

    @RelationId((a: ActivityPlanRequirement) => a.plan)
    planId!: string;

    @ManyToOne(
        () => ActivityPlan,
        (activityPlans) => activityPlans.activitySlots,
        {onDelete: "CASCADE", onUpdate: "NO ACTION"}
    )
    @JoinColumn([{name: "plan_id", referencedColumnName: "id"}])
    plan!: ActivityPlan;
}
