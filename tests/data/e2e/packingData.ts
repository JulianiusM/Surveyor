/**
 * Test data for packing list entity E2E tests
 * Data-driven test cases for packing list creation, validation, and management
 */

import {
    generatePageAccessAuthenticatedData,
    generatePageAccessUnauthenticatedData,
    generateDashboardEmptyStateData,
    generateFormValidationData,
} from './entityData';

/**
 * Test cases for packing page access (authenticated)
 */
export const packingPageAccessAuthenticatedData = generatePageAccessAuthenticatedData('packing');

/**
 * Test cases for packing page access (unauthenticated)
 */
export const packingPageAccessUnauthenticatedData = generatePageAccessUnauthenticatedData('packing');

/**
 * Test cases for packing dashboard empty state
 */
export const packingDashboardEmptyStateData = generateDashboardEmptyStateData('packing');

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
export const packingValidationData = generateFormValidationData('packing');
