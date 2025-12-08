/**
 * Test data for entity-assign.ts
 */

export const initAssignButtonsData = [
    {
        description: 'handles assign action successfully',
        action: 'assign',
        itemId: '123',
        currentCount: 5,
        maxCount: 10,
        expectedCount: 6,
        expectedButton: {
            action: 'unassign',
            classList: ['btn-outline-danger'],
            text: 'Remove',
        },
        showBadge: false,
    },
    {
        description: 'shows full badge when reaching max',
        action: 'assign',
        itemId: '456',
        currentCount: 9,
        maxCount: 10,
        expectedCount: 10,
        expectedButton: {
            action: 'unassign',
            classList: ['btn-outline-danger'],
            text: 'Remove',
        },
        showBadge: true,
    },
    {
        description: 'handles unassign action successfully',
        action: 'unassign',
        itemId: '789',
        currentCount: 10,
        maxCount: 10,
        expectedCount: 9,
        expectedButton: {
            action: 'assign',
            classList: ['btn-outline-success'],
            text: 'Take',
        },
        showBadge: false,
    },
    {
        description: 'removes badge when unassigning from full',
        action: 'unassign',
        itemId: '101',
        currentCount: 10,
        maxCount: 10,
        expectedCount: 9,
        expectedButton: {
            action: 'assign',
            classList: ['btn-outline-success'],
            text: 'Take',
        },
        showBadge: false,
        initialBadge: true,
    },
];

export const configData = [
    {
        description: 'uses default reload delay',
        config: {
            tableSelector: '#test-table',
            baseUrl: '/api/test',
        },
        expectedReloadDelay: 100,
    },
    {
        description: 'uses custom reload delay',
        config: {
            tableSelector: '#test-table',
            baseUrl: '/api/test',
            reloadDelay: 500,
        },
        expectedReloadDelay: 500,
    },
];
