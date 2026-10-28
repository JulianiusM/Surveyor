/*
 * Copyright 2026 Julian Malovanij
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type {MigrationInterface, QueryRunner} from "typeorm";
import type {MigrationReference} from '../../types/MigrationTypes';
import {
    applyMigrationReferences,
    assertMigrationColumnCanBeRetired,
    dropColumnIfExists,
    prepareMigrationReferences,
} from "../modules/database/utils/migration-helper";

const ownerReferences: readonly MigrationReference[] = [
    {table: 'packing_items', column: 'user_id', referencedTable: 'users', referencedColumn: 'id',
        foreignKey: {name: 'FK_a0bad64d810ac4e76c23b86785d', onDelete: 'CASCADE', onUpdate: 'RESTRICT'}},
    {table: 'packing_items', column: 'guest_id', referencedTable: 'guests', referencedColumn: 'id',
        foreignKey: {name: 'FK_9cbf247de70a55b58841e7b0941', onDelete: 'CASCADE', onUpdate: 'RESTRICT'}},
    {table: 'activity_slots', column: 'user_id', referencedTable: 'users', referencedColumn: 'id',
        foreignKey: {name: 'FK_01ebc30d7c6c9f3c764be121cda', onDelete: 'CASCADE', onUpdate: 'RESTRICT'}},
    {table: 'activity_slots', column: 'guest_id', referencedTable: 'guests', referencedColumn: 'id',
        foreignKey: {name: 'FK_c4e8f0a94193ce0883305a90e88', onDelete: 'CASCADE', onUpdate: 'RESTRICT'}},
];

export class AddItemOwners1785163809347 implements MigrationInterface {
    name = 'AddItemOwners1785163809347'

    /** Validate every old/partial reference before DDL, preserving all populated
     * compatible values and matching actual native/text/binary identifier storage. */
    public async up(queryRunner: QueryRunner): Promise<void> {
        const references = await prepareMigrationReferences(queryRunner, ownerReferences);
        // Never use transactional rollback as evidence that earlier MariaDB DDL
        // disappeared. Only completely admitted, additive changes may begin.
        await applyMigrationReferences(queryRunner, references);
    }

    /** Refuse reversal before mutation when ownership or dependent constraints
     * need these columns; populated installations require the paired restore. */
    public async down(queryRunner: QueryRunner): Promise<void> {
        const plans = await prepareMigrationReferences(queryRunner, ownerReferences);
        for (const plan of plans) {
            if (plan.action === 'add') continue;
            const {table, column} = plan.reference;
            await assertMigrationColumnCanBeRetired(queryRunner, table, column);
            const populated = await queryRunner.query(`SELECT 1 FROM \`${table}\` WHERE \`${column}\` IS NOT NULL LIMIT 1`);
            if (populated.length) throw new Error(`Cannot reverse item ownership while ${table}.${column} is populated; use the paired restore`);
        }
        // All columns are proven unassigned before the first constraint is dropped.
        // Retain retryability even when a compatible FK has a different name.
        for (const reference of [...ownerReferences].reverse()) {
            const table = await queryRunner.getTable(reference.table);
            for (const key of table?.foreignKeys.filter(key => key.columnNames.includes(reference.column)) ?? []) {
                await queryRunner.dropForeignKey(reference.table, key);
            }
            await dropColumnIfExists(queryRunner, reference.table, reference.column);
        }
    }

}
