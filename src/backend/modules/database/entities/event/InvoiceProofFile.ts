/* Copyright 2026 Julian Malovanij. Licensed under the Apache License, Version 2.0. */
import {Column, Entity, Index, PrimaryColumn} from 'typeorm';
import {TrackedBase} from '../abstract/TrackedBase';
import type {InvoiceProofFileState} from '../../../../../types/InvoiceProofTypes';

/** Retain proof ownership through every invoice/registration/Event cascade.
 * There is deliberately no cascading foreign key to a business record. */
@Entity('invoice_proof_files', {schema: 'surveyor'})
@Index('idx_invoice_proof_files_scan', ['state', 'retryAt'])
export class InvoiceProofFile extends TrackedBase {
    @PrimaryColumn('char', {name: 'id', length: 64})
    id!: string;

    @Column('varchar', {name: 'path', length: 255})
    path!: string;

    @Column('varchar', {name: 'state', length: 16, default: 'STAGED'})
    state!: InvoiceProofFileState;

    @Column('char', {name: 'owner_token', length: 36, nullable: true})
    ownerToken!: string | null;

    @Column('int', {name: 'attempts', unsigned: true, default: 0})
    attempts!: number;

    @Column('datetime', {name: 'retry_at', nullable: true})
    retryAt!: Date | null;

    @Column('varchar', {name: 'quarantine_path', length: 255, nullable: true})
    quarantinePath!: string | null;

    @Column('char', {name: 'manifest_id', length: 64, nullable: true})
    manifestId!: string | null;

    @Column('datetime', {name: 'quarantined_at', nullable: true})
    quarantinedAt!: Date | null;
}
