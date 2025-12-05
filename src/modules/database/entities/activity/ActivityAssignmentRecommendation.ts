import {Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, RelationId} from "typeorm";
import {ActivityPlan} from "./ActivityPlan";
import {ActivitySlot} from "./ActivitySlot";
import {User} from "../user/User";
import {Guest} from "../user/Guest";

export type RecommendationStatus = "PENDING" | "APPROVED" | "APPLIED" | "REJECTED";

@Entity("activity_assignment_recommendations", {schema: "surveyor"})
export class ActivityAssignmentRecommendation {
    @PrimaryGeneratedColumn("uuid", {name: "id"})
    id!: string;

    @ManyToOne(() => ActivityPlan, (plan) => plan.activityAssignmentRecommendations, {onDelete: "CASCADE"})
    @JoinColumn([{name: "plan_id", referencedColumnName: "id"}])
    plan!: ActivityPlan;

    @RelationId((rec: ActivityAssignmentRecommendation) => rec.plan)
    planId!: string;

    @ManyToOne(() => ActivitySlot, {onDelete: "CASCADE"})
    @JoinColumn([{name: "slot_id", referencedColumnName: "id"}])
    slot!: ActivitySlot;

    @RelationId((rec: ActivityAssignmentRecommendation) => rec.slot)
    slotId!: string;

    @ManyToOne(() => User, {nullable: true, onDelete: "SET NULL"})
    @JoinColumn([{name: "user_id", referencedColumnName: "id"}])
    user?: User | null;

    @RelationId((rec: ActivityAssignmentRecommendation) => rec.user)
    userId?: number | null;

    @ManyToOne(() => Guest, {nullable: true, onDelete: "SET NULL"})
    @JoinColumn([{name: "guest_id", referencedColumnName: "id"}])
    guest?: Guest | null;

    @RelationId((rec: ActivityAssignmentRecommendation) => rec.guest)
    guestId?: number | null;

    @Column("simple-enum", {name: "status", enum: ["PENDING", "APPROVED", "APPLIED", "REJECTED"], default: "PENDING"})
    status!: RecommendationStatus;

    @Column("timestamp", {name: "created_at", default: () => "CURRENT_TIMESTAMP"})
    createdAt: Date | null;

    @Column("timestamp", {name: "updated_at", default: () => "CURRENT_TIMESTAMP"})
    updatedAt: Date | null;
}
