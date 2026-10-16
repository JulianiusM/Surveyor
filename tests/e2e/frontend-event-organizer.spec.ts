import {expect, test} from '@playwright/test';
import type {Locator, Page, TestInfo} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createE2EActivityPlan, createE2EDriversList, createE2ELogin, createE2EPackingList} from '../factories/e2eCoreFactory';
import {closeModalForE2E, createResourceViaForm, loginForE2E, openModalForE2E} from '../keywords/e2eCoreKeywords';
import {createFrontendEventFixture, frontendEventHeaders} from '../keywords/frontendEventE2EKeywords';
import {waitForPilotHydration} from '../keywords/frontendDynamicKeywords';
import type {components} from '../../src/types/api/v1';

/** Build attendance and three linked resources through actual native application
 * routes. The browser comparisons then read the same records in both frontends. */
async function organizerFixture(page: Page, children = false) {
    const event = await createFrontendEventFixture(page.request);
    const attendance = await page.request.post(`/api/event/${event.id}/register`, {data: {
        arrivalDate: '2030-06-01', departureDate: '2030-06-04', dietary: ['MEAT', 'ALLERGIES', 'COMMENT'],
        allergyNotes: 'Peanuts; Lactose', dietComment: 'No tomatoes',
    }});
    expect(attendance.status()).toBe(200);
    const result = {event, children: [] as {id: string; title: string; path: string}[]};
    if (children) {
        // Activity dates and slots use the parent window; independent membership
        // and actual child ownership remain with each native creation operation.
        for (const input of [createE2EPackingList(), createE2EActivityPlan(), createE2EDriversList()]) {
            input.title = input.form.title = `Event ${input.createPath.split('/')[1]} ${event.id.slice(0, 8)}`;
            input.createPath += '?eventId=' + event.id;
            Object.assign(input.form, {event_id: event.id});
            if (input.createPath.startsWith('/activity')) Object.assign(input.form, {
                startDate: '2030-06-01', endDate: '2030-06-04',
                slots: JSON.stringify({'2030-06-02': [{id: randomUUID(), day: '2030-06-02', pos: 0,
                    title: 'Kitchen', startTime: '08:00', endTime: '09:00', maxAssignees: 2}]}),
            });
            result.children.push(await createResourceViaForm(page.request, input));
        }
    }
    const response = await page.request.post(`/api/v1/events/${event.id}/links`, {
        headers: await frontendEventHeaders(page.request), data: {maxUses: 1},
    });
    expect(response.status()).toBe(200);
    return result;
}

/** Capture actual authored component geometry, text and colors without replacing
 * the document or intercepting any application response. */
async function metrics(surface: Locator) {
    return surface.evaluate(function measureSurface(element) {
        const rectangle = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        // Native keeps closed modal headings inside its form/roster, whereas
        // Vue portals them outside. Compare only the surface's visible heading.
        const title = [...element.querySelectorAll<HTMLElement>('.modal-title')]
            .find(candidate => candidate.checkVisibility());
        const table = element.querySelector('table');
        // A closed native details can retain a descendant's rectangle. The
        // browser's visibility check excludes that control until disclosure.
        const inputs = [...element.querySelectorAll<HTMLInputElement>('input:not([type="hidden"])')]
            .filter(input => input.getClientRects().length && input.checkVisibility());
        return {x: rectangle.x, y: rectangle.y, width: rectangle.width, height: rectangle.height,
            color: style.color, background: style.backgroundColor, border: style.borderColor,
            text: (element as HTMLElement).innerText.replace(/\s+/gu, ' ').trim(),
            title: title?.textContent?.trim(), titleFont: title ? getComputedStyle(title).fontSize : null,
            headers: table ? [...table.querySelectorAll('thead th')].map(cell => cell.textContent!.trim()) : [],
            tableWidth: table?.getBoundingClientRect().width ?? null,
            inputs: inputs.map(input => ({type: input.type, width: input.getBoundingClientRect().width,
                min: input.min, max: input.max, required: input.required, readOnly: input.readOnly}))};
    });
}

/** Store each independent native/pilot picture and its raw browser evidence. */
async function capture(page: Page, info: TestInfo, name: string, surface: Locator) {
    await surface.scrollIntoViewIfNeeded();
    await page.evaluate(() => document.fonts.ready);
    const result = await metrics(surface);
    const path = info.outputPath(`${name}.png`);
    await page.screenshot({path, animations: 'disabled', fullPage: true});
    await info.attach(name, {path, contentType: 'image/png'});
    await info.attach(`${name}-metrics`, {body: JSON.stringify(result, null, 2), contentType: 'application/json'});
    return result;
}

/** Dialog fonts, fields and bounds must match the unchanged native surface.
 * Whole-page vertical positions can differ through approved common-shell content. */
function compare(native: Awaited<ReturnType<typeof metrics>>, pilot: Awaited<ReturnType<typeof metrics>>, dialog = false): void {
    expect(pilot.headers).toEqual(native.headers);
    expect(Math.abs(pilot.width - native.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(pilot.height - native.height)).toBeLessThanOrEqual(1);
    expect(pilot.title).toBe(native.title);
    expect(pilot.titleFont).toBe(native.titleFont);
    expect(pilot.color).toBe(native.color);
    expect(pilot.background).toBe(native.background);
    expect(pilot.border).toBe(native.border);
    expect(pilot.text).toBe(native.text);
    expect(pilot.inputs).toEqual(native.inputs);
    if (native.tableWidth !== null) expect(Math.abs(pilot.tableWidth! - native.tableWidth)).toBeLessThanOrEqual(1);
    if (!dialog) return;
    expect(Math.abs(pilot.x - native.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(pilot.y - native.y)).toBeLessThanOrEqual(1);
}

/** Compare actual control geometry, constraints and state independently of IDs
 * and transport-only fields. Permission serialization has its own HTTP assertions. */
async function formControls(surface: Locator) {
    return surface.evaluate(function measureControls(element) {
        const controls = [...element.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input,textarea,select')]
            .filter(control => control.type !== 'hidden' && control.getClientRects().length && control.checkVisibility());
        return {timezone: element.querySelector<HTMLInputElement>('input[name="deadlineTz"]')?.value ?? null,
            controls: controls.map(control => ({name: control.closest('.perm-matrix') && control.type === 'checkbox' ? 'permission' : control.name,
                type: control.type, width: control.getBoundingClientRect().width, height: control.getBoundingClientRect().height,
                min: control.getAttribute('min'), max: control.getAttribute('max'), step: control.getAttribute('step'),
                maxLength: control.getAttribute('maxlength'), required: control.required,
                checked: control instanceof HTMLInputElement && control.type === 'checkbox' ? control.checked : null}))};
    });
}

for (const width of [1280, 390]) {
    test(`compares native Event creation and settings forms at ${width}px`, async ({page}, info) => {
        test.setTimeout(120_000);
        await page.setViewportSize({width, height: 900});
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        await loginForE2E(page.request, createE2ELogin());
        const evidence: Record<string, unknown> = {};
        for (const pilot of [false, true]) {
            const prefix = pilot ? 'pilot' : 'native';
            await page.goto(`${pilot ? '/frontend-pilot' : ''}/event/create?locale=en`, {waitUntil: 'domcontentloaded'});
            if (pilot) await waitForPilotHydration(page);
            const form = page.locator('#eventForm');
            await expect(form.locator('.perm-matrix input[type="checkbox"]').first()).toBeVisible();
            evidence[`${prefix}-creation`] = await capture(page, info, `${prefix}-creation`, form);
            evidence[`${prefix}-creation-controls`] = await formControls(form);
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
        }
        compare(evidence['native-creation'] as Awaited<ReturnType<typeof metrics>>, evidence['pilot-creation'] as Awaited<ReturnType<typeof metrics>>);
        expect(evidence['pilot-creation-controls']).toEqual(evidence['native-creation-controls']);

        const event = await createFrontendEventFixture(page.request);
        for (const pilot of [false, true]) {
            const prefix = pilot ? 'pilot' : 'native';
            await page.goto(`${pilot ? '/frontend-pilot' : ''}/event/${event.id}?locale=en`, {waitUntil: 'domcontentloaded'});
            if (pilot) await waitForPilotHydration(page);
            const nativeModal = page.locator('#entityPropertiesModal');
            const opener = page.getByRole('button', {name: 'Entity settings', exact: true});
            if (pilot) await opener.click();
            else await openModalForE2E(nativeModal, opener);
            const dialog = pilot ? page.getByRole('dialog') : nativeModal.locator('.modal-content');
            await expect(dialog.getByRole('tab', {name: 'General', exact: true})).toBeVisible();
            await expect(dialog.locator('[name="title"]')).toBeVisible();
            evidence[`${prefix}-settings-general`] = await capture(page, info, `${prefix}-settings-general`, dialog);
            for (const family of ['Dates and time', 'Registration', 'Dietary requirements']) {
                await dialog.locator('summary').filter({hasText: new RegExp('^' + family + '$', 'u')}).click();
            }
            evidence[`${prefix}-settings-expanded`] = await capture(page, info, `${prefix}-settings-expanded`, dialog);
            evidence[`${prefix}-settings-controls`] = await formControls(dialog.getByRole('tabpanel', {name: 'General', exact: true}));
            for (const family of ['Details', 'Dates and time', 'Registration', 'Dietary requirements', 'Header image']) {
                // Expanded native rows can cover an earlier summary after the
                // scroll container moves. Use its actual keyboard activation to
                // close families and open Image, without forcing pointer events.
                const disclosure = dialog.locator('summary').filter({hasText: new RegExp('^' + family + '$', 'u')});
                await disclosure.focus();
                await disclosure.press('Enter');
            }
            await expect(dialog.locator('input[type="file"]')).toBeVisible();
            evidence[`${prefix}-settings-image`] = await capture(page, info, `${prefix}-settings-image`, dialog);
            await dialog.getByRole('tab', {name: 'Access', exact: true}).click();
            await expect(dialog.locator('.perm-matrix input[type="checkbox"]').first()).toBeVisible();
            evidence[`${prefix}-settings-access`] = await capture(page, info, `${prefix}-settings-access`, dialog);
            evidence[`${prefix}-access-controls`] = await formControls(dialog.getByRole('tabpanel', {name: 'Access', exact: true}));
            if (pilot) await dialog.getByRole('button', {name: 'Close', exact: true}).last().click();
            else await closeModalForE2E(nativeModal);
        }
        for (const surface of ['settings-general', 'settings-expanded', 'settings-image', 'settings-access']) {
            compare(evidence[`native-${surface}`] as Awaited<ReturnType<typeof metrics>>, evidence[`pilot-${surface}`] as Awaited<ReturnType<typeof metrics>>, true);
        }
        expect(evidence['pilot-settings-controls']).toEqual(evidence['native-settings-controls']);
        expect(evidence['pilot-access-controls']).toEqual(evidence['native-access-controls']);
        await writeFile(info.outputPath('native-pilot-event-forms.json'), JSON.stringify(evidence, null, 2));
        expect(errors).toEqual([]);
    });
}

test('organizer dates, link revocation and participant PDF use the integrated application', async ({page}) => {
    const {event} = await organizerFixture(page);
    await page.goto(`/frontend-pilot/event/${event.id}/admin?locale=en`, {waitUntil: 'domcontentloaded'});
    await waitForPilotHydration(page);
    const roster = page.locator('.event-participants');
    await roster.locator('.accordion-button').click();
    await expect(roster.locator('tbody tr')).toHaveCount(1);
    await roster.getByRole('button', {name: 'Edit dates', exact: true}).click();
    const dates = page.getByRole('dialog');
    await dates.locator('[name="arrivalDate"]').fill('2030-06-02');
    await dates.getByRole('button', {name: 'Save dates', exact: true}).click();
    await expect(dates).not.toBeVisible();
    const saved = await (await page.request.get(`/api/v1/events/${event.id}/participants`, {
        headers: await frontendEventHeaders(page.request),
    })).json() as components['schemas']['EventParticipants'];
    expect(saved.participants).toHaveLength(1);
    expect(saved.participants[0]?.arrivalDate).toBe('2030-06-02');
    await roster.locator('input[type="text"]').fill('no participant matches');
    await expect(roster.locator('tbody tr')).toHaveCount(0);
    await expect(roster.locator('.js-totals')).toContainText('ALLERGIES: 1');
    await roster.locator('input[type="text"]').clear();
    await roster.getByRole('button', {name: 'Details', exact: true}).click();
    await expect(page.getByRole('dialog')).toContainText('Peanuts');
    await page.getByRole('dialog').getByRole('button', {name: 'Close', exact: true}).click();
    const links = page.locator('.reg-links');
    await links.locator('.accordion-button').click();
    await expect(links.locator('tbody tr')).toHaveCount(1);
    page.once('dialog', confirmation => confirmation.accept());
    await links.getByRole('button', {name: 'Revoke', exact: true}).click();
    await expect(links.locator('tbody .badge')).toHaveText('Revoked');
    await expect(links.getByRole('button', {name: 'Copy', exact: true})).toBeDisabled();
    const pdf = await page.request.get(`/event/${event.id}/export/participants`);
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()['content-type']).toContain('application/pdf');
    expect((await pdf.body()).subarray(0, 4).toString()).toBe('%PDF');
});

for (const width of [1280, 390]) {
    test(`compares native organizer dialogs, roster and shared child cards at ${width}px`, async ({page}, info) => {
        test.setTimeout(120_000);
        await page.setViewportSize({width, height: 900});
        const {event, children} = await organizerFixture(page, true);
        const evidence: Record<string, Awaited<ReturnType<typeof metrics>>> = {};
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));

        for (const pilot of [false, true]) {
            const prefix = pilot ? 'pilot' : 'native';
            await page.goto(`${pilot ? '/frontend-pilot' : ''}/event/${event.id}/admin?locale=en`, {waitUntil: 'domcontentloaded'});
            if (pilot) await waitForPilotHydration(page);
            // Root administration uses the same full-size settings control as
            // native. Region-only captures would miss a smaller header action.
            evidence[`${prefix}-settings-button`] = await metrics(page.getByRole('button', {name: 'Entity settings', exact: true}));
            if (pilot) {
                const native = evidence['native-settings-button']!;
                const current = evidence['pilot-settings-button']!;
                compare(native, current);
                expect(Math.abs(current.height - native.height)).toBeLessThanOrEqual(1);
                expect(current.color).toBe(native.color);
            }

            const roster = page.locator('.event-participants');
            await roster.locator('.accordion-button').click();
            await expect(roster.locator('tbody .fw-semibold')).toHaveCount(1);
            evidence[`${prefix}-roster`] = await capture(page, info, `${prefix}-roster`, roster);
            if (pilot) compare(evidence['native-roster']!, evidence['pilot-roster']!);

            const nativeNotes = roster.locator('.modal').filter({has: page.locator('.js-allergy-list')});
            if (pilot) await roster.getByRole('button', {name: 'Allergy / Comment Details', exact: true}).click();
            else await openModalForE2E(nativeNotes, roster.locator('.js-show-allergy-summary'));
            const notes = pilot ? page.getByRole('dialog') : nativeNotes.locator('.modal-content');
            evidence[`${prefix}-notes`] = await capture(page, info, `${prefix}-notes`, notes);
            if (pilot) compare(evidence['native-notes']!, evidence['pilot-notes']!, true);
            if (pilot) await notes.getByRole('button', {name: 'Close', exact: true}).click();
            else await closeModalForE2E(nativeNotes);

            const nativeDates = roster.locator('.js-date-modal');
            if (pilot) await roster.getByRole('button', {name: 'Edit dates', exact: true}).click();
            else await openModalForE2E(nativeDates, roster.locator('.btn-edit-dates'));
            const dates = pilot ? page.getByRole('dialog') : nativeDates.locator('.modal-content');
            evidence[`${prefix}-dates`] = await capture(page, info, `${prefix}-dates`, dates);
            if (pilot) compare(evidence['native-dates']!, evidence['pilot-dates']!, true);
            if (pilot) await dates.getByRole('button', {name: 'Close', exact: true}).click();
            else await closeModalForE2E(nativeDates);

            const links = page.locator('.reg-links');
            await links.locator('.accordion-button').click();
            await expect(links.locator('tbody code')).toHaveCount(1);
            const nativeCreate = links.locator('.modal');
            if (pilot) await links.getByRole('button', {name: 'Create link', exact: true}).click();
            else await openModalForE2E(nativeCreate, links.getByRole('button', {name: /Create link$/u}));
            const create = pilot ? page.getByRole('dialog') : nativeCreate.locator('.modal-content');
            evidence[`${prefix}-create-link`] = await capture(page, info, `${prefix}-create-link`, create);
            if (pilot) compare(evidence['native-create-link']!, evidence['pilot-create-link']!, true);
            if (pilot) await create.getByRole('button', {name: 'Close', exact: true}).click();
            else await closeModalForE2E(nativeCreate);

            // Administration keeps owner row actions and real native destinations
            // for the two child feature families awaiting their migration phases.
            const drivers = page.getByRole('button', {name: /Event drivers lists/u});
            await drivers.click();
            const driver = children.find(child => child.path.startsWith('/drivers/'))!;
            const driverLink = page.locator(`a[href="${driver.path}"]`);
            await expect(driverLink).toBeVisible();
            await expect(driverLink).toContainText(driver.title);
            await expect(page.locator(`a[href="${driver.path}/duplicate"]`)).toBeVisible();

            await page.goto(`${pilot ? '/frontend-pilot' : ''}/event/${event.id}?locale=en`, {waitUntil: 'domcontentloaded'});
            if (pilot) await waitForPilotHydration(page);
            const registered = page.locator('#registrationForm').locator('xpath=ancestor::*[contains(concat(" ",normalize-space(@class)," ")," card ")][1]');
            await expect(registered).toContainText('Your registration');
            evidence[`${prefix}-registered`] = await capture(page, info, `${prefix}-registered`, registered);
            if (pilot) {
                compare(evidence['native-registered']!, evidence['pilot-registered']!);
                expect(evidence['pilot-registered']!.inputs).toEqual(evidence['native-registered']!.inputs);
            }
            const things = page.locator('.entity-overview').filter({has: page.getByRole('button', {name: /Things to do/u})});
            await expect(things.locator('article, .card.js-item')).toHaveCount(3);
            evidence[`${prefix}-things`] = await capture(page, info, `${prefix}-things`, things);
            if (pilot) compare(evidence['native-things']!, evidence['pilot-things']!);
            await expect(things).not.toContainText('Only my overview');
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
        }
        await writeFile(info.outputPath('native-pilot-organizer-metrics.json'), JSON.stringify(evidence, null, 2));
        expect(errors).toEqual([]);
    });
}
