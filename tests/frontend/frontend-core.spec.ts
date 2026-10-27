import {apiCompatibility} from '../../.generated/api/v1/policy.mjs';
import {flushFrontendPromises as flushPromises} from '../keywords/frontendUiKeywords';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {MetadataDraft} from '../../src/frontend/composables/metadataDraft';
import {readPacked, writePacked} from '../../src/frontend/features/packing/packed';
import {FrontendApi} from '../../src/frontend/app/api';
import {ApiFailure, InvalidInputError, ObsoleteRequestError, UnconfirmedResponseError} from '../../src/frontend/app/transport';
import {PackingApi} from '../../src/frontend/features/packing/api';
import {useHelpApi} from '../../src/frontend/features/help/api';
import {canRetryRead, createFrontendContext, refreshInterval} from '../../src/frontend/app/context';
import {decodeBootstrap, serializeBootstrap} from '../../src/frontend/app/serializeBootstrap';
import {evictQueryFamilies} from '../../src/frontend/app/queryCache';
import {helpKeys, overviewKeys, packingKeys} from '../../src/frontend/app/queryKeys';
import type {components} from '../../src/types/api/v1';
import type {FrontendMetadataFieldPolicy, FrontendMetadataSnapshot, FrontendRequestScope} from '../../src/types/FrontendUiTypes';

const listId = '11111111-1111-4111-8111-111111111111';
const itemId = '22222222-2222-4222-8222-222222222222';
const scope = {context: 'test-context-1234567890', csrfToken: 'csrf-token-1234567890', epoch: 0, locale: 'en'} satisfies FrontendRequestScope;
type Metadata = components['schemas']['PackingMetadata'];
const packingFieldPolicy: FrontendMetadataFieldPolicy<Metadata['values']> = {description: normalizeNullableText};

function normalizeNullableText(value: string | null | undefined): string | null | undefined {
    return value === '' ? null : value;
}

function metadata(values: components['schemas']['PackingMetadata']['values'] = {title: 'Original', description: 'Old note'}): components['schemas']['PackingMetadata'] {
    return {entityType: 'packing', id: listId, values, editableFields: ['title', 'description'],
        currentEventId: null, archived: false, inheritedArchived: false};
}
function session(context = scope.context, locale = 'en'): components['schemas']['SessionView'] & {context: string; csrfToken: string} {
    return {kind: 'account', deployment: {buildId: 'fixture', apiCompatibility}, context, csrfToken: scope.csrfToken, locale,
        activeProfile: {id: itemId, name: 'A profile'}, profiles: [{id: itemId, name: 'A profile'}],
        loginUrl: '/users/login', logoutUrl: '/users/logout', shell: {version: 'fixture', imprintUrl: '/imprint',
            privacyPolicyUrl: '/privacy', localLoginEnabled: true, oidcEnabled: false, oidcName: 'Identity provider'}};
}
/** Public bootstrap retains the complete shell without a stored visitor identifier. */
function sessionless(): components['schemas']['SessionView'] {
    return {...session(), kind: 'anonymous', context: null, csrfToken: null,
        activeProfile: null, profiles: [], logoutUrl: null};
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

describe('sessionless initial frontend scope', () => {
    it('keeps paired null evidence through the real bootstrap codec and rejects a partial pair', async () => {
        const bootstrap = {session: sessionless(), initialUrl: '/help'};
        expect(await decodeBootstrap(JSON.parse(serializeBootstrap(bootstrap)))).toEqual(bootstrap);
        for (const evidence of [{context: null, csrfToken: scope.csrfToken}, {context: scope.context, csrfToken: null}]) {
            await expect(decodeBootstrap({...bootstrap, session: {...bootstrap.session, ...evidence}}))
                .rejects.toThrow('Invalid frontend bootstrap');
        }
        await expect(decodeBootstrap({...bootstrap, session: {...session(), context: null, csrfToken: null}}))
            .rejects.toThrow('Invalid frontend bootstrap');

        // An explicit logout can leave a stored anonymous session. Its complete
        // evidence stays valid; principal kind never substitutes for that pair.
        const storedAnonymous = {...sessionless(), context: scope.context, csrfToken: scope.csrfToken};
        expect(await decodeBootstrap({session: storedAnonymous})).toEqual({session: storedAnonymous});

        // Public recovery can finish without creating a session. Its document
        // completion belongs to this same null scope and still survives hydration.
        const completed = {...bootstrap, pageCompletion: {context: null, destination: '/help',
            messageKey: 'auth.recoverySent' as const, kind: 'success' as const}};
        expect(await decodeBootstrap(JSON.parse(serializeBootstrap(completed)))).toEqual(completed);
    });

    it('keeps ordinary read readiness and cached public content across a sessionless bootstrap', async () => {
        const send = vi.fn(async (_input: RequestInfo | URL) => new Response(JSON.stringify(sessionless()), {
            headers: {'Content-Type': 'application/json'},
        }));
        const context = createFrontendContext({session: sessionless()}, false, send);
        const captured = context.capture();
        const key = helpKeys.page(captured.context, captured.locale, {doc: 'packing_lists'});
        context.queryClient.setQueryData(key, 'admitted public content');
        try {
            await context.refreshSession();
            expect(context.capture()).toEqual({context: null, csrfToken: null, epoch: 0, locale: 'en'});
            expect(context.ready.value).toBe(true);
            expect(context.mayRead(captured)).toBe(true);
            expect(context.queryClient.getQueryData(key)).toBe('admitted public content');
            const request = send.mock.calls[0]?.[0] as Request | undefined;
            expect(request?.url).toContain('/api/v1/session');
            expect(request?.headers.has('X-Surveyor-Context')).toBe(false);
            expect(request?.headers.has('X-CSRF-Token')).toBe(false);
        } finally { context.start()(); }
    });

    it('reads public Help without fabricated headers while retaining locale and response validation', async () => {
        const help: components['schemas']['HelpPageData'] = {locale: 'en', title: 'Public Help', content: '<p>A task</p>',
            currentDoc: 'fixture.md', docsList: [], docsGroups: [], toc: []};
        const send = vi.fn(async (_input: RequestInfo | URL) => new Response(JSON.stringify(help), {headers: {'Content-Type': 'application/json'}}));
        const context = createFrontendContext({session: sessionless()}, false, send);
        try {
            expect(await useHelpApi(context).help({}, context.capture())).toEqual(help);
            const request = send.mock.calls[0]?.[0] as Request | undefined;
            expect(request?.headers.get('X-Surveyor-Locale')).toBe('en');
            expect(request?.headers.has('X-Surveyor-Context')).toBe(false);
            expect(request?.headers.has('X-CSRF-Token')).toBe(false);
        } finally { context.start()(); }
    });

    it('admits a first deliberate login only from its confirmed resulting server context', async () => {
        const current = session('first-login-context');
        const result: components['schemas']['IdentityResult'] = {session: current, personalLink: null, redirect: null};
        const send = vi.fn(async (_input: RequestInfo | URL) => response(result, 200, {'X-Surveyor-Context': current.context!}));
        const api = new FrontendApi(() => true, vi.fn(), send);
        const anonymousScope: FrontendRequestScope = {context: null, csrfToken: null, epoch: 0, locale: 'en'};
        expect(await api.login({username: 'Account', password: 'correct password'}, anonymousScope)).toEqual(result);
        const request = send.mock.calls[0]?.[0] as Request | undefined;
        expect(request?.headers.has('X-Surveyor-Context')).toBe(false);
        expect(request?.headers.has('X-CSRF-Token')).toBe(false);
        expect(request?.headers.get('X-Surveyor-Api-Compatibility')).toBe(apiCompatibility);
        expect(send).toHaveBeenCalledOnce();
    });

    it('retires sessionless scope and its cache when a real server identity is observed', async () => {
        const current = session('newly-authenticated-context');
        const send = vi.fn(async () => response(current, 200, {'X-Surveyor-Context': current.context!}));
        const context = createFrontendContext({session: sessionless()}, false, send);
        const captured = context.capture();
        const key = helpKeys.page(null, 'en', {});
        context.queryClient.setQueryData(key, 'old anonymous visit');
        try {
            await context.refreshSession();
            expect(context.session.value?.context).toBe(current.context);
            expect(context.epoch.value).toBe(1);
            expect(context.isCurrent(captured)).toBe(false);
            expect(context.queryClient.getQueryData(key)).toBeUndefined();
        } finally { context.start()(); }
    });

    it('rejects an unexpected stored context instead of adopting its response into a sessionless read', async () => {
        const changed = vi.fn();
        const api = new FrontendApi(() => true, changed);
        const anonymousScope: FrontendRequestScope = {context: null, csrfToken: null, epoch: 0, locale: 'en'};
        expect(() => api.checkScope(response({}, 200), anonymousScope)).toThrow(ObsoleteRequestError);
        expect(changed).toHaveBeenCalledOnce();
        expect(() => api.checkScope(new Response(null, {status: 304}), scope)).toThrow(UnconfirmedResponseError);
    });

    it('does not submit partial evidence from a malformed internal caller', () => {
        const api = new FrontendApi(() => true, vi.fn());
        expect(() => api.headers({...scope, csrfToken: null} as FrontendRequestScope)).toThrow(InvalidInputError);
    });
});

describe('complete frontend bootstrap boundary', () => {
    it.each(['packing.notFound', 'packing.eventRegistrationRequired', 'common.notAllowed'] as const)(
        'preserves native admission label %s across the actual browser decoder', async packingError => {
            const bootstrap = {session: session(), initialUrl: `/packing/${listId}/duplicate`, packingError};
            expect(await decodeBootstrap(JSON.parse(serializeBootstrap(bootstrap)))).toEqual(bootstrap);
        },
    );

    it('preserves server-owned entry, notice and completion together through the wire codec', async () => {
        const bootstrap = {session: session(), initialUrl: '/guest/recovery',
            pageEntry: {kind: 'denied' as const, status: 401, messageKey: 'auth.invalidGuestLink'},
            pageNotice: {kind: 'error' as const, messageKey: 'auth.sessionExpired'},
            pageCompletion: {context: scope.context, destination: '/guest/recovery',
                messageKey: 'auth.recoverySent' as const, kind: 'success' as const}};
        expect(await decodeBootstrap(JSON.parse(serializeBootstrap(bootstrap)))).toEqual(bootstrap);
    });

    it('preserves an admitted initial event through the real bootstrap codec and rejects malformed selection data', async () => {
        const selectedEvent: components['schemas']['EventPickerOption'] = {id: listId, title: 'Admitted contextual event',
            description: null, startDate: '2026-10-07', endDate: '2026-10-08', archived: false, deadlinePassed: false};
        for (const packingSelectedEvent of [selectedEvent, null]) {
            const bootstrap = {session: session(), packingSelectedEvent};
            expect(await decodeBootstrap(JSON.parse(serializeBootstrap(bootstrap)))).toEqual(bootstrap);
        }
        await expect(decodeBootstrap({session: session(), packingSelectedEvent: {...selectedEvent, id: 'invalid'}}))
            .rejects.toThrow('Invalid frontend bootstrap');
    });

    it.each([
        {pageEntry: {kind: 'denied', status: '401', messageKey: 'auth.invalidGuestLink'}},
        {pageNotice: {kind: 'executable', messageKey: 'auth.sessionExpired'}},
        {pageCompletion: {context: scope.context, destination: '/guest/recovery', messageKey: 'unknown', kind: 'success'}},
        {identityFields: {password: 'must never enter bootstrap'}},
        {packingError: 'api:errors.FORBIDDEN'},
        {undeclaredField: true},
    ])('rejects malformed or undeclared initial state %j before mounting', async invalid => {
        await expect(decodeBootstrap({session: session(), ...invalid})).rejects.toThrow('Invalid frontend bootstrap');
    });
});

describe('packing draft reconciliation', () => {
    it('keeps confirmed values separate from the last read token and grants until fresh authority arrives', () => {
        const original = {...metadata(), editableFields: ['title'] as const};
        const draft = new MetadataDraft<Metadata['values'], Metadata>({...original, editableFields: ['title']}, '"original"');
        draft.values.title = 'Submitted';
        draft.confirm(metadata({title: 'Submitted', description: 'Accepted note'}));
        expect(draft.values).toEqual({title: 'Submitted', description: 'Accepted note'});
        expect(draft.baseline.values).toEqual(original.values);
        expect(draft.baseline.editableFields).toEqual(['title']);
        expect(draft.etag).toBe('"original"');
        expect(draft.awaitingAuthority).toBe(true);
        expect(draft.patch).toEqual({});
        expect(draft.dirty).toBe(false);

        draft.receive({...metadata({title: 'Submitted'}), editableFields: []}, '"fresh"');
        expect(draft.awaitingAuthority).toBe(false);
        expect(draft.etag).toBe('"fresh"');
        expect(draft.baseline.editableFields).toEqual([]);
        expect(draft.patch).toEqual({});
    });

    it('adopts disjoint remote changes while keeping the sparse local draft', () => {
        const draft = new MetadataDraft<Metadata['values'], Metadata>(metadata(), '"a"', packingFieldPolicy);
        draft.values.description = 'My note';
        draft.receive(metadata({title: 'Remote title', description: 'Old note'}), '"b"');
        expect(draft.etag).toBe('"b"');
        expect(draft.values).toEqual({title: 'Remote title', description: 'My note'});
        expect(draft.patch).toEqual({description: 'My note'});
        expect(draft.remote).toBeNull();
    });

    it('requires an explicit same-field choice and does not carry newly forbidden fields into reapply', () => {
        const draft = new MetadataDraft<Metadata['values'], Metadata>(metadata(), '"a"', packingFieldPolicy);
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
        const draft = new MetadataDraft<Metadata['values'], Metadata>(
            {...metadata({description: 'Old note'}), editableFields: ['description']}, '"a"', packingFieldPolicy);
        draft.values.description = '';
        expect(draft.patch).toEqual({description: null});
        draft.accept({...metadata({description: null}), editableFields: ['description']}, '"b"');
        expect(draft.dirty).toBe(false);
    });
});

describe('generic metadata draft reconciliation', () => {
    it('preserves numeric/boolean edits, caller-owned nullable text and field revocation across review', () => {
        type Values = {capacity?: number; enabled?: boolean; note?: string | null};
        type Snapshot = FrontendMetadataSnapshot<Values> & {entityType: 'fixture'};
        const policy: FrontendMetadataFieldPolicy<Values> = {note: normalizeNullableText};
        const initial: Snapshot = {entityType: 'fixture', values: {capacity: 5, enabled: true, note: null},
            editableFields: ['capacity', 'enabled', 'note']};
        const draft = new MetadataDraft<Values, Snapshot>(initial, '"a"', policy);
        draft.values.capacity = 0;
        draft.values.enabled = false;
        draft.values.note = '';
        expect(draft.patch).toEqual({capacity: 0, enabled: false});
        expect(initial.values).toEqual({capacity: 5, enabled: true, note: null});

        // The same algorithm rebases untouched fields without flattening false/zero
        // or depending on Packing's title/description names and wire declaration.
        draft.receive({...initial, values: {capacity: 5, enabled: true, note: 'Remote note'}}, '"b"');
        expect(draft.values).toEqual({capacity: 0, enabled: false, note: 'Remote note'});
        expect(draft.etag).toBe('"b"');
        draft.values.note = '';
        expect(draft.patch).toEqual({capacity: 0, enabled: false, note: null});

        draft.receive({entityType: 'fixture', values: {capacity: 8, note: 'Remote note'},
            editableFields: ['capacity', 'note']}, '"c"');
        expect(draft.conflicts).toEqual(['capacity']);
        expect(draft.review()).toBe(false);
        draft.choices.capacity = 'mine';
        expect(draft.review()).toBe(true);
        expect(draft.values).not.toHaveProperty('enabled');
        expect(draft.patch).toEqual({capacity: 0, note: null});
    });
});

describe('typed frontend transport', () => {
    const rejection: components['schemas']['Problem'] = {type: 'about:blank', title: 'Rejected', status: 400,
        detail: 'The request was rejected.', requestId: 'classification-request', code: 'VALIDATION_FAILED',
        messageKey: 'api:errors.VALIDATION_FAILED', params: {}};

    it.each([
        {name: 'known rejection', body: rejection, status: 400, confirmed: true},
        {name: 'safe future rejection', body: {...rejection, code: 'FUTURE_CODE', messageKey: 'api:errors.FUTURE_CODE'},
            status: 400, confirmed: true},
        {name: 'malformed rejection', body: {status: 400, detail: 'Missing the common Problem contract'},
            status: 400, confirmed: false},
        {name: 'mismatched rejection status', body: {...rejection, status: 401}, status: 400, confirmed: false},
        {name: 'known server failure', body: {...rejection, status: 500, code: 'INTERNAL_ERROR',
            messageKey: 'api:errors.INTERNAL_ERROR'}, status: 500, confirmed: false},
    ])('classifies $name through the generated mutation client', async ({body, status, confirmed}) => {
        const send = vi.fn(async () => response(body, status));
        const api = new PackingApi(new FrontendApi(() => true, vi.fn(), send));
        await expect(api.addItem(listId, {title: 'Tent', description: null, maxAssignees: 1, requiredByAll: false}, scope))
            .rejects.toMatchObject({status, confirmedRejection: confirmed});
        expect(send).toHaveBeenCalledOnce();
    });

    it('keeps a non-JSON mutation rejection unconfirmed', async () => {
        const api = new PackingApi(new FrontendApi(() => true, vi.fn(), vi.fn(async () => new Response(
            '<html>Proxy error</html>', {status: 400, headers: {'Content-Type': 'text/html'}}))));
        await expect(api.addItem(listId, {title: 'Tent', description: null, maxAssignees: 1, requiredByAll: false}, scope))
            .rejects.not.toMatchObject({confirmedRejection: true});
    });

    it.each([
        {name: 'malformed unauthorized response', body: {}, invalidate: false},
        {name: 'safe future unauthorized response', body: {...rejection, status: 401, code: 'FUTURE_CODE',
            messageKey: 'api:errors.FUTURE_CODE'}, invalidate: false},
        {name: 'known authentication rejection', body: {...rejection, status: 401, code: 'AUTH_REQUIRED',
            messageKey: 'api:errors.AUTH_REQUIRED'}, invalidate: true},
    ])('uses machine-code authority for $name', async ({body, invalidate: losesIdentity}) => {
        const invalidate = vi.fn();
        const api = new FrontendApi(() => true, invalidate, vi.fn(async () => response(body, 401)));
        await expect(api.login({username: 'A profile', password: 'incorrect password'}, scope)).rejects.toThrow();
        expect(invalidate).toHaveBeenCalledTimes(losesIdentity ? 1 : 0);
    });

    it('admits an identity transition only when the response confirms its new context', async () => {
        const current = session('new-context-1234567890');
        const result: components['schemas']['IdentityResult'] = {session: current, personalLink: null, redirect: null};
        const invalidate = vi.fn();
        const send = vi.fn(async (_input: RequestInfo | URL) => response(result, 200, {'X-Surveyor-Context': current.context}));
        const api = new FrontendApi(() => true, invalidate, send);
        expect(await api.login({username: 'A profile', password: 'correct password'}, scope)).toEqual(result);
        const request = send.mock.calls[0]?.[0] as Request | undefined;
        expect(request?.headers.get('X-Surveyor-Context')).toBe(scope.context);
        expect(request?.headers.get('X-CSRF-Token')).toBe(scope.csrfToken);
        expect(invalidate).not.toHaveBeenCalled();

        const wrongHeader = new FrontendApi(() => true, invalidate, vi.fn(async () => response(result)));
        await expect(wrongHeader.login({username: 'A profile', password: 'correct password'}, scope))
            .rejects.toBeInstanceOf(UnconfirmedResponseError);
        expect(invalidate).not.toHaveBeenCalled();
    });

    it('keeps the admitted identity after a confirmed invalid-credentials rejection', async () => {
        const problem: components['schemas']['Problem'] = {type: 'about:blank', title: 'Unauthorized', status: 401,
            detail: 'The credentials are invalid.', requestId: 'login-request', code: 'INVALID_CREDENTIALS',
            messageKey: 'api:errors.INVALID_CREDENTIALS', params: {}};
        const invalidate = vi.fn();
        const api = new FrontendApi(() => true, invalidate, vi.fn(async () => response(problem, 401)));
        await expect(api.login({username: 'A profile', password: 'incorrect password'}, scope))
            .rejects.toMatchObject({status: 401, problem});
        expect(invalidate).not.toHaveBeenCalled();
    });

    it.each([undefined, 'W/"stale"', '"' + 'a'.repeat(5000) + '"'])(
        'rejects unusable metadata comparison headers after reads and confirmed writes: %s', async etag => {
            // Headers are outside the metadata DTO. A valid body cannot renew editing
            // authority when its reviewed token violates the shared authored contract.
            const api = new PackingApi(new FrontendApi(() => true, () => {}, vi.fn(async () =>
                response(metadata(), 200, etag === undefined ? {} : {ETag: etag}))));
            await expect(api.metadata(listId, scope)).rejects.toBeInstanceOf(UnconfirmedResponseError);
            await expect(api.saveMetadata(listId, {title: 'Saved'}, '"reviewed"', scope))
                .rejects.toBeInstanceOf(UnconfirmedResponseError);
        },
    );

    it('sends captured identity, locale, CSRF and edit token with the narrow metadata patch', async () => {
        let request!: Request;
        const api = new PackingApi(new FrontendApi(() => true, vi.fn(), vi.fn(async (input: RequestInfo | URL) => {
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
        const api = new PackingApi(new FrontendApi(() => true, vi.fn(), vi.fn(async () => new Response(null,
            {status: 304, headers: {'X-Surveyor-Context': scope.context}}))));
        expect(await api.metadata(listId, scope, undefined, previous)).toBe(previous);

        // Conditional responses have no decoded body. Cancellation must precede
        // this fast path too, rather than publishing its earlier private snapshot.
        const held = deferred<Response>();
        const conditional = vi.fn(async () => held.promise);
        const canceled = new PackingApi(new FrontendApi(() => true, vi.fn(), conditional));
        const controller = new AbortController();
        const reading = canceled.metadata(listId, scope, controller.signal, previous);
        const retired = expect(reading).rejects.toBeInstanceOf(ObsoleteRequestError);
        // Exercise cancellation of an actual dispatched conditional read. A
        // cancellation during lazy admission has its own nondelivery coverage.
        await flushPromises();
        controller.abort();
        held.resolve(new Response(null, {status: 304, headers: {'X-Surveyor-Context': scope.context}}));
        await retired;
        const beforeAdmission = new AbortController();
        beforeAdmission.abort();
        await expect(canceled.metadata(listId, scope, beforeAdmission.signal, previous))
            .rejects.toBeInstanceOf(ObsoleteRequestError);
        expect(conditional).toHaveBeenCalledOnce();

        const empty = new PackingApi(new FrontendApi(() => true, vi.fn(), vi.fn(async () => new Response(null, {status: 204}))));
        await expect(empty.assign(listId, itemId, true, scope)).rejects.toBeInstanceOf(UnconfirmedResponseError);
    });

    it.each([
        {status: 200, deferredBody: false},
        {status: 200, deferredBody: true},
        {status: 401, deferredBody: false},
        {status: 403, deferredBody: true},
        {status: 429, deferredBody: false},
        {status: 503, deferredBody: true},
    ])('retires canceled JSON reads before $status classification and shared publication (body held: $deferredBody)',
        async ({status, deferredBody}) => {
            const held = deferred<Response>();
            let finishBody!: () => void;
            const error = {type: 'about:blank', title: 'Read unavailable', status,
                detail: 'Synthetic read issue.', requestId: 'canceled-json-read'};
            let body: unknown;
            if (status === 200) body = metadata({title: 'Retired title', description: 'Old note'});
            else if (status === 401) body = {...error, code: 'AUTH_REQUIRED', messageKey: 'api:errors.AUTH_REQUIRED', params: {}};
            else if (status === 403) body = {...error, code: 'FORBIDDEN', messageKey: 'api:errors.FORBIDDEN', params: {}};
            else body = {...error, code: 'FUTURE_RETRYABLE_READ'};
            const headers = {ETag: '"retired"', ...(status === 429 || status === 503 ? {'Retry-After': '90'} : {})};
            // Headers can arrive before a native body stream completes. Keep that
            // actual generated decoder active; an early fetch-only guard is insufficient.
            const stream = new ReadableStream<Uint8Array>({start(controller) {
                finishBody = function deliverBody(): void {
                    controller.enqueue(new TextEncoder().encode(JSON.stringify(body)));
                    controller.close();
                };
            }});
            const initial = new Response(stream, {status, headers: {'Content-Type': 'application/json',
                'X-Surveyor-Context': scope.context, ...headers}});
            const decode = vi.spyOn(initial, 'text');
            const invalidate = vi.fn();
            const request = vi.fn(async function readFixture(_input: RequestInfo | URL): Promise<Response> {
                if (request.mock.calls.length > 1) return response(metadata(), 200, {ETag: '"current"'});
                return deferredBody ? initial : held.promise;
            });
            const api = new PackingApi(new FrontendApi(() => true, invalidate, request));
            const controller = new AbortController();
            const reading = api.metadata(listId, scope, controller.signal);
            const retired = expect(reading).rejects.toBeInstanceOf(ObsoleteRequestError);
            await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
            if (deferredBody) await vi.waitFor(() => expect(decode).toHaveBeenCalledOnce());
            controller.abort();
            expect((request.mock.calls[0]![0] as Request).signal.aborted).toBe(true);
            if (deferredBody) finishBody();
            else held.resolve(response(body, status, headers));
            await retired;
            expect(invalidate).not.toHaveBeenCalled();
            // An obsolete error has no cooldown lease. A fresh read must reach HTTP,
            // including after canceled 429/503, and retain ordinary success validation.
            await expect(api.metadata(listId, scope)).resolves.toMatchObject({data: metadata(), etag: '"current"'});
            expect(request).toHaveBeenCalledTimes(2);
        });

    it.each([201, 202])('rejects undeclared assignment success status %s even with a valid body', async status => {
        const data = {listId, itemId, selfAssigned: true, assignedCount: 1, maxAssignees: 1};
        const api = new PackingApi(new FrontendApi(() => true, vi.fn(), vi.fn(async () => response(data, status))));
        await expect(api.assign(listId, itemId, true, scope)).rejects.toBeInstanceOf(UnconfirmedResponseError);
    });

    it('rejects an obsolete successful response and never retries a command after a lost response', async () => {
        const result = deferred<Response>();
        let current = true;
        const send = vi.fn(() => result.promise);
        const api = new PackingApi(new FrontendApi(() => current, vi.fn(), send));
        const pending = api.assign(listId, itemId, true, scope);
        await flushPromises();
        current = false;
        result.resolve(response({listId, itemId, selfAssigned: true, assignedCount: 1, maxAssignees: 1}));
        await expect(pending).rejects.toBeInstanceOf(ObsoleteRequestError);
        expect(send).toHaveBeenCalledOnce();
        const lost = vi.fn(async () => { throw new TypeError('connection lost'); });
        await expect(new PackingApi(new FrontendApi(() => true, vi.fn(), lost)).assign(listId, itemId, true, scope)).rejects.toThrow('connection lost');
        expect(lost).toHaveBeenCalledOnce();
    });

    it('does not accept an unexpected body or invalidate a new context because of an old unauthorized response', async () => {
        const invalidate = vi.fn();
        const malformed = new PackingApi(new FrontendApi(() => true, invalidate, vi.fn(async () => response({status: 'success'}))));
        await expect(malformed.metadata(listId, scope)).rejects.toBeInstanceOf(UnconfirmedResponseError);
        const old = new PackingApi(new FrontendApi(() => false, invalidate, vi.fn(async () => response({}, 401))));
        await expect(old.metadata(listId, scope)).rejects.toBeInstanceOf(ObsoleteRequestError);
        expect(invalidate).not.toHaveBeenCalled();
    });

    it('requires actor confirmation on private successes and safely displays unknown problem details', async () => {
        const invalidate = vi.fn();
        const missingHeader = new PackingApi(new FrontendApi(() => true, invalidate, vi.fn(async () => new Response(JSON.stringify(metadata()),
            {headers: {'Content-Type': 'application/json', ETag: '"a"'}}))));
        await expect(missingHeader.metadata(listId, scope)).rejects.toBeInstanceOf(UnconfirmedResponseError);
        const futureProblem = {type: 'https://surveyor.invalid/problems/future', title: 'Future rejection',
            status: 409, detail: 'Safe explanation from the server', requestId: 'request-12345', code: 'FUTURE_CODE'};
        const api = new PackingApi(new FrontendApi(() => true, invalidate, vi.fn(async () => response(futureProblem, 409))));
        await expect(api.metadata(listId, scope)).rejects.toMatchObject({status: 409, problem: null,
            message: futureProblem.detail});
        const wrongStatus = new PackingApi(new FrontendApi(() => true, invalidate,
            vi.fn(async () => response({...futureProblem, status: 401, code: 'SESSION_CONTEXT_CHANGED'}, 409))));
        await expect(wrongStatus.metadata(listId, scope)).rejects.toMatchObject({status: 409, problem: null, message: 'HTTP 409'});
        expect(invalidate).not.toHaveBeenCalled();
    });

    it('enforces server cooldown even when a new manual or focus caller has no prior query error', async () => {
        const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
        const send = vi.fn(async () => response({}, 429, {'Retry-After': '90'}));
        const api = new PackingApi(new FrontendApi(() => true, vi.fn(), send));
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
        const context = createFrontendContext({session: session()}, false, vi.fn(() => pendingHelp.promise));
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
        const context = createFrontendContext({session: session()}, false, send);
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
        expect(context.session.value?.context).toBe(current.context);
        expect(context.personalLink.value).toBe('https://example.test/private-link');
        expect(send).toHaveBeenCalledTimes(2);
        context.queryClient.clear();
    });

    it('delivers a confirmed guest link after a failed bootstrap is recovered without repeating registration', async () => {
        const current = {...session('confirmed-guest-context-1234'), kind: 'guest' as const};
        const send = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error('Session read unavailable'))
            .mockResolvedValueOnce(response(current, 200, {'X-Surveyor-Context': current.context}));
        const context = createFrontendContext({session: session()}, false, send);

        await expect(context.acceptIdentity({session: current, personalLink: 'https://example.test/private-link', redirect: null}))
            .rejects.toThrow();
        expect(context.ready.value).toBe(false);
        expect(context.personalLink.value).toBeNull();
        await context.refreshSession();

        expect(context.ready.value).toBe(true);
        expect(context.session.value?.context).toBe(current.context);
        expect(context.personalLink.value).toBe('https://example.test/private-link');
        expect(send).toHaveBeenCalledTimes(2);
        expect(send.mock.calls.every(([request]) => (request as Request).method === 'GET')).toBe(true);
        context.queryClient.clear();
    });

    it('retires a retained identity receipt when retry confirms a different actor', async () => {
        const confirmed = {...session('confirmed-guest-context-1234'), kind: 'guest' as const};
        const other = session('different-actor-context-1234');
        const send = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error('Session read unavailable'))
            .mockResolvedValueOnce(response(other, 200, {'X-Surveyor-Context': other.context}))
            .mockResolvedValueOnce(response(confirmed, 200, {'X-Surveyor-Context': confirmed.context}));
        const context = createFrontendContext({session: session()}, false, send);

        await expect(context.acceptIdentity({session: confirmed, personalLink: 'https://example.test/private-link', redirect: null}))
            .rejects.toThrow();
        await context.refreshSession();
        expect(context.session.value?.context).toBe(other.context);
        expect(context.personalLink.value).toBeNull();
        await context.refreshSession();
        expect(context.personalLink.value).toBeNull();
        context.queryClient.clear();
    });

    it('serializes rapid language changes so the final explicit preference also owns the final cookie response', async () => {
        const german = deferred<Response>();
        const english = deferred<Response>();
        const send = vi.fn().mockImplementationOnce(() => german.promise).mockImplementationOnce(() => english.promise);
        const context = createFrontendContext({session: session()}, false, send);
        const first = context.changeLocale('de');
        const latest = context.changeLocale('en');
        expect(first).toBe(latest);
        await flushPromises();
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

    it('keeps a confirmed locale when an older session read finishes without discarding private state', async () => {
        const olderSession = deferred<Response>();
        const send = vi.fn<typeof fetch>().mockReturnValueOnce(olderSession.promise)
            .mockResolvedValueOnce(response(session(scope.context, 'de')));
        const context = createFrontendContext({session: session()}, false, send);
        const captured = context.capture();
        context.queryClient.setQueryData(['private'], 'Existing editor');

        const reading = context.refreshSession();
        await context.changeLocale('de');
        olderSession.resolve(response(session()));
        await reading;

        expect(context.locale.value).toBe('de');
        expect(context.session.value?.locale).toBe('de');
        expect(context.messages.value.locale).toBe('de');
        expect(context.isCurrent(captured)).toBe(true);
        expect(context.queryClient.getQueryData(['private'])).toBe('Existing editor');
        context.queryClient.clear();
    });

    it('still applies authoritative identity changes from an older locale projection', async () => {
        const olderSession = deferred<Response>();
        const send = vi.fn<typeof fetch>().mockReturnValueOnce(olderSession.promise)
            .mockResolvedValueOnce(response(session(scope.context, 'de')));
        const context = createFrontendContext({session: session()}, false, send);
        const captured = context.capture();
        context.queryClient.setQueryData(['private'], 'Previous actor');

        const reading = context.refreshSession();
        await context.changeLocale('de');
        const current = session('changed-context-1234567890');
        olderSession.resolve(response(current, 200, {'X-Surveyor-Context': current.context}));
        await reading;

        expect(context.session.value?.context).toBe(current.context);
        expect(context.ready.value).toBe(true);
        expect(context.isCurrent(captured)).toBe(false);
        expect(context.queryClient.getQueryData(['private'])).toBeUndefined();
        expect(context.locale.value).toBe('de');
        expect(context.session.value?.locale).toBe('de');
        context.queryClient.clear();
    });

    it('does not suppress an authoritative locale after a rejected language command', async () => {
        const olderSession = deferred<Response>();
        const problem: components['schemas']['Problem'] = {type: 'about:blank', title: 'Forbidden', status: 403,
            detail: 'This operation is not permitted.', requestId: 'locale-request', code: 'FORBIDDEN',
            messageKey: 'api:errors.FORBIDDEN', params: {}};
        const send = vi.fn<typeof fetch>().mockReturnValueOnce(olderSession.promise)
            .mockResolvedValueOnce(response(problem, 403));
        const context = createFrontendContext({session: session()}, false, send);

        const reading = context.refreshSession();
        await expect(context.changeLocale('de')).rejects.toBeInstanceOf(ApiFailure);
        olderSession.resolve(response(session(scope.context, 'de')));
        await reading;

        expect(context.locale.value).toBe('de');
        expect(context.session.value?.locale).toBe('de');
        context.queryClient.clear();
    });

    it('evicts denied-list projections and containing query families while retaining unrelated resources and actors', async () => {
        const context = createFrontendContext({session: session()}, false);
        const removed = [packingKeys.detail(scope.context, listId),
            packingKeys.metadata(scope.context, listId), packingKeys.profiles(scope.context, listId, 'organizer'),
            packingKeys.guest(scope.context, listId),
            overviewKeys.region(scope.context, 'en', {collection: 'owner', region: 'main'}),
            overviewKeys.region(scope.context, 'de', {collection: 'participant', region: 'hidden'}),
            packingKeys.eventPage(scope.context, 'en', '', {selectedId: listId})];
        const retained = [packingKeys.detail(scope.context, itemId),
            packingKeys.detail('other-actor', listId), overviewKeys.all('other-actor'),
            ['v1', scope.context, 'en', 'help']];
        for (const key of [...removed, ...retained]) context.queryClient.setQueryData(key, 'private snapshot');
        await evictQueryFamilies(context.queryClient, [packingKeys.resource(scope.context, listId),
            packingKeys.events(scope.context), overviewKeys.all(scope.context)]);
        for (const key of removed) expect(context.queryClient.getQueryData(key)).toBeUndefined();
        for (const key of retained) expect(context.queryClient.getQueryData(key)).toBe('private snapshot');
        context.queryClient.clear();
    });

    it('cancels an in-flight containing overview read before it can restore an evicted private card', async () => {
        const context = createFrontendContext({session: session()}, false);
        const result = deferred<{title: string}>();
        const key = overviewKeys.region(scope.context, 'en', {collection: 'owner', region: 'main'});
        let signal!: AbortSignal;
        const pending = context.queryClient.fetchQuery({queryKey: key, queryFn: (query) => {
            signal = query.signal;
            return result.promise;
        }}).catch(() => undefined);
        await evictQueryFamilies(context.queryClient, [packingKeys.resource(scope.context, listId),
            packingKeys.events(scope.context), overviewKeys.all(scope.context)]);
        expect(signal.aborted).toBe(true);
        result.resolve({title: 'Private title from before revocation'});
        await pending;
        expect(context.queryClient.getQueryData(key)).toBeUndefined();
        context.queryClient.clear();
    });
    it('isolates request-local query clients and locale while discarding an old private scope on bootstrap change', async () => {
        const first = createFrontendContext({session: session()}, false, vi.fn(async () => response(session('new-context-1234567890', 'de'))));
        const second = createFrontendContext({session: session('other-context-1234567890', 'de')}, false);
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

    it('keeps one current session failure and successful read receipt until explicit recovery', async () => {
        vi.useFakeTimers({toFake: ['Date']});
        const successfulTime = new Date('2026-10-11T08:00:00Z');
        vi.setSystemTime(successfulTime);
        let unavailable = false;
        const failure = new TypeError('The session connection failed.');
        const request = vi.fn(async () => {
            if (unavailable) throw failure;
            return response(session());
        });
        const context = createFrontendContext({session: session()}, false, request);
        try {
            await context.refreshSession();
            expect(context.sessionRead.value.updatedAt).toBe(successfulTime.getTime());
            unavailable = true;
            vi.setSystemTime(new Date('2026-10-11T08:00:30Z'));
            await expect(context.refreshSession()).rejects.toBe(failure);
            expect(context.ready.value).toBe(true);
            expect(context.session.value?.context).toBe(scope.context);
            expect(context.sessionRead.value).toEqual({error: failure, updatedAt: successfulTime.getTime(), pending: false});
            expect(context.notice.value).toBe('state.stale');

            // Another failed manual attempt retains the original successful instant.
            await expect(context.refreshSession()).rejects.toBe(failure);
            expect(context.sessionRead.value.updatedAt).toBe(successfulTime.getTime());
            unavailable = false;
            await context.refreshSession();
            expect(context.sessionRead.value).toEqual({error: null, updatedAt: Date.now(), pending: false});
            expect(context.notice.value).toBeNull();
        } finally { context.queryClient.clear(); vi.useRealTimers(); }
    });

    it('rejects a skipped session Retry as the retained server failure until its deadline', async () => {
        vi.useFakeTimers({toFake: ['Date']});
        vi.setSystemTime(new Date('2026-10-11T08:10:00Z'));
        let limited = false;
        const request = vi.fn(async () => limited ? response({type: 'urn:future:unavailable', title: 'Unavailable',
            status: 503, detail: 'Temporarily unavailable.', requestId: 'session-read-cooldown'}, 503, {'Retry-After': '90'})
            : response(session()));
        const context = createFrontendContext({session: session()}, false, request);
        try {
            await context.refreshSession();
            limited = true;
            const failure = await context.refreshSession().catch(error => error);
            expect(failure).toBeInstanceOf(ApiFailure);
            expect(context.sessionRead.value.error).toBe(failure);
            const deadline = Date.now() + 90_000;
            expect(failure.retryAt).toBe(deadline);
            await expect(context.refreshSession()).rejects.toBe(failure);
            expect(request).toHaveBeenCalledTimes(2);
            expect(context.ready.value).toBe(true);
            limited = false;
            vi.setSystemTime(deadline + 1);
            await context.refreshSession();
            expect(request).toHaveBeenCalledTimes(3);
            expect(context.sessionRead.value.error).toBeNull();
        } finally { context.queryClient.clear(); vi.useRealTimers(); }
    });

    it('retires session read receipts and ignores an old actor failure before its replacement bootstrap', async () => {
        const previous = deferred<Response>();
        const current = deferred<Response>();
        let reads = 0;
        const context = createFrontendContext({session: session()}, false, vi.fn(async () => {
            reads++;
            return reads === 1 ? response(session()) : reads === 2 ? previous.promise : current.promise;
        }));
        try {
            await context.refreshSession();
            expect(context.sessionRead.value.updatedAt).toBeDefined();
            const obsolete = context.refreshSession().catch(error => error);
            context.invalidateIdentity();
            expect(context.ready.value).toBe(false);
            expect(context.sessionRead.value).toEqual({error: null, pending: false});
            previous.resolve(new Response('<html>Old proxy failure</html>', {status: 403,
                headers: {'Content-Type': 'text/html'}}));
            await obsolete;
            await Promise.resolve();
            expect(context.sessionRead.value.error).toBeNull();
            expect(context.sessionRead.value.updatedAt).toBeUndefined();
            expect(context.notice.value).toBe('state.sessionChanged');
            current.resolve(response(session('replacement-session-context')));
            await context.refreshSession();
            expect(context.ready.value).toBe(true);
            expect(context.session.value?.context).toBe('replacement-session-context');
            expect(context.sessionRead.value.updatedAt).toBeDefined();
        } finally { context.queryClient.clear(); }
    });

    it('keeps the exact legacy local Packed key and tolerates unavailable storage', () => {
        const values = new Map([[`packed_${listId}_${itemId}`, '1']]);
        const storage = {getItem: (key: string) => values.get(key) ?? null,
            setItem: (key: string, value: string) => { values.set(key, value); },
            removeItem: (key: string) => { values.delete(key); }};
        expect(readPacked(storage, listId, itemId)).toEqual({packed: true, available: true});
        expect(writePacked(storage, listId, itemId, false)).toBe(true);
        expect(values.size).toBe(0);
        expect(readPacked(storage, listId, itemId)).toEqual({packed: false, available: true});
        expect(writePacked(storage, listId, itemId, true)).toBe(true);
        expect([...values.keys()]).toEqual([`packed_${listId}_${itemId}`]);
        expect(readPacked({getItem: () => { throw new Error('blocked'); }}, listId, itemId))
            .toEqual({packed: false, available: false});
        expect(readPacked(undefined, listId, itemId)).toEqual({packed: false, available: false});
        expect(writePacked(undefined, listId, itemId, true)).toBe(false);
        expect(writePacked({setItem: () => { throw new Error('blocked'); }, removeItem: vi.fn()}, listId, itemId, true)).toBe(false);
        expect(writePacked({setItem: vi.fn(), removeItem: () => { throw new Error('blocked'); }}, listId, itemId, false)).toBe(false);
    });

    it('suppresses obsolete/confirmed-denial polling and honors server retry delay', () => {
        // Keep direct scheduling policy in this one inexpensive case. Mounted
        // consumers separately prove disclosure, cancellation and recovery.
        expect(refreshInterval(null, 0, 2000)).toBe(32_000);
        expect(refreshInterval(new Error('Temporary read failure'), 0, 2000)).toBe(30_000);
        expect(refreshInterval(new ObsoleteRequestError(), 0, 1000)).toBe(false);
        const denial: components['schemas']['Problem'] = {type: 'urn:surveyor:problem:forbidden', title: 'Forbidden', status: 403,
            detail: 'Read access changed.', requestId: 'polling-denial', code: 'FORBIDDEN', messageKey: 'api:errors.FORBIDDEN', params: {}};
        expect(refreshInterval(new ApiFailure(403, denial), 0, 1000)).toBe(false);
        expect(refreshInterval(new ApiFailure(403, null), 0, 1000)).toBe(30_000);
        const rateLimited = new ApiFailure(429, null, 90_000);
        expect(refreshInterval(rateLimited, 0, 1000)).toBeGreaterThanOrEqual(89_900);
        expect(canRetryRead(rateLimited)).toBe(false);
        expect(refreshInterval(new Error('offline'), 3, 1000)).toBe(60_000);
    });

    it.each([0, 1])('uses bounded jitter for exactly two temporary read retries at random boundary %s', async random => {
        vi.useFakeTimers();
        vi.spyOn(Math, 'random').mockReturnValue(random);
        const context = createFrontendContext({session: session()}, false);
        const failure = random === 0 ? new TypeError('Temporary network failure') : new ApiFailure(503, null);
        const read = vi.fn(async () => { throw failure; });
        const result = context.queryClient.fetchQuery({queryKey: ['jittered-read'], queryFn: read}).catch(error => error);
        try {
            // Observe the real QueryClient scheduler, not a copied delay formula.
            // Neither retry can run before its randomized boundary, and no fourth
            // request follows after the existing two-retry budget is exhausted.
            const firstDelay = random === 0 ? 750 : 1000;
            const secondDelay = random === 0 ? 1500 : 2000;
            await vi.advanceTimersByTimeAsync(firstDelay - 1);
            expect(read).toHaveBeenCalledOnce();
            await vi.advanceTimersByTimeAsync(1);
            expect(read).toHaveBeenCalledTimes(2);
            await vi.advanceTimersByTimeAsync(secondDelay - 1);
            expect(read).toHaveBeenCalledTimes(2);
            await vi.advanceTimersByTimeAsync(1);
            expect(await result).toBe(failure);
            expect(read).toHaveBeenCalledTimes(3);
            await vi.advanceTimersByTimeAsync(10_000);
            expect(read).toHaveBeenCalledTimes(3);
        } finally { context.queryClient.clear(); vi.useRealTimers(); }
    });

    it('keeps server cooldown and mutation replay outside the temporary read retry budget', async () => {
        const context = createFrontendContext({session: session()}, false);
        const failure = new ApiFailure(503, null, 90_000);
        const read = vi.fn(async () => { throw failure; });
        try {
            await expect(context.queryClient.fetchQuery({queryKey: ['server-delayed-read'], queryFn: read})).rejects.toBe(failure);
            expect(read).toHaveBeenCalledOnce();
            expect(context.queryClient.getDefaultOptions().mutations?.retry).toBe(false);
        } finally { context.queryClient.clear(); }
    });

    it('serializes hostile text as inert bootstrap JSON without changing the decoded value', () => {
        const bootstrap = {session: {...session(), kind: 'account' as const,
            activeProfile: {id: itemId, name: '</script><script>alert(1)</script>&\u2028'}}};
        const encoded = serializeBootstrap(bootstrap);
        expect(encoded).not.toContain('<');
        expect(encoded).not.toContain('&');
        expect(JSON.parse(encoded)).toEqual(bootstrap);
    });
});
