import {expect, test, type APIRequestContext, type Locator, type Page, type TestInfo} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import type {components} from '../../src/types/api/v1';
import {createE2EDriversList, createE2ELogin} from '../factories/e2eCoreFactory';
import {createResourceViaForm, expectVisiblePresentation, loginForE2E, readVisiblePresentation} from '../keywords/e2eCoreKeywords';
import {waitForPilotHydration} from '../keywords/frontendDynamicKeywords';
import {createFrontendEventFixture, frontendEventHeaders as apiHeaders} from '../keywords/frontendEventE2EKeywords';

type DriversView = components['schemas']['DriversListView'];

/** Create the comparator through the unchanged native form and native ride API.
 * Both renderers subsequently receive this actor's same persisted records. */
async function driversFixture(request: APIRequestContext) {
    await loginForE2E(request, createE2ELogin());
    const input = createE2EDriversList();
    input.title = input.form.title = `P3 journeys ${randomUUID().slice(0, 8)}`;
    Object.assign(input.form, {'defaultPerms[public][0]': 'ACCESS_VIEW', 'defaultPerms[public][1]': 'ITEM_ADD'});
    const resource = await createResourceViaForm(request, input);
    expect((await request.post(`/api/drivers/${resource.id}/items`, {
        data: {title: 'Submitted ride title', description: 'Airport pickup', maxAssignees: '2'},
    })).status()).toBe(200);
    expect((await request.post(`/api/drivers/${resource.id}/items`, {
        data: {title: 'Another submitted title', description: 'Station pickup', maxAssignees: '1'},
    })).status()).toBe(200);
    return resource;
}

async function readDrivers(request: APIRequestContext, id: string): Promise<DriversView> {
    const response = await request.get(`/api/v1/drivers-lists/${id}`, {headers: await apiHeaders(request)});
    expect(response.status()).toBe(200);
    return response.json() as Promise<DriversView>;
}

/** Observe the generated command through the actual integrated application;
 * a visible update alone could hide a document submission or wrong endpoint. */
async function command(page: Page, id: string, suffix: string, method: string,
    act: () => Promise<unknown>, status = 200): Promise<void> {
    const response = page.waitForResponse(result => result.request().method() === method
        && new URL(result.url()).pathname === `/api/v1/drivers-lists/${id}${suffix}`);
    await act();
    expect((await response).status()).toBe(status);
}

/** Preserve screenshots and measured controls, then enforce every measurement
 * with the existing complete-content and one-pixel geometry comparator. */
async function presentation(page: Page, info: TestInfo, name: string, surface: Locator,
    selectors: string[], focus?: Locator) {
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(function releaseFocus() {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    });
    if (focus) await focus.focus();
    await page.mouse.move(0, 0);
    const path = info.outputPath(name + '.png');
    // Focusing Take can horizontally scroll a native overflow table. Capture
    // that fixed visible viewport; measuring the full table below still protects
    // every original control/style/relative box without changing its assertions.
    const captureSurface = focus ? page.locator('main .table-responsive').first() : surface;
    await captureSurface.screenshot({path, animations: 'disabled'});
    await info.attach(name, {path, contentType: 'image/png'});
    const measured = await readVisiblePresentation(surface, selectors);
    await info.attach(name + '-presentation', {body: JSON.stringify(measured, null, 2), contentType: 'application/json'});
    return measured;
}

for (const width of [1280, 390]) {
    test(`compares native Drivers creation, ride table, passenger controls and quick add at ${width}px`, async ({page}, info) => {
        await page.setViewportSize({width, height: 900});
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        const resource = await driversFixture(page.request);
        const view = await readDrivers(page.request, resource.id);
        const item = view.items[0];
        expect((await page.request.post(`/api/drivers/${resource.id}/assign`, {data: {itemId: item.id}})).status()).toBe(200);
        await page.request.get('/users/profile');
        const native: Record<string, Awaited<ReturnType<typeof readVisiblePresentation>>> = {};

        for (const pilot of [false, true]) {
            const prefix = pilot ? '/frontend-pilot' : '';
            const label = pilot ? 'vue' : 'native';
            await page.goto(`${prefix}/drivers/create?locale=en`, {waitUntil: 'domcontentloaded'});
            if (pilot) await waitForPilotHydration(page);
            const creation = await presentation(page, info, label + '-drivers-create', page.locator('main form').first(),
                ['label', 'input:not([type="hidden"])', 'textarea', 'select', 'th', 'td', 'button']);
            if (pilot) expectVisiblePresentation(native.creation!, creation);
            else native.creation = creation;

            await page.goto(`${prefix}${resource.path}?locale=en`, {waitUntil: 'domcontentloaded'});
            if (pilot) await waitForPilotHydration(page);
            const table = page.locator('main table');
            await expect(table.locator('tbody tr')).toHaveCount(2);
            const detail = await presentation(page, info, label + '-drivers-table', table, ['th', 'td', 'li', 'button']);
            const quick = await presentation(page, info, label + '-drivers-quick-add',
                page.locator(pilot ? 'form:has(input[readonly])' : '#quickAddForm'), ['label', 'input', 'button']);
            const counters = await presentation(page, info, label + '-drivers-counters',
                page.locator('main .d-flex.justify-content-between.align-items-center.mb-3').first(), ['span', 'i']);
            const focused = await presentation(page, info, label + '-drivers-focused', table, ['th', 'td', 'li', 'button'],
                table.getByRole('button', {name: 'Take', exact: true}).first());
            if (pilot) {
                expectVisiblePresentation(native.table!, detail);
                expectVisiblePresentation(native.quick!, quick);
                expectVisiblePresentation(native.counters!, counters);
                expectVisiblePresentation(native.focused!, focused);
            } else {
                native.table = detail;
                native.quick = quick;
                native.counters = counters;
                native.focused = focused;
            }
            // The native reference deliberately scrolls the table inside its
            // container. Its columns must not force the whole document wider.
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
            expect(await table.locator('thead').innerText()).not.toMatch(/Packed|Everyone/u);
        }
        expect(errors).toEqual([]);
    });
}

test('creates and duplicates Drivers through multipart SPA commands with shared settings and an empty copied ride list', async ({page}) => {
    await loginForE2E(page.request, createE2ELogin());
    const title = `P3 SPA create ${randomUUID().slice(0, 8)}`;
    await page.goto('/frontend-pilot?locale=en', {waitUntil: 'domcontentloaded'});
    await waitForPilotHydration(page);
    await page.evaluate(() => {document.documentElement.dataset.pilotDocument = 'drivers-create';});
    const navigation: string[] = [];
    page.on('request', request => {
        if (request.isNavigationRequest() && request.frame() === page.mainFrame()) navigation.push(request.url());
    });
    await page.getByRole('button', {name: 'New', exact: true}).click();
    await page.getByRole('link', {name: 'Drivers list', exact: true}).click();
    await expect(page).toHaveURL('/frontend-pilot/drivers/create');
    await page.locator('#create-title').fill(title);
    await page.locator('#create-description').fill('Shared airport rides');
    await page.locator('#create-header').setInputFiles('src/public/img/logo.png');
    const created = page.waitForResponse(response => response.request().method() === 'POST'
        && new URL(response.url()).pathname === '/api/v1/drivers-lists');
    await page.getByRole('button', {name: 'Create list', exact: true}).click();
    expect((await created).status()).toBe(201);
    await expect(page).toHaveURL(/\/frontend-pilot\/drivers\/[a-f0-9-]+$/u);
    const id = new URL(page.url()).pathname.split('/').pop()!;
    await expect(page.getByRole('heading', {name: title, exact: true})).toBeVisible();
    const detail = await readDrivers(page.request, id);
    expect(detail).toMatchObject({title, description: 'Shared airport rides', items: [], headerUrl: `/api/v1/drivers-lists/${id}/header`});
    expect((await page.request.get(detail.headerUrl!, {headers: await apiHeaders(page.request)})).status()).toBe(200);
    // The creation upload and later settings upload use distinct generated
    // adapters. Check replacement, stale review and deletion against real bytes.
    const headerBaseline = await (await page.request.get(`/api/v1/drivers-lists/${id}/header/edit-baseline`,
        {headers: await apiHeaders(page.request)})).json() as components['schemas']['DriversHeaderBaseline'];
    const image = readFileSync('src/public/img/logo.png');
    expect((await page.request.put(`/api/v1/drivers-lists/${id}/header`, {
        headers: {...await apiHeaders(page.request), 'If-Match': headerBaseline.editToken},
        multipart: {image: {name: 'replacement.png', mimeType: 'image/png', buffer: image}},
    })).status()).toBe(200);
    expect((await page.request.get(`/drivers/${id}/header`)).status()).toBe(200);
    expect(await (await page.request.get(detail.headerUrl!, {headers: await apiHeaders(page.request)})).body()).toEqual(image);
    expect((await page.request.delete(`/api/v1/drivers-lists/${id}/header`, {
        headers: {...await apiHeaders(page.request), 'If-Match': headerBaseline.editToken},
    })).status()).toBe(412);
    const replacement = await (await page.request.get(`/api/v1/drivers-lists/${id}/header/edit-baseline`,
        {headers: await apiHeaders(page.request)})).json() as components['schemas']['DriversHeaderBaseline'];
    expect((await page.request.delete(`/api/v1/drivers-lists/${id}/header`, {
        headers: {...await apiHeaders(page.request), 'If-Match': replacement.editToken},
    })).status()).toBe(200);
    expect((await readDrivers(page.request, id)).headerUrl).toBeNull();
    expect((await page.request.get(`/drivers/${id}/header`)).status()).toBe(404);
    await page.locator('#quick-description').fill('Original offered ride');
    await command(page, id, '/items', 'POST', () => page.getByRole('button', {name: 'Add', exact: true}).click(), 201);
    expect((await readDrivers(page.request, id)).items).toHaveLength(1);

    await page.getByRole('button', {name: 'Entity settings', exact: true}).click();
    const settings = page.getByRole('dialog');
    await expect(settings).toBeVisible();
    await settings.getByRole('tab', {name: 'Actions', exact: true}).click();
    await settings.getByRole('link', {name: 'Duplicate', exact: true}).click();
    await expect(page).toHaveURL(`/frontend-pilot/drivers/${id}/duplicate`);
    await expect(page.locator('#create-title')).toHaveValue(title);
    await expect(page.locator('#create-header')).toHaveValue('');
    await page.locator('#create-title').fill(`${title} copy`);
    const duplicated = page.waitForResponse(response => response.request().method() === 'POST'
        && new URL(response.url()).pathname === '/api/v1/drivers-lists');
    await page.getByRole('button', {name: 'Create list', exact: true}).click();
    expect((await duplicated).status()).toBe(201);
    await expect(page).toHaveURL(/\/frontend-pilot\/drivers\/[a-f0-9-]+$/u);
    const copyId = new URL(page.url()).pathname.split('/').pop()!;
    expect(copyId).not.toBe(id);
    expect(await readDrivers(page.request, copyId)).toMatchObject({title: `${title} copy`, description: detail.description,
        items: [], headerUrl: null, currentEventId: null, archived: false});
    const native = await page.request.get(`/drivers/${copyId}`);
    expect(native.status()).toBe(200);
    expect(await native.text()).toContain(`${title} copy`);
    expect(await page.evaluate(() => document.documentElement.dataset.pilotDocument)).toBe('drivers-create');
    expect(navigation).toEqual([]);
});

test('offers, edits, reorders and removes rides and passenger places in the same document', async ({page, browser, baseURL}) => {
    test.setTimeout(60_000);
    const resource = await driversFixture(page.request);
    await page.goto(`/frontend-pilot${resource.path}?locale=en`, {waitUntil: 'domcontentloaded'});
    await waitForPilotHydration(page);
    await page.evaluate(() => {document.documentElement.dataset.pilotDocument = 'drivers-commands';});
    const navigation: string[] = [];
    page.on('request', request => {
        if (request.isNavigationRequest() && request.frame() === page.mainFrame()) navigation.push(request.url());
    });
    const initial = await readDrivers(page.request, resource.id);
    expect(initial.counters).toEqual({participants: 0, open: 2, empty: 2});
    expect(initial.items[0].driverName).toBe(initial.items[1].driverName);
    const first = initial.items[0];
    const second = initial.items[1];
    const row = page.locator(`tr[data-item-id="${first.id}"]`);
    await command(page, resource.id, `/items/${first.id}/self-assignment`, 'PUT',
        () => row.getByRole('button', {name: 'Take', exact: true}).click());
    await expect(row.locator('td').nth(3)).toHaveText('1 / 2');
    const secondRow = page.locator(`tr[data-item-id="${second.id}"]`);
    await command(page, resource.id, `/items/${second.id}/self-assignment`, 'PUT',
        () => secondRow.getByRole('button', {name: 'Take', exact: true}).click());
    expect((await readDrivers(page.request, resource.id)).counters.participants).toBe(1);
    await command(page, resource.id, `/items/${second.id}/self-assignment`, 'DELETE',
        () => secondRow.locator('td').last().getByRole('button', {name: 'Remove', exact: true}).click());

    await row.locator('td').nth(1).dblclick();
    const description = row.getByRole('textbox', {name: 'Description', exact: true});
    await description.fill('Changed airport pickup');
    await command(page, resource.id, `/items/${first.id}`, 'PATCH', () => description.press('Enter'));
    await expect(row.locator('td').nth(1)).toHaveText('Changed airport pickup');
    await row.locator('td').nth(3).dblclick();
    const capacity = row.getByRole('spinbutton', {name: 'Assigned / Max', exact: true});
    await capacity.fill('3');
    await command(page, resource.id, `/items/${first.id}`, 'PATCH', () => capacity.press('Enter'));
    await expect(row.locator('td').nth(3)).toHaveText('1 / 3');

    await secondRow.locator('xpath=ancestor::table').evaluate(function positionDragTable(table) {
        table.scrollIntoView({block: 'center', behavior: 'instant'});
    });
    await expect(secondRow).toBeInViewport({ratio: 1});
    await expect(row).toBeInViewport({ratio: 1});
    await command(page, resource.id, '/item-order', 'PUT', () => secondRow.dragTo(row, {
        sourcePosition: {x: 5, y: 5}, targetPosition: {x: 25, y: 5},
    }));
    expect((await readDrivers(page.request, resource.id)).items.map(item => item.id)).toEqual([second.id, first.id]);

    const guest = await browser.newContext({baseURL});
    try {
        const name = `P3 guest ${randomUUID().slice(0, 8)}`;
        const guestPage = await guest.newPage();
        await guestPage.goto(`/frontend-pilot${resource.path}?locale=en`, {waitUntil: 'domcontentloaded'});
        await waitForPilotHydration(guestPage);
        await expect(guestPage).toHaveURL(`/frontend-pilot${resource.path}/guest?locale=en`);
        await expect(guestPage.getByRole('heading', {name: `Join «${resource.title}»`, exact: true})).toBeVisible();
        await guestPage.evaluate(() => {document.documentElement.dataset.pilotDocument = 'drivers-guest';});
        const guestNavigation: string[] = [];
        guestPage.on('request', request => {
            if (request.isNavigationRequest() && request.frame() === guestPage.mainFrame()) guestNavigation.push(request.url());
        });
        await guestPage.locator('#guest-name').fill(name);
        await command(guestPage, resource.id, '/guest', 'POST',
            () => guestPage.getByRole('button', {name: 'Continue as guest', exact: true}).click());
        await expect(guestPage).toHaveURL(`/frontend-pilot${resource.path}`);
        await expect(guestPage.locator('main table')).toBeVisible();
        expect(await guestPage.evaluate(() => document.documentElement.dataset.pilotDocument)).toBe('drivers-guest');
        expect(guestNavigation).toEqual([]);
        expect((await guest.request.put(`/api/v1/drivers-lists/${resource.id}/items/${first.id}/self-assignment`,
            {headers: await apiHeaders(guest.request)})).status()).toBe(200);
        await page.getByRole('button', {name: 'Refresh', exact: true}).click();
        await expect(row.locator('td').nth(2)).toContainText(name);
        const assigned = (await readDrivers(page.request, resource.id)).items.find(item => item.id === first.id)!
            .assignees.find(assignee => assignee.name === name)!;
        await command(page, resource.id, `/assignments/${assigned.assignmentId}`, 'DELETE',
            () => row.locator('li').filter({hasText: name}).getByRole('button', {name: 'Remove', exact: true}).click());
        expect((await readDrivers(guest.request, resource.id)).items.find(item => item.id === first.id)?.selfAssigned).toBe(false);
    } finally { await guest.close(); }

    page.once('dialog', dialog => dialog.accept());
    await command(page, resource.id, `/items/${second.id}`, 'DELETE',
        () => secondRow.getByRole('button', {name: 'Delete item', exact: true}).click());
    await expect(secondRow).toHaveCount(0);
    expect((await readDrivers(page.request, resource.id)).items).toHaveLength(1);
    expect(await page.evaluate(() => document.documentElement.dataset.pilotDocument)).toBe('drivers-commands');
    expect(navigation).toEqual([]);
});

test('opens and creates Drivers from Event children and returns through Overview without replacing the document', async ({page}) => {
    const event = await createFrontendEventFixture(page.request);
    const input = createE2EDriversList();
    input.title = input.form.title = `Event linked rides ${randomUUID().slice(0, 8)}`;
    input.createPath += '?eventId=' + event.id;
    Object.assign(input.form, {event_id: event.id});
    const resource = await createResourceViaForm(page.request, input);
    await page.goto(`/frontend-pilot/event/${event.id}/admin?locale=en`, {waitUntil: 'domcontentloaded'});
    await waitForPilotHydration(page);
    await page.evaluate(() => {document.documentElement.dataset.pilotDocument = 'drivers-context';});
    const navigation: string[] = [];
    page.on('request', request => {
        if (request.isNavigationRequest() && request.frame() === page.mainFrame()) navigation.push(request.url());
    });
    await page.getByRole('button', {name: /Event drivers lists/u}).click();
    const child = page.getByRole('link', {name: resource.title, exact: true});
    await expect(child).toHaveAttribute('href', `/frontend-pilot${resource.path}`);
    await child.click();
    await expect(page).toHaveURL(`/frontend-pilot${resource.path}`);
    await expect(page.getByRole('heading', {name: resource.title, exact: true})).toBeVisible();
    await page.locator(`main a[href="/frontend-pilot/event/${event.id}"]`).first().click();
    await expect(page).toHaveURL(`/frontend-pilot/event/${event.id}`);
    await page.locator(`main a[href="/frontend-pilot/event/${event.id}/admin"]`).click();
    await expect(page).toHaveURL(`/frontend-pilot/event/${event.id}/admin`);
    await page.getByRole('button', {name: /Event drivers lists/u}).click();
    await page.getByRole('link', {name: 'Create new drivers list', exact: true}).click();
    await expect(page).toHaveURL(`/frontend-pilot/drivers/create?eventId=${event.id}`);
    const title = `Event SPA rides ${randomUUID().slice(0, 8)}`;
    await page.locator('#create-title').fill(title);
    const created = page.waitForResponse(response => response.request().method() === 'POST'
        && new URL(response.url()).pathname === '/api/v1/drivers-lists');
    await page.getByRole('button', {name: 'Create list', exact: true}).click();
    expect((await created).status()).toBe(201);
    await expect(page).toHaveURL(/\/frontend-pilot\/drivers\/[a-f0-9-]+$/u);
    const id = new URL(page.url()).pathname.split('/').pop()!;
    expect((await readDrivers(page.request, id)).currentEventId).toBe(event.id);
    await page.getByRole('button', {name: 'Overview', exact: true}).click();
    await page.getByRole('link', {name: 'Your overview', exact: true}).click();
    const owner = page.locator('[data-collection="owner"][data-region="main"]');
    await owner.locator(`[data-overview-event="${event.id}"]`).click();
    const card = owner.locator(`[data-id="${id}"]`);
    await expect(card).toBeVisible();
    await card.getByRole('link', {name: title, exact: true}).click();
    await expect(page).toHaveURL(`/frontend-pilot/drivers/${id}`);
    expect(await page.evaluate(() => document.documentElement.dataset.pilotDocument)).toBe('drivers-context');
    expect(navigation).toEqual([]);
});
