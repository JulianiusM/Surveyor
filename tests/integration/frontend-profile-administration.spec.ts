import {randomUUID} from 'node:crypto';
import {readdir} from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest';
import * as userService from '../../src/modules/database/services/UserService';
import {AppDataSource} from '../../src/modules/database/dataSource';
import {Profile} from '../../src/modules/database/entities/user/Profile';
import {Session} from '../../src/modules/database/entities/session/Session';
import {createTranslator} from '../../src/modules/localization/translator';
import settings from '../../src/modules/settings';
import {decodeBootstrap} from '../../src/frontend/app/serializeBootstrap';
import type {components} from '../../src/types/api/v1';
import {registerLocalAccount} from '../keywords/coreDomainKeywords';
import {closeIntegrationDatabase, initializeIntegrationDatabase} from '../support/database';

let listener: http.Server | undefined;
let application: typeof import('../../src/app')['default'] | undefined;
let origin: string | undefined;

/** The real server needs admitted persistence before installing its listener. */
async function prepareApplicationListener(): Promise<void> {
    await initializeIntegrationDatabase();
    // Prepare the real application's cold imports/listener as suite infrastructure,
    // leaving each workflow's ordinary assertion timeout unchanged.
    await applicationOrigin();
}

/** Import only the actual built module graph; never render or prime private state. */
async function prepareOverviewSsrModule(): Promise<void> {
    // This case measures route/bootstrap behavior, not lazy module compilation.
    // Prepare the actual built graph used by the renderer, without pre-rendering
    // a document, creating a request or priming any actor/query state.
    const directory = path.resolve(__dirname, '../../dist/frontend-server');
    const modules = (await readdir(directory)).filter(file => /^OverviewPage-[\w-]+\.mjs$/u.test(file));
    if (modules.length !== 1) throw new Error('Build exactly one Overview SSR module before this integration suite.');
    // Follow production's entry-before-route import order through shared chunks.
    await import(pathToFileURL(path.join(directory, 'entry-server.mjs')).href);
    await import(pathToFileURL(path.join(directory, modules[0]!)).href);
}

/** Prepare independent server and pure module infrastructure within one hook.
 * Each test still owns fresh HTTP requests and rendering under its normal deadline. */
beforeAll(async function prepareApplicationInfrastructure(): Promise<void> {
    // Module evaluation creates no app/context and needs no backend listener or
    // database. Keep the persistence-before-listen dependency in its own branch.
    const preparation = await Promise.allSettled([prepareApplicationListener(), prepareOverviewSsrModule()]);
    // A failed module lookup must not let teardown race the admitted listener
    // branch. Finish both preparations before preserving their actual rejection.
    for (const result of preparation) if (result.status === 'rejected') throw result.reason;
});

afterAll(async () => {
    // Close the suite-owned listener before its real session store/database.
    // Existing application routes and rendering run unchanged behind this listener.
    if (listener) {
        await new Promise<void>(function closeListener(resolve, reject) {
            listener!.close(function listenerClosed(error) { if (error) reject(error); else resolve(); });
        });
    }
    vi.restoreAllMocks();
    await closeIntegrationDatabase();
});

/** Start the actual Express application only after this suite's guarded schema
 * exists. Its real router, session middleware and built SSR renderer supply every
 * HTTP response; no application page or validator is replaced by a fixture. */
async function applicationOrigin(): Promise<string> {
    if (origin) return origin;
    // Importing the real app installs its ordinary store and routes. The owned
    // listener supplies only a local transport after database admission succeeded.
    // The runner's actual-module loader preserves the source module's default
    // export across its CJS/ESM interop without substituting any application owner.
    application = (await vi.importActual<typeof import('../../src/app')>('../../src/app')).default;
    listener = http.createServer(application);
    await new Promise<void>(function listenLocally(resolve) { listener!.listen(0, '127.0.0.1', resolve); });
    const address = listener.address();
    if (!address || typeof address === 'string') throw new Error('The profile integration listener has no local port.');
    origin = `http://127.0.0.1:${address.port}`;
    // Production admission compares its configured public origin. This fixture's
    // owned ephemeral listener is that public origin, including its chosen port.
    vi.spyOn(settings, 'value', 'get').mockReturnValue({...settings.value, rootUrl: origin});
    return origin;
}

/** Decode the actual emitted bootstrap through its exhaustive browser boundary. */
async function documentBootstrap(html: string) {
    const serialized = /<script id="surveyor-pilot-state" type="application\/json">([^<]+)<\/script>/u.exec(html)?.[1];
    if (!serialized) throw new Error('The admitted HTTP document did not emit a pilot bootstrap.');
    return decodeBootstrap(JSON.parse(serialized));
}

/** Keep only server-issued cookies; the production application owns login,
 * session signatures, admission and persistence for every tested API request. */
function createHttpActor() {
    let cookie = '';
    /** Deliver native forms and generated API commands through one real browser
     * cookie jar; every actor keeps its own production-issued session identity. */
    async function dispatch(target: string, method = 'GET', body?: unknown, headers?: Record<string, string>) {
        const base = await applicationOrigin();
        // Native login retains form encoding; versioned commands retain explicit
        // JSON/context headers and the application's same-origin admission.
        const requestHeaders = new Headers({Connection: 'close', ...headers});
        if (cookie) requestHeaders.set('Cookie', cookie);
        if (method !== 'GET') {
            requestHeaders.set('Origin', base);
            requestHeaders.set('Content-Type', body instanceof URLSearchParams ? 'application/x-www-form-urlencoded' : 'application/json');
        }
        const response = await fetch(new URL(target, base), {method, headers: requestHeaders, redirect: 'manual',
            body: body === undefined ? undefined : body instanceof URLSearchParams ? body : JSON.stringify(body)});
        // Store only emitted cookie pairs. The application owns signing, expiry,
        // context rotation and persistence rather than a manufactured fixture.
        const received = response.headers.getSetCookie();
        if (received.length) cookie = received.map(value => value.split(';')[0]).join('; ');
        return response;
    }
    return {dispatch};
}

type Actor = {agent: ReturnType<typeof createHttpActor>; session: components['schemas']['SessionView']};
type SessionProof = Pick<components['schemas']['SessionView'], 'context' | 'csrfToken' | 'deployment'>;

/** Match the client transport's paired metadata omission without inventing anonymous headers. */
function sessionHeaders(proof: SessionProof): Record<string, string> {
    // Established account/guest sessions send their exact server-issued pair.
    // An anonymous null pair is absent; server admission still decides its rights.
    return {'X-Surveyor-Api-Compatibility': proof.deployment.apiCompatibility,
        ...(proof.context && proof.csrfToken ? {'X-Surveyor-Context': proof.context, 'X-CSRF-Token': proof.csrfToken} : {})};
}

/** Reuse native account login; optional credentials create another independent
 * browser session of the same account for concurrent profile-default writes. */
async function accountActor(account?: Awaited<ReturnType<typeof registerLocalAccount>>) {
    const user = account ?? await registerLocalAccount('p1-profile');
    await userService.activateUser(user.id);
    const agent = createHttpActor();
    expect((await agent.dispatch('/users/login', 'POST', new URLSearchParams({username: user.username,
        password: 'initial-secret'}))).status).toBe(302);
    const session = await (await agent.dispatch('/api/v1/session')).json() as components['schemas']['SessionView'];
    return {agent, session, user};
}

async function guestActor(): Promise<Actor> {
    const guest = await userService.createGuest(`P1 guest ${randomUUID().slice(0, 8)}`);
    const agent = createHttpActor();
    expect((await agent.dispatch(`/guest/${guest.id}/login/${guest.token}`)).status).toBe(302);
    const session = await (await agent.dispatch('/api/v1/session')).json() as components['schemas']['SessionView'];
    return {agent, session};
}

/** Submit exactly the generated adapter's current captured actor/CSRF evidence. */
function profileCommand(actor: Actor, method: 'POST' | 'PATCH', body: unknown,
                        proof: SessionProof = actor.session) {
    return actor.agent.dispatch('/api/v1/profiles' + (method === 'PATCH' ? '/current' : ''), method, body, sessionHeaders(proof));
}

async function readSettings(actor: Actor) {
    const response = await actor.agent.dispatch('/api/v1/profiles/current', 'GET', undefined,
        sessionHeaders(actor.session));
    expect(response.status).toBe(200);
    return response.json() as Promise<components['schemas']['ProfileSettings']>;
}

describe('versioned profile administration reuses native persistence', () => {
    it('returns a private acknowledgement and reads native saved name/default/session fields separately', async function savesNativeFields() {
        const actor = await accountActor();
        const name = '  Renamed account profile  ';
        const response = await profileCommand(actor, 'PATCH', {name, isDefault: false});
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({changed: true});
        expect(response.headers.get('X-Surveyor-Context')).toBe(actor.session.context);
        expect(response.headers.get('Cache-Control')).toBe('private, no-store');
        expect(await readSettings(actor)).toMatchObject({id: actor.session.activeProfile!.id, name, isDefault: false});
        const session = await (await actor.agent.dispatch('/api/v1/session')).json();
        expect(session.activeProfile).toEqual({id: actor.session.activeProfile!.id, name});
        const native = await actor.agent.dispatch('/users/profile');
        expect(await native.text()).toContain(`value="${name}"`);
    });

    it('keeps the existing sibling-default transaction and native profile creation without switching identity', async function createsNativeProfile() {
        const actor = await accountActor();
        const name = `Additional ${randomUUID().slice(0, 8)}`;
        const response = await profileCommand(actor, 'POST', {name});
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({changed: true});
        const created = await AppDataSource.getRepository(Profile).findOneByOrFail({name});
        expect(created).toMatchObject({userId: actor.user.id, defaultForOwner: false});
        const session = await (await actor.agent.dispatch('/api/v1/session')).json();
        expect(session.activeProfile.id).toBe(actor.session.activeProfile!.id);
        expect(session.profiles).toContainEqual({id: created.id, name});
        await userService.updateProfileDefault(created.id, true);
        expect((await profileCommand(actor, 'PATCH', {name: actor.session.activeProfile!.name, isDefault: true})).status).toBe(200);
        expect(await userService.getProfileById(created.id)).toMatchObject({name, defaultForOwner: false});
    });

    it('allows account and guest editing while denying guest roster and creation', async function preservesGuestAdmission() {
        const actor = await guestActor();
        const name = `Edited guest ${randomUUID().slice(0, 8)}`;
        expect((await profileCommand(actor, 'PATCH', {name, isDefault: true})).status).toBe(200);
        expect(await readSettings(actor)).toMatchObject({name, isDefault: true});
        const roster = await actor.agent.dispatch('/api/v1/profiles', 'GET', undefined,
            sessionHeaders(actor.session));
        expect(roster.status).toBe(403);
        expect((await profileCommand(actor, 'POST', {name: 'Unsupported guest profile'})).status).toBe(403);
        expect(await AppDataSource.getRepository(Profile).countBy({name: 'Unsupported guest profile'})).toBe(0);
        expect((await (await actor.agent.dispatch('/api/v1/session')).json()).kind).toBe('guest');
    });

    it('projects only the current account roster and rejects a formerly owned profile before writing', async function preservesPrivateOwnership() {
        const actor = await accountActor();
        const recipient = await accountActor();
        const roster = await actor.agent.dispatch('/api/v1/profiles', 'GET', undefined,
            sessionHeaders(actor.session));
        const projection = await roster.json() as components['schemas']['ProfileManagement'];
        expect(projection.profiles.map(profile => profile.id)).toEqual([actor.session.activeProfile!.id]);
        expect(Object.keys(projection.profiles[0]).sort()).toEqual(['id', 'isDefault', 'name']);
        await userService.moveProfileToUserTx(actor.session.activeProfile!.id, recipient.user.id);
        expect((await profileCommand(actor, 'PATCH', {name: 'Unauthorized rename', isDefault: true})).status).toBe(401);
        expect(await userService.getProfileById(actor.session.activeProfile!.id)).toMatchObject({
            name: actor.session.activeProfile!.name, userId: recipient.user.id});
    });

    it('rejects retired context, invalid CSRF and malformed fields before the existing native operation', async function rejectsInvalidAdmission() {
        const actor = await accountActor();
        const changedProof = {...actor.session, context: 'retired-profile-context-1234567890'};
        expect((await profileCommand(actor, 'POST', {name: 'Retired actor creation'}, changedProof)).status).toBe(409);
        const invalidCsrf = {...actor.session, csrfToken: 'invalid-profile-csrf-1234567890'};
        expect((await profileCommand(actor, 'POST', {name: 'Invalid CSRF creation'}, invalidCsrf)).status).toBe(403);
        expect((await profileCommand(actor, 'POST', {name: 'Extra field creation', userId: actor.user.id})).status).toBe(400);
        expect((await profileCommand(actor, 'PATCH', {name: 'Invalid checkbox', isDefault: 'false'})).status).toBe(400);
        expect((await userService.getProfilesForUser(actor.user.id)).map(profile => profile.name)).toEqual([actor.session.activeProfile!.name]);
    });

    it('uses the native default transaction for simultaneous independent sessions selecting different defaults', async function sharesNativeDefaultTransaction() {
        const first = await accountActor();
        const sibling = await userService.createProfile(first.user.id, 'Independent sibling');
        const second = await accountActor(first.user);
        expect((await second.agent.dispatch(`/users/profile/change/${sibling.id}`)).status).toBe(302);
        second.session = await (await second.agent.dispatch('/api/v1/session')).json();
        const responses = await Promise.all([
            profileCommand(first, 'PATCH', {name: 'First concurrent profile', isDefault: true}),
            profileCommand(second, 'PATCH', {name: 'Second concurrent profile', isDefault: true}),
        ]);
        expect(responses.map(response => response.status)).toEqual([200, 200]);
        expect(await Promise.all(responses.map(response => response.json()))).toEqual([{changed: true}, {changed: true}]);
        const profiles = await userService.getProfilesForUser(first.user.id);
        expect(profiles.filter(profile => profile.defaultForOwner)).toHaveLength(1);
        expect(profiles.map(profile => profile.name).sort()).toEqual(['First concurrent profile', 'Second concurrent profile']);
    });
});

describe('admitted common documents through the actual Express application', () => {
    it('carries an account-required notice through a native anonymous session and consumes it once', async function preservesAnonymousFlash() {
        const visitor = createHttpActor();
        const repository = AppDataSource.getRepository(Session);
        const before = await repository.count();

        // An ordinary public read needs no stored row. The subsequent protected
        // entry deliberately uses native flash, which owns this anonymous state.
        const initial = await visitor.dispatch('/api/v1/session');
        expect(initial.status).toBe(200);
        expect(initial.headers.get('set-cookie')).toBeNull();
        expect(await initial.json()).toMatchObject({kind: 'anonymous', context: null, csrfToken: null});
        expect(await repository.count()).toBe(before);

        const redirect = await visitor.dispatch('/frontend-pilot/packing/create?locale=en');
        expect(redirect.status).toBe(302);
        expect(redirect.headers.get('set-cookie')).toContain('connect.sid=');
        expect(redirect.headers.get('location')).toBe('/frontend-pilot/users/login?next=%2Ffrontend-pilot%2Fpacking%2Fcreate%3Flocale%3Den&locale=en');
        expect(await repository.count()).toBe(before + 1);

        // Return the server's actual cookie and redirect, then observe the real
        // library's one-time consumption rather than a substituted notice DTO.
        const destination = redirect.headers.get('location');
        if (!destination) throw new Error('The protected entry has no login destination.');
        const first = await visitor.dispatch(destination);
        expect(first.status).toBe(200);
        const state = await documentBootstrap(await first.text());
        expect(state.session).toMatchObject({kind: 'anonymous', context: null, csrfToken: null});
        expect(state.pageNotice).toEqual({kind: 'info', messageKey: 'auth.accountRequired'});
        const second = await visitor.dispatch(destination);
        expect(second.status).toBe(200);
        expect((await documentBootstrap(await second.text())).pageNotice).toBeUndefined();
        expect(await repository.count()).toBe(before + 1);
    });

    it('keeps the opt-in landing separate from the existing Overview root', async function preservesOverviewRoot() {
        const base = await applicationOrigin();
        const landing = await fetch(`${base}/frontend-pilot/home`);
        const overview = await fetch(`${base}/frontend-pilot`);
        expect(landing.status).toBe(200);
        expect(overview.status).toBe(200);

        // Route and bootstrap selection must agree before hydration. The random
        // landing choice is real authored state; Overview remains an interactive shell.
        const landingHtml = await landing.text();
        const overviewHtml = await overview.text();
        const landingState = await documentBootstrap(landingHtml);
        const overviewState = await documentBootstrap(overviewHtml);
        expect(typeof landingState.landing?.quickCreate).toBe('string');
        expect(overviewState.landing).toBeUndefined();
        expect(overviewState.commonPage).toBeUndefined();
        expect(overviewHtml).toContain('data-pilot-initial-loading');
        expect(landingHtml).toContain('property="og:title"');
    });

    it('renders an admitted HTML404 without interactive content or query-selected diagnostics', async function rendersSafeMissingDocument() {
        const base = await applicationOrigin();
        const previousEnvironment = application!.get('env');
        application!.set('env', 'production');
        try {
            const response = await fetch(`${base}/frontend-pilot/p1-missing-route?message=Forged%20body&stack=Private%20trace`);
            const html = await response.text();
            const state = await documentBootstrap(html);

            // Real server status, readable SSR content and decoded admission must
            // describe the same outcome. URL data cannot choose its text or stack.
            expect(response.status).toBe(404);
            expect(response.headers.get('content-type')).toContain('text/html');
            expect(response.headers.get('cache-control')).toBe('private, no-store');
            expect(state.commonPage).toMatchObject({kind: 'error', status: 404});
            expect(state.commonPage?.message).not.toContain('Forged body');
            expect(state.commonPage && 'stack' in state.commonPage ? state.commonPage.stack : undefined).toBeUndefined();
            expect(html).toContain('(Status 404)');
            expect(html).not.toContain('data-pilot-initial-loading');
            expect(html).not.toContain('id="name"');
        } finally { application!.set('env', previousEnvironment); }
    });

    it('retains the Help owner contextual message and404 in the selected language', async function preservesContextualHelpError() {
        const base = await applicationOrigin();
        const response = await fetch(`${base}/frontend-pilot/help/p1-missing-article?locale=de`);
        const state = await documentBootstrap(await response.text());

        // Expected document errors keep their existing contextual wording rather
        // than being replaced by the API's generic resource-not-found explanation.
        expect(response.status).toBe(404);
        expect(response.headers.get('content-language')).toBe('de');
        expect(state.commonPage).toMatchObject({kind: 'message', severity: 'error', status: 404,
            message: createTranslator('de').t('help.notFound')});
    });

    it('preserves the native400 for an Express route-parameter decode failure', async function preservesMalformedParameterStatus() {
        const base = await applicationOrigin();
        const response = await fetch(`${base}/frontend-pilot/help/%E0%A4%A`);
        const state = await documentBootstrap(await response.text());

        // Express owns malformed percent encoding. Its transport rejection must
        // not become an internal server error merely because the body uses Vue.
        expect(response.status).toBe(400);
        expect(state.commonPage).toMatchObject({kind: 'error', status: 400});
    });

    it('retains API, health and missing-asset HTTP boundaries outside common documents', async function preservesNonDocumentBoundaries() {
        const base = await applicationOrigin();
        const api = await fetch(`${base}/api/v1/p1-missing-operation`);
        expect(api.status).toBe(404);
        expect(api.headers.get('content-type')).toContain('application/problem+json');
        expect(await api.json()).toMatchObject({code: 'NOT_FOUND', status: 404});

        // Health remains plain Express output, and a missing built chunk cannot
        // become a successful or hydrated pilot document through an HTML fallback.
        const health = await fetch(`${base}/healthz`);
        expect(health.status).toBe(200);
        expect(await health.text()).toBe('ok');
        const asset = await fetch(`${base}/app/p1-missing-chunk.js`);
        expect(asset.status).toBe(404);
        expect(await asset.text()).not.toContain('id="surveyor-pilot"');
    });
});
