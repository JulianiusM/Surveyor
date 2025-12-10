/**
 * Test data for formatting utilities
 * Data-driven test cases for date/time formatting functions
 */

import {deepCopy} from "../helpers/util";

/**
 * Test cases for padNumber function
 */
const _padNumberData = [
    {
        description: 'pads single digit with zero by default',
        input: {num: 5},
        expected: '05',
    },
    {
        description: 'does not pad double digit by default',
        input: {num: 15},
        expected: '15',
    },
    {
        description: 'pads to specified length',
        input: {num: 5, length: 3},
        expected: '005',
    },
    {
        description: 'pads to length 4',
        input: {num: 5, length: 4},
        expected: '0005',
    },
    {
        description: 'handles zero',
        input: {num: 0},
        expected: '00',
    },
    {
        description: 'does not truncate longer numbers',
        input: {num: 123, length: 2},
        expected: '123',
    },
];

export const padNumberData = () => deepCopy(_padNumberData) as typeof _padNumberData;

/**
 * Test cases for formatDate function
 */
const _formatDateData = [
    {
        description: 'formats valid date string',
        input: {date: '2025-01-15'},
        expectedPattern: /1\/15\/2025|15\/1\/2025|2025-01-15|15\.1\.2025|15\.01\.2025|2025\.01\.15/, // varies by locale
    },
    {
        description: 'returns fallback for null',
        input: {date: null},
        expected: '—',
    },
    {
        description: 'returns fallback for undefined',
        input: {date: undefined},
        expected: '—',
    },
    {
        description: 'returns original string for invalid date',
        input: {date: 'invalid-date'},
        expected: 'invalid-date',
    },
];

export const formatDateData = () => deepCopy(_formatDateData) as typeof _formatDateData;

/**
 * Test cases for formatDateTime function
 */
const _formatDateTimeData = [
    {
        description: 'returns fallback for null',
        input: {date: null},
        expected: '—',
    },
    {
        description: 'returns fallback for undefined',
        input: {date: undefined},
        expected: '—',
    },
    {
        description: 'returns fallback for invalid date',
        input: {date: 'invalid-date'},
        expected: '—',
    },
];

export const formatDateTimeData = () => deepCopy(_formatDateTimeData) as typeof _formatDateTimeData;

/**
 * Test cases for formatISODate function
 */
const _formatISODateData = [
    {
        description: 'formats date as YYYY-MM-DD',
        input: {date: new Date(Date.UTC(2025, 0, 15))},
        expected: '2025-01-15',
    },
    {
        description: 'pads single digit month and day',
        input: {date: new Date(Date.UTC(2025, 0, 5))},
        expected: '2025-01-05',
    },
    {
        description: 'handles December',
        input: {date: new Date(Date.UTC(2025, 11, 25))},
        expected: '2025-12-25',
    },
];

export const formatISODateData = () => deepCopy(_formatISODateData) as typeof _formatISODateData;

/**
 * Test cases for parseISODate function
 */
const _parseISODateData = [
    {
        description: 'parses YYYY-MM-DD to Date',
        input: {dateString: '2025-01-15'},
        expected: {year: 2025, month: 0, day: 15},
    },
    {
        description: 'handles single digit month and day',
        input: {dateString: '2025-1-5'},
        expected: {year: 2025, month: 0, day: 5},
    },
];

export const parseISODateData = () => deepCopy(_parseISODateData) as typeof _parseISODateData;

/**
 * Test cases for formatDateLabel function
 */
const _formatDateLabelData = [
    {
        description: 'returns empty string for null',
        input: {date: null},
        expected: '',
    },
    {
        description: 'returns empty string for undefined',
        input: {date: undefined},
        expected: '',
    },
    {
        description: 'returns empty string for invalid date',
        input: {date: 'invalid'},
        expected: '',
    },
];

export const formatDateLabelData = () => deepCopy(_formatDateLabelData) as typeof _formatDateLabelData;

/**
 * Test cases for formatTimeLabel function
 */
const _formatTimeLabelData = [
    {
        description: 'formats time as HH:MM',
        input: {time: '14:30:00'},
        expected: '14:30',
    },
    {
        description: 'handles short time string',
        input: {time: '09:15'},
        expected: '09:15',
    },
    {
        description: 'returns empty string for null',
        input: {time: null},
        expected: '',
    },
    {
        description: 'returns empty string for undefined',
        input: {time: undefined},
        expected: '',
    },
];

export const formatTimeLabelData = () => deepCopy(_formatTimeLabelData) as typeof _formatTimeLabelData;

/**
 * Test cases for toDateTimeLocalValue function
 */
const _toDateTimeLocalValueData = [
    {
        description: 'converts Date to datetime-local format',
        input: {date: new Date(2025, 0, 15, 14, 30)},
        expected: '2025-01-15T14:30',
    },
    {
        description: 'returns empty string for null',
        input: {date: null},
        expected: '',
    },
    {
        description: 'returns empty string for undefined',
        input: {date: undefined},
        expected: '',
    },
    {
        description: 'returns empty string for invalid date',
        input: {date: 'invalid'},
        expected: '',
    },
    {
        description: 'pads single digit values',
        input: {date: new Date(2025, 0, 5, 9, 5)},
        expected: '2025-01-05T09:05',
    },
];

export const toDateTimeLocalValueData = () => deepCopy(_toDateTimeLocalValueData) as typeof _toDateTimeLocalValueData;

/**
 * Test cases for toISOStringOrNull function
 */
const _toISOStringOrNullData = [
    {
        description: 'returns null for empty string',
        input: {value: ''},
        expected: null,
    },
    {
        description: 'returns null for invalid date',
        input: {value: 'invalid'},
        expected: null,
    },
];

export const toISOStringOrNullData = () => deepCopy(_toISOStringOrNullData) as typeof _toISOStringOrNullData;

/**
 * Test cases for getValidDaysInWeek function
 */
const _getValidDaysInWeekData = [
    {
        description: 'returns all 7 days when no restrictions',
        input: {
            monday: new Date(2025, 0, 6),
            start: new Date(2025, 0, 1),
            end: new Date(2025, 0, 31),
        },
        expectedLength: 7,
    },
    {
        description: 'returns empty array when week is outside range',
        input: {
            monday: new Date(2025, 0, 6),
            start: new Date(2025, 1, 1),
            end: new Date(2025, 1, 28),
        },
        expectedLength: 0,
    },
];

export const getValidDaysInWeekData = () => deepCopy(_getValidDaysInWeekData) as typeof _getValidDaysInWeekData;
