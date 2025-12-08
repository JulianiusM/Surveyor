/**
 * Test data for date-range-modal.ts
 */

export const readDateRangePayloadData = [
    {
        description: 'reads valid date range payload',
        arrival: '2024-01-01',
        departure: '2024-01-05',
        registrationId: '123',
        expected: {
            arrivalDate: '2024-01-01',
            departureDate: '2024-01-05',
            registrationId: '123',
        },
    },
    {
        description: 'returns null for missing arrival date',
        arrival: '',
        departure: '2024-01-05',
        registrationId: '123',
        expected: null,
    },
    {
        description: 'returns null for missing departure date',
        arrival: '2024-01-01',
        departure: '',
        registrationId: '123',
        expected: null,
    },
    {
        description: 'returns null for missing registration ID',
        arrival: '2024-01-01',
        departure: '2024-01-05',
        registrationId: '',
        expected: null,
    },
    {
        description: 'trims whitespace from all fields',
        arrival: '  2024-01-01  ',
        departure: '  2024-01-05  ',
        registrationId: '  456  ',
        expected: {
            arrivalDate: '2024-01-01',
            departureDate: '2024-01-05',
            registrationId: '456',
        },
    },
];

export const boundsData = [
    {
        description: 'applies both min and max bounds',
        bounds: {
            min: '2024-01-01',
            max: '2024-12-31',
        },
        expectedMin: '2024-01-01',
        expectedMax: '2024-12-31',
    },
    {
        description: 'applies only min bound',
        bounds: {
            min: '2024-01-01',
        },
        expectedMin: '2024-01-01',
        expectedMax: undefined,
    },
    {
        description: 'applies only max bound',
        bounds: {
            max: '2024-12-31',
        },
        expectedMin: undefined,
        expectedMax: '2024-12-31',
    },
    {
        description: 'handles no bounds',
        bounds: undefined,
        expectedMin: undefined,
        expectedMax: undefined,
    },
];
