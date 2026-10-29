// @vitest-environment happy-dom
import {apiCompatibility} from '../../.generated/api/v1/policy.mjs';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {mount} from '@vue/test-utils';
import {flushFrontendPromises as flushPromises} from '../keywords/frontendUiKeywords';
import {defineComponent, nextTick, provide, reactive, ref, type Component} from 'vue';
import {createMemoryHistory, createRouter} from 'vue-router';
import {VueQueryPlugin} from '@tanstack/vue-query';
import I18NextVue from 'i18next-vue';
import {createFrontendContext, observeInitialDocument, frontendContextKey} from '../../src/frontend/app/context';
import {frontendRoutes} from '../../src/frontend/routes';
import App from '../../src/frontend/app/App.vue';
import {noticeTargetKey} from '../../src/frontend/composables/feedback';
import InlineCell from '../../src/frontend/components/InlineCell.vue';
import EntityHeaderEditor from '../../src/frontend/components/EntityHeaderEditor.vue';
import PackingPage from '../../src/frontend/features/packing/PackingPage.vue';
import PackingEntry from '../../src/frontend/features/packing/PackingEntry.vue';
import PackingSettings from '../../src/frontend/features/packing/PackingSettings.vue';
import MetadataFields from '../../src/frontend/components/BasicEntityMetadataFields.vue';
import PackingCreatePage from '../../src/frontend/features/packing/PackingCreatePage.vue';
import EventPicker from '../../src/frontend/components/EventPicker.vue';
import OverviewCard from '../../src/frontend/components/EntityCard.vue';
import OverviewRegion from '../../src/frontend/features/overview/OverviewRegion.vue';
import type {components} from '../../src/types/api/v1';
import type {FrontendContext, FrontendEventPickerSource} from '../../src/types/FrontendUiTypes';
import type {FrontendBootstrap} from '../../src/types/FrontendTypes';
import {usePackingApi} from '../../src/frontend/features/packing/api';
import {overviewKeys, packingKeys} from '../../src/frontend/app/queryKeys';
import {ApiFailure} from '../../src/frontend/app/transport';

const id = '11111111-1111-4111-8111-111111111111';
const itemId = '22222222-2222-4222-8222-222222222222';
const otherId = '33333333-3333-4333-8333-333333333333';
const session: components['schemas']['SessionView'] & {context: string; csrfToken: string} = {
    kind: 'account', deployment: {buildId: 'fixture', apiCompatibility}, context: 'packing-ui-context-1234567890', csrfToken: 'packing-ui-csrf-1234567890', locale: 'en',
    activeProfile: {id, name: 'Organizer'}, profiles: [{id, name: 'Organizer'}], loginUrl: '/users/login', logoutUrl: '/users/logout',
    shell: {version: 'test', imprintUrl: '/imprint', privacyPolicyUrl: '/privacy', localLoginEnabled: true, oidcEnabled: false, oidcName: 'SSO'},
};
const defaults = {participant: 0, guest: 0, authenticated: 0, public: 0};
const settings: components['schemas']['ListSettings'] = {
    id, title: 'Equipment', headerUrl: null, headerVersion: null, settingsToken: '"edit-settings-original"',
    editableFields: [], currentEvent: null, access: null,
    archive: {direct: false, inherited: false, archivedAt: null, autoArchivePaused: false, eventUrl: null},
    capabilities: {editHeader: false, linkEvent: false, managePermissions: false, duplicate: false,
        remove: false, archive: false, restore: false, manageArchive: false},
};
const item: components['schemas']['PackingItemView'] = {
    id: itemId, title: 'Tent', description: null, position: 0, requiredByAll: false,
    maxAssignees: 2, assignedCount: 0, selfAssigned: false, assignees: [], editToken: '"edit-item-original"',
    capabilities: {editTitle: true, editDescription: false, editCapacity: false, showTitleEdit: true,
        showCapacityEdit: false, editRequired: false, removeItem: false, removeAssignments: false},
};
const list: components['schemas']['PackingListView'] = {
    entityType: 'packing', id, title: 'Equipment', description: null, headerUrl: null, headerVersion: null,
    orderToken: '"order-original"', currentEventId: null, currentEventUrl: null, archived: false, inheritedArchived: false,
    capabilities: {editTitle: false, editDescription: false, selfAssign: false, addItem: true, reorder: true, manageSettings: false},
    counters: {participants: 0, open: 1, empty: 1}, items: [item],
};
function json(value: unknown, status = 200): Response {
    return new Response(JSON.stringify(value), {status, headers: {'Content-Type': 'application/json', 'X-Surveyor-Context': session.context, ETag: '"original"'}});
}
function problem(code: 'VALIDATION_FAILED' | 'PRECONDITION_FAILED' | 'FORBIDDEN' | 'NOT_FOUND', status: number): Response {
    return json({type: 'about:blank', title: 'Request failed', status, detail: 'Review the request.',
        requestId: 'packing-ui-problem', code, messageKey: 'api:errors.' + code, params: {}}, status);
}
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = ''; });

/** Only the HTTP boundary is replaced. Components, validators, commands and query state are real. */
async function mounted(component: Component, props: Record<string, unknown> | ((context: FrontendContext) => Record<string, unknown>) = {},
    handler: (request: Request) => Promise<Response> = async () => json(list),
    path = '/packing/' + id, initialSession = session,
    initial: Omit<FrontendBootstrap, 'session'> = {}, withShell = false) {
    const request = vi.fn((input: RequestInfo | URL) => handler(input as Request));
    const context = createFrontendContext({...initial, session: initialSession}, true, request);
    context.hydrated.value = true;
    const componentProps = reactive(typeof props === 'function' ? props(context) : {...props});
    const api = usePackingApi(context);
    // Standalone editor cases now exercise the actual common field owner. The
    // Settings journey below supplies these same feature API/key bindings itself.
    function currentProps() {
        if (component !== MetadataFields) return componentProps;
        const resource = String(componentProps.listId);
        return {...componentProps, prefix: 'packing', resourceId: resource, resourceTitle: componentProps.listTitle,
            queryKey: packingKeys.metadata(context.session.value?.context, resource),
            read: api.metadata.bind(api), save: api.saveMetadata.bind(api)};
    }
    const router = createRouter({history: createMemoryHistory(), routes: [
            {name: 'packing-test-overview', path: '/users/dashboard', component, props: currentProps},
            {path: '/packing/create', component, props: currentProps},
            {path: '/packing/:listId/duplicate', component, props: currentProps},
            {path: '/packing/:listId', component, props: currentProps},
            {path: '/users/login', component: defineComponent({template: '<p>Login destination</p>'})},
            {path: '/help', component: defineComponent({template: '<p>Help destination</p>'})},
            {path: '/away', component: defineComponent({template: '<p>Away</p>'})},
        ]});
    // Keep the real presentation declarations while substituting the component
    // under test. Loading counts/columns must not acquire a second test inventory.
    for (const route of router.getRoutes()) {
        route.meta.loadingSkeleton = frontendRoutes.find(candidate => candidate.path === route.path)?.meta?.loadingSkeleton;
    }
    await router.push(path);
    const stopInitialDocument = observeInitialDocument(context, router);
    const root = mount(withShell ? App : defineComponent({template: '<RouterView />'}), {attachTo: document.body, global: {
            plugins: [router, [VueQueryPlugin, {queryClient: context.queryClient}], [I18NextVue, {i18next: context.i18next}]],
            provide: {[frontendContextKey as symbol]: context},
            stubs: {AppDialog: defineComponent({
                    setup() {
                        // The isolated dialog retains its production presentation scope.
                        const noticeTarget = ref<HTMLElement | null>(null);
                        provide(noticeTargetKey, noticeTarget);
                        return {noticeTarget};
                    },
                    template: '<section role="dialog"><div ref="noticeTarget" class="frontend-notice-stack" data-frontend-notices></div>'
                        + '<slot name="navigation" /><slot /><slot name="footer" /></section>',
                })},
        }});
    await flushPromises();
    const wrapper = root.findComponent(component);
    cleanups.push(async () => { root.unmount(); stopInitialDocument(); await context.queryClient.cancelQueries(); context.queryClient.clear(); });
    async function update(values: Record<string, unknown>) { Object.assign(componentProps, values); await nextTick(); }
    return {root, wrapper, context, router, request, update};
}
/** Match controls through public DOM search, on either a component root or a scoped form. */
function button(wrapper: Pick<ReturnType<typeof mount>, 'findAll'>, label: string) {
    const result = wrapper.findAll('button, a.btn').find(candidate => candidate.text() === label);
    expect(result, label).toBeDefined();
    return result!;
}

/** Hold only the network response; production query, draft and component owners remain real. */
function deferredResponse() {
    let resolveResponse!: (response: Response) => void;
    const response = new Promise<Response>(function captureResponse(resolve) { resolveResponse = resolve; });
    return {response, resolve: resolveResponse};
}

/** Hold only the injected inline save result. The mounted editor still owns its
 * real draft, pending rendering, native events and shared focus lifetime. */
function deferredInlineSave() {
    let resolveSave!: (confirmed: boolean) => void;
    const result = new Promise<boolean>(function captureSave(resolve) { resolveSave = resolve; });
    return {result, resolve: resolveSave};
}

/** Happy DOM does not release disabled input focus as Chromium does. Explicitly
 * reproduce that unclaimed body focus, without adding a deliberate user event. */
function releasePendingEditorFocus(input: HTMLInputElement | HTMLTextAreaElement): void {
    expect(input.disabled).toBe(true);
    document.body.tabIndex = -1;
    document.body.focus();
    document.body.removeAttribute('tabindex');
    expect(document.activeElement).toBe(document.body);
}

/** Happy DOM has no layout engine. Model actual disclosure for focus/placement
 * contracts only; browser checks remain responsible for visual geometry. */
function visibleFeedbackRects(this: HTMLElement): DOMRectList {
    for (let node: HTMLElement | null = this; node; node = node.parentElement) {
        if (node.hidden || node.style.display === 'none' || node.classList.contains('d-none')
            || node.getAttribute('aria-hidden') === 'true') return [] as unknown as DOMRectList;
    }
    return [{}] as unknown as DOMRectList;
}

describe('packing route admission and title ownership', () => {
    it.each([429, 503])('recovers cold resource admission after HTTP %s by retrying only GET after its deadline', async status => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-10-09T12:00:00Z'));
        let unavailable = true;
        const {wrapper, request} = await mounted(PackingEntry, {}, async function readEntry(request): Promise<Response> {
            if (new URL(request.url).pathname.endsWith('/entry')) {
                if (unavailable) return new Response('{}', {status, headers: {'Content-Type': 'application/json',
                        'X-Surveyor-Context': session.context, 'Retry-After': '5'}});
                return json({entry: {kind: 'render'}, guest: null});
            }
            return json(list);
        });
        const retry = button(wrapper, 'Try again');
        expect(wrapper.findComponent(PackingPage).exists()).toBe(false);
        expect(wrapper.get('[data-read-retry-at] time').attributes('datetime')).toBe('2026-10-09T12:00:05.000Z');
        expect(wrapper.find('[data-last-successful-refresh]').exists()).toBe(false);
        expect(retry.attributes('disabled')).toBeDefined();
        await retry.trigger('click');
        expect(request).toHaveBeenCalledOnce();
        await vi.advanceTimersByTimeAsync(5001);
        await flushPromises();
        expect(wrapper.find('[data-read-retry-at]').exists()).toBe(false);
        expect(retry.attributes('disabled')).toBeUndefined();
        expect(request).toHaveBeenCalledOnce();
        unavailable = false;
        await retry.trigger('click');
        await flushPromises();
        expect(wrapper.findComponent(PackingPage).exists()).toBe(true);
        expect(wrapper.find('.frontend-page-message').exists()).toBe(false);
        expect(request.mock.calls.map(([request]) => (request as Request).method)).toEqual(['GET', 'GET', 'GET']);
    });

    it.each(['locale', 'current'] as const)(
        'retains the admitted child, draft and latest equal-read receipt through a failed %s admission', async mode => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date('2026-10-09T12:00:00Z'));
            let unavailable = false;
            const {wrapper, context, request} = await mounted(PackingEntry, {}, async function readAdmission(request): Promise<Response> {
                if (!new URL(request.url).pathname.endsWith('/entry')) return json(list);
                return unavailable ? new Response('{}', {status: 503, headers: {'Content-Type': 'application/json',
                        'X-Surveyor-Context': session.context, 'Retry-After': '5'}})
                    : json({entry: {kind: 'render'}, guest: null});
            });
            const child = wrapper.findComponent(PackingPage).element;
            const input = wrapper.get<HTMLInputElement>('#quick-title');
            await input.setValue('Retained admission draft');
            input.element.focus();

            // Equal successful admission uses structural sharing. Its actual query
            // completion must still advance the receipt without replacing the child.
            vi.setSystemTime(new Date('2026-10-09T12:00:30Z'));
            await context.queryClient.refetchQueries({queryKey: packingKeys.entry(session.context, id, 'detail')});
            await flushPromises();
            unavailable = true;
            vi.setSystemTime(new Date('2026-10-09T12:01:00Z'));
            if (mode === 'locale') context.locale.value = 'de';
            else await context.queryClient.refetchQueries({queryKey: packingKeys.entry(session.context, id, 'detail')});
            await flushPromises();

            expect(wrapper.findComponent(PackingPage).element).toBe(child);
            expect(wrapper.get<HTMLInputElement>('#quick-title').element).toBe(input.element);
            expect(input.element.value).toBe('Retained admission draft');
            expect(document.activeElement).toBe(input.element);
            expect(wrapper.find('.frontend-page-message').exists()).toBe(false);
            expect(wrapper.get('[data-last-successful-refresh] time').attributes('datetime')).toBe('2026-10-09T12:00:30.000Z');
            expect(wrapper.get('[data-read-retry-at] time').attributes('datetime')).toBe('2026-10-09T12:01:05.000Z');
            expect(wrapper.text()).toContain(context.messages.value.t('state.stale'));
            const retry = button(wrapper, context.messages.value.t('common.retry'));
            expect(retry.attributes('disabled')).toBeDefined();
            expect(request.mock.calls.filter(([request]) => new URL((request as Request).url).pathname.endsWith('/entry'))).toHaveLength(3);
            await retry.trigger('click');
            expect(request.mock.calls.filter(([request]) => new URL((request as Request).url).pathname.endsWith('/entry'))).toHaveLength(3);

            await vi.advanceTimersByTimeAsync(5001);
            expect(wrapper.find('[data-read-retry-at]').exists()).toBe(false);
            unavailable = false;
            await retry.trigger('click');
            await flushPromises();
            expect(wrapper.find('[data-last-successful-refresh]').exists()).toBe(false);
            expect(wrapper.findComponent(PackingPage).element).toBe(child);
            expect(wrapper.get<HTMLInputElement>('#quick-title').element).toBe(input.element);
            expect(input.element.value).toBe('Retained admission draft');
            expect(document.activeElement).toBe(input.element);
            expect(request.mock.calls.filter(([request]) => new URL((request as Request).url).pathname.endsWith('/entry'))).toHaveLength(4);
            expect(request.mock.calls.every(([request]) => (request as Request).method === 'GET')).toBe(true);
        });

    it('hydrates the admitted feature and retains its title through locale changes', async () => {
        const {wrapper, context} = await mounted(PackingEntry, {}, async request =>
            json(new URL(request.url).pathname.endsWith('/entry') ? {entry: {kind: 'render'}, guest: null} : list));
        expect(wrapper.get('h1').text()).toBe('Equipment');
        expect(document.title).toBe('Equipment | Surveyor');

        // The route wrapper owns admission errors only; the live feature keeps
        // its resource title when shared locale state invalidates title effects.
        context.locale.value = 'de';
        await flushPromises();
        expect(wrapper.get('h1').text()).toBe('Equipment');
        expect(document.title).toBe('Equipment | Surveyor');
    });

    it.each([403, 404])('retires private admission data after a safe confirmed HTTP %s and restores only a fresh GET', async status => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-10-09T12:00:00Z'));
        let denied = false;
        let holdReturningRead = false;
        const returning = deferredResponse();
        const {wrapper, context, request} = await mounted(PackingEntry, {}, async function readEntry(request): Promise<Response> {
            if (!new URL(request.url).pathname.endsWith('/entry')) return json(list);
            if (holdReturningRead) return returning.response;
            return denied ? json({type: 'about:blank', title: 'Unavailable', status,
                detail: 'This resource is unavailable.', requestId: 'safe-entry-denial', code: 'FUTURE_READ_DENIAL'}, status)
                : json({entry: {kind: 'render'}, guest: null});
        });
        expect(wrapper.get('h1').text()).toBe(list.title);
        const actor = session.context;
        // Populate both locales through the real admission owner before denial.
        // Returning to either cache must not revive an earlier render decision.
        context.locale.value = 'de';
        await flushPromises();
        context.locale.value = 'en';
        await flushPromises();
        expect(context.queryClient.getQueryCache().findAll({queryKey: packingKeys.entry(actor, id, 'detail')})).toHaveLength(2);
        const otherDetail = packingKeys.detail(actor, otherId);
        const publicGuest = packingKeys.guest(actor, id);
        context.queryClient.setQueryData(otherDetail, {data: {...list, id: otherId}});
        context.queryClient.setQueryData(publicGuest, {id, title: 'Independent public guest title'});
        denied = true;
        await context.queryClient.refetchQueries({queryKey: packingKeys.entry(actor, id, 'detail')});
        await flushPromises();

        expect(wrapper.findComponent(PackingPage).exists()).toBe(false);
        expect(wrapper.text()).not.toContain(list.title);
        expect(wrapper.text()).not.toContain(item.title);
        expect(wrapper.text()).toContain('This resource is unavailable.');
        expect(wrapper.find('[data-last-successful-refresh]').exists()).toBe(false);
        expect(context.session.value?.context).toBe(actor);
        expect(context.ready.value).toBe(true);
        expect(context.queryClient.getQueryData(packingKeys.detail(actor, id))).toBeUndefined();
        expect(context.queryClient.getQueryData(otherDetail)).toBeDefined();
        expect(context.queryClient.getQueryData(publicGuest) !== undefined).toBe(status === 403);
        // A thrown Problem has no replacement DTO. The producing query must lose
        // its old render/private body as well as every inactive locale variant.
        const retired = context.queryClient.getQueryCache().findAll({queryKey: packingKeys.entry(actor, id, 'detail')});
        expect(retired.length).toBeGreaterThan(0);
        expect(retired.every(query => query.state.data === undefined)).toBe(true);

        holdReturningRead = true;
        context.locale.value = 'de';
        await flushPromises();
        expect(wrapper.findComponent(PackingPage).exists()).toBe(false);
        expect(wrapper.text()).toContain('This resource is unavailable.');
        expect(wrapper.find('[data-last-successful-refresh]').exists()).toBe(false);
        // Authority stays denied while a newer failed recovery owns its current
        // safe issue and Retry-After. It cannot hide that deadline behind the
        // earlier403/404 descriptor or restore a cached private admission body.
        const recoveryStatus = status === 403 ? 503 : 429;
        holdReturningRead = false;
        returning.resolve(new Response(JSON.stringify({type: 'about:blank', title: 'Temporarily unavailable',
            status: recoveryStatus, detail: 'Admission is temporarily unavailable.', requestId: 'safe-entry-recovery',
            code: 'FUTURE_RECOVERY_UNAVAILABLE'}), {status: recoveryStatus, headers: {'Content-Type': 'application/json',
                'X-Surveyor-Context': actor, 'Retry-After': '5'}}));
        await flushPromises();
        expect(wrapper.findComponent(PackingPage).exists()).toBe(false);
        expect(wrapper.text()).toContain('Admission is temporarily unavailable.');
        expect(wrapper.get('[data-read-retry-at] time').attributes('datetime')).toBe('2026-10-09T12:00:05.000Z');
        expect(wrapper.find('[data-last-successful-refresh]').exists()).toBe(false);
        const failedQueries = context.queryClient.getQueryCache().findAll({queryKey: packingKeys.entry(actor, id, 'detail')});
        expect(failedQueries.every(query => query.state.data === undefined)).toBe(true);
        const reads = request.mock.calls.length;
        const retry = button(wrapper, context.messages.value.t('common.retry'));
        expect(retry.attributes('disabled')).toBeDefined();
        await retry.trigger('click');
        expect(request).toHaveBeenCalledTimes(reads);
        await vi.advanceTimersByTimeAsync(5001);
        expect(wrapper.find('[data-read-retry-at]').exists()).toBe(false);
        expect(wrapper.findComponent(PackingPage).exists()).toBe(false);
        expect(request).toHaveBeenCalledTimes(reads);
        denied = false;
        await retry.trigger('click');
        await flushPromises();
        expect(wrapper.findComponent(PackingPage).exists()).toBe(true);
        expect(wrapper.get('h1').text()).toBe(list.title);
        expect(request.mock.calls.every(([request]) => (request as Request).method === 'GET')).toBe(true);
    });
});

describe('packing authority across language refreshes', () => {
    it.each([
        {kind: 'metadata', component: MetadataFields, selector: '#packing-title'},
        {kind: 'settings', component: PackingSettings, selector: '[data-entity-section="image"]'},
        {kind: 'detail', component: PackingPage, selector: '#quick-title'},
    ] as const)('keeps the latest narrowed $kind authority while returning to an earlier language', async ({kind, component, selector}) => {
        const baseline: components['schemas']['PackingMetadata'] = {entityType: 'packing', id,
            values: {title: 'Private title', description: 'Editable description'}, editableFields: ['title', 'description'],
            currentEventId: null, archived: false, inheritedArchived: false};
        const fullSettings = {...settings, capabilities: {...settings.capabilities, editHeader: true, duplicate: true}};
        let narrowed = false;
        let holdReturningRead = false;
        const held = deferredResponse();

        function projection() {
            if (kind === 'metadata') return narrowed ? {...baseline, values: {description: 'Editable description'},
                editableFields: ['description']} : baseline;
            if (kind === 'settings') return narrowed ? {...fullSettings,
                capabilities: {...fullSettings.capabilities, editHeader: false}} : fullSettings;
            return narrowed ? {...list, capabilities: {...list.capabilities, addItem: false, reorder: false}} : list;
        }

        async function readProjection(request: Request): Promise<Response> {
            if (new URL(request.url).pathname === '/api/v1/locale') {
                const preference = await request.json() as {locale: string};
                return json({...session, locale: preference.locale});
            }
            if (holdReturningRead && request.headers.get('X-Surveyor-Locale') === 'en') return held.response;
            return json(projection());
        }

        const {wrapper, context, request} = await mounted(component, kind === 'detail' ? {} : {listId: id}, readProjection);
        const authorityKey = kind === 'metadata' ? packingKeys.metadata(session.context, id)
            : kind === 'settings' ? packingKeys.settings(session.context, id) : packingKeys.detail(session.context, id);
        const independentKey = packingKeys.metadata(session.context, otherId);
        const independentProjection = {unrelated: 'Preserve another resource'};
        context.queryClient.setQueryData(independentKey, independentProjection);
        expect(wrapper.find(selector).exists()).toBe(true);
        let description: HTMLTextAreaElement | undefined;
        if (kind === 'metadata') {
            await wrapper.get('[name="description"]').setValue('Keep this local description');
            description = wrapper.get<HTMLTextAreaElement>('[name="description"]').element;
            description.focus();
        }

        // Authority changes through an admitted machine read. Language preference
        // writes do not replace that snapshot or resurrect an earlier grant alias.
        narrowed = true;
        await context.queryClient.refetchQueries({queryKey: authorityKey, exact: true});
        await flushPromises();
        const narrowedReads = request.mock.calls.filter(([value]) => (value as Request).method === 'GET').length;
        await context.changeLocale('de');
        await flushPromises();
        expect(wrapper.find(selector).exists()).toBe(false);
        expect(request.mock.calls.filter(([value]) => (value as Request).method === 'GET')).toHaveLength(narrowedReads);
        holdReturningRead = true;
        await context.changeLocale('en');
        const returning = context.queryClient.refetchQueries({queryKey: authorityKey, exact: true});
        try {
            await flushPromises();
            await flushPromises();
            expect(context.locale.value).toBe('en');
            expect(wrapper.find(selector).exists()).toBe(false);
            expect(context.queryClient.getQueryData(independentKey)).toEqual(independentProjection);
            if (description) {
                expect(wrapper.get('[name="description"]').element).toBe(description);
                expect(description.value).toBe('Keep this local description');
                expect(document.activeElement).toBe(description);
            }
        } finally {
            holdReturningRead = false;
            held.resolve(json(projection()));
            await returning;
        }

        // A subsequent successful authoritative read may deliberately grant the action again.
        narrowed = false;
        await context.queryClient.refetchQueries({queryKey: authorityKey, exact: true});
        await context.changeLocale('de');
        await flushPromises();
        expect(wrapper.find(selector).exists()).toBe(true);
        if (description) expect(description.value).toBe('Keep this local description');
    });
});

describe('progressive packing loading', () => {
    it.each([
        {component: PackingPage, kind: 'list'},
        {component: MetadataFields, kind: 'metadata'},
        {component: PackingSettings, kind: 'settings'},
    ])('reenables $kind read recovery before its next scheduled poll', async ({component, kind}) => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-10-09T12:00:00Z'));
        const props = kind === 'list' ? (context: FrontendContext) => {
            // Retain an admitted page: its native refresh icon lives beside the table.
            context.queryClient.setQueryData(packingKeys.detail(session.context, id), {data: list, etag: '"original"'});
            return {};
        } : {listId: id};
        const {wrapper, request, context} = await mounted(component, props, async () =>
            new Response('{}', {status: 429, headers: {'Content-Type': 'application/json',
                    'X-Surveyor-Context': session.context, 'Retry-After': '5'}}));
        if (kind === 'list') {
            await context.queryClient.invalidateQueries({queryKey: packingKeys.detail(session.context, id)});
            await flushPromises();
        }
        function recoveryButton() { return kind === 'list' ? wrapper.get('button[aria-label="Refresh"]') : button(wrapper, 'Refresh'); }

        expect(recoveryButton().attributes('disabled')).toBeDefined();
        await vi.advanceTimersByTimeAsync(5001);
        await flushPromises();
        expect(request).toHaveBeenCalledOnce();
        expect(recoveryButton().attributes('disabled')).toBeUndefined();
        await recoveryButton().trigger('click');
        await flushPromises();
        expect(request).toHaveBeenCalledTimes(2);
        expect(recoveryButton().attributes('disabled')).toBeDefined();
    });

    const metadata: components['schemas']['PackingMetadata'] = {entityType: 'packing', id,
        values: {title: 'Original'}, editableFields: ['title'], currentEventId: null,
        archived: false, inheritedArchived: false};
    const projection: components['schemas']['ListSettings'] = {...settings, title: 'Original',
        editableFields: ['title'], capabilities: {...settings.capabilities, editHeader: true}};
    const formContext: components['schemas']['EntityCreationContext'] = {defaults, permissions: [], presets: []};

    it('replaces the missing table once and preserves a quick-add draft while its locale read is pending', async () => {
        const first = deferredResponse();
        const localized = deferredResponse();
        const other = deferredResponse();
        const description = '  First  paragraph\t \n\n<Second line>\n';
        let reads = 0;
        const {wrapper, context, router} = await mounted(PackingPage, {}, async function readList() {
            reads++;
            return reads === 1 ? first.response : reads === 2 ? localized.response : other.response;
        });
        expect(wrapper.find('[data-loading-skeleton="table"]').exists()).toBe(true);
        expect(wrapper.find('table').exists()).toBe(false);
        expect(wrapper.get('section.card').attributes('aria-busy')).toBe('false');

        first.resolve(json({...list, description}));
        await flushPromises();
        expect(wrapper.find('[data-loading-skeleton]').exists()).toBe(false);
        expect(wrapper.get('[data-item-id]').text()).toContain('Tent');
        // Blank and trailing lines retain their line breaks; authored text stays escaped.
        expect(wrapper.get('#planDesc').element.innerHTML.replace(/<!--[\s\S]*?-->/gu, ''))
            .toBe('  First  paragraph\t <br><br>&lt;Second line&gt;<br>');
        expect(wrapper.get('#planDesc').classes()).not.toContain('frontend-description');
        await wrapper.get('#quick-title').setValue('Local stove');
        const input = wrapper.get<HTMLInputElement>('#quick-title').element;
        input.focus();

        context.locale.value = 'de';
        const refreshing = context.queryClient.invalidateQueries({queryKey: packingKeys.detail(session.context, id)});
        await flushPromises();
        expect(reads).toBe(2);
        expect(wrapper.get('section.card').attributes('aria-busy')).toBe('true');
        expect(wrapper.find('[data-loading-skeleton]').exists()).toBe(false);
        expect(wrapper.get<HTMLInputElement>('#quick-title').element).toBe(input);
        expect(input.value).toBe('Local stove');
        expect(document.activeElement).toBe(input);
        localized.resolve(json({...list, description}));
        await refreshing;
        await flushPromises();

        // A different list cannot borrow this authorized projection. Navigation
        // still uses the existing draft acknowledgement before clearing its form.
        vi.stubGlobal('confirm', () => true);
        await router.push('/packing/' + otherId);
        await flushPromises();
        expect(wrapper.find('[data-loading-skeleton="table"]').exists()).toBe(true);
        expect(wrapper.find('[data-item-id]').exists()).toBe(false);
        other.resolve(json({...list, id: otherId, title: 'Other list'}));
        await flushPromises();
    });

    it('keeps same-list content after a failed locale read, retires denial and recovers only through a fresh same-route GET', async () => {
        vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date']});
        let reads = 0;
        let forbidden = false;
        let restored = false;
        const {wrapper, context} = await mounted(PackingPage, {}, async function readList() {
            reads++;
            if (reads === 1 || restored) return json(list);
            if (forbidden) return problem('FORBIDDEN', 403);
            throw new TypeError('Read response unavailable');
        });
        await wrapper.get('#quick-title').setValue('Retained stove');
        context.locale.value = 'de';
        void context.queryClient.invalidateQueries({queryKey: packingKeys.detail(session.context, id)});
        // Exercise both real query retries without waiting for their wall-clock
        // delays. The shared policy caps these two attempts at 1000 ms and 2000 ms.
        await vi.advanceTimersByTimeAsync(3000);
        await flushPromises();
        expect(wrapper.text()).toContain(context.messages.value.t('state.stale'));
        expect(wrapper.find('[data-loading-skeleton]').exists()).toBe(false);
        expect(wrapper.get('[data-item-id]').text()).toContain('Tent');
        expect(wrapper.get<HTMLInputElement>('#quick-title').element.value).toBe('Retained stove');

        forbidden = true;
        await wrapper.get('button[aria-label="' + context.messages.value.t('common.refresh') + '"]').trigger('click');
        await flushPromises();
        expect(wrapper.text()).toContain(context.messages.value.t('state.forbidden'));
        expect(wrapper.find('[data-item-id]').exists()).toBe(false);
        expect(wrapper.find('#quick-title').exists()).toBe(false);
        expect(wrapper.find('[data-loading-skeleton]').exists()).toBe(false);
        const afterDenial = reads;
        expect(context.queryClient.getQueriesData({queryKey: packingKeys.resource(session.context, id)})
            .every(([, value]) => value === undefined)).toBe(true);
        restored = true;
        await wrapper.get('button[aria-label="' + context.messages.value.t('common.refresh') + '"]').trigger('click');
        await flushPromises();
        expect(reads).toBe(afterDenial + 1);
        expect(wrapper.get('[data-item-id]').text()).toContain('Tent');
        expect(wrapper.get<HTMLInputElement>('#quick-title').element.value).toBe('Retained stove');
        expect(wrapper.text()).not.toContain(context.messages.value.t('state.forbidden'));
    }, 10_000);

    it('keeps an unknown desired-state write protected through denied and failed recovery until a fresh admitted GET', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-10-09T12:00:00Z'));
        vi.stubGlobal('confirm', () => false);
        const held = deferredResponse();
        let outcome: 'success' | 'denied' | 'cooldown' | 'held' = 'success';
        let reads = 0;
        let writes = 0;
        const {wrapper, context} = await mounted(PackingPage, current => {
            current.queryClient.setDefaultOptions({queries: {retry: false}});
            return {};
        }, async function recoverDetail(request) {
            if (request.method === 'PATCH') { writes++; throw new TypeError('Mutation response unavailable'); }
            reads++;
            if (outcome === 'denied') return problem('FORBIDDEN', 403);
            if (outcome === 'held') return held.response;
            if (outcome === 'cooldown') return new Response('{}', {status: 503,
                headers: {'Content-Type': 'application/json', 'Retry-After': '5', 'X-Surveyor-Context': session.context}});
            return json(list);
        });
        const cell = wrapper.findAllComponents(InlineCell)[0];
        await cell.get('td').trigger('dblclick');
        await cell.get('input').setValue('Local tent');
        await cell.get('input').trigger('keydown', {key: 'Enter'});
        await flushPromises();
        expect(writes).toBe(1);
        expect(context.mayChangeIdentity()).toBe(false);

        outcome = 'denied';
        await context.queryClient.refetchQueries({queryKey: packingKeys.detail(session.context, id)});
        await flushPromises();
        expect(wrapper.find('[data-item-id]').exists()).toBe(false);
        outcome = 'cooldown';
        await wrapper.get('button[aria-label="Refresh"]').trigger('click');
        await flushPromises();
        expect(wrapper.get('[data-read-retry-at] time').attributes('datetime')).toBe('2026-10-09T12:00:05.000Z');
        expect(context.mayChangeIdentity()).toBe(false);
        const beforeCooldown = reads;
        await wrapper.get('button[aria-label="Refresh"]').trigger('click');
        expect(reads).toBe(beforeCooldown);
        await vi.advanceTimersByTimeAsync(5001);
        outcome = 'held';
        await wrapper.get('button[aria-label="Refresh"]').trigger('click');
        await flushPromises();
        expect(reads).toBe(beforeCooldown + 1);
        expect(wrapper.find('[data-item-id]').exists()).toBe(false);
        expect(context.mayChangeIdentity()).toBe(false);
        held.resolve(json(list));
        await flushPromises();
        expect(wrapper.get('[data-item-id]').text()).toContain('Tent');
        expect(context.mayChangeIdentity()).toBe(true);
        expect(writes).toBe(1);
    });

    it('renders authorized metadata before unrelated settings finish without replacing its local draft', async () => {
        const delayed = deferredResponse();
        const {wrapper, request} = await mounted(PackingSettings, {listId: id, metadataAvailable: true},
            async function readEditor(request) {
                return new URL(request.url).pathname.endsWith('/settings') ? delayed.response : json(metadata);
            });
        expect(request.mock.calls.map(([value]) => new URL((value as Request).url).pathname))
            .toEqual(expect.arrayContaining([`/api/v1/packing-lists/${id}/settings`, `/api/v1/packing-lists/${id}/metadata`]));
        expect(wrapper.find('[name="title"]').exists()).toBe(true);
        expect(wrapper.find('[data-loading-skeleton="form"]').exists()).toBe(true);
        expect(wrapper.get('#frontend-settings-general').attributes('role')).toBeUndefined();
        await wrapper.get('[name="title"]').setValue('Local properties');
        const input = wrapper.get<HTMLInputElement>('[name="title"]').element;

        delayed.resolve(json(projection));
        await flushPromises();
        expect(wrapper.find('[data-loading-skeleton]').exists()).toBe(false);
        expect(wrapper.get('#frontend-settings-general').attributes('role')).toBe('tabpanel');
        expect(wrapper.get<HTMLInputElement>('[name="title"]').element).toBe(input);
        expect(wrapper.get<HTMLInputElement>('[name="title"]').element.value).toBe('Local properties');
        expect(wrapper.find('input[type="file"]').exists()).toBe(true);
    });

    it('renders available header controls while the independent metadata form is still loading', async () => {
        const delayed = deferredResponse();
        const {wrapper} = await mounted(PackingSettings, {listId: id, metadataAvailable: true},
            async function readEditor(request) {
                return new URL(request.url).pathname.endsWith('/metadata') ? delayed.response : json(projection);
            });
        expect(wrapper.get('input[type="file"]').attributes('disabled')).toBeUndefined();
        expect(wrapper.find('[data-loading-skeleton="form"]').exists()).toBe(true);
        expect(wrapper.find('[name="title"]').exists()).toBe(false);

        delayed.resolve(json(metadata));
        await flushPromises();
        expect(wrapper.find('[data-loading-skeleton]').exists()).toBe(false);
        expect(wrapper.get<HTMLInputElement>('[name="title"]').element.value).toBe('Original');
    });

    it('waits for the existing context and hydration gates before starting either editor read', async () => {
        const {context, request} = await mounted(PackingSettings, function awaitContext(context) {
            context.hydrated.value = false;
            context.ready.value = false;
            return {listId: id, metadataAvailable: true};
        }, async function readEditor(request) {
            return json(new URL(request.url).pathname.endsWith('/metadata') ? metadata : projection);
        });
        expect(request).not.toHaveBeenCalled();
        context.hydrated.value = true;
        await flushPromises();
        expect(request).not.toHaveBeenCalled();
        context.ready.value = true;
        await flushPromises();
        expect(request).toHaveBeenCalledTimes(2);
        for (const [value] of request.mock.calls) expect((value as Request).headers.get('X-Surveyor-Context')).toBe(session.context);
    });

    it('retains unbounded creation drafts while generated code-point validation stops an invalid write', async () => {
        const writes: components['schemas']['PackingCreateInput'][] = [];
        const {wrapper} = await mounted(PackingCreatePage, {}, async request => {
            if (request.method === 'POST') {
                const form = await request.formData();
                writes.push(JSON.parse(String(form.get('data'))));
                throw new TypeError('Fixture stops at the external write boundary');
            }
            if (new URL(request.url).pathname.endsWith('/events')) return json({items: [], nextCursor: null, selected: null});
            return json({entry: {kind: 'render'}, context: formContext});
        }, '/packing/create');
        const title = wrapper.get<HTMLInputElement>('#create-title');
        const description = wrapper.get<HTMLTextAreaElement>('#create-description');
        expect(title.attributes('maxlength')).toBeUndefined();
        expect(description.attributes('maxlength')).toBeUndefined();
        await wrapper.get('#packing-row-0-title').setValue('Tent');
        await title.setValue('x'.repeat(256));
        await description.setValue('Retained description '.repeat(1000));
        await wrapper.get('form').trigger('submit');
        await flushPromises();
        expect(writes).toEqual([]);
        expect(title.element.value).toBe('x'.repeat(256));
        expect(description.element.value).toBe('Retained description '.repeat(1000));
        expect(wrapper.get('.alert-danger').text()).toContain('255');

        // This is 255 code points but 510 UTF-16 code units. A new native cap
        // would incorrectly block its unchanged valid request representation.
        await title.setValue('😀'.repeat(255));
        await wrapper.get('form').trigger('submit');
        await flushPromises();
        expect(writes).toHaveLength(1);
        expect(writes[0]!.title).toBe('😀'.repeat(255));
        expect(writes[0]!.description).toBe('Retained description '.repeat(1000));
    });

    it.each([false, true])('uses the admitted form skeleton without inventing copied rows (duplicate: %s)', async duplicate => {
        const delayed = deferredResponse();
        const path = duplicate ? `/packing/${id}/duplicate` : '/packing/create';
        const {wrapper} = await mounted(PackingCreatePage, {}, async () => delayed.response, path);
        const initialForm = 'section.card > .card-body > [data-loading-skeleton="packing-create"]';
        expect(wrapper.find(initialForm).exists()).toBe(true);
        expect(wrapper.find('form').exists()).toBe(false);
        delayed.resolve(json(duplicate ? {title: 'Empty source', description: null, eventId: null,
            items: [], defaultPermissions: defaults, formContext} : {entry: {kind: 'render'}, context: formContext}));
        await flushPromises();
        expect(wrapper.find(initialForm).exists()).toBe(false);
        expect(wrapper.find('#create-title').exists()).toBe(true);
        expect(wrapper.findAll('tbody tr')).toHaveLength(duplicate ? 0 : 1);
    });

    it('reports a failed first metadata read with reachable recovery rather than an endless placeholder', async () => {
        vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date']});
        let recovered = false;
        const {wrapper} = await mounted(MetadataFields, {listId: id}, async function readMetadata() {
            if (!recovered) throw new TypeError('Initial metadata response unavailable');
            return json(metadata);
        });
        // The real query retry scheduler remains active; only its clock advances.
        await vi.advanceTimersByTimeAsync(3000);
        await flushPromises();
        expect(wrapper.text()).toContain('This page could not be loaded.');
        expect(wrapper.find('[data-loading-skeleton]').exists()).toBe(false);
        expect(wrapper.find('form').exists()).toBe(false);
        recovered = true;
        await button(wrapper, 'Refresh').trigger('click');
        await flushPromises();
        expect(wrapper.find('[name="title"]').exists()).toBe(true);
    }, 10_000);
});

describe('inline packing drafts', () => {
    it.each([false, true])('retains only the initiating Everyone switch focus through its actual write and fresh read (%s)', async cancelled => {
        const mutation = deferredResponse();
        const refreshed = deferredResponse();
        const editableItem = {...item, capabilities: {...item.capabilities, editRequired: true}};
        let written = false;
        const {wrapper, request} = await mounted(PackingPage, {}, async function saveEveryone(request): Promise<Response> {
            if (request.method === 'PATCH') {
                written = true;
                expect(request.headers.get('If-Match')).toBe(item.editToken);
                expect(await request.json()).toEqual({requiredByAll: true});
                return mutation.response;
            }
            return written ? refreshed.response : json({...list, items: [editableItem]});
        });
        const control = wrapper.get<HTMLInputElement>('input[role="switch"]');
        control.element.focus();
        const focus = vi.spyOn(control.element, 'focus');

        try {
            await control.setValue(true);
            // The existing checked-value policy displays admitted state until
            // the real follow-up projection confirms the sparse token PATCH.
            expect(control.element.checked).toBe(false);
            releasePendingEditorFocus(control.element);
            if (cancelled) document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Tab', bubbles: true}));
            mutation.resolve(json({changed: true}));
            await flushPromises();
            expect(control.element.disabled).toBe(true);
            expect(focus).not.toHaveBeenCalled();
            expect(request.mock.calls.map(([value]) => (value as Request).method)).toEqual(['GET', 'PATCH', 'GET']);

            refreshed.resolve(json({...list, items: [{...editableItem, requiredByAll: true, editToken: '"edit-required"'}]}));
            await vi.waitFor(function settlesEveryone() { expect(control.element.disabled).toBe(false); });
            expect(wrapper.get('input[role="switch"]').element).toBe(control.element);
            expect(control.element.checked).toBe(true);
            if (cancelled) {
                expect(document.activeElement).toBe(document.body);
                expect(focus).not.toHaveBeenCalled();
            } else {
                expect(document.activeElement).toBe(control.element);
                expect(focus).toHaveBeenCalledExactlyOnceWith({preventScroll: true});
            }
        } finally {
            mutation.resolve(json({changed: true}));
            refreshed.resolve(json({...list, items: [editableItem]}));
            await flushPromises();
        }
    });

    it('restores the same retained editor after a rejected Enter save and its fresh conflict read', async () => {
        const rejected = deferredResponse();
        const refreshed = deferredResponse();
        let written = false;
        const {wrapper, request} = await mounted(PackingPage, {}, async function readRejectedEdit(request): Promise<Response> {
            if (request.method === 'PATCH') {
                written = true;
                return rejected.response;
            }
            return written ? refreshed.response : json(list);
        });
        const cell = wrapper.get('[data-item-id="' + itemId + '"]').findAll('td')[2]!;
        await cell.trigger('dblclick');
        const input = cell.get<HTMLInputElement>('input');
        await input.setValue('Retained local tent');
        expect(document.activeElement).toBe(input.element);
        const focus = vi.spyOn(input.element, 'focus');

        try {
            await input.trigger('keydown', {key: 'Enter'});
            await flushPromises();
            releasePendingEditorFocus(input.element);
            rejected.resolve(problem('PRECONDITION_FAILED', 412));
            await flushPromises();

            // A known rejection still awaits the existing authoritative read.
            // The same pending input must not regain focus between those stages.
            expect(input.element.disabled).toBe(true);
            expect(document.activeElement).toBe(document.body);
            expect(focus).not.toHaveBeenCalled();
            expect(request.mock.calls.map(([value]) => (value as Request).method)).toEqual(['GET', 'PATCH', 'GET']);

            refreshed.resolve(json({...list, items: [{...item, title: 'Remote tent', editToken: '"edit-remote-item"'}]}));
            // Await the actual query/command/editor handoff, including the shared
            // next-render focus completion, within the normal assertion deadline.
            await vi.waitFor(function finishesRejectedEdit() {
                expect(input.element.disabled).toBe(false);
                expect(document.activeElement).toBe(input.element);
            });
            expect(cell.get<HTMLInputElement>('input').element).toBe(input.element);
            expect(input.element.value).toBe('Retained local tent');
            expect(cell.get('.frontend-inline-conflict').text()).toContain('Remote tent');
            expect(focus).toHaveBeenCalledExactlyOnceWith({preventScroll: true});
        } finally {
            rejected.resolve(problem('PRECONDITION_FAILED', 412));
            refreshed.resolve(json(list));
            await flushPromises();
        }
    });

    it.each([
        {multiline: false, completion: 'Enter'}, {multiline: true, completion: 'Enter'},
        {multiline: false, completion: 'blur'}, {multiline: true, completion: 'blur'},
    ])('leaves composing Enter to the browser before $completion saves multiline=$multiline', async ({multiline, completion}) => {
        const save = vi.fn(async function saveCompletedComposition() { return true; });
        const {wrapper} = await mounted(InlineCell, {value: 'Original', token: '"original"',
            editable: true, multiline, label: 'Composing text', save});
        await wrapper.get('td').trigger('dblclick');
        const input = wrapper.get<HTMLInputElement | HTMLTextAreaElement>(multiline ? 'textarea' : 'input');
        await input.trigger('compositionstart');
        input.element.value = 'Original ni';
        input.element.dispatchEvent(new InputEvent('input', {bubbles: true, isComposing: true,
            inputType: 'insertCompositionText', data: 'ni'}));

        // Exercise the production shortcut with the browser composition flag.
        // This client boundary does not simulate an operating-system IME.
        const composingEnter = new KeyboardEvent('keydown', {key: 'Enter', ctrlKey: multiline,
            isComposing: true, bubbles: true, cancelable: true});
        expect(input.element.dispatchEvent(composingEnter)).toBe(true);
        await flushPromises();
        expect(composingEnter.defaultPrevented).toBe(false);
        expect(save).not.toHaveBeenCalled();
        expect(wrapper.get(multiline ? 'textarea' : 'input').element).toBe(input.element);
        expect(input.element.value).toBe('Original ni');
        expect(input.element.disabled).toBe(false);

        input.element.value = 'Original 日本語';
        await input.trigger('compositionend');
        await input.trigger('input');
        if (multiline) {
            // Plain Enter remains the textarea's own newline action; Ctrl+Enter
            // alone owns explicit submission after composition has finished.
            const newline = new KeyboardEvent('keydown', {key: 'Enter', bubbles: true, cancelable: true});
            expect(input.element.dispatchEvent(newline)).toBe(true);
            expect(newline.defaultPrevented).toBe(false);
            expect(save).not.toHaveBeenCalled();
        }

        if (completion === 'blur') await input.trigger('blur');
        else {
            const enter = new KeyboardEvent('keydown', {key: 'Enter', ctrlKey: multiline,
                bubbles: true, cancelable: true});
            expect(input.element.dispatchEvent(enter)).toBe(false);
            expect(enter.defaultPrevented).toBe(true);
        }
        await flushPromises();
        expect(save).toHaveBeenCalledExactlyOnceWith('Original 日本語', '"original"');
        expect(input.element.isConnected).toBe(false);
        expect(wrapper.emitted('editing')).toEqual([[true], [false]]);
    });

    it('restores a retained multiline editor after a rejected Ctrl+Enter save', async () => {
        const held = deferredInlineSave();
        const save = vi.fn(function saveDescription() { return held.result; });
        const {wrapper} = await mounted(InlineCell, {value: 'Original description', token: '"original"',
            editable: true, multiline: true, label: 'Description', save});
        await wrapper.get('td').trigger('dblclick');
        const input = wrapper.get<HTMLTextAreaElement>('textarea');
        await input.setValue('Retained description\nSecond line');
        expect(document.activeElement).toBe(input.element);
        const focus = vi.spyOn(input.element, 'focus');

        try {
            await input.trigger('keydown', {key: 'Enter', ctrlKey: true});
            expect(wrapper.get('[role="status"]').text()).toBe('Saving…');
            expect(wrapper.find('[role="status"] .spinner-border').exists()).toBe(true);
            releasePendingEditorFocus(input.element);
            held.resolve(false);
            await flushPromises();
            expect(wrapper.find('[role="status"]').exists()).toBe(false);
            expect(wrapper.get<HTMLTextAreaElement>('textarea').element).toBe(input.element);
            expect(input.element.value).toBe('Retained description\nSecond line');
            expect(document.activeElement).toBe(input.element);
            expect(focus).toHaveBeenCalledExactlyOnceWith({preventScroll: true});
            expect(save).toHaveBeenCalledExactlyOnceWith('Retained description\nSecond line', '"original"');
        } finally { held.resolve(false); await flushPromises(); }
    });

    it('does not reclaim focus after a retained editor was deliberately blurred to save', async () => {
        const held = deferredInlineSave();
        const save = vi.fn(function saveBlurredEditor() { return held.result; });
        const {wrapper} = await mounted(InlineCell, {value: 'Tent', token: '"original"', editable: true, label: 'Title', save});
        await wrapper.get('td').trigger('dblclick');
        const input = wrapper.get<HTMLInputElement>('input');
        await input.setValue('Retained local tent');
        const focus = vi.spyOn(input.element, 'focus');
        const other = document.createElement('button');
        document.body.append(other);

        try {
            // Moving to another live control fires the actual blur-save event.
            // Even returning to body later must not turn that save into a claim.
            other.focus();
            await flushPromises();
            expect(input.element.disabled).toBe(true);
            other.blur();
            expect(document.activeElement).toBe(document.body);
            held.resolve(false);
            await flushPromises();
            expect(input.element.disabled).toBe(false);
            expect(input.element.value).toBe('Retained local tent');
            expect(document.activeElement).toBe(document.body);
            expect(focus).not.toHaveBeenCalled();
            expect(save).toHaveBeenCalledExactlyOnceWith('Retained local tent', '"original"');
        } finally { held.resolve(false); await flushPromises(); }
    });

    it.each(['pointer', 'keyboard', 'other-focus', 'window-blur', 'identity', 'write-admission',
        'field-admission', 'blocked', 'initializing', 'unmounted', 'confirmed'] as const)(
            'does not restore a pending inline editor after %s retires its focus claim', async retirement => {
                const held = deferredInlineSave();
                const save = vi.fn(function saveRetiredEditor() { return held.result; });
                const {root, wrapper, context, update} = await mounted(InlineCell,
                    {value: 'Tent', token: '"original"', editable: true, label: 'Title', save});
                await wrapper.get('td').trigger('dblclick');
                const input = wrapper.get<HTMLInputElement>('input');
                await input.setValue('Retained local tent');
                const focus = vi.spyOn(input.element, 'focus');
                const other = document.createElement('button');
                document.body.append(other);

                try {
                    await input.trigger('keydown', {key: 'Enter'});
                    releasePendingEditorFocus(input.element);
                    // Each boundary is independent: no later body focus may resurrect
                    // an interaction, obsolete identity, lost admission or removed node.
                    if (retirement === 'pointer') other.dispatchEvent(new Event('pointerdown', {bubbles: true}));
                    else if (retirement === 'keyboard') document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Tab', bubbles: true}));
                    else if (retirement === 'other-focus') { other.focus(); other.blur(); }
                    else if (retirement === 'window-blur') window.dispatchEvent(new Event('blur'));
                    else if (retirement === 'identity') context.epoch.value++;
                    else if (retirement === 'write-admission') await update({writeAdmission: false});
                    else if (retirement === 'field-admission') await update({editable: false});
                    else if (retirement === 'blocked') await update({disabled: true});
                    else if (retirement === 'initializing') context.hydrated.value = false;
                    else if (retirement === 'unmounted') root.unmount();
                    held.resolve(retirement === 'confirmed');
                    await flushPromises();
                    expect(document.activeElement).toBe(document.body);
                    expect(focus).not.toHaveBeenCalled();
                    expect(save).toHaveBeenCalledExactlyOnceWith('Retained local tent', '"original"');
                    if (retirement !== 'unmounted' && retirement !== 'confirmed')
                        expect(wrapper.get<HTMLInputElement>('input').element.value).toBe('Retained local tent');
                    else expect(input.element.isConnected).toBe(false);
                } finally { held.resolve(false); await flushPromises(); }
            },
        );

    it.each(['0', '-1', '', '1.5'])('sends the native raw capacity draft %j through the generated command boundary', async value => {
        const projection = {...list, items: [{...item, capabilities: {...item.capabilities, editCapacity: true, showCapacityEdit: true}}]};
        const sent: unknown[] = [];
        const {wrapper} = await mounted(PackingPage, {}, async function capacityTransport(request) {
            if (request.method === 'PATCH') {
                sent.push(await request.json());
                expect(request.headers.get('If-Match')).toBe(item.editToken);
                return json({changed: true});
            }
            return json(projection);
        });
        await wrapper.get('tbody tr td:nth-child(5)').trigger('dblclick');
        await wrapper.get('tbody input[type="number"]').setValue(value);
        await wrapper.get('tbody input[type="number"]').trigger('keydown', {key: 'Enter'});
        await flushPromises();
        // The native editor and feature operation must retain the same string.
        // SQL persistence and rounding are covered by the paired real HTTP case,
        // rather than reproduced in this transport-boundary replacement.
        expect(sent).toEqual([{maxAssignees: value}]);
    });

    // These InlineCell lifecycle branches do not depend on the field label.
    // Separate native caret and feature payload cases retain Description parity.
    it('keeps a padded title unchanged through native editor blur, Enter and cancellation', async () => {
        const value = '  Tent  ';
        const save = vi.fn(async () => true);
        const confirm = vi.fn(() => false);
        vi.stubGlobal('confirm', confirm);
        const {wrapper, context} = await mounted(InlineCell,
            {value, token: '"raw-original"', editable: true, label: 'Title', save});

        for (const action of ['blur', 'Enter', 'Escape']) {
            await wrapper.get('td').trigger('dblclick');
            expect(wrapper.get<HTMLInputElement>('input').element.value).toBe(value.trim());
            expect(context.mayChangeIdentity()).toBe(true);
            if (action === 'blur') await wrapper.get('input').trigger('blur');
            else await wrapper.get('input').trigger('keydown', {key: action});
            await flushPromises();
            expect(wrapper.find('input').exists()).toBe(false);
        }
        expect(save).not.toHaveBeenCalled();
        expect(confirm).not.toHaveBeenCalled();
    });

    it('saves an intentionally changed padded title with the captured authority token', async () => {
        const save = vi.fn(async () => true);
        const {wrapper} = await mounted(InlineCell,
            {value: '  Tent  ', token: '"raw-original"', editable: true, label: 'Title', save});
        await wrapper.get('td').trigger('dblclick');
        await wrapper.get('input').setValue('  Deliberate edit  ');
        await wrapper.get('input').trigger('keydown', {key: 'Enter'});
        await flushPromises();
        expect(save).toHaveBeenCalledExactlyOnceWith('Deliberate edit', '"raw-original"');
    });

    it('detects a changed raw snapshot even when its normalized editor baseline is identical', async () => {
        const save = vi.fn(async () => true);
        const {wrapper, update} = await mounted(InlineCell,
            {value: '  Tent  ', token: '"raw-original"', editable: true, label: 'Title', save});
        await wrapper.get('td').trigger('dblclick');
        await wrapper.get('input').setValue('  Deliberate edit  ');
        await update({value: 'Tent', token: '"raw-changed"'});
        await wrapper.get('input').trigger('blur');
        expect(save).not.toHaveBeenCalled();
        expect(wrapper.find('.frontend-inline-conflict').exists()).toBe(true);
        expect(wrapper.get<HTMLInputElement>('input').element.value).toBe('  Deliberate edit  ');

        await button(wrapper, 'Review changes').trigger('click');
        await wrapper.get('input').trigger('keydown', {key: 'Enter'});
        await flushPromises();
        expect(save).toHaveBeenCalledExactlyOnceWith('Deliberate edit', '"raw-changed"');
    });

    it('adopts a token-only refresh while preserving the padded raw snapshot and local edit', async () => {
        const save = vi.fn(async () => true);
        const {wrapper, update} = await mounted(InlineCell,
            {value: '  Tent  ', token: '"raw-original"', editable: true, label: 'Title', save});
        await wrapper.get('td').trigger('dblclick');
        await wrapper.get('input').setValue('  Deliberate edit  ');
        await update({token: '"another-field-changed"'});
        expect(wrapper.find('.frontend-inline-conflict').exists()).toBe(false);
        expect(wrapper.get<HTMLInputElement>('input').element.value).toBe('  Deliberate edit  ');
        await wrapper.get('input').trigger('keydown', {key: 'Enter'});
        await flushPromises();
        expect(save).toHaveBeenCalledExactlyOnceWith('Deliberate edit', '"another-field-changed"');
    });

    it('enforces an explicitly requested constraint without inferring one from numeric presentation', async () => {
        const save = vi.fn(async () => true);
        const {wrapper} = await mounted(InlineCell, {value: 1, token: '"old"', editable: true,
            numeric: true, required: true, label: 'Capacity', save});
        await wrapper.get('td').trigger('dblclick');
        await wrapper.get('input').setValue('');
        await wrapper.get('input').trigger('keydown', {key: 'Enter'});
        expect(save).not.toHaveBeenCalled();
        await wrapper.get('input').setValue('3');
        await wrapper.get('input').trigger('keydown', {key: 'Enter'});
        await flushPromises();
        expect(save).toHaveBeenCalledExactlyOnceWith('3', '"old"');
    });

    it('protects an inline draft before an explicit identity switch and releases the guard with the draft', async () => {
        const confirm = vi.fn(() => false);
        vi.stubGlobal('confirm', confirm);
        const {wrapper, context, update} = await mounted(InlineCell, {value: 'Tent', token: '"old"', editable: true, label: 'Item', save: async () => true});
        await wrapper.get('td').trigger('dblclick');
        await wrapper.get('input').setValue('Private draft');
        expect(context.mayChangeIdentity()).toBe(false);
        expect(confirm).toHaveBeenCalledTimes(1);
        const input = wrapper.get<HTMLInputElement>('input').element;
        await update({editable: false});
        expect(wrapper.get<HTMLInputElement>('input').element).toBe(input);
        expect(input.value).toBe('Private draft');
        expect(input.disabled).toBe(true);
        expect(context.mayChangeIdentity()).toBe(false);
        await wrapper.get('input').trigger('keydown', {key: 'Enter'});
        expect(wrapper.emitted('editing')).toEqual([[true]]);
        await button(wrapper, 'Cancel').trigger('click');
        expect(context.mayChangeIdentity()).toBe(true);
        expect(wrapper.find('input').exists()).toBe(false);
        expect(wrapper.emitted('editing')).toEqual([[true], [false]]);
    });
    it('retains a dirty value and its original token until the user reviews a remote update', async () => {
        const save = vi.fn(async () => true);
        const {wrapper, update} = await mounted(InlineCell, {value: 'Tent', token: '"old"', editable: true, label: 'Item', save});
        await wrapper.get('td').trigger('dblclick');
        await wrapper.get('input').setValue('Local tent');
        await update({value: 'Remote tent', token: '"new"'});
        await wrapper.get('input').trigger('blur');
        expect(save).not.toHaveBeenCalled();
        expect(wrapper.get<HTMLInputElement>('input').element.value).toBe('Local tent');
        expect(wrapper.text()).toContain('Remote tent');
        await button(wrapper, 'Review changes').trigger('click');
        await wrapper.get('input').trigger('keydown', {key: 'Enter'});
        await flushPromises();
        expect(save).toHaveBeenCalledExactlyOnceWith('Local tent', '"new"');
        expect(wrapper.emitted('editing')).toEqual([[true], [false]]);
    });

    it('does not release another cell’s drag lock or submit while its command host is locked', async () => {
        const save = vi.fn(async () => true);
        const {wrapper, update} = await mounted(InlineCell, {value: 'Tent', token: '"old"', editable: true, label: 'Item', save});
        await update({editable: false});
        expect(wrapper.emitted('editing')).toBeUndefined();
        await update({editable: true});
        await wrapper.get('td').trigger('dblclick');
        await wrapper.get('input').setValue('Local tent');
        await update({disabled: true});
        await wrapper.get('input').trigger('blur');
        expect(save).not.toHaveBeenCalled();
        expect(wrapper.get('input').attributes('disabled')).toBeDefined();
        await update({disabled: false, editable: false});
        expect(wrapper.get<HTMLInputElement>('input').element.value).toBe('Local tent');
        expect(wrapper.emitted('editing')).toEqual([[true]]);
        await wrapper.get('input').trigger('blur');
        expect(save).not.toHaveBeenCalled();
        await button(wrapper, 'Cancel').trigger('click');
        expect(wrapper.emitted('editing')).toEqual([[true], [false]]);
    });

    it('releases the drag lock once when a confirmed save refresh removes the edited row', async () => {
        const held = deferredResponse();
        const thirdId = '44444444-4444-4444-8444-444444444444';
        const remaining = [{...item, id: otherId, title: 'Stove', position: 1},
        {...item, id: thirdId, title: 'Lantern', position: 2}];
        let written = false;
        let writes = 0;
        let ordering: unknown;
        const {wrapper, context} = await mounted(PackingPage, {}, async request => {
            if (request.method === 'PATCH') {
                written = true;
                writes++;
                return held.response;
            }
            if (request.method === 'PUT') {
                ordering = await request.json();
                return json({changed: true});
            }
            // Another actor deletes the edited item before the confirmed write's
            // follow-up read. The inline owner retires while save is still awaited.
            return json({...list, items: written ? remaining : [item, ...remaining]});
        });
        const edited = wrapper.get('[data-item-id="' + itemId + '"]').findAll('td')[2]!;
        await edited.trigger('dblclick');
        await edited.get('input').setValue('Updated tent');
        await edited.get('input').trigger('keydown', {key: 'Enter'});
        await flushPromises();
        try {
            await context.queryClient.invalidateQueries({queryKey: packingKeys.detail(session.context, id)});
            await flushPromises();
            expect(wrapper.find('[data-item-id="' + itemId + '"]').exists()).toBe(false);
            expect(writes).toBe(1);
        } finally {
            held.resolve(json({changed: true}));
            await flushPromises();
        }

        const stove = wrapper.get('[data-item-id="' + otherId + '"]');
        const lantern = wrapper.get('[data-item-id="' + thirdId + '"]');
        expect(stove.attributes('draggable')).toBe('true');
        await lantern.trigger('dragstart');
        await stove.trigger('drop');
        await flushPromises();
        expect(ordering).toEqual({itemIds: [thirdId, otherId]});
    });
});

describe('metadata conflict acknowledgement', () => {
    it.each([false, true])('keeps confirmed values separate from a GET before PATCH commit (follow-up fails: %s)', async fails => {
        const held = deferredResponse();
        const baseline: components['schemas']['PackingMetadata'] = {entityType: 'packing', id,
            values: {title: 'Original', description: 'Original note'}, editableFields: ['title', 'description'],
            currentEventId: null, archived: false, inheritedArchived: false};
        let current = baseline;
        let committed = false;
        let readFails = fails;
        let writes = 0;
        const {wrapper, context} = await mounted(MetadataFields, context => {
            context.queryClient.setDefaultOptions({queries: {retry: false}});
            return {listId: id};
        }, async request => {
            if (request.method === 'PATCH') {
                writes++;
                const response = await held.response;
                current = {...current, values: {...current.values, title: 'Submitted title'}};
                committed = true;
                return response;
            }
            if (committed && readFails) throw new TypeError('Post-confirmation read unavailable');
            const response = json(current);
            response.headers.set('ETag', committed ? '"after-commit"' : '"before-commit"');
            return response;
        });
        await wrapper.get('[name="title"]').setValue('Submitted title');
        await wrapper.get('form').trigger('submit');
        await flushPromises();

        // This independent GET observes an untouched-field edit before PATCH commits.
        // Its arrival order cannot make its old title authoritative after confirmation.
        current = {...baseline, values: {...baseline.values, description: 'Concurrent note'}};
        await context.queryClient.invalidateQueries({queryKey: packingKeys.metadata(session.context, id)});
        held.resolve(json({...current, values: {...current.values, title: 'Submitted title'}}));
        await flushPromises();
        expect(wrapper.get<HTMLInputElement>('[name="title"]').element.value).toBe('Submitted title');
        expect(wrapper.get<HTMLTextAreaElement>('[name="description"]').element.value).toBe('Concurrent note');
        expect(writes).toBe(1);

        if (fails) {
            expect(wrapper.text()).toContain(context.messages.value.t('state.savedRefreshFailed'));
            expect(button(wrapper, 'Save properties').attributes('disabled')).toBeDefined();
            await wrapper.get('form').trigger('submit');
            expect(writes).toBe(1);
            readFails = false;
            await button(wrapper, 'Refresh').trigger('click');
            await flushPromises();
            expect(wrapper.get<HTMLInputElement>('[name="title"]').element.value).toBe('Submitted title');
            expect(wrapper.text()).not.toContain(context.messages.value.t('state.savedRefreshFailed'));
            expect(button(wrapper, 'Save properties').attributes('disabled')).toBeUndefined();
        } else {
            await wrapper.get('[name="title"]').setValue('Another title');
            await wrapper.get('form').trigger('submit');
            await flushPromises();
            expect(writes).toBe(2);
        }
    });

    it('retains accepted metadata while a locale GET predates confirmation and the fresh read fails', async () => {
        const write = deferredResponse();
        const oldRead = deferredResponse();
        const baseline: components['schemas']['PackingMetadata'] = {entityType: 'packing', id,
            values: {title: 'Original'}, editableFields: ['title'], currentEventId: null,
            archived: false, inheritedArchived: false};
        let writing = false;
        let committed = false;
        let readsAfterConfirmation = 0;
        const {wrapper, context} = await mounted(PackingSettings, context => {
            context.queryClient.setDefaultOptions({queries: {retry: false}});
            return {listId: id, metadataAvailable: true};
        }, async request => {
            const path = new URL(request.url).pathname;
            if (path.endsWith('/locale')) return json({...session, locale: 'de'});
            if (path.endsWith('/settings')) {
                if (committed) throw new TypeError('Related settings unavailable');
                return json({...settings, editableFields: ['title']});
            }
            if (request.method === 'PATCH') {
                writing = true;
                const response = await write.response;
                committed = true;
                return response;
            }
            if (committed) {
                readsAfterConfirmation++;
                throw new TypeError('Fresh metadata unavailable');
            }
            if (writing && request.headers.get('X-Surveyor-Locale') === 'de') return oldRead.response;
            return json(baseline);
        });
        const metadata = wrapper.findComponent(MetadataFields);
        await metadata.get('[name="title"]').setValue('Submitted title');
        await metadata.get('form').trigger('submit');
        await flushPromises();
        const changingLocale = context.changeLocale('de');
        await flushPromises();
        expect(context.locale.value).toBe('de');
        write.resolve(json({...baseline, values: {title: 'Submitted title'}}));
        await flushPromises();
        expect(metadata.get<HTMLInputElement>('[name="title"]').element.value).toBe('Submitted title');
        expect(readsAfterConfirmation).toBe(1);

        // Finishing the cancelled old GET must not overwrite confirmed presentation
        // or reopen Save. The follow-up failed, so no new token has been accepted.
        oldRead.resolve(json(baseline));
        await changingLocale;
        await flushPromises();
        expect(metadata.get<HTMLInputElement>('[name="title"]').element.value).toBe('Submitted title');
        expect(button(metadata, context.messages.value.t('packing.saveProperties')).attributes('disabled')).toBeDefined();
        expect(document.body.textContent).toContain(context.messages.value.t('state.savedRefreshFailed'));
    });

    it('retains a confirmed metadata save after an explicitly canceled warm follow-up until a fresh admitted GET', async function preservesCanceledWarmAuthority() {
        const canceled = deferredResponse();
        const recovery = deferredResponse();
        const baseline: components['schemas']['PackingMetadata'] = {entityType: 'packing', id,
            values: {title: 'Original'}, editableFields: ['title'], currentEventId: null,
            archived: false, inheritedArchived: false};
        let current = baseline;
        let reads = 0;
        let writes = 0;
        let signal: AbortSignal | undefined;
        const tokens: (string | null)[] = [];
        const {wrapper, context} = await mounted(MetadataFields, {listId: id}, async function readMetadataAuthority(request): Promise<Response> {
            if (request.method === 'PATCH') {
                writes++;
                tokens.push(request.headers.get('If-Match'));
                current = {...current, values: {...current.values, ...await request.json() as components['schemas']['BasicEntityMetadataPatch']}};
                return json(current);
            }
            if (++reads === 2) { signal = request.signal; return canceled.response; }
            if (reads === 3) return recovery.response;
            const response = json(current);
            response.headers.set('ETag', reads === 1 ? '"original"' : '"fresh"');
            return response;
        });
        await wrapper.get('[name="title"]').setValue('Confirmed title');
        await wrapper.get('form').trigger('submit');
        await flushPromises();
        expect(reads).toBe(2);
        expect(writes).toBe(1);

        // Cancel the actual warm query while its post-write transport waits. Saved
        // values survive; canceled retained data never supplies new grants or token.
        const key = packingKeys.metadata(session.context, id);
        await context.queryClient.cancelQueries({queryKey: key, exact: true});
        await flushPromises();
        const metadata = wrapper.findComponent(MetadataFields);
        expect(signal?.aborted).toBe(true);
        expect(metadata.vm.awaitingAuthority).toBe(true);
        expect(wrapper.get<HTMLInputElement>('[name="title"]').element.value).toBe('Confirmed title');
        expect(wrapper.text()).toContain(context.messages.value.t('state.savedRefreshFailed'));
        expect(wrapper.text()).not.toContain(context.messages.value.t('state.unknownOutcome'));
        expect(wrapper.emitted('saved')).toHaveLength(1);
        expect(wrapper.emitted('close')).toHaveLength(1);

        // Neither a manual alias nor the late canceled response may release Save.
        context.queryClient.setQueryData(key, {data: baseline, etag: '"alias"'});
        canceled.resolve(json(baseline));
        await flushPromises();
        await wrapper.get('form').trigger('submit');
        expect(writes).toBe(1);
        expect(metadata.vm.awaitingAuthority).toBe(true);
        expect(button(wrapper, context.messages.value.t('packing.saveProperties')).attributes('disabled')).toBeDefined();

        await button(wrapper, 'Refresh').trigger('click');
        await flushPromises();
        expect(reads).toBe(3);
        expect(metadata.vm.awaitingAuthority).toBe(true);
        expect(writes).toBe(1);
        const fresh = json(current);
        fresh.headers.set('ETag', '"fresh"');
        recovery.resolve(fresh);
        await flushPromises();
        expect(metadata.vm.awaitingAuthority).toBe(false);
        expect(wrapper.get<HTMLInputElement>('[name="title"]').element.value).toBe('Confirmed title');
        expect(wrapper.text()).not.toContain(context.messages.value.t('state.savedRefreshFailed'));

        // Only another deliberate edit uses the fresh receipt; recovery never replays PATCH.
        await wrapper.get('[name="title"]').setValue('Another deliberate title');
        await wrapper.get('form').trigger('submit');
        await flushPromises();
        expect(writes).toBe(2);
        expect(tokens).toEqual(['"original"', '"fresh"']);
    });

    it('retains confirmed metadata and accepts its uncanceled warm follow-up across a locale change', async () => {
        const oldRead = deferredResponse();
        const baseline: components['schemas']['PackingMetadata'] = {entityType: 'packing', id,
            values: {title: 'Original'}, editableFields: ['title'], currentEventId: null,
            archived: false, inheritedArchived: false};
        let current = baseline;
        let reads = 0;
        let writes = 0;
        let oldSignal: AbortSignal | undefined;
        const tokens: (string | null)[] = [];
        const {wrapper, context} = await mounted(MetadataFields, context => {
            context.queryClient.setDefaultOptions({queries: {retry: false}});
            return {listId: id};
        }, async request => {
            if (new URL(request.url).pathname.endsWith('/locale')) return json({...session, locale: 'de'});
            if (request.method === 'PATCH') {
                writes++;
                tokens.push(request.headers.get('If-Match'));
                const patch = await request.json() as components['schemas']['BasicEntityMetadataPatch'];
                current = {...current, values: {...current.values, ...patch}};
                return json(current);
            }
            reads++;
            if (reads === 2) { oldSignal = request.signal; return oldRead.response; }
            const response = json(current);
            response.headers.set('ETag', reads === 1 ? '"original"' : '"fresh"');
            return response;
        });
        await wrapper.get('[name="title"]').setValue('Confirmed title');
        await wrapper.get('form').trigger('submit');
        await flushPromises();
        expect(reads).toBe(2);
        expect(writes).toBe(1);

        const changingLocale = context.changeLocale('de');
        await changingLocale;
        await flushPromises();
        expect(reads).toBe(2);
        const metadata = wrapper.findComponent(MetadataFields);
        expect(oldSignal?.aborted).toBe(false);
        expect(wrapper.get<HTMLInputElement>('[name="title"]').element.value).toBe('Confirmed title');
        expect(metadata.vm.awaitingAuthority).toBe(true);
        expect(button(wrapper, context.messages.value.t('packing.saveProperties')).attributes('disabled')).toBeDefined();
        expect(wrapper.text()).not.toContain(context.messages.value.t('state.savedRefreshFailed'));
        expect(wrapper.emitted('saved')).toBeUndefined();
        expect(wrapper.emitted('close')).toBeUndefined();
        expect(wrapper.text()).not.toContain(context.messages.value.t('state.unknownOutcome'));

        // A manual cache alias is no network receipt. It cannot release the confirmed
        // editor or replace its values/token while the admitted follow-up GET waits.
        context.queryClient.setQueryData(packingKeys.metadata(session.context, id), {data: baseline, etag: '"alias"'});
        await flushPromises();
        expect(metadata.vm.awaitingAuthority).toBe(true);
        expect(wrapper.get<HTMLInputElement>('[name="title"]').element.value).toBe('Confirmed title');
        await wrapper.get('form').trigger('submit');
        expect(writes).toBe(1);

        const fresh = json(current);
        fresh.headers.set('ETag', '"fresh"');
        oldRead.resolve(fresh);
        await flushPromises();
        expect(metadata.vm.awaitingAuthority).toBe(false);
        expect(wrapper.get<HTMLInputElement>('[name="title"]').element.value).toBe('Confirmed title');
        expect(wrapper.text()).not.toContain(context.messages.value.t('state.savedRefreshFailed'));
        expect(button(wrapper, context.messages.value.t('packing.saveProperties')).attributes('disabled')).toBeUndefined();
        expect(writes).toBe(1);
        expect(reads).toBe(2);
        expect(wrapper.emitted('saved')).toHaveLength(1);
        expect(wrapper.emitted('close')).toHaveLength(1);

        // Only a separate deliberate Save uses the admitted follow-up's token. Recovery
        // has performed reads throughout and never replayed the confirmed PATCH.
        await wrapper.get('[name="title"]').setValue('Another deliberate title');
        await wrapper.get('form').trigger('submit');
        await flushPromises();
        expect(writes).toBe(2);
        expect(tokens).toEqual(['"original"', '"fresh"']);
    });

    it.each(['known', 'future', 'malformed', 'html', 'mismatched'] as const)(
        'classifies an actual metadata %s error by its validated rejection envelope', async kind => {
            const baseline: components['schemas']['PackingMetadata'] = {entityType: 'packing', id,
                values: {title: 'Original'}, editableFields: ['title'], currentEventId: null,
                archived: false, inheritedArchived: false};
            let writes = 0;
            const {wrapper, context} = await mounted(MetadataFields, {listId: id}, async request => {
                if (request.method !== 'PATCH') return json(baseline);
                writes++;
                if (kind === 'known') return problem('VALIDATION_FAILED', 400);
                if (kind === 'future' || kind === 'mismatched') return json({type: 'about:blank',
                    title: 'Request failed', status: kind === 'mismatched' ? 409 : 400,
                    detail: 'A safely described future rejection.', requestId: 'metadata-rejection'}, 400);
                return new Response(kind === 'html' ? '<html>Proxy failed</html>' : '{invalid',
                    {status: 400, headers: {'Content-Type': kind === 'html' ? 'text/html' : 'application/json',
                            'X-Surveyor-Context': session.context}});
            });
            await wrapper.get('[name="title"]').setValue('Submitted title');
            await wrapper.get('form').trigger('submit');
            await flushPromises();
            const confirmed = kind === 'known' || kind === 'future';
            expect(wrapper.text().includes(context.messages.value.t('state.unknownOutcome'))).toBe(!confirmed);
            await wrapper.get('form').trigger('submit');
            await flushPromises();
            expect(writes).toBe(confirmed ? 2 : 1);
            if (!confirmed) {
                await button(wrapper, 'Refresh').trigger('click');
                await flushPromises();
                expect(wrapper.text()).toContain(context.messages.value.t('draft.unknownReview'));
                expect(writes).toBe(1);
            }
        });

    it.each(['revoked', 'authorized'] as const)(
        'preserves newer %s metadata authority when an older confirmed PATCH arrives', async authority => {
            const held = deferredResponse();
            const original: components['schemas']['PackingMetadata'] = {entityType: 'packing', id,
                values: {title: 'Original'}, editableFields: ['title'], currentEventId: null,
                archived: false, inheritedArchived: false};
            const newer: components['schemas']['PackingMetadata'] = {...original,
                values: authority === 'revoked' ? {} : {title: 'Newer authority'},
                editableFields: authority === 'revoked' ? [] : ['title']};
            let changed = false;
            const {wrapper, context} = await mounted(MetadataFields, {listId: id}, async request => {
                if (request.method === 'PATCH') return held.response;
                return changed ? new Response(JSON.stringify(newer), {headers: {'Content-Type': 'application/json',
                        'X-Surveyor-Context': session.context, ETag: '"newer-read"'}}) : json(original);
            });
            await wrapper.get('[name="title"]').setValue('Submitted title');
            await wrapper.get('form').trigger('submit');
            await flushPromises();
            changed = true;
            await context.queryClient.invalidateQueries({queryKey: packingKeys.metadata(session.context, id)});
            await flushPromises();
            held.resolve(json({...original, values: {title: 'Submitted title'}}));
            await flushPromises();

            expect(context.queryClient.getQueryData(packingKeys.metadata(session.context, id)))
                .toEqual({data: newer, etag: '"newer-read"'});
            expect(wrapper.text()).not.toContain(context.messages.value.t('state.unknownOutcome'));
            if (authority === 'revoked') {
                expect(wrapper.find('[name="title"]').exists()).toBe(false);
                expect(wrapper.emitted('saved')).toBeUndefined();
                expect(wrapper.emitted('close')).toBeUndefined();
            } else {
                expect(wrapper.get<HTMLInputElement>('[name="title"]').element.value).toBe('Newer authority');
                expect(wrapper.emitted('saved')).toEqual([[]]);
                expect(wrapper.emitted('close')).toEqual([[]]);
                expect(context.mayChangeIdentity()).toBe(true);
            }
        });

    it('keeps a failed metadata read durable and clears only that warning after an equal successful refresh', async () => {
        let readFails = false;
        const baseline: components['schemas']['PackingMetadata'] = {entityType: 'packing', id,
            values: {title: 'Original'}, editableFields: ['title'], currentEventId: null,
            archived: false, inheritedArchived: false};
        const {wrapper, context} = await mounted(MetadataFields, context => {
            context.queryClient.setDefaultOptions({queries: {retry: false}});
            return {listId: id};
        }, async request => {
            if (request.method === 'PATCH') return problem('VALIDATION_FAILED', 400);
            if (readFails) throw new TypeError('Metadata read unavailable');
            return json(baseline);
        });
        vi.useFakeTimers();
        readFails = true;
        // Settings invokes this exposed read operation; an admitted clean editor
        // does not display a separate recovery button until a read needs one.
        await (wrapper.vm as unknown as {refresh(): Promise<void>}).refresh();
        await flushPromises();
        expect(wrapper.text()).toContain(context.messages.value.t('state.stale'));
        await vi.advanceTimersByTimeAsync(11_000);
        await flushPromises();
        expect(wrapper.text()).toContain(context.messages.value.t('state.stale'));

        // The recovered read has identical JSON/ETag. Its cache object can be shared,
        // but completion must still retire only the warning owned by that read.
        readFails = false;
        await context.queryClient.invalidateQueries({queryKey: packingKeys.metadata(session.context, id)});
        await flushPromises();
        expect(wrapper.text()).not.toContain(context.messages.value.t('state.stale'));

        await wrapper.get('[name="title"]').setValue('Rejected title');
        await wrapper.get('form').trigger('submit');
        await flushPromises();
        const validation = context.messages.value.t('api:errors.VALIDATION_FAILED');
        expect(wrapper.text()).toContain(validation);
        await context.queryClient.invalidateQueries({queryKey: packingKeys.metadata(session.context, id)});
        await flushPromises();
        expect(wrapper.text()).toContain(validation);
        expect(wrapper.get<HTMLInputElement>('[name="title"]').element.value).toBe('Rejected title');
    });

    it('reads and offers review after a rejected conditional save while the command is still pending', async () => {
        let title = 'Original';
        const tokens: (string | null)[] = [];
        const {wrapper} = await mounted(MetadataFields, {listId: id}, async request => {
            if (request.method === 'PATCH') {
                tokens.push(request.headers.get('If-Match'));
                if (tokens.length === 1) {
                    title = 'Remote title';
                    return problem('PRECONDITION_FAILED', 412);
                }
                title = (await request.json()).title;
            }
            const result = json({entityType: 'packing', id, values: {title}, editableFields: ['title'],
                currentEventId: null, archived: false, inheritedArchived: false});
            result.headers.set('ETag', title === 'Original' ? '"original"' : '"remote"');
            return result;
        });
        await wrapper.get('[name="title"]').setValue('Local title');
        await wrapper.get('form').trigger('submit');
        await flushPromises();
        expect(wrapper.text()).toContain('Remote title');
        expect(button(wrapper, 'Save properties').attributes('disabled')).toBeDefined();
        await wrapper.get('input[name="resolve-title"][value="mine"]').setValue(true);
        await button(wrapper, 'Review changes').trigger('click');
        await wrapper.get('form').trigger('submit');
        await flushPromises();
        expect(tokens).toEqual(['"original"', '"remote"']);
    });

    it('treats a cleared nullable description as pristine rather than inventing a PATCH', async () => {
        const baseline: components['schemas']['PackingMetadata'] = {entityType: 'packing', id,
            values: {title: 'Original', description: null}, editableFields: ['title', 'description'],
            currentEventId: null, archived: false, inheritedArchived: false};
        const {wrapper, request} = await mounted(MetadataFields, {listId: id}, async () => json(baseline));
        await wrapper.get('[name="description"]').setValue('Temporary text');
        await wrapper.get('[name="description"]').setValue('');
        expect(button(wrapper, 'Save properties').attributes('disabled')).toBeUndefined();
        await button(wrapper, 'Save properties').trigger('click');
        await wrapper.get('form').trigger('submit');
        expect(wrapper.get('.alert-info').text()).toBe('There are no property changes to save.');
        expect(wrapper.emitted('saved')).toBeUndefined();
        expect(wrapper.emitted('close')).toBeUndefined();
        expect(request.mock.calls.map(([value]) => (value as Request).method)).toEqual(['GET']);

        // Original native Save reveals a collapsed invalid field before browser
        // reporting, even though no PATCH or pristine feedback may be admitted.
        const form = wrapper.get<HTMLFormElement>('form');
        const disclosure = wrapper.get<HTMLDetailsElement>('details');
        const title = wrapper.get<HTMLInputElement>('[name="title"]');
        const nativeReportValidity = form.element.reportValidity.bind(form.element);
        const reportValidity = vi.spyOn(form.element, 'reportValidity').mockImplementation(function reportDisclosedValidity() {
            expect(disclosure.element.open).toBe(true);
            return nativeReportValidity();
        });
        await title.setValue('');
        disclosure.element.open = false;
        expect(form.element.noValidate).toBe(true);
        expect(title.element.validity.valueMissing).toBe(true);
        await form.trigger('submit');
        await flushPromises();
        expect(reportValidity).toHaveBeenCalledOnce();
        expect(disclosure.element.open).toBe(true);
        expect(request.mock.calls.map(([value]) => (value as Request).method)).toEqual(['GET']);
        expect(wrapper.emitted('saved')).toBeUndefined();
        expect(wrapper.emitted('close')).toBeUndefined();
    });

    it('uses empty/null equivalence during remote comparison without losing a description draft', async () => {
        const baseline: components['schemas']['PackingMetadata'] = {entityType: 'packing', id,
            values: {title: 'Original', description: null}, editableFields: ['title', 'description'],
            currentEventId: null, archived: false, inheritedArchived: false};
        const patches: unknown[] = [];
        const {wrapper, context} = await mounted(MetadataFields, {listId: id}, async request => {
            if (request.method === 'PATCH') patches.push(await request.json());
            return json(baseline);
        });
        await wrapper.get('[name="description"]').setValue('Local note');
        context.queryClient.setQueryData(packingKeys.metadata(session.context, id), {
            data: {...baseline, values: {...baseline.values, description: ''}}, etag: '"remote"',
        });
        await flushPromises();
        expect(wrapper.text()).not.toContain('Review changes');
        expect(wrapper.get<HTMLTextAreaElement>('[name="description"]').element.value).toBe('Local note');
        expect(button(wrapper, 'Save properties').attributes('disabled')).toBeUndefined();
        await wrapper.get('form').trigger('submit');
        await flushPromises();
        expect(patches).toEqual([{description: 'Local note'}]);
    });

    it.each([false, true])('reviews a lost PATCH response without replay, including unchanged authority (saved: %s)', async saved => {
        let title = 'Original';
        let writes = 0;
        const projection = {...settings, editableFields: ['title'] as const};
        const {wrapper, router, context, request} = await mounted(PackingSettings, {listId: id}, async request => {
            if (new URL(request.url).pathname.endsWith('/settings')) return json(projection);
            if (request.method === 'PATCH') {
                writes++;
                if (saved) title = (await request.json()).title;
                throw new TypeError('Response was lost');
            }
            return json({entityType: 'packing', id, values: {title}, editableFields: ['title'],
                currentEventId: null, archived: false, inheritedArchived: false});
        });
        await wrapper.get('[name="title"]').setValue('Local title');
        await wrapper.get('#packing-metadata-form').trigger('submit');
        await flushPromises();
        expect(writes).toBe(1);
        expect(button(wrapper, 'Save properties').attributes('disabled')).toBeDefined();
        expect(button(wrapper, 'Refresh').attributes('disabled')).toBeUndefined();

        // Reverting a field cannot settle an unknown write. One dialog owner protects
        // identity, route and browser departures without repeated discard prompts.
        await wrapper.get('[name="title"]').setValue('Original');
        const confirm = vi.fn(() => false);
        vi.stubGlobal('confirm', confirm);
        expect(context.mayChangeIdentity()).toBe(false);
        expect(confirm).toHaveBeenCalledTimes(1);
        await router.push('/away');
        expect(router.currentRoute.value.path).not.toBe('/away');
        expect(confirm).toHaveBeenCalledTimes(2);
        const departure = new Event('beforeunload', {cancelable: true});
        window.dispatchEvent(departure);
        expect(departure.defaultPrevented).toBe(true);
        await wrapper.get('#packing-metadata-form').trigger('submit');
        expect(writes).toBe(1);

        await button(wrapper, 'Refresh').trigger('click');
        await flushPromises();
        expect(button(wrapper, 'Review changes').attributes('disabled')).toBeUndefined();
        expect(wrapper.text()).toContain('The previous save may already have succeeded.');
        expect(wrapper.text()).not.toContain('This list changed while you were editing.');
        expect(wrapper.text()).not.toContain('Changes are available');
        expect(button(wrapper, 'Save properties').attributes('disabled')).toBeDefined();
        await button(wrapper, 'Review changes').trigger('click');
        await flushPromises();
        expect(writes).toBe(1);
        expect(request.mock.calls.map(([value]) => value as Request).filter(value =>
            value.method === 'GET' && new URL(value.url).pathname.endsWith('/metadata'))).toHaveLength(2);
        expect(wrapper.get<HTMLInputElement>('[name="title"]').element.value).toBe(title);
        expect(context.mayChangeIdentity()).toBe(true);
    });

    it('reviews an unknown metadata write after a current read partially revokes its fields', async () => {
        const original: components['schemas']['PackingMetadata'] = {entityType: 'packing', id,
            values: {title: 'Original title', description: 'Original description'}, editableFields: ['title', 'description'],
            currentEventId: null, archived: false, inheritedArchived: false};
        const reduced: components['schemas']['PackingMetadata'] = {...original,
            values: {description: 'Original description'}, editableFields: ['description']};
        const patches: unknown[] = [];
        const {wrapper, context} = await mounted(MetadataFields, {listId: id}, async request => {
            if (request.method === 'PATCH') {
                const patch = await request.json();
                patches.push(patch);
                if (patches.length === 1) throw new TypeError('Response was lost');
                reduced.values = patch;
            }
            const response = json(patches.length ? reduced : original);
            if (patches.length) response.headers.set('ETag', '"reduced-fields"');
            return response;
        });
        await wrapper.get('[name="title"]').setValue('Local title');
        await wrapper.get('[name="description"]').setValue('Local description');
        await wrapper.get('form').trigger('submit');
        await flushPromises();
        await context.queryClient.invalidateQueries({queryKey: packingKeys.metadata(session.context, id)});
        await flushPromises();
        expect(wrapper.find('[name="title"]').exists()).toBe(false);

        // The current GET supplies reduced authority, rather than reviving the
        // old PATCH projection. Review discards the revoked field and retains only
        // the description draft that this actor can still submit deliberately.
        await button(wrapper, 'Refresh').trigger('click');
        await flushPromises();
        expect(button(wrapper, 'Review changes').attributes('disabled')).toBeUndefined();
        await button(wrapper, 'Review changes').trigger('click');
        await wrapper.get('form').trigger('submit');
        await flushPromises();
        expect(patches).toEqual([{title: 'Local title', description: 'Local description'},
        {description: 'Local description'}]);
        expect(wrapper.text()).not.toContain(context.messages.value.t('state.unknownOutcome'));
    });

    it('blocks overlapping writes until explicit Review', async () => {
        const baseline: components['schemas']['PackingMetadata'] = {entityType: 'packing', id,
            values: {title: 'Original title', description: 'Original description'}, editableFields: ['title', 'description'],
            currentEventId: null, archived: false, inheritedArchived: false};
        const remote = {...baseline, values: {title: 'Remote title',
                description: 'Remote description'}};
        const writes: {token: string | null; body: unknown}[] = [];
        const {wrapper, context} = await mounted(MetadataFields, {listId: id}, async request => {
            if (request.method === 'PATCH') writes.push({token: request.headers.get('If-Match'), body: await request.json()});
            return json(baseline);
        });
        await wrapper.get('[name="description"]').setValue('Local description');
        context.queryClient.setQueryData(packingKeys.metadata(session.context, id),
            {data: remote, etag: '"remote"'});
        await flushPromises();
        expect(button(wrapper, 'Save properties').attributes('disabled')).toBeDefined();
        await wrapper.get('form').trigger('submit');
        expect(writes).toEqual([]);
        {
            expect(button(wrapper, 'Review changes').attributes('disabled')).toBeDefined();
            await wrapper.get('input[name="resolve-description"][value="mine"]').setValue(true);
            expect(button(wrapper, 'Review changes').attributes('disabled')).toBeUndefined();
            expect(button(wrapper, 'Save properties').attributes('disabled')).toBeDefined();
            await wrapper.get('form').trigger('submit');
            expect(writes).toEqual([]);
        }
        await button(wrapper, 'Review changes').trigger('click');
        expect(wrapper.get<HTMLInputElement>('[name="title"]').element.value).toBe('Remote title');
        expect(button(wrapper, 'Save properties').attributes('disabled')).toBeUndefined();
        await wrapper.get('form').trigger('submit');
        await flushPromises();
        expect(writes).toEqual([{token: '"remote"', body: {description: 'Local description'}}]);
    });
    it('keeps sparse input editable when the remote update touches another field', async () => {
        const baseline: components['schemas']['PackingMetadata'] = {entityType: 'packing', id,
            values: {title: 'Original title', description: 'Original description'}, editableFields: ['title', 'description'],
            currentEventId: null, archived: false, inheritedArchived: false};
        const writes: unknown[] = [];
        const {wrapper, context} = await mounted(MetadataFields, {listId: id}, async request => {
            if (request.method === 'PATCH') writes.push(await request.json());
            return json(baseline);
        });
        await wrapper.get('[name="description"]').setValue('Local description');
        context.queryClient.setQueryData(packingKeys.metadata(session.context, id),
            {data: {...baseline, values: {...baseline.values, title: 'Remote title'}}, etag: '"remote"'});
        await flushPromises();
        expect(wrapper.get<HTMLInputElement>('[name="title"]').element.value).toBe('Remote title');
        expect(wrapper.get<HTMLInputElement>('[name="description"]').element.value).toBe('Local description');
        expect(button(wrapper, 'Save properties').attributes('disabled')).toBeUndefined();
        await wrapper.get('form').trigger('submit');
        await flushPromises();
        expect(writes).toEqual([{description: 'Local description'}]);
    });
});

describe('packing overview presentation and navigation', () => {
    const card: components['schemas']['OverviewCard'] = {
        id, type: 'packing', title: 'Equipment', description: 'Shared equipment',
        url: '/packing/' + id, headerUrl: null, headerVersion: null, eventContext: null,
        visibility: 'default', overviewHidden: true, archived: true, inheritedArchived: true,
        capabilities: {archive: true, restore: false, duplicate: true, remove: true}, children: null,
    };

    it('offers both explicit preferences for default placement and keeps archive state separate', async () => {
        const {wrapper, update} = await mounted(OverviewCard, {card,
            interaction: {clientNavigation: true, duplicateUrl: card.url + '/duplicate'}});
        expect(wrapper.text()).toContain('For everyone');
        expect(wrapper.text()).toContain('Only my overview');
        await button(wrapper, 'Show for me').trigger('click');
        expect(wrapper.emitted('visibility')).toEqual([['shown']]);
        expect(button(wrapper, 'Hide for me').exists()).toBe(true);
        expect(wrapper.text()).not.toContain('Use default visibility');
        await update({card: {...card, visibility: 'shown', overviewHidden: false}});
        expect(wrapper.text()).toContain('Archived');
        expect(wrapper.text()).toContain('Shown for me');
        expect(wrapper.findAll('button').some(value => value.text() === 'Show for me')).toBe(false);
        await button(wrapper, 'Use default visibility').trigger('click');
        expect(wrapper.emitted('visibility')).toEqual([['shown'], ['default']]);
    });

    it('translates type badges without changing their wire identity or navigation destination', async () => {
        const {wrapper, context, update} = await mounted(OverviewCard, {card,
            interaction: {clientNavigation: true, duplicateUrl: card.url + '/duplicate'}});
        expect(wrapper.get('.badge.bg-primary').text()).toBe('packing');
        context.locale.value = 'de';
        await nextTick();
        expect(wrapper.get('.badge.bg-primary').text()).toBe('Packliste');
        expect(wrapper.attributes('data-type')).toBe('packing');
        expect(wrapper.get('a.card-body').attributes('href')).toBe(card.url);
        await update({card: {...card, type: 'event', url: '/event/' + id}, interaction: {clientNavigation: false}});
        expect(wrapper.get('.badge.bg-primary').text()).toBe('Veranstaltung');
        expect(wrapper.attributes('data-type')).toBe('event');
        expect(wrapper.get('a.card-body').attributes('href')).toBe('/event/' + id);
        for (const [type, label] of [['survey', 'Umfrage'], ['activity', 'Aktivitätsplan'], ['drivers', 'Fahrerliste']] as const) {
            await update({card: {...card, type, url: `/${type}/${id}`}});
            expect(wrapper.get('.badge.bg-primary').text()).toBe(label);
            expect(wrapper.attributes('data-type')).toBe(type);
            expect(wrapper.get('a.card-body').attributes('href')).toBe(`/${type}/${id}`);
        }
    });

    it('flips the archival menu into available viewport space without losing keyboard focus', async () => {
        const {wrapper} = await mounted(OverviewCard, {card,
            interaction: {clientNavigation: true, duplicateUrl: card.url + '/duplicate'}});
        const trigger = wrapper.get('summary');
        const menu = wrapper.get<HTMLElement>('.dropdown-menu');
        menu.element.style.position = 'absolute'; // The mounted DOM does not load Bootstrap's stylesheet.
        let top = window.innerHeight - 50;
        vi.spyOn(trigger.element, 'getBoundingClientRect').mockImplementation(() => new DOMRect(60, top, 80, 32));
        vi.spyOn(menu.element, 'getBoundingClientRect').mockImplementation(() => new DOMRect(60, top + 32, 288, 200));
        await trigger.trigger('keydown', {key: 'ArrowDown'});
        expect(menu.element.style.bottom).toBe('100%');
        expect(menu.element.style.top).toBe('auto');
        expect(document.activeElement).toBe(button(wrapper, 'Archive for everyone').element);

        top = 30;
        window.dispatchEvent(new Event('resize'));
        await nextTick();
        expect(menu.element.style.top).toBe('100%');
        expect(menu.element.style.bottom).toBe('auto');
        expect(document.activeElement).toBe(button(wrapper, 'Archive for everyone').element);
        await menu.trigger('keydown', {key: 'Escape'});
        expect(wrapper.get<HTMLDetailsElement>('details').element.open).toBe(false);
        expect(document.activeElement).toBe(trigger.element);
    });

    it('retains the complete parent card, child range and independent query state when paging and going back', async () => {
        const parent = {...card, id: otherId, type: 'event' as const, title: 'Camp', description: 'Parent details',
            url: '/event/' + otherId, visibility: 'hidden' as const, children: {total: 4, matching: 3},
            capabilities: {archive: false, restore: false, duplicate: false, remove: false}};
        const region: components['schemas']['OverviewRegion'] = {
            collection: 'owner', region: 'main', q: 'equipment', type: 'all', availableTypes: ['packing', 'event'],
            page: 1, childPage: 2, eventId: otherId,
            pageSize: 2, totalEntities: 8, hiddenEntities: 2, regionEntities: 6, matchingEntities: 3,
            totalCards: 1, totalChildren: 3, hasPrevious: true, hasNext: false, parent, items: [card],
        };
        const {wrapper, router, request} = await mounted(OverviewRegion, {collection: 'owner', region: 'main'},
            async request => {
                const query = new URL(request.url).searchParams;
                const eventId = query.get('eventId');
                const childPage = Number(query.get('childPage') ?? 1);
                return json({...region, q: query.get('q') ?? '', childPage, eventId,
                    parent: eventId ? parent : null, totalChildren: eventId ? 3 : 0,
                    hasPrevious: childPage > 1});
            }, '/users/dashboard?owner_main_q=equipment&owner_main_event=' + otherId + '&owner_main_childPage=2&participant_main_q=other');
        expect(wrapper.get('.entity-overview-children').text()).toContain('Linked entities 3–3 of 3');
        expect(wrapper.get('.entity-overview-children').text()).toContain('Administrable entities · 3 linked entities');
        expect(wrapper.text()).toContain('Parent details');
        expect(wrapper.get(`article[data-id="${otherId}"]`).text()).toContain('Hidden for me');
        expect(wrapper.find(`a[href="/event/${otherId}"]`).exists()).toBe(true);
        await button(wrapper, 'Previous').trigger('click');
        await flushPromises();
        // Native canonical navigation omits the first page rather than persisting "1".
        expect(router.currentRoute.value.query.owner_main_childPage).toBeUndefined();
        expect(router.currentRoute.value.query.participant_main_q).toBe('other');
        expect(new URL((request.mock.calls.at(-1)![0] as Request).url).searchParams.get('childPage')).toBe('1');
        await button(wrapper, 'Back to overview').trigger('click');
        await flushPromises();
        expect(router.currentRoute.value.query.owner_main_event).toBeUndefined();
        expect(router.currentRoute.value.query.owner_main_childPage).toBeUndefined();
        expect(router.currentRoute.value.query.owner_main_q).toBe('equipment');
    });

    it('shows mixed unfiltered membership and filters explicitly without losing another region or event selection', async () => {
        const survey = {...card, id: otherId, type: 'survey' as const, title: 'Trip dates', url: '/survey/' + otherId,
            capabilities: {archive: false, restore: false, duplicate: false, remove: false}};
        const event = {...survey, id, type: 'event' as const, title: 'Trip', url: '/event/' + id,
            children: {total: 2, matching: 2}};
        const region: components['schemas']['OverviewRegion'] = {
            collection: 'owner', region: 'main', q: '', type: 'all', availableTypes: ['event', 'survey', 'activity'],
            page: 1, childPage: 1, eventId: null, pageSize: 24, totalEntities: 4, hiddenEntities: 0,
            regionEntities: 4, matchingEntities: 4, totalCards: 2, totalChildren: 0,
            hasPrevious: false, hasNext: false, parent: null, items: [event, survey],
        };
        const {wrapper, router, request} = await mounted(OverviewRegion, {collection: 'owner', region: 'main'}, async request => {
            if (request.method === 'PUT') return json({visibility: 'hidden', overviewHidden: true, archived: true});
            const query = new URL(request.url).searchParams;
            const type = query.get('type') ?? 'all';
            const q = query.get('q') ?? '';
            if (type === 'survey') return json({...region, q, type, matchingEntities: 1, totalCards: 1, items: [survey]});
            return json({...region, q});
        }, '/users/dashboard?participant_main_q=other');
        const initial = new URL((request.mock.calls[0]![0] as Request).url);
        expect(initial.searchParams.has('type')).toBe(false);
        expect(wrapper.findAll('article[data-type]').map(item => item.attributes('data-type'))).toEqual(['event', 'survey']);
        expect(wrapper.text()).toContain('4 matching entities');
        expect(wrapper.text()).not.toContain('No entities match');
        expect(button(wrapper, 'Show linked entities (2)').exists()).toBe(true);

        await router.push({path: '/users/dashboard', query: {...router.currentRoute.value.query,
                owner_main_page: '2', owner_main_childPage: '3'}});
        await flushPromises();
        await wrapper.get('input[type="search"]').setValue('equipment');
        await wrapper.get('form summary').trigger('keydown', {key: 'ArrowDown'});
        await wrapper.get('form button[data-type="survey"]').trigger('click');
        await flushPromises();
        expect(router.currentRoute.value.query).toEqual({participant_main_q: 'other', owner_main_q: 'equipment', owner_main_type: 'survey'});
        expect(new URL((request.mock.calls.at(-1)![0] as Request).url).searchParams.get('type')).toBe('survey');
        expect(new URL((request.mock.calls.at(-1)![0] as Request).url).searchParams.get('q')).toBe('equipment');
        expect(wrapper.findAll('article[data-type]').map(item => item.attributes('data-type'))).toEqual(['survey']);
        expect(wrapper.text()).toContain('1 matching entities');
        // Native overview reset is the existing search field plus All types choice;
        // migration must not add a separate general Clear filters control.
        await wrapper.get('input[type="search"]').setValue('');
        await wrapper.get('form button[data-type="all"]').trigger('click');
        await flushPromises();
        expect(router.currentRoute.value.query).toEqual({participant_main_q: 'other'});
        expect(wrapper.findAll('article[data-type]')).toHaveLength(2);

        // Personal placement uses the card's real entity type rather than treating every
        // non-packing card as an event. The API remains the only replaced boundary.
        const hideSurvey = wrapper.get('article[data-type="survey"]').findAll('button').find(value => value.text() === 'Hide for me');
        expect(hideSurvey).toBeDefined();
        await hideSurvey!.trigger('click');
        await flushPromises();
        expect(request.mock.calls.map(call => call[0] as Request).some(value =>
            value.method === 'PUT' && new URL(value.url).pathname.includes(`/overview/survey/${otherId}/visibility`))).toBe(true);
    });

    it('distinguishes empty membership, privately hidden membership and actual filter results', async () => {
        const region: components['schemas']['OverviewRegion'] = {
            collection: 'owner', region: 'main', q: '', type: 'all', availableTypes: [],
            page: 1, childPage: 1, eventId: null, pageSize: 24, totalEntities: 0, hiddenEntities: 0,
            regionEntities: 0, matchingEntities: 0, totalCards: 0, totalChildren: 0,
            hasPrevious: false, hasNext: false, parent: null, items: [],
        };
        const {wrapper, context} = await mounted(OverviewRegion, {collection: 'owner', region: 'main'}, async () => json(region), '/users/dashboard');
        expect(wrapper.text()).toContain("You don't have any administrable entities yet");
        const key = overviewKeys.region(session.context, 'en', {collection: 'owner', region: 'main'});
        context.queryClient.setQueryData(key, {...region, totalEntities: 2, hiddenEntities: 2});
        await nextTick();
        expect(wrapper.text()).toContain('All your entities in this collection are in Archived and hidden below.');
        context.queryClient.setQueryData(key, {...region, q: 'missing'});
        await nextTick();
        expect(wrapper.text()).toContain('No entities match your search and filter.');
    });

    it('retains a saved type filter when its last visible member disappears', async () => {
        const region: components['schemas']['OverviewRegion'] = {
            collection: 'owner', region: 'main', q: '', type: 'survey', availableTypes: [],
            page: 1, childPage: 1, eventId: null, pageSize: 24, totalEntities: 1, hiddenEntities: 1,
            regionEntities: 0, matchingEntities: 0, totalCards: 0, totalChildren: 0,
            hasPrevious: false, hasNext: false, parent: null, items: [],
        };
        const {wrapper, router} = await mounted(OverviewRegion, {collection: 'owner', region: 'main'}, async request =>
            json({...region, type: new URL(request.url).searchParams.get('type') ?? 'all'}),
            '/users/dashboard?owner_main_type=survey&participant_main_q=other');
        expect(wrapper.get('form button[data-type="survey"]').attributes('aria-pressed')).toBe('true');
        expect(wrapper.text()).toContain('No entities match your search and filter.');
        await wrapper.get('form button[data-type="all"]').trigger('click');
        await flushPromises();
        expect(router.currentRoute.value.query).toEqual({participant_main_q: 'other'});
        expect(wrapper.text()).toContain('All your entities in this collection are in Archived and hidden below.');
    });
});

describe('packing command forms', () => {
    it.each([
        {control: '#quick-title', value: 'x'.repeat(256), message: 'Title: Use no more than 255 characters.'},
        {control: '#quick-description', value: 'x'.repeat(65536), message: 'Description: Use no more than 65535 characters.'},
        {control: '#quick-max', value: '2147483648', message: 'Max #: Enter a number no greater than 2147483647.'},
    ])('explains rejected quick-add input in $control and retains its draft', async ({control, value, message}) => {
        const {wrapper, request} = await mounted(PackingPage);
        await wrapper.get('#quick-title').setValue('Extra lantern');
        await wrapper.get(control).setValue(value);
        const retained = wrapper.get<HTMLInputElement>(control).element;
        await wrapper.get('form').trigger('submit');
        await flushPromises();
        const feedback = wrapper.get('.alert-danger');
        expect(feedback.text()).toBe(message);
        expect(feedback.classes()).toContain('frontend-notification');
        expect(wrapper.get<HTMLInputElement>(control).element).toBe(retained);
        expect(retained.value).toBe(value);
        expect(request.mock.calls.every(([request]) => (request as Request).method === 'GET')).toBe(true);
    });

    it('retains overlapping audience input, adopts untouched masks and saves only the deliberately reviewed audience', async () => {
        let projection: components['schemas']['ListSettings'] = {...settings,
            capabilities: {...settings.capabilities, managePermissions: true},
            access: {defaults, admins: [], permissions: [{key: 'EDIT_TITLE', bit: 1}, {key: 'EDIT_DESCRIPTION', bit: 2}], presets: []}};
        const writes: {patch: components['schemas']['PermissionDefaultsPatch']; token: string | null}[] = [];

        const {wrapper, context} = await mounted(PackingSettings, {listId: id}, async function updateAudiences(request) {
            if (request.method === 'GET') return json(projection);
            const patch = await request.json() as components['schemas']['PermissionDefaultsPatch'];
            writes.push({patch, token: request.headers.get('If-Match')});
            projection = {...projection, settingsToken: '"edit-saved"',
                access: {...projection.access!, defaults: {...projection.access!.defaults, ...patch}}};
            return json({changed: true});
        });
        await wrapper.get('#settings-defaults-participant-EDIT_TITLE').setValue(true);

        // A disjoint change adopts its token immediately, without altering local input.
        projection = {...projection, settingsToken: '"edit-disjoint"',
            access: {...projection.access!, defaults: {...defaults, guest: 2}}};
        await context.queryClient.refetchQueries({queryKey: packingKeys.settings(session.context, id), exact: true});
        await flushPromises();
        expect(wrapper.get<HTMLInputElement>('#settings-defaults-participant-EDIT_TITLE').element.checked).toBe(true);
        expect(button(wrapper, 'Update permissions').attributes('disabled')).toBeUndefined();

        // Overlap retains the user's mask, while another audience still follows the read.
        projection = {...projection, settingsToken: '"edit-overlap"',
            access: {...projection.access!, defaults: {...defaults, participant: 2, guest: 1}}};
        await context.queryClient.refetchQueries({queryKey: packingKeys.settings(session.context, id), exact: true});
        await flushPromises();
        expect(button(wrapper, 'Update permissions').attributes('disabled')).toBeDefined();
        expect(wrapper.get<HTMLInputElement>('#settings-defaults-participant-EDIT_TITLE').element.checked).toBe(true);
        expect(wrapper.get<HTMLInputElement>('#settings-defaults-participant-EDIT_DESCRIPTION').element.checked).toBe(false);

        // Editing back to the original mask is a pristine no-op. Typing the remote
        // mask instead still needs its reviewed token; input alone grants no authority.
        await wrapper.get('#settings-defaults-participant-EDIT_TITLE').setValue(false);
        expect(button(wrapper, 'Update permissions').attributes('disabled')).toBeUndefined();
        await wrapper.get('#settings-defaults-participant-EDIT_DESCRIPTION').setValue(true);
        expect(button(wrapper, 'Update permissions').attributes('disabled')).toBeDefined();
        await wrapper.get('#settings-defaults-participant-EDIT_TITLE').setValue(true);
        await wrapper.get('#settings-defaults-participant-EDIT_DESCRIPTION').setValue(false);
        await wrapper.get('#settings-defaults-audience').setValue('guest');
        expect(wrapper.get<HTMLInputElement>('#settings-defaults-guest-EDIT_TITLE').element.checked).toBe(true);
        expect(wrapper.get<HTMLInputElement>('#settings-defaults-guest-EDIT_DESCRIPTION').element.checked).toBe(false);

        await button(wrapper, context.messages.value.t('draft.review')).trigger('click');
        await wrapper.get('#frontend-access-defaults').trigger('submit');
        await flushPromises();
        expect(writes).toEqual([{patch: {participant: 1}, token: '"edit-overlap"'}]);
        expect(wrapper.get<HTMLInputElement>('#settings-defaults-guest-EDIT_TITLE').element.checked).toBe(true);
        expect(button(wrapper, 'Update permissions').attributes('disabled')).toBeUndefined();
    });

    it.each(['image', 'administrator-add'] as const)('shows %s missing-selection feedback in the common dialog host without moving focus or writing', async section => {
        vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(visibleFeedbackRects);
        const projection: components['schemas']['ListSettings'] = {...settings,
            capabilities: {...settings.capabilities, editHeader: true, managePermissions: true},
            access: {defaults, admins: [], permissions: [], presets: []}};
        const {wrapper, request} = await mounted(PackingSettings, {listId: id}, async () => json(projection));
        if (section === 'administrator-add') {
            await wrapper.get('#frontend-settings-tab-access').trigger('click');
            await wrapper.get('#frontend-access-admins-tab').trigger('click');
            await button(wrapper, 'Add').trigger('click');
            const form = wrapper.get('[data-entity-section="administrator-add"]');
            expect(button(form, 'Add').attributes('disabled')).toBeUndefined();
            await form.trigger('submit');
        } else {
            expect(button(wrapper, 'Upload').attributes('disabled')).toBeUndefined();
            await button(wrapper, 'Upload').trigger('click');
        }
        await flushPromises();
        const feedback = wrapper.get('[data-frontend-notices]');
        expect(feedback.get('.alert-danger').text()).toBe(section === 'image' ? 'Choose an image to upload.' : 'Please select a user');
        expect(feedback.get('.btn-close').attributes('aria-label')).toBe('Dismiss notification');
        expect(feedback.element.contains(document.activeElement)).toBe(false);
        expect(request.mock.calls.every(([request]) => (request as Request).method === 'GET')).toBe(true);
    });

    it('explains an unchanged event before confirmation and preserves other dirty fields without a write', async () => {
        vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(visibleFeedbackRects);
        const confirm = vi.fn(() => false);
        vi.stubGlobal('confirm', confirm);
        const projection: components['schemas']['ListSettings'] = {...settings, editableFields: ['title'],
            capabilities: {...settings.capabilities, linkEvent: true}};
        const metadata: components['schemas']['PackingMetadata'] = {entityType: 'packing', id,
            values: {title: 'Original'}, editableFields: ['title'], currentEventId: null, archived: false, inheritedArchived: false};
        const {wrapper, request} = await mounted(PackingSettings, {listId: id}, async function readNoop(request) {
            const path = new URL(request.url).pathname;
            return json(path.endsWith('/settings') ? projection : path.endsWith('/events')
                ? {items: [], selected: null, nextCursor: null} : metadata);
        });
        await wrapper.get('[name="title"]').setValue('Retained properties draft');
        await wrapper.get('#frontend-settings-tab-event').trigger('click');
        await wrapper.get('#frontend-settings-event form').trigger('submit');
        await flushPromises();
        const feedback = wrapper.get('[data-frontend-notices]');
        expect(feedback.get('.alert-info').text()).toBe('The linked event is unchanged.');
        expect(feedback.element.contains(document.activeElement)).toBe(false);
        expect(wrapper.get<HTMLInputElement>('[name="title"]').element.value).toBe('Retained properties draft');
        expect(confirm).not.toHaveBeenCalled();
        expect(request.mock.calls.every(([request]) => (request as Request).method === 'GET')).toBe(true);
    });

    it('keeps confirmed Remove Admin feedback visible in the same dialog after its authoritative read removes the initiating row', async () => {
        vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(visibleFeedbackRects);
        vi.stubGlobal('confirm', () => true);
        let removed = false;
        const projection: components['schemas']['ListSettings'] = {...settings,
            capabilities: {...settings.capabilities, managePermissions: true},
            access: {defaults, admins: [{profileId: otherId, name: 'Delegate', isGuest: false,
                    mask: 0, editToken: '"edit-remove-admin-original"'}], permissions: [], presets: []}};
        const {wrapper, request} = await mounted(PackingSettings, {listId: id}, async function removeGrant(request) {
            if (request.method === 'DELETE') { removed = true; return json({changed: true}); }
            return json(removed ? {...projection, access: {...projection.access!, admins: []}} : projection);
        });
        await wrapper.get('#frontend-access-admins-tab').trigger('click');
        await wrapper.get('.accordion-button').trigger('click');
        const original = wrapper.get('[data-entity-section="administrator"]').element;
        await button(wrapper, 'Remove').trigger('click');
        await flushPromises();
        expect(original.isConnected).toBe(false);
        expect(wrapper.find('[data-entity-section="administrator"]').exists()).toBe(false);
        const feedback = wrapper.get('[data-frontend-notices]');
        expect(feedback.get('.alert-success').text()).toBe('Admin removed');
        expect(feedback.element.contains(document.activeElement)).toBe(false);
        expect(feedback.get('.btn-close').attributes('disabled')).toBeUndefined();
        await feedback.get('.btn-close').trigger('click');
        expect(feedback.find('.alert').exists()).toBe(false);
        expect(request.mock.calls.filter(([request]) => (request as Request).method === 'DELETE')).toHaveLength(1);
    });

    it.each(['defaults', 'event', 'admin'] as const)('retains confirmed %s values without adopting stale authority after a failed read', async editor => {
        const choice = {id: itemId, title: 'Chosen camp', startDate: '2026-10-07', endDate: '2026-10-08',
            archived: false, description: null, deadlinePassed: false};
        let projection: components['schemas']['ListSettings'] = {...settings,
            capabilities: {...settings.capabilities, managePermissions: true, linkEvent: true},
            access: {defaults, admins: [{profileId: otherId, name: 'Delegate', isGuest: false,
                    mask: 0, editToken: '"edit-admin-original"'}], permissions: [{key: 'EDIT_TITLE', bit: 1}], presets: []}};
        let failRead = false;
        const writes: {body: unknown; token: string | null}[] = [];
        const {wrapper, context} = await mounted(PackingSettings, context => {
            context.queryClient.setDefaultOptions({queries: {retry: false}});
            return {listId: id};
        }, async function settingsRequest(request) {
            const path = new URL(request.url).pathname;
            if (path.endsWith('/events')) return json({items: [choice], selected: null, nextCursor: null});
            if (request.method === 'GET') {
                if (failRead) throw new TypeError('Read unavailable');
                return json(projection);
            }
            const body = await request.json();
            writes.push({body, token: request.headers.get('If-Match')});
            if (editor === 'defaults') projection = {...projection, access: {...projection.access!,
                    defaults: {...defaults, participant: 1}}};
            else if (editor === 'event') projection = {...projection,
                currentEvent: {id: itemId, title: choice.title, startDate: null, endDate: null, url: null}};
            else projection = {...projection, access: {...projection.access!, admins: [{profileId: otherId,
                        name: 'Delegate', isGuest: false, mask: 1, editToken: '"edit-admin-current"'}]}};
            projection = {...projection, settingsToken: '"edit-current"'};
            failRead = true;
            return json(editor === 'event' ? {changed: true, canView: true} : {changed: true});
        });
        const confirm = vi.fn(() => true);
        vi.stubGlobal('confirm', confirm);
        if (editor === 'event') {
            await wrapper.get('#frontend-settings-tab-event').trigger('click');
            await wrapper.get('[data-event-id="' + itemId + '"]').trigger('click');
            await wrapper.get('#frontend-settings-event form').trigger('submit');
        } else {
            await wrapper.get('#frontend-settings-tab-access').trigger('click');
            if (editor === 'defaults') {
                await wrapper.get('#settings-defaults-participant-EDIT_TITLE').setValue(true);
                await wrapper.get('#frontend-access-defaults').trigger('submit');
            } else {
                await wrapper.get('#frontend-access-admins-tab').trigger('click');
                await wrapper.get('.accordion-button').trigger('click');
                await wrapper.get('#admin-' + otherId + '-EDIT_TITLE').setValue(true);
                await button(wrapper, 'Save').trigger('click');
            }
        }
        await flushPromises();
        expect(writes).toHaveLength(1);
        expect(wrapper.text()).toContain(context.messages.value.t('state.savedRefreshFailed'));
        if (editor === 'event') expect(wrapper.get('[data-event-id="' + itemId + '"]').attributes('aria-pressed')).toBe('true');
        else expect(wrapper.get<HTMLInputElement>(editor === 'defaults'
            ? '#settings-defaults-participant-EDIT_TITLE' : '#admin-' + otherId + '-EDIT_TITLE').element.checked).toBe(true);
        confirm.mockClear();
        expect(context.mayChangeIdentity()).toBe(true);
        expect(confirm).not.toHaveBeenCalled();
        expect(button(wrapper, 'Close').attributes('disabled')).toBeUndefined();
        expect(button(wrapper, editor === 'event' ? 'Save event link' : editor === 'defaults'
            ? 'Update permissions' : 'Save').attributes('disabled')).toBeDefined();

        failRead = false;
        await button(wrapper, 'Refresh').trigger('click');
        await flushPromises();
        expect(writes).toHaveLength(1);
        expect(button(wrapper, editor === 'event' ? 'Save event link' : editor === 'defaults'
            ? 'Update permissions' : 'Save').attributes('disabled')).toBeUndefined();
        if (editor === 'defaults') {
            await wrapper.get('#settings-defaults-participant-EDIT_TITLE').setValue(false);
            await wrapper.get('#frontend-access-defaults').trigger('submit');
        } else if (editor === 'admin') {
            await wrapper.get('#admin-' + otherId + '-EDIT_TITLE').setValue(false);
            await button(wrapper, 'Save').trigger('click');
        } else {
            // The accepted event is now pristine. Native Save explains that no-op;
            // only a newly selected value is another conditional write.
            wrapper.findComponent(EventPicker).vm.$emit('update:modelValue', null);
            await nextTick();
            await wrapper.get('#frontend-settings-event form').trigger('submit');
        }
        await flushPromises();
        expect(writes[1]?.token).toBe(editor === 'admin' ? '"edit-admin-current"' : '"edit-current"');
    });

    it('recovers an unknown audience save from an identical-token read without replaying or clearing its input', async () => {
        let loseResponse = true;
        let projection: components['schemas']['ListSettings'] = {...settings,
            capabilities: {...settings.capabilities, managePermissions: true},
            access: {defaults, admins: [], permissions: [{key: 'EDIT_TITLE', bit: 1}], presets: []}};
        const writes: {patch: components['schemas']['PermissionDefaultsPatch']; token: string | null}[] = [];
        const {wrapper} = await mounted(PackingSettings, {listId: id}, async function saveAudiences(request) {
            if (request.method === 'GET') return json(projection);
            const patch = await request.json() as components['schemas']['PermissionDefaultsPatch'];
            writes.push({patch, token: request.headers.get('If-Match')});
            if (loseResponse) throw new TypeError('Command response lost');
            projection = {...projection, settingsToken: '"edit-confirmed"',
                access: {...projection.access!, defaults: {...projection.access!.defaults, ...patch}}};
            return json({changed: true});
        });

        await wrapper.get('#settings-defaults-participant-EDIT_TITLE').setValue(true);
        await wrapper.get('#frontend-access-defaults').trigger('submit');
        await flushPromises();
        expect(button(wrapper, 'Update permissions').attributes('disabled')).toBeDefined();

        // The read returns the original token and values. It provides current
        // authority, without proving whether the previous command ever committed.
        await button(wrapper, 'Refresh').trigger('click');
        await flushPromises();
        expect(writes).toHaveLength(1);
        expect(wrapper.get<HTMLInputElement>('#settings-defaults-participant-EDIT_TITLE').element.checked).toBe(true);
        expect(button(wrapper, 'Update permissions').attributes('disabled')).toBeUndefined();

        loseResponse = false;
        await wrapper.get('#frontend-access-defaults').trigger('submit');
        await flushPromises();
        expect(writes).toEqual([
            {patch: {participant: 1}, token: settings.settingsToken},
            {patch: {participant: 1}, token: settings.settingsToken},
        ]);
        expect(wrapper.get<HTMLInputElement>('#settings-defaults-participant-EDIT_TITLE').element.checked).toBe(true);
    });

    it('offers acknowledged Settings departure when a response and reconciliation are unavailable, without replay', async () => {
        let failRead = false;
        let writes = 0;
        const projection = {...settings, capabilities: {...settings.capabilities, managePermissions: true},
            access: {defaults, admins: [], permissions: [{key: 'EDIT_TITLE', bit: 1}], presets: []}};
        const {wrapper, context, router} = await mounted(PackingSettings, context => {
            context.queryClient.setDefaultOptions({queries: {retry: false}});
            return {listId: id};
        }, async function settingsRequest(request) {
            if (request.method !== 'GET') {
                writes++;
                failRead = true;
                throw new TypeError('Command response lost');
            }
            if (failRead) throw new TypeError('Reconciliation unavailable');
            return json(projection);
        });
        await wrapper.get('#settings-defaults-participant-EDIT_TITLE').setValue(true);
        await wrapper.get('#frontend-access-defaults').trigger('submit');
        await flushPromises();
        await button(wrapper, 'Refresh').trigger('click');
        await flushPromises();
        expect(button(wrapper, 'Close').attributes('disabled')).toBeUndefined();
        const confirm = vi.fn(() => false);
        vi.stubGlobal('confirm', confirm);
        await button(wrapper, 'Close').trigger('click');
        expect(wrapper.emitted('close')).toBeUndefined();
        expect(confirm).toHaveBeenCalledOnce();
        expect(wrapper.get<HTMLInputElement>('#settings-defaults-participant-EDIT_TITLE').element.checked).toBe(true);
        confirm.mockClear();
        expect(context.mayChangeIdentity()).toBe(false);
        expect(confirm).toHaveBeenCalledOnce();
        confirm.mockClear();
        await router.push('/away');
        expect(router.currentRoute.value.path).not.toBe('/away');
        expect(confirm).toHaveBeenCalledOnce();
        context.updates.observe({...session.deployment, buildId: 'next-release'});
        await flushPromises();
        expect(context.updates.requestReload()).toBe(false);
        // Deliberate recovery also preserves this unresolved settings draft.
        expect(context.updates.requestRecoveryReload()).toBe(false);
        confirm.mockReturnValue(true);
        confirm.mockClear();
        await router.push('/away');
        expect(router.currentRoute.value.path).toBe('/away');
        expect(confirm).toHaveBeenCalledOnce();
        expect(writes).toBe(1);
        expect(context.mayChangeIdentity()).toBe(true);
    });

    it('asks once for a quick-add draft and an open Settings draft and retains both on cancellation', async () => {
        const projection = {...settings, capabilities: {...settings.capabilities, managePermissions: true},
            access: {defaults, admins: [], permissions: [{key: 'EDIT_TITLE', bit: 1}], presets: []}};
        const {wrapper, router, context} = await mounted(PackingPage, {}, async request =>
            json(new URL(request.url).pathname.endsWith('/settings') ? projection
                : {...list, capabilities: {...list.capabilities, manageSettings: true}}));
        await wrapper.get('#quick-title').setValue('Retained stove');
        await button(wrapper, 'Entity settings').trigger('click');
        await flushPromises();
        await wrapper.get('#settings-defaults-participant-EDIT_TITLE').setValue(true);
        const confirm = vi.fn(() => false);
        vi.stubGlobal('confirm', confirm);
        await router.push('/away');
        expect(router.currentRoute.value.path).not.toBe('/away');
        expect(confirm).toHaveBeenCalledOnce();
        expect(wrapper.get<HTMLInputElement>('#quick-title').element.value).toBe('Retained stove');
        expect(wrapper.get<HTMLInputElement>('#settings-defaults-participant-EDIT_TITLE').element.checked).toBe(true);
        confirm.mockClear();
        expect(context.mayChangeIdentity()).toBe(false);
        expect(confirm).toHaveBeenCalledOnce();
        confirm.mockReturnValue(true);
        confirm.mockClear();
        await button(wrapper, 'Close').trigger('click');
        expect(confirm).toHaveBeenCalledOnce();
        expect(wrapper.findComponent(PackingSettings).exists()).toBe(false);
        expect(wrapper.get<HTMLInputElement>('#quick-title').element.value).toBe('Retained stove');
    });

    it.each([false, true])('decides every page/dialog draft before deletion and never asks after its write (approve: %s)', async approve => {
        const projection = {...settings, capabilities: {...settings.capabilities, managePermissions: true, remove: true},
            access: {defaults, admins: [], permissions: [{key: 'EDIT_TITLE', bit: 1}], presets: []}};
        let deletes = 0;
        const {wrapper, router} = await mounted(PackingPage, {}, async request => {
            if (request.method === 'DELETE') {
                deletes++;
                return json({changed: true});
            }
            return json(new URL(request.url).pathname.endsWith('/settings') ? projection
                : {...list, capabilities: {...list.capabilities, manageSettings: true}});
        });
        // The committed destination is a different feature, as in the real route table.
        router.addRoute({name: 'packing-test-overview', path: '/users/dashboard',
            component: defineComponent({template: '<p>Overview destination</p>'})});
        await wrapper.get('#quick-title').setValue('Parent draft');
        await button(wrapper, 'Entity settings').trigger('click');
        await flushPromises();
        await wrapper.get('#settings-defaults-participant-EDIT_TITLE').setValue(true);
        await wrapper.get('#frontend-settings-tab-actions').trigger('click');

        // A prompt after DELETE would be too late. Make such a prompt fail so the
        // accepted case proves that the whole root decision happens before the write.
        const confirm = vi.fn((_message: string) => deletes === 0 && approve);
        vi.stubGlobal('confirm', confirm);
        await button(wrapper, 'Delete permanently').trigger('click');
        await flushPromises();
        expect(deletes).toBe(approve ? 1 : 0);
        expect(confirm.mock.calls.map(([message]) => message)).toEqual(approve
            ? ['Discard changes?', 'Permanently delete this entity and its contents? This cannot be undone.']
            : ['Discard changes?']);
        if (approve) expect(router.currentRoute.value.path).toBe('/users/dashboard');
        else {
            expect(router.currentRoute.value.path).toBe('/packing/' + id);
            expect(wrapper.get<HTMLInputElement>('#quick-title').element.value).toBe('Parent draft');
            expect(wrapper.get<HTMLInputElement>('#settings-defaults-participant-EDIT_TITLE').element.checked).toBe(true);
        }
    });

    it.each(['rejected', 'unknown'] as const)('keeps Settings and its draft through a pending then %s DELETE', async disposition => {
        const deletion = deferredResponse();
        const projection = {...settings, capabilities: {...settings.capabilities, managePermissions: true, remove: true},
            access: {defaults, admins: [], permissions: [{key: 'EDIT_TITLE', bit: 1}], presets: []}};
        const {wrapper, context, request} = await mounted(PackingPage, {}, async captured => {
            if (captured.method === 'DELETE') return deletion.response;
            return json(new URL(captured.url).pathname.endsWith('/settings') ? projection
                : {...list, capabilities: {...list.capabilities, manageSettings: true}});
        });
        vi.stubGlobal('confirm', vi.fn(() => true));
        await button(wrapper, 'Entity settings').trigger('click');
        await flushPromises();
        const checkbox = wrapper.get<HTMLInputElement>('#settings-defaults-participant-EDIT_TITLE');
        await checkbox.setValue(true);
        await wrapper.get('#frontend-settings-tab-actions').trigger('click');
        try {
            await button(wrapper, 'Delete permanently').trigger('click');
            await flushPromises();
            expect(wrapper.findComponent(PackingSettings).exists()).toBe(true);
            expect(button(wrapper, 'Close').attributes('disabled')).toBeDefined();
            deletion.resolve(disposition === 'rejected' ? problem('FORBIDDEN', 403)
                : new Response('Temporary proxy failure', {status: 503}));
            await flushPromises();
            expect(wrapper.findComponent(PackingSettings).exists()).toBe(true);
            expect(wrapper.get<HTMLInputElement>('#settings-defaults-participant-EDIT_TITLE').element).toBe(checkbox.element);
            expect(checkbox.element.checked).toBe(true);
            expect(request.mock.calls.filter(([captured]) => (captured as Request).method === 'DELETE')).toHaveLength(1);
            expect(document.body.textContent).toContain(context.messages.value.t(disposition === 'unknown'
                ? 'state.unknownOutcome' : 'api:errors.FORBIDDEN'));
        } finally {
            deletion.resolve(json({changed: false}));
            await flushPromises();
        }
    });

    it('rechecks retained drafts on confirmed deletion Retry without another DELETE', async () => {
        const projection = {...settings, capabilities: {...settings.capabilities, managePermissions: true, remove: true},
            access: {defaults, admins: [], permissions: [{key: 'EDIT_TITLE', bit: 1}], presets: []}};
        let deletes = 0;
        const {wrapper, root, router, context, request} = await mounted(PackingPage, {}, async request => {
            if (request.method === 'DELETE') {
                deletes++;
                return json({changed: true});
            }
            return json(new URL(request.url).pathname.endsWith('/settings') ? projection
                : {...list, capabilities: {...list.capabilities, manageSettings: true}});
        }, '/packing/' + id, session, {}, true);
        // Detail/Settings deletion must retire every warm Overview variant too,
        // without fetching that inactive destination or the just-deleted detail.
        const warmDefault = overviewKeys.region(session.context, 'en', {collection: 'owner', region: 'main'});
        const warmFiltered = overviewKeys.region(session.context, 'de', {collection: 'participant', region: 'hidden', q: 'equipment'});
        context.queryClient.setQueryData(warmDefault, {retained: 'Default Overview snapshot'});
        context.queryClient.setQueryData(warmFiltered, {retained: 'Filtered Overview snapshot'});
        let failNavigation = true;
        router.addRoute({name: 'packing-test-overview', path: '/users/dashboard', component: async function loadOverview() {
                if (failNavigation) throw new TypeError('Failed to fetch dynamically imported module');
                return defineComponent({template: '<p>Overview destination</p>'});
            }});
        router.onError(() => {});
        await wrapper.get('#quick-title').setValue('Parent draft');
        const parentDraft = wrapper.get<HTMLInputElement>('#quick-title').element;
        await button(wrapper, 'Entity settings').trigger('click');
        await flushPromises();
        await wrapper.get('#settings-defaults-participant-EDIT_TITLE').setValue(true);
        await wrapper.get('#frontend-settings-tab-actions').trigger('click');
        let approveRetryDeparture = false;
        const confirm = vi.fn(() => deletes === 0 || approveRetryDeparture);
        vi.stubGlobal('confirm', confirm);
        await button(wrapper, 'Delete permanently').trigger('click');
        await flushPromises();
        expect(deletes).toBe(1);
        expect(confirm).toHaveBeenCalledTimes(2);
        expect(router.currentRoute.value.path).toBe('/packing/' + id);
        // Confirmed deletion releases only its obsolete Settings editor. The
        // unrelated parent draft remains mounted, and common recovery is usable
        // without a modal covering the one failure message at the top.
        expect(wrapper.findComponent(PackingSettings).exists()).toBe(false);
        expect(wrapper.find('#settings-defaults-participant-EDIT_TITLE').exists()).toBe(false);
        expect(root.get('[data-frontend-notices] .alert-warning').text()).toContain(context.messages.value.t('state.deliveryFailed'));
        expect(context.queryClient.getQueryState(warmDefault)?.isInvalidated).toBe(true);
        expect(context.queryClient.getQueryState(warmFiltered)?.isInvalidated).toBe(true);
        expect(request.mock.calls.filter(([input]) => new URL((input as Request).url).pathname === '/api/v1/overview')).toHaveLength(0);

        failNavigation = false;
        const retry = button(root.get('[data-frontend-notices] .alert-warning'), 'Try again');
        await retry.trigger('click');
        await flushPromises();
        // The first delivery attempt released its discard approval. Canceling
        // the later departure preserves the same draft and confirmed receipt.
        expect(router.currentRoute.value.path).toBe('/packing/' + id);
        expect(wrapper.get('#quick-title').element).toBe(parentDraft);
        expect(parentDraft.value).toBe('Parent draft');
        expect(wrapper.findComponent(PackingSettings).exists()).toBe(false);
        const renewedRetry = button(root.get('[data-frontend-notices] .alert-warning'), 'Try again');
        expect(renewedRetry.attributes('disabled')).toBeUndefined();
        expect(confirm).toHaveBeenCalledTimes(3);
        expect(confirm.mock.calls[2]).toEqual(['Discard changes?']);
        expect(deletes).toBe(1);

        approveRetryDeparture = true;
        await renewedRetry.trigger('click');
        await flushPromises();
        expect(router.currentRoute.value.path).toBe('/users/dashboard');
        expect(deletes).toBe(1);
        expect(confirm).toHaveBeenCalledTimes(4);
        expect(confirm.mock.calls[3]).toEqual(['Discard changes?']);
    });

    it('rechecks the retained parent draft through shell recovery after post-deletion denial closes the editor', async () => {
        const projection = {...settings, capabilities: {...settings.capabilities, managePermissions: true, remove: true},
            access: {defaults, admins: [], permissions: [{key: 'EDIT_TITLE', bit: 1}], presets: []}};
        let deletes = 0;
        const {root, wrapper, router, context} = await mounted(PackingPage, {}, async request => {
            if (request.method === 'DELETE') {
                deletes++;
                return json({changed: true});
            }
            if (deletes) return problem('NOT_FOUND', 404);
            return json(new URL(request.url).pathname.endsWith('/settings') ? projection
                : {...list, capabilities: {...list.capabilities, manageSettings: true}});
        }, '/packing/' + id, session, {}, true);
        let failNavigation = true;
        router.addRoute({name: 'packing-test-overview', path: '/users/dashboard', component: async function loadOverview() {
                if (failNavigation) throw new TypeError('Failed to fetch dynamically imported module');
                return defineComponent({template: '<p>Overview destination</p>'});
            }});
        router.onError(() => {});
        await wrapper.get('#quick-title').setValue('Parent draft');
        await button(wrapper, 'Entity settings').trigger('click');
        await flushPromises();
        await wrapper.get('#settings-defaults-participant-EDIT_TITLE').setValue(true);
        await wrapper.get('#frontend-settings-tab-actions').trigger('click');
        let approveRetryDeparture = false;
        const confirm = vi.fn(() => deletes === 0 || approveRetryDeparture);
        vi.stubGlobal('confirm', confirm);
        await button(wrapper, 'Delete permanently').trigger('click');
        await flushPromises();

        // Settings already closed on confirmation. Read the still-mounted detail
        // owner so its actual denial retires private controls without losing the
        // confirmed destination's read-only Retry.
        await context.queryClient.invalidateQueries({queryKey: packingKeys.detail(session.context, id)});
        await flushPromises();
        expect(wrapper.findComponent(PackingSettings).exists()).toBe(false);
        expect(wrapper.find('#quick-title').exists()).toBe(false);
        expect(wrapper.find('[data-item-id]').exists()).toBe(false);
        expect(deletes).toBe(1);
        expect(confirm).toHaveBeenCalledTimes(2);
        expect(context.updates.requestReload()).toBe(false);
        // A confirmed deletion awaiting delivery cannot be bypassed by recovery.
        expect(context.updates.requestRecoveryReload()).toBe(false);
        const departure = new Event('beforeunload', {cancelable: true});
        window.dispatchEvent(departure);
        expect(departure.defaultPrevented).toBe(true);

        failNavigation = false;
        const retry = button(root, context.messages.value.t('common.retry'));
        await retry.trigger('click');
        await flushPromises();
        expect(router.currentRoute.value.fullPath).toBe('/packing/' + id);
        expect(wrapper.findComponent(PackingSettings).exists()).toBe(false);
        expect(wrapper.find('#quick-title').exists()).toBe(false);
        expect(wrapper.find('[data-item-id]').exists()).toBe(false);
        // Shell recovery is hidden while its existing delivery owner is pending,
        // then reappears with the same confirmed receipt after cancellation.
        const renewedRetry = button(root, context.messages.value.t('common.retry'));
        expect(renewedRetry.attributes('disabled')).toBeUndefined();
        expect(confirm).toHaveBeenCalledTimes(3);
        expect(confirm.mock.calls[2]).toEqual(['Discard changes?']);
        expect(deletes).toBe(1);

        // The denied private DOM stays retired. Explicitly accepting the root's
        // retained draft decision permits only delivery of the confirmed result.
        approveRetryDeparture = true;
        await renewedRetry.trigger('click');
        await flushPromises();
        expect(router.currentRoute.value.fullPath).toBe('/users/dashboard');
        expect(deletes).toBe(1);
        expect(confirm).toHaveBeenCalledTimes(4);
        expect(confirm.mock.calls[3]).toEqual(['Discard changes?']);
    });

    it('retains pending command guards when an earlier denied read closes its editor', async () => {
        let finishDelete!: (response: Response) => void;
        const response = new Promise<Response>(resolve => { finishDelete = resolve; });
        let deleting = false;
        const projection = {...settings, capabilities: {...settings.capabilities, remove: true}};
        const {wrapper, router, context} = await mounted(PackingPage, {}, async request => {
            if (request.method === 'DELETE') {
                deleting = true;
                return response;
            }
            if (deleting) return problem('NOT_FOUND', 404);
            return json(new URL(request.url).pathname.endsWith('/settings') ? projection
                : {...list, capabilities: {...list.capabilities, manageSettings: true}});
        }, '/packing/' + id, session, {}, true);
        vi.stubGlobal('confirm', vi.fn(() => true));
        await button(wrapper, 'Entity settings').trigger('click');
        await flushPromises();
        await wrapper.get('#frontend-settings-tab-actions').trigger('click');
        await button(wrapper, 'Delete permanently').trigger('click');
        await flushPromises();
        await context.queryClient.invalidateQueries({queryKey: packingKeys.editors(session.context, id)});
        await flushPromises();
        try {
            expect(wrapper.findComponent(PackingSettings).exists()).toBe(false);
            expect.soft(context.mayChangeIdentity()).toBe(false);
            const departure = new Event('beforeunload', {cancelable: true});
            window.dispatchEvent(departure);
            expect.soft(departure.defaultPrevented).toBe(true);
            await router.push('/away');
            expect.soft(router.currentRoute.value.fullPath).toBe('/packing/' + id);
        } finally {
            finishDelete(json({changed: true}));
            await flushPromises();
        }
    });

    it.each(['confirmed', 'conflict', 'unknown'] as const)(
        'settles a held metadata PATCH %s after denial without restoring editor authority', async outcome => {
            const held = deferredResponse();
            let writing = false;
            let writes = 0;
            let reads = 0;
            const projection = {...settings, editableFields: ['title'] as const};
            const metadata: components['schemas']['PackingMetadata'] = {entityType: 'packing', id,
                values: {title: 'Original'}, editableFields: ['title'], currentEventId: null,
                archived: false, inheritedArchived: false};
            const {wrapper, router, context} = await mounted(PackingPage, {}, async request => {
                if (request.method === 'PATCH') {
                    writing = true;
                    writes++;
                    return held.response;
                }
                reads++;
                if (writing) return problem('NOT_FOUND', 404);
                const path = new URL(request.url).pathname;
                return json(path.endsWith('/metadata') ? metadata : path.endsWith('/settings') ? projection
                    : {...list, capabilities: {...list.capabilities, manageSettings: true}});
            }, '/packing/' + id, session, {}, true);
            const confirmation = vi.fn(() => true);
            vi.stubGlobal('confirm', confirmation);
            await button(wrapper, 'Entity settings').trigger('click');
            await flushPromises();
            await wrapper.get('[name="title"]').setValue('Submitted metadata');
            await wrapper.get('#packing-metadata-form').trigger('submit');
            await flushPromises();
            await context.queryClient.invalidateQueries({queryKey: packingKeys.editors(session.context, id)});
            await flushPromises();
            const deniedReads = reads;
            try {
                expect(wrapper.findComponent(PackingSettings).exists()).toBe(false);
                expect(context.queryClient.getQueriesData({queryKey: packingKeys.editors(session.context, id)})).toEqual([]);
                expect(context.mayChangeIdentity()).toBe(false);
                const departure = new Event('beforeunload', {cancelable: true});
                window.dispatchEvent(departure);
                expect(departure.defaultPrevented).toBe(true);
                await router.push('/away');
                expect(router.currentRoute.value.fullPath).toBe('/packing/' + id);
                expect(confirmation).not.toHaveBeenCalled();
                expect(writes).toBe(1);
            } finally {
                held.resolve(outcome === 'confirmed' ? json({...metadata, values: {title: 'Submitted metadata'}})
                    : outcome === 'conflict' ? problem('PRECONDITION_FAILED', 412) : json({}, 503));
                await flushPromises();
            }
            if (outcome === 'unknown') {
                const departure = new Event('beforeunload', {cancelable: true});
                window.dispatchEvent(departure);
                expect(departure.defaultPrevented).toBe(true);
                expect(context.updates.requestReload()).toBe(false);
                // Retired editor controls do not release the retained unknown write.
                expect(context.updates.requestRecoveryReload()).toBe(false);
                // Lost response remains uncertain after retirement; only a deliberate
                // accepted departure acknowledges its status, never a replacement PATCH.
                await router.push('/away');
                expect(router.currentRoute.value.fullPath).toBe('/away');
                expect(confirmation).toHaveBeenCalledExactlyOnceWith(context.messages.value.t('draft.leaveUnknown'));
            } else expect(context.mayChangeIdentity()).toBe(true);
            // The completed write settles its retained guard, but must not republish
            // editor authority after the denied read has evicted that whole subtree.
            expect(context.queryClient.getQueriesData({queryKey: packingKeys.editors(session.context, id)})).toEqual([]);
            expect(reads).toBe(deniedReads);
        });

    it.each(['confirmed', 'conflict'] as const)(
        'settles a held settings PUT %s without refetching an evicted editor', async outcome => {
            const held = deferredResponse();
            let writing = false;
            let reads = 0;
            let writes = 0;
            const projection = {...settings, capabilities: {...settings.capabilities, managePermissions: true},
                access: {defaults, admins: [], permissions: [{key: 'EDIT_TITLE', bit: 1}], presets: []}};
            const {wrapper, context} = await mounted(PackingPage, {}, async request => {
                if (request.method === 'PUT') {
                    writing = true;
                    writes++;
                    return held.response;
                }
                reads++;
                if (new URL(request.url).pathname.endsWith('/settings')) {
                    return writing ? problem('FORBIDDEN', 403) : json(projection);
                }
                return json({...list, capabilities: {...list.capabilities, manageSettings: !writing}});
            }, '/packing/' + id, session, {}, true);
            await button(wrapper, 'Entity settings').trigger('click');
            await flushPromises();
            await wrapper.get('#settings-defaults-participant-EDIT_TITLE').setValue(true);
            await wrapper.get('#frontend-access-defaults').trigger('submit');
            await flushPromises();
            await context.queryClient.invalidateQueries({queryKey: packingKeys.editors(session.context, id)});
            await flushPromises();
            const deniedReads = reads;
            try {
                expect(wrapper.findComponent(PackingSettings).exists()).toBe(false);
                expect(context.queryClient.getQueriesData({queryKey: packingKeys.editors(session.context, id)})).toEqual([]);
                expect(context.mayChangeIdentity()).toBe(false);
            } finally {
                held.resolve(outcome === 'confirmed' ? json({changed: true}) : problem('PRECONDITION_FAILED', 412));
                await flushPromises();
            }
            expect(context.mayChangeIdentity()).toBe(true);
            expect(context.queryClient.getQueriesData({queryKey: packingKeys.editors(session.context, id)})).toEqual([]);
            expect(reads).toBe(deniedReads);
            expect(writes).toBe(1);
        });

    it.each(['confirmed', 'conflict'] as const)(
        'settles a held item PATCH %s without refetching a denied resource', async outcome => {
            const held = deferredResponse();
            let writing = false;
            let reads = 0;
            let writes = 0;
            const {wrapper, context} = await mounted(PackingPage, {}, async request => {
                if (request.method === 'PATCH') {
                    writing = true;
                    writes++;
                    return held.response;
                }
                reads++;
                return writing ? problem('NOT_FOUND', 404) : json(list);
            }, '/packing/' + id, session, {}, true);
            const cell = wrapper.get('[data-item-id="' + itemId + '"]').findAll('td')[2]!;
            await cell.trigger('dblclick');
            await cell.get('input').setValue('Submitted title');
            await cell.get('input').trigger('keydown', {key: 'Enter'});
            await flushPromises();
            await context.queryClient.invalidateQueries({queryKey: packingKeys.detail(session.context, id)});
            await flushPromises();
            const deniedReads = reads;
            try {
                expect(wrapper.find('[data-item-id]').exists()).toBe(false);
                expect(context.queryClient.getQueriesData({queryKey: packingKeys.resource(session.context, id)})
                    .every(([, value]) => value === undefined)).toBe(true);
                expect(context.mayChangeIdentity()).toBe(false);
            } finally {
                held.resolve(outcome === 'confirmed' ? json({changed: true}) : problem('PRECONDITION_FAILED', 412));
                await flushPromises();
            }
            expect(context.mayChangeIdentity()).toBe(true);
            expect(context.queryClient.getQueriesData({queryKey: packingKeys.resource(session.context, id)})
                .every(([, value]) => value === undefined)).toBe(true);
            expect(reads).toBe(deniedReads);
            expect(writes).toBe(1);
        });

    it.each([false, true])('keeps metadata confirmed and retries the whole dialog after related reads fail (metadata fails: %s)', async failMetadata => {
        let title = 'Original';
        let writes = 0;
        let failSettings = false;
        const projection = {...settings, editableFields: ['title'] as const};
        const {wrapper, router, context} = await mounted(PackingSettings, context => {
            // A failed read is the case under test; retry timing is covered by the shared read-policy tests.
            context.queryClient.setDefaultOptions({queries: {retry: false}});
            return {listId: id};
        }, async request => {
            if (new URL(request.url).pathname.endsWith('/settings')) {
                if (failSettings) throw new TypeError('Read unavailable');
                return json(projection);
            }
            if (request.method === 'PATCH') {
                writes++;
                title = (await request.json()).title;
                failSettings = true;
            } else if (failSettings && failMetadata) throw new TypeError('Metadata read unavailable');
            return json({entityType: 'packing', id, values: {title}, editableFields: ['title'],
                currentEventId: null, archived: false, inheritedArchived: false});
        });
        await wrapper.get('[name="title"]').setValue('Saved title');
        await wrapper.get('#packing-metadata-form').trigger('submit');
        await flushPromises();
        expect(wrapper.text()).toContain('saved');
        expect(wrapper.text()).not.toContain('The result is uncertain');
        expect(button(wrapper, 'Close').attributes('disabled')).toBeUndefined();
        expect(button(wrapper, 'Refresh').attributes('disabled')).toBeUndefined();
        expect(wrapper.get<HTMLInputElement>('[name="title"]').element.value).toBe('Saved title');
        failSettings = false;
        // The footer Refresh coordinates both owners. A failed metadata follow-up
        // additionally exposes its own recovery, so deliberately select the footer.
        const refresh = wrapper.findAll('button').filter(control => control.text() === 'Refresh').at(-1)!;
        await refresh.trigger('click');
        await flushPromises();
        expect(writes).toBe(1);
        expect(wrapper.findComponent(MetadataFields).text()).not.toContain(context.messages.value.t('state.savedRefreshFailed'));
        expect(button(wrapper, 'Save properties').attributes('disabled')).toBeUndefined();
        const confirm = vi.fn(() => false);
        vi.stubGlobal('confirm', confirm);
        await router.push('/away');
        expect(router.currentRoute.value.path).toBe('/away');
        expect(confirm).not.toHaveBeenCalled();
    });

    it('withholds title/capacity editors when only display grants remain', async () => {
        // Stale display flags cannot make a field editable without its current
        // actual write admission; readable row values remain in place.
        const projection = {...list, items: [{...item, capabilities: {...item.capabilities,
                    editTitle: false, editCapacity: false, showTitleEdit: true, showCapacityEdit: true}}]};
        const {wrapper, request} = await mounted(PackingPage, {}, async () => json(projection));
        const cells = wrapper.get(`[data-item-id="${itemId}"]`).findAll('td');
        for (const column of [2, 4]) {
            expect(cells[column]!.attributes('data-edit')).toBeUndefined();
            await cells[column]!.trigger('dblclick');
            await flushPromises();
            expect(cells[column]!.find('input').exists()).toBe(false);
        }
        expect(wrapper.find('.alert-danger').exists()).toBe(false);
        expect(request.mock.calls.every(([input]) => (input as Request).method === 'GET')).toBe(true);
    });

    it('closes revoked settings and retires personal controls when their method grant disappears', async () => {
        let canManage = true;
        let canAssign = true;
        let listReads = 0;
        const deniedAssignments: string[] = [];
        const {wrapper, context} = await mounted(PackingPage, {}, async request => {
            if (request.method === 'PUT' || request.method === 'DELETE') {
                deniedAssignments.push(request.method);
                return problem('FORBIDDEN', 403);
            }
            if (new URL(request.url).pathname.endsWith('/settings')) {
                canManage = false;
                return problem('FORBIDDEN', 403);
            }
            listReads++;
            return json({...list, capabilities: {...list.capabilities, manageSettings: canManage, selfAssign: canAssign},
                items: [item, {...item, id: otherId, title: 'My equipment', selfAssigned: true, assignedCount: 1}]});
        });
        context.queryClient.setQueryData(packingKeys.metadata(session.context, id), {privateDraft: 'old edit grant'});
        await button(wrapper, 'Entity settings').trigger('click');
        await flushPromises();
        expect(wrapper.findComponent(PackingSettings).exists()).toBe(false);
        expect(wrapper.get('h1').text()).toBe('Equipment');
        expect(button(wrapper, 'Take').exists()).toBe(true);
        expect(wrapper.findAll('button').some(control => control.text() === 'Entity settings')).toBe(false);
        expect(listReads).toBeGreaterThan(1);
        expect(context.queryClient.getQueryData(packingKeys.metadata(session.context, id))).toBeUndefined();

        // The shared personal-action owner consumes refreshed method admission
        // for both Take and Remove without hiding the readable assignments.
        canAssign = false;
        await context.queryClient.refetchQueries({queryKey: packingKeys.detail(session.context, id)});
        await flushPromises();
        const confirmedReads = listReads;
        expect(wrapper.findAll('button').filter(control => ['Take', 'Remove'].includes(control.text()))).toHaveLength(0);
        expect(wrapper.text()).toContain('My equipment');
        expect(deniedAssignments).toEqual([]);
        expect(listReads).toBe(confirmedReads);
        expect(context.mayChangeIdentity()).toBe(true);
    });

    it('clears an existing item title as an empty string while clearing its description as null', async () => {
        const sent: unknown[] = [];
        let projection = {...list, items: [{...item, description: 'Bring pegs',
                capabilities: {...item.capabilities, editDescription: true}}]};
        const {wrapper} = await mounted(PackingPage, {}, async request => {
            if (request.method === 'PATCH') {
                const body = await request.json();
                sent.push(body);
                projection = {...projection, items: [{...projection.items[0]!, ...body}]};
                return json({changed: true});
            }
            return json(projection);
        });
        const row = wrapper.get('[data-item-id="' + itemId + '"]');
        for (const column of [2, 3]) {
            const cell = row.findAll('td')[column]!;
            await cell.trigger('dblclick');
            expect(cell.get('input').attributes('required')).toBeUndefined();
            await cell.get('input').setValue('');
            await cell.get('input').trigger('keydown', {key: 'Enter'});
            await flushPromises();
            expect(cell.text()).toBe('');
        }
        expect(sent).toEqual([{title: ''}, {description: null}]);
    });

    it('locks both Settings tab groups through a metadata write and its dependent read', async () => {
        const heldWrite = deferredResponse();
        const heldSettings = deferredResponse();
        const projection: components['schemas']['ListSettings'] = {...settings, editableFields: ['title'],
            capabilities: {...settings.capabilities, linkEvent: true, managePermissions: true},
            access: {defaults, admins: [{profileId: session.activeProfile!.id, name: 'Named administrator', isGuest: false,
                    mask: 1, editToken: '"edit-tab-admin"'}], permissions: [{key: 'EDIT_TITLE', bit: 1}], presets: []}};
        let writes = 0;
        let title = 'Original';
        const {wrapper} = await mounted(PackingSettings, {listId: id}, async request => {
            const path = new URL(request.url).pathname;
            if (request.method === 'PATCH') {
                writes++;
                title = (await request.json()).title;
                return heldWrite.response;
            }
            if (path.endsWith('/settings')) return writes ? heldSettings.response : json(projection);
            if (path.endsWith('/events')) return json({items: [], selected: null, nextCursor: null});
            return json({entityType: 'packing', id, values: {title}, editableFields: ['title'],
                currentEventId: null, archived: false, inheritedArchived: false});
        });
        await wrapper.get('[name="title"]').setValue('Submitted title');
        await wrapper.get('#packing-metadata-form').trigger('submit');
        await flushPromises();
        try {
            // The native modal locks every tab, including the hidden Access group's controls.
            expect(wrapper.findAll('[role="tab"]').every(tab => tab.attributes('disabled') !== undefined)).toBe(true);
            expect(wrapper.get('#settings-defaults-audience').attributes('disabled')).toBeDefined();
            // Happy DOM matches :disabled only for a direct attribute. These forms
            // also use native fieldset inheritance; Chromium verifies effective state.
            expect(wrapper.findAll('button, input, select, textarea')
                .every(control => control.element.matches(':disabled') || !!control.element.closest('fieldset[disabled]'))).toBe(true);
            await wrapper.get('#frontend-settings-tab-event').trigger('click');
            await wrapper.get('#frontend-settings-tab-event').trigger('focus');
            await wrapper.get('#frontend-access-admins-tab').trigger('focus');
            expect(wrapper.get('#frontend-settings-tab-general').attributes('aria-selected')).toBe('true');
            expect(wrapper.get('#frontend-access-defaults-tab').attributes('aria-selected')).toBe('true');
            expect(button(wrapper, 'Add').attributes('disabled')).toBeDefined();
            const disclosure = wrapper.get('.accordion-button');
            expect(disclosure.attributes('disabled')).toBeDefined();
            await disclosure.trigger('click');
            expect(disclosure.attributes('aria-expanded')).toBe('false');
            await button(wrapper, 'Add').trigger('click');
            expect(wrapper.get('.admin-matrix form').isVisible()).toBe(false);

            heldWrite.resolve(json({entityType: 'packing', id, values: {title}, editableFields: ['title'],
                currentEventId: null, archived: false, inheritedArchived: false}));
            await flushPromises();
            expect(wrapper.findAll('[role="tab"]').every(tab => tab.attributes('disabled') !== undefined)).toBe(true);
            expect(wrapper.get('#settings-defaults-audience').attributes('disabled')).toBeDefined();
            expect(wrapper.findAll('button, input, select, textarea')
                .every(control => control.element.matches(':disabled') || !!control.element.closest('fieldset[disabled]'))).toBe(true);
        } finally {
            heldWrite.resolve(json({entityType: 'packing', id, values: {title}, editableFields: ['title'],
                currentEventId: null, archived: false, inheritedArchived: false}));
            heldSettings.resolve(json(projection));
            await flushPromises();
        }
        expect(writes).toBe(1);
        expect(wrapper.findAll('[role="tab"]').every(tab => tab.attributes('disabled') === undefined)).toBe(true);
        expect(wrapper.get('#settings-defaults-audience').attributes('disabled')).toBeUndefined();
        await wrapper.get('#frontend-settings-tab-access').trigger('click');
        await wrapper.get('#frontend-access-admins-tab').trigger('click');
        expect(wrapper.get('#frontend-access-admins-tab').attributes('aria-selected')).toBe('true');
    });

    it('keeps Settings uncertainty recovery reachable and locks tabs only while its read is pending', async () => {
        const heldRecovery = deferredResponse();
        const projection: components['schemas']['ListSettings'] = {...settings, editableFields: ['title'],
            capabilities: {...settings.capabilities, linkEvent: true, managePermissions: true},
            access: {defaults, admins: [], permissions: [{key: 'EDIT_TITLE', bit: 1}], presets: []}};
        const metadata: components['schemas']['PackingMetadata'] = {entityType: 'packing', id,
            values: {title: 'Original'}, editableFields: ['title'], currentEventId: null,
            archived: false, inheritedArchived: false};
        let writes = 0;
        let recovering = false;
        const {wrapper} = await mounted(PackingSettings, {listId: id}, async request => {
            const path = new URL(request.url).pathname;
            if (request.method === 'PATCH') { writes++; throw new TypeError('Write response unavailable'); }
            if (path.endsWith('/settings')) return json(projection);
            if (path.endsWith('/events')) return json({items: [], selected: null, nextCursor: null});
            return recovering ? heldRecovery.response : json(metadata);
        });
        await wrapper.get('[name="title"]').setValue('Uncertain title');
        await wrapper.get('#packing-metadata-form').trigger('submit');
        await flushPromises();
        expect(wrapper.text()).toContain('The result is uncertain');
        expect(wrapper.findAll('[role="tab"]').every(tab => tab.attributes('disabled') === undefined)).toBe(true);
        await wrapper.get('#frontend-settings-tab-access').trigger('click');
        await wrapper.get('#frontend-access-admins-tab').trigger('click');
        expect(wrapper.get('#frontend-access-admins-tab').attributes('aria-selected')).toBe('true');

        recovering = true;
        // General's retained editor has its own hidden Refresh. Exercise the
        // dialog footer's user-reachable recovery while Access is selected.
        const refresh = wrapper.findAll('button').find(control => control.text() === 'Refresh' && control.isVisible());
        expect(refresh).toBeDefined();
        await refresh!.trigger('click');
        await flushPromises();
        try {
            expect(wrapper.findAll('[role="tab"]').every(tab => tab.attributes('disabled') !== undefined)).toBe(true);
            await wrapper.get('#frontend-settings-tab-general').trigger('focus');
            expect(wrapper.get('#frontend-settings-tab-access').attributes('aria-selected')).toBe('true');
        } finally {
            heldRecovery.resolve(json(metadata));
            await flushPromises();
        }
        expect(writes).toBe(1);
        expect(wrapper.findAll('[role="tab"]').every(tab => tab.attributes('disabled') === undefined)).toBe(true);
        await wrapper.get('#frontend-settings-tab-general').trigger('click');
        expect(button(wrapper, 'Review changes').attributes('disabled')).toBeUndefined();
    });

    it('renders every owner panel and refreshes its settings token after a metadata save', async () => {
        let projection: components['schemas']['ListSettings'] = {...settings, editableFields: ['title'],
            capabilities: {...settings.capabilities, editHeader: true, linkEvent: true, managePermissions: true, duplicate: true},
            access: {defaults, admins: [], permissions: [{key: 'EDIT_TITLE', bit: 1}], presets: []}};
        let title = 'Existing';
        let token: string | null = null;
        const {wrapper} = await mounted(PackingSettings, {listId: id}, async request => {
            const path = new URL(request.url).pathname;
            if (path.endsWith('/events')) return json({items: [], selected: null, nextCursor: null});
            if (path.endsWith('/settings')) return json(projection);
            if (path.endsWith('/default-permissions')) { token = request.headers.get('If-Match'); return json({changed: false}); }
            if (request.method === 'PATCH') { title = (await request.json()).title; projection = {...projection, settingsToken: '"edit-after-metadata"'}; }
            return json({entityType: 'packing', id, values: {title}, editableFields: ['title'], currentEventId: null, archived: false, inheritedArchived: false});
        });
        expect(wrapper.findAll('.entity-settings-nav [role="tab"]').map(tab => tab.text())).toEqual(['General', 'Linked event', 'Access', 'Actions']);
        await wrapper.get('#frontend-settings-tab-general').trigger('keydown', {key: 'End'});
        expect(wrapper.get('#frontend-settings-tab-actions').attributes('aria-selected')).toBe('true');
        expect(wrapper.get('#frontend-settings-tab-general').attributes('tabindex')).toBe('-1');
        await wrapper.get('#frontend-settings-tab-actions').trigger('keydown', {key: 'ArrowRight'});
        expect(wrapper.get('#frontend-settings-tab-general').attributes('aria-selected')).toBe('true');
        await wrapper.get('#frontend-settings-tab-general').trigger('keydown', {key: 'ArrowDown'});
        expect(wrapper.get('#frontend-settings-tab-event').attributes('aria-selected')).toBe('true');
        await wrapper.get('#frontend-settings-tab-event').trigger('keydown', {key: 'Home'});
        expect(wrapper.get('#frontend-settings-tab-general').attributes('tabindex')).toBe('0');
        await wrapper.get('[name="title"]').setValue('Saved title');
        await wrapper.get('#packing-metadata-form').trigger('submit');
        await flushPromises();
        await wrapper.get('#frontend-settings-tab-access').trigger('click');
        await wrapper.get('#settings-defaults-participant-EDIT_TITLE').setValue(true);
        await wrapper.get('#frontend-access-defaults').trigger('submit');
        await flushPromises();
        expect(token).toBe('"edit-after-metadata"');
    });

    it('refreshes a pristine properties editor after another settings command advances its token', async () => {
        const projection = {...settings, editableFields: ['title'] as const,
            capabilities: {...settings.capabilities, managePermissions: true},
            access: {defaults, admins: [], permissions: [{key: 'EDIT_TITLE', bit: 1}], presets: []}};
        let etag = '"before-settings"';
        let savedToken: string | null = null;
        let title = 'Original';
        const {wrapper} = await mounted(PackingSettings, {listId: id}, async request => {
            const path = new URL(request.url).pathname;
            if (path.endsWith('/settings')) return json(projection);
            if (path.endsWith('/default-permissions')) { etag = '"after-settings"'; return json({changed: true}); }
            if (request.method === 'PATCH') { savedToken = request.headers.get('If-Match'); title = (await request.json()).title; }
            const result = json({entityType: 'packing', id, values: {title}, editableFields: ['title'], currentEventId: null, archived: false, inheritedArchived: false});
            result.headers.set('ETag', etag);
            return result;
        });
        await wrapper.get('#frontend-settings-tab-access').trigger('click');
        await wrapper.get('#settings-defaults-participant-EDIT_TITLE').setValue(true);
        await wrapper.get('#frontend-access-defaults').trigger('submit');
        await flushPromises();
        await wrapper.get('#frontend-settings-tab-general').trigger('click');
        await wrapper.get('[name="title"]').setValue('Edited after settings');
        await wrapper.get('#packing-metadata-form').trigger('submit');
        await flushPromises();
        expect(savedToken).toBe('"after-settings"');
    });
    it('keeps a rejected quick-add draft, protects navigation and clears only after confirmation', async () => {
        let reject = true;
        const sent: unknown[] = [];
        const {wrapper, router} = await mounted(PackingPage, {}, async request => {
            if (request.method === 'POST') { sent.push(await request.json()); return reject ? problem('VALIDATION_FAILED', 400) : json({id: otherId}, 201); }
            return json(list);
        });
        await wrapper.get('#quick-title').setValue('  Ground sheet  ');
        await wrapper.get('#quick-description').setValue('Dry');
        await wrapper.get('#quick-max').setValue(3);
        const confirm = vi.fn(() => false);
        vi.stubGlobal('confirm', confirm);
        await router.push('/away');
        expect(router.currentRoute.value.path).toContain('/packing/');
        expect(confirm).toHaveBeenCalled();
        await wrapper.get('form').trigger('submit');
        await flushPromises();
        expect(wrapper.get<HTMLInputElement>('#quick-title').element.value).toBe('  Ground sheet  ');
        reject = false;
        await wrapper.get('form').trigger('submit');
        await flushPromises();
        expect(sent).toEqual([{title: '  Ground sheet  ', description: 'Dry', maxAssignees: 3, requiredByAll: false},
        {title: '  Ground sheet  ', description: 'Dry', maxAssignees: 3, requiredByAll: false}]);
        expect(wrapper.get<HTMLInputElement>('#quick-title').element.value).toBe('');
        expect(wrapper.get<HTMLInputElement>('#quick-max').element.value).toBe('1');
    });

    it.each(['quick-title', 'quick-max'] as const)(
        'restores the same %s field after Enter submits a rejected Quick Add', async controlId => {
            const held = deferredResponse();
            const sent: unknown[] = [];
            const {wrapper} = await mounted(PackingPage, {}, async function receiveQuickAdd(request) {
                if (request.method === 'POST') {
                    sent.push(await request.json());
                    return held.response;
                }
                return json(list);
            });
            await wrapper.get('#quick-title').setValue('  Retained ground sheet  ');
            await wrapper.get('#quick-description').setValue('Dry');
            await wrapper.get('#quick-max').setValue(3);
            const input = wrapper.get<HTMLInputElement>('#' + controlId);
            const original = input.element;
            original.focus();
            expect(document.activeElement).toBe(original);

            try {
                // Happy DOM does not perform implicit Enter submission. Dispatch
                // its native form consequence after the actual focused key event;
                // the complete feature command and HTTP client remain mounted.
                await input.trigger('keydown', {key: 'Enter'});
                await wrapper.get('form').trigger('submit');
                await flushPromises();
                expect(sent).toEqual([{title: '  Retained ground sheet  ', description: 'Dry', maxAssignees: 3, requiredByAll: false}]);
                expect(wrapper.get('#' + controlId).element).toBe(original);
                releasePendingEditorFocus(original);

                // Rejection must retain both the exact native directive-owned
                // numeric control and the default shared text input's draft.
                held.resolve(problem('VALIDATION_FAILED', 400));
                await flushPromises();
                expect(wrapper.get('#' + controlId).element).toBe(original);
                expect(original.disabled).toBe(false);
                expect(document.activeElement).toBe(original);
                expect(wrapper.get<HTMLInputElement>('#quick-title').element.value).toBe('  Retained ground sheet  ');
                expect(wrapper.get<HTMLInputElement>('#quick-description').element.value).toBe('Dry');
                expect(wrapper.get<HTMLInputElement>('#quick-max').element.value).toBe('3');
                expect(sent).toHaveLength(1);
            } finally {
                held.resolve(problem('VALIDATION_FAILED', 400));
                await flushPromises();
            }
        });

    it('matches native quick-add raw strings and optional blank capacity default', async () => {
        const sent: unknown[] = [];
        const {wrapper} = await mounted(PackingPage, {}, async request => {
            if (request.method === 'POST') {
                sent.push(await request.json());
                return json({id: otherId}, 201);
            }
            return json(list);
        });
        await wrapper.get('#quick-title').setValue('  Raw title  ');
        await wrapper.get('#quick-description').setValue('  Raw note  ');
        await wrapper.get('#quick-max').setValue('');
        expect(wrapper.get<HTMLInputElement>('#quick-max').element.required).toBe(false);
        expect(wrapper.get<HTMLFormElement>('form').element.checkValidity()).toBe(true);
        await wrapper.get('form').trigger('submit');
        await flushPromises();
        await wrapper.get('#quick-title').setValue('   ');
        await wrapper.get('form').trigger('submit');
        await flushPromises();
        expect(sent).toEqual([{title: '  Raw title  ', description: '  Raw note  ', maxAssignees: 1, requiredByAll: false},
        {title: '   ', description: '', maxAssignees: 1, requiredByAll: false}]);
    });

    it('keeps an unknown quick-add on cancelled navigation and releases it only for the committed next list', async () => {
        const {wrapper, router, request} = await mounted(PackingPage, {}, async req => {
            if (req.method === 'POST') throw new TypeError('Response lost');
            const listId = new URL(req.url).pathname.split('/').at(-1)!;
            return json({...list, id: listId, title: listId === id ? 'Equipment' : 'Other equipment'});
        });
        await wrapper.get('#quick-title').setValue('Unconfirmed item');
        await wrapper.get('form').trigger('submit');
        await flushPromises();
        expect(button(wrapper, 'Add').attributes('disabled')).toBeDefined();
        const confirm = vi.fn(() => false);
        vi.stubGlobal('confirm', confirm);
        await router.push(`/packing/${otherId}`);
        expect(router.currentRoute.value.params.listId).toBe(id);
        expect(wrapper.get<HTMLInputElement>('#quick-title').element.value).toBe('Unconfirmed item');
        confirm.mockReturnValue(true);
        await router.push(`/packing/${otherId}`);
        await flushPromises();
        expect(wrapper.get('h1').text()).toBe('Other equipment');
        expect(wrapper.get<HTMLInputElement>('#quick-title').element.value).toBe('');
        expect(button(wrapper, 'Add').attributes('disabled')).toBeUndefined();
        expect(request.mock.calls.map(([req]) => req as Request).filter(req => req.method === 'POST')).toHaveLength(1);
        await wrapper.get('#quick-title').setValue('New explicit item');
        await wrapper.get('form').trigger('submit');
        await flushPromises();
        expect(request.mock.calls.map(([req]) => req as Request).filter(req => req.method === 'POST')
            .map(req => new URL(req.url).pathname))
            .toEqual([`/api/v1/packing-lists/${id}/items`, `/api/v1/packing-lists/${otherId}/items`]);
    });

    it('sends the drag-start ordering token even when a refresh arrives during the drag', async () => {
        const second = {...item, id: otherId, title: 'Stove', position: 1};
        const current = {...list, items: [item, second]};
        let received: {token: string | null; body: unknown} | undefined;
        const {wrapper, context} = await mounted(PackingPage, {}, async request => {
            if (request.method === 'PUT') { received = {token: request.headers.get('If-Match'), body: await request.json()}; return problem('PRECONDITION_FAILED', 412); }
            return json(current);
        });
        await wrapper.get('[data-item-id="' + otherId + '"]').trigger('dragstart');
        await wrapper.get('[data-item-id="' + itemId + '"]').trigger('dragover', {clientY: 0});
        expect(wrapper.get('[data-item-id="' + itemId + '"]').classes()).toContain('frontend-reorder-before');
        expect(received).toBeUndefined();
        context.queryClient.setQueryData(packingKeys.detail(session.context, id),
            {data: {...current, orderToken: '"remote-order"'}, etag: '"remote"'});
        await flushPromises();
        await wrapper.get('[data-item-id="' + itemId + '"]').trigger('drop');
        await flushPromises();
        expect(received).toEqual({token: '"order-original"', body: {itemIds: [otherId, itemId]}});
        expect(wrapper.find('.frontend-reorder-before, .frontend-reorder-after, .frontend-reorder-dragging').exists()).toBe(false);
    });

    it.each(['title', 'description'] as const)('projects a %s-only settings grant without other settings authority', async field => {
        const projection = {...settings, editableFields: [field]};
        let saved: unknown;
        const {wrapper} = await mounted(PackingSettings, {listId: id}, async request => {
            if (new URL(request.url).pathname.endsWith('/settings')) return json(projection);
            if (request.method === 'PATCH') saved = {body: await request.json(), token: request.headers.get('If-Match')};
            return json({entityType: 'packing', id, values: {[field]: 'Existing'}, editableFields: [field],
                currentEventId: null, archived: false, inheritedArchived: false});
        });
        expect(wrapper.findAll('[name="title"]')).toHaveLength(field === 'title' ? 1 : 0);
        expect(wrapper.findAll('[name="description"]')).toHaveLength(field === 'description' ? 1 : 0);
        expect(wrapper.findAll('input[type="file"]')).toHaveLength(0);
        expect(wrapper.text()).not.toContain('Delete permanently');
        expect(wrapper.text()).not.toContain('Administrators');
        await wrapper.get('[name="' + field + '"]').setValue('Edited value');
        await wrapper.get('#packing-metadata-form').trigger('submit');
        await flushPromises();
        expect(saved).toEqual({body: {[field]: 'Edited value'}, token: '"original"'});
    });

    it('requires explicit event draft review before adopting a new parent and settings token', async () => {
        vi.stubGlobal('confirm', vi.fn(() => true));
        const choice = {id: itemId, title: 'Chosen camp', startDate: '2026-10-07', endDate: '2026-10-08',
            archived: false, description: null, deadlinePassed: false};
        let projection: components['schemas']['ListSettings'] = {...settings, capabilities: {...settings.capabilities, linkEvent: true}};
        let saved: unknown;
        const {wrapper, context} = await mounted(PackingSettings, {listId: id}, async request => {
            if (new URL(request.url).pathname.endsWith('/events')) return json({items: [choice], selected: null, nextCursor: null});
            if (request.method === 'PUT') { saved = {body: await request.json(), token: request.headers.get('If-Match')}; return json({changed: true, canView: true}); }
            return json(projection);
        });
        await wrapper.get('[data-event-id="' + itemId + '"]').trigger('click');
        projection = {...projection, settingsToken: '"edit-remote-settings"', currentEvent: {id: otherId, title: 'Remote camp', startDate: null, endDate: null, url: null}};
        context.queryClient.setQueryData(packingKeys.settings(session.context, id), projection);
        await flushPromises();
        expect(button(wrapper, 'Save event link').attributes('disabled')).toBeDefined();
        expect(wrapper.text()).toContain('Remote camp');
        expect(saved).toBeUndefined();
        await button(wrapper, 'Review changes').trigger('click');
        await wrapper.get('#frontend-settings-event form').trigger('submit');
        await flushPromises();
        expect(saved).toEqual({body: {eventId: itemId, expectedEventId: otherId}, token: '"edit-remote-settings"'});
    });

    it.each([false, true])('retains the same metadata draft through narrow write-grant loss with independent Header grant (%s)', async headerAllowed => {
        vi.useFakeTimers({toFake: ['setInterval', 'clearInterval']});
        let projection = {...settings, editableFields: ['title'],
            capabilities: {...settings.capabilities, editHeader: headerAllowed, duplicate: true}};
        const metadata = {entityType: 'packing', id, values: {title: 'Existing title'}, editableFields: ['title'],
            currentEventId: null, archived: false, inheritedArchived: false};
        const {wrapper, context, request} = await mounted(PackingSettings, {listId: id},
            async function retainMetadataDraft(request): Promise<Response> {
                return json(new URL(request.url).pathname.endsWith('/settings') ? projection : metadata);
            });
        const field = wrapper.get<HTMLInputElement>('[name="title"]');
        await field.setValue('Retained local title');

        // The independent Actions panel keeps Settings admitted. General may
        // stay visible for Header or disappear while retaining this same draft.
        projection = {...projection, editableFields: []};
        await context.queryClient.refetchQueries({queryKey: packingKeys.settings(session.context, id), exact: true});
        await flushPromises();
        expect(field.element.isConnected).toBe(true);
        expect(field.isVisible()).toBe(false);
        expect(field.element.closest('fieldset')?.disabled).toBe(true);
        expect(field.element.value).toBe('Retained local title');
        await wrapper.get('#packing-metadata-form').trigger('submit');
        await flushPromises();
        expect(request.mock.calls.every(([value]) => (value as Request).method === 'GET')).toBe(true);
        await vi.advanceTimersByTimeAsync(60_000);
        await flushPromises();
        expect(request.mock.calls.filter(([value]) => new URL((value as Request).url).pathname.endsWith('/metadata'))).toHaveLength(1);

        projection = {...projection, editableFields: ['title']};
        await context.queryClient.refetchQueries({queryKey: packingKeys.settings(session.context, id), exact: true});
        await flushPromises();
        await button(wrapper, 'General').trigger('click');
        expect(wrapper.get('[name="title"]').element).toBe(field.element);
        expect(field.isVisible()).toBe(true);
        expect(field.element.closest('fieldset')?.disabled).toBe(false);
        expect(field.element.value).toBe('Retained local title');
        expect(request.mock.calls.every(([value]) => (value as Request).method === 'GET')).toBe(true);
    });

    it('retains the same chosen header input through narrow capability loss without admitting hidden commands', async () => {
        vi.stubGlobal('confirm', vi.fn(() => true));
        let projection = {...settings, headerUrl: '/packing/' + id + '/header', headerVersion: 'chosen-header',
            capabilities: {...settings.capabilities, editHeader: true, duplicate: true}};
        const uploads: {name: string; token: string | null}[] = [];
        const {wrapper, context, request} = await mounted(PackingSettings, {listId: id},
            async function headerAuthority(request): Promise<Response> {
                if (request.method === 'PUT') {
                    uploads.push({name: ((await request.formData()).get('image') as File).name,
                        token: request.headers.get('If-Match')});
                    return json({changed: true});
                }
                return json(projection);
            });
        const original = wrapper.get<HTMLInputElement>('input[type="file"]');
        const selection = new DataTransfer();
        const file = new File(['chosen bytes'], 'retained-local.png', {type: 'image/png'});
        selection.items.add(file);
        original.element.files = selection.files;
        await original.trigger('change');
        const header = wrapper.findComponent(EntityHeaderEditor);

        // An independently admitted Actions panel keeps this same Settings visit
        // alive while current authority removes only the header write capability.
        projection = {...projection, capabilities: {...projection.capabilities, editHeader: false}};
        await context.queryClient.refetchQueries({queryKey: packingKeys.settings(session.context, id), exact: true});
        await flushPromises();
        expect(original.element.isConnected).toBe(true);
        expect(original.element.files?.[0]).toBe(file);
        expect(header.isVisible()).toBe(false);
        expect(original.element.disabled).toBe(true);
        // Retained callbacks need the same fresh capability fence as native
        // controls; a hidden draft is never permission to upload or remove.
        header.vm.$emit('upload', new Event('click'));
        header.vm.$emit('remove', new Event('click'));
        await flushPromises();
        expect(request.mock.calls.every(([value]) => (value as Request).method === 'GET')).toBe(true);
        expect(window.confirm).not.toHaveBeenCalled();

        projection = {...projection, capabilities: {...projection.capabilities, editHeader: true}};
        await context.queryClient.refetchQueries({queryKey: packingKeys.settings(session.context, id), exact: true});
        await button(wrapper, 'General').trigger('click');
        expect(wrapper.get('input[type="file"]').element).toBe(original.element);
        expect(original.element.files?.[0]).toBe(file);
        expect(header.isVisible()).toBe(true);
        expect(original.element.disabled).toBe(false);
        await button(wrapper, 'Upload').trigger('click');
        await flushPromises();
        expect(uploads).toEqual([{name: file.name, token: settings.settingsToken}]);
        expect(original.element.files?.length).toBe(0);
    });

    it('retains a chosen file on refresh and requires review before uploading with a new token', async () => {
        let projection = {...settings, capabilities: {...settings.capabilities, editHeader: true}};
        let saved: {token: string | null; name: string} | undefined;
        const {wrapper, context} = await mounted(PackingSettings, {listId: id}, async request => {
            if (request.method === 'PUT') {
                saved = {token: request.headers.get('If-Match'), name: ((await request.formData()).get('image') as File).name};
                return json({changed: true});
            }
            return json(projection);
        });
        const file = new File(['image'], 'local.png', {type: 'image/png'});
        const input = wrapper.get<HTMLInputElement>('input[type="file"]');
        Object.defineProperty(input.element, 'files', {value: [file]});
        await input.trigger('change');
        projection = {...projection, settingsToken: '"edit-remote-settings"', headerVersion: 'remote-image'};
        context.queryClient.setQueryData(packingKeys.settings(session.context, id), projection);
        await flushPromises();
        expect(button(wrapper, 'Upload').attributes('disabled')).toBeDefined();
        expect(wrapper.text()).toContain('local.png');
        await button(wrapper, 'Review changes').trigger('click');
        await button(wrapper, 'Upload').trigger('click');
        await flushPromises();
        expect(saved).toEqual({token: '"edit-remote-settings"', name: 'local.png'});
    });

    it('retains a custom administrator mask through polling and sends it only after conflict review', async () => {
        let projection: components['schemas']['ListSettings'] = {...settings,
            capabilities: {...settings.capabilities, managePermissions: true},
            access: {defaults, admins: [{profileId: otherId, name: 'Delegate', isGuest: false, mask: 0, editToken: '"edit-admin-original"'}],
                permissions: [{key: 'EDIT_TITLE', bit: 1}, {key: 'EDIT_DESC', bit: 2}], presets: []}};
        let saved: unknown;
        const {wrapper, context} = await mounted(PackingSettings, {listId: id}, async request => {
            if (request.method === 'PATCH') { saved = {body: await request.json(), token: request.headers.get('If-Match')}; return json({changed: true}); }
            return json(projection);
        });
        await wrapper.get('#frontend-access-admins-tab').trigger('click');
        await wrapper.get('.accordion-button').trigger('click');
        await wrapper.get('#admin-' + otherId + '-EDIT_TITLE').setValue(true);
        projection = {...projection, settingsToken: '"edit-remote-settings"', access: {...projection.access!, admins: [{profileId: otherId, name: 'Delegate', isGuest: false, mask: 2, editToken: '"edit-remote-settings"'}]}};
        context.queryClient.setQueryData(packingKeys.settings(session.context, id), projection);
        await flushPromises();
        expect(button(wrapper, 'Save').attributes('disabled')).toBeDefined();
        await button(wrapper, 'Review changes').trigger('click');
        await button(wrapper, 'Save').trigger('click');
        await flushPromises();
        expect(saved).toEqual({body: {mask: 1}, token: '"edit-remote-settings"'});
    });

    it('uses one datalist search field and only submits an exact returned administrator choice', async () => {
        vi.useFakeTimers();
        const projection = {...settings, capabilities: {...settings.capabilities, managePermissions: true},
            access: {defaults, admins: [], permissions: [], presets: []}};
        const sent: unknown[] = [];
        const {wrapper, context} = await mounted(PackingSettings, {listId: id}, async request => {
            if (new URL(request.url).pathname.endsWith('/profiles')) return json([
                {profileId: otherId, name: 'Guest Delegate', username: '', isGuest: true},
            ]);
            if (request.method === 'POST') { sent.push(await request.json()); return json({changed: true}); }
            return json(projection);
        });
        await wrapper.get('#frontend-access-admins-tab').trigger('click');
        await button(wrapper, 'Add').trigger('click');
        const form = wrapper.findAll('form').find(candidate => candidate.find('#profile-search').exists())!;
        await form.get('#profile-search').setValue('Guest');
        // Begin the actual existing debounce before draining its lazy input
        // admission. The original option and payload assertions keep their limits.
        await vi.advanceTimersByTimeAsync(200);
        await flushPromises();
        await vi.waitFor(() => expect(form.findAll('datalist option')).toHaveLength(1));
        expect(form.findAll('input')).toHaveLength(1);
        expect(form.findAll('select')).toHaveLength(1); // The existing Initial preset selector remains.
        expect(button(form, 'Add').attributes('disabled')).toBeUndefined();
        await form.trigger('submit');
        await flushPromises();
        expect(wrapper.get('.alert-danger').text()).toBe('Please select a user');
        expect(sent).toEqual([]);
        expect(form.get('datalist option').attributes('value')).toBe(otherId);
        vi.stubGlobal('confirm', () => false);
        expect(context.mayChangeIdentity()).toBe(false);
        await form.get('#profile-search').setValue(otherId);
        expect(button(form, 'Add').attributes('disabled')).toBeUndefined();
        await form.get('#profile-search').setValue('unmatched');
        expect(button(form, 'Add').attributes('disabled')).toBeUndefined();
        await flushPromises();
        await form.get('#profile-search').setValue(otherId);
        await form.trigger('submit');
        await flushPromises();
        expect(sent).toEqual([{profileId: otherId, mask: 0}]);
        expect(form.get<HTMLInputElement>('#profile-search').element.value).toBe('');
        expect(context.mayChangeIdentity()).toBe(true);
    });

    it('recovers profile discovery without submitting and retires only its protected suggestions on denial', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-10-09T12:00:00Z'));
        const projection = {...settings, capabilities: {...settings.capabilities, managePermissions: true},
            access: {defaults, admins: [], permissions: [], presets: []}};
        const delegate = {profileId: otherId, name: 'Private Delegate', username: 'delegate@example.test', isGuest: false};
        let outcome: 'success' | 'cooldown' | 'denied' = 'success';
        let profileReads = 0;
        let writes = 0;
        const {wrapper, context} = await mounted(PackingSettings, {listId: id}, async function readProfiles(request) {
            if (request.method === 'POST') { writes++; return json({changed: true}); }
            if (!new URL(request.url).pathname.endsWith('/profiles')) return json(projection);
            profileReads++;
            if (outcome === 'denied') return problem('FORBIDDEN', 403);
            if (outcome === 'cooldown') return new Response('{}', {status: 503,
                headers: {'Content-Type': 'application/json', 'Retry-After': '5', 'X-Surveyor-Context': session.context}});
            return json([delegate]);
        });
        await wrapper.get('#frontend-access-admins-tab').trigger('click');
        await button(wrapper, 'Add').trigger('click');
        const form = wrapper.get('[data-entity-section="administrator-add"]');
        const search = form.get<HTMLInputElement>('#profile-search');
        await search.setValue('delegate');
        await vi.advanceTimersByTimeAsync(200);
        await flushPromises();
        await search.setValue(delegate.username);
        expect(form.get('datalist option').attributes('label')).toContain(delegate.name);

        outcome = 'cooldown';
        await context.queryClient.refetchQueries({queryKey: packingKeys.profilesFamily(session.context, id)});
        await flushPromises();
        expect(form.get('datalist option').attributes('label')).toContain(delegate.name);
        expect(form.find('[data-last-successful-refresh]').exists()).toBe(true);
        expect(form.find('[data-read-retry-at]').exists()).toBe(true);
        const retry = button(form, context.messages.value.t('common.retry'));
        expect(retry.attributes('disabled')).toBeDefined();
        const beforeRetry = profileReads;
        await retry.trigger('click');
        expect(profileReads).toBe(beforeRetry);
        await vi.advanceTimersByTimeAsync(5001);
        outcome = 'success';
        await retry.trigger('click');
        await flushPromises();
        expect(profileReads).toBe(beforeRetry + 1);
        expect(form.find('[data-read-retry-at]').exists()).toBe(false);
        expect(writes).toBe(0);

        outcome = 'denied';
        await context.queryClient.refetchQueries({queryKey: packingKeys.profilesFamily(session.context, id)});
        await flushPromises();
        expect(form.find('datalist option').exists()).toBe(false);
        expect(wrapper.text()).not.toContain(delegate.name);
        expect(search.element.value).toBe(delegate.username);
        expect(context.queryClient.getQueriesData({queryKey: packingKeys.profilesFamily(session.context, id)})
            .every(([, value]) => value === undefined)).toBe(true);
        // Settings has independent authority; discovery does not close its editor.
        expect(wrapper.find('#frontend-access-admins-tab').exists()).toBe(true);
        await form.trigger('submit');
        await flushPromises();
        expect(writes).toBe(0);
        outcome = 'success';
        await button(form, context.messages.value.t('common.retry')).trigger('click');
        await flushPromises();
        expect(form.get('datalist option').attributes('label')).toContain(delegate.name);
        expect(writes).toBe(0);
    });

    it('offers access management independently from metadata fields and uses tab semantics', async () => {
        const projection = {...settings, capabilities: {...settings.capabilities, managePermissions: true},
            access: {defaults, admins: [], permissions: [], presets: []}};
        const {wrapper} = await mounted(PackingSettings, {listId: id}, async () => json(projection));
        expect(wrapper.findAll('[name="title"], [name="description"]')).toHaveLength(0);
        const tab = wrapper.get('#frontend-access-admins-tab');
        expect(tab.attributes('role')).toBe('tab');
        await wrapper.get('#frontend-access-defaults-tab').trigger('keydown', {key: 'ArrowRight'});
        expect(tab.attributes('aria-selected')).toBe('true');
        expect(tab.attributes('tabindex')).toBe('0');
        expect(wrapper.get('#frontend-access-defaults-tab').attributes('tabindex')).toBe('-1');
        expect(wrapper.get('#frontend-settings-access').attributes('aria-labelledby')).toBe('frontend-settings-tab-access');
        expect(wrapper.get('#frontend-settings-tab-access').text()).toBe('Access');
        expect(wrapper.get('#frontend-access-admins').isVisible()).toBe(true);
        expect(wrapper.get('#frontend-access-defaults').isVisible()).toBe(false);
    });

    it.each([false, true])('initializes only an admitted URL event and drops rejected context before submitting (duplicate: %s)', async duplicate => {
        const choice: components['schemas']['EventPickerOption'] = {id: otherId, title: 'Permitted contextual camp',
            description: null, startDate: '2026-10-07', endDate: '2026-10-08', archived: false, deadlinePassed: false};
        const formContext: components['schemas']['EntityCreationContext'] = {defaults, permissions: [], presets: []};
        let submitted: components['schemas']['PackingCreateInput'] | undefined;
        const path = duplicate ? `/packing/${id}/duplicate` : '/packing/create';
        const {wrapper, router, request} = await mounted(PackingCreatePage, {}, async function readContext(incoming) {
            const url = new URL(incoming.url);
            if (incoming.method === 'POST') {
                submitted = JSON.parse(String((await incoming.formData()).get('data')));
                return json({id: itemId}, 201);
            }
            if (url.pathname.endsWith('/events')) return json({items: [], selected: null, nextCursor: null});
            const selectedEvent = url.searchParams.get('eventId') === otherId ? choice : null;
            if (url.pathname.endsWith('/duplicate')) return json({title: 'Copied equipment', description: null, eventId: null,
                items: [{title: 'Tent', description: null, maxAssignees: 1, requiredByAll: false}],
                defaultPermissions: defaults, formContext, selectedEvent});
            return json({entry: {kind: 'render'}, context: formContext, selectedEvent});
        }, `${path}?eventId=${otherId}`);
        expect(wrapper.findComponent(EventPicker).props('modelValue')).toBe(otherId);
        expect(wrapper.get('#create-event-button').text()).toBe(choice.title);

        // A second cold visit uses a separate admitted projection. The raw URL
        // cannot resurrect an inaccessible selection or become a submitted draft.
        await router.push(`${path}?eventId=${itemId}`);
        await flushPromises();
        expect(wrapper.findComponent(EventPicker).props('modelValue')).toBeNull();
        expect(wrapper.get('#create-event-button').text()).toBe('No event');
        await wrapper.get('#create-title').setValue('Standalone creation');
        await wrapper.get('tbody input').setValue('Tent');
        await wrapper.get('form').trigger('submit');
        await flushPromises();
        expect(submitted?.eventId).toBeNull();
        expect(request.mock.calls.filter(([incoming]) => (incoming as Request).method === 'GET')
            .map(([incoming]) => new URL((incoming as Request).url).searchParams.get('eventId'))).toContain(itemId);
    });

    it('retains a user-chosen event draft when later discovery revokes its display projection', async () => {
        const choice = {id: otherId, title: 'Chosen after entry', description: null, startDate: '2026-10-07',
            endDate: '2026-10-08', archived: false, deadlinePassed: false};
        let revoked = false;
        const {wrapper, context} = await mounted(PackingCreatePage, {}, async function readContext(incoming) {
            if (new URL(incoming.url).pathname.endsWith('/events')) {
                return json({items: revoked ? [] : [choice], selected: revoked ? null : choice, nextCursor: null});
            }
            return json({entry: {kind: 'render'}, context: {defaults, permissions: [], presets: []}});
        }, '/packing/create');
        await wrapper.get('#create-event-button').trigger('click');
        await flushPromises();
        await wrapper.get(`[data-event-id="${otherId}"]`).trigger('click');
        expect(wrapper.findComponent(EventPicker).props('modelValue')).toBe(otherId);
        revoked = true;
        await wrapper.get('#create-event-button').trigger('click');
        await flushPromises();
        await context.queryClient.invalidateQueries({queryKey: packingKeys.events(session.context)});
        await flushPromises();
        expect(wrapper.findComponent(EventPicker).props('modelValue')).toBe(otherId);
        expect(wrapper.get('#create-event-button').text()).not.toBe(choice.title);
    });

    it.each([false, true])('shows the empty collection error through shared feedback while retaining the creation draft (duplicate: %s)', async duplicate => {
        const formContext = {defaults, permissions: [], presets: []};
        const path = duplicate ? `/packing/${id}/duplicate` : '/packing/create';
        const {wrapper, request} = await mounted(PackingCreatePage, {}, async function readCreation(request) {
            if (new URL(request.url).pathname.endsWith('/events')) return json({items: [], selected: null, nextCursor: null});
            if (new URL(request.url).pathname.endsWith('/duplicate')) return json({title: 'Copied equipment', description: null, eventId: null,
                items: [{title: 'Tent', description: null, maxAssignees: 1, requiredByAll: false}],
                defaultPermissions: defaults, formContext});
            return json({entry: {kind: 'render'}, context: formContext, selectedEvent: null});
        }, path);
        await wrapper.get('#create-title').setValue('Retained title');
        const title = wrapper.get<HTMLInputElement>('#create-title').element;
        title.focus();
        await wrapper.get('tbody input[aria-label="Item 1"]').setValue('   ');
        await wrapper.get('form').trigger('submit');
        await flushPromises();
        const flash = wrapper.get('.alert-danger');
        expect(flash.text()).toBe('Add at least one item with a title before creating the packing list.');
        expect(flash.classes()).toContain('frontend-notification');
        expect(flash.element.closest('.frontend-notice-origin.frontend-notice-region')).not.toBeNull();
        expect(document.activeElement).toBe(title);
        expect(flash.get('button').attributes('aria-label')).toBe('Dismiss notification');
        expect(wrapper.get<HTMLInputElement>('#create-title').element.value).toBe('Retained title');
        expect(wrapper.get<HTMLInputElement>('tbody input[aria-label="Item 1"]').element.value).toBe('   ');
        expect(request.mock.calls.every(([request]) => (request as Request).method === 'GET')).toBe(true);
    });

    it.each([
        {control: '#create-title', value: 'x'.repeat(256), field: 'Title', reason: 'Use no more than 255 characters.'},
        {control: '#create-description', value: 'x'.repeat(65536), field: 'Description', reason: 'Use no more than 65535 characters.'},
        {control: '#packing-row-1-title', value: 'x'.repeat(256), field: 'Item 2 — Title', reason: 'Use no more than 255 characters.'},
        {control: '#packing-row-1-description', value: 'x'.repeat(65536), field: 'Item 2 — Description', reason: 'Use no more than 65535 characters.'},
        {control: '#packing-row-1-capacity', value: '2147483648', field: 'Item 2 — Max #', reason: 'Enter a number no greater than 2147483647.'},
    ])('identifies invalid pasted creation input in $control without losing rows or the selected file', async ({control, value, field, reason}) => {
        const {wrapper, context, request} = await mounted(PackingCreatePage, {}, async request => {
            if (new URL(request.url).pathname.endsWith('/events')) return json({items: [], selected: null, nextCursor: null});
            return json({entry: {kind: 'render'}, context: {defaults, permissions: [], presets: []}, selectedEvent: null});
        }, '/packing/create');
        await wrapper.get('#create-title').setValue('Weekend equipment');
        // An omitted blank first row must not change the reported visible index.
        await button(wrapper, 'Add row').trigger('click');
        await wrapper.get('#packing-row-1-title').setValue('Lantern');
        await wrapper.get(control).setValue(value);
        const chooser = wrapper.get<HTMLInputElement>('#create-header').element;
        const file = new File(['header'], 'equipment.png', {type: 'image/png'});
        Object.defineProperty(chooser, 'files', {configurable: true, value: [file]});
        chooser.dispatchEvent(new Event('change', {bubbles: true}));
        const retained = wrapper.get<HTMLInputElement>(control).element;
        retained.focus();
        await wrapper.get('form').trigger('submit');
        await flushPromises();
        const feedback = wrapper.get('.alert-danger');
        expect(feedback.text()).toBe(field + ': ' + reason);
        expect(feedback.classes()).toContain('frontend-notification');
        expect(wrapper.get<HTMLInputElement>(control).element).toBe(retained);
        expect(retained.value).toBe(value);
        expect(document.activeElement).toBe(retained);
        expect(chooser.files?.[0]).toBe(file);
        expect(request.mock.calls.every(([request]) => (request as Request).method === 'GET')).toBe(true);
        context.locale.value = 'de';
        await flushPromises();
        expect(feedback.text()).not.toBe(field + ': ' + reason);
        expect(feedback.text()).not.toContain('check the submitted');
        expect(wrapper.get<HTMLInputElement>(control).element.value).toBe(value);
        expect(chooser.files?.[0]).toBe(file);
    });

    it('creates a duplicate from ordered rows and current form values, without copying assignments or event links', async () => {
        let submitted: unknown;
        const duplicate: components['schemas']['PackingDuplicate'] = {title: 'Copy equipment', description: 'Shared', eventId: null,
            items: [{title: 'Tent', description: null, maxAssignees: 2, requiredByAll: false},
            {title: 'Bottle', description: 'Personal', maxAssignees: 1, requiredByAll: true}], defaultPermissions: defaults,
            formContext: {defaults, permissions: [], presets: []}};
        const {wrapper} = await mounted(PackingCreatePage, {}, async request => {
            const path = new URL(request.url).pathname;
            if (request.method === 'POST') {
                submitted = JSON.parse(String((await request.formData()).get('data')));
                return json({id: otherId}, 201);
            }
            if (path.endsWith('/duplicate')) return json(duplicate);
            if (path.endsWith('/events')) return json({items: [], nextCursor: null, selected: null});
            return json({entry: {kind: 'render'}, context: {defaults, permissions: [], presets: []}});
        }, '/packing/' + id + '/duplicate');
        expect(wrapper.findAll('tbody tr')).toHaveLength(2);
        expect(wrapper.findAll<HTMLInputElement>('tbody input[type="checkbox"]').map(input => input.element.checked)).toEqual([false, true]);
        await wrapper.get('#create-title').setValue('  Edited copy  ');
        await wrapper.get('#create-description').setValue('  Shared root  ');
        const itemRows = wrapper.findAll('tbody tr');
        await itemRows[0]!.findAll('input')[0]!.setValue('  Tent  ');
        await itemRows[0]!.findAll('input')[1]!.setValue('   ');
        await itemRows[0]!.get('input[type="number"]').setValue('2e3');
        await button(wrapper, 'Add row').trigger('click');
        await wrapper.findAll('tbody tr')[2]!.get('input').setValue('   ');
        // Creation preserves its accepted integer parsing of a lexical exponent.
        const expectedItems = [{title: 'Tent', description: '', maxAssignees: 2, requiredByAll: false},
        {title: 'Bottle', description: 'Personal', maxAssignees: 1, requiredByAll: true}];
        expect(itemRows[0]!.get<HTMLInputElement>('input[type="number"]').element.value).toBe('2e3');
        await wrapper.get('form').trigger('submit');
        await flushPromises();
        expect(submitted).toEqual({title: '  Edited copy  ', description: '  Shared root  ', eventId: null,
            defaultPermissions: defaults, items: expectedItems});
    });

    it.each([{status: 403, code: 'FORBIDDEN', key: 'common.notAllowed'},
    {status: 404, code: 'NOT_FOUND', key: 'packing.notFound'}] as const)(
        'uses the native Error/Home card for initial duplicate admission $status', async ({status, code, key}) => {
            const {wrapper, context, request} = await mounted(PackingCreatePage, {}, async () => problem(code, status),
                `/packing/${id}/duplicate`);
            expect(wrapper.get('h1').text()).toBe(context.messages.value.t('common.errorTitle'));
            expect(document.title).toBe(context.messages.value.t('common.errorTitle') + ' | Surveyor');
            expect(wrapper.text()).toContain(context.messages.value.t(key));
            expect(wrapper.get('a.btn').attributes('href')).toBe('/');
            expect(wrapper.find('form').exists()).toBe(false);
            expect(wrapper.find('[data-loading-skeleton]').exists()).toBe(false);
            expect(request).toHaveBeenCalledOnce();

            context.locale.value = 'de';
            await flushPromises();
            expect(wrapper.text()).toContain(context.messages.value.t(key));
            expect(wrapper.get('h1').text()).toBe(context.messages.value.t('common.errorTitle'));
        },
    );

    it.each([['create', 429], ['duplicate', 429], ['create', 503], ['duplicate', 503]] as const)(
        'shows and expires the %s admission retry deadline after HTTP %s without another request', async (mode, status) => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date('2026-10-09T12:00:00Z'));
            const path = mode === 'create' ? '/packing/create' : `/packing/${id}/duplicate`;
            const {wrapper, request} = await mounted(PackingCreatePage, {}, async () =>
                new Response('{}', {status, headers: {'Content-Type': 'application/json',
                        'X-Surveyor-Context': session.context, 'Retry-After': '5'}}), path);

            const retry = button(wrapper, 'Try again');
            expect(retry.attributes('disabled')).toBeDefined();
            expect(wrapper.get('[data-read-retry-at] time').attributes('datetime')).toBe('2026-10-09T12:00:05.000Z');
            expect(wrapper.find('[data-last-successful-refresh]').exists()).toBe(false);
            await vi.advanceTimersByTimeAsync(5001);
            await flushPromises();
            expect(request).toHaveBeenCalledOnce();
            expect(retry.attributes('disabled')).toBeUndefined();
            expect(wrapper.find('[data-read-retry-at]').exists()).toBe(false);
            await retry.trigger('click');
            await flushPromises();
            expect(request).toHaveBeenCalledTimes(2);
            expect(button(wrapper, 'Try again').attributes('disabled')).toBeDefined();
            expect(wrapper.get('[data-read-retry-at] time').attributes('datetime')).toBe('2026-10-09T12:00:10.001Z');
        });

    it('retains the admitted creation receipt, draft and focus through a failed locale admission', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-10-09T12:00:00Z'));
        let unavailable = false;
        const entry: components['schemas']['EntityCreationEntry'] = {entry: {kind: 'render'}, selectedEvent: null,
            context: {defaults, permissions: [], presets: []}};
        const {wrapper, context, request} = await mounted(PackingCreatePage, {}, async function readCreation(): Promise<Response> {
            return unavailable ? new Response('{}', {status: 503, headers: {'Content-Type': 'application/json',
                    'X-Surveyor-Context': session.context, 'Retry-After': '5'}}) : json(entry);
        }, '/packing/create');
        const title = wrapper.get<HTMLInputElement>('#create-title');
        await title.setValue('My creation draft');
        title.element.focus();
        unavailable = true;
        vi.setSystemTime(new Date('2026-10-09T12:01:00Z'));
        context.locale.value = 'de';
        await flushPromises();
        expect(wrapper.get<HTMLInputElement>('#create-title').element).toBe(title.element);
        expect(title.element.value).toBe('My creation draft');
        expect(document.activeElement).toBe(title.element);
        expect(wrapper.get('[data-last-successful-refresh] time').attributes('datetime')).toBe('2026-10-09T12:00:00.000Z');
        expect(wrapper.get('[data-read-retry-at] time').attributes('datetime')).toBe('2026-10-09T12:01:05.000Z');
        expect(wrapper.text()).toContain(context.messages.value.t('state.stale'));
        expect(request).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(5001);
        unavailable = false;
        await button(wrapper, context.messages.value.t('common.retry')).trigger('click');
        await flushPromises();
        expect(wrapper.find('[data-last-successful-refresh]').exists()).toBe(false);
        expect(wrapper.find('[data-read-retry-at]').exists()).toBe(false);
        expect(title.element.value).toBe('My creation draft');
        expect(request.mock.calls.map(([request]) => (request as Request).method)).toEqual(['GET', 'GET', 'GET']);
    });

    it('retires denied creation definitions while keeping the local draft and selected file for fresh restoration', async () => {
        let denied = false;
        let submitted: {data: components['schemas']['PackingCreateInput']; image: string; bytes: string} | undefined;
        const selectedEvent: components['schemas']['EventPickerOption'] = {id: itemId, title: 'Private associated camp',
            startDate: '2026-10-09T12:00:00Z', endDate: '2026-10-10T12:00:00Z', archived: false,
            description: null, deadlinePassed: false};
        const entry: components['schemas']['EntityCreationEntry'] = {entry: {kind: 'render'}, selectedEvent,
            context: {defaults, permissions: [{key: 'EDIT_TITLE', bit: 1}], presets: [{key: 'EDIT_TITLE', mask: 1}]}};
        const {wrapper, context, request} = await mounted(PackingCreatePage, {}, async function readCreation(request): Promise<Response> {
            if (request.method === 'POST') {
                const form = await request.formData();
                const image = form.get('image') as File;
                submitted = {data: JSON.parse(String(form.get('data'))), image: image.name, bytes: await image.text()};
                return problem('VALIDATION_FAILED', 400);
            }
            if (new URL(request.url).pathname.endsWith('/events'))
                return json({items: [], selected: {...selectedEvent, title: 'Fresh authorized camp'}, nextCursor: null});
            return denied ? json({type: 'about:blank', title: 'Unavailable', status: 403,
                detail: 'Creation access is unavailable.', requestId: 'safe-create-denial', code: 'FUTURE_READ_DENIAL'}, 403)
                : json(entry);
        }, '/packing/create?eventId=' + itemId);
        const oldForm = wrapper.get('form');
        expect(wrapper.text()).toContain(selectedEvent.title);
        await wrapper.get('#create-title').setValue('Retained local creation');
        await wrapper.get('tbody input[aria-label="Item 1"]').setValue('Local tent');
        await wrapper.get('#create-defaults-participant-EDIT_TITLE').setValue(true);
        const file = new File(['local image'], 'local.png', {type: 'image/png'});
        const upload = wrapper.get<HTMLInputElement>('#create-header');
        Object.defineProperty(upload.element, 'files', {value: [file]});
        await upload.trigger('change');
        denied = true;
        await context.queryClient.refetchQueries({queryKey: packingKeys.creation(session.context)});
        await flushPromises();
        expect(wrapper.get('form').element).toBe(oldForm.element);
        expect(wrapper.get('form > fieldset').attributes('disabled')).toBeDefined();
        expect(wrapper.get<HTMLInputElement>('#create-header').element).toBe(upload.element);
        expect(upload.element.files?.[0]?.name).toBe('local.png');
        expect(wrapper.get<HTMLInputElement>('#create-title').element.value).toBe('Retained local creation');
        expect(wrapper.find('.perm-matrix').exists()).toBe(false);
        expect(wrapper.findComponent(EventPicker).exists()).toBe(false);
        expect(wrapper.text()).not.toContain(selectedEvent.title);
        expect(wrapper.find('[data-last-successful-refresh]').exists()).toBe(false);
        expect(wrapper.text()).toContain('Creation access is unavailable.');
        const retired = context.queryClient.getQueryCache().findAll({queryKey: packingKeys.creation(session.context)});
        expect(retired.length).toBeGreaterThan(0);
        expect(retired.every(query => query.state.data === undefined)).toBe(true);
        const reads = request.mock.calls.length;
        // A queued event cannot submit the retained draft without fresh definitions.
        await oldForm.trigger('submit');
        await flushPromises();
        expect(request).toHaveBeenCalledTimes(reads);
        expect(submitted).toBeUndefined();

        denied = false;
        await button(wrapper, context.messages.value.t('common.retry')).trigger('click');
        await flushPromises();
        expect(wrapper.get<HTMLInputElement>('#create-title').element.value).toBe('Retained local creation');
        expect(wrapper.get<HTMLInputElement>('tbody input[aria-label="Item 1"]').element.value).toBe('Local tent');
        expect(wrapper.get<HTMLInputElement>('#create-defaults-participant-EDIT_TITLE').element.checked).toBe(true);
        expect(wrapper.get<HTMLInputElement>('#create-header').element).toBe(upload.element);
        expect(upload.element.files?.[0]?.name).toBe('local.png');
        expect(wrapper.get('form > fieldset').attributes('disabled')).toBeUndefined();
        expect(wrapper.text()).toContain('Fresh authorized camp');
        expect(request.mock.calls.every(([request]) => (request as Request).method === 'GET')).toBe(true);
        await wrapper.get('form').trigger('submit');
        await flushPromises();
        await vi.waitFor(() => expect(submitted?.image).toBe('local.png'));
        expect(request.mock.calls.filter(([request]) => (request as Request).method === 'POST')).toHaveLength(1);
        expect(submitted?.data.title).toBe('Retained local creation');
        expect(submitted?.data.defaultPermissions.participant).toBe(1);
        expect(submitted?.data.eventId).toBe(itemId);
        expect(submitted?.data.items[0]?.title).toBe('Local tent');
        expect(submitted?.image).toBe('local.png');
        expect(submitted?.bytes).toBe('local image');
    });

    it('keeps admission Retry separate from Create and retains Create focus through its admission/write handoff', async function ownsCreationInitiator() {
        const retryRead = deferredResponse();
        const submissionRead = deferredResponse();
        const submittedWrite = deferredResponse();
        const entry: components['schemas']['EntityCreationEntry'] = {entry: {kind: 'render'}, selectedEvent: null,
            context: {defaults, permissions: [], presets: []}};
        let reads = 0;
        let writes = 0;

        /** Hold actual feature transport stages independently. Admission Retry
         * must remain read-only; only a later explicit Create may send the draft. */
        async function serveCreation(request: Request): Promise<Response> {
            if (request.method === 'POST') { writes++; return submittedWrite.response; }
            reads++;
            if (reads === 2) return problem('VALIDATION_FAILED', 400);
            if (reads === 3) return retryRead.response;
            if (reads === 4) return submissionRead.response;
            return json(entry);
        }

        const {wrapper, context} = await mounted(PackingCreatePage, {}, serveCreation, '/packing/create');
        await wrapper.get('#create-title').setValue('Retained creation');
        await wrapper.get('tbody input[aria-label="Item 1"]').setValue('Local tent');
        const create = wrapper.get<HTMLButtonElement>('button[type="submit"].btn-success');
        try {
            await wrapper.get('form').trigger('submit');
            await flushPromises();
            expect(reads).toBe(2);
            expect(writes).toBe(0);
            const retry = button(wrapper, context.messages.value.t('common.retry'));
            await retry.trigger('click');
            await flushPromises();
            expect(reads).toBe(3);
            expect(retry.attributes('aria-busy')).toBe('true');
            expect(retry.find('.spinner-border').exists()).toBe(true);
            expect(create.element.disabled).toBe(true);
            expect(create.attributes('aria-busy')).toBe('false');
            expect(create.find('.spinner-border').exists()).toBe(false);

            retryRead.resolve(json(entry));
            await flushPromises();
            expect(writes).toBe(0);
            expect(create.element.disabled).toBe(false);
            create.element.focus();
            const focus = vi.spyOn(create.element, 'focus');
            await wrapper.get('form').trigger('submit');
            await flushPromises();
            expect(reads).toBe(4);
            expect(create.attributes('aria-busy')).toBe('true');
            expect(create.element.disabled).toBe(true);

            // Reproduce native disabled-focus release. The same initiating
            // action must remain pending when admission hands off to its POST.
            document.body.tabIndex = -1;
            document.body.focus();
            document.body.removeAttribute('tabindex');
            submissionRead.resolve(json(entry));
            await vi.waitFor(() => expect(writes).toBe(1));
            await flushPromises();
            expect(create.attributes('aria-busy')).toBe('true');
            expect(create.element.disabled).toBe(true);
            expect(document.activeElement).toBe(document.body);
            expect(focus).not.toHaveBeenCalled();

            submittedWrite.resolve(problem('VALIDATION_FAILED', 400));
            await flushPromises();
            expect(create.element.disabled).toBe(false);
            expect(create.attributes('aria-busy')).toBe('false');
            expect(document.activeElement).toBe(create.element);
            expect(focus).toHaveBeenCalledExactlyOnceWith({preventScroll: true});
            expect(wrapper.get<HTMLInputElement>('#create-title').element.value).toBe('Retained creation');
            expect(wrapper.get<HTMLInputElement>('tbody input[aria-label="Item 1"]').element.value).toBe('Local tent');
            expect([reads, writes]).toEqual([4, 1]);
        } finally {
            retryRead.resolve(json(entry));
            submissionRead.resolve(json(entry));
            submittedWrite.resolve(problem('VALIDATION_FAILED', 400));
        }
    });

    it.each([[429, false], [503, true]] as const)('recovers HTTP %s submission admission with a timed read-only Retry before a separate Create (duplicate: %s)', async (status, duplicate) => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-10-09T12:00:00Z'));
        const entry = {entry: {kind: 'render'}, selectedEvent: null, context: {defaults, permissions: [], presets: []}};
        let reads = 0;
        let writes = 0;
        const {wrapper, context} = await mounted(PackingCreatePage, {}, async function readSubmissionAdmission(request) {
            if (request.method === 'POST') { writes++; return problem('VALIDATION_FAILED', 400); }
            reads++;
            if (reads === 1 && duplicate) return json({title: 'Copied equipment', description: null, eventId: null,
                items: [{title: 'Tent', description: null, maxAssignees: 1, requiredByAll: false}],
                defaultPermissions: defaults, formContext: entry.context, selectedEvent: null});
            if (reads === 2 || reads === 4) return new Response('{}', {status, headers: {'Content-Type': 'application/json',
                    'Retry-After': '5', 'X-Surveyor-Context': session.context}});
            return json(entry);
        }, duplicate ? '/packing/' + id + '/duplicate' : '/packing/create');
        const title = wrapper.get<HTMLInputElement>('#create-title');
        await title.setValue('Retained creation');
        await wrapper.get('tbody input').setValue('Local tent');
        await wrapper.get('form').trigger('submit');
        await flushPromises();
        expect(reads).toBe(2);
        expect(writes).toBe(0);
        expect(wrapper.find('[data-last-successful-refresh]').exists()).toBe(false);
        const retry = button(wrapper, context.messages.value.t('common.retry'));
        expect(wrapper.get('[data-read-retry-at] time').attributes('datetime')).toBe('2026-10-09T12:00:05.000Z');
        expect(retry.attributes('disabled')).toBeDefined();
        await retry.trigger('click');
        expect(reads).toBe(2);
        await vi.advanceTimersByTimeAsync(5001);
        await retry.trigger('click');
        await flushPromises();
        expect(reads).toBe(3);
        expect(writes).toBe(0);
        expect(wrapper.find('[data-read-retry-at]').exists()).toBe(false);
        expect(wrapper.get<HTMLInputElement>('#create-title').element).toBe(title.element);
        expect(title.element.value).toBe('Retained creation');
        expect(wrapper.get<HTMLInputElement>('tbody input').element.value).toBe('Local tent');
        await vi.advanceTimersByTimeAsync(1000);
        await wrapper.get('form').trigger('submit');
        await flushPromises();
        expect(reads).toBe(4);
        expect(writes).toBe(0);
        expect(wrapper.get('[data-last-successful-refresh] time').attributes('datetime')).toBe('2026-10-09T12:00:05.001Z');
        await vi.advanceTimersByTimeAsync(5001);
        await button(wrapper, context.messages.value.t('common.retry')).trigger('click');
        await flushPromises();
        expect(reads).toBe(5);
        expect(writes).toBe(0);
        await wrapper.get('form').trigger('submit');
        await flushPromises();
        expect(reads).toBe(6);
        expect(writes).toBe(1);
    });

    it.each(['', '?eventId=ignored&eventId=also-ignored'])('submits an admitted creation after same-document fragment movement during its preflight read (%s)', async query => {
        const admission = deferredResponse();
        let reads = 0;
        let writes = 0;
        const entry: components['schemas']['EntityCreationEntry'] = {entry: {kind: 'render'}, selectedEvent: null,
            context: {defaults, permissions: [], presets: []}};
        const {wrapper, router} = await mounted(PackingCreatePage, {}, async request => {
            if (request.method === 'POST') {
                writes++;
                return problem('VALIDATION_FAILED', 400);
            }
            if (new URL(request.url).pathname.endsWith('/events')) return json({items: [], selected: null, nextCursor: null});
            reads++;
            return reads === 1 ? json(entry) : admission.response;
        }, '/packing/create' + query);

        await wrapper.get('#create-title').setValue('Entered list');
        await wrapper.get('tbody input[aria-label="Item 1"]').setValue('Tent');
        await wrapper.get('form').trigger('submit');
        await flushPromises();
        expect(reads).toBe(2);
        await router.push('/packing/create' + query + '#form');
        expect(router.currentRoute.value.hash).toBe('#form');
        expect(wrapper.get<HTMLInputElement>('#create-title').element.value).toBe('Entered list');
        expect(wrapper.get<HTMLInputElement>('tbody input[aria-label="Item 1"]').element.value).toBe('Tent');
        admission.resolve(json(entry));
        await flushPromises();
        // Multipart Request construction settles beyond Vue's render queue. Wait
        // for the observable POST, rather than assuming one tick drains its body.
        await vi.waitFor(() => expect(writes).toBe(1));
        expect(wrapper.get<HTMLInputElement>('#create-title').element.value).toBe('Entered list');
    });

    it('retries a failed duplicate admission read without presenting a known denial or submitting a copy', async () => {
        let unavailable = true;
        const duplicate: components['schemas']['PackingDuplicate'] = {title: 'Admitted copy', description: null,
            eventId: null, items: [{title: 'Tent', description: null, maxAssignees: 1, requiredByAll: false}],
            defaultPermissions: defaults, formContext: {defaults, permissions: [], presets: []}};
        const {wrapper, context, request} = await mounted(PackingCreatePage, context => {
            context.queryClient.setDefaultOptions({queries: {retry: false}});
            return {};
        }, async req => {
            if (unavailable) throw new TypeError('Duplicate read unavailable');
            return json(new URL(req.url).pathname.endsWith('/events')
                ? {items: [], nextCursor: null, selected: null} : duplicate);
        }, `/packing/${id}/duplicate`);
        expect(wrapper.get('h1').text()).toBe(context.messages.value.t('packing.create'));
        expect(wrapper.text()).toContain(context.messages.value.t('state.loadFailed'));
        expect(wrapper.find('.frontend-page-message').exists()).toBe(false);
        unavailable = false;
        await button(wrapper, context.messages.value.t('common.retry')).trigger('click');
        await flushPromises();
        expect(wrapper.get<HTMLInputElement>('#create-title').element.value).toBe('Admitted copy');
        expect(wrapper.text()).not.toContain(context.messages.value.t('state.loadFailed'));
        expect(request.mock.calls.map(([req]) => (req as Request).method)).toEqual(['GET', 'GET']);
    });

    it('preserves an already copied draft when a later duplicate source read is denied', async () => {
        let denied = false;
        const duplicate: components['schemas']['PackingDuplicate'] = {title: 'Admitted copy', description: null,
            eventId: null, items: [{title: 'Tent', description: null, maxAssignees: 1, requiredByAll: false}],
            defaultPermissions: defaults, formContext: {defaults, permissions: [], presets: []}};
        const {wrapper, context} = await mounted(PackingCreatePage, {}, async () =>
            denied ? problem('FORBIDDEN', 403) : json(duplicate), `/packing/${id}/duplicate`);
        await wrapper.get('#create-title').setValue('My independent creation draft');
        denied = true;
        await context.queryClient.invalidateQueries({queryKey: packingKeys.duplicate(session.context, id)});
        await flushPromises();
        expect(wrapper.find('.frontend-page-message').exists()).toBe(false);
        expect(wrapper.get<HTMLInputElement>('#create-title').element.value).toBe('My independent creation draft');
        expect(wrapper.findAll('tbody tr')).toHaveLength(1);
        expect(button(wrapper, context.messages.value.t('packing.createList')).attributes('disabled')).toBeUndefined();
    });

    it.each(['failure', 'cancellation'] as const)('retains a confirmed created destination after navigation %s and retries without another POST', async failure => {
        let posts = 0;
        const {wrapper, root, router, context} = await mounted(PackingCreatePage, {}, async request => {
            if (request.method === 'POST') {
                posts++;
                return json({id: otherId}, 201);
            }
            return json(new URL(request.url).pathname.endsWith('/events')
                ? {items: [], nextCursor: null, selected: null}
                : {entry: {kind: 'render'}, context: {defaults, permissions: [], presets: []}});
        }, '/packing/create', session, {}, true);
        const destination = '/packing/' + otherId;
        let rejectNavigation = true;
        router.addRoute({path: destination, component: async function loadCreatedPage() {
                if (failure === 'failure' && rejectNavigation) throw new TypeError('Failed to fetch dynamically imported module');
                return defineComponent({template: '<p>Created destination</p>'});
            }});
        router.beforeEach(to => failure === 'cancellation' && rejectNavigation && to.fullPath === destination ? false : undefined);
        router.onError(() => {});
        await wrapper.get('#create-title').setValue('Confirmed list');
        await wrapper.get('tbody input').setValue('Tent');
        await wrapper.get('form').trigger('submit');
        await flushPromises();
        expect(posts).toBe(1);
        expect(router.currentRoute.value.path).toBe('/packing/create');
        expect(wrapper.get('fieldset').attributes('disabled')).toBeDefined();
        expect(root.get('[data-frontend-notices] .alert-warning').text()).toContain(context.messages.value.t('state.deliveryFailed'));
        expect(root.find('.alert-success').exists()).toBe(false);
        expect(context.updates.requestReload()).toBe(false);
        // Recovery must deliver the confirmed creation instead of reloading its form.
        expect(context.updates.requestRecoveryReload()).toBe(false);

        // Even a programmatic repeated submit cannot create another record. Recovery
        // follows the retained confirmed ID through the generic navigation owner only.
        await wrapper.get('form').trigger('submit');
        expect(posts).toBe(1);
        rejectNavigation = false;
        await button(root.get('[data-frontend-notices] .alert-warning'), context.messages.value.t('common.retry')).trigger('click');
        await flushPromises();
        expect(router.currentRoute.value.fullPath).toBe(destination);
        expect(posts).toBe(1);
    });

    it('retires a native creation denial after committed departure and reads fresh admission on revisit', async () => {
        const path = '/packing/create';
        const {wrapper, router, request} = await mounted(PackingCreatePage, {}, async incoming =>
            json(new URL(incoming.url).pathname.endsWith('/events') ? {items: [], nextCursor: null, selected: null}
                : {entry: {kind: 'render'}, context: {defaults, permissions: [], presets: []}}),
            path, session, {initialUrl: path, packingError: 'common.notAllowed'});
        expect(wrapper.find('form').exists()).toBe(false);
        expect(request).not.toHaveBeenCalled();
        await router.push('/away');
        await router.push(path);
        await flushPromises();
        // The old component wrapper was unmounted. Inspect the newly mounted destination
        // through the real DOM rather than retaining another request's native denial.
        expect(document.querySelector('#create-title')).not.toBeNull();
        expect(request.mock.calls.map(([value]) => new URL((value as Request).url).pathname))
            .toContain('/api/v1/packing-lists/create-entry');
    });

    it.each(['anonymous', 'guest', 'account-without-profile'] as const)('follows account admission from a %s duplicate submission with its exact return and no new discard prompt', async kind => {
        const actor: components['schemas']['SessionView'] = kind === 'account-without-profile'
            ? {...session, kind: 'account', activeProfile: null, profiles: []}
            : kind === 'anonymous' ? {...session, kind: 'anonymous', activeProfile: null, profiles: [], logoutUrl: null}
                : {...session, kind: 'guest'};
        const duplicateUrl = `/packing/${id}/duplicate`;
        const {wrapper, context, router, request} = await mounted(PackingCreatePage, {}, async function entryRequest(request) {
            const url = new URL(request.url);
            if (url.pathname.endsWith('/create-entry')) {
                expect(url.searchParams.get('returnTo')).toBe(duplicateUrl);
                return json({entry: {kind: 'redirect', url: '/users/login?next=' + encodeURIComponent(duplicateUrl),
                        notice: {kind: 'info', messageKey: 'auth.accountRequired'}}, context: null});
            }
            if (url.pathname.endsWith('/events')) return json({items: [], selected: null, nextCursor: null});
            return json({title: 'Duplicate draft', description: null, eventId: null, defaultPermissions: defaults,
                items: [{title: 'Tent', description: null, maxAssignees: 1, requiredByAll: false}],
                formContext: {defaults, permissions: [], presets: []}});
        }, duplicateUrl, actor);
        await wrapper.get('#create-title').setValue('Submitted duplicate draft');
        const confirm = vi.fn(() => false);
        vi.stubGlobal('confirm', confirm);
        await wrapper.get('form').trigger('submit');
        await flushPromises();
        expect(router.currentRoute.value.path).toBe('/users/login');
        expect(router.currentRoute.value.query.next).toBe(duplicateUrl);
        expect(confirm).not.toHaveBeenCalled();
        expect(context.pageNotice.value).toEqual({kind: 'info', messageKey: 'auth.accountRequired'});
        expect(request.mock.calls.filter(([value]) => (value as Request).method === 'POST')).toHaveLength(0);
    });

    it.each(['anonymous', 'guest'] as const)('loads a %s duplicate through SPA navigation without invoking account-only creation context', async kind => {
        const actor: components['schemas']['SessionView'] = kind === 'anonymous'
            ? {...session, kind: 'anonymous', activeProfile: null, profiles: [], logoutUrl: null}
            : {...session, kind: 'guest'};
        const {wrapper, router, request} = await mounted(PackingCreatePage, {}, async req => {
            const path = new URL(req.url).pathname;
            if (!path.endsWith('/duplicate')) throw new Error('Duplicate navigation must use only its admitted read');
            return json({title: path.includes(otherId) ? 'Second admitted copy' : 'First admitted copy',
                description: null, eventId: null, defaultPermissions: defaults,
                items: [{title: 'Bottle', description: null, maxAssignees: 1, requiredByAll: true}],
                formContext: {defaults, permissions: [], presets: []}});
        }, `/packing/${id}/duplicate`, actor);
        expect(wrapper.get<HTMLInputElement>('#create-title').element.value).toBe('First admitted copy');
        await router.push(`/packing/${otherId}/duplicate`);
        await flushPromises();
        expect(wrapper.get<HTMLInputElement>('#create-title').element.value).toBe('Second admitted copy');
        expect(wrapper.get('tbody input[type="checkbox"]').element).toHaveProperty('checked', true);
        expect(request.mock.calls.map(([req]) => new URL((req as Request).url).pathname))
            .toEqual([`/api/v1/packing-lists/${id}/duplicate`, `/api/v1/packing-lists/${otherId}/duplicate`]);
    });

    it('starts a usable duplicate only after unknown creation navigation is acknowledged, without replay', async () => {
        const duplicate: components['schemas']['PackingDuplicate'] = {title: 'Copy equipment', description: 'Shared', eventId: null,
            items: [{title: 'Tent', description: null, maxAssignees: 2, requiredByAll: false}], defaultPermissions: defaults,
            formContext: {defaults, permissions: [], presets: []}};
        const {wrapper, router, request} = await mounted(PackingCreatePage, {}, async req => {
            if (req.method === 'POST') throw new TypeError('Response lost');
            const path = new URL(req.url).pathname;
            if (path.endsWith('/duplicate')) return json(duplicate);
            if (path.endsWith('/events')) return json({items: [], nextCursor: null, selected: null});
            return json({entry: {kind: 'render'}, context: {defaults, permissions: [], presets: []}});
        }, '/packing/create');
        await wrapper.get('#create-title').setValue('Unknown creation');
        await wrapper.get('tbody input').setValue('Sleeping bag');
        await wrapper.get('form').trigger('submit');
        await flushPromises();
        expect(wrapper.get('fieldset').attributes('disabled')).toBeDefined();
        const confirm = vi.fn(() => false);
        vi.stubGlobal('confirm', confirm);
        await router.push(`/packing/${id}/duplicate`);
        expect(router.currentRoute.value.path).toBe('/packing/create');
        expect(wrapper.get<HTMLInputElement>('#create-title').element.value).toBe('Unknown creation');
        expect(wrapper.get('fieldset').attributes('disabled')).toBeDefined();
        confirm.mockReturnValue(true);
        await router.push(`/packing/${id}/duplicate`);
        await flushPromises();
        expect(wrapper.get<HTMLInputElement>('#create-title').element.value).toBe('Copy equipment');
        expect(wrapper.get('fieldset').attributes('disabled')).toBeUndefined();
        expect(request.mock.calls.map(([req]) => req as Request).filter(req => req.method === 'POST')).toHaveLength(1);
        await wrapper.get('form').trigger('submit');
        await flushPromises();
        expect(request.mock.calls.map(([req]) => req as Request).filter(req => req.method === 'POST')).toHaveLength(2);
    });
});

describe('event picker parity', () => {
    const autumn = {id: itemId, title: 'Autumn camp', startDate: '2026-10-07', endDate: '2026-10-08',
        archived: true, description: 'Cabin', deadlinePassed: false};
    const winter = {...autumn, id: otherId, title: 'Winter camp'};

    function pickerSource(search: FrontendEventPickerSource['search']): FrontendEventPickerSource {
        return {search,
            pageKey: (actor, locale, filters, query) => ['fixture-event-source', actor, locale, filters, query],
            filterKey: (actor, locale, filters) => ['fixture-event-source', actor, locale, filters]};
    }

    it('uses its caller-owned discovery and query family without issuing a packing request', async () => {
        const option = {id: itemId, title: 'Autumn camp', startDate: '2026-10-07', endDate: '2026-10-08',
            archived: false, description: null, deadlinePassed: false};
        const search = vi.fn(async () => ({items: [option], selected: null, nextCursor: null}));
        const source: FrontendEventPickerSource = {
            search,
            pageKey: (actor, locale, filters, query) => ['fixture-event-source', actor, locale, filters, query],
            filterKey: (actor, locale, filters) => ['fixture-event-source', actor, locale, filters],
        };
        const {wrapper, context, request} = await mounted(EventPicker, {
            prefix: 'reused', inline: true, modelValue: null, source,
        });
        expect(search).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({archive: 'all', period: 'all'}),
            context.capture(), expect.any(AbortSignal));
        expect(request).not.toHaveBeenCalled();
        expect(context.queryClient.getQueryCache().getAll().map(query => query.queryKey[0]))
            .toEqual(['fixture-event-source']);
        await wrapper.get('[data-event-id="' + itemId + '"]').trigger('click');
        expect(wrapper.emitted('update:modelValue')).toEqual([[itemId]]);
    });

    it('replaces pages, preserves explicit selection through filters, and rejects reversed date ranges locally', async () => {
        const first = {id: itemId, title: 'Autumn camp', startDate: '2026-10-07', endDate: '2026-10-08',
            archived: true, description: 'Cabin', deadlinePassed: false};
        const second = {...first, id: otherId, title: 'Winter camp'};
        const {wrapper, request, update} = await mounted(EventPicker, context => ({
            prefix: 'test', inline: true, modelValue: null, source: usePackingApi(context).eventPicker,
        }), async req => {
            const query = new URL(req.url).searchParams;
            return json({items: query.has('q') ? [] : query.has('cursor') ? [second] : [first],
                nextCursor: query.has('q') || query.has('cursor') ? null : 'page-two',
                selected: query.has('selectedId') ? first : null});
        });
        await wrapper.get('[data-event-id="' + itemId + '"]').trigger('click');
        expect(wrapper.emitted('update:modelValue')).toEqual([[itemId]]);
        await update({modelValue: itemId});
        await flushPromises();
        await button(wrapper, 'Next page').trigger('click');
        await flushPromises();
        expect(wrapper.findAll('[data-event-id]')).toHaveLength(1);
        expect(wrapper.get('[data-event-id]').attributes('data-event-id')).toBe(otherId);
        expect(wrapper.text()).toContain('Current selection: Autumn camp');
        expect(wrapper.text()).toContain('Archived with selected event.');
        await wrapper.get('#test-search').setValue('missing');
        await vi.waitFor(() => expect(wrapper.findAll('[data-event-id]')).toHaveLength(0));
        expect(wrapper.emitted('update:modelValue')).toHaveLength(1);
        await wrapper.get('#test-from').setValue('2026-10-08');
        await flushPromises();
        const before = request.mock.calls.length;
        await wrapper.get('#test-to').setValue('2026-10-07');
        await flushPromises();
        expect(request.mock.calls.length).toBe(before);
        expect(wrapper.get('[role="alert"]').text()).toBe('From must be on or before To.');
    });

    it.each(['next', 'previous'] as const)('retains confirmed results and history after failed %s, then retries that direction', async direction => {
        let rejectPage = false;
        const search = vi.fn(async (query: Parameters<FrontendEventPickerSource['search']>[0]) => {
            if (rejectPage) { rejectPage = false; throw new TypeError('Temporary page failure'); }
            return {items: query.cursor ? [winter] : [autumn], selected: autumn,
                nextCursor: query.cursor ? null : 'page-two'};
        });
        const {wrapper} = await mounted(EventPicker, context => {
            context.queryClient.setDefaultOptions({queries: {retry: false}});
            return {prefix: 'failed-page', inline: true, modelValue: itemId, current: autumn, source: pickerSource(search)};
        });
        if (direction === 'previous') {
            await button(wrapper, 'Next page').trigger('click');
            await flushPromises();
        }

        rejectPage = true;
        await button(wrapper, direction === 'next' ? 'Next page' : 'Previous page').trigger('click');
        await flushPromises();
        expect(wrapper.get('[data-event-id]').attributes('data-event-id')).toBe(direction === 'next' ? itemId : otherId);
        expect(wrapper.get('#failed-page-summary').text()).toContain(direction === 'next' ? 'Page 1' : 'Page 2');
        expect(wrapper.findAll('button').some(candidate => candidate.text() === 'Previous page')).toBe(direction === 'previous');
        expect(wrapper.text()).toContain('Current selection: Autumn camp');
        expect(wrapper.emitted('update:modelValue')).toBeUndefined();
        expect(search).toHaveBeenCalledTimes(direction === 'next' ? 2 : 3);

        await button(wrapper, 'Try again').trigger('click');
        await flushPromises();
        expect(wrapper.get('[data-event-id]').attributes('data-event-id')).toBe(direction === 'next' ? otherId : itemId);
        expect(wrapper.get('#failed-page-summary').text()).toContain(direction === 'next' ? 'Page 2' : 'Page 1');
        expect(search.mock.calls.map(([query]) => query.cursor)).toEqual(direction === 'next'
            ? [undefined, 'page-two', 'page-two'] : [undefined, 'page-two', undefined, undefined]);
    });

    it('retires a pending response immediately on typing, before the debounced replacement read', async () => {
        vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date']});
        const prior = deferredResponse();
        const {wrapper, request} = await mounted(EventPicker, context => ({
            prefix: 'debounce', inline: true, modelValue: null, source: usePackingApi(context).eventPicker,
        }), async req => new URL(req.url).searchParams.has('q')
            ? json({items: [winter], selected: null, nextCursor: null}) : prior.response);

        await wrapper.get('#debounce-search').setValue('Winter');
        prior.resolve(json({items: [autumn], selected: autumn, nextCursor: null}));
        await flushPromises();
        expect(request).toHaveBeenCalledOnce();
        expect(wrapper.find('[data-event-id]').exists()).toBe(false);
        expect(wrapper.text()).not.toContain('Autumn camp');

        await vi.advanceTimersByTimeAsync(200);
        await flushPromises();
        expect(request).toHaveBeenCalledTimes(2);
        expect(wrapper.get('[data-event-id]').attributes('data-event-id')).toBe(otherId);
        expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    });

    it('resumes a retired read when typed search returns to its original text', async () => {
        vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date']});
        const prior = deferredResponse();
        let reads = 0;
        const {wrapper, request} = await mounted(EventPicker, context => ({
            prefix: 'restored-search', inline: true, modelValue: null, source: usePackingApi(context).eventPicker,
        }), async () => ++reads === 1 ? prior.response : json({items: [winter], selected: null, nextCursor: null}));

        await wrapper.get('#restored-search-search').setValue('temporary');
        await vi.advanceTimersByTimeAsync(100);
        await wrapper.get('#restored-search-search').setValue('');
        await vi.advanceTimersByTimeAsync(200);
        await flushPromises();
        expect(request).toHaveBeenCalledTimes(2);
        prior.resolve(json({items: [autumn], selected: autumn, nextCursor: null}));
        await flushPromises();
        expect(wrapper.get('[data-event-id]').attributes('data-event-id')).toBe(otherId);
        expect(wrapper.text()).not.toContain('Autumn camp');
    });

    it('clears filters immediately without a second read from the retired typing timer', async () => {
        vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date']});
        const search = vi.fn(async () => ({items: [autumn], selected: autumn, nextCursor: null}));
        const {wrapper} = await mounted(EventPicker,
            {prefix: 'clear', inline: true, modelValue: itemId, current: autumn, source: pickerSource(search)});
        await wrapper.get('#clear-search').setValue('temporary');
        await button(wrapper, 'Reset filters').trigger('click');
        await flushPromises();
        expect(search).toHaveBeenCalledTimes(2);
        expect(wrapper.get<HTMLInputElement>('#clear-search').element.value).toBe('');
        await vi.advanceTimersByTimeAsync(200);
        await flushPromises();
        expect(search).toHaveBeenCalledTimes(2);
        expect(wrapper.text()).toContain('Current selection: Autumn camp');
        expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    });

    it('reads and polls event choices only while the Linked event settings tab is disclosed', async () => {
        vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date']});
        let eventReads = 0;
        const projection = {...settings, editableFields: ['title' as const],
            capabilities: {...settings.capabilities, linkEvent: true}};
        const {wrapper} = await mounted(PackingSettings, {listId: id, metadataAvailable: true}, async req => {
            const path = new URL(req.url).pathname;
            if (path.endsWith('/events')) { eventReads++; return json({items: [autumn], selected: null, nextCursor: null}); }
            if (path.endsWith('/metadata')) return json({entityType: 'packing', id, values: {title: 'Equipment'},
                editableFields: ['title'], currentEventId: null, archived: false, inheritedArchived: false});
            return json(projection);
        });
        expect(wrapper.get('#frontend-settings-tab-general').attributes('aria-selected')).toBe('true');
        expect(wrapper.get('#frontend-settings-event').isVisible()).toBe(false);
        await vi.advanceTimersByTimeAsync(65_000);
        expect(eventReads).toBe(0);

        await button(wrapper, 'Linked event').trigger('click');
        await flushPromises();
        expect(eventReads).toBe(1);
        await vi.advanceTimersByTimeAsync(35_000);
        expect(eventReads).toBe(2);
        await button(wrapper, 'General').trigger('click');
        await vi.advanceTimersByTimeAsync(65_000);
        expect(eventReads).toBe(2);
    });

    it('cancels a hidden tab read and ignores its late response before the tab reopens', async () => {
        const prior = deferredResponse();
        let reads = 0;
        const signals: AbortSignal[] = [];
        const {wrapper, update} = await mounted(EventPicker, context => ({
            prefix: 'disclosure', inline: true, active: true, modelValue: null, source: usePackingApi(context).eventPicker,
        }), async req => {
            if (++reads === 1) { signals.push(req.signal); return prior.response; }
            return json({items: [winter], selected: null, nextCursor: null});
        });
        await update({active: false});
        expect(signals[0].aborted).toBe(true);
        prior.resolve(json({items: [autumn], selected: autumn, nextCursor: null}));
        await flushPromises();
        expect(wrapper.find('[data-event-id]').exists()).toBe(false);
        expect(reads).toBe(1);
        await update({active: true});
        await flushPromises();
        expect(reads).toBe(2);
        expect(wrapper.get('[data-event-id]').attributes('data-event-id')).toBe(otherId);
    });

    it('prevents Enter in inline event search from submitting the enclosing settings form', async () => {
        let writes = 0;
        const projection = {...settings, capabilities: {...settings.capabilities, linkEvent: true}};
        const {wrapper} = await mounted(PackingSettings, {listId: id}, async req => {
            if (req.method !== 'GET') writes++;
            return json(new URL(req.url).pathname.endsWith('/events')
                ? {items: [autumn], selected: null, nextCursor: null} : projection);
        });
        const confirm = vi.fn(() => true);
        vi.stubGlobal('confirm', confirm);
        const enter = new KeyboardEvent('keydown', {key: 'Enter', bubbles: true, cancelable: true});
        wrapper.get('#settings-search').element.dispatchEvent(enter);
        await flushPromises();
        expect(enter.defaultPrevented).toBe(true);
        expect(confirm).not.toHaveBeenCalled();
        expect(writes).toBe(0);
    });

    it('deduplicates rows, navigates empty batches and retains at most one page with bounded confirmed history', async () => {
        const search = vi.fn(async (query: Parameters<FrontendEventPickerSource['search']>[0]) => {
            const page = Number(query.cursor ?? 1);
            const option = {...autumn, title: 'Camp page ' + page};
            return {items: page === 1 ? [] : [option, option], selected: autumn,
                nextCursor: page < 105 ? String(page + 1) : null};
        });
        const {wrapper} = await mounted(EventPicker,
            {prefix: 'bounded', inline: true, modelValue: itemId, current: autumn, source: pickerSource(search)});
        expect(wrapper.find('[data-event-id]').exists()).toBe(false);
        expect(wrapper.get('#bounded-summary').text()).toContain('More results are available');
        for (let page = 2; page <= 105; page++) {
            await button(wrapper, 'Next page').trigger('click');
            await flushPromises();
            expect(wrapper.findAll('[data-event-id]')).toHaveLength(1);
        }
        expect(wrapper.get('#bounded-summary').text()).toContain('Page 105');
        for (let page = 104; page >= 6; page--) {
            await button(wrapper, 'Previous page').trigger('click');
            await flushPromises();
        }
        expect(wrapper.get('#bounded-summary').text()).toContain('Page 6');
        expect(wrapper.findAll('button').some(candidate => candidate.text() === 'Previous page')).toBe(false);
        expect(wrapper.findAll('[data-event-id]')).toHaveLength(1);
        expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    }, 10_000);

    it.each(['locale', 'actor'] as const)('ignores a late response belonging to the previous %s', async change => {
        let finish!: (value: components['schemas']['EventPickerOptions']) => void;
        const prior = new Promise<components['schemas']['EventPickerOptions']>(resolve => { finish = resolve; });
        const search = vi.fn(async (_query: Parameters<FrontendEventPickerSource['search']>[0], scope) =>
            scope.locale === 'en' && scope.context === session.context
                ? prior : {items: [winter], selected: null, nextCursor: null});
        const {wrapper, context} = await mounted(EventPicker,
            {prefix: 'scope', inline: true, modelValue: itemId, current: autumn, source: pickerSource(search)});
        if (change === 'locale') context.locale.value = 'de';
        else context.session.value = {...session, context: 'new-picker-actor-context-1234567890'};
        await flushPromises();
        finish({items: [autumn], selected: autumn, nextCursor: null});
        await flushPromises();
        expect(wrapper.get('[data-event-id]').attributes('data-event-id')).toBe(otherId);
        expect(wrapper.text()).not.toContain('Autumn camp');
        expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    });

    it('settles an authoritative null selection once while closed, without recurring hidden discovery', async () => {
        vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date']});
        const search = vi.fn(async () => ({items: [], selected: null, nextCursor: null}));
        const {wrapper, update, context} = await mounted(EventPicker,
            {prefix: 'closed-null', modelValue: itemId, current: autumn, source: pickerSource(search)});
        expect(search).not.toHaveBeenCalled();
        await update({current: null});
        await flushPromises();
        expect(search).toHaveBeenCalledOnce();
        await context.queryClient.refetchQueries({type: 'active'});
        await vi.advanceTimersByTimeAsync(65_000);
        expect(search).toHaveBeenCalledOnce();
        expect(wrapper.text()).not.toContain('Autumn camp');
        expect(wrapper.props()).toMatchObject({modelValue: itemId});
        expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    });

    it('preserves selected authority when a session refresh keeps the same actor and generation', async () => {
        const search = vi.fn(async () => ({items: [autumn], selected: autumn, nextCursor: null}));
        const {wrapper, context} = await mounted(EventPicker,
            {prefix: 'same-actor', inline: true, modelValue: itemId, source: pickerSource(search)});
        context.session.value = {...session, shell: {...session.shell, version: 'refreshed-shell'}};
        await flushPromises();
        expect(search).toHaveBeenCalledOnce();
        expect(wrapper.text()).toContain('Current selection: Autumn camp');
        expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    });

    it('disposes an outstanding discovery when its route leaves and ignores the late response', async () => {
        const prior = deferredResponse();
        const signals: AbortSignal[] = [];
        const {root, router, request} = await mounted(EventPicker, context => ({
            prefix: 'disposed', inline: true, modelValue: null, source: usePackingApi(context).eventPicker,
        }), async req => { signals.push(req.signal); return prior.response; });
        await router.push('/away');
        expect(signals[0].aborted).toBe(true);
        prior.resolve(json({items: [autumn], selected: autumn, nextCursor: null}));
        await flushPromises();
        expect(request).toHaveBeenCalledOnce();
        expect(root.findComponent(EventPicker).exists()).toBe(false);
        expect(root.text()).toBe('Away');
    });

    it.each([429, 503])('keeps the actual picker receipt and retry deadline through HTTP %s pagination recovery', async status => {
        vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date']});
        vi.setSystemTime(new Date('2026-10-09T12:00:00Z'));
        let rejectPage = true;
        const search = vi.fn(async (query: Parameters<FrontendEventPickerSource['search']>[0]) => {
            if (query.cursor && rejectPage) { rejectPage = false; throw new ApiFailure(status, null, 60_000); }
            return {items: query.cursor ? [winter] : [autumn], selected: autumn,
                nextCursor: query.cursor ? null : 'page-two'};
        });
        const {wrapper} = await mounted(EventPicker,
            {prefix: 'cooldown', inline: true, modelValue: itemId, current: autumn, source: pickerSource(search)});
        await button(wrapper, 'Next page').trigger('click');
        await flushPromises();
        expect(wrapper.get('[data-event-id]').attributes('data-event-id')).toBe(itemId);
        expect(button(wrapper, 'Try again').attributes('disabled')).toBeDefined();
        expect(wrapper.get('[data-last-successful-refresh] time').attributes('datetime')).toBe('2026-10-09T12:00:00.000Z');
        expect(wrapper.get('[data-read-retry-at] time').attributes('datetime')).toBe('2026-10-09T12:01:00.000Z');
        await button(wrapper, 'Try again').trigger('click');
        await vi.advanceTimersByTimeAsync(59_999);
        expect(search).toHaveBeenCalledTimes(2);
        expect(wrapper.get('[data-last-successful-refresh] time').attributes('datetime')).toBe('2026-10-09T12:00:00.000Z');
        await vi.advanceTimersByTimeAsync(1);
        await flushPromises();
        expect(search).toHaveBeenCalledTimes(3);
        expect(wrapper.get('[data-event-id]').attributes('data-event-id')).toBe(otherId);
        expect(wrapper.find('[data-last-successful-refresh]').exists()).toBe(false);
        expect(wrapper.find('[data-read-retry-at]').exists()).toBe(false);
        expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    });

    it.each([false, true])('retires denied discovery receipts while keeping independent parent title authority (%s)', async parentReadable => {
        let denied = false;
        const {wrapper, context} = await mounted(EventPicker, current => ({prefix: 'denied-discovery', inline: true,
            modelValue: itemId, current: parentReadable ? autumn : null, source: usePackingApi(current).eventPicker}),
            async function readDiscovery(): Promise<Response> {
                return denied ? problem('FORBIDDEN', 403) : json({items: [autumn], selected: autumn, nextCursor: 'next'});
            });
        expect(wrapper.text()).toContain('Autumn camp');
        denied = true;
        // Fail the same observed key: gcTime cannot remove its previous response
        // while this mounted picker still owns that query and its recovery button.
        await context.queryClient.refetchQueries({queryKey: packingKeys.events(session.context)});
        await flushPromises();
        expect(wrapper.find('[data-event-id]').exists()).toBe(false);
        expect(wrapper.find('[data-last-successful-refresh]').exists()).toBe(false);
        expect(wrapper.text()).toContain(parentReadable ? 'Current selection: Autumn camp' : 'Current selection: Current event');
        expect(wrapper.emitted('update:modelValue')).toBeUndefined();
        expect(context.ready.value).toBe(true);
        expect(context.session.value?.context).toBe(session.context);
        const retired = context.queryClient.getQueriesData({queryKey: packingKeys.events(session.context)});
        expect(retired.length).toBeGreaterThan(0);
        expect(retired.every(([, value]) => value === undefined)).toBe(true);
        denied = false;
        await button(wrapper, context.messages.value.t('common.retry')).trigger('click');
        await flushPromises();
        expect(wrapper.get('[data-event-id]').attributes('data-event-id')).toBe(itemId);
        expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    });
});
