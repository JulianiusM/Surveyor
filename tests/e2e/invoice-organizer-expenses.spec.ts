import {expect, request as playwrightRequest, test} from '@playwright/test';
import {createE2EEvent, createE2ELogin} from '../factories/e2eCoreFactory';
import {createResourceViaForm, loginForE2E} from '../keywords/e2eCoreKeywords';

test('records organizer expenses without attendance and accepts consecutive participant uploads', async ({page, browser, baseURL}, testInfo) => {
    test.setTimeout(120_000);
    page.setDefaultTimeout(10_000);
    const participantContext = await browser.newContext({baseURL});
    const secondParticipant = await playwrightRequest.newContext({baseURL});
    const anonymous = await playwrightRequest.newContext({baseURL});
    try {
        await loginForE2E(page.request, createE2ELogin());
        const eventCase = createE2EEvent();
        Object.assign(eventCase.form, {
            title: 'Organizer costs without attendance',
            'defaultPerms[public][0]': 'ACCESS_REGISTRATION',
            'defaultPerms[public][1]': 'ACCESS_VIEW',
        });
        const event = await createResourceViaForm(page.request, eventCase);
        for (const [context, name] of [[participantContext.request, 'First expense participant'], [secondParticipant, 'Second expense participant']] as const) {
            expect((await context.post(`${event.path}/guest`, {form: {username: name}, maxRedirects: 0})).status()).toBe(302);
            expect((await context.post(`/api/event/${event.id}/register`, {data: {
                arrivalDate: eventCase.form.startDate, departureDate: eventCase.form.endDate, dietary: ['MEAT'],
            }})).ok()).toBe(true);
        }
        const created = await page.request.post(`/api/event/${event.id}/invoice-pools`, {data: {
            name: 'Organizer expense pool', distribution: 'EQUAL', assignAll: true,
            subtractPersonalInvoices: true, sendCalculationEmails: false,
        }});
        expect(created.ok()).toBe(true);
        const poolId = (await created.json()).data.id;
        const endpoint = `/api/event/${event.id}/invoice-pools/${poolId}`;
        expect((await participantContext.request.post(`${endpoint}/invoices/organizer`, {data: {amount: 1, description: 'Unauthorized'}})).status()).toBe(403);
        expect((await anonymous.post(`${endpoint}/invoices/organizer`, {data: {amount: 1, description: 'Anonymous'}, maxRedirects: 0})).status()).toBe(401);
        const participants = (await (await page.request.get(`/api/event/${event.id}/participants`)).json()).data.participants;
        expect(participants).toHaveLength(2);
        expect(participants.map((person: {name: string}) => person.name)).not.toContain(createE2ELogin().username);

        await page.goto(`${event.path}/admin`);
        const pool = page.locator(`.invoice-pool[data-pool="${poolId}"]`);
        await pool.locator('.accordion-button').click();
        const expense = page.locator(`#pool-${poolId}-expense`);
        await pool.getByRole('button', {name: 'Add invoice / amount', exact: true}).click();
        await expense.getByLabel('Amount', {exact: true}).fill('100');
        await expense.getByLabel('Description', {exact: true}).fill('Hall rental paid by organizer');
        await Promise.all([page.waitForEvent('load'), expense.getByRole('button', {name: 'Add expense', exact: true}).click()]);
        const rental = pool.locator('[data-invoice-row]').filter({hasText: 'Hall rental paid by organizer'});
        await expect(rental).toContainText('Pool expense');
        await expect(rental).toContainText(`Recorded by ${createE2ELogin().username}`);
        await expect(rental).toContainText('Accepted');
        await expect(rental).toContainText('No proof attached');

        // An organizer can attach proof without joining the attendee or reimbursement lists.
        await pool.getByRole('button', {name: 'Add invoice / amount', exact: true}).click();
        await expense.getByLabel('Amount', {exact: true}).fill('20');
        await expense.getByLabel('Description', {exact: true}).fill('Shared equipment');
        await expense.getByLabel('Proof (optional)').setInputFiles({name: 'equipment.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\nEquipment\n%%EOF')});
        let expenseRequests = 0;
        await page.route(`**${endpoint}/invoices/organizer`, async route => {
            expenseRequests++;
            expect((await route.fetch()).ok()).toBe(true);
            await route.abort('failed'); // The cost is committed, but its response never reaches the browser.
        });
        await expense.getByRole('button', {name: 'Add expense', exact: true}).click();
        await expect(expense.getByRole('button', {name: 'Reload and check saved invoices'})).toBeVisible();
        await expect(expense.getByRole('button', {name: 'Add expense', exact: true})).toBeDisabled();
        await expense.locator('form').evaluate(form => form.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true})));
        expect(expenseRequests).toBe(1);
        await Promise.all([page.waitForEvent('load'), expense.getByRole('button', {name: 'Reload and check saved invoices'}).click()]);
        await page.unroute(`**${endpoint}/invoices/organizer`);
        const equipment = pool.locator('[data-invoice-row]').filter({hasText: 'Shared equipment'});
        await expect(equipment).toHaveCount(1);
        const proofUrl = (await equipment.getByRole('link', {name: 'View proof'}).getAttribute('href'))!;
        expect((await page.request.get(proofUrl)).ok()).toBe(true);
        expect((await participantContext.request.get(proofUrl)).status()).toBe(403);
        const previewResponse = await page.request.get(`${endpoint}/preview`);
        const preview = (await previewResponse.json()).data;
        expect(preview.shares).toHaveLength(2);
        expect(preview.shares.map((share: {shareAmount: number}) => Number(share.shareAmount))).toEqual([60, 60]);
        expect(preview.shares.every((share: {invoiceCreditAmount: number}) => Number(share.invoiceCreditAmount) === 0)).toBe(true);

        const participantPage = await participantContext.newPage();
        await participantPage.goto(event.path);
        await participantPage.getByRole('button', {name: 'Invoice pools & payments'}).click();
        await participantPage.getByRole('button', {name: 'Submit an invoice & history'}).click();
        const submission = participantPage.locator('#invoiceSubmitForm');
        for (const [amount, description] of [['10', 'First successive receipt'], ['15', 'Second successive receipt']]) {
            await submission.getByLabel('Amount', {exact: true}).fill(amount);
            await submission.getByLabel('Description', {exact: true}).fill(description);
            await submission.getByLabel('Proof (image or PDF)').setInputFiles({name: `${amount}.pdf`, mimeType: 'application/pdf', buffer: Buffer.from(`%PDF-1.4\n${description}\n%%EOF`)});
            await Promise.all([participantPage.waitForEvent('load'), submission.getByRole('button', {name: 'Submit invoice', exact: true}).click()]);
            await expect(participantPage).toHaveURL(/#invoiceHistory$/);
            await expect(submission).toBeVisible();
            await expect(participantPage.locator('#invoiceHistory')).toBeVisible();
            await expect(participantPage.locator('#invoiceHistory')).toContainText(description);
            await expect(submission.getByLabel('Amount', {exact: true})).toHaveValue('');
            await expect(submission.getByLabel('Description', {exact: true})).toHaveValue('');
            await expect(submission.getByLabel('Proof (image or PDF)')).toHaveValue('');
            await expect(submission.getByLabel('Choose pool')).toHaveValue(poolId);
            await expect(submission.getByRole('button', {name: 'Submit invoice', exact: true})).toBeEnabled();
        }
        await expect(participantPage.locator('#invoiceHistory [data-invoice-row]')).toHaveCount(2);
        await expect(participantPage.locator('#invoiceHistory')).toContainText('First successive receipt');
        await expect(participantPage.locator('#invoiceHistory')).toContainText('Second successive receipt');

        // Participant submissions await review; organizer costs already count. Saved shares survive later costs.
        const freshPreview = (await (await page.request.get(`${endpoint}/preview`)).json()).data;
        expect((await page.request.post(`${endpoint}/close`, {data: {expectedRevision: freshPreview.revision, sendEmails: false}})).ok()).toBe(true);
        await page.reload();
        if (await pool.locator('.accordion-button').getAttribute('aria-expanded') !== 'true') {
            await pool.locator('.accordion-button').click();
        }
        const share = pool.locator('[data-share-row]').first();
        await expect(share.locator('[data-label="Calculated balance"] strong')).toHaveText('60.00');
        await share.locator('.share-paid').click();
        await expect(share.locator('.share-paid')).toBeChecked();
        await expect(share.locator('.share-paid')).toBeEnabled();
        await pool.getByRole('button', {name: 'Add invoice / amount', exact: true}).click();
        await expense.getByLabel('Amount', {exact: true}).fill('40');
        await expense.getByLabel('Description', {exact: true}).fill('Late shared expense');
        await Promise.all([page.waitForEvent('load'), expense.getByRole('button', {name: 'Add expense', exact: true}).click()]);
        await expect(pool).toContainText('Recalculation required');
        await expect(share.locator('.share-paid')).toBeChecked();
        await expect(share.locator('[data-label="Calculated balance"] strong')).toHaveText('60.00');
        const revised = (await (await page.request.get(`${endpoint}/preview`)).json()).data;
        expect(revised.shares.map((row: {shareAmount: number}) => Number(row.shareAmount)).sort((a: number, b: number) => a - b)).toEqual([20, 80]);
        await page.setViewportSize({width: 390, height: 844});
        const paid = share.locator('.share-paid');
        await paid.scrollIntoViewIfNeeded();
        const paidBefore = (await paid.boundingBox())!;
        await paid.click();
        await expect(paid).not.toBeChecked();
        await expect(paid).toBeEnabled();
        const paidAfter = (await paid.boundingBox())!;
        expect(Math.abs(paidBefore.x - paidAfter.x)).toBeLessThan(0.6);
        expect(Math.abs(paidBefore.y - paidAfter.y)).toBeLessThan(0.6);
        await share.getByText('View breakdown', {exact: true}).click();
        const breakdown = page.locator(`#pool-${poolId}-share-breakdown`);
        await expect(breakdown).toBeVisible();
        await expect(breakdown.locator('[data-share-details-content]')).toContainText('60.00');
        await Promise.all([
            breakdown.evaluate(element => new Promise<void>(resolve => element.addEventListener('hidden.bs.modal', () => resolve(), {once: true}))),
            breakdown.locator('.modal-header .btn-close').click(),
        ]);
        const paidAfterDetails = (await paid.boundingBox())!;
        expect(Math.abs(paidBefore.x - paidAfterDetails.x)).toBeLessThan(0.6);
        expect(Math.abs(paidBefore.y - paidAfterDetails.y)).toBeLessThan(0.6);
        await pool.getByRole('button', {name: 'Add invoice / amount', exact: true}).click();
        await expect(expense).toBeVisible();
        expect(await expense.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
        await page.screenshot({path: testInfo.outputPath('organizer-expense-mobile.png'), animations: 'disabled'});
    } finally {
        await participantContext.close();
        await secondParticipant.dispose();
        await anonymous.dispose();
    }
});
