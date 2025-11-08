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
    await expect(page).toHaveURL(/\/users\/dashboard/);
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
    await expect(page.getByText(/you don't have any activity/i)).toBeVisible();
});

test('can create a new activity plan with valid data', async ({page}) => {
    await login(page);
    await page.goto('/activity/create');
    
    // Fill in activity plan details
    const activityTitle = `E2E Activity ${Date.now()}`;
    await page.locator('input[name="title"]').fill(activityTitle);
    
    // Submit the form
    await page.getByRole('button', {name: /create.*plan/i}).click();
    
    // Should redirect to dashboard or activity view
    await page.waitForURL(/\/(users\/dashboard|activity\/\d+)/);
    
    // Verify success or activity appears
    const body = await page.locator('body').textContent();
    expect(body).toContain(activityTitle);
});

test('activity form validates required fields', async ({page}) => {
    await login(page);
    await page.goto('/activity/create');
    
    // Try to submit without filling required fields
    const titleInput = page.locator('input[name="title"]');
    await expect(titleInput).toHaveAttribute('required', '');
    
    // Check HTML5 validation
    const isRequired = await titleInput.evaluate((el: HTMLInputElement) => el.required);
    expect(isRequired).toBe(true);
});
