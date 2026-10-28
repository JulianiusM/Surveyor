import {describe, expect, it, vi} from 'vitest';
import type {EntityManager} from 'typeorm';
import {createSessionStore} from '../../src/backend/modules/lib/session';

/** Replace only the asynchronous repository boundary; exercise the actual configured store adapter. */
function storeWithDeletion(remove: (criteria: {id: string}) => Promise<unknown>) {
    const manager = {getRepository: () => ({softDelete: remove})} as unknown as EntityManager;
    return createSessionStore(manager);
}

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
