import {expect, test} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import * as pug from 'pug';
import * as sass from 'sass';

// This layout test uses shipped templates and styles without an application, session, or database.
test.use({viewport: {width: 1280, height: 900}, deviceScaleFactor: 1.25});

test('scrolling preview rows cannot paint through the three-pixel header seam at fractional scale', async ({page}, testInfo) => {
    const filename = resolve('src/views/modules/module_invoice_pool.pug');
    const content = pug.render(readFileSync(filename, 'utf8') + '\n+poolManagementModals(ev, pool, participants)', {
        filename,
        ev: {id: 'layout-event'},
        participants: [],
        pool: {
            id: 'seam', name: 'Pixel seam regression', status: 'CLOSED',
            shares: [], assignments: [], takeovers: [], surcharges: [], assignAll: true,
            sendCalculationEmails: true,
        },
    });
    const css = sass.compile(resolve('src/public/style/style.sass'), {logger: sass.Logger.silent}).css;
    await page.setContent(`<html data-bs-theme="dark"><body>${content}</body></html>`);
    await page.addStyleTag({content: css + '.modal.fade .modal-dialog { transition: none !important; }'});
    await page.evaluate(() => {
        document.body.style.zoom = '1.25';
        const modal = document.getElementById('pool-seam-calculation')!;
        modal.classList.add('show');
        modal.style.display = 'block';
        modal.removeAttribute('aria-hidden');
        const reconciliation = modal.querySelector<HTMLDetailsElement>('[data-pool-preview-reconciliation]')!;
        reconciliation.hidden = false;
        reconciliation.open = true;
        modal.querySelector<HTMLElement>('[data-pool-preview-table]')!.hidden = false;
        const body = modal.querySelector<HTMLTableSectionElement>('[data-pool-preview-rows]')!;
        for (let payer = 0; payer < 40; payer++) {
            const row = document.createElement('tr');
            for (let column = 0; column < 6; column++) {
                const cell = document.createElement('td');
                cell.textContent = column === 0 ? `Moving payer ${payer} at header edge` : '40.00';
                row.append(cell);
            }
            body.append(row);
        }
        modal.querySelector<HTMLElement>('.modal-body')!.scrollTop = 480;
        modal.querySelector<HTMLElement>('.pool-preview-table')!.scrollTop = 133;
    });

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
