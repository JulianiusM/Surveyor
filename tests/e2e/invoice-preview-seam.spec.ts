import {expect, test} from '@playwright/test';
import type {Page, Route, TestInfo} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import * as pug from 'pug';
import * as sass from 'sass';
import {invoicePresentation} from '../../src/modules/invoice/presentation';

// This layout test uses shipped templates and styles without an application, session, or database.
test.use({viewport: {width: 1280, height: 900}, deviceScaleFactor: 1.25});

test('scrolling preview rows cannot paint through the three-pixel header seam at fractional scale', async ({page}, testInfo) => {
    const filename = resolve('src/views/modules/module_invoice_pool.pug');
    const content = pug.render(readFileSync(filename, 'utf8') + '\n+poolManagementModals(ev, pool, participants, ui)', {
        filename,
        ev: {id: 'layout-event'},
        participants: [],
        ui: invoicePresentation,
        pool: {
            id: 'seam', name: 'Pixel seam regression', status: 'CLOSED',
            shares: [], assignments: [], takeovers: [], surcharges: [], assignAll: true,
            sendCalculationEmails: true,
        },
    });
    const css = sass.compile(resolve('src/public/style/style.sass'), {logger: sass.Logger.silent}).css;
    await page.setContent(`<html data-bs-theme="dark"><body>${content}</body></html>`);
    await page.addStyleTag({content: css + '.modal.fade .modal-dialog { transition: none !important; }'});
    await page.evaluate(labels => {
        document.body.style.zoom = '1.25';
        const modal = document.getElementById('pool-seam-calculation')!;
        modal.classList.add('show');
        modal.style.display = 'block';
        modal.removeAttribute('aria-hidden');
        const reconciliation = modal.querySelector<HTMLDetailsElement>('[data-pool-preview-reconciliation]')!;
        reconciliation.hidden = false;
        reconciliation.open = true;
        modal.querySelector<HTMLElement>('[data-pool-preview-table]')!.hidden = false;
        // This dense fixture uses every amount column. Keep its manually inserted header aligned
        // with the body, as the production preview renderer does for a real server response.
        const header = modal.querySelector<HTMLTableRowElement>('[data-pool-preview-columns]')!;
        header.replaceChildren();
        for (const label of labels) {
            const heading = document.createElement('th');
            heading.scope = 'col';
            heading.textContent = label;
            header.append(heading);
        }
        const body = modal.querySelector<HTMLTableSectionElement>('[data-pool-preview-rows]')!;
        for (let payer = 0; payer < 40; payer++) {
            const row = document.createElement('tr');
            for (let column = 0; column < labels.length; column++) {
                const cell = document.createElement('td');
                cell.textContent = column === 0 ? `Moving payer ${payer} at header edge` : '40.00';
                row.append(cell);
            }
            body.append(row);
        }
        modal.querySelector<HTMLElement>('.modal-body')!.scrollTop = 480;
        modal.querySelector<HTMLElement>('.pool-preview-table')!.scrollTop = 133;
    }, [invoicePresentation.labels.payer, invoicePresentation.labels.base, invoicePresentation.labels.adjustments,
        invoicePresentation.labels.invoiceCredit, invoicePresentation.labels.previous, invoicePresentation.labels.original]);

    const scrollport = page.locator('#pool-seam-calculation .pool-preview-table');
    expect(await scrollport.evaluate(element => element.scrollTop)).toBeGreaterThan(100);
    const bounds = (await scrollport.boundingBox())!;
    expect(bounds.y).toBeGreaterThan(0);
    expect(bounds.y + 3).toBeLessThan(900);
    const clip = {x: bounds.x + 1, y: bounds.y, width: bounds.width - 2, height: 3};

    // DOM hit testing reports the header even when composited row pixels bleed through its edge.
    // Hide the rows without changing geometry: an opaque header seam must produce identical pixels.
    const withRows = await page.screenshot({clip});
    const rows = page.locator('#pool-seam-calculation [data-pool-preview-rows]');
    await rows.evaluate(element => { element.style.visibility = 'hidden'; });
    const withoutRows = await page.screenshot({clip});
    await rows.evaluate(element => { element.style.visibility = ''; });
    if (!withRows.equals(withoutRows)) {
        await testInfo.attach('seam-with-rows', {body: withRows, contentType: 'image/png'});
        await testInfo.attach('seam-without-rows', {body: withoutRows, contentType: 'image/png'});
        await testInfo.attach('scrolled-preview', {body: await page.screenshot(), contentType: 'image/png'});
    }
    expect(withRows.equals(withoutRows), 'The top three pixels must stay opaque when the scrolling rows are hidden').toBe(true);
});

/** Load the shipped ledger module and Bootstrap into a database-free production-template fixture. */
async function openInvoiceLayoutFixture(page: Page, content: string, initialization = ''): Promise<void> {
    const css = sass.compile(resolve('src/public/style/style.sass'), {logger: sass.Logger.silent}).css;
    // Serve a real-origin document so the built browser module resolves its production imports.
    // All fixture data is test-owned; names and saved notes still pass through production escaping.
    async function serveFixture(route: Route) {
        await route.fulfill({contentType: 'text/html', body:
            `<html data-bs-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head>
            <body>${content}<script id="invoiceLabelsData" type="application/json">${JSON.stringify(invoicePresentation.labels)}</script>
            <script type="module">
            import {initShareLedgers, renderPoolCalculationPreview} from '/js/events.gen.js';
            ${initialization}
            initShareLedgers();
            document.body.dataset.fixtureReady = 'true';
            </script></body></html>`});
    }
    await page.route('**/invoice-layout-fixture', serveFixture);
    await page.goto('/invoice-layout-fixture');
    await expect(page.locator('body')).toHaveAttribute('data-fixture-ready', 'true');
    // Exercise the actual shared modal lifecycle rather than manually adding visibility classes.
    await page.addScriptTag({path: resolve('node_modules/bootstrap/dist/js/bootstrap.bundle.min.js')});
}

/** Keep visible-component overflow checks independent of the fixture's vertical page length. */
async function expectInvoiceLayoutFits(page: Page, scope: string, selectors: string[]): Promise<void> {
    for (const selector of selectors) {
        for (const node of await page.locator(`${scope} ${selector}`).all()) {
            expect(await node.evaluate(element => element.scrollWidth <= element.clientWidth + 1), selector).toBe(true);
        }
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

/** Retain successful screenshots as reviewable evidence of the real initialized layout. */
async function retainInvoiceLayoutScreenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
    // Visibility alone permits a screenshot midway through Bootstrap's opacity transition.
    // Wait for the open dialog's final paint so the artifact represents its readable settled layout.
    const activeModal = page.locator('.modal.show');
    if (await activeModal.count()) await expect(activeModal).toHaveCSS('opacity', '1');
    const path = testInfo.outputPath(`${name}.png`);
    await page.screenshot({path});
    await testInfo.attach(name, {path, contentType: 'image/png'});
}

// These viewports cross both Bootstrap modal sizing and the established ledger/card breakpoint.
// Long names, saved notes, formulas, and large signed refunds must wrap within the same components.
for (const width of [320, 390, 768, 834, 1024, 1440]) {
    test(`saved shares and calculation previews fit a ${width}px viewport`, async ({page}, testInfo) => {
        const filename = resolve('src/views/modules/module_invoice_pool.pug');
        const payerName = 'LongPayerName'.repeat(15);
        const share = {
            id: 1, registrationId: 1, baseShareAmount: 10, extraAmount: -20, invoiceCreditAmount: 100,
            paymentCreditAmount: 99999889.99, shareAmount: -99999999.99, isPaid: true,
            note: 'A saved calculation note with unbroken content: ' + 'LongReceiptNote'.repeat(20),
        };
        const explanation = {
            version: 1 as const, distributionMethod: 'EQUAL' as const, roundUpShares: true,
            invoiceAmount: 10, redistributedAmount: 0, distributableAmount: 10,
            assignedParticipants: 1, exemptParticipants: 0, attendanceUnits: 1, eligibleAttendanceUnits: 1,
            effectiveWeight: 1, weightDenominator: '1', contributions: [{registrationId: 1, payerRegistrationId: 1,
                name: payerName, attendanceWeight: 1, factor: 1, isExempt: false, effectiveWeight: 1,
                weightNumerator: '1', baseShareAmount: 10}],
        };
        const pool = {id: 'responsive', name: 'Shared travel', status: 'CLOSED', shares: [share],
            totalAmount: -10, invoiceAmount: 10, payableAmount: 10, outstandingAmount: 0, creditAmount: 0,
            assignments: [], takeovers: [], surcharges: [], invoices: [], assignAll: true,
            calculationSnapshot: {explanation, surcharges: [{registrationId: 1, amount: -20, subtractFromPool: false, note: ''}]}};
        const content = pug.render(readFileSync(filename, 'utf8') + `
.container.py-3
    +poolHeaderSummary(pool, ui)
    +invoiceShareTable(pool, participants, true, ev.id, ui)
    +participantShareSummary(1, [pool], ui, participants)
+poolManagementModals(ev, pool, participants, ui)
`, {filename, pool, participants: [{id: 1, name: payerName}], ev: {id: 'layout-event'}, ui: invoicePresentation});
        const preview = {revision: 1, labels: invoicePresentation.labels,
            explanation, calculation: invoicePresentation.calculation(explanation, [share], pool.calculationSnapshot.surcharges),
            shares: [{...share, isPaid: false, payerName,
                calculation: invoicePresentation.payerCalculation(explanation, {...share, payerName}, pool.calculationSnapshot.surcharges)}]};
        await page.setViewportSize({width, height: 900});
        await openInvoiceLayoutFixture(page, content,
            `renderPoolCalculationPreview(document.getElementById('pool-responsive-calculation'), ${JSON.stringify(preview)});`);
        const personal = page.locator('[data-personal-share-ledger]');
        await expect(personal.locator('[data-share-balance]')).toHaveText('-99999999.99');
        await expect(personal.locator('[data-share-state]')).toHaveText('Refunded');
        await expect(personal.locator('.share-settlement')).toHaveCount(0);
        const exports = page.locator('.container a[download]');
        await expect(exports).toHaveCount(2);
        await expect(exports.nth(0)).toHaveAttribute('href', '/event/layout-event/export/invoice-pools/responsive/shares');
        await expect(exports.nth(1)).toHaveAttribute('href', '/event/layout-event/export/invoice-pools/responsive/shares?example=false');
        await expectInvoiceLayoutFits(page, '.container', ['.pool-header-summary', '.share-ledger', '.share-ledger-table']);
        if ([320, 834, 1440].includes(width)) await retainInvoiceLayoutScreenshot(page, testInfo, `share-ledgers-${width}`);

        // Initialize and open the same single lazy dialog used by the live participant collection.
        await personal.getByRole('button', {name: 'View breakdown for Shared travel', exact: true}).click();
        const personalModal = page.locator('#pool-personal-shares-1-share-breakdown');
        await expect(personalModal).toBeVisible();
        await personalModal.getByText('Calculation explanation', {exact: true}).click();
        await personalModal.getByText(invoicePresentation.labels.calculationNotes, {exact: true}).click();
        await expect(personalModal.locator('[data-calculation-display]')).toContainText(`Base share for ${payerName}`);
        await expect(personalModal).not.toContainText('Participant A');
        await expect(personalModal).not.toContainText('Unsettled balance');
        await expect(personalModal.locator('[data-share-details-content] > dl')).toContainText('-99999999.99');
        await expectInvoiceLayoutFits(page, '#pool-personal-shares-1-share-breakdown',
            ['.modal-dialog', '.modal-body', '.invoice-share-breakdown', '.invoice-calculation', '.invoice-calculation-formula']);
        if ([320, 834, 1440].includes(width)) {
            // Keep both the financial summary and a concrete equation visible in the review artifacts.
            // Opening the final notes disclosure may have scrolled past the calculation on a short screen.
            await personalModal.locator('.modal-body').evaluate(element => { element.scrollTop = 0; });
            await retainInvoiceLayoutScreenshot(page, testInfo, `personal-calculation-${width}`);
            await personalModal.locator('.invoice-calculation-formula').first().scrollIntoViewIfNeeded();
            await retainInvoiceLayoutScreenshot(page, testInfo, `personal-formula-${width}`);
        }

        // Close the concrete payer view before opening the global preview through Bootstrap as well.
        await personalModal.locator('[data-bs-dismiss="modal"]').first().click();
        await expect(personalModal).toBeHidden();
        await page.evaluate(() => {
            const modal = document.getElementById('pool-responsive-calculation')!;
            window.bootstrap.Modal.getOrCreateInstance(modal).show();
            modal.querySelector<HTMLDetailsElement>('[data-pool-preview-reconciliation]')!.open = true;
            modal.querySelector<HTMLDetailsElement>('[data-pool-preview-rows] details')!.open = true;
        });
        await expect(page.locator('#pool-responsive-calculation')).toBeVisible();
        // Preview details retain projected audit notes only; the global example remains the sole inline formula model.
        await expect(page.locator('[data-pool-preview-rows] details')).toContainText(share.note);
        await expect(page.locator('[data-pool-preview-rows] [data-calculation-display]')).toHaveCount(0);
        await expect(page.locator('[data-pool-preview-basis] [data-calculation-display]')).toHaveCount(1);
        await expectInvoiceLayoutFits(page, '#pool-responsive-calculation',
            ['.modal-dialog', '.modal-body', '.pool-preview-table', '[data-pool-preview-rows] td', '.invoice-calculation-formula']);
        if (width < 992) {
            // Absence of horizontal overflow alone cannot detect a payer squashed by the desktop column width.
            // The named first cell must use the full-width row of the established mobile/tablet card layout.
            const previewRow = page.locator('[data-pool-preview-rows] tr').first();
            const rowWidth = await previewRow.evaluate(element => element.getBoundingClientRect().width);
            const payerWidth = await previewRow.locator('td').first().evaluate(element => element.getBoundingClientRect().width);
            expect(payerWidth / rowWidth).toBeGreaterThan(0.85);
        }
        await expect(page.locator('[data-pool-preview-refunds]')).toHaveText('-99999999.99');
        await expect(page.locator('[data-pool-preview-rows] [data-label="Calculated balance"]')).toContainText('-99999999.99');
    });
}

test('a long personal pool history reuses ledger display controls and one lazy concrete breakdown', async ({page}, testInfo) => {
    const filename = resolve('src/views/modules/module_invoice_pool.pug');
    const payerName = 'Returning participant';
    // Distinct names, amounts, notes, and statuses exercise the shared display behavior across 180 pools.
    const pools = [];
    for (let index = 0; index < 180; index++) {
        const amount = (index + 1) / 100 * (index % 3 === 1 ? -1 : 1);
        pools.push({id: `pool-${index}`, name: `Pool ${String(index).padStart(3, '0')}`, status: 'CLOSED', shares: [{
            registrationId: 1, baseShareAmount: amount, extraAmount: 0, invoiceCreditAmount: 0,
            paymentCreditAmount: 0, shareAmount: amount, isPaid: index % 3 === 2, note: `Receipt ${String(index).padStart(3, '0')}`,
        }]});
    }
    const content = pug.render(readFileSync(filename, 'utf8') + '\n.container.py-3\n    +participantShareSummary(1, pools, ui, participants)',
        {filename, pools, participants: [{id: 1, name: payerName}], ui: invoicePresentation});
    await page.setViewportSize({width: 834, height: 900});
    await openInvoiceLayoutFixture(page, content);
    const ledger = page.locator('[data-personal-share-ledger]');
    const visibleRows = ledger.locator('[data-share-row]:visible');
    await expect(ledger.locator('[data-share-row]')).toHaveCount(180);
    await expect(visibleRows).toHaveCount(25);
    await expect(page.locator('.modal')).toHaveCount(1);
    await expect(page.locator('[data-calculation-display]')).toHaveCount(0);
    await expect(ledger.locator('.share-settlement')).toHaveCount(0);

    // Page size and navigation operate on saved rows, preserving the single reusable dialog.
    await ledger.locator('[data-share-page-size]').selectOption('100');
    await expect(visibleRows).toHaveCount(100);
    await ledger.locator('[data-share-next]').click();
    await expect(visibleRows).toHaveCount(80);
    await expect(ledger.locator('[data-share-page-summary]')).toHaveText('101–180 of 180 shares');
    await retainInvoiceLayoutScreenshot(page, testInfo, 'personal-paged-ledger-834');
    await expectInvoiceLayoutFits(page, '.container', ['.share-ledger', '.share-ledger-table']);

    // Filtering and sorting reset to the first matching page without changing any saved financial status.
    await ledger.locator('[data-share-filter]').selectOption('due');
    await expect(visibleRows).toHaveCount(60);
    await ledger.locator('[data-share-sort]').selectOption('amount-desc');
    await expect(visibleRows.first().locator('[data-share-balance]')).toHaveText('1.78');
    await ledger.locator('input[data-share-search]').fill('Pool 090');
    await expect(visibleRows).toHaveCount(1);
    await expect(visibleRows.first()).toContainText('Pool 090');
    await ledger.locator('[data-share-filter]').selectOption('');
    await ledger.locator('input[data-share-search]').fill('Receipt 089');
    await expect(visibleRows).toHaveCount(1);
    await expect(visibleRows.first().locator('[data-share-state]')).toHaveText('Paid');
    await visibleRows.first().getByRole('button', {name: 'View breakdown for Pool 089', exact: true}).click();
    const modal = page.locator('#pool-personal-shares-1-share-breakdown');
    await expect(modal).toBeVisible();
    await modal.getByText('Calculation explanation', {exact: true}).click();
    await expect(modal.locator('[data-calculation-display]')).toContainText(`Calculated balance for ${payerName}`);
    await expect(modal.locator('[data-calculation-display]')).not.toContainText('Participant A');
    await expect(page.locator('[data-calculation-display]')).toHaveCount(1);
    await expectInvoiceLayoutFits(page, '#pool-personal-shares-1-share-breakdown',
        ['.modal-dialog', '.modal-body', '.invoice-calculation-formula']);
});
