// e2e/drivers.test.ts
// End-to-end tests for drivers list creation and management
// Migrated to data-driven and keyword-driven testing approach.

import { expect, test } from '@playwright/test';

// Import test data
import {
    driversPageAccessData,
    driversDashboardEmptyStateData,
    driversCreationData,
    driversValidationData,
} from '../data/e2e/driversData';

import { testCredentials } from '../data/e2e/authData';

// Import keywords
import { loginUser } from '../keywords/e2e/authKeywords';
import {
    navigateToEntityCreatePage,
    verifyUnauthenticatedRedirect,
    verifyDashboardEmptyState,
    createDriversList,
    verifyFormFieldRequired,
    generateEntityTitle,
} from '../keywords/e2e/entityKeywords';

test.beforeEach(async ({ context }) => {
    await context.clearCookies();
});

// 1) Page access tests (authenticated and unauthenticated)
for (const data of driversPageAccessData) {
    test(data.description, async ({ page }) => {
        if (data.isAuthenticated) {
            await loginUser(page, testCredentials.username, testCredentials.password);
            await navigateToEntityCreatePage(page, 'drivers', data.expectedUrl, data.expectedHeading);
        } else {
            await verifyUnauthenticatedRedirect(page, data.targetUrl, data.expectedRedirectUrl);
        }
    });
}


// 2) Drivers dashboard shows empty state for new user
for (const data of driversDashboardEmptyStateData) {
    test(data.description, async ({ page }) => {
        await loginUser(page, testCredentials.username, testCredentials.password);
        await verifyDashboardEmptyState(page, data.accordionId, data.buttonText, data.expectedEmptyText);
    });
}

// 3) Can create a new drivers list with valid data
for (const data of driversCreationData) {
    test(data.description, async ({ page }) => {
        await loginUser(page, testCredentials.username, testCredentials.password);
        await page.goto('/drivers/create');

        // Wait for the page to be fully loaded
        await expect(page).toHaveURL(/\/drivers\/create/);
        await expect(page.getByRole('heading', { name: /create.*driver/i })).toBeVisible();

        // Fill in drivers list details with timestamped title
        const driversTitle = generateEntityTitle(data.title);
        await createDriversList(page, driversTitle, data.submitButtonText, data.requiresFormSubmit);

        // Should redirect to dashboard or drivers view
        await page.waitForURL((url) => data.expectedRedirectPattern.test(url.pathname));

        // Verify success by checking page heading or content
        if (data.verifyTitleInPage) {
            await expect(page.locator('h1')).toContainText(driversTitle);
        }
    });
}

// 4) Drivers form validates required fields
for (const data of driversValidationData) {
    test(data.description, async ({ page }) => {
        await loginUser(page, testCredentials.username, testCredentials.password);
        await page.goto('/drivers/create');

        // Wait for the page to be fully loaded
        await expect(page).toHaveURL(/\/drivers\/create/);
        await expect(page.getByRole('heading', { name: /create.*driver/i })).toBeVisible();

        // Verify required field
        if (data.expectedRequiredAttribute && data.checkHtml5Validation) {
            await verifyFormFieldRequired(page, data.titleFieldName);
        }
    });
}
