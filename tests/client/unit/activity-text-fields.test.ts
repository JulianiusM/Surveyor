/**
 * Tests for activity-text-fields module
 */

import {initTextFields} from '../../../src/public/js/modules/activity-text-fields';
import * as alerts from '../../../src/public/js/shared/alerts';
import * as uiHelpers from '../../../src/public/js/shared/ui-helpers';
import * as permissions from '../../../src/public/js/core/permissions';
import * as http from '../../../src/public/js/core/http';
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

describe('activity-text-fields', () => {
    let mockShowInlineAlert: jest.SpyInstance;
    let mockReloadAfterDelay: jest.SpyInstance;
    let mockRequireEntityPerm: jest.SpyInstance;
    let mockConfirm: jest.SpyInstance;
    let modalInstance: {show: jest.Mock; hide: jest.Mock};

    setupTest({
        beforeEach: () => {
            mockShowInlineAlert = jest.spyOn(alerts, 'showInlineAlert').mockImplementation();
            mockReloadAfterDelay = jest.spyOn(uiHelpers, 'reloadAfterDelay').mockImplementation();
            mockRequireEntityPerm = jest.spyOn(permissions, 'requireEntityPerm').mockImplementation();
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
        } = {}
    ) {
        const addBtn = options.includeAdd
            ? '<button id="addTextFieldBtn" type="button">Add</button>'
            : '';
        const editBtn = options.editDataset
            ? `<button class="text-field-edit" type="button" data-text-field-id="${options.editDataset.textFieldId ?? ''}"
                    data-title="${options.editDataset.title ?? ''}" data-content="${options.editDataset.content ?? ''}">Edit</button>`
            : '';
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

                expect(mockRequireEntityPerm).toHaveBeenCalledWith('MANAGE_PERMISSIONS', 'delete shared text fields');

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
