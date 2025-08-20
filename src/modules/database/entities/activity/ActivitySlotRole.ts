import {Column, Entity, Index, JoinColumn, ManyToOne} from "typeorm";
import {ActivitySlot} from "./ActivitySlot";
import {Role} from "../user/Role";

@Index("role_id", ["roleId"], {})
@Entity("activity_slot_role", {schema: "surveyor"})
export class ActivitySlotRole {
    @Column("char", {primary: true, name: "slot_id", length: 36})
    slotId: string;

    @Column("smallint", {primary: true, name: "role_id"})
    roleId: number;

    @Column("smallint", {name: "max_qty"})
    maxQty: number;

    @ManyToOne(
        () => ActivitySlot,
        (activitySlots) => activitySlots.activitySlotRoles,
        {onDelete: "CASCADE", onUpdate: "CASCADE"}
    )
    @JoinColumn([{name: "slot_id", referencedColumnName: "id"}])
    slot: ActivitySlot;

    @ManyToOne(() => Role, (roles) => roles.activitySlotRoles, {
        onDelete: "RESTRICT",
        onUpdate: "CASCADE",
    })
    @JoinColumn([{name: "role_id", referencedColumnName: "id"}])
    role: Role;
}
