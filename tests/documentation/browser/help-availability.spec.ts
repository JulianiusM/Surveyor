/*
 * Copyright 2026 Julian Malovanij
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {test, expect} from '@playwright/test';
import {createPublicPageCase} from '../../factories/publicPageFactory';

const helpAvailabilityCases = [
    createPublicPageCase({description: 'renders the help index page', path: '/help', expectedStatus: 200, expectedText: 'Documentation'}),
    createPublicPageCase({description: 'renders the getting-started help page', path: '/help/getting_started', expectedStatus: 200, expectedText: 'Getting Started'}),
    createPublicPageCase({description: 'renders the overview help page', path: '/help/dashboard', expectedStatus: 200, expectedText: 'Your Overview'}),
    createPublicPageCase({description: 'renders the surveys help page', path: '/help/surveys', expectedStatus: 200, expectedText: 'Surveys'}),
    createPublicPageCase({description: 'renders the events help page', path: '/help/events', expectedStatus: 200, expectedText: 'Events'}),
    createPublicPageCase({description: 'renders the invoice-pool help page', path: '/help/invoice_pools', expectedStatus: 200, expectedText: 'Invoice Pools'}),
    createPublicPageCase({description: 'renders the packing lists help page', path: '/help/packing_lists', expectedStatus: 200, expectedText: 'Packing'}),
    createPublicPageCase({description: 'renders the activity plans help page', path: '/help/activity_plans', expectedStatus: 200, expectedText: 'Activity'}),
    createPublicPageCase({description: 'renders the drivers lists help page', path: '/help/drivers_lists', expectedStatus: 200, expectedText: 'Drivers'}),
    createPublicPageCase({description: 'renders the permissions help page', path: '/help/permissions', expectedStatus: 200, expectedText: 'Permissions'}),
    createPublicPageCase({description: 'renders help search results', path: '/help/search?q=guest%20recovery', expectedStatus: 200, expectedText: 'Search results'}),
];

// Canary: groups related smoke checks so a maintainer can understand the protected workflow quickly.
test.describe('maintained help availability (advisory)', () => {
    for (const pageCase of helpAvailabilityCases) {
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
