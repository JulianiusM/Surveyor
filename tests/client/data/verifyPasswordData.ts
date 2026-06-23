/**
 * Test data for verify_password.ts module
 * Data-driven test approach following repository patterns
 */

import {deepCopy} from "../helpers/util";

export interface VerifyPasswordTestData {
    description: string;
    expectedCalls: {
        setCurrentNavLocation: number;
        loadPerms: number;
    };
}

export interface PasswordEventTestData {
    description: string;
    eventType: 'input' | 'focusin' | 'focusout' | 'submit';
    fieldId: string;
    expectedFunction: string;
    shouldPreventDefault?: boolean;
}

const _verifyPasswordInitTestData: VerifyPasswordTestData[] = [
    {
        description: 'should initialize with navigation and permissions',
        expectedCalls: {
            setCurrentNavLocation: 1,
            loadPerms: 1
        }
    }
];

export const verifyPasswordInitTestData = () => deepCopy(_verifyPasswordInitTestData) as typeof _verifyPasswordInitTestData;

const _passwordEventTestData: PasswordEventTestData[] = [
    {
        description: 'should verify password on input',
        eventType: 'input',
        fieldId: 'password',
        expectedFunction: 'verifyPassword'
    },
    {
        description: 'should verify password on focusin',
        eventType: 'focusin',
        fieldId: 'password',
        expectedFunction: 'verifyPassword'
    },
    {
        description: 'should remove tooltip on focusout',
        eventType: 'focusout',
        fieldId: 'password',
        expectedFunction: 'removeTooltip'
    },
    {
        description: 'should match passwords on input',
        eventType: 'input',
        fieldId: 'password_repeat',
        expectedFunction: 'matchPassword'
    },
    {
        description: 'should match passwords on input in main field',
        eventType: 'input',
        fieldId: 'password',
        expectedFunction: 'matchPassword'
    }
];

export const passwordEventTestData = () => deepCopy(_passwordEventTestData) as typeof _passwordEventTestData;

const _formSubmitTestData = {
    description: 'should validate on form submit',
    expectedFunction: 'validate',
    shouldCallPreventDefault: false // validate function handles this internally
};

export const formSubmitTestData = () => deepCopy(_formSubmitTestData) as typeof _formSubmitTestData;
