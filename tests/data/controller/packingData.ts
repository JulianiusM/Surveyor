/**
 * Test data for packing controller tests
 */

export const preprocessCreateData = [
    {
        description: 'parses, validates, and normalizes a valid payload',
        input: {
            title: 'Trip packing',
            description: '',
            event_id: '',
            items: JSON.stringify([
                {title: 'Tent', description: '', maxAssignees: 1, requiredByAll: true},
                {title: 'Stove', description: 'gas', maxAssignees: 2, requiredByAll: false},
            ]),
        },
        expected: {
            title: 'Trip packing',
            description: null,
            itemsLength: 2,
            firstItem: {title: 'Tent', requiredByAll: true, maxAssignees: 1},
        },
    },
    {
        description: 'throws ValidationError on invalid JSON',
        input: {title: 'X', items: '[bad json'},
        shouldThrow: 'ValidationError',
    },
    {
        description: 'throws ValidationError on schema errors (missing item fields)',
        input: {
            title: 'X',
            items: JSON.stringify([{description: '', maxAssignees: 1, requiredByAll: true}]),
        },
        shouldThrow: 'ValidationError',
    },
    {
        description: 'requires at least one item',
        input: {
            title: 'X',
            items: JSON.stringify([]),
        },
        shouldThrow: 'ValidationError',
    },
];

export const createEntityData = {
    userId: 7,
    listData: {
        title: 'Trip',
        description: 'desc',
        allowGuestAdd: true,
        guestManage: false,
        items: [
            {title: 'Tent', description: '', maxAssignees: '2', requiredByAll: true},
            {title: 'Stove', requiredByAll: 0, maxAssignees: 0},
        ],
    },
    expectedId: 'list-123',
    expectedItems: [
        {
            id: 'uid-123',
            title: 'Tent',
            description: '',
            maxAssignees: 2,
            requiredByAll: true,
            position: 0,
        },
        {
            id: 'uid-123',
            title: 'Stove',
            description: '',
            maxAssignees: 1,
            requiredByAll: false,
            position: 1,
        },
    ],
};

export const fetchForViewData = {
    list: {id: 'L1'},
    items: [
        {id: 'a', title: 'A', assignedCount: 0, maxAssignees: 2, requiredByAll: false},
        {id: 'b', title: 'B', assignedCount: 1, maxAssignees: 1, requiredByAll: false},
        {id: 'c', title: 'C', assignedCount: 0, maxAssignees: 5, requiredByAll: true},
    ],
    assignees: {
        a: [{user_id: 1}],
        b: [{guest_id: 2}, {name: 'Anon'}],
        c: [{user_id: 1}],
    },
    scenarios: [
        {
            description: 'uses user assignments and computes counters/participants excluding requiredByAll',
            session: {user: {id: 99}},
            mockAssignments: ['a'],
            mockFunc: 'getPackingAssignmentsForUser',
            expectedAssignments: ['a'],
            expectedCounters: {participants: 3, open: 1, empty: 1},
        },
        {
            description: 'uses guest assignments when no user',
            session: {guest: {id: 5}},
            mockAssignments: ['b'],
            mockFunc: 'getPackingAssignmentsForGuest',
            expectedAssignments: ['b'],
        },
        {
            description: 'falls back to empty assignments with no principal',
            session: {},
            expectedAssignments: [],
        },
    ],
};

export const fetchForDuplicateData = {
    list: {id: 'L9'},
    items: [{id: 'x'}],
};

export const deleteEntityData = {
    list: {id: 'L9'},
};

export const updateDescriptionData = [
    {
        description: 'updates if <= 2000 chars',
        listId: 'L1',
        body: {description: 'ok'},
        expectedMessage: 'Description updated',
        shouldThrow: false,
    },
    {
        description: 'rejects when too long',
        listId: 'L1',
        body: {description: 'x'.repeat(2001)},
        shouldThrow: 'APIError',
    },
];

export const reorderItemsData = {
    listId: 'L1',
    order: [{itemId: 'a', position: 2}],
    expectedMessage: 'Order saved',
};

export const quickAddItemData = {
    list: {id: 'L1'},
    scenarios: [
        {
            description: 'adds item with next position and numeric max',
            lastPos: 2,
            body: {title: 'Knife', description: 'sharp', max: '3'},
            expectedMessage: 'Item added',
            expectedItem: {
                id: 'uid-123',
                title: 'Knife',
                description: 'sharp',
                maxAssignees: 3,
                position: 3,
            },
        },
        {
            description: 'defaults maxAssignees to 1 when falsy',
            lastPos: 0,
            body: {title: 'Spoon', max: 0},
            expectedMaxAssignees: 1,
            expectedPosition: 1,
        },
        {
            description: 'rejects missing title',
            body: {title: ''},
            shouldThrow: 'APIError',
        },
    ],
};

export const updateItemDescriptionData = [
    {
        description: 'returns ok if service true',
        itemId: 'i1',
        body: {description: 'd'},
        mockResolve: true,
        expectedMessage: 'Description updated',
    },
    {
        description: 'throws 500 if service false',
        itemId: 'i1',
        body: {description: 'd'},
        mockResolve: false,
        shouldThrow: 'APIError',
    },
];

export const updateItemAttrData = [
    {
        description: 'rejects invalid field',
        itemId: 'i1',
        body: {field: 'position', value: 3},
        shouldThrow: 'APIError',
    },
    {
        description: 'updates allowed field and returns ok',
        itemId: 'i1',
        body: {field: 'title', value: 'New'},
        mockResolve: true,
        expectedMessage: 'Item updated',
        expectedUpdate: {title: 'New'},
    },
    {
        description: 'throws 500 when service returns false',
        itemId: 'i1',
        body: {field: 'title', value: 'New'},
        mockResolve: false,
        shouldThrow: 'APIError',
    },
];

export const updateRequiredData = {
    itemId: 'i2',
    body: {flag: true},
    expectedMessage: 'Requirement updated',
};

export const deleteAssignmentData = {
    assignmentId: 'a1',
    expectedMessage: 'Assignment removed',
};

export const updateSettingsData = {
    listId: 'L1',
    body: {allowAdd: true, guestManage: false},
    expectedMessage: 'Settings saved',
};

export const deleteItemData = {
    itemId: 'i9',
    expectedMessage: 'Item deleted',
};

export const assignmentAccessMappingData = {
    assignToUser: {itemId: 'i1', userId: 7},
    assignToGuest: {itemId: 'i2', guestId: 5},
    unassignFromUser: {itemId: 'i3', userId: 8},
    unassignFromGuest: {itemId: 'i4', guestId: 9},
};
