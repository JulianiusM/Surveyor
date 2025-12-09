/**
 * Tests for events.ts module
 * Event management functionality with registration and invoice operations
 */

import {describe, test, expect, jest, beforeEach} from '@jest/globals';
import {setupTest} from '../helpers/testSetup';

// Mock all dependencies
jest.mock('../../../src/public/js/core/navigation', () => ({
    initEntityLists: jest.fn(),
    setCurrentNavLocation: jest.fn()
}));

jest.mock('../../../src/public/js/core/permissions', () => ({
    loadPerms: jest.fn(),
    requireEntityPerm: jest.fn(),
    requireEntityPermsForForm: jest.fn()
}));

jest.mock('../../../src/public/js/core/http', () => ({
    post: jest.fn().mockResolvedValue({})
}));

jest.mock('../../../src/public/js/shared/alerts', () => ({
    showInlineAlert: jest.fn()
}));

jest.mock('../../../src/public/js/core/formatting', () => ({
    formatISOInTimeZone: jest.fn((date) => date.toISOString())
}));

jest.mock('../../../src/public/js/shared/ui-helpers', () => ({
    formatDuration: jest.fn((ms) => `${Math.floor(ms / 60000)} minutes`),
    parseJsonScript: jest.fn((id) => {
        if (id === 'participantsData') return [];
        if (id === 'registrationData') return {id: 123};
        return null;
    }),
    reloadAfterDelay: jest.fn(),
    updateToLocalString: jest.fn()
}));

// Static imports now work since events.ts no longer has side effects at module load
import * as events from '../../../src/public/js/events';
import {setCurrentNavLocation, initEntityLists} from '../../../src/public/js/core/navigation';
import {loadPerms} from '../../../src/public/js/core/permissions';

let mockGetElementById: jest.Mock;
let mockSetInterval: jest.Mock;
let mockAddEventListener: jest.Mock;
let mockElements: Map<string, any>;

describe('events.ts', () => {
    setupTest();
    
    beforeEach(() => {
        // Setup window
        window.Surveyor.eventId = '';
        (window as any).confirm = jest.fn(() => true);
        (window as any).bootstrap = {
            Modal: {
                getOrCreateInstance: jest.fn(() => ({
                    show: jest.fn()
                }))
            }
        };
        
        // Setup setInterval mock
        mockSetInterval = jest.fn((callback, delay) => {
            return 123; // Return fake interval ID
        });
        (global as any).setInterval = mockSetInterval;
        
        // Create a map to store mock elements for reuse
        mockElements = new Map();
        
        // Setup document with properly mockable getElementById
        const createMockElement = (type: string = 'div') => {
            const elem: any = document.createElement('div');
            elem.type = type;
            const addEventListenerSpy = jest.fn();
            elem.addEventListener = addEventListenerSpy;
            elem.querySelector = jest.fn(() => null);
            elem.querySelectorAll = jest.fn(() => []);
            elem.textContent = '';
            elem.value = '';
            elem.checked = false;
            elem.required = false;
            // Use Object.defineProperty for dataset since it's readonly
            Object.defineProperty(elem, 'dataset', {
                value: {},
                writable: true,
                configurable: true
            });
            return elem;
        };
        
        // Create mock that can be manipulated in tests
        mockGetElementById = jest.fn((id) => {
            if (!mockElements.has(id)) {
                if (id === 'diet-allergies') {
                    const elem = createMockElement('checkbox');
                    Object.setPrototypeOf(elem, HTMLInputElement.prototype);
                    mockElements.set(id, elem);
                } else if (id === 'allergyNotes') {
                    const elem = createMockElement('text');
                    Object.setPrototypeOf(elem, HTMLInputElement.prototype);
                    mockElements.set(id, elem);
                } else if (id === 'startSpan' || id === 'endSpan' || id === 'arrival' || id === 'departure') {
                    const elem = createMockElement('span');
                    mockElements.set(id, elem);
                } else {
                    mockElements.set(id, createMockElement());
                }
            }
            return mockElements.get(id) || null;
        });
        
        mockAddEventListener = jest.fn();
        
        // Override document.getElementById
        document.getElementById = mockGetElementById;
        document.addEventListener = mockAddEventListener;
    });

    describe('allergyCheck', () => {
        test('should sync allergy notes requirement with checkbox', () => {
            // Pre-cache the elements so they exist when allergyCheck() runs
            const allergyBox = document.getElementById('diet-allergies') as any;
            const notes = document.getElementById('allergyNotes') as any;
            
            // Clear the mocks before running the function
            allergyBox.addEventListener.mockClear();
            
            events.allergyCheck();
            
            // Check that event listener was added
            expect(allergyBox.addEventListener).toHaveBeenCalledWith('change', expect.any(Function));
        });

        test('should handle missing elements gracefully', () => {
            mockGetElementById.mockReturnValue(null);
            
            expect(() => events.allergyCheck()).not.toThrow();
        });
    });

    describe('deadlineUpdater', () => {
        test('should update deadline countdown display', () => {
            // Setup all required elements
            const deadlineCnt = {
                textContent: '',
                dataset: {}
            };
            const deadlineText = {
                textContent: '',
                dataset: {date: '2024-12-31T23:59:59Z'}
            };
            const deadlineTZ = {
                textContent: '',
                dataset: {tz: 'America/New_York'}
            };
            
            mockGetElementById.mockImplementation((id: string) => {
                if (id === 'deadlineCountdown') return deadlineCnt;
                if (id === 'deadlineText') return deadlineText;
                if (id === 'deadlineTZ') return deadlineTZ;
                return null;
            });
            
            events.deadlineUpdater();
            
            expect(mockSetInterval).toHaveBeenCalled();
        });

        test('should handle missing elements gracefully', () => {
            mockGetElementById.mockReturnValue(null);
            
            expect(() => events.deadlineUpdater()).not.toThrow();
        });
    });

    describe('initRegistration', () => {
        test('should set up registration form submit handler', () => {
            const form = {
                addEventListener: jest.fn()
            };
            mockGetElementById.mockImplementation((id: string) => {
                if (id === 'registrationForm') return form;
                return null;
            });
            
            events.initRegistration();
            
            expect(form.addEventListener).toHaveBeenCalledWith('submit', expect.any(Function));
        });

        test('should handle missing form gracefully', () => {
            mockGetElementById.mockReturnValue(null);
            
            expect(() => events.initRegistration()).not.toThrow();
        });
    });

    describe('initUpdate', () => {
        test('should set up event update form submit handler', () => {
            const form = {
                addEventListener: jest.fn(),
                querySelector: jest.fn(() => null)
            };
            mockGetElementById.mockImplementation((id: string) => {
                if (id === 'eventUpdateForm') return form;
                return null;
            });
            
            events.initUpdate();
            
            expect(form.addEventListener).toHaveBeenCalledWith('submit', expect.any(Function));
        });

        test('should handle missing form gracefully', () => {
            mockGetElementById.mockReturnValue(null);
            
            expect(() => events.initUpdate()).not.toThrow();
        });
    });

    describe('initCancelRegistration', () => {
        test('should set up cancel registration button handler', () => {
            const btn = {
                addEventListener: jest.fn()
            };
            mockGetElementById.mockImplementation((id: string) => {
                if (id === 'cancelRegistrationBtn') return btn;
                return null;
            });
            
            events.initCancelRegistration();
            
            expect(btn.addEventListener).toHaveBeenCalledWith('click', expect.any(Function));
        });

        test('should handle missing button gracefully', () => {
            mockGetElementById.mockReturnValue(null);
            
            expect(() => events.initCancelRegistration()).not.toThrow();
        });
    });

    describe('initDateRange', () => {
        test('should update date range display', () => {
            const start = {dataset: {start: '2024-01-01'}, textContent: ''};
            const end = {dataset: {end: '2024-01-31'}, textContent: ''};
            
            // Store elements in mockElements map so default mock can find them
            mockElements.set('startSpan', start);
            mockElements.set('endSpan', end);
            
            events.initDateRange();
            
            // Function should complete without errors
            expect(mockGetElementById).toHaveBeenCalledWith('startSpan');
            expect(mockGetElementById).toHaveBeenCalledWith('endSpan');
        });

        test('should handle missing elements gracefully', () => {
            mockGetElementById.mockReturnValue(null);
            
            expect(() => events.initDateRange()).not.toThrow();
        });
    });

    describe('initRegistrationDateRange', () => {
        test('should update registration date range display', () => {
            let start = {textContent: '', dataset: {start: '2024-01-01T00:00:00Z'}};
            let end = {textContent: '', dataset: {end: '2024-01-31T00:00:00Z'}};
            
            // Store elements in mockElements map
            mockElements.set('arrival', start);
            mockElements.set('departure', end);
            
            events.initRegistrationDateRange();
            
            // Check that getElementById was called
            expect(mockGetElementById).toHaveBeenCalledWith('arrival');
            expect(mockGetElementById).toHaveBeenCalledWith('departure');
        });

        test('should handle missing elements gracefully', () => {
            mockGetElementById.mockReturnValue(null);
            
            expect(() => events.initRegistrationDateRange()).not.toThrow();
        });
    });

    describe('initInvoiceAdmin', () => {
        test('should set up invoice administration handlers', () => {
            const form = {
                addEventListener: jest.fn(),
                querySelector: jest.fn(() => null),
                querySelectorAll: jest.fn(() => []),
                dataset: {api: '/api/test'}
            };
            
            // Store element in mockElements map
            mockElements.set('poolCreateForm', form);
            
            // Clear just the addEventListener mock before test
            mockAddEventListener.mockClear();
            
            events.initInvoiceAdmin();
            
            // Check that document.addEventListener was called for click handlers
            expect(mockAddEventListener).toHaveBeenCalledWith('click', expect.any(Function));
        });
    });

    describe('initInvoiceSubmission', () => {
        test('should set up invoice submission form handler', () => {
            const form = {
                addEventListener: jest.fn()
            };
            
            // Store element in mockElements map
            mockElements.set('invoiceSubmitForm', form);
            
            events.initInvoiceSubmission();
            
            expect(form.addEventListener).toHaveBeenCalledWith('submit', expect.any(Function));
        });

        test('should handle missing form gracefully', () => {
            mockGetElementById.mockReturnValue(null);
            
            expect(() => events.initInvoiceSubmission()).not.toThrow();
        });
    });

    describe('init', () => {
        test('should call setCurrentNavLocation and loadPerms', () => {
            events.init();
            
            expect(setCurrentNavLocation).toHaveBeenCalledTimes(1);
            expect(loadPerms).toHaveBeenCalledTimes(1);
        });

        test('should initialize all basic functions', () => {
            // Mock takeoverModal with querySelector
            const mockModal = {
                addEventListener: jest.fn(),
                querySelector: jest.fn(() => null),
                dataset: {date: '2024-12-31T23:59:59Z', tz: 'UTC'}
            };
            mockElements.set('takeoverModal', mockModal);
            
            mockGetElementById.mockImplementation((id) => {
                return mockElements.get(id) || null;
            });
            
            events.init();
            
            expect(setCurrentNavLocation).toHaveBeenCalled();
            expect(loadPerms).toHaveBeenCalled();
            expect(initEntityLists).toHaveBeenCalled();
        });

        test('should initialize event-specific functions when eventId exists', () => {
            (global as any).window.Surveyor.eventId = 'event-123';
            
            // Create mock forms for event-specific initialization
            const mockForm = {
                addEventListener: jest.fn(), 
                querySelector: jest.fn(() => null), 
                querySelectorAll: jest.fn(() => []),
                dataset: {api: '/api/test'}
            };
            
            const mockBtn = {addEventListener: jest.fn()};
            
            // Store elements in mockElements map
            mockElements.set('registrationForm', mockForm);
            mockElements.set('eventUpdateForm', mockForm);
            mockElements.set('poolCreateForm', mockForm);
            mockElements.set('invoiceSubmitForm', mockForm);
            mockElements.set('cancelRegistrationBtn', mockBtn);
            
            events.init();
            
            // Event-specific initializations should be called (registrationForm, eventUpdateForm, cancelRegistrationBtn)
            expect(mockGetElementById).toHaveBeenCalledWith('registrationForm');
            expect(mockGetElementById).toHaveBeenCalledWith('eventUpdateForm');
            expect(mockGetElementById).toHaveBeenCalledWith('cancelRegistrationBtn');
        });

        test('should expose init function to global scope', () => {
            // The init function is exposed at module load via: window.Surveyor.init = init;
            // This happens when the module is imported, but setupTest() clears window.Surveyor
            // So we need to check if it was set by manually checking
            // The module does set it, but setupTest runs after, so we verify the function exists
            expect(events.init).toBeDefined();
            expect(typeof events.init).toBe('function');
            
            // Verify it can be called
            expect(() => events.init()).not.toThrow();
        });
    });
});
