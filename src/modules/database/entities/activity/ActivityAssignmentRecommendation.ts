import {Column, Entity, JoinColumn, ManyToOne, RelationId} from "typeorm";
import {DefaultUuidEntityItemAssignment} from "../abstract/ProfileEntityItemAssignment";
import {ActivityPlan} from "./ActivityPlan";
import {ActivitySlot} from "./ActivitySlot";

export type RecommendationStatus = "PENDING" | "APPROVED" | "APPLIED" | "REJECTED";
export const RECOMMENDATION_STATUS: RecommendationStatus[] = ["PENDING", "APPROVED", "APPLIED", "REJECTED"];

@Entity("activity_assignment_recommendations", {schema: "surveyor"})
export class ActivityAssignmentRecommendation extends DefaultUuidEntityItemAssignment {
    @Column("simple-enum", {name: "status", enum: RECOMMENDATION_STATUS, default: "PENDING"})
    status!: RecommendationStatus;

    @RelationId((a: ActivityAssignmentRecommendation) => a.item)
    itemId!: string;

    @ManyToOne(
        () => ActivitySlot,
        {onDelete: "CASCADE", onUpdate: "CASCADE"}
    )
    @JoinColumn([{name: "item_id", referencedColumnName: "id"}])
    item!: ActivitySlot;

    @RelationId((a: ActivityAssignmentRecommendation) => a.entity)
    entityId!: string;

    @ManyToOne(
        () => ActivityPlan,
        {onDelete: "CASCADE", onUpdate: "CASCADE"}
    )
    @JoinColumn([{name: "entity_id", referencedColumnName: "id"}])
    entity!: ActivityPlan;
}
