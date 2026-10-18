import {expect, test, type APIRequestContext, type Locator, type Page, type TestInfo} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import type {components} from '../../src/types/api/v1';
import {createE2EDriversList, createE2ELogin} from '../factories/e2eCoreFactory';
import {closeModalForE2E, createResourceViaForm, expectVisiblePresentation, loginForE2E, readVisiblePresentation,
    withProfileWorkflowFixtureForE2E} from '../keywords/e2eCoreKeywords';
import {waitForPilotHydration} from '../keywords/frontendDynamicKeywords';
import {createFrontendEventFixture, frontendEventHeaders as apiHeaders} from '../keywords/frontendEventE2EKeywords';
import {captureDriversSettingsPresentation, createDriversSettingsFixture, exerciseDriversAdministratorForE2E, expectDriversSettingsPresentation,
    observeDriversSettingsCommand, openDriversSettingsForE2E, readDriversSettingsForE2E,
    selectDriversSettingsSurface} from '../keywords/frontendDriversE2EKeywords';
import {PERM} from '../../src/modules/lib/permissions';

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

    // The HTTP receipt precedes the protected follow-up read. A table cell is
    // not a disabled HTML control, so wait for both the resulting membership
    // and the shared command's enabled action before entering its inline editor.
    await expect(secondRow.locator('td').nth(3)).toHaveText('0 / 1');
    await expect(secondRow.getByRole('button', {name: 'Take', exact: true})).toBeEnabled();
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
        await expect(guestPage).toHaveTitle(`Join «${resource.title}»`);
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
    await expect(page).toHaveTitle(`Dashboard — ${event.title}`);
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
    await expect(page).toHaveTitle(`${event.title} | Event`);
    await page.locator(`main a[href="/frontend-pilot/event/${event.id}/admin"]`).click();
    await expect(page).toHaveURL(`/frontend-pilot/event/${event.id}/admin`);
    await expect(page).toHaveTitle(`Dashboard — ${event.title}`);
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
    await expect(page).toHaveTitle('My Dashboard | Surveyor');
    const owner = page.locator('[data-collection="owner"][data-region="main"]');
    // The shared account can own more than one bounded page of fixtures. Search
    // the exact new child before opening its parent instead of assuming that a
    // randomly named Event sorts onto the first page of the owner collection.
    await owner.getByRole('searchbox').fill(title);
    await owner.getByRole('searchbox').press('Enter');
    await owner.locator(`[data-overview-event="${event.id}"]`).click();
    const card = owner.locator(`[data-id="${id}"]`);
    await expect(card).toBeVisible();
    await card.getByRole('link', {name: title, exact: true}).click();
    await expect(page).toHaveURL(`/frontend-pilot/drivers/${id}`);
    expect(await page.evaluate(() => document.documentElement.dataset.pilotDocument)).toBe('drivers-context');
    expect(navigation).toEqual([]);
});

for (const width of [1280, 390]) {
    for (const surface of ['General', 'General with image controls', 'Linked event', 'Access', 'Administrators', 'Actions'] as const) {
        test(`Drivers settings ${surface} native/Vue parity at ${width}px`, async function compareDriversSettings({page}, info) {
            test.setTimeout(90_000);
            await page.setViewportSize({width, height: 900});
            const errors: string[] = [];
            page.on('pageerror', function captureBrowserError(error) { errors.push(error.message); });
            const {event, resource} = await createDriversSettingsFixture(page, surface === 'Linked event');
            const native = await openDriversSettingsForE2E(page, resource.path, false);
            await selectDriversSettingsSurface(native, page, surface, event);
            const original = await captureDriversSettingsPresentation(page, info, 'native-' + surface, native);
            await closeModalForE2E(page.locator('#entityPropertiesModal'));
            const pilot = await openDriversSettingsForE2E(page, resource.path, true);
            await selectDriversSettingsSurface(pilot, page, surface, event);
            const migrated = await captureDriversSettingsPresentation(page, info, 'vue-' + surface, pilot);
            expect(errors).toEqual([]);
            expectDriversSettingsPresentation(original, migrated, surface === 'Actions');
        });
    }
}

test('Drivers settings UI saves metadata, defaults, administrators, images, event linkage and lifecycle without document replacement', async function exerciseDriversSettings({page}) {
    test.setTimeout(150_000);
    const {event, resource} = await createDriversSettingsFixture(page);
    const dialog = await openDriversSettingsForE2E(page, resource.path, true);
    await page.evaluate(() => { document.documentElement.dataset.pilotDocument = 'drivers-settings-review'; });
    const navigation: string[] = [];
    page.on('request', function captureNavigation(request) {
        if (request.isNavigationRequest() && request.frame() === page.mainFrame()) navigation.push(request.url());
    });
    page.on('dialog', function confirmUserCommand(confirmation) { void confirmation.accept(); });

    // Metadata has an independent sparse command and retains the same dialog.
    const title = resource.title + ' edited';
    await dialog.locator('[name="title"]').fill(title);
    await dialog.locator('[name="description"]').fill('Updated through Drivers settings');
    const metadataReply = page.waitForResponse(function matchMetadata(response) {
        return response.request().method() === 'PATCH' && new URL(response.url()).pathname === `/api/v1/drivers-lists/${resource.id}/metadata`;
    });
    await dialog.getByRole('button', {name: 'Save properties', exact: true}).click();
    expect((await metadataReply).status()).toBe(200);
    await expect(page.locator('main h1')).toHaveText(title);
    await expect(dialog.locator('[name="title"]')).toBeEnabled();

    // A changed public audience proves this feature's injected default operation,
    // rather than only rendering a reused matrix with no production consumer.
    await dialog.getByRole('tab', {name: 'Access', exact: true}).click();
    const baseline = await readDriversSettingsForE2E(page.request, resource.id);
    const access = baseline.access!;
    await dialog.locator('.perm-matrix select').first().selectOption('public');
    const permission = access.permissions[0]!;
    const checkbox = dialog.locator(`.perm-matrix input[id$="-${permission.key}"]`);
    await checkbox.setChecked(!(access.defaults.public & permission.bit));
    await observeDriversSettingsCommand(page, resource.id, '/default-permissions', 'PUT', async function saveAudience() {
        await dialog.getByRole('button', {name: 'Update permissions', exact: true}).click();
    });
    expect((await readDriversSettingsForE2E(page.request, resource.id)).access!.defaults.public).toBe(access.defaults.public ^ permission.bit);

    // Shared-account profiles accumulate across the broad suite. A unique
    // existing account/profile fixture makes the discovered target unambiguous;
    // its owner cleans exact fixture IDs after the real UI removes the grant.
    await withProfileWorkflowFixtureForE2E(async function exerciseIndependentAdministrator(fixture) {
        await exerciseDriversAdministratorForE2E(page, resource.id, fixture.account);
    });

    // The actual file chooser supplies bytes to the feature's multipart adapter.
    await dialog.getByRole('tab', {name: 'General', exact: true}).click();
    await dialog.locator('summary').filter({hasText: /^Header image$/u}).click();
    const image = dialog.locator('[data-entity-section="image"]');
    await image.locator('input[type="file"]').setInputFiles('src/public/img/logo.png');
    await observeDriversSettingsCommand(page, resource.id, '/header', 'PUT', async function uploadImage() {
        await image.getByRole('button', {name: 'Upload', exact: true}).click();
    });
    expect((await readDriversSettingsForE2E(page.request, resource.id)).headerUrl).toBeTruthy();
    await observeDriversSettingsCommand(page, resource.id, '/header', 'DELETE', async function removeImage() {
        await image.getByRole('button', {name: 'Remove image', exact: true}).click();
    });
    expect((await readDriversSettingsForE2E(page.request, resource.id)).headerUrl).toBeNull();

    await dialog.getByRole('tab', {name: 'Linked event', exact: true}).click();
    await dialog.getByLabel('Search events', {exact: true}).fill(event.title);
    const choice = dialog.locator(`button[data-event-id="${event.id}"]`);
    await expect(choice).toBeVisible();
    await choice.click();
    await observeDriversSettingsCommand(page, resource.id, '/event', 'PUT', async function saveEvent() {
        await dialog.getByRole('button', {name: 'Save event link', exact: true}).click();
    });
    expect((await readDriversSettingsForE2E(page.request, resource.id)).currentEvent!.id).toBe(event.id);

    await dialog.getByRole('tab', {name: 'Actions', exact: true}).click();
    await observeDriversSettingsCommand(page, resource.id, '/archive', 'POST', async function archiveRoot() {
        await dialog.getByRole('button', {name: 'Archive for everyone', exact: true}).click();
    });
    expect((await readDriversSettingsForE2E(page.request, resource.id)).archive.direct).toBe(true);
    await observeDriversSettingsCommand(page, resource.id, '/restore', 'POST', async function restoreRoot() {
        await dialog.getByRole('button', {name: 'Restore for everyone', exact: true}).click();
    });
    expect((await readDriversSettingsForE2E(page.request, resource.id)).archive.direct).toBe(false);

    const removed = page.waitForResponse(function matchDeletion(response) {
        return response.request().method() === 'DELETE' && new URL(response.url()).pathname === `/api/v1/drivers-lists/${resource.id}`;
    });
    await dialog.getByRole('button', {name: 'Delete permanently', exact: true}).click();
    expect((await removed).status()).toBe(200);
    await expect(page).toHaveURL(/\/frontend-pilot$/u);
    expect((await page.request.get(`/drivers/${resource.id}`)).status()).toBe(404);
    expect(await page.evaluate(() => document.documentElement.dataset.pilotDocument)).toBe('drivers-settings-review');
    expect(navigation).toEqual([]);
});

for (const width of [1280, 390]) {
    test(`compares restricted Drivers actions and description-only settings at ${width}px`, async function compareRestrictedDrivers({page, browser, baseURL}, info) {
        test.setTimeout(90_000);
        const resource = await driversFixture(page.request);
        const original = await readDriversSettingsForE2E(page.request, resource.id);
        // Standalone page admission remains broader than assignment authority.
        // Clear only this unique fixture's audience grants, using the real owner.
        const changed = await page.request.put(`/api/v1/drivers-lists/${resource.id}/default-permissions`, {
            headers: {...await apiHeaders(page.request), 'If-Match': original.settingsToken},
            data: {participant: 0, guest: 0, authenticated: 0, public: 0},
        });
        expect(changed.status()).toBe(200);

        const restricted = await browser.newContext({baseURL, viewport: {width, height: 900}});
        try {
            const joined = await restricted.request.post(`${resource.path}/guest`, {
                form: {username: `P3 restricted ${randomUUID().slice(0, 8)}`, email: ''}, maxRedirects: 0,
            });
            expect(joined.status()).toBe(302);
            const participant = await restricted.newPage();
            const session = await (await restricted.request.get('/api/v1/session')).json() as components['schemas']['SessionView'];
            const deniedView = await readDrivers(restricted.request, resource.id);
            expect(deniedView.capabilities).toMatchObject({selfAssign: false, addItem: false, reorder: false, manageSettings: false});
            let nativeTable: Awaited<ReturnType<typeof readVisiblePresentation>> | undefined;

            for (const pilot of [false, true]) {
                await participant.goto(`${pilot ? '/frontend-pilot' : ''}${resource.path}?locale=en`, {waitUntil: 'domcontentloaded'});
                if (pilot) await waitForPilotHydration(participant);
                const table = participant.locator('main table');
                await expect(table.locator('tbody tr')).toHaveCount(2);
                await expect(participant.getByRole('button', {name: 'Entity settings', exact: true})).toHaveCount(0);
                await expect(participant.locator('main form:has(input[readonly])')).toHaveCount(0);
                await expect(table.locator('td[data-edit]')).toHaveCount(0);
                await expect(table.getByRole('button', {name: 'Delete item', exact: true})).toHaveCount(0);
                // Preserve the explicitly excluded native Take-control mismatch
                // (IMP-028), while proving its actual command remains forbidden.
                await expect(table.getByRole('button', {name: 'Take', exact: true})).toHaveCount(2);
                const measured = await presentation(participant, info, `${pilot ? 'vue' : 'native'}-restricted-table`, table,
                    ['th', 'td', 'li', 'button']);
                if (pilot) expectVisiblePresentation(nativeTable!, measured);
                else nativeTable = measured;
                const deniedPath = pilot ? `/api/v1/drivers-lists/${resource.id}/items/${deniedView.items[0].id}/self-assignment`
                    : `/api/drivers/${resource.id}/assign`;
                const rejected = participant.waitForResponse(function matchDeniedAssignment(response) {
                    return response.request().method() === (pilot ? 'PUT' : 'POST') && new URL(response.url()).pathname === deniedPath;
                });
                await table.getByRole('button', {name: 'Take', exact: true}).first().click();
                expect((await rejected).status()).toBe(403);
                expect((await readDrivers(restricted.request, resource.id)).items[0].assignedCount).toBe(0);
            }

            // One independently granted field must not reveal the owner-only
            // title, header, event, administrator or lifecycle controls.
            const baseline = await readDriversSettingsForE2E(page.request, resource.id);
            const grant = await page.request.post(`/api/v1/drivers-lists/${resource.id}/admins`, {
                headers: {...await apiHeaders(page.request), 'If-Match': baseline.settingsToken},
                data: {profileId: session.activeProfile!.id, mask: PERM.EDIT_DESC},
            });
            expect(grant.status()).toBe(200);
            const admitted = await readDriversSettingsForE2E(restricted.request, resource.id);
            expect(admitted.editableFields).toEqual(['description']);
            expect(admitted.access).toBeNull();
            let nativeSettings: Awaited<ReturnType<typeof readVisiblePresentation>> | undefined;
            for (const pilot of [false, true]) {
                const dialog = await openDriversSettingsForE2E(participant, resource.path, pilot, 'description');
                await expect(dialog.locator('[name="title"],input[type="file"],.perm-matrix')).toHaveCount(0);
                await expect(dialog.getByRole('tab')).toHaveCount(0);
                await expect(dialog.getByRole('button', {name: 'Delete permanently', exact: true})).toHaveCount(0);
                const measured = await captureDriversSettingsPresentation(participant, info,
                    `${pilot ? 'vue' : 'native'}-description-only-settings`, dialog);
                if (pilot) expectDriversSettingsPresentation(nativeSettings!, measured);
                else nativeSettings = measured;
                if (!pilot) await closeModalForE2E(participant.locator('#entityPropertiesModal'));
            }
        } finally {
            await restricted.close();
        }
    });

    test(`compares Drivers inherited Event archival actions at ${width}px`, async function compareInheritedDriversArchive({page}, info) {
        test.setTimeout(60_000);
        await page.setViewportSize({width, height: 900});
        const {event, resource} = await createDriversSettingsFixture(page, true);
        const archived = await page.request.post(`/api/v1/events/${event.id}/archive`, {headers: await apiHeaders(page.request)});
        expect(archived.status()).toBe(200);
        const state = await readDriversSettingsForE2E(page.request, resource.id);
        expect(state.archive).toMatchObject({direct: false, inherited: true});
        expect(state.capabilities.restore).toBe(false);
        let native: Awaited<ReturnType<typeof readVisiblePresentation>> | undefined;

        for (const pilot of [false, true]) {
            const dialog = await openDriversSettingsForE2E(page, resource.path, pilot);
            await selectDriversSettingsSurface(dialog, page, 'Actions', event);
            await expect(dialog.getByText('This entity is archived with its event. Restore the event before restoring this entity.', {exact: false})).toBeVisible();
            await expect(dialog.getByRole('button', {name: 'Restore for everyone', exact: true})).toHaveCount(0);
            await expect(dialog.getByRole('link', {name: 'Open event', exact: true})).toHaveAttribute('href',
                pilot ? state.archive.eventUrl! : state.archive.eventUrl!.replace(/^\/frontend-pilot/u, ''));
            const measured = await captureDriversSettingsPresentation(page, info, `${pilot ? 'vue' : 'native'}-inherited-actions`, dialog);
            if (pilot) expectDriversSettingsPresentation(native!, measured, true);
            else native = measured;
            if (!pilot) await closeModalForE2E(page.locator('#entityPropertiesModal'));
        }
    });
}
