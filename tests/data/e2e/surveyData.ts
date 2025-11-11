/**
 * Test data for survey entity E2E tests
 * Data-driven test cases for survey creation, validation, and management
 */

import {
    generatePageAccessAuthenticatedData,
    generatePageAccessUnauthenticatedData,
    generateDashboardEmptyStateData,
    generateFormValidationData,
} from './entityData';

/**
 * Test cases for survey page access (authenticated)
 */
export const surveyPageAccessAuthenticatedData = generatePageAccessAuthenticatedData('survey');

/**
 * Test cases for survey page access (unauthenticated)
 */
export const surveyPageAccessUnauthenticatedData = generatePageAccessUnauthenticatedData('survey');

/**
 * Test cases for survey dashboard empty state
 */
export const surveyDashboardEmptyStateData = generateDashboardEmptyStateData('survey');

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
export const surveyValidationData = generateFormValidationData('survey');
