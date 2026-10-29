import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest';
import express from 'express';
import session from 'express-session';
import type {SessionData} from 'express-session';
import http from 'node:http';
import {AppDataSource} from '../../src/backend/modules/database/dataSource';
import {Session} from '../../src/backend/modules/database/entities/session/Session';
import {createSessionStore} from '../../src/backend/modules/database/services/UserService';
import {closeIntegrationDatabase, initializeIntegrationDatabase} from '../support/database';

beforeAll(initializeIntegrationDatabase);
afterAll(closeIntegrationDatabase);

/** Exercise the real HTTP load/renew lifecycle on the guarded disposable schema.
 * Its server-owned anonymous generation makes no account/admission claim. */
async function renewalFixture() {
    const store = createSessionStore(AppDataSource.manager);
    const app = express();
    app.use(session({secret: 'session-renewal-integration-fixture', store,
        resave: false, saveUninitialized: false,
        cookie: {maxAge: 86_400_000, httpOnly: true, sameSite: 'lax'}}));
    app.post('/seed', function seedSession(req, res): void {
        req.session.auth = {};
        req.session.frontendContext = 'server-owned-renewal-generation';
        res.send(req.sessionID);
    });
    app.get('/read', function readSession(_req, res): void {
        res.send('renewed-session');
    });
    const server = http.createServer(app);
    await new Promise<void>(function listen(resolve) {
        server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('The renewal fixture listener has no port.');
    const origin = `http://127.0.0.1:${address.port}`;

    /** Close only the listener/connections created by this fixture. */
    async function close(): Promise<void> {
        await new Promise<void>(function closeServer(resolve, reject) {
            server.close(error => { if (error) reject(error); else resolve(); });
            server.closeAllConnections();
        });
    }

    try {
        const response = await fetch(`${origin}/seed`, {method: 'POST'});
        const setCookie = response.headers.get('set-cookie');
        if (!setCookie) throw new Error('The renewal fixture did not persist its cookie session.');
        return {store, origin, cookie: setCookie.split(';', 1)[0]!, setCookie,
            sessionId: await response.text(), close};
    } catch (error) {
        await close();
        throw error;
    }
}

describe('ordinary Session renewal through the real store', () => {
    it('waits for locked expiry SQL before completing HTTP and preserves identity JSON and cookie policy', async () => {
        const fixture = await renewalFixture();
        const repository = AppDataSource.getRepository(Session);
        const runner = AppDataSource.createQueryRunner();
        let response: Promise<{response: globalThis.Response; body: string}> | undefined;
        try {
            // Leave the real stored session valid, but make advancement observable
            // without relying on millisecond differences between HTTP requests.
            await repository.update({id: fixture.sessionId}, {expiredAt: Date.now() + 300_000});
            const before = await repository.findOneByOrFail({id: fixture.sessionId});
            await runner.connect();
            await runner.startTransaction();
            await runner.manager.getRepository(Session).findOneOrFail({where: {id: fixture.sessionId},
                lock: {mode: 'pessimistic_write'}});

            const started = Promise.withResolvers<void>();
            const callbacks: unknown[] = [];
            const renew = fixture.store.touch;
            // Observe the real adapter callback while the second connection's
            // row lock holds its real SQL; do not replace any repository method.
            vi.spyOn(fixture.store, 'touch').mockImplementation(function observeRenewal(id, data, callback): void {
                started.resolve();
                renew.call(fixture.store, id, data, function renewed(error): void {
                    callbacks.push(error);
                    callback?.(error);
                });
            });
            let responseFinished = false;
            response = fetch(`${fixture.origin}/read`, {headers: {cookie: fixture.cookie}}).then(async response => {
                const body = await response.text();
                responseFinished = true;
                return {response, body};
            });
            await started.promise;
            await new Promise<void>(resolve => setImmediate(resolve));
            const pendingCallbacks = callbacks.length;
            const finishedWhileLocked = responseFinished;
            await runner.rollbackTransaction();
            const completed = await response;
            const after = await repository.findOneByOrFail({id: fixture.sessionId});

            expect(pendingCallbacks).toBe(0);
            expect(finishedWhileLocked).toBe(false);
            expect(callbacks).toEqual([undefined]);
            expect(completed.response.status).toBe(200);
            expect(completed.body).toBe('renewed-session');
            expect(completed.response.headers.get('set-cookie')).toBeNull();
            expect(fixture.setCookie).toContain('HttpOnly');
            expect(fixture.setCookie).toContain('SameSite=Lax');
            expect(Number(after.expiredAt)).toBeGreaterThan(Number(before.expiredAt) + 85_000_000);
            expect(after).toMatchObject({id: before.id, json: before.json, destroyedAt: before.destroyedAt});
        } finally {
            if (runner.isTransactionActive) await runner.rollbackTransaction();
            await runner.release();
            await response?.catch(() => undefined);
            await fixture.close();
            vi.restoreAllMocks();
        }
    });

    it('reports one real SQL renewal failure and disconnect without changing the stored session', async () => {
        const fixture = await renewalFixture();
        const repository = AppDataSource.getRepository(Session);
        const before = await repository.findOneByOrFail({id: fixture.sessionId});
        const table = AppDataSource.driver.escape(repository.metadata.tableName);
        let triggerCreated = false;
        try {
            // The guarded suite schema alone receives this temporary rejection.
            await AppDataSource.query(`CREATE TRIGGER reject_session_renewal BEFORE UPDATE ON ${table} FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Controlled renewal SQL failure'`);
            triggerCreated = true;
            const callbacks = vi.fn();
            const completed = Promise.withResolvers<unknown>();
            const disconnected = Promise.withResolvers<unknown>();
            const disconnects = vi.fn();
            fixture.store.once('disconnect', function disconnectedStore(error): void {
                disconnects(error);
                disconnected.resolve(error);
            });
            fixture.store.touch(fixture.sessionId, JSON.parse(before.json) as SessionData, function renewalFailed(error): void {
                callbacks(error);
                completed.resolve(error);
            });
            const failure = await disconnected.promise;
            expect(await completed.promise).toBe(failure);
            expect(failure).toBeInstanceOf(Error);
            expect((failure as Error).message).toContain('Controlled renewal SQL failure');
            expect(callbacks).toHaveBeenCalledExactlyOnceWith(failure);
            expect(disconnects).toHaveBeenCalledExactlyOnceWith(failure);
            expect(await repository.findOneByOrFail({id: fixture.sessionId})).toEqual(before);
        } finally {
            if (triggerCreated) await AppDataSource.query('DROP TRIGGER reject_session_renewal');
            await fixture.close();
        }
    });
});
