import {expect, type APIRequestContext, type Locator, type Page, type TestInfo} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import type {components} from '../../src/types/api/v1';
import {createE2ELogin, createE2ESurvey} from '../factories/e2eCoreFactory';
import {createResourceViaForm, expectVisiblePresentation, loginForE2E, readVisiblePresentation, expectUsableFrontendLayout} from './e2eCoreKeywords';
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
    if (new URL(page.url()).pathname.startsWith('/frontend-pilot')) await expectUsableFrontendLayout(surface);
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

/** Keep the complete real card geometry for visual review, including required
 * Refresh controls. Layout measurements never subtract approved SPA additions. */
export async function readSurveyCardLayout(card: Locator) {
    return card.evaluate(function inspectSurveyCard(element) {
        const root = element as HTMLElement;
        const origin = root.getBoundingClientRect();
        const body = root.querySelector<HTMLElement>(':scope > .card-body')!;
        const content = Array.from(body.querySelectorAll<HTMLElement>('h2, form, .table-responsive, .status-notice'))
            .filter(surface => surface.checkVisibility({opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true}));
        const surfaces = [root.querySelector<HTMLElement>(':scope > .card-header')!, body, ...content];
        const boxes = surfaces.map(surface => {
            const rectangle = surface.getBoundingClientRect();
            return {x: rectangle.left - origin.left, y: rectangle.top - origin.top,
                width: rectangle.width, height: rectangle.height};
        });
        return {width: origin.width, height: origin.height, boxes};
    });
}

/** Require the same visible sections, each with usable area. Responsive wrapping
 * and integrated Refresh placement do not need a native pixel-coordinate shim. */
export function expectSurveyCardLayout(native: Awaited<ReturnType<typeof readSurveyCardLayout>>,
    pilot: Awaited<ReturnType<typeof readSurveyCardLayout>>): void {
    expect(pilot.width).toBeGreaterThan(0);
    expect(pilot.height).toBeGreaterThan(0);
    expect(pilot.boxes).toHaveLength(native.boxes.length);
    for (const box of pilot.boxes) {
        expect(box.width).toBeGreaterThan(0);
        expect(box.height).toBeGreaterThan(0);
    }
}

/** Direct SPA actions preserve the visible control without copying submit DOM. */
export function expectSurveyActionsPresentation(native: Awaited<ReturnType<typeof readVisiblePresentation>>,
    pilot: Awaited<ReturnType<typeof readVisiblePresentation>>): void {
    expectVisiblePresentation(native, pilot);
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

/** Keep the actual wide-page measurements while requiring local table scrolling
 * to remain inside the Vue document. Clipped radios may have offscreen boxes;
 * document width and real window travel determine whether containment works. */
export async function expectSurveyPageContained(page: Page, info: TestInfo, name: string): Promise<void> {
    const overflow = await readSurveyPageOverflow(page);
    await info.attach(name, {body: JSON.stringify(overflow, null, 2), contentType: 'application/json'});

    // A hidden document scrollbar would conceal the defect rather than keep
    // every column in its existing usable table viewport. Check both measures.
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
    expect(Math.abs(overflow.reachableScrollX)).toBeLessThanOrEqual(1);
    expect(overflow.main.x).toBeGreaterThanOrEqual(-1);
    expect(overflow.main.x + overflow.main.width).toBeLessThanOrEqual(overflow.clientWidth + 1);
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

/** A stationary sticky column is useful only while its participant remains
 * readable. Hit-test actual name glyphs after scrolling so checked/focused
 * choice labels cannot paint and intercept clicks over that identity. */
export async function expectSurveyStickyParticipantVisible(table: Locator): Promise<void> {
    const covered = await table.locator('tbody .sticky-col').evaluateAll(function inspectStickyNamePaint(cells) {
        const covered: Array<{name: string; coveredBy: string}> = [];
        for (const cell of cells) {
            const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
            let node: Node | null;
            while ((node = walker.nextNode())) {
                const text = node.textContent ?? '';
                for (let index = 0; index < text.length; index++) {
                    if (!text[index]!.trim()) continue;
                    const range = document.createRange();
                    range.setStart(node, index);
                    range.setEnd(node, index + 1);
                    const glyph = range.getBoundingClientRect();
                    if (!glyph.width || !glyph.height) continue;
                    // Measure the rendered glyph, not a fixed coordinate, column
                    // width or z-index value that could reproduce the defect.
                    const top = document.elementFromPoint(glyph.x + glyph.width / 2, glyph.y + glyph.height / 2);
                    if (!top || !cell.contains(top)) {
                        covered.push({name: text.trim(), coveredBy: top?.tagName ?? 'outside viewport'});
                        break;
                    }
                }
            }
        }
        return covered;
    });
    expect(covered, 'Scrolled choices must not cover the sticky participant name').toEqual([]);
}
