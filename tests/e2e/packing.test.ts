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
    
    // Wait for the page to be fully loaded
    await expect(page).toHaveURL(/\/packing\/create/);
    await expect(page.getByRole('heading', {name: /create.*packing/i})).toBeVisible();
    
    // Fill in packing list details
    const packingTitle = `E2E Packing ${Date.now()}`;
    await page.locator('input[name="title"]').fill(packingTitle);
    
    // Submit the form
    await page.getByRole('button', {name: /create.*list/i}).click();
    
    // Should redirect to dashboard or packing view
    await page.waitForURL(/\/(users\/dashboard|packing\/\d+)/);
    
    // Verify success or packing list appears
    const body = await page.locator('body').textContent();
    expect(body).toContain(packingTitle);
});

test('packing form validates required fields', async ({page}) => {
    await login(page);
    await page.goto('/packing/create');
    
    // Wait for the page to be fully loaded
    await expect(page).toHaveURL(/\/packing\/create/);
    await expect(page.getByRole('heading', {name: /create.*packing/i})).toBeVisible();
    
    // Try to submit without filling required fields
    const titleInput = page.locator('input[name="title"]');
    await expect(titleInput).toHaveAttribute('required', '');
    
    // Check HTML5 validation
    const isRequired = await titleInput.evaluate((el: HTMLInputElement) => el.required);
    expect(isRequired).toBe(true);
});
