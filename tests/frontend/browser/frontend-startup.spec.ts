import {apiCompatibility} from '../../../.generated/api/v1/policy.mjs';
import {validatePackingListView} from '../../../.generated/api/v1/browser/validatePackingListView.mjs';
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
    return {kind: 'anonymous', context: null, csrfToken: null,
        locale, activeProfile: null, profiles: [], loginUrl: '/users/login', logoutUrl: null,
        deployment: {buildId: 'startup-browser-fixture', apiCompatibility},
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

/** Expose actual responsive header controls without changing their disclosure state twice. */
async function expandStartupNavigation(page: Page): Promise<void> {
    const toggle = page.locator('header .navbar-toggler');
    if (await toggle.isVisible() && await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
}

for (const kind of ['anonymous', 'account', 'guest'] as const) {
    for (const width of [1280, 390]) {
        test(`Home preserves the public landing and separates Overview for ${kind} at ${width}px`, async ({page}, info) => {
            await page.setViewportSize({width, height: 900});
            const profile = {id: '11111111-1111-4111-8111-111111111111', name: 'Landing fixture'};
            const session: Session = kind === 'anonymous' ? startupSession()
                : {...startupSession(), kind, activeProfile: profile, profiles: [profile],
                    context: 'landing-route-context-1234567890', csrfToken: 'landing-route-csrf-1234567890'};
            const delivery = await startupDocument(page, '/frontend-pilot', {session, landing: {quickCreate: 'packing'}});
            const overviewReads: string[] = [];
            await page.route('**/api/v1/overview?*', deliverOverview);
            await page.goto(delivery.url);
            await waitForPilotHydration(page);
            const landing = page.locator('main > section');
            await expect(landing.getByRole('heading', {level: 1, name: 'Surveyor', exact: true})).toBeVisible();
            await expect(landing.locator('h2')).toHaveCount(7);
            await expect(page.locator('[data-collection]')).toHaveCount(0);
            expect(overviewReads).toEqual([]);
            const origin = await page.evaluate(() => performance.timeOrigin);
            const brand = page.locator('header a.navbar-brand');
            // The mobile navbar deliberately starts closed; inspect its fixed
            // destination now, then expose and activate that same link below.
            const home = page.locator('header a.nav-link[href="/frontend-pilot"]');
            await expect(brand).toHaveAttribute('href', '/frontend-pilot');
            await expect(home).toHaveAttribute('href', '/frontend-pilot');
            if (kind !== 'anonymous') await expect(landing.locator('a.btn-primary')).toHaveAttribute('href', '/frontend-pilot/users/dashboard');
            await page.screenshot({path: info.outputPath('restored-public-landing.png'), fullPage: true, animations: 'disabled'});

            await expandStartupNavigation(page);
            await page.locator('header').getByRole('button', {name: 'Overview', exact: true}).click();
            const overview = page.locator('header').getByRole('link', {name: 'Your overview', exact: true});
            await expect(overview).toHaveAttribute('href', '/frontend-pilot/users/dashboard');
            await overview.click();
            await expect(page).toHaveURL(/\/frontend-pilot\/users\/dashboard$/u);
            await expect(page.locator('main h1')).toHaveText(kind === 'anonymous' ? 'Welcome, !' : 'Welcome, Landing fixture!');
            if (kind !== 'anonymous') {
                await expect(page.locator('[data-collection="owner"][data-region="main"]')).toBeVisible();
                await expect.poll(() => overviewReads.length).toBeGreaterThan(0);
            }
            await expandStartupNavigation(page);
            await home.click();
            await expect(page).toHaveURL(/\/frontend-pilot$/u);
            await expect(page.locator('main h1')).toHaveText('Surveyor');
            await expect(page.locator('main h2')).toHaveCount(7);
            await expandStartupNavigation(page);
            await page.locator('header').getByRole('button', {name: 'Overview', exact: true}).click();
            await page.locator('header').getByRole('link', {name: 'Your overview', exact: true}).click();
            await expect(page).toHaveURL(/\/frontend-pilot\/users\/dashboard$/u);
            await brand.click();
            await expect(page).toHaveURL(/\/frontend-pilot$/u);
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
                const delivery = await startupDocument(page, '/frontend-pilot' + sample.path, {session: startupSession()});
                const entry = await failStartupModule(page, /\/app\/assets\/entry-client-[^/]+\.js(?:\?|$)/u);
                try {
                    await page.goto(delivery.url, {waitUntil: 'commit'});
                    await entry.started;
                    const loading = page.locator('[data-pilot-initial-loading]');
                    await expect(loading).toHaveAttribute('data-loading-skeleton', sample.variant);
                    await expect(loading).toBeVisible();
                    await expect(loading.locator('[role="status"]')).toHaveCount(1);
                    await expect(loading.locator('.pilot-skeleton-animated')).toHaveCount(1);
                    await expect(loading.locator('.pilot-skeleton-page-header')).toHaveCount(1);
                    await expect(page.locator('main input, main select, main textarea, main form')).toHaveCount(0);

                    // Column geometry must follow the actual module. Packing and
                    // Drivers retain every column on phones rather than hiding data.
                    if (sample.columns) {
                        const table = loading.locator('.pilot-skeleton-table-grid').first();
                        await expect(table).toHaveAttribute('data-skeleton-columns', String(sample.columns));
                        const cells = table.locator('.pilot-skeleton-table-heading > .pilot-skeleton-bar');
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
                    const heading = await loading.locator('.pilot-skeleton-page-header > .pilot-skeleton-heading').boundingBox();
                    expect(Math.abs(heading!.x + heading!.width / 2 - width / 2)).toBeLessThan(1);
                    if (['list-detail', 'activity', 'survey', 'event', 'event-admin'].includes(sample.variant)) {
                        const header = await loading.locator('.pilot-skeleton-page-header').boundingBox();
                        expect(header!.height - heading!.height).toBeGreaterThanOrEqual(32);
                    }
                    if (sample.variant === 'overview' && width === 1280) {
                        const animation = loading.locator('.pilot-skeleton-animated');
                        expect(await animation.evaluate(element => getComputedStyle(element).animationName)).toBe('pilot-skeleton-pulse');
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
        const delivery = await startupDocument(page, '/frontend-pilot/help?doc=fixture', {
            session: startupSession(), pageNotice: {kind: 'info', messageKey: 'auth.accountRequired'},
            help: {locale: 'en', title: 'Notification layout fixture', currentDoc: 'fixture.md',
                content, docsList: [], docsGroups: [], toc: []},
        });
        await page.goto(delivery.url);
        await waitForPilotHydration(page);
        const host = page.locator('main > .pilot-notice-region');
        const notice = host.locator('.pilot-notification');
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

for (const width of [1280, 390]) {
    for (const linked of [false, true]) {
        test(`entity headings remain centered with embedded actions at ${width}px (linked: ${linked})`, async ({page}, testInfo) => {
            await page.setViewportSize({width, height: 900});
            const id = '22222222-2222-4222-8222-222222222222';
            const profile = {id: '11111111-1111-4111-8111-111111111111', name: 'Header fixture'};
            const session: Session = {...startupSession(), kind: 'account', activeProfile: profile, profiles: [profile],
                context: 'heading-browser-context-1234567890', csrfToken: 'heading-browser-csrf-1234567890'};
            const delivery = await startupDocument(page, '/frontend-pilot/packing/' + id, {session, pageEntry: {kind: 'render'}});
            const list: components['schemas']['PackingListView'] = {
                entityType: 'packing', id, title: 'Equipment', description: null,
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
                initialHeaderHeight = (await page.locator('[data-pilot-initial-loading] .pilot-skeleton-page-header').boundingBox())!.height;
                await page.screenshot({path: testInfo.outputPath('entity-initial-skeleton.png'), animations: 'disabled'});
                entry.restore();
            }
            await waitForPilotHydration(page);
            const title = page.locator('main .card-header h1');
            await expect(title).toHaveText(list.title);
            const header = page.locator('main > section > .card-header');
            const bounds = (await header.boundingBox())!;
            const heading = (await title.boundingBox())!;
            if (initialHeaderHeight !== undefined) expect(Math.abs(bounds.height - initialHeaderHeight)).toBeLessThan(1);
            expect(Math.abs(heading.x + heading.width / 2 - bounds.x - bounds.width / 2)).toBeLessThan(1);
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
                expect(await original!.evaluate(node => node === document.querySelector('main .pilot-page-heading-actions button[aria-label="Refresh"]'))).toBe(true);
            } finally { refreshed.release(); await original!.dispose(); }
        });
    }
}

test('lazy navigation shows header progress without inserting a line above the current page', async ({page}) => {
    const delivery = await startupDocument(page, '/frontend-pilot/help?doc=fixture', {
        session: startupSession(), help: {locale: 'en', title: 'Retained source page', currentDoc: 'fixture.md',
            content: '<p>Readable source content.</p>', docsList: [], docsGroups: [], toc: []},
    });
    await page.goto(delivery.url);
    await waitForPilotHydration(page);
    const entry = await failStartupModule(page, /\/app\/assets\/PackingCreatePage-[^/]+\.js(?:\?|$)/u);
    try {
        const source = page.locator('main > section');
        const before = (await source.boundingBox())!;
        await page.getByRole('button', {name: 'New', exact: true}).click();
        await page.locator('header a[href="/frontend-pilot/packing/create"]').click();
        await entry.started;
        await expect(page.locator('header .pilot-navigation-indicator .spinner-border')).toBeVisible();
        await expect(page.locator('main .pilot-navigation-loading')).toHaveAttribute('role', 'status');
        await expect(page.locator('main [data-loading-skeleton]')).toHaveCount(0);
        await expect(source.locator('h1')).toHaveText('Retained source page');
        expect((await source.boundingBox())!.y).toBe(before.y);
        entry.restore();
        await expect(page).toHaveURL(/\/frontend-pilot\/packing\/create$/u);
        await expect(page.locator('header .pilot-navigation-indicator .spinner-border')).toHaveCount(0);
        expect(delivery.observed.documents).toBe(1);
    } finally { entry.restore(); }
});

for (const width of [1280, 390]) {
    test(`profile roster skeleton keeps the actual balanced heading geometry at ${width}px`, async ({page}, testInfo) => {
        await page.setViewportSize({width, height: 900});
        const profile = {id: '11111111-1111-4111-8111-111111111111', name: 'Profile fixture', isDefault: true};
        const session: Session = {...startupSession(), kind: 'account', activeProfile: profile, profiles: [profile],
            context: 'profile-heading-context-1234567890', csrfToken: 'profile-heading-csrf-1234567890'};
        const delivery = await startupDocument(page, '/frontend-pilot/users/profile/manage', {session, pageEntry: {kind: 'render'}});
        const profiles: components['schemas']['ProfileManagement'] = {profiles: [profile], activeProfileId: profile.id};
        await page.route('**/api/v1/profiles', async route => {
            await route.fulfill({status: 200, contentType: 'application/json', headers: {
                'X-Surveyor-Context': session.context!}, body: JSON.stringify(profiles)});
        });
        const entry = await failStartupModule(page, /\/app\/assets\/entry-client-[^/]+\.js(?:\?|$)/u);
        try {
            await page.goto(delivery.url, {waitUntil: 'commit'});
            await entry.started;
            const initial = (await page.locator('[data-pilot-initial-loading] .pilot-skeleton-page-header').boundingBox())!;
            await page.screenshot({path: testInfo.outputPath('profile-initial-skeleton.png'), animations: 'disabled'});
            entry.restore();
            await waitForPilotHydration(page);
            const header = page.locator('main > section > .pilot-page-heading');
            await expect(header.getByRole('button', {name: 'Refresh', exact: true})).toBeVisible();
            const loaded = (await header.boundingBox())!;
            await page.screenshot({path: testInfo.outputPath('profile-loaded-header.png'), animations: 'disabled'});
            expect(Math.abs(loaded.height - initial.height)).toBeLessThan(1);
            // Mobile navigation intentionally collapses only after hydration;
            // header geometry must not add another shift within the page itself.
            if (width >= 992) expect(Math.abs(loaded.y - initial.y)).toBeLessThan(1);
        } finally { entry.restore(); }
    });
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
                const delivery = await startupDocument(page, `/frontend-pilot/${family}/create?locale=${locale}`, {session,
                    pageEntry: {kind: 'render'}, packingCreateContext: definitions, driversCreateContext: definitions,
                    activityCreateContext: definitions, eventCreateContext: definitions});
                await page.goto(delivery.url);
                await waitForPilotHydration(page);
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
    const delivery = await startupDocument(page, '/frontend-pilot/packing/create', {session,
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
        await waitForPilotHydration(page);
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
        expect(await spinner.evaluate(element => element.closest('.pilot-app') === null)).toBe(true);
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
    const delivery = await startupDocument(page, '/frontend-pilot/users/dashboard', {session: startupSession()});
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
        await route.fulfill({status: 200, contentType: 'application/json', headers: session.context === null ? {} : {
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

for (const width of [1280, 390]) {
    test(`reorder insertion markers show the pointer edge before release at ${width}px`, async ({page}, testInfo) => {
        await page.setViewportSize({width, height: 900});
        const id = '22222222-2222-4222-8222-222222222222';
        const profile = {id: '11111111-1111-4111-8111-111111111111', name: 'Reorder fixture'};
        const session: Session = {...startupSession(), kind: 'account', activeProfile: profile, profiles: [profile],
            context: 'reorder-browser-context-1234567890', csrfToken: 'reorder-browser-csrf-1234567890'};
        const delivery = await startupDocument(page, '/frontend-pilot/packing/' + id, {session, pageEntry: {kind: 'render'}});
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
        await waitForPilotHydration(page);
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
        await expect(last).toHaveClass(/pilot-reorder-before/u);
        await page.mouse.move(destination.x + 20, destination.y + destination.height - 8, {steps: 6});
        await expect(last).toHaveClass(/pilot-reorder-after/u);
        expect(await last.locator('td').first().evaluate(cell => getComputedStyle(cell).boxShadow)).toContain('0px -3px');
        const preview = (await last.boundingBox())!;
        expect(preview).toEqual(before);
        const screenshot = testInfo.outputPath('reorder-after-edge.png');
        await page.screenshot({path: screenshot, animations: 'disabled'});
        await testInfo.attach('reorder-after-edge', {path: screenshot, contentType: 'image/png'});
        expect(delivery.observed.commands).toBe(0);
        await page.keyboard.press('Escape');
        await page.mouse.up();
        await expect(page.locator('.pilot-reorder-before, .pilot-reorder-after, .pilot-reorder-dragging')).toHaveCount(0);
        expect(delivery.observed.commands).toBe(0);
    });
}

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

