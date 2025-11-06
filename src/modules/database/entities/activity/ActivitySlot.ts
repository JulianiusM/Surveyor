import {Column, Entity, Index, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn,} from "typeorm";
import {ActivityAssignment} from "./ActivityAssignment";
import {ActivitySlotRole} from "./ActivitySlotRole";
import {ActivityPlan} from "./ActivityPlan";

@Index("plan_id", ["planId"], {})
@Entity("activity_slots", {schema: "surveyor"})
export class ActivitySlot {
    @PrimaryGeneratedColumn("uuid", {name: "id"})
    id: string;

    @Column("varchar", {name: "plan_id", length: 36})
    planId: string;

    @Column("date", {name: "day"})
    day: string;

    @Column("int", {name: "pos", default: 0})
    pos: number;

    @Column("varchar", {name: "title", length: 255})
    title: string;

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

    @ManyToOne(
        () => ActivityPlan,
        (activityPlans) => activityPlans.activitySlots,
        {onDelete: "CASCADE", onUpdate: "NO ACTION"}
    )
    @JoinColumn([{name: "plan_id", referencedColumnName: "id"}])
    plan: ActivityPlan;
}
