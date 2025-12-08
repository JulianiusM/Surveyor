/**
 * Test data for event-participant module
 */

export const participantRowsData = [
    {
        description: 'should render participant with all fields',
        participant: {
            id: 1,
            name: 'John Doe',
            email: 'john@example.com',
            userId: 123,
            arrivalDate: '2024-01-15',
            departureDate: '2024-01-20',
            dietaryChoices: [
                {choice: 'VEGETARIAN', additionalInfo: null},
                {choice: 'ALLERGIES', additionalInfo: 'Peanuts, shellfish'},
            ],
        },
        canUpdate: true,
        canDelete: true,
        expectedIncludes: ['John Doe', 'john@example.com', 'VEGETARIAN', 'ALLERGIES'],
    },
    {
        description: 'should render guest participant without email',
        participant: {
            id: 2,
            name: 'Guest User',
            email: null,
            userId: null,
            arrivalDate: '2024-01-16',
            departureDate: '2024-01-18',
            dietaryChoices: [],
        },
        canUpdate: false,
        canDelete: false,
        expectedIncludes: ['Guest User'],
    },
    {
        description: 'should render participant with no dietary choices',
        participant: {
            id: 3,
            name: 'Jane Smith',
            email: 'jane@example.com',
            userId: 456,
            arrivalDate: '2024-01-17',
            departureDate: '2024-01-19',
            dietaryChoices: [],
        },
        canUpdate: true,
        canDelete: true,
        expectedIncludes: ['Jane Smith', 'jane@example.com'],
    },
];

export const filterTestData = [
    {
        description: 'should filter by name',
        query: 'john',
        participants: [
            {name: 'John Doe', email: 'john@example.com', dietaryChoices: []},
            {name: 'Jane Smith', email: 'jane@example.com', dietaryChoices: []},
        ],
        expectedVisible: ['John Doe'],
        expectedHidden: ['Jane Smith'],
    },
    {
        description: 'should filter by email',
        query: 'jane@',
        participants: [
            {name: 'John Doe', email: 'john@example.com', dietaryChoices: []},
            {name: 'Jane Smith', email: 'jane@example.com', dietaryChoices: []},
        ],
        expectedVisible: ['Jane Smith'],
        expectedHidden: ['John Doe'],
    },
    {
        description: 'should filter by dietary choice',
        query: 'vegetarian',
        participants: [
            {name: 'John Doe', email: 'john@example.com', dietaryChoices: [{choice: 'VEGETARIAN'}]},
            {name: 'Jane Smith', email: 'jane@example.com', dietaryChoices: []},
        ],
        expectedVisible: ['John Doe'],
        expectedHidden: ['Jane Smith'],
    },
    {
        description: 'should show all when query is empty',
        query: '',
        participants: [
            {name: 'John Doe', email: 'john@example.com', dietaryChoices: []},
            {name: 'Jane Smith', email: 'jane@example.com', dietaryChoices: []},
        ],
        expectedVisible: ['John Doe', 'Jane Smith'],
        expectedHidden: [],
    },
];

export const totalsTestData = [
    {
        description: 'should render dietary totals with proper styling',
        totals: {VEGETARIAN: 3, VEGAN: 2, ALLERGIES: 1},
        expectedCount: 3,
        expectedTexts: ['VEGETARIAN: 3', 'VEGAN: 2', 'ALLERGIES: 1'],
    },
    {
        description: 'should render empty totals',
        totals: {},
        expectedCount: 0,
        expectedTexts: ['Totals: —'],
    },
    {
        description: 'should filter out zero totals',
        totals: {VEGETARIAN: 3, VEGAN: 0, ALLERGIES: 2},
        expectedCount: 2,
        expectedTexts: ['VEGETARIAN: 3', 'ALLERGIES: 2'],
    },
];
