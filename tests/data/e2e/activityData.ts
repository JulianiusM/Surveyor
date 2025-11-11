/**
 * Test data for activity plan entity E2E tests
 * Data-driven test cases for activity plan creation, validation, and management
 */

/**
 * Test cases for activity page access (authenticated)
 */
export const activityPageAccessAuthenticatedData = [
    {
        description: 'authenticated user can access activity plan create page',
        targetUrl: '/activity/create',
        expectedUrl: /\/activity\/create/,
        expectedHeading: /create.*activity/i,
    },
];

/**
 * Test cases for activity page access (unauthenticated)
 */
export const activityPageAccessUnauthenticatedData = [
    {
        description: 'unauthenticated user cannot access activity create page',
        targetUrl: '/activity/create',
        expectedRedirectUrl: /\/users\/login/,
    },
];

/**
 * Test cases for activity dashboard empty state
 */
export const activityDashboardEmptyStateData = [
    {
        description: 'activity dashboard shows empty state for new user',
        accordionId: '#sec-activity',
        buttonText: /your activity plans/i,
        expectedEmptyText: /you don['']t have any activity/i,
    },
];

/**
 * Test cases for activity plan creation
 */
export const activityCreationData = [
    {
        description: 'can create a new activity plan with valid data',
        title: 'E2E Activity',
        startDate: '2025-01-01',
        endDate: '2025-01-02',
        slot: {
            day: '2025-01-01',
            pos: 0,
            title: 'Setup',
            description: '',
            maxAssignees: 1,
        },
        submitButtonText: /create.*plan/i,
        expectedRedirectPattern: /\/(users\/dashboard|activity\/[\w-]*-[\w-]+)/,
        verifyTitleInPage: true,
    },
];

/**
 * Test cases for activity form validation
 */
export const activityValidationData = [
    {
        description: 'activity form validates required fields',
        titleFieldName: 'title',
        expectedRequiredAttribute: true,
        checkHtml5Validation: true,
    },
];
