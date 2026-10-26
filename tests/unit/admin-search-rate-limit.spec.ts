import {describe, expect, it} from 'vitest';
import type {NextFunction, Request, Response} from 'express';
// The imported native middleware uses the application's installed Request.flash
// declaration; this erased import keeps its standalone test compilation complete.
import type {} from 'express-flash';
import {searchLimiter} from '../../src/backend/middleware/adminApiFactory';
import {classifyApiError, handleApiProblem} from '../../src/backend/modules/api/problem';
import {contractValidator} from '../../src/backend/modules/api/contracts';
import {APIError} from '../../src/backend/modules/lib/errors';

/** Exercise the actual in-memory limiter without HTTP, sessions, an application
 * server or database. Mounted route paths deliberately omit the protocol prefix. */
function request(ip: string, originalUrl: string): Request {
    return {
        ip, originalUrl, path: '/profiles', method: 'GET', headers: {},
        app: {get() { return false; }},
        get(name: string) { return name === 'X-Surveyor-Locale' ? 'de' : undefined; },
        acceptsLanguages() { return ['de']; },
        apiActor: {context: 'admitted-search-context'},
    } as unknown as Request;
}

/** Capture generated Problem output through the response object.
 * The limiter, its store, classifier, translator and validator remain production code. */
function response() {
    const result: {status?: number; type?: string; body?: unknown; headers: Record<string, string>} = {headers: {}};
    const res = {
        headersSent: false,
        status(code: number) { result.status = code; return this; },
        type(value: string) { result.type = value; return this; },
        send(value: unknown) { result.body = value; return this; },
        json(value: unknown) { result.body = value; return this; },
        set(name: string, value: string) { result.headers[name.toLowerCase()] = value; return this; },
        setHeader(name: string, value: string | number) { result.headers[name.toLowerCase()] = String(value); return this; },
        getHeader(name: string) { return result.headers[name.toLowerCase()]; },
    } as unknown as Response;
    return {result, res};
}

describe('shared versioned administrator search rate limit', () => {
    it('retains the 120-search budget and emits the admitted Problem response', async () => {
        const ip = '198.51.100.30';
        await searchLimiter.resetKey(ip);
        const req = request(ip, '/api/v1/packing-lists/selected/profiles?q=Example');
        const {result, res} = response();
        let admitted = 0;
        const next: NextFunction = function admitSearch(error) {
            if (error) handleApiProblem(error, req, res, next);
            else admitted += 1;
        };
        try {
            for (let index = 0; index < 120; index += 1) await searchLimiter(req, res, next);
            expect(admitted).toBe(120);
            expect(result.body).toBeUndefined();
            await searchLimiter(req, res, next);
            expect(admitted).toBe(120);
            expect(result.status).toBe(429);
            expect(result.body).toMatchObject({code: 'RATE_LIMITED', status: 429});
            expect(contractValidator('Problem')(result.body)).toBe(true);
            expect(result.headers['ratelimit-remaining']).toBe('0');
        } finally {
            await searchLimiter.resetKey(ip);
        }
    });

    it('shares that budget across entity families and emits a localized validated Problem', async () => {
        const ip = '198.51.100.31';
        await searchLimiter.resetKey(ip);
        const anotherFamily = request(ip, '/api/v1/drivers-lists/selected/profiles?q=Example');
        const versioned = request(ip, '/api/v1/packing-lists/selected/profiles?q=Example');
        const {result, res} = response();
        let admitted = 0;
        const next: NextFunction = function handleSearchOutcome(error) {
            if (error) handleApiProblem(error, versioned, res, next);
            else admitted += 1;
        };
        try {
            for (let index = 0; index < 119; index += 1) await searchLimiter(anotherFamily, res, next);
            await searchLimiter(versioned, res, next);
            expect(admitted).toBe(120);
            await searchLimiter(versioned, res, next);
            expect(admitted).toBe(120);
            expect(result.status).toBe(429);
            expect(result.type).toBe('application/problem+json');
            expect(result.body).toMatchObject({code: 'RATE_LIMITED', status: 429, params: {},
                messageKey: 'api:errors.RATE_LIMITED', detail: 'Zu viele Suchanfragen. Versuche es später erneut.'});
            expect(contractValidator('Problem')(result.body)).toBe(true);
            expect(result.headers['x-surveyor-context']).toBe('admitted-search-context');
            expect(result.headers['ratelimit-remaining']).toBe('0');
        } finally {
            await searchLimiter.resetKey(ip);
        }
    });

    it('classifies only recognized 429 error types', () => {
        expect(classifyApiError(new APIError('Private limiter details', {}, 429))).toMatchObject({code: 'RATE_LIMITED', status: 429});
        expect(classifyApiError({status: 429, message: 'Untrusted shape'})).toMatchObject({code: 'INTERNAL_ERROR', status: 500});
    });
});
