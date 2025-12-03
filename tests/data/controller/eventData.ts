/**
 * Test data for event controller tests
 */

export const preprocessCreateData = [
    {
        description: 'sanitizes and maps fields; rewrites deadline with tz; flags and numbers handled',
        input: {
            title: 'Retreat',
            description: '',
            startDate: '2025-05-01',
            endDate: '2025-05-03',
            location: '',
            bindingDeadline: '2025-04-30T18:00',
            requireDietaryInfo: 'on',
            maxParticipants: '',
            deadlineTz: 'Europe/Berlin',
        },
        expected: {
            title: 'Retreat',
            description: null,
            startDate: '2025-05-01',
            endDate: '2025-05-03',
            location: null,
            bindingDeadline: 'rewritten:2025-04-30T18:00:Europe/Berlin',
            requireDietaryInfo: true,
            maxParticipants: null,
            timezone: 'Europe/Berlin',
        },
        expectRewrite: ['2025-04-30T18:00', 'Europe/Berlin'],
    },
    {
        description: 'accepts empty bindingDeadline and deadlineTz -> bindingDeadline null',
        input: {
            title: 'E',
            startDate: '2025-01-01',
            endDate: '2025-01-02',
            description: '',
            location: '',
            bindingDeadline: '',
            deadlineTz: '',
        },
        expected: {
            bindingDeadline: null,
            timezone: null,
        },
    },
    {
        description: 'rejects schema errors',
        input: {
            title: '',
            startDate: 'bad',
            endDate: '2025-01-02',
            description: '',
        },
        shouldThrow: 'ValidationError',
    },
    {
        description: 'rejects when startDate > endDate',
        input: {
            title: 'X',
            startDate: '2025-02-02',
            endDate: '2025-02-01',
            description: '',
        },
        shouldThrow: 'ValidationError',
    },
];

export const createEntityData = {
    userId: 9,
    data: {
        title: 'T',
        description: 'D',
        startDate: '2025-01-01',
        endDate: '2025-01-02',
        location: 'Loc',
        bindingDeadline: 'DL',
        requireDietaryInfo: true,
        maxParticipants: 20,
        timezone: 'UTC',
    },
    expectedId: 'ev-1',
};

export const deleteEntityData = {
    event: {id: 'e1'},
};

export const fetchForViewData = {
    baseEvent: {
        id: 'e1',
        ownerId: 1,
        title: 'T',
        startDate: '2025-01-01',
        endDate: '2025-01-03',
        maxParticipants: 2,
    },
    registrations: [{}, {}],
    scenarios: [
        {
            description: 'anonymous: no scoped lists, registration null, computes isFull',
            session: {},
            expected: {
                registration: null,
                activityPlans: [],
                packingLists: [],
                driverLists: [],
                isFull: true,
            },
            expectNoCall: 'getActivityPlansForEvent',
        },
        {
            description: 'owner sees scoped lists even without registration',
            session: {user: {id: 1}},
            mockActivityPlans: ['ap'],
            mockPackingLists: ['pl'],
            mockDriverLists: ['dl'],
            expected: {
                activityPlans: ['ap'],
                packingLists: ['pl'],
                driverLists: ['dl'],
            },
        },
        {
            description: 'registered user (non-owner) sees scoped lists',
            eventOverrides: {ownerId: 99},
            session: {user: {id: 2}},
            mockRegistration: {id: 'r1'},
            mockActivityPlans: ['ap'],
            mockPackingLists: ['pl'],
            mockDriverLists: ['dl'],
            expectedRegistrationCall: [{userId: 2}, 'e1'],
            expected: {
                registration: {id: 'r1'},
                activityPlans: ['ap'],
            },
        },
        {
            description: 'registered guest branch',
            eventOverrides: {ownerId: 99},
            session: {guest: {id: 7}},
            mockRegistration: {id: 'rg'},
            expectedRegistrationCall: [{guestId: 7}, 'e1'],
            expected: {
                registration: {id: 'rg'},
            },
        },
        {
            description: 'isFull false when maxParticipants undefined (treated as infinite)',
            eventOverrides: {maxParticipants: undefined},
            session: {},
            registrations: [{}, {}, {}, {}],
            expected: {
                isFull: false,
            },
        },
    ],
};

export const fetchForDuplicateData = {
    event: {id: 'e9'},
};

export const registerAttendanceData = {
    event: {
        id: 'e1',
        startDate: '2025-01-01',
        endDate: '2025-01-10',
    },
    scenarios: [
        {
            description: 'registers user; trims allergy notes; dietary single value allowed',
            mockFull: false,
            mockWithinWindow: true,
            body: {
                arrivalDate: '2025-01-02',
                departureDate: '2025-01-05',
                dietary: 'VEGAN',
                allergyNotes: '  nuts  ',
            },
            session: {user: {id: 5}},
            expectedMessage: 'Registration saved',
            expectedCall: {
                service: 'registerUser',
                args: ['e1', 5, '2025-01-02', '2025-01-05', ['VEGAN'], 'nuts', {ok: false}],
            },
        },
        {
            description: 'registers guest; dietary array, empty allergy -> null',
            mockFull: false,
            mockWithinWindow: true,
            body: {
                arrivalDate: '2025-01-03',
                departureDate: '2025-01-04',
                dietary: ['FISH', 'VEGETARIAN'],
                allergyNotes: '',
            },
            session: {guest: {id: 9}},
            expectedCall: {
                service: 'registerGuest',
                args: ['e1', 9, '2025-01-03', '2025-01-04', ['FISH', 'VEGETARIAN'], null, {ok: false}],
            },
        },
        {
            description: 'blocks when event is full and user not already registered',
            mockFull: true,
            mockRegistered: false,
            body: {
                arrivalDate: '2025-01-02',
                departureDate: '2025-01-03',
            },
            session: {user: {id: 1}},
            shouldThrow: 'APIError',
        },
        {
            description: 'allows update if full but already registered',
            mockFull: true,
            mockRegistered: true,
            mockWithinWindow: true,
            body: {
                arrivalDate: '2025-01-02',
                departureDate: '2025-01-03',
            },
            session: {user: {id: 1}},
            expectCallMade: 'registerUser',
        },
        {
            description: 'rejects invalid schema (missing arrivalDate)',
            body: {departureDate: '2025-01-02'},
            session: {user: {id: 1}},
            shouldThrow: 'APIError',
        },
        {
            description: 'rejects when dates outside event window',
            mockFull: false,
            mockWithinWindow: false,
            body: {
                arrivalDate: '2024-12-31',
                departureDate: '2025-01-15',
            },
            session: {user: {id: 1}},
            shouldThrow: 'APIError',
        },
        {
            description: 'rejects when unauthenticated',
            body: {
                arrivalDate: '2025-01-02',
                departureDate: '2025-01-03',
            },
            session: {},
            shouldThrow: 'APIError',
        },
    ],
};

export const cancelRegistrationData = [
    {
        description: 'cancels for user',
        eventId: 'e1',
        session: {user: {id: 5}},
        expectedMessage: 'Registration cancelled',
        expectedArgs: ['e1', {userId: 5}],
    },
    {
        description: 'cancels for guest',
        eventId: 'e1',
        session: {guest: {id: 7}},
        expectedArgs: ['e1', {guestId: 7}],
    },
    {
        description: 'rejects when unauthenticated',
        eventId: 'e1',
        session: {},
        shouldThrow: 'APIError',
    },
];

export const updateEventSettingsData = {
    event: {
        id: 'e1',
        title: 'CurrentTitle',
        description: 'CurrentDesc',
        startDate: '2025-01-01',
        endDate: '2025-01-10',
    },
    scenarios: [
        {
            description: 'validates, performs meta update, updates title/description/dates; rewrites deadline',
            body: {
                title: 'New Title',
                description: '',
                startDate: '',
                endDate: '2025-01-12',
                location: '',
                bindingDeadline: '2024-12-31T23:00',
                requireDietaryInfo: 'on',
                maxParticipants: '',
                deadlineTz: 'UTC',
            },
            expectedMessage: 'Event updated',
            expectRewrite: ['2024-12-31T23:00', 'UTC'],
            expectedCalls: {
                updateEventMeta: ['e1', {
                    location: null,
                    bindingDeadline: 'rewritten:2024-12-31T23:00:UTC',
                    requireDietaryInfo: true,
                    maxParticipants: null,
                    timezone: 'UTC',
                }],
                updateEventTitle: ['e1', 'New Title'],
                updateEventDescription: ['e1', null],
                updateEventDates: ['e1', '2025-01-01', '2025-01-12'],
            },
        },
        {
            description: 'does not call title/desc updates when fields not provided',
            body: {bindingDeadline: ''},
            expectNotCalled: ['updateEventTitle', 'updateEventDescription'],
        },
        {
            description: 'on empty title string, falls back to existing title',
            body: {title: ''},
            expectedCalls: {
                updateEventTitle: ['e1', 'CurrentTitle'],
            },
        },
        {
            description: 'rejects when start > end after merge',
            body: {startDate: '2025-02-01', endDate: '2025-01-01'},
            shouldThrow: 'APIError',
        },
        {
            description: 'rejects schema errors',
            body: {startDate: 'bad-date'},
            shouldThrow: 'APIError',
        },
    ],
};
