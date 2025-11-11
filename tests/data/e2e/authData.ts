/**
 * Test data for authentication E2E tests
 * Data-driven test cases for login, registration, activation, and password reset
 */

/**
 * Test credentials from environment
 */
export const testCredentials = {
    username: process.env.E2E_ADMIN_USERNAME ?? 'tester',
    password: process.env.E2E_ADMIN_PASSWORD ?? 'passw0rd!',
    email: process.env.E2E_ADMIN_EMAIL ?? 'tester@example.com',
};

/**
 * Test cases for login page rendering
 */
export const loginPageRenderData = [
    {
        description: 'renders login form with heading',
        expectedHeading: /login/i,
    },
    {
        description: 'displays username input field',
        inputName: 'username',
    },
    {
        description: 'displays password input field',
        inputName: 'password',
    },
    {
        description: 'displays login button',
        buttonText: /login/i,
    },
];

/**
 * Test cases for failed login attempts
 */
export const loginFailureData = [
    {
        description: 'rejects wrong credentials',
        username: 'unknown_user',
        password: 'totally-wrong',
        expectedUrl: /\/users\/login/,
        expectedAlert: true,
    },
];

/**
 * Test cases for successful login
 */
export const loginSuccessData = [
    {
        description: 'logs in with valid credentials and shows dashboard',
        username: testCredentials.username,
        password: testCredentials.password,
        expectedUrl: /\/users\/dashboard/,
        expectedHeading: /welcome/i,
        expectSessionCookie: true,
    },
];

/**
 * Test cases for logout
 */
export const logoutData = [
    {
        description: 'logs out via navbar menu',
        logoutUrl: '/users/logout',
        dashboardUrl: '/users/dashboard',
        expectedRedirectUrl: /\/users\/login/,
    },
];

/**
 * Test cases for user registration
 */
export const registrationSuccessData = [
    {
        description: 'registers a user with valid data',
        generateUsername: true,
        usernamePrefix: 'e2e_reg',
        password: 'RegTest!123',
        useEmailFromUsername: true,
        expectedSuccessMessage: 'Account successfully registered',
    },
];

/**
 * Test cases for account activation
 */
export const activationSuccessData = [
    {
        description: 'activates account with valid token',
        expectedSuccessMessage: 'Your account has been activated',
    },
];

/**
 * Test cases for complete registration + activation + login flow
 */
export const registrationFlowData = [
    {
        description: 'registers a user, activates the account, and logs in',
        usernamePrefix: 'e2e_reg',
        password: 'RegTest!123',
        expectedDashboardUrl: /\/users\/dashboard/,
        expectedHeading: /welcome/i,
    },
];

/**
 * Test cases for password reset flow
 */
export const passwordResetFlowData = [
    {
        description: 'requests a password reset, changes the password, and logs in with the new one',
        usernamePrefix: 'e2e_reset',
        oldPassword: 'OldPass!123',
        newPassword: 'NewPass!456',
        forgotPasswordUrl: '/users/forgot-password',
        resetLinkSentMessage: 'link has been sent',
        resetPageHeading: /reset your password/i,
    },
];

/**
 * Test cases for OIDC button visibility
 */
export const oidcButtonVisibilityData = [
    {
        description: 'hides OIDC login button when OIDC is disabled',
        buttonName: /login.*openid/i,
        shouldBeVisible: false,
    },
];

/**
 * Test cases for duplicate username validation
 */
export const duplicateUsernameData = [
    {
        description: 'rejects duplicate username during registration',
        usernamePrefix: 'e2e_dup',
        password: 'DupOk!123',
        expectedUrl: /\/users\/register/,
        expectErrorAlert: true,
    },
];

/**
 * Test cases for weak password validation
 */
export const weakPasswordData = [
    {
        description: 'rejects weak password on registration',
        usernamePrefix: 'e2e_weak',
        weakPassword: '12345',
        expectedUrl: /\/users\/register/,
        expectValidationMessage: true,
    },
];

/**
 * Test cases for invalid activation tokens
 */
export const invalidActivationTokenData = [
    {
        description: 'invalid activation token shows an error',
        token: 'THIS-TOKEN-DOES-NOT-EXIST',
        expectErrorAlert: true,
    },
];

/**
 * Test cases for activation token reuse
 */
export const activationTokenReuseData = [
    {
        description: 'activation token cannot be reused',
        usernamePrefix: 'e2e_react',
        password: 'ActOnce!1',
        expectFirstActivationSuccess: true,
        expectSecondActivationError: true,
    },
];

/**
 * Test cases for expired reset tokens
 */
export const expiredResetTokenData = [
    {
        description: 'expired reset token is rejected (if supported by schema)',
        usernamePrefix: 'e2e_expire',
        password: 'ExpireOk!123',
        expectErrorAlert: true,
        skipIfNoExpiryColumn: true,
    },
];

/**
 * Test cases for reset token reuse
 */
export const resetTokenReuseData = [
    {
        description: 'reset token cannot be reused',
        usernamePrefix: 'e2e_rereset',
        oldPassword: 'OldP@ss!11',
        newPassword: 'BrandNew!22',
        secondPassword: 'Another!33',
        expectFirstResetSuccess: true,
        expectSecondResetFailure: true,
    },
];

/**
 * Test cases for unauthenticated redirect
 */
export const unauthenticatedRedirectData = [
    {
        description: 'redirects unauthenticated users to login',
        protectedUrl: '/users/dashboard',
        expectedRedirectUrl: /\/users\/login/,
        expectedHeading: /login/i,
    },
];
