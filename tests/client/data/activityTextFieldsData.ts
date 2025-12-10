/**
 * Test data for activity-text-fields module
 */

import {deepCopy} from "../helpers/util";

const _modalOpenData = [
    {
        description: 'opens modal for creating a text field and clears inputs',
        triggerId: 'addTextFieldBtn',
        initialValues: {title: 'Existing', text: 'Keep', id: 'tf-old'},
        expected: {
            heading: 'Add text field',
            title: '',
            text: '',
            id: '',
        },
    },
    {
        description: 'opens modal for editing and populates existing values',
        triggerClass: 'text-field-edit',
        dataset: {textFieldId: 'tf-2', title: 'Existing title', content: 'Existing text'},
        expected: {
            heading: 'Edit text field',
            title: 'Existing title',
            text: 'Existing text',
            id: 'tf-2',
        },
    },
];

const _saveTextFieldData = [
    {
        description: 'saves new text field with trimmed title',
        planId: 'plan-1',
        formValues: {title: '  New Title  ', text: 'Body', id: ''},
        apiSuccess: true,
        expectedUrl: '/api/activity/plan-1/text-field',
        expectedBody: {title: 'New Title', text: 'Body'},
    },
    {
        description: 'updates existing text field and closes modal',
        planId: 'plan-1',
        formValues: {title: 'Updated', text: 'Updated body', id: 'tf-5'},
        apiSuccess: true,
        expectedUrl: '/api/activity/plan-1/text-field/tf-5',
        expectedBody: {title: 'Updated', text: 'Updated body'},
    },
    {
        description: 'shows error when save fails',
        planId: 'plan-1',
        formValues: {title: 'Bad', text: 'Error body', id: 'tf-5'},
        apiSuccess: false,
        apiError: 'Save failed',
        expectedUrl: '/api/activity/plan-1/text-field/tf-5',
        expectedBody: {title: 'Bad', text: 'Error body'},
        expectedAlertType: 'error',
        expectedAlertMessage: 'Save failed',
    },
];

const _deleteTextFieldData = [
    {
        description: 'deletes text field after confirmation',
        planId: 'plan-1',
        textFieldId: 'tf-1',
        confirmResult: true,
        apiSuccess: true,
        expectedAlertType: 'success',
        expectedAlertMessage: 'Text field deleted',
    },
    {
        description: 'shows API error message when request fails',
        planId: 'plan-1',
        textFieldId: 'tf-1',
        confirmResult: true,
        apiSuccess: false,
        apiError: 'Failed to delete text field',
        expectedAlertType: 'error',
        expectedAlertMessage: 'Failed to delete text field',
    },
    {
        description: 'does nothing when confirmation is canceled',
        planId: 'plan-1',
        textFieldId: 'tf-1',
        confirmResult: false,
        apiSuccess: true,
    },
    {
        description: 'skips deletion when id is missing',
        planId: 'plan-1',
        textFieldId: '',
        confirmResult: true,
        apiSuccess: true,
    },
];

export const modalOpenData = () => deepCopy(_modalOpenData) as typeof _modalOpenData;
export const saveTextFieldData = () => deepCopy(_saveTextFieldData) as typeof _saveTextFieldData;
export const deleteTextFieldData = () => deepCopy(_deleteTextFieldData) as typeof _deleteTextFieldData;
