import {randomUUID} from 'node:crypto';
import type {QueryRunner, Table} from 'typeorm';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {AddEntityArchival1789862400000} from '../../src/migrations/1789862400000-AddEntityArchival';
import {AppDataSource} from '../../src/modules/database/dataSource';
import {ActivityPlan} from '../../src/modules/database/entities/activity/ActivityPlan';
import {EntityVisibilityPreference} from '../../src/modules/database/entities/archive/EntityVisibilityPreference';
import {DriversList} from '../../src/modules/database/entities/drivers/DriversList';
import {Event} from '../../src/modules/database/entities/event/Event';
import {PackingItem} from '../../src/modules/database/entities/packing/PackingItem';
import {PackingList} from '../../src/modules/database/entities/packing/PackingList';
import {Survey} from '../../src/modules/database/entities/surveys/Survey';
import {getRootRepository} from '../../src/modules/database/services/EntityLifecycleService';
import type {ArchiveReference} from '../../src/types/ArchiveTypes';
import {createPackingItemEntity} from '../factories/integrationEntityFactory';
import {persistIntegrationProfile} from '../keywords/coreDomainKeywords';
import {closeIntegrationDatabase, initializeIntegrationDatabase} from '../support/database';

// This suite deliberately performs real DDL against the guarded disposable integration
// schema. It rehearses both a fresh schema bootstrap and an upgrade of populated old tables;
// repositories, TypeORM metadata and migration execution all remain production implementations.
const migration = new AddEntityArchival1789862400000();
const rootTables = ['events', 'activity_plans', 'packing_lists', 'drivers_lists', 'surveys'];
const preferenceTable = 'entity_visibility_preferences';
let runner: QueryRunner;
let ownerId: string;
let eventId: string;
let activityId: string;
let itemId: string;
let refs: ArchiveReference[];
let synchronizedSchema: unknown;

/**
 * Describe stable schema semantics rather than generated names or AUTO_INCREMENT counters.
 * Existing roots contribute only columns/indices added by archival; the new preference
 * table contributes its complete contract, including profile ownership and cascade behavior.
 * Sorted columns/indices prevent metadata enumeration order from masquerading as schema drift.
 */
function describeTable(table: Table, archiveOnly: boolean) {
    const columns = [];
    for (const column of table.columns) {
        if (archiveOnly && !['archived_at', 'auto_archive_paused'].includes(column.name)) {
            continue;
        }
        columns.push({
            name: column.name, type: column.type, length: column.length, precision: column.precision,
            nullable: column.isNullable, primary: column.isPrimary, generated: column.isGenerated,
            default: column.default, onUpdate: column.onUpdate, enum: column.enum,
        });
    }
    columns.sort((a, b) => a.name.localeCompare(b.name));

    const indices = [];
    for (const index of table.indices) {
        if (archiveOnly && !index.name.endsWith('_auto_archive')) {
            continue;
        }
        indices.push({name: index.name, columns: index.columnNames, unique: index.isUnique});
    }
    indices.sort((a, b) => a.name.localeCompare(b.name));

    const foreignKeys = [];
    if (!archiveOnly) {
        // Ignore generated constraint names while retaining their referenced columns and
        // actions. A rename is harmless; losing profile ownership or CASCADE is not.
        for (const key of table.foreignKeys) {
            foreignKeys.push({
                columns: key.columnNames, referencedTable: key.referencedTableName,
                referencedColumns: key.referencedColumnNames, onDelete: key.onDelete, onUpdate: key.onUpdate,
            });
        }
    }
    return {columns, indices, foreignKeys};
}

/** Read the actual database schema, including explicit null for a missing migration table. */
async function archiveSchema() {
    const tables = [];
    for (const name of [...rootTables, preferenceTable]) {
        const table = await runner.getTable(name);
        tables.push({name, definition: table ? describeTable(table, name !== preferenceTable) : null});
    }
    return tables;
}

/**
 * Re-read persisted fixtures after migration instead of trusting pre-migration objects.
 * Assert business content, links, date values and attachment references survive, while new
 * archival columns receive active defaults and no personal preference is invented.
 */
async function expectActiveRootsPreserved() {
    for (const ref of refs) {
        const root = await getRootRepository(AppDataSource.manager, ref.type).findOneByOrFail({id: ref.id});
        expect(root).toMatchObject({ownerId, title: `Migration ${ref.type}`, archivedAt: null, headerImg: 'uploads/headerImgs/retained.png'});
    }
    expect(await AppDataSource.getRepository(Event).findOneByOrFail({id: eventId})).toMatchObject({
        startDate: '2026-06-01', endDate: '2026-06-03', autoArchivePaused: false,
    });
    expect(await AppDataSource.getRepository(ActivityPlan).findOneByOrFail({id: activityId})).toMatchObject({
        eventId, startDate: '2026-06-01', endDate: '2026-06-03', autoArchivePaused: false,
    });
    expect(await AppDataSource.getRepository(PackingItem).findOneByOrFail({id: itemId}))
        .toMatchObject({title: 'Retained packing item', description: 'Preserved through the upgrade'});
    expect(await AppDataSource.getRepository(EntityVisibilityPreference).count()).toBe(0);
}

describe('entity archival migration rehearsal', () => {
    beforeAll(async () => {
        // This initializer checks the dedicated TEST_DB_NAME before rebuilding its schema.
        // Never substitute the application datasource initialization here: the down/up
        // rehearsal below is intentionally destructive to archival schema, even with fixtures.
        await initializeIntegrationDatabase();
        runner = AppDataSource.createQueryRunner();
        await runner.connect();
        // Schema synchronization supplies the entity-metadata baseline. Migration-created
        // columns and constraints must match it for existing installations as well as new ones.
        synchronizedSchema = await archiveSchema();
        ownerId = (await persistIntegrationProfile()).id;
        // Use a reference string only; this suite never creates, reads or deletes an uploaded
        // image. Preserving the stored path is the migration's file-related responsibility.
        const common = {owner: {id: ownerId}, headerImg: 'uploads/headerImgs/retained.png'};
        const event = await AppDataSource.getRepository(Event).save({
            ...common, id: randomUUID(), title: 'Migration event', startDate: '2026-06-01', endDate: '2026-06-03',
        });
        eventId = event.id;
        // Include both dated and undated children attached to the event, plus an independent
        // survey. This checks every root table and preservation of existing event relations.
        const activity = await AppDataSource.getRepository(ActivityPlan).save({
            ...common, id: randomUUID(), title: 'Migration activity', event: {id: eventId},
            startDate: '2026-06-01', endDate: '2026-06-03',
        });
        activityId = activity.id;
        const packing = await AppDataSource.getRepository(PackingList).save({
            ...common, id: randomUUID(), title: 'Migration packing', event: {id: eventId},
        });
        const drivers = await AppDataSource.getRepository(DriversList).save({
            ...common, id: randomUUID(), title: 'Migration drivers', event: {id: eventId},
        });
        const survey = await AppDataSource.getRepository(Survey).save({...common, id: randomUUID(), title: 'Migration survey'});
        // A nested business record proves that migrating root metadata leaves content intact;
        // merely counting roots would miss accidental loss of their attached item rows.
        const item = await AppDataSource.getRepository(PackingItem).save(createPackingItemEntity({
            title: 'Retained packing item', description: 'Preserved through the upgrade', entity: packing,
        }));
        itemId = item.id;
        refs = [{type: 'event', id: eventId}, {type: 'activity', id: activityId},
            {type: 'packing', id: packing.id}, {type: 'drivers', id: drivers.id}, {type: 'survey', id: survey.id}];
    });

    afterAll(async () => {
        // Release the explicitly acquired query connection before closing the shared test
        // datasource, including when an assertion or migration rehearsal failed.
        if (runner && !runner.isReleased) await runner.release();
        await closeIntegrationDatabase();
    });

    it('accepts schema-sync-then-migrate bootstrap and repeated application without changing the schema or rows', async () => {
        // New disposable databases are synchronized before migrations are recorded. The
        // migration must accept that already-current schema and safely tolerate another run.
        await migration.up(runner);
        await migration.up(runner);
        expect(await archiveSchema()).toEqual(synchronizedSchema);
        await expectActiveRootsPreserved();
    });

    it('upgrades the preceding schema while preserving existing roots, relationships, contents and defaults', async () => {
        try {
            // All fixtures are active and have no private preferences, so down is permitted.
            // Remove only this feature's schema, retaining populated business tables to model
            // an existing installation immediately before the archival migration.
            await migration.down(runner);
            expect(await runner.hasTable(preferenceTable)).toBe(false);
            for (const table of rootTables) expect(await runner.hasColumn(table, 'archived_at')).toBe(false);
            // Reapply the actual migration, then compare its result with TypeORM's baseline
            // and the original persisted fixtures. Another up checks the upgraded path too.
            await migration.up(runner);
            await expectActiveRootsPreserved();
            expect(await archiveSchema()).toEqual(synchronizedSchema);
            await migration.up(runner);
            expect(await archiveSchema()).toEqual(synchronizedSchema);
        } finally {
            // Keep later preflight cases usable if a preservation assertion fails after the rehearsal.
            await migration.up(runner);
        }
    });

    it('matches the profile UUID storage and collation and retains the preference uniqueness and cascade contract', async () => {
        // MariaDB requires compatible character storage for a string foreign key. Reading
        // information_schema catches collation mismatches that entity metadata alone can miss.
        const columns: Array<{tableName: string; columnType: string; characterSet: string | null; collation: string | null}> = await runner.query(`
            SELECT TABLE_NAME AS tableName, COLUMN_TYPE AS columnType,
                   CHARACTER_SET_NAME AS characterSet, COLLATION_NAME AS collation
            FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
              AND ((TABLE_NAME = 'profiles' AND COLUMN_NAME = 'id')
                OR (TABLE_NAME = 'entity_visibility_preferences' AND COLUMN_NAME = 'profile_id'))
        `);
        const profile = columns.find(column => column.tableName === 'profiles')!;
        const preference = columns.find(column => column.tableName === preferenceTable)!;
        expect(preference).toMatchObject({columnType: profile.columnType, characterSet: profile.characterSet, collation: profile.collation});
        // One override may exist per profile/type/ID. Only profile ownership is a real FK:
        // entity_type/entity_id spans several root tables and is intentionally polymorphic.
        const table = (await runner.getTable(preferenceTable))!;
        expect(table.indices).toEqual(expect.arrayContaining([
            expect.objectContaining({name: 'uk_entity_visibility_profile_target', columnNames: ['profile_id', 'entity_type', 'entity_id'], isUnique: true}),
            expect.objectContaining({name: 'idx_entity_visibility_target', columnNames: ['entity_type', 'entity_id']}),
        ]));
        expect(table.foreignKeys).toEqual(expect.arrayContaining([
            expect.objectContaining({columnNames: ['profile_id'], referencedTableName: 'profiles', referencedColumnNames: ['id'], onDelete: 'CASCADE', onUpdate: 'CASCADE'}),
        ]));
    });

    it('refuses rollback before any DDL when an archived root exists, including a later-scanned table', async () => {
        // Put state in the final root table to catch partial rollback: checking and dropping
        // each table in one loop would already damage earlier tables before finding this row.
        const survey = refs.find(ref => ref.type === 'survey')!;
        await AppDataSource.getRepository(Survey).update(survey.id, {archivedAt: new Date('2026-08-01T00:00:00Z')});
        try {
            await expect(migration.down(runner)).rejects.toThrow('archived entities exist');
            expect(await archiveSchema()).toEqual(synchronizedSchema);
            expect((await AppDataSource.getRepository(Survey).findOneByOrFail({id: survey.id})).archivedAt).not.toBeNull();
        } finally {
            // Restore only this test's marker so the following preflight cases remain isolated.
            await AppDataSource.getRepository(Survey).update(survey.id, {archivedAt: null});
        }
    });

    it('refuses rollback before any DDL when an automatic archival pause exists', async () => {
        // A pause is an organizer decision even on an active root. Rollback must preserve it
        // rather than silently dropping the column merely because no archived timestamp exists.
        await AppDataSource.getRepository(ActivityPlan).update(activityId, {autoArchivePaused: true});
        try {
            await expect(migration.down(runner)).rejects.toThrow('automatic archival is paused');
            expect(await archiveSchema()).toEqual(synchronizedSchema);
            expect((await AppDataSource.getRepository(ActivityPlan).findOneByOrFail({id: activityId})).autoArchivePaused).toBe(true);
        } finally {
            await AppDataSource.getRepository(ActivityPlan).update(activityId, {autoArchivePaused: false});
        }
    });

    it('refuses rollback before any DDL when personal preferences exist', async () => {
        // A private "shown" choice is meaningful even while the entity is active. Removing
        // the table would lose that choice, so the rollback guard must detect preferences too.
        const repo = AppDataSource.getRepository(EntityVisibilityPreference);
        const preference = await repo.save({profile: {id: ownerId}, entityType: 'event', entityId: eventId, visibility: 'SHOWN'});
        try {
            await expect(migration.down(runner)).rejects.toThrow('personal visibility preferences exist');
            expect(await archiveSchema()).toEqual(synchronizedSchema);
            expect(await repo.findOneByOrFail({id: preference.id})).toMatchObject({visibility: 'SHOWN', entityId: eventId});
        } finally {
            await repo.delete(preference.id);
        }
    });

    it.each(['event', 'activity'] as const)('offers the eligibility index to the %s candidate query', async type => {
        // Inspect the migration's index against the automatic-eligibility predicate;
        // production query construction remains private to the lifecycle service.
        const query = type === 'event'
            ? AppDataSource.getRepository(Event).createQueryBuilder('root')
            : AppDataSource.getRepository(ActivityPlan).createQueryBuilder('root');
        query.select('root.id')
            .where('root.archived_at IS NULL').andWhere('root.auto_archive_paused = 0')
            .andWhere('root.end_date <= :cutoff', {cutoff: '2026-09-01'});
        if (type === 'activity') query.andWhere('root.event_id IS NULL');
        const [sql, params] = query.orderBy('root.end_date', 'ASC').addOrderBy('root.id', 'ASC').limit(200).getQueryAndParameters();
        // This tiny fixture may make a full scan cheaper than using the index. Assert that
        // MariaDB considers the intended index eligible, not that it must choose that plan.
        const explanation: Array<{possible_keys: string | null}> = await runner.query(`EXPLAIN ${sql}`, params);
        const indexName = type === 'event' ? 'idx_events_auto_archive' : 'idx_activity_plans_auto_archive';
        expect(explanation.some(row => row.possible_keys?.split(',').includes(indexName))).toBe(true);
    });
});
