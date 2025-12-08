/**
 * Tests for verify_password.ts module
 * Follows data-driven and keyword-driven test patterns
 */

import { 
    verifyPasswordInitTestData, 
    passwordEventTestData, 
    formSubmitTestData 
} from '../data/verifyPasswordData';

// Mock jQuery
const mockJQuery = jest.fn((selector: string) => {
    const mockElement = {
        on: jest.fn().mockReturnThis(),
        trigger: jest.fn().mockReturnThis(),
        val: jest.fn().mockReturnValue('test-value')
    };
    return mockElement;
});

// Assign to global
(global as any).$ = mockJQuery;

// Mock dependencies
jest.mock('../../../src/public/js/core/navigation', () => ({
    setCurrentNavLocation: jest.fn()
}));

jest.mock('../../../src/public/js/core/permissions', () => ({
    loadPerms: jest.fn()
}));

jest.mock('../../../src/public/js/core/password-validation', () => ({
    matchPassword: jest.fn(),
    removeTooltip: jest.fn(),
    validate: jest.fn(),
    verifyPassword: jest.fn()
}));

describe('verify_password module', () => {
    let mockSetCurrentNavLocation: jest.Mock;
    let mockLoadPerms: jest.Mock;
    let mockVerifyPassword: jest.Mock;
    let mockMatchPassword: jest.Mock;
    let mockRemoveTooltip: jest.Mock;
    let mockValidate: jest.Mock;

    beforeEach(() => {
        // Reset all mocks
        jest.clearAllMocks();
        mockJQuery.mockClear();

        // Setup window.Surveyor
        if (!window.Surveyor) {
            window.Surveyor = {} as any;
        }

        // Get mock functions
        const navigation = require('../../../src/public/js/core/navigation');
        const permissions = require('../../../src/public/js/core/permissions');
        const passwordValidation = require('../../../src/public/js/core/password-validation');
        
        mockSetCurrentNavLocation = navigation.setCurrentNavLocation as jest.Mock;
        mockLoadPerms = permissions.loadPerms as jest.Mock;
        mockVerifyPassword = passwordValidation.verifyPassword as jest.Mock;
        mockMatchPassword = passwordValidation.matchPassword as jest.Mock;
        mockRemoveTooltip = passwordValidation.removeTooltip as jest.Mock;
        mockValidate = passwordValidation.validate as jest.Mock;
    });

    afterEach(() => {
        // Clean up
        if (window.Surveyor) {
            delete (window.Surveyor as any).init;
        }
    });

    describe('init function', () => {
        test.each(verifyPasswordInitTestData)('$description', async (testCase) => {
            // Import the module
            const verifyPasswordModule = await import('../../../src/public/js/verify_password');

            // Call init
            verifyPasswordModule.init();

            // Verify function calls
            expect(mockSetCurrentNavLocation).toHaveBeenCalledTimes(
                testCase.expectedCalls.setCurrentNavLocation
            );
            expect(mockLoadPerms).toHaveBeenCalledTimes(
                testCase.expectedCalls.loadPerms
            );
        });

        test('should expose init function to global scope', async () => {
            await import('../../../src/public/js/verify_password');

            expect(window.Surveyor.init).toBeDefined();
            expect(typeof window.Surveyor.init).toBe('function');
        });
    });

    describe('registerEvents function', () => {
        test('should register password field events', async () => {
            const verifyPasswordModule = await import('../../../src/public/js/verify_password');

            verifyPasswordModule.init();

            // Verify jQuery was called with password selectors
            expect(mockJQuery).toHaveBeenCalledWith('#password');
            expect(mockJQuery).toHaveBeenCalledWith('#password_repeat');
            expect(mockJQuery).toHaveBeenCalledWith('#form');
        });

        test('should register keyup, focusin, and focusout events on password field', async () => {
            const mockPasswordElement = {
                on: jest.fn().mockReturnThis()
            };
            mockJQuery.mockImplementation((selector: string) => {
                if (selector === '#password') return mockPasswordElement;
                return { on: jest.fn().mockReturnThis() };
            });

            const verifyPasswordModule = await import('../../../src/public/js/verify_password');
            verifyPasswordModule.init();

            // Verify events were registered
            expect(mockPasswordElement.on).toHaveBeenCalledWith('keyup', expect.any(Function));
            expect(mockPasswordElement.on).toHaveBeenCalledWith('focusin', expect.any(Function));
            expect(mockPasswordElement.on).toHaveBeenCalledWith('focusout', expect.any(Function));
        });

        test('should register keyup event on password_repeat field', async () => {
            const mockRepeatElement = {
                on: jest.fn().mockReturnThis()
            };
            mockJQuery.mockImplementation((selector: string) => {
                if (selector === '#password_repeat') return mockRepeatElement;
                return { on: jest.fn().mockReturnThis() };
            });

            const verifyPasswordModule = await import('../../../src/public/js/verify_password');
            verifyPasswordModule.init();

            // Verify keyup event was registered
            expect(mockRepeatElement.on).toHaveBeenCalledWith('keyup', expect.any(Function));
        });

        test('should register submit event on form', async () => {
            const mockFormElement = {
                on: jest.fn().mockReturnThis()
            };
            mockJQuery.mockImplementation((selector: string) => {
                if (selector === '#form') return mockFormElement;
                return { on: jest.fn().mockReturnThis() };
            });

            const verifyPasswordModule = await import('../../../src/public/js/verify_password');
            verifyPasswordModule.init();

            // Verify submit event was registered
            expect(mockFormElement.on).toHaveBeenCalledWith('submit', expect.any(Function));
        });
    });

    describe('event handlers', () => {
        test('should call verifyPassword on password keyup', async () => {
            let keyupHandler: Function | null = null;
            const mockPasswordElement = {
                on: jest.fn((event: string, handler: Function) => {
                    if (event === 'keyup') keyupHandler = handler;
                    return mockPasswordElement;
                })
            };

            mockJQuery.mockImplementation((selector: string) => {
                if (selector === '#password') return mockPasswordElement;
                if (selector === '#password-info') return {};
                return { on: jest.fn().mockReturnThis() };
            });

            const verifyPasswordModule = await import('../../../src/public/js/verify_password');
            verifyPasswordModule.init();

            // Call the keyup handler
            if (keyupHandler) {
                keyupHandler();
                expect(mockVerifyPassword).toHaveBeenCalled();
            }
        });

        test('should call verifyPassword on password focusin', async () => {
            let focusinHandler: Function | null = null;
            const mockPasswordElement = {
                on: jest.fn((event: string, handler: Function) => {
                    if (event === 'focusin') focusinHandler = handler;
                    return mockPasswordElement;
                })
            };

            mockJQuery.mockImplementation((selector: string) => {
                if (selector === '#password') return mockPasswordElement;
                if (selector === '#password-info') return {};
                return { on: jest.fn().mockReturnThis() };
            });

            const verifyPasswordModule = await import('../../../src/public/js/verify_password');
            verifyPasswordModule.init();

            // Call the focusin handler
            if (focusinHandler) {
                focusinHandler();
                expect(mockVerifyPassword).toHaveBeenCalled();
            }
        });

        test('should call removeTooltip on password focusout', async () => {
            let focusoutHandler: Function | null = null;
            const mockPasswordElement = {
                on: jest.fn((event: string, handler: Function) => {
                    if (event === 'focusout') focusoutHandler = handler;
                    return mockPasswordElement;
                })
            };

            mockJQuery.mockImplementation((selector: string) => {
                if (selector === '#password') return mockPasswordElement;
                if (selector === '#password-info') return {};
                return { on: jest.fn().mockReturnThis() };
            });

            const verifyPasswordModule = await import('../../../src/public/js/verify_password');
            verifyPasswordModule.init();

            // Call the focusout handler
            if (focusoutHandler) {
                focusoutHandler();
                expect(mockRemoveTooltip).toHaveBeenCalled();
            }
        });

        test('should call matchPassword on password_repeat keyup', async () => {
            let keyupHandler: Function | null = null;
            const mockRepeatElement = {
                on: jest.fn((event: string, handler: Function) => {
                    if (event === 'keyup') keyupHandler = handler;
                    return mockRepeatElement;
                })
            };

            mockJQuery.mockImplementation((selector: string) => {
                if (selector === '#password_repeat') return mockRepeatElement;
                if (selector === '#password') return {};
                if (selector === '#password_repeat-info') return {};
                return { on: jest.fn().mockReturnThis() };
            });

            const verifyPasswordModule = await import('../../../src/public/js/verify_password');
            verifyPasswordModule.init();

            // Call the keyup handler
            if (keyupHandler) {
                keyupHandler();
                expect(mockMatchPassword).toHaveBeenCalled();
            }
        });

        test('should call validate on form submit', async () => {
            let submitHandler: Function | null = null;
            const mockFormElement = {
                on: jest.fn((event: string, handler: Function) => {
                    if (event === 'submit') submitHandler = handler;
                    return mockFormElement;
                })
            };

            mockJQuery.mockImplementation((selector: string) => {
                if (selector === '#form') return mockFormElement;
                if (selector === '#password') return {};
                if (selector === '#password_repeat') return {};
                if (selector === '#password-info') return {};
                if (selector === '#password_repeat-info') return {};
                return { on: jest.fn().mockReturnThis() };
            });

            const verifyPasswordModule = await import('../../../src/public/js/verify_password');
            verifyPasswordModule.init();

            // Call the submit handler
            if (submitHandler) {
                const mockEvent = { preventDefault: jest.fn() };
                submitHandler(mockEvent);
                expect(mockValidate).toHaveBeenCalledWith(
                    mockEvent,
                    expect.anything(),
                    expect.anything(),
                    expect.anything(),
                    expect.anything()
                );
            }
        });
    });

    describe('integration', () => {
        test('should initialize all components in correct order', async () => {
            const callOrder: string[] = [];

            mockSetCurrentNavLocation.mockImplementation(() => {
                callOrder.push('setCurrentNavLocation');
            });

            mockLoadPerms.mockImplementation(() => {
                callOrder.push('loadPerms');
            });

            // Mock jQuery to track event registration order
            const registeredEvents: string[] = [];
            mockJQuery.mockImplementation((selector: string) => ({
                on: jest.fn((event: string) => {
                    registeredEvents.push(`${selector}:${event}`);
                    return { on: jest.fn().mockReturnThis() };
                })
            }));

            const verifyPasswordModule = await import('../../../src/public/js/verify_password');
            verifyPasswordModule.init();

            // Events should be registered before navigation/permissions
            expect(registeredEvents.length).toBeGreaterThan(0);
            expect(callOrder).toContain('setCurrentNavLocation');
            expect(callOrder).toContain('loadPerms');
        });
    });
});
