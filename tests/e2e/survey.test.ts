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
    await page.waitForURL(/\/users\/dashboard/, {waitUntil: 'networkidle'});
    await expect(page.locator('#userMenu')).toBeVisible();
}

test.beforeEach(async ({context}) => {
    await context.clearCookies();
});

test('authenticated user can access survey create page', async ({page}) => {
    await login(page);
    // Instead of page.goto, try clicking a link (if one exists) or use click navigation
    // For now, let's try a different approach - stay on dashboard and verify we're still logged in
    await expect(page).toHaveURL(/\/users\/dashboard/);
    await expect(page.locator('#userMenu')).toBeVisible();
    
    // Now navigate to survey create
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
