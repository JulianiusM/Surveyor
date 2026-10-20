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
import {activityKeys} from '../../src/frontend/app/queryKeys';
import ActivityPage from '../../src/frontend/features/activity/ActivityPage.vue';
import ActivityCreatePage from '../../src/frontend/features/activity/ActivityCreatePage.vue';
import {activityDateLabel, activityDayLabel, activityCreationWeeks, activityParticipantName} from '../../src/frontend/features/activity/presentation';
import {createTranslator} from '../../src/modules/localization/translator';

const planId = '11111111-1111-4111-8111-111111111111';
const slotId = '22222222-2222-4222-8222-222222222222';
const otherId = '33333333-3333-4333-8333-333333333333';
const session: components['schemas']['SessionView'] & {context: string; csrfToken: string} = {
    kind: 'account', context: 'activity-ui-context-1234567890', csrfToken: 'activity-ui-csrf-1234567890', locale: 'en',
    deployment: {buildId: 'fixture', apiCompatibility}, activeProfile: {id: otherId, name: 'Participant'},
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
    allRoles: [{id: '1', title: 'Kitchen lead', description: null}], textFields: [], participants: [],
    counters: {participants: 1, open: 2, empty: 1}, orderToken: '"order-fixture"',
    capabilities: {editTitle: true, editDescription: true, editDates: true, addSlot: true, reorderSlots: true,
        manageSettings: false, manageRequirements: true, manageRecommendations: false, exportSchedule: true, duplicate: true, remove: true, roleCreationAdmission: true, rulesWorkspace: false},
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
    path = `/frontend-pilot/activity/${planId}`, stubs: Record<string, boolean> = {}) {
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
        stubs,
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
    it('counts all saved slots independently of schedule filters through refreshed and empty data', async () => {
        let current: components['schemas']['ActivityView'] = {...view,
            slots: [slot, {...view.slots[1]!, maxAssignees: 1}], counters: {participants: 1, open: 1, empty: 1}};
        const {wrapper, context, request} = await mounted(ActivityPage, async () => json(current));
        expect(context.pageTitle.value).toBe('Camp duties | Activity planner');

        // The second slot is mine and full, so each filter selects a genuinely
        // different set while the total still describes the complete saved plan.
        for (const [filter, visible] of [['all', [slotId, otherId]], ['mine', [otherId]], ['open', [slotId]]] as const) {
            await wrapper.get(`[data-slot-filter="${filter}"]`).trigger('click');
            expect(wrapper.findAll('.slot:not(.d-none)').map(node => node.attributes('data-slotid'))).toEqual(visible);
            expect(wrapper.get('.bi-card-checklist + .badge').text()).toBe('2');
        }

        current = {...current, slots: [...current.slots, {...slot, id: planId, title: 'Dinner help', day: '2030-06-02'}],
            counters: {participants: 1, open: 2, empty: 2}};
        await context.queryClient.invalidateQueries({queryKey: activityKeys.detail(session.context, planId)});
        await flushPromises();
        expect(wrapper.get('[data-slot-filter="open"]').classes()).toContain('active');
        expect(wrapper.findAll('.slot:not(.d-none)')).toHaveLength(2);
        expect(wrapper.get('.bi-card-checklist + .badge').text()).toBe('3');

        // A newly admitted empty plan displays zero rather than retaining the
        // previous total or deriving it from a filtered DOM collection.
        current = {...current, slots: [], counters: {participants: 0, open: 0, empty: 0}};
        await context.queryClient.invalidateQueries({queryKey: activityKeys.detail(session.context, planId)});
        await flushPromises();
        expect(wrapper.get('[data-slot-filter="open"]').classes()).toContain('active');
        for (const filter of ['all', 'mine', 'open']) {
            await wrapper.get(`[data-slot-filter="${filter}"]`).trigger('click');
            expect(wrapper.findAll('.slot')).toHaveLength(0);
            expect(wrapper.get('.bi-card-checklist + .badge').text()).toBe('0');
        }
        expect(request.mock.calls.every(([input]) => (input as Request).method === 'GET')).toBe(true);
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
                roles: [{id: '1', name: 'Kitchen lead', maxQty: 1, assignedQty: 0, assignmentId: null, assigneeName: null, self: false}]}]});
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
            roles: [{id: '1', name: 'Kitchen lead', maxQty: 1, assignedQty: 1, assignmentId: null, assigneeName: null, self: false}]}]}));
        expect(wrapper.get('.role-assignment').text()).toBe('Kitchen lead: Assigned');
        expect(wrapper.find('[data-action="take-role"]').exists()).toBe(false);
    });

    it.each([{reason: 'the last participant leaves', count: 0}, {reason: 'participant access is redacted', count: null}])(
        'restores Schedule when $reason without replacing independent drafts', async ({count}) => {
            const person: components['schemas']['ActivityParticipant'] = {participantKey: otherId, name: 'Alex Participant', count: 1,
                assignedShifts: 1, roles: ['default'], roleIds: [], requiredShifts: 0, remainingShifts: 0,
                source: 'none', attendanceDays: 2, attendance: {arrivalDate: '2030-06-01', departureDate: '2030-06-02'}, assignmentMode: 'FREE'};
            let current: components['schemas']['ActivityView'] = {...view, participants: [person], textFields: [{id: otherId,
                title: 'Shared notes', text: 'Saved instructions', editToken: '"text-fixture"',
                capabilities: {edit: true, editTitle: true, delete: true}}]};
            const {wrapper, context, request} = await mounted(ActivityPage, async () => json(current));

            // Shared text is a real independent business draft outside the panels.
            // A valid Participants selection and its local search also survive reads.
            await wrapper.get('.text-field-content').trigger('dblclick');
            await flushPromises();
            const draft = wrapper.get<HTMLTextAreaElement>('.text-field-content textarea');
            await draft.setValue('Independent unsaved instructions');
            await wrapper.get('#activity-participants-tab').trigger('click');
            const search = wrapper.get<HTMLInputElement>('[data-participant-search]');
            await search.setValue('Alex');
            current = {...current, title: 'Refreshed camp duties'};
            await context.queryClient.invalidateQueries({queryKey: activityKeys.detail(session.context, planId)});
            await flushPromises();
            expect(wrapper.get('#activity-participants-tab').attributes('aria-selected')).toBe('true');
            expect(wrapper.get('[data-participant-search]').element).toBe(search.element);
            expect(search.element.value).toBe('Alex');

            // Empty membership and denied disclosure produce the same absent panel,
            // while retained assignment counts distinguish their admitted snapshots.
            current = {...current, participants: [], counters: {...current.counters, participants: count},
                slots: current.slots.map(value => ({...value, assignees: [],
                    ...(count === null ? {} : {assignedCount: 0, selfAssigned: false})}))};
            await context.queryClient.invalidateQueries({queryKey: activityKeys.detail(session.context, planId)});
            await flushPromises();
            expect(wrapper.find('#activity-participants-tab').exists()).toBe(false);
            expect(wrapper.find('#tab-participants').exists()).toBe(false);
            expect(wrapper.get('#activity-schedule-tab').attributes('aria-selected')).toBe('true');
            expect(wrapper.get('#tab-schedule').isVisible()).toBe(true);
            expect(wrapper.get('.text-field-content textarea').element).toBe(draft.element);
            expect(draft.element.value).toBe('Independent unsaved instructions');

            // Restored participation adds an available tab without overriding the
            // now-valid Schedule selection or admitting any automatic mutation.
            current = {...current, participants: [person], counters: {...current.counters, participants: 1}};
            await context.queryClient.invalidateQueries({queryKey: activityKeys.detail(session.context, planId)});
            await flushPromises();
            expect(wrapper.find('#activity-participants-tab').exists()).toBe(true);
            expect(wrapper.get('#activity-schedule-tab').attributes('aria-selected')).toBe('true');
            expect(wrapper.get('.text-field-content textarea').element).toBe(draft.element);
            expect(request.mock.calls.every(([input]) => (input as Request).method === 'GET')).toBe(true);
        },
    );

    it('retains admitted Rules selection and restores Schedule when that workspace is withdrawn', async () => {
        let current: components['schemas']['ActivityView'] = {...view, slots: [], currentEventId: otherId,
            capabilities: {...view.capabilities, manageRequirements: false, manageRecommendations: false, rulesWorkspace: true}};
        const {wrapper, request, context, router} = await mounted(ActivityPage, async () => json(current));
        const rules = wrapper.findAll('button[role="tab"]').find(button => button.text() === 'Rules & auto-assign')!;
        expect(rules.exists()).toBe(true);
        expect(wrapper.find('a[href*="#tab-rules"]').exists()).toBe(false);
        await rules.trigger('click');
        expect(wrapper.get('#tab-rules').isVisible()).toBe(true);
        expect(router.currentRoute.value.path).toBe('/frontend-pilot/activity/' + planId);

        // A normal detail refresh preserves tab selection and cannot invoke a
        // method that this admitted actor does not hold.
        await context.queryClient.invalidateQueries({queryKey: activityKeys.detail(session.context, planId)});
        await flushPromises();
        expect(wrapper.get('#tab-rules').isVisible()).toBe(true);
        expect(request.mock.calls.some(([request]) => /\/(recommendations|requirements)(?:\/|$)/u.test(new URL((request as Request).url).pathname))).toBe(false);

        // The same admitted-tab reconciliation handles advanced access withdrawal;
        // it must not rely on a separate Rules-only selection mirror or watcher.
        current = {...current, currentEventId: null, capabilities: {...current.capabilities, rulesWorkspace: false}};
        await context.queryClient.invalidateQueries({queryKey: activityKeys.detail(session.context, planId)});
        await flushPromises();
        expect(wrapper.find('#tab-rules').exists()).toBe(false);
        expect(wrapper.get('#activity-schedule-tab').attributes('aria-selected')).toBe('true');
        expect(wrapper.get('#tab-schedule').isVisible()).toBe(true);
        expect(request.mock.calls.every(([input]) => (input as Request).method === 'GET')).toBe(true);
    });

    it('retires advanced caches on Event unlink even when independent grants remain enabled', async () => {
        let current: components['schemas']['ActivityView'] = {...view, currentEventId: otherId, capabilities: {...view.capabilities,
            manageRequirements: true, manageRecommendations: true, rulesWorkspace: true}};
        // Isolate the parent's admitted-subtree/cache ownership. Each advanced
        // child's actual read, draft and denial lifecycle has its own mounted cases.
        const {wrapper, context} = await mounted(ActivityPage, async () => json(current), undefined,
            {ActivityRequirements: true, ActivityRecommendations: true});
        const requirements = activityKeys.requirements(session.context, planId);
        const recommendations = activityKeys.recommendations(session.context, planId);
        const job = activityKeys.recommendationJob(session.context, planId, otherId);
        context.queryClient.setQueryData(requirements, {private: 'former Event requirements'});
        context.queryClient.setQueryData(recommendations, {private: 'former Event participants'});
        context.queryClient.setQueryData(job, {private: 'former Event job'});
        current = {...current, currentEventId: null, capabilities: {...current.capabilities, rulesWorkspace: false}};
        await context.queryClient.invalidateQueries({queryKey: activityKeys.detail(session.context, planId)});
        await flushPromises();
        expect(wrapper.find('#tab-rules').exists()).toBe(false);
        expect(context.queryClient.getQueryData(requirements)).toBeUndefined();
        expect(context.queryClient.getQueryData(recommendations)).toBeUndefined();
        expect(context.queryClient.getQueryData(job)).toBeUndefined();
        expect(context.queryClient.getQueryData(activityKeys.detail(session.context, planId))).toBeDefined();
    });

    it('preserves authoritative schedule time ordering when saved positions differ', async () => {
        const {wrapper} = await mounted(ActivityPage, async () => json({...view, slots: [
            {...slot, position: 1}, {...slot, id: otherId, title: 'Evening help', startTime: '18:00:00', endTime: '19:00:00', position: 0},
        ]}));
        expect(wrapper.findAll('.slot-container .slot').map(element => element.attributes('data-slotid'))).toEqual([slotId, otherId]);
    });

    it('releases removed role assignees and fields while keeping valid selections in the actual dialog', async () => {
        let current: components['schemas']['ActivityView'] = {...view, slots: [{...slot,
            roles: [{id: '1', name: 'Kitchen lead', maxQty: 1, assignedQty: 1, assignmentId: '10', assigneeName: 'Alex', self: false},
                {id: '2', name: 'Helper', maxQty: 1, assignedQty: 1, assignmentId: '11', assigneeName: 'Blair', self: false}],
            assignees: [{assignmentId: '10', name: 'Alex', roles: ['Kitchen lead']},
                {assignmentId: '11', name: 'Blair', roles: ['Helper']}]}]};
        const writes: unknown[] = [];
        const {wrapper, context} = await mounted(ActivityPage, async request => {
            if (request.method === 'GET') return json(current);
            writes.push(await request.json());
            return json({changed: true});
        });
        const opener = wrapper.findAll('button').find(button => button.text() === 'Manage role assignments')!;
        await opener.trigger('click');
        await flushPromises();
        expect(document.querySelector<HTMLSelectElement>('[data-role-name="Kitchen lead"] select')!.value).toBe('10');
        current = {...current, slots: [{...current.slots[0], assignees: [current.slots[0].assignees[1]]}]};
        await context.queryClient.invalidateQueries({queryKey: activityKeys.detail(session.context, planId)});
        await flushPromises();
        expect(document.querySelector<HTMLSelectElement>('[data-role-name="Kitchen lead"] select')!.value).toBe('');
        expect(document.querySelector<HTMLSelectElement>('[data-role-name="Helper"] select')!.value).toBe('11');
        current = {...current, slots: [{...current.slots[0], roles: [...current.slots[0].roles,
            {id: '3', name: 'constructor', maxQty: 1, assignedQty: 1, assignmentId: '11', assigneeName: 'Blair', self: false},
            {id: '4', name: '__proto__', maxQty: 1, assignedQty: 1, assignmentId: '11', assigneeName: 'Blair', self: false}]}]};
        await context.queryClient.invalidateQueries({queryKey: activityKeys.detail(session.context, planId)});
        await flushPromises();
        expect(document.querySelector<HTMLSelectElement>('[data-role-name="constructor"] select')!.value).toBe('11');
        expect(document.querySelector<HTMLSelectElement>('[data-role-name="__proto__"] select')!.value).toBe('11');
        current = {...current, slots: [{...current.slots[0], roles: [current.slots[0].roles[0]]}]};
        await context.queryClient.invalidateQueries({queryKey: activityKeys.detail(session.context, planId)});
        await flushPromises();
        expect(document.querySelector('[data-role-name="Helper"]')).toBeNull();
        // The visible blank must submit null, never the released assignment ID.
        document.querySelector<HTMLFormElement>('#slotRoleAdminForm')!.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
        await flushPromises();
        expect(writes).toEqual([{assignments: [{role: 'Kitchen lead', assignmentId: null}]}]);
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
        const {wrapper, context, request} = await mounted(ActivityCreatePage, async request => {
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
        const fields = wrapper.findAll<HTMLInputElement>('.slot input');
        const values = ['Retained Sunday draft', 'Bring a lantern', '19:30', '20:45', '3'];
        const labels = ['packing.title', 'packing.description', 'activity.startTime', 'activity.endTime', 'activity.maxParticipants'] as const;
        for (const [index, field] of fields.entries()) await field.setValue(values[index]);

        // Visible shared labels identify every control, including time/number
        // inputs whose placeholders cannot explain their purpose to a reader.
        // Translation changes those labels without remounting or reinterpreting
        // the same local text/time/lexical-number values.
        for (const locale of ['en', 'de'] as const) {
            context.locale.value = locale;
            await flushPromises();
            const current = wrapper.findAll<HTMLInputElement>('.slot input');
            expect(current).toHaveLength(labels.length);
            for (const [index, field] of current.entries()) {
                expect(field.element).toBe(fields[index]!.element);
                expect(field.element.value).toBe(values[index]);
                expect(field.element.labels).toHaveLength(1);
                const label = field.element.labels![0]!;
                expect(label.control).toBe(field.element);
                expect(label.textContent?.trim()).toBe(context.messages.value.t(labels[index]!) + (index === 0 ? ' *' : ''));
                expect(label.classList.contains('visually-hidden')).toBe(false);
            }
            expect(wrapper.get('.slot button').attributes('aria-label')).toBe(context.messages.value.t('packing.removeRow'));
        }
        expect(fields[0]!.element.required).toBe(true);
        expect(fields.slice(2, 4).map(field => field.element.type)).toEqual(['time', 'time']);
        expect(fields[4]!.element.min).toBe('1');
        await wrapper.get('#endDate').setValue('2030-06-01');
        await flushPromises();
        expect(wrapper.find('.slot').exists()).toBe(false);
        await wrapper.get('#endDate').setValue('2030-06-02');
        await flushPromises();
        expect(wrapper.findAll<HTMLInputElement>('.slot input').map(field => field.element.value)).toEqual(values);
        await wrapper.get('#endDate').setValue('2030-05-31');
        await flushPromises();
        expect(wrapper.get<HTMLInputElement>('#endDate').element.validity.customError).toBe(true);
        expect(wrapper.findAll('.add-slot')).toHaveLength(2);
        expect(request.mock.calls.every(([value]) => (value as Request).method === 'GET')).toBe(true);
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
        // Pending presentation keeps each date input's real visible label;
        // the copied document POST names never identify these Vue controls.
        for (const [id, label] of [['startDate', 'Start date *'], ['endDate', 'End date *']]) {
            const control = wrapper.get<HTMLInputElement>('#' + id).element;
            expect(control.labels).toHaveLength(1);
            expect(control.labels![0]!.textContent?.trim()).toBe(label);
            expect(control.labels![0]!.control).toBe(control);
        }
        expect(wrapper.get('#create-description').attributes('name')).toBe('description');
        expect(wrapper.get('#create-header').attributes('name')).toBe('headerImg');
        settle!(json({id: otherId}, 201));
        await flushPromises();
    });

    it('renders read-only progress with native emphasis and filters admitted participant status locally', async () => {
        const person: components['schemas']['ActivityParticipant'] = {participantKey: otherId, name: 'Alex Participant', count: 1,
            assignedShifts: 1, roles: ['default', 'Kitchen lead'], roleIds: ['1'], requiredShifts: 2, remainingShifts: 1,
            source: 'duration', attendanceDays: 2, attendance: {arrivalDate: '2030-06-01', departureDate: '2030-06-02'}, assignmentMode: 'REQUIRED'};
        const {wrapper, request} = await mounted(ActivityPage, async () => json({...view, assignmentMode: 'REQUIRED',
            requirementProgress: {assignedShifts: 1, requiredShifts: 2, remainingShifts: 1, complete: false},
            participants: [person, {...person, participantKey: planId, name: 'Sam Volunteer', assignedShifts: 0, requiredShifts: 0, remainingShifts: 0}]}));
        // Native strong margins supply visual separation without literal spaces
        // in these text nodes; preserve both emphasis and measured presentation.
        expect(wrapper.get('#my-requirement-progress').text()).toContain('You participate in1 of 2required slots.Take 1 more.');
        expect(wrapper.get('#my-requirement-progress').findAll('strong').map(element => element.text())).toEqual(['1 of 2', 'Take 1 more.']);
        // Read-only progress stays in content with its original warning styling;
        // sharing the notice shell must not turn it into dismissible feedback.
        const progress = wrapper.get('#my-requirement-progress');
        expect(progress.classes()).toEqual(expect.arrayContaining(['status-notice', 'alert-warning', 'mb-3']));
        expect(progress.attributes('role')).toBeUndefined();
        expect(progress.find('.btn-close').exists()).toBe(false);
        expect(progress.classes()).not.toContain('pilot-notification');
        await wrapper.findAll('[role="tab"]').find(button => button.text() === 'Participants')!.trigger('click');
        expect(wrapper.get('#participant-status-overview').text()).toContain('2030-06-01 – 2030-06-02');
        await wrapper.get('[data-participant-filter="needs-more"]').trigger('click');
        expect(wrapper.findAll('[data-participant-row]').map(row => row.text())).toHaveLength(1);
        await wrapper.get('[data-participant-search]').setValue('Sam');
        expect(wrapper.text()).toContain('No participants match the current search and filter.');
        expect(request.mock.calls.every(([request]) => (request as Request).method === 'GET')).toBe(true);
    });

    it('localizes requirement provenance without changing admitted names or machine states', async () => {
        const participants = ['general', 'role', 'override'].map((source, index) => ({participantKey: `${otherId}-${index}`,
            name: `Person ${index}`, count: 1, assignedShifts: 0, requiredShifts: 2, remainingShifts: 2, source, roles: ['Kitchen lead'],
            roleIds: ['1'], attendanceDays: 2, attendance: null, assignmentMode: 'REQUIRED' as const}));
        const {wrapper, context} = await mounted(ActivityPage, async () => json({...view, assignmentMode: 'REQUIRED', participants}));
        await wrapper.findAll('[role="tab"]').find(button => button.text() === 'Participants')!.trigger('click');
        const search = wrapper.get<HTMLInputElement>('[data-participant-search]');
        expect(search.attributes('aria-label')).toBe(context.messages.value.t('activity.participantSearch'));
        await search.setValue('Person');
        expect(wrapper.findAll('.badge.text-uppercase').map(node => node.text())).toEqual(['general', 'role', 'override']);
        context.locale.value = 'de';
        await flushPromises();
        expect(search.attributes('aria-label')).toBe(context.messages.value.t('activity.participantSearch'));
        expect(wrapper.get('[data-participant-search]').element).toBe(search.element);
        expect(search.element.value).toBe('Person');
        expect(wrapper.findAll('.badge.text-uppercase').map(node => node.text())).toEqual(['allgemein', 'Rolle', 'individuell']);
        expect(wrapper.get('[data-participant-row]').attributes('data-participant-state')).toBe('unstarted');
        expect(wrapper.text()).toContain('Kitchen lead');
        expect(wrapper.text()).toContain('Person 0');
    });

    it('localizes explicit participant fallbacks and searches the displayed name while preserving literal names', async () => {
        const person: components['schemas']['ActivityParticipant'] = {participantKey: otherId, name: 'Participant', nameIsFallback: true,
            count: 0, assignedShifts: 0, requiredShifts: 0, remainingShifts: 0, source: 'none', roles: [], roleIds: [],
            attendanceDays: 2, attendance: null, assignmentMode: 'FREE'};
        const {wrapper, context, request} = await mounted(ActivityPage, async () => json({...view, participants: [person,
            {...person, participantKey: planId, nameIsFallback: false},
            {...person, participantKey: slotId, name: 'Profile #' + otherId, nameIsFallback: false}]}));
        await wrapper.findAll('[role="tab"]').find(button => button.text() === 'Participants')!.trigger('click');
        expect(wrapper.findAll('.participant-status-person strong').map(node => node.text()))
            .toEqual(['Participant', 'Participant', 'Profile #' + otherId]);
        context.locale.value = 'de';
        await flushPromises();
        expect(wrapper.findAll('.participant-status-person strong').map(node => node.text()))
            .toEqual(['Person', 'Participant', 'Profile #' + otherId]);
        await wrapper.get('[data-participant-search]').setValue('Person');
        expect(wrapper.findAll('[data-participant-row]')).toHaveLength(1);
        expect(wrapper.get('[data-participant-row]').attributes('data-participant-key')).toBe(otherId);
        expect(request.mock.calls.every(([value]) => (value as Request).method === 'GET')).toBe(true);
    });

    it('keeps raw names and caller-specific fallback identities separate from translated presentation', () => {
        const {t} = createTranslator('de');
        expect(activityParticipantName('Participant', t, false)).toBe('Participant');
        expect(activityParticipantName('Profile #' + otherId, t, false, otherId)).toBe('Profile #' + otherId);
        expect(activityParticipantName('', t, false, otherId)).toBe('');
        expect(activityParticipantName('', t, undefined, otherId)).toBe('');
        expect(activityParticipantName('Participant', t, true)).toBe('Person');
        expect(activityParticipantName('Profile #' + otherId, t, true, otherId)).toBe('Profil #' + otherId);
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

    it('keeps Vue civil-date labels and Monday creation weeks independent of a negative offset', async () => {
        vi.stubEnv('TZ', 'America/Los_Angeles');
        expect(activityDateLabel('2030-06-01', 'en')).toBe('6/1/2030');
        expect(activityDayLabel('2030-06-01', 'en')).toBe('Sat');
        expect(activityCreationWeeks('2030-06-03', '2030-06-04')).toEqual([['2030-06-03', '2030-06-04']]);

        const saved = await mounted(ActivityPage, async () => json(view));
        const header = saved.wrapper.get('th[data-date="2030-06-01"]');
        expect(header.get('.day').text()).toBe('Sat');
        expect(header.get('.date').text()).toBe('6/1/2030');
        saved.context.locale.value = 'de';
        await flushPromises();
        expect(saved.wrapper.get('th[data-date="2030-06-01"]').element).toBe(header.element);
        expect(header.get('.day').text()).toBe('Sa');
        expect(header.get('.date').text()).toBe('1.6.2030');

        const creating = await mounted(ActivityCreatePage, async request => new URL(request.url).pathname.endsWith('/events')
            ? json({items: [], nextCursor: null, previousCursor: null})
            : json({entry: {kind: 'render'}, context: definitions, selectedEvent: null}), '/frontend-pilot/activity/create');
        await vi.waitFor(() => expect(creating.wrapper.find('#startDate').exists()).toBe(true));
        await creating.wrapper.get('#startDate').setValue('2027-03-27');
        await creating.wrapper.get('#endDate').setValue('2027-03-30');
        const tables = creating.wrapper.findAll('#slotArea table');
        expect(tables).toHaveLength(2);
        expect(tables[0].findAll('th').map(cell => cell.text())).toEqual(['Sat3/27/2027', 'Sun3/28/2027']);
        expect(tables[1].findAll('th').map(cell => cell.text())).toEqual(['Mon3/29/2027', 'Tue3/30/2027']);
        expect(creating.wrapper.get<HTMLInputElement>('#startDate').element.value).toBe('2027-03-27');
        expect(creating.wrapper.get<HTMLInputElement>('#endDate').element.value).toBe('2027-03-30');
        expect(creating.request.mock.calls.some(([input]) => (input as Request).method !== 'GET')).toBe(false);
    });
});
