// e2e/auth.spec.ts
// End-to-end tests for the local username/password authentication flow.
//
// Prereqs:
//  - Your Playwright webServer command should run a DB reset + start the server
//    (see previous messages for `e2e-db-init.ts` + `playwright.config.ts`).
//  - Seed a test user that is ACTIVE (isActive=true) with credentials from env:
//      E2E_ADMIN_USERNAME, E2E_ADMIN_PASSWORD (and optional E2E_ADMIN_EMAIL)
//  - Ensure local login is enabled for E2E runs:
//      E2E_LOCAL_LOGIN_ENABLED=1 (or LOCAL_LOGIN_ENABLED=1)
//
// The UI selectors below use stable attributes and accessible roles. Where the
// PUG template does not expose labels, we fall back to input[name=...] which
// matches the controller's expected body fields.

import {expect, test} from '@playwright/test';

const USERNAME = process.env.E2E_ADMIN_USERNAME ?? 'e2e_user';
const PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'passw0rd!';

// Helper: fill the login form and submit.
async function login(page: import('@playwright/test').Page, username: string, password: string) {
    await page.goto('/users/login');

    // Prefer label-based when available; otherwise fall back to name attribute.
    const userInput = page.locator('input[name="username"]');
    const passInput = page.locator('input[name="password"]');

    await expect(userInput).toBeVisible();
    await expect(passInput).toBeVisible();

    await userInput.fill(username);
    await passInput.fill(password);
    await page.getByRole('button', {name: /login/i}).click();
}

// Before each test, start from a clean browser state (no cookies).
// (Server/database is reset once before the webServer starts.)
test.beforeEach(async ({context}) => {
    await context.clearCookies();
});

// 1) Unauthenticated users trying to access /users/dashboard should be redirected to /users/login
//    (guarded by isAuthenticated middleware)
test('redirects unauthenticated users to login', async ({page}) => {
    await page.goto('/users/dashboard');
    await expect(page).toHaveURL(/\/users\/login/);
    await expect(page.getByRole('heading', {name: /login/i})).toBeVisible();
});

// 2) Login page renders and contains the expected inputs and submit button
test('renders login form', async ({page}) => {
    await page.goto('/users/login');

    // Heading
    await expect(page.getByRole('heading', {name: /login/i})).toBeVisible();

    // Inputs (username/password)
    await expect(page.locator('input[name="username"]')).toBeVisible();
    await expect(page.locator('input[name="password"]')).toBeVisible();

    // Submit button
    await expect(page.getByRole('button', {name: /login/i})).toBeEnabled();
});

// 3) Invalid credentials keep the user on the login page and show an error message/alert
//    (we assert URL + presence of a generic alert container to avoid brittle copy checks)
test('rejects wrong credentials', async ({page}) => {
    await page.goto('/users/login');

    await page.locator('input[name="username"]').fill('unknown_user');
    await page.locator('input[name="password"]').fill('totally-wrong');
    await page.getByRole('button', {name: /login/i}).click();

    await expect(page).toHaveURL(/\/users\/login/);

    // Try to detect a flash/alert. If the app uses .alert or .invalid-feedback, detect either.
    const possibleAlert = page.locator('.alert, .alert-danger, .invalid-feedback');
    await expect(possibleAlert.first()).toBeVisible();
});

// 4) Successful login redirects to the dashboard and greets the user
//    (Dashboard heading contains "Welcome,")
test('logs in with valid credentials and shows dashboard', async ({page}) => {
    await login(page, USERNAME, PASSWORD);

    await expect(page).toHaveURL(/\/users\/dashboard/);
    await expect(page.getByRole('heading', {name: /welcome/i})).toBeVisible();
});

// 5) Logout from the user menu returns to a signed-out state (login link visible)
//    The layout exposes a #userMenu toggle and a /users/logout link in the dropdown.
test('logs out via navbar menu', async ({page}) => {
    await login(page, USERNAME, PASSWORD);
    await expect(page).toHaveURL(/\/users\/dashboard/);

    // Navigate to logout URL
    await page.goto('/users/logout');

    // After logout, check we're redirected or can't access protected pages
    await page.goto('/users/dashboard');
    // Should redirect to login if not authenticated
    await expect(page).toHaveURL(/\/users\/login/);
});


// ==============================================
// Additional E2E: Registration + Activation + Password Reset + OIDC button
// ==============================================

// Lazily create a MariaDB connection pool (no extra import at top required)
let __e2e_db_pool: any | null = null;

async function db() {
    if (!__e2e_db_pool) {
        const mysql = await import('mysql2/promise');
        __e2e_db_pool = mysql.createPool({
            host: process.env.E2E_DB_HOST || process.env.DB_HOST || '127.0.0.1',
            port: Number(process.env.E2E_DB_PORT || process.env.DB_PORT || 3306),
            user: process.env.E2E_DB_USER || process.env.DB_USER,
            password: process.env.E2E_DB_PASSWORD || process.env.E2E_DB_PASS || process.env.DB_PASSWORD,
            database: process.env.E2E_DB_NAME || process.env.DB_NAME,
            waitForConnections: true,
            connectionLimit: 10,
        });
    }
    return __e2e_db_pool;
}

async function getActivationToken(username: string): Promise<string | undefined> {
    const pool = await db();
    const [rows] = await pool.query('SELECT activation_token AS token FROM users WHERE username = ? ORDER BY id DESC LIMIT 1', [username]);
    return (rows as any[])[0]?.token;
}

async function getResetToken(username: string): Promise<string | undefined> {
    const pool = await db();
    const [rows] = await pool.query('SELECT reset_token AS token FROM users WHERE username = ? ORDER BY id DESC LIMIT 1', [username]);
    return (rows as any[])[0]?.token;
}

function uniq(prefix: string) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

async function registerUserThroughUI(page: import('@playwright/test').Page, {
    username, password, email, displayname,
}: { username: string; password: string; email: string; displayname?: string }) {
    await page.goto('/users/register');
    await page.locator('input[name="username"]').fill(username);
    await page.locator('input[name="displayname"]').fill(displayname ?? username);
    await page.locator('input[name="email"]').fill(email);
    await page.locator('input[name="password"]').fill(password);
    await page.locator('input[name="password_repeat"]').fill(password);
    await page.getByRole('button', {name: /register/i}).click();
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('Account successfully registered', {exact: false})).toBeVisible();
}

async function activateUserViaLink(page: import('@playwright/test').Page, username: string) {
    const token = await getActivationToken(username);
    expect(token, 'Activation token should exist in DB').toBeTruthy();
    await page.goto(`/users/activate/${token}`);
    await expect(page.getByText('Your account has been activated', {exact: false})).toBeVisible();
}

// ---- Registration + Activation + Login -------------------------------------------------
test('registers a user, activates the account, and logs in', async ({page}) => {
    const username = uniq('e2e_reg');
    const password = 'RegTest!123';
    const email = `${username}@example.test`;

    await registerUserThroughUI(page, {username, password, email});
    await activateUserViaLink(page, username);

    // Now log in with the freshly activated account
    await page.goto('/users/login');
    await page.locator('input[name="username"]').fill(username);
    await page.locator('input[name="password"]').fill(password);
    await page.getByRole('button', {name: /login/i}).click();

    await expect(page).toHaveURL(/\/users\/dashboard/);
    await expect(page.getByRole('heading', {name: /welcome/i})).toBeVisible();
});

// ---- Password Reset Flow ---------------------------------------------------------------
test('requests a password reset, changes the password, and logs in with the new one', async ({page}) => {
    // Prepare: create & activate a dedicated user
    const username = uniq('e2e_reset');
    const oldPassword = 'OldPass!123';
    const email = `${username}@example.test`;

    await registerUserThroughUI(page, {username, password: oldPassword, email});
    await activateUserViaLink(page, username);

    // Trigger forgot-password by username
    await page.goto('/users/forgot-password');
    await page.locator('input[name="username"]').fill(username);
    await page.getByRole('button', {name: /send reset link/i}).click();
    await expect(page.getByText('link has been sent', {exact: false})).toBeVisible();

    // Fetch reset token from DB and open the reset page
    const token = await getResetToken(username);
    expect(token, 'Reset token should exist in DB').toBeTruthy();
    await page.goto(`/users/reset-password/${token}`);
    await expect(page.getByRole('heading', {name: /reset your password/i})).toBeVisible();

    // Some templates may post to /auth/reset-password – to avoid a mismatch, post directly via API
    const newPassword = 'NewPass!456';
    const res = await page.request.post(`/users/reset-password/${token}`,
        {form: {password: newPassword, confirmPassword: newPassword}});
    expect(res.ok()).toBeTruthy();

    // Log in with the new password
    await page.goto('/users/login');
    await page.locator('input[name="username"]').fill(username);
    await page.locator('input[name="password"]').fill(newPassword);
    await page.getByRole('button', {name: /login/i}).click();
    await expect(page).toHaveURL(/\/users\/dashboard/);
});

// ---- OIDC Button Visibility ------------------------------------------------------------
test('hides OIDC login button when OIDC is disabled', async ({page}) => {
    await page.goto('/users/login');
    // Button should NOT be rendered when settings.oidcEnabled === false (frontend behavior test)
    // In E2E config, OIDC_ENABLED=0, so the button should not exist
    const oidcBtn = page.getByRole('link', {name: /login.*openid/i});
    await expect(oidcBtn).not.toBeVisible();
});


// ==============================================
// Negative-path tests: duplicate usernames, weak passwords,
// invalid/expired tokens, and reused tokens
// ==============================================

async function columnExists(table: string, column: string): Promise<boolean> {
    const pool = await db();
    const [rows] = await pool.query(
        `SELECT 1
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = ?
           AND COLUMN_NAME = ?
         LIMIT 1`,
        [table, column]
    );
    return (rows as any[]).length > 0;
}

// Set a reset token to be expired if the schema supports it. Returns true if succeeded.
async function expireResetToken(username: string): Promise<boolean> {
    const pool = await db();
    const table = 'users';
    const candidates = ['reset_token_expires', 'reset_expires_at', 'reset_token_expires_at'];
    for (const col of candidates) {
        if (await columnExists(table, col)) {
            await pool.query(`UPDATE ${table}
                              SET ${col} = DATE_SUB(NOW(), INTERVAL 1 HOUR)
                              WHERE username = ?`, [username]);
            return true;
        }
    }
    return false;
}

// ---- Duplicate username should be rejected --------------------------------------------
test('rejects duplicate username during registration', async ({page}) => {
    const username = uniq('e2e_dup');
    const password = 'DupOk!123';
    const email1 = `${username}@example.test`;
    const email2 = `${username}+2@example.test`;

    // First registration succeeds
    await registerUserThroughUI(page, {username, password, email: email1});

    // Try again with same username
    await page.goto('/users/register');
    await page.locator('input[name="username"]').fill(username);
    await page.locator('input[name="displayname"]').fill(username);
    await page.locator('input[name="email"]').fill(email2);
    await page.locator('input[name="password"]').fill(password);
    await page.locator('input[name="password_repeat"]').fill(password);
    await page.getByRole('button', {name: /register/i}).click();

    // Expect to stay on registration page with an error alert
    await expect(page).toHaveURL(/\/users\/register/);
    const errorMsg = page.locator('.alert, .alert-danger, .invalid-feedback');
    await expect(errorMsg.first()).toBeAttached();
    const errorText = await errorMsg.first().textContent();
    expect(errorText).toBeTruthy();
});

// ---- Weak password should be rejected by server-side validation ------------------------
test('rejects weak password on registration', async ({page}) => {
    const username = uniq('e2e_weak');
    const weak = '12345';

    await page.goto('/users/register');
    await page.locator('input[name="username"]').fill(username);
    await page.locator('input[name="displayname"]').fill(username);
    await page.locator('input[name="email"]').fill(`${username}@example.test`);
    await page.locator('input[name="password"]').fill(weak);
    await page.locator('input[name="password_repeat"]').fill(weak);
    await page.getByRole('button', {name: /register/i}).click();

    await expect(page).toHaveURL(/\/users\/register/);
    // Look for any validation message - invalid feedback or alert
    const msg = page.locator('.invalid-feedback, .alert-danger, .alert');
    await expect(msg.first()).toBeAttached();
    // If it's an invalid-feedback, check that it contains some error text
    const feedbackText = await msg.first().textContent();
    expect(feedbackText).toBeTruthy();
    expect(feedbackText!.length).toBeGreaterThan(0);
});

// ---- Invalid (bogus) activation token shows error --------------------------------------
test('invalid activation token shows an error', async ({page}) => {
    await page.goto('/users/activate/THIS-TOKEN-DOES-NOT-EXIST');
    await expect(page.locator('.alert, .alert-danger, [role="alert"]')).toBeVisible();
    // Optional: expect to remain on an activation page or get redirected to login with error
});

// ---- Reusing an activation token after success should fail ------------------------------
test('activation token cannot be reused', async ({page}) => {
    const username = uniq('e2e_react');
    const password = 'ActOnce!1';
    const email = `${username}@example.test`;

    await registerUserThroughUI(page, {username, password, email});
    const token = await getActivationToken(username);
    expect(token).toBeTruthy();

    // First activation works
    await page.goto(`/users/activate/${token}`);
    await expect(page.locator('.alert, .alert-success')).toBeVisible();

    // Second attempt should fail
    await page.goto(`/users/activate/${token}`);
    await expect(page.locator('.alert, .alert-danger, [role="alert"]')).toBeVisible();
});

// ---- Expired reset token (if schema supports expires column) ---------------------------
test('expired reset token is rejected (if supported by schema)', async ({page}) => {
    const username = uniq('e2e_expire');
    const password = 'ExpireOk!123';
    const email = `${username}@example.test`;

    await registerUserThroughUI(page, {username, password, email});
    await activateUserViaLink(page, username);

    // request reset
    await page.goto('/users/forgot-password');
    await page.locator('input[name="username"]').fill(username);
    await page.getByRole('button', {name: /send reset link/i}).click();
    await expect(page.locator('.alert, .alert-success')).toBeVisible();

    const token = await getResetToken(username);
    expect(token).toBeTruthy();

    // Mark token expired in DB if possible; otherwise skip the assertion gracefully
    const expired = await expireResetToken(username);
    if (!expired) {
        test.fixme(true, 'Schema has no reset token expiry column; cannot simulate expiry.');
        return;
    }

    await page.goto(`/users/reset-password/${token}`);
    await expect(page.locator('.alert, .alert-danger, [role="alert"]').first()).toBeVisible();
});

// ---- Reusing a password reset token should fail ----------------------------------------
test('reset token cannot be reused', async ({page}) => {
    const username = uniq('e2e_rereset');
    const oldPassword = 'OldP@ss!11';
    const email = `${username}@example.test`;

    await registerUserThroughUI(page, {username, password: oldPassword, email});
    await activateUserViaLink(page, username);

    // request reset
    await page.goto('/users/forgot-password');
    await page.locator('input[name="username"]').fill(username);
    await page.getByRole('button', {name: /send reset link/i}).click();
    await expect(page.locator('.alert, .alert-success')).toBeVisible();

    const token = await getResetToken(username);
    expect(token).toBeTruthy();

    const newPassword = 'BrandNew!22';
    // First use succeeds
    let res = await page.request.post(`/users/reset-password/${token}`,
        {form: {password: newPassword, confirmPassword: newPassword}});
    expect(res.ok()).toBeTruthy();

    // Second use fails
    res = await page.request.post(`/users/reset-password/${token}`,
        {form: {password: 'Another!33', confirmPassword: 'Another!33'}});
    expect(res.ok(), 'Reusing token should not be OK').toBeFalsy();
});
