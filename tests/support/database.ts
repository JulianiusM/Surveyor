import {AppDataSource, initDataSource} from '../../src/modules/database/dataSource';

/**
 * Initializes the production TypeORM DataSource against the disposable test
 * schema. Rebuilding the schema once per integration suite keeps tests close
 * to production while avoiding mocks and cross-run state.
 */
export async function initializeIntegrationDatabase(): Promise<void> {
    const databaseName = process.env.TEST_DB_NAME ?? '';
    if (!/test/i.test(databaseName)) {
        throw new Error(`Refusing to reset non-test database "${databaseName}"`);
    }

    await initDataSource();
    await AppDataSource.synchronize(true);
}

export async function closeIntegrationDatabase(): Promise<void> {
    if (AppDataSource?.isInitialized) {
        await AppDataSource.destroy();
    }
}
