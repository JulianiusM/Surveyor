import {BeforeInsert, BeforeUpdate, Column, Entity, Index, JoinColumn, ManyToOne, RelationId} from "typeorm";
import type {DIETARY} from "../../../../types/EventTypes";
import {NumericBase} from "../abstract/TrackedBase";
import {EventRegistration} from "./EventRegistration";

export const ALLOWED_DIETARY: DIETARY[] = ["MEAT", "FISH", "VEGETARIAN", "VEGAN", "HALAL", "KOSHER", "ALLERGIES", "COMMENT"];

@Entity("event_registration_dietary", {schema: "surveyor"})
@Index("uk_registration_choice", ["registration", "choice"], {unique: true})
export class EventRegistrationDietary extends NumericBase {
    @Column("simple-enum", {
        name: "choice",
        enum: ALLOWED_DIETARY
    })
    choice!: DIETARY;

    @Column("varchar", {name: "additional_info", nullable: true, length: 255})
    additionalInfo?: string | null;

    @RelationId((a: EventRegistrationDietary) => a.registration)
    registrationId!: number;

    @ManyToOne(() => EventRegistration, r => r.dietaryChoices, {onDelete: "CASCADE"})
    @JoinColumn([{name: "registration_id", referencedColumnName: "id"}])
    registration!: EventRegistration;

    @BeforeInsert()
    @BeforeUpdate()
    private normalizeChoice() {
        const v = this.choice;
        if (v != null) {
            const up = String(v).toUpperCase() as DIETARY;
            if (!ALLOWED_DIETARY.includes(up)) {
                throw new Error(`Invalid dietary choice: ${v}`);
            }
            this.choice = up;
        }
    }
}