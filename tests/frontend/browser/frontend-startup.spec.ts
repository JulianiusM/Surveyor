import {apiCompatibility} from '../../../.generated/api/v1/policy.mjs';
import {validatePackingListView} from '../../../.generated/api/v1/browser/validatePackingListView.mjs';
import {expect, test, type Dialog, type Locator, type Page, type Route} from '@playwright/test';
import fs, {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import type {Response} from 'express';
import {createBrowserReadGate as readGate, waitForFrontendHydration} from '../../keywords/frontendDynamicKeywords';
import type {components} from '../../../src/types/api/v1';
import type {FrontendBootstrap, FrontendPreparedDocument} from '../../../src/types/FrontendTypes';
import {createFrontendEventView} from '../../factories/frontendEventFactory';

type Session = components['schemas']['SessionView'];
const deliveries = new WeakMap<Page, {documents: number; commands: number; nativeStyles: number;
    externalAssets: string[]; fontAssets: string[]}>();

for (const ambiguous of [false, true]) {
    test(`initial route preloads ${ambiguous ? 'skip ambiguous build names' : 'include its resolved view and shared runtime'}`, async ({page}, testInfo) => {
        const manifestPath = resolve('dist/public/app/.vite/manifest.json');
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string,
            {file: string; name?: string; isDynamicEntry?: boolean}>;
        const identity = manifest['src/frontend/features/identity/IdentityPage.vue']!;
        const originalRead = fs.readFileSync;
        let intercepted = 0;
        let delivery: Awaited<ReturnType<typeof startupDocument>>;
        try {
            if (ambiguous) {
                // Only the build-manifest boundary is substituted. Rendering still
                // resolves the real route; an ambiguous hint must load neither candidate.
                const conflicting = {...manifest, syntheticDuplicate: {...identity, file: 'assets/ambiguous-view.js'}};
                Object.defineProperty(fs, 'readFileSync', {configurable: true, writable: true,
                    value: function readAmbiguousManifest(...arguments_: unknown[]) {
                        if (String(arguments_[0]).replaceAll('\\', '/').endsWith('/public/app/.vite/manifest.json')) {
                            intercepted++;
                            return JSON.stringify(conflicting);
                        }
                        return Reflect.apply(originalRead, fs, arguments_);
                    }});
            }
            delivery = await startupDocument(page, '/users/login', {session: startupSession()});
        } finally { fs.readFileSync = originalRead; }
        if (ambiguous) expect(intercepted).toBeGreaterThan(0);

        // Inspect the actual delivered head before Vite's ordinary lazy-import
        // helper can add runtime links for an intentionally skipped route hint.
        const preloads = [...delivery.html.matchAll(/<link\b[^>]*rel="modulepreload"[^>]*href="([^"]+)"/gu)]
            .map(match => new URL(match[1]!, delivery.url).pathname);
        await page.goto(delivery.url, {waitUntil: 'domcontentloaded'});
        expect(preloads).toContain('/app/' + manifest['src/frontend/app/entry-client.ts']!.file);
        expect(preloads.includes('/app/' + identity.file)).toBe(!ambiguous);
        expect(new Set(preloads).size).toBe(preloads.length);
        expect(preloads).not.toContain('/app/assets/ambiguous-view.js');
        for (const [source, chunk] of Object.entries(manifest)) {
            // Other lazy pages retain ordinary navigation ownership. Shared runtime
            // chunks may be hinted, while unrelated complete views stay deferred.
            if (chunk.isDynamicEntry && source !== 'src/frontend/features/identity/IdentityPage.vue') {
                expect(preloads).not.toContain('/app/' + chunk.file);
            }
        }

        // Keep a deterministic transfer budget beside measured browser timing.
        // Wall-clock acceptance belongs to a controlled CPU/network run, since CI
        // scheduling and intercepted responses cannot certify a one-second load.
        const compressedBytes = preloads.reduce((total, url) => total
            + readFileSync(resolve('dist/public', url.slice(1)) + '.br').length, 0);
        expect(compressedBytes).toBeLessThan(270_000);
        await testInfo.attach('initial-module-budget.json', {contentType: 'application/json',
            body: JSON.stringify({compressedBytes, preloads})});
        await waitForFrontendHydration(page);
        await expect(page.locator('#username')).toBeEditable();
        await expect(page.getByRole('button', {name: 'Login', exact: true})).toBeEnabled();
    });
}

test.afterEach(async ({page}) => {
    expect(deliveries.get(page)?.commands ?? 0, 'Isolated startup must not dispatch commands').toBe(0);
    expect(deliveries.get(page)?.nativeStyles ?? 0, 'Frontend documents must not depend on native stylesheets').toBe(0);
    expect(deliveries.get(page)?.externalAssets ?? [], 'Application assets must load from the document origin').toEqual([]);
    deliveries.delete(page);
});

/** Startup-only fixtures carry valid public wire data without creating an account,
 * resource or database connection. They prove browser delivery/recovery, never
 * controller admission or persistence. The real built SSR/entry owns rendering. */
function startupSession(locale: Session['locale'] = 'en'): Session {
    return {kind: 'anonymous', context: null, csrfToken: null,
        locale, activeProfile: null, profiles: [], loginUrl: '/users/login', logoutUrl: null,
        deployment: {buildId: 'startup-browser-fixture', apiCompatibility},
        shell: {version: 'startup-fixture', imprintUrl: '/imprint', privacyPolicyUrl: '/privacy',
            localLoginEnabled: true, oidcEnabled: false, oidcName: 'Fixture provider'}};
}

/** Deliver real built SSR and fingerprinted client assets through one intercepted
 * origin. This selected browser boundary needs no Express server or schema reset.
 * API fixtures retain production decoding while refusing every command. */
async function startupDocument(page: Page, path: string, bootstrap: FrontendBootstrap,
                               documentHeaders?: Record<string, string>) {
    const renderer = await import(pathToFileURL(resolve('dist/backend/modules/frontendRenderer.js')).href) as {
        initializeFrontendRenderer(): Promise<void>;
        prepareFrontend(response: Response, url: string, bootstrap: FrontendBootstrap): Promise<FrontendPreparedDocument>;
    };
    // Match installed readiness: warm only code, then render each fixture's own
    // public bootstrap through the same owner used by subsequent requests.
    await renderer.initializeFrontendRenderer();
    // Only the response/header boundary is substituted. The real renderer owns
    // the complete shell, independent notice/monitor, SSR tree and bootstrap.
    const response: Response = Object.create(null);
    response.set = setFixtureHeader;
    const prepared = await renderer.prepareFrontend(response, path, bootstrap);
    // Preserve the real document unchanged. Every stylesheet/font must be emitted
    // by the application build; no CDN substitute can conceal a remote dependency.
    const html = prepared.html;
    const url = new URL(path, 'http://surveyor-startup.test').href;
    const observed = {documents: 0, commands: 0, nativeStyles: 0, externalAssets: [] as string[], fontAssets: [] as string[]};
    deliveries.set(page, observed);
    await page.route('**/*', deliverStartupRequest);
    return {url, observed, html};

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
        if (requestedUrl.origin !== 'http://surveyor-startup.test') {
            // Block every external origin and retain attempted asset requests as
            // explicit failures; successful layout cannot silently rely on a CDN.
            if (['stylesheet', 'script', 'font', 'image'].includes(request.resourceType())) observed.externalAssets.push(request.url());
            await route.abort('failed');
            return;
        }
        if (request.isNavigationRequest() && pathname.startsWith('/')) {
            observed.documents++;
            // Native href/GET recovery may visit another Help query. Deliver its
            // real shell too; this remains synthetic public data, not a server route
            // admission or search-result/persistence assertion.
            const document = request.url() === url ? html
                : (await renderer.prepareFrontend(response, pathname + requestedUrl.search, bootstrap)).html;
            await route.fulfill({status: 200, contentType: 'text/html', headers: documentHeaders, body: document});
            return;
        }
        if (pathname.startsWith('/app/assets/')) {
            // Restrict reads to a single build-authored asset basename; a URL
            // cannot select another workspace path or substitute executable code.
            const filename = pathname.slice('/app/assets/'.length);
            if (!/^[A-Za-z0-9_.-]+$/u.test(filename)) throw new Error('Unexpected startup asset path.');
            const contentType = filename.endsWith('.css') ? 'text/css' : filename.endsWith('.woff2') ? 'font/woff2'
                : filename.endsWith('.woff') ? 'font/woff' : 'text/javascript';
            if (request.resourceType() === 'font') observed.fontAssets.push(request.url());
            await route.fulfill({status: 200, contentType,
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
        else if (pathname === '/api/v1/drivers-lists/create-entry' && bootstrap.driversCreateContext)
            data = {entry: {kind: 'render'}, context: bootstrap.driversCreateContext, selectedEvent: null};
        else if (pathname === '/api/v1/activity-plans/create-entry' && bootstrap.activityCreateContext)
            data = {entry: {kind: 'render'}, context: bootstrap.activityCreateContext, selectedEvent: null};
        else if (pathname === '/api/v1/events/create-entry' && bootstrap.eventCreateContext)
            data = {entry: {kind: 'render'}, context: bootstrap.eventCreateContext};
        if (data !== undefined) {
            await route.fulfill({status: 200, contentType: 'application/json', headers: bootstrap.session.context === null ? {} : {
                'X-Surveyor-Context': bootstrap.session.context}, body: JSON.stringify(data)});
            return;
        }
        await route.fulfill({status: 404, contentType: 'text/plain', body: 'No startup fixture for this request.'});
    }
}

/** Verify a real shell icon's font face and painted glyph. A font-family rule or
 * nonempty pseudo-element alone could still render a missing-font square. */
async function expectLocalIconReady(page: Page): Promise<void> {
    const icon = page.locator('header .bi-house-fill');
    await expect(icon).toBeVisible();
    // Let the browser's ordinary CSS/font loading finish without explicitly
    // requesting a font that the delivered page never uses by itself.
    await expect.poll(() => icon.evaluate(() => Array.from(document.fonts)
        .find(face => face.family.replaceAll('"', '') === 'bootstrap-icons')?.status)).toBe('loaded');
    const glyph = await icon.evaluate(function inspectPaintedIcon(element) {
        const style = getComputedStyle(element, '::before');
        const content = style.content.slice(1, -1);
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const context = canvas.getContext('2d')!;
        // Compare the actual icon glyph with the system fallback at the same
        // position. A successfully downloaded but unusable face must still fail.
        context.font = '32px ' + style.fontFamily;
        context.fillText(content, 8, 40);
        const painted = context.getImageData(0, 0, 64, 64).data;
        context.clearRect(0, 0, 64, 64);
        context.font = '32px sans-serif';
        context.fillText(content, 8, 40);
        const fallback = context.getImageData(0, 0, 64, 64).data;
        return {family: style.fontFamily.replaceAll('"', ''), codePoint: content.codePointAt(0) ?? 0,
            hasInk: painted.some(value => value !== 0), distinctFromFallback: painted.some((value, index) => value !== fallback[index]),
            width: element.getBoundingClientRect().width};
    });
    expect(glyph.family).toBe('bootstrap-icons');
    expect(glyph.codePoint).toBeGreaterThanOrEqual(0xe000);
    expect(glyph.codePoint).toBeLessThanOrEqual(0xf8ff);
    expect(glyph.hasInk).toBe(true);
    expect(glyph.distinctFromFallback).toBe(true);
    expect(glyph.width).toBeGreaterThan(0);
    expect(deliveries.get(page)?.fontAssets.length).toBeGreaterThan(0);
    expect(deliveries.get(page)?.externalAssets).toEqual([]);
}

test('local styles and icon fonts render before entry execution and survive hydration with external assets blocked', async ({page}) => {
    const help: components['schemas']['HelpPageData'] = {locale: 'en', title: 'Local asset fixture',
        content: '<h2>Styled before entry execution</h2>', currentDoc: 'fixture.md', docsList: [], docsGroups: [], toc: []};
    const delivery = await startupDocument(page, '/help', {session: startupSession(), help});
    const entry = await failStartupModule(page, /\/app\/assets\/entry-client-[^/]+\.js(?:\?|$)/u);
    try {
        await page.goto(delivery.url, {waitUntil: 'commit'});
        await entry.started;
        await expect(page.locator('.help-content h2')).toHaveCSS('font-weight', '600');
        await expect(page.locator('header nav')).toHaveCSS('display', 'flex');
        await expect(page.locator('#surveyor-frontend')).not.toHaveAttribute('data-frontend-hydrated', 'true');
        await expectLocalIconReady(page);

        // Release the real build entry, then assert the hydrated shell still
        // uses the downloaded same-origin icon rather than a replacement asset.
        entry.restore();
        await waitForFrontendHydration(page);
        await expectLocalIconReady(page);
        await expect(page.getByRole('searchbox')).toBeEditable();
        expect(delivery.observed.externalAssets).toEqual([]);
    } finally { entry.restore(); }
});

/** Both real Event intents share one bounded actor/read fixture. Capabilities
 * retain their independent page adoption, and no Finance projection is admitted. */
async function startupEventDocument(page: Page, locale: Session['locale'], admin: boolean, title = 'P2 Event 09fe4b5b', settings = admin) {
    const id = '22222222-2222-4222-8222-222222222222';
    const profile = {id: '11111111-1111-4111-8111-111111111111', name: 'Event presentation fixture'};
    const session: Session = {...startupSession(locale), kind: 'account', activeProfile: profile, profiles: [profile],
        context: 'event-heading-context-1234567890', csrfToken: 'event-heading-csrf-1234567890'};
    const baseline = createFrontendEventView();
    const event = createFrontendEventView({id, title,
        capabilities: {...baseline.capabilities, admin, settings, register: !admin}});
    const eventEntry: components['schemas']['EventResourceEntry'] = {entry: {kind: 'render'}, guest: null};
    const delivery = await startupDocument(page, `/event/${id}${admin ? '/admin' : ''}?locale=${locale}`,
        {session, pageEntry: {kind: 'render'}, eventEntry});
    await page.route(`**/api/v1/events/${id}**`, async route => {
        const pathname = new URL(route.request().url()).pathname;
        if (pathname !== `/api/v1/events/${id}` && pathname !== `/api/v1/events/${id}/entry`
            && !(admin && pathname === `/api/v1/events/${id}/things-to-do`)) {
            await route.abort('failed');
            return;
        }
        const data = pathname.endsWith('/entry') ? eventEntry : pathname.endsWith('/things-to-do') ? {items: []} : event;
        await route.fulfill({status: 200, contentType: 'application/json',
            headers: {'X-Surveyor-Context': session.context!}, body: JSON.stringify(data)});
    });
    return {delivery, event, session};
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

/** Expose actual responsive header controls without changing their disclosure state twice. */
async function expandStartupNavigation(page: Page): Promise<void> {
    const toggle = page.locator('header .navbar-toggler');
    if (await toggle.isVisible() && await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
}

/** Startup fallback belongs below the same actual header in every failure mode. */
async function expectStartupNoticeBelowHeader(page: Page): Promise<void> {
    const notice = page.locator('#surveyor-frontend-javascript-required');
    await expect(notice).toBeVisible();
    await expect(notice).toHaveCount(1);
    expect(await notice.evaluate(element => element.previousElementSibling?.matches('.frontend-app-header'))).toBe(true);
    const navigation = (await page.locator('.frontend-app-header').boundingBox())!;
    const warning = (await notice.boundingBox())!;
    expect(Math.abs(warning.y - navigation.y - navigation.height)).toBeLessThan(1);
    expect(warning.x).toBeGreaterThanOrEqual(0);
    expect(warning.x + warning.width).toBeLessThanOrEqual((await page.viewportSize())!.width);
}

/** Narrow Refresh uses the ordinary translated action row and normal hit area. */
async function expectPhoneRefresh(refresh: Locator, expectedWidth: number, label: string): Promise<void> {
    await expect(refresh).toBeVisible();
    await expect(refresh).toContainText(label);
    expect((await refresh.boundingBox())!.width).toBeGreaterThanOrEqual(expectedWidth - 1);
    const style = await refresh.evaluate(element => {
        const value = getComputedStyle(element);
        return {fontSize: value.fontSize, padding: [value.paddingTop, value.paddingRight, value.paddingBottom, value.paddingLeft]};
    });
    expect(style).toEqual({fontSize: '16px', padding: ['6px', '12px', '6px', '12px']});
}

for (const locale of ['en', 'de'] as const) {
    for (const width of [1280, 390]) {
        test(`${locale} profile menu keeps natural desktop width and a complete phone row at ${width}px`, async ({page}) => {
            await page.setViewportSize({width, height: 900});
            const profile = {id: '11111111-1111-4111-8111-111111111111', name: 'Menu fixture'};
            const session: Session = {...startupSession(locale), kind: 'account', activeProfile: profile, profiles: [profile],
                context: 'menu-browser-context-1234567890', csrfToken: 'menu-browser-csrf-1234567890'};
            const delivery = await startupDocument(page, '/', {session, landing: {quickCreate: 'packing'}});
            await page.goto(delivery.url);
            await waitForFrontendHydration(page);
            await expandStartupNavigation(page);
            const disclosure = page.locator('header .navbar-nav.ms-auto details');
            await disclosure.locator('summary').click();
            const menu = disclosure.locator('.dropdown-menu');
            await expect(menu).toBeVisible();
            const geometry = await menu.evaluate(element => {
                const bounds = element.getBoundingClientRect();
                return {width: bounds.width, parentWidth: element.parentElement!.getBoundingClientRect().width,
                    left: bounds.left, right: bounds.right, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth,
                    rootFont: Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
                    rows: [...element.querySelectorAll('.dropdown-item')].map(item => {
                        const style = getComputedStyle(item);
                        return {height: item.getBoundingClientRect().height, oneLineHeight: Number.parseFloat(style.lineHeight)
                            + Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom)};
                    })};
            });
            expect(geometry.rows).toHaveLength(5);
            expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1);
            expect(geometry.left).toBeGreaterThanOrEqual(0);
            expect(geometry.right).toBeLessThanOrEqual(width);
            if (width < 992) expect(Math.abs(geometry.width - geometry.parentWidth)).toBeLessThan(1);
            else {
                // The native English menu fits Bootstrap's10rem floor. German
                // may grow for its whole labels without inheriting the old14rem gap.
                if (locale === 'en') expect(geometry.width).toBeLessThanOrEqual(geometry.rootFont * 10 + 1);
                expect(geometry.width).toBeLessThan(geometry.rootFont * 14);
            }
            for (const row of geometry.rows) expect(row.height).toBeLessThanOrEqual(row.oneLineHeight + 1);
            await menu.locator('.dropdown-item').first().click({trial: true});
            await disclosure.press('Escape');
            await expect(disclosure.locator('summary')).toBeFocused();
            await expect(menu).toBeHidden();
            expect(delivery.observed.commands).toBe(0);
        });
    }
}

for (const locale of ['en', 'de'] as const) {
    for (const width of [1280, 390, 576, 600, 767, 768]) {
        test(`Overview accordion paints and contains its independent Refresh at ${width}px in ${locale}`, async ({page}) => {
            await page.setViewportSize({width, height: 900});
            const profile = {id: '11111111-1111-4111-8111-111111111111', name: 'Accordion fixture'};
            const session: Session = {...startupSession(locale), kind: 'account', activeProfile: profile, profiles: [profile],
                context: 'accordion-browser-context-1234567890', csrfToken: 'accordion-browser-csrf-1234567890'};
            const delivery = await startupDocument(page, '/users/dashboard', {session, pageEntry: {kind: 'render'}});
            const counts = {owner: 0, participant: 0};
            const started = readGate();
            const released = readGate();
            let holdOwner = false;
            await page.route('**/api/v1/overview?**', async function deliverOverviewRead(route) {
                const query = new URL(route.request().url()).searchParams;
                const collection = query.get('collection') === 'owner' ? 'owner' : 'participant';
                counts[collection]++;
                if (holdOwner && collection === 'owner') {started.release(); await released.promise;}
                const projection: components['schemas']['OverviewRegion'] = {collection, region: 'main', q: '', type: 'all',
                    availableTypes: [], page: 1, childPage: 1, eventId: null, pageSize: 24, totalEntities: 0, hiddenEntities: 0,
                    regionEntities: 0, matchingEntities: 0, totalCards: 0, totalChildren: 0,
                    hasPrevious: false, hasNext: false, parent: null, items: []};
                await route.fulfill({status: 200, contentType: 'application/json',
                    headers: {'X-Surveyor-Context': session.context!}, body: JSON.stringify(projection)});
            });
            try {
                await page.goto(delivery.url);
                await waitForFrontendHydration(page);
                const heading = page.locator('.frontend-accordion-heading').last();
                const label = locale === 'en' ? 'Refresh' : 'Aktualisieren';
                const refresh = heading.getByRole('button', {name: label, exact: true});
                await expect(refresh).toBeEnabled();
                const toggle = heading.locator('.accordion-button');
                await expect(toggle).toHaveAttribute('aria-expanded', 'true');
                const bounds = (await heading.boundingBox())!;
                const button = (await refresh.boundingBox())!;
                const disclosure = (await toggle.boundingBox())!;
                expect(await heading.evaluate(element => getComputedStyle(element).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
                expect(button.x).toBeGreaterThanOrEqual(bounds.x);
                expect(button.x + button.width).toBeLessThanOrEqual(bounds.x + bounds.width);
                expect(button.y).toBeGreaterThanOrEqual(bounds.y);
                expect(button.y + button.height).toBeLessThanOrEqual(bounds.y + bounds.height);
                if (width < 768) {
                    await expectPhoneRefresh(refresh, bounds.width - 16, label);
                    expect(button.y).toBeGreaterThanOrEqual(disclosure.y + disclosure.height);
                } else {
                    expect(disclosure.x + disclosure.width).toBeLessThanOrEqual(button.x);
                    expect(button.height).toBeLessThanOrEqual(32);
                }
                expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

                // The actual family Refresh reads each admitted collection once.
                // Its pending/focus lifetime stays independent of the disclosure.
                const before = {...counts};
                holdOwner = true;
                await refresh.click();
                await started.promise;
                await expect(refresh).toBeDisabled();
                await expect(toggle).toHaveAttribute('aria-expanded', 'true');
                released.release();
                await expect(refresh).toBeEnabled();
                await expect(refresh).toBeFocused();
                expect(counts.owner).toBe(before.owner + 1);
                expect(counts.participant).toBe(before.participant + 1);
                expect(delivery.observed.commands).toBe(0);
            } finally { released.release(); }
        });
    }
}

for (const width of [1280, 1024, 390, 320]) {
    test(`German navigation disclosures fit and remain above shared feedback at ${width}px`, async ({page}, info) => {
        await page.setViewportSize({width, height: 900});
        const profile = {id: '11111111-1111-4111-8111-111111111111',
            name: 'Maximilian Langnamiger Teilnehmer mit einem ausführlichen Profilnamen'};
        const session: Session = {...startupSession('de'), kind: 'account', activeProfile: profile, profiles: [profile],
            context: 'german-navigation-context-1234567890', csrfToken: 'german-navigation-csrf-1234567890'};
        const delivery = await startupDocument(page, '/', {session,
            landing: {quickCreate: 'packing'}, pageNotice: {kind: 'info', messageKey: 'auth.accountRequired'}});
        await page.goto(delivery.url);
        await waitForFrontendHydration(page);
        await expandStartupNavigation(page);
        await expect(page.locator('main [data-frontend-notices] .frontend-notification')).toBeVisible();

        // Exercise every actual header disclosure with translated labels. Hit
        // testing catches a usable-looking menu hidden underneath sticky feedback.
        const disclosures = await page.locator('header details').all();
        for (let index = 0; index < disclosures.length; index++) {
            const disclosure = disclosures[index]!;
            await disclosure.locator('summary').click();
            const menu = disclosure.locator('.dropdown-menu');
            await expect(menu).toBeVisible();
            const geometry = await menu.evaluate(function inspectNavigationMenu(element) {
                const bounds = element.getBoundingClientRect();
                return {left: bounds.left, right: bounds.right, width: bounds.width,
                    clientWidth: element.clientWidth, scrollWidth: element.scrollWidth,
                    documentWidth: document.documentElement.scrollWidth, viewport: window.innerWidth};
            });
            expect(geometry.left).toBeGreaterThanOrEqual(0);
            expect(geometry.right).toBeLessThanOrEqual(width);
            expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1);
            expect(geometry.documentWidth).toBeLessThanOrEqual(width + 1);
            const item = menu.locator('.dropdown-item').first();
            await item.click({trial: true});
            expect(await item.evaluate(function itemReceivesPointer(element) {
                const bounds = element.getBoundingClientRect();
                return element.contains(document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2));
            })).toBe(true);
            await page.screenshot({path: info.outputPath('german-disclosure-' + index + '.png'),
                animations: 'disabled'});
            await disclosure.press('Escape');
            await expect(disclosure).not.toHaveAttribute('open');
        }
        if (width === 1280) {
            // A short desktop viewport must retain keyboard access to the final
            // action by scrolling the menu itself, with no document movement.
            await page.setViewportSize({width, height: 180});
            const disclosure = disclosures[disclosures.length - 1]!;
            const origin = await page.evaluate(() => window.scrollY);
            await disclosure.locator('summary').press('ArrowUp');
            const menu = disclosure.locator('.dropdown-menu');
            const item = menu.locator('.dropdown-item').last();
            await expect(item).toBeFocused();
            const itemBounds = (await item.boundingBox())!;
            const menuBounds = (await menu.boundingBox())!;
            expect(itemBounds.y).toBeGreaterThanOrEqual(menuBounds.y);
            expect(itemBounds.y + itemBounds.height).toBeLessThanOrEqual(menuBounds.y + menuBounds.height);
            expect(await menu.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
            expect(await page.evaluate(() => window.scrollY)).toBe(origin);
        }
        expect(delivery.observed.commands).toBe(0);
    });
}

for (const width of [1280, 390]) {
    test(`long read diagnostics retain a separate responsive retry action at ${width}px`, async ({page}, info) => {
        await page.setViewportSize({width, height: 900});
        const help: components['schemas']['HelpPageData'] = {locale: 'de', title: 'Lange Rückmeldung',
            content: '<h2>Weiterhin lesbarer Inhalt</h2>', currentDoc: 'fixture.md', docsList: [], docsGroups: [], toc: []};
        const delivery = await startupDocument(page, '/help', {session: startupSession('de'), help});
        const diagnostic = 'Die angeforderten Informationen konnten wegen einer vorübergehenden Unterbrechung nicht geladen werden. '.repeat(6);
        await page.route('**/api/v1/help*', async function failHelpRead(route) {
            // A future server's safe plain-text detail crosses the real decoding
            // boundary and makes wrapping independent of today's catalog length.
            await route.fulfill({status: 503, contentType: 'application/problem+json', body: JSON.stringify({
                type: 'urn:surveyor:problem:future-read-failure', title: 'Read unavailable', status: 503,
                detail: diagnostic, requestId: 'responsive-feedback-fixture', code: 'FUTURE_READ_FAILURE',
                messageKey: 'future.readFailure', params: {},
            })});
        });
        await page.goto(delivery.url);
        await waitForFrontendHydration(page);
        await page.locator('main').getByRole('button', {name: 'Aktualisieren', exact: true}).click();
        const notice = page.locator('main .status-notice.alert-danger');
        await expect(notice.locator('[data-read-issue]')).toHaveText(diagnostic.trim());
        const body = (await notice.locator('.frontend-notice-body').boundingBox())!;
        const action = notice.locator('.frontend-notice-actions .btn');
        const button = (await action.boundingBox())!;
        const bounds = (await notice.boundingBox())!;
        expect(button.x).toBeGreaterThanOrEqual(bounds.x);
        expect(button.x + button.width).toBeLessThanOrEqual(bounds.x + bounds.width);
        if (width < 576) {
            expect(button.y).toBeGreaterThanOrEqual(body.y + body.height);
            expect(Math.abs(button.width - body.width)).toBeLessThan(1);
        } else {
            expect(button.x).toBeGreaterThan(body.x + body.width);
            expect(Math.abs(button.x + button.width - bounds.x - bounds.width + 17)).toBeLessThan(2);
        }
        expect(await notice.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
        await action.click({trial: true});
        await page.screenshot({path: info.outputPath('long-responsive-read-diagnostic.png'), fullPage: true, animations: 'disabled'});
        expect(delivery.observed.commands).toBe(0);
    });
}

for (const kind of ['anonymous', 'account', 'guest'] as const) {
    for (const width of [1280, 390]) {
        test(`Home preserves the public landing and separates Overview for ${kind} at ${width}px`, async ({page}, info) => {
            await page.setViewportSize({width, height: 900});
            const profile = {id: '11111111-1111-4111-8111-111111111111', name: 'Landing fixture'};
            const session: Session = kind === 'anonymous' ? startupSession()
                : {...startupSession(), kind, activeProfile: profile, profiles: [profile],
                    context: 'landing-route-context-1234567890', csrfToken: 'landing-route-csrf-1234567890'};
            const delivery = await startupDocument(page, '/', {session, landing: {quickCreate: 'packing'}});
            const overviewReads: string[] = [];
            await page.route('**/api/v1/overview?*', deliverOverview);
            await page.goto(delivery.url);
            await waitForFrontendHydration(page);
            const landing = page.locator('main > section');
            await expect(landing.getByRole('heading', {level: 1, name: 'Surveyor', exact: true})).toBeVisible();
            await expect(landing.locator('h2')).toHaveCount(7);
            await expect(page.locator('[data-collection]')).toHaveCount(0);
            expect(overviewReads).toEqual([]);
            const origin = await page.evaluate(() => performance.timeOrigin);
            const brand = page.locator('header a.navbar-brand');
            // The mobile navbar deliberately starts closed; inspect its fixed
            // destination now, then expose and activate that same link below.
            const home = page.locator('header a.nav-link[href="/"]');
            await expect(brand).toHaveAttribute('href', '/');
            await expect(home).toHaveAttribute('href', '/');
            if (kind !== 'anonymous') await expect(landing.locator('a.btn-primary')).toHaveAttribute('href', '/users/dashboard');
            if (width < 576) {
                const bar = landing.locator('.frontend-action-row').first();
                const actions = await bar.locator(':scope > .btn').all();
                const row = (await bar.boundingBox())!;
                const first = (await actions[0]!.boundingBox())!;
                const second = (await actions[1]!.boundingBox())!;
                expect(Math.abs(first.width - row.width)).toBeLessThan(1);
                expect(Math.abs(second.width - row.width)).toBeLessThan(1);
                expect(second.y).toBeGreaterThanOrEqual(first.y + first.height);
            }
            await page.screenshot({path: info.outputPath('restored-public-landing.png'), fullPage: true, animations: 'disabled'});

            await expandStartupNavigation(page);
            await page.locator('header').getByRole('button', {name: 'Overview', exact: true}).click();
            const overview = page.locator('header').getByRole('link', {name: 'Your overview', exact: true});
            await expect(overview).toHaveAttribute('href', '/users/dashboard');
            await overview.click();
            if (kind === 'anonymous') {
                await expect(page).toHaveURL(/\/users\/login\?next=/u);
                expect(new URL(page.url()).searchParams.get('next')).toBe('/users/dashboard');
                await expect(page.locator('main #username')).toBeVisible();
                if (width < 576) {
                    const form = page.locator('main form').filter({has: page.locator('#username')});
                    const submit = (await form.getByRole('button', {name: 'Login', exact: true}).boundingBox())!;
                    expect(submit.width).toBeGreaterThan((await form.boundingBox())!.width * .85);
                }
                await expect(page.locator('.js-overview-region')).toHaveCount(0);
                expect(overviewReads).toEqual([]);
                await page.screenshot({path: info.outputPath('anonymous-dashboard-login.png'), fullPage: true, animations: 'disabled'});
            } else {
                await expect(page).toHaveURL(/\/users\/dashboard$/u);
                await expect(page.locator('main h1')).toHaveText('Welcome, Landing fixture!');
                await expect(page.locator('[data-collection="owner"][data-region="main"]')).toBeVisible();
                await expect.poll(() => overviewReads.length).toBeGreaterThan(0);
            }
            await expandStartupNavigation(page);
            await home.click();
            await expect(page).toHaveURL(/\/$/u);
            await expect(page.locator('main h1')).toHaveText('Surveyor');
            await expect(page.locator('main h2')).toHaveCount(7);
            await expandStartupNavigation(page);
            await page.locator('header').getByRole('button', {name: 'Overview', exact: true}).click();
            await page.locator('header').getByRole('link', {name: 'Your overview', exact: true}).click();
            await expect(page).toHaveURL(kind === 'anonymous'
                ? /\/users\/login\?next=/u
                : /\/users\/dashboard$/u);
            if (kind === 'anonymous') expect(new URL(page.url()).searchParams.get('next')).toBe('/users/dashboard');
            await brand.click();
            await expect(page).toHaveURL(/\/$/u);
            await expect(page.locator('main h1')).toHaveText('Surveyor');
            expect(await page.evaluate(() => performance.timeOrigin)).toBe(origin);
            expect(delivery.observed.documents).toBe(1);

            /** Empty public-shaped projections let the real region owners settle.
             * They are never requested by the initial public Landing component. */
            async function deliverOverview(route: Route): Promise<void> {
                overviewReads.push(route.request().url());
                const query = new URL(route.request().url()).searchParams;
                const data: components['schemas']['OverviewRegion'] = {
                    collection: query.get('collection') as 'owner' | 'participant', region: query.get('region') as 'main' | 'hidden',
                    q: '', type: 'all', availableTypes: [], page: 1, childPage: 1, eventId: null, pageSize: 12,
                    totalEntities: 0, hiddenEntities: 0, regionEntities: 0, matchingEntities: 0, totalCards: 0,
                    totalChildren: 0, hasPrevious: false, hasNext: false, parent: null, items: [],
                };
                await route.fulfill({status: 200, contentType: 'application/json',
                    headers: session.context ? {'X-Surveyor-Context': session.context} : {}, body: JSON.stringify(data)});
            }
        });
    }
}

test.describe('page-shaped initial loading', function pageShapedInitialLoading() {
    // Hold the real entry module pending while the independent startup monitor
    // keeps SSR visible. Disabled JavaScript intentionally hides interactive
    // content, so it cannot provide the approved loading presentation boundary.
    // These public fixtures own browser layout, not backend admission.
    const resourceId = '22222222-2222-4222-8222-222222222222';
    const pages = [
        {name: 'Overview', path: '/users/dashboard', variant: 'overview'},
        {name: 'Packing detail', path: '/packing/' + resourceId, variant: 'list-detail', columns: 6},
        {name: 'Drivers detail', path: '/drivers/' + resourceId, variant: 'list-detail', columns: 5},
        {name: 'Activity detail', path: '/activity/' + resourceId, variant: 'activity', columns: 7},
        {name: 'Survey detail', path: '/survey/' + resourceId, variant: 'survey', columns: 4},
        {name: 'Packing creation', path: '/packing/create', variant: 'packing-create', columns: 4},
        {name: 'Drivers creation', path: '/drivers/create', variant: 'list-create'},
        {name: 'Event detail', path: '/event/' + resourceId, variant: 'event'},
        {name: 'Event administration', path: '/event/' + resourceId + '/admin', variant: 'event-admin'},
        {name: 'Event creation', path: '/event/create', variant: 'event-create'},
        {name: 'Login', path: '/users/login', variant: 'login'},
        {name: 'Registration', path: '/users/register', variant: 'identity'},
        {name: 'Profile', path: '/users/profile', variant: 'profile'},
        {name: 'Profile roster', path: '/users/profile/manage', variant: 'roster'},
        {name: 'Profile workflow', path: '/users/profile/migrate/show', variant: 'workflow'},
        {name: 'Guest entry', path: '/packing/' + resourceId + '/guest', variant: 'guest'},
    ];

    for (const width of [1280, 390]) {
        for (const sample of pages) {
            test(`${sample.name} skeleton follows its page layout at ${width}px`, async function inspectInitialPageShape({page}, info) {
                await page.setViewportSize({width, height: 900});
                const delivery = await startupDocument(page, sample.path, {session: startupSession()});
                const entry = await failStartupModule(page, /\/app\/assets\/entry-client-[^/]+\.js(?:\?|$)/u);
                try {
                    await page.goto(delivery.url, {waitUntil: 'commit'});
                    await entry.started;
                    const loading = page.locator('[data-frontend-initial-loading]');
                    await expect(loading).toHaveAttribute('data-loading-skeleton', sample.variant);
                    await expect(loading).toBeVisible();
                    await expect(loading.locator('[role="status"]')).toHaveCount(1);
                    await expect(loading.locator('.frontend-skeleton-animated')).toHaveCount(1);
                    await expect(loading.locator('.frontend-skeleton-page-header')).toHaveCount(1);
                    await expect(page.locator('main input, main select, main textarea, main form')).toHaveCount(0);

                    // Column geometry must follow the actual module. Packing and
                    // Drivers retain every column on phones rather than hiding data.
                    if (sample.columns) {
                        const table = loading.locator('.frontend-skeleton-table-grid').first();
                        await expect(table).toHaveAttribute('data-skeleton-columns', String(sample.columns));
                        const cells = table.locator('.frontend-skeleton-table-heading > .frontend-skeleton-bar');
                        await expect(cells).toHaveCount(sample.columns);
                        for (const cell of await cells.all()) {
                            expect(await cell.evaluate(element => getComputedStyle(element).display)).not.toBe('none');
                        }
                        if (width === 390) {
                            expect(await table.locator('..').evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
                        }
                    }

                    const geometry = await loading.evaluate(function inspectSkeletonGeometry(element) {
                        const bounds = element.getBoundingClientRect();
                        return {width: bounds.width, height: bounds.height, viewport: window.innerWidth,
                            document: document.documentElement.scrollWidth,
                            columns: Array.from(element.querySelectorAll('[data-skeleton-columns]'), function columnGeometry(grid) {
                                return {columns: grid.getAttribute('data-skeleton-columns'), width: grid.getBoundingClientRect().width};
                            })};
                    });
                    expect(geometry.width).toBeGreaterThan(width * .9);
                    expect(geometry.height).toBeGreaterThan(150);
                    expect(geometry.document).toBeLessThanOrEqual(geometry.viewport + 1);
                    const heading = await loading.locator('.frontend-skeleton-page-header > .frontend-skeleton-heading').boundingBox();
                    expect(Math.abs(heading!.x + heading!.width / 2 - width / 2)).toBeLessThan(1);
                    if (['list-detail', 'activity', 'survey', 'event', 'event-admin'].includes(sample.variant)) {
                        const header = await loading.locator('.frontend-skeleton-page-header').boundingBox();
                        expect(header!.height - heading!.height).toBeGreaterThanOrEqual(32);
                    }
                    if (sample.variant === 'overview' && width === 1280) {
                        const animation = loading.locator('.frontend-skeleton-animated');
                        expect(await animation.evaluate(element => getComputedStyle(element).animationName)).toBe('frontend-skeleton-pulse');
                        await page.emulateMedia({reducedMotion: 'reduce'});
                        expect(await animation.evaluate(element => getComputedStyle(element).animationName)).toBe('none');
                        await page.emulateMedia({reducedMotion: 'no-preference'});
                    }
                    await info.attach('initial-shape-geometry', {body: JSON.stringify(geometry, null, 2), contentType: 'application/json'});
                    const screenshot = info.outputPath('initial-page-shape.png');
                    await page.screenshot({path: screenshot, fullPage: true, animations: 'disabled'});
                    await info.attach('initial-page-shape', {path: screenshot, contentType: 'image/png'});
                    expect(delivery.observed.commands).toBe(0);
                } finally { entry.restore(); }
            });
        }
    }
});

for (const width of [1280, 390]) {
    test(`sticky notifications reserve and release page space at ${width}px`, async ({page}, testInfo) => {
        await page.setViewportSize({width, height: 900});
        const content = Array.from({length: 40}, () => '<p>Readable saved page content.</p>').join('');
        const delivery = await startupDocument(page, '/help?doc=fixture', {
            session: startupSession(), pageNotice: {kind: 'info', messageKey: 'auth.accountRequired'},
            help: {locale: 'en', title: 'Notification layout fixture', currentDoc: 'fixture.md',
                content, docsList: [], docsGroups: [], toc: []},
        });
        await page.goto(delivery.url);
        await waitForFrontendHydration(page);
        const host = page.locator('main > .frontend-notice-region');
        const notice = host.locator('.frontend-notification');
        const body = page.locator('main > section');
        await expect(notice).toBeVisible();
        const occupied = (await host.boundingBox())!;
        const initialBody = (await body.boundingBox())!;
        expect(occupied.height).toBeGreaterThan(30);
        expect(initialBody.y).toBeGreaterThanOrEqual(occupied.y + occupied.height - 1);
        await page.screenshot({path: testInfo.outputPath('notification-reserved-space.png'), animations: 'disabled'});

        // The same natural-flow host sticks after its original position has left
        // the viewport. It must not need a second fixed copy or a spacer timer.
        await page.evaluate(() => window.scrollTo(0, 450));
        expect(Math.abs((await host.boundingBox())!.y)).toBeLessThan(1);
        await page.evaluate(() => window.scrollTo(0, 0));
        await notice.locator('button.btn-close').click();
        await expect(notice).toHaveCount(0);
        await expect.poll(async () => (await host.boundingBox())!.height).toBe(0);
        const releasedBody = (await body.boundingBox())!;
        expect(initialBody.y - releasedBody.y).toBeGreaterThanOrEqual(occupied.height - 1);
        await page.screenshot({path: testInfo.outputPath('notification-released-space.png'), animations: 'disabled'});
    });
}

for (const width of [1280, 1024, 390]) {
    for (const linked of [false, true]) {
        test(`entity headings remain centered with embedded actions at ${width}px (linked: ${linked})`, async ({page}, testInfo) => {
            await page.setViewportSize({width, height: 900});
            const id = '22222222-2222-4222-8222-222222222222';
            const profile = {id: '11111111-1111-4111-8111-111111111111', name: 'Header fixture'};
            const session: Session = {...startupSession(), kind: 'account', activeProfile: profile, profiles: [profile],
                context: 'heading-browser-context-1234567890', csrfToken: 'heading-browser-csrf-1234567890'};
            const delivery = await startupDocument(page, '/packing/' + id, {session, pageEntry: {kind: 'render'}});
            const list: components['schemas']['PackingListView'] = {
                entityType: 'packing', id, title: 'E2E Core Packing List', description: null,
                headerUrl: null, headerVersion: null, orderToken: '"fixture-order"',
                currentEventId: linked ? profile.id : null, currentEventUrl: linked ? '/event/' + profile.id : null,
                archived: false, inheritedArchived: false,
                capabilities: {editTitle: false, editDescription: false, selfAssign: false,
                    addItem: false, reorder: false, manageSettings: true},
                counters: {participants: 0, open: 0, empty: 0}, items: [],
            };
            // Replace read delivery only. This exercises the actual built entry,
            // shared header, refresh state and feature adoption without a server.
            const refreshed = readGate();
            const refreshStarted = readGate();
            let holdRefresh = false;
            await page.route('**/api/v1/packing-lists/' + id, async route => {
                if (holdRefresh) { refreshStarted.release(); await refreshed.promise; }
                await route.fulfill({status: 200, contentType: 'application/json', headers: {
                    'X-Surveyor-Context': session.context!, ETag: '"header-fixture"'}, body: JSON.stringify(list)});
            });
            const entry = !linked ? await failStartupModule(page, /\/app\/assets\/entry-client-[^/]+\.js(?:\?|$)/u) : undefined;
            await page.goto(delivery.url, {waitUntil: entry ? 'commit' : 'load'});
            let initialHeaderHeight: number | undefined;
            if (entry) {
                await entry.started;
                initialHeaderHeight = (await page.locator('[data-frontend-initial-loading] .frontend-skeleton-page-header').boundingBox())!.height;
                await page.screenshot({path: testInfo.outputPath('entity-initial-skeleton.png'), animations: 'disabled'});
                entry.restore();
            }
            await waitForFrontendHydration(page);
            const title = page.locator('main .card-header h1');
            await expect(title).toHaveText(list.title);
            const header = page.locator('main > section > .card-header');
            const bounds = (await header.boundingBox())!;
            const heading = (await title.boundingBox())!;
            if (initialHeaderHeight !== undefined) expect(Math.abs(bounds.height - initialHeaderHeight)).toBeLessThan(1);
            expect(Math.abs(heading.x + heading.width / 2 - bounds.x - bounds.width / 2)).toBeLessThan(1);
            // Desktop actions share the heading; phone navigation and each
            // complete action use independent ordinary rows.
            if (width >= 768) {
                const lineHeight = await title.evaluate(element => Number.parseFloat(getComputedStyle(element).lineHeight));
                expect(heading.height).toBeLessThanOrEqual(lineHeight + 1);
                for (const control of await header.locator('a,button').all()) {
                    const action = (await control.boundingBox())!;
                    expect(Math.abs(action.y + action.height / 2 - heading.y - heading.height / 2)).toBeLessThan(1);
                }
            } else {
                if (linked) expect((await header.getByRole('link', {name: 'Go to event', exact: true}).boundingBox())!.width)
                    .toBeGreaterThanOrEqual(heading.width - 1);
                const settings = (await header.getByRole('button', {name: 'Entity settings', exact: true}).boundingBox())!;
                const refresh = header.getByRole('button', {name: 'Refresh', exact: true});
                await expectPhoneRefresh(refresh, heading.width, 'Refresh');
                expect(settings.width).toBeGreaterThanOrEqual(heading.width - 1);
                expect((await refresh.boundingBox())!.y).toBeGreaterThanOrEqual(settings.y + settings.height);
            }
            for (const button of await header.locator('button').all()) {
                await expect(button).toBeVisible();
                expect(await button.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
            }
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
            await page.screenshot({path: testInfo.outputPath('centered-entity-header.png'), animations: 'disabled'});
            const refresh = header.getByRole('button', {name: 'Refresh', exact: true});
            const original = await refresh.elementHandle();
            try {
                holdRefresh = true;
                await refresh.click();
                await refreshStarted.promise;
                await expect(refresh).toBeDisabled();
                expect(await original!.evaluate(node => node.isConnected)).toBe(true);
                refreshed.release();
                await expect(refresh).toBeEnabled();
                await expect(refresh).toBeFocused();
                expect(await original!.evaluate(node => node === document.querySelector('main .frontend-page-heading-actions button[aria-label="Refresh"]'))).toBe(true);
            } finally { refreshed.release(); await original!.dispose(); }
        });
    }
}

for (const locale of ['en', 'de'] as const) {
    for (const width of [1280, 390]) {
        for (const admin of [false, true]) {
            test(`headers without settings preserve approved balanced centering for ${admin ? 'administration' : 'ordinary view'} at ${width}px in ${locale}`, async ({page}, info) => {
                await page.setViewportSize({width, height: 900});
                const {delivery, event} = await startupEventDocument(page, locale, admin, 'Shared regional meeting', false);
                await page.goto(delivery.url);
                await waitForFrontendHydration(page);
                const header = page.locator('main > section > .card-header');
                const title = header.locator('h1');
                await expect(title).toContainText(event.title);
                await expect(header.getByRole('button', {
                    name: locale === 'en' ? 'Entity settings' : 'Entitätseinstellungen', exact: true,
                })).toHaveCount(0);
                const refreshName = locale === 'en' ? 'Refresh' : 'Aktualisieren';
                const refresh = header.getByRole('button', {name: refreshName, exact: true});
                await expect(refresh).toBeVisible();
                const bounds = (await header.boundingBox())!;
                const heading = (await title.boundingBox())!;
                const action = (await refresh.boundingBox())!;
                if (width >= 768) {
                    expect(Math.abs(action.y + action.height / 2 - heading.y - heading.height / 2)).toBeLessThan(1);
                    // The approved balanced heading contract also applies when
                    // no parent or settings action is available in either role.
                    expect(Math.abs(heading.x + heading.width / 2 - bounds.x - bounds.width / 2)).toBeLessThan(1);
                } else {
                    expect(action.y).toBeGreaterThanOrEqual(heading.y + heading.height);
                    await expectPhoneRefresh(refresh, bounds.width - 34, refreshName);
                }
                expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
                await page.screenshot({path: info.outputPath('balanced-header-without-settings.png'), animations: 'disabled'});
            });
        }
    }
}

for (const locale of ['en', 'de'] as const) {
    for (const width of [1280, 1024, 390, 320]) {
        test(`long Event administration title retains every independent action at ${width}px in ${locale}`, async ({page}, info) => {
            await page.setViewportSize({width, height: 900});
            const text = locale === 'en' ? 'A shared regional planning meeting with several groups and a complete programme'
                : 'Gemeinsames regionales Planungstreffen mit mehreren Gruppen und einem vollständigen Programm';
            const {delivery, event} = await startupEventDocument(page, locale, true, text);
            await page.goto(delivery.url);
            await waitForFrontendHydration(page);
            const header = page.locator('main > section > .card-header');
            const title = header.locator('h1');
            await expect(title).toContainText(event.title);
            const bounds = (await header.boundingBox())!;
            const heading = (await title.boundingBox())!;
            const settingsName = locale === 'en' ? 'Entity settings' : 'Entitätseinstellungen';
            const refreshName = locale === 'en' ? 'Refresh' : 'Aktualisieren';
            for (const name of [settingsName, refreshName]) {
                const control = header.getByRole('button', {name, exact: true});
                await expect(control).toBeVisible();
                const action = (await control.boundingBox())!;
                expect(action.x).toBeGreaterThanOrEqual(bounds.x);
                expect(action.x + action.width).toBeLessThanOrEqual(bounds.x + bounds.width);
                expect(action.y).toBeGreaterThanOrEqual(bounds.y);
                expect(action.y + action.height).toBeLessThanOrEqual(bounds.y + bounds.height);
                if (width >= 768) {
                    expect(heading.x + heading.width).toBeLessThanOrEqual(action.x + 1);
                    expect(Math.abs(action.y + action.height / 2 - heading.y - heading.height / 2)).toBeLessThan(1);
                } else {
                    expect(action.y).toBeGreaterThanOrEqual(heading.y + heading.height);
                    expect(action.width).toBeGreaterThanOrEqual(heading.width - 1);
                }
                expect(await control.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
            }
            if (width < 768) {
                const settings = (await header.getByRole('button', {name: settingsName, exact: true}).boundingBox())!;
                const refresh = header.getByRole('button', {name: refreshName, exact: true});
                await expectPhoneRefresh(refresh, heading.width, refreshName);
                expect((await refresh.boundingBox())!.y).toBeGreaterThanOrEqual(settings.y + settings.height);
            }
            const textInside = await title.evaluate(element => {
                const range = document.createRange();
                range.selectNodeContents(element);
                const bounds = element.getBoundingClientRect();
                return [...range.getClientRects()].every(rect => rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1);
            });
            expect(textInside).toBe(true);
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
            await page.screenshot({path: info.outputPath('event-admin-long-title.png'), animations: 'disabled'});
        });
    }
}

for (const locale of ['en', 'de'] as const) {
    for (const width of [1280, 390, 320]) {
        test(`Event registration keeps native choice columns and contained labels at ${width}px in ${locale}`, async ({page}, info) => {
            await page.setViewportSize({width, height: 900});
            const {delivery} = await startupEventDocument(page, locale, false);
            await page.goto(delivery.url);
            await waitForFrontendHydration(page);
            const grids = page.locator('main .frontend-choice-grid');
            await expect(grids).toHaveCount(3);
            await expect(grids.first().locator('input[type="checkbox"]')).toHaveCount(4);
            if (width === 390) {
                // Native meal words fit at the normal phone width. Unequal
                // intrinsic tracks must not split Vegetarian/Vegetarisch.
                for (const label of await grids.first().locator('label').all()) {
                    const lineCount = await label.evaluate(element => {
                        const range = document.createRange();
                        range.selectNodeContents(element);
                        return new Set([...range.getClientRects()].map(rect => Math.round(rect.top))).size;
                    });
                    expect(lineCount).toBe(1);
                }
            }
            const columns = width < 768 ? 3 : 4;
            for (const grid of await grids.all()) {
                const geometry = await grid.evaluate(element => {
                    const bounds = element.getBoundingClientRect();
                    const labels = [...element.querySelectorAll('label')].flatMap(label => {
                        const range = document.createRange();
                        range.selectNodeContents(label);
                        return [...range.getClientRects()].map(rect => ({left: rect.left, right: rect.right}));
                    });
                    return {left: bounds.left, right: bounds.right,
                        columns: getComputedStyle(element).gridTemplateColumns.split(/\s+/u).length,
                        rows: [...element.children].map(choice => choice.getBoundingClientRect().top),
                        controls: [...element.querySelectorAll('input')].map(input => {
                            const rect = input.getBoundingClientRect();
                            return {left: rect.left, right: rect.right};
                        }), labels};
                });
                expect(geometry.columns).toBe(columns);
                for (const rect of [...geometry.labels, ...geometry.controls]) {
                    expect(rect.left).toBeGreaterThanOrEqual(geometry.left - 1);
                    expect(rect.right).toBeLessThanOrEqual(geometry.right + 1);
                }
                for (const top of geometry.rows.slice(0, columns)) expect(Math.abs(top - geometry.rows[0]!)).toBeLessThan(1);
                if (geometry.rows.length > columns) expect(geometry.rows[columns]!).toBeGreaterThan(geometry.rows[0]!);
            }
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
            await page.screenshot({path: info.outputPath('event-registration-choice-grid.png'), animations: 'disabled'});
        });
    }
}

test('lazy navigation shows header progress without inserting a line above the current page', async ({page}) => {
    const delivery = await startupDocument(page, '/help?doc=fixture', {
        session: startupSession(), help: {locale: 'en', title: 'Retained source page', currentDoc: 'fixture.md',
            content: '<p>Readable source content.</p>', docsList: [], docsGroups: [], toc: []},
    });
    await page.goto(delivery.url);
    await waitForFrontendHydration(page);
    const entry = await failStartupModule(page, /\/app\/assets\/PackingCreatePage-[^/]+\.js(?:\?|$)/u);
    try {
        const source = page.locator('main > section');
        const before = (await source.boundingBox())!;
        await page.getByRole('button', {name: 'New', exact: true}).click();
        await page.locator('header a[href="/packing/create"]').click();
        await entry.started;
        await expect(page.locator('header .frontend-navigation-indicator .spinner-border')).toBeVisible();
        await expect(page.locator('main .frontend-navigation-loading')).toHaveAttribute('role', 'status');
        await expect(page.locator('main .frontend-navigation-loading')).toBeVisible();
        await expect(page.locator('main [data-loading-skeleton]')).toHaveCount(0);
        await expect(source.locator('h1')).toHaveText('Retained source page');
        expect((await source.boundingBox())!.y).toBe(before.y);
        entry.restore();
        await expect(page).toHaveURL(/\/packing\/create$/u);
        await expect(page.locator('header .frontend-navigation-indicator .spinner-border')).toHaveCount(0);
        expect(delivery.observed.documents).toBe(1);
    } finally { entry.restore(); }
});

for (const locale of ['en', 'de'] as const) {
    for (const width of [1280, 390, 576, 600, 767, 768]) {
        test(`profile roster skeleton keeps the actual balanced heading geometry at ${width}px in ${locale}`, async ({page}, testInfo) => {
            await page.setViewportSize({width, height: 900});
            const profile = {id: '11111111-1111-4111-8111-111111111111', name: 'Profile fixture', isDefault: true};
            const session: Session = {...startupSession(locale), kind: 'account', activeProfile: profile, profiles: [profile],
                context: 'profile-heading-context-1234567890', csrfToken: 'profile-heading-csrf-1234567890'};
            const delivery = await startupDocument(page, '/users/profile/manage', {session, pageEntry: {kind: 'render'}});
            const profiles: components['schemas']['ProfileManagement'] = {profiles: [profile], activeProfileId: profile.id};
            await page.route('**/api/v1/profiles', async route => {
                await route.fulfill({status: 200, contentType: 'application/json', headers: {
                    'X-Surveyor-Context': session.context!}, body: JSON.stringify(profiles)});
            });
            const entry = await failStartupModule(page, /\/app\/assets\/entry-client-[^/]+\.js(?:\?|$)/u);
            try {
                await page.goto(delivery.url, {waitUntil: 'commit'});
                await entry.started;
                const initial = (await page.locator('[data-frontend-initial-loading] .frontend-skeleton-page-header').boundingBox())!;
                await page.screenshot({path: testInfo.outputPath('profile-initial-skeleton.png'), animations: 'disabled'});
                entry.restore();
                await waitForFrontendHydration(page);
                const header = page.locator('main > section > .frontend-page-heading');
                const label = locale === 'en' ? 'Refresh' : 'Aktualisieren';
                const refresh = header.getByRole('button', {name: label, exact: true});
                await expect(refresh).toBeVisible();
                const loaded = (await header.boundingBox())!;
                if (width < 768) await expectPhoneRefresh(refresh, loaded.width - 32, label);
                else {
                    const heading = (await header.locator('h1').boundingBox())!;
                    const action = (await refresh.boundingBox())!;
                    expect(action.height).toBeLessThanOrEqual(32);
                    expect(Math.abs(action.y + action.height / 2 - heading.y - heading.height / 2)).toBeLessThan(1);
                }
                expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
                await page.screenshot({path: testInfo.outputPath('profile-loaded-header.png'), animations: 'disabled'});
                expect(Math.abs(loaded.height - initial.height)).toBeLessThan(1);
                // Mobile navigation intentionally collapses only after hydration;
                // header geometry must not add another shift within the page itself.
                if (width >= 992) expect(Math.abs(loaded.y - initial.y)).toBeLessThan(1);
            } finally { entry.restore(); }
        });
    }
}

for (const locale of ['en', 'de'] as const) {
    for (const width of [1280, 390]) {
        for (const family of ['packing', 'drivers', 'activity', 'event']) {
            test(`${family} creation keeps permission settings compact and retains edits at ${width}px in ${locale}`, async ({page}, info) => {
                await page.setViewportSize({width, height: 900});
                const profile = {id: '11111111-1111-4111-8111-111111111111', name: 'Creation fixture'};
                const session: Session = {...startupSession(locale), kind: 'account', activeProfile: profile, profiles: [profile],
                    context: 'creation-permissions-context-1234567890', csrfToken: 'creation-permissions-csrf-1234567890'};
                const definitions = {defaults: {participant: 1, guest: 0, authenticated: 0, public: 0}, presets: [],
                    permissions: [{key: 'ACCESS_VIEW', bit: 1}, {key: 'ITEM_ADD', bit: 2}, {key: 'EDIT_TITLE', bit: 4},
                        {key: 'MANAGE_PERMISSIONS', bit: 8}, {key: 'DATA_EXPORT', bit: 16}]};
                const delivery = await startupDocument(page, `/${family}/create?locale=${locale}`, {session,
                    pageEntry: {kind: 'render'}, packingCreateContext: definitions, driversCreateContext: definitions,
                    activityCreateContext: definitions, eventCreateContext: definitions});
                await page.goto(delivery.url);
                await waitForFrontendHydration(page);
                const settings = page.locator('[data-creation-permissions]');
                const toggle = settings.locator('button[aria-controls]');
                const panel = settings.locator('[role="region"]');
                await expect(settings).toHaveCount(1);
                await expect(toggle).toHaveAttribute('aria-expanded', 'false');
                await expect(panel).toBeHidden();
                const compact = (await settings.boundingBox())!;
                expect(compact.height).toBeLessThan(90);
                expect(compact.x).toBeGreaterThanOrEqual(0);
                expect(compact.x + compact.width).toBeLessThanOrEqual(width);
                await page.screenshot({path: info.outputPath('creation-permissions-collapsed.png'), fullPage: true, animations: 'disabled'});

                // Exercise the built shared matrix, rather than a replacement
                // control: hiding it must preserve its audience and actual node.
                await toggle.click();
                await expect(panel).toBeVisible();
                expect((await settings.boundingBox())!.height).toBeGreaterThan(compact.height + 150);
                await panel.locator('select').selectOption('guest');
                const permission = panel.locator('input[id$="-guest-ACCESS_VIEW"]');
                await permission.check();
                const original = await permission.elementHandle();
                try {
                    await toggle.click();
                    await expect(panel).toBeHidden();
                    expect((await settings.boundingBox())!.height).toBe(compact.height);
                    await toggle.click();
                    await expect(panel.locator('select')).toHaveValue('guest');
                    await expect(permission).toBeChecked();
                    expect(await original!.evaluate(node => node === document.getElementById(node.id))).toBe(true);
                    await expect(panel.locator(':invalid')).toHaveCount(0);
                    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
                    expect(delivery.observed.commands).toBe(0);
                } finally { await original!.dispose(); }
            });
        }
    }
}

test('reduced motion suppresses the actual pending picker spinner inside its portal dialog', async ({page}) => {
    const profile = {id: '11111111-1111-4111-8111-111111111111', name: 'Motion fixture'};
    const session: Session = {...startupSession(), kind: 'account', activeProfile: profile, profiles: [profile],
        context: 'motion-browser-context-1234567890', csrfToken: 'motion-browser-csrf-1234567890'};
    const option: components['schemas']['EventPickerOption'] = {
        id: '22222222-2222-4222-8222-222222222222', title: 'Selectable fixture event', description: null,
        startDate: '2026-10-23', endDate: '2026-10-24', archived: false, deadlinePassed: false,
    };
    const delivery = await startupDocument(page, '/packing/create', {session,
        pageEntry: {kind: 'render'}, packingCreateContext: {
            defaults: {participant: 0, guest: 0, authenticated: 0, public: 0}, permissions: [], presets: [],
        }});
    const received = readGate();
    const held = readGate();
    const completed = readGate();
    const pattern = '**/api/v1/packing-lists/events?*';
    await page.route(pattern, deliverOptions);

    // Keep the real built AppDialog, ActionButton, provider and query owners.
    // Only synthetic read delivery is held; this client layer has no backend.
    async function deliverOptions(route: Route): Promise<void> {
        const next = new URL(route.request().url()).searchParams.has('cursor');
        try {
            if (next) { received.release(); await held.promise; }
            await route.fulfill({status: 200, contentType: 'application/json',
                headers: {'X-Surveyor-Context': session.context!},
                body: JSON.stringify({items: [option], selected: null, nextCursor: next ? null : 'motion-next'})});
        } finally { if (next) completed.release(); }
    }

    try {
        await page.goto(delivery.url);
        await waitForFrontendHydration(page);
        await page.locator('#create-event-button').click();
        const dialog = page.getByRole('dialog');
        const next = dialog.getByRole('button', {name: 'Next page', exact: true});
        await expect(next).toBeEnabled();
        await page.emulateMedia({reducedMotion: 'reduce'});
        await next.click();
        await received.promise;
        await expect(next).toBeDisabled();
        await expect(next).toHaveAttribute('aria-busy', 'true');
        const spinner = next.locator('.spinner-border');
        await expect(spinner).toBeVisible();
        expect(await spinner.evaluate(element => element.closest('.frontend-app') === null)).toBe(true);
        expect(await spinner.evaluate(element => getComputedStyle(element).animationName)).toBe('none');
        held.release();
        await completed.promise;
        await expect(dialog.getByRole('button', {name: 'Previous page', exact: true})).toBeEnabled();
        expect(delivery.observed.commands).toBe(0);
    } finally {
        held.release();
        await page.unroute(pattern, deliverOptions);
    }
});

test('initial startup retains editable static Help search and recovers only after one accepted discard confirmation', async ({page}) => {
    const help: components['schemas']['HelpPageData'] = {locale: 'en', title: 'Synthetic Help',
        content: '<h2 id="task">Synthetic task</h2>', currentDoc: 'fixture.md', docsList: [], docsGroups: [], toc: []};
    const delivery = await startupDocument(page, '/help', {session: startupSession(), help});
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
        const recovery = page.locator('#surveyor-frontend-startup-recovery');
        await expect(recovery).toBeVisible();
        await settleStartup(page);
        expect(delivery.observed.documents).toBe(1);
        expect(delivery.observed.commands).toBe(0);
        await expect(search).toHaveValue('Retained startup search');
        expect(await original!.evaluate(node => node === document.getElementById('frontend-help-search'))).toBe(true);
        await expect(page.locator('#surveyor-frontend')).not.toHaveAttribute('data-frontend-hydrated', 'true');

        await recovery.getByRole('button', {name: 'Refresh page', exact: true}).click();
        expect(dialogs).toEqual(['confirm']);
        await expect(search).toHaveValue('Retained startup search');
        expect(await original!.evaluate(node => node === document.getElementById('frontend-help-search'))).toBe(true);
        expect(delivery.observed.documents).toBe(1);

        // Restoring a chunk does not retry a form. Only a separate accepted
        // recovery replaces this document, and beforeunload must not ask twice.
        module.restore();
        accept = true;
        await recovery.getByRole('button', {name: 'Refresh page', exact: true}).click();
        await waitForFrontendHydration(page);
        expect(dialogs).toEqual(['confirm', 'confirm']);
        expect(delivery.observed.documents).toBe(2);
        expect(delivery.observed.commands).toBe(0);
        await expect(search).toHaveValue('');
        // The shell now owns one permanent SSR/client notice below navigation.
        // Successful guarded reload hides that same presentation; it does not
        // remove/recreate the notice or introduce another recovery control.
        await expect(recovery).toBeHidden();
        await expect(page.locator('#surveyor-frontend')).toHaveAttribute('data-frontend-hydrated', 'true');
        await expect(page.locator('#surveyor-frontend-javascript-required')).toHaveCount(1);
        await expect(page.locator('[data-frontend-startup-reload]')).toHaveCount(1);
        await original!.dispose();
    } finally { module.restore(); page.off('dialog', answerRecovery); }
});

test('initial startup reloads a pristine dynamic route once and permits deliberate recovery from its stored marker', async ({page}) => {
    const delivery = await startupDocument(page, '/users/dashboard', {session: startupSession()});
    const module = await failStartupModule(page, /\/app\/assets\/OverviewPage-[^/]+\.js(?:\?|$)/u);
    try {
        await page.goto(delivery.url, {waitUntil: 'commit'});
        await module.started;
        await expect(page.locator('[data-frontend-initial-loading]')).toBeVisible();
        await expect(page.locator('main form, main input')).toHaveCount(0);
        module.fail();
        const recovery = page.locator('#surveyor-frontend-startup-recovery');
        await expect.poll(() => delivery.observed.documents).toBe(2);
        await expect(recovery).toBeVisible();
        await settleStartup(page);
        expect(delivery.observed.documents).toBe(2);
        expect(delivery.observed.commands).toBe(0);
        await expect(page.locator('#surveyor-frontend')).not.toHaveAttribute('data-frontend-hydrated', 'true');

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
        await waitForFrontendHydration(page);
        expect(dialogs).toEqual([]);
        expect(delivery.observed.documents).toBe(3);
        expect(delivery.observed.commands).toBe(0);
        page.off('dialog', recordUnexpectedDialog);
    } finally { module.restore(); }
});

test('initial startup never automatically reopens token issuance and permits deliberate recovery', async ({page}) => {
    const delivery = await startupDocument(page, '/users/profile/migrate/request', {
        session: startupSession(), profileWorkflow: {kind: 'token', token: 'synthetic-private-transfer-token'},
    });
    const module = await failStartupModule(page, /\/app\/assets\/ProfileWorkflowPage-[^/]+\.js(?:\?|$)/u);
    try {
        await page.goto(delivery.url, {waitUntil: 'commit'});
        await module.started;
        module.fail();
        const recovery = page.locator('#surveyor-frontend-startup-recovery');
        await expect(recovery).toBeVisible();
        await settleStartup(page);
        expect(delivery.observed.documents).toBe(1);
        expect(delivery.observed.commands).toBe(0);
        await expect(page.locator('#surveyor-frontend')).not.toHaveAttribute('data-frontend-hydrated', 'true');

        // This real URL issues a replacement token on document GET. The fixture
        // counts navigation only; it does not claim backend token persistence.
        // Deliberate recovery still follows that native document boundary once.
        module.restore();
        await recovery.getByRole('button', {name: 'Refresh page', exact: true}).click();
        await waitForFrontendHydration(page);
        expect(delivery.observed.documents).toBe(2);
        expect(delivery.observed.commands).toBe(0);
    } finally { module.restore(); }
});

test('a hydrated Packing denial retains its static document through a detected release', async ({page}) => {
    const session = startupSession();
    const delivery = await startupDocument(page,
        '/packing/22222222-2222-4222-8222-222222222222', {session, packingError: 'packing.notFound'});
    await page.goto(delivery.url);
    await waitForFrontendHydration(page);
    const denial = page.locator('main').getByText('packing not found', {exact: true});
    await expect(denial).toBeVisible();
    await expect(page.locator('[data-frontend-initial-loading]')).toHaveCount(0);

    // Change only the ordinary session read's deployment projection. The actual
    // browser context observes that release after a mounted denial has retired
    // bootstrap; this exercises the lifecycle an unmounted route test cannot.
    await page.route('**/api/v1/session', async function deliverReplacementSession(route): Promise<void> {
        await route.fulfill({status: 200, contentType: 'application/json', headers: session.context === null ? {} : {
            'X-Surveyor-Context': session.context}, body: JSON.stringify({...session,
                deployment: {...session.deployment, buildId: 'mounted-denial-replacement'}})});
    });
    await page.evaluate(function resumeSession(): void { window.dispatchEvent(new Event('focus')); });
    const recovery = page.locator('#surveyor-frontend').getByRole('button', {name: 'Refresh page', exact: true});
    await expect(recovery).toBeVisible();
    await settleStartup(page);
    expect(delivery.observed.documents).toBe(1);
    await expect(denial).toBeVisible();

    // Static classification leaves deliberate document recovery available.
    // This remains isolated client evidence and makes no persistence claim.
    await recovery.click();
    await waitForFrontendHydration(page);
    await expect(denial).toBeVisible();
    expect(delivery.observed.documents).toBe(2);
});

test('initial startup offers deliberate recovery without looping when attempt storage is inaccessible', async ({page}) => {
    await page.addInitScript(function denyStartupStorage(): void {
        Object.defineProperty(window, 'sessionStorage', {configurable: true,
            get: function unavailableAttemptStorage(): never { throw new Error('Fixture storage access denied'); }});
    });
    const delivery = await startupDocument(page, '/users/login', {session: startupSession()});
    const module = await failStartupModule(page, /\/app\/assets\/IdentityPage-[^/]+\.js(?:\?|$)/u);
    try {
        await page.goto(delivery.url, {waitUntil: 'commit'});
        await module.started;
        module.fail();
        const recovery = page.locator('#surveyor-frontend-startup-recovery');
        await expect(recovery).toBeVisible();
        await settleStartup(page);
        expect(delivery.observed.documents).toBe(1);
        expect(delivery.observed.commands).toBe(0);
        module.restore();
        await recovery.getByRole('button', {name: 'Refresh page', exact: true}).click();
        await waitForFrontendHydration(page);
        expect(delivery.observed.documents).toBe(2);
        expect(delivery.observed.commands).toBe(0);
    } finally { module.restore(); }
});

test('initial startup exposes localized recovery before context creation when the Help validator fails', async ({page}) => {
    const session = startupSession('de');
    const help: components['schemas']['HelpPageData'] = {locale: 'de', title: 'Synthetische Hilfe',
        content: '<h2 id="task">Synthetische Aufgabe</h2>', currentDoc: 'fixture.md', docsList: [], docsGroups: [], toc: []};
    const delivery = await startupDocument(page, '/help', {session, help});
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
        const recovery = page.locator('#surveyor-frontend-startup-recovery');
        await expect(recovery).toContainText('Diese Seite konnte nicht vollständig geladen werden.');
        await expectStartupNoticeBelowHeader(page);
        await expect(recovery.getByRole('button', {name: 'Seite neu laden', exact: true})).toBeVisible();
        await expect(page.locator('html')).toHaveAttribute('lang', 'de');
        await expect(search).toHaveValue('Behaltene Suchanfrage');
        expect(delivery.observed.documents).toBe(1);
        expect(delivery.observed.commands).toBe(0);
        module.restore();
        await recovery.getByRole('button').click();
        await waitForFrontendHydration(page);
        expect(dialogs).toEqual(['confirm']);
        expect(delivery.observed.documents).toBe(2);
        expect(delivery.observed.commands).toBe(0);
        await expect(search).toHaveValue('');
    } finally { module.restore(); page.off('dialog', acceptValidatorRecovery); }
});

test('initial startup never exposes inactive creation controls when its bootstrap validator fails', async ({page}) => {
    const packingCreateContext: components['schemas']['PackingCreateContext'] = {
        defaults: {participant: 0, guest: 0, authenticated: 0, public: 0}, permissions: [], presets: []};
    const delivery = await startupDocument(page, '/packing/create', {
        session: startupSession(), pageEntry: {kind: 'render'}, packingCreateContext});
    const module = await failStartupModule(page, /\/app\/assets\/validatePackingCreateContext-[^/]+\.js(?:\?|$)/u);
    try {
        await page.goto(delivery.url, {waitUntil: 'commit'});
        await module.started;
        await expect(page.locator('[data-frontend-initial-loading]')).toBeVisible();
        await expect(page.locator('main form, main input')).toHaveCount(0);
        module.fail();
        const recovery = page.locator('#surveyor-frontend-startup-recovery');
        await expect(recovery).toBeVisible();
        await expect(page.locator('#surveyor-frontend-javascript-required')).toContainText('Interactive features on this site require JavaScript.');
        await expect(page.locator('[data-frontend-initial-loading]')).toBeHidden();
        await settleStartup(page);
        expect(delivery.observed.documents).toBe(1);
        expect(delivery.observed.commands).toBe(0);
        await expect(page.locator('main form, main input')).toHaveCount(0);
        await expect(page.locator('#surveyor-frontend')).not.toHaveAttribute('data-frontend-hydrated', 'true');
    } finally { module.restore(); }
});

test('initial startup shows an independent notice when the module entry cannot load and offers safe Help navigation', async ({page}) => {
    const delivery = await startupDocument(page, '/users/login', {session: startupSession()});
    const module = await failStartupModule(page, /\/app\/assets\/entry-client-[^/]+\.js(?:\?|$)/u);
    try {
        await page.goto(delivery.url, {waitUntil: 'commit'});
        await module.started;
        await expect(page.locator('[data-frontend-initial-loading]')).toBeVisible();
        module.fail();
        const notice = page.locator('#surveyor-frontend-javascript-required');
        await expect(notice).toBeVisible();
        await expectStartupNoticeBelowHeader(page);
        await expect(notice).toContainText('Interactive features on this site require JavaScript.');
        await expect(notice.getByRole('link', {name: 'Help', exact: true})).toHaveAttribute('href', '/help?locale=en');
        await expect(notice.getByRole('button')).toHaveCount(0);
        await expect(page.locator('[data-frontend-initial-loading]')).toBeHidden();
        await expect(page.locator('main form, main input')).toHaveCount(0);
        await expect(page.locator('#frontend-locale')).toBeDisabled();
        await expect(page.locator('#frontend-navbar-main')).toBeVisible();
        await settleStartup(page);
        expect(delivery.observed.documents).toBe(1);
    } finally { module.restore(); }
});

test('initial startup ends loading with a notice when entry initialization never starts', async ({page}) => {
    await page.clock.install();
    const delivery = await startupDocument(page, '/users/login', {session: startupSession()});
    const module = await failStartupModule(page, /\/app\/assets\/entry-client-[^/]+\.js(?:\?|$)/u);
    try {
        await page.goto(delivery.url, {waitUntil: 'commit'});
        await module.started;
        await expect(page.locator('[data-frontend-initial-loading]')).toBeVisible();
        await page.clock.runFor(15_001);
        await expect(page.locator('#surveyor-frontend-javascript-required')).toBeVisible();
        await expectStartupNoticeBelowHeader(page);
        await expect(page.locator('[data-frontend-initial-loading]')).toBeHidden();
        expect(delivery.observed.documents).toBe(1);
        expect(delivery.observed.commands).toBe(0);
        // A late successful entry retires the same notice without a reload or
        // replacing its SSR node after the independent deadline already fired.
        const originalNotice = await page.locator('#surveyor-frontend-javascript-required').elementHandle();
        module.restore();
        await waitForFrontendHydration(page);
        await expect(page.locator('#surveyor-frontend-javascript-required')).toBeHidden();
        expect(await originalNotice!.evaluate(element => element === document.getElementById('surveyor-frontend-javascript-required'))).toBe(true);
        await originalNotice!.dispose();
    } finally { module.restore(); }
});

test('a blocked inline monitor keeps safe fallback below navigation until the real entry hydrates', async ({page}) => {
    const help: components['schemas']['HelpPageData'] = {locale: 'en', title: 'Synthetic Help',
        content: '<h2>Readable task</h2>', currentDoc: 'fixture.md', docsList: [], docsGroups: [], toc: []};
    // Only the response's script policy blocks the inline monitor. The actual
    // external entry and all later production modules retain their normal origin.
    const delivery = await startupDocument(page, '/help', {session: startupSession(), help},
        {'Content-Security-Policy': "script-src 'self'"});
    const module = await failStartupModule(page, /\/app\/assets\/entry-client-[^/]+\.js(?:\?|$)/u);
    const hydrationErrors: string[] = [];
    page.on('console', message => {if (/hydration|mismatch/iu.test(message.text())) hydrationErrors.push(message.text());});
    try {
        await page.goto(delivery.url, {waitUntil: 'commit'});
        await module.started;
        await expectStartupNoticeBelowHeader(page);
        await expect(page.locator('#surveyor-frontend')).not.toHaveAttribute('data-frontend-startup-observed');
        await expect(page.locator('[data-frontend-startup-reload]')).toBeHidden();
        await expect(page.locator('.frontend-refresh-button')).toBeHidden();
        const search = page.getByRole('searchbox');
        await search.fill('Retained while startup waits');
        const original = await search.elementHandle();
        module.restore();
        await waitForFrontendHydration(page);
        await expect(page.locator('#surveyor-frontend-javascript-required')).toBeHidden();
        await expect(search).toHaveValue('Retained while startup waits');
        expect(await original!.evaluate(element => element === document.getElementById('frontend-help-search'))).toBe(true);
        await original!.dispose();
        expect(hydrationErrors).toEqual([]);
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
        content: '<h2 id="task">Readable task</h2><a href="/help?doc=second&amp;locale=en">Next Help topic</a>',
        currentDoc: 'fixture.md', docsList: [], docsGroups: [], toc: []};
    const delivery = await startupDocument(page, '/help', {session: startupSession(), help});
    await page.goto(delivery.url, {waitUntil: 'domcontentloaded'});
    await expect(page.locator('#surveyor-frontend-startup-recovery')).toBeVisible();
    await expect(page.locator('#surveyor-frontend')).not.toHaveAttribute('data-frontend-hydrated', 'true');
    await expect(page.locator('#frontend-locale')).toBeDisabled();
    await expect(page.locator('.help-content')).toContainText('Readable task');
    await page.getByRole('link', {name: 'Next Help topic', exact: true}).click();
    await expect(page).toHaveURL(/\/help\?doc=second&locale=en$/u);
    await expect(page.locator('#surveyor-frontend-startup-recovery')).toBeVisible();
    expect(delivery.observed.documents).toBe(2);

    const dialogs: string[] = [];
    page.on('dialog', acceptNativeSearchDeparture);
    async function acceptNativeSearchDeparture(dialog: Dialog): Promise<void> {
        dialogs.push(dialog.type());
        await dialog.accept();
    }
    await page.getByRole('searchbox').fill('A retained native search');
    await page.getByRole('search').getByRole('button').click();
    await expect(page).toHaveURL(/\/help\?locale=en&q=A\+retained\+native\+search$/u);
    await expect(page.locator('#surveyor-frontend-startup-recovery')).toBeVisible();
    expect(delivery.observed.documents).toBe(3);
    expect(dialogs).toEqual(['beforeunload']);
    expect(delivery.observed.commands).toBe(0);
    page.off('dialog', acceptNativeSearchDeparture);
});

for (const width of [1280, 390]) {
    test(`reorder insertion markers show the pointer edge before release at ${width}px`, async ({page}, testInfo) => {
        await page.setViewportSize({width, height: 900});
        const id = '22222222-2222-4222-8222-222222222222';
        const profile = {id: '11111111-1111-4111-8111-111111111111', name: 'Reorder fixture'};
        const session: Session = {...startupSession(), kind: 'account', activeProfile: profile, profiles: [profile],
            context: 'reorder-browser-context-1234567890', csrfToken: 'reorder-browser-csrf-1234567890'};
        const delivery = await startupDocument(page, '/packing/' + id, {session, pageEntry: {kind: 'render'}});
        const firstId = '33333333-3333-4333-8333-333333333333';
        const lastId = '44444444-4444-4444-8444-444444444444';
        const list: components['schemas']['PackingListView'] = {
            entityType: 'packing', id, title: 'Equipment order', description: null,
            headerUrl: null, headerVersion: null, orderToken: '"fixture-order"', currentEventId: null, currentEventUrl: null,
            archived: false, inheritedArchived: false, counters: {participants: 0, open: 2, empty: 2},
            capabilities: {editTitle: false, editDescription: false, selfAssign: false, addItem: false, reorder: true, manageSettings: false},
            items: [firstId, lastId].map((itemId, position) => ({id: itemId, title: position ? 'Stove' : 'Lantern',
                description: 'Camp equipment', maxAssignees: 1, assignedCount: 0, selfAssigned: false, assignees: [],
                requiredByAll: false, position, editToken: '"edit-reorder-item"',
                capabilities: {editTitle: false, editDescription: false, editCapacity: false,
                    showTitleEdit: false, showCapacityEdit: false, removeItem: false, removeAssignments: false, editRequired: false}})),
        };
        expect(validatePackingListView(list), JSON.stringify(validatePackingListView.errors)).toBe(true);
        // Only substitute admitted HTTP reads. Real built Vue handlers and CSS
        // own the gesture, and cancellation must never dispatch a command.
        await page.route('**/api/v1/packing-lists/' + id, async route => {
            await route.fulfill({status: 200, contentType: 'application/json',
                headers: {'X-Surveyor-Context': session.context!, ETag: '"reorder-fixture"'}, body: JSON.stringify(list)});
        });
        await page.goto(delivery.url);
        await waitForFrontendHydration(page);
        const first = page.locator('[data-item-id="' + firstId + '"]');
        const last = page.locator('[data-item-id="' + lastId + '"]');
        await first.scrollIntoViewIfNeeded();
        const before = (await last.boundingBox())!;
        const source = (await first.locator('td').nth(1).boundingBox())!;
        const destination = (await last.locator('td').nth(1).boundingBox())!;
        const x = source.x + 20;
        const y = source.y + source.height / 2;
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.move(x + 12, y + 8, {steps: 5});
        await page.mouse.move(destination.x + 20, destination.y + 8, {steps: 8});
        await page.mouse.move(destination.x + 21, destination.y + 9);
        await expect(last).toHaveClass(/frontend-reorder-before/u);
        await page.mouse.move(destination.x + 20, destination.y + destination.height - 8, {steps: 6});
        await expect(last).toHaveClass(/frontend-reorder-after/u);
        expect(await last.locator('td').first().evaluate(cell => getComputedStyle(cell).boxShadow)).toContain('0px -3px');
        const preview = (await last.boundingBox())!;
        expect(preview).toEqual(before);
        const screenshot = testInfo.outputPath('reorder-after-edge.png');
        await page.screenshot({path: screenshot, animations: 'disabled'});
        await testInfo.attach('reorder-after-edge', {path: screenshot, contentType: 'image/png'});
        expect(delivery.observed.commands).toBe(0);
        await page.keyboard.press('Escape');
        await page.mouse.up();
        await expect(page.locator('.frontend-reorder-before, .frontend-reorder-after, .frontend-reorder-dragging')).toHaveCount(0);
        expect(delivery.observed.commands).toBe(0);
    });
}

for (const width of [390, 1280]) {
    test(`Help retains native table words and column sizing with local overflow at ${width}px`, async ({page}, info) => {
        const {renderTrustedHelpMarkdown} = await import(pathToFileURL(resolve('dist/backend/controller/helpController.js')).href) as
            typeof import('../../../src/backend/controller/helpController');
        // Synthetic tables cover plain prose, emphasized first cells and wide
        // data without coupling application checks to maintained Help articles.
        // Both stylesheets render the same trusted Markdown and frame.
        const patterns = [
            '| Method | What you use | First-time setup |\n|---|---|---|\n'
                + '| Local account | A saved username and secret phrase | Enter the details to continue. |\n'
                + '| Organization sign-in | An external provider account | Follow the sign-in steps. |',
            '| State | Who sees it | When you return |\n|---|---|---|\n'
                + '| A shared title and **Group** setting | Everyone with access | The saved values reappear. |\n'
                + '| **Checked?** and a row highlight | This example browser | The local selection reappears. |',
            '| Field | What to enter |\n|---|---|\n'
                + '| **Name** | A short name for this example. |\n'
                + '| **Capacity** | A positive whole number. |',
            '| List state | Participants | Drivers | Explanation |\n|---|---|---|---|\n'
                + '| Example offers | 2 | 3 | The displayed values describe the example rows. |\n'
                + '| Another example | 4 | 5 | Read the complete explanation beside these values. |',
            '| Visible status | How it starts | What happens next | Included costs? |\n|---|---|---|---|\n'
                + '| **Unreviewed** | An example entry is added. | A coordinator reviews the example entry. | No. |\n'
                + '| **Completed** | The example has been reviewed. | Its saved information remains available. | Yes. |',
            '| Preset | Permissions selected |\n|---|---|\n'
                + '| **Limited** | Edit the example title and description. |\n'
                + '| **Complete** | Edit the example and manage its assignments. |',
        ];
        const articleTables = patterns.map(markdown => renderTrustedHelpMarkdown(markdown, 'Help table fixture').content).join('\n');
        // A future authored code value can exceed an ordinary word's intrinsic
        // width. It uses the same local boundary without a code-only size floor.
        const codeTable = renderTrustedHelpMarkdown('| Setting | Description |\n|---|---|\n'
            + '| `AN_EXTENDED_CONFIGURATION_VALUE` | A readable description beside a complete code value. |',
            'Help table fixture').content;
        const delivery = await startupDocument(page, '/help?doc=fixture', {
            session: startupSession(), help: {locale: 'en', title: 'Help table comparison', currentDoc: 'fixture.md',
                content: articleTables + codeTable, docsList: [], docsGroups: [], toc: [{id: 'tables', title: 'Tables', level: 2}]},
        });
        await page.setViewportSize({width, height: 900});
        await page.goto(delivery.url);
        await waitForFrontendHydration(page);
        const tables = page.locator('.help-content table');
        await expect(tables).toHaveCount(patterns.length + 1);
        const copied = await tables.evaluateAll(elements => elements.map(table => ({
            viewport: table.clientWidth, content: table.scrollWidth,
            columns: [...table.querySelectorAll('thead th')].map(cell => cell.getBoundingClientRect().width),
            rows: [...table.querySelectorAll('tr')].map(row => row.getBoundingClientRect().height),
        })));
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        if (width < 768) {
            // Ordinary field/state tables remain visible together. Wider native
            // words retain their width and the last column is reachable locally.
            for (const index of [0, 1, 2, 5]) expect(copied[index]!.content - copied[index]!.viewport,
                `Fitting synthetic table ${index}`).toBeLessThanOrEqual(6);
            for (const index of [3, 4, 6]) {
                expect(copied[index]!.content).toBeGreaterThan(copied[index]!.viewport + 20);
                const table = tables.nth(index);
                await table.evaluate(element => { element.scrollLeft = element.scrollWidth; });
                const rightEdge = await table.evaluate(element => ({viewport: element.getBoundingClientRect().right,
                    last: element.querySelector('thead th:last-child')!.getBoundingClientRect().right}));
                expect(rightEdge.last).toBeLessThanOrEqual(rightEdge.viewport + 1);
                await table.evaluate(element => { element.scrollLeft = 0; });
            }
        }
        await page.screenshot({path: info.outputPath('help-natural-tables.png'), fullPage: true, animations: 'disabled'});

    });
}

test.describe('JavaScript unavailable', () => {
    test.use({javaScriptEnabled: false});

    for (const locale of ['en', 'de'] as const) {
        for (const width of [1280, 390]) {
            test(`localized fallback follows navigation without dead Refresh controls at ${width}px in ${locale}`, async ({page}) => {
                const help: components['schemas']['HelpPageData'] = {locale, title: 'Synthetic Help',
                    content: '<h2>Readable task</h2>', currentDoc: 'fixture.md', docsList: [], docsGroups: [], toc: []};
                const delivery = await startupDocument(page, '/help', {session: startupSession(locale), help});
                await page.setViewportSize({width, height: 900});
                await page.goto(delivery.url, {waitUntil: 'domcontentloaded'});
                await expectStartupNoticeBelowHeader(page);
                await expect(page.locator('.frontend-refresh-button')).toBeHidden();
                await expect(page.locator('[data-frontend-startup-reload]')).toBeHidden();
                await expect(page.locator('.help-content')).toContainText('Readable task');
                await expect(page.getByRole('search')).toHaveAttribute('method', 'get');
                await expect(page.getByRole('searchbox')).toBeEditable();
                await expect(page.getByRole('search').getByRole('button')).toBeEnabled();
                expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
                expect(delivery.observed.commands).toBe(0);
            });
        }
    }

    for (const width of [390, 1280]) {
        test(`built application styles are delivered before JavaScript at ${width}px`, async ({page}, testInfo) => {
            const help: components['schemas']['HelpPageData'] = {locale: 'en', title: 'Stylesheet comparison',
                content: '<h2 id="task">Styled before initialization</h2><p>A readable article with ordinary links and a table.</p>'
                    + '<table><thead><tr><th>Setting</th><th>Description</th></tr></thead><tbody><tr>'
                    + '<td><code>AN_EXTENDED_CONFIGURATION_VALUE</code></td><td>Preserved dark-theme article geometry.</td>'
                    + '</tr></tbody></table><h3>Following section</h3><p>Content after the table remains readable.</p>',
                currentDoc: 'fixture.md', docsList: [], docsGroups: [], toc: [{id: 'task', title: 'Styled before initialization', level: 2}]};
            const delivery = await startupDocument(page, '/help', {session: startupSession(), help});
            await page.setViewportSize({width, height: 900});
            await page.goto(delivery.url, {waitUntil: 'networkidle'});
            await expect(page.locator('.help-content h2')).toBeVisible();
            await expect(page.locator('#surveyor-frontend')).not.toHaveAttribute('data-frontend-hydrated', 'true');
            const applicationStyles = page.locator('link[rel="stylesheet"][href^="/app/"]');
            expect(await applicationStyles.count()).toBeGreaterThan(0);
            await expectLocalIconReady(page);
            await page.screenshot({path: testInfo.outputPath('copied-styles.png'),
                fullPage: true, animations: 'disabled', caret: 'hide'});

            // Built CSS must already style the SSR content before any client code.
            await expect(page.locator('.help-content h2')).toHaveCSS('font-weight', '600');
            expect(await page.locator('.help-content').evaluate(element => element.getBoundingClientRect().width)).toBeGreaterThan(0);
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
            expect(delivery.observed.nativeStyles).toBe(0);
        });
    }

    test('initial startup keeps static Help search/navigation and disabled client controls without any executed script', async ({page}) => {
        const help: components['schemas']['HelpPageData'] = {locale: 'en', title: 'Synthetic Help',
            content: '<h2 id="task">Readable without JavaScript</h2>', currentDoc: 'fixture.md', docsList: [], docsGroups: [], toc: []};
        const delivery = await startupDocument(page, '/help', {session: startupSession(), help});
        await page.setViewportSize({width: 390, height: 844});
        await page.goto(delivery.url, {waitUntil: 'domcontentloaded'});
        await expect(page.locator('#surveyor-frontend-javascript-required')).toBeVisible();
        await expectStartupNoticeBelowHeader(page);
        await expect(page.locator('.frontend-refresh-button')).toBeHidden();
        await expect(page.locator('.help-content')).toContainText('Readable without JavaScript');
        await expect(page.getByRole('search')).toHaveAttribute('method', 'get');
        await expect(page.getByRole('search')).toHaveAttribute('action', '/help');
        await expect(page.getByRole('searchbox')).toBeEditable();
        await expect(page.getByRole('search').getByRole('button')).toBeEnabled();
        await expect(page.locator('#frontend-navbar-main')).toBeVisible();
        await expect(page.locator('.navbar-toggler')).toHaveCount(0);
        await expect(page.locator('#frontend-locale')).toBeDisabled();
        await page.locator('details').filter({hasText: 'New'}).locator('summary').click();
        await expect(page.getByRole('link', {name: 'Survey', exact: true})).toBeVisible();
        await expect(page.locator('#surveyor-frontend')).not.toHaveAttribute('data-frontend-hydrated', 'true');
        expect(delivery.observed.commands).toBe(0);
    });
});

test('client startup preserves an explicitly supplied recovery completion and retires it after committed departure', async ({page}) => {
    const session = startupSession();
    const url = '/guest/recovery';
    const delivery = await startupDocument(page, url, {session, pageCompletion: {context: session.context,
        destination: url, messageKey: 'auth.recoverySent', kind: 'success'}});
    await page.goto(delivery.url, {waitUntil: 'domcontentloaded'});
    await waitForFrontendHydration(page);
    await expect(page.getByRole('heading', {name: 'Success', exact: true})).toBeVisible();
    await expect(page.locator('main')).toContainText('The link(s) to your guest account(s) have been sent to your email address.');
    await expect(page.locator('main form')).toHaveCount(0);
    await expect(page).toHaveURL(/\/guest\/recovery$/);

    await page.locator('header').getByRole('link', {name: 'Home', exact: true}).click();
    await expect(page).toHaveURL(/\/$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/users\/login$/);
    await expect(page.getByRole('heading', {name: 'Login', exact: true})).toBeVisible();
});

test('client startup preserves the native expired-session notice', async ({page}) => {
    const session = startupSession();
    const delivery = await startupDocument(page, '/users/login', {session,
        pageNotice: {kind: 'error', messageKey: 'auth.sessionExpired'}});
    await page.goto(delivery.url, {waitUntil: 'domcontentloaded'});
    await waitForFrontendHydration(page);
    await expect(page.locator('main .alert-danger')).toContainText('Session has expired');
    await expect(page.getByRole('heading', {name: 'Login', exact: true})).toBeVisible();
});

/** Extreme ledger data belongs at this isolated rendering boundary: no account,
 * persisted financial state or server command is manufactured for a layout test.
 * The shared built-document fixture still owns SSR, assets and denied commands. */
async function startupFinanceDocument(page: Page, admin: boolean) {
    const {delivery, event, session} = await startupEventDocument(page, 'en', admin, 'Finance layout fixture', false);
    event.capabilities.manageAssignments = admin;
    event.hasInvoicePools = true;
    event.registration = {id: '1', arrivalDate: event.startDate, departureDate: event.endDate,
        dietary: ['MEAT'], allergyNotes: '', dietComment: ''};
    const payer = 'LongPayerName'.repeat(15);
    const note = 'A saved calculation note with unbroken content: ' + 'LongReceiptNote'.repeat(20);
    const amount = '-99999999.99';
    const pool: components['schemas']['FinancePool'] = {
        id: '33333333-3333-4333-8333-333333333333', name: 'Shared travel', description: null,
        status: 'CLOSED', isDefault: false, needsRecalculation: false, hasPendingTakeovers: false,
        coverageKnown: true, coverageGroups: [], pendingCoverageGroups: [], assignedCount: 1, assignAll: true,
        revision: 1, canSubmit: false, summary: null, calculation: null, exampleCalculation: null,
    };
    const share: components['schemas']['FinanceShare'] = {id: '1', poolId: pool.id, poolName: pool.name,
        payerName: payer, notes: [note], needsRecalculation: false, amount, status: 'settled', statusLabel: 'Refunded',
        isPaid: true, caption: 'Refunded', settledShareNotice: null, coveredNames: [], coverageKnown: true};
    const calculation: components['schemas']['FinanceCalculation'] = {title: 'Calculation explanation', sections: [{
        key: 'balance', title: `Calculated balance for ${payer}`,
        formula: {terms: [{label: 'Base share', value: '10.00'}, {operator: '−', label: 'Previous payments', value: '100000009.99'}],
            result: {label: 'Calculated balance', value: amount}},
    }]};
    const breakdown: components['schemas']['FinanceBreakdown'] = {
        components: [{key: 'shareAmount', label: 'Calculated balance', amount}], calculation, notes: [note],
        statusLabel: 'Refunded', needsRecalculation: false, settledShareNotice: null,
    };
    const preview: components['schemas']['FinancePreview'] = {revision: 1, roundUpShares: false,
        calculation: {title: 'Saved calculation basis', sections: []}, exampleCalculation: calculation,
        columns: [{key: 'baseShareAmount', label: 'Base'}, {key: 'extraAmount', label: 'Adjustments'},
            {key: 'invoiceCreditAmount', label: 'Invoice credit'}, {key: 'paymentCreditAmount', label: 'Previous'},
            {key: 'shareAmount', label: 'Calculated balance'}],
        shares: [{registrationId: '1', payerName: payer, baseShareAmount: '10.00', extraAmount: '-20.00',
            invoiceCreditAmount: '100.00', paymentCreditAmount: '99999889.99', shareAmount: amount,
            calculatedAmount: '-110.00', isPaid: false, notes: [note], statusLabel: 'Refund due'}],
        totals: {invoiceAmount: '10.00', redistributedAmount: '0.00', distributableAmount: '10.00',
            allocatedBaseAmount: '10.00', roundingDifference: '0.00', adjustmentAmount: '-20.00', grossAmount: '-10.00',
            invoiceCreditAmount: '100.00', expectedNetAmount: '-110.00', calculatedAmount: '-110.00',
            paymentCreditAmount: '99999889.99', outstandingAmount: '0.00', creditAmount: '99999999.99'},
    };
    const finance: components['schemas']['FinanceView'] = {audience: admin ? 'organizer' : 'participant',
        registrationId: admin ? null : '1', pools: [pool], shares: [share], invoices: []};
    const reads: string[] = [];
    await page.route(`**/api/v1/events/${event.id}/finance**`, async function deliverFinanceLayout(route) {
        // Every attempted command still reaches the shared fixture's refusal
        // and counter. This fixture supplies only the three selected GETs.
        if (route.request().method() !== 'GET') return route.fallback();
        const pathname = new URL(route.request().url()).pathname;
        let data: unknown;
        if (pathname === `/api/v1/events/${event.id}/finance${admin ? '/organizer' : ''}`) data = finance;
        else if (pathname === `/api/v1/events/${event.id}/finance/pools/${pool.id}/shares/1`) data = breakdown;
        else if (pathname === `/api/v1/events/${event.id}/finance/pools/${pool.id}/preview`) data = preview;
        else return route.fallback();
        reads.push(pathname);
        await route.fulfill({status: 200, contentType: 'application/json',
            headers: {'X-Surveyor-Context': session.context!}, body: JSON.stringify(data)});
    });
    return {delivery, event, pool, payer, note, reads};
}

/** Measure real browser overflow inside each financial surface, including
 * unbroken text that can escape a cell even when its table fits the viewport. */
async function expectFinanceLayoutFits(surface: Locator, selectors: string[]): Promise<void> {
    for (const selector of selectors) {
        const overflowing = await surface.locator(selector).evaluateAll(elements => elements
            .filter(element => element.checkVisibility() && element.scrollWidth > element.clientWidth + 1)
            .map(element => element.className));
        expect(overflowing, selector).toEqual([]);
    }
    expect(await surface.page().evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}

for (const width of [320, 768, 1024, 1440]) {
    test(`built Finance ledgers and previews wrap extreme signed amounts and audit text at ${width}px`, async ({page}, info) => {
        await page.setViewportSize({width, height: 900});
        for (const admin of [false, true]) {
            await page.unrouteAll({behavior: 'wait'});
            const fixture = await startupFinanceDocument(page, admin);
            await page.goto(fixture.delivery.url, {waitUntil: 'domcontentloaded'});
            await waitForFrontendHydration(page);
            const finance = page.locator('[data-finance-section]');
            if (admin) await finance.locator('[data-finance-pool] .accordion-button').click();
            else await finance.getByRole('button', {name: /Invoice pools & payments/u}).click();
            const ledger = finance.locator('[data-finance-shares]');
            await expect(ledger.locator('[data-finance-share]')).toHaveCount(1);
            await expect(ledger).toContainText('-99,999,999.99');
            await expect(ledger.locator('[data-finance-share] .badge')).toHaveText('Refunded');
            if (!admin) await expect(ledger.locator('[data-finance-settle]')).toHaveCount(0);
            else {
                await expect(finance.locator('a[download]')).toHaveCount(2);
                await expect(finance.locator('a[download]').first()).toHaveAttribute('href',
                    `/event/${fixture.event.id}/export/invoice-pools/${fixture.pool.id}/shares`);
                await expect(finance.locator('a[download]').nth(1)).toHaveAttribute('href',
                    `/event/${fixture.event.id}/export/invoice-pools/${fixture.pool.id}/shares?example=false`);
            }
            await expectFinanceLayoutFits(finance, ['.pool-header-summary', '.share-ledger', '.share-ledger-table']);
            expect(fixture.reads.filter(path => path.includes('/shares/'))).toHaveLength(0);
            await ledger.getByRole('button', {name: /^View breakdown/u}).click();
            const dialog = page.getByRole('dialog');
            await expect(dialog).toHaveCount(1);
            await dialog.locator('details > summary').first().click();
            await dialog.locator('details > summary').last().click();
            await expect(dialog).toContainText(`Calculated balance for ${fixture.payer}`);
            await expect(dialog).toContainText(fixture.note);
            await expect(dialog).not.toContainText('Participant A');
            await expect(dialog).not.toContainText('Unsettled balance');
            await expect(dialog.locator('.invoice-share-breakdown')).toContainText('-99,999,999.99');
            expect(fixture.reads.filter(path => path.includes('/shares/'))).toHaveLength(1);
            await expectFinanceLayoutFits(dialog, ['.modal-body', '.invoice-share-breakdown', '.invoice-calculation', '.invoice-calculation-formula']);
            await dialog.screenshot({path: info.outputPath(`finance-${admin ? 'organizer' : 'personal'}-${width}.png`), animations: 'disabled'});
            await dialog.getByRole('button', {name: 'Close', exact: true}).last().click();
            await expect(dialog).toHaveCount(0);
            if (admin) {
                await finance.getByRole('button', {name: 'Recalculate pool', exact: true}).click();
                const preview = page.getByRole('dialog');
                const payer = preview.locator('[data-finance-preview-payer]');
                await expect(payer).toHaveCount(1);
                await payer.locator('details > summary').click();
                await preview.locator('[data-finance-preview-example] summary').click();
                await expect(payer).toContainText(fixture.note);
                await expect(payer.locator('[data-calculation-display]')).toHaveCount(0);
                await expect(preview.locator('[data-finance-preview-example] [data-calculation-display]')).toHaveCount(1);
                await expect(preview.locator('.pool-preview-summary')).toContainText('-99,999,999.99');
                await expect(payer.locator('[data-label="Calculated balance"]')).toContainText('-99,999,999.99');
                await expectFinanceLayoutFits(preview, ['.modal-body', '.pool-preview-table', 'td', '.invoice-calculation-formula']);
                if (width < 992) {
                    const rowBounds = (await payer.boundingBox())!;
                    const nameBounds = (await payer.locator('td').first().boundingBox())!;
                    expect(nameBounds.width / rowBounds.width).toBeGreaterThan(0.85);
                }
                await preview.screenshot({path: info.outputPath(`finance-preview-${width}.png`), animations: 'disabled'});
                await preview.getByRole('button', {name: 'Cancel', exact: true}).click();
            }
            expect(fixture.delivery.observed.commands).toBe(0);
        }
    });
}

