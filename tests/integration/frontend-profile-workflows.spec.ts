import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest';
import {AppDataSource} from '../../src/modules/database/dataSource';
import {User} from '../../src/modules/database/entities/user/User';
import {Guest} from '../../src/modules/database/entities/user/Guest';
import {Session} from '../../src/modules/database/entities/session/Session';
import type {SessionData} from 'express-session';
import * as userService from '../../src/modules/database/services/UserService';
import mailer from '../../src/modules/email';
import settings from '../../src/modules/settings';
import {decodeBootstrap} from '../../src/frontend/app/serializeBootstrap';
import type {FrontendPilotBootstrap} from '../../src/types/FrontendPilotTypes';
import type {components, operations} from '../../src/types/api/v1';
import {registerLocalAccount} from '../keywords/coreDomainKeywords';
import {closeIntegrationDatabase, initializeIntegrationDatabase} from '../support/database';
import {contractValidator} from '../../src/modules/api/contracts';

interface DocumentResponse {status: number; headers: Headers; text: string}
interface HttpSubmission {
    fields?: Record<string, string>;
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

    async function dispatch(method: 'GET' | 'POST' | 'DELETE', target: string, submission?: HttpSubmission): Promise<DocumentResponse> {
        const headers = new Headers({Connection: 'close', ...submission?.headers});
        if (cookie) headers.set('Cookie', cookie);
        if (method !== 'GET') {
            headers.set('Origin', submission?.origin ?? origin);
            if (submission?.fields) headers.set('Content-Type', submission.format === 'json' ? 'application/json' : 'application/x-www-form-urlencoded');
        }
        let body: string | URLSearchParams | undefined;
        if (submission?.fields) body = submission.format === 'json' ? JSON.stringify(submission.fields) : new URLSearchParams(submission.fields);
        const response = await fetch(new URL(target, origin), {method, headers, redirect: 'manual', body});
        // Express owns all session creation, signatures and persistence. The fixture
        // merely returns its emitted cookie on later requests from this one actor.
        const received = response.headers.getSetCookie();
        if (received.length) cookie = received.map(function cookiePair(value) { return value.split(';')[0]; }).join('; ');
        return {status: response.status, headers: response.headers, text: await response.text()};
    }

    function get(target: string, headers?: Record<string, string>): Promise<DocumentResponse> { return dispatch('GET', target, {headers}); }
    function post(target: string, fields: Record<string, string>, requestOrigin = origin): Promise<DocumentResponse> {
        return dispatch('POST', target, {fields, origin: requestOrigin});
    }
    function postJson(target: string, fields: Record<string, string>, headers: Record<string, string>, requestOrigin = origin): Promise<DocumentResponse> {
        return dispatch('POST', target, {fields, headers, format: 'json', origin: requestOrigin});
    }
    function deleteJson(target: string, fields: Record<string, string>, headers: Record<string, string>): Promise<DocumentResponse> {
        return dispatch('DELETE', target, {fields, headers, format: 'json'});
    }
    function postEmpty(target: string, headers: Record<string, string>): Promise<DocumentResponse> {
        return dispatch('POST', target, {headers});
    }
    /** Locate only this actor's real persisted session for a legacy-format fixture;
     * no signature, Session object or authenticated request is manufactured here. */
    function sessionId(): string {
        const value = cookie.split('; ').find(pair => pair.startsWith('connect.sid='))?.slice('connect.sid='.length);
        const signed = value ? decodeURIComponent(value) : '';
        if (!signed.startsWith('s:') || signed.lastIndexOf('.') < 3) throw new Error('The actor has no signed server session cookie.');
        return signed.slice(2, signed.lastIndexOf('.'));
    }
    return {get, post, postJson, deleteJson, postEmpty, sessionId};
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
    vi.spyOn(settings, 'value', 'get').mockReturnValue({...settings.value, rootUrl: origin});
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

/** JSON commands carry the same actual session evidence returned to the browser. */
function apiReceipt(state: FrontendPilotBootstrap): Record<string, string> {
    if (!state.session.context || !state.session.csrfToken) throw new Error('A private workflow needs admitted session evidence.');
    return {'X-Surveyor-Context': state.session.context, 'X-CSRF-Token': state.session.csrfToken,
        'X-Surveyor-Api-Compatibility': state.session.deployment.apiCompatibility, 'X-Surveyor-Locale': state.session.locale};
}

async function postWorkflow(actor: Actor, suffix: string, state: FrontendPilotBootstrap, fields: Record<string, string>, expectedStatus = 200) {
    const response = suffix === 'account/delete'
        ? await actor.agent.deleteJson('/api/v1/account', fields, apiReceipt(state))
        : await actor.agent.postJson(suffix === 'profile/delete' ? '/api/v1/profiles/current/deactivate' : '/api/v1/profiles/migration/execute',
            fields, apiReceipt(state));
    expect(response.status).toBe(expectedStatus);
    return response;
}

/** Preview is a generated read-only operation; the existing business check still owns its limited result. */
function previewRequest(actor: Actor, state: FrontendPilotBootstrap, token: string): Promise<DocumentResponse> {
    return actor.agent.postJson('/api/v1/profiles/migration/preview', {token}, apiReceipt(state));
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

/** Read the native alert's unchanged text bytes, including an empty cleanup
 * suffix's trailing space. The route and Pug owner provide the actual wording. */
function nativeSuccessNotice(response: DocumentResponse): string | undefined {
    return /<div[^>]*class="alert alert-success"[^>]*>([^<]*)<\/div>/u.exec(response.text)?.[1];
}

describe('shared profile workflows through versioned SPA commands and initial document entry', () => {
    it.each(['account', 'guest'] as const)('keeps warm %s admission read-only and issues only on the explicit token command', async function issuesOnlyOnCommand(kind) {
        const actor = kind === 'account' ? await accountActor() : await guestActor();
        const document = await workflowDocument(actor, 'account/delete');
        const previous = (await userService.getProfileById(actor.profileId))!.migrationToken;
        const admission = await actor.agent.get('/api/v1/profiles/workflow-entry?kind=token&returnTo=%2Ffrontend-pilot%2Fusers%2Fprofile%2Fmigrate%2Frequest',
            {'X-Surveyor-Context': document.state.session.context!});
        expect(admission.status).toBe(200);
        expect(JSON.parse(admission.text)).toEqual({entry: {kind: 'render'}});
        expect((await userService.getProfileById(actor.profileId))!.migrationToken).toBe(previous);

        const issued = await actor.agent.postEmpty('/api/v1/profiles/migration/token', apiReceipt(document.state));
        expect(issued.status).toBe(200);
        const result = JSON.parse(issued.text) as components['schemas']['ProfileMigrationToken'];
        expect(contractValidator('ProfileMigrationToken')(result)).toBe(true);
        expect((await userService.getProfileById(actor.profileId))!.migrationToken).toBe(result.token);
        expect(result.token).not.toBe(previous);
    });

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
        expect((await recipient.agent.post('/frontend-pilot/users/profile/migrate/show', {token})).status).toBe(404);

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

    it.each([
        {owner: 'guest', key: 'profile.migrationCompletedGuestDeleted'},
        {owner: 'account-deleted', key: 'profile.migrationCompletedAccountDeleted'},
        {owner: 'account-retained', key: 'profile.migrationCompleted'},
    ] as const)('executes the existing $owner transfer and reports its exact semantic cleanup notice', async function executesTransfer(candidate) {
        const source = candidate.owner === 'guest' ? await guestActor() : await accountActor();
        if (candidate.owner === 'account-retained') await userService.createProfile(source.userId!, 'Remaining source profile');
        const recipient = await accountActor();
        const issued = await workflowDocument(source, 'profile/migrate/request');
        if (issued.state.profileWorkflow?.kind !== 'token') throw new Error('Expected the issued migration token.');
        const token = issued.state.profileWorkflow.token;
        const entry = await workflowDocument(recipient, 'profile/migrate/show');
        const {preview} = await previewMigration(recipient, entry.state, token);
        expect(preview.kind).toBe('preview');
        const response = await postWorkflow(recipient, 'profile/migrate/execute', entry.state, {token});

        // This is the original controller's transfer and previous-owner cleanup.
        // The native token check is preserved; this test does not certify races.
        expect(JSON.parse(response.text)).toMatchObject({destination: '/frontend-pilot/users/profile/manage',
            resultingContext: entry.state.session.context, notice: {kind: 'success', messageKey: candidate.key}, redirect: null});
        expect(JSON.parse(response.text)).not.toHaveProperty('message');
        expect(await userService.getProfileById(source.profileId)).toMatchObject({userId: recipient.userId,
            guestId: null, migrationToken: null, migrationTokenExpiration: null, defaultForOwner: false});
        if (candidate.owner === 'guest') expect(await AppDataSource.getRepository(Guest).findOneBy({id: source.guestId!})).toBeNull();
        else {
            const previousOwner = await AppDataSource.getRepository(User).findOneBy({id: source.userId!});
            if (candidate.owner === 'account-retained') expect(previousOwner).not.toBeNull();
            else expect(previousOwner).toBeNull();
        }
        expect((await sessionOf(recipient)).activeProfile?.id).toBe(recipient.profileId);
        const invalid = await postWorkflow(recipient, 'profile/migrate/execute', entry.state, {token}, 401);
        expect(JSON.parse(invalid.text)).toMatchObject({status: 401, code: 'TOKEN_INVALID'});
        expect((await sessionOf(recipient)).activeProfile?.id).toBe(recipient.profileId);
    });

    it.each([
        {owner: 'guest', suffix: 'Previous guest account permanently deleted!'},
        {owner: 'account-deleted', suffix: 'Previous user account permanently deleted!'},
        {owner: 'account-retained', suffix: ''},
    ] as const)('retains the exact native $owner transfer notice through the unchanged route', async function preservesNativeTransferNotice(candidate) {
        const source = candidate.owner === 'guest' ? await guestActor() : await accountActor();
        if (candidate.owner === 'account-retained') await userService.createProfile(source.userId!, 'Remaining native source profile');
        const recipient = await accountActor();
        const issued = await workflowDocument(source, 'profile/migrate/request');
        if (issued.state.profileWorkflow?.kind !== 'token') throw new Error('Expected the issued migration token.');

        // Consume setup login feedback before the actual native operation. The
        // existing route, flash owner and rendered alert are the string oracle.
        expect((await recipient.agent.get('/users/profile/manage')).status).toBe(200);
        const response = await recipient.agent.post('/users/profile/migrate/execute', {token: issued.state.profileWorkflow.token});
        expect(response.status).toBe(302);
        expect(response.headers.get('location')).toBe('/users/profile/manage');
        const destination = await recipient.agent.get('/users/profile/manage');
        expect(nativeSuccessNotice(destination)).toBe(`Migration successful. ${candidate.suffix}`);
        expect(await userService.getProfileById(source.profileId)).toMatchObject({userId: recipient.userId, guestId: null});
    });

    it('confirms transfer in the admitted derived context when a stored legacy metadata pair is partial', async function preservesLegacyCompletionScope() {
        const source = await guestActor();
        const recipient = await accountActor();
        const repository = AppDataSource.getRepository(Session);
        const storedRow = await repository.findOneByOrFail({id: recipient.agent.sessionId()});
        const stored = JSON.parse(storedRow.json) as SessionData;
        const partialContext = 'partial-legacy-' + randomUUID();
        stored.frontendContext = partialContext;
        delete stored.frontendCsrfToken;
        // Change only the persisted fixture's historical metadata shape. All
        // subsequent admission, transfer and response delivery use the actual app.
        await repository.update(storedRow.id, {json: JSON.stringify(stored)});

        const issued = await workflowDocument(source, 'profile/migrate/request');
        if (issued.state.profileWorkflow?.kind !== 'token') throw new Error('Expected the issued migration token.');
        const entry = await workflowDocument(recipient, 'profile/migrate/show');
        expect(entry.state.session.context).toBeTypeOf('string');
        expect(entry.state.session.context).not.toBe(partialContext);
        const response = await postWorkflow(recipient, 'profile/migrate/execute', entry.state,
            {token: issued.state.profileWorkflow.token});
        const completion = JSON.parse(response.text) as components['schemas']['ProfileWorkflowCompletion'];
        expect(completion.resultingContext).toBe(entry.state.session.context);
        expect(response.headers.get('X-Surveyor-Context')).toBe(entry.state.session.context);
        expect((await sessionOf(recipient)).context).toBe(completion.resultingContext);
        expect(await userService.getProfileById(source.profileId)).toMatchObject({userId: recipient.userId});

        // Successful transport must not repair or rotate legacy metadata merely
        // to make its completion projection agree with the admitted actor.
        const after = JSON.parse((await repository.findOneByOrFail({id: storedRow.id})).json) as SessionData;
        expect(after.frontendContext).toBe(partialContext);
        expect(after.frontendCsrfToken).toBeUndefined();
    });

    it('retains transfer work when external cleanup delivery fails and reports an uncertain command outcome', async function retainsPartialTransfer() {
        const source = await accountActor();
        const recipient = await accountActor();
        const issued = await workflowDocument(source, 'profile/migrate/request');
        if (issued.state.profileWorkflow?.kind !== 'token') throw new Error('Expected the issued migration token.');
        const entry = await workflowDocument(recipient, 'profile/migrate/show');
        vi.mocked(mailer.sendMigrationEmail).mockRejectedValueOnce(new Error('Controlled external delivery failure'));
        const response = await postWorkflow(recipient, 'profile/migrate/execute', entry.state,
            {token: issued.state.profileWorkflow.token}, 500);
        expect(JSON.parse(response.text)).toMatchObject({status: 500, code: 'WORKFLOW_OUTCOME_UNKNOWN'});
        expect(await userService.getProfileById(source.profileId)).toMatchObject({userId: recipient.userId, migrationToken: null});
        // Existing cleanup stops after mail failure; this adapter neither rolls
        // back the transfer nor resumes the operation behind the user's back.
        expect(await AppDataSource.getRepository(User).findOneBy({id: source.userId!})).not.toBeNull();
        expect((await sessionOf(recipient)).activeProfile?.id).toBe(recipient.profileId);
    });

    it.each(['context', 'csrf', 'compatibility', 'origin', 'stored actor'] as const)(
        'rejects stale or forged %s before profile deactivation', async function guardsJsonWrite(boundary) {
            const actor = await accountActor();
            const document = await workflowDocument(actor, 'profile/delete');
            const before = await userService.getProfileById(actor.profileId);
            const headers = apiReceipt(document.state);
            let requestOrigin = origin;
            if (boundary === 'context') headers['X-Surveyor-Context'] = 'different-context';
            if (boundary === 'csrf') headers['X-CSRF-Token'] = 'different-csrf';
            if (boundary === 'compatibility') headers['X-Surveyor-Api-Compatibility'] = 'unsupported-compatibility';
            if (boundary === 'origin') requestOrigin = 'https://foreign.example.invalid';
            if (boundary === 'stored actor') {
                const sibling = await userService.createProfile(actor.userId!, 'A newly selected profile');
                expect((await actor.agent.get('/users/profile/change/' + sibling.id)).status).toBe(302);
            }

            // Use the same generated command body as the browser. Transport rejection
            // must precede the existing destructive controller and leave this row owned.
            const response = await actor.agent.postJson('/api/v1/profiles/current/deactivate', {name: before!.name}, headers, requestOrigin);
            const expectedStatus = boundary === 'csrf' || boundary === 'origin' ? 403 : 409;
            expect(response.status).toBe(expectedStatus);
            expect(await userService.getProfileById(actor.profileId)).toMatchObject({userId: actor.userId, name: before!.name});
            expect(await AppDataSource.getRepository(User).findOneBy({id: actor.userId!})).not.toBeNull();
            expect(mailer.sendDeletionEmail).not.toHaveBeenCalled();
        });

    it.each(['profile/delete', 'account/delete'] as const)('rejects wrong confirmation before shared mutation for %s',
        async function retainsConfirmationFailure(suffix) {
            const actor = await accountActor();
            const document = await workflowDocument(actor, suffix);
            const field = suffix === 'profile/delete' ? 'name' : 'username';
            const value = 'Incorrect confirmation';
            const native = await actor.agent.post('/users/' + suffix, {[field]: value});
            expect(native.status).toBe(500);
            const response = await postWorkflow(actor, suffix, document.state, {[field]: value}, 400);
            expect(JSON.parse(response.text)).toMatchObject({code: 'VALIDATION_FAILED', status: 400});
            expect(native.text).toContain(`value="${value}"`);
            expect(await userService.getProfileById(actor.profileId)).toMatchObject({userId: actor.userId});
            expect(await AppDataSource.getRepository(User).findOneBy({id: actor.userId!})).not.toBeNull();
        });

    it.each(['native', 'versioned'] as const)('deactivates the selected profile through %s and chooses the existing remaining default', async function selectsRemainingDefault(transport) {
        const actor = await accountActor();
        const sibling = await userService.createProfile(actor.userId!, 'Remaining default');
        await userService.updateProfileDefault(sibling.id, true);
        const document = await workflowDocument(actor, 'profile/delete');
        // The native caller keeps the same string, including its empty cleanup
        // suffix. Versioned presentation carries a catalog key for that outcome.
        if (transport === 'native') expect((await actor.agent.get('/users/profile/manage')).status).toBe(200);
        const response = transport === 'native'
            ? await actor.agent.post('/users/profile/delete', {name: document.state.session.activeProfile!.name})
            : await postWorkflow(actor, 'profile/delete', document.state, {name: document.state.session.activeProfile!.name});

        // Profile records remain as shared participation history. Only ownership,
        // personal default status and the active selection follow native deletion.
        if (transport === 'native') {
            expect(response.status).toBe(302);
            const destination = await actor.agent.get('/users/profile/manage');
            expect(nativeSuccessNotice(destination)).toBe('Profile successfully deactivated. ');
        } else {
            const completion = JSON.parse(response.text) as components['schemas']['ProfileWorkflowCompletion'];
            expect(contractValidator('ProfileWorkflowCompletion')(completion)).toBe(true);
            expect(completion).toMatchObject({destination: '/frontend-pilot/users/profile/manage', redirect: null,
                notice: {kind: 'success', messageKey: 'profile.deactivationCompleted'}});
            expect(completion).not.toHaveProperty('message');
            expect(completion.resultingContext).not.toBe(document.state.session.context);
        }
        expect(await userService.getProfileById(actor.profileId)).toMatchObject({userId: null, defaultForOwner: false});
        expect((await sessionOf(actor)).activeProfile?.id).toBe(sibling.id);
        expect(await AppDataSource.getRepository(User).findOneBy({id: actor.userId!})).not.toBeNull();
    });

    it('reports unknown completion for the inherited last-profile failure after its actual deletion', async function retainsFinalProfileFailure() {
        const actor = await accountActor();
        const document = await workflowDocument(actor, 'profile/delete');
        const response = await postWorkflow(actor, 'profile/delete', document.state,
            {name: document.state.session.activeProfile!.name}, 500);

        // The external delivery boundary acknowledges this integration fixture.
        // Native subsequent selection still fails after its account was deleted;
        // migration does not reinterpret that partial result as rollback or alter
        // the controller order.
        expect(JSON.parse(response.text)).toMatchObject({status: 500, code: 'WORKFLOW_OUTCOME_UNKNOWN'});
        expect(await AppDataSource.getRepository(User).findOneBy({id: actor.userId!})).toBeNull();
        expect(await userService.getProfileById(actor.profileId)).toMatchObject({userId: null});
        expect(mailer.sendDeletionEmail).toHaveBeenCalledOnce();
    });

    it.each(['account', 'guest'] as const)('deletes the admitted %s identity and clears its real HTTP authority',
        async function deletesNativeAccount(kind) {
            const actor = kind === 'account' ? await accountActor() : await guestActor();
            const document = await workflowDocument(actor, 'account/delete');
            const response = await postWorkflow(actor, 'account/delete', document.state, {username: actor.username});

            // The original logout owner selects this destination. No provider or
            // mail-delivery guarantee is inferred from its local fixture result.
            const completion = JSON.parse(response.text) as components['schemas']['ProfileWorkflowCompletion'];
            expect(contractValidator('ProfileWorkflowCompletion')(completion)).toBe(true);
            expect(completion).toMatchObject({destination: '/frontend-pilot', redirect: null,
                notice: {kind: 'success', messageKey: 'profile.accountDeleted'}});
            expect(completion).not.toHaveProperty('message');
            expect(completion.resultingContext).not.toBe(document.state.session.context);
            expect((await sessionOf(actor)).kind).toBe('anonymous');
            if (kind === 'account') expect(await AppDataSource.getRepository(User).findOneBy({id: actor.userId!})).toBeNull();
            else expect(await AppDataSource.getRepository(Guest).findOneBy({id: actor.guestId!})).toBeNull();
        });
});
