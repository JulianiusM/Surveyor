import {afterEach, describe, expect, it, vi} from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import session from 'express-session';
import http from 'node:http';
import apiRouter, {handleApiError} from '../../src/backend/routes/api';
import {apiCompatibility} from '../../.generated/api/v1/policy.mjs';
import {contractValidator} from '../../src/backend/modules/api/contracts';
import {handleGenericError} from '../../src/backend/middleware/genericErrorHandler';
import {createTranslator} from '../../src/common/localization/translator';
import settings from '../../src/backend/modules/settings';

const cleanups: Array<() => Promise<void>> = [];

afterEach(async function disposeApiRoutingFixtures(): Promise<void> {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
});

/** Exercise the real API root, version selector and domain routers over HTTP.
 * Anonymous requests and rejected inputs keep ORM persistence outside this
 * boundary; Express and its MemoryStore retain their actual session lifecycle. */
async function apiRoutingFixture() {
    const app = express();
    const store = new session.MemoryStore();
    const server = http.createServer(app);
    cleanups.push(dispose);

    // Use the development deployment projection without requiring built assets.
    // No production route, validator, controller or store method is replaced.
    vi.stubEnv('SURVEYOR_FRONTEND_DEV', '1');
    app.use(express.json());
    app.use(cookieParser());
    app.use(session({secret: 'api-routing-fixture', store, resave: false, saveUninitialized: false}));
    app.use('/api', apiRouter);
    app.use(function applicationMissingRoute(req, res) {
        // Unregistered versions fall through to their application's ordinary
        // missing-route owner, outside v1's generated Problem contract.
        res.status(404).type('text/plain').send(`Application route missing: ${req.originalUrl}`);
    });
    app.use('/api', handleApiError);
    app.use(handleGenericError);

    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('The API routing listener has no port.');
    const origin = `http://127.0.0.1:${address.port}`;
    vi.spyOn(settings, 'value', 'get').mockReturnValue({...settings.value, rootUrl: origin});

    /** Observe actual stored rows without initializing or substituting a database. */
    async function storedSessions(): Promise<number> {
        return new Promise((resolve, reject) => store.length(function receiveSessionCount(error, length) {
            if (error) reject(error);
            else if (length === undefined) reject(new Error('The session store did not return its row count.'));
            else resolve(length);
        }));
    }

    /** Release the fixture's owned listener and session state after every case. */
    async function dispose(): Promise<void> {
        if (server.listening) {
            server.closeAllConnections();
            await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        }
        await new Promise<void>((resolve, reject) => store.clear(error => error ? reject(error) : resolve()));
    }

    return {origin, storedSessions, commandHeaders: {'Content-Type': 'application/json', Origin: origin,
            'X-Surveyor-Api-Compatibility': apiCompatibility}};
}

describe('layered API route composition', () => {
    it('dispatches early parsing errors by version before session middleware can run', async () => {
        const fixture = await apiRoutingFixture();
        const privateInput = 'private-parser-input';
        const headers = {...fixture.commandHeaders, 'X-Surveyor-Locale': 'de'};
        const malformed = `{"password":"${privateInput}",`;
        // Express mounts are case-insensitive and admit a trailing slash. Early
        // parser failures must select the same version as ordinary dispatch.
        for (const route of ['/api/v1/locale', '/api/V1/locale/']) {
            const response = await fetch(`${fixture.origin}${route}`, {method: 'PUT', headers, body: malformed});
            const problem = await response.json();
            expect(response.status).toBe(400);
            expect(response.headers.get('content-type')).toContain('application/problem+json');
            expect(response.headers.get('content-language')).toBe('de');
            expect(response.headers.get('cache-control')).toBe('private, no-store');
            expect(response.headers.get('set-cookie')).toBeNull();
            expect(contractValidator('Problem')(problem)).toBe(true);
            expect(problem).toMatchObject({code: 'INVALID_JSON', params: {},
                detail: createTranslator('de').t('api:errors.INVALID_JSON')});
            expect(JSON.stringify(problem)).not.toContain(privateInput);
        }

        // The same parser failure for an unsupported version reaches the actual
        // generic owner, rather than borrowing the supported version's schema.
        const unsupported = await fetch(`${fixture.origin}/api/v2/locale`, {method: 'PUT', headers, body: malformed});
        expect(unsupported.status).toBe(400);
        expect(unsupported.headers.get('content-type')).toContain('text/plain');
        expect(unsupported.headers.get('cache-control')).toBe('private, no-store');
        expect(await unsupported.text()).toBe(createTranslator('de').t('api:errors.VALIDATION_FAILED'));
        expect(unsupported.headers.get('set-cookie')).toBeNull();
        expect(await fixture.storedSessions()).toBe(0);
    });

    it('reaches the session domain and admits locale changes without persisting anonymous identity', async () => {
        const fixture = await apiRoutingFixture();
        const initial = await fetch(`${fixture.origin}/api/v1/session`, {headers: {'X-Surveyor-Locale': 'en'}});
        const view = await initial.json();
        expect(initial.status).toBe(200);
        expect(contractValidator('SessionView')(view)).toBe(true);
        expect(view).toMatchObject({kind: 'anonymous', context: null, csrfToken: null, activeProfile: null,
            profiles: [], locale: 'en', logoutUrl: null, deployment: {apiCompatibility}});
        expect(initial.headers.get('cache-control')).toBe('private, no-store');
        expect(initial.headers.get('x-surveyor-context')).toBeNull();
        expect(initial.headers.get('set-cookie')).toBeNull();

        // Admission precedes preference delivery, and generated closed-shape
        // validation still applies after crossing both router mounts.
        const denied = await fetch(`${fixture.origin}/api/v1/locale`, {method: 'PUT',
            headers: {...fixture.commandHeaders, Origin: 'https://untrusted.example'}, body: JSON.stringify({locale: 'de'})});
        expect(denied.status).toBe(403);
        expect((await denied.json()).code).toBe('CSRF_INVALID');
        expect(denied.headers.get('set-cookie')).toBeNull();
        const invalid = await fetch(`${fixture.origin}/api/v1/locale`, {method: 'PUT',
            headers: fixture.commandHeaders, body: JSON.stringify({locale: 'de', profileId: 'untrusted'})});
        expect(invalid.status).toBe(400);
        expect((await invalid.json()).code).toBe('VALIDATION_FAILED');
        expect(invalid.headers.get('set-cookie')).toBeNull();

        const changed = await fetch(`${fixture.origin}/api/v1/locale`, {method: 'PUT',
            headers: fixture.commandHeaders, body: JSON.stringify({locale: 'de'})});
        expect(changed.status).toBe(200);
        expect(await changed.json()).toMatchObject({kind: 'anonymous', context: null, csrfToken: null, locale: 'de'});
        expect(changed.headers.get('content-language')).toBe('de');
        expect(changed.headers.get('set-cookie')).toMatch(/^surveyor_locale=de;/u);
        expect(changed.headers.get('set-cookie')).not.toContain('connect.sid');
        expect(await fixture.storedSessions()).toBe(0);
    });

    it('retains generated query and feature parameter validation before Help or database reads', async () => {
        const fixture = await apiRoutingFixture();
        const help = await fetch(`${fixture.origin}/api/v1/help?unexpected=fixture`);
        expect(help.status).toBe(400);
        expect(await help.json()).toMatchObject({code: 'VALIDATION_FAILED',
            fieldErrors: [{pointer: '/query', code: 'unknown'}]});

        // Description is independently public-grantable, so malformed UUID
        // rejection exercises its real decoder without needing an ORM actor.
        const feature = await fetch(`${fixture.origin}/api/v1/packing-lists/not-a-uuid/description`);
        expect(feature.status).toBe(400);
        expect(await feature.json()).toMatchObject({code: 'VALIDATION_FAILED',
            fieldErrors: [{pointer: '/path/listId', code: 'format'}]});
        expect(await fixture.storedSessions()).toBe(0);
    });

    it('uses v1 Problems for known-version misses and leaves unsupported versions to the application', async () => {
        const fixture = await apiRoutingFixture();
        for (const route of ['/api/v1?hint=1', '/api/v1/packing-lists/84305c09-5386-47bc-b62d-520b8a8edbb2/no-such-operation']) {
            const missing = await fetch(`${fixture.origin}${route}`);
            const problem = await missing.json();
            expect(missing.status).toBe(404);
            expect(missing.headers.get('content-type')).toContain('application/problem+json');
            expect(contractValidator('Problem')(problem)).toBe(true);
            expect(problem.code).toBe('NOT_FOUND');
        }

        // The existing application fallback has no invented v2 wire schema.
        // Dispatching this URL into v1 would instead return a SessionView.
        for (const route of ['/api/v2/session?fixture=kept', '/api/v10/profiles', '/api/v1-other',
            '/api/packing/search?returnTo=/api/v1']) {
            const unsupported = await fetch(`${fixture.origin}${route}`);
            expect(unsupported.status).toBe(404);
            expect(unsupported.headers.get('content-type')).toContain('text/plain');
            expect(await unsupported.text()).toBe(`Application route missing: ${route}`);
            expect(unsupported.headers.get('set-cookie')).toBeNull();
        }
        expect(await fixture.storedSessions()).toBe(0);
    });
});
