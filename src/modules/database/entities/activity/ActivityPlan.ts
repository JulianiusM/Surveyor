import {Column, Entity, Index, JoinColumn, ManyToOne, OneToMany,} from "typeorm";
import {ActivityAssignment} from "./ActivityAssignment";
import {User} from "../user/User";
import {ActivitySlot} from "./ActivitySlot";

@Index("owner_id", ["ownerId"], {})
@Entity("activity_plans", {schema: "surveyor"})
export class ActivityPlan {
    @Column("char", {primary: true, name: "id", length: 36})
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
        onUpdate: "NO ACTION",
    })
    @JoinColumn([{name: "owner_id", referencedColumnName: "id"}])
    owner: User;

    @OneToMany(() => ActivitySlot, (activitySlots) => activitySlots.plan)
    activitySlots: ActivitySlot[];
}
