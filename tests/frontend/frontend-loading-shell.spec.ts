// @vitest-environment happy-dom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {flushPromises, mount} from '@vue/test-utils';
import {createSSRApp, defineComponent, h, ref} from 'vue';
import type {Component} from 'vue';
import {renderToString} from 'vue/server-renderer';
import {createMemoryHistory, createRouter, isNavigationFailure} from 'vue-router';
import {VueQueryPlugin} from '@tanstack/vue-query';
import I18NextVue from 'i18next-vue';
import App from '../../src/frontend/app/App.vue';
import LoadingSkeleton from '../../src/frontend/components/LoadingSkeleton.vue';
import {createPilotContext, pilotContextKey} from '../../src/frontend/app/context';
import {render} from '../../src/frontend/app/entry-server';
import type {components} from '../../src/types/api/v1';

const session: components['schemas']['SessionView'] = {
    kind: 'anonymous', context: 'loading-context-1234567890', csrfToken: 'loading-csrf-1234567890', locale: 'en',
    deployment: {buildId: 'fixture', apiCompatibility: 'v1-pilot-2026-10-07'}, activeProfile: null, profiles: [],
    loginUrl: '/users/login', logoutUrl: null, shell: {version: 'fixture', imprintUrl: '/imprint',
        privacyPolicyUrl: '/privacy', localLoginEnabled: true, oidcEnabled: false, oidcName: 'Provider'},
};
const cleanups: Array<() => void> = [];

afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
});

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((finish, fail) => { resolve = finish; reject = fail; });
    return {promise, resolve, reject};
}

function destination(title: string): Component {
    return defineComponent({render: () => h('h1', title)});
}

/** Only route delivery is delayed. Production App, RouterView, router lifecycle and
 * localized skeleton rendering remain intact, including the current mounted draft. */
async function mountedApp() {
    const context = createPilotContext({session}, true, vi.fn());
    const draftPage = defineComponent({
        setup() { return {draft: ref('Original draft')}; },
        template: '<label>Existing draft <input v-model="draft" /></label>',
    });
    const router = createRouter({history: createMemoryHistory(), routes: [
        {path: '/frontend-pilot', component: draftPage},
    ]});
    await router.push('/frontend-pilot');
    const wrapper = mount(App, {attachTo: document.body, global: {
        plugins: [router, [VueQueryPlugin, {queryClient: context.queryClient}],
            [I18NextVue, {i18next: context.i18next}]],
        provide: {[pilotContextKey as symbol]: context},
    }});
    await flushPromises();
    cleanups.push(() => { wrapper.unmount(); context.start()(); });
    return {wrapper, router, context};
}

describe('shared skeleton accessibility', () => {
    it.each(['lines', 'form', 'table', 'cards', 'article'] as const)(
        'announces %s loading once and keeps every placeholder decorative', variant => {
            const context = createPilotContext({session}, false);
            const wrapper = mount(LoadingSkeleton, {props: {variant}, global: {
                plugins: [[I18NextVue, {i18next: context.i18next}]],
                provide: {[pilotContextKey as symbol]: context},
            }});
            cleanups.push(() => { wrapper.unmount(); context.start()(); });
            expect(wrapper.attributes('data-loading-skeleton')).toBe(variant);
            expect(wrapper.findAll('[role="status"]')).toHaveLength(1);
            expect(wrapper.get('[role="status"]').text()).toBe('Loading…');
            expect(wrapper.get('[role="status"]').classes()).toContain('visually-hidden');
            expect(wrapper.get('.pilot-skeleton-shapes').attributes('aria-hidden')).toBe('true');
            expect(wrapper.find('input, button, a, select, textarea, [tabindex]').exists()).toBe(false);
        },
    );

    it('accepts a region-specific translated status without duplicating an announcement', () => {
        const context = createPilotContext({session: {...session, locale: 'de'}}, false);
        const wrapper = mount(LoadingSkeleton, {props: {label: 'Inhalt wird geladen'}, global: {
            plugins: [[I18NextVue, {i18next: context.i18next}]],
            provide: {[pilotContextKey as symbol]: context},
        }});
        cleanups.push(() => { wrapper.unmount(); context.start()(); });
        expect(wrapper.findAll('[role="status"]')).toHaveLength(1);
        expect(wrapper.get('[role="status"]').text()).toBe('Inhalt wird geladen');
    });

    it.each(['lines', 'form', 'table', 'cards', 'article'] as const)(
        'keeps server-rendered %s geometry and status inside a phrasing context', async variant => {
            const context = createPilotContext({session}, false);
            const app = createSSRApp(defineComponent({
                components: {LoadingSkeleton},
                setup() { return {variant}; },
                template: '<p id="inline-loading">Before<LoadingSkeleton :variant="variant" :rows="1" />After</p>',
            }));
            app.provide(pilotContextKey, context);
            app.use(I18NextVue, {i18next: context.i18next});
            cleanups.push(() => { context.start()(); });
            const host = document.createElement('div');
            host.innerHTML = await renderToString(app);
            // Invalid block wrappers cause the browser to close the paragraph before
            // hydration; verify the parsed DOM, rather than only the source template.
            expect(host.children).toHaveLength(1);
            const paragraph = host.querySelector('#inline-loading')!;
            expect(paragraph.querySelector('[data-loading-skeleton]')).not.toBeNull();
            expect(paragraph.querySelector('[role="status"]')?.textContent).toBe('Loading…');
            expect(paragraph.textContent).toContain('Before');
            expect(paragraph.textContent).toContain('After');
        },
    );
});

describe('lazy route delivery', () => {
    it('retains mounted input, selection and focus while showing progress until delivery commits', async () => {
        const {wrapper, router} = await mountedApp();
        const pending = deferred<Component>();
        router.addRoute({path: '/frontend-pilot/slow', component: () => pending.promise});
        const input = wrapper.get<HTMLInputElement>('main input');
        await input.setValue('Retained local edit');
        input.element.focus();
        input.element.setSelectionRange(2, 7);
        const navigation = router.push('/frontend-pilot/slow');
        await flushPromises();
        expect(wrapper.get('.pilot-navigation-loading').attributes('data-loading-skeleton')).toBe('lines');
        expect(router.currentRoute.value.path).toBe('/frontend-pilot');
        expect(wrapper.get('main input').element).toBe(input.element);
        expect(input.element.value).toBe('Retained local edit');
        expect(document.activeElement).toBe(input.element);
        expect([input.element.selectionStart, input.element.selectionEnd]).toEqual([2, 7]);
        pending.resolve(destination('Delivered destination'));
        await navigation;
        await flushPromises();
        expect(wrapper.find('.pilot-navigation-loading').exists()).toBe(false);
        expect(wrapper.text()).toContain('Delivered destination');
    });

    it('clears cancelled navigation without replacing the existing draft', async () => {
        const {wrapper, router} = await mountedApp();
        router.addRoute({path: '/frontend-pilot/blocked', component: destination('Blocked destination')});
        router.beforeResolve(() => false);
        const input = wrapper.get<HTMLInputElement>('main input');
        await input.setValue('Keep after cancellation');
        input.element.focus();
        const failure = await router.push('/frontend-pilot/blocked');
        await flushPromises();
        expect(isNavigationFailure(failure)).toBe(true);
        expect(wrapper.find('.pilot-navigation-loading').exists()).toBe(false);
        expect(wrapper.get('main input').element).toBe(input.element);
        expect(input.element.value).toBe('Keep after cancellation');
        expect(document.activeElement).toBe(input.element);
    });

    it('ignores an older cancelled import while a newer destination still loads', async () => {
        const {wrapper, router} = await mountedApp();
        const older = deferred<Component>();
        const newer = deferred<Component>();
        router.addRoute({path: '/frontend-pilot/older', component: () => older.promise});
        router.addRoute({path: '/frontend-pilot/newer', component: () => newer.promise});
        const oldNavigation = router.push('/frontend-pilot/older');
        await flushPromises();
        const newNavigation = router.push('/frontend-pilot/newer');
        await flushPromises();
        older.resolve(destination('Obsolete destination'));
        expect(isNavigationFailure(await oldNavigation)).toBe(true);
        await flushPromises();
        expect(wrapper.find('.pilot-navigation-loading').exists()).toBe(true);
        expect(wrapper.text()).not.toContain('Obsolete destination');
        newer.resolve(destination('Current destination'));
        await newNavigation;
        await flushPromises();
        expect(wrapper.find('.pilot-navigation-loading').exists()).toBe(false);
        expect(wrapper.text()).toContain('Current destination');
    });

    it('keeps the current view and releases progress when a retired module fails', async () => {
        const {wrapper, router} = await mountedApp();
        const pending = deferred<Component>();
        router.addRoute({path: '/frontend-pilot/retired', component: () => pending.promise});
        // An existing error owner receives the failure; delivery presentation does not
        // manufacture a second error or replace the still usable mounted resource.
        const errorOwner = vi.fn();
        router.onError(errorOwner);
        const navigation = router.push('/frontend-pilot/retired');
        const rejected = expect(navigation).rejects.toThrow('Failed to fetch dynamically imported module');
        await flushPromises();
        expect(wrapper.find('.pilot-navigation-loading').exists()).toBe(true);
        pending.reject(new Error('Failed to fetch dynamically imported module'));
        await rejected;
        await flushPromises();
        expect(errorOwner).toHaveBeenCalledOnce();
        expect(wrapper.find('.pilot-navigation-loading').exists()).toBe(false);
        expect(wrapper.get('main input').element).toBeInstanceOf(HTMLInputElement);
    });

    it('does not let an obsolete chunk error clear a newer pending destination', async () => {
        const {wrapper, router} = await mountedApp();
        const older = deferred<Component>();
        const newer = deferred<Component>();
        router.addRoute({path: '/frontend-pilot/older', component: () => older.promise});
        router.addRoute({path: '/frontend-pilot/newer', component: () => newer.promise});
        const oldNavigation = router.push('/frontend-pilot/older');
        const rejected = expect(oldNavigation).rejects.toThrow('Failed to fetch dynamically imported module');
        await flushPromises();
        const newNavigation = router.push('/frontend-pilot/newer');
        await flushPromises();
        older.reject(new Error('Failed to fetch dynamically imported module'));
        await rejected;
        await flushPromises();
        expect(wrapper.find('.pilot-navigation-loading').exists()).toBe(true);
        expect(wrapper.find('main input').exists()).toBe(true);
        newer.resolve(destination('Destination survives old delivery error'));
        await newNavigation;
        await flushPromises();
        expect(wrapper.find('.pilot-navigation-loading').exists()).toBe(false);
        expect(wrapper.text()).toContain('Destination survives old delivery error');
    });

    it('lets a redirected destination own progress until its lazy view is delivered', async () => {
        const {wrapper, router} = await mountedApp();
        const pending = deferred<Component>();
        router.addRoute({path: '/frontend-pilot/destination', component: () => pending.promise});
        router.addRoute({path: '/frontend-pilot/redirect', redirect: '/frontend-pilot/destination'});
        const navigation = router.push('/frontend-pilot/redirect');
        await flushPromises();
        expect(wrapper.find('.pilot-navigation-loading').exists()).toBe(true);
        pending.resolve(destination('Redirected destination'));
        await navigation;
        await flushPromises();
        expect(wrapper.find('.pilot-navigation-loading').exists()).toBe(false);
        expect(wrapper.text()).toContain('Redirected destination');
    });

    it('renders independent authorized SSR documents without route-delivery progress', async () => {
        const help: components['schemas']['HelpPageData'] = {locale: 'en', title: 'Synthetic guide',
            currentDoc: 'fixture.md', content: '<p>Already loaded help</p>', docsList: [], docsGroups: [], toc: []};
        const first = await render('/frontend-pilot/help?doc=fixture', {session, help});
        const second = await render('/frontend-pilot/help?doc=fixture', {session: {...session, context: 'other-request-context'}, help});
        for (const result of [first, second]) {
            expect(result.html).not.toContain('pilot-navigation-loading');
            expect(result.html).toContain('Already loaded help');
        }
    });
});
