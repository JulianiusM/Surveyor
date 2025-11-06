import {Column, Entity, Index, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn,} from "typeorm";
import {ActivityAssignment} from "./ActivityAssignment";
import {User} from "../user/User";
import {ActivitySlot} from "./ActivitySlot";
import {ActivityPlanRequirement} from "./ActivityPlanRequirement";
import {Event} from "../event/Event";

@Index("owner_id", ["ownerId"], {})
@Entity("activity_plans", {schema: "surveyor"})
export class ActivityPlan {
    @PrimaryGeneratedColumn("uuid", {name: "id"})
    id: string;

    @Column("int", {name: "owner_id"})
    ownerId: number;

    @Column("varchar", {name: "title", length: 255})
    title: string;

    @Column("text", {name: "description", nullable: true})
    description: string | null;

    @Column("date", {name: "start_date"})
    startDate: string;

    @Column("date", {name: "end_date"})
    endDate: string;

    @Column("tinyint", {
        name: "allow_guest_add",
        width: 1,
        default: () => "'0'",
    })
    allowGuestAdd: boolean;

    @Column("tinyint", {name: "guest_manage", width: 1, default: () => "'0'"})
    guestManage: boolean;

    @Column('simple-enum', {name: 'assignment_mode', enum: ['FREE', 'REQUIRED'], default: 'FREE'})
    assignmentMode!: 'FREE' | 'REQUIRED';

    @Column('smallint', {name: 'general_required_shifts', nullable: true})
    generalRequiredShifts?: number | null;

    @Column("tinyint", {name: "allow_overfill_after_full", width: 1, default: () => 0})
    allowOverfillAfterFull!: boolean;

    @Column('simple-enum', {name: 'rounding_mode', enum: ['CEIL', 'ROUND', 'FLOOR'], nullable: true})
    roundingMode?: 'CEIL' | 'ROUND' | 'FLOOR' | null;

    @Column('varchar', {name: 'event_id', length: 36, nullable: true})
    eventId?: string | null;

    @Column("timestamp", {name: "binding_deadline", nullable: true})
    bindingDeadline?: Date | null;

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
        (activityAssignments) => activityAssignments.plan
    )
    activityAssignments: ActivityAssignment[];

    @ManyToOne(() => User, (users) => users.activityPlans, {
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
    })
    @JoinColumn([{name: "owner_id", referencedColumnName: "id"}])
    owner: User;

    @ManyToOne(() => Event, (event) => event.activityPlans, {
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
    })
    @JoinColumn([{name: "event_id", referencedColumnName: "id"}])
    event: Event;

    @OneToMany(() => ActivitySlot, (activitySlots) => activitySlots.plan)
    activitySlots: ActivitySlot[];

    @OneToMany(
        () => ActivityPlanRequirement,
        (activityPlanRequirements) => activityPlanRequirements.plan
    )
    activityPlanRequirements: ActivityPlanRequirement[];
}
