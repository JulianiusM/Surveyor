import {expect, test} from '@playwright/test';
import {waitForFrontendHydration} from '../keywords/frontendDynamicKeywords';

// Application navigation only. This test does not fetch a maintained help page.
// Prose, guide images, search examples and corpus completeness are advisory checks.
test('opens contextual help from an account page', async ({page}) => {
    await page.goto('/users/register?locale=en');
    await waitForFrontendHydration(page);
    const help = page.getByRole('link', {name: 'Help for this page'});
    await expect(help).toBeVisible();
    await expect(help).toHaveAttribute('href', '/help?doc=getting_started&locale=en');
});
