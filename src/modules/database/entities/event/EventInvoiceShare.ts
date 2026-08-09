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
import {currencyTransformer} from "../../transformers";
import {NumericBase} from "../abstract/TrackedBase";
import {EventInvoicePool} from "./EventInvoicePool";
import {EventRegistration} from "./EventRegistration";

@Entity("event_invoice_shares", {schema: "surveyor"})
export class EventInvoiceShare extends NumericBase {
    @ManyToOne(() => EventInvoicePool, (pool) => pool.shares, {onDelete: "CASCADE", onUpdate: "CASCADE"})
    @JoinColumn([{name: "pool_id", referencedColumnName: "id"}])
    pool!: EventInvoicePool;

    @RelationId((share: EventInvoiceShare) => share.pool)
    poolId!: string;

    @ManyToOne(() => EventRegistration, {onDelete: "CASCADE", onUpdate: "CASCADE"})
    @JoinColumn([{name: "registration_id", referencedColumnName: "id"}])
    registration!: EventRegistration;

    @RelationId((share: EventInvoiceShare) => share.registration)
    registrationId!: number;

    @Column("decimal", {
        name: "base_share_amount",
        precision: 10,
        scale: 2,
        transformer: currencyTransformer,
    })
    baseShareAmount!: number;

    @Column("decimal", {
        name: "extra_amount",
        precision: 10,
        scale: 2,
        default: "0.00",
        transformer: currencyTransformer
    })
    extraAmount!: number;

    // Amount of the participant's own invoices credited against their share
    @Column("decimal", {
        name: "invoice_credit_amount",
        precision: 10,
        scale: 2,
        default: "0.00",
        transformer: currencyTransformer,
    })
    invoiceCreditAmount!: number;

    // Store the fully burdened total (base + extras) that the payer owes
    @Column("decimal", {name: "share_amount", precision: 10, scale: 2, transformer: currencyTransformer})
    shareAmount!: number;

    @Column("text", {name: "note", nullable: true})
    note?: string | null;

    @Column("tinyint", {
        name: "is_paid",
        default: 0
    })
    isPaid!: boolean;

    @Column("timestamp", {name: "paid_at", nullable: true})
    paidAt?: Date | null;
}
