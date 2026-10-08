// @vitest-environment happy-dom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {flushPromises, mount} from '@vue/test-utils';
import {defineComponent} from 'vue';
import {createMemoryHistory, createRouter} from 'vue-router';
import {VueQueryPlugin} from '@tanstack/vue-query';
import I18NextVue from 'i18next-vue';
import {createPilotContext, observeInitialDocument, pilotContextKey} from '../../src/frontend/app/context';
import IdentityPage from '../../src/frontend/features/identity/IdentityPage.vue';
import PackingGuestPage from '../../src/frontend/features/identity/PackingGuestPage.vue';
import PackingHome from '../../src/frontend/features/overview/OverviewPage.vue';
import AppHeader from '../../src/frontend/components/AppHeader.vue';
import App from '../../src/frontend/app/App.vue';
import {problemMessage} from '../../src/frontend/composables/feedback';
import type {components} from '../../src/types/api/v1';
import type {FrontendPilotBootstrap} from '../../src/types/FrontendPilotTypes';
import {render} from '../../src/frontend/app/entry-server';

const profileId = '11111111-1111-4111-8111-111111111111';
const eventId = '22222222-2222-4222-8222-222222222222';
const session: components['schemas']['SessionView'] = {
    kind: 'account', deployment: {buildId: 'fixture', apiCompatibility: 'v1-pilot-2026-10-07'}, context: 'identity-ui-context-1234567890', csrfToken: 'identity-ui-csrf-1234567890', locale: 'en',
    activeProfile: {id: profileId, name: 'Organizer'}, profiles: [{id: profileId, name: 'Organizer'}],
    loginUrl: '/users/login', logoutUrl: '/users/logout', shell: {version: 'fixture', imprintUrl: '/imprint',
        privacyPolicyUrl: '/privacy', localLoginEnabled: true, oidcEnabled: false, oidcName: 'Provider'},
};
function json(value: unknown, status = 200, responseContext = session.context): Response {
    return new Response(JSON.stringify(value), {status, headers: {'Content-Type': 'application/json',
        'X-Surveyor-Context': responseContext}});
}
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
});

/** Real route reuse, commands and generated validators; only the HTTP boundary is replaced. */
async function mounted(path: string, handler: (request: Request) => Promise<Response>,
                       bootstrap: Partial<FrontendPilotBootstrap> = {}, useShell = false) {
    const request = vi.fn((input: RequestInfo | URL) => handler(input as Request));
    const context = createPilotContext({session, ...bootstrap}, true, request);
    context.hydrated.value = true;
    context.visible.value = true;
    const router = createRouter({history: createMemoryHistory(), routes: [
        {path: '/frontend-pilot/users/register', component: IdentityPage, meta: {identityMode: 'register'}},
        {path: '/frontend-pilot/users/login', component: IdentityPage, meta: {identityMode: 'login'}},
        {path: '/frontend-pilot/users/forgot-password', component: IdentityPage, meta: {identityMode: 'forgot'}},
        {path: '/frontend-pilot/users/reset-password/:token', component: IdentityPage, meta: {identityMode: 'reset'}},
        {path: '/frontend-pilot/users/activate/:token', component: IdentityPage, meta: {identityMode: 'activate'}},
        {path: '/frontend-pilot/guest/recovery', component: IdentityPage, meta: {identityMode: 'recovery'}},
        {path: '/frontend-pilot/packing/:listId/guest', component: PackingGuestPage},
        {path: '/frontend-pilot/packing/:listId/duplicate', component: defineComponent({template: '<p>Duplicate destination</p>'})},
        {path: '/frontend-pilot/packing/:listId', component: defineComponent({template: '<p>Canonical detail</p>'})},
        {path: '/frontend-pilot', component: PackingHome},
        {path: '/frontend-pilot/packing/create', component: defineComponent({template: '<p>Create</p>'})},
        {path: '/frontend-pilot/help', component: defineComponent({template: '<p>Help</p>'})},
    ]});
    const stopInitialDocument = observeInitialDocument(context, router);
    await router.push(path);
    await router.isReady();
    const wrapper = mount(useShell ? App : defineComponent({template: '<RouterView />'}), {attachTo: document.body, global: {
        plugins: [router, [VueQueryPlugin, {queryClient: context.queryClient}], [I18NextVue, {i18next: context.i18next}]],
        provide: {[pilotContextKey as symbol]: context},
    }});
    cleanups.push(async () => { stopInitialDocument(); wrapper.unmount(); await context.queryClient.cancelQueries(); context.queryClient.clear(); });
    await flushPromises();
    return {wrapper, context, router, request};
}

describe('identity forms and packing overview navigation', () => {
    it.each([false, true])('keeps native header logout return precedence (explicit next=%s)', async explicit => {
        const destination = `/frontend-pilot/packing/${eventId}/duplicate?eventId=${profileId}`;
        const origin = '/frontend-pilot/help?doc=packing_lists' + (explicit ? '&next=' + encodeURIComponent(destination) : '');
        const anonymous = {...session, kind: 'anonymous' as const, context: 'logout-anonymous-context-1234567890',
            activeProfile: null, profiles: [], logoutUrl: null};
        let logoutCommands = 0;
        const {wrapper, context, router} = await mounted(origin, async request => {
            if (request.method === 'POST') {
                logoutCommands++;
                // Native header next takes precedence even when the controller supplies an
                // OIDC fallback. The browser must never invent an external destination.
                return json({session: anonymous, personalLink: null, redirect: 'https://provider.test/logout'}, 200, anonymous.context);
            }
            return json(anonymous, 200, anonymous.context);
        }, {}, true);
        await wrapper.get('form[action="/frontend-pilot/users/logout"]').trigger('submit');
        await flushPromises();
        expect(router.currentRoute.value.fullPath).toBe(explicit ? destination : origin);
        expect(context.pageNotice.value).toEqual({kind: 'success', messageKey: 'auth.logoutDone'});
        expect(wrapper.text()).toContain('Logout successful.');
        expect(logoutCommands).toBe(1);
    });

    it.each([false, true])('resumes confirmed header logout only for the matching Retry actor (mismatch=%s)', async mismatch => {
        const destination = `/frontend-pilot/packing/${eventId}/duplicate?eventId=${profileId}`;
        const origin = '/frontend-pilot/help?next=' + encodeURIComponent(destination);
        const anonymous = {...session, kind: 'anonymous' as const, context: 'confirmed-logout-context-1234567890',
            activeProfile: null, profiles: [], logoutUrl: null};
        const resumedActor = mismatch ? {...anonymous, context: 'superseding-actor-context-1234567890'} : anonymous;
        let logoutCommands = 0;
        let bootstrapReads = 0;
        const {wrapper, context, router} = await mounted(origin, async request => {
            if (request.method === 'POST') {
                logoutCommands++;
                return json({session: anonymous, personalLink: null, redirect: null}, 200, anonymous.context);
            }
            bootstrapReads++;
            return bootstrapReads === 1 ? new Response(null, {status: 503}) : json(resumedActor, 200, resumedActor.context);
        }, {}, true);
        await wrapper.get('form[action="/frontend-pilot/users/logout"]').trigger('submit');
        await flushPromises();
        expect(context.ready.value).toBe(false);
        expect(router.currentRoute.value.fullPath).toBe(origin);
        expect(logoutCommands).toBe(1);

        const retry = wrapper.findAll('button').find(button => button.text() === context.messages.value.t('common.retry'))!;
        await retry.trigger('click');
        await flushPromises();
        expect(context.ready.value).toBe(true);
        expect(router.currentRoute.value.fullPath).toBe(mismatch ? origin : destination);
        expect(context.pageNotice.value).toEqual(mismatch ? null : {kind: 'success', messageKey: 'auth.logoutDone'});
        expect(logoutCommands).toBe(1);
        expect(bootstrapReads).toBe(2);
        await context.refreshSession();
        await flushPromises();
        expect(logoutCommands).toBe(1);
        expect(router.currentRoute.value.fullPath).toBe(mismatch ? origin : destination);
    });

    it('retains confirmed login across the shell remount and retries failed delivery without another login', async () => {
        const destination = '/frontend-pilot/delayed-identity-destination';
        const authenticated = {...session, context: 'delivered-login-context-1234567890'};
        let loginCommands = 0;
        const {wrapper, router, context} = await mounted(`/frontend-pilot/users/login?next=${encodeURIComponent(destination)}`,
            async request => {
                if (request.method === 'POST') {
                    loginCommands++;
                    return json({session: authenticated, personalLink: null, redirect: null}, 200, authenticated.context);
                }
                return json(authenticated, 200, authenticated.context);
            }, {}, true);
        let failedDelivery = true;
        router.addRoute({path: destination, component: async function loadConfirmedDestination() {
            if (failedDelivery) throw new Error('Failed to fetch dynamically imported module');
            return defineComponent({template: '<p>Delivered signed-in destination</p>'});
        }});
        router.onError(() => {});

        await wrapper.get('#username').setValue('account');
        await wrapper.get('#password').setValue('password1');
        await wrapper.findAll('main form')[0].trigger('submit');
        await flushPromises();
        expect(context.ready.value).toBe(true);
        expect(context.session.value?.context).toBe(authenticated.context);
        expect(wrapper.get<HTMLInputElement>('#password').element.value).toBe('');
        expect(wrapper.get('main button[type="submit"]').attributes('disabled')).toBeDefined();

        // Programmatic submission cannot bypass the confirmed receipt's command guard.
        await wrapper.findAll('main form')[0].trigger('submit');
        expect(loginCommands).toBe(1);
        failedDelivery = false;
        const retry = wrapper.findAll('main button').find(button => button.text() === context.messages.value.t('common.retry'))!;
        await retry.trigger('click');
        await flushPromises();
        expect(router.currentRoute.value.path).toBe(destination);
        expect(wrapper.text()).toContain('Delivered signed-in destination');
        expect(context.pageNotice.value).toEqual({kind: 'success', messageKey: 'auth.loginDone'});
        expect(loginCommands).toBe(1);
    });

    it('retains confirmed recovery after destination failure and retries navigation without sending mail again', async () => {
        let recoveryCommands = 0;
        const {wrapper, context, router} = await mounted('/frontend-pilot/users/login', async request => {
            if (request.method === 'POST') recoveryCommands++;
            return json({changed: true});
        }, {}, true);
        const removeFailure = router.beforeResolve(function failRecoveryDelivery(to): void {
            if (to.path === '/frontend-pilot/guest/recovery') throw new Error('Failed to fetch dynamically imported module');
        });
        router.onError(() => {});
        await wrapper.get('#recovery-email').setValue('guest@example.test');
        await wrapper.findAll('main form')[1].trigger('submit');
        await flushPromises();
        expect(router.currentRoute.value.path).toBe('/frontend-pilot/users/login');
        expect(context.pageCompletion.value?.messageKey).toBe('auth.recoverySent');
        expect(wrapper.get<HTMLInputElement>('#recovery-email').element.value).toBe('');
        await wrapper.findAll('main form')[1].trigger('submit');
        expect(recoveryCommands).toBe(1);

        removeFailure();
        const retry = wrapper.findAll('main button').find(button => button.text() === context.messages.value.t('common.retry'))!;
        await retry.trigger('click');
        await flushPromises();
        expect(router.currentRoute.value.path).toBe('/frontend-pilot/guest/recovery');
        expect(wrapper.get('h1').text()).toBe('Success');
        expect(recoveryCommands).toBe(1);
    });

    it('preserves a native guest name and navigates confirmed registration to canonical detail', async () => {
        const anonymous = {...session, kind: 'anonymous' as const, activeProfile: null, profiles: []};
        const guest = {...session, kind: 'guest' as const, context: 'registered-guest-context-1234567890'};
        let submittedName: unknown;
        let registered = false;
        const {wrapper, context, router} = await mounted(`/frontend-pilot/packing/${eventId}/guest`, async request => {
            if (request.method === 'POST') {
                submittedName = (await request.clone().json()).username;
                registered = true;
                return json({session: guest, personalLink: 'https://example.test/guest/edit', redirect: null}, 200, guest.context);
            }
            if (new URL(request.url).pathname === '/api/v1/session') return json(guest, 200, guest.context);
            return json({id: eventId, title: 'Native guest fixture'}, 200, registered ? guest.context : anonymous.context);
        }, {session: anonymous});
        await wrapper.get('#guest-name').setValue('  Guest name with spaces  ');
        await wrapper.get('form').trigger('submit');
        await flushPromises();
        expect(submittedName).toBe('  Guest name with spaces  ');
        expect(router.currentRoute.value.path).toBe(`/frontend-pilot/packing/${eventId}`);
        expect(wrapper.text()).toContain('Canonical detail');
        expect(context.personalLink.value).toBe('https://example.test/guest/edit');
    });

    it('returns confirmed account login to the exact entity duplicate path and its query context', async () => {
        const destination = `/frontend-pilot/packing/${eventId}/duplicate?eventId=${profileId}`;
        const authenticated = {...session, context: 'confirmed-login-context-1234567890'};
        const {wrapper, router} = await mounted(`/frontend-pilot/users/login?next=${encodeURIComponent(destination)}`, async request => {
            return request.method === 'POST'
                ? json({session: authenticated, personalLink: null, redirect: null}, 200, authenticated.context)
                : json(authenticated, 200, authenticated.context);
        });
        await wrapper.get('#username').setValue('account');
        await wrapper.get('#password').setValue('password1');
        await wrapper.findAll('form')[0].trigger('submit');
        await flushPromises();
        expect(router.currentRoute.value.fullPath).toBe(destination);
        expect(wrapper.text()).toContain('Duplicate destination');
    });

    it('shows the native complete success-message outcome after confirmed guest recovery', async () => {
        const {wrapper, context, router} = await mounted('/frontend-pilot/users/login', async () => json({changed: true}));
        await wrapper.get('#username').setValue('Unrelated entered username');
        await wrapper.get('#recovery-email').setValue('guest@example.test');
        const form = wrapper.findAll('form').find(form => form.find('#recovery-email').exists())!;
        await form.trigger('submit');
        await flushPromises();
        expect(router.currentRoute.value.path).toBe('/frontend-pilot/guest/recovery');
        expect(wrapper.get('h1').text()).toBe('Success');
        expect(wrapper.text()).toContain('The link(s) to your guest account(s) have been sent to your email address.');
        expect(wrapper.find('form').exists()).toBe(false);
        expect(context.pageTitle.value).toBe('Success | Surveyor');
        expect(context.mayChangeIdentity()).toBe(true);
    });

    it('follows recovery GET admission without manufacturing a successful mail result from its URL', async () => {
        const {wrapper, router, request} = await mounted('/frontend-pilot/guest/recovery', async () => json({changed: true}));
        await flushPromises();
        expect(router.currentRoute.value.path).toBe('/frontend-pilot/users/login');
        expect(wrapper.get('h1').text()).toBe('Login');
        expect(wrapper.text()).not.toContain('The link(s) to your guest account(s)');
        expect(request).not.toHaveBeenCalled();
    });

    it('renders trusted native recovery POST feedback independently of local account configuration', async () => {
        const path = '/frontend-pilot/guest/recovery';
        const result = await render(path, {session: {...session,
            shell: {...session.shell, localLoginEnabled: false}}, initialUrl: path,
            pageCompletion: {context: session.context, destination: path, messageKey: 'auth.recoverySent', kind: 'success'}});
        expect(result.html).toContain('Success');
        expect(result.html).toContain('The link(s) to your guest account(s)');
        expect(result.html).not.toContain('Local account login is disabled');
        expect(result.javascriptRequired).toBe(false);
        expect(JSON.parse(result.state).pageCompletion?.destination).toBe(path);
        const content = document.createElement('div');
        content.innerHTML = result.html;
        expect(content.querySelector('main form')).toBeNull();
    });

    it.each([
        ['/frontend-pilot/users/register', 'auth.registered', 'Info', 'Account successfully registered.'],
        ['/frontend-pilot/users/forgot-password', 'auth.resetSent', 'Success', 'A link has been sent to the email'],
        ['/frontend-pilot/users/reset-password/confirmed-token', 'auth.resetDone', 'Success', 'Your password has been successfully reset.'],
    ] as const)('keeps confirmed native identity messages readable without JavaScript at %s', async (path, feedback, title, message) => {
        const result = await render(path, {session, initialUrl: path, identityFeedback: feedback});
        expect(result.javascriptRequired).toBe(false);
        expect(result.title).toBe(`${title} | Surveyor`);
        expect(result.html).toContain(message);
        const content = document.createElement('div');
        content.innerHTML = result.html;
        expect(content.querySelector('main form')).toBeNull();
    });

    it('consumes trusted native completion once without reviving success on a later recovery visit', async () => {
        const path = '/frontend-pilot/guest/recovery';
        const {wrapper, context, router, request} = await mounted(path, async () => json({changed: true}),
            {initialUrl: path, identityFeedback: 'auth.recoverySent',
                pageCompletion: {context: session.context, destination: path, messageKey: 'auth.recoverySent', kind: 'success'}}, true);
        expect(wrapper.get('h1').text()).toBe('Success');
        await router.push('/frontend-pilot/help');
        await flushPromises();
        expect(context.pageCompletion.value).toBeNull();
        await router.push(path);
        await flushPromises();
        expect(router.currentRoute.value.path).toBe('/frontend-pilot/users/login');
        expect(wrapper.get('h1').text()).toBe('Login');
        expect(wrapper.text()).not.toContain('The link(s) to your guest account(s)');
        expect(request).not.toHaveBeenCalled();
    });

    it('retains a rejected native recovery POST on the full error surface across hydration', async () => {
        const path = '/frontend-pilot/guest/recovery';
        const problem: components['schemas']['Problem'] = {type: 'about:blank', title: 'Bad Request', status: 400,
            code: 'VALIDATION_FAILED', messageKey: 'api:errors.VALIDATION_FAILED', params: {},
            detail: 'Invalid recovery email', requestId: 'recovery-error'};
        const bootstrap = {session, initialUrl: path, identityProblem: problem};
        const result = await render(path, bootstrap);
        expect(result.title).toBe('Error | Surveyor');
        expect(result.html).toContain('Check the submitted values.');
        const content = document.createElement('div');
        content.innerHTML = result.html;
        expect(content.querySelector('main form')).toBeNull();

        const {wrapper, router, request} = await mounted(path, async () => json({changed: true}), bootstrap);
        expect(router.currentRoute.value.path).toBe(path);
        expect(wrapper.get('h1').text()).toBe('Error');
        expect(wrapper.text()).toContain('Check the submitted values.');
        expect(wrapper.find('form').exists()).toBe(false);
        expect(request).not.toHaveBeenCalled();
    });

    it('retires rejected native recovery feedback after departure and admits a later recovery visit as native GET', async () => {
        const path = '/frontend-pilot/guest/recovery';
        const identityProblem: components['schemas']['Problem'] = {type: 'about:blank', title: 'Bad Request', status: 400,
            code: 'VALIDATION_FAILED', messageKey: 'api:errors.VALIDATION_FAILED', params: {},
            detail: 'Invalid recovery email', requestId: 'recovery-visit'};
        const {wrapper, router, context} = await mounted(path, async () => json({changed: true}),
            {initialUrl: path, identityProblem});
        expect(wrapper.get('h1').text()).toBe('Error');

        // A rejected guard preserves the actual initial response, including its denial.
        const removeGuard = router.beforeEach(() => false);
        await router.push('/frontend-pilot/help');
        expect(context.initialDocumentFor(path)?.identityProblem).toEqual(identityProblem);
        expect(wrapper.get('h1').text()).toBe('Error');
        removeGuard();

        await router.push('/frontend-pilot/help');
        expect(context.initialDocumentFor(path)).toBeUndefined();
        await router.push(path);
        await flushPromises();
        expect(router.currentRoute.value.path).toBe('/frontend-pilot/users/login');
        expect(wrapper.get('h1').text()).toBe('Login');
        expect(wrapper.text()).not.toContain('Check the submitted values.');
    });

    it('does not revive a completed native registration message on a later visit to its form', async () => {
        const path = '/frontend-pilot/users/register';
        const {wrapper, router} = await mounted(path, async () => json({changed: true}),
            {initialUrl: path, identityFeedback: 'auth.registered'});
        expect(wrapper.find('form').exists()).toBe(false);
        await router.push('/frontend-pilot/help');
        await router.push(path);
        await flushPromises();
        expect(wrapper.get('#username').exists()).toBe(true);
        expect(wrapper.find('form').exists()).toBe(true);
    });

    it('renders the native guest capability rejection rather than a new empty login form', async () => {
        const path = `/frontend-pilot/guest/${eventId}/login/invalid-token`;
        const result = await render(path, {session, initialUrl: path,
            pageEntry: {kind: 'denied', status: 401, messageKey: 'auth.invalidGuestLink'}});
        expect(result.html).toContain('Invalid or mismatched token');
        expect(result.html).not.toContain('id="username"');
        expect(result.html).not.toContain('id="password"');
        expect(result.title).toBe('Error | Surveyor');
        expect(result.javascriptRequired).toBe(false);
    });

    it('retains native one-time page feedback in the SSR shell and hydration state', async () => {
        const path = '/frontend-pilot/users/login';
        const result = await render(path, {session, initialUrl: path,
            pageNotice: {kind: 'error', messageKey: 'auth.sessionExpired'}});
        expect(result.html).toContain('Session has expired');
        expect(result.html).toContain('alert-danger');
        expect(JSON.parse(result.state).pageNotice).toEqual({kind: 'error', messageKey: 'auth.sessionExpired'});
    });

    it.each([
        ['/frontend-pilot/users/login', '#username', 'account'],
        ['/frontend-pilot/users/login', '#password', 'secret1'],
        ['/frontend-pilot/users/login', '#recovery-email', 'guest@example.test'],
        ['/frontend-pilot/users/forgot-password', '#username', 'account'],
        ['/frontend-pilot/users/register', '#displayname', 'Display name'],
        ['/frontend-pilot/users/register', '#email', 'account@example.test'],
        ['/frontend-pilot/users/register', '#password-repeat', 'secret1'],
        [`/frontend-pilot/packing/${eventId}/guest`, '#guest-name', 'Guest name'],
        [`/frontend-pilot/packing/${eventId}/guest`, '#guest-email', 'guest@example.test'],
    ])('protects a partial draft in %s (%s) across every departure channel', async (path, selector, value) => {
        const {wrapper, context, router} = await mounted(path, async () => json({id: eventId, title: 'Guest fixture'}));
        await wrapper.get(selector).setValue(value);
        const confirm = vi.fn(() => false);
        vi.stubGlobal('confirm', confirm);
        expect(context.mayChangeIdentity()).toBe(false);
        expect(confirm).toHaveBeenCalledTimes(1);
        await router.push('/frontend-pilot/help');
        expect(router.currentRoute.value.path).toBe(path);
        expect(confirm).toHaveBeenCalledTimes(2);
        expect(wrapper.get<HTMLInputElement>(selector).element.value).toBe(value);

        const departure = new Event('beforeunload', {cancelable: true});
        window.dispatchEvent(departure);
        expect(departure.defaultPrevented).toBe(true);
        context.updates.observe({...session.deployment, buildId: 'next-fixture'});
        expect(context.updates.available.value).toBe(true);
        expect(context.updates.requestReload()).toBe(false);
        expect(confirm).toHaveBeenCalledTimes(2);

        confirm.mockReturnValue(true);
        await router.push('/frontend-pilot/help');
        expect(router.currentRoute.value.path).toBe('/frontend-pilot/help');
        const afterLeave = new Event('beforeunload', {cancelable: true});
        window.dispatchEvent(afterLeave);
        expect(afterLeave.defaultPrevented).toBe(false);
    });

    it('releases a submitted form after confirmed success without a discard prompt', async () => {
        const {wrapper, context, router} = await mounted('/frontend-pilot/users/forgot-password', async () => json({changed: true}));
        await wrapper.get('#username').setValue('account');
        await wrapper.get('form').trigger('submit');
        await flushPromises();
        const confirm = vi.fn(() => false);
        vi.stubGlobal('confirm', confirm);
        expect(context.mayChangeIdentity()).toBe(true);
        const departure = new Event('beforeunload', {cancelable: true});
        window.dispatchEvent(departure);
        expect(departure.defaultPrevented).toBe(false);
        await router.push('/frontend-pilot/users/login');
        expect(wrapper.get<HTMLInputElement>('#username').element.value).toBe('');
        expect(confirm).not.toHaveBeenCalled();
    });

    it('retranslates initial identity and non-token reset denials in their mounted message region', async () => {
        const problem: components['schemas']['Problem'] = {type: 'about:blank', title: 'Forbidden', status: 403,
            code: 'FORBIDDEN', messageKey: 'api:errors.FORBIDDEN', params: {},
            detail: 'You do not have permission for this action.', requestId: 'localized-denial'};
        for (const path of ['/frontend-pilot/users/login', '/frontend-pilot/users/reset-password/fixture-token']) {
            const initial = path.endsWith('/login') ? {identityProblem: problem} : {passwordReset: problem};
            const {wrapper, context, request} = await mounted(path, async () => {
                throw new Error('Initial admission must not fetch again');
            }, {initialUrl: path, ...initial});
            const alert = wrapper.get('[role="alert"]').element;
            expect(alert.textContent).toBe('You do not have permission for this action.');
            context.locale.value = 'de';
            await flushPromises();
            expect(wrapper.get('[role="alert"]').element).toBe(alert);
            expect(alert.textContent).toBe('Du hast keine Berechtigung für diese Aktion.');
            expect(wrapper.find('form').exists()).toBe(false);
            expect(request).not.toHaveBeenCalled();
            const future: components['schemas']['SafeProblemDetails'] = {type: 'urn:future:problem', title: 'Future error',
                status: 403, detail: 'A future server supplied this safe explanation.', requestId: 'future-denial'};
            expect(problemMessage(context.messages.value, future)).toBe(future.detail);
        }
    });
    it('reads the session after an uncertain identity request without claiming failure or replaying it', async () => {
        const {wrapper, request, router} = await mounted('/frontend-pilot/users/login', async req => {
            if (req.method === 'POST') throw new TypeError('Response lost');
            return json(session);
        });
        await wrapper.get('#username').setValue('account');
        await wrapper.get('#password').setValue('password1');
        await wrapper.get('form').trigger('submit');
        await flushPromises();
        expect(wrapper.get('.alert-warning').text()).toContain('The request may already have completed.');
        await wrapper.findAll('button').find(button => button.text() === 'Refresh')!.trigger('click');
        await flushPromises();
        expect(request.mock.calls.map(([req]) => (req as Request).method)).toEqual(['POST', 'GET']);
        expect(wrapper.get('form button[type="submit"]').attributes('disabled')).toBeDefined();
        expect(wrapper.get('.alert-warning').text()).toContain('The request may already have completed.');
        const confirm = vi.fn(() => false);
        vi.stubGlobal('confirm', confirm);
        await router.push('/frontend-pilot/users/forgot-password');
        expect(router.currentRoute.value.path).toBe('/frontend-pilot/users/login');
        expect(wrapper.get<HTMLInputElement>('#username').element.value).toBe('account');
        expect(wrapper.get('form button[type="submit"]').attributes('disabled')).toBeDefined();
        confirm.mockReturnValue(true);
        await router.push('/frontend-pilot/users/forgot-password');
        await flushPromises();
        expect(router.currentRoute.value.path).toBe('/frontend-pilot/users/forgot-password');
        expect(request.mock.calls.map(([req]) => (req as Request).method)).toEqual(['POST', 'GET']);
        expect(wrapper.get<HTMLInputElement>('#username').element.value).toBe('');
        expect(wrapper.get('form button[type="submit"]').attributes('disabled')).toBeUndefined();
        expect(wrapper.find('.alert-warning').exists()).toBe(false);
        await wrapper.get('#username').setValue('another-account');
        await wrapper.get('form').trigger('submit');
        await flushPromises();
        expect(request.mock.calls.map(([req]) => (req as Request).method)).toEqual(['POST', 'GET', 'POST']);
    });

    it('refreshes guest session and entry after response loss without creating another guest', async () => {
        const {wrapper, request, router} = await mounted(`/frontend-pilot/packing/${eventId}/guest`, async req => {
            if (req.method === 'POST') throw new TypeError('Response lost');
            return json(req.url.endsWith('/session') ? session : {
                id: new URL(req.url).pathname.split('/').at(-2), title: 'Guest fixture',
            });
        });
        await wrapper.get('#guest-name').setValue('Guest name');
        await wrapper.get('form').trigger('submit');
        await flushPromises();
        const refresh = wrapper.findAll('button').find(button => button.text() === 'Refresh')!;
        await refresh.trigger('click');
        await flushPromises();
        const requests = request.mock.calls.map(([req]) => req as Request);
        expect(requests.filter(req => req.method === 'POST')).toHaveLength(1);
        expect(requests.filter(req => req.method === 'GET').map(req => new URL(req.url).pathname))
            .toEqual([`/api/v1/packing-lists/${eventId}/guest`, '/api/v1/session', `/api/v1/packing-lists/${eventId}/guest`]);
        expect(wrapper.get('form button[type="submit"]').attributes('disabled')).toBeDefined();
        const confirm = vi.fn(() => false);
        vi.stubGlobal('confirm', confirm);
        await router.push(`/frontend-pilot/packing/${profileId}/guest`);
        expect(router.currentRoute.value.params.listId).toBe(eventId);
        expect(wrapper.get<HTMLInputElement>('#guest-name').element.value).toBe('Guest name');
        confirm.mockReturnValue(true);
        await router.push(`/frontend-pilot/packing/${profileId}/guest`);
        await flushPromises();
        expect(wrapper.get<HTMLInputElement>('#guest-name').element.value).toBe('');
        expect(wrapper.get('form button[type="submit"]').attributes('disabled')).toBeUndefined();
        expect(request.mock.calls.map(([req]) => req as Request).filter(req => req.method === 'POST')).toHaveLength(1);
        await wrapper.get('#guest-name').setValue('Different guest');
        await wrapper.get('form').trigger('submit');
        await flushPromises();
        expect(request.mock.calls.map(([req]) => req as Request).filter(req => req.method === 'POST')
            .map(req => new URL(req.url).pathname))
            .toEqual([`/api/v1/packing-lists/${eventId}/guest`, `/api/v1/packing-lists/${profileId}/guest`]);
    });

    it('retains registration password criteria while login/reset keep their native rules', async () => {
        const {wrapper, request} = await mounted('/frontend-pilot/users/register', async () => json({changed: true}));
        await wrapper.get('#password').setValue('eightletters');
        await wrapper.get('#password-repeat').setValue('eightletters');
        await wrapper.get('form').trigger('submit');
        expect(request).not.toHaveBeenCalled();
        expect(wrapper.get('#password-info').text()).toContain('At least one digit');
        expect(wrapper.get('#password').classes()).toContain('is-invalid');
        expect(wrapper.get('#password').attributes('aria-describedby')).toBe('password-info');
        await wrapper.get('#password').setValue('eightletters1');
        await wrapper.get('#password-repeat').setValue('eightletters1');
        await wrapper.get('#password').trigger('blur');
        expect(wrapper.find('#password-info').exists()).toBe(false);
        expect(wrapper.get('#password').classes()).toContain('is-valid');
    });

    it('retains native forgot/reset instructions, labels, icons and full-width actions', async () => {
        const {wrapper, router} = await mounted('/frontend-pilot/users/forgot-password', async req => json(req.method === 'GET' ? {valid: true} : {changed: true}));
        expect(wrapper.get('h1').text()).toBe('Forgot your password?');
        expect(wrapper.get('p.lead').text()).toBe('Enter your username to receive a reset link.');
        expect(wrapper.get('#username').attributes('placeholder')).toBe('Your username or email');
        expect(wrapper.get('form .col-12 button[type="submit"]').text()).toBe('Send reset link');
        await router.push('/frontend-pilot/users/reset-password/fixture-token');
        await flushPromises();
        expect(wrapper.get('h1').text()).toBe('Reset your password');
        expect(wrapper.get('label[for="password"]').text()).toBe('New password *');
        expect(wrapper.get('label[for="password-repeat"]').text()).toBe('Confirm password *');
        expect(wrapper.get('form .col-12 button[type="submit"]').text()).toBe('Change password');
    });

    it('keeps native guest form structure and treats failed existing-email discovery as advisory', async () => {
        const {wrapper, request} = await mounted(`/frontend-pilot/packing/${eventId}/guest`, async req => {
            if (req.method === 'GET') return json({id: eventId, title: 'Guest fixture'});
            if (req.url.endsWith('/guest-email-exists')) throw new TypeError('Lookup unavailable');
            return json({type: 'about:blank', title: 'Unavailable', status: 403, detail: 'Unavailable', requestId: 'fixture',
                code: 'FORBIDDEN', messageKey: 'api:errors.FORBIDDEN', params: {}}, 403);
        });
        expect(wrapper.findAll('.input-group-lg')).toHaveLength(2);
        expect(wrapper.get('label[for="guest-name"] .bi-person-circle').exists()).toBe(true);
        expect(wrapper.get('#guest-name').attributes('placeholder')).toBe('Your name');
        expect(wrapper.get('#guest-email').attributes('inputmode')).toBe('email');
        expect(wrapper.get('.status-notice.alert-warning').classes()).toContain('mb-4');
        expect(wrapper.get('.status-notice .bi-exclamation-triangle-fill').exists()).toBe(true);
        expect(wrapper.get('.text-center.mt-4 .bi-arrow-left-circle').exists()).toBe(true);
        await wrapper.get('#guest-name').setValue('Guest name');
        await wrapper.get('#guest-email').setValue('guest@example.test');
        await wrapper.get('form').trigger('submit');
        await flushPromises();
        const commands = request.mock.calls.map(([req]) => req as Request).filter(req => req.method === 'POST');
        expect(commands.map(req => new URL(req.url).pathname)).toEqual(['/api/v1/auth/guest-email-exists', `/api/v1/packing-lists/${eventId}/guest`]);
        expect(await commands[1].json()).toEqual({username: 'Guest name', email: 'guest@example.test'});
    });

    it('requires an explicit guest recovery/new-identity choice before issuing either command', async () => {
        const {wrapper, request} = await mounted(`/frontend-pilot/packing/${eventId}/guest`, async req => {
            if (req.method === 'GET') return json({id: eventId, title: 'Guest fixture'});
            if (req.url.endsWith('/guest-email-exists')) return json({exists: true});
            return json({changed: true});
        });
        await wrapper.get('#guest-name').setValue('Guest name');
        await wrapper.get('#guest-email').setValue('guest@example.test');
        await wrapper.get('form').trigger('submit');
        await flushPromises();
        const dialog = document.querySelector<HTMLElement>('.pilot-dialog-compact')!;
        expect(dialog.getAttribute('role')).toBe('dialog');
        expect(dialog.textContent).toContain('Guest account found!');
        expect(request.mock.calls.map(([req]) => (req as Request).method).filter(method => method === 'POST')).toHaveLength(1);
        const recover = [...dialog.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.includes('Recover guest account'))!;
        recover.click();
        await flushPromises();
        const commands = request.mock.calls.map(([req]) => req as Request).filter(req => req.method === 'POST');
        expect(commands.map(req => new URL(req.url).pathname)).toEqual(['/api/v1/auth/guest-email-exists', '/api/v1/auth/guest-recovery']);
        expect(await commands[1].json()).toEqual({email: 'guest@example.test', next: `/frontend-pilot/packing/${eventId}`});
        expect(wrapper.get('.alert-success').text()).toContain('The link(s) to your guest account(s)');
    });

    it('keeps the active profile selected when a switch is cancelled or rejected', async () => {
        const problem: components['schemas']['Problem'] = {type: 'about:blank', title: 'Forbidden', status: 403,
            detail: 'The profile is unavailable.', requestId: 'profile-request', code: 'FORBIDDEN',
            messageKey: 'api:errors.FORBIDDEN', params: {}};
        const {context, router, request} = await mounted('/frontend-pilot/users/login', async () => json(problem, 403));
        context.session.value = {...session, profiles: [...session.profiles, {id: eventId, name: 'Other profile'}]};
        const header = mount(AppHeader, {attachTo: document.body, global: {plugins: [router, [I18NextVue, {i18next: context.i18next}]],
            provide: {[pilotContextKey as symbol]: context}}});
        try {
            const confirm = vi.fn(() => false);
            vi.stubGlobal('confirm', confirm);
            const select = header.get<HTMLSelectElement>('#pilot-profile');
            const menu = header.findAll('details').find(candidate => candidate.find('#pilot-profile').exists())!;
            expect(menu.get('a[href="/users/profile/manage"]').text()).toBe('Your profiles');
            expect((menu.element as HTMLDetailsElement).open).toBe(false);
            await menu.get('summary').trigger('click');
            const arrow = new KeyboardEvent('keydown', {key: 'ArrowDown', bubbles: true, cancelable: true});
            select.element.dispatchEvent(arrow);
            expect(arrow.defaultPrevented).toBe(false);
            const allowIdentity = context.registerIdentityGuard(() => false);
            await header.get('button.dropdown-item.text-danger').trigger('click');
            await select.setValue(eventId);
            expect(request).not.toHaveBeenCalled();
            expect(confirm).not.toHaveBeenCalled();
            expect(select.element.value).toBe(profileId);
            allowIdentity();
            await select.setValue(eventId);
            await flushPromises();
            expect(confirm).toHaveBeenCalledOnce();
            expect(request).not.toHaveBeenCalled();
            expect(select.element.value).toBe(profileId);

            confirm.mockReturnValue(true);
            await select.setValue(eventId);
            await flushPromises();
            expect(request).toHaveBeenCalledOnce();
            expect(await (request.mock.calls[0][0] as Request).json()).toEqual({profileId: eventId});
            expect(context.session.value.activeProfile?.id).toBe(profileId);
            expect(select.element.value).toBe(profileId);
            expect(header.find('[role="alert"]').exists()).toBe(true);
        } finally { header.unmount(); }
    });

    it('opens a clean login form after registration completes in the reused route component', async () => {
        const {wrapper, router, request} = await mounted('/frontend-pilot/users/register', async () => json({changed: true}));
        await wrapper.get('#username').setValue('new-account');
        await wrapper.get('#displayname').setValue('New organizer');
        await wrapper.get('#email').setValue('new-account@example.test');
        await wrapper.get('#password').setValue('correct password1');
        await wrapper.get('#password-repeat').setValue('correct password1');
        await wrapper.get('form').trigger('submit');
        await flushPromises();
        expect(request).toHaveBeenCalledOnce();
        expect((request.mock.calls[0][0] as Request).url).toContain('/api/v1/auth/register');
        expect(wrapper.find('#username').exists()).toBe(false);
        expect(wrapper.get('h1').text()).toBe('Info');
        expect(wrapper.find('.alert-info').exists()).toBe(true);
        expect(wrapper.get('a.btn-primary').attributes('href')).toBe('/frontend-pilot');

        await router.push('/frontend-pilot/users/login');
        await flushPromises();
        expect(wrapper.get('h1').text()).toBe('Login');
        expect(wrapper.get<HTMLInputElement>('#username').element.value).toBe('');
        expect(wrapper.get<HTMLInputElement>('#password').element.value).toBe('');
        expect(wrapper.get<HTMLInputElement>('#recovery-email').element.value).toBe('');
        expect(wrapper.find('.alert-success').exists()).toBe(false);
    });

    it('clears a completed reset when the reused route receives another token', async () => {
        const {wrapper, router, request} = await mounted('/frontend-pilot/users/reset-password/first-token', async req => json(req.method === 'GET' ? {valid: true} : {changed: true}));
        await wrapper.get('#password').setValue('correct password');
        await wrapper.get('#password-repeat').setValue('correct password');
        await wrapper.get('form').trigger('submit');
        await flushPromises();
        expect(await (request.mock.calls[1][0] as Request).json()).toEqual({token: 'first-token',
            password: 'correct password', confirmPassword: 'correct password'});
        expect(wrapper.find('#password').exists()).toBe(false);
        expect(wrapper.get('h1').text()).toBe('Success');
        expect(wrapper.get('a.btn-primary').text()).toBe('Home');
        await router.push('/frontend-pilot/users/reset-password/second-token');
        await flushPromises();
        expect(wrapper.get<HTMLInputElement>('#password').element.value).toBe('');
        expect(wrapper.get<HTMLInputElement>('#password-repeat').element.value).toBe('');
        expect(wrapper.find('.alert-success').exists()).toBe(false);
    });

    it('renders an SSR reset denial without password fields and preserves it through hydration', async () => {
        const path = '/frontend-pilot/users/reset-password/consumed-token';
        const problem: components['schemas']['Problem'] = {type: 'about:blank', title: 'Unauthorized', status: 401,
            detail: 'This link is invalid, expired, or already used.', requestId: 'reset-denial', code: 'TOKEN_INVALID',
            messageKey: 'api:errors.TOKEN_INVALID', params: {}};
        const bootstrap = {session, passwordReset: problem, initialUrl: path};
        const result = await render(path, bootstrap);
        expect(result.html).toContain('This link is invalid, expired, or already used.');
        expect(result.html).not.toContain('id="password"');
        expect(result.state).toContain('"passwordReset"');
        expect(result.javascriptRequired).toBe(false);
        const {wrapper, request} = await mounted(path, async () => json({valid: true}), bootstrap);
        expect(wrapper.get('h1').text()).toBe('Error');
        expect(wrapper.find('form').exists()).toBe(false);
        expect(wrapper.get('a.btn-primary').text()).toBe('Home');
        expect(request).not.toHaveBeenCalled();
    });

    it('admits only the exact SSR reset route and checks a different SPA token before exposing fields', async () => {
        const path = '/frontend-pilot/users/reset-password/admitted-token';
        const {wrapper, router, request} = await mounted(path, async () => json({valid: true}),
            {initialUrl: path, passwordReset: {valid: true}});
        expect(wrapper.find('#password').exists()).toBe(true);
        expect(request).not.toHaveBeenCalled();
        await router.push('/frontend-pilot/users/reset-password/different-token');
        await flushPromises();
        expect(request).toHaveBeenCalledOnce();
        const preflight = request.mock.calls[0][0] as Request;
        expect(preflight.method).toBe('GET');
        expect(new URL(preflight.url).searchParams.get('token')).toBe('different-token');
        expect(wrapper.find('#password').exists()).toBe(true);
    });

    it('renders guest choices and retains an editable draft while the independent entry read is pending', async () => {
        let finishEntry!: (response: Response) => void;
        const entry = new Promise<Response>(resolve => { finishEntry = resolve; });
        const {wrapper} = await mounted(`/frontend-pilot/packing/${eventId}/guest`, async () => entry);

        // Resource-dependent title feedback must not hide the known identity options
        // or defer mounting the form until the slower title projection arrives.
        expect(wrapper.find('[data-loading-skeleton]').exists()).toBe(true);
        expect(wrapper.find('a[href^="/frontend-pilot/users/login"]').exists()).toBe(true);
        const name = wrapper.get<HTMLInputElement>('#guest-name');
        await name.setValue('Name entered during loading');
        name.element.focus();

        finishEntry(json({id: eventId, title: 'Loaded guest fixture'}));
        await flushPromises();
        expect(wrapper.find('[data-loading-skeleton]').exists()).toBe(false);
        expect(wrapper.get('h1').text()).toContain('Loaded guest fixture');
        expect(wrapper.get<HTMLInputElement>('#guest-name').element).toBe(name.element);
        expect(name.element.value).toBe('Name entered during loading');
        expect(document.activeElement).toBe(name.element);
    });

    it('ignores a late positive reset check after the route changed to a denied token', async () => {
        let resolveFirst!: (response: Response) => void;
        const first = new Promise<Response>(resolve => { resolveFirst = resolve; });
        const {wrapper, router} = await mounted('/frontend-pilot/users/reset-password/first-token', async req => {
            if (new URL(req.url).searchParams.get('token') === 'first-token') return first;
            return json({type: 'about:blank', title: 'Unauthorized', status: 401,
                detail: 'This link is invalid, expired, or already used.', requestId: 'reset-denial', code: 'TOKEN_INVALID',
                messageKey: 'api:errors.TOKEN_INVALID', params: {}}, 401);
        });
        expect(wrapper.find('#password').exists()).toBe(false);
        expect(wrapper.find('[data-loading-skeleton="form"]').exists()).toBe(true);
        await router.push('/frontend-pilot/users/reset-password/second-token');
        await flushPromises();
        expect(wrapper.get('h1').text()).toBe('Error');
        expect(wrapper.find('[data-loading-skeleton]').exists()).toBe(false);
        resolveFirst(json({valid: true}));
        await flushPromises();
        expect(wrapper.find('#password').exists()).toBe(false);
        expect(wrapper.get('h1').text()).toBe('Error');
    });

    it('returns activation success to the own login form while preserving the destination', async () => {
        const next = `/frontend-pilot/packing/${eventId}`;
        const {wrapper, router, request} = await mounted(`/frontend-pilot/users/activate/valid-token?next=${encodeURIComponent(next)}`,
            async () => json({changed: true}));
        await flushPromises();
        expect(request).toHaveBeenCalledOnce();
        expect(router.currentRoute.value.path).toBe('/frontend-pilot/users/login');
        expect(router.currentRoute.value.query.next).toBe(next);
        expect(wrapper.get('.alert-success').text()).toBe('Account successfully activated.');
        expect(wrapper.get('.alert-success').element.closest('.card')).toBeNull();
        expect(wrapper.get('.alert-success').element.nextElementSibling).toBe(wrapper.get('.card').element);
        expect(wrapper.get('h1').text()).toBe('Login');
        expect(wrapper.find('#username').exists()).toBe(true);
        expect(wrapper.find('#password').exists()).toBe(true);
    });

    it('renders local-login denial through SSR and starts configured OIDC without an inert local form', async () => {
        const path = '/frontend-pilot/users/login';
        const disabled = {...session, shell: {...session.shell, localLoginEnabled: false}};
        const problem: components['schemas']['Problem'] = {type: 'about:blank', title: 'Forbidden', status: 403,
            detail: 'Local login is disabled.', requestId: 'local-denial', code: 'LOCAL_LOGIN_DISABLED',
            messageKey: 'api:errors.LOCAL_LOGIN_DISABLED', params: {}};
        const result = await render(path, {session: disabled, initialUrl: path, identityProblem: problem});
        expect(result.state).toContain('"identityProblem"');
        expect(result.html).not.toContain('id="username"');
        const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => {});
        const {wrapper, request} = await mounted(path, async () => json({changed: true}),
            {session: {...disabled, shell: {...disabled.shell, oidcEnabled: true}}});
        expect(assign).toHaveBeenCalledWith('/frontend-pilot/users/oidc/login?next=%2Ffrontend-pilot');
        expect(wrapper.find('form').exists()).toBe(false);
        expect(request).not.toHaveBeenCalled();
    });

    it('opens hidden regions from initial and same-page query navigation without losing their filters', async () => {
        const {wrapper, router, request} = await mounted(`/frontend-pilot?owner_hidden_q=equipment&owner_hidden_event=${eventId}`, async request => {
            const query = new URL(request.url).searchParams;
            const value: components['schemas']['OverviewRegion'] = {
                collection: query.get('collection') as 'participant' | 'owner', region: query.get('region') as 'main' | 'hidden',
                q: query.get('q') ?? '', type: 'all', availableTypes: [],
                page: 1, childPage: 1, eventId: query.get('eventId'), pageSize: 24,
                totalEntities: 1, hiddenEntities: 1, regionEntities: 0, matchingEntities: 0, totalCards: 0,
                totalChildren: 0, hasPrevious: false, hasNext: false, parent: null, items: [],
            };
            return json(value);
        });
        const hiddenButtons = () => wrapper.findAll('[aria-controls$="-hidden"]');
        expect(hiddenButtons().map(button => button.attributes('aria-expanded'))).toEqual(['false', 'true']);
        const queries = () => request.mock.calls.map(([input]) => new URL((input as Request).url).searchParams);
        expect(queries().some(query => query.get('collection') === 'owner' && query.get('region') === 'hidden'
            && query.get('q') === 'equipment' && query.get('eventId') === eventId)).toBe(true);

        await router.push({path: '/frontend-pilot', query: {...router.currentRoute.value.query, participant_hidden_q: 'tent', participant_hidden_open: '1'}});
        await flushPromises();
        expect(hiddenButtons().map(button => button.attributes('aria-expanded'))).toEqual(['true', 'true']);
        expect(queries().some(query => query.get('collection') === 'participant' && query.get('region') === 'hidden'
            && query.get('q') === 'tent')).toBe(true);
        expect(wrapper.findAll<HTMLInputElement>('input[type="search"]').map(input => input.element.value))
            .toEqual(['', 'tent', '', 'equipment']);
    });
});
