/**
 * Test data for renderer module tests
 */

/**
 * Test cases for message rendering helpers
 */
export const messageRenderingData = [
    {
        description: 'renderError uses "message" page with error status and message only',
        method: 'renderError',
        args: ['Oops'],
        expected: { template: 'message', params: { status: 'error', message: 'Oops', data: undefined } },
    },
    {
        description: 'renderInfoData uses "message" page with info status and passes data',
        method: 'renderInfoData',
        args: ['Heads up', { a: 1 }],
        expected: { template: 'message', params: { status: 'info', message: 'Heads up', data: { a: 1 } } },
    },
    {
        description: 'renderSuccess defaults data to undefined',
        method: 'renderSuccess',
        args: ['All good'],
        expected: { template: 'message', params: { status: 'success', message: 'All good', data: undefined } },
    },
    {
        description: 'renderMessage forwards arbitrary status',
        method: 'renderMessage',
        args: ['success', 'Yay'],
        expected: { template: 'message', params: { status: 'success', message: 'Yay', data: undefined } },
    },
];

/**
 * Test cases for page rendering helpers
 */
export const pageRenderingData = [
    {
        description: 'render(page) renders with all fields undefined',
        method: 'render',
        args: ['dashboard'],
        expected: { template: 'dashboard', params: { status: undefined, message: undefined, data: undefined } },
    },
    {
        description: 'renderWithErrorData renders given page with error status and data',
        method: 'renderWithErrorData',
        args: ['login', 'Bad creds', { retry: true }],
        expected: { template: 'login', params: { status: 'error', message: 'Bad creds', data: { retry: true } } },
    },
    {
        description: 'renderWithInfo renders given page with info status and no data',
        method: 'renderWithInfo',
        args: ['profile', 'Updated'],
        expected: { template: 'profile', params: { status: 'info', message: 'Updated', data: undefined } },
    },
    {
        description: 'renderWithSuccessData renders with success status and provided data',
        method: 'renderWithSuccessData',
        args: ['done', 'OK', { id: 5 }],
        expected: { template: 'done', params: { status: 'success', message: 'OK', data: { id: 5 } } },
    },
    {
        description: 'renderWithMessage renders with provided status/message and undefined data',
        method: 'renderWithMessage',
        args: ['pageX', 'success', 'Alright'],
        expected: { template: 'pageX', params: { status: 'success', message: 'Alright', data: undefined } },
    },
    {
        description: 'renderWithData renders with data only (status/message undefined)',
        method: 'renderWithData',
        args: ['pageY', { x: 1 }],
        expected: { template: 'pageY', params: { status: undefined, message: undefined, data: { x: 1 } } },
    },
];

/**
 * Test cases for JSON response helpers
 */
export const jsonResponseData = [
    {
        description: 'respondWithErrorJson sends structured error JSON with null data',
        method: 'respondWithErrorJson',
        args: ['Nope'],
        expected: { status: 'error', message: 'Nope', data: null },
    },
    {
        description: 'respondWithInfoDataJson sends structured info JSON with data',
        method: 'respondWithInfoDataJson',
        args: ['Heads', { hint: 'try again' }],
        expected: { status: 'info', message: 'Heads', data: { hint: 'try again' } },
    },
    {
        description: 'respondWithSuccessJson sends success JSON with null data',
        method: 'respondWithSuccessJson',
        args: ['OK'],
        expected: { status: 'success', message: 'OK', data: null },
    },
    {
        description: 'respondStructuredJson uses respondWithJson under the hood',
        method: 'respondStructuredJson',
        args: ['success', 'Fine', { a: 1 }],
        expected: { status: 'success', message: 'Fine', data: { a: 1 } },
    },
];

/**
 * Test cases for raw response helpers
 */
export const rawResponseData = [
    {
        description: 'respondWithJson sets header and ends with raw JSON string',
        method: 'respondWithJson',
        args: [{ a: 1 }],
        expectedJson: '{"a":1}',
        expectsHeader: true,
    },
    {
        description: 'respond sends raw payload and does not set header',
        method: 'respond',
        args: ['raw'],
        expectedRaw: 'raw',
        expectsHeader: false,
    },
];
