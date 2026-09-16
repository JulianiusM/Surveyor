/*
 * Copyright 2026 Julian Malovanij
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import {MigrationInterface, QueryRunner, Table, TableColumn, TableForeignKey, TableIndex} from 'typeorm';
import {
    addColumnIfNotExists, columnExists, createIndexIfNotExists, dropColumnIfExists, dropIndexIfExists, tableExists,
} from '../modules/database/utils/migration-helper';

// Match the root entities that inherit BaseEntity.archivedAt. Nested records keep
// their existing relations and lifecycle; this migration neither moves nor deletes them.
const ROOT_TABLES = ['events', 'activity_plans', 'packing_lists', 'drivers_lists', 'surveys'];
// Only these roots have a date period from which an independent schedule can be derived.
const DATED_TABLES = ['events', 'activity_plans'];
const PREFERENCES = 'entity_visibility_preferences';

export class AddEntityArchival1789862400000 implements MigrationInterface {
    name = 'AddEntityArchival1789862400000';

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
            await queryRunner.createTable(new Table({
                name: PREFERENCES,
                columns: [
                    new TableColumn({name: 'id', type: 'int', isPrimary: true, isGenerated: true, generationStrategy: 'increment'}),
                    new TableColumn({name: 'created_at', type: 'timestamp', precision: 6, default: 'CURRENT_TIMESTAMP(6)'}),
                    new TableColumn({name: 'updated_at', type: 'timestamp', precision: 6, default: 'CURRENT_TIMESTAMP(6)', onUpdate: 'CURRENT_TIMESTAMP(6)'}),
                    profileColumn,
                    // A type/id pair can refer to any root table and therefore cannot
                    // have one root foreign key. Normal domain deletion may leave an
                    // inert preference; only existing overview roots consume these rows.
                    new TableColumn({name: 'entity_type', type: 'varchar', length: '32'}),
                    new TableColumn({name: 'entity_id', type: 'char', length: '36'}),
                    new TableColumn({name: 'visibility', type: 'enum', enum: ['HIDDEN', 'SHOWN']}),
                ],
                indices: [
                    // One explicit choice is shared by all appearances of the same
                    // root in this profile's participation and administration overviews.
                    new TableIndex({name: 'uk_entity_visibility_profile_target', columnNames: ['profile_id', 'entity_type', 'entity_id'], isUnique: true}),
                    new TableIndex({name: 'idx_entity_visibility_target', columnNames: ['entity_type', 'entity_id']}),
                ],
                foreignKeys: [new TableForeignKey({
                    // Profiles have a concrete table, so their preferences can use the
                    // same database cascade as other profile-owned settings/relations.
                    name: 'FK_entity_visibility_profile', columnNames: ['profile_id'], referencedTableName: 'profiles',
                    referencedColumnNames: ['id'], onDelete: 'CASCADE', onUpdate: 'CASCADE',
                })],
            }));
        }
    }

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
            await queryRunner.dropTable(PREFERENCES);
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
