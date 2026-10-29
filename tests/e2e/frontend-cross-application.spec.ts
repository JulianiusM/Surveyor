import {expect, test, type APIRequestContext, type Locator, type Page, type Response, type Route, type TestInfo} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createE2EActivityPlan, createE2EDriversList, createE2EEvent, createE2ELogin, createE2EPackingList, createE2ESurvey} from '../factories/e2eCoreFactory';
import {createProfileForE2E, createResourceViaForm, expectMobileOverviewActionRows, expectUsableFrontendLayout, loginForE2E,
    readVisiblePresentation, selectProfileForE2E} from '../keywords/e2eCoreKeywords';
import {frontendEventHeaders} from '../keywords/frontendEventE2EKeywords';
import {createBrowserReadGate, waitForFrontendHydration} from '../keywords/frontendDynamicKeywords';
import type {components} from '../../src/types/api/v1';

/** Give this journey a bounded, private collection without deleting another
 * test's resources. All records and images use the application's HTTP owners. */
async function mixedOverview(request: APIRequestContext) {
    await loginForE2E(request, createE2ELogin());
    const name = `P10 ${randomUUID().slice(0, 8)}`;
    await createProfileForE2E(request, name);
    const session = await (await request.get('/api/v1/session')).json() as components['schemas']['SessionView'];
    const profile = session.profiles.find(candidate => candidate.name === name)!;
    expect(profile).toBeDefined();
    await selectProfileForE2E(request, profile.id);

    // Generated commands prepare persisted data; the journey then uses genuine
    // mounted navigation and commands against the same integrated application.
    const factories = [createE2EEvent, createE2EPackingList, createE2EDriversList, createE2ESurvey, createE2EActivityPlan];
    const resources = [];
    for (const factory of factories) {
        const input = factory();
        input.title = input.form.title = name + ' ' + input.createPath.split('/')[1];
        const resource = await createResourceViaForm(request, input);
        const type = resource.path.split('/')[1]!;
        const plural = {event: 'events', packing: 'packing-lists', drivers: 'drivers-lists', survey: 'surveys', activity: 'activity-plans'}[type]!;
        const endpoint = `/api/v1/${plural}/${resource.id}`;
        // Surveys retain their deliberate owner-only last-write header contract;
        // other families capture a field-specific comparison before replacement.
        let token: string | undefined;
        if (type !== 'survey') {
            const baseline = await request.get(endpoint + '/header/edit-baseline', {headers: await frontendEventHeaders(request)});
            expect(baseline.status()).toBe(200);
            token = (await baseline.json()).editToken as string;
        }
        expect((await request.put(endpoint + '/header', {
            headers: {...await frontendEventHeaders(request), ...(token ? {'If-Match': token} : {})},
            multipart: {image: {name: 'p10.png', mimeType: 'image/png', buffer: readFileSync('src/public/img/logo.png')}},
        })).status()).toBe(200);
        resources.push({...resource, type, endpoint});
    }

    // A linked child groups only with its independently admitted Event. The
    // other four families stay standalone and exercise the mixed root grid.
    const event = resources.find(resource => resource.type === 'event')!;
    const childInput = createE2EPackingList();
    childInput.title = childInput.form.title = name + ' linked child';
    Object.assign(childInput.form, {event_id: event.id});
    const child = await createResourceViaForm(request, childInput);
    return {resources, event, child};
}

/** Capture original rendered pixels and meaningful card information. Geometry
 * remains independently inspectable; parity does not require identical pixels. */
async function captureCards(page: Page, info: TestInfo, label: string, region: Locator, resources: Awaited<ReturnType<typeof mixedOverview>>['resources']) {
    await page.evaluate(() => document.fonts.ready);
    // Compare the same resting pointer state; a prior Refresh/search click can
    // otherwise leave the stationary cursor over a later scrolled card action.
    await page.mouse.move(0, 0);
    const presentations = [];
    for (const resource of resources) {
        const card = region.locator(`.js-item[data-id="${resource.id}"]`);
        await expect(card).toBeVisible();
        await expect(card.locator('img')).toBeVisible();
        await expect.poll(() => card.locator('img').evaluate(image => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0)).toBe(true);
        const path = info.outputPath(`${label}-${resource.type}.png`);
        await card.screenshot({path, animations: 'disabled'});
        await info.attach(`${label}-${resource.type}`, {path, contentType: 'image/png'});
        presentations.push(await readVisiblePresentation(card, ['h4', '.card-text', '.badge', '.btn']));
    }
    const path = info.outputPath(label + '-overview.png');
    await page.screenshot({path, fullPage: true, animations: 'disabled'});
    await info.attach(label + '-overview', {path, contentType: 'image/png'});
    return presentations;
}

/** Delay one genuine collection read. Existing focus checks select participation;
 * deletion recovery selects only the warm default owner destination. Timing is
 * the sole substitution: the backend still supplies the unchanged response. */
async function holdOverviewRead(page: Page, collection = 'participant', defaultOnly = false) {
    const received = createBrowserReadGate();
    const released = createBrowserReadGate();
    const delivered = createBrowserReadGate();
    const pattern = '**/api/v1/overview?*';
    let started = false;
    let failure: unknown;
    await page.route(pattern, holdResponse);

    async function holdResponse(route: Route): Promise<void> {
        const query = new URL(route.request().url()).searchParams;
        if (started || query.get('collection') !== collection || query.get('region') !== 'main'
            || defaultOnly && (query.get('q') || query.get('eventId'))) {
            await route.continue();
            return;
        }
        started = true;
        try {
            const response = await route.fetch();
            expect(response.status()).toBe(200);
            received.release();
            await released.promise;
            await route.fulfill({response});
        } catch (error) {
            // Surface the actual failed read instead of stranding the fixture's
            // receipt/teardown promises until the entire test times out.
            failure = error;
            received.release();
        } finally { delivered.release(); }
    }

    return {received: received.promise.then(() => {if (failure) throw failure;}), async finish(): Promise<void> {
            released.release();
            if (started) await delivered.promise;
            await page.unroute(pattern, holdResponse);
            if (failure) throw failure;
        }};
}

for (const width of [1280, 390]) {
    test(`integrates every family through matched Overview cards, detail, duplicate and administration at ${width}px`, async ({page}, info) => {
        test.setTimeout(120_000);
        await page.setViewportSize({width, height: 900});
        const fixture = await mixedOverview(page.request);
        await page.goto('/users/dashboard?locale=en', {waitUntil: 'domcontentloaded'});
        await waitForFrontendHydration(page);
        const owner = page.locator('[data-collection="owner"][data-region="main"]');
        await expect(owner.locator('.js-item')).toHaveCount(5);
        await expect(owner).toContainText('6 matching entities');
        await expect(owner.locator(`[data-id="${fixture.child.id}"]`)).toHaveCount(0);
        const emptyParticipation = page.locator('[data-collection="participant"][data-region="main"]');
        await expect(emptyParticipation).toContainText('You are not participating anywhere');
        await expect(emptyParticipation.getByRole('searchbox')).toHaveCount(0);
        // Main-region Refresh lives beside its collection accordion toggle,
        // outside the content section that owns the empty-membership message.
        const participationHeading = page.getByRole('heading', {level: 2})
            .filter({has: page.locator('button[aria-controls="overview-participant"]')});
        const refreshEmpty = participationHeading.getByRole('button', {name: 'Refresh', exact: true});
        // A rendered projection can precede its mount-time revalidation. Arm the
        // response gate only after the real control is ready, otherwise that
        // initial read can be held while click waits for the same read to finish.
        await expect(refreshEmpty).toBeEnabled();
        const heldEmpty = await holdOverviewRead(page);
        let refreshScroll = 0;
        try {
            await test.step('Start an explicit participation Refresh', () => refreshEmpty.click());
            await test.step('Receive the genuine held participation response', () => heldEmpty.received);
            await expect(refreshEmpty).toBeDisabled();
            refreshScroll = await page.evaluate(() => window.scrollY);
        } finally { await test.step('Deliver the held participation response', () => heldEmpty.finish()); }
        await expect(refreshEmpty).toBeEnabled();
        await expect(refreshEmpty).toBeFocused();
        expect(await page.evaluate(() => window.scrollY)).toBe(refreshScroll);

        // A deliberate move during another pending read cancels restoration.
        // The shared button must not pull focus back from a sibling's search.
        const heldMoved = await holdOverviewRead(page);
        const search = owner.getByRole('searchbox');
        try {
            await test.step('Start the Refresh with intentional focus movement', () => refreshEmpty.click());
            await test.step('Receive the held response before moving focus', () => heldMoved.received);
            await search.click();
        } finally { await test.step('Deliver the response after focus movement', () => heldMoved.finish()); }
        await expect(refreshEmpty).toBeEnabled();
        await expect(search).toBeFocused();
        const migrated = await captureCards(page, info, 'vue', owner, fixture.resources);
        for (const [index, presentation] of migrated.entries()) {
            // Persisted entity identity and available actions remain direct
            // assertions after retirement of the live native comparator.
            expect(presentation.content.text).toContain(fixture.resources[index]!.title);
            expect(presentation.content.elements.some(element => element.text === 'Duplicate')).toBe(true);
            expect(presentation.content.elements.some(element => element.text === 'Delete')).toBe(true);
            if (width === 390)
                await expectMobileOverviewActionRows(owner.locator(`.js-item[data-id="${fixture.resources[index]!.id}"]`));
        }
        await expectUsableFrontendLayout(owner);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);

        // Every ordinary destination must remain in the original document,
        // including backward history from another family and Event admin.
        const documentOrigin = await page.evaluate(() => performance.timeOrigin);
        const navigations: string[] = [];
        page.on('request', request => {
            if (request.isNavigationRequest() && request.frame() === page.mainFrame()) navigations.push(request.url());
        });
        for (const resource of fixture.resources) {
            const card = owner.locator(`[data-id="${resource.id}"]`);
            await card.locator('a.card-body').click();
            await expect(page).toHaveURL(resource.path);
            await expect(page.getByRole('heading', {name: resource.title, exact: true}).first()).toBeVisible();
            await page.getByRole('button', {name: 'Entity settings', exact: true}).click();
            const settings = page.getByRole('dialog');
            await expect(settings).toBeVisible();
            await settings.getByRole('button', {name: 'Close', exact: true}).first().click();
            if (resource.type === 'event') {
                await page.locator(`main a[href="/event/${resource.id}/admin"]`).click();
                await expect(page).toHaveURL(`/event/${resource.id}/admin`);
                await expect(page).toHaveTitle(`Dashboard — ${resource.title}`);
                await page.goBack();
            }
            await page.goBack();
            await expect(card).toBeVisible();
            await card.getByRole('link', {name: 'Duplicate', exact: true}).click();
            await expect(page).toHaveURL(resource.path + '/duplicate');
            await expect(page.locator('main input[type="text"]').first()).toHaveValue(resource.title);
            await page.goBack();
            await expect(card).toBeVisible();
        }
        expect(await page.evaluate(() => performance.timeOrigin)).toBe(documentOrigin);
        expect(navigations).toEqual([]);
    });
}

test('keeps parent grouping, personal placement, hidden-region history and counts independent across families', async ({page}) => {
    test.setTimeout(90_000);
    const {resources, event, child} = await mixedOverview(page.request);
    await page.goto('/users/dashboard?locale=en', {waitUntil: 'domcontentloaded'});
    await waitForFrontendHydration(page);
    const owner = page.locator('[data-collection="owner"][data-region="main"]');
    const participant = page.locator('[data-collection="participant"][data-region="main"]');
    const eventCard = owner.locator(`[data-id="${event.id}"]`);
    const expansion = eventCard.locator('[data-overview-event]');
    await expansion.click();
    await expect(owner.locator('.entity-overview-children')).toContainText(child.title);
    await expect(owner.locator('.entity-overview-children .js-item')).toHaveCount(1);
    await page.goBack();
    await expect(expansion).toBeFocused();
    await expect(owner.locator('.entity-overview-children')).toHaveCount(0);

    // A parent's personal preference never propagates to its linked child.
    await eventCard.getByRole('button', {name: 'Archival and visibility for ' + event.title, exact: true}).click();
    const hidden = page.waitForResponse(response => response.request().method() === 'PUT'
        && new URL(response.url()).pathname === `/api/v1/overview/event/${event.id}/visibility`);
    await eventCard.getByRole('button', {name: 'Hide for me', exact: true}).click();
    expect((await hidden).status()).toBe(200);
    await expect(eventCard).toHaveCount(0);
    await expect(owner.locator(`[data-id="${child.id}"]`)).toBeVisible();
    await expect(owner.locator('.js-item')).toHaveCount(5);
    const eventRead = await page.request.get(`/api/v1/events/${event.id}`, {headers: await frontendEventHeaders(page.request)});
    expect(eventRead.status()).toBe(200);
    const savedEvent = await eventRead.json() as components['schemas']['EventView'];
    expect(savedEvent.archive.direct).toBe(false);
    expect(savedEvent.archive.inherited).toBe(false);

    await page.locator('[aria-controls="overview-owner-hidden"]').click();
    const ownerHidden = page.locator('[data-collection="owner"][data-region="hidden"]');
    await expect(ownerHidden.locator(`[data-id="${event.id}"]`)).toContainText('Hidden for me');
    await expect(page.locator('[data-collection="participant"][data-region="hidden"]')).toHaveCount(0);
    await expect(participant).toBeVisible();
    await page.goBack();
    await expect(ownerHidden).toHaveCount(0);
    await page.goForward();
    await expect(ownerHidden.locator(`[data-id="${event.id}"]`)).toBeVisible();
    await expect(owner.locator(`[data-id="${child.id}"]`)).toBeVisible();
    for (const resource of resources.filter(resource => resource.type !== 'event')) {
        await expect(owner.locator(`[data-id="${resource.id}"]`)).toBeVisible();
    }
});

test('blocks writes from a deleted warm Overview card until its genuine destination read arrives', async ({page}) => {
    const {resources} = await mixedOverview(page.request);
    const removed = resources.find(resource => resource.type === 'packing')!;
    await page.goto('/users/dashboard?locale=en', {waitUntil: 'domcontentloaded'});
    await waitForFrontendHydration(page);
    await page.locator('header').getByRole('button', {name: 'Overview', exact: true}).click();
    await page.locator('header').getByRole('link', {name: 'Your overview', exact: true}).click();
    await expect(page).toHaveURL('/users/dashboard');
    const owner = page.locator('[data-collection="owner"][data-region="main"]');
    await expect(owner.locator('.js-item')).toHaveCount(5);
    await expect(owner).toHaveAttribute('aria-busy', 'false');
    const origin = await page.evaluate(() => performance.timeOrigin);

    // Leave the default key warm while selecting one real filtered projection.
    // Its deletion follow-up can finish before the destination's own GET arrives.
    await owner.getByRole('searchbox').fill(removed.title);
    await owner.getByRole('button', {name: 'Search', exact: true}).click();
    await expect(owner.locator('.js-item')).toHaveCount(1);
    await expect(owner).toHaveAttribute('aria-busy', 'false');
    const held = await holdOverviewRead(page, 'owner', true);
    const deletes: string[] = [];
    page.on('request', request => {
        if (request.method() === 'DELETE') deletes.push(new URL(request.url()).pathname);
    });
    try {
        const deleted = page.waitForResponse(response => response.request().method() === 'DELETE'
            && new URL(response.url()).pathname === removed.endpoint);
        page.once('dialog', confirmation => confirmation.accept());
        await owner.getByRole('button', {name: 'Delete', exact: true}).click();
        expect((await deleted).status()).toBe(200);
        await held.received;
        await expect(page).toHaveURL('/users/dashboard');

        // The retained card is readable while its real saved projection is held.
        // Its native disabled control cannot submit a second destructive command.
        const stale = owner.locator(`.js-item[data-id="${removed.id}"]`);
        await expect(stale).toBeVisible();
        const remove = stale.getByRole('button', {name: 'Delete', exact: true});
        await expect(remove).toBeDisabled();
        await remove.evaluate(function attemptDisabledRemoval(control) {
            (control as HTMLButtonElement).click();
        });
        await expect(stale.locator('a.card-body')).toHaveAttribute('href', removed.path);
        await expect(owner.getByRole('searchbox')).toBeEnabled();
        expect(deletes).toEqual([removed.endpoint]);
    } finally { await held.finish(); }

    await expect(owner.locator(`.js-item[data-id="${removed.id}"]`)).toHaveCount(0);
    await expect(owner.locator('.js-item')).toHaveCount(4);
    const survivor = resources.find(resource => resource.type === 'drivers')!;
    await expect(owner.locator(`.js-item[data-id="${survivor.id}"]`)
        .getByRole('button', {name: 'Delete', exact: true})).toBeEnabled();
    expect(deletes).toEqual([removed.endpoint]);
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(origin);
});

test('reconciles confirmed root deletion at the same Overview URL and from a filtered visit into its warm default cache', async ({page}) => {
    test.setTimeout(90_000);
    const {resources, child} = await mixedOverview(page.request);
    await page.goto('/users/dashboard?locale=en', {waitUntil: 'domcontentloaded'});
    await waitForFrontendHydration(page);
    // Commit the exact default destination through existing SPA navigation. Its
    // admitted projection is also the warm return target for the second deletion.
    await page.locator('header').getByRole('button', {name: 'Overview', exact: true}).click();
    await page.locator('header').getByRole('link', {name: 'Your overview', exact: true}).click();
    await expect(page).toHaveURL('/users/dashboard');
    const owner = page.locator('[data-collection="owner"][data-region="main"]');
    await expect(owner.locator('.js-item')).toHaveCount(5);
    await expect(owner).toContainText('6 matching entities');
    await expect(owner).toHaveAttribute('aria-busy', 'false');
    const documentOrigin = await page.evaluate(() => performance.timeOrigin);
    const deletes: string[] = [];
    const documents: string[] = [];
    page.on('request', request => {
        if (request.method() === 'DELETE') deletes.push(new URL(request.url()).pathname);
        if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documents.push(request.url());
    });
    const selected = ['packing', 'drivers'].map(type => resources.find(resource => resource.type === type)!);

    for (const [index, resource] of selected.entries()) {
        if (index > 0) {
            // Search uses the real region form and leaves the previously admitted
            // default cache intact. Returning after deletion reconciles that key.
            await owner.getByRole('searchbox').fill(resource.title);
            await owner.getByRole('button', {name: 'Search', exact: true}).click();
            await expect.poll(() => new URL(page.url()).searchParams.get('owner_main_q')).toBe(resource.title);
            await expect(owner.locator('.js-item')).toHaveCount(1);
            await expect(owner).toHaveAttribute('aria-busy', 'false');
        }
        const card = owner.locator(`.js-item[data-type="${resource.type}"][data-id="${resource.id}"]`);
        await expect(card).toBeVisible();
        const deleted = page.waitForResponse(response => response.request().method() === 'DELETE'
            && new URL(response.url()).pathname === resource.endpoint);
        // Require the deletion's immediate reconciliation; the ordinary 30-second
        // Overview poll must not make a missing follow-up read appear correct.
        const reconciled = page.waitForResponse(readDeletedDefault, {timeout: 5000});

        // Confirmation sends the actual generated command once. A later GET is
        // persistence evidence; no optimistic fixture or fabricated body can
        // remove the old card or satisfy this saved-projection assertion.
        page.once('dialog', confirmation => confirmation.accept());
        await card.getByRole('button', {name: 'Delete', exact: true}).click();
        expect((await deleted).status()).toBe(200);
        const projection = await (await reconciled).json() as components['schemas']['OverviewRegion'];
        await expect(page).toHaveURL('/users/dashboard');
        await expect(owner.locator(`.js-item[data-id="${resource.id}"]`)).toHaveCount(0);
        await expect(owner.locator('.js-item')).toHaveCount(4 - index);
        await expect(owner).toContainText(`${5 - index} matching entities`);
        await expect(owner).toHaveAttribute('aria-busy', 'false');
        expect(projection.q).toBe('');
        expect(projection.type).toBe('all');
        expect(projection.matchingEntities).toBe(5 - index);
        const retainedEvent = resources.find(candidate => candidate.type === 'event')!;
        expect(projection.items.find(item => item.type === 'event' && item.id === retainedEvent.id)?.children?.total).toBe(1);
        for (const removed of selected.slice(0, index + 1)) {
            expect(projection.items.some(item => item.type === removed.type && item.id === removed.id)).toBe(false);
            await expect(owner.locator(`.js-item[data-id="${removed.id}"]`)).toHaveCount(0);
        }
        expect(await page.evaluate(() => performance.timeOrigin)).toBe(documentOrigin);
        expect(deletes).toEqual(selected.slice(0, index + 1).map(removed => removed.endpoint));
        expect(documents).toEqual([]);

        /** Accept only a new genuine default-region read after persistence. A
         * preceding poll still containing this root cannot satisfy the journey. */
        async function readDeletedDefault(response: Response): Promise<boolean> {
            const url = new URL(response.url());
            if (response.request().method() !== 'GET' || response.status() !== 200 || url.pathname !== '/api/v1/overview'
                || url.searchParams.get('collection') !== 'owner' || url.searchParams.get('region') !== 'main'
                || url.searchParams.get('q') || url.searchParams.get('eventId')) return false;
            const projection = await response.json() as components['schemas']['OverviewRegion'];
            return !projection.items.some(item => item.type === resource.type && item.id === resource.id);
        }
    }

    // The saved Event still groups its child after both root removals; that child
    // does not become a root card or borrow another family's deletion scope.
    await expect(owner.locator(`[data-id="${child.id}"]`)).toHaveCount(0);
    for (const remaining of resources.filter(resource => !selected.includes(resource))) {
        await expect(owner.locator(`.js-item[data-id="${remaining.id}"]`)).toBeVisible();
    }
});
