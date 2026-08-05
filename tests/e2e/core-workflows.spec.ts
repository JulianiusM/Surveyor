import {expect, request as playwrightRequest, test, type APIRequestContext} from '@playwright/test';
import {
    createE2EActivityPlan,
    createE2EDriversList,
    createE2EEvent,
    createE2ELogin,
    createE2EPackingList,
    createE2ESurvey,
} from '../factories/e2eCoreFactory';
import {createResourceViaForm, expectPageContains, loginForE2E, type CreatedResource} from '../keywords/e2eCoreKeywords';

// These smoke tests intentionally run serially because they build one authenticated user's
// realistic core workspace and then verify the high-value pages that depend on that setup.
test.describe.configure({mode: 'serial'});

// Canary: groups related smoke checks so a maintainer can understand the protected workflow quickly.
test.describe('authenticated core workflow smoke suite', () => {
    let authedRequest: APIRequestContext;
    const resources: Record<string, CreatedResource> = {};

    test.beforeAll(async ({baseURL}) => {
        authedRequest = await playwrightRequest.newContext({baseURL});
        await loginForE2E(authedRequest, createE2ELogin());
    });

    test.afterAll(async () => {
        await authedRequest.dispose();
    });

    // Canary: protects a high-value production behavior while avoiding private implementation details.
    test('authenticates the seeded organizer and opens the dashboard', async () => {
        await expectPageContains(authedRequest.get('/users/dashboard'), 'Dashboard');
    });

    // Canary: protects a high-value production behavior while avoiding private implementation details.
    test('creates an event through the real create route', async () => {
        resources.event = await createResourceViaForm(authedRequest, createE2EEvent());
        expect(resources.event.path).toContain('/event/');
    });

    // Canary: protects a high-value production behavior while avoiding private implementation details.
    test('opens the created event detail page', async () => {
        await expectPageContains(authedRequest.get(resources.event.path), createE2EEvent().expectedViewText);
    });

    // Canary: protects a high-value production behavior while avoiding private implementation details.
    test('opens the created event admin page for the owner', async () => {
        await expectPageContains(authedRequest.get(`${resources.event.path}/admin`), createE2EEvent().expectedViewText);
    });

    // Canary: protects a high-value production behavior while avoiding private implementation details.
    test('creates a survey through the real create route', async () => {
        resources.survey = await createResourceViaForm(authedRequest, createE2ESurvey());
        expect(resources.survey.path).toContain('/survey/');
    });

    // Canary: protects a high-value production behavior while avoiding private implementation details.
    test('opens the created survey voting page', async () => {
        await expectPageContains(authedRequest.get(resources.survey.path), createE2ESurvey().expectedViewText);
    });

    // Canary: protects a high-value production behavior while avoiding private implementation details.
    test('creates an event-scoped survey from the same reusable factory data', async () => {
        resources.eventSurvey = await createResourceViaForm(authedRequest, createE2ESurvey({title: 'E2E Event Survey', createPath: `/survey/create?eventId=${resources.event.id}`, expectedViewText: 'E2E Event Survey', form: {...createE2ESurvey().form, title: 'E2E Event Survey'}}));
        expect(resources.eventSurvey.path).toContain('/survey/');
    });

    // Canary: protects a high-value production behavior while avoiding private implementation details.
    test('creates an activity plan through the real create route', async () => {
        resources.activity = await createResourceViaForm(authedRequest, createE2EActivityPlan());
        expect(resources.activity.path).toContain('/activity/');
    });

    // Canary: protects a high-value production behavior while avoiding private implementation details.
    test('opens the created activity plan page', async () => {
        await expectPageContains(authedRequest.get(resources.activity.path), createE2EActivityPlan().expectedViewText);
    });

    // Canary: protects a high-value production behavior while avoiding private implementation details.
    test('creates an event-scoped activity plan', async () => {
        resources.eventActivity = await createResourceViaForm(authedRequest, createE2EActivityPlan({title: 'E2E Event Activity Plan', createPath: `/activity/create?eventId=${resources.event.id}`, expectedViewText: 'E2E Event Activity Plan', form: {...createE2EActivityPlan().form, title: 'E2E Event Activity Plan'}}));
        expect(resources.eventActivity.path).toContain('/activity/');
    });

    // Canary: protects a high-value production behavior while avoiding private implementation details.
    test('creates a drivers list through the real create route', async () => {
        resources.drivers = await createResourceViaForm(authedRequest, createE2EDriversList());
        expect(resources.drivers.path).toContain('/drivers/');
    });

    // Canary: protects a high-value production behavior while avoiding private implementation details.
    test('opens the created drivers list page', async () => {
        await expectPageContains(authedRequest.get(resources.drivers.path), createE2EDriversList().expectedViewText);
    });

    // Canary: protects a high-value production behavior while avoiding private implementation details.
    test('creates a packing list through the real create route', async () => {
        resources.packing = await createResourceViaForm(authedRequest, createE2EPackingList());
        expect(resources.packing.path).toContain('/packing/');
    });

    // Canary: protects a high-value production behavior while avoiding private implementation details.
    test('opens the created packing list page', async () => {
        await expectPageContains(authedRequest.get(resources.packing.path), createE2EPackingList().expectedViewText);
    });

    // Canary: protects a high-value production behavior while avoiding private implementation details.
    test('shows the created core resources on the authenticated dashboard', async () => {
        const dashboard = await expectPageContains(authedRequest.get('/users/dashboard'), 'Dashboard');
        for (const title of [createE2EEvent().title, createE2ESurvey().title, createE2EActivityPlan().title, createE2EDriversList().title, createE2EPackingList().title]) {
            expect(dashboard).toContain(title);
        }
    });
});
