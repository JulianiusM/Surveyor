/**
 * Test data for survey entity E2E tests
 * Data-driven test cases for survey creation, validation, and management
 */

/**
 * Test cases for survey page access (authenticated)
 */
export const surveyPageAccessAuthenticatedData = [
    {
        description: 'authenticated user can access survey create page',
        targetUrl: '/survey/create',
        expectedUrl: /\/survey\/create/,
        expectedHeading: /create.*survey/i,
    },
];

/**
 * Test cases for survey page access (unauthenticated)
 */
export const surveyPageAccessUnauthenticatedData = [
    {
        description: 'unauthenticated user cannot access survey create page',
        targetUrl: '/survey/create',
        expectedRedirectUrl: /\/users\/login/,
    },
];

/**
 * Test cases for survey dashboard empty state
 */
export const surveyDashboardEmptyStateData = [
    {
        description: 'survey dashboard shows empty state for new user',
        accordionId: '#sec-surveys',
        buttonText: /your surveys/i,
        expectedEmptyText: /you don['']t have any surveys/i,
    },
];

/**
 * Test cases for survey creation
 */
export const surveyCreationData = [
    {
        description: 'can create a new survey with valid data',
        title: 'E2E Survey',
        surveyDescription: 'Test survey description',
        submitButtonText: /create.*survey/i,
        expectedRedirectPattern: /\/(users\/dashboard|survey\/[\w-]*-[\w-]+)/,
        verifyTitleInPage: true,
    },
];

/**
 * Test cases for survey form validation
 */
export const surveyValidationData = [
    {
        description: 'survey form validates required fields',
        titleFieldName: 'title',
        expectedRequiredAttribute: true,
        checkHtml5Validation: true,
    },
];
