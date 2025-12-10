/**
 * Test keywords for formatting utilities
 * Reusable test actions for formatting function tests
 */

import {
    padNumber,
    formatDate,
    formatDateTime,
    formatISODate,
    parseISODate,
    formatDateLabel,
    formatTimeLabel,
    toDateTimeLocalValue,
    toISOStringOrNull,
    getValidDaysInWeek,
} from '../../../src/public/js/core/formatting';

/**
 * Test padNumber with given input and verify result
 */
export function testPadNumber(input: { num: number; length?: number }, expected: string): void {
    const result = input.length !== undefined ? padNumber(input.num, input.length) : padNumber(input.num);
    expect(result).toBe(expected);
}

/**
 * Test formatDate with pattern matching
 */
export function testFormatDateWithPattern(input: { date: string | null | undefined }, pattern: RegExp): void {
    const result = formatDate(input.date);
    expect(result).toMatch(pattern);
}

/**
 * Test formatDate with exact match
 */
export function testFormatDate(input: { date: string | null | undefined }, expected: string): void {
    const result = formatDate(input.date);
    expect(result).toBe(expected);
}

/**
 * Test formatDateTime
 */
export function testFormatDateTime(input: { date: string | null | undefined }, expected: string): void {
    const result = formatDateTime(input.date);
    expect(result).toBe(expected);
}

/**
 * Test formatISODate
 */
export function testFormatISODate(input: { date: Date }, expected: string): void {
    const result = formatISODate(input.date);
    expect(result).toBe(expected);
}

/**
 * Test parseISODate
 */
export function testParseISODate(input: { dateString: string }, expected: { year: number; month: number; day: number }): void {
    const result = parseISODate(input.dateString);
    expect(result.getUTCFullYear()).toBe(expected.year);
    expect(result.getUTCMonth()).toBe(expected.month);
    expect(result.getUTCDate()).toBe(expected.day);
}

/**
 * Test formatDateLabel
 */
export function testFormatDateLabel(input: { date: string | null | undefined }, expected: string): void {
    const result = formatDateLabel(input.date);
    expect(result).toBe(expected);
}

/**
 * Test formatTimeLabel
 */
export function testFormatTimeLabel(input: { time: string | null | undefined }, expected: string): void {
    const result = formatTimeLabel(input.time);
    expect(result).toBe(expected);
}

/**
 * Test toDateTimeLocalValue
 */
export function testToDateTimeLocalValue(input: { date: string | Date | null | undefined }, expected: string): void {
    const result = toDateTimeLocalValue(input.date);
    expect(result).toBe(expected);
}

/**
 * Test toISOStringOrNull
 */
export function testToISOStringOrNull(input: { value: string }, expected: string | null): void {
    const result = toISOStringOrNull(input.value);
    if (expected === null) {
        expect(result).toBeNull();
    } else {
        expect(result).toBeTruthy();
        expect(result).toContain(expected);
    }
}

/**
 * Test getValidDaysInWeek
 */
export function testGetValidDaysInWeek(
    input: { monday: Date; start: Date; end: Date },
    expectedLength: number
): void {
    const result = getValidDaysInWeek(input.monday, input.start, input.end);
    expect(result).toHaveLength(expectedLength);
    
    // Verify all returned days are within range
    if (expectedLength > 0) {
        result.forEach(day => {
            expect(day.getTime()).toBeGreaterThanOrEqual(input.start.getTime());
            expect(day.getTime()).toBeLessThanOrEqual(input.end.getTime());
        });
    }
}
