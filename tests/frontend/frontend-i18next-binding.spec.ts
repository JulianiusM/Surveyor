// @vitest-environment happy-dom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {defineComponent, h, nextTick, ref} from 'vue';
import {renderToString} from 'vue/server-renderer';
import {createPilotApp} from '../../src/frontend/app/createApp';
import {usePilot} from '../../src/frontend/app/context';
import {usePackingApi} from '../../src/frontend/features/packing/api';
import {useOverviewApi} from '../../src/frontend/features/overview/api';
import {useHelpApi} from '../../src/frontend/features/help/api';
import StatusNotice from '../../src/frontend/components/StatusNotice.vue';
import {ApiFailure} from '../../src/frontend/app/transport';
import {validateProblem} from '../../.generated/api/v1/browser/validateProblem.mjs';
import type {components} from '../../src/types/api/v1';
import type {PilotContext} from '../../src/types/FrontendPilotUiTypes';

const session: components['schemas']['SessionView'] = {kind: 'anonymous', deployment: {buildId: 'fixture', apiCompatibility: 'v1-pilot-2026-10-07'}, context: 'binding-context',
    csrfToken: 'binding-csrf', locale: 'en', activeProfile: null, profiles: [], loginUrl: '/users/login',
    logoutUrl: null,
    shell: {version: 'fixture', imprintUrl: '/imprint', privacyPolicyUrl: '/privacy',
        localLoginEnabled: true, oidcEnabled: false, oidcName: 'Provider'}};
const path = '/frontend-pilot/binding-fixture';
const Fixture = defineComponent({
    setup() {
        const {messages} = usePilot();
        const draft = ref('');
        // This must be a complete known Problem: an invalid envelope deliberately
        // keeps its safe text rather than gaining a catalog/message identity.
        const problem: components['schemas']['Problem'] = {type: 'about:blank', title: 'Rejected', status: 400,
            code: 'VALIDATION_FAILED', detail: 'Review the request.', requestId: 'binding-read-validation',
            messageKey: 'api:errors.VALIDATION_FAILED', params: {}};
        if (!validateProblem(problem)) throw new Error('The binding fixture requires a validated known Problem.');
        const readError = new ApiFailure(400, problem);
        return () => h('section', [h('span', {id: 'binding-message'}, messages.value.t('common.save')),
            h(StatusNotice, {id: 'binding-read-notice', kind: 'warning', readError,
                lastUpdatedAt: Date.UTC(2026, 9, 11, 6), retryAt: Date.UTC(2026, 9, 11, 6, 1)},
                () => messages.value.t('state.stale')),
            h('input', {id: 'binding-draft', value: draft.value,
                onInput: (event: Event) => { draft.value = (event.target as HTMLInputElement).value; }})]);
    },
});

afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ''; });

describe('typed i18next-vue binding', () => {
    it('reuses feature API owners across component bindings while isolating server requests', async () => {
        const bindings: PilotContext[] = [];
        const Probe = defineComponent({
            setup() {
                bindings.push(usePilot());
                return () => h('span', 'Feature owner probe');
            },
        });
        const OwnerFixture = defineComponent({render: () => h('section', [h(Probe), h(Probe)])});
        const first = createPilotApp({session}, false);
        const second = createPilotApp({session}, false);
        try {
            for (const application of [first, second]) {
                application.router.addRoute({path, component: OwnerFixture});
                await application.router.push(path);
                await renderToString(application.app);
            }
            expect(bindings).toHaveLength(4);
            // The real library creates a translation wrapper per component. API ownership
            // belongs to the stable transport instead of those short-lived wrappers.
            expect(bindings[0]).not.toBe(bindings[1]);
            for (const owner of [usePackingApi, useOverviewApi, useHelpApi]) {
                expect(owner(bindings[0]!)).toBe(owner(bindings[1]!));
                expect(owner(bindings[2]!)).toBe(owner(bindings[3]!));
                expect(owner(bindings[0]!)).not.toBe(owner(bindings[2]!));
            }
        } finally { first.context.start()(); second.context.start()(); }
    });

    it('hydrates the real application and refreshes library translations without replacing draft input', async () => {
        const profiles = [{id: '11111111-1111-4111-8111-111111111111', name: 'First profile'},
            {id: '22222222-2222-4222-8222-222222222222', name: 'Second profile'}];
        const account: components['schemas']['SessionView'] = {...session, kind: 'account', profiles,
            activeProfile: profiles[0]!, logoutUrl: '/users/logout'};
        const bootstrap = {session: account, initialUrl: path};
        const server = createPilotApp(bootstrap, false);
        server.router.addRoute({path, component: Fixture});
        await server.router.push(path);
        const html = await renderToString(server.app);
        server.context.start()();
        document.body.innerHTML = `<div id="binding-app">${html}</div>`;
        window.history.replaceState({}, '', path);
        const warnings = vi.spyOn(console, 'warn');
        const errors = vi.spyOn(console, 'error');
        const browser = createPilotApp(bootstrap, true);
        browser.router.addRoute({path, component: Fixture});
        try {
            await browser.router.push(path);
            await browser.router.isReady();
            browser.app.mount('#binding-app');
            expect(document.querySelector('header form')).toBeNull();
            expect(document.querySelector('header')?.textContent).toContain('First profile');
            browser.context.hydrated.value = true;
            await nextTick();
            const submit = document.querySelector<HTMLButtonElement>('header form button[type="submit"]')!;
            expect(submit).not.toBeNull();
            expect(submit.form?.getAttribute('method')).toBeNull();
            expect(submit.form?.getAttribute('action')).toBeNull();
            expect(document.querySelector('a[href="/users/profile/manage"]')).not.toBeNull();
            expect(document.querySelector('#pilot-profile')).toBeNull();
            const input = document.getElementById('binding-draft') as HTMLInputElement;
            input.value = 'My unfinished edit';
            input.dispatchEvent(new Event('input', {bubbles: true}));
            await nextTick();
            expect(document.getElementById('binding-message')?.textContent).toBe('Save');
            // This event belongs to the actual selected library binding, rather than our locale ref.
            browser.context.i18next.addResource('en', 'ui', 'common.save', 'Save edited translation');
            browser.context.i18next.addResource('en', 'ui', 'state.lastSuccessfulRefresh', 'Freshness edited: {{time}}');
            browser.context.i18next.addResource('en', 'ui', 'state.retryAvailableAt', 'Retry edited: {{time}}');
            browser.context.i18next.addResource('en', 'api', 'errors.VALIDATION_FAILED', 'Query issue edited translation');
            await nextTick();
            await nextTick();
            expect(document.getElementById('binding-message')?.textContent).toBe('Save edited translation');
            expect(document.querySelector('#binding-read-notice [data-last-successful-refresh]')?.textContent).toContain('Freshness edited:');
            expect(document.querySelector('#binding-read-notice [data-read-retry-at]')?.textContent).toContain('Retry edited:');
            expect(document.querySelector('#binding-read-notice [data-read-issue]')?.textContent).toBe('Query issue edited translation');
            browser.context.locale.value = 'de';
            await nextTick();
            await nextTick();
            expect(document.getElementById('binding-message')?.textContent).toBe('Speichern');
            expect(document.querySelector('header form button[type="submit"]')).toBe(submit);
            expect(document.getElementById('binding-draft')).toBe(input);
            expect(input.value).toBe('My unfinished edit');
            expect(warnings.mock.calls.flat().join(' ')).not.toContain('Hydration');
            expect(errors.mock.calls.flat().join(' ')).not.toContain('Hydration');
        } finally { browser.app.unmount(); browser.context.start()(); }
        const nextServer = createPilotApp(bootstrap, false);
        expect(nextServer.context.messages.value.t('common.save')).toBe('Save');
        nextServer.context.start()();
    });

    it('keeps simultaneous server languages and the generated parameter boundary isolated', async () => {
        const english = createPilotApp({session}, false);
        const german = createPilotApp({session: {...session, locale: 'de'}}, false);
        english.router.addRoute({path, component: Fixture});
        german.router.addRoute({path, component: Fixture});
        try {
            await Promise.all([english.router.push(path), german.router.push(path)]);
            const [en, de] = await Promise.all([renderToString(english.app), renderToString(german.app)]);
            expect(en).toContain('id="binding-message">Save');
            expect(de).toContain('id="binding-message">Speichern');
            expect(() => english.context.messages.value.t('app.activeProfile', {} as {name: string}))
                .toThrow('Missing translation parameter: name');
        } finally { english.context.start()(); german.context.start()(); }
    });
});
