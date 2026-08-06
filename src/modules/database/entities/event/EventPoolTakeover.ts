import {Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, RelationId} from "typeorm";
import {EventInvoicePool} from "./EventInvoicePool";
import {EventRegistration} from "./EventRegistration";

// Track pre-close agreements where one participant covers another participant's share
@Index("uniq_pool_beneficiary", ["pool", "beneficiaryRegistration"], {unique: true})
@Entity("event_pool_takeovers", {schema: "surveyor"})
export class EventPoolTakeover {
    @PrimaryGeneratedColumn({type: "int", name: "id"})
    id!: number;

    @ManyToOne(() => EventInvoicePool, (pool) => pool.takeovers, {onDelete: "CASCADE", onUpdate: "CASCADE"})
    @JoinColumn([{name: "pool_id", referencedColumnName: "id"}])
    pool!: EventInvoicePool;

    @RelationId((takeover: EventPoolTakeover) => takeover.pool)
    poolId!: string;

    @ManyToOne(() => EventRegistration, {onDelete: "CASCADE", onUpdate: "CASCADE"})
    @JoinColumn([{name: "payer_registration_id", referencedColumnName: "id"}])
    payerRegistration!: EventRegistration;

    @RelationId((takeover: EventPoolTakeover) => takeover.payerRegistration)
    payerRegistrationId!: number;

    @ManyToOne(() => EventRegistration, {onDelete: "CASCADE", onUpdate: "CASCADE"})
    @JoinColumn([{name: "beneficiary_registration_id", referencedColumnName: "id"}])
    beneficiaryRegistration!: EventRegistration;

    @RelationId((takeover: EventPoolTakeover) => takeover.beneficiaryRegistration)
    beneficiaryRegistrationId!: number;

    @Column("timestamp", {name: "created_at", default: () => "CURRENT_TIMESTAMP"})
    createdAt!: Date;
}
