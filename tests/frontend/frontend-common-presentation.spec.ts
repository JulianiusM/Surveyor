// @vitest-environment happy-dom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {flushPromises, mount} from '@vue/test-utils';
import {computed, createSSRApp, defineComponent, markRaw, ref} from 'vue';
import type {Component} from 'vue';
import {renderToString} from 'vue/server-renderer';
import {createMemoryHistory, createRouter} from 'vue-router';
import {VueQueryPlugin} from '@tanstack/vue-query';
import I18NextVue from 'i18next-vue';
import LandingPage from '../../src/frontend/features/common/LandingPage.vue';
import CommonPage from '../../src/frontend/features/common/CommonPage.vue';
import PageMessage from '../../src/frontend/components/PageMessage.vue';
import EntityDescription from '../../src/frontend/components/EntityDescription.vue';
import FormField from '../../src/frontend/components/FormField.vue';
import FileField from '../../src/frontend/components/FileField.vue';
import ActionButton from '../../src/frontend/components/ActionButton.vue';
import EntityAssignmentActions from '../../src/frontend/components/EntityAssignmentActions.vue';
import EntityQuickAdd from '../../src/frontend/components/EntityQuickAdd.vue';
import EntityLifecycleActions from '../../src/frontend/components/EntityLifecycleActions.vue';
import EntityDetailReadState from '../../src/frontend/components/EntityDetailReadState.vue';
import AppHeader from '../../src/frontend/components/AppHeader.vue';
import {createFrontendContext, observeInitialDocument, frontendContextKey, useActionState} from '../../src/frontend/app/context';
import {frontendRoutes} from '../../src/frontend/routes';
import {render} from '../../src/frontend/app/entry-server';
import {decodeBootstrap} from '../../src/frontend/app/serializeBootstrap';
import type {components} from '../../src/types/api/v1';
import type {FrontendCommonPage, FrontendBootstrap} from '../../src/types/FrontendTypes';
import type {FrontendContext} from '../../src/types/FrontendUiTypes';
import {apiCompatibility} from '../../.generated/api/v1/policy.mjs';

const session: components['schemas']['SessionView'] & {context: string; csrfToken: string} = {
    kind: 'anonymous', context: 'common-presentation-context-1234567890', csrfToken: 'common-presentation-csrf-1234567890',
    deployment: {buildId: 'fixture', apiCompatibility}, locale: 'en',
    activeProfile: null, profiles: [], loginUrl: '/users/login', logoutUrl: null,
    shell: {version: 'fixture', imprintUrl: 'https://example.test/imprint', privacyPolicyUrl: 'https://example.test/privacy',
        localLoginEnabled: true, oidcEnabled: false, oidcName: 'Provider'},
};
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
    bootstrap: Partial<FrontendBootstrap> = {}, path = '/',
    requestFetch: typeof fetch = rejectUnexpectedRequest) {
    const request = vi.fn(requestFetch);
    const context = createFrontendContext({session, initialUrl: path, ...bootstrap}, true, request);
    context.hydrated.value = true;
    const router = createRouter({history: createMemoryHistory(), routes: [
        {path: '/', component: routePlaceholder},
        {path: '/message', component: routePlaceholder},
        {path: '/users/dashboard', component: routePlaceholder},
        {path: '/:pathMatch(.*)*', component: routePlaceholder},
    ]});
    await router.push(path);
    await router.isReady();
    const wrapper = mount(component, {props, attachTo: document.body, global: {
        plugins: [router, [I18NextVue, {i18next: context.i18next}]],
        provide: {[frontendContextKey as symbol]: context},
    }});
    await flushPromises();
    cleanups.push(function disposeMountedPage() {wrapper.unmount(); context.queryClient.clear();});
    return {wrapper, context, router, request};
}

function rejectUnexpectedRequest(): Promise<Response> {
    return Promise.reject(new Error('A common presentation must not dispatch a feature or identity request.'));
}

/** Use actual route declarations and page components for warm admission. A held
 * Login import isolates delivery lifetime without replacing its source admission. */
async function dashboardJourney(login?: () => Promise<Component>, requestFetch: typeof fetch = rejectUnexpectedRequest) {
    const request = vi.fn(requestFetch);
    const anonymous: components['schemas']['SessionView'] = {...session, kind: 'anonymous', context: null, csrfToken: null,
        activeProfile: null, profiles: [], logoutUrl: null};
    const context: FrontendContext = createFrontendContext({session: anonymous, initialUrl: '/'}, true, request);
    context.hydrated.value = true;
    const router = createRouter({history: createMemoryHistory(), routes: frontendRoutes.map(route =>
        login && route.path === '/users/login' ? {path: route.path, meta: route.meta, component: login} : route)});
    const stopDocument = observeInitialDocument(context, router);
    await router.push('/');
    await router.isReady();
    const wrapper = mount(defineComponent({
        setup: () => ({ready: context.ready, epoch: context.epoch}),
        template: '<RouterView v-if="ready" :key="epoch" />',
    }), {attachTo: document.body, global: {
        plugins: [router, [VueQueryPlugin, {queryClient: context.queryClient}], [I18NextVue, {i18next: context.i18next}]],
        provide: {[frontendContextKey as symbol]: context},
    }});
    cleanups.push(function disposeDashboardJourney() {
        wrapper.unmount();
        stopDocument();
        context.queryClient.clear();
    });
    await flushPromises();
    return {wrapper, context, router, request};
}

function texts(root: Element, selector: string): string[] {
    return Array.from(root.querySelectorAll(selector), normalizedText);
}

/** Assert the accepted visible information and its order after native retirement. */
function expectedLandingText(signedIn = false): string[] {
    const introduction = signedIn ? [
    "Surveyor",
    "Welcome back, <Fixture profile>.",
    "See all your surveys, events, packing lists, activity plans and drivers lists in one place.",
    "Quickly create new plans and share links so others can respond or sign up.",
    "Coordinate who brings what and who drives with whom.",
    "Keep track of participants, assignments and access rights from your dashboard."
] : [
    "Surveyor",
    "Organize and coordinate group activities in one place.",
    "Plan surveys, events and activity schedules.",
    "Share a single link so people can respond or sign up.",
    "Keep packing lists and drivers lists together with your events.",
    "See everything you created on your personal dashboard.",
    "If you received an invitation link, you can also participate as a guest without creating an account."
];
    return [...introduction, ...[
    "Surveys",
    "Find suitable dates and collect responses.",
    "Define date combinations such as specific weekdays and weeks of a month.",
    "Let people answer with options like Yes, Maybe or No.",
    "See everyone’s availability in a combined view.",
    "Allow both registered users and guests to participate.",
    "Events",
    "Create events with participant registration and links to related plans.",
    "Store event details such as title, dates and location.",
    "Manage participant registration and track who is attending.",
    "Link related packing lists, activity plans and drivers lists.",
    "Optionally collect information such as dietary notes.",
    "Use invoice pools to assign costs, record payments and see balances.",
    "Packing lists",
    "Coordinate what needs to be brought for trips or events.",
    "Create items with descriptions and quantities.",
    "Track how many of each item are still needed.",
    "Assign items to people so everyone knows what they bring.",
    "Support participation via shared links, including guests.",
    "Activity plans",
    "Schedule activities with time slots and roles.",
    "Create time-based schedules organized by date and time.",
    "Define roles for activities, such as helpers or facilitators.",
    "Assign people to activity slots and see who is where.",
    "Track how many assignments participants should take.",
    "Link plans to events to reuse participant lists.",
    "Allow guests to take part using shared plan links.",
    "Drivers lists",
    "Coordinate transportation by organizing drivers and passengers.",
    "Register drivers and specify the number of seats they offer.",
    "Let participants sign up for available rides.",
    "Track who is riding with whom.",
    "Support participation via links so guests can join.",
    "Access and participation",
    "People can take part either with a registered account or as guests using links shared by organizers.",
    "Your dashboard works as your personal homepage and shows the surveys, events, packing lists, activity plans and drivers lists you have created.",
    "Permissions",
    "Surveyor uses a permission system to control who can view and edit entities and their items.",
    "Permissions can be assigned to audiences as group permissions and to individual users, while the creator of an entity always keeps full access."
]];
}

function normalizedText(element: Element): string {
    return element.textContent!.replace(/\s+/gu, ' ').trim();
}

function accountSession(kind: 'account' | 'guest'): components['schemas']['SessionView'] {
    const profile = {id: '11111111-1111-4111-8111-111111111111', name: '<Fixture profile>'};
    return {...session, kind, activeProfile: profile, profiles: kind === 'account' ? [profile] : [], logoutUrl: '/users/logout'};
}

/** Happy DOM refuses blur() on a disabled button. Focusing the body reproduces
 * Chromium's unclaimed native focus release without changing application state. */
function releaseDisabledFocus(button: HTMLButtonElement | HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): void {
    expect(button.matches(':disabled')).toBe(true);
    document.body.tabIndex = -1;
    document.body.focus();
    document.body.removeAttribute('tabindex');
    expect(document.activeElement).toBe(document.body);
}

describe('common frontend presentation', () => {
    it.each(['anonymous', 'account', 'guest'] as const)('keeps Home public and separate from personal Overview for %s visitors', async kind => {
        const selected = kind === 'anonymous' ? session : accountSession(kind);
        const home = await render('/', {session: selected, landing: {quickCreate: 'event'}});
        const root = document.createElement('div');
        root.innerHTML = home.html;

        // Exercise the actual router/SSR tree, not a replacement landing view.
        // Home must never mount private collection readers or their skeletons.
        expect(root.querySelector('main h1')?.textContent?.trim()).toBe('Surveyor');
        expect(root.querySelector('[data-loading-skeleton="overview"]')).toBeNull();
        expect(root.querySelector('.js-overview-region')).toBeNull();
        const homeLink = [...root.querySelectorAll('header a')].find(link => link.textContent?.trim() === 'Home')!;
        const overviewLink = [...root.querySelectorAll('header a')].find(link => link.textContent?.trim() === 'Your overview')!;
        expect(homeLink.getAttribute('href')).toBe('/');
        expect(overviewLink.getAttribute('href')).toBe('/users/dashboard');

        // The distinct dashboard retains progressive private reads. The prior
        // explicit Home URL remains an alias for existing bookmarks.
        if (kind !== 'anonymous') {
            const overview = await render('/users/dashboard', {session: selected, pageEntry: {kind: 'render'}});
            expect(overview.html).toContain('data-loading-skeleton="overview"');
        }
        // Anonymous Dashboard HTTP admission redirects before SSR; the real
        // Express integration covers its Login/notice/cookie journey separately.
        const alias = await render('/', {session: selected, landing: {quickCreate: 'event'}});
        root.innerHTML = alias.html;
        expect(root.querySelector('main h1')?.textContent?.trim()).toBe('Surveyor');
        expect(root.querySelector('[data-loading-skeleton="overview"]')).toBeNull();
    });

    it.each(['/users/dashboard', '/USERS/DASHBOARD/'])(
        'routes anonymous warm Dashboard entry %s to Login without a private read', async path => {
            const target = path + '?owner_main_q=equipment&locale=de#overview-owner';
            const {wrapper, context, router, request} = await dashboardJourney();
            await router.push(target);
            // The real Login route lazily imports its component; wait for that
            // delivery rather than assuming one microtask finishes compilation.
            await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/users/login'));
            await flushPromises();

            expect(router.currentRoute.value.path).toBe('/users/login');
            expect(router.currentRoute.value.query.next).toBe(target);
            expect(wrapper.find('#username').exists()).toBe(true);
            expect(wrapper.find('.js-overview-region').exists()).toBe(false);
            expect(context.pageNotice.value).toEqual({kind: 'info', messageKey: 'auth.loginRequired'});
            expect(request).not.toHaveBeenCalled();
        });

    it('retires a held anonymous Login redirect when a later Home visit commits', async () => {
        let release!: (component: Component) => void;
        const destination = new Promise<Component>(resolve => { release = resolve; });
        const {wrapper, context, router, request} = await dashboardJourney(() => destination);
        try {
            await router.push('/users/dashboard?owner_main_q=equipment');
            await flushPromises();
            expect(router.currentRoute.value.path).toBe('/users/dashboard');
            expect(context.pageNotice.value).toBeNull();
            await router.push('/');
            release(routePlaceholder);
            await flushPromises();

            expect(router.currentRoute.value.fullPath).toBe('/');
            expect(wrapper.find('h1').text()).toBe('Surveyor');
            expect(context.pageNotice.value).toBeNull();
            expect(request).not.toHaveBeenCalled();
        } finally { release(routePlaceholder); await flushPromises(); }
    });

    it('retires a held anonymous Login redirect when authoritative identity admission changes', async () => {
        let release!: (component: Component) => void;
        const destination = new Promise<Component>(resolve => { release = resolve; });
        const account = accountSession('account');
        const {context, router} = await dashboardJourney(() => destination, admitAccount);
        try {
            await router.push('/users/dashboard');
            await flushPromises();
            expect(router.currentRoute.value.path).toBe('/users/dashboard');
            await context.acceptIdentity({session: account, personalLink: null, redirect: null});
            await flushPromises();
            release(routePlaceholder);
            await flushPromises();

            expect(router.currentRoute.value.path).toBe('/users/dashboard');
            expect(context.pageNotice.value).toBeNull();
        } finally { release(routePlaceholder); await flushPromises(); }

        async function admitAccount(input: RequestInfo | URL): Promise<Response> {
            if (new URL((input as Request).url).pathname !== '/api/v1/session') return rejectUnexpectedRequest();
            return new Response(JSON.stringify(account), {headers: {'Content-Type': 'application/json'}});
        }
    });

    it('leaves a deliberate Login visit available after an older admission redirect loses its actor', async () => {
        let release!: (component: Component) => void;
        const destination = new Promise<Component>(resolve => { release = resolve; });
        const account = accountSession('account');
        const {context, router} = await dashboardJourney(() => destination, admitAccount);
        try {
            await router.push('/users/dashboard');
            await flushPromises();
            await context.acceptIdentity({session: account, personalLink: null, redirect: null});
            const deliberate = router.push('/users/login?next=/users/dashboard');
            await flushPromises();
            release(routePlaceholder);
            await deliberate;
            await flushPromises();

            expect(router.currentRoute.value.path).toBe('/users/login');
            expect(context.pageNotice.value).toBeNull();
        } finally { release(routePlaceholder); await flushPromises(); }

        async function admitAccount(input: RequestInfo | URL): Promise<Response> {
            if (new URL((input as Request).url).pathname !== '/api/v1/session') return rejectUnexpectedRequest();
            return new Response(JSON.stringify(account), {headers: {'Content-Type': 'application/json'}});
        }
    });

    it('waits for identity admission without redirecting or reading private collections when no session is present', async () => {
        const {context, router, request, wrapper} = await dashboardJourney();
        context.session.value = null;
        await router.push('/users/dashboard');
        await flushPromises();

        expect(router.currentRoute.value.path).toBe('/users/dashboard');
        expect(wrapper.find('.js-overview-region').exists()).toBe(false);
        expect(context.pageNotice.value).toBeNull();
        expect(request).not.toHaveBeenCalled();
    });

    it.each([false, true])('retains locale selector focus after its actual preference command unless the user moves elsewhere (%s)', async cancelled => {
        let finish!: (response: Response) => void;
        const held = new Promise<Response>(function holdLocaleResponse(resolve) { finish = resolve; });
        const {wrapper, context, request} = await mounted(AppHeader, {}, {}, '/',
            function changePreference() { return held; });
        const select = wrapper.get<HTMLSelectElement>('#frontend-locale');
        select.element.focus();
        const focus = vi.spyOn(select.element, 'focus');

        try {
            await select.setValue('de');
            releaseDisabledFocus(select.element);
            const dispatched = request.mock.calls[0]![0] as Request;
            expect(dispatched.method).toBe('PUT');
            expect(new URL(dispatched.url).pathname).toBe('/api/v1/locale');
            expect(await dispatched.json()).toEqual({locale: 'de'});
            if (cancelled) document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Tab', bubbles: true}));
            finish(new Response(JSON.stringify({...session, locale: 'de'}), {headers: {
                'Content-Type': 'application/json', 'X-Surveyor-Context': session.context,
            }}));
            await flushPromises();
            expect(wrapper.get<HTMLSelectElement>('#frontend-locale').element).toBe(select.element);
            expect(select.element.disabled).toBe(false);
            expect(select.element.value).toBe('de');
            expect(context.locale.value).toBe('de');
            expect(request).toHaveBeenCalledOnce();
            if (cancelled) {
                expect(document.activeElement).toBe(document.body);
                expect(focus).not.toHaveBeenCalled();
            } else {
                expect(document.activeElement).toBe(select.element);
                expect(focus).toHaveBeenCalledExactlyOnceWith({preventScroll: true});
            }
        } finally { finish(new Response()); await flushPromises(); }
    });

    it('keeps native availability and pending focus restoration for a standalone action without application context', async () => {
        const wrapper = mount(ActionButton, {attachTo: document.body, slots: {default: 'Standalone action'}});
        cleanups.push(() => wrapper.unmount());
        const button = wrapper.get<HTMLButtonElement>('button').element;
        expect(button.disabled).toBe(false);
        button.focus();
        await wrapper.setProps({pending: true});
        expect(button.disabled).toBe(true);
        releaseDisabledFocus(button);
        await wrapper.setProps({pending: false});
        await flushPromises();
        expect(document.activeElement).toBe(button);
        expect(button.disabled).toBe(false);
    });

    it.each([
        {name: 'assignment', component: EntityAssignmentActions, props: {assigned: false, full: false, disabled: false,
            assignLabel: 'Join', removeLabel: 'Leave', fullLabel: 'Full'}, pending: {pending: true}, settled: {pending: false}},
        {name: 'quick add', component: EntityQuickAdd, props: {description: 'Keep this draft', capacity: null, disabled: false},
            pending: {pending: true}, settled: {pending: false}},
        {name: 'permanent deletion', component: EntityLifecycleActions, props: {labels: {activeHint: 'Active', archivedHint: 'Archived',
            inheritedHint: 'Inherited', openEvent: 'Open Event', otherActions: 'Actions', deletePermanently: 'Delete permanently'},
            direct: false, inherited: false, eventUrl: null, manageArchive: false, canArchive: false, canRestore: false,
            canDuplicate: false, canRemove: true, duplicateTo: '/', disabled: false},
            pending: {pendingAction: 'remove'}, settled: {pendingAction: null}},
    ])('shows progress at the initiating $name control without another request', async example => {
        const {wrapper, request} = await mounted(example.component, example.props);
        const button = wrapper.get<HTMLButtonElement>('button').element;
        expect(wrapper.find('.spinner-border').exists()).toBe(false);

        // The feature supplies the same pending state that already prevents a
        // repeated action. Its real shared button must also make progress visible.
        await wrapper.setProps(example.pending);
        expect(wrapper.get('button').element).toBe(button);
        expect(button.disabled).toBe(true);
        expect(button.getAttribute('aria-busy')).toBe('true');
        expect(wrapper.get('button .spinner-border').attributes('aria-hidden')).toBe('true');

        await wrapper.setProps(example.settled);
        expect(wrapper.find('.spinner-border').exists()).toBe(false);
        expect(button.disabled).toBe(false);
        expect(request).not.toHaveBeenCalled();
    });

    it('shows localized retained-data read progress without a replacement skeleton', async () => {
        const {wrapper, context, request} = await mounted(EntityDetailReadState,
            {denied: false, error: null, hasData: true, pending: false, refreshing: true});
        const statusRow = wrapper.get('[role="status"]').element.parentElement;
        expect(wrapper.get('[role="status"]').text()).toBe('Loading…');
        expect(wrapper.find('.frontend-skeleton').exists()).toBe(false);
        context.locale.value = 'de';
        await flushPromises();
        expect(wrapper.get('[role="status"]').text()).toBe('Wird geladen…');

        // A routine read finishing releases its message while preserving the
        // reserved row, so repeated background reads cannot shift the detail body.
        await wrapper.setProps({refreshing: false});
        expect(wrapper.find('[role="status"]').exists()).toBe(false);
        expect(statusRow?.isConnected).toBe(true);
        expect(request).not.toHaveBeenCalled();
    });

    it.each([
        {showSpinner: true, unstyled: false},
        {showSpinner: false, unstyled: false},
        {showSpinner: false, unstyled: true},
    ])('restores pending-disabled focus with spinner $showSpinner and caller-owned appearance $unstyled', async presentation => {
        const {wrapper, request} = await mounted(ActionButton, {...presentation, class: 'list-group-item'});
        const button = wrapper.get<HTMLButtonElement>('button').element;
        button.focus();
        const focus = vi.spyOn(button, 'focus');
        await wrapper.setProps({pending: true});
        expect(button.disabled).toBe(true);
        expect(button.getAttribute('aria-busy')).toBe('true');
        expect(wrapper.find('.spinner-border').exists()).toBe(presentation.showSpinner);
        expect(wrapper.classes()).toContain('list-group-item');
        expect(wrapper.classes().includes('btn')).toBe(!presentation.unstyled);
        expect(wrapper.classes().includes('btn-primary')).toBe(!presentation.unstyled);

        // Explicitly reproduce Chromium's native blur to exercise the production
        // restoration rather than assume the DOM emulator supplied that behavior.
        releaseDisabledFocus(button);
        expect(document.activeElement).toBe(document.body);
        await wrapper.setProps({pending: false});
        await flushPromises();
        expect(button.disabled).toBe(false);
        expect(document.activeElement).toBe(button);
        expect(focus).toHaveBeenCalledExactlyOnceWith({preventScroll: true});
        expect(request).not.toHaveBeenCalled();
    });

    it('does not claim focus when another operation only blocks this button', async () => {
        const {wrapper, request} = await mounted(ActionButton, {showSpinner: false});
        const button = wrapper.get<HTMLButtonElement>('button').element;
        button.focus();
        const focus = vi.spyOn(button, 'focus');

        // A sibling command may disable the form without making this focused
        // control the initiating operation. Releasing that block owns no focus.
        await wrapper.setProps({disabled: true});
        releaseDisabledFocus(button);
        expect(button.getAttribute('aria-busy')).toBe('false');
        await wrapper.setProps({disabled: false});
        await flushPromises();
        expect(document.activeElement).toBe(document.body);
        expect(focus).not.toHaveBeenCalled();
        expect(request).not.toHaveBeenCalled();
    });

    it('keeps focus with an action whose owning state starts and settles before its next render', async () => {
        const pending = ref(false);
        const host = defineComponent({components: {ActionButton},
            setup() { return {state: useActionState({pending: () => pending.value})}; },
            template: '<ActionButton :state="state">Immediate action</ActionButton>',
        });
        const {wrapper, request} = await mounted(host);
        const button = wrapper.get<HTMLButtonElement>('button').element;
        button.focus();
        const focus = vi.spyOn(button, 'focus');

        // No disabled DOM state is painted for a same-turn completion. That
        // unbroken focus needs no later restoration or background focus claim.
        pending.value = true;
        pending.value = false;
        await flushPromises();
        expect(button.disabled).toBe(false);
        expect(button.getAttribute('aria-busy')).toBe('false');
        expect(document.activeElement).toBe(button);
        expect(focus).not.toHaveBeenCalled();
        expect(request).not.toHaveBeenCalled();
    });

    it.each(['pointer', 'keyboard', 'other-focus', 'window-blur'] as const)(
        'releases pending-button focus after deliberate %s interaction even when focus later returns to body', async interaction => {
            const {wrapper} = await mounted(ActionButton);
            const button = wrapper.get<HTMLButtonElement>('button').element;
            const other = document.createElement('button');
            document.body.append(other);
            button.focus();
            const focus = vi.spyOn(button, 'focus');
            await wrapper.setProps({pending: true});
            releaseDisabledFocus(button);

            // Leaving body after a real user action must not be confused with
            // the browser's unclaimed focus loss when a control becomes disabled.
            if (interaction === 'pointer') other.dispatchEvent(new Event('pointerdown', {bubbles: true}));
            else if (interaction === 'keyboard') document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Tab', bubbles: true}));
            else if (interaction === 'other-focus') { other.focus(); other.blur(); }
            else window.dispatchEvent(new Event('blur'));
            expect(document.activeElement).toBe(document.body);
            await wrapper.setProps({pending: false});
            await flushPromises();
            expect(document.activeElement).toBe(document.body);
            expect(focus).not.toHaveBeenCalled();
        },
    );

    it.each(['unavailable', 'ineligible', 'initializing', 'identity', 'unmounted', 'unfocused'] as const)(
        'never restores a pending button that becomes %s', async state => {
            const {wrapper, context} = await mounted(ActionButton);
            const button = wrapper.get<HTMLButtonElement>('button').element;
            if (state !== 'unfocused') button.focus();
            const focus = vi.spyOn(button, 'focus');
            await wrapper.setProps({pending: true});
            releaseDisabledFocus(button);

            // Capability loss, initialization and disposal retain their actual
            // action admission. A never-focused command owns no restoration at all.
            if (state === 'unavailable') await wrapper.setProps({disabled: true});
            else if (state === 'ineligible') await wrapper.setProps({state: markRaw({available: computed(() => false),
                disabled: computed(() => true), pending: computed(() => false), isAvailable: () => false})});
            else if (state === 'initializing') context.hydrated.value = false;
            else if (state === 'identity') context.epoch.value++;
            if (state === 'unmounted') wrapper.unmount();
            else await wrapper.setProps({pending: false});
            await flushPromises();
            expect(document.activeElement).toBe(document.body);
            expect(focus).not.toHaveBeenCalled();
        },
    );

    it('leaves another focused control with its owner when pending completes', async () => {
        const {wrapper} = await mounted(ActionButton);
        const button = wrapper.get<HTMLButtonElement>('button').element;
        const other = document.createElement('input');
        document.body.append(other);
        button.focus();
        const focus = vi.spyOn(button, 'focus');
        await wrapper.setProps({pending: true});
        releaseDisabledFocus(button);
        other.focus();
        await wrapper.setProps({pending: false});
        await flushPromises();
        expect(document.activeElement).toBe(other);
        expect(focus).not.toHaveBeenCalled();
    });

    it.each([
        {multiline: false},
        {multiline: true},
        {type: 'number', lexicalNumber: true},
    ])('restores the same retained form control after its initiating pending submission (%j)', async presentation => {
        const {wrapper, request} = await mounted(FormField,
            {id: 'retained-input', label: 'Retained field', modelValue: '12', ...presentation});
        const control = wrapper.get<HTMLInputElement | HTMLTextAreaElement>('input, textarea').element;
        control.focus();
        const focus = vi.spyOn(control, 'focus');

        // The existing form owner supplies its actual pending and native disable
        // policy. A rejected result retains this very field and its model value.
        await wrapper.setProps({pending: true, disabled: true});
        releaseDisabledFocus(control);
        await wrapper.setProps({pending: false, disabled: false});
        await flushPromises();
        expect(wrapper.get('input, textarea').element).toBe(control);
        expect(control.value).toBe('12');
        expect(document.activeElement).toBe(control);
        expect(focus).toHaveBeenCalledExactlyOnceWith({preventScroll: true});
        expect(wrapper.emitted('update:modelValue')).toBeUndefined();
        expect(request).not.toHaveBeenCalled();
    });

    it('does not claim a form field disabled only by another operation', async () => {
        const {wrapper} = await mounted(FormField, {id: 'sibling-input', label: 'Sibling field', modelValue: 'Retained'});
        const control = wrapper.get<HTMLInputElement>('input').element;
        control.focus();
        const focus = vi.spyOn(control, 'focus');
        await wrapper.setProps({disabled: true});
        releaseDisabledFocus(control);
        await wrapper.setProps({disabled: false});
        await flushPromises();
        expect(document.activeElement).toBe(document.body);
        expect(focus).not.toHaveBeenCalled();
    });

    it('honors effective fieldset disabling without a second field availability owner', async () => {
        const pending = ref(false);
        const blocked = ref(false);
        const host = defineComponent({components: {FormField},
            setup() { return {pending, blocked}; },
            template: '<fieldset :disabled="blocked"><FormField id="fieldset-input" label="Fieldset field" '
                + 'model-value="Retained" :pending="pending" /></fieldset>',
        });
        const {wrapper} = await mounted(host);
        const control = wrapper.get<HTMLInputElement>('input').element;
        const fieldset = wrapper.get<HTMLFieldSetElement>('fieldset').element;
        const nativeMatches = control.matches.bind(control);
        // Happy DOM omits inherited fieldset disabling from :disabled. Model
        // that browser selector boundary only; the real ancestor and pending
        // render/settlement still belong to the mounted production components.
        vi.spyOn(control, 'matches').mockImplementation(function matchesEffectiveDisabled(selector: string): boolean {
            return selector === ':disabled' ? control.disabled || fieldset.disabled : nativeMatches(selector);
        });
        control.focus();
        const focus = vi.spyOn(control, 'focus');
        pending.value = true;
        blocked.value = true;
        await flushPromises();
        expect(control.disabled).toBe(false);
        expect(fieldset.disabled).toBe(true);
        releaseDisabledFocus(control);

        // Pending settlement cannot restore into a still-disabled ancestor. Later
        // release of that unrelated lock also owns no new focus restoration.
        pending.value = false;
        await flushPromises();
        expect(control.matches(':disabled')).toBe(true);
        expect(document.activeElement).toBe(document.body);
        blocked.value = false;
        await flushPromises();
        expect(control.matches(':disabled')).toBe(false);
        expect(document.activeElement).toBe(document.body);
        expect(focus).not.toHaveBeenCalled();
    });

    it('shares pending focus with an explicitly bound native control slot without replacing its model', async () => {
        const pending = ref(false);
        const disabled = ref(false);
        const value = ref('2026-10-23');
        const host = defineComponent({components: {FormField},
            setup() { return {pending, disabled, value}; },
            template: '<FormField id="custom-date" label="Arrival" :pending="pending" :disabled="disabled">'
                + '<template #control="{controlRef}"><input :ref="controlRef" id="custom-date" type="date" '
                + 'v-model="value" :disabled="disabled" data-existing-directive="retained" /></template>'
                + '<p>Existing field guidance</p></FormField>',
        });
        const {wrapper, request} = await mounted(host);
        const control = wrapper.get<HTMLInputElement>('input').element;
        control.focus();
        const focus = vi.spyOn(control, 'focus');
        pending.value = true;
        disabled.value = true;
        await flushPromises();
        releaseDisabledFocus(control);
        pending.value = false;
        disabled.value = false;
        await flushPromises();
        expect(wrapper.get<HTMLInputElement>('input').element).toBe(control);
        expect(control.getAttribute('data-existing-directive')).toBe('retained');
        expect(value.value).toBe('2026-10-23');
        expect(control.value).toBe(value.value);
        expect(wrapper.text()).toContain('Existing field guidance');
        expect(document.activeElement).toBe(control);
        expect(focus).toHaveBeenCalledExactlyOnceWith({preventScroll: true});
        expect(request).not.toHaveBeenCalled();
    });

    it('never discovers or claims an unbound custom control slot', async () => {
        const pending = ref(false);
        const host = defineComponent({components: {FormField},
            setup() { return {pending}; },
            template: '<FormField id="unbound-control" label="Distinct control" :pending="pending">'
                + '<template #control><input id="unbound-control" :disabled="pending" /></template></FormField>',
        });
        const {wrapper} = await mounted(host);
        const control = wrapper.get<HTMLInputElement>('input').element;
        control.focus();
        const focus = vi.spyOn(control, 'focus');
        pending.value = true;
        await flushPromises();
        releaseDisabledFocus(control);
        pending.value = false;
        await flushPromises();
        expect(control.disabled).toBe(false);
        expect(document.activeElement).toBe(document.body);
        expect(focus).not.toHaveBeenCalled();
    });

    it('releases the actual custom control ref when its slot replaces the pending field', async () => {
        const pending = ref(false);
        const generation = ref(0);
        const host = defineComponent({components: {FormField},
            setup() { return {pending, generation}; },
            template: '<FormField id="replacement-control" label="Replaced control" :pending="pending">'
                + '<template #control="{controlRef}"><input :ref="controlRef" :key="generation" '
                + 'id="replacement-control" :disabled="pending" /></template></FormField>',
        });
        const {wrapper} = await mounted(host);
        const control = wrapper.get<HTMLInputElement>('input').element;
        control.focus();
        const focus = vi.spyOn(control, 'focus');
        pending.value = true;
        await flushPromises();
        releaseDisabledFocus(control);
        generation.value++;
        await flushPromises();
        const replacement = wrapper.get<HTMLInputElement>('input').element;
        expect(replacement).not.toBe(control);
        expect(control.isConnected).toBe(false);
        pending.value = false;
        await flushPromises();
        expect(replacement.disabled).toBe(false);
        expect(document.activeElement).toBe(document.body);
        expect(focus).not.toHaveBeenCalled();
    });

    it.each(['other-focus', 'identity', 'initializing', 'unmounted'] as const)(
        'does not restore a form field after %s retires its pending focus', async retirement => {
            const {wrapper, context} = await mounted(FormField, {id: 'retired-input', label: 'Retired field'});
            const control = wrapper.get<HTMLInputElement>('input').element;
            const other = document.createElement('button');
            document.body.append(other);
            control.focus();
            const focus = vi.spyOn(control, 'focus');
            await wrapper.setProps({pending: true, disabled: true});
            releaseDisabledFocus(control);
            if (retirement === 'other-focus') { other.focus(); other.blur(); }
            else if (retirement === 'identity') context.epoch.value++;
            else if (retirement === 'initializing') context.hydrated.value = false;
            if (retirement === 'unmounted') wrapper.unmount();
            else await wrapper.setProps({pending: false, disabled: false});
            await flushPromises();
            expect(document.activeElement).toBe(document.body);
            expect(focus).not.toHaveBeenCalled();
        },
    );

    it('preserves escaped description lines and releases its separator with absent content', async () => {
        const {wrapper, request} = await mounted(EntityDescription, {
            description: 'First <img src=x onerror=alert(1)>\n\nLast & final line', separator: true,
        });
        expect(wrapper.get('#planDesc').text()).toBe('First <img src=x onerror=alert(1)>Last & final line');
        expect(wrapper.find('img').exists()).toBe(false);
        expect(wrapper.findAll('#planDesc br')).toHaveLength(2);
        expect(wrapper.get('#planDesc').classes()).toEqual(['mb-0', 'mt-2']);
        expect(wrapper.get('hr').classes()).toEqual(['mb-1', 'mt-0']);

        await wrapper.setProps({description: 'Single line', separator: false});
        expect(wrapper.get('#planDesc').text()).toBe('Single line');
        expect(wrapper.find('br').exists()).toBe(false);
        expect(wrapper.find('hr').exists()).toBe(false);
        await wrapper.setProps({description: null});
        expect(wrapper.find('#planDesc').exists()).toBe(false);
        expect(request).not.toHaveBeenCalled();
    });

    it('keeps text and multiline field values lexical with explicit native naming and constraints', async () => {
        const title = await mounted(FormField, {id: 'shared-title', name: null, modelValue: 'Original title',
            label: 'Title', labelIcon: 'bi-tag', labelClass: '', required: true, requiredMarker: false, maxLength: 255});
        expect(title.wrapper.get('label').attributes('for')).toBe('shared-title');
        expect(title.wrapper.get('label').text()).toBe('Title');
        expect(title.wrapper.get('input').attributes('name')).toBeUndefined();
        expect(title.wrapper.get('input').attributes('maxlength')).toBe('255');
        await title.wrapper.get('input').setValue('  New title  ');
        expect(title.wrapper.emitted('update:modelValue')).toEqual([['  New title  ']]);

        const description = await mounted(FormField, {id: 'shared-description', name: 'description', multiline: true,
            modelValue: 'First line\nSecond line', label: 'Description', labelClass: '', rows: 4, maxLength: 16000});
        const control = description.wrapper.get<HTMLTextAreaElement>('textarea');
        expect(control.element.value).toBe('First line\nSecond line');
        expect(control.attributes()).toMatchObject({name: 'description', rows: '4', maxlength: '16000'});
        await control.setValue('  Retained draft\nWith spacing  ');
        expect(description.wrapper.emitted('update:modelValue')).toEqual([['  Retained draft\nWith spacing  ']]);
    });

    it('retains lexical number spelling through change, blur and a refreshed disabled state', async () => {
        const {wrapper} = await mounted(FormField, {id: 'shared-amount', name: null, modelValue: '',
            label: 'Amount', type: 'number', lexicalNumber: true, min: '0.01', step: '0.01', inputMode: 'decimal',
            controlData: {'data-hydration-draft': true}, ariaLabel: 'Invoice amount'});
        const field = wrapper.get<HTMLInputElement>('input');
        field.element.value = '013.50';
        await field.trigger('input');
        await field.trigger('change');
        await field.trigger('blur');

        expect(wrapper.emitted('update:modelValue')).toEqual([['013.50']]);
        expect(field.element.value).toBe('013.50');
        expect(field.attributes()).toMatchObject({min: '0.01', step: '0.01', inputmode: 'decimal',
            'aria-label': 'Invoice amount', 'data-hydration-draft': 'true'});
        expect(field.attributes('name')).toBeUndefined();
        await wrapper.setProps({modelValue: '013.50', disabled: true});
        expect(wrapper.get('input').element).toBe(field.element);
        expect(field.element.value).toBe('013.50');
    });

    it('preserves the existing native directive for numeric consumers that do not request lexical spelling', async () => {
        const {wrapper} = await mounted(FormField, {id: 'normalized-count', modelValue: '', label: 'Count', type: 'number'});
        const field = wrapper.get<HTMLInputElement>('input');
        field.element.value = '005';
        await field.trigger('input');
        await field.trigger('change');

        expect(field.element.value).toBe('5');
    });

    it('keeps a shared image chooser mounted until its feature explicitly releases selected bytes', async () => {
        const {wrapper} = await mounted(FileField, {id: 'shared-header', selectedFile: null, label: 'Header image',
            hydrationDraft: true, dark: false});
        const chooser = wrapper.get<HTMLInputElement>('input').element;
        const transfer = new DataTransfer();
        const file = new File(['header'], 'selected.png', {type: 'image/png'});
        transfer.items.add(file);
        chooser.files = transfer.files;
        chooser.dispatchEvent(new Event('change', {bubbles: true}));
        expect(wrapper.emitted('choose')).toEqual([[file]]);
        expect(chooser.hasAttribute('name')).toBe(false);
        expect(chooser.hasAttribute('data-hydration-draft')).toBe(true);
        expect(chooser.classList.contains('text-bg-dark')).toBe(false);

        // Background presentation and pending/unknown delivery may disable the
        // control, but cannot discard bytes retained by the owning feature.
        await wrapper.setProps({selectedFile: file, disabled: true});
        expect(wrapper.get('input').element).toBe(chooser);
        expect(chooser.files?.[0]).toBe(file);
        await wrapper.setProps({selectedFile: null});
        expect(wrapper.get('input').element).toBe(chooser);
        expect(chooser.files).toHaveLength(0);
    });

    it('retains anonymous landing copy, card order and responsive groups from the native template', async () => {
        const {wrapper, context, request} = await mounted(LandingPage);
        expect(texts(wrapper.element, 'h1, h2, p, li')).toEqual(expectedLandingText());
        expect(texts(wrapper.element, '.row > .col h2')).toEqual(['Surveys', 'Events', 'Packing lists', 'Activity plans', 'Drivers lists']);
        expect(wrapper.findAll('.row')[0]!.classes()).toEqual(['row', 'row-cols-1', 'row-cols-md-2', 'row-cols-xl-3', 'g-4', 'mb-4']);
        expect(wrapper.findAll('.row')[1]!.classes()).toEqual(['row', 'row-cols-1', 'row-cols-md-2', 'g-4', 'mb-4']);
        expect(context.pageTitle.value).toBe('Surveyor – Organize and coordinate group activities');
        expect(request).not.toHaveBeenCalled();
    });

    it.each(['account', 'guest'] as const)('retains the %s welcome and admitted quick-create target without treating the profile name as HTML', async kind => {
        vi.spyOn(Math, 'random').mockReturnValue(0);
        const current = accountSession(kind);
        const {wrapper, request} = await mounted(LandingPage, {}, {session: current, landing: {quickCreate: 'survey'}});
        expect(texts(wrapper.element, 'h1, h2, p, li')).toEqual(expectedLandingText(true));
        expect(wrapper.get('a.btn-outline-light').attributes('href')).toBe('/survey/create');
        expect(wrapper.get('a.btn-primary').attributes('href')).toBe('/users/dashboard');
        expect(wrapper.find('fixture').exists()).toBe(false);
        expect(request).not.toHaveBeenCalled();
    });

    it('preserves the complete landing return path and chooses native or migrated creation navigation explicitly', async () => {
        const path = '/?locale=en#about';
        const anonymous = await mounted(LandingPage, {}, {}, path);
        for (const link of anonymous.wrapper.findAll('a.btn')) {
            expect(new URL(link.attributes('href')!, 'https://example.test').searchParams.get('next')).toBe(path);
        }
        const signed = await mounted(LandingPage, {}, {session: accountSession('account'), landing: {quickCreate: 'packing'}});
        expect(signed.wrapper.get('a.btn-outline-light').attributes('href')).toBe('/packing/create');
    });

    it('keeps a warm visit suggestion stable while translating labels in place', async () => {
        const random = vi.spyOn(Math, 'random').mockReturnValue(0.99);
        const {wrapper, context} = await mounted(LandingPage, {}, {session: accountSession('guest'), initialUrl: '/help'});
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
        const bootstrap: FrontendBootstrap = {session: accountSession('account'), initialUrl: '/',
            landing: {quickCreate: 'packing'}};
        const context = createFrontendContext(bootstrap, false);
        const router = createRouter({history: createMemoryHistory(), routes: [{path: '/', component: LandingPage}]});
        await router.push(bootstrap.initialUrl!);
        await router.isReady();
        const application = createSSRApp(LandingPage);
        application.provide(frontendContextKey, context);
        application.use(router);
        application.use(I18NextVue, {i18next: context.i18next});
        const random = vi.spyOn(Math, 'random').mockReturnValue(0);
        try {
            const html = await renderToString(application);
            const root = document.createElement('div');
            root.innerHTML = html;
            expect(root.querySelector('a.btn-outline-light')!.getAttribute('href')).toBe('/packing/create');
            expect(random).not.toHaveBeenCalled();
        } finally {context.queryClient.clear();}
    });

    it('adopts landing and static error outcomes through the actual application renderer and bootstrap decoder', async () => {
        const landing = await render('/', {session: accountSession('account'), landing: {quickCreate: 'drivers'}});
        expect(landing.title).toBe('Surveyor – Organize and coordinate group activities');
        expect(landing.javascriptRequired).toBe(false);
        expect(landing.html).toContain('href="/drivers/create"');
        expect((await decodeBootstrap(JSON.parse(landing.state))).landing).toEqual({quickCreate: 'drivers'});
        await expect(decodeBootstrap({...JSON.parse(landing.state), landing: {quickCreate: ['packing']}}))
            .rejects.toThrow('Invalid frontend bootstrap field: landing');

        const page: FrontendCommonPage = {kind: 'error', status: 404, message: 'Safe missing destination', messageKey: 'api:errors.NOT_FOUND'};
        const error = await render('/missing', {session, commonPage: page});
        expect(error.javascriptRequired).toBe(false);
        expect(error.html).toContain('(Status 404)');
        expect((await decodeBootstrap(JSON.parse(error.state))).commonPage).toEqual(page);
        await expect(decodeBootstrap({...JSON.parse(error.state), commonPage: {...page, messageKey: 'landing.welcome'}}))
            .rejects.toThrow('Invalid frontend bootstrap field: commonPage');
        await expect(decodeBootstrap({...JSON.parse(error.state), commonPage: {kind: 'message', severity: ['success'], message: 'Admitted text'}}))
            .rejects.toThrow('Invalid frontend bootstrap field: commonPage');
    });

    it.each(['info', 'success', 'warning', 'error'] as const)('retains native %s message headings/body policy and returns Home to the landing page', async severity => {
        const message = 'A confirmed <safe> outcome';
        const {wrapper, context, request} = await mounted(CommonPage,
            {page: {kind: 'message', severity, message}}, {}, '/message');
        expect(texts(wrapper.element, 'h1')).toEqual([severity[0]!.toUpperCase() + severity.slice(1)]);
        expect(texts(wrapper.element, '.alert')).toEqual(severity === 'warning' ? [] : [message]);
        expect(wrapper.get('a.btn-primary').attributes('href')).toBe('/');
        expect(context.pageTitle.value).toBe(severity[0]!.toUpperCase() + severity.slice(1) + ' | ControlPanel');
        expect(wrapper.find('safe').exists()).toBe(false);
        expect(request).not.toHaveBeenCalled();
    });

    it('preserves the existing default Home destination for prior PageMessage consumers', async () => {
        const {wrapper} = await mounted(PageMessage, {kind: 'info', message: 'Existing feature outcome'});
        expect(wrapper.get('a.btn-primary').attributes('href')).toBe('/');
    });

    it('retains native escaped error, status and admitted stack presentation', async () => {
        const page: FrontendCommonPage = {kind: 'error', status: 503, message: '<img src=x onerror=alert(1)>',
            stack: 'Error: <private development trace>\n    at fixture'};
        const {wrapper, context} = await mounted(CommonPage, {page}, {}, '/unavailable');
        expect(texts(wrapper.element, 'h1, strong, summary, code')).toEqual([
            'Oops! Something went wrong', page.message, 'View stack trace', page.stack!.replace(/\s+/gu, ' ')]);
        expect(normalizedText(wrapper.get('.status-notice').element)).toBe(page.message + ' (Status 503)');
        expect(wrapper.find('img').exists()).toBe(false);
        expect(context.pageTitle.value).toBe('Error | Surveyor');
    });

    it('never manufactures a completion or development diagnostics from route query data', async () => {
        const {wrapper} = await mounted(CommonPage, {}, {}, '/message?message=Forged&status=200&stack=Private');
        expect(wrapper.find('details').exists()).toBe(false);
        expect(wrapper.text()).not.toContain('Forged');
        expect(wrapper.text()).not.toContain('Private');
        expect(wrapper.text()).toContain('(Status 404)');
    });

    it('retranslates an admitted initial error key and status without replacing its escaped literal fallback or stack', async () => {
        const path = '/missing';
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
        const destination = '/message?receipt=fixture';
        const {wrapper, context} = await mounted(CommonPage, {}, {initialUrl: '/help'}, destination);
        context.pageCompletion.value = {context: session.context, destination, kind: 'success', messageKey: 'auth.resetDone'};
        await flushPromises();
        expect(wrapper.get('h1').text()).toBe('Success');
        context.pageCompletion.value = {...context.pageCompletion.value!, context: 'retired-actor-context'};
        await flushPromises();
        expect(wrapper.text()).toContain('(Status 404)');
        context.pageCompletion.value = {context: session.context, destination: '/other', kind: 'success', messageKey: 'auth.resetDone'};
        await flushPromises();
        expect(wrapper.text()).toContain('(Status 404)');
    });

    it('does not revive an expired confirmed message when its language changes', async () => {
        vi.useFakeTimers();
        // Happy DOM has no layout; make the actual mounted notice visible to its
        // existing expiry owner rather than bypassing that owner's timer policy.
        vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
        const destination = '/message';
        const {wrapper, context} = await mounted(CommonPage, {}, {initialUrl: '/help'}, destination);
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
