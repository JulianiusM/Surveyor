import {expect, test, type APIRequestContext, type Browser, type BrowserContext, type Locator, type Page, type TestInfo} from '@playwright/test';
import {createFrontendEventFixture, frontendEventHeaders} from '../keywords/frontendEventE2EKeywords';
import {dismissFrontendSuccessNotifications, expectUsableFrontendLayout, openModalForE2E, closeModalForE2E} from '../keywords/e2eCoreKeywords';
import {waitForPilotHydration} from '../keywords/frontendDynamicKeywords';
import {createTranslator} from '../../src/modules/localization/translator';
import type {components} from '../../src/types/api/v1';

test.use({actionTimeout: 10_000});

type FinanceView = components['schemas']['FinanceView'];

/** Read the real admitted saved projection independently of the page issuing a
 * financial command. A fresh read never retries a write or infers rollback. */
async function readFinance(request: APIRequestContext, eventId: string, organizer = true): Promise<FinanceView> {
    const response = await request.get(`/api/v1/events/${eventId}/finance${organizer ? '/organizer' : ''}`, {
        headers: await frontendEventHeaders(request),
    });
    expect(response.status()).toBe(200);
    return response.json();
}

/** Prepare three real guest registrations and one accepted receipt through the
 * existing native HTTP owners. The resulting calculation has both payment and
 * refund rows, so positive-only fixtures cannot conceal signed regressions. */
async function financialFixture(request: APIRequestContext, browser: Browser, baseURL: string | undefined) {
    const event = await createFrontendEventFixture(request);
    const guests: BrowserContext[] = [];
    for (const name of ['P9 Alice receipt payer', 'P9 Bob payment payer', 'P9 Carol payment payer']) {
        const guest = await browser.newContext({baseURL});
        guests.push(guest);
        const email = guests.length < 3 ? `p9-${event.id}-${guests.length}@example.com` : undefined;
        expect((await guest.request.post(`/event/${event.id}/guest`, {form: {username: name, ...(email ? {email} : {})}, maxRedirects: 0})).status()).toBe(302);
        expect((await guest.request.post(`/api/event/${event.id}/register`, {data: {
            arrivalDate: '2030-06-01', departureDate: '2030-06-04', dietary: ['MEAT'],
        }})).status()).toBe(200);
    }
    const created = await request.post(`/api/event/${event.id}/invoice-pools`, {data: {
        name: 'P9 signed saved accounting', description: 'Saved source and transfer evidence', distribution: 'EQUAL',
        assignAll: true, subtractPersonalInvoices: true, roundUpShares: false, sendCalculationEmails: false,
    }});
    expect(created.status()).toBe(200);
    const poolId = (await created.json()).data.id as string;
    const endpoint = `/api/event/${event.id}/invoice-pools/${poolId}`;
    expect((await guests[0]!.request.post(`${endpoint}/submit`, {multipart: {
        amount: '90', description: 'P9 original private receipt',
        proof: {name: 'p9-original.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\nP9 actual proof\n%%EOF')},
    }})).status()).toBe(200);
    const invoice = (await readFinance(request, event.id)).invoices.find(row => row.description === 'P9 original private receipt')!;
    expect((await request.post(`${endpoint}/invoices/${invoice.id}/approve`)).status()).toBe(200);
    return {eventId: event.id, poolId, endpoint, guests, invoice};
}

/** Open the actual pool disclosure in either built renderer. Native remains an
 * unchanged comparator; hydration and its real private read are awaited for Vue. */
async function openPool(page: Page, eventId: string, poolId: string, pilot = true, locale = 'en'): Promise<Locator> {
    await page.goto(`${pilot ? '/frontend-pilot' : ''}/event/${eventId}/admin?locale=${locale}`, {waitUntil: 'domcontentloaded'});
    if (pilot) await waitForPilotHydration(page);
    const pool = page.locator(pilot ? `[data-finance-pool="${poolId}"]` : `.invoice-pool[data-pool="${poolId}"]`);
    const toggle = pool.locator('.accordion-button').first();
    await expect(toggle).toBeVisible();
    if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
    if (!pilot) await expect(pool.locator('.accordion-collapse').first()).toHaveClass(/(?:^|\s)show(?:\s|$)/u);
    return pool;
}

/** Review the actual saved-input preview. Opening it must never persist shares;
 * only an explicit command after this read may close or recalculate the pool. */
async function openPreview(page: Page, pool: Locator, closed = false, locale = 'en'): Promise<Locator> {
    const messages = createTranslator(locale);
    await pool.getByRole('button', {name: messages.t(closed ? 'finance.recalculatePool' : 'finance.previewCalculation'), exact: true}).click();
    const preview = page.getByRole('dialog').filter({has: page.locator('[data-finance-calculation-preview]')});
    await expect(preview).toBeVisible();
    await expect(preview.getByRole('button', {name: messages.t(closed ? 'finance.applyRecalculation' : 'finance.closePoolCalculate'), exact: true})).toBeEnabled();
    return preview;
}

/** Apply only an already visible reviewed preview and inspect its real HTTP
 * result. The saved read below establishes persistence rather than UI optimism. */
async function applyPreview(page: Page, preview: Locator, closed = false): Promise<void> {
    const response = page.waitForResponse(reply => reply.request().method() === 'POST'
        && reply.url().endsWith(closed ? '/recalculate' : '/close'));
    await preview.getByRole('button', {name: closed ? 'Apply recalculation' : 'Close pool & calculate', exact: true}).click();
    expect((await response).status()).toBe(200);
    await expect(preview).toBeHidden();
    await dismissFrontendSuccessNotifications(page);
}

/** Confirm one saved signed payer row and observe the existing settlement
 * endpoint. Cancellation is checked by callers before invoking this helper. */
async function settle(page: Page, row: Locator, action: 'Record payment' | 'Record refund' | 'Undo payment' | 'Undo refund'): Promise<void> {
    await row.getByRole('button', {name: new RegExp(`^${action}`, 'u')}).click();
    const review = page.getByRole('dialog');
    await expect(review).toBeVisible();
    const response = page.waitForResponse(reply => reply.request().method() === 'POST' && reply.url().endsWith('/settlement'));
    await review.getByRole('button', {name: action, exact: true}).click();
    expect((await response).status()).toBe(200);
    await expect(review).toBeHidden();
    await dismissFrontendSuccessNotifications(page);
}

/** Fixture closure uses the original owner only where calculation itself is not
 * under test, preserving its captured revision rather than manufacturing shares. */
async function closeFixture(request: APIRequestContext, endpoint: string): Promise<void> {
    const preview = await request.get(`${endpoint}/preview`);
    expect(preview.status()).toBe(200);
    expect((await request.post(`${endpoint}/close`, {data: {expectedRevision: (await preview.json()).data.revision, sendEmails: false}})).status()).toBe(200);
}

/** Keep original images and visible evidence for individual semantic inspection.
 * Local table scrolling is allowed; ordinary controls must fit their surface. */
async function capture(surface: Locator, info: TestInfo, name: string): Promise<void> {
    await expect(surface).toBeVisible();
    await surface.page().evaluate(() => document.fonts.ready);
    await expectUsableFrontendLayout(surface);
    expect(await surface.page().evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const path = info.outputPath(`${name}.png`);
    await surface.screenshot({path, animations: 'disabled'});
    await info.attach(name, {path, contentType: 'image/png'});
    await info.attach(`${name}-visible-text`, {body: await surface.innerText(), contentType: 'text/plain'});
}

/** Fixed financial columns must keep their visible labels inside their own
 * cells in every locale; table scrolling cannot repair overlapping headings. */
async function expectReadablePreviewHeadings(preview: Locator): Promise<void> {
    const overlaps = await preview.locator('thead th').evaluateAll(function overflowingHeadings(cells) {
        // Inspect painted text fragments, including wrapped lines, rather than
        // assuming a particular dialog width or translated word length.
        return cells.filter(cell => {
            if (!cell.checkVisibility()) return false;
            const bounds = cell.getBoundingClientRect();
            const range = document.createRange(); range.selectNodeContents(cell);
            return [...range.getClientRects()].some(rect => rect.left < bounds.left - 1 || rect.right > bounds.right + 1);
        }).map(cell => cell.textContent);
    });
    expect(overlaps).toEqual([]);
}

test('calculates saved inputs, confirms signed settlements in stable rows, carries transfers forward and rolls back only pool inputs', async ({page, browser, baseURL}) => {
    test.setTimeout(150_000);
    const fixture = await financialFixture(page.request, browser, baseURL);
    const {eventId, poolId, endpoint} = fixture;
    try {
        const pool = await openPool(page, eventId, poolId);
        const documentTime = await page.evaluate(() => performance.timeOrigin);
        const navigations: string[] = [];
        page.on('request', request => {if (request.isNavigationRequest() && request.frame() === page.mainFrame()) navigations.push(request.url());});
        const preview = await openPreview(page, pool);
        await expect(preview).toContainText('P9 Alice receipt payer');
        await expect(preview).toContainText('-60.00');
        await expect(preview.getByRole('checkbox')).not.toBeChecked();
        expect((await readFinance(page.request, eventId)).shares).toEqual([]);
        await applyPreview(page, preview);
        const closed = await readFinance(page.request, eventId);
        expect(closed.pools.find(row => row.id === poolId)).toMatchObject({status: 'CLOSED', needsRecalculation: false});
        expect(closed.shares.map(row => row.amount).sort()).toEqual(['-60.00', '30.00', '30.00']);
        const bob = closed.shares.find(row => row.payerName.includes('Bob'))!;
        const alice = closed.shares.find(row => row.payerName.includes('Alice'))!;
        const ledger = pool.locator('[data-finance-shares]');
        await ledger.getByLabel('Filter share status', {exact: true}).selectOption('due');
        const order = await ledger.locator('[data-finance-share]').evaluateAll(rows => rows.map(row => row.getAttribute('data-finance-share')));
        const bobRow = ledger.locator(`[data-finance-share="${bob.id}"]`);
        await bobRow.getByRole('button', {name: /^Record payment/u}).click();
        await expect(page.getByRole('dialog')).toContainText('30.00');
        await page.getByRole('dialog').getByRole('button', {name: 'Cancel', exact: true}).click();
        expect((await readFinance(page.request, eventId)).shares.find(row => row.id === bob.id)!.isPaid).toBe(false);
        await settle(page, bobRow, 'Record payment');
        await expect(bobRow.locator('.badge')).toHaveText('Paid');
        expect(await ledger.locator('[data-finance-share]').evaluateAll(rows => rows.map(row => row.getAttribute('data-finance-share')))).toEqual(order);
        await expect(ledger.getByRole('button', {name: 'Refresh list', exact: true})).toHaveClass(/btn-warning/u);
        await ledger.getByRole('button', {name: 'Refresh list', exact: true}).click();
        await expect(bobRow).toHaveCount(0);
        await ledger.getByLabel('Filter share status', {exact: true}).selectOption('');
        await settle(page, bobRow, 'Undo payment');
        await expect(bobRow).toContainText('30.00');
        await settle(page, bobRow, 'Record payment');
        const aliceRow = ledger.locator(`[data-finance-share="${alice.id}"]`);
        await settle(page, aliceRow, 'Record refund');
        await expect(aliceRow).toContainText('-60.00');
        await settle(page, aliceRow, 'Undo refund');
        await settle(page, aliceRow, 'Record refund');
        const settled = await readFinance(page.request, eventId);
        expect(settled.shares.find(row => row.id === bob.id)).toMatchObject({amount: '30.00', isPaid: true});
        expect(settled.shares.find(row => row.id === alice.id)).toMatchObject({amount: '-60.00', isPaid: true});

        // New source costs invalidate allocation while saved transfers and amounts
        // remain available. Recalculation carries both signed credits forward.
        expect((await page.request.post(`${endpoint}/invoices/organizer`, {multipart: {amount: '60', description: 'P9 later saved cost'}})).status()).toBe(200);
        await page.locator('[data-finance-section]').getByRole('button', {name: 'Refresh', exact: true}).first().click();
        const recalculation = await openPreview(page, pool, true);
        await expect(recalculation).toContainText('20.00');
        await recalculation.getByRole('checkbox').check();
        await applyPreview(page, recalculation, true);
        const recalculated = await readFinance(page.request, eventId);
        expect(recalculated.shares.find(row => row.payerName.includes('Alice'))).toMatchObject({amount: '20.00', isPaid: false});
        expect(recalculated.shares.find(row => row.payerName.includes('Bob'))).toMatchObject({amount: '20.00', isPaid: false});
        expect(recalculated.shares.find(row => row.payerName.includes('Carol'))).toMatchObject({amount: '50.00', isPaid: false});

        // Rollback returns local inputs to the saved calculation and preserves
        // its payer rows; it cannot reverse the accepted later cost or transfers.
        expect((await page.request.post(`/api/v1/events/${eventId}/finance/pools/${poolId}/settings`, {
            headers: await frontendEventHeaders(page.request),
            data: {distribution: 'EQUAL', description: 'P9 pending local settings', sendCalculationEmails: false, roundUpShares: true},
        })).status()).toBe(200);
        await page.locator('[data-finance-section]').getByRole('button', {name: 'Refresh', exact: true}).first().click();
        await pool.getByRole('button', {name: 'Roll back pool changes', exact: true}).click();
        const rollback = page.getByRole('dialog');
        await expect(rollback).toContainText('recorded payments');
        await rollback.getByRole('button', {name: 'Restore last calculated settings', exact: true}).click();
        await expect.poll(async () => (await readFinance(page.request, eventId)).pools.find(row => row.id === poolId)!.needsRecalculation).toBe(false);
        expect((await readFinance(page.request, eventId)).shares).toEqual(recalculated.shares);
        expect(await page.evaluate(() => performance.timeOrigin)).toBe(documentTime);
        expect(navigations).toEqual([]);
    } finally {
        for (const guest of fixture.guests) await guest.close();
    }
});

test('rejects held previews after another browser changes inputs or records a payment and requires explicit review again', async ({page, browser, baseURL}) => {
    test.setTimeout(120_000);
    const fixture = await financialFixture(page.request, browser, baseURL);
    const other = await browser.newContext({baseURL, storageState: await page.context().storageState()});
    try {
        const {eventId, poolId, endpoint} = fixture;
        const pool = await openPool(page, eventId, poolId);
        const preview = await openPreview(page, pool);
        const secondPage = await other.newPage();
        const secondPool = await openPool(secondPage, eventId, poolId);
        // A second real browser changes a saved setting without replacing the
        // first browser's captured preview or silently obtaining a new revision.
        await secondPool.getByRole('button', {name: 'Pool settings', exact: true}).click();
        const settings = secondPage.getByRole('dialog');
        await settings.locator('[name="description"]').fill('Second browser changed saved description');
        const settingResponse = secondPage.waitForResponse(reply => reply.request().method() === 'POST' && reply.url().endsWith('/settings'));
        await settings.getByRole('button', {name: 'Save pool settings', exact: true}).click();
        expect((await settingResponse).status()).toBe(200);
        await settings.getByRole('button', {name: 'Close', exact: true}).last().click();
        await expect(settings).toBeHidden();
        const rejected = page.waitForResponse(reply => reply.request().method() === 'POST' && reply.url().endsWith('/close'));
        await preview.getByRole('button', {name: 'Close pool & calculate', exact: true}).click();
        expect((await rejected).status()).toBe(409);
        expect((await readFinance(page.request, eventId)).shares).toEqual([]);
        await expect(preview).toBeVisible();
        await expect(preview.getByRole('button', {name: 'Close pool & calculate', exact: true})).toBeDisabled();
        await preview.getByRole('button', {name: 'Refresh preview', exact: true}).click();
        await expect(preview.getByRole('button', {name: 'Close pool & calculate', exact: true})).toBeEnabled();
        await applyPreview(page, preview);

        const before = await readFinance(page.request, eventId);
        const bob = before.shares.find(row => row.payerName.includes('Bob'))!;
        const held = await openPreview(page, pool, true);
        await secondPage.locator('[data-finance-section]').getByRole('button', {name: 'Refresh', exact: true}).first().click();
        await settle(secondPage, secondPool.locator(`[data-finance-share="${bob.id}"]`), 'Record payment');
        const settled = await readFinance(page.request, eventId);
        const stale = page.waitForResponse(reply => reply.request().method() === 'POST' && reply.url().endsWith('/recalculate'));
        await held.getByRole('button', {name: 'Apply recalculation', exact: true}).click();
        const staleReply = await stale;
        expect(staleReply.status()).toBe(409);
        expect(staleReply.request().postDataJSON().expectedRevision).toBe(before.pools.find(row => row.id === poolId)!.revision);
        expect((await readFinance(page.request, eventId)).shares).toEqual(settled.shares);
        await expect(held.getByRole('button', {name: 'Apply recalculation', exact: true})).toBeDisabled();
        await held.getByRole('button', {name: 'Refresh preview', exact: true}).click();
        await expect(held.getByRole('button', {name: 'Apply recalculation', exact: true})).toBeEnabled();
        await applyPreview(page, held, true);
        const carried = await readFinance(page.request, eventId);
        expect(carried.shares.find(row => row.payerName.includes('Bob'))).toMatchObject({amount: '0.00'});
        expect((await page.request.get(`${endpoint}/preview`)).status()).toBe(200);
    } finally {
        await other.close();
        for (const guest of fixture.guests) await guest.close();
    }
});

test('exports both complete saved PDF variants, preserves private proof/history boundaries and deliberately requests saved settlement email', async ({page, browser, baseURL}, info) => {
    test.setTimeout(90_000);
    const fixture = await financialFixture(page.request, browser, baseURL);
    try {
        const {eventId, poolId, endpoint, guests, invoice} = fixture;
        await closeFixture(page.request, endpoint);
        const pool = await openPool(page, eventId, poolId);
        const ledger = pool.locator('[data-finance-shares]');
        await ledger.getByLabel('Search shares', {exact: true}).fill('Bob');
        await expect(ledger.locator('[data-finance-share]')).toHaveCount(1);
        const before = await readFinance(page.request, eventId);
        const exports = pool.locator(`a[href*="/export/invoice-pools/${poolId}/shares"]`);
        await expect(exports).toHaveCount(2);
        for (const link of await exports.all()) {
            const destination = new URL((await link.getAttribute('href'))!, page.url());
            expect([...destination.searchParams.keys()].every(key => key === 'example')).toBe(true);
            const download = page.waitForEvent('download');
            await link.click();
            const savedDownload = await download;
            expect(savedDownload.suggestedFilename()).toBe(`invoice-pool-${poolId}-shares.pdf`);
            await savedDownload.saveAs(info.outputPath(destination.searchParams.get('example') === 'false' ? 'shares-without-example.pdf' : 'shares-with-example.pdf'));
            const output = await page.request.get((await link.getAttribute('href'))!);
            expect(output.status()).toBe(200);
            expect(output.headers()['content-type']).toContain('application/pdf');
            expect(output.headers()['cache-control']).toContain('no-store');
            expect((await output.body()).subarray(0, 4).toString()).toBe('%PDF');
            expect((await guests[1]!.request.get((await link.getAttribute('href'))!)).status()).toBe(403);
        }
        expect((await readFinance(page.request, eventId)).shares).toEqual(before.shares);
        const own = await readFinance(guests[0]!.request, eventId, false);
        const foreign = await readFinance(guests[1]!.request, eventId, false);
        expect(own.invoices.map(row => row.id)).toContain(invoice.id);
        expect(foreign.invoices.map(row => row.id)).not.toContain(invoice.id);
        expect(foreign.shares.every(row => row.payerName.includes('Bob'))).toBe(true);
        const proof = `/api/v1/events/${eventId}/finance/pools/${poolId}/invoices/${invoice.id}/proof`;
        expect((await guests[0]!.request.get(proof, {headers: await frontendEventHeaders(guests[0]!.request)})).status()).toBe(200);
        expect((await guests[1]!.request.get(proof, {headers: await frontendEventHeaders(guests[1]!.request)})).status()).toBe(403);
        const alice = before.shares.find(row => row.payerName.includes('Alice'))!;
        const breakdown = `/api/v1/events/${eventId}/finance/pools/${poolId}/shares/${alice.id}?audience=participant`;
        expect((await guests[1]!.request.get(breakdown, {headers: await frontendEventHeaders(guests[1]!.request)})).status()).toBe(403);

        await pool.getByRole('button', {name: 'Send settlement emails', exact: true}).click();
        const notification = page.getByRole('dialog');
        await expect(notification).toContainText('Only payers with an email address');
        const response = page.waitForResponse(reply => reply.request().method() === 'POST' && reply.url().endsWith('/notify'));
        await notification.getByRole('button', {name: 'Send settlement emails', exact: true}).click();
        const notificationResponse = await response;
        expect(notificationResponse.status()).toBe(200);
        expect(await notificationResponse.json()).toEqual({count: 2});
        await expect(notification).toContainText('2 payers');
        await notification.getByRole('button', {name: 'Close', exact: true}).last().click();
        await expect(notification).toBeHidden();
        expect((await readFinance(page.request, eventId)).shares).toEqual(before.shares);
    } finally {
        for (const guest of fixture.guests) await guest.close();
    }
});

test('keeps an unconfirmed committed calculation locked until saved-state inspection without replaying the write', async ({page, browser, baseURL, context}) => {
    test.setTimeout(90_000);
    const fixture = await financialFixture(page.request, browser, baseURL);
    const interception = await context.newCDPSession(page);
    let pausedId: string | undefined;
    try {
        const {eventId, poolId} = fixture;
        const pool = await openPool(page, eventId, poolId);
        const preview = await openPreview(page, pool);
        const endpoint = `/api/v1/events/${eventId}/finance/pools/${poolId}/close`;
        let attempts = 0;
        page.on('request', request => {if (request.method() === 'POST' && request.url().endsWith(endpoint)) attempts++;});
        const paused = new Promise<{requestId: string; responseStatusCode?: number}>(resolve => interception.once('Fetch.requestPaused', resolve));
        // Pause only delivery of the real committed response. The backend,
        // sessions and persistence remain the integrated built application.
        await interception.send('Fetch.enable', {patterns: [{urlPattern: new URL(endpoint, page.url()).href, requestStage: 'Response'}]});
        const apply = preview.getByRole('button', {name: 'Close pool & calculate', exact: true});
        await apply.click();
        const committed = await paused;
        pausedId = committed.requestId;
        expect(committed.responseStatusCode).toBe(200);
        await expect(apply).toBeDisabled();
        const saved = await readFinance(page.request, eventId);
        expect(saved.shares).toHaveLength(3);
        await interception.send('Fetch.failRequest', {requestId: committed.requestId, errorReason: 'Failed'});
        pausedId = undefined;
        await expect(preview).toContainText(createTranslator('en').t('state.unknownOutcome'));
        await expect(apply).toBeDisabled();
        await apply.dispatchEvent('click');
        expect(attempts).toBe(1);
        await preview.getByRole('button', {name: 'Refresh', exact: true}).click();
        await expect(apply).toBeDisabled();
        const inspection = preview.locator('[data-finance-calculation-inspection]');
        await expect(inspection.locator('[data-finance-share]')).toHaveCount(3);
        await expect(inspection).toContainText('-60.00');
        await expect(inspection.getByRole('button', {name: /^View breakdown/u})).toHaveCount(0);
        await preview.getByRole('button', {name: 'I have checked the saved shares', exact: true}).click();
        await expect(preview).toBeHidden();
        expect(attempts).toBe(1);
        expect((await readFinance(page.request, eventId)).shares).toEqual(saved.shares);
    } finally {
        if (pausedId) await interception.send('Fetch.continueResponse', {requestId: pausedId}).catch(() => undefined);
        await interception.send('Fetch.disable').catch(() => undefined);
        await interception.detach().catch(() => undefined);
        for (const guest of fixture.guests) await guest.close();
    }
});

for (const locale of ['en', 'de']) {
    for (const width of [1280, 390]) {
        test(`preserves native and Vue financial review and settlement usability in ${locale} at ${width}px`, async ({page, browser, baseURL}, info) => {
            test.setTimeout(120_000);
            const fixture = await financialFixture(page.request, browser, baseURL);
            try {
                const {eventId, poolId, endpoint} = fixture;
                await page.setViewportSize({width, height: width === 390 ? 844 : 900});
                // Both renderers see the same saved source before any calculation.
                // Native labels retain their accepted English default comparator.
                for (const pilot of [false, true]) {
                    const name = `${pilot ? 'vue' : 'native'}-${locale}-${width}`;
                    const pool = await openPool(page, eventId, poolId, pilot, locale);
                    const messages = createTranslator(pilot ? locale : 'en');
                    let preview: Locator;
                    if (pilot) preview = await openPreview(page, pool, false, locale);
                    else {
                        preview = page.locator(`#pool-${poolId}-calculation`);
                        await openModalForE2E(preview, pool.getByRole('button', {name: 'Preview calculation', exact: true}));
                        await expect(preview.getByRole('button', {name: 'Close pool & calculate', exact: true})).toBeEnabled();
                    }
                    await expect(preview).toContainText('P9 Alice receipt payer');
                    await expect(preview).toContainText(width === 390 && pilot && locale === 'de' ? '-60,00' : '-60');
                    await capture(preview, info, `${name}-preview-notice`);
                    // Keep the accepted shared overlay as its own original, then
                    // inspect ordinary content after the user's explicit dismissal.
                    if (pilot) await preview.locator('[data-pilot-notices] button').click();
                    else await preview.locator('.pool-form-status .btn-close').click();
                    await expectReadablePreviewHeadings(preview);
                    await capture(preview, info, `${name}-preview`);
                    // Keep the compact payer overview and optional explanatory
                    // disclosure as separate originals; a tall expanded modal
                    // must not hide the table from the only retained picture.
                    for (const detail of await preview.locator('[data-finance-preview-breakdown], [data-finance-preview-example], [data-pool-preview-reconciliation], [data-pool-preview-example]').all()) {
                        await detail.evaluate(node => {(node as HTMLDetailsElement).open = true;});
                    }
                    await capture(preview, info, `${name}-preview-explanation`);
                    if (pilot) await preview.getByRole('button', {name: messages.t('common.cancel'), exact: true}).click();
                    else await closeModalForE2E(preview);
                }
                await closeFixture(page.request, endpoint);
                for (const pilot of [false, true]) {
                    const name = `${pilot ? 'vue' : 'native'}-${locale}-${width}`;
                    const pool = await openPool(page, eventId, poolId, pilot, locale);
                    const messages = createTranslator(pilot ? locale : 'en');
                    const ledger = pool.locator(pilot ? '[data-finance-shares]' : '[data-share-ledger]');
                    await capture(ledger, info, `${name}-ledger`);
                    const refund = ledger.getByRole('button', {name: new RegExp(`^${messages.t('finance.recordRefund')}`, 'u')});
                    const review = pilot ? page.getByRole('dialog') : page.locator('#invoiceCommandConfirmModal');
                    if (pilot) await refund.click(); else await openModalForE2E(review, refund);
                    await capture(review, info, `${name}-refund-confirmation`);
                    if (pilot) await review.getByRole('button', {name: messages.t('common.cancel'), exact: true}).click();
                    else await closeModalForE2E(review);
                    const notify = pilot ? page.getByRole('dialog') : page.locator(`#pool-${poolId}-notify`);
                    const opener = pool.getByRole('button', {name: messages.t('finance.sendSettlementEmails'), exact: true});
                    if (pilot) await opener.click(); else await openModalForE2E(notify, opener);
                    await capture(notify, info, `${name}-notification`);
                    if (pilot) await notify.getByRole('button', {name: messages.t('common.cancel'), exact: true}).click();
                    else await closeModalForE2E(notify);
                }
                expect((await readFinance(page.request, eventId)).shares.every(row => !row.isPaid)).toBe(true);
            } finally {
                for (const guest of fixture.guests) await guest.close();
            }
        });
    }
}
