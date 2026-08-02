import type {QueryRunner} from 'typeorm';
import {
    addColumnIfNotExists,
    createUniqueIndexIfNotExists,
    dropColumnIfExists,
    dropIndexIfExists,
    indexExists,
    tableExists,
} from '../../src/modules/database/utils/migration-helper';

type QueryCall = { sql: string; params?: unknown[] };

function createQueryRunnerMock(results: Array<unknown>): { queryRunner: QueryRunner; calls: QueryCall[] } {
    const calls: QueryCall[] = [];
    const queue = [...results];

    return {
        queryRunner: {
            query: jest.fn(async (sql: string, params?: unknown[]) => {
                calls.push({sql, params});
                return queue.shift() ?? [];
            }),
        } as unknown as QueryRunner,
        calls,
    };
}

describe('migration-helper index/table guards', () => {
    test('tableExists and indexExists read metadata counts', async () => {
        const {queryRunner} = createQueryRunnerMock([
            [{count: 1}],
            [{count: 0}],
        ]);

        await expect(tableExists(queryRunner, 'profiles')).resolves.toBe(true);
        await expect(indexExists(queryRunner, 'profiles', 'idx')).resolves.toBe(false);
    });

    test('createUniqueIndexIfNotExists creates only when missing', async () => {
        const {queryRunner, calls} = createQueryRunnerMock([
            [{count: 0}],
            [],
            [{count: 1}],
        ]);

        await createUniqueIndexIfNotExists(queryRunner, 'profiles', 'uq_profiles_guest', '`guest_id`');
        await createUniqueIndexIfNotExists(queryRunner, 'profiles', 'uq_profiles_guest', '`guest_id`');

        const createCalls = calls.filter(call => call.sql.includes('CREATE UNIQUE INDEX'));
        expect(createCalls).toHaveLength(1);
    });

    test('dropIndexIfExists drops only when present', async () => {
        const {queryRunner, calls} = createQueryRunnerMock([
            [{count: 1}],
            [],
            [{count: 0}],
        ]);

        await dropIndexIfExists(queryRunner, 'profiles', 'uq_profiles_guest');
        await dropIndexIfExists(queryRunner, 'profiles', 'uq_profiles_guest');

        const dropCalls = calls.filter(call => call.sql.includes('DROP INDEX'));
        expect(dropCalls).toHaveLength(1);
    });

    test('addColumnIfNotExists adds only when missing', async () => {
        const {queryRunner, calls} = createQueryRunnerMock([
            [{count: 0}],
            [],
            [{count: 1}],
        ]);

        await addColumnIfNotExists(queryRunner, 'entity_permissions', 'created_at', 'timestamp(6)', 'NOT NULL DEFAULT CURRENT_TIMESTAMP(6)');
        await addColumnIfNotExists(queryRunner, 'entity_permissions', 'created_at', 'timestamp(6)', 'NOT NULL DEFAULT CURRENT_TIMESTAMP(6)');

        const addCalls = calls.filter(call => call.sql.includes('ADD `created_at`'));
        expect(addCalls).toHaveLength(1);
    });

    test('dropColumnIfExists drops only when present', async () => {
        const {queryRunner, calls} = createQueryRunnerMock([
            [{count: 1}],
            [],
            [{count: 0}],
        ]);

        await dropColumnIfExists(queryRunner, 'entity_permissions', 'updated_at');
        await dropColumnIfExists(queryRunner, 'entity_permissions', 'updated_at');

        const dropCalls = calls.filter(call => call.sql.includes('DROP COLUMN `updated_at`'));
        expect(dropCalls).toHaveLength(1);
    });
});
