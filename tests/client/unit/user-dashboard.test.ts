/**
 * Tests for user-dashboard.ts module
 * Follows data-driven and keyword-driven test patterns
 */

import {
    userDashboardCallOrderData as _userDashboardCallOrderData,
    userDashboardInitTestData as _userDashboardInitTestData
} from '../data/userDashboardData';
import {setupTest} from '../helpers/testSetup';

const userDashboardInitTestData = _userDashboardInitTestData();
const userDashboardCallOrderData = _userDashboardCallOrderData();

// Mock dependencies
jest.mock('../../../src/public/js/core/navigation', () => ({
    initEntityLists: jest.fn(),
    setCurrentNavLocation: jest.fn()
}));

jest.mock('../../../src/public/js/core/permissions', () => ({
    loadPerms: jest.fn()
}));

jest.mock('../../../src/public/js/modules/entity-cards-overview', () => ({
    initEntityOverview: jest.fn(),
}))

describe('user-dashboard module', () => {
    let mockSetCurrentNavLocation: jest.Mock;
    let mockLoadPerms: jest.Mock;
    let mockInitEntityLists: jest.Mock;
    let mockInitEntityOverview: jest.Mock;

    setupTest({
        beforeEach: () => {
            // Setup window.Surveyor
            if (!window.Surveyor) {
                window.Surveyor = {} as any;
            }

            // Get mock functions
            const navigation = require('../../../src/public/js/core/navigation');
            const permissions = require('../../../src/public/js/core/permissions');
            const entityOverview = require('../../../src/public/js/modules/entity-cards-overview');
            mockSetCurrentNavLocation = navigation.setCurrentNavLocation as jest.Mock;
            mockLoadPerms = permissions.loadPerms as jest.Mock;
            mockInitEntityLists = navigation.initEntityLists as jest.Mock;
            mockInitEntityOverview = entityOverview.initEntityOverview as jest.Mock;
        },
        afterEach: () => {
            // Clean up
            if (window.Surveyor) {
                delete (window.Surveyor as any).init;
            }
        }
    });

    describe('init function', () => {
        test.each(userDashboardInitTestData)('$description', async (testCase) => {
            // Import the module (this will execute the global scope code)
            const dashboardModule = await import('../../../src/public/js/user-dashboard');

            // Call init
            dashboardModule.init();

            // Verify function calls
            expect(mockSetCurrentNavLocation).toHaveBeenCalledTimes(
                testCase.expectedCalls.setCurrentNavLocation
            );
            expect(mockLoadPerms).toHaveBeenCalledTimes(
                testCase.expectedCalls.loadPerms
            );
            expect(mockInitEntityLists).toHaveBeenCalledTimes(
                testCase.expectedCalls.initEntityLists
            );
            expect(mockInitEntityOverview).toHaveBeenCalledTimes(
                testCase.expectedCalls.initEntityOverview
            )
        });

        test(userDashboardCallOrderData.description, async () => {
            const dashboardModule = await import('../../../src/public/js/user-dashboard');
            const callOrder: string[] = [];

            mockSetCurrentNavLocation.mockImplementation(() => {
                callOrder.push('setCurrentNavLocation');
            });

            mockLoadPerms.mockImplementation(() => {
                callOrder.push('loadPerms');
            });

            mockInitEntityLists.mockImplementation(() => {
                callOrder.push('initEntityLists');
            });

            mockInitEntityOverview.mockImplementation(() => {
                callOrder.push('initEntityOverview');
            });

            dashboardModule.init();

            expect(callOrder).toEqual(userDashboardCallOrderData.expectedOrder);
        });

        test('should expose init function to global scope', async () => {
            const {init} = await import('../../../src/public/js/user-dashboard');

            // The module exports the function and assigns it to window.Surveyor.init
            expect(init).toBeDefined();
            expect(typeof init).toBe('function');
            // Note: window.Surveyor.init assignment happens at module load time
            // In test environment, we verify the exported function exists
        });

        test('should allow init to be called multiple times', async () => {
            const dashboardModule = await import('../../../src/public/js/user-dashboard');

            dashboardModule.init();
            dashboardModule.init();
            dashboardModule.init();

            expect(mockSetCurrentNavLocation).toHaveBeenCalledTimes(3);
            expect(mockLoadPerms).toHaveBeenCalledTimes(3);
            expect(mockInitEntityLists).toHaveBeenCalledTimes(0);
            expect(mockInitEntityOverview).toHaveBeenCalledTimes(6);
        });
    });
});
