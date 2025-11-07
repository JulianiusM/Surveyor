import {Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn} from "typeorm";
import {EventRegistration} from "./EventRegistration";
import type {DIETARY} from "../../../../types/EventTypes";

@Entity("event_registration_dietary", {schema: "surveyor"})
@Index("uk_registration_choice", ["registrationId", "choice"], {unique: true})
export class EventRegistrationDietary {
    @PrimaryGeneratedColumn({type: "int", name: "id"})
    id!: number;

    @Column("int", {name: "registration_id"})
    registrationId!: number;

    @Column("enum", {
        name: "choice",
        enum: ["MEAT", "FISH", "VEGETARIAN", "VEGAN", "HALAL", "KOSHER", "ALLERGIES"]
    })
    choice!: DIETARY;

    @Column("varchar", {name: "additional_info", nullable: true, length: 255})
    additionalInfo?: string | null;

    @ManyToOne(() => EventRegistration, r => r.dietaryChoices, {onDelete: "CASCADE"})
    @JoinColumn([{name: "registration_id", referencedColumnName: "id"}])
    registration!: EventRegistration;
}