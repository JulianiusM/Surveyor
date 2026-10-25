import {expect, test} from '@playwright/test';
import type {APIRequestContext, Locator, Page, Request, TestInfo} from '@playwright/test';
import {readFileSync} from 'node:fs';
import type {components} from '../../src/types/api/v1';
import {createE2EPackingList} from '../factories/e2eCoreFactory';
import {createResourceViaForm, expectEmbeddedFrontendRefresh, expectUsableFrontendLayout} from '../keywords/e2eCoreKeywords';
import {createFrontendEventFixture, frontendEventHeaders} from '../keywords/frontendEventE2EKeywords';
import {waitForFrontendHydration} from '../keywords/frontendDynamicKeywords';

/** Measure the displayed shared responsibility, including visible icons, text,
 * controls and image geometry. Whole-page shell/flash differences are excluded. */
async function measureHeader(surface: Locator) {
    return surface.evaluate(function inspectHeader(element) {
        const box = element.getBoundingClientRect();
        const heading = element.querySelector('h1')!;
        const headingBox = heading.getBoundingClientRect();
        const image = element.querySelector('img');
        const controls = [...element.querySelectorAll<HTMLElement>('a,button')].filter(visible);
        const icons = [...element.querySelectorAll<HTMLElement>('.bi')].filter(visible);
        const headingStyle = getComputedStyle(heading);
        return {
            width: box.width, height: box.height,
            title: heading.textContent!.trim(), titleWidth: headingBox.width, titleHeight: headingBox.height,
            titleX: headingBox.x - box.x, titleY: headingBox.y - box.y,
            font: headingStyle.fontSize, weight: headingStyle.fontWeight, color: headingStyle.color,
            icons: icons.map(icon => [...icon.classList].filter(name => name.startsWith('bi-')).join(' ')),
            controls: controls.map(control => ({text: control.textContent!.trim(), label: control.getAttribute('aria-label'),
                width: control.getBoundingClientRect().width, height: control.getBoundingClientRect().height,
                x: control.getBoundingClientRect().x - box.x, y: control.getBoundingClientRect().y - box.y,
                color: getComputedStyle(control).color, background: getComputedStyle(control).backgroundColor,
                border: getComputedStyle(control).borderColor, font: getComputedStyle(control).fontSize,
                href: control.getAttribute('href'), disabled: control instanceof HTMLButtonElement && control.disabled})),
            image: image ? {height: image.getBoundingClientRect().height, width: image.getBoundingClientRect().width,
                naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight, alt: image.alt,
                fit: getComputedStyle(image).objectFit} : null,
        };
        function visible(node: HTMLElement): boolean { return node.checkVisibility(); }
    });
}

/** Inspect each canonical header with its persisted title, exact parent target,
 * built image and shared controls. Recorded native originals remain separate
 * visual-review evidence after the live comparator is retired. */
async function compareHeader(page: Page, info: TestInfo, resource: {path: string; title: string}, name: string,
                             parent?: {path: string; title: string}): Promise<void> {
    await page.goto(resource.path + '?locale=en', {waitUntil: 'domcontentloaded'});
    await waitForFrontendHydration(page);
    const surface = page.locator('.card-header').filter({has: page.locator('h1')}).first();
    await expect(surface.locator('h1')).toHaveText(resource.title);
    if (parent) await expect(surface.getByRole('link', {name: 'Go to event', exact: true})).toHaveAttribute('href', parent.path);
    if (name.endsWith('image')) {
        await expect(surface.locator('img')).toBeVisible();
        await expect(surface.locator('img')).toHaveJSProperty('naturalWidth', 200);
    }
    await page.evaluate(() => document.fonts.ready);
    const measurement = await measureHeader(surface);
    await info.attach(name + '-metrics', {body: JSON.stringify(measurement, null, 2), contentType: 'application/json'});
    const imagePath = info.outputPath(name + '.png');
    await surface.screenshot({path: imagePath, animations: 'disabled'});
    await info.attach(name, {path: imagePath, contentType: 'image/png'});
    await expectUsableFrontendLayout(surface);
    await expectEmbeddedFrontendRefresh(surface);
    if (parent) {
        await page.evaluate(() => {document.documentElement.dataset.frontendDocument = 'entity-header-parent';});
        const documentRequests: string[] = [];
        function observeNavigation(request: Request): void {
            if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documentRequests.push(request.url());
        }
        page.on('request', observeNavigation);
        try {
            await surface.getByRole('link', {name: 'Go to event', exact: true}).click();
            await expect(page).toHaveURL(parent.path);
            await expect(page.locator('.card-header h1')).toHaveText(parent.title);
            expect(await page.evaluate(() => document.documentElement.dataset.frontendDocument)).toBe('entity-header-parent');
            expect(documentRequests).toEqual([]);
        } finally { page.off('request', observeNavigation); }
    }
}

/** Existing upload admission/token owners prepare a real image for both readers. */
async function uploadHeader(request: APIRequestContext, type: 'event' | 'packing', id: string): Promise<void> {
    const root = `/api/v1/${type === 'event' ? 'events' : 'packing-lists'}/${id}`;
    const proof = await frontendEventHeaders(request);
    const settings = await request.get(root + '/settings', {headers: proof});
    expect(settings.status()).toBe(200);
    const baseline = await settings.json() as components['schemas']['PackingSettings'];
    const response = await request.put(root + '/header', {headers: {...proof, 'If-Match': baseline.settingsToken},
        multipart: {image: {name: 'header.png', mimeType: 'image/png', buffer: readFileSync('src/public/img/logo.png')}}});
    expect(response.status()).toBe(200);
}

/** A control can exist in the DOM while its dialog clips it. Scroll through the
 * real body and verify the whole interactive target fits the current viewport. */
async function expectReachable(control: Locator, page: Page): Promise<void> {
    // Nearest-edge scrolling can leave a fractional border beneath a fixed
    // dialog footer. Center the actual target, retaining strict full visibility.
    await control.evaluate(function centerInScrollContainer(element) {
        element.scrollIntoView({block: 'center', inline: 'nearest'});
    });
    await expect(control).toBeInViewport({ratio: 1});
    const bounds = await control.boundingBox();
    const viewport = page.viewportSize()!;
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(-1);
    expect(bounds!.y).toBeGreaterThanOrEqual(-1);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height + 1);
}

/** Exercise the common header/settings keyboard owner through each real feature.
 * German labels have no English wording comparator; both locales must retain
 * the same visible capabilities and usable responsive interaction contracts. */
async function inspectGermanSettings(page: Page, info: TestInfo, path: string, kind: 'event' | 'packing'): Promise<void> {
    await page.goto(`${path}?locale=de`, {waitUntil: 'domcontentloaded'});
    await waitForFrontendHydration(page);
    await expect(page.locator('html')).toHaveAttribute('lang', 'de');
    const header = page.locator('.card-header').filter({has: page.locator('h1')}).first();
    const opener = header.getByRole('button', {name: 'Entitätseinstellungen', exact: true});
    await expectReachable(opener, page);
    if (kind === 'packing') await expectReachable(header.getByRole('link', {name: 'Zur Veranstaltung', exact: true}), page);
    await opener.focus();
    await opener.press('Enter');
    const dialog = page.getByRole('dialog', {name: 'Entitätseinstellungen', exact: true});
    await expect(dialog).toBeVisible();
    const tabs = dialog.locator('.entity-settings-nav').getByRole('tab');
    const names = kind === 'event' ? ['Allgemein', 'Zugriff', 'Aktionen']
        : ['Allgemein', 'Verknüpfte Veranstaltung', 'Zugriff', 'Aktionen'];
    // Opening mounts the dialog before its independent admitted reads finish.
    // Wait for the actual editable surface before testing its Tab sequence;
    // the loading dialog legitimately contains only its dismissal controls.
    await expect(tabs).toHaveText(names);
    await expect(tabs.first()).toBeEnabled();
    await expect(dialog.locator('[name="title"]')).toBeEnabled();

    // The dialog starts on its container, then exposes a predictable keyboard
    // sequence. Roving tabs activate their own panels without losing the trap.
    await expect(dialog).toBeFocused();
    const closes = dialog.getByRole('button', {name: 'Schließen', exact: true});
    await page.keyboard.press('Tab');
    await expect(closes.first()).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(tabs.first()).toBeFocused();
    for (let index = 0; index < names.length; index++) {
        const tab = tabs.nth(index);
        await expect(tab).toBeFocused();
        await expect(tab).toHaveAttribute('aria-selected', 'true');
        await expectReachable(tab, page);
        const panel = page.locator('#' + await tab.getAttribute('aria-controls'));
        await expect(panel).toBeVisible();
        await tab.press('ArrowRight');
    }
    await expect(tabs.first()).toBeFocused();

    // Open the shared image disclosure without selecting a file or mutating
    // data. Its field and upload button remain reachable in the scrolling body.
    const summary = dialog.locator('[data-entity-section="image"] summary');
    await summary.focus();
    await summary.press('Enter');
    const image = dialog.locator('[data-entity-section="image"]');
    await expectReachable(image.locator('input[type="file"]'), page);
    await expectReachable(image.getByRole('button', {name: 'Hochladen', exact: true}), page);
    await expectReachable(dialog.getByRole('button', {name: 'Eigenschaften speichern', exact: true}), page);
    await expectReachable(closes.last(), page);
    const imagePath = info.outputPath(`${kind}-german-settings.png`);
    await dialog.screenshot({path: imagePath, animations: 'disabled'});
    await info.attach(`${kind}-german-settings`, {path: imagePath, contentType: 'image/png'});

    // Tabbing beyond the last action must wrap inside the modal. Escape then
    // returns focus to the actual feature's invoking header control.
    await closes.last().focus();
    await closes.last().press('Tab');
    await expect(closes.first()).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
}

for (const width of [1280, 390]) {
    test(`compares shared Event and Packing headers with images, long titles and parent navigation at ${width}px`, async ({page}, info) => {
        test.setTimeout(120_000);
        await page.setViewportSize({width, height: 900});
        const event = await createFrontendEventFixture(page.request);
        // One actor owns all records; each comparison visits exactly the same
        // persisted entity so title wrapping and parent admission are comparable.
        for (const linked of [false, true]) {
            const input = createE2EPackingList();
            input.title = input.form.title = `Shared header packing ${linked ? 'linked' : 'standalone'} with a deliberately long title`;
            if (linked) {
                input.createPath += '?eventId=' + event.id;
                Object.assign(input.form, {event_id: event.id});
            }
            const packing = await createResourceViaForm(page.request, input);
            await compareHeader(page, info, packing, linked ? 'linked-empty' : 'standalone-empty', linked ? event : undefined);
            await uploadHeader(page.request, 'packing', packing.id);
            await compareHeader(page, info, packing, linked ? 'linked-image' : 'standalone-image', linked ? event : undefined);
        }
        await compareHeader(page, info, event, 'event-empty');
        await uploadHeader(page.request, 'event', event.id);
        await compareHeader(page, info, event, 'event-image');
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
    });
}

// Halving a 1280x900 layout viewport exercises the reflow pressure of 200% zoom.
// This is a browser-content reflow approximation, not certification of browser
// chrome zoom or assistive-technology behavior.
for (const viewport of [{width: 390, height: 844, name: 'mobile'},
    {width: 640, height: 450, name: '200% desktop reflow equivalent'}]) {
    test(`keeps German shared headers and settings keyboard-reachable at ${viewport.name}`, async ({page}, info) => {
        await page.setViewportSize({width: viewport.width, height: viewport.height});
        const browserErrors: string[] = [];
        page.on('pageerror', error => browserErrors.push(error.message));
        const event = await createFrontendEventFixture(page.request);
        const input = createE2EPackingList();
        input.createPath += '?eventId=' + event.id;
        Object.assign(input.form, {event_id: event.id});
        const packing = await createResourceViaForm(page.request, input);

        // Both consumers must adopt the same real focus, localization, settings
        // and overflow owners; one standalone component fixture cannot prove it.
        await inspectGermanSettings(page, info, event.path, 'event');
        await inspectGermanSettings(page, info, packing.path, 'packing');
        expect(browserErrors).toEqual([]);
    });
}
