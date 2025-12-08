// tests/client/unit/formatting.test.ts
// Unit tests for core/formatting.ts utilities
// Uses data-driven and keyword-driven testing approach
import { formatISOInTimeZone } from '../../../src/public/js/core/formatting';

// Import test data
import {
    padNumberData,
    formatDateData,
    formatDateTimeData,
    formatISODateData,
    parseISODateData,
    formatDateLabelData,
    formatTimeLabelData,
    toDateTimeLocalValueData,
    toISOStringOrNullData,
    getValidDaysInWeekData,
} from '../data/formattingData';

// Import test keywords
import {
    testPadNumber,
    testFormatDate,
    testFormatDateWithPattern,
    testFormatDateTime,
    testFormatISODate,
    testParseISODate,
    testFormatDateLabel,
    testFormatTimeLabel,
    testToDateTimeLocalValue,
    testToISOStringOrNull,
    testGetValidDaysInWeek,
} from '../keywords/formattingKeywords';

describe('formatting utilities', () => {
    describe('padNumber - Data Driven', () => {
        test.each(padNumberData)(
            '$description',
            ({ input, expected }) => {
                testPadNumber(input, expected);
            }
        );
    });

    describe('formatDate - Data Driven', () => {
        test.each(formatDateData.filter(d => 'expected' in d))(
            '$description',
            ({ input, expected }) => {
                testFormatDate(input, expected as string);
            }
        );
        
        test.each(formatDateData.filter(d => 'expectedPattern' in d))(
            '$description',
            ({ input, expectedPattern }) => {
                testFormatDateWithPattern(input, expectedPattern as RegExp);
            }
        );
    });

    describe('formatDateTime - Data Driven', () => {
        test.each(formatDateTimeData)(
            '$description',
            ({ input, expected }) => {
                testFormatDateTime(input, expected);
            }
        );
    });

    describe('formatISODate - Data Driven', () => {
        test.each(formatISODateData)(
            '$description',
            ({ input, expected }) => {
                testFormatISODate(input, expected);
            }
        );
    });

    describe('parseISODate - Data Driven', () => {
        test.each(parseISODateData)(
            '$description',
            ({ input, expected }) => {
                testParseISODate(input, expected);
            }
        );
    });

    describe('formatDateLabel - Data Driven', () => {
        test.each(formatDateLabelData)(
            '$description',
            ({ input, expected }) => {
                testFormatDateLabel(input, expected);
            }
        );
    });

    describe('formatTimeLabel - Data Driven', () => {
        test.each(formatTimeLabelData)(
            '$description',
            ({ input, expected }) => {
                testFormatTimeLabel(input, expected);
            }
        );
    });

    describe('toDateTimeLocalValue - Data Driven', () => {
        test.each(toDateTimeLocalValueData)(
            '$description',
            ({ input, expected }) => {
                testToDateTimeLocalValue(input, expected);
            }
        );
    });

    describe('toISOStringOrNull - Data Driven', () => {
        test.each(toISOStringOrNullData)(
            '$description',
            ({ input, expected }) => {
                testToISOStringOrNull(input, expected);
            }
        );
        
        test('converts valid datetime-local to ISO string', () => {
            testToISOStringOrNull({ value: '2025-01-15T14:30' }, '2025-01-15');
        });
    });

    describe('getValidDaysInWeek - Data Driven', () => {
        test.each(getValidDaysInWeekData)(
            '$description',
            ({ input, expectedLength }) => {
                testGetValidDaysInWeek(input, expectedLength);
            }
        );
        
        test('filters days before start date', () => {
            const monday = new Date(2025, 0, 6);
            const start = new Date(2025, 0, 8);
            const end = new Date(2025, 0, 31);
            testGetValidDaysInWeek({ monday, start, end }, 5); // Wed-Sun = 5 days
        });

        test('filters days after end date', () => {
            const monday = new Date(2025, 0, 6);
            const start = new Date(2025, 0, 1);
            const end = new Date(2025, 0, 9);
            testGetValidDaysInWeek({ monday, start, end }, 4); // Mon-Thu = 4 days
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
