// @vitest-environment happy-dom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {flushPromises, mount} from '@vue/test-utils';
import {defineComponent, nextTick, reactive, type Component} from 'vue';
import {createMemoryHistory, createRouter} from 'vue-router';
import {VueQueryPlugin} from '@tanstack/vue-query';
import I18NextVue from 'i18next-vue';
import {createPilotContext, pilotContextKey, refreshInterval} from '../../src/frontend/app/context';
import {overviewKeys} from '../../src/frontend/app/queryKeys';
import {ApiFailure} from '../../src/frontend/app/transport';
import EventPicker from '../../src/frontend/components/EventPicker.vue';
import OverviewRegion from '../../src/frontend/features/overview/OverviewRegion.vue';
import type {components} from '../../src/types/api/v1';
import type {PilotEventPickerSource} from '../../src/types/FrontendPilotUiTypes';

const profileId = '11111111-1111-4111-8111-111111111111';
const eventId = '22222222-2222-4222-8222-222222222222';
const otherId = '33333333-3333-4333-8333-333333333333';
const session: components['schemas']['SessionView'] = {
    kind: 'account', context: 'refresh-context-1234567890', csrfToken: 'refresh-csrf-1234567890', locale: 'en',
    deployment: {buildId: 'fixture', apiCompatibility: 'v1-pilot-2026-10-07'},
    activeProfile: {id: profileId, name: 'Owner'}, profiles: [{id: profileId, name: 'Owner'}],
    loginUrl: '/users/login', logoutUrl: '/users/logout', shell: {version: 'fixture', imprintUrl: '/imprint',
        privacyPolicyUrl: '/privacy', localLoginEnabled: true, oidcEnabled: false, oidcName: 'SSO'},
};
const event: components['schemas']['PackingEventOption'] = {id: eventId, title: 'Authorized camp',
    startDate: '2026-10-07', endDate: '2026-10-08', archived: true, description: null, deadlinePassed: false};
const card: components['schemas']['OverviewCard'] = {
    id: otherId, type: 'survey', title: 'Latest survey', description: null, url: '/survey/' + otherId,
    headerUrl: null, headerVersion: null, eventContext: null, children: null,
    archived: false, inheritedArchived: false, visibility: 'default', overviewHidden: false,
    capabilities: {archive: false, restore: false, duplicate: false, remove: false},
};
const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
});

function json(value: unknown): Response {
    return new Response(JSON.stringify(value), {headers: {'Content-Type': 'application/json',
        'X-Surveyor-Context': session.context}});
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(finish => { resolve = finish; });
    return {promise, resolve};
}

function pickerSource(search: PilotEventPickerSource['search']): PilotEventPickerSource {
    return {search,
        pageKey: (actor, locale, filters, query) => ['selection-fixture', actor, locale, filters, query],
        filterKey: (actor, locale, filters) => ['selection-fixture', actor, locale, filters]};
}

function region(request: Request): components['schemas']['OverviewRegion'] {
    const query = new URL(request.url).searchParams;
    const page = Number(query.get('page') ?? 1);
    return {collection: 'owner', region: 'main', q: query.get('q') ?? '', type: 'all', availableTypes: ['survey'],
        page, childPage: 1, eventId: query.get('eventId'), pageSize: 1, totalEntities: 2, hiddenEntities: 0,
        regionEntities: 2, matchingEntities: 2, totalCards: 2, totalChildren: 0,
        hasPrevious: page > 1, hasNext: page < 2, parent: null, items: [card]};
}

/** Replace the external HTTP/discovery boundary only. Router, query cancellation, command
 * lifecycle and rendered controls remain their production implementations. */
async function mounted(component: Component, props: Record<string, unknown>,
    handler: (request: Request) => Promise<Response> = async request => json(region(request)),
    path = '/frontend-pilot', previous = '/before') {
    const request = vi.fn((input: RequestInfo | URL) => handler(input as Request));
    const context = createPilotContext({session}, true, request);
    context.hydrated.value = true;
    const componentProps = reactive({...props});
    const router = createRouter({history: createMemoryHistory(), routes: [
        {path: '/frontend-pilot', component, props: () => componentProps},
        {path: '/before', component: defineComponent({template: '<p>Before overview</p>'})},
    ]});
    await router.push(previous);
    await router.push(path);
    const root = mount(defineComponent({template: '<RouterView />'}), {attachTo: document.body, global: {
        plugins: [router, [VueQueryPlugin, {queryClient: context.queryClient}],
            [I18NextVue, {i18next: context.i18next}]],
        provide: {[pilotContextKey as symbol]: context},
        stubs: {AppDialog: defineComponent({template: '<section><slot /><slot name="footer" /></section>'})},
    }});
    await flushPromises();
    cleanups.push(async () => {
        root.unmount();
        await context.queryClient.cancelQueries();
        context.start()();
    });
    async function update(values: Record<string, unknown>): Promise<void> {
        Object.assign(componentProps, values);
        await nextTick();
    }
    return {wrapper: root.findComponent(component), root, router, context, request, update};
}

describe('visible resource recovery', () => {
    it('renders event filters before discovery finishes and replaces only its loading rows', async () => {
        const authority = deferred<{items: typeof event[]; selected: typeof event; nextCursor: null}>();
        const search = vi.fn(() => authority.promise);
        const {wrapper} = await mounted(EventPicker,
            {prefix: 'loading-events', inline: true, modelValue: eventId, source: pickerSource(search)});

        expect(search).toHaveBeenCalledOnce();
        expect(wrapper.find('[data-loading-skeleton]').exists()).toBe(true);
        const input = wrapper.get<HTMLInputElement>('input[type="search"]');
        input.element.focus();
        authority.resolve({items: [event], selected: event, nextCursor: null});
        await flushPromises();

        expect(wrapper.find('[data-loading-skeleton]').exists()).toBe(false);
        expect(wrapper.get(`[data-event-id="${eventId}"]`).text()).toContain(event.title);
        expect(wrapper.get<HTMLInputElement>('input[type="search"]').element).toBe(input.element);
        expect(document.activeElement).toBe(input.element);
    });

    it('keeps healthy cadence and bounds ordinary recovery without bypassing server cooldown', () => {
        expect(refreshInterval(null, 0, 2000)).toBe(32_000);
        expect(refreshInterval(new Error('Temporary read failure'), 0, 2000)).toBe(30_000);
        expect(refreshInterval(new Error('Temporary read failure'), 3, 2000)).toBe(60_000);
        const limited = new ApiFailure(429, null, 90_000);
        expect(refreshInterval(limited, 3, 2000)).toBeGreaterThanOrEqual(89_900);
    });

    it('clears only a recovered session-read notice and pauses checks while hidden', async () => {
        const visible = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
        const request = vi.fn(async () => json(session));
        const context = createPilotContext({session}, true, request);
        const stop = context.start();
        cleanups.push(stop);
        request.mockRejectedValueOnce(new TypeError('Session read unavailable'));
        window.dispatchEvent(new Event('focus'));
        await flushPromises();
        expect(context.notice.value).toBe('state.stale');

        visible.mockReturnValue('hidden');
        window.dispatchEvent(new Event('focus'));
        window.dispatchEvent(new Event('online'));
        await flushPromises();
        expect(request).toHaveBeenCalledOnce();

        visible.mockReturnValue('visible');
        document.dispatchEvent(new Event('visibilitychange'));
        await flushPromises();
        expect(request).toHaveBeenCalledTimes(2);
        expect(context.notice.value).toBeNull();
        context.notice.value = 'auth.logoutDone';
        await context.refreshSession();
        expect(context.notice.value).toBe('auth.logoutDone');
    });
});

describe('selected-event authority', () => {
    it('removes a revoked label after authoritative null without clearing the selected draft ID', async () => {
        let authorized = true;
        const search = vi.fn(async () => ({items: [], selected: authorized ? event : null, nextCursor: null}));
        const {wrapper, context} = await mounted(EventPicker,
            {prefix: 'authority', inline: true, modelValue: eventId, current: event, source: pickerSource(search)});
        expect(wrapper.text()).toContain('Authorized camp');
        expect(wrapper.text()).toContain('Archived with selected event');
        authorized = false;
        await context.queryClient.refetchQueries({type: 'active'});
        await flushPromises();
        expect(wrapper.text()).not.toContain('Authorized camp');
        expect(wrapper.text()).not.toContain('Archived with selected event');
        expect(wrapper.props('modelValue')).toBe(eventId);
        expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    });

    it('refreshes a closed selection once when its owner retires the displayed authority', async () => {
        const search = vi.fn(async () => ({items: [], selected: null, nextCursor: null}));
        const {wrapper, update} = await mounted(EventPicker,
            {prefix: 'closed', modelValue: eventId, current: event, source: pickerSource(search)});
        expect(search).not.toHaveBeenCalled();
        await update({current: null});
        await flushPromises();
        expect(search).toHaveBeenCalledOnce();
        expect(wrapper.text()).not.toContain('Authorized camp');
        expect(wrapper.props('modelValue')).toBe(eventId);
    });

    it('does not restore a retired selection when its old discovery resolves after a new selection', async () => {
        const first = deferred<components['schemas']['PackingEventOptions']>();
        const next = {...event, id: otherId, title: 'Current camp'};
        const search = vi.fn(async (query: Parameters<PilotEventPickerSource['search']>[0]) =>
            query.selectedId === eventId ? first.promise : {items: [], selected: next, nextCursor: null});
        const {wrapper, update} = await mounted(EventPicker,
            {prefix: 'late', inline: true, modelValue: eventId, current: event, source: pickerSource(search)});
        await update({modelValue: otherId, current: next});
        await flushPromises();
        first.resolve({items: [], selected: event, nextCursor: null});
        await flushPromises();
        expect(wrapper.text()).toContain('Current camp');
        expect(wrapper.text()).not.toContain('Authorized camp');
        expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    });
});

describe('native overview search and history', () => {
    it('resumes a cancelled read when quick typing returns to the original search', async () => {
        vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date']});
        const {wrapper, router, request} = await mounted(OverviewRegion, {collection: 'owner', region: 'main'});
        const input = wrapper.get('input[type="search"]');
        await input.setValue('temporary');
        await vi.advanceTimersByTimeAsync(100);
        await input.setValue('');
        await vi.advanceTimersByTimeAsync(300);
        await flushPromises();
        expect(router.currentRoute.value.fullPath).toBe('/frontend-pilot');
        expect(request).toHaveBeenCalledTimes(2);
        expect(wrapper.text()).toContain('Latest survey');
    });

    it('debounces typed filters for 300 ms, preserves focus and other regions, and replaces filter history', async () => {
        vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date']});
        const {wrapper, root, router, request} = await mounted(OverviewRegion, {collection: 'owner', region: 'main'},
            undefined, '/frontend-pilot?participant_main_q=other&owner_main_page=2&owner_main_childPage=3');
        const input = wrapper.get<HTMLInputElement>('input[type="search"]');
        input.element.focus();
        await input.setValue('first');
        await vi.advanceTimersByTimeAsync(200);
        await input.setValue('latest');
        input.element.setSelectionRange(2, 4);
        await vi.advanceTimersByTimeAsync(299);
        expect(request).toHaveBeenCalledOnce();
        await vi.advanceTimersByTimeAsync(1);
        await flushPromises();
        expect(router.currentRoute.value.query).toEqual({participant_main_q: 'other', owner_main_q: 'latest'});
        expect(new URL((request.mock.calls.at(-1)![0] as Request).url).searchParams.get('q')).toBe('latest');
        expect(document.activeElement).toBe(input.element);
        expect([input.element.selectionStart, input.element.selectionEnd]).toEqual([2, 4]);

        const next = wrapper.findAll('a').find(link => link.text() === 'Next')!;
        await next.trigger('click');
        await flushPromises();
        expect(router.currentRoute.value.query.owner_main_page).toBe('2');
        router.back();
        await flushPromises();
        expect(router.currentRoute.value.query.owner_main_q).toBe('latest');
        expect(router.currentRoute.value.query.owner_main_page).toBeUndefined();
        router.back();
        await flushPromises();
        expect(router.currentRoute.value.path).toBe('/before');
        expect(root.text()).toContain('Before overview');
    });

    it('retires the previous read immediately before the typed debounce expires', async () => {
        vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date']});
        const first = deferred<Response>();
        let original!: Request;
        const {wrapper, context, request} = await mounted(OverviewRegion, {collection: 'owner', region: 'main'}, async req => {
            if (!new URL(req.url).searchParams.has('q')) { original = req; return first.promise; }
            return json(region(req));
        });
        // Another mounted region owns an independent query in the same actor/locale cache.
        // Retiring this region must leave its pending read available to that observer.
        const otherRegion = deferred<string>();
        let otherSignal!: AbortSignal;
        const otherRead = context.queryClient.fetchQuery({
            queryKey: overviewKeys.region(session.context, 'en', {collection: 'participant', region: 'main'}),
            queryFn: ({signal}) => { otherSignal = signal; return otherRegion.promise; },
        });
        await wrapper.get('input[type="search"]').setValue('latest');
        expect(otherSignal.aborted).toBe(false);
        first.resolve(json({...region(original), items: [{...card, title: 'Obsolete survey'}]}));
        await flushPromises();
        expect(wrapper.text()).not.toContain('Obsolete survey');
        expect(request).toHaveBeenCalledOnce();
        await vi.advanceTimersByTimeAsync(300);
        await flushPromises();
        expect(wrapper.text()).toContain('Latest survey');
        expect(wrapper.text()).not.toContain('Obsolete survey');
        otherRegion.resolve('Other region remained current');
        expect(await otherRead).toBe('Other region remained current');
    });

    it('applies typing during pending Back to the requested root rather than reopening the old event', async () => {
        vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date']});
        const previous = '/frontend-pilot?owner_main_q=seed&participant_main_q=other';
        const {wrapper, router} = await mounted(OverviewRegion, {collection: 'owner', region: 'main'}, undefined,
            '/frontend-pilot?owner_main_q=old&owner_main_event=' + eventId + '&participant_main_q=other', previous);
        const backStarted = deferred<void>();
        const back = deferred<void>();
        const removeGuard = router.beforeResolve(async to => {
            if (to.query.owner_main_q === 'seed') { backStarted.resolve(); await back.promise; }
        });
        cleanups.push(removeGuard);
        router.back();
        await backStarted.promise;
        await wrapper.get('input[type="search"]').setValue('during Back');
        await vi.advanceTimersByTimeAsync(300);
        await flushPromises();
        expect(router.currentRoute.value.query).toEqual({owner_main_q: 'during Back', participant_main_q: 'other'});
        back.resolve();
        await flushPromises();
        expect(router.currentRoute.value.query.owner_main_event).toBeUndefined();
        expect(wrapper.get<HTMLInputElement>('input[type="search"]').element.value).toBe('during Back');
    });
});
