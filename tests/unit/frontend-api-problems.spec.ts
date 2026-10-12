import {describe, expect, it} from 'vitest';
import type {NextFunction, Request, Response} from 'express';
import {ApiProblem, handleApiProblem, requestLocale} from '../../src/modules/api/problem';
import {contractValidator} from '../../src/modules/api/contracts';
import {createTranslator} from '../../src/modules/localization/translator';
import {ExpectedError, ValidationError} from '../../src/modules/lib/errors';
import {frontendIdentityProblemKey} from '../../src/modules/lib/frontendIdentity';
import {loginUser, registerUser, resetPassword} from '../../src/controller/userController';
import {normalizePackingMetadataPatch} from '../../src/controller/packingController';
import {validateApiInput} from '../../src/modules/api/transport';

/** Only request data used by the pure negotiation/error boundary is present; no application or database starts. */
function request(options: {header?: string; cookie?: unknown; languages?: string[]; context?: string} = {}): Request {
    return {
        get: (name: string) => name === 'X-Surveyor-Locale' ? options.header : undefined,
        cookies: {surveyor_locale: options.cookie},
        acceptsLanguages: () => options.languages ?? [],
        ...(options.context ? {apiActor: {context: options.context}} : {}),
    } as unknown as Request;
}

/** Capture the actual middleware response without replacing its translator, classifier or generated validator. */
function respond(error: unknown, req: Request) {
    const result: {status?: number; type?: string; headers: Record<string, string>; body?: unknown} = {headers: {}};
    const response = {
        status(value: number) { result.status = value; return this; },
        type(value: string) { result.type = value; return this; },
        set(name: string, value: string) { result.headers[name] = value; return this; },
        json(value: unknown) { result.body = value; return this; },
    };
    const next: NextFunction = () => { throw new Error('The API problem must be handled at this boundary'); };
    handleApiProblem(error, req, response as unknown as Response, next);
    return result;
}

describe('API request locale negotiation', () => {
    it('chooses the first supported accepted language instead of falling back on the first unsupported one', () => {
        expect(requestLocale(request({languages: ['fr', 'de']}))).toBe('de');
        expect(requestLocale(request({languages: ['fr', 'de-DE', 'en']}))).toBe('de');
        expect(requestLocale(request({languages: ['en-GB', 'de']}))).toBe('en');
    });

    it('skips invalid and unsupported-script hints without turning them into a different script', () => {
        expect(requestLocale(request({languages: ['invalid locale', 'de-Qaaa', 'de-DE']}))).toBe('de');
        expect(requestLocale(request({languages: ['de-Qaaa', 'en']}))).toBe('en');
        expect(requestLocale(request({languages: ['invalid locale', 'zz-ZZ', '*']}))).toBe('en');
        expect(requestLocale(request())).toBe('en');
    });

    it('preserves explicit header then cookie precedence over accepted-language hints', () => {
        expect(requestLocale(request({header: 'de', cookie: 'en', languages: ['en']}))).toBe('de');
        expect(requestLocale(request({cookie: 'de-DE', languages: ['en']}))).toBe('de');
        expect(requestLocale(request({header: 'invalid locale', cookie: 'de', languages: ['de']}))).toBe('en');
        expect(requestLocale(request({cookie: {locale: 'de'}, languages: ['de']}))).toBe('en');
    });
});

describe('validated API problem output', () => {
    it('retains the original capacity wording while keeping the versioned parameter envelope', () => {
        const itemId = 'd506d78a-e2d7-4be9-bc95-04d83bbd22ec';
        const result = respond(new ApiProblem('PACKING_ITEM_FULL', {itemId}), request({header: 'en'}));
        expect(result.body).toMatchObject({code: 'PACKING_ITEM_FULL', status: 409,
            messageKey: 'api:errors.PACKING_ITEM_FULL', params: {itemId},
            detail: 'This packing item is already fully assigned'});
        expect(contractValidator('Problem')(result.body)).toBe(true);
    });

    it('retains the original parent-change wording without changing its typed conflict', () => {
        const result = respond(new ApiProblem('ENTITY_CONTEXT_CHANGED'), request({header: 'en'}));
        expect(result.body).toMatchObject({code: 'ENTITY_CONTEXT_CHANGED', status: 409,
            messageKey: 'api:errors.ENTITY_CONTEXT_CHANGED', params: {},
            detail: 'The linked event changed. Reload and try again.'});
        expect(contractValidator('Problem')(result.body)).toBe(true);
    });

    it('keeps versioned metadata validation bounded instead of publishing native structural prose', () => {
        try {
            validateApiInput('updatePackingMetadata', normalizePackingMetadataPatch({description: 'D'.repeat(16001)}));
            throw new Error('Invalid versioned metadata was accepted');
        } catch (error) {
            const result = respond(error, request({header: 'en'}));
            expect(result.body).toMatchObject({code: 'VALIDATION_FAILED', status: 400,
                detail: 'Check the submitted values.', fieldErrors: [{pointer: '/description', code: 'invalid'}]});
            expect(contractValidator('Problem')(result.body)).toBe(true);
            expect(JSON.stringify(result.body)).not.toContain('16000 characters');
        }
    });

    it('keeps the versioned sparse-patch rule closed to undefined-only internal inputs', () => {
        // JSON cannot encode undefined; the real versioned body normalizer treats it as omitted.
        // Native's distinct optional own-key tracking update must never weaken this boundary.
        expect(() => validateApiInput('updatePackingMetadata', normalizePackingMetadataPatch({description: undefined})))
            .toThrow(expect.objectContaining({code: 'VALIDATION_FAILED', status: 400}));
    });

    it('retains native controller validation wording, cause and renderer data from the shared catalog', async () => {
        // These production early-rejection paths require no persistence or mail.
        // Literal expectations remain independent of the catalog implementation.
        await expect(loginUser({username: '', password: ''}, {} as Request['session'])).rejects.toMatchObject({
            message: 'Invalid username/email or password', cause: 'INVALID_CREDENTIALS', template: 'users/login', data: {username: ''},
        });
        await expect(registerUser({username: 'entered', displayname: 'Entered name', email: 'entered@example.invalid',
            password: 'First-password!A1', password_repeat: 'Second-password!A1'})).rejects.toMatchObject({
            message: 'Passwords do not match.', cause: 'PASSWORD_MISMATCH', template: 'users/register',
            data: {username: 'entered', email: 'entered@example.invalid'},
        });
        await expect(resetPassword('unread-token', {password: 'first', confirmPassword: 'second'})).rejects.toMatchObject({
            message: 'Passwords do not match!', cause: 'PASSWORD_MISMATCH', template: 'users/reset-password', data: {token: 'unread-token'},
        });
    });

    it.each([
        ['login', 'INVALID_CREDENTIALS', 'Invalid username/email or password'],
        ['login', 'ACCOUNT_INACTIVE', 'User not activated.'],
        ['login', 'ACTIVATION_RESENT', 'User not activated. The activation link has expired. A new one has been sent to your email account.'],
        ['register', 'PASSWORD_MISMATCH', 'Passwords do not match.'],
        ['register', 'USERNAME_TAKEN', 'This username is already taken.'],
        ['reset', 'PASSWORD_MISMATCH', 'Passwords do not match!'],
        ['reset', 'TOKEN_INVALID', 'Invalid or expired token'],
        ['activate', 'TOKEN_INVALID', 'Invalid or expired token'],
        ['login', 'LOCAL_LOGIN_DISABLED', 'Login is not enabled!'],
        ['register', 'LOCAL_LOGIN_DISABLED', 'Login is not enabled!'],
        ['forgot', 'LOCAL_LOGIN_DISABLED', 'Login is not enabled!'],
        ['reset', 'LOCAL_LOGIN_DISABLED', 'Login is not enabled!'],
        ['activate', 'LOCAL_LOGIN_DISABLED', 'Login is not enabled!'],
    ] as const)('retains native %s/%s presentation independently of its API transport message', (operation, code, nativeMessage) => {
        const key = frontendIdentityProblemKey(operation, code);
        expect(key).toBeDefined();
        expect(createTranslator('en').t(key!)).toBe(nativeMessage);
        // The presentation owner never alters stable status/code or emits private
        // renderer values. German remains catalog-owned rather than raw exception prose.
        expect(respond(new ApiProblem(code), request()).body).toMatchObject({code});
        expect(createTranslator('de').t(key!)).not.toBe(nativeMessage);
    });

    it('leaves unrelated and future operation/code pairs to their ordinary problem projection', () => {
        expect(frontendIdentityProblemKey('forgot', 'TOKEN_INVALID')).toBeUndefined();
        expect(frontendIdentityProblemKey('login', 'INTERNAL_ERROR')).toBeUndefined();
        expect(frontendIdentityProblemKey('reset', 'FORBIDDEN')).toBeUndefined();
    });

    it.each([
        ['INVALID_CREDENTIALS', 401], ['ACCOUNT_INACTIVE', 403], ['ACTIVATION_RESENT', 403],
        ['USERNAME_TAKEN', 409], ['PASSWORD_MISMATCH', 400], ['TOKEN_INVALID', 401],
    ] as const)('preserves controller-owned %s identity distinctions with a localized contract', (code, status) => {
        const error = code === 'TOKEN_INVALID'
            ? new ExpectedError('Private native renderer message', 'error', 401, {}, {cause: code})
            : new ValidationError('users/login', 'Private native renderer message', {}, {cause: code});
        const result = respond(error, request({header: 'de', context: 'old-context'}));
        expect(result.status).toBe(status);
        expect(result.body).toMatchObject({code, status, params: {}});
        expect(contractValidator('Problem')(result.body)).toBe(true);
        expect(JSON.stringify(result.body)).not.toContain('Private native');
        expect(result.headers['X-Surveyor-Context']).toBe('old-context');
    });

    it('does not trust an unexpected exception merely because it claims an identity cause', () => {
        const result = respond(new Error('Private details', {cause: 'INVALID_CREDENTIALS'}), request());
        expect(result.body).toMatchObject({code: 'INTERNAL_ERROR', status: 500});
    });

    it('retains a valid localized problem and its admitted context', () => {
        const result = respond(new ApiProblem('PACKING_ITEM_FULL', {itemId: 'd506d78a-e2d7-4be9-bc95-04d83bbd22ec'}),
            request({languages: ['fr', 'de'], context: 'admitted-context'}));
        expect(result.status).toBe(409);
        expect(result.type).toBe('application/problem+json');
        expect(result.headers).toMatchObject({'Content-Language': 'de', 'X-Surveyor-Context': 'admitted-context',
            'Cache-Control': 'private, no-store'});
        expect(contractValidator('Problem')(result.body)).toBe(true);
        expect(result.body).toMatchObject({code: 'PACKING_ITEM_FULL', status: 409,
            detail: createTranslator('de').t('api:errors.PACKING_ITEM_FULL', {itemId: 'd506d78a-e2d7-4be9-bc95-04d83bbd22ec'})});
    });

    it.each([
        {itemId: 'private-invalid-uuid'},
        {itemId: 42, privateNote: 'private-invalid-parameter'},
    ])('replaces malformed problem parameters with a validated localized internal error: %j', params => {
        const problem = new ApiProblem('PACKING_ITEM_FULL', {itemId: 'd506d78a-e2d7-4be9-bc95-04d83bbd22ec'});
        // Simulate a malformed runtime caller after construction. One case reaches Ajv; the other
        // fails the translation argument guard. Both must produce the same safe wire contract.
        Object.defineProperty(problem, 'params', {value: params});
        problem.message = 'Private implementation details';
        problem.fieldErrors = [{pointer: '/private-field', code: 'invalid'}];
        const result = respond(problem, request({header: 'de', context: 'admitted-context'}));
        expect(result.status).toBe(500);
        expect(result.type).toBe('application/problem+json');
        expect(result.headers).toMatchObject({'Content-Language': 'de', 'X-Surveyor-Context': 'admitted-context',
            'Cache-Control': 'private, no-store'});
        expect(contractValidator('Problem')(result.body)).toBe(true);
        expect(result.body).toMatchObject({code: 'INTERNAL_ERROR', status: 500, messageKey: 'api:errors.INTERNAL_ERROR',
            params: {}, requestId: expect.any(String), detail: createTranslator('de').t('api:errors.INTERNAL_ERROR')});
        expect(JSON.stringify(result.body)).not.toMatch(/private|Private/);
        expect(result.body).not.toHaveProperty('fieldErrors');
    });

    it('keeps unexpected exception details out of the structured fallback', () => {
        const result = respond(new Error('SQL password=private-secret'), request({cookie: 'de'}));
        expect(result.status).toBe(500);
        expect(contractValidator('Problem')(result.body)).toBe(true);
        expect(result.body).toMatchObject({code: 'INTERNAL_ERROR', params: {},
            detail: createTranslator('de').t('api:errors.INTERNAL_ERROR')});
        expect(JSON.stringify(result.body)).not.toContain('private-secret');
    });
});
