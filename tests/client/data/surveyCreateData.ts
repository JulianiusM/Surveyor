/**
 * Test data for survey-create.ts module
 */

export const surveyCreateTestData = {
    formElements: {
        combinationTable: { id: 'combinationTable' },
        addCombinationBtn: { id: 'addCombinationBtn' },
    },
    weekdays: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'],
    weeks: ['1', '2', '3', '4', 'LAST'],
    prefilledCombinations: [
        { weekday: 'MON', nth_week: '1' },
        { weekday: 'WED', nth_week: 'LAST' },
        { weekday: 'FRI', nth_week: '3' },
    ],
};
