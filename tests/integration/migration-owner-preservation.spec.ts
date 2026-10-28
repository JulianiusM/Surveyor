import {randomUUID} from 'node:crypto';
import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it} from 'vitest';
import type {QueryRunner} from 'typeorm';
import {AddProfiles1785610467095} from '../../src/backend/migrations/1785610467095-AddProfiles';
import {AppDataSource} from '../../src/backend/modules/database/dataSource';
import {ActivityPlan} from '../../src/backend/modules/database/entities/activity/ActivityPlan';
import {DriversList} from '../../src/backend/modules/database/entities/drivers/DriversList';
import {Event} from '../../src/backend/modules/database/entities/event/Event';
import {PackingList} from '../../src/backend/modules/database/entities/packing/PackingList';
import {PackingItem} from '../../src/backend/modules/database/entities/packing/PackingItem';
import {ActivitySlot} from '../../src/backend/modules/database/entities/activity/ActivitySlot';
import {ActivityAssignment} from '../../src/backend/modules/database/entities/activity/ActivityAssignment';
import {ActivityRole} from '../../src/backend/modules/database/entities/activity/ActivityRole';
import {Survey} from '../../src/backend/modules/database/entities/surveys/Survey';
import {Profile} from '../../src/backend/modules/database/entities/user/Profile';
import {User} from '../../src/backend/modules/database/entities/user/User';
import {Guest} from '../../src/backend/modules/database/entities/user/Guest';
import {createActivitySlotEntity, createPackingItemEntity, createProfileEntity, createUserEntity} from '../factories/integrationEntityFactory';
import {closeIntegrationDatabase, initializeIntegrationDatabase} from '../support/database';
import {snapshotMigrationDatabase} from '../support/migrationSnapshot';

const migration = new AddProfiles1785610467095();
const rootTables = ['drivers_lists', 'packing_lists', 'events', 'activity_plans', 'surveys'] as const;
let runner: QueryRunner;

/** Persist all five actual root kinds with identity, payload and linked-event evidence. */
async function seedProfileOwnership() {
    const user = await AppDataSource.getRepository(User).save(createUserEntity());
    const profile = await AppDataSource.getRepository(Profile).save(createProfileEntity(user));
    const common = {owner: {id: profile.id}, description: 'Retained owner payload αβ', headerImg: 'uploads/headerImgs/retained.png'};
    const event = await AppDataSource.getRepository(Event).save({...common, id: randomUUID(), title: 'Retained event',
        startDate: '2030-06-01', endDate: '2030-06-03'});
    await AppDataSource.getRepository(DriversList).save({...common, id: randomUUID(), title: 'Retained drivers', event: {id: event.id}});
    const packing = await AppDataSource.getRepository(PackingList).save({...common, id: randomUUID(), title: 'Retained packing', event: {id: event.id}});
    const activity = await AppDataSource.getRepository(ActivityPlan).save({...common, id: randomUUID(), title: 'Retained activities',
        event: {id: event.id}, startDate: '2030-06-01', endDate: '2030-06-03'});
    await AppDataSource.getRepository(Survey).save({...common, id: randomUUID(), title: 'Retained survey'});
    const item = await AppDataSource.getRepository(PackingItem).save(createPackingItemEntity({entity: packing, profile,
        title: 'Retained nested item', description: 'Nested packing payload äβ'}));
    const slot = await AppDataSource.getRepository(ActivitySlot).save(createActivitySlotEntity({entity: activity, profile,
        day: '2030-06-01', title: 'Retained nested slot', description: 'Nested activity payload äβ'}));
    // Old exact timestamps are deliberate preservation oracles: an owner-only
    // backfill must not silently invoke ON UPDATE or truncate six-digit precision.
    for (const table of [...rootTables, 'users', 'profiles', 'packing_items', 'activity_slots']) {
        await runner.query(`UPDATE \`${table}\` SET created_at = '2001-02-03 04:05:06.123456', updated_at = '2002-03-04 05:06:07.654321'`);
    }
    return {user, profile, packing, activity, item, slot};
}

/** Read every saved owner and any orphan through actual database joins. */
async function ownerEvidence() {
    const evidence = [];
    for (const table of rootTables) {
        evidence.push({table, rows: await runner.query(`SELECT t.id, HEX(t.owner_id) AS ownerBytes,
            t.owner_id IS NOT NULL AND p.id IS NULL AS orphan FROM \`${table}\` t LEFT JOIN profiles p ON p.id = t.owner_id ORDER BY t.id`),
        columns: await runner.query(`SELECT COLUMN_TYPE, CHARACTER_SET_NAME, COLLATION_NAME, IS_NULLABLE
            FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = 'owner_id'`, [table])});
    }
    return evidence;
}

/** Restore actual synchronized table definitions and values with one consistently
 * different UUID representation. This is fixture setup, never migration execution. */
async function prepareProfileStorage(storage: 'text' | 'binary'): Promise<void> {
    const snapshot = await snapshotMigrationDatabase(runner);
    const identifiers = await runner.query(`SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName
        FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND DATA_TYPE = 'uuid'`) as Array<{tableName: string; columnName: string}>;
    const definition = storage === 'text' ? 'varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin' : 'binary(16)';
    // Restore a complete consistent graph, including its original constraints.
    // Creation ordering is isolated fixture preparation on the guarded schema;
    // the actual migration below always starts with checks enabled and no orphans.
    await runner.clearDatabase();
    await runner.query('SET FOREIGN_KEY_CHECKS = 0');
    try {
        for (const table of snapshot) {
            let create = table.definition;
            for (const column of identifiers.filter(column => column.tableName === table.name)) {
                const escaped = column.columnName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
                create = create.replace(new RegExp('(`' + escaped + '`\\s+)uuid\\b', 'iu'), '$1' + definition);
            }
            await runner.query(create);
        }
        for (const table of snapshot) {
            const uuidColumns = new Set(identifiers.filter(column => column.tableName === table.name).map(column => column.columnName));
            for (const saved of table.rows) {
                const row = JSON.parse(saved) as Record<string, unknown>;
                const columns = Object.keys(row);
                const values = columns.map(column => {
                    const value = row[column];
                    if (storage === 'binary' && uuidColumns.has(column) && value !== null) {
                        return Buffer.from(String(value).replaceAll('-', ''), 'hex');
                    }
                    return value && typeof value === 'object' && 'bytes' in value
                        ? Buffer.from(String(value.bytes), 'hex') : value;
                });
                const names = columns.map(column => `\`${column.replaceAll('`', '``')}\``).join(', ');
                await runner.query(`INSERT INTO \`${table.name.replaceAll('`', '``')}\` (${names}) VALUES (${columns.map(() => '?').join(', ')})`, values);
            }
        }
    } finally { await runner.query('SET FOREIGN_KEY_CHECKS = 1'); }
    for (const {rows} of await ownerEvidence()) expect(rows).toEqual([expect.objectContaining({orphan: 0})]);
}

/** Reconstruct proven numeric User ownership while preserving all other fields. */
async function prepareNumericOwners(): Promise<void> {
    for (const table of rootTables) {
        const foreignKeys = await runner.query(`SELECT CONSTRAINT_NAME AS name FROM information_schema.KEY_COLUMN_USAGE
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = 'owner_id'
                AND REFERENCED_TABLE_NAME IS NOT NULL`, [table]) as Array<{name: string}>;
        expect(foreignKeys).toHaveLength(1);
        for (const foreignKey of foreignKeys) {
            await runner.query(`ALTER TABLE \`${table}\` DROP FOREIGN KEY \`${foreignKey.name.replaceAll('`', '``')}\``);
        }
        // Preserve the exact source relationship through an explicit fixture
        // destination, then install a real User FK as legacy ownership evidence.
        await runner.query(`ALTER TABLE \`${table}\` ADD fixture_user_owner int NULL`);
        await runner.query(`UPDATE \`${table}\` t JOIN profiles p ON p.id = t.owner_id
            SET t.fixture_user_owner = p.user_id, t.updated_at = t.updated_at`);
        await runner.query(`ALTER TABLE \`${table}\` DROP owner_id, CHANGE fixture_user_owner owner_id int NULL`);
        for (const foreignKey of foreignKeys) {
            const name = foreignKey.name.replaceAll('`', '``');
            await runner.query(`ALTER TABLE \`${table}\` ADD CONSTRAINT \`${name}\` FOREIGN KEY (owner_id)
                REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE`);
        }
    }
}

/** Compare every original row, excluding only explicitly converted owner storage. */
function rowsWithoutOwner(snapshot: Awaited<ReturnType<typeof snapshotMigrationDatabase>>) {
    return snapshot.map(({name, rows}) => ({name, rows: rows.map(saved => {
        if (!rootTables.includes(name as typeof rootTables[number])) return saved;
        const row = JSON.parse(saved) as Record<string, unknown>;
        delete row.owner_id;
        delete row.owner_profile_id;
        return JSON.stringify(row);
    }).sort()}));
}

// The complete historical transition, retry and exact full-schema snapshots
// exceed the ordinary unit budget; this suite's DDL budget is not a runtime SLA.
describe('Profile migration preserves proven ownership across the complete application schema', {timeout: 30_000}, () => {
    beforeAll(initializeIntegrationDatabase);
    beforeEach(async () => {
        await AppDataSource.synchronize(true);
        runner = AppDataSource.createQueryRunner();
        await runner.connect();
    });
    afterEach(async () => { if (runner && !runner.isReleased) await runner.release(); });
    afterAll(closeIntegrationDatabase);

    it('retains populated native UUID Profile owners on every synchronized root and safely retries', async () => {
        await seedProfileOwnership();
        const before = await snapshotMigrationDatabase(runner);
        const owners = await ownerEvidence();
        await migration.up(runner);
        expect(await ownerEvidence()).toEqual(owners);
        const after = await snapshotMigrationDatabase(runner);
        expect(after.map(({name, rows}) => ({name, rows}))).toEqual(before.map(({name, rows}) => ({name, rows})));
        for (const {rows} of await ownerEvidence()) {
            expect(rows).toHaveLength(1);
            expect(rows[0].orphan).toBe(0);
        }
        await migration.up(runner);
        expect(await snapshotMigrationDatabase(runner)).toEqual(after);
    });

    it.each(['text', 'binary'] as const)('preserves populated %s Profile ownership, payloads, timestamps and retry', async storage => {
        await seedProfileOwnership();
        await prepareProfileStorage(storage);
        const before = await snapshotMigrationDatabase(runner);
        const owners = await ownerEvidence();
        await migration.up(runner);
        expect(await ownerEvidence()).toEqual(owners);
        const after = await snapshotMigrationDatabase(runner);
        expect(after.map(({name, rows}) => ({name, rows}))).toEqual(before.map(({name, rows}) => ({name, rows})));
        await migration.up(runner);
        expect(await snapshotMigrationDatabase(runner)).toEqual(after);
    });

    it.each(['empty', 'matching'] as const)('converts uniquely mapped numeric User owners with %s temporary columns and safely retries', async partial => {
        const {profile} = await seedProfileOwnership();
        await prepareNumericOwners();
        for (const table of rootTables) {
            await runner.query(`ALTER TABLE \`${table}\` ADD owner_profile_id uuid NULL`);
            if (partial === 'matching') await runner.query(`UPDATE \`${table}\` SET owner_profile_id = ?, updated_at = updated_at`, [profile.id]);
        }
        const before = await snapshotMigrationDatabase(runner);
        await migration.up(runner);
        const after = await snapshotMigrationDatabase(runner);
        expect(rowsWithoutOwner(after)).toEqual(rowsWithoutOwner(before));
        for (const table of rootTables) {
            expect(await runner.query(`SELECT owner_id, p.id IS NULL AS orphan FROM \`${table}\` t
                LEFT JOIN profiles p ON p.id = t.owner_id`)).toEqual([{owner_id: profile.id, orphan: 0}]);
            expect(await runner.hasColumn(table, 'owner_profile_id')).toBe(false);
        }
        await migration.up(runner);
        expect(await snapshotMigrationDatabase(runner)).toEqual(after);
    });

    it.each(['missing user', 'multiple profiles', 'conflicting temporary', 'missing temporary target'] as const)
    ('rejects %s mapping before any table, constraint or saved row changes', async scenario => {
        const {user} = await seedProfileOwnership();
        await prepareNumericOwners();
        if (scenario === 'missing user') {
            const foreignKeys = await runner.query(`SELECT CONSTRAINT_NAME AS name FROM information_schema.KEY_COLUMN_USAGE
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'surveys' AND COLUMN_NAME = 'owner_id'
                    AND REFERENCED_TABLE_NAME IS NOT NULL`) as Array<{name: string}>;
            for (const foreignKey of foreignKeys) {
                await runner.query(`ALTER TABLE surveys DROP FOREIGN KEY \`${foreignKey.name.replaceAll('`', '``')}\``);
            }
            await runner.query('UPDATE surveys SET owner_id = 2000000000, updated_at = updated_at');
        } else if (scenario === 'multiple profiles') {
            await AppDataSource.getRepository(Profile).save(createProfileEntity(user, {name: 'Ambiguous second profile'}));
        } else {
            await runner.query('ALTER TABLE surveys ADD owner_profile_id uuid NULL');
            const otherUser = await AppDataSource.getRepository(User).save(createUserEntity());
            const otherProfile = await AppDataSource.getRepository(Profile).save(createProfileEntity(otherUser));
            await runner.query('UPDATE surveys SET owner_profile_id = ?, updated_at = updated_at',
                [scenario === 'conflicting temporary' ? otherProfile.id : randomUUID()]);
        }
        const before = await snapshotMigrationDatabase(runner);
        await expect(migration.up(runner)).rejects.toThrow();
        expect(await snapshotMigrationDatabase(runner)).toEqual(before);
    });

    it('creates exactly one Profile for a verified legacy User with no mapping and retains every other saved value', async () => {
        const {profile} = await seedProfileOwnership();
        const newUser = await AppDataSource.getRepository(User).save(createUserEntity({name: 'Verified legacy owner'}));
        await prepareNumericOwners();
        await runner.query('UPDATE drivers_lists SET owner_id = ?, updated_at = updated_at', [newUser.id]);
        const before = await snapshotMigrationDatabase(runner);
        await migration.up(runner);
        const profiles = await runner.query('SELECT id, user_id, name FROM profiles ORDER BY user_id') as Array<{id: string; user_id: number; name: string}>;
        expect(profiles).toHaveLength(2);
        expect(profiles.find(row => row.id === profile.id)).toBeDefined();
        const created = profiles.find(row => row.user_id === newUser.id)!;
        expect(created).toMatchObject({user_id: newUser.id, name: 'Verified legacy owner'});
        expect(created.id).toBeTruthy();
        expect(created.id).not.toBe(profile.id);
        for (const table of rootTables) {
            expect(await runner.query(`SELECT owner_id, p.id IS NULL AS orphan FROM \`${table}\` t
                LEFT JOIN profiles p ON p.id = t.owner_id`)).toEqual([{owner_id: table === 'drivers_lists' ? created.id : profile.id, orphan: 0}]);
        }
        const after = await snapshotMigrationDatabase(runner);
        expect(rowsWithoutOwner(after).filter(table => table.name !== 'profiles'))
            .toEqual(rowsWithoutOwner(before).filter(table => table.name !== 'profiles'));
        expect(after.find(table => table.name === 'profiles')!.rows).toEqual(expect.arrayContaining(before.find(table => table.name === 'profiles')!.rows));
        await migration.up(runner);
        expect(await snapshotMigrationDatabase(runner)).toEqual(after);
    });

    it.each(['missing sibling identity', 'ambiguous sibling identity', 'dual sibling identity', 'conflicting sibling identity',
        'conflicting entity target', 'conflicting item target', 'long description', 'conflicting title', 'conflicting timestamp'] as const)
    ('refuses %s before unrelated migration DDL or writes', async scenario => {
        const {user, profile, packing, activity, slot} = await seedProfileOwnership();
        if (scenario.includes('sibling identity')) {
            await runner.query('ALTER TABLE packing_items ADD user_id int NULL, ADD guest_id uuid NULL');
            if (scenario === 'missing sibling identity') {
                await runner.query('UPDATE packing_items SET user_id = 2000000000, profile_id = NULL, updated_at = updated_at');
            } else if (scenario === 'ambiguous sibling identity') {
                await AppDataSource.getRepository(Profile).save(createProfileEntity(user, {name: 'Second possible sibling owner'}));
                await runner.query('UPDATE packing_items SET user_id = ?, profile_id = NULL, updated_at = updated_at', [user.id]);
            } else if (scenario === 'dual sibling identity') {
                const guest = await AppDataSource.getRepository(Guest).save({id: randomUUID(), username: 'Retained guest', token: randomUUID()});
                await AppDataSource.getRepository(Profile).save({id: randomUUID(), name: 'Guest profile', guest, defaultForOwner: true});
                await runner.query('UPDATE packing_items SET user_id = ?, guest_id = ?, profile_id = NULL, updated_at = updated_at', [user.id, guest.id]);
            } else {
                const otherUser = await AppDataSource.getRepository(User).save(createUserEntity());
                await AppDataSource.getRepository(Profile).save(createProfileEntity(otherUser));
                await runner.query('UPDATE packing_items SET user_id = ?, updated_at = updated_at', [otherUser.id]);
            }
        } else if (scenario === 'conflicting entity target') {
            const other = await AppDataSource.getRepository(PackingList).save({id: randomUUID(), title: 'Other retained list', owner: profile});
            await runner.query('ALTER TABLE packing_items ADD list_id uuid NULL');
            await runner.query('UPDATE packing_items SET list_id = ?, updated_at = updated_at', [other.id]);
            expect(other.id).not.toBe(packing.id);
        } else if (scenario === 'conflicting item target') {
            const otherSlot = await AppDataSource.getRepository(ActivitySlot).save(createActivitySlotEntity({entity: activity, profile,
                day: '2030-06-02', title: 'Other retained slot'}));
            await AppDataSource.getRepository(ActivityAssignment).save({entity: activity, item: slot, profile});
            await runner.query('ALTER TABLE activity_assignments ADD slot_id uuid NULL');
            await runner.query('UPDATE activity_assignments SET slot_id = ?, updated_at = updated_at', [otherSlot.id]);
            expect(otherSlot.id).not.toBe(slot.id);
        } else if (scenario === 'long description') {
            await runner.query('UPDATE activity_slots SET description = ?, updated_at = updated_at', ['Retained Unicode payload äβ '.repeat(40)]);
        } else if (scenario === 'conflicting title') {
            await AppDataSource.getRepository(ActivityRole).save({title: 'Saved current title', description: 'Retained role', entity: activity});
            await runner.query('ALTER TABLE activity_roles ADD name varchar(50) NULL');
            await runner.query('UPDATE activity_roles SET name = ?, updated_at = updated_at', ['Different legacy title']);
        } else {
            await AppDataSource.getRepository(ActivityAssignment).save({entity: activity, item: slot, profile});
            await runner.query('ALTER TABLE activity_assignments ADD updatedAt timestamp(6) NULL');
            await runner.query(`UPDATE activity_assignments SET updated_at = '2002-03-04 05:06:07.654321',
                updatedAt = '2002-03-04 05:06:07.123456'`);
        }
        const before = await snapshotMigrationDatabase(runner);
        await expect(migration.up(runner)).rejects.toThrow();
        expect(await snapshotMigrationDatabase(runner)).toEqual(before);
    });

    it('preserves a NULL owner without choosing a Profile from unrelated stored identities', async () => {
        await seedProfileOwnership();
        await runner.query('UPDATE surveys SET owner_id = NULL, updated_at = updated_at');
        const before = await snapshotMigrationDatabase(runner);
        const owners = await ownerEvidence();
        await migration.up(runner);
        expect(await ownerEvidence()).toEqual(owners);
        const after = await snapshotMigrationDatabase(runner);
        expect(after.map(({name, rows}) => ({name, rows}))).toEqual(before.map(({name, rows}) => ({name, rows})));
        expect(await runner.query('SELECT owner_id FROM surveys')).toEqual([{owner_id: null}]);
    });

    it('refuses a numeric-owner backfill trigger before it can overwrite retained descriptions', async () => {
        await seedProfileOwnership();
        await prepareNumericOwners();
        await runner.query(`CREATE TRIGGER retained_owner_update BEFORE UPDATE ON surveys FOR EACH ROW
            SET NEW.description = 'This trigger would overwrite retained business data'`);
        const before = await snapshotMigrationDatabase(runner);
        expect(before.find(table => table.name === 'surveys')!.triggers).toHaveLength(1);
        await expect(migration.up(runner)).rejects.toThrow();
        expect(await snapshotMigrationDatabase(runner)).toEqual(before);
    });

    it('refuses a missing legacy child with a default collation incompatible with its preserved Profile parent', async () => {
        const {user} = await seedProfileOwnership();
        await prepareProfileStorage('text');
        // Model the old User-only relation while retaining the real text Profile
        // parent. A plain varchar(36) destination would inherit this table default.
        const foreignKeys = await runner.query(`SELECT CONSTRAINT_NAME AS name FROM information_schema.KEY_COLUMN_USAGE
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'packing_items' AND COLUMN_NAME = 'profile_id'
                AND REFERENCED_TABLE_NAME IS NOT NULL`) as Array<{name: string}>;
        expect(foreignKeys).toHaveLength(1);
        for (const foreignKey of foreignKeys) {
            await runner.query(`ALTER TABLE packing_items DROP FOREIGN KEY \`${foreignKey.name.replaceAll('`', '``')}\``);
        }
        await runner.query('ALTER TABLE packing_items DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
        await runner.query(`ALTER TABLE packing_items DROP profile_id, ADD user_id int NULL,
            ADD CONSTRAINT FK_a0bad64d810ac4e76c23b86785d FOREIGN KEY (user_id) REFERENCES users(id)
                ON DELETE CASCADE ON UPDATE RESTRICT`);
        await runner.query('UPDATE packing_items SET user_id = ?, updated_at = updated_at', [user.id]);
        const before = await snapshotMigrationDatabase(runner);
        await expect(migration.up(runner)).rejects.toThrow();
        expect(await snapshotMigrationDatabase(runner)).toEqual(before);
    });

    it('refuses rollback before any mutation when a guest-owned root cannot retain its Profile owner', async () => {
        await seedProfileOwnership();
        const guest = await AppDataSource.getRepository(Guest).save({id: randomUUID(), username: 'Retained guest owner', token: randomUUID()});
        const guestProfile = await AppDataSource.getRepository(Profile).save({id: randomUUID(), name: 'Guest-owned root', guest, defaultForOwner: true});
        await runner.query('UPDATE surveys SET owner_id = ?, updated_at = updated_at', [guestProfile.id]);
        const before = await snapshotMigrationDatabase(runner);
        await expect(migration.down(runner)).rejects.toThrow();
        expect(await snapshotMigrationDatabase(runner)).toEqual(before);
    });
});
