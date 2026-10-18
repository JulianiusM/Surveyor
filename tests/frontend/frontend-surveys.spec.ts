// @vitest-environment happy-dom
import {afterEach, describe, expect, it, vi} from 'vitest';
import {flushPromises, mount} from '@vue/test-utils';
import {defineComponent, type Component} from 'vue';
import {createMemoryHistory, createRouter} from 'vue-router';
import {VueQueryPlugin} from '@tanstack/vue-query';
import I18NextVue from 'i18next-vue';
import type {components} from '../../src/types/api/v1';
import {createPilotContext, observeInitialDocument, pilotContextKey} from '../../src/frontend/app/context';
import {surveyKeys} from '../../src/frontend/app/queryKeys';
import SurveyPage from '../../src/frontend/features/surveys/SurveyPage.vue';
import SurveyCreatePage from '../../src/frontend/features/surveys/SurveyCreatePage.vue';

const surveyId = '11111111-1111-4111-8111-111111111111';
const profileId = '22222222-2222-4222-8222-222222222222';
const copyId = '33333333-3333-4333-8333-333333333333';
const session: components['schemas']['SessionView'] & {context: string; csrfToken: string} = {
    kind: 'account', context: 'surveys-ui-context-1234567890', csrfToken: 'surveys-ui-csrf-1234567890', locale: 'en',
    deployment: {buildId: 'fixture', apiCompatibility: 'v1-pilot-2026-10-07'},
    activeProfile: {id: profileId, name: 'Survey participant'}, profiles: [{id: profileId, name: 'Survey participant'}],
    loginUrl: '/users/login', logoutUrl: '/users/logout', shell: {version: 'test', imprintUrl: '/imprint',
        privacyPolicyUrl: '/privacy', localLoginEnabled: true, oidcEnabled: false, oidcName: 'SSO'},
};
const survey: components['schemas']['SurveyView'] = {
    entityType: 'survey', id: surveyId, title: 'Monthly gathering', description: null,
    headerUrl: null, headerVersion: null, archived: false, profileName: session.activeProfile!.name,
    combinations: [{id: '11', weekday: 'MON', nthWeek: '1'}, {id: '12', weekday: 'FRI', nthWeek: 'LAST'}],
    ownAnswers: {}, responses: [], capabilities: {manageSettings: false, addCombination: true, submitBallot: true},
};
const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
});

function json(value: unknown, status = 200): Response {
    return new Response(JSON.stringify(value), {status, headers: {'Content-Type': 'application/json',
        'X-Surveyor-Context': session.context, ETag: '"survey-fixture"'}});
}

/** Mount production components, query owners and generated transport. Only
 * HTTP delivery is replaced; the real database/API boundary has its own suite. */
async function mounted(component: Component, handler: (request: Request) => Promise<Response>,
    path = `/frontend-pilot/survey/${surveyId}`) {
    const request = vi.fn((input: RequestInfo | URL) => handler(input as Request));
    const context = createPilotContext({session}, true, request);
    context.hydrated.value = true;
    const router = createRouter({history: createMemoryHistory(), routes: [
        {path: '/frontend-pilot/survey/create', component},
        {path: '/frontend-pilot/survey/:surveyId/duplicate', component},
        {path: '/frontend-pilot/survey/:surveyId', component: path.endsWith('/duplicate') || path.endsWith('/create')
            ? defineComponent({template: '<p>Created survey</p>'}) : component},
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
    if (component === SurveyPage) {
        await vi.waitFor(() => expect(context.queryClient.getQueryState(surveyKeys.detail(session.context, surveyId)))
            .toMatchObject({status: 'success'}));
        await flushPromises();
    }
    return {root, wrapper: root.findComponent(component), request, context, router};
}

describe('Survey production frontend consumers', () => {
    it('submits every displayed default No and keeps named results separate from the current ballot', async () => {
        let body: unknown;
        const {wrapper} = await mounted(SurveyPage, async request => {
            if (request.method === 'GET') return json({...survey, responses: [
                {profileId: copyId, name: 'Another participant', answers: {'11': 'maybe'}},
            ]});
            body = await request.json();
            return json({changed: true});
        });
        expect(wrapper.get<HTMLInputElement>('#no-11').element.checked).toBe(true);
        expect(wrapper.get<HTMLInputElement>('#no-12').element.checked).toBe(true);
        expect(wrapper.text()).toContain('Another participant');
        expect(wrapper.findAll('table')[1]!.findAll('tbody td').map(cell => cell.text())).toEqual([
            'Another participant', 'maybe', 'no',
        ]);
        await wrapper.get('#survey-ballot').trigger('submit');
        await flushPromises();
        expect(body).toEqual({answers: {'11': 'no', '12': 'no'}});
    });

    it('preserves a dirty ballot while admitting a newly added combination and named remote result', async () => {
        let current = structuredClone(survey);
        const {wrapper, context} = await mounted(SurveyPage, async () => json(current));
        expect(wrapper.text()).toContain('No answers yet…');
        await wrapper.get('#yes-11').setValue(true);
        current = {...survey, combinations: [...survey.combinations, {id: '13', weekday: 'SUN', nthWeek: '4'}],
            responses: [{profileId: copyId, name: 'Guest answer', answers: {'12': 'yes'}}]};
        await context.queryClient.invalidateQueries({queryKey: surveyKeys.detail(session.context, surveyId)});
        await flushPromises();
        expect(wrapper.get<HTMLInputElement>('#yes-11').element.checked).toBe(true);
        expect(wrapper.get<HTMLInputElement>('#no-13').element.checked).toBe(true);
        expect(wrapper.text()).toContain('4. Sunday of the month');
        expect(wrapper.text()).toContain('Guest answer');
    });

    it('does not replay an uncertain ballot and retains its selected answers through recovery reads', async () => {
        const {wrapper, request, context} = await mounted(SurveyPage, async request => {
            if (request.method === 'GET') return json(survey);
            throw new TypeError('Ballot reply lost after dispatch');
        });
        await wrapper.get('#maybe-12').setValue(true);
        await wrapper.get('#survey-ballot').trigger('submit');
        await flushPromises();
        expect(wrapper.text()).toContain('The result is uncertain.');
        await context.queryClient.invalidateQueries({queryKey: surveyKeys.detail(session.context, surveyId)});
        await flushPromises();
        await wrapper.get('#survey-ballot').trigger('submit');
        await flushPromises();
        expect(request.mock.calls.filter(([value]) => (value as Request).method === 'PUT')).toHaveLength(1);
        expect(wrapper.get<HTMLInputElement>('#maybe-12').element.checked).toBe(true);
    });

    it('submits the collaborative recurrence and retains it when its outcome is uncertain', async () => {
        const bodies: unknown[] = [];
        const {wrapper, request, context} = await mounted(SurveyPage, async request => {
            if (request.method === 'GET') return json(survey);
            bodies.push(await request.json());
            throw new TypeError('Combination reply lost');
        });
        expect(wrapper.find('button[aria-label="Entity settings"]').exists()).toBe(false);
        await wrapper.get('#survey-add-weekday').setValue('THU');
        await wrapper.get('#survey-add-nth').setValue('LAST');
        await wrapper.get('#survey-add-combination').trigger('submit');
        await flushPromises();
        expect(bodies).toEqual([{weekday: 'THU', nthWeek: 'LAST'}]);
        await context.queryClient.invalidateQueries({queryKey: surveyKeys.detail(session.context, surveyId)});
        await flushPromises();
        await wrapper.get('#survey-add-combination').trigger('submit');
        await flushPromises();
        expect(request.mock.calls.filter(([value]) => (value as Request).method === 'POST')).toHaveLength(1);
        expect(wrapper.get<HTMLSelectElement>('#survey-add-weekday').element.value).toBe('THU');
        expect(wrapper.get<HTMLSelectElement>('#survey-add-nth').element.value).toBe('LAST');
    });

    it('releases a confirmed ballot draft when the owning follow-up read fails', async () => {
        let saved = false;
        const {wrapper, router, request} = await mounted(SurveyPage, async request => {
            if (request.method === 'PUT') { saved = true; return json({changed: true}); }
            return saved ? failedRefresh() : json(survey);
        });
        await wrapper.get('#yes-11').setValue(true);
        await wrapper.get('#survey-ballot').trigger('submit');
        await flushPromises();
        expect(wrapper.get<HTMLInputElement>('#yes-11').element.checked).toBe(true);
        expect(wrapper.text()).toContain('Your change was saved, but the refreshed data could not be loaded.');
        const confirmation = vi.fn(() => false);
        vi.stubGlobal('confirm', confirmation);
        await router.push('/frontend-pilot');
        await flushPromises();
        expect(router.currentRoute.value.path).toBe('/frontend-pilot');
        expect(confirmation).not.toHaveBeenCalled();
        expect(request.mock.calls.filter(([value]) => (value as Request).method === 'PUT')).toHaveLength(1);
    });

    it('clears a confirmed new combination when its owning follow-up read fails', async () => {
        let saved = false;
        const {wrapper, request} = await mounted(SurveyPage, async request => {
            if (request.method === 'POST') { saved = true; return json({changed: true}); }
            return saved ? failedRefresh() : json(survey);
        });
        await wrapper.get('#survey-add-weekday').setValue('TUE');
        await wrapper.get('#survey-add-nth').setValue('LAST');
        await wrapper.get('#survey-add-combination').trigger('submit');
        await flushPromises();
        expect(wrapper.get<HTMLSelectElement>('#survey-add-weekday').element.value).toBe('MON');
        expect(wrapper.get<HTMLSelectElement>('#survey-add-nth').element.value).toBe('1');
        expect(wrapper.text()).toContain('Your change was saved, but the refreshed data could not be loaded.');
        expect(request.mock.calls.filter(([value]) => (value as Request).method === 'POST')).toHaveLength(1);
    });

    it('creates monthly choices through multipart without event, general permissions or administrators', async () => {
        let submitted: unknown;
        const {wrapper, router} = await mounted(SurveyCreatePage, async request => {
            if (request.method === 'GET') return json({entry: {kind: 'render'}, context: {}});
            submitted = JSON.parse(String((await request.formData()).get('data')));
            return json({id: copyId}, 201);
        }, '/frontend-pilot/survey/create');
        expect(wrapper.findAll('#combinationTable tr')).toHaveLength(1);
        expect(wrapper.text()).not.toMatch(/Group Permissions|Administrators|Linked event/u);
        await wrapper.get('#title').setValue('Recurring survey');
        await wrapper.get('#description').setValue('Choose one day');
        await wrapper.get('#addCombinationBtn').trigger('click');
        const second = wrapper.findAll('#combinationTable tr')[1]!;
        await second.findAll('select')[0]!.setValue('FRI');
        await second.findAll('select')[1]!.setValue('LAST');
        await wrapper.get('#surveyForm').trigger('submit');
        await flushPromises();
        expect(submitted).toEqual({title: 'Recurring survey', description: 'Choose one day', combinations: [
            {weekday: 'MON', nthWeek: '1'}, {weekday: 'FRI', nthWeek: 'LAST'},
        ]});
        expect(router.currentRoute.value.path).toBe(`/frontend-pilot/survey/${copyId}`);
    });

    it('keeps an uncertain creation and its selected File without automatic multipart replay', async () => {
        const {wrapper, request, context} = await mounted(SurveyCreatePage, async request => {
            if (request.method === 'GET') return json({entry: {kind: 'render'}, context: {}});
            throw new TypeError('Survey creation reply lost');
        }, '/frontend-pilot/survey/create');
        await wrapper.get('#title').setValue('Unconfirmed survey');
        const chooser = wrapper.get<HTMLInputElement>('#headerImg').element;
        const transfer = new DataTransfer();
        const file = new File(['header'], 'chosen.png', {type: 'image/png'});
        transfer.items.add(file);
        chooser.files = transfer.files;
        chooser.dispatchEvent(new Event('change', {bubbles: true}));
        await wrapper.get('#surveyForm').trigger('submit');
        await flushPromises();
        expect(wrapper.text()).toContain('Creation could not be confirmed.');
        await context.queryClient.invalidateQueries({queryKey: surveyKeys.creation(session.context)});
        await flushPromises();
        await wrapper.get('#surveyForm').trigger('submit');
        await flushPromises();
        expect(request.mock.calls.filter(([value]) => (value as Request).method === 'POST')).toHaveLength(1);
        expect(wrapper.get<HTMLInputElement>('#title').element.value).toBe('Unconfirmed survey');
        expect(chooser.files?.[0]).toBe(file);
    });
});

/** A known read rejection keeps saved state readable and has no retry timer. */
function failedRefresh(): Response {
    return json({type: 'about:blank', title: 'Refresh rejected', status: 400, detail: 'Refresh unavailable.',
        requestId: 'survey-follow-up', code: 'VALIDATION_FAILED', messageKey: 'api:errors.VALIDATION_FAILED', params: {}}, 400);
}
