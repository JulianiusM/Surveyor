import {expect, test, type Dialog, type Page, type Route} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createBrowserReadGate as readGate, waitForPilotHydration} from '../../keywords/frontendDynamicKeywords';
import type {components} from '../../../src/types/api/v1';
import type {FrontendPilotBootstrap, FrontendPilotRenderResult} from '../../../src/types/FrontendPilotTypes';

type Session = components['schemas']['SessionView'];
const deliveries = new WeakMap<Page, {documents: number; commands: number}>();

test.afterEach(async ({page}) => {
    expect(deliveries.get(page)?.commands ?? 0, 'Isolated startup must not dispatch commands').toBe(0);
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
    const renderer = await import(pathToFileURL(resolve('dist/frontend-server/entry-server.mjs')).href) as {
        render(url: string, bootstrap: FrontendPilotBootstrap): Promise<FrontendPilotRenderResult>;
    };
    const rendered = await renderer.render(path, bootstrap);
    const manifest = JSON.parse(readFileSync('dist/public/app/.vite/manifest.json', 'utf8')) as
        Record<string, {file: string; css?: string[]}>;
    const entry = manifest['src/frontend/app/entry-client.ts'];
    if (!entry) throw new Error('The built startup entry is missing.');

    // The document shell is synthetic; its entire Vue tree/bootstrap and every
    // module are real build outputs. Local Bootstrap supplies actual visibility
    // semantics without an external CDN or a visual-parity assertion.
    const styles = (entry.css ?? []).map(css => `<link rel="stylesheet" href="/app/${css}">`).join('');
    const html = `<!doctype html><html lang="${bootstrap.session.locale}" data-bs-theme="dark"><head>
<meta charset="utf-8"><link rel="stylesheet" href="/fixture-bootstrap.css">${styles}</head><body>
<div id="surveyor-pilot">${rendered.html}</div>
<script id="surveyor-pilot-state" type="application/json">${rendered.state}</script>
<script type="module" src="/app/${entry.file}"></script></body></html>`;
    const url = new URL(path, 'http://surveyor-startup.test').href;
    const observed = {documents: 0, commands: 0};
    deliveries.set(page, observed);
    await page.route('**/*', deliverStartupRequest);
    return {url, observed};

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
        if (requestedUrl.origin !== 'http://surveyor-startup.test') {
            await route.abort('failed');
            return;
        }
        if (request.isNavigationRequest() && request.url() === url) {
            observed.documents++;
            await route.fulfill({status: 200, contentType: 'text/html', body: html});
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
        if (pathname === '/fixture-bootstrap.css') {
            await route.fulfill({status: 200, contentType: 'text/css',
                body: readFileSync('node_modules/bootstrap/dist/css/bootstrap.min.css')});
            return;
        }
        if (pathname === '/img/logo.png') {
            await route.fulfill({status: 200, contentType: 'image/png', body: readFileSync('src/public/img/logo.png')});
            return;
        }
        let data: unknown;
        if (pathname === '/api/v1/session') data = bootstrap.session;
        else if (pathname === '/api/v1/help') data = bootstrap.help;
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

/** Hold the first real module request so SSR controls can be edited before failure.
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

test('initial startup retains edited login controls and recovers only after one accepted discard confirmation', async ({page}) => {
    const delivery = await startupDocument(page, '/frontend-pilot/users/login', {session: startupSession()});
    const module = await failStartupModule(page, /\/app\/assets\/IdentityPage-[^/]+\.js(?:\?|$)/u);
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
        const username = page.locator('input[name="username"]');
        const password = page.locator('input[name="password"]');
        const original = await username.elementHandle();
        await username.fill('Retained startup account');
        await password.fill('Retained startup secret');
        module.fail();
        const recovery = page.locator('#surveyor-pilot-startup-recovery');
        await expect(recovery).toBeVisible();
        await settleStartup(page);
        expect(delivery.observed.documents).toBe(1);
        expect(delivery.observed.commands).toBe(0);
        await expect(username).toHaveValue('Retained startup account');
        await expect(password).toHaveValue('Retained startup secret');
        expect(await original!.evaluate(node => node === document.querySelector('input[name="username"]'))).toBe(true);
        await expect(page.locator('#surveyor-pilot')).not.toHaveAttribute('data-pilot-hydrated', 'true');

        await recovery.getByRole('button', {name: 'Refresh page', exact: true}).click();
        expect(dialogs).toEqual(['confirm']);
        await expect(username).toHaveValue('Retained startup account');
        await expect(password).toHaveValue('Retained startup secret');
        expect(await original!.evaluate(node => node === document.querySelector('input[name="username"]'))).toBe(true);
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
        await expect(username).toHaveValue('');
        await expect(password).toHaveValue('');
        await expect(recovery).toHaveCount(0);
        await original!.dispose();
    } finally { module.restore(); page.off('dialog', answerRecovery); }
});

test('initial startup reloads a pristine failed route once and permits deliberate recovery from its stored marker', async ({page}) => {
    const delivery = await startupDocument(page, '/frontend-pilot/users/login', {session: startupSession()});
    const module = await failStartupModule(page, /\/app\/assets\/IdentityPage-[^/]+\.js(?:\?|$)/u);
    try {
        await page.goto(delivery.url, {waitUntil: 'commit'});
        await module.started;
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

test('initial startup keeps the original creation text and FileList after validator failure and canceled recovery', async ({page}) => {
    const packingCreateContext: components['schemas']['PackingCreateContext'] = {
        defaults: {participant: 0, guest: 0, authenticated: 0, public: 0}, permissions: [], presets: []};
    const delivery = await startupDocument(page, '/frontend-pilot/packing/create', {
        session: startupSession(), pageEntry: {kind: 'render'}, packingCreateContext});
    const module = await failStartupModule(page, /\/app\/assets\/validatePackingCreateContext-[^/]+\.js(?:\?|$)/u);
    const dialogs: string[] = [];
    page.on('dialog', cancelFileRecovery);
    async function cancelFileRecovery(dialog: Dialog): Promise<void> {
        dialogs.push(dialog.type());
        await dialog.dismiss();
    }
    try {
        await page.goto(delivery.url, {waitUntil: 'commit'});
        await module.started;
        const title = page.locator('#create-title');
        const upload = page.locator('#create-header');
        const originalInput = await upload.elementHandle();
        await title.fill('Retained creation title');
        await upload.setInputFiles({name: 'startup.png', mimeType: 'image/png', buffer: Buffer.from('synthetic startup bytes')});
        const originalFile = await upload.evaluateHandle(node => (node as HTMLInputElement).files![0]!);
        module.fail();
        const recovery = page.locator('#surveyor-pilot-startup-recovery');
        await expect(recovery).toBeVisible();
        await recovery.getByRole('button', {name: 'Refresh page', exact: true}).click();
        expect(dialogs).toEqual(['confirm']);
        await settleStartup(page);
        expect(delivery.observed.documents).toBe(1);
        expect(delivery.observed.commands).toBe(0);
        await expect(title).toHaveValue('Retained creation title');
        expect(await originalInput!.evaluate(node => node === document.getElementById('create-header'))).toBe(true);
        expect(await upload.evaluate((node, file) => (node as HTMLInputElement).files?.[0] === file, originalFile)).toBe(true);
        await expect(page.locator('#surveyor-pilot')).not.toHaveAttribute('data-pilot-hydrated', 'true');
        await originalFile.dispose();
        await originalInput!.dispose();
    } finally { module.restore(); page.off('dialog', cancelFileRecovery); }
});

test('client startup preserves confirmed native recovery and retires it after committed departure', async ({page}) => {
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

