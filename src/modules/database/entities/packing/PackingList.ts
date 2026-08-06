import {Entity, JoinColumn, ManyToOne, OneToMany, RelationId,} from "typeorm";
import {DefaultEntity} from "../abstract/BaseEntity";
import {Event} from "../event/Event";
import {PackingAssignment} from "./PackingAssignment";
import {PackingItem} from "./PackingItem";

@Entity("packing_lists", {schema: "surveyor"})
export class PackingList extends DefaultEntity {
    @OneToMany(
        () => PackingAssignment,
        (packingAssignments) => packingAssignments.entity
    )
    packingAssignments!: PackingAssignment[];

    @OneToMany(() => PackingItem, (packingItems) => packingItems.entity)
    packingItems!: PackingItem[];

    @RelationId((pl: PackingList) => pl.event)
    eventId?: string;

    @ManyToOne(() => Event, (event) => event.packingLists, {
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
    })
    @JoinColumn([{name: "event_id", referencedColumnName: "id"}])
    event?: Event;

    @OneToMany(() => PackingItem, (item) => item.entity)
    items: PackingItem[];

    @OneToMany(() => PackingAssignment, (assignment) => assignment.entity)
    assignments: PackingAssignment[];
}
