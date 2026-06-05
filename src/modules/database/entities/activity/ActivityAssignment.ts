import {Column, Entity, Index, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn, RelationId,} from "typeorm";
import {Guest} from "../user/Guest";
import {User} from "../user/User";
import {ActivityAssignmentRole} from "./ActivityAssignmentRole";
import {ActivityPlan} from "./ActivityPlan";
import {ActivitySlot} from "./ActivitySlot";

@Index("uk_activity_assignment_guest", ["slot", "guest"], {unique: true})
@Index("uk_unique_activity_assignment_user", ["slot", "user"], {
    unique: true,
})
@Entity("activity_assignments", {schema: "surveyor"})
export class ActivityAssignment {
    @PrimaryGeneratedColumn({type: "int", name: "id"})
    id!: number;

    @Column("timestamp", {
        name: "created_at",
        nullable: true,
        default: () => "CURRENT_TIMESTAMP",
    })
    createdAt: Date | null;

    @Column("timestamp", {
        name: "updatedAt",
        default: () => "CURRENT_TIMESTAMP",
    })
    updatedAt: Date;

    @OneToMany(
        () => ActivityAssignmentRole,
        (activityAssignmentRoles) => activityAssignmentRoles.assignment
    )
    activityAssignmentRoles: ActivityAssignmentRole[];

    @RelationId((aa: ActivityAssignment) => aa.slot)
    slotId!: string;

    @ManyToOne(
        () => ActivitySlot,
        (activitySlots) => activitySlots.activityAssignments,
        {onDelete: "CASCADE", onUpdate: "CASCADE"}
    )
    @JoinColumn([{name: "slot_id", referencedColumnName: "id"}])
    slot!: ActivitySlot;

    @RelationId((aa: ActivityAssignment) => aa.plan)
    planId!: string;

    @ManyToOne(
        () => ActivityPlan,
        (activityPlans) => activityPlans.activityAssignments,
        {onDelete: "CASCADE", onUpdate: "CASCADE"}
    )
    @JoinColumn([{name: "plan_id", referencedColumnName: "id"}])
    plan!: ActivityPlan;

    @RelationId((aa: ActivityAssignment) => aa.user)
    userId?: number;

    @ManyToOne(() => User, (users) => users.activityAssignments, {
        onDelete: "CASCADE",
        onUpdate: "NO ACTION",
    })
    @JoinColumn([{name: "user_id", referencedColumnName: "id"}])
    user?: User;

    @RelationId((aa: ActivityAssignment) => aa.guest)
    guestId?: string;

    @ManyToOne(() => Guest, (guests) => guests.activityAssignments, {
        onDelete: "CASCADE",
        onUpdate: "NO ACTION",
    })
    @JoinColumn([{name: "guest_id", referencedColumnName: "id"}])
    guest?: Guest;
}
