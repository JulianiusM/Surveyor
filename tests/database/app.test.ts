// Use the shared SQLite DataSource mock for the whole suite.
jest.mock('../../src/modules/database/dataSource', () => require('../util/db/mariadb-datasource.mock'));

// Mock settings for app initialization
jest.mock('../../src/modules/settings', () => ({
    __esModule: true,
    default: {
        value: {
            appPort: 0,
            file: 'settings.csv',
            dbType: 'mysql',
            dbName: 'surveyor_test',
            dbHost: 'localhost',
            dbPassword: '',
            dbPort: 0,
            dbUser: '',
            rootUrl: 'http://localhost',
            sessionSecret: 'testsecret',
            smtpEmail: 'noreply@example.com',
            smtpHost: 'localhost',
            smtpPort: 2525,
            smtpUser: '',
            smtpPassword: '',
            localLoginEnabled: true,
            oidcEnabled: false,
            oidcName: 'OIDC',
        },
        read: jest.fn().mockResolvedValue(undefined),
        write: jest.fn(),
        update: jest.fn(),
    }
}));

// Runtime stub for JSON import
jest.mock('../../package.json', () => ({version: '0.0.0-test'}), {virtual: true});

import request from 'supertest';
// Import app after mocks & DB init
import app from '../../src/app';

import {AppDataSource, initDataSource} from "../util/db/mariadb-datasource.mock";

// Initialize the in-memory DB once for this suite
beforeAll(async () => {
    await initDataSource();
}, 60_000);

afterAll(async () => {
    if (AppDataSource.isInitialized) await AppDataSource.destroy();
});

describe('App integration (smoke tests)', () => {
    it('GET / returns 200 and contains "Surveyor"', async () => {
        const res = await request(app).get('/').expect(200);
        expect(res.text).toMatch(/Surveyor/i);
    });

    it('GET /nonexistent -> 404 via error handler', async () => {
        await request(app).get('/definitely-not-a-real-route-xyz').expect(404);
    });
});
