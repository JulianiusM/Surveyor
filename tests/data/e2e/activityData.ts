/**
 * Test data for activity plan entity E2E tests
 * Data-driven test cases for activity plan creation, validation, and management
 */

import {
    generatePageAccessAuthenticatedData,
    generatePageAccessUnauthenticatedData,
    generateDashboardEmptyStateData,
    generateFormValidationData,
} from './entityData';

/**
 * Test cases for activity page access (authenticated)
 */
export const activityPageAccessAuthenticatedData = generatePageAccessAuthenticatedData('activity');

/**
 * Test cases for activity page access (unauthenticated)
 */
export const activityPageAccessUnauthenticatedData = generatePageAccessUnauthenticatedData('activity');

/**
 * Test cases for activity dashboard empty state
 */
export const activityDashboardEmptyStateData = generateDashboardEmptyStateData('activity');

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
export const activityValidationData = generateFormValidationData('activity');
