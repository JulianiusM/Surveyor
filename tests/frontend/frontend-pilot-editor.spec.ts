// @vitest-environment happy-dom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {flushPromises, mount} from '@vue/test-utils';
import {defineComponent, nextTick, ref} from 'vue';
import {createMemoryHistory, createRouter} from 'vue-router';
import {VueQueryPlugin} from '@tanstack/vue-query';
import I18NextVue from 'i18next-vue';
import PackingPage from '../../src/frontend/features/packing/PackingPage.vue';
import PackingCreatePage from '../../src/frontend/features/packing/PackingCreatePage.vue';
import PackingSettings from '../../src/frontend/features/packing/PackingSettings.vue';
import MetadataFields from '../../src/frontend/features/packing/MetadataFields.vue';
import OverviewRegion from '../../src/frontend/features/overview/OverviewRegion.vue';
import AppDialog from '../../src/frontend/components/AppDialog.vue';
import InlineCell from '../../src/frontend/components/InlineCell.vue';
import {createPilotContext, pilotContextKey} from '../../src/frontend/app/context';
import {packingKeys} from '../../src/frontend/app/queryKeys';
import {useAuthorizedImage} from '../../src/frontend/composables/authorizedImage';
import {PilotApi} from '../../src/frontend/app/api';
import {ApiFailure, ObsoleteRequestError, UnconfirmedResponseError} from '../../src/frontend/app/transport';
import {PackingApi} from '../../src/frontend/features/packing/api';
import {startInlineEdit} from '../../src/public/js/shared/inline-edit';
import {createPermissionBundle} from '../factories/frontendCoreDynamicFactory';
import type {components} from '../../src/types/api/v1';
import type {PilotAuthorizedImage} from '../../src/types/FrontendPilotUiTypes';

const listId = '11111111-1111-4111-8111-111111111111';
const profileId = '22222222-2222-4222-8222-222222222222';
const session: components['schemas']['SessionView'] = {kind: 'account', deployment: {buildId: 'fixture', apiCompatibility: 'v1-pilot-2026-10-07'}, context: 'component-context-1234567890',
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
    headerUrl: null, headerVersion: null, settingsToken: '"edit-settings"', editableFields: ['title', 'description'],
    currentEvent: null, access: null,
    archive: {direct: false, inherited: false, archivedAt: null, autoArchivePaused: false, eventUrl: null},
    capabilities: {editHeader: false, linkEvent: false, managePermissions: false, duplicate: false,
        remove: false, archive: false, restore: false, manageArchive: false}};

function json(value: unknown): Response {
    return new Response(JSON.stringify(value), {headers: {'Content-Type': 'application/json',
        'X-Surveyor-Context': session.context, ETag: '"original"'}});
}

/** These HTTP outcomes cannot establish read denial: each fails the shared wire
 * contract, despite using a status normally associated with loss of access. */
function unusableRead(status: number, representation: 'html' | 'malformed' | 'mismatched'): Response {
    const headers = {'Content-Type': representation === 'html' ? 'text/html' : 'application/problem+json',
        'X-Surveyor-Context': session.context};
    if (representation === 'html') return new Response('<html>Proxy failed</html>', {status, headers});
    const body = representation === 'mismatched'
        ? {type: 'about:blank', title: 'Proxy failure', status: 400, detail: 'Response and Problem disagree.', requestId: 'mismatched-read'}
        : {status, detail: 'The common Problem contract is missing.'};
    return new Response(JSON.stringify(body), {status, headers});
}

const originalSurveyor = window.Surveyor;
afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    window.Surveyor = originalSurveyor;
    document.body.innerHTML = '';
});

describe('shared inline input constraints', () => {
    it.each(['title', 'description'] as const)('preserves the native initial caret for an existing %s', async field => {
        const permission = field === 'description' ? 'EDIT_DESC' : 'EDIT_TITLE';
        window.Surveyor = {permissions: createPermissionBundle([], [permission], 'item')};
        const table = document.createElement('table');
        table.innerHTML = `<tbody><tr><td data-edit="${field}" data-id="item">Existing equipment</td></tr></tbody>`;
        document.body.append(table);
        const nativeCell = table.querySelector<HTMLElement>('td')!;
        startInlineEdit(nativeCell, '/api/packing/list/item', permission, true);
        const nativeInput = nativeCell.querySelector('input')!;
        // The native editor is the oracle: focus alone must not become select-all.
        // Real-browser coverage also compares the first keystroke in number controls,
        // whose selectionStart/End are intentionally unavailable in the DOM API.
        const nativeSelection = [nativeInput.selectionStart, nativeInput.selectionEnd];
        const context = createPilotContext({session}, true);
        const router = createRouter({history: createMemoryHistory(), routes: [
            {path: '/', component: defineComponent({template: '<p>Editor host</p>'})},
        ]});
        await router.push('/');
        const save = vi.fn(async () => true);
        const wrapper = mount(InlineCell, {attachTo: document.body,
            props: {value: 'Existing equipment', token: '"original"', editable: true, label: field, save},
            global: {plugins: [router, [I18NextVue, {i18next: context.i18next}]],
                provide: {[pilotContextKey as symbol]: context}},
        });
        try {
            await wrapper.get('td').trigger('dblclick');
            const input = wrapper.get<HTMLInputElement>('input').element;
            expect(document.activeElement).toBe(input);
            expect([input.selectionStart, input.selectionEnd]).toEqual(nativeSelection);
            await wrapper.get('input').trigger('keydown', {key: 'Escape'});
            expect(save).not.toHaveBeenCalled();
        } finally { wrapper.unmount(); context.queryClient.clear(); }
    });

    it.each(['0', '-1', '', '1.5'])('delivers the native capacity editor value %j without implicit form validation', async value => {
        // Compare the existing browser editor itself, not a recreated input policy.
        // Its HTTP response rejects only to avoid the native delayed page reload;
        // this test concerns delivery, while the controller owns acceptance.
        const send = vi.fn(async function rejectNativeFixture() {
            return new Response(JSON.stringify({status: 'error', message: 'Fixture stops persistence'}),
                {headers: {'Content-Type': 'application/json'}});
        });
        vi.stubGlobal('fetch', send);
        window.Surveyor = {permissions: createPermissionBundle([], ['EDIT_CAPACITY'], 'item')};
        const table = document.createElement('table');
        table.innerHTML = '<tbody><tr><td data-edit="maxAssignees" data-id="item">'
            + '<span data-count>0</span> / <span data-max>2</span></td></tr></tbody>';
        document.body.append(table);
        const cell = table.querySelector<HTMLElement>('td')!;
        startInlineEdit(cell, '/api/packing/list/item', 'EDIT_CAPACITY', true);
        const nativeInput = cell.querySelector('input')!;
        expect(nativeInput.required).toBe(false);
        expect(nativeInput.min).toBe('');
        expect(nativeInput.max).toBe('');
        const nativeValidity = vi.spyOn(nativeInput, 'reportValidity');
        nativeInput.value = value;
        nativeInput.dispatchEvent(new Event('blur'));
        await flushPromises();
        expect(send).toHaveBeenCalledOnce();
        const nativeBody = JSON.parse((send.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
        expect(nativeBody).toEqual({field: 'maxAssignees', value, expectedValue: 2});
        expect(nativeValidity).not.toHaveBeenCalled();

        const save = vi.fn(async () => true);
        const context = createPilotContext({session}, true);
        const router = createRouter({history: createMemoryHistory(), routes: [
            {path: '/', component: defineComponent({template: '<p>Editor host</p>'})},
        ]});
        await router.push('/');
        const wrapper = mount(InlineCell, {attachTo: document.body,
            props: {value: 2, token: '"capacity-original"', editable: true, numeric: true, label: 'Capacity', save},
            global: {plugins: [router, [I18NextVue, {i18next: context.i18next}]],
                provide: {[pilotContextKey as symbol]: context}},
        });
        try {
            await wrapper.get('td').trigger('dblclick');
            const pilotInput = wrapper.get<HTMLInputElement>('input');
            expect(pilotInput.element.required).toBe(nativeInput.required);
            expect(pilotInput.element.min).toBe(nativeInput.min);
            expect(pilotInput.element.max).toBe(nativeInput.max);
            const pilotValidity = vi.spyOn(pilotInput.element, 'reportValidity');
            await pilotInput.setValue(value);
            await pilotInput.trigger('keydown', {key: 'Enter'});
            await flushPromises();
            expect(save).toHaveBeenCalledExactlyOnceWith(value, '"capacity-original"');
            expect(pilotValidity).not.toHaveBeenCalled();
        } finally { wrapper.unmount(); context.queryClient.clear(); }
    });
});

describe('shared dialog focus', () => {
    it.each([undefined, '#missing-body-field'])('uses native container focus without a usable body target (%s)', async initialFocus => {
        const trigger = document.createElement('button');
        document.body.append(trigger);
        trigger.focus();
        const context = createPilotContext({session}, true);
        const wrapper = mount(AppDialog, {attachTo: document.body,
            props: {open: false, title: 'Entity settings', initialFocus},
            slots: {default: '<label for="title">Title</label><input id="title" />'},
            global: {plugins: [[I18NextVue, {i18next: context.i18next}]], provide: {[pilotContextKey as symbol]: context}},
        });
        try {
            await wrapper.setProps({open: true});
            await flushPromises();
            const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
            expect(document.activeElement).toBe(dialog);
            expect(document.activeElement).not.toBe(dialog.querySelector('.btn-close'));
            await wrapper.setProps({open: false});
            await flushPromises();
            await new Promise(resolve => setTimeout(resolve, 0));
            expect(document.activeElement).toBe(trigger);
        } finally { wrapper.unmount(); context.queryClient.clear(); }
    });

    it('focuses the requested body field and restores each invoker when a closed dialog stays mounted', async () => {
        const first = document.createElement('button');
        const second = document.createElement('button');
        document.body.append(first, second);
        const context = createPilotContext({session}, true);
        const wrapper = mount(AppDialog, {attachTo: document.body,
            props: {open: false, title: 'Choose an event', fullscreenOnSmall: false, initialFocus: '#event-search'},
            slots: {default: '<label for="event-search">Search events</label><input id="event-search" />'},
            global: {plugins: [[I18NextVue, {i18next: context.i18next}]], provide: {[pilotContextKey as symbol]: context}},
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
async function mountPackingView(view: components['schemas']['PackingListView'],
                                handler?: (request: Request) => Promise<Response>,
                                path = `/frontend-pilot/packing/${listId}`) {
    const request = vi.fn(async function readPackingFixture(input: RequestInfo | URL) {
        if (handler) return handler(input as Request);
        if (new URL((input as Request).url).pathname.endsWith('/header')) return new Response(new Blob(['image']), {
            headers: {'Content-Type': 'image/png', 'X-Surveyor-Context': session.context}});
        return json(view);
    });
    const context = createPilotContext({session}, true, request);
    context.hydrated.value = true;
    const router = createRouter({history: createMemoryHistory(), routes: [
        {path: '/frontend-pilot/packing/:listId', component: PackingPage},
        {path: '/frontend-pilot/packing/:listId/duplicate', component: PackingCreatePage},
    ]});
    await router.push(path);
    await router.isReady();
    const wrapper = mount(defineComponent({template: '<RouterView />'}), {attachTo: document.body, global: {
        plugins: [router, [VueQueryPlugin, {queryClient: context.queryClient}], [I18NextVue, {i18next: context.i18next}]],
        provide: {[pilotContextKey as symbol]: context},
    }});
    await flushPromises();
    async function dispose() {
        wrapper.unmount();
        await context.queryClient.cancelQueries();
        context.queryClient.clear();
    }
    return {wrapper, context, request, dispose};
}

describe('packing presentation compatibility', () => {
    it.each([
        ['metadata', 403, 'html', false],
        ['metadata', 401, 'mismatched', true],
        ['metadata', 404, 'malformed', false],
        ['settings', 401, 'html', false],
        ['settings', 403, 'malformed', true],
        ['settings', 404, 'mismatched', false],
        ['detail', 401, 'malformed', true],
        ['detail', 403, 'mismatched', false],
        ['detail', 404, 'html', false],
    ] as const)('retains the actual dialog draft after unusable %s %s %s (unknown write: %s)',
        async (resource, status, representation, unknownWrite) => {
            let unusable = false;
            let writes = 0;
            const mounted = await mountPackingView(list, async function readEditablePacking(request): Promise<Response> {
                const path = new URL(request.url).pathname;
                if (request.method === 'PATCH') {
                    writes++;
                    throw new TypeError('The metadata command response was lost');
                }
                const endpoint = path.endsWith('/metadata') ? 'metadata'
                    : path.endsWith('/settings') ? 'settings' : 'detail';
                if (unusable && endpoint === resource) return unusableRead(status, representation);
                if (endpoint === 'metadata') return json(metadata);
                return json(path.endsWith('/settings') ? settings : list);
            });
            try {
                await mounted.wrapper.findAll('button').find(button => button.text() === 'Entity settings')!.trigger('click');
                await flushPromises();
                const fields = mounted.wrapper.findComponent(MetadataFields);
                const input = fields.get<HTMLInputElement>('[name="title"]');
                await input.setValue('Unsubmitted equipment title');
                if (unknownWrite) {
                    await fields.get('#packing-metadata-form').trigger('submit');
                    await flushPromises();
                    expect(writes).toBe(1);
                }
                const focused = unknownWrite ? fields.findAll('button').find(button => button.text() === 'Refresh')!.element
                    : input.element;
                focused.focus();
                unusable = true;
                // Replace only the HTTP boundary. The real query, nested editor, page
                // access-loss handler and root command/draft lifetime remain mounted.
                const queryKey = resource === 'metadata' ? packingKeys.metadata(session.context, listId)
                    : resource === 'settings' ? packingKeys.settings(session.context, listId)
                        : packingKeys.detail(session.context, listId);
                const readMessage = mounted.context.messages.value.t('state.stale');
                const confirmedAt = mounted.context.queryClient.getQueryState(queryKey)!.dataUpdatedAt;
                await mounted.context.queryClient.refetchQueries({queryKey});
                await flushPromises();
                expect(mounted.wrapper.findComponent(PackingSettings).exists()).toBe(true);
                expect(fields.get<HTMLInputElement>('[name="title"]').element).toBe(input.element);
                expect(input.element.value).toBe('Unsubmitted equipment title');
                expect(document.activeElement).toBe(focused);
                expect(mounted.context.ready.value).toBe(true);
                expect(mounted.context.session.value.context).toBe(session.context);
                expect(mounted.context.queryClient.getQueryState(queryKey)?.error).toMatchObject({confirmedRejection: false});
                expect(mounted.wrapper.find('h1').exists()).toBe(true);
                // The real dialog uses a portal outside RouterView's root. Inspect
                // the displayed document for its warning/receipt, keeping portals
                // and focus management active instead of substituting a dialog stub.
                expect(document.body.textContent).toContain(readMessage);
                expect(document.querySelector('[data-last-successful-refresh] time')!.getAttribute('datetime')).toBe(
                    new Date(confirmedAt).toISOString(),
                );
                expect(fields.findAll('button').filter(button => button.text() === 'Refresh')).toHaveLength(
                    resource === 'metadata' || unknownWrite ? 1 : 0,
                );
                if (resource === 'metadata') {
                    await fields.findAll('button').find(button => button.text() === 'Refresh')!.trigger('click');
                    await flushPromises();
                    expect(fields.findAll('[role="status"]').filter(notice => notice.text().includes(readMessage))).toHaveLength(1);
                    expect(fields.findAll('button').filter(button => button.text() === 'Refresh')).toHaveLength(1);
                    expect(input.element.value).toBe('Unsubmitted equipment title');
                    expect(fields.get('[data-last-successful-refresh] time').attributes('datetime')).toBe(
                        new Date(confirmedAt).toISOString(),
                    );
                    if (!unknownWrite && status === 403) {
                        mounted.context.locale.value = 'de';
                        await flushPromises();
                        expect(fields.get('[data-last-successful-refresh] time').text()).toContain('Zuletzt erfolgreich aktualisiert:');
                        expect(fields.get('[data-last-successful-refresh] time').attributes('datetime')).toBe(
                            new Date(confirmedAt).toISOString(),
                        );
                        mounted.context.locale.value = 'en';
                        await flushPromises();
                    }
                }

                // A healthy read restores authority without deciding an uncertain write
                // or discarding ordinary dirty values. Review remains an explicit action;
                // neither the failed read nor its recovery can replay the PATCH.
                unusable = false;
                await mounted.context.queryClient.refetchQueries({queryKey});
                await flushPromises();
                expect(input.element.value).toBe('Unsubmitted equipment title');
                expect(mounted.context.queryClient.getQueryState(queryKey)?.error).toBeNull();
                expect(document.body.textContent).not.toContain(readMessage);
                expect(document.querySelector('[data-last-successful-refresh]')).toBeNull();
                if (unknownWrite) {
                    expect(fields.findAll('button').find(button => button.text() === 'Save properties')!.attributes('disabled')).toBeDefined();
                    await fields.findAll('button').find(button => button.text() === 'Refresh')!.trigger('click');
                    await flushPromises();
                    expect(fields.text()).toContain('The previous save may already have succeeded.');
                    const review = fields.findAll('button').find(button => button.text() === 'Review changes')!;
                    expect(review.attributes('disabled')).toBeUndefined();
                    await review.trigger('click');
                    await flushPromises();
                    expect(fields.findAll('button').find(button => button.text() === 'Save properties')!.attributes('disabled')).toBeUndefined();
                    expect(input.element.value).toBe('Unsubmitted equipment title');
                }
                expect(writes).toBe(unknownWrite ? 1 : 0);
            } finally { await mounted.dispose(); }
    });

    it.each([[404, 'html'], [403, 'mismatched'], [404, 'malformed']] as const)(
        'recovers cold duplicate admission after unusable %s %s without a denial card or POST', async (status, representation) => {
            let unavailable = true;
            const defaults = {participant: 0, guest: 0, authenticated: 0, public: 0};
            const duplicate: components['schemas']['PackingDuplicate'] = {title: 'Admitted copy', description: null,
                eventId: null, items: [{title: 'Tent', description: null, maxAssignees: 1, requiredByAll: false}],
                defaultPermissions: defaults, formContext: {defaults, permissions: [], presets: []}};
            const mounted = await mountPackingView(list, async function readDuplicate(request): Promise<Response> {
                if (unavailable) return unusableRead(status, representation);
                return json(new URL(request.url).pathname.endsWith('/events')
                    ? {items: [], nextCursor: null, selected: null} : duplicate);
            }, `/frontend-pilot/packing/${listId}/duplicate`);
            try {
                expect(mounted.wrapper.get('h1').text()).toBe(mounted.context.messages.value.t('packing.create'));
                expect(mounted.wrapper.text()).toContain(mounted.context.messages.value.t('state.loadFailed'));
                expect(mounted.wrapper.find('.pilot-page-message').exists()).toBe(false);
                expect(mounted.wrapper.find('[data-last-successful-refresh]').exists()).toBe(false);
                unavailable = false;
                await mounted.wrapper.findAll('button').find(button => button.text() === mounted.context.messages.value.t('common.retry'))!.trigger('click');
                await flushPromises();
                expect(mounted.wrapper.get<HTMLInputElement>('#create-title').element.value).toBe('Admitted copy');
                expect(mounted.wrapper.findAll('tbody tr')).toHaveLength(1);
                expect(mounted.wrapper.text()).not.toContain(mounted.context.messages.value.t('state.loadFailed'));
                expect(mounted.request.mock.calls.map(([request]) => (request as Request).method)).toEqual(['GET', 'GET']);
            } finally { await mounted.dispose(); }
    });

    it('shares image lifetime with an injected reader and retires held versions, actor changes and disposal', async () => {
        // Actor invalidation asks the session owner to recover. Keep that real
        // production transition, but replace its external HTTP boundary too: this
        // fixture intentionally leaves the invalidated actor unavailable.
        const request = vi.fn(async function unavailableBootstrap(): Promise<Response> {
            throw new TypeError('Fixture identity recovery remains unavailable');
        });
        const context = createPilotContext({session}, true, request);
        const resource = ref('another-feature-id');
        const version = ref<string | null>('v1');
        const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValueOnce('blob:first').mockReturnValueOnce('blob:second');
        const revokeUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
        let releaseHeld!: (blob: Blob) => void;
        let reads = 0;
        const read = vi.fn(function readImage(_id: string, _scope: unknown, _signal: AbortSignal): Promise<Blob> {
            reads++;
            if (reads === 2) return new Promise(function holdImage(resolve) { releaseHeld = resolve; });
            return Promise.resolve(new Blob(['image'], {type: 'image/png'}));
        });
        const host = defineComponent({
            setup: function bindImage() { return {image: useAuthorizedImage(resource, version, read).source}; },
            template: '<img v-if="image" :src="image" alt="Authorized feature image" />',
        });
        const wrapper = mount(host, {global: {plugins: [[I18NextVue, {i18next: context.i18next}]],
            provide: {[pilotContextKey as symbol]: context}}});
        try {
            await flushPromises();
            expect(wrapper.get('img').attributes('src')).toBe('blob:first');
            expect(read.mock.calls[0][0]).toBe('another-feature-id');

            version.value = 'v2';
            await flushPromises();
            expect(wrapper.find('img').exists()).toBe(false);
            expect(revokeUrl).toHaveBeenCalledWith('blob:first');
            const heldSignal = read.mock.calls[1][2];
            version.value = 'v3';
            await flushPromises();
            expect(heldSignal.aborted).toBe(true);
            expect(wrapper.get('img').attributes('src')).toBe('blob:second');
            releaseHeld(new Blob(['obsolete'], {type: 'image/png'}));
            await flushPromises();
            expect(createUrl).toHaveBeenCalledTimes(2);

            // Actor retirement removes the authorized image before recovery. A
            // held endpoint cannot reintroduce another actor's completed bytes.
            context.invalidateIdentity();
            await flushPromises();
            expect(wrapper.find('img').exists()).toBe(false);
            expect(revokeUrl).toHaveBeenCalledWith('blob:second');
            expect(read).toHaveBeenCalledTimes(3);
            expect(request).toHaveBeenCalledOnce();
        } finally { wrapper.unmount(); context.start()(); }
    });

    it('recovers only failed images with bounded read cadence and retains a healthy same-version URL', async () => {
        vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout', 'Date']});
        const context = createPilotContext({session}, true);
        const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:recovered');
        const revokeUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
        let owner!: PilotAuthorizedImage;
        let attempts = 0;
        const read = vi.fn(async function readRecoveringImage(): Promise<Blob> {
            if (++attempts < 3) throw new TypeError('Temporary image connection failure');
            return new Blob(['image'], {type: 'image/png'});
        });
        const host = defineComponent({
            setup: function bindRecoveringImage() {
                owner = useAuthorizedImage(ref(listId), ref('unchanged-version'), read);
                return {image: owner.source};
            },
            template: '<img v-if="image" :src="image" alt="Recovered image" />',
        });
        const wrapper = mount(host, {global: {plugins: [[I18NextVue, {i18next: context.i18next}]],
            provide: {[pilotContextKey as symbol]: context}}});
        try {
            await flushPromises();
            expect(read).toHaveBeenCalledOnce();
            expect(wrapper.find('img').exists()).toBe(false);
            await vi.advanceTimersByTimeAsync(29_999);
            expect(read).toHaveBeenCalledOnce();
            await vi.advanceTimersByTimeAsync(1);
            await flushPromises();
            expect(read).toHaveBeenCalledTimes(2);
            await vi.advanceTimersByTimeAsync(59_999);
            expect(read).toHaveBeenCalledTimes(2);
            await vi.advanceTimersByTimeAsync(1);
            await flushPromises();
            expect(read).toHaveBeenCalledTimes(3);
            expect(wrapper.get('img').attributes('src')).toBe('blob:recovered');

            // Successful JSON delivery, locale changes and browser visibility all
            // retain downloaded bytes; recovery never becomes another healthy poll.
            await owner.refresh();
            context.locale.value = 'de';
            context.visible.value = false;
            context.visible.value = true;
            await vi.advanceTimersByTimeAsync(180_000);
            await flushPromises();
            expect(read).toHaveBeenCalledTimes(3);
            expect(createUrl).toHaveBeenCalledOnce();
            expect(revokeUrl).not.toHaveBeenCalled();
        } finally { wrapper.unmount(); context.start()(); }
        expect(revokeUrl).toHaveBeenCalledExactlyOnceWith('blob:recovered');
        await vi.advanceTimersByTimeAsync(180_000);
        expect(read).toHaveBeenCalledTimes(3);
    });

    it('pauses a collapsed image owner and preserves its server cooldown across manual recovery and visibility', async () => {
        vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout', 'Date']});
        const context = createPilotContext({session}, true);
        const enabled = ref(false);
        vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:admitted-after-deadline');
        vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
        let owner!: PilotAuthorizedImage;
        const read = vi.fn(async function readLimitedImage(): Promise<Blob> {
            if (read.mock.calls.length === 1) throw new ApiFailure(429, null, 90_000);
            return new Blob(['image'], {type: 'image/png'});
        });
        const host = defineComponent({
            setup: function bindLimitedImage() {
                owner = useAuthorizedImage(ref(listId), ref('same-version'), read, enabled);
                return {image: owner.source};
            },
            template: '<img v-if="image" :src="image" alt="Admitted image" />',
        });
        const wrapper = mount(host, {global: {plugins: [[I18NextVue, {i18next: context.i18next}]],
            provide: {[pilotContextKey as symbol]: context}}});
        try {
            await flushPromises();
            expect(read).not.toHaveBeenCalled();
            enabled.value = true;
            await flushPromises();
            expect(read).toHaveBeenCalledOnce();
            await owner.refresh();
            await vi.advanceTimersByTimeAsync(30_000);
            context.visible.value = false;
            await vi.advanceTimersByTimeAsync(10_000);
            context.visible.value = true;
            await flushPromises();
            await owner.refresh();
            await vi.advanceTimersByTimeAsync(49_999);
            expect(read).toHaveBeenCalledOnce();
            await vi.advanceTimersByTimeAsync(1);
            await flushPromises();
            expect(read).toHaveBeenCalledTimes(2);
            expect(wrapper.get('img').attributes('src')).toBe('blob:admitted-after-deadline');
        } finally { wrapper.unmount(); context.start()(); }
    });

    it('ignores a retired version failure and aborts a pending image when its feature is collapsed', async () => {
        vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout', 'Date']});
        const context = createPilotContext({session}, true);
        const version = ref('held-version');
        const enabled = ref(true);
        let rejectHeld!: (failure: Error) => void;
        let resolveHidden!: (blob: Blob) => void;
        vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:current-version');
        vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
        const read = vi.fn(function readHeldImage(_id: string, _scope: unknown, _signal: AbortSignal): Promise<Blob> {
            if (read.mock.calls.length === 1) return new Promise(function holdRetiredImage(_resolve, reject) { rejectHeld = reject; });
            if (read.mock.calls.length === 3) return new Promise(function holdHiddenImage(resolve) { resolveHidden = resolve; });
            return Promise.resolve(new Blob(['image'], {type: 'image/png'}));
        });
        const host = defineComponent({
            setup: function bindHeldImage() { return {image: useAuthorizedImage(ref(listId), version, read, enabled).source}; },
            template: '<img v-if="image" :src="image" alt="Current image" />',
        });
        const wrapper = mount(host, {global: {plugins: [[I18NextVue, {i18next: context.i18next}]],
            provide: {[pilotContextKey as symbol]: context}}});
        try {
            await flushPromises();
            version.value = 'current-version';
            await flushPromises();
            expect(read.mock.calls[0][2].aborted).toBe(true);
            rejectHeld(new ApiFailure(429, null, 90_000));
            await flushPromises();
            await vi.advanceTimersByTimeAsync(90_000);
            expect(read).toHaveBeenCalledTimes(2);
            expect(wrapper.get('img').attributes('src')).toBe('blob:current-version');

            version.value = 'hidden-version';
            await flushPromises();
            enabled.value = false;
            expect(read.mock.calls[2][2].aborted).toBe(true);
            resolveHidden(new Blob(['obsolete'], {type: 'image/png'}));
            await flushPromises();
            expect(wrapper.find('img').exists()).toBe(false);
            enabled.value = true;
            await flushPromises();
            expect(read).toHaveBeenCalledTimes(4);
            expect(wrapper.get('img').attributes('src')).toBe('blob:current-version');
        } finally { wrapper.unmount(); context.start()(); }
    });

    it('recovers a missing packing header after manual Refresh with an equal JSON version', async () => {
        vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:packing-recovered');
        const revokeUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
        const view = {...list, headerUrl: `/packing/${listId}/header`, headerVersion: 'unchanged-header-version'};
        let headerReads = 0;
        const mounted = await mountPackingView(view, async function readRecoveringPacking(request): Promise<Response> {
            if (!new URL(request.url).pathname.endsWith('/header')) return json(view);
            if (++headerReads === 1) throw new TypeError('Temporary image connection failure');
            return new Response(new Blob(['image']), {headers: {'Content-Type': 'image/png',
                'X-Surveyor-Context': session.context}});
        });
        try {
            expect(headerReads).toBe(1);
            expect(mounted.wrapper.find('.card-header img').exists()).toBe(false);
            await mounted.wrapper.get('button[aria-label="Refresh"]').trigger('click');
            await flushPromises();
            expect(headerReads).toBe(2);
            expect(mounted.wrapper.get('.card-header img').attributes('src')).toBe('blob:packing-recovered');
            await mounted.wrapper.get('button[aria-label="Refresh"]').trigger('click');
            await flushPromises();
            expect(headerReads).toBe(2);
            expect(revokeUrl).not.toHaveBeenCalled();
        } finally { await mounted.dispose(); }
    });

    it('recovers a missing Overview packing image after equal region reads and retains its healthy URL', async () => {
        vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:overview-recovered');
        const revokeUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
        const card: components['schemas']['OverviewCard'] = {id: listId, type: 'packing', title: list.title,
            description: null, url: `/frontend-pilot/packing/${listId}`, headerUrl: `/packing/${listId}/header`,
            headerVersion: 'same-overview-image-version', eventContext: null, children: null,
            archived: false, inheritedArchived: false, visibility: 'default', overviewHidden: false,
            capabilities: {archive: false, restore: false, duplicate: false, remove: false}};
        const region: components['schemas']['OverviewRegion'] = {collection: 'owner', region: 'main', q: '',
            type: 'all', availableTypes: ['packing'], page: 1, childPage: 1, eventId: null, pageSize: 24,
            totalEntities: 1, hiddenEntities: 0, regionEntities: 1, matchingEntities: 1,
            totalCards: 1, totalChildren: 0, hasPrevious: false, hasNext: false, parent: null, items: [card]};
        let headerReads = 0;
        const request = vi.fn(async function readOverviewFixture(input: RequestInfo | URL): Promise<Response> {
            if (!new URL((input as Request).url).pathname.endsWith('/header')) return json(region);
            if (++headerReads === 1) throw new TypeError('Temporary card image failure');
            return new Response(new Blob(['image']), {headers: {'Content-Type': 'image/png',
                'X-Surveyor-Context': session.context}});
        });
        const context = createPilotContext({session}, true, request);
        context.hydrated.value = true;
        const router = createRouter({history: createMemoryHistory(), routes: [
            {path: '/frontend-pilot', component: OverviewRegion, props: {collection: 'owner', region: 'main'}},
        ]});
        await router.push('/frontend-pilot');
        const wrapper = mount(defineComponent({template: '<RouterView />'}), {attachTo: document.body, global: {
            plugins: [router, [VueQueryPlugin, {queryClient: context.queryClient}],
                [I18NextVue, {i18next: context.i18next}]],
            provide: {[pilotContextKey as symbol]: context},
        }});
        try {
            await flushPromises();
            expect(headerReads).toBe(1);
            expect(wrapper.find('article img').exists()).toBe(false);
            const refresh = wrapper.findAll('button').find(button => button.text() === 'Refresh')!;
            expect(refresh).toBeDefined();
            await refresh.trigger('click');
            await flushPromises();
            expect(headerReads).toBe(2);
            expect(wrapper.get('article img').attributes('src')).toBe('blob:overview-recovered');
            await refresh.trigger('click');
            await flushPromises();
            expect(headerReads).toBe(2);
            expect(revokeUrl).not.toHaveBeenCalled();
        } finally {
            wrapper.unmount();
            await context.queryClient.cancelQueries();
            context.start()();
        }
    });

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
            maxAssignees: null, assignedCount: 0, selfAssigned: false, assignees: [], editToken: '"edit-item"',
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

describe('authorized binary transport', () => {
    it.each([
        ['known', {type: 'urn:surveyor:problem:forbidden', title: 'Forbidden', status: 403,
            detail: 'This image is unavailable.', requestId: 'image-denial', code: 'FORBIDDEN',
            messageKey: 'api:errors.FORBIDDEN', params: {}}, true, 'This image is unavailable.'],
        ['safe future', {type: 'urn:surveyor:problem:future-image', title: 'Future image rejection', status: 403,
            detail: 'A future image rule rejected this read.', requestId: 'future-image-denial'}, true,
            'A future image rule rejected this read.'],
        ['malformed', {status: 403, detail: 'Unvalidated image detail'}, false, 'HTTP 403'],
    ])('uses the shared validated error contract for %s JSON failures despite binary success parsing',
        async (_kind, body, confirmed, message) => {
            const request = vi.fn(async function denyImage(): Promise<Response> {
                return new Response(JSON.stringify(body), {status: 403, headers: {'Content-Type': 'application/problem+json',
                    'X-Surveyor-Context': session.context}});
            });
            const identityLost = vi.fn();
            const api = new PackingApi(new PilotApi(() => true, identityLost, request));
            const scope = {context: session.context, csrfToken: session.csrfToken, locale: 'en', epoch: 0};
            await expect(api.header(listId, scope)).rejects.toMatchObject({status: 403, confirmedRejection: confirmed, message});
            expect(identityLost).not.toHaveBeenCalled();
        });

    it('shares an image Retry-After deadline across manual callers and locales without requesting early', async () => {
        const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
        let attempts = 0;
        const request = vi.fn(async function readLimitedBinary(): Promise<Response> {
            if (++attempts === 1) return new Response('{}', {status: 429, headers: {'Content-Type': 'application/problem+json',
                'Retry-After': '90', 'X-Surveyor-Context': session.context}});
            return new Response(new Blob(['image']), {headers: {'Content-Type': 'image/png',
                'X-Surveyor-Context': session.context}});
        });
        const api = new PackingApi(new PilotApi(() => true, vi.fn(), request));
        const scope = {context: session.context, csrfToken: session.csrfToken, locale: 'en', epoch: 0};
        await expect(api.header(listId, scope)).rejects.toMatchObject({status: 429, retryAt: 91_000});
        now.mockReturnValue(2000);
        await expect(api.header(listId, {...scope, locale: 'de'})).rejects.toMatchObject({status: 429, retryAt: 91_000});
        expect(request).toHaveBeenCalledOnce();
        now.mockReturnValue(91_000);
        await expect(api.header(listId, scope)).resolves.toBeInstanceOf(Blob);
        expect(request).toHaveBeenCalledTimes(2);
    });

    it('retires an aborted binary response before its old Retry-After can block a newer image read', async () => {
        let finishOldResponse!: (response: Response) => void;
        const oldResponse = new Promise<Response>(function holdOldHeader(resolve) { finishOldResponse = resolve; });
        const request = vi.fn(async function readHeldBinary(_input: RequestInfo | URL): Promise<Response> {
            if (request.mock.calls.length === 1) return oldResponse;
            return new Response(new Blob(['current image']), {headers: {'Content-Type': 'image/png',
                'X-Surveyor-Context': session.context}});
        });
        const api = new PackingApi(new PilotApi(() => true, vi.fn(), request));
        const scope = {context: session.context, csrfToken: session.csrfToken, locale: 'en', epoch: 0};
        const controller = new AbortController();
        const retired = api.header(listId, scope, controller.signal);
        await flushPromises();
        controller.abort();
        expect((request.mock.calls[0][0] as Request).signal.aborted).toBe(true);

        // The external fixture intentionally ignores cancellation and completes
        // with a valid deadline. Only current reads may publish that shared state.
        finishOldResponse(new Response('{}', {status: 429, headers: {'Content-Type': 'application/problem+json',
            'Retry-After': '90', 'X-Surveyor-Context': session.context}}));
        await expect(retired).rejects.toBeInstanceOf(ObsoleteRequestError);
        await expect(api.header(listId, scope)).resolves.toBeInstanceOf(Blob);
        expect(request).toHaveBeenCalledTimes(2);
    });

    it.each([
        ['missing actor admission', {'Content-Type': 'image/png'}],
        ['HTML success', {'Content-Type': 'text/html', 'X-Surveyor-Context': session.context}],
    ])('keeps %s unconfirmed instead of publishing image bytes', async (_kind, headers) => {
        const request = vi.fn(async function readUnconfirmedImage(): Promise<Response> {
            return new Response(new Blob(['unconfirmed']), {headers});
        });
        const api = new PackingApi(new PilotApi(() => true, vi.fn(), request));
        const scope = {context: session.context, csrfToken: session.csrfToken, locale: 'en', epoch: 0};
        await expect(api.header(listId, scope)).rejects.toBeInstanceOf(UnconfirmedResponseError);
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
            plugins: [router, [VueQueryPlugin, {queryClient: context.queryClient}], [I18NextVue, {i18next: context.i18next}]],
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

            // Confirmed preference refresh invalidates the same machine-state key without changing actor identity.
            context.locale.value = 'de';
            const refreshing = context.queryClient.invalidateQueries();
            await nextTick();
            await flushPromises();
            expect(wrapper.get('textarea[name="description"]').element).toBe(originalNode);
            expect(originalNode.value).toBe('Local description to preserve');
            expect(document.activeElement).toBe(originalNode);
            releaseGermanList();
            await refreshing;
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
