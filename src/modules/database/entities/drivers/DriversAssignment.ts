import {Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn,} from "typeorm";
import {User} from "../user/User";
import {Guest} from "../user/Guest";
import {DriversItem} from "./DriversItem";
import {DriversList} from "./DriversList";

@Index("guest_id", ["guestId"], {})
@Index("list_id", ["listId"], {})
@Index("uk_driver_assignment_guest", ["itemId", "guestId"], {unique: true})
@Index("uk_driver_assignment_user", ["itemId", "userId"], {unique: true})
@Index("user_id", ["userId"], {})
@Entity("drivers_assignments", {schema: "surveyor"})
export class DriversAssignment {
    @PrimaryGeneratedColumn({type: "int", name: "id"})
    id: number;

    @Column("int", {name: "user_id", nullable: true})
    userId: number | null;

    @Column("int", {name: "guest_id", nullable: true})
    guestId: number | null;

    @Column("varchar", {name: "list_id", length: 36})
    listId: string;

    @Column("varchar", {name: "item_id", length: 36})
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

    @ManyToOne(() => User, (users) => users.driversAssignments, {
        onDelete: "CASCADE",
        onUpdate: "RESTRICT",
    })
    @JoinColumn([{name: "user_id", referencedColumnName: "id"}])
    user: User;

    @ManyToOne(() => Guest, (guests) => guests.driversAssignments, {
        onDelete: "CASCADE",
        onUpdate: "RESTRICT",
    })
    @JoinColumn([{name: "guest_id", referencedColumnName: "id"}])
    guest: Guest;

    @ManyToOne(
        () => DriversItem,
        (driversItems) => driversItems.driversAssignments,
        {onDelete: "CASCADE", onUpdate: "CASCADE"}
    )
    @JoinColumn([{name: "item_id", referencedColumnName: "id"}])
    item: DriversItem;

    @ManyToOne(
        () => DriversList,
        (driversLists) => driversLists.driversAssignments,
        {onDelete: "CASCADE", onUpdate: "CASCADE"}
    )
    @JoinColumn([{name: "list_id", referencedColumnName: "id"}])
    list: DriversList;
}
