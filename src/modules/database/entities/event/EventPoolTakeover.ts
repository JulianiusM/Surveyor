import {Entity, Index, JoinColumn, ManyToOne, RelationId} from "typeorm";
import {NumericBase} from "../abstract/TrackedBase";
import {EventInvoicePool} from "./EventInvoicePool";
import {EventRegistration} from "./EventRegistration";

// Track pre-close agreements where one participant covers another participant's share
@Index("uniq_pool_beneficiary", ["pool", "beneficiaryRegistration"], {unique: true})
@Entity("event_pool_takeovers", {schema: "surveyor"})
export class EventPoolTakeover extends NumericBase {
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
}
