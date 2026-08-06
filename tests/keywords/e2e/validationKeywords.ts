/**
 * Keywords for validation and error handling E2E testing
 * Reusable actions for testing form validation, error messages, and edge cases
 */

import { expect, Page } from '@playwright/test';

/**
 * Submit form with button
 */
export async function submitForm(page: Page, buttonName: string | RegExp): Promise<void> {
    await page.getByRole('button', { name: buttonName }).click();
}

/**
 * Verify field has required attribute
 */
export async function verifyFieldRequired(page: Page, fieldName: string): Promise<void> {
    const input = page.locator(`input[name="${fieldName}"]`);
    const isRequired = await input.getAttribute('required');
    expect(isRequired).not.toBeNull();
}

/**
 * Fill form fields
 */
export async function fillFormFields(
    page: Page,
    fields: Array<{ name: string; value: string }>
): Promise<void> {
    for (const field of fields) {
        await page.locator(`input[name="${field.name}"]`).fill(field.value);
    }
}

/**
 * Verify error message is visible
 */
export async function verifyErrorMessage(
    page: Page,
    selector: string,
    expectedText?: RegExp
): Promise<void> {
    const errorMessage = page.locator(selector).first();
    await expect(errorMessage).toBeAttached();
    
    if (expectedText) {
        await expect(errorMessage).toContainText(expectedText);
    }
}

/**
 * Verify alert is visible
 */
export async function verifyAlertVisible(page: Page, selector: string): Promise<void> {
    await expect(page.locator(selector)).toBeVisible();
}

/**
 * Set browser offline mode
 */
export async function setOfflineMode(page: Page, offline: boolean): Promise<void> {
    await page.context().setOffline(offline);
}

/**
 * Try navigation and ignore errors
 */
export async function tryNavigate(page: Page, url: string): Promise<void> {
    try {
        await page.goto(url);
    } catch {
        // Expected when offline; ignore
    }
}

/**
 * Verify body is attached (page didn't crash)
 */
export async function verifyBodyAttached(page: Page): Promise<void> {
    await expect(page.locator('body')).toBeAttached();
}

/**
 * Monitor console errors
 */
export async function monitorConsoleErrors(
    page: Page,
    filterPatterns: string[]
): Promise<string[]> {
    const consoleErrors: string[] = [];

    page.on('console', (msg) => {
        if (msg.type() === 'error') {
            consoleErrors.push(msg.text());
        }
    });

    return consoleErrors;
}

/**
 * Filter expected console errors
 */
export function filterExpectedErrors(
    errors: string[],
    filterPatterns: string[]
): string[] {
    return errors.filter(
        (err) => !filterPatterns.some((pattern) => err.includes(pattern))
    );
}

/**
 * Verify no unexpected console errors
 */
export function verifyNoUnexpectedErrors(
    errors: string[],
    filterPatterns: string[]
): void {
    const unexpectedErrors = filterExpectedErrors(errors, filterPatterns);
    
    if (unexpectedErrors.length > 0) {
        console.log('Unexpected console errors:', unexpectedErrors);
    }
    
    expect(unexpectedErrors).toHaveLength(0);
}

/**
 * Verify URL matches pattern
 */
export async function verifyUrlMatches(page: Page, pattern: RegExp): Promise<void> {
    await expect(page).toHaveURL(pattern);
}

/**
 * Verify body text matches pattern
 */
export async function verifyBodyTextMatches(page: Page, pattern: RegExp): Promise<void> {
    const body = await page.locator('body').textContent();
    expect(body).toMatch(pattern);
}

/**
 * Navigate to multiple pages and verify they load
 */
export async function navigateToMultiplePages(
    page: Page,
    pages: Array<{ url: string; expectBodyAttached?: boolean; expectButton?: RegExp }>
): Promise<void> {
    for (const pageData of pages) {
        await page.goto(pageData.url);
        
        if (pageData.expectBodyAttached) {
            await expect(page.locator('body')).toBeAttached();
        }
        
        if (pageData.expectButton) {
            await expect(page.getByRole('button', { name: pageData.expectButton })).toBeVisible();
        }
    }
}

/**
 * Verify multiple protected routes redirect
 */
export async function verifyProtectedRoutesRedirect(
    page: Page,
    routes: string[],
    expectedRedirectUrl: RegExp
): Promise<void> {
    for (const route of routes) {
        await page.goto(route);
        await expect(page).toHaveURL(expectedRedirectUrl);
    }
}
