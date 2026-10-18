import {expect, type APIRequestContext, type Locator, type Page, type TestInfo} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import type {components} from '../../src/types/api/v1';
import {createE2ELogin, createE2ESurvey} from '../factories/e2eCoreFactory';
import {createResourceViaForm, expectVisiblePresentation, loginForE2E, readVisiblePresentation} from './e2eCoreKeywords';
import {frontendEventHeaders} from './frontendEventE2EKeywords';

/** Seed the unchanged native controller through HTTP. Both renderers later
 * inspect these same records and the same actor, without intercepted delivery. */
export async function createFrontendSurveyFixture(request: APIRequestContext, description = '', options: {wide?: boolean} = {}) {
    await loginForE2E(request, createE2ELogin());
    const input = createE2ESurvey();
    input.title = input.form.title = `P4 monthly survey ${randomUUID().slice(0, 8)}`;
    input.form.description = description;
    if (options.wide) {
        // Enough real recurring columns force both tables to overflow even at
        // desktop width. They are created by the original production form parser.
        const weekdays = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;
        for (let index = 1; index < 28; index++) {
            Object.assign(input.form, {[`combinations[${index}][weekday]`]: weekdays[index % weekdays.length],
                [`combinations[${index}][week]`]: String(Math.floor(index / weekdays.length) + 1)});
        }
    }
    const resource = await createResourceViaForm(request, input);
    expect((await request.post(`/survey/${resource.id}/add-combination`, {
        form: {weekday: 'FRI', nthWeek: 'LAST'}, maxRedirects: 0,
    })).status()).toBe(302);
    return resource;
}

/** Read the generated public projection through real admission and persistence. */
export async function readSurveyForE2E(request: APIRequestContext, id: string): Promise<components['schemas']['SurveyView']> {
    const response = await request.get(`/api/v1/surveys/${id}`, {headers: await frontendEventHeaders(request)});
    expect(response.status()).toBe(200);
    return response.json() as Promise<components['schemas']['SurveyView']>;
}

/** Observe exactly one integrated command; a visible change alone cannot prove
 * its generated path/method or distinguish SPA delivery from a document POST. */
export async function observeSurveyCommand(page: Page, id: string, suffix: string, method: string,
    act: () => Promise<unknown>, status = 200): Promise<void> {
    const response = page.waitForResponse(result => result.request().method() === method
        && new URL(result.url()).pathname === `/api/v1/surveys/${id}${suffix}`);
    await act();
    expect((await response).status()).toBe(status);
}

/** Capture original pixels and every requested visible control/style/box before
 * comparison. Measurements stay unmodified even when an assertion fails. */
export async function captureSurveyPresentation(page: Page, info: TestInfo, name: string, surface: Locator,
    selectors: string[]) {
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(function releaseFocus() {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    });
    await page.mouse.move(0, 0);
    const path = info.outputPath(name + '.png');
    await surface.screenshot({path, animations: 'disabled'});
    await info.attach(name, {path, contentType: 'image/png'});
    const presentation = await readVisiblePresentation(surface, selectors);
    await info.attach(name + '-presentation', {body: JSON.stringify(presentation, null, 2), contentType: 'application/json'});
    return presentation;
}

/** Measure the complete unarchived voting card, including the gaps between its
 * independently compared controls. Only the approved Vue Refresh row is removed
 * from vertical measurements; native shell/flash offsets stay outside the card.
 * Callers use an empty description so its approved Vue-only text is not hidden. */
export async function readSurveyCardLayout(card: Locator, pilot: boolean) {
    return card.evaluate(function inspectSurveyCard(element, isPilot) {
        const root = element as HTMLElement;
        const origin = root.getBoundingClientRect();
        const body = root.querySelector<HTMLElement>(':scope > .card-body')!;
        const firstHeading = body.querySelector<HTMLElement>('h2')!;
        const headingTop = firstHeading.getBoundingClientRect().top;
        const refresh = isPilot ? body.querySelector<HTMLElement>(':scope > .d-flex.justify-content-end') : null;
        let refreshHeight = 0;
        if (refresh) {
            // Its actual box and margins are the exception, not a guessed
            // constant which could conceal an unrelated changed content gap.
            const style = getComputedStyle(refresh);
            refreshHeight = refresh.getBoundingClientRect().height
                + Number.parseFloat(style.marginTop) + Number.parseFloat(style.marginBottom);
        }
        // The native card also owns its hidden settings modal. Its unpainted
        // descendants are never part of the visible voting-page geometry.
        const content = Array.from(body.querySelectorAll<HTMLElement>('h2, form, .table-responsive, .status-notice'))
            .filter(surface => surface.checkVisibility({opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true}));
        const surfaces = [root.querySelector<HTMLElement>(':scope > .card-header')!, body, ...content];
        const boxes = surfaces.map(function measureSurface(surface) {
            const rectangle = surface.getBoundingClientRect();
            const belowRefresh = rectangle.top >= headingTop;
            return {x: rectangle.left - origin.left,
                y: rectangle.top - origin.top - (belowRefresh ? refreshHeight : 0),
                width: rectangle.width, height: rectangle.height - (surface === body ? refreshHeight : 0)};
        });
        return {width: origin.width, height: origin.height - refreshHeight, boxes};
    }, pilot);
}

/** Compare the full card's normalized geometry independently from wording/style
 * snapshots. A section crop cannot expose a changed gap between neighboring forms. */
export function expectSurveyCardLayout(native: Awaited<ReturnType<typeof readSurveyCardLayout>>,
    pilot: Awaited<ReturnType<typeof readSurveyCardLayout>>): void {
    expect(Math.abs(pilot.width - native.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(pilot.height - native.height)).toBeLessThanOrEqual(1);
    expect(pilot.boxes).toHaveLength(native.boxes.length);
    for (const [index, box] of native.boxes.entries()) {
        for (const dimension of ['x', 'y', 'width', 'height'] as const) {
            expect(Math.abs(pilot.boxes[index]![dimension] - box[dimension]),
                `Survey card surface ${index} ${dimension}`).toBeLessThanOrEqual(1);
        }
    }
}

/** Characterize only the existing Actions delete-button wrapper difference.
 * Native places it inside a form flex item; Vue makes the button the flex item,
 * which blockifies computed display without changing its painted dimensions.
 * Keep the original captures and every other style, field and geometry check. */
export function expectSurveyActionsPresentation(native: Awaited<ReturnType<typeof readVisiblePresentation>>,
    pilot: Awaited<ReturnType<typeof readVisiblePresentation>>): void {
    const adjusted = structuredClone(pilot);
    const originalDelete = native.content.elements.filter(element => element.text === 'Delete permanently');
    const pilotDelete = adjusted.content.elements.filter(element => element.text === 'Delete permanently');
    expect(originalDelete).toHaveLength(1);
    expect(pilotDelete).toHaveLength(1);
    expect(originalDelete[0]!.style.display).toBe('inline-block');
    expect(pilotDelete[0]!.style.display).toBe('block');
    // This exact, independently characterized value is the sole substitution.
    // It supplies no tolerance for changed wrapping, availability or other styles.
    pilotDelete[0]!.style.display = originalDelete[0]!.style.display;
    expectVisiblePresentation(native, adjusted);
}

/** Record the native wide-page boundary instead of assuming scrollWidth proves
 * visible overflow. Absolutely positioned clipped radios can contribute to that
 * metric; actual root scrolling and horizontal boxes establish its consequence. */
export async function readSurveyPageOverflow(page: Page) {
    return page.evaluate(function inspectPageOverflow() {
        const root = document.documentElement;
        const body = document.body;
        const main = document.querySelector<HTMLElement>('main')!;
        const initialX = window.scrollX;
        const initialY = window.scrollY;
        const bodyBox = body.getBoundingClientRect();
        const mainBox = main.getBoundingClientRect();

        // Attempt the actual public document scroll, then restore the original
        // viewport before subsequent snapshots or component reachability checks.
        window.scrollTo({left: root.scrollWidth, top: initialY, behavior: 'instant'});
        const reachableScrollX = window.scrollX;
        window.scrollTo({left: initialX, top: initialY, behavior: 'instant'});
        const escapedRadios = [];
        for (const input of document.querySelectorAll<HTMLElement>('main .btn-check')) {
            const box = input.getBoundingClientRect();
            if (box.right <= root.clientWidth && box.left >= 0) continue;
            escapedRadios.push({left: box.left, right: box.right, width: box.width,
                position: getComputedStyle(input).position, clip: getComputedStyle(input).clip});
        }
        return {clientWidth: root.clientWidth, scrollWidth: root.scrollWidth,
            htmlOverflowX: getComputedStyle(root).overflowX, bodyOverflowX: getComputedStyle(body).overflowX,
            body: {x: bodyBox.x, width: bodyBox.width, height: bodyBox.height},
            main: {x: mainBox.x, width: mainBox.width, height: mainBox.height},
            reachableScrollX, escapedRadioCount: escapedRadios.length, escapedRadioSamples: escapedRadios.slice(0, 5)};
    });
}

/** Exercise a genuinely overflowing production table instead of inferring
 * scrolling from its CSS class. Both the header and participant cells must stay
 * fixed while the final answer column becomes reachable inside its viewport. */
export async function scrollSurveyTable(table: Locator) {
    const viewport = table.locator('..');
    await viewport.scrollIntoViewIfNeeded();
    const before = await viewport.evaluate(function measureInitialScroll(element) {
        const root = element as HTMLElement;
        const header = root.querySelector<HTMLElement>('thead .sticky-col')!;
        const participant = root.querySelector<HTMLElement>('tbody .sticky-col')!;
        const final = root.querySelector<HTMLElement>('tbody tr td:last-child')!;
        return {width: root.clientWidth, overflow: root.scrollWidth - root.clientWidth,
            header: header.getBoundingClientRect().left, participant: participant.getBoundingClientRect().left,
            final: final.getBoundingClientRect().left};
    });
    expect(before.overflow).toBeGreaterThan(100);
    await expect(table.locator('thead .sticky-col')).toHaveCSS('position', 'sticky');
    await expect(table.locator('tbody .sticky-col').first()).toHaveCSS('position', 'sticky');

    // Set only the public DOM scroll position. Native layout and sticky CSS
    // perform the movement; no response, document or rendered column is replaced.
    await viewport.evaluate(function revealFinalColumn(element) {
        const root = element as HTMLElement;
        root.scrollLeft = root.scrollWidth;
    });
    await expect.poll(() => viewport.evaluate(element => element.scrollLeft)).toBeGreaterThan(100);
    const after = await viewport.evaluate(function measureScrolledTable(element) {
        const root = element as HTMLElement;
        const bounds = root.getBoundingClientRect();
        const header = root.querySelector<HTMLElement>('thead .sticky-col')!.getBoundingClientRect();
        const participant = root.querySelector<HTMLElement>('tbody .sticky-col')!.getBoundingClientRect();
        const final = root.querySelector<HTMLElement>('tbody tr td:last-child')!.getBoundingClientRect();
        return {scroll: root.scrollLeft, header: header.left, participant: participant.left,
            final: final.left, finalRight: final.right, viewportRight: bounds.left + root.clientWidth,
            finalVisibleWidth: Math.min(final.right, bounds.left + root.clientWidth) - Math.max(final.left, participant.right)};
    });
    expect(Math.abs(after.header - before.header)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.participant - before.participant)).toBeLessThanOrEqual(1);
    expect(before.final - after.final).toBeGreaterThan(100);
    expect(after.finalRight).toBeLessThanOrEqual(after.viewportRight + 1);
    expect(after.finalVisibleWidth).toBeGreaterThan(20);
    return {width: before.width, overflow: before.overflow, scroll: after.scroll};
}
