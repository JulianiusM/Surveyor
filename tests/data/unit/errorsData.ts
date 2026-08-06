/**
 * Test data for error class tests
 */

/**
 * Test cases for APIError
 */
export const apiErrorData = [
    {
        description: 'sets name, status and data',
        message: 'boom',
        data: { foo: 'bar' },
        status: 418,
        expected: {
            name: 'APIError',
            status: 418,
            data: { foo: 'bar' },
            message: 'boom',
        },
    },
    {
        description: 'handles different status codes',
        message: 'error',
        data: { error: 'details' },
        status: 500,
        expected: {
            name: 'APIError',
            status: 500,
            data: { error: 'details' },
            message: 'error',
        },
    },
];

/**
 * Test cases for ExpectedError
 */
export const expectedErrorData = [
    {
        description: 'sets severity and defaults',
        message: 'expected!',
        severity: 'info',
        status: 400,
        data: { a: 1 },
        expected: {
            name: 'ExpectedError',
            severity: 'info',
            data: { a: 1 },
            message: 'expected!',
        },
    },
    {
        description: 'handles different severity levels',
        message: 'warning message',
        severity: 'warning',
        status: 422,
        data: { field: 'value' },
        expected: {
            name: 'ExpectedError',
            severity: 'warning',
            data: { field: 'value' },
            message: 'warning message',
        },
    },
];

/**
 * Test cases for ValidationError
 */
export const validationErrorData = [
    {
        description: 'carries template and data',
        template: 'form',
        message: 'test',
        data: { v: 1 },
        expected: {
            name: 'ValidationError',
            template: 'form',
            message: 'test',
            data: { v: 1 },
        },
    },
    {
        description: 'handles different templates',
        template: 'survey',
        message: 'validation failed',
        data: { field: 'title' },
        expected: {
            name: 'ValidationError',
            template: 'survey',
            message: 'validation failed',
            data: { field: 'title' },
        },
    },
];
