/*
 * Copyright 2026 Julian Malovanij
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type {Request} from 'express';
import type {SessionData, Store} from 'express-session';
import {TypeormStore} from 'connect-typeorm';
import type {EntityManager} from 'typeorm';
import {Session} from '../database/entities/session/Session';
import type {SessionLike} from '../../../types/PermissionTypes';
import {APIError} from './errors';

/**
 * Configure ordinary and transaction-bound session stores in one place. A manager
 * supplied by an existing DBAL transaction binds every store query/write to that
 * same connection; constructing a store does not perform cleanup or open a pool.
 */
export function createSessionStore(manager: EntityManager): TypeormStore {
    // These are the existing application options. Cleanup runs only on set;
    // the library remains the owner of TTL, soft-delete and JSON semantics.
    const repository = manager.getRepository(Session);
    const ttl = 60 * 60 * 24;
    const store = new TypeormStore({cleanupLimit: 2, limitSubquery: false, ttl}).connect(repository);

    /** Acknowledge ordinary renewal once, after the existing expiry update settles. */
    store.touch = function renewStoredSession(sessionId, _session, callback): void {
        // connect-typeorm 2.0.0 acknowledges expiry-cookie sessions before this
        // write, then calls back again. Keep its fixed TTL and expiry-only SQL.
        // The promise boundary also catches synchronous query-builder failures.
        void Promise.resolve().then(function updateExpiration() {
            return repository.createQueryBuilder()
                .update({expiredAt: Date.now() + ttl * 1000})
                .whereInIds([sessionId])
                .execute();
        }).then(function renewed(): void {
            callback?.();
        }, function renewalFailed(error: unknown): void {
            callback?.(error);
            store.emit('disconnect', error);
        });
    };

    /** Complete destruction only when the same repository's soft deletion settles.
     * connect-typeorm 2.0.0 drops these promises from Promise.all, acknowledging
     * destruction early and leaking rejected deletes as unhandled rejections. */
    store.destroy = function destroyStoredSessions(sessionIds, callback): void {
        const ids = Array.isArray(sessionIds) ? sessionIds : [sessionIds];
        // Keep library soft-delete and multi-ID semantics on the caller's manager.
        // Starting from a promise also routes synchronous adapter failures here.
        const deletions = ids.map(id => Promise.resolve().then(() => repository.softDelete({id})));
        void Promise.all(deletions).then(function destroyed(): void {
            callback?.();
        }, function destructionFailed(error: unknown): void {
            // The factory has no custom onError; preserve the library's default
            // disconnect notification as well as its optional completion callback.
            callback?.(error);
            store.emit('disconnect', error);
        });
    };
    return store;
}

/** Read through the configured store without replacing a request's in-memory session. */
export function readStoredSession(store: Pick<Store, 'get'>, sessionId: string): Promise<SessionData | undefined> {
    return new Promise(function readSession(resolve, reject) {
        // Library absence includes expired/destroyed sessions. Operational and
        // malformed-JSON failures remain errors rather than identity evidence.
        store.get(sessionId, function finishSessionRead(error, stored) {
            if (error) reject(error);
            else resolve(stored ?? undefined);
        });
    });
}

/** Await library persistence using the caller's bound store, without invoking Express autosave. */
export function writeStoredSession(store: Pick<TypeormStore, 'set'>, sessionId: string, session: Request['session']): Promise<void> {
    return new Promise(function writeSession(resolve, reject) {
        // A transaction-bound store keeps this write atomic with the controller's
        // guest/profile writes. Serialization and SQL failures must roll them back.
        store.set(sessionId, session, function finishSessionWrite(error) {
            if (error) reject(error);
            else resolve();
        });
    });
}

/**
 * Build an isolated Express session from fresh locked store evidence. Inner
 * controller saves defer persistence to the enclosing transaction; they are not
 * commit evidence. Only that owner writes through its bound store and commits.
 * After committed adoption, save acknowledges that durable write instead of
 * overwriting a later actor. Express still renews the response cookie normally.
 */
export function stageIdentitySession(req: Request, stored: Pick<SessionData, 'cookie'> & Partial<SessionData>): Request['session'] {
    // createSession only constructs the Cookie/Session objects. Its detached
    // request keeps the original response's authority untouched during rollback.
    const detachedRequest = {sessionID: req.sessionID, sessionStore: req.sessionStore} as Request;
    // Isolate nested values as well: rollback must not change the middleware's
    // original cookie, identity or flash through an aliased stored object.
    req.sessionStore.createSession(detachedRequest, JSON.parse(JSON.stringify(stored)) as SessionData);
    const staged = detachedRequest.session;

    /** Defer inner persistence before commit; acknowledge the owner's write after adopted completion. */
    function deferOwnedSave(callback?: (error?: unknown) => void): Request['session'] {
        callback?.();
        return staged;
    }

    // Session methods must stay out of its stored JSON. This object is never
    // adopted on rejection, and no further session mutation belongs to its reply.
    Object.defineProperty(staged, 'save', {value: deferOwnedSave, enumerable: false});
    return staged;
}

/**
 * Resolve the acting profile for authenticated API commands, including guest sessions.
 * A submitted profile ID must never select whose personal settings a command changes.
 * Require both an authentication identity and its active profile: a partial/stale session
 * with only one of them is not sufficient. Returning the profile ID keeps account and guest
 * ownership checks on the app's common identity instead of separate user/guest identifiers.
 */
export function requireSessionProfileId(session: SessionLike): string {
    if (!session.profile || !(session.auth?.user || session.auth?.guest)) {
        throw new APIError('Sign in to change this setting', {}, 401);
    }

    return session.profile.id;
}

/**
 * Persist the current session state before continuing the response cycle.
 *
 * Express-session writes changes asynchronously via the configured store.
 * When a handler mutates the session (for example after logging in or out)
 * and immediately redirects, the follow-up request can occasionally arrive
 * before the store has finished writing.  By explicitly awaiting `save()` we
 * make sure the session data has been committed and is visible to the next
 * HTTP request.
 */
export function persistSession(session: Request['session']): Promise<void> {
    /** Observe the existing Session save callback without another store or lifecycle. */
    return new Promise(function awaitSessionSave(resolve, reject) {
        // Keep callback binding on the supplied Session, including scoped staging.
        const save = session.save?.bind(session);
        if (!save) {
            resolve();
            return;
        }

        /** Propagate the existing save's completion; this wrapper never retries it. */
        save(function finishSessionSave(err) {
            // Only the store callback acknowledges persistence or reports its failure.
            if (err) {
                reject(err);
                return;
            }
            resolve();
        });
    });
}

