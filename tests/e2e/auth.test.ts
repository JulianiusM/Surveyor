// e2e/auth.test.ts
// End-to-end tests for the local username/password authentication flow.
// Migrated to data-driven and keyword-driven testing approach.

import { expect, test } from '@playwright/test';

// Import test data
import {
    testCredentials,
    authUrls,
    formFields,
    successMessages,
    selectors,
    loginPageRenderData,
    loginData,
    logoutData,
    registrationFlowData,
    passwordResetFlowData,
    oidcButtonData,
    registrationData,
    activationTokenData,
    tokenReuseData,
    resetTokenData,
    unauthenticatedRedirectData,
} from '../data/e2e/authData';

// Import keywords
import {
    loginUser,
    verifyPageElements,
    fillLoginForm,
    generateUniqueUsername,
    registerUserThroughUI,
    verifyErrorAlert,
    verifyValidationMessage,
    verifyUrlMatches,
    verifyHeadingVisible,
} from '../keywords/e2e/authKeywords';

import {
    getActivationToken,
    getResetToken,
    expireResetToken,
} from '../keywords/e2e/dbKeywords';

import {
    verifyNotVisible,
} from '../keywords/e2e/navigationKeywords';

// Before each test, start from a clean browser state (no cookies).
test.beforeEach(async ({ context }) => {
    await context.clearCookies();
});

// 1) Unauthenticated redirect test
for (const data of unauthenticatedRedirectData) {
    test(data.description, async ({ page }) => {
        await page.goto(data.protectedUrl);
        await verifyUrlMatches(page, data.expectedRedirectUrl);
        await verifyHeadingVisible(page, data.expectedHeading);
    });
}

// 2) Login page rendering test
test(loginPageRenderData.description, async ({ page }) => {
    await page.goto(loginPageRenderData.url);
    await verifyPageElements(page, loginPageRenderData.elements);
});

// 3) Login tests (both success and failure)
for (const data of loginData) {
    test(data.description, async ({ page }) => {
        await page.goto(data.url);
        await fillLoginForm(page, data.username, data.password);
        await verifyUrlMatches(page, data.expectedUrl);

        if (data.shouldSucceed) {
            if (data.expectedHeading) {
                await verifyHeadingVisible(page, data.expectedHeading);
            }
        } else {
            if (data.expectedAlert) {
                await verifyErrorAlert(page);
            }
        }
    });
}

// 4) Logout tests
for (const data of logoutData) {
    test(data.description, async ({ page }) => {
        await loginUser(page, testCredentials.username, testCredentials.password);
        await expect(page).toHaveURL(/\/users\/dashboard/);

        // Navigate to logout URL
        await page.goto(data.logoutUrl);

        // After logout, check we're redirected or can't access protected pages
        await page.goto(data.dashboardUrl);
        await verifyUrlMatches(page, data.expectedRedirectUrl);
    });
}

// ==============================================
// Registration, Activation, and Password Reset Tests
// ==============================================

// 6) Registration flow test
for (const data of registrationFlowData) {
    test(data.description, async ({ page }) => {
        const username = generateUniqueUsername(data.usernamePrefix);
        const email = `${username}@example.test`;

        await registerUserThroughUI(page, { username, password: data.password, email });

        // Activate the account
        const token = await getActivationToken(username);
        expect(token, 'Activation token should exist in DB').toBeTruthy();
        await page.goto(`/users/activate/${token}`);
        await expect(page.getByText(data.activationMessage, { exact: false })).toBeVisible();

        // Now log in with the freshly activated account
        await page.goto(data.loginUrl);
        await fillLoginForm(page, username, data.password);
        await verifyUrlMatches(page, data.expectedDashboardUrl);
        await verifyHeadingVisible(page, data.expectedHeading);
    });
}

// 7) Password reset flow test
for (const data of passwordResetFlowData) {
    test(data.description, async ({ page }) => {
        // Prepare: create & activate a dedicated user
        const username = generateUniqueUsername(data.usernamePrefix);
        const email = `${username}@example.test`;

        await registerUserThroughUI(page, { username, password: data.oldPassword, email });

        // Activate
        const activationToken = await getActivationToken(username);
        expect(activationToken, 'Activation token should exist').toBeTruthy();
        await page.goto(`/users/activate/${activationToken}`);
        await expect(page.getByText(data.activationMessage, { exact: false })).toBeVisible();

        // Trigger forgot-password by username
        await page.goto(data.forgotPasswordUrl);
        await page.locator(`input[name="${formFields.username}"]`).fill(username);
        await page.getByRole('button', { name: /send reset link/i }).click();
        await expect(page.getByText(data.resetLinkSentMessage, { exact: false })).toBeVisible();

        // Fetch reset token from DB and open the reset page
        const token = await getResetToken(username);
        expect(token, 'Reset token should exist in DB').toBeTruthy();
        await page.goto(`/users/reset-password/${token}`);
        await verifyHeadingVisible(page, data.resetPageHeading);

        // Reset password via API
        const res = await page.request.post(`/users/reset-password/${token}`, {
            form: { password: data.newPassword, confirmPassword: data.newPassword },
        });
        expect(res.ok()).toBeTruthy();

        // Log in with the new password
        await page.goto(data.loginUrl);
        await fillLoginForm(page, username, data.newPassword);
        await expect(page).toHaveURL(data.dashboardUrl);
    });
}

// 8) OIDC button visibility test
for (const data of oidcButtonData) {
    test(data.description, async ({ page }) => {
        await page.goto(data.loginUrl);
        const oidcBtn = page.getByRole('link', { name: data.buttonName });
        if (data.shouldBeVisible) {
            await expect(oidcBtn).toBeVisible();
        } else {
            await verifyNotVisible(page, data.oidcSelector);
        }
    });
}

// ==============================================
// Negative-path tests: registration errors, invalid/expired tokens, and reused tokens
// ==============================================

// 9) Registration tests (success and validation errors)
for (const data of registrationData) {
    test(data.description, async ({ page }) => {
        const username = generateUniqueUsername(data.usernamePrefix);
        const email = data.useEmailFromUsername ? `${username}@example.test` : `${username}+2@example.test`;

        if (data.shouldSucceed) {
            // Success case - just register
            await registerUserThroughUI(page, { username, password: data.password, email });
        } else if (data.errorType === 'duplicate') {
            // Duplicate username - register twice with same username
            const email1 = `${username}@example.test`;
            await registerUserThroughUI(page, { username, password: data.password, email: email1 });
            
            // Try again with same username
            await page.goto(data.registerUrl);
            await page.locator(`input[name="${data.formFields.username}"]`).fill(username);
            await page.locator(`input[name="${data.formFields.displayname}"]`).fill(username);
            await page.locator(`input[name="${data.formFields.email}"]`).fill(`${username}+2@example.test`);
            await page.locator(`input[name="${data.formFields.password}"]`).fill(data.password);
            await page.locator(`input[name="${data.formFields.passwordRepeat}"]`).fill(data.password);
            await page.getByRole('button', { name: /register/i }).click();

            await verifyUrlMatches(page, data.expectedUrl);
            if (data.expectErrorAlert) {
                await verifyErrorAlert(page);
            }
        } else if (data.errorType === 'weakPassword') {
            // Weak password case
            await page.goto(data.registerUrl);
            await page.locator(`input[name="${data.formFields.username}"]`).fill(username);
            await page.locator(`input[name="${data.formFields.displayname}"]`).fill(username);
            await page.locator(`input[name="${data.formFields.email}"]`).fill(email);
            await page.locator(`input[name="${data.formFields.password}"]`).fill(data.password);
            await page.locator(`input[name="${data.formFields.passwordRepeat}"]`).fill(data.password);
            await page.getByRole('button', { name: /register/i }).click();

            await verifyUrlMatches(page, data.expectedUrl);
            if (data.expectValidationMessage) {
                await verifyValidationMessage(page);
            }
        }
    });
}

// 10) Activation token tests (valid and invalid)
for (const data of activationTokenData) {
    test(data.description, async ({ page }) => {
        await page.goto(`/users/activate/${data.token}`);
        if (!data.isValid && data.expectErrorAlert) {
            await verifyErrorAlert(page, data.errorSelector);
        }
    });
}

// 11) Token reuse tests (activation and reset)
for (const data of tokenReuseData) {
    test(data.description, async ({ page }) => {
        const username = generateUniqueUsername(data.usernamePrefix);
        const email = `${username}@example.test`;

        if (data.tokenType === 'activation') {
            await registerUserThroughUI(page, { username, password: data.password, email });
            const token = await getActivationToken(username);
            expect(token).toBeTruthy();

            // First activation works
            await page.goto(`/users/activate/${token}`);
            if (data.expectFirstUseSuccess) {
                await expect(page.locator(data.successSelector)).toBeVisible();
            }

            // Second attempt should fail
            await page.goto(`/users/activate/${token}`);
            if (data.expectSecondUseError) {
                await verifyErrorAlert(page, data.errorSelector);
            }
        } else if (data.tokenType === 'reset') {
            await registerUserThroughUI(page, { username, password: data.oldPassword, email });

            // Activate
            const activationToken = await getActivationToken(username);
            expect(activationToken).toBeTruthy();
            await page.goto(`/users/activate/${activationToken}`);
            await expect(page.locator(data.successSelector)).toBeVisible();

            // Request reset
            await page.goto(data.forgotPasswordUrl);
            await page.locator('input[name="username"]').fill(username);
            await page.getByRole('button', { name: /send reset link/i }).click();
            await expect(page.locator(data.successSelector)).toBeVisible();

            const token = await getResetToken(username);
            expect(token).toBeTruthy();

            // First use succeeds
            let res = await page.request.post(`/users/reset-password/${token}`, {
                form: { password: data.newPassword, confirmPassword: data.newPassword },
            });
            if (data.expectFirstUseSuccess) {
                expect(res.ok()).toBeTruthy();
            }

            // Second use fails
            res = await page.request.post(`/users/reset-password/${token}`, {
                form: { password: data.secondPassword, confirmPassword: data.secondPassword },
            });
            if (data.expectSecondUseError) {
                expect(res.ok(), 'Reusing token should not be OK').toBeFalsy();
            }
        }
    });
}

// 12) Reset token expiry test
for (const data of resetTokenData) {
    test(data.description, async ({ page }) => {
        const username = generateUniqueUsername(data.usernamePrefix);
        const email = `${username}@example.test`;

        await registerUserThroughUI(page, { username, password: data.password, email });

        // Activate
        const activationToken = await getActivationToken(username);
        expect(activationToken).toBeTruthy();
        await page.goto(`/users/activate/${activationToken}`);
        await expect(page.locator(data.successSelector)).toBeVisible();

        // Request reset
        await page.goto(data.forgotPasswordUrl);
        await page.locator('input[name="username"]').fill(username);
        await page.getByRole('button', { name: /send reset link/i }).click();
        await expect(page.locator(data.successSelector)).toBeVisible();

        const token = await getResetToken(username);
        expect(token).toBeTruthy();

        // Mark token expired in DB if possible
        const expired = await expireResetToken(username);
        if (!expired && data.skipIfNoExpiryColumn) {
            test.fixme(true, 'Schema has no reset token expiry column; cannot simulate expiry.');
            return;
        }

        await page.goto(`/users/reset-password/${token}`);
        if (data.expectErrorAlert) {
            await verifyErrorAlert(page, data.errorSelector);
        }
    });
}
