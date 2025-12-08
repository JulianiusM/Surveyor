// tests/client/unit/password-validation.test.ts
// Unit tests for core/password-validation.ts logic
import {
    isPasswordValid,
    isPasswordRepeatValid,
    generatePasswordFeedback,
} from '../../../src/public/js/core/password-validation';

describe('password validation logic', () => {
    describe('isPasswordValid', () => {
        test('returns true for valid password', () => {
            expect(isPasswordValid('password123')).toBe(true);
            expect(isPasswordValid('MySecure1')).toBe(true);
            expect(isPasswordValid('TestPass99')).toBe(true);
        });

        test('returns false for password shorter than 8 characters', () => {
            expect(isPasswordValid('Pass1')).toBe(false);
            expect(isPasswordValid('abc123')).toBe(false);
            expect(isPasswordValid('Aa1')).toBe(false);
        });

        test('returns false for password without letters', () => {
            expect(isPasswordValid('12345678')).toBe(false);
            expect(isPasswordValid('00000000')).toBe(false);
        });

        test('returns false for password without digits', () => {
            expect(isPasswordValid('password')).toBe(false);
            expect(isPasswordValid('MySecurePass')).toBe(false);
            expect(isPasswordValid('ALLCAPS')).toBe(false);
        });

        test('returns false for undefined password', () => {
            expect(isPasswordValid(undefined)).toBe(false);
        });

        test('returns false for empty password', () => {
            expect(isPasswordValid('')).toBe(false);
        });

        test('accepts both uppercase and lowercase letters', () => {
            expect(isPasswordValid('lowercase123')).toBe(true);
            expect(isPasswordValid('UPPERCASE123')).toBe(true);
            expect(isPasswordValid('MixedCase123')).toBe(true);
        });

        test('accepts special characters', () => {
            expect(isPasswordValid('Pass123!')).toBe(true);
            expect(isPasswordValid('Test@123')).toBe(true);
            expect(isPasswordValid('Secure#99')).toBe(true);
        });

        test('edge case: exactly 8 characters with letter and digit', () => {
            expect(isPasswordValid('abcdef12')).toBe(true);
            expect(isPasswordValid('1234abcd')).toBe(true);
        });
    });

    describe('isPasswordRepeatValid', () => {
        test('returns true when passwords match', () => {
            expect(isPasswordRepeatValid('password123', 'password123')).toBe(true);
            expect(isPasswordRepeatValid('MySecure1', 'MySecure1')).toBe(true);
        });

        test('returns false when passwords do not match', () => {
            expect(isPasswordRepeatValid('password123', 'password124')).toBe(false);
            expect(isPasswordRepeatValid('MySecure1', 'MySecure2')).toBe(false);
        });

        test('returns false when one password is undefined', () => {
            expect(isPasswordRepeatValid('password123', undefined)).toBe(false);
            expect(isPasswordRepeatValid(undefined, 'password123')).toBe(false);
        });

        test('returns true when both passwords are undefined', () => {
            expect(isPasswordRepeatValid(undefined, undefined)).toBe(true);
        });

        test('returns false when one password is empty', () => {
            expect(isPasswordRepeatValid('password123', '')).toBe(false);
            expect(isPasswordRepeatValid('', 'password123')).toBe(false);
        });

        test('returns true when both passwords are empty', () => {
            expect(isPasswordRepeatValid('', '')).toBe(true);
        });

        test('is case-sensitive', () => {
            expect(isPasswordRepeatValid('Password123', 'password123')).toBe(false);
            expect(isPasswordRepeatValid('PASSWORD123', 'password123')).toBe(false);
        });
    });

    describe('generatePasswordFeedback', () => {
        test('generates feedback for all criteria met', () => {
            const feedback = generatePasswordFeedback(true, true, true);
            expect(feedback).toContain('bi-check-circle-fill');
            expect(feedback).toContain('text-success');
            expect(feedback).toContain('At least 8 characters');
            expect(feedback).toContain('At least one letter');
            expect(feedback).toContain('At least one digit');
            expect(feedback).not.toContain('bi-x-circle');
        });

        test('generates feedback for no criteria met', () => {
            const feedback = generatePasswordFeedback(false, false, false);
            expect(feedback).toContain('bi-x-circle');
            expect(feedback).toContain('text-muted');
            expect(feedback).not.toContain('bi-check-circle-fill');
            expect(feedback).not.toContain('text-success');
        });

        test('generates feedback for mixed criteria', () => {
            const feedback = generatePasswordFeedback(true, false, true);
            expect(feedback).toContain('bi-check-circle-fill');
            expect(feedback).toContain('bi-x-circle');
            expect(feedback).toContain('text-success');
            expect(feedback).toContain('text-muted');
        });

        test('generates correct HTML structure', () => {
            const feedback = generatePasswordFeedback(true, true, false);
            expect(feedback).toContain('<ul class="list-unstyled mb-0 mt-1">');
            expect(feedback).toContain('</ul>');
            expect(feedback).toContain('<li');
            expect(feedback).toMatch(/<li.*>.*<\/li>/);
        });

        test('shows success icon for met criteria', () => {
            const feedback = generatePasswordFeedback(true, false, false);
            expect(feedback).toMatch(/<li.*text-success.*>.*bi-check-circle-fill.*At least 8 characters/);
        });

        test('shows error icon for unmet criteria', () => {
            const feedback = generatePasswordFeedback(false, true, false);
            expect(feedback).toMatch(/<li.*text-muted.*>.*bi-x-circle.*At least 8 characters/);
        });

        test('includes all three criteria in output', () => {
            const feedback = generatePasswordFeedback(false, false, false);
            expect(feedback).toContain('At least 8 characters');
            expect(feedback).toContain('At least one letter');
            expect(feedback).toContain('At least one digit');
        });
    });
});
