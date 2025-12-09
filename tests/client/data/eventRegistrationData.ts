/**
 * Test data for event registration flows
 * Data-driven test cases for event registration workflows with mocked API
 */

import {deepCopy} from "../helpers/util";

/**
 * Test cases for successful event registration
 */
const _successfulRegistrationData = [
    {
        description: 'registers user for event',
        input: {
            eventId: '123',
            payload: {
                userId: 1,
                preferences: { dietary: 'vegetarian' },
            },
        },
        mockResponse: {
            status: 'success',
            message: 'Successfully registered',
            data: { eventId: '123', userId: 1, preferences: { dietary: 'vegetarian' } },
        },
        expectedStatus: 'success',
        expectedMessage: 'Successfully registered',
    },
    {
        description: 'handles registration with guest information',
        input: {
            eventId: '456',
            payload: {
                guestName: 'John Doe',
                guestEmail: 'john@example.com',
                preferences: {},
            },
        },
        mockResponse: {
            status: 'success',
            message: 'Guest registered successfully',
            data: {
                guestName: 'John Doe',
                guestEmail: 'john@example.com',
                preferences: {},
            },
        },
        expectedStatus: 'success',
        expectedMessage: 'Guest registered successfully',
    },
];

export const successfulRegistrationData = () => deepCopy(_successfulRegistrationData) as typeof _successfulRegistrationData;

/**
 * Test cases for registration cancellation
 */
const _registrationCancellationData = [
    {
        description: 'allows registration cancellation',
        input: { eventId: '123' },
        mockResponse: {
            status: 'success',
            message: 'Registration cancelled',
        },
        expectedStatus: 'success',
        expectedMessage: 'Registration cancelled',
    },
];

export const registrationCancellationData = () => deepCopy(_registrationCancellationData) as typeof _registrationCancellationData;

/**
 * Test cases for registration validation errors
 */
const _registrationValidationErrorData = [
    {
        description: 'rejects registration without required fields',
        input: {
            eventId: '123',
            payload: {},
        },
        mockResponse: {
            status: 'error',
            message: 'Missing required fields',
        },
        mockStatus: 400,
        expectedError: 'Missing required fields',
    },
    {
        description: 'rejects invalid email format',
        input: {
            eventId: '123',
            payload: { email: 'invalid-email' },
        },
        mockResponse: {
            status: 'error',
            message: 'Invalid email format',
        },
        mockStatus: 400,
        expectedError: 'Invalid email format',
    },
    {
        description: 'handles duplicate registration',
        input: {
            eventId: '123',
            payload: { userId: 1 },
        },
        mockResponse: {
            status: 'error',
            message: 'You are already registered for this event',
        },
        mockStatus: 409,
        expectedError: 'You are already registered for this event',
    },
];

export const registrationValidationErrorData = () => deepCopy(_registrationValidationErrorData) as typeof _registrationValidationErrorData;

/**
 * Test cases for server errors
 */
const _registrationServerErrorData = [
    {
        description: 'handles server errors gracefully',
        input: {
            eventId: '123',
            payload: { userId: 1 },
        },
        mockResponse: {
            status: 'error',
            message: 'Internal server error',
        },
        mockStatus: 500,
        expectedError: 'Internal server error',
    },
    {
        description: 'handles closed registration',
        input: {
            eventId: '123',
            payload: { userId: 1 },
        },
        mockResponse: {
            status: 'error',
            message: 'Registration is closed for this event',
        },
        mockStatus: 403,
        expectedError: 'Registration is closed for this event',
    },
    {
        description: 'handles full event capacity',
        input: {
            eventId: '123',
            payload: { userId: 1 },
        },
        mockResponse: {
            status: 'error',
            message: 'Event is at full capacity',
        },
        mockStatus: 409,
        expectedError: 'Event is at full capacity',
    },
];

export const registrationServerErrorData = () => deepCopy(_registrationServerErrorData) as typeof _registrationServerErrorData;

/**
 * Test cases for multi-step registration flow
 */
const _multiStepRegistrationData = [
    {
        description: 'completes full registration flow',
        steps: [
            {
                stepName: 'fetch event details',
                method: 'GET',
                endpoint: '/api/event/789',
                mockResponse: {
                    status: 'success',
                    data: {
                        id: '789',
                        title: 'Summer Camp 2025',
                        startDate: '2025-07-01',
                        endDate: '2025-07-07',
                        registrationOpen: true,
                    },
                },
            },
            {
                stepName: 'register for event',
                method: 'POST',
                endpoint: '/api/event/789/register',
                payload: {
                    userId: 1,
                    arrivalDate: '2025-07-01',
                    departureDate: '2025-07-07',
                },
                mockResponse: {
                    status: 'success',
                    message: 'Registration successful',
                    data: { registrationId: 'reg-123' },
                },
            },
            {
                stepName: 'verify registration',
                method: 'GET',
                endpoint: '/api/event/789',
                mockResponse: {
                    status: 'success',
                    data: {
                        id: '789',
                        title: 'Summer Camp 2025',
                        userRegistered: true,
                        registrationId: 'reg-123',
                    },
                },
            },
        ],
    },
];

export const multiStepRegistrationData = () => deepCopy(_multiStepRegistrationData) as typeof _multiStepRegistrationData;

/**
 * Test cases for registration with preferences updates
 */
const _registrationUpdateData = [
    {
        description: 'handles registration with preferences and updates',
        initialRegistration: {
            eventId: '456',
            payload: {
                userId: 1,
                preferences: { dietary: 'vegetarian' },
            },
            mockResponse: {
                status: 'success',
                message: 'Registered',
                data: {
                    registrationId: 'reg-456',
                    userId: 1,
                    preferences: { dietary: 'vegetarian' },
                },
            },
        },
        update: {
            eventId: '456',
            payload: {
                preferences: {
                    dietary: 'vegan',
                    roommate: 'John Doe',
                },
            },
            mockResponse: {
                status: 'success',
                message: 'Preferences updated',
                data: {
                    registrationId: 'reg-456',
                    preferences: {
                        dietary: 'vegan',
                        roommate: 'John Doe',
                    },
                },
            },
        },
    },
];

export const registrationUpdateData = () => deepCopy(_registrationUpdateData) as typeof _registrationUpdateData;

/**
 * Test cases for authentication-related scenarios
 */
const _registrationAuthData = [
    {
        description: 'allows registration when authenticated',
        input: {
            eventId: '123',
            payload: { userId: 1 },
        },
        mockResponse: {
            status: 'success',
            message: 'Registered successfully',
        },
        expectedStatus: 'success',
    },
    {
        description: 'rejects registration without authentication',
        input: {
            eventId: '123',
            payload: {},
        },
        mockResponse: {
            status: 'error',
            message: 'Authentication required',
        },
        mockStatus: 401,
        expectedError: 'Authentication required',
    },
];

export const registrationAuthData = () => deepCopy(_registrationAuthData) as typeof _registrationAuthData;
