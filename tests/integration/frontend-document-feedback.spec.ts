import http from 'node:http';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import session from 'express-session';
import flash from 'express-flash';
import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest';
import {initializeIntegrationDatabase, closeIntegrationDatabase} from '../support/database';
import {AppDataSource} from '../../src/backend/modules/database/dataSource';
import * as userService from '../../src/backend/modules/database/services/UserService';
import * as userController from '../../src/backend/controller/userController';
import {Session} from '../../src/backend/modules/database/entities/session/Session';
import {captureApiActor, prepareIdentityReply} from '../../src/backend/modules/api/session';
import {sendPreparedJson} from '../../src/backend/modules/api/transport';
import {createSessionStore, readStoredSession} from '../../src/backend/modules/lib/session';
import {asyncHandler} from '../../src/backend/modules/lib/asyncHandler';
import {bootstrap, applyPageEntry, flashPageNotice, renderNativeDocument, persistCompletedWorkflowFeedback,
    admitFrontendDocument} from '../../src/backend/middleware/frontendDocuments';
import type {FrontendBootstrap} from '../../src/types/FrontendTypes';

/** Actual HTTP milestones establish ordering without pausing a database writer or replacing its store. */
function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>(function retainResolution(settle) { resolve = settle; });
    return {promise, resolve};
}

const gates = new Map<string, {phase: 'before' | 'after'; arrived: ReturnType<typeof deferred>; release: ReturnType<typeof deferred>}>();
let listener: http.Server;
let origin = '';
let username = '';
let userId: number;
let profileId = '';
let views = '';

/** One configured store and real identity owners exercise their ordinary Express completion together. */
beforeAll(async function startFeedbackFixture() {
    await initializeIntegrationDatabase();
    username = `document-feedback-${randomUUID().slice(0, 8)}`;
    userId = await userService.registerUser(username, 'Document feedback', 'test-only-password', `${username}@example.invalid`);
    await userService.activateUser(userId);
    const account = await userService.getUserById(userId);
    profileId = account!.profiles[0].id;
    const app = express();
    views = await fs.mkdtemp(path.join(os.tmpdir(), 'surveyor-feedback-views-'));
    await fs.writeFile(path.join(views, 'native.pug'), 'each values, channel in messages\n  p= channel\n  each value in values\n    p= value\n');
    app.set('views', views);
    app.set('view engine', 'pug');
    app.use(express.json());
    app.use(session({secret: 'document-feedback-integration-only', resave: false, saveUninitialized: false,
        store: createSessionStore(AppDataSource.manager), cookie: {maxAge: 86_400_000}}));
    app.use(flash());
    app.post('/login', asyncHandler(async function login(req, res) {
        const actor = await captureApiActor(req);
        const completed = await userController.loginUserWithSession(req.body, req, {context: actor.context,
            prepareResult(staged) {
                flashPageNotice(req, {kind: 'success', messageKey: 'auth.loginDone'}, staged);
                // These are the three existing Vue channels plus an unrelated
                // native channel. No private link is accepted from client input.
                const detached = {session: staged} as express.Request;
                req.flash.call(detached, 'frontend', 'auth.activated');
                req.flash.call(detached, 'frontend-link', JSON.stringify({context: staged.frontendContext,
                    personalLink: 'https://example.invalid/private-feedback-fixture'}));
                req.flash.call(detached, 'legacy-native', 'Native fixture notice');
                return prepareIdentityReply(req, staged, 'loginIdentity');
            }});
        req.session = completed.session;
        sendPreparedJson(req, res, completed.result);
    }));
    app.post('/logout', asyncHandler(async function logout(req, res) {
        const actor = await captureApiActor(req);
        const completed = await userController.logoutUserWithSession(req, {context: actor.context,
            prepareResult: staged => prepareIdentityReply(req, staged, 'logoutIdentity')});
        req.session = completed.session;
        sendPreparedJson(req, res, completed.result);
    }));
    app.post('/switch', asyncHandler(async function switchProfile(req, res) {
        const actor = await captureApiActor(req);
        const completed = await userController.changeActiveProfileWithSession(req.body.profileId, req,
            {context: actor.context, prepareResult: staged => prepareIdentityReply(req, staged, 'switchIdentityProfile')});
        req.session = completed.session;
        sendPreparedJson(req, res, completed.result);
    }));
    app.get('/document', asyncHandler(async function document(req, res) {
        // Admission freezes the actor before the optional pre-consumption hold.
        // Neither gate mutates Session, persistence, the response or production owners.
        await captureApiActor(req);
        const gate = gates.get(String(req.query.gate));
        if (gate?.phase === 'before') { gate.arrived.resolve(); await gate.release.promise; }
        const state = await bootstrap(req);
        if (gate?.phase === 'after') { gate.arrived.resolve(); await gate.release.promise; }
        if (req.query.redirect) {
            await applyPageEntry(req, res, state, {kind: 'redirect', url: '/users/dashboard', notice: null});
            return;
        }
        if (req.query.fail) throw new Error('Controlled render failure');
        if (req.query.drop) { req.socket.destroy(); return; }
        res.json(state);
    }));
    app.get('/native', asyncHandler(async function native(req, res) {
        await captureApiActor(req);
        const gate = gates.get(String(req.query.gate));
        if (gate) { gate.arrived.resolve(); await gate.release.promise; }
        await renderNativeDocument(req, res, 'native', {});
    }));
    app.post('/completed-logout', asyncHandler(async function completedLogout(req, res) {
        // Exercise the actual retained ordinary identity boundary separately
        // from its now guarded feedback-only continuation.
        await captureApiActor(req);
        await userController.logoutUserOidc(req.session);
        const gate = gates.get(String(req.query.gate));
        if (gate) { gate.arrived.resolve(); await gate.release.promise; }
        await persistCompletedWorkflowFeedback(req, {kind: 'success', messageKey: 'auth.logoutDone'});
        res.redirect('/users/login');
    }));
    app.use('/expiry', admitFrontendDocument);
    app.get('/expiry', (_req, res) => res.status(204).end());
    app.get('/actor', asyncHandler(async function actor(req, res) {
        const captured = await captureApiActor(req);
        res.json({context: captured.context, userId: captured.auth?.user?.id ?? null, profileId: captured.profile?.id ?? null});
    }));
    app.use(function failedFixture(_error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) {
        res.status(500).json({failed: true});
    });
    listener = http.createServer(app);
    await new Promise<void>(resolve => listener.listen(0, '127.0.0.1', resolve));
    const address = listener.address();
    if (!address || typeof address === 'string') throw new Error('The feedback fixture has no listener port');
    origin = `http://127.0.0.1:${address.port}`;
});

afterAll(async function closeFeedbackFixture() {
    for (const gate of gates.values()) gate.release.resolve();
    listener?.closeAllConnections();
    if (listener) await new Promise<void>(resolve => listener.close(() => resolve()));
    await closeIntegrationDatabase();
    // The temporary directory was created by this fixture and contains only its
    // native Pug view; no configured application storage is selected for removal.
    if (views && path.dirname(views) === os.tmpdir() && path.basename(views).startsWith('surveyor-feedback-views-')) {
        await fs.rm(views, {recursive: true, force: true});
    }
});

/** The actor returns only signed server cookies; its SID locates actual persistence for assertions. */
async function loginActor(currentCookie?: string, accountName = username) {
    const response = await fetch(`${origin}/login`, {method: 'POST', headers: {'Content-Type': 'application/json', Connection: 'close',
        ...(currentCookie ? {Cookie: currentCookie} : {})}, body: JSON.stringify({username: accountName, password: 'test-only-password'})});
    expect(response.status).toBe(200);
    const cookie = response.headers.getSetCookie()[0]?.split(';')[0] ?? currentCookie!;
    const signed = decodeURIComponent(cookie.slice(cookie.indexOf('=') + 1));
    const sessionId = signed.slice(2, signed.lastIndexOf('.'));
    const reply = await response.json();
    return {cookie, sessionId, context: reply.session.context as string};
}

function hold(phase: 'before' | 'after') {
    const key = randomUUID();
    const gate = {phase, arrived: deferred(), release: deferred()};
    gates.set(key, gate);
    return {key, ...gate};
}

function request(target: string, cookie?: string, method = 'GET') {
    return fetch(`${origin}${target}`, {method, redirect: 'manual', headers: {Connection: 'close', ...(cookie ? {Cookie: cookie} : {})}});
}

/** The store projection and a fresh HTTP capture must both retain the actual completed logout. */
async function expectLoggedOut(actor: Awaited<ReturnType<typeof loginActor>>, context: string) {
    const stored = await readStoredSession(createSessionStore(AppDataSource.manager), actor.sessionId);
    expect(stored?.frontendContext).toBe(context);
    expect(Boolean(stored?.auth || stored?.profile)).toBe(false);
    const fresh = await request('/actor', actor.cookie);
    expect(fresh.status).toBe(200);
    expect(await fresh.json()).toEqual({context, userId: null, profileId: null});
}

describe('document feedback with real Session persistence', () => {
    it('cannot restore the former account when a notice-consuming document finishes after logout', async () => {
        const actor = await loginActor();
        const gate = hold('after');
        const pending = request(`/document?gate=${gate.key}`, actor.cookie);
        try {
            await gate.arrived.promise;
            const logout = await request('/logout', actor.cookie, 'POST');
            expect(logout.status).toBe(200);
            const completed = await logout.json();
            expect(completed.session.context).not.toBe(actor.context);
            await expectLoggedOut(actor, completed.session.context);
            gate.release.resolve();
            const document = await pending;
            const state = await document.json() as FrontendBootstrap;
            expect(state.session.activeProfile?.id).toBe(profileId);
            expect(state.pageNotice?.messageKey).toBe('auth.loginDone');
            await expectLoggedOut(actor, completed.session.context);
        } finally { gate.release.resolve(); await pending; }
    });

    it('omits stale feedback when logout wins before consumption and preserves captured document authority', async () => {
        const actor = await loginActor();
        const gate = hold('before');
        const pending = request(`/document?gate=${gate.key}`, actor.cookie);
        try {
            await gate.arrived.promise;
            const logout = await request('/logout', actor.cookie, 'POST');
            const completed = await logout.json();
            gate.release.resolve();
            const document = await pending;
            expect(document.status).toBe(200);
            const state = await document.json() as FrontendBootstrap;
            expect(state.session.context).toBe(actor.context);
            expect(state.session.activeProfile?.id).toBe(profileId);
            expect(state.pageNotice).toBeUndefined();
            await expectLoggedOut(actor, completed.session.context);
        } finally { gate.release.resolve(); await pending; }
    });

    it('consumes a same-generation notice once across two requests that loaded it together', async () => {
        const actor = await loginActor();
        const first = hold('before');
        const second = hold('before');
        const requests = [request(`/document?gate=${first.key}`, actor.cookie), request(`/document?gate=${second.key}`, actor.cookie)];
        try {
            await Promise.all([first.arrived.promise, second.arrived.promise]);
            first.release.resolve(); second.release.resolve();
            const states = await Promise.all(requests.map(async pending => await (await pending).json() as FrontendBootstrap));
            expect(states.filter(state => state.pageNotice?.messageKey === 'auth.loginDone')).toHaveLength(1);
            expect(states.every(state => state.session.context === actor.context)).toBe(true);
            const fresh = await request('/actor', actor.cookie);
            expect(await fresh.json()).toEqual({context: actor.context, userId, profileId});
        } finally { first.release.resolve(); second.release.resolve(); await Promise.all(requests); }
    });

    it.each(['before', 'after'] as const)('retains a completed profile switch when the old feedback document waits %s consumption', async phase => {
        const actor = await loginActor();
        const extraProfile = await userService.createProfile(userId, 'Feedback switch target');
        const gate = hold(phase);
        const pending = request(`/document?gate=${gate.key}`, actor.cookie);
        try {
            await gate.arrived.promise;
            const switched = await fetch(`${origin}/switch`, {method: 'POST', headers: {'Content-Type': 'application/json',
                Connection: 'close', Cookie: actor.cookie}, body: JSON.stringify({profileId: extraProfile.id})});
            expect(switched.status).toBe(200);
            const completion = await switched.json();
            expect(completion.session.context).not.toBe(actor.context);
            expect(completion.session.activeProfile.id).toBe(extraProfile.id);
            gate.release.resolve();
            const response = await pending;
            const state = await response.json() as FrontendBootstrap;
            expect(state.session.context).toBe(actor.context);
            expect(state.session.activeProfile?.id).toBe(profileId);
            expect(state.pageNotice?.messageKey).toBe(phase === 'before' ? undefined : 'auth.loginDone');
            const captured = await request('/actor', actor.cookie);
            expect(await captured.json()).toEqual({context: completion.session.context, userId, profileId: extraProfile.id});
        } finally { gate.release.resolve(); await pending; }
    });

    it('leaves no-feedback public visits uninitialized and creates no cookie or Session row', async () => {
        const before = await AppDataSource.getRepository(Session).count();
        const response = await request('/document');
        expect(response.status).toBe(200);
        expect(response.headers.getSetCookie()).toEqual([]);
        const state = await response.json() as FrontendBootstrap;
        expect(state.session.kind).toBe('anonymous');
        expect(await AppDataSource.getRepository(Session).count()).toBe(before);
    });

    it('carries a consumed notice through a same-generation redirect and consumes it only at its destination', async () => {
        const actor = await loginActor();
        const redirect = await request('/document?redirect=1', actor.cookie);
        expect(redirect.status).toBe(302);
        expect(redirect.headers.get('location')).toContain('/users/dashboard');
        const destination = await request('/document', actor.cookie);
        expect((await destination.json() as FrontendBootstrap).pageNotice?.messageKey).toBe('auth.loginDone');
        const repeat = await request('/document', actor.cookie);
        expect((await repeat.json() as FrontendBootstrap).pageNotice).toBeUndefined();
    });

    it('omits carried feedback when logout wins after its source document consumed the notice', async () => {
        const actor = await loginActor();
        const gate = hold('after');
        const pending = request(`/document?gate=${gate.key}&redirect=1`, actor.cookie);
        try {
            await gate.arrived.promise;
            const logout = await request('/logout', actor.cookie, 'POST');
            const completed = await logout.json();
            gate.release.resolve();
            expect((await pending).status).toBe(302);
            await expectLoggedOut(actor, completed.session.context);
            const destination = await request('/document', actor.cookie);
            expect((await destination.json() as FrontendBootstrap).pageNotice).toBeUndefined();
        } finally { gate.release.resolve(); await pending; }
    });

    it('does not replay a durably consumed notice when subsequent rendering fails', async () => {
        const actor = await loginActor();
        const failed = await request('/document?fail=1', actor.cookie);
        expect(failed.status).toBe(500);
        const next = await request('/document', actor.cookie);
        expect((await next.json() as FrontendBootstrap).pageNotice).toBeUndefined();
    });

    it('keeps consumed feedback durable when the connection drops before response delivery', async () => {
        const actor = await loginActor();
        await expect(request('/document?drop=1', actor.cookie)).rejects.toThrow();
        const next = await request('/document', actor.cookie);
        const state = await next.json() as FrontendBootstrap;
        expect(state.pageNotice).toBeUndefined();
        expect(state.personalLink).toBeUndefined();
    });

    it('consumes all Vue channels once and binds private links to the captured generation', async () => {
        const actor = await loginActor();
        const first = await request('/document', actor.cookie);
        const state = await first.json() as FrontendBootstrap;
        expect(state.identityFeedback).toBe('auth.activated');
        expect(state.personalLink).toBe('https://example.invalid/private-feedback-fixture');
        const second = await request('/document', actor.cookie);
        const repeat = await second.json() as FrontendBootstrap;
        expect(repeat.identityFeedback).toBeUndefined();
        expect(repeat.personalLink).toBeUndefined();
    });

    it('retains legacy metadata without initializing it and discards links for an obsolete generation', async () => {
        const actor = await loginActor();
        const repository = AppDataSource.getRepository(Session);
        const row = await repository.findOneByOrFail({id: actor.sessionId});
        const legacy = JSON.parse(row.json);
        delete legacy.frontendContext; delete legacy.frontendCsrfToken;
        await repository.update({id: actor.sessionId}, {json: JSON.stringify(legacy)});
        const response = await request('/document', actor.cookie);
        const state = await response.json() as FrontendBootstrap;
        expect(state.session.context).toBeTruthy();
        expect(state.session.context).not.toBe(actor.context);
        expect(state.personalLink).toBeUndefined();
        expect(state.pageNotice?.messageKey).toBe('auth.loginDone');
        const after = JSON.parse((await repository.findOneByOrFail({id: actor.sessionId})).json);
        expect(after.frontendContext).toBeUndefined();
        expect(after.frontendCsrfToken).toBeUndefined();
        expect(after.auth.user.id).toBe(userId);
    });

    it('renders every native channel once and does not dirty empty feedback on a repeat', async () => {
        const actor = await loginActor();
        const first = await request('/native', actor.cookie);
        expect(first.status).toBe(200);
        const html = await first.text();
        for (const channel of ['frontend', 'frontend-notice', 'frontend-link', 'legacy-native']) expect(html).toContain(channel);
        const repository = AppDataSource.getRepository(Session);
        const before = await repository.findOneByOrFail({id: actor.sessionId});
        expect(JSON.parse(before.json).flash).toEqual({});
        const second = await request('/native', actor.cookie);
        expect(second.status).toBe(200);
        expect(await second.text()).toBe('');
        expect((await repository.findOneByOrFail({id: actor.sessionId})).json === before.json).toBe(true);
        const publicVisit = await request('/native');
        expect(publicVisit.headers.getSetCookie()).toEqual([]);
    });

    it('omits stale native channels when a later identity has already committed', async () => {
        const actor = await loginActor();
        const gate = hold('before');
        const pending = request(`/native?gate=${gate.key}`, actor.cookie);
        try {
            await gate.arrived.promise;
            const logout = await request('/logout', actor.cookie, 'POST');
            const completed = await logout.json();
            gate.release.resolve();
            const response = await pending;
            expect(response.status).toBe(200);
            expect(await response.text()).toBe('');
            await expectLoggedOut(actor, completed.session.context);
        } finally { gate.release.resolve(); await pending; }
    });

    it('does not overwrite a subsequent login when completed ordinary logout queues its notice late', async () => {
        const actor = await loginActor();
        const gate = hold('after');
        const pending = request(`/completed-logout?gate=${gate.key}`, actor.cookie, 'POST');
        try {
            await gate.arrived.promise;
            const later = await loginActor(actor.cookie);
            gate.release.resolve();
            expect((await pending).status).toBe(302);
            const captured = await request('/actor', actor.cookie);
            expect(await captured.json()).toEqual({context: later.context, userId, profileId});
            const notice = await request('/document', actor.cookie);
            expect((await notice.json() as FrontendBootstrap).pageNotice?.messageKey).toBe('auth.loginDone');
        } finally { gate.release.resolve(); await pending; }
    });

    it('logs expiry-notice persistence failure without rejecting or restoring the completed logout', async () => {
        const extraName = `expired-${randomUUID().slice(0, 8)}`;
        const extraId = await userService.registerUser(extraName, 'Expired actor', 'test-only-password', `${extraName}@example.invalid`);
        await userService.activateUser(extraId);
        const actor = await loginActor(undefined, extraName);
        await userService.deleteUser(extraId);
        const trigger = `feedback_${randomUUID().replaceAll('-', '')}`;
        const log = vi.spyOn(console, 'error').mockImplementation(() => {});
        try {
            // The existing ordinary logout (legacy error flash included) commits
            // first. Only the later bounded expiry notice is refused by real SQL.
            await AppDataSource.query(`CREATE TRIGGER ${trigger} BEFORE UPDATE ON session FOR EACH ROW
                BEGIN IF NEW.json LIKE '%auth.sessionExpired%' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Controlled feedback failure'; END IF; END`);
            const response = await request('/expiry', actor.cookie);
            expect(response.status).toBe(302);
            expect(log).toHaveBeenCalledWith('[frontend]', {code: 'WORKFLOW_FEEDBACK_UNAVAILABLE'});
            const stored = await readStoredSession(createSessionStore(AppDataSource.manager), actor.sessionId);
            expect(Boolean(stored?.auth || stored?.profile)).toBe(false);
            expect(stored?.frontendContext).toBeTruthy();
            expect(stored?.frontendContext).not.toBe(actor.context);
            const row = await AppDataSource.getRepository(Session).findOneByOrFail({id: actor.sessionId});
            expect(row.json.includes('auth.sessionExpired')).toBe(false);
        } finally {
            await AppDataSource.query(`DROP TRIGGER IF EXISTS ${trigger}`);
            log.mockRestore();
        }
    });
});
