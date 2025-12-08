/**
 * Test data for password validation
 * Data-driven test cases for password strength checking and validation
 */

/**
 * Test cases for isPasswordValid function
 */
export const passwordValidData = [
    {
        description: 'valid password with letters and digits',
        input: { password: 'password123' },
        expected: true,
    },
    {
        description: 'valid password with mixed case',
        input: { password: 'MySecure1' },
        expected: true,
    },
    {
        description: 'valid password with uppercase',
        input: { password: 'TestPass99' },
        expected: true,
    },
];

export const passwordInvalidData = [
    {
        description: 'password shorter than 8 characters',
        input: { password: 'Pass1' },
        expected: false,
    },
    {
        description: 'short password',
        input: { password: 'abc123' },
        expected: false,
    },
    {
        description: 'very short password',
        input: { password: 'Aa1' },
        expected: false,
    },
    {
        description: 'password without letters',
        input: { password: '12345678' },
        expected: false,
    },
    {
        description: 'password with only numbers',
        input: { password: '00000000' },
        expected: false,
    },
    {
        description: 'password without digits',
        input: { password: 'password' },
        expected: false,
    },
    {
        description: 'password without digits - mixed case',
        input: { password: 'MySecurePass' },
        expected: false,
    },
    {
        description: 'all caps without digits',
        input: { password: 'ALLCAPS' },
        expected: false,
    },
    {
        description: 'undefined password',
        input: { password: undefined },
        expected: false,
    },
    {
        description: 'empty password',
        input: { password: '' },
        expected: false,
    },
];

export const passwordEdgeCaseData = [
    {
        description: 'lowercase letters with digits',
        input: { password: 'lowercase123' },
        expected: true,
    },
    {
        description: 'uppercase letters with digits',
        input: { password: 'UPPERCASE123' },
        expected: true,
    },
    {
        description: 'mixed case with digits',
        input: { password: 'MixedCase123' },
        expected: true,
    },
    {
        description: 'with special character',
        input: { password: 'Pass123!' },
        expected: true,
    },
    {
        description: 'with @ symbol',
        input: { password: 'Test@123' },
        expected: true,
    },
    {
        description: 'with # symbol',
        input: { password: 'Secure#99' },
        expected: true,
    },
    {
        description: 'exactly 8 characters with letter and digit',
        input: { password: 'abcdef12' },
        expected: true,
    },
    {
        description: 'exactly 8 characters digits first',
        input: { password: '1234abcd' },
        expected: true,
    },
];

/**
 * Test cases for isPasswordRepeatValid function
 */
export const passwordRepeatMatchData = [
    {
        description: 'passwords match',
        input: { password: 'password123', passwordRepeat: 'password123' },
        expected: true,
    },
    {
        description: 'passwords match - complex',
        input: { password: 'MySecure1', passwordRepeat: 'MySecure1' },
        expected: true,
    },
];

export const passwordRepeatMismatchData = [
    {
        description: 'passwords do not match',
        input: { password: 'password123', passwordRepeat: 'password124' },
        expected: false,
    },
    {
        description: 'passwords differ by one character',
        input: { password: 'MySecure1', passwordRepeat: 'MySecure2' },
        expected: false,
    },
    {
        description: 'one password is undefined',
        input: { password: 'password123', passwordRepeat: undefined },
        expected: false,
    },
    {
        description: 'first password is undefined',
        input: { password: undefined, passwordRepeat: 'password123' },
        expected: false,
    },
    {
        description: 'one password is empty',
        input: { password: 'password123', passwordRepeat: '' },
        expected: false,
    },
    {
        description: 'first password is empty',
        input: { password: '', passwordRepeat: 'password123' },
        expected: false,
    },
    {
        description: 'case-sensitive mismatch',
        input: { password: 'Password123', passwordRepeat: 'password123' },
        expected: false,
    },
    {
        description: 'all caps vs lowercase',
        input: { password: 'PASSWORD123', passwordRepeat: 'password123' },
        expected: false,
    },
];

export const passwordRepeatEdgeCaseData = [
    {
        description: 'both passwords are undefined',
        input: { password: undefined, passwordRepeat: undefined },
        expected: true,
    },
    {
        description: 'both passwords are empty',
        input: { password: '', passwordRepeat: '' },
        expected: true,
    },
];

/**
 * Test cases for generatePasswordFeedback function
 */
export const passwordFeedbackData = [
    {
        description: 'all criteria met',
        input: { hasMinLength: true, hasLetter: true, hasDigit: true },
        expected: {
            contains: ['bi-check-circle-fill', 'text-success', 'At least 8 characters', 'At least one letter', 'At least one digit'],
            notContains: ['bi-x-circle'],
        },
    },
    {
        description: 'no criteria met',
        input: { hasMinLength: false, hasLetter: false, hasDigit: false },
        expected: {
            contains: ['bi-x-circle', 'text-muted'],
            notContains: ['bi-check-circle-fill', 'text-success'],
        },
    },
    {
        description: 'mixed criteria - length and digit',
        input: { hasMinLength: true, hasLetter: false, hasDigit: true },
        expected: {
            contains: ['bi-check-circle-fill', 'bi-x-circle', 'text-success', 'text-muted'],
            notContains: [],
        },
    },
    {
        description: 'correct HTML structure',
        input: { hasMinLength: true, hasLetter: true, hasDigit: false },
        expected: {
            contains: ['<ul class="list-unstyled mb-0 mt-1">', '</ul>', '<li'],
            notContains: [],
        },
    },
];
