/**
 * Test data for app integration tests
 */

/**
 * Test cases for smoke tests
 */
export const smokeTestData = [
    {
        description: 'GET / returns 200 and contains "Surveyor"',
        method: 'GET',
        path: '/',
        expectedStatus: 200,
        expectedTextMatch: /Surveyor/i,
    },
    {
        description: 'GET /nonexistent -> 404 via error handler',
        method: 'GET',
        path: '/definitely-not-a-real-route-xyz',
        expectedStatus: 404,
    },
];
