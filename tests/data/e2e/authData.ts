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
 * Common URLs used across auth tests
 */
export const authUrls = {
    login: '/users/login',
    register: '/users/register',
    dashboard: '/users/dashboard',
    forgotPassword: '/users/forgot-password',
    logout: '/users/logout',
};

/**
 * Form field names
 */
export const formFields = {
    username: 'username',
    displayname: 'displayname',
    email: 'email',
    password: 'password',
    passwordRepeat: 'password_repeat',
};

/**
 * Common success messages
 */
export const successMessages = {
    accountActivated: 'Your account has been activated',
    accountRegistered: 'Account successfully registered',
    resetLinkSent: 'link has been sent',
};

/**
 * Common selectors
 */
export const selectors = {
    alertSuccess: '.alert, .alert-success',
    alertDanger: '.alert, .alert-danger, [role="alert"]',
    alertAny: '.alert',
    oidcLink: 'a[href*="openid"]',
};

/**
 * Test cases for login page rendering
 */
export const loginPageRenderData = {
    description: 'renders login form with all expected elements',
    url: authUrls.login,
    elements: [
        { type: 'heading', value: /login/i },
        { type: 'input', value: formFields.username },
        { type: 'input', value: formFields.password },
        { type: 'button', value: /login/i },
    ],
};

/**
 * Test cases for login attempts (both success and failure)
 */
export const loginData = [
    {
        description: 'rejects wrong credentials',
        url: authUrls.login,
        username: 'unknown_user',
        password: 'totally-wrong',
        shouldSucceed: false,
        expectedUrl: /\/users\/login/,
        expectedAlert: true,
    },
    {
        description: 'logs in with valid credentials and shows dashboard',
        url: authUrls.login,
        username: testCredentials.username,
        password: testCredentials.password,
        shouldSucceed: true,
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
 * Test cases for user registration (success and validation errors)
 */
export const registrationData = [
    {
        description: 'registers a user with valid data',
        registerUrl: authUrls.register,
        generateUsername: true,
        usernamePrefix: 'e2e_reg',
        password: 'RegTest!123',
        useEmailFromUsername: true,
        shouldSucceed: true,
        expectedSuccessMessage: successMessages.accountRegistered,
        formFields,
    },
    {
        description: 'rejects duplicate username during registration',
        registerUrl: authUrls.register,
        usernamePrefix: 'e2e_dup',
        password: 'DupOk!123',
        shouldSucceed: false,
        errorType: 'duplicate',
        expectedUrl: /\/users\/register/,
        expectErrorAlert: true,
        formFields,
    },
    {
        description: 'rejects weak password on registration',
        registerUrl: authUrls.register,
        usernamePrefix: 'e2e_weak',
        password: '12345',
        shouldSucceed: false,
        errorType: 'weakPassword',
        expectedUrl: /\/users\/register/,
        expectValidationMessage: true,
        formFields,
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
        activationMessage: successMessages.accountActivated,
        loginUrl: authUrls.login,
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
        forgotPasswordUrl: authUrls.forgotPassword,
        resetLinkSentMessage: successMessages.resetLinkSent,
        resetPageHeading: /reset your password/i,
        activationMessage: successMessages.accountActivated,
        loginUrl: authUrls.login,
        dashboardUrl: /\/users\/dashboard/,
        formFields,
    },
];

/**
 * Test cases for OIDC button visibility (enabled and disabled states)
 */
export const oidcButtonData = [
    {
        description: 'hides OIDC login button when OIDC is disabled',
        loginUrl: authUrls.login,
        buttonName: /login.*openid/i,
        oidcEnabled: false,
        shouldBeVisible: false,
        oidcSelector: selectors.oidcLink,
    },
];

/**
 * Test cases for reset tokens (valid and expired)
 */
export const resetTokenData = [
    {
        description: 'expired reset token is rejected (if supported by schema)',
        usernamePrefix: 'e2e_expire',
        password: 'ExpireOk!123',
        isExpired: true,
        expectErrorAlert: true,
        skipIfNoExpiryColumn: true,
        activationMessage: successMessages.accountActivated,
        forgotPasswordUrl: authUrls.forgotPassword,
        successSelector: selectors.alertSuccess,
        errorSelector: selectors.alertDanger,
    },
];

/**
 * Test cases for activation tokens (valid and invalid)
 */
export const activationTokenData = [
    {
        description: 'invalid activation token shows an error',
        token: 'THIS-TOKEN-DOES-NOT-EXIST',
        isValid: false,
        expectErrorAlert: true,
        errorSelector: selectors.alertDanger,
    },
];

/**
 * Test cases for token reuse (activation and reset tokens)
 */
export const tokenReuseData = [
    {
        description: 'activation token cannot be reused',
        tokenType: 'activation',
        usernamePrefix: 'e2e_react',
        password: 'ActOnce!1',
        expectFirstUseSuccess: true,
        expectSecondUseError: true,
        successSelector: selectors.alertSuccess,
        errorSelector: selectors.alertDanger,
    },
    {
        description: 'reset token cannot be reused',
        tokenType: 'reset',
        usernamePrefix: 'e2e_rereset',
        oldPassword: 'OldP@ss!11',
        newPassword: 'BrandNew!22',
        secondPassword: 'Another!33',
        expectFirstUseSuccess: true,
        expectSecondUseError: true,
        activationMessage: successMessages.accountActivated,
        forgotPasswordUrl: authUrls.forgotPassword,
        successSelector: selectors.alertSuccess,
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
