import {expect, request as playwrightRequest, test, type Request} from '@playwright/test';
import {createE2EEvent, createE2ELogin} from '../factories/e2eCoreFactory';
import {confirmInvoiceCommand, createResourceViaForm, loginForE2E} from '../keywords/e2eCoreKeywords';

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
        await expect(share.locator('[data-share-balance]')).toHaveText('60.00');
        await confirmInvoiceCommand(page, share.locator('.share-settlement'));
        await expect(share.locator('.share-settlement')).toHaveAttribute('data-paid', 'true');
        await expect(share.locator('.share-settlement')).toBeEnabled();
        await pool.getByRole('button', {name: 'Add invoice / amount', exact: true}).click();
        await expense.getByLabel('Amount', {exact: true}).fill('40');
        await expense.getByLabel('Description', {exact: true}).fill('Late shared expense');
        await Promise.all([page.waitForEvent('load'), expense.getByRole('button', {name: 'Add expense', exact: true}).click()]);
        await expect(pool).toContainText('Recalculation required');
        await expect(share.locator('.share-settlement')).toHaveAttribute('data-paid', 'true');
        await expect(share.locator('[data-share-balance]')).toHaveText('60.00');
        const revised = (await (await page.request.get(`${endpoint}/preview`)).json()).data;
        expect(revised.shares.map((row: {shareAmount: number}) => Number(row.shareAmount)).sort((a: number, b: number) => a - b)).toEqual([20, 80]);
        await page.setViewportSize({width: 390, height: 844});
        const paid = share.locator('.share-settlement');
        await paid.scrollIntoViewIfNeeded();
        const paidBefore = (await paid.boundingBox())!;
        await confirmInvoiceCommand(page, paid);
        await expect(paid).toHaveAttribute('data-paid', 'false');
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

test('changes participant invoice access, keeps organizer entry available, and calculates from organizer-only state', async ({page, baseURL}, testInfo) => {
    test.setTimeout(90_000);
    const participant = await playwrightRequest.newContext({baseURL});
    try {
        await loginForE2E(page.request, createE2ELogin());
        const eventCase = createE2EEvent();
        Object.assign(eventCase.form, {'defaultPerms[public][0]': 'ACCESS_REGISTRATION', 'defaultPerms[public][1]': 'ACCESS_VIEW'});
        const event = await createResourceViaForm(page.request, eventCase);
        expect((await participant.post(`${event.path}/guest`, {form: {username: 'Organizer-only participant'}, maxRedirects: 0})).status()).toBe(302);
        expect((await participant.post(`/api/event/${event.id}/register`, {data: {
            arrivalDate: eventCase.form.startDate, departureDate: eventCase.form.endDate, dietary: ['MEAT'],
        }})).ok()).toBe(true);
        const created = await page.request.post(`/api/event/${event.id}/invoice-pools`, {data: {
            name: 'Organizer-only costs', distribution: 'EQUAL', assignAll: true, sendCalculationEmails: false,
        }});
        expect(created.ok()).toBe(true);
        const poolId = (await created.json()).data.id;
        const endpoint = `/api/event/${event.id}/invoice-pools/${poolId}`;
        expect((await page.request.post(`${endpoint}/invoices/organizer`, {data: {amount: 100, description: 'Initial organizer cost'}})).ok()).toBe(true);
        const initialPreview = (await (await page.request.get(`${endpoint}/preview`)).json()).data;
        expect((await participant.post(`${endpoint}/submission-state`, {data: {status: 'ORGANIZER_ONLY', expectedRevision: initialPreview.revision}})).status()).toBe(403);

        await page.goto(`${event.path}/admin`);
        const pool = page.locator(`.invoice-pool[data-pool="${poolId}"]`);
        await pool.locator('.accordion-button').first().click();
        const closeSubmissions = pool.getByRole('button', {name: 'Close participant invoices', exact: true});
        const confirmation = page.locator('#invoiceCommandConfirmModal');
        await expect(confirmation).toHaveAttribute('data-initialized', 'true');
        let stateRequests = 0;
        /** Observe only mutation requests so cancelling a review can prove no state write occurred. */
        function trackSubmissionState(request: Request): void {
            if (request.method() === 'POST' && request.url().endsWith(`${endpoint}/submission-state`)) stateRequests++;
        }
        page.on('request', trackSubmissionState);
        // Touch-size layout uses the existing review dialog. Cancellation preserves OPEN and sends no mutation.
        await page.setViewportSize({width: 390, height: 844});
        await closeSubmissions.click();
        await expect(confirmation).toBeVisible();
        await confirmation.getByRole('button', {name: 'Cancel', exact: true}).click();
        await expect(confirmation).toBeHidden();
        expect(stateRequests).toBe(0);
        await expect(pool).toHaveAttribute('data-pool-status', 'OPEN');
        await Promise.all([page.waitForEvent('load'), confirmInvoiceCommand(page, closeSubmissions)]);
        expect(stateRequests).toBe(1);
        await expect(pool).toHaveAttribute('data-pool-status', 'ORGANIZER_ONLY');
        await expect(pool).toContainText('Organizer invoices only');
        await expect(pool.getByRole('button', {name: 'Open participant invoices', exact: true})).toBeVisible();
        await expect(pool.getByRole('button', {name: 'Preview calculation', exact: true})).toBeVisible();
        expect((await participant.post(`${endpoint}/submit`, {multipart: {
            amount: '10', proof: {name: 'blocked.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\nBlocked\n%%EOF')},
        }})).status()).toBe(400);
        expect((await participant.post(`${endpoint}/takeovers`, {data: {beneficiaries: []}})).status()).toBe(409);
        const expense = page.locator(`#pool-${poolId}-expense`);
        await pool.getByRole('button', {name: 'Add invoice / amount', exact: true}).click();
        await expense.getByLabel('Amount', {exact: true}).fill('20');
        await expense.getByLabel('Description', {exact: true}).fill('Organizer-only expense');
        await Promise.all([page.waitForEvent('load'), expense.getByRole('button', {name: 'Add expense', exact: true}).click()]);
        await expect(pool).toHaveAttribute('data-pool-status', 'ORGANIZER_ONLY');
        await expect(pool).toContainText('Organizer-only expense');
        await Promise.all([page.waitForEvent('load'), confirmInvoiceCommand(page, pool.getByRole('button', {name: 'Open participant invoices', exact: true}))]);
        await expect(pool).toHaveAttribute('data-pool-status', 'OPEN');
        expect((await participant.post(`${endpoint}/submit`, {multipart: {
            amount: '10', description: 'Reopened receipt', proof: {name: 'reopened.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\nReopened\n%%EOF')},
        }})).ok()).toBe(true);
        // Closing submission access again retains all costs; only the existing reviewed calculation creates shares.
        await page.reload();
        if (await pool.locator('.accordion-button').first().getAttribute('aria-expanded') !== 'true') await pool.locator('.accordion-button').first().click();
        await Promise.all([page.waitForEvent('load'), confirmInvoiceCommand(page, pool.getByRole('button', {name: 'Close participant invoices', exact: true}))]);
        await pool.getByRole('button', {name: 'Preview calculation', exact: true}).click();
        const calculation = page.locator(`#pool-${poolId}-calculation`);
        const closePool = calculation.getByRole('button', {name: 'Close pool & calculate', exact: true});
        await expect(closePool).toBeEnabled();
        await expect(calculation).toContainText('120.00');
        await expect(calculation.getByRole('button', {name: 'Apply recalculation', exact: true})).toHaveCount(0);
        await page.screenshot({path: testInfo.outputPath('organizer-only-calculation-mobile.png'), animations: 'disabled'});
        await Promise.all([page.waitForEvent('load'), closePool.click()]);
        await expect(pool).toHaveAttribute('data-pool-status', 'CLOSED');
        await expect(pool.locator('[data-share-balance]')).toHaveText('120.00');
        await expect(pool.getByRole('button', {name: 'Open participant invoices', exact: true})).toHaveCount(0);
        const finalPreview = (await (await page.request.get(`${endpoint}/preview`)).json()).data;
        expect((await page.request.post(`${endpoint}/submission-state`, {data: {status: 'OPEN', expectedRevision: finalPreview.revision}})).status()).toBe(409);
        page.off('request', trackSubmissionState);
    } finally {
        await participant.dispose();
    }
});

test('creates an organizer-only pool in the UI and closes it directly after adding an expense', async ({page, baseURL}, testInfo) => {
    test.setTimeout(60_000);
    const participant = await playwrightRequest.newContext({baseURL});
    try {
        // One registered participant receives the eventual allocation; the organizer records costs without attendance.
        await loginForE2E(page.request, createE2ELogin());
        const eventCase = createE2EEvent();
        Object.assign(eventCase.form, {
            title: 'Direct organizer-only creation',
            'defaultPerms[public][0]': 'ACCESS_REGISTRATION',
            'defaultPerms[public][1]': 'ACCESS_VIEW',
        });
        const event = await createResourceViaForm(page.request, eventCase);
        expect((await participant.post(`${event.path}/guest`, {form: {
            username: 'Direct organizer-only participant',
        }, maxRedirects: 0})).status()).toBe(302);
        expect((await participant.post(`/api/event/${event.id}/register`, {data: {
            arrivalDate: eventCase.form.startDate, departureDate: eventCase.form.endDate, dietary: ['MEAT'],
        }})).ok()).toBe(true);

        // Creation selects submission access independently of financial closure; OPEN remains the existing default.
        await page.setViewportSize({width: 390, height: 844});
        await page.goto(`${event.path}/admin`);
        await page.getByRole('button', {name: 'Create pool', exact: true}).click();
        const creation = page.locator('#poolCreateModal');
        await creation.getByLabel('Pool name').fill('Direct organizer-only pool');
        await creation.getByLabel('Share distribution mode').selectOption('EQUAL');
        await expect(creation.getByLabel('Invoice submissions')).toHaveValue('OPEN');
        await creation.getByLabel('Invoice submissions').selectOption({label: 'Organizer invoices only'});
        // Preserve the actual phone layout for visual review after the new initial-state field has been filled.
        const creationContent = creation.locator('.modal-content');
        expect(await creationContent.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
        await creation.getByLabel('Invoice submissions').scrollIntoViewIfNeeded();
        await page.screenshot({path: testInfo.outputPath('organizer-only-creation-mobile.png'), animations: 'disabled'});
        await Promise.all([page.waitForEvent('load'), creation.getByRole('button', {name: 'Add pool', exact: true}).click()]);
        const pool = page.locator('.invoice-pool[data-pool-name="Direct organizer-only pool"]');
        await expect(pool).toHaveAttribute('data-pool-status', 'ORGANIZER_ONLY');
        // Reload verifies persisted creation state before any action can open participant submissions.
        await page.reload();
        await expect(pool).toHaveAttribute('data-pool-status', 'ORGANIZER_ONLY');
        const poolId = (await pool.getAttribute('data-pool'))!;
        const endpoint = `/api/event/${event.id}/invoice-pools/${poolId}`;
        expect((await participant.post(`${endpoint}/submit`, {multipart: {
            amount: '10', proof: {name: 'blocked.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\nBlocked\n%%EOF')},
        }})).status()).toBe(400);

        // Organizer entry remains usable immediately, and records an accepted cost in the same selected state.
        await pool.locator('.accordion-button').first().click();
        await pool.getByRole('button', {name: 'Add invoice / amount', exact: true}).click();
        const expense = page.locator(`#pool-${poolId}-expense`);
        await expense.getByLabel('Amount', {exact: true}).fill('75');
        await expense.getByLabel('Description', {exact: true}).fill('Direct organizer-only expense');
        await Promise.all([page.waitForEvent('load'), expense.getByRole('button', {name: 'Add expense', exact: true}).click()]);
        await expect(pool).toHaveAttribute('data-pool-status', 'ORGANIZER_ONLY');
        await expect(pool.locator('[data-invoice-row]')).toContainText('Direct organizer-only expense');
        await expect(pool.locator('[data-share-row]')).toHaveCount(0);

        // The ordinary first calculation closes directly; no separate submission-access transition is required.
        await pool.getByRole('button', {name: 'Preview calculation', exact: true}).click();
        const calculation = page.locator(`#pool-${poolId}-calculation`);
        const closePool = calculation.getByRole('button', {name: 'Close pool & calculate', exact: true});
        await expect(closePool).toBeEnabled();
        await expect(calculation.locator('[data-pool-preview-rows] tr')).toHaveCount(1);
        await expect(calculation).toContainText('75.00');
        await expect(calculation.getByRole('button', {name: 'Apply recalculation', exact: true})).toHaveCount(0);
        await calculation.locator('input[name="sendEmails"]').uncheck();
        await Promise.all([page.waitForEvent('load'), closePool.click()]);
        await expect(pool).toHaveAttribute('data-pool-status', 'CLOSED');
        await expect(pool.locator('[data-share-balance]')).toHaveText('75.00');
        await expect(pool.getByRole('button', {name: 'Open participant invoices', exact: true})).toHaveCount(0);
    } finally {
        await participant.dispose();
    }
});

test('attributes organizer entry to the participant who paid with own history, optional proof and invoice credit', async ({page, browser, baseURL}, testInfo) => {
    test.setTimeout(120_000);
    page.setDefaultTimeout(10_000);
    const participantContext = await browser.newContext({baseURL});
    const otherParticipant = await playwrightRequest.newContext({baseURL});
    try {
        await loginForE2E(page.request, createE2ELogin());
        const eventCase = createE2EEvent();
        Object.assign(eventCase.form, {title: 'Organizer entry paid by participant',
            'defaultPerms[public][0]': 'ACCESS_REGISTRATION', 'defaultPerms[public][1]': 'ACCESS_VIEW'});
        const event = await createResourceViaForm(page.request, eventCase);
        for (const [context, name] of [[participantContext.request, 'Paid-by participant'], [otherParticipant, 'Other paid-by participant']] as const) {
            expect((await context.post(`${event.path}/guest`, {form: {username: name}, maxRedirects: 0})).status()).toBe(302);
            expect((await context.post(`/api/event/${event.id}/register`, {data: {
                arrivalDate: eventCase.form.startDate, departureDate: eventCase.form.endDate, dietary: ['MEAT'],
            }})).ok()).toBe(true);
        }
        const participants = (await (await page.request.get(`/api/event/${event.id}/participants`)).json()).data.participants;
        const paidById = participants.find((person: {name: string}) => person.name === 'Paid-by participant').id;
        const created = await page.request.post(`/api/event/${event.id}/invoice-pools`, {data: {
            name: 'Paid-by attribution pool', status: 'ORGANIZER_ONLY', distribution: 'EQUAL', assignAll: true,
            subtractPersonalInvoices: true, sendCalculationEmails: false,
        }});
        expect(created.ok()).toBe(true);
        const poolId = (await created.json()).data.id;
        const endpoint = `/api/event/${event.id}/invoice-pools/${poolId}`;

        // The actual form captures paid-by independently from its nonattending recorder and optional proof.
        await page.setViewportSize({width: 390, height: 844});
        await page.goto(`${event.path}/admin`);
        const pool = page.locator(`.invoice-pool[data-pool="${poolId}"]`);
        await pool.locator('.accordion-button').first().click();
        await pool.getByRole('button', {name: 'Add invoice / amount', exact: true}).click();
        const expense = page.locator(`#pool-${poolId}-expense`);
        const paidBy = expense.getByLabel('Paid by participant (optional)');
        await expect(paidBy).toHaveValue('');
        await paidBy.selectOption(String(paidById));
        await expense.getByLabel('Amount', {exact: true}).fill('100');
        await expense.getByLabel('Description', {exact: true}).fill('Attributed invoice without receipt');
        await expect(expense.getByLabel('Proof (optional)')).toHaveValue('');
        expect(await expense.locator('.modal-content').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
        await page.screenshot({path: testInfo.outputPath('organizer-paid-by-mobile.png'), animations: 'disabled'});
        await Promise.all([page.waitForEvent('load'), expense.getByRole('button', {name: 'Add expense', exact: true}).click()]);
        const invoice = pool.locator('[data-invoice-row]').filter({hasText: 'Attributed invoice without receipt'});
        await expect(invoice).toContainText('Paid-by participant');
        await expect(invoice).toContainText(`Recorded by ${createE2ELogin().username}`);
        await expect(invoice).toContainText('No proof attached');
        await expect(invoice).not.toContainText('Proof expired');
        await expect(pool).toHaveAttribute('data-pool-status', 'ORGANIZER_ONLY');

        // A second entry can attach a receipt while retaining the same paid-by ownership.
        await pool.getByRole('button', {name: 'Add invoice / amount', exact: true}).click();
        await paidBy.selectOption(String(paidById));
        await expense.getByLabel('Amount', {exact: true}).fill('25');
        await expense.getByLabel('Description', {exact: true}).fill('Attributed invoice with receipt');
        await expense.getByLabel('Proof (optional)').setInputFiles({name: 'participant-paid.pdf', mimeType: 'application/pdf',
            buffer: Buffer.from('%PDF-1.4\nParticipant paid\n%%EOF')});
        await Promise.all([page.waitForEvent('load'), expense.getByRole('button', {name: 'Add expense', exact: true}).click()]);
        const receipt = pool.locator('[data-invoice-row]').filter({hasText: 'Attributed invoice with receipt'});
        const proofUrl = (await receipt.getByRole('link', {name: 'View proof'}).getAttribute('href'))!;
        expect((await participantContext.request.get(proofUrl)).ok()).toBe(true);
        expect((await otherParticipant.get(proofUrl)).status()).toBe(403);

        // Own history remains available while participant submissions are disabled; attribution never broadens other ownership.
        const participantPage = await participantContext.newPage();
        await participantPage.goto(event.path);
        await participantPage.getByRole('button', {name: 'Invoice pools & payments'}).click();
        await participantPage.getByRole('button', {name: 'Submit an invoice & history'}).click();
        const history = participantPage.locator('#invoiceHistory');
        await expect(history).toContainText('Attributed invoice without receipt');
        await expect(history).toContainText('Attributed invoice with receipt');
        await expect(history).toContainText(`Recorded by ${createE2ELogin().username}`);
        await expect(history.locator('[data-invoice-row]')).toHaveCount(2);
        await expect(participantPage.locator('#invoiceSubmitForm')).toHaveCount(0);
        expect(await (await otherParticipant.get(event.path)).text()).not.toContain('Attributed invoice without receipt');

        // Existing arithmetic: invoice costs125 divided between two participants; paid invoices125 credit their actual payer.
        const preview = (await (await page.request.get(`${endpoint}/preview`)).json()).data;
        expect(preview.shares.find((share: {registrationId: number}) => share.registrationId === paidById))
            .toMatchObject({baseShareAmount: 62.5, invoiceCreditAmount: 125, paymentCreditAmount: 0, shareAmount: -62.5});
        expect(preview.shares.map((share: {shareAmount: number}) => Number(share.shareAmount)).sort((first: number, second: number) => first - second))
            .toEqual([-62.5, 62.5]);
        expect((await page.request.post(`${endpoint}/close`, {data: {expectedRevision: preview.revision, sendEmails: false}})).ok()).toBe(true);
        await participantPage.reload();
        await expect(participantPage.locator('[data-personal-share-ledger] [data-share-balance]')).toHaveText('-62.50');
    } finally {
        await participantContext.close();
        await otherParticipant.dispose();
    }
});
