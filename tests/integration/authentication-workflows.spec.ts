import {findOrCreateUserFromOidc} from '../../src/backend/modules/identity/oidcAccounts';
import type {Request, Response} from 'express';
import type {SessionData} from 'express-session';
import {randomUUID} from 'node:crypto';
import nodemailer from 'nodemailer';
import type {Transporter} from 'nodemailer';
import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest';
import * as userController from '../../src/backend/controller/userController';
import {AppDataSource} from '../../src/backend/modules/database/dataSource';
import {User} from '../../src/backend/modules/database/entities/user/User';
import {Guest} from '../../src/backend/modules/database/entities/user/Guest';
import {Profile} from '../../src/backend/modules/database/entities/user/Profile';
import {Session} from '../../src/backend/modules/database/entities/session/Session';
import * as userService from '../../src/backend/modules/database/services/UserService';
import email from "../../src/backend/modules/email";
import * as emailOwner from '../../src/backend/modules/email';
import {createSessionStore, persistSession, readStoredSession} from '../../src/backend/modules/lib/session';
import {rotateFrontendSessionContext} from '../../src/backend/modules/lib/frontendSession';
import {captureApiActor, prepareAccountRegistrationReplies, prepareGuestIdentityReplies, prepareIdentityReply, sessionView} from '../../src/backend/modules/api/session';
import {prepareValidatedJson, sendPreparedJson} from '../../src/backend/modules/api/transport';
import type {PreparedApiJsonResponse} from '../../src/types/ApiTransportTypes';
import type {AccountRegistrationTransactionOptions, GuestRegistrationTransactionOptions, IdentityCompletionOptions} from '../../src/types/IdentityTypes';
import type {components} from '../../src/types/api/v1';
import {persistIntegrationProfile, registerLocalAccount,} from '../keywords/coreDomainKeywords';
import {closeIntegrationDatabase, initializeIntegrationDatabase} from '../support/database';

beforeAll(async () => {
    await initializeIntegrationDatabase();
});

afterAll(async () => {
    await closeIntegrationDatabase();
});

/** Construct the ordinary library Session without persisting an anonymous visitor. */
function identityRequest(): Request {
    const store = createSessionStore(AppDataSource.manager);
    const req = {sessionID: randomUUID(), sessionStore: store,
        get: function getHeader(name: string) { return name.toLowerCase() === 'x-surveyor-locale' ? 'en' : undefined; },
    } as unknown as Request;
    store.createSession(req, {cookie: {expires: new Date(Date.now() + 86_400_000), originalMaxAge: 86_400_000,
        httpOnly: true, secure: false, path: '/', sameSite: 'lax'}} as SessionData);
    return req;
}

/** Persist an existing anonymous cookie session for the established coexistence cases. */
async function atomicGuestRequest(): Promise<Request> {
    const req = identityRequest();
    rotateFrontendSessionContext(req.session);
    await persistSession(req.session);
    req.apiActor = {context: req.session.frontendContext!};
    return req;
}

/** Admit a first explicit action from the same uninitialized candidate as a cookie-free browser. */
async function initialIdentityRequest(): Promise<Request> {
    const req = identityRequest();
    await captureApiActor(req);
    return req;
}

/** Bind the same production response preparer used by the versioned route. */
function atomicGuestOptions(req: Request): GuestRegistrationTransactionOptions<PreparedApiJsonResponse> {
    function prepareResult(staged: Request['session'], personalLink: string) {
        return prepareGuestIdentityReplies(req, staged, personalLink);
    }
    return {frontend: true, next: '/', context: req.apiActor!.context, prepareResult};
}

/** Check both real related tables after a rollback, rather than mocking creation repositories. */
async function expectGuestAbsent(username: string): Promise<void> {
    expect(await AppDataSource.getRepository(Guest).countBy({username})).toBe(0);
    expect(await AppDataSource.getRepository(Profile).countBy({name: username})).toBe(0);
}

/** Signup uses the production generated reply owner while preserving this anonymous actor. */
function atomicAccountOptions(req: Request): AccountRegistrationTransactionOptions<PreparedApiJsonResponse> {
    function prepareResult() {
        return prepareAccountRegistrationReplies(req);
    }
    return {frontend: true, next: '/', context: req.apiActor!.context, prepareResult};
}

/** Keep valid credentials private to the production registration call and its real ORM fixture. */
function accountRegistrationInput(username: string) {
    return {username, displayname: username, email: `${username}@example.test`,
        password: 'initial-secret', password_repeat: 'initial-secret'};
}

/** Replace only SMTP; recipient validation and both actual activation templates still run. */
function activationDelivery(accepted: boolean) {
    const render = emailOwner.prepareActivationEmail;
    const deliver = vi.fn().mockResolvedValue(accepted);
    const prepared = vi.spyOn(emailOwner, 'prepareActivationEmail').mockImplementation(function prepareMail(recipient, link) {
        render(recipient, link);
        return {deliver};
    });
    return {prepared, deliver};
}

/** Use the actual activation contract before token consumption and optional document persistence. */
function activationOptions(req: Request, persistCompletion = false): IdentityCompletionOptions<PreparedApiJsonResponse> {
    function prepareResult() {
        return prepareValidatedJson(req, 'activateIdentity', 200, {changed: true});
    }
    return {context: req.apiActor!.context, persistCompletion, prepareResult};
}

type OrdinaryIdentityKind = 'account' | 'guest' | 'profile';

/** Actual owned identity records drive the three production completion adapters; repositories are never mocked. */
async function ordinaryIdentityFixture(kind: OrdinaryIdentityKind) {
    const req = await atomicGuestRequest();
    let username = '';
    let guestId = '';
    let guestToken = '';
    let profileId = '';
    if (kind === 'guest') {
        const guest = await userService.createGuest(`Existing guest ${randomUUID().slice(0, 8)}`);
        guestId = guest.id;
        guestToken = guest.token;
    } else {
        const account = await registerLocalAccount(`ordinary-${kind}`);
        username = account.username;
        await userService.activateUser(account.id);
        if (kind === 'profile') {
            const user = await userService.getUserById(account.id);
            const second = await AppDataSource.getRepository(Profile).save({name: 'Second owned profile',
                defaultForOwner: false, user: user!});
            const current = await userService.getUserById(account.id);
            req.session.auth = {user: current!};
            req.session.profile = userController.getDefaultProfile(current!.profiles);
            await persistSession(req.session);
            req.apiActor = {context: req.session.frontendContext!, auth: req.session.auth, profile: req.session.profile};
            profileId = second.id;
        }
    }
    const operation: Parameters<typeof prepareIdentityReply>[2] = kind === 'account' ? 'loginIdentity'
        : kind === 'guest' ? 'loginGuestIdentity' : 'switchIdentityProfile';
    function prepareResult(staged: Request['session']) {
        return prepareIdentityReply(req, staged, operation);
    }
    const options: IdentityCompletionOptions<PreparedApiJsonResponse> = {context: req.apiActor!.context, prepareResult};
    function run(selected = options) {
        if (kind === 'account') return userController.loginUserWithSession({username, password: 'initial-secret'}, req, selected);
        if (kind === 'guest') return userController.loginGuestWithSession(guestId, guestToken, req, selected);
        return userController.changeActiveProfileWithSession(profileId, req, selected);
    }
    return {req, options, run, operation};
}

/** Begin logout from real persisted account/guest authority with the normal writable store session. */
async function ordinaryLogoutFixture(kind: Exclude<OrdinaryIdentityKind, 'profile'>) {
    const {req, run} = await ordinaryIdentityFixture(kind);
    await run();
    const stored = await readStoredSession(req.sessionStore, req.sessionID);
    req.sessionStore.createSession(req, stored!);
    req.session.frontendAuthReturn = '/packing/return-after-login';
    await persistSession(req.session);
    req.apiActor = {context: req.session.frontendContext!, auth: req.session.auth, profile: req.session.profile};

    function prepareResult(staged: Request['session']) {
        return prepareIdentityReply(req, staged, 'logoutIdentity');
    }
    const options: IdentityCompletionOptions<PreparedApiJsonResponse> = {context: req.apiActor.context, prepareResult};
    return {req, options};
}

/** Capture only HTTP delivery; the production generated API preparer owns validation and serialization. */
function preparedResponse() {
    const headers = new Map<string, string>();
    let body: string | null = null;
    let statusCode: number | null = null;
    const res = {
        set: function setHeader(name: string, value: string) { headers.set(name, value); return res; },
        type: function setType(value: string) { headers.set('Content-Type', value); return res; },
        status: function setStatus(value: number) { statusCode = value; return res; },
        vary: function varyHeader(_name: string) { return res; },
        send: function sendBody(value: string) { body = value; return res; },
    } as unknown as Response;
    return {res, headers, get body() { return body; }, get statusCode() { return statusCode; }};
}

/** Persist malformed server evidence to exercise retirement before any principal lookup.
 * The real session row/store, rather than a substituted repository, owns this fixture. */
async function invalidAdmissionRequest(): Promise<Request> {
    const req = await atomicGuestRequest();
    const stored = JSON.parse(JSON.stringify(req.session)) as SessionData;
    stored.auth = {user: {id: -1} as User, guest: {id: randomUUID()} as Guest};
    stored.tokens = {access_token: 'stored-access-evidence', token_type: 'bearer', id_token: 'stored-provider-evidence'};
    req.sessionStore.createSession(req, stored);
    await persistSession(req.session);
    req.apiActor = undefined;
    return req;
}

describe('read-only frontend session admission', () => {
    it('projects a cookie-free anonymous visit without creating or mutating its server session', async () => {
        const req = identityRequest();
        const original = req.session;
        const before = JSON.stringify(original);

        const view = await sessionView(req);
        expect(view).toMatchObject({kind: 'anonymous', context: null, csrfToken: null});
        expect(req.session).toBe(original);
        expect(JSON.stringify(original)).toBe(before);
        expect(req.apiSessionStored).toBe(false);
        expect(await AppDataSource.getRepository(Session).findOneBy({id: req.sessionID})).toBeNull();
    });

    it.each(['account', 'guest'] as const)('projects a valid legacy %s without persisting metadata or changing its Session', async kind => {
        const {req, run} = await ordinaryIdentityFixture(kind);
        await run();
        const stored = await readStoredSession(req.sessionStore, req.sessionID);
        req.sessionStore.createSession(req, stored!);
        delete req.session.frontendContext;
        delete req.session.frontendCsrfToken;
        await persistSession(req.session);
        req.apiActor = undefined;
        const original = req.session;
        const originalJson = JSON.stringify(original);
        const before = await AppDataSource.getRepository(Session).findOneByOrFail({id: req.sessionID});

        const view = await sessionView(req);
        expect(view.kind).toBe(kind);
        expect(view.context).toBeTruthy();
        expect(view.csrfToken).toBeTruthy();
        expect(view.csrfToken).not.toBe(view.context);
        expect(JSON.stringify(view)).not.toContain(req.sessionID);
        expect(req.session).toBe(original);
        expect(JSON.stringify(original)).toBe(originalJson);
        req.apiActor = undefined;
        expect((await sessionView(req)).context).toBe(view.context);
        const after = await AppDataSource.getRepository(Session).findOneByOrFail({id: req.sessionID});
        expect(after.json).toBe(before.json);
        expect(after.expiredAt).toBe(before.expiredAt);

        // The same server principal/profile in another real session cannot
        // reuse this session's derived context or CSRF proof.
        const other = identityRequest();
        other.sessionStore.createSession(other, JSON.parse(originalJson) as SessionData);
        await persistSession(other.session);
        const otherView = await sessionView(other);
        expect(otherView.context).not.toBe(view.context);
        expect(otherView.csrfToken).not.toBe(view.csrfToken);
        expect(other.session.frontendContext).toBeUndefined();
        expect(other.session.frontendCsrfToken).toBeUndefined();
    });

    it.each(['account', 'guest'] as const)('retains the admitted partial-legacy %s scope in actor-preserving prepared receipts', async kind => {
        const {req, run} = await ordinaryIdentityFixture(kind);
        await run();
        const stored = await readStoredSession(req.sessionStore, req.sessionID);
        req.sessionStore.createSession(req, stored!);
        // Keep a real stored context while removing only CSRF. This forces the
        // read-only fallback to differ from the raw partial generation; missing
        // both fields would accidentally exercise a default-argument shortcut.
        delete req.session.frontendCsrfToken;
        await persistSession(req.session);
        req.apiActor = undefined;
        const original = req.session;
        const originalJson = JSON.stringify(original);
        const actor = await captureApiActor(req);
        expect(actor.context).toBeTruthy();
        expect(actor.context).not.toBe(original.frontendContext);
        const before = await AppDataSource.getRepository(Session).findOneByOrFail({id: req.sessionID});

        // Signup and activation use the actual locked transaction, generated
        // response preparation and mail renderer. Only SMTP delivery is replaced.
        const username = `partial-legacy-${kind}-${randomUUID().slice(0, 8)}`;
        const {prepared} = activationDelivery(true);
        try {
            const signup = await userController.registerUserWithSession(accountRegistrationInput(username), req, atomicAccountOptions(req));
            expect(signup.result.context).toBe(actor.context);
            const account = await AppDataSource.getRepository(User).findOneByOrFail({username});
            const activation = await userController.activateAccountWithSession(account.activationToken!, req, activationOptions(req));
            expect(activation.result.context).toBe(actor.context);
            const response = preparedResponse();
            sendPreparedJson(req, response.res, activation.result);
            expect(response.headers.get('X-Surveyor-Context')).toBe(actor.context);
            expect(await userService.verifyActivationToken(account.activationToken!)).toBeNull();

            // Neither unchanged-actor operation installs staging, repairs the
            // partial Session or writes its row merely to deliver confirmation.
            const after = await AppDataSource.getRepository(Session).findOneByOrFail({id: req.sessionID});
            expect(after.json).toBe(before.json);
            expect(after.expiredAt).toBe(before.expiredAt);
            expect(req.session).toBe(original);
            expect(JSON.stringify(original)).toBe(originalJson);
        } finally { prepared.mockRestore(); }
    });

    it('rejects malformed stored authority without clearing provider evidence or writing on admission', async () => {
        const req = await invalidAdmissionRequest();
        const original = req.session;
        const before = await AppDataSource.getRepository(Session).findOneByOrFail({id: req.sessionID});

        await expect(captureApiActor(req)).rejects.toMatchObject({code: 'AUTH_REQUIRED'});
        const after = await AppDataSource.getRepository(Session).findOneByOrFail({id: req.sessionID});
        expect(after.json).toBe(before.json);
        expect(after.expiredAt).toBe(before.expiredAt);
        expect(req.session).toBe(original);
        expect(original.tokens?.id_token).toBe('stored-provider-evidence');
    });

    it('rejects a changed stored generation without installing it into the middleware Session', async () => {
        const req = await atomicGuestRequest();
        req.apiActor = undefined;
        const original = req.session;
        const current = JSON.parse(JSON.stringify(original)) as SessionData;
        current.frontendContext = 'later-server-context';
        current.frontendCsrfToken = 'later-server-csrf';
        await AppDataSource.getRepository(Session).update({id: req.sessionID}, {json: JSON.stringify(current)});

        await expect(captureApiActor(req)).rejects.toMatchObject({code: 'SESSION_CONTEXT_CHANGED'});
        expect(req.session).toBe(original);
        expect(original.frontendContext).not.toBe(current.frontendContext);
        expect(await readStoredSession(req.sessionStore, req.sessionID)).toMatchObject({
            frontendContext: current.frontendContext, frontendCsrfToken: current.frontendCsrfToken,
        });
    });

    it('retains stored authority when its actual admission store read fails', async () => {
        const req = await invalidAdmissionRequest();
        const before = await AppDataSource.getRepository(Session).findOneByOrFail({id: req.sessionID});
        const failure = new Error('Controlled session-store read failure');
        const failedRead = vi.spyOn(req.sessionStore, 'get').mockImplementationOnce(function rejectRead(_id, callback) {
            callback(failure);
        });
        try {
            await expect(captureApiActor(req)).rejects.toBe(failure);
            const after = await AppDataSource.getRepository(Session).findOneByOrFail({id: req.sessionID});
            expect(after.json).toBe(before.json);
            expect(after.expiredAt).toBe(before.expiredAt);
        } finally { failedRead.mockRestore(); }
    });

    it('does not reinterpret a recognized metadata-less record as a first session after it disappears', async () => {
        const req = identityRequest();
        await persistSession(req.session);
        Object.assign(req, {headers: {cookie: 'existing-server-cookie'}});
        await captureApiActor(req);
        expect(req.apiSessionStored).toBe(true);
        expect(req.apiActor?.context).toBeNull();
        await AppDataSource.getRepository(Session).delete({id: req.sessionID});
        const username = `Retired legacy anonymous ${randomUUID().slice(0, 8)}`;

        await expect(userController.registerGuestWithSession(username, undefined, req, atomicGuestOptions(req)))
            .rejects.toMatchObject({code: 'SESSION_CONTEXT_CHANGED'});
        await expectGuestAbsent(username);
        expect(await AppDataSource.getRepository(Session).findOneBy({id: req.sessionID})).toBeNull();
    });
});
describe('atomic versioned guest registration', () => {
    it('creates the first guest, profile, completed session and receipt in one transaction', async () => {
        const req = await initialIdentityRequest();
        const original = req.session;
        const before = JSON.stringify(original);
        const username = `First guest ${randomUUID().slice(0, 8)}`;
        expect(await readStoredSession(req.sessionStore, req.sessionID)).toBeUndefined();

        const committed = await userController.registerGuestWithSession(username, undefined, req, atomicGuestOptions(req));
        const reply = JSON.parse(committed.result.json) as components['schemas']['IdentityResult'];
        const stored = await readStoredSession(req.sessionStore, req.sessionID);
        expect(stored?.auth.guest?.username).toBe(username);
        expect(stored?.profile?.name).toBe(username);
        expect(reply.session).toMatchObject({kind: 'guest', context: stored!.frontendContext,
            csrfToken: stored!.frontendCsrfToken, activeProfile: {id: stored!.profile!.id}});
        expect(req.session).toBe(original);
        expect(JSON.stringify(original)).toBe(before);
        expect(committed.session).not.toBe(original);
    });

    it('leaves no anonymous row or identity rows when first guest result preparation fails', async () => {
        const req = await initialIdentityRequest();
        const username = `Rejected first guest ${randomUUID().slice(0, 8)}`;
        const failure = new Error('Controlled first completion failure');
        const options = atomicGuestOptions(req);
        function rejectPreparedResult(): never { throw failure; }
        options.prepareResult = rejectPreparedResult;

        await expect(userController.registerGuestWithSession(username, undefined, req, options)).rejects.toBe(failure);
        await expectGuestAbsent(username);
        expect(await readStoredSession(req.sessionStore, req.sessionID)).toBeUndefined();
        expect(req.session.auth).toBeUndefined();
        expect(req.session.frontendContext).toBeUndefined();
    });

    it('commits guest, profile and stored identity together with a prevalidated private receipt', async () => {
        const req = await atomicGuestRequest();
        const original = req.session;
        const context = original.frontendContext;
        const username = `Atomic ${randomUUID().slice(0, 8)}`;
        const committed = await userController.registerGuestWithSession(username, undefined, req, atomicGuestOptions(req));
        const reply = JSON.parse(committed.result.json) as components['schemas']['IdentityResult'];
        const stored = await readStoredSession(req.sessionStore, req.sessionID);

        expect(req.session).toBe(original);
        expect(req.session.auth).toBeUndefined();
        expect(stored?.frontendContext).not.toBe(context);
        expect(reply).toMatchObject({emailDelivery: 'not-requested', session: {kind: 'guest', context: stored!.frontendContext,
            activeProfile: {id: stored!.profile!.id, name: username}}});
        expect(committed.result.context).toBe(reply.session.context);
        expect(await userService.getGuestInternal(stored!.auth.guest!.id)).toMatchObject({username, profile: {id: stored!.profile!.id}});
        expect(reply.personalLink).toContain(`/guest/${stored!.auth.guest!.id}/login/`);
        expect(committed.result.json).not.toContain('"token"');
    });

    it('rolls back both new rows when output validation rejects before session persistence', async () => {
        const req = await atomicGuestRequest();
        const original = JSON.stringify(req.session);
        const username = `Invalid receipt ${randomUUID().slice(0, 8)}`;
        const options = atomicGuestOptions(req);
        function prepareInvalidResult(staged: Request['session'], personalLink: string) {
            staged.frontendCsrfToken = '';
            return prepareGuestIdentityReplies(req, staged, personalLink);
        }
        options.prepareResult = prepareInvalidResult;

        await expect(userController.registerGuestWithSession(username, undefined, req, options))
            .rejects.toMatchObject({code: 'INTERNAL_ERROR'});
        await expectGuestAbsent(username);
        expect(JSON.stringify(req.session)).toBe(original);
        expect((await readStoredSession(req.sessionStore, req.sessionID))?.frontendContext).toBe(req.apiActor!.context);
    });

    it('rolls back guest and profile when the configured store cannot serialize the staged session', async () => {
        const req = await atomicGuestRequest();
        const original = JSON.stringify(req.session);
        const username = `Invalid stored ${randomUUID().slice(0, 8)}`;
        const options = atomicGuestOptions(req);
        function prepareUnserializableSession(staged: Request['session'], personalLink: string) {
            const replies = prepareGuestIdentityReplies(req, staged, personalLink);
            // The actual store's JSON writer rejects this cycle after the valid
            // wire replies exist, exercising rollback at persistence preparation.
            Object.defineProperty(staged, 'serializationCycle', {value: staged, enumerable: true});
            return replies;
        }
        options.prepareResult = prepareUnserializableSession;

        await expect(userController.registerGuestWithSession(username, undefined, req, options)).rejects.toBeInstanceOf(TypeError);
        await expectGuestAbsent(username);
        expect(JSON.stringify(req.session)).toBe(original);
        expect((await readStoredSession(req.sessionStore, req.sessionID))?.frontendContext).toBe(req.apiActor!.context);
    });

    it.each(['stale', 'expired', 'destroyed', 'missing', 'malformed'] as const)('rejects %s stored admission without creating an identity', async condition => {
        const req = await atomicGuestRequest();
        const username = `Rejected ${condition} ${randomUUID().slice(0, 8)}`;
        const repo = AppDataSource.getRepository(Session);
        if (condition === 'stale') {
            const changed = {...JSON.parse(JSON.stringify(req.session)), frontendContext: 'another-context'};
            await repo.update({id: req.sessionID}, {json: JSON.stringify(changed)});
        } else if (condition === 'expired') await repo.update({id: req.sessionID}, {expiredAt: Date.now() - 1});
        else if (condition === 'destroyed') await repo.softDelete({id: req.sessionID});
        else if (condition === 'missing') await repo.delete({id: req.sessionID});
        else await repo.update({id: req.sessionID}, {json: '{malformed'});

        const operation = userController.registerGuestWithSession(username, undefined, req, atomicGuestOptions(req));
        if (condition === 'malformed') await expect(operation).rejects.toBeInstanceOf(SyntaxError);
        else await expect(operation).rejects.toMatchObject({code: 'SESSION_CONTEXT_CHANGED'});
        await expectGuestAbsent(username);
        expect(req.session.auth).toBeUndefined();
        expect(req.session.frontendContext).toBe(req.apiActor!.context);
    });

    it('retains the committed guest receipt and never resaves over a later session actor', async () => {
        const req = await atomicGuestRequest();
        const username = `Final commit ${randomUUID().slice(0, 8)}`;
        const committed = await userController.registerGuestWithSession(username, undefined, req, atomicGuestOptions(req));
        const completed = JSON.parse(committed.result.json) as components['schemas']['IdentityResult'];
        const later = {...JSON.parse(JSON.stringify(req.session)), frontendContext: 'later-actor-context'};
        await AppDataSource.getRepository(Session).update({id: req.sessionID}, {json: JSON.stringify(later)});

        // The adapter adopts this exact receipt only after commit. Express uses
        // its nonenumerable save acknowledgement rather than a second DB write.
        req.session = committed.session;
        await persistSession(req.session);
        expect(Object.keys(req.session)).not.toContain('save');
        expect((await readStoredSession(req.sessionStore, req.sessionID))?.frontendContext).toBe('later-actor-context');
        expect(completed.session.context).not.toBe('later-actor-context');
        expect(await AppDataSource.getRepository(Guest).countBy({username})).toBe(1);
    });

    it('serializes a later identity write behind guest creation until its atomic commit', async () => {
        const req = await atomicGuestRequest();
        const username = `Locked identity ${randomUUID().slice(0, 8)}`;
        const options = atomicGuestOptions(req);
        let enterPreparation!: () => void;
        let releasePreparation!: () => void;
        const entered = new Promise<void>(function captureEntry(resolve) { enterPreparation = resolve; });
        const released = new Promise<void>(function captureRelease(resolve) { releasePreparation = resolve; });
        async function prepareUnderLock(staged: Request['session'], personalLink: string) {
            const results = prepareGuestIdentityReplies(req, staged, personalLink);
            enterPreparation();
            await released;
            return results;
        }
        options.prepareResult = prepareUnderLock;

        const registering = userController.registerGuestWithSession(username, undefined, req, options);
        await entered;
        const writer = AppDataSource.createQueryRunner();
        try {
            await writer.connect();
            await writer.startTransaction();
            const later = {...JSON.parse(JSON.stringify(req.session)), frontendContext: 'queued-later-context'};
            const changing = writer.manager.update(Session, {id: req.sessionID}, {json: JSON.stringify(later)});

            // This real second transaction targets the row still locked by
            // registration. Release output preparation so creation can commit.
            releasePreparation();
            const committed = await registering;
            await changing;
            await writer.commitTransaction();
            expect(JSON.parse(committed.result.json).session.kind).toBe('guest');
            expect((await readStoredSession(req.sessionStore, req.sessionID))?.frontendContext).toBe('queued-later-context');
            expect(await AppDataSource.getRepository(Guest).countBy({username})).toBe(1);
        } finally {
            releasePreparation();
            if (writer.isTransactionActive) await writer.rollbackTransaction();
            await writer.release();
        }
    });

    it('rolls back before commit when the actual guest-mail renderer rejects its recipient', async () => {
        const req = await atomicGuestRequest();
        const username = '  \r\n  ';
        await expect(userController.registerGuestWithSession(username, 'invalid-recipient@example.test', req, atomicGuestOptions(req)))
            .rejects.toThrow('recipients require a name');
        await expectGuestAbsent(username);
        expect(req.session.auth).toBeUndefined();
        expect((await readStoredSession(req.sessionStore, req.sessionID))?.frontendContext).toBe(req.apiActor!.context);
    });

    it.each([true, false])('keeps committed creation when prepared SMTP acceptance is %s', async accepted => {
        const req = await atomicGuestRequest();
        const username = `Mail receipt ${randomUUID().slice(0, 8)}`;
        const render = emailOwner.prepareGuestLinkEmail;
        const deliver = vi.fn().mockResolvedValue(accepted);
        const prepared = vi.spyOn(emailOwner, 'prepareGuestLinkEmail').mockImplementation(function prepareMail(recipient, link) {
            // Keep actual recipient/template preparation; replace only the opaque
            // external SMTP delivery boundary after the transaction has committed.
            render(recipient, link);
            return {deliver};
        });
        try {
            const committed = await userController.registerGuestWithSession(username, 'atomic-guest@example.test', req, atomicGuestOptions(req));
            const result = JSON.parse(committed.result.json) as components['schemas']['IdentityResult'];
            expect(result.emailDelivery).toBe(accepted ? 'sent' : 'failed');
            expect(result.personalLink).toBeTruthy();
            expect(result.session.kind).toBe('guest');
            expect(await AppDataSource.getRepository(Guest).countBy({username})).toBe(1);
            expect(deliver).toHaveBeenCalledOnce();
            expect(prepared).toHaveBeenCalledOnce();
        } finally { prepared.mockRestore(); }
    });
});

describe('atomic versioned account registration', () => {
    it('commits first account signup without initializing or persisting an anonymous session', async () => {
        const req = await initialIdentityRequest();
        const original = JSON.stringify(req.session);
        const username = `first-account-${randomUUID().slice(0, 8)}`;
        const {prepared, deliver} = activationDelivery(true);
        try {
            const committed = await userController.registerUserWithSession(accountRegistrationInput(username), req, atomicAccountOptions(req));
            expect(JSON.parse(committed.result.json)).toEqual({changed: true, emailDelivery: 'sent'});
            const account = await AppDataSource.getRepository(User).findOneOrFail({where: {username}, relations: {profiles: true}});
            expect(account.profiles).toHaveLength(1);
            expect(account.activationToken).toBeTruthy();
            expect(await readStoredSession(req.sessionStore, req.sessionID)).toBeUndefined();
            expect(JSON.stringify(req.session)).toBe(original);
            expect(committed.result.context).toBeUndefined();
            expect(deliver).toHaveBeenCalledOnce();
        } finally { prepared.mockRestore(); }
    });

    it.each([true, false])('commits account/profile/activation together and reports SMTP acceptance %s without changing actor', async accepted => {
        const req = await atomicGuestRequest();
        const original = req.session;
        const originalJson = JSON.stringify(original);
        const username = `atomic-account-${randomUUID().slice(0, 8)}`;
        const {prepared, deliver} = activationDelivery(accepted);
        try {
            const committed = await userController.registerUserWithSession(accountRegistrationInput(username), req, atomicAccountOptions(req));
            const result = JSON.parse(committed.result.json) as components['schemas']['RegistrationResult'];
            const account = await AppDataSource.getRepository(User).findOneOrFail({where: {username}, relations: {profiles: true}});
            // This established tinyint column hydrates as 0/1 in the MariaDB
            // driver; test its business meaning without changing native metadata.
            expect(Boolean(account.isActive)).toBe(false);
            expect(account).toMatchObject({profiles: [{name: username, defaultForOwner: true}]});
            expect(account.activationToken).toBeTruthy();
            expect(account.activationTokenExpiration!.getTime()).toBeGreaterThan(Date.now());
            expect(result).toEqual({changed: true, emailDelivery: accepted ? 'sent' : 'failed'});
            expect(committed.result.context).toBe(req.apiActor!.context);
            expect(committed.result.json).not.toContain(account.activationToken!);
            expect(committed.result.json).not.toContain('activationToken');
            expect(req.session).toBe(original);
            expect(JSON.stringify(req.session)).toBe(originalJson);
            expect((await readStoredSession(req.sessionStore, req.sessionID))?.frontendContext).toBe(req.apiActor!.context);
            expect(deliver).toHaveBeenCalledOnce();
            expect(prepared).toHaveBeenCalledOnce();
        } finally { prepared.mockRestore(); }
    });

    it('rolls back account, default profile and activation token when its generated completion is invalid', async () => {
        const req = await atomicGuestRequest();
        const originalJson = JSON.stringify(req.session);
        const username = `invalid-account-${randomUUID().slice(0, 8)}`;
        const {prepared, deliver} = activationDelivery(true);
        const options = atomicAccountOptions(req);
        function prepareInvalidResult() {
            // Exercise the production generated validator after record/token
            // preparation, without substituting DBAL or transaction behavior.
            const replies = prepareAccountRegistrationReplies(req);
            const malformed = {changed: 'yes'} as unknown as components['schemas']['RegistrationResult'];
            const invalid = prepareValidatedJson(req, 'registerAccount', 200, malformed);
            return {...replies, sent: invalid};
        }
        options.prepareResult = prepareInvalidResult;
        try {
            await expect(userController.registerUserWithSession(accountRegistrationInput(username), req, options))
                .rejects.toMatchObject({code: 'INTERNAL_ERROR'});
            expect(await AppDataSource.getRepository(User).countBy({username})).toBe(0);
            expect(await AppDataSource.getRepository(Profile).countBy({name: username})).toBe(0);
            expect(JSON.stringify(req.session)).toBe(originalJson);
            expect((await readStoredSession(req.sessionStore, req.sessionID))?.frontendContext).toBe(req.apiActor!.context);
            expect(deliver).not.toHaveBeenCalled();
        } finally { prepared.mockRestore(); }
    });

    it('rolls back the prepared account and token when the actual activation renderer rejects its recipient', async () => {
        const req = await atomicGuestRequest();
        const username = `invalid-mail-${randomUUID().slice(0, 8)}`;
        const input = {...accountRegistrationInput(username), email: '   '};
        await expect(userController.registerUserWithSession(input, req, atomicAccountOptions(req)))
            .rejects.toThrow('recipients require a name and an address');
        expect(await AppDataSource.getRepository(User).countBy({username})).toBe(0);
        expect(await AppDataSource.getRepository(Profile).countBy({name: username})).toBe(0);
        expect(req.session.auth).toBeUndefined();
    });

    it('rejects a later stored actor before allocating an account or preparing activation mail', async () => {
        const req = await atomicGuestRequest();
        const username = `stale-account-${randomUUID().slice(0, 8)}`;
        const later = {...JSON.parse(JSON.stringify(req.session)), frontendContext: 'later-account-context'};
        await AppDataSource.getRepository(Session).update({id: req.sessionID}, {json: JSON.stringify(later)});
        const {prepared, deliver} = activationDelivery(true);
        try {
            await expect(userController.registerUserWithSession(accountRegistrationInput(username), req, atomicAccountOptions(req)))
                .rejects.toMatchObject({code: 'SESSION_CONTEXT_CHANGED'});
            expect(await AppDataSource.getRepository(User).countBy({username})).toBe(0);
            expect(await AppDataSource.getRepository(Profile).countBy({name: username})).toBe(0);
            expect(prepared).not.toHaveBeenCalled();
            expect(deliver).not.toHaveBeenCalled();
        } finally { prepared.mockRestore(); }
    });
});

describe('atomic frontend activation completion', () => {
    it('consumes its token with a prevalidated receipt and staged document feedback without a later session save', async () => {
        const {id} = await registerLocalAccount('atomic-activation');
        const token = await userService.generateActivationToken(id);
        const req = await atomicGuestRequest();
        const original = req.session;
        const options = activationOptions(req, true);
        function prepareDocumentCompletion(staged: Request['session']) {
            // The document adapter writes this same connect-flash shape only on
            // isolated staging; private activation tokens never enter feedback.
            Object.defineProperty(staged, 'flash', {value: {'frontend': ['auth.activated']}, enumerable: true});
            return prepareValidatedJson(req, 'activateIdentity', 200, {changed: true});
        }
        options.prepareResult = prepareDocumentCompletion;
        const committed = await userController.activateAccountWithSession(token, req, options);
        expect(JSON.parse(committed.result.json)).toEqual({changed: true});
        expect(committed.result.json).not.toContain(token);
        expect(req.session).toBe(original);
        expect(JSON.stringify(original)).not.toContain('auth.activated');
        const user = await AppDataSource.getRepository(User).findOneByOrFail({id});
        expect(Boolean(user.isActive)).toBe(true);
        expect(user).toMatchObject({activationToken: null, activationTokenExpiration: null});
        expect(JSON.stringify(await readStoredSession(req.sessionStore, req.sessionID))).toContain('auth.activated');

        // A later actor remains authoritative even when Express acknowledges this
        // older completed document response after the activation transaction.
        const later = {...JSON.parse(JSON.stringify(original)), frontendContext: 'later-activation-actor'};
        await AppDataSource.getRepository(Session).update({id: req.sessionID}, {json: JSON.stringify(later)});
        req.session = committed.session;
        await persistSession(req.session);
        expect((await readStoredSession(req.sessionStore, req.sessionID))?.frontendContext).toBe('later-activation-actor');
    });

    it('retains the usable activation token when staged document serialization fails', async () => {
        const {id} = await registerLocalAccount('rolled-back-activation');
        const token = await userService.generateActivationToken(id);
        const req = await atomicGuestRequest();
        const originalJson = JSON.stringify(req.session);
        const options = activationOptions(req, true);
        function prepareUnserializableCompletion(staged: Request['session']) {
            const reply = prepareValidatedJson(req, 'activateIdentity', 200, {changed: true});
            Object.defineProperty(staged, 'serializationCycle', {value: staged, enumerable: true});
            return reply;
        }
        options.prepareResult = prepareUnserializableCompletion;
        await expect(userController.activateAccountWithSession(token, req, options)).rejects.toBeInstanceOf(TypeError);
        const retained = await userService.verifyActivationToken(token);
        expect(retained?.id).toBe(id);
        expect(Boolean(retained?.isActive)).toBe(false);
        expect(JSON.stringify(req.session)).toBe(originalJson);
        expect((await readStoredSession(req.sessionStore, req.sessionID))?.frontendContext).toBe(req.apiActor!.context);
    });

    it('allows only one activation when two independently admitted sessions consume the same token', async () => {
        const {id} = await registerLocalAccount('concurrent-activation');
        const token = await userService.generateActivationToken(id);
        const first = await atomicGuestRequest();
        const second = await atomicGuestRequest();
        const outcomes = await Promise.allSettled([
            userController.activateAccountWithSession(token, first, activationOptions(first)),
            userController.activateAccountWithSession(token, second, activationOptions(second)),
        ]);
        const confirmed = outcomes.filter(result => result.status === 'fulfilled');
        const rejected = outcomes.find(result => result.status === 'rejected');
        expect(confirmed).toHaveLength(1);
        expect(rejected?.status === 'rejected' && rejected.reason).toMatchObject({cause: 'TOKEN_INVALID'});
        expect(await userService.verifyActivationToken(token)).toBeNull();
        expect(Boolean((await AppDataSource.getRepository(User).findOneByOrFail({id})).isActive)).toBe(true);
        expect(first.session.auth).toBeUndefined();
        expect(second.session.auth).toBeUndefined();
    });
});

describe('atomic ordinary frontend identity completion', () => {
    it('creates its first account session only after credentials and prepared identity completion succeed', async () => {
        const account = await registerLocalAccount('first-account-login');
        await userService.activateUser(account.id);
        const req = await initialIdentityRequest();
        const original = JSON.stringify(req.session);
        function prepareResult(staged: Request['session']) {
            return prepareIdentityReply(req, staged, 'loginIdentity');
        }
        const options: IdentityCompletionOptions<PreparedApiJsonResponse> = {context: null, prepareResult};

        // A rejected explicit action must not leave an anonymous bootstrap row.
        await expect(userController.loginUserWithSession({username: account.username, password: 'incorrect'}, req, options)).rejects.toBeDefined();
        expect(await readStoredSession(req.sessionStore, req.sessionID)).toBeUndefined();
        expect(JSON.stringify(req.session)).toBe(original);

        const committed = await userController.loginUserWithSession({username: account.username, password: 'initial-secret'}, req, options);
        const stored = await readStoredSession(req.sessionStore, req.sessionID);
        expect(stored?.auth.user?.id).toBe(account.id);
        expect(JSON.parse(committed.result.json).session).toMatchObject({kind: 'account',
            context: stored!.frontendContext, csrfToken: stored!.frontendCsrfToken});
        expect(JSON.stringify(req.session)).toBe(original);
    });

    it('accepts a validated legacy context under the lock and rotates ordinary stored metadata on profile selection', async () => {
        const {req, run, options} = await ordinaryIdentityFixture('profile');
        delete req.session.frontendContext;
        delete req.session.frontendCsrfToken;
        await persistSession(req.session);
        req.apiActor = undefined;
        const actor = await captureApiActor(req);
        expect(actor.context).toBeTruthy();
        expect(req.session.frontendContext).toBeUndefined();

        const committed = await run({...options, context: actor.context});
        const stored = await readStoredSession(req.sessionStore, req.sessionID);
        expect(stored?.frontendContext).toBeTruthy();
        expect(stored?.frontendContext).not.toBe(actor.context);
        expect(JSON.parse(committed.result.json).session.context).toBe(stored!.frontendContext);
        expect(req.session.frontendContext).toBeUndefined();
    });

    it.each(['account', 'guest', 'profile'] as const)('rolls back %s authority when its generated completion rejects after inner deferred save', async kind => {
        const {req, options, run, operation} = await ordinaryIdentityFixture(kind);
        const original = req.session;
        const originalJson = JSON.stringify(original);
        function rejectGeneratedCompletion(staged: Request['session']) {
            // Existing controller logic has already called persistSession on
            // isolated staging. That inner save must not write before validation.
            staged.frontendCsrfToken = '';
            return prepareIdentityReply(req, staged, operation);
        }
        options.prepareResult = rejectGeneratedCompletion;
        await expect(run()).rejects.toMatchObject({code: 'INTERNAL_ERROR'});
        expect(req.session).toBe(original);
        expect(JSON.stringify(req.session)).toBe(originalJson);
        const stored = await readStoredSession(req.sessionStore, req.sessionID);
        expect(stored?.frontendContext).toBe(original.frontendContext);
        expect(stored?.profile?.id).toBe(original.profile?.id);
        expect(stored?.auth?.user?.id).toBe(original.auth?.user?.id);
        expect(stored?.auth?.guest?.id).toBe(original.auth?.guest?.id);
    });

    it.each(['account', 'guest', 'profile'] as const)('returns prepared %s confirmation without overwriting a later actor', async kind => {
        const {req, run} = await ordinaryIdentityFixture(kind);
        const original = req.session;
        const committed = await run();
        const reply = JSON.parse(committed.result.json) as components['schemas']['IdentityResult'];
        expect(reply).toMatchObject({session: {kind: kind === 'guest' ? 'guest' : 'account'}, personalLink: null, redirect: null});
        expect(reply.session.context).not.toBe(original.frontendContext);
        expect(committed.result.context).toBe(reply.session.context);
        expect(req.session).toBe(original);
        expect((await readStoredSession(req.sessionStore, req.sessionID))?.frontendContext).toBe(reply.session.context);

        const later = {...JSON.parse(JSON.stringify(original)), frontendContext: `later-${kind}-actor`};
        await AppDataSource.getRepository(Session).update({id: req.sessionID}, {json: JSON.stringify(later)});
        req.session = committed.session;
        await persistSession(req.session);
        expect((await readStoredSession(req.sessionStore, req.sessionID))?.frontendContext).toBe(`later-${kind}-actor`);
        expect(JSON.parse(committed.result.json).session.context).toBe(reply.session.context);
    });

    it('preserves inactive-login activation resend before rejection without rolling its token back or mutating authority', async () => {
        const account = await registerLocalAccount('ordinary-inactive');
        const req = await atomicGuestRequest();
        const originalJson = JSON.stringify(req.session);
        const prepareResult = vi.fn();
        const sent = vi.spyOn(email, 'sendActivationEmail').mockImplementation(async function acceptPreparedNativeMail(recipient, link) {
            // Keep actual template/recipient preparation; suppress only external
            // delivery so this known native rejection sends no real email.
            emailOwner.prepareActivationEmail(recipient, link);
        });
        try {
            await expect(userController.loginUserWithSession({username: account.username, password: 'initial-secret'}, req,
                {frontend: true, context: req.apiActor!.context, prepareResult})).rejects.toMatchObject({cause: 'ACTIVATION_RESENT'});
            const link = new URL(sent.mock.calls[0][1]);
            const token = link.pathname.split('/').at(-1)!;
            expect(await userService.verifyActivationToken(token)).toMatchObject({id: account.id});
            expect(prepareResult).not.toHaveBeenCalled();
            expect(JSON.stringify(req.session)).toBe(originalJson);
            expect((await readStoredSession(req.sessionStore, req.sessionID))?.frontendContext).toBe(req.apiActor!.context);
        } finally { sent.mockRestore(); }
    });
});

describe('atomic ordinary frontend logout completion', () => {
    it.each(['account', 'guest'] as const)('commits anonymous %s logout and its prepared receipt without a later actor resave', async kind => {
        const {req, options} = await ordinaryLogoutFixture(kind);
        const original = req.session;
        const committed = await userController.logoutUserWithSession(req, options);
        const reply = JSON.parse(committed.result.json) as components['schemas']['IdentityResult'];
        expect(reply).toMatchObject({session: {kind: 'anonymous', activeProfile: null, profiles: []}, personalLink: null, redirect: null});
        expect(reply.session.context).not.toBe(original.frontendContext);
        expect(reply.session.csrfToken).not.toBe(original.frontendCsrfToken);
        expect(req.session).toBe(original);
        expect(original.auth?.[kind === 'account' ? 'user' : 'guest']).toBeTruthy();
        const stored = await readStoredSession(req.sessionStore, req.sessionID);
        expect(stored?.frontendContext).toBe(reply.session.context);
        expect(stored?.auth).toBeUndefined();
        expect(stored?.profile).toBeUndefined();
        expect(stored?.tokens).toBeUndefined();
        expect(stored?.frontendAuthReturn).toBeUndefined();

        // A later admitted identity remains authoritative. Adopting this completed
        // logout acknowledges its stored write rather than saving its old JSON again.
        const later = {...JSON.parse(JSON.stringify(original)), frontendContext: `later-${kind}-after-logout`};
        await AppDataSource.getRepository(Session).update({id: req.sessionID}, {json: JSON.stringify(later)});
        req.session = committed.session;
        await persistSession(req.session);
        expect((await readStoredSession(req.sessionStore, req.sessionID))?.frontendContext).toBe(later.frontendContext);
        expect(JSON.parse(committed.result.json).session.context).toBe(reply.session.context);
    });

    it('rolls back ordinary logout when its generated response cannot prepare', async () => {
        const {req, options} = await ordinaryLogoutFixture('account');
        const original = req.session;
        const originalJson = JSON.stringify(original);
        function rejectCompletion(staged: Request['session']) {
            // The retained API requires a complete anonymous projection before
            // the stored actor changes; the retired document adapter is not exercised.
            staged.frontendCsrfToken = '';
            return prepareIdentityReply(req, staged, 'logoutIdentity');
        }
        options.prepareResult = rejectCompletion;
        await expect(userController.logoutUserWithSession(req, options)).rejects.toMatchObject({code: 'INTERNAL_ERROR'});

        expect(req.session).toBe(original);
        expect(JSON.stringify(req.session)).toBe(originalJson);
        const stored = await readStoredSession(req.sessionStore, req.sessionID);
        expect(stored?.auth?.user?.id).toBe(original.auth?.user?.id);
        expect(stored?.profile?.id).toBe(original.profile?.id);
        expect(stored?.frontendContext).toBe(original.frontendContext);
        expect(stored?.frontendCsrfToken).toBe(original.frontendCsrfToken);
        expect(stored?.frontendAuthReturn).toBe(original.frontendAuthReturn);
        expect(JSON.stringify(stored)).not.toContain('auth.logoutDone');
    });

    it('rejects stale ordinary logout before mutating request authority or a later stored guest', async () => {
        const {req, options} = await ordinaryLogoutFixture('account');
        const originalJson = JSON.stringify(req.session);
        const guest = await userService.createGuest(`Later logout actor ${randomUUID().slice(0, 8)}`);
        const later = {...JSON.parse(originalJson), auth: {guest}, profile: guest.profile,
            frontendContext: 'later-guest-before-logout'};
        await AppDataSource.getRepository(Session).update({id: req.sessionID}, {json: JSON.stringify(later)});
        const prepare = vi.fn(options.prepareResult);
        options.prepareResult = prepare;

        await expect(userController.logoutUserWithSession(req, options)).rejects.toMatchObject({code: 'SESSION_CONTEXT_CHANGED'});
        expect(prepare).not.toHaveBeenCalled();
        expect(JSON.stringify(req.session)).toBe(originalJson);
        const stored = await readStoredSession(req.sessionStore, req.sessionID);
        expect(stored?.frontendContext).toBe(later.frontendContext);
        expect(stored?.auth?.guest?.id).toBe(guest.id);
        expect(stored?.profile?.id).toBe(guest.profile.id);
    });

    it.each([
        {name: 'empty', kind: 'account', tokens: {}},
        {name: 'populated', kind: 'guest', tokens: {access_token: 'provider-fixture', token_type: 'Bearer'}},
    ] as const)('rejects fresh $name provider tokens without provider requests or completion', async fixture => {
        const {req, options} = await ordinaryLogoutFixture(fixture.kind);
        const originalJson = JSON.stringify(req.session);
        const storedProvider = {...JSON.parse(originalJson), tokens: fixture.tokens};
        // The earlier request remains token-free. This actual stored evidence
        // proves the wrapper repeats classification under its Session lock.
        await AppDataSource.getRepository(Session).update({id: req.sessionID}, {json: JSON.stringify(storedProvider)});
        const providerRequest = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected external provider request'));
        const prepare = vi.fn(options.prepareResult);
        options.prepareResult = prepare;
        try {
            await expect(userController.logoutUserWithSession(req, options)).rejects.toMatchObject({code: 'SESSION_CONTEXT_CHANGED'});
            expect(providerRequest).not.toHaveBeenCalled();
            expect(prepare).not.toHaveBeenCalled();
            expect(JSON.stringify(req.session)).toBe(originalJson);
            const stored = await readStoredSession(req.sessionStore, req.sessionID);
            expect(stored?.tokens).toEqual(fixture.tokens);
            expect(stored?.frontendContext).toBe(req.apiActor!.context);
            expect(stored?.profile?.id).toBe(req.session.profile?.id);
        } finally { providerRequest.mockRestore(); }
    });
});

describe('atomic frontend password-reset consumption', () => {
    it('allows only one of two independent frontend sessions to consume a reset token and write its password', async () => {
        const account = await registerLocalAccount('concurrent-reset');
        const token = await userService.generatePasswordResetToken(account.username);
        const first = await atomicGuestRequest();
        const second = await atomicGuestRequest();
        function options(req: Request): IdentityCompletionOptions<PreparedApiJsonResponse> {
            function prepareResult() {
                return prepareValidatedJson(req, 'resetAccountPassword', 200, {changed: true});
            }
            return {context: req.apiActor!.context, prepareResult};
        }
        const passwords = ['first-reset-secret', 'second-reset-secret'];
        const outcomes = await Promise.allSettled([
            userController.resetPasswordWithSession(token, {password: passwords[0], confirmPassword: passwords[0]}, first, options(first)),
            userController.resetPasswordWithSession(token, {password: passwords[1], confirmPassword: passwords[1]}, second, options(second)),
        ]);
        const winner = outcomes.findIndex(result => result.status === 'fulfilled');
        expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
        const rejected = outcomes.find(result => result.status === 'rejected');
        expect(rejected?.status === 'rejected' && rejected.reason).toMatchObject({cause: 'TOKEN_INVALID'});
        expect(await userService.verifyPassword(account.id, passwords[winner])).toBe(true);
        expect(await userService.verifyPassword(account.id, passwords[1 - winner])).toBe(false);
        expect(await userService.verifyPasswordResetToken(token)).toBeNull();
        expect(first.session.auth).toBeUndefined();
        expect(second.session.auth).toBeUndefined();
    });

    it('rolls back password and token consumption when the actual API completion cannot serialize', async () => {
        const account = await registerLocalAccount('serialization-failed-reset');
        const token = await userService.generatePasswordResetToken(account.username);
        const req = await atomicGuestRequest();
        const originalJson = JSON.stringify(req.session);
        const response = preparedResponse();
        function prepareInvalidReply() {
            const result: components['schemas']['MutationResult'] = {changed: true};
            // The real generated validator admits the ordinary wire fields. A
            // non-enumerable serializer fault then proves output preparation still
            // precedes password/token commit without mocking persistence or locks.
            Object.defineProperty(result, 'toJSON', {value: function rejectSerialization(): never {
                throw new TypeError('Reset completion serialization failed');
            }});
            return prepareValidatedJson(req, 'resetAccountPassword', 200, result);
        }
        // Capture only the error so an unexpected fulfilled receipt cannot print
        // its private capability URL in the assertion output.
        let preparationFailure: unknown;
        try {
            await userController.resetPasswordWithSession(token, {password: 'uncommitted-secret', confirmPassword: 'uncommitted-secret'}, req,
                {context: req.apiActor!.context, prepareResult: prepareInvalidReply});
        } catch (failure) { preparationFailure = failure; }
        expect(preparationFailure).toBeInstanceOf(TypeError);
        expect(await userService.verifyPassword(account.id, 'initial-secret')).toBe(true);
        expect(await userService.verifyPasswordResetToken(token)).toMatchObject({id: account.id});
        expect(JSON.stringify(req.session)).toBe(originalJson);
        expect(response.body).toBeNull();
    });

    it('prepares the API success receipt without unchanged session writes or later actor resaves', async () => {
        const account = await registerLocalAccount('prepared-reset-reply');
        const token = await userService.generatePasswordResetToken(account.username);
        const req = await atomicGuestRequest();
        const original = req.session;
        const before = await AppDataSource.getRepository(Session).findOneByOrFail({id: req.sessionID});
        const response = preparedResponse();
        function prepareReply() {
            return prepareValidatedJson(req, 'resetAccountPassword', 200, {changed: true});
        }
        const committed = await userController.resetPasswordWithSession(token,
            {password: 'confirmed-reset-secret', confirmPassword: 'confirmed-reset-secret'}, req,
            {context: req.apiActor!.context, prepareResult: prepareReply});
        expect(JSON.parse(committed.result.json)).toEqual({changed: true});
        expect(committed.result.context).toBe(req.apiActor!.context);
        expect(response.body).toBeNull();
        expect(await userService.verifyPassword(account.id, 'confirmed-reset-secret')).toBe(true);
        expect(await userService.verifyPasswordResetToken(token)).toBeNull();
        const after = await AppDataSource.getRepository(Session).findOneByOrFail({id: req.sessionID});
        expect(after.json).toBe(before.json);
        expect(after.expiredAt).toBe(before.expiredAt);

        const later = {...JSON.parse(JSON.stringify(original)), frontendContext: 'later-reset-actor'};
        await AppDataSource.getRepository(Session).update({id: req.sessionID}, {json: JSON.stringify(later)});
        req.session = committed.session;
        await persistSession(req.session);
        sendPreparedJson(req, response.res, committed.result);
        expect(response.statusCode).toBe(200);
        expect(response.body).toBe(committed.result.json);
        expect(response.headers.get('Cache-Control')).toBe('private, no-store');
        expect(response.headers.get('Content-Language')).toBe('en');
        expect(response.headers.get('X-Surveyor-Context')).toBe(committed.result.context);
        expect((await readStoredSession(req.sessionStore, req.sessionID))?.frontendContext).toBe('later-reset-actor');
    });

    it('preserves native and frontend mismatch-before-invalid-token diagnostics', async () => {
        const req = await atomicGuestRequest();
        const body = {password: 'first-value', confirmPassword: 'other-value'};
        await expect(userController.resetPassword('invalid-token', body)).rejects.toMatchObject({cause: 'PASSWORD_MISMATCH'});
        function unusedResult(): PreparedApiJsonResponse { throw new Error('Mismatch must precede preparation'); }
        await expect(userController.resetPasswordWithSession('invalid-token', body, req,
            {context: req.apiActor!.context, prepareResult: unusedResult})).rejects.toMatchObject({cause: 'PASSWORD_MISMATCH'});
    });
});

describe('atomic frontend password-reset mail preparation', () => {
    it('rolls back a known account token when cached SMTP setup fails before commit', async () => {
        const account = await registerLocalAccount('reset-setup-failed');
        const oldToken = await userService.generatePasswordResetToken(account.username);
        const req = await atomicGuestRequest();
        const failedSetup = new Error('Controlled SMTP setup failure');
        const create = vi.spyOn(nodemailer, 'createTransport').mockImplementation(function failSetup(): never { throw failedSetup; });
        function prepareReply() {
            return prepareValidatedJson(req, 'requestPasswordReset', 200, {changed: true});
        }
        try {
            await expect(userController.requestPasswordResetWithSession(account.username, req,
                {context: req.apiActor!.context, prepareResult: prepareReply})).rejects.toBe(failedSetup);
            expect(await userService.verifyPasswordResetToken(oldToken)).toMatchObject({id: account.id});
            expect(create).toHaveBeenCalledOnce();
            expect(req.session.auth).toBeUndefined();
        } finally { create.mockRestore(); }
    });

    it('keeps identical generic unknown/SMTP-failed receipts and never overwrites a later session actor', async () => {
        const transport = nodemailer.createTransport({streamTransport: true, buffer: true, newline: 'unix'});
        const create = vi.spyOn(nodemailer, 'createTransport').mockReturnValue(transport as unknown as Transporter);
        const send = vi.spyOn(transport, 'sendMail');
        const log = vi.spyOn(console, 'error').mockImplementation(() => {});
        const account = await registerLocalAccount('reset-smtp-failed');
        const unknown = await atomicGuestRequest();
        const known = await atomicGuestRequest();
        function options(req: Request): IdentityCompletionOptions<PreparedApiJsonResponse> {
            function prepareResult() {
                return prepareValidatedJson(req, 'requestPasswordReset', 200, {changed: true});
            }
            return {frontend: true, context: req.apiActor!.context, prepareResult};
        }
        try {
            const absent = await userController.requestPasswordResetWithSession('missing-reset-account', unknown, options(unknown));
            expect(create).not.toHaveBeenCalled();
            expect(send).not.toHaveBeenCalled();
            send.mockImplementationOnce(async function failDeliveryAfterCommit() {
                const target = await AppDataSource.getRepository(User).findOneByOrFail({id: account.id});
                expect(target.resetToken).toBeTruthy();
                const later = {...JSON.parse(JSON.stringify(known.session)), frontendContext: 'later-reset-mail-actor'};
                await AppDataSource.getRepository(Session).update({id: known.sessionID}, {json: JSON.stringify(later)});
                throw new Error('Controlled SMTP refusal');
            });
            const result = await userController.requestPasswordResetWithSession(account.email, known, options(known));
            expect(result.result.json).toBe(absent.result.json);
            expect(JSON.parse(result.result.json)).toEqual({changed: true});
            expect(result.result.context).toBe(known.apiActor!.context);
            expect(create).toHaveBeenCalledOnce();
            expect(send).toHaveBeenCalledOnce();
            expect((await readStoredSession(known.sessionStore, known.sessionID))?.frontendContext).toBe('later-reset-mail-actor');
            expect(known.session.auth).toBeUndefined();
        } finally { create.mockRestore(); send.mockRestore(); log.mockRestore(); transport.close(); }
    });

    it('retains the committed generic confirmation if the opaque delivery boundary unexpectedly rejects', async () => {
        const account = await registerLocalAccount('reset-opaque-rejection');
        const req = await atomicGuestRequest();
        const prepare = emailOwner.preparePasswordResetEmail;
        const delivery = vi.fn().mockRejectedValue(new Error('Controlled opaque delivery rejection'));
        const replacement = vi.spyOn(emailOwner, 'preparePasswordResetEmail').mockImplementation(function prepareCapturedMail(recipient, link) {
            prepare(recipient, link);
            return {deliver: delivery};
        });
        function prepareReply() {
            return prepareValidatedJson(req, 'requestPasswordReset', 200, {changed: true});
        }
        try {
            const committed = await userController.requestPasswordResetWithSession(account.username, req,
                {context: req.apiActor!.context, prepareResult: prepareReply});
            expect(JSON.parse(committed.result.json)).toEqual({changed: true});
            const target = await AppDataSource.getRepository(User).findOneByOrFail({id: account.id});
            expect(await userService.verifyPasswordResetToken(target.resetToken!)).toMatchObject({id: account.id});
            expect(delivery).toHaveBeenCalledOnce();
        } finally { replacement.mockRestore(); }
    });
});

describe('authentication user stories', () => {
    it('preserves the original Session and discards staged completion feedback when identity persistence fails', async () => {
        const {id, username} = await registerLocalAccount('frontend-failed-identity-save');
        await userService.activateUser(id);
        const req = await atomicGuestRequest();
        req.apiActor = undefined;
        await captureApiActor(req);
        /** Prepare the real account result, then fail only the staged store JSON write. */
        function prepareFailingSave(staged: Request['session']): PreparedApiJsonResponse {
            const result = prepareIdentityReply(req, staged, 'loginIdentity');
            Object.defineProperty(staged, 'flash', {value: {
                'frontend-notice': [JSON.stringify({kind: 'success', messageKey: 'auth.loginDone'})],
            }, enumerable: true});
            Object.defineProperty(staged, 'serializationCycle', {value: staged, enumerable: true});
            return result;
        }
        await expect(userController.loginUserWithSession({username, password: 'initial-secret'}, req,
            {context: req.apiActor!.context, prepareResult: prepareFailingSave})).rejects.toBeInstanceOf(TypeError);

        // Explicit completion staging protects the original middleware Session;
        // ordinary read-only admission never needs to repair or reload it afterward.
        req.apiActor = undefined;
        const reloaded = await sessionView(req);
        expect(reloaded.kind).toBe('anonymous');
        expect(req.session.auth).toBeUndefined();
        expect(JSON.stringify(req.session)).not.toContain('auth.loginDone');
        await persistSession(req.session);
        const stored = await readStoredSession(req.sessionStore, req.sessionID);
        expect(stored?.auth).toBeUndefined();
        expect(JSON.stringify(stored)).not.toContain('auth.loginDone');
    });

    it('rechecks transport admission after credential verification before replacing an identity', async () => {
        const {id, username} = await registerLocalAccount('frontend-stale-login');
        await userService.activateUser(id);
        const session = {frontendContext: 'old-context', frontendCsrfToken: 'old-csrf'} as Request['session'];
        const rejected = new Error('identity changed during verification');
        const beforeTransition = vi.fn(async () => { throw rejected; });
        await expect(userController.loginUser({username, password: 'initial-secret'}, session, {beforeTransition})).rejects.toBe(rejected);
        expect(beforeTransition).toHaveBeenCalledOnce();
        expect(session.auth).toBeUndefined();
        expect(session.profile).toBeUndefined();
        expect(session.frontendContext).toBe('old-context');
        expect(session.frontendCsrfToken).toBe('old-csrf');
    });

    it('uses one controller workflow for frontend account and guest email links with bounded return destinations', async () => {
        const activation = vi.spyOn(email, 'sendActivationEmail').mockResolvedValue(undefined);
        const reset = vi.spyOn(email, 'sendPasswordResetEmail').mockResolvedValue(undefined);
        const guestMail = vi.spyOn(email, 'sendLinkEmail').mockResolvedValue(undefined);
        const recovery = vi.spyOn(email, 'sendGuestRecoveryEmail').mockResolvedValue(undefined);
        try {
            const next = '/packing/example?locale=de#items';
            await userController.registerUser({username: 'frontend-link-account', displayname: 'Frontend Name',
                email: 'frontend-links@example.test', password: 'initial-secret', password_repeat: 'initial-secret'},
                undefined, {frontend: true, next});
            const activateUrl = new URL(activation.mock.calls[0][1]);
            expect(activateUrl.pathname).toMatch(/^\/users\/activate\/[^/]+$/);
            expect(activateUrl.searchParams.get('next')).toBe(next);
            await userController.sendPasswordForgotMail('frontend-link-account', {frontend: true, next: '//outside.invalid'});
            const resetUrl = new URL(reset.mock.calls[0][1]);
            expect(resetUrl.pathname).toMatch(/^\/users\/reset-password\/[^/]+$/);
            expect(resetUrl.searchParams.get('next')).toBe('/users/dashboard');

            const session = {} as Request['session'];
            const link = await userController.registerGuest('Frontend Guest', '  FRONTEND-GUEST@example.test  ', session,
                {frontend: true, next});
            expect(session.auth?.guest?.username).toBe('Frontend Guest');
            expect(session.profile?.guestId).toBe(session.auth?.guest?.id);
            expect(session.frontendContext).toBeTruthy();
            expect(guestMail).toHaveBeenCalledWith({name: 'Frontend Guest', address: 'frontend-guest@example.test'}, link);
            expect(new URL(link).searchParams.get('next')).toBe(next);
            await userController.recoverGuestAccount('frontend-guest@example.test', {frontend: true, next});
            const recovered = recovery.mock.calls[0][1];
            expect(recovered).toHaveLength(1);
            expect(recovered[0].link).toBe(link);
        } finally {
            activation.mockRestore(); reset.mockRestore(); guestMail.mockRestore(); recovery.mockRestore();
        }
    });

    it.each([
        ['blank-name-account', '   ', 'blank-name-account'],
        ['spaced-name-account', '  Morgan\r\n  Example  ', 'Morgan Example'],
    ])('normalizes the display name before persisting and emailing account %s', async (username, displayname, expectedName) => {
        const activation = vi.spyOn(email, 'sendActivationEmail').mockResolvedValue(undefined);
        try {
            await userController.registerUser({
                username, displayname, email: `${username}@example.test`,
                password: 'test-password1', password_repeat: 'test-password1',
            });
            const account = (await userService.getUserByUsername(username))!;
            expect(account.name).toBe(expectedName);
            expect(account.profiles[0].name).toBe(expectedName);
            expect(activation).toHaveBeenCalledWith({name: expectedName, address: `${username}@example.test`}, expect.any(String));
        } finally {
            activation.mockRestore();
        }
    });

    it('falls back to an existing account username for password recovery when its stored name is blank', async () => {
        const profile = await persistIntegrationProfile({name: ' \r\n ', username: 'legacy-blank-name', email: 'legacy-name@example.test'});
        const recovery = vi.spyOn(email, 'sendPasswordResetEmail').mockResolvedValue(undefined);
        try {
            await userController.sendPasswordForgotMail(profile.user!.username);
            expect(recovery).toHaveBeenCalledWith({name: 'legacy-blank-name', address: 'legacy-name@example.test'}, expect.any(String));
        } finally {
            recovery.mockRestore();
        }
    });

    it('addresses activation and password recovery to the saved account name', async () => {
        const activation = vi.spyOn(email, 'sendActivationEmail').mockResolvedValue(undefined);
        const recovery = vi.spyOn(email, 'sendPasswordResetEmail').mockResolvedValue(undefined);
        try {
            await userController.registerUser({
                username: 'named-email-account', displayname: 'Morgan Example', email: 'named-account@example.test',
                password: 'test-password1', password_repeat: 'test-password1',
            });
            expect(activation).toHaveBeenCalledWith(
                {name: 'Morgan Example', address: 'named-account@example.test'}, expect.stringContaining('/users/activate/'),
            );
            await userController.sendPasswordForgotMail('named-email-account');
            expect(recovery).toHaveBeenCalledWith(
                {name: 'Morgan Example', address: 'named-account@example.test'}, expect.stringContaining('/users/reset-password/'),
            );
        } finally {
            activation.mockRestore();
            recovery.mockRestore();
        }
    });

    it('uses the actual guest names when one recovery email represents multiple guest identities', async () => {
        const recovery = vi.spyOn(email, 'sendGuestRecoveryEmail').mockResolvedValue(undefined);
        try {
            await userService.createGuest('Morgan Guest', 'named-guests@example.test');
            await userService.createGuest('Casey Guest', 'named-guests@example.test');
            await userController.recoverGuestAccount('named-guests@example.test');
            expect(recovery).toHaveBeenCalledOnce();
            const [recipient, guests] = recovery.mock.calls[0];
            expect(recipient.address).toBe('named-guests@example.test');
            expect(recipient.name).toContain('Morgan Guest');
            expect(recipient.name).toContain('Casey Guest');
            expect(guests.map(guest => guest.username)).toEqual(expect.arrayContaining(['Morgan Guest', 'Casey Guest']));
        } finally {
            recovery.mockRestore();
        }
    });

    it('registers an inactive account with a usable profile, all account lookups, and verified password', async () => {
        // These reads exercise the same newly committed account/profile transaction.
        // Reusing that account keeps each persistence and password assertion without
        // repeating registration and its deliberately expensive password hashing.
        const {id: userId, username, email: accountEmail} = await registerLocalAccount('registration');

        const account = await userService.getUserByUsername(username);
        expect(account?.id).toBe(userId);
        expect(Boolean(account?.isActive)).toBe(false);
        expect(account?.profiles).toHaveLength(1);
        expect(await userService.getUserByEmail(accountEmail)).toMatchObject({id: userId, username});
        expect((await userService.findUserByNameOrEmail(username))?.id).toBe(userId);
        expect((await userService.findUserByNameOrEmail(accountEmail))?.id).toBe(userId);
        expect((await userService.findUserByNameOrEmail(userId))?.id).toBe(userId);
        await expect(userService.verifyPassword(userId, 'initial-secret')).resolves.toBe(true);
        await expect(userService.verifyPassword(userId, 'wrong-secret')).resolves.toBe(false);
    });

    it('logs in an active local account with its username and email in independent sessions', async () => {
        const {id: userId, username, email: accountEmail} = await registerLocalAccount('local-login');
        await userService.activateUser(userId);
        const session = {} as Request['session'];

        await userController.loginUser({username, password: 'initial-secret'}, session);

        // Canary: the existing username credential must continue to establish the user and default-profile session.
        expect(session.auth?.user?.id).toBe(userId);
        expect(session.profile?.id).toBe(session.auth?.user?.profiles[0].id);
        // A fresh session proves email login establishes its own identity rather
        // than accidentally retaining the preceding username login's state.
        const emailSession = {} as Request['session'];
        await userController.loginUser({username: accountEmail, password: 'initial-secret'}, emailSession);

        // Regression: local users who enter their email must receive the same authenticated session as username users.
        expect(emailSession.auth?.user?.id).toBe(userId);
        expect(emailSession.profile?.id).toBe(emailSession.auth?.user?.profiles[0].id);
    });

    it('activates an account with its persisted token and consumes the token', async () => {
        const {id: userId} = await registerLocalAccount('activation');

        const token = await userService.generateActivationToken(userId);
        expect((await userService.verifyActivationToken(token))?.id).toBe(userId);
        await userController.activateAccount(token);
        expect(Boolean((await userService.getUserById(userId))?.isActive)).toBe(true);
        expect(await userService.verifyActivationToken(token)).toBeNull();
    });

    it('resets a password through the recovery-token workflow and consumes the token', async () => {
        const {id: userId, username} = await registerLocalAccount('password-reset');

        const token = await userService.generatePasswordResetToken(username);
        expect((await userService.verifyPasswordResetToken(token))?.id).toBe(userId);
        // Both native GET and v1 preflight call this non-consuming controller admission.
        await expect(userController.checkPasswordForgotToken(token)).resolves.toBeUndefined();
        await expect(userController.checkPasswordForgotToken(token)).resolves.toBeUndefined();
        await userController.resetPassword(token, {
            password: 'replacement-secret',
            confirmPassword: 'replacement-secret'
        });
        await expect(userService.verifyPassword(userId, 'replacement-secret')).resolves.toBe(true);
        expect(await userService.verifyPasswordResetToken(token)).toBeNull();
        await expect(userController.checkPasswordForgotToken(token)).rejects.toMatchObject({status: 401, cause: 'TOKEN_INVALID'});
    });

    it('rejects unknown and expired reset links before presenting the password form', async () => {
        await expect(userController.checkPasswordForgotToken('unknown-reset-token'))
            .rejects.toMatchObject({status: 401, cause: 'TOKEN_INVALID'});
        const {id, username} = await registerLocalAccount('reset-expiry');
        const token = await userService.generatePasswordResetToken(username);
        await AppDataSource.getRepository(User).update(id, {resetTokenExpiration: new Date('2000-01-01T00:00:00Z')});
        await expect(userController.checkPasswordForgotToken(token)).rejects.toMatchObject({status: 401, cause: 'TOKEN_INVALID'});
        // Rejection leaves the existing password unchanged; only a successful reset consumes it.
        await expect(userService.verifyPassword(id, 'initial-secret')).resolves.toBe(true);
    });

    it('creates a guest identity with a linked profile', async () => {
        const guest = await userService.createGuest('Camp Guest', 'camp-guest@example.com');
        expect(guest.profile).toMatchObject({name: 'Camp Guest', guestId: guest.id});
    });

    it('restores a guest session using its private link token', async () => {
        const guest = await userService.createGuest('Returning Guest');
        const token = await userService.getGuestLinkToken(guest.id);
        expect(await userService.getGuestByToken(token!, guest.id)).toMatchObject({
            id: guest.id,
            profile: {id: guest.profile.id}
        });
    });

    it('matches guest email addresses after normalization', async () => {
        const guestEmail = 'normalized-guest@example.com';
        const guest = await userService.createGuest('Normalized Guest', `  ${guestEmail.toUpperCase()}  `);
        expect((await userService.getGuestByEmail(guestEmail)).map((match) => match.id)).toContain(guest.id);
    });

    it('links and unlinks OIDC without deleting the existing local account', async () => {
        const {id: userId} = await registerLocalAccount('oidc-link');

        await userService.linkUserToOidc(userId, 'https://identity.example', 'linked-subject');
        expect(await userService.getUserByOidc('https://identity.example', 'linked-subject')).toMatchObject({id: userId});
        await userService.unlinkOidc(userId);
        expect(await userService.getUserByOidc('https://identity.example', 'linked-subject')).toBeNull();
        expect(await userService.getUserById(userId)).not.toBeNull();
    });

    it('keeps an exact OIDC account match authoritative over changed provider email and name claims', async () => {
        const {id, email, username} = await registerLocalAccount('oidc-exact-policy');
        await userService.linkUserToOidc(id, 'https://identity.example', 'exact-policy-subject');
        const profiles = await userService.getProfilesForUser(id);
        const usersBefore = await AppDataSource.getRepository(User).count();

        const account = await findOrCreateUserFromOidc('https://identity.example', {
            sub: 'exact-policy-subject', email: 'changed-exact-claim@example.com',
            preferred_username: 'changed-provider-username', name: 'Changed provider name',
        });

        // An exact issuer/subject match historically does not relink by email,
        // rename the account, activate it or replace its existing profiles.
        expect(account).toMatchObject({id, email, username});
        expect(Boolean(account.isActive)).toBe(false);
        expect(account.profiles.map(profile => profile.id).sort()).toEqual(profiles.map(profile => profile.id).sort());
        expect(await AppDataSource.getRepository(User).count()).toBe(usersBefore);
        await expect(userService.verifyPassword(id, 'initial-secret')).resolves.toBe(true);
        expect(await AppDataSource.getRepository(User).findOneBy({id})).toMatchObject({email, username, oidcSub: 'exact-policy-subject'});
    });

    it('links an existing email account and activates it without replacing its password or profiles', async () => {
        const {id, email, username} = await registerLocalAccount('oidc-email-policy');
        await userService.createProfile(id, 'Additional OIDC policy profile');
        const profiles = await userService.getProfilesForUser(id);
        const usersBefore = await AppDataSource.getRepository(User).count();

        const account = await findOrCreateUserFromOidc('https://identity.example', {
            sub: 'email-policy-subject', email, preferred_username: 'unused-provider-name', name: 'Unused provider label',
        }, {linkByEmail: true});

        // Email linking preserves the local identity and its profiles; only the
        // existing activation/link fields are selected by this policy branch.
        expect(account).toMatchObject({id, email, username, oidcIssuer: 'https://identity.example', oidcSub: 'email-policy-subject'});
        expect(Boolean(account.isActive)).toBe(true);
        expect(account.profiles.map(profile => profile.id).sort()).toEqual(profiles.map(profile => profile.id).sort());
        expect(await AppDataSource.getRepository(User).count()).toBe(usersBefore);
        await expect(userService.verifyPassword(id, 'initial-secret')).resolves.toBe(true);
        const saved = await AppDataSource.getRepository(User).findOneByOrFail({id});
        expect(saved.oidcSub).toBe('email-policy-subject');
        expect(Boolean(saved.isActive)).toBe(true);
    });

    it('provisions an active OIDC account and profile just in time', async () => {
        const oidc = await findOrCreateUserFromOidc('https://identity.example', {
            sub: 'jit-provisioned-subject',
            email: 'jit-user@example.com',
            preferred_username: 'jit-user',
            name: 'JIT User',
        });
        expect(oidc.oidcSub).toBe('jit-provisioned-subject');
        expect(Boolean(oidc.isActive)).toBe(true);
        expect(oidc.profiles).toHaveLength(1);
    });

});
