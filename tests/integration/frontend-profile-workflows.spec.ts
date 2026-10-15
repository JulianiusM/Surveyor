import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest';
import {AppDataSource} from '../../src/modules/database/dataSource';
import {User} from '../../src/modules/database/entities/user/User';
import {Guest} from '../../src/modules/database/entities/user/Guest';
import {Profile} from '../../src/modules/database/entities/user/Profile';
import * as userService from '../../src/modules/database/services/UserService';
import mailer from '../../src/modules/email';
import settings from '../../src/modules/settings';
import {decodeBootstrap} from '../../src/frontend/app/serializeBootstrap';
import type {FrontendPilotBootstrap} from '../../src/types/FrontendPilotTypes';
import type {components, operations} from '../../src/types/api/v1';
import {registerLocalAccount} from '../keywords/coreDomainKeywords';
import {closeIntegrationDatabase, initializeIntegrationDatabase} from '../support/database';

interface DocumentResponse {status: number; headers: Headers; text: string}
interface HttpSubmission {
    fields: Record<string, string>;
    origin?: string;
    format?: 'form' | 'json';
    headers?: Record<string, string>;
}
type Agent = ReturnType<typeof createHttpActor>;
type Preview = operations['previewIdentityProfileMigration']['responses'][200]['content']['application/json'];
interface Actor {
    agent: Agent;
    username: string;
    profileId: string;
    userId?: number;
    guestId?: string;
}

let listener: http.Server | undefined;
let origin = '';

/** Keep only actual server cookies while using the same native Fetch boundary as the existing HTTP integration. */
function createHttpActor() {
    let cookie = '';

    async function dispatch(method: 'GET' | 'POST', target: string, submission?: HttpSubmission): Promise<DocumentResponse> {
        const headers = new Headers({Connection: 'close', ...submission?.headers});
        if (cookie) headers.set('Cookie', cookie);
        if (method === 'POST') {
            headers.set('Origin', submission?.origin ?? origin);
            headers.set('Content-Type', submission?.format === 'json' ? 'application/json' : 'application/x-www-form-urlencoded');
        }
        let body: string | URLSearchParams | undefined;
        if (submission) body = submission.format === 'json' ? JSON.stringify(submission.fields) : new URLSearchParams(submission.fields);
        const response = await fetch(new URL(target, origin), {method, headers, redirect: 'manual', body});
        // Express owns all session creation, signatures and persistence. The fixture
        // merely returns its emitted cookie on later requests from this one actor.
        const received = response.headers.getSetCookie();
        if (received.length) cookie = received.map(function cookiePair(value) { return value.split(';')[0]; }).join('; ');
        return {status: response.status, headers: response.headers, text: await response.text()};
    }

    function get(target: string): Promise<DocumentResponse> { return dispatch('GET', target); }
    function post(target: string, fields: Record<string, string>, requestOrigin = origin): Promise<DocumentResponse> {
        return dispatch('POST', target, {fields, origin: requestOrigin});
    }
    function postJson(target: string, fields: Record<string, string>, headers: Record<string, string>): Promise<DocumentResponse> {
        return dispatch('POST', target, {fields, headers, format: 'json'});
    }
    return {get, post, postJson};
}

beforeAll(async function prepareRealApplication() {
    await initializeIntegrationDatabase();
    // Replace only external delivery. Actual routing, account/profile decisions,
    // sessions and persistence remain intact, including native partial failures.
    vi.spyOn(mailer, 'sendMigrationEmail').mockResolvedValue();
    vi.spyOn(mailer, 'sendDeletionEmail').mockResolvedValue();
    const application = (await vi.importActual<typeof import('../../src/app')>('../../src/app')).default;
    listener = http.createServer(application);
    await new Promise<void>(function listenLocally(resolve) { listener!.listen(0, '127.0.0.1', resolve); });
    const address = listener.address();
    if (!address || typeof address === 'string') throw new Error('The workflow integration listener has no local port.');
    origin = `http://127.0.0.1:${address.port}`;
});

afterEach(() => { vi.clearAllMocks(); });
afterAll(async function retireRealApplication() {
    if (listener) await new Promise<void>(function closeLocally(resolve, reject) {
        listener!.close(function closed(error) { if (error) reject(error); else resolve(); });
    });
    vi.restoreAllMocks();
    await closeIntegrationDatabase();
});

/** Admit a production account through native login and its actual persisted cookie. */
async function accountActor(): Promise<Actor> {
    const user = await registerLocalAccount('p1-workflow');
    await userService.activateUser(user.id);
    const agent = createHttpActor();
    expect((await agent.post('/users/login', {username: user.username, password: 'initial-secret'})).status).toBe(302);
    const profiles = await userService.getProfilesForUser(user.id);
    if (!profiles[0]) throw new Error('The registered account has no profile.');
    return {agent, username: user.username, userId: user.id, profileId: profiles[0].id};
}

/** A guest link uses its existing HTTP login owner without supplying an account identity. */
async function guestActor(name = `P1 guest ${randomUUID().slice(0, 8)}`): Promise<Actor> {
    const guest = await userService.createGuest(name);
    const agent = createHttpActor();
    expect((await agent.get(`/guest/${guest.id}/login/${guest.token}`)).status).toBe(302);
    return {agent, username: guest.username, guestId: guest.id, profileId: guest.profile.id};
}

/** Decode the emitted document through the real exhaustive browser admission codec. */
async function documentState(html: string): Promise<FrontendPilotBootstrap> {
    const value = /<script id="surveyor-pilot-state" type="application\/json">([^<]+)<\/script>/u.exec(html)?.[1];
    if (!value) throw new Error('The workflow document did not emit bootstrap state.');
    return decodeBootstrap(JSON.parse(value));
}

async function workflowDocument(actor: Actor, suffix: string) {
    const response = await actor.agent.get('/frontend-pilot/users/' + suffix + '?locale=en');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    return {response, state: await documentState(response.text)};
}

/** Actual mutations submit ordinary document forms with the admitted document's captured receipt. */
function formReceipt(state: FrontendPilotBootstrap): Record<string, string> {
    return {_context: state.session.context, _csrf: state.session.csrfToken,
        _compat: state.session.deployment.apiCompatibility};
}

async function postWorkflow(actor: Actor, suffix: string, state: FrontendPilotBootstrap, fields: Record<string, string>, expectedStatus = 200) {
    const response = await actor.agent.post('/frontend-pilot/users/' + suffix + '?locale=en', {...formReceipt(state), ...fields});
    expect(response.status).toBe(expectedStatus);
    return response;
}

/** Preview is a generated read-only operation; the existing business check still owns its limited result. */
function previewRequest(actor: Actor, state: FrontendPilotBootstrap, token: string): Promise<DocumentResponse> {
    return actor.agent.postJson('/api/v1/profiles/migration/preview', {token}, {
        'X-Surveyor-Context': state.session.context, 'X-CSRF-Token': state.session.csrfToken,
        'X-Surveyor-Api-Compatibility': state.session.deployment.apiCompatibility, 'X-Surveyor-Locale': state.session.locale,
    });
}

async function previewMigration(actor: Actor, state: FrontendPilotBootstrap, token: string) {
    const response = await previewRequest(actor, state, token);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    return {response, preview: JSON.parse(response.text) as Preview};
}

async function sessionOf(actor: Actor): Promise<components['schemas']['SessionView']> {
    const response = await actor.agent.get('/api/v1/session');
    expect(response.status).toBe(200);
    return JSON.parse(response.text);
}

describe('native profile workflows through pilot adapters', () => {
    it.each(['account', 'guest'] as const)('issues the existing private migration token for an admitted %s document only',
        async function issuesNativeToken(kind) {
            const actor = kind === 'account' ? await accountActor() : await guestActor();
            const before = await userService.getProfileById(actor.profileId);
            const first = await workflowDocument(actor, 'profile/migrate/request');
            expect(first.state.profileWorkflow?.kind).toBe('token');
            if (first.state.profileWorkflow?.kind !== 'token') throw new Error('Expected a migration token document.');
            const token = first.state.profileWorkflow.token;
            expect(token).not.toBe(before?.migrationToken);
            expect(await userService.getProfileById(actor.profileId)).toMatchObject({migrationToken: token});

            // GET issuance is an existing native side effect. A deliberate second
            // document issues a new token, rather than retaining an invented lease.
            const second = await workflowDocument(actor, 'profile/migrate/request');
            expect(second.state.profileWorkflow).not.toEqual(first.state.profileWorkflow);
            expect(first.response.headers.get('location')).toBeNull();
            expect(first.response.text).not.toContain('/profile/migrate/show?token=');
        });

    it.each(['account', 'guest'] as const)('previews explicit %s fields without transferring ownership or serializing private relations', async function previewsOnly(kind) {
        const source = kind === 'account' ? await accountActor() : await guestActor('Preview <b>source</b>');
        const recipient = await accountActor();
        const sourceProfile = (await userService.getProfileById(source.profileId))!;
        const sourceAccount = source.userId ? await userService.getUserById(source.userId) : null;
        const owner = sourceAccount ? {kind: 'account', name: sourceAccount.name, username: sourceAccount.username, email: sourceAccount.email}
            : {kind: 'guest', username: source.username, email: null};
        const issued = await workflowDocument(source, 'profile/migrate/request');
        if (issued.state.profileWorkflow?.kind !== 'token') throw new Error('Expected the issued migration token.');
        const token = issued.state.profileWorkflow.token;
        const entry = await workflowDocument(recipient, 'profile/migrate/show');
        expect(entry.state.profileWorkflow).toEqual({kind: 'entry'});
        const {preview} = await previewMigration(recipient, entry.state, token);
        await postWorkflow(recipient, 'profile/migrate/show', entry.state, {token}, 404);

        // Native preview may disclose these fields to a token holder. The adapter
        // must not broaden that projection to credentials or nested ORM relations.
        expect(preview).toEqual({kind: 'preview', token, profile: {id: source.profileId, name: sourceProfile.name, owner}});
        expect(JSON.stringify(preview)).not.toMatch(/"(?:password|activationToken|resetToken|profiles|guestToken)"/u);
        const stored = await userService.getProfileById(source.profileId);
        expect(stored).toMatchObject(kind === 'account' ? {userId: source.userId, migrationToken: token}
            : {guestId: source.guestId, migrationToken: token});
        expect((await sessionOf(recipient)).activeProfile?.id).toBe(recipient.profileId);
        expect(mailer.sendMigrationEmail).not.toHaveBeenCalled();
        expect(mailer.sendDeletionEmail).not.toHaveBeenCalled();
    });

    it('rejects an invalid preview token and account-only guest entry without changing either identity', async function rejectsPreviewAdmission() {
        const recipient = await accountActor();
        const guest = await guestActor();
        const entry = await workflowDocument(recipient, 'profile/migrate/show');
        const invalid = await previewMigration(recipient, entry.state, 'invalid-migration-token');
        expect(invalid.preview).toEqual({kind: 'denied', status: 401, messageKey: 'profile.invalidMigrationToken'});
        const response = await guest.agent.get('/frontend-pilot/users/profile/migrate/show');
        expect(response.status).toBe(302);
        expect(response.headers.get('location')).toContain('/frontend-pilot/users/login?next=');
        const guestDocument = await workflowDocument(guest, 'account/delete');
        expect((await previewRequest(guest, guestDocument.state, 'invalid-migration-token')).status).toBe(403);
        expect((await sessionOf(guest)).kind).toBe('guest');
        expect((await sessionOf(recipient)).activeProfile?.id).toBe(recipient.profileId);
    });

    it('executes the existing guest transfer, clears its token and retains the receiving active profile', async function executesTransfer() {
        const source = await guestActor();
        const recipient = await accountActor();
        const issued = await workflowDocument(source, 'profile/migrate/request');
        if (issued.state.profileWorkflow?.kind !== 'token') throw new Error('Expected the issued migration token.');
        const token = issued.state.profileWorkflow.token;
        const entry = await workflowDocument(recipient, 'profile/migrate/show');
        const {preview} = await previewMigration(recipient, entry.state, token);
        expect(preview.kind).toBe('preview');
        const response = await postWorkflow(recipient, 'profile/migrate/execute', entry.state, {token}, 302);

        // This is the original controller's transfer and previous-owner cleanup.
        // The native token check is preserved; this test does not certify races.
        expect(response.headers.get('location')).toBe('/frontend-pilot/users/profile/manage?locale=en');
        expect(await userService.getProfileById(source.profileId)).toMatchObject({userId: recipient.userId,
            guestId: null, migrationToken: null, migrationTokenExpiration: null, defaultForOwner: false});
        expect(await AppDataSource.getRepository(Guest).findOneBy({id: source.guestId!})).toBeNull();
        expect((await sessionOf(recipient)).activeProfile?.id).toBe(recipient.profileId);
        await postWorkflow(recipient, 'profile/migrate/execute', entry.state, {token}, 401);
    });

    it.each(['context', 'csrf', 'compatibility', 'origin', 'stored actor'] as const)(
        'rejects stale or forged %s before profile deactivation', async function guardsDocumentWrite(boundary) {
            const actor = await accountActor();
            const document = await workflowDocument(actor, 'profile/delete');
            const before = await userService.getProfileById(actor.profileId);
            const fields: Record<string, string> = {...formReceipt(document.state), name: before!.name};
            let requestOrigin = origin;
            if (boundary === 'context') fields._context = 'different-context';
            if (boundary === 'csrf') fields._csrf = 'different-csrf';
            if (boundary === 'compatibility') fields._compat = 'unsupported-compatibility';
            if (boundary === 'origin') requestOrigin = 'https://foreign.example.invalid';
            if (boundary === 'stored actor') {
                const sibling = await userService.createProfile(actor.userId!, 'A newly selected profile');
                expect((await actor.agent.get('/users/profile/change/' + sibling.id)).status).toBe(302);
            }

            // Use the same ordinary form body as the browser. Any transport rejection
            // must precede the existing destructive controller and leave this row owned.
            const response = await actor.agent.post('/frontend-pilot/users/profile/delete', fields, requestOrigin);
            const expectedStatus = boundary === 'csrf' || boundary === 'origin' ? 403 : 409;
            expect(response.status).toBe(expectedStatus);
            expect(await userService.getProfileById(actor.profileId)).toMatchObject({userId: actor.userId, name: before!.name});
            expect(await AppDataSource.getRepository(User).findOneBy({id: actor.userId!})).not.toBeNull();
            expect(mailer.sendDeletionEmail).not.toHaveBeenCalled();
        });

    it.each(['profile/delete', 'account/delete'] as const)('retains native wrong-confirmation 500 and redisplayed input for %s',
        async function retainsConfirmationFailure(suffix) {
            const actor = await accountActor();
            const document = await workflowDocument(actor, suffix);
            const field = suffix === 'profile/delete' ? 'name' : 'username';
            const value = 'Incorrect confirmation';
            const native = await actor.agent.post('/users/' + suffix, {[field]: value});
            expect(native.status).toBe(500);
            const response = await postWorkflow(actor, suffix, document.state, {[field]: value}, native.status);
            expect((await documentState(response.text)).profileWorkflow).toMatchObject({kind: field === 'name' ? 'deactivate' : 'delete-account', value});
            expect(native.text).toContain(`value="${value}"`);
            expect(await userService.getProfileById(actor.profileId)).toMatchObject({userId: actor.userId});
            expect(await AppDataSource.getRepository(User).findOneBy({id: actor.userId!})).not.toBeNull();
        });

    it('deactivates the selected profile and chooses the existing remaining default', async function selectsRemainingDefault() {
        const actor = await accountActor();
        const sibling = await userService.createProfile(actor.userId!, 'Remaining default');
        await userService.updateProfileDefault(sibling.id, true);
        const document = await workflowDocument(actor, 'profile/delete');
        const response = await postWorkflow(actor, 'profile/delete', document.state,
            {name: document.state.session.activeProfile!.name}, 302);

        // Profile records remain as shared participation history. Only ownership,
        // personal default status and the active selection follow native deletion.
        expect(response.headers.get('location')).toBe('/frontend-pilot/users/profile/manage?locale=en');
        expect(await userService.getProfileById(actor.profileId)).toMatchObject({userId: null, defaultForOwner: false});
        expect((await sessionOf(actor)).activeProfile?.id).toBe(sibling.id);
        expect(await AppDataSource.getRepository(User).findOneBy({id: actor.userId!})).not.toBeNull();
    });

    it('preserves the existing final-profile 400 after deletion instead of silently repairing IMP-006', async function retainsFinalProfileFailure() {
        const actor = await accountActor();
        const document = await workflowDocument(actor, 'profile/delete');
        const response = await postWorkflow(actor, 'profile/delete', document.state,
            {name: document.state.session.activeProfile!.name}, 400);

        // The external delivery boundary acknowledges this integration fixture.
        // Native subsequent selection still fails after its account was deleted;
        // migration does not reinterpret that partial result as rollback or alter
        // the controller order.
        expect((await documentState(response.text)).commonPage).toMatchObject({status: 400});
        expect(await AppDataSource.getRepository(User).findOneBy({id: actor.userId!})).toBeNull();
        expect(await userService.getProfileById(actor.profileId)).toMatchObject({userId: null});
        expect(mailer.sendDeletionEmail).toHaveBeenCalledOnce();
    });

    it.each(['account', 'guest'] as const)('deletes the admitted %s identity and clears its real HTTP authority',
        async function deletesNativeAccount(kind) {
            const actor = kind === 'account' ? await accountActor() : await guestActor();
            const document = await workflowDocument(actor, 'account/delete');
            const response = await postWorkflow(actor, 'account/delete', document.state, {username: actor.username}, 302);

            // The original logout owner selects this destination. No provider or
            // mail-delivery guarantee is inferred from its local fixture result.
            expect(response.headers.get('location')).toBe(settings.value.rootUrl);
            expect((await sessionOf(actor)).kind).toBe('anonymous');
            if (kind === 'account') expect(await AppDataSource.getRepository(User).findOneBy({id: actor.userId!})).toBeNull();
            else expect(await AppDataSource.getRepository(Guest).findOneBy({id: actor.guestId!})).toBeNull();
        });
});
