import {Column, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn, RelationId,} from "typeorm";
import {DriversAssignment} from "./DriversAssignment";
import {DriversItem} from "./DriversItem";
import {User} from "../user/User";
import {Event} from "../event/Event";

@Entity("drivers_lists", {schema: "surveyor"})
export class DriversList {
    @PrimaryGeneratedColumn("uuid", {name: "id"})
    id!: string;

    @Column("varchar", {name: "title", length: 255})
    title!: string;

    @Column("text", {name: "description", nullable: true})
    description?: string | null;

    @Column("timestamp", {
        name: "created_at",
        nullable: true,
        default: () => "CURRENT_TIMESTAMP",
    })
    createdAt: Date | null;

    @Column("timestamp", {
        name: "updated_at",
        default: () => "CURRENT_TIMESTAMP",
    })
    updatedAt: Date;

    @OneToMany(
        () => DriversAssignment,
        (driversAssignments) => driversAssignments.list
    )
    driversAssignments: DriversAssignment[];

    @OneToMany(() => DriversItem, (driversItems) => driversItems.list)
    driversItems: DriversItem[];

    @RelationId((a: DriversList) => a.owner)
    ownerId!: number;

    @ManyToOne(() => User, (users) => users.driversLists, {
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
    })
    @JoinColumn([{name: "owner_id", referencedColumnName: "id"}])
    owner!: User;

    @RelationId((a: DriversList) => a.event)
    eventId?: string;

    @ManyToOne(() => Event, (event) => event.driversLists, {
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
    })
    @JoinColumn([{name: "event_id", referencedColumnName: "id"}])
    event?: Event;
}
