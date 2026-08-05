import {test, expect} from '@playwright/test';
import {createPublicPageCase} from '../factories/publicPageFactory';

const publicAvailabilityCases = [
    createPublicPageCase({
        description: 'returns the lightweight application health response',
        path: '/healthz',
        expectedStatus: 200,
        expectedText: 'ok',
        textMatch: 'exact',
    }),
    createPublicPageCase(),
    createPublicPageCase({description: 'redirects the users index toward the dashboard flow', path: '/users', expectedStatus: 200, expectedText: 'Login'}),
    createPublicPageCase({description: 'renders the login page', path: '/users/login', expectedStatus: 200, expectedText: 'Already got a user account?'}),
    createPublicPageCase({description: 'renders the registration page', path: '/users/register', expectedStatus: 200, expectedText: 'Register'}),
    createPublicPageCase({description: 'renders the forgot-password page', path: '/users/forgot-password', expectedStatus: 200, expectedText: 'password'}),
    createPublicPageCase({description: 'renders the help index page', path: '/help', expectedStatus: 200, expectedText: 'Documentation'}),
    createPublicPageCase({description: 'renders the getting-started help page', path: '/help/getting_started', expectedStatus: 200, expectedText: 'Getting Started'}),
    createPublicPageCase({description: 'renders the dashboard help page', path: '/help/dashboard', expectedStatus: 200, expectedText: 'Dashboard'}),
    createPublicPageCase({description: 'renders the surveys help page', path: '/help/surveys', expectedStatus: 200, expectedText: 'Surveys'}),
    createPublicPageCase({description: 'renders the events help page', path: '/help/events', expectedStatus: 200, expectedText: 'Events'}),
    createPublicPageCase({description: 'renders the packing lists help page', path: '/help/packing_lists', expectedStatus: 200, expectedText: 'Packing'}),
    createPublicPageCase({description: 'renders the activity plans help page', path: '/help/activity_plans', expectedStatus: 200, expectedText: 'Activity'}),
    createPublicPageCase({description: 'renders the drivers lists help page', path: '/help/drivers_lists', expectedStatus: 200, expectedText: 'Drivers'}),
    createPublicPageCase({description: 'renders the permissions help page', path: '/help/permissions', expectedStatus: 200, expectedText: 'Permissions'}),
];

// Canary: groups related smoke checks so a maintainer can understand the protected workflow quickly.
test.describe('public application availability suite', () => {
    for (const pageCase of publicAvailabilityCases) {
        // Canary: protects a high-value production behavior while avoiding private implementation details.
        test(pageCase.description, async ({request}) => {
            const response = await request.get(pageCase.path);
            const body = await response.text();

            expect(response.status()).toBe(pageCase.expectedStatus);
            if (pageCase.textMatch === 'exact') {
                expect(body).toBe(pageCase.expectedText);
            } else {
                expect(body).toContain(pageCase.expectedText);
            }
        });
    }
});
