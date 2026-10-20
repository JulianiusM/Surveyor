// @vitest-environment happy-dom
import {apiCompatibility} from '../../.generated/api/v1/policy.mjs';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {flushPromises, mount} from '@vue/test-utils';
import {defineComponent, type Component} from 'vue';
import {createMemoryHistory, createRouter} from 'vue-router';
import {VueQueryPlugin} from '@tanstack/vue-query';
import I18NextVue from 'i18next-vue';
import type {components} from '../../src/types/api/v1';
import {createPilotContext, observeInitialDocument, pilotContextKey} from '../../src/frontend/app/context';
import {driversKeys} from '../../src/frontend/app/queryKeys';
import DriversPage from '../../src/frontend/features/drivers/DriversPage.vue';
import DriversCreatePage from '../../src/frontend/features/drivers/DriversCreatePage.vue';
import EntityAssignees from '../../src/frontend/components/EntityAssignees.vue';
import EntityAssignmentActions from '../../src/frontend/components/EntityAssignmentActions.vue';
import EntityListCreation from '../../src/frontend/components/EntityListCreation.vue';

const listId = '11111111-1111-4111-8111-111111111111';
const itemId = '22222222-2222-4222-8222-222222222222';
const secondId = '33333333-3333-4333-8333-333333333333';
const session: components['schemas']['SessionView'] & {context: string; csrfToken: string} = {
    kind: 'account', context: 'drivers-ui-context-1234567890', csrfToken: 'drivers-ui-csrf-1234567890', locale: 'en',
    deployment: {buildId: 'fixture', apiCompatibility},
    activeProfile: {id: secondId, name: 'Offering profile'}, profiles: [{id: secondId, name: 'Offering profile'}],
    loginUrl: '/users/login', logoutUrl: '/users/logout', shell: {version: 'test', imprintUrl: '/imprint',
        privacyPolicyUrl: '/privacy', localLoginEnabled: true, oidcEnabled: false, oidcName: 'SSO'},
};
const defaults = {participant: 1, guest: 0, authenticated: 0, public: 0};
const definitions: components['schemas']['DriversCreateContext'] = {defaults, permissions: [{key: 'ACCESS_ITEMS', bit: 1}], presets: []};
const item: components['schemas']['DriversItemView'] = {id: itemId, driverName: 'Offering profile', description: 'Outbound',
    position: 1, maxAssignees: 2, assignedCount: 1, selfAssigned: false, assignees: [{name: 'Passenger', assignmentId: '7'}],
    capabilities: {showCapacityEdit: true, editTitle: true, editDescription: true, editCapacity: true, removeItem: true, removeAssignments: true},
    editToken: '"edit-item-original"'};
const list: components['schemas']['DriversListView'] = {entityType: 'drivers', id: listId, title: 'Shared journeys',
    description: 'Two rides', headerUrl: null, headerVersion: null, orderToken: '"order-original"', currentEventId: null,
    currentEventUrl: null, archived: false, inheritedArchived: false, counters: {participants: 1, open: 2, empty: 1},
    capabilities: {editTitle: true, editDescription: true, selfAssign: true, addItem: true, reorder: true, manageSettings: true},
    items: [item, {...item, id: secondId, description: 'Return', position: 2, assignedCount: 0, assignees: []}]};
const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
});

function json(value: unknown, status = 200): Response {
    return new Response(JSON.stringify(value), {status, headers: {'Content-Type': 'application/json',
        'X-Surveyor-Context': session.context, ETag: '"original"'}});
}

/** Exercise real mounted feature controls, generated contracts and shared owners.
 * Only HTTP delivery is substituted; persistence is covered by Drivers integration. */
async function mounted(component: Component, handler: (request: Request) => Promise<Response>,
    path = `/frontend-pilot/drivers/${listId}`) {
    const request = vi.fn((input: RequestInfo | URL) => handler(input as Request));
    const context = createPilotContext({session}, true, request);
    context.hydrated.value = true;
    const router = createRouter({history: createMemoryHistory(), routes: [
        {path: '/frontend-pilot/drivers/create', component},
        {path: '/frontend-pilot/drivers/:listId/duplicate', component},
        {path: '/frontend-pilot/drivers/:listId', component: path.endsWith('/duplicate') || path.endsWith('/create')
            ? defineComponent({template: '<p>Created</p>'}) : component},
        {path: '/frontend-pilot', component: defineComponent({template: '<p>Overview</p>'})},
    ]});
    await router.push(path);
    const stopInitial = observeInitialDocument(context, router);
    const root = mount(defineComponent({template: '<RouterView />'}), {attachTo: document.body, global: {
        plugins: [router, [VueQueryPlugin, {queryClient: context.queryClient}], [I18NextVue, {i18next: context.i18next}]],
        provide: {[pilotContextKey as symbol]: context},
    }});
    await flushPromises();
    cleanups.push(async () => {root.unmount(); stopInitial(); await context.queryClient.cancelQueries(); context.queryClient.clear();});
    if (component === DriversPage) {
        await vi.waitFor(() => expect(context.queryClient.getQueryState(driversKeys.detail(session.context, listId)))
            .toMatchObject({status: 'success'}));
        await flushPromises();
    }
    return {root, wrapper: root.findComponent(component), request, context, router};
}

describe('Drivers production frontend consumers', () => {
    it('renders offering identity and passenger controls through the shared list presentation', async () => {
        const writes: string[] = [];
        const {wrapper} = await mounted(DriversPage, async request => {
            if (request.method === 'GET') return json(list);
            writes.push(request.method + ' ' + new URL(request.url).pathname);
            return json({itemId, assigned: true, assignedCount: 2});
        });
        expect(wrapper.findAllComponents(EntityAssignees)).toHaveLength(2);
        expect(wrapper.findAllComponents(EntityAssignmentActions)).toHaveLength(2);
        expect(wrapper.findAll('thead th').map(cell => cell.text())).toEqual(['Driver', 'Description', 'Assignees', 'Assigned / Max', 'Action']);
        expect(wrapper.find('input[type="checkbox"]').exists()).toBe(false);
        expect(wrapper.get<HTMLInputElement>('#quick-title').element.value).toBe('Offering profile');
        expect(wrapper.get('#quick-title').attributes('readonly')).toBeDefined();
        const row = wrapper.get(`[data-item-id="${itemId}"]`);
        expect(row.findAll('td')[0]!.text()).toBe('Offering profile');
        expect(row.findAll('td')[0]!.attributes('tabindex')).toBeUndefined();
        await row.findAll('button').find(button => button.text() === 'Take')!.trigger('click');
        await flushPromises();
        expect(writes).toEqual([`PUT /api/v1/drivers-lists/${listId}/items/${itemId}/self-assignment`]);
    });

    it('retains and deliberately reviews an uncertain default ride offer without replay', async () => {
        const bodies: unknown[] = [];
        vi.stubGlobal('confirm', vi.fn(() => true));
        const {wrapper, request} = await mounted(DriversPage, async request => {
            if (request.method === 'GET') return json(list);
            bodies.push(await request.json());
            throw new TypeError('Connection ended after send');
        });
        await wrapper.get('form').trigger('submit');
        await flushPromises();
        expect(bodies).toEqual([{title: 'Offering profile', description: '', maxAssignees: 1}]);
        expect(wrapper.get('#quick-description').attributes('disabled')).toBeDefined();
        const review = wrapper.findAll('button').find(button => button.text() === 'Review changes');
        expect(review).toBeDefined();
        await review!.trigger('click');
        await flushPromises();
        expect(request.mock.calls.filter(([value]) => (value as Request).method === 'POST')).toHaveLength(1);
        expect(wrapper.get('#quick-description').attributes('disabled')).toBeUndefined();
    });

    it('keeps an uncertain passenger command separate from manual review of a new ride offer', async () => {
        const {wrapper, request, context} = await mounted(DriversPage, async request => {
            if (request.method === 'GET') return json(list);
            throw new TypeError('Assignment response lost after send');
        });
        const row = wrapper.get(`[data-item-id="${itemId}"]`);
        await row.findAll('button').find(button => button.text() === 'Take')!.trigger('click');
        await flushPromises();
        expect(wrapper.text()).toContain('The result is uncertain.');
        expect(wrapper.text()).not.toContain(context.messages.value.t('drivers.reviewUnknownItem'));
        expect(wrapper.findAll('button').filter(button => button.text() === 'Review changes')).toHaveLength(0);
        expect(request.mock.calls.filter(([value]) => (value as Request).method === 'PUT')).toHaveLength(1);
    });

    it('duplicates root fields and permissions through the shared form without copying rides', async () => {
        let submitted: unknown;
        const {wrapper, router} = await mounted(DriversCreatePage, async request => {
            const url = new URL(request.url);
            if (url.pathname.endsWith('/duplicate')) return json({title: 'Copied journeys', description: 'Copied description', eventId: null,
                defaultPermissions: defaults, selectedEvent: null, formContext: definitions});
            if (url.pathname.endsWith('/create-entry')) return json({entry: {kind: 'render'}, context: definitions, selectedEvent: null});
            if (url.pathname.endsWith('/events')) return json({items: [], nextCursor: null, previousCursor: null});
            const form = await request.formData();
            submitted = JSON.parse(String(form.get('data')));
            return json({id: secondId}, 201);
        }, `/frontend-pilot/drivers/${listId}/duplicate`);
        expect(wrapper.findComponent(EntityListCreation).exists()).toBe(true);
        expect(wrapper.get<HTMLInputElement>('#create-title').element.value).toBe('Copied journeys');
        expect(wrapper.findAll('tbody tr')).toHaveLength(0);
        await wrapper.get('form').trigger('submit');
        await flushPromises();
        expect(submitted).toEqual({title: 'Copied journeys', description: 'Copied description', eventId: null, defaultPermissions: defaults});
        expect(router.currentRoute.value.path).toBe(`/frontend-pilot/drivers/${secondId}`);
    });

    it('supplies the offering profile and native raw Quick Add values without Packing controls', async () => {
        const submitted: unknown[] = [];
        const {wrapper} = await mounted(DriversPage, async request => {
            if (request.method === 'POST') {
                submitted.push(await request.json());
                return json({id: itemId}, 201);
            }
            return json(list);
        });
        expect(wrapper.get<HTMLInputElement>('#quick-title').element.value).toBe(session.activeProfile!.name);
        expect(wrapper.get<HTMLInputElement>('#quick-title').element.readOnly).toBe(true);
        expect(wrapper.find('input[type="checkbox"]').exists()).toBe(false);
        expect(wrapper.text()).not.toContain('Everyone');
        const capacity = wrapper.get<HTMLInputElement>('#quick-max');
        const original = capacity.element;
        original.focus();
        await capacity.setValue('01');
        await wrapper.get('#quick-description').setValue('  pickup stays padded  ');
        expect(wrapper.get('#quick-max').element).toBe(original);
        // The original native Vue number input normalizes 01 to 1 on change
        // and on an unrelated rerender; the shared chooser keeps that lifecycle.
        expect(original.value).toBe('1');
        expect(document.activeElement).toBe(original);
        expect(capacity.attributes('name')).toBeUndefined();
        expect(capacity.attributes('min')).toBe('1');
        expect(wrapper.get('#quick-title').attributes('name')).toBeUndefined();
        expect(wrapper.get('#quick-description').attributes('name')).toBeUndefined();
        await capacity.setValue('');
        await wrapper.get('form').trigger('submit'); await flushPromises();
        expect(submitted).toEqual([{title: session.activeProfile!.name, description: '  pickup stays padded  ', maxAssignees: 1}]);
        expect(wrapper.get<HTMLInputElement>('#quick-description').element.value).toBe('');
        expect(wrapper.get<HTMLInputElement>('#quick-max').element.value).toBe('1');
    });

    it('keeps a pending or uncertain ride offer and never replays it during read recovery', async () => {
        let reject!: (reason: Error) => void;
        const {wrapper, request, context} = await mounted(DriversPage, async request => {
            if (request.method === 'POST') return new Promise<Response>((_resolve, failure) => {reject = failure;});
            return json(list);
        });
        await wrapper.get('#quick-description').setValue('Unconfirmed pickup');
        await wrapper.get('form').trigger('submit'); await flushPromises();
        expect(wrapper.get('#quick-description').attributes('disabled')).toBeDefined();
        await wrapper.get('form').trigger('submit'); await flushPromises();
        expect(request.mock.calls.filter(([input]) => (input as Request).method === 'POST')).toHaveLength(1);
        reject(new Error('Reply lost after dispatch')); await flushPromises();
        expect(wrapper.text()).toContain('The result is uncertain.');
        expect(wrapper.get<HTMLInputElement>('#quick-description').element.value).toBe('Unconfirmed pickup');
        await context.queryClient.invalidateQueries({queryKey: driversKeys.detail(session.context, listId)});
        await flushPromises();
        await wrapper.get('form').trigger('submit'); await flushPromises();
        expect(request.mock.calls.filter(([input]) => (input as Request).method === 'POST')).toHaveLength(1);
        expect(wrapper.get<HTMLInputElement>('#quick-description').element.value).toBe('Unconfirmed pickup');
    });

    it('releases a confirmed ride draft even when its owning follow-up read fails', async () => {
        let saved = false;
        const {wrapper, request} = await mounted(DriversPage, async request => {
            if (request.method === 'POST') {saved = true; return json({id: itemId}, 201);}
            if (saved) return json({type: 'about:blank', title: 'Read rejected', status: 400, detail: 'Refresh unavailable.',
                requestId: 'drivers-follow-up', code: 'VALIDATION_FAILED', messageKey: 'api:errors.VALIDATION_FAILED', params: {}}, 400);
            return json(list);
        });
        await wrapper.get('#quick-description').setValue('Confirmed pickup');
        await wrapper.get('#quick-max').setValue('3');
        await wrapper.get('form').trigger('submit'); await flushPromises();
        expect(wrapper.get<HTMLInputElement>('#quick-description').element.value).toBe('');
        expect(wrapper.get<HTMLInputElement>('#quick-max').element.value).toBe('1');
        expect(wrapper.text()).toContain('Your change was saved, but the refreshed data could not be loaded.');
        expect(request.mock.calls.filter(([input]) => (input as Request).method === 'POST')).toHaveLength(1);
    });

    it('retains the entered list and exact File after uncertain creation without replaying a multipart command', async () => {
        const {wrapper, request, context} = await mounted(DriversCreatePage, async request => {
            if (request.method === 'POST') throw new Error('Creation reply lost');
            return creationRead(request);
        }, '/frontend-pilot/drivers/create');
        await wrapper.get('#create-title').setValue('Unconfirmed journeys');
        const chooser = wrapper.get<HTMLInputElement>('#create-header').element;
        const file = chooseImage(chooser);
        await wrapper.get('form').trigger('submit'); await flushPromises();
        expect(wrapper.text()).toContain('Creation could not be confirmed.');
        expect(wrapper.get<HTMLInputElement>('#create-title').element.value).toBe('Unconfirmed journeys');
        expect(chooser.files?.[0]).toBe(file);
        await context.queryClient.invalidateQueries({queryKey: driversKeys.creation(session.context)}); await flushPromises();
        await wrapper.get('form').trigger('submit'); await flushPromises();
        expect(request.mock.calls.filter(([input]) => (input as Request).method === 'POST')).toHaveLength(1);
        expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined();
        expect(chooser.files?.[0]).toBe(file);
    });

    it('preserves a canceled duplicate draft and releases its FileList only after accepted warm navigation', async () => {
        const start = `/frontend-pilot/drivers/${listId}/duplicate`;
        const {wrapper, router, context} = await mounted(DriversCreatePage, creationRead, start);
        vi.stubGlobal('confirm', vi.fn(() => true));
        await router.push(`/frontend-pilot/drivers/${secondId}/duplicate`); await flushPromises();
        await router.push(start); await flushPromises();
        await wrapper.get('#create-title').setValue('Entered duplicate');
        const chooser = wrapper.get<HTMLInputElement>('#create-header').element;
        const file = chooseImage(chooser);
        const confirm = vi.fn(() => false);
        vi.stubGlobal('confirm', confirm);
        await router.push(`/frontend-pilot/drivers/${secondId}/duplicate`); await flushPromises();
        expect(router.currentRoute.value.fullPath).toBe(start);
        await context.queryClient.invalidateQueries({queryKey: driversKeys.duplicate(session.context, listId)}); await flushPromises();
        await router.push(start + '#create-header'); await flushPromises();
        expect(chooser.files?.[0]).toBe(file);
        expect(wrapper.get<HTMLInputElement>('#create-title').element.value).toBe('Entered duplicate');
        expect(confirm).toHaveBeenCalledTimes(1);
        confirm.mockReturnValue(true);
        await router.push(`/frontend-pilot/drivers/${secondId}/duplicate`); await flushPromises();
        const nextChooser = wrapper.get<HTMLInputElement>('#create-header').element;
        expect(nextChooser).toBe(chooser);
        expect(nextChooser.files).toHaveLength(0);
        expect(wrapper.get<HTMLInputElement>('#create-title').element.value).toBe('Second copy');
    });
});

/** Supply valid authored read shapes without representing persistence. */
function creationRead(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path.endsWith('/duplicate')) return Promise.resolve(json({title: path.includes(secondId) ? 'Second copy' : 'First copy',
        description: null, eventId: null, defaultPermissions: defaults, formContext: definitions}));
    if (path.endsWith('/create-entry')) return Promise.resolve(json({entry: {kind: 'render'}, context: definitions}));
    if (path.endsWith('/events')) return Promise.resolve(json({items: [], nextCursor: null, previousCursor: null}));
    throw new Error(`Unexpected creation read: ${path}`);
}

/** Keep the exact browser-selected File through the feature's release boundary. */
function chooseImage(input: HTMLInputElement): File {
    const transfer = new DataTransfer();
    const file = new File(['header'], 'chosen.png', {type: 'image/png'});
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', {bubbles: true}));
    return file;
}
