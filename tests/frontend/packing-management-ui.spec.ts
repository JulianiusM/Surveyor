// @vitest-environment happy-dom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {flushPromises, mount} from '@vue/test-utils';
import {defineComponent, nextTick, reactive, type Component} from 'vue';
import {createMemoryHistory, createRouter} from 'vue-router';
import {VueQueryPlugin} from '@tanstack/vue-query';
import {createPilotContext, pilotContextKey} from '../../src/frontend/app/context';
import InlineCell from '../../src/frontend/components/InlineCell.vue';
import PackingPage from '../../src/frontend/features/packing/PackingPage.vue';
import PackingSettings from '../../src/frontend/features/packing/PackingSettings.vue';
import MetadataFields from '../../src/frontend/features/packing/MetadataFields.vue';
import PackingCreatePage from '../../src/frontend/features/packing/PackingCreatePage.vue';
import EventPicker from '../../src/frontend/features/packing/EventPicker.vue';
import OverviewCard from '../../src/frontend/features/packing/OverviewCard.vue';
import OverviewRegion from '../../src/frontend/features/packing/OverviewRegion.vue';
import type {components} from '../../src/types/api/v1';

const id = '11111111-1111-4111-8111-111111111111';
const itemId = '22222222-2222-4222-8222-222222222222';
const otherId = '33333333-3333-4333-8333-333333333333';
const session: components['schemas']['SessionView'] = {
    kind: 'account', context: 'packing-ui-context-1234567890', csrfToken: 'packing-ui-csrf-1234567890', locale: 'en',
    activeProfile: {id, name: 'Organizer'}, profiles: [{id, name: 'Organizer'}], loginUrl: '/users/login', logoutUrl: '/users/logout',
    shell: {version: 'test', imprintUrl: '/imprint', privacyPolicyUrl: '/privacy', localLoginEnabled: true, oidcEnabled: false, oidcName: 'SSO'},
};
const defaults = {participant: 0, guest: 0, authenticated: 0, public: 0};
const settings: components['schemas']['PackingSettings'] = {
    id, title: 'Equipment', headerUrl: null, headerVersion: null, settingsToken: '"settings-original"',
    editableFields: [], currentEvent: null, access: null,
    archive: {direct: false, inherited: false, archivedAt: null, autoArchivePaused: false, eventUrl: null},
    capabilities: {editHeader: false, linkEvent: false, managePermissions: false, duplicate: false,
        remove: false, archive: false, restore: false, manageArchive: false},
};
const item: components['schemas']['PackingItemView'] = {
    id: itemId, title: 'Tent', description: null, position: 0, requiredByAll: false,
    maxAssignees: 2, assignedCount: 0, selfAssigned: false, assignees: [], editToken: '"item-original"',
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
function problem(code: 'VALIDATION_FAILED' | 'PRECONDITION_FAILED' | 'FORBIDDEN', status: number): Response {
    return json({type: 'about:blank', title: 'Request failed', status, detail: 'Review the request.',
        code, messageKey: 'api:errors.' + code, params: {}}, status);
}
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = ''; });

/** Only the HTTP boundary is replaced. Components, validators, commands and query state are real. */
async function mounted(component: Component, props: Record<string, unknown> = {},
    handler: (request: Request) => Promise<Response> = async () => json(list),
    path = '/frontend-pilot/packing/' + id) {
    const request = vi.fn((input: RequestInfo | URL) => handler(input as Request));
    const context = createPilotContext({session}, true, request);
    context.hydrated.value = true;
    const componentProps = reactive({...props});
    const router = createRouter({history: createMemoryHistory(), routes: [
        {path: '/frontend-pilot', component, props: () => componentProps},
        {path: '/frontend-pilot/packing/create', component, props: () => componentProps},
        {path: '/frontend-pilot/packing/:listId/duplicate', component, props: () => componentProps},
        {path: '/frontend-pilot/packing/:listId', component, props: () => componentProps},
        {path: '/away', component: defineComponent({template: '<p>Away</p>'})},
    ]});
    await router.push(path);
    const root = mount(defineComponent({template: '<RouterView />'}), {attachTo: document.body, global: {
        plugins: [router, [VueQueryPlugin, {queryClient: context.queryClient}]],
        provide: {[pilotContextKey as symbol]: context},
        stubs: {AppDialog: defineComponent({template: '<section role="dialog"><slot name="navigation" /><slot /><slot name="footer" /></section>'})},
    }});
    await flushPromises();
    const wrapper = root.findComponent(component);
    cleanups.push(async () => { root.unmount(); await context.queryClient.cancelQueries(); context.queryClient.clear(); });
    async function update(values: Record<string, unknown>) { Object.assign(componentProps, values); await nextTick(); }
    return {wrapper, context, router, request, update};
}
function button(wrapper: ReturnType<typeof mount>, label: string) {
    const result = wrapper.findAll('button').find(candidate => candidate.text() === label);
    expect(result, label).toBeDefined();
    return result!;
}

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
    it.each([false, true])('blocks stale writes until explicit Review, including same-field conflict=%s', async conflictingDescription => {
        const baseline: components['schemas']['PackingMetadata'] = {entityType: 'packing', id,
            values: {title: 'Original title', description: 'Original description'}, editableFields: ['title', 'description'],
            currentEventId: null, archived: false, inheritedArchived: false};
        const remote = {...baseline, values: {title: 'Remote title',
            description: conflictingDescription ? 'Remote description' : baseline.values.description}};
        const writes: {token: string | null; body: unknown}[] = [];
        const {wrapper, context} = await mounted(MetadataFields, {listId: id}, async request => {
            if (request.method === 'PATCH') writes.push({token: request.headers.get('If-Match'), body: await request.json()});
            return json(baseline);
        });
        await wrapper.get('[name="description"]').setValue('Local description');
        context.queryClient.setQueryData(['v1', session.context, 'en', 'packing', id, 'metadata'],
            {data: remote, etag: '"remote"'});
        await flushPromises();
        expect(button(wrapper, 'Save properties').attributes('disabled')).toBeDefined();
        await wrapper.get('form').trigger('submit');
        expect(writes).toEqual([]);
        if (conflictingDescription) {
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
});

describe('packing overview presentation and navigation', () => {
    const card: components['schemas']['PackingOverviewCard'] = {
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
        const region: components['schemas']['PackingOverviewRegion'] = {
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
        const region: components['schemas']['PackingOverviewRegion'] = {
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
        const region: components['schemas']['PackingOverviewRegion'] = {
            collection: 'owner', region: 'main', q: '', type: 'all', availableTypes: [],
            page: 1, childPage: 1, eventId: null, pageSize: 24, totalEntities: 0, hiddenEntities: 0,
            regionEntities: 0, matchingEntities: 0, totalCards: 0, totalChildren: 0,
            hasPrevious: false, hasNext: false, parent: null, items: [],
        };
        const {wrapper, context} = await mounted(OverviewRegion, {collection: 'owner', region: 'main'}, async () => json(region), '/frontend-pilot');
        expect(wrapper.text()).toContain("You don't have any administrable entities yet");
        const key = ['v1', session.context, 'en', 'packing', 'overview', {collection: 'owner', region: 'main'}];
        context.queryClient.setQueryData(key, {...region, totalEntities: 2, hiddenEntities: 2});
        await nextTick();
        expect(wrapper.text()).toContain('All your entities in this collection are in Archived and hidden below.');
        context.queryClient.setQueryData(key, {...region, q: 'missing'});
        await nextTick();
        expect(wrapper.text()).toContain('No entities match your search and filter.');
    });

    it('retains a saved type filter when its last visible member disappears', async () => {
        const region: components['schemas']['PackingOverviewRegion'] = {
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
        context.queryClient.setQueryData(['v1', session.context, 'de', 'packing', id, 'metadata'], {privateDraft: 'old edit grant'});
        await button(wrapper, 'Entity settings').trigger('click');
        await flushPromises();
        expect(wrapper.findComponent(PackingSettings).exists()).toBe(false);
        expect(wrapper.get('h1').text()).toBe('Equipment');
        expect(button(wrapper, 'Take').exists()).toBe(true);
        expect(wrapper.findAll('button').some(control => control.text() === 'Entity settings')).toBe(false);
        expect(listReads).toBeGreaterThan(1);
        expect(context.queryClient.getQueryData(['v1', session.context, 'de', 'packing', id, 'metadata'])).toBeUndefined();
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
            access: {defaults, admins: [], permissions: [], presets: []}};
        let title = 'Existing';
        let token: string | null = null;
        const {wrapper} = await mounted(PackingSettings, {listId: id}, async request => {
            const path = new URL(request.url).pathname;
            if (path.endsWith('/events')) return json({items: [], selected: null, nextCursor: null});
            if (path.endsWith('/settings')) return json(projection);
            if (path.endsWith('/default-permissions')) { token = request.headers.get('If-Match'); return json({changed: false}); }
            if (request.method === 'PATCH') { title = (await request.json()).title; projection = {...projection, settingsToken: '"after-metadata"'}; }
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
        await wrapper.get('#pilot-access-defaults').trigger('submit');
        await flushPromises();
        expect(token).toBe('"after-metadata"');
    });

    it('refreshes a pristine properties editor after another settings command advances its token', async () => {
        const projection = {...settings, editableFields: ['title'] as const,
            capabilities: {...settings.capabilities, managePermissions: true},
            access: {defaults, admins: [], permissions: [], presets: []}};
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
            if (request.method === 'POST') { sent.push(await request.json()); return reject ? problem('VALIDATION_FAILED', 400) : json({id: otherId}); }
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
        expect(sent).toEqual([{title: 'Ground sheet', description: 'Dry', maxAssignees: 3, requiredByAll: false},
            {title: 'Ground sheet', description: 'Dry', maxAssignees: 3, requiredByAll: false}]);
        expect(wrapper.get<HTMLInputElement>('#quick-title').element.value).toBe('');
        expect(wrapper.get<HTMLInputElement>('#quick-max').element.value).toBe('1');
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
        context.queryClient.setQueryData(['v1', session.context, 'en', 'packing', id],
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
        projection = {...projection, settingsToken: '"remote-settings"', currentEvent: {id: otherId, title: 'Remote camp', startDate: null, endDate: null, url: null}};
        context.queryClient.setQueryData(['v1', session.context, 'en', 'packing', id, 'settings'], projection);
        await flushPromises();
        expect(button(wrapper, 'Save event link').attributes('disabled')).toBeDefined();
        expect(wrapper.text()).toContain('Remote camp');
        expect(saved).toBeUndefined();
        await button(wrapper, 'Review changes').trigger('click');
        await wrapper.get('#pilot-settings-event form').trigger('submit');
        await flushPromises();
        expect(saved).toEqual({body: {eventId: itemId, expectedEventId: otherId}, token: '"remote-settings"'});
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
        projection = {...projection, settingsToken: '"remote-settings"'};
        context.queryClient.setQueryData(['v1', session.context, 'en', 'packing', id, 'settings'], projection);
        await flushPromises();
        expect(button(wrapper, 'Upload').attributes('disabled')).toBeDefined();
        expect(wrapper.text()).toContain('local.png');
        await button(wrapper, 'Review changes').trigger('click');
        await button(wrapper, 'Upload').trigger('click');
        await flushPromises();
        expect(saved).toEqual({token: '"remote-settings"', name: 'local.png'});
    });

    it('retains a custom administrator mask through polling and sends it only after conflict review', async () => {
        let projection: components['schemas']['PackingSettings'] = {...settings,
            capabilities: {...settings.capabilities, managePermissions: true},
            access: {defaults, admins: [{profileId: otherId, name: 'Delegate', isGuest: false, mask: 0}],
                permissions: [{key: 'EDIT_TITLE', bit: 1}, {key: 'EDIT_DESC', bit: 2}], presets: []}};
        let saved: unknown;
        const {wrapper, context} = await mounted(PackingSettings, {listId: id}, async request => {
            if (request.method === 'PATCH') { saved = {body: await request.json(), token: request.headers.get('If-Match')}; return json({changed: true}); }
            return json(projection);
        });
        await wrapper.get('#pilot-access-admins-tab').trigger('click');
        await wrapper.get('.accordion-button').trigger('click');
        await wrapper.get('#admin-' + otherId + '-EDIT_TITLE').setValue(true);
        projection = {...projection, settingsToken: '"remote-settings"', access: {...projection.access!, admins: [{profileId: otherId, name: 'Delegate', isGuest: false, mask: 2}]}};
        context.queryClient.setQueryData(['v1', session.context, 'en', 'packing', id, 'settings'], projection);
        await flushPromises();
        expect(button(wrapper, 'Save').attributes('disabled')).toBeDefined();
        await button(wrapper, 'Review changes').trigger('click');
        await button(wrapper, 'Save').trigger('click');
        await flushPromises();
        expect(saved).toEqual({body: {mask: 1}, token: '"remote-settings"'});
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
        await flushPromises();
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
                {title: 'Bottle', description: 'Personal', maxAssignees: 1, requiredByAll: true}], defaultPermissions: defaults};
        const {wrapper} = await mounted(PackingCreatePage, {}, async request => {
            const path = new URL(request.url).pathname;
            if (request.method === 'POST') {
                submitted = JSON.parse(String((await request.formData()).get('data')));
                return json({id: otherId});
            }
            if (path.endsWith('/duplicate')) return json(duplicate);
            if (path.endsWith('/events')) return json({items: [], nextCursor: null, selected: null});
            return json({defaults, permissions: [], presets: []});
        }, '/frontend-pilot/packing/' + id + '/duplicate');
        expect(wrapper.findAll('tbody tr')).toHaveLength(2);
        expect(wrapper.findAll<HTMLInputElement>('tbody input[type="checkbox"]').map(input => input.element.checked)).toEqual([false, true]);
        await wrapper.get('#create-title').setValue('Edited copy');
        await wrapper.get('form').trigger('submit');
        await flushPromises();
        expect(submitted).toEqual({title: 'Edited copy', description: 'Shared', eventId: null,
            defaultPermissions: defaults, items: duplicate.items});
    });
});

describe('event picker parity', () => {
    it('replaces pages, preserves explicit selection through filters, and rejects reversed date ranges locally', async () => {
        const first = {id: itemId, title: 'Autumn camp', startDate: '2026-10-07', endDate: '2026-10-08',
            archived: true, description: 'Cabin', deadlinePassed: false};
        const second = {...first, id: otherId, title: 'Winter camp'};
        const {wrapper, request, update} = await mounted(EventPicker, {prefix: 'test', inline: true, modelValue: null}, async req => {
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
        await flushPromises();
        expect(wrapper.findAll('[data-event-id]')).toHaveLength(0);
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
