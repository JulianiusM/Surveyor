/**
 * Tests for activity.ts module
 * Activity plan view functionality with slot management and assignments
 */

import {describe, test, expect, jest} from '@jest/globals';
import {
    formatTimeLabelData,
    describeSlotData,
    formatSlotLabelData,
    toDateTimeLocalValueData,
    toISOStringOrNullData,
    initData
} from '../data/activityData';
import {setupTest} from '../helpers/testSetup';

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

// Import after mocking (window already set up at top of file)
import * as activity from '../../../src/public/js/activity';
import {setCurrentNavLocation} from '../../../src/public/js/core/navigation';
import {loadPerms} from '../../../src/public/js/core/permissions';
import {initDates, initSlotFilters} from '../../../src/public/js/modules/activity-filters';
import {buildWarningModal, initAssign} from '../../../src/public/js/modules/activity-assignments';
import {initInlineEdit, initDelete, initDnD} from '../../../src/public/js/modules/activity-slot-operations';
import {initSlotEditorModal} from '../../../src/public/js/modules/activity-slot-editor';
import {initRequirementPanel} from '../../../src/public/js/modules/activity-requirements';
import {initRecommendationScheduleView} from '../../../src/public/js/modules/activity-recommendations-schedule';
import {initParticipantsTab} from '../../../src/public/js/modules/activity-participants';
import {initSlotRoleAdminModal} from '../../../src/public/js/modules/activity-roles';
import {initAssignmentRemoval} from '../../../src/public/js/shared/list-actions';

describe('activity.ts', () => {
    setupTest({
        beforeEach: () => {
            // Reset window.Surveyor properties (but keep init function set by module)
            window.Surveyor.entityId = '';
            
            // Setup Bootstrap mock
            (window as any).bootstrap = {
                Tab: jest.fn().mockImplementation(() => ({
                    show: jest.fn()
                }))
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
        }
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
