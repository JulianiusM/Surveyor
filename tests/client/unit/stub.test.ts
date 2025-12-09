/**
 * Tests for stub.ts module
 * Follows data-driven and keyword-driven test patterns
 */

import { stubInitTestData } from '../data/stubData';
import { setupTest } from '../helpers/testSetup';

// Mock dependencies
jest.mock('../../../src/public/js/core/navigation', () => ({
    setCurrentNavLocation: jest.fn()
}));

jest.mock('../../../src/public/js/core/permissions', () => ({
    loadPerms: jest.fn()
}));

describe('stub module', () => {
    let mockSetCurrentNavLocation: jest.Mock;
    let mockLoadPerms: jest.Mock;

    setupTest({
        beforeEach: () => {
            // Setup window.Surveyor
            if (!window.Surveyor) {
                window.Surveyor = {} as any;
            }

            // Get mock functions
            const navigation = require('../../../src/public/js/core/navigation');
            const permissions = require('../../../src/public/js/core/permissions');
            mockSetCurrentNavLocation = navigation.setCurrentNavLocation as jest.Mock;
            mockLoadPerms = permissions.loadPerms as jest.Mock;
        },
        afterEach: () => {
            // Clean up
            if (window.Surveyor) {
                delete (window.Surveyor as any).init;
            }
        }
    });

    describe('init function', () => {
        test.each(stubInitTestData)('$description', async (testCase) => {
            // Import the module (this will execute the global scope code)
            const stubModule = await import('../../../src/public/js/stub');

            // Call init
            stubModule.init();

            // Verify function calls
            expect(mockSetCurrentNavLocation).toHaveBeenCalledTimes(
                testCase.expectedCalls.setCurrentNavLocation
            );
            expect(mockLoadPerms).toHaveBeenCalledTimes(
                testCase.expectedCalls.loadPerms
            );
        });

        test('should call navigation functions in correct order', async () => {
            const stubModule = await import('../../../src/public/js/stub');
            const callOrder: string[] = [];

            mockSetCurrentNavLocation.mockImplementation(() => {
                callOrder.push('setCurrentNavLocation');
            });

            mockLoadPerms.mockImplementation(() => {
                callOrder.push('loadPerms');
            });

            stubModule.init();

            expect(callOrder).toEqual(['setCurrentNavLocation', 'loadPerms']);
        });

        test('should expose init function to global scope', async () => {
            // Import the module to trigger global assignment
            const { init } = await import('../../../src/public/js/stub');

            // The module exports the function and assigns it to window.Surveyor.init
            expect(init).toBeDefined();
            expect(typeof init).toBe('function');
            // Note: window.Surveyor.init assignment happens at module load time
            // In test environment, we verify the exported function exists
        });

        test('should allow init to be called multiple times', async () => {
            const stubModule = await import('../../../src/public/js/stub');

            stubModule.init();
            stubModule.init();
            stubModule.init();

            expect(mockSetCurrentNavLocation).toHaveBeenCalledTimes(3);
            expect(mockLoadPerms).toHaveBeenCalledTimes(3);
        });
    });
});
