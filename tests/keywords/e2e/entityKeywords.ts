/**
 * Keywords for entity management E2E testing
 * Reusable actions for creating, viewing, and validating entities (surveys, packing, activity, drivers)
 */

import { expect, Page } from '@playwright/test';

/**
 * Navigate to entity create page and verify it loaded
 */
export async function navigateToEntityCreatePage(
    page: Page,
    entityType: 'survey' | 'packing' | 'activity' | 'drivers',
    expectedUrl: RegExp,
    expectedHeading: RegExp
): Promise<void> {
    const urlMap = {
        survey: '/survey/create',
        packing: '/packing/create',
        activity: '/activity/create',
        drivers: '/drivers/create',
    };

    await page.goto(urlMap[entityType], { waitUntil: 'networkidle' });
    await expect(page).toHaveURL(expectedUrl);
    await expect(page.getByRole('heading', { name: expectedHeading })).toBeVisible();
}

/**
 * Verify entity page access redirects unauthenticated users
 */
export async function verifyUnauthenticatedRedirect(
    page: Page,
    targetUrl: string,
    expectedRedirectUrl: RegExp
): Promise<void> {
    await page.goto(targetUrl);
    await expect(page).toHaveURL(expectedRedirectUrl);
}

/**
 * Check dashboard empty state for an entity type
 */
export async function verifyDashboardEmptyState(
    page: Page,
    accordionId: string,
    buttonText: RegExp,
    expectedEmptyText: RegExp
): Promise<void> {
    const accordion = page.locator(accordionId);
    await page.getByRole('button', { name: buttonText }).click();
    await expect(accordion).toContainText(expectedEmptyText);
}

/**
 * Fill form field
 */
export async function fillFormField(
    page: Page,
    fieldName: string,
    value: string
): Promise<void> {
    await page.locator(`input[name="${fieldName}"], textarea[name="${fieldName}"]`).fill(value);
}

/**
 * Submit form and wait for navigation
 */
export async function submitFormAndWaitForRedirect(
    page: Page,
    submitButtonText: RegExp,
    expectedUrlPattern: RegExp
): Promise<void> {
    await page.getByRole('button', { name: submitButtonText }).click();
    await page.waitForURL((url) => expectedUrlPattern.test(url.pathname));
}

/**
 * Verify title appears in page
 */
export async function verifyTitleInPage(page: Page, title: string): Promise<void> {
    await expect(page.locator('h1')).toContainText(title);
}

/**
 * Verify form field is required
 */
export async function verifyFormFieldRequired(page: Page, fieldName: string): Promise<void> {
    const input = page.locator(`input[name="${fieldName}"]`);
    await expect(input).toHaveAttribute('required', '');
    const isRequired = await input.evaluate((el: HTMLInputElement) => el.required);
    expect(isRequired).toBe(true);
}

/**
 * Create survey with basic data
 */
export async function createSurvey(
    page: Page,
    title: string,
    description: string,
    submitButtonText: RegExp
): Promise<void> {
    await fillFormField(page, 'title', title);
    await fillFormField(page, 'description', description);
    await page.getByRole('button', { name: submitButtonText }).click();
}

/**
 * Create packing list with items
 */
export async function createPackingList(
    page: Page,
    title: string,
    items: Array<{ name: string; value: string }>,
    submitButtonText: RegExp
): Promise<void> {
    await fillFormField(page, 'title', title);
    for (const item of items) {
        await fillFormField(page, item.name, item.value);
    }
    await page.getByRole('button', { name: submitButtonText }).click();
}

/**
 * Create activity plan with dates
 */
export async function createActivityPlan(
    page: Page,
    title: string,
    startDate: string,
    endDate: string,
    slot: { day: string; pos: number; title: string; description: string; maxAssignees: number },
    submitButtonText: RegExp
): Promise<void> {
    await fillFormField(page, 'title', title);
    await fillFormField(page, 'startDate', startDate);
    await fillFormField(page, 'endDate', endDate);
    
    // Add slot using frontend JavaScript
    await page.evaluate(async (slotData) => {
        const slotId = self.crypto?.randomUUID?.() ?? '00000000-0000-4000-8000-000000000000';
        const slot = { id: slotId, ...slotData };
        // @ts-ignore
        const mod = await import('/js/activity-create.gen.js');
        mod.updateSlotObj(slotData.day, slot);
    }, slot);

    await page.getByRole('button', { name: submitButtonText }).click();
}

/**
 * Create drivers list
 */
export async function createDriversList(
    page: Page,
    title: string,
    submitButtonText: RegExp,
    requiresFormSubmit: boolean = false
): Promise<void> {
    await fillFormField(page, 'title', title);
    await page.getByRole('button', { name: submitButtonText }).click();
    
    if (requiresFormSubmit) {
        await page.evaluate(() => {
            const form = document.getElementById('packingForm') as HTMLFormElement | null;
            form?.submit();
        });
    }
}

/**
 * Generate timestamped entity title
 */
export function generateEntityTitle(prefix: string): string {
    return `${prefix} ${Date.now()}`;
}
