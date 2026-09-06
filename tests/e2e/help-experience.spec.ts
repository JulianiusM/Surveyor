import {expect, test} from '@playwright/test';

// Application navigation only. This test does not fetch a maintained help page.
// Prose, guide images, search examples and corpus completeness are advisory checks.
test('opens contextual help from an account page', async ({page}) => {
    await page.goto('/users/register');
    await expect(page.getByRole('link', {name: 'Help for this page'})).toHaveAttribute('href', '/help/getting_started');
});
