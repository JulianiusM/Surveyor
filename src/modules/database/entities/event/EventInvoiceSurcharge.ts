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

import {Column, Entity, JoinColumn, ManyToOne, RelationId} from "typeorm";
import {NumericBase} from "../abstract/TrackedBase";
import {EventInvoicePool} from "./EventInvoicePool";
import {EventRegistration} from "./EventRegistration";

/**
 * Additional charge assigned to a participant before a pool is closed.
 * This is paid only by the participant (or their covering payer) rather than split evenly.
 */
@Entity("event_invoice_surcharges", {schema: "surveyor"})
export class EventInvoiceSurcharge extends NumericBase {
    @ManyToOne(() => EventInvoicePool, (pool) => pool.surcharges, {onDelete: "CASCADE", onUpdate: "CASCADE"})
    @JoinColumn([{name: "pool_id", referencedColumnName: "id"}])
    pool!: EventInvoicePool;

    // Capture FK for quick filtering without full relation load
    @RelationId((surcharge: EventInvoiceSurcharge) => surcharge.pool)
    poolId!: string;

    @ManyToOne(() => EventRegistration, {onDelete: "CASCADE", onUpdate: "CASCADE"})
    @JoinColumn([{name: "registration_id", referencedColumnName: "id"}])
    registration!: EventRegistration;

    @RelationId((surcharge: EventInvoiceSurcharge) => surcharge.registration)
    registrationId!: number;

    @Column("decimal", {name: "amount", precision: 10, scale: 2})
    amount!: string;

    // Required note so participants see why the surcharge applies
    @Column("text", {name: "note"})
    note!: string;

    // Whether this surcharge should be removed from the shared pool total
    @Column("tinyint", {
        name: "subtract_from_pool",
        default: 1
    })
    subtractFromPool!: boolean;
}
