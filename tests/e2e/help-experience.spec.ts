import {expect, test} from '@playwright/test';

test.describe('in-app help experience', () => {
    test('searches the maintained guides by task', async ({page}) => {
        await page.goto('/help');
        await page.getByRole('searchbox', {name: 'Search the user guides'}).fill('guest recovery');
        await page.getByRole('button', {name: 'Search help'}).click();

        await expect(page.getByRole('heading', {name: 'Search results'})).toBeVisible();
        await expect(page.getByRole('link', {name: 'Getting Started with Surveyor'})).toBeVisible();
    });

    test('renders a document table of contents and maintained visual aid', async ({page}) => {
        await page.goto('/help/surveys');

        await expect(page.getByRole('navigation', {name: 'On this page'})).toBeVisible();
        await expect(page.getByRole('link', {name: 'Vote in a survey'})).toBeVisible();
        await expect(page.getByRole('img', {name: /recurring first-Monday result/iu})).toBeVisible();
    });

    test('opens contextual help from an account page', async ({page}) => {
        await page.goto('/users/register');
        await expect(page.getByRole('link', {name: 'Help for this page'})).toHaveAttribute('href', '/help/getting_started');
    });
});
