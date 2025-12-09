/**
 * Tests for activity-roles module
 * Tests role management and role admin modal functionality
 */

import {getAllRoles, getSlotRolesForSlot, addRoleToGlobal, initSlotRoleAdminModal} from '../../../src/public/js/modules/activity-roles';
import * as http from '../../../src/public/js/core/http';
import * as alerts from '../../../src/public/js/shared/alerts';
import * as uiHelpers from '../../../src/public/js/shared/ui-helpers';
import * as permissions from '../../../src/public/js/core/permissions';
import {activityRolesData} from '../data/activityRolesData';
import type {RoleSummary} from '../../../src/public/js/modules/activity-types';
import {setupTest} from '../helpers/testSetup';

// Mock dependencies
jest.mock('../../../src/public/js/core/http');
jest.mock('../../../src/public/js/shared/alerts');
jest.mock('../../../src/public/js/shared/ui-helpers');
jest.mock('../../../src/public/js/core/permissions');

const mockPost = http.post as jest.MockedFunction<typeof http.post>;
const mockShowInlineAlert = alerts.showInlineAlert as jest.MockedFunction<typeof alerts.showInlineAlert>;
const mockReloadAfterDelay = uiHelpers.reloadAfterDelay as jest.MockedFunction<typeof uiHelpers.reloadAfterDelay>;
const mockRequireEntityPerm = permissions.requireEntityPerm as jest.MockedFunction<typeof permissions.requireEntityPerm>;

describe('activity-roles module', () => {
    setupTest({
        beforeEach: () => {
            (window as any).Surveyor = undefined;
            (window as any).bootstrap = undefined;
        }
    });

    describe('getAllRoles', () => {
        test.each(activityRolesData.getAllRoles)('$description', ({initialRoles, expected}) => {
            if (initialRoles !== undefined) {
                (window as any).Surveyor = {allRoles: initialRoles};
            }
            const result = getAllRoles();
            expect(result).toEqual(expected);
        });
    });

    describe('getSlotRolesForSlot', () => {
        test.each(activityRolesData.getSlotRolesForSlot)('$description', ({slotId, slotRoles, expected}) => {
            if (slotRoles !== undefined) {
                (window as any).Surveyor = {slotRoles};
            }
            const result = getSlotRolesForSlot(slotId);
            expect(result).toEqual(expected);
        });
    });

    describe('addRoleToGlobal', () => {
        test.each(activityRolesData.addRoleToGlobal)('$description', ({initialRoles, roleToAdd, expectedRoles}) => {
            if (initialRoles !== undefined) {
                (window as any).Surveyor = {allRoles: initialRoles};
            }
            
            addRoleToGlobal(roleToAdd);
            
            const result = (window as any).Surveyor?.allRoles || [];
            expect(result).toEqual(expectedRoles);
        });
    });

    describe('initSlotRoleAdminModal', () => {
        let mockModal: any;
        
        beforeEach(() => {
            mockModal = {
                show: jest.fn(),
                hide: jest.fn()
            };
            
            (window as any).bootstrap = {
                Modal: jest.fn(() => mockModal)
            };
        });

        test.each(activityRolesData.initSlotRoleAdminModal.invalidSetup)('$description', ({planId, html, describeSlot}) => {
            document.body.innerHTML = html;
            const mockDescribeSlot = jest.fn(describeSlot);
            
            initSlotRoleAdminModal(planId, mockDescribeSlot);
            
            // Should not create modal or add listeners if required elements missing
            expect((window as any).bootstrap?.Modal).not.toHaveBeenCalled();
        });

        test.each(activityRolesData.initSlotRoleAdminModal.validSetup)('$description', ({planId, html, describeSlot}) => {
            document.body.innerHTML = html;
            const mockDescribeSlot = jest.fn(describeSlot);
            
            initSlotRoleAdminModal(planId, mockDescribeSlot);
            
            // Should create modal with required elements
            expect((window as any).bootstrap.Modal).toHaveBeenCalled();
        });

        test.each(activityRolesData.initSlotRoleAdminModal.openModal)('$description', async ({planId, html, slotId, expectedTitle}) => {
            document.body.innerHTML = html;
            const mockDescribeSlot = jest.fn((id: string) => `Slot ${id}`);
            
            initSlotRoleAdminModal(planId, mockDescribeSlot);
            
            // Click the role admin button
            const btn = document.querySelector(`[data-slot-role-admin][data-slotid="${slotId}"]`) as HTMLElement;
            expect(btn).toBeTruthy();
            btn.click();
            
            // Check title updated
            const titleEl = document.getElementById('slotRoleAdminTitle');
            if (titleEl) {
                expect(titleEl.textContent).toContain(expectedTitle);
            }
            
            // Check modal shown
            expect(mockModal.show).toHaveBeenCalled();
        });

        test.each(activityRolesData.initSlotRoleAdminModal.renderTable)('$description', ({planId, html, slotId, expectedRows}) => {
            document.body.innerHTML = html;
            const mockDescribeSlot = jest.fn((id: string) => `Slot ${id}`);
            
            initSlotRoleAdminModal(planId, mockDescribeSlot);
            
            // Click the role admin button
            const btn = document.querySelector(`[data-slot-role-admin][data-slotid="${slotId}"]`) as HTMLElement;
            btn.click();
            
            // Check table rendered correctly
            const bodyEl = document.getElementById('slotRoleAdminBody');
            const rows = bodyEl?.querySelectorAll('tr');
            expect(rows?.length).toBe(expectedRows);
        });

        test.each(activityRolesData.initSlotRoleAdminModal.saveSuccess)('$description', async ({planId, html, slotId, expectedPayload}) => {
            document.body.innerHTML = html;
            const mockDescribeSlot = jest.fn((id: string) => `Slot ${id}`);
            mockPost.mockResolvedValue({});
            
            initSlotRoleAdminModal(planId, mockDescribeSlot);
            
            // Open modal
            const btn = document.querySelector(`[data-slot-role-admin][data-slotid="${slotId}"]`) as HTMLElement;
            btn.click();
            
            // Click save
            const saveBtn = document.getElementById('slotRoleAdminSave') as HTMLButtonElement;
            await saveBtn.click();
            
            // Wait for async operations
            await new Promise(resolve => setTimeout(resolve, 0));
            
            // Check API called with correct data
            expect(mockRequireEntityPerm).toHaveBeenCalledWith('MANAGE_ASSIGNMENTS', expect.any(String));
            expect(mockPost).toHaveBeenCalledWith(
                `/api/activity/${planId}/slot/${slotId}/roles/admin`,
                expectedPayload
            );
            expect(mockShowInlineAlert).toHaveBeenCalledWith('success', expect.any(String));
            expect(mockModal.hide).toHaveBeenCalled();
            expect(mockReloadAfterDelay).toHaveBeenCalledWith(150);
        });

        test.each(activityRolesData.initSlotRoleAdminModal.saveError)('$description', async ({planId, html, slotId, errorMessage}) => {
            document.body.innerHTML = html;
            const mockDescribeSlot = jest.fn((id: string) => `Slot ${id}`);
            
            if (errorMessage === 'permission') {
                mockRequireEntityPerm.mockImplementation(() => {
                    throw new Error('Permission denied');
                });
            } else {
                mockPost.mockRejectedValue(new Error(errorMessage));
            }
            
            initSlotRoleAdminModal(planId, mockDescribeSlot);
            
            // Open modal
            const btn = document.querySelector(`[data-slot-role-admin][data-slotid="${slotId}"]`) as HTMLElement;
            btn.click();
            
            // Click save
            const saveBtn = document.getElementById('slotRoleAdminSave') as HTMLButtonElement;
            await saveBtn.click();
            
            // Wait for async operations
            await new Promise(resolve => setTimeout(resolve, 0));
            
            // Check error displayed
            const errorEl = document.getElementById('slotRoleAdminError');
            expect(errorEl?.textContent).toBeTruthy();
            expect(errorEl?.classList.contains('d-none')).toBe(false);
            expect(mockShowInlineAlert).toHaveBeenCalledWith('error', expect.any(String));
            expect(mockModal.hide).not.toHaveBeenCalled();
        });
    });
});
