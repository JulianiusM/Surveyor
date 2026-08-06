/**
 * Test data for packing list entity E2E tests
 * Data-driven test cases for packing list creation, validation, and management
 */

import {
    generatePageAccessData,
    generateDashboardEmptyStateData,
    generateFormValidationData,
    entityConfigs,
} from './entityData';

/**
 * Test cases for packing page access (authenticated and unauthenticated)
 */
export const packingPageAccessData = generatePageAccessData('packing');

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
        createUrl: entityConfigs.packing.urlPath,
        title: 'E2E Packing',
        items: [
            { name: 't_0', value: 'Tent' },
            { name: 'd_0', value: 'Two-person tent' },
        ],
        submitButtonText: /create.*list/i,
        expectedRedirectPattern: /\/(users\/dashboard|packing\/[\w-]*-[\w-]+)/,
        verifyTitleInPage: true,
        titleSelector: 'h1',
    },
];

/**
 * Test cases for packing form validation
 */
export const packingValidationData = generateFormValidationData('packing');
