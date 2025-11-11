// e2e/auth.test.ts
// End-to-end tests for the local username/password authentication flow.
// Migrated to data-driven and keyword-driven testing approach.

import { expect, test } from '@playwright/test';

// Import test data
import {
    testCredentials,
    loginFailureData,
    loginSuccessData,
    logoutData,
    registrationFlowData,
    passwordResetFlowData,
    oidcButtonVisibilityData,
    duplicateUsernameData,
    weakPasswordData,
    invalidActivationTokenData,
    activationTokenReuseData,
    expiredResetTokenData,
    resetTokenReuseData,
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
test('renders login form', async ({ page }) => {
    await page.goto('/users/login');

    // Verify all expected elements using data
    await verifyPageElements(page, [
        { type: 'heading', value: /login/i },
        { type: 'input', value: 'username' },
        { type: 'input', value: 'password' },
        { type: 'button', value: /login/i },
    ]);
});

// 3) Failed login attempt tests
for (const data of loginFailureData) {
    test(data.description, async ({ page }) => {
        await page.goto('/users/login');
        await fillLoginForm(page, data.username, data.password);
        await verifyUrlMatches(page, data.expectedUrl);

        if (data.expectedAlert) {
            await verifyErrorAlert(page);
        }
    });
}

// 4) Successful login tests
for (const data of loginSuccessData) {
    test(data.description, async ({ page }) => {
        await loginUser(page, data.username, data.password);
        await verifyUrlMatches(page, data.expectedUrl);
        await verifyHeadingVisible(page, data.expectedHeading);
    });
}

// 5) Logout tests
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
        await expect(page.getByText('Your account has been activated', { exact: false })).toBeVisible();

        // Now log in with the freshly activated account
        await page.goto('/users/login');
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
        await expect(page.getByText('Your account has been activated', { exact: false })).toBeVisible();

        // Trigger forgot-password by username
        await page.goto(data.forgotPasswordUrl);
        await page.locator('input[name="username"]').fill(username);
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
        await page.goto('/users/login');
        await fillLoginForm(page, username, data.newPassword);
        await expect(page).toHaveURL(/\/users\/dashboard/);
    });
}

// 8) OIDC button visibility test
for (const data of oidcButtonVisibilityData) {
    test(data.description, async ({ page }) => {
        await page.goto('/users/login');
        const oidcBtn = page.getByRole('link', { name: data.buttonName });
        if (data.shouldBeVisible) {
            await expect(oidcBtn).toBeVisible();
        } else {
            await verifyNotVisible(page, 'a[href*="openid"]');
        }
    });
}

// ==============================================
// Negative-path tests: duplicate usernames, weak passwords,
// invalid/expired tokens, and reused tokens
// ==============================================

// 9) Duplicate username test
for (const data of duplicateUsernameData) {
    test(data.description, async ({ page }) => {
        const username = generateUniqueUsername(data.usernamePrefix);
        const email1 = `${username}@example.test`;
        const email2 = `${username}+2@example.test`;

        // First registration succeeds
        await registerUserThroughUI(page, { username, password: data.password, email: email1 });

        // Try again with same username
        await page.goto('/users/register');
        await page.locator('input[name="username"]').fill(username);
        await page.locator('input[name="displayname"]').fill(username);
        await page.locator('input[name="email"]').fill(email2);
        await page.locator('input[name="password"]').fill(data.password);
        await page.locator('input[name="password_repeat"]').fill(data.password);
        await page.getByRole('button', { name: /register/i }).click();

        await verifyUrlMatches(page, data.expectedUrl);
        if (data.expectErrorAlert) {
            await verifyErrorAlert(page);
        }
    });
}

// 10) Weak password test
for (const data of weakPasswordData) {
    test(data.description, async ({ page }) => {
        const username = generateUniqueUsername(data.usernamePrefix);

        await page.goto('/users/register');
        await page.locator('input[name="username"]').fill(username);
        await page.locator('input[name="displayname"]').fill(username);
        await page.locator('input[name="email"]').fill(`${username}@example.test`);
        await page.locator('input[name="password"]').fill(data.weakPassword);
        await page.locator('input[name="password_repeat"]').fill(data.weakPassword);
        await page.getByRole('button', { name: /register/i }).click();

        await verifyUrlMatches(page, data.expectedUrl);
        if (data.expectValidationMessage) {
            await verifyValidationMessage(page);
        }
    });
}

// 11) Invalid activation token test
for (const data of invalidActivationTokenData) {
    test(data.description, async ({ page }) => {
        await page.goto(`/users/activate/${data.token}`);
        if (data.expectErrorAlert) {
            await verifyErrorAlert(page, '.alert, .alert-danger, [role="alert"]');
        }
    });
}

// 12) Activation token reuse test
for (const data of activationTokenReuseData) {
    test(data.description, async ({ page }) => {
        const username = generateUniqueUsername(data.usernamePrefix);
        const email = `${username}@example.test`;

        await registerUserThroughUI(page, { username, password: data.password, email });
        const token = await getActivationToken(username);
        expect(token).toBeTruthy();

        // First activation works
        await page.goto(`/users/activate/${token}`);
        if (data.expectFirstActivationSuccess) {
            await expect(page.locator('.alert, .alert-success')).toBeVisible();
        }

        // Second attempt should fail
        await page.goto(`/users/activate/${token}`);
        if (data.expectSecondActivationError) {
            await verifyErrorAlert(page, '.alert, .alert-danger, [role="alert"]');
        }
    });
}

// 13) Expired reset token test
for (const data of expiredResetTokenData) {
    test(data.description, async ({ page }) => {
        const username = generateUniqueUsername(data.usernamePrefix);
        const email = `${username}@example.test`;

        await registerUserThroughUI(page, { username, password: data.password, email });

        // Activate
        const activationToken = await getActivationToken(username);
        expect(activationToken).toBeTruthy();
        await page.goto(`/users/activate/${activationToken}`);
        await expect(page.locator('.alert, .alert-success')).toBeVisible();

        // Request reset
        await page.goto('/users/forgot-password');
        await page.locator('input[name="username"]').fill(username);
        await page.getByRole('button', { name: /send reset link/i }).click();
        await expect(page.locator('.alert, .alert-success')).toBeVisible();

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
            await verifyErrorAlert(page, '.alert, .alert-danger, [role="alert"]');
        }
    });
}

// 14) Reset token reuse test
for (const data of resetTokenReuseData) {
    test(data.description, async ({ page }) => {
        const username = generateUniqueUsername(data.usernamePrefix);
        const email = `${username}@example.test`;

        await registerUserThroughUI(page, { username, password: data.oldPassword, email });

        // Activate
        const activationToken = await getActivationToken(username);
        expect(activationToken).toBeTruthy();
        await page.goto(`/users/activate/${activationToken}`);
        await expect(page.locator('.alert, .alert-success')).toBeVisible();

        // Request reset
        await page.goto('/users/forgot-password');
        await page.locator('input[name="username"]').fill(username);
        await page.getByRole('button', { name: /send reset link/i }).click();
        await expect(page.locator('.alert, .alert-success')).toBeVisible();

        const token = await getResetToken(username);
        expect(token).toBeTruthy();

        // First use succeeds
        let res = await page.request.post(`/users/reset-password/${token}`, {
            form: { password: data.newPassword, confirmPassword: data.newPassword },
        });
        if (data.expectFirstResetSuccess) {
            expect(res.ok()).toBeTruthy();
        }

        // Second use fails
        res = await page.request.post(`/users/reset-password/${token}`, {
            form: { password: data.secondPassword, confirmPassword: data.secondPassword },
        });
        if (data.expectSecondResetFailure) {
            expect(res.ok(), 'Reusing token should not be OK').toBeFalsy();
        }
    });
}
