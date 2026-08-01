import {Column, Entity, JoinColumn, ManyToOne, OneToMany, RelationId} from "typeorm";
import {NumericProfileBase} from "../abstract/Base";
import {Event} from "./Event";
import {EventRegistrationDietary} from "./EventRegistrationDietary";

@Entity("event_registrations", {schema: "surveyor"})
export class EventRegistration extends NumericProfileBase {
    @Column("date", {name: "arrival_date"})
    arrivalDate!: string;

    @Column("date", {name: "departure_date"})
    departureDate!: string;

    @RelationId((r: EventRegistration) => r.event)
    eventId!: string;

    @ManyToOne(() => Event, {onDelete: "CASCADE", onUpdate: "CASCADE"})
    @JoinColumn([{name: "event_id", referencedColumnName: "id"}])
    event!: Event;

    @OneToMany(() => EventRegistrationDietary, d => d.registration, {cascade: true})
    dietaryChoices!: EventRegistrationDietary[];
}
