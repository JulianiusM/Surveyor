/*
 * Copyright 2026 Julian Malovanij
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {BeforeInsert, BeforeUpdate, Column, Entity, Index, JoinColumn, ManyToOne, RelationId} from 'typeorm';
import type {DIETARY} from '../../../../../types/EventTypes';
import {NumericBase} from '../abstract/TrackedBase';
import {EventRegistration} from './EventRegistration';
import {eventDietaryChoices} from '../../../../../common/generated/domainChoices';

@Entity("event_registration_dietary", {schema: "surveyor"})
@Index("uk_registration_choice", ["registration", "choice"], {unique: true})
export class EventRegistrationDietary extends NumericBase {
    @Column("simple-enum", {
        name: "choice",
        enum: eventDietaryChoices
    })
    choice!: DIETARY;

    @Column("varchar", {name: "additional_info", nullable: true, length: 4000})
    additionalInfo?: string | null;

    @RelationId((a: EventRegistrationDietary) => a.registration)
    registrationId!: number;

    @ManyToOne(() => EventRegistration, r => r.dietaryChoices, {onDelete: "CASCADE"})
    @JoinColumn([{name: "registration_id", referencedColumnName: "id"}])
    registration!: EventRegistration;

    /** Normalize a non-null dietary enum before persistence and reject unknown choices. */
    @BeforeInsert()
    @BeforeUpdate()
    private normalizeChoice() {
        // Keep free-form additional information separate; only the enum spelling
        // is canonicalized by this storage hook.
        const v = this.choice;
        if (v != null) {
            const up = String(v).toUpperCase() as DIETARY;
            if (!eventDietaryChoices.includes(up)) {
                throw new Error(`Invalid dietary choice: ${v}`);
            }
            this.choice = up;
        }
    }
}
