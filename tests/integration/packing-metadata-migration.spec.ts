import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {AddPackingMetadataRevision1791072000000} from '../../src/migrations/1791072000000-AddPackingMetadataRevision';
import {AppDataSource} from '../../src/modules/database/dataSource';
import {PackingList} from '../../src/modules/database/entities/packing/PackingList';
import * as packingService from '../../src/modules/database/services/PackingService';
import {assignPackingItem, createPackingListWithItem, persistIntegrationProfile} from '../keywords/coreDomainKeywords';
import {closeIntegrationDatabase, initializeIntegrationDatabase} from '../support/database';

beforeAll(initializeIntegrationDatabase, 120_000);
afterAll(closeIntegrationDatabase);

describe('packing metadata revision migration', () => {
    it('upgrades populated old tables, matches entity metadata and tolerates repeated migration calls', async () => {
        const owner = await persistIntegrationProfile();
        const [id, item] = await createPackingListWithItem(owner.id);
        await assignPackingItem(item.id, owner.id);
        const runner = AppDataSource.createQueryRunner();
        await runner.connect();
        const migration = new AddPackingMetadataRevision1791072000000();
        try {
            const synchronized = (await runner.getTable('packing_lists'))!.findColumnByName('metadata_revision')!;
            // This suite uses the guarded disposable database. Removing only the new column
            // models an existing installation while retaining actual list/item/assignment rows.
            await migration.down(runner);
            await migration.down(runner);
            expect((await runner.getTable('packing_lists'))!.findColumnByName('metadata_revision')).toBeUndefined();
            await migration.up(runner);
            await migration.up(runner);
            const migrated = (await runner.getTable('packing_lists'))!.findColumnByName('metadata_revision')!;
            expect({type: migrated.type, unsigned: migrated.unsigned, nullable: migrated.isNullable, default: migrated.default})
                .toEqual({type: synchronized.type, unsigned: synchronized.unsigned, nullable: synchronized.isNullable, default: synchronized.default});
            expect(await AppDataSource.getRepository(PackingList).findOneByOrFail({id}))
                .toMatchObject({title: 'Camp packing list', description: 'Shared equipment', ownerId: owner.id, metadataRevision: 0});
            expect((await packingService.getPackingItems(id))[0]).toMatchObject({id: item.id, title: 'Group tent'});
            expect(await packingService.getPackingAssignments(id, owner.id)).toEqual([item.id]);
            await packingService.updatePackingListTitle(id, 'Revision advances after upgrade');
            expect((await AppDataSource.getRepository(PackingList).findOneByOrFail({id})).metadataRevision).toBe(1);
        } finally {
            // Restore the expected schema even when an assertion fails, before later suites run.
            await migration.up(runner);
            await runner.release();
        }
    });
});
