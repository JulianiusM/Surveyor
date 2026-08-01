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
