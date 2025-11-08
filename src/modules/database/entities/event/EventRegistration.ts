import {Column, Entity, Index, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn, RelationId} from "typeorm";
import {Event} from "./Event";
import {User} from "../user/User";
import {Guest} from "../user/Guest";
import {EventRegistrationDietary} from "./EventRegistrationDietary";

@Entity("event_registrations", {schema: "surveyor"})
@Index("uk_event_participant", ["event", "user", "guest"], {unique: true})
export class EventRegistration {
    @PrimaryGeneratedColumn({type: "int", name: "id"})
    id!: number;

    @Column("date", {name: "arrival_date"})
    arrivalDate!: string;

    @Column("date", {name: "departure_date"})
    departureDate!: string;

    @Column("timestamp", {name: "created_at", default: () => "CURRENT_TIMESTAMP"})
    createdAt!: Date;

    @ManyToOne(() => Event, {onDelete: "CASCADE", onUpdate: "CASCADE"})
    @JoinColumn([{name: "event_id", referencedColumnName: "id"}])
    event!: Event;

    @RelationId((a: EventRegistration) => a.user)
    userId?: number;

    @ManyToOne(() => User, (u) => u.eventRegistrations, {onDelete: "CASCADE", onUpdate: "RESTRICT"})
    @JoinColumn([{name: "user_id", referencedColumnName: "id"}])
    user?: User | null;

    @RelationId((a: EventRegistration) => a.guest)
    guestId?: number;

    @ManyToOne(() => Guest, (g) => g.eventRegistrations, {onDelete: "CASCADE", onUpdate: "RESTRICT"})
    @JoinColumn([{name: "guest_id", referencedColumnName: "id"}])
    guest?: Guest | null;

    @OneToMany(() => EventRegistrationDietary, d => d.registration, {cascade: true})
    dietaryChoices!: EventRegistrationDietary[];
}
