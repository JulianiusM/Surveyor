/**
 * Test data for events.ts module
 */

export const allergyCheckData = {
    description: 'synchronizes allergy notes requirement with checkbox',
    hasElements: true,
    checked: true
};

export const deadlineUpdaterData = [
    {
        description: 'updates deadline display with valid data',
        date: '2024-12-31T23:59:59Z',
        timezone: 'America/New_York',
        hasElements: true
    },
    {
        description: 'handles missing elements gracefully',
        date: '2024-12-31T23:59:59Z',
        timezone: 'America/New_York',
        hasElements: false
    }
];

export const initRegistrationData = {
    hasForm: true,
    formData: {
        name: 'John Doe',
        email: 'john@example.com',
        dietary: ['vegetarian', 'no-gluten']
    }
};

export const initUpdateData = {
    hasForm: true,
    formData: {
        title: 'Updated Event',
        description: 'Updated description',
        location: 'New Location',
        requireDietaryInfo: true
    }
};

export const initCancelRegistrationData = {
    hasButton: true,
    registrationId: 123,
    confirmed: true
};

export const initData = {
    basicInit: {
        description: 'initializes with all basic functions',
        eventId: 'event-123'
    },
    initWithoutEventId: {
        description: 'handles missing event ID',
        eventId: ''
    }
};
