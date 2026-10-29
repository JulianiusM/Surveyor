import type {QueryRunner} from 'typeorm';
import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it} from 'vitest';
import {AddCheckSlotRoleTrigger1752829591073} from '../../src/backend/migrations/1752829591073-AddCheckSlotRoleTrigger';
import {AddHeaderImgs1783180919744} from '../../src/backend/migrations/1783180919744-AddHeaderImgs';
import {AddDietaryComment1784007497812} from '../../src/backend/migrations/1784007497812-AddDietaryComment';
import {AddNightBasedInvoiceDist1785039317554} from '../../src/backend/migrations/1785039317554-AddNightBasedInvoiceDist';
import {UpdateTracking1785614240136} from '../../src/backend/migrations/1785614240136-UpdateTracking';
import {AddRegistrationDeadlineSettings1786335515684} from '../../src/backend/migrations/1786335515684-AddRegistrationDeadlineSettings';
import {AddInvoiceReviewHistory1787875200000} from '../../src/backend/migrations/1787875200000-AddInvoiceReviewHistory';
import {AddOrganizerInvoices1789603200000} from '../../src/backend/migrations/1789603200000-AddOrganizerInvoices';
import {AddEntityArchival1789862400000} from '../../src/backend/migrations/1789862400000-AddEntityArchival';
import {AddInvoiceProofFiles1793059200000} from '../../src/backend/migrations/1793059200000-AddInvoiceProofFiles';
import {AppDataSource} from '../../src/backend/modules/database/dataSource';
import {closeIntegrationDatabase, initializeIntegrationDatabase} from '../support/database';
import {snapshotMigrationDatabase} from '../support/migrationSnapshot';

let runner: QueryRunner;

/** Read stored attributes independently of the migration's column renderer. */
async function physicalColumn(table: string, column: string) {
    const rows = await runner.query(`SELECT COLUMN_TYPE AS type, CHARACTER_SET_NAME AS charset,
        COLLATION_NAME AS collation, IS_NULLABLE AS nullable, COLUMN_DEFAULT AS defaultValue,
        EXTRA AS extra, COLUMN_COMMENT AS comment, DATETIME_PRECISION AS fractionalDigits
        FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
        [table, column]);
    expect(rows).toHaveLength(1);
    return rows[0];
}

/** Real schema transitions use only this runner on the guarded disposable target. */
beforeAll(initializeIntegrationDatabase);
beforeEach(async () => {
    runner = AppDataSource.createQueryRunner();
    await runner.connect();
    const [target] = await runner.query('SELECT DATABASE() AS name');
    expect(target.name).toBe(process.env.TEST_DB_NAME);
    await runner.clearDatabase();
});
afterEach(async () => { if (runner && !runner.isReleased) await runner.release(); });
afterAll(closeIntegrationDatabase);

const profileStorage = [
    {label: 'native UUID', definition: 'uuid', value: '12e45678-e89b-42d3-a456-426614174000'},
    {label: 'case-sensitive text', definition: "varchar(48) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT 'parent-only'", value: 'Parent-Ä-CaSe'},
    {label: 'binary bytes', definition: 'binary(16)', value: Buffer.from('000102030405060708090a0b0c0d0eff', 'hex')},
    {label: 'generated unsigned numeric', definition: 'bigint unsigned AUTO_INCREMENT', value: 7},
    {label: 'zero-filled numeric', definition: 'bigint(20) unsigned zerofill', value: 7},
];

describe('uniform SQL migration writes retain their physical schema contracts', () => {
    it.each(profileStorage)('retains Organizer attribution storage for $label and only changes registration nullability', async ({definition, value}) => {
        // The parent is historical SQL, deliberately independent of today's Profile entity.
        await runner.query(`CREATE TABLE profiles (id ${definition} NOT NULL PRIMARY KEY COMMENT 'Parent O''Brien \\path', payload varchar(50) NOT NULL)`);
        await runner.query('INSERT INTO profiles (id, payload) VALUES (?, ?)', [value, 'retained profile']);
        await runner.query(`CREATE TABLE event_invoices (id int PRIMARY KEY,
            registration_id bigint(20) unsigned zerofill NOT NULL DEFAULT 7 COMMENT 'retained registration', payload varchar(50) NOT NULL)`);
        await runner.query("INSERT INTO event_invoices VALUES (1, 7, 'retained invoice')");
        const originalInvoice = await runner.query('SELECT id, registration_id, payload FROM event_invoices');
        const parent = await physicalColumn('profiles', 'id');
        const registration = await physicalColumn('event_invoices', 'registration_id');
        const migration = new AddOrganizerInvoices1789603200000();
        await migration.up(runner);

        const recorder = await physicalColumn('event_invoices', 'recorded_by_profile_id');
        expect({type: recorder.type, charset: recorder.charset, collation: recorder.collation, comment: recorder.comment})
            .toEqual({type: parent.type, charset: parent.charset, collation: parent.collation, comment: parent.comment});
        expect(recorder.nullable).toBe('YES');
        expect([null, 'NULL']).toContain(recorder.defaultValue);
        expect(recorder.extra).not.toMatch(/auto_increment|generated/iu);
        expect(await physicalColumn('event_invoices', 'registration_id')).toEqual({...registration, nullable: 'YES'});
        const installed = await snapshotMigrationDatabase(runner);
        await migration.up(runner);
        expect(await snapshotMigrationDatabase(runner)).toEqual(installed);

        // Persist attribution and exercise the actual FK actions, rather than just its name.
        await runner.query('UPDATE event_invoices SET recorded_by_profile_id = ? WHERE id = 1', [value]);
        await runner.query('DELETE FROM profiles WHERE id = ?', [value]);
        expect(await runner.query('SELECT recorded_by_profile_id, payload FROM event_invoices')).toEqual([
            {recorded_by_profile_id: null, payload: 'retained invoice'},
        ]);
        await runner.query('INSERT INTO event_invoices (id, registration_id, payload) VALUES (2, NULL, ?)', ['organizer cost']);
        const beforeRefusal = await snapshotMigrationDatabase(runner);
        await expect(migration.down(runner)).rejects.toThrow('Cannot revert organizer invoices');
        expect(await snapshotMigrationDatabase(runner)).toEqual(beforeRefusal);
        // Remove only this test's deliberately incompatible row to exercise the admitted down path.
        await runner.query('DELETE FROM event_invoices WHERE id = 2');
        await migration.down(runner);
        expect(await runner.hasColumn('event_invoices', 'recorded_by_profile_id')).toBe(false);
        expect(await physicalColumn('event_invoices', 'registration_id')).toEqual({...registration, nullable: 'YES'});
        expect(await runner.query('SELECT id, registration_id, payload FROM event_invoices')).toEqual(originalInvoice);
    });

    it.each(profileStorage)('retains archival profile storage and cascades for $label', async ({definition, value}) => {
        await runner.query(`CREATE TABLE profiles (id ${definition} NOT NULL PRIMARY KEY, payload varchar(50) NOT NULL)`);
        await runner.query('INSERT INTO profiles (id, payload) VALUES (?, ?)', [value, 'retained profile']);
        const parent = await physicalColumn('profiles', 'id');
        const migration = new AddEntityArchival1789862400000();
        await migration.up(runner);
        const child = await physicalColumn('entity_visibility_preferences', 'profile_id');
        expect({type: child.type, charset: child.charset, collation: child.collation})
            .toEqual({type: parent.type, charset: parent.charset, collation: parent.collation});
        expect(child.nullable).toBe('YES');
        expect(child.extra).not.toMatch(/auto_increment|generated/iu);
        expect([null, 'NULL']).toContain(child.defaultValue);
        const schema = await snapshotMigrationDatabase(runner);
        await migration.up(runner);
        expect(await snapshotMigrationDatabase(runner)).toEqual(schema);
        await runner.query(`INSERT INTO entity_visibility_preferences (profile_id, entity_type, entity_id, visibility)
            VALUES (?, 'survey', '12e45678-e89b-42d3-a456-426614174001', 'HIDDEN')`, [value]);
        await expect(migration.down(runner)).rejects.toThrow('personal visibility preferences');
        await runner.query('DELETE FROM profiles WHERE id = ?', [value]);
        expect(await runner.query('SELECT COUNT(*) AS count FROM entity_visibility_preferences')).toEqual([{count: '0'}]);
        await migration.down(runner);
        expect(await runner.hasTable('entity_visibility_preferences')).toBe(false);
        await migration.up(runner);
        expect(await runner.hasTable('entity_visibility_preferences')).toBe(true);
    });

    it('creates the proof ledger with exact defaults, preserves byte-distinct backfills and refuses nonempty rollback', async () => {
        await runner.query('CREATE TABLE event_invoices (id int PRIMARY KEY, proof_path varchar(255) NULL)');
        await runner.query('INSERT INTO event_invoices VALUES (1, ?), (2, ?), (3, ?), (4, NULL)',
            ['proofs/Receipt.pdf', 'proofs/Receipt.pdf', 'proofs/receipt.pdf']);
        const migration = new AddInvoiceProofFiles1793059200000();
        await migration.up(runner);
        expect((await runner.getTable('invoice_proof_files'))!.indices).toEqual(expect.arrayContaining([
            expect.objectContaining({name: 'idx_invoice_proof_files_scan', columnNames: ['state', 'retry_at']}),
        ]));
        expect(await runner.query('SELECT path, state, attempts, owner_token FROM invoice_proof_files ORDER BY BINARY path')).toEqual([
            {path: 'proofs/Receipt.pdf', state: 'ATTACHED', attempts: 0, owner_token: null},
            {path: 'proofs/receipt.pdf', state: 'ATTACHED', attempts: 0, owner_token: null},
        ]);
        const before = await snapshotMigrationDatabase(runner);
        await migration.up(runner);
        expect(await snapshotMigrationDatabase(runner)).toEqual(before);
        await expect(migration.down(runner)).rejects.toThrow('tracked files');
        expect(await snapshotMigrationDatabase(runner)).toEqual(before);
        await runner.query('DELETE FROM invoice_proof_files');
        await migration.down(runner);
        expect(await runner.hasTable('invoice_proof_files')).toBe(false);
        expect(await runner.query('SELECT COUNT(*) AS count FROM event_invoices')).toEqual([{count: '4'}]);
    });

    it('retains generated-column metadata cleanup after dropping an empty existing ledger', async () => {
        const migration = new AddInvoiceProofFiles1793059200000();
        await migration.up(runner);
        await runner.query('ALTER TABLE invoice_proof_files ADD path_length int AS (char_length(path)) VIRTUAL');
        await runner.query(`CREATE TABLE typeorm_metadata (\`type\` varchar(255), \`database\` varchar(255),
            \`schema\` varchar(255), \`table\` varchar(255), \`name\` varchar(255), \`value\` text)`);
        await runner.query(`INSERT INTO typeorm_metadata (\`type\`, \`schema\`, \`table\`, \`name\`, \`value\`)
            VALUES ('GENERATED_COLUMN', DATABASE(), 'invoice_proof_files', 'path_length', 'char_length(path)'),
                ('GENERATED_COLUMN', DATABASE(), 'other_table', 'path_length', 'retained')`);
        await migration.down(runner);
        expect(await runner.hasTable('invoice_proof_files')).toBe(false);
        expect(await runner.query('SELECT `table`, `value` FROM typeorm_metadata')).toEqual([{table: 'other_table', value: 'retained'}]);
    });

    it('retains the committed generated-recorder column and metadata before an unsupported FK refuses the migration', async () => {
        await runner.query(`CREATE TABLE typeorm_metadata (\`type\` varchar(255), \`database\` varchar(255),
            \`schema\` varchar(255), \`table\` varchar(255), \`name\` varchar(255), \`value\` text)`);
        // A stored constant can have a unique index even though MariaDB does not
        // permit the later SET NULL/CASCADE FK on its generated child clone.
        await runner.query('CREATE TABLE profiles (payload int, id int AS (7) PERSISTENT, UNIQUE INDEX unique_id (id))');
        await runner.query('INSERT INTO profiles (payload) VALUES (1)');
        await runner.query(`INSERT INTO typeorm_metadata (\`type\`, \`schema\`, \`table\`, \`name\`, \`value\`)
            VALUES ('GENERATED_COLUMN', DATABASE(), 'profiles', 'id', '7')`);
        await runner.query('CREATE TABLE event_invoices (id int PRIMARY KEY, registration_id int NOT NULL)');
        await runner.query('INSERT INTO event_invoices VALUES (1, 7)');
        await expect(new AddOrganizerInvoices1789603200000().up(runner)).rejects.toThrow();
        expect(await runner.hasColumn('event_invoices', 'recorded_by_profile_id')).toBe(true);
        expect(await runner.hasColumn('event_invoices', 'recorded_by_name')).toBe(true);
        expect(await runner.query(`SELECT \`table\`, \`name\`, \`value\` FROM typeorm_metadata
            WHERE \`table\` = 'event_invoices'`)).toEqual([{table: 'event_invoices', name: 'recorded_by_profile_id', value: '7'}]);
        expect(await runner.query('SELECT id, registration_id, recorded_by_profile_id FROM event_invoices')).toEqual([
            {id: 1, registration_id: 7, recorded_by_profile_id: 7},
        ]);
    });
});

describe('historical migration schema transitions', () => {
    it('installs, retries and removes the original slot-role capacity trigger against its preceding column names', async () => {
        await runner.query('CREATE TABLE activity_assignments (id int PRIMARY KEY, slot_id int NOT NULL)');
        await runner.query('CREATE TABLE activity_slot_role (slot_id int, role_id int, max_qty smallint NULL)');
        await runner.query('CREATE TABLE activity_assignment_roles (id int PRIMARY KEY, assignment_id int NOT NULL, role_id int NOT NULL)');
        await runner.query('INSERT INTO activity_assignments VALUES (1, 7), (2, 7)');
        await runner.query('INSERT INTO activity_slot_role VALUES (7, 4, 1)');
        const migration = new AddCheckSlotRoleTrigger1752829591073();
        await migration.up(runner);
        await migration.up(runner);
        await runner.query('INSERT INTO activity_assignment_roles VALUES (1, 1, 4)');
        await expect(runner.query('INSERT INTO activity_assignment_roles VALUES (2, 2, 4)')).rejects.toThrow('Role capacity reached');
        expect(await runner.query('SELECT COUNT(*) AS count FROM activity_assignment_roles')).toEqual([{count: '1'}]);
        await migration.down(runner);
        await runner.query('INSERT INTO activity_assignment_roles VALUES (2, 2, 4)');
        expect(await runner.query('SELECT COUNT(*) AS count FROM activity_assignment_roles')).toEqual([{count: '2'}]);
    });

    it('adds and reverses all five historical header columns without changing retained entity rows', async () => {
        const tables = ['drivers_lists', 'packing_lists', 'events', 'activity_plans', 'surveys'];
        for (const table of tables) {
            await runner.query(`CREATE TABLE \`${table}\` (id int PRIMARY KEY, payload varchar(50) NOT NULL)`);
            await runner.query(`INSERT INTO \`${table}\` VALUES (1, ?)`, [`${table} retained`]);
        }
        const before = await snapshotMigrationDatabase(runner);
        const migration = new AddHeaderImgs1783180919744();
        await migration.up(runner);
        for (const table of tables) {
            expect(await physicalColumn(table, 'header_img')).toMatchObject({type: 'varchar(255)', nullable: 'YES'});
            await runner.query(`UPDATE \`${table}\` SET header_img = 'old/header.png'`);
        }
        const added = await snapshotMigrationDatabase(runner);
        await migration.up(runner);
        expect(await snapshotMigrationDatabase(runner)).toEqual(added);
        await migration.down(runner);
        await migration.down(runner);
        expect(await snapshotMigrationDatabase(runner)).toEqual(before);
    });

    it('keeps dietary rows and the declared COMMENT removal behavior through enum conversion', async () => {
        await runner.query('CREATE TABLE events (id int PRIMARY KEY, payload varchar(50) NOT NULL)');
        await runner.query("INSERT INTO events VALUES (1, 'retained event')");
        await runner.query(`CREATE TABLE event_registration_dietary (id int PRIMARY KEY,
            choice enum('MEAT','FISH','VEGETARIAN','VEGAN','HALAL','KOSHER','ALLERGIES') NOT NULL, payload varchar(50))`);
        await runner.query("INSERT INTO event_registration_dietary VALUES (1, 'MEAT', 'retained meal')");
        const migration = new AddDietaryComment1784007497812();
        await migration.up(runner);
        await migration.up(runner);
        expect((await physicalColumn('events', 'allow_diet_comment')).defaultValue).toBe('0');
        await runner.query("INSERT INTO event_registration_dietary VALUES (2, 'COMMENT', 'comment-only fixture')");
        await migration.down(runner);
        expect(await runner.query('SELECT * FROM event_registration_dietary')).toEqual([{id: 1, choice: 'MEAT', payload: 'retained meal'}]);
        expect(await runner.hasColumn('events', 'allow_diet_comment')).toBe(false);
        expect((await physicalColumn('event_registration_dietary', 'choice')).type).not.toContain('COMMENT');
    });

    it('extends and restores the historical distribution enum while retaining costs and native downgrade rejection', async () => {
        await runner.query(`CREATE TABLE event_invoice_pools (id int PRIMARY KEY,
            distribution_method enum('EQUAL','TIME_BASED') NOT NULL DEFAULT 'EQUAL', amount decimal(10,2))`);
        await runner.query("INSERT INTO event_invoice_pools VALUES (1, 'EQUAL', 10.50), (2, 'TIME_BASED', 12.75)");
        const migration = new AddNightBasedInvoiceDist1785039317554();
        await migration.up(runner);
        await migration.up(runner);
        await runner.query("INSERT INTO event_invoice_pools VALUES (3, 'NIGHTS', 15.25)");
        await expect(migration.down(runner)).rejects.toThrow();
        expect(await runner.query('SELECT * FROM event_invoice_pools WHERE id = 3')).toEqual([{id: 3, distribution_method: 'NIGHTS', amount: '15.25'}]);
        await runner.query('DELETE FROM event_invoice_pools WHERE id = 3');
        await migration.down(runner);
        expect(await runner.query('SELECT * FROM event_invoice_pools ORDER BY id')).toEqual([
            {id: 1, distribution_method: 'EQUAL', amount: '10.50'}, {id: 2, distribution_method: 'TIME_BASED', amount: '12.75'},
        ]);
    });

    it('removes only Event registration settings on rollback and preserves unrelated data through retries', async () => {
        await runner.query(`CREATE TABLE events (id int PRIMARY KEY, payload varchar(50),
            retained_setting tinyint NOT NULL DEFAULT 1)`);
        await runner.query("INSERT INTO events VALUES (1, 'retained event', 1), (2, 'second event', 0)");
        await runner.query(`CREATE TABLE activity_plans (id int PRIMARY KEY, payload varchar(50),
            allow_overfill_after_full tinyint NOT NULL DEFAULT 0)`);
        await runner.query("INSERT INTO activity_plans VALUES (1, 'retained activity', 1), (2, 'second activity', 0)");
        // The former misspelled target is unrelated storage. Its identically named
        // columns and saved values must survive every upgrade and rollback below.
        await runner.query(`CREATE TABLE evente (id int PRIMARY KEY, payload varchar(50),
            allow_reg_date_update tinyint NOT NULL DEFAULT 0,
            allow_reg_cancel tinyint NOT NULL DEFAULT 0,
            allow_reg_diet_update tinyint NOT NULL DEFAULT 0)`);
        await runner.query("INSERT INTO evente VALUES (1, 'unrelated sentinel', 7, 8, 9)");
        const before = await snapshotMigrationDatabase(runner);
        const migration = new AddRegistrationDeadlineSettings1786335515684();
        await migration.up(runner);
        expect(await runner.query('SELECT * FROM events ORDER BY id')).toEqual([
            {id: 1, payload: 'retained event', retained_setting: 1,
                allow_reg_date_update: 0, allow_reg_cancel: 0, allow_reg_diet_update: 0},
            {id: 2, payload: 'second event', retained_setting: 0,
                allow_reg_date_update: 0, allow_reg_cancel: 0, allow_reg_diet_update: 0},
        ]);
        const defaults = await snapshotMigrationDatabase(runner);
        await runner.query(`UPDATE events SET allow_reg_date_update = 1,
            allow_reg_cancel = 1, allow_reg_diet_update = 1 WHERE id = 1`);
        expect(await runner.query(`SELECT allow_reg_date_update, allow_reg_cancel,
            allow_reg_diet_update FROM events WHERE id = 1`)).toEqual([
            {allow_reg_date_update: 1, allow_reg_cancel: 1, allow_reg_diet_update: 1},
        ]);
        const configured = await snapshotMigrationDatabase(runner);
        await migration.up(runner);
        expect(await snapshotMigrationDatabase(runner)).toEqual(configured);

        await migration.down(runner);
        for (const column of ['allow_reg_date_update', 'allow_reg_cancel', 'allow_reg_diet_update']) {
            expect(await runner.hasColumn('events', column)).toBe(false);
        }
        expect(await snapshotMigrationDatabase(runner)).toEqual(before);
        await migration.down(runner);
        expect(await snapshotMigrationDatabase(runner)).toEqual(before);

        // Explicit rollback discards the configured flags as approved. Upgrading
        // again recreates default settings while retaining all original rows/schema.
        await migration.up(runner);
        expect(await snapshotMigrationDatabase(runner)).toEqual(defaults);
        await migration.down(runner);
        expect(await snapshotMigrationDatabase(runner)).toEqual(before);
    });

    it('retains invoice values and the recorded rejection-to-NEW downgrade through review history', async () => {
        await runner.query(`CREATE TABLE event_invoices (id int PRIMARY KEY, amount decimal(10,2),
            status enum('NEW','APPROVED','CLOSED') NOT NULL DEFAULT 'NEW')`);
        await runner.query("INSERT INTO event_invoices VALUES (1, 10.50, 'APPROVED')");
        const migration = new AddInvoiceReviewHistory1787875200000();
        await migration.up(runner);
        await runner.query(`INSERT INTO event_invoices (id, amount, status, corrected_amount, corrected_description, rejection_reason)
            VALUES (2, 12.75, 'REJECTED', 11.25, 'saved correction', 'saved reason')`);
        const after = await snapshotMigrationDatabase(runner);
        await migration.up(runner);
        expect(await snapshotMigrationDatabase(runner)).toEqual(after);
        await migration.down(runner);
        expect(await runner.query('SELECT * FROM event_invoices ORDER BY id')).toEqual([
            {id: 1, amount: '10.50', status: 'APPROVED'}, {id: 2, amount: '12.75', status: 'NEW'},
        ]);
        expect(await runner.hasColumn('event_invoices', 'corrected_amount')).toBe(false);
    });

    it('upgrades every historical tracking table while preserving stored times and restores the prior precision', async () => {
        const both = ['guests', 'users', 'drivers_items', 'drivers_assignments', 'drivers_lists', 'packing_items',
            'packing_assignments', 'packing_lists', 'event_reg_links', 'events', 'activity_slots',
            'activity_assignment_recommendations', 'activity_plan_requirement_overrides', 'activity_plan_text_fields',
            'activity_plans', 'activity_assignment_roles', 'event_invoice_pools', 'event_invoices',
            'entity_admin_assignments', 'survey_responses', 'survey_combinations', 'surveys'];
        const createdOnly = ['event_registrations', 'activity_assignments', 'event_invoice_shares',
            'event_invoice_surcharges', 'event_invoice_assignments', 'event_pool_takeovers'];
        const absent = ['event_registration_dietary', 'activity_slot_role', 'activity_plan_requirements', 'activity_roles', 'entity_permissions'];
        const nullable = new Set(['drivers_lists.created_at', 'packing_lists.created_at', 'activity_assignments.created_at',
            ...['activity_slots', 'activity_plan_requirement_overrides',
                'activity_plan_text_fields', 'activity_plans', 'activity_assignment_roles'].flatMap(table => [`${table}.created_at`, `${table}.updated_at`])]);
        const original = new Map<string, unknown>();
        // Model the preceding timestamp definitions explicitly; entity synchronization
        // would conceal whether the historical ALTER statements actually work.
        for (const table of [...both, ...createdOnly, ...absent]) {
            const fields = both.includes(table) ? ['created_at', 'updated_at'] : createdOnly.includes(table) ? ['created_at'] : [];
            const definitions = fields.map(field => `\`${field}\` timestamp(0) ${nullable.has(`${table}.${field}`) ? 'NULL' : 'NOT NULL'} DEFAULT CURRENT_TIMESTAMP()`);
            await runner.query(`CREATE TABLE \`${table}\` (id int PRIMARY KEY, payload varchar(50)${definitions.length ? ', ' + definitions.join(', ') : ''})`);
            const values = fields.map(() => "'2020-01-02 03:04:05'");
            await runner.query(`INSERT INTO \`${table}\` VALUES (1, 'retained ${table}'${values.length ? ', ' + values.join(', ') : ''})`);
            original.set(table, await runner.query(`SELECT id, payload${fields.length ? ', ' + fields.join(', ') : ''} FROM \`${table}\``));
        }
        const before = await snapshotMigrationDatabase(runner);
        const migration = new UpdateTracking1785614240136();
        await migration.up(runner);
        await migration.up(runner);
        for (const table of [...both, ...createdOnly, ...absent]) {
            const fields = both.includes(table) ? ['created_at', 'updated_at'] : createdOnly.includes(table) ? ['created_at'] : [];
            expect(await runner.query(`SELECT id, payload${fields.length ? ', ' + fields.join(', ') : ''} FROM \`${table}\``)).toEqual(original.get(table));
            expect(Number((await physicalColumn(table, 'created_at')).fractionalDigits)).toBe(6);
        }
        await migration.down(runner);
        expect(await snapshotMigrationDatabase(runner)).toEqual(before);
    }, 120_000);
});
