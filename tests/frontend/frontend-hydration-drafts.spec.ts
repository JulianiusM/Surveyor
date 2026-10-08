// @vitest-environment happy-dom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {flushPromises} from '@vue/test-utils';
import {createSSRApp, defineComponent, h, nextTick, ref} from 'vue';
import {renderToString} from 'vue/server-renderer';
import {render} from '../../src/frontend/app/entry-server';
import {createPilotApp} from '../../src/frontend/app/createApp';
import {mountPreservingDrafts} from '../../src/frontend/app/mountPreservingDrafts';
import FormField from '../../src/frontend/components/FormField.vue';
import type {FrontendPilotBootstrap} from '../../src/types/FrontendPilotTypes';
import type {components} from '../../src/types/api/v1';

const profileId = '11111111-1111-4111-8111-111111111111';
const session: components['schemas']['SessionView'] = {kind: 'anonymous', context: 'hydration-context',
    csrfToken: 'hydration-csrf', locale: 'en', activeProfile: null, profiles: [], loginUrl: '/users/login',
    logoutUrl: null, deployment: {buildId: 'fixture', apiCompatibility: 'v1-pilot-2026-10-07'},
    shell: {version: 'fixture', imprintUrl: '/imprint', privacyPolicyUrl: '/privacy',
        localLoginEnabled: true, oidcEnabled: false, oidcName: 'Provider'}};
const help: components['schemas']['HelpPageData'] = {locale: 'en', title: 'Synthetic help',
    content: '<h2 id="task">A synthetic task</h2>', currentDoc: 'fixture.md', docsList: [], docsGroups: [], toc: []};
const cleanups: (() => void)[] = [];

afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
});

/** Use the actual native render and client component tree, leaving an editing window before mount. */
async function nativeApplication(url: string, bootstrap: FrontendPilotBootstrap) {
    const result = await render(url, bootstrap);
    document.body.innerHTML = `<div id="surveyor-pilot">${result.html}</div>`;
    window.history.replaceState({}, '', url);
    const browser = createPilotApp(JSON.parse(result.state) as FrontendPilotBootstrap, true);
    await browser.router.isReady();
    cleanups.push(() => { browser.app.unmount(); browser.context.start()(); });
    const container = document.getElementById('surveyor-pilot')!;
    async function hydrate() {
        mountPreservingDrafts(browser.app, container);
        await nextTick();
    }
    return {...browser, container, hydrate};
}

describe('text drafts entered before hydration', () => {
    it('keeps an early help search and submits its edited value through client navigation', async () => {
        const request = vi.fn(() => { throw new Error('Hydration must not submit or read'); });
        vi.stubGlobal('fetch', request);
        const {container, router, hydrate} = await nativeApplication('/frontend-pilot/help?q=initial', {session, help});
        const input = container.querySelector<HTMLInputElement>('#pilot-help-search')!;
        input.value = 'My early help search';
        input.focus();
        input.setSelectionRange(3, 8);
        await hydrate();
        expect(container.querySelector('#pilot-help-search')).toBe(input);
        expect(input.value).toBe('My early help search');
        expect(document.activeElement).toBe(input);
        expect([input.selectionStart, input.selectionEnd]).toEqual([3, 8]);
        expect(request).not.toHaveBeenCalled();
        input.form!.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
        await flushPromises();
        expect(router.currentRoute.value.query.q).toBe('My early help search');
    }, 30_000); // The first real lazy route may compile its view/validator graph under Vitest.

    it('keeps independent overview search drafts and preserves the other region when submitted', async () => {
        const request = vi.fn(() => { throw new Error('Hydration must not submit or read'); });
        vi.stubGlobal('fetch', request);
        const account: components['schemas']['SessionView'] = {...session, kind: 'account',
            activeProfile: {id: profileId, name: 'Fixture'}, profiles: [{id: profileId, name: 'Fixture'}], logoutUrl: '/users/logout'};
        const {container, router, hydrate} = await nativeApplication('/frontend-pilot?owner_main_q=initial', {
            session: account, overview: [],
        });
        const owner = container.querySelector<HTMLInputElement>('input[type="search"][name="owner_main_q"]')!;
        const participant = container.querySelector<HTMLInputElement>('input[type="search"][name="participant_main_q"]')!;
        owner.value = 'Owner early search';
        participant.value = 'Participant early search';
        await hydrate();
        expect(owner.value).toBe('Owner early search');
        expect(participant.value).toBe('Participant early search');
        expect(request).not.toHaveBeenCalled();
        participant.form!.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
        await flushPromises();
        expect(router.currentRoute.value.query).toEqual({owner_main_q: 'initial', participant_main_q: 'Participant early search'});
    }, 30_000); // Each initially visited lazy feature can compile during its first SSR render.

    it('preserves early/autofilled identity fields without submitting until the user requests it', async () => {
        const request = vi.fn(async (_input: RequestInfo | URL) => new Response(JSON.stringify({type: 'about:blank', title: 'Rejected',
            status: 400, code: 'VALIDATION_FAILED', detail: 'Review the request.', messageKey: 'api:errors.VALIDATION_FAILED', params: {}}),
        {status: 400, headers: {'Content-Type': 'application/json', 'X-Surveyor-Context': session.context}}));
        vi.stubGlobal('fetch', request);
        const {container, context, hydrate} = await nativeApplication('/frontend-pilot/users/login', {session});
        const username = container.querySelector<HTMLInputElement>('#username')!;
        const password = container.querySelector<HTMLInputElement>('#password')!;
        const admission = container.querySelector<HTMLInputElement>('main input[name="_csrf"]')!;
        const locale = container.querySelector<HTMLSelectElement>('#pilot-locale')!;
        username.value = 'early-account';
        password.value = 'synthetic-early-password';
        admission.value = 'Do not adopt a hidden value';
        locale.value = 'de';
        const selectionChange = vi.fn();
        locale.addEventListener('change', selectionChange);
        await hydrate();
        expect(username.value).toBe('early-account');
        expect(password.value).toBe('synthetic-early-password');
        expect(admission.value).toBe(session.csrfToken);
        expect(context.locale.value).toBe('en');
        expect(selectionChange).not.toHaveBeenCalled();
        expect(request).not.toHaveBeenCalled();
        username.form!.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
        await flushPromises();
        expect(request).toHaveBeenCalledOnce();
        const submitted = request.mock.calls[0]![0] as Request;
        expect(new URL(submitted.url).pathname).toBe('/api/v1/auth/login');
        expect(await submitted.json()).toEqual({username: 'early-account', password: 'synthetic-early-password', next: '/frontend-pilot'});
        expect(context.bootstrap).not.toHaveProperty('password');
    }, 30_000);

    it('leaves untouched, disabled and read-only fields at their authored values', async () => {
        const Fixture = defineComponent({
            setup() {
                const untouched = ref('Server value');
                return () => h('form', [
                    h(FormField, {id: 'untouched', label: 'Untouched', modelValue: untouched.value,
                        'onUpdate:modelValue': (value: string) => { untouched.value = value; }}),
                    h('input', {id: 'disabled', disabled: true, value: 'Disabled value'}),
                    h('input', {id: 'readonly', readonly: true, value: 'Read-only value'}),
                    h('input', {id: 'hidden', type: 'hidden', value: 'Admission value'}),
                ]);
            },
        });
        document.body.innerHTML = `<div id="draft-fixture">${await renderToString(createSSRApp(Fixture))}</div>`;
        const container = document.getElementById('draft-fixture')!;
        for (const id of ['disabled', 'readonly', 'hidden']) {
            container.querySelector<HTMLInputElement>('#' + id)!.value = 'Not editable';
        }
        const inputs = Array.from(container.querySelectorAll('input'));
        const events = vi.fn();
        for (const input of inputs) input.addEventListener('input', events);
        const application = createSSRApp(Fixture);
        mountPreservingDrafts(application, container);
        cleanups.push(() => application.unmount());
        await nextTick();
        expect(inputs.map(input => input.value)).toEqual(['Server value', 'Disabled value', 'Read-only value', 'Admission value']);
        expect(events).not.toHaveBeenCalled();
    });
});
