// e2e/navigation.test.ts
// Tests for general navigation, UI elements, and user flow

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

// Test home page
test('home page loads correctly', async ({page}) => {
    await page.goto('/');
    
    // Should have basic navigation
    await expect(page.locator('body')).toBeAttached();
    
    // Should have login link when not authenticated
    await expect(page.getByRole('link', {name: /login/i})).toBeVisible();
});

// Test navigation bar for authenticated users
test('navigation bar shows all menu items for authenticated users', async ({page}) => {
    await login(page);
    
    // Check that main navigation items are present
    await expect(page.getByRole('link', {name: /create survey/i})).toBeVisible();
    await expect(page.getByRole('link', {name: /create packing/i})).toBeVisible();
    await expect(page.getByRole('link', {name: /create activity/i})).toBeVisible();
    await expect(page.getByRole('link', {name: /create drivers/i})).toBeVisible();
});

// Test dashboard entity list UI
test('dashboard shows entity counts', async ({page}) => {
    await login(page);
    
    // Check that all entity sections are present
    await expect(page.getByText(/your surveys/i)).toBeVisible();
    await expect(page.getByText(/your packing lists/i)).toBeVisible();
    await expect(page.getByText(/your activity plans/i)).toBeVisible();
    await expect(page.getByText(/your drivers lists/i)).toBeVisible();
});

// Test responsive navigation
test('page is responsive and accessible', async ({page}) => {
    await page.goto('/');
    
    // Check viewport meta tag for responsive design
    const viewport = await page.locator('meta[name="viewport"]').getAttribute('content');
    expect(viewport).toContain('width=device-width');
});

// Test footer links
test('footer contains required links', async ({page}) => {
    await page.goto('/');
    
    // Check for imprint and privacy links
    const footer = page.locator('footer');
    await expect(footer).toBeVisible();
    
    // Should have some footer content
    await expect(footer.locator('a')).toBeAttached();
});

// Test page titles
test('pages have appropriate titles', async ({page}) => {
    await page.goto('/users/login');
    await expect(page).toHaveTitle(/login|surveyor/i);
    
    await page.goto('/users/register');
    await expect(page).toHaveTitle(/register|surveyor/i);
});

// Test logo and branding
test('logo is present and links to home', async ({page}) => {
    await login(page);
    
    // Find logo link
    const logoLink = page.locator('a[href="/"]').first();
    await expect(logoLink).toBeVisible();
});

// Test form accessibility
test('login form has proper labels', async ({page}) => {
    await page.goto('/users/login');
    
    // Check for proper form labels
    await expect(page.locator('label[for="username"]')).toBeVisible();
    await expect(page.locator('label[for="password"]')).toBeVisible();
});

// Test navigation between entity create pages
test('can navigate between different entity creation pages', async ({page}) => {
    await login(page);
    
    // Navigate to survey create
    await page.getByRole('link', {name: /create survey/i}).click();
    await expect(page).toHaveURL(/\/survey\/create/);
    
    // Navigate to packing create
    await page.getByRole('link', {name: /create packing/i}).click();
    await expect(page).toHaveURL(/\/packing\/create/);
    
    // Navigate to activity create
    await page.getByRole('link', {name: /create activity/i}).click();
    await expect(page).toHaveURL(/\/activity\/create/);
    
    // Navigate to drivers create
    await page.getByRole('link', {name: /create drivers/i}).click();
    await expect(page).toHaveURL(/\/drivers\/create/);
    
    // Navigate back to dashboard
    await page.goto('/users/dashboard');
    await expect(page.getByRole('heading', {name: /welcome/i})).toBeVisible();
});

// Test browser back button works correctly
test('browser back button navigates correctly', async ({page}) => {
    await login(page);
    
    await page.goto('/survey/create');
    await page.goBack();
    await expect(page).toHaveURL(/\/users\/dashboard/);
});
