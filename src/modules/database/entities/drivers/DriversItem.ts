import {Column, Entity, Index, JoinColumn, ManyToOne, OneToMany,} from "typeorm";
import {DriversAssignment} from "./DriversAssignment";
import {DriversList} from "./DriversList";
import {User} from "../user/User";
import {Guest} from "../user/Guest";

@Index("guest_id", ["guestId"], {})
@Index("list_id", ["listId"], {})
@Index("user_id", ["userId"], {})
@Entity("drivers_items", {schema: "surveyor"})
export class DriversItem {
    @Column("char", {primary: true, name: "id", length: 36})
    id: string;

    @Column("char", {name: "list_id", length: 36})
    listId: string;

    @Column("varchar", {name: "title", length: 255})
    title: string;

    @Column("varchar", {name: "description", nullable: true, length: 255})
    description: string | null;

    @Column("int", {name: "user_id", nullable: true})
    userId: number | null;

    @Column("int", {name: "guest_id", nullable: true})
    guestId: number | null;

    @Column("int", {
        name: "max_assignees",
        nullable: true,
        default: () => "'1'",
    })
    maxAssignees: number | null;

    @Column("int", {name: "pos", nullable: true, default: () => "'0'"})
    pos: number | null;

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

    @OneToMany(
        () => DriversAssignment,
        (driversAssignments) => driversAssignments.item
    )
    driversAssignments: DriversAssignment[];

    @ManyToOne(() => DriversList, (driversLists) => driversLists.driversItems, {
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
    })
    @JoinColumn([{name: "list_id", referencedColumnName: "id"}])
    list: DriversList;

    @ManyToOne(() => User, (users) => users.driversItems, {
        onDelete: "CASCADE",
        onUpdate: "RESTRICT",
    })
    @JoinColumn([{name: "user_id", referencedColumnName: "id"}])
    user: User;

    @ManyToOne(() => Guest, (guests) => guests.driversItems, {
        onDelete: "CASCADE",
        onUpdate: "RESTRICT",
    })
    @JoinColumn([{name: "guest_id", referencedColumnName: "id"}])
    guest: Guest;
}
