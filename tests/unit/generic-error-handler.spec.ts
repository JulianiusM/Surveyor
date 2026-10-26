import {afterEach, describe, expect, it, vi} from 'vitest';
import type {NextFunction, Request, Response} from 'express';
import {handleGenericError} from '../../src/backend/middleware/genericErrorHandler';
import {APIError, ExpectedError, ValidationError} from '../../src/backend/modules/lib/errors';
import {ApiProblem, validatedProblemBody} from '../../src/backend/modules/api/problem';
import * as localization from '../../src/common/localization/translator';

const privateInput = 'private-password-database-and-parser-input';

afterEach(function restoreFailureInjection(): void {
    vi.restoreAllMocks();
});

/** Capture only HTTP delivery: no renderer, session, database or asset server is
 * present, and the real handler/catalog resolve the ordinary fallback wording. */
function genericErrorFixture(headersSent = false) {
    const output: {status?: number; type?: string; headers: Record<string, string>; body?: unknown} = {headers: {}};
    const req = {method: 'POST', body: {password: privateInput}, originalUrl: `/private?token=${privateInput}`,
        get: (name: string) => name === 'X-Surveyor-Locale' ? 'de' : undefined,
        acceptsLanguages: () => ['de']} as unknown as Request;
    const res = {
        headersSent,
        status(value: number) { output.status = value; return this; },
        type(value: string) { output.type = value; return this; },
        set(name: string, value: string) { output.headers[name] = value; return this; },
        send(value: unknown) { output.body = value; return this; },
    } as unknown as Response;
    const next = vi.fn();
    const logs = vi.spyOn(console, 'error').mockImplementation(() => {});
    return {req, res, next, logs, output};
}

/** Check the public fallback boundary rather than repeat its status classifier. */
function expectSafeResponse(fixture: ReturnType<typeof genericErrorFixture>, status: number): void {
    expect(fixture.output).toMatchObject({status, type: 'text/plain', headers: {'Cache-Control': 'private, no-store'}});
    expect(typeof fixture.output.body).toBe('string');
    expect(JSON.stringify(fixture.output)).not.toContain(privateInput);
    expect(JSON.stringify(fixture.logs.mock.calls)).not.toContain(privateInput);
    expect(fixture.next).not.toHaveBeenCalled();
}

describe('independent last-resort HTTP errors', () => {
    it('delivers safe text even when the same API error cannot produce its versioned projection', () => {
        const fixture = genericErrorFixture();
        const error = new ApiProblem('INTERNAL_ERROR');
        Object.assign(error, {message: privateInput, data: {password: privateInput}, params: {unexpected: privateInput}});
        // This is a genuinely broken generated projection. Last-resort delivery
        // must remain independent of its parameters, schema and serialization.
        expect(() => validatedProblemBody(error, 'de')).toThrow();
        expect(() => handleGenericError(error, fixture.req, fixture.res, fixture.next as NextFunction)).not.toThrow();
        expectSafeResponse(fixture, 500);
        expect(fixture.output.body).toBe(localization.createTranslator('de').t('common.internalError'));
    });

    it.each([
        ['owned forbidden operation', new APIError(privateInput, {password: privateInput}, 403), 403],
        ['expected missing document', new ExpectedError(privateInput, 'error', 404), 404],
        ['document validation failure', new ValidationError('private-template', privateInput, {password: privateInput}), 500],
        ['malformed request body', Object.assign(new SyntaxError(privateInput), {type: 'entity.parse.failed', body: privateInput}), 400],
        ['oversized request body', Object.assign(new Error(privateInput), {type: 'entity.too.large'}), 413],
        ['malformed route encoding', Object.assign(new URIError(privateInput), {status: 400}), 400],
        ['untrusted status-shaped error', Object.assign(new Error(privateInput), {status: 401}), 500],
    ] as const)('preserves the delivery boundary for %s', (_name, error, status) => {
        const fixture = genericErrorFixture();
        handleGenericError(error, fixture.req, fixture.res, fixture.next as NextFunction);
        expectSafeResponse(fixture, status);
        expect(fixture.output.headers['Retry-After']).toBeUndefined();
    });

    it('retains an owned temporary-unavailability retry delay without exposing its diagnostic', () => {
        const fixture = genericErrorFixture();
        handleGenericError(new APIError(privateInput, {retryAfter: 37, password: privateInput}, 503),
            fixture.req, fixture.res, fixture.next as NextFunction);
        expectSafeResponse(fixture, 503);
        expect(fixture.output.headers['Retry-After']).toBe('37');
    });

    it('still finishes the response when localization itself fails', () => {
        const fixture = genericErrorFixture();
        vi.spyOn(localization, 'createTranslator').mockImplementationOnce(() => { throw new Error(privateInput); });
        expect(() => handleGenericError(new Error(privateInput), fixture.req, fixture.res, fixture.next as NextFunction)).not.toThrow();
        expectSafeResponse(fixture, 500);
        expect(fixture.output.body).toBe('Request failed');
    });

    it('passes an already-started delivery failure to Express without writing another response', () => {
        const fixture = genericErrorFixture(true);
        const error = new Error(privateInput);
        handleGenericError(error, fixture.req, fixture.res, fixture.next as NextFunction);
        expect(fixture.next).toHaveBeenCalledExactlyOnceWith(error);
        expect(fixture.output).toEqual({headers: {}});
        expect(fixture.logs).not.toHaveBeenCalled();
    });
});
