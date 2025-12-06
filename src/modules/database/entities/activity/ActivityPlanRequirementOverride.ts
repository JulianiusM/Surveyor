import {
    Check,
    Column,
    Entity,
    Index,
    JoinColumn,
    ManyToOne,
    PrimaryGeneratedColumn,
    RelationId,
} from "typeorm";
import {User} from "../user/User";
import {Guest} from "../user/Guest";
import {ActivityPlan} from "./ActivityPlan";
import {Role} from "../user/Role";

@Entity("activity_plan_requirement_overrides", {schema: "surveyor"})
@Index("uk_plan_participant_role", ["plan", "user", "guest", "role"], {unique: true})
@Check(`(user_id IS NOT NULL AND guest_id IS NULL) OR (user_id IS NULL AND guest_id IS NOT NULL)`)
export class ActivityPlanRequirementOverride {
    @PrimaryGeneratedColumn({type: "int", name: "id"})
    id!: number;

    @Column("smallint", {name: "required_shifts"})
    requiredShifts!: number;

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

    @RelationId((override: ActivityPlanRequirementOverride) => override.plan)
    planId!: string;

    @ManyToOne(() => ActivityPlan, (plan) => plan.activityPlanRequirementOverrides, {
        onDelete: "CASCADE",
        onUpdate: "NO ACTION",
    })
    @JoinColumn([{name: "plan_id", referencedColumnName: "id"}])
    plan!: ActivityPlan;

    @RelationId((override: ActivityPlanRequirementOverride) => override.role)
    roleId?: number | null;

    @ManyToOne(() => Role, (role) => role.activityPlanRequirementOverrides, {
        onDelete: "RESTRICT",
        onUpdate: "CASCADE",
        nullable: true,
    })
    @JoinColumn([{name: "role_id", referencedColumnName: "id"}])
    role?: Role | null;

    @RelationId((override: ActivityPlanRequirementOverride) => override.user)
    userId?: number | null;

    @ManyToOne(() => User, (user) => user.activityPlanRequirementOverrides, {
        onDelete: "CASCADE",
        onUpdate: "NO ACTION",
        nullable: true,
    })
    @JoinColumn([{name: "user_id", referencedColumnName: "id"}])
    user?: User | null;

    @RelationId((override: ActivityPlanRequirementOverride) => override.guest)
    guestId?: number | null;

    @ManyToOne(() => Guest, (guest) => guest.activityPlanRequirementOverrides, {
        onDelete: "CASCADE",
        onUpdate: "NO ACTION",
        nullable: true,
    })
    @JoinColumn([{name: "guest_id", referencedColumnName: "id"}])
    guest?: Guest | null;
}
