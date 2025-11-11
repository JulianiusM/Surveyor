/**
 * Test data for survey controller tests
 * Data-driven test cases for survey preprocessing, creation, validation, and operations
 */

import type { SurveyCombination } from '../../../src/modules/database/entities/survey/SurveyCombination';

/**
 * Test cases for preprocessCreate function
 */
export const preprocessCreateData = [
    {
        description: 'normalizes combos (array) and trims strings; description "" -> null',
        input: {
            title: '  My Survey  ',
            description: '',
            combinations: [
                { weekday: 'MON', week: 1 },
                { weekday: 'FRI', week: 'LAST' },
            ],
        },
        expected: {
            title: 'My Survey',
            description: null,
            combinations: [
                { weekday: 'MON', nthWeek: '1' },
                { weekday: 'FRI', nthWeek: 'LAST' },
            ],
        },
    },
    {
        description: 'accepts combos object with numeric keys (qs-style) and validates',
        input: {
            title: 'Weekly',
            description: '  desc ',
            combinations: {
                0: { weekday: 'WED', week: 3 },
                1: { weekday: 'SUN', week: 'LAST' },
            },
        },
        expected: {
            title: 'Weekly',
            description: 'desc',
            combinations: [
                { weekday: 'WED', nthWeek: '3' },
                { weekday: 'SUN', nthWeek: 'LAST' },
            ],
        },
    },
    {
        description: 'handles single combination',
        input: {
            title: 'Single Combo',
            description: 'Test',
            combinations: [
                { weekday: 'TUE', week: 2 },
            ],
        },
        expected: {
            title: 'Single Combo',
            description: 'Test',
            combinations: [
                { weekday: 'TUE', nthWeek: '2' },
            ],
        },
    },
    {
        description: 'handles all valid weekdays',
        input: {
            title: 'All Weekdays',
            description: 'Full week',
            combinations: [
                { weekday: 'MON', week: 1 },
                { weekday: 'TUE', week: 1 },
                { weekday: 'WED', week: 1 },
                { weekday: 'THU', week: 1 },
                { weekday: 'FRI', week: 1 },
                { weekday: 'SAT', week: 1 },
                { weekday: 'SUN', week: 1 },
            ],
        },
        expected: {
            title: 'All Weekdays',
            description: 'Full week',
            combinations: [
                { weekday: 'MON', nthWeek: '1' },
                { weekday: 'TUE', nthWeek: '1' },
                { weekday: 'WED', nthWeek: '1' },
                { weekday: 'THU', nthWeek: '1' },
                { weekday: 'FRI', nthWeek: '1' },
                { weekday: 'SAT', nthWeek: '1' },
                { weekday: 'SUN', nthWeek: '1' },
            ],
        },
    },
];

/**
 * Test cases that should throw ValidationError in preprocessCreate
 */
export const preprocessCreateErrorData = [
    {
        description: 'missing title',
        input: {
            description: '',
            combinations: [{ weekday: 'MON', week: 1 }],
        },
        errorType: 'ValidationError',
        errorMessage: /title/i,
    },
    {
        description: 'empty title after trim',
        input: {
            title: '   ',
            description: '',
            combinations: [{ weekday: 'MON', week: 1 }],
        },
        errorType: 'ValidationError',
        errorMessage: /title/i,
    },
    {
        description: 'empty combinations array',
        input: {
            title: 'X',
            description: '',
            combinations: [],
        },
        errorType: 'ValidationError',
        errorMessage: /combination/i,
    },
    {
        description: 'invalid weekday',
        input: {
            title: 'X',
            description: '',
            combinations: [{ weekday: 'XXX', week: 1 }],
        },
        errorType: 'ValidationError',
        errorMessage: /weekday/i,
    },
    {
        description: 'invalid week number (0)',
        input: {
            title: 'X',
            description: '',
            combinations: [{ weekday: 'MON', week: 0 }],
        },
        errorType: 'ValidationError',
        errorMessage: /week/i,
    },
    {
        description: 'invalid week number (9)',
        input: {
            title: 'X',
            description: '',
            combinations: [{ weekday: 'MON', week: 9 }],
        },
        errorType: 'ValidationError',
        errorMessage: /week/i,
    },
    {
        description: 'invalid week string',
        input: {
            title: 'X',
            description: '',
            combinations: [{ weekday: 'MON', week: 'INVALID' }],
        },
        errorType: 'ValidationError',
        errorMessage: /week/i,
    },
];

/**
 * Test cases for createEntity function
 */
export const createEntityData = [
    {
        description: 'creates survey with basic data',
        userId: 42,
        payload: {
            title: 'Test Survey',
            description: 'Test Description',
            combinations: [
                { weekday: 'MON', nthWeek: '1' },
                { weekday: 'FRI', nthWeek: 'LAST' },
            ],
        },
        expectedServiceCall: {
            userId: 42,
            title: 'Test Survey',
            description: 'Test Description',
            combinations: [
                { weekday: 'MON', week: '1' },
                { weekday: 'FRI', week: 'LAST' },
            ],
        },
        mockReturnValue: 'survey-123',
    },
    {
        description: 'creates survey with null description',
        userId: 10,
        payload: {
            title: 'Simple',
            description: null,
            combinations: [
                { weekday: 'WED', nthWeek: '2' },
            ],
        },
        expectedServiceCall: {
            userId: 10,
            title: 'Simple',
            description: null,
            combinations: [
                { weekday: 'WED', week: '2' },
            ],
        },
        mockReturnValue: 'survey-456',
    },
];

/**
 * Test cases for submitResponses function
 */
export const submitResponsesData = [
    {
        description: 'USER session: deletes then saves per combination',
        survey: { id: 's1' },
        session: { user: { id: 7 } },
        answers: { '10': 'YES', '11': 'NO' },
        expected: {
            deleteCall: { type: 'user', id: 7, surveyId: 's1' },
            saveCalls: [
                { type: 'user', surveyId: 's1', userId: 7, combinationId: 10, response: 'YES' },
                { type: 'user', surveyId: 's1', userId: 7, combinationId: 11, response: 'NO' },
            ],
        },
    },
    {
        description: 'GUEST session: deletes then saves per combination',
        survey: { id: 's1' },
        session: { guest: { id: 9 } },
        answers: { '10': 'YES', '11': 'NO' },
        expected: {
            deleteCall: { type: 'guest', id: 9, surveyId: 's1' },
            saveCalls: [
                { type: 'guest', surveyId: 's1', guestId: 9, combinationId: 10, response: 'YES' },
                { type: 'guest', surveyId: 's1', guestId: 9, combinationId: 11, response: 'NO' },
            ],
        },
    },
    {
        description: 'USER session with multiple responses',
        survey: { id: 's2' },
        session: { user: { id: 15 } },
        answers: { '1': 'YES', '2': 'NO', '3': 'MAYBE', '4': 'YES' },
        expected: {
            deleteCall: { type: 'user', id: 15, surveyId: 's2' },
            saveCalls: [
                { type: 'user', surveyId: 's2', userId: 15, combinationId: 1, response: 'YES' },
                { type: 'user', surveyId: 's2', userId: 15, combinationId: 2, response: 'NO' },
                { type: 'user', surveyId: 's2', userId: 15, combinationId: 3, response: 'MAYBE' },
                { type: 'user', surveyId: 's2', userId: 15, combinationId: 4, response: 'YES' },
            ],
        },
    },
    {
        description: 'no-op when session has neither user nor guest',
        survey: { id: 's1' },
        session: {},
        answers: { '10': 'YES' },
        expected: {
            deleteCall: null,
            saveCalls: [],
        },
    },
];

/**
 * Test cases for addCombination function
 */
export const addCombinationData = [
    {
        description: 'adds combination with valid data',
        survey: { id: 's1' },
        weekday: 'MON',
        nth: 2,
        shouldSucceed: true,
    },
    {
        description: 'adds combination with LAST week',
        survey: { id: 's2' },
        weekday: 'FRI',
        nth: 'LAST',
        shouldSucceed: true,
    },
];

/**
 * Test cases that should throw ExpectedError in addCombination
 */
export const addCombinationErrorData = [
    {
        description: 'missing weekday',
        survey: { id: 's1' },
        weekday: undefined,
        nth: 2,
        errorType: 'ExpectedError',
    },
    {
        description: 'missing nth',
        survey: { id: 's1' },
        weekday: 'MON',
        nth: undefined,
        errorType: 'ExpectedError',
    },
    {
        description: 'both missing',
        survey: { id: 's1' },
        weekday: undefined,
        nth: undefined,
        errorType: 'ExpectedError',
    },
];

/**
 * Test cases for afterCreateItems function
 */
export const afterCreateItemsData = [
    {
        description: 'is a no-op that resolves',
        expected: undefined,
    },
];

/**
 * Test cases for fetchForView function
 */
export const fetchForViewData = [
    {
        description: 'returns survey, combinations, responses (delegates to service)',
        survey: { id: 's1' },
        mockCombos: [{ id: 1 }],
        mockResponses: [{ userId: 7 }],
        expected: {
            survey: { id: 's1' },
            combinations: [{ id: 1 }],
            responses: [{ userId: 7 }],
        },
    },
    {
        description: 'handles different survey data',
        survey: { id: 's5', title: 'Test Survey' },
        mockCombos: [{ id: 10 }, { id: 11 }],
        mockResponses: [{ userId: 1 }, { userId: 2 }],
        expected: {
            survey: { id: 's5', title: 'Test Survey' },
            combinations: [{ id: 10 }, { id: 11 }],
            responses: [{ userId: 1 }, { userId: 2 }],
        },
    },
];

/**
 * Test cases for fetchForDuplicate function
 */
export const fetchForDuplicateData = [
    {
        description: 'returns combinations by survey id',
        survey: { id: 's2' },
        mockCombos: [{ id: 2 }],
        expectedSurveyId: 's2',
    },
    {
        description: 'handles different survey id',
        survey: { id: 's10' },
        mockCombos: [{ id: 20 }, { id: 21 }],
        expectedSurveyId: 's10',
    },
];

/**
 * Test cases for deleteEntity function
 */
export const deleteEntityData = [
    {
        description: 'delegates to deleteSurvey',
        survey: { id: 's9' },
        expectedSurveyId: 's9',
    },
    {
        description: 'handles different survey id',
        survey: { id: 's100' },
        expectedSurveyId: 's100',
    },
];
