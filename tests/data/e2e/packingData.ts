/**
 * Test data for packing list entity E2E tests
 * Data-driven test cases for packing list creation, validation, and management
 */

/**
 * Test cases for packing page access (authenticated)
 */
export const packingPageAccessAuthenticatedData = [
    {
        description: 'authenticated user can access packing list create page',
        targetUrl: '/packing/create',
        expectedUrl: /\/packing\/create/,
        expectedHeading: /create.*packing/i,
    },
];

/**
 * Test cases for packing page access (unauthenticated)
 */
export const packingPageAccessUnauthenticatedData = [
    {
        description: 'unauthenticated user cannot access packing create page',
        targetUrl: '/packing/create',
        expectedRedirectUrl: /\/users\/login/,
    },
];

/**
 * Test cases for packing dashboard empty state
 */
export const packingDashboardEmptyStateData = [
    {
        description: 'packing dashboard shows empty state for new user',
        accordionId: '#sec-pack',
        buttonText: /your packing lists/i,
        expectedEmptyText: /you don['']t have any packing/i,
    },
];

/**
 * Test cases for packing list creation
 */
export const packingCreationData = [
    {
        description: 'can create a new packing list with valid data',
        title: 'E2E Packing',
        items: [
            { name: 't_0', value: 'Tent' },
            { name: 'd_0', value: 'Two-person tent' },
        ],
        submitButtonText: /create.*list/i,
        expectedRedirectPattern: /\/(users\/dashboard|packing\/[\w-]*-[\w-]+)/,
        verifyTitleInPage: true,
    },
];

/**
 * Test cases for packing form validation
 */
export const packingValidationData = [
    {
        description: 'packing form validates required fields',
        titleFieldName: 'title',
        expectedRequiredAttribute: true,
        checkHtml5Validation: true,
    },
];
