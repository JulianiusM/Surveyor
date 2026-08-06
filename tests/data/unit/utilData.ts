/**
 * Test data for util helper functions
 * Data-driven test cases for date/time utilities, token generation, and helper functions
 */

/**
 * Test cases for toLocalISODate function
 */
export const toLocalISODateData = [
    {
        description: 'converts UTC date to YYYY-MM-DD format',
        input: new Date(Date.UTC(2025, 5, 1, 12, 23, 45)),
        expected: '2025-06-01',
    },
    {
        description: 'handles January correctly',
        input: new Date(Date.UTC(2025, 0, 15, 0, 0, 0)),
        expected: '2025-01-15',
    },
    {
        description: 'handles December correctly',
        input: new Date(Date.UTC(2024, 11, 31, 23, 59, 59)),
        expected: '2024-12-31',
    },
    {
        description: 'handles single-digit days',
        input: new Date(Date.UTC(2025, 3, 5, 10, 0, 0)),
        expected: '2025-04-05',
    },
];

/**
 * Test cases for toLocalISOTime function
 */
export const toLocalISOTimeData = [
    {
        description: 'converts UTC date to YYYY-MM-DDTHH:MM:SS format',
        input: new Date(Date.UTC(2025, 5, 1, 12, 23, 45)),
        expected: '2025-06-01T12:23:45',
    },
    {
        description: 'handles midnight correctly',
        input: new Date(Date.UTC(2025, 0, 1, 0, 0, 0)),
        expected: '2025-01-01T00:00:00',
    },
    {
        description: 'handles end of day correctly',
        input: new Date(Date.UTC(2025, 11, 31, 23, 59, 59)),
        expected: '2025-12-31T23:59:59',
    },
];

/**
 * Test cases for rewriteISOToZone function
 */
export const rewriteISOToZoneData = [
    {
        description: 'rewrites Z offset to +00:00 (no seconds)',
        input: ['2025-06-01T12:23Z', 'UTC'],
        expected: '2025-06-01T12:23+00:00',
    },
    {
        description: 'rewrites Z offset to +00:00 (with seconds and millis)',
        input: ['2025-06-01T12:23:45.123Z', 'UTC'],
        expected: '2025-06-01T12:23:45.123+00:00',
    },
    {
        description: 'rewrites offset input to target offset',
        input: ['2025-06-01T12:23:00+02:00', 'UTC'],
        expected: '2025-06-01T12:23:00+00:00',
    },
    {
        description: 'handles different timezone offset',
        input: ['2025-06-01T12:23:00-05:00', 'UTC'],
        expected: '2025-06-01T12:23:00+00:00',
    },
];

/**
 * Test cases for fromISOtoLocal function
 */
export const fromISOtoLocalData = [
    {
        description: 'parses ISO string with seconds into UTC Date',
        input: '2025-06-01T12:23:15',
        expected: '2025-06-01T12:23:15.000Z',
    },
    {
        description: 'parses ISO string without seconds (defaults to 00)',
        input: '2025-06-01T12:23',
        expected: '2025-06-01T12:23:00.000Z',
    },
    {
        description: 'handles midnight',
        input: '2025-01-01T00:00:00',
        expected: '2025-01-01T00:00:00.000Z',
    },
    {
        description: 'handles end of day',
        input: '2025-12-31T23:59:59',
        expected: '2025-12-31T23:59:59.000Z',
    },
];

/**
 * Test cases for performAPIAction function with user session
 */
export const performAPIActionUserData = [
    {
        description: 'calls user action with body and user ID',
        body: { foo: 'bar' },
        session: { user: { id: 42 } },
        expectedAction: 'user',
        expectedArgs: [{ foo: 'bar' }, 42],
    },
    {
        description: 'calls user action with empty body',
        body: {},
        session: { user: { id: 1 } },
        expectedAction: 'user',
        expectedArgs: [{}, 1],
    },
    {
        description: 'calls user action with complex body',
        body: { title: 'Test', items: [1, 2, 3], nested: { key: 'value' } },
        session: { user: { id: 99 } },
        expectedAction: 'user',
        expectedArgs: [{ title: 'Test', items: [1, 2, 3], nested: { key: 'value' } }, 99],
    },
];

/**
 * Test cases for performAPIAction function with guest session
 */
export const performAPIActionGuestData = [
    {
        description: 'calls guest action with body and guest ID',
        body: { foo: 'bar' },
        session: { guest: { id: 7 } },
        expectedAction: 'guest',
        expectedArgs: [{ foo: 'bar' }, 7],
    },
    {
        description: 'calls guest action with different guest ID',
        body: { data: 'test' },
        session: { guest: { id: 123 } },
        expectedAction: 'guest',
        expectedArgs: [{ data: 'test' }, 123],
    },
];

/**
 * Test cases for getResource function
 */
export const getResourceData = [
    {
        description: 'returns resource when key exists',
        resource: { event: { id: 1 }, user: { id: 2 } },
        key: 'event',
        expected: { id: 1 },
    },
    {
        description: 'returns different resource',
        resource: { event: { id: 1 }, user: { id: 2 } },
        key: 'user',
        expected: { id: 2 },
    },
    {
        description: 'returns undefined for missing key',
        resource: { event: { id: 1 }, user: { id: 2 } },
        key: 'none',
        expected: undefined,
    },
    {
        description: 'handles empty resource object',
        resource: {},
        key: 'event',
        expected: undefined,
    },
];

/**
 * Test cases for isWithinWindow function
 */
export const isWithinWindowData = [
    {
        description: 'returns true when dates are within window',
        start: new Date('2025-01-01T00:00:00Z'),
        end: new Date('2025-01-10T00:00:00Z'),
        a: new Date('2025-01-02T00:00:00Z'),
        d: new Date('2025-01-05T00:00:00Z'),
        expected: true,
    },
    {
        description: 'returns false when dates are outside window',
        start: new Date('2025-01-01T00:00:00Z'),
        end: new Date('2025-01-10T00:00:00Z'),
        a: new Date('2025-01-02T00:00:00Z'),
        d: new Date('2025-01-11T00:00:00Z'),
        expected: false,
    },
    {
        description: 'returns true when dates are at window boundaries',
        start: new Date('2025-01-01T00:00:00Z'),
        end: new Date('2025-01-10T00:00:00Z'),
        a: new Date('2025-01-01T00:00:00Z'),
        d: new Date('2025-01-10T00:00:00Z'),
        expected: true,
    },
    {
        description: 'returns false when start date is before window',
        start: new Date('2025-01-05T00:00:00Z'),
        end: new Date('2025-01-10T00:00:00Z'),
        a: new Date('2025-01-01T00:00:00Z'),
        d: new Date('2025-01-08T00:00:00Z'),
        expected: false,
    },
];

/**
 * Test cases for ignoreException function
 */
export const ignoreExceptionData = [
    {
        description: 'returns value when function succeeds',
        fn: () => 123,
        expected: 123,
        shouldWarn: false,
    },
    {
        description: 'returns string value',
        fn: () => 'test',
        expected: 'test',
        shouldWarn: false,
    },
    {
        description: 'returns object value',
        fn: () => ({ key: 'value' }),
        expected: { key: 'value' },
        shouldWarn: false,
    },
    {
        description: 'returns undefined and warns when function throws',
        fn: () => {
            throw new Error('boom');
        },
        expected: undefined,
        shouldWarn: true,
    },
    {
        description: 'returns undefined and warns for different error',
        fn: () => {
            throw new Error('test error');
        },
        expected: undefined,
        shouldWarn: true,
    },
];
