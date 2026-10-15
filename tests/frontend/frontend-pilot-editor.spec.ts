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
import EntityHeaderEditor from '../../src/frontend/components/EntityHeaderEditor.vue';
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
        const permission = field === 'description' ? 'EDIT_DESC' : 'EDIT_META';
        window.Surveyor = {permissions: createPermissionBundle([], [permission], 'item')};
        const table = document.createElement('table');
        table.innerHTML = `<tbody><tr><td data-edit="${field}" data-id="item">Existing equipment</td></tr></tbody>`;
        document.body.append(table);
        const nativeCell = table.querySelector<HTMLElement>('td')!;
        startInlineEdit(nativeCell, '/api/packing/list/item');
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
        window.Surveyor = {permissions: createPermissionBundle([], ['EDIT_META'], 'item')};
        const table = document.createElement('table');
        table.innerHTML = '<tbody><tr><td data-edit="maxAssignees" data-id="item">'
            + '<span data-count>0</span> / <span data-max>2</span></td></tr></tbody>';
        document.body.append(table);
        const cell = table.querySelector<HTMLElement>('td')!;
        startInlineEdit(cell, '/api/packing/list/item');
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
        expect(nativeBody).toEqual({field: 'maxAssignees', value});
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
                                path = `/frontend-pilot/packing/${listId}`,
                                locale: components['schemas']['SessionView']['locale'] = 'en') {
    const request = vi.fn(async function readPackingFixture(input: RequestInfo | URL) {
        if (handler) return handler(input as Request);
        if (new URL((input as Request).url).pathname.endsWith('/header')) return new Response(new Blob(['image']), {
            headers: {'Content-Type': 'image/png', 'X-Surveyor-Context': session.context}});
        return json(view);
    });
    const context = createPilotContext({session: {...session, locale}}, true, request);
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
    return {wrapper, context, request, router, dispose};
}

describe('mounted Packing Quick Add confirmation', () => {
    it.each(['pending', 'failed'] as const)('releases confirmed input once while session verification is %s',
        async function preservesConfirmedQuickAdd(bootstrapState) {
            let finishBootstrap!: (response: Response) => void;
            let rejectBootstrap!: (failure: Error) => void;
            const bootstrap = new Promise<Response>(function holdBootstrap(resolve, reject) {
                finishBootstrap = resolve;
                rejectBootstrap = reject;
            });
            let bootstrapReads = 0;
            let writes = 0;
            const editableList = {...list, capabilities: {...list.capabilities, addItem: true}};
            const mounted = await mountPackingView(editableList, async function quickAddResponse(request): Promise<Response> {
                const path = new URL(request.url).pathname;
                if (path === '/api/v1/session') return ++bootstrapReads === 1 ? bootstrap : json(session);
                if (request.method === 'POST') {
                    writes++;
                    return new Response(JSON.stringify({id: '33333333-3333-4333-8333-333333333333'}), {
                        status: 201, headers: {'Content-Type': 'application/json', 'X-Surveyor-Context': session.context},
                    });
                }
                return json(editableList);
            });
            try {
                const title = mounted.wrapper.get<HTMLInputElement>('#quick-title');
                const description = mounted.wrapper.get<HTMLInputElement>('#quick-description');
                const capacity = mounted.wrapper.get<HTMLInputElement>('#quick-max');
                const form = title.element.closest('form')!;
                await title.setValue('Confirmed tent');
                await description.setValue('Already submitted equipment');
                await capacity.setValue('2');

                // Exercise the real session admission barrier, including its
                // failed state. The same actor can still submit a deliberate write.
                const checking = mounted.context.refreshSession().catch(ignoreBootstrapFailure);
                if (bootstrapState === 'failed') {
                    rejectBootstrap(new TypeError('Session verification unavailable'));
                    await checking;
                }
                expect(mounted.context.mayRead()).toBe(false);
                await mounted.wrapper.get('form').trigger('submit');
                await flushPromises();

                // The completed creation releases its actual controls even though
                // its follow-up read cannot dispatch. No unknown-review prompt or
                // retained creation input can offer the same item for resubmission.
                expect(writes).toBe(1);
                expect(title.element.value).toBe('');
                expect(description.element.value).toBe('');
                expect(capacity.element.value).toBe('1');
                expect(form.checkValidity()).toBe(false);
                expect(document.body.textContent).toContain(mounted.context.messages.value.t('state.savedRefreshFailed'));
                expect(document.body.textContent).not.toContain(mounted.context.messages.value.t('packing.reviewUnknownItem'));

                // Later session/detail recovery is read-only. It must not clear a
                // new local draft or replay the already acknowledged creation.
                await title.setValue('New unsaved item');
                if (bootstrapState === 'pending') {
                    finishBootstrap(json(session));
                    await checking;
                } else await mounted.context.refreshSession();
                await flushPromises();
                await mounted.wrapper.get('button[aria-label="Refresh"]').trigger('click');
                await flushPromises();
                expect(writes).toBe(1);
                expect(title.element.value).toBe('New unsaved item');
                expect(document.body.textContent).not.toContain(mounted.context.messages.value.t('state.savedRefreshFailed'));
            } finally {
                finishBootstrap(json(session));
                await mounted.dispose();
            }

            function ignoreBootstrapFailure(): void {
                // The production session owner retains its read-only recovery notice.
            }
        },
    );
});

/** Select real browser-owned bytes on the existing input. The production change
 * event synchronizes PackingSettings rather than a test-only file draft. */
function selectHeaderFile(input: HTMLInputElement): File {
    const selection = new DataTransfer();
    const file = new File(['synthetic header'], 'selected.png', {type: 'image/png'});
    selection.items.add(file);
    input.files = selection.files;
    input.dispatchEvent(new Event('change', {bubbles: true}));
    return file;
}

describe('mounted Packing creation file selection', () => {
    const secondId = '33333333-3333-4333-8333-333333333333';
    const defaults = {participant: 0, guest: 0, authenticated: 0, public: 0};

    /** Supply admitted read projections only. Navigation and draft retirement
     * execute through the production router/component; this fixture refuses writes. */
    function readDuplicate(request: Request): Promise<Response> {
        if (request.method !== 'GET') throw new Error('Creation navigation must not send a command.');
        const path = new URL(request.url).pathname;
        if (path.endsWith('/events')) return Promise.resolve(json({items: [], nextCursor: null, selected: null}));
        return Promise.resolve(json({title: path.includes(secondId) ? 'Second admitted copy' : 'First admitted copy',
            description: null, eventId: null,
            items: [{title: 'Tent', description: null, maxAssignees: 1, requiredByAll: false}],
            defaultPermissions: defaults, formContext: {defaults, permissions: [], presets: []}}));
    }

    it.each(['warm', 'cold'] as const)('releases the old chooser after accepted departure to a %s duplicate', async function releaseCommittedSelection(state) {
        const mounted = await mountPackingView(list, readDuplicate, `/frontend-pilot/packing/${listId}/duplicate`);
        const consent = vi.fn(() => true);
        vi.stubGlobal('confirm', consent);
        try {
            // A cached target initializes in the same render turn, retaining the
            // form node. A cold target is the control: its pending form unmounts.
            if (state === 'warm') {
                await mounted.router.push(`/frontend-pilot/packing/${secondId}/duplicate`);
                await flushPromises();
                await mounted.router.push(`/frontend-pilot/packing/${listId}/duplicate`);
                await flushPromises();
            }
            const input = mounted.wrapper.get<HTMLInputElement>('#create-header').element;
            selectHeaderFile(input);
            await flushPromises();

            await mounted.router.push(`/frontend-pilot/packing/${secondId}/duplicate`);
            await flushPromises();
            const nextInput = mounted.wrapper.get<HTMLInputElement>('#create-header').element;
            expect(mounted.wrapper.get<HTMLInputElement>('#create-title').element.value).toBe('Second admitted copy');
            expect(nextInput.files).toHaveLength(0);
            if (state === 'warm') expect(nextInput).toBe(input);
            expect(consent).toHaveBeenCalledTimes(1);

            // The new form has no retained file draft or invisible departure
            // work. Returning again requires no additional discard confirmation.
            await mounted.router.push(`/frontend-pilot/packing/${listId}/duplicate`);
            await flushPromises();
            expect(consent).toHaveBeenCalledTimes(1);
            expect(mounted.request.mock.calls.every(([incoming]) => (incoming as Request).method === 'GET')).toBe(true);
        } finally { await mounted.dispose(); }
    });

    it('retains the selected bytes after canceled departure, background reads and fragment movement', async function preserveLocalSelection() {
        const path = `/frontend-pilot/packing/${listId}/duplicate`;
        const mounted = await mountPackingView(list, readDuplicate, path);
        const consent = vi.fn(() => false);
        vi.stubGlobal('confirm', consent);
        try {
            const input = mounted.wrapper.get<HTMLInputElement>('#create-header').element;
            const file = selectHeaderFile(input);
            await mounted.wrapper.get('#create-title').setValue('Entered copy title');
            await mounted.router.push(`/frontend-pilot/packing/${secondId}/duplicate`);
            await flushPromises();
            expect(mounted.router.currentRoute.value.fullPath).toBe(path);
            expect(consent).toHaveBeenCalledTimes(1);

            // New definitions are read authority, not consent to discard copied
            // inputs. The same feature draft/FileList survives ordinary refresh.
            await mounted.context.queryClient.invalidateQueries({queryKey: packingKeys.duplicate(session.context, listId, undefined)});
            await flushPromises();
            await mounted.router.push(path + '#create-header');
            await flushPromises();
            expect(mounted.wrapper.get<HTMLInputElement>('#create-header').element).toBe(input);
            expect(input.files?.[0]).toBe(file);
            expect(mounted.wrapper.get<HTMLInputElement>('#create-title').element.value).toBe('Entered copy title');
            expect(consent).toHaveBeenCalledTimes(1);
            expect(mounted.request.mock.calls.every(([incoming]) => (incoming as Request).method === 'GET')).toBe(true);
        } finally { await mounted.dispose(); }
    });
});

describe('mounted Packing header upload selection', () => {
    it.each(['healthy', 'failed'] as const)('clears confirmed bytes on the same input after a %s follow-up read',
        async function confirmedHeaderSelection(followUp) {
            let writes = 0;
            const headerSettings = {...settings, editableFields: [],
                capabilities: {...settings.capabilities, editHeader: true}};
            const mounted = await mountPackingView(list, async function headerUploadResponse(request): Promise<Response> {
                const path = new URL(request.url).pathname;
                if (request.method === 'PUT' && path.endsWith('/header')) {
                    writes++;
                    return json({changed: true});
                }
                if (path.endsWith('/settings')) {
                    if (writes && followUp === 'failed') return new Response(JSON.stringify({type: 'about:blank',
                        title: 'Read unavailable', status: 503, detail: 'Saved header needs a later read.', requestId: 'header-follow-up'}),
                        {status: 503, headers: {'Content-Type': 'application/problem+json',
                            'X-Surveyor-Context': session.context, 'Retry-After': '3600'}});
                    return json({...headerSettings, headerUrl: writes ? `/packing/${listId}/header` : null,
                        headerVersion: writes ? `saved-header-${writes}` : null});
                }
                return json(path.endsWith('/metadata') ? metadata : list);
            });
            try {
                await mounted.wrapper.findAll('button').find(button => button.text() === 'Entity settings')!.trigger('click');
                await flushPromises();
                const editor = mounted.wrapper.findComponent(EntityHeaderEditor);
                const input = editor.get<HTMLInputElement>('input[type="file"]').element;
                const file = selectHeaderFile(input);
                await nextTick();
                expect(input.files?.[0]).toBe(file);

                // The real settings command confirms the upload. Read failure
                // cannot make its saved bytes another selected upload draft.
                await editor.findAll('button').find(button => button.text() === 'Upload')!.trigger('click');
                await flushPromises();
                expect(writes).toBe(1);
                expect(editor.get('input[type="file"]').element).toBe(input);
                expect(input.files?.length).toBe(0);
                expect(input.value).toBe('');

                if (followUp === 'healthy') {
                    // A cleared chooser and its feature draft agree: another
                    // Upload explains the missing choice without sending bytes.
                    await editor.findAll('button').find(button => button.text() === 'Upload')!.trigger('click');
                    await flushPromises();
                    expect(writes).toBe(1);
                    expect(document.body.textContent).toContain(mounted.context.messages.value.t('metadata.chooseImage'));

                    // The same filename can be deliberately selected again on
                    // this same input; only that new choice admits another upload.
                    selectHeaderFile(input);
                    await nextTick();
                    await editor.findAll('button').find(button => button.text() === 'Upload')!.trigger('click');
                    await flushPromises();
                    expect(writes).toBe(2);
                    expect(input.files?.length).toBe(0);
                } else {
                    expect(document.body.textContent).toContain(mounted.context.messages.value.t('state.savedRefreshFailed'));
                }
            } finally { await mounted.dispose(); }
        },
    );

    it.each(['rejected', 'unknown'] as const)('retains selected bytes through background reads and a %s upload',
        async function retainedHeaderSelection(outcome) {
            let writes = 0;
            let settingsToken = '"edit-original-header"';
            const mounted = await mountPackingView(list, async function retainedHeaderResponse(request): Promise<Response> {
                const path = new URL(request.url).pathname;
                if (request.method === 'PUT' && path.endsWith('/header')) {
                    writes++;
                    if (outcome === 'unknown') throw new TypeError('The upload response was lost');
                    return new Response(JSON.stringify({type: 'about:blank', title: 'Rejected', status: 400,
                        detail: 'The image was rejected.', requestId: 'rejected-header', code: 'VALIDATION_FAILED',
                        messageKey: 'api:errors.VALIDATION_FAILED', params: {}}), {status: 400,
                        headers: {'Content-Type': 'application/problem+json', 'X-Surveyor-Context': session.context}});
                }
                if (path.endsWith('/settings')) return json({...settings, settingsToken, editableFields: [],
                    capabilities: {...settings.capabilities, editHeader: true}});
                return json(path.endsWith('/metadata') ? metadata : list);
            });
            try {
                await mounted.wrapper.findAll('button').find(button => button.text() === 'Entity settings')!.trigger('click');
                await flushPromises();
                const editor = mounted.wrapper.findComponent(EntityHeaderEditor);
                const input = editor.get<HTMLInputElement>('input[type="file"]').element;
                const file = selectHeaderFile(input);
                await nextTick();

                // A newer settings receipt retains the selected bytes and their
                // original submission token. It is not upload confirmation.
                settingsToken = '"edit-background-header"';
                await mounted.context.queryClient.refetchQueries({queryKey: packingKeys.settings(session.context, listId)});
                await flushPromises();
                expect(editor.get('input[type="file"]').element).toBe(input);
                expect(input.files?.[0]).toBe(file);

                await editor.findAll('button').find(button => button.text() === 'Upload')!.trigger('click');
                await flushPromises();
                expect(writes).toBe(1);
                const upload = mounted.request.mock.calls.map(call => call[0] as Request)
                    .find(request => request.method === 'PUT');
                expect(upload?.headers.get('If-Match')).toBe('"edit-original-header"');
                expect(editor.get('input[type="file"]').element).toBe(input);
                expect(input.files?.[0]).toBe(file);

                await mounted.context.queryClient.refetchQueries({queryKey: packingKeys.settings(session.context, listId)});
                await flushPromises();
                expect(input.files?.[0]).toBe(file);
                expect(writes).toBe(1);
                if (outcome === 'unknown') {
                    expect(document.body.textContent).toContain(mounted.context.messages.value.t('state.unknownOutcome'));
                    expect(editor.findAll('button').find(button => button.text() === 'Upload')!.attributes('disabled')).toBeDefined();
                }
            } finally { await mounted.dispose(); }
        },
    );
});

/** Build an ordinary production row for browser-local checklist tests. The
 * Everyone color makes loss of a checked value visible independently of input state. */
function checklistItem(id = '33333333-3333-4333-8333-333333333333', position = 0): components['schemas']['PackingItemView'] {
    return {id, title: 'Everyone checklist item', description: null, position, requiredByAll: true,
        maxAssignees: 1, assignedCount: 0, selfAssigned: false, assignees: [], editToken: '"edit-checklist"',
        capabilities: {editTitle: false, editDescription: false, editCapacity: false, showTitleEdit: false,
            showCapacityEdit: false, editRequired: false, removeItem: false, removeAssignments: false}};
}

describe('mounted Packing checklist persistence', () => {
    it.each([
        {failure: 'getter', locale: 'en'},
        {failure: 'read', locale: 'de'},
    ] as const)('retains temporary Packed checks after a $failure failure and list refresh in $locale',
        async function unavailableChecklist({failure, locale}) {
            const item = checklistItem();
            let current = {...list, items: [item]};
            const storage = {getItem: vi.fn(function rejectStoredCheck(): never { throw new Error('Fixture storage blocked'); }),
                setItem: vi.fn(), removeItem: vi.fn()};
            const getter = vi.spyOn(window, 'localStorage', 'get');
            if (failure === 'getter') getter.mockImplementation(function rejectStorageAccess(): never { throw new Error('Fixture getter blocked'); });
            else getter.mockReturnValue(storage as unknown as Storage);

            // Only the HTTP boundary is replaced. The mounted production page owns
            // checkbox state, refresh adoption, row colors and localized feedback.
            const mounted = await mountPackingView(current, async function readChecklist() { return json(current); },
                `/frontend-pilot/packing/${listId}`, locale);
            try {
                const selector = `[data-item-id="${item.id}"]`;
                expect(mounted.wrapper.get(selector).classes()).toContain('table-info');
                expect(mounted.wrapper.get('[data-packed-storage-warning]').text())
                    .toContain(mounted.context.messages.value.t('packing.packedStorageUnavailable'));
                await mounted.wrapper.get(`${selector} input[type="checkbox"]`).setValue(true);
                expect(mounted.wrapper.get(selector).classes()).toContain('table-success');

                // A new/reordered row triggers the actual list reconciliation that
                // previously replaced the local selection with a failed-read false.
                const newcomer = checklistItem('44444444-4444-4444-8444-444444444444');
                current = {...list, items: [{...item, position: 1}, newcomer]};
                await mounted.wrapper.get(`button[aria-label="${mounted.context.messages.value.t('common.refresh')}"]`).trigger('click');
                await flushPromises();
                expect(mounted.wrapper.findAll('tbody tr')[0].attributes('data-item-id')).toBe(newcomer.id);
                expect(mounted.wrapper.get<HTMLInputElement>(`${selector} input[type="checkbox"]`).element.checked).toBe(true);
                expect(mounted.wrapper.get(selector).classes()).toContain('table-success');
                const warning = mounted.wrapper.get('.status-notice.alert-warning');
                expect(warning.attributes('role')).toBe('status');
                expect(warning.text()).toContain(mounted.context.messages.value.t('packing.packedStorageUnavailable'));
                expect(warning.text()).toContain(locale === 'de' ? 'Dein Browser' : 'Your browser');
                expect(mounted.request.mock.calls.every(([request]) => (request as Request).method === 'GET')).toBe(true);
            } finally { await mounted.dispose(); }
        });

    it.each([
        {operation: 'setItem', initial: null, selected: true, locale: 'en'},
        {operation: 'removeItem', initial: '1', selected: false, locale: 'de'},
    ] as const)('retains temporary Packed selection after failed $operation despite a healthy stale read in $locale',
        async function failedChecklistWrite({operation, initial, selected, locale}) {
            const item = checklistItem();
            let current = {...list, items: [item]};
            const packedKey = `packed_${listId}_${item.id}`;
            const values = new Map<string, string>();
            if (initial !== null) values.set(packedKey, initial);
            const storage = {getItem: vi.fn((key: string) => values.get(key) ?? null),
                setItem: vi.fn(function saveChecklist(key: string, value: string) { values.set(key, value); }),
                removeItem: vi.fn(function clearChecklist(key: string) { values.delete(key); })};
            storage[operation].mockImplementation(function rejectChecklistWrite(): never { throw new Error('Fixture persistence blocked'); });
            vi.spyOn(window, 'localStorage', 'get').mockReturnValue(storage as unknown as Storage);
            const mounted = await mountPackingView(current, async function readChecklist() { return json(current); },
                `/frontend-pilot/packing/${listId}`, locale);
            try {
                const selector = `[data-item-id="${item.id}"]`;
                expect(mounted.wrapper.get<HTMLInputElement>(`${selector} input[type="checkbox"]`).element.checked).toBe(!selected);
                await mounted.wrapper.get(`${selector} input[type="checkbox"]`).setValue(selected);
                expect(storage[operation]).toHaveBeenCalledOnce();
                expect(mounted.wrapper.get('[data-packed-storage-warning]').text())
                    .toContain(mounted.context.messages.value.t('packing.packedStorageUnavailable'));

                // A readable old key cannot prove the failed write succeeded or
                // replace the explicit current choice during membership refresh.
                current = {...list, items: [checklistItem('44444444-4444-4444-8444-444444444444'), {...item, position: 1}]};
                await mounted.wrapper.get(`button[aria-label="${mounted.context.messages.value.t('common.refresh')}"]`).trigger('click');
                await flushPromises();
                expect(mounted.wrapper.get<HTMLInputElement>(`${selector} input[type="checkbox"]`).element.checked).toBe(selected);
                expect(mounted.wrapper.get(selector).classes()).toContain(selected ? 'table-success' : 'table-info');
                expect(mounted.wrapper.get('.status-notice.alert-warning').text())
                    .toContain(mounted.context.messages.value.t('packing.packedStorageUnavailable'));
                expect(mounted.wrapper.get('.status-notice.alert-warning').text()).toContain(locale === 'de' ? 'Dein Browser' : 'Your browser');
                expect(mounted.request.mock.calls.every(([request]) => (request as Request).method === 'GET')).toBe(true);
                expect(storage[operation]).toHaveBeenCalledOnce();

                // A rejected local Retry remains a visible unresolved problem and
                // keeps the same choice; it never falls through to a shared command.
                const requestsBeforeFailedRetry = mounted.request.mock.calls.length;
                await mounted.wrapper.get('[data-packed-storage-warning] button').trigger('click');
                await flushPromises();
                expect(storage[operation]).toHaveBeenCalledTimes(2);
                expect(mounted.wrapper.get<HTMLInputElement>(`${selector} input[type="checkbox"]`).element.checked).toBe(selected);
                expect(mounted.wrapper.find('[data-packed-storage-warning]').exists()).toBe(true);
                expect(mounted.request.mock.calls).toHaveLength(requestsBeforeFailedRetry);

                // Recovery is an explicit local action. Restoring storage alone
                // never replays a write during automatic shared-data refresh.
                if (operation === 'setItem') storage.setItem.mockImplementation(function saveRecoveredChecklist(key, value) { values.set(key, value); });
                else storage.removeItem.mockImplementation(function clearRecoveredChecklist(key) { values.delete(key); });
                const requestsBeforeRetry = mounted.request.mock.calls.length;
                const warning = mounted.wrapper.get('[data-packed-storage-warning]');
                expect(warning.get('button').text()).toBe(mounted.context.messages.value.t('common.retry'));
                await warning.get('button').trigger('click');
                await flushPromises();
                expect(storage[operation]).toHaveBeenCalledTimes(3);
                expect(values.get(packedKey) ?? null).toBe(selected ? '1' : null);
                expect(mounted.wrapper.get<HTMLInputElement>(`${selector} input[type="checkbox"]`).element.checked).toBe(selected);
                expect(mounted.wrapper.find('[data-packed-storage-warning]').exists()).toBe(false);
                expect(mounted.request.mock.calls).toHaveLength(requestsBeforeRetry);
            } finally { await mounted.dispose(); }
        });

    it('rereads healthy external Packed changes and treats a missing native key as unchecked', async function healthyChecklistReads() {
        const item = checklistItem();
        const other = checklistItem('44444444-4444-4444-8444-444444444444');
        const key = `packed_${listId}_${item.id}`;
        const values = new Map([[key, '1']]);
        const storage = {getItem: vi.fn((storageKey: string) => values.get(storageKey) ?? null), setItem: vi.fn(), removeItem: vi.fn()};
        vi.spyOn(window, 'localStorage', 'get').mockReturnValue(storage as unknown as Storage);
        let current = {...list, items: [item]};
        const mounted = await mountPackingView(current, async function readChecklist() { return json(current); });
        try {
            const selector = `[data-item-id="${item.id}"]`;
            expect(mounted.wrapper.get<HTMLInputElement>(`${selector} input[type="checkbox"]`).element.checked).toBe(true);

            // Simulate another tab removing the persisted choice before a real
            // membership read. A successful missing-key read is authoritative false.
            values.delete(key);
            current = {...list, items: [item, {...other, position: 1}]};
            await mounted.wrapper.get('button[aria-label="Refresh"]').trigger('click');
            await flushPromises();
            expect(mounted.wrapper.get<HTMLInputElement>(`${selector} input[type="checkbox"]`).element.checked).toBe(false);
            expect(mounted.wrapper.get(selector).classes()).toContain('table-info');

            // A subsequent healthy order refresh adopts an external stored check,
            // preserving existing cross-tab rereads rather than freezing local values.
            values.set(key, '1');
            current = {...list, items: [{...item, position: 1}, other]};
            await mounted.wrapper.get('button[aria-label="Refresh"]').trigger('click');
            await flushPromises();
            expect(mounted.wrapper.get<HTMLInputElement>(`${selector} input[type="checkbox"]`).element.checked).toBe(true);
            expect(mounted.wrapper.get(selector).classes()).toContain('table-success');
            expect(mounted.wrapper.find('.status-notice.alert-warning').exists()).toBe(false);
            expect(storage.setItem).not.toHaveBeenCalled();
            expect(storage.removeItem).not.toHaveBeenCalled();
        } finally { await mounted.dispose(); }
    });

    it('clears temporary Packed checks when leaving a resource and on remount', async function temporaryChecklistLifetime() {
        const item = checklistItem();
        const otherListId = '55555555-5555-4555-8555-555555555555';
        const storageGetter = vi.spyOn(window, 'localStorage', 'get').mockImplementation(function rejectStorageAccess(): never { throw new Error('Fixture getter blocked'); });
        let retiredCheckbox!: HTMLInputElement;
        const mounted = await mountPackingView({...list, items: [item]}, async function readResource(request) {
            const resource = new URL(request.url).pathname.split('/').at(-1)!;
            return json({...list, id: resource, items: [item]});
        });
        try {
            const selector = `[data-item-id="${item.id}"] input[type="checkbox"]`;
            await mounted.wrapper.get(selector).setValue(true);
            expect(mounted.wrapper.get<HTMLInputElement>(selector).element.checked).toBe(true);

            // Vue Router reuses the actual page instance for another list. Even an
            // identical row identifier must not carry the previous list's fallback.
            await mounted.router.push(`/frontend-pilot/packing/${otherListId}`);
            await flushPromises();
            expect(mounted.wrapper.get<HTMLInputElement>(selector).element.checked).toBe(false);
            await mounted.router.push(`/frontend-pilot/packing/${listId}`);
            await flushPromises();
            expect(mounted.wrapper.get<HTMLInputElement>(selector).element.checked).toBe(false);
            retiredCheckbox = mounted.wrapper.get<HTMLInputElement>(selector).element;
        } finally { await mounted.dispose(); }

        // An unmounted control can retain its DOM listener. Late delivery must
        // not probe storage or start work after the owning page has retired.
        const getterCallsAfterUnmount = storageGetter.mock.calls.length;
        const requestsAfterUnmount = mounted.request.mock.calls.length;
        expect(retiredCheckbox.isConnected).toBe(false);
        retiredCheckbox.checked = true;
        retiredCheckbox.dispatchEvent(new Event('change', {bubbles: true}));
        await flushPromises();
        expect(storageGetter.mock.calls).toHaveLength(getterCallsAfterUnmount);
        expect(mounted.request.mock.calls).toHaveLength(requestsAfterUnmount);

        // The fallback is limited to the mounted list; a clean visit cannot invent
        // persistence after the browser rejected the earlier write.
        const remounted = await mountPackingView({...list, items: [item]});
        try {
            expect(remounted.wrapper.get<HTMLInputElement>(`[data-item-id="${item.id}"] input[type="checkbox"]`).element.checked).toBe(false);
        } finally { await remounted.dispose(); }
    });

    it('retires failed Packed writes when their row disappears and ignores its detached controls', async function removedChecklistRow() {
        const item = checklistItem();
        const other = checklistItem('44444444-4444-4444-8444-444444444444');
        const storage = {getItem: vi.fn(() => null),
            setItem: vi.fn(function rejectRemovedRowWrite(): never { throw new Error('Fixture persistence blocked'); }),
            removeItem: vi.fn()};
        vi.spyOn(window, 'localStorage', 'get').mockReturnValue(storage as unknown as Storage);
        let current = {...list, items: [item, other]};
        const mounted = await mountPackingView(current, async function readChecklist() { return json(current); });
        try {
            const checkbox = mounted.wrapper.get<HTMLInputElement>(`[data-item-id="${item.id}"] input[type="checkbox"]`);
            await checkbox.setValue(true);
            expect(storage.setItem).toHaveBeenCalledOnce();
            const retiredRetry = mounted.wrapper.get<HTMLButtonElement>('[data-packed-storage-warning] button').element;

            // A fresh complete list no longer contains this row. Retire its pending
            // local write rather than preserving an invisible preference to replay.
            current = {...list, items: [other]};
            await mounted.wrapper.get('button[aria-label="Refresh"]').trigger('click');
            await flushPromises();
            expect(checkbox.element.isConnected).toBe(false);
            expect(mounted.wrapper.find(`[data-item-id="${item.id}"]`).exists()).toBe(false);
            expect(mounted.wrapper.find('[data-packed-storage-warning]').exists()).toBe(false);

            // Removed DOM nodes can retain a listener. Dispatch its actual event and
            // old Retry rather than invoking an implementation-private method.
            const requestsBeforeRetiredEvents = mounted.request.mock.calls.length;
            checkbox.element.checked = true;
            checkbox.element.dispatchEvent(new Event('change', {bubbles: true}));
            retiredRetry.dispatchEvent(new MouseEvent('click', {bubbles: true}));
            await flushPromises();
            expect(storage.setItem).toHaveBeenCalledOnce();
            expect(storage.removeItem).not.toHaveBeenCalled();
            expect(mounted.wrapper.find('[data-packed-storage-warning]').exists()).toBe(false);
            expect(mounted.request.mock.calls).toHaveLength(requestsBeforeRetiredEvents);
        } finally { await mounted.dispose(); }
    });

    it('ignores a detached Packed checkbox from another list even when its row ID exists in the new list', async function retiredChecklistResource() {
        const item = checklistItem();
        const otherListId = '55555555-5555-4555-8555-555555555555';
        const values = new Map<string, string>();
        const storage = {getItem: vi.fn((key: string) => values.get(key) ?? null),
            setItem: vi.fn(function rejectForeignChecklistWrite(_key: string, _value: string): void { throw new Error('Fixture foreign write rejected'); }),
            removeItem: vi.fn()};
        const storageGetter = vi.spyOn(window, 'localStorage', 'get').mockReturnValue(storage as unknown as Storage);
        let releaseOther!: (response: Response) => void;
        const mounted = await mountPackingView({...list, items: [item]}, async function readResource(request) {
            const resource = new URL(request.url).pathname.split('/').at(-1)!;
            if (resource === otherListId) return new Promise<Response>(function holdOtherList(resolve) { releaseOther = resolve; });
            return json({...list, items: [item]});
        });
        try {
            const selector = `[data-item-id="${item.id}"] input[type="checkbox"]`;
            const oldCheckbox = mounted.wrapper.get<HTMLInputElement>(selector).element;
            await mounted.wrapper.get(selector).setValue(true);
            expect(storage.setItem).toHaveBeenCalledOnce();
            const oldRetry = mounted.wrapper.get<HTMLButtonElement>('[data-packed-storage-warning] button').element;

            // Hold the real new-resource read until Vue retires the old row. The
            // replacement deliberately has the same row ID, so membership alone
            // cannot certify that this detached event belongs to the current list.
            await mounted.router.push(`/frontend-pilot/packing/${otherListId}`);
            await flushPromises();
            expect(oldCheckbox.isConnected).toBe(false);
            expect(releaseOther).toBeTypeOf('function');
            releaseOther(json({...list, id: otherListId, items: [item]}));
            await flushPromises();
            const currentCheckbox = mounted.wrapper.get<HTMLInputElement>(selector).element;
            expect(currentCheckbox).not.toBe(oldCheckbox);
            oldCheckbox.checked = true;
            oldCheckbox.dispatchEvent(new Event('change', {bubbles: true}));
            await flushPromises();

            expect(storage.setItem).toHaveBeenCalledOnce();
            expect(storage.removeItem).not.toHaveBeenCalled();
            expect(currentCheckbox.checked).toBe(false);
            expect(mounted.wrapper.find('[data-packed-storage-warning]').exists()).toBe(false);

            // Give B its own unsaved choice, then restore persistence. A detached
            // warning from A must not become permission to retry B's newer work.
            await mounted.wrapper.get(selector).setValue(true);
            expect(storage.setItem).toHaveBeenCalledTimes(2);
            storage.setItem.mockImplementation(function saveCurrentChecklist(key: string, value: string) { values.set(key, value); });
            const getterCalls = storageGetter.mock.calls.length;
            const readCalls = storage.getItem.mock.calls.length;
            const requestsBeforeRetiredRetry = mounted.request.mock.calls.length;
            expect(oldRetry.isConnected).toBe(false);
            oldRetry.dispatchEvent(new MouseEvent('click', {bubbles: true}));
            await flushPromises();
            expect(storageGetter.mock.calls).toHaveLength(getterCalls);
            expect(storage.getItem.mock.calls).toHaveLength(readCalls);
            expect(storage.setItem).toHaveBeenCalledTimes(2);
            expect(values.size).toBe(0);
            expect(currentCheckbox.checked).toBe(true);
            expect(mounted.wrapper.find('[data-packed-storage-warning]').exists()).toBe(true);
            expect(mounted.request.mock.calls).toHaveLength(requestsBeforeRetiredRetry);

            // Only B's connected current warning can recover that local change.
            // Explicit preference recovery has no shared assignment/API side effect.
            await mounted.wrapper.get('[data-packed-storage-warning] button').trigger('click');
            await flushPromises();
            expect(storage.setItem).toHaveBeenCalledTimes(3);
            expect(values.get(`packed_${otherListId}_${item.id}`)).toBe('1');
            expect(currentCheckbox.checked).toBe(true);
            expect(mounted.wrapper.find('[data-packed-storage-warning]').exists()).toBe(false);
            expect(mounted.request.mock.calls).toHaveLength(requestsBeforeRetiredRetry);
        } finally {
            releaseOther?.(json({...list, id: otherListId, items: [item]}));
            await mounted.dispose();
        }
    });

    it('ignores old Packed checkbox and Retry events after the captured actor retires', async function retiredChecklistActor() {
        const item = checklistItem();
        const storage = {getItem: vi.fn(() => null),
            setItem: vi.fn(function rejectRetiredChecklistWrite(): never { throw new Error('Fixture persistence blocked'); }),
            removeItem: vi.fn()};
        const storageGetter = vi.spyOn(window, 'localStorage', 'get').mockReturnValue(storage as unknown as Storage);
        const mounted = await mountPackingView({...list, items: [item]}, async function readActorScope(request) {
            if (new URL(request.url).pathname === '/api/v1/session') throw new TypeError('Fixture identity recovery remains unavailable');
            return json({...list, items: [item]});
        });
        try {
            const oldCheckbox = mounted.wrapper.get<HTMLInputElement>(`[data-item-id="${item.id}"] input[type="checkbox"]`);
            await oldCheckbox.setValue(true);
            expect(storage.setItem).toHaveBeenCalledOnce();
            const oldRetry = mounted.wrapper.get<HTMLButtonElement>('[data-packed-storage-warning] button').element;

            // Retire through the real identity owner. Dispatch before Vue removes
            // the old DOM so captured actor admission, rather than DOM absence,
            // must prevent this event from writing an unchecked preference.
            mounted.context.invalidateIdentity();
            oldCheckbox.element.checked = false;
            oldCheckbox.element.dispatchEvent(new Event('change', {bubbles: true}));
            await flushPromises();
            expect(mounted.context.ready.value).toBe(false);
            expect(storage.removeItem).not.toHaveBeenCalled();
            expect(mounted.wrapper.find('[data-packed-storage-warning]').exists()).toBe(false);

            // A later click from the retired warning must not even probe storage,
            // and detached old checkbox events remain harmless after presentation closes.
            const getterCalls = storageGetter.mock.calls.length;
            oldRetry.dispatchEvent(new MouseEvent('click', {bubbles: true}));
            oldCheckbox.element.dispatchEvent(new Event('change', {bubbles: true}));
            await flushPromises();
            expect(storageGetter.mock.calls).toHaveLength(getterCalls);
            expect(storage.setItem).toHaveBeenCalledOnce();
            expect(storage.removeItem).not.toHaveBeenCalled();
        } finally { await mounted.dispose(); }
    });

    it('keeps current-scope Packed checks usable while a temporary list read retains admitted rows', async function retainedChecklistRead() {
        const item = checklistItem();
        const key = `packed_${listId}_${item.id}`;
        const values = new Map<string, string>();
        const storage = {getItem: vi.fn((storageKey: string) => values.get(storageKey) ?? null),
            setItem: vi.fn(function saveRetainedChecklist(storageKey: string, value: string) { values.set(storageKey, value); }),
            removeItem: vi.fn()};
        vi.spyOn(window, 'localStorage', 'get').mockReturnValue(storage as unknown as Storage);
        let unavailable = false;
        const mounted = await mountPackingView({...list, items: [item]}, async function readRetainedChecklist() {
            if (!unavailable) return json({...list, items: [item]});
            // Valid safe 503 plus a server cooldown supplies a temporary read
            // failure without arbitrary timers or authorization-loss inference.
            return new Response(JSON.stringify({type: 'about:blank', title: 'Temporarily unavailable', status: 503,
                detail: 'Retry after the server deadline.', requestId: 'retained-checklist-read'}),
                {status: 503, headers: {'Content-Type': 'application/problem+json', 'X-Surveyor-Context': session.context, 'Retry-After': '3600'}});
        });
        try {
            unavailable = true;
            await mounted.context.queryClient.refetchQueries({queryKey: packingKeys.detail(session.context, listId)});
            await flushPromises();
            expect(mounted.context.queryClient.getQueryState(packingKeys.detail(session.context, listId))?.error).toMatchObject({status: 503});
            expect(mounted.context.ready.value).toBe(true);
            expect(mounted.wrapper.text()).toContain(mounted.context.messages.value.t('state.stale'));
            const requestsBeforeCheck = mounted.request.mock.calls.length;

            // This browser-local action still belongs to the same admitted row
            // and actor. A failed shared read must not disable its healthy storage.
            await mounted.wrapper.get(`[data-item-id="${item.id}"] input[type="checkbox"]`).setValue(true);
            expect(values.get(key)).toBe('1');
            expect(mounted.wrapper.get(`[data-item-id="${item.id}"]`).classes()).toContain('table-success');
            expect(mounted.wrapper.find('[data-packed-storage-warning]').exists()).toBe(false);
            expect(mounted.request.mock.calls).toHaveLength(requestsBeforeCheck);
        } finally { await mounted.dispose(); }
    });
});

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
                expect(mounted.context.session.value?.context).toBe(session.context);
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

    it('waits for session admission before synchronous image resume and preserves admitted binary reads during bootstrap',
        async function preservesAdmittedImageRead() {
            const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
            let resolveFirst!: (value: Response) => void;
            let resolveSecond!: (value: Response) => void;
            const first = new Promise<Response>(resolve => { resolveFirst = resolve; });
            const second = new Promise<Response>(resolve => { resolveSecond = resolve; });
            let sessions = 0;
            const request = vi.fn(() => ++sessions === 1 ? first : second);
            const context = createPilotContext({session}, true, request);
            vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:admitted-during-bootstrap');
            vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
            let resolveImage!: (value: Blob) => void;
            let imageSignal: AbortSignal | undefined;
            const image = new Promise<Blob>(resolve => { resolveImage = resolve; });
            const read = vi.fn(function readAdmittedImage(_id: string, _scope: unknown, signal: AbortSignal): Promise<Blob> {
                imageSignal = signal;
                return image;
            });
            const host = defineComponent({
                setup: function bindAdmittedImage() {
                    return {image: useAuthorizedImage(ref(listId), ref('same-version'), read).source};
                },
                template: '<img v-if="image" :src="image" alt="Admitted image" />',
            });
            const wrapper = mount(host, {global: {plugins: [[I18NextVue, {i18next: context.i18next}]],
                provide: {[pilotContextKey as symbol]: context}}});
            const stop = context.start();
            try {
                visibility.mockReturnValue('visible');
                document.dispatchEvent(new Event('visibilitychange'));
                await flushPromises();
                expect(request).toHaveBeenCalledOnce();
                expect(read).not.toHaveBeenCalled();

                // A flush:sync visibility owner waits behind bootstrap. Once admitted,
                // its captured binary read can finish while another session check pauses
                // new dispatch; slow images must not restart every session interval.
                resolveFirst(json(session));
                await flushPromises();
                expect(read).toHaveBeenCalledOnce();
                const checking = context.refreshSession();
                await flushPromises();
                expect(imageSignal?.aborted).toBe(false);
                resolveImage(new Blob(['image'], {type: 'image/png'}));
                await flushPromises();
                expect(wrapper.get('img').attributes('src')).toBe('blob:admitted-during-bootstrap');
                resolveSecond(json(session));
                await checking;
                await flushPromises();
                expect(read).toHaveBeenCalledOnce();
            } finally {
                resolveFirst(json(session));
                resolveSecond(json(session));
                resolveImage(new Blob());
                wrapper.unmount();
                stop();
            }
        });

    it('keeps terminal image denial paused across session resumes until an admitted feature refresh',
        async function preservesTerminalImagePolicy() {
            const context = createPilotContext({session}, true, vi.fn(async () => json(session)));
            vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:feature-readmitted');
            vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
            let readable = false;
            const disclosed = ref(true);
            let owner!: PilotAuthorizedImage;
            const read = vi.fn(async function readProtectedImage(): Promise<Blob> {
                if (!readable) throw new ApiFailure(403, {type: 'about:blank', title: 'Forbidden', status: 403,
                    detail: 'Image access changed.', requestId: 'terminal-image-denial', code: 'FORBIDDEN',
                    messageKey: 'api:errors.FORBIDDEN', params: {}});
                return new Blob(['image'], {type: 'image/png'});
            });
            const host = defineComponent({
                setup: function bindProtectedImage() {
                    owner = useAuthorizedImage(ref(listId), ref('same-version'), read, disclosed);
                    return {image: owner.source};
                },
                template: '<img v-if="image" :src="image" alt="Readmitted image" />',
            });
            const wrapper = mount(host, {global: {plugins: [[I18NextVue, {i18next: context.i18next}]],
                provide: {[pilotContextKey as symbol]: context}}});
            try {
                await flushPromises();
                expect(read).toHaveBeenCalledOnce();
                for (let attempt = 0; attempt < 3; attempt++) {
                    await context.refreshSession();
                    await flushPromises();
                }
                expect(read).toHaveBeenCalledOnce();
                expect(wrapper.find('img').exists()).toBe(false);
                // Revealing the same mounted owner supplies no new projection or
                // binary grant. Its prior terminal failure still suspends automatic reads.
                disclosed.value = false;
                disclosed.value = true;
                await flushPromises();
                expect(read).toHaveBeenCalledOnce();

                // A session receipt cannot infer restored binary authority. The
                // existing feature-success callback explicitly requests recovery.
                readable = true;
                await context.refreshSession();
                await flushPromises();
                expect(read).toHaveBeenCalledOnce();
                await owner.refresh();
                expect(read).toHaveBeenCalledTimes(2);
                expect(wrapper.get('img').attributes('src')).toBe('blob:feature-readmitted');
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
            capabilities: {editTitle: false, editDescription: false, editCapacity: false, showTitleEdit: false,
                showCapacityEdit: false, editRequired: false, removeItem: false, removeAssignments: false}};
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
