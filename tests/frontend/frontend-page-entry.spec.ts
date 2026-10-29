// @vitest-environment happy-dom
import {apiCompatibility} from '../../.generated/api/v1/policy.mjs';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {mount} from '@vue/test-utils';
import {flushFrontendPromises as flushPromises} from '../keywords/frontendUiKeywords';
import {computed, defineComponent, ref} from 'vue';
import type {Component} from 'vue';
import {createMemoryHistory, createRouter} from 'vue-router';
import {QueryObserver, VueQueryPlugin} from '@tanstack/vue-query';
import I18NextVue from 'i18next-vue';
import type {components} from '../../src/types/api/v1';
import type {FrontendBootstrap} from '../../src/types/FrontendTypes';
import {createFrontendContext, observeInitialDocument, frontendContextKey} from '../../src/frontend/app/context';
import {packingKeys} from '../../src/frontend/app/queryKeys';
import PackingEntry from '../../src/frontend/features/packing/PackingEntry.vue';
import IdentityPage from '../../src/frontend/features/identity/IdentityPage.vue';
import App from '../../src/frontend/app/App.vue';
import {completePageEntry, navigatePageEntry, useConfirmedNavigation, usePageEntry} from '../../src/frontend/composables/pageEntry';

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
    vi.useRealTimers();
    document.body.innerHTML = '';
});

/** The production wrapper, generated response validators, query owner and real router remain
 * intact. Only HTTP delivery is replaced; fixtures carry server-owned entry decisions. */
async function mounted(path: string, handler: (request: Request) => Promise<Response>, detailIsDestination = false,
    initial: Omit<FrontendBootstrap, 'session'> = {}) {
    const request = vi.fn((input: RequestInfo | URL) => handler(input as Request));
    const context = createFrontendContext({...initial, session}, true, request);
    context.hydrated.value = true;
    const Destination = defineComponent({template: '<p>Admitted destination</p>'});
    const router = createRouter({history: createMemoryHistory(), routes: [
            {path: '/packing/:listId/guest', component: PackingEntry},
            {path: '/packing/:listId/duplicate', component: Destination},
            {path: '/packing/:listId', component: detailIsDestination ? Destination : PackingEntry},
            {path: '/users/login', component: IdentityPage, meta: {identityMode: 'login'}},
            {path: '/users/register', component: Destination},
            {path: '/guest/recovery', component: IdentityPage, meta: {identityMode: 'recovery'}},
            {path: '/help', component: Destination},
            {path: '/', component: Destination},
        ]});
    await router.push(path);
    await router.isReady();
    const stopInitialDocument = observeInitialDocument(context, router);
    const wrapper = mount(App, {attachTo: document.body, global: {
            plugins: [router, [VueQueryPlugin, {queryClient: context.queryClient}], [I18NextVue, {i18next: context.i18next}]],
            provide: {[frontendContextKey as symbol]: context},
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

/** Keep the originating route while its small logical owner unmounts. The real
 * shell then presents the same application-owned confirmed receipt as fallback. */
async function confirmedReadVisit(read: (request: Request) => Promise<Response>) {
    const visit = await mounted(`/packing/${firstId}/guest`, async request =>
        new URL(request.url).pathname === '/api/v1/session' ? read(request)
            : json({entry: {kind: 'render'}, guest: {id: firstId, title: 'Guest fixture'}}));
    let completion!: ReturnType<typeof useConfirmedNavigation>;
    const showOwner = ref(true);
    const ConfirmedOwner = defineComponent({template: '<p>Confirmed command</p>', setup() {
            completion = useConfirmedNavigation();
            return {};
        }});
    const ConfirmedHost = defineComponent({components: {ConfirmedOwner},
        template: '<div><ConfirmedOwner v-if="showOwner" /></div>', setup() { return {showOwner}; }});
    visit.router.addRoute({path: '/confirmed-read-fixture', component: ConfirmedHost});
    await visit.router.push('/confirmed-read-fixture');
    await flushPromises();
    visit.request.mockClear();
    return {...visit, completion, showOwner, origin: visit.router.currentRoute.value.fullPath};
}

/** Exercise the shared admission owner and real query promise independently of a
 * feature's command UI, including its own denial-generation transition. */
async function freshEntryVisit(read: () => Promise<{entry: components['schemas']['PageEntryOutcome']}>) {
    const visit = await mounted('/', async request => {
        if (new URL(request.url).pathname === '/api/v1/locale') {
            const {locale} = await request.json();
            return json({...session, locale});
        }
        return json(session);
    });
    let admission!: ReturnType<typeof usePageEntry<{entry: components['schemas']['PageEntryOutcome']}>>;
    const EntryOwner = defineComponent({template: '<p>Shared admission visit</p>', setup() {
            admission = usePageEntry({key: computed(() => ['fresh-entry-fixture']), read});
            return {};
        }});
    visit.router.addRoute({path: '/fresh-entry-fixture', component: EntryOwner});
    await visit.router.push('/fresh-entry-fixture');
    await flushPromises();
    return {...visit, admission};
}

describe('server-owned page entry and canonical navigation', () => {
    it('certifies only fresh restored render admission and keeps a later typed denial retired', async () => {
        const denied: components['schemas']['PageEntryOutcome'] = {kind: 'denied', status: 403,
            messageKey: 'api:errors.FORBIDDEN'};
        let value: {entry: components['schemas']['PageEntryOutcome']} = {entry: denied};
        const read = vi.fn(async () => value);
        const {admission} = await freshEntryVisit(read);
        expect(admission.outcome.value).toEqual(denied);
        value = {entry: {kind: 'render'}};
        await expect(admission.readFreshAdmission()).resolves.toBeUndefined();
        await flushPromises();
        expect(admission.outcome.value).toEqual({kind: 'render'});
        expect(admission.admittedAt.value).toBeDefined();
        value = {entry: denied};
        await expect(admission.readFreshAdmission()).rejects.toBeDefined();
        await flushPromises();
        expect(admission.outcome.value).toEqual(denied);
        expect(admission.admittedAt.value).toBeUndefined();
        expect(read).toHaveBeenCalledTimes(3);
    });

    it.each(['locale', 'route'] as const)('rejects fresh authority delivered after its %s retires', async retirement => {
        let hold = false;
        let resolveRead!: (value: {entry: components['schemas']['PageEntryOutcome']}) => void;
        const held = new Promise<{entry: components['schemas']['PageEntryOutcome']}>(resolve => { resolveRead = resolve; });
        const {admission, context, router} = await freshEntryVisit(async () => hold ? held : {entry: {kind: 'render'}});
        hold = true;
        const fresh = admission.readFreshAdmission();
        const rejected = expect(fresh).rejects.toBeDefined();
        await flushPromises();
        if (retirement === 'locale') await context.changeLocale('de');
        else await router.push('/help');
        resolveRead({entry: {kind: 'render'}});
        await rejected;
        await flushPromises();
        expect(context.locale.value).toBe(retirement === 'locale' ? 'de' : 'en');
        expect(router.currentRoute.value.path).toBe(retirement === 'locale'
            ? '/fresh-entry-fixture' : '/help');
    });

    it.each([400, 404])('keeps private cached locales retired after typed %s denial and admits only a fresh restoration', async status => {
        let denied = false;
        let holdEnglish = false;
        const heldEnglish = deferredResponse();
        const deniedEntry = {kind: 'denied' as const, status,
            messageKey: status === 400 ? 'packing.eventRegistrationRequired' : 'packing.notFound'};
        const {wrapper, context, request} = await mounted(`/packing/${firstId}`, async request => {
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
        }, false, {initialUrl: `/packing/${firstId}`, pageEntry: {kind: 'render'}});
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
        const path = `/packing/${firstId}/guest`;
        const heldReturn = deferredResponse();
        const {wrapper, context, router} = await mounted(path, async request => {
            return request.url.includes(firstId) ? heldReturn.response
                : json({entry: {kind: 'render'}, guest: {id: secondId, title: 'Second guest title'}});
        }, false, {initialUrl: path, pageEntry: {kind: 'render'}, guestEntry: {id: firstId, title: 'Initial guest title'}});
        expect(wrapper.text()).toContain('Initial guest title');
        await router.push(path + '#registration');
        expect(context.initialDocumentFor(path)).toBeDefined();
        await router.push(`/packing/${secondId}/guest`);
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
        const path = `/packing/${firstId}/guest`;
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
        const {context, router} = await mounted(`/packing/${firstId}/guest`, async () => json({
            entry: {kind: 'render'}, guest: {id: firstId, title: 'Guest fixture'},
        }));
        let finishDelivery!: (component: Component) => void;
        router.addRoute({path: '/packing/slow-destination', component: function loadDestination() {
                return new Promise<Component>(resolve => { finishDelivery = resolve; });
            }});
        context.pageNotice.value = {kind: 'success', messageKey: 'auth.loginDone'};
        context.personalLink.value = 'https://fixture.test/guest/private-token';
        const delivery = navigatePageEntry(context, router,
            {kind: 'redirect', url: '/packing/slow-destination', notice: null});
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

    it.each([false, true])('retires admission before Router capture without canceling a newer deliberate visit (%s)', async deliberate => {
        const profile = {id: firstId, name: 'Newly admitted account'};
        const account: components['schemas']['SessionView'] = {...session, kind: 'account',
            activeProfile: profile, profiles: [profile], logoutUrl: '/users/logout'};
        const {context, router} = await mounted('/', async () => json(account));
        const destination = '/users/login?next=/users/dashboard';
        const delivery = navigatePageEntry(context, router, {kind: 'redirect', url: destination,
            notice: {kind: 'info', messageKey: 'auth.loginRequired'}});
        // Real identity acceptance retires the actor synchronously before its
        // authoritative GET. Router's existing guard pipeline has not run yet.
        const admitted = context.acceptIdentity({session: account, personalLink: null, redirect: null});
        const visit = deliberate ? router.push(destination) : undefined;
        await admitted;
        await delivery;
        await visit;
        await flushPromises();

        expect(router.currentRoute.value.fullPath).toBe(deliberate ? destination : '/');
        expect(context.pageNotice.value).toBeNull();
    });

    it('retains a confirmed destination after lazy delivery fails and retries only navigation', async () => {
        const {context, router} = await mounted(`/packing/${firstId}/guest`, async () => json({
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

        router.addRoute({path: '/command-fixture', component: ConfirmedOwner});
        router.addRoute({path: '/packing/confirmed-destination', component: deliverDestination});
        await router.push('/command-fixture');
        await flushPromises();
        const origin = router.currentRoute.value.fullPath;
        expect(completion.available.value).toBe(true);
        expect(await completion.navigate('/packing/confirmed-destination', context.capture(), origin)).toBe(false);
        expect(completion.available.value).toBe(false);
        expect(completion.target.value).toBe('/packing/confirmed-destination');
        expect(completion.pending.value).toBe(false);
        expect(router.currentRoute.value.fullPath).toBe(origin);

        await router.push(origin + '#confirmed-command');
        expect(completion.target.value).toBe('/packing/confirmed-destination');

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
        expect(await completion.navigate('/help')).toBe(false);
        expect(await completion.retry()).toBe(true);
        await flushPromises();
        expect(deliveries).toBe(2);
        expect(router.currentRoute.value.path).toBe('/packing/confirmed-destination');
        expect(completion.target.value).toBeNull();
        expect(completion.available.value).toBe(true);
    });

    it.each(['dismissed', 'expired', 'replaced'] as const)(
        'keeps a %s success receipt retired through failed delivery and recovery', async disposition => {
            vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
            vi.useFakeTimers();
            const held = deferredResponse();
            let holdRead = true;
            const visit = await confirmedReadVisit(async () => holdRead ? held.response : json(session));
            const family = ['confirmed-notice-lifetime', session.context] as const;
            const observer = new QueryObserver(visit.context.queryClient, {queryKey: [...family, 'visible'],
                queryFn: () => visit.context.api.bootstrap(), initialData: session, staleTime: Infinity, retry: false});
            const stopRead = observer.subscribe(() => {});
            cleanups.push(async () => { stopRead(); });
            const notice = {kind: 'success' as const, messageKey: 'packing.deleted'};
            const replacement = {...notice};
            const delivery = visit.completion.navigate('/help', visit.context.capture(), visit.origin,
                notice, false, [family]);
            await flushPromises();
            try {
                // One confirmed result is visible immediately. Its pending read
                // must not make that successful action look eligible for Retry.
                const success = visit.wrapper.get('[data-frontend-notices] .alert-success');
                expect(success.text()).toBe(visit.context.messages.value.t('packing.deleted'));
                expect(success.find('button:not(.btn-close)').exists()).toBe(false);
                expect(visit.wrapper.find('[data-frontend-notices] .alert-warning').exists()).toBe(false);
                if (disposition === 'dismissed') await success.get('.btn-close').trigger('click');
                else if (disposition === 'expired') await vi.advanceTimersByTimeAsync(10_001);
                else visit.context.pageNotice.value = replacement;

                holdRead = false;
                held.resolve(new Response('{}', {status: 503, headers: {'Content-Type': 'application/json',
                        'X-Surveyor-Context': session.context}}));
                expect(await delivery).toBe(false);
                await flushPromises();
                expect(visit.context.pageNotice.value).toEqual(disposition === 'replaced' ? replacement : null);
                const warning = visit.wrapper.get('[data-frontend-notices] .alert-warning');
                expect(warning.text()).toContain(visit.context.messages.value.t('state.deliveryFailed'));
                expect(visit.wrapper.findAll('[data-frontend-notices] .alert-warning')).toHaveLength(1);

                // The shell reaches this still-mounted origin's existing receipt.
                // Recovery sends only a fresh GET and its canonical navigation;
                // an equal-key later action remains a separate live receipt.
                expect(await visit.completion.retryRecovery()).toBe(true);
                await flushPromises();
                expect(visit.context.pageNotice.value).toEqual(disposition === 'replaced' ? replacement : null);
                expect(visit.completion.recoveryTarget.value).toBeNull();
                expect(visit.wrapper.find('[data-frontend-notices] .alert-warning').exists()).toBe(false);
                expect(visit.request.mock.calls.map(([value]) => (value as Request).method)).toEqual(['GET', 'GET']);
            } finally {
                held.resolve(json(session));
                await delivery;
            }
        });

    it('invalidates every selected warm variant before an existing read cooldown can pause confirmed delivery', async () => {
        let unavailable = true;
        const visit = await confirmedReadVisit(async () => unavailable
            ? new Response('{}', {status: 429, headers: {'Content-Type': 'application/json',
                    'Retry-After': '1', 'X-Surveyor-Context': session.context}}) : json(session));
        const family = ['confirmed-dependency', session.context] as const;
        const key = [...family, 'visible'];
        const hiddenKey = [...family, 'another-locale'];
        const observer = new QueryObserver(visit.context.queryClient, {queryKey: key,
            queryFn: () => visit.context.api.bootstrap(), initialData: session, staleTime: Infinity, retry: false});
        const stopRead = observer.subscribe(() => {});
        cleanups.push(async () => { stopRead(); });
        vi.useFakeTimers();
        await observer.refetch();
        expect(visit.request).toHaveBeenCalledOnce();
        // Warm another inactive locale after the failure has established its
        // deadline; session error handling can already invalidate observed keys.
        visit.context.queryClient.setQueryData(hiddenKey, session);
        expect(visit.context.queryClient.getQueryState(hiddenKey)?.isInvalidated).toBe(false);

        // A previous read's server deadline must pause GET delivery, not skip
        // retiring snapshots after a newly confirmed irreversible command.
        expect(await visit.completion.navigate('/help', visit.context.capture(), visit.origin,
            null, false, [family])).toBe(false);
        expect(visit.completion.available.value).toBe(false);
        expect(visit.completion.retryAction.disabled.value).toBe(true);
        expect(visit.context.queryClient.getQueryState(key)?.isInvalidated).toBe(true);
        expect(visit.context.queryClient.getQueryState(hiddenKey)?.isInvalidated).toBe(true);
        expect(visit.request).toHaveBeenCalledOnce();

        unavailable = false;
        await vi.advanceTimersByTimeAsync(1001);
        expect(await visit.completion.retry()).toBe(true);
        expect(visit.router.currentRoute.value.path).toBe('/help');
        expect(visit.request).toHaveBeenCalledTimes(2);
    });

    it('retains confirmed delivery and its read deadline across owner unmount, then retries only the eligible read and navigation', async () => {
        let failRead = true;
        const visit = await confirmedReadVisit(async () => {
            if (!failRead) return json(session);
            return new Response(JSON.stringify({type: 'about:blank', title: 'Read unavailable', status: 429,
                code: 'RATE_LIMITED', messageKey: 'api:errors.RATE_LIMITED', params: {},
                detail: 'Please wait.', requestId: 'confirmed-read-cooldown'}),
                {status: 429, headers: {'Content-Type': 'application/problem+json', 'Retry-After': '1',
                        'X-Surveyor-Context': session.context}});
        });
        const family = ['confirmed-dependency', session.context] as const;
        const observer = new QueryObserver(visit.context.queryClient, {queryKey: [...family, 'visible'],
            queryFn: () => visit.context.api.bootstrap(), initialData: session, staleTime: Infinity, retry: false});
        const hiddenRead = vi.fn(async () => session);
        const hidden = new QueryObserver(visit.context.queryClient, {queryKey: [...family, 'hidden'],
            queryFn: hiddenRead, initialData: session, staleTime: Infinity, enabled: false});
        const stopRead = observer.subscribe(() => {});
        const stopHidden = hidden.subscribe(() => {});
        cleanups.push(async () => { stopRead(); stopHidden(); });
        vi.useFakeTimers();
        const notice = {kind: 'success' as const, messageKey: 'packing.deleted'};
        expect(await visit.completion.navigate('/help', visit.context.capture(), visit.origin, notice, false, [family])).toBe(false);
        expect(visit.router.currentRoute.value.path).toBe(visit.origin);
        expect(visit.completion.target.value).toBe('/help');
        expect(visit.completion.notice.value).toEqual(notice);
        expect(visit.completion.retryAction.disabled.value).toBe(true);
        expect(visit.completion.retryAt.value).toBeGreaterThan(Date.now());
        expect(await visit.completion.retry()).toBe(false);
        expect(visit.request).toHaveBeenCalledOnce();
        expect(hiddenRead).not.toHaveBeenCalled();

        // The original control's timer retires with that component. The shell's
        // existing fallback observes the same cache-owned deadline and receipt.
        visit.showOwner.value = false;
        await flushPromises();
        const deadline = visit.wrapper.get('[data-frontend-notices] [data-read-retry-at]');
        const timestamp = deadline.get('time').attributes('datetime');
        expect(timestamp).toBeDefined();
        expect(Date.parse(timestamp!)).toBeGreaterThan(Date.now());
        const retry = visit.wrapper.get('[data-frontend-notices] .status-notice button');
        expect(retry.attributes('disabled')).toBeDefined();
        await retry.trigger('click');
        expect(visit.request).toHaveBeenCalledOnce();
        await vi.advanceTimersByTimeAsync(1001);
        await flushPromises();
        expect(retry.attributes('disabled')).toBeUndefined();
        expect(visit.request).toHaveBeenCalledOnce();
        failRead = false;
        await retry.trigger('click');
        await flushPromises();
        expect(visit.router.currentRoute.value.path).toBe('/help');
        expect(visit.request).toHaveBeenCalledTimes(2);
        expect(visit.request.mock.calls.every(([request]) => (request as Request).method === 'GET')).toBe(true);
        expect(hiddenRead).not.toHaveBeenCalled();
    });

    it('retires a confirmed read dependency when its actor changes during a held read without delivering the destination', async () => {
        const held = deferredResponse();
        const visit = await confirmedReadVisit(async () => held.response);
        const family = ['confirmed-dependency', session.context] as const;
        const observer = new QueryObserver(visit.context.queryClient, {queryKey: [...family, 'visible'],
            queryFn: () => visit.context.api.bootstrap(), initialData: session, staleTime: Infinity, retry: false});
        const stopRead = observer.subscribe(() => {});
        cleanups.push(async () => { stopRead(); });
        const delivery = visit.completion.navigate('/help', visit.context.capture(), visit.origin, null, false, [family]);
        await flushPromises();
        try {
            expect(visit.request).toHaveBeenCalledOnce();
            expect(visit.completion.pending.value).toBe(true);
            expect(visit.context.mayChangeIdentity()).toBe(false);
            expect(await visit.completion.retry()).toBe(false);
            visit.context.session.value = {...session, context: 'replacement-confirmed-read-context'};
            await flushPromises();
            expect(visit.completion.target.value).toBeNull();
        } finally { held.resolve(json(session)); }
        expect(await delivery).toBe(false);
        expect(visit.router.currentRoute.value.path).toBe(visit.origin);
        expect(visit.request.mock.calls.every(([request]) => (request as Request).method === 'GET')).toBe(true);
    });

    it('delivers a confirmed receipt without forcing a hidden dependency or requiring an absent query family', async () => {
        const visit = await confirmedReadVisit(async () => json(session));
        const family = ['confirmed-dependency', session.context] as const;
        const read = vi.fn(async () => session);
        const observer = new QueryObserver(visit.context.queryClient, {queryKey: [...family, 'hidden'],
            queryFn: read, initialData: session, staleTime: Infinity, enabled: false});
        const stopRead = observer.subscribe(() => {});
        cleanups.push(async () => { stopRead(); });
        expect(await visit.completion.navigate('/help', visit.context.capture(), visit.origin, null, false,
            [family, ['absent-confirmed-dependency']])).toBe(true);
        expect(visit.router.currentRoute.value.path).toBe('/help');
        expect(read).not.toHaveBeenCalled();
        expect(visit.request).not.toHaveBeenCalled();
    });

    it('keeps confirmed dependency Retry closed during a temporary shared read barrier without consuming its receipt', async () => {
        const heldSession = deferredResponse();
        let sessionReads = 0;
        const visit = await confirmedReadVisit(async function readSession(): Promise<Response> {
            return ++sessionReads === 1 ? heldSession.response : json(session);
        });
        const family = ['confirmed-dependency', session.context] as const;
        const observer = new QueryObserver(visit.context.queryClient, {queryKey: [...family, 'visible'],
            queryFn: () => visit.context.api.bootstrap(), initialData: session, staleTime: Infinity,
            enabled: false, meta: {surveyorRead: {mayRead: () => visit.context.mayRead()}}});
        const stopRead = observer.subscribe(() => {});
        cleanups.push(async () => { stopRead(); });
        const hiddenKey = [...family, 'another-locale'];
        visit.context.queryClient.setQueryData(hiddenKey, session);
        // The actual session owner closes resource-read admission while its
        // bootstrap is held; the public readonly projection stays untouched.
        const restoringSession = visit.context.refreshSession();
        try {
            await flushPromises();
            expect(visit.context.readsReady.value).toBe(false);
            expect(visit.context.sessionRead.value.pending).toBe(true);
            expect(await visit.completion.navigate('/help', visit.context.capture(), visit.origin, null, false, [family])).toBe(false);
            expect(visit.completion.target.value).toBe('/help');
            expect(visit.context.queryClient.getQueryState(hiddenKey)?.isInvalidated).toBe(true);
            expect(visit.completion.retryAction.disabled.value).toBe(true);
            expect(await visit.completion.retry()).toBe(false);
            expect(visit.request).toHaveBeenCalledOnce();
            expect(visit.router.currentRoute.value.path).toBe(visit.origin);
        } finally {
            heldSession.resolve(json(session));
            await restoringSession;
        }

        // This is a paused mounted observer, distinct from an absent/hidden
        // dependency. Reopening admission permits its real read and delivery.
        await flushPromises();
        expect(visit.context.readsReady.value).toBe(true);
        expect(visit.context.sessionRead.value.pending).toBe(false);
        expect(visit.completion.retryAction.disabled.value).toBe(false);
        expect(await visit.completion.retry()).toBe(true);
        expect(visit.request).toHaveBeenCalledTimes(2);
        expect(visit.router.currentRoute.value.path).toBe('/help');
    });

    it('protects a pending confirmed destination and retires a cancelled receipt on another actor', async () => {
        const {context, router} = await mounted(`/packing/${firstId}/guest`, async () => json({
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

        router.addRoute({path: '/command-fixture', component: ConfirmedOwner});
        router.addRoute({path: '/packing/confirmed-destination', component: deliverDestination});
        await router.push('/command-fixture');
        await flushPromises();
        const origin = router.currentRoute.value.fullPath;
        const navigation = completion.navigate('/packing/confirmed-destination');
        await flushPromises();
        expect(completion.pending.value).toBe(true);
        expect(context.mayChangeIdentity()).toBe(false);
        expect(await completion.retry()).toBe(false);
        await router.push('/help');
        expect(router.currentRoute.value.fullPath).toBe(origin);
        context.locale.value = 'de';
        finishDelivery(Destination);
        // The competing aborted navigation supersedes the first router attempt. Its
        // confirmed receipt stays reachable; Retry still navigates and never writes.
        expect(await navigation).toBe(false);
        expect(completion.target.value).toBe('/packing/confirmed-destination');
        context.session.value = {...session, context: 'superseding-context-1234567890'};
        await flushPromises();
        expect(completion.target.value).toBeNull();
        expect(completion.available.value).toBe(true);
        expect(await completion.retry()).toBe(false);
        expect(router.currentRoute.value.fullPath).toBe(origin);
    });

    it('shows a retained delivery Retry only in the same-type instance that confirmed its command', async () => {
        const {router, wrapper} = await mounted(`/packing/${firstId}/guest`, async () => json({
            entry: {kind: 'render'}, guest: {id: firstId, title: 'Guest fixture'},
        }));
        const ConfirmedOwner = defineComponent({
            props: {identity: {type: String, required: true}},
            template: '<section><button :disabled="!completion.available.value" @click="complete">Confirm command</button><p v-if="completion.target.value">Retry confirmed delivery</p></section>',
            setup(props) {
                const completion = useConfirmedNavigation(props.identity);
                function complete(): Promise<boolean> { return completion.navigate('/help'); }
                return {completion, complete};
            },
        });
        const SameTypeOwners = defineComponent({components: {ConfirmedOwner},
            template: '<div><ConfirmedOwner identity="first" /><ConfirmedOwner identity="second" /></div>'});
        router.addRoute({path: '/parallel-command-fixture', component: SameTypeOwners});
        await router.push('/parallel-command-fixture');
        await flushPromises();
        const cancelDelivery = router.beforeEach(to => to.path === '/help' ? false : undefined);
        try {
            const owners = wrapper.findAllComponents(ConfirmedOwner);
            await owners[0]!.get('button').trigger('click');
            await flushPromises();
            expect(owners[0]!.text()).toContain('Retry confirmed delivery');
            expect(owners[1]!.text()).not.toContain('Retry confirmed delivery');
            expect(owners[0]!.get('button').attributes('disabled')).toBeDefined();
            expect(owners[1]!.get('button').attributes('disabled')).toBeDefined();
        } finally { cancelDelivery(); }
    });

    it('redirects standalone anonymous detail to its canonical guest form, with the real title', async () => {
        const path = `/packing/${firstId}`;
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
        const {wrapper, router} = await mounted(`/packing/${firstId}`, async () => json({
            entry: {kind: 'denied', status: 400, messageKey: 'packing.eventRegistrationRequired'}, guest: null,
        }));
        expect(router.currentRoute.value.path).toBe(`/packing/${firstId}`);
        expect(wrapper.get('h1').text()).toBe('Error');
        expect(wrapper.find('#guest-name').exists()).toBe(false);
        expect(wrapper.find('[data-loading-skeleton]').exists()).toBe(false);
    });

    it('replaces an explicit guest URL with the admitted detail instead of swapping content under /guest', async () => {
        const path = `/packing/${firstId}`;
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
        const {wrapper, router} = await mounted(`/packing/${firstId}`, async () => held);
        await router.push('/help');
        finishRead(json({entry: {kind: 'redirect', url: `/packing/${firstId}/guest`, notice: null}, guest: null}));
        await flushPromises();
        expect(router.currentRoute.value.path).toBe('/help');
        expect(wrapper.text()).toContain('Admitted destination');
    });

    it('retires the prior resource projection when the same wrapper receives another identifier', async () => {
        let finishSecond!: (response: Response) => void;
        const held = new Promise<Response>(resolve => { finishSecond = resolve; });
        const {wrapper, router} = await mounted(`/packing/${firstId}/guest`, async request => {
            return request.url.includes(secondId) ? held
                : json({entry: {kind: 'render'}, guest: {id: firstId, title: 'First public title'}});
        });
        expect(wrapper.text()).toContain('First public title');
        await router.push(`/packing/${secondId}/guest`);
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
        const {wrapper, context} = await mounted(`/packing/${firstId}/guest`, async request => {
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
        const returnPath = `/packing/${firstId}/duplicate`;
        const {wrapper, context, router} = await mounted(`/packing/${firstId}`, async () => json({
            entry: {kind: 'redirect', url: '/users/login?next=' + encodeURIComponent(returnPath),
                notice: {kind: 'info', messageKey: 'auth.accountRequired'}}, guest: null,
        }));
        expect(router.currentRoute.value.path).toBe('/users/login');
        expect(router.currentRoute.value.query.next).toBe(returnPath);
        expect(context.pageNotice.value?.kind).toBe('info');
        expect(wrapper.find('.alert-info').exists()).toBe(true);
        await router.push('/help');
        await flushPromises();
        expect(context.pageNotice.value).toBeNull();
        expect(wrapper.find('.alert-info').exists()).toBe(false);
    });

    it('retains the current draft and notice when its guard cancels an admission redirect', async () => {
        const path = `/packing/${firstId}/guest`;
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
            kind: 'redirect', url: '/users/login',
            notice: {kind: 'info', messageKey: 'auth.accountRequired'},
        };

        expect(await navigatePageEntry(context, router, decision, context.capture(), path)).toBe(false);
        expect(router.currentRoute.value.fullPath).toBe(path);
        expect(wrapper.get<HTMLInputElement>('#guest-name').element.value).toBe('Unsent guest name');
        expect(context.pageNotice.value).toEqual(earlierNotice);
        expect(confirm).toHaveBeenCalledOnce();

        confirm.mockReturnValue(true);
        expect(await navigatePageEntry(context, router, decision, context.capture(), path)).toBe(true);
        expect(router.currentRoute.value.fullPath).toBe('/users/login');
        expect(context.pageNotice.value).toEqual(decision.notice);
        expect(confirm).toHaveBeenCalledTimes(2);
    });

    it('keeps a dirty admitted guest subtree through a canceled server-read redirect and retires it on denial', async () => {
        const path = `/packing/${firstId}/guest`;
        let decision: 'render' | 'redirect' | 'denied' = 'render';
        const guest = {id: firstId, title: 'Public guest title'};
        const {wrapper, context, router} = await mounted(path, async request => {
            if (!new URL(request.url).pathname.endsWith('/entry')) return json(guest);
            if (decision === 'redirect') return json({entry: {kind: 'redirect',
                    url: '/users/login', notice: {kind: 'info', messageKey: 'auth.accountRequired'}}, guest: null});
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
            const path = `/packing/${firstId}/guest`;
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
        const path = `/packing/${firstId}`;
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
        const path = `/packing/${firstId}/guest`;
        const destination = '/guest/recovery';
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

        await router.push('/help');
        await flushPromises();
        expect(context.pageCompletion.value).toBeNull();
    });

    it('keeps a confirmed message mounted when the next lazy destination fails before commitment', async () => {
        const origin = `/packing/${firstId}/guest`;
        const destination = '/guest/recovery';
        const {wrapper, context, router} = await mounted(origin, async () => json({
            entry: {kind: 'render'}, guest: {id: firstId, title: 'Public guest title'},
        }));
        expect(await completePageEntry(context, router, destination, 'auth.recoverySent', 'success')).toBe(true);
        router.addRoute({path: '/unavailable', component: unavailablePage});

        async function unavailablePage(): Promise<never> {
            throw new Error('Failed to fetch dynamically imported module');
        }
        await expect(router.push('/unavailable')).rejects.toThrow('Failed to fetch dynamically imported module');
        await flushPromises();
        expect(router.currentRoute.value.fullPath).toBe(destination);
        expect(context.pageCompletion.value?.destination).toBe(destination);
        expect(wrapper.get('h1').text()).toBe('Success');
        expect(wrapper.find('.frontend-navigation-loading').exists()).toBe(false);
    });

    it.each([false, true])('retains confirmed completion across a locale change before or during lazy navigation (before=%s)', async before => {
        const origin = `/packing/${firstId}/guest`;
        const destination = '/packing/completion-fixture';
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
        const destination = `/packing/${firstId}/duplicate?eventId=${secondId}`;
        const path = '/users/login?next=' + encodeURIComponent(destination);
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
