// @vitest-environment happy-dom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {flushPromises, mount} from '@vue/test-utils';
import {defineComponent, ref, type Component} from 'vue';
import {createMemoryHistory, createRouter} from 'vue-router';
import {VueQueryPlugin} from '@tanstack/vue-query';
import I18NextVue from 'i18next-vue';
import type {components} from '../../src/types/api/v1';
import type {FrontendPilotBootstrap} from '../../src/types/FrontendPilotTypes';
import type {EntityMetadataEditorHandle} from '../../src/types/FrontendEntityMetadataTypes';
import {createPilotContext, observeInitialDocument, pilotContextKey} from '../../src/frontend/app/context';
import {eventKeys} from '../../src/frontend/app/queryKeys';
import EventCreatePage from '../../src/frontend/features/event/EventCreatePage.vue';
import EventMetadataFields from '../../src/frontend/features/event/EventMetadataFields.vue';
import EventEntry from '../../src/frontend/features/event/EventEntry.vue';
import TimezonePicker from '../../src/frontend/components/TimezonePicker.vue';

const eventId = '11111111-1111-4111-8111-111111111111';
const secondId = '22222222-2222-4222-8222-222222222222';
const session: components['schemas']['SessionView'] & {context: string; csrfToken: string} = {
    kind: 'account', context: 'event-foundation-context-1234567890', csrfToken: 'event-foundation-csrf-1234567890', locale: 'en',
    deployment: {buildId: 'fixture', apiCompatibility: 'v1-pilot-2026-10-07'},
    activeProfile: {id: eventId, name: 'Organizer'}, profiles: [{id: eventId, name: 'Organizer'}],
    loginUrl: '/users/login', logoutUrl: '/users/logout',
    shell: {version: 'test', imprintUrl: '/imprint', privacyPolicyUrl: '/privacy', localLoginEnabled: true, oidcEnabled: false, oidcName: 'SSO'},
};
const defaults = {participant: 1, guest: 0, authenticated: 0, public: 0};
const definitions: components['schemas']['EventCreateContext'] = {defaults, permissions: [{key: 'ACCESS_ITEMS', bit: 1}], presets: []};
const copied: components['schemas']['EventCreateInput'] = {title: 'First copy', startDate: '2027-06-01', endDate: '2027-06-03',
    deadlineTz: 'Europe/Berlin', bindingDeadline: '', defaultPermissions: defaults};
const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
});

function json(value: unknown, token = '"metadata-original"', status = 200): Response {
    return new Response(JSON.stringify(value), {status, headers: {'Content-Type': 'application/json', 'X-Surveyor-Context': session.context, ETag: token}});
}

/** Mount actual controls/adapters/drafts while substituting HTTP delivery only.
 * These frontend fixtures establish no persistence or complete-system result. */
async function mounted(component: Component, handler: (request: Request) => Promise<Response>,
                       path = '/frontend-pilot/event/create', props: Record<string, unknown> = {},
                       initial: Omit<FrontendPilotBootstrap, 'session'> = {}) {
    const request = vi.fn((input: RequestInfo | URL) => handler(input as Request));
    const context = createPilotContext({session, ...initial}, true, request);
    context.hydrated.value = true;
    const router = createRouter({history: createMemoryHistory(), routes: [
        {path: '/frontend-pilot/event/create', component, props},
        {path: '/frontend-pilot/event/:eventId/duplicate', component, props},
        {path: '/frontend-pilot/event/:eventId/guest', component, props},
        {path: '/frontend-pilot/event/:eventId/admin', component, props},
        {path: '/frontend-pilot/event/:eventId', component, props},
        {path: '/frontend-pilot', component: defineComponent({template: '<p>Overview</p>'})},
    ]});
    await router.push(path);
    const stopInitial = observeInitialDocument(context, router);
    const root = mount(defineComponent({template: '<RouterView />'}), {attachTo: document.body, global: {
        plugins: [router, [VueQueryPlugin, {queryClient: context.queryClient}], [I18NextVue, {i18next: context.i18next}]],
        provide: {[pilotContextKey as symbol]: context},
        stubs: {AppDialog: defineComponent({template: '<section role="dialog"><slot name="navigation" /><slot /><slot name="footer" /></section>'}),
            // Entry assertions exercise the real admission/router/query owners;
            // its separately tested detail body cannot manufacture admission.
            EventPage: defineComponent({template: '<p data-test="event-admitted">Admitted Event</p>'})},
    }});
    await flushPromises();
    cleanups.push(async () => {root.unmount(); stopInitial(); await context.queryClient.cancelQueries(); context.queryClient.clear();});
    return {root, wrapper: root.findComponent(component), request, context, router};
}

function readCreation(request: Request): Promise<Response> {
    if (request.method !== 'GET') throw new Error('Creation fixture accepts reads only.');
    const path = new URL(request.url).pathname;
    if (path.endsWith('/duplicate')) return Promise.resolve(json({values: {...copied, title: path.includes(secondId) ? 'Second copy' : 'First copy'}, formContext: definitions}));
    return Promise.resolve(json({entry: {kind: 'render'}, context: definitions}));
}

function selectImage(input: HTMLInputElement): File {
    const selection = new DataTransfer();
    const file = new File(['header'], 'selected.png', {type: 'image/png'});
    selection.items.add(file);
    input.files = selection.files;
    input.dispatchEvent(new Event('change', {bubbles: true}));
    return file;
}

describe('Event foundation production consumers', () => {
    it('retires warm entry intents after a missing Event and requires fresh admission before showing another page intent', async () => {
        const detail = `/frontend-pilot/event/${eventId}`;
        let missing = false;
        let holdAdmin = false;
        let releaseAdmin: (() => void) | undefined;
        const readIntents: string[] = [];
        const {wrapper, router, context} = await mounted(EventEntry, async request => {
            const url = new URL(request.url);
            expect(url.pathname).toBe(`/api/v1/events/${eventId}/entry`);
            const view = url.searchParams.get('view')!;
            readIntents.push(view);
            if (missing) return json({entry: {kind: 'denied', status: 404, messageKey: 'event.notFound'}, guest: null});
            if (holdAdmin && view === 'admin') return new Promise<Response>(resolve => {
                releaseAdmin = () => resolve(json({entry: {kind: 'render'}, guest: null}));
            });
            // A current account's explicit guest visit redirects without issuing
            // an identity command, while leaving its own admission query warm.
            return json({entry: view === 'guest' ? {kind: 'redirect', url: detail, notice: null} : {kind: 'render'}, guest: null});
        }, detail);
        expect(wrapper.find('[data-test="event-admitted"]').exists()).toBe(true);
        await router.push(detail + '/admin'); await flushPromises();
        await router.push(detail + '/guest'); await flushPromises();
        expect(router.currentRoute.value.path).toBe(detail);
        expect(readIntents).toEqual(expect.arrayContaining(['detail', 'admin', 'guest']));
        for (const view of ['detail', 'guest', 'admin'] as const) {
            expect(context.queryClient.getQueryCache().findAll({queryKey: eventKeys.entry(session.context, eventId, view)}).length).toBeGreaterThan(0);
        }
        await router.push(detail + '?regToken=first-capability'); await flushPromises();
        await router.push(detail + '?regToken=second-capability'); await flushPromises();
        expect(context.queryClient.getQueryCache().findAll({queryKey: eventKeys.entry(session.context, eventId, 'detail')}).length).toBeGreaterThan(1);

        missing = true;
        await context.queryClient.invalidateQueries({queryKey: eventKeys.entry(session.context, eventId, 'detail')});
        await flushPromises();
        expect(wrapper.find('[data-test="event-admitted"]').exists()).toBe(false);
        expect(wrapper.text()).toContain('Event not found.');
        expect(context.queryClient.getQueryCache().findAll({queryKey: eventKeys.entry(session.context, eventId, 'guest')})).toHaveLength(0);
        expect(context.queryClient.getQueryCache().findAll({queryKey: eventKeys.entry(session.context, eventId, 'admin')})).toHaveLength(0);
        const remaining = context.queryClient.getQueriesData<components['schemas']['EventResourceEntry']>({queryKey: eventKeys.entry(session.context, eventId, 'detail')});
        expect(remaining).toHaveLength(1);
        expect(remaining[0]?.[1]?.entry).toMatchObject({kind: 'denied', status: 404});

        // No cached render decision may reveal the admin subtree while its next
        // real server read is held; restoring it requires fresh admission.
        missing = false;
        holdAdmin = true;
        await router.push(detail + '/admin'); await flushPromises();
        expect(releaseAdmin).toBeDefined();
        expect(wrapper.find('[data-test="event-admitted"]').exists()).toBe(false);
        releaseAdmin!();
        await flushPromises();
        expect(wrapper.find('[data-test="event-admitted"]').exists()).toBe(true);
    });

    it('submits one admitted multipart creation with raw capacity, boolean flags, audience masks and its selected file', async () => {
        const writes: components['schemas']['EventCreateInput'][] = [];
        let deliveredImage: FormDataEntryValue | null = null;
        let finishCreation: (() => void) | undefined;
        const {wrapper, request, router} = await mounted(EventCreatePage, async request => {
            if (request.method === 'GET') return readCreation(request);
            expect(new URL(request.url).pathname).toBe('/api/v1/events');
            expect(request.headers.get('X-Surveyor-Context')).toBe(session.context);
            expect(request.headers.get('X-CSRF-Token')).toBe(session.csrfToken);
            const body = await request.formData();
            writes.push(JSON.parse(String(body.get('data'))));
            deliveredImage = body.get('image');
            return new Promise<Response>(resolve => {finishCreation = () => resolve(json({id: secondId}, undefined, 201));});
        });
        await wrapper.get('[name="title"]').setValue('Summer camp');
        await wrapper.get('[name="startDate"]').setValue('2027-06-01');
        await wrapper.get('[name="endDate"]').setValue('2027-06-03');
        await wrapper.get('[name="maxParticipants"]').setValue('0');
        await wrapper.get('[name="allowRegDietUpdateAfterDeadline"]').setValue(true);
        selectImage(wrapper.get<HTMLInputElement>('#event-header-image').element);
        const form = wrapper.get<HTMLFormElement>('#eventForm');
        expect(form.attributes('action')).toBeUndefined();
        expect(form.attributes('method')).toBeUndefined();
        await form.trigger('submit');
        await flushPromises();
        expect(writes).toEqual([expect.objectContaining({title: 'Summer camp', maxParticipants: '0', deadlineTz: 'UTC',
            allowRegDietUpdateAfterDeadline: true, requireDietaryInfo: false, defaultPermissions: defaults})]);
        expect(deliveredImage).toBeInstanceOf(File);
        expect((deliveredImage as File | null)?.name).toBe('selected.png');
        expect(form.get('button[type="submit"]').attributes('disabled')).toBeDefined();
        // Repeated activation during delivery cannot create a second resource.
        await form.trigger('submit'); await flushPromises();
        expect(request.mock.calls.filter(([input]) => (input as Request).method === 'POST')).toHaveLength(1);
        finishCreation!(); await flushPromises();
        expect(router.currentRoute.value.path).toBe(`/frontend-pilot/event/${secondId}`);
    });

    it('retains the entered Event and FileList after unknown delivery without replay during read recovery', async () => {
        const {wrapper, request, context} = await mounted(EventCreatePage, async request => {
            if (request.method === 'POST') throw new Error('Reply lost after creation dispatch');
            return readCreation(request);
        });
        await wrapper.get('[name="title"]').setValue('Retained event');
        await wrapper.get('[name="startDate"]').setValue('2027-06-01');
        await wrapper.get('[name="endDate"]').setValue('2027-06-03');
        const chooser = wrapper.get<HTMLInputElement>('#event-header-image').element;
        const selected = selectImage(chooser);
        await wrapper.get('#eventForm').trigger('submit'); await flushPromises();
        expect(wrapper.text()).toContain('Creation could not be confirmed.');
        expect(wrapper.get<HTMLInputElement>('[name="title"]').element.value).toBe('Retained event');
        expect(chooser.files?.[0]).toBe(selected);
        await context.queryClient.invalidateQueries({queryKey: eventKeys.creation(session.context)});
        await flushPromises();
        await wrapper.get('#eventForm').trigger('submit'); await flushPromises();
        expect(request.mock.calls.filter(([input]) => (input as Request).method === 'POST')).toHaveLength(1);
        expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined();
        expect(chooser.files?.[0]).toBe(selected);
    });

    it('retains an entered duplicate and selected file after canceled departure, then releases both on accepted warm navigation', async () => {
        const start = `/frontend-pilot/event/${eventId}/duplicate`;
        const {wrapper, router, context, request} = await mounted(EventCreatePage, readCreation, start);
        vi.stubGlobal('confirm', vi.fn(() => true));
        // Warm the destination through real admission before starting local work.
        await router.push(`/frontend-pilot/event/${secondId}/duplicate`); await flushPromises();
        await router.push(start); await flushPromises();
        const input = wrapper.get<HTMLInputElement>('#event-header-image').element;
        const selected = selectImage(input);
        await wrapper.get('[name="title"]').setValue('Entered title');
        const confirmation = vi.fn(() => false);
        vi.stubGlobal('confirm', confirmation);
        await router.push(`/frontend-pilot/event/${secondId}/duplicate`); await flushPromises();
        expect(router.currentRoute.value.fullPath).toBe(start);
        await context.queryClient.invalidateQueries({queryKey: eventKeys.duplicate(session.context, eventId)}); await flushPromises();
        await router.push(start + '#event-header-image'); await flushPromises();
        expect(input.files?.[0]).toBe(selected);
        expect(wrapper.get<HTMLInputElement>('[name="title"]').element.value).toBe('Entered title');
        expect(confirmation).toHaveBeenCalledTimes(1);
        confirmation.mockReturnValue(true);
        await router.push(`/frontend-pilot/event/${secondId}/duplicate`); await flushPromises();
        const nextInput = wrapper.get<HTMLInputElement>('#event-header-image').element;
        expect(nextInput).toBe(input);
        expect(nextInput.files).toHaveLength(0);
        expect(wrapper.get<HTMLInputElement>('[name="title"]').element.value).toBe('Second copy');
        expect(request.mock.calls.every(([input]) => (input as Request).method === 'GET')).toBe(true);
    });

    it('preserves an omitted stored deadline during unrelated edits and submits the displayed wall time together with a changed zone', async () => {
        let value: components['schemas']['EventMetadata'] = {id: eventId, values: {title: 'Camp', bindingDeadline: '2027-05-01T12:30:45', deadlineTz: 'Europe/Berlin'},
            editableFields: ['title', 'bindingDeadline', 'deadlineTz'], editToken: '"edit-field-original"'};
        const patches: components['schemas']['EventMetadataPatch'][] = [];
        const {wrapper, context, request} = await mounted(EventMetadataFields, async request => {
            if (request.method === 'PATCH') {
                const patch = await request.json() as components['schemas']['EventMetadataPatch'];
                patches.push(patch);
                value = {...value, values: {...value.values, ...patch} as components['schemas']['EventMetadataValues'], editToken: '"edit-field-updated"'};
            }
            return json(value, patches.length ? '"metadata-updated"' : '"metadata-original"');
        }, '/frontend-pilot/event/create', {eventId});
        await vi.waitFor(() => {
            expect({reads: request.mock.calls.length, ready: context.ready.value, visible: context.visible.value,
                state: context.queryClient.getQueryState(eventKeys.metadata(session.context, eventId))})
                .toMatchObject({reads: 1, ready: true, visible: true, state: {status: 'success', error: null}});
            expect(wrapper.find('[name="title"]').exists()).toBe(true);
        });
        // The feature adapter exposes the mounted shared editor's live workflow;
        // Settings must observe this same draft instead of a copied flag set.
        const handle = wrapper.vm as unknown as EntityMetadataEditorHandle;
        expect(handle.dirty).toBe(false);
        expect(handle.pending).toBe(false);
        vi.stubGlobal('confirm', vi.fn(() => false));
        await wrapper.get('[name="title"]').setValue('Changed title');
        expect(handle.dirty).toBe(true);
        expect(handle.mayLeave()).toBe(false);
        await handle.refreshAfterSettings();
        await flushPromises();
        expect(wrapper.get<HTMLInputElement>('[name="title"]').element.value).toBe('Changed title');
        expect(handle.dirty).toBe(true);
        await wrapper.get('#event-metadata-form').trigger('submit'); await flushPromises();
        expect(patches).toEqual([{title: 'Changed title'}]);
        expect(handle.dirty).toBe(false);
        expect(handle.pending).toBe(false);
        // Independent property families retain the native first-open disclosure.
        const families = wrapper.findAll('details.entity-property-group');
        expect(families[0]!.attributes('open')).toBeDefined();
        expect(families[1]!.attributes('open')).toBeUndefined();
        const picker = wrapper.findComponent(TimezonePicker);
        await picker.get('.flex-grow-1').trigger('click');
        await picker.get('input[type="search"]').setValue('Europe/London');
        const choice = picker.findAll('button').find(button => button.text().startsWith('Europe/London'));
        expect(choice).toBeDefined();
        await choice!.trigger('click');
        await wrapper.get('#event-metadata-form').trigger('submit'); await flushPromises();
        expect(patches[1]).toEqual({deadlineTz: 'Europe/London', bindingDeadline: '2027-05-01T12:30:45'});
    });

    it.each(['stale read', 'lost save response'] as const)(
        'preserves false, zero and empty comparison values through Event %s review and translation',
        async function reviewsEventScalarValues(outcome) {
            const original: components['schemas']['EventMetadata'] = {id: eventId,
                values: {title: 'Original', description: null, location: '', maxParticipants: 0,
                    requireDietaryInfo: false, allowDietComment: true},
                editableFields: ['title', 'description', 'location', 'maxParticipants', 'requireDietaryInfo', 'allowDietComment'],
                editToken: '"edit-original"'};
            let current = original;
            const patches: components['schemas']['EventMetadataPatch'][] = [];
            const {wrapper, context, request} = await mounted(EventMetadataFields, deliverMetadata,
                '/frontend-pilot/event/create', {eventId});

            /** Exercise the generated Event adapter while retaining wire scalar meaning.
             * Only delivery is substituted; the shared editor owns reads, drafts and review. */
            async function deliverMetadata(request: Request): Promise<Response> {
                if (request.method === 'PATCH') {
                    const patch = await request.json() as components['schemas']['EventMetadataPatch'];
                    patches.push(patch);
                    if (outcome === 'lost save response' && patches.length === 1) throw new TypeError('Response was lost');

                    // The fixture returns a valid saved projection, just as the API
                    // decodes raw numeric input before the next authoritative read.
                    current = {...current, values: {...current.values, ...patch,
                        maxParticipants: Number(patch.maxParticipants)}, editToken: '"edit-saved"'};
                }
                return json(current, current.editToken);
            }

            // Keep a nullable text field empty and edit both checkbox directions.
            // Zero in the admitted snapshots is a value, even though a new entered
            // property capacity follows Event's existing positive-input constraint.
            await wrapper.get('[name="title"]').setValue('Local');
            await wrapper.get('[name="description"]').setValue('');
            await wrapper.get('[name="maxParticipants"]').setValue('1');
            await wrapper.get('[name="requireDietaryInfo"]').setValue(true);
            await wrapper.get('[name="allowDietComment"]').setValue(false);
            current = {...original, values: {...original.values, title: 'Remote'}, editToken: '"edit-remote"'};

            if (outcome === 'lost save response') {
                await wrapper.get('#event-metadata-form').trigger('submit');
                await flushPromises();
                expect(patches).toHaveLength(1);
                expect(wrapper.findAll('.pilot-conflict-values')).toHaveLength(0);

                // Explicit recovery reads the latest values. It cannot replay the
                // uncertain PATCH or silently adopt its new comparison baseline.
                const refresh = wrapper.findAll('button').find(button => button.text() === 'Refresh')!;
                await refresh.trigger('click');
            } else {
                await context.queryClient.invalidateQueries({queryKey: eventKeys.metadata(session.context, eventId)});
            }
            await flushPromises();

            /** Read the visible Original/Mine/Current columns through their semantic
             * definition lists rather than exposing the component's private formatter. */
            function comparisonRows(): string[][] {
                const rows: string[][] = [];
                for (const row of wrapper.findAll('.pilot-conflict-values')) {
                    rows.push(row.findAll('dd').map(cell => cell.text()));
                }
                return rows;
            }

            expect(comparisonRows()).toEqual([
                ['Original', 'Local', 'Remote'], ['—', '—', '—'], ['—', '—', '—'],
                ['0', '1', '0'], ['No', 'Yes', 'No'], ['Yes', 'No', 'Yes'],
            ]);
            const comparison = wrapper.get('.pilot-conflict-values').element;
            const readsBeforeTranslation = request.mock.calls.length;
            context.locale.value = 'de';
            await flushPromises();
            expect(comparisonRows()).toEqual([
                ['Original', 'Local', 'Remote'], ['—', '—', '—'], ['—', '—', '—'],
                ['0', '1', '0'], ['Nein', 'Ja', 'Nein'], ['Ja', 'Nein', 'Ja'],
            ]);
            expect(wrapper.get('.pilot-conflict-values').element).toBe(comparison);
            expect(request.mock.calls).toHaveLength(readsBeforeTranslation);

            // Localized display never changes machine values or acknowledges
            // uncertainty. A deliberate review and Save retain sparse raw input.
            await wrapper.get('[name="resolve-title"][value="mine"]').setValue();
            const review = wrapper.findAll('button').find(button => button.text() === 'Änderungen prüfen')!;
            await review.trigger('click');
            await wrapper.get('#event-metadata-form').trigger('submit');
            await flushPromises();
            const patch = {title: 'Local', maxParticipants: '1', requireDietaryInfo: true, allowDietComment: false};
            expect(patches).toEqual(outcome === 'lost save response' ? [patch, patch] : [patch]);
            expect(wrapper.findAll('.pilot-conflict-values')).toHaveLength(0);
        },
    );

    it('retains a valid persisted timezone alias and searches the complete inventory while bounding rendered choices', async () => {
        const host = defineComponent({components: {TimezonePicker}, setup: () => ({zone: ref('US/Eastern')}),
            template: '<TimezonePicker id="alias-timezone" v-model="zone" />'});
        const {wrapper} = await mounted(host, readCreation);
        expect(wrapper.get('input[type="hidden"]').attributes('value')).toBe('US/Eastern');
        await wrapper.get('.flex-grow-1').trigger('click');
        expect(wrapper.findAll('li button').length).toBeLessThanOrEqual(200);
        await wrapper.get('input[type="search"]').setValue('Pacific/Auckland');
        expect(wrapper.findAll('li button').map(button => button.text())).toHaveLength(1);
        await wrapper.get('li button').trigger('click');
        expect(wrapper.get('input[type="hidden"]').attributes('value')).toBe('Pacific/Auckland');
        expect(wrapper.get('.flex-grow-1').attributes('aria-expanded')).toBe('false');
    });
});
