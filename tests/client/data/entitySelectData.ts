/**
 * Test data for entity-select.ts
 * Data-driven test cases for entity selection UI
 */

export const entitySelectInitData = [
    {
        description: 'should initialize with provided value',
        id: 'event-select',
        entities: [
            { id: 1, title: 'Event 1', description: 'First event' },
            { id: 2, title: 'Event 2', description: 'Second event' },
            { id: 3, title: 'Event 3', description: 'Third event' },
        ],
        opts: { value: '2', placeholderLabel: 'Select an event' },
        expectedValue: '2',
        expectedLabel: 'Event 2',
    },
    {
        description: 'should initialize with placeholder when no value provided',
        id: 'empty-select',
        entities: [
            { id: 1, title: 'Item 1' },
        ],
        opts: { placeholderLabel: 'Choose item' },
        expectedValue: '',
        expectedLabel: 'Choose item',
    },
    {
        description: 'should handle entities with dateIso and description',
        id: 'dated-select',
        entities: [
            { id: 10, title: 'Event A', dateIso: '2024-01-15', description: 'Description A' },
            { id: 20, title: 'Event B', dateIso: '2024-02-20', description: 'Description B' },
        ],
        opts: { value: '10' },
        expectedValue: '10',
        expectedLabel: 'Event A',
    },
];

export const entitySelectFilterData = [
    {
        description: 'should filter by title',
        query: 'event 2',
        entities: [
            { id: 1, title: 'Event 1' },
            { id: 2, title: 'Event 2' },
            { id: 3, title: 'Event 3' },
        ],
        expectedMatches: ['2'],
    },
    {
        description: 'should filter by description',
        query: 'second',
        entities: [
            { id: 1, title: 'Event 1', description: 'first event' },
            { id: 2, title: 'Event 2', description: 'second event' },
            { id: 3, title: 'Event 3', description: 'third event' },
        ],
        expectedMatches: ['2'],
    },
    {
        description: 'should show all when query is empty',
        query: '',
        entities: [
            { id: 1, title: 'Event 1' },
            { id: 2, title: 'Event 2' },
        ],
        expectedMatches: ['1', '2'],
    },
    {
        description: 'should show empty state when no matches',
        query: 'nonexistent',
        entities: [
            { id: 1, title: 'Event 1' },
        ],
        expectedMatches: [],
        expectedEmpty: true,
    },
];

export const entitySelectSelectionData = [
    {
        description: 'should select entity when clicked',
        entityId: '2',
        expectedValue: '2',
    },
    {
        description: 'should update button label on selection',
        entityId: '1',
        expectedLabel: 'Event 1',
    },
];
