// @vitest-environment happy-dom
import {apiCompatibility} from '../../.generated/api/v1/policy.mjs';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {defineComponent, nextTick, ref} from 'vue';
import {flushPromises, mount} from '@vue/test-utils';
import {resolve} from 'node:path';
import * as pug from 'pug';
import I18NextVue from 'i18next-vue';
import {VueQueryPlugin} from '@tanstack/vue-query';
import {createPilotApp, initializePilotApp} from '../../src/frontend/app/createApp';
import {render} from '../../src/frontend/app/entry-server';
import {decodeBootstrap} from '../../src/frontend/app/serializeBootstrap';
import {pilotContextKey} from '../../src/frontend/app/context';
import {useDraftProtection} from '../../src/frontend/composables/command';
import ProfileWorkflowPage from '../../src/frontend/features/identity/ProfileWorkflowPage.vue';
import type {components} from '../../src/types/api/v1';
import type {FrontendPilotBootstrap, FrontendProfileWorkflow} from '../../src/types/FrontendPilotTypes';

const profileId = '11111111-1111-4111-8111-111111111111';
const token = 'private-migration-token-1234567890';
const session: components['schemas']['SessionView'] & {context: string; csrfToken: string} = {
    kind: 'account', context: 'workflow-context-12345678901234567890', csrfToken: 'workflow-csrf-12345678901234567890',
    deployment: {buildId: 'fixture', apiCompatibility}, locale: 'en',
    activeProfile: {id: profileId, name: 'Fixture profile'}, profiles: [{id: profileId, name: 'Fixture profile'}],
    loginUrl: '/users/login', logoutUrl: '/users/logout', shell: {version: 'fixture', imprintUrl: '/imprint',
        privacyPolicyUrl: '/privacy', localLoginEnabled: true, oidcEnabled: false, oidcName: 'Provider'},
};
const preview: components['schemas']['ProfileMigrationPreview'] = {kind: 'preview', token,
    profile: {id: profileId, name: 'Transferred <profile>', owner: {kind: 'account', name: 'Original owner',
        username: 'original-owner', email: 'owner@example.test'}}};
const cleanups: (() => void)[] = [];

afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    document.body.innerHTML = '';
    window.history.replaceState({}, '', '/');
});

/** Use actual routes, SSR bootstrap, hydration, shell and SPA command owners.
 * Only HTTP is substituted; persistence and real browser delivery belong to application E2E. */
async function mounted(workflow: FrontendProfileWorkflow | undefined,
                       path = '/frontend-pilot/users/profile/migrate/show',
                       read: typeof fetch = rejectUnexpectedRequest,
                       readAdmission?: (request: Request) => Promise<Response>) {
    const request = vi.fn(function deliverWorkflowRequest(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
        const received = input as Request;
        const pathname = new URL(received.url).pathname;
        // These shared reads contain no capability or private preview. Keep their
        // actor header tied to the captured request after an explicit retirement.
        if (pathname === '/api/v1/session' && read === rejectUnexpectedRequest) return Promise.resolve(json(session));
        if (pathname === '/api/v1/profiles/workflow-entry') {
            // A focused lifecycle case may hold this genuine production-client
            // read separately from session verification; other cases stay immediate.
            return readAdmission ? readAdmission(received) : Promise.resolve(json({entry: {kind: 'render'}}, 200,
                received.headers.get('X-Surveyor-Context') ?? session.context));
        }
        if (pathname === '/api/v1/profiles/entry') return Promise.resolve(json({kind: 'render'}));
        return read(input, init);
    });
    vi.stubGlobal('fetch', request);
    const bootstrap: FrontendPilotBootstrap = {session, ...(workflow ? {profileWorkflow: workflow} : {})};
    const rendered = await render(path, bootstrap);
    const host = document.createElement('div');
    host.innerHTML = rendered.html;
    document.body.append(host);
    window.history.replaceState({}, '', path);
    const application = createPilotApp(await decodeBootstrap(JSON.parse(rendered.state)), true);
    await application.router.isReady();
    const stop = await initializePilotApp(application, host);
    cleanups.push(function disposeApplication() { application.app.unmount(); stop(); });
    await flushPromises();
    return {...application, host, request};
}

function rejectUnexpectedRequest(): Promise<Response> {
    return Promise.reject(new Error('No unexpected workflow read or mutation may be dispatched.'));
}

/** Match authored response shapes while preserving actual generated validation. */
function json(value: unknown, status = 200, responseContext = session.context): Response {
    return new Response(JSON.stringify(value), {status, headers: {'Content-Type': 'application/json',
        'X-Surveyor-Context': responseContext}});
}

function rejection(status: 400 | 500): Response {
    return new Response(JSON.stringify({type: 'about:blank', title: 'Workflow rejected', status,
        code: status === 400 ? 'VALIDATION_FAILED' : 'WORKFLOW_OUTCOME_UNKNOWN',
        messageKey: status === 400 ? 'api:errors.VALIDATION_FAILED' : 'api:errors.WORKFLOW_OUTCOME_UNKNOWN',
        params: {}, detail: 'A workflow result.', requestId: 'workflow-response'}),
    {status, headers: {'Content-Type': 'application/problem+json', 'X-Surveyor-Context': session.context}});
}

/** Query may hold admission, never token input, issued output or private preview. */
function expectPrivateCache(context: ReturnType<typeof createPilotApp>['context']): void {
    const cached = JSON.stringify(context.queryClient.getQueryCache().getAll().map(query => ({key: query.queryKey, data: query.state.data})));
    for (const secret of [token, 'validated-response-token', preview.profile.name, 'owner@example.test'])
        expect(cached).not.toContain(secret);
}

/** Substitute only the HTTP boundary; generated request/response validation remains actual. */
function previewResponse(outcome: components['schemas']['ProfileMigrationPreviewOutcome']): Response {
    return new Response(JSON.stringify(outcome), {headers: {'Content-Type': 'application/json',
        'X-Surveyor-Context': session.context}});
}

/** Compare authored native markup without executing its browser scripts or changing the comparator. */
function nativePage(template: string, data?: unknown): Element {
    const renderNative = pug.compileFile(resolve(`src/views/users/${template}.pug`));
    const root = document.createElement('div');
    root.innerHTML = renderNative({data, profile: session.activeProfile, auth: {user: {username: 'fixture'}},
        messages: {}, version: session.shell.version, nxtUrl: '', permData: undefined, settings: {
            rootUrl: 'https://example.test', imprintUrl: '/imprint', privacyPolicyUrl: '/privacy'}});
    return root.querySelector('main > .card')!;
}

function text(element: Element): string { return element.textContent!.replace(/\s+/gu, ' ').trim(); }

function submit(form: HTMLFormElement): Event {
    const event = new Event('submit', {bubbles: true, cancelable: true});
    form.dispatchEvent(event);
    return event;
}

/** Exercise the real entry form before inspecting its validated local preview. */
async function enterPreview(host: HTMLElement): Promise<void> {
    const input = host.querySelector<HTMLInputElement>('#token')!;
    input.value = token;
    input.dispatchEvent(new Event('input', {bubbles: true}));
    await nextTick();
    expect(submit(host.querySelector<HTMLFormElement>('#forgotForm')!).defaultPrevented).toBe(true);
    await flushPromises();
}

/** Mount the actual workflow alongside another draft under the production root
 * owner. This protects cross-form consent through a real destructive action. */
async function guardedWorkflow() {
    const busy = ref(false);
    const dirty = ref(false);
    const uncertain = ref(false);
    const request = vi.fn(async function rejectConfirmedWorkflow() { return rejection(400); });
    vi.stubGlobal('fetch', request);
    window.history.replaceState({}, '', '/frontend-pilot/users/profile/delete');
    const application = createPilotApp({session, initialUrl: '/frontend-pilot/users/profile/delete', profileWorkflow: {kind: 'deactivate', value: ''}}, true);
    await application.router.isReady();
    application.context.hydrated.value = true;
    const Sibling = defineComponent({
        setup() {
            useDraftProtection({dirty: () => dirty.value, busy: () => busy.value, uncertain: () => uncertain.value,
                unknownMessage: 'draft.leaveUnknown'});
            return {};
        },
        template: '<p>Other mounted work</p>',
    });
    const Owner = defineComponent({
        components: {ProfileWorkflowPage, Sibling},
        setup() { useDraftProtection({dirty: () => false, unknownMessage: 'draft.leaveUnknown'}); return {}; },
        template: '<ProfileWorkflowPage /><Sibling />',
    });
    const wrapper = mount(Owner, {attachTo: document.body, global: {plugins: [application.router,
        [VueQueryPlugin, {queryClient: application.context.queryClient}],
        [I18NextVue, {i18next: application.context.i18next}]],
        provide: {[pilotContextKey as symbol]: application.context}}});
    cleanups.push(function disposeGuards() { wrapper.unmount(); application.context.start()(); });
    await flushPromises();
    return {wrapper, request, context: application.context, busy, dirty, uncertain};
}

describe('SPA profile workflows', () => {
    it('keeps token submission blocked while authority Refresh awaits its entry read after session verification', async function holdsWorkflowAuthority() {
        let finishAdmission!: (response: Response) => void;
        const admissionResponse = new Promise<Response>(resolve => { finishAdmission = resolve; });
        const {host, context, request} = await mounted({kind: 'token', token: ''},
            '/frontend-pilot/users/profile/migrate/request', async function verifySession(input) {
                expect(new URL((input as Request).url).pathname).toBe('/api/v1/session');
                return json(session);
            }, async function holdAuthorityAdmission(received) {
                expect(received.method).toBe('GET');
                return admissionResponse;
            });
        const refresh = host.querySelector<HTMLButtonElement>('button[aria-label="Refresh"]')!;
        const issueToken = Array.from(host.querySelectorAll<HTMLButtonElement>('main button'))
            .find(button => text(button) === context.messages.value.t('profile.showMigrationToken'))!;
        refresh.click();
        await flushPromises();
        try {
            // Session verification has restored ordinary read eligibility, but
            // the existing recovery lease still awaits its own fresh entry read.
            expect(context.mayRead()).toBe(true);
            expect(refresh.disabled).toBe(true);
            expect(refresh.getAttribute('aria-busy')).toBe('true');
            expect(issueToken.disabled).toBe(true);
            expect(issueToken.getAttribute('aria-busy')).toBe('false');
            expect(issueToken.querySelector('.spinner-border')).toBeNull();
            issueToken.click();
            await flushPromises();
            expect(request.mock.calls.map(([input]) => (input as Request).method)).toEqual(['GET', 'GET']);
        } finally {
            finishAdmission(json({entry: {kind: 'render'}}));
            await flushPromises();
        }
        expect(refresh.disabled).toBe(false);
        expect(refresh.getAttribute('aria-busy')).toBe('false');
        expect(issueToken.disabled).toBe(false);
        expectPrivateCache(context);
    });

    it('blocks authority Refresh without making it busy while the token command is pending', async function separatesWorkflowRefresh() {
        let finishToken!: (response: Response) => void;
        const response = new Promise<Response>(resolve => { finishToken = resolve; });
        const {host, context, request} = await mounted({kind: 'token', token: ''},
            '/frontend-pilot/users/profile/migrate/request', async function holdTokenCommand(input) {
                const received = input as Request;
                expect(received.method).toBe('POST');
                expect(new URL(received.url).pathname).toBe('/api/v1/profiles/migration/token');
                return response;
            });
        const refresh = host.querySelector<HTMLButtonElement>('button[aria-label="Refresh"]')!;
        const issueToken = Array.from(host.querySelectorAll<HTMLButtonElement>('main button'))
            .find(button => text(button) === context.messages.value.t('profile.showMigrationToken'))!;
        issueToken.click();
        await flushPromises();
        try {
            // Both controls share admission, but only this explicit token command
            // owns progress. Refresh cannot dispatch or borrow its busy/focus state.
            expect(issueToken.disabled).toBe(true);
            expect(issueToken.getAttribute('aria-busy')).toBe('true');
            expect(issueToken.querySelector('.spinner-border')).not.toBeNull();
            expect(refresh.disabled).toBe(true);
            expect(refresh.getAttribute('aria-busy')).toBe('false');
            expect(refresh.querySelector('.spinner-border')).toBeNull();
            refresh.click();
            await flushPromises();
            expect(request).toHaveBeenCalledOnce();
        } finally {
            finishToken(json({token}));
            await flushPromises();
        }
        expect(host.querySelector('h3')?.textContent).toBe(token);
        expect(refresh.disabled).toBe(false);
        expectPrivateCache(context);
    });

    it.each([
        {kind: 'entry', path: 'profile/migrate/show', field: 'token'},
        {kind: 'deactivate', path: 'profile/delete', field: 'name'},
        {kind: 'delete-account', path: 'account/delete', field: 'username'},
    ] as const)('shows paused $kind admission and retains its draft until an explicit recovered submit', async function mirrorsWorkflowAdmission(candidate) {
        let finishBootstrap!: (response: Response) => void;
        const bootstrap = new Promise<Response>(resolve => { finishBootstrap = resolve; });
        const {host, context, request} = await mounted(candidate.kind === 'entry' ? {kind: 'entry'}
            : {kind: candidate.kind, value: ''}, `/frontend-pilot/users/${candidate.path}`,
        async function readWorkflow(request) {
            if (new URL((request as Request).url).pathname === '/api/v1/session') return bootstrap;
            return candidate.kind === 'entry' ? previewResponse(preview) : rejection(400);
        });
        const form = host.querySelector<HTMLFormElement>('#forgotForm')!;
        const input = form.querySelector<HTMLInputElement>('#' + candidate.field)!;
        input.value = token;
        input.dispatchEvent(new Event('input', {bubbles: true}));
        input.focus();
        input.setSelectionRange(2, 8);
        const checking = context.refreshSession();
        await nextTick();
        const button = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;

        expect(button.disabled).toBe(true);
        expect(button.getAttribute('aria-busy')).toBe('false');
        expect(input.disabled).toBe(false);
        expect(submit(form).defaultPrevented).toBe(true);
        expect(request).toHaveBeenCalledOnce();
        expect(new FormData(form).get(candidate.field)).toBe(token);

        finishBootstrap(new Response(JSON.stringify(session), {headers: {'Content-Type': 'application/json',
            'X-Surveyor-Context': session.context}}));
        await checking;
        await flushPromises();
        expect(button.disabled).toBe(false);
        expect(form.querySelector('#' + candidate.field)).toBe(input);
        expect([input.selectionStart, input.selectionEnd]).toEqual([2, 8]);
        expect(document.activeElement).toBe(input);
        expect(request).toHaveBeenCalledOnce();

        // Reopening admission never submits. Only this second deliberate action
        // starts the generated body-only preview or destructive JSON command.
        expect(submit(form).defaultPrevented).toBe(true);
        await flushPromises();
        expect(request).toHaveBeenCalledTimes(2);
    });

    it.each([
        {workflow: {kind: 'token', token}, path: 'profile/migrate/request', template: 'profile/migrate-token', data: {token}},
        {workflow: {kind: 'entry'}, path: 'profile/migrate/show', template: 'profile/migrate-token-enter'},
        {workflow: {kind: 'entry'}, preview: true, path: 'profile/migrate/show', template: 'profile/migrate-validate',
            data: {profile: {id: profileId, name: 'Transferred <profile>', migrationToken: token,
                user: {name: 'Original owner', username: 'original-owner', email: 'owner@example.test'}}}},
        {workflow: {kind: 'deactivate', value: ''}, path: 'profile/delete', template: 'profile/delete'},
        {workflow: {kind: 'delete-account', value: ''}, path: 'account/delete', template: 'delete-account'},
    ] as const)('retains native $workflow.kind headings, copy and submitted field shape', async function matchesNative(candidate) {
        const withPreview = 'preview' in candidate;
        const {host, context, request} = await mounted(candidate.workflow, `/frontend-pilot/users/${candidate.path}`,
            withPreview ? async function readNativePreview() { return previewResponse(preview); } : rejectUnexpectedRequest);
        if (withPreview) await enterPreview(host);
        const native = nativePage(candidate.template, 'data' in candidate ? candidate.data : undefined);
        const actual = host.querySelector('main > section.card')!;

        expect(text(actual.querySelector('h1')!)).toBe(text(native.querySelector('h1')!));
        expect(Array.from(actual.querySelectorAll('p.lead'), text)).toEqual(Array.from(native.querySelectorAll('p.lead'), text));
        expect(Array.from(actual.querySelectorAll('label'), text)).toEqual(Array.from(native.querySelectorAll('label'), text));
        expect(Array.from(actual.querySelectorAll('form button'), text)).toEqual(Array.from(native.querySelectorAll('form button'), text));
        expect(request).toHaveBeenCalledTimes(withPreview ? 1 : 0);
        expectPrivateCache(context);
        for (const anchor of host.querySelectorAll<HTMLAnchorElement>('a[href]')) expect(anchor.href).not.toContain(token);
        expect(actual.querySelector('profile')).toBeNull();
        if (withPreview) {
            const form = actual.querySelector('form')!;
            expect(new FormData(form).get('token')).toBe(token);
            expect(form.hasAttribute('action')).toBe(false);
            expect(actual.querySelector('input[name="token"]')?.hasAttribute('hidden')).toBe(true);
        }
    });

    it('expires actual confirmation rejection without reviving it on translation or clearing input', async function expiresConfirmationFeedback() {
        vi.useFakeTimers();
        vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
        const {host, context} = await mounted({kind: 'deactivate', value: ''}, '/frontend-pilot/users/profile/delete',
            async function rejectConfirmation() { return rejection(400); });
        const input = host.querySelector<HTMLInputElement>('#name')!;
        input.value = 'Incorrect confirmation';
        input.dispatchEvent(new Event('input', {bubbles: true}));
        await nextTick();
        submit(host.querySelector<HTMLFormElement>('#forgotForm')!);
        await flushPromises();
        expect(host.textContent).toContain(context.messages.value.t('profile.invalidDeactivation'));
        await vi.advanceTimersByTimeAsync(10_001);
        await flushPromises();
        expect(host.querySelector('.alert-danger')).toBeNull();
        context.locale.value = 'de';
        await flushPromises();
        expect(host.querySelector('.alert-danger')).toBeNull();
        expect(host.querySelector('#name')).toBe(input);
        expect(input.value).toBe('Incorrect confirmation');
    });

    it.each(['token', 'entry', 'preview'] as const)('refreshes workflow authority while retaining its %s without replaying secret commands', async kind => {
        const workflow: FrontendProfileWorkflow = kind === 'token' ? {kind: 'token', token} : {kind: 'entry'};
        const path = kind === 'token' ? '/frontend-pilot/users/profile/migrate/request' : '/frontend-pilot/users/profile/migrate/show';
        const {host, context, request} = await mounted(workflow, path, async input => {
            const received = input as Request;
            if (new URL(received.url).pathname === '/api/v1/session') return json(session);
            expect(new URL(received.url).pathname).toBe('/api/v1/profiles/migration/preview');
            return previewResponse(preview);
        });
        if (kind === 'preview') await enterPreview(host);
        const input = host.querySelector<HTMLInputElement>('input[name="token"]');
        if (kind === 'entry') {
            input!.value = 'Keep unsubmitted token';
            input!.dispatchEvent(new Event('input', {bubbles: true}));
            await nextTick();
        }
        const before = request.mock.calls.length;
        host.querySelector<HTMLButtonElement>('button[aria-label="Refresh"]')!.click();
        await flushPromises();

        const refreshed = request.mock.calls.slice(before).map(([input]) => input as Request);
        expect(refreshed.map(input => new URL(input.url).pathname)).toEqual(['/api/v1/session', '/api/v1/profiles/workflow-entry']);
        expect(refreshed.every(input => input.method === 'GET')).toBe(true);
        if (kind === 'token') expect(host.querySelector('h3')?.textContent).toBe(token);
        else {
            expect(host.querySelector('input[name="token"]')).toBe(input);
            expect(input!.value).toBe(kind === 'entry' ? 'Keep unsubmitted token' : token);
            if (kind === 'preview') expect(host.textContent).toContain(preview.profile.name);
        }
        expectPrivateCache(context);
    });

    it('retains the admitted workflow input and focus through failed authority Refresh and explicit read recovery', async function retainsFailedAuthorityDraft() {
        let failAdmission = true;
        const {host, context, request} = await mounted({kind: 'entry'}, undefined, rejectUnexpectedRequest,
            async function readRecoverableAdmission(received) {
                expect(received.method).toBe('GET');
                if (!failAdmission) return json({entry: {kind: 'render'}});

                // A real decoded temporary server failure owns its cooldown. It
                // cannot revoke the earlier admitted form or replay its token.
                const response = rejection(500);
                response.headers.set('Retry-After', '1');
                return response;
            });
        vi.useFakeTimers();
        const form = host.querySelector<HTMLFormElement>('#forgotForm')!;
        const input = form.querySelector<HTMLInputElement>('#token')!;
        const refresh = host.querySelector<HTMLButtonElement>('button[aria-label="Refresh"]')!;
        input.value = 'Keep unsubmitted token';
        input.dispatchEvent(new Event('input', {bubbles: true}));
        input.focus();
        input.setSelectionRange(2, 8);
        await nextTick();

        // The focused, editable draft stays mounted while a separate authority
        // read fails. Its supplementary warning retains the actual read receipt.
        refresh.click();
        await flushPromises();
        expect(host.querySelector('#forgotForm')).toBe(form);
        expect(form.querySelector('#token')).toBe(input);
        expect(host.querySelector('button[aria-label="Refresh"]')).toBe(refresh);
        expect(input.value).toBe('Keep unsubmitted token');
        expect(document.activeElement).toBe(input);
        expect([input.selectionStart, input.selectionEnd]).toEqual([2, 8]);
        const warning = host.querySelector('[data-read-retry-at]')!.closest('.status-notice')!;
        expect(warning.textContent).toContain(context.messages.value.t('state.stale'));
        expect(warning.querySelector('[data-last-successful-refresh]')).not.toBeNull();
        const retry = warning.querySelector<HTMLButtonElement>('button')!;
        expect(retry.disabled).toBe(true);
        expect(refresh.disabled).toBe(true);
        // The toolbar shares command recovery admission with its handler. Even
        // a dispatched click cannot start a session read while entry waits.
        refresh.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true}));
        await flushPromises();
        const failedRequests = request.mock.calls.map(([received]) => received as Request);
        expect(failedRequests.map(received => new URL(received.url).pathname))
            .toEqual(['/api/v1/session', '/api/v1/profiles/workflow-entry']);
        expect(failedRequests.every(received => received.method === 'GET')).toBe(true);

        // Expiring the server deadline changes only availability. The existing
        // explicit admission Retry must recover without replacing local controls.
        await vi.advanceTimersByTimeAsync(1001);
        await flushPromises();
        expect(retry.disabled).toBe(false);
        expect(refresh.disabled).toBe(false);
        expect(request).toHaveBeenCalledTimes(2);
        failAdmission = false;
        retry.click();
        await flushPromises();
        expect(host.querySelector('#forgotForm')).toBe(form);
        expect(form.querySelector('#token')).toBe(input);
        expect(host.querySelector('button[aria-label="Refresh"]')).toBe(refresh);
        expect(input.value).toBe('Keep unsubmitted token');
        expect(document.activeElement).toBe(input);
        expect([input.selectionStart, input.selectionEnd]).toEqual([2, 8]);
        expect(host.querySelector('[data-read-retry-at]')).toBeNull();
        expect(request).toHaveBeenCalledTimes(3);
        expect(request.mock.calls.every(([received]) => (received as Request).method === 'GET')).toBe(true);
        expectPrivateCache(context);
    });

    it('keeps workflow authority Refresh unavailable through the session cooldown and resumes explicit recovery without read admission', async function honorsWorkflowSessionCooldown() {
        let failSession = true;
        const {host, context, request} = await mounted({kind: 'entry'}, undefined,
            async function readRecoverableSession(input) {
                expect(new URL((input as Request).url).pathname).toBe('/api/v1/session');
                if (!failSession) return json(session);

                // Session and workflow admission are different required reads.
                // This failure pauses new resource reads without retiring drafts.
                const response = rejection(500);
                response.headers.set('Retry-After', '1');
                return response;
            });
        vi.useFakeTimers();
        const input = host.querySelector<HTMLInputElement>('#token')!;
        const refresh = host.querySelector<HTMLButtonElement>('button[aria-label="Refresh"]')!;
        input.value = 'Retained session-recovery draft';
        input.dispatchEvent(new Event('input', {bubbles: true}));
        input.focus();
        await nextTick();

        refresh.click();
        await flushPromises();
        expect(context.ready.value).toBe(true);
        expect(context.mayRead()).toBe(false);
        expect(host.querySelector('#token')).toBe(input);
        expect(input.value).toBe('Retained session-recovery draft');
        expect(document.activeElement).toBe(input);
        expect(refresh.disabled).toBe(true);
        refresh.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true}));
        await flushPromises();
        expect(request).toHaveBeenCalledOnce();

        // Deadline expiry permits this recovery command to establish admission;
        // requiring readsReady here would instead leave the toolbar in a dead end.
        await vi.advanceTimersByTimeAsync(1001);
        await flushPromises();
        expect(context.mayRead()).toBe(false);
        expect(refresh.disabled).toBe(false);
        expect(request).toHaveBeenCalledOnce();
        failSession = false;
        refresh.click();
        await flushPromises();
        expect(context.mayRead()).toBe(true);
        expect(host.querySelector('#token')).toBe(input);
        expect(input.value).toBe('Retained session-recovery draft');
        expect(document.activeElement).toBe(input);
        expect(request.mock.calls.map(([received]) => new URL((received as Request).url).pathname))
            .toEqual(['/api/v1/session', '/api/v1/session', '/api/v1/profiles/workflow-entry']);
        expect(request.mock.calls.every(([received]) => (received as Request).method === 'GET')).toBe(true);
        expectPrivateCache(context);
    });

    it('keeps entry text through secret-free preview Back/Forward and uses only the validated token for execution', async function retainsPreviewHistory() {
        let executedToken: string | undefined;
        const path = '/frontend-pilot/users/profile/migrate/show?locale=en&keep=hello%20world';
        const {host, router, context, request} = await mounted({kind: 'entry'}, path, async function readPreview(input) {
            const received = input as Request;
            if (new URL(received.url).pathname === '/api/v1/profiles/migration/execute') {
                expect(received.method).toBe('POST');
                executedToken = (await received.json()).token;
                expect(received.headers.get('X-Surveyor-Context')).toBe(session.context);
                expect(received.headers.get('X-CSRF-Token')).toBe(session.csrfToken);
                return rejection(400);
            }
            expect(new URL(received.url).pathname).toBe('/api/v1/profiles/migration/preview');
            expect(received.method).toBe('POST');
            expect(await received.json()).toEqual({token});
            expect(received.headers.get('X-CSRF-Token')).toBe(session.csrfToken);
            return previewResponse({...preview, token: 'validated-response-token'});
        });
        const input = host.querySelector<HTMLInputElement>('#token')!;
        input.value = token;
        input.dispatchEvent(new Event('input', {bubbles: true}));
        await nextTick();
        expect(submit(host.querySelector<HTMLFormElement>('#forgotForm')!).defaultPrevented).toBe(true);
        await flushPromises();
        expect(router.currentRoute.value.hash).toBe('#migration-preview');
        expect(router.currentRoute.value.fullPath).toBe(path + '#migration-preview');
        expect(router.currentRoute.value.fullPath).not.toContain(token);
        expect(host.textContent).toContain('Transferred <profile>');
        expect(new FormData(host.querySelector<HTMLFormElement>('#forgotForm')!).get('token')).toBe('validated-response-token');
        router.back();
        await flushPromises();
        expect(host.querySelector<HTMLInputElement>('#token')!.value).toBe(token);
        expect(host.querySelector<HTMLButtonElement>('main button[type="submit"]')!.disabled).toBe(false);
        router.forward();
        await flushPromises();
        expect(host.textContent).toContain('Transferred <profile>');
        expect(request).toHaveBeenCalledTimes(1);
        expectPrivateCache(context);
        // Confirmation submits the validated preview bearer, not the entry draft.
        const confirm = vi.fn(() => false);
        vi.stubGlobal('confirm', confirm);
        submit(host.querySelector<HTMLFormElement>('#forgotForm')!);
        await flushPromises();
        expect(executedToken).toBe('validated-response-token');
        expect(confirm).not.toHaveBeenCalled();
        expect(request).toHaveBeenCalledTimes(2);
        expectPrivateCache(context);
    });

    it('retains entry text through a failed preview read and retries only on explicit request', async function recoversPreviewRead() {
        let fail = true;
        const {host, context, request} = await mounted({kind: 'entry'}, undefined, async function readRecoverablePreview() {
            if (fail) throw new TypeError('Fixture read response unavailable');
            return previewResponse(preview);
        });
        const input = host.querySelector<HTMLInputElement>('#token')!;
        input.value = token;
        input.dispatchEvent(new Event('input', {bubbles: true}));
        await nextTick();
        submit(host.querySelector<HTMLFormElement>('#forgotForm')!);
        await flushPromises();
        expect(host.querySelector('#token')).toBe(input);
        expect(input.value).toBe(token);
        expect(request).toHaveBeenCalledTimes(1);
        expect(host.textContent).toContain(context.messages.value.t('state.loadFailed'));
        fail = false;
        const retry = Array.from(host.querySelectorAll('button')).find(button => text(button) === context.messages.value.t('common.retry'))!;
        retry.click();
        await flushPromises();
        expect(host.textContent).toContain('Transferred <profile>');
        expect(request).toHaveBeenCalledTimes(2);
    });

    it('shows native invalid-token feedback while retaining the valid account and entry draft for Back', async function deniesCapabilityOnly() {
        const {host, context, router, request} = await mounted({kind: 'entry'}, undefined, async function readDeniedPreview() {
            return previewResponse({kind: 'denied', status: 401, messageKey: 'profile.invalidMigrationToken'});
        });
        const input = host.querySelector<HTMLInputElement>('#token')!;
        input.value = 'Invalid entered token';
        input.dispatchEvent(new Event('input', {bubbles: true}));
        await nextTick();
        submit(host.querySelector<HTMLFormElement>('#forgotForm')!);
        await flushPromises();
        expect(host.textContent).toContain('Invalid or mismatched token');
        expect(host.querySelector('form#forgotForm')).toBeNull();
        expect(context.session.value?.kind).toBe('account');
        expect(context.ready.value).toBe(true);
        expect(context.pageTitle.value).toBe('Error | ControlPanel');
        router.back();
        await flushPromises();
        expect(host.querySelector<HTMLInputElement>('#token')!.value).toBe('Invalid entered token');
        expect(context.pageTitle.value).toBe('Migrate Profile | Surveyor');
        expect(request).toHaveBeenCalledTimes(1);
    });

    it('reloads a public preview marker as a blank entry without storing or automatically reading its private result', async function reloadsWithoutPrivateResult() {
        const path = '/frontend-pilot/users/profile/migrate/show?locale=en&keep=hello%20world';
        const {host, request, router} = await mounted({kind: 'entry'}, path + '#migration-preview',
            async function readExplicitReloadPreview() { return previewResponse(preview); });
        expect(host.querySelector<HTMLInputElement>('#token')!.value).toBe('');
        expect(host.textContent).not.toContain('Transferred <profile>');
        expect(request).not.toHaveBeenCalled();
        // Only deliberate submission may read again. Canonicalizing the public
        // reload marker must preserve the admitted document's complete query.
        await enterPreview(host);
        expect(router.currentRoute.value.fullPath).toBe(path + '#migration-preview');
        expect(host.textContent).toContain('Transferred <profile>');
        expect(request).toHaveBeenCalledTimes(1);
    });

    it('does not revive expired capability feedback when its locale changes, and retains the draft for Back', async function expiresCapabilityFeedback() {
        vi.useFakeTimers();
        vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
        const {host, context, router, request} = await mounted({kind: 'entry'}, undefined, async function readDeniedPreview() {
            return previewResponse({kind: 'denied', status: 401, messageKey: 'profile.invalidMigrationToken'});
        });
        await enterPreview(host);
        expect(host.textContent).toContain('Invalid or mismatched token');
        await vi.advanceTimersByTimeAsync(10_001);
        await flushPromises();
        expect(host.querySelector('.alert-danger')).toBeNull();
        context.locale.value = 'de';
        await flushPromises();
        expect(host.querySelector('.alert-danger')).toBeNull();
        expect(context.session.value?.kind).toBe('account');
        expect(context.pageTitle.value).toBe('Fehler | ControlPanel');
        router.back();
        await flushPromises();
        expect(host.querySelector<HTMLInputElement>('#token')!.value).toBe(token);
        expect(context.pageTitle.value).toBe('Profil übertragen | Surveyor');
        expect(request.mock.calls.filter(([input]) => (input as Request).method === 'POST')).toHaveLength(1);
        expectPrivateCache(context);
    });

    it.each([
        {kind: 'deactivate', path: 'profile/delete', field: 'name', method: 'POST', endpoint: '/profiles/current/deactivate'},
        {kind: 'delete-account', path: 'account/delete', field: 'username', method: 'DELETE', endpoint: '/account'},
    ] as const)('submits one captured $kind command while pending work fences navigation', async function submitsWorkflowOnce(candidate) {
        let finish!: (response: Response) => void;
        const held = new Promise<Response>(resolve => { finish = resolve; });
        const {host, context, router, request} = await mounted({kind: candidate.kind, value: ''},
            '/frontend-pilot/users/' + candidate.path, function holdWorkflow() { return held; });
        const form = host.querySelector<HTMLFormElement>('#forgotForm')!;
        const input = form.querySelector<HTMLInputElement>('#' + candidate.field)!;
        input.value = '  native confirmation text  ';
        input.dispatchEvent(new Event('input', {bubbles: true}));
        await nextTick();
        const confirm = vi.fn(() => false);
        vi.stubGlobal('confirm', confirm);
        expect(submit(form).defaultPrevented).toBe(true);
        await flushPromises();

        // The real feature accepts its own submitted input without discard consent.
        // Its captured command still protects every competing page departure.
        expect(request).toHaveBeenCalledOnce();
        const received = request.mock.calls[0][0] as Request;
        expect(received.method).toBe(candidate.method);
        expect(new URL(received.url).pathname).toBe('/api/v1' + candidate.endpoint);
        expect(await received.clone().json()).toEqual({[candidate.field]: input.value});
        expect(received.headers.get('X-Surveyor-Context')).toBe(session.context);
        expect(received.headers.get('X-CSRF-Token')).toBe(session.csrfToken);
        expect(received.headers.get('X-Surveyor-Locale')).toBe('en');
        expect(received.headers.get('X-Surveyor-Api-Compatibility')).toBe(session.deployment.apiCompatibility);
        expect(form.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
        expect(input.disabled).toBe(false);
        expect(submit(form).defaultPrevented).toBe(true);
        expect(context.mayChangeIdentity()).toBe(false);
        expect(context.updates.requestRecoveryReload()).toBe(false);
        await router.push('/frontend-pilot/home');
        expect(router.currentRoute.value.path).toBe('/frontend-pilot/users/' + candidate.path);
        const unload = new Event('beforeunload', {cancelable: true});
        window.dispatchEvent(unload);
        expect(unload.defaultPrevented).toBe(true);
        expect(confirm).not.toHaveBeenCalled();
        expect(request).toHaveBeenCalledOnce();

        finish(rejection(400));
        await flushPromises();
        expect(input.value).toBe('  native confirmation text  ');
        expect(form.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false);
        expectPrivateCache(context);
    });

    it.each([
        {path: 'profile/migrate/show', field: 'token'},
        {path: 'profile/delete', field: 'name'},
        {path: 'account/delete', field: 'username'},
    ])('admits the warm $path form through a read without a Refresh dead end or command', async function admitsWarmWorkflow(candidate) {
        const {host, router, request, context} = await mounted(undefined, '/frontend-pilot/home');
        await router.push('/frontend-pilot/users/' + candidate.path);
        await flushPromises();
        expect(host.querySelector('form#forgotForm')).not.toBeNull();
        expect(host.querySelector<HTMLInputElement>('#' + candidate.field)!.value).toBe('');
        expect(host.textContent).not.toContain('Open this page again to continue.');
        expect(request).toHaveBeenCalledOnce();
        const received = request.mock.calls[0][0] as Request;
        expect(received.method).toBe('GET');
        expect(new URL(received.url).pathname).toBe('/api/v1/profiles/workflow-entry');
        expectPrivateCache(context);
    });

    it('retires private token/confirmation controls when the admitted actor is lost', async function retiresActorProjection() {
        const {host, context} = await mounted({kind: 'entry'}, undefined,
            async function readPrivatePreview() { return previewResponse(preview); });
        await enterPreview(host);
        expect(host.textContent).toContain('Transferred <profile>');
        context.session.value = {...session, context: 'another-workflow-context-1234567890'};
        context.epoch.value++;
        await flushPromises();
        expect(host.textContent).not.toContain('Transferred <profile>');
        expect(host.querySelector<HTMLInputElement>('input[name="token"]')?.value ?? '').toBe('');
    });

    it('never publishes a preview read completed after the admitted actor is retired', async function rejectsLatePreview() {
        let finish: (response: Response) => void = () => { throw new Error('The read has not started.'); };
        const response = new Promise<Response>(function captureCompletion(resolve) { finish = resolve; });
        const {host, context, request} = await mounted({kind: 'entry'}, undefined,
            function holdPrivatePreview() { return response; });
        await enterPreview(host);
        expect(request).toHaveBeenCalledTimes(1);
        context.session.value = {...session, context: 'another-workflow-context-1234567890'};
        context.epoch.value++;
        await nextTick();
        finish(previewResponse(preview));
        await flushPromises();
        expect(host.textContent).not.toContain('Transferred <profile>');
        expect(host.querySelector<HTMLInputElement>('input[name="token"]')?.value ?? '').toBe('');
        expectPrivateCache(context);
    });

    it('rejects default-canceled and invalid submissions without releasing the input', async function rejectsCanceledSubmission() {
        const {host, request} = await mounted({kind: 'deactivate', value: ''}, '/frontend-pilot/users/profile/delete');
        const form = host.querySelector<HTMLFormElement>('#forgotForm')!;
        expect(submit(form).defaultPrevented).toBe(true);
        const input = host.querySelector<HTMLInputElement>('#name')!;
        input.value = token;
        input.dispatchEvent(new Event('input', {bubbles: true}));
        await nextTick();
        const event = new Event('submit', {cancelable: true, bubbles: true});
        event.preventDefault();
        form.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
        expect(input.value).toBe(token);
        expect(form.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false);
        expect(request).not.toHaveBeenCalled();
    });

    it('rejects extra private fields, wrong variants and foreign error keys at bootstrap admission', async function validatesPrivateProjection() {
        await expect(decodeBootstrap({session, profileWorkflow: {kind: 'entry'}})).resolves.toMatchObject({profileWorkflow: {kind: 'entry'}});
        for (const profileWorkflow of [
            preview, {...preview, password: 'never admitted'}, {kind: 'entry', token},
            {...preview, profile: {...preview.profile, credential: 'never admitted'}},
            {...preview, profile: {...preview.profile, owner: {...preview.profile.owner, password: 'never admitted'}}},
            {kind: 'deactivate', value: '', error: 'profile.invalidAccountDeletion'},
            {kind: 'delete-account', value: ['not a string']},
        ]) await expect(decodeBootstrap({session, profileWorkflow})).rejects.toThrow('Invalid pilot bootstrap field: profileWorkflow');
    });

    it.each([
        {kind: 'deactivate', path: 'profile/delete', field: 'name', key: 'profile.invalidDeactivation'},
        {kind: 'delete-account', path: 'account/delete', field: 'username', key: 'profile.invalidAccountDeletion'},
    ] as const)('retains rejected $kind confirmation in the same input through translation', async function retainsRejectedCommand(candidate) {
        const {host, context, request} = await mounted({kind: candidate.kind, value: ''},
            '/frontend-pilot/users/' + candidate.path, async function rejectConfirmation() { return rejection(400); });
        const input = host.querySelector<HTMLInputElement>('#' + candidate.field)!;
        input.value = 'Wrong confirmation';
        input.dispatchEvent(new Event('input', {bubbles: true}));
        await nextTick();
        submit(host.querySelector<HTMLFormElement>('#forgotForm')!);
        await flushPromises();
        expect(host.textContent).toContain(context.messages.value.t(candidate.key));
        expect(input.value).toBe('Wrong confirmation');
        expect(host.querySelector<HTMLButtonElement>('main button[type="submit"]')!.disabled).toBe(false);
        context.locale.value = 'de';
        await flushPromises();
        expect(host.querySelector('#' + candidate.field)).toBe(input);
        expect(input.value).toBe('Wrong confirmation');
        expect(host.textContent).toContain(context.messages.value.t(candidate.key));
        expect(request.mock.calls.filter(([input]) => (input as Request).method !== 'GET')).toHaveLength(1);
    });

    it.each([false, true])('keeps an uncertain command locked through recovery with bootstrap failure=%s', async function retainsUnknownCommand(bootstrapFailure) {
        const {host, context, request} = await mounted({kind: 'deactivate', value: ''}, '/frontend-pilot/users/profile/delete',
            async function readUnknownWorkflow(input) {
                if (new URL((input as Request).url).pathname === '/api/v1/session') {
                    if (bootstrapFailure) throw new TypeError('The authoritative session read failed.');
                    return json(session);
                }
                return rejection(500);
            });
        const input = host.querySelector<HTMLInputElement>('#name')!;
        input.value = 'Uncertain confirmation';
        input.dispatchEvent(new Event('input', {bubbles: true}));
        await nextTick();
        const form = host.querySelector<HTMLFormElement>('#forgotForm')!;
        submit(form);
        await flushPromises();
        expect(host.textContent).toContain(context.messages.value.t('state.unknownOutcome'));
        expect(input.value).toBe('Uncertain confirmation');
        expect(form.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
        submit(form);
        const confirm = vi.fn(() => true);
        vi.stubGlobal('confirm', confirm);
        const review = Array.from(host.querySelectorAll('button')).find(button => text(button) === context.messages.value.t('common.refresh'))!;
        review.click();
        await flushPromises();
        expect(host.querySelector('#name')).toBe(input);
        expect(input.value).toBe('Uncertain confirmation');
        expect(host.textContent).toContain(context.messages.value.t('state.unknownOutcome'));
        expect(form.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
        expect(request.mock.calls.filter(([input]) => (input as Request).method === 'POST')).toHaveLength(1);
        expect(request.mock.calls.some(([input]) => new URL((input as Request).url).pathname === '/api/v1/session')).toBe(true);
        expect(request.mock.calls.some(([input]) => new URL((input as Request).url).pathname === '/api/v1/profiles/workflow-entry')).toBe(!bootstrapFailure);
        expect(confirm).not.toHaveBeenCalled();
        expectPrivateCache(context);
    });

    it('issues once from the actual warm Show link, never from Back/Forward, and offers explicit issuance without intent', async function issuesFromDeliberateLink() {
        let issued = 0;
        const {host, context, request, router} = await mounted(undefined, '/frontend-pilot/home', async function handleTokenWorkflow(input) {
            const received = input as Request;
            const pathname = new URL(received.url).pathname;
            if (pathname === '/api/v1/session') return json(session);
            if (pathname === '/api/v1/profiles/current') return json({id: profileId, name: session.activeProfile!.name, isDefault: true});
            expect(pathname).toBe('/api/v1/profiles/migration/token');
            expect(received.method).toBe('POST');
            expect(received.headers.get('X-Surveyor-Context')).toBe(session.context);
            expect(received.headers.get('X-CSRF-Token')).toBe(session.csrfToken);
            expect(window.history.state.profileTokenRequest).toBe(false);
            issued++;
            return json({token: issued === 1 ? token : token + '-second'});
        });
        await router.push('/frontend-pilot/users/profile');
        await flushPromises();
        const link = host.querySelector<HTMLAnchorElement>('a[href="/frontend-pilot/users/profile/migrate/request"]')!;
        expect(link).not.toBeNull();
        link.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true}));
        await flushPromises();
        expect(issued).toBe(1);
        expect(host.querySelector('h3')?.textContent).toBe(token);
        expect(router.currentRoute.value.fullPath).not.toContain(token);
        expect(JSON.stringify(window.history.state)).not.toContain(token);
        expectPrivateCache(context);

        router.back();
        await flushPromises();
        expect(router.currentRoute.value.path).toBe('/frontend-pilot/users/profile');
        router.forward();
        await flushPromises();
        expect(router.currentRoute.value.path).toBe('/frontend-pilot/users/profile/migrate/request');
        expect(issued).toBe(1);
        expect(host.querySelector('h3')).toBeNull();
        const explicit = Array.from(host.querySelectorAll<HTMLButtonElement>('main button')).find(button => text(button) === context.messages.value.t('profile.showMigrationToken'))!;
        expect(explicit).not.toBeUndefined();
        explicit.click();
        await flushPromises();
        expect(issued).toBe(2);
        expect(host.querySelector('h3')?.textContent).toBe(token + '-second');
        expect(request.mock.calls.filter(([input]) => (input as Request).method === 'POST')).toHaveLength(2);
        expectPrivateCache(context);
    });

    it('keeps lost token issuance unknown without automatic reissue during read recovery', async function retainsLostIssuance() {
        const {host, context, request, router} = await mounted(undefined, '/frontend-pilot/home', async function loseTokenResponse(input) {
            if (new URL((input as Request).url).pathname === '/api/v1/session') return json(session);
            throw new TypeError('The issuance response was lost.');
        });
        await router.push({path: '/frontend-pilot/users/profile/migrate/request', state: {profileTokenRequest: true}});
        await flushPromises();
        expect(window.history.state.profileTokenRequest).toBe(false);
        expect(host.textContent).toContain(context.messages.value.t('state.unknownOutcome'));
        const issue = Array.from(host.querySelectorAll<HTMLButtonElement>('main button')).find(button => text(button) === context.messages.value.t('profile.showMigrationToken'))!;
        expect(issue.disabled).toBe(true);
        issue.click();
        const confirm = vi.fn(() => true);
        vi.stubGlobal('confirm', confirm);
        const review = Array.from(host.querySelectorAll('button')).find(button => text(button) === context.messages.value.t('common.refresh'))!;
        review.click();
        await flushPromises();
        context.locale.value = 'de';
        await flushPromises();
        expect(host.querySelector('h3')).toBeNull();
        expect(issue.disabled).toBe(true);
        expect(confirm).not.toHaveBeenCalled();
        expect(request.mock.calls.filter(([input]) => (input as Request).method === 'POST')).toHaveLength(1);
        expectPrivateCache(context);
    });

    it('keeps sibling pending, dirty and unknown work ahead of the actual destructive command', async function protectsSiblingWork() {
        const {wrapper, request, busy, dirty, uncertain} = await guardedWorkflow();
        const confirm = vi.fn(() => false);
        vi.stubGlobal('confirm', confirm);
        const form = wrapper.get('form').element as HTMLFormElement;
        const input = form.querySelector<HTMLInputElement>('#name')!;
        input.value = 'kept confirmation';
        input.dispatchEvent(new Event('input', {bubbles: true}));
        await nextTick();
        busy.value = true;
        expect(submit(form).defaultPrevented).toBe(true);
        expect(confirm).not.toHaveBeenCalled();
        busy.value = false;
        dirty.value = true;
        expect(submit(form).defaultPrevented).toBe(true);
        expect(confirm).toHaveBeenCalledTimes(1);
        dirty.value = false;
        uncertain.value = true;
        expect(submit(form).defaultPrevented).toBe(true);
        expect(confirm).toHaveBeenCalledTimes(2);
        expect(request).not.toHaveBeenCalled();
        expect(input.value).toBe('kept confirmation');
        uncertain.value = false;
        expect(submit(form).defaultPrevented).toBe(true);
        await flushPromises();
        expect(request).toHaveBeenCalledOnce();
        expect(confirm).toHaveBeenCalledTimes(2);
    });
});
