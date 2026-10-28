import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest';
import {AppDataSource} from '../../src/backend/modules/database/dataSource';
import {User} from '../../src/backend/modules/database/entities/user/User';
import {Guest} from '../../src/backend/modules/database/entities/user/Guest';
import {Session} from '../../src/backend/modules/database/entities/session/Session';
import type {SessionData} from 'express-session';
import * as userService from '../../src/backend/modules/database/services/UserService';
import mailer from '../../src/backend/modules/email';
import * as emailOwner from '../../src/backend/modules/email';
import settings from '../../src/backend/modules/settings';
import {decodeBootstrap} from '../../src/frontend/app/serializeBootstrap';
import type {FrontendBootstrap} from '../../src/types/FrontendTypes';
import type {components, operations} from '../../src/types/api/v1';
import {registerLocalAccount} from '../keywords/coreDomainKeywords';
import {closeIntegrationDatabase, initializeIntegrationDatabase} from '../support/database';
import {prepareFrontendSsrModules} from '../support/frontendRenderer';
import {contractValidator} from '../../src/backend/modules/api/contracts';
import {createTranslator} from '../../src/common/localization/translator';

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

    async function dispatch(method: 'GET' | 'POST' | 'PUT' | 'DELETE', target: string, submission?: HttpSubmission): Promise<DocumentResponse> {
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
    function putJson(target: string, fields: Record<string, string>, headers: Record<string, string>): Promise<DocumentResponse> {
        return dispatch('PUT', target, {fields, headers, format: 'json'});
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
    return {get, post, postJson, putJson, deleteJson, postEmpty, sessionId};
}

/** Admit the real persistence/application owners and wait for their pure renderer
 * infrastructure before opening the fixture listener, matching installed startup. */
async function prepareApplicationListener(rendererReady: Promise<void>): Promise<void> {
    await initializeIntegrationDatabase();
    // Replace only external delivery. Actual routing, account/profile decisions,
    // sessions and persistence remain intact, including deliberately retained partial failures.
    vi.spyOn(mailer, 'sendMigrationEmail').mockResolvedValue();
    vi.spyOn(mailer, 'sendDeletionEmail').mockResolvedValue();
    // Preserve real recipient/template preparation, replacing only the returned
    // external SMTP delivery receipt for committed migration/deletion operations.
    for (const method of ['prepareMigrationEmail', 'prepareDeletionEmail'] as const) {
        const prepare = emailOwner[method];
        vi.spyOn(emailOwner, method).mockImplementation(((...args: Parameters<typeof prepare>) => {
            (prepare as (...values: Parameters<typeof prepare>) => unknown)(...args);
            return {deliver: vi.fn().mockResolvedValue(true)};
        }) as typeof prepare);
    }
    const application = (await vi.importActual<typeof import('../../src/backend/app')>('../../src/backend/app')).default;
    // Module preparation is independent of persistence. Its failure must prevent
    // HTTP readiness while the shared hook still awaits both preparation branches.
    await rendererReady;
    listener = http.createServer(application);
    await new Promise<void>(function listenLocally(resolve) { listener!.listen(0, '127.0.0.1', resolve); });
    const address = listener.address();
    if (!address || typeof address === 'string') throw new Error('The workflow integration listener has no local port.');
    origin = `http://127.0.0.1:${address.port}`;
    vi.spyOn(settings, 'value', 'get').mockReturnValue({...settings.value, rootUrl: origin});
}

/** Keep compiler readiness in suite infrastructure and all actual actor/request
 * assertions under their existing deadlines. Await both branches before teardown. */
beforeAll(async function prepareRealApplication(): Promise<void> {
    const rendererReady = prepareFrontendSsrModules(['ProfileWorkflowPage']);
    const preparation = await Promise.allSettled([prepareApplicationListener(rendererReady), rendererReady]);
    // A failed module lookup or database setup must not leave its independent
    // branch running when the suite closes its listener/session store/database.
    for (const result of preparation) if (result.status === 'rejected') throw result.reason;
});

afterEach(() => { vi.clearAllMocks(); });
afterAll(async function retireRealApplication() {
    if (listener) await new Promise<void>(function closeLocally(resolve, reject) {
        listener!.close(function closed(error) { if (error) reject(error); else resolve(); });
    });
    vi.restoreAllMocks();
    await closeIntegrationDatabase();
});

/** Admit a production account through generated login and its actual persisted cookie. */
async function accountActor(): Promise<Actor> {
    const user = await registerLocalAccount('p1-workflow');
    await userService.activateUser(user.id);
    const agent = createHttpActor();
    const anonymous = JSON.parse((await agent.get('/api/v1/session')).text) as components['schemas']['SessionView'];
    expect((await agent.postJson('/api/v1/auth/login', {username: user.username, password: 'initial-secret'},
        {'X-Surveyor-Api-Compatibility': anonymous.deployment.apiCompatibility})).status).toBe(200);
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
async function documentState(html: string): Promise<FrontendBootstrap> {
    const value = /<script id="surveyor-frontend-state" type="application\/json">([^<]+)<\/script>/u.exec(html)?.[1];
    if (!value) throw new Error('The workflow document did not emit bootstrap state.');
    return decodeBootstrap(JSON.parse(value));
}

async function workflowDocument(actor: Actor, suffix: string) {
    const response = await actor.agent.get('/users/' + suffix + '?locale=en');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    return {response, state: await documentState(response.text)};
}

/** JSON commands carry the same actual session evidence returned to the browser. */
function apiReceipt(state: FrontendBootstrap): Record<string, string> {
    if (!state.session.context || !state.session.csrfToken) throw new Error('A private workflow needs admitted session evidence.');
    return {'X-Surveyor-Context': state.session.context, 'X-CSRF-Token': state.session.csrfToken,
        'X-Surveyor-Api-Compatibility': state.session.deployment.apiCompatibility, 'X-Surveyor-Locale': state.session.locale};
}

async function postWorkflow(actor: Actor, suffix: string, state: FrontendBootstrap, fields: Record<string, string>, expectedStatus = 200) {
    const response = suffix === 'account/delete'
        ? await actor.agent.deleteJson('/api/v1/account', fields, apiReceipt(state))
        : await actor.agent.postJson(suffix === 'profile/delete' ? '/api/v1/profiles/current/deactivate' : '/api/v1/profiles/migration/execute',
            fields, apiReceipt(state));
    expect(response.status).toBe(expectedStatus);
    return response;
}

/** Preview is a generated read-only operation; the existing business check still owns its limited result. */
function previewRequest(actor: Actor, state: FrontendBootstrap, token: string): Promise<DocumentResponse> {
    return actor.agent.postJson('/api/v1/profiles/migration/preview', {token}, apiReceipt(state));
}

async function previewMigration(actor: Actor, state: FrontendBootstrap, token: string) {
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

describe('shared profile workflows through versioned SPA commands and initial document entry', () => {
    it.each(['account', 'guest'] as const)('keeps warm %s admission read-only and issues only on the explicit token command', async function issuesOnlyOnCommand(kind) {
        const actor = kind === 'account' ? await accountActor() : await guestActor();
        const document = await workflowDocument(actor, 'account/delete');
        const previous = (await userService.getProfileById(actor.profileId))!.migrationToken;
        const admission = await actor.agent.get('/api/v1/profiles/workflow-entry?kind=token&returnTo=%2Fusers%2Fprofile%2Fmigrate%2Frequest',
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

            // Initial-document GET issuance is an existing side effect. A deliberate second
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
        expect((await recipient.agent.post('/users/profile/migrate/show', {token})).status).toBe(404);

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
        const response = await guest.agent.get('/users/profile/migrate/show');
        expect(response.status).toBe(302);
        expect(response.headers.get('location')).toContain('/users/login?next=');
        const guestDocument = await workflowDocument(guest, 'account/delete');
        expect((await previewRequest(guest, guestDocument.state, 'invalid-migration-token')).status).toBe(403);
        expect((await sessionOf(guest)).kind).toBe('guest');
        expect((await sessionOf(recipient)).activeProfile?.id).toBe(recipient.profileId);
    });

    it.each([
        {owner: 'guest', key: 'profile.migrationCompletedGuestDeleted', suffix: 'Previous guest account permanently deleted!'},
        {owner: 'account-deleted', key: 'profile.migrationCompletedAccountDeleted', suffix: 'Previous user account permanently deleted!'},
        {owner: 'account-retained', key: 'profile.migrationCompleted', suffix: ''},
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

        // The shared transfer commits previous-owner cleanup with its prepared
        // completion. Separate real-ORM cases exercise competing capabilities.
        const completion = JSON.parse(response.text) as components['schemas']['ProfileWorkflowCompletion'];
        expect(completion).toMatchObject({destination: '/users/profile/manage',
            resultingContext: entry.state.session.context, notice: {kind: 'success', messageKey: candidate.key}, redirect: null});
        expect(completion).not.toHaveProperty('message');
        // Retain the complete original notice, including the empty cleanup
        // suffix, through the key actually selected by the integrated command.
        expect(createTranslator('en').t(candidate.key)).toBe(`Migration successful. ${candidate.suffix}`);
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

    it('confirms transfer and required cleanup despite a later external delivery failure', async function confirmsCommittedTransfer() {
        const source = await accountActor();
        const recipient = await accountActor();
        const issued = await workflowDocument(source, 'profile/migrate/request');
        if (issued.state.profileWorkflow?.kind !== 'token') throw new Error('Expected the issued migration token.');
        const entry = await workflowDocument(recipient, 'profile/migrate/show');
        const prepare = vi.mocked(emailOwner.prepareMigrationEmail).getMockImplementation()!;
        vi.mocked(emailOwner.prepareMigrationEmail).mockImplementationOnce(function prepareFailedDelivery(...args) {
            prepare(...args);
            return {deliver: vi.fn().mockRejectedValue(new Error('Controlled external delivery failure'))};
        });
        const response = await postWorkflow(recipient, 'profile/migrate/execute', entry.state,
            {token: issued.state.profileWorkflow.token});
        expect(JSON.parse(response.text)).toMatchObject({notice: {messageKey: 'profile.migrationCompletedAccountDeleted'}});
        expect(await userService.getProfileById(source.profileId)).toMatchObject({userId: recipient.userId, migrationToken: null});
        expect(await AppDataSource.getRepository(User).findOneBy({id: source.userId!})).toBeNull();
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
                expect((await actor.agent.putJson('/api/v1/auth/profile', {profileId: sibling.id},
                    apiReceipt(document.state))).status).toBe(200);
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
            const response = await postWorkflow(actor, suffix, document.state, {[field]: value}, 400);
            expect(JSON.parse(response.text)).toMatchObject({
                code: suffix === 'profile/delete' ? 'PROFILE_DEACTIVATION_CONFIRMATION_INVALID' : 'ACCOUNT_DELETION_CONFIRMATION_INVALID',
                status: 400, params: {},
                detail: suffix === 'profile/delete'
                    ? 'Enter the active profile name exactly to confirm profile deactivation.'
                    : 'Enter your account username exactly to confirm account deletion.',
            });
            expect(response.text).not.toContain(value);
            expect(await userService.getProfileById(actor.profileId)).toMatchObject({userId: actor.userId});
            expect(await AppDataSource.getRepository(User).findOneBy({id: actor.userId!})).not.toBeNull();
        });

    it('deactivates the selected profile and chooses the existing remaining default', async function selectsRemainingDefault() {
        const actor = await accountActor();
        const sibling = await userService.createProfile(actor.userId!, 'Remaining default');
        await userService.updateProfileDefault(sibling.id, true);
        const document = await workflowDocument(actor, 'profile/delete');
        const response = await postWorkflow(actor, 'profile/delete', document.state, {name: document.state.session.activeProfile!.name});

        // Profile records remain as shared participation history. Only ownership,
        // personal default status and the active selection follow shared deletion.
        const completion = JSON.parse(response.text) as components['schemas']['ProfileWorkflowCompletion'];
        expect(contractValidator('ProfileWorkflowCompletion')(completion)).toBe(true);
        expect(completion).toMatchObject({destination: '/users/profile/manage', redirect: null,
            notice: {kind: 'success', messageKey: 'profile.deactivationCompleted'}});
        expect(completion).not.toHaveProperty('message');
        expect(completion.resultingContext).not.toBe(document.state.session.context);
        expect(createTranslator('en').t('profile.deactivationCompleted')).toBe('Profile successfully deactivated. ');
        expect(await userService.getProfileById(actor.profileId)).toMatchObject({userId: null, defaultForOwner: false});
        expect((await sessionOf(actor)).activeProfile?.id).toBe(sibling.id);
        expect(await AppDataSource.getRepository(User).findOneBy({id: actor.userId!})).not.toBeNull();
    });

    it('completes final-profile deactivation with local sign-out while preserving the detached profile', async function completesFinalProfile() {
        const actor = await accountActor();
        const document = await workflowDocument(actor, 'profile/delete');
        const response = await postWorkflow(actor, 'profile/delete', document.state,
            {name: document.state.session.activeProfile!.name});

        expect(JSON.parse(response.text)).toMatchObject({destination: '/', redirect: null,
            notice: {kind: 'success', messageKey: 'profile.deactivationCompletedAccountDeleted'}});
        expect(await AppDataSource.getRepository(User).findOneBy({id: actor.userId!})).toBeNull();
        expect(await userService.getProfileById(actor.profileId)).toMatchObject({userId: null});
        expect(mailer.sendDeletionEmail).toHaveBeenCalledOnce();
        expect((await sessionOf(actor)).kind).toBe('anonymous');
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
            expect(completion).toMatchObject({destination: '/', redirect: null,
                notice: {kind: 'success', messageKey: 'profile.accountDeleted'}});
            expect(completion).not.toHaveProperty('message');
            expect(completion.resultingContext).not.toBe(document.state.session.context);
            expect((await sessionOf(actor)).kind).toBe('anonymous');
            if (kind === 'account') expect(await AppDataSource.getRepository(User).findOneBy({id: actor.userId!})).toBeNull();
            else expect(await AppDataSource.getRepository(Guest).findOneBy({id: actor.guestId!})).toBeNull();
        });
});
