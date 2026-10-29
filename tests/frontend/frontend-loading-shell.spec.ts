// @vitest-environment happy-dom
import {apiCompatibility} from '../../.generated/api/v1/policy.mjs';
import {afterEach, beforeAll, describe, expect, it, vi} from 'vitest';
import {mount} from '@vue/test-utils';
import {flushFrontendPromises as flushPromises} from '../keywords/frontendUiKeywords';
import {computed, createSSRApp, defineComponent, h, inject, onMounted, ref} from 'vue';
import type {Component} from 'vue';
import {renderToString} from 'vue/server-renderer';
import {createMemoryHistory, createRouter, isNavigationFailure} from 'vue-router';
import {VueQueryPlugin} from '@tanstack/vue-query';
import I18NextVue from 'i18next-vue';
import App from '../../src/frontend/app/App.vue';
import LoadingSkeleton from '../../src/frontend/components/LoadingSkeleton.vue';
import ActionButton from '../../src/frontend/components/ActionButton.vue';
import AppAccordionButton from '../../src/frontend/components/AppAccordionButton.vue';
import StatusNotice from '../../src/frontend/components/StatusNotice.vue';
import {createFrontendContext, frontendContextKey} from '../../src/frontend/app/context';
import {render} from '../../src/frontend/app/entry-server';
import {createFrontendApp, initializeFrontendApp} from '../../src/frontend/app/createApp';
import {pageReadinessKey} from '../../src/frontend/composables/pageNavigation';
import type {components} from '../../src/types/api/v1';

const session: components['schemas']['SessionView'] = {
    kind: 'anonymous', context: 'loading-context-1234567890', csrfToken: 'loading-csrf-1234567890', locale: 'en',
    deployment: {buildId: 'fixture', apiCompatibility}, activeProfile: null, profiles: [],
    loginUrl: '/users/login', logoutUrl: null, shell: {version: 'fixture', imprintUrl: '/imprint',
        privacyPolicyUrl: '/privacy', localLoginEnabled: true, oidcEnabled: false, oidcName: 'Provider'},
};
const cleanups: Array<() => void> = [];

/** The final SSR case resolves the real lazy Help route. Cold SFC transformation
 * is runner setup, not observable route-delivery time, and can compete with other
 * test files. Prepare that exact production graph with a bounded startup budget;
 * both independent documents still render through the real server entry below. */
beforeAll(async function prepareServerHelpRoute(): Promise<void> {
    await import('../../src/frontend/features/help/HelpPage.vue');
}, 30_000);

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
    const context = createFrontendContext({session}, true, vi.fn());
    const draftPage = defineComponent({
        setup() { return {draft: ref('Original draft')}; },
        template: '<label>Existing draft <input v-model="draft" /></label>',
    });
    const router = createRouter({history: createMemoryHistory(), routes: [
            {path: '/', component: draftPage},
        ]});
    await router.push('/');
    const wrapper = mount(App, {attachTo: document.body, global: {
            plugins: [router, [VueQueryPlugin, {queryClient: context.queryClient}],
                [I18NextVue, {i18next: context.i18next}]],
            provide: {[frontendContextKey as symbol]: context},
        }});
    await flushPromises();
    cleanups.push(() => { wrapper.unmount(); context.start()(); });
    return {wrapper, router, context};
}

describe('shared skeleton accessibility', () => {
    it.each([
        ['/users/profile', true],
        ['/users/profile/manage', true],
        ['/users/profile/create', false],
        ['/users/profile/migrate/request', true],
        ['/users/profile/delete', true],
        ['/users/account/delete', true],
    ] as const)('matches the shared balanced profile heading on %s', async (path, actions) => {
        const result = await render(path, {session});
        const host = document.createElement('div');
        host.innerHTML = result.html;
        expect(host.querySelector('.frontend-skeleton-page-header.frontend-skeleton-balanced-header')).not.toBeNull();
        expect(!!host.querySelector('.frontend-skeleton-header-actions')).toBe(actions);
    });

    it('keeps generic identity workflow headings independent of profile action geometry', async () => {
        const result = await render('/users/activate/fixture-token', {session});
        const host = document.createElement('div');
        host.innerHTML = result.html;
        expect(host.querySelector('.frontend-skeleton-page-header')).not.toBeNull();
        expect(host.querySelector('.frontend-skeleton-balanced-header, .frontend-skeleton-header-actions')).toBeNull();
    });

    it('keeps accordion state with its feature and guards synthetic activation before initialization or while disabled', async () => {
        const context = createFrontendContext({session}, false);
        const wrapper = mount(AppAccordionButton, {props: {expanded: false, controls: 'retained-panel'},
            slots: {default: '<span>Existing section</span>'},
            global: {provide: {[frontendContextKey as symbol]: context}}});
        cleanups.push(() => { wrapper.unmount(); context.start()(); });
        const button = wrapper.element;
        expect(wrapper.attributes('type')).toBe('button');
        expect(wrapper.attributes('aria-expanded')).toBe('false');
        expect(wrapper.attributes('aria-controls')).toBe('retained-panel');
        expect(wrapper.classes()).toContain('collapsed');
        button.dispatchEvent(new MouseEvent('click', {bubbles: true}));
        expect(wrapper.emitted('click')).toBeUndefined();

        context.hydrated.value = true;
        await flushPromises();
        await wrapper.trigger('click');
        expect(wrapper.emitted('click')).toHaveLength(1);
        // Activation emits intent; only the feature's new input changes disclosure.
        expect(wrapper.attributes('aria-expanded')).toBe('false');
        await wrapper.setProps({expanded: true, disabled: true});
        expect(wrapper.element).toBe(button);
        expect(wrapper.classes()).not.toContain('collapsed');
        expect(wrapper.attributes('aria-expanded')).toBe('true');
        button.dispatchEvent(new MouseEvent('click', {bubbles: true}));
        expect(wrapper.emitted('click')).toHaveLength(1);
    });

    it('gates contextual retry and dismiss controls until initialization while keeping standalone controls usable', async () => {
        const context = createFrontendContext({session}, false);
        const view = defineComponent({components: {ActionButton, StatusNotice}, template:
                '<ActionButton>Retry</ActionButton><StatusNotice placement="notification" transient>Notice</StatusNotice>'});
        const wrapper = mount(view, {global: {
                plugins: [[I18NextVue, {i18next: context.i18next}]], provide: {[frontendContextKey as symbol]: context},
            }});
        const standalone = mount(ActionButton);
        cleanups.push(() => { wrapper.unmount(); standalone.unmount(); context.start()(); });
        expect(wrapper.findAll('button')).toHaveLength(2);
        expect(wrapper.findAll('button').every(button => button.attributes('disabled') !== undefined)).toBe(true);
        expect(standalone.attributes('disabled')).toBeUndefined();
        context.hydrated.value = true;
        await flushPromises();
        expect(wrapper.findAll('button').every(button => button.attributes('disabled') === undefined)).toBe(true);
    });

    it('renders interactive account entry as a skeleton and keeps mobile navigation usable before initialization', async () => {
        const result = await render('/users/login', {session});
        const host = document.createElement('div');
        host.innerHTML = result.html;
        expect(host.querySelector('[data-frontend-initial-loading]')).not.toBeNull();
        expect(host.querySelector('main form, main input, main button')).toBeNull();
        expect(host.querySelector('#frontend-navbar-main')?.classList.contains('show')).toBe(true);
        expect(host.querySelector('.navbar-toggler')).toBeNull();
        expect(host.querySelector<HTMLSelectElement>('#frontend-locale')?.disabled).toBe(true);
        expect(host.querySelector('details a[href="/survey/create"]')).not.toBeNull();
        expect(host.querySelector('details summary')?.hasAttribute('aria-expanded')).toBe(false);
    }, 30_000);

    it.each(['create', '11111111-1111-4111-8111-111111111111/duplicate'])(
        'renders Survey %s loading as three full-width fields and recurring-choice rows', async destination => {
            const result = await render('/survey/' + destination, {session});
            const host = document.createElement('div');
            host.innerHTML = result.html;
            const skeleton = host.querySelector<HTMLElement>('main [data-loading-skeleton="survey-create"]')!;
            expect(skeleton).not.toBeNull();
            expect(skeleton.querySelectorAll('.frontend-skeleton-field')).toHaveLength(3);
            expect(skeleton.querySelectorAll('.frontend-skeleton-field.col-md-12')).toHaveLength(3);
            expect(skeleton.querySelectorAll('.frontend-skeleton-textarea')).toHaveLength(1);
            expect(skeleton.querySelectorAll('.frontend-skeleton-table-viewport')).toHaveLength(1);
            expect(skeleton.querySelector('[data-skeleton-columns]')?.getAttribute('data-skeleton-columns')).toBe('3');
            expect(skeleton.querySelectorAll('.frontend-skeleton-toolbar > .frontend-skeleton-control')).toHaveLength(2);
            expect(skeleton.querySelector('.frontend-skeleton-counters')).toBeNull();
            expect(skeleton.querySelectorAll('[role="status"]')).toHaveLength(1);
            expect(skeleton.querySelector('input, button, a, select, textarea, [tabindex]')).toBeNull();
        }, 30_000,
    );

    it('renders Survey detail loading as separate ballot/results tables and a two-column combination form', async () => {
        const result = await render('/survey/11111111-1111-4111-8111-111111111111', {session});
        const host = document.createElement('div');
        host.innerHTML = result.html;
        const skeleton = host.querySelector<HTMLElement>('main [data-loading-skeleton="survey"]')!;
        expect(skeleton).not.toBeNull();
        expect(skeleton.querySelectorAll('.frontend-skeleton-table-viewport')).toHaveLength(2);
        expect(Array.from(skeleton.querySelectorAll('[data-skeleton-columns]'), table =>
            table.getAttribute('data-skeleton-columns'))).toEqual(['4', '4']);
        expect(skeleton.querySelectorAll('.frontend-skeleton-field')).toHaveLength(2);
        expect(skeleton.querySelectorAll('.frontend-skeleton-field.col-md-6')).toHaveLength(2);
        expect(skeleton.querySelectorAll('.frontend-skeleton-form-footer-full')).toHaveLength(2);
        expect(skeleton.querySelector('.frontend-skeleton-counters')).toBeNull();
        expect(skeleton.querySelector('.frontend-skeleton-content .card')).toBeNull();
        expect(skeleton.querySelectorAll('[role="status"]')).toHaveLength(1);
        expect(skeleton.querySelector('input, button, a, select, textarea, [tabindex]')).toBeNull();
    }, 30_000);

    it.each(['create', '11111111-1111-4111-8111-111111111111/duplicate'])(
        'renders Activity %s loading with title/date columns and initial slots', async destination => {
            const result = await render('/activity/' + destination, {session});
            const host = document.createElement('div');
            host.innerHTML = result.html;
            const skeleton = host.querySelector<HTMLElement>('main [data-loading-skeleton="activity-create"]')!;
            expect(skeleton).not.toBeNull();
            expect(Array.from(skeleton.querySelectorAll('.frontend-skeleton-field'), field =>
                Array.from(field.classList).find(name => name.startsWith('col-md-'))))
                .toEqual(['col-md-6', 'col-md-3', 'col-md-3', 'col-md-12', 'col-md-12', 'col-md-12']);
            expect(skeleton.querySelectorAll('.frontend-skeleton-textarea')).toHaveLength(1);
            expect(skeleton.querySelectorAll('.frontend-skeleton-table-viewport')).toHaveLength(1);
            expect(skeleton.querySelectorAll('[role="status"]')).toHaveLength(1);
            expect(skeleton.querySelector('input, button, a, select, textarea, [tabindex]')).toBeNull();
        }, 30_000,
    );

    it('renders Activity loading with a weekly schedule and no list Quick Add', async () => {
        const result = await render('/activity/11111111-1111-4111-8111-111111111111', {session});
        const host = document.createElement('div');
        host.innerHTML = result.html;
        const skeleton = host.querySelector<HTMLElement>('main [data-loading-skeleton="activity"]')!;
        expect(skeleton).not.toBeNull();
        expect(skeleton.querySelector('.frontend-skeleton-page-header.frontend-skeleton-balanced-header')).not.toBeNull();
        expect(skeleton.querySelector('.frontend-skeleton-header-actions')).not.toBeNull();
        expect(skeleton.querySelector('[data-skeleton-columns]')?.getAttribute('data-skeleton-columns')).toBe('7');
        expect(skeleton.querySelector('.frontend-skeleton-counters')).not.toBeNull();
        expect(skeleton.querySelector('.frontend-skeleton-field')).toBeNull();
        expect(skeleton.querySelectorAll('[role="status"]')).toHaveLength(1);
        expect(skeleton.querySelector('input, button, a, select, textarea, [tabindex]')).toBeNull();
    }, 30_000);

    it('hydrates a scoped readable completion at an initial fragment without changing it into a skeleton', async () => {
        const url = '/guest/recovery';
        const rendered = await render(url, {session, pageCompletion: {context: session.context,
                destination: url, messageKey: 'auth.recoverySent', kind: 'success'}});
        document.body.innerHTML = `<div id="surveyor-frontend">${rendered.html}</div>`;
        window.history.replaceState({}, '', url + '#frontend-main');
        const application = createFrontendApp(JSON.parse(rendered.state), true);
        await application.router.isReady();
        const container = document.getElementById('surveyor-frontend')!;
        expect(container.querySelector('[data-frontend-initial-loading]')).toBeNull();
        const stop = await initializeFrontendApp(application, container);
        cleanups.push(() => { application.app.unmount(); stop(); });
        expect(container.querySelector('[data-frontend-initial-loading]')).toBeNull();
        expect(container.querySelector('main')!.textContent).toContain('guest account(s) have been sent');
        expect(application.router.currentRoute.value.hash).toBe('#frontend-main');
    }, 30_000);

    it('accepts a region-specific translated status without duplicating an announcement', () => {
        const context = createFrontendContext({session: {...session, locale: 'de'}}, false);
        const wrapper = mount(LoadingSkeleton, {props: {label: 'Inhalt wird geladen'}, global: {
                plugins: [[I18NextVue, {i18next: context.i18next}]],
                provide: {[frontendContextKey as symbol]: context},
            }});
        cleanups.push(() => { wrapper.unmount(); context.start()(); });
        expect(wrapper.findAll('[role="status"]')).toHaveLength(1);
        expect(wrapper.get('[role="status"]').text()).toBe('Inhalt wird geladen');
    });

    it.each(['lines', 'form', 'table', 'cards', 'article'] as const)(
        'keeps %s decorative with one announcement inside a parsed phrasing context', async variant => {
            const context = createFrontendContext({session}, false);
            const app = createSSRApp(defineComponent({
                components: {LoadingSkeleton},
                setup() { return {variant}; },
                template: '<p id="inline-loading">Before<LoadingSkeleton :variant="variant" :rows="1" />After</p>',
            }));
            app.provide(frontendContextKey, context);
            app.use(I18NextVue, {i18next: context.i18next});
            cleanups.push(() => { context.start()(); });
            const host = document.createElement('div');
            host.innerHTML = await renderToString(app);
            // Invalid block wrappers cause the browser to close the paragraph before
            // hydration; verify the parsed DOM, rather than only the source template.
            expect(host.children).toHaveLength(1);
            const paragraph = host.querySelector('#inline-loading')!;
            // Parsed output protects each static shape's semantics as well as the
            // hydration-sensitive wrapper. Custom labels and real mounted
            // loading consumers are covered separately, without a second shape matrix.
            const skeleton = paragraph.querySelector('[data-loading-skeleton]')!;
            expect(skeleton).not.toBeNull();
            expect(skeleton.getAttribute('data-loading-skeleton')).toBe(variant);
            expect(skeleton.querySelectorAll('[role="status"]')).toHaveLength(1);
            const status = skeleton.querySelector('[role="status"]')!;
            expect(status.textContent).toBe('Loading…');
            expect(status.classList.contains('visually-hidden')).toBe(true);
            expect(skeleton.querySelector('.frontend-skeleton-shapes')?.getAttribute('aria-hidden')).toBe('true');
            expect(skeleton.querySelector('input, button, a, select, textarea, [tabindex]')).toBeNull();
            expect(paragraph.textContent).toContain('Before');
            expect(paragraph.textContent).toContain('After');
        },
    );
});

describe('lazy route delivery', () => {
    it('does not wait for Help article readiness on an unmatched descendant error page', async () => {
        const {router, context} = createFrontendApp({session}, false);
        cleanups.push(() => { router.options.history.destroy(); context.queryClient.clear(); });
        await router.push('/help/unmatched/descendant#missing');
        const from = router.resolve('/');
        // The catch-all renders CommonPage and cannot register Help readiness.
        // Its ordinary fragment result must complete without waiting forever.
        expect(await router.options.scrollBehavior!(router.currentRoute.value,
            {...from, name: from.name ?? undefined}, null)).toEqual({el: '#missing'});
    });

    it.each(['anchor', 'history'] as const)('waits for the matched Help render before uppercase-path %s scrolling', async destination => {
        const {app, router, context} = createFrontendApp({session}, false);
        const readiness = app.runWithContext(() => inject(pageReadinessKey));
        expect(readiness).toBeDefined();
        await router.push('/HELP/?doc=activity_plans#rules');
        const current = router.currentRoute.value;
        const ready = ref(false);
        const release = readiness!.register({destination: computed(() => current.fullPath), ready});
        const completed = vi.fn();
        const saved = destination === 'history' ? {left: 0, top: 640} : null;
        const from = router.resolve('/users/login');
        const pending = Promise.resolve(router.options.scrollBehavior!(current,
            {...from, name: from.name ?? undefined}, saved)).then(value => { completed(value); return value; });
        try {
            // The real route has matched Help, but its requested article has not
            // rendered. History and anchors must use that same readiness owner.
            await flushPromises();
            expect(completed).not.toHaveBeenCalled();
            const heading = document.createElement('h2');
            heading.id = 'rules';
            document.body.append(heading);
            ready.value = true;
            expect(await pending).toEqual(saved ?? {el: heading, top: 0});
        } finally {
            release();
            router.options.history.destroy();
            context.queryClient.clear();
        }
    });

    it('preserves local SPA positions while retaining real Help visits, anchors and browser restoration', async () => {
        const {router, context} = createFrontendApp({session}, false);
        cleanups.push(() => { router.options.history.destroy(); context.queryClient.clear(); });
        const behavior = router.options.scrollBehavior!;
        const help = resolveDestination('/help?doc=activity_plans&locale=en#rules');
        const translated = resolveDestination('/help?doc=activity_plans&locale=de#rules');
        const otherArticle = resolveDestination('/help?doc=events&locale=de');
        const entry = resolveDestination('/users/profile/migrate/show');
        const preview = resolveDestination('/users/profile/migrate/show#migration-preview');

        // Exercise the real Router policy with resolved public URLs. A local
        // preview/translation is distinct from selecting another article or Back.
        expect(await behavior(translated, help, null)).toBe(false);
        expect(await behavior(otherArticle, translated, null)).toEqual({top: 0});
        expect(await behavior(preview, entry, null)).toBe(false);
        expect(await behavior(entry, preview, null)).toBe(false);
        expect(await behavior(entry, preview, {left: 0, top: 640})).toEqual({left: 0, top: 640});
        expect(await behavior(resolveDestination('/imprint#contact'), entry, null)).toEqual({el: '#contact'});

        // Router's scroll callback receives normalized routes: an unnamed route
        // has undefined rather than resolve()'s additional nullable-name option.
        function resolveDestination(url: string) {
            const destination = router.resolve(url);
            return {...destination, name: destination.name ?? undefined};
        }
    });

    it.each(['setup', 'mounted'] as const)('rejects actual initial Vue %s failure before enabling controls or retiring protection', async phase => {
        const url = '/users/login';
        const rendered = await render(url, {session});
        document.body.innerHTML = `<div id="surveyor-frontend">${rendered.html}</div>`;
        window.history.replaceState({}, '', url);
        const initialReloadGuard = vi.fn(() => false);
        const application = createFrontendApp(JSON.parse(rendered.state), true, initialReloadGuard);
        const previousHandler = vi.fn();
        application.app.config.errorHandler = previousHandler;
        await application.router.isReady();
        const failure = new Error('Controlled initial lifecycle failure');
        const brokenFeature = defineComponent({
            setup() {
                if (phase === 'setup') throw failure;
                onMounted(function failInitialMount(): never { throw failure; });
                return () => h('input', {name: 'retained-partial-draft', value: 'Partial owner value'});
            },
        });
        // Substitute only the delivered component, then use the production startup
        // orchestration and real Vue lifecycle/error boundary. No readiness marker
        // or application/core owner is mocked to manufacture this rejection.
        application.router.currentRoute.value.matched[0]!.components!.default = brokenFeature;
        const container = document.getElementById('surveyor-frontend')!;
        cleanups.push(() => { application.app.unmount(); application.context.start()(); });
        await expect(initializeFrontendApp(application, container)).rejects.toBe(failure);
        expect(application.context.hydrated.value).toBe(false);
        expect(application.app.config.errorHandler).toBe(previousHandler);
        expect(previousHandler).not.toHaveBeenCalled();
        expect(container.getAttribute('data-frontend-hydrated')).toBeNull();
        expect(container.querySelector<HTMLSelectElement>('#frontend-locale')!.disabled).toBe(true);
        expect(application.context.updates.requestRecoveryReload()).toBe(false);
        expect(initialReloadGuard).toHaveBeenCalled();
        if (phase === 'mounted') {
            expect(container.querySelector<HTMLInputElement>('[name="retained-partial-draft"]')!.value).toBe('Partial owner value');
        }
    }, 30_000);

    it('retains mounted input, selection and focus while showing progress until delivery commits', async () => {
        const {wrapper, router} = await mountedApp();
        const pending = deferred<Component>();
        router.addRoute({path: '/slow', component: () => pending.promise});
        const input = wrapper.get<HTMLInputElement>('main input');
        await input.setValue('Retained local edit');
        input.element.focus();
        input.element.setSelectionRange(2, 7);
        const navigation = router.push('/slow');
        await flushPromises();
        expect(wrapper.get('.frontend-navigation-loading').attributes('role')).toBe('status');
        expect(wrapper.get('.frontend-navigation-loading').classes()).not.toContain('visually-hidden');
        expect(wrapper.get('.frontend-navigation-loading').text()).toBe('Loading…');
        expect(wrapper.get('.frontend-navigation-loading .spinner-border').attributes('aria-hidden')).toBe('true');
        expect(wrapper.find('main [data-loading-skeleton]').exists()).toBe(false);
        expect(wrapper.find('header .frontend-navigation-indicator .spinner-border').exists()).toBe(true);
        expect(router.currentRoute.value.path).toBe('/');
        expect(wrapper.get('main input').element).toBe(input.element);
        expect(input.element.value).toBe('Retained local edit');
        expect(document.activeElement).toBe(input.element);
        expect([input.element.selectionStart, input.element.selectionEnd]).toEqual([2, 7]);
        pending.resolve(destination('Delivered destination'));
        await navigation;
        await flushPromises();
        expect(wrapper.find('.frontend-navigation-loading').exists()).toBe(false);
        expect(wrapper.text()).toContain('Delivered destination');
    });

    it('clears cancelled navigation without replacing the existing draft', async () => {
        const {wrapper, router} = await mountedApp();
        router.addRoute({path: '/blocked', component: destination('Blocked destination')});
        router.beforeResolve(() => false);
        const input = wrapper.get<HTMLInputElement>('main input');
        await input.setValue('Keep after cancellation');
        input.element.focus();
        const failure = await router.push('/blocked');
        await flushPromises();
        expect(isNavigationFailure(failure)).toBe(true);
        expect(wrapper.find('.frontend-navigation-loading').exists()).toBe(false);
        expect(wrapper.get('main input').element).toBe(input.element);
        expect(input.element.value).toBe('Keep after cancellation');
        expect(document.activeElement).toBe(input.element);
    });

    it('ignores an older cancelled import while a newer destination still loads', async () => {
        const {wrapper, router} = await mountedApp();
        const older = deferred<Component>();
        const newer = deferred<Component>();
        router.addRoute({path: '/older', component: () => older.promise});
        router.addRoute({path: '/newer', component: () => newer.promise});
        const oldNavigation = router.push('/older');
        await flushPromises();
        const newNavigation = router.push('/newer');
        await flushPromises();
        older.resolve(destination('Obsolete destination'));
        expect(isNavigationFailure(await oldNavigation)).toBe(true);
        await flushPromises();
        expect(wrapper.find('.frontend-navigation-loading').exists()).toBe(true);
        expect(wrapper.text()).not.toContain('Obsolete destination');
        newer.resolve(destination('Current destination'));
        await newNavigation;
        await flushPromises();
        expect(wrapper.find('.frontend-navigation-loading').exists()).toBe(false);
        expect(wrapper.text()).toContain('Current destination');
    });

    it('keeps the current view and releases progress when a retired module fails', async () => {
        const {wrapper, router} = await mountedApp();
        const pending = deferred<Component>();
        router.addRoute({path: '/retired', component: () => pending.promise});
        // An existing error owner receives the failure; delivery presentation does not
        // manufacture a second error or replace the still usable mounted resource.
        const errorOwner = vi.fn();
        router.onError(errorOwner);
        const navigation = router.push('/retired');
        const rejected = expect(navigation).rejects.toThrow('Failed to fetch dynamically imported module');
        await flushPromises();
        expect(wrapper.find('.frontend-navigation-loading').exists()).toBe(true);
        pending.reject(new Error('Failed to fetch dynamically imported module'));
        await rejected;
        await flushPromises();
        expect(errorOwner).toHaveBeenCalledOnce();
        expect(wrapper.find('.frontend-navigation-loading').exists()).toBe(false);
        expect(wrapper.get('main input').element).toBeInstanceOf(HTMLInputElement);
    });

    it('does not let an obsolete chunk error clear a newer pending destination', async () => {
        const {wrapper, router} = await mountedApp();
        const older = deferred<Component>();
        const newer = deferred<Component>();
        router.addRoute({path: '/older', component: () => older.promise});
        router.addRoute({path: '/newer', component: () => newer.promise});
        const oldNavigation = router.push('/older');
        const rejected = expect(oldNavigation).rejects.toThrow('Failed to fetch dynamically imported module');
        await flushPromises();
        const newNavigation = router.push('/newer');
        await flushPromises();
        older.reject(new Error('Failed to fetch dynamically imported module'));
        await rejected;
        await flushPromises();
        expect(wrapper.find('.frontend-navigation-loading').exists()).toBe(true);
        expect(wrapper.find('main input').exists()).toBe(true);
        newer.resolve(destination('Destination survives old delivery error'));
        await newNavigation;
        await flushPromises();
        expect(wrapper.find('.frontend-navigation-loading').exists()).toBe(false);
        expect(wrapper.text()).toContain('Destination survives old delivery error');
    });

    it('lets a redirected destination own progress until its lazy view is delivered', async () => {
        const {wrapper, router} = await mountedApp();
        const pending = deferred<Component>();
        router.addRoute({path: '/destination', component: () => pending.promise});
        router.addRoute({path: '/redirect', redirect: '/destination'});
        const navigation = router.push('/redirect');
        await flushPromises();
        expect(wrapper.find('.frontend-navigation-loading').exists()).toBe(true);
        pending.resolve(destination('Redirected destination'));
        await navigation;
        await flushPromises();
        expect(wrapper.find('.frontend-navigation-loading').exists()).toBe(false);
        expect(wrapper.text()).toContain('Redirected destination');
    });

    it('renders independent authorized SSR documents without route-delivery progress', async () => {
        const help: components['schemas']['HelpPageData'] = {locale: 'en', title: 'Synthetic guide',
            currentDoc: 'fixture.md', content: '<p>Already loaded help</p>', docsList: [], docsGroups: [], toc: []};
        const first = await render('/help?doc=fixture', {session, help});
        const second = await render('/help?doc=fixture', {session: {...session, context: 'other-request-context'}, help});
        for (const result of [first, second]) {
            expect(result.html).not.toContain('frontend-navigation-loading');
            expect(result.html).toContain('Already loaded help');
        }
    });
});
