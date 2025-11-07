import {Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn} from "typeorm";
import {Role} from "../user/Role";
import {ActivityPlan} from "./ActivityPlan";

@Entity("activity_plan_requirements", {schema: "surveyor"})
@Index("uk_plan_role", ["planId", "role"], {unique: true})
export class ActivityPlanRequirement {
    @PrimaryGeneratedColumn({type: "int", name: "id"})
    id!: number;

    @Column("varchar", {name: "plan_id"})
    planId: string;

    @Column("smallint", {primary: true, name: "role_id"})
    roleId: number;

    @Column("smallint", {name: "required_shifts"})
    requiredShifts!: number;

    @ManyToOne(() => Role, (roles) => roles.activitySlotRoles, {
        onDelete: "RESTRICT",
        onUpdate: "CASCADE",
    })
    @JoinColumn([{name: "role_id", referencedColumnName: "id"}])
    role: Role;

    @ManyToOne(
        () => ActivityPlan,
        (activityPlans) => activityPlans.activitySlots,
        {onDelete: "CASCADE", onUpdate: "NO ACTION"}
    )
    @JoinColumn([{name: "plan_id", referencedColumnName: "id"}])
    plan: ActivityPlan;
}
