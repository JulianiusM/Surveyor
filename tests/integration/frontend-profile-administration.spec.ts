import {randomUUID} from 'node:crypto';
import http from 'node:http';
import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest';
import * as userService from '../../src/modules/database/services/UserService';
import {AppDataSource} from '../../src/modules/database/dataSource';
import {Profile} from '../../src/modules/database/entities/user/Profile';
import {Session} from '../../src/modules/database/entities/session/Session';
import {createTranslator} from '../../src/modules/localization/translator';
import settings from '../../src/modules/settings';
import {initializeFrontendRenderer} from '../../src/modules/frontendRenderer';
import {decodeBootstrap} from '../../src/frontend/app/serializeBootstrap';
import type {components} from '../../src/types/api/v1';
import {createActivityPlanWithSlot, createDriversListWithItem, createIntegrationEvent, createPackingListWithItem,
    createSurveyWithCombinations, registerLocalAccount} from '../keywords/coreDomainKeywords';
import {closeIntegrationDatabase, initializeIntegrationDatabase} from '../support/database';
import {prepareFrontendSsrModules} from '../support/frontendRenderer';

let listener: http.Server | undefined;
let application: typeof import('../../src/app')['default'] | undefined;
let origin: string | undefined;

/** The real server needs admitted persistence before installing its listener. */
async function prepareApplicationListener(rendererReady: Promise<void>): Promise<void> {
    await initializeIntegrationDatabase();
    // Prepare the real application's cold imports/listener as suite infrastructure,
    // leaving each workflow's ordinary assertion timeout unchanged.
    await applicationOrigin(rendererReady);
}

/** Prepare independent server and pure module infrastructure within one hook.
 * Each test still owns fresh HTTP requests and rendering under its normal deadline. */
beforeAll(async function prepareApplicationInfrastructure(): Promise<void> {
    // Module evaluation creates no app/context and needs no backend listener or
    // database. Keep the persistence-before-listen dependency in its own branch.
    const rendererReady = prepareFrontendSsrModules(['OverviewPage', 'PackingEntry', 'DriversEntry']);
    const preparation = await Promise.allSettled([prepareApplicationListener(rendererReady), rendererReady]);
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
async function applicationOrigin(rendererReady?: Promise<void>): Promise<string> {
    if (origin) return origin;
    // Importing the real app installs its ordinary store and routes. The owned
    // listener supplies only a local transport after database admission succeeded.
    // The runner's actual-module loader preserves the source module's default
    // export across its CJS/ESM interop without substituting any application owner.
    application = (await vi.importActual<typeof import('../../src/app')>('../../src/app')).default;
    // Normal startup prepares renderer code before listen. The suite additionally
    // prepares only its actual named lazy graphs; no request/private state is made.
    await (rendererReady ?? initializeFrontendRenderer());
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
    const serialized = /<script id="surveyor-frontend-state" type="application\/json">([^<]+)<\/script>/u.exec(html)?.[1];
    if (!serialized) throw new Error('The admitted HTTP document did not emit a frontend bootstrap.');
    return decodeBootstrap(JSON.parse(serialized));
}

/** Keep only server-issued cookies; the production application owns login,
 * session signatures, admission and persistence for every tested API request. */
function createHttpActor() {
    let cookie = '';
    /** Deliver documents and generated API commands through one real browser
     * cookie jar; every actor keeps its own production-issued session identity. */
    async function dispatch(target: string, method = 'GET', body?: unknown, headers?: Record<string, string>) {
        const base = await applicationOrigin();
        // Versioned commands retain explicit JSON/context headers and the
        // application's same-origin admission.
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

/** Reuse generated account login; optional credentials create another independent
 * browser session of the same account for concurrent profile-default writes. */
async function accountActor(account?: Awaited<ReturnType<typeof registerLocalAccount>>) {
    const user = account ?? await registerLocalAccount('p1-profile');
    await userService.activateUser(user.id);
    const agent = createHttpActor();
    const anonymous = await (await agent.dispatch('/api/v1/session')).json() as components['schemas']['SessionView'];
    expect((await agent.dispatch('/api/v1/auth/login', 'POST', {username: user.username,
        password: 'initial-secret'}, sessionHeaders(anonymous))).status).toBe(200);
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
        const document = await actor.agent.dispatch('/users/profile');
        expect(document.status).toBe(200);
        // Profile fields load through their admitted API after hydration; the
        // initial document carries the same renamed active identity and shell.
        const html = await document.text();
        expect((await documentBootstrap(html)).session.activeProfile).toEqual({id: actor.session.activeProfile!.id, name});
        expect(html).toContain('data-frontend-initial-loading');
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
        expect((await second.agent.dispatch('/api/v1/auth/profile', 'PUT', {profileId: sibling.id},
            sessionHeaders(second.session))).status).toBe(200);
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

        const redirect = await visitor.dispatch('/packing/create?locale=en');
        expect(redirect.status).toBe(302);
        expect(redirect.headers.get('set-cookie')).toContain('connect.sid=');
        expect(redirect.headers.get('location')).toBe('/users/login?next=%2Fpacking%2Fcreate%3Flocale%3Den&locale=en');
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

    it('keeps public Home at the root and personal Overview at the dashboard path', async function preservesHomeAndOverview() {
        const base = await applicationOrigin();
        const landing = await fetch(`${base}/`);
        const actor = await accountActor();
        const overview = await actor.agent.dispatch('/users/dashboard');
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
        expect(overviewState.pageEntry).toEqual({kind: 'render'});
        expect(overviewState.commonPage).toBeUndefined();
        expect(overviewHtml).toContain('data-frontend-initial-loading');
        expect(landingHtml).toContain('property="og:title"');
    });

    it.each(['/users/dashboard', '/USERS/DASHBOARD/'])(
        'keeps anonymous Dashboard entry %s on the native Login journey', async path => {
            const visitor = createHttpActor();
            const target = path + '?owner_main_q=equipment&locale=de';
            const response = await visitor.dispatch(target);
            expect(response.status).toBe(302);
            const destination = response.headers.get('location')!;
            const url = new URL(destination, await applicationOrigin());
            expect(url.pathname).toBe('/users/login');
            expect(url.searchParams.get('next')).toBe(target);
            expect(url.searchParams.get('locale')).toBe('de');

            // The real cookie-backed flash reaches the first Login document once;
            // it never manufactures an authenticated profile or an Overview shell.
            const login = await visitor.dispatch(destination);
            expect(login.status).toBe(200);
            const html = await login.text();
            const state = await documentBootstrap(html);
            expect(state.session).toMatchObject({kind: 'anonymous', activeProfile: null});
            expect(state.pageNotice).toEqual({kind: 'info', messageKey: 'auth.loginRequired'});
            expect(html).not.toContain('data-loading-skeleton="overview"');
            expect((await documentBootstrap(await (await visitor.dispatch(destination)).text())).pageNotice).toBeUndefined();
        });

    it.each([
        ['/USERS/PROFILE/MANAGE/', null], ['/USERS/PROFILE/CREATE/', null], ['/USERS/PROFILE/DELETE/', null],
        ['/USERS/PROFILE/', 'edit'], ['/USERS/ACCOUNT/DELETE/', 'delete-account'],
    ] as const)('uses registered profile intent for admitted mixed-case route %s', async (path, admitted) => {
        const actor = await guestActor();
        const target = path + '?locale=de';
        const response = await actor.agent.dispatch(target);
        if (!admitted) {
            // Guests cannot gain account-only profile creation/management or
            // deactivation by changing an otherwise valid URL's spelling.
            expect(response.status).toBe(302);
            const destination = new URL(response.headers.get('location')!, await applicationOrigin());
            expect(destination.pathname).toBe('/users/login');
            expect(destination.searchParams.get('next')).toBe(target);
        } else {
            expect(response.status).toBe(200);
            const state = await documentBootstrap(await response.text());
            expect(state.pageEntry).toEqual({kind: 'render'});
            expect(state.session.activeProfile?.id).toBe(actor.session.activeProfile!.id);
            expect(state.profileWorkflow?.kind).toBe(admitted === 'edit' ? undefined : admitted);
        }
    });

    it.each(['/USERS/LOGIN/', '/USERS/REGISTER/'])(
        'preserves configured provider entry for admitted mixed-case route %s', async path => {
            const previous = settings.value;
            const configured = vi.spyOn(settings, 'value', 'get').mockReturnValue({...previous,
                localLoginEnabled: false, oidcEnabled: false});
            try {
                const target = path + '?next=%2Fhelp&locale=de';
                const response = await createHttpActor().dispatch(target);
                expect(response.status).toBe(302);
                const destination = new URL(response.headers.get('location')!, await applicationOrigin());
                expect(destination.pathname).toBe('/users/oidc/login');
                expect(destination.searchParams.get('next')).toBe('/help');
                expect(destination.searchParams.get('locale')).toBe('de');
            } finally { configured.mockReturnValue(previous); }
        });

    // Each family owns its real creation and two HTTP documents within the
    // ordinary case deadline; sibling fixtures do not consume its assertion time.
    it.each(['packing', 'drivers', 'survey', 'activity', 'event'] as const)(
        'retains %s guest resource admission for every admitted case and trailing-slash equivalent', async family => {
            const owner = await accountActor();
            const ownerId = owner.session.activeProfile!.id;
            let id: string;
            if (family === 'packing') [id] = await createPackingListWithItem(ownerId);
            else if (family === 'drivers') [id] = await createDriversListWithItem(ownerId);
            else if (family === 'survey') [id] = await createSurveyWithCombinations(ownerId);
            else if (family === 'activity') id = await createActivityPlanWithSlot(ownerId);
            else id = await createIntegrationEvent(ownerId, 'Case-admitted Event');
            const visitor = createHttpActor();
            const canonical = await visitor.dispatch(`/${family}/${id}/guest?locale=de`);
            expect(canonical.status, family).toBe(200);
            const expected = await documentBootstrap(await canonical.text());
            const response = await visitor.dispatch(`/${family.toUpperCase()}/${id}/GUEST/?locale=de`);
            expect(response.status, family).toBe(200);
            const state = await documentBootstrap(await response.text());
            expect(state.pageEntry, family).toEqual({kind: 'render'});
            expect(state.session.activeProfile, family).toBeNull();
            const guest = family === 'event' ? state.eventEntry?.guest : state.guestEntry;
            expect(guest, family).toEqual(family === 'event' ? expected.eventEntry?.guest : expected.guestEntry);
            expect(guest?.id, family).toBe(id);
        });

    it('retains denied Event administration admission for an equivalent mixed-case route', async () => {
        const owner = await accountActor();
        const eventId = await createIntegrationEvent(owner.session.activeProfile!.id, 'Case-admitted Event');
        // Admin admission must not fall back to participant detail for a valid
        // alternative spelling. The real controller denies this unrelated guest.
        const unrelated = await guestActor();
        expect((await unrelated.agent.dispatch(`/event/${eventId}/admin`)).status).toBe(403);
        const denied = await unrelated.agent.dispatch(`/EVENT/${eventId}/ADMIN/`);
        expect(denied.status).toBe(403);
        // Event admission retains its owner's shared Forbidden wording; an
        // accepted alternative route spelling must preserve that catalog key.
        expect((await documentBootstrap(await denied.text())).eventEntry?.entry).toEqual({
            kind: 'denied', status: 403, messageKey: 'api:errors.FORBIDDEN'});
    });

    it('keeps the localized Packing not-found outcome for an admitted uppercase namespace', async () => {
        const visitor = createHttpActor();
        const id = randomUUID();
        const response = await visitor.dispatch(`/PACKING/${id}/?locale=de`);
        expect(response.status).toBe(404);
        const state = await documentBootstrap(await response.text());
        expect(state.packingError).toBe('packing.notFound');
        expect(state.commonPage).toBeUndefined();
    });

    it('renders an admitted HTML404 without interactive content or query-selected diagnostics', async function rendersSafeMissingDocument() {
        const base = await applicationOrigin();
        const previousEnvironment = application!.get('env');
        application!.set('env', 'production');
        try {
            const response = await fetch(`${base}/p1-missing-route?message=Forged%20body&stack=Private%20trace`);
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
            expect(html).not.toContain('data-frontend-initial-loading');
            expect(html).not.toContain('id="name"');
        } finally { application!.set('env', previousEnvironment); }
    });

    it('retains the Help owner contextual message and404 in the selected language', async function preservesContextualHelpError() {
        const base = await applicationOrigin();
        const response = await fetch(`${base}/help/p1-missing-article?locale=de`);
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
        const response = await fetch(`${base}/help/%E0%A4%A`);
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
        // become a successful or hydrated frontend document through an HTML fallback.
        const health = await fetch(`${base}/healthz`);
        expect(health.status).toBe(200);
        expect(await health.text()).toBe('ok');
        const asset = await fetch(`${base}/app/p1-missing-chunk.js`);
        expect(asset.status).toBe(404);
        expect(await asset.text()).not.toContain('id="surveyor-frontend"');
    });
});
