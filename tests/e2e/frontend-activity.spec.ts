import {patchActivitySlotForE2E, createActivityRoleForE2E} from '../keywords/frontendActivityE2EKeywords';
import {commandHeadersForE2E} from '../keywords/e2eCoreKeywords';
import {expect, test, type Page, type Route} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createTranslator} from '../../src/common/localization/translator';
import type {Locale} from '../../src/types/LocalizationTypes';
import {createE2ELogin} from '../factories/e2eCoreFactory';
import {loginForE2E} from '../keywords/e2eCoreKeywords';
import {waitForFrontendHydration} from '../keywords/frontendDynamicKeywords';
import {createFrontendEventFixture, frontendEventHeaders} from '../keywords/frontendEventE2EKeywords';
import {openDriversSettingsForE2E as openSettingsForE2E} from '../keywords/frontendDriversE2EKeywords';
import {assignActivityForE2E, captureActivityCreationPresentation, captureActivityPresentation, captureActivitySchedulePresentation, createActivityForE2E, createActivityOverlapForE2E,
    expectActivityTabKeyboard,
    observeActivityCommand, readActivityForE2E, readActivitySettingsForE2E} from '../keywords/frontendActivityE2EKeywords';

/** Change the real header preference through its visible controls. A narrow
 * viewport starts with collapsed navigation; restore that original menu state
 * before reviewing the dirty form rather than forcing a hidden select action. */
async function selectCreationLocale(page: Page, from: Locale, to: Locale): Promise<void> {
    const current = createTranslator(from);
    const next = createTranslator(to);
    const locale = page.getByLabel(current.t('app.locale'), {exact: true});
    const openedNavigation = !await locale.isVisible();

    // Desktop already exposes the preference. Mobile uses the same actual
    // navigation disclosure a user must open before choosing another language.
    if (openedNavigation) await page.getByRole('button', {name: current.t('app.toggleNavigation'), exact: true}).click();
    await locale.selectOption(to);
    await expect(page.locator('html')).toHaveAttribute('lang', to);

    // Translation changes the disclosure's accessible name. Close only the
    // navigation opened above, retaining an already-open/desktop presentation.
    if (openedNavigation) {
        const toggle = page.getByRole('button', {name: next.t('app.toggleNavigation'), exact: true});
        if (await toggle.getAttribute('aria-expanded') === 'true') await toggle.click();
        await expect(page.getByLabel(next.t('app.locale'), {exact: true})).not.toBeVisible();
    }
}

for (const width of [1280, 390]) {
    test(`shows Activity schedule, participant status and editing dialogs at ${width}px`, async ({page}, info) => {
        test.setTimeout(60000);
        await page.setViewportSize({width, height: 900});
        page.on('dialog', dialog => dialog.accept());
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        const plan = await createActivityForE2E(page.request);
        const first = plan.view.slots[0]!;
        const roleId = await createActivityRoleForE2E(page.request, plan.id, 'Kitchen lead');
        // The existing scalar writer requires a slot field alongside roles.
        // Prepare the unchanged title as the complete editor does.
        await patchActivitySlotForE2E(page.request, plan.id, first.id, {title: first.title, roles: [roleId]});
        await assignActivityForE2E(page.request, plan.id, first.id);
        expect((await page.request.post(`/api/v1/activity-plans/${plan.id}/text-fields`, {headers: await commandHeadersForE2E(page.request), data: {title: 'Kitchen notes', text: 'Bring clean towels.\nCheck the cupboard.'}})).status()).toBe(200);
        await page.request.get('/users/profile');


        {
            const label = 'vue';
            await page.goto('/activity/create?locale=en', {waitUntil: 'domcontentloaded'});
            {
                await waitForFrontendHydration(page);
                const permissions = page.locator('[data-creation-permissions] .accordion-button');
                await expect(permissions).toHaveAttribute('aria-expanded', 'false');
                await permissions.click();
            }
            await page.locator('#title').fill('Dated kitchen duties');
            await page.locator('#startDate').fill('2030-06-01');
            await page.locator('#endDate').fill('2030-06-02');
            await page.locator('#create-description').fill('Bring your own apron.');
            await page.locator('.add-slot').first().click();
            const creationSlot = page.locator('#slotArea .slot').first();
            await creationSlot.getByPlaceholder('Title', {exact: true}).fill('Breakfast duty');
            await creationSlot.getByPlaceholder('Description', {exact: true}).fill('Set the tables');
            await captureActivityCreationPresentation(page, info, `${label}-activity-create`,
                page.locator('main form').first());
            {
                // Review translated label fit on the same dirty controls, then
                // restore English without losing their identity or values.
                const initialFields = await creationSlot.evaluateHandle(slot => Array.from(slot.querySelectorAll('input')));
                const initialValues = await initialFields.evaluate(fields => fields.map(field => field.value));
                try {
                    await selectCreationLocale(page, 'en', 'de');
                    await captureActivityCreationPresentation(page, info, 'vue-de-activity-create',
                        page.locator('main form').first(), 'de');
                    expect(await initialFields.evaluate(fields => fields.every(field => field.isConnected
                        && document.getElementById(field.id) === field))).toBe(true);
                    expect(await initialFields.evaluate(fields => fields.map(field => field.value))).toEqual(initialValues);
                    await selectCreationLocale(page, 'de', 'en');
                    expect(await initialFields.evaluate(fields => fields.every(field => field.isConnected
                        && document.getElementById(field.id) === field))).toBe(true);
                    expect(await initialFields.evaluate(fields => fields.map(field => field.value))).toEqual(initialValues);
                } finally { await initialFields.dispose(); }
            }

            // Discard the intentionally dirty form before inspecting saved data.
            await page.goto(`${plan.path}?locale=en`, {waitUntil: 'domcontentloaded'});
            await waitForFrontendHydration(page);
            const schedule = page.locator('#tab-schedule');
            await expect(schedule.locator('.slot')).toHaveCount(2);

            await captureActivitySchedulePresentation(page, info, `${label}-activity-schedule`, schedule, plan.view.slots.length);
            await captureActivityPresentation(page, info, `${label}-activity-notes`,
                page.locator('.card').filter({has: page.getByText('Kitchen notes', {exact: true})}).last(),
                ['strong', 'small', 'p', 'button']);
            await expectActivityTabKeyboard(page);
            await (page.getByRole('tab', {name: 'Participants', exact: true})).click();

            await captureActivityPresentation(page, info, `${label}-activity-participants`,
                page.locator('#participant-status-overview'), ['h4', 'p', 'input', 'button', '.badge', '.participant-status-cell']);
            await (page.getByRole('tab', {name: 'Schedule', exact: true})).click();

            const roleOpener = page.locator(`.slot[data-slotid="${first.id}"] [data-slot-role-admin]`);
            await roleOpener.click();
            const roleDialog = page.getByRole('dialog', {name: /Manage role assignments/u});
            await captureActivityPresentation(page, info, `${label}-activity-role-assignments`,
                roleDialog, ['.modal-title', 'p', 'th', 'td', 'select', 'button']);
            await roleDialog.locator('.modal-header .btn-close').click();
            const opener = page.locator(`.slot[data-slotid="${first.id}"] [data-slot-edit]`);
            await opener.click();
            const slotDialog = page.getByRole('dialog').filter({has: page.locator('#slotEditorForm')});
            await captureActivityPresentation(page, info, `${label}-activity-slot-editor`,
                slotDialog,
                ['.modal-title', 'label', 'input:not([type="hidden"])', 'textarea', 'button', 'small']);
            await slotDialog.locator('.modal-header .btn-close').click();
            const fieldOpener = page.locator('#addTextFieldBtn');
            await fieldOpener.click();
            const textDialog = page.getByRole('dialog').filter({has: page.locator('#textFieldForm')});
            await captureActivityPresentation(page, info, `${label}-activity-text-editor`,
                textDialog,
                ['.modal-title', 'label', 'input:not([type="hidden"])', 'textarea', 'button']);
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
        }
        expect(errors).toEqual([]);
    });

    test(`preserves assignment warning review at ${width}px`, async ({page}, info) => {
        await page.setViewportSize({width, height: 900});
        const {target, sibling} = await createActivityOverlapForE2E(page.request);
        const slot = target.view.slots[0]!;
        const expectedWarnings = ['This slot is on your arrival day.',
            "This arrival-day time is not eligible under the plan's arrival policy.",
            `This slot overlaps with another assignment or recommendation: ${sibling.title}: Breakfast help on 2030-06-01 (09:00–10:00). Resolve this with the affected participant before confirming the overlap.`];
        await page.request.get('/users/profile');

        {
            await page.goto(`${target.path}?locale=en`, {waitUntil: 'domcontentloaded'});
            await waitForFrontendHydration(page);
            await page.locator(`.slot[data-slotid="${slot.id}"] [data-action="assign"]`).click();
            const dialog = page.getByRole('dialog', {name: 'Assignment warnings', exact: true});
            // Require every warning in the actual admitted warning receipt.
            await expect(dialog.locator('#assignmentWarningList li')).toHaveCount(expectedWarnings.length);
            for (const warning of expectedWarnings)
                await expect(dialog.locator('#assignmentWarningList').getByText(warning, {exact: true})).toBeVisible();
            await captureActivityPresentation(page, info, 'vue-activity-warnings',
                dialog, ['.modal-title', 'p', 'strong', 'li', 'button']);

            await dialog.getByRole('button', {name: 'Cancel', exact: true}).click();
            await expect(dialog).not.toBeVisible();
            expect((await readActivityForE2E(page.request, target.id)).slots[0]!.assignedCount).toBe(0);
        }
    });

    test(`shows Activity dated settings, image controls, linked context and lifecycle actions at ${width}px`, async ({page}, info) => {
        test.setTimeout(60000);
        await page.setViewportSize({width, height: 900});
        const event = await createFrontendEventFixture(page.request);
        const standalone = await createActivityForE2E(page.request);
        const linked = await createActivityForE2E(page.request, event.id);
        await page.request.get('/users/profile');

        const controls = ['h2', 'h3', 'h5', 'p', 'summary', 'label', 'input:not([type="hidden"])',
            'textarea', 'select', 'button', 'a', 'legend'];

        {
            const label = 'vue';
            let dialog = await openSettingsForE2E(page, standalone.path);
            const dates = dialog.locator('summary').filter({hasText: /^Dates and time$/u});
            await dates.focus();
            await dates.press('Enter');
            await expect(dialog.locator('[name="startDate"]')).toHaveValue('2030-06-01');
            await expect(dialog.locator('[name="endDate"]')).toHaveValue('2030-06-02');
            await expect(dialog.locator('[name="startDate"]')).toBeVisible();
            await captureActivityPresentation(page, info, `${label}-activity-settings-dates`, dialog, controls);
            const header = dialog.locator('summary').filter({hasText: /^Header image$/u});
            await header.focus();
            await header.press('Enter');
            await expect(dialog.locator('input[type="file"]')).toBeVisible();
            await captureActivityPresentation(page, info, `${label}-activity-settings-header-expanded`, dialog, controls);
            // The modal's fixed footer clips controls below its scroll viewport.
            // Preserve that full-modal view, then paint the complete chooser and
            // upload action at the bottom position as well.
            const upload = dialog.getByRole('button', {name: 'Upload', exact: true});
            await upload.scrollIntoViewIfNeeded();
            await expect(upload).toBeInViewport({ratio: 1});
            await expect(dialog.locator('input[type="file"]')).toBeInViewport({ratio: 1});
            await captureActivityPresentation(page, info, `${label}-activity-settings-header-chooser`, dialog, controls);
            await dialog.getByRole('tab', {name: 'Actions', exact: true}).click();
            await expect(dialog.getByRole('button', {name: 'Pause automatic archival', exact: true})).toBeVisible();
            await expect(dialog.getByRole('link', {name: 'Export schedule', exact: true})).toHaveAttribute('target', '_blank');
            await captureActivityPresentation(page, info, `${label}-activity-settings-actions`, dialog, controls);
            await dialog.locator('.modal-header .btn-close').click();

            // An attached plan has an independently admitted Event picker and
            // inherits the Event schedule. Its Activity-specific hints must be
            // compared with the same current parent, not a synthetic modal.
            dialog = await openSettingsForE2E(page, linked.path);
            await dialog.getByRole('tab', {name: 'Linked event', exact: true}).click();
            const searchReply = page.waitForResponse(response => {
                const url = new URL(response.url());
                return response.request().method() === 'GET' && url.searchParams.get('q') === event.title
                    && url.pathname === '/api/v1/activity-plans/events';
            });
            await dialog.getByLabel('Search events', {exact: true}).fill(event.title);
            const searched = await searchReply;
            expect(searched.status()).toBe(200);
            await searched.finished();
            await expect(dialog.locator(`button[data-event-id="${event.id}"]`)).toHaveCount(1);
            await expect(dialog.getByRole('list', {name: 'Available events', exact: true})).toHaveAttribute('aria-busy', 'false');
            await expect(dialog.getByText('Assignments and rules are kept. Generated pending suggestions are refreshed; reviewed suggestions are checked again. Unlinking restores the plan\'s own automatic archival schedule.', {exact: true})).toBeVisible();
            await captureActivityPresentation(page, info, `${label}-activity-settings-linked-event`, dialog, controls);
            await dialog.getByRole('tab', {name: 'Actions', exact: true}).click();
            await expect(dialog.getByText('Automatic archival follows the event.', {exact: true})).toBeVisible();
            await expect(dialog.getByRole('button', {name: 'Pause automatic archival', exact: true})).toHaveCount(0);
            await captureActivityPresentation(page, info, `${label}-activity-settings-linked-actions`, dialog, controls);
            await dialog.locator('.modal-header .btn-close').click();

        }
    });
}

test('creates and duplicates dated Activity slots through multipart commands in the same document', async ({page}) => {
    await loginForE2E(page.request, createE2ELogin());
    const title = `P5 SPA duties ${randomUUID().slice(0, 8)}`;
    await page.goto('/users/dashboard?locale=en', {waitUntil: 'domcontentloaded'});
    await waitForFrontendHydration(page);
    await page.evaluate(() => {document.documentElement.dataset.frontendDocument = 'activity-create';});
    const navigation: string[] = [];
    page.on('request', request => {
        if (request.isNavigationRequest() && request.frame() === page.mainFrame()) navigation.push(request.url());
    });
    await page.getByRole('button', {name: 'New', exact: true}).click();
    await page.getByRole('link', {name: 'Activity plan', exact: true}).click();
    await expect(page).toHaveURL('/activity/create');
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
    await expect(page).toHaveURL(/\/activity\/[a-f0-9-]+$/u);
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
    await expect(page).toHaveURL(`/activity/${id}/duplicate`);
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
    await expect(page).toHaveURL(/\/activity\/[a-f0-9-]+$/u);
    const copyId = new URL(page.url()).pathname.split('/').pop()!;
    expect(copyId).not.toBe(id);
    const copy = await readActivityForE2E(page.request, copyId);
    expect(copy).toMatchObject({title: `${title} copy`, headerUrl: null, textFields: [], participants: [], archived: false});
    expect(copy.slots).toHaveLength(1);
    expect(copy.slots[0]).toMatchObject({title: 'Breakfast duty', description: 'Set the tables',
        maxAssignees: 2, assignedCount: 0, selfAssigned: false, roles: [], assignees: []});
    expect(copy.slots[0]!.id).not.toBe(original.slots[0]!.id);
    expect(await page.evaluate(() => document.documentElement.dataset.frontendDocument)).toBe('activity-create');
    expect(navigation).toEqual([]);
});

test('retains schedule filters across assignments, edits shared text and slot details, and exports a separate document', async ({page}) => {
    page.on('dialog', dialog => dialog.accept());
    const plan = await createActivityForE2E(page.request);
    const first = plan.view.slots[0]!;
    await page.goto(`${plan.path}?locale=en`, {waitUntil: 'domcontentloaded'});
    await waitForFrontendHydration(page);
    await page.evaluate(() => {document.documentElement.dataset.frontendDocument = 'activity-schedule';});
    const total = page.locator('#tab-schedule .fs-6').filter({has: page.locator('.bi-card-checklist')}).locator('.badge').first();
    await expect(total).toHaveText(String(plan.view.slots.length));
    const navigation: string[] = [];
    page.on('request', request => {
        if (request.isNavigationRequest() && request.frame() === page.mainFrame()) navigation.push(request.url());
    });
    await page.locator('[data-slot-filter="mine"]').click();
    await expect(page.locator('#tab-schedule .slot:visible')).toHaveCount(0);
    await expect(total).toHaveText('2');
    await page.locator('[data-slot-filter="open"]').click();
    await expect(page.locator('#tab-schedule .slot:visible')).toHaveCount(2);
    await expect(total).toHaveText('2');
    const firstCard = page.locator(`.slot[data-slotid="${first.id}"]`);
    await observeActivityCommand(page, plan.id, `/slots/${first.id}/self-assignment`, 'PUT',
        () => firstCard.locator('[data-action="assign"]').click());
    await expect(page.locator('[data-slot-filter="open"]')).toHaveClass(/active/u);
    await page.locator('[data-slot-filter="mine"]').click();
    await expect(page.locator('#tab-schedule .slot:visible')).toHaveCount(1);
    await expect(total).toHaveText('2');
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
    await slotDialog.locator('#slotEditorCapacity').fill('003');
    await slotDialog.locator('#slotEditorDescription').focus();
    // Slot editing shares lexical number presentation with Event and finance;
    // the eventual numeric persistence remains the existing Activity operation.
    await expect(slotDialog.locator('#slotEditorCapacity')).toHaveValue('003');
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
    await expect(total).toHaveText('2');
    expect(await page.evaluate(() => document.documentElement.dataset.frontendDocument)).toBe('activity-schedule');
    expect(navigation).toEqual([]);
});

test('recovers a cold Activity detail failure through manual Refresh in the same document', async function recoverColdActivity({page}) {
    const plan = await createActivityForE2E(page.request);
    await page.goto(`/users/dashboard?locale=en&owner_main_q=${encodeURIComponent(plan.title)}`, {waitUntil: 'domcontentloaded'});
    await waitForFrontendHydration(page);
    const owner = page.locator('[data-collection="owner"][data-region="main"]');
    // The actual card link includes its description in its accessible name.
    // Identify the visible title heading within that navigation control.
    const activityLink = owner.getByRole('link').filter({has: page.getByRole('heading', {name: plan.title, exact: true})});
    await expect(activityLink).toBeVisible();
    const origin = await page.evaluate(() => performance.timeOrigin);
    const documents: string[] = [];
    const mutations: string[] = [];
    page.on('request', request => {
        if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documents.push(request.url());
        const path = new URL(request.url()).pathname;
        if (request.method() !== 'GET' && path.startsWith(`/api/v1/activity-plans/${plan.id}`)) mutations.push(path);
    });

    // Keep page entry and persistence real. Only detail response delivery fails,
    // after each genuine backend read, through the normal two automatic retries.
    const pattern = `**/api/v1/activity-plans/${plan.id}`;
    let unavailable = true;
    let detailReads = 0;
    async function deliverActivityDetail(route: Route): Promise<void> {
        detailReads++;
        if (!unavailable) { await route.continue(); return; }
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        await route.fulfill({response, status: 503, contentType: 'text/plain', body: 'Temporarily unavailable'});
    }
    await page.route(pattern, deliverActivityDetail);
    try {
        const entry = page.waitForResponse(response => response.request().method() === 'GET'
            && new URL(response.url()).pathname === `/api/v1/activity-plans/${plan.id}/entry`);
        await activityLink.click();
        const admitted = await entry;
        expect(admitted.status()).toBe(200);
        expect((await admitted.json()).entry.kind).toBe('render');
        await expect(page.getByText(createTranslator('en').t('state.loadFailed'), {exact: true})).toBeVisible();
        expect(detailReads).toBe(3);
        await expect(page.locator('#tab-schedule')).toHaveCount(0);

        // An exhausted cold read retains its existing recovery owner without
        // inventing a projection. One deliberate read reaches the real endpoint
        // and renders saved content without reloading or dispatching a command.
        const refresh = page.getByRole('button', {name: 'Refresh', exact: true});
        await expect(refresh).toBeEnabled();
        await page.screenshot({path: test.info().outputPath('activity-cold-recovery.png'), fullPage: true});
        unavailable = false;
        const recovered = page.waitForResponse(response => response.request().method() === 'GET'
            && new URL(response.url()).pathname === `/api/v1/activity-plans/${plan.id}`);
        await refresh.click();
        expect((await recovered).status()).toBe(200);
        await expect(page.locator(`.slot[data-slotid="${plan.view.slots[0]!.id}"]`)).toBeVisible();
        await expect(page.getByText(createTranslator('en').t('state.loadFailed'), {exact: true})).toHaveCount(0);
        expect(detailReads).toBe(4);
        await page.screenshot({path: test.info().outputPath('activity-recovered.png'), fullPage: true});
        expect(mutations).toEqual([]);
        expect(documents).toEqual([]);
        expect(await page.evaluate(() => performance.timeOrigin)).toBe(origin);
    } finally { await page.unroute(pattern, deliverActivityDetail); }
});

test('restores Schedule after a refreshed participant roster disappears without replaying writes', async function recoverParticipantPanel({page}) {
    const plan = await createActivityForE2E(page.request);
    const first = plan.view.slots[0]!;
    await assignActivityForE2E(page.request, plan.id, first.id);
    const admitted = await readActivityForE2E(page.request, plan.id);
    expect(admitted.participants).toHaveLength(1);
    const assignment = admitted.slots.find(value => value.id === first.id)!.assignees[0]!;
    const participantName = admitted.participants[0]!.name;

    await page.goto(`${plan.path}?locale=en`, {waitUntil: 'domcontentloaded'});
    await waitForFrontendHydration(page);
    await page.evaluate(() => {document.documentElement.dataset.frontendDocument = 'activity-participant-recovery';});
    const navigation: string[] = [];
    const mutations: {method: string; path: string}[] = [];
    page.on('request', request => {
        if (request.isNavigationRequest() && request.frame() === page.mainFrame()) navigation.push(request.url());
        const path = new URL(request.url()).pathname;
        if (request.method() !== 'GET' && path.startsWith(`/api/v1/activity-plans/${plan.id}`))
            mutations.push({method: request.method(), path});
    });
    const schedule = page.locator('#tab-schedule');
    const scheduleTab = page.getByRole('tab', {name: 'Schedule', exact: true});
    const participantsTab = page.getByRole('tab', {name: 'Participants', exact: true});
    await page.locator('[data-slot-filter="mine"]').click();
    await participantsTab.click();
    await page.locator('[data-participant-search]').fill(participantName);
    await refreshPlan();
    await expect(participantsTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#tab-participants')).toBeVisible();
    await expect(page.locator('[data-participant-search]')).toHaveValue(participantName);

    // Another real client operation removes the final assignment. Refresh must
    // consume the new authorized roster and recover the existing schedule panel.
    const removed = await page.request.delete(`/api/v1/activity-plans/${plan.id}/assignments/${assignment.assignmentId}`, {headers: await commandHeadersForE2E(page.request)});
    expect(removed.status()).toBe(200);
    expect((await readActivityForE2E(page.request, plan.id)).participants).toEqual([]);
    await refreshPlan();
    await expect(participantsTab).toHaveCount(0);
    await expect(page.locator('#tab-participants')).toHaveCount(0);
    await expect(scheduleTab).toHaveAttribute('aria-selected', 'true');
    await expect(schedule).toBeVisible();
    await expect(page.locator('[data-slot-filter="mine"]')).toHaveClass(/active/u);
    await expect(schedule.locator('.slot:visible')).toHaveCount(0);
    expect(mutations).toEqual([]);

    // A later deliberate Join restores participation. Adding that tab must
    // preserve Schedule, and subsequent reads retain an explicitly reentered tab.
    await page.locator('[data-slot-filter="all"]').click();
    await observeActivityCommand(page, plan.id, `/slots/${first.id}/self-assignment`, 'PUT',
        () => page.locator(`.slot[data-slotid="${first.id}"] [data-action="assign"]`).click());
    await expect(participantsTab).toHaveCount(1);
    await expect(scheduleTab).toHaveAttribute('aria-selected', 'true');
    await participantsTab.click();
    await refreshPlan();
    await expect(participantsTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#tab-participants')).toBeVisible();
    await expect(page.locator('[data-participant-row]')).toHaveCount(1);
    expect((await readActivityForE2E(page.request, plan.id)).slots.find(value => value.id === first.id)!.assignedCount).toBe(1);
    // Deliberate Join first reads warnings with POST, then writes once. Refresh
    // must add neither another preview nor a replayed assignment command.
    expect(mutations).toEqual([
        {method: 'POST', path: `/api/v1/activity-plans/${plan.id}/slots/${first.id}/warnings`},
        {method: 'PUT', path: `/api/v1/activity-plans/${plan.id}/slots/${first.id}/self-assignment`},
    ]);
    expect(await page.evaluate(() => document.documentElement.dataset.frontendDocument)).toBe('activity-participant-recovery');
    expect(navigation).toEqual([]);

    /** The public Refresh control must dispatch a real detail read. Its fresh
     * receipt, rather than cached state, drives each selection assertion above. */
    async function refreshPlan(): Promise<void> {
        // Observe before the click so a quick local response cannot be missed.
        const response = page.waitForResponse(result => result.request().method() === 'GET'
            && new URL(result.url()).pathname === `/api/v1/activity-plans/${plan.id}`);
        await page.getByRole('button', {name: 'Refresh', exact: true}).click();
        // A real conditional GET may confirm an unchanged projection with 304;
        // the browser then supplies its admitted cached body to the application.
        expect([200, 304]).toContain((await response).status());
    }
});

test('requires a fresh overlap review after cancellation or changed sibling commitments', async ({page}) => {
    const {target, sibling} = await createActivityOverlapForE2E(page.request);
    const slot = target.view.slots[0]!;
    await page.goto(`${target.path}?locale=en`, {waitUntil: 'domcontentloaded'});
    await waitForFrontendHydration(page);
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
    expect((await page.request.post(`/api/v1/activity-plans/${sibling.id}/slots`, {headers: await commandHeadersForE2E(page.request), data: {description: '', day: '2030-06-01', title: 'New overlapping commitment', startTime: '09:15:00',
            endTime: '09:45:00', maxAssignees: 2, roles: []}})).status()).toBe(200);
    const expanded = await readActivityForE2E(page.request, sibling.id);
    const added = expanded.slots.find(value => value.title === 'New overlapping commitment')!;
    await assignActivityForE2E(page.request, sibling.id, added.id);
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
    await patchActivitySlotForE2E(page.request, plan.id, second.id, {startTime: first.startTime, endTime: first.endTime});
    const roleId = await createActivityRoleForE2E(page.request, plan.id, 'Kitchen lead');
    await patchActivitySlotForE2E(page.request, plan.id, first.id, {title: first.title, roles: [roleId]});
    await page.goto(`${plan.path}?locale=en`, {waitUntil: 'domcontentloaded'});
    await waitForFrontendHydration(page);
    const card = page.locator(`.slot[data-slotid="${first.id}"]`);
    const total = page.locator('#tab-schedule .bi-card-checklist + .badge');
    await expect(total).toHaveText('2');
    await observeActivityCommand(page, plan.id, `/slots/${first.id}/self-assignment`, 'PUT',
        () => card.locator('[data-action="take-role"][data-role="Kitchen lead"]').click());
    const assigned = await readActivityForE2E(page.request, plan.id);
    expect(assigned.slots[0]).toMatchObject({assignedCount: 1, selfAssigned: true, selfRoles: ['Kitchen lead']});
    expect(assigned.slots[0]!.roles[0]!.id).toBe(roleId);
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
    const createdSlotReply = page.waitForResponse(response => response.request().method() === 'POST'
        && new URL(response.url()).pathname === `/api/v1/activity-plans/${plan.id}/slots`);
    await observeActivityCommand(page, plan.id, '/slots', 'POST',
        () => editor.getByRole('button', {name: 'Save', exact: true}).click());
    const submittedRoles = (await createdSlotReply).request().postDataJSON().roles as unknown[];
    expect(submittedRoles).toHaveLength(1);
    expect(submittedRoles[0]).toMatch(/^[1-9][0-9]*$/u);
    const added = (await readActivityForE2E(page.request, plan.id)).slots.find(slot => slot.title === 'Cleanup duty')!;
    expect(added).toMatchObject({day: '2030-06-01', description: 'Clean the tables', maxAssignees: 4, assignedCount: 0});
    await expect(total).toHaveText('3');
    expect(added.roles).toEqual([expect.objectContaining({name: 'Cleanup lead', maxQty: 1, assignedQty: 0})]);
    expect(added.roles[0]!.id).toBe(submittedRoles[0]);
    await observeActivityCommand(page, plan.id, `/slots/${added.id}`, 'DELETE',
        () => page.locator(`.slot[data-slotid="${added.id}"] [data-delete-slot]`).click());
    expect((await readActivityForE2E(page.request, plan.id)).slots.map(slot => slot.id)).toEqual([second.id, first.id]);
    await expect(total).toHaveText('2');
    await observeActivityCommand(page, plan.id, `/assignments/${withoutRole.slots[0]!.assignees[0]!.assignmentId}`, 'DELETE',
        () => card.locator('[data-owner-remove]').click());
    expect((await readActivityForE2E(page.request, plan.id)).slots.find(slot => slot.id === first.id)).toMatchObject({
        assignedCount: 0, selfAssigned: false, selfRoles: [],
    });

    // R9's total follows actual saved-slot receipts through the empty plan,
    // independently of assignment totals or whichever filter is selected.
    for (const slot of [second, first]) {
        await observeActivityCommand(page, plan.id, `/slots/${slot.id}`, 'DELETE',
            () => page.locator(`.slot[data-slotid="${slot.id}"] [data-delete-slot]`).click());
    }
    expect((await readActivityForE2E(page.request, plan.id)).slots).toEqual([]);
    await expect(total).toHaveText('0');
    for (const filter of ['mine', 'open', 'all']) {
        await page.locator(`[data-slot-filter="${filter}"]`).click();
        await expect(total).toHaveText('0');
    }
});

test('redacts the unauthorized participant projection and never offers a printable schedule without its grant', async ({page, browser, baseURL}) => {
    const plan = await createActivityForE2E(page.request);
    await assignActivityForE2E(page.request, plan.id, plan.view.slots[0]!.id);
    const owner = await readActivityForE2E(page.request, plan.id);
    expect(owner.participants).toHaveLength(1);
    expect(owner.capabilities.exportSchedule).toBe(true);
    const outsider = await browser.newContext({baseURL});
    try {
        const visitor = await outsider.newPage();
        await visitor.goto(`${plan.path}?locale=en`, {waitUntil: 'domcontentloaded'});
        await waitForFrontendHydration(visitor);
        await expect(visitor).toHaveURL(`${plan.path}/guest?locale=en`);
        await visitor.locator('#guest-name').fill(`P5 visitor ${randomUUID().slice(0, 8)}`);
        await observeActivityCommand(visitor, plan.id, '/guest', 'POST',
            () => visitor.getByRole('button', {name: 'Continue as guest', exact: true}).click());
        await expect(visitor).toHaveURL(`${plan.path}`);
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
    await page.goto(`${plan.path}?locale=en`, {waitUntil: 'domcontentloaded'});
    await waitForFrontendHydration(page);
    await page.evaluate(() => {document.documentElement.dataset.frontendDocument = 'activity-settings';});
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
    await expect(page).toHaveURL('/users/dashboard');
    expect((await page.request.get(`/api/v1/activity-plans/${plan.id}`, {headers: await frontendEventHeaders(page.request)})).status()).toBe(404);
    expect(await page.evaluate(() => document.documentElement.dataset.frontendDocument)).toBe('activity-settings');
    expect(navigation).toEqual([]);
});
