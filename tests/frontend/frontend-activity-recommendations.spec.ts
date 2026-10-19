// @vitest-environment happy-dom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {flushPromises, mount} from '@vue/test-utils';
import {defineComponent, shallowRef} from 'vue';
import {createMemoryHistory, createRouter} from 'vue-router';
import {VueQueryPlugin} from '@tanstack/vue-query';
import I18NextVue from 'i18next-vue';
import type {components} from '../../src/types/api/v1';
import {createPilotContext, observeInitialDocument, pilotContextKey} from '../../src/frontend/app/context';
import {activityKeys} from '../../src/frontend/app/queryKeys';
import ActivityRecommendations from '../../src/frontend/features/activity/ActivityRecommendations.vue';
import {manualRecommendationRows, recommendationPartners, recommendationReview,
    rolelessRecommendationAssignments} from '../../src/frontend/features/activity/recommendationDraft';

const planId = '11111111-1111-4111-8111-111111111111';
const profileId = '22222222-2222-4222-8222-222222222222';
const slotId = '33333333-3333-4333-8333-333333333333';
const otherId = '44444444-4444-4444-8444-444444444444';
const recommendationId = '55555555-5555-4555-8555-555555555555';
const jobId = '66666666-6666-4666-8666-666666666666';
const nextId = '77777777-7777-4777-8777-777777777777';
const session: components['schemas']['SessionView'] & {context: string; csrfToken: string} = {
    kind: 'account', context: 'activity-review-context-1234567890', csrfToken: 'activity-review-csrf-1234567890', locale: 'en',
    deployment: {buildId: 'fixture', apiCompatibility: 'v1-pilot-2026-10-07'}, activeProfile: {id: profileId, name: 'Alex'},
    profiles: [{id: profileId, name: 'Alex'}], loginUrl: '/users/login', logoutUrl: '/users/logout',
    shell: {version: 'test', imprintUrl: '/imprint', privacyPolicyUrl: '/privacy', localLoginEnabled: true, oidcEnabled: false, oidcName: 'SSO'},
};
function workspace(): components['schemas']['ActivityRecommendations'] {
    const slot = {id: slotId, title: 'Breakfast', day: '2030-06-01', startTime: '09:00:00', endTime: '10:00:00'};
    return {recommendations: [{id: recommendationId, item: slot, profile: {id: profileId, name: 'Alex'}, sourceItem: null,
        operation: 'ASSIGN', status: 'PENDING', manual: false}], slots: [slot, {...slot, id: otherId, title: 'Lunch', startTime: '12:00:00', endTime: '13:00:00'}],
        participantOptions: [{key: 'profile:' + profileId, profileId, label: 'Alex', arrivalDate: null, departureDate: null}],
        existingAssignments: [], warnings: [], autoGenerationJob: null};
}
function view(): components['schemas']['ActivityView'] {
    return {entityType: 'activity', id: planId, title: 'Camp duties', description: '', startDate: '2030-06-01', endDate: '2030-06-01',
        headerUrl: null, headerVersion: null, currentEventId: nextId, currentEventUrl: '/event/' + nextId, archived: false, inheritedArchived: false,
        assignmentMode: 'REQUIRED', canSelfAssign: true, allowOverfillAfterFull: false, bindingDeadline: null, requirementProgress: null,
        weeks: [{start: '2030-05-27', days: ['2030-06-01']}], slots: workspace().slots.map(slot => ({...slot,
            position: 0, description: '', maxAssignees: 2, assignedCount: 0, selfAssigned: false, selfRoles: [], roles: [], assignees: [], editToken: '"fixture"',
            capabilities: {editTitle: true, editDescription: true, editMeta: true, editCapacity: true, editRoles: true, manageAssignments: true, remove: true, inlineMetadataAdmission: true}})),
        allRoles: [], textFields: [], participants: [], counters: {participants: 1, open: 2, empty: 2}, orderToken: '"order"',
        capabilities: {editTitle: true, editDescription: true, editDates: true, addSlot: true, reorderSlots: true, manageSettings: true,
            manageRequirements: true, manageRecommendations: true, exportSchedule: true, duplicate: true, remove: true, roleCreationAdmission: true, rulesWorkspace: true}};
}
function domainJob(status: components['schemas']['ActivityRecommendationJob']['status']): components['schemas']['ActivityRecommendationJob'] {
    return {id: jobId, planId, status, createdAt: '2030-06-01T00:00:00.000Z', updatedAt: '2030-06-01T00:00:01.000Z'};
}
function json(value: unknown, status = 200): Response {
    return new Response(JSON.stringify(value), {status, headers: {'Content-Type': 'application/json', 'X-Surveyor-Context': session.context}});
}
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
});

/** Mount actual review, Query, command and generated transport owners. Only HTTP
 * delivery is substituted; persistence and built presentation have separate tests. */
async function mounted(handler: (request: Request) => Promise<Response>) {
    const requests: Request[] = [];
    const context = createPilotContext({session}, true, (input: RequestInfo | URL) => {
        requests.push(input as Request);
        return handler(input as Request);
    });
    context.hydrated.value = true;
    const currentView = shallowRef(view());
    const router = createRouter({history: createMemoryHistory(), routes: [
        {path: '/frontend-pilot/activity/:planId', component: ActivityRecommendations, props: () => ({planId, view: currentView.value})},
        {path: '/frontend-pilot', component: defineComponent({template: '<p>Overview</p>'})},
    ]});
    await router.push('/frontend-pilot/activity/' + planId);
    const stopInitial = observeInitialDocument(context, router);
    const root = mount(defineComponent({template: '<RouterView />'}), {attachTo: document.body, global: {
        plugins: [router, [VueQueryPlugin, {queryClient: context.queryClient}], [I18NextVue, {i18next: context.i18next}]],
        provide: {[pilotContextKey as symbol]: context},
    }});
    cleanups.push(async () => {root.unmount(); stopInitial(); await context.queryClient.cancelQueries(); context.queryClient.clear();});
    await vi.waitFor(() => expect(root.find('[data-rec-id]').exists()).toBe(true));
    await flushPromises();
    return {root, context, requests, router, currentView};
}
function path(request: Request): string { return new URL(request.url).pathname; }
function button(root: ReturnType<typeof mount>, title: string) {
    return root.findAll('button').find(button => button.attributes('title') === title)!;
}

describe('Activity recommendation review production frontend', () => {
    it('runs maintenance once on entry and uses pure reads without replacing dirty review', async () => {
        const saved = workspace();
        const {root, context, requests} = await mounted(async request => path(request).endsWith('/warnings') ? json({warnings: []}) : json(saved));
        await button(root, 'Approve').trigger('click');
        await flushPromises();
        saved.recommendations[0].status = 'REJECTED';
        await context.queryClient.invalidateQueries({queryKey: activityKeys.recommendations(session.context, planId)});
        await flushPromises();
        expect(root.get('[data-rec-id] .badge').text()).toBe('Approved');
        expect(root.text()).toContain('your unsaved changes are retained');
        expect(requests.filter(request => path(request).endsWith('/entry'))).toHaveLength(1);
        expect(requests.some(request => request.method === 'GET' && path(request).endsWith('/recommendations'))).toBe(true);
    });

    it('never repeats uncertain generation and reconciles only by deliberate pure read', async () => {
        const {root, requests} = await mounted(async request => {
            if (path(request).endsWith('/auto')) throw new TypeError('Connection lost');
            return json(workspace());
        });
        await root.get('[data-recommendations-auto]').trigger('click');
        await flushPromises();
        expect(root.text()).toContain('may have completed');
        expect(root.get('[data-recommendations-auto]').attributes('disabled')).toBeDefined();
        vi.stubGlobal('confirm', vi.fn(() => true));
        const review = root.findAll('button').find(button => button.text() === 'Review changes')!;
        await review.trigger('click');
        await flushPromises();
        expect(requests.filter(request => path(request).endsWith('/auto'))).toHaveLength(1);
        expect(requests.filter(request => path(request).endsWith('/entry'))).toHaveLength(1);
        expect(requests.filter(request => request.method === 'GET' && path(request).endsWith('/recommendations')).length).toBeGreaterThan(0);
    });

    it('retains the draft through same-plan Event relinking and refreshes only a pure snapshot', async () => {
        const {root, requests, currentView} = await mounted(async request => path(request).endsWith('/warnings') ? json({warnings: []}) : json(workspace()));
        await button(root, 'Approve').trigger('click');
        await flushPromises();
        currentView.value = {...view(), currentEventId: otherId};
        await flushPromises();
        expect(root.get('[data-rec-id] .badge').text()).toBe('Approved');
        expect(requests.filter(request => path(request).endsWith('/entry'))).toHaveLength(1);
        expect(requests.filter(request => request.method === 'GET' && path(request).endsWith('/recommendations')).length).toBeGreaterThan(0);
    });

    it('retires private advanced rows when explicit entry maintenance loses its grant', async () => {
        let denied = false;
        const {root, context} = await mounted(async request => {
            if (denied && path(request).endsWith('/entry')) return new Response(JSON.stringify({type: 'about:blank', title: 'Forbidden', status: 403,
                detail: 'Access denied.', requestId: 'advanced-grant-revoked', code: 'FORBIDDEN', messageKey: 'api:errors.FORBIDDEN', params: {}}),
            {status: 403, headers: {'Content-Type': 'application/problem+json', 'X-Surveyor-Context': session.context}});
            return json(workspace());
        });
        denied = true;
        await root.get('[data-recommendations-refresh]').trigger('click');
        await flushPromises();
        expect(root.find('[data-rec-id]').exists()).toBe(false);
        expect(root.text()).not.toContain('Alex');
        expect(context.queryClient.getQueryData(activityKeys.recommendations(session.context, planId))).toBeUndefined();
    });

    it.each([false, true])('observes an automatic deadline job through pure completion while preserving dirty=%s', async dirty => {
        const saved = workspace();
        saved.autoGenerationJob = domainJob('QUEUED');
        let complete = false;
        const {root, context, requests} = await mounted(async request => {
            if (path(request).endsWith('/entry')) return json(saved);
            if (path(request).includes('/auto/')) return json({job: domainJob(complete ? 'COMPLETE' : 'RUNNING')});
            if (path(request).endsWith('/warnings')) return json({warnings: []});
            const current = workspace();
            if (complete) current.recommendations[0].id = nextId;
            return json(current);
        });
        if (dirty) {
            await button(root, 'Approve').trigger('click');
            await flushPromises();
        }
        complete = true;
        await context.queryClient.refetchQueries({queryKey: activityKeys.recommendationJob(session.context, planId, jobId), exact: true});
        await flushPromises();
        await vi.waitFor(() => expect(requests.some(request => request.method === 'GET' && path(request).endsWith('/recommendations'))).toBe(true));
        expect(root.get('[data-rec-id]').attributes('data-rec-id')).toBe(dirty ? recommendationId : nextId);
        if (dirty) expect(root.get('[data-rec-id] .badge').text()).toBe('Approved');
        expect(requests.filter(request => path(request).endsWith('/entry'))).toHaveLength(1);
        expect(requests.some(request => request.method === 'POST' && path(request).endsWith('/auto'))).toBe(false);
        expect(requests.filter(request => path(request).includes('/auto/')).every(request => path(request).endsWith('/auto/' + jobId))).toBe(true);
        const count = requests.length;
        root.unmount();
        await new Promise(resolve => setTimeout(resolve, 600));
        expect(requests).toHaveLength(count);
    });

    it.each([['FAILED', 'Recommendation generation failed'], ['STALE', 'The plan changed; generate recommendations again']] as const)(
        'shows an automatic %s terminal result without another dispatch or maintenance', async (status, message) => {
            const saved = workspace();
            saved.autoGenerationJob = domainJob('QUEUED');
            const {root, requests} = await mounted(async request => path(request).includes('/auto/')
                ? json({job: domainJob(status)}) : json(saved));
            await vi.waitFor(() => expect(root.text()).toContain(message));
            expect(root.find('[data-rec-id]').exists()).toBe(true);
            expect(requests.filter(request => path(request).endsWith('/entry'))).toHaveLength(1);
            expect(requests.some(request => request.method === 'POST' && path(request).endsWith('/auto'))).toBe(false);
        });

    it('adopts explicitly generated rows after accepted discard', async () => {
        const saved = workspace();
        let complete = false;
        const {root, context, requests} = await mounted(async request => {
            if (path(request).endsWith('/auto')) return json({job: domainJob('QUEUED'), coalesced: false}, 202);
            if (path(request).includes('/auto/')) return json({job: domainJob(complete ? 'COMPLETE' : 'RUNNING')});
            if (path(request).endsWith('/warnings')) return json({warnings: []});
            return json(saved);
        });
        await button(root, 'Approve').trigger('click');
        await flushPromises();
        vi.stubGlobal('confirm', vi.fn(() => true));
        await root.get('[data-recommendations-auto]').trigger('click');
        await flushPromises();
        saved.recommendations[0].id = nextId;
        complete = true;
        await context.queryClient.refetchQueries({queryKey: activityKeys.recommendationJob(session.context, planId, jobId), exact: true});
        await flushPromises();
        await vi.waitFor(() => expect(root.get('[data-rec-id]').attributes('data-rec-id')).toBe(nextId));
        expect(requests.filter(request => path(request).endsWith('/entry'))).toHaveLength(2);
    });

    it('keeps edits made after dispatch when a completed job returns newer proposals', async () => {
        const saved = workspace();
        let complete = false;
        const {root, context} = await mounted(async request => {
            if (path(request).endsWith('/auto')) return json({job: domainJob('QUEUED'), coalesced: false}, 202);
            if (path(request).includes('/auto/')) return json({job: domainJob(complete ? 'COMPLETE' : 'RUNNING')});
            if (path(request).endsWith('/warnings')) return json({warnings: []});
            return json(saved);
        });
        await root.get('[data-recommendations-auto]').trigger('click');
        await flushPromises();
        await button(root, 'Approve').trigger('click');
        await flushPromises();
        saved.recommendations[0].id = nextId;
        complete = true;
        await context.queryClient.refetchQueries({queryKey: activityKeys.recommendationJob(session.context, planId, jobId), exact: true});
        await flushPromises();
        expect(root.get('[data-rec-id]').attributes('data-rec-id')).toBe(recommendationId);
        expect(root.get('[data-rec-id] .badge').text()).toBe('Approved');
        expect(root.text()).toContain('your unsaved changes are retained');
    });

    it('keeps the review after an unavailable job and permits a deliberate new dispatch', async () => {
        const {root, requests} = await mounted(async request => {
            if (path(request).includes('/auto/')) return new Response(JSON.stringify({type: 'about:blank', title: 'Not found', status: 404,
                detail: 'Job is unavailable.', requestId: 'missing-domain-job', code: 'NOT_FOUND', messageKey: 'api:errors.NOT_FOUND', params: {}}),
            {status: 404, headers: {'Content-Type': 'application/problem+json', 'X-Surveyor-Context': session.context}});
            if (path(request).endsWith('/auto')) return json({job: domainJob('QUEUED'), coalesced: false}, 202);
            return json(workspace());
        });
        await root.get('[data-recommendations-auto]').trigger('click');
        await flushPromises();
        await vi.waitFor(() => expect(root.text()).toContain('job status is unavailable'));
        expect(root.find('[data-rec-id]').exists()).toBe(true);
        expect(root.get('[data-recommendations-auto]').attributes('disabled')).toBeUndefined();
        expect(requests.filter(request => request.method === 'POST' && path(request).endsWith('/auto'))).toHaveLength(1);
        await root.get('[data-recommendations-auto]').trigger('click');
        await flushPromises();
        expect(requests.filter(request => request.method === 'POST' && path(request).endsWith('/auto'))).toHaveLength(2);
    });

    it.each([['FAILED', 'Recommendation generation failed'], ['STALE', 'The plan changed; generate recommendations again']] as const)(
        'shows the %s terminal job without replaying generation', async (status, message) => {
            const {root, requests} = await mounted(async request => {
                if (path(request).endsWith('/auto')) return json({job: domainJob('QUEUED'), coalesced: false}, 202);
                if (path(request).includes('/auto/')) return json({job: domainJob(status)});
                return json(workspace());
            });
            await root.get('[data-recommendations-auto]').trigger('click');
            await flushPromises();
            await vi.waitFor(() => expect(root.text()).toContain(message));
            expect(root.get('[data-recommendations-auto]').attributes('disabled')).toBeUndefined();
            expect(requests.filter(request => request.method === 'POST' && path(request).endsWith('/auto'))).toHaveLength(1);
            expect(requests.filter(request => path(request).endsWith('/entry'))).toHaveLength(1);
        });

    it('keeps native incomplete manual staging feedback and closes the discarded modal directly', async () => {
        const {root, requests} = await mounted(async () => json(workspace()));
        const confirm = vi.fn(() => false);
        vi.stubGlobal('confirm', confirm);
        await root.get(`[data-add-recommendation][data-slot-id="${otherId}"]`).trigger('click');
        await flushPromises();
        const stage = document.querySelector<HTMLButtonElement>('#addRecommendationConfirm')!;
        expect(stage.disabled).toBe(false);
        stage.click();
        await flushPromises();
        expect(document.querySelector('[data-add-warning]')?.textContent).toContain('Select every assignment required for this operation.');
        document.querySelector<HTMLButtonElement>('#addRecommendationModal .modal-header .btn-close')!.click();
        await flushPromises();
        expect(document.querySelector('#addRecommendationModal')).toBeNull();
        expect(confirm).not.toHaveBeenCalled();
        expect(requests.filter(request => path(request).endsWith('/apply'))).toHaveLength(0);
    });

    it('retires a removed manual source without staging a hidden stale selection', async () => {
        const saved = workspace();
        saved.existingAssignments = [{item: saved.slots[0], profile: {id: profileId, name: 'Alex'}, roles: ['default']}];
        const {root, context, requests} = await mounted(async request => path(request).endsWith('/warnings') ? json({warnings: []}) : json(saved));
        await root.get(`[data-add-recommendation][data-slot-id="${otherId}"]`).trigger('click');
        await flushPromises();
        async function select(id: string, value: string): Promise<void> {
            const input = document.querySelector<HTMLSelectElement>('#' + id)!;
            input.value = value;
            input.dispatchEvent(new Event('change', {bubbles: true}));
            await flushPromises();
        }
        await select('addRecommendationOperation', 'REASSIGN');
        await select('addRecommendationParticipant', 'profile:' + profileId);
        await select('addRecommendationSource', slotId);
        expect(document.querySelector<HTMLSelectElement>('#addRecommendationSource')!.value).toBe(slotId);
        saved.existingAssignments = [];
        await context.queryClient.invalidateQueries({queryKey: activityKeys.recommendations(session.context, planId)});
        await flushPromises();
        expect(document.querySelector<HTMLSelectElement>('#addRecommendationOperation')!.value).toBe('REASSIGN');
        expect(document.querySelector<HTMLSelectElement>('#addRecommendationParticipant')!.value).toBe('');
        expect(document.querySelector<HTMLSelectElement>('#addRecommendationSource')!.value).toBe('');
        document.querySelector<HTMLButtonElement>('#addRecommendationConfirm')!.click();
        await flushPromises();
        expect(document.querySelector('[data-add-warning]')?.textContent).toContain('Select every assignment required for this operation.');
        expect(root.findAll('[data-rec-id]')).toHaveLength(1);
        expect(requests.filter(request => path(request).endsWith('/apply'))).toHaveLength(0);
    });

    it('freezes preview and application as the same reviewed batch and keeps cancellation local', async () => {
        const previews: components['schemas']['ActivityRecommendationReview'][] = [];
        const applications: components['schemas']['ActivityRecommendationApplication'][] = [];
        const {root} = await mounted(async request => {
            if (path(request).endsWith('/warnings')) {
                const body = await request.json() as components['schemas']['ActivityRecommendationReview'];
                previews.push(body);
                return json({warnings: [{recommendation: body.recommendations[0], warnings: [{type: 'overlap', conflicts: [otherId], confirmable: true}]}], overlapConfirmation: 'reviewed-overlap'});
            }
            if (path(request).endsWith('/apply')) {
                applications.push(await request.json());
                return json({applied: 1, skipped: 0, warnings: []});
            }
            return json(workspace());
        });
        await button(root, 'Approve').trigger('click');
        await flushPromises();
        await root.get('[data-recommendations-apply]').trigger('click');
        await flushPromises();
        document.querySelector<HTMLButtonElement>('#assignmentWarningCancel')!.click();
        await flushPromises();
        expect(applications).toHaveLength(0);
        expect(root.get('[data-recommendation-warnings]').text()).toContain('overlap');
        expect(root.get('[data-rec-id] .badge').text()).toBe('Approved');
        await root.get('[data-recommendations-apply]').trigger('click');
        await flushPromises();
        document.querySelector<HTMLButtonElement>('#assignmentWarningConfirm')!.click();
        await flushPromises();
        expect(applications).toEqual([{...previews.at(-1), overlapConfirmation: 'reviewed-overlap'}]);
        expect(root.text()).toContain('Applied 1; skipped 0');
    });

    it('constructs reciprocal roleless swaps and preserves manual/generated rejection provenance', () => {
        const saved = workspace();
        saved.recommendations = [];
        saved.participantOptions.push({key: 'profile:' + otherId, profileId: otherId, label: 'Blair', arrivalDate: null, departureDate: null});
        saved.existingAssignments = [{item: saved.slots[0], profile: {id: profileId, name: 'Alex'}, roles: ['default']},
            {item: saved.slots[1], profile: {id: otherId, name: 'Blair'}, roles: ['default']}];
        const values = manualRecommendationRows(saved, [], {targetSlotId: saved.slots[1].id, operation: 'SWAP', profileId,
            sourceItemId: saved.slots[0].id, swapProfileId: otherId});
        const rows = values.map((value, index) => ({key: String(index), value}));
        expect(values).toHaveLength(2);
        expect(recommendationPartners(rows, rows[0])).toHaveLength(2);
        for (const row of recommendationPartners(rows, rows[0])) row.value.status = 'REJECTED';
        expect(recommendationReview(rows).recommendations).toHaveLength(0);
        rows[0].value.manual = false;
        expect(recommendationReview(rows).recommendations).toMatchObject([{operation: 'REASSIGN', status: 'REJECTED', manual: false}]);
        saved.existingAssignments[0].roles = ['Kitchen lead'];
        expect(rolelessRecommendationAssignments(saved, profileId)).toHaveLength(0);
        expect(() => manualRecommendationRows(saved, [], {targetSlotId: saved.slots[1].id, operation: 'REASSIGN', profileId,
            sourceItemId: saved.slots[0].id, swapProfileId: ''})).toThrow();
    });
});
