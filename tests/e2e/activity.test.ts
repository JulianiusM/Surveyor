// e2e/activity.test.ts
// End-to-end tests for activity plan creation and management

import {expect, test} from '@playwright/test';

const USERNAME = process.env.E2E_ADMIN_USERNAME ?? 'tester';
const PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'passw0rd!';

async function login(page: any) {
    await page.goto('/users/login');
    await page.locator('input[name="username"]').fill(USERNAME);
    await page.locator('input[name="password"]').fill(PASSWORD);
    await page.getByRole('button', {name: /login/i}).click();
    // Wait for redirect and dashboard to load
    await page.waitForURL(/\/users\/dashboard/, {waitUntil: 'networkidle'});
    // Ensure we're logged in by checking for user menu
    await expect(page.locator('#userMenu')).toBeVisible();
    
    // Verify session cookie was set
    const cookies = await page.context().cookies();
    const sessionCookie = cookies.find(c => c.name === 'connect.sid');
    if (!sessionCookie) {
        throw new Error('Session cookie was not set after login');
    }
    
    // Add a delay to ensure session is fully persisted to database
    await page.waitForTimeout(1000);
}

test.beforeEach(async ({context}) => {
    await context.clearCookies();
});

test('authenticated user can access activity plan create page', async ({page}) => {
    await login(page);
    await page.goto('/activity/create');
    await expect(page).toHaveURL(/\/activity\/create/);
    await expect(page.getByRole('heading', {name: /create.*activity/i})).toBeVisible();
});

test('unauthenticated user cannot access activity create page', async ({page}) => {
    await page.goto('/activity/create');
    await expect(page).toHaveURL(/\/users\/login/);
});

test('activity dashboard shows empty state for new user', async ({page}) => {
    await login(page);
    const accordion = page.locator('#sec-activity');
    await page.getByRole('button', {name: /your activity plans/i}).click();
    await expect(accordion).toContainText(/you don['’]t have any activity/i);
});

test('can create a new activity plan with valid data', async ({page}) => {
    await login(page);
    await page.goto('/activity/create');

    // Wait for the page to be fully loaded
    await expect(page).toHaveURL(/\/activity\/create/);
    await expect(page.getByRole('heading', {name: /create.*activity/i})).toBeVisible();

    // Fill in activity plan details
    const activityTitle = `E2E Activity ${Date.now()}`;
    await page.locator('input[name="title"]').fill(activityTitle);
    await page.locator('input[name="startDate"]').fill('2025-01-01');
    await page.locator('input[name="endDate"]').fill('2025-01-02');
    await page.evaluate(async () => {
        const slotId = self.crypto?.randomUUID?.() ?? '00000000-0000-4000-8000-000000000000';
        const day = '2025-01-01';
        const slot = {id: slotId, day, pos: 0, title: 'Setup', description: '', maxAssignees: 1};
        const mod = await import('/js/activity-create.gen.js');
        mod.updateSlotObj(day, slot);
    });

    // Submit the form
    await page.getByRole('button', {name: /create.*plan/i}).click();
    
    // Should redirect to dashboard or activity view
    await page.waitForURL(url => /\/(users\/dashboard|activity\/[\w-]*-[\w-]+)/.test(url.pathname));
    
    // Verify success or activity appears
    const body = await page.locator('body').textContent();
    expect(body).toContain(activityTitle);
});

test('activity form validates required fields', async ({page}) => {
    await login(page);
    await page.goto('/activity/create');
    
    // Wait for the page to be fully loaded
    await expect(page).toHaveURL(/\/activity\/create/);
    await expect(page.getByRole('heading', {name: /create.*activity/i})).toBeVisible();
    
    // Try to submit without filling required fields
    const titleInput = page.locator('input[name="title"]');
    await expect(titleInput).toHaveAttribute('required', '');
    
    // Check HTML5 validation
    const isRequired = await titleInput.evaluate((el: HTMLInputElement) => el.required);
    expect(isRequired).toBe(true);
});
