// @vitest-environment happy-dom
import {apiCompatibility} from '../../.generated/api/v1/policy.mjs';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {flushPromises, mount} from '@vue/test-utils';
import {defineComponent, h} from 'vue';
import {createMemoryHistory, createRouter, useRoute} from 'vue-router';
import {VueQueryPlugin} from '@tanstack/vue-query';
import I18NextVue from 'i18next-vue';
import {createPilotContext, observeInitialDocument, pilotContextKey} from '../../src/frontend/app/context';
import {pilotRoutes} from '../../src/frontend/app/createApp';
import IdentityPage from '../../src/frontend/features/identity/IdentityPage.vue';
import GuestEntryPage from '../../src/frontend/features/identity/GuestEntryPage.vue';
import {usePackingApi} from '../../src/frontend/features/packing/api';
import {usePilot} from '../../src/frontend/app/context';
import {packingKeys} from '../../src/frontend/app/queryKeys';
import type {PilotRequestScope} from '../../src/types/FrontendPilotUiTypes';
import PackingHome from '../../src/frontend/features/overview/OverviewPage.vue';
import AppHeader from '../../src/frontend/components/AppHeader.vue';
import App from '../../src/frontend/app/App.vue';
import {problemMessage} from '../../src/frontend/composables/feedback';
import type {components} from '../../src/types/api/v1';
import type {FrontendPilotBootstrap} from '../../src/types/FrontendPilotTypes';
import {render} from '../../src/frontend/app/entry-server';
import {frontendIdentityPageEntry} from '../../src/modules/lib/frontendIdentity';

const profileId = '11111111-1111-4111-8111-111111111111';
const eventId = '22222222-2222-4222-8222-222222222222';
const session: components['schemas']['SessionView'] & {context: string; csrfToken: string} = {
    kind: 'account', deployment: {buildId: 'fixture', apiCompatibility}, context: 'identity-ui-context-1234567890', csrfToken: 'identity-ui-csrf-1234567890', locale: 'en',
    activeProfile: {id: profileId, name: 'Organizer'}, profiles: [{id: profileId, name: 'Organizer'}],
    loginUrl: '/users/login', logoutUrl: '/users/logout', shell: {version: 'fixture', imprintUrl: '/imprint',
        privacyPolicyUrl: '/privacy', localLoginEnabled: true, oidcEnabled: false, oidcName: 'Provider'},
};
function json(value: unknown, status = 200, responseContext: components['schemas']['SessionView']['context'] = session.context): Response {
    return new Response(JSON.stringify(value), {status, headers: {'Content-Type': 'application/json',
        ...(responseContext === null ? {} : {'X-Surveyor-Context': responseContext})}});
}
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    document.body.innerHTML = '';
});

/** Exercise shared guest presentation with Packing's real feature adapter. */
const PackingGuestFixture = defineComponent({setup() {
    const context = usePilot();
    const route = useRoute();
    const api = usePackingApi(context);
    return () => {
        const id = String(route.params.listId);
        return h(GuestEntryPage, {resourceId: id, destination: '/frontend-pilot/packing/' + id,
            titleKey: 'app.packing', queryKey: packingKeys.guest(context.session.value?.context, id),
            readEntry: (scope: PilotRequestScope, signal?: AbortSignal) => api.guestEntry(id, scope, signal),
            registerGuest: (input: components['schemas']['GuestRegistrationInput'], scope: PilotRequestScope) => api.registerGuest(id, input, scope)});
    };
}});

/** Real route reuse, commands and generated validators; only the HTTP boundary is replaced. */
async function mounted(path: string, handler: (request: Request) => Promise<Response>,
                       bootstrap: Partial<FrontendPilotBootstrap> = {}, useShell = false) {
    const request = vi.fn((input: RequestInfo | URL) => handler(input as Request));
    const context = createPilotContext({session, ...bootstrap}, true, request);
    context.hydrated.value = true;
    context.visible.value = true;
    const router = createRouter({history: createMemoryHistory(), routes: [
        {path: '/frontend-pilot/users/register', component: IdentityPage, meta: {identityMode: 'register'}},
        {name: 'identity-test-login', path: '/frontend-pilot/users/login', component: IdentityPage, meta: {identityMode: 'login'}},
        {path: '/frontend-pilot/users/forgot-password', component: IdentityPage, meta: {identityMode: 'forgot'}},
        {path: '/frontend-pilot/users/reset-password/:token', component: IdentityPage, meta: {identityMode: 'reset'}},
        {path: '/frontend-pilot/users/activate/:token', component: IdentityPage, meta: {identityMode: 'activate'}},
        {path: '/frontend-pilot/users/oidc/login', component: IdentityPage, meta: {identityMode: 'oidc'}},
        {path: '/frontend-pilot/guest/recovery', component: IdentityPage, meta: {identityMode: 'recovery'}},
        {path: '/frontend-pilot/packing/:listId/guest', component: PackingGuestFixture},
        {path: '/frontend-pilot/packing/:listId/duplicate', component: defineComponent({template: '<p>Duplicate destination</p>'})},
        {path: '/frontend-pilot/packing/:listId', component: defineComponent({template: '<p>Canonical detail</p>'})},
        {path: '/frontend-pilot', component: PackingHome},
        {path: '/frontend-pilot/packing/create', component: defineComponent({template: '<p>Create</p>'})},
        {path: '/frontend-pilot/help', component: defineComponent({template: '<p>Help</p>'})},
    ]});
    // Substitute fixture views without copying production loading declarations.
    for (const route of router.getRoutes()) {
        route.meta.loadingSkeleton = pilotRoutes.find(candidate => candidate.path === route.path)?.meta?.loadingSkeleton;
    }
    const stopInitialDocument = observeInitialDocument(context, router);
    await router.push(path);
    await router.isReady();
    const wrapper = mount(useShell ? App : defineComponent({template: '<RouterView />'}), {attachTo: document.body, global: {
        plugins: [router, [VueQueryPlugin, {queryClient: context.queryClient}], [I18NextVue, {i18next: context.i18next}]],
        provide: {[pilotContextKey as symbol]: context},
    }});
    let mountedFixture = true;
    function unmountFixture(): void {
        if (!mountedFixture) return;
        mountedFixture = false;
        wrapper.unmount();
    }
    cleanups.push(async () => {
        // The fixture owns one application context. Retire its scopes too when tearing
        // it down, so an intentionally retained unknown editor is not another test's state.
        context.epoch.value++;
        stopInitialDocument();
        unmountFixture();
        await context.queryClient.cancelQueries();
        context.queryClient.clear();
    });
    await flushPromises();
    return {wrapper, context, router, request, unmount: unmountFixture};
}

describe('identity forms and packing overview navigation', () => {
    it.each([429, 503])('retains reset admission retry timing and checks once after the server deadline (%s)', async status => {
        vi.useFakeTimers();
        vi.setSystemTime(Date.UTC(2026, 9, 11, 6, 0, 0));
        let unavailable = true;
        const issue = {type: 'urn:future:reset-read', title: 'Check unavailable', status,
            detail: 'Wait before checking this link again.', requestId: 'reset-read-cooldown'};
        const {wrapper, context, request} = await mounted('/frontend-pilot/users/reset-password/fixture-token', async () => unavailable
            ? new Response(JSON.stringify(issue), {status, headers: {'Content-Type': 'application/problem+json',
                'X-Surveyor-Context': session.context, 'Retry-After': '5'}})
            : json({valid: true}));
        const retry = wrapper.findAll('button').find(button => button.text() === context.messages.value.t('common.retry'))!;
        expect(wrapper.find('form').exists()).toBe(false);
        expect(retry.attributes('disabled')).toBeDefined();
        expect(wrapper.get('[data-read-retry-at] time').attributes('datetime')).toBe('2026-10-11T06:00:05.000Z');
        expect(wrapper.get('[data-read-issue]').text()).toBe(issue.detail);
        expect(wrapper.find('[data-last-successful-refresh]').exists()).toBe(false);
        await retry.trigger('click');
        expect(request).toHaveBeenCalledOnce();
        await vi.advanceTimersByTimeAsync(5001);
        await flushPromises();
        expect(retry.attributes('disabled')).toBeUndefined();
        expect(wrapper.find('[data-read-retry-at]').exists()).toBe(false);
        unavailable = false;
        await retry.trigger('click');
        await flushPromises();
        expect(wrapper.find('#password').exists()).toBe(true);
        expect(request).toHaveBeenCalledTimes(2);
        expect(request.mock.calls.every(([read]) => (read as Request).method === 'GET')).toBe(true);
    });

    it.each([429, 503])('recovers only the failed guest title read and keeps the actual mounted identity draft (%s)', async status => {
        vi.useFakeTimers();
        vi.setSystemTime(Date.UTC(2026, 9, 11, 6, 0, 0));
        let unavailable = true;
        const issue = {type: 'urn:future:guest-read', title: 'Title unavailable', status,
            detail: 'Wait before reading the list title again.', requestId: 'guest-title-cooldown'};
        const path = `/frontend-pilot/packing/${eventId}/guest`;
        const {wrapper, context, request} = await mounted(path, async () => unavailable
            ? new Response(JSON.stringify(issue), {status, headers: {'Content-Type': 'application/problem+json',
                'X-Surveyor-Context': session.context, 'Retry-After': '5'}})
            : json({id: eventId, title: 'Guest title authority'}),
            {initialUrl: path, guestEntry: {id: eventId, title: 'Guest title authority'}});
        const input = wrapper.get<HTMLInputElement>('#guest-name');
        await input.setValue('Retained guest draft');
        input.element.focus();
        await context.queryClient.refetchQueries({type: 'active'});
        await flushPromises();
        const retry = wrapper.findAll('button').find(button => button.text() === context.messages.value.t('common.retry'))!;
        expect(wrapper.get('h1').text()).toContain('Guest title authority');
        expect(wrapper.get('[data-last-successful-refresh] time').attributes('datetime')).toBe('2026-10-11T06:00:00.000Z');
        expect(wrapper.get('[data-read-issue]').text()).toBe(issue.detail);
        expect(retry.attributes('disabled')).toBeDefined();
        await retry.trigger('click');
        expect(request).toHaveBeenCalledOnce();
        await vi.advanceTimersByTimeAsync(5001);
        await flushPromises();
        expect(wrapper.find('[data-read-retry-at]').exists()).toBe(false);
        unavailable = false;
        await retry.trigger('click');
        await flushPromises();
        expect(request).toHaveBeenCalledTimes(2);
        expect(request.mock.calls.every(([read]) => (read as Request).method === 'GET')).toBe(true);
        expect(wrapper.get<HTMLInputElement>('#guest-name').element).toBe(input.element);
        expect(input.element.value).toBe('Retained guest draft');
        expect(document.activeElement).toBe(input.element);
    });

    it.each(['account', 'guest', 'header'] as const)('protects %s recovery through its held authoritative read without replay', async kind => {
        let finishRead!: (response: Response) => void;
        const held = new Promise<Response>(resolve => { finishRead = resolve; });
        let recovering = false;
        const path = kind === 'guest' ? `/frontend-pilot/packing/${eventId}/guest`
            : kind === 'header' ? '/frontend-pilot/help' : '/frontend-pilot/users/login';
        const {wrapper, context, router, request} = await mounted(path, async req => {
            if (req.method === 'POST') throw new TypeError('Identity response lost');
            if (new URL(req.url).pathname.endsWith('/session')) return recovering ? held : json(session);
            return json({id: eventId, title: 'Guest fixture'});
        }, {}, kind === 'header');

        if (kind === 'account') {
            await wrapper.get('#username').setValue('account');
            await wrapper.get('#password').setValue('password1');
        } else if (kind === 'guest') await wrapper.get('#guest-name').setValue('Guest name');
        const form = kind === 'header' ? wrapper.get('header form') : wrapper.get('form');
        await form.trigger('submit');
        await flushPromises();
        recovering = true;
        const confirmation = vi.fn(() => true);
        vi.stubGlobal('confirm', confirmation);
        await wrapper.findAll('button').find(button => button.text() === 'Refresh')!.trigger('click');
        await flushPromises();
        try {
            // The pending recovery read wins over an uncertainty/discard prompt. The same
            // owner protects identity transitions, unload and client document navigation.
            expect(context.mayChangeIdentity()).toBe(false);
            const departure = new Event('beforeunload', {cancelable: true});
            window.dispatchEvent(departure);
            expect(departure.defaultPrevented).toBe(true);
            await router.push('/frontend-pilot/packing/create');
            expect(router.currentRoute.value.path).toBe(path);
            expect(confirmation).not.toHaveBeenCalled();
        } finally {
            finishRead(json(session));
            await flushPromises();
        }
        // An unchanged actor cannot prove the lost creation, mail or logout failed.
        expect(wrapper.text()).toContain(context.messages.value.t('state.unknownOutcome'));
        expect(request.mock.calls.filter(([req]) => (req as Request).method === 'POST')).toHaveLength(1);
    });

    it('retires a guest recovery follow-up when its form unmounts before bootstrap completes', async () => {
        let finishRead!: (response: Response) => void;
        const held = new Promise<Response>(resolve => { finishRead = resolve; });
        let recovering = false;
        const {wrapper, request, unmount} = await mounted(`/frontend-pilot/packing/${eventId}/guest`, async req => {
            if (req.method === 'POST') throw new TypeError('Guest response lost');
            if (new URL(req.url).pathname.endsWith('/session')) return recovering ? held : json(session);
            return json({id: eventId, title: 'Guest fixture'});
        });
        await wrapper.get('#guest-name').setValue('Guest name');
        await wrapper.get('form').trigger('submit');
        await flushPromises();
        recovering = true;
        await wrapper.findAll('button').find(button => button.text() === 'Refresh')!.trigger('click');
        await flushPromises();
        unmount();
        finishRead(json(session));
        await flushPromises();
        // Only the mounted form may start its resource follow-up. Same-actor bootstrap
        // after retirement must not restart the private query or replay registration.
        expect(request.mock.calls.map(([req]) => new URL((req as Request).url).pathname)).toEqual([
            `/api/v1/packing-lists/${eventId}/guest`, `/api/v1/packing-lists/${eventId}/guest`, '/api/v1/session',
        ]);
    });

    it('blocks identity, route and browser departure while a header logout response is held', async () => {
        let finishLogout!: (response: Response) => void;
        const held = new Promise<Response>(resolve => { finishLogout = resolve; });
        const anonymous: components['schemas']['SessionView'] = {...session, kind: 'anonymous',
            context: 'logout-anonymous-context-1234567890', activeProfile: null, profiles: [], logoutUrl: null};
        const {wrapper, context, router, request} = await mounted('/frontend-pilot/help', async req =>
            req.method === 'POST' ? held : json(anonymous, 200, anonymous.context), {}, true);
        const confirmation = vi.fn(() => true);
        vi.stubGlobal('confirm', confirmation);
        await wrapper.get('header form').trigger('submit');
        await flushPromises();
        try {
            expect(context.mayChangeIdentity()).toBe(false);
            const departure = new Event('beforeunload', {cancelable: true});
            window.dispatchEvent(departure);
            expect(departure.defaultPrevented).toBe(true);
            await router.push('/frontend-pilot/packing/create');
            expect(router.currentRoute.value.path).toBe('/frontend-pilot/help');
            expect(confirmation).not.toHaveBeenCalled();
        } finally {
            finishLogout(json({session: anonymous, personalLink: null, redirect: null}, 200, anonymous.context));
            await flushPromises();
        }
        expect(context.session.value?.context).toBe(anonymous.context);
        expect(context.pageNotice.value).toEqual({kind: 'success', messageKey: 'auth.logoutDone'});
        expect(context.mayChangeIdentity()).toBe(true);
        expect(request.mock.calls.filter(([req]) => (req as Request).method === 'POST')).toHaveLength(1);
    });

    it('keeps a lost header logout response unknown and recovers by reading without a second POST', async () => {
        let bootstrapUnavailable = true;
        let nextSession = session;
        const {wrapper, context, request} = await mounted('/frontend-pilot/help', async req => {
            if (req.method === 'POST') throw new TypeError('Logout response lost');
            return bootstrapUnavailable ? new Response(null, {status: 503}) : json(nextSession, 200, nextSession.context);
        }, {}, true);
        const form = wrapper.get('header form');
        await form.trigger('submit');
        await flushPromises();
        const warning = context.messages.value.t('state.unknownOutcome');
        expect(wrapper.text()).toContain(warning);
        expect(form.get('button').attributes('disabled')).toBeDefined();
        await form.trigger('submit');
        const refresh = wrapper.findAll('header button').find(button => button.text() === context.messages.value.t('common.refresh'))!;
        await refresh.trigger('click');
        await flushPromises();
        expect(wrapper.text()).toContain(context.messages.value.t('state.loadFailed'));

        bootstrapUnavailable = false;
        await refresh.trigger('click');
        await flushPromises();
        expect(wrapper.text()).not.toContain(context.messages.value.t('state.loadFailed'));
        expect(wrapper.text()).toContain(warning);
        expect(form.get('button').attributes('disabled')).toBeDefined();
        nextSession = {...session, context: 'logout-another-account-context-1234567890'};
        await refresh.trigger('click');
        await flushPromises();
        expect(wrapper.text()).not.toContain(warning);
        expect(wrapper.get('header form button').attributes('disabled')).toBeUndefined();
        expect(context.mayChangeIdentity()).toBe(true);
        expect(request.mock.calls.filter(([req]) => (req as Request).method === 'POST')).toHaveLength(1);
    });

    it('combines an unknown header logout and route draft into one canceled or accepted departure decision', async () => {
        const {wrapper, context, router, request} = await mounted('/frontend-pilot/users/login', async req => {
            if (req.method === 'POST') throw new TypeError('Logout response lost');
            return json(session);
        }, {}, true);
        await wrapper.get('header form').trigger('submit');
        await flushPromises();
        await wrapper.get('#username').setValue('Retained account draft');
        const confirmation = vi.fn(() => false);
        vi.stubGlobal('confirm', confirmation);
        await router.push('/frontend-pilot/users/login#login-form');
        await flushPromises();
        expect(confirmation).not.toHaveBeenCalled();
        expect(wrapper.text()).toContain(context.messages.value.t('state.unknownOutcome'));
        expect(wrapper.get('header .status-notice.alert-warning').classes()).toContain('mb-0');
        expect(wrapper.get('header .status-notice.alert-warning').classes()).not.toContain('mb-3');
        expect(wrapper.get('header form button').attributes('disabled')).toBeDefined();
        await router.push('/frontend-pilot/users/forgot-password');
        expect(router.currentRoute.value.path).toBe('/frontend-pilot/users/login');
        expect(confirmation).toHaveBeenCalledOnce();
        expect(confirmation).toHaveBeenCalledWith(context.messages.value.t('auth.leaveUnknown'));
        expect(wrapper.get<HTMLInputElement>('#username').element.value).toBe('Retained account draft');

        confirmation.mockClear();
        confirmation.mockReturnValue(true);
        await router.push('/frontend-pilot/users/forgot-password');
        await flushPromises();
        expect(router.currentRoute.value.path).toBe('/frontend-pilot/users/forgot-password');
        expect(confirmation).toHaveBeenCalledOnce();
        expect(wrapper.text()).not.toContain(context.messages.value.t('state.unknownOutcome'));
        expect(wrapper.get('header form button').attributes('disabled')).toBeUndefined();
        expect(context.mayChangeIdentity()).toBe(true);
        expect(request.mock.calls.filter(([req]) => (req as Request).method === 'POST')).toHaveLength(1);
    });

    it('releases a retained unknown command after its whole application lifetime ends', async () => {
        const {wrapper, context, unmount} = await mounted('/frontend-pilot/help', async req => {
            if (req.method === 'POST') throw new TypeError('Logout response lost');
            return json(session);
        }, {}, true);
        const stopContext = context.start();
        cleanups.push(async () => { stopContext(); });
        await wrapper.get('header form').trigger('submit');
        await flushPromises();
        const retained = new Event('beforeunload', {cancelable: true});
        window.dispatchEvent(retained);
        expect(retained.defaultPrevented).toBe(true);

        const removeListener = vi.spyOn(window, 'removeEventListener');
        unmount();
        stopContext();
        expect(removeListener.mock.calls.some(([name]) => name === 'beforeunload')).toBe(true);
        const retired = new Event('beforeunload', {cancelable: true});
        window.dispatchEvent(retired);
        expect(retired.defaultPrevented).toBe(false);
        expect(context.mayChangeIdentity()).toBe(true);
    });

    it('clears only the recovered session Retry error after an earlier Retry also failed', async () => {
        let reads = 0;
        const {wrapper, context} = await mounted('/frontend-pilot/help', async () => {
            reads++;
            return reads <= 2 ? new Response(null, {status: 503}) : json(session);
        }, {}, true);
        await expect(context.acceptIdentity({session, personalLink: null, redirect: null})).rejects.toThrow();
        await flushPromises();
        const retry = wrapper.findAll('main button').find(button => button.text() === context.messages.value.t('common.retry'))!;
        await retry.trigger('click');
        await flushPromises();
        expect(context.notice.value).toBe('state.stale');
        await retry.trigger('click');
        await flushPromises();
        expect(context.ready.value).toBe(true);
        expect(context.notice.value).toBeNull();
        expect(wrapper.find('main .alert-danger').exists()).toBe(false);
        expect(reads).toBe(3);
    });

    it('preserves a canceled query visit, then clears credentials after accepted next-only navigation', async () => {
        const first = '/frontend-pilot/users/login?next=%2Ffrontend-pilot%2Fhelp';
        const second = '/frontend-pilot/users/login?next=%2Ffrontend-pilot';
        const {wrapper, router, request} = await mounted(first, async () => json(session));
        await wrapper.get('#username').setValue('Account');
        await wrapper.get('#password').setValue('Private unfinished password');
        const confirm = vi.fn(() => false);
        vi.stubGlobal('confirm', confirm);
        await router.push(second);
        expect(router.currentRoute.value.fullPath).toBe(first);
        expect(wrapper.get<HTMLInputElement>('#password').element.value).toBe('Private unfinished password');
        confirm.mockReturnValue(true);
        await router.push(second);
        await flushPromises();
        expect(router.currentRoute.value.fullPath).toBe(second);
        expect(wrapper.get<HTMLInputElement>('#username').element.value).toBe('');
        expect(wrapper.get<HTMLInputElement>('#password').element.value).toBe('');
        expect(request).not.toHaveBeenCalled();
    });

    it('keeps a form draft through locale and fragment presentation changes', async () => {
        const {wrapper, router} = await mounted('/frontend-pilot/users/login?next=%2Ffrontend-pilot', async () => json(session));
        await wrapper.get('#username').setValue('Account');
        await wrapper.get('#password').setValue('Private unfinished password');
        vi.stubGlobal('confirm', vi.fn(() => true));
        await router.push('/frontend-pilot/users/login?next=%2Ffrontend-pilot&locale=de#form');
        await flushPromises();
        expect(wrapper.get<HTMLInputElement>('#username').element.value).toBe('Account');
        expect(wrapper.get<HTMLInputElement>('#password').element.value).toBe('Private unfinished password');
    });

    it('renders native reset completion without rechecking its consumed token and retires it on departure', async () => {
        const path = '/frontend-pilot/users/reset-password/consumed-token';
        const completion = {context: session.context, destination: path, messageKey: 'auth.resetDone' as const, kind: 'success' as const};
        const {wrapper, context, router, request} = await mounted(path, async () => json({type: 'about:blank', title: 'Unauthorized',
            status: 401, detail: 'This link is invalid, expired, or already used.', requestId: 'reset-denial', code: 'TOKEN_INVALID',
            messageKey: 'api:errors.TOKEN_INVALID', params: {}}, 401), {initialUrl: path, pageCompletion: completion}, true);
        expect(wrapper.get('h1').text()).toBe('Success');
        expect(wrapper.text()).toContain('Your password has been successfully reset');
        expect(request).not.toHaveBeenCalled();
        const rendered = await render(path, {session, initialUrl: path, pageCompletion: completion});
        expect(rendered.javascriptRequired).toBe(false);
        expect(rendered.html).not.toContain('id="password"');
        await router.push(path + '#confirmation');
        await flushPromises();
        expect(wrapper.get('h1').text()).toBe('Success');
        expect(context.pageCompletion.value).toEqual(completion);
        expect(request).not.toHaveBeenCalled();
        await router.push('/frontend-pilot/help');
        expect(context.pageCompletion.value).toBeNull();
        await router.push(path);
        await flushPromises();
        expect(wrapper.get('h1').text()).toBe('Error');
        expect(wrapper.find('#password').exists()).toBe(false);
        expect(request).toHaveBeenCalledOnce();
    });

    it('retries only login delivery after confirmed activation when the login chunk fails', async () => {
        let finishActivation!: (response: Response) => void;
        const response = new Promise<Response>(resolve => { finishActivation = resolve; });
        let activations = 0;
        const {wrapper, router, context} = await mounted('/frontend-pilot/users/activate/valid-token?next=%2Ffrontend-pilot', async request => {
            if (request.method === 'POST') { activations++; return response; }
            return json(session);
        }, {}, true);
        let failDelivery = true;
        router.addRoute({name: 'identity-test-login', path: '/frontend-pilot/users/login', meta: {identityMode: 'login'},
            component: async function loadLogin() {
                if (failDelivery) throw new TypeError('Failed to fetch dynamically imported module');
                return IdentityPage;
            }});
        router.onError(() => {});
        finishActivation(json({changed: true}));
        await flushPromises();
        expect(activations).toBe(1);
        expect(router.currentRoute.value.path).toContain('/activate/');
        expect(wrapper.text()).toContain(context.messages.value.t('state.saved'));
        const retry = wrapper.findAll('main button').find(button => button.text() === context.messages.value.t('common.retry'))!;
        failDelivery = false;
        await retry.trigger('click');
        await flushPromises();
        expect(router.currentRoute.value.path).toBe('/frontend-pilot/users/login');
        expect(context.pageNotice.value?.messageKey).toBe('auth.activated');
        expect(wrapper.find('#password').exists()).toBe(true);
        expect(activations).toBe(1);
    });

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
        await wrapper.get('header form').trigger('submit');
        await flushPromises();
        expect(router.currentRoute.value.fullPath).toBe(explicit ? destination : origin);
        expect(context.pageNotice.value).toEqual({kind: 'success', messageKey: 'auth.logoutDone'});
        expect(wrapper.get('.alert-success').text()).toBe('Logout successful');
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
        await wrapper.get('header form').trigger('submit');
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
        const anonymous: components['schemas']['SessionView'] = {...session, kind: 'anonymous',
            activeProfile: null, profiles: [], logoutUrl: null};
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

    it.each([false, true])('retains committed guest identity and warns about failed mail without replay (bootstrap failure=%s)', async function retainCommittedIdentity(failBootstrap) {
        const anonymous: components['schemas']['SessionView'] = {...session, kind: 'anonymous',
            activeProfile: null, profiles: [], logoutUrl: null};
        const guest = {...session, kind: 'guest' as const, context: 'email-failure-guest-context-1234567890'};
        const origin = `/frontend-pilot/packing/${eventId}/guest`;
        const destination = `/frontend-pilot/packing/${eventId}`;
        const link = 'https://example.test/guest/committed-personal-link';
        let registrations = 0;
        let unavailable = failBootstrap;
        let authoritative: components['schemas']['SessionView'] = guest;
        const {wrapper, context, router} = await mounted(origin, async function guestMailFixture(request) {
            const path = new URL(request.url).pathname;
            if (path === '/api/v1/auth/guest-email-exists') return json({exists: false}, 200, anonymous.context);
            if (request.method === 'POST') {
                registrations++;
                return json({session: guest, personalLink: link, redirect: null, emailDelivery: 'failed'}, 200, guest.context);
            }
            if (path === '/api/v1/session') {
                if (unavailable) throw new TypeError('Confirmed identity bootstrap is temporarily unavailable.');
                return json(authoritative, 200, authoritative.context);
            }
            return json({id: eventId, title: 'Guest email fixture'}, 200, registrations ? guest.context : anonymous.context);
        }, {session: anonymous}, true);
        let rejectDestination = true;
        router.beforeResolve(function holdCommittedGuestDestination(to): void {
            if (to.path === destination && rejectDestination) throw new Error('Failed to fetch dynamically imported module');
        });
        router.onError(() => {});

        await wrapper.get('#guest-name').setValue('Committed guest');
        await wrapper.get('#guest-email').setValue('guest@example.test');
        await wrapper.get('main form').trigger('submit');
        await flushPromises();
        expect(registrations).toBe(1);
        if (failBootstrap) {
            // A retained confirmation cannot disclose its private link before
            // an authoritative matching actor arrives. Retry reads only session.
            expect(context.ready.value).toBe(false);
            expect(context.personalLink.value).toBeNull();
            unavailable = false;
            const retry = wrapper.findAll('main button').find(button => button.text() === context.messages.value.t('common.retry'))!;
            await retry.trigger('click');
            await flushPromises();
        }
        expect(context.session.value?.context).toBe(guest.context);
        expect(context.personalLink.value).toBe(link);
        expect(context.pageNotice.value).toEqual({kind: 'info', messageKey: 'auth.guestEmailFailed'});
        expect(wrapper.findAll('.alert-info').some(notice => notice.text().includes(context.messages.value.t('auth.guestEmailFailed')))).toBe(true);
        expect(router.currentRoute.value.path).toBe(origin);

        // Failed navigation owns one confirmed destination. A programmatic form
        // submission is blocked, and Retry delivers that destination without POST.
        await wrapper.get('main form').trigger('submit');
        expect(registrations).toBe(1);
        rejectDestination = false;
        const retry = wrapper.findAll('main button').find(button => button.text() === context.messages.value.t('common.retry'))!;
        await retry.trigger('click');
        await flushPromises();
        expect(router.currentRoute.value.path).toBe(destination);
        expect(context.personalLink.value).toBe(link);
        expect(context.pageNotice.value).toEqual({kind: 'info', messageKey: 'auth.guestEmailFailed'});
        expect(registrations).toBe(1);

        // A different authoritative actor retires both private link and advisory
        // feedback rather than carrying the old registration into another scope.
        authoritative = session;
        await context.acceptIdentity({session, personalLink: null, redirect: null});
        expect(context.personalLink.value).toBeNull();
        expect(context.pageNotice.value).toBeNull();
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

    it('renders an explicitly supplied recovery completion independently of local account configuration', async () => {
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
        ['/frontend-pilot/users/reset-password/confirmed-token', 'auth.resetDone', 'Success', 'Your password has been successfully reset'],
    ] as const)('keeps explicitly supplied confirmed identity messages readable without JavaScript at %s', async (path, feedback, title, message) => {
        const result = await render(path, {session, initialUrl: path, identityFeedback: feedback});
        expect(result.javascriptRequired).toBe(false);
        expect(result.title).toBe(`${title} | Surveyor`);
        expect(result.html).toContain(message);
        const content = document.createElement('div');
        content.innerHTML = result.html;
        expect(content.querySelector('main form')).toBeNull();
    });

    it('consumes an explicitly supplied completion once without reviving success on a later recovery visit', async () => {
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

    it('retains an admitted recovery problem on the full error surface across hydration', async () => {
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
        expect(wrapper.find('#username').exists()).toBe(true);
        expect(wrapper.find('form').exists()).toBe(true);
    });

    it('retires a completed registration when the same form receives a different return destination', async () => {
        const path = '/frontend-pilot/users/register?next=%2Ffrontend-pilot%2Fhelp';
        const {wrapper, router, request} = await mounted(path, async () => json({changed: true}),
            {initialUrl: path, identityFeedback: 'auth.registered'});
        expect(wrapper.find('form').exists()).toBe(false);
        await router.push('/frontend-pilot/users/register?next=%2Ffrontend-pilot');
        await flushPromises();
        expect(wrapper.get<HTMLInputElement>('#username').element.value).toBe('');
        expect(wrapper.get<HTMLInputElement>('#password').element.value).toBe('');
        expect(wrapper.get('h1').text()).toBe('Register');
        expect(request).not.toHaveBeenCalled();
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
        // Static-route policy cannot substitute for protection of this live draft.
        expect(context.updates.requestRecoveryReload()).toBe(false);
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

    it.each(['account', 'guest'] as const)('keeps %s recovery read failures durable until the matching read succeeds', async kind => {
        let unavailable = true;
        const path = kind === 'account' ? '/frontend-pilot/users/login' : `/frontend-pilot/packing/${eventId}/guest`;
        const {wrapper, context, request} = await mounted(path, async req => {
            if (req.method === 'POST') throw new TypeError('Response lost');
            if (new URL(req.url).pathname.endsWith('/session')) {
                return unavailable ? new Response(null, {status: 503}) : json(session);
            }
            return json({id: eventId, title: 'Guest fixture'});
        });
        if (kind === 'account') {
            await wrapper.get('#username').setValue('account');
            await wrapper.get('#password').setValue('password1');
        } else await wrapper.get('#guest-name').setValue('Guest name');
        await wrapper.get('form').trigger('submit');
        await flushPromises();
        vi.useFakeTimers();
        const refresh = wrapper.findAll('button').find(button => button.text() === context.messages.value.t('common.refresh'))!;
        await refresh.trigger('click');
        await flushPromises();
        expect(wrapper.text()).toContain(context.messages.value.t('state.loadFailed'));
        await vi.advanceTimersByTimeAsync(11_000);
        await flushPromises();
        expect(wrapper.text()).toContain(context.messages.value.t('state.loadFailed'));

        unavailable = false;
        await refresh.trigger('click');
        await flushPromises();
        expect(wrapper.text()).not.toContain(context.messages.value.t('state.loadFailed'));
        expect(wrapper.text()).toContain(context.messages.value.t('state.unknownOutcome'));
        expect(wrapper.get('form button[type="submit"]').attributes('disabled')).toBeDefined();
        expect(request.mock.calls.filter(([req]) => (req as Request).method === 'POST')).toHaveLength(1);
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

    it('preserves native registration inline password mismatch wording before submission', async () => {
        const {wrapper, request} = await mounted('/frontend-pilot/users/register', async () => json({valid: true}));
        await wrapper.get('#password').setValue('correct password1');
        await wrapper.get('#password-repeat').setValue('different password1');
        // These are the original Pug inline words, deliberately independent of the
        // registration controller's remote rejection, which ends with a period.
        expect(wrapper.get('#password-repeat-info').text()).toBe('Passwords do not match!');
        await wrapper.get('form').trigger('submit');
        expect(request.mock.calls.map(([req]) => req as Request).filter(req => req.method === 'POST')).toEqual([]);
        expect(wrapper.get('.alert-danger').text()).toBe('Please check that both the password and the password repetition are valid!');
        expect(wrapper.get('.alert-danger').classes()).toContain('alert-dismissible');
        expect(wrapper.get('.btn-close').attributes('aria-label')).toBe('Dismiss notification');
    });

    it('retains native forgot/reset instructions, labels, icons and full-width actions', async () => {
        const {wrapper, router, context} = await mounted('/frontend-pilot/users/forgot-password', async req => json(req.method === 'GET' ? {valid: true} : {changed: true}));
        expect(context.pageTitle.value).toBe('Password Reset | Surveyor');
        expect(wrapper.get('h1').text()).toBe('Forgot your password?');
        expect(wrapper.get('p.lead').text()).toBe('Enter your username to receive a reset link.');
        expect(wrapper.get('#username').attributes('placeholder')).toBe('Your username or email');
        expect(wrapper.get('form .col-12 button[type="submit"]').text()).toBe('Send reset link');
        await router.push('/frontend-pilot/users/reset-password/fixture-token');
        await flushPromises();
        expect(wrapper.get('h1').text()).toBe('Reset your password');
        expect(context.pageTitle.value).toBe('Reset password | Surveyor');
        expect(wrapper.get('label[for="password"]').text()).toBe('New password *');
        expect(wrapper.get('label[for="password-repeat"]').text()).toBe('Confirm password *');
        expect(wrapper.get('form .col-12 button[type="submit"]').text()).toBe('Change password');
    });

    it('keeps native guest form structure and treats failed existing-email discovery as advisory', async () => {
        const {wrapper, request, context} = await mounted(`/frontend-pilot/packing/${eventId}/guest`, async req => {
            if (req.method === 'GET') return json({id: eventId, title: 'Guest fixture'});
            if (req.url.endsWith('/guest-email-exists')) throw new TypeError('Lookup unavailable');
            return json({type: 'about:blank', title: 'Unavailable', status: 403, detail: 'Unavailable', requestId: 'fixture',
                code: 'FORBIDDEN', messageKey: 'api:errors.FORBIDDEN', params: {}}, 403);
        });
        expect(context.pageTitle.value).toBe('Join «Guest fixture»');
        expect(wrapper.findAll('.input-group-lg')).toHaveLength(2);
        expect(wrapper.find('label[for="guest-name"] .bi-person-circle').exists()).toBe(true);
        expect(wrapper.get('#guest-name').attributes('placeholder')).toBe('Your name');
        expect(wrapper.get('#guest-email').attributes('inputmode')).toBe('email');
        expect(wrapper.get('.status-notice.alert-warning').classes()).toContain('mb-4');
        expect(wrapper.find('.status-notice .bi-exclamation-triangle-fill').exists()).toBe(true);
        expect(wrapper.find('.text-center.mt-4 .bi-arrow-left-circle').exists()).toBe(true);
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

    it('retains the Your profiles journey through its migrated destination and protects pending identity changes', async () => {
        const {context, router, request} = await mounted('/frontend-pilot/users/login', async () => json(session));
        context.session.value = {...session, profiles: [...session.profiles, {id: eventId, name: 'Other profile'}]};
        const header = mount(AppHeader, {attachTo: document.body, global: {plugins: [router, [I18NextVue, {i18next: context.i18next}]],
            provide: {[pilotContextKey as symbol]: context}}});
        try {
            const confirm = vi.fn(() => false);
            vi.stubGlobal('confirm', confirm);
            const menu = header.findAll('details').find(candidate => candidate.find('a[href="/frontend-pilot/users/profile/manage"]').exists())!;
            expect(menu.get('a[href="/frontend-pilot/users/profile/manage"]').text()).toBe('Your profiles');
            expect(header.find('#pilot-profile').exists()).toBe(false);
            expect(header.find('form[action="/frontend-pilot/users/profile"]').exists()).toBe(false);
            expect((menu.element as HTMLDetailsElement).open).toBe(false);
            await menu.get('summary').trigger('click');
            const allowIdentity = context.registerIdentityGuard(() => false);
            await header.get('form').trigger('submit');
            expect(request).not.toHaveBeenCalled();
            expect(confirm).not.toHaveBeenCalled();
            allowIdentity();
            expect(context.session.value.activeProfile?.id).toBe(profileId);
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

    it('confirms account creation separately from failed activation-mail delivery and releases credentials without replay', async () => {
        const {wrapper, context, router, request} = await mounted('/frontend-pilot/users/register',
            async () => json({changed: true, emailDelivery: 'failed'}));
        await wrapper.get('#username').setValue('delivery-failed-account');
        await wrapper.get('#displayname').setValue('New organizer');
        await wrapper.get('#email').setValue('delivery-failed@example.test');
        await wrapper.get('#password').setValue('correct password1');
        await wrapper.get('#password-repeat').setValue('correct password1');
        const completedForm = wrapper.get('form');
        await completedForm.trigger('submit');
        await flushPromises();

        // A valid 200 receipt is confirmed creation even when SMTP failed. The
        // existing message page replaces the credential form and uncertainty UI.
        expect(wrapper.get('.alert-info').text()).toBe(context.messages.value.t('auth.registeredEmailFailed'));
        expect(wrapper.find('form').exists()).toBe(false);
        expect(wrapper.text()).not.toContain(context.messages.value.t('state.unknownOutcome'));
        expect(request).toHaveBeenCalledOnce();
        expect(await (request.mock.calls[0][0] as Request).json()).toMatchObject({
            username: 'delivery-failed-account', password: 'correct password1',
        });

        // Cached form events and refused completion-page navigation cannot repeat
        // creation. A later real visit reuses the component with a clean draft.
        await completedForm.trigger('submit');
        const stopRefusal = router.beforeEach(to => to.path === '/frontend-pilot' ? false : undefined);
        await wrapper.get('a.btn-primary').trigger('click');
        await flushPromises();
        expect(router.currentRoute.value.path).toBe('/frontend-pilot/users/register');
        expect(wrapper.get('.alert-info').text()).toContain('was registered');
        expect(request).toHaveBeenCalledOnce();
        stopRefusal();
        await router.push('/frontend-pilot/users/login');
        await flushPromises();
        expect(wrapper.get<HTMLInputElement>('#username').element.value).toBe('');
        expect(wrapper.get<HTMLInputElement>('#password').element.value).toBe('');
        await router.push('/frontend-pilot/users/register');
        await flushPromises();
        expect(wrapper.get<HTMLInputElement>('#password-repeat').element.value).toBe('');
        expect(wrapper.get<HTMLInputElement>('#email').element.value).toBe('');
        expect(wrapper.text()).not.toContain(context.messages.value.t('auth.registeredEmailFailed'));
        expect(request).toHaveBeenCalledOnce();
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
        // Compare the established native presentation, independently of the API detail.
        // Keeping both consumers on the same API wording previously hid this deviation.
        expect(result.html).toContain('Invalid or expired token');
        expect(result.html).not.toContain('id="password"');
        expect(result.state).toContain('"passwordReset"');
        expect(result.javascriptRequired).toBe(false);
        const {wrapper, request} = await mounted(path, async () => json({valid: true}), bootstrap);
        expect(wrapper.get('h1').text()).toBe('Error');
        expect(wrapper.get('[role="alert"]').text()).toBe('Invalid or expired token');
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
        expect(wrapper.find('[data-loading-skeleton="identity"]').exists()).toBe(true);
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
            async () => json({changed: true}), {}, true);
        await flushPromises();
        expect(request).toHaveBeenCalledOnce();
        expect(router.currentRoute.value.path).toBe('/frontend-pilot/users/login');
        expect(router.currentRoute.value.query.next).toBe(next);
        expect(wrapper.get('.alert-success').text()).toBe('Account successfully activated');
        expect(wrapper.get('.alert-success').element.closest('.card')).toBeNull();
        expect(wrapper.get('[data-pilot-notices]').element.contains(wrapper.get('.alert-success').element)).toBe(true);
        expect(wrapper.get('h1').text()).toBe('Login');
        expect(wrapper.find('#username').exists()).toBe(true);
        expect(wrapper.find('#password').exists()).toBe(true);
    });

    it.each([
        ['forgot', '/frontend-pilot/users/forgot-password', 'Login is not enabled!'],
        ['reset', '/frontend-pilot/users/reset-password/unread-token', 'Login is not enabled!'],
        ['activate', '/frontend-pilot/users/activate/unread-token', 'Login is not enabled!'],
        ['oidc', '/frontend-pilot/users/oidc/login', 'OIDC provider is not enabled!'],
    ] as const)('renders the native %s configuration Error before and after mounting', async (operation, path, nativeMessage) => {
        const disabled = {...session, shell: {...session.shell, localLoginEnabled: false}};
        const pageEntry = frontendIdentityPageEntry(operation, disabled.shell);
        const result = await render(path, {session: disabled, initialUrl: path, pageEntry});
        const document = new DOMParser().parseFromString(result.html, 'text/html');
        expect(document.querySelector('main .alert-danger')?.textContent).toBe(nativeMessage);
        expect(document.querySelector('main h1')?.textContent).toBe('Error');
        expect(document.querySelector('main a.btn-primary')?.textContent).toBe('Home');
        expect(document.querySelector('main form')).toBeNull();
        expect(result.javascriptRequired).toBe(false);
        const {wrapper, request} = await mounted(path, async () => json({changed: true}), {session: disabled});
        expect(wrapper.get('.alert-danger').text()).toBe(nativeMessage);
        expect(wrapper.get('h1').text()).toBe('Error');
        expect(wrapper.find('form').exists()).toBe(false);
        expect(request).not.toHaveBeenCalled();
    });

    it.each(['login', 'register'] as const)('starts native OIDC entry from disabled local %s even when the provider will deny', async operation => {
        const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => {});
        for (const oidcEnabled of [false, true]) {
            const {wrapper, request, unmount} = await mounted(`/frontend-pilot/users/${operation}`, async () => json({changed: true}),
                {session: {...session, shell: {...session.shell, localLoginEnabled: false, oidcEnabled}}});
            expect(assign).toHaveBeenLastCalledWith('/frontend-pilot/users/oidc/login?next=%2Ffrontend-pilot');
            expect(wrapper.find('form').exists()).toBe(false);
            expect(request).not.toHaveBeenCalled();
            unmount();
        }
    });

    it('hands mounted OIDC entry to the document provider owner without an empty form or client redirect loop', async () => {
        const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => {});
        const next = `/frontend-pilot/packing/${eventId}/duplicate?eventId=${profileId}#details`;
        const path = `/frontend-pilot/users/oidc/login?next=${encodeURIComponent(next)}`;
        const {wrapper, request, router} = await mounted(path, async () => json({changed: true}),
            {session: {...session, shell: {...session.shell, oidcEnabled: true}}});
        expect(assign).toHaveBeenCalledOnce();
        expect(assign).toHaveBeenCalledWith(path);
        expect(wrapper.get('h1').text()).toBe('Login');
        expect(wrapper.find('form').exists()).toBe(false);
        expect(request).not.toHaveBeenCalled();
        await router.push('/frontend-pilot/users/login');
        expect(assign).toHaveBeenCalledOnce();
    });

    it.each([
        ['login', 'INVALID_CREDENTIALS', 401, 'Invalid username/email or password'],
        ['login', 'ACCOUNT_INACTIVE', 403, 'User not activated.'],
        ['login', 'ACTIVATION_RESENT', 403, 'User not activated. The activation link has expired. A new one has been sent to your email account.'],
        ['register', 'USERNAME_TAKEN', 409, 'This username is already taken.'],
        ['register', 'PASSWORD_MISMATCH', 400, 'Passwords do not match.'],
        ['reset', 'PASSWORD_MISMATCH', 400, 'Passwords do not match!'],
    ] as const)('clears %s credentials after confirmed %s rejection while retaining safe redisplay fields', async (operation, code, status, nativeMessage) => {
        const path = operation === 'reset' ? '/frontend-pilot/users/reset-password/admitted-token'
            : `/frontend-pilot/users/${operation}`;
        const {wrapper, request} = await mounted(path, async req => req.method === 'GET' ? json({valid: true})
            : json({type: 'about:blank', title: 'Rejected', status, detail: 'Stable API transport wording',
                requestId: 'credential-rejection', code, messageKey: `api:errors.${code}`, params: {}}, status));
        if (operation !== 'reset') await wrapper.get('#username').setValue('Entered account');
        if (operation === 'register') {
            await wrapper.get('#displayname').setValue('Entered name');
            await wrapper.get('#email').setValue('entered@example.test');
        }
        await wrapper.get('#password').setValue('Private password1');
        if (operation !== 'login') await wrapper.get('#password-repeat').setValue(operation === 'reset'
            ? 'Different password1' : 'Private password1');
        await wrapper.get('form').trigger('submit');
        await flushPromises();
        expect(wrapper.get('.alert-danger').text()).toBe(nativeMessage);
        expect(wrapper.get<HTMLInputElement>('#password').element.value).toBe('');
        if (operation !== 'login') expect(wrapper.get<HTMLInputElement>('#password-repeat').element.value).toBe('');
        if (operation !== 'reset') expect(wrapper.get<HTMLInputElement>('#username').element.value).toBe('Entered account');
        if (operation === 'register') {
            expect(wrapper.get<HTMLInputElement>('#displayname').element.value).toBe('Entered name');
            expect(wrapper.get<HTMLInputElement>('#email').element.value).toBe('entered@example.test');
        }
        expect(request.mock.calls.map(([req]) => req as Request).filter(req => req.method === 'POST')).toHaveLength(1);
    });

    it('renders a changed local-login setting as the native complete Error after a confirmed API rejection', async () => {
        const {wrapper} = await mounted('/frontend-pilot/users/login', async () => json({type: 'about:blank', title: 'Forbidden',
            status: 403, detail: 'Local login is not enabled.', requestId: 'configuration-rejection',
            code: 'LOCAL_LOGIN_DISABLED', messageKey: 'api:errors.LOCAL_LOGIN_DISABLED', params: {}}, 403));
        await wrapper.get('#username').setValue('Entered account');
        await wrapper.get('#password').setValue('Private password1');
        await wrapper.get('form').trigger('submit');
        await flushPromises();
        expect(wrapper.get('h1').text()).toBe('Error');
        expect(wrapper.get('.alert-danger').text()).toBe('Login is not enabled!');
        expect(wrapper.find('form').exists()).toBe(false);
    });

    it.each(['login', 'register', 'reset'] as const)('retains %s secrets and safe input when delivery is unknown', async operation => {
        const path = operation === 'reset' ? '/frontend-pilot/users/reset-password/admitted-token'
            : `/frontend-pilot/users/${operation}`;
        const {wrapper, request} = await mounted(path, async req => {
            if (req.method === 'GET') return json({valid: true});
            throw new TypeError('The response was lost');
        });
        if (operation !== 'reset') await wrapper.get('#username').setValue('Entered account');
        if (operation === 'register') {
            await wrapper.get('#displayname').setValue('Entered name');
            await wrapper.get('#email').setValue('entered@example.test');
        }
        await wrapper.get('#password').setValue('Private password1');
        if (operation !== 'login') await wrapper.get('#password-repeat').setValue('Private password1');
        await wrapper.get('form').trigger('submit');
        await flushPromises();
        expect(wrapper.get<HTMLInputElement>('#password').element.value).toBe('Private password1');
        if (operation !== 'login') expect(wrapper.get<HTMLInputElement>('#password-repeat').element.value).toBe('Private password1');
        if (operation !== 'reset') expect(wrapper.get<HTMLInputElement>('#username').element.value).toBe('Entered account');
        expect(wrapper.get('form button[type="submit"]').attributes('disabled')).toBeDefined();
        expect(request.mock.calls.map(([req]) => req as Request).filter(req => req.method === 'POST')).toHaveLength(1);
    });

    it.each(['malformed', 'html', 'mismatched'] as const)('retains identity drafts after an unusable %s rejection without replay', async kind => {
        const {wrapper, context, request} = await mounted('/frontend-pilot/users/login', async req => {
            if (req.method === 'GET') return json(session);
            if (kind === 'html') return new Response('<html>Proxy error</html>', {status: 400,
                headers: {'Content-Type': 'text/html'}});
            if (kind === 'mismatched') return json({type: 'about:blank', title: 'Rejected', status: 400,
                detail: 'The credentials are invalid.', requestId: 'mismatched-rejection', code: 'INVALID_CREDENTIALS',
                messageKey: 'api:errors.INVALID_CREDENTIALS', params: {}}, 401);
            return json({status: 400, detail: 'Missing the common Problem contract'}, 400);
        });
        await wrapper.get('#username').setValue('Entered account');
        await wrapper.get('#password').setValue('Private password1');
        await wrapper.get('form').trigger('submit');
        await flushPromises();
        expect(context.epoch.value).toBe(0);
        expect(wrapper.get<HTMLInputElement>('#password').element.value).toBe('Private password1');
        expect(wrapper.text()).toContain(context.messages.value.t('state.unknownOutcome'));
        expect(wrapper.get('form button[type="submit"]').attributes('disabled')).toBeDefined();

        // A successful same-actor session read cannot prove that the original login
        // failed. The shared command must retain its uncertainty and mounted secrets.
        await wrapper.findAll('button').find(button => button.text() === 'Refresh')!.trigger('click');
        await flushPromises();
        expect(wrapper.get<HTMLInputElement>('#password').element.value).toBe('Private password1');
        expect(wrapper.get<HTMLInputElement>('#username').element.value).toBe('Entered account');
        expect(wrapper.get('form button[type="submit"]').attributes('disabled')).toBeDefined();
        expect(request.mock.calls.map(([req]) => req as Request).filter(req => req.method === 'POST')).toHaveLength(1);
    });

    it('preserves native secret clearing for a validated future rejection', async () => {
        const {wrapper, context, request} = await mounted('/frontend-pilot/users/login', async () => json({
            type: 'about:blank', title: 'New rejection', status: 400, detail: 'A safe future explanation.',
            requestId: 'future-rejection', code: 'FUTURE_CODE', messageKey: 'api:errors.FUTURE_CODE', params: {},
        }, 400));
        await wrapper.get('#username').setValue('Entered account');
        await wrapper.get('#password').setValue('Private password1');
        await wrapper.get('form').trigger('submit');
        await flushPromises();
        expect(wrapper.get<HTMLInputElement>('#password').element.value).toBe('');
        expect(wrapper.get<HTMLInputElement>('#username').element.value).toBe('Entered account');
        expect(wrapper.get('.alert-danger').text()).toBe('A safe future explanation.');
        expect(wrapper.text()).not.toContain(context.messages.value.t('state.unknownOutcome'));
        expect(wrapper.get('form button[type="submit"]').attributes('disabled')).toBeUndefined();
        expect(request.mock.calls.map(([req]) => req as Request).filter(req => req.method === 'POST')).toHaveLength(1);
    });

    it('shows a safe future temporary command explanation without releasing secrets or replaying login', async () => {
        const detail = '<em>The sign-in response is temporarily unavailable.</em>';
        const {wrapper, context, request} = await mounted('/frontend-pilot/users/login', async req => req.method === 'GET'
            ? json(session) : json({type: 'urn:future:temporary', title: 'Temporary response', status: 503,
                detail, requestId: 'future-login-503'}, 503));
        await wrapper.get('#username').setValue('Entered account');
        await wrapper.get('#password').setValue('Private password1');
        await wrapper.get('form').trigger('submit');
        await flushPromises();
        expect(wrapper.get('.alert-danger').text()).toBe(detail);
        expect(wrapper.find('.alert-danger em').exists()).toBe(false);
        expect(wrapper.text()).toContain(context.messages.value.t('state.unknownOutcome'));
        expect(wrapper.get<HTMLInputElement>('#password').element.value).toBe('Private password1');
        expect(wrapper.get('form button[type="submit"]').attributes('disabled')).toBeDefined();
        await wrapper.findAll('button').find(button => button.text() === context.messages.value.t('common.refresh'))!.trigger('click');
        await flushPromises();
        expect(wrapper.get<HTMLInputElement>('#username').element.value).toBe('Entered account');
        expect(wrapper.get<HTMLInputElement>('#password').element.value).toBe('Private password1');
        expect(wrapper.get('form button[type="submit"]').attributes('disabled')).toBeDefined();
        expect(request.mock.calls.map(([req]) => (req as Request).method)).toEqual(['POST', 'GET']);
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
        // Confirmed empty main regions omit their native toolbar. Each disclosed,
        // filtered hidden region still owns its independent form and saved URL.
        for (const [collection, expected] of [['participant', 'tent'], ['owner', 'equipment']] as const) {
            const main = wrapper.get(`[data-collection="${collection}"][data-region="main"]`);
            const hidden = wrapper.get(`[data-collection="${collection}"][data-region="hidden"]`);
            expect(main.find('form').exists()).toBe(false);
            expect(hidden.get<HTMLInputElement>('input[type="search"]').element.value).toBe(expected);
        }
        expect(router.currentRoute.value.query).toMatchObject({owner_hidden_q: 'equipment',
            owner_hidden_event: eventId, participant_hidden_q: 'tent', participant_hidden_open: '1'});
    });
});
