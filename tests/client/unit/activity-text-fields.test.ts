/**
 * Tests for activity-text-fields module
 */

import {initTextFields} from '../../../src/public/js/modules/activity/activity-text-fields';
import * as alerts from '../../../src/public/js/shared/alerts';
import * as uiHelpers from '../../../src/public/js/shared/ui-helpers';
import * as permissions from '../../../src/public/js/core/permissions';
import * as http from '../../../src/public/js/core/http';
import * as inlineEdit from '../../../src/public/js/shared/inline-edit';
import {
    deleteTextFieldData as _deleteTextFieldData,
    modalOpenData as _modalOpenData,
    saveTextFieldData as _saveTextFieldData,
} from '../data/activityTextFieldsData';
import {setupTest, mockApiError, mockApiSuccess} from '../helpers/testSetup';

const deleteTextFieldData = _deleteTextFieldData();
const modalOpenData = _modalOpenData();
const saveTextFieldData = _saveTextFieldData();

jest.mock('../../../src/public/js/shared/alerts');
jest.mock('../../../src/public/js/shared/ui-helpers');
jest.mock('../../../src/public/js/core/permissions');
jest.mock('../../../src/public/js/shared/inline-edit');

describe('activity-text-fields', () => {
    let mockShowInlineAlert: jest.SpyInstance;
    let mockReloadAfterDelay: jest.SpyInstance;
    let mockRequireEntityPerm: jest.SpyInstance;
    let mockGetPerms: jest.SpyInstance;
    let mockStartInlineEditArea: jest.SpyInstance;
    let mockConfirm: jest.SpyInstance;
    let modalInstance: {show: jest.Mock; hide: jest.Mock};

    setupTest({
        beforeEach: () => {
            mockShowInlineAlert = jest.spyOn(alerts, 'showInlineAlert').mockImplementation();
            mockReloadAfterDelay = jest.spyOn(uiHelpers, 'reloadAfterDelay').mockImplementation();
            mockRequireEntityPerm = jest.spyOn(permissions, 'requireEntityPerm').mockImplementation();
            mockGetPerms = jest.spyOn(permissions, 'getPerms').mockReturnValue({
                entity: {has: (key: string) => key === 'MANAGE_REQUIREMENTS' || key === 'ACCESS_VIEW'},
            } as any);
            mockStartInlineEditArea = jest.spyOn(inlineEdit, 'startInlineEditArea').mockImplementation();
            mockConfirm = jest.spyOn(window, 'confirm').mockReturnValue(true);
            modalInstance = {show: jest.fn(), hide: jest.fn()};
            (window as any).bootstrap = {
                Modal: jest.fn(() => modalInstance),
            };
        },
        afterEach: () => {
            jest.restoreAllMocks();
            document.body.innerHTML = '';
        },
    });

    function renderBase(
        textFieldId: string,
        options: {
            includeAdd?: boolean;
            editDataset?: {textFieldId?: string; title?: string; content?: string};
            initialValues?: {title?: string; text?: string; id?: string};
            content?: string;
            placeholder?: string;
        } = {}
    ) {
        const addBtn = options.includeAdd
            ? '<button id="addTextFieldBtn" type="button">Add</button>'
            : '';
        const editBtn = options.editDataset
            ? `<button class="text-field-edit" type="button" data-text-field-id="${options.editDataset.textFieldId ?? ''}"
                    data-title="${options.editDataset.title ?? ''}" data-content="${options.editDataset.content ?? ''}">Edit</button>`
            : '';
        const content = options.content ?? '';
        const placeholder = options.placeholder ?? 'double-click to edit';
        document.body.innerHTML = `
            <div id="textFieldModal"></div>
            <h5 id="textFieldModalTitle"></h5>
            <form id="textFieldForm"></form>
            <input id="textFieldTitle" value="${options.initialValues?.title ?? ''}" />
            <textarea id="textFieldText">${options.initialValues?.text ?? ''}</textarea>
            <input id="textFieldId" value="${options.initialValues?.id ?? ''}" />
            ${addBtn}
            ${editBtn}
            <button class="text-field-delete" data-text-field-id="${textFieldId}">Delete</button>
            <p class="text-field-content" data-edit="textField" data-id="${textFieldId}" data-placeholder="${placeholder}">
                ${content}
            </p>
        `;
    }

    describe('modal interactions', () => {
        modalOpenData.forEach((testCase) => {
            test(testCase.description, () => {
                renderBase(testCase.dataset?.textFieldId ?? 'tf-1', {
                    includeAdd: Boolean(testCase.triggerId),
                    editDataset: testCase.dataset,
                    initialValues: testCase.initialValues,
                });

                initTextFields('plan-1');

                const trigger = testCase.triggerId
                    ? document.getElementById(testCase.triggerId)
                    : document.querySelector<HTMLElement>(`.${testCase.triggerClass}`);
                trigger?.click();

                const heading = document.getElementById('textFieldModalTitle');
                const titleInput = document.getElementById('textFieldTitle') as HTMLInputElement;
                const textInput = document.getElementById('textFieldText') as HTMLTextAreaElement;
                const idInput = document.getElementById('textFieldId') as HTMLInputElement;

                expect(modalInstance.show).toHaveBeenCalled();
                expect(heading?.textContent).toBe(testCase.expected.heading);
                expect(titleInput.value).toBe(testCase.expected.title);
                expect(textInput.value).toBe(testCase.expected.text);
                expect(idInput.value).toBe(testCase.expected.id);
            });
        });
    });

    describe('edit button behavior', () => {
        test('opens modal when user can manage requirements', () => {
            renderBase('tf-2', {
                editDataset: {textFieldId: 'tf-2', title: 'Existing title', content: 'Existing text'},
            });

            initTextFields('plan-1');

            const btn = document.querySelector<HTMLElement>('.text-field-edit');
            btn?.click();

            expect(modalInstance.show).toHaveBeenCalled();
            expect(mockStartInlineEditArea).not.toHaveBeenCalled();
        });

        test('starts inline edit when user lacks MANAGE_REQUIREMENTS', () => {
            mockGetPerms.mockReturnValue({entity: {has: (key: string) => key === 'ACCESS_VIEW'}} as any);
            renderBase('tf-3', {
                editDataset: {textFieldId: 'tf-3', title: 'Existing title', content: 'Existing text'},
                content: 'Existing text',
                placeholder: 'double-click to edit',
            });

            initTextFields('plan-2');

            const btn = document.querySelector<HTMLElement>('.text-field-edit');
            btn?.click();

            expect(mockStartInlineEditArea).toHaveBeenCalledWith(
                expect.any(HTMLElement),
                '/api/activity/plan-2/text-field/tf-3',
                {scope: 'entity', key: 'ACCESS_VIEW', action: 'edit shared text fields'},
                expect.objectContaining({
                    payloadKey: 'text',
                    successMessage: 'Text updated',
                    placeholder: 'double-click to edit',
                    maxLength: 5000,
                }),
            );
            expect(modalInstance.show).not.toHaveBeenCalled();
        });
    });

    describe('save text field', () => {
        saveTextFieldData.forEach((testCase) => {
            test(testCase.description, async () => {
                renderBase(testCase.formValues.id || 'tf-1');

                const postSpy = jest.spyOn(http, 'post');
                if (testCase.apiSuccess) {
                    mockApiSuccess('POST', testCase.expectedUrl, {});
                } else {
                    mockApiError('POST', testCase.expectedUrl, testCase.apiError || 'Error', 400);
                }

                initTextFields(testCase.planId);

                const titleInput = document.getElementById('textFieldTitle') as HTMLInputElement;
                const textInput = document.getElementById('textFieldText') as HTMLTextAreaElement;
                const idInput = document.getElementById('textFieldId') as HTMLInputElement;

                titleInput.value = testCase.formValues.title;
                textInput.value = testCase.formValues.text;
                idInput.value = testCase.formValues.id;

                const form = document.getElementById('textFieldForm') as HTMLFormElement;
                form.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));

                await new Promise((resolve) => setTimeout(resolve, 120));

                expect(postSpy).toHaveBeenCalledWith(testCase.expectedUrl, testCase.expectedBody);

                if (testCase.apiSuccess) {
                    expect(mockShowInlineAlert).toHaveBeenCalledWith('success', 'Saved');
                    expect(modalInstance.hide).toHaveBeenCalled();
                    expect(mockReloadAfterDelay).toHaveBeenCalledWith(150);
                } else {
                    expect(mockShowInlineAlert).toHaveBeenCalledWith(
                        testCase.expectedAlertType,
                        testCase.expectedAlertMessage
                    );
                    expect(modalInstance.hide).not.toHaveBeenCalled();
                    expect(mockReloadAfterDelay).not.toHaveBeenCalled();
                }
            });
        });
    });

    describe('delete text field', () => {
        deleteTextFieldData.forEach((testCase) => {
            test(testCase.description, async () => {
                renderBase(testCase.textFieldId);

                mockConfirm.mockReturnValue(testCase.confirmResult);

                if (testCase.textFieldId && testCase.confirmResult) {
                    if (testCase.apiSuccess) {
                        mockApiSuccess('POST', `/api/activity/${testCase.planId}/text-field/${testCase.textFieldId}/delete`, {});
                    } else {
                        mockApiError(
                            'POST',
                            `/api/activity/${testCase.planId}/text-field/${testCase.textFieldId}/delete`,
                            testCase.apiError || 'Delete failed',
                            400,
                        );
                    }
                }

                initTextFields(testCase.planId);

                const btn = document.querySelector('.text-field-delete') as HTMLElement;
                btn.click();

                await new Promise((resolve) => setTimeout(resolve, 120));

                if (!testCase.textFieldId || !testCase.confirmResult) {
                    expect(mockRequireEntityPerm).not.toHaveBeenCalled();
                    expect(mockShowInlineAlert).not.toHaveBeenCalled();
                    return;
                }

                expect(mockRequireEntityPerm).toHaveBeenCalledWith('MANAGE_REQUIREMENTS', 'delete shared text fields');

                if (testCase.apiSuccess) {
                    expect(mockShowInlineAlert).toHaveBeenCalledWith('success', 'Text field deleted');
                    expect(mockReloadAfterDelay).toHaveBeenCalledWith(150);
                } else {
                    expect(mockShowInlineAlert).toHaveBeenCalledWith('error', testCase.expectedAlertMessage);
                }
            });
        });
    });
});
