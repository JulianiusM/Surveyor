// e2e/packing.test.ts
// End-to-end tests for packing list creation and management
// Migrated to data-driven and keyword-driven testing approach.

import { expect, test } from '@playwright/test';

// Import test data
import {
    packingPageAccessData,
    packingDashboardEmptyStateData,
    packingCreationData,
    packingValidationData,
} from '../data/e2e/packingData';

import { testCredentials } from '../data/e2e/authData';

// Import keywords
import { loginUser } from '../keywords/e2e/authKeywords';
import {
    navigateToEntityCreatePage,
    verifyUnauthenticatedRedirect,
    verifyDashboardEmptyState,
    createPackingList,
    verifyFormFieldRequired,
    generateEntityTitle,
} from '../keywords/e2e/entityKeywords';

test.beforeEach(async ({ context }) => {
    await context.clearCookies();
});

// 1) Page access tests (authenticated and unauthenticated)
for (const data of packingPageAccessData) {
    test(data.description, async ({ page }) => {
        if (data.isAuthenticated) {
            await loginUser(page, testCredentials.username, testCredentials.password);
            await navigateToEntityCreatePage(page, 'packing', data.expectedUrl, data.expectedHeading);
        } else {
            await verifyUnauthenticatedRedirect(page, data.targetUrl, data.expectedRedirectUrl);
        }
    });
}


// 2) Packing dashboard shows empty state for new user
for (const data of packingDashboardEmptyStateData) {
    test(data.description, async ({ page }) => {
        await loginUser(page, testCredentials.username, testCredentials.password);
        await verifyDashboardEmptyState(page, data.accordionId, data.buttonText, data.expectedEmptyText);
    });
}

// 3) Can create a new packing list with valid data
for (const data of packingCreationData) {
    test(data.description, async ({ page }) => {
        await loginUser(page, testCredentials.username, testCredentials.password);
        await page.goto('/packing/create');

        // Wait for the page to be fully loaded
        await expect(page).toHaveURL(/\/packing\/create/);
        await expect(page.getByRole('heading', { name: /create.*packing/i })).toBeVisible();

        // Fill in packing list details with timestamped title
        const packingTitle = generateEntityTitle(data.title);
        await createPackingList(page, packingTitle, data.items, data.submitButtonText);

        // Should redirect to dashboard or packing view
        await page.waitForURL((url) => data.expectedRedirectPattern.test(url.pathname));

        // Verify success or packing list appears
        if (data.verifyTitleInPage) {
            await expect(page.locator('h1')).toContainText(packingTitle);
        }
    });
}

// 4) Packing form validates required fields
for (const data of packingValidationData) {
    test(data.description, async ({ page }) => {
        await loginUser(page, testCredentials.username, testCredentials.password);
        await page.goto('/packing/create');

        // Wait for the page to be fully loaded
        await expect(page).toHaveURL(/\/packing\/create/);
        await expect(page.getByRole('heading', { name: /create.*packing/i })).toBeVisible();

        // Verify required field
        if (data.expectedRequiredAttribute && data.checkHtml5Validation) {
            await verifyFormFieldRequired(page, data.titleFieldName);
        }
    });
}
