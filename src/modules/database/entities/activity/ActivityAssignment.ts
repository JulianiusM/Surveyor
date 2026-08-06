import {Entity, JoinColumn, ManyToOne, OneToMany, RelationId,} from "typeorm";
import {DefaultNumericEntityItemAssignment} from "../abstract/ProfileEntityItemAssignment";
import {ActivityAssignmentRole} from "./ActivityAssignmentRole";
import {ActivityPlan} from "./ActivityPlan";
import {ActivitySlot} from "./ActivitySlot";

@Entity("activity_assignments", {schema: "surveyor"})
export class ActivityAssignment extends DefaultNumericEntityItemAssignment {
    @OneToMany(
        () => ActivityAssignmentRole,
        (activityAssignmentRoles) => activityAssignmentRoles.assignment
    )
    activityAssignmentRoles: ActivityAssignmentRole[];

    @RelationId((a: ActivityAssignment) => a.item)
    itemId!: string;

    @ManyToOne(
        () => ActivitySlot,
        {onDelete: "CASCADE", onUpdate: "CASCADE"}
    )
    @JoinColumn([{name: "item_id", referencedColumnName: "id"}])
    item!: ActivitySlot;

    @RelationId((a: ActivityAssignment) => a.entity)
    entityId!: string;

    @ManyToOne(
        () => ActivityPlan,
        {onDelete: "CASCADE", onUpdate: "CASCADE"}
    )
    @JoinColumn([{name: "entity_id", referencedColumnName: "id"}])
    entity!: ActivityPlan;
}
