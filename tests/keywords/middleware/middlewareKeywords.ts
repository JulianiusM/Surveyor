/**
 * Keywords for middleware testing
 * Reusable actions for testing Express middleware with request/response mocks
 */

import express from 'express';
import request from 'express';
import { APIError, ExpectedError } from '../../../src/modules/lib/errors';

/**
 * Build an Express app with middleware for testing
 */
export function buildMiddlewareApp(
    middleware: any,
    config: {
        session?: any;
        resource?: any;
        additional?: any[];
    } = {}
): express.Express {
    const app = express();
    const { session, resource, additional } = config;

    // Setup parsers
    app.use(express.urlencoded({ extended: false }));
    app.use(express.json());

    // Inject test data
    app.use((req, _res, next) => {
        (req as any).session = session || {};
        (req as any).resource = resource;
        (req as any).additional = additional;
        (req as any).flash = jest.fn();
        next();
    });

    // Add the middleware under test
    app.get('/ok', middleware, (_req, res) => res.status(200).json({ ok: true }));

    // Error handler
    app.use((err: any, _req: any, res: any, _next: any) => {
        if (err instanceof APIError) {
            return res.status(err.status ?? 500).json({ kind: 'api', message: err.message });
        }
        if (err instanceof ExpectedError) {
            return res.status(err.status ?? 500).json({ kind: 'expected', message: err.message });
        }
        return res.status(500).json({ kind: 'unknown', message: err?.message || 'error' });
    });

    return app;
}

/**
 * Make a GET request to test middleware
 */
export async function makeGetRequest(
    app: express.Express,
    path: string = '/ok',
    query?: any
): Promise<any> {
    const supertest = require('supertest');
    let req = supertest(app).get(path);
    
    if (query) {
        req = req.query(query);
    }
    
    return await req;
}

/**
 * Verify middleware allows request through (200 OK)
 */
export function verifyMiddlewareAllows(response: any): void {
    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
}

/**
 * Verify middleware blocks request with specific status
 */
export function verifyMiddlewareBlocks(
    response: any,
    expectedStatus: number,
    expectedErrorType?: string
): void {
    expect(response.status).toBe(expectedStatus);
    if (expectedErrorType) {
        expect(response.body.kind).toBe(expectedErrorType);
    }
}

/**
 * Verify middleware redirects to a specific path
 */
export function verifyMiddlewareRedirects(response: any, expectedPath: string): void {
    expect(response.status).toBeGreaterThanOrEqual(300);
    expect(response.status).toBeLessThan(400);
    expect(response.header.location).toContain(expectedPath);
}

/**
 * Create a mock next function for middleware testing
 */
export function createMockNext(): jest.Mock {
    return jest.fn();
}

/**
 * Create a mock request object
 */
export function createMockRequest(config: {
    session?: any;
    resource?: any;
    additional?: any[];
    flash?: jest.Mock;
    params?: any;
    query?: any;
    body?: any;
}): any {
    return {
        session: config.session || {},
        resource: config.resource,
        additional: config.additional,
        flash: config.flash || jest.fn(),
        params: config.params || {},
        query: config.query || {},
        body: config.body || {},
    };
}

/**
 * Create a mock response object
 */
export function createMockResponse(): any {
    return {
        redirect: jest.fn(),
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
        send: jest.fn().mockReturnThis(),
    };
}

/**
 * Execute middleware directly (not through app)
 */
export function executeMiddleware(
    middleware: any,
    req: any,
    res: any,
    next: jest.Mock
): void {
    middleware(req, res, next);
}

/**
 * Verify next was called (middleware passed through)
 */
export function verifyNextCalled(next: jest.Mock, times: number = 1): void {
    expect(next).toHaveBeenCalledTimes(times);
}

/**
 * Verify next was not called (middleware blocked)
 */
export function verifyNextNotCalled(next: jest.Mock): void {
    expect(next).not.toHaveBeenCalled();
}

/**
 * Verify redirect was called with specific path
 */
export function verifyRedirect(res: any, path: string): void {
    expect(res.redirect).toHaveBeenCalledWith(path);
}

/**
 * Verify flash was called with message
 */
export function verifyFlash(req: any, type: string, message: string): void {
    expect(req.flash).toHaveBeenCalledWith(type, message);
}

/**
 * Test middleware with data-driven approach
 */
export async function testMiddlewareWithData<T>(
    middleware: any,
    testCases: T[],
    testFn: (testCase: T, app: express.Express) => Promise<void> | void
): Promise<void> {
    for (const testCase of testCases) {
        await testFn(testCase, null as any);
    }
}

/**
 * Setup and test middleware with success expectation
 */
export async function expectMiddlewareSuccess(
    middleware: any,
    session: any,
    resource: any,
    additional?: any[],
    query?: any
): Promise<void> {
    const app = buildMiddlewareApp(middleware, { session, resource, additional });
    const response = await makeGetRequest(app, '/ok', query);
    verifyMiddlewareAllows(response);
}

/**
 * Setup and test middleware with failure expectation
 */
export async function expectMiddlewareFailure(
    middleware: any,
    session: any,
    resource: any,
    expectedStatus: number,
    expectedErrorType?: string,
    additional?: any[],
    query?: any
): Promise<void> {
    const app = buildMiddlewareApp(middleware, { session, resource, additional });
    const response = await makeGetRequest(app, '/ok', query);
    verifyMiddlewareBlocks(response, expectedStatus, expectedErrorType);
}
