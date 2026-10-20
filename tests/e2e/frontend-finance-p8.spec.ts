import {expect, test, type APIRequestContext, type Locator, type Page, type Request} from '@playwright/test';
import type {components} from '../../src/types/api/v1';
import {createFrontendEventFixture, frontendEventHeaders} from '../keywords/frontendEventE2EKeywords';
import {waitForPilotHydration} from '../keywords/frontendDynamicKeywords';
import {dismissFrontendSuccessNotifications, expectUsableFrontendLayout, readNamedControlContracts as formContract,
    readSecondaryInstructionColors} from '../keywords/e2eCoreKeywords';
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
