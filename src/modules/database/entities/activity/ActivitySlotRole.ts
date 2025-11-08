import {Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, RelationId, Unique} from "typeorm";
import {ActivitySlot} from "./ActivitySlot";
import {Role} from "../user/Role";

@Unique("unique_act_slot_role_map", ["slot", "role"])
@Entity("activity_slot_role", {schema: "surveyor"})
export class ActivitySlotRole {
    @PrimaryGeneratedColumn({type: "int", name: "id"})
    id!: number;

    @Column("smallint", {name: "max_qty"})
    maxQty?: number;

    @RelationId((a: ActivitySlotRole) => a.slot)
    slotId!: string;

    @ManyToOne(
        () => ActivitySlot,
        (activitySlots) => activitySlots.activitySlotRoles,
        {onDelete: "CASCADE", onUpdate: "CASCADE"}
    )
    @JoinColumn([{name: "slot_id", referencedColumnName: "id"}])
    slot!: ActivitySlot;

    @RelationId((a: ActivitySlotRole) => a.role)
    roleId!: string;

    @ManyToOne(() => Role, (roles) => roles.activitySlotRoles, {
        onDelete: "RESTRICT",
        onUpdate: "CASCADE",
    })
    @JoinColumn([{name: "role_id", referencedColumnName: "id"}])
    role!: Role;
}
