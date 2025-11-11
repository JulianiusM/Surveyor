/**
 * Test data for genericErrorHandler tests
 */

import { APIError, ExpectedError, ValidationError } from '../../../src/modules/lib/errors';

/**
 * Test cases for different error types
 */
export const errorHandlerData = [
    {
        description: 'ExpectedError -> renderer.renderMessageData',
        error: new ExpectedError('bad form', 'error', 400, { x: 1 }),
        expectedStatus: 400,
        expectedRendererMethod: 'renderMessageData',
    },
    {
        description: 'ValidationError -> renderer.renderWithErrorData',
        error: (() => {
            const err = new ValidationError('form', '', { a: 1 }) as any;
            err.status = 422;
            return err;
        })(),
        expectedStatus: 422,
        expectedRendererMethod: 'renderWithErrorData',
    },
    {
        description: 'APIError -> renderer.respondWithErrorDataJson',
        error: new APIError('nope', { x: 1 }, 418),
        expectedStatus: 418,
        expectedRendererMethod: 'respondWithErrorDataJson',
    },
    {
        description: 'Unknown Error -> renderer.render',
        error: new Error('mystery'),
        expectedStatus: 500,
        expectedRendererMethod: 'render',
        expectedRenderArgs: ['error'],
    },
];
