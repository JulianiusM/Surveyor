/**
 * Test data for drivers list entity E2E tests
 * Data-driven test cases for drivers list creation, validation, and management
 */

import {
    generatePageAccessAuthenticatedData,
    generatePageAccessUnauthenticatedData,
    generateDashboardEmptyStateData,
    generateFormValidationData,
} from './entityData';

/**
 * Test cases for drivers page access (authenticated)
 */
export const driversPageAccessAuthenticatedData = generatePageAccessAuthenticatedData('drivers');

/**
 * Test cases for drivers page access (unauthenticated)
 */
export const driversPageAccessUnauthenticatedData = generatePageAccessUnauthenticatedData('drivers');

/**
 * Test cases for drivers dashboard empty state
 */
export const driversDashboardEmptyStateData = generateDashboardEmptyStateData('drivers');

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
export const driversValidationData = generateFormValidationData('drivers');
