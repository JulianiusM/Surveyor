/**
 * Test data for drivers controller tests
 */

export const preprocessCreateData = [
    {
        description: 'sanitizes valid payload, coalesces description and event_id',
        input: {
            title: 'Drivers',
            description: '',
            event_id: '',
            items: JSON.stringify([
                {title: 'A', description: '', maxAssignees: 2},
            ]),
        },
        expected: {
            title: 'Drivers',
            description: null,
            eventId: null,
        },
    },
    {
        description: 'throws ValidationError when required title is missing',
        input: {
            description: 'no title',
        },
        shouldThrow: 'ValidationError',
    },
];

export const createEntityData = {
    userId: 7,
    listData: {
        title: 'T',
        description: 'D',
        eventId: undefined,
    },
    expectedId: 'list-123',
};

export const fetchForViewData = {
    list: {id: 'L1'},
    items: [
        {id: 'a', assignedCount: 0, maxAssignees: 2, title: 'A'},
        {id: 'b', assignedCount: 1, maxAssignees: 1, title: 'B'},
        {id: 'c', assignedCount: 0, maxAssignees: 1, title: 'C'},
    ],
    assignees: {
        a: [{userId: 10, name: 'Alice'}, {name: 'Temp'}],
        b: [{guestId: 3, name: 'Bob'}],
        c: [{userId: 10, name: 'Alice'}, {name: 'Temp'}],
    },
    scenarios: [
        {
            description: 'uses user assignments and computes counters and participant set size',
            session: {user: {id: 99}},
            mockAssignments: ['a'],
            mockFunc: 'getDriversAssignmentsForUser',
            mockArgs: ['L1', 99],
            expectedAssignments: ['a'],
            expectedCounters: {participants: 3, open: 2, empty: 2},
        },
        {
            description: 'uses guest assignments when no user',
            session: {guest: {id: 7}},
            mockAssignments: ['b'],
            mockFunc: 'getDriversAssignmentsForGuest',
            mockArgs: ['L1', 7],
            expectedAssignments: ['b'],
        },
        {
            description: 'falls back to empty assignments when no principal',
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
    list: {id: 'L5'},
};

export const updateDescriptionData = [
    {
        description: 'updates when <= 2000 chars',
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
    order: [{itemId: 'i1', position: 3}],
    expectedMessage: 'Order saved',
};

export const quickAddItemData = {
    list: {id: 'L1'},
    lastPos: 2,
    scenarios: [
        {
            description: 'creates item for logged-in user with next pos and numeric max',
            session: {user: {id: 42}},
            body: {title: 'Hammer', description: 'Steel', max: '3'},
            expectedMessage: 'Item added',
            expectedService: 'createDriversItemUser',
            expectedItem: {
                id: 'uid-xyz',
                title: 'Hammer',
                description: 'Steel',
                maxAssignees: 3,
                pos: 3,
            },
        },
        {
            description: 'creates item for guest if no user',
            session: {guest: {id: 9}},
            body: {title: 'Nails', max: 0},
            expectedService: 'createDriversItemGuest',
            expectedMaxAssignees: 1,
        },
        {
            description: 'rejects when not logged in',
            session: {},
            body: {title: 'Glue'},
            shouldThrow: 'APIError',
        },
        {
            description: 'rejects missing title',
            session: {user: {id: 1}},
            body: {title: ''},
            shouldThrow: 'APIError',
        },
    ],
};

export const updateItemDescriptionData = [
    {
        description: 'returns ok if update true',
        itemId: 'it1',
        body: {description: 'd'},
        mockResolve: true,
        expectedMessage: 'Description updated',
    },
    {
        description: 'throws 500 if update false',
        itemId: 'it1',
        body: {description: 'd'},
        mockResolve: false,
        shouldThrow: 'APIError',
    },
];

export const updateItemAttrData = [
    {
        description: 'rejects invalid field',
        itemId: 'it1',
        body: {field: 'pos', value: 2},
        shouldThrow: 'APIError',
    },
    {
        description: 'updates allowed field and returns ok',
        itemId: 'it1',
        body: {field: 'title', value: 'New'},
        mockResolve: true,
        expectedMessage: 'Item updated',
        expectedUpdate: {title: 'New'},
    },
    {
        description: 'throws 500 when service returns false',
        itemId: 'it1',
        body: {field: 'title', value: 'New'},
        mockResolve: false,
        shouldThrow: 'APIError',
    },
];

export const deleteAssignmentData = {
    assignmentId: 77,
    expectedMessage: 'Assignment removed',
};

export const updateSettingsData = {
    listId: 'L1',
    body: {allowAdd: true, guestManage: false},
    expectedMessage: 'Settings saved',
};

export const deleteItemData = {
    itemId: 'it9',
    expectedMessage: 'Item deleted',
};

export const assignmentAccessMappingData = {
    assignToUser: {itemId: 'i1', userId: 5},
    assignToGuest: {itemId: 'i2', guestId: 7},
    unassignFromUser: {itemId: 'i3', userId: 11},
    unassignFromGuest: {itemId: 'i4', guestId: 13},
};
