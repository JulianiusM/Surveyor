import {Column, Entity, JoinColumn, ManyToOne, OneToMany, RelationId,} from "typeorm";
import {UuidDefaultEntityItem} from "../abstract/ProfileEntityItem";
import {ActivityAssignment} from "./ActivityAssignment";
import {ActivityPlan} from "./ActivityPlan";
import {ActivitySlotRole} from "./ActivitySlotRole";

@Entity("activity_slots", {schema: "surveyor"})
export class ActivitySlot extends UuidDefaultEntityItem {
    @Column("date", {name: "day"})
    day!: string;

    @Column("int", {name: "pos", default: 0})
    pos!: number;

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

    @OneToMany(
        () => ActivityAssignment,
        (activityAssignments) => activityAssignments.item
    )
    assignments: ActivityAssignment[];

    @OneToMany(
        () => ActivitySlotRole,
        (activitySlotRole) => activitySlotRole.item
    )
    activitySlotRoles: ActivitySlotRole[];

    @RelationId((a: ActivitySlot) => a.entity)
    entityId!: string;

    @ManyToOne(
        () => ActivityPlan,
        {onDelete: "CASCADE", onUpdate: "CASCADE"}
    )
    @JoinColumn([{name: "entity_id", referencedColumnName: "id"}])
    entity!: ActivityPlan;
}
