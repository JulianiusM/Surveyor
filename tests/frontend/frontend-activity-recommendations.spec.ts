// @vitest-environment happy-dom
import {apiCompatibility} from '../../.generated/api/v1/policy.mjs';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {mount} from '@vue/test-utils';
import {flushFrontendPromises as flushPromises} from '../keywords/frontendUiKeywords';
import {defineComponent, shallowRef} from 'vue';
import {createMemoryHistory, createRouter} from 'vue-router';
import {VueQueryPlugin} from '@tanstack/vue-query';
import I18NextVue from 'i18next-vue';
import type {components} from '../../src/types/api/v1';
import type {ActivityRecommendationDraftRow} from '../../src/types/FrontendActivityRecommendationTypes';
import {createFrontendContext, observeInitialDocument, frontendContextKey} from '../../src/frontend/app/context';
import {activityKeys} from '../../src/frontend/app/queryKeys';
import ActivityRecommendations from '../../src/frontend/features/activity/ActivityRecommendations.vue';
import {manualRecommendationRows, pairRecommendationRows, reconcileRecommendationRows, recommendationIdentity,
    recommendationPartners, recommendationRelationship, recommendationReview, revalidateRecommendationGroups,
    rolelessRecommendationAssignments} from '../../src/frontend/features/activity/recommendationDraft';
import {buildRecommendationWarnings} from '../../src/backend/modules/activity/availability';
import {createActivitySlotEntity} from '../factories/integrationEntityFactory';

const planId = '11111111-1111-4111-8111-111111111111';
const profileId = '22222222-2222-4222-8222-222222222222';
const slotId = '33333333-3333-4333-8333-333333333333';
const otherId = '44444444-4444-4444-8444-444444444444';
const recommendationId = '55555555-5555-4555-8555-555555555555';
const jobId = '66666666-6666-4666-8666-666666666666';
const nextId = '77777777-7777-4777-8777-777777777777';
const session: components['schemas']['SessionView'] & {context: string; csrfToken: string} = {
    kind: 'account', context: 'activity-review-context-1234567890', csrfToken: 'activity-review-csrf-1234567890', locale: 'en',
    deployment: {buildId: 'fixture', apiCompatibility}, activeProfile: {id: profileId, name: 'Alex'},
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

/** Four saved moves share endpoints but belong to two independently authored
 * swaps. Their wire representation deliberately contains no pairing metadata. */
function reciprocalWorkspace(): components['schemas']['ActivityRecommendations'] {
    const saved = workspace();
    const people = [{id: profileId, name: 'Alex'}, {id: otherId, name: 'Blair'},
        {id: nextId, name: 'Casey'}, {id: jobId, name: 'Dana'}];
    const ids = [recommendationId, jobId, nextId, '88888888-8888-4888-8888-888888888888'];
    saved.recommendations = [];
    saved.existingAssignments = [];
    saved.participantOptions = [];
    for (const [index, person] of people.entries()) {
        const source = saved.slots[index % 2]!;
        const target = saved.slots[1 - index % 2]!;
        saved.recommendations.push({id: ids[index]!, profile: person, item: target, sourceItem: source,
            status: 'PENDING', operation: 'REASSIGN', manual: true});
        saved.existingAssignments.push({profile: person, item: source, roles: ['default']});
        saved.participantOptions.push({key: 'profile:' + person.id, profileId: person.id, label: person.name,
            arrivalDate: null, departureDate: null});
    }
    return saved;
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
    vi.unstubAllEnvs();
    document.body.innerHTML = '';
});

/** Mount actual review, Query, command and generated transport owners. Only HTTP
 * delivery is substituted; persistence and built presentation have separate tests. */
async function mounted(handler: (request: Request) => Promise<Response>) {
    const requests: Request[] = [];
    const context = createFrontendContext({session}, true, (input: RequestInfo | URL) => {
        requests.push(input as Request);
        return handler(input as Request);
    });
    context.hydrated.value = true;
    const currentView = shallowRef(view());
    const router = createRouter({history: createMemoryHistory(), routes: [
        {path: '/activity/:planId', component: ActivityRecommendations, props: () => ({planId, view: currentView.value})},
        {path: '/', component: defineComponent({template: '<p>Overview</p>'})},
    ]});
    await router.push('/activity/' + planId);
    const stopInitial = observeInitialDocument(context, router);
    const root = mount(defineComponent({template: '<RouterView />'}), {attachTo: document.body, global: {
        plugins: [router, [VueQueryPlugin, {queryClient: context.queryClient}], [I18NextVue, {i18next: context.i18next}]],
        provide: {[frontendContextKey as symbol]: context},
    }});
    cleanups.push(async () => {root.unmount(); stopInitial(); await context.queryClient.cancelQueries(); context.queryClient.clear();});
    await flushPromises();
    await vi.waitFor(() => expect(root.find('[data-recommendations-schedule]').exists()).toBe(true));
    await flushPromises();
    return {root, context, requests, router, currentView};
}
function path(request: Request): string { return new URL(request.url).pathname; }
function button(root: ReturnType<typeof mount>, title: string) {
    return root.findAll('button').find(button => button.attributes('title') === title)!;
}

/** Teleported dialogs retain real native selects and their public change event. */
async function selectDialogValue(id: string, value: string): Promise<void> {
    const select = document.querySelector<HTMLSelectElement>('#' + id)!;
    select.value = value;
    select.dispatchEvent(new Event('change', {bubbles: true}));
    await flushPromises();
}

/** Inspect the review status rather than a move/swap operation badge. */
function reviewStatus(root: ReturnType<typeof mount>, id: string): string {
    return root.get(`[data-rec-id="${id}"]`).findAll('.badge').at(-1)!.text();
}

/** Stage through the actual editor so its SWAP/single distinction reaches the
 * production draft owner, including the real server preview boundary. */
async function stageMove(root: ReturnType<typeof mount>, profile: string, counterpart?: string,
                         sourceSlot = slotId, targetSlot = otherId): Promise<void> {
    await root.get(`[data-add-recommendation][data-slot-id="${targetSlot}"]`).trigger('click');
    await flushPromises();
    await selectDialogValue('addRecommendationOperation', counterpart ? 'SWAP' : 'REASSIGN');
    await selectDialogValue('addRecommendationParticipant', 'profile:' + profile);
    await selectDialogValue('addRecommendationSource', sourceSlot);
    if (counterpart) await selectDialogValue('addRecommendationSwapParticipant', counterpart);
    document.querySelector<HTMLButtonElement>('#addRecommendationConfirm')!.click();
    await flushPromises();
}

describe('Activity recommendation review production frontend', () => {
    it('attaches calculated warnings to stored uppercase UUID rows and the manual preview dialog', async () => {
        const saved = workspace();
        const storedProfile = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA';
        const storedSlot = 'BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB';
        const storedTarget = 'CCCCCCCC-CCCC-4CCC-8CCC-CCCCCCCCCCCC';
        const storedConflict = 'EEEEEEEE-EEEE-4EEE-8EEE-EEEEEEEEEEEE';
        saved.slots = saved.slots.map((slot, index) => ({...slot, id: index === 0 ? storedSlot : storedTarget}));
        saved.slots.push({...saved.slots[0], id: storedConflict, title: 'Shared briefing', startTime: '08:00', endTime: '14:00'});
        saved.recommendations[0] = {...saved.recommendations[0], item: saved.slots[0],
            profile: {id: storedProfile, name: 'Alex'}};
        saved.participantOptions = [{...saved.participantOptions[0], key: 'profile:' + storedProfile, profileId: storedProfile}];
        saved.existingAssignments = [
            {item: saved.slots[0], profile: {id: storedProfile, name: 'Alex'}, roles: ['default']},
            {item: saved.slots[2], profile: {id: storedProfile, name: 'Alex'}, roles: ['Coordinator']},
        ];
        const slots = saved.slots.map(slot => createActivitySlotEntity(slot));
        // DBAL references retain stored IDs but deliberately have no title. The
        // warning must keep that ID so the UI can resolve its visible slot label.
        const existingAssignments = {[`profile:${storedProfile.toLowerCase()}`]: [{
            id: storedConflict, day: '2030-06-01', startTime: '08:00', endTime: '14:00',
        }]};
        function calculatedWarnings(input: components['schemas']['ActivityRecommendationReview']) {
            return buildRecommendationWarnings({slots, recommendations: input.recommendations, existingAssignments})
                .map(result => ({...result, recommendation: {...result.recommendation,
                    profileId: result.recommendation.profileId ?? undefined}}));
        }
        saved.warnings = calculatedWarnings({recommendations: [{id: recommendationId, itemId: storedSlot,
            profileId: storedProfile, status: 'PENDING', operation: 'ASSIGN', manual: false}]});
        const {root, currentView, requests} = await mounted(async request => {
            if (path(request).endsWith('/warnings')) {
                return json({warnings: calculatedWarnings(await request.json())});
            }
            return json(saved);
        });
        currentView.value = {...currentView.value, slots: saved.slots.map((slot, index) =>
            ({...(currentView.value.slots[index] ?? currentView.value.slots[0]!), ...slot}))};
        await flushPromises();

        expect(root.get('[data-recommendation-warnings]').text()).toContain('overlap');
        expect(root.get('[data-recommendation-warnings]').text()).toContain('Shared briefing');
        await root.get(`[data-add-recommendation][data-slot-id="${storedSlot}"]`).trigger('click');
        await flushPromises();
        const duplicateOptions = document.querySelector<HTMLSelectElement>('#addRecommendationParticipant')!;
        expect(Array.from(duplicateOptions.options, option => option.value)).not.toContain('profile:' + storedProfile);
        document.querySelector<HTMLButtonElement>('#addRecommendationModal .modal-header .btn-close')!.click();
        await flushPromises();
        await root.get(`[data-add-recommendation][data-slot-id="${storedTarget}"]`).trigger('click');
        await flushPromises();
        await selectDialogValue('addRecommendationOperation', 'REASSIGN');
        await selectDialogValue('addRecommendationParticipant', 'profile:' + storedProfile);
        const sources = document.querySelector<HTMLSelectElement>('#addRecommendationSource')!;
        expect(Array.from(sources.options, option => option.value)).toContain(storedSlot);
        await selectDialogValue('addRecommendationSource', storedSlot);

        expect(document.querySelector('[data-add-warning]')?.textContent).toContain('overlap');
        expect(document.querySelector('[data-add-warning]')?.textContent).toContain('Shared briefing');
        expect(requests.some(request => path(request).endsWith('/apply'))).toBe(false);
    });

    it('shows stored civil days in both locales without replacing a pending recommendation', async () => {
        vi.stubEnv('TZ', 'America/Los_Angeles');
        const {root, context, requests} = await mounted(async request => path(request).endsWith('/warnings') ? json({warnings: []}) : json(workspace()));
        const header = root.get('[data-recommendations-schedule] th[data-date="2030-06-01"]');
        expect(header.get('.day').text()).toBe('Sat');
        expect(header.get('.date').text()).toBe('6/1/2030');
        await button(root, 'Approve').trigger('click');
        await flushPromises();
        const recommendation = root.get('[data-rec-id]');
        context.locale.value = 'de';
        await flushPromises();
        expect(root.get('[data-recommendations-schedule] th[data-date="2030-06-01"]').element).toBe(header.element);
        expect(header.get('.day').text()).toBe('Sa');
        expect(header.get('.date').text()).toBe('1.6.2030');
        expect(root.get('[data-rec-id]').element).toBe(recommendation.element);
        expect(recommendation.get('.badge').text()).toBe('Genehmigt');
        expect(requests.some(request => path(request).endsWith('/apply'))).toBe(false);
    });

    it('retains fallback provenance through manual staging and later translation without changing literal names', async () => {
        const saved = workspace();
        saved.participantOptions = [
            {...saved.participantOptions[0], label: 'Profile #' + profileId, nameIsFallback: true},
            {key: 'profile:' + otherId, profileId: otherId, label: 'Participant', nameIsFallback: false,
                arrivalDate: null, departureDate: null},
        ];
        const {root, context, requests} = await mounted(async request => path(request).endsWith('/warnings') ? json({warnings: []}) : json(saved));
        await root.get(`[data-add-recommendation][data-slot-id="${otherId}"]`).trigger('click');
        await flushPromises();
        const select = document.querySelector<HTMLSelectElement>('#addRecommendationParticipant')!;
        expect(Array.from(select.options, option => option.text)).toContain('Profile #' + profileId);
        select.value = 'profile:' + profileId;
        select.dispatchEvent(new Event('change', {bubbles: true}));
        await flushPromises();
        context.locale.value = 'de';
        await flushPromises();
        expect(document.querySelector('#addRecommendationParticipant')).toBe(select);
        expect(select.value).toBe('profile:' + profileId);
        expect(Array.from(select.options, option => option.text)).toEqual(expect.arrayContaining(['Profil #' + profileId, 'Participant']));
        document.querySelector<HTMLButtonElement>('#addRecommendationConfirm')!.click();
        await flushPromises();
        const staged = root.get('[data-rec-id=""]');
        expect(staged.text()).toContain('Profil #' + profileId);
        context.locale.value = 'en';
        await flushPromises();
        expect(root.get('[data-rec-id=""]').element).toBe(staged.element);
        expect(staged.text()).toContain('Profile #' + profileId);
        expect(staged.findAll('button').some(control => control.attributes('aria-label')?.includes('Profile #' + profileId))).toBe(true);
        expect(requests.some(request => path(request).endsWith('/apply'))).toBe(false);

        const values = manualRecommendationRows(saved, [], {targetSlotId: otherId, operation: 'ASSIGN', profileId,
            sourceItemId: '', swapProfileId: ''});
        expect(values[0].profile.nameIsFallback).toBe(true);
        const payload = recommendationReview(values.map((value, index) => ({key: String(index), value})));
        expect(JSON.stringify(payload)).not.toMatch(/nameIsFallback|Profile #|Participant/u);
        expect(payload.recommendations[0].profileId).toBe(profileId);
    });

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
        expect(root.text()).toContain(context.messages.value.t('activity.recommendations.jobComplete'));
        expect(root.text()).not.toMatch(/\bSaved\b/u);
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
        expect(root.text()).not.toMatch(/\bSaved\b/u);
    });

    it('retains applied success and shows failed suggestion refresh without replaying application', async () => {
        const {root, requests} = await mounted(async request => {
            if (path(request).endsWith('/warnings')) return json({warnings: []});
            if (path(request).endsWith('/apply')) return json({applied: 1, skipped: 0, warnings: [], generationOutcome: 'failed'});
            return json(workspace());
        });
        await button(root, 'Approve').trigger('click');
        await flushPromises();
        await root.get('[data-recommendations-apply]').trigger('click');
        await flushPromises();
        expect(root.text()).toContain('Applied 1; skipped 0');
        expect(root.text()).toContain('Assignments were applied, but suggestions could not be refreshed.');
        const action = root.get('[data-recommendations-auto]').text();
        expect(root.text()).toContain(`Use ${action} to try refreshing suggestions again.`);
        expect(requests.filter(request => path(request).endsWith('/apply'))).toHaveLength(1);
        expect(requests.some(request => path(request).endsWith('/auto'))).toBe(false);
    });

    it('keeps two staged swaps independent across status, removal and serialization', async () => {
        const saved = reciprocalWorkspace();
        saved.recommendations = [];
        const previews: components['schemas']['ActivityRecommendationReview'][] = [];
        const {root} = await mounted(async request => {
            if (path(request).endsWith('/warnings')) {
                previews.push(await request.json());
                return json({warnings: []});
            }
            return json(saved);
        });
        await stageMove(root, profileId, otherId);
        await stageMove(root, nextId, jobId);
        expect(root.findAll('[data-rec-id]')).toHaveLength(4);
        const third = root.get(`[data-rec-id][data-profile-id="${nextId}"]`);
        await third.get('button[title="Revert to Pending"]').trigger('click');
        await flushPromises();
        for (const person of [profileId, otherId]) expect(root.get(`[data-rec-id][data-profile-id="${person}"]`).text()).toContain('Approved');
        for (const person of [nextId, jobId]) expect(root.get(`[data-rec-id][data-profile-id="${person}"]`).text()).toContain('Pending');
        expect(document.querySelector('#recommendationPairDialog')).toBeNull();
        await third.get('button[title="Remove manual operation"]').trigger('click');
        await flushPromises();
        expect(root.findAll('[data-rec-id]').map(row => row.attributes('data-profile-id')).sort()).toEqual([profileId, otherId].sort());
        expect(JSON.stringify(previews)).not.toMatch(/swapGroup|rowIdentity|rowVersion|"key"/u);
        expect(previews.at(-1)?.recommendations.map(row => row.profileId).sort()).toEqual([profileId, otherId].sort());
    });

    it('requires an explicit counterpart before saved ambiguous status/removal and keeps cancellation unchanged', async () => {
        const saved = reciprocalWorkspace();
        const previews: components['schemas']['ActivityRecommendationReview'][] = [];
        const {root, context, requests} = await mounted(async request => {
            if (path(request).endsWith('/warnings')) {
                previews.push(await request.json());
                return json({warnings: []});
            }
            return json(saved);
        });
        const third = root.get(`[data-rec-id="${nextId}"]`);
        const original = root.findAll('[data-rec-id]').map(row => row.text());
        await third.get('button[title="Approve"]').trigger('click');
        await flushPromises();
        expect(document.querySelector('#recommendationPairDialog')?.textContent).toContain('Choose swap counterpart');
        expect(root.findAll('[data-rec-id]').map(row => row.text())).toEqual(original);
        expect(previews).toHaveLength(0);
        document.querySelector<HTMLButtonElement>('#recommendationPairCancel')!.click();
        await flushPromises();
        expect(root.findAll('[data-rec-id]').map(row => row.text())).toEqual(original);

        // Renaming/relocalizing a fresh saved read retains the pending chooser,
        // its selected machine identity and the row's real DOM identity.
        await third.get('button[title="Approve"]').trigger('click');
        await flushPromises();
        const select = document.querySelector<HTMLSelectElement>('#recommendationPairCounterpart')!;
        const selected = Array.from(select.options).find(option => option.textContent?.startsWith('Dana'))!.value;
        await selectDialogValue('recommendationPairCounterpart', selected);
        saved.recommendations[3]!.profile.name = 'Dana renamed';
        await context.queryClient.invalidateQueries({queryKey: activityKeys.recommendations(session.context, planId)});
        await flushPromises();
        context.locale.value = 'de';
        await flushPromises();
        expect(document.querySelector('#recommendationPairCounterpart')).toBe(select);
        expect(select.value).toBe(selected);
        expect(select.textContent).toContain('Dana renamed');
        expect(root.get(`[data-rec-id="${nextId}"]`).element).toBe(third.element);
        document.querySelector<HTMLButtonElement>('#recommendationPairConfirm')!.click();
        await flushPromises();
        expect(reviewStatus(root, recommendationId)).toBe('Ausstehend');
        expect(reviewStatus(root, jobId)).toBe('Ausstehend');
        expect(reviewStatus(root, nextId)).toBe('Genehmigt');
        expect(reviewStatus(root, '88888888-8888-4888-8888-888888888888')).toBe('Genehmigt');

        // Dirty reconciliation preserves the known pair through another fresh
        // server receipt; removal now acts once on exactly that chosen pair.
        await context.queryClient.invalidateQueries({queryKey: activityKeys.recommendations(session.context, planId)});
        await flushPromises();
        await root.get(`[data-rec-id="${nextId}"] button[title="Manuellen Vorgang entfernen"]`).trigger('click');
        await flushPromises();
        expect(root.findAll('[data-rec-id]').map(row => row.attributes('data-rec-id')).sort()).toEqual([recommendationId, jobId].sort());
        expect(document.querySelector('#recommendationPairDialog')).toBeNull();
        expect(JSON.stringify(previews)).not.toMatch(/swapGroup|rowIdentity|rowVersion|"key"/u);
        expect(requests.some(request => path(request).endsWith('/apply'))).toBe(false);
    });

    it('keeps separately staged opposite moves independent through their real review controls', async () => {
        const saved = reciprocalWorkspace();
        saved.recommendations = [];
        const {root} = await mounted(async request => path(request).endsWith('/warnings') ? json({warnings: []}) : json(saved));
        await stageMove(root, profileId);
        await stageMove(root, otherId, undefined, otherId, slotId);
        const first = root.get(`[data-rec-id][data-profile-id="${profileId}"]`);
        const second = root.get(`[data-rec-id][data-profile-id="${otherId}"]`);
        expect(first.text()).toContain('REASSIGNMENT');
        expect(second.text()).toContain('REASSIGNMENT');
        await first.get('button[title="Revert to Pending"]').trigger('click');
        await flushPromises();
        expect(first.text()).toContain('Pending');
        expect(second.text()).toContain('Approved');
        expect(document.querySelector('#recommendationPairDialog')).toBeNull();
        await first.get('button[title="Remove manual operation"]').trigger('click');
        await flushPromises();
        expect(root.findAll('[data-rec-id]').map(row => row.attributes('data-profile-id'))).toEqual([otherId]);
    });

    it('rejects a stale chosen saved leg without changing any review status', async () => {
        const saved = reciprocalWorkspace();
        const {root, context, requests} = await mounted(async request => path(request).endsWith('/warnings') ? json({warnings: []}) : json(saved));
        await root.get(`[data-rec-id="${nextId}"] button[title="Approve"]`).trigger('click');
        await flushPromises();
        const select = document.querySelector<HTMLSelectElement>('#recommendationPairCounterpart')!;
        const selected = Array.from(select.options).find(option => option.textContent?.startsWith('Dana'))!.value;
        await selectDialogValue('recommendationPairCounterpart', selected);
        saved.recommendations[3]!.status = 'REJECTED';
        await context.queryClient.invalidateQueries({queryKey: activityKeys.recommendations(session.context, planId)});
        await flushPromises();
        expect(select.value).toBe('');
        expect(document.querySelector<HTMLButtonElement>('#recommendationPairConfirm')!.disabled).toBe(true);
        expect(reviewStatus(root, nextId)).toBe('Pending');
        expect(reviewStatus(root, '88888888-8888-4888-8888-888888888888')).toBe('Rejected');
        document.querySelector<HTMLButtonElement>('#recommendationPairConfirm')!.click();
        await flushPromises();
        expect(reviewStatus(root, nextId)).toBe('Pending');
        expect(requests.some(request => path(request).endsWith('/warnings') || path(request).endsWith('/apply'))).toBe(false);
    });

    it('retires an unresolved chooser when its admitted permission retires', async () => {
        const saved = reciprocalWorkspace();
        let denied = false;
        const {root, context, requests} = await mounted(async request => {
            if (denied && request.method === 'GET') return new Response(JSON.stringify({type: 'about:blank', title: 'Forbidden', status: 403,
                detail: 'Access denied.', requestId: 'pair-grant-revoked', code: 'FORBIDDEN', messageKey: 'api:errors.FORBIDDEN', params: {}}),
            {status: 403, headers: {'Content-Type': 'application/problem+json', 'X-Surveyor-Context': session.context}});
            return json(saved);
        });
        await root.get(`[data-rec-id="${nextId}"] button[title="Approve"]`).trigger('click');
        await flushPromises();
        denied = true;
        await context.queryClient.invalidateQueries({queryKey: activityKeys.recommendations(session.context, planId)});
        await flushPromises();
        expect(document.querySelector('#recommendationPairDialog')).toBeNull();
        expect(root.find('[data-rec-id]').exists()).toBe(false);
        expect(requests.some(request => path(request).endsWith('/warnings') || path(request).endsWith('/apply'))).toBe(false);
        expect(context.queryClient.getQueryData(activityKeys.recommendations(session.context, planId))).toBeUndefined();
    });

    it.each(['status', 'operation', 'removed'] as const)('retires pending intent when its saved row is %s', async change => {
        const saved = reciprocalWorkspace();
        const {root, context, requests} = await mounted(async () => json(saved));
        await root.get(`[data-rec-id="${nextId}"] button[title="Approve"]`).trigger('click');
        await flushPromises();
        if (change === 'status') saved.recommendations[2]!.status = 'REJECTED';
        else if (change === 'operation') {
            saved.recommendations[2]!.operation = 'ASSIGN';
            saved.recommendations[2]!.sourceItem = null;
        } else saved.recommendations.splice(2, 1);
        await context.queryClient.invalidateQueries({queryKey: activityKeys.recommendations(session.context, planId)});
        await flushPromises();
        expect(document.querySelector('#recommendationPairDialog')).toBeNull();
        expect(reviewStatus(root, recommendationId)).toBe('Pending');
        expect(reviewStatus(root, jobId)).toBe('Pending');
        expect(reviewStatus(root, '88888888-8888-4888-8888-888888888888')).toBe('Pending');
        expect(requests.some(request => path(request).endsWith('/warnings') || path(request).endsWith('/apply'))).toBe(false);
    });

    it('releases a pending counterpart choice through the real actor bootstrap boundary', async () => {
        const saved = reciprocalWorkspace();
        const otherSession = {...session, context: 'another-activity-actor-context', csrfToken: 'another-activity-actor-csrf'};
        let switched = false;
        const {root, context, requests} = await mounted(async request => {
            if (path(request).endsWith('/session')) switched = true;
            // Post-switch reads belong to the new actor too. An old response
            // header would correctly trigger another identity-recovery cycle.
            return new Response(JSON.stringify(path(request).endsWith('/session') ? otherSession : saved), {status: 200,
                headers: {'Content-Type': 'application/json', 'X-Surveyor-Context': switched ? otherSession.context : session.context}});
        });
        await root.get(`[data-rec-id="${nextId}"] button[title="Approve"]`).trigger('click');
        await flushPromises();
        expect(document.querySelector('#recommendationPairDialog')).not.toBeNull();
        await context.refreshSession(true);
        await flushPromises();
        expect(context.session.value?.context).toBe(otherSession.context);
        expect(document.querySelector('#recommendationPairDialog')).toBeNull();
        expect(requests.some(request => path(request).endsWith('/warnings') || path(request).endsWith('/apply'))).toBe(false);
    });

    it('preserves explicit single moves and known pairs through fresh operation identities', () => {
        const saved = reciprocalWorkspace();
        const previous: ActivityRecommendationDraftRow[] = saved.recommendations.map((value, index) => ({key: String(index), value}));
        pairRecommendationRows(previous[0]!, previous[1]!);
        pairRecommendationRows(previous[2]!, previous[3]!);
        let key = 10;
        function nextKey(): string { return String(++key); }
        const renamed = saved.recommendations.map(value => ({...value, profile: {...value.profile, name: 'Renamed'}}));
        const refreshed = reconcileRecommendationRows(renamed, previous, nextKey);
        expect(recommendationPartners(refreshed, refreshed[2]!).map(row => row.value.profile.id)).toEqual([nextId, jobId]);
        expect(refreshed.map(row => row.key)).toEqual(previous.map(row => row.key));
        expect(recommendationIdentity(renamed[0]!)).toBe(recommendationIdentity(previous[0]!.value));

        // A real save first gives local legs server IDs. Operation identity
        // retains the known pair despite that one-way identity transition.
        const staged: ActivityRecommendationDraftRow[] = previous.map(row => ({key: row.key,
            value: {...row.value, id: undefined}, swapGroup: row.swapGroup}));
        const persisted = reconcileRecommendationRows(renamed, staged, nextKey);
        expect(recommendationPartners(persisted, persisted[2]!).map(row => row.value.profile.id)).toEqual([nextId, jobId]);

        // A missing known leg cannot turn the survivor into another swap merely
        // because a new reverse move would be the only available candidate.
        const replacement = {...renamed[1]!, id: '99999999-9999-4999-8999-999999999999', profile: {id: slotId, name: 'Replacement'}};
        const replaced = reconcileRecommendationRows([renamed[0]!, replacement], refreshed, nextKey);
        expect(replaced[0]!.swapGroup).toBeNull();
        expect(recommendationPartners(replaced, replaced[0]!)).toEqual([replaced[0]]);
        revalidateRecommendationGroups(refreshed, [renamed[0]!, replacement, renamed[2]!, renamed[3]!]);
        expect(refreshed[0]!.swapGroup).toBeNull();
        expect(refreshed[1]!.swapGroup).toBeNull();
        expect(recommendationPartners(refreshed, refreshed[2]!)).toHaveLength(2);

        const singles: ActivityRecommendationDraftRow[] = saved.recommendations.slice(0, 2).map((value, index) => ({key: String(index), value, swapGroup: null}));
        expect(recommendationRelationship(singles, singles[0]!).kind).toBe('single');
        expect(recommendationPartners(singles, singles[1]!)).toEqual([singles[1]]);
        const restored = singles.map(row => ({key: row.key, value: row.value}));
        expect(recommendationRelationship(restored, restored[0]!).kind).toBe('paired');
        const ambiguous = previous.map(row => ({key: row.key, value: row.value}));
        expect(recommendationRelationship(ambiguous, ambiguous[0]!).kind).toBe('ambiguous');
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
