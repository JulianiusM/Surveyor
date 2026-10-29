/* Copyright 2026 Julian Malovanij. Licensed under the Apache License, Version 2.0. */
import type {MigrationInterface, QueryRunner} from 'typeorm';
import {dropMigrationTable} from '../modules/database/utils/migration-helper';

/** Add durable file ownership without touching uploads or changing invoice wire data. */
export class AddInvoiceProofFiles1793059200000 implements MigrationInterface {
    /** Accept synchronized empty schemas and resume safely after independently committed DDL. */
    async up(queryRunner: QueryRunner): Promise<void> {
        // No invoice foreign key is intentional: cascade deletion must preserve cleanup evidence.
        if (!await queryRunner.hasTable('invoice_proof_files')) {
            await queryRunner.query(`CREATE TABLE \`invoice_proof_files\` (
                \`id\` char(64) NOT NULL,
                \`created_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
                \`updated_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
                \`path\` varchar(255) NOT NULL,
                \`state\` varchar(16) NOT NULL DEFAULT 'STAGED',
                \`owner_token\` char(36) NULL,
                \`attempts\` int UNSIGNED NOT NULL DEFAULT 0,
                \`retry_at\` datetime NULL,
                \`quarantine_path\` varchar(255) NULL,
                \`manifest_id\` char(64) NULL,
                \`quarantined_at\` datetime NULL,
                INDEX \`idx_invoice_proof_files_scan\` (\`state\`, \`retry_at\`),
                PRIMARY KEY (\`id\`)
            ) ENGINE=InnoDB`);
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
        await dropMigrationTable(queryRunner, 'invoice_proof_files');
    }
}
