// @vitest-environment happy-dom
import {apiCompatibility} from '../../.generated/api/v1/policy.mjs';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {flushPromises, mount} from '@vue/test-utils';
import {defineComponent} from 'vue';
import {createMemoryHistory, createRouter} from 'vue-router';
import {VueQueryPlugin} from '@tanstack/vue-query';
import I18NextVue from 'i18next-vue';
import type {components} from '../../src/types/api/v1';
import {createPilotContext, observeInitialDocument, pilotContextKey} from '../../src/frontend/app/context';
import {activityKeys} from '../../src/frontend/app/queryKeys';
import ActivityRequirements from '../../src/frontend/features/activity/ActivityRequirements.vue';
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
async function mounted(handler: (request: Request) => Promise<Response>) {
    const request = vi.fn((input: RequestInfo | URL) => handler(input as Request));
    const context = createPilotContext({session}, true, request);
    context.hydrated.value = true;
    const router = createRouter({history: createMemoryHistory(), routes: [
        {path: '/frontend-pilot/activity/:planId', component: ActivityRequirements, props: true},
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
        expect(wrapper.get('.override-row button').attributes('disabled')).toBeDefined();
        await wrapper.get('#allowExternalAssignees').setValue(true);
        await wrapper.get('[data-requirements-save]').trigger('click');
        await flushPromises();
        expect(writes).toEqual([expect.objectContaining({overrides: [{id: '8', profileId: outsideId, roleId: null, requiredShifts: 0}]})]);
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
});
