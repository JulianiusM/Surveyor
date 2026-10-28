import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it} from 'vitest';
import type {QueryRunner} from 'typeorm';
import {AddItemOwners1785163809347} from '../../src/backend/migrations/1785163809347-AddItemOwners';
import {AppDataSource} from '../../src/backend/modules/database/dataSource';
import {closeIntegrationDatabase, initializeIntegrationDatabase} from '../support/database';
import {snapshotMigrationDatabase} from '../support/migrationSnapshot';

const migration = new AddItemOwners1785163809347();
let runner: QueryRunner;

/** Create the migration's actual preceding tables in the guarded disposable schema.
 * Minimal real tables isolate identifier compatibility from unrelated application DDL. */
async function prepareItemOwners(guestType = 'uuid', userType = 'int unsigned'): Promise<void> {
    // The suite's normal initializer has verified TEST_DB_NAME. Clearing here is
    // fixture preparation only, on that same dedicated connection and database.
    await runner.clearDatabase();
    await runner.query(`CREATE TABLE users (id ${userType} NOT NULL PRIMARY KEY, payload varchar(100) NOT NULL)`);
    await runner.query(`CREATE TABLE guests (id ${guestType} NOT NULL PRIMARY KEY, payload varchar(100) NOT NULL)`);
    for (const table of ['packing_items', 'activity_slots']) {
        await runner.query(`CREATE TABLE \`${table}\` (id int NOT NULL PRIMARY KEY, payload varchar(100) NOT NULL)`);
        await runner.query(`INSERT INTO \`${table}\` (id, payload) VALUES (1, ?), (2, ?)`, [`${table} retained α`, `${table} retained β`]);
    }
    await runner.query('INSERT INTO users (id, payload) VALUES (7, ?)', ['user retained']);
}

/** Inspect physical storage independently through MariaDB's persisted metadata. */
async function columnStorage(table: string, column: string) {
    const rows = await runner.query(`SELECT COLUMN_TYPE AS type, CHARACTER_SET_NAME AS charset,
        COLLATION_NAME AS collation, IS_NULLABLE AS nullable, COLUMN_DEFAULT AS defaultValue, EXTRA AS extra
        FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]);
    expect(rows).toHaveLength(1);
    return rows[0] as {type: string; charset: string | null; collation: string | null;
        nullable: string; defaultValue: string | null; extra: string};
}

describe('item-owner reference migration preserves data and physical identifier storage', () => {
    beforeAll(initializeIntegrationDatabase);
    beforeEach(async () => {
        runner = AppDataSource.createQueryRunner();
        await runner.connect();
    });
    afterEach(async () => { if (runner && !runner.isReleased) await runner.release(); });
    afterAll(closeIntegrationDatabase);

    it('copies native UUID guest and unsigned numeric user storage, retaining payloads and safe retry', async () => {
        await prepareItemOwners();
        const before = await snapshotMigrationDatabase(runner);
        await migration.up(runner);
        for (const table of ['packing_items', 'activity_slots']) {
            for (const [column, parent] of [['user_id', 'users'], ['guest_id', 'guests']]) {
                const child = await columnStorage(table!, column!);
                const referenced = await columnStorage(parent!, 'id');
                expect({type: child.type, charset: child.charset, collation: child.collation})
                    .toEqual({type: referenced.type, charset: referenced.charset, collation: referenced.collation});
                expect(child.nullable).toBe('YES');
                expect(child.extra).not.toMatch(/auto_increment|generated/iu);
            }
            expect(await runner.query(`SELECT id, payload, user_id, guest_id FROM \`${table}\` ORDER BY id`)).toEqual([
                {id: 1, payload: `${table} retained α`, user_id: null, guest_id: null},
                {id: 2, payload: `${table} retained β`, user_id: null, guest_id: null},
            ]);
        }
        const migrated = await snapshotMigrationDatabase(runner);
        await migration.up(runner);
        expect(await snapshotMigrationDatabase(runner)).toEqual(migrated);
        expect(migrated.find(table => table.name === 'users')).toEqual(before.find(table => table.name === 'users'));
        expect(migrated.find(table => table.name === 'guests')).toEqual(before.find(table => table.name === 'guests'));
    });

    it('refuses a populated mismatch in the last reference before any earlier table changes', async () => {
        await prepareItemOwners();
        await runner.query('ALTER TABLE activity_slots ADD guest_id varchar(36) NULL');
        await runner.query('UPDATE activity_slots SET guest_id = ? WHERE id = 1', ['12e45678-e89b-42d3-a456-426614174000']);
        const before = await snapshotMigrationDatabase(runner);
        await expect(migration.up(runner)).rejects.toThrow();
        expect(await snapshotMigrationDatabase(runner)).toEqual(before);
    });

    it('reverts only empty owner references and retains every original row through down and retry', async () => {
        await prepareItemOwners();
        const before = await snapshotMigrationDatabase(runner);
        await migration.up(runner);
        const after = await snapshotMigrationDatabase(runner);
        await migration.down(runner);
        expect(await snapshotMigrationDatabase(runner)).toEqual(before);
        await migration.up(runner);
        expect(await snapshotMigrationDatabase(runner)).toEqual(after);
    });

    it.each([
        {label: 'case-sensitive text', type: "varchar(48) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT 'parent-only'", value: 'Guest-Ä-CaSe'},
        {label: 'binary bytes', type: 'binary(16)', value: Buffer.from('000102030405060708090a0b0c0d0eff', 'hex')},
    ])('copies $label identifiers without inheriting parent generation or losing ownership', async ({type, value}) => {
        await prepareItemOwners(type, 'bigint unsigned AUTO_INCREMENT');
        await runner.query('INSERT INTO guests (id, payload) VALUES (?, ?)', [value, 'guest retained']);
        await migration.up(runner);
        for (const table of ['packing_items', 'activity_slots']) {
            const child = await columnStorage(table, 'guest_id');
            const parent = await columnStorage('guests', 'id');
            expect({type: child.type, charset: child.charset, collation: child.collation})
                .toEqual({type: parent.type, charset: parent.charset, collation: parent.collation});
            expect(child.nullable).toBe('YES');
            expect([null, 'NULL']).toContain(child.defaultValue);
            expect(child.extra).not.toMatch(/auto_increment|generated/iu);
            expect((await columnStorage(table, 'user_id')).type).toBe((await columnStorage('users', 'id')).type);
            expect((await columnStorage(table, 'user_id')).extra).not.toContain('auto_increment');
            // Both children may share both owners. This would fail if the new
            // references inherited a parent's primary or unique constraint.
            await runner.query(`UPDATE \`${table}\` SET guest_id = ?, user_id = 7`, [value]);
            const ownership = await runner.query(`SELECT HEX(t.guest_id) AS bytes, t.payload, CAST(u.id AS CHAR) AS userId,
                g.payload AS guestPayload FROM \`${table}\` t JOIN users u ON u.id = t.user_id
                JOIN guests g ON g.id = t.guest_id ORDER BY t.id`);
            expect(ownership).toEqual(['α', 'β'].map(suffix => ({bytes: Buffer.isBuffer(value) ? value.toString('hex').toUpperCase()
                : Buffer.from(value).toString('hex').toUpperCase(), payload: `${table} retained ${suffix}`, userId: '7', guestPayload: 'guest retained'})));
            const checks = await runner.query('SELECT @@FOREIGN_KEY_CHECKS AS enabled');
            expect(Number(checks[0].enabled)).toBe(1);
            await expect(runner.query(`UPDATE \`${table}\` SET user_id = 2000000000 WHERE id = 1`)).rejects.toThrow();
        }
        const foreignKeys = await runner.query(`SELECT k.TABLE_NAME AS child, k.COLUMN_NAME AS columnName,
            k.REFERENCED_TABLE_NAME AS parent, k.REFERENCED_COLUMN_NAME AS parentColumn,
            r.DELETE_RULE AS deletion, r.UPDATE_RULE AS updating FROM information_schema.KEY_COLUMN_USAGE k
            JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA
                AND r.TABLE_NAME = k.TABLE_NAME AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
            WHERE k.TABLE_SCHEMA = DATABASE() AND k.TABLE_NAME IN ('packing_items', 'activity_slots')
                AND k.REFERENCED_TABLE_NAME IS NOT NULL ORDER BY k.TABLE_NAME, k.COLUMN_NAME`);
        expect(foreignKeys).toEqual(['activity_slots', 'packing_items'].flatMap(child => [
            {child, columnName: 'guest_id', parent: 'guests', parentColumn: 'id', deletion: 'CASCADE', updating: 'RESTRICT'},
            {child, columnName: 'user_id', parent: 'users', parentColumn: 'id', deletion: 'CASCADE', updating: 'RESTRICT'},
        ]));
        const beforeRetry = await snapshotMigrationDatabase(runner);
        await migration.up(runner);
        expect(await snapshotMigrationDatabase(runner)).toEqual(beforeRetry);
    });

    it('repairs only NULL mismatches after partial DDL and keeps an already compatible foreign key', async () => {
        await prepareItemOwners();
        for (const table of ['packing_items', 'activity_slots']) {
            const userType = table === 'packing_items' ? 'int unsigned' : 'int';
            await runner.query(`ALTER TABLE \`${table}\` ADD user_id ${userType} NULL, ADD guest_id varchar(36) NULL`);
        }
        await runner.query('ALTER TABLE packing_items ADD CONSTRAINT FK_a0bad64d810ac4e76c23b86785d FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE RESTRICT');
        await runner.query('UPDATE packing_items SET user_id = 7 WHERE id = 1');
        const before = await runner.query('SELECT id, payload, user_id FROM packing_items ORDER BY id');
        await migration.up(runner);
        expect(await runner.query('SELECT id, payload, user_id FROM packing_items ORDER BY id')).toEqual(before);
        for (const table of ['packing_items', 'activity_slots']) {
            expect((await columnStorage(table, 'guest_id')).type).toBe((await columnStorage('guests', 'id')).type);
            expect((await columnStorage(table, 'user_id')).type).toBe((await columnStorage('users', 'id')).type);
            const rows = await runner.query(`SELECT COUNT(*) AS count FROM \`${table}\` WHERE guest_id IS NOT NULL`);
            expect(Number(rows[0].count)).toBe(0);
        }
        const after = await snapshotMigrationDatabase(runner);
        await migration.up(runner);
        expect(await snapshotMigrationDatabase(runner)).toEqual(after);
    });

    it('rejects a conflicting final foreign key before adding earlier missing columns', async () => {
        await prepareItemOwners();
        await runner.query('CREATE TABLE other_guests (id uuid NOT NULL PRIMARY KEY)');
        await runner.query('ALTER TABLE activity_slots ADD guest_id uuid NULL, ADD CONSTRAINT FK_c4e8f0a94193ce0883305a90e88 FOREIGN KEY (guest_id) REFERENCES other_guests(id) ON DELETE CASCADE ON UPDATE RESTRICT');
        const before = await snapshotMigrationDatabase(runner);
        await expect(migration.up(runner)).rejects.toThrow();
        expect(await snapshotMigrationDatabase(runner)).toEqual(before);
    });

    it('refuses a schema-wide expected foreign-key name collision before any child DDL', async () => {
        await prepareItemOwners();
        await runner.query(`CREATE TABLE shadow_slots (id int NOT NULL PRIMARY KEY, guest_id uuid NULL,
            CONSTRAINT FK_c4e8f0a94193ce0883305a90e88 FOREIGN KEY (guest_id) REFERENCES guests(id)
                ON DELETE CASCADE ON UPDATE RESTRICT)`);
        const before = await snapshotMigrationDatabase(runner);
        await expect(migration.up(runner)).rejects.toThrow();
        expect(await snapshotMigrationDatabase(runner)).toEqual(before);
    });

    it('refuses a retained prefix index before converting an incompatible NULL reference', async () => {
        await prepareItemOwners();
        await runner.query(`ALTER TABLE activity_slots ADD guest_id varchar(36) NULL,
            ADD INDEX retained_guest_prefix (guest_id(8))`);
        const before = await snapshotMigrationDatabase(runner);
        await expect(migration.up(runner)).rejects.toThrow();
        expect(await snapshotMigrationDatabase(runner)).toEqual(before);
    });

    it('refuses a non-InnoDB last child before adding any earlier reference', async () => {
        await prepareItemOwners();
        await runner.query('ALTER TABLE activity_slots ENGINE = MyISAM');
        const before = await snapshotMigrationDatabase(runner);
        await expect(migration.up(runner)).rejects.toThrow();
        expect(await snapshotMigrationDatabase(runner)).toEqual(before);
    });

    it('refuses a populated compatible reference with no parent before adding any other owner column', async () => {
        await prepareItemOwners();
        await runner.query('ALTER TABLE activity_slots ADD guest_id uuid NULL');
        await runner.query('UPDATE activity_slots SET guest_id = ? WHERE id = 1', ['12e45678-e89b-42d3-a456-426614174000']);
        const before = await snapshotMigrationDatabase(runner);
        await expect(migration.up(runner)).rejects.toThrow();
        expect(await snapshotMigrationDatabase(runner)).toEqual(before);
    });

    it('refuses an orphan retained under an existing compatible foreign key after checks were disabled', async () => {
        await prepareItemOwners();
        await migration.up(runner);
        // Reconstruct an already inconsistent installation without removing its
        // declared FK. Re-enabling checks does not retroactively validate rows.
        await runner.query('SET FOREIGN_KEY_CHECKS = 0');
        try {
            await runner.query('UPDATE activity_slots SET guest_id = ? WHERE id = 1', ['12e45678-e89b-42d3-a456-426614174000']);
        } finally { await runner.query('SET FOREIGN_KEY_CHECKS = 1'); }
        const before = await snapshotMigrationDatabase(runner);
        await expect(migration.up(runner)).rejects.toThrow();
        expect(await snapshotMigrationDatabase(runner)).toEqual(before);
    });

    it.each([
        ['packing_items', 'user_id'], ['packing_items', 'guest_id'],
        ['activity_slots', 'user_id'], ['activity_slots', 'guest_id'],
    ])('refuses down before dropping any foreign key when %s.%s contains an owner', async (table, column) => {
        await prepareItemOwners();
        const guest = '12e45678-e89b-42d3-a456-426614174000';
        await runner.query('INSERT INTO guests (id, payload) VALUES (?, ?)', [guest, 'guest retained']);
        await migration.up(runner);
        await runner.query(`UPDATE \`${table}\` SET \`${column}\` = ? WHERE id = 1`, [column === 'user_id' ? 7 : guest]);
        const before = await snapshotMigrationDatabase(runner);
        await expect(migration.down(runner)).rejects.toThrow();
        expect(await snapshotMigrationDatabase(runner)).toEqual(before);
    });

    it.each(['incoming reference', 'unique constraint', 'check constraint', 'generated dependency'] as const)
    ('preserves every schema object when down would discard an %s', async dependency => {
        await prepareItemOwners();
        await migration.up(runner);
        if (dependency === 'incoming reference') {
            await runner.query(`CREATE TABLE owner_dependents (id int NOT NULL PRIMARY KEY, user_ref int unsigned NULL,
                CONSTRAINT retained_owner_reference FOREIGN KEY (user_ref) REFERENCES packing_items(user_id))`);
        } else if (dependency === 'unique constraint') {
            await runner.query('ALTER TABLE activity_slots ADD UNIQUE INDEX retained_owner_unique (guest_id)');
        } else if (dependency === 'check constraint') {
            await runner.query('ALTER TABLE activity_slots ADD CONSTRAINT retained_owner_check CHECK (user_id IS NULL OR user_id > 0)');
        } else {
            await runner.query('ALTER TABLE activity_slots ADD owner_user_double bigint AS (user_id * 2) VIRTUAL');
        }
        const before = await snapshotMigrationDatabase(runner);
        await expect(migration.down(runner)).rejects.toThrow();
        expect(await snapshotMigrationDatabase(runner)).toEqual(before);
    });
});
