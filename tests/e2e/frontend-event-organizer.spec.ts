import {expect, test} from '@playwright/test';
import type {Locator, Page, Response, TestInfo} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createE2EActivityPlan, createE2EDriversList, createE2ELogin, createE2EPackingList} from '../factories/e2eCoreFactory';
import {closeModalForE2E, createResourceViaForm, expectUsableFrontendLayout, loginForE2E, openModalForE2E} from '../keywords/e2eCoreKeywords';
import {createFrontendEventFixture, frontendEventHeaders} from '../keywords/frontendEventE2EKeywords';
import {waitForPilotHydration} from '../keywords/frontendDynamicKeywords';
import type {components} from '../../src/types/api/v1';
import type {ParticipantRow} from '../../src/types/EventTypes';
import {createTranslator} from '../../src/modules/localization/translator';
import type {Locale} from '../../src/types/LocalizationTypes';

/** Test-local projection of the two real roster protocols. Choice order is
 * deliberately retained; the shared backend does not order dietary relations. */
type DietaryRead = {
    participants: {id: string; choices: string[]}[];
    totals: {key: string; count: number}[];
};

/** Build attendance and three linked resources through actual native application
 * routes. The browser comparisons then read the same records in both frontends. */
async function organizerFixture(page: Page, children = false, dateWording = false) {
    const event = await createFrontendEventFixture(page.request);
    const attendance = await page.request.post(`/api/event/${event.id}/register`, {data: {
        arrivalDate: '2030-06-01', departureDate: '2030-06-04', dietary: ['MEAT', 'ALLERGIES', 'COMMENT'],
        allergyNotes: 'Peanuts; Lactose', dietComment: 'No tomatoes',
    }});
    expect(attendance.status()).toBe(200);
    if (dateWording) {
        // Only the matched presentation cases need a real nonempty deadline.
        // Save it after attendance through the existing native metadata owner.
        const deadline = await page.request.post(`/api/event/${event.id}/update`, {data: {
            bindingDeadline: '2030-05-31T12:34', deadlineTz: 'Europe/Berlin',
        }});
        expect(deadline.status()).toBe(200);
        const detail = await page.request.get(`/api/v1/events/${event.id}`, {
            headers: await frontendEventHeaders(page.request),
        });
        expect(detail.status()).toBe(200);
        const saved = await detail.json() as components['schemas']['EventView'];
        expect(saved.timezone).toBe('Europe/Berlin');
        expect(saved.bindingDeadline).toBe('2030-05-31T10:34:00.000Z');
        expect(saved.registration?.arrivalDate).toBe('2030-06-01');
    }
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
        headers: await frontendEventHeaders(page.request), data: {maxUses: 1,
            ...(dateWording ? {expiresAt: '2030-06-01T11:45:00.000Z'} : {})},
    });
    expect(response.status()).toBe(200);
    return result;
}

/** Select the real header preference and restore a mobile disclosure opened by
 * this step. Language changes retain the current document and mounted drafts. */
async function selectOrganizerLocale(page: Page, from: Locale, to: Locale): Promise<void> {
    const current = createTranslator(from);
    const next = createTranslator(to);
    const preference = page.getByLabel(current.t('app.locale'), {exact: true});
    const opened = !await preference.isVisible();
    if (opened) await page.getByRole('button', {name: current.t('app.toggleNavigation'), exact: true}).click();
    await preference.selectOption(to);
    await expect(page.locator('html')).toHaveAttribute('lang', to);

    // Translation changes the menu button's name, so use its current label.
    if (opened) {
        const toggle = page.getByRole('button', {name: next.t('app.toggleNavigation'), exact: true});
        if (await toggle.getAttribute('aria-expanded') === 'true') await toggle.click();
        await expect(page.getByLabel(next.t('app.locale'), {exact: true})).not.toBeVisible();
    }
}

/** Independently format admitted wire values with the browser's German Intl
 * rules. R10 keeps date-only values on their saved civil day; instant zones
 * remain unchanged. This test imports no production formatter. */
async function germanEventWording(page: Page, event: components['schemas']['EventView'],
    participant: components['schemas']['EventParticipant'], link: components['schemas']['EventRegistrationLink']) {
    return page.evaluate(function expectedGermanDates(source) {
        const full = new Intl.DateTimeFormat('de', {dateStyle: 'full', timeZone: 'UTC'});
        const short = new Intl.DateTimeFormat('de', {timeZone: 'UTC'});
        const deadline = new Date(source.event.bindingDeadline!);
        return {browserZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            dates: [source.event.startDate, source.event.endDate].map(day => full.format(new Date(day))),
            attendance: [source.event.registration!.arrivalDate, source.event.registration!.departureDate]
                .map(day => full.format(new Date(day))),
            deadlines: [new Intl.DateTimeFormat('de', {dateStyle: 'full', timeStyle: 'full', timeZone: source.event.timezone || 'UTC'}).format(deadline),
                new Intl.DateTimeFormat('de', {dateStyle: 'full', timeStyle: 'full'}).format(deadline)],
            roster: [source.participant.arrivalDate, source.participant.departureDate].map(day => short.format(new Date(day!))).join(' → '),
            // toLocaleString's default numeric date uses a full year; retain it
            // explicitly rather than relying on dateStyle's two-digit year.
            links: [source.link.createdAt, source.link.expiresAt!].map(value => new Intl.DateTimeFormat('de', {
                year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
            }).format(new Date(value)))};
    }, {event, participant, link});
}

for (const type of ['packing', 'activity', 'drivers'] as const) {
    test(`deletes an organizer ${type} child with JSON and client navigation to Overview`, async ({page}) => {
        const {event, children} = await organizerFixture(page, true);
        const child = children.find(value => value.path.startsWith(`/${type}/`))!;
        await page.goto(`/frontend-pilot/event/${event.id}/admin?locale=en`, {waitUntil: 'domcontentloaded'});
        await waitForPilotHydration(page);
        await page.evaluate(() => {document.documentElement.dataset.pilotDocument = 'event-child-delete';});
        const groupIndex = ['packing', 'activity', 'drivers'].indexOf(type);
        await page.locator('.dashboard-accordion-item > .accordion-header > button').nth(groupIndex).click();
        const row = page.locator('.dashboard-list .list-group-item').filter({has: page.getByRole('link', {name: child.title, exact: true})});
        await expect(row).toBeVisible();
        const documentRequests: string[] = [];
        const deletes: string[] = [];
        page.on('request', request => {
            if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documentRequests.push(request.url());
            if (request.method() === 'DELETE') deletes.push(new URL(request.url()).pathname);
        });

        page.once('dialog', confirmation => confirmation.dismiss());
        await row.getByRole('button', {name: 'Delete', exact: true}).click();
        await expect(row).toBeVisible();
        expect(deletes).toEqual([]);
        const operation = `/api/v1/events/${event.id}/things-to-do/${type}/${child.id}`;
        const deleted = page.waitForResponse(response => response.request().method() === 'DELETE'
            && new URL(response.url()).pathname === operation);
        page.once('dialog', confirmation => confirmation.accept());
        await row.getByRole('button', {name: 'Delete', exact: true}).click();
        expect((await deleted).status()).toBe(200);
        await expect(page).toHaveURL(/\/frontend-pilot$/u);
        expect(await page.evaluate(() => document.documentElement.dataset.pilotDocument)).toBe('event-child-delete');
        expect(documentRequests).toEqual([]);
        expect(deletes).toEqual([operation]);
        const remaining = await page.request.get(`/api/v1/events/${event.id}/things-to-do?view=admin`,
            {headers: await frontendEventHeaders(page.request)});
        expect(remaining.status()).toBe(200);
        const projection = await remaining.json() as components['schemas']['EventThingsToDo'];
        expect(projection.items.some(item => item.id === child.id)).toBe(false);
    });
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
    if (name.startsWith('pilot-')) await expectUsableFrontendLayout(surface);
    const result = await metrics(surface);
    const path = info.outputPath(`${name}.png`);
    await page.screenshot({path, animations: 'disabled', fullPage: true});
    await info.attach(name, {path, contentType: 'image/png'});
    await info.attach(`${name}-metrics`, {body: JSON.stringify(result, null, 2), contentType: 'application/json'});
    return result;
}

/** Compare user-visible content, hierarchy and input constraints. Responsive
 * dimensions and dialog placement remain recorded, rather than prescribed. */
function compare(native: Awaited<ReturnType<typeof metrics>>, pilot: Awaited<ReturnType<typeof metrics>>): void {
    expect(pilot.headers).toEqual(native.headers);
    expect(pilot.title).toBe(native.title);
    expect(pilot.titleFont).toBe(native.titleFont);
    expect(pilot.color).toBe(native.color);
    expect(pilot.background).toBe(native.background);
    expect(pilot.border).toBe(native.border);
    expect(pilot.text).toBe(native.text);
    expect(pilot.inputs.map(({width, ...state}) => state)).toEqual(native.inputs.map(({width, ...state}) => state));
    expect(pilot.width).toBeGreaterThan(0);
    expect(pilot.height).toBeGreaterThan(0);
}

/** Decode an ordinary observed roster response without another request or any
 * substitution. Normalize only protocol names/IDs, preserving both sequences. */
async function dietaryRead(response: Response, pilot: boolean): Promise<DietaryRead> {
    expect(response.status()).toBe(200);
    if (pilot) {
        const data = await response.json() as components['schemas']['EventParticipants'];
        return {participants: data.participants.map(function participantChoices(row) {
            return {id: row.id, choices: row.dietary.map(choice => choice.choice)};
        }), totals: data.totals};
    }

    // The native response wraps its existing entity-shaped rows and ordered
    // totals object. Object.entries retains that delivered property sequence.
    const {data} = await response.json() as {data: {participants: ParticipantRow[]; totals: Record<string, number>}};
    return {participants: data.participants.map(function participantChoices(row) {
        return {id: String(row.id), choices: row.dietaryChoices.map(choice => choice.choice)};
    }), totals: Object.entries(data.totals).map(([key, count]) => ({key, count}))};
}

/** Measure just the dietary cells and derived totals of the actual roster.
 * Record local positions for flow diagnostics; cross-frontend comparisons use
 * choice identity because independent reads may deliver different sequences. */
async function dietaryMetrics(roster: Locator) {
    return roster.evaluate(function measureDietary(surface) {
        const bounds = surface.getBoundingClientRect();

        /** Include label attention colors as well as the outer badge's complete
         * typography/box styling, so matching wording alone cannot mask drift. */
        function badgeStyle(element: Element) {
            const style = getComputedStyle(element);
            return {color: style.color, background: style.backgroundColor, font: style.fontFamily,
                fontSize: style.fontSize, fontWeight: style.fontWeight, lineHeight: style.lineHeight,
                letterSpacing: style.letterSpacing, whiteSpace: style.whiteSpace,
                display: style.display, verticalAlign: style.verticalAlign,
                padding: style.padding, margin: style.margin, border: style.border, borderRadius: style.borderRadius};
        }

        /** Positions are relative to the containing cell/group, independently
         * of the approved surrounding navigation/one-time-flash page offsets. */
        function measureGroup(element: HTMLElement) {
            const box = element.getBoundingClientRect();
            const badges = [];
            for (const badge of element.querySelectorAll<HTMLElement>(':scope > .badge')) {
                const rectangle = badge.getBoundingClientRect();
                const label = badge.firstElementChild;
                badges.push({text: badge.innerText.replace(/\s+/gu, ' ').trim(),
                    x: rectangle.x - box.x, y: rectangle.y - box.y,
                    width: rectangle.width, height: rectangle.height,
                    style: badgeStyle(badge), labelStyle: label ? badgeStyle(label) : null});
            }
            return {text: element.innerText.replace(/\s+/gu, ' ').trim(),
                x: box.x - bounds.x, y: box.y - bounds.y, width: box.width, height: box.height, badges};
        }

        // Only dietary cells and dietary totals participate in T1. Dates,
        // notes, headings, search, actions and every other text remain exact.
        const rows = [];
        for (const row of surface.querySelectorAll<HTMLTableRowElement>('tbody > tr[data-id], tbody > tr[data-registration-id]')) {
            rows.push({id: row.dataset.id ?? row.dataset.registrationId!, group: measureGroup(row.cells[3]!)});
        }
        return {rows, totals: measureGroup(surface.querySelector<HTMLElement>('.js-totals')!)};
    });
}

/** Protect complete response order before allowing cross-frontend positions to
 * differ. Geometry must still follow that order, stay visible and never overlap. */
function assertDietaryRead(read: DietaryRead, rendered: Awaited<ReturnType<typeof dietaryMetrics>>): void {
    expect(rendered.rows.map(row => row.id)).toEqual(read.participants.map(row => row.id));
    for (const [index, row] of rendered.rows.entries()) {
        expect(row.group.badges.map(badge => badge.text)).toEqual(read.participants[index]!.choices);
        assertDietaryFlow(row.group);
    }
    const totals = read.totals.filter(entry => entry.count > 0);
    expect(rendered.totals.badges.map(badge => badge.text)).toEqual(totals.map(entry => `${entry.key}: ${entry.count}`));
    assertDietaryFlow(rendered.totals);
}

/** Check physical order separately from DOM order: CSS reordering, clipping or
 * overlap must not pass an otherwise correct textual sequence assertion. */
function assertDietaryFlow(group: Awaited<ReturnType<typeof dietaryMetrics>>['totals']): void {
    // Removing a group from the remaining-text comparison is safe only when
    // its complete visible text consists of the asserted badges and whitespace.
    // Unexpected prose outside a badge must not disappear with that group.
    const badgeText = group.badges.map(badge => badge.text.replace(/\s/gu, '')).join('');
    expect(group.text.replace(/\s/gu, '')).toBe(badgeText);

    let previous: typeof group.badges[number] | undefined;
    for (const badge of group.badges) {
        expect(badge.width).toBeGreaterThan(0);
        expect(badge.height).toBeGreaterThan(0);
        expect(badge.x).toBeGreaterThanOrEqual(-1);
        expect(badge.y).toBeGreaterThanOrEqual(-1);
        expect(badge.x + badge.width).toBeLessThanOrEqual(group.width + 1);
        expect(badge.y + badge.height).toBeLessThanOrEqual(group.height + 1);
        if (previous) {
            if (Math.abs(badge.y - previous.y) <= 1) expect(badge.x).toBeGreaterThanOrEqual(previous.x + previous.width);
            else expect(badge.y).toBeGreaterThanOrEqual(previous.y + previous.height);
        }
        previous = badge;
    }
}

/** Remove only the already-asserted dietary groups from the existing exact
 * text comparison. Each unique measured substring must occur once, preventing
 * unrelated wording from disappearing behind a broad replacement or sort. */
function remainingRosterText(text: string, dietary: Awaited<ReturnType<typeof dietaryMetrics>>): string {
    const groups = [dietary.totals, ...dietary.rows.map(row => row.group)];
    for (const [index, group] of groups.entries()) {
        expect(group.text).not.toBe('');
        const start = text.indexOf(group.text);
        expect(start).toBeGreaterThanOrEqual(0);
        expect(text.indexOf(group.text, start + group.text.length)).toBe(-1);
        text = text.slice(0, start) + `[dietary group ${index}]` + text.slice(start + group.text.length);
    }
    return text;
}

/** Match complete badge contents/counts and painted hierarchy by choice. Each
 * renderer's independent flow checks protect readable order and non-overlap. */
function compareDietary(native: Awaited<ReturnType<typeof dietaryMetrics>>, pilot: Awaited<ReturnType<typeof dietaryMetrics>>): void {
    expect(pilot.rows.map(row => row.id)).toEqual(native.rows.map(row => row.id));
    compareGroup(native.totals, pilot.totals);
    for (const [index, row] of native.rows.entries()) compareGroup(row.group, pilot.rows[index]!.group);

    /** Corresponding choice presentation must match without sorting either DOM. */
    function compareGroup(original: typeof native.totals, current: typeof pilot.totals): void {
        expect(current.badges).toHaveLength(original.badges.length);
        for (const badge of original.badges) {
            const matches = current.badges.filter(candidate => candidate.text === badge.text);
            expect(matches).toHaveLength(1);
            const match = matches[0]!;
            expect(match.width).toBeGreaterThan(0);
            expect(match.height).toBeGreaterThan(0);
            expect(badgeAppearance(match.style)).toEqual(badgeAppearance(badge.style));
            expect(match.labelStyle && badgeAppearance(match.labelStyle))
                .toEqual(badge.labelStyle && badgeAppearance(badge.labelStyle));
        }
    }

    /** Shared responsive wrapping may replace native nowrap. Actual flow above
     * still protects ordering, readable bounds and non-overlap for both renderers. */
    function badgeAppearance(style: typeof native.totals.badges[number]['style']) {
        const {whiteSpace, ...appearance} = style;
        return appearance;
    }
}

/** Retain raw control geometry alongside the browser constraints and state.
 * Permission serialization has its own independent HTTP assertions. */
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

/** Internal names and responsive sizes are diagnostics, while browser input
 * constraints, disclosure values and checkbox state are functional contracts. */
function compareFormControls(native: Awaited<ReturnType<typeof formControls>>, pilot: typeof native): void {
    expect(pilot.timezone).toBe(native.timezone);
    expect(pilot.controls.map(({name, width, height, ...state}) => state))
        .toEqual(native.controls.map(({name, width, height, ...state}) => state));
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
        compareFormControls(evidence['native-creation-controls'] as Awaited<ReturnType<typeof formControls>>,
            evidence['pilot-creation-controls'] as Awaited<ReturnType<typeof formControls>>);

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
            compare(evidence[`native-${surface}`] as Awaited<ReturnType<typeof metrics>>, evidence[`pilot-${surface}`] as Awaited<ReturnType<typeof metrics>>);
        }
        for (const family of ['settings', 'access']) compareFormControls(
            evidence[`native-${family}-controls`] as Awaited<ReturnType<typeof formControls>>,
            evidence[`pilot-${family}-controls`] as Awaited<ReturnType<typeof formControls>>);
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
        const {event, children} = await organizerFixture(page, true, true);
        const evidence: Record<string, Awaited<ReturnType<typeof metrics>>> = {};
        const dietary: Record<string, Awaited<ReturnType<typeof dietaryMetrics>>> = {};
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));

        // Expectations come from independently admitted real reads after fixture
        // setup, never from substituted responses or assumed display strings.
        const headers = await frontendEventHeaders(page.request);
        const reads = await Promise.all([page.request.get(`/api/v1/events/${event.id}`, {headers}),
            page.request.get(`/api/v1/events/${event.id}/participants`, {headers}),
            page.request.get(`/api/v1/events/${event.id}/links`, {headers})]);
        for (const response of reads) expect(response.status()).toBe(200);
        const detail = await reads[0]!.json() as components['schemas']['EventView'];
        const participants = await reads[1]!.json() as components['schemas']['EventParticipants'];
        const registrationLinks = await reads[2]!.json() as components['schemas']['EventRegistrationLinks'];
        expect(participants.participants).toHaveLength(1);
        expect(registrationLinks.items).toHaveLength(1);
        expect(detail.registration).not.toBeNull();
        expect(registrationLinks.items[0]!.expiresAt).toBe('2030-06-01T11:45:00.000Z');
        const person = participants.participants[0]!;
        const registrationLink = registrationLinks.items[0]!;
        const german = await germanEventWording(page, detail, person, registrationLink);
        await info.attach('pilot-de-date-wording-source', {body: JSON.stringify({detail, person, registrationLink, german}, null, 2),
            contentType: 'application/json'});
        const eventWrites: string[] = [];
        const documentRequests: string[] = [];
        page.on('request', request => {
            const path = new URL(request.url()).pathname;
            if (!['GET', 'HEAD'].includes(request.method())
                && (path.startsWith(`/api/v1/events/${event.id}`) || path.startsWith(`/api/event/${event.id}`)))
                eventWrites.push(request.method() + ' ' + path);
            if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documentRequests.push(request.url());
        });

        for (const pilot of [false, true]) {
            const prefix = pilot ? 'pilot' : 'native';
            // Observe the ordinary read before navigation: native loads its
            // roster immediately, while Vue admits the region independently.
            const participantsPath = `/api/${pilot ? 'v1/events' : 'event'}/${event.id}/participants`;
            function isParticipantsRead(response: Response): boolean {
                return response.request().method() === 'GET' && new URL(response.url()).pathname === participantsPath;
            }
            const participantsResponse = page.waitForResponse(isParticipantsRead);
            const pageSectionPaths = [`/api/v1/events/${event.id}/links`, `/api/v1/events/${event.id}/things-to-do`];
            /** Observe both distinct page projections for this administration
             * intent; initial reads must finish before observing a later Refresh. */
            function observePageSections(): Array<Promise<Response>> {
                return pageSectionPaths.map(path => page.waitForResponse(response => {
                    const url = new URL(response.url());
                    return response.request().method() === 'GET' && url.pathname === path
                        && (!path.endsWith('/things-to-do') || url.searchParams.get('view') === 'admin');
                }));
            }
            const initialPageSections = pilot ? observePageSections() : [];
            await page.goto(`${pilot ? '/frontend-pilot' : ''}/event/${event.id}/admin?locale=en`, {waitUntil: 'domcontentloaded'});
            if (pilot) await waitForPilotHydration(page);
            const roster = page.locator('.event-participants');
            let response = await participantsResponse;
            expect(await response.finished()).toBeNull();
            await expect(roster.locator('tbody .fw-semibold')).toHaveCount(1);
            for (const pending of initialPageSections) {
                const result = await pending;
                expect(result.status()).toBe(200);
                expect(await result.finished()).toBeNull();
            }

            // Root administration must retain its visible settings action;
            // region-only captures would miss that page responsibility.
            evidence[`${prefix}-settings-button`] = await metrics(page.getByRole('button', {name: 'Entity settings', exact: true}));
            if (pilot) {
                const native = evidence['native-settings-button']!;
                const current = evidence['pilot-settings-button']!;
                compare(native, current);
                expect(current.color).toBe(native.color);
                const refreshed = page.waitForResponse(response => response.request().method() === 'GET'
                    && new URL(response.url()).pathname === `/api/v1/events/${event.id}`
                    && new URL(response.url()).searchParams.get('view') === 'admin');
                // Refresh reads the detail first, then its active roster. Bind
                // that new response only after the initial roster has settled.
                const refreshedParticipants = page.waitForResponse(isParticipantsRead);
                const refreshedPageSections = observePageSections();
                const beforeRefreshNavigation = documentRequests.length;
                await page.evaluate(() => {document.documentElement.dataset.pilotDocument = 'event-page-refresh';});
                await page.getByRole('button', {name: 'Refresh', exact: true}).click();
                expect((await refreshed).status()).toBe(200);
                response = await refreshedParticipants;
                expect(await response.finished()).toBeNull();
                for (const pending of refreshedPageSections) {
                    const result = await pending;
                    expect(result.status()).toBe(200);
                    expect(await result.finished()).toBeNull();
                }
                expect(await page.evaluate(() => document.documentElement.dataset.pilotDocument)).toBe('event-page-refresh');
                expect(documentRequests).toHaveLength(beforeRefreshNavigation);
                expect(eventWrites).toEqual([]);
            }

            await roster.locator('.accordion-button').click();
            await expect(roster.locator('tbody .fw-semibold')).toHaveCount(1);
            const read = await dietaryRead(response, pilot);
            // Wait for this exact delivered choice order before the one-shot
            // geometry read; a previously mounted row can already have its count.
            const rows = roster.locator('tbody > tr[data-id], tbody > tr[data-registration-id]');
            for (const [index, participant] of read.participants.entries())
                await expect(rows.nth(index).locator('td').nth(3).locator('.badge')).toHaveText(participant.choices);
            dietary[prefix] = await dietaryMetrics(roster);
            const dietaryPath = info.outputPath(`${prefix}-dietary-sequences.json`);
            await writeFile(dietaryPath, JSON.stringify({url: response.url(), response: read, rendered: dietary[prefix]}, null, 2));
            await info.attach(`${prefix}-dietary-sequences`, {path: dietaryPath, contentType: 'application/json'});
            assertDietaryRead(read, dietary[prefix]!);
            evidence[`${prefix}-roster`] = await capture(page, info, `${prefix}-roster`, roster);
            if (pilot) {
                // T1 permits only independently delivered dietary positions to
                // differ. All other visible roster text and controls stay exact.
                const native = evidence['native-roster']!;
                const current = evidence['pilot-roster']!;
                compare({...native, text: remainingRosterText(native.text, dietary.native!)},
                    {...current, text: remainingRosterText(current.text, dietary.pilot!)});
                compareDietary(dietary.native!, dietary.pilot!);
            }

            const nativeNotes = roster.locator('.modal').filter({has: page.locator('.js-allergy-list')});
            if (pilot) await roster.getByRole('button', {name: 'Allergy / Comment Details', exact: true}).click();
            else await openModalForE2E(nativeNotes, roster.locator('.js-show-allergy-summary'));
            const notes = pilot ? page.getByRole('dialog') : nativeNotes.locator('.modal-content');
            evidence[`${prefix}-notes`] = await capture(page, info, `${prefix}-notes`, notes);
            if (pilot) compare(evidence['native-notes']!, evidence['pilot-notes']!);
            if (pilot) await notes.getByRole('button', {name: 'Close', exact: true}).click();
            else await closeModalForE2E(nativeNotes);

            const nativeDates = roster.locator('.js-date-modal');
            if (pilot) await roster.getByRole('button', {name: 'Edit dates', exact: true}).click();
            else await openModalForE2E(nativeDates, roster.locator('.btn-edit-dates'));
            const dates = pilot ? page.getByRole('dialog') : nativeDates.locator('.modal-content');
            evidence[`${prefix}-dates`] = await capture(page, info, `${prefix}-dates`, dates);
            if (pilot) compare(evidence['native-dates']!, evidence['pilot-dates']!);
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
            if (pilot) compare(evidence['native-create-link']!, evidence['pilot-create-link']!);
            if (pilot) await create.getByRole('button', {name: 'Close', exact: true}).click();
            else await closeModalForE2E(nativeCreate);

            if (pilot) {
                // Translate the already-mounted admin consumers with a genuine
                // filter draft and stable row/token nodes, without an Event write.
                const filter = roster.locator('.js-filter');
                await filter.fill(person.name);
                const filterNode = await filter.elementHandle();
                const linkRow = links.locator(`[data-link-id="${registrationLink.id}"]`);
                const tokenNode = await linkRow.locator('code').elementHandle();
                const beforeNavigation = documentRequests.length;
                await page.evaluate(() => {document.documentElement.dataset.pilotDocument = 'event-admin-locale';});
                await selectOrganizerLocale(page, 'en', 'de');
                const summary = page.locator('main dl').first();
                await expect(summary.locator('dd').first().locator('span')).toHaveText(german.dates);
                const deadlines = summary.locator('dd').last().locator('p');
                for (const [index, expected] of german.deadlines.entries())
                    await expect(deadlines.nth(index).locator('span').first()).toHaveText(expected);
                await expect(roster.locator(`[data-registration-id="${person.id}"] td`).nth(2)).toHaveText(german.roster);
                await expect(linkRow.locator('td').nth(1)).toHaveText(german.links[0]!);
                await expect(linkRow.locator('td').nth(2)).toHaveText(german.links[1]!);
                await expect(linkRow.locator('code')).toHaveText(registrationLink.token);
                await expect(filter).toHaveValue(person.name);
                expect(await filter.evaluate((node, original) => node === original, filterNode)).toBe(true);
                expect(await linkRow.locator('code').evaluate((node, original) => node === original, tokenNode)).toBe(true);
                evidence['pilot-de-summary'] = await capture(page, info, 'pilot-de-summary', summary);
                evidence['pilot-de-roster'] = await capture(page, info, 'pilot-de-roster', roster);
                evidence['pilot-de-links'] = await capture(page, info, 'pilot-de-links', links);
                await selectOrganizerLocale(page, 'de', 'en');
                await expect(filter).toHaveValue(person.name);
                expect(await page.evaluate(() => document.documentElement.dataset.pilotDocument)).toBe('event-admin-locale');
                expect(documentRequests).toHaveLength(beforeNavigation);
                expect(eventWrites).toEqual([]);
                await filter.clear();
                await filterNode?.dispose();
                await tokenNode?.dispose();
            }

            // Administration retains native destinations for its comparator and
            // uses the accepted Drivers route in the migrated document.
            const drivers = page.getByRole('button', {name: /Event drivers lists/u});
            await drivers.click();
            const driver = children.find(child => child.path.startsWith('/drivers/'))!;
            const driverPath = `${pilot ? '/frontend-pilot' : ''}${driver.path}`;
            const driverLink = page.locator(`a[href="${driverPath}"]`);
            await expect(driverLink).toBeVisible();
            await expect(driverLink).toContainText(driver.title);
            await expect(page.locator(`a[href="${driverPath}/duplicate"]`)).toBeVisible();

            await page.goto(`${pilot ? '/frontend-pilot' : ''}/event/${event.id}?locale=en`, {waitUntil: 'domcontentloaded'});
            if (pilot) await waitForPilotHydration(page);
            const registered = page.locator('#registrationForm').locator('xpath=ancestor::*[contains(concat(" ",normalize-space(@class)," ")," card ")][1]');
            await expect(registered).toContainText('Your registration');
            evidence[`${prefix}-registered`] = await capture(page, info, `${prefix}-registered`, registered);
            if (pilot) {
                compare(evidence['native-registered']!, evidence['pilot-registered']!);
            }
            const things = page.locator('.entity-overview').filter({has: page.getByRole('button', {name: /Things to do/u})});
            await expect(things.locator('article, .card.js-item')).toHaveCount(3);
            evidence[`${prefix}-things`] = await capture(page, info, `${prefix}-things`, things);
            if (pilot) compare(evidence['native-things']!, evidence['pilot-things']!);
            await expect(things).not.toContainText('Only my overview');
            if (pilot) {
                // The saved attendance text translates independently of the
                // user's dirty date control and retains that exact DOM node.
                const departure = registered.locator('[name="departureDate"]');
                await departure.fill('2030-06-03');
                const departureNode = await departure.elementHandle();
                const beforeNavigation = documentRequests.length;
                await page.evaluate(() => {document.documentElement.dataset.pilotDocument = 'event-attendance-locale';});
                await selectOrganizerLocale(page, 'en', 'de');
                await expect(registered.locator('#arrival')).toHaveText(german.attendance[0]!);
                await expect(registered.locator('#departure')).toHaveText(german.attendance[1]!);
                await expect(departure).toHaveValue('2030-06-03');
                expect(await departure.evaluate((node, original) => node === original, departureNode)).toBe(true);

                // A deliberate public-page Refresh reads its current detail,
                // roster and related cards without consuming the dirty draft or
                // filter. Existing rendered rows establish initial read readiness.
                const thingsFilter = page.locator('main .entity-overview input[type="search"]');
                await thingsFilter.fill('Event');
                const thingsFilterNode = await thingsFilter.elementHandle();
                await expect(page.locator('.event-participants tbody .fw-semibold')).toHaveCount(1);
                const refreshReads = [{path: `/api/v1/events/${event.id}`, view: 'detail'},
                    {path: `/api/v1/events/${event.id}/participants`, view: null},
                    {path: `/api/v1/events/${event.id}/things-to-do`, view: 'detail'}]
                    .map(({path, view}) => page.waitForResponse(response => {
                        const url = new URL(response.url());
                        return response.request().method() === 'GET' && url.pathname === path
                            && (view === null || url.searchParams.get('view') === view);
                    }));
                await page.locator('main > section.card > .card-body > .d-flex.mb-1').getByRole('button', {name: createTranslator('de').t('common.refresh'), exact: true}).click();
                for (const pending of refreshReads) {
                    const result = await pending;
                    expect(result.status()).toBe(200);
                    expect(await result.finished()).toBeNull();
                }
                await expect(departure).toHaveValue('2030-06-03');
                await expect(thingsFilter).toHaveValue('Event');
                expect(await departure.evaluate((node, original) => node === original, departureNode)).toBe(true);
                expect(await thingsFilter.evaluate((node, original) => node === original, thingsFilterNode)).toBe(true);
                evidence['pilot-de-registered'] = await capture(page, info, 'pilot-de-registered', registered);
                expect(await page.evaluate(() => document.documentElement.dataset.pilotDocument)).toBe('event-attendance-locale');
                expect(documentRequests).toHaveLength(beforeNavigation);
                expect(eventWrites).toEqual([]);
                await departureNode?.dispose();
                await thingsFilterNode?.dispose();
            }
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
        }
        await writeFile(info.outputPath('native-pilot-organizer-metrics.json'), JSON.stringify(evidence, null, 2));
        expect(errors).toEqual([]);
    });
}
