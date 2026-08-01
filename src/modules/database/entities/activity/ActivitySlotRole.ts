import {Column, Entity, JoinColumn, ManyToOne, RelationId, Unique} from "typeorm";
import {ParentItemRelation} from "../abstract/BaseEntity";
import {NumericBase} from "../abstract/TrackedBase";
import {ActivityRole} from "./ActivityRole";
import {ActivitySlot} from "./ActivitySlot";

@Unique("unique_act_slot_role_map", ["item", "role"])
@Entity("activity_slot_role", {schema: "surveyor"})
export class ActivitySlotRole extends NumericBase implements ParentItemRelation {
    @Column("smallint", {name: "max_qty"})
    maxQty?: number;

    @RelationId((a: ActivitySlotRole) => a.item)
    itemId!: string;

    @ManyToOne(
        () => ActivitySlot,
        (activitySlots) => activitySlots.activitySlotRoles,
        {onDelete: "CASCADE", onUpdate: "CASCADE"}
    )
    @JoinColumn([{name: "item_id", referencedColumnName: "id"}])
    item!: ActivitySlot;

    @RelationId((a: ActivitySlotRole) => a.role)
    roleId!: number;

    @ManyToOne(() => ActivityRole, {
        onDelete: "RESTRICT",
        onUpdate: "CASCADE",
    })
    @JoinColumn([{name: "role_id", referencedColumnName: "id"}])
    role!: ActivityRole;
}
