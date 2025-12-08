/**
 * Test data for verify_password.ts module
 * Data-driven test approach following repository patterns
 */

export interface VerifyPasswordTestData {
    description: string;
    expectedCalls: {
        setCurrentNavLocation: number;
        loadPerms: number;
    };
}

export interface PasswordEventTestData {
    description: string;
    eventType: 'keyup' | 'focusin' | 'focusout' | 'submit';
    fieldId: string;
    expectedFunction: string;
    shouldPreventDefault?: boolean;
}

export const verifyPasswordInitTestData: VerifyPasswordTestData[] = [
    {
        description: 'should initialize with navigation and permissions',
        expectedCalls: {
            setCurrentNavLocation: 1,
            loadPerms: 1
        }
    }
];

export const passwordEventTestData: PasswordEventTestData[] = [
    {
        description: 'should verify password on keyup',
        eventType: 'keyup',
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
        description: 'should match passwords on repeat keyup',
        eventType: 'keyup',
        fieldId: 'password_repeat',
        expectedFunction: 'matchPassword'
    }
];

export const formSubmitTestData = {
    description: 'should validate on form submit',
    expectedFunction: 'validate',
    shouldCallPreventDefault: false // validate function handles this internally
};
