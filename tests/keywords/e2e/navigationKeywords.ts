/**
 * Keywords for navigation E2E testing
 * Reusable actions for page navigation, UI elements, and accessibility
 */

import { expect, Page } from '@playwright/test';

/**
 * Navigate to URL and verify it loaded
 */
export async function navigateAndVerify(page: Page, url: string): Promise<void> {
    await page.goto(url);
    await expect(page.locator('body')).toBeAttached();
}

/**
 * Verify link is visible
 */
export async function verifyLinkVisible(
    page: Page,
    linkName: string | RegExp,
    container?: string
): Promise<void> {
    const locator = container
        ? page.locator(container).getByRole('link', { name: linkName })
        : page.getByRole('link', { name: linkName });
    await expect(locator).toBeVisible();
}

/**
 * Verify text is visible on page
 */
export async function verifyTextVisible(page: Page, text: string | RegExp): Promise<void> {
    await expect(page.getByText(text)).toBeVisible();
}

/**
 * Verify element by selector is visible
 */
export async function verifySelectorVisible(page: Page, selector: string): Promise<void> {
    await expect(page.locator(selector)).toBeVisible();
}

/**
 * Verify element by selector is attached
 */
export async function verifySelectorAttached(page: Page, selector: string): Promise<void> {
    await expect(page.locator(selector)).toBeAttached();
}

/**
 * Verify meta tag content
 */
export async function verifyMetaTagContent(
    page: Page,
    metaName: string,
    expectedContent: string
): Promise<void> {
    const content = await page.locator(`meta[name="${metaName}"]`).getAttribute('content');
    expect(content).toContain(expectedContent);
}

/**
 * Verify page title matches pattern
 */
export async function verifyPageTitle(page: Page, pattern: RegExp): Promise<void> {
    await expect(page).toHaveTitle(pattern);
}

/**
 * Verify label exists for input
 */
export async function verifyLabelExists(page: Page, forAttribute: string): Promise<void> {
    await expect(page.locator(`label[for="${forAttribute}"]`)).toBeVisible();
}

/**
 * Navigate using link and verify URL
 */
export async function navigateUsingLink(
    page: Page,
    linkName: string | RegExp,
    expectedUrl: RegExp
): Promise<void> {
    await page.getByRole('link', { name: linkName }).click();
    await expect(page).toHaveURL(expectedUrl);
}

/**
 * Navigate through multiple steps
 */
export async function navigateThroughSteps(
    page: Page,
    steps: Array<{ linkName: string | RegExp; expectedUrl: RegExp }>
): Promise<void> {
    for (const step of steps) {
        await navigateUsingLink(page, step.linkName, step.expectedUrl);
    }
}

/**
 * Go back and verify URL
 */
export async function goBackAndVerify(page: Page, expectedUrl: RegExp): Promise<void> {
    await page.goBack();
    await expect(page).toHaveURL(expectedUrl);
}

/**
 * Verify button is visible
 */
export async function verifyButtonVisible(page: Page, buttonName: string | RegExp): Promise<void> {
    await expect(page.getByRole('button', { name: buttonName })).toBeVisible();
}

/**
 * Verify heading is visible
 */
export async function verifyHeadingVisible(page: Page, headingName: string | RegExp): Promise<void> {
    await expect(page.getByRole('heading', { name: headingName })).toBeVisible();
}

/**
 * Verify body contains text
 */
export async function verifyBodyContainsText(page: Page, pattern: RegExp): Promise<void> {
    await expect(page.locator('body')).toContainText(pattern);
}

/**
 * Verify element is not visible
 */
export async function verifyNotVisible(page: Page, selector: string): Promise<void> {
    const element = page.locator(selector);
    await expect(element).not.toBeVisible();
}
