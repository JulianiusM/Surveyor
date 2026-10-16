import {describe, expect, it} from 'vitest';
import {QueryClient, QueryObserver} from '@tanstack/vue-query';
import {evictQueryFamilies} from '../../src/frontend/app/queryCache';

describe('denial-producing admission retirement', () => {
    it('preserves a paused denial while retiring older token visits and unrelated copies', async () => {
        const client = new QueryClient();
        const intent = ['event', 'actor', 'event-id', 'entry', 'detail'] as const;
        const current = [...intent, 1] as const;
        const currentKey = [...current, 'en'] as const;
        const previousKey = [...intent, 0, 'en'] as const;
        const otherActor = ['event', 'another-actor', 'event-id', 'entry', 'detail', 0, 'en'] as const;
        const denied = {entry: {kind: 'denied', status: 404}};
        // Initial and security-paused admission still owns an observed query, but
        // it is inactive to TanStack until ordinary read admission resumes.
        const observer = new QueryObserver(client, {queryKey: currentKey, enabled: false, initialData: denied});
        const unsubscribe = observer.subscribe(() => {});
        client.setQueryData(previousKey, {entry: {kind: 'render'}});
        client.setQueryData(otherActor, {entry: {kind: 'render'}});

        try {
            await evictQueryFamilies(client, [intent], 'inactive', current);
            expect(client.getQueryData(currentKey)).toEqual(denied);
            expect(observer.getCurrentResult().data).toEqual(denied);
            expect(client.getQueryData(previousKey)).toBeUndefined();
            expect(client.getQueryData(otherActor)).toEqual({entry: {kind: 'render'}});
        } finally {
            unsubscribe();
            client.clear();
        }
    });
});
