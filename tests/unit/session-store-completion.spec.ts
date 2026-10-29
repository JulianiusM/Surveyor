import {describe, expect, it, vi} from 'vitest';
import type {EntityManager} from 'typeorm';
import {createSessionStore} from '../../src/backend/modules/database/services/UserService';

/** Replace only the asynchronous repository boundary; exercise the actual configured store adapter. */
function storeWithDeletion(remove: (criteria: {id: string}) => Promise<unknown>) {
    const manager = {getRepository: () => ({softDelete: remove})} as unknown as EntityManager;
    return createSessionStore(manager);
}

/** Hold only the expiry SQL boundary while retaining the configured production store. */
function storeWithRenewal(execute: () => Promise<unknown>) {
    const builder = {
        update: vi.fn().mockReturnThis(),
        whereInIds: vi.fn().mockReturnThis(),
        execute: vi.fn(execute),
    };
    const repository = {createQueryBuilder: vi.fn(() => builder)};
    const manager = {getRepository: () => repository} as unknown as EntityManager;
    return {store: createSessionStore(manager), repository, builder};
}

describe('configured session renewal completion', () => {
    it('does not acknowledge renewal while its expiry update is pending', async () => {
        let release!: (result: unknown) => void;
        const renewal = new Promise(resolve => { release = resolve; });
        const {store, builder} = storeWithRenewal(() => renewal);
        // Existing browser sessions have an expiry cookie. Its presence must not
        // acknowledge a SQL write before that write has actually completed.
        const session = {cookie: {expires: new Date(), maxAge: 60_000}, frontendContext: 'synthetic-generation'};
        const original = JSON.stringify(session);
        const complete = vi.fn();
        const settled = new Promise<void>(resolve => store.touch('synthetic-session', session, error => {
            complete(error);
            resolve();
        }));
        await Promise.resolve();
        const pendingCallbacks = complete.mock.calls.length;
        release({affected: 1});
        await settled;
        await renewal;
        await Promise.resolve();
        expect(pendingCallbacks).toBe(0);
        expect(complete).toHaveBeenCalledExactlyOnceWith(undefined);
        expect(builder.whereInIds).toHaveBeenCalledExactlyOnceWith(['synthetic-session']);
        expect(builder.execute).toHaveBeenCalledOnce();
        expect(JSON.stringify(session)).toBe(original);
    });

    it('reports a rejected pending update once without acknowledging success first', async () => {
        const failure = new Error('Controlled renewal failure');
        let rejectUpdate!: (error: Error) => void;
        const renewal = new Promise((_, reject) => { rejectUpdate = reject; });
        const {store} = storeWithRenewal(() => renewal);
        const complete = vi.fn();
        const disconnected = vi.fn();
        store.on('disconnect', disconnected);
        const settled = new Promise<unknown>(resolve => store.touch('synthetic-session',
            {cookie: {expires: new Date()}}, error => {
                complete(error);
                resolve(error);
            }));
        await Promise.resolve();
        const pendingCallbacks = complete.mock.calls.length;
        rejectUpdate(failure);
        expect(await settled).toBe(failure);
        expect(pendingCallbacks).toBe(0);
        expect(complete).toHaveBeenCalledExactlyOnceWith(failure);
        expect(disconnected).toHaveBeenCalledExactlyOnceWith(failure);
    });

    it.each([true, false])('retains the one-day expiry-only update when cookie expiry exists: %s', async hasExpiry => {
        const now = 1_800_000_000_000;
        const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
        try {
            const {store, repository, builder} = storeWithRenewal(async () => ({affected: 1}));
            // The configured store TTL remains authoritative, even when a
            // browser cookie has a shorter remaining lifetime or no expiry.
            const session = {cookie: {expires: hasExpiry ? new Date(now + 60_000) : undefined, maxAge: 60_000},
                frontendContext: 'synthetic-generation'};
            const original = JSON.stringify(session);
            await new Promise<void>((resolve, reject) => store.touch('synthetic-session', session, error => {
                if (error) reject(error); else resolve();
            }));
            expect(repository.createQueryBuilder).toHaveBeenCalledExactlyOnceWith();
            expect(builder.update).toHaveBeenCalledExactlyOnceWith({expiredAt: now + 86_400_000});
            expect(builder.whereInIds).toHaveBeenCalledExactlyOnceWith(['synthetic-session']);
            expect(JSON.stringify(session)).toBe(original);
        } finally {
            clock.mockRestore();
        }
    });

    it.each(['query creation', 'execution'])('reports synchronous %s failure through the same completion', async boundary => {
        const failure = new Error(`Controlled synchronous ${boundary} failure`);
        const {store, repository} = storeWithRenewal(() => { throw failure; });
        if (boundary === 'query creation') {
            repository.createQueryBuilder.mockImplementation(() => { throw failure; });
        }
        const complete = vi.fn();
        const disconnected = vi.fn();
        store.on('disconnect', disconnected);
        let finish!: (error: unknown) => void;
        const settled = new Promise(resolve => { finish = resolve; });
        expect(() => store.touch('synthetic-session', {cookie: {}}, error => {
            complete(error);
            finish(error);
        })).not.toThrow();
        expect(await settled).toBe(failure);
        expect(complete).toHaveBeenCalledExactlyOnceWith(failure);
        expect(disconnected).toHaveBeenCalledExactlyOnceWith(failure);
    });

    it('retains disconnect error reporting when no completion callback was supplied', async () => {
        const failure = new Error('Controlled callback-free renewal failure');
        const {store} = storeWithRenewal(async () => { throw failure; });
        const disconnected = vi.fn();
        const settled = new Promise<unknown>(resolve => store.once('disconnect', error => {
            disconnected(error);
            resolve(error);
        }));
        store.touch('synthetic-session', {cookie: {expires: new Date()}});
        expect(await settled).toBe(failure);
        expect(disconnected).toHaveBeenCalledExactlyOnceWith(failure);
    });
});

describe('configured session destruction completion', () => {
    it('does not acknowledge destruction while its soft deletion is pending', async () => {
        let release!: (result: unknown) => void;
        const deletion = new Promise(resolve => { release = resolve; });
        const store = storeWithDeletion(() => deletion);
        const complete = vi.fn();
        const settled = new Promise<void>((resolve, reject) => store.destroy('synthetic-session', error => {
            complete(error);
            if (error) reject(error); else resolve();
        }));
        await Promise.resolve();
        await Promise.resolve();
        expect(complete).not.toHaveBeenCalled();
        release({affected: 1});
        await settled;
        expect(complete).toHaveBeenCalledExactlyOnceWith(undefined);
    });

    it('reports rejected deletion once through callback and the existing disconnect event', async () => {
        const failure = new Error('Controlled deletion failure');
        const store = storeWithDeletion(async () => { throw failure; });
        const disconnected = vi.fn();
        store.on('disconnect', disconnected);
        const result = await new Promise<unknown>(resolve => store.destroy(['first', 'second'], resolve));
        expect(result).toBe(failure);
        expect(disconnected).toHaveBeenCalledExactlyOnceWith(failure);
    });
});
