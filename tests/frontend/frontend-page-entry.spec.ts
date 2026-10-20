// @vitest-environment happy-dom
import {apiCompatibility} from '../../.generated/api/v1/policy.mjs';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {flushPromises, mount} from '@vue/test-utils';
import {defineComponent} from 'vue';
import type {Component} from 'vue';
import {createMemoryHistory, createRouter} from 'vue-router';
import {QueryObserver, VueQueryPlugin} from '@tanstack/vue-query';
import I18NextVue from 'i18next-vue';
import type {components} from '../../src/types/api/v1';
import type {FrontendPilotBootstrap} from '../../src/types/FrontendPilotTypes';
import {createPilotContext, observeInitialDocument, pilotContextKey} from '../../src/frontend/app/context';
import {packingKeys} from '../../src/frontend/app/queryKeys';
import PackingEntry from '../../src/frontend/features/packing/PackingEntry.vue';
import IdentityPage from '../../src/frontend/features/identity/IdentityPage.vue';
import App from '../../src/frontend/app/App.vue';
import {completePageEntry, navigatePageEntry, useConfirmedNavigation} from '../../src/frontend/composables/pageEntry';

const firstId = '11111111-1111-4111-8111-111111111111';
const secondId = '22222222-2222-4222-8222-222222222222';
const session: components['schemas']['SessionView'] & {context: string; csrfToken: string} = {
    kind: 'anonymous', deployment: {buildId: 'fixture', apiCompatibility},
    context: 'page-entry-context-1234567890', csrfToken: 'page-entry-csrf-1234567890', locale: 'en',
    activeProfile: null, profiles: [], loginUrl: '/users/login', logoutUrl: null,
    shell: {version: 'fixture', imprintUrl: '/imprint', privacyPolicyUrl: '/privacy', localLoginEnabled: true,
        oidcEnabled: false, oidcName: 'Provider'},
};
const cleanups: Array<() => Promise<void>> = [];
const privateList: components['schemas']['PackingListView'] = {
    entityType: 'packing', id: firstId, title: 'Confidential list', description: 'Protected description',
    headerUrl: null, headerVersion: null, orderToken: '"order"', currentEventId: null, currentEventUrl: null,
    archived: false, inheritedArchived: false,
    capabilities: {editTitle: false, editDescription: false, selfAssign: false, addItem: false,
        reorder: false, manageSettings: false},
    counters: {participants: 0, open: 0, empty: 0}, items: [],
};

function deferredResponse() {
    let resolveResponse!: (response: Response) => void;
    const response = new Promise<Response>(function captureResponse(resolve) { resolveResponse = resolve; });
    return {response, resolve: resolveResponse};
}

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
async function mounted(path: string, handler: (request: Request) => Promise<Response>, detailIsDestination = false,
                       initial: Omit<FrontendPilotBootstrap, 'session'> = {}) {
    const request = vi.fn((input: RequestInfo | URL) => handler(input as Request));
    const context = createPilotContext({...initial, session}, true, request);
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
    const stopInitialDocument = observeInitialDocument(context, router);
    const wrapper = mount(App, {attachTo: document.body, global: {
        plugins: [router, [VueQueryPlugin, {queryClient: context.queryClient}], [I18NextVue, {i18next: context.i18next}]],
        provide: {[pilotContextKey as symbol]: context},
    }});
    cleanups.push(async () => {
        wrapper.unmount();
        stopInitialDocument();
        await context.queryClient.cancelQueries();
        context.queryClient.clear();
    });
    await flushPromises();
    return {wrapper, context, router, request};
}

describe('server-owned page entry and canonical navigation', () => {
    it.each([400, 404])('keeps private cached locales retired after typed %s denial and admits only a fresh restoration', async status => {
        let denied = false;
        let holdEnglish = false;
        const heldEnglish = deferredResponse();
        const deniedEntry = {kind: 'denied' as const, status,
            messageKey: status === 400 ? 'packing.eventRegistrationRequired' : 'packing.notFound'};
        const {wrapper, context, request} = await mounted(`/frontend-pilot/packing/${firstId}`, async request => {
            const url = new URL(request.url);
            if (url.pathname === '/api/v1/locale') {
                const {locale} = await request.json();
                return json({...session, locale});
            }
            if (url.pathname.endsWith('/entry')) {
                if (holdEnglish && request.headers.get('X-Surveyor-Locale') === 'en') return heldEnglish.response;
                return json({entry: denied ? deniedEntry : {kind: 'render'}, guest: null});
            }
            // Keep the separate detail denial path out of the assertion: typed entry
            // admission must retire its old private DTO without that fallback firing.
            if (denied) return new Promise<Response>(function holdDetail() {});
            return json(privateList);
        }, false, {initialUrl: `/frontend-pilot/packing/${firstId}`, pageEntry: {kind: 'render'}});
        expect(wrapper.text()).toContain(privateList.title);
        const actor = session.context;
        const otherDetail = packingKeys.detail(actor, secondId);
        const copiedDuplicate = packingKeys.duplicate(actor, firstId);
        const admittedCopy = packingKeys.duplicate(actor, firstId, secondId);
        const publicGuest = packingKeys.guest(actor, firstId);
        context.queryClient.setQueryData(otherDetail, {data: {...privateList, id: secondId}});
        context.queryClient.setQueryData(copiedDuplicate, {title: 'Independent copied draft'});
        context.queryClient.setQueryData(admittedCopy, {title: 'Already admitted copy'});
        // An observed copy represents its independent creation owner. Missing source
        // retirement evicts only cold future admissions, never that owner's snapshot.
        const copyObserver = new QueryObserver(context.queryClient, {queryKey: admittedCopy, staleTime: Infinity,
            queryFn: async function readCopiedDraft() { return {title: 'Already admitted copy'}; }});
        const stopCopy = copyObserver.subscribe(function retainCopiedDraft() {});
        cleanups.push(async () => { stopCopy(); });
        context.queryClient.setQueryData(publicGuest, {id: firstId, title: 'Public guest title'});

        denied = true;
        await context.changeLocale('de');
        await flushPromises();
        expect(wrapper.text()).not.toContain(privateList.title);
        expect(wrapper.text()).not.toContain(privateList.description);
        expect(context.queryClient.getQueryData(packingKeys.detail(actor, firstId))).toBeUndefined();
        expect(context.queryClient.getQueryData(otherDetail)).toBeDefined();
        expect(context.queryClient.getQueryData(copiedDuplicate) !== undefined).toBe(status === 400);
        expect(context.queryClient.getQueryData(admittedCopy)).toBeDefined();
        expect(context.queryClient.getQueryData(publicGuest) !== undefined).toBe(status === 400);

        holdEnglish = true;
        const returning = context.changeLocale('en');
        await flushPromises();
        expect(context.locale.value).toBe('en');
        expect(wrapper.text()).not.toContain(privateList.title);
        expect(wrapper.findComponent(PackingEntry).find('table').exists()).toBe(false);
        heldEnglish.resolve(json({entry: deniedEntry, guest: null}));
        await returning;
        await flushPromises();

        denied = false;
        holdEnglish = false;
        await context.queryClient.invalidateQueries({queryKey: packingKeys.entry(actor, firstId, 'detail')});
        await flushPromises();
        expect(wrapper.text()).toContain(privateList.title);
        const reads = request.mock.calls.length;
        await context.changeLocale('de');
        await flushPromises();
        expect(request.mock.calls.length).toBeGreaterThan(reads);
        expect(wrapper.text()).toContain(privateList.title);
    });

    it('does not reseed the initial document when a reused resource wrapper returns after cache eviction', async () => {
        const path = `/frontend-pilot/packing/${firstId}/guest`;
        const heldReturn = deferredResponse();
        const {wrapper, context, router} = await mounted(path, async request => {
            return request.url.includes(firstId) ? heldReturn.response
                : json({entry: {kind: 'render'}, guest: {id: secondId, title: 'Second guest title'}});
        }, false, {initialUrl: path, pageEntry: {kind: 'render'}, guestEntry: {id: firstId, title: 'Initial guest title'}});
        expect(wrapper.text()).toContain('Initial guest title');
        await router.push(path + '#registration');
        expect(context.initialDocumentFor(path)).toBeDefined();
        await router.push(`/frontend-pilot/packing/${secondId}/guest`);
        await flushPromises();
        context.queryClient.removeQueries({queryKey: packingKeys.entry(session.context, firstId, 'guest')});
        await router.push(path);
        await flushPromises();
        expect(context.initialDocumentFor(path)).toBeUndefined();
        expect(wrapper.text()).not.toContain('Initial guest title');
        expect(wrapper.find('#guest-name').exists()).toBe(false);
        heldReturn.resolve(json({entry: {kind: 'denied', status: 404, messageKey: 'packing.notFound'}, guest: null}));
        await flushPromises();
        expect(wrapper.get('h1').text()).toBe('Error');
    });

    it('retains admitted input and read authority during native-style fragment movement', async () => {
        const path = `/frontend-pilot/packing/${firstId}/guest`;
        const {wrapper, router, request} = await mounted(path, async () => json({
            entry: {kind: 'render'}, guest: {id: firstId, title: 'Guest fixture'},
        }));
        const name = wrapper.get<HTMLInputElement>('#guest-name');
        await name.setValue('Unfinished guest name');
        name.element.focus();
        const reads = request.mock.calls.length;
        const confirm = vi.fn(() => false);
        vi.stubGlobal('confirm', confirm);
        await router.push(path + '#registration');
        await flushPromises();
        expect(router.currentRoute.value.hash).toBe('#registration');
        expect(wrapper.get('#guest-name').element).toBe(name.element);
        expect(name.element.value).toBe('Unfinished guest name');
        expect(document.activeElement).toBe(name.element);
        expect(request).toHaveBeenCalledTimes(reads);
        expect(confirm).not.toHaveBeenCalled();
    });

    it('does not revive expired document feedback after slow canonical delivery', async () => {
        const {context, router} = await mounted(`/frontend-pilot/packing/${firstId}/guest`, async () => json({
            entry: {kind: 'render'}, guest: {id: firstId, title: 'Guest fixture'},
        }));
        let finishDelivery!: (component: Component) => void;
        router.addRoute({path: '/frontend-pilot/slow-destination', component: function loadDestination() {
            return new Promise<Component>(resolve => { finishDelivery = resolve; });
        }});
        context.pageNotice.value = {kind: 'success', messageKey: 'auth.loginDone'};
        context.personalLink.value = 'https://fixture.test/guest/private-token';
        const delivery = navigatePageEntry(context, router,
            {kind: 'redirect', url: '/frontend-pilot/slow-destination', notice: null});
        await flushPromises();

        // Expiry or explicit dismissal belongs to the live owner while its current
        // document remains displayed. The later canonical redirect must respect it.
        context.pageNotice.value = null;
        context.personalLink.value = null;
        finishDelivery(defineComponent({template: '<p>Delivered destination</p>'}));
        expect(await delivery).toBe(true);
        expect(context.pageNotice.value).toBeNull();
        expect(context.personalLink.value).toBeNull();
    });

    it('retains a confirmed destination after lazy delivery fails and retries only navigation', async () => {
        const {context, router} = await mounted(`/frontend-pilot/packing/${firstId}/guest`, async () => json({
            entry: {kind: 'render'}, guest: {id: firstId, title: 'Guest fixture'},
        }));
        let completion!: ReturnType<typeof useConfirmedNavigation>;
        const ConfirmedOwner = defineComponent({template: '<p>Confirmed command</p>', setup() {
            completion = useConfirmedNavigation();
            return {};
        }});
        const Destination = defineComponent({template: '<p>Confirmed destination</p>'});
        let deliveries = 0;

        async function deliverDestination() {
            deliveries++;
            if (deliveries === 1) throw new Error('Failed to fetch dynamically imported module');
            return Destination;
        }

        router.addRoute({path: '/frontend-pilot/command-fixture', component: ConfirmedOwner});
        router.addRoute({path: '/frontend-pilot/confirmed-destination', component: deliverDestination});
        await router.push('/frontend-pilot/command-fixture');
        await flushPromises();
        const origin = router.currentRoute.value.fullPath;
        expect(await completion.navigate('/frontend-pilot/confirmed-destination', context.capture(), origin)).toBe(false);
        expect(completion.target.value).toBe('/frontend-pilot/confirmed-destination');
        expect(completion.pending.value).toBe(false);
        expect(router.currentRoute.value.fullPath).toBe(origin);

        await router.push(origin + '#confirmed-command');
        expect(completion.target.value).toBe('/frontend-pilot/confirmed-destination');

        const unload = new Event('beforeunload', {cancelable: true});
        window.dispatchEvent(unload);
        expect(unload.defaultPrevented).toBe(true);

        const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {});
        context.updates.observe({...session.deployment, buildId: 'replacement-fixture'});
        await flushPromises();
        expect(reload).not.toHaveBeenCalled();
        expect(context.updates.requestReload()).toBe(false);
        // Deliberate recovery must retain the confirmed destination's guard too.
        expect(context.updates.requestRecoveryReload()).toBe(false);
        // A caller cannot replace a confirmed receipt by attempting its command destination
        // again. The only recovery operation retained here is delivery of that first result.
        expect(await completion.navigate('/frontend-pilot/help')).toBe(false);
        expect(await completion.retry()).toBe(true);
        await flushPromises();
        expect(deliveries).toBe(2);
        expect(router.currentRoute.value.path).toBe('/frontend-pilot/confirmed-destination');
        expect(completion.target.value).toBeNull();
    });

    it('protects a pending confirmed destination and retires a cancelled receipt on another actor', async () => {
        const {context, router} = await mounted(`/frontend-pilot/packing/${firstId}/guest`, async () => json({
            entry: {kind: 'render'}, guest: {id: firstId, title: 'Guest fixture'},
        }));
        let completion!: ReturnType<typeof useConfirmedNavigation>;
        const ConfirmedOwner = defineComponent({template: '<p>Confirmed command</p>', setup() {
            completion = useConfirmedNavigation();
            return {};
        }});
        const Destination = defineComponent({template: '<p>Confirmed destination</p>'});
        let finishDelivery!: (page: typeof Destination) => void;
        const held = new Promise<typeof Destination>(resolve => { finishDelivery = resolve; });

        function deliverDestination() {
            return held;
        }

        router.addRoute({path: '/frontend-pilot/command-fixture', component: ConfirmedOwner});
        router.addRoute({path: '/frontend-pilot/confirmed-destination', component: deliverDestination});
        await router.push('/frontend-pilot/command-fixture');
        await flushPromises();
        const origin = router.currentRoute.value.fullPath;
        const navigation = completion.navigate('/frontend-pilot/confirmed-destination');
        await flushPromises();
        expect(completion.pending.value).toBe(true);
        expect(context.mayChangeIdentity()).toBe(false);
        expect(await completion.retry()).toBe(false);
        await router.push('/frontend-pilot/help');
        expect(router.currentRoute.value.fullPath).toBe(origin);
        context.locale.value = 'de';
        finishDelivery(Destination);
        // The competing aborted navigation supersedes the first router attempt. Its
        // confirmed receipt stays reachable; Retry still navigates and never writes.
        expect(await navigation).toBe(false);
        expect(completion.target.value).toBe('/frontend-pilot/confirmed-destination');
        context.session.value = {...session, context: 'superseding-context-1234567890'};
        await flushPromises();
        expect(completion.target.value).toBeNull();
        expect(await completion.retry()).toBe(false);
        expect(router.currentRoute.value.fullPath).toBe(origin);
    });

    it('shows a retained delivery Retry only in the same-type instance that confirmed its command', async () => {
        const {router, wrapper} = await mounted(`/frontend-pilot/packing/${firstId}/guest`, async () => json({
            entry: {kind: 'render'}, guest: {id: firstId, title: 'Guest fixture'},
        }));
        const ConfirmedOwner = defineComponent({
            props: {identity: {type: String, required: true}},
            template: '<section><button @click="complete">Confirm command</button><p v-if="completion.target.value">Retry confirmed delivery</p></section>',
            setup(props) {
                const completion = useConfirmedNavigation(props.identity);
                function complete(): Promise<boolean> { return completion.navigate('/frontend-pilot/help'); }
                return {completion, complete};
            },
        });
        const SameTypeOwners = defineComponent({components: {ConfirmedOwner},
            template: '<div><ConfirmedOwner identity="first" /><ConfirmedOwner identity="second" /></div>'});
        router.addRoute({path: '/frontend-pilot/parallel-command-fixture', component: SameTypeOwners});
        await router.push('/frontend-pilot/parallel-command-fixture');
        await flushPromises();
        const cancelDelivery = router.beforeEach(to => to.path === '/frontend-pilot/help' ? false : undefined);
        try {
            const owners = wrapper.findAllComponents(ConfirmedOwner);
            await owners[0]!.get('button').trigger('click');
            await flushPromises();
            expect(owners[0]!.text()).toContain('Retry confirmed delivery');
            expect(owners[1]!.text()).not.toContain('Retry confirmed delivery');
        } finally { cancelDelivery(); }
    });

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

    it.each([false, true])('admits a guest registration after its held advisory read only while the form remains mounted (retired=%s)',
        async function heldGuestAdvisoryRead(retireForm) {
            const path = `/frontend-pilot/packing/${firstId}/guest`;
            const heldLookup = deferredResponse();
            let denied = false;
            let registrations = 0;
            const {wrapper, context, router, request} = await mounted(path, async function readGuestAdmission(input) {
                const pathname = new URL(input.url).pathname;
                if (pathname === '/api/v1/auth/guest-email-exists') return heldLookup.response;
                if (input.method === 'POST' && pathname.endsWith('/guest')) {
                    registrations++;
                    if (denied) throw new TypeError('Fixture stale registration response lost');
                    // A confirmed validation rejection isolates dispatch admission
                    // from the identity-completion journeys covered below.
                    return json({type: 'about:blank', title: 'Rejected', status: 400, detail: 'Fixture input rejected.',
                        requestId: 'delayed-guest-rejection', code: 'VALIDATION_FAILED', messageKey: 'api:errors.VALIDATION_FAILED', params: {}}, 400);
                }
                if (pathname === '/api/v1/session') return json(session);
                return json({entry: denied ? {kind: 'denied', status: 404, messageKey: 'packing.notFound'} : {kind: 'render'},
                    guest: denied ? null : {id: firstId, title: 'Guest advisory fixture'}});
            }, true);
            const acceptIdentity = vi.spyOn(context, 'acceptIdentity');
            const confirm = vi.fn(() => false);
            vi.stubGlobal('confirm', confirm);

            // The mounted submit has started only its advisory email lookup. No
            // registration command is admitted until that preliminary read finishes.
            await wrapper.get('#guest-name').setValue('Delayed guest');
            await wrapper.get('#guest-email').setValue('delayed@example.test');
            await wrapper.get('main form').trigger('submit');
            await flushPromises();
            expect(registrations).toBe(0);
            expect(request.mock.calls.filter(([input]) => new URL((input as Request).url).pathname === '/api/v1/auth/guest-email-exists'))
                .toHaveLength(1);
            const actor = context.capture();

            if (retireForm) {
                // A same-actor authoritative 404 closes the form independently of
                // ordinary departure guards while the external lookup is still held.
                denied = true;
                await context.queryClient.refetchQueries({queryKey: packingKeys.entry(session.context, firstId, 'guest')});
                await flushPromises();
                expect(wrapper.find('#guest-name').exists()).toBe(false);
                expect(wrapper.get('h1').text()).toBe('Error');
                expect(context.isCurrent(actor)).toBe(true);
                expect(router.currentRoute.value.fullPath).toBe(path);
            }

            // The exact same delayed read remains compatible with a live form. If
            // admission retired it instead, its continuation cannot start a new POST.
            heldLookup.resolve(json({exists: false}));
            await flushPromises();
            if (retireForm) {
                expect(registrations).toBe(0);
                expect(acceptIdentity).not.toHaveBeenCalled();
                expect(context.personalLink.value).toBeNull();
                expect(context.pageCompletion.value).toBeNull();
                expect(wrapper.find('#guest-name').exists()).toBe(false);
                expect(wrapper.text()).not.toContain(context.messages.value.t('state.unknownOutcome'));
                expect(wrapper.text()).not.toContain(context.messages.value.t('auth.unconfirmedRequest'));
                expect(context.mayChangeIdentity()).toBe(true);
                const unload = new Event('beforeunload', {cancelable: true});
                window.dispatchEvent(unload);
                expect(unload.defaultPrevented).toBe(false);
                expect(confirm).not.toHaveBeenCalled();
                expect(router.currentRoute.value.fullPath).toBe(path);
            } else {
                expect(registrations).toBe(1);
                expect(acceptIdentity).not.toHaveBeenCalled();
                expect(wrapper.find('#guest-name').exists()).toBe(true);
                expect(wrapper.get<HTMLInputElement>('#guest-name').element.value).toBe('Delayed guest');
                expect(wrapper.text()).not.toContain(context.messages.value.t('state.unknownOutcome'));
                expect(router.currentRoute.value.fullPath).toBe(path);
            }
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
        await wrapper.get('main form').trigger('submit');
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
        await wrapper.get('main form').trigger('submit');
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
