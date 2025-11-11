// e2e/survey.test.ts
// End-to-end tests for survey creation, editing, and management
// Migrated to data-driven and keyword-driven testing approach.

import { expect, test } from '@playwright/test';

// Import test data
import {
    surveyPageAccessData,
    surveyDashboardEmptyStateData,
    surveyCreationData,
    surveyValidationData,
} from '../data/e2e/surveyData';

import { testCredentials } from '../data/e2e/authData';

// Import keywords
import { loginUser } from '../keywords/e2e/authKeywords';
import {
    navigateToEntityCreatePage,
    verifyUnauthenticatedRedirect,
    verifyDashboardEmptyState,
    createSurvey,
    verifyFormFieldRequired,
    generateEntityTitle,
} from '../keywords/e2e/entityKeywords';

test.beforeEach(async ({ context }) => {
    await context.clearCookies();
});

// 1) Page access tests (authenticated and unauthenticated)
for (const data of surveyPageAccessData) {
    test(data.description, async ({ page }) => {
        if (data.isAuthenticated) {
            await loginUser(page, testCredentials.username, testCredentials.password);
            await navigateToEntityCreatePage(page, 'survey', data.expectedUrl, data.expectedHeading);
        } else {
            await verifyUnauthenticatedRedirect(page, data.targetUrl, data.expectedRedirectUrl);
        }
    });
}

// 2) Survey dashboard shows empty state for new user
for (const data of surveyDashboardEmptyStateData) {
    test(data.description, async ({ page }) => {
        await loginUser(page, testCredentials.username, testCredentials.password);
        await verifyDashboardEmptyState(page, data.accordionId, data.buttonText, data.expectedEmptyText);
    });
}

// 3) Can create a new survey with valid data
for (const data of surveyCreationData) {
    test(data.description, async ({ page }) => {
        await loginUser(page, testCredentials.username, testCredentials.password);
        await page.goto('/survey/create', { waitUntil: 'networkidle' });

        // Wait for the page to be fully loaded
        await expect(page).toHaveURL(/\/survey\/create/);
        await expect(page.getByRole('heading', { name: /create.*survey/i })).toBeVisible();

        // Fill in survey details with timestamped title
        const surveyTitle = generateEntityTitle(data.title);
        await createSurvey(page, surveyTitle, data.surveyDescription, data.submitButtonText);

        // Should redirect to dashboard or survey view
        await page.waitForURL((url) => data.expectedRedirectPattern.test(url.pathname));

        // Verify success message or survey appears
        if (data.verifyTitleInPage) {
            await expect(page.locator('h1')).toContainText(surveyTitle);
        }
    });
}

// 4) Survey form validates required fields
for (const data of surveyValidationData) {
    test(data.description, async ({ page }) => {
        await loginUser(page, testCredentials.username, testCredentials.password);
        await page.goto('/survey/create', { waitUntil: 'networkidle' });

        // Wait for the page to be fully loaded
        await expect(page).toHaveURL(/\/survey\/create/);
        await expect(page.getByRole('heading', { name: /create.*survey/i })).toBeVisible();

        // Verify required field
        if (data.expectedRequiredAttribute && data.checkHtml5Validation) {
            await verifyFormFieldRequired(page, data.titleFieldName);
        }
    });
}
