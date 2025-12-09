/**
 * Test data for events.ts module
 */

import {deepCopy} from "../helpers/util";

const _allergyCheckData = {
    description: 'synchronizes allergy notes requirement with checkbox',
    hasElements: true,
    checked: true
};

export const allergyCheckData = () => deepCopy(_allergyCheckData) as typeof _allergyCheckData;

const _deadlineUpdaterData = [
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

export const deadlineUpdaterData = () => deepCopy(_deadlineUpdaterData) as typeof _deadlineUpdaterData;

const _initRegistrationData = {
    hasForm: true,
    formData: {
        name: 'John Doe',
        email: 'john@example.com',
        dietary: ['vegetarian', 'no-gluten']
    }
};

export const initRegistrationData = () => deepCopy(_initRegistrationData) as typeof _initRegistrationData;

const _initUpdateData = {
    hasForm: true,
    formData: {
        title: 'Updated Event',
        description: 'Updated description',
        location: 'New Location',
        requireDietaryInfo: true
    }
};

export const initUpdateData = () => deepCopy(_initUpdateData) as typeof _initUpdateData;

const _initCancelRegistrationData = {
    hasButton: true,
    registrationId: 123,
    confirmed: true
};

export const initCancelRegistrationData = () => deepCopy(_initCancelRegistrationData) as typeof _initCancelRegistrationData;

const _initData = {
    basicInit: {
        description: 'initializes with all basic functions',
        eventId: 'event-123'
    },
    initWithoutEventId: {
        description: 'handles missing event ID',
        eventId: ''
    }
};

export const initData = () => deepCopy(_initData) as typeof _initData;
