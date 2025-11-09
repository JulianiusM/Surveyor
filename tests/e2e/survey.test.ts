// e2e/survey.test.ts
// End-to-end tests for survey creation, editing, and management

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
    // Add a small delay to ensure session is fully persisted to database
    await page.waitForTimeout(500);
}

test.beforeEach(async ({context}) => {
    await context.clearCookies();
});

test('authenticated user can access survey create page', async ({page}) => {
    await login(page);
    await page.goto('/survey/create', {waitUntil: 'networkidle'});
    await expect(page).toHaveURL(/\/survey\/create/);
    await expect(page.getByRole('heading', {name: /create.*survey/i})).toBeVisible();
});

test('unauthenticated user cannot access survey create page', async ({page}) => {
    await page.goto('/survey/create');
    await expect(page).toHaveURL(/\/users\/login/);
});

test('survey dashboard shows empty state for new user', async ({page}) => {
    await login(page);
    await expect(page.getByText(/you don't have any surveys/i)).toBeVisible();
});

test('can create a new survey with valid data', async ({page}) => {
    await login(page);
    await page.goto('/survey/create', {waitUntil: 'networkidle'});
    
    // Wait for the page to be fully loaded
    await expect(page).toHaveURL(/\/survey\/create/);
    await expect(page.getByRole('heading', {name: /create.*survey/i})).toBeVisible();
    
    // Fill in survey details
    const surveyTitle = `E2E Survey ${Date.now()}`;
    await page.locator('input[name="title"]').fill(surveyTitle);
    await page.locator('textarea[name="description"]').fill('Test survey description');
    
    // Submit the form
    await page.getByRole('button', {name: /create.*survey/i}).click();
    
    // Should redirect to dashboard or survey view
    await page.waitForURL(/\/(users\/dashboard|survey\/\d+)/);
    
    // Verify success message or survey appears
    const body = await page.locator('body').textContent();
    expect(body).toContain(surveyTitle);
});

test('survey form validates required fields', async ({page}) => {
    await login(page);
    await page.goto('/survey/create', {waitUntil: 'networkidle'});
    
    // Wait for the page to be fully loaded
    await expect(page).toHaveURL(/\/survey\/create/);
    await expect(page.getByRole('heading', {name: /create.*survey/i})).toBeVisible();
    
    // Try to submit without filling required fields
    const titleInput = page.locator('input[name="title"]');
    await expect(titleInput).toHaveAttribute('required', '');
    
    // Check HTML5 validation
    const isRequired = await titleInput.evaluate((el: HTMLInputElement) => el.required);
    expect(isRequired).toBe(true);
});
