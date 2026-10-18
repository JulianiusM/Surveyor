import {expect, test} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createE2ELogin} from '../factories/e2eCoreFactory';
import {closeModalForE2E, expectVisiblePresentation, loginForE2E, openModalForE2E,
    readVisiblePresentation} from '../keywords/e2eCoreKeywords';
import {waitForPilotHydration} from '../keywords/frontendDynamicKeywords';
import {createFrontendEventFixture, frontendEventHeaders} from '../keywords/frontendEventE2EKeywords';
import {expectDriversSettingsPresentation as expectSettingsPresentation,
    openDriversSettingsForE2E as openSettingsForE2E} from '../keywords/frontendDriversE2EKeywords';
import {assignActivityThroughNative, captureActivityPresentation, createActivityForE2E, createActivityOverlapForE2E,
    observeActivityCommand, readActivityForE2E, readActivitySettingsForE2E,
    waitForNativeActivityPane} from '../keywords/frontendActivityE2EKeywords';

for (const width of [1280, 390]) {
    test(`compares Activity schedule, participant status and editing dialogs at ${width}px`, async ({page}, info) => {
        test.setTimeout(60000);
        await page.setViewportSize({width, height: 900});
        page.on('dialog', dialog => dialog.accept());
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        const plan = await createActivityForE2E(page.request);
        const first = plan.view.slots[0]!;
        const roleResponse = await page.request.post(`/api/activity/${plan.id}/roles`, {data: {name: 'Kitchen lead'}});
        expect(roleResponse.status()).toBe(200);
        const configuredRoles = (await roleResponse.json()).data as {id: number}[];
        expect((await page.request.post(`/api/activity/${plan.id}/slot/${first.id}/addRole`, {
            data: {roles: [configuredRoles[0]!.id]},
        })).status()).toBe(200);
        await assignActivityThroughNative(page.request, plan.id, first.id);
        expect((await page.request.post(`/api/activity/${plan.id}/text-field`, {
            data: {title: 'Kitchen notes', text: 'Bring clean towels.\nCheck the cupboard.'},
        })).status()).toBe(200);
        await page.request.get('/users/profile');
        const native: Record<string, Awaited<ReturnType<typeof readVisiblePresentation>>> = {};

        for (const pilot of [false, true]) {
            const prefix = pilot ? '/frontend-pilot' : '';
            const label = pilot ? 'vue' : 'native';
            await page.goto(`${prefix}/activity/create?locale=en`, {waitUntil: 'domcontentloaded'});
            if (pilot) await waitForPilotHydration(page);
            await page.locator('#title').fill('Dated kitchen duties');
            await page.locator('#startDate').fill('2030-06-01');
            await page.locator('#endDate').fill('2030-06-02');
            await page.locator(pilot ? '#create-description' : '#desc').fill('Bring your own apron.');
            await page.locator('.add-slot').first().click();
            const creationSlot = page.locator('#slotArea .slot').first();
            await creationSlot.getByPlaceholder('Title', {exact: true}).fill('Breakfast duty');
            await creationSlot.getByPlaceholder('Description', {exact: true}).fill('Set the tables');
            const creation = await captureActivityPresentation(page, info, `${label}-activity-create`,
                page.locator('main form').first(), ['label', 'input:not([type="hidden"])', 'textarea', 'select', 'th', 'td', 'button']);

            // This form is intentionally dirty in both renderers. The parity
            // journey discards it explicitly before inspecting persisted data.
            await page.goto(`${prefix}${plan.path}?locale=en`, {waitUntil: 'domcontentloaded'});
            if (pilot) await waitForPilotHydration(page);
            const schedule = page.locator('#tab-schedule');
            await expect(schedule.locator('.slot')).toHaveCount(2);
            if (!pilot) await waitForNativeActivityPane(schedule);
            const surfaces = {
                schedule: await captureActivityPresentation(page, info, `${label}-activity-schedule`, schedule,
                    ['h4', 'th', 'small', 'strong', '.badge', '[data-count]', '[data-max]', '.slot', 'button', 'a']),
                notes: await captureActivityPresentation(page, info, `${label}-activity-notes`,
                    page.locator('.card').filter({has: page.getByText('Kitchen notes', {exact: true})}).last(),
                    ['strong', 'small', 'p', 'button']),
            };
            await (pilot ? page.getByRole('tab', {name: 'Participants', exact: true})
                : page.locator('[data-bs-target="#tab-participants"]')).click();
            if (!pilot) await waitForNativeActivityPane(page.locator('#tab-participants'));
            const participants = await captureActivityPresentation(page, info, `${label}-activity-participants`,
                page.locator('#participant-status-overview'), ['h4', 'p', 'input', 'button', '.badge', '.participant-status-cell']);
            await (pilot ? page.getByRole('tab', {name: 'Schedule', exact: true})
                : page.locator('[data-bs-target="#tab-schedule"]')).click();
            if (!pilot) await waitForNativeActivityPane(schedule);
            const roleOpener = page.locator(`.slot[data-slotid="${first.id}"] [data-slot-role-admin]`);
            if (pilot) await roleOpener.click();
            else await openModalForE2E(page.locator('#slotRoleAdminModal'), roleOpener);
            const roleDialog = pilot ? page.getByRole('dialog', {name: /Manage role assignments/u}) : page.locator('#slotRoleAdminModal');
            const roles = await captureActivityPresentation(page, info, `${label}-activity-role-assignments`,
                pilot ? roleDialog : roleDialog.locator('.modal-content'), ['.modal-title', 'p', 'th', 'td', 'select', 'button']);
            if (pilot) await roleDialog.locator('.modal-header .btn-close').click();
            else await closeModalForE2E(page.locator('#slotRoleAdminModal'));
            const opener = page.locator(`.slot[data-slotid="${first.id}"] [data-slot-edit]`);
            if (pilot) await opener.click();
            else await openModalForE2E(page.locator('#slotEditorModal'), opener);
            const slotDialog = page.getByRole('dialog').filter({has: page.locator('#slotEditorForm')});
            const slot = await captureActivityPresentation(page, info, `${label}-activity-slot-editor`,
                pilot ? slotDialog : slotDialog.locator('.modal-content'),
                ['.modal-title', 'label', 'input:not([type="hidden"])', 'textarea', 'button', 'small']);
            if (pilot) await slotDialog.locator('.modal-header .btn-close').click();
            else await closeModalForE2E(page.locator('#slotEditorModal'));
            const fieldOpener = page.locator('#addTextFieldBtn');
            if (pilot) await fieldOpener.click();
            else await openModalForE2E(page.locator('#textFieldModal'), fieldOpener);
            const textDialog = page.getByRole('dialog').filter({has: page.locator('#textFieldForm')});
            const text = await captureActivityPresentation(page, info, `${label}-activity-text-editor`,
                pilot ? textDialog : textDialog.locator('.modal-content'),
                ['.modal-title', 'label', 'input:not([type="hidden"])', 'textarea', 'button']);
            // Capture every corresponding surface before the first strict
            // comparison so one mismatch leaves the complete review evidence.
            const measured = {creation, ...surfaces, participants, roles, slot, text};
            if (pilot) {
                for (const [name, value] of Object.entries(measured)) expectVisiblePresentation(native[name]!, value);
            } else Object.assign(native, measured);
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
        }
        expect(errors).toEqual([]);
    });

    test(`compares native and Vue assignment warning review at ${width}px`, async ({page}, info) => {
        await page.setViewportSize({width, height: 900});
        const {target} = await createActivityOverlapForE2E(page.request);
        const slot = target.view.slots[0]!;
        await page.request.get('/users/profile');
        let native: Awaited<ReturnType<typeof readVisiblePresentation>> | undefined;
        for (const pilot of [false, true]) {
            await page.goto(`${pilot ? '/frontend-pilot' : ''}${target.path}?locale=en`, {waitUntil: 'domcontentloaded'});
            if (pilot) await waitForPilotHydration(page);
            await page.locator(`.slot[data-slotid="${slot.id}"] [data-action="assign"]`).click();
            const dialog = pilot ? page.getByRole('dialog', {name: 'Assignment warnings', exact: true}) : page.locator('#assignmentWarningModal');
            const measured = await captureActivityPresentation(page, info, `${pilot ? 'vue' : 'native'}-activity-warnings`,
                pilot ? dialog : dialog.locator('.modal-content'), ['.modal-title', 'p', 'strong', 'li', 'button']);
            if (pilot) expectVisiblePresentation(native!, measured);
            else native = measured;
            await dialog.getByRole('button', {name: 'Cancel', exact: true}).click();
            await expect(dialog).not.toBeVisible();
            expect((await readActivityForE2E(page.request, target.id)).slots[0]!.assignedCount).toBe(0);
        }
    });

    test(`compares Activity dated settings, image controls, linked context and lifecycle actions at ${width}px`, async ({page}, info) => {
        test.setTimeout(60000);
        await page.setViewportSize({width, height: 900});
        const event = await createFrontendEventFixture(page.request);
        const standalone = await createActivityForE2E(page.request);
        const linked = await createActivityForE2E(page.request, event.id);
        await page.request.get('/users/profile');
        const native: Record<string, Awaited<ReturnType<typeof readVisiblePresentation>>> = {};
        const controls = ['h2', 'h3', 'h5', 'p', 'summary', 'label', 'input:not([type="hidden"])',
            'textarea', 'select', 'button', 'a', 'legend'];

        for (const pilot of [false, true]) {
            const label = pilot ? 'vue' : 'native';
            let dialog = await openSettingsForE2E(page, standalone.path, pilot);
            const dates = dialog.locator('summary').filter({hasText: /^Dates and time$/u});
            await dates.focus();
            await dates.press('Enter');
            await expect(dialog.locator('[name="startDate"]')).toHaveValue('2030-06-01');
            await expect(dialog.locator('[name="endDate"]')).toHaveValue('2030-06-02');
            await expect(dialog.locator('[name="startDate"]')).toBeVisible();
            const general = await captureActivityPresentation(page, info, `${label}-activity-settings-dates`, dialog, controls);
            const header = dialog.locator('summary').filter({hasText: /^Header image$/u});
            await header.focus();
            await header.press('Enter');
            await expect(dialog.locator('input[type="file"]')).toBeVisible();
            const image = await captureActivityPresentation(page, info, `${label}-activity-settings-header-expanded`, dialog, controls);
            // The modal's fixed footer clips controls below its scroll viewport.
            // Preserve that full-modal view, then paint the complete chooser and
            // upload action at the corresponding bottom position in both UIs.
            const upload = dialog.getByRole('button', {name: 'Upload', exact: true});
            await upload.scrollIntoViewIfNeeded();
            await expect(upload).toBeInViewport({ratio: 1});
            await expect(dialog.locator('input[type="file"]')).toBeInViewport({ratio: 1});
            const imageChooser = await captureActivityPresentation(page, info, `${label}-activity-settings-header-chooser`, dialog, controls);
            await dialog.getByRole('tab', {name: 'Actions', exact: true}).click();
            await expect(dialog.getByRole('button', {name: 'Pause automatic archival', exact: true})).toBeVisible();
            await expect(dialog.getByRole('link', {name: 'Export schedule', exact: true})).toHaveAttribute('target', '_blank');
            const actions = await captureActivityPresentation(page, info, `${label}-activity-settings-actions`, dialog, controls);
            if (pilot) await dialog.locator('.modal-header .btn-close').click();
            else await closeModalForE2E(page.locator('#entityPropertiesModal'));

            // An attached plan has an independently admitted Event picker and
            // inherits the Event schedule. Its Activity-specific hints must be
            // compared with the same current parent, not a synthetic modal.
            dialog = await openSettingsForE2E(page, linked.path, pilot);
            await dialog.getByRole('tab', {name: 'Linked event', exact: true}).click();
            const searchReply = page.waitForResponse(response => {
                const url = new URL(response.url());
                return response.request().method() === 'GET' && url.searchParams.get('q') === event.title
                    && ['/api/event/link-options', '/api/v1/activity-plans/events'].includes(url.pathname);
            });
            await dialog.getByLabel('Search events', {exact: true}).fill(event.title);
            const searched = await searchReply;
            expect(searched.status()).toBe(200);
            await searched.finished();
            await expect(dialog.locator(`button[data-event-id="${event.id}"]`)).toHaveCount(1);
            await expect(dialog.getByRole('list', {name: 'Available events', exact: true})).toHaveAttribute('aria-busy', 'false');
            await expect(dialog.getByText('Assignments and rules are kept. Generated pending suggestions are refreshed; reviewed suggestions are checked again. Unlinking restores the plan\'s own automatic archival schedule.', {exact: true})).toBeVisible();
            const eventSettings = await captureActivityPresentation(page, info, `${label}-activity-settings-linked-event`, dialog, controls);
            await dialog.getByRole('tab', {name: 'Actions', exact: true}).click();
            await expect(dialog.getByText('Automatic archival follows the event.', {exact: true})).toBeVisible();
            await expect(dialog.getByRole('button', {name: 'Pause automatic archival', exact: true})).toHaveCount(0);
            const linkedActions = await captureActivityPresentation(page, info, `${label}-activity-settings-linked-actions`, dialog, controls);
            if (pilot) await dialog.locator('.modal-header .btn-close').click();
            else await closeModalForE2E(page.locator('#entityPropertiesModal'));

            // These existing shared settings helpers preserve complete measured
            // content, constraints and one-pixel geometry. Actions retain only
            // the already-approved native form versus SPA delete display case.
            const measured = {general, image, imageChooser, actions, eventSettings, linkedActions};
            if (pilot) {
                for (const [name, value] of Object.entries(measured))
                    expectSettingsPresentation(native[name]!, value, name === 'actions' || name === 'linkedActions');
            } else Object.assign(native, measured);
        }
    });
}

test('creates and duplicates dated Activity slots through multipart commands in the same document', async ({page}) => {
    await loginForE2E(page.request, createE2ELogin());
    const title = `P5 SPA duties ${randomUUID().slice(0, 8)}`;
    await page.goto('/frontend-pilot?locale=en', {waitUntil: 'domcontentloaded'});
    await waitForPilotHydration(page);
    await page.evaluate(() => {document.documentElement.dataset.pilotDocument = 'activity-create';});
    const navigation: string[] = [];
    page.on('request', request => {
        if (request.isNavigationRequest() && request.frame() === page.mainFrame()) navigation.push(request.url());
    });
    await page.getByRole('button', {name: 'New', exact: true}).click();
    await page.getByRole('link', {name: 'Activity plan', exact: true}).click();
    await expect(page).toHaveURL('/frontend-pilot/activity/create');
    await page.locator('#title').fill(title);
    await page.locator('#startDate').fill('2030-06-01');
    await page.locator('#endDate').fill('2030-06-02');
    await page.locator('#create-description').fill('Bring your own apron.\nCheck the kitchen notes.');
    await page.locator('#create-header').setInputFiles('src/public/img/logo.png');
    await page.locator('.add-slot').first().click();
    const draft = page.locator('#slotArea .slot').first();
    await draft.getByPlaceholder('Title', {exact: true}).fill('Breakfast duty');
    await draft.getByPlaceholder('Description', {exact: true}).fill('Set the tables');
    await draft.locator('input[type="time"]').nth(0).fill('08:00');
    await draft.locator('input[type="time"]').nth(1).fill('09:00');
    await draft.locator('input[type="number"]').fill('2');
    const created = page.waitForResponse(response => response.request().method() === 'POST'
        && new URL(response.url()).pathname === '/api/v1/activity-plans');
    await page.getByRole('button', {name: 'Create plan', exact: true}).click();
    expect((await created).status()).toBe(201);
    await expect(page).toHaveURL(/\/frontend-pilot\/activity\/[a-f0-9-]+$/u);
    const id = new URL(page.url()).pathname.split('/').pop()!;
    const original = await readActivityForE2E(page.request, id);
    expect(original).toMatchObject({title, startDate: '2030-06-01', endDate: '2030-06-02',
        description: 'Bring your own apron.\nCheck the kitchen notes.', currentEventId: null});
    expect(original.slots).toHaveLength(1);
    expect(original.slots[0]).toMatchObject({title: 'Breakfast duty', description: 'Set the tables',
        day: '2030-06-01', startTime: '08:00:00', endTime: '09:00:00', maxAssignees: 2, assignedCount: 0});
    expect(await (await page.request.get(original.headerUrl!, {headers: await frontendEventHeaders(page.request)})).body())
        .toEqual(readFileSync('src/public/img/logo.png'));
    await observeActivityCommand(page, id, `/slots/${original.slots[0]!.id}/self-assignment`, 'PUT',
        () => page.locator('[data-action="assign"]').click());
    expect((await readActivityForE2E(page.request, id)).slots[0]!.assignedCount).toBe(1);
    await page.getByRole('button', {name: 'Entity settings', exact: true}).click();
    const settings = page.getByRole('dialog');
    await settings.getByRole('tab', {name: 'Actions', exact: true}).click();
    await settings.getByRole('link', {name: 'Duplicate', exact: true}).click();
    await expect(page).toHaveURL(`/frontend-pilot/activity/${id}/duplicate`);
    await expect(page.locator('#title')).toHaveValue(title);
    await expect(page.locator('#create-description')).toHaveValue(original.description!);
    await expect(page.locator('#startDate')).toHaveValue(original.startDate);
    await expect(page.locator('#endDate')).toHaveValue(original.endDate);
    await expect(page.locator('#create-header')).toHaveValue('');
    await expect(page.locator('#slotArea .slot')).toHaveCount(1);
    await expect(page.locator('#slotArea .slot').getByPlaceholder('Title', {exact: true})).toHaveValue('Breakfast duty');
    await page.locator('#title').fill(`${title} copy`);
    const duplicated = page.waitForResponse(response => response.request().method() === 'POST'
        && new URL(response.url()).pathname === '/api/v1/activity-plans');
    await page.getByRole('button', {name: 'Create plan', exact: true}).click();
    expect((await duplicated).status()).toBe(201);
    await expect(page).toHaveURL(/\/frontend-pilot\/activity\/[a-f0-9-]+$/u);
    const copyId = new URL(page.url()).pathname.split('/').pop()!;
    expect(copyId).not.toBe(id);
    const copy = await readActivityForE2E(page.request, copyId);
    expect(copy).toMatchObject({title: `${title} copy`, headerUrl: null, textFields: [], participants: [], archived: false});
    expect(copy.slots).toHaveLength(1);
    expect(copy.slots[0]).toMatchObject({title: 'Breakfast duty', description: 'Set the tables',
        maxAssignees: 2, assignedCount: 0, selfAssigned: false, roles: [], assignees: []});
    expect(copy.slots[0]!.id).not.toBe(original.slots[0]!.id);
    expect(await page.evaluate(() => document.documentElement.dataset.pilotDocument)).toBe('activity-create');
    expect(navigation).toEqual([]);
});

test('retains schedule filters across assignments, edits shared text and slot details, and exports a separate document', async ({page}) => {
    page.on('dialog', dialog => dialog.accept());
    const plan = await createActivityForE2E(page.request);
    const first = plan.view.slots[0]!;
    await page.goto(`/frontend-pilot${plan.path}?locale=en`, {waitUntil: 'domcontentloaded'});
    await waitForPilotHydration(page);
    await page.evaluate(() => {document.documentElement.dataset.pilotDocument = 'activity-schedule';});
    const navigation: string[] = [];
    page.on('request', request => {
        if (request.isNavigationRequest() && request.frame() === page.mainFrame()) navigation.push(request.url());
    });
    await page.locator('[data-slot-filter="mine"]').click();
    await expect(page.locator('#tab-schedule .slot:visible')).toHaveCount(0);
    await page.locator('[data-slot-filter="open"]').click();
    await expect(page.locator('#tab-schedule .slot:visible')).toHaveCount(2);
    const firstCard = page.locator(`.slot[data-slotid="${first.id}"]`);
    await observeActivityCommand(page, plan.id, `/slots/${first.id}/self-assignment`, 'PUT',
        () => firstCard.locator('[data-action="assign"]').click());
    await expect(page.locator('[data-slot-filter="open"]')).toHaveClass(/active/u);
    await page.locator('[data-slot-filter="mine"]').click();
    await expect(page.locator('#tab-schedule .slot:visible')).toHaveCount(1);
    await page.getByRole('tab', {name: 'Participants', exact: true}).click();
    await expect(page.locator('[data-participant-row]')).toHaveCount(1);
    await page.locator('[data-participant-filter="unassigned"]').click();
    await expect(page.locator('[data-participant-row]:visible')).toHaveCount(0);
    await page.locator('[data-participant-filter="assigned"]').click();
    await expect(page.locator('[data-participant-row]:visible')).toHaveCount(1);
    await page.locator('[data-participant-search]').fill('no matching participant');
    await expect(page.locator('[data-participant-row]:visible')).toHaveCount(0);
    await page.locator('[data-participant-search]').fill('');
    await page.getByRole('tab', {name: 'Schedule', exact: true}).click();
    await firstCard.locator('[data-slot-edit]').click();
    const slotDialog = page.getByRole('dialog').filter({has: page.locator('#slotEditorForm')});
    await slotDialog.locator('#slotEditorTitleInput').fill('Breakfast duty updated');
    await slotDialog.locator('#slotEditorDescription').fill('Set up the buffet');
    await slotDialog.locator('#slotEditorCapacity').fill('3');
    await observeActivityCommand(page, plan.id, `/slots/${first.id}`, 'PATCH',
        () => slotDialog.getByRole('button', {name: 'Save', exact: true}).click());
    expect((await readActivityForE2E(page.request, plan.id)).slots[0]).toMatchObject({
        title: 'Breakfast duty updated', description: 'Set up the buffet', maxAssignees: 3, assignedCount: 1,
    });
    await expect(page.locator('[data-slot-filter="mine"]')).toHaveClass(/active/u);
    await page.getByRole('button', {name: 'Add text field', exact: true}).click();
    const textDialog = page.getByRole('dialog').filter({has: page.locator('#textFieldForm')});
    await textDialog.locator('#textFieldTitle').fill('Kitchen notes');
    await textDialog.locator('#textFieldText').fill('Bring clean towels.\nDo not leave the stove on.');
    await observeActivityCommand(page, plan.id, '/text-fields', 'POST',
        () => textDialog.getByRole('button', {name: 'Save', exact: true}).click());
    const withText = await readActivityForE2E(page.request, plan.id);
    expect(withText.textFields).toHaveLength(1);
    expect(withText.textFields[0]).toMatchObject({title: 'Kitchen notes', text: 'Bring clean towels.\nDo not leave the stove on.'});
    await expect(page.locator('.text-field-content')).toContainText('Bring clean towels.');
    await page.locator('.text-field-edit').click();
    await textDialog.locator('#textFieldText').fill('Updated shared instructions');
    await observeActivityCommand(page, plan.id, `/text-fields/${withText.textFields[0]!.id}`, 'PUT',
        () => textDialog.getByRole('button', {name: 'Save', exact: true}).click());
    expect((await readActivityForE2E(page.request, plan.id)).textFields[0]!.text).toBe('Updated shared instructions');

    // Printing is an explicit standalone output, opened without replacing the
    // current SPA document or requiring a duplicate printable implementation.
    const popupPromise = page.waitForEvent('popup');
    await page.getByRole('link', {name: 'Export schedule', exact: true}).click();
    const print = await popupPromise;
    await print.waitForLoadState('domcontentloaded');
    await expect(print).toHaveURL(`/activity/${plan.id}/export/schedule`);
    await expect(print).toHaveTitle(`Schedule – ${plan.title}`);
    await expect(print.getByRole('button', {name: 'Print', exact: true})).toBeVisible();
    await expect(print.getByText('Updated shared instructions', {exact: true})).toBeVisible();
    await print.close();
    await observeActivityCommand(page, plan.id, `/text-fields/${withText.textFields[0]!.id}`, 'DELETE',
        () => page.locator('.text-field-delete').click());
    expect((await readActivityForE2E(page.request, plan.id)).textFields).toEqual([]);
    await observeActivityCommand(page, plan.id, `/slots/${first.id}/self-assignment`, 'PUT',
        () => firstCard.locator('[data-action="unassign"]').click());
    expect((await readActivityForE2E(page.request, plan.id)).slots[0]!.assignedCount).toBe(0);
    await expect(page.locator('#tab-schedule .slot:visible')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.dataset.pilotDocument)).toBe('activity-schedule');
    expect(navigation).toEqual([]);
});

test('requires a fresh overlap review after cancellation or changed sibling commitments', async ({page}) => {
    const {target, sibling} = await createActivityOverlapForE2E(page.request);
    const slot = target.view.slots[0]!;
    await page.goto(`/frontend-pilot${target.path}?locale=en`, {waitUntil: 'domcontentloaded'});
    await waitForPilotHydration(page);
    const join = page.locator(`.slot[data-slotid="${slot.id}"] [data-action="assign"]`);
    await join.click();
    const warnings = page.getByRole('dialog', {name: 'Assignment warnings', exact: true});
    await expect(warnings).toContainText(sibling.title);
    await warnings.getByRole('button', {name: 'Cancel', exact: true}).click();
    expect((await readActivityForE2E(page.request, target.id)).slots[0]!.assignedCount).toBe(0);
    await join.click();
    await expect(warnings).toContainText(sibling.title);
    // Add a genuine second commitment while the first preview is being reviewed.
    // Neither a changed server state nor a rejected digest may replay the write.
    expect((await page.request.post(`/api/activity/${sibling.id}/slot/add`, {
        data: {date: '2030-06-01', title: 'New overlapping commitment', startTime: '09:15:00',
            endTime: '09:45:00', maxAssignees: 2, roles: []},
    })).status()).toBe(200);
    const expanded = await readActivityForE2E(page.request, sibling.id);
    const added = expanded.slots.find(value => value.title === 'New overlapping commitment')!;
    await assignActivityThroughNative(page.request, sibling.id, added.id);
    await observeActivityCommand(page, target.id, `/slots/${slot.id}/self-assignment`, 'PUT',
        () => warnings.getByRole('button', {name: 'Continue anyway', exact: true}).click(), 409);
    expect((await readActivityForE2E(page.request, target.id)).slots[0]!.assignedCount).toBe(0);
    await join.click();
    await expect(warnings).toContainText('New overlapping commitment');
    await observeActivityCommand(page, target.id, `/slots/${slot.id}/self-assignment`, 'PUT',
        () => warnings.getByRole('button', {name: 'Continue anyway', exact: true}).click());
    expect((await readActivityForE2E(page.request, target.id)).slots[0]!.assignedCount).toBe(1);
    expect((await readActivityForE2E(page.request, sibling.id)).slots.filter(value => value.selfAssigned)).toHaveLength(2);
});

test('keeps named roles distinct from slot membership and persists organizer role changes, reordering and slot CRUD', async ({page}) => {
    page.on('dialog', dialog => dialog.accept());
    const plan = await createActivityForE2E(page.request);
    const first = plan.view.slots[0]!;
    const second = plan.view.slots[1]!;
    // Native schedule order prioritizes start time, using position only for
    // ties. Equal timeboxes make this real drag exercise its visible ordering
    // contract without expecting reordering to override the native time order.
    expect((await page.request.post(`/api/activity/${plan.id}/slot/${second.id}/attr`, {
        data: {startTime: first.startTime, endTime: first.endTime},
    })).status()).toBe(200);
    const createdRole = await page.request.post(`/api/activity/${plan.id}/roles`, {data: {name: 'Kitchen lead'}});
    expect(createdRole.status()).toBe(200);
    const roles = (await createdRole.json()).data as {id: number}[];
    expect((await page.request.post(`/api/activity/${plan.id}/slot/${first.id}/addRole`, {
        data: {roles: [roles[0]!.id]},
    })).status()).toBe(200);
    await page.goto(`/frontend-pilot${plan.path}?locale=en`, {waitUntil: 'domcontentloaded'});
    await waitForPilotHydration(page);
    const card = page.locator(`.slot[data-slotid="${first.id}"]`);
    await observeActivityCommand(page, plan.id, `/slots/${first.id}/self-assignment`, 'PUT',
        () => card.locator('[data-action="take-role"][data-role="Kitchen lead"]').click());
    const assigned = await readActivityForE2E(page.request, plan.id);
    expect(assigned.slots[0]).toMatchObject({assignedCount: 1, selfAssigned: true, selfRoles: ['Kitchen lead']});
    await observeActivityCommand(page, plan.id, `/slots/${first.id}/self-assignment`, 'PUT',
        () => card.locator('[data-action="leave-role"][data-role="Kitchen lead"]').click());
    expect((await readActivityForE2E(page.request, plan.id)).slots[0]).toMatchObject({
        assignedCount: 0, selfAssigned: false, selfRoles: [],
    });
    // Taking a role from an unassigned state supplies the only membership role;
    // leaving removes that commitment. A separate ordinary signup remains when
    // its subsequently added named role is released.
    await observeActivityCommand(page, plan.id, `/slots/${first.id}/self-assignment`, 'PUT',
        () => card.locator('[data-action="assign"]').click());
    await observeActivityCommand(page, plan.id, `/slots/${first.id}/self-assignment`, 'PUT',
        () => card.locator('[data-action="take-role"][data-role="Kitchen lead"]').click());
    await observeActivityCommand(page, plan.id, `/slots/${first.id}/self-assignment`, 'PUT',
        () => card.locator('[data-action="leave-role"][data-role="Kitchen lead"]').click());
    const withoutRole = await readActivityForE2E(page.request, plan.id);
    expect(withoutRole.slots[0]).toMatchObject({assignedCount: 1, selfAssigned: true, selfRoles: ['default']});
    await card.locator('[data-slot-role-admin]').click();
    const admin = page.getByRole('dialog', {name: /Manage role assignments/u});
    await admin.locator('[data-slot-role-admin-select]').first().selectOption(withoutRole.slots[0]!.assignees[0]!.assignmentId);
    await observeActivityCommand(page, plan.id, `/slots/${first.id}/role-assignments`, 'PUT',
        () => admin.getByRole('button', {name: 'Save changes', exact: true}).click());
    await expect(admin).not.toBeVisible();
    expect((await readActivityForE2E(page.request, plan.id)).slots[0]!.selfRoles).toEqual(['Kitchen lead']);

    // Reorder real draggable cards in their rendered day container; assertions
    // read persisted order independently of the temporary browser positions.
    const secondCard = page.locator(`.slot[data-slotid="${second.id}"]`);
    await card.locator('xpath=ancestor::table').evaluate(function positionDragTable(table) {
        table.scrollIntoView({block: 'center', behavior: 'instant'});
    });
    await observeActivityCommand(page, plan.id, '/slot-order', 'PUT', () => secondCard.dragTo(card, {
        sourcePosition: {x: 5, y: 5}, targetPosition: {x: 25, y: 5},
    }));
    const reordered = await readActivityForE2E(page.request, plan.id);
    expect(reordered.slots.map(slot => slot.id)).toEqual([second.id, first.id]);
    expect(reordered.slots.map(slot => ({id: slot.id, position: slot.position}))).toEqual([
        {id: second.id, position: 0}, {id: first.id, position: 1},
    ]);
    await page.locator('[data-add-slot]').first().click();
    const editor = page.getByRole('dialog').filter({has: page.locator('#slotEditorForm')});
    await editor.locator('#slotEditorTitleInput').fill('Cleanup duty');
    await editor.locator('#slotEditorDescription').fill('Clean the tables');
    await editor.locator('#slotEditorStartTime').fill('15:00');
    await editor.locator('#slotEditorEndTime').fill('16:00');
    await editor.locator('#slotEditorCapacity').fill('4');
    // Create and select a role through the actual editor as well as consuming
    // pre-existing role fixtures above. The refresh must deliver its saved ID
    // without dropping this slot draft or requiring a second creation attempt.
    await editor.locator('#slotEditorRoleInput').fill('Cleanup lead');
    await observeActivityCommand(page, plan.id, '/roles', 'POST',
        () => editor.getByRole('button', {name: /Create new role.*Cleanup lead/u}).click());
    await expect(editor.locator('#slotEditorRoleChips')).toContainText('Cleanup lead');
    await expect(editor.locator('#slotEditorTitleInput')).toHaveValue('Cleanup duty');
    await expect(editor.locator('#slotEditorDescription')).toHaveValue('Clean the tables');
    await observeActivityCommand(page, plan.id, '/slots', 'POST',
        () => editor.getByRole('button', {name: 'Save', exact: true}).click());
    const added = (await readActivityForE2E(page.request, plan.id)).slots.find(slot => slot.title === 'Cleanup duty')!;
    expect(added).toMatchObject({day: '2030-06-01', description: 'Clean the tables', maxAssignees: 4, assignedCount: 0});
    expect(added.roles).toEqual([expect.objectContaining({name: 'Cleanup lead', maxQty: 1, assignedQty: 0})]);
    await observeActivityCommand(page, plan.id, `/slots/${added.id}`, 'DELETE',
        () => page.locator(`.slot[data-slotid="${added.id}"] [data-delete-slot]`).click());
    expect((await readActivityForE2E(page.request, plan.id)).slots.map(slot => slot.id)).toEqual([second.id, first.id]);
    await observeActivityCommand(page, plan.id, `/assignments/${withoutRole.slots[0]!.assignees[0]!.assignmentId}`, 'DELETE',
        () => card.locator('[data-owner-remove]').click());
    expect((await readActivityForE2E(page.request, plan.id)).slots.find(slot => slot.id === first.id)).toMatchObject({
        assignedCount: 0, selfAssigned: false, selfRoles: [],
    });
});

test('redacts the unauthorized participant projection and never offers a printable schedule without its grant', async ({page, browser, baseURL}) => {
    const plan = await createActivityForE2E(page.request);
    await assignActivityThroughNative(page.request, plan.id, plan.view.slots[0]!.id);
    const owner = await readActivityForE2E(page.request, plan.id);
    expect(owner.participants).toHaveLength(1);
    expect(owner.capabilities.exportSchedule).toBe(true);
    const outsider = await browser.newContext({baseURL});
    try {
        const visitor = await outsider.newPage();
        await visitor.goto(`/frontend-pilot${plan.path}?locale=en`, {waitUntil: 'domcontentloaded'});
        await waitForPilotHydration(visitor);
        await expect(visitor).toHaveURL(`/frontend-pilot${plan.path}/guest?locale=en`);
        await visitor.locator('#guest-name').fill(`P5 visitor ${randomUUID().slice(0, 8)}`);
        await observeActivityCommand(visitor, plan.id, '/guest', 'POST',
            () => visitor.getByRole('button', {name: 'Continue as guest', exact: true}).click());
        await expect(visitor).toHaveURL(`/frontend-pilot${plan.path}`);
        const view = await readActivityForE2E(outsider.request, plan.id);
        expect(view.participants).toEqual([]);
        expect(view.slots.every(slot => slot.assignees.length === 0)).toBe(true);
        expect(view.capabilities.exportSchedule).toBe(false);
        // A guest identity admits the public schedule, not protected participant
        // details or a printable export whose separate method grant is absent.
        await expect(visitor.getByRole('tab', {name: 'Participants', exact: true})).toHaveCount(0);
        await expect(visitor.getByRole('link', {name: 'Export schedule', exact: true})).toHaveCount(0);
        await expect(visitor.locator('[data-participant-row]')).toHaveCount(0);
        const deniedPrint = await outsider.request.get(`/activity/${plan.id}/export/schedule`);
        expect(deniedPrint.status()).toBe(403);
        expect(await deniedPrint.text()).not.toContain('class="sheet"');
    } finally {
        await outsider.close();
    }
});

test('adopts shared Activity settings for metadata, image, archive and permanent deletion in one document', async ({page}) => {
    page.on('dialog', dialog => dialog.accept());
    const plan = await createActivityForE2E(page.request);
    await page.goto(`/frontend-pilot${plan.path}?locale=en`, {waitUntil: 'domcontentloaded'});
    await waitForPilotHydration(page);
    await page.evaluate(() => {document.documentElement.dataset.pilotDocument = 'activity-settings';});
    const navigation: string[] = [];
    page.on('request', request => {
        if (request.isNavigationRequest() && request.frame() === page.mainFrame()) navigation.push(request.url());
    });
    await page.getByRole('button', {name: 'Entity settings', exact: true}).click();
    const settings = page.getByRole('dialog');
    const title = `${plan.title} updated`;
    await settings.locator('[name="title"]').fill(title);
    await settings.locator('[name="description"]').fill('Updated organizer instructions');
    await observeActivityCommand(page, plan.id, '/metadata', 'PATCH',
        () => settings.getByRole('button', {name: 'Save properties', exact: true}).click());
    expect(await readActivityForE2E(page.request, plan.id)).toMatchObject({title, description: 'Updated organizer instructions'});
    const image = settings.locator('[data-entity-section="image"]');
    await image.locator('summary').click();
    await image.locator('input[type="file"]').setInputFiles('src/public/img/logo.png');
    await observeActivityCommand(page, plan.id, '/header', 'PUT',
        () => image.getByRole('button', {name: 'Upload', exact: true}).click());
    const header = (await readActivityForE2E(page.request, plan.id)).headerUrl!;
    expect(await (await page.request.get(header, {headers: await frontendEventHeaders(page.request)})).body())
        .toEqual(readFileSync('src/public/img/logo.png'));
    await observeActivityCommand(page, plan.id, '/header', 'DELETE',
        () => image.getByRole('button', {name: 'Remove image', exact: true}).click());
    expect((await readActivityForE2E(page.request, plan.id)).headerUrl).toBeNull();
    await settings.getByRole('tab', {name: 'Actions', exact: true}).click();
    expect(await readActivitySettingsForE2E(page.request, plan.id)).toMatchObject({
        capabilities: {manageAutomation: true, export: true}, archive: {autoArchivePaused: false, hasAutomaticSchedule: true},
    });
    await observeActivityCommand(page, plan.id, '/automatic-archive', 'PUT',
        () => settings.getByRole('button', {name: 'Pause automatic archival', exact: true}).click());
    expect((await readActivitySettingsForE2E(page.request, plan.id)).archive.autoArchivePaused).toBe(true);
    await observeActivityCommand(page, plan.id, '/automatic-archive', 'PUT',
        () => settings.getByRole('button', {name: 'Resume automatic archival', exact: true}).click());
    expect((await readActivitySettingsForE2E(page.request, plan.id)).archive.autoArchivePaused).toBe(false);
    // Actions and the schedule expose the same authorized standalone print
    // document; neither output replaces the settings-owning SPA document.
    const popupPromise = page.waitForEvent('popup');
    await settings.getByRole('link', {name: 'Export schedule', exact: true}).click();
    const print = await popupPromise;
    await print.waitForLoadState('domcontentloaded');
    await expect(print).toHaveURL(`/activity/${plan.id}/export/schedule`);
    await expect(print).toHaveTitle(`Schedule – ${title}`);
    await expect(print.getByRole('button', {name: 'Print', exact: true})).toBeVisible();
    await print.close();
    await expect(settings).toBeVisible();
    await observeActivityCommand(page, plan.id, '/archive', 'POST',
        () => settings.getByRole('button', {name: 'Archive for everyone', exact: true}).click());
    expect((await readActivityForE2E(page.request, plan.id)).archived).toBe(true);
    await settings.locator('.modal-header .btn-close').click();
    await expect(page.getByRole('status').filter({hasText: /^This entity is archived\.$/u})).toBeVisible();
    await page.getByRole('button', {name: 'Entity settings', exact: true}).click();
    await settings.getByRole('tab', {name: 'Actions', exact: true}).click();
    await observeActivityCommand(page, plan.id, '/restore', 'POST',
        () => settings.getByRole('button', {name: 'Restore for everyone', exact: true}).click());
    expect((await readActivityForE2E(page.request, plan.id)).archived).toBe(false);
    await observeActivityCommand(page, plan.id, '', 'DELETE',
        () => settings.getByRole('button', {name: 'Delete permanently', exact: true}).click());
    await expect(page).toHaveURL('/frontend-pilot');
    expect((await page.request.get(`/api/v1/activity-plans/${plan.id}`, {headers: await frontendEventHeaders(page.request)})).status()).toBe(404);
    expect(await page.evaluate(() => document.documentElement.dataset.pilotDocument)).toBe('activity-settings');
    expect(navigation).toEqual([]);
});
