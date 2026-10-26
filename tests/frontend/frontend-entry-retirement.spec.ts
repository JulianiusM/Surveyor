import {describe, expect, it} from 'vitest';
import {QueryClient, QueryObserver} from '@tanstack/vue-query';
import {evictQueryFamilies} from '../../src/frontend/app/queryCache';
import {activityKeys, driversKeys, packingKeys, surveyKeys} from '../../src/frontend/app/queryKeys';
import {entityEntryRetirement} from '../../src/frontend/composables/pageEntry';

describe('denial-producing admission retirement', () => {
    it.each([
        ['packing', packingKeys], ['drivers', driversKeys], ['activity', activityKeys], ['survey', surveyKeys],
    ] as const)('retires %s dependencies while preserving independent admission and live duplicate drafts', async (feature, keys) => {
        for (const status of [403, 404]) {
            const client = new QueryClient();
            const actor = 'current-actor';
            const resource = 'resource-id';
            const prefix = ['v1', actor, feature, resource];
            // Seed actual established tuple spellings: refactoring constructors
            // cannot silently strand old query families outside retirement.
            const detail = [...prefix, 'detail'];
            const editor = [...prefix, 'editors', 'settings'];
            const guest = [...prefix, 'guest'];
            const inactiveCopy = [...prefix, 'duplicate', {eventId: 'inactive'}];
            const liveCopy = [...prefix, 'duplicate', {eventId: 'live'}];
            const currentEntry = [...prefix, 'entry', 'detail', 'en'];
            const otherActor = ['v1', 'other-actor', feature, resource, 'detail'];
            const denied = {entry: {kind: 'denied', status}};
            const denialObserver = new QueryObserver(client, {queryKey: currentEntry, enabled: false, initialData: denied});
            const draftObserver = new QueryObserver(client, {queryKey: liveCopy, staleTime: Infinity, initialData: {title: 'Unfinished copy'}});
            const stopDenial = denialObserver.subscribe(() => {});
            const stopDraft = draftObserver.subscribe(() => {});
            for (const key of [detail, editor, guest, inactiveCopy, otherActor]) client.setQueryData(key, {admitted: true});

            try {
                const selection = entityEntryRetirement({status, actor, resource, intent: 'detail', keys,
                    additionalFamilies: 'events' in keys ? [keys.events(actor)] : []});
                await evictQueryFamilies(client, selection.families);
                await evictQueryFamilies(client, selection.inactiveFamilies ?? [], 'inactive', keys.entry(actor, resource, 'detail'));
                expect(client.getQueryData(detail)).toBeUndefined();
                expect(client.getQueryData(editor)).toBeUndefined();
                expect(client.getQueryData(guest)).toEqual(status === 404 ? undefined : {admitted: true});
                expect(client.getQueryData(inactiveCopy)).toEqual(status === 404 ? undefined : {admitted: true});
                expect(client.getQueryData(liveCopy)).toEqual({title: 'Unfinished copy'});
                expect(client.getQueryData(currentEntry)).toEqual(denied);
                expect(client.getQueryData(otherActor)).toEqual({admitted: true});
            } finally {
                stopDenial(); stopDraft(); client.clear();
            }
        }
    });

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
