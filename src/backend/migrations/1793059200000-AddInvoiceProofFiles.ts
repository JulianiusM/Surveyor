/* Copyright 2026 Julian Malovanij. Licensed under the Apache License, Version 2.0. */
import {Table, type MigrationInterface, type QueryRunner} from 'typeorm';

/** Add durable file ownership without touching uploads or changing invoice wire data. */
export class AddInvoiceProofFiles1793059200000 implements MigrationInterface {
    /** Accept synchronized empty schemas and resume safely after independently committed DDL. */
    async up(queryRunner: QueryRunner): Promise<void> {
        // No invoice foreign key is intentional: cascade deletion must preserve cleanup evidence.
        if (!await queryRunner.hasTable('invoice_proof_files')) {
            await queryRunner.createTable(new Table({name: 'invoice_proof_files', columns: [
                {name: 'id', type: 'char', length: '64', isPrimary: true},
                {name: 'created_at', type: 'timestamp', precision: 6, default: 'CURRENT_TIMESTAMP(6)'},
                {name: 'updated_at', type: 'timestamp', precision: 6, default: 'CURRENT_TIMESTAMP(6)', onUpdate: 'CURRENT_TIMESTAMP(6)'},
                {name: 'path', type: 'varchar', length: '255'},
                {name: 'state', type: 'varchar', length: '16', default: "'STAGED'"},
                {name: 'owner_token', type: 'char', length: '36', isNullable: true},
                {name: 'attempts', type: 'int', unsigned: true, default: '0'},
                {name: 'retry_at', type: 'datetime', isNullable: true},
                {name: 'quarantine_path', type: 'varchar', length: '255', isNullable: true},
                {name: 'manifest_id', type: 'char', length: '64', isNullable: true},
                {name: 'quarantined_at', type: 'datetime', isNullable: true},
            ], indices: [{name: 'idx_invoice_proof_files_scan', columnNames: ['state', 'retry_at']}]}));
        }
        // Backfill each stored spelling, including shared legacy paths. Runtime compares
        // resolved references as well, so aliases can never justify deleting a live file.
        if (await queryRunner.hasTable('event_invoices')) {
            await queryRunner.query(`INSERT IGNORE INTO invoice_proof_files (id, path, state)
                SELECT SHA2(MIN(BINARY proof_path), 256), MIN(BINARY proof_path), 'ATTACHED' FROM event_invoices
                WHERE proof_path IS NOT NULL AND proof_path <> '' GROUP BY BINARY proof_path`);
        }
    }

    /** Refuse to discard any outstanding ownership or recovery evidence on rollback. */
    async down(queryRunner: QueryRunner): Promise<void> {
        // DDL commits independently in MariaDB; complete the preflight before any drop.
        if (!await queryRunner.hasTable('invoice_proof_files')) return;
        const [row] = await queryRunner.query('SELECT COUNT(*) AS count FROM invoice_proof_files');
        if (Number(row.count)) throw new Error('Cannot remove proof ownership while tracked files or recovery records remain.');
        await queryRunner.dropTable('invoice_proof_files');
    }
}
