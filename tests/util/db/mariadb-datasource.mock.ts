import {DataSource} from 'typeorm';

const env = (k: string, d?: string) => process.env[k] ?? d ?? '';

const host = env('TEST_DB_HOST', '127.0.0.1');
const port = Number(env('TEST_DB_PORT', '3306'));
const user = env('TEST_DB_USER', 'root');
const password = env('TEST_DB_PASSWORD', 'password');
const database = env('TEST_DB_NAME', 'surveyor_test');
const logging = env('TEST_DB_LOGGING', 'false') === 'true';

export const AppDataSource = new DataSource({
    type: 'mariadb',
    host,
    port,
    username: user,
    password,
    database,
    logging,
    timezone: 'Z' as any,
    // @ts-ignore common driver option
    dateStrings: ['DATE'],
    entities: ['src/modules/database/entities/**/*.ts'],
    migrations: ['src/migrations/*.ts'],
    subscribers: ['src/modules/database/subscribers/**/*.ts'],
    synchronize: false,
});

export async function initDataSource() {
    if (!AppDataSource.isInitialized) {
        await AppDataSource.initialize();
        try {
            await AppDataSource.runMigrations();
        } catch (err) {
            console.warn('[tests] runMigrations failed on MariaDB, falling back to synchronize:', (err as any)?.message || err);
            await AppDataSource.synchronize(true);
            await AppDataSource.runMigrations();
        }
    }
}
