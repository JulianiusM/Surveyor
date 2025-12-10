/**
 * Test data for activity controller tests
 */

export const validSlot = {
    id: '11111111-1111-4111-8111-111111111111',
    day: '2024-01-02',
    pos: 1,
    title: 'Morning shift',
    description: '',
    maxAssignees: 2,
};

export const preprocessCreateData = [
    {
        description: 'sanitizes valid payload, flattens slots and description',
        input: {
            title: 'Event',
            startDate: '2024-01-01',
            endDate: '2024-01-03',
            description: '',
            event_id: '',
            slots: JSON.stringify({'2024-01-02': [validSlot]}),
        },
        expected: {
            title: 'Event',
            description: null,
            startDate: '2024-01-01',
            endDate: '2024-01-03',
            slotsLength: 1,
            slotDay: '2024-01-02',
            slotTitle: 'Morning shift',
        },
    },
    {
        description: 'throws ValidationError on invalid slots JSON',
        input: {
            title: 'X',
            startDate: '2024-01-01',
            endDate: '2024-01-03',
            description: '',
            slots: '{bad json',
        },
        shouldThrow: 'ValidationError',
    },
    {
        description: 'throws ValidationError on schema problems (missing title)',
        input: {
            startDate: '2024-01-01',
            endDate: '2024-01-03',
            description: '',
            slots: JSON.stringify({'2024-01-02': [validSlot]}),
        },
        shouldThrow: 'ValidationError',
    },
    {
        description: 'throws ValidationError if slot day outside start/end range',
        input: {
            title: 'Event',
            startDate: '2024-01-10',
            endDate: '2024-01-12',
            description: '',
            slots: JSON.stringify({'2024-01-05': [{...validSlot, day: '2024-01-05'}]}),
        },
        shouldThrow: 'ValidationError',
    },
];

export const createEntityData = {
    planData: {
        title: 'T',
        description: 'D',
        startDate: '2024-01-01',
        endDate: '2024-01-03',
        slots: [{id: 's1'}],
        eventId: undefined,
    },
    userId: 7,
    expectedId: 'plan-123',
    expectedArgs: [7, 'T', 'D', '2024-01-01', '2024-01-03', [{id: 's1'}], undefined],
};

export const fetchForViewData = {
    plan: {id: 'p1', startDate: '2024-01-01', endDate: '2024-01-31'},
    slotsByDate: {
        '2024-01-10': [
            {id: 'a', assignedCount: 0, maxAssignees: 2, title: 'A'},
            {id: 'b', assignedCount: 1, maxAssignees: 1, title: 'B'},
        ],
    },
    assignees: {a: [], b: []},
    participants: [1, 2, 3],
    roles: ['role1'],
    slotRoles: {a: [], b: []},
    scenarios: [
        {
            description: 'uses user-based assignments and computes counters',
            session: {user: {id: 42}},
            mockAssignments: ['a'],
            mockFunc: 'getActivitySlotAssignmentsForUser',
            expectedAssignments: ['a'],
            expectedCounters: {participants: 3, open: 1, empty: 1},
        },
        {
            description: 'uses guest-based assignments when no user',
            session: {guest: {id: 8}},
            mockAssignments: ['b'],
            mockFunc: 'getActivitySlotAssignmentsForGuest',
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
    plan: {id: 'p1'},
    slotMap: {'2024-01-01': [{id: 'x'}]},
};

export const deleteEntityData = {
    plan: {id: 'p9'},
};

export const updateDescriptionData = [
    {
        description: 'updates when <=2000 chars',
        planId: 'p1',
        body: {description: 'ok'},
        expectedMessage: 'Description updated',
        shouldThrow: false,
    },
    {
        description: 'rejects when too long',
        planId: 'p1',
        body: {description: 'x'.repeat(2001)},
        shouldThrow: 'APIError',
    },
];

export const createTextFieldData = [
    {
        description: 'creates text field with trimmed title',
        planId: 'p1',
        body: {title: '  Notes  ', text: 'hello'},
        expectedTitle: 'Notes',
        expectedText: 'hello',
    },
    {
        description: 'throws when title is missing',
        planId: 'p1',
        body: {title: '   '},
        shouldThrow: 'APIError',
    },
    {
        description: 'throws when title is too long',
        planId: 'p1',
        body: {title: 'x'.repeat(256)},
        shouldThrow: 'APIError',
    },
    {
        description: 'throws when text is too long',
        planId: 'p1',
        body: {title: 'Valid', text: 'x'.repeat(5001)},
        shouldThrow: 'APIError',
    },
];

export const reorderSlotsData = {
    planId: 'p1',
    order: [{slotId: 's1', pos: 2}],
    expectedMessage: 'Order saved',
};

export const updateTextFieldData = [
    {
        description: 'updates text and title when field belongs to plan',
        planId: 'p1',
        textFieldId: 'tf1',
        existing: {id: 'tf1', planId: 'p1'},
        body: {title: 'New title', text: 'Updated text'},
        expectedTitle: 'New title',
        expectedText: 'Updated text',
        permData: {entity: {has: (key: string) => key === 'MANAGE_REQUIREMENTS'}},
    },
    {
        description: 'updates text when no title provided',
        planId: 'p1',
        textFieldId: 'tf1',
        existing: {id: 'tf1', planId: 'p1'},
        body: {text: 'Only text'},
        expectedText: 'Only text',
    },
    {
        description: 'rejects title update without MANAGE_REQUIREMENTS permission',
        planId: 'p1',
        textFieldId: 'tf1',
        existing: {id: 'tf1', planId: 'p1'},
        body: {title: 'Blocked'},
        shouldThrow: 'APIError',
        permData: {entity: {has: () => false}},
    },
    {
        description: 'throws when title exceeds limit',
        planId: 'p1',
        textFieldId: 'tf1',
        existing: {id: 'tf1', planId: 'p1'},
        body: {title: 'x'.repeat(256)},
        shouldThrow: 'APIError',
    },
    {
        description: 'throws when text exceeds limit',
        planId: 'p1',
        textFieldId: 'tf1',
        existing: {id: 'tf1', planId: 'p1'},
        body: {text: 'x'.repeat(5001)},
        shouldThrow: 'APIError',
    },
    {
        description: 'throws when text field is missing',
        planId: 'p1',
        textFieldId: 'missing',
        existing: null,
        body: {text: 'x'},
        shouldThrow: 'APIError',
    },
    {
        description: 'throws when text field belongs to different plan',
        planId: 'p1',
        textFieldId: 'tf2',
        existing: {id: 'tf2', planId: 'other'},
        body: {text: 'x'},
        shouldThrow: 'APIError',
    },
];

export const quickAddSlotData = {
    plan: {id: 'p1', startDate: '2024-01-01', endDate: '2024-01-31'},
    scenarios: [
        {
            description: 'creates slot with next pos and numeric maxAssignees',
            lastPos: 2,
            body: {date: '2024-01-10', title: 'Foo', description: 'Bar', maxAssignees: '3'},
            expectedMessage: 'Slot added',
            expectedSlot: {
                id: 'uid-123',
                day: '2024-01-10',
                title: 'Foo',
                description: 'Bar',
                maxAssignees: 3,
                pos: 3,
                startTime: null,
                endTime: null,
            },
        },
        {
            description: 'defaults maxAssignees to 1 when falsy',
            lastPos: 0,
            body: {date: '2024-01-10', title: 'T', maxAssignees: 0},
            expectedMaxAssignees: 1,
        },
        {
            description: 'rejects missing title',
            body: {date: '2024-01-10', title: ''},
            shouldThrow: 'APIError',
        },
        {
            description: 'rejects date outside range',
            body: {date: '2023-12-31', title: 'X'},
            shouldThrow: 'APIError',
        },
    ],
};

export const updateSlotDescriptionData = [
    {
        description: 'returns ok if update true',
        slotId: 's1',
        body: {description: 'd'},
        mockResolve: true,
        expectedMessage: 'Description updated',
    },
    {
        description: 'throws 500 if update false',
        slotId: 's1',
        body: {description: 'd'},
        mockResolve: false,
        shouldThrow: 'APIError',
    },
];

export const updateSlotAttrData = [
    {
        description: 'rejects invalid field',
        slotId: 's1',
        body: {field: 'pos', value: 3},
        shouldThrow: 'APIError',
    },
    {
        description: 'updates allowed field and returns ok',
        slotId: 's1',
        body: {field: 'title', value: 'N'},
        mockResolve: true,
        expectedMessage: 'Slot updated',
        expectedUpdate: {title: 'N'},
    },
    {
        description: 'throws 500 when service returns false',
        slotId: 's1',
        body: {field: 'title', value: 'N'},
        mockResolve: false,
        shouldThrow: 'APIError',
    },
];

export const deleteAssignmentData = {
    assignmentId: 99,
    expectedMessage: 'Assignment removed',
};

export const deleteTextFieldData = [
    {
        description: 'deletes text field when it belongs to plan',
        planId: 'p1',
        textFieldId: 'tf1',
        existing: {id: 'tf1', planId: 'p1'},
        expectedMessage: 'Text field deleted',
    },
    {
        description: 'throws when text field is missing',
        planId: 'p1',
        textFieldId: 'missing',
        existing: null,
        shouldThrow: 'APIError',
    },
    {
        description: 'throws when text field belongs to another plan',
        planId: 'p1',
        textFieldId: 'tf2',
        existing: {id: 'tf2', planId: 'other'},
        shouldThrow: 'APIError',
    },
];

export const updateSettingsData = {
    planId: 'p1',
    body: {allowAdd: true, guestManage: false},
    expectedMessage: 'Settings saved',
};

export const deleteSlotData = {
    slotId: 's1',
    expectedMessage: 'Slot deleted',
};

export const addSlotRoleData = [
    {
        description: 'rejects empty roles array',
        slotId: 's1',
        body: {roles: []},
        shouldThrow: 'APIError',
    },
    {
        description: 'rejects null roles',
        slotId: 's1',
        body: {roles: null},
        shouldThrow: 'APIError',
    },
    {
        description: 'rejects missing roles',
        slotId: 's1',
        body: {},
        shouldThrow: 'APIError',
    },
    {
        description: 'adds roles when valid',
        slotId: 's1',
        body: {roles: [1, 2]},
        expectedMessage: 'Roles added',
    },
];

export const assignmentAccessMappingData = {
    assignToUser: {slotId: 's1'},
    userId: 7,
    unassignFromGuest: {slotId: 's2'},
    guestId: 9,
};

export const roleAccessMappingData = {
    assignToUser: {slotId: 's1', role: 3},
    userId: 7,
    roleId: 3,
};
