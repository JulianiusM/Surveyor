import {submitFinanceInvoiceFixture, financeFixtureRequest, createFinancePoolFixture, registerFinanceParticipantFixture} from '../keywords/frontendFinanceE2EKeywords';
import {expect, request as playwrightRequest, test, type APIRequestContext, type Browser, type BrowserContext, type Locator, type Page, type TestInfo} from '@playwright/test';
import {createFrontendEventFixture, frontendEventHeaders} from '../keywords/frontendEventE2EKeywords';
import {dismissFrontendSuccessNotifications, expectUsableFrontendLayout} from '../keywords/e2eCoreKeywords';
import {waitForFrontendHydration} from '../keywords/frontendDynamicKeywords';
import {createTranslator} from '../../src/modules/localization/translator';
import type {components} from '../../src/types/api/v1';

test.use({actionTimeout: 10_000});

type FinanceView = components['schemas']['FinanceView'];

/** Read the real admitted saved projection independently of the page issuing a
 * financial command. A fresh read never retries a write or infers rollback. */
async function readFinance(request: APIRequestContext, eventId: string, organizer = true): Promise<FinanceView> {
    const response = await financeFixtureRequest(request, 'GET', `/api/v1/events/${eventId}/finance${organizer ? '/organizer' : ''}`, {
        headers: await frontendEventHeaders(request),
    });
    expect(response.status()).toBe(200);
    return response.json();
}

/** Prepare three real guest registrations and one accepted receipt through the
 * admitted API operations. The resulting calculation has both payment and
 * refund rows, so positive-only fixtures cannot conceal signed regressions. */
async function financialFixture(request: APIRequestContext, browser: Browser, baseURL: string | undefined) {
    const event = await createFrontendEventFixture(request);
    const guests: BrowserContext[] = [];
    for (const name of ['P9 Alice receipt payer', 'P9 Bob payment payer', 'P9 Carol payment payer']) {
        const guest = await browser.newContext({baseURL});
        guests.push(guest);
        const email = guests.length < 3 ? `p9-${event.id}-${guests.length}@example.com` : undefined;
        await registerFinanceParticipantFixture(guest.request, event.id, name, email);
    }
    const poolId = await createFinancePoolFixture(request, event.id, {
        name: 'P9 signed saved accounting', description: 'Saved source and transfer evidence', distribution: 'EQUAL',
        assignAll: true, subtractPersonalInvoices: true, roundUpShares: false, sendCalculationEmails: false,
    });
    const endpoint = `/api/v1/events/${event.id}/finance/pools/${poolId}`;
    await submitFinanceInvoiceFixture(guests[0]!.request, `${endpoint}/invoices`,
        {amount: '90', description: 'P9 original private receipt'}, {name: 'p9-original.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\nP9 actual proof\n%%EOF')});
    const invoice = (await readFinance(request, event.id)).invoices.find(row => row.description === 'P9 original private receipt')!;
    expect((await financeFixtureRequest(request, 'POST', `${endpoint}/invoices/${invoice.id}/approve`, {data: {}})).status()).toBe(200);
    return {eventId: event.id, poolId, endpoint, guests, invoice};
}

/** Open the hydrated pool disclosure and await its real private finance read. */
async function openPool(page: Page, eventId: string, poolId: string, locale = 'en'): Promise<Locator> {
    await page.goto(`/event/${eventId}/admin?locale=${locale}`, {waitUntil: 'domcontentloaded'});
    await waitForFrontendHydration(page);
    const pool = page.locator(`[data-finance-pool="${poolId}"]`);
    const toggle = pool.locator('.accordion-button').first();
    await expect(toggle).toBeVisible();
    if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
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
    const preview = await financeFixtureRequest(request, 'GET', `${endpoint}/preview`);
    expect(preview.status()).toBe(200);
    expect((await financeFixtureRequest(request, 'POST', `${endpoint}/close`, {data: {expectedRevision: (await preview.json()).revision, sendEmails: false}})).status()).toBe(200);
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
        await submitFinanceInvoiceFixture(page.request, `${endpoint}/invoices/organizer`,
            {amount: '60', description: 'P9 later saved cost'});
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
        expect((await financeFixtureRequest(page.request, 'POST', `/api/v1/events/${eventId}/finance/pools/${poolId}/settings`, {
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
        expect((await financeFixtureRequest(page.request, 'GET', `${endpoint}/preview`)).status()).toBe(200);
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
            const output = await financeFixtureRequest(page.request, 'GET', (await link.getAttribute('href'))!);
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
        expect((await financeFixtureRequest(guests[0]!.request, 'GET', proof, {headers: await frontendEventHeaders(guests[0]!.request)})).status()).toBe(200);
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
        test(`preserves financial review and settlement usability in ${locale} at ${width}px`, async ({page, browser, baseURL}, info) => {
            test.setTimeout(120_000);
            const fixture = await financialFixture(page.request, browser, baseURL);
            try {
                const {eventId, poolId, endpoint} = fixture;
                await page.setViewportSize({width, height: width === 390 ? 844 : 900});
                // Preview and settlement retain the same saved input evidence
                // while translated controls remain usable at each viewport.
                {
                    const name = `vue-${locale}-${width}`;
                    const pool = await openPool(page, eventId, poolId, locale);
                    const messages = createTranslator(locale);
                    const preview = await openPreview(page, pool, false, locale);
                    await expect(preview).toContainText('P9 Alice receipt payer');
                    await expect(preview).toContainText(width === 390 && locale === 'de' ? '-60,00' : '-60');
                    await capture(preview, info, `${name}-preview-notice`);
                    // Keep the accepted shared overlay as its own original, then
                    // inspect ordinary content after the user's explicit dismissal.
                    await preview.locator('[data-frontend-notices] button').click();
                    await expectReadablePreviewHeadings(preview);
                    await capture(preview, info, `${name}-preview`);
                    // Keep the compact payer overview and optional explanatory
                    // disclosure as separate originals; a tall expanded modal
                    // must not hide the table from the only retained picture.
                    for (const detail of await preview.locator('[data-finance-preview-breakdown], [data-finance-preview-example]').all()) {
                        await detail.evaluate(node => {(node as HTMLDetailsElement).open = true;});
                    }
                    await capture(preview, info, `${name}-preview-explanation`);
                    await preview.getByRole('button', {name: messages.t('common.cancel'), exact: true}).click();
                }
                await closeFixture(page.request, endpoint);
                {
                    const name = `vue-${locale}-${width}`;
                    const pool = await openPool(page, eventId, poolId, locale);
                    const messages = createTranslator(locale);
                    const ledger = pool.locator('[data-finance-shares]');
                    await capture(ledger, info, `${name}-ledger`);
                    const refund = ledger.getByRole('button', {name: new RegExp(`^${messages.t('finance.recordRefund')}`, 'u')});
                    const review = page.getByRole('dialog');
                    await refund.click();
                    await capture(review, info, `${name}-refund-confirmation`);
                    await review.getByRole('button', {name: messages.t('common.cancel'), exact: true}).click();
                    const notify = page.getByRole('dialog');
                    const opener = pool.getByRole('button', {name: messages.t('finance.sendSettlementEmails'), exact: true});
                    await opener.click();
                    await capture(notify, info, `${name}-notification`);
                    await notify.getByRole('button', {name: messages.t('common.cancel'), exact: true}).click();
                }
                expect((await readFinance(page.request, eventId)).shares.every(row => !row.isPaid)).toBe(true);
            } finally {
                for (const guest of fixture.guests) await guest.close();
            }
        });
    }
}

test.describe('fractional-scale calculation preview', () => {
    test.use({viewport: {width: 1280, height: 900}, deviceScaleFactor: 1.25});

    test('scrolling real payer rows cannot paint through the three-pixel header edge', async ({page, browser, baseURL}, info) => {
        test.setTimeout(120_000);
        const fixture = await financialFixture(page.request, browser, baseURL);
        try {
            const pool = await openPool(page, fixture.eventId, fixture.poolId);
            const preview = await openPreview(page, pool);
            await preview.locator('[data-frontend-notices] button').click();
            await page.evaluate(() => { document.body.style.zoom = '1.25'; });
            const scrollport = preview.locator('.pool-preview-table');
            await expect(scrollport.locator('tbody tr')).toHaveCount(3);
            await scrollport.evaluate(element => {
                // Constrain only the viewport: the rows, columns and sticky
                // header remain the real server-backed calculation presentation.
                (element as HTMLElement).style.maxHeight = '72px';
                element.scrollTop = element.scrollHeight;
            });
            await scrollport.scrollIntoViewIfNeeded();
            expect(await scrollport.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
            await page.evaluate(() => document.fonts.ready);
            const bounds = (await scrollport.boundingBox())!;
            expect(bounds.y).toBeGreaterThan(0);
            expect(bounds.y + 3).toBeLessThan(900);
            const clip = {x: bounds.x + 1, y: bounds.y, width: bounds.width - 2, height: 3};
            const withRows = await page.screenshot({clip, animations: 'disabled'});
            const rows = scrollport.locator('tbody');
            // Hiding painted rows preserves geometry. The header edge must be
            // opaque even at fractional CSS zoom and device pixel density.
            await rows.evaluate(element => { element.style.visibility = 'hidden'; });
            const withoutRows = await page.screenshot({clip, animations: 'disabled'});
            await rows.evaluate(element => { element.style.visibility = ''; });
            await info.attach('preview-edge-with-rows', {body: withRows, contentType: 'image/png'});
            await info.attach('preview-edge-without-rows', {body: withoutRows, contentType: 'image/png'});
            expect(withRows.equals(withoutRows), 'Scrolling payer pixels must not bleed through the header edge').toBe(true);
            expect((await readFinance(page.request, fixture.eventId)).shares).toEqual([]);
        } finally {
            for (const guest of fixture.guests) await guest.close();
        }
    });
});

test.describe('touch settlement confirmation', () => {
    test.use({hasTouch: true});

    for (const width of [390, 834]) {
        test(`keeps a refund unchanged until explicit touch confirmation at ${width}px`, async ({page, browser, baseURL}) => {
            test.setTimeout(120_000);
            const fixture = await financialFixture(page.request, browser, baseURL);
            try {
                await closeFixture(page.request, fixture.endpoint);
                await page.setViewportSize({width, height: 900});
                const pool = await openPool(page, fixture.eventId, fixture.poolId);
                const alice = (await readFinance(page.request, fixture.eventId)).shares.find(row => row.payerName.includes('Alice'))!;
                const row = pool.locator(`[data-finance-share="${alice.id}"]`);
                const opener = row.getByRole('button', {name: /^Record refund/u});
                const writes: unknown[] = [];
                page.on('request', request => {
                    if (request.method() === 'POST' && request.url().endsWith(`/shares/${alice.id}/settlement`))
                        writes.push(request.postDataJSON());
                });

                // The shared dialog owns initial container focus. Both real
                // touch dismissal paths return to the invoker without a write.
                await opener.tap();
                const review = page.getByRole('dialog');
                await expect(review).toContainText('-60.00');
                await expect(review).toBeFocused();
                await page.keyboard.press('Escape');
                await expect(review).toBeHidden();
                await expect(opener).toBeFocused();
                await opener.tap();
                await review.getByRole('button', {name: 'Cancel', exact: true}).tap();
                await expect(review).toBeHidden();
                expect(writes).toEqual([]);
                expect((await readFinance(page.request, fixture.eventId)).shares.find(share => share.id === alice.id)?.isPaid).toBe(false);

                await opener.tap();
                const saved = page.waitForResponse(response => response.request().method() === 'POST'
                    && response.url().endsWith(`/shares/${alice.id}/settlement`));
                await review.getByRole('button', {name: 'Record refund', exact: true}).tap();
                expect((await saved).status()).toBe(200);
                await expect(review).toBeHidden();
                await dismissFrontendSuccessNotifications(page);
                expect(writes).toEqual([{isPaid: true}]);
                await expect(row).toContainText('-60.00');
                await expect(row.locator('.badge')).toHaveText('Refunded');
                await settle(page, row, 'Undo refund');
                expect(writes).toEqual([{isPaid: true}, {isPaid: false}]);
                await expect(row.locator('.badge')).toHaveText('Refund due');
                expect((await readFinance(page.request, fixture.eventId)).shares.find(share => share.id === alice.id))
                    .toMatchObject({amount: '-60.00', isPaid: false});
            } finally {
                for (const guest of fixture.guests) await guest.close();
            }
        });
    }
});

test('retires a covered payer only after its correcting refund and repeated recalculation', async ({page, browser, baseURL}) => {
    test.setTimeout(150_000);
    const fixture = await financialFixture(page.request, browser, baseURL);
    try {
        await closeFixture(page.request, fixture.endpoint);
        await page.setViewportSize({width: 390, height: 844});
        const pool = await openPool(page, fixture.eventId, fixture.poolId);
        const initial = await readFinance(page.request, fixture.eventId);
        const bob = initial.shares.find(row => row.payerName.includes('Bob'))!;
        const aliceId = (await readFinance(fixture.guests[0]!.request, fixture.eventId, false)).registrationId!;
        const bobId = (await readFinance(fixture.guests[1]!.request, fixture.eventId, false)).registrationId!;
        let bobRow = pool.locator(`[data-finance-share="${bob.id}"]`);
        await settle(page, bobRow, 'Record payment');
        expect((await financeFixtureRequest(page.request, 'POST', `${fixture.endpoint}/takeovers/manage`, {
            data: {payerId: aliceId, beneficiaries: [bobId]},
        })).status()).toBe(200);
        await page.locator('[data-finance-section]').getByRole('button', {name: 'Refresh', exact: true}).first().click();
        await expect(bobRow.locator('.badge')).toHaveText('Paid');

        // Saved payment credit remains attached to the former payer when the
        // new responsibility is applied, producing the correcting signed refund.
        await applyPreview(page, await openPreview(page, pool, true), true);
        const correcting = (await readFinance(page.request, fixture.eventId)).shares.find(share => share.payerName === bob.payerName)!;
        expect(correcting).toMatchObject({amount: '-30.00', isPaid: false});
        bobRow = pool.locator(`[data-finance-share="${correcting.id}"]`);
        await expect(bobRow).toContainText('settlement retained');
        await settle(page, bobRow, 'Record refund');
        await expect(bobRow).toContainText('-30.00');
        await expect(bobRow.locator('.badge')).toHaveText('Refunded');

        // Once payment and refund cancel, neither this nor an unchanged later
        // calculation may revive the covered payer's completed settlement row.
        for (let index = 0; index < 2; index++)
            await applyPreview(page, await openPreview(page, pool, true), true);
        const final = await readFinance(page.request, fixture.eventId);
        expect(final.shares).toHaveLength(2);
        expect(final.shares.some(share => share.payerName === bob.payerName)).toBe(false);
        await expect(pool.locator(`[data-finance-share="${correcting.id}"]`)).toHaveCount(0);
        const participant = await fixture.guests[1]!.newPage();
        await participant.goto(`/event/${fixture.eventId}?locale=en`);
        await waitForFrontendHydration(participant);
        expect((await readFinance(participant.request, fixture.eventId, false)).shares).toEqual([]);
    } finally {
        for (const guest of fixture.guests) await guest.close();
    }
});

test('keeps a 28-person takeover usable and preserves rounded saved shares across paging and recalculation', async ({page, baseURL}, info) => {
    test.setTimeout(240_000);
    const event = await createFrontendEventFixture(page.request);
    const guests: APIRequestContext[] = [];
    try {
        // Retain the real large roster: paging, rounding and modal scrolling
        // depend on integrated rows, not a substituted client response.
        for (let index = 0; index < 28; index++) {
            const guest = await playwrightRequest.newContext({baseURL});
            guests.push(guest);
            await registerFinanceParticipantFixture(guest, event.id,
                `Participant ${String(index).padStart(2, '0')} with a longer display name`);
        }
        const participantsResponse = await financeFixtureRequest(page.request, 'GET', `/api/v1/events/${event.id}/participants`);
        expect(participantsResponse.status()).toBe(200);
        const {participants} = await participantsResponse.json() as components['schemas']['EventParticipants'];
        expect(participants).toHaveLength(28);
        const person = (index: number) => participants.find(row => row.name.startsWith(`Participant ${String(index).padStart(2, '0')} `))!;
        const payer = person(0), first = person(1), last = person(27);
        const poolId = await createFinancePoolFixture(page.request, event.id, {name: 'Large saved roster', roundUpShares: false});
        const endpoint = `/api/v1/events/${event.id}/finance/pools/${poolId}`;
        const pool = await openPool(page, event.id, poolId);
        await pool.getByRole('button', {name: 'Manage takeovers', exact: true}).click();
        const takeovers = page.getByRole('dialog');
        await takeovers.getByLabel('Payer', {exact: true}).selectOption(payer.id);
        const firstCheckbox = takeovers.locator(`[data-finance-beneficiary="${first.id}"]`).getByRole('checkbox');
        const lastCheckbox = takeovers.locator(`[data-finance-beneficiary="${last.id}"]`).getByRole('checkbox');
        await firstCheckbox.check();
        for (const viewport of [{width: 1280, height: 720}, {width: 390, height: 844}, {width: 360, height: 640}]) {
            await page.setViewportSize(viewport);
            const footer = takeovers.locator('.modal-footer');
            const before = (await footer.boundingBox())!;
            await lastCheckbox.scrollIntoViewIfNeeded();
            await expect(lastCheckbox).toBeInViewport();
            await expect(takeovers.getByRole('button', {name: 'Save changes', exact: true})).toBeInViewport();
            expect((await footer.boundingBox())!.y).toBeCloseTo(before.y, 0);
            await expectUsableFrontendLayout(takeovers);
            await takeovers.screenshot({path: info.outputPath(`takeovers-28-${viewport.width}.png`), animations: 'disabled'});
        }
        await lastCheckbox.check();
        await takeovers.getByLabel('Search participants', {exact: true}).fill(first.name);
        await expect(firstCheckbox).toBeChecked();
        await expect(lastCheckbox).not.toBeVisible();
        await takeovers.getByRole('button', {name: 'Save changes', exact: true}).click();
        await expect.poll(async () => (await readFinance(page.request, event.id)).pools.find(row => row.id === poolId)?.currentCoverageGroups?.[0]?.beneficiaries.length).toBe(2);
        await takeovers.getByRole('button', {name: 'Close', exact: true}).last().click();
        await submitFinanceInvoiceFixture(page.request, `${endpoint}/invoices/organizer`,
            {amount: '1000', description: 'Large roster shared costs', registrationId: payer.id});
        await page.locator('[data-finance-section]').getByRole('button', {name: 'Refresh', exact: true}).first().click();
        await page.setViewportSize({width: 1280, height: 720});
        let preview = await openPreview(page, pool);
        await expect(preview.locator('[data-finance-preview-payer]')).toHaveCount(26);
        const down = await financeFixtureRequest(page.request, 'GET', `${endpoint}/preview`);
        expect(down.status()).toBe(200);
        expect((await down.json()).totals).toMatchObject({roundingDifference: '-0.12', invoiceCreditAmount: '1000.00'});
        await preview.locator('[data-finance-preview-breakdown] summary').click();
        await expect(preview).toContainText('-0.12');
        await preview.locator('[data-finance-preview-example] summary').click();
        await expect(preview).toContainText(/rounded down to cents/iu);
        await preview.locator('[data-finance-preview-payer]').last().scrollIntoViewIfNeeded();
        await expect(preview.locator('.modal-header')).toBeInViewport();
        await applyPreview(page, preview);

        const ledger = pool.locator('[data-finance-shares]');
        await expect(ledger.locator('[data-finance-share]')).toHaveCount(25);
        await ledger.getByRole('button', {name: 'Next', exact: true}).click();
        await expect(ledger.locator('[data-finance-share]')).toHaveCount(1);
        await ledger.getByLabel('Shares per page', {exact: true}).selectOption('50');
        await expect(ledger.locator('[data-finance-share]')).toHaveCount(26);
        await ledger.getByLabel('Filter share status', {exact: true}).selectOption('refund');
        await expect(ledger.locator('[data-finance-share]')).toHaveCount(1);
        await expect(ledger).toContainText(payer.name);
        await ledger.getByLabel('Search shares', {exact: true}).fill('No matching participant');
        await expect(ledger.locator('[data-finance-share]')).toHaveCount(0);
        await ledger.getByLabel('Search shares', {exact: true}).fill('');
        await ledger.getByLabel('Filter share status', {exact: true}).selectOption('');

        await pool.getByRole('button', {name: 'Pool settings', exact: true}).click();
        const settings = page.getByRole('dialog');
        await settings.getByLabel('Round base shares up', {exact: true}).check();
        await settings.getByRole('button', {name: 'Save pool settings', exact: true}).click();
        await expect.poll(async () => (await readFinance(page.request, event.id)).pools.find(row => row.id === poolId)?.needsRecalculation).toBe(true);
        await settings.getByRole('button', {name: 'Close', exact: true}).last().click();
        preview = await openPreview(page, pool, true);
        const up = await financeFixtureRequest(page.request, 'GET', `${endpoint}/preview`);
        expect(up.status()).toBe(200);
        expect((await up.json()).totals).toMatchObject({roundingDifference: '0.16', invoiceCreditAmount: '1000.00'});
        await preview.locator('[data-finance-preview-breakdown] summary').click();
        await expect(preview).toContainText('0.16');
        await preview.locator('[data-finance-preview-example] summary').click();
        await expect(preview).toContainText(/rounded up to cents/iu);
        await applyPreview(page, preview, true);
        expect((await readFinance(page.request, event.id)).pools.find(row => row.id === poolId)?.needsRecalculation).toBe(false);
        expect((await readFinance(page.request, event.id)).shares).toHaveLength(26);

        // A closed pool keeps its two saved beneficiaries while a new large
        // coverage draft remains pending. Search and expansion operate on it
        // without replacing saved shares until explicit recalculation.
        expect((await financeFixtureRequest(page.request, 'POST', `${endpoint}/takeovers/manage`, {
            data: {payerId: payer.id, beneficiaries: participants.filter(row => row.id !== payer.id).map(row => row.id)},
        })).status()).toBe(200);
        await page.locator('[data-finance-section]').getByRole('button', {name: 'Refresh', exact: true}).first().click();
        await page.setViewportSize({width: 390, height: 844});
        const applied = pool.locator('[data-finance-coverage-kind="applied"]');
        const pending = pool.locator('[data-finance-coverage-kind="pending"]');
        await expect(applied.locator('.coverage-name-chip')).toHaveText([first.name, last.name]);
        await expect(pending.locator('.coverage-name-chip')).toHaveCount(6);
        await pending.getByLabel('Search takeovers', {exact: true}).fill(last.name);
        await expect(pending.locator('.coverage-name-chip')).toHaveText([last.name]);
        await pending.getByLabel('Search takeovers', {exact: true}).fill('');
        await pending.getByRole('button', {name: /Show all 27/u}).click();
        await expect(pending.locator('.coverage-name-chip')).toHaveCount(27);
        await expectUsableFrontendLayout(pending);
        await pending.getByRole('button', {name: `Edit takeovers for ${payer.name}`, exact: true}).click();
        // Reopening the same payer retains its display filter. Reveal the full
        // roster before checking that every saved beneficiary remains selected.
        await expect(takeovers.getByLabel('Search participants', {exact: true})).toHaveValue(first.name);
        await takeovers.getByLabel('Search participants', {exact: true}).fill('');
        await expect(page.getByRole('dialog').locator('[data-finance-beneficiary] input:checked')).toHaveCount(27);
        await page.getByRole('dialog').getByRole('button', {name: 'Close', exact: true}).last().click();
        expect((await readFinance(page.request, event.id)).shares).toHaveLength(26);
        await applyPreview(page, await openPreview(page, pool, true), true);
        const consolidated = await readFinance(page.request, event.id);
        expect(consolidated.shares).toHaveLength(1);
        expect(consolidated.pools.find(row => row.id === poolId)?.hasPendingTakeovers).toBe(false);
        await expect(pending).toHaveCount(0);
    } finally {
        for (const guest of guests) await guest.dispose();
    }
});
