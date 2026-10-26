import {afterEach, describe, expect, it, vi} from 'vitest';
import express from 'express';
import type {NextFunction, Request, Response} from 'express';
import session from 'express-session';
import flash from 'express-flash';
import http from 'node:http';
import {captureApiActor, requireApiContext, sessionView} from '../../src/backend/modules/api/session';
import {handleApiProblem} from '../../src/backend/modules/api/problem';
import {persistSession, readStoredSession} from '../../src/backend/modules/lib/session';
import {asyncHandler} from '../../src/backend/modules/lib/asyncHandler';
import settings from '../../src/backend/modules/settings';
import {apiCompatibility} from '../../.generated/api/v1/policy.mjs';

const contextA = 'server-context-a-12345678901234567890';
const contextB = 'server-context-b-12345678901234567890';
const contextC = 'server-context-c-12345678901234567890';
const csrfA = 'server-csrf-a-12345678901234567890123';
const csrfB = 'server-csrf-b-12345678901234567890123';
const csrfC = 'server-csrf-c-12345678901234567890123';
const cleanups: Array<() => Promise<void>> = [];

afterEach(async function disposeSessionFixtures(): Promise<void> {
    for (const cleanup of cleanups.splice(0)) await cleanup();
    vi.restoreAllMocks();
});

/** Hold actual HTTP milestones without timer races or a substituted response. */
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(function retainResolution(settle) {
        resolve = settle;
    });
    return {promise, resolve};
}

/** Persist the fixture's external transition through the real session store.
 * These writes model another server request; no browser field supplies authority. */
async function replaceStoredContext(store: session.MemoryStore, sessionId: string,
                                    context: string, csrf: string): Promise<void> {
    const current = await readStoredSession(store, sessionId);
    if (!current) throw new Error('The fixture session must exist before its transition.');
    await new Promise<void>(function saveTransition(resolve, reject) {
        store.set(sessionId, {...current, frontendContext: context, frontendCsrfToken: csrf},
            function finishTransition(error): void {
                if (error) reject(error);
                else resolve();
            });
    });
}

/** Integrate production admission with Express's real load/save/touch lifecycle.
 * MemoryStore confines this response-completion boundary to HTTP middleware; it
 * neither initializes TypeORM nor claims transaction/identity workflow coverage. */
async function createSessionFixture(holdBefore = false, holdAfter = false, seed = true) {
    const store = new session.MemoryStore();
    const writes = vi.spyOn(store, 'set');
    const touches = vi.spyOn(store, 'touch');
    const loaded = deferred<Request>();
    const admitted = deferred<string | null>();
    const beforeAdmission = deferred<void>();
    const beforeResponse = deferred<void>();
    const app = express();
    app.use(express.json());
    app.use(session({secret: 'frontend-session-admission-fixture', resave: false,
        saveUninitialized: false, store, cookie: {maxAge: 1000 * 60 * 60 * 24}}));
    app.use(flash());
    app.post('/seed', seedSession);
    app.use(asyncHandler(holdLoadedRequest));
    app.get('/capture', asyncHandler(capture));
    app.get('/session', asyncHandler(projectSession));
    app.all('/context', asyncHandler(requireContext));
    app.post('/private', asyncHandler(requireProfile));
    app.post('/write', asyncHandler(writeSession));
    app.use(holdRejectedResponse);
    app.use(handleApiProblem);
    const server = http.createServer(app);
    await new Promise<void>(function listen(resolve) {
        server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('The session listener has no port.');
    const origin = `http://127.0.0.1:${address.port}`;
    vi.spyOn(settings, 'value', 'get').mockReturnValue({...settings.value, rootUrl: origin});
    cleanups.push(dispose);
    let cookie = '';
    let sessionId = '';
    if (seed) {
        const response = await fetch(`${origin}/seed`, {method: 'POST'});
        cookie = response.headers.get('set-cookie')?.split(';', 1)[0] ?? '';
        if (!cookie) throw new Error('The fixture seed did not establish its session cookie.');
        sessionId = await response.text();
    }
    writes.mockClear();
    touches.mockClear();

    /** Establish only server-owned synthetic anonymous authority for this test. */
    function seedSession(req: Request, res: Response): void {
        req.session.frontendContext = contextA;
        req.session.frontendCsrfToken = csrfA;
        res.send(req.sessionID);
    }

    /** Pause after the actual middleware load, before production admission reads
     * authoritative storage. Seeding stays outside this controlled schedule. */
    async function holdLoadedRequest(req: Request, _res: Response, next: NextFunction): Promise<void> {
        loaded.resolve(req);
        if (holdBefore) await beforeAdmission.promise;
        next();
    }

    /** Hold response completion independently of the actor already admitted. */
    async function capture(req: Request, res: Response): Promise<void> {
        const actor = await captureApiActor(req);
        admitted.resolve(actor.context);
        if (holdAfter) await beforeResponse.promise;
        res.json({context: actor.context, authenticated: !!actor.auth, profileId: actor.profile?.id ?? null});
    }

    /** The actual session projection must also permit a cookie-free public first visit. */
    async function projectSession(req: Request, res: Response): Promise<void> {
        res.json(await sessionView(req));
    }

    /** Exercise the actual header/CSRF guard; fixture JSON has no authority. */
    async function requireContext(req: Request, res: Response): Promise<void> {
        const actor = await requireApiContext(req, res);
        res.json({context: actor.context, authenticated: !!actor.auth, profileId: actor.profile?.id ?? null});
    }

    /** An anonymous stored session cannot become a principal through submitted
     * identity/profile/capability claims, even with matching transport evidence. */
    async function requireProfile(req: Request, res: Response): Promise<void> {
        await requireApiContext(req, res, true);
        res.sendStatus(204);
    }

    /** An existing session-taking operation deliberately persists its admitted
     * server snapshot. Response completion must not repeat that intentional write. */
    async function writeSession(req: Request, res: Response): Promise<void> {
        const actor = await requireApiContext(req, res);
        const current = req.session;
        current.frontendAuthReturn = '/server-owned-destination';
        await persistSession(current);
        admitted.resolve(actor.context);
        if (holdAfter) await beforeResponse.promise;
        res.json({context: actor.context});
    }

    /** Hold an actual rejected response independently of its read-only admission. */
    async function holdRejectedResponse(error: unknown, _req: Request, _res: Response, next: NextFunction): Promise<void> {
        admitted.resolve(null);
        if (holdAfter) await beforeResponse.promise;
        next(error);
    }

    /** Release held handlers before closing the listener, including failed assertions. */
    async function dispose(): Promise<void> {
        beforeAdmission.resolve();
        beforeResponse.resolve();
        await new Promise<void>(function close(resolve, reject) {
            server.close(function finishClose(error): void {
                if (error) reject(error);
                else resolve();
            });
            server.closeAllConnections();
        });
    }

    function headers(stateful = true): Record<string, string> {
        return {Origin: origin, 'X-Surveyor-Api-Compatibility': apiCompatibility,
            ...(cookie ? {Cookie: cookie} : {}),
            ...(stateful ? {'X-Surveyor-Context': contextA, 'X-CSRF-Token': csrfA} : {})};
    }

    return {store, writes, touches, loaded: loaded.promise, admitted: admitted.promise, origin, cookie, sessionId, headers,
        admit: beforeAdmission.resolve, respond: beforeResponse.resolve};
}

describe('frontend admission at the real session response boundary', () => {
    it('rejects changed stored context without replacing Express A or writing over later C', async () => {
        const fixture = await createSessionFixture(true, true);
        const response = fetch(`${fixture.origin}/capture`, {headers: {Cookie: fixture.cookie}});

        // Express loaded A. Admission rejects B instead of installing another
        // Session. Its unchanged response must not restore A or B over later C.
        const loaded = await fixture.loaded;
        const original = loaded.session;
        const save = original.save;
        const reload = original.reload;
        expect(loaded.session.frontendContext).toBe(contextA);
        await replaceStoredContext(fixture.store, fixture.sessionId, contextB, csrfB);
        fixture.admit();
        expect(await fixture.admitted).toBeNull();

        // Another server transition now commits C. Completing the rejection may
        // touch expiry, but must not save either earlier snapshot over that state.
        await replaceStoredContext(fixture.store, fixture.sessionId, contextC, csrfC);
        fixture.writes.mockClear();
        fixture.respond();
        const completed = await response;
        expect(completed.status).toBe(409);
        expect((await completed.json()).code).toBe('SESSION_CONTEXT_CHANGED');
        expect(loaded.session).toBe(original);
        expect(loaded.session.save).toBe(save);
        expect(loaded.session.reload).toBe(reload);
        expect(loaded.session.frontendContext).toBe(contextA);
        expect(await readStoredSession(fixture.store, fixture.sessionId)).toMatchObject({
            frontendContext: contextC, frontendCsrfToken: csrfC,
        });
        expect(fixture.writes).not.toHaveBeenCalled();
        expect(fixture.touches).toHaveBeenCalledOnce();
    });

    it('does not write back an unchanged stored context during an ordinary read', async () => {
        const fixture = await createSessionFixture();
        const response = await fetch(`${fixture.origin}/capture`, {headers: {Cookie: fixture.cookie}});
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({context: contextA, authenticated: false, profileId: null});
        expect(await readStoredSession(fixture.store, fixture.sessionId)).toMatchObject({
            frontendContext: contextA, frontendCsrfToken: csrfA,
        });
        expect(fixture.writes).not.toHaveBeenCalled();
        expect(fixture.touches).toHaveBeenCalledOnce();
    });

    it('does not restore an admitted read after a later explicit server transition', async () => {
        const fixture = await createSessionFixture(false, true);
        const response = fetch(`${fixture.origin}/capture`, {headers: {Cookie: fixture.cookie}});
        expect(await fixture.admitted).toBe(contextA);

        // A is valid at admission. Another request may commit C before this
        // response finishes; Express must retain its ordinary unchanged-read hash.
        await replaceStoredContext(fixture.store, fixture.sessionId, contextC, csrfC);
        fixture.writes.mockClear();
        fixture.respond();
        const completed = await response;
        expect(completed.status).toBe(200);
        expect(await completed.json()).toMatchObject({context: contextA});
        expect(await readStoredSession(fixture.store, fixture.sessionId)).toMatchObject({
            frontendContext: contextC, frontendCsrfToken: csrfC,
        });
        expect(fixture.writes).not.toHaveBeenCalled();
    });

    it('keeps an explicit admitted save and never repeats it after a later transition', async () => {
        const fixture = await createSessionFixture(false, true);
        const response = fetch(`${fixture.origin}/write`, {method: 'POST', headers: fixture.headers()});
        expect(await fixture.admitted).toBe(contextA);

        // The explicit operation owns this ordinary middleware-wrapped save.
        // No alternate Session or save observer acknowledges its persistence.
        expect(fixture.writes).toHaveBeenCalledOnce();
        expect(await readStoredSession(fixture.store, fixture.sessionId)).toMatchObject({
            frontendContext: contextA, frontendCsrfToken: csrfA, frontendAuthReturn: '/server-owned-destination',
        });
        await replaceStoredContext(fixture.store, fixture.sessionId, contextC, csrfC);
        fixture.writes.mockClear();
        fixture.respond();
        const completed = await response;
        expect(completed.status).toBe(200);
        expect(await completed.json()).toEqual({context: contextA});
        expect(await readStoredSession(fixture.store, fixture.sessionId)).toMatchObject({
            frontendContext: contextC, frontendCsrfToken: csrfC, frontendAuthReturn: '/server-owned-destination',
        });
        expect(fixture.writes).not.toHaveBeenCalled();
    });

    it('leaves a new anonymous visit uninitialized despite forged browser fields', async () => {
        const fixture = await createSessionFixture(false, false, false);
        const response = await fetch(`${fixture.origin}/session`, {headers: {
            'X-Surveyor-Context': 'browser-forged-context', 'X-CSRF-Token': 'browser-forged-csrf',
        }});
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body).toMatchObject({kind: 'anonymous', context: null, csrfToken: null, profiles: []});
        const loaded = await fixture.loaded;
        const stored = await readStoredSession(fixture.store, loaded.sessionID);
        expect(stored).toBeUndefined();
        expect(loaded.session.frontendContext).toBeUndefined();
        expect(loaded.session.frontendCsrfToken).toBeUndefined();
        expect(response.headers.get('set-cookie')).toBeNull();
        expect(fixture.writes).not.toHaveBeenCalled();
        expect(fixture.touches).not.toHaveBeenCalled();
    });

    it.each(['Origin', 'Fetch Metadata'] as const)('admits a sessionless command with affirmative %s evidence', async source => {
        const fixture = await createSessionFixture(false, false, false);
        const headers = fixture.headers(false);
        if (source === 'Fetch Metadata') {
            delete headers.Origin;
            headers['Sec-Fetch-Site'] = 'same-origin';
        }
        const response = await fetch(`${fixture.origin}/context`, {method: 'POST', headers});
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({context: null, authenticated: false, profileId: null});
        expect(response.headers.get('set-cookie')).toBeNull();
        expect(fixture.writes).not.toHaveBeenCalled();
        expect(fixture.touches).not.toHaveBeenCalled();
    });

    it.each([
        {name: 'missing origin evidence', origin: '', site: ''},
        {name: 'opaque origin', origin: 'null', site: ''},
        {name: 'foreign origin', origin: 'https://foreign.example.invalid', site: ''},
        {name: 'cross-site Fetch Metadata', origin: '', site: 'cross-site'},
        {name: 'same-site sibling', origin: '', site: 'same-site'},
        {name: 'user navigation alone', origin: '', site: 'none'},
    ])('rejects sessionless commands with $name without creating state', async ({origin, site}) => {
        const fixture = await createSessionFixture(false, false, false);
        const headers = fixture.headers(false);
        delete headers.Origin;
        if (origin) headers.Origin = origin;
        if (site) headers['Sec-Fetch-Site'] = site;
        const response = await fetch(`${fixture.origin}/context`, {method: 'POST', headers});
        expect(response.status).toBe(403);
        expect((await response.json()).code).toBe('CSRF_INVALID');
        expect(response.headers.get('set-cookie')).toBeNull();
        expect(fixture.writes).not.toHaveBeenCalled();
    });

    it('requires the non-simple compatibility header before sessionless mutation admission', async () => {
        const fixture = await createSessionFixture(false, false, false);
        const response = await fetch(`${fixture.origin}/context`, {method: 'POST', headers: {Origin: fixture.origin}});
        expect(response.status).toBe(403);
        expect((await response.json()).code).toBe('CSRF_INVALID');
        expect(fixture.writes).not.toHaveBeenCalled();
    });

    it('rejects a simple text body before sessionless mutation admission', async () => {
        const fixture = await createSessionFixture(false, false, false);
        const response = await fetch(`${fixture.origin}/context`, {method: 'POST', headers: fixture.headers(false), body: 'untrusted'});
        expect(response.status).toBe(415);
        expect((await response.json()).code).toBe('UNSUPPORTED_MEDIA_TYPE');
        expect(fixture.writes).not.toHaveBeenCalled();
    });

    it.each(['context', 'csrf'] as const)('does not downgrade a stored session when its %s evidence is omitted', async field => {
        const fixture = await createSessionFixture();
        const headers = fixture.headers();
        delete headers[field === 'context' ? 'X-Surveyor-Context' : 'X-CSRF-Token'];
        const response = await fetch(`${fixture.origin}/context`, {method: 'POST', headers});
        expect(response.status).toBe(field === 'context' ? 400 : 403);
        expect((await response.json()).code).toBe(field === 'context' ? 'CONTEXT_REQUIRED' : 'CSRF_INVALID');
        expect(fixture.writes).not.toHaveBeenCalled();
    });

    it.each([
        {name: 'old middleware context', context: contextA, csrf: csrfB},
        {name: 'old middleware CSRF', context: contextB, csrf: csrfA},
        {name: 'matching later evidence', context: contextB, csrf: csrfB},
    ])('rejects $name when stored generation changed before admission', async ({context, csrf}) => {
        const fixture = await createSessionFixture(true);
        const response = fetch(`${fixture.origin}/context`, {method: 'POST', headers: {
            Cookie: fixture.cookie, 'X-Surveyor-Context': context, 'X-CSRF-Token': csrf,
        }});
        await fixture.loaded;
        await replaceStoredContext(fixture.store, fixture.sessionId, contextB, csrfB);
        fixture.writes.mockClear();
        fixture.admit();
        const completed = await response;
        expect(completed.status).toBe(409);
        expect(completed.headers.get('X-Surveyor-Context')).toBeNull();
        const body = await completed.json();
        expect(body.code).toBe('SESSION_CONTEXT_CHANGED');
        expect(await readStoredSession(fixture.store, fixture.sessionId)).toMatchObject({
            frontendContext: contextB, frontendCsrfToken: csrfB,
        });
        expect(fixture.writes).not.toHaveBeenCalled();
    });

    it('does not turn browser identity and capability claims into a stored principal', async () => {
        const fixture = await createSessionFixture();
        const response = await fetch(`${fixture.origin}/private`, {method: 'POST', headers: {
            Cookie: fixture.cookie, 'Content-Type': 'application/json',
            'X-Surveyor-Context': contextA, 'X-CSRF-Token': csrfA,
        }, body: JSON.stringify({auth: {user: {id: 18427}}, profile: {id: 'bb464617-0107-4df9-a072-ee77ee45194c'},
            actor: {context: contextA}, capabilities: {managePermissions: true, remove: true}})});
        expect(response.status).toBe(401);
        expect((await response.json()).code).toBe('AUTH_REQUIRED');
        const stored = await readStoredSession(fixture.store, fixture.sessionId);
        expect(stored?.auth).toBeUndefined();
        expect(stored?.profile).toBeUndefined();
        expect(stored?.frontendContext).toBe(contextA);
        expect(fixture.writes).not.toHaveBeenCalled();
    });

    it('rejects an actually removed stored session without recreating its old context', async () => {
        const fixture = await createSessionFixture(true);
        const response = fetch(`${fixture.origin}/capture`, {headers: {Cookie: fixture.cookie}});
        await fixture.loaded;
        await new Promise<void>(function removeStoredSession(resolve, reject) {
            fixture.store.destroy(fixture.sessionId, function finishRemoval(error): void {
                if (error) reject(error);
                else resolve();
            });
        });
        fixture.admit();
        const completed = await response;
        expect(completed.status).toBe(401);
        expect((await completed.json()).code).toBe('AUTH_REQUIRED');
        expect(await readStoredSession(fixture.store, fixture.sessionId)).toBeUndefined();
        expect(fixture.writes).not.toHaveBeenCalled();
    });

    it('keeps store failure distinct from expiry without saving or disclosing its snapshot', async () => {
        const fixture = await createSessionFixture(true);
        const response = fetch(`${fixture.origin}/capture`, {headers: {Cookie: fixture.cookie}});
        await fixture.loaded;
        const failure = new Error('private store diagnostic');
        const diagnostic = vi.spyOn(console, 'error').mockImplementation(function suppressExpectedDiagnostic(): void {});

        // Replace only the unavailable external read. Express's initial load and
        // all save/touch/response behavior remain the actual production boundary.
        vi.spyOn(fixture.store, 'get').mockImplementationOnce(function failAdmissionRead(_id, callback): void {
            callback(failure);
        });
        fixture.admit();
        const completed = await response;
        expect(completed.status).toBe(500);
        const body = await completed.json();
        expect(body.code).toBe('INTERNAL_ERROR');
        expect(JSON.stringify(body)).not.toContain(failure.message);
        expect(diagnostic).toHaveBeenCalledOnce();
        expect(await readStoredSession(fixture.store, fixture.sessionId)).toMatchObject({
            frontendContext: contextA, frontendCsrfToken: csrfA,
        });
        expect(fixture.writes).not.toHaveBeenCalled();
    });
});
