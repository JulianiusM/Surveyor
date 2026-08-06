import {Column, Entity, JoinColumn, ManyToOne, RelationId, Unique,} from "typeorm";
import {ParentEntityRelation} from "../abstract/BaseEntity";
import {NumericDescriptionEntityItem} from "../abstract/DescriptionEntityItem";
import {ActivityPlan} from "./ActivityPlan";

@Unique("act_roles_name_plan", ["title", "entity"])
@Entity("activity_roles", {schema: "surveyor"})
export class ActivityRole extends NumericDescriptionEntityItem implements ParentEntityRelation {
    @Column("tinyint", {
        name: "is_default",
        default: () => "'0'"
    })
    isDefault: boolean;

    @RelationId((a: ActivityRole) => a.entity)
    entityId!: string;

    @ManyToOne(
        () => ActivityPlan,
        {onDelete: "CASCADE", onUpdate: "CASCADE"}
    )
    @JoinColumn([{name: "entity_id", referencedColumnName: "id"}])
    entity!: ActivityPlan;
}
