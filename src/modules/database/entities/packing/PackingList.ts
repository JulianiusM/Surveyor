import {Column, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn, RelationId,} from "typeorm";
import {PackingAssignment} from "./PackingAssignment";
import {PackingItem} from "./PackingItem";
import {User} from "../user/User";
import {Event} from "../event/Event";

@Entity("packing_lists", {schema: "surveyor"})
export class PackingList {
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
        () => PackingAssignment,
        (packingAssignments) => packingAssignments.list
    )
    packingAssignments!: PackingAssignment[];

    @OneToMany(() => PackingItem, (packingItems) => packingItems.list)
    packingItems!: PackingItem[];

    @RelationId((pl: PackingList) => pl.owner)
    ownerId!: number;

    @ManyToOne(() => User, (users) => users.packingLists, {
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
    })
    @JoinColumn([{name: "owner_id", referencedColumnName: "id"}])
    owner!: User;

    @RelationId((pl: PackingList) => pl.event)
    eventId?: string;

    @ManyToOne(() => Event, (event) => event.packingLists, {
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
    })
    @JoinColumn([{name: "event_id", referencedColumnName: "id"}])
    event?: Event;
}
