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

import {TableForeignKey, type QueryRunner, type Table} from "typeorm";
import type {MigrationColumnStorage, MigrationReference, MigrationReferencePlan} from '../../../../types/MigrationTypes';

/** Quote only migration-authored identifiers, never arbitrary SQL fragments. */
function migrationIdentifier(value: string): string {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(value)) throw new Error('Unsupported migration identifier');
    return `\`${value}\``;
}

/** Read physical storage without normalizing native UUIDs or binary encodings.
 * The returned definition deliberately excludes identity, uniqueness and defaults. */
export async function getMigrationColumnStorage(queryRunner: QueryRunner, table: string,
    column: string): Promise<MigrationColumnStorage | null> {
    migrationIdentifier(table);
    migrationIdentifier(column);
    const rows = await queryRunner.query(`SELECT COLUMN_TYPE AS columnType,
        CHARACTER_SET_NAME AS characterSet, COLLATION_NAME AS collation,
        IS_NULLABLE AS nullable, EXTRA AS extra, COLUMN_DEFAULT AS defaultValue
        FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]);
    if (!rows.length) return null;
    if (rows.length !== 1) throw new Error('Ambiguous migration column metadata');
    const row = rows[0];
    const columnType = String(row.columnType).toLowerCase().replace(/\s+/gu, ' ').trim();
    const text = /^(?:var)?char\([1-9][0-9]*\)$/u.test(columnType);
    const binary = /^(?:var)?binary\([1-9][0-9]*\)$/u.test(columnType);
    const integer = /^(?:tinyint|smallint|mediumint|int|bigint)(?:\([1-9][0-9]*\))?(?: unsigned)?(?: zerofill)?$/u.test(columnType);
    if (!text && !binary && !integer && columnType !== 'uuid') {
        throw new Error(`Unsupported identifier storage for ${table}.${column}`);
    }
    // Character identifiers cannot be SQL-bound; validate metadata before DDL.
    let definition = columnType;
    if (text) {
        if (typeof row.characterSet !== 'string' || typeof row.collation !== 'string'
            || !/^[A-Za-z0-9_]+$/u.test(row.characterSet) || !/^[A-Za-z0-9_]+$/u.test(row.collation)) {
            throw new Error(`Missing or unsupported character storage for ${table}.${column}`);
        }
        definition += ` CHARACTER SET ${row.characterSet} COLLATE ${row.collation}`;
    } else if (row.characterSet !== null || row.collation !== null) {
        throw new Error(`Unexpected character attributes for ${table}.${column}`);
    }
    if (!['YES', 'NO'].includes(row.nullable)) throw new Error('Missing migration column nullability');
    return {columnType, characterSet: row.characterSet, collation: row.collation,
        isNullable: row.nullable === 'YES', extra: String(row.extra ?? ''), defaultValue: row.defaultValue, definition};
}

/** Compare the physical attributes required by an actual foreign key. */
export function sameMigrationColumnStorage(left: MigrationColumnStorage, right: MigrationColumnStorage): boolean {
    return left.columnType === right.columnType && left.characterSet === right.characterSet && left.collation === right.collation;
}

/** MariaDB treats NO ACTION as immediate RESTRICT; preserve either spelling. */
function referenceAction(action: string | undefined): string {
    const value = (action ?? 'RESTRICT').toUpperCase();
    return value === 'NO ACTION' ? 'RESTRICT' : value;
}

/** Validate complete FK mappings and name collisions before changing any table. */
function inspectReferenceConstraints(table: Table, reference: MigrationReference, database: string): boolean {
    const expected = reference.foreignKey;
    let present = false;
    for (const key of table.foreignKeys) {
        const usesColumn = key.columnNames.includes(reference.column);
        if (!usesColumn && key.name !== expected?.name) continue;
        const sameTarget = key.columnNames.length === 1 && key.columnNames[0] === reference.column
            && key.referencedColumnNames.length === 1 && key.referencedColumnNames[0] === reference.referencedColumn
            && [reference.referencedTable, `${database}.${reference.referencedTable}`].includes(key.referencedTableName)
            && (!key.referencedDatabase || key.referencedDatabase === database);
        if (!sameTarget || expected && (referenceAction(key.onDelete) !== referenceAction(expected.onDelete)
            || referenceAction(key.onUpdate) !== referenceAction(expected.onUpdate))) {
            throw new Error(`Incompatible existing reference for ${reference.table}.${reference.column}`);
        }
        present = true;
    }
    return present;
}

/** Validate schema-wide FK name ownership before any table is changed.
 * A caller replacing a proven same-table legacy target owns that conversion;
 * an ordinary supporting index can legitimately survive a failed FK add. */
export async function assertMigrationForeignKeyNameAvailable(queryRunner: QueryRunner, table: string,
    name: string): Promise<void> {
    migrationIdentifier(table);
    migrationIdentifier(name);
    const constraints = await queryRunner.query(`SELECT TABLE_NAME AS tableName, CONSTRAINT_TYPE AS kind
        FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_NAME = ?`,
    [name]) as Array<{tableName: string; kind: string}>;
    if (constraints.some(constraint => constraint.kind === 'FOREIGN KEY' && constraint.tableName !== table
        || constraint.tableName === table && constraint.kind !== 'FOREIGN KEY')) {
        throw new Error(`Incompatible migration constraint name ${name}`);
    }
}

/** Refuse unproved structural dependencies before retiring a migration column.
 * Callers separately prove replacement values or require the column to be empty. */
export async function assertMigrationColumnCanBeRetired(queryRunner: QueryRunner, table: string,
    column: string): Promise<void> {
    migrationIdentifier(table);
    migrationIdentifier(column);
    const metadata = await queryRunner.getTable(table);
    const field = metadata?.findColumnByName(column);
    if (!metadata || !field) throw new Error(`Missing retiring-column metadata for ${table}.${column}`);
    if (field.isPrimary || field.isGenerated || field.asExpression
        || metadata.uniques.some(index => index.columnNames.includes(column))
        || metadata.indices.some(index => index.columnNames.includes(column) && (index.isUnique || index.columnNames.length !== 1))) {
        throw new Error(`Unsupported retiring-column dependencies on ${table}.${column}`);
    }
    // The installed MySQL driver does not load CHECK constraints. Generated
    // dependencies can live in another column, so inspect real schema metadata.
    const checks = await queryRunner.query(`SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS
        WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_TYPE = 'CHECK' LIMIT 1`, [table]);
    const generated = await queryRunner.query(`SELECT COLUMN_NAME FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COALESCE(GENERATION_EXPRESSION, '') <> '' LIMIT 1`, [table]);
    const incoming = await queryRunner.query(`SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
        WHERE REFERENCED_TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME = ? AND REFERENCED_COLUMN_NAME = ? LIMIT 1`, [table, column]);
    const prefixes = await queryRunner.query(`SELECT INDEX_NAME FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? AND SUB_PART IS NOT NULL LIMIT 1`, [table, column]);
    if (checks.length || generated.length || incoming.length || prefixes.length) {
        throw new Error(`Unproved CHECK, generated, prefix-index or incoming reference dependency on ${table}.${column}`);
    }
}

/** Refuse coercion of populated or structurally dependent mismatched columns. */
async function admitEmptyReferenceAlignment(queryRunner: QueryRunner, reference: MigrationReference,
    child: MigrationColumnStorage, table: Table): Promise<void> {
    const column = table.findColumnByName(reference.column);
    if (!column || column.isPrimary || column.isGenerated || column.asExpression || child.extra
        || child.defaultValue !== null && child.defaultValue !== 'NULL') {
        throw new Error(`Cannot safely align existing ${reference.table}.${reference.column}`);
    }
    if (table.foreignKeys.some(key => key.columnNames.includes(reference.column))) {
        throw new Error(`Existing constraint prevents empty reference alignment on ${reference.table}.${reference.column}`);
    }
    // Reuse the same actual-schema dependency admission as verified retirement;
    // neither a computed sibling nor an unloaded CHECK may hide a coercion path.
    await assertMigrationColumnCanBeRetired(queryRunner, reference.table, reference.column);
    const populated = await queryRunner.query(`SELECT 1 FROM ${migrationIdentifier(reference.table)}
        WHERE ${migrationIdentifier(reference.column)} IS NOT NULL LIMIT 1`);
    if (populated.length) throw new Error(`Populated incompatible reference ${reference.table}.${reference.column}`);
}

/** Prove the real storage engines and complete unique key can support this FK.
 * ORM index metadata omits prefix lengths, so inspect actual index components. */
async function requireReferenceTable(queryRunner: QueryRunner, reference: MigrationReference): Promise<Table> {
    const engines = await queryRunner.query(`SELECT TABLE_NAME AS tableName, ENGINE AS engine
        FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?, ?)`,
    [reference.table, reference.referencedTable]) as Array<{tableName: string; engine: string | null}>;
    const expected = new Set([reference.table, reference.referencedTable]);
    if (engines.length !== expected.size || engines.some(row => row.engine?.toLowerCase() !== 'innodb')) {
        throw new Error(`Missing or unsupported reference table engine for ${reference.table}.${reference.column}`);
    }
    const unique = await queryRunner.query(`SELECT INDEX_NAME FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND NON_UNIQUE = 0
        GROUP BY INDEX_NAME HAVING COUNT(*) = 1 AND MAX(COLUMN_NAME) = ? AND MAX(SUB_PART) IS NULL`,
    [reference.referencedTable, reference.referencedColumn]);
    if (!unique.length) throw new Error(`Parent identifier lacks a complete unique key for ${reference.table}.${reference.column}`);
    const table = await queryRunner.getTable(reference.table);
    if (!table) throw new Error(`Missing reference child table ${reference.table}`);
    return table;
}

/** Admit every reference before the first DDL, retaining populated compatible values.
 * Run only while application writers are stopped under the migration procedure. */
export async function prepareMigrationReferences(queryRunner: QueryRunner,
    references: readonly MigrationReference[]): Promise<MigrationReferencePlan[]> {
    const [context] = await queryRunner.query('SELECT DATABASE() AS selectedDatabase');
    if (typeof context?.selectedDatabase !== 'string' || !context.selectedDatabase) throw new Error('No selected migration schema');
    const plans: MigrationReferencePlan[] = [];
    const seen = new Set<string>();
    for (const reference of references) {
        // Resolve all parents/children and metadata before allowing additive DDL.
        for (const name of [reference.table, reference.column, reference.referencedTable, reference.referencedColumn]) migrationIdentifier(name);
        if (reference.foreignKey) migrationIdentifier(reference.foreignKey.name);
        const key = `${reference.table}.${reference.column}`;
        if (seen.has(key)) throw new Error(`Repeated migration reference ${key}`);
        seen.add(key);
        const storage = await getMigrationColumnStorage(queryRunner, reference.referencedTable, reference.referencedColumn);
        if (!storage) throw new Error(`Missing migration reference metadata for ${key}`);
        const table = await requireReferenceTable(queryRunner, reference);
        const foreignKeyPresent = inspectReferenceConstraints(table, reference, context.selectedDatabase);
        if (reference.foreignKey) {
            await assertMigrationForeignKeyNameAvailable(queryRunner, reference.table, reference.foreignKey.name);
        }
        const child = await getMigrationColumnStorage(queryRunner, reference.table, reference.column);
        let action: MigrationReferencePlan['action'] = 'add';
        if (child) {
            action = sameMigrationColumnStorage(child, storage) ? 'preserve' : 'align';
            if (action === 'align') await admitEmptyReferenceAlignment(queryRunner, reference, child, table);
            else {
                // Existing FKs may have been installed while checks were disabled.
                const orphan = await queryRunner.query(`SELECT 1 FROM ${migrationIdentifier(reference.table)} child
                    LEFT JOIN ${migrationIdentifier(reference.referencedTable)} parent
                    ON parent.${migrationIdentifier(reference.referencedColumn)} = child.${migrationIdentifier(reference.column)}
                    WHERE child.${migrationIdentifier(reference.column)} IS NOT NULL
                    AND parent.${migrationIdentifier(reference.referencedColumn)} IS NULL LIMIT 1`);
                if (orphan.length) throw new Error(`Unresolved reference ${key}`);
            }
        }
        plans.push({reference, storage, action, foreignKeyPresent});
    }
    return plans;
}

/** Apply only completely admitted references and preserve any completed prefix.
 * Recheck before DDL; no row deletion or populated-column coercion is performed. */
export async function applyMigrationReferences(queryRunner: QueryRunner,
    admitted: readonly MigrationReferencePlan[]): Promise<void> {
    const plans = await prepareMigrationReferences(queryRunner, admitted.map(plan => plan.reference));
    for (let index = 0; index < plans.length; index++) {
        if (!sameMigrationColumnStorage(plans[index]!.storage, admitted[index]!.storage)) throw new Error('Referenced storage changed after migration preflight');
    }
    // No primary, unique, generated or default attribute is copied from parents.
    for (const plan of plans) {
        if (plan.action === 'preserve') continue;
        const operation = plan.action === 'add' ? 'ADD COLUMN' : 'MODIFY COLUMN';
        await queryRunner.query(`ALTER TABLE ${migrationIdentifier(plan.reference.table)} ${operation}
            ${migrationIdentifier(plan.reference.column)} ${plan.storage.definition} NULL`);
    }
    // Recheck new physical columns and all rows before installing missing FKs.
    const completed = await prepareMigrationReferences(queryRunner, plans.map(plan => plan.reference));
    for (const plan of completed) {
        const constraint = plan.reference.foreignKey;
        if (!constraint || plan.foreignKeyPresent) continue;
        await queryRunner.createForeignKey(plan.reference.table, new TableForeignKey({name: constraint.name,
            columnNames: [plan.reference.column], referencedTableName: plan.reference.referencedTable,
            referencedColumnNames: [plan.reference.referencedColumn], onDelete: constraint.onDelete, onUpdate: constraint.onUpdate}));
    }
}

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
