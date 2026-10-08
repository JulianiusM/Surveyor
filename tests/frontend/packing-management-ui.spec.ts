// @vitest-environment happy-dom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {flushPromises, mount} from '@vue/test-utils';
import {defineComponent, nextTick, reactive, type Component} from 'vue';
import {createMemoryHistory, createRouter} from 'vue-router';
import {VueQueryPlugin} from '@tanstack/vue-query';
import I18NextVue from 'i18next-vue';
import {createPilotContext, observeInitialDocument, pilotContextKey} from '../../src/frontend/app/context';
import App from '../../src/frontend/app/App.vue';
import InlineCell from '../../src/frontend/components/InlineCell.vue';
import PackingPage from '../../src/frontend/features/packing/PackingPage.vue';
import PackingEntry from '../../src/frontend/features/packing/PackingEntry.vue';
import PackingSettings from '../../src/frontend/features/packing/PackingSettings.vue';
import MetadataFields from '../../src/frontend/features/packing/MetadataFields.vue';
import PackingCreatePage from '../../src/frontend/features/packing/PackingCreatePage.vue';
import EventPicker from '../../src/frontend/components/EventPicker.vue';
import OverviewCard from '../../src/frontend/features/overview/OverviewCard.vue';
import OverviewRegion from '../../src/frontend/features/overview/OverviewRegion.vue';
import type {components} from '../../src/types/api/v1';
import type {PilotContext, PilotEventPickerSource} from '../../src/types/FrontendPilotUiTypes';
import type {FrontendPilotBootstrap} from '../../src/types/FrontendPilotTypes';
import {usePackingApi} from '../../src/frontend/features/packing/api';
import {overviewKeys, packingKeys} from '../../src/frontend/app/queryKeys';

const id = '11111111-1111-4111-8111-111111111111';
const itemId = '22222222-2222-4222-8222-222222222222';
const otherId = '33333333-3333-4333-8333-333333333333';
const session: components['schemas']['SessionView'] = {
    kind: 'account', deployment: {buildId: 'fixture', apiCompatibility: 'v1-pilot-2026-10-07'}, context: 'packing-ui-context-1234567890', csrfToken: 'packing-ui-csrf-1234567890', locale: 'en',
    activeProfile: {id, name: 'Organizer'}, profiles: [{id, name: 'Organizer'}], loginUrl: '/users/login', logoutUrl: '/users/logout',
    shell: {version: 'test', imprintUrl: '/imprint', privacyPolicyUrl: '/privacy', localLoginEnabled: true, oidcEnabled: false, oidcName: 'SSO'},
};
const defaults = {participant: 0, guest: 0, authenticated: 0, public: 0};
const settings: components['schemas']['PackingSettings'] = {
    id, title: 'Equipment', headerUrl: null, headerVersion: null, settingsToken: '"edit-settings-original"',
    editableFields: [], currentEvent: null, access: null,
    archive: {direct: false, inherited: false, archivedAt: null, autoArchivePaused: false, eventUrl: null},
    capabilities: {editHeader: false, linkEvent: false, managePermissions: false, duplicate: false,
        remove: false, archive: false, restore: false, manageArchive: false},
};
const item: components['schemas']['PackingItemView'] = {
    id: itemId, title: 'Tent', description: null, position: 0, requiredByAll: false,
    maxAssignees: 2, assignedCount: 0, selfAssigned: false, assignees: [], editToken: '"edit-item-original"',
    capabilities: {editTitle: true, editDescription: false, editCapacity: false, editRequired: false, removeItem: false, removeAssignments: false},
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
        code, messageKey: 'api:errors.' + code, params: {}}, status);
}
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = ''; });

/** Only the HTTP boundary is replaced. Components, validators, commands and query state are real. */
async function mounted(component: Component, props: Record<string, unknown> | ((context: PilotContext) => Record<string, unknown>) = {},
    handler: (request: Request) => Promise<Response> = async () => json(list),
    path = '/frontend-pilot/packing/' + id, initialSession = session,
    initial: Omit<FrontendPilotBootstrap, 'session'> = {}, withShell = false) {
    const request = vi.fn((input: RequestInfo | URL) => handler(input as Request));
    const context = createPilotContext({...initial, session: initialSession}, true, request);
    context.hydrated.value = true;
    const componentProps = reactive(typeof props === 'function' ? props(context) : {...props});
    const router = createRouter({history: createMemoryHistory(), routes: [
        {name: 'packing-test-overview', path: '/frontend-pilot', component, props: () => componentProps},
        {path: '/frontend-pilot/packing/create', component, props: () => componentProps},
        {path: '/frontend-pilot/packing/:listId/duplicate', component, props: () => componentProps},
        {path: '/frontend-pilot/packing/:listId', component, props: () => componentProps},
        {path: '/frontend-pilot/users/login', component: defineComponent({template: '<p>Login destination</p>'})},
        {path: '/frontend-pilot/help', component: defineComponent({template: '<p>Help destination</p>'})},
        {path: '/away', component: defineComponent({template: '<p>Away</p>'})},
    ]});
    await router.push(path);
    const stopInitialDocument = observeInitialDocument(context, router);
    const root = mount(withShell ? App : defineComponent({template: '<RouterView />'}), {attachTo: document.body, global: {
        plugins: [router, [VueQueryPlugin, {queryClient: context.queryClient}], [I18NextVue, {i18next: context.i18next}]],
        provide: {[pilotContextKey as symbol]: context},
        stubs: {AppDialog: defineComponent({template: '<section role="dialog"><slot name="navigation" /><slot /><slot name="footer" /></section>'})},
    }});
    await flushPromises();
    const wrapper = root.findComponent(component);
    cleanups.push(async () => { root.unmount(); stopInitialDocument(); await context.queryClient.cancelQueries(); context.queryClient.clear(); });
    async function update(values: Record<string, unknown>) { Object.assign(componentProps, values); await nextTick(); }
    return {root, wrapper, context, router, request, update};
}
function button(wrapper: ReturnType<typeof mount>, label: string) {
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

describe('packing route title ownership', () => {
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
});

describe('progressive packing loading', () => {
    const metadata: components['schemas']['PackingMetadata'] = {entityType: 'packing', id,
        values: {title: 'Original'}, editableFields: ['title'], currentEventId: null,
        archived: false, inheritedArchived: false};
    const projection: components['schemas']['PackingSettings'] = {...settings, title: 'Original',
        editableFields: ['title'], capabilities: {...settings.capabilities, editHeader: true}};
    const formContext: components['schemas']['PackingCreateContext'] = {defaults, permissions: [], presets: []};

    it('replaces the missing table once and preserves a quick-add draft while its locale read is pending', async () => {
        const first = deferredResponse();
        const localized = deferredResponse();
        const other = deferredResponse();
        let reads = 0;
        const {wrapper, context, router} = await mounted(PackingPage, {}, async function readList() {
            reads++;
            return reads === 1 ? first.response : reads === 2 ? localized.response : other.response;
        });
        expect(wrapper.get('[data-loading-skeleton="table"]').exists()).toBe(true);
        expect(wrapper.find('table').exists()).toBe(false);
        expect(wrapper.get('section.card').attributes('aria-busy')).toBe('false');

        first.resolve(json(list));
        await flushPromises();
        expect(wrapper.find('[data-loading-skeleton]').exists()).toBe(false);
        expect(wrapper.get('[data-item-id]').text()).toContain('Tent');
        await wrapper.get('#quick-title').setValue('Local stove');
        const input = wrapper.get<HTMLInputElement>('#quick-title').element;
        input.focus();

        context.locale.value = 'de';
        await flushPromises();
        expect(reads).toBe(2);
        expect(wrapper.get('section.card').attributes('aria-busy')).toBe('true');
        expect(wrapper.find('[data-loading-skeleton]').exists()).toBe(false);
        expect(wrapper.get<HTMLInputElement>('#quick-title').element).toBe(input);
        expect(input.value).toBe('Local stove');
        expect(document.activeElement).toBe(input);
        localized.resolve(json(list));
        await flushPromises();

        // A different list cannot borrow this authorized projection. Navigation
        // still uses the existing draft acknowledgement before clearing its form.
        vi.stubGlobal('confirm', () => true);
        await router.push('/frontend-pilot/packing/' + otherId);
        await flushPromises();
        expect(wrapper.get('[data-loading-skeleton="table"]').exists()).toBe(true);
        expect(wrapper.find('[data-item-id]').exists()).toBe(false);
        other.resolve(json({...list, id: otherId, title: 'Other list'}));
        await flushPromises();
    });

    it('keeps same-list content after a failed locale read and removes it on confirmed denial', async () => {
        let reads = 0;
        let forbidden = false;
        const {wrapper, context} = await mounted(PackingPage, {}, async function readList() {
            reads++;
            if (reads === 1) return json(list);
            if (forbidden) return problem('FORBIDDEN', 403);
            throw new TypeError('Read response unavailable');
        });
        await wrapper.get('#quick-title').setValue('Retained stove');
        context.locale.value = 'de';
        await vi.waitFor(() => expect(wrapper.text()).toContain(context.messages.value.t('state.stale')), {timeout: 5000});
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
    }, 10_000);

    it('renders authorized metadata before unrelated settings finish without replacing its local draft', async () => {
        const delayed = deferredResponse();
        const {wrapper, request} = await mounted(PackingSettings, {listId: id, metadataAvailable: true},
            async function readEditor(request) {
                return new URL(request.url).pathname.endsWith('/settings') ? delayed.response : json(metadata);
            });
        expect(request.mock.calls.map(([value]) => new URL((value as Request).url).pathname))
            .toEqual(expect.arrayContaining([`/api/v1/packing-lists/${id}/settings`, `/api/v1/packing-lists/${id}/metadata`]));
        expect(wrapper.get('[name="title"]').exists()).toBe(true);
        expect(wrapper.get('[data-loading-skeleton="form"]').exists()).toBe(true);
        expect(wrapper.get('#pilot-settings-general').attributes('role')).toBeUndefined();
        await wrapper.get('[name="title"]').setValue('Local properties');
        const input = wrapper.get<HTMLInputElement>('[name="title"]').element;

        delayed.resolve(json(projection));
        await flushPromises();
        expect(wrapper.find('[data-loading-skeleton]').exists()).toBe(false);
        expect(wrapper.get('#pilot-settings-general').attributes('role')).toBe('tabpanel');
        expect(wrapper.get<HTMLInputElement>('[name="title"]').element).toBe(input);
        expect(wrapper.get<HTMLInputElement>('[name="title"]').element.value).toBe('Local properties');
        expect(wrapper.get('input[type="file"]').exists()).toBe(true);
    });

    it('renders available header controls while the independent metadata form is still loading', async () => {
        const delayed = deferredResponse();
        const {wrapper} = await mounted(PackingSettings, {listId: id, metadataAvailable: true},
            async function readEditor(request) {
                return new URL(request.url).pathname.endsWith('/metadata') ? delayed.response : json(projection);
            });
        expect(wrapper.get('input[type="file"]').attributes('disabled')).toBeUndefined();
        expect(wrapper.get('[data-loading-skeleton="form"]').exists()).toBe(true);
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

    it.each([false, true])('uses the admitted form skeleton without inventing copied rows (duplicate: %s)', async duplicate => {
        const delayed = deferredResponse();
        const path = duplicate ? `/frontend-pilot/packing/${id}/duplicate` : '/frontend-pilot/packing/create';
        const {wrapper} = await mounted(PackingCreatePage, {}, async () => delayed.response, path);
        const initialForm = 'section.card > .card-body > [data-loading-skeleton="form"]';
        expect(wrapper.get(initialForm).exists()).toBe(true);
        expect(wrapper.find('form').exists()).toBe(false);
        delayed.resolve(json(duplicate ? {title: 'Empty source', description: null, eventId: null,
            items: [], defaultPermissions: defaults, formContext} : {entry: {kind: 'render'}, context: formContext}));
        await flushPromises();
        expect(wrapper.find(initialForm).exists()).toBe(false);
        expect(wrapper.get('#create-title').exists()).toBe(true);
        expect(wrapper.findAll('tbody tr')).toHaveLength(duplicate ? 0 : 1);
    });

    it('reports a failed first metadata read with reachable recovery rather than an endless placeholder', async () => {
        let recovered = false;
        const {wrapper} = await mounted(MetadataFields, {listId: id}, async function readMetadata() {
            if (!recovered) throw new TypeError('Initial metadata response unavailable');
            return json(metadata);
        });
        await vi.waitFor(() => expect(wrapper.text()).toContain('This page could not be loaded.'), {timeout: 5000});
        expect(wrapper.find('[data-loading-skeleton]').exists()).toBe(false);
        expect(wrapper.find('form').exists()).toBe(false);
        recovered = true;
        await button(wrapper, 'Refresh').trigger('click');
        await flushPromises();
        expect(wrapper.get('[name="title"]').exists()).toBe(true);
    }, 10_000);
});

describe('inline packing drafts', () => {
    it('validates and commits numeric input through the string draft boundary', async () => {
        const save = vi.fn(async () => true);
        const {wrapper} = await mounted(InlineCell, {value: 1, token: '"old"', editable: true, numeric: true, label: 'Capacity', save});
        await wrapper.get('td').trigger('dblclick');
        await wrapper.get('input').setValue('0');
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
        await update({editable: false});
        expect(context.mayChangeIdentity()).toBe(true);
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
        expect(wrapper.emitted('editing')).toEqual([[true], [false]]);
    });
});

describe('metadata conflict acknowledgement', () => {
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
        expect(button(wrapper, 'Save properties').attributes('disabled')).toBeDefined();
        await wrapper.get('form').trigger('submit');
        expect(request.mock.calls.map(([value]) => (value as Request).method)).toEqual(['GET']);
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
        context.queryClient.setQueryData(packingKeys.metadata(session.context, id, 'en'), {
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
        context.queryClient.setQueryData(packingKeys.metadata(session.context, id, 'en'),
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
        context.queryClient.setQueryData(packingKeys.metadata(session.context, id, 'en'),
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
        url: '/frontend-pilot/packing/' + id, headerUrl: null, headerVersion: null, eventContext: null,
        visibility: 'default', overviewHidden: true, archived: true, inheritedArchived: true,
        capabilities: {archive: true, restore: false, duplicate: true, remove: true}, children: null,
    };

    it('offers both explicit preferences for default placement and keeps archive state separate', async () => {
        const {wrapper, update} = await mounted(OverviewCard, {card});
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
        const {wrapper, context, update} = await mounted(OverviewCard, {card});
        expect(wrapper.get('.badge.bg-primary').text()).toBe('packing');
        context.locale.value = 'de';
        await nextTick();
        expect(wrapper.get('.badge.bg-primary').text()).toBe('Packliste');
        expect(wrapper.attributes('data-type')).toBe('packing');
        expect(wrapper.get('a.card-body').attributes('href')).toBe(card.url);
        await update({card: {...card, type: 'event', url: '/event/' + id}});
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
        const {wrapper} = await mounted(OverviewCard, {card});
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
            async () => json(region), '/frontend-pilot?owner_main_q=equipment&owner_main_event=' + otherId + '&owner_main_childPage=2&participant_main_q=other');
        expect(wrapper.get('.entity-overview-children').text()).toContain('Linked entities 3–3 of 3');
        expect(wrapper.get('.entity-overview-children').text()).toContain('Administrable entities · 3 linked entities');
        expect(wrapper.text()).toContain('Parent details');
        expect(wrapper.get(`article[data-id="${otherId}"]`).text()).toContain('Hidden for me');
        expect(wrapper.get(`a[href="/event/${otherId}"]`).exists()).toBe(true);
        await button(wrapper, 'Previous').trigger('click');
        await flushPromises();
        expect(router.currentRoute.value.query.owner_main_childPage).toBe('1');
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
            if (type === 'survey') return json({...region, type, matchingEntities: 1, totalCards: 1, items: [survey]});
            return json(region);
        }, '/frontend-pilot?participant_main_q=other');
        const initial = new URL((request.mock.calls[0]![0] as Request).url);
        expect(initial.searchParams.has('type')).toBe(false);
        expect(wrapper.findAll('article[data-type]').map(item => item.attributes('data-type'))).toEqual(['event', 'survey']);
        expect(wrapper.text()).toContain('4 matching entities');
        expect(wrapper.text()).not.toContain('No entities match');
        expect(button(wrapper, 'Show linked entities (2)').exists()).toBe(true);

        await router.push({path: '/frontend-pilot', query: {...router.currentRoute.value.query,
            owner_main_page: '2', owner_main_childPage: '3'}});
        await flushPromises();
        await wrapper.get('input[type="search"]').setValue('equipment');
        await wrapper.get('select').setValue('survey');
        await flushPromises();
        expect(router.currentRoute.value.query).toEqual({participant_main_q: 'other', owner_main_q: 'equipment', owner_main_type: 'survey'});
        expect(new URL((request.mock.calls.at(-1)![0] as Request).url).searchParams.get('type')).toBe('survey');
        expect(wrapper.findAll('article[data-type]').map(item => item.attributes('data-type'))).toEqual(['survey']);
        expect(wrapper.text()).toContain('1 matching entity');
        await button(wrapper, 'Clear filters').trigger('click');
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
        const {wrapper, context} = await mounted(OverviewRegion, {collection: 'owner', region: 'main'}, async () => json(region), '/frontend-pilot');
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
        '/frontend-pilot?owner_main_type=survey&participant_main_q=other');
        expect(wrapper.get<HTMLSelectElement>('select').element.value).toBe('survey');
        expect(wrapper.text()).toContain('No entities match your search and filter.');
        await button(wrapper, 'Clear filters').trigger('click');
        await flushPromises();
        expect(router.currentRoute.value.query).toEqual({participant_main_q: 'other'});
        expect(wrapper.text()).toContain('All your entities in this collection are in Archived and hidden below.');
    });
});

describe('packing command forms', () => {
    it.each(['defaults', 'event', 'admin'] as const)('retains confirmed %s values without adopting stale authority after a failed read', async editor => {
        const choice = {id: itemId, title: 'Chosen camp', startDate: '2026-10-07', endDate: '2026-10-08',
            archived: false, description: null, deadlinePassed: false};
        let projection: components['schemas']['PackingSettings'] = {...settings,
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
            await wrapper.get('#pilot-settings-tab-event').trigger('click');
            await wrapper.get('[data-event-id="' + itemId + '"]').trigger('click');
            await wrapper.get('#pilot-settings-event form').trigger('submit');
        } else {
            await wrapper.get('#pilot-settings-tab-access').trigger('click');
            if (editor === 'defaults') {
                await wrapper.get('#settings-defaults-participant-EDIT_TITLE').setValue(true);
                await wrapper.get('#pilot-access-defaults').trigger('submit');
            } else {
                await wrapper.get('#pilot-access-admins-tab').trigger('click');
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
            await wrapper.get('#pilot-access-defaults').trigger('submit');
        } else if (editor === 'admin') {
            await wrapper.get('#admin-' + otherId + '-EDIT_TITLE').setValue(false);
            await button(wrapper, 'Save').trigger('click');
        } else await wrapper.get('#pilot-settings-event form').trigger('submit');
        await flushPromises();
        expect(writes[1]?.token).toBe(editor === 'admin' ? '"edit-admin-current"' : '"edit-current"');
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
        await wrapper.get('#pilot-access-defaults').trigger('submit');
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
        router.addRoute({name: 'packing-test-overview', path: '/frontend-pilot',
            component: defineComponent({template: '<p>Overview destination</p>'})});
        await wrapper.get('#quick-title').setValue('Parent draft');
        await button(wrapper, 'Entity settings').trigger('click');
        await flushPromises();
        await wrapper.get('#settings-defaults-participant-EDIT_TITLE').setValue(true);
        await wrapper.get('#pilot-settings-tab-actions').trigger('click');

        // A prompt after DELETE would be too late. Make such a prompt fail so the
        // accepted case proves that the whole root decision happens before the write.
        const confirm = vi.fn(() => deletes === 0 && approve);
        vi.stubGlobal('confirm', confirm);
        await button(wrapper, 'Delete permanently').trigger('click');
        await flushPromises();
        expect(deletes).toBe(approve ? 1 : 0);
        expect(confirm.mock.calls.map(([message]) => message)).toEqual(approve
            ? ['Discard changes?', 'Delete this entity permanently? This cannot be undone.']
            : ['Discard changes?']);
        if (approve) expect(router.currentRoute.value.path).toBe('/frontend-pilot');
        else {
            expect(router.currentRoute.value.path).toBe('/frontend-pilot/packing/' + id);
            expect(wrapper.get<HTMLInputElement>('#quick-title').element.value).toBe('Parent draft');
            expect(wrapper.get<HTMLInputElement>('#settings-defaults-participant-EDIT_TITLE').element.checked).toBe(true);
        }
    });

    it('keeps confirmed deletion navigation retryable after delivery failure without another DELETE or discard prompt', async () => {
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
        let failNavigation = true;
        router.addRoute({name: 'packing-test-overview', path: '/frontend-pilot', component: async function loadOverview() {
            if (failNavigation) throw new TypeError('Failed to fetch dynamically imported module');
            return defineComponent({template: '<p>Overview destination</p>'});
        }});
        router.onError(() => {});
        await wrapper.get('#quick-title').setValue('Parent draft');
        await button(wrapper, 'Entity settings').trigger('click');
        await flushPromises();
        await wrapper.get('#settings-defaults-participant-EDIT_TITLE').setValue(true);
        await wrapper.get('#pilot-settings-tab-actions').trigger('click');
        const confirm = vi.fn(() => deletes === 0);
        vi.stubGlobal('confirm', confirm);
        await button(wrapper, 'Delete permanently').trigger('click');
        await flushPromises();
        expect(deletes).toBe(1);
        expect(confirm).toHaveBeenCalledTimes(2);
        expect(router.currentRoute.value.path).toBe('/frontend-pilot/packing/' + id);
        expect(wrapper.findComponent(PackingSettings).exists()).toBe(true);
        expect(button(wrapper, 'Delete permanently').attributes('disabled')).toBeDefined();
        expect(button(wrapper, 'Close').attributes('disabled')).toBeDefined();

        failNavigation = false;
        await button(wrapper, 'Try again').trigger('click');
        await flushPromises();
        expect(router.currentRoute.value.path).toBe('/frontend-pilot');
        expect(deletes).toBe(1);
        expect(confirm).toHaveBeenCalledTimes(2);
    });

    it('retains navigation-only recovery in the shell when post-deletion reads close the private editor', async () => {
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
        }, '/frontend-pilot/packing/' + id, session, {}, true);
        let failNavigation = true;
        router.addRoute({name: 'packing-test-overview', path: '/frontend-pilot', component: async function loadOverview() {
            if (failNavigation) throw new TypeError('Failed to fetch dynamically imported module');
            return defineComponent({template: '<p>Overview destination</p>'});
        }});
        router.onError(() => {});
        await wrapper.get('#quick-title').setValue('Parent draft');
        await button(wrapper, 'Entity settings').trigger('click');
        await flushPromises();
        await wrapper.get('#settings-defaults-participant-EDIT_TITLE').setValue(true);
        await wrapper.get('#pilot-settings-tab-actions').trigger('click');
        const confirm = vi.fn(() => deletes === 0);
        vi.stubGlobal('confirm', confirm);
        await button(wrapper, 'Delete permanently').trigger('click');
        await flushPromises();

        // These are real subsequent server reads of the deleted resource. Its denial
        // must close private controls without losing the confirmed destination's Retry.
        await context.queryClient.invalidateQueries({queryKey: packingKeys.editors(session.context, id)});
        await flushPromises();
        expect(wrapper.findComponent(PackingSettings).exists()).toBe(false);
        expect(wrapper.find('#quick-title').exists()).toBe(false);
        expect(wrapper.find('[data-item-id]').exists()).toBe(false);
        expect(deletes).toBe(1);
        expect(confirm).toHaveBeenCalledTimes(2);
        expect(context.updates.requestReload()).toBe(false);
        const departure = new Event('beforeunload', {cancelable: true});
        window.dispatchEvent(departure);
        expect(departure.defaultPrevented).toBe(true);

        failNavigation = false;
        await button(root, context.messages.value.t('common.retry')).trigger('click');
        await flushPromises();
        expect(router.currentRoute.value.fullPath).toBe('/frontend-pilot');
        expect(deletes).toBe(1);
        expect(confirm).toHaveBeenCalledTimes(2);
    });

    it('keeps a metadata save confirmed when its settings refresh fails and exposes a read retry', async () => {
        let title = 'Original';
        let writes = 0;
        let failSettings = false;
        const projection = {...settings, editableFields: ['title'] as const};
        const {wrapper, router} = await mounted(PackingSettings, context => {
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
            }
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
        failSettings = false;
        await button(wrapper, 'Refresh').trigger('click');
        await flushPromises();
        expect(writes).toBe(1);
        const confirm = vi.fn(() => false);
        vi.stubGlobal('confirm', confirm);
        await router.push('/away');
        expect(router.currentRoute.value.path).toBe('/away');
        expect(confirm).not.toHaveBeenCalled();
    });

    it('closes revoked settings but retains the independently authorized list and self-assignment', async () => {
        let canManage = true;
        let listReads = 0;
        const {wrapper, context} = await mounted(PackingPage, {}, async request => {
            if (new URL(request.url).pathname.endsWith('/settings')) {
                canManage = false;
                return problem('FORBIDDEN', 403);
            }
            listReads++;
            return json({...list, capabilities: {...list.capabilities, manageSettings: canManage, selfAssign: true}});
        });
        context.queryClient.setQueryData(packingKeys.metadata(session.context, id, 'de'), {privateDraft: 'old edit grant'});
        await button(wrapper, 'Entity settings').trigger('click');
        await flushPromises();
        expect(wrapper.findComponent(PackingSettings).exists()).toBe(false);
        expect(wrapper.get('h1').text()).toBe('Equipment');
        expect(button(wrapper, 'Take').exists()).toBe(true);
        expect(wrapper.findAll('button').some(control => control.text() === 'Entity settings')).toBe(false);
        expect(listReads).toBeGreaterThan(1);
        expect(context.queryClient.getQueryData(packingKeys.metadata(session.context, id, 'de'))).toBeUndefined();
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

    it('renders every owner panel and refreshes its settings token after a metadata save', async () => {
        let projection: components['schemas']['PackingSettings'] = {...settings, editableFields: ['title'],
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
        await wrapper.get('#pilot-settings-tab-general').trigger('keydown', {key: 'End'});
        expect(wrapper.get('#pilot-settings-tab-actions').attributes('aria-selected')).toBe('true');
        expect(wrapper.get('#pilot-settings-tab-general').attributes('tabindex')).toBe('-1');
        await wrapper.get('#pilot-settings-tab-actions').trigger('keydown', {key: 'ArrowRight'});
        expect(wrapper.get('#pilot-settings-tab-general').attributes('aria-selected')).toBe('true');
        await wrapper.get('#pilot-settings-tab-general').trigger('keydown', {key: 'ArrowDown'});
        expect(wrapper.get('#pilot-settings-tab-event').attributes('aria-selected')).toBe('true');
        await wrapper.get('#pilot-settings-tab-event').trigger('keydown', {key: 'Home'});
        expect(wrapper.get('#pilot-settings-tab-general').attributes('tabindex')).toBe('0');
        await wrapper.get('[name="title"]').setValue('Saved title');
        await wrapper.get('#packing-metadata-form').trigger('submit');
        await flushPromises();
        await wrapper.get('#pilot-settings-tab-access').trigger('click');
        await wrapper.get('#settings-defaults-participant-EDIT_TITLE').setValue(true);
        await wrapper.get('#pilot-access-defaults').trigger('submit');
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
        await wrapper.get('#pilot-settings-tab-access').trigger('click');
        await wrapper.get('#settings-defaults-participant-EDIT_TITLE').setValue(true);
        await wrapper.get('#pilot-access-defaults').trigger('submit');
        await flushPromises();
        await wrapper.get('#pilot-settings-tab-general').trigger('click');
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
        await router.push(`/frontend-pilot/packing/${otherId}`);
        expect(router.currentRoute.value.params.listId).toBe(id);
        expect(wrapper.get<HTMLInputElement>('#quick-title').element.value).toBe('Unconfirmed item');
        confirm.mockReturnValue(true);
        await router.push(`/frontend-pilot/packing/${otherId}`);
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
        context.queryClient.setQueryData(packingKeys.detail(session.context, id, 'en'),
            {data: {...current, orderToken: '"remote-order"'}, etag: '"remote"'});
        await flushPromises();
        await wrapper.get('[data-item-id="' + itemId + '"]').trigger('drop');
        await flushPromises();
        expect(received).toEqual({token: '"order-original"', body: {itemIds: [otherId, itemId]}});
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
        let projection: components['schemas']['PackingSettings'] = {...settings, capabilities: {...settings.capabilities, linkEvent: true}};
        let saved: unknown;
        const {wrapper, context} = await mounted(PackingSettings, {listId: id}, async request => {
            if (new URL(request.url).pathname.endsWith('/events')) return json({items: [choice], selected: null, nextCursor: null});
            if (request.method === 'PUT') { saved = {body: await request.json(), token: request.headers.get('If-Match')}; return json({changed: true, canView: true}); }
            return json(projection);
        });
        await wrapper.get('[data-event-id="' + itemId + '"]').trigger('click');
        projection = {...projection, settingsToken: '"edit-remote-settings"', currentEvent: {id: otherId, title: 'Remote camp', startDate: null, endDate: null, url: null}};
        context.queryClient.setQueryData(packingKeys.settings(session.context, id, 'en'), projection);
        await flushPromises();
        expect(button(wrapper, 'Save event link').attributes('disabled')).toBeDefined();
        expect(wrapper.text()).toContain('Remote camp');
        expect(saved).toBeUndefined();
        await button(wrapper, 'Review changes').trigger('click');
        await wrapper.get('#pilot-settings-event form').trigger('submit');
        await flushPromises();
        expect(saved).toEqual({body: {eventId: itemId, expectedEventId: otherId}, token: '"edit-remote-settings"'});
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
        context.queryClient.setQueryData(packingKeys.settings(session.context, id, 'en'), projection);
        await flushPromises();
        expect(button(wrapper, 'Upload').attributes('disabled')).toBeDefined();
        expect(wrapper.text()).toContain('local.png');
        await button(wrapper, 'Review changes').trigger('click');
        await button(wrapper, 'Upload').trigger('click');
        await flushPromises();
        expect(saved).toEqual({token: '"edit-remote-settings"', name: 'local.png'});
    });

    it('retains a custom administrator mask through polling and sends it only after conflict review', async () => {
        let projection: components['schemas']['PackingSettings'] = {...settings,
            capabilities: {...settings.capabilities, managePermissions: true},
            access: {defaults, admins: [{profileId: otherId, name: 'Delegate', isGuest: false, mask: 0, editToken: '"edit-admin-original"'}],
                permissions: [{key: 'EDIT_TITLE', bit: 1}, {key: 'EDIT_DESC', bit: 2}], presets: []}};
        let saved: unknown;
        const {wrapper, context} = await mounted(PackingSettings, {listId: id}, async request => {
            if (request.method === 'PATCH') { saved = {body: await request.json(), token: request.headers.get('If-Match')}; return json({changed: true}); }
            return json(projection);
        });
        await wrapper.get('#pilot-access-admins-tab').trigger('click');
        await wrapper.get('.accordion-button').trigger('click');
        await wrapper.get('#admin-' + otherId + '-EDIT_TITLE').setValue(true);
        projection = {...projection, settingsToken: '"edit-remote-settings"', access: {...projection.access!, admins: [{profileId: otherId, name: 'Delegate', isGuest: false, mask: 2, editToken: '"edit-remote-settings"'}]}};
        context.queryClient.setQueryData(packingKeys.settings(session.context, id, 'en'), projection);
        await flushPromises();
        expect(button(wrapper, 'Save').attributes('disabled')).toBeDefined();
        await button(wrapper, 'Review changes').trigger('click');
        await button(wrapper, 'Save').trigger('click');
        await flushPromises();
        expect(saved).toEqual({body: {mask: 1}, token: '"edit-remote-settings"'});
    });

    it('uses one datalist search field and only submits an exact returned administrator choice', async () => {
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
        await wrapper.get('#pilot-access-admins-tab').trigger('click');
        await button(wrapper, 'Add').trigger('click');
        const form = wrapper.findAll('form').find(candidate => candidate.find('#profile-search').exists())!;
        await form.get('#profile-search').setValue('Guest');
        await vi.waitFor(() => expect(form.findAll('datalist option')).toHaveLength(1));
        expect(form.findAll('input')).toHaveLength(1);
        expect(form.findAll('select')).toHaveLength(1); // The existing Initial preset selector remains.
        expect(button(form, 'Add').attributes('disabled')).toBeDefined();
        expect(form.get('datalist option').attributes('value')).toBe(otherId);
        vi.stubGlobal('confirm', () => false);
        expect(context.mayChangeIdentity()).toBe(false);
        await form.get('#profile-search').setValue(otherId);
        expect(button(form, 'Add').attributes('disabled')).toBeUndefined();
        await form.get('#profile-search').setValue('unmatched');
        expect(button(form, 'Add').attributes('disabled')).toBeDefined();
        await flushPromises();
        await form.get('#profile-search').setValue(otherId);
        await form.trigger('submit');
        await flushPromises();
        expect(sent).toEqual([{profileId: otherId, mask: 0}]);
        expect(form.get<HTMLInputElement>('#profile-search').element.value).toBe('');
        expect(context.mayChangeIdentity()).toBe(true);
    });

    it('offers access management independently from metadata fields and uses tab semantics', async () => {
        const projection = {...settings, capabilities: {...settings.capabilities, managePermissions: true},
            access: {defaults, admins: [], permissions: [], presets: []}};
        const {wrapper} = await mounted(PackingSettings, {listId: id}, async () => json(projection));
        expect(wrapper.findAll('[name="title"], [name="description"]')).toHaveLength(0);
        const tab = wrapper.get('#pilot-access-admins-tab');
        expect(tab.attributes('role')).toBe('tab');
        await wrapper.get('#pilot-access-defaults-tab').trigger('keydown', {key: 'ArrowRight'});
        expect(tab.attributes('aria-selected')).toBe('true');
        expect(tab.attributes('tabindex')).toBe('0');
        expect(wrapper.get('#pilot-access-defaults-tab').attributes('tabindex')).toBe('-1');
        expect(wrapper.get('#pilot-settings-access').attributes('aria-labelledby')).toBe('pilot-settings-tab-access');
        expect(wrapper.get('#pilot-settings-tab-access').text()).toBe('Access');
        expect(wrapper.get('#pilot-access-admins').isVisible()).toBe(true);
        expect(wrapper.get('#pilot-access-defaults').isVisible()).toBe(false);
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
        }, '/frontend-pilot/packing/' + id + '/duplicate');
        expect(wrapper.findAll('tbody tr')).toHaveLength(2);
        expect(wrapper.findAll<HTMLInputElement>('tbody input[type="checkbox"]').map(input => input.element.checked)).toEqual([false, true]);
        await wrapper.get('#create-title').setValue('  Edited copy  ');
        await wrapper.get('#create-description').setValue('  Shared root  ');
        const itemRows = wrapper.findAll('tbody tr');
        await itemRows[0]!.findAll('input')[0]!.setValue('  Tent  ');
        await itemRows[0]!.findAll('input')[1]!.setValue('   ');
        await button(wrapper, 'Add row').trigger('click');
        await wrapper.findAll('tbody tr')[2]!.get('input').setValue('   ');
        await wrapper.get('form').trigger('submit');
        await flushPromises();
        expect(submitted).toEqual({title: '  Edited copy  ', description: '  Shared root  ', eventId: null,
            defaultPermissions: defaults, items: duplicate.items.map(value => ({...value, description: value.description ?? ''}))});
    });

    it.each(['failure', 'cancellation'] as const)('retains a confirmed created destination after navigation %s and retries without another POST', async failure => {
        let posts = 0;
        const {wrapper, router, context} = await mounted(PackingCreatePage, {}, async request => {
            if (request.method === 'POST') {
                posts++;
                return json({id: otherId}, 201);
            }
            return json(new URL(request.url).pathname.endsWith('/events')
                ? {items: [], nextCursor: null, selected: null}
                : {entry: {kind: 'render'}, context: {defaults, permissions: [], presets: []}});
        }, '/frontend-pilot/packing/create');
        const destination = '/frontend-pilot/packing/' + otherId;
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
        expect(router.currentRoute.value.path).toBe('/frontend-pilot/packing/create');
        expect(wrapper.get('fieldset').attributes('disabled')).toBeDefined();
        expect(wrapper.text()).toContain(context.messages.value.t('state.saved'));
        expect(context.updates.requestReload()).toBe(false);

        // Even a programmatic repeated submit cannot create another record. Recovery
        // follows the retained confirmed ID through the generic navigation owner only.
        await wrapper.get('form').trigger('submit');
        expect(posts).toBe(1);
        rejectNavigation = false;
        await button(wrapper, context.messages.value.t('common.retry')).trigger('click');
        await flushPromises();
        expect(router.currentRoute.value.fullPath).toBe(destination);
        expect(posts).toBe(1);
    });

    it('retires a native creation denial after committed departure and reads fresh admission on revisit', async () => {
        const path = '/frontend-pilot/packing/create';
        const {wrapper, router, request} = await mounted(PackingCreatePage, {}, async incoming =>
            json(new URL(incoming.url).pathname.endsWith('/events') ? {items: [], nextCursor: null, selected: null}
                : {entry: {kind: 'render'}, context: {defaults, permissions: [], presets: []}}),
        path, session, {initialUrl: path, packingError: 'api:errors.FORBIDDEN'});
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
        const actor = kind === 'account-without-profile' ? {...session, activeProfile: null, profiles: []}
            : {...session, kind, ...(kind === 'anonymous' ? {activeProfile: null, profiles: [], logoutUrl: null} : {})};
        const duplicateUrl = `/frontend-pilot/packing/${id}/duplicate`;
        const {wrapper, context, router, request} = await mounted(PackingCreatePage, {}, async function entryRequest(request) {
            const url = new URL(request.url);
            if (url.pathname.endsWith('/create-entry')) {
                expect(url.searchParams.get('returnTo')).toBe(duplicateUrl);
                return json({entry: {kind: 'redirect', url: '/frontend-pilot/users/login?next=' + encodeURIComponent(duplicateUrl),
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
        expect(router.currentRoute.value.path).toBe('/frontend-pilot/users/login');
        expect(router.currentRoute.value.query.next).toBe(duplicateUrl);
        expect(confirm).not.toHaveBeenCalled();
        expect(context.pageNotice.value).toEqual({kind: 'info', messageKey: 'auth.accountRequired'});
        expect(request.mock.calls.filter(([value]) => (value as Request).method === 'POST')).toHaveLength(0);
    });

    it.each(['anonymous', 'guest'] as const)('loads a %s duplicate through SPA navigation without invoking account-only creation context', async kind => {
        const actor = {...session, kind, ...(kind === 'anonymous' ? {activeProfile: null, profiles: [], logoutUrl: null} : {})};
        const {wrapper, router, request} = await mounted(PackingCreatePage, {}, async req => {
            const path = new URL(req.url).pathname;
            if (!path.endsWith('/duplicate')) throw new Error('Duplicate navigation must use only its admitted read');
            return json({title: path.includes(otherId) ? 'Second admitted copy' : 'First admitted copy',
                description: null, eventId: null, defaultPermissions: defaults,
                items: [{title: 'Bottle', description: null, maxAssignees: 1, requiredByAll: true}],
                formContext: {defaults, permissions: [], presets: []}});
        }, `/frontend-pilot/packing/${id}/duplicate`, actor);
        expect(wrapper.get<HTMLInputElement>('#create-title').element.value).toBe('First admitted copy');
        await router.push(`/frontend-pilot/packing/${otherId}/duplicate`);
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
        }, '/frontend-pilot/packing/create');
        await wrapper.get('#create-title').setValue('Unknown creation');
        await wrapper.get('tbody input').setValue('Sleeping bag');
        await wrapper.get('form').trigger('submit');
        await flushPromises();
        expect(wrapper.get('fieldset').attributes('disabled')).toBeDefined();
        const confirm = vi.fn(() => false);
        vi.stubGlobal('confirm', confirm);
        await router.push(`/frontend-pilot/packing/${id}/duplicate`);
        expect(router.currentRoute.value.path).toBe('/frontend-pilot/packing/create');
        expect(wrapper.get<HTMLInputElement>('#create-title').element.value).toBe('Unknown creation');
        expect(wrapper.get('fieldset').attributes('disabled')).toBeDefined();
        confirm.mockReturnValue(true);
        await router.push(`/frontend-pilot/packing/${id}/duplicate`);
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
    it('uses its caller-owned discovery and query family without issuing a packing request', async () => {
        const option = {id: itemId, title: 'Autumn camp', startDate: '2026-10-07', endDate: '2026-10-08',
            archived: false, description: null, deadlinePassed: false};
        const search = vi.fn(async () => ({items: [option], selected: null, nextCursor: null}));
        const source: PilotEventPickerSource = {
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
});
