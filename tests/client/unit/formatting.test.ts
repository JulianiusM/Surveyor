// tests/client/unit/formatting.test.ts
// Unit tests for core/formatting.ts utilities
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
    formatISOInTimeZone,
} from '../../../src/public/js/core/formatting';

describe('formatting utilities', () => {
    describe('padNumber', () => {
        test('pads single digit with zero by default', () => {
            expect(padNumber(5)).toBe('05');
        });

        test('does not pad double digit by default', () => {
            expect(padNumber(15)).toBe('15');
        });

        test('pads to specified length', () => {
            expect(padNumber(5, 3)).toBe('005');
            expect(padNumber(5, 4)).toBe('0005');
        });

        test('handles zero', () => {
            expect(padNumber(0)).toBe('00');
        });

        test('does not truncate longer numbers', () => {
            expect(padNumber(123, 2)).toBe('123');
        });
    });

    describe('formatDate', () => {
        test('formats valid date string', () => {
            const result = formatDate('2025-01-15');
            expect(result).toMatch(/1\/15\/2025|15\/1\/2025|2025-01-15/); // varies by locale
        });

        test('returns fallback for null', () => {
            expect(formatDate(null)).toBe('—');
        });

        test('returns fallback for undefined', () => {
            expect(formatDate(undefined)).toBe('—');
        });

        test('returns original string for invalid date', () => {
            expect(formatDate('invalid-date')).toBe('invalid-date');
        });

        test('accepts formatting options', () => {
            const result = formatDate('2025-01-15', { year: 'numeric', month: 'long', day: 'numeric' });
            expect(result).toContain('2025');
            expect(result).toContain('January');
        });
    });

    describe('formatDateTime', () => {
        test('formats valid datetime string', () => {
            const result = formatDateTime('2025-01-15T14:30:00');
            expect(result).toContain('2025');
            expect(result).toContain('1'); // day
            expect(result).toContain('15'); // day or month
        });

        test('returns fallback for null', () => {
            expect(formatDateTime(null)).toBe('—');
        });

        test('returns fallback for undefined', () => {
            expect(formatDateTime(undefined)).toBe('—');
        });

        test('returns fallback for invalid date', () => {
            expect(formatDateTime('invalid-date')).toBe('—');
        });
    });

    describe('formatISODate', () => {
        test('formats date as YYYY-MM-DD', () => {
            const date = new Date(Date.UTC(2025, 0, 15)); // Jan 15, 2025
            expect(formatISODate(date)).toBe('2025-01-15');
        });

        test('pads single digit month and day', () => {
            const date = new Date(Date.UTC(2025, 0, 5)); // Jan 5, 2025
            expect(formatISODate(date)).toBe('2025-01-05');
        });

        test('handles December', () => {
            const date = new Date(Date.UTC(2025, 11, 25)); // Dec 25, 2025
            expect(formatISODate(date)).toBe('2025-12-25');
        });
    });

    describe('parseISODate', () => {
        test('parses YYYY-MM-DD to Date', () => {
            const result = parseISODate('2025-01-15');
            expect(result.getUTCFullYear()).toBe(2025);
            expect(result.getUTCMonth()).toBe(0); // January = 0
            expect(result.getUTCDate()).toBe(15);
        });

        test('handles single digit month and day', () => {
            const result = parseISODate('2025-1-5');
            expect(result.getUTCFullYear()).toBe(2025);
            expect(result.getUTCMonth()).toBe(0);
            expect(result.getUTCDate()).toBe(5);
        });
    });

    describe('formatDateLabel', () => {
        test('formats valid date', () => {
            const result = formatDateLabel('2025-01-15');
            expect(result).toBeTruthy();
            expect(result).not.toBe('');
        });

        test('returns empty string for null', () => {
            expect(formatDateLabel(null)).toBe('');
        });

        test('returns empty string for undefined', () => {
            expect(formatDateLabel(undefined)).toBe('');
        });

        test('returns empty string for invalid date', () => {
            expect(formatDateLabel('invalid')).toBe('');
        });
    });

    describe('formatTimeLabel', () => {
        test('formats time as HH:MM', () => {
            expect(formatTimeLabel('14:30:00')).toBe('14:30');
        });

        test('handles short time string', () => {
            expect(formatTimeLabel('09:15')).toBe('09:15');
        });

        test('returns empty string for null', () => {
            expect(formatTimeLabel(null)).toBe('');
        });

        test('returns empty string for undefined', () => {
            expect(formatTimeLabel(undefined)).toBe('');
        });
    });

    describe('toDateTimeLocalValue', () => {
        test('converts Date to datetime-local format', () => {
            const date = new Date(2025, 0, 15, 14, 30); // Jan 15, 2025, 14:30
            const result = toDateTimeLocalValue(date);
            expect(result).toBe('2025-01-15T14:30');
        });

        test('converts ISO string to datetime-local format', () => {
            const result = toDateTimeLocalValue('2025-01-15T14:30:00Z');
            expect(result).toMatch(/2025-01-15T\d{2}:\d{2}/);
        });

        test('returns empty string for null', () => {
            expect(toDateTimeLocalValue(null)).toBe('');
        });

        test('returns empty string for undefined', () => {
            expect(toDateTimeLocalValue(undefined)).toBe('');
        });

        test('returns empty string for invalid date', () => {
            expect(toDateTimeLocalValue('invalid')).toBe('');
        });

        test('pads single digit values', () => {
            const date = new Date(2025, 0, 5, 9, 5); // Jan 5, 2025, 09:05
            expect(toDateTimeLocalValue(date)).toBe('2025-01-05T09:05');
        });
    });

    describe('toISOStringOrNull', () => {
        test('converts valid datetime-local to ISO string', () => {
            const result = toISOStringOrNull('2025-01-15T14:30');
            expect(result).toBeTruthy();
            expect(result).toContain('2025-01-15');
        });

        test('returns null for empty string', () => {
            expect(toISOStringOrNull('')).toBeNull();
        });

        test('returns null for invalid date', () => {
            expect(toISOStringOrNull('invalid')).toBeNull();
        });
    });

    describe('getValidDaysInWeek', () => {
        test('returns all 7 days when no restrictions', () => {
            const monday = new Date(2025, 0, 6); // Jan 6, 2025 (Monday)
            const start = new Date(2025, 0, 1);
            const end = new Date(2025, 0, 31);
            const result = getValidDaysInWeek(monday, start, end);
            expect(result).toHaveLength(7);
        });

        test('filters days before start date', () => {
            const monday = new Date(2025, 0, 6); // Jan 6, 2025 (Monday)
            const start = new Date(2025, 0, 8); // Jan 8 (Wednesday)
            const end = new Date(2025, 0, 31);
            const result = getValidDaysInWeek(monday, start, end);
            expect(result.length).toBeLessThan(7);
            result.forEach(day => {
                expect(day.getTime()).toBeGreaterThanOrEqual(start.getTime());
            });
        });

        test('filters days after end date', () => {
            const monday = new Date(2025, 0, 6); // Jan 6, 2025 (Monday)
            const start = new Date(2025, 0, 1);
            const end = new Date(2025, 0, 9); // Jan 9 (Thursday)
            const result = getValidDaysInWeek(monday, start, end);
            expect(result.length).toBeLessThan(7);
            result.forEach(day => {
                expect(day.getTime()).toBeLessThanOrEqual(end.getTime());
            });
        });

        test('returns empty array when week is outside range', () => {
            const monday = new Date(2025, 0, 6);
            const start = new Date(2025, 1, 1); // February
            const end = new Date(2025, 1, 28);
            const result = getValidDaysInWeek(monday, start, end);
            expect(result).toHaveLength(0);
        });
    });

    describe('formatISOInTimeZone', () => {
        test('formats date in specified timezone', () => {
            const date = new Date('2025-08-22T12:05:09Z');
            const result = formatISOInTimeZone(date, 'UTC');
            expect(result).toContain('2025-08-22');
            expect(result).toContain('T');
            expect(result).toMatch(/[+-]\d{2}:\d{2}$/); // ends with offset
        });

        test('includes timezone offset', () => {
            const date = new Date('2025-08-22T12:05:09Z');
            const result = formatISOInTimeZone(date, 'America/New_York');
            expect(result).toMatch(/[+-]\d{2}:\d{2}$/);
        });

        test('handles UTC timezone', () => {
            const date = new Date('2025-08-22T12:05:09Z');
            const result = formatISOInTimeZone(date, 'UTC');
            expect(result).toContain('+00:00');
        });
    });
});
