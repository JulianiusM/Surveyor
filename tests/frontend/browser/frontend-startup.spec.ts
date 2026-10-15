import {expect, test, type Dialog, type Page, type Route} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {compile, Logger} from 'sass';
import type {Response} from 'express';
import {createBrowserReadGate as readGate, waitForPilotHydration} from '../../keywords/frontendDynamicKeywords';
import type {components} from '../../../src/types/api/v1';
import type {FrontendPilotBootstrap, FrontendPreparedDocument} from '../../../src/types/FrontendPilotTypes';

type Session = components['schemas']['SessionView'];
const deliveries = new WeakMap<Page, {documents: number; commands: number; nativeStyles: number}>();
let referenceStyles: string | undefined;

test.afterEach(async ({page}) => {
    expect(deliveries.get(page)?.commands ?? 0, 'Isolated startup must not dispatch commands').toBe(0);
    expect(deliveries.get(page)?.nativeStyles ?? 0, 'Pilot documents must not depend on native stylesheets').toBe(0);
    deliveries.delete(page);
});

/** Startup-only fixtures carry valid public wire data without creating an account,
 * resource or database connection. They prove browser delivery/recovery, never
 * controller admission or persistence. The real built SSR/entry owns rendering. */
function startupSession(locale: Session['locale'] = 'en'): Session {
    return {kind: 'anonymous', context: 'startup-browser-context-1234567890', csrfToken: 'startup-browser-csrf-1234567890',
        locale, activeProfile: null, profiles: [], loginUrl: '/users/login', logoutUrl: null,
        deployment: {buildId: 'startup-browser-fixture', apiCompatibility: 'v1-pilot-2026-10-07'},
        shell: {version: 'startup-fixture', imprintUrl: '/imprint', privacyPolicyUrl: '/privacy',
            localLoginEnabled: true, oidcEnabled: false, oidcName: 'Fixture provider'}};
}

/** Deliver real built SSR and fingerprinted client assets through one intercepted
 * origin. This selected browser boundary needs no Express server or schema reset.
 * API fixtures retain production decoding while refusing every command. */
async function startupDocument(page: Page, path: string, bootstrap: FrontendPilotBootstrap) {
    const renderer = await import(pathToFileURL(resolve('dist/modules/frontendPilotRenderer.js')).href) as {
        prepareFrontendPilot(response: Response, url: string, bootstrap: FrontendPilotBootstrap): Promise<FrontendPreparedDocument>;
    };
    // Only the response/header boundary is substituted. The real renderer owns
    // the complete shell, independent notice/monitor, SSR tree and bootstrap.
    const response: Response = Object.create(null);
    response.set = setFixtureHeader;
    const prepared = await renderer.prepareFrontendPilot(response, path, bootstrap);
    // Local installed Bootstrap makes layout independent of CDN availability.
    // Its version differs from the release CDN, so omit only fixture SRI metadata;
    // production HTML, module loading and application behavior remain intact.
    const html = prepared.html.replace(/\s+integrity="[^"]*"/gu, '');
    const url = new URL(path, 'http://surveyor-startup.test').href;
    const observed = {documents: 0, commands: 0, nativeStyles: 0};
    deliveries.set(page, observed);
    await page.route('**/*', deliverStartupRequest);
    return {url, observed};

    function setFixtureHeader(_field: unknown, _value?: string | string[]): Response { return response; }

    /** Replace only HTTP delivery; all decoding, router, DOM and draft behavior
     * continues through production modules. Unknown paths never reach a server. */
    async function deliverStartupRequest(route: Route): Promise<void> {
        const request = route.request();
        const requestedUrl = new URL(request.url());
        const pathname = requestedUrl.pathname;
        // Neither an enhanced API command nor an unhydrated native form POST
        // may leave this isolated boundary. Unknown origins have no server owner.
        if (request.method() !== 'GET') {
            observed.commands++;
            await route.abort('failed');
            return;
        }
        if (requestedUrl.hostname === 'cdn.jsdelivr.net' && pathname.endsWith('/bootstrap.min.css')) {
            await route.fulfill({status: 200, contentType: 'text/css',
                body: readFileSync('node_modules/bootstrap/dist/css/bootstrap.min.css')});
            return;
        }
        if (requestedUrl.origin !== 'http://surveyor-startup.test') {
            await route.abort('failed');
            return;
        }
        if (request.isNavigationRequest() && pathname.startsWith('/frontend-pilot')) {
            observed.documents++;
            // Native href/GET recovery may visit another Help query. Deliver its
            // real shell too; this remains synthetic public data, not a server route
            // admission or search-result/persistence assertion.
            const document = request.url() === url ? html
                : (await renderer.prepareFrontendPilot(response, pathname + requestedUrl.search, bootstrap)).html
                    .replace(/\s+integrity="[^"]*"/gu, '');
            await route.fulfill({status: 200, contentType: 'text/html', body: document});
            return;
        }
        if (pathname.startsWith('/app/assets/')) {
            // Restrict reads to a single build-authored asset basename; a URL
            // cannot select another workspace path or substitute executable code.
            const filename = pathname.slice('/app/assets/'.length);
            if (!/^[A-Za-z0-9_.-]+$/u.test(filename)) throw new Error('Unexpected startup asset path.');
            await route.fulfill({status: 200, contentType: filename.endsWith('.css') ? 'text/css' : 'text/javascript',
                body: readFileSync(resolve('dist/public/app/assets', filename))});
            return;
        }
        if (pathname === '/style/style.css' || pathname === '/style/help.css') {
            observed.nativeStyles++;
            await route.abort('blockedbyclient');
            return;
        }
        if (pathname === '/img/logo.png') {
            await route.fulfill({status: 200, contentType: 'image/png', body: readFileSync('src/public/img/logo.png')});
            return;
        }
        let data: unknown;
        if (pathname === '/api/v1/session') data = bootstrap.session;
        else if (pathname === '/api/v1/help') data = bootstrap.help;
        else if (/^\/api\/v1\/packing-lists\/[a-f0-9-]+\/entry$/u.test(pathname)
            && bootstrap.packingError === 'packing.notFound')
            data = {entry: {kind: 'denied', status: 404, messageKey: bootstrap.packingError}, guest: null};
        else if (pathname === '/api/v1/packing-lists/create-entry' && bootstrap.packingCreateContext)
            data = {entry: {kind: 'render'}, context: bootstrap.packingCreateContext, selectedEvent: null};
        if (data !== undefined) {
            await route.fulfill({status: 200, contentType: 'application/json', headers: {
                'X-Surveyor-Context': bootstrap.session.context}, body: JSON.stringify(data)});
            return;
        }
        await route.fulfill({status: 404, contentType: 'text/plain', body: 'No startup fixture for this request.'});
    }
}

/** Compile the unchanged native authored styles in memory for a temporary visual
 * comparator. Production delivery uses only Vite assets; no native file is changed
 * or served by this reference, and generated CSS is never an authored fixture. */
function nativeStyleReference(): string {
    if (referenceStyles !== undefined) return referenceStyles;
    const base = compile(resolve('src/public/style/style.sass'), {logger: Logger.silent}).css;
    const help = compile(resolve('src/public/style/help.sass'), {logger: Logger.silent}).css;
    referenceStyles = base + '\n' + help + '\n' + readFileSync('src/frontend/styles/pilot.css', 'utf8');
    return referenceStyles;
}

/** Hold the first real module request so static Help can be edited before failure.
 * Later failed visits stay failed until the test deliberately restores delivery. */
async function failStartupModule(page: Page, pattern: RegExp) {
    const started = readGate();
    const delivery = readGate();
    let attempts = 0;
    let restored = false;
    await page.route(pattern, deliverModule);
    return {started: started.promise, fail: delivery.release, restore};

    async function deliverModule(route: Route): Promise<void> {
        attempts++;
        if (attempts === 1) {
            started.release();
            await delivery.promise;
        }
        if (restored) await route.fallback();
        else await route.abort('failed');
    }

    function restore(): void {
        restored = true;
        delivery.release();
    }
}

/** Let already queued browser/router work settle before asserting that a failed
 * document did not schedule another automatic replacement. No polling timer or
 * artificial product delay is introduced by these two rendering turns. */
async function settleStartup(page: Page): Promise<void> {
    await page.evaluate(async function settleBrowserStartup(): Promise<void> {
        await new Promise<number>(resolve => requestAnimationFrame(resolve));
        await new Promise<number>(resolve => requestAnimationFrame(resolve));
    });
}

test('initial startup retains editable static Help search and recovers only after one accepted discard confirmation', async ({page}) => {
    const help: components['schemas']['HelpPageData'] = {locale: 'en', title: 'Synthetic Help',
        content: '<h2 id="task">Synthetic task</h2>', currentDoc: 'fixture.md', docsList: [], docsGroups: [], toc: []};
    const delivery = await startupDocument(page, '/frontend-pilot/help', {session: startupSession(), help});
    const module = await failStartupModule(page, /\/app\/assets\/HelpPage-[^/]+\.js(?:\?|$)/u);
    const dialogs: string[] = [];
    let accept = false;
    page.on('dialog', answerRecovery);

    async function answerRecovery(dialog: Dialog): Promise<void> {
        dialogs.push(dialog.type());
        if (accept) await dialog.accept();
        else await dialog.dismiss();
    }

    try {
        await page.goto(delivery.url, {waitUntil: 'commit'});
        await module.started;
        const search = page.getByRole('searchbox');
        const original = await search.elementHandle();
        await search.fill('Retained startup search');
        module.fail();
        const recovery = page.locator('#surveyor-pilot-startup-recovery');
        await expect(recovery).toBeVisible();
        await settleStartup(page);
        expect(delivery.observed.documents).toBe(1);
        expect(delivery.observed.commands).toBe(0);
        await expect(search).toHaveValue('Retained startup search');
        expect(await original!.evaluate(node => node === document.getElementById('pilot-help-search'))).toBe(true);
        await expect(page.locator('#surveyor-pilot')).not.toHaveAttribute('data-pilot-hydrated', 'true');

        await recovery.getByRole('button', {name: 'Refresh page', exact: true}).click();
        expect(dialogs).toEqual(['confirm']);
        await expect(search).toHaveValue('Retained startup search');
        expect(await original!.evaluate(node => node === document.getElementById('pilot-help-search'))).toBe(true);
        expect(delivery.observed.documents).toBe(1);

        // Restoring a chunk does not retry a form. Only a separate accepted
        // recovery replaces this document, and beforeunload must not ask twice.
        module.restore();
        accept = true;
        await recovery.getByRole('button', {name: 'Refresh page', exact: true}).click();
        await waitForPilotHydration(page);
        expect(dialogs).toEqual(['confirm', 'confirm']);
        expect(delivery.observed.documents).toBe(2);
        expect(delivery.observed.commands).toBe(0);
        await expect(search).toHaveValue('');
        await expect(recovery).toHaveCount(0);
        await original!.dispose();
    } finally { module.restore(); page.off('dialog', answerRecovery); }
});

test('initial startup reloads a pristine dynamic route once and permits deliberate recovery from its stored marker', async ({page}) => {
    const delivery = await startupDocument(page, '/frontend-pilot', {session: startupSession()});
    const module = await failStartupModule(page, /\/app\/assets\/OverviewPage-[^/]+\.js(?:\?|$)/u);
    try {
        await page.goto(delivery.url, {waitUntil: 'commit'});
        await module.started;
        await expect(page.locator('[data-pilot-initial-loading]')).toBeVisible();
        await expect(page.locator('main form, main input')).toHaveCount(0);
        module.fail();
        const recovery = page.locator('#surveyor-pilot-startup-recovery');
        await expect.poll(() => delivery.observed.documents).toBe(2);
        await expect(recovery).toBeVisible();
        await settleStartup(page);
        expect(delivery.observed.documents).toBe(2);
        expect(delivery.observed.commands).toBe(0);
        await expect(page.locator('#surveyor-pilot')).not.toHaveAttribute('data-pilot-hydrated', 'true');

        // The second failed document has the automatic attempt marker. A user
        // action can still recover it after delivery returns, without any prompt.
        const dialogs: string[] = [];
        page.on('dialog', recordUnexpectedDialog);
        async function recordUnexpectedDialog(dialog: Dialog): Promise<void> {
            dialogs.push(dialog.type());
            await dialog.dismiss();
        }
        module.restore();
        await recovery.getByRole('button', {name: 'Refresh page', exact: true}).click();
        await waitForPilotHydration(page);
        expect(dialogs).toEqual([]);
        expect(delivery.observed.documents).toBe(3);
        expect(delivery.observed.commands).toBe(0);
        page.off('dialog', recordUnexpectedDialog);
    } finally { module.restore(); }
});

test('initial startup never automatically reopens token issuance and permits deliberate recovery', async ({page}) => {
    const delivery = await startupDocument(page, '/frontend-pilot/users/profile/migrate/request', {
        session: startupSession(), profileWorkflow: {kind: 'token', token: 'synthetic-private-transfer-token'},
    });
    const module = await failStartupModule(page, /\/app\/assets\/ProfileWorkflowPage-[^/]+\.js(?:\?|$)/u);
    try {
        await page.goto(delivery.url, {waitUntil: 'commit'});
        await module.started;
        module.fail();
        const recovery = page.locator('#surveyor-pilot-startup-recovery');
        await expect(recovery).toBeVisible();
        await settleStartup(page);
        expect(delivery.observed.documents).toBe(1);
        expect(delivery.observed.commands).toBe(0);
        await expect(page.locator('#surveyor-pilot')).not.toHaveAttribute('data-pilot-hydrated', 'true');

        // This real URL issues a replacement token on document GET. The fixture
        // counts navigation only; it does not claim backend token persistence.
        // Deliberate recovery still follows that native document boundary once.
        module.restore();
        await recovery.getByRole('button', {name: 'Refresh page', exact: true}).click();
        await waitForPilotHydration(page);
        expect(delivery.observed.documents).toBe(2);
        expect(delivery.observed.commands).toBe(0);
    } finally { module.restore(); }
});

test('a hydrated Packing denial retains its static document through a detected release', async ({page}) => {
    const session = startupSession();
    const delivery = await startupDocument(page,
        '/frontend-pilot/packing/22222222-2222-4222-8222-222222222222', {session, packingError: 'packing.notFound'});
    await page.goto(delivery.url);
    await waitForPilotHydration(page);
    const denial = page.locator('main').getByText('packing not found', {exact: true});
    await expect(denial).toBeVisible();
    await expect(page.locator('[data-pilot-initial-loading]')).toHaveCount(0);

    // Change only the ordinary session read's deployment projection. The actual
    // browser context observes that release after a mounted denial has retired
    // bootstrap; this exercises the lifecycle an unmounted route test cannot.
    await page.route('**/api/v1/session', async function deliverReplacementSession(route): Promise<void> {
        await route.fulfill({status: 200, contentType: 'application/json', headers: {
            'X-Surveyor-Context': session.context}, body: JSON.stringify({...session,
                deployment: {...session.deployment, buildId: 'mounted-denial-replacement'}})});
    });
    await page.evaluate(function resumeSession(): void { window.dispatchEvent(new Event('focus')); });
    const recovery = page.locator('#surveyor-pilot').getByRole('button', {name: 'Refresh page', exact: true});
    await expect(recovery).toBeVisible();
    await settleStartup(page);
    expect(delivery.observed.documents).toBe(1);
    await expect(denial).toBeVisible();

    // Static classification leaves deliberate document recovery available.
    // This remains isolated client evidence and makes no persistence claim.
    await recovery.click();
    await waitForPilotHydration(page);
    await expect(denial).toBeVisible();
    expect(delivery.observed.documents).toBe(2);
});

test('initial startup offers deliberate recovery without looping when attempt storage is inaccessible', async ({page}) => {
    await page.addInitScript(function denyStartupStorage(): void {
        Object.defineProperty(window, 'sessionStorage', {configurable: true,
            get: function unavailableAttemptStorage(): never { throw new Error('Fixture storage access denied'); }});
    });
    const delivery = await startupDocument(page, '/frontend-pilot/users/login', {session: startupSession()});
    const module = await failStartupModule(page, /\/app\/assets\/IdentityPage-[^/]+\.js(?:\?|$)/u);
    try {
        await page.goto(delivery.url, {waitUntil: 'commit'});
        await module.started;
        module.fail();
        const recovery = page.locator('#surveyor-pilot-startup-recovery');
        await expect(recovery).toBeVisible();
        await settleStartup(page);
        expect(delivery.observed.documents).toBe(1);
        expect(delivery.observed.commands).toBe(0);
        module.restore();
        await recovery.getByRole('button', {name: 'Refresh page', exact: true}).click();
        await waitForPilotHydration(page);
        expect(delivery.observed.documents).toBe(2);
        expect(delivery.observed.commands).toBe(0);
    } finally { module.restore(); }
});

test('initial startup exposes localized recovery before context creation when the Help validator fails', async ({page}) => {
    const session = startupSession('de');
    const help: components['schemas']['HelpPageData'] = {locale: 'de', title: 'Synthetische Hilfe',
        content: '<h2 id="task">Synthetische Aufgabe</h2>', currentDoc: 'fixture.md', docsList: [], docsGroups: [], toc: []};
    const delivery = await startupDocument(page, '/frontend-pilot/help', {session, help});
    const module = await failStartupModule(page, /\/app\/assets\/validateHelpPageData-[^/]+\.js(?:\?|$)/u);
    const dialogs: string[] = [];
    page.on('dialog', acceptValidatorRecovery);
    async function acceptValidatorRecovery(dialog: Dialog): Promise<void> {
        dialogs.push(dialog.type());
        await dialog.accept();
    }
    try {
        await page.goto(delivery.url, {waitUntil: 'commit'});
        await module.started;
        const search = page.getByRole('searchbox');
        await search.fill('Behaltene Suchanfrage');
        module.fail();
        const recovery = page.locator('#surveyor-pilot-startup-recovery');
        await expect(recovery).toContainText('Diese Seite konnte nicht vollständig geladen werden.');
        await expect(page.locator('html')).toHaveAttribute('lang', 'de');
        await expect(search).toHaveValue('Behaltene Suchanfrage');
        expect(delivery.observed.documents).toBe(1);
        expect(delivery.observed.commands).toBe(0);
        module.restore();
        await recovery.getByRole('button').click();
        await waitForPilotHydration(page);
        expect(dialogs).toEqual(['confirm']);
        expect(delivery.observed.documents).toBe(2);
        expect(delivery.observed.commands).toBe(0);
        await expect(search).toHaveValue('');
    } finally { module.restore(); page.off('dialog', acceptValidatorRecovery); }
});

test('initial startup never exposes inactive creation controls when its bootstrap validator fails', async ({page}) => {
    const packingCreateContext: components['schemas']['PackingCreateContext'] = {
        defaults: {participant: 0, guest: 0, authenticated: 0, public: 0}, permissions: [], presets: []};
    const delivery = await startupDocument(page, '/frontend-pilot/packing/create', {
        session: startupSession(), pageEntry: {kind: 'render'}, packingCreateContext});
    const module = await failStartupModule(page, /\/app\/assets\/validatePackingCreateContext-[^/]+\.js(?:\?|$)/u);
    try {
        await page.goto(delivery.url, {waitUntil: 'commit'});
        await module.started;
        await expect(page.locator('[data-pilot-initial-loading]')).toBeVisible();
        await expect(page.locator('main form, main input')).toHaveCount(0);
        module.fail();
        const recovery = page.locator('#surveyor-pilot-startup-recovery');
        await expect(recovery).toBeVisible();
        await expect(page.locator('#surveyor-pilot-javascript-required')).toContainText('Interactive features on this site require JavaScript.');
        await expect(page.locator('[data-pilot-initial-loading]')).toBeHidden();
        await settleStartup(page);
        expect(delivery.observed.documents).toBe(1);
        expect(delivery.observed.commands).toBe(0);
        await expect(page.locator('main form, main input')).toHaveCount(0);
        await expect(page.locator('#surveyor-pilot')).not.toHaveAttribute('data-pilot-hydrated', 'true');
    } finally { module.restore(); }
});

test('initial startup shows an independent notice when the module entry cannot load and offers safe Help navigation', async ({page}) => {
    const delivery = await startupDocument(page, '/frontend-pilot/users/login', {session: startupSession()});
    const module = await failStartupModule(page, /\/app\/assets\/entry-client-[^/]+\.js(?:\?|$)/u);
    try {
        await page.goto(delivery.url, {waitUntil: 'commit'});
        await module.started;
        await expect(page.locator('[data-pilot-initial-loading]')).toBeVisible();
        module.fail();
        const notice = page.locator('#surveyor-pilot-javascript-required');
        await expect(notice).toBeVisible();
        await expect(notice).toContainText('Interactive features on this site require JavaScript.');
        await expect(notice.getByRole('link', {name: 'Help', exact: true})).toHaveAttribute('href', '/frontend-pilot/help?locale=en');
        await expect(notice.getByRole('button')).toHaveCount(0);
        await expect(page.locator('[data-pilot-initial-loading]')).toBeHidden();
        await expect(page.locator('main form, main input')).toHaveCount(0);
        await expect(page.locator('#pilot-locale')).toBeDisabled();
        await expect(page.locator('#pilot-navbar-main')).toBeVisible();
        await settleStartup(page);
        expect(delivery.observed.documents).toBe(1);
    } finally { module.restore(); }
});

test('initial startup ends loading with a notice when entry initialization never starts', async ({page}) => {
    await page.clock.install();
    const delivery = await startupDocument(page, '/frontend-pilot/users/login', {session: startupSession()});
    const module = await failStartupModule(page, /\/app\/assets\/entry-client-[^/]+\.js(?:\?|$)/u);
    try {
        await page.goto(delivery.url, {waitUntil: 'commit'});
        await module.started;
        await expect(page.locator('[data-pilot-initial-loading]')).toBeVisible();
        await page.clock.runFor(15_001);
        await expect(page.locator('#surveyor-pilot-javascript-required')).toBeVisible();
        await expect(page.locator('[data-pilot-initial-loading]')).toBeHidden();
        expect(delivery.observed.documents).toBe(1);
        expect(delivery.observed.commands).toBe(0);
    } finally { module.restore(); }
});

test('initial startup preserves real Help navigation and guarded GET search after partially mounted initialization fails', async ({page}) => {
    // The actual context.start reaches this browser API after Vue attached the
    // Help handlers. No production module/error/readiness state is substituted.
    await page.addInitScript(function failIdentityChannelConstruction(): void {
        Object.defineProperty(window, 'BroadcastChannel', {configurable: true,
            value: function unavailableIdentityChannel(): never { throw new Error('Controlled channel initialization failure'); }});
    });
    const help: components['schemas']['HelpPageData'] = {locale: 'en', title: 'Synthetic Help',
        content: '<h2 id="task">Readable task</h2><a href="/frontend-pilot/help?doc=second&amp;locale=en">Next Help topic</a>',
        currentDoc: 'fixture.md', docsList: [], docsGroups: [], toc: []};
    const delivery = await startupDocument(page, '/frontend-pilot/help', {session: startupSession(), help});
    await page.goto(delivery.url, {waitUntil: 'domcontentloaded'});
    await expect(page.locator('#surveyor-pilot-startup-recovery')).toBeVisible();
    await expect(page.locator('#surveyor-pilot')).not.toHaveAttribute('data-pilot-hydrated', 'true');
    await expect(page.locator('#pilot-locale')).toBeDisabled();
    await expect(page.locator('.help-content')).toContainText('Readable task');
    await page.getByRole('link', {name: 'Next Help topic', exact: true}).click();
    await expect(page).toHaveURL(/\/frontend-pilot\/help\?doc=second&locale=en$/u);
    await expect(page.locator('#surveyor-pilot-startup-recovery')).toBeVisible();
    expect(delivery.observed.documents).toBe(2);

    const dialogs: string[] = [];
    page.on('dialog', acceptNativeSearchDeparture);
    async function acceptNativeSearchDeparture(dialog: Dialog): Promise<void> {
        dialogs.push(dialog.type());
        await dialog.accept();
    }
    await page.getByRole('searchbox').fill('A retained native search');
    await page.getByRole('search').getByRole('button').click();
    await expect(page).toHaveURL(/\/frontend-pilot\/help\?locale=en&q=A\+retained\+native\+search$/u);
    await expect(page.locator('#surveyor-pilot-startup-recovery')).toBeVisible();
    expect(delivery.observed.documents).toBe(3);
    expect(dialogs).toEqual(['beforeunload']);
    expect(delivery.observed.commands).toBe(0);
    page.off('dialog', acceptNativeSearchDeparture);
});

test.describe('JavaScript unavailable', () => {
    test.use({javaScriptEnabled: false});

    for (const width of [390, 1280]) {
        test(`copied frontend styles preserve the native cascade before JavaScript at ${width}px`, async ({page}, testInfo) => {
            const help: components['schemas']['HelpPageData'] = {locale: 'en', title: 'Stylesheet comparison',
                content: '<h2 id="task">Styled before initialization</h2><p>A readable article with ordinary links and a table.</p>'
                    + '<table><thead><tr><th>Setting</th><th>Description</th></tr></thead><tbody><tr>'
                    + '<td><code>AN_EXTENDED_CONFIGURATION_VALUE</code></td><td>Preserved dark-theme article geometry.</td>'
                    + '</tr></tbody></table><h3>Following section</h3><p>Content after the table remains readable.</p>',
                currentDoc: 'fixture.md', docsList: [], docsGroups: [], toc: [{id: 'task', title: 'Styled before initialization', level: 2}]};
            const delivery = await startupDocument(page, '/frontend-pilot/help', {session: startupSession(), help});
            await page.setViewportSize({width, height: 900});
            await page.goto(delivery.url, {waitUntil: 'networkidle'});
            await expect(page.locator('.help-content h2')).toBeVisible();
            await expect(page.locator('#surveyor-pilot')).not.toHaveAttribute('data-pilot-hydrated', 'true');
            const applicationStyles = page.locator('link[rel="stylesheet"][href^="/app/"]');
            expect(await applicationStyles.count()).toBeGreaterThan(0);
            const copied = await page.screenshot({path: testInfo.outputPath('copied-styles.png'),
                fullPage: true, animations: 'disabled', caret: 'hide'});

            // Keep the same real SSR, viewport and vendor fixture. Replace only
            // its Vite CSS with the untouched native Sass compilation and the
            // existing pilot overrides, making cascade drift visible pixel by pixel.
            await applicationStyles.evaluateAll(function disableApplicationStyles(links) {
                for (const link of links) (link as HTMLLinkElement).disabled = true;
            });
            // Driver evaluation can update a JS-disabled document synchronously.
            // Avoid a helper that waits for a page-side stylesheet load callback.
            await page.evaluate(function applyReferenceStyles(content) {
                const style = document.createElement('style');
                style.textContent = content;
                document.head.append(style);
            }, nativeStyleReference());
            const reference = await page.screenshot({path: testInfo.outputPath('native-style-reference.png'),
                fullPage: true, animations: 'disabled', caret: 'hide'});
            expect(copied.equals(reference), 'Copied CSS must preserve the unchanged reference presentation').toBe(true);
            expect(delivery.observed.nativeStyles).toBe(0);
        });
    }

    test('initial startup keeps static Help search/navigation and disabled client controls without any executed script', async ({page}) => {
        const help: components['schemas']['HelpPageData'] = {locale: 'en', title: 'Synthetic Help',
            content: '<h2 id="task">Readable without JavaScript</h2>', currentDoc: 'fixture.md', docsList: [], docsGroups: [], toc: []};
        const delivery = await startupDocument(page, '/frontend-pilot/help', {session: startupSession(), help});
        await page.setViewportSize({width: 390, height: 844});
        await page.goto(delivery.url, {waitUntil: 'domcontentloaded'});
        await expect(page.locator('#surveyor-pilot-javascript-required')).toBeVisible();
        await expect(page.locator('.help-content')).toContainText('Readable without JavaScript');
        await expect(page.getByRole('search')).toHaveAttribute('method', 'get');
        await expect(page.getByRole('search')).toHaveAttribute('action', '/frontend-pilot/help');
        await expect(page.getByRole('searchbox')).toBeEditable();
        await expect(page.getByRole('search').getByRole('button')).toBeEnabled();
        await expect(page.locator('#pilot-navbar-main')).toBeVisible();
        await expect(page.locator('.navbar-toggler')).toHaveCount(0);
        await expect(page.locator('#pilot-locale')).toBeDisabled();
        await page.locator('details').filter({hasText: 'New'}).locator('summary').click();
        await expect(page.getByRole('link', {name: 'Survey', exact: true})).toBeVisible();
        await expect(page.locator('#surveyor-pilot')).not.toHaveAttribute('data-pilot-hydrated', 'true');
        expect(delivery.observed.commands).toBe(0);
    });
});

test('client startup preserves an explicitly supplied recovery completion and retires it after committed departure', async ({page}) => {
    const session = startupSession();
    const url = '/frontend-pilot/guest/recovery';
    const delivery = await startupDocument(page, url, {session, pageCompletion: {context: session.context,
        destination: url, messageKey: 'auth.recoverySent', kind: 'success'}});
    await page.goto(delivery.url, {waitUntil: 'domcontentloaded'});
    await waitForPilotHydration(page);
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

test('client startup preserves the native expired-session notice', async ({page}) => {
    const session = startupSession();
    const delivery = await startupDocument(page, '/frontend-pilot/users/login', {session,
        pageNotice: {kind: 'error', messageKey: 'auth.sessionExpired'}});
    await page.goto(delivery.url, {waitUntil: 'domcontentloaded'});
    await waitForPilotHydration(page);
    await expect(page.locator('main .alert-danger')).toContainText('Session has expired');
    await expect(page.getByRole('heading', {name: 'Login', exact: true})).toBeVisible();
});

