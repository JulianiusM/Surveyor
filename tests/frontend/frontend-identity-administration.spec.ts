// @vitest-environment happy-dom
import {apiCompatibility} from '../../.generated/api/v1/policy.mjs';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {mount} from '@vue/test-utils';
import {flushFrontendPromises as flushPromises} from '../keywords/frontendUiKeywords';
import {defineComponent} from 'vue';
import {createMemoryHistory, createRouter} from 'vue-router';
import {VueQueryPlugin} from '@tanstack/vue-query';
import I18NextVue from 'i18next-vue';
import {createFrontendContext, observeInitialDocument, frontendContextKey} from '../../src/frontend/app/context';
import ProfileAdministrationPage from '../../src/frontend/features/identity/ProfileAdministrationPage.vue';
import App from '../../src/frontend/app/App.vue';
import {identityAdministrationKeys} from '../../src/frontend/app/queryKeys';
import type {components} from '../../src/types/api/v1';

const profileId = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';
const session: components['schemas']['SessionView'] & {context: string; csrfToken: string} = {
    kind: 'account', context: 'profile-administration-context-1234567890', csrfToken: 'profile-administration-csrf-1234567890',
    deployment: {buildId: 'fixture', apiCompatibility}, locale: 'en',
    activeProfile: {id: profileId, name: 'Original profile'}, profiles: [{id: profileId, name: 'Original profile'}],
    loginUrl: '/users/login', logoutUrl: '/users/logout', shell: {version: 'fixture', imprintUrl: '/imprint',
        privacyPolicyUrl: '/privacy', localLoginEnabled: true, oidcEnabled: false, oidcName: 'Provider'},
};
const profile: components['schemas']['ProfileSettings'] = {id: profileId, name: 'Original profile', isDefault: true};
const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    document.body.innerHTML = '';
});

function json(value: unknown, status = 200, responseContext = session.context): Response {
    return new Response(JSON.stringify(value), {status, headers: {'Content-Type': 'application/json',
        'X-Surveyor-Context': responseContext}});
}

function rejected(status: 400 | 403): Response {
    return new Response(JSON.stringify({type: 'about:blank', title: 'Request rejected', status,
        code: status === 400 ? 'VALIDATION_FAILED' : 'FORBIDDEN',
        messageKey: status === 400 ? 'api:errors.VALIDATION_FAILED' : 'api:errors.FORBIDDEN',
        params: {}, detail: 'This request was rejected.', requestId: 'profile-rejection'}),
    {status, headers: {'Content-Type': 'application/problem+json', 'X-Surveyor-Context': session.context}});
}

/** Actual mounted reads, generated validators and identity completion; only HTTP is substituted. */
async function mounted(path: string, handler: (request: Request) => Promise<Response>,
                       entry: components['schemas']['PageEntryOutcome'] = {kind: 'render'}, initialSession = session,
                       withShell = false) {
    const request = vi.fn(function deliverRequest(input: RequestInfo | URL): Promise<Response> {
        const received = input as Request;
        // Identity completion legitimately rechecks admission under its newly captured actor.
        // Keep that response bound to the request instead of reviving the fixture's initial actor.
        return new URL(received.url).pathname === '/api/v1/profiles/entry'
            ? Promise.resolve(json(entry, 200, received.headers.get('X-Surveyor-Context') ?? initialSession.context)) : handler(received);
    });
    const context = createFrontendContext({session: initialSession}, true, request);
    context.hydrated.value = true;
    context.visible.value = true;
    const router = createRouter({history: createMemoryHistory(), routes: [
        {path: '/users/profile', component: ProfileAdministrationPage, meta: {profileMode: 'edit'}},
        {path: '/users/profile/manage', component: ProfileAdministrationPage, meta: {profileMode: 'manage'}},
        {path: '/users/profile/create', component: ProfileAdministrationPage, meta: {profileMode: 'create'}},
        {path: '/users/dashboard', component: defineComponent({template: '<p>Overview destination</p>'})},
        {path: '/users/login', component: defineComponent({template: '<p>Account login destination</p>'})},
    ]});
    const stopDocument = observeInitialDocument(context, router);
    await router.push(path);
    const wrapper = mount(withShell ? App : defineComponent({template: '<RouterView />'}), {attachTo: document.body, global: {
        plugins: [router, [VueQueryPlugin, {queryClient: context.queryClient}], [I18NextVue, {i18next: context.i18next}]],
        provide: {[frontendContextKey as symbol]: context},
    }});
    cleanups.push(async function disposeFixture() {
        context.epoch.value++;
        stopDocument();
        wrapper.unmount();
        await context.queryClient.cancelQueries();
        context.queryClient.clear();
    });
    await flushPromises();
    return {wrapper, context, router, request};
}

describe('profile administration consumers', () => {
    it.each(['edit', 'manage'] as const)('refreshes healthy profile %s data while retaining an unsaved name', async mode => {
        let current = {...profile};
        const path = mode === 'edit' ? '/users/profile' : '/users/profile/manage';
        const {wrapper, request} = await mounted(path, async () => json(mode === 'edit'
            ? current : {profiles: [current], activeProfileId: profileId}));
        const field = mode === 'edit' ? wrapper.get<HTMLInputElement>('#name') : null;
        if (field) await field.setValue('Keep my unsaved name');
        current = {...current, name: 'Remotely updated name'};
        const before = request.mock.calls.length;
        await wrapper.get('button[aria-label="Refresh"]').trigger('click');
        await flushPromises();

        expect(request.mock.calls).toHaveLength(before + 1);
        expect(request.mock.calls.every(([input]) => (input as Request).method === 'GET')).toBe(true);
        if (field) {
            expect(wrapper.get('#name').element).toBe(field.element);
            expect(field.element.value).toBe('Keep my unsaved name');
            expect(wrapper.text()).toContain('changed');
        } else expect(wrapper.text()).toContain(current.name);
    });

    it('confirms native fields before refreshing the same-route editor into a clean usable baseline', async () => {
        let current = {...profile};
        let currentSession = {...session};
        let body: unknown;
        let writes = 0;
        const {wrapper, context, request} = await mounted('/users/profile', async function serveProfile(input) {
            if (input.method === 'PATCH') {
                writes++;
                body = await input.json();
                current = {...profile, name: 'Renamed profile', isDefault: false};
                currentSession = {...session, activeProfile: {id: profileId, name: current.name}, profiles: [{id: profileId, name: current.name}]};
                return json({changed: true});
            }
            return json(new URL(input.url).pathname === '/api/v1/session' ? currentSession : current);
        });
        expect(wrapper.get<HTMLInputElement>('#name').element.value).toBe(profile.name);
        expect(context.pageTitle.value).toBe("Profile 'Original profile' | Surveyor");
        expect(wrapper.get('#name').attributes('maxlength')).toBeUndefined();
        await wrapper.get('#name').setValue('Renamed profile');
        await wrapper.get('#isDefault').setValue(false);
        await wrapper.get('form').trigger('submit');
        await flushPromises();
        expect(body).toEqual({name: 'Renamed profile', isDefault: false});
        expect(writes).toBe(1);
        expect(context.session.value?.activeProfile?.name).toBe('Renamed profile');
        expect(context.pageTitle.value).toBe("Profile 'Renamed profile' | Surveyor");
        expect(context.pageNotice.value?.messageKey).toBe('profile.profileUpdated');
        expect(wrapper.get<HTMLInputElement>('#name').element.value).toBe('Renamed profile');
        expect(wrapper.get<HTMLInputElement>('#isDefault').element.checked).toBe(false);
        expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeUndefined();
        expect(request.mock.calls.some(([input]) => (input as Request).method === 'PATCH'
            && (input as Request).headers.get('X-CSRF-Token') === session.csrfToken)).toBe(true);
    });

    it('preserves dirty text, checkbox, focus and node through locale changes and changed profile reads', async () => {
        let current = {...profile};
        const {wrapper, context} = await mounted('/users/profile', async function serveProfileRefresh(input) {
            return new URL(input.url).pathname === '/api/v1/locale' ? json({...session, locale: 'de'}) : json(current);
        });
        const input = wrapper.get<HTMLInputElement>('#name').element;
        await wrapper.get('#name').setValue('Unfinished local name');
        await wrapper.get('#isDefault').setValue(false);
        input.focus();
        input.setSelectionRange(3, 8);
        await context.changeLocale('de');
        await flushPromises();
        expect(context.pageTitle.value).toBe("Profil 'Original profile' | Surveyor");
        expect(wrapper.get('#name').element).toBe(input);
        expect(input.value).toBe('Unfinished local name');
        current = {...profile, name: 'Changed in another tab'};
        await context.queryClient.refetchQueries({queryKey: identityAdministrationKeys.current(session.context)});
        await flushPromises();
        expect(wrapper.get('#name').element).toBe(input);
        expect(input.value).toBe('Unfinished local name');
        expect(document.activeElement).toBe(input);
        expect([input.selectionStart, input.selectionEnd]).toEqual([3, 8]);
        expect(wrapper.get<HTMLInputElement>('#isDefault').element.checked).toBe(false);
        expect(wrapper.text()).toContain(context.messages.value.t('profile.remoteChanged'));
        const confirm = vi.fn(() => false);
        vi.stubGlobal('confirm', confirm);
        const reload = wrapper.findAll('button').find(button => button.text() === context.messages.value.t('profile.reloadSettings'))!;
        await reload.trigger('click');
        expect(input.value).toBe('Unfinished local name');
        confirm.mockReturnValue(true);
        await reload.trigger('click');
        expect(input.value).toBe('Changed in another tab');
    });

    it('retains confirmed creation through failed session display refresh and retries only reads/navigation', async () => {
        let writes = 0;
        let failSession = true;
        const roster = {profiles: [profile, {id: otherId, name: 'Created profile', isDefault: false}], activeProfileId: profileId};
        const refreshed = {...session, profiles: roster.profiles.map(owned => ({id: owned.id, name: owned.name}))};
        const {wrapper, context, router} = await mounted('/users/profile/create', async function serveConfirmedCreation(input) {
            if (input.method === 'POST') { writes++; return json({changed: true}); }
            if (new URL(input.url).pathname === '/api/v1/session') {
                if (failSession) throw new TypeError('Display read interrupted');
                return json(refreshed);
            }
            return json(roster);
        }, {kind: 'render'}, session, true);
        await wrapper.get('#name').setValue('Created profile');
        await wrapper.get('main form').trigger('submit');
        await flushPromises();
        expect(writes).toBe(1);
        expect(wrapper.get('[data-frontend-notices] .alert-warning').text()).toContain(context.messages.value.t('state.deliveryFailed'));
        expect(wrapper.find('.alert-success').exists()).toBe(false);
        expect(wrapper.text()).not.toContain(context.messages.value.t('state.unknownOutcome'));
        expect(context.readsReady.value).toBe(false);
        expect(wrapper.find('main button[type="submit"]').exists()).toBe(false);
        const retry = wrapper.get('[data-frontend-notices] .alert-warning button');
        expect(retry.attributes('disabled')).toBeUndefined();
        failSession = false;
        await retry.trigger('click');
        await flushPromises();
        expect(router.currentRoute.value.path).toBe('/users/profile/manage');
        expect(wrapper.text()).toContain('Created profile');
        expect(writes).toBe(1);
    });

    it('retires a confirmed display continuation when fresh session data selects another actor', async () => {
        let writes = 0;
        const changed = {...session, context: 'later-profile-administration-context-1234567890'};
        const {wrapper, context, router} = await mounted('/users/profile/create', async function serveRetiredActor(input) {
            if (input.method === 'POST') { writes++; return json({changed: true}); }
            return new URL(input.url).pathname === '/api/v1/session' ? json(changed, 200, changed.context)
                : json({profiles: [profile], activeProfileId: profileId}, 200, input.headers.get('X-Surveyor-Context') ?? session.context);
        });
        await wrapper.get('#name').setValue('Created before actor replacement');
        await wrapper.get('form').trigger('submit');
        await flushPromises();
        expect(context.session.value!.context).toBe(changed.context);
        expect(router.currentRoute.value.path).toBe('/users/profile/create');
        expect(wrapper.get<HTMLInputElement>('#name').element.value).toBe('');
        expect(wrapper.text()).not.toContain(context.messages.value.t('state.saved'));
        expect(writes).toBe(1);
    });

    it('disables confirmed delivery Retry through the session cooldown and wakes it at the server deadline', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(Date.UTC(2026, 9, 14, 21, 0, 0));
        let writes = 0;
        let reads = 0;
        let unavailable = true;
        const {wrapper, context, router} = await mounted('/users/profile/create', async function serveDeliveryCooldown(input) {
            if (input.method === 'POST') { writes++; return json({changed: true}); }
            if (new URL(input.url).pathname === '/api/v1/session') {
                reads++;
                return unavailable ? new Response(JSON.stringify({type: 'urn:future:session-read', title: 'Session unavailable',
                    status: 503, detail: 'Wait before reading the session again.', requestId: 'profile-session-cooldown'}),
                {status: 503, headers: {'Content-Type': 'application/problem+json', 'X-Surveyor-Context': session.context,
                    'Retry-After': '5'}}) : json(session);
            }
            return json({profiles: [profile], activeProfileId: profileId});
        }, {kind: 'render'}, session, true);
        await wrapper.get('#name').setValue('Confirmed profile');
        await wrapper.get('main form').trigger('submit');
        await flushPromises();
        const retry = wrapper.get('[data-frontend-notices] .alert-warning button');
        expect(retry.attributes('disabled')).toBeDefined();
        await retry.trigger('click');
        expect(reads).toBe(1);
        await vi.advanceTimersByTimeAsync(5001);
        await flushPromises();
        expect(retry.attributes('disabled')).toBeUndefined();
        unavailable = false;
        await retry.trigger('click');
        await flushPromises();
        expect(router.currentRoute.value.path).toBe('/users/profile/manage');
        expect(reads).toBe(2);
        expect(writes).toBe(1);
    });

    it('drains a session GET started before command confirmation and then requests fresh display data', async () => {
        let resolveOld!: (response: Response) => void;
        let resolveWrite!: (response: Response) => void;
        const oldRead = new Promise<Response>(resolve => { resolveOld = resolve; });
        const write = new Promise<Response>(resolve => { resolveWrite = resolve; });
        let sessionReads = 0;
        let current = {...profile};
        const updated = {...session, activeProfile: {id: profileId, name: 'After confirmed save'},
            profiles: [{id: profileId, name: 'After confirmed save'}]};
        const {wrapper, context} = await mounted('/users/profile', async function serveBootstrapRace(input) {
            if (input.method === 'PATCH') return write;
            if (new URL(input.url).pathname === '/api/v1/session') {
                sessionReads++;
                return sessionReads === 1 ? oldRead : json(updated);
            }
            return json(current);
        });
        await wrapper.get('#name').setValue('After confirmed save');
        await wrapper.get('form').trigger('submit');
        const earlierBootstrap = context.refreshSession();
        await flushPromises();
        current = {...profile, name: 'After confirmed save'};
        resolveWrite(json({changed: true}));
        await flushPromises();
        expect(sessionReads).toBe(1);
        resolveOld(json(session));
        await earlierBootstrap;
        await flushPromises();
        expect(sessionReads).toBe(2);
        expect(context.session.value!.activeProfile?.name).toBe('After confirmed save');
        expect(wrapper.get<HTMLInputElement>('#name').element.value).toBe('After confirmed save');
        expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeUndefined();
    });

    it('retains rejected creation input and keeps an unknown creation fenced after a successful read', async () => {
        let unknown = false;
        let writes = 0;
        const roster = {profiles: [profile], activeProfileId: profileId};
        const {wrapper, context} = await mounted('/users/profile/create', async function serveCreation(input) {
            if (input.method === 'POST') {
                writes++;
                if (unknown) throw new TypeError('Fixture lost the command response');
                return rejected(400);
            }
            return json(roster);
        });
        await wrapper.get('#name').setValue('New private profile');
        await wrapper.get('form').trigger('submit');
        await flushPromises();
        expect(wrapper.get<HTMLInputElement>('#name').element.value).toBe('New private profile');
        expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeUndefined();
        unknown = true;
        await wrapper.get('form').trigger('submit');
        await flushPromises();
        expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined();
        const refresh = wrapper.findAll('button').find(button => button.text() === context.messages.value.t('common.refresh'))!;
        await refresh.trigger('click');
        await flushPromises();
        await wrapper.get('form').trigger('submit');
        expect(writes).toBe(2);
        expect(wrapper.get<HTMLInputElement>('#name').element.value).toBe('New private profile');
        expect(wrapper.text()).toContain(context.messages.value.t('state.unknownOutcome'));
    });

    it('reuses profile switching and retires the previous private cache', async () => {
        const other = {id: otherId, name: 'Another profile', isDefault: false};
        let currentSession = {...session};
        let payload: unknown;
        const {wrapper, context, router} = await mounted('/users/profile/manage', async function serveSwitch(input) {
            if (input.method === 'PUT') {
                payload = await input.json();
                currentSession = {...session, context: 'switched-profile-context-1234567890',
                    activeProfile: {id: other.id, name: other.name},
                    profiles: [{id: profile.id, name: profile.name}, {id: other.id, name: other.name}]};
                return json({session: currentSession, personalLink: null, redirect: null}, 200, currentSession.context);
            }
            return new URL(input.url).pathname === '/api/v1/session' ? json(currentSession, 200, currentSession.context)
                : json({profiles: [profile, other], activeProfileId: currentSession.activeProfile!.id}, 200, currentSession.context);
        });
        context.queryClient.setQueryData(['private-old-profile'], 'Private old content');
        await wrapper.findAll('li')[1].get('button').trigger('click');
        await flushPromises();
        expect(payload).toEqual({profileId: otherId});
        expect(context.session.value?.activeProfile?.id).toBe(otherId);
        expect(context.queryClient.getQueryData(['private-old-profile'])).toBeUndefined();
        expect(router.currentRoute.value.path).toBe('/users/dashboard');
    });

    it('retires private form fields and cached projections after a validated denial', async () => {
        let denied = false;
        const {wrapper, context} = await mounted('/users/profile', async () => denied ? rejected(403) : json(profile));
        await wrapper.get('#name').setValue('Private unfinished name');
        denied = true;
        await context.queryClient.refetchQueries({queryKey: identityAdministrationKeys.current(session.context)});
        await flushPromises();
        expect(wrapper.find('form').exists()).toBe(false);
        expect(wrapper.text()).not.toContain('Private unfinished name');
        expect(context.queryClient.getQueryData(identityAdministrationKeys.current(session.context))).toBeUndefined();
    });

    it('starts a blank creation visit after accepted departure while canceled reuse preserves the edited profile', async () => {
        const {wrapper, router} = await mounted('/users/profile', async function serveReusedProfile(input) {
            return json(new URL(input.url).pathname.endsWith('/current') ? profile
                : {profiles: [profile], activeProfileId: profileId});
        });
        await wrapper.get('#name').setValue('Unfinished old profile');
        const confirm = vi.fn(() => false);
        vi.stubGlobal('confirm', confirm);
        await router.push('/users/profile/create');
        expect(router.currentRoute.value.path).toBe('/users/profile');
        expect(wrapper.get<HTMLInputElement>('#name').element.value).toBe('Unfinished old profile');
        confirm.mockReturnValue(true);
        await router.push('/users/profile/create');
        await flushPromises();
        expect(wrapper.get<HTMLInputElement>('#name').element.value).toBe('');
        expect(wrapper.find('#isDefault').exists()).toBe(false);
        expect(wrapper.get('button[type="submit"]').classes()).toContain('btn-primary');
    });

    it('follows account-only admission without requesting a private roster or retiring a valid guest', async () => {
        const guest = {...session, kind: 'guest' as const, context: 'guest-profile-administration-context-1234567890', profiles: []};
        const target = '/users/profile/manage';
        const destination = '/users/login?next=' + encodeURIComponent(target);
        const handler = vi.fn(async () => { throw new Error('Private roster must not be requested'); });
        const {context, router, request} = await mounted(target, handler,
            {kind: 'redirect', url: destination, notice: {kind: 'info', messageKey: 'auth.accountRequired'}}, guest);
        await flushPromises();
        expect(router.currentRoute.value.path).toBe('/users/login');
        expect(router.currentRoute.value.query.next).toBe(target);
        expect(context.session.value?.kind).toBe('guest');
        expect(context.ready.value).toBe(true);
        expect(handler).not.toHaveBeenCalled();
        expect(request.mock.calls.every(([input]) => new URL((input as Request).url).pathname === '/api/v1/profiles/entry')).toBe(true);
    });
});
