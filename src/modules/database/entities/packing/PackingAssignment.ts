import {Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn,} from "typeorm";
import {Guest} from "../user/Guest";
import {PackingItem} from "./PackingItem";
import {PackingList} from "./PackingList";
import {User} from "../user/User";

@Index("fk_packing_ass_guest", ["guestId"], {})
@Index("fk_packing_ass_list", ["listId"], {})
@Index("fk_packing_ass_user", ["userId"], {})
@Index("uk_packing_assignment_guest", ["itemId", "guestId"], {unique: true})
@Index("uk_packing_assignment_user", ["itemId", "userId"], {unique: true})
@Entity("packing_assignments", {schema: "surveyor"})
export class PackingAssignment {
    @PrimaryGeneratedColumn({type: "int", name: "id"})
    id: number;

    @Column("int", {name: "user_id", nullable: true})
    userId: number | null;

    @Column("int", {name: "guest_id", nullable: true})
    guestId: number | null;

    @Column("char", {name: "list_id", length: 36})
    listId: string;

    @Column("char", {name: "item_id", length: 36})
    itemId: string;

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

    @ManyToOne(() => User, (users) => users.packingAssignments, {
        onDelete: "CASCADE",
        onUpdate: "RESTRICT",
    })
    @JoinColumn([{name: "user_id", referencedColumnName: "id"}])
    user: User;

    @ManyToOne(() => Guest, (guests) => guests.packingAssignments, {
        onDelete: "CASCADE",
        onUpdate: "RESTRICT",
    })
    @JoinColumn([{name: "guest_id", referencedColumnName: "id"}])
    guest: Guest;

    @ManyToOne(
        () => PackingItem,
        (packingItems) => packingItems.packingAssignments,
        {onDelete: "CASCADE", onUpdate: "CASCADE"}
    )
    @JoinColumn([{name: "item_id", referencedColumnName: "id"}])
    item: PackingItem;

    @ManyToOne(
        () => PackingList,
        (packingLists) => packingLists.packingAssignments,
        {onDelete: "CASCADE", onUpdate: "RESTRICT"}
    )
    @JoinColumn([{name: "list_id", referencedColumnName: "id"}])
    list: PackingList;
}
