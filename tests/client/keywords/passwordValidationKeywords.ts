/**
 * Test keywords for password validation
 * Reusable test actions for password validation tests
 */

import {
    isPasswordValid,
    isPasswordRepeatValid,
    generatePasswordFeedback,
} from '../../../src/public/js/core/password-validation';

/**
 * Test password validity
 */
export function testPasswordValidity(input: { password: string | undefined }, expected: boolean): void {
    const result = isPasswordValid(input.password);
    expect(result).toBe(expected);
}

/**
 * Test password repeat validity
 */
export function testPasswordRepeatValidity(
    input: { password: string | undefined; passwordRepeat: string | undefined },
    expected: boolean
): void {
    const result = isPasswordRepeatValid(input.password, input.passwordRepeat);
    expect(result).toBe(expected);
}

/**
 * Test password feedback generation
 */
export function testPasswordFeedback(
    input: { hasEight: boolean; hasLetter: boolean; hasDigit: boolean },
    expectedToContain: string[],
    expectedNotToContain?: string[]
): void {
    const feedback = generatePasswordFeedback(input.hasEight, input.hasLetter, input.hasDigit);
    
    expectedToContain.forEach(text => {
        expect(feedback).toContain(text);
    });
    
    if (expectedNotToContain) {
        expectedNotToContain.forEach(text => {
            expect(feedback).not.toContain(text);
        });
    }
}

/**
 * Verify password feedback has correct structure
 */
export function verifyPasswordFeedbackStructure(
    input: { hasEight: boolean; hasLetter: boolean; hasDigit: boolean }
): void {
    const feedback = generatePasswordFeedback(input.hasEight, input.hasLetter, input.hasDigit);
    
    expect(feedback).toContain('<ul class="list-unstyled mb-0 mt-1">');
    expect(feedback).toContain('</ul>');
    expect(feedback).toContain('<li');
    expect(feedback).toMatch(/<li.*>.*<\/li>/);
    
    // Verify all three criteria are present
    expect(feedback).toContain('At least 8 characters');
    expect(feedback).toContain('At least one letter');
    expect(feedback).toContain('At least one digit');
}
