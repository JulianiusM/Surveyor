import {Column, Entity, JoinColumn, ManyToOne, RelationId} from "typeorm";
import {NumericBase} from "../abstract/TrackedBase";
import {EventInvoicePool} from "./EventInvoicePool";
import {EventRegistration} from "./EventRegistration";

@Entity("event_invoice_assignments", {schema: "surveyor"})
export class EventPoolAssignment extends NumericBase {
    @ManyToOne(() => EventInvoicePool, (pool) => pool.assignments, {onDelete: "CASCADE", onUpdate: "CASCADE"})
    @JoinColumn([{name: "pool_id", referencedColumnName: "id"}])
    pool!: EventInvoicePool;

    // Keep raw relation ids handy for lightweight queries and tests
    @RelationId((assignment: EventPoolAssignment) => assignment.pool)
    poolId!: string;

    @ManyToOne(() => EventRegistration, {onDelete: "CASCADE", onUpdate: "CASCADE"})
    @JoinColumn([{name: "registration_id", referencedColumnName: "id"}])
    registration!: EventRegistration;

    @RelationId((assignment: EventPoolAssignment) => assignment.registration)
    registrationId!: number;

    // Exempt participants skip automatic share calculation but still allow manual surcharges
    @Column("tinyint", {
        name: "is_exempt",
        default: 0
    })
    isExempt!: boolean;
}
