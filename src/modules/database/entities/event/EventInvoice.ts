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
import {Profile} from "../user/Profile";
import {EventInvoicePool} from "./EventInvoicePool";
import {EventRegistration} from "./EventRegistration";

export type InvoiceStatus = 'NEW' | 'APPROVED' | 'REJECTED' | 'CLOSED' | 'RETRACTED';

@Entity("event_invoices", {schema: "surveyor"})
export class EventInvoice extends NumericBase {
    @ManyToOne(() => EventInvoicePool, (pool) => pool.invoices, {onDelete: "CASCADE", onUpdate: "CASCADE"})
    @JoinColumn([{name: "pool_id", referencedColumnName: "id"}])
    pool!: EventInvoicePool;

    @RelationId((invoice: EventInvoice) => invoice.pool)
    poolId!: string;

    // Organizer-recorded pool costs have no participant reimbursement or attendance record.
    @ManyToOne(() => EventRegistration, {nullable: true, onDelete: "CASCADE", onUpdate: "CASCADE"})
    @JoinColumn([{name: "registration_id", referencedColumnName: "id"}])
    registration!: EventRegistration | null;

    @RelationId((invoice: EventInvoice) => invoice.registration)
    registrationId!: number | null;

    @ManyToOne(() => Profile, {nullable: true, onDelete: "SET NULL", onUpdate: "CASCADE"})
    @JoinColumn({name: "recorded_by_profile_id", referencedColumnName: "id", foreignKeyConstraintName: "FK_event_invoices_recorded_by_profile"})
    recordedByProfile?: Profile | null;

    @RelationId((invoice: EventInvoice) => invoice.recordedByProfile)
    recordedByProfileId?: string | null;

    // Keep creator attribution even if that profile is subsequently removed or renamed.
    @Column("varchar", {name: "recorded_by_name", length: 50, nullable: true})
    recordedByName?: string | null;

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

    // Organizers can correct submitted details without overwriting the participant's original entry.
    @Column("decimal", {name: "corrected_amount", precision: 10, scale: 2, nullable: true})
    correctedAmount?: string | null;

    @Column("text", {name: "corrected_description", nullable: true})
    correctedDescription?: string | null;

    @Column("text", {name: "rejection_reason", nullable: true})
    rejectionReason?: string | null;

    @Column("enum", {name: "status", enum: ["NEW", "APPROVED", "REJECTED", "CLOSED", "RETRACTED"], default: "NEW"})
    status!: InvoiceStatus;
}
