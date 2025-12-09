/**
 * Tests for activity-create.ts module
 * Activity plan creation with dynamic slot management
 */

import {describe, test, expect, jest, beforeEach, afterEach} from '@jest/globals';
import {
    updateSlotObjData,
    getSlotObjData,
    reIndexDayData,
    buildSlotRowData,
    buildDayCellData,
    createWeekTableData,
    buildTablesData,
    maybeGenerateData,
    initListenersData,
    initSubmitHandlerData,
    initData
} from '../data/activityCreateData';
import {setupTest} from '../helpers/testSetup';

// Mock dependencies
jest.mock('../../../src/public/js/core/navigation', () => ({
    setCurrentNavLocation: jest.fn()
}));

jest.mock('../../../src/public/js/core/permissions', () => ({
    loadPerms: jest.fn()
}));

jest.mock('../../../src/public/js/core/formatting', () => ({
    formatISODate: jest.fn((date) => {
        const d = date instanceof Date ? date : new Date(date);
        return d.toISOString().split('T')[0];
    }),
    getValidDaysInWeek: jest.fn((monday, start, end) => {
        const days = [];
        for (let i = 0; i < 7; i++) {
            const d = new Date(monday);
            d.setDate(d.getDate() + i);
            if (d >= start && d <= end) days.push(d);
        }
        return days;
    }),
    parseISODate: jest.fn((str) => new Date(str))
}));

let activityCreate: any;
let setCurrentNavLocation: any;
let loadPerms: any;

let mockGetElementById: jest.Mock;
let mockCreateElement: jest.Mock;

describe('activity-create.ts', () => {
    setupTest({
        clearDOM: false,
        beforeEach: async () => {
            // Reset modules to get fresh imports
            jest.resetModules();
        
        // Setup window
        (global as any).window = {
            Surveyor: {
                prefilledSlots: null,
                init: undefined
            },
            crypto: {
                randomUUID: jest.fn(() => `uuid-${Math.random()}`)
            }
        };
        
        // Setup document
        const mockElement = {
            addEventListener: jest.fn(),
            appendChild: jest.fn(),
            insertRow: jest.fn(() => ({
                appendChild: jest.fn()
            })),
            createTHead: jest.fn(function() {
                this.insertRow = jest.fn(() => ({
                    appendChild: jest.fn()
                }));
                return this;
            }),
            createTBody: jest.fn(function() {
                this.insertRow = jest.fn(() => ({
                    appendChild: jest.fn()
                }));
                return this;
            }),
            className: '',
            dataset: {},
            value: '',
            innerHTML: '',
            textContent: '',
            type: 'text',
            setCustomValidity: jest.fn(),
            submit: jest.fn(),
            querySelector: jest.fn(),
            querySelectorAll: jest.fn(() => []),
            closest: jest.fn(),
            remove: jest.fn(),
            draggable: false
        };
        
        mockGetElementById = jest.fn((id) => {
            if (id === 'slotArea') return Object.assign({}, mockElement);
            if (id === 'startDate') return Object.assign({}, mockElement, {value: '2024-01-15'});
            if (id === 'endDate') return Object.assign({}, mockElement, {value: '2024-01-21'});
            if (id === 'planForm') return Object.assign({}, mockElement);
            if (id === 'slotsJson') return Object.assign({}, mockElement);
            return mockElement;
        });
        
        mockCreateElement = jest.fn((tag) => {
            const elem = Object.assign({}, mockElement);
            if (tag === 'table') {
                elem.createTHead = mockElement.createTHead;
                elem.createTBody = mockElement.createTBody;
            }
            return elem;
        });
        
        (global as any).document = {
            getElementById: mockGetElementById,
            createElement: mockCreateElement,
            querySelector: jest.fn(),
            querySelectorAll: jest.fn(() => []),
            addEventListener: jest.fn(),
            body: {}
        };
        
        // Import mocks
        const nav = await import('../../../src/public/js/core/navigation');
        const perms = await import('../../../src/public/js/core/permissions');
        
        setCurrentNavLocation = nav.setCurrentNavLocation;
        loadPerms = perms.loadPerms;
        
        activityCreate = await import('../../../src/public/js/activity-create');
        },
        afterEach: () => {
            jest.resetModules();
        }
    });

    describe('updateSlotObj', () => {
        test('should add new slot to map', () => {
            const slot = {id: 'slot-1', title: 'Meeting', pos: 0};
            activityCreate.updateSlotObj('2024-01-15', slot);
            
            const retrieved = activityCreate.getSlotObj('2024-01-15', 'slot-1');
            expect(retrieved).toEqual(slot);
        });

        test('should update existing slot', () => {
            const slot1 = {id: 'slot-1', title: 'Meeting', pos: 0};
            const slot2 = {id: 'slot-1', title: 'Updated Meeting', pos: 0};
            
            activityCreate.updateSlotObj('2024-01-15', slot1);
            activityCreate.updateSlotObj('2024-01-15', slot2);
            
            const retrieved = activityCreate.getSlotObj('2024-01-15', 'slot-1');
            expect(retrieved?.title).toBe('Updated Meeting');
        });
    });

    describe('getSlotObj', () => {
        test('should retrieve existing slot', () => {
            const slot = {id: 'slot-1', title: 'Meeting', pos: 0};
            activityCreate.updateSlotObj('2024-01-15', slot);
            
            const retrieved = activityCreate.getSlotObj('2024-01-15', 'slot-1');
            expect(retrieved).toBeDefined();
            expect(retrieved?.id).toBe('slot-1');
        });

        test('should return undefined for non-existent slot', () => {
            const retrieved = activityCreate.getSlotObj('2024-01-15', 'nonexistent');
            expect(retrieved).toBeUndefined();
        });
    });

    describe('reIndexDay', () => {
        test('should re-index all slots for a day', () => {
            activityCreate.updateSlotObj('2024-01-15', {id: 'slot-1', pos: 2});
            activityCreate.updateSlotObj('2024-01-15', {id: 'slot-2', pos: 0});
            activityCreate.updateSlotObj('2024-01-15', {id: 'slot-3', pos: 1});
            
            activityCreate.reIndexDay('2024-01-15');
            
            const slot1 = activityCreate.getSlotObj('2024-01-15', 'slot-1');
            const slot2 = activityCreate.getSlotObj('2024-01-15', 'slot-2');
            const slot3 = activityCreate.getSlotObj('2024-01-15', 'slot-3');
            
            expect(slot1?.pos).toBe(2);
            expect(slot2?.pos).toBe(0);
            expect(slot3?.pos).toBe(1);
        });
    });

    describe('buildSlotRow', () => {
        test('should build slot row with prefilled data', () => {
            const pref = {
                id: 'slot-1',
                title: 'Meeting',
                description: 'Team meeting',
                startTime: '14:30:00',
                endTime: '16:00:00',
                maxAssignees: 5
            };
            const infoClb = jest.fn();
            
            const row = activityCreate.buildSlotRow('2024-01-15', 0, infoClb, pref);
            
            expect(row).toBeDefined();
            expect(row.dataset.slotDate).toBe('2024-01-15');
            expect(row.dataset.slotId).toBe('slot-1');
        });

        test('should build slot row without prefilled data', () => {
            const infoClb = jest.fn();
            
            const row = activityCreate.buildSlotRow('2024-01-16', 0, infoClb);
            
            expect(row).toBeDefined();
            expect(row.dataset.slotDate).toBe('2024-01-16');
        });
    });

    describe('buildDayCell', () => {
        test('should build day cell for a date', () => {
            const date = new Date('2024-01-15');
            
            const cell = activityCreate.buildDayCell(date);
            
            expect(cell).toBeDefined();
            expect(mockCreateElement).toHaveBeenCalledWith('td');
        });
    });

    describe('createWeekTable', () => {
        test('should create week table within date range', () => {
            const monday = new Date('2024-01-15');
            const start = new Date('2024-01-15');
            const end = new Date('2024-01-21');
            
            const wrapper = activityCreate.createWeekTable(monday, start, end);
            
            expect(wrapper).toBeDefined();
            expect(mockCreateElement).toHaveBeenCalledWith('table');
            expect(mockCreateElement).toHaveBeenCalledWith('div');
        });
    });

    describe('buildTables', () => {
        test('should build all tables for date range', () => {
            const start = new Date('2024-01-15');
            const end = new Date('2024-01-21');
            const slotArea = document.getElementById('slotArea');
            
            activityCreate.buildTables(start, end);
            
            expect(slotArea.innerHTML).toBe('');
        });

        test('should handle missing slot area gracefully', () => {
            (document.getElementById as any).mockReturnValue(null);
            const start = new Date('2024-01-15');
            const end = new Date('2024-01-21');
            
            expect(() => activityCreate.buildTables(start, end)).not.toThrow();
        });
    });

    describe('maybeGenerate', () => {
        test('should generate tables when dates are valid', () => {
            const startInp = {value: '2024-01-15'};
            const endInp = {value: '2024-01-21', setCustomValidity: jest.fn()};
            (document.getElementById as any).mockImplementation((id) => {
                if (id === 'startDate') return startInp;
                if (id === 'endDate') return endInp;
                if (id === 'slotArea') return {innerHTML: '', appendChild: jest.fn()};
                return null;
            });
            
            activityCreate.maybeGenerate();
            
            expect(endInp.setCustomValidity).toHaveBeenCalledWith('');
        });

        test('should auto-fill end date when missing', () => {
            const startInp = {value: '2024-01-15'};
            const endInp = {value: '', setCustomValidity: jest.fn()};
            mockGetElementById.mockImplementation((id) => {
                if (id === 'startDate') return startInp;
                if (id === 'endDate') return endInp;
                return null;
            });
            
            activityCreate.maybeGenerate();
            
            expect(endInp.value).toBe('2024-01-15');
        });

        test('should validate end date is not before start date', () => {
            const startInp = {value: '2024-01-21'};
            const endInp = {value: '2024-01-15', setCustomValidity: jest.fn()};
            mockGetElementById.mockImplementation((id) => {
                if (id === 'startDate') return startInp;
                if (id === 'endDate') return endInp;
                return null;
            });
            
            activityCreate.maybeGenerate();
            
            expect(endInp.setCustomValidity).toHaveBeenCalledWith('End before start');
        });

        test('should do nothing when start date is empty', () => {
            const startInp = {value: ''};
            const endInp = {value: '2024-01-21'};
            mockGetElementById.mockImplementation((id) => {
                if (id === 'startDate') return startInp;
                if (id === 'endDate') return endInp;
                return null;
            });
            
            expect(() => activityCreate.maybeGenerate()).not.toThrow();
        });
    });

    describe('initListeners', () => {
        test('should initialize date input listeners', () => {
            const startInp = {addEventListener: jest.fn()};
            const endInp = {addEventListener: jest.fn()};
            mockGetElementById.mockImplementation((id) => {
                if (id === 'startDate') return startInp;
                if (id === 'endDate') return endInp;
                return null;
            });
            
            activityCreate.initListeners();
            
            expect(startInp.addEventListener).toHaveBeenCalledWith('change', expect.any(Function));
            expect(endInp.addEventListener).toHaveBeenCalledWith('change', expect.any(Function));
        });
    });

    describe('initSubmitHandler', () => {
        test('should initialize form submit handler', () => {
            const form = {addEventListener: jest.fn(), submit: jest.fn()};
            const hidden = {value: ''};
            const startInp = {value: '2024-01-15'};
            const endInp = {value: '2024-01-21'};
            mockGetElementById.mockImplementation((id) => {
                if (id === 'planForm') return form;
                if (id === 'slotsJson') return hidden;
                if (id === 'startDate') return startInp;
                if (id === 'endDate') return endInp;
                return null;
            });
            
            activityCreate.initSubmitHandler();
            
            expect(form.addEventListener).toHaveBeenCalledWith('submit', expect.any(Function));
        });
    });

    describe('initSlotDnD', () => {
        test('should initialize drag-and-drop handlers', () => {
            activityCreate.initSlotDnD();
            
            expect(document.addEventListener).toHaveBeenCalledWith('dragstart', expect.any(Function));
            expect(document.addEventListener).toHaveBeenCalledWith('dragover', expect.any(Function));
            expect(document.addEventListener).toHaveBeenCalledWith('dragend', expect.any(Function));
        });
    });

    describe('init', () => {
        test('should call setCurrentNavLocation and loadPerms', () => {
            activityCreate.init();
            
            expect(setCurrentNavLocation).toHaveBeenCalledTimes(1);
            expect(loadPerms).toHaveBeenCalledTimes(1);
        });

        test('should initialize listeners and submit handler', () => {
            const mockInput = {addEventListener: jest.fn()};
            mockGetElementById.mockReturnValue(mockInput);
            
            activityCreate.init();
            
            // Should set up form handlers
            expect(mockGetElementById).toHaveBeenCalled();
        });

        test('should load prefilled slots when available', () => {
            const prefilledSlots = {
                '2024-01-15': [{id: 'slot-1', title: 'Meeting', pos: 0}]
            };
            (global as any).window.Surveyor.prefilledSlots = prefilledSlots;
            const mockInput = {value: '2024-01-15', setCustomValidity: jest.fn()};
            mockGetElementById.mockReturnValue(mockInput);
            
            activityCreate.init();
            
            // Prefilled slots should be available
            const slot = activityCreate.getSlotObj('2024-01-15', 'slot-1');
            expect(slot).toBeDefined();
        });

        test('should expose init function to global scope', () => {
            activityCreate.init();
            
            expect(window.Surveyor.init).toBeDefined();
        });
    });
});
