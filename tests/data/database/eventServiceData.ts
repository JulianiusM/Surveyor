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
        ownerId: 1,
        eventData: {
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
        testUser: {
            id: 2,
            username: 'u2',
            name: 'User Two',
            email: 'u2@example.com',
        },
        testGuest: {
            id: 11,
            username: 'guestOne',
        },
        userRegistration: {
            userId: 2,
            arrivalDate: '2025-09-10',
            departureDate: '2025-09-12',
            initialDietaryChoices: ['VEGAN', 'VEGAN', 'MEAT'],
            dietaryRemarks: 'no peanuts',
        },
        expectedInitialDietaryChoices: ['MEAT', 'VEGAN'],
        userRegistrationUpdate: {
            arrivalDate: '2025-09-11',
            departureDate: '2025-09-12',
            updatedDietaryChoices: ['VEGETARIAN'],
            dietaryRemarks: 'loves veggies',
        },
        expectedUpdatedDietaryChoice: 'VEGETARIAN',
        guestRegistration: {
            guestId: 11,
            arrivalDate: '2025-09-10',
            departureDate: '2025-09-12',
            dietaryChoices: ['HALAL'],
            dietaryRemarks: null,
        },
        expectedParticipantNames: ['User Two', 'guestOne'],
        expectedRegsBeforeDelete: 2,
        expectedRegsAfterDelete: 1,
    },
];

export const registeredEventsData = [
    {
        description: 'getRegisteredEventsFor returns events for user/guest sorted by startDate DESC',
        ownerId: 1,
        testUser: {
            id: 2,
            username: 'u2',
            name: 'User Two',
            email: 'u2@example.com',
        },
        testGuest: {
            id: 11,
            username: 'guestOne',
        },
        events: [
            {
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
            {
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
        ],
        userRegistrations: [
            {eventIndex: 0, arrivalDate: '2025-12-01', departureDate: '2025-12-03'},
            {eventIndex: 1, arrivalDate: '2025-11-01', departureDate: '2025-11-02'},
        ],
        guestRegistrations: [
            {eventIndex: 1, arrivalDate: '2025-11-01', departureDate: '2025-11-02'},
        ],
        expectedUserEventOrder: [0, 1], // DESC by startDate
        expectedGuestEventOrder: [1],
    },
];

export const eventFullData = [
    {
        description: 'isEventFull respects unlimited/null max, counts registrations, and throws for missing event',
        ownerId: 1,
        unlimitedEvent: {
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
        limitedEvent: {
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
        testUser: {
            id: 3,
            username: 'u3',
            name: 'User Three',
            email: 'u3@example.com',
        },
        registration: {
            arrivalDate: '2025-10-10',
            departureDate: '2025-10-12',
        },
        nonExistentEventId: 'no-such-event',
        expectedError: 'Event not found',
    },
];

export const eventRegistrationCheckData = [
    {
        description: 'isRegisteredForEvent returns correct booleans',
        ownerId: 1,
        testUser: {
            id: 2,
            username: 'u2',
            name: 'User Two',
            email: 'u2@example.com',
        },
        testGuest: {
            id: 11,
            username: 'guestOne',
        },
        eventData: {
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
        userRegistration: {
            arrivalDate: '2025-09-20',
            departureDate: '2025-09-21',
        },
        guestRegistration: {
            arrivalDate: '2025-09-20',
            departureDate: '2025-09-21',
        },
    },
];
