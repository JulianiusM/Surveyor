import {
    Column,
    Entity,
    JoinColumn,
    ManyToOne,
    PrimaryGeneratedColumn,
    RelationId,
} from "typeorm";
import {EventInvoicePool} from "./EventInvoicePool";
import {EventRegistration} from "./EventRegistration";

export type InvoiceStatus = 'NEW' | 'APPROVED' | 'CLOSED';

@Entity("event_invoices", {schema: "surveyor"})
export class EventInvoice {
    @PrimaryGeneratedColumn({type: "int", name: "id"})
    id!: number;

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

    @Column("timestamp", {name: "created_at", default: () => "CURRENT_TIMESTAMP"})
    createdAt!: Date;

    @Column("timestamp", {name: "updated_at", default: () => "CURRENT_TIMESTAMP"})
    updatedAt!: Date;
}
