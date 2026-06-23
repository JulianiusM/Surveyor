// tests/client/unit/password-validation.test.ts
// Unit tests for core/password-validation.ts logic
// Follows data-driven test pattern

import {
    generatePasswordFeedback,
    isPasswordRepeatValid,
    isPasswordValid,
} from '../../../src/public/js/core/password-validation';

import {
    passwordEdgeCaseData,
    passwordFeedbackData,
    passwordInvalidData,
    passwordRepeatEdgeCaseData,
    passwordRepeatMatchData,
    passwordRepeatMismatchData,
    passwordValidData,
} from '../data/passwordValidationData';
import {setupTest} from '../helpers/testSetup';

describe('password validation logic', () => {
    setupTest();
    describe('isPasswordValid', () => {
        test.each(passwordValidData())('$description', ({input, expected}) => {
            expect(isPasswordValid(input.password)).toBe(expected);
        });

        test.each(passwordInvalidData())('$description', ({input, expected}) => {
            expect(isPasswordValid(input.password)).toBe(expected);
        });

        test.each(passwordEdgeCaseData())('$description', ({input, expected}) => {
            expect(isPasswordValid(input.password)).toBe(expected);
        });
    });

    describe('isPasswordRepeatValid', () => {
        test.each(passwordRepeatMatchData())('$description', ({input, expected}) => {
            expect(isPasswordRepeatValid(input.password, input.passwordRepeat)).toBe(expected);
        });

        test.each(passwordRepeatMismatchData())('$description', ({input, expected}) => {
            expect(isPasswordRepeatValid(input.password, input.passwordRepeat)).toBe(expected);
        });

        test.each(passwordRepeatEdgeCaseData())('$description', ({input, expected}) => {
            expect(isPasswordRepeatValid(input.password, input.passwordRepeat)).toBe(expected);
        });
    });

    describe('generatePasswordFeedback', () => {
        test.each(passwordFeedbackData())('$description', ({input, expected}) => {
            const feedback = generatePasswordFeedback(
                input.hasMinLength,
                input.hasLetter,
                input.hasDigit
            );

            expected.contains.forEach(text => {
                expect(feedback).toContain(text);
            });

            expected.notContains.forEach(text => {
                expect(feedback).not.toContain(text);
            });
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
            expect(feedback).toMatch(/<li.*text-danger.*>.*bi-x-circle.*At least 8 characters/);
        });

        test('includes all three criteria in output', () => {
            const feedback = generatePasswordFeedback(false, false, false);
            expect(feedback).toContain('At least 8 characters');
            expect(feedback).toContain('At least one letter');
            expect(feedback).toContain('At least one digit');
        });
    });
});
