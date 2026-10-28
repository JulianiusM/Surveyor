import {submitFinanceInvoiceFixture, financeFixtureRequest, createFinancePoolFixture, registerFinanceParticipantFixture} from '../keywords/frontendFinanceE2EKeywords';
import {expect, test, type APIRequestContext, type BrowserContext, type Locator, type Page} from '@playwright/test';
import {createE2ELogin} from '../factories/e2eCoreFactory';
import {createFrontendEventFixture, frontendEventHeaders} from '../keywords/frontendEventE2EKeywords';
import {expectUsableFrontendLayout, readSecondaryInstructionColors} from '../keywords/e2eCoreKeywords';
import {waitForFrontendHydration} from '../keywords/frontendDynamicKeywords';
import type {components} from '../../src/types/api/v1';

test.use({actionTimeout: 10_000});

/** Seed each actor through real guest entry and registration. Tests exercise the
 * built application, its sessions and persisted eligibility without ORM shortcuts. */
async function registerFinanceParticipant(request: APIRequestContext, eventId: string, name: string): Promise<void> {
    await registerFinanceParticipantFixture(request, eventId, name);
}

/** Prepare a real pool with independent organizer reads before exercising the
 * participant workflow and its private projection in the browser. */
async function createFinancePool(request: APIRequestContext, eventId: string, name: string,
    overrides: Record<string, unknown> = {}): Promise<string> {
    return createFinancePoolFixture(request, eventId, {
        name, distribution: 'EQUAL', assignAll: true, subtractPersonalInvoices: true,
        roundUpShares: false, sendCalculationEmails: false, ...overrides,
    });
}

/** Preserve the real proof bytes and media type in both fixture and browser
 * submissions; successful transfer alone never proves the invoice was saved. */
function financeProof(name = 'receipt.pdf') {
    return {name, mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\nFinance receipt\n%%EOF')};
}

/** Submit fixture invoices once through the existing operation. Later assertions
 * observe their independent participant/organizer projections and retained proof. */
async function submitFinanceFixture(request: APIRequestContext, eventId: string, poolId: string,
    description: string, amount = '20'): Promise<void> {
    await submitFinanceInvoiceFixture(request, `/api/v1/events/${eventId}/finance/pools/${poolId}/invoices`,
        {amount, description}, financeProof());
}

/** Snapshot the actual document identity and main-frame navigations. A matching
 * URL alone cannot distinguish SPA commands from a document submission/reload. */
async function observeFinanceDocument(page: Page) {
    const marker = await page.evaluate(() => performance.timeOrigin);
    const navigations: string[] = [];
    const errors: string[] = [];
    page.on('request', function recordFinanceNavigation(request) {
        if (request.isNavigationRequest() && request.frame() === page.mainFrame()) navigations.push(request.url());
    });
    page.on('pageerror', error => errors.push(error.message));
    return {marker, navigations, errors};
}

/** Public workflow controls retain their exact selected File through rejection;
 * compare the original DOM node rather than just its browser-rendered filename. */
async function fillFinanceInvoice(form: Locator, amount: string, description: string): Promise<void> {
    await form.getByLabel('Amount', {exact: true}).fill(amount);
    await form.getByLabel('Description', {exact: true}).fill(description);
    await form.getByLabel('Proof (image or PDF)', {exact: true}).setInputFiles(financeProof());
}

/** Verify the retained submission contract through actual labeled controls in
 * the browser, including the chooser and proof constraints users depend on. */
async function expectFinanceFormContract(form: Locator, poolId: string): Promise<void> {
    await expect(form.getByLabel('Choose pool', {exact: true})).toHaveValue(poolId);
    const amount = form.getByLabel('Amount', {exact: true});
    await expect(amount).toHaveAttribute('type', 'number');
    await expect(amount).toHaveAttribute('min', '0.01');
    await expect(amount).toHaveAttribute('step', '0.01');
    await expect(amount).toHaveJSProperty('required', true);
    const proof = form.getByLabel('Proof (image or PDF)', {exact: true});
    await expect(proof).toHaveAttribute('accept', 'image/jpeg,image/png,image/gif,application/pdf');
    await expect(proof).toHaveJSProperty('required', true);
}

/** Wide accounting tables may scroll locally, while the document and ordinary
 * actions must remain within the actual viewport in either interface language. */
async function expectFinanceViewport(page: Page, surface: Locator): Promise<void> {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const originalX = await page.evaluate(() => scrollX);
    for (const table of await surface.locator('.table-responsive').all()) {
        // Exercise each real table scroll owner independently of page scrolling.
        await table.evaluate(node => node.scrollTo({left: node.scrollWidth, behavior: 'instant'}));
        expect(await page.evaluate(() => scrollX)).toBe(originalX);
        await table.evaluate(node => node.scrollTo({left: 0, top: 0, behavior: 'instant'}));
    }
}

/** This independent admitted read verifies persisted results and private record
 * selection after each browser action; it never retries a financial command. */
async function readFinance(request: APIRequestContext, eventId: string, organizer = false): Promise<components['schemas']['FinanceView']> {
    const response = await financeFixtureRequest(request, 'GET', `/api/v1/events/${eventId}/finance${organizer ? '/organizer' : ''}`, {
        headers: await frontendEventHeaders(request),
    });
    expect(response.status()).toBe(200);
    return response.json();
}

/** Open the hydrated participant finance disclosures and await their real read. */
async function openParticipantFinance(page: Page, eventId: string): Promise<Locator> {
    await page.goto(`/event/${eventId}?locale=en`, {waitUntil: 'domcontentloaded'});
    await waitForFrontendHydration(page);
    const root = page.locator('[data-finance-section]');
    const first = root.getByRole('button', {name: /Invoice pools & payments$/u});
    if (await first.getAttribute('aria-expanded') !== 'true') await first.click();
    const submission = root.getByRole('button', {name: /Submit an invoice & history$/u});
    if (await submission.getAttribute('aria-expanded') !== 'true') await submission.click();
    return root;
}

test('keeps five-state personal history, attribution and retained proofs private while retracting and closing in place', async ({page, browser, baseURL}, info) => {
    test.setTimeout(150_000);
    const participant = await browser.newContext({baseURL});
    const other = await browser.newContext({baseURL});
    try {
        const event = await createFrontendEventFixture(page.request);
        await registerFinanceParticipant(participant.request, event.id, 'Finance participant');
        await registerFinanceParticipant(other.request, event.id, 'Foreign finance participant');
        const poolId = await createFinancePool(page.request, event.id, 'Personal receipt history');
        await createFinancePool(page.request, event.id, 'Unassigned confidential pool', {assignAll: false, registrations: []});
        const endpoint = `/api/v1/events/${event.id}/finance/pools/${poolId}`;
        // Seed distinct lifecycle records rather than overwriting a single row;
        // paging/search must retain every original receipt and its ownership.
        for (const description of ['Retract through Vue', 'Already retracted', 'Rejected evidence', 'Corrected evidence', 'Closed evidence']) {
            await submitFinanceFixture(participant.request, event.id, poolId, description);
        }
        await submitFinanceFixture(other.request, event.id, poolId, 'Foreign private receipt');
        const initial = await readFinance(participant.request, event.id);
        const invoice = (description: string) => initial.invoices.find(row => row.description === description)!;
        const retracted = invoice('Already retracted');
        const revision = initial.pools.find(pool => pool.id === poolId)!.revision;
        // Neither a foreign participant nor an unconfirmed request can retract
        // another receipt. These are actual transport and ownership boundaries.
        expect((await financeFixtureRequest(other.request, 'POST', `${endpoint}/invoices/${retracted.id}/retract`, {
            data: {confirmed: true, expectedRevision: revision},
        })).status()).toBe(403);
        expect((await financeFixtureRequest(participant.request, 'POST', `${endpoint}/invoices/${retracted.id}/retract`, {
            data: {expectedRevision: revision},
        })).status()).toBe(400);
        expect((await financeFixtureRequest(participant.request, 'POST', `${endpoint}/invoices/${retracted.id}/retract`, {data: {
            confirmed: true, expectedRevision: revision,
        }})).status()).toBe(200);
        expect((await financeFixtureRequest(page.request, 'POST', `${endpoint}/invoices/${invoice('Rejected evidence').id}/decline`, {
            data: {rejectionReason: 'Paid separately; preserve this evidence'},
        })).status()).toBe(200);
        expect((await financeFixtureRequest(page.request, 'POST', `${endpoint}/invoices/${invoice('Corrected evidence').id}/approve`, {
            data: {correctedAmount: '18', correctedDescription: 'Corrected shared receipt'},
        })).status()).toBe(200);
        expect((await financeFixtureRequest(page.request, 'POST', `${endpoint}/invoices/${invoice('Closed evidence').id}/approve`, {data: {}})).status()).toBe(200);
        expect((await financeFixtureRequest(participant.request, 'POST', `${endpoint}/invoices/${invoice('Closed evidence').id}/close`)).status()).toBe(200);
        const correctionRevision = (await readFinance(page.request, event.id, true)).pools.find(pool => pool.id === poolId)!.revision;
        const unconfirmedCorrection = {expectedRevision: correctionRevision, correctedAmount: '140', correctedDescription: null};
        expect((await financeFixtureRequest(participant.request, 'POST', `${endpoint}/invoices/${invoice('Closed evidence').id}/revise`, {
            data: {confirmed: true, ...unconfirmedCorrection},
        })).status()).toBe(403);
        expect((await financeFixtureRequest(page.request, 'POST', `${endpoint}/invoices/${invoice('Closed evidence').id}/revise`, {
            data: unconfirmedCorrection,
        })).status()).toBe(400);

        // Organizer recording and the participant who paid remain independent.
        // Only the explicitly attributed organizer invoice enters own history.
        const registrationId = (await readFinance(participant.request, event.id)).registrationId!;
        for (const attributed of [false, true]) {
            await submitFinanceInvoiceFixture(page.request, `${endpoint}/invoices/organizer`,
                {amount: '12', description: attributed ? 'Attributed organizer expense' : 'Private pool-only expense', ...(attributed ? {registrationId} : {})}, financeProof('organizer.pdf'));
        }
        for (let index = 0; index < 22; index++) await submitFinanceFixture(participant.request, event.id, poolId, `Paged receipt ${index}`);
        const own = await readFinance(participant.request, event.id);
        expect(own.invoices).toHaveLength(28);
        expect(new Set(own.invoices.map(row => row.status))).toEqual(new Set(['NEW', 'APPROVED', 'REJECTED', 'CLOSED', 'RETRACTED']));
        expect(own.invoices.map(row => row.description)).not.toContain('Foreign private receipt');
        expect(own.invoices.map(row => row.description)).not.toContain('Private pool-only expense');
        expect(own.invoices.find(row => row.description === 'Attributed organizer expense')).toMatchObject({
            organizerRecorded: true, recordedByName: createE2ELogin().username, canClose: true, canRetract: false,
        });
        expect(own.pools.every(pool => pool.summary === null)).toBe(true);
        expect(own.pools.map(pool => pool.name)).not.toContain('Unassigned confidential pool');
        const deniedOrganizer = await financeFixtureRequest(other.request, 'GET', `/api/v1/events/${event.id}/finance/organizer`, {
            headers: await frontendEventHeaders(other.request),
        });
        expect(deniedOrganizer.status()).toBe(403);
        const organizer = await readFinance(page.request, event.id, true);
        expect(organizer.invoices.map(row => row.description)).toContain('Private pool-only expense');
        const poolOnly = organizer.invoices.find(row => row.description === 'Private pool-only expense')!;
        expect((await financeFixtureRequest(participant.request, 'GET', poolOnly.proofUrl!, {headers: await frontendEventHeaders(participant.request)})).status()).toBe(403);

        const participantPage = await participant.newPage();
        const closeRequests: string[] = [];
        participantPage.on('request', request => {
            if (request.method() === 'POST' && /\/invoices\/[^/]+\/close$/u.test(new URL(request.url()).pathname)) closeRequests.push(request.url());
        });
        const finance = await openParticipantFinance(participantPage, event.id);
        const document = await observeFinanceDocument(participantPage);
        await expectFinanceFormContract(finance.locator('[data-finance-submission]'), poolId);
        const history = finance.locator('[data-finance-history]');
        // Persistent admitted row owners retain drafts/receipts while filter
        // and page controls hide them. Count only the currently visible history rows.
        const visibleHistoryRows = history.locator('[data-finance-invoice]:visible');
        await expect(visibleHistoryRows).toHaveCount(25);
        await history.getByRole('button', {name: 'Next', exact: true}).click();
        await expect(visibleHistoryRows).toHaveCount(3);
        await history.getByRole('button', {name: 'Previous', exact: true}).click();
        await history.getByLabel('Invoices per page', {exact: true}).selectOption('50');
        await expect(visibleHistoryRows).toHaveCount(28);
        const search = history.getByLabel('Search invoices', {exact: true});
        await search.fill('Corrected evidence');
        await expect(visibleHistoryRows).toHaveCount(1);
        await expect(history).toContainText('Corrected shared receipt');
        await expect(history).toContainText('Original: 20.00');
        await search.fill('evidence');
        await expect(visibleHistoryRows).toHaveCount(3);
        // Original amounts/descriptions and saved dates retain their financial
        // readability treatment outside dialogs as well as inside portals.
        expect(new Set(await readSecondaryInstructionColors(history))).toEqual(new Set(['rgb(173, 181, 189)']));
        await history.screenshot({path: info.outputPath('vue-participant-history-desktop.png'), animations: 'disabled'});
        await history.locator('.table-responsive').evaluate(node => node.scrollTo({left: node.scrollWidth, behavior: 'instant'}));
        await history.screenshot({path: info.outputPath('vue-participant-history-actions-desktop.png'), animations: 'disabled'});
        await history.locator('.table-responsive').evaluate(node => node.scrollTo({left: 0, behavior: 'instant'}));
        await finance.locator('[data-finance-submission]').screenshot({path: info.outputPath('vue-participant-form-desktop.png'), animations: 'disabled'});
        await search.fill('Paid separately');
        await expect(visibleHistoryRows).toHaveCount(1);
        await expect(history).toContainText('Rejected');
        await search.fill('');
        await history.getByLabel('Filter invoice status', {exact: true}).selectOption('RETRACTED');
        await expect(visibleHistoryRows).toHaveCount(1);
        const retainedProof = await history.getByRole('link', {name: 'View proof', exact: true}).getAttribute('href');
        expect((await financeFixtureRequest(participant.request, 'GET', retainedProof!, {headers: await frontendEventHeaders(participant.request)})).status()).toBe(200);
        expect((await financeFixtureRequest(other.request, 'GET', retainedProof!, {headers: await frontendEventHeaders(other.request)})).status()).toBe(403);
        const versionedProof = `/api/v1/events/${event.id}/finance/pools/${poolId}/invoices/${retracted.id}/proof`;
        const proofResponse = await financeFixtureRequest(participant.request, 'GET', versionedProof, {headers: await frontendEventHeaders(participant.request)});
        expect(proofResponse.status()).toBe(200);
        expect((await proofResponse.body()).subarray(0, 4).toString()).toBe('%PDF');
        expect((await financeFixtureRequest(other.request, 'GET', versionedProof, {headers: await frontendEventHeaders(other.request)})).status()).toBe(403);
        await history.getByLabel('Filter invoice status', {exact: true}).selectOption('');

        const target = history.locator(`[data-finance-invoice="${invoice('Retract through Vue').id}"]`);
        await target.getByRole('button', {name: 'Retract', exact: true}).click();
        const confirmation = participantPage.getByRole('dialog');
        await expect(confirmation).toContainText(`#${invoice('Retract through Vue').id}`);
        await confirmation.getByRole('button', {name: 'Cancel', exact: true}).click();
        expect((await readFinance(participant.request, event.id)).invoices.find(row => row.id === invoice('Retract through Vue').id)!.status).toBe('NEW');
        await target.getByRole('button', {name: 'Retract', exact: true}).click();
        const retractResponse = participantPage.waitForResponse(response => response.request().method() === 'POST'
            && response.url().endsWith(`/invoices/${invoice('Retract through Vue').id}/retract`));
        await confirmation.getByRole('button', {name: 'Confirm retraction', exact: true}).click();
        expect((await retractResponse).status()).toBe(200);
        await expect(target).toContainText('Retracted');
        const corrected = history.locator(`[data-finance-invoice="${invoice('Corrected evidence').id}"]`);
        await corrected.getByRole('button', {name: 'Close', exact: true}).click();
        const closeReview = participantPage.getByRole('dialog');
        await expect(closeReview).toHaveAccessibleName('Confirm invoice action');
        await expect(closeReview).toContainText(`Invoice #${invoice('Corrected evidence').id}`);
        await expect(closeReview).toContainText('Close this accepted invoice for 18.00');
        expect(closeRequests).toEqual([]);
        await closeReview.locator('.modal-footer').getByRole('button', {name: 'Cancel', exact: true}).click();
        await expect(closeReview).toBeHidden();
        expect(closeRequests).toEqual([]);
        await expect(corrected).toContainText('Accepted');
        await corrected.getByRole('button', {name: 'Close', exact: true}).click();
        const closeResponse = participantPage.waitForResponse(response => response.request().method() === 'POST'
            && response.url().endsWith(`/invoices/${invoice('Corrected evidence').id}/close`));
        await closeReview.locator('.modal-footer').getByRole('button', {name: 'Close', exact: true}).click();
        expect((await closeResponse).status()).toBe(200);
        expect(closeRequests).toHaveLength(1);
        await expect(corrected).toContainText('Closed');
        const saved = await readFinance(participant.request, event.id);
        expect(saved.invoices.find(row => row.id === invoice('Corrected evidence').id)).toMatchObject({status: 'CLOSED', amount: '20.00', correctedAmount: '18.00'});
        expect(saved.shares).toEqual([]);
        expect(await participantPage.evaluate(() => performance.timeOrigin)).toBe(document.marker);
        expect(document.navigations).toEqual([]);
        expect(document.errors).toEqual([]);
        await participantPage.setViewportSize({width: 390, height: 844});
        await search.fill('evidence');
        // Dismiss only the confirmed-save notification before inspecting the
        // stable history surface; a temporary overlay is not its resting layout.
        for (const dismiss of await participantPage.getByRole('button', {name: 'Dismiss notification', exact: true}).all()) {
            if (await dismiss.isVisible()) await dismiss.click();
        }
        await expectUsableFrontendLayout(history);
        await expectFinanceViewport(participantPage, history);
        await history.screenshot({path: info.outputPath('participant-history-mobile.png'), animations: 'disabled'});
    } finally {
        await participant.close();
        await other.close();
    }
});

test('distinguishes transferred bytes, confirmed repeated uploads, rejection and lost committed response without replay', async ({page, browser, baseURL}, info) => {
    test.setTimeout(120_000);
    const participant = await browser.newContext({baseURL});
    try {
        const event = await createFrontendEventFixture(page.request);
        await registerFinanceParticipant(participant.request, event.id, 'Upload finance participant');
        await createFinancePool(page.request, event.id, 'First selectable pool');
        const poolId = await createFinancePool(page.request, event.id, 'Selected receipt pool');
        const participantPage = await participant.newPage();
        await openParticipantFinance(participantPage, event.id);
        const document = await observeFinanceDocument(participantPage);
        const form = participantPage.locator('[data-finance-submission]');
        const pool = form.getByLabel('Choose pool', {exact: true});
        const submit = form.locator('button[type="submit"]');
        const endpoint = `/api/v1/events/${event.id}/finance/pools/${poolId}/invoices`;
        const posts: string[] = [];
        participantPage.on('request', function observeInvoiceDispatch(request) {
            if (request.method() === 'POST' && new URL(request.url()).pathname === endpoint) posts.push(request.postData() ?? '');
        });
        await pool.selectOption(poolId);

        for (const [index, description] of ['First confirmed receipt', 'Second confirmed receipt'].entries()) {
            await fillFinanceInvoice(form, String(10 + index), description);
            const response = participantPage.waitForResponse(value => value.request().method() === 'POST'
                && new URL(value.url()).pathname === endpoint);
            await submit.click();
            expect((await response).status()).toBe(200);
            await expect(participantPage.locator('[data-finance-history]')).toContainText(description);
            await expect(form.getByLabel('Amount', {exact: true})).toHaveValue('');
            await expect(form.getByLabel('Description', {exact: true})).toHaveValue('');
            await expect(form.getByLabel('Proof (image or PDF)', {exact: true})).toHaveValue('');
            await expect(pool).toHaveValue(poolId);
            await expect(submit).toBeEnabled();
        }
        expect(posts).toHaveLength(2);

        // A browser-selected unsupported proof reaches real server validation.
        // Definite rejection preserves the exact mounted input and File object.
        await fillFinanceInvoice(form, '013.50', 'Rejected file draft');
        const proof = form.getByLabel('Proof (image or PDF)', {exact: true});
        await proof.setInputFiles({name: 'unsupported.txt', mimeType: 'text/plain', buffer: Buffer.from('Unsupported receipt')});
        const originalFile = await proof.evaluateHandle((input: HTMLInputElement) => input.files![0]);
        const originalInput = await proof.elementHandle();
        try {
            const rejected = participantPage.waitForResponse(value => value.request().method() === 'POST'
                && new URL(value.url()).pathname === endpoint);
            await submit.click();
            expect((await rejected).status()).toBe(400);
            await expect(submit).toBeEnabled();
            await expect(form.getByLabel('Amount', {exact: true})).toHaveValue('013.50');
            await expect(form.getByLabel('Description', {exact: true})).toHaveValue('Rejected file draft');
            expect(await originalFile.evaluate(file => file === (window.document.querySelector('[data-finance-submission] input[type="file"]') as HTMLInputElement).files![0])).toBe(true);

            // Hold delivery of the real next-language read. A locale-specific
            // cache key becoming cold must not unmount this Event-owned draft.
            const localeInterception = await participant.newCDPSession(participantPage);
            let heldLocaleResponse: string | undefined;
            try {
                const paused = new Promise<{requestId: string; responseStatusCode?: number}>(resolve => {
                    localeInterception.once('Fetch.requestPaused', resolve);
                });
                await localeInterception.send('Fetch.enable', {patterns: [{
                    urlPattern: new URL(`/api/v1/events/${event.id}/finance`, participantPage.url()).href,
                    requestStage: 'Response',
                }]});
                await participantPage.locator('#frontend-locale').selectOption('de');
                const read = await paused;
                heldLocaleResponse = read.requestId;
                expect(read.responseStatusCode).toBe(200);
                await expect(participantPage.locator('html')).toHaveAttribute('lang', 'de');
                expect(await originalInput!.evaluate(input => input.isConnected
                    && window.document.querySelector('[data-finance-submission] input[type="file"]') === input)).toBe(true);
                await expect(form.locator('[name="amount"]')).toHaveValue('013.50');
                await expect(form.locator('[name="description"]')).toHaveValue('Rejected file draft');
                await expect(form.locator('[name="amount"]')).toBeDisabled();
                await expect(submit).toBeDisabled();
                expect(await originalFile.evaluate(file => file === (window.document.querySelector('[data-finance-submission] input[type="file"]') as HTMLInputElement).files![0])).toBe(true);
                await form.screenshot({path: info.outputPath('dirty-invoice-locale-read-pending.png'), animations: 'disabled'});
                await localeInterception.send('Fetch.continueResponse', {requestId: read.requestId});
                heldLocaleResponse = undefined;
                await localeInterception.send('Fetch.disable');
                await participantPage.locator('#frontend-locale').selectOption('en');
                await expect(participantPage.locator('html')).toHaveAttribute('lang', 'en');
                await expect(form.getByLabel('Amount', {exact: true})).toHaveValue('013.50');
                await expect(submit).toBeEnabled();
                expect(await originalInput!.evaluate(input => input.isConnected)).toBe(true);
                expect(await originalFile.evaluate(file => file === (window.document.querySelector('[data-finance-submission] input[type="file"]') as HTMLInputElement).files![0])).toBe(true);
            } finally {
                if (heldLocaleResponse) await localeInterception.send('Fetch.continueResponse', {requestId: heldLocaleResponse}).catch(() => undefined);
                await localeInterception.send('Fetch.disable').catch(() => undefined);
                await localeInterception.detach().catch(() => undefined);
            }
        } finally {
            await originalFile.dispose();
            await originalInput?.dispose();
        }
        expect((await readFinance(participant.request, event.id)).invoices).toHaveLength(2);

        expect(await participantPage.evaluate(() => performance.timeOrigin)).toBe(document.marker);
        // Playwright's timer fixture replaces performance.timeOrigin. Verify
        // both sides of that deliberate clock change, while the continuous
        // main-frame navigation observer still spans the entire real workflow.
        await participantPage.clock.install();
        const timedDocumentMarker = await participantPage.evaluate(() => performance.timeOrigin);
        await fillFinanceInvoice(form, '14', 'Committed response lost');
        const interception = await participant.newCDPSession(participantPage);
        let pausedId: string | undefined;
        try {
            // Intercept only response delivery after the original browser POST
            // committed. Neither Playwright transport nor a stub resends it.
            const paused = new Promise<{requestId: string; responseStatusCode?: number}>(resolve => {
                interception.once('Fetch.requestPaused', resolve);
            });
            await interception.send('Fetch.enable', {patterns: [{urlPattern: new URL(endpoint, participantPage.url()).href, requestStage: 'Response'}]});
            await submit.click();
            const committed = await paused;
            pausedId = committed.requestId;
            expect(committed.responseStatusCode).toBe(200);
            await expect(submit).toBeDisabled();
            await expect(form.getByLabel('Amount', {exact: true})).toBeDisabled();
            await expect(form.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
            await expect(form).toContainText(/saving|confirmation/i);
            await participantPage.clock.fastForward(10_001);
            await expect(form).toContainText('longer than usual');
            await expect(submit).toBeDisabled();
            expect((await readFinance(participant.request, event.id)).invoices).toHaveLength(3);
            await form.locator('form').evaluate(node => node.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true})));
            expect(posts).toHaveLength(4);
            await interception.send('Fetch.failRequest', {requestId: committed.requestId, errorReason: 'Failed'});
            pausedId = undefined;
            // The same durable receipt now presents its history actions through
            // the common page host while this mounted invoice stays a draft.
            const uncertainty = participantPage.locator('main [data-frontend-notices] .frontend-notification')
                .filter({hasText: 'We could not confirm whether your invoice was saved. It may still have been submitted. Check invoice history before uploading it again.'});
            await expect(uncertainty).toHaveCount(1);
            await expect(uncertainty).toBeVisible();
            await expect(uncertainty).toContainText(/could not confirm|unconfirmed/i);
            await expect(submit).toBeDisabled();
            await form.locator('form').evaluate(node => node.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true})));
            expect(posts).toHaveLength(4);
            await form.screenshot({path: info.outputPath('upload-unconfirmed.png'), animations: 'disabled'});
            await uncertainty.getByRole('button', {name: /Check invoice history|View invoice history|Reload and check saved invoices/i}).click();
            await expect(participantPage.locator('[data-finance-history]')).toContainText('Committed response lost');
            expect((await readFinance(participant.request, event.id)).invoices.filter(invoice => invoice.description === 'Committed response lost')).toHaveLength(1);
            await expect(submit).toBeDisabled();
            await expect(form.getByLabel('Amount', {exact: true})).toHaveValue('14');
            await uncertainty.getByRole('button', {name: 'I have checked the invoice history', exact: true}).click();
            await expect(uncertainty).toHaveCount(0);
            await expect(submit).toBeEnabled();
            await expect(form.getByLabel('Amount', {exact: true})).toHaveValue('');
            await expect(form.getByLabel('Proof (image or PDF)', {exact: true})).toHaveValue('');
            await expect(pool).toHaveValue(poolId);
            expect(posts).toHaveLength(4);
        } finally {
            if (pausedId) await interception.send('Fetch.failRequest', {requestId: pausedId, errorReason: 'Failed'}).catch(() => undefined);
            await interception.send('Fetch.disable').catch(() => undefined);
            await interception.detach().catch(() => undefined);
        }
        expect(await participantPage.evaluate(() => performance.timeOrigin)).toBe(timedDocumentMarker);
        expect(document.navigations).toEqual([]);
        expect(document.errors).toEqual([]);
    } finally { await participant.close(); }
});

/** Calculate a saved fixture from its actual preview revision before checking
 * the participant read, which cannot calculate or settle the organizer pool. */
async function closeFinanceFixture(request: APIRequestContext, eventId: string, poolId: string): Promise<void> {
    const endpoint = `/api/v1/events/${eventId}/finance/pools/${poolId}`;
    const preview = await financeFixtureRequest(request, 'GET', `${endpoint}/preview`);
    expect(preview.status()).toBe(200);
    const revision = (await preview.json()).revision;
    expect((await financeFixtureRequest(request, 'POST', `${endpoint}/close`, {data: {expectedRevision: revision, sendEmails: false}})).status()).toBe(200);
}

test('reads saved signed ledgers and lazy calculations independently from current pool totals at desktop and mobile widths', async ({page, browser, baseURL}, info) => {
    test.setTimeout(150_000);
    const participant = await browser.newContext({baseURL});
    const other = await browser.newContext({baseURL});
    try {
        const event = await createFrontendEventFixture(page.request);
        await registerFinanceParticipant(participant.request, event.id, 'Saved refund payer');
        await registerFinanceParticipant(other.request, event.id, 'Saved due payer');
        const refundPool = await createFinancePool(page.request, event.id, 'A saved refund', {description: 'Receipt audit archive'});
        const duePool = await createFinancePool(page.request, event.id, 'B saved payment');
        const zeroPool = await createFinancePool(page.request, event.id, 'C zero payment');
        await submitFinanceFixture(participant.request, event.id, refundPool, 'Original saved receipt', '100');
        const submitted = (await readFinance(participant.request, event.id)).invoices[0]!;
        expect((await financeFixtureRequest(page.request, 'POST', `/api/v1/events/${event.id}/finance/pools/${refundPool}/invoices/${submitted.id}/approve`, {data: {}})).status()).toBe(200);
        await submitFinanceInvoiceFixture(page.request, `/api/v1/events/${event.id}/finance/pools/${duePool}/invoices/organizer`,
            {amount: '80', description: 'Saved venue cost'});
        for (const poolId of [refundPool, duePool, zeroPool]) await closeFinanceFixture(page.request, event.id, poolId);
        const savedOrganizer = await readFinance(page.request, event.id, true);
        const settled = savedOrganizer.shares.find(share => share.poolId === refundPool && share.payerName === 'Saved due payer')!;
        expect((await financeFixtureRequest(page.request, 'POST', `/api/v1/events/${event.id}/finance/pools/${refundPool}/shares/${settled.id}/settlement`, {data: {isPaid: true}})).status()).toBe(200);
        // This late source cost marks recalculation pending. Reading must retain
        // the signed original shares and their already recorded transfer status.
        await submitFinanceInvoiceFixture(page.request, `/api/v1/events/${event.id}/finance/pools/${refundPool}/invoices/organizer`,
            {amount: '40', description: 'Late unapplied pool cost',
                registrationId: (await readFinance(participant.request, event.id)).registrationId!});
        const own = await readFinance(participant.request, event.id);
        expect(own.shares.map(share => share.amount).sort()).toEqual(['-50.00', '0.00', '40.00']);
        expect(own.shares.find(share => share.poolId === refundPool)).toMatchObject({status: 'refund', needsRecalculation: true});
        const refund = own.shares.find(share => share.poolId === refundPool)!;
        const zero = own.shares.find(share => share.poolId === zeroPool)!;
        expect(zero).toMatchObject({amount: '0.00', status: 'settled'});
        const foreignShare = savedOrganizer.shares.find(share => share.poolId === refundPool && share.id !== refund.id)!;
        const deniedBreakdown = await financeFixtureRequest(participant.request, 'GET', `/api/v1/events/${event.id}/finance/pools/${refundPool}/shares/${foreignShare.id}?audience=participant`, {
            headers: await frontendEventHeaders(participant.request),
        });
        expect(deniedBreakdown.status()).toBe(403);
        const personalPage = await participant.newPage();
        personalPage.on('dialog', dialog => dialog.accept());
        const lazyReads: string[] = [];
        personalPage.on('request', function recordSavedBreakdown(request) {
            if (request.method() === 'GET' && /\/finance\/pools\/[^/]+\/shares\//u.test(request.url())) lazyReads.push(request.url());
        });

        for (const width of [1280, 390]) {
            await personalPage.setViewportSize({width, height: 900});
            const finance = await openParticipantFinance(personalPage, event.id);
            const document = await observeFinanceDocument(personalPage);
            if (width === 1280) {
                // Closing this accepted attributed cost retains the original
                // saved refund and does not record a participant settlement.
                const lateInvoice = own.invoices.find(invoice => invoice.description === 'Late unapplied pool cost')!;
                const lateRow = finance.locator(`[data-finance-invoice="${lateInvoice.id}"]`);
                await lateRow.getByRole('button', {name: 'Close', exact: true}).click();
                await personalPage.getByRole('dialog').locator('.modal-footer').getByRole('button', {name: 'Close', exact: true}).click();
                await expect(lateRow).toContainText('Closed');
                const afterClose = await readFinance(participant.request, event.id);
                expect(afterClose.shares.find(share => share.id === refund.id)).toMatchObject({amount: '-50.00', isPaid: false, status: 'refund'});
            }
            const ledger = finance.locator('[data-finance-shares]');
            await expect(ledger.locator('[data-finance-share]')).toHaveCount(3);
            await expect(ledger).toContainText('-50.00');
            await expect(ledger).toContainText('Refund to receive');
            await expect(ledger.locator(`[data-finance-share="${zero.id}"]`)).toContainText('No payment');
            await ledger.getByLabel('Filter share status', {exact: true}).selectOption('refund');
            await expect(ledger.locator('[data-finance-share]')).toHaveCount(1);
            await ledger.getByLabel('Filter share status', {exact: true}).selectOption('');
            await ledger.getByLabel('Search shares', {exact: true}).fill('B saved');
            await expect(ledger.locator('[data-finance-share]')).toHaveCount(1);
            await ledger.getByLabel('Search shares', {exact: true}).fill('Receipt audit archive');
            await expect(ledger.locator('[data-finance-share]')).toHaveCount(1);
            await expect(ledger.locator('[data-finance-share]')).toContainText('A saved refund');
            await ledger.getByLabel('Search shares', {exact: true}).fill('');
            await ledger.getByLabel('Sort pools', {exact: true}).selectOption('amount-desc');
            await expect(ledger.locator('[data-finance-share]').first()).toContainText('B saved payment');
            await ledger.getByLabel('Sort pools', {exact: true}).selectOption('name');
            const refreshed = personalPage.waitForResponse(value => value.request().method() === 'GET'
                && new URL(value.url()).pathname === `/api/v1/events/${event.id}/finance`);
            await ledger.getByRole('button', {name: 'Refresh list', exact: true}).click();
            expect((await refreshed).status()).toBe(200);
            await expectUsableFrontendLayout(ledger);
            await expectFinanceViewport(personalPage, ledger);
            await ledger.screenshot({path: info.outputPath(`vue-personal-ledger-${width}.png`), animations: 'disabled'});
            const row = ledger.locator(`[data-finance-share="${refund.id}"]`);
            expect(lazyReads).toHaveLength(width === 1280 ? 0 : 1);
            const previous = lazyReads.length;
            const response = personalPage.waitForResponse(value => value.request().method() === 'GET'
                && new URL(value.url()).pathname.endsWith(`/finance/pools/${refundPool}/shares/${refund.id}`));
            await row.getByRole('button', {name: /^View breakdown/u}).click();
            expect((await response).status()).toBe(200);
            expect(lazyReads.length).toBe(previous + 1);
            const dialog = personalPage.getByRole('dialog');
            await expect(dialog).toContainText('Calculated balance');
            await expect(dialog).toContainText('-50.00');
            await expect(dialog).toContainText('Recalculation required. These amounts and calculation inputs are from the saved calculation.');
            await dialog.locator('details > summary').first().click();
            await expect(dialog.locator('[data-calculation-display]')).toBeVisible();
            await expectUsableFrontendLayout(dialog);
            await dialog.screenshot({path: info.outputPath(`vue-personal-breakdown-${width}.png`), animations: 'disabled'});
            // The fixed dialog footer must not make later calculation sections
            // unreachable. Exercise the real body scroll to its saved balance
            // without shifting the surrounding Event document.
            const documentScroll = await personalPage.evaluate(() => scrollY);
            const balanceFormula = dialog.locator('[data-calculation-section="balance"]');
            await balanceFormula.scrollIntoViewIfNeeded();
            await expect(balanceFormula).toBeInViewport();
            await expect(balanceFormula).toContainText('-50.00');
            expect(await personalPage.evaluate(() => scrollY)).toBe(documentScroll);
            if (width === 390) {
                const body = dialog.locator('.modal-body');
                expect(await body.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
                const bodyBounds = (await body.boundingBox())!;
                const balanceBounds = (await balanceFormula.boundingBox())!;
                expect(balanceBounds.y).toBeGreaterThanOrEqual(bodyBounds.y - 1);
                expect(balanceBounds.y + balanceBounds.height).toBeLessThanOrEqual(bodyBounds.y + bodyBounds.height + 1);
            }
            await dialog.getByRole('button', {name: 'Close', exact: true}).last().click();
            await expect(row.getByRole('button', {name: /^View breakdown/u})).toBeFocused();
            expect(await personalPage.evaluate(() => performance.timeOrigin)).toBe(document.marker);
            expect(document.navigations).toEqual([]);
            expect(document.errors).toEqual([]);
        }
        const finalOrganizer = await readFinance(page.request, event.id, true);
        expect(finalOrganizer.shares.find(share => share.id === settled.id)).toMatchObject({amount: '50.00', status: 'settled', isPaid: true});
        expect(finalOrganizer.pools.find(pool => pool.id === refundPool)!.needsRecalculation).toBe(true);
        expect(finalOrganizer.shares.find(share => share.id === refund.id)!.amount).toBe('-50.00');
        expect(finalOrganizer.pools.find(pool => pool.id === refundPool)!.summary!.primary
            .find(metric => metric.key === 'totalAmount')!.amount).toBe('140.00');

        for (const width of [1280, 390]) {
            await page.setViewportSize({width, height: 900});
            await page.goto(`/event/${event.id}/admin?locale=en`, {waitUntil: 'domcontentloaded'});
            await waitForFrontendHydration(page);
            const organizerPool = page.locator(`[data-finance-pool="${refundPool}"]`);
            await organizerPool.locator('.accordion-button').first().click();
            const totals = organizerPool.locator('.pool-totals');
            await expect(totals).toContainText('140.00');
            await totals.locator('details > summary').first().click();
            await expect(totals).toContainText('Saved settlement totals');
            await expect(totals).toContainText('50.00');
            await expect(organizerPool).toContainText('Recalculation required');
            const organizerLedger = organizerPool.locator('[data-finance-shares]');
            await expect(organizerLedger).toContainText('Payment status describes the payer named in each row. The calculated balance stays visible after payment or refund.');
            await expect(organizerLedger.locator('[data-finance-share]')).toHaveCount(2);
            await expect(organizerLedger.locator(`[data-finance-share="${settled.id}"]`)).toContainText('Paid');
            await expect(organizerLedger.locator(`[data-finance-share="${refund.id}"]`)).toContainText('-50.00');
            await expectUsableFrontendLayout(totals);
            await expectUsableFrontendLayout(organizerLedger);
            await expectFinanceViewport(page, organizerPool);
            await totals.screenshot({path: info.outputPath(`vue-organizer-totals-${width}.png`), animations: 'disabled'});
            await organizerLedger.screenshot({path: info.outputPath(`vue-organizer-ledger-${width}.png`), animations: 'disabled'});
            await organizerPool.locator(`[data-finance-share="${settled.id}"]`).getByRole('button', {name: /^View breakdown/u}).click();
            const organizerBreakdown = page.getByRole('dialog');
            await expect(organizerBreakdown).toContainText('A saved refund');
            await expect(organizerBreakdown).toContainText('Saved due payer');
            await expect(organizerBreakdown).toContainText('Paid');
            await organizerBreakdown.screenshot({path: info.outputPath(`vue-organizer-breakdown-${width}.png`), animations: 'disabled'});
            await organizerBreakdown.getByRole('button', {name: 'Close', exact: true}).last().click();
            // P9 replaces the former native destination with an in-place review.
            // Opening and cancelling it must preserve both the document and saved shares.
            await expect(organizerPool.getByRole('button', {name: 'Pool settings', exact: true})).toBeVisible();
            await expect(organizerPool.getByRole('button', {name: 'Participants & factors', exact: true})).toBeVisible();
            await expect(organizerPool.getByRole('button', {name: 'Send settlement emails', exact: true})).toBeVisible();
            const documentTime = await page.evaluate(() => performance.timeOrigin);
            await organizerPool.getByRole('button', {name: 'Recalculate pool', exact: true}).click();
            const preview = page.getByRole('dialog', {name: 'Calculation preview · A saved refund', exact: true});
            await expect(preview).toContainText('This preview does not change shares or send emails.');
            await expect(preview.getByRole('button', {name: 'Apply recalculation', exact: true})).toBeEnabled();
            await preview.getByRole('button', {name: 'Cancel', exact: true}).click();
            await expect(preview).toBeHidden();
            expect(await page.evaluate(() => performance.timeOrigin)).toBe(documentTime);
            expect((await readFinance(page.request, event.id, true)).shares).toEqual(finalOrganizer.shares);
        }

        // Locale changes re-render actual saved-data labels and controls. User
        // names and saved notes remain evidence, and the new number rendering
        // does not assume a currency that the invoice model never declared.
        await page.goto(`/event/${event.id}/admin?locale=de`, {waitUntil: 'domcontentloaded'});
        await waitForFrontendHydration(page);
        const germanPool = page.locator(`[data-finance-pool="${refundPool}"]`);
        await germanPool.locator('.accordion-button').first().click();
        await expect(germanPool).toContainText('140,00');
        await expect(germanPool).toContainText('Saved refund payer');
        await expectUsableFrontendLayout(germanPool);
        await expectFinanceViewport(page, germanPool);
        await germanPool.screenshot({path: info.outputPath('vue-german-organizer-mobile.png'), animations: 'disabled'});
    } finally {
        await participant.close();
        await other.close();
    }
});

test('keeps applied and pending coverage separate, opens personal coverage in place and retires denied locale history', async ({page, browser, baseURL}, info) => {
    test.setTimeout(150_000);
    const actors: BrowserContext[] = [];
    try {
        const event = await createFrontendEventFixture(page.request);
        const names = ['Coverage payer', ...Array.from({length: 7}, (_, index) => `Covered ${String(index + 1).padStart(2, '0')}`), 'Pending beneficiary'];
        for (const name of names) {
            const actor = await browser.newContext({baseURL});
            actors.push(actor);
            await registerFinanceParticipant(actor.request, event.id, name);
        }
        const participant = actors[0]!;
        const participantsResponse = await financeFixtureRequest(page.request, 'GET', `/api/v1/events/${event.id}/participants`);
        expect(participantsResponse.status()).toBe(200);
        const participants = (await participantsResponse.json()).participants as {id: string; name: string}[];
        const participantId = (name: string) => participants.find(person => person.name === name)!.id;
        const payerId = participantId('Coverage payer');
        const savedPool = await createFinancePool(page.request, event.id, 'Saved coverage pool');
        const openPool = await createFinancePool(page.request, event.id, 'Open coverage pool');
        const savedEndpoint = `/api/v1/events/${event.id}/finance/pools/${savedPool}`;
        const originalBeneficiaries = names.slice(1, 8);
        expect((await financeFixtureRequest(page.request, 'POST', `${savedEndpoint}/takeovers/manage`, {
            data: {payerId, beneficiaries: originalBeneficiaries.map(participantId)},
        })).status()).toBe(200);
        await submitFinanceInvoiceFixture(page.request, `${savedEndpoint}/invoices/organizer`,
            {amount: '90', description: 'Saved coverage cost'});
        await closeFinanceFixture(page.request, event.id, savedPool);
        expect((await financeFixtureRequest(page.request, 'POST', `${savedEndpoint}/takeovers/manage`, {
            data: {payerId, beneficiaries: [participantId('Pending beneficiary')]},
        })).status()).toBe(200);
        expect((await financeFixtureRequest(participant.request, 'POST', `/api/v1/events/${event.id}/finance/pools/${openPool}/takeovers`, {
            data: {beneficiaries: [participantId('Covered 01')]},
        })).status()).toBe(200);
        await submitFinanceFixture(participant.request, event.id, openPool, 'Private coverage receipt');

        const organizer = await readFinance(page.request, event.id, true);
        const saved = organizer.pools.find(pool => pool.id === savedPool)!;
        expect(saved.hasPendingTakeovers).toBe(true);
        expect(saved.coverageGroups[0]!.beneficiaries.map(person => person.name)).toEqual(originalBeneficiaries);
        expect(saved.pendingCoverageGroups[0]!.beneficiaries.map(person => person.name)).toEqual(['Pending beneficiary']);
        const savedPayerCount = organizer.shares.filter(share => share.poolId === savedPool).length;
        expect(organizer.shares.find(share => share.poolId === savedPool && share.payerName === 'Coverage payer')!.amount).toBe('80.00');
        const own = await readFinance(participant.request, event.id);
        expect(own.pools.find(pool => pool.id === savedPool)).toMatchObject({coverageGroups: [], pendingCoverageGroups: [], assignedCount: 0});
        expect(own.pools.find(pool => pool.id === openPool)!.coverageGroups[0]!.beneficiaries.map(person => person.name)).toEqual(['Covered 01']);
        const personalPage = await participant.newPage();

        for (const width of [1280, 390]) {
            await page.setViewportSize({width, height: 900});
            await page.goto(`/event/${event.id}/admin?locale=en`, {waitUntil: 'domcontentloaded'});
            await waitForFrontendHydration(page);
            const pool = page.locator(`[data-finance-pool="${savedPool}"]`);
            await pool.locator('.accordion-button').first().click();
            const applied = pool.locator('[data-finance-coverage-kind="applied"]');
            const pending = pool.locator('[data-finance-coverage-kind="pending"]');
            await expect(applied.getByRole('button', {name: /^Edit takeovers for/u})).toHaveCount(0);
            await expect(pending.getByRole('button', {name: 'Edit takeovers for Coverage payer', exact: true})).toBeVisible();
            await expect(applied.locator('.coverage-name-chip')).toHaveCount(6);
            await expect(applied).not.toContainText('Pending beneficiary');
            await applied.getByRole('button', {name: /Show all 7/u}).click();
            await expect(applied.locator('.coverage-name-chip')).toHaveCount(7);
            await applied.getByLabel('Takeover payers per page', {exact: true}).selectOption('25');
            await expect(applied.locator('.coverage-name-chip')).toHaveCount(7);
            await expect(applied).toContainText('Covered 07');
            const savedLedger = pool.locator('[data-finance-shares]');
            await savedLedger.getByLabel('Search shares', {exact: true}).fill('Covered 07');
            await expect(savedLedger.locator('[data-finance-share]').filter({hasText: 'Coverage payer'})).toHaveCount(1);
            await expect(savedLedger.getByText(`${savedPayerCount} payers`, {exact: true})).toBeVisible();
            await savedLedger.getByLabel('Search shares', {exact: true}).fill('');
            await expect(pending.locator('.coverage-name-chip')).toHaveCount(1);
            await expect(pending).toContainText('Pending beneficiary');
            await applied.getByLabel('Search takeovers', {exact: true}).fill('Covered 07');
            await expect(applied.locator('[data-finance-coverage-payer]')).toHaveCount(1);
            await expect(applied.locator('.coverage-name-chip')).toHaveText(['Covered 07']);
            await applied.getByLabel('Search takeovers', {exact: true}).fill('');
            await applied.getByLabel('Takeover payers per page', {exact: true}).selectOption('25');
            await applied.getByRole('button', {name: /Show all 7/u}).click();
            await expectUsableFrontendLayout(applied);
            await expectUsableFrontendLayout(pending);
            await expectFinanceViewport(page, pool);
            await applied.screenshot({path: info.outputPath(`vue-applied-coverage-${width}.png`), animations: 'disabled'});
            await pending.screenshot({path: info.outputPath(`vue-pending-coverage-${width}.png`), animations: 'disabled'});
            await pool.locator('[data-finance-pool-coverage]').screenshot({
                path: info.outputPath(`vue-applied-and-pending-coverage-${width}.png`), animations: 'disabled',
            });

            await personalPage.setViewportSize({width, height: 900});
            const personal = await openParticipantFinance(personalPage, event.id);
            const participantPool = personal.locator(`[data-finance-participant-pool="${openPool}"]`);
            await expect(personal.locator('[data-finance-participant-pool]')).toHaveCount(1);
            await expect(participantPool).toContainText('Covered 01');
            const documentMarker = await personalPage.evaluate(() => performance.timeOrigin);
            await participantPool.getByRole('button', {name: 'Manage takeovers', exact: true}).click();
            const chooser = personalPage.getByRole('dialog');
            await expect(chooser.getByLabel('Payer', {exact: true})).toHaveCount(0);
            await expect(chooser.locator(`[data-finance-beneficiary="${participantId('Covered 01')}"]`).getByRole('checkbox')).toBeChecked();
            await chooser.getByRole('button', {name: 'Close', exact: true}).last().click();
            expect(await personalPage.evaluate(() => performance.timeOrigin)).toBe(documentMarker);
            await expectUsableFrontendLayout(participantPool);
            await participantPool.screenshot({path: info.outputPath(`vue-participant-coverage-${width}.png`), animations: 'disabled'});
        }

        // Warm both actual language projections before a real registration loss.
        // A validated denial must retire hidden aliases too, so changing language
        // cannot briefly reinsert the old private history into the document.
        await personalPage.setViewportSize({width: 1280, height: 900});
        await personalPage.locator('#frontend-locale').selectOption('de');
        await expect(personalPage.locator('[data-finance-history]')).toContainText('Private coverage receipt');
        await personalPage.locator('#frontend-locale').selectOption('en');
        await expect(personalPage.locator('[data-finance-history]')).toContainText('Private coverage receipt');
        expect((await financeFixtureRequest(participant.request, 'DELETE', `/api/v1/events/${event.id}/registration`)).status()).toBe(200);
        const denied = personalPage.waitForResponse(response => new URL(response.url()).pathname === `/api/v1/events/${event.id}/finance`
            && response.status() === 403);
        await personalPage.locator('[data-finance-section]').getByRole('button', {name: 'Refresh', exact: true}).first().click();
        await denied;
        await expect(personalPage.locator('[data-finance-history]')).toHaveCount(0);
        await personalPage.evaluate(function observeRetiredPrivateText() {
            const state = window as unknown as {financePrivateTextAppeared: boolean};
            state.financePrivateTextAppeared = false;
            function inspectPrivateText(): void {
                if (window.document.body.textContent?.includes('Private coverage receipt')) state.financePrivateTextAppeared = true;
            }
            new MutationObserver(inspectPrivateText).observe(window.document.body, {subtree: true, childList: true, characterData: true});
        });
        const translatedDenial = personalPage.waitForResponse(response => new URL(response.url()).pathname === `/api/v1/events/${event.id}/finance`
            && response.status() === 403);
        await personalPage.locator('#frontend-locale').selectOption('de');
        await expect(personalPage.locator('html')).toHaveAttribute('lang', 'de');
        await translatedDenial;
        await expect(personalPage.locator('[data-finance-history]')).toHaveCount(0);
        expect(await personalPage.evaluate(() => (window as unknown as {financePrivateTextAppeared: boolean}).financePrivateTextAppeared)).toBe(false);
    } finally {
        for (const actor of actors) await actor.close();
    }
});
