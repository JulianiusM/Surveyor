// @vitest-environment happy-dom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {defineComponent, nextTick, ref} from 'vue';
import {flushPromises, mount} from '@vue/test-utils';
import {resolve} from 'node:path';
import * as pug from 'pug';
import I18NextVue from 'i18next-vue';
import {createPilotApp, initializePilotApp} from '../../src/frontend/app/createApp';
import {render} from '../../src/frontend/app/entry-server';
import {decodeBootstrap} from '../../src/frontend/app/serializeBootstrap';
import {pilotContextKey} from '../../src/frontend/app/context';
import {useDocumentForm, useDraftProtection} from '../../src/frontend/composables/command';
import type {components} from '../../src/types/api/v1';
import type {FrontendPilotBootstrap, FrontendProfileWorkflow} from '../../src/types/FrontendPilotTypes';

const profileId = '11111111-1111-4111-8111-111111111111';
const token = 'private-migration-token-1234567890';
const session: components['schemas']['SessionView'] & {context: string; csrfToken: string} = {
    kind: 'account', context: 'workflow-context-12345678901234567890', csrfToken: 'workflow-csrf-12345678901234567890',
    deployment: {buildId: 'fixture', apiCompatibility: 'v1-pilot-2026-10-07'}, locale: 'en',
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

/** Use the actual route table, SSR bootstrap, hydration, shell and document-submit owner.
 * This boundary has no server/DB substitute: document POST delivery remains a real-browser concern. */
async function mounted(workflow: FrontendProfileWorkflow | undefined,
                       path = '/frontend-pilot/users/profile/migrate/show',
                       read: typeof fetch = rejectUnexpectedRequest) {
    const request = vi.fn(read);
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

/** A sibling draft shares the same production root owner as the real document helper.
 * Only the rendered fixture is synthetic; navigation, identity and unload guards are actual. */
async function guardedForm() {
    const busy = ref(false);
    const dirty = ref(false);
    const uncertain = ref(false);
    window.history.replaceState({}, '', '/frontend-pilot/home');
    const application = createPilotApp({session}, true);
    await application.router.isReady();
    application.context.hydrated.value = true;
    const Subject = defineComponent({
        setup() { return {form: useDocumentForm({dirty: () => false})}; },
        template: '<form method="post" action="/frontend-pilot/users/profile/delete" @submit="form.submit"><input name="name" value="kept input" /><button type="submit">Submit</button></form>',
    });
    const Sibling = defineComponent({
        setup() {
            useDraftProtection({dirty: () => dirty.value, busy: () => busy.value, uncertain: () => uncertain.value,
                unknownMessage: 'draft.leaveUnknown'});
            return {};
        },
        template: '<p>Other mounted work</p>',
    });
    const Owner = defineComponent({
        components: {Subject, Sibling},
        setup() { useDraftProtection({dirty: () => false, unknownMessage: 'draft.leaveUnknown'}); return {}; },
        template: '<Subject /><Sibling />',
    });
    const wrapper = mount(Owner, {attachTo: document.body, global: {plugins: [application.router,
        [I18NextVue, {i18next: application.context.i18next}]],
        provide: {[pilotContextKey as symbol]: application.context}}});
    cleanups.push(function disposeGuards() { wrapper.unmount(); application.context.start()(); });
    return {wrapper, context: application.context, busy, dirty, uncertain};
}

describe('document-owned profile workflows', () => {
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
            return previewResponse(preview);
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
        // starts a preview GET or permits the browser-owned POST with exact fields.
        expect(submit(form).defaultPrevented).toBe(candidate.kind === 'entry');
        await flushPromises();
        expect(request).toHaveBeenCalledTimes(candidate.kind === 'entry' ? 2 : 1);
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
        expect(context.queryClient.getQueryCache().getAll()).toHaveLength(0);
        for (const anchor of host.querySelectorAll<HTMLAnchorElement>('a[href]')) expect(anchor.href).not.toContain(token);
        expect(actual.querySelector('profile')).toBeNull();
        if (withPreview) {
            const form = actual.querySelector('form')!;
            expect(new FormData(form).get('token')).toBe(token);
            expect(form.action).toContain('/frontend-pilot/users/profile/migrate/execute?locale=en');
            expect(actual.querySelector('input[name="token"]')?.hasAttribute('hidden')).toBe(true);
        }
    });

    it('keeps wrong confirmation text through native redisplay and locale changes', async function retainsConfirmation() {
        const {host, context} = await mounted({kind: 'delete-account', value: 'Wrong username',
            error: 'profile.invalidAccountDeletion'}, '/frontend-pilot/users/account/delete');
        const input = host.querySelector<HTMLInputElement>('#username')!;
        expect(input.value).toBe('Wrong username');
        expect(host.textContent).toContain('Invalid account deletion verification');
        context.locale.value = 'de';
        await flushPromises();
        expect(host.querySelector('#username')).toBe(input);
        expect(input.value).toBe('Wrong username');
        expect(host.querySelector('form[action*="/account/delete"]')?.getAttribute('action')).toContain('locale=de');
    });

    it('expires native confirmation feedback without reviving it on locale change or clearing the input', async function expiresConfirmationFeedback() {
        vi.useFakeTimers();
        vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
        const {host, context} = await mounted({kind: 'deactivate', value: 'Incorrect confirmation',
            error: 'profile.invalidDeactivation'}, '/frontend-pilot/users/profile/delete');
        expect(host.querySelector('.alert-danger')).not.toBeNull();
        await vi.advanceTimersByTimeAsync(10_001);
        await flushPromises();
        expect(host.querySelector('.alert-danger')).toBeNull();
        context.locale.value = 'de';
        await flushPromises();
        expect(host.querySelector('.alert-danger')).toBeNull();
        expect(host.querySelector<HTMLInputElement>('#name')!.value).toBe('Incorrect confirmation');
    });

    it('keeps entry text through secret-free preview Back/Forward and uses only the validated token for execution', async function retainsPreviewHistory() {
        const path = '/frontend-pilot/users/profile/migrate/show?locale=en&keep=hello%20world';
        const {host, router, context, request} = await mounted({kind: 'entry'}, path, async function readPreview(input) {
            const received = input as Request;
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
        expect(context.queryClient.getQueryCache().getAll()).toHaveLength(0);
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
        expect(request).toHaveBeenCalledTimes(1);
    });

    it('submits once without fetch, preserves exact successful inputs and fences other navigation', async function submitsDocumentOnce() {
        const {host, context, router, request} = await mounted({kind: 'deactivate', value: ''}, '/frontend-pilot/users/profile/delete');
        const input = host.querySelector<HTMLInputElement>('#name')!;
        input.value = '  native token text  ';
        input.dispatchEvent(new Event('input', {bubbles: true}));
        await nextTick();
        const form = host.querySelector<HTMLFormElement>('#forgotForm')!;
        const confirm = vi.fn(() => false);
        vi.stubGlobal('confirm', confirm);
        expect(submit(form).defaultPrevented).toBe(false);
        await nextTick();

        expect(new FormData(form).get('name')).toBe('  native token text  ');
        expect(input.disabled).toBe(false);
        expect(form.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
        expect(new FormData(form).get('_context')).toBe(session.context);
        expect(new FormData(form).get('_csrf')).toBe(session.csrfToken);
        expect(submit(form).defaultPrevented).toBe(true);
        expect(context.mayChangeIdentity()).toBe(false);
        await router.push('/frontend-pilot/home');
        expect(router.currentRoute.value.path).toBe('/frontend-pilot/users/profile/delete');
        const unload = new Event('beforeunload', {cancelable: true});
        window.dispatchEvent(unload);
        expect(unload.defaultPrevented).toBe(false);
        expect(confirm).not.toHaveBeenCalled();
        expect(request).not.toHaveBeenCalled();
    });

    it('does not post or reconstruct a private projection on a warm route visit', async function requiresExplicitDocument() {
        const {host, router, request} = await mounted(undefined, '/frontend-pilot/home');
        await router.push('/frontend-pilot/users/profile/migrate/request');
        await flushPromises();
        expect(host.querySelector('form#forgotForm')).toBeNull();
        const reload = host.querySelector<HTMLAnchorElement>('main a[href="/frontend-pilot/users/profile/migrate/request"]');
        expect(reload).not.toBeNull();
        expect(host.textContent).toContain('Open this page again to continue.');
        expect(request).not.toHaveBeenCalled();
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
        expect(host.querySelector('input[name="token"]')).toBeNull();
        expect(host.querySelector('form#forgotForm')).toBeNull();
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
        expect(host.querySelector('form#forgotForm')).toBeNull();
        expect(context.queryClient.getQueryCache().getAll()).toHaveLength(0);
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

    it('keeps sibling pending work and declined dirty/unknown decisions ahead of a document POST', async function protectsSiblingWork() {
        const {wrapper, busy, dirty, uncertain} = await guardedForm();
        const confirm = vi.fn(() => false);
        vi.stubGlobal('confirm', confirm);
        const form = wrapper.get('form').element as HTMLFormElement;
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
        expect(confirm).toHaveBeenCalledTimes(1);
        expect(form.querySelector<HTMLInputElement>('input')!.value).toBe('kept input');
    });

    it('keeps automatic reload blocked and ordinary anchors fenced during an admitted POST', async function fencesDocumentDelivery() {
        const {host, context} = await mounted({kind: 'deactivate', value: ''}, '/frontend-pilot/users/profile/delete');
        const input = host.querySelector<HTMLInputElement>('#name')!;
        input.value = token;
        input.dispatchEvent(new Event('input', {bubbles: true}));
        await nextTick();
        expect(submit(host.querySelector<HTMLFormElement>('#forgotForm')!).defaultPrevented).toBe(false);
        expect(context.updates.requestRecoveryReload()).toBe(false);
        const anchor = host.querySelector<HTMLAnchorElement>('a[href="/frontend-pilot/users/profile"]')!;
        const ordinary = new MouseEvent('click', {bubbles: true, cancelable: true});
        anchor.dispatchEvent(ordinary);
        expect(ordinary.defaultPrevented).toBe(true);
        const modified = new MouseEvent('click', {bubbles: true, cancelable: true, ctrlKey: true});
        anchor.dispatchEvent(modified);
        expect(modified.defaultPrevented).toBe(false);
    });

    it('releases only delivery state on an explicit back-forward document restore without replaying the POST', async function restoresDocumentVisit() {
        const {host, request} = await mounted({kind: 'deactivate', value: ''}, '/frontend-pilot/users/profile/delete');
        const input = host.querySelector<HTMLInputElement>('#name')!;
        input.value = token;
        input.dispatchEvent(new Event('input', {bubbles: true}));
        await nextTick();
        const form = host.querySelector<HTMLFormElement>('#forgotForm')!;
        expect(submit(form).defaultPrevented).toBe(false);
        await nextTick();
        const button = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
        expect(button.disabled).toBe(true);

        // Only the browser's persisted restore proves this is another visit.
        // Ordinary initialization/visibility events cannot reopen a pending form.
        const ordinary = new Event('pageshow');
        Object.defineProperty(ordinary, 'persisted', {value: false});
        window.dispatchEvent(ordinary);
        await nextTick();
        expect(button.disabled).toBe(true);
        const restored = new Event('pageshow');
        Object.defineProperty(restored, 'persisted', {value: true});
        window.dispatchEvent(restored);
        await nextTick();
        expect(button.disabled).toBe(false);
        expect(input.value).toBe(token);
        expect(request).not.toHaveBeenCalled();
    });
});
