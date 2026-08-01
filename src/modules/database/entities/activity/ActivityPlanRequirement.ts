import {Column, Entity, Index, JoinColumn, ManyToOne, RelationId} from "typeorm";
import {ParentEntityRelation} from "../abstract/BaseEntity";
import {NumericBase} from "../abstract/TrackedBase";
import {ActivityPlan} from "./ActivityPlan";
import {ActivityRole} from "./ActivityRole";

@Entity("activity_plan_requirements", {schema: "surveyor"})
@Index("uk_plan_role", ["entity", "role"], {unique: true})
export class ActivityPlanRequirement extends NumericBase implements ParentEntityRelation {
    @Column("smallint", {name: "required_shifts"})
    requiredShifts!: number;

    @RelationId((a: ActivityPlanRequirement) => a.role)
    roleId!: string;

    @ManyToOne(() => ActivityRole, {
        onDelete: "RESTRICT",
        onUpdate: "CASCADE",
    })
    @JoinColumn([{name: "role_id", referencedColumnName: "id"}])
    role!: ActivityRole;

    @RelationId((a: ActivityPlanRequirement) => a.entity)
    entityId!: string;

    @ManyToOne(
        () => ActivityPlan,
        {onDelete: "CASCADE", onUpdate: "CASCADE"}
    )
    @JoinColumn([{name: "entity_id", referencedColumnName: "id"}])
    entity!: ActivityPlan;
}
