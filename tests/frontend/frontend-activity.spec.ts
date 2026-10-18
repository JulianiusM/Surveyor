// @vitest-environment happy-dom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {flushPromises, mount} from '@vue/test-utils';
import {defineComponent, type Component} from 'vue';
import {createMemoryHistory, createRouter} from 'vue-router';
import {VueQueryPlugin} from '@tanstack/vue-query';
import I18NextVue from 'i18next-vue';
import type {components} from '../../src/types/api/v1';
import {createPilotContext, observeInitialDocument, pilotContextKey} from '../../src/frontend/app/context';
import {activityKeys} from '../../src/frontend/app/queryKeys';
import ActivityPage from '../../src/frontend/features/activity/ActivityPage.vue';
import ActivityCreatePage from '../../src/frontend/features/activity/ActivityCreatePage.vue';
import {activityDateLabel, activityDayLabel, activityCreationWeeks} from '../../src/frontend/features/activity/presentation';

const planId = '11111111-1111-4111-8111-111111111111';
const slotId = '22222222-2222-4222-8222-222222222222';
const otherId = '33333333-3333-4333-8333-333333333333';
const session: components['schemas']['SessionView'] & {context: string; csrfToken: string} = {
    kind: 'account', context: 'activity-ui-context-1234567890', csrfToken: 'activity-ui-csrf-1234567890', locale: 'en',
    deployment: {buildId: 'fixture', apiCompatibility: 'v1-pilot-2026-10-07'}, activeProfile: {id: otherId, name: 'Participant'},
    profiles: [{id: otherId, name: 'Participant'}], loginUrl: '/users/login', logoutUrl: '/users/logout',
    shell: {version: 'test', imprintUrl: '/imprint', privacyPolicyUrl: '/privacy', localLoginEnabled: true, oidcEnabled: false, oidcName: 'SSO'},
};
const defaults = {participant: 1, guest: 0, authenticated: 0, public: 0};
const definitions: components['schemas']['ActivityCreateContext'] = {defaults, permissions: [{key: 'ACCESS_ITEMS', bit: 1}], presets: []};
const slot: components['schemas']['ActivitySlotView'] = {
    id: slotId, day: '2030-06-01', position: 0, title: 'Breakfast help', description: 'Kitchen duties',
    startTime: '09:00:00', endTime: '10:00:00', maxAssignees: 2, assignedCount: 0, selfAssigned: false, selfRoles: [],
    roles: [], assignees: [], editToken: '"slot-fixture"',
    capabilities: {editTitle: true, editDescription: true, editMeta: true, editCapacity: true, editRoles: true, manageAssignments: true, remove: true, inlineMetadataAdmission: true},
};
const view: components['schemas']['ActivityView'] = {
    entityType: 'activity', id: planId, title: 'Camp duties', description: 'Shared camp duties', startDate: '2030-06-01', endDate: '2030-06-02',
    headerUrl: null, headerVersion: null, currentEventId: null, currentEventUrl: null, archived: false, inheritedArchived: false,
    assignmentMode: 'FREE', canSelfAssign: true, allowOverfillAfterFull: false, bindingDeadline: null, requirementProgress: null,
    weeks: [{start: '2030-05-27', days: ['2030-06-01', '2030-06-02']}],
    slots: [slot, {...slot, id: otherId, title: 'Lunch help', day: '2030-06-02', selfAssigned: true, assignedCount: 1}],
    allRoles: [{id: 1, title: 'Kitchen lead', description: null}], textFields: [], participants: [],
    counters: {participants: 1, open: 2, empty: 1}, orderToken: '"order-fixture"',
    capabilities: {editTitle: true, editDescription: true, editDates: true, addSlot: true, reorderSlots: true,
        manageSettings: false, manageRequirements: true, exportSchedule: true, duplicate: true, remove: true, roleCreationAdmission: true, rulesWorkspace: false},
};
const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    document.body.innerHTML = '';
});

function json(value: unknown, status = 200): Response {
    return new Response(JSON.stringify(value), {status, headers: {'Content-Type': 'application/json',
        'X-Surveyor-Context': session.context, ETag: '"fixture"'}});
}

/** Mount production components and generated transport; only HTTP delivery is
 * substituted. Persistence and native/built parity have their own integration layers. */
async function mounted(component: Component, handler: (request: Request) => Promise<Response>,
    path = `/frontend-pilot/activity/${planId}`) {
    const request = vi.fn((input: RequestInfo | URL) => handler(input as Request));
    const context = createPilotContext({session}, true, request);
    context.hydrated.value = true;
    const router = createRouter({history: createMemoryHistory(), routes: [
        {path: '/frontend-pilot/activity/create', component}, {path: '/frontend-pilot/activity/:planId/duplicate', component},
        {path: '/frontend-pilot/activity/:planId', component: component === ActivityPage ? component : defineComponent({template: '<p>Created plan</p>'})},
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
    if (component === ActivityPage) {
        await vi.waitFor(() => expect(context.queryClient.getQueryState(activityKeys.detail(session.context, planId))).toMatchObject({status: 'success'}));
        await flushPromises();
    }
    return {root, wrapper: root.findComponent(component), request, context, router};
}

describe('Activity production frontend consumers', () => {
    it('keeps schedule filters through refreshed data and uses the Activity document title', async () => {
        const {wrapper, context} = await mounted(ActivityPage, async () => json(view));
        expect(context.pageTitle.value).toBe('Camp duties | Activity planner');
        await wrapper.get('[data-slot-filter="mine"]').trigger('click');
        expect(wrapper.get(`[data-slotid="${slotId}"]`).classes()).toContain('d-none');
        expect(wrapper.get(`[data-slotid="${otherId}"]`).classes()).not.toContain('d-none');
        await context.queryClient.invalidateQueries({queryKey: activityKeys.detail(session.context, planId)});
        await flushPromises();
        expect(wrapper.get('[data-slot-filter="mine"]').classes()).toContain('active');
    });

    it('cancels warning review without writing and submits only the newly reviewed digest', async () => {
        let previews = 0;
        const writes: unknown[] = [];
        const {wrapper} = await mounted(ActivityPage, async request => {
            if (request.method === 'GET') return json(view);
            if (new URL(request.url).pathname.endsWith('/warnings')) {
                previews += 1;
                return json({warnings: [{type: 'overlap', confirmable: true}], overlapConfirmation: 'review-' + previews});
            }
            writes.push(await request.json());
            return json({changed: true});
        });
        await wrapper.get(`[data-slotid="${slotId}"] [data-action="assign"]`).trigger('click');
        await flushPromises();
        expect(document.querySelector('#assignmentWarningSlot')?.textContent).toBe('Breakfast help on 2030-06-01 (09:00-10:00)');
        (document.querySelector('#assignmentWarningCancel') as HTMLButtonElement).click();
        await flushPromises();
        expect(writes).toEqual([]);
        await wrapper.get(`[data-slotid="${slotId}"] [data-action="assign"]`).trigger('click');
        await flushPromises();
        (document.querySelector('#assignmentWarningConfirm') as HTMLButtonElement).click();
        await flushPromises();
        expect(previews).toBe(2);
        expect(writes).toEqual([{assigned: true, overlapConfirmation: 'review-2'}]);
    });

    it('reviews warnings for an available named role even on an existing membership', async () => {
        let previews = 0;
        let writes = 0;
        const {wrapper} = await mounted(ActivityPage, async request => {
            if (request.method === 'GET') return json({...view, slots: [{...slot, selfAssigned: true, assignedCount: 1,
                roles: [{id: 1, name: 'Kitchen lead', maxQty: 1, assignedQty: 0, assignmentId: null, assigneeName: null, self: false}]}]});
            if (new URL(request.url).pathname.endsWith('/warnings')) {
                previews += 1;
                return json({warnings: [{type: 'over_capacity'}]});
            }
            writes += 1;
            return json({changed: true});
        });
        await wrapper.get('[data-action="take-role"]').trigger('click');
        await flushPromises();
        expect(previews).toBe(1);
        expect(writes).toBe(0);
        expect(document.querySelector('#assignmentWarningModal')).not.toBeNull();
    });

    it('does not submit a warning that the server explicitly marks blocking', async () => {
        let writes = 0;
        const {wrapper} = await mounted(ActivityPage, async request => {
            if (request.method === 'GET') return json(view);
            if (new URL(request.url).pathname.endsWith('/warnings')) return json({warnings: [{type: 'overlap', confirmable: false}]});
            writes += 1;
            return json({changed: true});
        });
        await wrapper.get(`[data-slotid="${slotId}"] [data-action="assign"]`).trigger('click');
        await flushPromises();
        const confirm = document.querySelector<HTMLButtonElement>('#assignmentWarningConfirm')!;
        expect(confirm.disabled).toBe(true);
        confirm.click();
        await flushPromises();
        expect(writes).toBe(0);
    });

    it('retains safe role occupancy when private assignee identities are redacted', async () => {
        const {wrapper} = await mounted(ActivityPage, async () => json({...view, slots: [{...slot,
            roles: [{id: 1, name: 'Kitchen lead', maxQty: 1, assignedQty: 1, assignmentId: null, assigneeName: null, self: false}]}]}));
        expect(wrapper.get('.role-assignment').text()).toBe('Kitchen lead: Assigned');
        expect(wrapper.find('[data-action="take-role"]').exists()).toBe(false);
    });

    it('retains the native advanced destination for an admitted empty linked plan without reading that workspace', async () => {
        const {wrapper, request} = await mounted(ActivityPage, async () => json({...view, slots: [], currentEventId: otherId,
            capabilities: {...view.capabilities, manageRequirements: false, rulesWorkspace: true}}));
        expect(wrapper.get('a.nav-link').attributes('href')).toBe('/activity/' + planId + '#tab-rules');
        expect(wrapper.get('a.nav-link').text()).toBe('Rules & auto-assign');
        expect(request.mock.calls.some(([request]) => new URL((request as Request).url).pathname.includes('recommendation'))).toBe(false);
    });

    it('preserves authoritative schedule time ordering when saved positions differ', async () => {
        const {wrapper} = await mounted(ActivityPage, async () => json({...view, slots: [
            {...slot, position: 1}, {...slot, id: otherId, title: 'Evening help', startTime: '18:00:00', endTime: '19:00:00', position: 0},
        ]}));
        expect(wrapper.findAll('.slot-container .slot').map(element => element.attributes('data-slotid'))).toEqual([slotId, otherId]);
    });

    it('retains a dirty inline description when a fresh read clears the shared text', async () => {
        let current = structuredClone(view);
        const {wrapper, context} = await mounted(ActivityPage, async () => json(current));
        const field = wrapper.get(`[data-slotid="${slotId}"] small[tabindex="0"]`);
        await field.trigger('dblclick');
        await field.get('input').setValue('My unsaved description');
        current = {...view, slots: view.slots.map(slot => slot.id === slotId ? {...slot, description: null, editToken: '"remote-empty"'} : slot)};
        await context.queryClient.invalidateQueries({queryKey: activityKeys.detail(session.context, planId)});
        await flushPromises();
        const retained = wrapper.get(`[data-slotid="${slotId}"] small[tabindex="0"] input`);
        expect((retained.element as HTMLInputElement).value).toBe('My unsaved description');
        expect(wrapper.find(`[data-slotid="${slotId}"] .pilot-inline-conflict`).exists()).toBe(true);
    });

    it('retains opening slot fields and blocks partial saves after a live field grant is revoked', async () => {
        let current = structuredClone(view);
        const {wrapper, context, request} = await mounted(ActivityPage, async () => json(current));
        await wrapper.get('[data-slot-edit]').trigger('click');
        await flushPromises();
        const title = document.querySelector<HTMLInputElement>('#slotEditorTitleInput')!;
        title.value = 'My unsaved slot title';
        title.dispatchEvent(new Event('input', {bubbles: true}));
        current = {...view, slots: view.slots.map(slot => slot.id === slotId
            ? {...slot, editToken: '"revoked-title"', capabilities: {...slot.capabilities, editTitle: false}} : slot)};
        await context.queryClient.invalidateQueries({queryKey: activityKeys.detail(session.context, planId)});
        await flushPromises();
        const retained = document.querySelector<HTMLInputElement>('#slotEditorTitleInput')!;
        expect(retained).toBe(title);
        expect(retained.value).toBe('My unsaved slot title');
        expect(retained.disabled).toBe(true);
        expect(document.querySelector<HTMLButtonElement>('#slotEditorSave')!.disabled).toBe(true);
        expect(request.mock.calls.every(([request]) => (request as Request).method === 'GET')).toBe(true);
    });

    it('uses fresh settings for dated-only metadata, export and automatic archival controls', async () => {
        const settings = {id: planId, title: view.title, headerUrl: null, headerVersion: null, editableFields: ['startDate', 'endDate'],
            settingsToken: '"edit-settings-fixture"', currentEvent: null, access: null,
            archive: {direct: false, inherited: false, archivedAt: null, autoArchivePaused: false, eventUrl: null, hasAutomaticSchedule: true},
            capabilities: {editHeader: false, linkEvent: false, managePermissions: false, duplicate: false, remove: false,
                manageArchive: true, archive: true, restore: false, manageAutomation: true, export: true}};
        const {wrapper} = await mounted(ActivityPage, async request => {
            const path = new URL(request.url).pathname;
            if (path.endsWith('/settings')) return json(settings);
            if (path.endsWith('/metadata')) return json({entityType: 'activity', id: planId, values: {startDate: view.startDate, endDate: view.endDate},
                editableFields: ['startDate', 'endDate'], currentEventId: null, archived: false, inheritedArchived: false});
            return json({...view, capabilities: {...view.capabilities, manageSettings: true}});
        });
        await wrapper.findAll('button').find(button => button.text() === 'Entity settings')!.trigger('click');
        await flushPromises();
        const dateGroup = document.querySelector('#activity-metadata-form details');
        expect(dateGroup?.querySelector('summary')?.textContent).toBe('Dates and time');
        expect(dateGroup?.hasAttribute('open')).toBe(true);
        expect(dateGroup?.querySelectorAll('.col-md-6')).toHaveLength(2);
        (document.querySelector('#pilot-settings-tab-actions') as HTMLButtonElement).click();
        await flushPromises();
        expect(document.querySelector('#pilot-settings-actions')?.textContent).toContain('Pause automatic archival');
        const link = document.querySelector<HTMLAnchorElement>('#pilot-settings-actions a[target="_blank"]');
        expect(link?.getAttribute('href')).toBe('/activity/' + planId + '/export/schedule');
        expect(link?.textContent).toBe('Export schedule');
    });

    it('preserves native inline metadata admission before opening title or capacity drafts', async () => {
        const {wrapper, request} = await mounted(ActivityPage, async () => json({...view,
            slots: [{...slot, capabilities: {...slot.capabilities, inlineMetadataAdmission: false}}]}));
        await wrapper.get('.slot .fw-bold').trigger('dblclick');
        await flushPromises();
        expect(wrapper.find('.slot input').exists()).toBe(false);
        expect(request.mock.calls.every(([request]) => (request as Request).method === 'GET')).toBe(true);
    });

    it('keeps role search visible while denying native root metadata admission before role creation', async () => {
        const {wrapper, request} = await mounted(ActivityPage, async () => json({...view,
            capabilities: {...view.capabilities, roleCreationAdmission: false}}));
        await wrapper.get('[data-slot-edit]').trigger('click');
        await flushPromises();
        const search = document.querySelector<HTMLInputElement>('#slotEditorRoleInput')!;
        search.value = 'New role';
        search.dispatchEvent(new Event('input', {bubbles: true}));
        await flushPromises();
        (document.querySelector('#slotEditorRoleSuggestions button') as HTMLButtonElement).click();
        await flushPromises();
        expect(document.body.textContent).toContain('You need Edit Meta permission to create roles for this plan.');
        expect(search.value).toBe('New role');
        expect(request.mock.calls.every(([request]) => (request as Request).method === 'GET')).toBe(true);
    });

    it('keeps the native default of one when optional new-slot capacity is blank', async () => {
        let submitted: unknown;
        const {wrapper} = await mounted(ActivityPage, async request => {
            if (request.method === 'GET') return json(view);
            submitted = await request.json();
            return json({changed: true});
        });
        await wrapper.findAll('[data-add-slot]')[0]!.trigger('click');
        await flushPromises();
        const title = document.querySelector<HTMLInputElement>('#slotEditorTitleInput')!;
        title.value = 'Extra slot';
        title.dispatchEvent(new Event('input', {bubbles: true}));
        const capacity = document.querySelector<HTMLInputElement>('#slotEditorCapacity')!;
        capacity.value = '';
        capacity.dispatchEvent(new Event('input', {bubbles: true}));
        document.querySelector('#slotEditorForm')!.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
        await flushPromises();
        expect(submitted).toMatchObject({title: 'Extra slot', maxAssignees: 1});
    });

    it('defaults a one-day calendar and retains outside-range slot drafts during date recovery', async () => {
        const {wrapper} = await mounted(ActivityCreatePage, async request => {
            return new URL(request.url).pathname.endsWith('/events') ? json({items: [], nextCursor: null, previousCursor: null})
                : json({entry: {kind: 'render'}, context: definitions, selectedEvent: null});
        }, '/frontend-pilot/activity/create');
        await wrapper.get('#startDate').setValue('2030-06-01');
        await flushPromises();
        expect(wrapper.get<HTMLInputElement>('#endDate').element.value).toBe('2030-06-01');
        expect(wrapper.findAll('.add-slot')).toHaveLength(1);
        await wrapper.get('#endDate').setValue('2030-06-02');
        await flushPromises();
        await wrapper.findAll('.add-slot')[1]!.trigger('click');
        await wrapper.get('.slot input').setValue('Retained Sunday draft');
        await wrapper.get('#endDate').setValue('2030-06-01');
        await flushPromises();
        expect(wrapper.find('.slot').exists()).toBe(false);
        await wrapper.get('#endDate').setValue('2030-06-02');
        await flushPromises();
        expect(wrapper.get<HTMLInputElement>('.slot input').element.value).toBe('Retained Sunday draft');
        await wrapper.get('#endDate').setValue('2030-05-31');
        await flushPromises();
        expect(wrapper.get<HTMLInputElement>('#endDate').element.validity.customError).toBe(true);
        expect(wrapper.findAll('.add-slot')).toHaveLength(2);
    });

    it('freezes injected root fields while the shared creation command is pending', async () => {
        let settle: ((response: Response) => void) | undefined;
        const {wrapper} = await mounted(ActivityCreatePage, async request => {
            if (request.method === 'POST') return new Promise<Response>(resolve => { settle = resolve; });
            return new URL(request.url).pathname.endsWith('/events') ? json({items: [], nextCursor: null, previousCursor: null})
                : json({entry: {kind: 'render'}, context: definitions, selectedEvent: null});
        }, '/frontend-pilot/activity/create');
        await wrapper.get('#title').setValue('Pending creation');
        await wrapper.get('#startDate').setValue('2030-06-01');
        await flushPromises();
        await wrapper.get('form').trigger('submit');
        await flushPromises();
        expect(settle).toBeDefined();
        for (const id of ['title', 'startDate', 'endDate']) expect(wrapper.get('#' + id).attributes('disabled')).toBeDefined();
        expect(wrapper.get('label[for="start"]').text()).toBe('Start date *');
        expect(wrapper.get('#create-description').attributes('name')).toBe('description');
        expect(wrapper.get('#create-header').attributes('name')).toBe('headerImg');
        settle!(json({id: otherId}, 201));
        await flushPromises();
    });

    it('renders read-only progress with native emphasis and filters admitted participant status locally', async () => {
        const person: components['schemas']['ActivityParticipant'] = {participantKey: otherId, name: 'Alex Participant', count: 1,
            assignedShifts: 1, roles: ['default', 'Kitchen lead'], roleIds: [1], requiredShifts: 2, remainingShifts: 1,
            source: 'duration', attendanceDays: 2, attendance: {arrivalDate: '2030-06-01', departureDate: '2030-06-02'}, assignmentMode: 'REQUIRED'};
        const {wrapper, request} = await mounted(ActivityPage, async () => json({...view, assignmentMode: 'REQUIRED',
            requirementProgress: {assignedShifts: 1, requiredShifts: 2, remainingShifts: 1, complete: false},
            participants: [person, {...person, participantKey: planId, name: 'Sam Volunteer', assignedShifts: 0, requiredShifts: 0, remainingShifts: 0}]}));
        // Native strong margins supply visual separation without literal spaces
        // in these text nodes; preserve both emphasis and measured presentation.
        expect(wrapper.get('#my-requirement-progress').text()).toContain('You participate in1 of 2required slots.Take 1 more.');
        expect(wrapper.get('#my-requirement-progress').findAll('strong').map(element => element.text())).toEqual(['1 of 2', 'Take 1 more.']);
        await wrapper.findAll('[role="tab"]').find(button => button.text() === 'Participants')!.trigger('click');
        await wrapper.get('[data-participant-filter="needs-more"]').trigger('click');
        expect(wrapper.findAll('[data-participant-row]').map(row => row.text())).toHaveLength(1);
        await wrapper.get('[data-participant-search]').setValue('Sam');
        expect(wrapper.text()).toContain('No participants match the current search and filter.');
        expect(request.mock.calls.every(([request]) => (request as Request).method === 'GET')).toBe(true);
    });

    it('delegates a view-only shared text pencil to the inline textarea and preserves its token', async () => {
        let submitted: unknown;
        let token: string | null = null;
        const {wrapper} = await mounted(ActivityPage, async request => {
            if (request.method === 'GET') return json({...view, textFields: [{id: otherId, title: 'Notes', text: 'Original notes',
                editToken: '"text-original"', capabilities: {edit: true, editTitle: false, delete: false}}]});
            token = request.headers.get('If-Match');
            submitted = await request.json();
            return json({changed: true});
        });
        await wrapper.get('.text-field-edit').trigger('click');
        await flushPromises();
        expect(document.querySelector('#textFieldForm')).toBeNull();
        const textarea = wrapper.get('.text-field-content textarea');
        await textarea.setValue('Updated shared notes');
        await textarea.trigger('keydown', {key: 'Enter', ctrlKey: true});
        await flushPromises();
        expect(submitted).toEqual({text: 'Updated shared notes'});
        expect(token).toBe('"text-original"');
    });

    it('copies dated slots through shared creation without copying assignments or source identity', async () => {
        let submitted: components['schemas']['ActivityCreateInput'] | undefined;
        const {wrapper, router} = await mounted(ActivityCreatePage, async request => {
            const path = new URL(request.url).pathname;
            if (path.endsWith('/duplicate')) return json({title: 'Copied duties', description: 'Copied description', eventId: null,
                startDate: view.startDate, endDate: view.endDate, slots: [{id: slotId, day: slot.day, position: 0, title: slot.title,
                    description: slot.description, startTime: slot.startTime, endTime: slot.endTime, maxAssignees: 2}],
                defaultPermissions: defaults, selectedEvent: null, formContext: definitions});
            if (path.endsWith('/create-entry')) return json({entry: {kind: 'render'}, context: definitions, selectedEvent: null});
            if (path.endsWith('/events')) return json({items: [], nextCursor: null, previousCursor: null});
            const form = await request.formData();
            submitted = JSON.parse(String(form.get('data')));
            return json({id: otherId}, 201);
        }, `/frontend-pilot/activity/${planId}/duplicate`);
        await vi.waitFor(() => expect(wrapper.find('#title').exists()).toBe(true));
        expect(wrapper.get<HTMLInputElement>('#title').element.value).toBe('Copied duties');
        expect(wrapper.get<HTMLInputElement>('.slot input').element.value).toBe('Breakfast help');
        await wrapper.get('form').trigger('submit');
        await flushPromises();
        expect(submitted).toMatchObject({title: 'Copied duties', startDate: view.startDate, endDate: view.endDate,
            slots: [{title: 'Breakfast help', position: 0, day: slot.day, maxAssignees: 2}]});
        expect(submitted).not.toHaveProperty('assignments');
        expect(router.currentRoute.value.path).toBe('/frontend-pilot/activity/' + otherId);
    });

    it('groups partial weeks and leap-day dates without changing stored civil days', () => {
        expect(activityCreationWeeks('2032-02-28', '2032-03-02')).toEqual([['2032-02-28', '2032-02-29'], ['2032-03-01', '2032-03-02']]);
        expect(activityCreationWeeks('2032-03-02', '2032-03-01')).toEqual([]);
    });

    it('retains native browser-zone date labels and creation stepping in a negative offset', () => {
        vi.stubEnv('TZ', 'America/Los_Angeles');
        expect(activityDateLabel('2030-06-01', 'en')).toBe('5/31/2030');
        expect(activityDayLabel('2030-06-01', 'en')).toBe('Fri');
        expect(activityCreationWeeks('2030-06-03', '2030-06-04')).toEqual([['2030-06-03'], ['2030-06-04']]);
    });
});
