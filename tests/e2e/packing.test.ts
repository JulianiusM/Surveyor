// e2e/packing.test.ts
// End-to-end tests for packing list creation and management

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

test('authenticated user can access packing list create page', async ({page}) => {
    await login(page);
    await page.goto('/packing/create');
    await expect(page).toHaveURL(/\/packing\/create/);
    await expect(page.getByRole('heading', {name: /create.*packing/i})).toBeVisible();
});

test('unauthenticated user cannot access packing create page', async ({page}) => {
    await page.goto('/packing/create');
    await expect(page).toHaveURL(/\/users\/login/);
});

test('packing dashboard shows empty state for new user', async ({page}) => {
    await login(page);
    await expect(page.getByText(/you don't have any packing/i)).toBeVisible();
});

test('can create a new packing list with valid data', async ({page}) => {
    await login(page);
    await page.goto('/packing/create');
    
    // Fill in packing list details
    const packingName = `E2E Packing ${Date.now()}`;
    await page.locator('input[name="name"]').fill(packingName);
    
    // Submit the form
    await page.getByRole('button', {name: /create.*list/i}).click();
    
    // Should redirect to dashboard or packing view
    await page.waitForURL(/\/(users\/dashboard|packing\/\d+)/);
    
    // Verify success or packing list appears
    const body = await page.locator('body').textContent();
    expect(body).toContain(packingName);
});

test('packing form validates required fields', async ({page}) => {
    await login(page);
    await page.goto('/packing/create');
    
    // Try to submit without filling required fields
    const nameInput = page.locator('input[name="name"]');
    await expect(nameInput).toHaveAttribute('required', '');
    
    // Check HTML5 validation
    const isRequired = await nameInput.evaluate((el: HTMLInputElement) => el.required);
    expect(isRequired).toBe(true);
});
