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
    
    // Verify session cookie was set and log details for debugging
    const cookies = await page.context().cookies();
    const sessionCookie = cookies.find(c => c.name === 'connect.sid');
    if (!sessionCookie) {
        throw new Error('Session cookie was not set after login');
    }
    console.log('Session cookie details:', {
        name: sessionCookie.name,
        domain: sessionCookie.domain,
        path: sessionCookie.path,
        sameSite: sessionCookie.sameSite,
        secure: sessionCookie.secure,
        httpOnly: sessionCookie.httpOnly
    });
    
    // Make a test request to verify session is valid and persisted
    // Navigate to dashboard again to ensure session is readable
    await page.goto('/users/dashboard', {waitUntil: 'networkidle'});
    await expect(page.locator('#userMenu')).toBeVisible();
    
    // Add a small delay to ensure session is fully persisted to database
    await page.waitForTimeout(3000); // Increased to 3s for maximum reliability
}

test.beforeEach(async ({context}) => {
    await context.clearCookies();
});

test('authenticated user can access survey create page', async ({page}) => {
    await login(page);
    
    // Verify cookie is still present before navigation
    const cookiesBeforeNav = await page.context().cookies();
    const sessionCookieBeforeNav = cookiesBeforeNav.find(c => c.name === 'connect.sid');
    console.log('Cookie before navigation:', sessionCookieBeforeNav ? 'present' : 'MISSING');
    
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
    const accordion = page.locator('#sec-surveys');
    await page.getByRole('button', {name: /your surveys/i}).click();
    await expect(accordion).toContainText(/you don['’]t have any surveys/i);
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
    await page.waitForURL(url => /\/(users\/dashboard|survey\/[\w-]*-[\w-]+)/.test(url.pathname));

    // Verify success message or survey appears
    await expect(page.locator('h1')).toContainText(surveyTitle);
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
