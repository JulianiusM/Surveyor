import {Column, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn, RelationId,} from "typeorm";
import {Guest} from "../user/Guest";
import {User} from "../user/User";
import {DriversAssignment} from "./DriversAssignment";
import {DriversList} from "./DriversList";

@Entity("drivers_items", {schema: "surveyor"})
export class DriversItem {
    @PrimaryGeneratedColumn("uuid", {name: "id"})
    id!: string;

    @Column("varchar", {name: "title", length: 255})
    title!: string;

    @Column("varchar", {name: "description", nullable: true, length: 255})
    description?: string | null;

    @Column("int", {
        name: "max_assignees",
        nullable: true,
        default: () => "'1'",
    })
    maxAssignees?: number | null;

    @Column("int", {name: "pos", default: 0})
    pos!: number;

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

    @RelationId((a: DriversItem) => a.list)
    listId!: string;

    @ManyToOne(() => DriversList, (driversLists) => driversLists.driversItems, {
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
    })
    @JoinColumn([{name: "list_id", referencedColumnName: "id"}])
    list!: DriversList;

    @RelationId((a: DriversItem) => a.user)
    userId?: number;

    @ManyToOne(() => User, (users) => users.driversItems, {
        onDelete: "CASCADE",
        onUpdate: "RESTRICT",
    })
    @JoinColumn([{name: "user_id", referencedColumnName: "id"}])
    user?: User;

    @RelationId((a: DriversItem) => a.guest)
    guestId?: string;

    @ManyToOne(() => Guest, (guests) => guests.driversItems, {
        onDelete: "CASCADE",
        onUpdate: "RESTRICT",
    })
    @JoinColumn([{name: "guest_id", referencedColumnName: "id"}])
    guest?: Guest;
}
