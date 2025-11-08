// e2e/drivers.test.ts
// End-to-end tests for drivers list creation and management

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

test('authenticated user can access drivers list create page', async ({page}) => {
    await login(page);
    await page.goto('/drivers/create');
    await expect(page).toHaveURL(/\/drivers\/create/);
    await expect(page.getByRole('heading', {name: /create.*driver/i})).toBeVisible();
});

test('unauthenticated user cannot access drivers create page', async ({page}) => {
    await page.goto('/drivers/create');
    await expect(page).toHaveURL(/\/users\/login/);
});

test('drivers dashboard shows empty state for new user', async ({page}) => {
    await login(page);
    await expect(page.getByText(/you don't have any drivers/i)).toBeVisible();
});

test('can create a new drivers list with valid data', async ({page}) => {
    await login(page);
    await page.goto('/drivers/create');
    
    // Wait for the page to be fully loaded
    await expect(page).toHaveURL(/\/drivers\/create/);
    await expect(page.getByRole('heading', {name: /create.*driver/i})).toBeVisible();
    
    // Fill in drivers list details
    const driversTitle = `E2E Drivers ${Date.now()}`;
    await page.locator('input[name="title"]').fill(driversTitle);
    
    // Submit the form
    await page.getByRole('button', {name: /create.*list/i}).click();
    
    // Should redirect to dashboard or drivers view
    await page.waitForURL(/\/(users\/dashboard|drivers\/\d+)/);
    
    // Verify success or drivers list appears
    const body = await page.locator('body').textContent();
    expect(body).toContain(driversTitle);
});

test('drivers form validates required fields', async ({page}) => {
    await login(page);
    await page.goto('/drivers/create');
    
    // Wait for the page to be fully loaded
    await expect(page).toHaveURL(/\/drivers\/create/);
    await expect(page.getByRole('heading', {name: /create.*driver/i})).toBeVisible();
    
    // Try to submit without filling required fields
    const titleInput = page.locator('input[name="title"]');
    await expect(titleInput).toHaveAttribute('required', '');
    
    // Check HTML5 validation
    const isRequired = await titleInput.evaluate((el: HTMLInputElement) => el.required);
    expect(isRequired).toBe(true);
});
