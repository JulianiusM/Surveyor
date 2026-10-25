import {expect, test} from '@playwright/test';
import {createE2ELogin} from '../factories/e2eCoreFactory';
import {createFrontendEventFixture} from '../keywords/frontendEventE2EKeywords';
import {waitForFrontendHydration} from '../keywords/frontendDynamicKeywords';
import {createTranslator} from '../../src/modules/localization/translator';

test('keeps public Home separate from the authenticated Dashboard through direct and warm Login', async ({page, request}) => {
    // The independent HTTP actor proves actual document admission and its saved
    // one-visit notice; the browser then exercises the ordinary warm journey.
    const destination = '/users/dashboard?owner_main_q=route-test&locale=de';
    const entry = await request.get(destination, {maxRedirects: 0});
    expect(entry.status()).toBe(302);
    const login = new URL(entry.headers().location, 'http://localhost');
    expect(login.pathname).toBe('/users/login');
    expect(login.searchParams.get('next')).toBe(destination);
    expect(login.searchParams.get('locale')).toBe('de');
    const loginDocument = await request.get(login.pathname + login.search);
    expect(loginDocument.status()).toBe(200);
    expect(await loginDocument.text()).toContain(createTranslator('de').t('auth.loginRequired'));

    const overviewReads: string[] = [];
    page.on('request', request => {
        if (new URL(request.url()).pathname === '/api/v1/overview') overviewReads.push(request.url());
    });
    await page.goto('/?locale=en');
    await waitForFrontendHydration(page);
    await expect(page.locator('main h1')).toHaveText('Surveyor');
    await page.evaluate(() => {document.documentElement.dataset.routeAdmissionDocument = 'public-home';});
    await page.locator('header').getByRole('button', {name: 'Overview', exact: true}).click();
    await page.locator('header').getByRole('link', {name: 'Your overview', exact: true}).first().click();
    await expect(page).toHaveURL(/\/users\/login\?/u);
    expect(new URL(page.url()).searchParams.get('next')).toBe('/users/dashboard');
    expect(overviewReads).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.dataset.routeAdmissionDocument)).toBe('public-home');

    // Complete the real identity command, then return Home without substituting
    // responses or resetting the account's private collection ownership.
    const credentials = createE2ELogin();
    await page.locator('input[name="username"]').fill(credentials.username);
    await page.locator('input[name="password"]').fill(credentials.password);
    await page.getByRole('button', {name: 'Login', exact: true}).click();
    await expect(page).toHaveURL('/users/dashboard');
    await expect(page.locator('.js-overview-region').first()).toBeVisible();
    await page.locator('header').getByRole('link', {name: 'Home', exact: true}).click();
    await expect(page).toHaveURL('/');
    await expect(page.locator('main h1')).toHaveText('Surveyor');
    expect(await page.evaluate(() => document.documentElement.dataset.routeAdmissionDocument)).toBe('public-home');
});

test('admits the registered Event admin operation for a mixed-case trailing-slash document', async ({page}) => {
    const event = await createFrontendEventFixture(page.request);
    const adminRead = page.waitForResponse(response => {
        const url = new URL(response.url());
        return response.request().method() === 'GET' && url.pathname === `/api/v1/events/${event.id}`
            && url.searchParams.get('view') === 'admin';
    });
    // Both Express and Vue Router admit this spelling. Their independent entry
    // decisions and the mounted page must retain the same administration intent.
    const response = await page.goto(`/EVENT/${event.id}/ADMIN/?locale=en`);
    expect(response?.status()).toBe(200);
    await waitForFrontendHydration(page);
    expect((await adminRead).status()).toBe(200);
    const heading = page.locator('main > section.card > .card-header .frontend-page-heading');
    await expect(heading.locator('h1')).toHaveText(createTranslator('en').t('event.dashboard', {title: event.title}));
    await expect(heading.getByRole('button', {name: 'Entity settings', exact: true})).toBeVisible();
    await expect(heading.getByRole('button', {name: 'Refresh', exact: true})).toBeVisible();
    await expect(page.locator('.event-participants')).toBeVisible();
});
