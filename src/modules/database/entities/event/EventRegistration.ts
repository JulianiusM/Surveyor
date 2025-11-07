import {Column, Entity, Index, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn} from "typeorm";
import {Event} from "./Event";
import {User} from "../user/User";
import {Guest} from "../user/Guest";
import {EventRegistrationDietary} from "./EventRegistrationDietary";

@Entity("event_registrations", {schema: "surveyor"})
@Index("uk_event_participant", ["eventId", "userId", "guestId"], {unique: true})
export class EventRegistration {
    @PrimaryGeneratedColumn({type: "int", name: "id"})
    id!: number;

    @Column("varchar", {name: "event_id"})
    eventId!: string;

    @Column("int", {name: "user_id", nullable: true})
    userId?: number | null;

    @Column("int", {name: "guest_id", nullable: true})
    guestId?: number | null;

    @Column("date", {name: "arrival_date"})
    arrivalDate!: string;

    @Column("date", {name: "departure_date"})
    departureDate!: string;

    @Column("timestamp", {name: "created_at", default: () => "CURRENT_TIMESTAMP"})
    createdAt!: Date;

    @ManyToOne(() => Event, {onDelete: "CASCADE", onUpdate: "CASCADE"})
    @JoinColumn([{name: "event_id", referencedColumnName: "id"}])
    event!: Event;

    @ManyToOne(() => User, (u) => u.id, {onDelete: "CASCADE", onUpdate: "RESTRICT"})
    @JoinColumn([{name: "user_id", referencedColumnName: "id"}])
    user?: User | null;

    @ManyToOne(() => Guest, (g) => g.id, {onDelete: "CASCADE", onUpdate: "RESTRICT"})
    @JoinColumn([{name: "guest_id", referencedColumnName: "id"}])
    guest?: Guest | null;

    @OneToMany(() => EventRegistrationDietary, d => d.registration, {cascade: true})
    dietaryChoices!: EventRegistrationDietary[];
}
