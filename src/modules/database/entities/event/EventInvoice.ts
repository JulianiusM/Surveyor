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

import {Column, Entity, JoinColumn, ManyToOne, RelationId,} from "typeorm";
import {NumericBase} from "../abstract/TrackedBase";
import {EventInvoicePool} from "./EventInvoicePool";
import {EventRegistration} from "./EventRegistration";

export type InvoiceStatus = 'NEW' | 'APPROVED' | 'CLOSED';

@Entity("event_invoices", {schema: "surveyor"})
export class EventInvoice extends NumericBase {
    @ManyToOne(() => EventInvoicePool, (pool) => pool.invoices, {onDelete: "CASCADE", onUpdate: "CASCADE"})
    @JoinColumn([{name: "pool_id", referencedColumnName: "id"}])
    pool!: EventInvoicePool;

    @RelationId((invoice: EventInvoice) => invoice.pool)
    poolId!: string;

    @ManyToOne(() => EventRegistration, {onDelete: "CASCADE", onUpdate: "CASCADE"})
    @JoinColumn([{name: "registration_id", referencedColumnName: "id"}])
    registration!: EventRegistration;

    @RelationId((invoice: EventInvoice) => invoice.registration)
    registrationId!: number;

    @Column("decimal", {name: "amount", precision: 10, scale: 2})
    amount!: string;

    // Persist path and metadata for the uploaded proof (image or PDF)
    @Column("varchar", {name: "proof_path", length: 255, nullable: true})
    proofPath?: string | null;

    @Column("varchar", {name: "proof_name", length: 255, nullable: true})
    proofOriginalName?: string | null;

    @Column("varchar", {name: "proof_mime", length: 80, nullable: true})
    proofMimeType?: string | null;

    @Column("text", {name: "description", nullable: true})
    description?: string | null;

    @Column("enum", {name: "status", enum: ["NEW", "APPROVED", "CLOSED"], default: "NEW"})
    status!: InvoiceStatus;
}
