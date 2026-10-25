import {test, expect} from '@playwright/test';
import {createPublicPageCase} from '../factories/publicPageFactory';
import {waitForFrontendHydration} from '../keywords/frontendDynamicKeywords';

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
];

// Canary: groups related smoke checks so a maintainer can understand the protected workflow quickly.
test.describe('public application availability suite', () => {
    for (const pageCase of publicAvailabilityCases) {
        // Canary: protects a high-value production behavior while avoiding private implementation details.
        test(pageCase.description, async ({request, page}) => {
            if (pageCase.textMatch === 'exact') {
                const response = await request.get(pageCase.path);
                expect(response.status()).toBe(pageCase.expectedStatus);
                expect(await response.text()).toBe(pageCase.expectedText);
            } else {
                // Canonical interactive documents begin with a skeleton. Check
                // actual mounted content after the integrated session/read flow.
                const response = await page.goto(pageCase.path + '?locale=en', {waitUntil: 'domcontentloaded'});
                expect(response?.status()).toBe(pageCase.expectedStatus);
                await waitForFrontendHydration(page);
                await expect(page.locator('main')).toContainText(pageCase.expectedText);
            }
        });
    }
});
