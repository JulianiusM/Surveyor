/**
 * Test data for survey service database integration tests
 */

export interface SurveyCombinationInput {
    weekday: string;
    week: string;
}

export interface SurveyServiceTestCase {
    description: string;
    userId: number;
    title: string;
    descriptionText: string;
    combinations: SurveyCombinationInput[];
    expectedCombinationsOrder: Array<[string, string]>;
    newCombination?: SurveyCombinationInput;
}

export const createSurveyTestData: SurveyServiceTestCase[] = [
    {
        description: 'creates survey with enum combos sorted by weekday ASC, nthWeek ASC',
        userId: 1,
        title: 'Team Lunch',
        descriptionText: 'Pick a weekday',
        combinations: [
            { weekday: 'WED', week: '2' },
            { weekday: 'MON', week: '3' },
            { weekday: 'MON', week: '1' },
        ],
        expectedCombinationsOrder: [
            ['MON', '1'],
            ['MON', '3'],
            ['WED', '2'],
        ],
        newCombination: { weekday: 'TUE', week: '4' },
    },
];

export interface ResponseTestUser {
    id: number;
    username: string;
    name: string;
    email: string;
}

export interface ResponseTestGuest {
    id: number;
    username: string;
}

export interface ResponseInput {
    principalType: 'user' | 'guest';
    principalId: number;
    combinationIndex: number;
    answer: 'yes' | 'no' | 'maybe' | undefined;
}

export interface ResponseServiceTestCase {
    description: string;
    ownerId: number;
    additionalUsers: ResponseTestUser[];
    guests: ResponseTestGuest[];
    title: string;
    descriptionText: string;
    combinations: SurveyCombinationInput[];
    responses: ResponseInput[];
    expectedGroupedKeys: string[];
    expectedUserAnswers: Record<string, string[]>;
    expectedGuestAnswers: Record<string, string[]>;
    guestLinkConfig?: {
        guestId: number;
        token: string;
    };
    deletions?: {
        deleteUserId?: number;
        deleteGuestId?: number;
        expectedAfterUserDelete?: Record<string, number>;
        expectedAfterGuestDelete?: Record<string, number>;
    };
}

export const responseTestData: ResponseServiceTestCase[] = [
    {
        description: 'handles user/guest responses, grouping/sorting, and guest link',
        ownerId: 1,
        additionalUsers: [
            {
                id: 2,
                username: 'u2',
                name: 'User Two',
                email: 'u2@example.com',
            },
        ],
        guests: [
            {
                id: 10,
                username: 'guest10',
            },
        ],
        title: 'Retro',
        descriptionText: 'When can you join?',
        combinations: [
            { weekday: 'TUE', week: '1' },
            { weekday: 'THU', week: '2' },
            { weekday: 'THU', week: '3' },
        ],
        responses: [
            { principalType: 'user', principalId: 2, combinationIndex: 0, answer: 'yes' },
            { principalType: 'user', principalId: 2, combinationIndex: 1, answer: undefined },
            { principalType: 'guest', principalId: 10, combinationIndex: 0, answer: 'maybe' },
            { principalType: 'guest', principalId: 10, combinationIndex: 1, answer: 'yes' },
        ],
        expectedGroupedKeys: ['g_10', 'u_2'],
        expectedUserAnswers: {
            u_2: ['no', 'yes'], // undefined defaults to 'no'
        },
        expectedGuestAnswers: {
            g_10: ['maybe', 'yes'],
        },
        guestLinkConfig: {
            guestId: 10,
            token: 'irrelevant',
        },
        deletions: {
            deleteUserId: 2,
            deleteGuestId: 10,
            expectedAfterUserDelete: { u_2: 0, g_10: 2 },
            expectedAfterGuestDelete: { u_2: 0, g_10: 0 },
        },
    },
];
