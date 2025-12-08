/**
 * Tests for activity-assignments module
 * Tests assignment warnings and take/leave actions
 */

import {describeWarning, buildWarningModal, initAssign} from '../../../src/public/js/modules/activity-assignments';
import * as http from '../../../src/public/js/core/http';
import * as alerts from '../../../src/public/js/shared/alerts';
import * as uiHelpers from '../../../src/public/js/shared/ui-helpers';
import {activityAssignmentsData} from '../data/activityAssignmentsData';
import type {AssignmentWarning} from '../../../src/public/js/modules/activity-types';

// Mock dependencies
jest.mock('../../../src/public/js/core/http');
jest.mock('../../../src/public/js/shared/alerts');
jest.mock('../../../src/public/js/shared/ui-helpers');

const mockPost = http.post as jest.MockedFunction<typeof http.post>;
const mockShowInlineAlert = alerts.showInlineAlert as jest.MockedFunction<typeof alerts.showInlineAlert>;
const mockReloadAfterDelay = uiHelpers.reloadAfterDelay as jest.MockedFunction<typeof uiHelpers.reloadAfterDelay>;

describe('activity-assignments module', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        (window as any).bootstrap = undefined;
        jest.clearAllMocks();
    });

    describe('describeWarning', () => {
        const mockDescribeSlot = jest.fn((slotId: string) => `Slot ${slotId}`);

        test.each(activityAssignmentsData.describeWarning)('$description', ({warning, expected}) => {
            const result = describeWarning(warning, mockDescribeSlot);
            expect(result).toContain(expected);
        });

        test('describes overlap warning with conflicts', () => {
            const warning: AssignmentWarning = {
                type: 'overlap',
                conflicts: ['slot1', 'slot2']
            };
            const result = describeWarning(warning, mockDescribeSlot);
            expect(result).toContain('Slot slot1');
            expect(result).toContain('Slot slot2');
        });
    });

    describe('buildWarningModal', () => {
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

        test.each(activityAssignmentsData.buildWarningModal.noModal)('$description', async ({html, warnings, slotId, confirmResult}) => {
            document.body.innerHTML = html;
            (window as any).bootstrap = undefined;
            
            // Mock window.confirm
            const mockConfirm = jest.spyOn(window, 'confirm').mockReturnValue(confirmResult);
            
            const mockDescribeSlot = jest.fn((id: string) => `Slot ${id}`);
            const warningModal = buildWarningModal(mockDescribeSlot);
            
            const result = await warningModal.confirm(warnings, slotId);
            
            expect(result).toBe(confirmResult);
            if (warnings.length > 0) {
                expect(mockConfirm).toHaveBeenCalled();
            }
            
            mockConfirm.mockRestore();
        });

        test.each(activityAssignmentsData.buildWarningModal.withModal)('$description', async ({html, warnings, slotId}) => {
            document.body.innerHTML = html;
            const mockDescribeSlot = jest.fn((id: string) => `Slot ${id}`);
            
            const warningModal = buildWarningModal(mockDescribeSlot);
            
            // Start the confirmation process
            const confirmPromise = warningModal.confirm(warnings, slotId);
            
            // Wait for modal to be shown
            await new Promise(resolve => setTimeout(resolve, 0));
            
            if (warnings.length > 0) {
                // Check modal was shown
                expect(mockModal.show).toHaveBeenCalled();
                
                // Check warnings rendered
                const list = document.getElementById('assignmentWarningList');
                const items = list?.querySelectorAll('li');
                expect(items?.length).toBe(warnings.length);
                
                // Simulate clicking confirm button
                const confirmBtn = document.getElementById('assignmentWarningConfirm') as HTMLButtonElement;
                confirmBtn.click();
                
                // Wait for promise to resolve
                const result = await confirmPromise;
                expect(result).toBe(true);
            } else {
                // No warnings means should return true immediately
                const result = await confirmPromise;
                expect(result).toBe(true);
            }
        });

        test.each(activityAssignmentsData.buildWarningModal.cancelModal)('$description', async ({html, warnings, slotId}) => {
            document.body.innerHTML = html;
            const mockDescribeSlot = jest.fn((id: string) => `Slot ${id}`);
            
            const warningModal = buildWarningModal(mockDescribeSlot);
            
            // Start the confirmation process
            const confirmPromise = warningModal.confirm(warnings, slotId);
            
            // Wait for modal to be shown
            await new Promise(resolve => setTimeout(resolve, 0));
            
            // Simulate clicking cancel button
            const cancelBtn = document.getElementById('assignmentWarningCancel') as HTMLButtonElement;
            cancelBtn.click();
            
            // Wait for promise to resolve
            const result = await confirmPromise;
            expect(result).toBe(false);
        });
    });

    describe('initAssign', () => {
        let mockModal: any;
        let mockWarningModal: any;

        beforeEach(() => {
            mockModal = {
                show: jest.fn(),
                hide: jest.fn()
            };

            (window as any).bootstrap = {
                Modal: jest.fn(() => mockModal)
            };

            mockWarningModal = {
                confirm: jest.fn().mockResolvedValue(true)
            };
        });

        test.each(activityAssignmentsData.initAssign.noAction)('$description', async ({planId, html}) => {
            document.body.innerHTML = html;
            
            initAssign(planId, mockWarningModal);
            
            // Click element without data-action
            const div = document.querySelector('div');
            div?.click();
            
            // Should not make any API calls
            expect(mockPost).not.toHaveBeenCalled();
        });

        test.each(activityAssignmentsData.initAssign.assignWithWarnings)('$description', async ({planId, html, slotId, role, warnings}) => {
            document.body.innerHTML = html;
            mockPost.mockResolvedValueOnce({data: {warnings}});
            mockPost.mockResolvedValueOnce({});
            mockWarningModal.confirm.mockResolvedValue(true);
            
            initAssign(planId, mockWarningModal);
            
            // Click assign button
            const btn = document.querySelector(`[data-action="assign"][data-role="${role}"]`) as HTMLElement;
            btn.click();
            
            // Wait for async operations
            await new Promise(resolve => setTimeout(resolve, 10));
            
            // Should fetch warnings
            expect(mockPost).toHaveBeenCalledWith(
                `/api/activity/${planId}/slot/${slotId}/warnings`,
                {}
            );
            
            // Should show warning modal
            expect(mockWarningModal.confirm).toHaveBeenCalledWith(warnings, slotId);
            
            // Should perform assignment
            expect(mockPost).toHaveBeenCalledWith(
                `/api/activity/${planId}/assign`,
                {slotId, role}
            );
            
            // Should show success and reload
            expect(mockShowInlineAlert).toHaveBeenCalledWith('success', expect.any(String));
            expect(mockReloadAfterDelay).toHaveBeenCalledWith(120);
        });

        test.each(activityAssignmentsData.initAssign.assignCancelled)('$description', async ({planId, html, slotId, role, warnings}) => {
            document.body.innerHTML = html;
            mockPost.mockResolvedValueOnce({data: {warnings}});
            mockWarningModal.confirm.mockResolvedValue(false);
            
            initAssign(planId, mockWarningModal);
            
            // Click assign button
            const btn = document.querySelector(`[data-action="assign"][data-role="${role}"]`) as HTMLElement;
            btn.click();
            
            // Wait for async operations
            await new Promise(resolve => setTimeout(resolve, 10));
            
            // Should fetch warnings
            expect(mockPost).toHaveBeenCalledWith(
                `/api/activity/${planId}/slot/${slotId}/warnings`,
                {}
            );
            
            // Should show warning modal
            expect(mockWarningModal.confirm).toHaveBeenCalledWith(warnings, slotId);
            
            // Should NOT perform assignment (user cancelled)
            expect(mockPost).not.toHaveBeenCalledWith(
                `/api/activity/${planId}/assign`,
                expect.any(Object)
            );
        });

        test.each(activityAssignmentsData.initAssign.unassign)('$description', async ({planId, html, slotId, role}) => {
            document.body.innerHTML = html;
            mockPost.mockResolvedValue({});
            
            initAssign(planId, mockWarningModal);
            
            // Click unassign button
            const btn = document.querySelector(`[data-action="unassign"][data-role="${role}"]`) as HTMLElement;
            btn.click();
            
            // Wait for async operations
            await new Promise(resolve => setTimeout(resolve, 10));
            
            // Should NOT fetch warnings for unassign
            expect(mockPost).not.toHaveBeenCalledWith(
                expect.stringContaining('/warnings'),
                expect.any(Object)
            );
            
            // Should perform unassignment directly
            expect(mockPost).toHaveBeenCalledWith(
                `/api/activity/${planId}/unassign`,
                {slotId, role}
            );
            
            // Should show success and reload
            expect(mockShowInlineAlert).toHaveBeenCalledWith('success', expect.any(String));
            expect(mockReloadAfterDelay).toHaveBeenCalledWith(120);
        });

        test.each(activityAssignmentsData.initAssign.error)('$description', async ({planId, html, slotId, role, errorMessage}) => {
            document.body.innerHTML = html;
            mockPost.mockRejectedValue(new Error(errorMessage));
            
            initAssign(planId, mockWarningModal);
            
            // Click assign button
            const btn = document.querySelector(`[data-action="assign"][data-role="${role}"]`) as HTMLElement;
            btn.click();
            
            // Wait for async operations
            await new Promise(resolve => setTimeout(resolve, 10));
            
            // Should show error
            expect(mockShowInlineAlert).toHaveBeenCalledWith('error', expect.any(String));
            
            // Should NOT reload
            expect(mockReloadAfterDelay).not.toHaveBeenCalled();
        });
    });
});
