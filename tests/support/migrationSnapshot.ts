import type {QueryRunner} from 'typeorm';

/** Keep exact persisted bytes and scalar values comparable across fresh reads. */
function migrationValue(value: unknown): unknown {
    if (Buffer.isBuffer(value)) return {bytes: value.toString('hex')};
    if (value instanceof Date) return {timestamp: value.toISOString()};
    if (typeof value === 'bigint') return {integer: value.toString()};
    if (Array.isArray(value)) return value.map(migrationValue);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
            .map(([key, item]) => [key, migrationValue(item)]));
    }
    return value;
}

/** Snapshot every actual table, definition and row in the already guarded test schema.
 * Refusal assertions use this before/after evidence to detect unrelated DDL, ownership
 * changes, lost payloads and new records, rather than trusting migration return values. */
export async function snapshotMigrationDatabase(runner: QueryRunner) {
    const tables = await runner.query(`SELECT TABLE_NAME AS name FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME`) as Array<{name: string}>;
    const triggers = await runner.query(`SELECT EVENT_OBJECT_TABLE AS tableName, TRIGGER_NAME AS name,
        EVENT_MANIPULATION AS event, ACTION_TIMING AS timing, ACTION_STATEMENT AS statement,
        ACTION_ORIENTATION AS orientation, DEFINER AS definer, SQL_MODE AS sqlMode,
        CHARACTER_SET_CLIENT AS characterSet, COLLATION_CONNECTION AS connectionCollation,
        DATABASE_COLLATION AS databaseCollation, CAST(CREATED AS CHAR) AS created
        FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE()
        ORDER BY EVENT_OBJECT_TABLE, TRIGGER_NAME`) as Array<Record<string, unknown>>;
    const snapshot = [];
    // Identifiers come only from same-schema metadata; escape any literal backtick
    // before the SQL identifier position, never interpolate a selected database.
    for (const {name} of tables) {
        const identifier = `\`${name.replaceAll('`', '``')}\``;
        const definition = await runner.query(`SHOW CREATE TABLE ${identifier}`) as Array<Record<string, string>>;
        const columns = await runner.query(`SELECT COLUMN_NAME AS name, DATA_TYPE AS type
            FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`,
        [name]) as Array<{name: string; type: string}>;
        // SQL text retains all six timestamp fractional digits. JavaScript Date
        // hydration would hide a migration changing only the saved microseconds.
        const projection = columns.map(column => {
            const key = `\`${column.name.replaceAll('`', '``')}\``;
            return ['datetime', 'timestamp', 'time', 'date'].includes(column.type)
                ? `CAST(${key} AS CHAR) AS ${key}` : key;
        }).join(', ');
        const rows = await runner.query(`SELECT ${projection} FROM ${identifier}`) as Array<Record<string, unknown>>;
        snapshot.push({name, definition: definition[0]!['Create Table'],
            rows: rows.map(row => JSON.stringify(migrationValue(row))).sort(),
            triggers: triggers.filter(trigger => trigger.tableName === name).map(trigger => JSON.stringify(migrationValue(trigger)))});
    }
    return snapshot;
}
