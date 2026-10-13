import {expect, test, type Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {createE2EEvent, createE2ELogin, createE2EPackingList} from '../../factories/e2eCoreFactory';
import {createResourceViaForm, loginForE2E} from '../../keywords/e2eCoreKeywords';
import {waitForPilotHydration} from '../../keywords/frontendDynamicKeywords';
import type {components} from '../../../src/types/api/v1';

type SessionView = components['schemas']['SessionView'];

// Development has a different module loader and HTML transform from installed builds.
// The caller must provide an owned source server and its dedicated disposable schema;
// this suite neither starts a process nor initializes or resets a database.
test.describe('actual frontend development runtime', () => {
    test.skip(process.env.E2E_FRONTEND_DEVELOPMENT !== 'true', 'Requires the explicitly selected source development server.');

    test('loads executable source assets and preserves navigation during a locale refresh', async ({page}) => {
        const errors: string[] = [];
        const assets: Array<{path: string; status: number; contentType: string}> = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
        page.on('response', response => {
            const pathname = new URL(response.url()).pathname;
            if (pathname.startsWith('/app/')) assets.push({path: pathname, status: response.status(),
                contentType: response.headers()['content-type'] ?? ''});
        });

        await page.goto('/frontend-pilot/help?locale=en');
        const scripts = await page.locator('script[type="module"][src]').evaluateAll(nodes => nodes.map(node => node.getAttribute('src')!));
        expect(scripts.map(url => new URL(url, page.url()).pathname)).toContain('/app/src/frontend/app/entry-client.ts');
        expect(scripts.some(url => url.includes('/app/app/'))).toBe(false);
        await expect(page.locator('header .navbar-brand img')).toHaveAttribute('src', '/img/logo.png');
        await expect(page.locator('head link[href="/style/style.css"]')).toHaveCount(1);
        await expect(page.locator('head link[href="/style/help.css"]')).toHaveCount(1);
        await expect(page.locator('head link[href^="/app/src/frontend/styles/pilot.css"]')).toHaveCount(1);
        const helpPictures = await page.locator('.help-content img').evaluateAll(nodes => nodes.map(node => node.getAttribute('src')!));
        expect(helpPictures.length).toBeGreaterThan(0);
        expect(helpPictures.every(url => url.startsWith('/frontend-pilot/help/assets/'))).toBe(true);
        expect(await page.locator('[src],[href]').evaluateAll(nodes => nodes.some(node =>
            ['src', 'href'].some(attribute => /^file:/i.test(node.getAttribute(attribute) ?? ''))))).toBe(false);

        // A successful SSR response alone does not prove client boot. The real form
        // must refresh its results through the router and retain this document marker.
        await page.evaluate(() => { document.documentElement.dataset.developmentDocument = 'original'; });
        await page.getByRole('searchbox').fill('packing');
        await page.getByRole('button', {name: 'Search help', exact: true}).click();
        await expect(page).toHaveURL(/q=packing/);
        await expect(page.locator('.help-search-results')).toBeVisible();
        expect(await documentMarker(page)).toBe('original');

        await page.getByRole('link', {name: 'Help home', exact: true}).click();
        const englishBody = await page.locator('.help-content').innerText();
        await page.locator('#pilot-locale').selectOption('de');
        await expect(page.locator('html')).toHaveAttribute('lang', 'de');
        await expect(page.locator('.help-content')).not.toHaveText(englishBody);
        await expect(page.locator('#pilot-locale')).toBeEnabled();

        // Hold genuine HTTP responses rather than replace data/components. A slow help
        // refresh and a cold lazy page make the navigation/locale race deterministic.
        let releaseHelp!: () => void;
        let releaseIdentity!: () => void;
        let identityStarted!: () => void;
        const helpGate = new Promise<void>(resolve => { releaseHelp = resolve; });
        const identityGate = new Promise<void>(resolve => { releaseIdentity = resolve; });
        const identityAttempt = new Promise<void>(resolve => { identityStarted = resolve; });
        await page.route('**/api/v1/help*', async route => { await helpGate; await route.continue(); });
        await page.route('**/app/src/frontend/features/identity/IdentityPage.vue*', async route => {
            identityStarted(); await identityGate; await route.continue();
        });
        try {
            await page.locator('#pilot-locale').selectOption('en');
            await expect(page.locator('html')).toHaveAttribute('lang', 'en');
            await page.locator('header').getByRole('link', {name: 'Login', exact: true}).click();
            await identityAttempt;
            releaseHelp();
            await expect(page.locator('#pilot-locale')).toBeEnabled();
            releaseIdentity();
            await expect(page).toHaveURL(/\/frontend-pilot\/users\/login/);
            await expect(page.getByRole('button', {name: 'Login', exact: true})).toBeVisible();
            expect(await documentMarker(page)).toBe('original');
            await page.locator('header').getByRole('link', {name: 'Register', exact: true}).click();
            await expect(page).toHaveURL(/\/frontend-pilot\/users\/register/);
            await expect(page.getByRole('button', {name: 'Register', exact: true})).toBeVisible();
            expect(await documentMarker(page)).toBe('original');
        } finally {
            releaseHelp(); releaseIdentity();
            await page.unroute('**/api/v1/help*');
            await page.unroute('**/app/src/frontend/features/identity/IdentityPage.vue*');
        }

        expect(assets.some(asset => asset.path.endsWith('/entry-client.ts') && /javascript/i.test(asset.contentType))).toBe(true);
        expect(assets.filter(asset => asset.status >= 400 || asset.path.includes('/app/app/'))).toEqual([]);
        expect(errors).toEqual([]);
    });

    test('preserves an overview search typed before the source client hydrates', async ({page}) => {
        await loginForE2E(page.request, createE2ELogin());
        const marker = `Early search ${randomUUID().slice(0, 8)}`;
        expect((await page.request.post('/users/profile/create', {form: {name: marker}, maxRedirects: 0})).status()).toBe(302);
        const session = await (await page.request.get('/api/v1/session')).json() as SessionView;
        const profile = session.profiles.find(item => item.name === marker);
        expect(profile).toBeDefined();
        expect((await page.request.get(`/users/profile/change/${profile!.id}`, {maxRedirects: 0})).status()).toBe(302);
        const eventInput = createE2EEvent();
        eventInput.title = eventInput.form.title = `${marker} event`;
        const event = await createResourceViaForm(page.request, eventInput);
        const packingInput = createE2EPackingList();
        packingInput.title = packingInput.form.title = `${marker} standalone`;
        const packing = await createResourceViaForm(page.request, packingInput);

        let releaseEntry!: () => void;
        let entryStarted!: () => void;
        const entryGate = new Promise<void>(resolve => { releaseEntry = resolve; });
        const entryAttempt = new Promise<void>(resolve => { entryStarted = resolve; });
        await page.route('**/app/src/frontend/app/entry-client.ts*', async route => {
            entryStarted(); await entryGate; await route.continue();
        });
        try {
            // DOMContentLoaded waits for module execution. Commit lets the user interact
            // with the actual server-rendered form while the client script is downloading.
            await page.goto(`/frontend-pilot?owner_main_q=${encodeURIComponent(marker)}`, {waitUntil: 'commit'});
            await entryAttempt;
            const owner = page.locator('[data-collection="owner"][data-region="main"]');
            // Progressive Overview SSR carries the search controls and placeholders,
            // not collection records. Prove early interaction against that actual shell.
            await expect(owner.locator('[data-loading-skeleton="cards"]')).toBeVisible();
            await expect(owner.locator(`[data-id="${event.id}"]`)).toHaveCount(0);
            const input = owner.getByRole('searchbox');
            await page.evaluate(() => { document.documentElement.dataset.developmentDocument = 'overview-original'; });
            await input.fill(`${marker} standalone`);
            releaseEntry();
            // Wait for the current entry's completed draft restoration. Region data
            // arrives after hydration. The replayed input must survive that
            // authoritative read rather than being restored from the original URL filter.
            await waitForPilotHydration(page);
            expect(await documentMarker(page)).toBe('overview-original');
            await expect(input).toHaveValue(`${marker} standalone`);
            await owner.getByRole('button', {name: 'Search', exact: true}).click();
            await expect(owner.locator(`[data-id="${event.id}"]`)).toHaveCount(0);
            await expect(owner.locator(`[data-id="${packing.id}"]`)).toBeVisible();
            await expect(owner).toContainText('1 matching entities');
            expect(await documentMarker(page)).toBe('overview-original');
        } finally {
            releaseEntry();
            await page.unroute('**/app/src/frontend/app/entry-client.ts*');
        }
    });

    test('hydrates source packing controls and confirms a real item command without replacing the document', async ({page}) => {
        await loginForE2E(page.request, createE2ELogin());
        const packing = await createResourceViaForm(page.request, createE2EPackingList());
        const title = `Source packing item ${randomUUID().slice(0, 8)}`;
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));

        await page.goto(`/frontend-pilot/packing/${packing.id}?locale=en`);
        await expect(page.locator('tr[data-item-id]').first()).toBeVisible();
        await page.evaluate(() => { document.documentElement.dataset.developmentDocument = 'packing-original'; });

        // Only the HTTP boundary observes this command. Creation, generated validation,
        // admission, persistence and the follow-up projection all use the real source app.
        await page.locator('#quick-title').fill(title);
        await page.locator('#quick-description').fill('Source runtime confirmation');
        await page.locator('#quick-max').fill('2');
        const confirmation = page.waitForResponse(response => response.request().method() === 'POST'
            && new URL(response.url()).pathname === `/api/v1/packing-lists/${packing.id}/items`);
        await page.getByRole('button', {name: 'Add', exact: true}).click();
        expect((await confirmation).status()).toBe(201);
        await expect(page.locator('tr[data-item-id]').filter({hasText: title})).toBeVisible();
        await expect(page.locator('#quick-title')).toHaveValue('');
        expect(await documentMarker(page)).toBe('packing-original');
        expect(errors).toEqual([]);
    });
});

async function documentMarker(page: Page): Promise<string | undefined> {
    return page.evaluate(() => document.documentElement.dataset.developmentDocument);
}
