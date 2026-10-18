import {expect, test, type APIRequestContext, type Dialog, type Locator, type Page, type Request, type Route, type TestInfo} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {writeFile} from 'node:fs/promises';
import {createE2EEvent, createE2ELogin, createE2EPackingList} from '../factories/e2eCoreFactory';
import {createResourceViaForm, expectVisiblePresentation, loginForE2E, readVisiblePresentation} from '../keywords/e2eCoreKeywords';
import {createBrowserReadGate as readGate, waitForPilotHydration} from '../keywords/frontendDynamicKeywords';
import type {components} from '../../src/types/api/v1';
import {apiCompatibility} from '../../.generated/api/v1/policy.mjs';

type Session = components['schemas']['SessionView'];

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
/** Reproduce browser mutation protections while preserving absent initial session evidence. */
function headers(session: Session): Record<string, string> {
    const baseUrl = test.info().project.use.baseURL;
    if (!baseUrl) throw new Error('The built frontend fixture requires its configured application origin.');
    // Keep null initial evidence absent while retaining the browser's mutation
    // protections and the precise string pair of every established session.
    return {Origin: new URL(baseUrl).origin, 'X-Surveyor-Api-Compatibility': apiCompatibility,
        ...(session.context === null ? {} : {'X-Surveyor-Context': session.context, 'X-CSRF-Token': session.csrfToken}),
        'X-Surveyor-Locale': session.locale};
}

/** Compare rendered label/count and sibling badge gaps independently of markup.
 * A literal template space adds to Bootstrap's existing badge margin even when the
 * class names match. The range excludes trailing whitespace but keeps the label. */
async function counterBadgeGaps(surface: Locator): Promise<number[]> {
    // The immutable native counter groups have no migration-only hook. Locate
    // their established rendered classes on both surfaces rather than changing
    // the reference template to make the comparison convenient.
    return surface.locator('.card-body > .d-flex > span.fs-6.fw-semibold').evaluateAll(function measureCounterBadgeGaps(groups) {
        const gaps: number[] = [];
        for (const group of groups) {
            let label: ChildNode | undefined;
            for (const node of group.childNodes) {
                if (node.nodeType === Node.TEXT_NODE && node.textContent?.trimEnd().endsWith(':')) {
                    label = node;
                    break;
                }
            }
            const badges = group.querySelectorAll('.badge');
            const badge = badges[0];
            if (!label || !badge) throw new Error('Expected the rendered native counter label and badge.');
            const range = document.createRange();
            range.setStart(label, 0);
            range.setEnd(label, label.textContent!.trimEnd().length);
            gaps.push(Math.round((badge.getBoundingClientRect().left - range.getBoundingClientRect().right) * 1000) / 1000);
            for (let index = 1; index < badges.length; index++) {
                gaps.push(Math.round((badges[index]!.getBoundingClientRect().left
                    - badges[index - 1]!.getBoundingClientRect().right) * 1000) / 1000);
            }
        }
        return gaps;
    });
}

/** Access keeps its nested native tab spacing even though Reka owns interaction. */
async function accessTabGap(surface: Locator): Promise<string> {
    await surface.getByRole('tab', {name: 'Access', exact: true}).click();
    return surface.getByRole('tab', {name: 'Group Permissions', exact: true}).evaluate(function readTabGap(tab) {
        const tabs = tab.closest('[role="tablist"]');
        if (!tabs) throw new Error('Expected the existing Access tablist.');
        return getComputedStyle(tabs).columnGap;
    });
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

/** Capture the genuine corresponding surface after fonts and hover state settle.
 * The shared assertion compares visible content/controls/styles and local boxes;
 * screenshots and raw measurements remain separately inspectable run evidence. */
async function captureMatchedPresentation(page: Page, info: TestInfo, name: string, surface: Locator, selectors: string[], focus?: Locator) {
    await page.evaluate(() => document.fonts.ready);
    // A no-op uncheck leaves native unfocused, while clearing the shared Packed
    // key in Vue performs a real click. Establish the same deliberate focus state
    // in both documents; keep focus-ring styles in the complete comparison.
    await page.evaluate(function releasePreviousFocus() {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    });
    if (focus) await focus.focus();
    await page.mouse.move(0, 0);
    const path = info.outputPath(name + '.png');
    await surface.screenshot({path, animations: 'disabled'});
    const presentation = await readVisiblePresentation(surface, selectors);
    await info.attach(name, {path, contentType: 'image/png'});
    await info.attach(name + '-presentation', {body: JSON.stringify(presentation, null, 2), contentType: 'application/json'});
    return presentation;
}

/** Record the real viewport context without scrolling or focusing the surface.
 * The browser supplies sticky geometry and document position; screenshots and
 * raw measurements remain available when a subsequent assertion fails. */
async function capturePageFeedbackGeometry(page: Page, info: TestInfo, name: string, row: Locator,
    control: Locator, focusEvents: number) {
    const geometry = await row.evaluate(function readPageFeedbackGeometry(element) {
        const host = document.getElementById('liveAlerts');
        if (!host) throw new Error('Expected the existing page feedback host.');
        const alert = host.querySelector<HTMLElement>('.alert');
        return {scrollY: window.scrollY, viewport: {width: window.innerWidth, height: window.innerHeight},
            row: bounds(element), host: bounds(host), alert: alert ? bounds(alert) : null,
            alertText: alert?.textContent?.trim() ?? null,
            focusedGlobalAlert: document.activeElement instanceof Element && host.contains(document.activeElement),
            documentMarker: document.documentElement.dataset.pilotDocument};

        /** Keep only observable layout, excluding request/session/private data. */
        function bounds(target: Element) {
            const box = target.getBoundingClientRect();
            return {x: box.x, y: box.y, width: box.width, height: box.height};
        }
    });
    const result = {...geometry, control: await control.boundingBox(), globalFocusEvents: focusEvents};
    const screenshot = info.outputPath(name + '.png');
    await page.screenshot({path: screenshot, animations: 'disabled'});
    await writeFile(info.outputPath(name + '.json'), JSON.stringify(result, null, 2));
    await info.attach(name, {path: screenshot, contentType: 'image/png'});
    await info.attach(name + '-geometry', {body: JSON.stringify(result, null, 2), contentType: 'application/json'});
    return result;
}

for (const width of [1280, 390]) {
    test(`keeps native edit and Vue assignment feedback sticky without losing the scrolled row at ${width}px`, async function stickyPageFeedback({page}, info) {
        test.setTimeout(60_000);
        await page.setViewportSize({width, height: 900});
        await loginForE2E(page.request, createE2ELogin());
        const input = createE2EPackingList();
        input.title = input.form.title = `Sticky feedback ${randomUUID().slice(0, 8)}`;
        const items = Array.from({length: 40}, function createScrollableItem(_value, index) {
            return {title: `Scroll item ${index + 1}`, description: 'Shared equipment', maxAssignees: 1, requiredByAll: false};
        });
        // Legitimate initial rows provide the long-page geometry. No document,
        // app response, stylesheet, timer or navigation is substituted by the test.
        input.form.items = JSON.stringify(items);
        const list = await createResourceViaForm(page.request, input);
        const created = await readPacking(page.request, list.id);
        expect(created.items).toHaveLength(40);
        // Establish dense positions through the actual native reorder operation.
        // Initial native rows share a position; relying on their tie order would
        // give the two frontends different scroll targets for this same record.
        const orders: Array<{itemId: string; position: number}> = [];
        for (const [position, initialItem] of items.entries()) {
            const persisted = created.items.find(candidate => candidate.title === initialItem.title);
            expect(persisted).toBeDefined();
            orders.push({itemId: persisted!.id, position});
        }
        const reordered = await page.request.post(`/api/packing/${list.id}/reorder`, {data: {orders}});
        expect(reordered.status()).toBe(200);
        expect(await reordered.json()).toMatchObject({status: 'success', message: 'Order saved'});
        const ordered = await readPacking(page.request, list.id);
        expect(ordered.items.map(candidate => ({itemId: candidate.id, position: candidate.position}))).toEqual(orders);
        const item = ordered.items[18]!;
        const itemTitle = items[18]!.title;
        expect(item.title).toBe(itemTitle);
        expect((await page.request.post(`/api/packing/${list.id}/assign`, {data: {itemId: item.id}})).status()).toBe(200);
        const updatedDescription = 'Edited while retaining this row';

        for (const pilot of [false, true]) {
            const label = pilot ? 'vue' : 'native';
            await page.goto(`${pilot ? '/frontend-pilot' : ''}${list.path}?locale=en`, {waitUntil: 'domcontentloaded'});
            if (pilot) await waitForPilotHydration(page);
            const row = page.locator('main tbody tr').filter({has: page.getByText(itemTitle, {exact: true})});
            await expect(page.locator('main tbody tr')).toHaveCount(40);
            await expect(page.locator('main tbody tr > td:nth-child(3)')).toHaveText(items.map(candidate => candidate.title));
            await expect(row).toHaveCount(1);
            await page.evaluate(() => document.fonts.ready);
            const marker = `${label}-sticky-feedback`;
            await page.evaluate(value => { document.documentElement.dataset.pilotDocument = value; }, marker);
            const navigation: string[] = [];
            function captureNavigation(request: Request): void {
                if (request.isNavigationRequest() && request.frame() === page.mainFrame()) navigation.push(request.url());
            }
            page.on('request', captureNavigation);
            const observedFocus = await page.evaluateHandle(function observeGlobalAlertFocus() {
                const observation = {count: 0, stop: stopObservation};
                document.addEventListener('focusin', captureGlobalFocus);
                return observation;

                function captureGlobalFocus(event: FocusEvent): void {
                    if (event.target instanceof Element && event.target.closest('#liveAlerts')) observation.count++;
                }
                function stopObservation(): void { document.removeEventListener('focusin', captureGlobalFocus); }
            });
            try {
                // Native assignments reload after success. Its stable no-reload
                // description save exercises the same actual global alert owner;
                // Vue then removes the seeded assignment on this persisted row.
                const description = row.locator('td').nth(3);
                const action = row.locator('td').last().getByRole('button', {name: 'Remove', exact: true});
                const initiator = pilot ? action : description;
                await row.evaluate(function centerScrollableRow(element) { element.scrollIntoView({block: 'center', inline: 'nearest'}); });
                // Horizontal overflow is part of the native mobile table. Reach
                // the real control without dropping columns or changing styles.
                await initiator.scrollIntoViewIfNeeded();
                await expect(initiator).toBeInViewport({ratio: 1});
                const before = await capturePageFeedbackGeometry(page, info, `${label}-sticky-before`, row, initiator, 0);
                expect(before.scrollY).toBeGreaterThan(400);

                if (pilot) {
                    await packingCommand(page, list.id, `/items/${item.id}/self-assignment`, 'DELETE', () => action.click());
                    await expect(row.locator('td').nth(4)).toHaveText('0 / 1');
                    await expect(row.locator('td').last().getByRole('button', {name: 'Take', exact: true})).toBeEnabled();
                } else {
                    await description.dblclick();
                    const editor = description.locator('input');
                    await editor.fill(updatedDescription);
                    const saved = page.waitForResponse(function matchNativeDescription(response) {
                        return response.request().method() === 'POST'
                            && new URL(response.url()).pathname === `/api/packing/${list.id}/item/${item.id}/description`;
                    });
                    // Native saves on both Enter and blur. Commit once through
                    // normal focus departure, preserving its existing handlers.
                    await editor.press('Tab');
                    const response = await saved;
                    expect(response.status()).toBe(200);
                    expect(await response.json()).toMatchObject({status: 'success', message: 'Description updated'});
                    await expect(description).toHaveText(updatedDescription);
                }

                const control = pilot ? row.locator('td').last().getByRole('button', {name: 'Take', exact: true}) : description;
                const alert = page.locator('#liveAlerts > .alert-success');
                await expect(alert).toHaveText(pilot ? 'Item unassigned' : 'Updated');
                const after = await capturePageFeedbackGeometry(page, info, `${label}-sticky-confirmed`, row, control,
                    await observedFocus.evaluate(observation => observation.count));
                await expect(alert).toBeInViewport({ratio: 1});
                await expect(row).toBeInViewport();
                await expect(control).toBeInViewport({ratio: 1});
                expect(after.scrollY).toBeGreaterThan(400);
                expect(Math.abs(after.host.y)).toBeLessThanOrEqual(1);
                expect(after.documentMarker).toBe(marker);
                if (pilot) {
                    expect(after.globalFocusEvents).toBe(0);
                    expect(after.focusedGlobalAlert).toBe(false);
                } else expect(after.globalFocusEvents).toBeGreaterThan(0);

                // A real additional user scroll must retain sticky feedback and
                // the nearby row. Poll only the observed wheel result; never
                // repeat the action or use a fixed delay to manufacture readiness.
                await page.mouse.move(width / 2, 600);
                await page.mouse.wheel(0, 100);
                await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(after.scrollY + 50);
                const scrolled = await capturePageFeedbackGeometry(page, info, `${label}-sticky-user-scroll`, row, control,
                    await observedFocus.evaluate(observation => observation.count));
                await expect(alert).toBeInViewport({ratio: 1});
                await expect(row).toBeInViewport();
                await expect(control).toBeInViewport({ratio: 1});
                expect(Math.abs(scrolled.host.y)).toBeLessThanOrEqual(1);
                if (pilot) expect(scrolled.globalFocusEvents).toBe(0);
                const savedItem = (await readPacking(page.request, list.id)).items.find(candidate => candidate.id === item.id)!;
                expect(savedItem).toMatchObject({description: updatedDescription, selfAssigned: !pilot, assignedCount: pilot ? 0 : 1});
                expect(await page.evaluate(() => document.documentElement.dataset.pilotDocument)).toBe(marker);
                expect(navigation).toEqual([]);
            } finally {
                page.off('request', captureNavigation);
                await observedFocus.evaluate(observation => observation.stop());
                await observedFocus.dispose();
            }
        }
    });
}

for (const width of [1280, 390]) {
    test(`compares complete native Packing creation, table and quick-add surfaces at ${width}px`, async function comparesPackingSurfaces({page}, info) {
        await page.setViewportSize({width, height: 900});
        const browserErrors: string[] = [];
        page.on('pageerror', error => browserErrors.push(error.message));
        const list = await packingFixture(page.request);
        // Consume setup's one-time flash. The same actor, entity, storage and
        // viewport then supply both renderers without manufacturing application HTML.
        await page.request.get('/users/profile');
        const native: Record<string, Awaited<ReturnType<typeof readVisiblePresentation>>> = {};
        for (const pilot of [false, true]) {
            const prefix = pilot ? '/frontend-pilot' : '';
            const label = pilot ? 'pilot' : 'native';
            await page.goto(prefix + '/packing/create?locale=en', {waitUntil: 'domcontentloaded'});
            if (pilot) await waitForPilotHydration(page);
            await expect(page.locator('main tbody tr')).toHaveCount(1);
            const creation = await captureMatchedPresentation(page, info, label + '-packing-create', page.locator('main form').first(),
                ['label', 'input', 'textarea', 'select', 'th', 'td', 'button']);
            if (pilot) expectVisiblePresentation(native.creation!, creation);
            else native.creation = creation;

            // Native uses a div/span around this switch; its text is not an
            // implicit label. Retain every form label/field comparison above and
            // test its actual click boundary here, so changing a tag cannot silently
            // introduce a different user action behind a passing picture.
            const everyone = page.locator('main tbody tr').first().locator('.form-switch');
            const everyoneCheckbox = everyone.locator('input[type="checkbox"]');
            await everyone.locator('span').click();
            await expect(everyoneCheckbox).not.toBeChecked();
            await everyoneCheckbox.check();
            await expect(everyoneCheckbox).toBeChecked();
            await everyoneCheckbox.focus();
            await everyoneCheckbox.press('Space');
            await expect(everyoneCheckbox).not.toBeChecked();
            await everyoneCheckbox.press('Space');
            await expect(everyoneCheckbox).toBeChecked();
            await everyoneCheckbox.uncheck();

            await page.goto(prefix + list.path + '?locale=en', {waitUntil: 'domcontentloaded'});
            if (pilot) await waitForPilotHydration(page);
            const table = page.locator('main table');
            await expect(table.locator('tbody tr')).toHaveCount(1);
            // Native and Vue intentionally share the existing personal Packed
            // key. Restore its unchecked baseline before comparing each renderer.
            const packed = table.locator('tbody tr').first().getByRole('checkbox');
            await packed.uncheck();
            const detail = await captureMatchedPresentation(page, info, label + '-packing-table', table,
                ['th', 'td', 'input', 'button']);
            const quickAdd = await captureMatchedPresentation(page, info, label + '-packing-quick-add',
                page.locator(pilot ? 'form:has(#quick-title)' : '#quickAddForm'),
                ['label', 'input', 'button']);
            const focused = await captureMatchedPresentation(page, info, label + '-packing-table-focused', table,
                ['th', 'td', 'input', 'button'], packed);
            if (pilot) {
                expectVisiblePresentation(native.table!, detail);
                expectVisiblePresentation(native.quickAdd!, quickAdd);
                expectVisiblePresentation(native.focused!, focused);
            } else {
                native.table = detail;
                native.quickAdd = quickAdd;
                native.focused = focused;
            }
            await packed.check();
            await page.reload({waitUntil: 'domcontentloaded'});
            if (pilot) await waitForPilotHydration(page);
            await expect(packed).toBeChecked();
            const checked = await captureMatchedPresentation(page, info, label + '-packing-checked', table,
                ['th', 'td', 'input', 'button']);
            if (pilot) expectVisiblePresentation(native.checked!, checked);
            else native.checked = checked;
        }
        expect(browserErrors).toEqual([]);
    });

    test(`compares native Overview empty, populated and no-match states at ${width}px`, async function comparesOverviewStates({page}, info) {
        await page.setViewportSize({width, height: 900});
        const browserErrors: string[] = [];
        page.on('pageerror', error => browserErrors.push(error.message));
        await loginForE2E(page.request, createE2ELogin());
        const marker = 'Matched overview ' + randomUUID().slice(0, 8);
        expect((await page.request.post('/users/profile/create', {form: {name: marker}, maxRedirects: 0})).status()).toBe(302);
        const actor = (await bootstrap(page.request)).profiles.find(profile => profile.name === marker)!;
        expect((await page.request.get('/users/profile/change/' + actor.id, {maxRedirects: 0})).status()).toBe(302);
        await page.request.get('/users/profile');

        // A new profile establishes genuine empty membership without clearing a
        // shared account's resources. Creation below then changes only its own rows.
        let resource: Awaited<ReturnType<typeof createResourceViaForm>> | undefined;
        for (const state of ['empty', 'populated', 'no-match'] as const) {
            if (state === 'populated') {
                const input = createE2EPackingList();
                input.title = input.form.title = marker + ' list';
                resource = await createResourceViaForm(page.request, input);
                await page.request.get('/users/profile');
            }
            let original: Awaited<ReturnType<typeof readVisiblePresentation>> | undefined;
            for (const pilot of [false, true]) {
                const path = pilot ? '/frontend-pilot' : '/users/dashboard';
                // Native Overview owns a closed navigation query and rejects
                // pilot-only locale fields. Compare its real admitted URL, with
                // the same feature filter and the pilot's explicit English UI.
                const query = new URLSearchParams();
                if (pilot) query.set('locale', 'en');
                if (state === 'no-match') query.set('owner_main_q', 'NoMatchingOverviewFixture');
                const response = await page.goto(path + (query.size ? '?' + query.toString() : ''), {waitUntil: 'domcontentloaded'});
                expect(response?.status()).toBe(200);
                if (pilot) await waitForPilotHydration(page);
                await expect(page).toHaveTitle('My Dashboard | Surveyor');
                const owner = page.locator('[data-collection="owner"][data-region="main"]');
                const surface = state === 'populated' ? owner.locator(`[data-id="${resource!.id}"]`)
                    : owner.locator('.status-notice').filter({hasText: state === 'empty'
                        ? "You don't have any administrable entities yet" : 'No entities match your search and filter.'});
                await expect(surface).toBeVisible();
                if (pilot) await expect(owner).toHaveAttribute('aria-busy', 'false');
                const current = await captureMatchedPresentation(page, info, `${pilot ? 'pilot' : 'native'}-overview-${state}`,
                    surface, state === 'populated' ? ['h4', 'p', '.badge', 'button', 'summary[role="button"]', 'a'] : []);
                if (pilot) expectVisiblePresentation(original!, current);
                else original = current;
                // The approved Vue Refresh control is outside the compared card
                // and empty-state surfaces; native links remain the independent oracle.
                expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
            }
        }
        expect(browserErrors).toEqual([]);
    });
}

for (const intent of ['create', 'duplicate'] as const) {
    test(`boots the ${intent} skeleton before exposing working creation controls and upload`, async ({page}) => {
        await loginForE2E(page.request, createE2ELogin());
        const sourceInput = createE2EPackingList();
        const sourceRows = JSON.parse(sourceInput.form.items) as components['schemas']['PackingDuplicateItem'][];
        sourceRows[0]!.requiredByAll = true;
        sourceInput.form.items = JSON.stringify(sourceRows);
        const source = intent === 'duplicate'
            ? await createResourceViaForm(page.request, sourceInput) : null;
        const destination = source ? `/frontend-pilot/packing/${source.id}/duplicate` : '/frontend-pilot/packing/create';
        const entry = readGate();
        const started = readGate();
        const pattern = /\/app\/assets\/entry-client-[^/]+\.js(?:\?|$)/u;
        let commands = 0;
        const png = readFileSync('src/public/img/logo.png');
        const title = `Early ${intent} ${randomUUID()}`;
        const changedPermissions: {key: string; checked: boolean}[] = [];

        async function holdClient(route: Route): Promise<void> {
            started.release();
            await entry.promise;
            await route.continue();
        }
        function countCreation(request: Request): void {
            if (new URL(request.url()).pathname === '/api/v1/packing-lists' && request.method() === 'POST') commands++;
        }
        await page.route(pattern, holdClient);
        page.on('request', countCreation);
        try {
            // Hold only the actual built entry module. The genuine server document
            // supplies a skeleton, with no dead creation form or command to replay.
            await page.goto(destination, {waitUntil: 'commit'});
            await started.promise;
            await expect(page.locator('[data-pilot-initial-loading]')).toBeVisible();
            await expect(page.locator('#create-title')).toHaveCount(0);
            await expect(page.locator('#create-header')).toHaveCount(0);
            await expect(page.locator('#pilot-locale')).toBeDisabled();
            expect(commands).toBe(0);
            entry.release();
            await waitForPilotHydration(page);
            await expect(page.locator('[data-pilot-initial-loading]')).toHaveCount(0);
            await page.locator('#create-title').fill(title);
            const row = page.locator('main tbody tr').first();
            await row.locator('input[type="text"], input:not([type])').first().fill('Early equipment');
            await row.locator('input[type="number"]').fill('9');
            const requiredByAll = intent === 'create';
            expect(await row.locator('input[type="checkbox"]').isChecked()).toBe(!requiredByAll);
            await row.locator('input[type="checkbox"]').setChecked(requiredByAll);
            const permissions = page.locator('.perm-matrix input[type="checkbox"]');
            for (const checkbox of (await permissions.all()).slice(0, 2)) {
                const checked = !(await checkbox.isChecked());
                const key = (await checkbox.getAttribute('id'))!.split('-').at(-1)!;
                changedPermissions.push({key, checked});
                await checkbox.setChecked(checked);
            }
            expect(changedPermissions).toHaveLength(2);
            await page.locator('#create-header').setInputFiles({name: 'early.png', mimeType: 'image/png', buffer: png});
            expect(commands).toBe(0);
            await expect(row.locator('input[type="number"]')).toHaveValue('9');
            await expect(row.locator('input[type="checkbox"]')).toBeChecked({checked: requiredByAll});
            expect(commands).toBe(0);

            const created = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/packing-lists'
                && response.request().method() === 'POST');
            await page.locator('main form').getByRole('button', {name: 'Create list', exact: true}).click();
            const response = await created;
            expect(response.status()).toBe(201);
            const result = await response.json() as components['schemas']['PackingCreated'];
            const persisted = await readPacking(page.request, result.id);
            expect(persisted.title).toBe(title);
            expect(persisted.items[0]).toMatchObject({title: 'Early equipment', maxAssignees: 9, requiredByAll});
            expect(commands).toBe(1);

            const actor = await bootstrap(page.request);
            const settingsRead = await page.request.get(`/api/v1/packing-lists/${result.id}/settings`, {headers: headers(actor)});
            expect(settingsRead.status()).toBe(200);
            const saved = await settingsRead.json() as components['schemas']['PackingSettings'];
            for (const changed of changedPermissions) {
                const bit = saved.access!.permissions.find(permission => permission.key === changed.key)!.bit;
                expect(Boolean(saved.access!.defaults.participant & bit)).toBe(changed.checked);
            }
            expect(persisted.headerUrl).not.toBeNull();
            const upload = await page.request.get(persisted.headerUrl!, {headers: headers(actor)});
            expect(upload.status()).toBe(200);
            expect(await upload.body()).toEqual(png);
        } finally {
            entry.release();
            page.off('request', countCreation);
            await page.unroute(pattern, holdClient);
        }
    });
}

/** Measure the real initial flash and the following form in the same browser. */
function createAdmissionPresentation() {
    const notice = document.querySelector<HTMLElement>('main .alert-info')!;
    const card = document.querySelector<HTMLElement>('main .card')!;
    const noticeBounds = notice.getBoundingClientRect();
    const cardBounds = card.getBoundingClientRect();
    const style = getComputedStyle(notice);

    return {
        text: notice.textContent!.trim(),
        typography: {fontFamily: style.fontFamily, fontSize: style.fontSize, lineHeight: style.lineHeight},
        notice: {x: noticeBounds.x, y: noticeBounds.y, width: noticeBounds.width, height: noticeBounds.height},
        card: {x: cardBounds.x, y: cardBounds.y, width: cardBounds.width, height: cardBounds.height},
    };
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

test('preserves native existing-capacity edits through the real browser and persistence', async ({page}) => {
    const resource = await packing(page);
    await waitForPilotHydration(page);
    const original = (await readPacking(page.request, resource.id)).items[0]!;
    const row = page.locator(`tr[data-item-id="${original.id}"]`);
    const cases = [{draft: '0', saved: 0}, {draft: '-1', saved: -1},
        {draft: '1.5', saved: 2}, {draft: '-1.5', saved: -2}];

    const native = await page.context().newPage();
    try {
        await native.goto(resource.path, {waitUntil: 'domcontentloaded'});
        // Number inputs do not expose selectionStart/End. Compare the actual first
        // keystroke in both text and number editors instead of inferring caret state.
        // Escape discards these drafts; the persistence assertions below retain the
        // original fixture and continue through the real command boundary.
        for (const field of [
            {nativeName: 'title', column: 2, original: original.title.trim()},
            {nativeName: 'maxAssignees', column: 4, original: String(original.maxAssignees)},
        ]) {
            const nativeCell = native.locator(`td[data-id="${original.id}"][data-edit="${field.nativeName}"]`);
            await nativeCell.dblclick();
            const nativeInput = nativeCell.locator('input');
            await expect(nativeInput).toBeFocused();
            await nativeInput.press('2');
            const nativeDraft = await nativeInput.inputValue();
            await nativeInput.fill(field.original);
            await nativeInput.press('Escape');
            await expect(nativeCell.locator('input')).toHaveCount(0);

            const pilotCell = row.locator('td').nth(field.column);
            await pilotCell.dblclick();
            const pilotInput = pilotCell.locator('input');
            await expect(pilotInput).toBeFocused();
            await pilotInput.press('2');
            await expect(pilotInput).toHaveValue(nativeDraft);
            await pilotInput.fill(field.original);
            await pilotInput.press('Escape');
            await expect(pilotCell.locator('input')).toHaveCount(0);
        }
    } finally { await native.close(); }

    // Native sends each raw number-control draft on Enter without form validation.
    // The real command and follow-up read must retain SQL rounding, including a
    // decimal that the browser would reject if implicit step=1 were enforced.
    for (const example of cases) {
        await row.locator('td').nth(4).dblclick();
        const input = row.getByRole('spinbutton', {name: 'Assigned / Max', exact: true});
        expect(await input.getAttribute('min')).toBeNull();
        expect(await input.getAttribute('required')).toBeNull();
        await input.fill(example.draft);
        await packingCommand(page, resource.id, `/items/${original.id}`, 'PATCH', () => input.press('Enter'));
        await expect(row.locator('td').nth(4)).toHaveText(`0 / ${example.saved}`);
        expect((await readPacking(page.request, resource.id)).items[0]!.maxAssignees).toBe(example.saved);
    }

    // The supported strict-SQL test environment rejects a raw blank numeric value.
    // Preserve that native database outcome instead of converting Number('') to zero
    // in the browser; a permissive server can legitimately coerce the same raw input.
    await row.locator('td').nth(4).dblclick();
    const empty = row.getByRole('spinbutton', {name: 'Assigned / Max', exact: true});
    await empty.fill('');
    await packingCommand(page, resource.id, `/items/${original.id}`, 'PATCH', () => empty.press('Enter'), 500);
    expect((await readPacking(page.request, resource.id)).items[0]!.maxAssignees).toBe(-2);
});

test('accepts native Unicode titles without imposing a new browser length policy', async ({page}) => {
    await loginForE2E(page.request, createE2ELogin());
    const title = '\u{1f600}'.repeat(128);
    const itemTitle = '\u{1f680}'.repeat(128);
    expect(title.length).toBe(256);
    expect([...title]).toHaveLength(128);
    await page.goto('/frontend-pilot/packing/create?locale=en', {waitUntil: 'domcontentloaded'});
    await waitForPilotHydration(page);
    const rootTitle = page.locator('#create-title');
    const firstRow = page.locator('main tbody tr').first();
    const rowTitle = firstRow.getByRole('textbox', {name: 'Item 1', exact: true});
    expect(await rootTitle.getAttribute('maxlength')).toBeNull();
    expect(await rowTitle.getAttribute('maxlength')).toBeNull();
    await rootTitle.fill(title);
    await rowTitle.fill(itemTitle);
    const creation = page.waitForResponse(response => response.request().method() === 'POST'
        && new URL(response.url()).pathname === '/api/v1/packing-lists');
    await page.getByRole('button', {name: 'Create list', exact: true}).click();
    const created = await creation;
    expect(created.status()).toBe(201);
    const {id} = await created.json() as components['schemas']['PackingCreated'];
    await expect(page).toHaveURL(new RegExp(`/frontend-pilot/packing/${id}(?:\\?|$)`, 'u'));
    await expect(page.locator('tr[data-item-id]').first()).toBeVisible();
    const projection = await readPacking(page.request, id);
    expect(projection.title).toBe(title);
    expect(projection.items[0]!.title).toBe(itemTitle);

    const quickTitle = page.locator('#quick-title');
    expect(await quickTitle.getAttribute('maxlength')).toBeNull();
    await quickTitle.fill(title);
    await packingCommand(page, id, '/items', 'POST', () => page.getByRole('button', {name: 'Add', exact: true}).click(), 201);
    // The command response precedes its authoritative list refresh. The native
    // quick-add reset is the observable completion boundary for opening an editor.
    await expect(quickTitle).toHaveValue('');
    const row = page.locator(`tr[data-item-id="${projection.items[0]!.id}"]`);
    await row.locator('td').nth(2).dblclick();
    const inlineTitle = row.getByRole('textbox', {name: 'Title', exact: true});
    expect(await inlineTitle.getAttribute('maxlength')).toBeNull();
    await inlineTitle.fill(title);
    await packingCommand(page, id, `/items/${projection.items[0]!.id}`, 'PATCH', () => inlineTitle.press('Enter'));
    await expect(row.locator('td').nth(2)).toHaveText(title);
});

/** Exercise identical native keyboard/pointer disclosure semantics in each delivered shell.
 * Keep ordinary links/native fields rather than testing a replacement menu fixture. */
async function navigationDisclosure(page: Page): Promise<void> {
    const create = page.locator('header .dropdown-toggle').filter({hasText: /^\s*New\s*$/});
    const menu = create.locator('..').locator('.dropdown-menu');
    const overview = page.locator('header .dropdown-toggle').filter({hasText: /^\s*Overview\s*$/});
    await create.focus();
    await page.keyboard.press('ArrowDown');
    // Native icon fonts contribute their glyph to the accessible name; the pilot
    // hides decorative icons. Match the same visible label suffix on both shells.
    await expect(menu.getByRole('link', {name: /Survey$/u})).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(create).toBeFocused();

    await page.keyboard.press('ArrowDown');
    await menu.getByRole('link', {name: /Drivers list$/u}).focus();
    await page.keyboard.press('Tab');
    await expect(menu).toBeHidden();
    await expect(overview).toBeFocused();
    await page.keyboard.press('ArrowDown');
    const second = overview.locator('..').locator('.dropdown-menu');
    await expect(second.getByRole('link', {name: /Your overview$/u})).toBeFocused();
    await expect(menu).toBeHidden();
    await page.keyboard.press('Escape');
    await expect(overview).toBeFocused();
    await create.click();
    await expect(menu).toBeVisible();
    await page.locator('main').click({position: {x: 2, y: 2}});
    await expect(menu).toBeHidden();
}

test('shared entry preserves header creation admission, exact duplicate login return and canonical guest completion', async ({request, browser, baseURL}, testInfo) => {
    test.setTimeout(60_000);
    const credentials = createE2ELogin();
    await loginForE2E(request, credentials);
    const input = createE2EPackingList();
    Object.assign(input.form, {'defaultPerms[public][0]': 'DATA_DUPLICATE'});
    const list = await createResourceViaForm(request, input);
    const anonymous = await browser.newContext({baseURL});
    // The native oracle owns an independent cookie session, so another live
    // application's activity cannot affect the flash being compared at redirect.
    const nativeAnonymous = await browser.newContext({baseURL});
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

        // Compare the native redirect's real initial flash with the hydrated SPA
        // admission result. An empty live-alert margin belongs after native flashes;
        // putting the flash inside it would shift the entire form down by four pixels.
        const nativeLogin = await nativeAnonymous.newPage();
        // Native redirect headers can arrive before the session store finishes its
        // flash write, including in native-only navigation. Complete the real 302
        // response before following its exact Location to obtain a stable visual
        // oracle; retain all route, session, wording and geometry assertions.
        const nativeAdmission = await nativeAnonymous.request.get('/packing/create', {maxRedirects: 0});
        expect(nativeAdmission.status()).toBe(302);
        await nativeAdmission.body();
        const nativeDestination = new URL(nativeAdmission.headers().location, baseURL);
        expect(nativeDestination.pathname).toBe('/users/login');
        expect(nativeDestination.searchParams.get('next')).toBe('/packing/create');
        await nativeLogin.goto(nativeDestination.href, {waitUntil: 'domcontentloaded'});
        await expect(nativeLogin.locator('main .alert-info')).toBeVisible();
        const entryViewport = visitor.viewportSize();
        const presentations = [];
        for (const [size, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]] as const) {
            await nativeLogin.setViewportSize({width, height});
            await visitor.setViewportSize({width, height});
            await nativeLogin.evaluate(() => document.fonts.ready);
            await visitor.evaluate(() => document.fonts.ready);
            const native = await nativeLogin.evaluate(createAdmissionPresentation);
            const pilot = await visitor.evaluate(createAdmissionPresentation);
            presentations.push({size, native, pilot});
        }
        await testInfo.attach('account-required-create-presentation', {
            body: JSON.stringify(presentations, null, 2), contentType: 'application/json',
        });
        await captureState(nativeLogin, testInfo, 'native-account-required-create');
        await captureState(visitor, testInfo, 'pilot-account-required-create');
        for (const {native, pilot} of presentations) {
            expect(pilot.text).toBe(native.text);
            expect(pilot.typography).toEqual(native.typography);
            for (const dimension of ['x', 'y', 'width', 'height'] as const) {
                expect(Math.abs(pilot.notice[dimension] - native.notice[dimension])).toBeLessThanOrEqual(1);
                expect(Math.abs(pilot.card[dimension] - native.card[dimension])).toBeLessThanOrEqual(1);
            }
        }
        if (entryViewport) await visitor.setViewportSize(entryViewport);
        await nativeLogin.close();

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
        const flash = guestPage.locator('.alert-success');
        const privateLink = (await flash.innerText()).match(/^Login successful\. Use (\S+) to edit later\.$/)?.[1];
        expect(privateLink).toBeDefined();
        await expect(flash.locator('a, button')).toHaveCount(0);
        await expect(flash).toHaveText(`Login successful. Use ${privateLink} to edit later.`);
        expect((await bootstrap(guestPage.request)).activeProfile?.name).toBe(name);
        expect(await guestPage.evaluate(() => document.documentElement.dataset.entryDocument)).toBe('guest');
    } finally {
        await anonymous.close();
        await nativeAnonymous.close();
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
    // Native Help has no resource-specific return link. Browser Back restores the
    // previous visit while preserving the enhanced document and personal Packed state.
    await page.goBack();
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
    // Initial HTML carries the authoritative session and shared startup skeleton.
    // Independent region shells mount after initialization, without waiting for
    // all four Overview projections before the browser can show ready content.
    expect(JSON.parse(serialized![1]).overview).toBeUndefined();
    expect(html).toContain('data-pilot-initial-loading');

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
        await expect(page.locator('main [data-loading-skeleton]:visible')).toHaveCount(0);
        await captureState(page, testInfo, 'loading-packing-loaded');

        await page.getByRole('button', {name: 'Entity settings', exact: true}).click();
        const dialog = page.getByRole('dialog');
        const title = dialog.locator('[name="title"]');
        // The genuine metadata read completes while the independent settings read
        // is held. Its authorized form can already accept a local draft.
        await expect(title).toBeVisible();
        await expect(dialog.locator('[data-loading-skeleton]:visible')).toBeVisible();
        await title.fill('Draft entered before access and header arrive');
        await expect(title).toBeFocused();
        await captureState(page, testInfo, 'loading-settings-metadata-ready', dialog, {viewportOnly: true});
        settingsGate.release();
        // Inactive panels preserve their mounted drafts. Their undisclosed picker
        // may retain a placeholder until discovery is enabled by opening that panel.
        await expect(dialog.locator('[data-loading-skeleton]:visible')).toHaveCount(0);
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

test('JavaScript-disabled pilot identity has no form fallback while native login and body-free API logout stay functional', async ({browser, baseURL}) => {
    const context = await browser.newContext({baseURL, javaScriptEnabled: false});
    try {
        const page = await context.newPage();
        const credentials = createE2ELogin();
        await page.goto('/frontend-pilot/users/login?locale=de', {waitUntil: 'domcontentloaded'});
        await expect(page.locator('#surveyor-pilot-javascript-required')).toBeVisible();
        await expect(page.locator('#pilot-main form')).toHaveCount(0);
        await expect(page.locator('#pilot-locale')).toBeDisabled();
        const anonymous = await bootstrap(context.request);
        const retired = await context.request.post('/frontend-pilot/users/login', {
            form: {...credentials}, maxRedirects: 0,
        });
        expect(retired.status()).toBe(404);
        expect((await bootstrap(context.request)).context).toBe(anonymous.context);

        // The native reference remains an ordinary usable HTML login. The API's
        // body-free logout independently keeps its authored context/CSRF admission.
        await page.goto('/users/login', {waitUntil: 'domcontentloaded'});
        await page.locator('#username').fill(credentials.username);
        await page.locator('#password').fill(credentials.password);
        await page.locator('form[action^="/users/login"] button[type="submit"]').click();
        expect((await bootstrap(context.request)).kind).toBe('account');
        const account = await bootstrap(context.request);
        const logout = await context.request.post('/api/v1/auth/logout', {headers: headers(account)});
        expect(logout.status()).toBe(200);
        expect(await logout.json()).toMatchObject({session: {kind: 'anonymous'}, personalLink: null, redirect: null});
        expect((await bootstrap(context.request)).kind).toBe('anonymous');
        await page.goto('/frontend-pilot/users/login?locale=de', {waitUntil: 'domcontentloaded'});
        await expect(page.locator('#surveyor-pilot-javascript-required')).toBeVisible();
        await expect(page.locator('html')).toHaveAttribute('lang', 'de');
        await expect(page.locator('#pilot-main form')).toHaveCount(0);
    } finally { await context.close(); }
});

for (const failure of ['entry load', 'route initialization'] as const) {
    test(`real built ${failure} failure exposes the localized notice without dead interactive controls`, async ({browser, baseURL}) => {
        const context = await browser.newContext({baseURL});
        try {
            const page = await context.newPage();
            const pattern = failure === 'entry load'
                ? /\/app\/assets\/entry-client-[^/]+\.js(?:\?|$)/u
                : /\/app\/assets\/IdentityPage-[^/]+\.js(?:\?|$)/u;
            let blocked = 0;
            let commands = 0;
            async function rejectActualModule(route: Route): Promise<void> {
                blocked++;
                await route.abort('failed');
            }
            function countCommand(request: Request): void {
                if (new URL(request.url()).pathname.startsWith('/api/v1/')
                    && !['GET', 'HEAD'].includes(request.method())) commands++;
            }
            await page.route(pattern, rejectActualModule);
            page.on('request', countCommand);
            try {
                await page.goto('/frontend-pilot/users/login?locale=de', {waitUntil: 'domcontentloaded'});
                const notice = page.locator('#surveyor-pilot-javascript-required');
                await expect(notice).toBeVisible();
                await expect(notice.locator('[data-pilot-startup-failure]')).toBeVisible();
                await expect(notice).toContainText('Diese Seite konnte nicht vollständig geladen werden.');
                expect(blocked).toBeGreaterThan(0);
                await expect(page.locator('#pilot-main form')).toHaveCount(0);
                await expect(page.locator('#pilot-locale')).toBeDisabled();
                await expect(page.locator('header button[type="submit"]')).toHaveCount(0);
                expect(commands).toBe(0);

                // The notice's anchor remains a real server navigation. Static Help
                // does not depend on the rejected interactive feature chunk.
                await notice.getByRole('link', {name: 'Hilfe', exact: true}).click();
                await expect(page.locator('.help-content')).toBeVisible();
            } finally {
                page.off('request', countCommand);
                await page.unroute(pattern, rejectActualModule);
            }
        } finally { await context.close(); }
    });
}

test('pilot owner keyboard dialog and mobile guest assignment retain readable, reachable controls', async ({page, browser, baseURL}, testInfo) => {
    await page.setViewportSize({width: 1280, height: 900});
    const list = await packing(page, true);
    const pilotBadgeGaps = await counterBadgeGaps(page.locator('main'));
    expect(pilotBadgeGaps).toHaveLength(4);
    const edit = page.getByRole('button', {name: 'Entity settings', exact: true});
    await edit.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toBeFocused();
    const pilotAccessGap = await accessTabGap(dialog);
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
        expect(await counterBadgeGaps(native.locator('main'))).toEqual(pilotBadgeGaps);
        const nativeDialog = native.locator('#entityPropertiesModal');
        // Bootstrap reveals the modal before its transition and focus trap finish.
        // Start keyboard assertions only after the same native shown event used by
        // the existing modal workflows, rather than racing its final autofocus.
        await Promise.all([
            nativeDialog.evaluate(function waitForNativeModalShown(element) {
                return new Promise<void>(function awaitShown(resolve) {
                    element.addEventListener('shown.bs.modal', function modalShown() { resolve(); }, {once: true});
                });
            }),
            native.locator('button[data-bs-target="#entityPropertiesModal"]').click(),
        ]);
        await expect(nativeDialog).toBeVisible();
        await expect(nativeDialog).toBeFocused();
        expect(await accessTabGap(nativeDialog)).toBe(pilotAccessGap);
        await checkTabs(nativeDialog);
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

test('native and pilot pristine properties Save has identical feedback and pilot pending work freezes Settings', async ({page}, testInfo) => {
    test.setTimeout(60_000);
    const list = await packingFixture(page.request);
    const noChanges = 'There are no property changes to save.';
    let nativeWrites = 0;

    // Compare the real native no-op first. Its form URL identifies the established
    // mutation boundary; counting it also catches a mistaken native POST, not only PATCH.
    await page.goto(list.path + '?locale=en', {waitUntil: 'domcontentloaded'});
    await page.locator('button[data-bs-target="#entityPropertiesModal"]').click();
    const nativeDialog = page.locator('#entityPropertiesModal');
    const nativeForm = nativeDialog.locator('[data-property-form]');
    const nativeUrl = await nativeForm.getAttribute('data-api');
    expect(nativeUrl).toBeTruthy();
    const nativePattern = '**' + nativeUrl!;
    async function observeNativeProperties(route: Route): Promise<void> {
        if (route.request().method() !== 'GET') nativeWrites++;
        await route.continue();
    }
    await page.route(nativePattern, observeNativeProperties);
    try {
        await nativeDialog.getByRole('button', {name: 'Save properties', exact: true}).click();
        await expect(nativeDialog.locator('.alert-info')).toHaveText(noChanges);
        await expect(nativeDialog.locator('.alert-info')).toHaveAttribute('role', 'alert');
        await expect(nativeDialog.locator('.alert-info').getByRole('button', {name: 'Dismiss notification', exact: true})).toBeVisible();
        expect(nativeWrites).toBe(0);
        await captureState(page, testInfo, 'native-pristine-properties', nativeDialog, {viewportOnly: true});
    } finally { await page.unroute(nativePattern, observeNativeProperties); }

    const metadataPattern = '**/api/v1/packing-lists/' + list.id + '/metadata';
    const settingsPattern = '**/api/v1/packing-lists/' + list.id + '/settings';
    const writeStarted = readGate();
    const writeGate = readGate();
    const settingsStarted = readGate();
    const settingsGate = readGate();
    let pilotWrites = 0;

    /** Commit the real PATCH, holding only its response. The component still owns
     * a pending command until that delivery and its genuine dependent read finish. */
    async function holdPropertiesResponse(route: Route): Promise<void> {
        if (route.request().method() !== 'PATCH') { await route.continue(); return; }
        pilotWrites++;
        const committed = await route.fetch();
        expect(committed.status()).toBe(200);
        writeStarted.release();
        await writeGate.promise;
        await route.fulfill({response: committed});
    }
    async function holdDependentSettings(route: Route): Promise<void> {
        if (pilotWrites) { settingsStarted.release(); await settingsGate.promise; }
        await route.continue();
    }
    await page.route(metadataPattern, holdPropertiesResponse);
    await page.route(settingsPattern, holdDependentSettings);
    try {
        await page.goto('/frontend-pilot/packing/' + list.id + '?locale=en', {waitUntil: 'domcontentloaded'});
        await page.getByRole('button', {name: 'Entity settings', exact: true}).click();
        const dialog = page.getByRole('dialog');
        await expect(dialog.locator('.entity-settings-nav [role="tab"]')).toHaveCount(4);
        const save = dialog.getByRole('button', {name: 'Save properties', exact: true});
        await expect(save).toBeEnabled();
        await save.click();
        await expect(dialog.locator('.alert-info')).toHaveText(noChanges);
        await expect(dialog.locator('.alert-info')).toHaveAttribute('role', 'alert');
        await expect(dialog.locator('.alert-info').getByRole('button', {name: 'Dismiss notification', exact: true})).toBeVisible();
        expect(pilotWrites).toBe(0);
        await captureState(page, testInfo, 'pilot-pristine-properties', dialog, {viewportOnly: true});

        // Make Review a real rendered control rather than an empty selector. Keep a
        // local audience draft while a second HTTP client changes that same mask.
        // The normal focus refresh discovers its conflict without replacing any UI.
        const actor = await bootstrap(page.request);
        const settingsRead = await page.request.get(`/api/v1/packing-lists/${list.id}/settings`, {headers: headers(actor)});
        expect(settingsRead.status()).toBe(200);
        const snapshot = await settingsRead.json() as components['schemas']['PackingSettings'];
        expect(snapshot.access).not.toBeNull();
        const accessPermission = snapshot.access!.permissions.find(permission => permission.key === 'ACCESS_VIEW')!;
        const titlePermission = snapshot.access!.permissions.find(permission => permission.key === 'EDIT_TITLE')!;
        expect(accessPermission).toBeDefined();
        expect(titlePermission).toBeDefined();
        await dialog.getByRole('tab', {name: 'Access', exact: true}).click();
        await dialog.getByLabel('Permission audience', {exact: true}).selectOption('guest');
        await dialog.locator('#settings-defaults-guest-ACCESS_VIEW').setChecked(!(snapshot.access!.defaults.guest & accessPermission.bit));
        expect((await page.request.put(`/api/v1/packing-lists/${list.id}/default-permissions`, {
            headers: {...headers(actor), 'If-Match': snapshot.settingsToken},
            data: {guest: snapshot.access!.defaults.guest ^ titlePermission.bit},
        })).status()).toBe(200);
        const refreshedSettings = page.waitForResponse(response =>
            new URL(response.url()).pathname === `/api/v1/packing-lists/${list.id}/settings`
            && response.request().method() === 'GET' && response.status() === 200);
        await page.evaluate(() => window.dispatchEvent(new Event('focus')));
        await refreshedSettings;
        const review = dialog.locator('#pilot-access-defaults').getByRole('button', {name: 'Review changes', exact: true, includeHidden: true});
        await expect(review).toBeVisible();
        await expect(review).toBeEnabled();
        await dialog.getByRole('tab', {name: 'General', exact: true}).click();

        const submitted = 'Pending browser save ' + list.title;
        await dialog.locator('[name="title"]').fill(submitted);
        await save.click();
        await writeStarted.promise;

        /** Native pending locks include hidden tab groups and every currently
         * rendered form/disclosure/review control. Use effective HTML disabled state
         * so fieldset inheritance is tested rather than requiring a decorative attribute. */
        async function expectFrozenSettings(): Promise<void> {
            const unlocked = await dialog.locator('button, input, select, textarea').evaluateAll(function unlockedControls(controls) {
                return controls.filter(control => !control.matches(':disabled')).map(control => ({
                    tag: control.tagName.toLowerCase(), id: control.id, name: control.getAttribute('name'),
                    type: control.getAttribute('type'), label: control.getAttribute('aria-label') ?? control.textContent?.trim(),
                    panel: control.closest('[role="tabpanel"]')?.id,
                    visible: !!control.getClientRects().length,
                }));
            });
            expect(unlocked, 'Every rendered Settings control must stay locked during the held command/read').toEqual([]);
            // Native disabled tabs retain their last tabindex. Test effective
            // keyboard/programmatic focus rather than Reka's decorative attribute.
            expect(await dialog.locator('[role="tab"]').evaluateAll(function tabsRejectFocus(tabs) {
                for (const tab of tabs) (tab as HTMLElement).focus();
                return tabs.every(tab => tab.matches(':disabled') && tab !== document.activeElement);
            })).toBe(true);
            await expect(review).toBeDisabled();
            await page.keyboard.press('Tab');
            expect(await dialog.locator('[role="tab"]').evaluateAll(function tabsRejectKeyboardFocus(tabs) {
                return tabs.every(tab => tab !== document.activeElement);
            })).toBe(true);
            await page.keyboard.press('ArrowRight');
            await page.keyboard.press('ArrowDown');
            await expect(dialog.locator('#pilot-settings-tab-general')).toHaveAttribute('aria-selected', 'true');
            await expect(dialog.locator('#pilot-access-defaults-tab')).toHaveAttribute('aria-selected', 'true');
            await page.keyboard.press('Escape');
            await expect(dialog).toBeVisible();
        }
        await expectFrozenSettings();
        await expect(dialog.locator('[name="title"]')).toHaveValue(submitted);
        await captureState(page, testInfo, 'pilot-properties-command-pending', dialog, {viewportOnly: true});

        writeGate.release();
        await settingsStarted.promise;
        await expectFrozenSettings();
        await captureState(page, testInfo, 'pilot-properties-dependent-read-pending', dialog, {viewportOnly: true});
        settingsGate.release();
        await expect(save).toBeEnabled();
        await expect(dialog.getByRole('button', {name: 'Close', exact: true}).last()).toBeEnabled();
        expect(pilotWrites).toBe(1);
        expect((await readPacking(page.request, list.id)).title).toBe(submitted);

        // Both tab groups and their disclosure recover after the same operation;
        // keyboard navigation must not remain detached after its disabled interval.
        await dialog.getByRole('tab', {name: 'General', exact: true}).focus();
        await page.keyboard.press('ArrowRight');
        await expect(dialog.getByRole('tab', {name: 'Linked event', exact: true})).toBeFocused();
        await dialog.getByRole('tab', {name: 'Access', exact: true}).click();
        await expect(review).toBeEnabled();
        await dialog.getByRole('tab', {name: 'Administrators', exact: true}).click();
        const admins = dialog.locator('#pilot-access-admins');
        await expect(admins.getByRole('button', {name: 'Add', exact: true}).first()).toBeEnabled();
        await admins.getByRole('button', {name: 'Add', exact: true}).first().click();
        await expect(admins.getByLabel('User (name or email)', {exact: true})).toBeVisible();
    } finally {
        writeGate.release();
        settingsGate.release();
        await page.unroute(metadataPattern, holdPropertiesResponse);
        await page.unroute(settingsPattern, holdDependentSettings);
    }
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
    await expect(dialog.getByRole('button', {name: 'Save properties', exact: true})).toBeEnabled();
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
    await expect(addedRow).toHaveAttribute('draggable', 'true');
    await expect(row).toHaveAttribute('draggable', 'true');
    // The retained failure trace showed the document scrolling between mouse
    // down/up (69 -> 76 -> 0), leaving the targets only two screen pixels apart
    // and sending no command. Finish fixture scrolling before the real gesture;
    // both rows must remain fully visible without dragTo scrolling either one.
    await addedRow.locator('xpath=ancestor::table').evaluate(function positionDragTable(table) {
        table.scrollIntoView({block: 'center', behavior: 'instant'});
    });
    await expect(addedRow).toBeInViewport({ratio: 1});
    await expect(row).toBeInViewport({ratio: 1});
    // Blank first-cell padding avoids controls and retains a meaningful native
    // pointer movement. The existing HTTP/UI/persisted-order assertions follow.
    await packingCommand(page, resource.id, '/item-order', 'PUT', () => addedRow.dragTo(row, {
        sourcePosition: {x: 5, y: 5}, targetPosition: {x: 25, y: 5},
    }));
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
        // Native manager assignment removal submits immediately. Register a confirm
        // handler only for the later item deletion, which actually asks for consent.
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
        await expect(dialog.getByRole('button', {name: 'Save properties', exact: true})).toBeEnabled();
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
        await expect(dialog.getByRole('button', {name: 'Save properties', exact: true})).toBeEnabled();
        await dialog.getByRole('button', {name: 'Close', exact: true}).last().click();
        await expect(page.getByRole('link', {name: 'Go to event', exact: true})).toHaveAttribute('href', '/frontend-pilot' + event.path);
        expect((await readPacking(page.request, resource.id)).description).toBe('Preserved while visiting other settings');
    } finally { await delegate.close(); }
});

test('pilot creates and duplicates complete lists through the SPA forms with row and Everyone controls', async ({page}, testInfo) => {
    test.setTimeout(60_000);
    await loginForE2E(page.request, createE2ELogin());
    // Repeated contextual values remain a native no-selection URL. Fragment movement
    // must not mistake the router's new query-array objects for a new creation draft.
    const contextualIds = [randomUUID(), randomUUID()];
    await page.goto('/frontend-pilot/packing/create?eventId=' + contextualIds.join('&eventId='), {waitUntil: 'domcontentloaded'});
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
    const admissionPattern = '**/api/v1/packing-lists/create-entry**';
    const creationPattern = '**/api/v1/packing-lists';
    const admissionStarted = readGate();
    const admissionGate = readGate();
    let creations = 0;
    async function holdSubmissionAdmission(route: Route): Promise<void> {
        const admitted = await route.fetch();
        expect(admitted.status()).toBe(200);
        admissionStarted.release();
        await admissionGate.promise;
        await route.fulfill({response: admitted});
    }
    async function observeCreation(route: Route): Promise<void> {
        if (route.request().method() === 'POST') creations++;
        await route.continue();
    }
    await page.route(admissionPattern, holdSubmissionAdmission);
    await page.route(creationPattern, observeCreation);
    const created = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/packing-lists'
        && response.request().method() === 'POST');
    let originalId: string;
    try {
        await page.getByRole('button', {name: 'Create list', exact: true}).click();
        await admissionStarted.promise;
        expect(creations).toBe(0);

        // Use the browser's real same-document navigation, retaining the submitted
        // title, row collection and repeated query values while the server read is held.
        await page.evaluate(() => { window.location.hash = 'create-title'; });
        await expect(page).toHaveURL(/#create-title$/);
        expect(new URL(page.url()).searchParams.getAll('eventId')).toEqual(contextualIds);
        await expect(page.getByLabel('Title *', {exact: true})).toHaveValue(title);
        await expect(page.getByRole('textbox', {name: 'Item 1', exact: true})).toHaveValue('Tent');
        await expect(page.getByRole('textbox', {name: 'Item 2', exact: true})).toHaveValue('Bottle');
        await expect(page.locator('tbody tr').nth(1).getByRole('checkbox')).toBeChecked();
        await captureState(page, testInfo, 'creation-admission-fragment-draft');
        admissionGate.release();

        const createResponse = await created;
        expect(createResponse.status()).toBe(201);
        originalId = (await createResponse.json()).id as string;
        expect(creations).toBe(1);
    } finally {
        admissionGate.release();
        await page.unroute(admissionPattern, holdSubmissionAdmission);
        await page.unroute(creationPattern, observeCreation);
    }
    await expect(page).toHaveURL(new RegExp('/frontend-pilot/packing/' + originalId + '$'));
    await expect(page.getByRole('heading', {name: title, exact: true})).toBeVisible();
    const original = await readPacking(page.request, originalId);
    expect(original.currentEventId).toBeNull();
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
    await expect(owner).toContainText('1 matching entities');

    // A near-bottom card menu must stay reachable without scrolling after it opens,
    // including when the keyboard selects its first action.
    const archiveTrigger = ownedCard.getByRole('button', {name: 'Archival and visibility for ' + input.title, exact: true});
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

    await owner.getByRole('searchbox').fill('');
    // Native search commits after 300 ms and replaces/closes its old disclosure.
    // Open Filter only after that observable region refresh has settled.
    await expect(page).not.toHaveURL(/[?&]owner_main_q=/);
    await expect(owner).toHaveAttribute('aria-busy', 'false');
    await owner.getByRole('button', {name: 'Filter', exact: true}).click();
    await owner.getByRole('button', {name: 'All types', exact: true}).click();
    const eventCard = owner.locator(`[data-id="${event.id}"]`);
    await expect(eventCard).toContainText('Show linked entities (1)');
    const expansion = eventCard.getByRole('link', {name: 'Show linked entities for ' + event.title, exact: true});
    const originalUrl = page.url();
    const popupOpened = page.context().waitForEvent('page');
    await expansion.click({modifiers: ['Control']});
    const popup = await popupOpened;
    try { await expect(popup).toHaveURL(new RegExp('owner_main_event=' + event.id)); }
    finally { await popup.close(); }
    expect(page.url()).toBe(originalUrl);
    // Previous commands left timed alerts above this region. Dismiss them through their
    // actual controls before measuring scroll, so expiry cannot remove height during Back.
    const transientAlerts = page.locator('#liveAlerts .alert');
    while (await transientAlerts.count()) {
        await transientAlerts.first().getByRole('button', {name: 'Dismiss notification', exact: true}).click();
    }
    await expect(transientAlerts).toHaveCount(0);
    await page.evaluate(() => document.fonts.ready);
    await expansion.scrollIntoViewIfNeeded();
    const originalScroll = await page.evaluate(() => window.scrollY);
    await expansion.click();
    await expect(page).toHaveURL(new RegExp('owner_main_event=' + event.id));
    await expect(owner.locator('.entity-overview-children')).toContainText(linked.title);
    await expect(owner.locator('.entity-overview-children')).toContainText('Linked entities 1–1 of 1');
    await owner.getByRole('link', {name: 'Back to overview', exact: true}).click();
    await expect(owner.locator('.entity-overview-children')).toHaveCount(0);
    await expect(expansion).toBeFocused();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeCloseTo(originalScroll, 0);
    await eventCard.getByRole('link', {name: 'Show linked entities for ' + event.title, exact: true}).click();
    await owner.locator(`[data-id="${linked.id}"] > a.card-body`).click();
    await expect(page).toHaveURL(new RegExp('/frontend-pilot/packing/' + linked.id + '$'));
    await expect(page.getByRole('heading', {name: linked.title, exact: true})).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.dataset.pilotDocument)).toBe('overview');
});

test('native and pilot disclosures keep link semantics and pilot failed pagination retains its confirmed region', async ({page}) => {
    test.setTimeout(90_000);
    await loginForE2E(page.request, createE2ELogin());
    const marker = `Navigation ${randomUUID().slice(0, 8)}`;
    expect((await page.request.post('/users/profile/create', {form: {name: marker}, maxRedirects: 0})).status()).toBe(302);
    const actor = (await bootstrap(page.request)).profiles.find(profile => profile.name === marker)!;
    expect((await page.request.get('/users/profile/change/' + actor.id, {maxRedirects: 0})).status()).toBe(302);
    const scope = await bootstrap(page.request);
    const empty = await page.request.get('/api/v1/overview?collection=owner&region=main', {headers: headers(scope)});
    expect(empty.status()).toBe(200);
    const pageSize = (await empty.json() as components['schemas']['OverviewRegion']).pageSize;
    // Supply exactly one bounded overflow page using ordinary persisted creation.
    // This retains real grouping, membership, paging, authorization and HTML/API delivery.
    for (let index = 0; index <= pageSize; index++) {
        const input = createE2EPackingList();
        input.title = input.form.title = `${marker} list ${String(index).padStart(2, '0')}`;
        await createResourceViaForm(page.request, input);
    }

    for (const destination of ['/users/dashboard', '/frontend-pilot']) {
        await page.goto(destination, {waitUntil: 'domcontentloaded'});
        if (destination === '/frontend-pilot') await waitForPilotHydration(page);
        await navigationDisclosure(page);
        const region = page.locator('[data-collection="owner"][data-region="main"]');
        const next = region.getByRole('link', {name: 'Next', exact: true});
        await expect(next).toBeVisible();
        const original = page.url();
        const popupOpened = page.context().waitForEvent('page');
        await next.click({modifiers: ['Control']});
        const popup = await popupOpened;
        try { await expect(popup).toHaveURL(/owner_main_page=2/u); }
        finally { await popup.close(); }
        expect(page.url()).toBe(original);
    }

    const owner = page.locator('[data-collection="owner"][data-region="main"]');
    const originalUrl = page.url();
    const originalCards = await owner.locator('article[data-id]').evaluateAll(cards => cards.map(card => card.getAttribute('data-id')));
    const pattern = '**/api/v1/overview?**';
    let pageUnavailable = true;
    let pageReads = 0;
    let failedReads = 0;
    async function rejectUnavailablePage(route: Route): Promise<void> {
        const query = new URL(route.request().url()).searchParams;
        if (query.get('collection') !== 'owner' || query.get('region') !== 'main' || query.get('page') !== '2') {
            await route.continue();
            return;
        }
        pageReads++;
        if (!pageUnavailable) { await route.continue(); return; }
        failedReads++;
        // A temporary server failure retains confirmed cards. Known 401/403/404
        // admission denials deliberately retire them and are covered separately.
        // Keep the outage through the initial read and its two automatic retries;
        // only the explicit recovery below restores the real endpoint.
        await route.fulfill({status: 500, contentType: 'application/json',
            headers: scope.context === null ? {} : {'X-Surveyor-Context': scope.context}, body: JSON.stringify({type: 'about:blank',
                title: 'Page temporarily unavailable', status: 500, code: 'INTERNAL_ERROR',
                detail: 'Retry this bounded page.', messageKey: 'api:errors.INTERNAL_ERROR', params: {}, requestId: 'overview-failed-next'})});
    }
    await page.route(pattern, rejectUnavailablePage);
    try {
        await owner.getByRole('link', {name: 'Next', exact: true}).click();
        await expect(owner.getByRole('button', {name: 'Try again', exact: true})).toBeVisible({timeout: 10_000});
        expect(failedReads).toBe(3);
        expect(page.url()).toBe(originalUrl);
        expect(await owner.locator('article[data-id]').evaluateAll(cards => cards.map(card => card.getAttribute('data-id')))).toEqual(originalCards);
        pageUnavailable = false;
        await owner.getByRole('button', {name: 'Try again', exact: true}).click();
        await expect(page).toHaveURL(/owner_main_page=2/u);
        await expect(owner.locator('article[data-id]')).toHaveCount(1);
        await expect(owner.locator('.js-overview-heading')).toBeFocused();
        expect(pageReads).toBe(failedReads + 1);
        await page.goBack();
        await expect(page).toHaveURL(originalUrl);
        await expect(owner.locator('article[data-id]')).toHaveCount(pageSize);
    } finally { await page.unroute(pattern, rejectUnavailablePage); }
});

/** The existing-email lookup is advisory. Closing its choice must preserve input without
 * creating an identity; deliberately continuing creates a distinct guest, not a recovery. */
test('existing guest email choice preserves cancelled input and explicitly creates a new guest', async ({request, browser, baseURL}, testInfo) => {
    const list = await packingFixture(request, true);
    const existing = await browser.newContext({baseURL});
    const visitor = await browser.newContext({baseURL});
    const email = `guest-choice-${randomUUID()}@example.invalid`;
    try {
        const original = await bootstrap(existing.request);
        const seeded = await existing.request.post(`/api/v1/packing-lists/${list.id}/guest`, {
            headers: headers(original), data: {username: 'Existing guest identity', email},
        });
        expect(seeded.status()).toBe(200);
        const firstIdentity = (await seeded.json()).session as Session;

        const guestPage = await visitor.newPage();
        const commands: Request[] = [];
        guestPage.on('request', function rememberIdentityCommand(request) {
            if (request.method() === 'POST') commands.push(request);
        });
        await guestPage.goto(`/frontend-pilot/packing/${list.id}/guest?locale=en`, {waitUntil: 'domcontentloaded'});
        await waitForPilotHydration(guestPage);
        const name = `  New guest ${randomUUID().slice(0, 8)}  `;
        await guestPage.locator('#guest-name').fill(name);
        await guestPage.locator('#guest-email').fill(email);
        await guestPage.getByRole('button', {name: 'Continue as guest', exact: true}).click();
        const choice = guestPage.getByRole('dialog', {name: 'Guest account found!', exact: true});
        await expect(choice).toBeVisible();
        await captureState(guestPage, testInfo, 'existing-email-choice', choice);
        await choice.getByRole('button', {name: 'Close', exact: true}).click();
        await expect(choice).toHaveCount(0);
        await expect(guestPage.locator('#guest-name')).toHaveValue(name);
        await expect(guestPage.locator('#guest-email')).toHaveValue(email);
        expect((await bootstrap(visitor.request)).kind).toBe('anonymous');
        expect(commands.map(request => new URL(request.url()).pathname)).toEqual(['/api/v1/auth/guest-email-exists']);

        await guestPage.getByRole('button', {name: 'Continue as guest', exact: true}).click();
        await expect(choice).toBeVisible();
        await choice.getByRole('button', {name: 'Continue as new guest', exact: true}).click();
        await expect(guestPage).toHaveURL(new URL(`/frontend-pilot/packing/${list.id}`, baseURL).href);
        await expect(guestPage.getByRole('heading', {name: list.title, exact: true})).toBeVisible();
        const created = await bootstrap(visitor.request);
        expect(created).toMatchObject({kind: 'guest', activeProfile: {name}});
        expect(created.activeProfile!.id).not.toBe(firstIdentity.activeProfile!.id);
        expect(commands.map(request => new URL(request.url()).pathname)).toEqual([
            '/api/v1/auth/guest-email-exists', '/api/v1/auth/guest-email-exists', `/api/v1/packing-lists/${list.id}/guest`,
        ]);
    } finally {
        await existing.close();
        await visitor.close();
    }
});

/** Reject malformed uploads at the actual multipart boundary. Neither rejection may
 * replace the persisted image reference or lose the previously authorized image bytes. */
test('rejected header MIME and oversized uploads retain the existing header and settings token', async ({request}) => {
    const list = await packingFixture(request);
    const session = await bootstrap(request);
    const root = `/api/v1/packing-lists/${list.id}`;
    const png = readFileSync('src/public/img/logo.png');
    const settings = await request.get(`${root}/settings`, {headers: headers(session)});
    expect(settings.status()).toBe(200);
    const initial = await settings.json() as components['schemas']['PackingSettings'];
    const uploaded = await request.put(`${root}/header`, {
        headers: {...headers(session), 'If-Match': initial.settingsToken},
        multipart: {image: {name: 'existing-header.png', mimeType: 'image/png', buffer: png}},
    });
    expect(uploaded.status()).toBe(200);
    const before = await readPacking(request, list.id);
    const currentSettings = await request.get(`${root}/settings`, {headers: headers(session)});
    expect(currentSettings.status()).toBe(200);
    const reviewed = await currentSettings.json() as components['schemas']['PackingSettings'];

    for (const rejected of [
        {name: 'wrong-type.png', mimeType: 'text/plain', buffer: Buffer.from('Rejected MIME'), status: 400, code: 'UPLOAD_INVALID'},
        {name: 'oversized.png', mimeType: 'image/png', buffer: Buffer.alloc(10 * 1024 * 1024 + 1), status: 413, code: 'PAYLOAD_TOO_LARGE'},
    ]) {
        const response = await request.put(`${root}/header`, {
            headers: {...headers(session), 'If-Match': reviewed.settingsToken},
            multipart: {image: {name: rejected.name, mimeType: rejected.mimeType, buffer: rejected.buffer}},
        });
        expect(response.status()).toBe(rejected.status);
        expect(await response.json()).toMatchObject({status: rejected.status, code: rejected.code});
        expect((await readPacking(request, list.id)).headerVersion).toBe(before.headerVersion);
        const after = await request.get(`${root}/settings`, {headers: headers(session)});
        expect(after.status()).toBe(200);
        expect((await after.json()).settingsToken).toBe(reviewed.settingsToken);
        const retained = await request.get(`${root}/header`, {headers: headers(session)});
        expect(retained.status()).toBe(200);
        expect(await retained.body()).toEqual(png);
    }
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
