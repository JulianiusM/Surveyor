/**
 * Test data for event.service.test.ts
 * Organized into test scenarios with all test data externalized
 */

export const eventCrudData = [
    {
        description: 'creates, reads, updates, and deletes an Event',
        ownerId: 1,
        initialData: {
            title: 'Camp',
            description: null,
            startDate: '2025-08-01',
            endDate: '2025-08-03',
            location: 'Riverside Park',
            bindingDeadline: '2025-08-01T12:00:00.000Z',
            requireDietaryInfo: true,
            maxParticipants: 10,
            timezone: 'Europe/Berlin',
        },
        expectedInitial: {
            ownerId: 1,
            title: 'Camp',
            startDate: '2025-08-01',
            endDate: '2025-08-03',
            location: 'Riverside Park',
            requireDietaryInfo: 1,
            maxParticipants: 10,
            timezone: 'Europe/Berlin',
        },
        updates: {
            title: 'Camp 2025',
            description: 'Bring sunscreen',
            meta: {
                location: 'Lakeview',
                bindingDeadline: '2025-07-20T18:30',
                requireDietaryInfo: false,
                maxParticipants: 25,
                timezone: 'UTC',
            },
            dates: {
                startDate: '2025-08-02',
                endDate: '2025-08-04',
            },
        },
        expectedAfterUpdates: {
            title: 'Camp 2025',
            description: 'Bring sunscreen',
            location: 'Lakeview',
            bindingDeadline: '2025-07-20T18:30',
            requireDietaryInfo: 0,
            maxParticipants: 25,
            timezone: 'UTC',
            startDate: '2025-08-02',
            endDate: '2025-08-04',
        },
    },
];

export const eventRegistrationData = [
    {
        description: 'registers user & guest; updates registration; handles dietary choices; lists participants; deletes registration',
        principals: {
            user: {
                id: 2,
                username: 'u2',
                name: 'User Two',
                email: 'u2@example.com',
            },
            guest: {
                id: 11,
                username: 'guestOne',
            },
        },
        eventData: {
            ownerId: 1,
            title: 'Meetup',
            description: null,
            startDate: '2025-09-10',
            endDate: '2025-09-12',
            location: 'Hall A',
            bindingDeadline: null,
            requireDietaryInfo: true,
            maxParticipants: 50,
            timezone: 'Europe/Berlin',
        },
        userRegistration: {
            userId: 2,
            arrivalDate: '2025-09-10',
            departureDate: '2025-09-12',
            initialChoices: ['VEGAN', 'VEGAN', 'MEAT'],
            note: 'no peanuts',
            updatedArrivalDate: '2025-09-11',
            updatedDepartureDate: '2025-09-12',
            updatedChoices: ['VEGETARIAN'],
            updatedNote: 'loves veggies',
        },
        guestRegistration: {
            guestId: 11,
            arrivalDate: '2025-09-10',
            departureDate: '2025-09-12',
            dietaryChoices: ['HALAL'],
            note: null,
        },
        clearDietary: {
            choices: [],
            note: null,
        },
        expected: {
            initialDietaryCount: 2,
            initialChoices: ['MEAT', 'VEGAN'],
            updatedArrivalDate: '2025-09-11',
            updatedDietaryCount: 1,
            updatedChoice: 'VEGETARIAN',
            totalRegistrations: 2,
            participantNames: ['User Two', 'guestOne'],
            userDietaryCount: 1,
            guestDietaryCount: 1,
            afterDeleteCount: 1,
            clearedDietaryCount: 0,
        },
    },
];

export const registeredEventsData = [
    {
        description: 'getRegisteredEventsFor returns events for user/guest sorted by startDate DESC',
        principals: {
            user: {
                id: 2,
                username: 'u2',
                name: 'User Two',
                email: 'u2@example.com',
            },
            guest: {
                id: 11,
                username: 'guestOne',
            },
        },
        event1: {
            ownerId: 1,
            title: 'E1',
            description: null,
            startDate: '2025-12-01',
            endDate: '2025-12-03',
            location: null,
            bindingDeadline: null,
            requireDietaryInfo: false,
            maxParticipants: null,
            timezone: null,
        },
        event2: {
            ownerId: 1,
            title: 'E2',
            description: null,
            startDate: '2025-11-01',
            endDate: '2025-11-02',
            location: null,
            bindingDeadline: null,
            requireDietaryInfo: false,
            maxParticipants: null,
            timezone: null,
        },
        registrations: {
            user: {
                event1: {
                    userId: 2,
                    arrivalDate: '2025-12-01',
                    departureDate: '2025-12-03',
                },
                event2: {
                    userId: 2,
                    arrivalDate: '2025-11-01',
                    departureDate: '2025-11-02',
                },
            },
            guest: {
                event2: {
                    guestId: 11,
                    arrivalDate: '2025-11-01',
                    departureDate: '2025-11-02',
                },
            },
        },
        queries: {
            user: {userId: 2},
            guest: {guestId: 11},
        },
        expected: {
            userEventIds: (e1: string, e2: string) => [e1, e2],
            guestEventIds: (e2: string) => [e2],
            noQueryResult: [],
        },
    },
];

export const eventFullData = [
    {
        description: 'isEventFull - unlimited event',
        type: 'unlimited',
        event: {
            ownerId: 1,
            title: 'Unlimited',
            description: null,
            startDate: '2025-10-01',
            endDate: '2025-10-02',
            location: null,
            bindingDeadline: null,
            requireDietaryInfo: true,
            maxParticipants: null,
            timezone: null,
        },
        expected: {
            isFull: false,
        },
    },
    {
        description: 'isEventFull - limited event with capacity',
        type: 'limited',
        event: {
            ownerId: 1,
            title: 'Limited',
            description: null,
            startDate: '2025-10-10',
            endDate: '2025-10-12',
            location: null,
            bindingDeadline: null,
            requireDietaryInfo: true,
            maxParticipants: 1,
            timezone: null,
        },
        user: {
            id: 3,
            username: 'u3',
            name: 'User Three',
            email: 'u3@example.com',
        },
        registration: {
            userId: 3,
            arrivalDate: '2025-10-10',
            departureDate: '2025-10-12',
        },
        expected: {
            initialFull: false,
            afterRegistration: true,
        },
    },
    {
        description: 'isEventFull - missing event throws',
        type: 'missing',
        eventId: 'no-such-event',
        expected: {
            error: 'Event not found',
        },
    },
];

export const eventRegistrationCheckData = [
    {
        description: 'isRegisteredForEvent returns correct booleans',
        principals: {
            user: {
                id: 2,
                username: 'u2',
                name: 'User Two',
                email: 'u2@example.com',
            },
            guest: {
                id: 11,
                username: 'guestOne',
            },
        },
        event: {
            ownerId: 1,
            title: 'Check',
            description: null,
            startDate: '2025-09-20',
            endDate: '2025-09-21',
            location: null,
            bindingDeadline: null,
            requireDietaryInfo: false,
            maxParticipants: null,
            timezone: null,
        },
        registrations: {
            user: {
                userId: 2,
                arrivalDate: '2025-09-20',
                departureDate: '2025-09-21',
            },
            guest: {
                guestId: 11,
                arrivalDate: '2025-09-20',
                departureDate: '2025-09-21',
            },
        },
        expected: {
            emptyQuery: false,
            userBeforeRegistration: false,
            guestBeforeRegistration: false,
            userAfterRegistration: true,
            guestAfterRegistration: true,
        },
    },
];
