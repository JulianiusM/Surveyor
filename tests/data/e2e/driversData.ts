/**
 * Test data for drivers list entity E2E tests
 * Data-driven test cases for drivers list creation, validation, and management
 */

import {
    generatePageAccessData,
    generateDashboardEmptyStateData,
    generateFormValidationData,
    entityConfigs,
} from './entityData';

/**
 * Test cases for drivers page access (authenticated and unauthenticated)
 */
export const driversPageAccessData = generatePageAccessData('drivers');

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
        createUrl: entityConfigs.drivers.urlPath,
        title: 'E2E Drivers',
        submitButtonText: /create.*list/i,
        expectedRedirectPattern: /\/(users\/dashboard|drivers\/[\w-]*-[\w-]+)/,
        verifyTitleInPage: true,
        titleSelector: 'h1',
        requiresFormSubmit: true,
    },
];

/**
 * Test cases for drivers form validation
 */
export const driversValidationData = generateFormValidationData('drivers');
