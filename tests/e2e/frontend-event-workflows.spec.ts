import {expect, test} from '@playwright/test';
import type {APIRequestContext, Locator, Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import type {components} from '../../src/types/api/v1';
import {createFrontendEventFixture, frontendEventHeaders} from '../keywords/frontendEventE2EKeywords';
import {closeModalForE2E, openModalForE2E} from '../keywords/e2eCoreKeywords';
import {waitForPilotHydration} from '../keywords/frontendDynamicKeywords';
import {PERM} from '../../src/modules/lib/permissions';

/** Seed attendance through the unchanged native operation, independently of the
 * Vue control being exercised. Each test owns a separately created Event. */
async function registerParticipant(request: APIRequestContext, id: string, allergyNotes = 'Peanuts'): Promise<void> {
    const response = await request.post(`/api/event/${id}/register`, {data: {
        arrivalDate: '2030-06-01', departureDate: '2030-06-04',
        dietary: ['VEGAN', 'ALLERGIES', 'COMMENT'], allergyNotes, dietComment: 'No tomatoes',
    }});
    expect(response.status()).toBe(200);
}

/** Inspect persisted results through the independently admitted current projection. */
async function eventView(request: APIRequestContext, id: string): Promise<components['schemas']['EventView']> {
    const response = await request.get(`/api/v1/events/${id}`, {headers: await frontendEventHeaders(request)});
    expect(response.status()).toBe(200);
    return response.json();
}

/** Open the actual shared settings control after client initialization. No test
 * document, component replacement or HTTP interception supplies the presentation. */
async function openSettings(page: Page): Promise<Locator> {
    await page.getByRole('button', {name: 'Entity settings', exact: true}).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('tab', {name: 'General', exact: true})).toBeVisible();
    return dialog;
}

/** Native settings are a distinct production consumer of the same business owner. */
async function nativeSettings(request: APIRequestContext, id: string, data: Record<string, unknown>): Promise<void> {
    expect((await request.post(`/api/event/${id}/settings`, {data})).status()).toBe(200);
}

/** Property changes use the native metadata operation; the independent settings
 * endpoint above owns permission defaults and intentionally ignores these fields. */
async function nativeMetadata(request: APIRequestContext, id: string, data: Record<string, unknown>): Promise<void> {
    expect((await request.post(`/api/event/${id}/update`, {data})).status()).toBe(200);
}

test('preserves native local deadline meaning across winter, summer and DST boundaries', async ({page}) => {
    test.setTimeout(90_000);
    const event = await createFrontendEventFixture(page.request);
    const nativeInstants: Array<string | null> = [];
    const dates = ['2030-01-15T12:30', '2030-06-15T12:30', '2030-03-31T03:30', '2030-10-27T02:30'];
    for (const pilot of [false, true]) {
        for (const [index, localDeadline] of dates.entries()) {
            // Reset through the shared native property operation. Each frontend
            // must deliberately select the zone and save its own visible draft.
            await nativeMetadata(page.request, event.id, {bindingDeadline: null, deadlineTz: 'UTC'});
            await page.goto(`${pilot ? '/frontend-pilot' : ''}/event/${event.id}?locale=en`, {waitUntil: 'domcontentloaded'});
            if (pilot) await waitForPilotHydration(page);
            const modal = page.locator('#entityPropertiesModal');
            let dialog: Locator;
            if (pilot) dialog = await openSettings(page);
            else {
                await openModalForE2E(modal, page.getByRole('button', {name: 'Entity settings', exact: true}));
                dialog = modal.locator('.modal-content');
            }
            await dialog.locator('summary').filter({hasText: /^Dates and time$/u}).click();
            await dialog.locator('[name="bindingDeadline"]').fill(localDeadline);
            await dialog.getByRole('button', {name: 'Time zone', exact: true}).click();
            await dialog.getByLabel('Search time zones', {exact: true}).fill('Europe/Berlin');
            await dialog.locator('ul button').filter({hasText: /^Europe\/Berlin /u}).click();
            await expect(dialog.locator('[name="deadlineTz"]')).toHaveValue('Europe/Berlin');

            const saved = page.waitForResponse(response => response.request().method() === (pilot ? 'PATCH' : 'POST')
                && new URL(response.url()).pathname === (pilot ? `/api/v1/events/${event.id}/metadata` : `/api/event/${event.id}/update`));
            const navigation = pilot ? Promise.resolve() : page.waitForEvent('load');
            await dialog.getByRole('button', {name: 'Save properties', exact: true}).click();
            expect((await saved).status()).toBe(200);
            await navigation;
            const view = await eventView(page.request, event.id);
            if (pilot) expect(view.bindingDeadline).toBe(nativeInstants[index]);
            else nativeInstants.push(view.bindingDeadline);

            // Reopen from the current server projection, proving local display
            // survives the round trip. The ambiguous autumn choice intentionally
            // compares the shared native result rather than inventing a new rule.
            if (pilot) {
                await dialog.getByRole('button', {name: 'Close', exact: true}).last().click();
                dialog = await openSettings(page);
            } else {
                await expect(modal).not.toBeVisible();
                await openModalForE2E(modal, page.getByRole('button', {name: 'Entity settings', exact: true}));
            }
            await dialog.locator('summary').filter({hasText: /^Dates and time$/u}).click();
            await expect(dialog.locator('[name="bindingDeadline"]')).toHaveValue(localDeadline);
            await expect(dialog.locator('[name="deadlineTz"]')).toHaveValue('Europe/Berlin');
            if (pilot) await dialog.getByRole('button', {name: 'Close', exact: true}).last().click();
            else await closeModalForE2E(modal);
        }
    }
    expect(nativeInstants.slice(0, 3)).toEqual(['2030-01-15T11:30:00.000Z', '2030-06-15T10:30:00.000Z', '2030-03-31T01:30:00.000Z']);
});

test('cancels a registration through the mounted native and Vue controls', async ({page}) => {
    const event = await createFrontendEventFixture(page.request);
    for (const pilot of [false, true]) {
        await registerParticipant(page.request, event.id);
        await page.goto(`${pilot ? '/frontend-pilot' : ''}/event/${event.id}?locale=en`, {waitUntil: 'domcontentloaded'});
        if (pilot) await waitForPilotHydration(page);
        await expect(page.getByText('Your registration', {exact: true})).toBeVisible();

        // Confirming the actual browser dialog must issue one deliberate command.
        const cancelled = page.waitForResponse(response => response.request().method() === (pilot ? 'DELETE' : 'POST')
            && new URL(response.url()).pathname === (pilot ? `/api/v1/events/${event.id}/registration` : `/api/event/${event.id}/register/delete`));
        page.once('dialog', confirmation => confirmation.accept());
        await page.locator('#cancelRegistrationBtn').click();
        expect((await cancelled).status()).toBe(200);
        await expect(page.getByText('Register for this event', {exact: true})).toBeVisible();
        expect((await eventView(page.request, event.id)).registration).toBeNull();
    }
});

test('creates, copies and revokes a link through the organizer controls', async ({page, context}) => {
    const event = await createFrontendEventFixture(page.request);
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto(`/frontend-pilot/event/${event.id}/admin?locale=en`, {waitUntil: 'domcontentloaded'});
    await waitForPilotHydration(page);
    const links = page.locator('.reg-links');
    await links.locator('.accordion-button').click();
    await expect(links).toContainText('No links');
    await links.getByRole('button', {name: 'Create link', exact: true}).click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('input[type="number"]').fill('1');
    await dialog.locator('input[type="datetime-local"]').fill('2030-05-31T12:00');
    await dialog.getByRole('button', {name: 'Create', exact: true}).click();
    await expect(dialog).not.toBeVisible();
    await expect(links.locator('tbody code')).toHaveCount(1);

    const token = (await links.locator('tbody code').innerText()).trim();
    await links.getByRole('button', {name: 'Copy', exact: true}).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain(`regToken=${token}`);
    page.once('dialog', confirmation => confirmation.accept());
    await links.getByRole('button', {name: 'Revoke', exact: true}).click();
    await expect(links.locator('tbody .badge')).toHaveText('Revoked');
    await expect(links.getByRole('button', {name: 'Copy', exact: true})).toBeDisabled();
});

test('refreshes open notes from the admitted roster and removes a participant through the browser', async ({page}) => {
    const event = await createFrontendEventFixture(page.request);
    await registerParticipant(page.request, event.id);
    await page.clock.install();
    await page.goto(`/frontend-pilot/event/${event.id}/admin?locale=en`, {waitUntil: 'domcontentloaded'});
    await waitForPilotHydration(page);
    const roster = page.locator('.event-participants');
    await roster.locator('.accordion-button').click();
    await roster.getByRole('button', {name: 'Details', exact: true}).click();
    const notes = page.getByRole('dialog');
    await expect(notes).toContainText('Peanuts');

    // Advance the browser's ordinary refresh timer, keeping the actual integrated
    // HTTP read, session admission and persistence. No response is manufactured.
    await registerParticipant(page.request, event.id, 'Lactose');
    const refreshed = page.waitForResponse(response => new URL(response.url()).pathname === `/api/v1/events/${event.id}/participants`
        && response.request().method() === 'GET');
    await page.clock.fastForward(34_000);
    expect((await refreshed).status()).toBe(200);
    await expect(notes).toContainText('Lactose');
    await expect(notes).not.toContainText('Peanuts');
    await notes.getByRole('button', {name: 'Close', exact: true}).click();

    page.once('dialog', confirmation => confirmation.accept());
    await roster.getByRole('button', {name: 'Delete', exact: true}).click();
    await expect(roster).toContainText('No participants');
    expect((await eventView(page.request, event.id)).registrationCount).toBe(0);
});

test('saves group and named permissions through the shared Event access editor', async ({page}) => {
    const event = await createFrontendEventFixture(page.request);
    await page.goto(`/frontend-pilot/event/${event.id}?locale=en`, {waitUntil: 'domcontentloaded'});
    await waitForPilotHydration(page);
    const dialog = await openSettings(page);
    await dialog.getByRole('tab', {name: 'Access', exact: true}).click();
    const defaults = dialog.locator('#pilot-access-defaults');
    await defaults.locator('select').first().selectOption('public');
    await defaults.locator('input[id$="-ACCESS_PARTICIPANTS"]').check();
    await defaults.getByRole('button', {name: 'Update permissions', exact: true}).click();
    await expect.poll(async () => {
        const response = await page.request.get(`/api/v1/events/${event.id}/settings`, {headers: await frontendEventHeaders(page.request)});
        const data = await response.json() as components['schemas']['EventSettings'];
        return !!(data.access!.defaults.public & PERM.ACCESS_PARTICIPANTS);
    }).toBe(true);

    // Create the target through the actual profile command. Search by its unique
    // name, then choose the returned username: discovery retains that admitted
    // result set when a datalist value is selected, including multi-profile users.
    const profileName = `P2 delegate ${randomUUID().slice(0, 8)}`;
    expect((await page.request.post('/api/v1/profiles', {
        headers: await frontendEventHeaders(page.request), data: {name: profileName},
    })).status()).toBe(200);
    const profileResponse = await page.request.get('/api/v1/profiles', {headers: await frontendEventHeaders(page.request)});
    expect(profileResponse.status()).toBe(200);
    const ownProfiles = await profileResponse.json() as components['schemas']['ProfileManagement'];
    const profileId = ownProfiles.profiles.find(profile => profile.name === profileName)!.id;
    await dialog.getByRole('tab', {name: 'Administrators', exact: true}).click();
    await dialog.getByRole('button', {name: 'Add', exact: true}).click();
    await dialog.locator('#profile-search').fill(profileName);
    const option = dialog.locator('datalist option');
    await expect(option).toHaveCount(1);
    const username = (await option.getAttribute('value'))!;
    expect(await option.getAttribute('label')).toContain(profileName);
    await dialog.locator('#profile-search').fill(username);
    await dialog.locator('#initial-preset').selectOption('DEFAULT_ENTITY');
    const add = dialog.locator('form:has(#profile-search)');
    await add.getByRole('button', {name: 'Add', exact: true}).click();
    const administrator = dialog.locator('[data-entity-section="administrator"]').filter({hasText: profileName});
    await expect(administrator).toBeVisible();
    await administrator.locator('.accordion-button').click();
    await administrator.locator('input[id$="-ACCESS_PARTICIPANTS"]').check();
    await administrator.getByRole('button', {name: 'Save', exact: true}).click();
    await expect.poll(async function savedAdministratorPermission() {
        const response = await page.request.get(`/api/v1/events/${event.id}/settings`, {headers: await frontendEventHeaders(page.request)});
        expect(response.status()).toBe(200);
        const settings = await response.json() as components['schemas']['EventSettings'];
        return !!(settings.access!.admins.find(admin => admin.profileId === profileId)!.mask & PERM.ACCESS_PARTICIPANTS);
    }).toBe(true);
    page.once('dialog', confirmation => confirmation.accept());
    await administrator.getByRole('button', {name: 'Remove', exact: true}).click();
    await expect(administrator).toHaveCount(0);
});

test('uploads, displays and removes an image, then archives, restores, schedules and deletes through settings', async ({page}) => {
    const event = await createFrontendEventFixture(page.request);
    await page.goto(`/frontend-pilot/event/${event.id}?locale=en`, {waitUntil: 'domcontentloaded'});
    await waitForPilotHydration(page);
    let dialog = await openSettings(page);
    const image = dialog.locator('[data-entity-section="image"]');
    await image.locator('summary').click();
    await image.locator('input[type="file"]').setInputFiles('src/public/img/logo.png');
    await image.getByRole('button', {name: 'Upload', exact: true}).click();
    await expect(image.locator('input[type="file"]')).toHaveValue('');
    await expect(image.getByRole('button', {name: 'Remove image', exact: true})).toBeVisible();
    await dialog.getByRole('button', {name: 'Close', exact: true}).last().click();
    const header = page.locator('.card-header > img.card-img-top');
    await expect(header).toBeVisible();
    await expect(header).toHaveJSProperty('naturalWidth', 200);

    dialog = await openSettings(page);
    await dialog.locator('[data-entity-section="image"] summary').click();
    page.once('dialog', confirmation => confirmation.accept());
    await dialog.getByRole('button', {name: 'Remove image', exact: true}).click();
    await expect(dialog.getByRole('button', {name: 'Remove image', exact: true})).toHaveCount(0);
    await expect(header).toHaveCount(0);
    expect((await page.request.get(`/event/${event.id}/header`)).status()).toBe(404);
    await dialog.getByRole('tab', {name: 'Actions', exact: true}).click();
    page.once('dialog', confirmation => confirmation.accept());
    await dialog.getByRole('button', {name: 'Archive for everyone', exact: true}).click();
    await expect(dialog.getByRole('button', {name: 'Restore for everyone', exact: true})).toBeVisible();
    page.once('dialog', confirmation => confirmation.accept());
    await dialog.getByRole('button', {name: 'Restore for everyone', exact: true}).click();
    await expect(dialog.getByRole('button', {name: 'Resume automatic archival', exact: true})).toBeVisible();
    page.once('dialog', confirmation => confirmation.accept());
    await dialog.getByRole('button', {name: 'Resume automatic archival', exact: true}).click();
    await expect(dialog.getByRole('button', {name: 'Pause automatic archival', exact: true})).toBeVisible();
    await dialog.getByRole('button', {name: 'Pause automatic archival', exact: true}).click();
    await expect(dialog.getByRole('button', {name: 'Resume automatic archival', exact: true})).toBeVisible();
    expect((await eventView(page.request, event.id)).archive).toMatchObject({direct: false, autoArchivePaused: true});

    page.once('dialog', confirmation => confirmation.accept());
    await dialog.getByRole('button', {name: 'Delete permanently', exact: true}).click();
    await expect(page).toHaveURL(/\/frontend-pilot$/u);
    expect((await page.request.get(`/event/${event.id}`)).status()).toBe(404);
});

test('keeps deadline rejection drafts, admits independent exceptions and presents a full Event to another actor', async ({page, browser}) => {
    const event = await createFrontendEventFixture(page.request);
    await registerParticipant(page.request, event.id);
    await nativeMetadata(page.request, event.id, {bindingDeadline: '2000-01-01T00:00', deadlineTz: 'UTC',
        allowRegDateUpdatesAfterDeadline: false, allowRegDietUpdateAfterDeadline: false, allowRegCancelationAfterDeadline: false});
    expect((await eventView(page.request, event.id)).bindingDeadline).toBe('2000-01-01T00:00:00.000Z');
    await page.goto(`/frontend-pilot/event/${event.id}?locale=en`, {waitUntil: 'domcontentloaded'});
    await waitForPilotHydration(page);
    await page.locator('#departureDate').fill('2030-06-03');
    const rejected = page.waitForResponse(response => response.request().method() === 'PUT'
        && new URL(response.url()).pathname === `/api/v1/events/${event.id}/registration`);
    await page.getByRole('button', {name: 'Update', exact: true}).click();
    expect((await rejected).status()).toBe(403);
    await expect(page.locator('#departureDate')).toHaveValue('2030-06-03');
    expect((await eventView(page.request, event.id)).registration?.departureDate).toBe('2030-06-04');

    // Exercise the dietary exception independently; permitting it must not
    // implicitly permit dates or cancellation. A fresh read owns the saved draft.
    await nativeMetadata(page.request, event.id, {allowRegDietUpdateAfterDeadline: true});
    await page.reload({waitUntil: 'domcontentloaded'});
    await waitForPilotHydration(page);
    await page.locator('#allergyNotes').fill('Lactose');
    const dietaryUpdate = page.waitForResponse(response => response.request().method() === 'PUT'
        && new URL(response.url()).pathname === `/api/v1/events/${event.id}/registration`);
    await page.getByRole('button', {name: 'Update', exact: true}).click();
    expect((await dietaryUpdate).status()).toBe(200);
    expect((await eventView(page.request, event.id)).registration).toMatchObject({allergyNotes: 'Lactose', departureDate: '2030-06-04'});

    await nativeMetadata(page.request, event.id, {allowRegDateUpdatesAfterDeadline: true,
        allowRegDietUpdateAfterDeadline: false, allowRegCancelationAfterDeadline: true, maxParticipants: 1});
    await page.reload({waitUntil: 'domcontentloaded'});
    await waitForPilotHydration(page);
    await page.locator('#allergyNotes').fill('Rejected dietary change');
    const dietaryRejection = page.waitForResponse(response => response.request().method() === 'PUT'
        && new URL(response.url()).pathname === `/api/v1/events/${event.id}/registration`);
    await page.getByRole('button', {name: 'Update', exact: true}).click();
    expect((await dietaryRejection).status()).toBe(403);
    await expect(page.locator('#allergyNotes')).toHaveValue('Rejected dietary change');
    expect((await eventView(page.request, event.id)).registration?.allergyNotes).toBe('Lactose');
    await page.locator('#allergyNotes').fill('Lactose');
    await page.locator('#departureDate').fill('2030-06-03');
    const updated = page.waitForResponse(response => response.request().method() === 'PUT'
        && new URL(response.url()).pathname === `/api/v1/events/${event.id}/registration`);
    await page.getByRole('button', {name: 'Update', exact: true}).click();
    expect((await updated).status()).toBe(200);

    // A distinct guest observes capacity without inheriting owner privileges.
    const guestContext = await browser.newContext();
    try {
        const guest = await guestContext.newPage();
        await guest.goto(new URL(`/frontend-pilot/event/${event.id}?locale=en`, page.url()).href, {waitUntil: 'domcontentloaded'});
        await waitForPilotHydration(guest);
        await guest.locator('#guest-name').fill(`P2 full guest ${randomUUID().slice(0, 8)}`);
        await guest.getByRole('button', {name: 'Continue as guest', exact: true}).click();
        await expect(guest.getByText('This event is full.', {exact: true})).toBeVisible();
        await expect(guest.locator('#registrationForm')).toHaveCount(0);
    } finally {
        await guestContext.close();
    }
    page.once('dialog', confirmation => confirmation.accept());
    await page.getByRole('button', {name: 'Cancel registration', exact: true}).click();
    await expect(page.getByText('Register for this event', {exact: true})).toBeVisible();
    expect((await eventView(page.request, event.id)).registration).toBeNull();
});

test('keeps a pending registration draft and reconciles uncertain delivery without replaying its committed write', async ({page}) => {
    const event = await createFrontendEventFixture(page.request);
    await page.goto(`/frontend-pilot/event/${event.id}?locale=en`, {waitUntil: 'domcontentloaded'});
    await waitForPilotHydration(page);
    await page.locator('#arrivalDate').fill('2030-06-01');
    await page.locator('#departureDate').fill('2030-06-04');
    await page.locator('#diet-vegan').check();
    let releaseDelivery!: () => void;
    const delivery = new Promise<void>(resolve => { releaseDelivery = resolve; });
    let writes = 0;

    // The real built route/session/controller/database completes the command.
    // Only delivery of its produced response is lost; no application response or
    // persistence fixture is substituted to manufacture a successful workflow.
    await page.route(`**/api/v1/events/${event.id}/registration`, async function loseCommandDelivery(route) {
        if (route.request().method() !== 'PUT') return route.continue();
        writes++;
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        await delivery;
        await route.abort('failed');
    });
    try {
        await page.getByRole('button', {name: 'Save registration', exact: true}).click();
        await expect(page.locator('#arrivalDate')).toBeDisabled();
        await expect(page.getByRole('button', {name: 'Save registration', exact: true})).toBeDisabled();
        await expect(page.locator('#departureDate')).toHaveValue('2030-06-04');
        releaseDelivery();

        const refresh = page.locator('#registrationForm').locator('..').getByRole('button', {name: 'Refresh', exact: true});
        await expect(refresh).toBeVisible();
        await refresh.click();
        await expect(page.getByText('Your registration', {exact: true})).toBeVisible();
        await expect(page.locator('#departureDate')).toHaveValue('2030-06-04');
        expect(writes).toBe(1);
        expect((await eventView(page.request, event.id)).registrationCount).toBe(1);
    } finally {
        releaseDelivery();
        await page.unroute(`**/api/v1/events/${event.id}/registration`);
    }
});

test('honors anonymous method grants without changing profile-required operations or origin protection', async ({request, playwright, baseURL}) => {
    const event = await createFrontendEventFixture(request);
    await registerParticipant(request, event.id);
    const own = await eventView(request, event.id);
    const registrationId = own.registration!.id;
    const created = await request.post(`/api/v1/events/${event.id}/links`, {
        headers: await frontendEventHeaders(request), data: {maxUses: 1},
    });
    expect(created.status()).toBe(200);
    const link = await created.json() as components['schemas']['EventCreatedRegistrationLink'];
    const anonymous = await playwright.request.newContext({baseURL});
    try {
        const proof = await frontendEventHeaders(anonymous);
        const root = `/api/v1/events/${event.id}`;
        const dates = {arrivalDate: '2030-06-02', departureDate: '2030-06-04'};
        for (const path of ['/participants', '/links']) expect((await anonymous.get(root + path, {headers: proof})).status()).toBe(403);
        expect((await anonymous.patch(`${root}/registrations/${registrationId}`, {headers: proof, data: dates})).status()).toBe(403);
        expect((await anonymous.delete(`${root}/registrations/${registrationId}`, {headers: proof})).status()).toBe(403);
        expect((await anonymous.delete(`${root}/links/${link.id}`, {headers: proof})).status()).toBe(403);

        await nativeSettings(request, event.id, {defaultPerms: {public: ['ACCESS_PARTICIPANTS', 'MANAGE_REGISTRATIONS']}});
        for (const path of ['/participants', '/links']) {
            const response = await anonymous.get(root + path, {headers: proof});
            expect(response.status()).toBe(200);
            expect(response.headers()['set-cookie']).toBeUndefined();
        }
        expect((await anonymous.patch(`${root}/registrations/${registrationId}`, {
            headers: {...proof, Origin: 'https://unrelated.invalid'}, data: dates,
        })).status()).toBe(403);
        expect((await anonymous.patch(`${root}/registrations/${registrationId}`, {headers: proof, data: dates})).status()).toBe(200);
        expect((await eventView(request, event.id)).registration?.arrivalDate).toBe('2030-06-02');
        expect((await anonymous.delete(`${root}/links/${link.id}`, {headers: proof})).status()).toBe(200);
        expect((await anonymous.delete(`${root}/registrations/${registrationId}`, {headers: proof})).status()).toBe(200);
        expect((await eventView(request, event.id)).registrationCount).toBe(0);
        expect((await anonymous.get(root, {headers: proof})).status()).toBe(401);
        expect((await anonymous.post(`${root}/links`, {headers: proof, data: {maxUses: 1}})).status()).toBe(401);
        await nativeSettings(request, event.id, {defaultPerms: {public: []}});
        expect((await anonymous.get(root + '/participants', {headers: proof})).status()).toBe(403);
        expect((await anonymous.get(root + '/links', {headers: proof})).status()).toBe(403);
        expect((await anonymous.storageState()).cookies).toEqual([]);
    } finally {
        await anonymous.dispose();
    }
});
