import {test, expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import type {components} from '../../src/types/api/v1';
import {createE2ELogin} from '../factories/e2eCoreFactory';
import {commandHeadersForE2E, expectUsableFrontendLayout, loginForE2E} from '../keywords/e2eCoreKeywords';
import {waitForFrontendHydration} from '../keywords/frontendDynamicKeywords';
import {createTranslator} from '../../src/modules/localization/translator';

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

test('profile creation, switching and editing share the built application and native persistence', async ({page}) => {
    await loginForE2E(page.request, createE2ELogin());
    const before = await (await page.request.get('/api/v1/session')).json() as components['schemas']['SessionView'];
    const name = `P1 profile ${randomUUID().slice(0, 8)}`;

    // Confirm the native creation first, then read its separate display data.
    // Creating another profile must not switch the active profile.
    await page.goto('/users/profile/create?locale=en');
    await waitForFrontendHydration(page);
    await page.locator('#name').fill(name);
    const createdResponse = page.waitForResponse(response => response.url().endsWith('/api/v1/profiles')
        && response.request().method() === 'POST');
    await page.getByRole('button', {name: 'Create new profile', exact: true}).click();
    const created = await createdResponse;
    expect(created.status()).toBe(200);
    expect(await created.json()).toEqual({changed: true});
    const afterCreation = await (await page.request.get('/api/v1/session')).json() as components['schemas']['SessionView'];
    expect(afterCreation.activeProfile?.id).toBe(before.activeProfile?.id);
    await expect(page).toHaveURL(/\/users\/profile\/manage/u);
    const profileRow = page.locator('main li').filter({hasText: name});
    await expect(profileRow).toBeVisible();

    // The roster adopts the existing switch operation. Its new context retires
    // private state, and the next editor must read this newly selected profile.
    await profileRow.getByRole('button', {name: 'Switch to profile', exact: true}).click();
    await expect(page).toHaveURL('/users/dashboard');
    await page.goto('/users/profile?locale=en');
    await waitForFrontendHydration(page);
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

    // Independently reload the saved projection after the real UI command.
    const saved = await page.request.get('/api/v1/profiles/current', {headers: await commandHeadersForE2E(page.request)});
    expect(saved.status()).toBe(200);
    expect(await saved.json()).toMatchObject({name: renamed, isDefault: false});
});

for (const viewport of [{width: 1280, height: 900}, {width: 390, height: 844}]) {
    test(`profile presentation retains saved fields at ${viewport.width}px`, async ({page}, testInfo) => {
        await page.setViewportSize(viewport);
        const browserErrors: string[] = [];
        page.on('pageerror', error => browserErrors.push(error.message));
        await loginForE2E(page.request, createE2ELogin());

        const response = await page.request.get('/api/v1/profiles/current', {headers: await commandHeadersForE2E(page.request)});
        expect(response.status()).toBe(200);
        const saved = await response.json();
        const savedName = saved.name as string;
        await page.goto('/users/profile?locale=en');
        await waitForFrontendHydration(page);
        await expect(page.locator('#name')).toHaveValue(savedName);
        await expect(page.locator('#isDefault')).toBeVisible();
        await expect(page.locator('footer')).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        const frontend = await page.evaluate(profilePresentation);
        await testInfo.attach('profile-presentation', {
            body: JSON.stringify({frontend, browserErrors}, null, 2), contentType: 'application/json',
        });
        const translator = createTranslator('en');
        expect(frontend.form).toMatchObject({name: savedName, checked: saved.isDefault,
            placeholder: translator.t('profile.profileNamePlaceholder'), required: true, nameDisabled: false, checkboxDisabled: false});
        const form = page.locator('form:has(#name)');
        await expect(page.getByLabel(`${translator.t('profile.profileName')} *`, {exact: true})).toHaveValue(savedName);
        await expect(page.getByLabel(translator.t('profile.defaultProfile'), {exact: true})).toBeChecked({checked: saved.isDefault});
        await expect(form).toContainText(translator.t('profile.defaultExplanation'));
        await expect(page.getByRole('button', {name: translator.t('profile.saveProfile'), exact: true})).toBeEnabled();
        await expect(form.getByRole('link', {name: translator.t('profile.backHome'), exact: true})).toHaveAttribute('href', '/');
        await expect(form.getByRole('link', {name: translator.t('profile.showMigrationToken'), exact: true}))
            .toHaveAttribute('href', '/users/profile/migrate/request');
        await expect(form.getByRole('link', {name: translator.t('profile.deleteProfile'), exact: true}))
            .toHaveAttribute('href', '/users/profile/delete');
        expect(frontend.form.controls.length).toBeGreaterThan(3);
        await expectUsableFrontendLayout(page.locator('form:has(#name)'));
        await expectUsableFrontendLayout(page.locator('footer'));
        const refreshed = page.waitForResponse(response => response.request().method() === 'GET'
            && new URL(response.url()).pathname === '/api/v1/profiles/current');
        await page.getByRole('button', {name: 'Refresh', exact: true}).click();
        expect((await refreshed).status()).toBe(200);
        await expect(page.locator('#name')).toHaveValue(savedName);
        await page.screenshot({path: testInfo.outputPath('frontend-profile.png'), fullPage: true});
        expect(browserErrors).toEqual([]);
    });
}
