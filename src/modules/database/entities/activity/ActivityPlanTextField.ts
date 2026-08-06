import {Column, Entity, JoinColumn, ManyToOne, RelationId} from "typeorm";
import {ParentEntityRelation} from "../abstract/BaseEntity";
import {UuidEntityItem} from "../abstract/BaseEntityItem";
import {ActivityPlan} from "./ActivityPlan";

@Entity("activity_plan_text_fields", {schema: "surveyor"})
export class ActivityPlanTextField extends UuidEntityItem implements ParentEntityRelation {
    @Column("text", {name: "text", nullable: true})
    text?: string | null;

    @RelationId((a: ActivityPlanTextField) => a.entity)
    entityId!: string;

    @ManyToOne(
        () => ActivityPlan,
        {onDelete: "CASCADE", onUpdate: "CASCADE"}
    )
    @JoinColumn([{name: "entity_id", referencedColumnName: "id"}])
    entity!: ActivityPlan;
}
