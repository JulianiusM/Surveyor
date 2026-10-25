import {expect, test, type Locator, type Page, type TestInfo} from '@playwright/test';
import type {components} from '../../src/types/api/v1';
import type {Locale} from '../../src/types/LocalizationTypes';
import {createTranslator} from '../../src/modules/localization/translator';
import {captureActivityPresentation} from '../keywords/frontendActivityE2EKeywords';
import {updateEntityMetadataForE2E} from '../keywords/e2eCoreKeywords';
import {createAdvancedActivityForE2E, readActivityRecommendationsForE2E} from '../keywords/frontendActivityAdvancedE2EKeywords';
import {waitForFrontendHydration} from '../keywords/frontendDynamicKeywords';
import {frontendEventHeaders} from '../keywords/frontendEventE2EKeywords';

// Each real DST weekend also crosses Monday. The explicit expected days/groups
// are independent of the production calendar helper and cover both offset signs.
const calendarRanges = [
    {zone: 'America/Los_Angeles', days: ['2030-03-09', '2030-03-10', '2030-03-11'], offsets: [480, 420, 420],
        weeks: [{start: '2030-03-04', days: ['2030-03-09', '2030-03-10']},
            {start: '2030-03-11', days: ['2030-03-11']}]},
    {zone: 'Europe/Berlin', days: ['2030-03-30', '2030-03-31', '2030-04-01'], offsets: [-60, -120, -120],
        weeks: [{start: '2030-03-25', days: ['2030-03-30', '2030-03-31']},
            {start: '2030-04-01', days: ['2030-04-01']}]},
] as const;
type CalendarRange = typeof calendarRanges[number];
type CalendarFixture = Awaited<ReturnType<typeof createAdvancedActivityForE2E>>;
type CalendarWording = Awaited<ReturnType<typeof expectedCalendarWording>>;

/** Format known wire values independently through the actual browser's Intl.
 * Civil dates have an explicit UTC representation; deadline/link instants keep
 * their Event/browser zone. Noon offsets prove the selected range spans DST. */
async function expectedCalendarWording(page: Page, range: CalendarRange, locale: Locale,
    event: components['schemas']['EventView'], link: components['schemas']['EventRegistrationLink']) {
    return page.evaluate(function browserCalendar(source) {
        const full = new Intl.DateTimeFormat(source.locale, {dateStyle: 'full', timeZone: 'UTC'});
        const short = new Intl.DateTimeFormat(source.locale, {timeZone: 'UTC'});
        const weekday = new Intl.DateTimeFormat(source.locale, {weekday: 'short', timeZone: 'UTC'});
        const instant = new Date(source.deadline!);
        // These are separate display contracts: UTC protects civil day identity,
        // while omitting timeZone intentionally preserves the viewer's instant.
        const timestamps = new Intl.DateTimeFormat(source.locale, {year: 'numeric', month: 'numeric', day: 'numeric',
            hour: 'numeric', minute: 'numeric', second: 'numeric'});
        return {browserZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            offsets: source.days.map(day => new Date(day + 'T12:00:00').getTimezoneOffset()),
            days: source.days.map(day => {const date = new Date(day + 'T00:00:00Z');
                return {day, full: full.format(date), short: short.format(date), weekday: weekday.format(date)};}),
            deadlineEvent: new Intl.DateTimeFormat(source.locale, {dateStyle: 'full', timeStyle: 'full', timeZone: source.eventZone}).format(instant),
            deadlineBrowser: new Intl.DateTimeFormat(source.locale, {dateStyle: 'full', timeStyle: 'full'}).format(instant),
            linkCreated: timestamps.format(new Date(source.created)), linkExpires: timestamps.format(new Date(source.expires!))};
    }, {locale, days: [...range.days], deadline: event.bindingDeadline, eventZone: event.timezone || 'UTC',
        created: link.createdAt, expires: link.expiresAt});
}

/** Assert the visible civil-day labels and exact clipped week groups. Creation
 * lacks stored-key attributes, so its date inputs and each rendered header are
 * checked; saved/recommendation surfaces also expose the admitted ISO day keys. */
async function expectActivityCalendar(surface: Locator, range: CalendarRange, wording: CalendarWording,
    locale: Locale, creation = false): Promise<void> {
    const tables = surface.locator('table.activity-table');
    await expect(tables).toHaveCount(range.weeks.length);
    for (const [index, week] of range.weeks.entries()) {
        const cells = tables.nth(index).locator('thead th');
        const labels = week.days.map(day => wording.days.find(value => value.day === day)!);
        // innerText records the painted line break between weekday and date.
        // Normalize whitespace only; retain every word, number and punctuation.
        await expect.poll(() => cells.evaluateAll(nodes => nodes.map(node => (node as HTMLElement).innerText.replace(/\s+/gu, ' ').trim())))
            .toEqual(labels.map(value => value.weekday + ' ' + value.short));
        if (!creation) {
            for (const [dayIndex, day] of week.days.entries()) await expect(cells.nth(dayIndex)).toHaveAttribute('data-date', day);
        }
    }
    if (!creation) await expect(surface.locator('h4.mt-4, h5.mt-4')).toHaveText(range.weeks.map(week =>
        createTranslator(locale).t('activity.weekOf', {date: week.start})));
}

/** Inspect built creation/detail/review consumers using the same saved plan.
 * Explicit expectations retain the approved calendar correction independently
 * of the finite recorded native screenshot baseline. */
async function inspectActivityCalendars(page: Page, info: TestInfo, fixture: CalendarFixture,
    range: CalendarRange, wording: CalendarWording, locale: Locale): Promise<void> {
    {
        const prefix = 'vue';
        const path = fixture.path;
        // A clean copied form exercises the actual creation renderer without
        // introducing another persisted plan or accepting a dirty departure.
        await page.goto(`${path}/duplicate?locale=${locale}`, {waitUntil: 'domcontentloaded'});
        await waitForFrontendHydration(page);
        await expect(page.locator('#slotArea th').first()).toBeVisible();
        const creation = page.locator('#slotArea');
        {
            await expect(page.locator('#startDate')).toHaveValue(range.days[0]);
            await expect(page.locator('#endDate')).toHaveValue(range.days[2]);
            await expect(creation.locator('.slot')).toHaveCount(fixture.view.slots.length);
            await expectActivityCalendar(creation, range, wording, locale, true);
        }
        await captureActivityPresentation(page, info, `${prefix}-calendar-creation`, creation, ['th', 'label', 'input', 'button']);

        await page.goto(`${path}?locale=${locale}`, {waitUntil: 'domcontentloaded'});
        await waitForFrontendHydration(page);
        const schedule = page.locator('#tab-schedule');
        await expect(schedule.locator('.slot')).toHaveCount(fixture.view.slots.length);
        await expectActivityCalendar(schedule, range, wording, locale);
        await captureActivityPresentation(page, info, `${prefix}-calendar-detail`, schedule, ['h4', 'th', '.slot', 'small', '.badge']);

        // Existing page entry prepares recommendations once. Merely reading
        // these calendars must not press Auto or submit a recommendation batch.
        await page.getByRole('tab', {name: createTranslator(locale).t('activity.rules'), exact: true}).click();
        const recommendations = page.locator('#recommendationScheduleView');
        await expect(recommendations.locator('[data-rec-id]')).toHaveCount(1);
        {
            await expectActivityCalendar(recommendations, range, wording, locale);
            await expect(recommendations.locator('[data-rec-id]')).toHaveAttribute('data-slot-id', fixture.view.slots[1]!.id);
            await expect(recommendations.locator('[data-rec-id]')).toContainText(fixture.other.name);
        }
        await captureActivityPresentation(page, info, `${prefix}-calendar-recommendations`, recommendations,
            ['h5', 'th', '.slot', 'small', '.badge', '[data-rec-id]']);
    }
}

/** Observe saved Event civil dates alongside genuine instant displays. Roster
 * and registration read the same real attendance; links retain their existing
 * local timestamp formatter instead of accidentally adopting civil-date UTC. */
async function inspectEventCalendar(page: Page, info: TestInfo, fixture: CalendarFixture, range: CalendarRange,
    wording: CalendarWording, locale: Locale, link: components['schemas']['EventRegistrationLink']): Promise<void> {
    {
        await page.goto(`${fixture.event.path}?locale=${locale}`, {waitUntil: 'domcontentloaded'});
        await waitForFrontendHydration(page);
        const participants = page.locator('.event-participants');
        await participants.locator('.accordion-button').click();
        await expect(participants.locator('tbody .fw-semibold')).toHaveCount(2);
        {
            await expect(page.locator('html')).toHaveAttribute('lang', locale);
            const summary = page.locator('main dl').first();
            await expect(summary.locator('dd').first()).toHaveText(wording.days[0]!.full + '→' + wording.days[2]!.full);
            await expect(summary.locator('p .ms-2').first()).toHaveText(wording.deadlineEvent);
            await expect(summary.locator('p .ms-2').nth(1)).toHaveText(wording.deadlineBrowser);
            await expect(page.locator('#arrival')).toHaveText(wording.days[0]!.full);
            await expect(page.locator('#departure')).toHaveText(wording.days[2]!.full);
            await expect(page.locator('#arrivalDate')).toHaveValue(range.days[0]);
            await expect(page.locator('#departureDate')).toHaveValue(range.days[2]);
            for (const person of [fixture.owner, fixture.other]) {
                const row = participants.locator('tbody tr').filter({has: page.getByText(person.name, {exact: true})});
                await expect(row.locator('td').nth(2).locator('div')).toHaveText(wording.days[0]!.short + ' → ' + wording.days[2]!.short);
            }
        }
        // One full Event original includes the summary, saved attendance and
        // disclosed roster; separate screenshots would repeat the same content.
        await captureActivityPresentation(page, info, 'vue-calendar-event', page.locator('main'),
            ['dt', 'dd', '#arrival', '#departure', 'input[type="date"]', 'th', 'tbody td']);
    }

    await page.goto(`${fixture.event.path}/admin?locale=${locale}`, {waitUntil: 'domcontentloaded'});
    await waitForFrontendHydration(page);
    const links = page.locator('.reg-links');
    await links.locator('.accordion-button').click();
    const row = links.locator(`[data-link-id="${link.id}"]`);
    await expect(row.locator('td').nth(1)).toHaveText(wording.linkCreated);
    await expect(row.locator('td').nth(2)).toHaveText(wording.linkExpires);
    // On mobile the token fills the initial local table viewport. Reveal the
    // actual timestamp columns through ordinary scrolling before preserving
    // pixels; a text assertion alone does not make those dates visually reviewed.
    await row.locator('td').nth(2).scrollIntoViewIfNeeded();
    await captureActivityPresentation(page, info, 'vue-calendar-link-instants', links, ['th', 'td', 'button']);
}

for (const range of calendarRanges) {
    test.describe(`civil calendar in ${range.zone}`, () => {
        test.use({timezoneId: range.zone});
        for (const {locale, width} of [{locale: 'en', width: 1280}, {locale: 'de', width: 390}] as const) {
            test.describe(`${locale} at ${width}px`, () => {
                test.use({locale, viewport: {width, height: 900}});
                test('keeps saved days and clipped Monday weeks across DST in Activity and Event', async ({page}, info) => {
                    test.setTimeout(90_000);
                    // All data goes through the integrated application and its
                    // existing real fixture operations on the prepared E2E DB.
                    const fixture = await createAdvancedActivityForE2E(page.request, {recommendation: true,
                        period: {startDate: range.days[0], endDate: range.days[2]}});
                    expect(fixture.view.weeks).toEqual(range.weeks);
                    expect(fixture.view.slots.every(slot => slot.day === range.days[0])).toBe(true);
                    const headers = await frontendEventHeaders(page.request);
                    await updateEntityMetadataForE2E(page.request, 'events', fixture.event.id, {
                        bindingDeadline: range.days[1] + 'T01:30', deadlineTz: 'Europe/Berlin',
                    });
                    expect((await page.request.post(`/api/v1/events/${fixture.event.id}/links`, {headers,
                        data: {maxUses: 1, expiresAt: range.days[1] + 'T00:45:00.000Z'}})).status()).toBe(200);
                    const detail = await page.request.get(`/api/v1/events/${fixture.event.id}`, {headers});
                    expect(detail.status()).toBe(200);
                    const event = await detail.json() as components['schemas']['EventView'];
                    expect(event).toMatchObject({startDate: range.days[0], endDate: range.days[2], timezone: 'Europe/Berlin',
                        bindingDeadline: range.days[1] + 'T00:30:00.000Z',
                        registration: {arrivalDate: range.days[0], departureDate: range.days[2]}});
                    const listed = await page.request.get(`/api/v1/events/${fixture.event.id}/links`, {headers});
                    expect(listed.status()).toBe(200);
                    const link = ((await listed.json()) as components['schemas']['EventRegistrationLinks']).items[0]!;
                    expect(link.expiresAt).toBe(range.days[1] + 'T00:45:00.000Z');
                    const wording = await expectedCalendarWording(page, range, locale, event, link);
                    expect(wording.browserZone).toBe(range.zone);
                    expect(wording.offsets).toEqual(range.offsets);
                    const before = await readActivityRecommendationsForE2E(page.request, fixture.id);
                    await info.attach('calendar-wire-and-expectations', {body: JSON.stringify({range, event,
                        weeks: fixture.view.weeks, slots: fixture.view.slots, link, wording}, null, 2), contentType: 'application/json'});

                    // Track only actual dispatches. Existing entry maintenance
                    // is preserved; no test action generates or applies a batch.
                    const generation: string[] = [];
                    page.on('request', request => {
                        const path = new URL(request.url()).pathname;
                        if (request.method() === 'POST' && /\/recommendations\/(auto|apply)$/u.test(path)) generation.push(path);
                    });
                    await inspectActivityCalendars(page, info, fixture, range, wording, locale);
                    await inspectEventCalendar(page, info, fixture, range, wording, locale, link);
                    const after = await readActivityRecommendationsForE2E(page.request, fixture.id);
                    expect(after.recommendations).toEqual(before.recommendations);
                    expect(generation).toEqual([]);
                });
            });
        }
    });
}
