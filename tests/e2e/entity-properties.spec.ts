import {expect, test, type Dialog, type Locator, type Page, type Route} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {
    createE2EActivityPlan, createE2EDriversList, createE2EEvent, createE2ELogin,
    createE2EPackingList, createE2ESurvey, type E2ECreateCase, type E2ECreateForm,
} from '../factories/e2eCoreFactory';
import {createResourceViaForm, loginForE2E} from '../keywords/e2eCoreKeywords';

async function openSettings(page: Page): Promise<Locator> {
    const button = page.getByRole('button', {name: 'Entity settings', exact: true});
    await expect(button).toHaveCount(1);
    await button.click();
    const modal = page.locator('#entityPropertiesModal');
    await expect(modal).toBeVisible();
    return modal;
}

/** Select a compartment only when the profile has more than one available panel. */
async function selectSettingsPanel(modal: Locator, name: string): Promise<void> {
    const tab = modal.getByRole('tab', {name, exact: true});
    if (await tab.count()) await tab.click();
}

/** Open an optional property family without toggling one that is already expanded. */
async function openPropertyGroup(modal: Locator, name: string): Promise<void> {
    const summary = modal.locator('.entity-property-group > summary').filter({hasText: new RegExp('^' + name + '$')});
    const group = summary.locator('..');
    if (await group.getAttribute('open') === null) await summary.click();
}

async function saveAndReload(page: Page, button: Locator): Promise<void> {
    await Promise.all([page.waitForEvent('load'), button.click()]);
}

test('edits each root through one modal and supports survey header images', async ({page}) => {
    test.setTimeout(120_000);
    await loginForE2E(page.request, createE2ELogin());
    const cases: E2ECreateCase<E2ECreateForm>[] = [
        createE2EEvent(), createE2EActivityPlan(), createE2EPackingList(), createE2EDriversList(), createE2ESurvey(),
    ];
    for (const input of cases) {
        const suffix = randomUUID();
        input.title = input.form.title = `Properties ${input.createPath} ${suffix}`;
        if (input.createPath === '/event/create') {
            Object.assign(input.form, {bindingDeadline: '2026-07-01T12:30', deadlineTz: 'Europe/Berlin'});
        }
        const entity = await createResourceViaForm(page.request, input);
        await page.goto(entity.path);
        const modal = await openSettings(page);
        if (input.createPath === '/event/create') {
            // Closing discards the inline selector's draft and restores the saved zone in both controls.
            await openPropertyGroup(modal, 'Dates and time');
            const timezone = modal.locator('[name="deadlineTz"]');
            await expect(timezone).toHaveValue('Europe/Berlin');
            await modal.getByRole('button', {name: 'Time zone', exact: true}).click();
            await modal.getByLabel('Search time zones', {exact: true}).fill('New_York');
            await modal.locator('#entity-property-timezone-list button[data-zone="America/New_York"]').click();
            await modal.locator('.modal-footer').getByRole('button', {name: 'Close', exact: true}).click();
            await expect(modal).not.toBeVisible();
            await openSettings(page);
            await expect(timezone).toHaveValue('Europe/Berlin');
            await expect(modal.locator('[name="deadlineTz"]')).toHaveValue('Europe/Berlin');
        }
        await modal.getByLabel('Title', {exact: true}).fill(`Edited ${suffix}`);
        await saveAndReload(page, modal.getByRole('button', {name: 'Save properties', exact: true}));
        await expect(page.getByRole('heading', {name: `Edited ${suffix}`, exact: true})).toBeVisible();
        if (input.createPath === '/event/create') {
            await page.goto(`${entity.path}/admin`);
            await openSettings(page);
            await expect(modal.getByLabel('Title', {exact: true})).toHaveValue(`Edited ${suffix}`);
            await openPropertyGroup(modal, 'Dates and time');
            await expect(modal.locator('[name="deadlineTz"]')).toHaveValue('Europe/Berlin');
            await expect(modal.getByLabel('Binding deadline', {exact: true})).toHaveValue('2026-07-01T12:30');
        }
        if (input.createPath !== '/survey/create') continue;

        // Survey pages use the shared header initializer despite their separate voting entry point.
        await openSettings(page);
        const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9WQAAAAASUVORK5CYII=', 'base64');
        await openPropertyGroup(modal, 'Header image');
        await modal.getByLabel('Choose image', {exact: true}).setInputFiles({name: 'survey-header.png', mimeType: 'image/png', buffer: png});
        await saveAndReload(page, modal.getByRole('button', {name: 'Upload', exact: true}));
        const header = await page.request.get(`${entity.path}/header`);
        expect(header.ok()).toBe(true);
        expect(await header.body()).toEqual(png);
        await openSettings(page);
        await openPropertyGroup(modal, 'Header image');
        page.once('dialog', async function acceptRemoval(dialog) { await dialog.accept(); });
        await saveAndReload(page, modal.getByRole('button', {name: 'Remove image', exact: true}));
        expect((await page.request.get(`${entity.path}/header`)).status()).toBe(404);
    }
});

test('authorizes the submitted creation destination independently of query context and account identity', async ({page, browser, baseURL}) => {
    test.setTimeout(60_000);
    await loginForE2E(page.request, createE2ELogin());
    const ownEvent = await createResourceViaForm(page.request, createE2EEvent());
    const otherContext = await browser.newContext({baseURL});
    try {
        await loginForE2E(otherContext.request, createE2ELogin());
        const profileName = `Other profile ${randomUUID().slice(0, 8)}`;
        expect((await otherContext.request.post('/users/profile/create', {form: {name: profileName}, maxRedirects: 0})).status()).toBe(302);
        const otherPage = await otherContext.newPage();
        await otherPage.goto('/users/profile/manage');
        await Promise.all([
            otherPage.waitForURL('**/users/dashboard'),
            otherPage.locator('.list-group-item').filter({hasText: profileName}).getByRole('link', {name: 'Switch to profile'}).click(),
        ]);
        const privateEvent = await createResourceViaForm(otherContext.request, createE2EEvent());
        const cases: E2ECreateCase<E2ECreateForm>[] = [createE2EActivityPlan(), createE2EPackingList(), createE2EDriversList()];
        for (const input of cases) {
            const form = {...input.form, event_id: privateEvent.id} as Record<string, string>;
            expect((await page.request.post(`${input.createPath}?eventId=${ownEvent.id}`, {form, maxRedirects: 0})).status()).toBe(403);
            expect((await page.request.post(input.createPath, {form, maxRedirects: 0})).status()).toBe(403);
        }
        // A legitimately selected body event can replace an old unauthorized URL preselection.
        const valid = createE2EPackingList();
        valid.createPath += `?eventId=${privateEvent.id}`;
        Object.assign(valid.form, {event_id: ownEvent.id});
        const linked = await createResourceViaForm(page.request, valid);
        expect((await page.request.get(linked.path)).ok()).toBe(true);
    } finally {
        await otherContext.close();
    }
});

test('resolves other drafts before linking an archived event and preserves content on unlink', async ({page}) => {
    test.setTimeout(90_000);
    await page.setViewportSize({width: 390, height: 844});
    await loginForE2E(page.request, createE2ELogin());
    const eventInput = createE2EEvent();
    eventInput.title = eventInput.form.title = `Archived link target ${randomUUID()}`;
    const event = await createResourceViaForm(page.request, eventInput);
    expect((await page.request.post(`/api/event/${event.id}/archive`, {data: {}})).ok()).toBe(true);
    const entity = await createResourceViaForm(page.request, createE2EPackingList());
    await page.goto(entity.path);
    const modal = await openSettings(page);
    await modal.getByLabel('Title', {exact: true}).fill('Draft title to keep');
    await selectSettingsPanel(modal, 'Linked event');
    await modal.locator('#entity-properties-event-search').fill(event.title);
    await modal.getByText('Filter by dates and state', {exact: true}).click();
    await modal.locator('#entity-properties-event-archive').selectOption('archived');
    await modal.locator(`[data-event-id="${event.id}"]`).click();
    await expect(page.locator('.modal.show')).toHaveCount(1);

    let prompts = 0;
    async function rejectOtherDraftLoss(dialog: Dialog) {
        prompts++;
        if (prompts === 1) await dialog.accept();
        else await dialog.dismiss();
    }
    // The association confirmation precedes the shared command host's other-draft check.
    page.on('dialog', rejectOtherDraftLoss);
    await modal.getByRole('button', {name: 'Save event link', exact: true}).click();
    await expect.poll(() => prompts).toBe(2);
    page.off('dialog', rejectOtherDraftLoss);
    await expect(modal.getByLabel('Title', {exact: true})).toHaveValue('Draft title to keep');
    await expect(modal.locator('input[name="event_id"]')).toHaveValue(event.id);
    await expect(page.locator('[data-archive-notice]')).toHaveCount(0);

    await selectSettingsPanel(modal, 'General');
    page.once('dialog', async function discardLinkDraft(dialog) { await dialog.accept(); });
    await saveAndReload(page, modal.getByRole('button', {name: 'Save properties', exact: true}));
    await expect(page.getByRole('heading', {name: 'Draft title to keep', exact: true})).toBeVisible();
    await openSettings(page);
    await expect(modal.locator('input[name="event_id"]')).toHaveValue('');
    await selectSettingsPanel(modal, 'Linked event');
    await modal.locator('#entity-properties-event-search').fill(event.title);
    await modal.locator(`[data-event-id="${event.id}"]`).click();
    page.once('dialog', async function acceptLink(dialog) { await dialog.accept(); });
    await saveAndReload(page, modal.getByRole('button', {name: 'Save event link', exact: true}));
    await expect(page.locator('[data-archive-notice]')).toHaveText('This entity is archived.');
    await openSettings(page);
    await selectSettingsPanel(modal, 'Linked event');
    await modal.getByRole('button', {name: 'No event', exact: true}).click();
    page.once('dialog', async function acceptUnlink(dialog) { await dialog.accept(); });
    await saveAndReload(page, modal.getByRole('button', {name: 'Save event link', exact: true}));
    await expect(page.locator('[data-archive-notice]')).toHaveCount(0);
    await expect(page.getByText('Tent', {exact: true})).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});

test('omits forbidden controls, retains rejected drafts, and recomputes admission after relinking', async ({page, browser, baseURL}) => {
    test.setTimeout(120_000);
    await loginForE2E(page.request, createE2ELogin());
    const guestContext = await browser.newContext({baseURL});
    const guestPage = await guestContext.newPage();
    try {
        const eventInput = createE2EEvent();
        eventInput.title = eventInput.form.title = `Permission modal source ${randomUUID()}`;
        Object.assign(eventInput.form, {'defaultPerms[public][0]': 'ACCESS_VIEW', 'defaultPerms[public][1]': 'ACCESS_REGISTRATION'});
        const event = await createResourceViaForm(page.request, eventInput);
        const guestName = `Property guest ${randomUUID().slice(0, 8)}`;
        expect((await guestContext.request.post(`${event.path}/guest`, {form: {username: guestName}, maxRedirects: 0})).status()).toBe(302);
        expect((await guestContext.request.post(`/api/event/${event.id}/register`, {data: {
            arrivalDate: eventInput.form.startDate, departureDate: eventInput.form.endDate, dietary: ['MEAT'],
        }})).ok()).toBe(true);
        const people = (await (await page.request.get(`/api/event/${event.id}/participants`)).json()).data.participants;
        const profileId = people.find((person: {name: string}) => person.name === guestName).profileId;
        await guestPage.goto(event.path);
        await expect(guestPage.getByRole('button', {name: 'Entity settings', exact: true})).toHaveCount(0);
        expect((await page.request.post(`/api/event/${event.id}/archive`, {data: {}})).ok()).toBe(true);
        await guestPage.reload();
        await expect(guestPage.locator('[data-archive-notice]')).toHaveText('This entity is archived.');
        await expect(guestPage.locator('#entityPropertiesModal')).toHaveCount(0);

        expect((await page.request.post(`/api/event/${event.id}/admins`, {data: {profileId, perms: ['EDIT_TITLE']}})).ok()).toBe(true);
        await guestPage.reload();
        const modal = await openSettings(guestPage);
        await expect(modal.locator('[name="title"]')).toHaveCount(1);
        await expect(modal.locator('[name="description"], [name="location"], [data-entity-section="image"], [data-entity-section="archival"], [data-entity-delete-form]')).toHaveCount(0);
        expect((await guestContext.request.post(`/api/event/${event.id}/update`, {data: {description: 'Forged'}})).status()).toBe(403);
        for (const field of ['allowRegDateUpdatesAfterDeadline', 'allowRegCancelationAfterDeadline', 'allowRegDietUpdateAfterDeadline']) {
            expect((await guestContext.request.post(`/api/event/${event.id}/update`, {data: {[field]: 'on'}})).status()).toBe(403);
        }
        await modal.getByLabel('Title', {exact: true}).fill('Retained denied draft');
        expect((await page.request.patch(`/api/event/${event.id}/admins/${profileId}`, {data: {perms: []}})).ok()).toBe(true);
        // Hold a real forbidden response at the browser boundary to inspect the pending state.
        // Draft controls and dismissal remain frozen until the server's result is handled.
        let releaseRequest!: () => void;
        const responseGate = new Promise<void>(function captureRelease(resolve) { releaseRequest = resolve; });
        async function delayPropertyWrite(route: Route): Promise<void> {
            await responseGate;
            await route.continue();
        }
        const updateRoute = `**/api/event/${event.id}/update`;
        await guestPage.route(updateRoute, delayPropertyWrite);
        try {
            await modal.getByRole('button', {name: 'Save properties', exact: true}).click();
            await expect(modal).toHaveAttribute('aria-busy', 'true');
            await expect(modal.getByLabel('Title', {exact: true})).toBeDisabled();
            await expect(modal.locator('.modal-footer').getByRole('button', {name: 'Close', exact: true})).toBeDisabled();
        } finally {
            releaseRequest();
        }
        await expect(modal.locator('[data-command-feedback]')).toContainText('Not allowed');
        await guestPage.unroute(updateRoute, delayPropertyWrite);
        await expect(modal.getByLabel('Title', {exact: true})).toBeEnabled();
        await expect(modal).toBeVisible();
        await expect(modal.getByLabel('Title', {exact: true})).toHaveValue('Retained denied draft');
        await modal.locator('.modal-footer').getByRole('button', {name: 'Close', exact: true}).click();
        await expect(modal).not.toBeVisible();

        expect((await page.request.patch(`/api/event/${event.id}/admins/${profileId}`, {data: {perms: ['MANAGE_REQUIREMENTS']}})).ok()).toBe(true);
        await guestPage.reload();
        await openSettings(guestPage);
        await expect(modal.locator('[name="title"], [name="description"], [name="location"]')).toHaveCount(0);
        await expect(modal.locator('[name="requireDietaryInfo"]')).toBeVisible();
        await modal.getByLabel('Allow diet update after deadline expired', {exact: true}).check();
        await saveAndReload(guestPage, modal.getByRole('button', {name: 'Save properties', exact: true}));
        expect((await guestContext.request.get(`${event.path}/admin`)).status()).toBe(403);

        const targetInput = createE2EEvent();
        targetInput.title = targetInput.form.title = `Permission modal target ${randomUUID()}`;
        const target = await createResourceViaForm(page.request, targetInput);
        expect((await page.request.post(`/api/event/${target.id}/admins`, {data: {profileId, perms: ['MANAGE_ASSIGNMENTS']}})).ok()).toBe(true);
        const childInput = createE2EPackingList();
        childInput.createPath += `?eventId=${event.id}`;
        Object.assign(childInput.form, {event_id: event.id});
        const child = await createResourceViaForm(page.request, childInput);
        expect((await page.request.post(`/api/packing/${child.id}/settings`, {data: {
            defaultPerms: {public: [], authenticated: [], guest: [], participant: ['EDIT_META']},
        }})).ok()).toBe(true);
        await guestPage.goto(child.path);
        await openSettings(guestPage);
        await selectSettingsPanel(modal, 'Linked event');
        await modal.locator('#entity-properties-event-search').fill(target.title);
        await modal.locator(`[data-event-id="${target.id}"]`).click();
        guestPage.once('dialog', async function acceptAdmissionChange(dialog) { await dialog.accept(); });
        await Promise.all([
            guestPage.waitForURL('**/users/dashboard'),
            modal.getByRole('button', {name: 'Save event link', exact: true}).click(),
        ]);
        expect((await guestContext.request.post(`/api/packing/${child.id}/event`, {data: {eventId: null, expectedEventId: target.id}})).status()).toBe(403);
        expect((await page.request.get(child.path)).ok()).toBe(true);
    } finally {
        await guestContext.close();
    }
});

/** The compact editor must retain and save hidden audiences, not only the visible audience. */
test('keeps access editing in one compartment and saves every audience draft', async ({page}) => {
    await loginForE2E(page.request, createE2ELogin());
    const entity = await createResourceViaForm(page.request, createE2EPackingList());
    await page.goto(entity.path);
    const modal = await openSettings(page);
    await expect(modal.locator('[data-entity-settings-panel]:visible')).toHaveCount(1);
    await expect(modal.getByRole('tab', {name: 'Access', exact: true})).toBeVisible();
    await expect(modal.locator('.perm-audience')).not.toBeVisible();
    await selectSettingsPanel(modal, 'Access');
    const audience = modal.getByLabel('Permission audience', {exact: true});
    await expect(audience).toHaveValue('participant');
    await expect(modal.locator('[data-permission-audience]:visible')).toHaveCount(1);
    await modal.locator('[data-permission-audience="participant"]').getByRole('button', {name: 'None', exact: true}).click();
    await modal.locator('#perm-participant-EDIT_TITLE').check();
    await audience.selectOption('guest');
    await modal.locator('[data-permission-audience="guest"]').getByRole('button', {name: 'None', exact: true}).click();
    await modal.locator('#perm-guest-EDIT_DESC').check();
    await audience.selectOption('participant');
    await expect(modal.locator('#perm-participant-EDIT_TITLE')).toBeChecked();
    await saveAndReload(page, modal.getByRole('button', {name: 'Update permissions', exact: true}));
    await openSettings(page);
    await selectSettingsPanel(modal, 'Access');
    await expect(modal.locator('#perm-participant-EDIT_TITLE')).toBeChecked();
    await audience.selectOption('guest');
    await expect(modal.locator('#perm-guest-EDIT_DESC')).toBeChecked();
    await modal.getByRole('tab', {name: 'Administrators', exact: true}).click();
    await expect(audience).not.toBeVisible();
    await modal.locator('#entity-access-admins').getByRole('button', {name: 'Add', exact: true}).click();
    await expect(modal.getByLabel('User (name or email)', {exact: true})).toBeVisible();
    await expect(page.locator('.modal.show')).toHaveCount(1);
    await expect(modal.locator('[data-entity-settings-panel]:visible')).toHaveCount(1);
});
