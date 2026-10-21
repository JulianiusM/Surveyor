import {expect, test, type APIRequestContext, type Dialog, type Locator, type Page, type Request, type TestInfo} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import type {components} from '../../src/types/api/v1';
import {createFrontendEventFixture, frontendEventHeaders} from '../keywords/frontendEventE2EKeywords';
import {waitForPilotHydration} from '../keywords/frontendDynamicKeywords';
import {dismissFrontendSuccessNotifications, expectUsableFrontendLayout, readNamedControlContracts as formContract,
    readSecondaryInstructionColors, readVisiblePresentation, openModalForE2E, closeModalForE2E} from '../keywords/e2eCoreKeywords';
import {createTranslator} from '../../src/modules/localization/translator';

test.use({actionTimeout: 10_000});

/** Establish actual guest membership through the integrated application rather
 * than manufacturing finance read models or replacing the session boundary. */
async function registerParticipant(request: APIRequestContext, eventId: string, name: string): Promise<void> {
    expect((await request.post(`/event/${eventId}/guest`, {form: {username: name}, maxRedirects: 0})).status()).toBe(302);
    expect((await request.post(`/api/event/${eventId}/register`, {data: {
        arrivalDate: '2030-06-01', departureDate: '2030-06-04', dietary: ['MEAT'],
    }})).status()).toBe(200);
}

/** Read persisted authority independently of the page that issued the command.
 * A fresh read never retries creation or assumes uncertain delivery rolled back. */
async function readFinance(request: APIRequestContext, eventId: string, organizer = true): Promise<components['schemas']['FinanceView']> {
    const response = await request.get(`/api/v1/events/${eventId}/finance${organizer ? '/organizer' : ''}`, {
        headers: await frontendEventHeaders(request),
    });
    expect(response.status()).toBe(200);
    return response.json();
}

/** Open the real organizer page and selected pool disclosure in either renderer.
 * Native remains the unchanged comparator; Vue hydration is awaited explicitly. */
async function openPool(page: Page, eventId: string, poolId: string, pilot: boolean, locale = 'en'): Promise<Locator> {
    await page.goto(`${pilot ? '/frontend-pilot' : ''}/event/${eventId}/admin?locale=${locale}`, {waitUntil: 'domcontentloaded'});
    if (pilot) await waitForPilotHydration(page);
    const pool = page.locator(pilot ? `[data-finance-pool="${poolId}"]` : `.invoice-pool[data-pool="${poolId}"]`);
    const toggle = pool.locator('.accordion-button').first();
    await expect(toggle).toBeVisible();
    if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
    return pool;
}

/** Native selects do not wrap their selected option. Check the actual font and
 * available text area so responsive columns cannot hide the saved choice. */
async function expectReadableSelection(select: Locator): Promise<void> {
    const measurement = await select.evaluate(element => {
        const control = element as HTMLSelectElement;
        const style = getComputedStyle(control);
        const canvas = document.createElement('canvas');
        const text = canvas.getContext('2d')!;
        text.font = style.font;
        return {needed: text.measureText(control.selectedOptions[0]?.label ?? '').width,
            available: control.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight)};
    });
    expect(measurement.needed).toBeLessThanOrEqual(measurement.available + 1);
}

/** A proof remains real uploaded evidence in both fixture and authored browser
 * commands; a selected filename alone does not establish proof ownership. */
function proof(name = 'p8-receipt.pdf') {
    return {name, mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\nP8 original evidence\n%%EOF')};
}

type ReviewInvoice = components['schemas']['FinanceInvoice'];
type ReviewAction = 'approve' | 'decline' | 'revise' | 'reject' | 'close';

/** An explicit case describes the existing operation, rather than reconstructing
 * business eligibility or a second invoice state machine inside the comparator. */
interface ReviewScene {
    action: ReviewAction;
    button: string;
    originalDescription: string;
    amount?: string;
    description?: string;
    reason?: string;
    closedPool?: boolean;
    status: ReviewInvoice['status'];
}

/** Establish saved CLOSED-pool evidence through the existing native fixture
 * operation. P8 reviews its later source changes; no Vue calculation or
 * settlement control is introduced or exercised by this preparation. */
async function closeReviewPoolFixture(request: APIRequestContext, eventId: string, poolId: string): Promise<void> {
    // Capture the real preview revision before requesting the fixture calculation.
    const endpoint = `/api/event/${eventId}/invoice-pools/${poolId}`;
    const preview = await request.get(`${endpoint}/preview`);
    expect(preview.status()).toBe(200);
    const revision = (await preview.json()).data.revision;
    expect((await request.post(`${endpoint}/close`, {data: {expectedRevision: revision, sendEmails: false}})).status()).toBe(200);

    // A separate payer gives the retained snapshot a nonzero balance. Record
    // one real settlement so later source changes must preserve both its
    // calculated amount and the paid presentation, not merely zero totals.
    const saved = await readFinance(request, eventId);
    expect(saved.pools.find(pool => pool.id === poolId)).toMatchObject({status: 'CLOSED', needsRecalculation: false});
    const payable = saved.shares.find(share => share.poolId === poolId && Number(share.amount) > 0);
    expect(payable, 'Fixture must contain a positive saved payer balance').toBeDefined();
    expect((await request.post(`${endpoint}/shares/${payable!.id}/pay`, {data: {isPaid: true}})).status()).toBe(200);
    const settled = await readFinance(request, eventId);
    expect(settled.shares.find(share => share.id === payable!.id)).toMatchObject({amount: payable!.amount, isPaid: true, status: 'settled'});
}

/** Compare the complete saved share/settlement presentation while allowing its
 * explicit stale-display flag to reflect newly pending source changes. */
function savedReviewShares(view: components['schemas']['FinanceView']) {
    // The flag describes current pool inputs; it is not a saved balance, payment
    // or audit value. Every other admitted share field must remain unchanged.
    return view.shares.map(function withoutPendingFlag(share) {
        const {needsRecalculation, ...saved} = share;
        return saved;
    });
}

/** Preserve each original and its raw browser measurements for independent review.
 * Native inline fields and Vue's combined review have different wrappers; neither
 * a screenshot nor these measurements claims exact native-pixel equality. */
async function captureReviewSurface(surface: Locator, info: TestInfo, name: string): Promise<void> {
    // Wait for the actual painted controls and fonts before retaining evidence.
    await expect(surface).toBeVisible();
    await surface.page().evaluate(() => document.fonts.ready);
    await expectUsableFrontendLayout(surface);
    const path = info.outputPath(`${name}.png`);
    await surface.screenshot({path, animations: 'disabled'});
    await info.attach(name, {path, contentType: 'image/png'});

    // Raw text, fields, styles and geometry remain adjacent to the original.
    const measured = await readVisiblePresentation(surface, ['h5', 'p', 'label', 'input', 'textarea', 'button', 'a']);
    await writeFile(info.outputPath(`${name}-presentation.json`), JSON.stringify(measured, null, 2));
}

/** Read the values and validation rules shared by the two real field sets.
 * Native NEW fields live in the row and Vue puts them in its review dialog;
 * textarea height, decimal keyboard hints and wrapper names are presentation. */
async function reviewFieldContracts(surface: Locator, selectors: string[]) {
    const contracts = [];
    for (const selector of selectors) {
        const field = surface.locator(selector);
        await expect(field).toBeVisible();
        contracts.push(await field.evaluate(function inspectReviewField(element) {
            const control = element as HTMLInputElement | HTMLTextAreaElement;
            return {value: control.value, required: control.required, disabled: control.matches(':disabled'),
                readOnly: control.readOnly, minLength: Math.max(0, control.minLength), maxLength: control.maxLength,
                placeholder: control.placeholder, type: control.type,
                min: control instanceof HTMLInputElement ? control.min : null,
                max: control instanceof HTMLInputElement ? control.max : null,
                step: control instanceof HTMLInputElement ? control.step : null};
        }));
    }
    return contracts;
}

/** Select only this action's explicit field family in its real presentation. */
function reviewFieldSelectors(scene: ReviewScene, nativeInline = false): string[] {
    if (scene.action === 'approve' || scene.action === 'revise') return nativeInline
        ? ['.invoice-corrected-amount', '.invoice-corrected-description']
        : ['[name="correctedAmount"]', '[name="correctedDescription"]'];
    if (scene.action === 'decline' || scene.action === 'reject') return nativeInline
        ? ['.invoice-rejection-reason'] : ['[name="rejectionReason"]'];
    return [];
}

/** Fill only the fields belonging to this review action and return their public
 * contracts. NEW native review has two optional inline correction fields; its
 * unrelated rejection draft must never become part of an acceptance comparison. */
async function fillReviewFields(surface: Locator, scene: ReviewScene, nativeInline = false) {
    // Scope writes to the selected action, keeping its opposite decision's
    // fields out of both the captured draft and the field comparison.
    const selectors = reviewFieldSelectors(scene, nativeInline);
    if (scene.action === 'approve' || scene.action === 'revise') {
        await surface.locator(selectors[0]!).fill(scene.amount!);
        await surface.locator(selectors[1]!).fill(scene.description!);
    }
    if (scene.action === 'decline' || scene.action === 'reject') {
        await surface.locator(selectors[0]!).fill(scene.reason!);
    }
    return reviewFieldContracts(surface, selectors);
}

/** Assert every value in the final frozen correction/rejection review. The
 * original invoice remains separate evidence in Vue's combined dialog; native
 * presents it in its saved row before the separately opened lifecycle dialog. */
async function expectFrozenReview(dialog: Locator, invoice: ReviewInvoice, scene: ReviewScene): Promise<void> {
    // Frozen proposed values remain distinct from the saved original subject.
    await expect(dialog).toContainText(`Invoice #${invoice.id}`);
    if (scene.action === 'revise') {
        await expect(dialog).toContainText(`New amount: ${Number(scene.amount).toFixed(2)}`);
        await expect(dialog).toContainText(`Description: ${scene.description}`);
    } else await expect(dialog).toContainText(`Rejection reason: ${scene.reason}`);
    await expect(dialog).toContainText('The change is saved only after you confirm below. Original details and proof are preserved.');
    const warning = dialog.locator('[data-invoice-closed-warning], form p.text-warning');
    if (scene.closedPool) {
        await expect(warning).toBeVisible();
        await expect(warning).toHaveText('Existing shares and payments stay unchanged. Recalculate this closed pool to apply the change to shares.');
    } else await expect(warning).not.toBeVisible();
    // A valid review exposes both explicit consent and nonmutating return.
    await expect(dialog.getByRole('button', {name: 'Back to edit', exact: true})).toBeEnabled();
    await expect(dialog.getByRole('button', {name: scene.action === 'revise' ? 'Confirm correction' : 'Confirm rejection', exact: true})).toBeEnabled();
}

/** Inspect and cancel the unchanged native operation without sending its write.
 * Immediate decisions keep their actual inline-edit then confirmation sequence;
 * accepted changes retain edit, final review and Back-to-edit draft restoration. */
async function inspectNativeReview(page: Page, info: TestInfo, eventId: string, poolId: string,
    invoice: ReviewInvoice, scene: ReviewScene) {
    const pool = await openPool(page, eventId, poolId, false);
    // A CLOSED pool without NEW invoices starts with its native audit trail
    // collapsed. Follow the real disclosure before inspecting the saved row.
    const history = pool.locator('details').filter({has: page.locator('[data-invoice-ledger]')});
    if (await history.getAttribute('open') === null) await history.locator(':scope > summary').click();
    await expect(history).toHaveJSProperty('open', true);
    const row = pool.locator('[data-invoice-row]').filter({has: page.locator(`[data-id="${invoice.id}"]`)});
    await expect(row).toContainText(invoice.description!);
    const retroactive = scene.action === 'revise' || scene.action === 'reject';
    const inline = scene.action === 'approve' || scene.action === 'decline';
    const contracts = inline ? await fillReviewFields(row, scene, true) : [];
    await captureReviewSurface(row, info, `native-p8-${scene.action}-row`);
    const opened = page.locator(!retroactive ? '#invoiceCommandConfirmModal'
        : scene.action === 'revise' ? '#invoiceEditModal' : '#invoiceRejectModal');
    if (!retroactive) await expect(opened).toHaveAttribute('data-initialized', 'true');
    await openModalForE2E(opened, row.getByRole('button', {name: scene.button, exact: true}));

    if (!retroactive) {
        const confirmation = page.locator('#invoiceCommandConfirmModal');
        const wording = scene.action === 'approve' ? `Accept this invoice for ${scene.amount}?`
            : scene.action === 'decline' ? `Reject this invoice for ${invoice.amount}?`
                : `Close this accepted invoice for ${invoice.correctedAmount ?? invoice.amount}?`;
        await expect(confirmation.locator('[data-invoice-command-description]')).toHaveText(wording);
        await expect(confirmation.locator('[data-invoice-command-confirm]')).toHaveText(scene.button);
        await expect(confirmation.locator('[data-invoice-command-confirm]')).toBeEnabled();
        await captureReviewSurface(confirmation, info, `native-p8-${scene.action}-confirmation`);
        await closeModalForE2E(confirmation);
        return contracts;
    }

    // A lifecycle edit captures the existing revision without changing it.
    const editing = page.locator(scene.action === 'revise' ? '#invoiceEditModal' : '#invoiceRejectModal');
    if (scene.action === 'revise') {
        expect(Number(await editing.locator('[name="correctedAmount"]').inputValue())).toBe(Number(invoice.correctedAmount ?? invoice.amount));
        await expect(editing.locator('[name="correctedDescription"]')).toHaveValue(invoice.correctedDescription ?? invoice.description!);
    }
    const editedContracts = await fillReviewFields(editing, scene);
    await captureReviewSurface(editing, info, `native-p8-${scene.action}-edit`);
    const confirmation = page.locator('#invoiceConfirmModal');
    await openModalForE2E(confirmation, editing.getByRole('button', {name: 'Continue', exact: true}));
    await expectFrozenReview(confirmation, invoice, scene);
    await captureReviewSurface(confirmation, info, `native-p8-${scene.action}-confirmation`);
    await openModalForE2E(editing, confirmation.getByRole('button', {name: 'Back to edit', exact: true}));
    expect(await reviewFieldContracts(editing, reviewFieldSelectors(scene))).toEqual(editedContracts);
    await closeModalForE2E(editing);
    return editedContracts;
}

/** Compare Vue's actual combined review with the native fields/final facts.
 * Cancellation is checked before the caller reopens and commits once, so
 * inspection never supplies consent to an earlier preview. */
async function inspectVueReview(page: Page, info: TestInfo, eventId: string, poolId: string,
    invoice: ReviewInvoice, scene: ReviewScene, nativeContracts: Awaited<ReturnType<typeof reviewFieldContracts>>) {
    const pool = await openPool(page, eventId, poolId, true);
    const marker = await page.evaluate(() => performance.timeOrigin);
    const row = pool.locator(`[data-finance-invoice="${invoice.id}"]`);
    await row.getByRole('button', {name: scene.button, exact: true}).click();
    const dialog = page.getByRole('dialog');
    if (scene.action === 'revise') {
        expect(Number(await dialog.locator('[name="correctedAmount"]').inputValue())).toBe(Number(invoice.correctedAmount ?? invoice.amount));
        await expect(dialog.locator('[name="correctedDescription"]')).toHaveValue(invoice.correctedDescription ?? invoice.description!);
    }
    const contracts = await fillReviewFields(dialog, scene);
    // NEW decline adds native's already-enforced required reason to its semantic
    // dialog field. Its native inline textarea communicates that through the
    // placeholder and controller check rather than HTML's required attribute.
    if (scene.action === 'decline') {
        expect(nativeContracts[0]?.required).toBe(false);
        expect(contracts[0]?.required).toBe(true);
        expect(nativeContracts[0]?.placeholder).toBe('Required when rejecting');
        expect(contracts[0]?.placeholder).toBe('');
        expect({...contracts[0], required: false, placeholder: 'Required when rejecting'}).toEqual(nativeContracts[0]);
    } else expect(contracts).toEqual(nativeContracts);
    await expect(dialog).toContainText(`Invoice #${invoice.id}`);
    await expect(dialog).toContainText(invoice.description!);
    const retroactive = scene.action === 'revise' || scene.action === 'reject';
    if (retroactive) {
        await captureReviewSurface(dialog, info, `vue-p8-${scene.action}-edit`);
        await dialog.getByRole('button', {name: 'Continue', exact: true}).click();
        await expectFrozenReview(dialog, invoice, scene);
        await captureReviewSurface(dialog, info, `vue-p8-${scene.action}-confirmation`);
        await dialog.getByRole('button', {name: 'Back to edit', exact: true}).click();
        expect(await reviewFieldContracts(dialog, reviewFieldSelectors(scene))).toEqual(contracts);
    } else {
        const amount = scene.action === 'approve' ? Number(scene.amount).toFixed(2) : invoice.correctedAmount ?? invoice.amount;
        const wording = scene.action === 'approve' ? `Accept this invoice for ${amount}?`
            : scene.action === 'decline' ? `Reject this invoice for ${amount}?` : `Close this accepted invoice for ${amount}?`;
        await expect(dialog).toContainText(wording);
        await captureReviewSurface(dialog, info, `vue-p8-${scene.action}-confirmation`);
    }

    // Dirty-close consent releases only this preview, never the business action.
    let discarded = false;
    async function discardPreview(prompt: Dialog): Promise<void> {
        expect(prompt.type()).toBe('confirm');
        discarded = true;
        await prompt.accept();
    }
    page.once('dialog', discardPreview);
    try {
        await dialog.getByRole('button', {name: 'Cancel', exact: true}).click();
    } finally { page.off('dialog', discardPreview); }
    expect(discarded).toBe(scene.action !== 'close');
    await expect(dialog).not.toBeVisible();
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(marker);
    return {pool, row};
}

for (const width of [1280, 390]) {
    test(`compares native and Vue invoice review, accepted changes and closure at ${width}px`, async function compareInvoiceReview({page, browser, baseURL}, info) {
        test.setTimeout(180_000);
        const participant = await browser.newContext({baseURL});
        const other = await browser.newContext({baseURL});
        const errors: string[] = [];
        const commands: Request[] = [];
        page.on('pageerror', function recordBrowserError(error) { errors.push(error.message); });
        try {
            // Real native fixture operations establish two actual guests and
            // three saved invoices. Both renderers inspect these records before a Vue
            // command deliberately advances their existing lifecycle below.
            const event = await createFrontendEventFixture(page.request);
            await registerParticipant(participant.request, event.id, 'P8 review evidence participant');
            await registerParticipant(other.request, event.id, 'P8 review saved-share payer');
            const created = await page.request.post(`/api/event/${event.id}/invoice-pools`, {data: {
                name: 'P8 matched invoice reviews', distribution: 'EQUAL', assignAll: true, subtractPersonalInvoices: true,
                sendCalculationEmails: false,
            }});
            expect(created.status()).toBe(200);
            const poolId = (await created.json()).data.id as string;
            const endpoint = `/api/event/${event.id}/invoice-pools/${poolId}`;
            const fixtures = [
                {amount: '40', description: 'P8 review immutable original'},
                {amount: '9', description: 'P8 review submitted rejection'},
                {amount: '17', description: 'P8 review accepted closure'},
            ];
            for (const [index, fixture] of fixtures.entries()) {
                expect((await participant.request.post(`${endpoint}/submit`, {multipart: {
                    ...fixture, proof: proof(`p8-review-${index}.pdf`),
                }})).status()).toBe(200);
            }
            const closing = (await readFinance(page.request, event.id)).invoices.find(invoice => invoice.description === fixtures[2]!.description)!;
            expect((await page.request.post(`${endpoint}/invoices/${closing.id}/approve`, {data: {}})).status()).toBe(200);
            await page.setViewportSize({width, height: 900});
            page.on('request', recordReviewCommand);

            // Each row names its actual operation and expected saved result.
            // Revisions and authorization still belong to the integrated backend;
            // the test never derives an alternative lifecycle from these cases.
            const scenes: ReviewScene[] = [
                {action: 'approve', button: 'Accept', originalDescription: fixtures[0]!.description,
                    amount: '35', description: 'P8 review effective accepted', status: 'APPROVED'},
                {action: 'decline', button: 'Reject', originalDescription: fixtures[1]!.description,
                    reason: 'P8 review submitted evidence declined', status: 'REJECTED'},
                {action: 'revise', button: 'Correct', originalDescription: fixtures[0]!.description,
                    amount: '32', description: 'P8 review effective corrected', closedPool: width === 390, status: 'APPROVED'},
                {action: 'reject', button: 'Reject from pool', originalDescription: fixtures[0]!.description,
                    reason: 'P8 review accepted cost removed', closedPool: width === 390, status: 'REJECTED'},
                {action: 'close', button: 'Close', originalDescription: fixtures[2]!.description, status: 'CLOSED'},
            ];
            for (const scene of scenes) {
                // Retain OPEN desktop comparisons. The phone fixture adds the
                // existing closed-pool warning/recalculation branch immediately
                // before accepted changes, without migrating calculation UI.
                if (scene.closedPool && scene.action === 'revise') await closeReviewPoolFixture(page.request, event.id, poolId);
                const saved = await readFinance(page.request, event.id);
                if (scene.closedPool) expect(saved.shares.some(share => Number(share.amount) > 0 && share.isPaid)).toBe(true);
                const invoice = saved.invoices.find(candidate => candidate.description === scene.originalDescription)!;
                const commandCount = commands.length;
                const contracts = await inspectNativeReview(page, info, event.id, poolId, invoice, scene);
                expect(commands).toHaveLength(commandCount);
                expect(await readFinance(page.request, event.id)).toEqual(saved);
                const {row} = await inspectVueReview(page, info, event.id, poolId, invoice, scene, contracts);
                expect(commands).toHaveLength(commandCount);
                expect(await readFinance(page.request, event.id)).toEqual(saved);

                // Reopen after cancellation, then send only the explicitly
                // confirmed operation. The ordinary Vue document is retained.
                const marker = await page.evaluate(() => performance.timeOrigin);
                await row.getByRole('button', {name: scene.button, exact: true}).click();
                const dialog = page.getByRole('dialog');
                await fillReviewFields(dialog, scene);
                const retroactive = scene.action === 'revise' || scene.action === 'reject';
                if (retroactive) await dialog.getByRole('button', {name: 'Continue', exact: true}).click();
                const confirm = scene.action === 'revise' ? 'Confirm correction'
                    : scene.action === 'reject' ? 'Confirm rejection' : 'Confirm';
                await dialog.getByRole('button', {name: confirm, exact: true}).click();
                await expect(dialog).not.toBeVisible();
                await expect.poll(readSavedInvoice).toMatchObject({status: scene.status});
                const result = await readSavedInvoice();
                expect(result).toMatchObject({amount: invoice.amount, description: invoice.description, proofUrl: invoice.proofUrl});
                if (scene.amount) expect(result).toMatchObject({correctedAmount: Number(scene.amount).toFixed(2), correctedDescription: scene.description});
                if (scene.reason) expect(result?.rejectionReason).toBe(scene.reason);
                if (scene.closedPool) {
                    // Accepted-cost changes mark pending inputs without silently
                    // recalculating saved balances or settlement presentation.
                    const current = await readFinance(page.request, event.id);
                    expect(current.pools.find(pool => pool.id === poolId)).toMatchObject({status: 'CLOSED', needsRecalculation: true});
                    expect(savedReviewShares(current)).toEqual(savedReviewShares(saved));
                }
                expect(commands).toHaveLength(commandCount + 1);
                expect(await page.evaluate(() => performance.timeOrigin)).toBe(marker);
                await dismissFrontendSuccessNotifications(page);

                async function readSavedInvoice(): Promise<ReviewInvoice | undefined> {
                    return (await readFinance(page.request, event.id)).invoices.find(candidate => candidate.id === invoice.id);
                }
            }
            expect(errors).toEqual([]);

            function recordReviewCommand(request: Request): void {
                const path = new URL(request.url()).pathname;
                if (request.method() === 'POST' && (path.startsWith(`${endpoint}/invoices/`)
                    || path.includes(`/finance/pools/${poolId}/invoices/`))) commands.push(request);
            }
        } finally {
            await participant.close();
            await other.close();
        }
    });
}

test('preserves native organizer form information and completes pool creation, attributed entry and invoice review within the Vue document', async ({page, browser, baseURL}, info) => {
    test.setTimeout(180_000);
    const participant = await browser.newContext({baseURL});
    const other = await browser.newContext({baseURL});
    try {
        const event = await createFrontendEventFixture(page.request);
        await registerParticipant(participant.request, event.id, 'P8 paid-by participant');
        await registerParticipant(other.request, event.id, 'P8 other participant');
        const created = await page.request.post(`/api/event/${event.id}/invoice-pools`, {data: {
            name: 'P8 reference pool', distribution: 'EQUAL', assignAll: true, subtractPersonalInvoices: true,
            sendCalculationEmails: false, roundUpShares: false,
        }});
        expect(created.status()).toBe(200);
        const poolId = (await created.json()).data.id as string;
        const nativeEndpoint = `/api/event/${event.id}/invoice-pools/${poolId}`;
        expect((await participant.request.post(`${nativeEndpoint}/submit`, {multipart: {
            amount: '40', description: 'P8 immutable original receipt', proof: proof(),
        }})).status()).toBe(200);
        expect((await other.request.post(`${nativeEndpoint}/submit`, {multipart: {
            amount: '9', description: 'P8 rejected receipt', proof: proof('p8-rejected.pdf'),
        }})).status()).toBe(200);

        // Each renderer exposes equivalent settings and optional-proof entry at
        // desktop and phone widths. These captures preserve both real surfaces.
        for (const width of [1280, 390]) {
            await page.setViewportSize({width, height: 900});
            const native = await openPool(page, event.id, poolId, false);
            await native.getByRole('button', {name: 'Pool settings', exact: true}).click();
            const nativeSettings = page.locator(`#pool-${poolId}-settings`);
            const settingsFields = ['distribution', 'description', 'roundUpShares', 'sendCalculationEmails'];
            const settings = await formContract(nativeSettings, settingsFields);
            await nativeSettings.screenshot({path: info.outputPath(`native-p8-settings-${width}.png`), animations: 'disabled'});
            await nativeSettings.getByRole('button', {name: 'Close', exact: true}).last().click();
            await native.getByRole('button', {name: 'Add invoice / amount', exact: true}).click();
            const nativeExpense = page.locator(`#pool-${poolId}-expense`);
            const expenseFields = ['amount', 'description', 'registrationId', 'proof'];
            const expense = await formContract(nativeExpense, expenseFields);
            const expenseInstructionColors = await readSecondaryInstructionColors(nativeExpense);
            expect(expenseInstructionColors.length).toBeGreaterThan(0);
            await nativeExpense.screenshot({path: info.outputPath(`native-p8-expense-${width}.png`), animations: 'disabled'});
            await nativeExpense.getByRole('button', {name: 'Cancel', exact: true}).click();

            const vue = await openPool(page, event.id, poolId, true);
            await vue.getByRole('button', {name: 'Pool settings', exact: true}).click();
            const settingsDialog = page.getByRole('dialog');
            expect(await formContract(settingsDialog, settingsFields)).toEqual(settings);
            await expectReadableSelection(settingsDialog.locator('[name="distribution"]'));
            await expectUsableFrontendLayout(settingsDialog);
            await settingsDialog.screenshot({path: info.outputPath(`vue-p8-settings-${width}.png`), animations: 'disabled'});
            await settingsDialog.getByRole('button', {name: 'Close', exact: true}).last().click();
            await vue.getByRole('button', {name: 'Add invoice / amount', exact: true}).click();
            const expenseDialog = page.getByRole('dialog');
            expect(await formContract(expenseDialog, expenseFields)).toEqual(expense);
            expect(new Set(await readSecondaryInstructionColors(expenseDialog))).toEqual(new Set(expenseInstructionColors));
            await expectUsableFrontendLayout(expenseDialog);
            await expenseDialog.screenshot({path: info.outputPath(`vue-p8-expense-${width}.png`), animations: 'disabled'});
            await expenseDialog.getByRole('button', {name: 'Cancel', exact: true}).click();
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        }

        await page.setViewportSize({width: 1280, height: 900});
        const pool = await openPool(page, event.id, poolId, true);
        const documentMarker = await page.evaluate(() => performance.timeOrigin);
        const navigations: string[] = [];
        page.on('request', request => {
            if (request.isNavigationRequest() && request.frame() === page.mainFrame()) navigations.push(request.url());
        });
        await page.getByRole('button', {name: 'Create pool', exact: true}).click();
        const creation = page.getByRole('dialog');
        await expect(creation.locator('[name="status"]')).toHaveValue('OPEN');
        await creation.locator('[name="name"]').fill('P8 created through Vue');
        await creation.locator('[name="status"]').selectOption('ORGANIZER_ONLY');
        await creation.locator('[name="distribution"]').selectOption('EQUAL');
        await creation.getByRole('button', {name: 'Add pool', exact: true}).click();
        await expect.poll(async () => (await readFinance(page.request, event.id)).pools.some(row => row.name === 'P8 created through Vue')).toBe(true);
        await creation.getByRole('button', {name: 'Cancel', exact: true}).click();

        await pool.getByRole('button', {name: 'Add invoice / amount', exact: true}).click();
        const expense = page.getByRole('dialog');
        const own = await readFinance(participant.request, event.id, false);
        await expense.locator('[name="amount"]').fill('013.50');
        await expense.locator('[name="amount"]').hover();
        await page.mouse.wheel(0, 120);
        await expect(expense.locator('[name="amount"]')).not.toBeFocused();
        await expect(expense.locator('[name="amount"]')).toHaveValue('013.50');
        await expense.locator('[name="description"]').fill('P8 attributed organizer expense');
        await expect(expense.locator('[name="amount"]')).toHaveValue('013.50');
        await expense.locator('[name="registrationId"]').selectOption(own.registrationId!);
        await expense.locator('[name="proof"]').setInputFiles(proof('p8-organizer.pdf'));
        await expense.getByRole('button', {name: 'Add invoice / amount', exact: true}).click();
        await expect(expense.locator('[name="amount"]')).toHaveValue('');
        await expect(expense.locator('[name="proof"]')).toHaveValue('');
        await expense.getByRole('button', {name: 'Cancel', exact: true}).click();
        const attributed = (await readFinance(participant.request, event.id, false)).invoices.find(row => row.description === 'P8 attributed organizer expense')!;
        expect(attributed).toMatchObject({organizerRecorded: true, participantName: 'P8 paid-by participant', amount: '13.50', canClose: true});
        expect((await other.request.get(attributed.proofUrl!)).status()).toBe(403);
        expect((await participant.request.get(attributed.proofUrl!)).status()).toBe(200);

        const pending = (await readFinance(page.request, event.id)).invoices.find(row => row.description === 'P8 immutable original receipt')!;
        const row = pool.locator(`[data-finance-invoice="${pending.id}"]`);
        await row.getByRole('button', {name: 'Accept', exact: true}).click();
        const review = page.getByRole('dialog');
        await review.locator('[name="correctedAmount"]').fill('35');
        await review.locator('[name="correctedDescription"]').fill('P8 effective accepted receipt');
        await review.getByRole('button', {name: 'Confirm', exact: true}).click();
        await expect.poll(async () => (await readFinance(page.request, event.id)).invoices.find(invoice => invoice.id === pending.id)?.status).toBe('APPROVED');
        await expect(row).toContainText('P8 immutable original receipt');
        await expect(row).toContainText('P8 effective accepted receipt');
        await row.getByRole('button', {name: 'Correct', exact: true}).click();
        const correction = page.getByRole('dialog');
        await correction.locator('[name="correctedAmount"]').fill('32');
        await correction.locator('[name="correctedDescription"]').fill('P8 cancelled source draft');
        await correction.getByRole('button', {name: 'Continue', exact: true}).click();
        await correction.getByRole('button', {name: 'Back to edit', exact: true}).click();
        await expect(correction.locator('[name="correctedDescription"]')).toHaveValue('P8 cancelled source draft');
        await correction.getByRole('button', {name: 'Continue', exact: true}).click();
        // A second actor changes saved inputs after review. Applying the captured
        // revision must reject definitely and preserve the reviewed correction.
        expect((await page.request.post(nativeEndpoint, {data: {distribution: 'EQUAL', description: 'Concurrent pool settings'}})).status()).toBe(200);
        await correction.getByRole('button', {name: 'Confirm correction', exact: true}).click();
        await expect(correction).toContainText(/changed|conflict|review/i);
        expect((await readFinance(page.request, event.id)).invoices.find(invoice => invoice.id === pending.id)?.correctedAmount).toBe('35.00');
        await correction.getByRole('button', {name: 'Back to edit', exact: true}).click();
        await expect(correction.locator('[name="correctedDescription"]')).toHaveValue('P8 cancelled source draft');
        page.once('dialog', dialog => dialog.accept());
        await correction.getByRole('button', {name: 'Cancel', exact: true}).click();
        expect(await page.evaluate(() => performance.timeOrigin)).toBe(documentMarker);
        expect(navigations).toEqual([]);

        const german = await openPool(page, event.id, poolId, true, 'de');
        await page.setViewportSize({width: 390, height: 844});
        await german.getByRole('button', {name: 'Pooleinstellungen', exact: true}).click();
        await expectUsableFrontendLayout(page.getByRole('dialog'));
        await expectReadableSelection(page.getByRole('dialog').locator('[name="distribution"]'));
        await page.getByRole('dialog').screenshot({path: info.outputPath('vue-p8-settings-german-390.png'), animations: 'disabled'});
    } finally {
        await participant.close();
        await other.close();
    }
});

test('saves allocation forms separately, retains an additive draft during removal and keeps participant coverage restricted to its own payer', async ({page, browser, baseURL}, info) => {
    test.setTimeout(150_000);
    const participant = await browser.newContext({baseURL});
    const other = await browser.newContext({baseURL});
    try {
        const event = await createFrontendEventFixture(page.request);
        await registerParticipant(participant.request, event.id, 'P8 allocation payer');
        await registerParticipant(other.request, event.id, 'P8 allocation beneficiary');
        const response = await page.request.post(`/api/event/${event.id}/invoice-pools`, {data: {
            name: 'P8 allocation inputs', distribution: 'EQUAL', assignAll: true, sendCalculationEmails: false,
        }});
        expect(response.status()).toBe(200);
        const poolId = (await response.json()).data.id as string;
        const ownId = (await readFinance(participant.request, event.id, false)).registrationId!;
        const otherId = (await readFinance(other.request, event.id, false)).registrationId!;
        for (const width of [1280, 390]) {
            await page.setViewportSize({width, height: 900});
            const native = await openPool(page, event.id, poolId, false);
            await native.getByRole('button', {name: 'Participants & factors', exact: true}).click();
            const nativeAssignments = page.locator(`#pool-${poolId}-participants`);
            const allocationInstructionColors = await readSecondaryInstructionColors(nativeAssignments);
            expect(allocationInstructionColors.length).toBeGreaterThan(0);
            await expect(nativeAssignments.locator('[data-participant-factor]').first()).toHaveAttribute('step', '0.0001');
            await nativeAssignments.screenshot({path: info.outputPath(`native-p8-allocation-${width}.png`), animations: 'disabled'});
            await nativeAssignments.getByRole('button', {name: 'Close', exact: true}).last().click();
            const vue = await openPool(page, event.id, poolId, true);
            await vue.getByRole('button', {name: 'Participants & factors', exact: true}).click();
            const allocation = page.getByRole('dialog');
            expect(new Set(await readSecondaryInstructionColors(allocation))).toEqual(new Set(allocationInstructionColors));
            await expect(allocation.getByLabel('Share factor', {exact: true}).first()).toHaveAttribute('step', '0.0001');
            await expectUsableFrontendLayout(allocation);
            await allocation.screenshot({path: info.outputPath(`vue-p8-allocation-${width}.png`), animations: 'disabled'});
            await allocation.getByRole('button', {name: 'Close', exact: true}).last().click();
        }
        const pool = page.locator(`[data-finance-pool="${poolId}"]`);
        const documentMarker = await page.evaluate(() => performance.timeOrigin);
        await pool.getByRole('button', {name: 'Participants & factors', exact: true}).click();
        const allocation = page.getByRole('dialog');
        await allocation.getByLabel('Assign to all participants', {exact: true}).uncheck();
        const payer = allocation.locator(`[data-finance-assignment="${ownId}"]`);
        const beneficiary = allocation.locator(`[data-finance-assignment="${otherId}"]`);
        await payer.getByLabel('Share factor', {exact: true}).fill('0');
        await beneficiary.getByLabel('Share factor', {exact: true}).fill('1.2500');
        await beneficiary.getByLabel('Exempt', {exact: true}).check();
        await allocation.getByRole('button', {name: 'Save participants & factors', exact: true}).click();
        await expect.poll(async () => (await readFinance(page.request, event.id)).pools.find(row => row.id === poolId)?.assignments?.find(row => row.registrationId === ownId)?.factor).toBe('0.0000');
        expect((await readFinance(page.request, event.id)).pools.find(row => row.id === poolId)?.assignments?.find(row => row.registrationId === otherId))
            .toMatchObject({factor: '1.2500', isExempt: true});
        await allocation.getByRole('button', {name: 'Close', exact: true}).last().click();

        await pool.getByRole('button', {name: 'Surcharges & rebates', exact: true}).click();
        const adjustments = page.getByRole('dialog');
        await adjustments.getByLabel('Participant', {exact: true}).selectOption(ownId);
        await adjustments.getByLabel('Amount (negative for a rebate)', {exact: true}).fill('-3.25');
        await adjustments.getByLabel('Note', {exact: true}).fill('P8 saved signed rebate');
        await adjustments.getByRole('button', {name: 'Add surcharge or rebate', exact: true}).click();
        await expect(adjustments.locator('[data-finance-adjustment]')).toHaveCount(1);
        await expect(adjustments).toContainText('Rebate');
        // The shared saved notification overlays the dialog without moving its
        // fields. Use its ordinary dismissal before editing the saved row below.
        const savedAdjustmentNotice = adjustments.locator('[data-pilot-notices] .pilot-notification.alert-success')
            .filter({hasText: 'Adjustment saved.'});
        await expect(savedAdjustmentNotice).toBeVisible();
        const dismissAdjustmentNotice = savedAdjustmentNotice.getByRole('button', {name: 'Dismiss notification', exact: true});
        await expect(dismissAdjustmentNotice).toBeEnabled();
        await dismissAdjustmentNotice.click();
        await expect(savedAdjustmentNotice).toHaveCount(0);
        await adjustments.getByLabel('Participant', {exact: true}).selectOption(otherId);
        await adjustments.getByLabel('Amount (negative for a rebate)', {exact: true}).fill('2.50');
        await adjustments.getByLabel('Note', {exact: true}).fill('P8 unsaved sibling adjustment');
        page.once('dialog', dialog => dialog.accept());
        await adjustments.locator('[data-finance-adjustment]').getByRole('button', {name: /^Remove Rebate for/u}).click();
        await expect(adjustments.locator('[data-finance-adjustment]')).toHaveCount(0);
        await expect(adjustments.getByLabel('Note', {exact: true})).toHaveValue('P8 unsaved sibling adjustment');
        await expect(adjustments.getByLabel('Amount (negative for a rebate)', {exact: true})).toHaveValue('2.50');
        page.once('dialog', dialog => dialog.accept());
        await adjustments.getByRole('button', {name: 'Close', exact: true}).last().click();

        await pool.getByRole('button', {name: 'Manage takeovers', exact: true}).click();
        const coverage = page.getByRole('dialog');
        await coverage.getByLabel('Payer', {exact: true}).selectOption(ownId);
        await coverage.locator(`[data-finance-beneficiary="${otherId}"]`).getByRole('checkbox').check();
        await coverage.getByRole('button', {name: 'Save changes', exact: true}).click();
        await expect.poll(async () => (await readFinance(page.request, event.id)).pools.find(row => row.id === poolId)?.currentCoverageGroups?.[0]?.payerId).toBe(ownId);
        await coverage.getByRole('button', {name: 'Close', exact: true}).last().click();
        await pool.getByRole('button', {name: 'Edit takeovers for P8 allocation payer', exact: true}).click();
        await expect(page.getByRole('dialog').getByLabel('Payer', {exact: true})).toHaveValue(ownId);
        await expect(page.getByRole('dialog').locator(`[data-finance-beneficiary="${otherId}"]`).getByRole('checkbox')).toBeChecked();
        await page.getByRole('dialog').getByRole('button', {name: 'Close', exact: true}).last().click();

        // Submission access is independently reversible before calculation. A
        // cancelled confirmation cannot spend a revision or issue a mutation.
        let accessRequests = 0;
        function trackSubmissionAccess(request: Request): void {
            if (request.method() === 'POST' && request.url().endsWith(`/finance/pools/${poolId}/submission-state`)) accessRequests++;
        }
        page.on('request', trackSubmissionAccess);
        page.once('dialog', dialog => dialog.dismiss());
        await pool.getByRole('button', {name: 'Close participant invoices', exact: true}).click();
        expect(accessRequests).toBe(0);
        expect((await readFinance(page.request, event.id)).pools.find(row => row.id === poolId)?.status).toBe('OPEN');
        page.once('dialog', dialog => dialog.accept());
        await pool.getByRole('button', {name: 'Close participant invoices', exact: true}).click();
        await expect.poll(async () => (await readFinance(page.request, event.id)).pools.find(row => row.id === poolId)?.status).toBe('ORGANIZER_ONLY');
        expect((await participant.request.post(`/api/event/${event.id}/invoice-pools/${poolId}/takeovers`, {data: {beneficiaries: []}})).status()).toBe(409);
        page.once('dialog', dialog => dialog.accept());
        await pool.getByRole('button', {name: 'Open participant invoices', exact: true}).click();
        await expect.poll(async () => (await readFinance(page.request, event.id)).pools.find(row => row.id === poolId)?.status).toBe('OPEN');
        expect(accessRequests).toBe(2);
        page.off('request', trackSubmissionAccess);
        expect(await page.evaluate(() => performance.timeOrigin)).toBe(documentMarker);

        const personalPage = await participant.newPage();
        await personalPage.goto(`/frontend-pilot/event/${event.id}?locale=en`);
        await waitForPilotHydration(personalPage);
        const finance = personalPage.locator('[data-finance-section]');
        const toggle = finance.locator('.accordion-button').first();
        if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
        await finance.locator(`[data-finance-participant-pool="${poolId}"]`).getByRole('button', {name: 'Manage takeovers', exact: true}).click();
        const personalCoverage = personalPage.getByRole('dialog');
        await expect(personalCoverage.getByLabel('Payer', {exact: true})).toHaveCount(0);
        await expect(personalCoverage.locator(`[data-finance-beneficiary="${otherId}"]`).getByRole('checkbox')).toBeChecked();
        await personalCoverage.locator(`[data-finance-beneficiary="${otherId}"]`).getByRole('checkbox').uncheck();
        await personalCoverage.getByRole('button', {name: 'Save changes', exact: true}).click();
        await expect.poll(async () => (await readFinance(page.request, event.id)).pools.find(row => row.id === poolId)?.currentCoverageGroups?.length).toBe(0);
    } finally {
        await participant.close();
        await other.close();
    }
});

for (const width of [320, 390]) {
    test(`completes German finance input, review and participant journeys with readable instructions at ${width}px`, async ({page, browser, baseURL}, info) => {
        test.setTimeout(150_000);
        const messages = createTranslator('de');
        const participant = await browser.newContext({baseURL, viewport: {width, height: 900}});
        const other = await browser.newContext({baseURL});
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        try {
            const event = await createFrontendEventFixture(page.request);
            await registerParticipant(participant.request, event.id, 'Zahlende Person am See');
            await registerParticipant(other.request, event.id, 'Mitreisende Person am See');
            await page.setViewportSize({width, height: 900});
            await page.goto(`/frontend-pilot/event/${event.id}/admin?locale=de`, {waitUntil: 'domcontentloaded'});
            await waitForPilotHydration(page);
            const documentTime = await page.evaluate(() => performance.timeOrigin);
            const finance = page.locator('[data-finance-section]');
            await finance.getByRole('button', {name: messages.t('finance.createPool'), exact: true}).click();
            const creation = page.getByRole('dialog');
            const poolName = `Reisekosten ${width}`;
            await creation.locator('[name="name"]').fill(poolName);
            await creation.locator('[name="distribution"]').selectOption('EQUAL');
            await creation.locator('[name="assignAll"]').check();
            await expectUsableFrontendLayout(creation);
            const creationColors = await readSecondaryInstructionColors(creation);
            expect(creationColors.length).toBeGreaterThan(0);
            expect(new Set(creationColors)).toEqual(new Set(['rgb(173, 181, 189)']));
            await creation.getByRole('button', {name: messages.t('finance.addPool'), exact: true}).click();
            await expect.poll(async () => (await readFinance(page.request, event.id)).pools.some(pool => pool.name === poolName)).toBe(true);
            const poolId = (await readFinance(page.request, event.id)).pools.find(pool => pool.name === poolName)!.id;
            const ownId = (await readFinance(participant.request, event.id, false)).registrationId!;
            const otherId = (await readFinance(other.request, event.id, false)).registrationId!;
            await dismissFrontendSuccessNotifications(page);
            // Creation deliberately remains open for another pool after saving;
            // complete that interaction before opening a saved pool's actions.
            await creation.getByRole('button', {name: messages.t('common.cancel'), exact: true}).click();
            const pool = finance.locator(`[data-finance-pool="${poolId}"]`);
            const toggle = pool.locator('.accordion-button').first();
            if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();

            // Every dialog remains inside one Event document. Its explicit
            // finance theme survives the portal independently of the opener.
            await pool.getByRole('button', {name: messages.t('finance.poolSettings'), exact: true}).click();
            const settings = page.getByRole('dialog');
            await expectUsableFrontendLayout(settings);
            await expectReadableSelection(settings.locator('[name="distribution"]'));
            expect(new Set(await readSecondaryInstructionColors(settings))).toEqual(new Set(['rgb(173, 181, 189)']));
            await settings.locator('[name="description"]').fill('Gemeinsam gespeicherte Reisekosten');
            await settings.locator('[name="sendCalculationEmails"]').uncheck();
            await settings.getByRole('button', {name: messages.t('finance.savePoolSettings'), exact: true}).click();
            await expect.poll(async () => (await readFinance(page.request, event.id)).pools.find(pool => pool.id === poolId)?.description)
                .toBe('Gemeinsam gespeicherte Reisekosten');
            await dismissFrontendSuccessNotifications(page);
            await settings.getByRole('button', {name: messages.t('common.close'), exact: true}).last().click();

            await pool.getByRole('button', {name: messages.t('finance.addInvoiceAmount'), exact: true}).click();
            const expense = page.getByRole('dialog');
            await expectUsableFrontendLayout(expense);
            expect(new Set(await readSecondaryInstructionColors(expense))).toEqual(new Set(['rgb(173, 181, 189)']));
            await expect(expense.locator('[name="amount"]')).toHaveAttribute('inputmode', 'decimal');
            await expense.locator('[name="amount"]').fill('013.50');
            await expense.locator('[name="description"]').fill('Beleg der zahlenden Person');
            await expense.locator('[name="registrationId"]').selectOption(ownId);
            await expect(expense.locator('[name="amount"]')).toHaveValue('013.50');
            await expense.screenshot({path: info.outputPath(`german-finance-expense-${width}.png`), animations: 'disabled'});
            await expense.getByRole('button', {name: messages.t('finance.addInvoiceAmount'), exact: true}).click();
            await expect(expense.locator('[name="amount"]')).toHaveValue('');
            const attributed = (await readFinance(participant.request, event.id, false)).invoices.find(invoice => invoice.description === 'Beleg der zahlenden Person')!;
            expect(attributed).toMatchObject({amount: '13.50', organizerRecorded: true, participantName: 'Zahlende Person am See'});
            await dismissFrontendSuccessNotifications(page);
            await expense.getByRole('button', {name: messages.t('common.cancel'), exact: true}).click();
            await expect(pool.locator(`[data-finance-invoice="${attributed.id}"]`)).toContainText('13,50');

            // Seed only the independent source invoice through the unchanged
            // native route; acceptance itself uses the actual German browser UI.
            const endpoint = `/api/event/${event.id}/invoice-pools/${poolId}`;
            expect((await participant.request.post(`${endpoint}/submit`, {multipart: {
                amount: '22.50', description: 'Zu prüfender Teilnehmerbeleg', proof: proof(`german-${width}.pdf`),
            }})).status()).toBe(200);
            await finance.getByRole('button', {name: messages.t('common.refresh'), exact: true}).first().click();
            const pending = (await readFinance(page.request, event.id)).invoices.find(invoice => invoice.description === 'Zu prüfender Teilnehmerbeleg')!;
            const row = pool.locator(`[data-finance-invoice="${pending.id}"]`);
            await row.getByRole('button', {name: messages.t('finance.accept'), exact: true}).click();
            const review = page.getByRole('dialog');
            await expectUsableFrontendLayout(review);
            // Optional NEW-invoice correction deliberately preserves the native
            // accepted precision instead of applying retroactive step validation.
            await review.locator('[name="correctedAmount"]').fill('22.333');
            await expect(review.locator('[name="correctedAmount"]')).toHaveValue('22.333');
            await captureReviewSurface(review, info, `vue-p8-approve-german-${width}`);
            const approved = page.waitForResponse(response => response.request().method() === 'POST'
                && response.url().endsWith(`/finance/pools/${poolId}/invoices/${pending.id}/approve`));
            await review.getByRole('button', {name: messages.t('finance.confirm'), exact: true}).click();
            const approval = await approved;
            expect(approval.status()).toBe(200);
            expect(approval.request().postDataJSON()).toMatchObject({correctedAmount: '22.333'});
            await expect.poll(async () => (await readFinance(page.request, event.id)).invoices.find(invoice => invoice.id === pending.id)?.status).toBe('APPROVED');
            await dismissFrontendSuccessNotifications(page);

            await pool.getByRole('button', {name: messages.t('finance.participantsFactors'), exact: true}).click();
            const allocation = page.getByRole('dialog');
            await expectUsableFrontendLayout(allocation);
            expect(new Set(await readSecondaryInstructionColors(allocation))).toEqual(new Set(['rgb(173, 181, 189)']));
            const payer = allocation.locator(`[data-finance-assignment="${ownId}"]`);
            await payer.getByLabel(messages.t('finance.shareFactor'), {exact: true}).fill('002.5000');
            await allocation.getByLabel(messages.t('finance.searchParticipants'), {exact: true}).fill('not a match');
            await allocation.getByLabel(messages.t('finance.searchParticipants'), {exact: true}).fill('');
            await expect(payer.getByLabel(messages.t('finance.shareFactor'), {exact: true})).toHaveValue('002.5000');
            await allocation.screenshot({path: info.outputPath(`german-finance-allocation-${width}.png`), animations: 'disabled'});
            await allocation.getByRole('button', {name: messages.t('finance.saveParticipantsFactors'), exact: true}).click();
            await expect.poll(async () => (await readFinance(page.request, event.id)).pools.find(pool => pool.id === poolId)?.assignments?.find(person => person.registrationId === ownId)?.factor).toBe('2.5000');
            await dismissFrontendSuccessNotifications(page);
            await allocation.getByRole('button', {name: messages.t('common.close'), exact: true}).last().click();

            await pool.getByRole('button', {name: messages.t('finance.surchargesRebates'), exact: true}).click();
            const adjustment = page.getByRole('dialog');
            await adjustment.getByLabel(messages.t('finance.participant5'), {exact: true}).selectOption(ownId);
            await adjustment.getByLabel(messages.t('finance.amountNegativeForARebate'), {exact: true}).fill('-003.25');
            await adjustment.getByLabel(messages.t('finance.note'), {exact: true}).fill('Gemeinsamer Fahrtrabatt');
            await expectUsableFrontendLayout(adjustment);
            expect(new Set(await readSecondaryInstructionColors(adjustment))).toEqual(new Set(['rgb(173, 181, 189)']));
            await adjustment.getByRole('button', {name: messages.t('finance.addSurchargeOrRebate'), exact: true}).click();
            await expect(adjustment.locator('[data-finance-adjustment]')).toHaveCount(1);
            expect((await readFinance(page.request, event.id)).pools.find(pool => pool.id === poolId)?.surcharges)
                .toContainEqual(expect.objectContaining({registrationId: ownId, amount: '-3.25', note: 'Gemeinsamer Fahrtrabatt'}));
            await expect(adjustment).toContainText('3,25');
            await dismissFrontendSuccessNotifications(page);
            await adjustment.getByRole('button', {name: messages.t('common.close'), exact: true}).last().click();

            await pool.getByRole('button', {name: messages.t('finance.manageTakeovers2'), exact: true}).click();
            const coverage = page.getByRole('dialog');
            await coverage.getByLabel(messages.t('finance.payer'), {exact: true}).selectOption(ownId);
            await coverage.locator(`[data-finance-beneficiary="${otherId}"]`).getByRole('checkbox').check();
            await expectUsableFrontendLayout(coverage);
            expect(new Set(await readSecondaryInstructionColors(coverage))).toEqual(new Set(['rgb(173, 181, 189)']));
            await coverage.getByRole('button', {name: messages.t('finance.saveChanges'), exact: true}).click();
            await expect.poll(async () => (await readFinance(page.request, event.id)).pools.find(pool => pool.id === poolId)?.currentCoverageGroups?.[0]?.payerId).toBe(ownId);
            await dismissFrontendSuccessNotifications(page);
            await coverage.getByRole('button', {name: messages.t('common.close'), exact: true}).last().click();

            const personal = await participant.newPage();
            personal.on('pageerror', error => errors.push(error.message));
            await personal.goto(`/frontend-pilot/event/${event.id}?locale=de`, {waitUntil: 'domcontentloaded'});
            await waitForPilotHydration(personal);
            const personalTime = await personal.evaluate(() => performance.timeOrigin);
            const ownFinance = personal.locator('[data-finance-section]');
            const ownToggle = ownFinance.locator('.accordion-button').first();
            if (await ownToggle.getAttribute('aria-expanded') !== 'true') await ownToggle.click();
            const personalPool = ownFinance.locator(`[data-finance-participant-pool="${poolId}"]`);
            await personalPool.getByRole('button', {name: messages.t('finance.manageTakeovers2'), exact: true}).click();
            const personalCoverage = personal.getByRole('dialog');
            await expect(personalCoverage.getByLabel(messages.t('finance.payer'), {exact: true})).toHaveCount(0);
            await expect(personalCoverage.locator(`[data-finance-beneficiary="${otherId}"]`).getByRole('checkbox')).toBeChecked();
            await expectUsableFrontendLayout(personalCoverage);
            await personalCoverage.getByRole('button', {name: messages.t('common.close'), exact: true}).last().click();
            await ownFinance.getByRole('button', {name: messages.t('finance.submitAnInvoiceHistory'), exact: true}).click();
            const submission = ownFinance.locator('[data-finance-submission]');
            await submission.getByLabel(messages.t('finance.choosePool'), {exact: true}).selectOption(poolId);
            await submission.getByLabel(messages.t('finance.amount'), {exact: true}).fill('007.50');
            await submission.getByLabel(messages.t('finance.description'), {exact: true}).fill('Deutscher Beleg vom Telefon');
            await submission.getByLabel(messages.t('finance.proofImageOrPDF'), {exact: true}).setInputFiles(proof(`phone-${width}.pdf`));
            await expectUsableFrontendLayout(submission);
            await expect(submission.getByLabel(messages.t('finance.amount'), {exact: true})).toHaveValue('007.50');
            await submission.getByRole('button', {name: messages.t('finance.submitInvoice'), exact: true}).click();
            await expect.poll(async () => (await readFinance(participant.request, event.id, false)).invoices.find(invoice => invoice.description === 'Deutscher Beleg vom Telefon')?.amount).toBe('7.50');
            await expect(submission.getByLabel(messages.t('finance.amount'), {exact: true})).toHaveValue('');
            await expect(submission.getByLabel(messages.t('finance.proofImageOrPDF'), {exact: true})).toHaveValue('');
            const personalHistoryColors = await readSecondaryInstructionColors(ownFinance.locator('[data-finance-history]'));
            expect(personalHistoryColors.length).toBeGreaterThan(0);
            expect(new Set(personalHistoryColors)).toEqual(new Set(['rgb(173, 181, 189)']));
            expect(await personal.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
            expect(await personal.evaluate(() => performance.timeOrigin)).toBe(personalTime);
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
            expect(await page.evaluate(() => performance.timeOrigin)).toBe(documentTime);
            expect(errors).toEqual([]);
        } finally {
            await participant.close();
            await other.close();
        }
    });
}

test('protects a committed organizer expense after response loss until deliberate history inspection without resubmission', async ({page, context}) => {
    test.setTimeout(90_000);
    const event = await createFrontendEventFixture(page.request);
    const created = await page.request.post(`/api/event/${event.id}/invoice-pools`, {data: {
        name: 'P8 unknown organizer result', distribution: 'EQUAL', assignAll: true, sendCalculationEmails: false,
    }});
    expect(created.status()).toBe(200);
    const poolId = (await created.json()).data.id as string;
    const pool = await openPool(page, event.id, poolId, true);
    await pool.getByRole('button', {name: 'Add invoice / amount', exact: true}).click();
    const expense = page.getByRole('dialog');
    await expense.locator('[name="amount"]').fill('18');
    await expense.locator('[name="description"]').fill('P8 committed response lost');
    await expense.locator('[name="proof"]').setInputFiles(proof());
    const endpoint = `/api/v1/events/${event.id}/finance/pools/${poolId}/invoices/organizer`;
    let requests = 0;
    page.on('request', request => {if (request.method() === 'POST' && request.url().endsWith(endpoint)) requests++;});
    const interception = await context.newCDPSession(page);
    let pausedId: string | undefined;
    try {
        const paused = new Promise<{requestId: string; responseStatusCode?: number}>(resolve => interception.once('Fetch.requestPaused', resolve));
        await interception.send('Fetch.enable', {patterns: [{urlPattern: new URL(endpoint, page.url()).href, requestStage: 'Response'}]});
        const submit = expense.getByRole('button', {name: 'Add invoice / amount', exact: true});
        await submit.click();
        const committed = await paused;
        pausedId = committed.requestId;
        expect(committed.responseStatusCode).toBe(200);
        await expect(submit).toBeDisabled();
        expect((await readFinance(page.request, event.id)).invoices.filter(invoice => invoice.description === 'P8 committed response lost')).toHaveLength(1);
        await interception.send('Fetch.failRequest', {requestId: committed.requestId, errorReason: 'Failed'});
        pausedId = undefined;
        await expect(expense).toContainText(/could not confirm|unconfirmed/i);
        await expect(submit).toBeDisabled();
        await expense.locator('form').evaluate(form => form.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true})));
        expect(requests).toBe(1);
        await expense.getByRole('button', {name: 'Check invoice history', exact: true}).click();
        await expect(submit).toBeDisabled();
        await expect(expense.locator('[name="description"]')).toHaveValue('P8 committed response lost');
        await expense.getByRole('button', {name: 'I have checked the invoice history', exact: true}).click();
        await expect(submit).toBeEnabled();
        await expect(expense.locator('[name="amount"]')).toHaveValue('');
        await expect(expense.locator('[name="proof"]')).toHaveValue('');
        expect(requests).toBe(1);
        expect((await readFinance(page.request, event.id)).invoices.filter(invoice => invoice.description === 'P8 committed response lost')).toHaveLength(1);
    } finally {
        if (pausedId) await interception.send('Fetch.continueResponse', {requestId: pausedId}).catch(() => undefined);
        await interception.send('Fetch.disable').catch(() => undefined);
        await interception.detach().catch(() => undefined);
    }
});
