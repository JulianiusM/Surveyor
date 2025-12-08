/**
 * Tests for activity.ts module
 * Activity plan view functionality with slot management and assignments
 */

import {describe, test, expect, jest, beforeEach, afterEach} from '@jest/globals';
import {
    formatTimeLabelData,
    describeSlotData,
    formatSlotLabelData,
    toDateTimeLocalValueData,
    toISOStringOrNullData,
    initData
} from '../data/activityData';

// Mock all module dependencies
jest.mock('../../../src/public/js/core/navigation', () => ({
    setCurrentNavLocation: jest.fn()
}));

jest.mock('../../../src/public/js/shared/list-actions', () => ({
    initAssignmentRemoval: jest.fn()
}));

jest.mock('../../../src/public/js/core/permissions', () => ({
    loadPerms: jest.fn()
}));

jest.mock('../../../src/public/js/modules/activity-participants', () => ({
    initParticipantsTab: jest.fn()
}));

jest.mock('../../../src/public/js/modules/activity-roles', () => ({
    addRoleToGlobal: jest.fn(),
    getAllRoles: jest.fn(),
    getSlotRolesForSlot: jest.fn(),
    initSlotRoleAdminModal: jest.fn()
}));

jest.mock('../../../src/public/js/modules/activity-assignments', () => ({
    buildWarningModal: jest.fn(() => ({modal: 'mock'})),
    describeWarning: jest.fn((warning, describeFn) => {
        return describeFn ? describeFn(warning.slotId) : `Warning for ${warning.slotId}`;
    }),
    initAssign: jest.fn()
}));

jest.mock('../../../src/public/js/modules/activity-filters', () => ({
    initDates: jest.fn(),
    initSlotFilters: jest.fn()
}));

jest.mock('../../../src/public/js/modules/activity-slot-operations', () => ({
    initDelete: jest.fn(),
    initDnD: jest.fn(),
    initInlineEdit: jest.fn()
}));

jest.mock('../../../src/public/js/modules/activity-slot-editor', () => ({
    initSlotEditorModal: jest.fn()
}));

jest.mock('../../../src/public/js/modules/activity-requirements', () => ({
    initRequirementPanel: jest.fn()
}));

jest.mock('../../../src/public/js/modules/activity-recommendations-schedule', () => ({
    initRecommendationScheduleView: jest.fn()
}));

// Need to import after mocking
let activity: any;
let setCurrentNavLocation: any;
let loadPerms: any;
let initDates: any;
let buildWarningModal: any;
let initAssign: any;
let initInlineEdit: any;
let initDelete: any;
let initSlotEditorModal: any;
let initDnD: any;
let initRequirementPanel: any;
let initRecommendationScheduleView: any;
let initSlotFilters: any;
let initParticipantsTab: any;
let initSlotRoleAdminModal: any;
let initAssignmentRemoval: any;

describe('activity.ts', () => {
    beforeEach(async () => {
        // Clear all mocks
        jest.clearAllMocks();
        
        // Setup window.Surveyor
        (global as any).window = {
            Surveyor: {
                entityId: '',
                init: undefined
            },
            bootstrap: {
                Tab: jest.fn().mockImplementation(() => ({
                    show: jest.fn()
                }))
            }
        };
        
        // Setup sessionStorage mock
        const sessionStorageMock = {
            getItem: jest.fn(),
            setItem: jest.fn(),
            removeItem: jest.fn(),
            clear: jest.fn()
        };
        (global as any).sessionStorage = sessionStorageMock;
        
        // Setup document
        (global as any).document = {
            querySelector: jest.fn(),
            querySelectorAll: jest.fn(() => []),
            createElement: jest.fn(),
            body: {}
        };
        
        // Import module and mocks
        const nav = await import('../../../src/public/js/core/navigation');
        const perms = await import('../../../src/public/js/core/permissions');
        const filters = await import('../../../src/public/js/modules/activity-filters');
        const assignments = await import('../../../src/public/js/modules/activity-assignments');
        const slotOps = await import('../../../src/public/js/modules/activity-slot-operations');
        const slotEditor = await import('../../../src/public/js/modules/activity-slot-editor');
        const requirements = await import('../../../src/public/js/modules/activity-requirements');
        const recommendations = await import('../../../src/public/js/modules/activity-recommendations-schedule');
        const participants = await import('../../../src/public/js/modules/activity-participants');
        const roles = await import('../../../src/public/js/modules/activity-roles');
        const listActions = await import('../../../src/public/js/shared/list-actions');
        
        setCurrentNavLocation = nav.setCurrentNavLocation;
        loadPerms = perms.loadPerms;
        initDates = filters.initDates;
        buildWarningModal = assignments.buildWarningModal;
        initAssign = assignments.initAssign;
        initInlineEdit = slotOps.initInlineEdit;
        initDelete = slotOps.initDelete;
        initSlotEditorModal = slotEditor.initSlotEditorModal;
        initDnD = slotOps.initDnD;
        initRequirementPanel = requirements.initRequirementPanel;
        initRecommendationScheduleView = recommendations.initRecommendationScheduleView;
        initSlotFilters = filters.initSlotFilters;
        initParticipantsTab = participants.initParticipantsTab;
        initSlotRoleAdminModal = roles.initSlotRoleAdminModal;
        initAssignmentRemoval = listActions.initAssignmentRemoval;
        
        activity = await import('../../../src/public/js/activity');
    });

    afterEach(() => {
        jest.resetModules();
    });

    describe('init', () => {
        test('should call setCurrentNavLocation and loadPerms', () => {
            activity.init();
            
            expect(setCurrentNavLocation).toHaveBeenCalledTimes(1);
            expect(loadPerms).toHaveBeenCalledTimes(1);
        });

        test('should call initDates', () => {
            activity.init();
            
            expect(initDates).toHaveBeenCalledTimes(1);
        });

        test('should restore saved tab from session storage', () => {
            // Mock sessionStorage
            const getItemSpy = jest.spyOn(Storage.prototype, 'getItem').mockReturnValue('#participants-tab');
            const removeItemSpy = jest.spyOn(Storage.prototype, 'removeItem');
            
            // Mock DOM elements needed for tab restoration
            const tabTrigger = document.createElement('a');
            tabTrigger.setAttribute('data-bs-target', '#participants-tab');
            document.body.appendChild(tabTrigger);
            
            const mockTab = {show: jest.fn()};
            (global as any).window.bootstrap = {Tab: jest.fn(() => mockTab)};
            
            activity.init();
            
            expect(getItemSpy).toHaveBeenCalledWith('activity-active-tab');
            expect(removeItemSpy).toHaveBeenCalledWith('activity-active-tab');
            expect(mockTab.show).toHaveBeenCalled();
            
            getItemSpy.mockRestore();
            removeItemSpy.mockRestore();
        });

        test('should not restore tab if none saved', () => {
            const getItemSpy = jest.spyOn(Storage.prototype, 'getItem').mockReturnValue(null);
            const removeItemSpy = jest.spyOn(Storage.prototype, 'removeItem');
            
            activity.init();
            
            expect(getItemSpy).toHaveBeenCalledWith('activity-active-tab');
            expect(removeItemSpy).not.toHaveBeenCalled();
            
            getItemSpy.mockRestore();
            removeItemSpy.mockRestore();
        });

        test('should initialize all modules when planId exists', () => {
            (global as any).window.Surveyor.entityId = 'plan-123';
            
            activity.init();
            
            expect(buildWarningModal).toHaveBeenCalled();
            expect(initAssign).toHaveBeenCalledWith('plan-123', expect.any(Object));
            expect(initInlineEdit).toHaveBeenCalledWith('plan-123');
            expect(initDelete).toHaveBeenCalledWith('plan-123');
            expect(initSlotEditorModal).toHaveBeenCalledWith('plan-123');
            expect(initDnD).toHaveBeenCalledWith('plan-123');
            expect(initRequirementPanel).toHaveBeenCalledWith('plan-123');
            expect(initRecommendationScheduleView).toHaveBeenCalledWith('plan-123', expect.any(Function));
            expect(initSlotFilters).toHaveBeenCalled();
            expect(initParticipantsTab).toHaveBeenCalled();
            expect(initSlotRoleAdminModal).toHaveBeenCalledWith('plan-123', expect.any(Function));
            expect(initAssignmentRemoval).toHaveBeenCalledWith({
                baseUrl: '/api/activity/plan-123'
            });
        });

        test('should not initialize modules when planId is missing', () => {
            (global as any).window.Surveyor.entityId = '';
            
            activity.init();
            
            expect(initAssign).not.toHaveBeenCalled();
            expect(initInlineEdit).not.toHaveBeenCalled();
            expect(initDelete).not.toHaveBeenCalled();
        });

        test('should expose init function to global scope', () => {
            activity.init();
            
            expect(window.Surveyor.init).toBeDefined();
        });
    });
});
