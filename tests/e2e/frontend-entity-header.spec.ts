import {expect, test} from '@playwright/test';
import type {APIRequestContext, Locator, Page, TestInfo} from '@playwright/test';
import {readFileSync} from 'node:fs';
import type {components} from '../../src/types/api/v1';
import {createE2EPackingList} from '../factories/e2eCoreFactory';
import {createResourceViaForm} from '../keywords/e2eCoreKeywords';
import {createFrontendEventFixture, frontendEventHeaders} from '../keywords/frontendEventE2EKeywords';
import {waitForPilotHydration} from '../keywords/frontendDynamicKeywords';

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
            controls: controls.map(control => ({text: control.textContent!.trim(),
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

/** Compare the same entity and actor through both built application frontends. */
async function compareHeader(page: Page, info: TestInfo, path: string, name: string): Promise<void> {
    let native: Awaited<ReturnType<typeof measureHeader>> | undefined;
    for (const pilot of [false, true]) {
        await page.goto(`${pilot ? '/frontend-pilot' : ''}${path}?locale=en`, {waitUntil: 'domcontentloaded'});
        if (pilot) await waitForPilotHydration(page);
        const surface = page.locator('.card-header').filter({has: page.locator('h1')}).first();
        // Client initialization precedes its independent admitted detail read.
        // A skeleton's placeholder title is not the migrated header to compare.
        if (pilot) await expect(surface.locator('h1')).toHaveText(native!.title);
        const image = surface.locator('img');
        if (name.endsWith('image')) {
            await expect(image).toBeVisible();
            await expect(image).toHaveJSProperty('naturalWidth', 200);
        }
        await page.evaluate(() => document.fonts.ready);
        const measurement = await measureHeader(surface);
        await info.attach(`${name}-${pilot ? 'pilot' : 'native'}-metrics`, {
            body: JSON.stringify(measurement, null, 2), contentType: 'application/json',
        });
        const imagePath = info.outputPath(`${name}-${pilot ? 'pilot' : 'native'}.png`);
        await surface.screenshot({path: imagePath, animations: 'disabled'});
        await info.attach(`${name}-${pilot ? 'pilot' : 'native'}`, {path: imagePath, contentType: 'image/png'});
        if (pilot) expect(measurement).toEqual(native);
        else native = measurement;
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
            await compareHeader(page, info, packing.path, linked ? 'linked-empty' : 'standalone-empty');
            await uploadHeader(page.request, 'packing', packing.id);
            await compareHeader(page, info, packing.path, linked ? 'linked-image' : 'standalone-image');
        }
        await compareHeader(page, info, event.path, 'event-empty');
        await uploadHeader(page.request, 'event', event.id);
        await compareHeader(page, info, event.path, 'event-image');
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
    });
}
