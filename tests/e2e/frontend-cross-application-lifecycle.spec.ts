import {expect, test, type APIRequestContext, type Page, type Route} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import type {components} from '../../src/types/api/v1';
import {createE2EActivityPlan, createE2EEvent, createE2ELogin, createE2EPackingList} from '../factories/e2eCoreFactory';
import {commandHeadersForE2E, createProfileForE2E, createResourceViaForm, entitySettingsHeadersForE2E,
    loginForE2E, selectProfileForE2E, updateEntityDefaultsForE2E} from '../keywords/e2eCoreKeywords';
import {createBrowserReadGate, waitForFrontendHydration} from '../keywords/frontendDynamicKeywords';
import {frontendEventHeaders} from '../keywords/frontendEventE2EKeywords';
import {PERM} from '../../src/backend/modules/lib/permissions';

/** Obtain the real server actor rather than infer identity from a rendered label. */
async function session(request: APIRequestContext): Promise<components['schemas']['SessionView']> {
    const response = await request.get('/api/v1/session');
    expect(response.status()).toBe(200);
    return response.json() as Promise<components['schemas']['SessionView']>;
}

/** Create actor-owned Overview records through existing forms in both families. */
async function privateResources(request: APIRequestContext) {
    await loginForE2E(request, createE2ELogin());
    const profileName = `P10 lifecycle ${randomUUID().slice(0, 8)}`;
    await createProfileForE2E(request, profileName);
    const roster = await session(request);
    const profile = roster.profiles.find(candidate => candidate.name === profileName)!;
    expect(profile).toBeDefined();
    await selectProfileForE2E(request, profile.id);

    // Each bounded Overview now contains only this visit's two private records,
    // regardless of which other suites have already exercised the seed account.
    const packingInput = createE2EPackingList();
    packingInput.title = packingInput.form.title = `P10 private packing ${randomUUID().slice(0, 8)}`;
    const activityInput = createE2EActivityPlan();
    activityInput.title = activityInput.form.title = `P10 private duties ${randomUUID().slice(0, 8)}`;

    // Empty command grants keep these standalone details readable to established
    // profiles while restricting their private editors to the original owner.
    const packing = await createResourceViaForm(request, packingInput);
    const activity = await createResourceViaForm(request, activityInput);
    for (const resource of [{collection: 'packing-lists', id: packing.id}, {collection: 'activity-plans', id: activity.id}]) {
        await updateEntityDefaultsForE2E(request, resource.collection, resource.id,
            {public: 0, guest: 0, authenticated: 0, participant: 0});
    }
    return {packing, activity};
}

/** Hold one genuine successful read; cancellation may retire its browser consumer
 * while the backend's already admitted response remains available for delivery. */
async function holdRead(page: Page, path: string) {
    const received = createBrowserReadGate();
    const release = createBrowserReadGate();
    const delivered = createBrowserReadGate();
    const pattern = '**' + path;
    let delivering = false;
    await page.route(pattern, deliverRead, {times: 1});

    async function deliverRead(route: Route): Promise<void> {
        delivering = true;
        const response = await route.fetch();
        expect([200, 304]).toContain(response.status());
        received.release();
        await release.promise;
        try {
            // Preserve headers and body; this gate changes delivery timing only.
            await route.fulfill({response});
        } finally { delivered.release(); }
    }

    return {received: received.promise, async finish(): Promise<void> {
        release.release();
        if (delivering) await delivered.promise;
        await page.unroute(pattern, deliverRead);
    }};
}

/** Follow the actual shell link while retaining its application document marker. */
async function openOverview(page: Page): Promise<void> {
    await page.locator('header').getByRole('button', {name: 'Overview', exact: true}).click();
    await page.locator('header').getByRole('link', {name: 'Your overview', exact: true}).click();
    await expect(page).toHaveURL(/\/users\/dashboard(?:\?[^#]*)?$/u);
}

/** The whole painted card is a link, including its visible description. Select
 * its actual resource instead of treating the title as its complete name. */
function cardLink(page: Page, id: string) {
    return page.locator(`main article.js-item[data-id="${id}"] a.card-body`);
}

/** Expose the real creation action without assuming how a canceled route left
 * its native disclosure. Read visibility before deciding whether to toggle it. */
async function activityCreationLink(page: Page) {
    const link = page.locator('header').getByRole('link', {name: 'Activity plan', exact: true});
    if (!await link.isVisible()) await page.locator('header').getByRole('button', {name: 'New', exact: true}).click();
    await expect(link).toBeVisible();
    return link;
}

test('external profile switching retires held Packing editors, drafts and warmed Overview appearances', async ({page}) => {
    const resources = await privateResources(page.request);
    const original = await session(page.request);
    const name = `P10 alternate ${randomUUID().slice(0, 8)}`;
    await createProfileForE2E(page.request, name);
    const roster = await session(page.request);
    const alternate = roster.profiles.find(profile => profile.name === name)!;
    expect(alternate).toBeDefined();
    expect(roster.activeProfile?.id).toBe(original.activeProfile?.id);

    // Warm both Overview families, then enter Packing through the real card.
    await page.goto('/users/dashboard?locale=en', {waitUntil: 'domcontentloaded'});
    await waitForFrontendHydration(page);
    await expect(cardLink(page, resources.activity.id)).toBeVisible();
    await cardLink(page, resources.packing.id).click();
    await expect(page.locator('#quick-title')).toBeVisible();
    await page.evaluate(() => { document.documentElement.dataset.p10Document = 'profile-retirement'; });
    await page.locator('#quick-title').fill('Private old-profile quick-add draft');

    const held = await holdRead(page, `/api/v1/packing-lists/${resources.packing.id}`);
    try {
        await page.getByRole('button', {name: 'Refresh', exact: true}).click();
        await held.received;

        // An external tab can change the shared cookie without consulting this
        // page's draft guard. Focus revalidation must retire its prior actor.
        const changed = await page.request.put('/api/v1/auth/profile', {
            headers: await frontendEventHeaders(page.request), data: {profileId: alternate.id},
        });
        expect(changed.status()).toBe(200);
        await page.evaluate(() => window.dispatchEvent(new Event('focus')));
        await expect(page.locator('#quick-title')).toHaveCount(0);
        await expect(page.locator('header')).toContainText(name);
    } finally { await held.finish(); }

    // Delivering old success cannot restore the old editor or another family's
    // private Overview appearance. Standalone readable detail remains deliberate.
    await expect(page.locator('#quick-title')).toHaveCount(0);
    await openOverview(page);
    await expect(cardLink(page, resources.packing.id)).toHaveCount(0);
    await expect(cardLink(page, resources.activity.id)).toHaveCount(0);
    expect((await session(page.request)).activeProfile?.id).toBe(alternate.id);
    expect(await page.evaluate(() => document.documentElement.dataset.p10Document)).toBe('profile-retirement');
});

test('expired browser session retires dirty Activity settings and rejects its held private response', async ({page}) => {
    const {activity} = await privateResources(page.request);
    await page.goto(`${activity.path}?locale=en`, {waitUntil: 'domcontentloaded'});
    await waitForFrontendHydration(page);
    await page.getByRole('button', {name: 'Entity settings', exact: true}).click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('[name="description"]').fill('Private expired-session settings draft');
    await page.evaluate(() => { document.documentElement.dataset.p10Document = 'expired-retirement'; });

    // Profile discovery is independent of session focus revalidation. Keep the
    // dirty General draft mounted while another settings panel reads privately.
    await dialog.getByRole('tab', {name: 'Access', exact: true}).click();
    await dialog.getByRole('tab', {name: 'Administrators', exact: true}).click();
    await dialog.locator('#frontend-access-admins').getByRole('button', {name: 'Add', exact: true}).click();
    const held = await holdRead(page, `/api/v1/activity-plans/${activity.id}/profiles?q=p10-expiry`);
    try {
        await dialog.locator('#profile-search').fill('p10-expiry');
        await held.received;
        const cookies = await page.context().cookies();
        const authentication = cookies.find(cookie => cookie.name === 'connect.sid');
        expect(authentication).toBeDefined();
        await page.context().addCookies([{...authentication!, expires: Math.floor(Date.now() / 1000) - 1}]);
        await page.evaluate(() => window.dispatchEvent(new Event('focus')));
        await expect(dialog).toHaveCount(0);
        await expect(page.getByRole('heading', {name: activity.title, exact: true})).toHaveCount(0);
        await expect(page.locator('header').getByRole('link', {name: 'Login', exact: true})).toBeVisible();
    } finally { await held.finish(); }

    await expect(page.locator('[name="description"]')).toHaveCount(0);
    await openOverview(page);
    await expect(cardLink(page, activity.id)).toHaveCount(0);
    expect((await session(page.request)).kind).toBe('anonymous');
    expect(await page.evaluate(() => document.documentElement.dataset.p10Document)).toBe('expired-retirement');
});

test('revoked Packing admission cannot return through history while independent Activity admission survives', async ({page, browser, baseURL}) => {
    const owner = await browser.newContext({baseURL});
    try {
        const resources = await privateResources(owner.request);
        const event = await createResourceViaForm(owner.request, createE2EEvent());
        expect((await owner.request.put(`/api/v1/packing-lists/${resources.packing.id}/event`, {
            headers: await entitySettingsHeadersForE2E(owner.request, 'packing-lists', resources.packing.id),
            data: {eventId: event.id, expectedEventId: null},
        })).status()).toBe(200);

        // Standalone details intentionally admit every established profile. A
        // linked child requires Event membership or its explicit ACCESS_VIEW;
        // this guest relies only on the grant that will be revoked below.
        expect((await page.request.post(`/api/v1/packing-lists/${resources.packing.id}/guest`, {
            headers: await commandHeadersForE2E(page.request),
            data: {username: `P10 admitted guest ${randomUUID().slice(0, 8)}`, email: null},
        })).status()).toBe(200);
        const guest = await session(page.request);
        for (const resource of [{collection: 'packing-lists', id: resources.packing.id}, {collection: 'activity-plans', id: resources.activity.id}]) {
            expect((await owner.request.post(`/api/v1/${resource.collection}/${resource.id}/admins`, {
                headers: await entitySettingsHeadersForE2E(owner.request, resource.collection, resource.id),
                data: {profileId: guest.activeProfile!.id, mask: PERM.ACCESS_VIEW},
            })).status()).toBe(200);
        }

        await page.goto('/users/dashboard?locale=en', {waitUntil: 'domcontentloaded'});
        await waitForFrontendHydration(page);
        await page.evaluate(() => { document.documentElement.dataset.p10Document = 'revoked-retirement'; });
        await cardLink(page, resources.activity.id).click();
        await expect(page.getByRole('heading', {name: resources.activity.title, exact: true})).toBeVisible();
        await openOverview(page);
        await cardLink(page, resources.packing.id).click();
        await expect(page.getByRole('heading', {name: resources.packing.title, exact: true})).toBeVisible();

        // Start from a genuinely admitted control. Entry and detail revalidation
        // independently retire this view, so deleting first and then seeking its
        // Refresh races correct denial. Delay this one real GET before sending
        // it to the backend; authorization must observe the completed revocation.
        const refresh = page.getByRole('button', {name: 'Refresh', exact: true});
        await expect(refresh).toBeEnabled();
        const requested = createBrowserReadGate();
        const forward = createBrowserReadGate();
        const delivered = createBrowserReadGate();
        const detailPath = `/api/v1/packing-lists/${resources.packing.id}`;
        const detailPattern = '**' + detailPath;
        let reading = false;
        await page.route(detailPattern, readAfterRevocation, {times: 1});

        /** Preserve the real read and response; change only when server admission runs. */
        async function readAfterRevocation(route: Route): Promise<void> {
            reading = true;
            requested.release();
            await forward.promise;
            try {
                const response = await route.fetch();
                await route.fulfill({response});
            } finally { delivered.release(); }
        }

        try {
            const denied = page.waitForResponse(response => response.request().method() === 'GET'
                && new URL(response.url()).pathname === detailPath);
            await refresh.click();
            await requested.promise;
            const grantPath = `/api/v1/packing-lists/${resources.packing.id}/admins/${guest.activeProfile!.id}`;
            const baseline = await owner.request.get(grantPath + '/edit-baseline', {headers: await commandHeadersForE2E(owner.request)});
            expect(baseline.status()).toBe(200);
            expect((await owner.request.delete(grantPath, {headers: {...await commandHeadersForE2E(owner.request),
                'If-Match': (await baseline.json()).editToken}})).status()).toBe(200);
            forward.release();
            expect((await denied).status()).toBe(403);
        } finally {
            forward.release();
            if (reading) await delivered.promise;
            await page.unroute(detailPattern, readAfterRevocation);
        }
        await expect(page.getByRole('heading', {name: resources.packing.title, exact: true})).toHaveCount(0);
        await openOverview(page);
        await expect(cardLink(page, resources.packing.id)).toHaveCount(0);
        await expect(cardLink(page, resources.activity.id)).toBeVisible();

        // Back reuses the application/cache but still obtains current admission.
        // A denied sibling does not expire the guest or discard Activity grants.
        await page.goBack();
        await expect(page).toHaveURL(new RegExp(`/packing/${resources.packing.id}`, 'u'));
        await expect(page.getByRole('heading', {name: resources.packing.title, exact: true})).toHaveCount(0);
        await openOverview(page);
        await cardLink(page, resources.activity.id).click();
        await expect(page.getByRole('heading', {name: resources.activity.title, exact: true})).toBeVisible();
        expect((await session(page.request)).context).toBe(guest.context);
        expect(await page.evaluate(() => document.documentElement.dataset.p10Document)).toBe('revoked-retirement');
    } finally { await owner.close(); }
});

test('unknown Packing creation protects canceled cross-feature departure and never replays after accepted Activity navigation', async ({page}) => {
    const {packing} = await privateResources(page.request);
    await page.goto(`${packing.path}?locale=en`, {waitUntil: 'domcontentloaded'});
    await waitForFrontendHydration(page);
    await page.evaluate(() => { document.documentElement.dataset.p10Document = 'unknown-departure'; });
    const title = `P10 uncertain item ${randomUUID().slice(0, 8)}`;
    await page.locator('#quick-title').fill(title);
    let sends = 0;
    const pattern = `**/api/v1/packing-lists/${packing.id}/items`;
    await page.route(pattern, async function loseCommittedCreation(route): Promise<void> {
        if (route.request().method() !== 'POST') { await route.continue(); return; }
        sends++;
        const saved = await route.fetch();
        expect(saved.status()).toBe(201);
        await route.abort('connectionreset');
    });
    await page.locator('form:has(#quick-title)').getByRole('button', {name: 'Add', exact: true}).click();
    await expect(page.getByRole('status').filter({hasText: 'The result is uncertain.'})).toBeVisible();
    await expect(page.locator('#quick-title')).toHaveValue(title);

    // The same shared command guard governs navigation into another feature.
    // Cancellation preserves the exact draft; acceptance releases that visit.
    const creationLink = await activityCreationLink(page);
    page.once('dialog', dialog => dialog.dismiss());
    await creationLink.click();
    await expect(page).toHaveURL(new RegExp(`/packing/${packing.id}`, 'u'));
    await expect(page.locator('#quick-title')).toHaveValue(title);
    await activityCreationLink(page);
    page.once('dialog', dialog => dialog.accept());
    await creationLink.click();
    await expect(page).toHaveURL(/\/activity\/create/u);
    await expect(page.getByRole('textbox', {name: 'Title *', exact: true})).toHaveValue('');
    await expect(page.getByRole('status').filter({hasText: 'The result is uncertain.'})).toHaveCount(0);
    await page.unroute(pattern);

    // Confirm persistence independently of the browser snapshot. This read must
    // reveal one committed row without creating or replaying any item command.
    const saved = await page.request.get(`/api/v1/packing-lists/${packing.id}`, {
        headers: await frontendEventHeaders(page.request),
    });
    expect(saved.status()).toBe(200);
    const savedList = await saved.json() as components['schemas']['PackingListView'];
    expect(savedList.items.filter(item => item.title === title)).toHaveLength(1);

    // A same-actor return may reuse its still-fresh admitted cache. Deliberate
    // saved-state inspection uses the existing Refresh action; it never replays
    // the unknown creation or changes ordinary navigation's freshness policy.
    await openOverview(page);
    await cardLink(page, packing.id).click();
    const inspected = page.waitForResponse(response => response.request().method() === 'GET'
        && new URL(response.url()).pathname === `/api/v1/packing-lists/${packing.id}`);
    await page.getByRole('button', {name: 'Refresh', exact: true}).click();
    expect((await inspected).status()).toBe(200);
    await expect(page.locator('tr[data-item-id]').filter({hasText: title})).toHaveCount(1);
    await expect(page.locator('#quick-title')).toHaveValue('');
    expect(sends).toBe(1);
    expect(await page.evaluate(() => document.documentElement.dataset.p10Document)).toBe('unknown-departure');
});
