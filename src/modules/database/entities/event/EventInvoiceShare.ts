import {Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, RelationId} from "typeorm";
import {EventInvoicePool} from "./EventInvoicePool";
import {EventRegistration} from "./EventRegistration";
import {formatAmount, toAmount} from "../../../lib/util";

const currencyTransformer = {
    to: (value: number | string) => formatAmount(toAmount(value)),
    from: (value: string) => Number(value),
};

@Entity("event_invoice_shares", {schema: "surveyor"})
export class EventInvoiceShare {
    @PrimaryGeneratedColumn({type: "int", name: "id"})
    id!: number;

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

    @Column("decimal", {name: "extra_amount", precision: 10, scale: 2, default: "0.00", transformer: currencyTransformer})
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

    @Column("tinyint", {name: "is_paid", width: 1, default: 0})
    isPaid!: boolean;

    @Column("timestamp", {name: "paid_at", nullable: true})
    paidAt?: Date | null;

    @Column("timestamp", {name: "created_at", default: () => "CURRENT_TIMESTAMP"})
    createdAt!: Date;
}
