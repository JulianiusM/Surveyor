// e2e/error-handling.test.ts
// Frontend error handling and validation tests
// Migrated to data-driven and keyword-driven testing approach.

import { expect, test } from '@playwright/test';

// Import test data
import {
    notFoundErrorData,
    formValidationData,
    invalidTokenData,
    routeAccessData,
    networkErrorData,
    serverErrorData,
    pageFunctionalityData,
    consoleErrorData,
    entityFormValidationData,
    nonExistentResourceData,
    protectedRoutesData,
} from '../data/e2e/errorHandlingData';

import { testCredentials } from '../data/e2e/authData';

// Import keywords
import { loginUser, generateUniqueUsername } from '../keywords/e2e/authKeywords';
import {
    submitForm,
    verifyFieldRequired,
    fillFormFields,
    verifyErrorMessage,
    verifyAlertVisible,
    setOfflineMode,
    tryNavigate,
    verifyBodyAttached,
    monitorConsoleErrors,
    verifyNoUnexpectedErrors,
    verifyUrlMatches,
    verifyBodyTextMatches,
    navigateToMultiplePages,
    verifyProtectedRoutesRedirect,
} from '../keywords/e2e/validationKeywords';

import { verifyBodyContainsText } from '../keywords/e2e/navigationKeywords';

test.beforeEach(async ({ context }) => {
    await context.clearCookies();
});

// 1) Shows 404 error page for non-existent routes
for (const data of notFoundErrorData) {
    test(data.description, async ({ page }) => {
        await page.goto(data.url);
        await verifyBodyContainsText(page, data.expectedBodyText);
    });
}

// 2) Form validation tests (login and registration)
for (const data of formValidationData) {
    test(data.description, async ({ page }) => {
        await page.goto(data.url);
        
        if (data.formType === 'login') {
            await submitForm(page, data.submitButton);
            if (data.expectedRequiredAttribute) {
                await verifyFieldRequired(page, data.fieldToCheck);
            }
        } else if (data.formType === 'registration') {
            const username = generateUniqueUsername(data.usernamePrefix);
            await fillFormFields(page, [
                { name: 'username', value: username },
                { name: 'displayname', value: username },
                { name: 'email', value: `${username}@test.com` },
                { name: 'password', value: data.password },
                { name: 'password_repeat', value: data.passwordRepeat },
            ]);
            
            await submitForm(page, data.submitButton);
            await verifyErrorMessage(page, '.invalid-feedback, .alert-danger, .alert', data.expectedErrorText);
        }
    });
}

// 3) Shows error for invalid tokens
for (const data of invalidTokenData) {
    test(data.description, async ({ page }) => {
        await page.goto(data.url);
        await verifyAlertVisible(page, data.expectedAlertSelector);
    });
}

// 4) Route access control tests (authorized and unauthorized)
for (const data of routeAccessData) {
    test(data.description, async ({ page }) => {
        if (!data.isAuthenticated) {
            await page.goto(data.url);
            await verifyUrlMatches(page, data.expectedRedirectUrl);
        }
    });
}

// 5) Handles network errors gracefully
for (const data of networkErrorData) {
    test(data.description, async ({ page }) => {
        await loginUser(page, testCredentials.username, testCredentials.password);
        
        if (data.setOffline) {
            await setOfflineMode(page, true);
        }
        
        // Try to navigate; ignore navigation failure while offline
        await tryNavigate(page, data.targetUrl);
        
        // Page should handle the error - at minimum, it shouldn't crash
        if (data.expectBodyAttached) {
            await verifyBodyAttached(page);
        }
        
        // Restore online mode
        if (data.setOffline) {
            await setOfflineMode(page, false);
        }
    });
}

// 6) Handles server errors during login
for (const data of serverErrorData) {
    test(data.description, async ({ page }) => {
        await page.goto(data.url);
        await fillFormFields(page, [
            { name: 'username', value: data.username },
            { name: 'password', value: data.password },
        ]);
        await submitForm(page, data.submitButton);
        
        await verifyUrlMatches(page, data.expectedUrl);
        await expect(page.locator(data.expectedAlertSelector)).toBeAttached();
    });
}

// 7) Page remains functional after navigation
for (const data of pageFunctionalityData) {
    test(data.description, async ({ page }) => {
        await navigateToMultiplePages(page, data.pages);
    });
}

// 8) No critical console errors on main pages
for (const data of consoleErrorData) {
    test(data.description, async ({ page }) => {
        const consoleErrors = await monitorConsoleErrors(page, data.filterErrors);
        
        // Check key pages
        for (const pageUrl of data.pages) {
            await page.goto(pageUrl);
        }
        
        // Verify no unexpected errors
        verifyNoUnexpectedErrors(consoleErrors, data.filterErrors);
    });
}

// 9) Survey form shows validation errors for empty required fields
for (const data of entityFormValidationData) {
    test(data.description, async ({ page }) => {
        await loginUser(page, testCredentials.username, testCredentials.password);
        await page.goto(data.url);
        
        await expect(page).toHaveURL(data.url);
        await expect(page.getByRole('heading', { name: data.expectedHeading })).toBeVisible();
        
        if (data.expectedRequiredAttribute) {
            await verifyFieldRequired(page, data.titleField);
        }
    });
}

// 10) Shows error for accessing non-existent survey
for (const data of nonExistentResourceData) {
    test(data.description, async ({ page }) => {
        await loginUser(page, testCredentials.username, testCredentials.password);
        await page.goto(data.url);
        await verifyBodyTextMatches(page, data.expectedBodyText);
    });
}

// 11) All protected routes redirect unauthenticated users
for (const data of protectedRoutesData) {
    test(data.description, async ({ page }) => {
        await verifyProtectedRoutesRedirect(page, data.routes, data.expectedRedirectUrl);
    });
}
