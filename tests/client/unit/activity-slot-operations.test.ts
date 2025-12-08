/**
 * Tests for activity-slot-operations module
 */

import {initInlineEdit, initDelete, initDnD} from '../../../src/public/js/modules/activity-slot-operations';
import * as inlineEdit from '../../../src/public/js/shared/inline-edit';
import * as http from '../../../src/public/js/core/http';
import * as alerts from '../../../src/public/js/shared/alerts';
import * as uiHelpers from '../../../src/public/js/shared/ui-helpers';
import * as permissions from '../../../src/public/js/core/permissions';
import * as dragDrop from '../../../src/public/js/shared/drag-drop';
import {initInlineEditData, initDeleteData, initDnDData} from '../data/activitySlotOperationsData';

// Mock dependencies
jest.mock('../../../src/public/js/shared/inline-edit');
jest.mock('../../../src/public/js/core/http');
jest.mock('../../../src/public/js/shared/alerts');
jest.mock('../../../src/public/js/shared/ui-helpers');
jest.mock('../../../src/public/js/core/permissions');
jest.mock('../../../src/public/js/shared/drag-drop');

describe('activity-slot-operations', () => {
    let mockStartInlineEdit: jest.SpyInstance;
    let mockStartInlineEditArea: jest.SpyInstance;
    let mockPost: jest.SpyInstance;
    let mockShowInlineAlert: jest.SpyInstance;
    let mockReloadAfterDelay: jest.SpyInstance;
    let mockRequireItemPerm: jest.SpyInstance;
    let mockRequireEntityPerm: jest.SpyInstance;
    let mockInitCardReorder: jest.SpyInstance;
    let mockConfirm: jest.SpyInstance;

    beforeEach(() => {
        // Clear document and remove all event listeners by replacing body
        document.body = document.createElement('body');
        
        jest.clearAllMocks();
        mockStartInlineEdit = jest.spyOn(inlineEdit, 'startInlineEdit').mockImplementation();
        mockStartInlineEditArea = jest.spyOn(inlineEdit, 'startInlineEditArea').mockImplementation();
        mockPost = jest.spyOn(http, 'post').mockResolvedValue({});
        mockShowInlineAlert = jest.spyOn(alerts, 'showInlineAlert').mockImplementation();
        mockReloadAfterDelay = jest.spyOn(uiHelpers, 'reloadAfterDelay').mockImplementation();
        mockRequireItemPerm = jest.spyOn(permissions, 'requireItemPerm').mockImplementation();
        mockRequireEntityPerm = jest.spyOn(permissions, 'requireEntityPerm').mockImplementation();
        mockInitCardReorder = jest.spyOn(dragDrop, 'initCardReorder').mockImplementation();
        mockConfirm = jest.spyOn(window, 'confirm').mockReturnValue(true);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('initInlineEdit', () => {
        initInlineEditData.forEach((testCase) => {
            test(testCase.description, () => {
                document.body.innerHTML = testCase.elementHtml;
                initInlineEdit(testCase.planId);

                const element = document.body.firstElementChild as HTMLElement;
                const event = new MouseEvent('dblclick', {bubbles: true});
                element.dispatchEvent(event);

                if (testCase.expectedCalls > 0) {
                    if (testCase.elementHtml.includes('planDescription')) {
                        expect(mockStartInlineEditArea).toHaveBeenCalledTimes(1);
                        expect(mockStartInlineEditArea).toHaveBeenCalledWith(
                            expect.any(HTMLElement),
                            `/api/activity/${testCase.planId}/description`,
                            expect.objectContaining({
                                scope: 'entity',
                                key: 'EDIT_DESC',
                                action: 'edit activity descriptions',
                            })
                        );
                    } else {
                        expect(mockStartInlineEdit).toHaveBeenCalledTimes(1);
                        expect(mockStartInlineEdit).toHaveBeenCalledWith(
                            expect.any(HTMLElement),
                            `/api/activity/${testCase.planId}/slot`
                        );
                    }
                } else {
                    expect(mockStartInlineEdit).not.toHaveBeenCalled();
                    expect(mockStartInlineEditArea).not.toHaveBeenCalled();
                }
            });
        });

        test('does not trigger on non-targeted elements', () => {
            document.body.innerHTML = '<div>No edit attributes</div>';
            initInlineEdit('plan123');

            const element = document.body.firstElementChild as HTMLElement;
            const event = new MouseEvent('dblclick', {bubbles: true});
            element.dispatchEvent(event);

            expect(mockStartInlineEdit).not.toHaveBeenCalled();
            expect(mockStartInlineEditArea).not.toHaveBeenCalled();
        });
    });

    describe('initDelete', () => {
        initDeleteData.forEach((testCase) => {
            test(testCase.description, async () => {
                const buttonHtml = `<button data-delete-slot data-slotid="${testCase.slotId}">Delete</button>`;
                document.body.innerHTML = buttonHtml;

                mockConfirm.mockReturnValue(testCase.confirmResult);

                if (!testCase.apiSuccess) {
                    mockPost.mockRejectedValue(new Error(testCase.apiError || 'API Error'));
                }

                initDelete(testCase.planId);

                const button = document.querySelector('[data-delete-slot]') as HTMLElement;
                button.click();

                // Wait for async operations
                await new Promise((resolve) => setTimeout(resolve, 10));

                if (!testCase.confirmResult) {
                    expect(mockPost).not.toHaveBeenCalled();
                    expect(mockShowInlineAlert).not.toHaveBeenCalled();
                    return;
                }

                if (testCase.slotId) {
                    expect(mockRequireItemPerm).toHaveBeenCalledWith(
                        testCase.slotId,
                        'ITEM_DELETE',
                        'delete slots',
                        'ITEM_DELETE'
                    );

                    if (testCase.apiSuccess) {
                        expect(mockPost).toHaveBeenCalledWith(
                            `/api/activity/${testCase.planId}/slot/${testCase.slotId}/delete`,
                            {}
                        );
                        expect(mockShowInlineAlert).toHaveBeenCalledWith('success', 'Deleted');
                        expect(mockReloadAfterDelay).toHaveBeenCalledWith(100);
                    } else {
                        expect(mockShowInlineAlert).toHaveBeenCalledWith('error', testCase.expectedAlertMessage);
                    }
                }
            });
        });

        test('handles permission error gracefully', async () => {
            document.body.innerHTML = '<button data-delete-slot data-slotid="slot123">Delete</button>';
            mockRequireItemPerm.mockImplementation(() => {
                throw new Error('Permission denied');
            });

            initDelete('plan123');

            const button = document.querySelector('[data-delete-slot]') as HTMLElement;
            button.click();

            await new Promise((resolve) => setTimeout(resolve, 10));

            expect(mockPost).not.toHaveBeenCalled();
            expect(mockShowInlineAlert).toHaveBeenCalledWith('error', 'Permission denied');
        });
    });

    describe('initDnD', () => {
        initDnDData.forEach((testCase) => {
            test(testCase.description, () => {
                if (!testCase.hasPermission) {
                    mockRequireEntityPerm.mockImplementation(() => {
                        throw new Error('Reordering is not allowed.');
                    });
                }

                initDnD(testCase.planId);

                expect(mockRequireEntityPerm).toHaveBeenCalledWith('ITEM_EDIT', 'reorder slots');

                if (testCase.expectInitialized) {
                    expect(mockInitCardReorder).toHaveBeenCalledWith(
                        expect.objectContaining({
                            containerClass: 'slot-container',
                            cardClass: 'slot',
                            apiUrl: `/api/activity/${testCase.planId}/slot/reorder`,
                        })
                    );
                    expect(mockShowInlineAlert).not.toHaveBeenCalled();
                } else {
                    expect(mockInitCardReorder).not.toHaveBeenCalled();
                    expect(mockShowInlineAlert).toHaveBeenCalledWith('error', expect.stringContaining('not allowed'));
                }
            });
        });

        test('getOrderData extracts slot IDs correctly', () => {
            document.body.innerHTML = `
                <div class="slot-container">
                    <div class="slot" data-slotid="slot1"></div>
                    <div class="slot" data-slotid="slot2"></div>
                    <div class="slot" data-slotid="slot3"></div>
                </div>
            `;

            initDnD('plan123');

            const callArgs = mockInitCardReorder.mock.calls[0][0];
            const container = document.querySelector('.slot-container') as HTMLElement;
            const orderData = callArgs.getOrderData(container);

            expect(orderData).toEqual([
                {slotId: 'slot1', pos: 0},
                {slotId: 'slot2', pos: 1},
                {slotId: 'slot3', pos: 2},
            ]);
        });
    });
});
