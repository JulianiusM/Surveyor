// Mock the database for controller tests (help controller doesn't use DB but app.ts requires it)
jest.mock('../../src/modules/database/dataSource', () => ({
    AppDataSource: {
        getRepository: jest.fn().mockReturnValue({}),
        isInitialized: false,
        initialize: jest.fn(),
    },
}));

// Mock settings for app initialization
jest.mock('../../src/modules/settings', () => ({
    __esModule: true,
    default: {
        value: {
            appPort: 0,
            sessionSecret: 'testsecret',
            rootUrl: 'http://localhost',
            localLoginEnabled: true,
            oidcEnabled: false,
            oidcName: 'OIDC',
            imprintUrl: '',
            privacyPolicyUrl: '',
            invoiceDir: 'uploads/invoices/',
        },
    }
}));

import request from 'supertest';
import app from '../../src/app';
import {helpIndexData, helpDocData} from '../data/controller/helpData';

describe('Help Controller', () => {
    describe('GET /help', () => {
        test.each(helpIndexData)('$description', async ({expectedDocsCount}) => {
            const response = await request(app).get('/help');
            
            expect(response.status).toBe(200);
            expect(response.text).toContain('Help');
            // Check that sidebar has docs listed
            expect(response.text).toContain('Getting Started');
        });
    });

    describe('GET /help/:docName', () => {
        test.each(helpDocData)(
            '$description',
            async ({docName, expectedTitle, expectedStatus}) => {
                const response = await request(app).get(`/help/${docName}`);
                
                expect(response.status).toBe(expectedStatus);
                
                if (expectedStatus === 200) {
                    expect(response.text).toContain(expectedTitle);
                } else if (expectedStatus === 404) {
                    // Check that we got an error page
                    expect(response.text).toContain('Error');
                }
            }
        );
    });

    describe('Security', () => {
        it('should prevent path traversal attacks', async () => {
            const response = await request(app).get('/help/../../../package');
            expect(response.status).toBe(404);
        });

        it('should only serve markdown files', async () => {
            const response = await request(app).get('/help/../../package.json');
            expect(response.status).toBe(404);
        });
    });
});
