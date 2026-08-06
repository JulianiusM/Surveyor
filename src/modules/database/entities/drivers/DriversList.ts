import {Entity, JoinColumn, ManyToOne, OneToMany, RelationId,} from "typeorm";
import {DefaultEntity} from "../abstract/BaseEntity";
import {Event} from "../event/Event";
import {DriversAssignment} from "./DriversAssignment";
import {DriversItem} from "./DriversItem";

@Entity("drivers_lists", {schema: "surveyor"})
export class DriversList extends DefaultEntity {
    @RelationId((r: DriversList) => r.event)
    eventId?: string;

    @ManyToOne(() => Event, {onDelete: "CASCADE", onUpdate: "CASCADE"})
    @JoinColumn([{name: "event_id", referencedColumnName: "id"}])
    event?: Event;

    @OneToMany(() => DriversItem, (item) => item.entity)
    items: DriversItem[];

    @OneToMany(() => DriversAssignment, (assignment) => assignment.entity)
    assignments: DriversAssignment[];
}
