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

import {QueryRunner} from "typeorm";

/** Test a column name inside the connection's current schema, without changing it. */
export async function columnExists(
    queryRunner: QueryRunner,
    table: string,
    column: string
): Promise<boolean> {
    // Bind object names as metadata values rather than interpolating a target schema.
    const result = await queryRunner.query(
        `
            SELECT COUNT(*) as count
            FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = ?
              AND COLUMN_NAME = ?
        `,
        [table, column]
    );

    return result[0].count > 0;
}

/** Test one migration-authored constraint in this connection's schema. */
export async function constraintExists(
    queryRunner: QueryRunner,
    table: string,
    constraint: string
): Promise<boolean> {
    // Restrict information_schema to DATABASE() before answering the migration guard.
    const result = await queryRunner.query(
        `
            SELECT COUNT(*) as count
            FROM information_schema.TABLE_CONSTRAINTS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = ?
              AND CONSTRAINT_NAME = ?
        `,
        [table, constraint]
    );

    return result[0].count > 0;
}

/** Test one table name in the active schema without selecting application records. */
export async function tableExists(
    queryRunner: QueryRunner,
    table: string
): Promise<boolean> {
    // The caller's selected connection owns the target; no fallback database is used.
    const result = await queryRunner.query(
        `
            SELECT COUNT(*) as count
            FROM information_schema.TABLES
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = ?
        `,
        [table]
    );

    return result[0].count > 0;
}

/** Test a named index on one table in the already selected migration schema. */
export async function indexExists(
    queryRunner: QueryRunner,
    table: string,
    index: string
): Promise<boolean> {
    // Bound table/index metadata values keep this guard local to DATABASE().
    const result = await queryRunner.query(
        `
            SELECT COUNT(*) as count
            FROM information_schema.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = ?
              AND INDEX_NAME = ?
        `,
        [table, index]
    );

    return result[0].count > 0;
}

export async function addColumn(queryRunner: QueryRunner, table: string, column: string, type: string, params: string = '') {
    return await queryRunner.query(`ALTER TABLE \`${table}\`
        ADD \`${column}\` ${type} ${params}`);
}

/** Apply a migration-authored column definition only when its metadata is absent. */
export async function addColumnIfNotExists(queryRunner: QueryRunner, table: string, column: string, type: string, params?: string) {
    // Reuse this same runner for the existence check and the existing DDL operation.
    if (!await columnExists(queryRunner, table, column)) {
        return await addColumn(queryRunner, table, column, type, params);
    }
}

export async function dropColumn(queryRunner: QueryRunner, table: string, column: string) {
    return await queryRunner.query(`ALTER TABLE \`${table}\`
        DROP COLUMN \`${column}\``);
}

/** Preserve an idempotent migration drop using the current connection's metadata. */
export async function dropColumnIfExists(queryRunner: QueryRunner, table: string, column: string) {
    // An absent column remains a no-op rather than an unconditional DDL failure.
    if (await columnExists(queryRunner, table, column)) {
        return await dropColumn(queryRunner, table, column);
    }
}

export async function createConstraint(queryRunner: QueryRunner, table: string, constraint: string, definition: string) {
    return await queryRunner.query(`ALTER TABLE \`${table}\`
        ADD CONSTRAINT \`${constraint}\` ${definition}`);
}

/** Create the supplied migration constraint only after a same-schema absence check. */
export async function createConstraintIfNotExists(queryRunner: QueryRunner, table: string, constraint: string, definition: string) {
    // Definition text is owned by the migration; this helper changes no validation policy.
    if (!await constraintExists(queryRunner, table, constraint)) {
        return await createConstraint(queryRunner, table, constraint, definition);
    }
}

export async function dropFkConstraint(queryRunner: QueryRunner, table: string, constraint: string) {
    return await queryRunner.query(`ALTER TABLE \`${table}\`
        DROP FOREIGN KEY \`${constraint}\``);
}

/** Drop a migration-selected foreign key only while its named constraint exists. */
export async function dropFkConstraintIfExists(queryRunner: QueryRunner, table: string, constraint: string) {
    // The guard and DDL use the same runner and retain the caller's operation order.
    if (await constraintExists(queryRunner, table, constraint)) {
        return await dropFkConstraint(queryRunner, table, constraint);
    }
}

/** Create a nonunique migration index if this schema does not already contain it. */
export async function createIndexIfNotExists(queryRunner: QueryRunner, table: string, index: string, columns: string) {
    // Identifiers/column expressions remain migration-authored; existing indexes are retained.
    if (!await indexExists(queryRunner, table, index)) {
        return await queryRunner.query(`CREATE INDEX \`${index}\` ON \`${table}\` (${columns})`);
    }
}

/** Create the requested unique migration index only when its name is absent. */
export async function createUniqueIndexIfNotExists(queryRunner: QueryRunner, table: string, index: string, columns: string) {
    // Preserve existing data/constraint failure behavior by delegating the same DDL.
    if (!await indexExists(queryRunner, table, index)) {
        return await queryRunner.query(`CREATE UNIQUE INDEX \`${index}\` ON \`${table}\` (${columns})`);
    }
}

/** Drop only an existing migration-selected index on the current connection. */
export async function dropIndexIfExists(queryRunner: QueryRunner, table: string, index: string) {
    // Missing metadata retains the old idempotent no-op path.
    if (await indexExists(queryRunner, table, index)) {
        return await queryRunner.query(`DROP INDEX \`${index}\` ON \`${table}\``);
    }
}
