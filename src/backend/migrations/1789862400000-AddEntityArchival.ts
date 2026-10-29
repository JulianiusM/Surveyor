/*
 * Copyright 2026 Julian Malovanij
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import {MigrationInterface, QueryRunner} from 'typeorm';
import {
    addColumnIfNotExists, columnExists, createIndexIfNotExists, dropColumnIfExists, dropIndexIfExists,
    dropMigrationTable, migrationColumnDefinition, recordMigrationGeneratedColumn, tableExists,
} from '../modules/database/utils/migration-helper';

// Match the root entities that inherit BaseEntity.archivedAt. Nested records keep
// their existing relations and lifecycle; this migration neither moves nor deletes them.
const ROOT_TABLES = ['events', 'activity_plans', 'packing_lists', 'drivers_lists', 'surveys'];
// Only these roots have a date period from which an independent schedule can be derived.
const DATED_TABLES = ['events', 'activity_plans'];
const PREFERENCES = 'entity_visibility_preferences';

export class AddEntityArchival1789862400000 implements MigrationInterface {
    name = 'AddEntityArchival1789862400000';

    /** Add resumable lifecycle/schedule metadata and private visibility storage
     * with parent-compatible UUID columns and defaults preserving current state. */
    public async up(queryRunner: QueryRunner): Promise<void> {
        // NULL means no direct archival. Adding the nullable column leaves existing
        // roots active until an organizer or the configured background job archives them.
        for (const table of ROOT_TABLES) {
            if (await tableExists(queryRunner, table)) {
                await addColumnIfNotExists(queryRunner, table, 'archived_at', 'datetime', 'NULL');
            }
        }
        for (const table of DATED_TABLES) {
            if (!await tableExists(queryRunner, table)) {
                continue;
            }
            // Existing roots follow automatic scheduling by default. A later manual
            // restoration sets this durable pause instead of rewriting the date period.
            await addColumnIfNotExists(queryRunner, table, 'auto_archive_paused', 'tinyint', 'NOT NULL DEFAULT 0');
            // Equality filters lead the index, followed by the sweep's (end_date, id)
            // cursor. Activity plans also filter event_id IS NULL because linked plans
            // follow their event's archival and never run an independent schedule.
            const columns = table === 'events'
                ? '`archived_at`, `auto_archive_paused`, `end_date`, `id`'
                : '`archived_at`, `auto_archive_paused`, `event_id`, `end_date`, `id`';
            await createIndexIfNotExists(queryRunner, table, `idx_${table}_auto_archive`, columns);
        }
        // Fresh installations synchronize current metadata first; migrations must accept
        // that schema. The guards also let the migration resume after MariaDB has committed
        // some DDL before a later statement fails; they do not rewrite existing state.
        if (!await tableExists(queryRunner, PREFERENCES)) {
            const profileId = (await queryRunner.getTable('profiles'))?.findColumnByName('id');
            if (!profileId) {
                throw new Error('Cannot add visibility preferences without profiles.id.');
            }
            // Existing installations may use different UUID storage/collations. Match
            // the actual parent column so MariaDB can create a compatible foreign key.
            const profileColumn = profileId.clone();
            // Reuse only the parent's physical UUID definition. This is a relation
            // column, so it must not inherit the parent's identity/default constraints.
            profileColumn.name = 'profile_id';
            profileColumn.isPrimary = false;
            profileColumn.isUnique = false;
            profileColumn.isGenerated = false;
            profileColumn.generationStrategy = undefined;
            profileColumn.default = undefined;
            profileColumn.isNullable = true; // Matches NumericProfileBase's existing profile relation.
            // Polymorphic targets have no root FK. The profile FK and unique
            // target choice retain the original cascade and index definitions.
            await queryRunner.query(`CREATE TABLE \`${PREFERENCES}\` (
                \`id\` int NOT NULL AUTO_INCREMENT,
                \`created_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
                \`updated_at\` timestamp(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
                ${await migrationColumnDefinition(queryRunner, 'profiles', 'id', profileColumn)},
                \`entity_type\` varchar(32) NOT NULL,
                \`entity_id\` char(36) NOT NULL,
                \`visibility\` enum ('HIDDEN', 'SHOWN') NOT NULL,
                UNIQUE INDEX \`uk_entity_visibility_profile_target\` (\`profile_id\`, \`entity_type\`, \`entity_id\`),
                INDEX \`idx_entity_visibility_target\` (\`entity_type\`, \`entity_id\`),
                CONSTRAINT \`FK_entity_visibility_profile\` FOREIGN KEY (\`profile_id\`) REFERENCES \`profiles\` (\`id\`)
                    ON DELETE CASCADE ON UPDATE CASCADE,
                PRIMARY KEY (\`id\`)
            ) ENGINE=InnoDB`);
            if (profileColumn.generatedType && profileColumn.asExpression) {
                await recordMigrationGeneratedColumn(queryRunner, PREFERENCES, profileColumn);
            }
        }
    }

    /** Check all organizer/private state before any MariaDB DDL, then remove
     * only archival preferences, dependent indexes and lifecycle columns in order. */
    public async down(queryRunner: QueryRunner): Promise<void> {
        // Preflight every table before any DDL: MariaDB implicitly commits schema changes.
        // Refuse to discard organizer state or private choices silently. A transaction
        // cannot undo a partially executed rollback, so all checks precede all drops.
        for (const table of ROOT_TABLES) {
            if (await columnExists(queryRunner, table, 'archived_at')) {
                const [row] = await queryRunner.query(`SELECT COUNT(*) AS count FROM \`${table}\` WHERE archived_at IS NOT NULL`);
                if (Number(row.count)) {
                    throw new Error('Cannot revert archival while archived entities exist. Restore them explicitly first.');
                }
            }
        }
        for (const table of DATED_TABLES) {
            // A pause is meaningful even on an active root: losing it during rollback
            // would erase the organizer's scheduling choice on a later upgrade.
            if (await columnExists(queryRunner, table, 'auto_archive_paused')) {
                const [row] = await queryRunner.query(`SELECT COUNT(*) AS count FROM \`${table}\` WHERE auto_archive_paused <> 0`);
                if (Number(row.count)) {
                    throw new Error('Cannot revert archival while automatic archival is paused. Resume it explicitly first.');
                }
            }
        }
        if (await tableExists(queryRunner, PREFERENCES)) {
            // Include retained preferences for deleted roots. They still represent
            // stored profile data and must not be silently discarded during rollback.
            const [row] = await queryRunner.query(`SELECT COUNT(*) AS count FROM \`${PREFERENCES}\``);
            if (Number(row.count)) {
                throw new Error('Cannot revert archival while personal visibility preferences exist. Reset them explicitly first.');
            }
        }
        if (await tableExists(queryRunner, PREFERENCES)) {
            await dropMigrationTable(queryRunner, PREFERENCES);
        }
        for (const table of DATED_TABLES) {
            // Remove indexes before their columns, then remove the shared timestamp
            // from every root. Existing business tables and file references stay intact.
            await dropIndexIfExists(queryRunner, table, `idx_${table}_auto_archive`);
            await dropColumnIfExists(queryRunner, table, 'auto_archive_paused');
        }
        for (const table of ROOT_TABLES) {
            await dropColumnIfExists(queryRunner, table, 'archived_at');
        }
    }
}
