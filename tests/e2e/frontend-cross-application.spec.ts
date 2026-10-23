import {expect, test, type APIRequestContext, type Locator, type Page, type Route, type TestInfo} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createE2EActivityPlan, createE2EDriversList, createE2EEvent, createE2ELogin, createE2EPackingList, createE2ESurvey} from '../factories/e2eCoreFactory';
import {createResourceViaForm, expectUsableFrontendLayout, expectVisiblePresentation, loginForE2E, readVisiblePresentation} from '../keywords/e2eCoreKeywords';
import {frontendEventHeaders} from '../keywords/frontendEventE2EKeywords';
import {createBrowserReadGate, waitForPilotHydration} from '../keywords/frontendDynamicKeywords';
import type {components} from '../../src/types/api/v1';

/** Give this journey a bounded, private collection without deleting another
 * test's resources. All records and images use the application's HTTP owners. */
async function mixedOverview(request: APIRequestContext) {
    await loginForE2E(request, createE2ELogin());
    const name = `P10 ${randomUUID().slice(0, 8)}`;
    expect((await request.post('/users/profile/create', {form: {name}, maxRedirects: 0})).status()).toBe(302);
    const session = await (await request.get('/api/v1/session')).json() as components['schemas']['SessionView'];
    const profile = session.profiles.find(candidate => candidate.name === name)!;
    expect(profile).toBeDefined();
    expect((await request.get('/users/profile/change/' + profile.id, {maxRedirects: 0})).status()).toBe(302);

    // These native forms prepare the same persisted data for both comparators;
    // the journey itself then uses genuine mounted Vue navigation and commands.
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

/** Delay an unchanged successful participation response so native browser focus
 * behavior is observable while the actual shared Refresh control is disabled. */
async function holdParticipationRead(page: Page) {
    const received = createBrowserReadGate();
    const released = createBrowserReadGate();
    const delivered = createBrowserReadGate();
    const pattern = '**/api/v1/overview?*';
    let started = false;
    await page.route(pattern, holdResponse);

    async function holdResponse(route: Route): Promise<void> {
        const query = new URL(route.request().url()).searchParams;
        if (started || query.get('collection') !== 'participant' || query.get('region') !== 'main') {
            await route.continue();
            return;
        }
        started = true;
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        received.release();
        await released.promise;
        try { await route.fulfill({response}); }
        finally { delivered.release(); }
    }

    return {received: received.promise, async finish(): Promise<void> {
        released.release();
        if (started) await delivered.promise;
        await page.unroute(pattern, holdResponse);
    }};
}

for (const width of [1280, 390]) {
    test(`integrates every family through matched Overview cards, detail, duplicate and administration at ${width}px`, async ({page}, info) => {
        test.setTimeout(120_000);
        await page.setViewportSize({width, height: 900});
        const fixture = await mixedOverview(page.request);
        await page.goto('/users/dashboard', {waitUntil: 'domcontentloaded'});
        const nativeRegion = page.locator('#sec-own-parts-main');
        const native = await captureCards(page, info, 'native', nativeRegion, fixture.resources);

        await page.goto('/frontend-pilot?locale=en', {waitUntil: 'domcontentloaded'});
        await waitForPilotHydration(page);
        const owner = page.locator('[data-collection="owner"][data-region="main"]');
        await expect(owner.locator('.js-item')).toHaveCount(5);
        await expect(owner).toContainText('6 matching entities');
        await expect(owner.locator(`[data-id="${fixture.child.id}"]`)).toHaveCount(0);
        const emptyParticipation = page.locator('[data-collection="participant"][data-region="main"]');
        await expect(emptyParticipation).toContainText('You are not participating anywhere');
        await expect(emptyParticipation.getByRole('searchbox')).toHaveCount(0);
        const refreshEmpty = emptyParticipation.getByRole('button', {name: 'Refresh', exact: true});
        const heldEmpty = await holdParticipationRead(page);
        let refreshScroll = 0;
        try {
            await refreshEmpty.click();
            await heldEmpty.received;
            await expect(refreshEmpty).toBeDisabled();
            refreshScroll = await page.evaluate(() => window.scrollY);
        } finally { await heldEmpty.finish(); }
        await expect(refreshEmpty).toBeEnabled();
        await expect(refreshEmpty).toBeFocused();
        expect(await page.evaluate(() => window.scrollY)).toBe(refreshScroll);

        // A deliberate move during another pending read cancels restoration.
        // The shared button must not pull focus back from a sibling's search.
        const heldMoved = await holdParticipationRead(page);
        const search = owner.getByRole('searchbox');
        try {
            await refreshEmpty.click();
            await heldMoved.received;
            await search.click();
        } finally { await heldMoved.finish(); }
        await expect(refreshEmpty).toBeEnabled();
        await expect(search).toBeFocused();
        const migrated = await captureCards(page, info, 'vue', owner, fixture.resources);
        for (const [index, presentation] of migrated.entries()) expectVisiblePresentation(native[index]!, presentation);
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
            await expect(page).toHaveURL('/frontend-pilot' + resource.path);
            await expect(page.getByRole('heading', {name: resource.title, exact: true}).first()).toBeVisible();
            await page.getByRole('button', {name: 'Entity settings', exact: true}).click();
            const settings = page.getByRole('dialog');
            await expect(settings).toBeVisible();
            await settings.getByRole('button', {name: 'Close', exact: true}).first().click();
            if (resource.type === 'event') {
                await page.locator(`main a[href="/frontend-pilot/event/${resource.id}/admin"]`).click();
                await expect(page).toHaveURL(`/frontend-pilot/event/${resource.id}/admin`);
                await expect(page).toHaveTitle(`Dashboard — ${resource.title}`);
                await page.goBack();
            }
            await page.goBack();
            await expect(card).toBeVisible();
            await card.getByRole('link', {name: 'Duplicate', exact: true}).click();
            await expect(page).toHaveURL('/frontend-pilot' + resource.path + '/duplicate');
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
    await page.goto('/frontend-pilot?locale=en', {waitUntil: 'domcontentloaded'});
    await waitForPilotHydration(page);
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
