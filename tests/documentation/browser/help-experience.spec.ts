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

import {expect, test} from '@playwright/test';

test.describe('in-app help experience', () => {
    test('searches the maintained guides by task', async ({page}) => {
        await page.goto('/help');
        await page.getByRole('searchbox', {name: 'Search the user guides'}).fill('guest recovery');
        await page.getByRole('button', {name: 'Search help'}).click();

        // The topic navigation names the same guide. Require its actual result card
        // and destination so the sidebar cannot satisfy a missing-result assertion.
        const results = page.locator('.help-search-results');
        const guestGuide = results.getByRole('link').filter({
            has: page.getByRole('heading', {name: 'Getting Started with Surveyor', exact: true}),
        });
        await expect(results.getByRole('heading', {name: 'Search results', exact: true})).toBeVisible();
        await expect(guestGuide).toBeVisible();
        await expect(guestGuide).toHaveAttribute('href', '/help/getting_started?locale=en#join-an-invitation-as-a-guest');
    });

    test('renders a document table of contents and maintained visual aid', async ({page}) => {
        await page.goto('/help/surveys');

        // The article's task list repeats this link. Check the separately named
        // table of contents and its anchor, rather than an arbitrary matching link.
        const contents = page.getByRole('navigation', {name: 'On this page', exact: true});
        const votingTask = contents.getByRole('link', {name: 'Vote in a survey', exact: true});
        await expect(contents).toBeVisible();
        await expect(votingTask).toBeVisible();
        await expect(votingTask).toHaveAttribute('href', '#vote-in-a-survey');

        const visualAid = page.getByRole('article').getByRole('img', {
            name: 'Survey controls showing Weekday, Day in month, Add, and the first Monday of every month with Yes, Maybe and No choices.',
            exact: true,
        });
        await expect(visualAid).toBeVisible();
        await expect(visualAid).toHaveAttribute('src', '/help/assets/survey-recurring-pattern.png?locale=en');
    });
});
