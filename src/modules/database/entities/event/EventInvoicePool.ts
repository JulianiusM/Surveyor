import {Column, Entity, JoinColumn, ManyToOne, OneToMany, RelationId,} from "typeorm";
import type {InvoicePoolDistribution, InvoicePoolStatus} from "../../../../types/InvoicePoolTypes";
import {currencyTransformer} from "../../transformers";
import {UuidBase} from "../abstract/TrackedBase";
import {Event} from "./Event";
import {EventInvoice} from "./EventInvoice";
import {EventInvoiceShare} from "./EventInvoiceShare";
import {EventInvoiceSurcharge} from "./EventInvoiceSurcharge";
import {EventPoolAssignment} from "./EventPoolAssignment";
import {EventPoolTakeover} from "./EventPoolTakeover";

export const InvoicePoolDistributions = ['EQUAL', 'TIME_BASED', 'NIGHTS'];

@Entity("event_invoice_pools", {schema: "surveyor"})
export class EventInvoicePool extends UuidBase {
    @ManyToOne(() => Event, (event) => event.eventRegBypassLinks, {onDelete: "CASCADE", onUpdate: "CASCADE"})
    @JoinColumn([{name: "event_id", referencedColumnName: "id"}])
    event!: Event;

    // Store the foreign key for quick filtering without loading the relation
    @RelationId((pool: EventInvoicePool) => pool.event)
    eventId!: string;

    @Column("varchar", {name: "name", length: 255})
    name!: string;

    @Column("text", {name: "description", nullable: true})
    description?: string | null;

    @Column("enum", {name: "status", enum: ["OPEN", "CLOSED"], default: "OPEN"})
    status!: InvoicePoolStatus;

    @Column("enum", {name: "distribution_method", enum: InvoicePoolDistributions, default: "EQUAL"})
    distributionMethod!: InvoicePoolDistribution;

    @Column("tinyint", {
        name: "is_default",
        default: 0
    })
    isDefault!: boolean;

    @Column("tinyint", {
        name: "assign_all",
        default: 1
    })
    assignAll!: boolean;

    // Toggle whether the submitter's invoices reduce their own share during distribution
    @Column("tinyint", {
        name: "subtract_personal_invoices",
        default: 1
    })
    subtractPersonalInvoices!: boolean;

    @Column("decimal", {
        name: "total_amount",
        precision: 10,
        scale: 2,
        default: "0.00",
        transformer: currencyTransformer
    })
    totalAmount!: number;

    @Column("decimal", {
        name: "invoice_amount",
        precision: 10,
        scale: 2,
        default: "0.00",
        transformer: currencyTransformer
    })
    invoiceAmount!: number;

    @Column("decimal", {
        name: "open_amount",
        precision: 10,
        scale: 2,
        default: "0.00",
        transformer: currencyTransformer
    })
    openAmount!: number;

    @Column("decimal", {
        name: "outstanding_amount",
        precision: 10,
        scale: 2,
        default: "0.00",
        transformer: currencyTransformer
    })
    outstandingAmount!: number;

    // Portion of unpaid shares where participants have overpaid and are owed a payout
    @Column("decimal", {
        name: "credit_amount",
        precision: 10,
        scale: 2,
        default: "0.00",
        transformer: currencyTransformer
    })
    creditAmount!: number;

    // Additional per-participant charges added before closing the pool
    @Column("decimal", {
        name: "additional_amount",
        precision: 10,
        scale: 2,
        default: "0.00",
        transformer: currencyTransformer
    })
    additionalAmount!: number;

    // Portion of the surcharges that is removed from the shared pool total
    @Column("decimal", {
        name: "surcharge_offset_amount",
        precision: 10,
        scale: 2,
        default: "0.00",
        transformer: currencyTransformer
    })
    surchargeOffsetAmount!: number;

    // Sum of invoices plus additional per-person charges
    @Column("decimal", {
        name: "payable_amount",
        precision: 10,
        scale: 2,
        default: "0.00",
        transformer: currencyTransformer
    })
    payableAmount!: number;

    @Column("timestamp", {name: "closed_at", nullable: true})
    closedAt?: Date | null;

    @OneToMany(() => EventInvoice, (invoice) => invoice.pool)
    invoices!: EventInvoice[];

    @OneToMany(() => EventPoolAssignment, (assignment) => assignment.pool)
    assignments!: EventPoolAssignment[];

    @OneToMany(() => EventInvoiceShare, (share) => share.pool)
    shares!: EventInvoiceShare[];

    @OneToMany(() => EventPoolTakeover, (takeover) => takeover.pool)
    takeovers!: EventPoolTakeover[];

    @OneToMany(() => EventInvoiceSurcharge, (surcharge) => surcharge.pool)
    surcharges!: EventInvoiceSurcharge[];
}
