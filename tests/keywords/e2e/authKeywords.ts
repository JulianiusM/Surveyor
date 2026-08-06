/**
 * Keywords for authentication E2E testing
 * Reusable actions for login, registration, activation, and password management
 */

import { expect, Page } from '@playwright/test';

/**
 * Login helper - performs full login flow with verification
 */
export async function loginUser(
    page: Page,
    username: string,
    password: string,
    options: {
        waitForDashboard?: boolean;
        verifySessionCookie?: boolean;
        addDelay?: number;
    } = {}
): Promise<void> {
    const {
        waitForDashboard = true,
        verifySessionCookie = true,
        addDelay = 1000,
    } = options;

    await page.goto('/users/login');
    await page.locator('input[name="username"]').fill(username);
    await page.locator('input[name="password"]').fill(password);
    await page.getByRole('button', { name: /login/i }).click();

    if (waitForDashboard) {
        await page.waitForURL(/\/users\/dashboard/, { waitUntil: 'networkidle' });
        await expect(page.locator('#userMenu')).toBeVisible();
    }

    if (verifySessionCookie) {
        const cookies = await page.context().cookies();
        const sessionCookie = cookies.find((c) => c.name === 'connect.sid');
        if (!sessionCookie) {
            throw new Error('Session cookie was not set after login');
        }
    }

    if (addDelay > 0) {
        await page.waitForTimeout(addDelay);
    }
}

/**
 * Verify page elements are visible
 */
export async function verifyPageElements(
    page: Page,
    elements: Array<{ type: 'heading' | 'input' | 'button'; value: string | RegExp }>
): Promise<void> {
    for (const element of elements) {
        if (element.type === 'heading') {
            await expect(page.getByRole('heading', { name: element.value })).toBeVisible();
        } else if (element.type === 'input') {
            await expect(page.locator(`input[name="${element.value}"]`)).toBeVisible();
        } else if (element.type === 'button') {
            await expect(page.getByRole('button', { name: element.value })).toBeVisible();
        }
    }
}

/**
 * Fill and submit login form
 */
export async function fillLoginForm(
    page: Page,
    username: string,
    password: string
): Promise<void> {
    await page.locator('input[name="username"]').fill(username);
    await page.locator('input[name="password"]').fill(password);
    await page.getByRole('button', { name: /login/i }).click();
}

/**
 * Generate unique username with timestamp
 */
export function generateUniqueUsername(prefix: string): string {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Register user through UI
 */
export async function registerUserThroughUI(
    page: Page,
    userData: {
        username: string;
        password: string;
        email: string;
        displayname?: string;
    }
): Promise<void> {
    await page.goto('/users/register');
    await page.locator('input[name="username"]').fill(userData.username);
    await page.locator('input[name="displayname"]').fill(userData.displayname ?? userData.username);
    await page.locator('input[name="email"]').fill(userData.email);
    await page.locator('input[name="password"]').fill(userData.password);
    await page.locator('input[name="password_repeat"]').fill(userData.password);
    await page.getByRole('button', { name: /register/i }).click();
    await page.waitForLoadState('networkidle');
}

/**
 * Verify registration success message
 */
export async function verifyRegistrationSuccess(page: Page, expectedMessage: string): Promise<void> {
    await expect(page.getByText(expectedMessage, { exact: false })).toBeVisible();
}

/**
 * Verify error alert is visible
 */
export async function verifyErrorAlert(
    page: Page,
    selector: string = '.alert, .alert-danger, .invalid-feedback'
): Promise<void> {
    const alert = page.locator(selector);
    await expect(alert.first()).toBeAttached();
}

/**
 * Verify validation message has text
 */
export async function verifyValidationMessage(
    page: Page,
    selector: string = '.invalid-feedback, .alert-danger, .alert'
): Promise<void> {
    const msg = page.locator(selector);
    await expect(msg.first()).toBeAttached();
    const feedbackText = await msg.first().textContent();
    expect(feedbackText).toBeTruthy();
    expect(feedbackText!.length).toBeGreaterThan(0);
}

/**
 * Verify field has required attribute
 */
export async function verifyFieldRequired(page: Page, fieldName: string): Promise<void> {
    const input = page.locator(`input[name="${fieldName}"]`);
    await expect(input).toHaveAttribute('required', '');
    const isRequired = await input.evaluate((el: HTMLInputElement) => el.required);
    expect(isRequired).toBe(true);
}

/**
 * Verify URL matches pattern
 */
export async function verifyUrlMatches(page: Page, pattern: RegExp): Promise<void> {
    await expect(page).toHaveURL(pattern);
}

/**
 * Verify heading is visible
 */
export async function verifyHeadingVisible(page: Page, headingText: RegExp): Promise<void> {
    await expect(page.getByRole('heading', { name: headingText })).toBeVisible();
}

/**
 * Clear cookies for test isolation
 */
export async function clearCookies(page: Page): Promise<void> {
    await page.context().clearCookies();
}
