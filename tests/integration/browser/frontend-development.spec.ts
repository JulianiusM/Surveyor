import {expect, test, type Page, type Route} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {createE2EEvent, createE2ELogin, createE2EPackingList} from '../../factories/e2eCoreFactory';
import {createProfileForE2E, createResourceViaForm, loginForE2E, selectProfileForE2E} from '../../keywords/e2eCoreKeywords';
import {createBrowserReadGate, waitForFrontendHydration} from '../../keywords/frontendDynamicKeywords';
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

        await page.goto('/help?locale=en');
        const scripts = await page.locator('script[type="module"][src]').evaluateAll(nodes => nodes.map(node => node.getAttribute('src')!));
        expect(scripts.map(url => new URL(url, page.url()).pathname)).toContain('/app/src/frontend/app/entry-client.ts');
        expect(scripts.some(url => url.includes('/app/app/'))).toBe(false);
        await expect(page.locator('header .navbar-brand img')).toHaveAttribute('src', '/img/logo.png');
        // Native isolation gives this frontend one owned cascade. Its actual
        // source composition must style SSR before hydration and remain the
        // same composition loaded by the client, without native stylesheets.
        await expect(page.locator('head link[href^="/app/src/frontend/styles/application.sass"]')).toHaveCount(1);
        await expect(page.locator('head link[href^="/style/"]')).toHaveCount(0);
        await expect(page.locator('.frontend-app')).toHaveCSS('background-color', 'rgb(108, 117, 125)');
        await expect(page.locator('.help-content')).toHaveCSS('color', 'rgb(233, 236, 239)');
        const helpPictures = await page.locator('.help-content img').evaluateAll(nodes => nodes.map(node => node.getAttribute('src')!));
        expect(helpPictures.length).toBeGreaterThan(0);
        expect(helpPictures.every(url => url.startsWith('/help/assets/'))).toBe(true);
        expect(await page.locator('[src],[href]').evaluateAll(nodes => nodes.some(node =>
            ['src', 'href'].some(attribute => /^file:/i.test(node.getAttribute(attribute) ?? ''))))).toBe(false);

        // A successful SSR response alone does not prove client boot. The real form
        // must refresh its results through the router and retain this document marker.
        // Help's SSR form intentionally supports native GET before hydration;
        // wait for client ownership before asserting Router-only navigation.
        await waitForFrontendHydration(page);
        await page.evaluate(() => { document.documentElement.dataset.developmentDocument = 'original'; });
        await page.getByRole('searchbox').fill('packing');
        await page.getByRole('button', {name: 'Search help', exact: true}).click();
        await expect(page).toHaveURL(/q=packing/);
        await expect(page.locator('.help-search-results')).toBeVisible();
        expect(await documentMarker(page)).toBe('original');

        await page.getByRole('link', {name: 'Help home', exact: true}).click();
        const englishBody = await page.locator('.help-content').innerText();
        await page.locator('#frontend-locale').selectOption('de');
        await expect(page.locator('html')).toHaveAttribute('lang', 'de');
        await expect(page.locator('.help-content')).not.toHaveText(englishBody);
        await expect(page.locator('#frontend-locale')).toBeEnabled();

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
            await page.locator('#frontend-locale').selectOption('en');
            await expect(page.locator('html')).toHaveAttribute('lang', 'en');
            await page.locator('header').getByRole('link', {name: 'Login', exact: true}).click();
            await identityAttempt;
            releaseHelp();
            await expect(page.locator('#frontend-locale')).toBeEnabled();
            releaseIdentity();
            await expect(page).toHaveURL(/\/users\/login/);
            await expect(page.getByRole('button', {name: 'Login', exact: true})).toBeVisible();
            expect(await documentMarker(page)).toBe('original');
            await page.locator('header').getByRole('link', {name: 'Register', exact: true}).click();
            await expect(page).toHaveURL(/\/users\/register/);
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

    test('withholds source Overview controls until initialization and retains its focused search through a real read', async ({page}) => {
        await loginForE2E(page.request, createE2ELogin());
        const marker = `Source search ${randomUUID().slice(0, 8)}`;
        await createProfileForE2E(page.request, marker);
        const session = await (await page.request.get('/api/v1/session')).json() as SessionView;
        const profile = session.profiles.find(item => item.name === marker);
        expect(profile).toBeDefined();
        await selectProfileForE2E(page.request, profile!.id);
        const eventInput = createE2EEvent();
        eventInput.title = eventInput.form.title = `${marker} event`;
        const event = await createResourceViaForm(page.request, eventInput);
        const packingInput = createE2EPackingList();
        packingInput.title = packingInput.form.title = `${marker} standalone`;
        const packing = await createResourceViaForm(page.request, packingInput);

        const entryGate = createBrowserReadGate();
        const entryStarted = createBrowserReadGate();
        const readGate = createBrowserReadGate();
        const readStarted = createBrowserReadGate();
        await page.route('**/app/src/frontend/app/entry-client.ts*', holdSourceEntry);

        async function holdSourceEntry(route: Route): Promise<void> {
            entryStarted.release();
            await entryGate.promise;
            await route.continue();
        }

        /** Delay delivery only after the real server has answered the initialized
         * search. Admission, generated projection and database reads stay intact. */
        async function holdOwnerRead(route: Route): Promise<void> {
            const parameters = new URL(route.request().url()).searchParams;
            if (parameters.get('collection') !== 'owner' || parameters.get('region') !== 'main') {
                await route.continue();
                return;
            }
            const response = await route.fetch();
            expect(response.status()).toBe(200);
            readStarted.release();
            await readGate.promise;
            await route.fulfill({response});
        }

        try {
            // The source renderer uses the approved initial skeleton, just like an
            // installed build. Holding its entry must expose no inactive editors.
            await page.goto(`/users/dashboard?owner_main_q=${encodeURIComponent(marker)}`, {waitUntil: 'commit'});
            await entryStarted.promise;
            await expect(page.locator('[data-frontend-initial-loading]')).toBeVisible();
            await expect(page.locator('main input, main form, [data-collection]')).toHaveCount(0);
            await page.evaluate(() => { document.documentElement.dataset.developmentDocument = 'overview-original'; });
            entryGate.release();
            await waitForFrontendHydration(page);

            const owner = page.locator('[data-collection="owner"][data-region="main"]');
            await expect(owner.locator(`[data-id="${event.id}"]`)).toBeVisible();
            await expect(owner.locator(`[data-id="${packing.id}"]`)).toBeVisible();
            await page.route('**/api/v1/overview?*', holdOwnerRead);
            const input = owner.getByRole('searchbox');
            const originalInput = await input.elementHandle();
            try {
                // This newly submitted initialized draft starts its own read. The
                // successful projection must keep its original focused control,
                // selection and source document rather than recreate the editor.
                await input.fill(`${marker} standalone`);
                await owner.getByRole('button', {name: 'Search', exact: true}).click();
                await readStarted.promise;
                await input.focus();
                await input.evaluate(function selectSearchDraft(element): void {
                    (element as HTMLInputElement).setSelectionRange(2, 9);
                });
                await expect(input).toHaveValue(`${marker} standalone`);
                readGate.release();

                await expect(owner.locator(`[data-id="${event.id}"]`)).toHaveCount(0);
                await expect(owner.locator(`[data-id="${packing.id}"]`)).toBeVisible();
                await expect(owner).toContainText('1 matching entities');
                await expect(input).toBeFocused();
                expect(await originalInput!.evaluate(element =>
                    element === document.querySelector('input[name="owner_main_q"]'))).toBe(true);
                expect(await input.evaluate(function readSearchSelection(element) {
                    const field = element as HTMLInputElement;
                    return [field.selectionStart, field.selectionEnd];
                })).toEqual([2, 9]);
                expect(await documentMarker(page)).toBe('overview-original');
            } finally {
                await originalInput?.dispose();
            }
        } finally {
            entryGate.release();
            readGate.release();
            await page.unroute('**/app/src/frontend/app/entry-client.ts*');
            await page.unroute('**/api/v1/overview?*');
        }
    });

    test('hydrates source packing controls and confirms a real item command without replacing the document', async ({page}) => {
        await loginForE2E(page.request, createE2ELogin());
        const packing = await createResourceViaForm(page.request, createE2EPackingList());
        const title = `Source packing item ${randomUUID().slice(0, 8)}`;
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));

        await page.goto(`/packing/${packing.id}?locale=en`);
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
