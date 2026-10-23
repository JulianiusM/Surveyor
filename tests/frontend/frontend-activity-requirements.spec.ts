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
import ActivityRequirements from '../../src/frontend/features/activity/ActivityRequirements.vue';
import ActivityPage from '../../src/frontend/features/activity/ActivityPage.vue';
import {analyzeRequirementDraft, createRequirementDraft, requirementInput, requirementAnalysisInput} from '../../src/frontend/features/activity/requirements';

const planId = '11111111-1111-4111-8111-111111111111';
const profileId = '22222222-2222-4222-8222-222222222222';
const outsideId = '33333333-3333-4333-8333-333333333333';
const session: components['schemas']['SessionView'] & {context: string; csrfToken: string} = {
    kind: 'account', context: 'activity-requirement-context-123456', csrfToken: 'activity-requirement-csrf-123456', locale: 'en',
    deployment: {buildId: 'fixture', apiCompatibility}, activeProfile: {id: profileId, name: 'Alex'},
    profiles: [{id: profileId, name: 'Alex'}], loginUrl: '/users/login', logoutUrl: '/users/logout',
    shell: {version: 'test', imprintUrl: '/imprint', privacyPolicyUrl: '/privacy', localLoginEnabled: true, oidcEnabled: false, oidcName: 'SSO'},
};

/** One admitted linked-event settings projection; no ORM or native frontend is imported. */
function configuration(): components['schemas']['ActivityRequirements'] {
    return {
        plan: {id: planId, assignmentMode: 'REQUIRED', generalRequiredShifts: 2, roundingMode: 'CEIL', bindingDeadline: null,
            startDate: '2030-06-01', endDate: '2030-06-02', allowOverfillAfterFull: false, allowExternalAssignees: false,
            allowArrivalDayEvening: true, allowDepartureDayMorning: true},
        roleRequirements: [], stayRequirements: [{stayDays: 1, requiredShifts: 1}, {stayDays: 2, requiredShifts: 2}], overrides: [],
        allRoles: [{id: '7', title: 'Kitchen lead', description: null}],
        participants: [{participantKey: 'profile:' + profileId, name: 'Alex', roleIds: ['7'], roles: ['Kitchen lead'], requiredShifts: 2,
            assignedShifts: 0, remainingShifts: 2, source: 'general', attendanceDays: 2, attendance: {arrivalDate: null, departureDate: null}, assignmentMode: 'REQUIRED'}],
        capacitySummary: {availableSlots: 2, requiredSlots: 2, difference: 0, configurationComplete: true},
        calculationContext: {participants: [{profileId, name: 'Alex', roleIds: ['7'], arrivalDate: null, departureDate: null}],
            assignedShiftCounts: {['profile:' + profileId]: 0}, slots: [{id: planId, day: '2030-06-01', startTime: null, endTime: null, maxAssignees: 2, roles: []}]},
        overrideTargets: [{key: 'profile:' + profileId, profileId, label: 'Alex', arrivalDate: null, departureDate: null}],
    };
}

/** Admit the real Rules child through its production schedule parent. Both
 * projections describe the same fixture participants, dates and slot capacity. */
function linkedPlan(config: components['schemas']['ActivityRequirements']): components['schemas']['ActivityView'] {
    // Recommendations stay outside this requirement-form journey; entering the
    // parent must perform only its detail and independent requirement GETs.
    return {
        entityType: 'activity', id: planId, title: 'Camp duties', description: null,
        startDate: config.plan.startDate, endDate: config.plan.endDate,
        headerUrl: null, headerVersion: null, currentEventId: outsideId, currentEventUrl: null,
        archived: false, inheritedArchived: false, assignmentMode: config.plan.assignmentMode,
        canSelfAssign: true, allowOverfillAfterFull: config.plan.allowOverfillAfterFull,
        bindingDeadline: config.plan.bindingDeadline, requirementProgress: null,
        weeks: [{start: '2030-05-27', days: [config.plan.startDate, config.plan.endDate]}],
        slots: config.calculationContext.slots.map(slot => ({...slot, position: 0, title: 'Kitchen duties', description: null,
            assignedCount: 0, selfAssigned: false, selfRoles: [], roles: [], assignees: [], editToken: '"fixture"',
            capabilities: {editTitle: true, editDescription: true, editMeta: true, editCapacity: true, editRoles: true,
                manageAssignments: true, remove: true, inlineMetadataAdmission: true}})),
        allRoles: config.allRoles, textFields: [], participants: config.participants.map(person => ({...person, name: person.name ?? '', count: 0})),
        counters: {participants: config.participants.length, open: config.capacitySummary.availableSlots, empty: config.calculationContext.slots.length},
        orderToken: '"fixture"',
        capabilities: {editTitle: true, editDescription: true, editDates: true, addSlot: true, reorderSlots: true,
            manageSettings: false, manageRequirements: true, manageRecommendations: false, exportSchedule: true,
            duplicate: true, remove: true, roleCreationAdmission: true, rulesWorkspace: true},
    };
}
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
});
function json(value: unknown, status = 200): Response {
    return new Response(JSON.stringify(value), {status, headers: {'Content-Type': 'application/json', 'X-Surveyor-Context': session.context}});
}

/** Exercise production query, draft, generated transport and command owners with
 * substituted HTTP delivery. Persistence belongs to integration and built E2E. */
async function mounted(handler: (request: Request) => Promise<Response>, component: Component = ActivityRequirements) {
    const request = vi.fn((input: RequestInfo | URL) => handler(input as Request));
    const context = createPilotContext({session}, true, request);
    context.hydrated.value = true;
    const router = createRouter({history: createMemoryHistory(), routes: [
        {path: '/frontend-pilot/activity/:planId', component, props: component === ActivityRequirements},
        {path: '/frontend-pilot', component: defineComponent({template: '<p>Overview</p>'})},
    ]});
    await router.push('/frontend-pilot/activity/' + planId);
    const stopInitial = observeInitialDocument(context, router);
    const root = mount(defineComponent({template: '<RouterView />'}), {attachTo: document.body, global: {
        plugins: [router, [VueQueryPlugin, {queryClient: context.queryClient}], [I18NextVue, {i18next: context.i18next}]],
        provide: {[pilotContextKey as symbol]: context},
    }});
    cleanups.push(async () => { root.unmount(); stopInitial(); await context.queryClient.cancelQueries(); context.queryClient.clear(); });
    await vi.waitFor(() => expect(root.find('#requirementForm').exists()).toBe(true));
    await flushPromises();
    return {root, wrapper: root.findComponent(ActivityRequirements), context, request, router};
}

describe('Activity requirements production frontend', () => {
    it.each(['fresh', 'stale'] as const)('restores saved requirement controls and coverage on %s cached plan re-entry',
        async function restoreCachedRequirements(cacheState) {
            const saved = configuration();
            const view = linkedPlan(saved);
            let requirementReads = 0;
            const {root, router, context, request} = await mounted(readPlan, ActivityPage);
            const key = activityKeys.requirements(session.context, planId);
            const cached = context.queryClient.getQueryData(key);

            /** Keep real generated decoding and cache structural sharing; only
             * HTTP delivery is substituted for this client's two projections. */
            async function readPlan(request: Request): Promise<Response> {
                if (new URL(request.url).pathname.endsWith('/requirements')) {
                    requirementReads++;
                    return json(saved);
                }
                return json(view);
            }

            // Depart through the actual router so the production parent and its
            // requirement draft are disposed while the QueryClient stays alive.
            await router.push('/frontend-pilot');
            await flushPromises();
            if (cacheState === 'stale') {
                // A normal stale visit must also work when its successful GET
                // returns equal JSON and Query retains the original data object.
                await context.queryClient.invalidateQueries({queryKey: key, refetchType: 'none'});
            }
            await router.push('/frontend-pilot/activity/' + planId);
            await vi.waitFor(() => expect(root.find('#requirementForm').exists()).toBe(true));
            if (cacheState === 'stale') await vi.waitFor(() => expect(requirementReads).toBe(2));
            await flushPromises();

            // Restored controls belong to the same admitted Rules workspace,
            // include its saved baseline and live coverage, and require no Save.
            await root.get('#activity-rules-tab').trigger('click');
            expect(root.get('#requirementForm').isVisible()).toBe(true);
            expect(root.get<HTMLSelectElement>('#assignmentMode').element.value).toBe('REQUIRED');
            expect(root.get<HTMLInputElement>('#requiredShifts').element.value).toBe('2');
            expect(root.get<HTMLInputElement>('#stayRequirement-2').element.value).toBe('2');
            expect(root.get('[data-requirements-dirty]').text()).toBe('Saved');
            expect(root.get('[data-coverage-state]').attributes('data-coverage-state')).toBe('exact');
            expect(root.get('#requirement-participant-status').text()).toContain('Alex');
            expect(root.get('[data-requirements-save]').attributes('disabled')).toBeDefined();
            expect(requirementReads).toBe(cacheState === 'fresh' ? 1 : 2);
            expect(context.queryClient.getQueryData(key)).toBe(cached);
            expect(request.mock.calls.every(([input]) => (input as Request).method === 'GET')).toBe(true);
        },
    );

    it('associates role and override controls with their visible labels across languages without releasing drafts', async () => {
        const {wrapper, context, request} = await mounted(async () => json(configuration()));
        await wrapper.get('[data-add-override]').trigger('click');
        const role = wrapper.get<HTMLInputElement>('#roleRequirement-7');
        const participant = wrapper.get<HTMLSelectElement>('[data-override-target="participant"]');
        const overrideRole = wrapper.get<HTMLSelectElement>('[data-override-target="role"]');
        const required = wrapper.get<HTMLInputElement>('[data-override-target="required"]');
        await role.setValue('3');
        await participant.setValue('profile:' + profileId);
        await overrideRole.setValue('7');
        await required.setValue('0');

        // Exercise the browser's real label/control associations, including the
        // slotted controls. Translation updates wording on the same dirty nodes.
        for (const locale of ['en', 'de'] as const) {
            context.locale.value = locale;
            await flushPromises();
            const labels = [
                [role.element, 'Kitchen lead'],
                [participant.element, context.messages.value.t('activity.participant')],
                [overrideRole.element, context.messages.value.t('activity.requirements.optionalRole')],
                [required.element, context.messages.value.t('activity.requirements.requiredShifts')],
            ] as const;
            for (const [control, text] of labels) {
                expect(control.labels).toHaveLength(1);
                const label = control.labels![0]!;
                expect(label.textContent?.trim()).toBe(text);
                expect(label.control).toBe(control);
            }
            expect(wrapper.get('#roleRequirement-7').element).toBe(role.element);
            expect(wrapper.get('[data-override-target="participant"]').element).toBe(participant.element);
            expect([role.element.value, participant.element.value, overrideRole.element.value, required.element.value])
                .toEqual(['3', 'profile:' + profileId, '7', '0']);
        }
        expect(request.mock.calls.every(([input]) => (input as Request).method === 'GET')).toBe(true);
    });

    it('uses localized provenance in the live Rules coverage consumer', async () => {
        const config = configuration();
        config.calculationContext.participants[0].name = null;
        config.participants[0].name = null;
        config.overrideTargets[0].label = 'Participant';
        config.overrideTargets[0].nameIsFallback = false;
        const {wrapper, context} = await mounted(async () => json(config));
        expect(wrapper.get('#requirement-participant-status .badge.text-uppercase').text()).toBe('general');
        expect(wrapper.get('#requirement-participant-status .participant-status-person strong').text()).toBe('Participant');
        await wrapper.get('[data-add-override]').trigger('click');
        context.locale.value = 'de';
        await flushPromises();
        expect(wrapper.get('#requirement-participant-status .badge.text-uppercase').text()).toBe('allgemein');
        expect(wrapper.get('#requirement-participant-status .participant-status-person strong').text()).toBe('Person');
        expect(wrapper.get('[data-override-target="participant"] option[value="profile:' + profileId + '"]').text()).toContain('Participant');
        expect(wrapper.get('[data-participant-row]').attributes('data-participant-key')).toBe('profile:' + profileId);
    });
    it('keeps zero duration, role and personal overrides in precedence order', () => {
        const config = configuration();
        config.stayRequirements[1].requiredShifts = 0;
        const draft = createRequirementDraft(config);
        expect(draft.stays[1].value).toBe('0');
        expect(analyzeRequirementDraft(config, draft).participants[0]).toMatchObject({requiredShifts: 0, source: 'general'});
        draft.stays[1].value = '4';
        draft.roles[0].value = '0';
        expect(analyzeRequirementDraft(config, draft).participants[0]).toMatchObject({requiredShifts: 0, source: 'role'});
        draft.overrides.push({key: 0, profileId, roleId: '', value: '0'});
        expect(analyzeRequirementDraft(config, draft).participants[0]).toMatchObject({requiredShifts: 0, source: 'override'});
        expect(requirementInput(draft).overrides).toEqual([{profileId, roleId: null, requiredShifts: 0}]);
    });

    it('keeps wire and draft identities as strings while sharing one numeric engine boundary', () => {
        const config = configuration();
        config.overrides = [{id: '8', profileId, roleId: '7', requiredShifts: 0, profileName: 'Alex'}];
        config.calculationContext.slots[0].roles = [{roleId: '7', maxQty: 1, assignedQty: 0}];
        const original = JSON.stringify(config);
        const draft = createRequirementDraft(config);
        draft.roles[0].value = '1';

        const wire = requirementInput(draft);
        expect(wire.roleRequirements[0].roleId).toBe('7');
        expect(wire.overrides[0]).toMatchObject({id: '8', roleId: '7'});
        const engine = requirementAnalysisInput(config, draft);
        expect(engine.roleRequirements[0].roleId).toBe(7);
        expect(engine.overrides[0]).toMatchObject({id: 8, roleId: 7});
        expect(engine.participants[0].roleIds).toEqual([7]);
        expect(engine.slots[0].roles[0].roleId).toBe(7);
        expect(analyzeRequirementDraft(config, draft).participants[0]).toMatchObject({source: 'override', requiredShifts: 0, roleIds: ['7']});
        expect(JSON.stringify(config)).toBe(original);
    });

    it('recalculates hypothetical open-role coverage from unsaved role settings', () => {
        const config = configuration();
        config.calculationContext.participants[0].roleIds = [];
        config.calculationContext.slots[0].roles = [{roleId: '7', maxQty: 1, assignedQty: 0}];
        const draft = createRequirementDraft(config);
        draft.stays[1].value = '4';
        draft.roles[0].value = '1';
        const result = analyzeRequirementDraft(config, draft);
        expect(result.participants[0]).toMatchObject({requiredShifts: 4, source: 'general'});
        expect(result.capacitySummary).toMatchObject({requiredSlots: 1, availableSlots: 2,
            hypotheticalRoleCoverage: {filledRoleCount: 1, removedRequiredShifts: 3}});
        draft.roles[0].value = '0';
        expect(analyzeRequirementDraft(config, draft).capacitySummary.requiredSlots).toBe(0);
    });

    it('uses the native browser date-label presentation for live coverage attendance', async () => {
        const saved = configuration();
        saved.calculationContext.participants[0].arrivalDate = '2030-06-01';
        saved.calculationContext.participants[0].departureDate = '2030-06-02';
        const {wrapper} = await mounted(async () => json(saved));
        const cells = wrapper.findAll('#requirement-participant-status .participant-status-cell');
        expect(cells[3].text()).toContain('6/1/2030 – 6/2/2030');
        expect(cells[3].text()).toContain('2 days');
    });

    it('updates unsaved coverage while retaining dirty controls across background reads and cancelled departures', async () => {
        let saved = configuration();
        const {wrapper, context, router, request} = await mounted(async () => json(saved));
        await wrapper.get('#stayRequirement-2').setValue('4');
        expect(wrapper.get('[data-coverage-title]').text()).toBe('Hard slot capacity exceeded by 2');
        expect(wrapper.get('[data-requirements-dirty]').text()).toBe('Unsaved changes');
        saved = configuration();
        saved.stayRequirements[1].requiredShifts = 9;
        await context.queryClient.invalidateQueries({queryKey: activityKeys.requirements(session.context, planId)});
        await flushPromises();
        expect((wrapper.get('#stayRequirement-2').element as HTMLInputElement).value).toBe('4');
        const confirm = vi.fn(() => false);
        vi.stubGlobal('confirm', confirm);
        const reads = request.mock.calls.length;
        await wrapper.get('[data-requirements-refresh]').trigger('click');
        await router.push('/frontend-pilot');
        expect(confirm).toHaveBeenCalledTimes(2);
        expect(router.currentRoute.value.path).toBe('/frontend-pilot/activity/' + planId);
        expect(request.mock.calls.length).toBe(reads);
        expect((wrapper.get('#stayRequirement-2').element as HTMLInputElement).value).toBe('4');
        confirm.mockReturnValue(true);
        await wrapper.get('[data-requirements-refresh]').trigger('click');
        await flushPromises();
        expect((wrapper.get('#stayRequirement-2').element as HTMLInputElement).value).toBe('9');
        expect(wrapper.get('[data-requirements-dirty]').text()).toBe('Saved');
    });

    it.each([
        {selector: '#requiredShifts', value: '-1', field: 'baseline', reason: 'minimum'},
        {selector: '#stayRequirement-2', value: '1.5', field: 'stay', reason: 'integer'},
        {selector: '#roleRequirement-7', value: '1.5', field: 'role', reason: 'integer'},
    ] as const)('explains invalid $field requirements without writing or replacing the draft', async invalid => {
        const {wrapper, context, request} = await mounted(async () => json(configuration()));
        const control = wrapper.get<HTMLInputElement>(invalid.selector);
        await control.setValue(invalid.value);
        await wrapper.get('[data-requirements-save]').trigger('click');
        await flushPromises();

        for (const locale of ['en', 'de'] as const) {
            context.locale.value = locale;
            await flushPromises();
            const field = invalid.field === 'baseline' ? context.messages.value.t('activity.requirements.baseline')
                : invalid.field === 'role' ? context.messages.value.t('activity.requirements.roles')
                    : context.messages.value.t('validation.rowField', {
                        row: context.messages.value.t('activity.requirements.stays'), number: 2,
                        field: context.messages.value.t('activity.requirements.requiredShifts'),
                    });
            const reason = invalid.reason === 'minimum' ? context.messages.value.t('validation.minimum', {limit: 0})
                : context.messages.value.t('validation.integer');
            expect(wrapper.get('.pilot-notification.alert-danger').text())
                .toContain(context.messages.value.t('validation.fieldError', {field, reason}));
            expect(wrapper.get(invalid.selector).element).toBe(control.element);
            expect(control.element.value).toBe(invalid.value);
            expect(wrapper.get('[data-requirements-dirty]').text())
                .toBe(context.messages.value.t('activity.requirements.unsaved'));
        }
        expect(request.mock.calls.every(([input]) => (input as Request).method === 'GET')).toBe(true);
    });

    it('calculates only a draft and saves zero personal overrides through the generated operation', async () => {
        let saved = configuration();
        const writes: components['schemas']['ActivityRequirementsInput'][] = [];
        const {wrapper} = await mounted(async request => {
            if (request.method === 'GET') return json(saved);
            const input = await request.json() as components['schemas']['ActivityRequirementsInput'];
            writes.push(input);
            saved = {...saved, plan: {...saved.plan, ...input}, roleRequirements: input.roleRequirements,
                stayRequirements: input.stayRequirements, overrides: input.overrides.map(row => ({...row, profileName: null}))};
            return json({changed: true});
        });
        await wrapper.get('[data-requirements-baseline-calc]').trigger('click');
        expect(writes).toEqual([]);
        expect((wrapper.get('#requiredShifts').element as HTMLInputElement).value).toBe('2');
        await wrapper.get('[data-add-override]').trigger('click');
        await wrapper.get('[data-override-target="participant"]').setValue('profile:' + profileId);
        expect(wrapper.get('#requirement-participant-status [data-participant-row]').text()).toContain('0 required');
        await wrapper.get('[data-requirements-save]').trigger('click');
        await flushPromises();
        expect(writes).toHaveLength(1);
        expect(writes[0]).toMatchObject({assignmentMode: 'REQUIRED', overrides: [{profileId, roleId: null, requiredShifts: 0}],
            allowArrivalDayEvening: true, allowDepartureDayMorning: true});
        expect(wrapper.emitted('changed')).toHaveLength(1);
        expect(wrapper.get('[data-requirements-dirty]').text()).toBe('Saved');
    });

    it('dismisses and renews calculation feedback without releasing its unsaved requirement values', async () => {
        const {wrapper, request} = await mounted(async () => json(configuration()));
        vi.useFakeTimers();
        vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{} as DOMRect] as unknown as DOMRectList);
        try {
            await wrapper.get('[data-requirements-baseline-calc]').trigger('click');
            const calculated = (wrapper.get('#requiredShifts').element as HTMLInputElement).value;
            expect(wrapper.find('.pilot-notification').exists()).toBe(true);
            await wrapper.get('.pilot-notification .btn-close').trigger('click');
            expect(wrapper.find('.pilot-notification').exists()).toBe(false);
            expect((wrapper.get('#requiredShifts').element as HTMLInputElement).value).toBe(calculated);
            expect(wrapper.get('[data-requirements-dirty]').text()).toBe('Unsaved changes');

            // Recalculating an already visible result renews that feedback's
            // deadline, even when the engine returns identical values/text.
            await wrapper.get('[data-requirements-baseline-calc]').trigger('click');
            await vi.advanceTimersByTimeAsync(9000);
            await wrapper.get('[data-requirements-baseline-calc]').trigger('click');
            await vi.advanceTimersByTimeAsync(1000);
            expect(wrapper.find('.pilot-notification').exists()).toBe(true);
            await vi.advanceTimersByTimeAsync(9000);
            await flushPromises();
            expect(wrapper.find('.pilot-notification').exists()).toBe(false);
            expect((wrapper.get('#requiredShifts').element as HTMLInputElement).value).toBe(calculated);
            expect(wrapper.get('[data-requirements-dirty]').text()).toBe('Unsaved changes');
            expect(request.mock.calls.every(([input]) => (input as Request).method === 'GET')).toBe(true);
        } finally { vi.useRealTimers(); }
    });

    it('preserves an outside-event override without silently selecting a registered profile', async () => {
        const saved = configuration();
        saved.overrides = [{id: '8', profileId: outsideId, profileName: 'Former participant', roleId: null, requiredShifts: 0}];
        const writes: unknown[] = [];
        const {wrapper} = await mounted(async request => {
            if (request.method === 'GET') return json(saved);
            writes.push(await request.json());
            return json({changed: true});
        });
        expect((wrapper.get('[data-override-target="participant"]').element as HTMLSelectElement).value).toBe('profile:' + outsideId);
        expect(wrapper.get('[data-retained]').text()).toBe('Former participant');
        expect(wrapper.get('[data-override-target="required"]').attributes('disabled')).toBeDefined();
        expect(wrapper.get('.override-row button').attributes('disabled')).toBeUndefined();
        await wrapper.get('#allowExternalAssignees').setValue(true);
        await wrapper.get('[data-requirements-save]').trigger('click');
        await flushPromises();
        expect(writes).toEqual([expect.objectContaining({overrides: [{id: '8', profileId: outsideId, roleId: null, requiredShifts: 0}]})]);
    });

    it.each([true, false])('saves deliberate outside-event override removal while retaining other settings (current targets: %s)', async hasTargets => {
        let saved = configuration();
        if (!hasTargets) saved.overrideTargets = [];
        saved.overrides = [{id: '8', profileId: outsideId, profileName: 'Former participant', roleId: null, requiredShifts: 0}];
        const writes: components['schemas']['ActivityRequirementsInput'][] = [];
        const {wrapper} = await mounted(async request => {
            if (request.method === 'GET') return json(saved);
            const input = await request.json() as components['schemas']['ActivityRequirementsInput'];
            writes.push(input);
            saved = {...saved, overrides: []};
            return json({changed: true});
        });
        expect(wrapper.get('[data-retained]').text()).toBe('Former participant');
        expect(wrapper.get('[data-override-target="required"]').attributes('disabled')).toBeDefined();
        await wrapper.get('.override-row button').trigger('click');
        expect(wrapper.find('.override-row').exists()).toBe(false);
        expect(wrapper.get('[data-requirements-dirty]').text()).toBe('Unsaved changes');
        expect(writes).toEqual([]);
        await wrapper.get('[data-requirements-save]').trigger('click');
        await flushPromises();
        expect(writes).toEqual([expect.objectContaining({overrides: [], removedOverrideIds: ['8'], assignmentMode: 'REQUIRED',
            stayRequirements: [{stayDays: 1, requiredShifts: 1}, {stayDays: 2, requiredShifts: 2}]})]);
        expect(wrapper.get('[data-requirements-dirty]').text()).toBe('Saved');
        expect(wrapper.find('.override-row').exists()).toBe(false);
    });

    it('keeps an unconfirmed explicit removal in the draft until save succeeds or reload is accepted', async () => {
        const saved = configuration();
        saved.overrides = [{id: '8', profileId: outsideId, profileName: 'Former participant', roleId: null, requiredShifts: 0}];
        const writes: components['schemas']['ActivityRequirementsInput'][] = [];
        const {wrapper} = await mounted(async request => {
            if (request.method === 'GET') return json(saved);
            writes.push(await request.json() as components['schemas']['ActivityRequirementsInput']);
            return new Response(JSON.stringify({type: 'about:blank', title: 'Invalid settings', status: 400,
                detail: 'Reload these requirements before saving.', requestId: 'override-removal-rejected'}),
            {status: 400, headers: {'Content-Type': 'application/problem+json', 'X-Surveyor-Context': session.context}});
        });
        await wrapper.get('.override-row button').trigger('click');
        await wrapper.get('[data-requirements-save]').trigger('click');
        await flushPromises();
        expect(writes).toEqual([expect.objectContaining({overrides: [], removedOverrideIds: ['8']})]);
        expect(wrapper.find('.override-row').exists()).toBe(false);
        expect(wrapper.get('[data-requirements-dirty]').text()).toBe('Unsaved changes');
        vi.stubGlobal('confirm', vi.fn(() => true));
        await wrapper.get('[data-requirements-refresh]').trigger('click');
        await flushPromises();
        expect(wrapper.get('[data-retained]').text()).toBe('Former participant');
        expect(wrapper.get('[data-requirements-dirty]').text()).toBe('Saved');
    });

    it('does not resend confirmed removal IDs after a failed follow-up read', async () => {
        const saved = configuration();
        saved.overrides = [{id: '8', profileId: outsideId, profileName: 'Former participant', roleId: null, requiredShifts: 0}];
        const writes: components['schemas']['ActivityRequirementsInput'][] = [];
        const {wrapper} = await mounted(async request => {
            if (request.method === 'GET') {
                if (writes.length) throw new TypeError('Network unavailable');
                return json(saved);
            }
            writes.push(await request.json() as components['schemas']['ActivityRequirementsInput']);
            return json({changed: true});
        });
        await wrapper.get('.override-row button').trigger('click');
        await wrapper.get('[data-requirements-save]').trigger('click');
        await flushPromises();
        expect(writes).toEqual([expect.objectContaining({removedOverrideIds: ['8']})]);
        expect(wrapper.get('[data-requirements-dirty]').text()).toBe('Saved');
        // Ordinary read retries must settle before controls admit another edit.
        await vi.waitFor(() => expect(wrapper.get<HTMLInputElement>('#allowExternalAssignees').element.disabled).toBe(false), {timeout: 5000});
        await wrapper.get('#allowExternalAssignees').setValue(true);
        await wrapper.get('[data-requirements-save]').trigger('click');
        await flushPromises();
        expect(writes).toHaveLength(2);
        expect(writes[1]).toMatchObject({overrides: [], allowExternalAssignees: true});
        expect(writes[1]).not.toHaveProperty('removedOverrideIds');
    });

    it('retains a confirmed saved form when its following requirements read fails', async () => {
        let reads = 0;
        let writes = 0;
        const {wrapper} = await mounted(async request => {
            if (request.method !== 'GET') { writes += 1; return json({changed: true}); }
            reads += 1;
            if (reads > 1) throw new TypeError('Network unavailable');
            return json(configuration());
        });
        await wrapper.get('#stayRequirement-2').setValue('3');
        await wrapper.get('[data-requirements-save]').trigger('click');
        await flushPromises();
        expect(writes).toBe(1);
        expect(wrapper.get('[data-requirements-dirty]').text()).toBe('Saved');
        expect((wrapper.get('#stayRequirement-2').element as HTMLInputElement).value).toBe('3');
        expect(wrapper.get('[data-requirements-save]').attributes('disabled')).toBeDefined();
        expect(wrapper.text()).toContain('saved');
    });

    it('retires private settings and entered values after a validated read denial', async () => {
        let denied = false;
        const {wrapper, context} = await mounted(async () => {
            if (!denied) return json(configuration());
            return new Response(JSON.stringify({type: 'about:blank', title: 'Forbidden', status: 403, detail: 'Not allowed',
                requestId: 'fixture', code: 'FORBIDDEN', messageKey: 'api:errors.FORBIDDEN', params: {}}),
            {status: 403, headers: {'Content-Type': 'application/problem+json', 'X-Surveyor-Context': session.context}});
        });
        await wrapper.get('#stayRequirement-2').setValue('7');
        denied = true;
        await context.queryClient.invalidateQueries({queryKey: activityKeys.requirements(session.context, planId)});
        await flushPromises();
        expect(wrapper.find('#requirementForm').exists()).toBe(false);
        expect(wrapper.find('#requirement-participant-status').exists()).toBe(false);
        expect(wrapper.emitted('denied')).toHaveLength(1);
        expect(context.queryClient.getQueryData(activityKeys.requirements(session.context, planId))).toBeUndefined();
        denied = false;
        await wrapper.get('[data-requirements-refresh]').trigger('click');
        await flushPromises();
        expect(wrapper.find('#requirementForm').exists()).toBe(true);
        expect((wrapper.get('#stayRequirement-2').element as HTMLInputElement).value).toBe('2');
        expect(wrapper.get('[data-requirements-dirty]').text()).toBe('Saved');
    });

    it('releases the requirement draft and coverage when its admitted actor retires', async () => {
        const {wrapper, context, request} = await mounted(async () => json(configuration()));
        await wrapper.get('#stayRequirement-2').setValue('7');
        expect(wrapper.get('[data-requirements-dirty]').text()).toBe('Unsaved changes');
        const reads = request.mock.calls.length;

        // The shared identity owner closes readiness and advances this epoch
        // before admitting another actor. This editor must release both saved
        // calculation context and unsaved values, even while still mounted.
        context.ready.value = false;
        context.epoch.value++;
        await flushPromises();

        expect(wrapper.find('#requirementForm').exists()).toBe(false);
        expect(wrapper.find('#requirement-participant-status').exists()).toBe(false);
        expect(wrapper.find('[data-coverage-state]').exists()).toBe(false);
        expect(request.mock.calls.length).toBe(reads);
        expect(request.mock.calls.every(([input]) => (input as Request).method === 'GET')).toBe(true);
    });
});
