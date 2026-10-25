import {expect, test, type APIRequestContext, type BrowserContext, type Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {
    createE2EActivityPlan,
    createE2EDriversList,
    createE2EEvent,
    createE2ELogin,
    createE2EPackingList,
    createE2ESurvey,
    type E2ECreateCase,
    type E2ECreateForm,
} from '../factories/e2eCoreFactory';
import {createResourceViaForm, expectCreatedResourceLoaded, loginForE2E, type CreatedResource} from '../keywords/e2eCoreKeywords';
import {waitForFrontendHydration} from '../keywords/frontendDynamicKeywords';

// These smoke tests intentionally run serially because they build one authenticated user's
// realistic core workspace and then verify the high-value pages that depend on that setup.
test.describe.configure({mode: 'serial'});

const runId = randomUUID();

/** Keep the shared production fixtures readable while isolating bounded dashboard
 * searches from roots created by other journeys or an earlier run of this suite. */
function createRunCase<TForm extends E2ECreateForm>(input: E2ECreateCase<TForm>): E2ECreateCase<TForm> {
    const title = `${input.title} ${runId}`;
    return {...input, title, expectedViewText: title, form: {...input.form, title}};
}

// Canary: groups related smoke checks so a maintainer can understand the protected workflow quickly.
test.describe('authenticated core workflow smoke suite', () => {
    let authedRequest: APIRequestContext;
    let context: BrowserContext;
    let page: Page;
    const resources: Record<string, CreatedResource> = {};

    test.beforeAll(async ({browser, baseURL}) => {
        context = await browser.newContext({baseURL});
        authedRequest = context.request;
        await loginForE2E(authedRequest, createE2ELogin());
        page = await context.newPage();
    });

    test.afterAll(async () => {
        await context.close();
    });

    // Canary: protects a high-value production behavior while avoiding private implementation details.
    test('authenticates the seeded organizer and opens the dashboard', async () => {
        expect((await page.goto('/users/dashboard?locale=en'))?.status()).toBe(200);
        await waitForFrontendHydration(page);
        const session = await (await authedRequest.get('/api/v1/session')).json();
        await expect(page.getByRole('heading', {level: 1})).toHaveText(`Welcome, ${session.activeProfile.name}!`);
    });

    // Canary: protects a high-value production behavior while avoiding private implementation details.
    test('creates an event through the real create route', async () => {
        resources.event = await createResourceViaForm(authedRequest, createRunCase(createE2EEvent()));
        expect(resources.event.path).toContain('/event/');
    });

    test('preserves a full-length Unicode description submitted through the multipart command', async () => {
        const description = '食'.repeat(16000);
        const eventCase = createE2EEvent();
        const resource = await createResourceViaForm(authedRequest, {
            ...eventCase,
            form: {...eventCase.form, title: 'Detailed Unicode event', description},
        });
        await expectCreatedResourceLoaded(page, resource, [description]);
    });

    // Canary: protects a high-value production behavior while avoiding private implementation details.
    test('opens the created event detail page', async () => {
        await expectCreatedResourceLoaded(page, resources.event, createE2EEvent().expectedDetailTexts);
    });

    // Canary: protects a high-value production behavior while avoiding private implementation details.
    test('opens the created event admin page for the owner', async () => {
        await expectCreatedResourceLoaded(page, {...resources.event, path: `${resources.event.path}/admin`}, createE2EEvent().expectedDetailTexts);
    });

    // Canary: protects a high-value production behavior while avoiding private implementation details.
    test('creates a survey through the real create route', async () => {
        resources.survey = await createResourceViaForm(authedRequest, createRunCase(createE2ESurvey()));
        expect(resources.survey.path).toContain('/survey/');
    });

    // Canary: protects a high-value production behavior while avoiding private implementation details.
    test('opens the created survey voting page', async () => {
        await expectCreatedResourceLoaded(page, resources.survey, createE2ESurvey().expectedDetailTexts);
    });

    // Canary: protects a high-value production behavior while avoiding private implementation details.
    test('keeps survey creation standalone when entered with an Event context', async () => {
        const eventSurvey = createE2ESurvey({
            title: 'E2E Event Survey',
            createPath: `/survey/create?eventId=${resources.event.id}`,
            expectedViewText: 'E2E Event Survey',
            expectedDetailTexts: ['E2E Event Survey', 'Monday of the month'],
            form: {...createE2ESurvey().form, title: 'E2E Event Survey'},
        });
        resources.eventSurvey = await createResourceViaForm(authedRequest, eventSurvey);
        expect(resources.eventSurvey.path).toContain('/survey/');
        await expectCreatedResourceLoaded(page, resources.eventSurvey, eventSurvey.expectedDetailTexts);
        await expect(page.getByRole('link', {name: 'Go to event', exact: true})).toHaveCount(0);
    });

    // Canary: protects a high-value production behavior while avoiding private implementation details.
    test('creates an activity plan through the real create route', async () => {
        resources.activity = await createResourceViaForm(authedRequest, createRunCase(createE2EActivityPlan()));
        expect(resources.activity.path).toContain('/activity/');
    });

    // Canary: protects a high-value production behavior while avoiding private implementation details.
    test('opens the created activity plan page', async () => {
        await expectCreatedResourceLoaded(page, resources.activity, createE2EActivityPlan().expectedDetailTexts);
    });

    // Canary: protects a high-value production behavior while avoiding private implementation details.
    test('creates an event-scoped activity plan', async () => {
        const eventActivity = createE2EActivityPlan({
            title: 'E2E Event Activity Plan',
            createPath: `/activity/create?eventId=${resources.event.id}`,
            expectedViewText: 'E2E Event Activity Plan',
            expectedDetailTexts: ['E2E Event Activity Plan', 'Shared camp duties', 'Breakfast help', 'Serve breakfast'],
            form: {...createE2EActivityPlan().form, title: 'E2E Event Activity Plan'},
        });
        resources.eventActivity = await createResourceViaForm(authedRequest, eventActivity);
        expect(resources.eventActivity.path).toContain('/activity/');
        await expectCreatedResourceLoaded(page, resources.eventActivity, eventActivity.expectedDetailTexts);
    });

    // Canary: protects a high-value production behavior while avoiding private implementation details.
    test('creates a drivers list through the real create route', async () => {
        resources.drivers = await createResourceViaForm(authedRequest, createRunCase(createE2EDriversList()));
        expect(resources.drivers.path).toContain('/drivers/');
    });

    // Canary: protects a high-value production behavior while avoiding private implementation details.
    test('opens the created drivers list page', async () => {
        await expectCreatedResourceLoaded(page, resources.drivers, createE2EDriversList().expectedDetailTexts);
    });

    // Canary: protects a high-value production behavior while avoiding private implementation details.
    test('creates a packing list through the real create route', async () => {
        resources.packing = await createResourceViaForm(authedRequest, createRunCase(createE2EPackingList()));
        expect(resources.packing.path).toContain('/packing/');
    });

    // Canary: protects a high-value production behavior while avoiding private implementation details.
    test('opens the created packing list page', async () => {
        await expectCreatedResourceLoaded(page, resources.packing, createE2EPackingList().expectedDetailTexts);
    });

    // Canary: protects a high-value production behavior while avoiding private implementation details.
    test('shows the created core resources on the authenticated dashboard', async () => {
        // Other journeys share the seeded organizer and can fill later pages. Search the full
        // collection rather than assuming every created root is on the first bounded page.
        for (const key of ['event', 'survey', 'activity', 'drivers', 'packing']) {
            const resource = resources[key];
            const query = new URLSearchParams({locale: 'en', owner_main_q: resource.title});
            expect((await page.goto('/users/dashboard?' + query))?.status()).toBe(200);
            await waitForFrontendHydration(page);
            const owner = page.locator('[data-collection="owner"][data-region="main"]');
            await expect(owner).toHaveAttribute('aria-busy', 'false');
            await expect(owner.locator(`[data-id="${resource.id}"]`)).toContainText(resource.title);
        }
    });
});
