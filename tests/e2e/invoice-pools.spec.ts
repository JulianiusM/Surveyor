import {expect, request as playwrightRequest, test, type Locator, type Page} from '@playwright/test';
import {createE2EEvent, createE2ELogin} from '../factories/e2eCoreFactory';
import {createResourceViaForm, loginForE2E} from '../keywords/e2eCoreKeywords';

async function reloadAfterAction(page: Page, action: () => Promise<void>): Promise<void> {
    await Promise.all([page.waitForEvent('load'), action()]);
}

async function openPool(pool: Locator): Promise<void> {
    const toggle = pool.locator('.accordion-button').first();
    if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
}

test('previews invoice settlements, carries payments forward, and restores saved pool inputs', async ({page, baseURL}, testInfo) => {
    test.setTimeout(120000);
    page.setDefaultTimeout(10000);
    const guest = await playwrightRequest.newContext({baseURL});
    try {
        await loginForE2E(page.request, createE2ELogin());
        const eventCase = createE2EEvent({
            title: 'Invoice pool browser workflow',
            form: {...createE2EEvent().form, title: 'Invoice pool browser workflow'},
        });
        Object.assign(eventCase.form, {
            'defaultPerms[public][0]': 'ACCESS_REGISTRATION',
            'defaultPerms[public][1]': 'ACCESS_VIEW',
        });
        const event = await createResourceViaForm(page.request, eventCase);
        const registration = {arrivalDate: eventCase.form.startDate, departureDate: eventCase.form.endDate, dietary: ['MEAT']};
        expect((await page.request.post(`/api/event/${event.id}/register`, {data: registration})).ok()).toBe(true);
        expect((await guest.post(`${event.path}/guest`, {form: {username: 'Invoice guest'}, maxRedirects: 0})).status()).toBe(302);
        expect((await guest.post(`/api/event/${event.id}/register`, {data: registration})).ok()).toBe(true);
        const participantsResponse = await page.request.get(`/api/event/${event.id}/participants`);
        const participants = (await participantsResponse.json()).data.participants as {id: number; name: string}[];
        const guestRegistration = participants.find(participant => participant.name === 'Invoice guest')!;
        const organizerRegistration = participants.find(participant => participant.id !== guestRegistration.id)!;
        expect(participants).toHaveLength(2);

        // Create with the rendered form so its allocation/credit checkboxes cross the real parsing boundary.
        await page.goto(`${event.path}/admin`);
        await page.getByRole('button', {name: 'Create pool', exact: true}).click();
        const createDialog = page.locator('#poolCreateModal');
        await createDialog.getByLabel('Pool name').fill('Shared travel');
        await createDialog.getByLabel('Share distribution mode').selectOption('EQUAL');
        await createDialog.getByLabel('Deduct submitter invoices from their share').uncheck();
        await reloadAfterAction(page, () => createDialog.getByRole('button', {name: 'Add pool', exact: true}).click());
        const pool = page.locator('.invoice-pool').first();
        const poolId = (await pool.getAttribute('data-pool'))!;
        const endpoint = `/api/event/${event.id}/invoice-pools/${poolId}`;

        // A participant can submit, but may not alter pool allocation or adjustments.
        expect((await guest.post(`${endpoint}/assignments`, {data: {assignAll: true, participantFactors: {[guestRegistration.id]: 0}}})).status()).toBe(403);
        expect((await guest.post(`${endpoint}/surcharges`, {data: {registrationId: guestRegistration.id, amount: -999, note: 'Unauthorized'}})).status()).toBe(403);
        expect((await guest.get(`${endpoint}/preview`)).status()).toBe(403);
        expect((await guest.post(`${endpoint}/rollback`)).status()).toBe(403);
        expect((await guest.post(`${endpoint}/notify`)).status()).toBe(403);

        await page.goto(event.path);
        await page.getByRole('button', {name: 'Invoice pools & payments'}).click();
        await page.getByRole('button', {name: 'Submit an invoice & history'}).click();
        const submission = page.locator('#invoiceSubmitForm');
        await submission.getByLabel('Amount', {exact: true}).fill('120');
        await submission.getByLabel('Description', {exact: true}).fill('Shared train tickets');
        await submission.getByLabel('Proof (image or PDF)').setInputFiles({
            name: 'train-tickets.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\nInvoice workflow proof\n%%EOF'),
        });
        let submissionCount = 0;
        let releaseResponse!: () => void;
        const responseReleased = new Promise<void>(resolve => { releaseResponse = resolve; });
        await page.route(`**${endpoint}/submit`, async route => {
            submissionCount += 1;
            const response = await route.fetch();
            await responseReleased;
            await route.fulfill({response});
        });
        try {
            await submission.getByRole('button', {name: 'Submit invoice', exact: true}).click();
            await expect(submission.locator('[type="submit"]')).toBeDisabled();
            await expect(submission.getByLabel('Proof (image or PDF)')).toBeDisabled();
            await expect(submission.getByRole('status')).toContainText(/Uploading|Upload complete/);
            await submission.evaluate(form => form.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true})));
            await expect(submission.getByRole('status')).toContainText('taking longer than usual', {timeout: 15000});
            expect(submissionCount).toBe(1);
        } finally {
            releaseResponse();
        }
        await expect(submission.getByRole('status')).toContainText('Invoice submitted successfully');
        await reloadAfterAction(page, () => submission.getByRole('button', {name: 'View invoice history'}).click());
        await expect(page.locator('#invoiceHistory')).toBeVisible();
        await expect(page.locator('#invoiceHistory [data-invoice-row]')).toHaveCount(1);
        await expect(page.locator('#invoiceHistory')).toContainText('Awaiting review');
        await page.unroute(`**${endpoint}/submit`);

        await page.goto(`${event.path}/admin`);
        await openPool(pool);
        await reloadAfterAction(page, () => pool.getByRole('button', {name: 'Accept', exact: true}).click());
        await openPool(pool);
        await pool.getByRole('button', {name: 'Preview calculation', exact: true}).click();
        const calculation = page.locator(`#pool-${poolId}-calculation`);
        await expect(calculation.locator('[data-pool-preview-rows] tr')).toHaveCount(2);
        await calculation.getByLabel('Email participants after this calculation').uncheck();
        await reloadAfterAction(page, () => calculation.getByRole('button', {name: 'Close pool & calculate', exact: true}).click());
        await openPool(pool);
        const shares = pool.locator('.invoice-scroll tbody tr');
        await expect(shares).toHaveCount(2);
        const organizerShare = shares.filter({hasText: organizerRegistration.name});
        const guestShare = shares.filter({hasText: guestRegistration.name});
        const remaining = organizerShare.locator('td').nth(6).locator('strong');
        await expect(remaining).toHaveText('60.00');
        const paid = organizerShare.locator('.share-paid');
        const originalShareId = (await paid.getAttribute('data-id'))!;
        await paid.check();
        await expect(paid).toBeEnabled();

        await pool.getByRole('button', {name: 'Pool settings', exact: true}).click();
        const settings = page.locator(`#pool-${poolId}-settings`);
        await settings.getByLabel('Send calculation emails automatically').uncheck();
        await reloadAfterAction(page, () => settings.getByRole('button', {name: 'Save pool settings', exact: true}).click());

        // Saving is deliberately separate from recalculation; old values and payment records remain visible.
        await pool.getByRole('button', {name: 'Participants & factors', exact: true}).click();
        const factors = page.locator(`#pool-${poolId}-participants`);
        await factors.locator(`[data-participant-factor="${organizerRegistration.id}"]`).fill('1.5');
        await factors.locator(`[data-participant-factor="${guestRegistration.id}"]`).fill('0.5');
        await reloadAfterAction(page, () => factors.getByRole('button', {name: 'Save participants & factors', exact: true}).click());
        await expect(pool).toContainText('Recalculation required.');
        await expect(remaining).toHaveText('60.00');
        await expect(paid).toBeChecked();
        await expect(paid).toBeEnabled();
        await paid.uncheck();
        await expect(paid).toBeEnabled();
        await paid.check();
        await expect(paid).toBeEnabled();
        expect(await paid.getAttribute('data-id')).toBe(originalShareId);

        await pool.getByRole('button', {name: 'Surcharges & rebates', exact: true}).click();
        const adjustments = page.locator(`#pool-${poolId}-adjustments`);
        await adjustments.getByLabel('Participant', {exact: true}).selectOption(String(organizerRegistration.id));
        await adjustments.getByLabel('Amount (negative for a rebate)').fill('-20');
        await adjustments.getByLabel('Note', {exact: true}).fill('Organizer rebate');
        await reloadAfterAction(page, () => adjustments.getByRole('button', {name: 'Add surcharge or rebate'}).click());
        await pool.getByRole('button', {name: 'Surcharges & rebates', exact: true}).click();
        await expect(adjustments).toContainText('Rebate -20.00');
        await adjustments.getByLabel('Participant', {exact: true}).selectOption(String(guestRegistration.id));
        await adjustments.getByLabel('Amount (negative for a rebate)').fill('10');
        await adjustments.getByLabel('Note', {exact: true}).fill('Extra luggage');
        await adjustments.getByLabel('Redistribute within pool').uncheck();
        await reloadAfterAction(page, () => adjustments.getByRole('button', {name: 'Add surcharge or rebate'}).click());

        await page.setViewportSize({width: 1440, height: 1000});
        await pool.getByRole('button', {name: 'Recalculate pool', exact: true}).click();
        await expect(calculation.getByLabel('Email participants after this calculation')).not.toBeChecked();
        const organizerPreview = calculation.locator('[data-pool-preview-rows] tr').filter({hasText: organizerRegistration.name});
        await expect(organizerPreview.locator('[data-label="Previously settled"]')).toHaveText('60.00');
        await expect(organizerPreview.locator('[data-label="Remaining due / refund"]')).toContainText('25.00');
        await expect(remaining).toHaveText('60.00');
        await expect(paid).toBeChecked();
        await page.screenshot({path: testInfo.outputPath('invoice-preview-desktop.png'), animations: 'disabled'});
        const recalculationRequest = page.waitForRequest(request => request.url().endsWith(`${endpoint}/recalculate`) && request.method() === 'POST');
        await reloadAfterAction(page, () => calculation.getByRole('button', {name: 'Apply recalculation', exact: true}).click());
        expect((await recalculationRequest).postDataJSON()).toMatchObject({sendEmails: false, expectedRevision: expect.any(Number)});
        await expect(pool).not.toContainText('Recalculation required.');
        // Gross shares 85 : 45 become 25 : 45 remaining after the organizer's previously paid 60.
        await expect(organizerShare.locator('td').nth(2)).toHaveText('105.00');
        await expect(organizerShare.locator('td').nth(3)).toHaveText('-20.00');
        await expect(organizerShare.locator('td').nth(5)).toHaveText('60.00');
        await expect(remaining).toHaveText('25.00');
        await expect(guestShare.locator('td').nth(6).locator('strong')).toHaveText('45.00');
        await expect(paid).not.toBeChecked();
        await expect(paid).toBeEnabled();

        // Rollback restores pool-local edits while preserving a payment recorded since the last calculation.
        await paid.check();
        await expect(paid).toBeEnabled();
        const calculatedShareId = await paid.getAttribute('data-id');
        await pool.getByRole('button', {name: 'Participants & factors', exact: true}).click();
        await factors.locator(`[data-participant-factor="${organizerRegistration.id}"]`).fill('2');
        await reloadAfterAction(page, () => factors.getByRole('button', {name: 'Save participants & factors', exact: true}).click());
        await pool.getByRole('button', {name: 'Roll back pool changes', exact: true}).click();
        const rollback = page.locator(`#pool-${poolId}-rollback`);
        await rollback.getByRole('button', {name: 'Restore last calculated settings'}).click();
        await expect(rollback.getByRole('button', {name: 'Return to pool'})).toBeVisible();
        await reloadAfterAction(page, () => rollback.getByRole('button', {name: 'Return to pool'}).click());
        await expect(pool).not.toContainText('Recalculation required.');
        expect(await paid.getAttribute('data-id')).toBe(calculatedShareId);
        await expect(paid).toBeChecked();
        await expect(remaining).toHaveText('25.00');
        await expect(organizerShare.locator('td').nth(5)).toHaveText('60.00');

        await pool.getByRole('button', {name: 'Send settlement emails', exact: true}).click();
        const notification = page.locator(`#pool-${poolId}-notify`);
        await notification.getByRole('button', {name: 'Send settlement emails', exact: true}).click();
        await expect(notification.locator('.pool-form-status')).toContainText(/sent|requested/i);
        await Promise.all([
            notification.evaluate(element => new Promise<void>(resolve => element.addEventListener('hidden.bs.modal', () => resolve(), {once: true}))),
            notification.getByRole('button', {name: 'Cancel', exact: true}).click(),
        ]);
        expect(await paid.getAttribute('data-id')).toBe(calculatedShareId);
        await expect(paid).toBeChecked();

        // Capture real rendered layouts as review artifacts; the behavior assertions remain independent of pixels.
        await page.setViewportSize({width: 1440, height: 1000});
        await pool.screenshot({path: testInfo.outputPath('invoice-pool-desktop.png')});
        await page.setViewportSize({width: 390, height: 844});
        await Promise.all([
            factors.evaluate(element => new Promise<void>(resolve => element.addEventListener('shown.bs.modal', () => resolve(), {once: true}))),
            pool.getByRole('button', {name: 'Participants & factors', exact: true}).click(),
        ]);
        await expect(factors).toBeVisible();
        const dialogBounds = await factors.locator('.modal-dialog').boundingBox();
        expect(dialogBounds!.x).toBeGreaterThanOrEqual(0);
        expect(dialogBounds!.x + dialogBounds!.width).toBeLessThanOrEqual(390);
        await expect(factors.locator(`[data-participant-factor="${organizerRegistration.id}"]`)).toHaveValue('1.5');
        await page.screenshot({path: testInfo.outputPath('invoice-factors-mobile.png'), animations: 'disabled'});
        await Promise.all([
            factors.evaluate(element => new Promise<void>(resolve => element.addEventListener('hidden.bs.modal', () => resolve(), {once: true}))),
            factors.locator('.modal-header .btn-close').click(),
        ]);
        await Promise.all([
            adjustments.evaluate(element => new Promise<void>(resolve => element.addEventListener('shown.bs.modal', () => resolve(), {once: true}))),
            pool.getByRole('button', {name: 'Surcharges & rebates', exact: true}).click(),
        ]);
        await page.screenshot({path: testInfo.outputPath('invoice-adjustments-mobile.png'), animations: 'disabled'});
        await Promise.all([
            adjustments.evaluate(element => new Promise<void>(resolve => element.addEventListener('hidden.bs.modal', () => resolve(), {once: true}))),
            adjustments.locator('.modal-header .btn-close').click(),
        ]);
        await Promise.all([
            calculation.evaluate(element => new Promise<void>(resolve => element.addEventListener('shown.bs.modal', () => resolve(), {once: true}))),
            pool.getByRole('button', {name: 'Recalculate pool', exact: true}).click(),
        ]);
        await expect(calculation.locator('[data-pool-preview-rows] tr')).toHaveCount(2);
        await expect(calculation.getByRole('button', {name: 'Apply recalculation', exact: true})).toBeEnabled();
        await page.screenshot({path: testInfo.outputPath('invoice-preview-mobile.png'), animations: 'disabled'});
        await Promise.all([
            calculation.evaluate(element => new Promise<void>(resolve => element.addEventListener('hidden.bs.modal', () => resolve(), {once: true}))),
            calculation.locator('.modal-header .btn-close').click(),
        ]);

        // Takeover groups identify the payer and restore the saved selection when opened for editing.
        const takeovers = page.locator('#takeoverModal');
        await pool.getByRole('button', {name: 'Manage takeovers', exact: true}).click();
        await takeovers.getByLabel('Payer', {exact: true}).selectOption(String(organizerRegistration.id));
        const coveredGuest = takeovers.locator(`.takeover-beneficiaries input[value="${guestRegistration.id}"]`);
        await coveredGuest.check();
        await expect(takeovers.locator('[data-takeover-summary]')).toHaveText(`${organizerRegistration.name} covers ${guestRegistration.name}.`);
        await reloadAfterAction(page, () => takeovers.getByRole('button', {name: 'Save changes', exact: true}).click());
        const takeoverSummary = pool.locator('.pool-takeover-summary');
        await expect(takeoverSummary.locator('.pool-takeover-row')).toHaveCount(1);
        await expect(takeoverSummary.getByText('Payer', {exact: true})).toBeVisible();
        await expect(takeoverSummary.getByText('Covers', {exact: true})).toBeVisible();
        await expect(takeoverSummary.getByText(organizerRegistration.name, {exact: true})).toBeVisible();
        await expect(takeoverSummary.getByText(guestRegistration.name, {exact: true})).toBeVisible();
        await expect(paid).toBeChecked();
        await takeoverSummary.screenshot({path: testInfo.outputPath('invoice-takeover-group-mobile.png')});
        await Promise.all([
            takeovers.evaluate(element => new Promise<void>(resolve => element.addEventListener('shown.bs.modal', () => resolve(), {once: true}))),
            takeoverSummary.getByRole('button', {name: `Edit takeovers for ${organizerRegistration.name}`, exact: true}).click(),
        ]);
        await expect(takeovers.getByLabel('Payer', {exact: true})).toHaveValue(String(organizerRegistration.id));
        await expect(coveredGuest).toBeChecked();
        await page.screenshot({path: testInfo.outputPath('invoice-takeover-edit-mobile.png'), animations: 'disabled'});
    } finally {
        await guest.dispose();
    }
});

test('keeps a 28-participant takeover dialog usable and changes pool rounding through a saved preview', async ({page, baseURL}, testInfo) => {
    test.setTimeout(120000);
    page.setDefaultTimeout(10000);
    await loginForE2E(page.request, createE2ELogin());
    const eventCase = createE2EEvent({
        title: 'Large invoice takeover roster',
        form: {...createE2EEvent().form, title: 'Large invoice takeover roster'},
    });
    Object.assign(eventCase.form, {
        'defaultPerms[public][0]': 'ACCESS_REGISTRATION',
        'defaultPerms[public][1]': 'ACCESS_VIEW',
    });
    const event = await createResourceViaForm(page.request, eventCase);
    const registration = {arrivalDate: eventCase.form.startDate, departureDate: eventCase.form.endDate, dietary: ['MEAT']};
    expect((await page.request.post(`/api/event/${event.id}/register`, {data: registration})).ok()).toBe(true);
    for (let index = 1; index <= 27; index++) {
        const guest = await playwrightRequest.newContext({baseURL});
        try {
            expect((await guest.post(`${event.path}/guest`, {
                form: {username: `Participant ${String(index).padStart(2, '0')} with a longer display name`}, maxRedirects: 0,
            })).status()).toBe(302);
            expect((await guest.post(`/api/event/${event.id}/register`, {data: registration})).ok()).toBe(true);
        } finally {
            await guest.dispose();
        }
    }
    const participants = (await (await page.request.get(`/api/event/${event.id}/participants`)).json()).data.participants as {id: number; name: string}[];
    expect(participants).toHaveLength(28);
    const organizer = participants.find(person => !person.name.startsWith('Participant '))!;
    const first = participants.find(person => person.name.startsWith('Participant 01 '))!;
    const last = participants.find(person => person.name.startsWith('Participant 27 '))!;

    await page.setViewportSize({width: 1280, height: 720});
    await page.goto(`${event.path}/admin`);
    await page.getByRole('button', {name: 'Create pool', exact: true}).click();
    const createDialog = page.locator('#poolCreateModal');
    await createDialog.getByLabel('Pool name').fill('Large roster pool');
    await createDialog.getByLabel('Share distribution mode').selectOption('EQUAL');
    await expect(createDialog.getByLabel('Round base shares up')).toBeChecked();
    await createDialog.getByLabel('Round base shares up').uncheck();
    await reloadAfterAction(page, () => createDialog.getByRole('button', {name: 'Add pool', exact: true}).click());
    const pool = page.locator('.invoice-pool').first();
    const poolId = (await pool.getAttribute('data-pool'))!;
    const endpoint = `/api/event/${event.id}/invoice-pools/${poolId}`;
    await openPool(pool);
    const takeovers = page.locator('#takeoverModal');
    await Promise.all([
        takeovers.evaluate(element => new Promise<void>(resolve => element.addEventListener('shown.bs.modal', () => resolve(), {once: true}))),
        pool.getByRole('button', {name: 'Manage takeovers', exact: true}).click(),
    ]);
    await takeovers.getByLabel('Payer', {exact: true}).selectOption(String(organizer.id));
    const firstCheckbox = takeovers.locator(`.takeover-beneficiaries input[value="${first.id}"]`);
    const lastCheckbox = takeovers.locator(`.takeover-beneficiaries input[value="${last.id}"]`);
    await firstCheckbox.check();

    // Only the modal body scrolls; its controls and the final participant remain reachable at all sizes.
    for (const viewport of [{width: 1280, height: 720}, {width: 390, height: 844}, {width: 360, height: 640}]) {
        await page.setViewportSize(viewport);
        await takeovers.locator('.modal-body').evaluate(element => { element.scrollTop = 0; });
        const body = takeovers.locator('.modal-body');
        expect(await body.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
        expect(await takeovers.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
        const footerBefore = (await takeovers.locator('.modal-footer').boundingBox())!;
        expect(footerBefore.y).toBeGreaterThanOrEqual(0);
        expect(footerBefore.y + footerBefore.height).toBeLessThanOrEqual(viewport.height + 1);
        await lastCheckbox.scrollIntoViewIfNeeded();
        await expect(lastCheckbox).toBeInViewport();
        const footerAfter = (await takeovers.locator('.modal-footer').boundingBox())!;
        expect(footerAfter.y).toBeCloseTo(footerBefore.y, 0);
        await expect(takeovers.getByRole('button', {name: 'Save changes', exact: true})).toBeInViewport();
        await page.screenshot({path: testInfo.outputPath(`takeovers-28-${viewport.width}x${viewport.height}.png`), animations: 'disabled'});
    }
    await lastCheckbox.check();
    await takeovers.getByLabel('Search participants').fill('Participant 01');
    await expect(firstCheckbox).toBeChecked();
    await expect(lastCheckbox).not.toBeVisible();
    await expect(takeovers.locator('[data-takeover-summary]')).toContainText(last.name);
    await reloadAfterAction(page, () => takeovers.getByRole('button', {name: 'Save changes', exact: true}).click());
    await expect(pool.locator('.pool-takeover-summary')).toContainText(first.name);
    await expect(pool.locator('.pool-takeover-summary')).toContainText(last.name);
    await Promise.all([
        takeovers.evaluate(element => new Promise<void>(resolve => element.addEventListener('shown.bs.modal', () => resolve(), {once: true}))),
        pool.getByRole('button', {name: `Edit takeovers for ${organizer.name}`, exact: true}).click(),
    ]);
    await expect(firstCheckbox).toBeChecked();
    await expect(lastCheckbox).toBeChecked();
    await Promise.all([
        takeovers.evaluate(element => new Promise<void>(resolve => element.addEventListener('hidden.bs.modal', () => resolve(), {once: true}))),
        takeovers.locator('.modal-header .btn-close').click(),
    ]);

    expect((await page.request.post(`${endpoint}/submit`, {multipart: {
        amount: '1000', description: 'Large roster shared costs',
        proof: {name: 'large-roster.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\nLarge roster proof\n%%EOF')},
    }})).ok()).toBe(true);
    await page.reload();
    await openPool(pool);
    await reloadAfterAction(page, () => pool.getByRole('button', {name: 'Accept', exact: true}).click());
    await openPool(pool);
    await pool.getByRole('button', {name: 'Preview calculation', exact: true}).click();
    const preview = page.locator(`#pool-${poolId}-calculation`);
    await expect(preview.locator('[data-pool-preview-rows] tr')).toHaveCount(26);
    await preview.getByText('How the totals add up', {exact: true}).click();
    await expect(preview.locator('[data-preview-total="roundingDifference"]')).toHaveText('-0.12');
    await expect(preview.locator('[data-preview-total="invoiceCreditAmount"]')).toHaveText('1000.00');
    await expect(preview.locator('[data-preview-total="calculatedAmount"]')).toHaveText('-0.12');
    await preview.getByLabel('Email participants after this calculation').uncheck();
    await reloadAfterAction(page, () => preview.getByRole('button', {name: 'Close pool & calculate', exact: true}).click());

    await pool.getByRole('button', {name: 'Pool settings', exact: true}).click();
    const settings = page.locator(`#pool-${poolId}-settings`);
    await expect(settings.getByLabel('Round base shares up')).not.toBeChecked();
    await settings.getByLabel('Round base shares up').check();
    await settings.getByLabel('Send calculation emails automatically').uncheck();
    await reloadAfterAction(page, () => settings.getByRole('button', {name: 'Save pool settings', exact: true}).click());
    await expect(pool).toContainText('Recalculation required.');
    await pool.getByRole('button', {name: 'Recalculate pool', exact: true}).click();
    await expect(preview.getByRole('button', {name: 'Apply recalculation', exact: true})).toBeEnabled();
    await preview.getByText('How the totals add up', {exact: true}).click();
    await expect(preview.locator('[data-preview-total="roundingDifference"]')).toHaveText('0.16');
    await expect(preview.locator('[data-preview-total="expectedNetAmount"]')).toHaveText('0.00');
    await expect(preview.locator('[data-preview-total="calculatedAmount"]')).toHaveText('0.16');
    await page.setViewportSize({width: 390, height: 844});
    await preview.locator('[data-pool-preview-reconciliation]').scrollIntoViewIfNeeded();
    await page.screenshot({path: testInfo.outputPath('rounding-reconciliation-mobile.png'), animations: 'disabled'});
    await reloadAfterAction(page, () => preview.getByRole('button', {name: 'Apply recalculation', exact: true}).click());
    await expect(pool).not.toContainText('Recalculation required.');
});
