import {Column, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn, RelationId,} from "typeorm";
import {Guest} from "../user/Guest";
import {User} from "../user/User";
import {ActivityAssignment} from "./ActivityAssignment";
import {ActivityPlan} from "./ActivityPlan";
import {ActivitySlotRole} from "./ActivitySlotRole";

@Entity("activity_slots", {schema: "surveyor"})
export class ActivitySlot {
    @PrimaryGeneratedColumn("uuid", {name: "id"})
    id!: string;

    @Column("date", {name: "day"})
    day!: string;

    @Column("int", {name: "pos", default: 0})
    pos!: number;

    @Column("varchar", {name: "title", length: 255})
    title!: string;

    @Column("text", {name: "description", nullable: true})
    description?: string | null;

    @Column('time', {name: 'start_time', nullable: true})
    startTime?: string | null; // 'HH:MM:SS'

    @Column('time', {name: 'end_time', nullable: true})
    endTime?: string | null; // 'HH:MM:SS'

    @Column("int", {
        name: "max_assignees",
        nullable: true,
        default: () => "'1'",
    })
    maxAssignees?: number | null;

    @Column("tinyint", {
        name: "is_arrival_evening",
        nullable: true
    })
    isArrivalEvening?: boolean | null;

    @Column("tinyint", {
        name: "is_departure_morning",
        nullable: true
    })
    isDepartureMorning?: boolean | null;

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

    @OneToMany(
        () => ActivityAssignment,
        (activityAssignments) => activityAssignments.slot
    )
    activityAssignments: ActivityAssignment[];

    @OneToMany(
        () => ActivitySlotRole,
        (activitySlotRole) => activitySlotRole.slot
    )
    activitySlotRoles: ActivitySlotRole[];

    @RelationId((slot: ActivitySlot) => slot.plan)
    planId!: string;

    @ManyToOne(
        () => ActivityPlan,
        (activityPlans) => activityPlans.activitySlots,
        {onDelete: "CASCADE", onUpdate: "NO ACTION"}
    )
    @JoinColumn([{name: "plan_id", referencedColumnName: "id"}])
    plan!: ActivityPlan;

    @RelationId((a: ActivitySlot) => a.user)
    userId?: string;

    @ManyToOne(() => User, {
        onDelete: "CASCADE",
        onUpdate: "RESTRICT",
    })
    @JoinColumn([{name: "user_id", referencedColumnName: "id"}])
    user?: User;

    @RelationId((a: ActivitySlot) => a.guest)
    guestId?: string;

    @ManyToOne(() => Guest, {
        onDelete: "CASCADE",
        onUpdate: "RESTRICT",
    })
    @JoinColumn([{name: "guest_id", referencedColumnName: "id"}])
    guest?: Guest;
}
