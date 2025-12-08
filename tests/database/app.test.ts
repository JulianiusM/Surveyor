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
            invoiceDir: 'uploads/invoices/',
            initialized: true,
            smtpPool: false,
            smtpSecure: false,
            oidcClientId: '',
            oidcClientSecret: '',
            oidcIssuerBaseUrl: '',
            oidcRedirectUrl: '',
            imprintUrl: '',
            privacyPolicyUrl: '',
            activityAvailabilityWeight: 0.30,
            activitySwapOptimizationIterations: 10,
            activityArrivalDeparturePenalty: 0.2,
        },
        read: jest.fn().mockResolvedValue(undefined),
        write: jest.fn(),
        update: jest.fn(),
    }
}));

// Runtime stub for JSON import
jest.mock('../../package.json', () => ({version: '0.0.0-test'}), {virtual: true});

// Import app after mocks & DB init
import app from '../../src/app';

import {AppDataSource, initDataSource} from "../util/db/mariadb-datasource.mock";
import { smokeTestData } from '../data/database/appData';
import { makeRequest, verifyTextMatch } from '../keywords/database/databaseKeywords';

// Initialize the in-memory DB once for this suite
beforeAll(async () => {
    await initDataSource();
}, 60_000);

afterAll(async () => {
    if (AppDataSource.isInitialized) await AppDataSource.destroy();
});

describe('App integration - Data Driven', () => {
    test.each(smokeTestData)('$description', async (testCase) => {
        const response = await makeRequest(
            app,
            testCase.method,
            testCase.path,
            testCase.expectedStatus
        );
        
        if (testCase.expectedTextMatch) {
            verifyTextMatch(response, testCase.expectedTextMatch);
        }
    });
});
