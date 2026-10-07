// @vitest-environment happy-dom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {flushPromises, mount} from '@vue/test-utils';
import {defineComponent, nextTick} from 'vue';
import {createMemoryHistory, createRouter} from 'vue-router';
import {VueQueryPlugin} from '@tanstack/vue-query';
import PackingPage from '../../src/frontend/features/packing/PackingPage.vue';
import AppDialog from '../../src/frontend/components/AppDialog.vue';
import {createPilotContext, pilotContextKey} from '../../src/frontend/app/context';
import type {components} from '../../src/types/api/v1';

const listId = '11111111-1111-4111-8111-111111111111';
const profileId = '22222222-2222-4222-8222-222222222222';
const session: components['schemas']['SessionView'] = {kind: 'account', context: 'component-context-1234567890',
    csrfToken: 'component-csrf-1234567890', locale: 'en', activeProfile: {id: profileId, name: 'Owner'},
    profiles: [{id: profileId, name: 'Owner'}], loginUrl: '/users/login', logoutUrl: '/users/logout',
    shell: {version: 'test', imprintUrl: '/imprint', privacyPolicyUrl: '/privacy', localLoginEnabled: true,
        oidcEnabled: false, oidcName: 'Single sign-on'}};
const list: components['schemas']['PackingListView'] = {entityType: 'packing', id: listId, title: 'A shared list',
    description: 'Shared equipment', headerUrl: null, headerVersion: null, orderToken: '"order"', currentEventId: null, currentEventUrl: null,
    archived: false, inheritedArchived: false,
    capabilities: {editTitle: true, editDescription: true, selfAssign: true, addItem: false, reorder: false, manageSettings: true},
    counters: {participants: 0, open: 0, empty: 0}, items: []};
const metadata: components['schemas']['PackingMetadata'] = {entityType: 'packing', id: listId,
    values: {title: list.title, description: list.description}, editableFields: ['title', 'description'],
    currentEventId: null, archived: false, inheritedArchived: false};
const settings: components['schemas']['PackingSettings'] = {id: listId, title: list.title,
    headerUrl: null, headerVersion: null, settingsToken: '"settings"', editableFields: ['title', 'description'],
    currentEvent: null, access: null,
    archive: {direct: false, inherited: false, archivedAt: null, autoArchivePaused: false, eventUrl: null},
    capabilities: {editHeader: false, linkEvent: false, managePermissions: false, duplicate: false,
        remove: false, archive: false, restore: false, manageArchive: false}};

function json(value: unknown): Response {
    return new Response(JSON.stringify(value), {headers: {'Content-Type': 'application/json',
        'X-Surveyor-Context': session.context, ETag: '"original"'}});
}

afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ''; });

describe('shared dialog focus', () => {
    it('focuses the requested body field and restores each invoker when a closed dialog stays mounted', async () => {
        const first = document.createElement('button');
        const second = document.createElement('button');
        document.body.append(first, second);
        const context = createPilotContext({session}, true);
        const wrapper = mount(AppDialog, {attachTo: document.body,
            props: {open: false, title: 'Choose an event', fullscreenOnSmall: false, initialFocus: '#event-search'},
            slots: {default: '<label for="event-search">Search events</label><input id="event-search" />'},
            global: {provide: {[pilotContextKey as symbol]: context}},
        });
        try {
            for (const trigger of [first, second]) {
                trigger.focus();
                await wrapper.setProps({open: true});
                await flushPromises();
                expect(document.activeElement).toBe(document.querySelector('#event-search'));
                await wrapper.setProps({open: false});
                await flushPromises();
                // Reka releases the focus scope on the next event-loop turn.
                await new Promise(resolve => setTimeout(resolve, 0));
                expect(document.activeElement).toBe(trigger);
            }
        } finally { wrapper.unmount(); context.queryClient.clear(); }
    });
});

/** Mount the real packing view with an HTTP-boundary fixture; state and rendering stay production code. */
async function mountPackingView(view: components['schemas']['PackingListView']) {
    const request = vi.fn(async (input: RequestInfo | URL) => {
        if (new URL((input as Request).url).pathname.endsWith('/header')) return new Response(new Blob(['image']), {
            headers: {'Content-Type': 'image/png', 'X-Surveyor-Context': session.context}});
        return json(view);
    });
    const context = createPilotContext({session}, true, request);
    context.hydrated.value = true;
    const router = createRouter({history: createMemoryHistory(), routes: [
        {path: '/frontend-pilot/packing/:listId', component: PackingPage},
    ]});
    await router.push(`/frontend-pilot/packing/${listId}`);
    await router.isReady();
    const wrapper = mount(defineComponent({template: '<RouterView />'}), {attachTo: document.body, global: {
        plugins: [router, [VueQueryPlugin, {queryClient: context.queryClient}]],
        provide: {[pilotContextKey as symbol]: context},
    }});
    await flushPromises();
    async function dispose() {
        wrapper.unmount();
        await context.queryClient.cancelQueries();
        context.queryClient.clear();
    }
    return {wrapper, dispose};
}

describe('packing presentation compatibility', () => {
    it('retains the table headers for an empty list and the title-bearing header image', async () => {
        const objectUrl = 'blob:packing-image';
        vi.spyOn(URL, 'createObjectURL').mockReturnValue(objectUrl);
        vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
        const mounted = await mountPackingView({...list, headerUrl: `/packing/${listId}/header`, headerVersion: 'image-v1'});
        try {
            expect(mounted.wrapper.findAll('thead th').map(cell => cell.text()))
                .toEqual(['Packed?', 'Assignees', 'Item', 'Description', 'Assigned / Max', 'Action']);
            expect(mounted.wrapper.findAll('tbody tr')).toHaveLength(0);
            expect(mounted.wrapper.get('.card-header img').attributes('alt')).toBe(list.title);
            expect(mounted.wrapper.get('.card-header img').attributes('src')).toBe(objectUrl);
            expect(mounted.wrapper.get('h1 i').classes()).toContain('bi-bag-check-check');
        } finally { await mounted.dispose(); }
    });

    it('uses only the authorized event URL for both responsive header links', async () => {
        const eventId = '66666666-6666-4666-8666-666666666666';
        const privateParent = await mountPackingView({...list, currentEventId: eventId});
        try {
            expect(privateParent.wrapper.findAll('.card-header a')).toHaveLength(0);
        } finally { await privateParent.dispose(); }
        const accessibleParent = await mountPackingView({...list, currentEventId: eventId,
            currentEventUrl: `/event/${eventId}`});
        try {
            const links = accessibleParent.wrapper.findAll('.card-header a');
            expect(links).toHaveLength(2);
            for (const link of links) {
                expect(link.text()).toBe('Go to event');
                expect(link.attributes('href')).toBe(`/event/${eventId}`);
            }
        } finally { await accessibleParent.dispose(); }
    });

    it('preserves historical blank capacities, existing Everyone removals and packed color restoration', async () => {
        const base: components['schemas']['PackingItemView'] = {id: '33333333-3333-4333-8333-333333333333',
            title: 'Historical capacity', description: null, position: 0, requiredByAll: false,
            maxAssignees: null, assignedCount: 0, selfAssigned: false, assignees: [], editToken: '"item"',
            capabilities: {editTitle: false, editDescription: false, editCapacity: false, editRequired: false, removeItem: false, removeAssignments: false}};
        const everyone = {...base, id: '44444444-4444-4444-8444-444444444444', title: 'Everyone item',
            requiredByAll: true, maxAssignees: 1, assignedCount: 1, selfAssigned: true};
        const negative = {...base, id: '55555555-5555-4555-8555-555555555555', title: 'Negative legacy capacity', maxAssignees: -1};
        const mounted = await mountPackingView({...list, items: [base, everyone, negative]});
        const packedKey = `packed_${listId}_${everyone.id}`;
        try {
            const historicalRow = mounted.wrapper.get(`[data-item-id="${base.id}"]`);
            expect(historicalRow.findAll('td')[4].text()).toBe('0 /');
            expect(historicalRow.findAll('button')).toHaveLength(0);
            expect(historicalRow.findAll('td')[5].text()).toBe('Full');
            expect(mounted.wrapper.get(`[data-item-id="${negative.id}"]`).findAll('td')[5].text()).toBe('Full');
            const everyoneRow = mounted.wrapper.get(`[data-item-id="${everyone.id}"]`);
            expect(mounted.wrapper.findAll('tbody tr')[0].attributes('data-item-id')).toBe(everyone.id);
            expect(everyoneRow.get('button').text()).toBe('Remove');
            expect(everyoneRow.classes()).toContain('table-info');
            await everyoneRow.get('input[type="checkbox"]').setValue(true);
            expect(localStorage.getItem(packedKey)).toBe('1');
            expect(everyoneRow.classes()).toContain('table-success');
            expect(everyoneRow.classes()).not.toContain('table-info');
            await everyoneRow.get('input[type="checkbox"]').setValue(false);
            expect(localStorage.getItem(packedKey)).toBeNull();
            expect(everyoneRow.classes()).toContain('table-info');
        } finally {
            localStorage.removeItem(packedKey);
            await mounted.dispose();
        }
    });
});

describe('packing editor ownership', () => {
    it('keeps the same focused dirty input mounted while a changed-locale list query is pending and resolves', async () => {
        let releaseGermanList!: () => void;
        const germanList = new Promise<void>(resolve => { releaseGermanList = resolve; });
        const request = vi.fn(async (input: RequestInfo | URL) => {
            const captured = input as Request;
            if (new URL(captured.url).pathname.endsWith('/settings')) return json(settings);
            if (new URL(captured.url).pathname.endsWith('/metadata')) return json(metadata);
            if (captured.headers.get('X-Surveyor-Locale') === 'de') await germanList;
            return json(list);
        });
        const context = createPilotContext({session}, true, request);
        context.hydrated.value = true;
        const router = createRouter({history: createMemoryHistory(), routes: [
            {path: '/frontend-pilot/packing/:listId', component: PackingPage},
        ]});
        await router.push(`/frontend-pilot/packing/${listId}`);
        await router.isReady();
        const wrapper = mount(defineComponent({template: '<RouterView />'}), {attachTo: document.body, global: {
            plugins: [router, [VueQueryPlugin, {queryClient: context.queryClient}]],
            provide: {[pilotContextKey as symbol]: context},
            // Portal/focus-trap mechanics have their own real-browser journey. Keep the actual page,
            // editor, v-model and query observers together here to exercise draft component lifetime.
            stubs: {AppDialog: defineComponent({template: '<section role="dialog"><slot name="navigation" /><slot /><slot name="footer" /></section>'})},
        }});
        try {
            await flushPromises();
            const edit = wrapper.findAll('button').find(button => button.text() === 'Entity settings');
            expect(edit).toBeDefined();
            await edit!.trigger('click');
            await flushPromises();
            const description = wrapper.get<HTMLTextAreaElement>('textarea[name="description"]');
            await description.setValue('Local description to preserve');
            description.element.focus();
            const originalNode = description.element;
            expect(document.activeElement).toBe(originalNode);

            // Session preference refresh changes the localized query key without changing actor identity.
            context.locale.value = 'de';
            await nextTick();
            await flushPromises();
            expect(wrapper.get('textarea[name="description"]').element).toBe(originalNode);
            expect(originalNode.value).toBe('Local description to preserve');
            expect(document.activeElement).toBe(originalNode);
            releaseGermanList();
            await flushPromises();
            expect(wrapper.get('textarea[name="description"]').element).toBe(originalNode);
            expect(originalNode.value).toBe('Local description to preserve');
            expect(document.activeElement).toBe(originalNode);
        } finally {
            releaseGermanList();
            wrapper.unmount();
            await context.queryClient.cancelQueries();
            context.queryClient.clear();
        }
    });
});
