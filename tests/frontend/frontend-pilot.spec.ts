import {afterEach, describe, expect, it, vi} from 'vitest';
import {MetadataDraft} from '../../src/frontend/composables/metadataDraft';
import {readPacked, writePacked} from '../../src/frontend/composables/packed';
import {PilotApi} from '../../src/frontend/app/api';
import {ApiFailure, ObsoleteRequestError, UnconfirmedResponseError} from '../../src/frontend/app/transport';
import {PackingApi} from '../../src/frontend/features/packing/api';
import {useHelpApi} from '../../src/frontend/features/help/api';
import {canRetryRead, createPilotContext, refreshInterval} from '../../src/frontend/app/context';
import {serializeBootstrap} from '../../src/frontend/app/serializeBootstrap';
import {evictPackingResource} from '../../src/frontend/app/queryCache';
import {overviewKeys, packingKeys} from '../../src/frontend/app/queryKeys';
import type {components} from '../../src/types/api/v1';
import type {PilotRequestScope} from '../../src/types/FrontendPilotUiTypes';

const listId = '11111111-1111-4111-8111-111111111111';
const itemId = '22222222-2222-4222-8222-222222222222';
const scope: PilotRequestScope = {context: 'test-context-1234567890', csrfToken: 'csrf-token-1234567890', epoch: 0, locale: 'en'};

function metadata(values: components['schemas']['PackingMetadata']['values'] = {title: 'Original', description: 'Old note'}): components['schemas']['PackingMetadata'] {
    return {entityType: 'packing', id: listId, values, editableFields: ['title', 'description'],
        currentEventId: null, archived: false, inheritedArchived: false};
}
function session(context = scope.context, locale = 'en'): components['schemas']['SessionView'] {
    return {kind: 'account', deployment: {buildId: 'fixture', apiCompatibility: 'v1-pilot-2026-10-07'}, context, csrfToken: scope.csrfToken, locale,
        activeProfile: {id: itemId, name: 'A profile'}, profiles: [{id: itemId, name: 'A profile'}],
        loginUrl: '/users/login', logoutUrl: '/users/logout', shell: {version: 'fixture', imprintUrl: '/imprint',
            privacyPolicyUrl: '/privacy', localLoginEnabled: true, oidcEnabled: false, oidcName: 'Identity provider'}};
}
function response(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
    return new Response(JSON.stringify(data), {status, headers: {'content-type': 'application/json',
        'X-Surveyor-Context': scope.context, ...headers}});
}
function deferred<T>() {
    let resolve!: (result: T) => void;
    const promise = new Promise<T>(finish => { resolve = finish; });
    return {promise, resolve};
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('packing draft reconciliation', () => {
    it('adopts disjoint remote changes while keeping the sparse local draft', () => {
        const draft = new MetadataDraft(metadata(), '"a"');
        draft.values.description = 'My note';
        draft.receive(metadata({title: 'Remote title', description: 'Old note'}), '"b"');
        expect(draft.etag).toBe('"b"');
        expect(draft.values).toEqual({title: 'Remote title', description: 'My note'});
        expect(draft.patch).toEqual({description: 'My note'});
        expect(draft.remote).toBeNull();
        expect(draft.patch).toEqual({description: 'My note'});
    });

    it('requires an explicit same-field choice and does not carry newly forbidden fields into reapply', () => {
        const draft = new MetadataDraft(metadata(), '"a"');
        draft.values.title = 'Mine';
        draft.receive(metadata({title: 'Theirs', description: 'Old note'}), '"b"');
        expect(draft.conflicts).toEqual(['title']);
        expect(draft.review()).toBe(false);
        draft.choices.title = 'current';
        expect(draft.review()).toBe(true);
        expect(draft.dirty).toBe(false);
        draft.values.description = 'No longer allowed';
        draft.receive({...metadata({title: 'Theirs'}), editableFields: ['title']}, '"c"');
        expect(draft.review()).toBe(true);
        expect(draft.patch).toEqual({});
        expect(draft.values).not.toHaveProperty('description');
    });

    it('submits an explicit cleared description but never invents an omitted title field', () => {
        const draft = new MetadataDraft({...metadata({description: 'Old note'}), editableFields: ['description']}, '"a"');
        draft.values.description = '';
        expect(draft.patch).toEqual({description: null});
        draft.accept({...metadata({description: null}), editableFields: ['description']}, '"b"');
        expect(draft.dirty).toBe(false);
    });
});

describe('typed pilot transport', () => {
    it('admits an identity transition only when the response confirms its new context', async () => {
        const current = session('new-context-1234567890');
        const result: components['schemas']['IdentityResult'] = {session: current, personalLink: null, redirect: null};
        const invalidate = vi.fn();
        const send = vi.fn(async (_input: RequestInfo | URL) => response(result, 200, {'X-Surveyor-Context': current.context}));
        const api = new PilotApi(() => true, invalidate, send);
        expect(await api.login({username: 'A profile', password: 'correct password'}, scope)).toEqual(result);
        const request = send.mock.calls[0]?.[0] as Request | undefined;
        expect(request?.headers.get('X-Surveyor-Context')).toBe(scope.context);
        expect(request?.headers.get('X-CSRF-Token')).toBe(scope.csrfToken);
        expect(invalidate).not.toHaveBeenCalled();

        const wrongHeader = new PilotApi(() => true, invalidate, vi.fn(async () => response(result)));
        await expect(wrongHeader.login({username: 'A profile', password: 'correct password'}, scope))
            .rejects.toBeInstanceOf(UnconfirmedResponseError);
        expect(invalidate).not.toHaveBeenCalled();
    });

    it('keeps the admitted identity after a confirmed invalid-credentials rejection', async () => {
        const problem: components['schemas']['Problem'] = {type: 'about:blank', title: 'Unauthorized', status: 401,
            detail: 'The credentials are invalid.', requestId: 'login-request', code: 'INVALID_CREDENTIALS',
            messageKey: 'api:errors.INVALID_CREDENTIALS', params: {}};
        const invalidate = vi.fn();
        const api = new PilotApi(() => true, invalidate, vi.fn(async () => response(problem, 401)));
        await expect(api.login({username: 'A profile', password: 'incorrect password'}, scope))
            .rejects.toMatchObject({status: 401, problem});
        expect(invalidate).not.toHaveBeenCalled();
    });

    it('sends captured identity, locale, CSRF and edit token with the narrow metadata patch', async () => {
        let request!: Request;
        const api = new PackingApi(new PilotApi(() => true, vi.fn(), vi.fn(async (input: RequestInfo | URL) => {
            request = input as Request;
            return response(metadata({title: 'Saved', description: 'Old note'}), 200, {ETag: '"b"'});
        })));
        const saved = await api.saveMetadata(listId, {title: 'Saved'}, '"a"', scope);
        expect(request.url).toBe(`http://localhost/api/v1/packing-lists/${listId}/metadata`);
        expect(request.headers.get('X-Surveyor-Context')).toBe(scope.context);
        expect(request.headers.get('X-CSRF-Token')).toBe(scope.csrfToken);
        expect(request.headers.get('X-Surveyor-Locale')).toBe('en');
        expect(request.headers.get('If-Match')).toBe('"a"');
        expect(await request.json()).toEqual({title: 'Saved'});
        expect(saved.etag).toBe('"b"');
    });

    it('preserves a conditional read snapshot on 304 and rejects undeclared empty mutation success', async () => {
        const previous = {data: metadata(), etag: '"a"'};
        const api = new PackingApi(new PilotApi(() => true, vi.fn(), vi.fn(async () => new Response(null,
            {status: 304, headers: {'X-Surveyor-Context': scope.context}}))));
        expect(await api.metadata(listId, scope, undefined, previous)).toBe(previous);
        const empty = new PackingApi(new PilotApi(() => true, vi.fn(), vi.fn(async () => new Response(null, {status: 204}))));
        await expect(empty.assign(listId, itemId, true, scope)).rejects.toBeInstanceOf(UnconfirmedResponseError);
    });
    it.each([201, 202])('rejects undeclared assignment success status %s even with a valid body', async status => {
        const data = {listId, itemId, selfAssigned: true, assignedCount: 1, maxAssignees: 1};
        const api = new PackingApi(new PilotApi(() => true, vi.fn(), vi.fn(async () => response(data, status))));
        await expect(api.assign(listId, itemId, true, scope)).rejects.toBeInstanceOf(UnconfirmedResponseError);
    });

    it('rejects an obsolete successful response and never retries a command after a lost response', async () => {
        const result = deferred<Response>();
        let current = true;
        const send = vi.fn(() => result.promise);
        const api = new PackingApi(new PilotApi(() => current, vi.fn(), send));
        const pending = api.assign(listId, itemId, true, scope);
        current = false;
        result.resolve(response({listId, itemId, selfAssigned: true, assignedCount: 1, maxAssignees: 1}));
        await expect(pending).rejects.toBeInstanceOf(ObsoleteRequestError);
        expect(send).toHaveBeenCalledOnce();
        const lost = vi.fn(async () => { throw new TypeError('connection lost'); });
        await expect(new PackingApi(new PilotApi(() => true, vi.fn(), lost)).assign(listId, itemId, true, scope)).rejects.toThrow('connection lost');
        expect(lost).toHaveBeenCalledOnce();
    });

    it('does not accept an unexpected body or invalidate a new context because of an old unauthorized response', async () => {
        const invalidate = vi.fn();
        const malformed = new PackingApi(new PilotApi(() => true, invalidate, vi.fn(async () => response({status: 'success'}))));
        await expect(malformed.metadata(listId, scope)).rejects.toBeInstanceOf(UnconfirmedResponseError);
        const old = new PackingApi(new PilotApi(() => false, invalidate, vi.fn(async () => response({}, 401))));
        await expect(old.metadata(listId, scope)).rejects.toBeInstanceOf(ObsoleteRequestError);
        expect(invalidate).not.toHaveBeenCalled();
    });

    it('requires actor confirmation on private successes and safely displays unknown problem details', async () => {
        const invalidate = vi.fn();
        const missingHeader = new PackingApi(new PilotApi(() => true, invalidate, vi.fn(async () => new Response(JSON.stringify(metadata()),
            {headers: {'Content-Type': 'application/json', ETag: '"a"'}}))));
        await expect(missingHeader.metadata(listId, scope)).rejects.toBeInstanceOf(UnconfirmedResponseError);
        const futureProblem = {type: 'https://surveyor.invalid/problems/future', title: 'Future rejection',
            status: 409, detail: 'Safe explanation from the server', requestId: 'request-12345', code: 'FUTURE_CODE'};
        const api = new PackingApi(new PilotApi(() => true, invalidate, vi.fn(async () => response(futureProblem, 409))));
        await expect(api.metadata(listId, scope)).rejects.toMatchObject({status: 409, problem: null,
            message: futureProblem.detail});
        const wrongStatus = new PackingApi(new PilotApi(() => true, invalidate,
            vi.fn(async () => response({...futureProblem, status: 401, code: 'SESSION_CONTEXT_CHANGED'}, 409))));
        await expect(wrongStatus.metadata(listId, scope)).rejects.toMatchObject({status: 409, problem: null, message: 'HTTP 409'});
        expect(invalidate).not.toHaveBeenCalled();
    });

    it('enforces server cooldown even when a new manual or focus caller has no prior query error', async () => {
        const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
        const send = vi.fn(async () => response({}, 429, {'Retry-After': '90'}));
        const api = new PackingApi(new PilotApi(() => true, vi.fn(), send));
        await expect(api.metadata(listId, scope)).rejects.toMatchObject({retryAt: 91_000});
        now.mockReturnValue(2000);
        await expect(api.metadata(listId, scope)).rejects.toMatchObject({retryAfter: 89_000});
        await expect(api.metadata(listId, {...scope, locale: 'de'})).rejects.toMatchObject({retryAfter: 89_000});
        expect(send).toHaveBeenCalledOnce();
        now.mockReturnValue(91_001);
        await expect(api.metadata(listId, scope)).rejects.toBeInstanceOf(ApiFailure);
        expect(send).toHaveBeenCalledTimes(2);
    });

    it('rejects an old-locale help response while an identity-equivalent metadata scope remains usable', async () => {
        const pendingHelp = deferred<Response>();
        const context = createPilotContext({session: session()}, false, vi.fn(() => pendingHelp.promise));
        const captured = context.capture();
        const result = useHelpApi(context).help({}, captured);
        context.locale.value = 'de';
        expect(context.isCurrent(captured)).toBe(true);
        expect(context.isCurrent(captured, true)).toBe(false);
        pendingHelp.resolve(response({locale: 'en', title: 'Help', content: '', docsList: [], docsGroups: [], currentDoc: 'index', toc: []}));
        await expect(result).rejects.toBeInstanceOf(ObsoleteRequestError);
        context.queryClient.clear();
    });
});

describe('identity, refresh and local state boundaries', () => {
    it('discards an in-flight old bootstrap before confirming a successful identity transition', async () => {
        const old = deferred<Response>();
        const fresh = deferred<Response>();
        const send = vi.fn().mockImplementationOnce(() => old.promise).mockImplementationOnce(() => fresh.promise);
        const context = createPilotContext({session: session()}, false, send);
        const captured = context.capture();
        context.queryClient.setQueryData(['private'], 'Previous profile data');
        const beforeLogin = context.refreshSession();
        const current = session('new-context-1234567890');
        const accepted = context.acceptIdentity({session: current, personalLink: 'https://example.test/private-link', redirect: null});
        expect(context.ready.value).toBe(false);
        expect(context.isCurrent(captured)).toBe(false);
        expect(context.queryClient.getQueryData(['private'])).toBeUndefined();
        expect(context.personalLink.value).toBeNull();
        old.resolve(response(session()));
        await beforeLogin;
        await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
        expect(context.ready.value).toBe(false);
        fresh.resolve(response(current, 200, {'X-Surveyor-Context': current.context}));
        await accepted;
        expect(context.ready.value).toBe(true);
        expect(context.session.value.context).toBe(current.context);
        expect(context.personalLink.value).toBe('https://example.test/private-link');
        expect(send).toHaveBeenCalledTimes(2);
        context.queryClient.clear();
    });

    it('serializes rapid language changes so the final explicit preference also owns the final cookie response', async () => {
        const german = deferred<Response>();
        const english = deferred<Response>();
        const send = vi.fn().mockImplementationOnce(() => german.promise).mockImplementationOnce(() => english.promise);
        const context = createPilotContext({session: session()}, false, send);
        const first = context.changeLocale('de');
        const latest = context.changeLocale('en');
        expect(first).toBe(latest);
        expect(send).toHaveBeenCalledOnce();
        german.resolve(response(session(scope.context, 'de')));
        await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
        expect(await (send.mock.calls[1][0] as Request).json()).toEqual({locale: 'en'});
        english.resolve(response(session()));
        await latest;
        expect(context.locale.value).toBe('en');
        expect(context.epoch.value).toBe(0);
        context.queryClient.clear();
    });

    it('evicts denied-list projections and containing query families while retaining unrelated resources and actors', async () => {
        const context = createPilotContext({session: session()}, false);
        const removed = [packingKeys.detail(scope.context, listId, 'en'),
            packingKeys.metadata(scope.context, listId, 'de'), packingKeys.profiles(scope.context, listId, 'organizer'),
            packingKeys.guest(scope.context, listId),
            overviewKeys.region(scope.context, 'en', {collection: 'owner', region: 'main'}),
            overviewKeys.region(scope.context, 'de', {collection: 'participant', region: 'hidden'}),
            packingKeys.eventPage(scope.context, 'en', '', {selectedId: listId})];
        const retained = [packingKeys.detail(scope.context, itemId, 'en'),
            packingKeys.detail('other-actor', listId, 'en'), overviewKeys.all('other-actor'),
            ['v1', scope.context, 'en', 'help']];
        for (const key of [...removed, ...retained]) context.queryClient.setQueryData(key, 'private snapshot');
        await evictPackingResource(context.queryClient, scope.context, listId);
        for (const key of removed) expect(context.queryClient.getQueryData(key)).toBeUndefined();
        for (const key of retained) expect(context.queryClient.getQueryData(key)).toBe('private snapshot');
        context.queryClient.clear();
    });

    it('cancels an in-flight containing overview read before it can restore an evicted private card', async () => {
        const context = createPilotContext({session: session()}, false);
        const result = deferred<{title: string}>();
        const key = overviewKeys.region(scope.context, 'en', {collection: 'owner', region: 'main'});
        let signal!: AbortSignal;
        const pending = context.queryClient.fetchQuery({queryKey: key, queryFn: (query) => {
            signal = query.signal;
            return result.promise;
        }}).catch(() => undefined);
        await evictPackingResource(context.queryClient, scope.context, listId);
        expect(signal.aborted).toBe(true);
        result.resolve({title: 'Private title from before revocation'});
        await pending;
        expect(context.queryClient.getQueryData(key)).toBeUndefined();
        context.queryClient.clear();
    });
    it('isolates request-local query clients and locale while discarding an old private scope on bootstrap change', async () => {
        const first = createPilotContext({session: session()}, false, vi.fn(async () => response(session('new-context-1234567890', 'de'))));
        const second = createPilotContext({session: session('other-context-1234567890', 'de')}, false);
        const captured = first.capture();
        first.queryClient.setQueryData(['private'], {title: 'Only first user'});
        expect(second.queryClient.getQueryData(['private'])).toBeUndefined();
        expect(first.messages.value.locale).toBe('en');
        expect(second.messages.value.locale).toBe('de');
        await first.refreshSession();
        expect(first.isCurrent(captured)).toBe(false);
        expect(first.queryClient.getQueryData(['private'])).toBeUndefined();
        expect(first.locale.value).toBe('de');
        first.queryClient.clear(); second.queryClient.clear();
    });

    it('keeps the exact legacy local Packed key and tolerates unavailable storage', () => {
        const values = new Map([[`packed_${listId}_${itemId}`, '1']]);
        const storage = {getItem: (key: string) => values.get(key) ?? null,
            setItem: (key: string, value: string) => { values.set(key, value); },
            removeItem: (key: string) => { values.delete(key); }};
        expect(readPacked(storage, listId, itemId)).toBe(true);
        writePacked(storage, listId, itemId, false);
        expect(values.size).toBe(0);
        writePacked(storage, listId, itemId, true);
        expect([...values.keys()]).toEqual([`packed_${listId}_${itemId}`]);
        expect(readPacked({getItem: () => { throw new Error('blocked'); }}, listId, itemId)).toBe(false);
    });

    it('suppresses obsolete/forbidden polling and honors server retry delay', () => {
        expect(refreshInterval(new ObsoleteRequestError(), 0, 1000)).toBe(false);
        expect(refreshInterval(new ApiFailure(403, null), 0, 1000)).toBe(false);
        const rateLimited = new ApiFailure(429, null, 90_000);
        expect(refreshInterval(rateLimited, 0, 1000)).toBeGreaterThanOrEqual(89_900);
        expect(canRetryRead(rateLimited)).toBe(false);
        expect(refreshInterval(new Error('offline'), 3, 1000)).toBe(120_000);
    });

    it('serializes hostile text as inert bootstrap JSON without changing the decoded value', () => {
        const bootstrap = {session: {...session(), activeProfile: {id: itemId, name: '</script><script>alert(1)</script>&\u2028'}}};
        const encoded = serializeBootstrap(bootstrap);
        expect(encoded).not.toContain('<');
        expect(encoded).not.toContain('&');
        expect(JSON.parse(encoded)).toEqual(bootstrap);
    });
});
