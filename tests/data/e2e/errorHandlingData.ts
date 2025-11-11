/**
 * Test data for error handling and validation E2E tests
 * Data-driven test cases for error scenarios, validation, and edge cases
 */

/**
 * Test cases for 404 errors
 */
export const notFoundErrorData = [
    {
        description: 'shows 404 error page for non-existent routes',
        url: '/this-route-does-not-exist',
        expectedBodyText: /404|not found|error/i,
    },
];

/**
 * Test cases for form validation (login and registration)
 */
export const formValidationData = [
    {
        description: 'login form shows validation errors for empty fields',
        formType: 'login',
        url: '/users/login',
        submitButton: /login/i,
        fieldToCheck: 'username',
        expectedRequiredAttribute: true,
    },
    {
        description: 'registration form validates password matching',
        formType: 'registration',
        url: '/users/register',
        usernamePrefix: 'testuser',
        password: 'Password123!',
        passwordRepeat: 'DifferentPassword123!',
        submitButton: /register/i,
        expectedErrorText: /passwords do not match/i,
    },
];

/**
 * Test cases for invalid tokens
 */
export const invalidTokenData = [
    {
        description: 'shows error for invalid activation token',
        url: '/users/activate/invalid-token-12345',
        expectedAlertSelector: '.alert-danger, .alert, [role="alert"]',
    },
    {
        description: 'shows error for invalid password reset token',
        url: '/users/reset-password/invalid-token-12345',
        expectedAlertSelector: '.alert-danger, .alert, [role="alert"]',
    },
];

/**
 * Test cases for route access control (authorized and unauthorized)
 */
export const routeAccessData = [
    {
        description: 'redirects to login when accessing protected route without auth',
        isAuthenticated: false,
        url: '/survey/create',
        expectedRedirectUrl: /\/users\/login/,
    },
];

/**
 * Test cases for network error handling
 */
export const networkErrorData = [
    {
        description: 'handles network errors gracefully',
        targetUrl: '/users/dashboard',
        setOffline: true,
        expectBodyAttached: true,
    },
];

/**
 * Test cases for server error simulation
 */
export const serverErrorData = [
    {
        description: 'handles server errors during login',
        url: '/users/login',
        username: 'nonexistent_user_12345',
        password: 'wrongpassword',
        submitButton: /login/i,
        expectedUrl: /\/users\/login/,
        expectedAlertSelector: '.alert, .alert-danger, .invalid-feedback',
    },
];

/**
 * Test cases for page functionality after navigation
 */
export const pageFunctionalityData = [
    {
        description: 'page remains functional after navigation',
        pages: [
            { url: '/', expectBodyAttached: true },
            { url: '/users/login', expectButton: /login/i },
            { url: '/users/register', expectButton: /register/i },
            { url: '/users/forgot-password', expectButton: /send reset link/i },
        ],
    },
];

/**
 * Test cases for console errors
 */
export const consoleErrorData = [
    {
        description: 'no critical console errors on main pages',
        pages: ['/', '/users/login', '/users/register'],
        filterErrors: [
            'smtp.example.com',
            'favicon',
            'ENOTFOUND',
            'ERR_NAME_NOT_RESOLVED',
            'net::',
        ],
    },
];

/**
 * Test cases for entity form validation
 */
export const entityFormValidationData = [
    {
        description: 'survey form shows validation errors for empty required fields',
        url: '/survey/create',
        expectedHeading: /create.*survey/i,
        titleField: 'title',
        expectedRequiredAttribute: true,
    },
];

/**
 * Test cases for non-existent resources
 */
export const nonExistentResourceData = [
    {
        description: 'shows error for accessing non-existent survey',
        url: '/survey/999999',
        expectedBodyText: /404|not found|error/i,
    },
];

/**
 * Test cases for protected routes
 */
export const protectedRoutesData = [
    {
        description: 'all protected routes redirect unauthenticated users',
        routes: [
            '/survey/create',
            '/packing/create',
            '/activity/create',
            '/drivers/create',
            '/users/dashboard',
        ],
        expectedRedirectUrl: /\/users\/login/,
    },
];
