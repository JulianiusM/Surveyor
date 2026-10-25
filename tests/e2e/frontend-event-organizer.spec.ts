import {expect, test} from '@playwright/test';
import type {Dialog, Locator, Page, Response, Route, TestInfo} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createE2EActivityPlan, createE2EDriversList, createE2ELogin, createE2EPackingList} from '../factories/e2eCoreFactory';
import {createResourceViaForm, expectUsableFrontendLayout, loginForE2E,
    projectCreationPermissionDisclosure, readControlContracts, readVisiblePresentation, updateEntityMetadataForE2E} from '../keywords/e2eCoreKeywords';
import {createFrontendEventFixture, frontendEventHeaders} from '../keywords/frontendEventE2EKeywords';
import {waitForFrontendHydration} from '../keywords/frontendDynamicKeywords';
import type {components} from '../../src/types/api/v1';
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
    const attendance = await page.request.put(`/api/v1/events/${event.id}/registration`, {headers: await frontendEventHeaders(page.request), data: {
        arrivalDate: '2030-06-01', departureDate: '2030-06-04', dietary: ['MEAT', 'ALLERGIES', 'COMMENT'],
        allergyNotes: 'Peanuts; Lactose', dietComment: 'No tomatoes',
    }});
    expect(attendance.status()).toBe(200);
    if (dateWording) {
        // Only the matched presentation cases need a real nonempty deadline.
        // Save it after attendance through the existing native metadata owner.
        await updateEntityMetadataForE2E(page.request, 'events', event.id, {
            bindingDeadline: '2030-05-31T12:34', deadlineTz: 'Europe/Berlin',
        });
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
        await page.goto(`/event/${event.id}/admin?locale=en`, {waitUntil: 'domcontentloaded'});
        await waitForFrontendHydration(page);
        await page.evaluate(() => {document.documentElement.dataset.frontendDocument = 'event-child-delete';});
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
        await expect(page).toHaveURL(/\/users\/dashboard$/u);
        expect(await page.evaluate(() => document.documentElement.dataset.frontendDocument)).toBe('event-child-delete');
        expect(documentRequests).toEqual([]);
        expect(deletes).toEqual([operation]);
        const remaining = await page.request.get(`/api/v1/events/${event.id}/things-to-do?view=admin`,
            {headers: await frontendEventHeaders(page.request)});
        expect(remaining.status()).toBe(200);
        const projection = await remaining.json() as components['schemas']['EventThingsToDo'];
        expect(projection.items.some(item => item.id === child.id)).toBe(false);
    });
}

test('protects a new attendance draft after confirmed child deletion fails its first destination delivery', async ({page}) => {
    const {event, children} = await organizerFixture(page, true);
    const child = children.find(value => value.path.startsWith('/packing/'))!;
    await page.goto(`/event/${event.id}/admin?locale=en`, {waitUntil: 'domcontentloaded'});
    await waitForFrontendHydration(page);
    // Create real SPA history before opening any modal. Browser Forward remains
    // available above its overlay and reaches the same router draft guard.
    const help = page.locator('header a.nav-link').filter({hasText: /^Help$/u});
    const adminUrl = page.url();
    await help.click();
    await expect(page).toHaveURL(/\/help(?:\?|$)/u);
    await page.goBack();
    await expect(page).toHaveURL(adminUrl);
    const origin = await page.evaluate(() => performance.timeOrigin);
    const original = page.url();
    const deletes: string[] = [];
    const documents: string[] = [];
    page.on('request', request => {
        if (request.method() === 'DELETE') deletes.push(new URL(request.url()).pathname);
        if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documents.push(request.url());
    });

    // A failed lazy-chunk delivery keeps the actual admitted organizer mounted.
    // DELETE and every application read still use the prepared integrated backend.
    let failedDelivery = 0;
    const chunk = '**/OverviewPage-*.js';
    async function failOverviewDelivery(route: Route): Promise<void> {
        failedDelivery++;
        await route.abort('failed');
    }
    await page.route(chunk, failOverviewDelivery);
    try {
        await page.locator('.dashboard-accordion-item > .accordion-header > button').first().click();
        const row = page.locator('.dashboard-list .list-group-item')
            .filter({has: page.getByRole('link', {name: child.title, exact: true})});
        const operation = `/api/v1/events/${event.id}/things-to-do/packing/${child.id}`;
        const deleted = page.waitForResponse(response => response.request().method() === 'DELETE'
            && new URL(response.url()).pathname === operation);
        page.once('dialog', confirmation => confirmation.accept());
        await row.getByRole('button', {name: 'Delete', exact: true}).click();
        expect((await deleted).status()).toBe(200);
        await expect(page.getByRole('button', {name: createTranslator('en').t('common.retry'), exact: true})).toBeEnabled();
        expect(failedDelivery).toBeGreaterThan(0);
        await expect(page).toHaveURL(original);

        // The child receipt already owns confirmed departure recovery. Another
        // mounted removal owner must not issue a parent DELETE whose outcome
        // cannot obtain its own receipt; ordinary admitted editing stays usable.
        await page.getByRole('button', {name: 'Entity settings', exact: true}).click();
        const settings = page.getByRole('dialog', {name: 'Entity settings', exact: true});
        await expect(settings.locator('[name="title"]')).toBeEnabled();
        await settings.getByRole('tab', {name: 'Actions', exact: true}).click();
        await expect(settings.getByRole('button', {name: 'Delete permanently', exact: true})).toBeDisabled();
        await expect(settings.getByRole('button', {name: 'Archive for everyone', exact: true})).toBeEnabled();
        expect(deletes).toEqual([operation]);
        await settings.screenshot({path: test.info().outputPath('retained-child-parent-actions.png')});
        await settings.getByRole('button', {name: 'Close', exact: true}).last().click();
        await expect(settings).toHaveCount(0);

        // This edit begins after the original attempt has settled. Its own discard
        // decision must therefore govern a later ordinary same-document departure.
        const roster = page.locator('.event-participants');
        await roster.locator('.accordion-button').click();
        await roster.getByRole('button', {name: 'Edit dates', exact: true}).click();
        const dates = page.getByRole('dialog');
        const arrival = dates.locator('[name="arrivalDate"]');
        await arrival.fill('2030-06-02');
        const retained = await arrival.elementHandle();
        const questions: string[] = [];
        let permitDeparture = false;
        async function answerDiscard(dialog: Dialog): Promise<void> {
            questions.push(dialog.message());
            if (permitDeparture) await dialog.accept();
            else await dialog.dismiss();
        }
        page.on('dialog', answerDiscard);
        await page.goForward();
        await expect.poll(() => questions.length).toBe(1);
        await expect(page).toHaveURL(original);
        await expect(arrival).toHaveValue('2030-06-02');
        expect(await arrival.evaluate((input, prior) => input === prior, retained)).toBe(true);
        expect(deletes).toEqual([operation]);

        permitDeparture = true;
        await page.goForward();
        await expect(page).toHaveURL(/\/help(?:\?|$)/u);
        expect(questions).toHaveLength(2);
        expect(questions[1]).toBe(questions[0]);
        expect(deletes).toEqual([operation]);
        expect(documents).toEqual([]);
        expect(await page.evaluate(() => performance.timeOrigin)).toBe(origin);
        const saved = await page.request.get(`/api/v1/events/${event.id}/participants`, {
            headers: await frontendEventHeaders(page.request),
        });
        expect(saved.status()).toBe(200);
        const projection = await saved.json() as components['schemas']['EventParticipants'];
        expect(projection.participants[0]?.arrivalDate).toBe('2030-06-01');
    } finally { await page.unroute(chunk, failOverviewDelivery); }
});

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

/** Store each independent native/frontend picture and its raw browser evidence. */
async function capture(page: Page, info: TestInfo, name: string, surface: Locator, creation = false) {
    await surface.scrollIntoViewIfNeeded();
    await page.evaluate(() => document.fonts.ready);
    if (name.startsWith('frontend-')) await expectUsableFrontendLayout(surface);
    const result = await metrics(surface);
    const path = info.outputPath(`${name}.png`);
    await page.screenshot({path, animations: 'disabled', fullPage: true});
    await info.attach(name, {path, contentType: 'image/png'});
    await info.attach(`${name}-metrics`, {body: JSON.stringify(result, null, 2), contentType: 'application/json'});
    if (!creation) return result;
    // Raw metrics above retain the new heading; only the directly requested
    // disclosure is projected out of the existing full-field comparison.
    const projected = await projectCreationPermissionDisclosure(surface, await readVisiblePresentation(surface, []));
    return {...result, text: projected.content.text};
}

/** Decode the ordinary observed roster response without another request or any
 * substitution, preserving its participant and dietary choice sequences. */
async function dietaryRead(response: Response): Promise<DietaryRead> {
    expect(response.status()).toBe(200);
    const data = await response.json() as components['schemas']['EventParticipants'];
    return {participants: data.participants.map(function participantChoices(row) {
        return {id: row.id, choices: row.dietary.map(choice => choice.choice)};
    }), totals: data.totals};
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

/** Retain raw control geometry alongside the browser constraints and state.
 * Permission serialization has its own independent HTTP assertions. */
async function formControls(surface: Locator) {
    const measured = await surface.evaluate(function measureControls(element) {
        const controls = [...element.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input,textarea,select')]
            .filter(control => control.type !== 'hidden' && control.getClientRects().length && control.checkVisibility());
        return {timezone: element.querySelector<HTMLInputElement>('input[name="deadlineTz"]')?.value ?? null,
            controls: controls.map(control => ({name: control.closest('.perm-matrix') && control.type === 'checkbox' ? 'permission' : control.name,
                width: control.getBoundingClientRect().width, height: control.getBoundingClientRect().height}))};
    });
    // Use the common control owner rather than a less complete Event-only
    // snapshot. Hidden timezone transport remains separate explicit evidence.
    const contracts = await readControlContracts(surface.locator('input:not([type="hidden"]),textarea,select'));
    expect(contracts).toHaveLength(measured.controls.length);
    return {...measured, controls: measured.controls.map((control, index) => ({...control, contract: contracts[index]}))};
}

for (const width of [1280, 390]) {
    test(`keeps Event creation and settings forms usable at ${width}px`, async ({page}, info) => {
        test.setTimeout(120_000);
        await page.setViewportSize({width, height: 900});
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        await loginForE2E(page.request, createE2ELogin());
        const evidence: Record<string, unknown> = {};
        {
            const prefix = 'frontend';
            await page.goto(`${''}/event/create?locale=en`, {waitUntil: 'domcontentloaded'});
            {
                await waitForFrontendHydration(page);
                const permissions = page.locator('[data-creation-permissions] .accordion-button');
                await expect(permissions).toHaveAttribute('aria-expanded', 'false');
                await permissions.click();
            }
            const form = page.locator('#eventForm');
            await expect(form.locator('.perm-matrix input[type="checkbox"]').first()).toBeVisible();
            evidence[`${prefix}-creation`] = await capture(page, info, `${prefix}-creation`, form, true);
            evidence[`${prefix}-creation-controls`] = await formControls(form);
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
        }

        const event = await createFrontendEventFixture(page.request);
        {
            const prefix = 'frontend';
            await page.goto(`${''}/event/${event.id}?locale=en`, {waitUntil: 'domcontentloaded'});
            await waitForFrontendHydration(page);
            const opener = page.getByRole('button', {name: 'Entity settings', exact: true});
            await opener.click();
            const dialog = page.getByRole('dialog');
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
            await dialog.getByRole('button', {name: 'Close', exact: true}).last().click();
        }
        await writeFile(info.outputPath('event-forms.json'), JSON.stringify(evidence, null, 2));
        expect(errors).toEqual([]);
    });
}

test('organizer dates, link revocation and participant PDF use the integrated application', async ({page}) => {
    const {event} = await organizerFixture(page);
    await page.goto(`/event/${event.id}/admin?locale=en`, {waitUntil: 'domcontentloaded'});
    await waitForFrontendHydration(page);
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
    test(`keeps organizer dialogs, roster and shared child cards usable at ${width}px`, async ({page}, info) => {
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
        await info.attach('frontend-de-date-wording-source', {body: JSON.stringify({detail, person, registrationLink, german}, null, 2),
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

        {
            const prefix = 'frontend';
            // Observe the ordinary read before navigation: native loads its
            // roster immediately, while Vue admits the region independently.
            const participantsPath = `/api/v1/events/${event.id}/participants`;
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
            const initialPageSections = observePageSections();
            await page.goto(`${''}/event/${event.id}/admin?locale=en`, {waitUntil: 'domcontentloaded'});
            await waitForFrontendHydration(page);
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
            {
                const current = evidence['frontend-settings-button']!;
                expect(current.text).toContain('Entity settings');
                const refreshed = page.waitForResponse(response => response.request().method() === 'GET'
                    && new URL(response.url()).pathname === `/api/v1/events/${event.id}`
                    && new URL(response.url()).searchParams.get('view') === 'admin');
                // Refresh reads the detail first, then its active roster. Bind
                // that new response only after the initial roster has settled.
                const refreshedParticipants = page.waitForResponse(isParticipantsRead);
                const refreshedPageSections = observePageSections();
                const beforeRefreshNavigation = documentRequests.length;
                await page.evaluate(() => {document.documentElement.dataset.frontendDocument = 'event-page-refresh';});
                // Finance has its own independently scoped Refresh. This action
                // belongs to the Event page and its complete projection family.
                await page.locator('main > section.card > .card-header .frontend-page-heading-actions')
                    .getByRole('button', {name: 'Refresh', exact: true}).click();
                expect((await refreshed).status()).toBe(200);
                response = await refreshedParticipants;
                expect(await response.finished()).toBeNull();
                for (const pending of refreshedPageSections) {
                    const result = await pending;
                    expect(result.status()).toBe(200);
                    expect(await result.finished()).toBeNull();
                }
                expect(await page.evaluate(() => document.documentElement.dataset.frontendDocument)).toBe('event-page-refresh');
                expect(documentRequests).toHaveLength(beforeRefreshNavigation);
                expect(eventWrites).toEqual([]);
            }

            await roster.locator('.accordion-button').click();
            await expect(roster.locator('tbody .fw-semibold')).toHaveCount(1);
            const read = await dietaryRead(response);
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

            await roster.getByRole('button', {name: 'Allergy / Comment Details', exact: true}).click();
            const notes = page.getByRole('dialog');
            evidence[`${prefix}-notes`] = await capture(page, info, `${prefix}-notes`, notes);
            await expect(notes).toContainText('Peanuts');
            await expect(notes).toContainText('No tomatoes');
            await notes.getByRole('button', {name: 'Close', exact: true}).click();

            await roster.getByRole('button', {name: 'Edit dates', exact: true}).click();
            const dates = page.getByRole('dialog');
            evidence[`${prefix}-dates`] = await capture(page, info, `${prefix}-dates`, dates);
            await expect(dates.locator('[name="arrivalDate"]')).toHaveValue(person.arrivalDate!);
            await expect(dates.locator('[name="departureDate"]')).toHaveValue(person.departureDate!);
            await dates.getByRole('button', {name: 'Close', exact: true}).click();

            const links = page.locator('.reg-links');
            await links.locator('.accordion-button').click();
            await expect(links.locator('tbody code')).toHaveCount(1);
            await links.getByRole('button', {name: 'Create link', exact: true}).click();
            const create = page.getByRole('dialog');
            evidence[`${prefix}-create-link`] = await capture(page, info, `${prefix}-create-link`, create);
            await expect(create.getByRole('button', {name: 'Create', exact: true})).toBeEnabled();
            await create.getByRole('button', {name: 'Close', exact: true}).click();

            {
                // Translate the already-mounted admin consumers with a genuine
                // filter draft and stable row/token nodes, without an Event write.
                const filter = roster.locator('.js-filter');
                await filter.fill(person.name);
                const filterNode = await filter.elementHandle();
                const linkRow = links.locator(`[data-link-id="${registrationLink.id}"]`);
                const tokenNode = await linkRow.locator('code').elementHandle();
                const beforeNavigation = documentRequests.length;
                await page.evaluate(() => {document.documentElement.dataset.frontendDocument = 'event-admin-locale';});
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
                evidence['frontend-de-summary'] = await capture(page, info, 'frontend-de-summary', summary);
                evidence['frontend-de-roster'] = await capture(page, info, 'frontend-de-roster', roster);
                evidence['frontend-de-links'] = await capture(page, info, 'frontend-de-links', links);
                await selectOrganizerLocale(page, 'de', 'en');
                await expect(filter).toHaveValue(person.name);
                expect(await page.evaluate(() => document.documentElement.dataset.frontendDocument)).toBe('event-admin-locale');
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
            const driverPath = `${''}${driver.path}`;
            const driverLink = page.locator(`a[href="${driverPath}"]`);
            await expect(driverLink).toBeVisible();
            await expect(driverLink).toContainText(driver.title);
            await expect(page.locator(`a[href="${driverPath}/duplicate"]`)).toBeVisible();

            await page.goto(`${''}/event/${event.id}?locale=en`, {waitUntil: 'domcontentloaded'});
            await waitForFrontendHydration(page);
            const registered = page.locator('#registrationForm').locator('xpath=ancestor::*[contains(concat(" ",normalize-space(@class)," ")," card ")][1]');
            await expect(registered).toContainText('Your registration');
            evidence[`${prefix}-registered`] = await capture(page, info, `${prefix}-registered`, registered);
            const things = page.locator('.entity-overview').filter({has: page.getByRole('button', {name: /Things to do/u})});
            await expect(things.locator('article, .card.js-item')).toHaveCount(3);
            evidence[`${prefix}-things`] = await capture(page, info, `${prefix}-things`, things);
            for (const child of children) await expect(things).toContainText(child.title);
            await expect(things).not.toContainText('Only my overview');
            {
                // The saved attendance text translates independently of the
                // user's dirty date control and retains that exact DOM node.
                const departure = registered.locator('[name="departureDate"]');
                await departure.fill('2030-06-03');
                const departureNode = await departure.elementHandle();
                const beforeNavigation = documentRequests.length;
                await page.evaluate(() => {document.documentElement.dataset.frontendDocument = 'event-attendance-locale';});
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
                await page.locator('main > section.card > .card-header .frontend-page-heading-actions')
                    .getByRole('button', {name: createTranslator('de').t('common.refresh'), exact: true}).click();
                for (const pending of refreshReads) {
                    const result = await pending;
                    expect(result.status()).toBe(200);
                    expect(await result.finished()).toBeNull();
                }
                await expect(departure).toHaveValue('2030-06-03');
                await expect(thingsFilter).toHaveValue('Event');
                expect(await departure.evaluate((node, original) => node === original, departureNode)).toBe(true);
                expect(await thingsFilter.evaluate((node, original) => node === original, thingsFilterNode)).toBe(true);
                evidence['frontend-de-registered'] = await capture(page, info, 'frontend-de-registered', registered);
                expect(await page.evaluate(() => document.documentElement.dataset.frontendDocument)).toBe('event-attendance-locale');
                expect(documentRequests).toHaveLength(beforeNavigation);
                expect(eventWrites).toEqual([]);
                await departureNode?.dispose();
                await thingsFilterNode?.dispose();
            }
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
        }
        await writeFile(info.outputPath('organizer-metrics.json'), JSON.stringify(evidence, null, 2));
        expect(errors).toEqual([]);
    });
}
