import {test, expect, type Browser, type Page} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {expectVisiblePresentation, loginForE2E, readProfileWorkflowFixtureForE2E,
    readVisiblePresentation, withProfileWorkflowFixtureForE2E} from '../keywords/e2eCoreKeywords';
import {waitForPilotHydration} from '../keywords/frontendDynamicKeywords';

/** Snapshot real browser geometry while retaining ordinary native/pilot page rendering. */
function workflowPresentation() {
    function bounds(selector: string) {
        const element = document.querySelector(selector);
        if (!element || !element.getClientRects().length) return null;
        const rectangle = element.getBoundingClientRect();
        return {x: rectangle.x, y: rectangle.y, width: rectangle.width, height: rectangle.height};
    }

    function submitColors() {
        const button = document.querySelector('main button[type="submit"]');
        if (!button) return null;
        const style = getComputedStyle(button);
        return {color: style.color, background: style.backgroundColor, border: style.borderColor};
    }

    return {heading: bounds('main h1'), field: bounds('main input:not([type="hidden"]):not([hidden])'),
        submit: bounds('main button[type="submit"]'), token: bounds('main h3'),
        submitColors: submitColors(), footer: bounds('footer'),
        scrollWidth: document.documentElement.scrollWidth, scrollY: window.scrollY};
}

async function waitForWorkflowFonts(): Promise<void> { await document.fonts.ready; }

/** Translate the same confirmed notice through the real locale command. Reading
 * another language must neither replace its DOM receipt nor replay the completed
 * transfer/deactivation/deletion operation. Timer boundaries have mounted coverage. */
async function expectTranslatedCompletion(page: Page, english: string, german: string, commandPath: string): Promise<void> {
    const notice = page.locator('.pilot-page-notices > .alert-success').filter({hasText: english});
    await expect(notice).toHaveText(english);
    await notice.evaluate(element => { element.dataset.e2eCompletion = 'confirmed'; });
    const repeatedCommands: string[] = [];
    page.on('request', recordRepeatedCommand);
    try {
        await page.locator('#pilot-locale').selectOption('de');
        const retained = page.locator('[data-e2e-completion="confirmed"]');
        await expect(retained).toHaveText(german);
        await page.locator('#pilot-locale').selectOption('en');
        await expect(retained).toHaveText(english);
        expect(repeatedCommands).toEqual([]);
    } finally { page.off('request', recordRepeatedCommand); }

    function recordRepeatedCommand(request: import('@playwright/test').Request): void {
        if (request.method() !== 'GET' && new URL(request.url()).pathname === commandPath) repeatedCommands.push(request.url());
    }
}

/** Observe real main-frame requests alongside the document lifetime assertion.
 * API requests and lazy assets cannot count as a successful SPA departure. */
function observeDocumentNavigations(page: Page): string[] {
    const paths: string[] = [];
    page.on('request', function recordDocumentRequest(request) {
        if (request.isNavigationRequest() && request.frame() === page.mainFrame()) paths.push(new URL(request.url()).pathname);
    });
    return paths;
}

/** Obtain the source token through its genuine built page under an independent guest cookie. */
async function migrationTokenForWorkflow(browser: Browser, baseURL: string | undefined, loginPath: string): Promise<string> {
    const sourceContext = await browser.newContext({baseURL, extraHTTPHeaders: {Connection: 'close'}});
    try {
        const source = await sourceContext.newPage();
        expect((await source.request.get(loginPath, {maxRedirects: 0})).status()).toBe(302);
        await source.goto('/frontend-pilot/users/profile/migrate/request?locale=en');
        await waitForPilotHydration(source);
        const token = (await source.locator('main h3').textContent())!.trim();
        expect(token).not.toBe('');
        return token;
    } finally { await sourceContext.close(); }
}

/** Reach native preview by its document POST and pilot preview by its generated read-only JSON operation.
 * Transfer uses its generated command; neither renderer receives manufactured HTML or intercepted results. */
async function previewOnPage(page: Page, pilot: boolean, token: string): Promise<void> {
    await page.goto(`${pilot ? '/frontend-pilot' : ''}/users/profile/migrate/show${pilot ? '?locale=en' : ''}`);
    if (pilot) await waitForPilotHydration(page);
    await page.locator('#token').fill(token);
    // Unchanged native icons contribute a glyph prefix to accessible names.
    // Match the precise action suffix in both renderers without omitting its label.
    await page.getByRole('button', {name: /Show migration profile$/u}).click();
    if (pilot) await waitForPilotHydration(page);
    const execute = page.getByRole('button', {name: /Permanently migrate profile$/u});
    await expect(execute).toBeVisible();
    await expect(execute).toBeEnabled();
    if (pilot) await expect(page).toHaveURL(/#migration-preview$/u);
}

test('transfers only after preview, then deactivates through JSON while retaining the same document', async function transferThroughBuiltPage({page, browser, baseURL}) {
    await withProfileWorkflowFixtureForE2E(async function exerciseTransfer(fixture) {
        const token = await migrationTokenForWorkflow(browser, baseURL, fixture.guest.loginPath);
        await loginForE2E(page.request, fixture.account);
        await previewOnPage(page, true, token);
        await expect(page.locator('main')).toContainText(fixture.guest.username);
        expect(new URL(page.url()).searchParams.has('token')).toBe(false);

        // Preview leaves the original owner/token intact. The explicit generated
        // execute command is the only action allowed to change these real rows.
        const preview = await readProfileWorkflowFixtureForE2E(fixture);
        expect(preview.profiles.find(profile => profile.id === fixture.guest.profileId))
            .toMatchObject({guestId: fixture.guest.id, userId: null, hasMigrationToken: true});
        const originalDocument = await page.evaluate(() => performance.timeOrigin);
        const documentNavigations = observeDocumentNavigations(page);
        const response = page.waitForResponse(result => result.request().method() === 'POST'
            && new URL(result.url()).pathname === '/api/v1/profiles/migration/execute');
        await page.getByRole('button', {name: 'Permanently migrate profile', exact: true}).click();
        expect((await response).status()).toBe(200);
        await expect(page).toHaveURL(/\/frontend-pilot\/users\/profile\/manage(?:\?[^#]*)?$/u);
        expect(await page.evaluate(() => performance.timeOrigin)).toBe(originalDocument);
        await expectTranslatedCompletion(page, 'Migration successful. Previous guest account permanently deleted!',
            'Profil erfolgreich übertragen. Das vorherige Gastkonto wurde dauerhaft gelöscht!', '/api/v1/profiles/migration/execute');
        const saved = await readProfileWorkflowFixtureForE2E(fixture);
        expect(saved.guestCount).toBe(0);
        expect(saved.profiles.find(profile => profile.id === fixture.guest.profileId))
            .toMatchObject({guestId: null, userId: fixture.account.id, hasMigrationToken: false});
        const session = await (await page.request.get('/api/v1/session')).json();
        expect(session.activeProfile.id).toBe(fixture.account.profileId);

        // The transferred profile supplies the real remaining selection. Exercise
        // deactivation through the shell and form without creating unowned rows.
        await page.getByRole('button', {name: session.activeProfile.name, exact: true}).click();
        await page.getByRole('link', {name: 'Profile settings', exact: true}).click();
        await page.getByRole('link', {name: 'Delete profile', exact: true}).click();
        await expect(page.locator('#name')).toBeVisible();
        await page.locator('#name').fill('Incorrect confirmation');
        const rejected = page.waitForResponse(result => result.request().method() === 'POST'
            && new URL(result.url()).pathname === '/api/v1/profiles/current/deactivate');
        await page.getByRole('button', {name: 'Permanently deactivate profile', exact: true}).click();
        expect((await rejected).status()).toBe(400);
        await expect(page.locator('#name')).toHaveValue('Incorrect confirmation');
        expect((await readProfileWorkflowFixtureForE2E(fixture)).profiles.find(profile => profile.id === fixture.account.profileId))
            .toMatchObject({userId: fixture.account.id});

        await page.locator('#name').fill(session.activeProfile.name);
        const deactivated = page.waitForResponse(result => result.request().method() === 'POST'
            && new URL(result.url()).pathname === '/api/v1/profiles/current/deactivate');
        await page.getByRole('button', {name: 'Permanently deactivate profile', exact: true}).click();
        expect((await deactivated).status()).toBe(200);
        await expect(page).toHaveURL(/\/frontend-pilot\/users\/profile\/manage(?:\?[^#]*)?$/u);
        await expectTranslatedCompletion(page, 'Profile successfully deactivated.', 'Profil erfolgreich deaktiviert.',
            '/api/v1/profiles/current/deactivate');
        const after = await readProfileWorkflowFixtureForE2E(fixture);
        expect(after.accountCount).toBe(1);
        expect(after.profiles.find(profile => profile.id === fixture.account.profileId)).toMatchObject({userId: null});
        expect((await (await page.request.get('/api/v1/session')).json()).activeProfile.id).toBe(fixture.guest.profileId);
        expect(await page.evaluate(() => performance.timeOrigin)).toBe(originalDocument);
        expect(documentNavigations).toEqual([]);
    });
});

test('returns from preview with native entry state without automatically repeating its POST', async function restoresEntryOnBack({page, browser, baseURL}) {
    await withProfileWorkflowFixtureForE2E(async function exerciseBack(fixture) {
        const token = await migrationTokenForWorkflow(browser, baseURL, fixture.guest.loginPath);
        await loginForE2E(page.request, fixture.account);
        // Browser history restoration is the oracle, including the unchanged
        // native document's actual field value under this browser configuration.
        await previewOnPage(page, false, token);
        await page.goBack();
        await page.evaluate(waitForWorkflowFonts);
        const nativeValue = await page.locator('#token').inputValue();
        const nativeEnabled = await page.getByRole('button', {name: /Show migration profile$/u}).isEnabled();
        const submitted: string[] = [];
        page.on('request', function observeSubmission(request) {
            if (request.method() === 'POST') submitted.push(new URL(request.url()).pathname);
        });
        await previewOnPage(page, true, token);
        expect(submitted).toEqual(['/api/v1/profiles/migration/preview']);
        await page.goBack();
        await waitForPilotHydration(page);

        // The pilot marker changes this mounted visit only. Back and Forward must
        // retain its native field/result behavior without another preview request
        // or execution. A later reload cannot reconstruct that private local result.
        await expect(page.locator('#token')).toHaveValue(nativeValue);
        expect(await page.getByRole('button', {name: 'Show migration profile', exact: true}).isEnabled()).toBe(nativeEnabled);
        expect(submitted).toEqual(['/api/v1/profiles/migration/preview']);
        await page.goForward();
        await expect(page.getByRole('button', {name: 'Permanently migrate profile', exact: true})).toBeVisible();
        expect(submitted).toEqual(['/api/v1/profiles/migration/preview']);
        await page.goBack();
        await expect(page.locator('#token')).toHaveValue(nativeValue);
        await page.locator('#token').fill(token);
        await page.getByRole('button', {name: 'Show migration profile', exact: true}).click();
        await expect(page.getByRole('button', {name: 'Permanently migrate profile', exact: true})).toBeVisible();
        expect(submitted).toEqual(['/api/v1/profiles/migration/preview', '/api/v1/profiles/migration/preview']);
        await page.reload();
        await waitForPilotHydration(page);
        await expect(page.locator('#token')).toHaveValue('');
        await expect(page.getByRole('button', {name: 'Permanently migrate profile', exact: true})).toHaveCount(0);
        expect(submitted).toEqual(['/api/v1/profiles/migration/preview', '/api/v1/profiles/migration/preview']);
        const saved = await readProfileWorkflowFixtureForE2E(fixture);
        expect(saved.profiles.find(profile => profile.id === fixture.guest.profileId))
            .toMatchObject({guestId: fixture.guest.id, hasMigrationToken: true});
    });
});

for (const kind of ['account', 'guest'] as const) {
    test(`retains wrong ${kind} deletion input and completes its same-document JSON confirmation`, async function deleteThroughBuiltPage({page}) {
        await withProfileWorkflowFixtureForE2E(async function exerciseDeletion(fixture) {
            if (kind === 'account') await loginForE2E(page.request, fixture.account);
            else expect((await page.request.get(fixture.guest.loginPath, {maxRedirects: 0})).status()).toBe(302);
            await page.goto('/frontend-pilot/users/account/delete?locale=en');
            await waitForPilotHydration(page);
            await expect(page.locator('#username')).toHaveValue('');
            await page.locator('#username').fill('Incorrect confirmation');
            const originalDocument = await page.evaluate(() => performance.timeOrigin);
            const documentNavigations = observeDocumentNavigations(page);
            const rejected = page.waitForResponse(response => response.request().method() === 'DELETE'
                && new URL(response.url()).pathname === '/api/v1/account');
            await page.getByRole('button', {name: 'Permanently delete account', exact: true}).click();
            expect((await rejected).status()).toBe(400);
            expect(await page.evaluate(() => performance.timeOrigin)).toBe(originalDocument);
            expect(documentNavigations).toEqual([]);
            await waitForPilotHydration(page);
            await expect(page.locator('#username')).toHaveValue('Incorrect confirmation');
            const unchanged = await readProfileWorkflowFixtureForE2E(fixture);
            expect(kind === 'account' ? unchanged.accountCount : unchanged.guestCount).toBe(1);

            // The existing empty/absent-contact branch reaches ordinary logout
            // without SMTP. This does not claim provider or delivery finality.
            await page.locator('#username').fill(kind === 'account' ? fixture.account.username : fixture.guest.username);
            const completed = page.waitForResponse(response => response.request().method() === 'DELETE'
                && new URL(response.url()).pathname === '/api/v1/account');
            await page.getByRole('button', {name: 'Permanently delete account', exact: true}).click();
            expect((await completed).status()).toBe(200);
            await expect(page).toHaveURL(/\/frontend-pilot(?:\?|$)/u);
            await expectTranslatedCompletion(page, 'Account successfully deleted', 'Konto erfolgreich gelöscht', '/api/v1/account');
            expect(await page.evaluate(() => performance.timeOrigin)).toBe(originalDocument);
            expect(documentNavigations).toEqual([]);
            const session = await (await page.request.get('/api/v1/session')).json();
            expect(session.kind).toBe('anonymous');
            const saved = await readProfileWorkflowFixtureForE2E(fixture);
            expect(kind === 'account' ? saved.accountCount : saved.guestCount).toBe(0);
        }, kind === 'account' ? 'absent' : 'ordinary');
    });
}

test('enters profile workflows through Router and issues a token once without history replay', async function usesWarmWorkflowCommands({page}) {
    await withProfileWorkflowFixtureForE2E(async function exerciseWarmToken(fixture) {
        await loginForE2E(page.request, fixture.account);
        await page.goto('/frontend-pilot/users/profile?locale=en');
        await waitForPilotHydration(page);
        const originalDocument = await page.evaluate(() => performance.timeOrigin);
        const documentNavigations = observeDocumentNavigations(page);
        const issued: string[] = [];
        page.on('request', function observeIssuance(request) {
            if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/profiles/migration/token') issued.push(request.url());
        });

        // The existing Show action carries public intent, never its bearer. Its
        // mounted command is distinct from read admission and browser history.
        await page.getByRole('link', {name: 'Show profile migration token', exact: true}).click();
        await expect(page.locator('main h3')).not.toHaveText('');
        expect(issued).toHaveLength(1);
        expect(await page.evaluate(() => performance.timeOrigin)).toBe(originalDocument);
        expect(documentNavigations).toEqual([]);
        await page.goBack();
        await expect(page.locator('#name')).toBeVisible();
        await page.goForward();
        await expect(page.getByRole('button', {name: 'Show profile migration token', exact: true})).toBeVisible();
        expect(issued).toHaveLength(1);
        expect(await page.evaluate(() => performance.timeOrigin)).toBe(originalDocument);

        // Warm destructive entry must display its admitted form without asking
        // for another document request before the controls can become usable.
        await page.goBack();
        await page.getByRole('link', {name: 'Delete profile', exact: true}).click();
        await expect(page.locator('#name')).toBeVisible();
        await expect(page.getByRole('button', {name: 'Permanently deactivate profile', exact: true})).toBeEnabled();
        expect(await page.evaluate(() => performance.timeOrigin)).toBe(originalDocument);
        expect(documentNavigations).toEqual([]);
    }, 'absent');
});

const presentations = [
    {name: 'token', path: '/users/profile/migrate/request'},
    {name: 'entry', path: '/users/profile/migrate/show'},
    {name: 'preview', path: '/users/profile/migrate/show'},
    {name: 'deactivate', path: '/users/profile/delete'},
    {name: 'delete-account', path: '/users/account/delete'},
] as const;

for (const viewport of [{width: 1280, height: 900}, {width: 390, height: 844}]) {
    for (const presentation of presentations) {
        test(`${presentation.name} document retains native presentation at ${viewport.width}px`, async function compareNativePresentation({page, browser, baseURL}, testInfo) {
            await withProfileWorkflowFixtureForE2E(async function compareDocuments(fixture) {
                await page.setViewportSize(viewport);
                const browserErrors: string[] = [];
                page.on('pageerror', error => browserErrors.push(error.message));
                await loginForE2E(page.request, fixture.account);
                // Consume setup's native login flash before taking either comparator.
                await page.request.get('/users/profile');
                let token: string | undefined;
                if (presentation.name === 'preview') {
                    token = await migrationTokenForWorkflow(browser, baseURL, fixture.guest.loginPath);
                }

                // Both renderers use identical actors, the existing preview check,
                // viewport and built assets. Native document POST and pilot JSON
                // preview are exercised through their actual browser controls.
                if (token) await previewOnPage(page, false, token);
                else await page.goto(presentation.path);
                await page.evaluate(waitForWorkflowFonts);
                await page.mouse.move(0, 0);
                // Bootstrap animates a reused button's variant. Capture both
                // renderers after finite transitions finish, rather than comparing
                // an arbitrary intermediate color with native's fresh document.
                await page.screenshot({path: testInfo.outputPath('native-workflow.png'), fullPage: true, animations: 'disabled'});
                const native = await page.evaluate(workflowPresentation);
                const nativeCard = await readVisiblePresentation(page.locator('main > .card'),
                    ['h1', 'h2', 'h3', 'h4', 'p', 'label', 'input', 'button', 'a', 'hr'], presentation.name === 'token');
                const nativeFooter = await readVisiblePresentation(page.locator('footer'), ['a']);
                const nativeFooterLinks = await page.locator('footer a').evaluateAll(links => links.map(link => link.getAttribute('href')));
                const nativeHeading = await page.locator('main h1').innerText();
                if (token) await previewOnPage(page, true, token);
                else {
                    await page.goto('/frontend-pilot' + presentation.path + '?locale=en');
                    await waitForPilotHydration(page);
                }
                await page.evaluate(waitForWorkflowFonts);
                await page.mouse.move(0, 0);
                await page.screenshot({path: testInfo.outputPath('pilot-workflow.png'), fullPage: true, animations: 'disabled'});
                const pilot = await page.evaluate(workflowPresentation);
                const pilotCard = await readVisiblePresentation(page.locator('main > .card'),
                    ['h1', 'h2', 'h3', 'h4', 'p', 'label', 'input', 'button', 'a', 'hr'], presentation.name === 'token');
                const pilotFooter = await readVisiblePresentation(page.locator('footer'), ['a']);
                expectVisiblePresentation(nativeCard, pilotCard);
                expectVisiblePresentation(nativeFooter, pilotFooter);
                expect(await page.locator('footer a').evaluateAll(links => links.map(link => link.getAttribute('href')))).toEqual(nativeFooterLinks);
                expect(await page.locator('main h1').innerText()).toBe(nativeHeading);
                expect(browserErrors).toEqual([]);
                expect(pilot.scrollWidth).toBeLessThanOrEqual(Math.max(viewport.width, native.scrollWidth));
                expect(pilot.scrollY).toBe(native.scrollY);
                expect(pilot.submitColors).toEqual(native.submitColors);
                await expect(page.locator('footer')).toBeVisible();
                expect(pilot.footer).toEqual(native.footer);
                for (const control of ['heading', 'field', 'submit', 'token'] as const) {
                    expect(!!pilot[control], control).toBe(!!native[control]);
                    if (pilot[control] && native[control]) {
                        for (const dimension of ['x', 'y', 'width', 'height'] as const) {
                            expect(Math.abs(pilot[control]![dimension] - native[control]![dimension]),
                                control + ' ' + dimension).toBeLessThanOrEqual(1);
                        }
                    }
                }
                const evidence = testInfo.outputPath('presentation.json');
                await writeFile(evidence, JSON.stringify({scenario: presentation.name, viewport, native, pilot,
                    nativeCard, pilotCard, nativeFooter, pilotFooter, browserErrors}, null, 2));
                await testInfo.attach('native-pilot-presentation', {path: evidence, contentType: 'application/json'});
            });
        });
    }
}
