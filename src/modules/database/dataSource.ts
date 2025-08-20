import {DataSource} from 'typeorm';
import settings from '../settings';

export let AppDataSource: DataSource;
let initialized: boolean = false;

export async function initDataSource() {
    if (initialized) {
        return;
    }

    if (!settings.initialized) {
        await settings.readSettingsFile();
    }

    AppDataSource = new DataSource({
        type: 'mysql',
        host: settings.mysqlHost,
        port: settings.mysqlPort,
        username: settings.mysqlUser,
        password: settings.mysqlPassword,
        database: settings.mysqlDatabase,
        timezone: 'Z',              // treat TIMESTAMP / DATETIME as UTC
        dateStrings: ['DATE'],       // A & B: return DATE as **string**
        entities: ['src/modules/database/entities/**/*.ts'],
        migrations: ['src/migrations/*.ts'],
        subscribers: ['src/modules/database/subscribers/**/*.ts'],
        synchronize: false,
    });

    await AppDataSource.initialize();
    initialized = true;
}