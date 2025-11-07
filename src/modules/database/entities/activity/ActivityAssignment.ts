import {Column, Entity, Index, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn,} from "typeorm";
import {ActivityAssignmentRole} from "./ActivityAssignmentRole";
import {ActivitySlot} from "./ActivitySlot";
import {ActivityPlan} from "./ActivityPlan";
import {User} from "../user/User";
import {Guest} from "../user/Guest";

@Index("guest_id", ["guestId"], {})
@Index("plan_id", ["planId"], {})
@Index("uk_activity_assignment_guest", ["slotId", "guestId"], {unique: true})
@Index("uk_unique_activity_assignment_user", ["slotId", "userId"], {
    unique: true,
})
@Index("user_id", ["userId"], {})
@Entity("activity_assignments", {schema: "surveyor"})
export class ActivityAssignment {
    @PrimaryGeneratedColumn({type: "int", name: "id"})
    id: number;

    @Column("varchar", {name: "slot_id", length: 36})
    slotId: string;

    @Column("varchar", {name: "plan_id", length: 36})
    planId: string;

    @Column("int", {name: "user_id", nullable: true})
    userId?: number | null;

    @Column("int", {name: "guest_id", nullable: true})
    guestId?: number | null;

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

    @ManyToOne(
        () => ActivitySlot,
        (activitySlots) => activitySlots.activityAssignments,
        {onDelete: "CASCADE", onUpdate: "CASCADE"}
    )
    @JoinColumn([{name: "slot_id", referencedColumnName: "id"}])
    slot: ActivitySlot;

    @ManyToOne(
        () => ActivityPlan,
        (activityPlans) => activityPlans.activityAssignments,
        {onDelete: "CASCADE", onUpdate: "CASCADE"}
    )
    @JoinColumn([{name: "plan_id", referencedColumnName: "id"}])
    plan: ActivityPlan;

    @ManyToOne(() => User, (users) => users.activityAssignments, {
        onDelete: "CASCADE",
        onUpdate: "NO ACTION",
    })
    @JoinColumn([{name: "user_id", referencedColumnName: "id"}])
    user: User;

    @ManyToOne(() => Guest, (guests) => guests.activityAssignments, {
        onDelete: "CASCADE",
        onUpdate: "NO ACTION",
    })
    @JoinColumn([{name: "guest_id", referencedColumnName: "id"}])
    guest: Guest;
}
