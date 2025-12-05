import {Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, RelationId} from "typeorm";
import {EventInvoicePool} from "./EventInvoicePool";
import {EventRegistration} from "./EventRegistration";

/**
 * Additional charge assigned to a participant before a pool is closed.
 * This is paid only by the participant (or their covering payer) rather than split evenly.
 */
@Entity("event_invoice_surcharges", {schema: "surveyor"})
export class EventInvoiceSurcharge {
    @PrimaryGeneratedColumn({type: "int", name: "id"})
    id!: number;

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
    @Column("tinyint", {name: "subtract_from_pool", width: 1, default: 1})
    subtractFromPool!: boolean;

    @Column("timestamp", {name: "created_at", default: () => "CURRENT_TIMESTAMP"})
    createdAt!: Date;
}
