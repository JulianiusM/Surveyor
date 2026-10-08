// @vitest-environment happy-dom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {flushPromises, mount} from '@vue/test-utils';
import {defineComponent} from 'vue';
import {createMemoryHistory, createRouter} from 'vue-router';
import {VueQueryPlugin} from '@tanstack/vue-query';
import I18NextVue from 'i18next-vue';
import type {components} from '../../src/types/api/v1';
import {createPilotContext, pilotContextKey} from '../../src/frontend/app/context';
import PackingEntry from '../../src/frontend/features/packing/PackingEntry.vue';
import IdentityPage from '../../src/frontend/features/identity/IdentityPage.vue';
import App from '../../src/frontend/app/App.vue';
import {completePageEntry, navigatePageEntry} from '../../src/frontend/composables/pageEntry';

const firstId = '11111111-1111-4111-8111-111111111111';
const secondId = '22222222-2222-4222-8222-222222222222';
const session: components['schemas']['SessionView'] = {
    kind: 'anonymous', deployment: {buildId: 'fixture', apiCompatibility: 'v1-pilot-2026-10-07'},
    context: 'page-entry-context-1234567890', csrfToken: 'page-entry-csrf-1234567890', locale: 'en',
    activeProfile: null, profiles: [], loginUrl: '/users/login', logoutUrl: '/users/logout',
    shell: {version: 'fixture', imprintUrl: '/imprint', privacyPolicyUrl: '/privacy', localLoginEnabled: true,
        oidcEnabled: false, oidcName: 'Provider'},
};
const cleanups: Array<() => Promise<void>> = [];

function json(value: unknown, status = 200, responseContext = session.context): Response {
    return new Response(JSON.stringify(value), {status, headers: {'Content-Type': 'application/json',
        'X-Surveyor-Context': responseContext}});
}

afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
});

/** The production wrapper, generated response validators, query owner and real router remain
 * intact. Only HTTP delivery is replaced; fixtures carry server-owned entry decisions. */
async function mounted(path: string, handler: (request: Request) => Promise<Response>, detailIsDestination = false) {
    const request = vi.fn((input: RequestInfo | URL) => handler(input as Request));
    const context = createPilotContext({session}, true, request);
    context.hydrated.value = true;
    const Destination = defineComponent({template: '<p>Admitted destination</p>'});
    const router = createRouter({history: createMemoryHistory(), routes: [
        {path: '/frontend-pilot/packing/:listId/guest', component: PackingEntry},
        {path: '/frontend-pilot/packing/:listId/duplicate', component: Destination},
        {path: '/frontend-pilot/packing/:listId', component: detailIsDestination ? Destination : PackingEntry},
        {path: '/frontend-pilot/users/login', component: IdentityPage, meta: {identityMode: 'login'}},
        {path: '/frontend-pilot/users/register', component: Destination},
        {path: '/frontend-pilot/guest/recovery', component: IdentityPage, meta: {identityMode: 'recovery'}},
        {path: '/frontend-pilot/help', component: Destination},
        {path: '/frontend-pilot', component: Destination},
    ]});
    await router.push(path);
    await router.isReady();
    const wrapper = mount(App, {attachTo: document.body, global: {
        plugins: [router, [VueQueryPlugin, {queryClient: context.queryClient}], [I18NextVue, {i18next: context.i18next}]],
        provide: {[pilotContextKey as symbol]: context},
    }});
    cleanups.push(async () => {
        wrapper.unmount();
        await context.queryClient.cancelQueries();
        context.queryClient.clear();
    });
    await flushPromises();
    return {wrapper, context, router, request};
}

describe('server-owned page entry and canonical navigation', () => {
    it('redirects standalone anonymous detail to its canonical guest form, with the real title', async () => {
        const path = `/frontend-pilot/packing/${firstId}`;
        const {wrapper, router, request} = await mounted(path, async request => {
            const query = new URL(request.url).searchParams;
            return json(query.get('view') === 'detail'
                ? {entry: {kind: 'redirect', url: path + '/guest', notice: null}, guest: null}
                : {entry: {kind: 'render'}, guest: {id: firstId, title: 'Public guest title'}});
        });
        await flushPromises();
        expect(router.currentRoute.value.path).toBe(path + '/guest');
        expect(wrapper.get('h1').text()).toContain('Public guest title');
        expect(wrapper.find('#guest-name').exists()).toBe(true);
        expect(request.mock.calls.map(([input]) => new URL((input as Request).url).searchParams.get('view')))
            .toEqual(['detail', 'guest']);
    });

    it('renders attached anonymous denial without substituting guest registration', async () => {
        const {wrapper, router} = await mounted(`/frontend-pilot/packing/${firstId}`, async () => json({
            entry: {kind: 'denied', status: 400, messageKey: 'packing.eventRegistrationRequired'}, guest: null,
        }));
        expect(router.currentRoute.value.path).toBe(`/frontend-pilot/packing/${firstId}`);
        expect(wrapper.get('h1').text()).toBe('Error');
        expect(wrapper.find('#guest-name').exists()).toBe(false);
        expect(wrapper.find('[data-loading-skeleton]').exists()).toBe(false);
    });

    it('replaces an explicit guest URL with the admitted detail instead of swapping content under /guest', async () => {
        const path = `/frontend-pilot/packing/${firstId}`;
        const {wrapper, router} = await mounted(path + '/guest', async () => json({
            entry: {kind: 'redirect', url: path, notice: null}, guest: null,
        }), true);
        expect(router.currentRoute.value.path).toBe(path);
        expect(wrapper.text()).toContain('Admitted destination');
        expect(wrapper.find('#guest-name').exists()).toBe(false);
    });

    it('does not let a late retired-resource redirect replace the next page', async () => {
        let finishRead!: (response: Response) => void;
        const held = new Promise<Response>(resolve => { finishRead = resolve; });
        const {wrapper, router} = await mounted(`/frontend-pilot/packing/${firstId}`, async () => held);
        await router.push('/frontend-pilot/help');
        finishRead(json({entry: {kind: 'redirect', url: `/frontend-pilot/packing/${firstId}/guest`, notice: null}, guest: null}));
        await flushPromises();
        expect(router.currentRoute.value.path).toBe('/frontend-pilot/help');
        expect(wrapper.text()).toContain('Admitted destination');
    });

    it('retires the prior resource projection when the same wrapper receives another identifier', async () => {
        let finishSecond!: (response: Response) => void;
        const held = new Promise<Response>(resolve => { finishSecond = resolve; });
        const {wrapper, router} = await mounted(`/frontend-pilot/packing/${firstId}/guest`, async request => {
            return request.url.includes(secondId) ? held
                : json({entry: {kind: 'render'}, guest: {id: firstId, title: 'First public title'}});
        });
        expect(wrapper.text()).toContain('First public title');
        await router.push(`/frontend-pilot/packing/${secondId}/guest`);
        await flushPromises();
        expect(wrapper.text()).not.toContain('First public title');
        expect(wrapper.find('#guest-name').exists()).toBe(false);
        finishSecond(json({entry: {kind: 'render'}, guest: {id: secondId, title: 'Second public title'}}));
        await flushPromises();
        expect(wrapper.text()).toContain('Second public title');
    });

    it('keeps the admitted guest draft and focus mounted during a slower same-resource locale admission read', async () => {
        let finishLocale!: (response: Response) => void;
        const held = new Promise<Response>(resolve => { finishLocale = resolve; });
        const fixture = {entry: {kind: 'render'}, guest: {id: firstId, title: 'Shared guest title'}};
        const {wrapper, context} = await mounted(`/frontend-pilot/packing/${firstId}/guest`, async request => {
            return request.headers.get('X-Surveyor-Locale') === 'de' ? held : json(fixture);
        });
        const input = wrapper.get<HTMLInputElement>('#guest-name');
        await input.setValue('Unsent guest name');
        input.element.focus();
        context.locale.value = 'de';
        await flushPromises();
        expect(wrapper.get<HTMLInputElement>('#guest-name').element).toBe(input.element);
        expect(input.element.value).toBe('Unsent guest name');
        expect(document.activeElement).toBe(input.element);
        finishLocale(json(fixture));
        await flushPromises();
        expect(wrapper.get<HTMLInputElement>('#guest-name').element).toBe(input.element);
        expect(document.activeElement).toBe(input.element);
    });

    it('shows a typed one-time redirect notice on its destination and removes it only on the next committed visit', async () => {
        const returnPath = `/frontend-pilot/packing/${firstId}/duplicate`;
        const {wrapper, context, router} = await mounted(`/frontend-pilot/packing/${firstId}`, async () => json({
            entry: {kind: 'redirect', url: '/frontend-pilot/users/login?next=' + encodeURIComponent(returnPath),
                notice: {kind: 'info', messageKey: 'auth.accountRequired'}}, guest: null,
        }));
        expect(router.currentRoute.value.path).toBe('/frontend-pilot/users/login');
        expect(router.currentRoute.value.query.next).toBe(returnPath);
        expect(context.pageNotice.value?.kind).toBe('info');
        expect(wrapper.find('.alert-info').exists()).toBe(true);
        await router.push('/frontend-pilot/help');
        await flushPromises();
        expect(context.pageNotice.value).toBeNull();
        expect(wrapper.find('.alert-info').exists()).toBe(false);
    });

    it('retains the current draft and notice when its guard cancels an admission redirect', async () => {
        const path = `/frontend-pilot/packing/${firstId}/guest`;
        const {wrapper, context, router} = await mounted(path, async () => json({
            entry: {kind: 'render'}, guest: {id: firstId, title: 'Public guest title'},
        }));
        await wrapper.get('#guest-name').setValue('Unsent guest name');
        const earlierNotice: components['schemas']['EntryNotice'] = {
            kind: 'success', messageKey: 'auth.recoverySent',
        };
        context.pageNotice.value = earlierNotice;
        const confirm = vi.fn(() => false);
        vi.stubGlobal('confirm', confirm);
        const decision: components['schemas']['PageEntryOutcome'] = {
            kind: 'redirect', url: '/frontend-pilot/users/login',
            notice: {kind: 'info', messageKey: 'auth.accountRequired'},
        };

        expect(await navigatePageEntry(context, router, decision, context.capture(), path)).toBe(false);
        expect(router.currentRoute.value.fullPath).toBe(path);
        expect(wrapper.get<HTMLInputElement>('#guest-name').element.value).toBe('Unsent guest name');
        expect(context.pageNotice.value).toEqual(earlierNotice);
        expect(confirm).toHaveBeenCalledOnce();

        confirm.mockReturnValue(true);
        expect(await navigatePageEntry(context, router, decision, context.capture(), path)).toBe(true);
        expect(router.currentRoute.value.fullPath).toBe('/frontend-pilot/users/login');
        expect(context.pageNotice.value).toEqual(decision.notice);
        expect(confirm).toHaveBeenCalledTimes(2);
    });

    it('keeps a dirty admitted guest subtree through a canceled server-read redirect and retires it on denial', async () => {
        const path = `/frontend-pilot/packing/${firstId}/guest`;
        let decision: 'render' | 'redirect' | 'denied' = 'render';
        const guest = {id: firstId, title: 'Public guest title'};
        const {wrapper, context, router} = await mounted(path, async request => {
            if (!new URL(request.url).pathname.endsWith('/entry')) return json(guest);
            if (decision === 'redirect') return json({entry: {kind: 'redirect',
                url: '/frontend-pilot/users/login', notice: {kind: 'info', messageKey: 'auth.accountRequired'}}, guest: null});
            if (decision === 'denied') return json({entry: {kind: 'denied', status: 400,
                messageKey: 'packing.eventRegistrationRequired'}, guest: null});
            return json({entry: {kind: 'render'}, guest});
        });
        const input = wrapper.get<HTMLInputElement>('#guest-name');
        await input.setValue('Draft entered before admission changed');
        input.element.focus();
        const confirm = vi.fn(() => false);
        vi.stubGlobal('confirm', confirm);

        // Exercise the actual query response and wrapper update, not a direct navigator.
        // The child must still own its guard when the new server redirect reaches the router.
        decision = 'redirect';
        await context.queryClient.invalidateQueries();
        await flushPromises();
        expect(confirm).toHaveBeenCalledOnce();
        expect(router.currentRoute.value.fullPath).toBe(path);
        expect(wrapper.get<HTMLInputElement>('#guest-name').element).toBe(input.element);
        expect(input.element.value).toBe('Draft entered before admission changed');
        expect(document.activeElement).toBe(input.element);
        expect(context.pageNotice.value).toBeNull();

        // An authoritative denial does not ask permission to retire private controls.
        decision = 'denied';
        await context.queryClient.invalidateQueries();
        await flushPromises();
        expect(wrapper.find('#guest-name').exists()).toBe(false);
        expect(wrapper.get('h1').text()).toBe('Error');
        expect(confirm).toHaveBeenCalledOnce();
    });

    it('recovers a confirmed guest identity and its private link through Retry without replaying registration', async () => {
        const path = `/frontend-pilot/packing/${firstId}`;
        const personalLink = 'https://example.test/guest/edit/confirmed-token';
        const guest = {...session, kind: 'guest' as const, context: 'confirmed-guest-context-1234567890'};
        let registered = false;
        let bootstrapAttempts = 0;
        let registrations = 0;
        const {wrapper, context, router} = await mounted(path + '/guest', async request => {
            const url = new URL(request.url);
            if (request.method === 'POST') {
                registrations++;
                registered = true;
                return json({session: guest, personalLink, redirect: null}, 200, guest.context);
            }
            if (url.pathname === '/api/v1/session') {
                bootstrapAttempts++;
                return bootstrapAttempts === 1 ? new Response(null, {status: 503}) : json(guest, 200, guest.context);
            }
            return registered
                ? json({entry: {kind: 'redirect', url: path, notice: null}, guest: null}, 200, guest.context)
                : json({entry: {kind: 'render'}, guest: {id: firstId, title: 'Public guest title'}});
        }, true);
        await wrapper.get('#guest-name').setValue('Confirmed guest');
        await wrapper.get('form[action$="/guest"]').trigger('submit');
        await flushPromises();
        expect(context.ready.value).toBe(false);
        expect(context.personalLink.value).toBeNull();
        expect(registrations).toBe(1);

        // Retry belongs to the closed session shell. It only bootstraps the confirmed
        // actor; resource admission then follows the ordinary generic canonical redirect.
        const retry = wrapper.findAll('button').find(button => button.text() === context.messages.value.t('common.retry'))!;
        await retry.trigger('click');
        await flushPromises();
        expect(context.ready.value).toBe(true);
        expect(context.personalLink.value).toBe(personalLink);
        expect(wrapper.text()).toContain(personalLink);
        expect(router.currentRoute.value.path).toBe(path);
        expect(registrations).toBe(1);
        expect(bootstrapAttempts).toBe(2);
    });

    it('rolls back a cancelled completion receipt and retains an accepted one only at its message destination', async () => {
        const path = `/frontend-pilot/packing/${firstId}/guest`;
        const destination = '/frontend-pilot/guest/recovery';
        const {wrapper, context, router} = await mounted(path, async () => json({
            entry: {kind: 'render'}, guest: {id: firstId, title: 'Public guest title'},
        }));
        await wrapper.get('#guest-name').setValue('Unsent guest name');
        const previous = {context: session.context, destination: path,
            messageKey: 'auth.recoverySent' as const, kind: 'success' as const};
        context.pageCompletion.value = previous;
        const confirm = vi.fn(() => false);
        vi.stubGlobal('confirm', confirm);

        expect(await completePageEntry(context, router, destination, 'auth.recoverySent', 'success', context.capture(), path)).toBe(false);
        expect(context.pageCompletion.value).toEqual(previous);
        expect(wrapper.get<HTMLInputElement>('#guest-name').element.value).toBe('Unsent guest name');
        confirm.mockReturnValue(true);
        expect(await completePageEntry(context, router, destination, 'auth.recoverySent', 'success', context.capture(), path)).toBe(true);
        await flushPromises();
        expect(router.currentRoute.value.fullPath).toBe(destination);
        expect(wrapper.get('h1').text()).toBe('Success');
        expect(context.pageCompletion.value?.destination).toBe(destination);

        await router.push('/frontend-pilot/help');
        await flushPromises();
        expect(context.pageCompletion.value).toBeNull();
    });

    it('keeps a confirmed message mounted when the next lazy destination fails before commitment', async () => {
        const origin = `/frontend-pilot/packing/${firstId}/guest`;
        const destination = '/frontend-pilot/guest/recovery';
        const {wrapper, context, router} = await mounted(origin, async () => json({
            entry: {kind: 'render'}, guest: {id: firstId, title: 'Public guest title'},
        }));
        expect(await completePageEntry(context, router, destination, 'auth.recoverySent', 'success')).toBe(true);
        router.addRoute({path: '/frontend-pilot/unavailable', component: unavailablePage});

        async function unavailablePage(): Promise<never> {
            throw new Error('Failed to fetch dynamically imported module');
        }
        await expect(router.push('/frontend-pilot/unavailable')).rejects.toThrow('Failed to fetch dynamically imported module');
        await flushPromises();
        expect(router.currentRoute.value.fullPath).toBe(destination);
        expect(context.pageCompletion.value?.destination).toBe(destination);
        expect(wrapper.get('h1').text()).toBe('Success');
        expect(wrapper.find('.pilot-navigation-loading').exists()).toBe(false);
    });

    it.each([false, true])('retains confirmed completion across a locale change before or during lazy navigation (before=%s)', async before => {
        const origin = `/frontend-pilot/packing/${firstId}/guest`;
        const destination = '/frontend-pilot/completion-fixture';
        const {context, router} = await mounted(origin, async () => json({
            entry: {kind: 'render'}, guest: {id: firstId, title: 'Public guest title'},
        }));
        const destinationPage = defineComponent({template: '<p>Completed destination</p>'});
        let finishPage!: (page: typeof destinationPage) => void;
        const heldPage = new Promise<typeof destinationPage>(resolve => { finishPage = resolve; });
        router.addRoute({path: destination, component: readDelayedPage});

        function readDelayedPage(): Promise<typeof destinationPage> {
            return heldPage;
        }
        const submittedScope = context.capture();
        if (before) context.locale.value = 'de';
        const navigation = completePageEntry(context, router, destination, 'auth.recoverySent', 'success', submittedScope, origin);
        await flushPromises();
        expect(router.currentRoute.value.fullPath).toBe(origin);
        if (!before) context.locale.value = 'de';
        finishPage(destinationPage);

        expect(await navigation).toBe(true);
        expect(router.currentRoute.value.fullPath).toBe(destination);
        expect(context.pageCompletion.value).toEqual({context: session.context, destination,
            messageKey: 'auth.recoverySent', kind: 'success'});
    });

    it.each([false, true])('resumes only the matching confirmed account destination after bootstrap Retry (mismatch=%s)', async mismatch => {
        const destination = `/frontend-pilot/packing/${firstId}/duplicate?eventId=${secondId}`;
        const path = '/frontend-pilot/users/login?next=' + encodeURIComponent(destination);
        const account = {...session, kind: 'account' as const, context: 'confirmed-account-context-1234567890',
            activeProfile: {id: firstId, name: 'Organizer'}, profiles: [{id: firstId, name: 'Organizer'}]};
        const recoveredActor = mismatch ? {...account, context: 'different-account-context-1234567890'} : account;
        let bootstrapAttempts = 0;
        let signIns = 0;
        const {wrapper, context, router} = await mounted(path, async request => {
            if (request.method === 'POST') {
                signIns++;
                return json({session: account, personalLink: null, redirect: null}, 200, account.context);
            }
            bootstrapAttempts++;
            return bootstrapAttempts === 1 ? new Response(null, {status: 503})
                : json(recoveredActor, 200, recoveredActor.context);
        });
        await wrapper.get('#username').setValue('Account');
        await wrapper.get('#password').setValue('password1');
        await wrapper.get('form[action="/frontend-pilot/users/login"]').trigger('submit');
        await flushPromises();
        expect(context.ready.value).toBe(false);

        const retry = wrapper.findAll('button').find(button => button.text() === context.messages.value.t('common.retry'))!;
        await retry.trigger('click');
        await flushPromises();
        expect(context.ready.value).toBe(true);
        expect(router.currentRoute.value.fullPath).toBe(mismatch ? path : destination);
        expect(signIns).toBe(1);
        expect(bootstrapAttempts).toBe(2);
    });
});
