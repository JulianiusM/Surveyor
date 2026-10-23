// @vitest-environment happy-dom
import {apiCompatibility} from '../../.generated/api/v1/policy.mjs';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {flushPromises, mount} from '@vue/test-utils';
import {defineComponent, nextTick, reactive, type Component} from 'vue';
import {createMemoryHistory, createRouter} from 'vue-router';
import {VueQueryPlugin} from '@tanstack/vue-query';
import I18NextVue from 'i18next-vue';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import * as pug from 'pug';
import {createPilotContext, pilotContextKey} from '../../src/frontend/app/context';
import {helpKeys, overviewKeys, packingKeys} from '../../src/frontend/app/queryKeys';
import {refetchFreshQueries} from '../../src/frontend/app/queryCache';
import {ApiFailure, ObsoleteRequestError} from '../../src/frontend/app/transport';
import {useHelpApi} from '../../src/frontend/features/help/api';
import {useOverviewApi} from '../../src/frontend/features/overview/api';
import HelpPage from '../../src/frontend/features/help/HelpPage.vue';
import PackingPage from '../../src/frontend/features/packing/PackingPage.vue';
import EventPicker from '../../src/frontend/components/EventPicker.vue';
import OverviewRegion from '../../src/frontend/features/overview/OverviewRegion.vue';
import OverviewPage from '../../src/frontend/features/overview/OverviewPage.vue';
import OverviewCard from '../../src/frontend/features/overview/OverviewCard.vue';
import AppNavigationDropdown from '../../src/frontend/components/AppNavigationDropdown.vue';
import ActionButton from '../../src/frontend/components/ActionButton.vue';
import App from '../../src/frontend/app/App.vue';
import type {components} from '../../src/types/api/v1';
import type {PilotEventPickerSource} from '../../src/types/FrontendPilotUiTypes';
import type {Entity, OverviewRegionView} from '../../src/types/UserTypes';

const profileId = '11111111-1111-4111-8111-111111111111';
const eventId = '22222222-2222-4222-8222-222222222222';
const otherId = '33333333-3333-4333-8333-333333333333';
const session: components['schemas']['SessionView'] & {context: string; csrfToken: string} = {
    kind: 'account', context: 'refresh-context-1234567890', csrfToken: 'refresh-csrf-1234567890', locale: 'en',
    deployment: {buildId: 'fixture', apiCompatibility},
    activeProfile: {id: profileId, name: 'Owner'}, profiles: [{id: profileId, name: 'Owner'}],
    loginUrl: '/users/login', logoutUrl: '/users/logout', shell: {version: 'fixture', imprintUrl: '/imprint',
        privacyPolicyUrl: '/privacy', localLoginEnabled: true, oidcEnabled: false, oidcName: 'SSO'},
};
const event: components['schemas']['EventPickerOption'] = {id: eventId, title: 'Authorized camp',
    startDate: '2026-10-07', endDate: '2026-10-08', archived: true, description: null, deadlinePassed: false};
const card: components['schemas']['OverviewCard'] = {
    id: otherId, type: 'survey', title: 'Latest survey', description: null, url: '/survey/' + otherId,
    headerUrl: null, headerVersion: null, eventContext: null, children: null,
    archived: false, inheritedArchived: false, visibility: 'default', overviewHidden: false,
    capabilities: {archive: false, restore: false, duplicate: false, remove: false},
};
const packing: components['schemas']['PackingListView'] = {
    entityType: 'packing', id: eventId, title: 'Shared equipment', description: null,
    headerUrl: null, headerVersion: null, orderToken: '"order"', currentEventId: null, currentEventUrl: null,
    archived: false, inheritedArchived: false,
    capabilities: {editTitle: false, editDescription: false, selfAssign: true, addItem: true,
        reorder: false, manageSettings: false},
    counters: {participants: 0, open: 0, empty: 0}, items: [],
};
// Compile the immutable native oracle once per isolated file. Every comparison
// still renders current fixture membership into a new DOM; no output or locals
// are cached, and the migrated component never supplies its expected markup.
const nativeRegionFilename = resolve('src/views/modules/module_unified_entity_cards.pug');
const renderNativeRegion = pug.compile(readFileSync(resolve('src/views/modules/module_entity_archive.pug'), 'utf8')
    + '\n' + readFileSync(nativeRegionFilename, 'utf8') + '\n+pagedEntityRegion(view)', {filename: nativeRegionFilename});
const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
});

function json(value: unknown, status = 200): Response {
    return new Response(JSON.stringify(value), {status, headers: {'Content-Type': 'application/json',
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

/** Exercise the real transport envelope boundary rather than manufacturing a query
 * error. A safe future response can establish denial without granting a known code. */
function readFailure(status: number, representation: 'html' | 'malformed' | 'mismatched' | 'future'): Response {
    const headers = {'Content-Type': representation === 'html' ? 'text/html' : 'application/json',
        'X-Surveyor-Context': session.context};
    if (representation === 'html') return new Response('<html><body>Temporary proxy failure</body></html>', {status, headers});
    const body = representation === 'malformed' ? {code: 'FORBIDDEN'}
        : {type: 'urn:surveyor:problem:future-read-denial', title: 'Unavailable',
            status: representation === 'mismatched' ? (status === 404 ? 403 : 404) : status,
            detail: 'Read access is unavailable.', requestId: 'future-overview-read', code: 'FUTURE_READ_DENIAL'};
    return new Response(JSON.stringify(body), {status, headers});
}

function eventRegion(request: Request): components['schemas']['OverviewRegion'] {
    const view = region(request);
    const parent = {...card, id: eventId, type: 'event' as const, title: 'Camp', url: '/event/' + eventId,
        children: {matching: 1, total: 1}};
    return {...view, availableTypes: ['event', 'survey'], parent: view.eventId ? parent : null,
        totalChildren: view.eventId ? 1 : 0, items: view.eventId ? [card] : [parent]};
}

/** Render the retained native presentation as the independent toolbar oracle. The
 * DTO supplies the same bounded fixture membership, without replacing either view's
 * rendering or inferring new expected labels from the migrated implementation. */
function nativeOverviewRegion(value: components['schemas']['OverviewRegion']): HTMLElement {
    function nativeCard(item: components['schemas']['OverviewCard']): Entity {
        return {id: item.id, title: item.title, ownerId: 'another-profile', type: item.type,
            description: item.description, url: item.url, visibility: item.visibility};
    }
    const view: OverviewRegionView = {...value, id: 'overview-' + value.collection + '-' + value.region,
        title: 'Administrable entities', queryPrefix: value.collection + '_' + value.region + '_',
        eventId: value.eventId ?? undefined, parent: value.parent ? nativeCard(value.parent) : undefined,
        items: value.items.map(nativeCard), canonicalUrl: '/users/dashboard', backUrl: '/users/dashboard',
        clearUrl: '/users/dashboard', loaded: true, searchFields: []};
    const element = document.createElement('section');
    element.innerHTML = renderNativeRegion({view, profile: session.activeProfile});
    return element;
}

/** Compare the native HTML submit contract, including selected type and menu order. */
function filterChoices(element: ParentNode) {
    const buttons = [...element.querySelectorAll<HTMLButtonElement>('button.dropdown-item[data-type]')];
    return buttons.map(button => ({label: button.textContent?.trim(), classes: button.className,
        type: button.type, name: button.name, value: button.value, dataType: button.dataset.type,
        selected: button.getAttribute('aria-pressed')}));
}

/** Replace the external HTTP/discovery boundary only. Router, query cancellation, command
 * lifecycle and rendered controls remain their production implementations. */
async function mounted(component: Component, props: Record<string, unknown>,
    handler: (request: Request) => Promise<Response> = async request => json(region(request)),
    path = '/frontend-pilot', previous = '/before', shell?: Component, prepare?: (context: ReturnType<typeof createPilotContext>) => void) {
    const request = vi.fn((input: RequestInfo | URL) => handler(input as Request));
    const context = createPilotContext({session}, true, request);
    context.hydrated.value = true;
    prepare?.(context);
    const componentProps = reactive({...props});
    const router = createRouter({history: createMemoryHistory(), routes: [
        {path: '/frontend-pilot', component, props: () => componentProps},
        {path: '/frontend-pilot/packing/:listId', component, props: () => componentProps},
        {path: '/frontend-pilot/help', component, props: () => componentProps},
        {path: '/before', component: defineComponent({template: '<p>Before overview</p>'})},
    ]});
    await router.push(previous);
    await router.push(path);
    const root = mount(shell ?? defineComponent({template: '<RouterView />'}), {attachTo: document.body, global: {
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

describe('Overview Packing lifecycle actions', () => {
    it.each([
        {restore: false, inherited: false, confirmation: 'packing.confirmArchive', success: 'overview.archived'},
        {restore: false, inherited: true, confirmation: 'packing.confirmArchiveIndependent', success: 'overview.archived'},
        {restore: true, inherited: true, confirmation: 'packing.confirmRestore', success: 'overview.restored'},
    ] as const)('preserves Overview confirmation, cancellation and global feedback for $confirmation', async action => {
        vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
        const confirmation = vi.fn().mockReturnValueOnce(false).mockReturnValue(true);
        vi.stubGlobal('confirm', confirmation);
        let writes = 0;
        const packingCard: components['schemas']['OverviewCard'] = {...card, type: 'packing',
            url: `/frontend-pilot/packing/${card.id}`, inheritedArchived: action.inherited,
            capabilities: {...card.capabilities, archive: !action.restore, restore: action.restore}};
        const {wrapper, context, request} = await mounted(OverviewRegion, {collection: 'owner', region: 'main'},
            async function readLifecycle(captured): Promise<Response> {
                if (captured.method === 'POST') {
                    expect(new URL(captured.url).pathname).toBe(`/api/v1/packing-lists/${card.id}/${action.restore ? 'restore' : 'archive'}`);
                    writes++;
                    return json({changed: true});
                }
                return json({...region(captured), availableTypes: ['packing'], items: [packingCard]});
            });

        // The existing region's query, command and API owners survive a locale
        // change; the shared action still obtains current confirmation wording.
        context.locale.value = 'de';
        await flushPromises();
        const button = wrapper.findAll('button.dropdown-item').find(candidate => candidate.text()
            === context.messages.value.t(action.restore ? 'common.restore' : 'common.archive'))!;
        (button.element.closest('details') as HTMLDetailsElement).open = true;
        await button.trigger('click');
        await flushPromises();
        expect(confirmation).toHaveBeenLastCalledWith(context.messages.value.t(action.confirmation));
        expect(writes).toBe(0);
        expect(wrapper.find('.pilot-notification').exists()).toBe(false);
        const readsBeforeConfirmation = request.mock.calls.length;

        // The same command refreshes its region and publishes through shared
        // notification presentation without capturing a native section target.
        (button.element.closest('details') as HTMLDetailsElement).open = true;
        await button.trigger('click');
        await flushPromises();
        expect(writes).toBe(1);
        expect(request.mock.calls.length).toBeGreaterThan(readsBeforeConfirmation + 1);
        expect(wrapper.get('.pilot-notification').text()).toBe(context.messages.value.t(action.success));
    });
});

describe('Overview independent schedule controls', () => {
    it.each([
        {type: 'event', parent: false}, {type: 'activity', parent: false}, {type: 'event', parent: true},
    ] as const)('shares admitted $type schedule commands and restore consent (parent=$parent)', async function exercisesSchedule(candidate) {
        vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
        const confirmation = vi.fn(() => false);
        vi.stubGlobal('confirm', confirmation);
        const schedule: components['schemas']['OverviewCard'] = {...card, type: candidate.type,
            url: `/frontend-pilot/${candidate.type}/${card.id}`, title: 'Archived scheduled root',
            archived: true, visibility: 'shown', overviewHidden: false,
            automation: {paused: true, canManage: true},
            capabilities: {...card.capabilities, restore: true}};
        const root = candidate.type === 'event' ? 'events' : 'activity-plans';
        const writes: {path: string; method: string; body: unknown}[] = [];

        /** Only HTTP supplies saved state. The generated feature API, shared
         * command and actual region refresh must publish the next visible action. */
        async function serveScheduledOverview(request: Request): Promise<Response> {
            const path = new URL(request.url).pathname;
            if (request.method !== 'GET') {
                const body = request.method === 'PUT' ? await request.json() : null;
                writes.push({path, method: request.method, body});
                if (request.method === 'PUT') schedule.automation!.paused = body.paused;
                else {
                    schedule.archived = false;
                    schedule.automation!.paused = true;
                    schedule.capabilities.restore = false;
                    schedule.capabilities.archive = true;
                }
                return json({changed: true});
            }
            const view = {...region(request), availableTypes: [candidate.type],
                parent: candidate.parent ? schedule : null, items: candidate.parent ? [] : [schedule]};
            return json(view);
        }

        const visit = await mounted(OverviewRegion, {collection: 'owner', region: 'main'}, serveScheduledOverview);
        const {wrapper, context, request} = visit;
        await vi.waitFor(() => expect(wrapper.findAll('button.dropdown-item')
            .some(button => button.text() === 'Resume automatic archival')).toBe(true));

        /** Open the real disclosure before invoking a currently rendered action.
         * Each fresh GET replaces its label from admitted state, not a local mirror. */
        async function choose(label: string): Promise<void> {
            const button = wrapper.findAll('button.dropdown-item').find(control => control.text() === label)!;
            expect(button, label).toBeDefined();
            (button.element.closest('details') as HTMLDetailsElement).open = true;
            await button.trigger('click');
            await flushPromises();
        }

        // Canceled resumption never dispatches. Confirming it sends exactly the
        // existing feature command; the fresh read then exposes immediate Pause.
        await choose('Resume automatic archival');
        expect(confirmation).toHaveBeenLastCalledWith(context.messages.value.t('event.organizer.confirmResumeAutomation'));
        expect(writes).toEqual([]);
        confirmation.mockReturnValue(true);
        await choose('Resume automatic archival');
        expect(writes).toEqual([{path: `/api/v1/${root}/${card.id}/automatic-archive`, method: 'PUT', body: {paused: false}}]);
        expect(wrapper.text()).toContain('Pause automatic archival');
        const confirmationsBeforePause = confirmation.mock.calls.length;
        await choose('Pause automatic archival');
        expect(confirmation).toHaveBeenCalledTimes(confirmationsBeforePause);
        expect(writes[1]).toEqual({path: `/api/v1/${root}/${card.id}/automatic-archive`, method: 'PUT', body: {paused: true}});
        expect(wrapper.text()).toContain('Resume automatic archival');

        // Restoration's meaningful schedule warning is shared with Settings and
        // Event children. Event keeps its fuller explicit parent/child wording.
        confirmation.mockReturnValue(false);
        await choose('Restore for everyone');
        const restoreKey = candidate.type === 'event' ? 'event.confirmRestore' : 'event.organizer.confirmRestoreScheduled';
        expect(confirmation).toHaveBeenLastCalledWith(context.messages.value.t(restoreKey));
        expect(writes).toHaveLength(2);
        confirmation.mockReturnValue(true);
        const readsBeforeRestore = request.mock.calls.filter(([input]) => (input as Request).method === 'GET').length;
        await choose('Restore for everyone');
        expect(writes[2]).toEqual({path: `/api/v1/${root}/${card.id}/restore`, method: 'POST', body: null});
        expect(writes).toHaveLength(3);
        expect(wrapper.text()).toContain('Archive for everyone');
        expect(wrapper.text()).toContain('Resume automatic archival');
        expect(request.mock.calls.filter(([input]) => (input as Request).method === 'GET').length).toBeGreaterThan(readsBeforeRestore);

        // A retained DOM callback cannot bypass the common initialization gate.
        // No fresh confirmation or command is allowed after that admission ends.
        const resume = wrapper.findAll('button.dropdown-item').find(button => button.text() === 'Resume automatic archival')!;
        const confirmationsBeforeRetirement = confirmation.mock.calls.length;
        context.hydrated.value = false;
        await resume.trigger('click');
        await flushPromises();
        expect(writes).toHaveLength(3);
        expect(confirmation).toHaveBeenCalledTimes(confirmationsBeforeRetirement);
    });

    it.each(['packing', 'drivers', 'survey', 'activity'] as const)(
        'does not invent an independent schedule for an unscheduled %s card', async function omitsUnscheduledActions(type) {
            const unscheduled = {...card, type, automation: undefined,
                capabilities: {...card.capabilities, archive: true}};
            const {wrapper, request} = await mounted(OverviewRegion, {collection: 'owner', region: 'main'},
                async function readUnscheduled(request) { return json({...region(request), availableTypes: [type], items: [unscheduled]}); });
            await vi.waitFor(() => expect(wrapper.text()).toContain(unscheduled.title));
            expect(wrapper.text()).not.toContain('Resume automatic archival');
            expect(wrapper.text()).not.toContain('Pause automatic archival');
            expect(request.mock.calls.every(([input]) => (input as Request).method === 'GET')).toBe(true);
        },
    );
});

describe('visible resource recovery', () => {
    it('retains initiating Overview Refresh through an independently held sibling region read', async function retainsFamilyRefresh() {
        const ownerResponse = deferred<Response>();
        const participantResponse = deferred<Response>();
        let refreshing = false;
        let ownerReads = 0;
        let participantReads = 0;

        /** Both production regions retain their own delivered data. Only HTTP
         * completion is held, so their shared family reconciliation remains real. */
        async function readIndependentRegions(request: Request): Promise<Response> {
            const collection = new URL(request.url).searchParams.get('collection') === 'participant' ? 'participant' : 'owner';
            if (!refreshing) return json({...region(request), collection});
            if (collection === 'owner') { ownerReads++; return ownerResponse.promise; }
            participantReads++;
            return participantResponse.promise;
        }

        const {wrapper} = await mounted(OverviewPage, {}, readIndependentRegions);
        const owner = wrapper.get('[data-collection="owner"][data-region="main"]');
        const participant = wrapper.get('[data-collection="participant"][data-region="main"]');
        const refresh = owner.get<HTMLButtonElement>('button.ms-auto');
        expect(refresh.element.disabled).toBe(false);
        refresh.element.focus();
        expect(document.activeElement).toBe(refresh.element);
        const focus = vi.spyOn(refresh.element, 'focus');
        refreshing = true;
        try {
            await refresh.trigger('click');
            await vi.waitFor(() => expect([ownerReads, participantReads]).toEqual([1, 1]));
            expect(refresh.element.disabled).toBe(true);
            expect(refresh.attributes('aria-busy')).toBe('true');
            expect(refresh.find('.spinner-border').exists()).toBe(true);

            // Happy DOM retains disabled focus; reproduce Chromium's unclaimed
            // body focus so the actual shared restoration boundary is exercised.
            document.body.tabIndex = -1;
            document.body.focus();
            document.body.removeAttribute('tabindex');
            expect(document.activeElement).toBe(document.body);

            const request = new Request('http://localhost/api/v1/overview?collection=owner');
            ownerResponse.resolve(json({...region(request), items: [{...card, title: 'Owner refresh complete'}]}));
            await flushPromises();
            expect(owner.text()).toContain('Owner refresh complete');
            expect(participant.text()).toContain(card.title);
            // This region's own query has settled, but its initiating operation
            // still awaits the sibling. Neither focus nor availability releases early.
            expect(owner.get('button.ms-auto').element).toBe(refresh.element);
            expect(refresh.element.disabled).toBe(true);
            expect(refresh.attributes('aria-busy')).toBe('true');
            expect(refresh.find('.spinner-border').exists()).toBe(true);
            expect(document.activeElement).toBe(document.body);
            expect(focus).not.toHaveBeenCalled();
            await refresh.trigger('click');
            expect([ownerReads, participantReads]).toEqual([1, 1]);

            participantResponse.resolve(json({...region(request), collection: 'participant'}));
            await flushPromises();
            expect(refresh.element.disabled).toBe(false);
            expect(refresh.attributes('aria-busy')).toBe('false');
            expect(document.activeElement).toBe(refresh.element);
            expect(focus).toHaveBeenCalledExactlyOnceWith({preventScroll: true});
        } finally {
            // A failed assertion must not strand a query during shared cleanup.
            ownerResponse.resolve(json({...region(new Request('http://localhost/')), collection: 'owner'}));
            participantResponse.resolve(json({...region(new Request('http://localhost/')), collection: 'participant'}));
        }
    });

    it('admits a new mounted GET after a cached terminal denial without waiting for cache expiry', async function admitsColdRead() {
        let denied = true;
        let reads = 0;
        async function readColdRegion(request: Request): Promise<Response> {
            reads++;
            return denied ? readFailure(403, 'future') : json(region(request));
        }
        const {root, router, context} = await mounted(OverviewRegion, {collection: 'owner', region: 'main'}, readColdRegion);
        expect(reads).toBe(1);
        expect(root.findComponent(OverviewCard).exists()).toBe(false);
        await router.push('/before');
        await flushPromises();
        expect(context.queryClient.getQueryCache().findAll({queryKey: overviewKeys.all(session.context)})).toHaveLength(1);

        // A new component visit must recheck native GET admission even while the
        // old rejected query remains cached. Its former observer cannot suspend it.
        denied = false;
        await router.push('/frontend-pilot');
        await flushPromises();
        expect(reads).toBe(2);
        expect(root.findComponent(OverviewCard).exists()).toBe(true);
    });

    it('rechecks a cached missing Help topic on cold Back in the reused route component', async function admitsHelpBack() {
        let missing = true;
        let rejectedTopicReads = 0;
        const article: components['schemas']['HelpPageData'] = {locale: 'en', title: 'Readmitted guide',
            content: '<p>A readmitted task.</p>', docsList: [], docsGroups: [], currentDoc: 'fixture', toc: []};
        async function readHelpTopic(request: Request): Promise<Response> {
            if (new URL(request.url).searchParams.get('doc') === 'missing') {
                rejectedTopicReads++;
                if (missing) return json({type: 'about:blank', title: 'Not found', status: 404,
                    detail: 'Missing topic.', requestId: 'cold-help-topic', code: 'NOT_FOUND',
                    messageKey: 'api:errors.NOT_FOUND', params: {}}, 404);
            }
            return json(article);
        }
        const {root, router} = await mounted(HelpPage, {}, readHelpTopic, '/frontend-pilot/help?doc=missing');
        expect(root.find('.pilot-page-message').exists()).toBe(true);
        expect(rejectedTopicReads).toBe(1);
        await router.push('/frontend-pilot/help?doc=index');
        await flushPromises();
        expect(root.get('.help-content').text()).toContain('A readmitted task.');
        missing = false;
        router.back();
        await flushPromises();
        expect(rejectedTopicReads).toBe(2);
        expect(root.find('.pilot-page-message').exists()).toBe(false);
        expect(root.get('.help-content').text()).toContain('A readmitted task.');
    });

    it('consumes a joined in-flight read before terminal session-resume suppression', async function consumesJoinedRead() {
        const held = deferred<Response>();
        let reads = 0;
        let pending: Promise<unknown> | undefined;
        async function readJoinedRegion(request: Request): Promise<Response> {
            if (new URL(request.url).pathname === '/api/v1/session') return json(session);
            reads++;
            return held.promise;
        }
        const {root, context} = await mounted(OverviewRegion, {collection: 'owner', region: 'main'}, readJoinedRegion,
            '/frontend-pilot', '/before', undefined, function prepareJoinedRead(context): void {
                const api = useOverviewApi(context);
                const parameters = {collection: 'owner' as const, region: 'main' as const};
                const scope = context.capture();
                pending = context.queryClient.fetchQuery({queryKey: overviewKeys.region(scope.context, scope.locale, parameters),
                    queryFn: ({signal}) => api.overview(parameters, scope, signal)}).catch(() => undefined);
            });
        expect(reads).toBe(1);
        held.resolve(readFailure(403, 'future'));
        await pending;
        await flushPromises();
        expect(root.findComponent(OverviewCard).exists()).toBe(false);
        for (let attempt = 0; attempt < 3; attempt++) {
            await context.refreshSession();
            await flushPromises();
        }
        expect(reads).toBe(1);
    });

    it('refreshes a readable terminal-paused dependency after a confirmed visibility command without reading hidden queries',
        async function refreshesCommittedDependencies() {
            let denied = true;
            let writes = 0;
            const reads: string[] = [];
            async function readDependentRegion(request: Request): Promise<Response> {
                if (request.method === 'PUT') {
                    writes++;
                    denied = false;
                    return json({visibility: 'shown', overviewHidden: false, archived: false});
                }
                const parameters = new URL(request.url).searchParams;
                reads.push(parameters.get('collection') + ':' + parameters.get('region'));
                if (denied && parameters.get('collection') === 'owner') return readFailure(403, 'future');
                return json({...region(request), collection: parameters.get('collection'), region: parameters.get('region')});
            }
            const {wrapper, context} = await mounted(OverviewPage, {}, readDependentRegion);
            // A closed cached variant has no eligible mounted observer and remains
            // outside this command's active dependencies, despite sharing its family.
            context.queryClient.setQueryData(overviewKeys.region(session.context, 'en', {collection: 'owner', region: 'hidden'}),
                {...region(new Request('http://localhost/overview')), region: 'hidden'});
            expect(wrapper.get('[data-collection="owner"][data-region="main"]').findComponent(OverviewCard).exists()).toBe(false);
            const participant = wrapper.get('[data-collection="participant"][data-region="main"]');
            await participant.findAll('button').find(button => button.text() === context.messages.value.t('overview.show'))!.trigger('click');
            await flushPromises();
            expect(writes).toBe(1);
            expect(wrapper.get('[data-collection="owner"][data-region="main"]').findComponent(OverviewCard).exists()).toBe(true);
            expect(reads.filter(value => value === 'owner:main')).toHaveLength(2);
            expect(reads).not.toContain('owner:hidden');
        });

    it('uses the readable observer when a hidden sibling last configured the same terminal query', async function selectsReadableObserver() {
        let denied = true;
        let reads = 0;
        const siblings = defineComponent({components: {OverviewRegion}, template:
            '<section><OverviewRegion collection="owner" region="main" /><OverviewRegion collection="owner" region="main" :active="false" /></section>'});
        async function readSharedRegion(request: Request): Promise<Response> {
            reads++;
            return denied ? readFailure(403, 'future') : json(region(request));
        }
        const {root, context} = await mounted(siblings, {}, readSharedRegion);
        expect(reads).toBe(1);
        expect(root.findComponent(OverviewCard).exists()).toBe(false);

        // Both real observers share one cache entry. Its last query options belong
        // to the hidden sibling; the explicit dependency must use the readable
        // observer's feature callback and keep the hidden callback undispatched.
        denied = false;
        await refetchFreshQueries(context.queryClient, {queryKey: overviewKeys.all(session.context), type: 'active'},
            () => context.mayRead());
        await flushPromises();
        expect(reads).toBe(2);
        expect(root.findAllComponents(OverviewRegion)[0].findComponent(OverviewCard).exists()).toBe(true);
    });

    it('waits for visibility-resume session admission and retains mounted drafts through failed bootstrap and cooldown', async function preservesReadAdmission() {
        vi.useFakeTimers({toFake: ['Date']});
        vi.setSystemTime(new Date('2026-10-13T08:00:00Z'));
        const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
        const bootstrap = deferred<Response>();
        let recovered = false;
        async function readPacking(request: Request): Promise<Response> {
            if (new URL(request.url).pathname === '/api/v1/session') return recovered ? json(session) : bootstrap.promise;
            return json(packing);
        }
        const {wrapper, context, request} = await mounted(PackingPage, {}, readPacking,
            '/frontend-pilot/packing/' + eventId);
        const stop = context.start();
        cleanups.push(stop);
        const input = wrapper.get<HTMLInputElement>('#quick-title');
        await input.setValue('Retained packing draft');
        input.element.focus();
        input.element.setSelectionRange(2, 8);

        // Resuming a stale observer must wait behind the real bootstrap promise.
        visibility.mockReturnValue('hidden');
        document.dispatchEvent(new Event('visibilitychange'));
        await nextTick();
        vi.setSystemTime(new Date('2026-10-13T08:00:31Z'));
        visibility.mockReturnValue('visible');
        document.dispatchEvent(new Event('visibilitychange'));
        await flushPromises();
        expect(request.mock.calls.map(([value]) => new URL((value as Request).url).pathname))
            .toEqual(['/api/v1/packing-lists/' + eventId, '/api/v1/session']);
        expect(context.ready.value).toBe(true);
        expect(context.mayRead()).toBe(false);
        const refresh = wrapper.get<HTMLButtonElement>('button[aria-label="Refresh"]');
        expect(refresh.element.disabled).toBe(true);
        expect(input.element.disabled).toBe(false);

        // Explicit API callers cannot bypass observer enablement. Command/response
        // scope stays valid while only new reads are paused.
        const captured = context.capture();
        await expect(context.api.checkPasswordReset('fixture-token', captured)).rejects.toBeInstanceOf(ObsoleteRequestError);
        expect(context.isCurrent(captured)).toBe(true);
        expect(request).toHaveBeenCalledTimes(2);
        bootstrap.resolve(new Response(JSON.stringify({type: 'urn:future:unavailable', title: 'Unavailable',
            status: 503, detail: 'Bootstrap is temporarily unavailable.', requestId: 'resume-session-cooldown'}),
        {status: 503, headers: {'Content-Type': 'application/json', 'Retry-After': '60'}}));
        await flushPromises();
        window.dispatchEvent(new Event('focus'));
        await flushPromises();
        expect(context.mayRead()).toBe(false);
        expect(request).toHaveBeenCalledTimes(2);
        expect(wrapper.get('#quick-title').element).toBe(input.element);
        expect(input.element.value).toBe('Retained packing draft');
        expect([input.element.selectionStart, input.element.selectionEnd]).toEqual([2, 8]);
        expect(document.activeElement).toBe(input.element);
        expect(refresh.element.disabled).toBe(true);

        // Only a later admitted bootstrap restores automatic read dispatch.
        recovered = true;
        vi.setSystemTime(new Date('2026-10-13T08:01:32Z'));
        await context.refreshSession();
        await flushPromises();
        expect(context.mayRead()).toBe(true);
        expect(request.mock.calls.filter(([value]) => new URL((value as Request).url).pathname === '/api/v1/packing-lists/' + eventId))
            .toHaveLength(2);
        expect(wrapper.get('#quick-title').element).toBe(input.element);
        expect(refresh.element.disabled).toBe(false);
    });

    it('pauses picker paging while retaining local draft controls and resumes without replay', async function coordinatesPickerActions() {
        const bootstrap = deferred<Response>();
        const search = vi.fn<PilotEventPickerSource['search']>(async () => ({items: [event], selected: null,
            nextCursor: 'next-batch'}));
        const {wrapper, context} = await mounted(EventPicker,
            {prefix: 'action-picker', modelValue: null, source: pickerSource(search)}, async () => bootstrap.promise);
        await wrapper.get('#action-picker-event-button').trigger('click');
        await flushPromises();
        const next = wrapper.findAll('button').find(button => button.text() === context.messages.value.t('eventPicker.nextPage'))!;
        const cancel = wrapper.findAll('button').find(button => button.text() === context.messages.value.t('common.cancel'))!;
        const reset = wrapper.findAll('button').find(button => button.text() === context.messages.value.t('eventPicker.resetFilters'))!;
        const checking = context.refreshSession();
        await nextTick();

        expect(next.attributes('disabled')).toBeDefined();
        expect(cancel.attributes('disabled')).toBeUndefined();
        expect(reset.attributes('disabled')).toBeUndefined();
        expect(wrapper.get<HTMLInputElement>('#action-picker-search').element.disabled).toBe(false);
        expect(search).toHaveBeenCalledOnce();
        bootstrap.resolve(json(session));
        await checking;
        await flushPromises();
        expect(next.attributes('disabled')).toBeUndefined();
        expect(search).toHaveBeenCalledOnce();
        await next.trigger('click');
        await flushPromises();
        expect(search).toHaveBeenCalledTimes(2);
        await cancel.trigger('click');
        expect(search).toHaveBeenCalledTimes(2);
    });

    it('retires a retained Help Retry callback with its mounted action owner', async function retiresReadAction() {
        const {wrapper, root, request} = await mounted(HelpPage, {}, async () => readFailure(403, 'future'),
            '/frontend-pilot/help?doc=fixture');
        const retry = wrapper.findComponent(ActionButton);
        expect(retry.attributes('disabled')).toBeUndefined();
        // Retain the real parent handler supplied to the reusable control. DOM
        // removal alone cannot establish that this delayed callback is retired.
        const delayed = retry.vm.$attrs.onClick as () => Promise<void>;
        const reads = request.mock.calls.length;
        root.unmount();
        await delayed();
        expect(request).toHaveBeenCalledTimes(reads);
    });

    it('changes locale without canceling or refetching a mounted machine projection', async function preservesMachineRead() {
        const machine = deferred<Response>();
        const translated = deferred<Response>();
        let machineSignal: AbortSignal | undefined;
        let translatedSignal: AbortSignal | undefined;
        let reads = 0;
        async function readSelectedProjection(request: Request): Promise<Response> {
            const path = new URL(request.url).pathname;
            if (path === '/api/v1/locale') return json({...session, locale: 'de'});
            if (path === '/api/v1/help') { translatedSignal = request.signal; return translated.promise; }
            if (++reads === 1) return json(packing);
            machineSignal = request.signal;
            return machine.promise;
        }
        const {wrapper, context, request} = await mounted(PackingPage, {}, readSelectedProjection,
            '/frontend-pilot/packing/' + eventId);
        const input = wrapper.get<HTMLInputElement>('#quick-title');
        await input.setValue('Locale-independent draft');
        input.element.focus();

        // Hold real machine and language-owned operations across the same preference write.
        const machineRead = context.queryClient.refetchQueries({queryKey: packingKeys.detail(session.context, eventId)});
        const scope = context.capture();
        const help = useHelpApi(context);
        const helpRead = context.queryClient.fetchQuery({queryKey: helpKeys.page(session.context, 'en', {}),
            queryFn: ({signal}) => help.help({}, scope, signal)}).catch(() => undefined);
        await flushPromises();
        await context.changeLocale('de');
        await flushPromises();
        expect(machineSignal?.aborted).toBe(false);
        expect(translatedSignal?.aborted).toBe(true);
        expect(reads).toBe(2);
        expect(wrapper.get('#quick-title').element).toBe(input.element);
        expect(input.element.value).toBe('Locale-independent draft');
        expect(document.activeElement).toBe(input.element);

        // The unchanged machine key receives its original admitted result once;
        // the retired translated response can neither reenter the cache nor replay a write.
        machine.resolve(json(packing));
        translated.resolve(json({}));
        await Promise.all([machineRead, helpRead]);
        await flushPromises();
        expect(reads).toBe(2);
        expect(request.mock.calls.filter(([value]) => (value as Request).method !== 'GET')).toHaveLength(1);
    });

    it('shares the observer read started by focus admission with ordinary resource recovery', async function sharesFocusRead() {
        vi.useFakeTimers({toFake: ['Date']});
        vi.setSystemTime(new Date('2026-10-13T09:00:00Z'));
        const fresh = deferred<Response>();
        let reads = 0;
        let signal: AbortSignal | undefined;
        async function readFocusedPacking(request: Request): Promise<Response> {
            if (new URL(request.url).pathname === '/api/v1/session') return json(session);
            if (++reads === 1) return json(packing);
            signal = request.signal;
            return fresh.promise;
        }
        const {context} = await mounted(PackingPage, {}, readFocusedPacking, '/frontend-pilot/packing/' + eventId);
        const stop = context.start();
        cleanups.push(stop);
        vi.setSystemTime(new Date('2026-10-13T09:00:31Z'));
        window.dispatchEvent(new Event('focus'));
        await flushPromises();
        // Session success re-enables the stale observer. The same focus continuation
        // joins its promise rather than aborting it and dispatching another request.
        expect(reads).toBe(2);
        expect(signal?.aborted).toBe(false);
        fresh.resolve(json(packing));
        await flushPromises();
        expect(reads).toBe(2);
    });

    it('preserves admitted picker reads during bootstrap and keeps terminal discovery explicitly recoverable',
        async function preservesPickerReadLifetime() {
            const options = deferred<components['schemas']['EventPickerOptions']>();
            const bootstrap = deferred<Response>();
            let signal: AbortSignal | undefined;
            let denied = false;
            let sessionReads = 0;
            const search = vi.fn<PilotEventPickerSource['search']>(async function readAdmittedOptions(_query, _scope, currentSignal) {
                signal = currentSignal;
                if (search.mock.calls.length === 1) return options.promise;
                if (denied) throw new ApiFailure(403, {type: 'about:blank', title: 'Forbidden', status: 403,
                    detail: 'Discovery access changed.', requestId: 'picker-terminal-rejection', code: 'FORBIDDEN',
                    messageKey: 'api:errors.FORBIDDEN', params: {}});
                return {items: [event], selected: null, nextCursor: null};
            });
            const {wrapper, context} = await mounted(EventPicker,
                {prefix: 'session-admitted-options', inline: true, modelValue: null, source: pickerSource(search)},
                async () => ++sessionReads === 1 ? bootstrap.promise : json(session));
            const checking = context.refreshSession();
            await flushPromises();
            expect(signal?.aborted).toBe(false);
            options.resolve({items: [event], selected: null, nextCursor: null});
            await flushPromises();
            expect(wrapper.get('[data-event-id="' + eventId + '"]').text()).toContain(event.title);
            bootstrap.resolve(json(session));
            await checking;
            await flushPromises();
            expect(search).toHaveBeenCalledOnce();

            // A terminal error suppresses automatic session resume but the visible
            // discovery Retry can still admit its result against feature eligibility.
            denied = true;
            await context.queryClient.refetchQueries({queryKey: ['selection-fixture'], type: 'active'});
            await flushPromises();
            await context.refreshSession();
            await flushPromises();
            expect(search).toHaveBeenCalledTimes(2);
            denied = false;
            await wrapper.findAll('button').find(button => button.text() === context.messages.value.t('common.retry'))!.trigger('click');
            await flushPromises();
            expect(search).toHaveBeenCalledTimes(3);
            expect(wrapper.get('[data-event-id="' + eventId + '"]').text()).toContain(event.title);
        });

    it('keeps terminal read rejection out of automatic session resumes and restores polling after explicit recovery',
        async function preservesTerminalReadPolicy() {
            vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date']});
            let denied = false;
            let reads = 0;
            async function readRecoverableRegion(request: Request): Promise<Response> {
                if (new URL(request.url).pathname === '/api/v1/session') return json(session);
                reads++;
                return denied ? readFailure(403, 'future') : json(region(request));
            }
            const {wrapper, context} = await mounted(OverviewRegion, {collection: 'owner', region: 'main'}, readRecoverableRegion);
            denied = true;
            await context.queryClient.refetchQueries({queryKey: overviewKeys.all(session.context), type: 'active'});
            await flushPromises();
            expect(reads).toBe(2);
            for (let attempt = 0; attempt < 3; attempt++) {
                await vi.advanceTimersByTimeAsync(30_000);
                await context.refreshSession();
                await flushPromises();
            }
            expect(reads).toBe(2);

            // A user can recover the disabled observer through its existing control.
            // Query state success must then restore its normal healthy polling lifetime.
            denied = false;
            await wrapper.findAll('button').find(button => button.text() === context.messages.value.t('common.retry'))!.trigger('click');
            await flushPromises();
            expect(reads).toBe(3);
            expect(wrapper.findComponent(OverviewCard).exists()).toBe(true);
            await vi.advanceTimersByTimeAsync(34_000);
            await flushPromises();
            expect(reads).toBe(4);
        });

    it.each([false, true])('retires denied Overview aggregate sources while preserving independent sibling authority (hidden open=%s)',
        async function retiresAggregateSources(hiddenOpen) {
            let denyMain = false;
            let denyHidden = false;
            async function readCountRegion(request: Request): Promise<Response> {
                const parameters = new URL(request.url).searchParams;
                const selectedRegion = parameters.get('region');
                if (parameters.get('collection') === 'owner' && (selectedRegion === 'main' ? denyMain : denyHidden))
                    return readFailure(403, 'future');
                return json({...region(request), collection: parameters.get('collection'), region: selectedRegion,
                    totalEntities: 2, hiddenEntities: 1, regionEntities: 1, matchingEntities: 1,
                    totalCards: 1, hasNext: false});
            }
            const {wrapper, context} = await mounted(OverviewPage, {}, readCountRegion,
                '/frontend-pilot' + (hiddenOpen ? '?owner_hidden_open=1' : ''));
            const ownerBadge = () => wrapper.get('[aria-controls="overview-owner"] .badge').text();
            expect(ownerBadge()).toBe('2');
            denyMain = true;
            await context.queryClient.refetchQueries({queryKey: overviewKeys.regionAuthority(session.context, 'owner', 'main')});
            await flushPromises();
            expect(wrapper.get('[data-collection="owner"][data-region="main"]').findComponent(OverviewCard).exists()).toBe(false);
            expect(ownerBadge()).toBe(hiddenOpen ? '2' : '…');
            expect(wrapper.get('[aria-controls="overview-participant"] .badge').text()).toBe('2');
            if (hiddenOpen) {
                // The hidden region remains an independent admitted source until
                // its own denial; losing the main region does not fabricate zero.
                denyHidden = true;
                await context.queryClient.refetchQueries({queryKey: overviewKeys.regionAuthority(session.context, 'owner', 'hidden')});
                await flushPromises();
                expect(ownerBadge()).toBe('…');
                expect(wrapper.get('[aria-controls="overview-owner-hidden"] .badge').text()).toBe('…');
            } else expect(wrapper.find('[aria-controls="overview-owner-hidden"]').exists()).toBe(false);
        });

    it('keeps the real shell draft mounted through failed session Retry and healthy recovery', async () => {
        vi.useFakeTimers({toFake: ['Date']});
        const successfulTime = new Date('2026-10-11T08:20:00Z');
        vi.setSystemTime(successfulTime);
        let unavailable = false;
        const draft = defineComponent({template: '<input data-session-draft value="Initial draft" />'});
        const {root, context} = await mounted(draft, {}, async () => {
            if (unavailable) throw new TypeError('The session connection failed.');
            return json(session);
        }, '/frontend-pilot', '/before', App);
        const input = root.get<HTMLInputElement>('[data-session-draft]');
        await input.setValue('Unsaved session recovery draft');
        input.element.focus();
        input.element.setSelectionRange(2, 9);
        unavailable = true;
        vi.setSystemTime(new Date('2026-10-11T08:20:30Z'));
        await context.refreshSession().catch(() => {});
        await flushPromises();
        const warning = root.get('.pilot-page-notices .status-notice.alert-warning');
        const retry = warning.get('button');
        expect(retry.text()).toBe(context.messages.value.t('common.retry'));
        expect(warning.text()).toContain(context.messages.value.t('state.stale'));
        expect(warning.get('[data-last-successful-refresh] time').attributes('datetime')).toBe(successfulTime.toISOString());
        expect(context.ready.value).toBe(true);

        // The control invokes the actual shell/bootstrap owner. A second failure
        // keeps one warning and the same successful receipt, draft and focus.
        await retry.trigger('click');
        await flushPromises();
        expect(root.findAll('.pilot-page-notices .status-notice.alert-warning')).toHaveLength(1);
        expect(warning.get('[data-last-successful-refresh] time').attributes('datetime')).toBe(successfulTime.toISOString());
        expect(root.get('[data-session-draft]').element).toBe(input.element);
        expect(input.element.value).toBe('Unsaved session recovery draft');
        expect([input.element.selectionStart, input.element.selectionEnd]).toEqual([2, 9]);
        expect(document.activeElement).toBe(input.element);

        unavailable = false;
        await retry.trigger('click');
        await flushPromises();
        expect(root.find('.pilot-page-notices .status-notice.alert-warning').exists()).toBe(false);
        expect(root.get('[data-session-draft]').element).toBe(input.element);
        expect(document.activeElement).toBe(input.element);
    });

    it('presents the real shell session deadline and prevents focus, timer and manual bypass', async () => {
        vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date']});
        vi.setSystemTime(new Date('2026-10-11T08:30:00Z'));
        let limited = false;
        let reads = 0;
        const draft = defineComponent({template: '<input data-session-draft value="Retained draft" />'});
        const {root, context} = await mounted(draft, {}, async () => {
            reads++;
            return limited ? new Response(JSON.stringify({type: 'urn:surveyor:problem:future-unavailable', title: 'Unavailable',
                status: 503, detail: 'The session read is temporarily unavailable.', requestId: 'shell-session-deadline'}),
                {status: 503, headers: {'Content-Type': 'application/json', 'Retry-After': '91'}}) : json(session);
        }, '/frontend-pilot', '/before', App);
        const stop = context.start();
        cleanups.push(stop);
        await context.refreshSession();
        limited = true;
        await context.refreshSession().catch(() => {});
        await flushPromises();
        const warning = root.get('.pilot-page-notices .status-notice.alert-warning');
        const retry = warning.get('button');
        const deadline = new Date(Date.now() + 91_000);
        expect(warning.get('[data-read-retry-at] time').attributes('datetime')).toBe(deadline.toISOString());
        expect(warning.text()).toContain('The session read is temporarily unavailable.');
        expect(retry.attributes('disabled')).toBeDefined();
        await retry.trigger('click');
        window.dispatchEvent(new Event('focus'));
        await vi.advanceTimersByTimeAsync(90_999);
        await flushPromises();
        expect(reads).toBe(2);
        expect(context.ready.value).toBe(true);
        expect(root.get('[data-session-draft]').element).toBeDefined();

        limited = false;
        await vi.advanceTimersByTimeAsync(2);
        await flushPromises();
        expect(warning.find('[data-read-retry-at]').exists()).toBe(false);
        expect(retry.attributes('disabled')).toBeUndefined();
        await retry.trigger('click');
        await flushPromises();
        expect(reads).toBe(3);
        expect(root.find('.pilot-page-notices .status-notice.alert-warning').exists()).toBe(false);
    });

    it('preserves the native Filter disclosure, submit choices and English count caption', async () => {
        const projection = {...region(new Request('http://localhost/overview')), q: 'fixture',
            matchingEntities: 1, totalCards: 1, hasNext: false};
        const native = nativeOverviewRegion(projection);
        const nativeForm = native.querySelector<HTMLFormElement>('.js-overview-search')!;
        const {wrapper} = await mounted(OverviewRegion, {collection: 'owner', region: 'main'},
            async () => json(projection), '/frontend-pilot?owner_main_q=fixture');
        const form = wrapper.get('form');
        const trigger = form.get('summary');
        const nativeTrigger = nativeForm.querySelector<HTMLElement>('.dropdown-toggle')!;
        expect(trigger.attributes('role')).toBe(nativeTrigger.getAttribute('role') ?? nativeTrigger.tagName.toLowerCase());
        expect(trigger.text()).toBe(nativeTrigger.textContent);
        expect([...trigger.element.classList].sort()).toEqual([...nativeTrigger.classList].sort());
        expect(trigger.find('i, .badge').exists()).toBe(false);
        expect(form.find('ul.dropdown-menu > li > hr.dropdown-divider').exists()).toBe(true);
        expect(filterChoices(form.element)).toEqual(filterChoices(nativeForm));
        expect(form.get('[aria-live="polite"]').text()).toBe(nativeForm.querySelector('[aria-live="polite"]')!.textContent);
        const search = form.get<HTMLButtonElement>('button[type="submit"]');
        const nativeSearch = nativeForm.querySelector<HTMLButtonElement>('button[type="submit"]')!;
        expect([search.element.name, search.element.value]).toEqual([nativeSearch.name, nativeSearch.value]);
        // No general clear action existed in the native toolbar. Selected-event recovery
        // keeps its separate Show all my linked entities link below this form.
        expect(form.find('a, select').exists()).toBe(false);

        await trigger.trigger('keydown', {key: 'ArrowDown'});
        expect(form.get<HTMLDetailsElement>('details').element.open).toBe(true);
        await form.get('button[data-type="survey"]').trigger('click');
        await flushPromises();
        expect(form.get<HTMLDetailsElement>('details').element.open).toBe(false);
    });

    it.each([0, 2])('omits native search controls and retains Refresh after confirming an unfiltered empty region (%s total entities)', async total => {
        const projection = {...region(new Request('http://localhost/overview')), availableTypes: [], items: [],
            totalEntities: total, hiddenEntities: total, regionEntities: 0, matchingEntities: 0,
            totalCards: 0, hasNext: false};
        const native = nativeOverviewRegion(projection);
        const {wrapper} = await mounted(OverviewRegion, {collection: 'owner', region: 'main'}, async () => json(projection));
        expect(native.querySelector('.js-overview-search')).toBeNull();
        expect(wrapper.find('input[type="search"]').exists()).toBe(false);
        expect(wrapper.find('details').exists()).toBe(false);
        expect(wrapper.findAll('button').map(button => button.text())).toEqual(['Refresh']);
        const nativeNotice = native.querySelector('.status-notice')!.textContent;
        expect(wrapper.text()).toContain(nativeNotice);
    });

    it.each(['main', 'hidden'] as const)('refreshes an empty %s region without losing its focused control or duplicating a pending read', async selectedRegion => {
        const fresh = deferred<Response>();
        let reads = 0;
        const empty = {...region(new Request('http://localhost/overview')), region: selectedRegion,
            availableTypes: [], items: [], totalEntities: 0, hiddenEntities: 0,
            regionEntities: 0, matchingEntities: 0, totalCards: 0, hasNext: false};

        /** Keep the read pending until a second visible Refresh attempt has
         * exercised the existing action lock. The server alone supplies new membership. */
        async function readEmptyRegion(): Promise<Response> {
            reads++;
            return reads === 1 ? json(empty) : fresh.promise;
        }

        const {wrapper, router, context} = await mounted(OverviewRegion,
            {collection: 'owner', region: selectedRegion}, readEmptyRegion);
        const refresh = wrapper.get<HTMLButtonElement>('button');
        expect(refresh.text()).toBe('Refresh');
        expect(refresh.attributes('type')).toBe('button');
        expect(wrapper.find('input[type="search"], details, nav').exists()).toBe(false);
        refresh.element.focus();
        const origin = router.currentRoute.value.fullPath;
        await refresh.trigger('click');
        await flushPromises();
        expect(refresh.element.disabled).toBe(true);
        await refresh.trigger('click');
        expect(reads).toBe(2);

        // New remote content restores search/filter controls through the same
        // owner, retaining the actual focused Refresh element and current URL.
        fresh.resolve(json({...empty, availableTypes: ['survey'], items: [card], totalEntities: 1,
            hiddenEntities: selectedRegion === 'hidden' ? 1 : 0, regionEntities: 1,
            matchingEntities: 1, totalCards: 1}));
        await flushPromises();
        expect(wrapper.get('h4.card-title').text()).toBe(card.title);
        expect(wrapper.find('input[type="search"]').exists()).toBe(true);
        expect(wrapper.findAll('button').filter(button => button.text() === 'Refresh')[0]!.element).toBe(refresh.element);
        expect(refresh.element.disabled).toBe(false);
        expect(document.activeElement).toBe(refresh.element);
        expect(router.currentRoute.value.fullPath).toBe(origin);
        expect(context.capture().context).toBe(session.context);
        expect(reads).toBe(2);
    });

    it.each([
        {query: '   ', canonical: ''},
        {query: ' fixture ', canonical: 'fixture'},
    ])('renders the native canonical search from a bookmarked initial query $query', async value => {
        const projection = {...region(new Request('http://localhost/overview')), q: value.canonical};
        if (!projection.q) Object.assign(projection, {availableTypes: [], items: [], totalEntities: 0,
            hiddenEntities: 0, regionEntities: 0, matchingEntities: 0, totalCards: 0, hasNext: false});
        const native = nativeOverviewRegion(projection);
        const {wrapper} = await mounted(OverviewRegion, {collection: 'owner', region: 'main'},
            async () => json(projection), '/frontend-pilot?owner_main_q=' + encodeURIComponent(value.query));
        expect(wrapper.find('input[type="search"]').exists()).toBe(!!native.querySelector('.js-overview-search'));
        if (value.canonical) {
            expect(wrapper.get<HTMLInputElement>('input[type="search"]').element.value)
                .toBe(native.querySelector<HTMLInputElement>('input[type="search"]')!.value);
        }
    });

    it('retains the focused search draft when its current manual Refresh confirms empty membership', async () => {
        vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout', 'Date']});
        const projection = {...region(new Request('http://localhost/overview')), availableTypes: [], items: [],
            totalEntities: 0, hiddenEntities: 0, regionEntities: 0, matchingEntities: 0,
            totalCards: 0, hasNext: false};
        const authority = deferred<Response>();
        let reads = 0;
        async function read(request: Request): Promise<Response> {
            reads++;
            if (reads === 1) return json(region(request));
            if (reads === 2) return authority.promise;
            return json({...projection, q: new URL(request.url).searchParams.get('q') ?? ''});
        }
        const {wrapper, router, context} = await mounted(OverviewRegion, {collection: 'owner', region: 'main'}, read);
        const input = wrapper.get<HTMLInputElement>('input[type="search"]');
        input.element.focus();
        await input.setValue('early search');
        input.element.setSelectionRange(1, 4);
        // Input retires reads that started before this draft. The real Refresh
        // starts afterward, so its empty projection is admitted by the same query
        // observer rather than merely exercising cancellation of an obsolete GET.
        await wrapper.findAll('button').find(button => button.text() === 'Refresh')!.trigger('click');
        await flushPromises();
        expect(reads).toBe(2);
        authority.resolve(json(projection));
        await flushPromises();
        expect(context.queryClient.getQueryData(overviewKeys.region(session.context, 'en',
            {collection: 'owner', region: 'main', q: undefined, type: undefined, page: undefined,
                childPage: undefined, eventId: undefined}))).toEqual(projection);
        expect(wrapper.get('[aria-live="polite"]').text()).toBe('0 matching entities');
        expect(wrapper.get('input[type="search"]').element).toBe(input.element);
        expect(input.element.value).toBe('early search');
        expect(document.activeElement).toBe(input.element);
        expect([input.element.selectionStart, input.element.selectionEnd]).toEqual([1, 4]);
        await vi.advanceTimersByTimeAsync(300);
        await flushPromises();
        expect(router.currentRoute.value.query.owner_main_q).toBe('early search');
        expect(wrapper.get('input[type="search"]').element).toBe(input.element);
    });

    it.each([
        {query: '', draft: '   ', canonical: ''},
        {query: 'fixture', draft: ' fixture ', canonical: 'fixture'},
    ])('adopts the native canonical search after successful submission when the URL q remains $query', async value => {
        vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout', 'Date']});
        let initial = true;
        let confirmed!: components['schemas']['OverviewRegion'];
        async function read(request: Request): Promise<Response> {
            const result = region(request);
            if (initial) { initial = false; return json(result); }
            confirmed = {...result, q: new URL(request.url).searchParams.get('q')?.trim() ?? ''};
            if (!confirmed.q) confirmed = {...confirmed, availableTypes: [], items: [], totalEntities: 0,
                hiddenEntities: 0, regionEntities: 0, matchingEntities: 0, totalCards: 0, hasNext: false};
            return json(confirmed);
        }
        const path = '/frontend-pilot' + (value.query ? '?owner_main_q=' + value.query : '');
        const {wrapper, router} = await mounted(OverviewRegion, {collection: 'owner', region: 'main'}, read, path);
        await wrapper.get('input[type="search"]').setValue(value.draft);
        await wrapper.get('form').trigger('submit');
        await flushPromises();
        expect(router.currentRoute.value.query.owner_main_q).toBe(value.canonical || undefined);
        const native = nativeOverviewRegion(confirmed);
        expect(wrapper.find('input[type="search"]').exists()).toBe(!!native.querySelector('.js-overview-search'));
        if (value.canonical) {
            expect(wrapper.get<HTMLInputElement>('input[type="search"]').element.value)
                .toBe(native.querySelector<HTMLInputElement>('input[type="search"]')!.value);
        }
    });

    it('keeps newer focused input when an older canonical search response finishes', async () => {
        vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout', 'Date']});
        const submitted = deferred<Response>();
        let heldRequest!: Request;
        async function read(request: Request): Promise<Response> {
            if (new URL(request.url).searchParams.get('q') === ' fixture ') {
                heldRequest = request;
                return submitted.promise;
            }
            return json(region(request));
        }
        const {wrapper, router} = await mounted(OverviewRegion, {collection: 'owner', region: 'main'}, read,
            '/frontend-pilot?owner_main_q=fixture');
        const input = wrapper.get<HTMLInputElement>('input[type="search"]');
        input.element.focus();
        await input.setValue(' fixture ');
        await wrapper.get('form').trigger('submit');
        await flushPromises();
        await input.setValue('newer search');
        input.element.setSelectionRange(1, 4);
        submitted.resolve(json({...region(heldRequest), q: 'fixture'}));
        await flushPromises();
        expect(input.element.value).toBe('newer search');
        expect(document.activeElement).toBe(input.element);
        expect([input.element.selectionStart, input.element.selectionEnd]).toEqual([1, 4]);
        await vi.advanceTimersByTimeAsync(300);
        await flushPromises();
        expect(router.currentRoute.value.query.owner_main_q).toBe('newer search');
        expect(input.element.value).toBe('newer search');
    });

    it('renders the native canonical search after Back reuses equal raw and canonical cached projections', async () => {
        const rawQuery = ' fixture ';
        const previous = '/frontend-pilot?owner_main_q=' + encodeURIComponent(rawQuery);
        async function read(request: Request): Promise<Response> {
            const projection = region(request);
            return json({...projection, q: projection.q.trim()});
        }
        const {wrapper, router, context} = await mounted(OverviewRegion, {collection: 'owner', region: 'main'}, read,
            previous + '&participant_main_q=other', previous);
        const input = wrapper.get<HTMLInputElement>('input[type="search"]');
        await input.setValue(rawQuery);
        await wrapper.get('form').trigger('submit');
        await flushPromises();
        expect(router.currentRoute.value.query.owner_main_q).toBe('fixture');
        const parameters = {collection: 'owner' as const, region: 'main' as const, q: rawQuery,
            type: undefined, page: undefined, childPage: undefined, eventId: undefined};
        const rawKey = overviewKeys.region(session.context, 'en', parameters);
        const canonicalKey = overviewKeys.region(session.context, 'en', {...parameters, q: 'fixture'});
        const projection = context.queryClient.getQueryData<components['schemas']['OverviewRegion']>(rawKey)!;
        // Normal navigation writes these equivalent observations. Exercise the
        // actual cache transition without assuming cross-key object identity or
        // injecting either entry into the production query lifecycle.
        expect(context.queryClient.getQueryData(canonicalKey)).toEqual(projection);

        router.back();
        await flushPromises();
        expect(router.currentRoute.value.query.owner_main_q).toBe(rawQuery);
        await wrapper.findAll('button').find(button => button.text() === 'Refresh')!.trigger('click');
        await flushPromises();
        expect(context.queryClient.getQueryData(rawKey)).toBe(projection);
        const native = nativeOverviewRegion(projection);
        expect(wrapper.get<HTMLInputElement>('input[type="search"]').element.value)
            .toBe(native.querySelector<HTMLInputElement>('input[type="search"]')!.value);
    });

    it.each(['next', 'previous', 'retry'] as const)('marks only the initiating picker %s action pending on a retained middle page', async action => {
        type Options = Awaited<ReturnType<PilotEventPickerSource['search']>>;
        const held = deferred<Options>();
        let phase: 'ready' | 'reject' | 'held' = 'ready';
        let heldCursor: string | undefined;
        function pageOptions(cursor?: string): Options {
            const page = Number(cursor?.replace('page-', '') ?? 1);
            return {items: [event], selected: null, nextCursor: `page-${page + 1}`};
        }
        const search = vi.fn<PilotEventPickerSource['search']>(async query => {
            if (phase === 'reject') throw new ApiFailure(400, null, null, 'Temporary page rejection', true);
            if (phase === 'held') { heldCursor = query.cursor; return held.promise; }
            return pageOptions(query.cursor);
        });
        const {wrapper, context} = await mounted(EventPicker,
            {prefix: 'pending-picker', inline: true, modelValue: null, source: pickerSource(search)});
        function pagingButton(kind: 'next' | 'previous' | 'retry') {
            const label = context.messages.value.t(kind === 'retry' ? 'common.retry'
                : kind === 'next' ? 'eventPicker.nextPage' : 'eventPicker.previousPage');
            return wrapper.findAll('button').find(button => button.text() === label)!;
        }
        // Page three keeps both neighboring controls mounted after either move.
        for (let visit = 0; visit < 2; visit++) {
            await pagingButton('next').trigger('click');
            await flushPromises();
        }
        if (action === 'retry') {
            phase = 'reject';
            await pagingButton('next').trigger('click');
            await flushPromises();
        }
        phase = 'held';
        const initiator = pagingButton(action);
        const element = initiator.element as HTMLButtonElement;
        element.focus();
        await initiator.trigger('click');
        await flushPromises();
        try {
            expect(initiator.attributes('disabled')).toBeDefined();
            expect(initiator.attributes('aria-busy')).toBe('true');
            expect(initiator.find('.spinner-border').exists()).toBe(true);
            for (const kind of ['next', 'previous'] as const) {
                if (kind === action) continue;
                const sibling = pagingButton(kind);
                expect(sibling.attributes('disabled')).toBeDefined();
                expect(sibling.attributes('aria-busy')).toBe('false');
                expect(sibling.find('.spinner-border').exists()).toBe(false);
            }
            // happy-dom needs the browser's disabled-button focus loss simulated;
            // the built Reload regression owns actual Chromium focus mechanics.
            document.body.tabIndex = -1;
            document.body.focus();
            document.body.removeAttribute('tabindex');
            expect(document.activeElement).toBe(document.body);
        } finally {
            held.resolve(pageOptions(heldCursor));
            await flushPromises();
        }
        if (action !== 'retry') expect(document.activeElement).toBe(element);
        else expect(element.isConnected).toBe(false);
    });

    it('keeps picker background reads and typed-filter debounce out of paging busy presentation', async () => {
        vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date']});
        const held = deferred<Awaited<ReturnType<PilotEventPickerSource['search']>>>();
        let hold = false;
        const search = vi.fn<PilotEventPickerSource['search']>(async query => hold ? held.promise
            : {items: [event], selected: null, nextCursor: query.cursor ? 'page-three' : 'page-two'});
        const {wrapper, context} = await mounted(EventPicker,
            {prefix: 'background-picker', inline: true, modelValue: null, source: pickerSource(search)});
        function pagingButtons() {
            return wrapper.findAll('button').filter(button => [context.messages.value.t('eventPicker.nextPage'),
                context.messages.value.t('eventPicker.previousPage')].includes(button.text()));
        }
        await pagingButtons()[0]!.trigger('click');
        await flushPromises();
        hold = true;
        const reading = context.queryClient.refetchQueries({type: 'active'});
        await flushPromises();
        try {
            expect(pagingButtons()).toHaveLength(2);
            for (const button of pagingButtons()) {
                expect(button.attributes('disabled')).toBeDefined();
                expect(button.attributes('aria-busy')).toBe('false');
                expect(button.find('.spinner-border').exists()).toBe(false);
            }
        } finally {
            held.resolve({items: [event], selected: null, nextCursor: 'page-three'});
            await reading;
            await flushPromises();
        }
        await wrapper.get('#background-picker-search').setValue('camp');
        for (const button of pagingButtons()) {
            expect(button.attributes('disabled')).toBeDefined();
            expect(button.attributes('aria-busy')).toBe('false');
        }
    });

    it('releases a picker page marker when a fresh cached target dispatches no read', async () => {
        const held = deferred<Awaited<ReturnType<PilotEventPickerSource['search']>>>();
        let hold = false;
        const search = vi.fn<PilotEventPickerSource['search']>(async () => hold ? held.promise
            : {items: [event], selected: null, nextCursor: 'page-two'});
        const source: PilotEventPickerSource = {search,
            filterKey: () => ['cached-picker'], pageKey: (_actor, _locale, _filters, query) => ['cached-picker', query.cursor ?? 'first']};
        const {wrapper, context} = await mounted(EventPicker,
            {prefix: 'cached-picker', inline: true, modelValue: null, source});
        context.queryClient.setQueryData(['cached-picker', 'page-two'], {items: [event], selected: null, nextCursor: 'page-three'});
        const next = wrapper.findAll('button').find(button => button.text() === context.messages.value.t('eventPicker.nextPage'))!;
        await next.trigger('click'); await flushPromises();
        expect(search).toHaveBeenCalledOnce();

        // That cached transition owns no pending read. A later background fetch
        // must not inherit its former Next action's spinner or focus claim.
        hold = true;
        const reading = context.queryClient.refetchQueries({type: 'active'});
        await flushPromises();
        try {
            expect(next.attributes('disabled')).toBeDefined();
            expect(next.attributes('aria-busy')).toBe('false');
            expect(next.find('.spinner-border').exists()).toBe(false);
        } finally {
            held.resolve({items: [event], selected: null, nextCursor: 'page-three'});
            await reading;
            await flushPromises();
        }
    });

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
        expect(wrapper.props()).toMatchObject({modelValue: eventId});
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
        expect(wrapper.props()).toMatchObject({modelValue: eventId});
    });

    it('does not restore a retired selection when its old discovery resolves after a new selection', async () => {
        const first = deferred<components['schemas']['EventPickerOptions']>();
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
    it('adopts clamped page and revoked-parent navigation before publishing history without another GET', async () => {
        let reads = 0;
        const {wrapper, router} = await mounted(OverviewRegion, {collection: 'owner', region: 'main'}, async request => {
            reads++;
            const desired = new URL(request.url).searchParams;
            // A collection can shrink or revoke a grouped parent after its original cards
            // rendered. The returned bounded state is the sole navigation authority.
            if (desired.has('eventId')) return json({...eventRegion(request), eventId: null, parent: null,
                items: [card], page: 1, childPage: 1});
            if (desired.get('page') === '2') return json({...eventRegion(request), page: 1, hasNext: false});
            return json(eventRegion(request));
        });
        await wrapper.get(`a[data-overview-event="${eventId}"]`).trigger('click');
        await flushPromises();
        expect(router.currentRoute.value.query.owner_main_event).toBeUndefined();
        expect(wrapper.text()).toContain(card.title);
        expect(reads).toBe(2);
        await wrapper.findAll('a').find(link => link.text() === 'Next')!.trigger('click');
        await flushPromises();
        expect(router.currentRoute.value.query.owner_main_page).toBeUndefined();
        expect(reads).toBe(3);
    });

    it('discards cached cards and their actions when an authoritative background refresh denies access', async () => {
        let denied = false;
        const {wrapper, context} = await mounted(OverviewRegion, {collection: 'owner', region: 'main'}, async request => {
            if (denied) return new Response(JSON.stringify({type: 'about:blank', title: 'Not allowed', status: 403,
                detail: 'Access changed.', requestId: 'overview-denial', code: 'FORBIDDEN',
                messageKey: 'api:errors.FORBIDDEN', params: {}}), {status: 403,
                headers: {'Content-Type': 'application/json', 'X-Surveyor-Context': session.context}});
            return json(region(request));
        });
        expect(wrapper.text()).toContain(card.title);
        denied = true;
        await context.queryClient.refetchQueries({queryKey: overviewKeys.all(session.context), type: 'active'});
        await flushPromises();
        // A denied observer keeps its recoverable error, but no previously admitted
        // data remains available to this or a later filter's presentation.
        expect(context.queryClient.getQueryData(overviewKeys.region(session.context, 'en',
            {collection: 'owner', region: 'main', q: undefined, type: undefined, page: undefined,
                childPage: undefined, eventId: undefined}))).toBeUndefined();
        expect(wrapper.text()).not.toContain(card.title);
        expect(wrapper.findComponent(OverviewCard).exists()).toBe(false);
        expect(wrapper.find('[data-last-successful-refresh]').exists()).toBe(false);
    });

    // Each status and unusable format reaches this actual consumer once. The
    // transport suite owns complete wire classification; repeating their full
    // Cartesian product here does not exercise a different projection lifetime.
    it.each([
        {status: 401, representation: 'html'},
        {status: 403, representation: 'malformed'},
        {status: 404, representation: 'mismatched'},
    ] as const)('retains confirmed cards and focused input after an unusable $status $representation read', async value => {
        vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date']});
        let unavailable = false;
        const {wrapper, context} = await mounted(OverviewRegion, {collection: 'owner', region: 'main'}, async request => {
            return unavailable ? readFailure(value.status, value.representation) : json(region(request));
        });
        const currentCard = wrapper.findComponent(OverviewCard).element;
        const observedAt = new Date().toISOString();
        const input = wrapper.get<HTMLInputElement>('input[type="search"]');
        await input.setValue('Unsubmitted overview draft');
        input.element.focus();
        input.element.setSelectionRange(5, 12);

        unavailable = true;
        await context.queryClient.refetchQueries({queryKey: overviewKeys.all(session.context), type: 'active'});
        await flushPromises();
        expect(wrapper.findComponent(OverviewCard).element).toBe(currentCard);
        expect(wrapper.text()).toContain(context.messages.value.t('state.stale'));
        expect(wrapper.get('[data-last-successful-refresh] time').attributes('datetime')).toBe(observedAt);
        expect(wrapper.get<HTMLInputElement>('input[type="search"]').element).toBe(input.element);
        expect(input.element.value).toBe('Unsubmitted overview draft');
        expect([input.element.selectionStart, input.element.selectionEnd]).toEqual([5, 12]);
        expect(document.activeElement).toBe(input.element);
        expect(context.ready.value).toBe(true);
        expect(context.queryClient.getQueryData(overviewKeys.region(session.context, 'en',
            {collection: 'owner', region: 'main', q: undefined, type: undefined, page: undefined,
                childPage: undefined, eventId: undefined}))).toBeDefined();
    });

    it.each([401, 403, 404])('retires protected cards after a validated safe future denial and presents the next recovery deadline (%s)', async status => {
        vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date']});
        let stage: 'healthy' | 'denied' | 'limited' | 'recovering' = 'healthy';
        const recovery = deferred<Response>();
        let recoveryRequest!: Request;
        const limitedStatus = status === 401 ? 429 : 503;
        const detail = 'The next Overview read is temporarily unavailable.';
        const {wrapper, context, request} = await mounted(OverviewRegion, {collection: 'owner', region: 'main'}, async current => {
            if (stage === 'denied') return readFailure(status, 'future');
            if (stage === 'limited') return new Response(JSON.stringify({type: 'about:blank', title: 'Unavailable',
                status: limitedStatus, detail, requestId: 'overview-recovery-deadline'}), {status: limitedStatus,
                headers: {'Content-Type': 'application/problem+json', 'X-Surveyor-Context': session.context, 'Retry-After': '90'}});
            if (stage === 'recovering') { recoveryRequest = current; return recovery.promise; }
            return json(region(current));
        });
        expect(wrapper.findComponent(OverviewCard).exists()).toBe(true);
        stage = 'denied';
        await context.queryClient.refetchQueries({queryKey: overviewKeys.all(session.context), type: 'active'});
        await flushPromises();
        expect(wrapper.findComponent(OverviewCard).exists()).toBe(false);
        expect(wrapper.find('[data-last-successful-refresh]').exists()).toBe(false);
        expect(context.queryClient.getQueryData(overviewKeys.region(session.context, 'en',
            {collection: 'owner', region: 'main', q: undefined, type: undefined, page: undefined,
                childPage: undefined, eventId: undefined}))).toBeUndefined();
        // Unknown machine codes retire the denied resource, never actor identity.
        expect(context.ready.value).toBe(true);

        // The barrier must not replace a newer failed GET's safe issue/deadline.
        // Neither temporary failure nor its queued recovery restores private data.
        stage = 'limited';
        const retry = wrapper.findAll('button').find(button => button.text() === context.messages.value.t('common.retry'))!;
        await retry.trigger('click');
        await flushPromises();
        expect(request).toHaveBeenCalledTimes(3);
        expect(wrapper.get('[data-read-issue]').text()).toBe(detail);
        expect(wrapper.get('[data-read-retry-at] time').attributes('datetime')).toBe(new Date(Date.now() + 90_000).toISOString());
        expect(retry.attributes('disabled')).toBeDefined();
        expect(wrapper.findComponent(OverviewCard).exists()).toBe(false);
        expect(wrapper.find('[data-last-successful-refresh]').exists()).toBe(false);
        await retry.trigger('click');
        await vi.advanceTimersByTimeAsync(89_999);
        await flushPromises();
        expect(request).toHaveBeenCalledTimes(3);
        expect(wrapper.findComponent(OverviewCard).exists()).toBe(false);

        // The ordinary read observer can converge after the shared deadline. Its
        // successful body, rather than expiry alone, releases the authority barrier.
        stage = 'recovering';
        await vi.advanceTimersByTimeAsync(2);
        await flushPromises();
        expect(request).toHaveBeenCalledTimes(4);
        expect(wrapper.findComponent(OverviewCard).exists()).toBe(false);
        recovery.resolve(json(region(recoveryRequest)));
        await flushPromises();
        expect(wrapper.findComponent(OverviewCard).exists()).toBe(true);
        expect(wrapper.find('[data-read-issue]').exists()).toBe(false);
        expect(wrapper.find('[data-read-retry-at]').exists()).toBe(false);
        expect(request.mock.calls.every(([current]) => (current as Request).method === 'GET')).toBe(true);
    });

    it('retains the matching successful refresh time through equal reads and failed route fallback', async () => {
        vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date']});
        const initialTime = new Date('2026-10-11T07:00:00Z');
        vi.setSystemTime(initialTime);
        let unavailable = false;
        const {wrapper, router, context} = await mounted(OverviewRegion, {collection: 'owner', region: 'main'}, async request => {
            return unavailable ? readFailure(403, 'html') : json(region(request));
        });
        const initialKey = overviewKeys.region(session.context, 'en', {collection: 'owner', region: 'main',
            q: undefined, type: undefined, page: undefined, childPage: undefined, eventId: undefined});
        const snapshot = context.queryClient.getQueryData(initialKey);
        vi.setSystemTime(new Date('2026-10-11T07:00:20Z'));
        unavailable = true;
        await context.queryClient.refetchQueries({queryKey: overviewKeys.all(session.context), type: 'active'});
        await flushPromises();
        expect(wrapper.text()).toContain(context.messages.value.t('state.stale'));
        expect(wrapper.get('[data-last-successful-refresh] time').attributes('datetime')).toBe(initialTime.toISOString());

        // Structural sharing retains the data object. A later successful read still
        // advances its receipt time without changing membership data.
        const recoveredTime = new Date('2026-10-11T07:00:40Z');
        vi.setSystemTime(recoveredTime);
        unavailable = false;
        await context.queryClient.refetchQueries({queryKey: overviewKeys.all(session.context), type: 'active'});
        await flushPromises();
        expect(context.queryClient.getQueryData(initialKey)).toBe(snapshot);
        expect(wrapper.find('[data-last-successful-refresh]').exists()).toBe(false);

        // A committed history/header destination has no admitted data when its own
        // read fails. The visible fallback and its date remain one scoped observation.
        vi.setSystemTime(new Date('2026-10-11T07:01:00Z'));
        unavailable = true;
        await router.push('/frontend-pilot?owner_main_page=2');
        await flushPromises();
        expect(context.queryClient.getQueryData(overviewKeys.region(session.context, 'en',
            {collection: 'owner', region: 'main', q: undefined, type: undefined, page: '2',
                childPage: undefined, eventId: undefined}))).toBeUndefined();
        expect(wrapper.findComponent(OverviewCard).exists()).toBe(true);
        expect(wrapper.text()).toContain(context.messages.value.t('state.stale'));
        expect(wrapper.get('[data-last-successful-refresh] time').attributes('datetime')).toBe(recoveredTime.toISOString());
    });

    it('shows no successful refresh time when the initial read never supplied a projection', async () => {
        const {wrapper, context} = await mounted(OverviewRegion, {collection: 'owner', region: 'main'},
            async () => readFailure(403, 'html'));
        expect(wrapper.text()).toContain(context.messages.value.t('state.loadFailed'));
        expect(wrapper.findComponent(OverviewCard).exists()).toBe(false);
        expect(wrapper.find('[data-last-successful-refresh]').exists()).toBe(false);
    });

    it.each([400, 403])('recovers an unusable %s read through the mounted observer within the approved interval', async status => {
        vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date']});
        let unavailable = false;
        const {wrapper, context, request} = await mounted(OverviewRegion, {collection: 'owner', region: 'main'}, async current => {
            return unavailable ? readFailure(status, 'html') : json(region(current));
        });
        unavailable = true;
        await context.queryClient.refetchQueries({queryKey: overviewKeys.all(session.context), type: 'active'});
        await flushPromises();
        expect(wrapper.text()).toContain(context.messages.value.t('state.stale'));
        expect(request).toHaveBeenCalledTimes(2);
        unavailable = false;

        // No manual/focus request supplies recovery. The production observer's
        // one interval must accept a fresh result and clear its own warning.
        await vi.advanceTimersByTimeAsync(60_000);
        await flushPromises();
        expect(request.mock.calls.length).toBeGreaterThan(2);
        expect(wrapper.text()).not.toContain(context.messages.value.t('state.stale'));
        expect(wrapper.findComponent(OverviewCard).exists()).toBe(true);
    });

    it('stops automatic recovery for a validated input rejection while retaining readable cards', async () => {
        vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date']});
        let rejected = false;
        const {wrapper, context, request} = await mounted(OverviewRegion, {collection: 'owner', region: 'main'}, async current => {
            return rejected ? readFailure(400, 'future') : json(region(current));
        });
        rejected = true;
        await context.queryClient.refetchQueries({queryKey: overviewKeys.all(session.context), type: 'active'});
        await flushPromises();
        expect(wrapper.text()).toContain(context.messages.value.t('state.stale'));
        expect(wrapper.text()).toContain('Read access is unavailable.');
        expect(wrapper.findComponent(OverviewCard).exists()).toBe(true);

        await vi.advanceTimersByTimeAsync(60_000);
        await flushPromises();
        expect(request).toHaveBeenCalledTimes(2);
    });

    it('presents the validated query issue beside retained cards without an automatic retry loop', async () => {
        vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date']});
        let rejected = false;
        const {wrapper, context, request} = await mounted(OverviewRegion, {collection: 'owner', region: 'main'}, async current => {
            if (!rejected) return json(region(current));
            return new Response(JSON.stringify({type: 'urn:surveyor:problem:validation-failed', title: 'Invalid query', status: 400,
                detail: 'The filter was rejected.', requestId: 'overview-query-rejection', code: 'VALIDATION_FAILED',
                messageKey: 'api:errors.VALIDATION_FAILED', params: {}}), {status: 400,
                headers: {'Content-Type': 'application/json', 'X-Surveyor-Context': session.context}});
        });
        rejected = true;
        await context.queryClient.refetchQueries({queryKey: overviewKeys.all(session.context), type: 'active'});
        await flushPromises();
        expect(wrapper.text()).toContain(context.messages.value.t('state.stale'));
        expect(wrapper.text()).toContain(context.messages.value.t('api:errors.VALIDATION_FAILED'));
        expect(wrapper.text()).not.toContain('The filter was rejected.');
        expect(wrapper.findComponent(OverviewCard).exists()).toBe(true);
        await vi.advanceTimersByTimeAsync(60_000);
        expect(request).toHaveBeenCalledTimes(2);
    });

    it.each([403, 404] as const)('retires denied region filter variants before a later navigation read (%s)', async status => {
        const held = deferred<Response>();
        let denied = false;
        let destination!: Request;
        const {wrapper, router, context} = await mounted(OverviewRegion, {collection: 'owner', region: 'main'}, async request => {
            if (new URL(request.url).searchParams.get('q') !== 'initial') {
                destination = request;
                return held.promise;
            }
            if (denied) return new Response(JSON.stringify({type: 'about:blank', title: 'Unavailable', status,
                detail: 'Access changed.', requestId: 'overview-region-denial',
                code: status === 403 ? 'FORBIDDEN' : 'NOT_FOUND',
                messageKey: status === 403 ? 'api:errors.FORBIDDEN' : 'api:errors.NOT_FOUND', params: {}}),
                {status, headers: {'Content-Type': 'application/json', 'X-Surveyor-Context': session.context}});
            return json(region(request));
        }, '/frontend-pilot?owner_main_q=initial');
        const oldVariant = overviewKeys.region(session.context, 'en', {collection: 'owner', region: 'main', q: 'older'});
        const translated = overviewKeys.region(session.context, 'de', {collection: 'owner', region: 'main', q: 'older'});
        const unrelated = overviewKeys.region(session.context, 'en', {collection: 'participant', region: 'hidden'});
        const otherActor = overviewKeys.region('another-overview-actor-1234567890', 'en', {collection: 'owner', region: 'main', q: 'older'});
        const snapshot = region(new Request('http://localhost/api/v1/overview'));
        context.queryClient.setQueryData(oldVariant, {...snapshot, q: 'older', items: [{...card, title: 'Older private card'}]});
        context.queryClient.setQueryData(translated, {...snapshot, q: 'older', items: [{...card, title: 'Translated private card'}]});
        context.queryClient.setQueryData(unrelated, {...snapshot, collection: 'participant', region: 'hidden'});
        context.queryClient.setQueryData(otherActor, snapshot);

        denied = true;
        await context.queryClient.refetchQueries({queryKey: overviewKeys.regionFamily(session.context, 'en', 'owner', 'main'), type: 'active'});
        await flushPromises();
        expect(context.queryClient.getQueryData(oldVariant)).toBeUndefined();
        expect(context.queryClient.getQueryData(translated)).toBeUndefined();
        expect(context.queryClient.getQueryData(unrelated)).toBeDefined();
        expect(context.queryClient.getQueryData(otherActor)).toBeDefined();
        expect(wrapper.text()).not.toContain(card.title);

        await router.push('/frontend-pilot');
        await flushPromises();
        try {
            // A Header/Back-owned route change starts a fresh read. Its empty error
            // state must not resurrect lastConfirmed or another cached filter's cards.
            expect(wrapper.text()).not.toContain(card.title);
            expect(wrapper.text()).not.toContain('Older private card');
            expect(wrapper.findComponent(OverviewCard).exists()).toBe(false);
        } finally {
            held.resolve(json({...region(destination), items: [{...card, title: 'Newly admitted card'}]}));
            await flushPromises();
        }
        expect(wrapper.text()).toContain('Newly admitted card');
        expect(context.queryClient.getQueryData(unrelated)).toBeDefined();
        expect(context.queryClient.getQueryData(otherActor)).toBeDefined();
    });

    it('cancels a held region target on denial and restores the current observer only through a fresh read', async () => {
        const held = deferred<Response>();
        const unrelatedRead = deferred<components['schemas']['OverviewRegion']>();
        const translatedRead = deferred<components['schemas']['OverviewRegion']>();
        let target!: Request;
        let denied = false;
        const {wrapper, context, router} = await mounted(OverviewRegion, {collection: 'owner', region: 'main'}, async request => {
            if (new URL(request.url).searchParams.get('page') === '2') { target = request; return held.promise; }
            if (denied) return new Response(JSON.stringify({type: 'about:blank', title: 'Not allowed', status: 403,
                detail: 'Access changed.', requestId: 'overview-held-denial', code: 'FORBIDDEN',
                messageKey: 'api:errors.FORBIDDEN', params: {}}), {status: 403,
                headers: {'Content-Type': 'application/json', 'X-Surveyor-Context': session.context}});
            return json(region(request));
        });
        const independentKey = overviewKeys.region(session.context, 'en', {collection: 'participant', region: 'main'});
        const independent = context.queryClient.fetchQuery({queryKey: independentKey,
            queryFn: () => unrelatedRead.promise});
        const translatedKey = overviewKeys.region(session.context, 'de', {collection: 'owner', region: 'main', q: 'older'});
        // This response deliberately ignores cancellation, like the held HTTP target.
        // Its retired query must still never regain a cache entry after it settles.
        const translated = context.queryClient.fetchQuery({queryKey: translatedKey,
            queryFn: () => translatedRead.promise}).catch(() => undefined);
        await wrapper.findAll('a').find(link => link.text() === 'Next')!.trigger('click');
        await flushPromises();
        denied = true;
        await context.queryClient.refetchQueries({queryKey: overviewKeys.regionFamily(session.context, 'en', 'owner', 'main'), type: 'active'});
        await flushPromises();
        expect(target.signal.aborted).toBe(true);
        held.resolve(json({...region(target), items: [{...card, title: 'Obsolete target card'}]}));
        unrelatedRead.resolve({...region(target), collection: 'participant'});
        translatedRead.resolve({...region(target), items: [{...card, title: 'Obsolete translated card'}]});
        await independent;
        await translated;
        await flushPromises();
        expect(router.currentRoute.value.query.owner_main_page).toBeUndefined();
        expect(wrapper.text()).not.toContain(card.title);
        expect(wrapper.text()).not.toContain('Obsolete target card');
        expect(context.queryClient.getQueryData(overviewKeys.region(session.context, 'en',
            {collection: 'owner', region: 'main', q: undefined, type: undefined, page: '2',
                childPage: undefined, eventId: undefined}))).toBeUndefined();
        expect(context.queryClient.getQueryData(independentKey)).toBeDefined();
        expect(context.queryClient.getQueryData(translatedKey)).toBeUndefined();

        denied = false;
        await wrapper.findAll('button').find(button => button.text() === context.messages.value.t('common.retry'))!.trigger('click');
        await flushPromises();
        expect(wrapper.text()).toContain(card.title);
        expect(context.queryClient.getQueryData(overviewKeys.region(session.context, 'en',
            {collection: 'owner', region: 'main', q: undefined, type: undefined, page: undefined,
                childPage: undefined, eventId: undefined}))).toBeDefined();
        expect(wrapper.text()).not.toContain(context.messages.value.t('state.loadFailed'));
        expect(wrapper.text()).not.toContain(context.messages.value.t('state.stale'));
    });

    it.each(['closed', 'locale', 'departure'] as const)('retires a held Next on %s before cache/URL/focus publication', async retirement => {
        const held = deferred<Response>();
        let original!: Request;
        const {wrapper, root, router, context, update} = await mounted(OverviewRegion,
            {collection: 'owner', region: 'main', active: true}, async request => {
                if (new URL(request.url).searchParams.get('page') === '2') { original = request; return held.promise; }
                return json(region(request));
            });
        await wrapper.findAll('a').find(link => link.text() === 'Next')!.trigger('click');
        await flushPromises();
        if (retirement === 'closed') await update({active: false});
        else if (retirement === 'locale') context.locale.value = 'de';
        else await router.push('/before');
        held.resolve(json({...region(original), items: [{...card, title: 'Retired target'}]}));
        await flushPromises();
        expect(router.currentRoute.value.query.owner_main_page).toBeUndefined();
        expect(root.text()).not.toContain('Retired target');
        expect(context.queryClient.getQueryData(overviewKeys.region(session.context, 'en',
            {collection: 'owner', region: 'main', q: undefined, type: undefined, page: '2', childPage: undefined, eventId: undefined}))).toBeUndefined();
    });

    it('keeps Retry inside the shared server cooldown without issuing another requested-page read', async () => {
        vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date']});
        let nextReads = 0;
        const {wrapper, context, router} = await mounted(OverviewRegion, {collection: 'owner', region: 'main'}, async request => {
            if (new URL(request.url).searchParams.get('page') === '2') {
                nextReads++;
                if (nextReads === 1) return new Response('{}', {status: 429,
                    headers: {'Content-Type': 'application/json', 'X-Surveyor-Context': session.context, 'Retry-After': '60'}});
            }
            return json(region(request));
        });
        await wrapper.findAll('a').find(link => link.text() === 'Next')!.trigger('click');
        await flushPromises();
        const retry = wrapper.findAll('button').find(button => button.text() === context.messages.value.t('common.retry'))!;
        const deadline = new Date(Date.now() + 60_000).toISOString();
        expect(wrapper.get('[data-read-retry-at] time').attributes('datetime')).toBe(deadline);
        expect(retry.attributes('disabled')).toBeDefined();
        await retry.trigger('click');
        await wrapper.findAll('a').find(link => link.text() === 'Next')!.trigger('click');
        await flushPromises();
        expect(nextReads).toBe(1);
        expect(router.currentRoute.value.query.owner_main_page).toBeUndefined();
        await vi.advanceTimersByTimeAsync(60_001);
        await flushPromises();
        expect(wrapper.find('[data-read-retry-at]').exists()).toBe(false);
        expect(retry.attributes('disabled')).toBeUndefined();
        await retry.trigger('click');
        await flushPromises();
        expect(nextReads).toBe(2);
        expect(router.currentRoute.value.query.owner_main_page).toBe('2');
    });

    it('keeps readable cards after failed Back-owned reads and admits no actions from that retained projection', async () => {
        vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date']});
        let failing = true;
        const {wrapper, router, context} = await mounted(OverviewRegion, {collection: 'owner', region: 'main'}, async request => {
            if (new URL(request.url).searchParams.get('page') === '2' && failing) throw new TypeError('Page unavailable');
            return json(region(request));
        });
        const outside = document.createElement('button');
        document.body.append(outside);
        outside.focus();
        await router.push('/frontend-pilot?owner_main_page=2');
        await flushPromises();
        expect(wrapper.text()).toContain(card.title);
        expect(document.activeElement).toBe(outside);
        await vi.advanceTimersByTimeAsync(3100);
        await flushPromises();
        expect(router.currentRoute.value.query.owner_main_page).toBe('2');
        expect(wrapper.text()).toContain(card.title);
        expect(wrapper.text()).toContain(context.messages.value.t('state.stale'));
        const cardActions = wrapper.findComponent(OverviewCard).findAll('.dropdown-item');
        expect(cardActions.length).toBeGreaterThan(0);
        expect(cardActions.every(button => button.attributes('disabled') !== undefined)).toBe(true);
        expect(document.activeElement).toBe(outside);

        failing = false;
        await wrapper.findAll('button').find(button => button.text() === context.messages.value.t('common.retry'))!.trigger('click');
        await flushPromises();
        expect(wrapper.text()).not.toContain(context.messages.value.t('state.stale'));
        expect(document.activeElement).toBe(wrapper.get('.js-overview-heading').element);
    });

    it('keeps failed Next cards/URL/focus and retries its target once before creating a history entry', async () => {
        const held = deferred<Response>();
        let nextReads = 0;
        let target!: Request;
        const {wrapper, router, context} = await mounted(OverviewRegion, {collection: 'owner', region: 'main'}, async request => {
            if (new URL(request.url).searchParams.get('page') === '2') {
                target = request;
                nextReads++;
                if (nextReads === 1) return held.promise;
            }
            return json(region(request));
        });
        const original = router.currentRoute.value.fullPath;
        const headingFocus = vi.spyOn(wrapper.get<HTMLElement>('.js-overview-heading').element, 'focus');
        const scroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
        const next = wrapper.findAll('a').find(link => link.text() === 'Next')!;
        (next.element as HTMLElement).focus();
        await next.trigger('click');
        await flushPromises();
        expect(router.currentRoute.value.fullPath).toBe(original);
        expect(wrapper.text()).toContain(card.title);
        expect(document.activeElement).toBe(next.element);
        expect(wrapper.find('[data-loading-skeleton]').exists()).toBe(false);

        // A temporary read failure retains cards. A confirmed 403/404 instead retires
        // the region's private projections, covered by the denial cases above.
        held.resolve(new Response('{}', {status: 429,
            headers: {'Content-Type': 'application/json', 'X-Surveyor-Context': session.context}}));
        await flushPromises();
        expect(router.currentRoute.value.fullPath).toBe(original);
        expect(wrapper.text()).toContain(card.title);
        expect(wrapper.text()).toContain(context.messages.value.t('state.stale'));
        expect(document.activeElement).toBe(next.element);
        expect(new URL(target.url).searchParams.get('page')).toBe('2');

        await wrapper.findAll('button').find(button => button.text() === context.messages.value.t('common.retry'))!.trigger('click');
        await flushPromises();
        expect(nextReads).toBe(2);
        expect(router.currentRoute.value.query.owner_main_page).toBe('2');
        expect(document.activeElement).toBe(wrapper.get('.js-overview-heading').element);
        // The completed region is announced without the old submit/reload scroll.
        // Deliberate event Back restoration has its own separate journey below.
        expect(headingFocus).toHaveBeenLastCalledWith({preventScroll: true});
        expect(scroll).not.toHaveBeenCalled();
        expect(wrapper.text()).not.toContain(context.messages.value.t('state.stale'));
        router.back();
        await flushPromises();
        expect(router.currentRoute.value.fullPath).toBe(original);
        router.back();
        await flushPromises();
        expect(router.currentRoute.value.path).toBe('/before');
    });

    it('keeps the captured event href for modified clicks and restores origin focus/scroll after its Back read', async () => {
        const scroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
        vi.spyOn(window, 'scrollY', 'get').mockReturnValue(640);
        const {wrapper, router} = await mounted(OverviewRegion, {collection: 'owner', region: 'main'},
            async request => json(eventRegion(request)));
        const origin = wrapper.get<HTMLAnchorElement>(`a[data-overview-event="${eventId}"]`);
        const modified = new MouseEvent('click', {bubbles: true, cancelable: true, metaKey: true});
        origin.element.dispatchEvent(modified);
        expect(modified.defaultPrevented).toBe(false);
        await flushPromises();
        expect(router.currentRoute.value.query.owner_main_event).toBeUndefined();

        await origin.trigger('click');
        await flushPromises();
        expect(router.currentRoute.value.query.owner_main_event).toBe(eventId);
        expect(document.activeElement).toBe(wrapper.get('.js-overview-heading').element);
        const back = wrapper.findAll('a').find(link => link.text() === 'Back to overview')!;
        const ctrlBack = new MouseEvent('click', {bubbles: true, cancelable: true, ctrlKey: true});
        back.element.dispatchEvent(ctrlBack);
        expect(ctrlBack.defaultPrevented).toBe(false);
        await back.trigger('click');
        await flushPromises();
        expect(router.currentRoute.value.query.owner_main_event).toBeUndefined();
        expect(document.activeElement).toBe(wrapper.get(`a[data-overview-event="${eventId}"]`).element);
        expect(scroll).toHaveBeenCalledWith({top: 640, behavior: 'instant'});
    });

    it('retires a held Next before input debounce and merges only its successful region into the latest route', async () => {
        vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date']});
        const held = deferred<Response>();
        let stale!: Request;
        const {wrapper, router, context} = await mounted(OverviewRegion, {collection: 'owner', region: 'main'}, async request => {
            if (new URL(request.url).searchParams.get('page') === '2') { stale = request; return held.promise; }
            return json(region(request));
        });
        await wrapper.findAll('a').find(link => link.text() === 'Next')!.trigger('click');
        await flushPromises();
        await router.replace({query: {participant_main_q: 'another region'}});
        const input = wrapper.get<HTMLInputElement>('input[type="search"]');
        input.element.focus();
        await input.setValue('latest');
        input.element.setSelectionRange(1, 3);
        held.resolve(json({...region(stale), items: [{...card, title: 'Obsolete page'}]}));
        await flushPromises();
        expect(router.currentRoute.value.query.owner_main_page).toBeUndefined();
        expect(wrapper.text()).not.toContain('Obsolete page');
        await vi.advanceTimersByTimeAsync(300);
        await flushPromises();
        expect(router.currentRoute.value.query).toEqual({participant_main_q: 'another region', owner_main_q: 'latest'});
        expect(document.activeElement).toBe(input.element);
        expect([input.element.selectionStart, input.element.selectionEnd]).toEqual([1, 3]);
        expect(context.queryClient.getQueryData(overviewKeys.region(session.context, 'en',
            {collection: 'owner', region: 'main', q: undefined, type: undefined, page: '2', childPage: undefined, eventId: undefined}))).toBeUndefined();
    });

    it('preserves native modified-click destinations without changing the current region or reading another page', async () => {
        const {wrapper, router, request, context} = await mounted(OverviewRegion, {collection: 'owner', region: 'main'},
            async request => json(eventRegion(request)), '/frontend-pilot?owner_main_q=fixture&owner_main_event=' + eventId);
        const original = router.currentRoute.value.fullPath;
        const labels = [context.messages.value.t('overview.next'), context.messages.value.t('overview.showAllLinked')];
        const links = wrapper.findAll('a').filter(link => labels.includes(link.text()));
        expect(links).toHaveLength(2);

        for (const link of links) {
            for (const modifier of ['ctrlKey', 'metaKey', 'shiftKey', 'altKey']) {
                const click = new MouseEvent('click', {bubbles: true, cancelable: true, [modifier]: true});
                link.element.dispatchEvent(click);
                expect(click.defaultPrevented).toBe(false);
                await flushPromises();
                expect(router.currentRoute.value.fullPath).toBe(original);
            }
        }
        expect(request).toHaveBeenCalledOnce();
    });

    it('preserves a modified Archived and hidden link and opens it only on an ordinary click', async () => {
        const {wrapper, router, context} = await mounted(OverviewPage, {});
        const toggle = wrapper.findAll('a').find(link => link.text().startsWith(context.messages.value.t('overview.hidden')))!;
        const click = new MouseEvent('click', {bubbles: true, cancelable: true, ctrlKey: true});
        toggle.element.dispatchEvent(click);
        expect(click.defaultPrevented).toBe(false);
        await flushPromises();
        expect(router.currentRoute.value.query.owner_hidden_open).toBeUndefined();

        await toggle.trigger('click');
        await flushPromises();
        expect(router.currentRoute.value.query.owner_hidden_open ?? router.currentRoute.value.query.participant_hidden_open).toBe('1');
    });

    it('uses one native close target that clears hidden parent/child paging and preserves independent filters', async () => {
        const {wrapper, router, context} = await mounted(OverviewPage, {}, undefined,
            `/frontend-pilot?owner_hidden_open=1&owner_hidden_event=${eventId}&owner_hidden_childPage=3&owner_hidden_q=saved&owner_main_page=2&participant_main_q=other`);
        const toggle = wrapper.findAll('a').find(link => link.text().startsWith(context.messages.value.t('overview.hidden'))
            && link.attributes('aria-controls') === 'overview-owner-hidden')!;
        const href = new URL(toggle.attributes('href')!, 'https://surveyor.invalid');
        expect(href.searchParams.has('owner_hidden_open')).toBe(false);
        expect(href.searchParams.has('owner_hidden_event')).toBe(false);
        expect(href.searchParams.has('owner_hidden_childPage')).toBe(false);
        await toggle.trigger('click');
        await flushPromises();
        expect(router.currentRoute.value.query).toEqual({owner_hidden_q: 'saved', owner_main_page: '2', participant_main_q: 'other'});
    });

    it('retains native hidden disclosure in saved and committed navigation from a selected-event deep link', async () => {
        const {wrapper, router, request} = await mounted(OverviewRegion, {collection: 'owner', region: 'hidden'},
            async request => json({...eventRegion(request), region: 'hidden', hiddenEntities: 2}),
            `/frontend-pilot?owner_hidden_event=${eventId}&participant_main_q=other`);
        const back = wrapper.findAll('a').find(link => link.text() === 'Back to overview')!;
        const href = new URL(back.attributes('href')!, 'https://surveyor.invalid');
        expect(href.searchParams.get('owner_hidden_open')).toBe('1');
        expect(href.searchParams.has('owner_hidden_event')).toBe(false);
        await back.trigger('click');
        await flushPromises();
        expect(router.currentRoute.value.query).toEqual({participant_main_q: 'other', owner_hidden_open: '1'});
        expect(request).toHaveBeenCalledTimes(2);
    });

    it('keeps read recovery in its region after failed manual Refresh and clears it after success', async () => {
        vi.useFakeTimers();
        let failRead = false;
        const {wrapper, context} = await mounted(OverviewRegion, {collection: 'owner', region: 'main'}, async request => {
            if (failRead) throw new TypeError('Fixture overview connection failed');
            return json(region(request));
        });
        const refresh = wrapper.findAll('button').find(button => button.text() === 'Refresh')!;
        failRead = true;
        await refresh.trigger('click');
        await flushPromises();
        // Exercise the production bounded network retry interval before its final
        // failure becomes authoritative; do not replace the query's retry policy.
        await vi.advanceTimersByTimeAsync(3100);
        expect(wrapper.text()).toContain(card.title);
        expect(wrapper.text()).toContain(context.messages.value.t('state.stale'));

        failRead = false;
        await refresh.trigger('click');
        await flushPromises();
        expect(wrapper.text()).toContain(card.title);
        expect(wrapper.text()).not.toContain(context.messages.value.t('state.stale'));
    });

    it('resumes a cancelled read when quick typing returns to the original search', async () => {
        vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date']});
        const {wrapper, router, request} = await mounted(OverviewRegion, {collection: 'owner', region: 'main'});
        const input = wrapper.get('input[type="search"]');
        await input.setValue('temporary');
        await vi.advanceTimersByTimeAsync(100);
        await input.setValue('');
        await vi.advanceTimersByTimeAsync(300);
        await flushPromises();
        expect(router.currentRoute.value.fullPath).toBe('/frontend-pilot#overview-owner-main');
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

describe('shared native disclosure interaction', () => {
    it('dismisses outside Tab/focus and pointer actions without stealing focus, and keeps native fields mounted', async () => {
        const host = defineComponent({components: {AppNavigationDropdown}, template: `
            <div><AppNavigationDropdown label="First" icon="bi-plus">
                <li><a class="dropdown-item" href="/first">First action</a></li>
                <li><form><input aria-label="Menu draft" value="preserved" />
                    <select aria-label="Profile"><option>One</option><option>Two</option></select></form></li>
                </AppNavigationDropdown><AppNavigationDropdown label="Second" icon="bi-plus">
                <li><a class="dropdown-item" href="/second">Second action</a></li>
                </AppNavigationDropdown><button id="outside">Outside</button></div>`});
        const {wrapper} = await mounted(host, {});
        const menus = wrapper.findAll('details');
        const first = menus[0]!;
        const field = first.get<HTMLInputElement>('input');
        await first.get('summary').trigger('keydown', {key: 'ArrowDown'});
        expect((first.element as HTMLDetailsElement).open).toBe(true);
        field.element.focus();
        await field.setValue('retained draft');
        const nativeArrow = new KeyboardEvent('keydown', {bubbles: true, cancelable: true, key: 'ArrowDown'});
        first.get('select').element.dispatchEvent(nativeArrow);
        expect(nativeArrow.defaultPrevented).toBe(false);

        const outside = wrapper.get<HTMLButtonElement>('#outside');
        outside.element.focus();
        await outside.trigger('keyup', {key: 'Tab'});
        expect((first.element as HTMLDetailsElement).open).toBe(false);
        expect(document.activeElement).toBe(outside.element);
        expect(first.get('input').element).toBe(field.element);
        expect(field.element.value).toBe('retained draft');

        await first.get('summary').trigger('keydown', {key: 'ArrowDown'});
        menus[1]!.get<HTMLElement>('summary').element.focus();
        await menus[1]!.get('summary').trigger('keydown', {key: 'ArrowDown'});
        expect((first.element as HTMLDetailsElement).open).toBe(false);
        expect((menus[1]!.element as HTMLDetailsElement).open).toBe(true);
        await outside.trigger('pointerdown');
        expect((menus[1]!.element as HTMLDetailsElement).open).toBe(false);
        // Closed disclosures do not consume Escape belonging to another interaction.
        const escape = new KeyboardEvent('keydown', {bubbles: true, cancelable: true, key: 'Escape'});
        outside.element.dispatchEvent(escape);
        expect(escape.defaultPrevented).toBe(false);
    });

    it('uses the same disclosure owner for Overview actions and restores the actual trigger on Escape', async () => {
        const {wrapper, update} = await mounted(OverviewCard, {card,
            interaction: {migrated: true, duplicateUrl: card.url + '/duplicate'}});
        const menu = wrapper.get('details');
        const trigger = menu.get<HTMLElement>('summary');
        const nativeTrigger = nativeOverviewRegion(region(new Request('http://localhost/overview')))
            .querySelector<HTMLElement>('.js-item .dropdown-toggle')!;
        expect(trigger.attributes('role')).toBe(nativeTrigger.getAttribute('role') ?? nativeTrigger.tagName.toLowerCase());
        expect(trigger.attributes('aria-label')).toBe(nativeTrigger.getAttribute('aria-label'));
        await trigger.trigger('keydown', {key: 'ArrowDown'});
        expect(document.activeElement).toBe(menu.findAll('button')[0]!.element);
        await menu.trigger('keydown', {key: 'Escape'});
        expect((menu.element as HTMLDetailsElement).open).toBe(false);
        expect(document.activeElement).toBe(trigger.element);
        expect(wrapper.findComponent(AppNavigationDropdown).exists()).toBe(true);

        // Bootstrap's native card menu also closes after an ordinary action button.
        // The shared disclosure changes presentation only; the card still emits one
        // feature action and disabled controls retain the enclosing command guard.
        await trigger.trigger('keydown', {key: 'ArrowDown'});
        const action = menu.findAll<HTMLButtonElement>('button')[0]!;
        action.element.click();
        await nextTick();
        expect((menu.element as HTMLDetailsElement).open).toBe(false);
        expect(wrapper.emitted('visibility')).toEqual([['hidden']]);
        await update({disabled: true});
        await trigger.trigger('keydown', {key: 'ArrowDown'});
        action.element.click();
        await nextTick();
        expect(wrapper.emitted('visibility')).toEqual([['hidden']]);
    });
});

describe('mixed-family Overview integration', () => {
    const families = [
        {type: 'event', endpoint: 'events'},
        {type: 'packing', endpoint: 'packing-lists'},
        {type: 'drivers', endpoint: 'drivers-lists'},
        {type: 'survey', endpoint: 'surveys'},
        {type: 'activity', endpoint: 'activity-plans'},
    ] as const;

    /** Deliberately share a UUID across entity families. The rendered identity,
     * image operation and commands must retain the type as well as the ID. */
    function mixedCards(): components['schemas']['OverviewCard'][] {
        return families.map(family => ({...card, type: family.type, title: `Mixed ${family.type}`,
            url: `/frontend-pilot/${family.type}/${otherId}`,
            headerUrl: `/api/v1/${family.endpoint}/${otherId}/header`, headerVersion: 'first-image',
            capabilities: {archive: true, restore: false, duplicate: true, remove: true}}));
    }

    /** Supply one bounded response from HTTP, keeping the mounted production
     * card grid, generated decoders and independently owned feature APIs intact. */
    function mixedRegion(request: Request, items: components['schemas']['OverviewCard'][]) {
        return {...region(request), availableTypes: families.map(family => family.type), pageSize: 12,
            totalEntities: 5, regionEntities: items.length, matchingEntities: items.length,
            totalCards: items.length, hasNext: false, items};
    }

    it('keeps all typed card destinations and authorized images through equal reads and one changed image version', async () => {
        const cards = mixedCards();
        const imageReads: string[] = [];
        let nextImage = 0;
        vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:mixed-image-${++nextImage}`);
        const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

        /** Only the external HTTP boundary supplies bytes. All feature header
         * operations must carry the same captured actor as the mixed JSON read. */
        async function readMixedImages(request: Request): Promise<Response> {
            const path = new URL(request.url).pathname;
            expect(request.headers.get('X-Surveyor-Context')).toBe(session.context);
            if (path.endsWith('/header')) {
                imageReads.push(path);
                return new Response(new Blob([path]), {headers: {'Content-Type': 'image/png',
                    'X-Surveyor-Context': session.context}});
            }
            return json(mixedRegion(request, cards));
        }

        const {wrapper, context} = await mounted(OverviewRegion,
            {collection: 'owner', region: 'main'}, readMixedImages);
        await vi.waitFor(() => expect(wrapper.findAll('img')).toHaveLength(5));
        expect(wrapper.findAll('article.js-item')).toHaveLength(5);
        expect(imageReads.sort()).toEqual(families.map(family => `/api/v1/${family.endpoint}/${otherId}/header`).sort());
        const images = new Map(families.map(family => [family.type,
            wrapper.get(`article[data-type="${family.type}"] img`).attributes('src')]));
        for (const family of families) {
            const rendered = wrapper.get(`article[data-type="${family.type}"]`);
            expect(rendered.get('a.card-body').attributes('href')).toBe(`/frontend-pilot/${family.type}/${otherId}`);
            expect(rendered.get('a.btn-info').attributes('href')).toBe(`/frontend-pilot/${family.type}/${otherId}/duplicate`);
            expect(rendered.get('img').attributes('src')).toMatch(/^blob:mixed-image-/u);
            expect(rendered.get('img').attributes('alt')).toBe(`Mixed ${family.type}`);
        }

        // Successful equal JSON refreshes retain the five browser URLs. A new
        // image version retires only that typed card, even with a shared UUID.
        await context.queryClient.refetchQueries({queryKey: overviewKeys.all(session.context), type: 'active'});
        await flushPromises();
        expect(imageReads).toHaveLength(5);
        expect(revoke).not.toHaveBeenCalled();
        cards[0]!.headerVersion = 'replacement-image';
        await context.queryClient.refetchQueries({queryKey: overviewKeys.all(session.context), type: 'active'});
        await vi.waitFor(() => expect(imageReads).toHaveLength(6));
        await flushPromises();
        expect(revoke).toHaveBeenCalledExactlyOnceWith(images.get('event'));
        for (const family of families.filter(family => family.type !== 'event'))
            expect(wrapper.get(`article[data-type="${family.type}"] img`).attributes('src')).toBe(images.get(family.type));
    });

    it.each(families)('dispatches $type lifecycle and personal visibility through their actual owners', async family => {
        vi.stubGlobal('confirm', vi.fn(() => true));
        const cards = mixedCards().map(item => ({...item, headerUrl: null, headerVersion: null}));
        const selected = cards.find(item => item.type === family.type)!;
        const writes: {path: string; method: string; body: unknown}[] = [];

        /** Saved fixture state changes only after a matching HTTP command. The
         * following production refresh decides which controls/cards remain. */
        async function serveMixedCommands(request: Request): Promise<Response> {
            const path = new URL(request.url).pathname;
            if (request.method !== 'GET') {
                const body = request.method === 'PUT' ? await request.json() : null;
                writes.push({path, method: request.method, body});
                if (request.method === 'PUT') {
                    selected.visibility = body.visibility;
                    selected.overviewHidden = true;
                    return json({visibility: body.visibility, overviewHidden: true, archived: false});
                }
                selected.archived = path.endsWith('/archive');
                selected.capabilities.archive = !selected.archived;
                selected.capabilities.restore = selected.archived;
                return json({changed: true});
            }
            return json(mixedRegion(request, cards.filter(item => !item.overviewHidden)));
        }

        const {wrapper} = await mounted(OverviewRegion,
            {collection: 'owner', region: 'main'}, serveMixedCommands);

        /** Use the visible card action rather than invoke component internals;
         * the real disclosure, command lock and confirmation stay adopted. */
        async function choose(label: string): Promise<void> {
            const rendered = wrapper.get(`article[data-type="${family.type}"]`);
            const action = rendered.findAll('button').find(button => button.text() === label)!;
            expect(action, label).toBeDefined();
            (action.element.closest('details') as HTMLDetailsElement).open = true;
            await action.trigger('click');
            await flushPromises();
        }

        await choose('Archive for everyone');
        await choose('Restore for everyone');
        await choose('Hide for me');
        expect(writes).toEqual([
            {path: `/api/v1/${family.endpoint}/${otherId}/archive`, method: 'POST', body: null},
            {path: `/api/v1/${family.endpoint}/${otherId}/restore`, method: 'POST', body: null},
            {path: `/api/v1/overview/${family.type}/${otherId}/visibility`, method: 'PUT', body: {visibility: 'hidden'}},
        ]);
        expect(wrapper.find(`article[data-type="${family.type}"]`).exists()).toBe(false);
        expect(wrapper.findAll('article.js-item')).toHaveLength(4);
    });

    it.each(families)('retains the confirmed $type deletion message through failed delivery and retries navigation only', async family => {
        vi.stubGlobal('confirm', vi.fn(() => true));
        const selected = {...card, type: family.type, title: `Delete ${family.type}`,
            url: `/frontend-pilot/${family.type}/${otherId}`, capabilities: {...card.capabilities, remove: true}};
        const writes: string[] = [];

        async function serveDeletion(request: Request): Promise<Response> {
            if (request.method === 'DELETE') {
                writes.push(new URL(request.url).pathname);
                return json({changed: true});
            }
            return json(mixedRegion(request, [selected]));
        }

        const {wrapper, router, context} = await mounted(OverviewRegion,
            {collection: 'owner', region: 'main'}, serveDeletion, '/frontend-pilot?owner_main_q=delete');
        const stopDelivery = router.beforeEach(to => to.query.owner_main_q ? undefined : false);
        cleanups.push(stopDelivery);
        await wrapper.get('button.btn-danger').trigger('click');
        await flushPromises();
        const notice = wrapper.get('.status-notice.alert-success');
        expect(notice.text()).toContain(context.messages.value.t(`${family.type}.deleted`));
        expect(writes).toEqual([`/api/v1/${family.endpoint}/${otherId}`]);
        expect(wrapper.get<HTMLButtonElement>('button.btn-danger').element.disabled).toBe(true);

        // The notice belongs to the retained confirmation, so its current locale
        // can change without relabeling another family or repeating the DELETE.
        context.locale.value = 'de';
        await flushPromises();
        expect(notice.text()).toContain(context.messages.value.t(`${family.type}.deleted`));
        stopDelivery();
        await notice.get('button').trigger('click');
        await flushPromises();
        expect(router.currentRoute.value.fullPath).toBe('/frontend-pilot');
        expect(writes).toHaveLength(1);
    });
});
