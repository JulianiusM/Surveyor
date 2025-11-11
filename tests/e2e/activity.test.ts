// e2e/activity.test.ts
// End-to-end tests for activity plan creation and management
// Migrated to data-driven and keyword-driven testing approach.

import { expect, test } from '@playwright/test';

// Import test data
import {
    activityPageAccessData,
    activityDashboardEmptyStateData,
    activityCreationData,
    activityValidationData,
} from '../data/e2e/activityData';

import { testCredentials } from '../data/e2e/authData';

// Import keywords
import { loginUser } from '../keywords/e2e/authKeywords';
import {
    navigateToEntityCreatePage,
    verifyUnauthenticatedRedirect,
    verifyDashboardEmptyState,
    createActivityPlan,
    verifyFormFieldRequired,
    generateEntityTitle,
} from '../keywords/e2e/entityKeywords';

test.beforeEach(async ({ context }) => {
    await context.clearCookies();
});

// 1) Page access tests (authenticated and unauthenticated)
for (const data of activityPageAccessData) {
    test(data.description, async ({ page }) => {
        if (data.isAuthenticated) {
            await loginUser(page, testCredentials.username, testCredentials.password);
            await navigateToEntityCreatePage(page, 'activity', data.expectedUrl, data.expectedHeading);
        } else {
            await verifyUnauthenticatedRedirect(page, data.targetUrl, data.expectedRedirectUrl);
        }
    });
}


// 2) Activity dashboard shows empty state for new user
for (const data of activityDashboardEmptyStateData) {
    test(data.description, async ({ page }) => {
        await loginUser(page, testCredentials.username, testCredentials.password);
        await verifyDashboardEmptyState(page, data.accordionId, data.buttonText, data.expectedEmptyText);
    });
}

// 3) Can create a new activity plan with valid data
for (const data of activityCreationData) {
    test(data.description, async ({ page }) => {
        await loginUser(page, testCredentials.username, testCredentials.password);
        await page.goto('/activity/create');

        // Wait for the page to be fully loaded
        await expect(page).toHaveURL(/\/activity\/create/);
        await expect(page.getByRole('heading', { name: /create.*activity/i })).toBeVisible();

        // Fill in activity plan details with timestamped title
        const activityTitle = generateEntityTitle(data.title);
        await createActivityPlan(page, activityTitle, data.startDate, data.endDate, data.slot, data.submitButtonText);

        // Should redirect to dashboard or activity view
        await page.waitForURL((url) => data.expectedRedirectPattern.test(url.pathname));

        // Verify success or activity appears
        if (data.verifyTitleInPage) {
            const body = await page.locator('body').textContent();
            expect(body).toContain(activityTitle);
        }
    });
}

// 4) Activity form validates required fields
for (const data of activityValidationData) {
    test(data.description, async ({ page }) => {
        await loginUser(page, testCredentials.username, testCredentials.password);
        await page.goto('/activity/create');

        // Wait for the page to be fully loaded
        await expect(page).toHaveURL(/\/activity\/create/);
        await expect(page.getByRole('heading', { name: /create.*activity/i })).toBeVisible();

        // Verify required field
        if (data.expectedRequiredAttribute && data.checkHtml5Validation) {
            await verifyFormFieldRequired(page, data.titleFieldName);
        }
    });
}
