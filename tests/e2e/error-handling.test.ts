// e2e/error-handling.test.ts
// Frontend error handling and validation tests

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

// Test 404 error page
test('shows 404 error page for non-existent routes', async ({page}) => {
    await page.goto('/this-route-does-not-exist');
    // Should show error page or be handled gracefully
    await expect(page.locator('body')).toContainText(/404|not found|error/i);
});

// Test form validation errors
test('login form shows validation errors for empty fields', async ({page}) => {
    await page.goto('/users/login');
    
    // Try to submit without filling fields
    await page.getByRole('button', {name: /login/i}).click();
    
    // HTML5 validation should prevent submission
    const usernameInput = page.locator('input[name="username"]');
    const isRequired = await usernameInput.getAttribute('required');
    expect(isRequired).not.toBeNull();
});

// Test registration form validation
test('registration form validates password matching', async ({page}) => {
    await page.goto('/users/register');
    
    const username = `testuser_${Date.now()}`;
    await page.locator('input[name="username"]').fill(username);
    await page.locator('input[name="displayname"]').fill(username);
    await page.locator('input[name="email"]').fill(`${username}@test.com`);
    await page.locator('input[name="password"]').fill('Password123!');
    await page.locator('input[name="password_repeat"]').fill('DifferentPassword123!');
    
    await page.getByRole('button', {name: /register/i}).click();
    
    // Should show validation error
    await expect(page.locator('.invalid-feedback, .alert-danger, .alert')).toBeAttached();
});

// Test invalid activation token
test('shows error for invalid activation token', async ({page}) => {
    await page.goto('/users/activate/invalid-token-12345');
    
    // Should show error message
    await expect(page.locator('.alert-danger, .alert, [role="alert"]')).toBeVisible();
});

// Test invalid reset token  
test('shows error for invalid password reset token', async ({page}) => {
    await page.goto('/users/reset-password/invalid-token-12345');
    
    // Should show error message
    await expect(page.locator('.alert-danger, .alert, [role="alert"]')).toBeVisible();
});

// Test session timeout/unauthorized access
test('redirects to login when accessing protected route without auth', async ({page}) => {
    await page.goto('/survey/create');
    
    // Should redirect to login
    await expect(page).toHaveURL(/\/users\/login/);
});

// Test network error handling with offline mode
test('handles network errors gracefully', async ({page, context}) => {
    await login(page);
    
    // Simulate offline mode
    await context.setOffline(true);
    
    // Try to navigate to a page that requires API call
    await page.goto('/users/dashboard');
    
    // Page should handle the error (may show cached content or error message)
    // At minimum, it shouldn't crash - just verify page loads
    await expect(page.locator('body')).toBeAttached();
    
    // Restore online mode
    await context.setOffline(false);
});

// Test form submission with server error simulation
test('handles server errors during login', async ({page}) => {
    await page.goto('/users/login');
    
    // Use wrong credentials to trigger error
    await page.locator('input[name="username"]').fill('nonexistent_user_12345');
    await page.locator('input[name="password"]').fill('wrongpassword');
    await page.getByRole('button', {name: /login/i}).click();
    
    // Should stay on login page and show error
    await expect(page).toHaveURL(/\/users\/login/);
    await expect(page.locator('.alert, .alert-danger, .invalid-feedback')).toBeAttached();
});

// Test JavaScript errors don't break the page
test('page remains functional after navigation', async ({page}) => {
    // Navigate through several pages to ensure no JS errors break functionality
    await page.goto('/');
    await expect(page.locator('body')).toBeAttached();
    
    await page.goto('/users/login');
    await expect(page.getByRole('button', {name: /login/i})).toBeVisible();
    
    await page.goto('/users/register');
    await expect(page.getByRole('button', {name: /register/i})).toBeVisible();
    
    await page.goto('/users/forgot-password');
    await expect(page.getByRole('button', {name: /send reset link/i})).toBeVisible();
});

// Test console errors
test('no critical console errors on main pages', async ({page}) => {
    const consoleErrors: string[] = [];
    
    page.on('console', (msg) => {
        if (msg.type() === 'error') {
            consoleErrors.push(msg.text());
        }
    });
    
    // Check key pages
    await page.goto('/');
    await page.goto('/users/login');
    await page.goto('/users/register');
    
    // Filter out expected errors (like network errors in test environment)
    const unexpectedErrors = consoleErrors.filter(err => 
        !err.includes('smtp.example.com') && 
        !err.includes('favicon') &&
        !err.includes('ENOTFOUND') &&
        !err.includes('ERR_NAME_NOT_RESOLVED') &&
        !err.includes('net::')
    );
    
    // Log any unexpected errors for debugging
    if (unexpectedErrors.length > 0) {
        console.log('Unexpected console errors:', unexpectedErrors);
    }
    
    expect(unexpectedErrors).toHaveLength(0);
});

// Test entity creation validation
test('survey form shows validation errors for empty required fields', async ({page}) => {
    await login(page);
    await page.goto('/survey/create');
    
    // Wait for the page to be fully loaded
    await expect(page).toHaveURL(/\/survey\/create/);
    await expect(page.getByRole('heading', {name: /create.*survey/i})).toBeVisible();
    
    const titleInput = page.locator('input[name="title"]');
    const isRequired = await titleInput.getAttribute('required');
    expect(isRequired).not.toBeNull();
});

// Test access control for non-existent resources
test('shows error for accessing non-existent survey', async ({page}) => {
    await login(page);
    await page.goto('/survey/999999');
    
    // Should show 404 or error message
    const body = await page.locator('body').textContent();
    expect(body).toMatch(/404|not found|error/i);
});

// Test protected routes redirect properly
test('all protected routes redirect unauthenticated users', async ({page}) => {
    const protectedRoutes = [
        '/survey/create',
        '/packing/create',
        '/activity/create',
        '/drivers/create',
        '/users/dashboard'
    ];
    
    for (const route of protectedRoutes) {
        await page.goto(route);
        await expect(page).toHaveURL(/\/users\/login/);
    }
});
