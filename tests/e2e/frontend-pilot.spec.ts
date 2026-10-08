import {expect, test, type APIRequestContext, type Locator, type Page, type Route, type TestInfo} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createE2EEvent, createE2ELogin, createE2EPackingList} from '../factories/e2eCoreFactory';
import {createResourceViaForm, loginForE2E, waitForPilotHydration} from '../keywords/e2eCoreKeywords';
import type {components} from '../../src/types/api/v1';
import type {FrontendPilotBootstrap, FrontendPilotRenderResult} from '../../src/types/FrontendPilotTypes';

type Session = components['schemas']['SessionView'];

/** Isolate initial presentation without sending mail or manufacturing persisted records.
 * The real built renderer supplies HTML/state, the normal HTTP shell supplies its selected
 * client assets, and the browser executes the actual entry decoder and hydration. Only the
 * initial document delivery is substituted; session reads keep their ordinary HTTP boundary. */
async function initialPresentation(page: Page, url: string, bootstrap: FrontendPilotBootstrap): Promise<void> {
    const renderer = await import(pathToFileURL(resolve('dist/frontend-server/entry-server.mjs')).href) as {
        render(url: string, bootstrap: FrontendPilotBootstrap): Promise<FrontendPilotRenderResult>;
    };
    const rendered = await renderer.render(url, bootstrap);
    const shell = await page.request.get('/frontend-pilot/users/login?locale=en');
    expect(shell.status()).toBe(200);
    const html = (await shell.text())
        .replace(/<div id="surveyor-pilot">[\s\S]*?(?=<script id="surveyor-pilot-state")/u,
            () => `<div id="surveyor-pilot">${rendered.html}</div>\n`)
        .replace(/(<script id="surveyor-pilot-state" type="application\/json">)[\s\S]*?(<\/script>)/u,
            () => `<script id="surveyor-pilot-state" type="application/json">${rendered.state}</script>`);
    await page.route(url, route => route.fulfill({status: 200, contentType: 'text/html', body: html}));
    await page.goto(url, {waitUntil: 'domcontentloaded'});
    await waitForPilotHydration(page);
}

test('actual startup preserves confirmed native recovery and retires it after committed departure', async ({page}) => {
    const session = await bootstrap(page.request);
    const url = '/frontend-pilot/guest/recovery';
    await initialPresentation(page, url, {session, pageCompletion: {context: session.context,
        destination: url, messageKey: 'auth.recoverySent', kind: 'success'}});
    await expect(page.getByRole('heading', {name: 'Success', exact: true})).toBeVisible();
    await expect(page.locator('main')).toContainText('The link(s) to your guest account(s) have been sent to your email address.');
    await expect(page.locator('main form')).toHaveCount(0);
    await expect(page).toHaveURL(/\/frontend-pilot\/guest\/recovery$/);

    await page.locator('header').getByRole('link', {name: 'Home', exact: true}).click();
    await expect(page).toHaveURL(/\/frontend-pilot$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/frontend-pilot\/users\/login$/);
    await expect(page.getByRole('heading', {name: 'Login', exact: true})).toBeVisible();
});

test('actual startup preserves the native expired-session notice', async ({page}) => {
    const session = await bootstrap(page.request);
    await initialPresentation(page, '/frontend-pilot/users/login', {session,
        pageNotice: {kind: 'error', messageKey: 'auth.sessionExpired'}});
    await expect(page.locator('main .alert-danger')).toContainText('Session has expired');
    await expect(page.getByRole('heading', {name: 'Login', exact: true})).toBeVisible();
});

/** Optional release evidence uses the actual mounted checkpoint, without replacing data or UI.
 * Restore the viewport and focused node before the rest of the normal journey continues. */
async function captureState(page: Page, testInfo: TestInfo, name: string, target?: Locator,
    options: {viewportOnly?: boolean; reachable?: Locator[]} = {}): Promise<void> {
    if (process.env.E2E_PILOT_STATE_SCREENSHOTS !== 'true') return;
    const viewport = page.viewportSize();
    const focused = await page.evaluateHandle(() => document.activeElement);
    try {
        for (const [size, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]] as const) {
            await page.setViewportSize({width, height});
            if (target) await target.scrollIntoViewIfNeeded();
            for (const control of options.reachable ?? []) await expect(control).toBeInViewport({ratio: 1});
            await page.evaluate(() => document.fonts.ready);
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
            const path = testInfo.outputPath(`${name}-${size}.png`);
            await page.screenshot({path, fullPage: !options.viewportOnly, animations: 'disabled'});
            await testInfo.attach(`${name}-${size}`, {path, contentType: 'image/png'});
        }
    } finally {
        if (viewport) await page.setViewportSize(viewport);
        await focused.asElement()?.evaluate(element => {
            if (element.isConnected && element instanceof HTMLElement) element.focus({preventScroll: true});
        });
        await focused.dispose();
    }
}

async function bootstrap(request: APIRequestContext): Promise<Session> {
    const result = await request.get('/api/v1/session');
    expect(result.status()).toBe(200);
    return await result.json() as Session;
}
function headers(session: Session) {
    return {'X-Surveyor-Context': session.context, 'X-CSRF-Token': session.csrfToken, 'X-Surveyor-Locale': session.locale};
}
/** Fixture creation and browser delivery are separate so loading checks can hold a real read. */
async function packingFixture(request: APIRequestContext, publicView = false) {
    await loginForE2E(request, createE2ELogin());
    const input = createE2EPackingList();
    input.title = input.form.title = `Vue packing ${randomUUID()}`;
    if (publicView) Object.assign(input.form, {'defaultPerms[public][0]': 'ACCESS_VIEW'});
    return createResourceViaForm(request, input);
}

async function packing(page: Page, publicView = false) {
    const list = await packingFixture(page.request, publicView);
    // Readiness is proved by the real hydrated controls below; unrelated external
    // assets must not keep an already usable application behind a full-load wait.
    await page.goto(`/frontend-pilot/packing/${list.id}`, {waitUntil: 'domcontentloaded'});
    await expect(page.getByRole('heading', {name: list.title, exact: true})).toBeVisible();
    return list;
}

/** Delay only delivery at the HTTP boundary. Explicit release keeps checks deterministic
 * without artificial product timers, invented snapshots or backend replacements. */
function readGate() {
    let release!: () => void;
    const promise = new Promise<void>(function rememberRelease(resolve) { release = resolve; });
    return {promise, release};
}

async function readPacking(request: APIRequestContext, id: string): Promise<components['schemas']['PackingListView']> {
    const session = await bootstrap(request);
    const response = await request.get(`/api/v1/packing-lists/${id}`, {headers: headers(session)});
    expect(response.status()).toBe(200);
    return response.json();
}

/** Wait for the actual command response, then let each journey assert the refreshed UI and persistence. */
async function packingCommand(page: Page, id: string, suffix: string, method: string,
    action: () => Promise<unknown>, status = 200): Promise<void> {
    const response = page.waitForResponse(result => new URL(result.url()).pathname === `/api/v1/packing-lists/${id}${suffix}`
        && result.request().method() === method);
    await action();
    expect((await response).status()).toBe(status);
}

test('shared entry preserves header creation admission, exact duplicate login return and canonical guest completion', async ({page, browser, baseURL}, testInfo) => {
    test.setTimeout(60_000);
    const credentials = createE2ELogin();
    await loginForE2E(page.request, credentials);
    const input = createE2EPackingList();
    Object.assign(input.form, {'defaultPerms[public][0]': 'DATA_DUPLICATE'});
    const list = await createResourceViaForm(page.request, input);
    const anonymous = await browser.newContext({baseURL});
    const guest = await browser.newContext({baseURL});
    try {
        const visitor = await anonymous.newPage();
        await visitor.goto('/frontend-pilot/help?locale=en', {waitUntil: 'domcontentloaded'});
        await visitor.evaluate(() => { document.documentElement.dataset.entryDocument = 'original'; });
        await visitor.locator('header summary').filter({hasText: /^New$/}).click();
        await visitor.locator('header').getByRole('link', {name: 'Packing list', exact: true}).click();
        await expect(visitor).toHaveURL(/\/frontend-pilot\/users\/login\?/);
        expect(new URL(visitor.url()).searchParams.get('next')).toBe('/frontend-pilot/packing/create');
        await expect(visitor.locator('.alert-info')).toContainText('You must be logged in as user');
        expect(await visitor.evaluate(() => document.documentElement.dataset.entryDocument)).toBe('original');

        // Duplicate GET has its own public grant. Submission uses account admission,
        // then the shared login completion returns to this precise source and query.
        const duplicate = `/frontend-pilot/packing/${list.id}/duplicate?locale=en`;
        await visitor.goto(duplicate, {waitUntil: 'domcontentloaded'});
        await expect(visitor.locator('#create-title')).toHaveValue(list.title);
        await visitor.evaluate(() => { document.documentElement.dataset.entryDocument = 'duplicate'; });
        await visitor.locator('#create-title').fill('Submitted duplicate draft');
        await visitor.getByRole('button', {name: 'Create list', exact: true}).click();
        await expect(visitor).toHaveURL(/\/frontend-pilot\/users\/login\?/);
        expect(new URL(visitor.url()).searchParams.get('next')).toBe(duplicate);
        await visitor.locator('#username').fill(credentials.username);
        await visitor.locator('#password').fill(credentials.password);
        await visitor.getByRole('button', {name: 'Login', exact: true}).click();
        await expect(visitor).toHaveURL(new URL(duplicate, baseURL).href);
        await expect(visitor.locator('#create-title')).toHaveValue(list.title);
        expect(await visitor.evaluate(() => document.documentElement.dataset.entryDocument)).toBe('duplicate');

        // Inspect the same native and pilot guest form before consuming its fields.
        const guestPage = await guest.newPage();
        await guestPage.goto(`${list.path}/guest`, {waitUntil: 'domcontentloaded'});
        await captureState(guestPage, testInfo, 'native-guest-entry');
        await guestPage.goto(`/frontend-pilot/packing/${list.id}`, {waitUntil: 'domcontentloaded'});
        await expect(guestPage).toHaveURL(new URL(`/frontend-pilot/packing/${list.id}/guest?locale=en`, baseURL).href);
        await expect(guestPage.locator('#guest-name')).toBeVisible();
        await captureState(guestPage, testInfo, 'pilot-guest-entry');
        await guestPage.evaluate(() => { document.documentElement.dataset.entryDocument = 'guest'; });
        const name = `  Guest ${randomUUID().slice(0, 8)}  `;
        await guestPage.locator('#guest-name').fill(name);
        await guestPage.getByRole('button', {name: 'Continue as guest', exact: true}).click();
        await expect(guestPage).toHaveURL(new URL(`/frontend-pilot/packing/${list.id}`, baseURL).href);
        await expect(guestPage.getByRole('heading', {name: list.title, exact: true})).toBeVisible();
        const privateLink = await guestPage.locator('.alert-success a').innerText();
        await expect(guestPage.locator('.alert-success')).toContainText(`Login successful. Use ${privateLink} to edit later.`);
        expect((await bootstrap(guestPage.request)).activeProfile?.name).toBe(name);
        expect(await guestPage.evaluate(() => document.documentElement.dataset.entryDocument)).toBe('guest');
    } finally {
        await anonymous.close();
        await guest.close();
    }
});

test('shared recovery finishes at the native message URL and a reload follows its login GET', async ({browser, baseURL}, testInfo) => {
    test.setTimeout(60_000);
    const native = await browser.newContext({baseURL});
    const pilot = await browser.newContext({baseURL});
    const email = `no-matching-guest-${randomUUID()}@example.test`;
    try {
        // An unused fictional address preserves native non-disclosure without an
        // external mail dependency; both requests execute the real recovery controller.
        const nativePage = await native.newPage();
        await nativePage.goto('/users/login', {waitUntil: 'domcontentloaded'});
        await nativePage.locator('#email').fill(email);
        await nativePage.getByRole('button', {name: /Request access/}).click();
        await expect(nativePage).toHaveURL(/\/guest\/recovery(?:\?|$)/);
        await expect(nativePage.getByRole('heading', {name: /Success/})).toBeVisible();
        await captureState(nativePage, testInfo, 'native-recovery-completion');

        const pilotPage = await pilot.newPage();
        await pilotPage.goto('/frontend-pilot/users/login?locale=en', {waitUntil: 'domcontentloaded'});
        await pilotPage.locator('#recovery-email').fill(email);
        await pilotPage.getByRole('button', {name: 'Request access', exact: true}).click();
        await expect(pilotPage).toHaveURL(new URL('/frontend-pilot/guest/recovery', baseURL).href);
        await expect(pilotPage.getByRole('heading', {name: 'Success', exact: true})).toBeVisible();
        await expect(pilotPage.locator('main')).toContainText('The link(s) to your guest account(s) have been sent');
        await captureState(pilotPage, testInfo, 'pilot-recovery-completion');
        await pilotPage.reload({waitUntil: 'domcontentloaded'});
        await expect(pilotPage).toHaveURL(new URL('/frontend-pilot/users/login?locale=en', baseURL).href);
        await expect(pilotPage.locator('#username')).toBeVisible();
    } finally {
        await native.close();
        await pilot.close();
    }
});

test('pilot navigates without replacing the document and preserves the legacy Packed key', async ({page}, testInfo) => {
    const list = await packing(page);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.evaluate(() => { document.documentElement.dataset.pilotDocument = 'original'; });
    const row = page.locator('tr[data-item-id]').first();
    const itemId = await row.getAttribute('data-item-id');
    await row.getByRole('checkbox').check();
    expect(await page.evaluate(key => localStorage.getItem(key), `packed_${list.id}_${itemId}`)).toBe('1');
    await page.getByRole('button', {name: 'Refresh', exact: true}).click();
    await expect(row.getByRole('checkbox')).toBeChecked();
    const quickTitle = page.getByLabel('Title *', {exact: true});
    await quickTitle.fill('Unsaved item to retain');
    const confirmations: {type: string; message: string; accepted: boolean}[] = [];
    page.once('dialog', async confirmation => {
        confirmations.push({type: confirmation.type(), message: confirmation.message(), accepted: false});
        await confirmation.dismiss();
    });
    await page.getByRole('link', {name: 'Help for this page', exact: true}).click();
    await expect(page).toHaveURL(new RegExp('/frontend-pilot/packing/' + list.id + '$'));
    await expect(quickTitle).toHaveValue('Unsaved item to retain');
    await captureState(page, testInfo, 'unsaved-navigation-cancelled', quickTitle);
    page.once('dialog', async confirmation => {
        confirmations.push({type: confirmation.type(), message: confirmation.message(), accepted: true});
        await confirmation.accept();
    });
    await page.getByRole('link', {name: 'Help for this page', exact: true}).click();
    await expect(page).toHaveURL(/\/frontend-pilot\/help/);
    await expect(page.getByRole('search')).toBeVisible();
    expect(confirmations).toEqual([
        {type: 'confirm', message: 'Discard changes?', accepted: false},
        {type: 'confirm', message: 'Discard changes?', accepted: true},
    ]);
    // Browser-owned confirm chrome is not present in page screenshots; retain its observed
    // message and decisions separately instead of fabricating an in-page dialog image.
    if (process.env.E2E_PILOT_STATE_SCREENSHOTS === 'true') await testInfo.attach('native-discard-confirmations', {
        body: JSON.stringify(confirmations, null, 2), contentType: 'application/json',
    });
    // Verify interaction/rendering structure, not the wording of the maintained help corpus.
    await page.getByRole('link', {name: 'Back to packing list', exact: true}).click();
    await expect(page.getByRole('heading', {name: list.title, exact: true})).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.dataset.pilotDocument)).toBe('original');
    await expect(page.locator('tr[data-item-id]').first().getByRole('checkbox')).toBeChecked();
    await expect(page.getByLabel('Title *', {exact: true})).toBeVisible();
    await expect(quickTitle).toHaveValue('');
    await captureState(page, testInfo, 'unsaved-navigation-discarded', quickTitle);
    await expect(row).toHaveAttribute('draggable', 'true');
    expect(errors).toEqual([]);
    await page.goto(`/frontend-pilot/packing/${list.id.toUpperCase()}`, {waitUntil: 'domcontentloaded'});
    await expect(page.locator('tr[data-item-id]').first().getByRole('checkbox')).toBeChecked();
    expect(await page.evaluate(key => localStorage.getItem(key), `packed_${list.id}_${itemId}`)).toBe('1');
});

test('loading overview regions renders the shell and faster authority independently', async ({page}, testInfo) => {
    const list = await packingFixture(page.request);
    const destination = '/frontend-pilot?locale=en&owner_main_q=' + encodeURIComponent(list.title);
    const response = await page.request.get(destination);
    expect(response.status()).toBe(200);
    const html = await response.text();
    const serialized = /<script id="surveyor-pilot-state" type="application\/json">([^<]+)<\/script>/u.exec(html);
    expect(serialized).not.toBeNull();
    // Initial HTML carries the authoritative session and actual region shells. It
    // does not wait for all four overview projections before the browser can paint.
    expect(JSON.parse(serialized![1]).overview).toBeUndefined();
    expect(html).toContain('data-loading-skeleton="cards"');

    const participantGate = readGate();
    const pattern = '**/api/v1/overview?*';
    async function delayParticipant(route: Route): Promise<void> {
        const query = new URL(route.request().url()).searchParams;
        if (query.get('collection') === 'participant' && query.get('region') === 'main') {
            await participantGate.promise;
        }
        await route.continue();
    }
    await page.route(pattern, delayParticipant);
    try {
        await page.goto(destination, {waitUntil: 'domcontentloaded'});
        const participant = page.locator('[data-collection="participant"][data-region="main"]');
        const owner = page.locator('[data-collection="owner"][data-region="main"]');
        await expect(participant.locator('[data-loading-skeleton="cards"]')).toBeVisible();
        await expect(owner.locator(`[data-id="${list.id}"]`)).toBeVisible();
        await expect(owner.locator('[data-loading-skeleton]')).toHaveCount(0);
        await expect(page.locator('header nav')).toBeVisible();
        await captureState(page, testInfo, 'loading-overview-independent-regions');

        // Decorative placeholders stop moving under the browser's real media
        // preference; loading still has a programmatically determined status.
        await page.emulateMedia({reducedMotion: 'reduce'});
        expect(await participant.locator('.pilot-skeleton-shapes').evaluate(node =>
            getComputedStyle(node).animationName)).toBe('none');
        await page.emulateMedia({reducedMotion: 'no-preference'});
        participantGate.release();
        await expect(participant.locator('[data-loading-skeleton]')).toHaveCount(0);
        await expect(owner.locator(`[data-id="${list.id}"]`)).toBeVisible();
    } finally {
        participantGate.release();
        await page.unroute(pattern, delayParticipant);
    }
});

test('loading packing and settings reveals available sections without replacing a focused draft', async ({page}, testInfo) => {
    const list = await packingFixture(page.request);
    const listGate = readGate();
    const settingsGate = readGate();
    const listPattern = '**/api/v1/packing-lists/' + list.id;
    const settingsPattern = listPattern + '/settings';
    async function delayList(route: Route): Promise<void> {
        await listGate.promise;
        await route.continue();
    }
    async function delaySettings(route: Route): Promise<void> {
        await settingsGate.promise;
        await route.continue();
    }
    await page.route(listPattern, delayList);
    await page.route(settingsPattern, delaySettings);
    try {
        await page.goto('/frontend-pilot/packing/' + list.id + '?locale=en', {waitUntil: 'domcontentloaded'});
        await expect(page.locator('main [data-loading-skeleton="table"]')).toBeVisible();
        await expect(page.locator('header nav')).toBeVisible();
        await captureState(page, testInfo, 'loading-packing-table');
        listGate.release();
        await expect(page.getByRole('heading', {name: list.title, exact: true})).toBeVisible();
        await expect(page.locator('tr[data-item-id]').first()).toBeVisible();
        await expect(page.locator('main [data-loading-skeleton]')).toHaveCount(0);
        await captureState(page, testInfo, 'loading-packing-loaded');

        await page.getByRole('button', {name: 'Entity settings', exact: true}).click();
        const dialog = page.getByRole('dialog');
        const title = dialog.locator('[name="title"]');
        // The genuine metadata read completes while the independent settings read
        // is held. Its authorized form can already accept a local draft.
        await expect(title).toBeVisible();
        await expect(dialog.locator('[data-loading-skeleton]')).toBeVisible();
        await title.fill('Draft entered before access and header arrive');
        await expect(title).toBeFocused();
        await captureState(page, testInfo, 'loading-settings-metadata-ready', dialog, {viewportOnly: true});
        settingsGate.release();
        await expect(dialog.locator('[data-loading-skeleton]')).toHaveCount(0);
        await expect(title).toHaveValue('Draft entered before access and header arrive');
        await expect(title).toBeFocused();
        await captureState(page, testInfo, 'loading-settings-loaded-draft', dialog, {viewportOnly: true});
    } finally {
        listGate.release();
        settingsGate.release();
        await page.unroute(listPattern, delayList);
        await page.unroute(settingsPattern, delaySettings);
    }
});

test('JavaScript-disabled identity pages remain message-only while native login and body-free logout retain their HTTP admission', async ({browser, baseURL}) => {
    const context = await browser.newContext({baseURL, javaScriptEnabled: false});
    try {
        const page = await context.newPage();
        const credentials = createE2ELogin();
        await page.goto('/frontend-pilot/users/login?locale=de', {waitUntil: 'domcontentloaded'});
        await expect(page.locator('noscript [role="alert"]')).toBeVisible();
        await expect(page.locator('#surveyor-pilot')).toBeHidden();
        const anonymous = await bootstrap(context.request);
        const controls = {_context: anonymous.context, _csrf: anonymous.csrfToken,
            _compatibility: anonymous.deployment.apiCompatibility, locale: 'de', next: '/frontend-pilot'};
        // The fallback changes presentation only. Exercise the established native
        // POST directly, retaining transport controls and safe credential redisplay.
        const rejected = await context.request.post('/frontend-pilot/users/login', {maxRedirects: 0,
            form: {...controls, username: credentials.username, password: 'invalid-native-password'}});
        expect(rejected.ok()).toBe(false);
        expect(await rejected.text()).not.toContain('value="invalid-native-password"');
        const accepted = await context.request.post('/frontend-pilot/users/login', {maxRedirects: 0,
            form: {...controls, ...credentials}});
        expect(accepted.status()).toBe(303);
        expect(accepted.headers().location).toBe('/frontend-pilot?locale=de');
        const account = await bootstrap(context.request);
        expect(account.kind).toBe('account');
        // The declared operation has no request body. Native hidden context controls
        // must still be admitted without inventing an input schema for this command.
        const logout = await context.request.post('/frontend-pilot/users/logout', {maxRedirects: 0,
            form: {_context: account.context, _csrf: account.csrfToken,
                _compatibility: account.deployment.apiCompatibility, locale: 'de', next: '/frontend-pilot'}});
        expect(logout.status()).toBe(303);
        expect(logout.headers().location).toBe('/frontend-pilot?locale=de');
        expect((await bootstrap(context.request)).kind).toBe('anonymous');
        await page.goto('/frontend-pilot/users/login?locale=de', {waitUntil: 'domcontentloaded'});
        await expect(page.locator('noscript [role="alert"]')).toBeVisible();
        await expect(page.locator('html')).toHaveAttribute('lang', 'de');
        await expect(page.locator('#surveyor-pilot')).toBeHidden();
    } finally { await context.close(); }
});

test('pilot owner keyboard dialog and mobile guest assignment retain readable, reachable controls', async ({page, browser, baseURL}, testInfo) => {
    await page.setViewportSize({width: 1280, height: 900});
    const list = await packing(page, true);
    const edit = page.getByRole('button', {name: 'Entity settings', exact: true});
    await edit.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    // Both implementations retain native roving tab focus and panel activation.
    // This crosses the real keyboard/Bootstrap boundary that happy-dom cannot prove.
    async function checkTabs(surface: ReturnType<Page['locator']>): Promise<void> {
        await surface.getByRole('tab', {name: 'General', exact: true}).focus();
        await surface.getByRole('tab', {name: 'General', exact: true}).press('ArrowRight');
        await expect(surface.getByRole('tab', {name: 'Linked event', exact: true})).toBeFocused();
        await expect(surface.getByRole('tab', {name: 'Linked event', exact: true})).toHaveAttribute('aria-selected', 'true');
        await surface.getByRole('tab', {name: 'Linked event', exact: true}).press('End');
        await expect(surface.getByRole('tab', {name: 'Actions', exact: true})).toBeFocused();
        await surface.getByRole('tab', {name: 'Actions', exact: true}).press('Home');
        await expect(surface.getByRole('tab', {name: 'General', exact: true})).toBeFocused();
        await expect(surface.getByRole('tab', {name: 'General', exact: true})).toHaveAttribute('aria-selected', 'true');
    }
    await checkTabs(dialog);
    await expect(dialog.locator('[name="title"]')).toHaveValue(list.title);
    await expect(dialog.getByRole('heading', {name: 'Properties', exact: true})).toBeVisible();
    const details = dialog.locator('summary').filter({hasText: /^Details$/}).locator('..');
    await expect(details).toHaveAttribute('open', '');
    await expect(details.locator('[name="description"]')).toHaveAttribute('rows', '4');
    await expect(dialog.locator('form').getByRole('button', {name: 'Save properties', exact: true})).toBeVisible();
    for (let index = 0; index < 8; index++) {
        await page.keyboard.press('Tab');
        expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
    }
    await page.screenshot({path: testInfo.outputPath('packing-owner-dialog-desktop.png'), fullPage: true});
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(edit).toBeFocused();
    const native = await page.context().newPage();
    try {
        await native.goto(list.path, {waitUntil: 'domcontentloaded'});
        await native.locator('button[data-bs-target="#entityPropertiesModal"]').click();
        await expect(native.locator('#entityPropertiesModal')).toBeVisible();
        await checkTabs(native.locator('#entityPropertiesModal'));
    } finally { await native.close(); }
    await page.screenshot({path: testInfo.outputPath('packing-owner-desktop.png'), fullPage: true});

    const guestContext = await browser.newContext({baseURL, viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true});
    try {
        const guestName = `Mobile guest ${randomUUID().slice(0, 6)}`;
        expect((await guestContext.request.post(`${list.path}/guest`, {form: {username: guestName}, maxRedirects: 0})).status()).toBe(302);
        const guest = await bootstrap(guestContext.request);
        expect(guest.kind).toBe('guest');
        const readOnly = await guestContext.request.get(`/api/v1/packing-lists/${list.id}/metadata`, {headers: headers(guest)});
        expect(readOnly.status()).toBe(200);
        expect(await readOnly.json()).toMatchObject({values: {}, editableFields: []});
        const mobile = await guestContext.newPage();
        await mobile.goto(`/frontend-pilot/packing/${list.id}`, {waitUntil: 'domcontentloaded'});
        await expect(mobile.getByRole('heading', {name: list.title, exact: true})).toBeVisible();
        await expect(mobile.getByRole('button', {name: 'Entity settings', exact: true})).toHaveCount(0);
        expect(await mobile.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
        await mobile.screenshot({path: testInfo.outputPath('packing-guest-mobile.png'), fullPage: true});
        const scrollRegion = mobile.locator('.table-responsive');
        // Natural table sizing may fit or scroll with the same rules as the current page.
        // Reachability matters; the pilot must not impose a separate fixed mobile table width.
        await scrollRegion.evaluate(element => { element.scrollLeft = element.scrollWidth; });
        const row = mobile.locator('tr[data-item-id]').first();
        const take = row.getByRole('button', {name: 'Take', exact: true});
        await expect(take).toBeInViewport({ratio: 1});
        await take.click();
        await expect(row.getByRole('button', {name: 'Remove', exact: true})).toBeVisible();
        await expect(row).toContainText(guestName);
        await mobile.screenshot({path: testInfo.outputPath('packing-guest-action-mobile.png'), fullPage: true});
        await row.getByRole('button', {name: 'Remove', exact: true}).click();
        await expect(take).toBeVisible();
        await expect(row).not.toContainText(guestName);
        expect(await mobile.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
    } finally { await guestContext.close(); }
});

test('pilot retains a dirty draft across a locale refresh and requires review after a stale save', async ({page}, testInfo) => {
    const list = await packing(page);
    await page.getByRole('button', {name: 'Entity settings', exact: true}).click();
    const dialog = page.getByRole('dialog');
    const description = dialog.locator('[name="description"]');
    await description.fill('Local description to preserve');
    await description.focus();
    const current = await bootstrap(page.request);
    expect((await page.request.put('/api/v1/locale', {headers: headers(current), data: {locale: 'de'}})).status()).toBe(200);
    // Another tab's locale preference is discovered on focus; the active modal retains its input node.
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(dialog.getByRole('heading', {name: 'Entitätseinstellungen', exact: true})).toBeVisible();
    await expect(description).toHaveValue('Local description to preserve');
    await expect(description).toBeFocused();
    const german = await bootstrap(page.request);
    expect((await page.request.put('/api/v1/locale', {headers: headers(german), data: {locale: 'en'}})).status()).toBe(200);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(dialog.getByRole('heading', {name: 'Entity settings', exact: true})).toBeVisible();

    // A second HTTP client edits the same real resource while this browser retains its original token.
    const freshSession = await bootstrap(page.request);
    const metadata = await page.request.get(`/api/v1/packing-lists/${list.id}/metadata`, {headers: headers(freshSession)});
    expect(metadata.status()).toBe(200);
    const changed = await page.request.patch(`/api/v1/packing-lists/${list.id}/metadata`, {
        headers: {...headers(freshSession), 'If-Match': metadata.headers().etag},
        data: {title: `Remote ${list.title}`, description: 'Remote description to compare'},
    });
    expect(changed.status()).toBe(200);
    const stale = page.waitForResponse(response => response.url().endsWith(`/packing-lists/${list.id}/metadata`)
        && response.request().method() === 'PATCH' && response.status() === 412);
    await dialog.getByRole('button', {name: 'Save properties', exact: true}).click();
    await stale;
    await expect(description).toHaveValue('Local description to preserve');
    await expect(dialog.getByRole('button', {name: 'Review changes', exact: true})).toBeDisabled();
    await expect(dialog.getByRole('button', {name: 'Save properties', exact: true})).toBeDisabled();
    await captureState(page, testInfo, 'metadata-stale-choice',
        dialog.getByRole('heading', {name: 'Changes are available', exact: true}).locator('..'), {viewportOnly: true});
    await captureState(page, testInfo, 'metadata-stale-choice-actions',
        dialog.getByRole('button', {name: 'Review changes', exact: true}), {
            viewportOnly: true,
            reachable: [dialog.getByRole('radio', {name: 'Use your change', exact: true}),
                dialog.getByRole('radio', {name: 'Use current value', exact: true}),
                dialog.getByRole('button', {name: 'Review changes', exact: true})],
        });
    await dialog.getByRole('radio', {name: 'Use your change', exact: true}).check();
    await expect(dialog.getByRole('button', {name: 'Review changes', exact: true})).toBeEnabled();
    await expect(dialog.getByRole('button', {name: 'Save properties', exact: true})).toBeDisabled();
    await dialog.getByRole('button', {name: 'Review changes', exact: true}).click();
    await expect(dialog.locator('[name="title"]')).toHaveValue(`Remote ${list.title}`);
    await expect(dialog.getByRole('button', {name: 'Save properties', exact: true})).toBeEnabled();
    await dialog.getByRole('button', {name: 'Save properties', exact: true}).click();
    await expect(dialog.getByRole('button', {name: 'Save properties', exact: true})).toBeDisabled();
    await dialog.getByRole('button', {name: 'Close', exact: true}).last().click();
    await expect(dialog).not.toBeVisible();
    const final = await page.request.get(`/api/v1/packing-lists/${list.id}/metadata`, {headers: headers(freshSession)});
    expect((await final.json()).values).toEqual({title: `Remote ${list.title}`, description: 'Local description to preserve'});
});

test('pilot distinguishes a lost assignment response from a confirmed assignment followed by failed refresh', async ({page}, testInfo) => {
    const list = await packing(page);
    const row = page.locator('tr[data-item-id]').first();
    const itemId = await row.getAttribute('data-item-id');
    const assignmentPath = `**/api/v1/packing-lists/${list.id}/items/${itemId}/self-assignment`;
    let sends = 0;
    await page.route(assignmentPath, async route => {
        sends++;
        const committed = await route.fetch();
        expect(committed.status()).toBe(200);
        await route.abort('connectionreset');
    });
    await row.getByRole('button', {name: 'Take', exact: true}).click();
    await expect(page.getByRole('status').filter({hasText: 'The result is uncertain.'})).toBeVisible();
    await captureState(page, testInfo, 'assignment-unknown-outcome', page.getByRole('status').filter({hasText: 'The result is uncertain.'}));
    await page.unroute(assignmentPath);
    await page.getByRole('button', {name: 'Refresh', exact: true}).click();
    await expect(row.locator('td').last().getByRole('button', {name: 'Remove', exact: true})).toBeVisible();
    expect(sends).toBe(1);

    await page.route(`**/api/v1/packing-lists/${list.id}`, route => route.abort('connectionreset'));
    await row.locator('td').last().getByRole('button', {name: 'Remove', exact: true}).click();
    await expect(page.getByRole('status').filter({hasText: 'Your change was saved, but the refreshed data could not be loaded.'})).toBeVisible({timeout: 15_000});
    await captureState(page, testInfo, 'assignment-saved-refresh-failed', page.getByRole('status').filter({hasText: 'Your change was saved, but the refreshed data could not be loaded.'}));
    await page.unroute(`**/api/v1/packing-lists/${list.id}`);
    const session = await bootstrap(page.request);
    const loaded = await page.request.get(`/api/v1/packing-lists/${list.id}`, {headers: headers(session)});
    const data = await loaded.json() as components['schemas']['PackingListView'];
    expect(data.items.find(item => item.id === itemId)?.selfAssigned).toBe(false);
});

test('pilot edits items with conflict review, quick-adds, reorders and removes another profile’s assignment', async ({page, browser, baseURL}, testInfo) => {
    test.setTimeout(60_000);
    const resource = await packing(page, true);
    await page.evaluate(() => { document.documentElement.dataset.pilotDocument = 'management'; });
    const initial = await readPacking(page.request, resource.id);
    const original = initial.items[0]!;
    const row = page.locator(`tr[data-item-id="${original.id}"]`);
    await row.locator('td').nth(2).dblclick();
    const title = row.getByRole('textbox', {name: 'Title', exact: true});
    await title.fill('Local tent title');
    const session = await bootstrap(page.request);
    // Commit an actual competing write; the mounted editor still owns its earlier item token.
    expect((await page.request.patch(`/api/v1/packing-lists/${resource.id}/items/${original.id}`, {
        headers: {...headers(session), 'If-Match': original.editToken}, data: {title: 'Remote tent title'},
    })).status()).toBe(200);
    await packingCommand(page, resource.id, `/items/${original.id}`, 'PATCH', () => title.press('Enter'), 412);
    await expect(title).toHaveValue('Local tent title');
    await expect(row).toContainText('Remote tent title');
    const previousViewport = page.viewportSize()!;
    await page.setViewportSize({width: 390, height: 844});
    const conflict = row.locator('.pilot-inline-conflict');
    // Gecko may report the 224px minimum as 223.9999847; compare whole CSS pixels
    // while the following viewport checks still protect readable, reachable controls.
    expect(Math.round((await conflict.boundingBox())!.width)).toBeGreaterThanOrEqual(224);
    await conflict.scrollIntoViewIfNeeded();
    await expect(conflict).toBeInViewport({ratio: 1});
    await expect(row.getByRole('button', {name: 'Review changes', exact: true})).toBeInViewport({ratio: 1});
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
    await page.setViewportSize(previousViewport);
    await captureState(page, testInfo, 'inline-stale-review', conflict);
    await row.getByRole('button', {name: 'Review changes', exact: true}).click();
    await packingCommand(page, resource.id, `/items/${original.id}`, 'PATCH', () => title.press('Enter'));
    await expect(row.locator('td').nth(2)).toHaveText('Local tent title');
    // Existing item titles may be cleared even though new-item titles are required.
    await row.locator('td').nth(2).dblclick();
    await title.fill('');
    await packingCommand(page, resource.id, `/items/${original.id}`, 'PATCH', () => title.press('Enter'));
    await expect(row.locator('td').nth(2)).toHaveText('');
    expect((await readPacking(page.request, resource.id)).items.find(item => item.id === original.id)?.title).toBe('');
    await row.locator('td').nth(2).dblclick();
    await title.fill('Local tent title');
    await packingCommand(page, resource.id, `/items/${original.id}`, 'PATCH', () => title.press('Enter'));
    await expect(row.locator('td').nth(2)).toHaveText('Local tent title');
    await row.locator('td').nth(4).dblclick();
    const capacity = row.getByRole('spinbutton', {name: 'Assigned / Max', exact: true});
    await capacity.fill('3');
    await packingCommand(page, resource.id, `/items/${original.id}`, 'PATCH', () => capacity.press('Enter'));
    await expect(row.locator('td').nth(4)).toHaveText('0 / 3');

    await page.getByLabel('Title *', {exact: true}).fill('Shared stove');
    await page.locator('#quick-description').fill('Bring gas');
    await page.locator('#quick-max').fill('2');
    await packingCommand(page, resource.id, '/items', 'POST',
        () => page.getByRole('button', {name: 'Add', exact: true}).click(), 201);
    await expect(page.locator('#quick-title')).toHaveValue('');
    const added = (await readPacking(page.request, resource.id)).items.find(item => item.title === 'Shared stove')!;
    const addedRow = page.locator(`tr[data-item-id="${added.id}"]`);
    await expect(addedRow).toContainText('Bring gas');
    await packingCommand(page, resource.id, '/item-order', 'PUT', () => addedRow.dragTo(row));
    await expect(page.locator('tr[data-item-id]').first()).toHaveAttribute('data-item-id', added.id);
    expect((await readPacking(page.request, resource.id)).items.sort((a, b) => a.position - b.position).map(item => item.id))
        .toEqual([added.id, original.id]);
    await packingCommand(page, resource.id, `/items/${added.id}`, 'PATCH', () => addedRow.getByRole('switch', {name: 'All', exact: true}).click());
    await expect(addedRow.getByRole('switch', {name: 'All', exact: true})).toBeChecked();
    await expect(addedRow.locator('td').nth(1)).toHaveText('Everyone');
    await packingCommand(page, resource.id, `/items/${added.id}`, 'PATCH', () => addedRow.getByRole('switch', {name: 'All', exact: true}).click());
    await expect(addedRow.getByRole('switch', {name: 'All', exact: true})).not.toBeChecked();

    const guest = await browser.newContext({baseURL});
    try {
        const name = `Assigned guest ${randomUUID().slice(0, 8)}`;
        expect((await guest.request.post(`${resource.path}/guest`, {form: {username: name}, maxRedirects: 0})).status()).toBe(302);
        const guestSession = await bootstrap(guest.request);
        expect((await guest.request.put(`/api/v1/packing-lists/${resource.id}/items/${original.id}/self-assignment`,
            {headers: headers(guestSession)})).status()).toBe(200);
        await page.getByRole('button', {name: 'Refresh', exact: true}).click();
        await expect(row.locator('td').nth(1)).toContainText(name);
        const assigned = (await readPacking(page.request, resource.id)).items.find(item => item.id === original.id)!.assignees[0]!;
        page.once('dialog', dialog => dialog.accept());
        await packingCommand(page, resource.id, `/assignments/${assigned.assignmentId}`, 'DELETE',
            () => row.locator('td').nth(1).getByRole('button', {name: 'Remove', exact: true}).click());
        await expect(row.locator('td').nth(1)).not.toContainText(name);
        expect((await readPacking(guest.request, resource.id)).items.find(item => item.id === original.id)?.selfAssigned).toBe(false);
    } finally { await guest.close(); }
    page.once('dialog', dialog => dialog.accept());
    await packingCommand(page, resource.id, `/items/${added.id}`, 'DELETE',
        () => addedRow.getByRole('button', {name: 'Delete item', exact: true}).click());
    await expect(addedRow).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.dataset.pilotDocument)).toBe('management');
});

test('pilot settings manage delegated access, header images, event links and archival without losing a properties draft', async ({page, browser, baseURL}) => {
    test.setTimeout(60_000);
    const resource = await packing(page, true);
    const eventInput = createE2EEvent();
    eventInput.title = eventInput.form.title = `Packing destination ${randomUUID()}`;
    Object.assign(eventInput.form, {startDate: '2099-10-07', endDate: '2099-10-09'});
    const event = await createResourceViaForm(page.request, eventInput);
    const delegate = await browser.newContext({baseURL});
    try {
        // The native administrator search deliberately lists full-account profiles.
        // A distinct active profile keeps this session from inheriting the owner's grant.
        const delegateName = `Delegate ${randomUUID().slice(0, 8)}`;
        await loginForE2E(delegate.request, createE2ELogin());
        expect((await delegate.request.post('/users/profile/create', {form: {name: delegateName}, maxRedirects: 0})).status()).toBe(302);
        const profiles = await bootstrap(delegate.request);
        const delegateProfile = profiles.profiles.find(profile => profile.name === delegateName)!;
        expect(delegateProfile).toBeDefined();
        expect((await delegate.request.get(`/users/profile/change/${delegateProfile.id}`, {maxRedirects: 0})).status()).toBe(302);
        const delegateSession = await bootstrap(delegate.request);
        await page.getByRole('button', {name: 'Entity settings', exact: true}).click();
        const dialog = page.getByRole('dialog');
        await dialog.locator('[name="description"]').fill('Saved before changing another settings panel');
        await packingCommand(page, resource.id, '/metadata', 'PATCH',
            () => dialog.getByRole('button', {name: 'Save properties', exact: true}).click());
        await expect(dialog.getByRole('button', {name: 'Save properties', exact: true})).toBeDisabled();
        await dialog.getByRole('tab', {name: 'Access', exact: true}).click();
        await dialog.getByRole('tab', {name: 'Group Permissions', exact: true}).click();
        await dialog.getByLabel('Permission audience', {exact: true}).selectOption('guest');
        await dialog.locator('#settings-defaults-guest-ACCESS_VIEW').check();
        await packingCommand(page, resource.id, '/default-permissions', 'PUT',
            () => dialog.getByRole('button', {name: 'Update permissions', exact: true}).click());
        await dialog.getByRole('tab', {name: 'Administrators', exact: true}).click();
        const admins = dialog.locator('#pilot-access-admins');
        await admins.getByRole('button', {name: 'Add', exact: true}).click();
        await admins.getByLabel('User (name or email)', {exact: true}).fill(delegateName);
        await expect(admins.locator('#profile-results option')).toHaveCount(1);
        const selectedValue = await admins.locator('#profile-results option').getAttribute('value');
        expect(selectedValue).toBeTruthy();
        await admins.getByLabel('User (name or email)', {exact: true}).fill(selectedValue!);
        await packingCommand(page, resource.id, '/admins', 'POST',
            () => admins.locator('form').getByRole('button', {name: 'Add', exact: true}).click());
        const card = admins.locator('.accordion-item').filter({hasText: delegateName});
        await card.locator('.accordion-button').click();
        await card.locator(`#admin-${delegateSession.activeProfile!.id}-EDIT_TITLE`).check();
        await packingCommand(page, resource.id, `/admins/${delegateSession.activeProfile!.id}`, 'PATCH',
            () => card.getByRole('button', {name: 'Save', exact: true}).click());
        const delegated = await delegate.request.get(`/api/v1/packing-lists/${resource.id}/metadata`, {headers: headers(delegateSession)});
        expect(delegated.status()).toBe(200);
        expect((await delegated.json()).editableFields).toEqual(['title']);
        page.once('dialog', confirmation => confirmation.accept());
        await packingCommand(page, resource.id, `/admins/${delegateSession.activeProfile!.id}`, 'DELETE',
            () => card.getByRole('button', {name: 'Remove', exact: true}).click());
        await expect(card).toHaveCount(0);

        await dialog.getByRole('tab', {name: 'General', exact: true}).click();
        await dialog.locator('summary').filter({hasText: /^Header image$/}).click();
        const png = readFileSync('src/public/img/logo.png');
        await dialog.getByLabel('Choose image', {exact: true}).setInputFiles({name: 'packing-header.png', mimeType: 'image/png', buffer: png});
        await packingCommand(page, resource.id, '/header', 'PUT', () => dialog.getByRole('button', {name: 'Upload', exact: true}).click());
        expect((await readPacking(page.request, resource.id)).headerVersion).not.toBeNull();
        page.once('dialog', confirmation => confirmation.accept());
        await packingCommand(page, resource.id, '/header', 'DELETE',
            () => dialog.getByRole('button', {name: 'Remove image', exact: true}).click());
        expect((await readPacking(page.request, resource.id)).headerVersion).toBeNull();

        await dialog.getByRole('tab', {name: 'Linked event', exact: true}).click();
        await dialog.getByRole('searchbox', {name: 'Search events', exact: true}).fill(event.title);
        const option = dialog.locator(`[data-event-id="${event.id}"]`);
        await expect(option).toBeVisible();
        await option.click();
        page.once('dialog', confirmation => confirmation.accept());
        await packingCommand(page, resource.id, '/event', 'PUT',
            () => dialog.getByRole('button', {name: 'Save event link', exact: true}).click());
        expect((await readPacking(page.request, resource.id)).currentEventId).toBe(event.id);
        await dialog.getByRole('tab', {name: 'Actions', exact: true}).click();
        page.once('dialog', confirmation => confirmation.accept());
        await packingCommand(page, resource.id, '/archive', 'POST',
            () => dialog.getByRole('button', {name: 'Archive for everyone', exact: true}).click());
        expect((await readPacking(page.request, resource.id)).archived).toBe(true);
        page.once('dialog', confirmation => confirmation.accept());
        await packingCommand(page, resource.id, '/restore', 'POST',
            () => dialog.getByRole('button', {name: 'Restore for everyone', exact: true}).click());
        expect((await readPacking(page.request, resource.id)).archived).toBe(false);

        await dialog.getByRole('tab', {name: 'General', exact: true}).click();
        await dialog.locator('[name="description"]').fill('Preserved while visiting other settings');
        await dialog.getByRole('tab', {name: 'Access', exact: true}).click();
        await dialog.getByRole('tab', {name: 'General', exact: true}).click();
        await expect(dialog.locator('[name="description"]')).toHaveValue('Preserved while visiting other settings');
        await packingCommand(page, resource.id, '/metadata', 'PATCH',
            () => dialog.getByRole('button', {name: 'Save properties', exact: true}).click());
        await expect(dialog.getByRole('button', {name: 'Save properties', exact: true})).toBeDisabled();
        await dialog.getByRole('button', {name: 'Close', exact: true}).last().click();
        await expect(page.getByRole('link', {name: 'Go to event', exact: true})).toHaveAttribute('href', event.path);
        expect((await readPacking(page.request, resource.id)).description).toBe('Preserved while visiting other settings');
    } finally { await delegate.close(); }
});

test('pilot creates and duplicates complete lists through the SPA forms with row and Everyone controls', async ({page}) => {
    test.setTimeout(60_000);
    await loginForE2E(page.request, createE2ELogin());
    await page.goto('/frontend-pilot/packing/create', {waitUntil: 'domcontentloaded'});
    await expect(page.getByRole('heading', {name: 'Create packing list', exact: true})).toBeVisible();
    await page.setViewportSize({width: 390, height: 844});
    const nativeCreation = await page.context().newPage();
    try {
        await nativeCreation.setViewportSize({width: 390, height: 844});
        await nativeCreation.goto('/packing/create', {waitUntil: 'domcontentloaded'});
        for (const candidate of [nativeCreation, page]) {
            const trigger = candidate.getByLabel('Assign to event (optional)', {exact: true});
            await trigger.click();
            const picker = candidate === page ? candidate.getByRole('dialog') : candidate.locator('.modal.show .modal-content');
            await expect(picker.getByRole('searchbox', {name: 'Search events', exact: true})).toBeFocused();
            const bounds = await picker.boundingBox();
            expect(bounds).not.toBeNull();
            expect(bounds!.x).toBeCloseTo(8, 0);
            expect(bounds!.y).toBeCloseTo(8, 0);
            expect(bounds!.width).toBeCloseTo(374, 0);
            expect(bounds!.height).toBeLessThanOrEqual(828);
            await candidate.keyboard.press('Escape');
            await expect(picker).not.toBeVisible();
            await expect(trigger).toBeFocused();
        }
    } finally { await nativeCreation.close(); }
    await page.setViewportSize({width: 1280, height: 900});
    await page.evaluate(() => { document.documentElement.dataset.pilotDocument = 'creation'; });
    const title = `Created in Vue ${randomUUID()}`;
    await page.getByLabel('Title *', {exact: true}).fill(title);
    await page.getByLabel('Description (optional)', {exact: true}).fill('First line\nSecond line');
    await page.getByRole('textbox', {name: 'Item 1', exact: true}).fill('Tent');
    await page.getByRole('textbox', {name: 'Description 1', exact: true}).fill('Shared');
    await page.getByRole('spinbutton', {name: 'Max # 1', exact: true}).fill('2');
    await page.getByRole('button', {name: 'Add row', exact: true}).click();
    await page.getByRole('textbox', {name: 'Item 2', exact: true}).fill('Bottle');
    await page.locator('tbody tr').nth(1).getByRole('checkbox').check();
    const created = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/packing-lists'
        && response.request().method() === 'POST');
    await page.getByRole('button', {name: 'Create list', exact: true}).click();
    const createResponse = await created;
    expect(createResponse.status()).toBe(201);
    const originalId = (await createResponse.json()).id as string;
    await expect(page).toHaveURL(new RegExp('/frontend-pilot/packing/' + originalId + '$'));
    await expect(page.getByRole('heading', {name: title, exact: true})).toBeVisible();
    const original = await readPacking(page.request, originalId);
    expect(original.items.sort((a, b) => a.position - b.position).map(item => [item.title, item.requiredByAll, item.maxAssignees]))
        .toEqual([['Tent', false, 2], ['Bottle', true, 1]]);
    await page.getByRole('button', {name: 'Entity settings', exact: true}).click();
    await page.getByRole('dialog').getByRole('tab', {name: 'Actions', exact: true}).click();
    await page.getByRole('dialog').getByRole('link', {name: 'Duplicate', exact: true}).click();
    await expect(page).toHaveURL(new RegExp('/frontend-pilot/packing/' + originalId + '/duplicate$'));
    await expect(page.getByLabel('Title *', {exact: true})).toHaveValue(title);
    await expect(page.getByRole('textbox', {name: 'Item 1', exact: true})).toHaveValue('Tent');
    await expect(page.locator('tbody tr').nth(1).getByRole('checkbox')).toBeChecked();
    await page.getByLabel('Title *', {exact: true}).fill(title + ' copy');
    await page.locator('tbody tr').first().getByRole('button', {name: 'Remove row', exact: true}).click();
    await page.getByRole('button', {name: 'Add row', exact: true}).click();
    await page.getByRole('textbox', {name: 'Item 2', exact: true}).fill('Hammock');
    await page.getByRole('spinbutton', {name: 'Max # 2', exact: true}).fill('2');
    const copied = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/packing-lists'
        && response.request().method() === 'POST');
    await page.getByRole('button', {name: 'Create list', exact: true}).click();
    const copyResponse = await copied;
    expect(copyResponse.status()).toBe(201);
    const copyId = (await copyResponse.json()).id as string;
    expect(copyId).not.toBe(originalId);
    await expect(page.getByRole('heading', {name: title + ' copy', exact: true})).toBeVisible();
    const copy = await readPacking(page.request, copyId);
    expect(copy.currentEventId).toBeNull();
    expect(copy.headerUrl).toBeNull();
    expect(copy.items.sort((a, b) => a.position - b.position).map(item => [item.title, item.requiredByAll, item.assignedCount]))
        .toEqual([['Bottle', true, 0], ['Hammock', false, 0]]);
    expect(await page.evaluate(() => document.documentElement.dataset.pilotDocument)).toBe('creation');
});

test('pilot overview preserves personal visibility, shared archive state and linked navigation across collections', async ({page}) => {
    test.setTimeout(60_000);
    await loginForE2E(page.request, createE2ELogin());
    // A fresh active profile gives this lifecycle a bounded overview without deleting existing fixtures.
    const marker = `Overview ${randomUUID().slice(0, 8)}`;
    expect((await page.request.post('/users/profile/create', {form: {name: marker}, maxRedirects: 0})).status()).toBe(302);
    const profile = (await bootstrap(page.request)).profiles.find(value => value.name === marker);
    expect(profile).toBeDefined();
    expect((await page.request.get('/users/profile/change/' + profile!.id, {maxRedirects: 0})).status()).toBe(302);
    const input = createE2EPackingList();
    input.title = input.form.title = marker + ' standalone';
    const standalone = await createResourceViaForm(page.request, input);
    const eventInput = createE2EEvent();
    eventInput.title = eventInput.form.title = marker + ' event';
    Object.assign(eventInput.form, {startDate: '2099-10-07', endDate: '2099-10-09'});
    const event = await createResourceViaForm(page.request, eventInput);
    const linkedInput = createE2EPackingList();
    linkedInput.title = linkedInput.form.title = marker + ' linked';
    Object.assign(linkedInput.form, {event_id: event.id});
    const linked = await createResourceViaForm(page.request, linkedInput);
    const standaloneView = await readPacking(page.request, standalone.id);
    expect((await page.request.put(`/api/v1/packing-lists/${standalone.id}/items/${standaloneView.items[0]!.id}/self-assignment`,
        {headers: headers(await bootstrap(page.request))})).status()).toBe(200);

    await page.goto('/frontend-pilot', {waitUntil: 'domcontentloaded'});
    await page.evaluate(() => { document.documentElement.dataset.pilotDocument = 'overview'; });
    const owner = page.locator('[data-collection="owner"][data-region="main"]');
    const participant = page.locator('[data-collection="participant"][data-region="main"]');
    const ownedCard = owner.locator(`[data-id="${standalone.id}"]`);
    await expect(ownedCard).toBeVisible();
    await expect(participant.locator(`[data-id="${standalone.id}"]`)).toBeVisible();
    await owner.getByRole('searchbox').fill(marker + ' standalone');
    await owner.getByRole('button', {name: 'Search', exact: true}).click();
    await expect(owner.locator(`[data-id="${event.id}"]`)).toHaveCount(0);
    await expect(owner).toContainText('1 matching entity');

    // A near-bottom card menu must stay reachable without scrolling after it opens,
    // including when the keyboard selects its first action.
    const archiveTrigger = ownedCard.locator('summary');
    await archiveTrigger.evaluate(element => element.scrollIntoView({block: 'end'}));
    await archiveTrigger.focus();
    await page.keyboard.press('ArrowDown');
    const archiveMenu = ownedCard.locator('.dropdown-menu');
    await expect(ownedCard.getByRole('button', {name: 'Archive for everyone', exact: true})).toBeFocused();
    await expect.poll(async () => {
        const box = await archiveMenu.boundingBox();
        return !!box && box.y >= 0 && box.y + box.height <= page.viewportSize()!.height;
    }).toBe(true);
    await page.keyboard.press('Escape');
    await expect(archiveMenu).toBeHidden();
    await expect(archiveTrigger).toBeFocused();

    async function preference(card: ReturnType<Page['locator']>, value: 'hidden' | 'shown' | 'default'): Promise<void> {
        await card.locator('summary').click();
        const response = page.waitForResponse(result => new URL(result.url()).pathname === `/api/v1/overview/packing/${standalone.id}/visibility`
            && result.request().method() === 'PUT');
        await card.getByRole('button', {name: {hidden: 'Hide for me', shown: 'Show for me', default: 'Use default visibility'}[value], exact: true}).click();
        const saved = await response;
        expect(saved.status()).toBe(200);
        expect((await saved.json()).visibility).toBe(value);
    }
    await preference(ownedCard, 'hidden');
    await expect(ownedCard).toHaveCount(0);
    await expect(participant.locator(`[data-id="${standalone.id}"]`)).toHaveCount(0);
    expect((await readPacking(page.request, standalone.id)).archived).toBe(false);
    await owner.locator('..').getByRole('link', {name: /^Archived and hidden/}).click();
    const hidden = page.locator('[data-collection="owner"][data-region="hidden"]');
    const hiddenCard = hidden.locator(`[data-id="${standalone.id}"]`);
    await expect(hiddenCard).toContainText('Hidden for me');
    await preference(hiddenCard, 'shown');
    await expect(ownedCard).toContainText('Shown for me');
    await expect(participant.locator(`[data-id="${standalone.id}"]`)).toBeVisible();

    // Explicitly shown is independent of authoritative archival: the card stays in main.
    await ownedCard.locator('summary').click();
    page.once('dialog', dialog => dialog.accept());
    await packingCommand(page, standalone.id, '/archive', 'POST',
        () => ownedCard.getByRole('button', {name: 'Archive for everyone', exact: true}).click());
    await expect(ownedCard.locator('.badge').filter({hasText: /^Archived$/})).toBeVisible();
    await expect(ownedCard).toContainText('Shown for me');
    await preference(ownedCard, 'default');
    await expect(ownedCard).toHaveCount(0);
    await expect(hiddenCard).toBeVisible();
    await hiddenCard.locator('summary').click();
    page.once('dialog', dialog => dialog.accept());
    await packingCommand(page, standalone.id, '/restore', 'POST',
        () => hiddenCard.getByRole('button', {name: 'Restore for everyone', exact: true}).click());
    await expect(ownedCard).toBeVisible();
    expect((await readPacking(page.request, standalone.id)).archived).toBe(false);

    await owner.getByRole('link', {name: 'Clear filters', exact: true}).click();
    const eventCard = owner.locator(`[data-id="${event.id}"]`);
    await expect(eventCard).toContainText('Show linked entities (1)');
    await eventCard.getByRole('link', {name: 'Show linked entities for ' + event.title, exact: true}).click();
    await expect(page).toHaveURL(new RegExp('owner_main_event=' + event.id));
    await expect(owner.locator('.entity-overview-children')).toContainText(linked.title);
    await expect(owner.locator('.entity-overview-children')).toContainText('Linked entities 1–1 of 1');
    await owner.getByRole('link', {name: 'Back to overview', exact: true}).click();
    await expect(owner.locator('.entity-overview-children')).toHaveCount(0);
    await eventCard.getByRole('link', {name: 'Show linked entities for ' + event.title, exact: true}).click();
    await owner.locator(`[data-id="${linked.id}"] > a.card-body`).click();
    await expect(page).toHaveURL(new RegExp('/frontend-pilot/packing/' + linked.id + '$'));
    await expect(page.getByRole('heading', {name: linked.title, exact: true})).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.dataset.pilotDocument)).toBe('overview');
});

test('pilot help supports native search and isolates SSR locale and hostile profile text', async ({browser, baseURL}) => {
    const english = await browser.newContext({baseURL, javaScriptEnabled: false});
    const german = await browser.newContext({baseURL, javaScriptEnabled: false});
    try {
        const englishPage = await english.newPage();
        const germanPage = await german.newPage();
        await Promise.all([
            englishPage.goto('/frontend-pilot/help?locale=en', {waitUntil: 'domcontentloaded'}),
            germanPage.goto('/frontend-pilot/help?locale=de', {waitUntil: 'domcontentloaded'}),
        ]);
        await expect(englishPage.locator('html')).toHaveAttribute('lang', 'en');
        await expect(germanPage.locator('html')).toHaveAttribute('lang', 'de');
        await expect(englishPage.getByRole('button', {name: 'Search help', exact: true})).toBeVisible();
        await expect(germanPage.getByRole('button', {name: 'Hilfe durchsuchen', exact: true})).toBeVisible();
        await englishPage.getByRole('searchbox').fill(`fixture-${randomUUID()}`);
        await englishPage.getByRole('button', {name: 'Search help', exact: true}).click();
        await expect(englishPage).toHaveURL(/\/frontend-pilot\/help\?.*q=/);
        await expect(englishPage.getByRole('searchbox')).not.toHaveValue('');
        // Synthetic identity text exercises SSR escaping without asserting maintained help content.
        await loginForE2E(english.request, createE2ELogin());
        const hostileName = `${randomUUID().slice(0, 6)}</script><script>1</script>`;
        expect((await english.request.post('/users/profile/create', {form: {name: hostileName}, maxRedirects: 0})).status()).toBe(302);
        const session = await bootstrap(english.request);
        const profile = session.profiles.find(item => item.name === hostileName);
        expect(profile).toBeDefined();
        expect((await english.request.get(`/users/profile/change/${profile!.id}`, {maxRedirects: 0})).status()).toBe(302);
        await englishPage.goto('/frontend-pilot/help?locale=en', {waitUntil: 'domcontentloaded'});
        await expect(englishPage.locator('header nav')).toContainText(hostileName);
        const state = await englishPage.locator('#surveyor-pilot-state').textContent();
        expect(state).not.toContain('</script>');
        expect(JSON.parse(state!).session.activeProfile.name).toBe(hostileName);
        await expect(englishPage.locator('script:not([type="application/json"])').filter({hasText: /^1$/})).toHaveCount(0);
        await expect(germanPage.locator('header nav')).not.toContainText(hostileName);
    } finally { await english.close(); await german.close(); }
});
