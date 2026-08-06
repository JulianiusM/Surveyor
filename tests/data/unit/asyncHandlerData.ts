/**
 * Test data for asyncHandler tests
 */

/**
 * Test cases for asyncHandler
 */
export const asyncHandlerData = [
    {
        description: 'forwards thrown error to next',
        error: new Error('boom'),
    },
    {
        description: 'handles different error types',
        error: new Error('different error'),
    },
];

/**
 * Test cases for asyncParamHandler
 */
export const asyncParamHandlerData = [
    {
        description: 'forwards thrown error to next',
        error: new Error('boom2'),
        paramId: 123,
    },
    {
        description: 'handles different param ids',
        error: new Error('param error'),
        paramId: 456,
    },
];
