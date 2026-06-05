import {Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, RelationId,} from "typeorm";
import {Guest} from "../user/Guest";
import {User} from "../user/User";
import {DriversItem} from "./DriversItem";
import {DriversList} from "./DriversList";

@Index("uk_driver_assignment_guest", ["item", "guest"], {unique: true})
@Index("uk_driver_assignment_user", ["item", "user"], {unique: true})
@Entity("drivers_assignments", {schema: "surveyor"})
export class DriversAssignment {
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

    @RelationId((a: DriversAssignment) => a.user)
    userId?: number;

    @ManyToOne(() => User, (users) => users.driversAssignments, {
        onDelete: "CASCADE",
        onUpdate: "RESTRICT",
    })
    @JoinColumn([{name: "user_id", referencedColumnName: "id"}])
    user?: User;

    @RelationId((a: DriversAssignment) => a.guest)
    guestId?: string;

    @ManyToOne(() => Guest, (guests) => guests.driversAssignments, {
        onDelete: "CASCADE",
        onUpdate: "RESTRICT",
    })
    @JoinColumn([{name: "guest_id", referencedColumnName: "id"}])
    guest?: Guest;

    @RelationId((a: DriversAssignment) => a.item)
    itemId!: string;

    @ManyToOne(
        () => DriversItem,
        (driversItems) => driversItems.driversAssignments,
        {onDelete: "CASCADE", onUpdate: "CASCADE"}
    )
    @JoinColumn([{name: "item_id", referencedColumnName: "id"}])
    item!: DriversItem;

    @RelationId((a: DriversAssignment) => a.list)
    listId!: string;

    @ManyToOne(
        () => DriversList,
        (driversLists) => driversLists.driversAssignments,
        {onDelete: "CASCADE", onUpdate: "CASCADE"}
    )
    @JoinColumn([{name: "list_id", referencedColumnName: "id"}])
    list!: DriversList;
}
