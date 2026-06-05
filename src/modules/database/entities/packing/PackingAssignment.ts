import {Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, RelationId,} from "typeorm";
import {Guest} from "../user/Guest";
import {User} from "../user/User";
import {PackingItem} from "./PackingItem";
import {PackingList} from "./PackingList";

@Index("uk_packing_assignment_guest", ["item", "guest"], {unique: true})
@Index("uk_packing_assignment_user", ["item", "user"], {unique: true})
@Entity("packing_assignments", {schema: "surveyor"})
export class PackingAssignment {
    @PrimaryGeneratedColumn({type: "int", name: "id"})
    id!: number;

    @Column("timestamp", {
        name: "created_at",
        default: () => "CURRENT_TIMESTAMP",
    })
    createdAt: Date;

    @Column("timestamp", {
        name: "updated_at",
        default: () => "CURRENT_TIMESTAMP",
    })
    updatedAt: Date;

    @RelationId((a: PackingAssignment) => a.user)
    userId?: number;

    @ManyToOne(() => User, (users) => users.packingAssignments, {
        onDelete: "CASCADE",
        onUpdate: "RESTRICT",
    })
    @JoinColumn([{name: "user_id", referencedColumnName: "id"}])
    user?: User;

    @RelationId((a: PackingAssignment) => a.guest)
    guestId?: string;

    @ManyToOne(() => Guest, (guests) => guests.packingAssignments, {
        onDelete: "CASCADE",
        onUpdate: "RESTRICT",
    })
    @JoinColumn([{name: "guest_id", referencedColumnName: "id"}])
    guest?: Guest;

    @RelationId((a: PackingAssignment) => a.item)
    itemId!: string;

    @ManyToOne(
        () => PackingItem,
        (packingItems) => packingItems.packingAssignments,
        {onDelete: "CASCADE", onUpdate: "CASCADE"}
    )
    @JoinColumn([{name: "item_id", referencedColumnName: "id"}])
    item!: PackingItem;

    @RelationId((a: PackingAssignment) => a.list)
    listId!: string;

    @ManyToOne(
        () => PackingList,
        (packingLists) => packingLists.packingAssignments,
        {onDelete: "CASCADE", onUpdate: "RESTRICT"}
    )
    @JoinColumn([{name: "list_id", referencedColumnName: "id"}])
    list!: PackingList;
}
