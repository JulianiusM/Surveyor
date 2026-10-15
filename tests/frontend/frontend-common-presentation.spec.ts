// @vitest-environment happy-dom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {flushPromises, mount} from '@vue/test-utils';
import {createSSRApp, defineComponent} from 'vue';
import type {Component} from 'vue';
import {renderToString} from 'vue/server-renderer';
import {createMemoryHistory, createRouter} from 'vue-router';
import I18NextVue from 'i18next-vue';
import {resolve} from 'node:path';
import * as pug from 'pug';
import LandingPage from '../../src/frontend/features/common/LandingPage.vue';
import CommonPage from '../../src/frontend/features/common/CommonPage.vue';
import PageMessage from '../../src/frontend/components/PageMessage.vue';
import {createPilotContext, pilotContextKey} from '../../src/frontend/app/context';
import {render} from '../../src/frontend/app/entry-server';
import {decodeBootstrap} from '../../src/frontend/app/serializeBootstrap';
import type {components} from '../../src/types/api/v1';
import type {FrontendCommonPage, FrontendPilotBootstrap} from '../../src/types/FrontendPilotTypes';

const session: components['schemas']['SessionView'] & {context: string; csrfToken: string} = {
    kind: 'anonymous', context: 'common-presentation-context-1234567890', csrfToken: 'common-presentation-csrf-1234567890',
    deployment: {buildId: 'fixture', apiCompatibility: 'v1-pilot-2026-10-07'}, locale: 'en',
    activeProfile: null, profiles: [], loginUrl: '/users/login', logoutUrl: null,
    shell: {version: 'fixture', imprintUrl: 'https://example.test/imprint', privacyPolicyUrl: 'https://example.test/privacy',
        localLoginEnabled: true, oidcEnabled: false, oidcName: 'Provider'},
};
const renderNativeLanding = pug.compileFile(resolve('src/views/index.pug'));
const renderNativeMessage = pug.compileFile(resolve('src/views/message.pug'));
const renderNativeError = pug.compileFile(resolve('src/views/error.pug'));
const routePlaceholder = defineComponent({template: '<p>Independent route</p>'});
const cleanups: Array<() => void> = [];

afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
    document.body.innerHTML = '';
});

/** Mount the actual presentation with its request-local translator and route scope.
 * Any accidental network dispatch is rejected instead of substituting application data. */
async function mounted(component: Component, props: Record<string, unknown> = {},
    bootstrap: Partial<FrontendPilotBootstrap> = {}, path = '/frontend-pilot/home') {
    const request = vi.fn(rejectUnexpectedRequest);
    const context = createPilotContext({session, initialUrl: path, ...bootstrap}, true, request);
    context.hydrated.value = true;
    const router = createRouter({history: createMemoryHistory(), routes: [
        {path: '/frontend-pilot/home', component: routePlaceholder},
        {path: '/frontend-pilot/message', component: routePlaceholder},
        {path: '/frontend-pilot', component: routePlaceholder},
        {path: '/frontend-pilot/:pathMatch(.*)*', component: routePlaceholder},
    ]});
    await router.push(path);
    await router.isReady();
    const wrapper = mount(component, {props, attachTo: document.body, global: {
        plugins: [router, [I18NextVue, {i18next: context.i18next}]],
        provide: {[pilotContextKey as symbol]: context},
    }});
    await flushPromises();
    cleanups.push(function disposeMountedPage() {wrapper.unmount(); context.queryClient.clear();});
    return {wrapper, context, router, request};
}

function rejectUnexpectedRequest(): Promise<Response> {
    return Promise.reject(new Error('A common presentation must not dispatch a feature or identity request.'));
}

/** Native templates remain the independent text/layout oracle; scripts never run in this detached tree. */
function nativePage(renderPage: pug.compileTemplate, values: Record<string, unknown> = {}): HTMLElement {
    const root = document.createElement('div');
    root.innerHTML = renderPage({status: undefined, messages: {}, version: session.shell.version,
        nxtUrl: encodeURIComponent('/'), profile: undefined, permData: undefined,
        settings: {rootUrl: 'https://example.test', imprintUrl: session.shell.imprintUrl,
            privacyPolicyUrl: session.shell.privacyPolicyUrl}, ...values});
    return root;
}

function texts(root: Element, selector: string): string[] {
    return Array.from(root.querySelectorAll(selector), normalizedText);
}

function normalizedText(element: Element): string {
    return element.textContent!.replace(/\s+/gu, ' ').trim();
}

function accountSession(kind: 'account' | 'guest'): components['schemas']['SessionView'] {
    const profile = {id: '11111111-1111-4111-8111-111111111111', name: '<Fixture profile>'};
    return {...session, kind, activeProfile: profile, profiles: kind === 'account' ? [profile] : [], logoutUrl: '/users/logout'};
}

describe('common frontend presentation', () => {
    it('retains anonymous landing copy, card order and responsive groups from the native template', async () => {
        const native = nativePage(renderNativeLanding).querySelector('main > .card')!;
        const {wrapper, context, request} = await mounted(LandingPage);
        expect(texts(wrapper.element, 'h1, h2, p, li')).toEqual(texts(native, 'h1, h2, p, li'));
        expect(texts(wrapper.element, '.row > .col h2')).toEqual(['Surveys', 'Events', 'Packing lists', 'Activity plans', 'Drivers lists']);
        expect(wrapper.findAll('.row')[0]!.classes()).toEqual(['row', 'row-cols-1', 'row-cols-md-2', 'row-cols-xl-3', 'g-4', 'mb-4']);
        expect(wrapper.findAll('.row')[1]!.classes()).toEqual(['row', 'row-cols-1', 'row-cols-md-2', 'g-4', 'mb-4']);
        expect(context.pageTitle.value).toBe('Surveyor – Organize and coordinate group activities');
        expect(request).not.toHaveBeenCalled();
    });

    it.each(['account', 'guest'] as const)('retains the %s welcome and admitted quick-create target without treating the profile name as HTML', async kind => {
        vi.spyOn(Math, 'random').mockReturnValue(0);
        const current = accountSession(kind);
        const native = nativePage(renderNativeLanding, {profile: {name: current.activeProfile!.name,
            ...(kind === 'account' ? {userId: 1} : {guestId: 'guest'})}}).querySelector('main > .card')!;
        const {wrapper, request} = await mounted(LandingPage, {}, {session: current, landing: {quickCreate: 'survey'}});
        expect(texts(wrapper.element, 'h1, h2, p, li')).toEqual(texts(native, 'h1, h2, p, li'));
        expect(wrapper.get('a.btn-outline-light').attributes('href')).toBe('/survey/create');
        expect(wrapper.get('a.btn-primary').attributes('href')).toBe('/frontend-pilot');
        expect(wrapper.find('fixture').exists()).toBe(false);
        expect(request).not.toHaveBeenCalled();
    });

    it('preserves the complete landing return path and chooses native or migrated creation navigation explicitly', async () => {
        const path = '/frontend-pilot/home?locale=en#about';
        const anonymous = await mounted(LandingPage, {}, {}, path);
        for (const link of anonymous.wrapper.findAll('a.btn')) {
            expect(new URL(link.attributes('href')!, 'https://example.test').searchParams.get('next')).toBe(path);
        }
        const signed = await mounted(LandingPage, {}, {session: accountSession('account'), landing: {quickCreate: 'packing'}});
        expect(signed.wrapper.get('a.btn-outline-light').attributes('href')).toBe('/frontend-pilot/packing/create');
    });

    it('keeps a warm visit suggestion stable while translating labels in place', async () => {
        const random = vi.spyOn(Math, 'random').mockReturnValue(0.99);
        const {wrapper, context} = await mounted(LandingPage, {}, {session: accountSession('guest'), initialUrl: '/frontend-pilot/help'});
        const link = wrapper.get('a.btn-outline-light');
        expect(link.attributes('href')).toBe('/drivers/create');
        random.mockReturnValue(0);
        context.locale.value = 'de';
        await flushPromises();
        expect(wrapper.get('a.btn-outline-light').element).toBe(link.element);
        expect(link.attributes('href')).toBe('/drivers/create');
        expect(link.text()).toBe('Neue Fahrgemeinschaftsliste starten');
        expect(context.pageTitle.value).toBe('Surveyor – Gruppenaktivitäten organisieren und koordinieren');
    });

    it('renders the server-selected landing suggestion without resampling during SSR', async () => {
        const bootstrap: FrontendPilotBootstrap = {session: accountSession('account'), initialUrl: '/frontend-pilot/home',
            landing: {quickCreate: 'packing'}};
        const context = createPilotContext(bootstrap, false);
        const router = createRouter({history: createMemoryHistory(), routes: [{path: '/frontend-pilot/home', component: LandingPage}]});
        await router.push(bootstrap.initialUrl!);
        await router.isReady();
        const application = createSSRApp(LandingPage);
        application.provide(pilotContextKey, context);
        application.use(router);
        application.use(I18NextVue, {i18next: context.i18next});
        const random = vi.spyOn(Math, 'random').mockReturnValue(0);
        try {
            const html = await renderToString(application);
            const root = document.createElement('div');
            root.innerHTML = html;
            expect(root.querySelector('a.btn-outline-light')!.getAttribute('href')).toBe('/frontend-pilot/packing/create');
            expect(random).not.toHaveBeenCalled();
        } finally {context.queryClient.clear();}
    });

    it('adopts landing and static error outcomes through the actual application renderer and bootstrap decoder', async () => {
        const landing = await render('/frontend-pilot/home', {session: accountSession('account'), landing: {quickCreate: 'drivers'}});
        expect(landing.title).toBe('Surveyor – Organize and coordinate group activities');
        expect(landing.javascriptRequired).toBe(false);
        expect(landing.html).toContain('href="/drivers/create"');
        expect((await decodeBootstrap(JSON.parse(landing.state))).landing).toEqual({quickCreate: 'drivers'});
        await expect(decodeBootstrap({...JSON.parse(landing.state), landing: {quickCreate: ['packing']}}))
            .rejects.toThrow('Invalid pilot bootstrap field: landing');

        const page: FrontendCommonPage = {kind: 'error', status: 404, message: 'Safe missing destination', messageKey: 'api:errors.NOT_FOUND'};
        const error = await render('/frontend-pilot/missing', {session, commonPage: page});
        expect(error.javascriptRequired).toBe(false);
        expect(error.html).toContain('(Status 404)');
        expect((await decodeBootstrap(JSON.parse(error.state))).commonPage).toEqual(page);
        await expect(decodeBootstrap({...JSON.parse(error.state), commonPage: {...page, messageKey: 'landing.welcome'}}))
            .rejects.toThrow('Invalid pilot bootstrap field: commonPage');
        await expect(decodeBootstrap({...JSON.parse(error.state), commonPage: {kind: 'message', severity: ['success'], message: 'Admitted text'}}))
            .rejects.toThrow('Invalid pilot bootstrap field: commonPage');
    });

    it.each(['info', 'success', 'warning', 'error'] as const)('retains native %s message headings/body policy and returns Home to the opt-in landing', async severity => {
        const message = 'A confirmed <safe> outcome';
        const native = nativePage(renderNativeMessage, {status: severity, message}).querySelector('main > .card')!;
        const {wrapper, context, request} = await mounted(CommonPage,
            {page: {kind: 'message', severity, message}}, {}, '/frontend-pilot/message');
        expect(texts(wrapper.element, 'h1')).toEqual(texts(native, 'h1'));
        expect(texts(wrapper.element, '.alert')).toEqual(texts(native, '.alert'));
        expect(wrapper.get('a.btn-primary').attributes('href')).toBe('/frontend-pilot/home');
        expect(context.pageTitle.value).toBe(nativePage(renderNativeMessage, {status: severity, message}).querySelector('title')!.textContent);
        expect(wrapper.find('safe').exists()).toBe(false);
        expect(request).not.toHaveBeenCalled();
    });

    it('preserves the existing default Home destination for prior PageMessage consumers', async () => {
        const {wrapper} = await mounted(PageMessage, {kind: 'info', message: 'Existing feature outcome'});
        expect(wrapper.get('a.btn-primary').attributes('href')).toBe('/frontend-pilot');
    });

    it('retains native escaped error, status and admitted stack presentation', async () => {
        const page: FrontendCommonPage = {kind: 'error', status: 503, message: '<img src=x onerror=alert(1)>',
            stack: 'Error: <private development trace>\n    at fixture'};
        const native = nativePage(renderNativeError, {message: page.message, code: page.status, error: {stack: page.stack}}).querySelector('main > .card')!;
        const {wrapper, context} = await mounted(CommonPage, {page}, {}, '/frontend-pilot/unavailable');
        expect(texts(wrapper.element, 'h1, strong, summary, code')).toEqual(texts(native, 'h1, strong, summary, code'));
        expect(normalizedText(wrapper.get('.status-notice').element)).toEqual(normalizedText(native.querySelector('.status-notice')!));
        expect(wrapper.find('img').exists()).toBe(false);
        expect(context.pageTitle.value).toBe('Error | Surveyor');
    });

    it('never manufactures a completion or development diagnostics from route query data', async () => {
        const {wrapper} = await mounted(CommonPage, {}, {}, '/frontend-pilot/message?message=Forged&status=200&stack=Private');
        expect(wrapper.find('details').exists()).toBe(false);
        expect(wrapper.text()).not.toContain('Forged');
        expect(wrapper.text()).not.toContain('Private');
        expect(wrapper.text()).toContain('(Status 404)');
    });

    it('retranslates an admitted initial error key and status without replacing its escaped literal fallback or stack', async () => {
        const path = '/frontend-pilot/missing';
        const admitted: FrontendCommonPage = {kind: 'error', status: 404, message: 'Safe native fallback',
            messageKey: 'api:errors.NOT_FOUND', stack: 'Development-only <trace>'};
        const {wrapper, context} = await mounted(CommonPage, {}, {commonPage: admitted}, path);
        const message = wrapper.get('strong');
        const stack = wrapper.get('code');
        expect(message.text()).toBe(context.messages.value.t('api:errors.NOT_FOUND'));
        context.locale.value = 'de';
        await flushPromises();
        expect(wrapper.get('strong').element).toBe(message.element);
        expect(message.text()).toBe(context.messages.value.t('api:errors.NOT_FOUND'));
        expect(message.text()).not.toBe('Safe native fallback');
        expect(stack.element).toBe(wrapper.get('code').element);
        expect(stack.text()).toBe('Development-only <trace>');
        expect(wrapper.text()).toContain('(Status 404)');
    });

    it('admits only the current actor and exact destination completion on a warm message visit', async () => {
        const destination = '/frontend-pilot/message?receipt=fixture';
        const {wrapper, context} = await mounted(CommonPage, {}, {initialUrl: '/frontend-pilot/help'}, destination);
        context.pageCompletion.value = {context: session.context, destination, kind: 'success', messageKey: 'auth.resetDone'};
        await flushPromises();
        expect(wrapper.get('h1').text()).toBe('Success');
        context.pageCompletion.value = {...context.pageCompletion.value!, context: 'retired-actor-context'};
        await flushPromises();
        expect(wrapper.text()).toContain('(Status 404)');
        context.pageCompletion.value = {context: session.context, destination: '/frontend-pilot/other', kind: 'success', messageKey: 'auth.resetDone'};
        await flushPromises();
        expect(wrapper.text()).toContain('(Status 404)');
    });

    it('does not revive an expired confirmed message when its language changes', async () => {
        vi.useFakeTimers();
        // Happy DOM has no layout; make the actual mounted notice visible to its
        // existing expiry owner rather than bypassing that owner's timer policy.
        vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
        const destination = '/frontend-pilot/message';
        const {wrapper, context} = await mounted(CommonPage, {}, {initialUrl: '/frontend-pilot/help'}, destination);
        context.pageCompletion.value = {context: session.context, destination, kind: 'success', messageKey: 'auth.resetDone'};
        await flushPromises();
        expect(wrapper.find('.alert').exists()).toBe(true);
        await vi.advanceTimersByTimeAsync(10_001);
        await flushPromises();
        expect(wrapper.find('.alert').exists()).toBe(false);
        context.locale.value = 'de';
        await flushPromises();
        expect(wrapper.get('h1').text()).toBe('Erfolg');
        expect(wrapper.find('.alert').exists()).toBe(false);
    });
});
