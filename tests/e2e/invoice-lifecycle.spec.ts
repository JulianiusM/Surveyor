import {expect, request as playwrightRequest, test, type Locator, type Page} from '@playwright/test';
import {createE2EEvent, createE2ELogin} from '../factories/e2eCoreFactory';
import {createResourceViaForm, loginForE2E} from '../keywords/e2eCoreKeywords';

async function closeModal(modal: Locator) {
    await Promise.all([
        modal.evaluate(element => new Promise<void>(resolve => element.addEventListener('hidden.bs.modal', () => resolve(), {once: true}))),
        modal.locator('.modal-header .btn-close').click(),
    ]);
}

async function openInvoices(pool: Locator) {
    if (await pool.locator('.accordion-button').getAttribute('aria-expanded') !== 'true') await pool.locator('.accordion-button').click();
    const invoices = pool.locator('details').filter({has: pool.page().locator('summary').filter({hasText: /^Invoices \(/})});
    if (await invoices.getAttribute('open') === null) await invoices.locator(':scope > summary').click();
}

async function confirmAndReload(page: Page, label: string) {
    const confirm = page.locator('#invoiceConfirmModal');
    await expect(confirm).toBeVisible();
    await Promise.all([page.waitForEvent('load'), confirm.getByRole('button', {name: label, exact: true}).click()]);
}

test('confirms retroactive invoice changes and retains participant retractions without losing paid credit', async ({page, browser, baseURL}, testInfo) => {
    test.setTimeout(120_000);
    page.setDefaultTimeout(10_000);
    const participant = await browser.newContext({baseURL, viewport: {width: 390, height: 844}});
    const other = await playwrightRequest.newContext({baseURL});
    try {
        await loginForE2E(page.request, createE2ELogin());
        const eventCase = createE2EEvent();
        Object.assign(eventCase.form, {
            title: 'Confirmed invoice revisions',
            'defaultPerms[public][0]': 'ACCESS_REGISTRATION',
            'defaultPerms[public][1]': 'ACCESS_VIEW',
        });
        const event = await createResourceViaForm(page.request, eventCase);
        for (const [context, name] of [[participant.request, 'Invoice owner'], [other, 'Other participant']] as const) {
            expect((await context.post(`${event.path}/guest`, {form: {username: name}, maxRedirects: 0})).status()).toBe(302);
            expect((await context.post(`/api/event/${event.id}/register`, {data: {
                arrivalDate: eventCase.form.startDate, departureDate: eventCase.form.endDate, dietary: ['MEAT'],
            }})).ok()).toBe(true);
        }
        const created = await page.request.post(`/api/event/${event.id}/invoice-pools`, {data: {
            name: 'Invoice revisions', distribution: 'EQUAL', assignAll: true,
            subtractPersonalInvoices: true, sendCalculationEmails: false,
        }});
        const poolId = (await created.json()).data.id;
        const endpoint = `/api/event/${event.id}/invoice-pools/${poolId}`;
        const expense = await page.request.post(`${endpoint}/invoices/organizer`, {data: {amount: 100, description: 'Venue reservation'}});
        const expenseId = (await expense.json()).data.id;
        for (const [amount, description] of [['20', 'Personal train ticket'], ['7', 'Duplicate pending ticket']]) {
            expect((await participant.request.post(`${endpoint}/submit`, {multipart: {
                amount, description, proof: {name: `${amount}.pdf`, mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\nReceipt\n%%EOF')},
            }})).ok()).toBe(true);
        }
        await page.goto(`${event.path}/admin`);
        const pool = page.locator(`.invoice-pool[data-pool="${poolId}"]`);
        await openInvoices(pool);
        const personalRow = pool.locator('[data-invoice-row]').filter({hasText: 'Personal train ticket'});
        const personalId = Number(await personalRow.locator('.invoice-approve').getAttribute('data-id'));
        expect((await page.request.post(`${endpoint}/invoices/${personalId}/approve`)).ok()).toBe(true);
        // Closing an invoice still permits an organizer to correct or exclude that accepted cost later.
        expect((await participant.request.post(`${endpoint}/invoices/${personalId}/close-self`)).ok()).toBe(true);

        const participantPage = await participant.newPage();
        await participantPage.goto(`${event.path}#invoiceHistory`);
        const history = participantPage.locator('#invoiceHistory');
        const pending = history.locator('[data-invoice-row]').filter({hasText: 'Duplicate pending ticket'});
        const pendingId = Number(await pending.locator('.invoice-retract-open').getAttribute('data-id'));
        const initialPreview = (await (await page.request.get(`${endpoint}/preview`)).json()).data;
        expect((await other.post(`${endpoint}/invoices/${pendingId}/retract`, {data: {confirmed: true, expectedRevision: initialPreview.revision}})).status()).toBe(403);
        expect((await participant.request.post(`${endpoint}/invoices/${pendingId}/retract`, {data: {expectedRevision: initialPreview.revision}})).status()).toBe(400);
        await pending.getByRole('button', {name: 'Retract', exact: true}).click();
        const retract = participantPage.locator('#invoiceRetractModal');
        await expect(retract).toBeVisible();
        await closeModal(retract);
        await expect(pending).toContainText('Awaiting review');
        await pending.getByRole('button', {name: 'Retract', exact: true}).click();
        await Promise.all([participantPage.waitForEvent('load'), retract.getByRole('button', {name: 'Confirm retraction', exact: true}).click()]);
        await expect(participantPage).toHaveURL(/#invoiceHistory$/);
        await expect(history).toBeVisible();
        await expect(pending).toContainText('Retracted');
        await expect(pending.getByRole('button', {name: 'Retract', exact: true})).toHaveCount(0);
        const retainedProof = (await pending.getByRole('link', {name: 'View proof'}).getAttribute('href'))!;
        expect((await participant.request.get(retainedProof)).ok()).toBe(true);
        await history.getByLabel('Filter invoice status').selectOption('RETRACTED');
        await expect(history.locator('[data-invoice-row]:visible')).toHaveCount(1);
        await participantPage.screenshot({path: testInfo.outputPath('retracted-invoice-mobile.png'), animations: 'disabled'});

        const preview = (await (await page.request.get(`${endpoint}/preview`)).json()).data;
        expect((await page.request.post(`${endpoint}/close`, {data: {expectedRevision: preview.revision, sendEmails: false}})).ok()).toBe(true);
        await page.reload();
        await openInvoices(pool);
        const payer = pool.locator('[data-share-row]').filter({has: page.getByText('Invoice owner', {exact: true})});
        const paid = payer.locator('.share-paid');
        await expect(payer.locator('[data-label="Calculated balance"] strong')).toHaveText('40.00');
        expect((await page.request.post(`${endpoint}/shares/${await paid.getAttribute('data-id')}/pay`, {data: {isPaid: true}})).ok()).toBe(true);
        await page.reload();
        await openInvoices(pool);
        const venue = pool.locator('[data-invoice-row]').filter({hasText: 'Venue reservation'});
        const current = (await (await page.request.get(`${endpoint}/preview`)).json()).data;
        expect((await participant.request.post(`${endpoint}/invoices/${expenseId}/revise`, {data: {
            confirmed: true, expectedRevision: current.revision, correctedAmount: 140, correctedDescription: null,
        }})).status()).toBe(403);
        expect((await page.request.post(`${endpoint}/invoices/${expenseId}/revise`, {data: {
            expectedRevision: current.revision, correctedAmount: 140, correctedDescription: null,
        }})).status()).toBe(400);

        await venue.getByRole('button', {name: 'Correct', exact: true}).click();
        const edit = page.locator('#invoiceEditModal');
        await edit.getByLabel('Amount', {exact: true}).fill('140');
        await edit.getByLabel('Description', {exact: true}).fill('Corrected venue reservation');
        await edit.getByRole('button', {name: 'Continue', exact: true}).click();
        const confirmation = page.locator('#invoiceConfirmModal');
        await expect(confirmation).toContainText('140.00');
        await expect(confirmation).toContainText('100.00');
        // Editing and backing out of the additional confirmation must not write any financial change.
        expect((await (await page.request.get(`${endpoint}/preview`)).json()).data.revision).toBe(current.revision);
        await confirmation.getByRole('button', {name: 'Back to edit', exact: true}).click();
        await expect(edit.getByLabel('Amount', {exact: true})).toHaveValue('140');
        await edit.getByRole('button', {name: 'Continue', exact: true}).click();
        const correctionRequest = page.waitForRequest(request => request.url().endsWith(`/invoices/${expenseId}/revise`));
        await confirmAndReload(page, 'Confirm correction');
        expect((await correctionRequest).postDataJSON()).toMatchObject({confirmed: true, expectedRevision: current.revision, correctedAmount: 140});
        await openInvoices(pool);
        await expect(venue).toContainText('Original: 100.00');
        await expect(pool).toContainText('Recalculation required');
        await expect(paid).toBeChecked();
        await expect(payer.locator('[data-label="Calculated balance"] strong')).toHaveText('40.00');
        const correctedPreview = (await (await page.request.get(`${endpoint}/preview`)).json()).data;
        expect(correctedPreview.shares.map((share: {shareAmount: number}) => Number(share.shareAmount)).sort((a: number, b: number) => a - b)).toEqual([20, 80]);

        await page.setViewportSize({width: 390, height: 844});
        await personalRow.getByRole('button', {name: 'Reject from pool', exact: true}).click();
        const rejection = page.locator('#invoiceRejectModal');
        await rejection.getByLabel('Rejection reason').fill('Travel was reimbursed separately');
        await rejection.getByRole('button', {name: 'Continue', exact: true}).click();
        await expect(confirmation).toBeVisible();
        expect(await confirmation.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
        await page.screenshot({path: testInfo.outputPath('invoice-rejection-confirm-mobile.png'), animations: 'disabled'});
        await confirmAndReload(page, 'Confirm rejection');
        await openInvoices(pool);
        await expect(personalRow).toContainText('Rejected');
        await expect(personalRow).toContainText('Travel was reimbursed separately');
        await expect(paid).toBeChecked();
        const rejectedPreview = (await (await page.request.get(`${endpoint}/preview`)).json()).data;
        expect(rejectedPreview.shares.map((share: {shareAmount: number}) => Number(share.shareAmount)).sort((a: number, b: number) => a - b)).toEqual([30, 70]);
        expect((await page.request.post(`${endpoint}/recalculate`, {data: {expectedRevision: rejectedPreview.revision, sendEmails: false}})).ok()).toBe(true);
        await page.reload();
        await openInvoices(pool);
        await expect(paid).not.toBeChecked();
        await expect(payer.locator('[data-label="Calculated balance"] strong')).toHaveText('30.00');
        const breakdown = payer.getByRole('button', {name: 'View breakdown for Invoice owner', exact: true});
        await breakdown.click();
        const details = page.locator(`#pool-${poolId}-share-breakdown`);
        await expect(details.locator('dd').nth(3)).toHaveText('40.00');
        await closeModal(details);
    } finally {
        await participant.close();
        await other.dispose();
    }
});
