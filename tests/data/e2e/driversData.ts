/**
 * Test data for drivers list entity E2E tests
 * Data-driven test cases for drivers list creation, validation, and management
 */

/**
 * Test cases for drivers page access (authenticated)
 */
export const driversPageAccessAuthenticatedData = [
    {
        description: 'authenticated user can access drivers list create page',
        targetUrl: '/drivers/create',
        expectedUrl: /\/drivers\/create/,
        expectedHeading: /create.*driver/i,
    },
];

/**
 * Test cases for drivers page access (unauthenticated)
 */
export const driversPageAccessUnauthenticatedData = [
    {
        description: 'unauthenticated user cannot access drivers create page',
        targetUrl: '/drivers/create',
        expectedRedirectUrl: /\/users\/login/,
    },
];

/**
 * Test cases for drivers dashboard empty state
 */
export const driversDashboardEmptyStateData = [
    {
        description: 'drivers dashboard shows empty state for new user',
        accordionId: '#sec-drivers',
        buttonText: /your drivers lists/i,
        expectedEmptyText: /you don['']t have any drivers/i,
    },
];

/**
 * Test cases for drivers list creation
 */
export const driversCreationData = [
    {
        description: 'can create a new drivers list with valid data',
        title: 'E2E Drivers',
        submitButtonText: /create.*list/i,
        expectedRedirectPattern: /\/(users\/dashboard|drivers\/[\w-]*-[\w-]+)/,
        verifyTitleInPage: true,
        requiresFormSubmit: true,
    },
];

/**
 * Test cases for drivers form validation
 */
export const driversValidationData = [
    {
        description: 'drivers form validates required fields',
        titleFieldName: 'title',
        expectedRequiredAttribute: true,
        checkHtml5Validation: true,
    },
];
