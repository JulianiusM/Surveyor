import {test, expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import type {components} from '../../src/types/api/v1';
import {createE2ELogin} from '../factories/e2eCoreFactory';
import {loginForE2E} from '../keywords/e2eCoreKeywords';
import {waitForPilotHydration} from '../keywords/frontendDynamicKeywords';

/** Capture actual layout evidence rather than infer footer presence from SSR text. */
function footerPresentation() {
    const footer = document.querySelector('footer');
    if (!footer) return {present: false, htmlHeight: document.documentElement.scrollHeight};
    const bounds = footer.getBoundingClientRect();
    const style = getComputedStyle(footer);
    return {present: true, bounds: {x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height},
        display: style.display, visibility: style.visibility, opacity: style.opacity,
        htmlHeight: document.documentElement.scrollHeight, text: footer.textContent};
}

test('profile creation, switching and editing share the built application and native persistence', async ({page}) => {
    await loginForE2E(page.request, createE2ELogin());
    const before = await (await page.request.get('/api/v1/session')).json() as components['schemas']['SessionView'];
    const name = `P1 profile ${randomUUID().slice(0, 8)}`;

    // Confirm the native creation first, then read its separate display data.
    // Creating another profile must not switch the active profile.
    await page.goto('/frontend-pilot/users/profile/create?locale=en');
    await waitForPilotHydration(page);
    await page.locator('#name').fill(name);
    const createdResponse = page.waitForResponse(response => response.url().endsWith('/api/v1/profiles')
        && response.request().method() === 'POST');
    await page.getByRole('button', {name: 'Create new profile', exact: true}).click();
    const created = await createdResponse;
    expect(created.status()).toBe(200);
    expect(await created.json()).toEqual({changed: true});
    const afterCreation = await (await page.request.get('/api/v1/session')).json() as components['schemas']['SessionView'];
    expect(afterCreation.activeProfile?.id).toBe(before.activeProfile?.id);
    await expect(page).toHaveURL(/\/frontend-pilot\/users\/profile\/manage/u);
    const profileRow = page.locator('main li').filter({hasText: name});
    await expect(profileRow).toBeVisible();

    // The roster adopts the existing switch operation. Its new context retires
    // private state, and the next editor must read this newly selected profile.
    await profileRow.getByRole('button', {name: 'Switch to profile', exact: true}).click();
    await expect(page).toHaveURL(/\/frontend-pilot(?:\?[^#]*)?$/u);
    await page.goto('/frontend-pilot/users/profile?locale=en');
    await waitForPilotHydration(page);
    await expect(page.locator('#name')).toHaveValue(name);
    const renamed = `${name} edited`;
    await page.locator('#name').fill(renamed);
    await page.locator('#isDefault').uncheck();
    const updatedResponse = page.waitForResponse(response => response.url().endsWith('/api/v1/profiles/current')
        && response.request().method() === 'PATCH');
    await page.getByRole('button', {name: 'Submit changes', exact: true}).click();
    expect((await updatedResponse).status()).toBe(200);
    await expect(page.locator('#name')).toHaveValue(renamed);
    await expect(page.locator('#isDefault')).not.toBeChecked();

    // Read the same saved fields through the unchanged native form. This checks
    // actual shared persistence, rather than a second frontend's copied rules.
    const native = await page.request.get('/users/profile');
    expect(native.status()).toBe(200);
    expect(await native.text()).toContain(`value="${renamed}"`);
});

for (const viewport of [{width: 1280, height: 900}, {width: 390, height: 844}]) {
    test(`profile presentation retains native fields at ${viewport.width}px`, async ({page}, testInfo) => {
        await page.setViewportSize(viewport);
        const browserErrors: string[] = [];
        page.on('pageerror', error => browserErrors.push(error.message));
        await loginForE2E(page.request, createE2ELogin());

        // Equivalent actor/data and viewport give the screenshots a useful
        // comparator. Geometry assertions protect the actual text/checkbox row.
        await page.goto('/users/profile');
        const nativeName = await page.locator('#name').inputValue();
        const nativeBounds = await page.locator('#name').boundingBox();
        const nativeFooter = await page.evaluate(footerPresentation);
        await page.screenshot({path: testInfo.outputPath('native-profile.png'), fullPage: true});
        await page.goto('/frontend-pilot/users/profile?locale=en');
        await waitForPilotHydration(page);
        await expect(page.locator('#name')).toHaveValue(nativeName);
        const pilotBounds = await page.locator('#name').boundingBox();
        expect(nativeBounds).not.toBeNull();
        expect(pilotBounds).not.toBeNull();
        expect(Math.abs(pilotBounds!.width - nativeBounds!.width)).toBeLessThanOrEqual(1);
        expect(Math.abs(pilotBounds!.height - nativeBounds!.height)).toBeLessThanOrEqual(1);
        await expect(page.locator('#isDefault')).toBeVisible();
        const pilotFooter = await page.evaluate(footerPresentation);
        const presentationPath = testInfo.outputPath('presentation.json');
        await writeFile(presentationPath, JSON.stringify({native: nativeFooter, pilot: pilotFooter, browserErrors}, null, 2));
        await testInfo.attach('footer-presentation', {path: presentationPath, contentType: 'application/json'});
        await expect(page.locator('footer')).toBeVisible();
        await page.screenshot({path: testInfo.outputPath('pilot-profile.png'), fullPage: true});
    });
}
