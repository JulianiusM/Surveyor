import {test, expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import type {components} from '../../src/types/api/v1';
import {createE2ELogin} from '../factories/e2eCoreFactory';
import {expectUsableFrontendLayout, loginForE2E} from '../keywords/e2eCoreKeywords';
import {waitForPilotHydration} from '../keywords/frontendDynamicKeywords';

/** Record actual form/footer content, state, paint and raw responsive geometry. */
function profilePresentation() {
    const form = document.querySelector<HTMLFormElement>('form:has(#name)')!;
    const footer = document.querySelector('footer')!;
    const formBounds = form.getBoundingClientRect();
    const footerBounds = footer.getBoundingClientRect();
    const name = form.querySelector<HTMLInputElement>('#name')!;
    const checkbox = form.querySelector<HTMLInputElement>('#isDefault')!;

    // Use stable semantic controls instead of comparing different framework DOM
    // wrappers. Every field, its explanation, the submit row and onward actions
    // participate; a matching name input alone cannot establish form parity.
    const selectors = ['label.form-label', '#name', '.col-md-6:has(#isDefault)',
        '#isDefault', '.form-check-label', 'button[type="submit"]', 'a.btn'];
    const controls = [];
    for (const selector of selectors) {
        for (const element of form.querySelectorAll<HTMLElement>(selector)) {
            controls.push(presentation(element, formBounds));
        }
    }
    const links = [];
    for (const link of footer.querySelectorAll<HTMLAnchorElement>('a')) {
        links.push({...presentation(link, footerBounds), href: link.href});
    }
    return {
        form: {width: formBounds.width, height: formBounds.height, controls,
            name: name.value, placeholder: name.placeholder, required: name.required,
            checked: checkbox.checked, nameDisabled: name.disabled, checkboxDisabled: checkbox.disabled},
        footer: {...presentation(footer, footerBounds), links, x: footerBounds.x,
            // scrollHeight is an integer CSS-pixel measurement; keep its derived
            // gap at that precision rather than compare fractional rounding noise.
            pageBottomGap: Math.round(document.documentElement.scrollHeight - footerBounds.bottom - window.scrollY)},
    };

    /** Normalize template whitespace without discarding visible wording. */
    function text(element: HTMLElement): string {
        // innerText preserves rendered block boundaries. textContent would join
        // a following block label onto the preceding sentence in native Pug.
        return element.innerText.replace(/\s+/gu, ' ').trim();
    }

    /** Relative coordinates exclude intentional navigation-shell positioning;
     * fonts, wrapping, spacing and control appearance remain fully comparable. */
    function presentation(element: HTMLElement, origin: DOMRect) {
        const bounds = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {text: text(element), x: bounds.x - origin.x, y: bounds.y - origin.y,
            width: bounds.width, height: bounds.height, font: style.fontSize, weight: style.fontWeight,
            lineHeight: style.lineHeight, color: style.color, background: style.backgroundColor,
            border: style.borderColor, display: style.display, visibility: style.visibility, opacity: style.opacity};
    }
}

/** Match fields, explanations, onward actions and painted hierarchy. Raw layout
 * remains evidence; equivalent responsive interfaces need not share rectangles. */
function compareProfilePresentation(native: ReturnType<typeof profilePresentation>, pilot: typeof native): void {
    const {width: nativeWidth, height: nativeHeight, controls: nativeControls, ...nativeFields} = native.form;
    const {width: pilotWidth, height: pilotHeight, controls: pilotControls, ...pilotFields} = pilot.form;
    expect(pilotFields).toEqual(nativeFields);
    expect(pilotControls.map(visibleMeaning)).toEqual(nativeControls.map(visibleMeaning));
    expect(visibleMeaning(pilot.footer)).toEqual(visibleMeaning(native.footer));
    expect(pilot.footer.links.map(link => ({...visibleMeaning(link), href: link.href})))
        .toEqual(native.footer.links.map(link => ({...visibleMeaning(link), href: link.href})));

    function visibleMeaning(element: typeof nativeControls[number]) {
        return {text: element.text, font: element.font, weight: element.weight,
            color: element.color, background: element.background, border: element.border,
            visibility: element.visibility, opacity: element.opacity};
    }
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
    await expect(page).toHaveURL('/frontend-pilot/users/dashboard');
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

        // Equivalent actor/data, loaded fonts and viewport make both screenshots
        // and measured assertions meaningful. Persisted profile fields are shared.
        await page.goto('/users/profile');
        const nativeName = await page.locator('#name').inputValue();
        await page.evaluate(() => document.fonts.ready);
        const native = await page.evaluate(profilePresentation);
        await page.screenshot({path: testInfo.outputPath('native-profile.png'), fullPage: true});
        await page.goto('/frontend-pilot/users/profile?locale=en');
        await waitForPilotHydration(page);
        await expect(page.locator('#name')).toHaveValue(nativeName);
        await expect(page.locator('#isDefault')).toBeVisible();
        await expect(page.locator('footer')).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        const pilot = await page.evaluate(profilePresentation);
        await testInfo.attach('profile-presentation', {
            body: JSON.stringify({native, pilot, browserErrors}, null, 2), contentType: 'application/json',
        });
        compareProfilePresentation(native, pilot);
        await expectUsableFrontendLayout(page.locator('form:has(#name)'));
        await expectUsableFrontendLayout(page.locator('footer'));
        const refreshed = page.waitForResponse(response => response.request().method() === 'GET'
            && new URL(response.url()).pathname === '/api/v1/profiles/current');
        await page.getByRole('button', {name: 'Refresh', exact: true}).click();
        expect((await refreshed).status()).toBe(200);
        await expect(page.locator('#name')).toHaveValue(nativeName);
        await page.screenshot({path: testInfo.outputPath('pilot-profile.png'), fullPage: true});
        expect(browserErrors).toEqual([]);
    });
}
