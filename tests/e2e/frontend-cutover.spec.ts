import {expect, test} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {createE2EActivityPlan, createE2EEvent, createE2ELogin, createE2EPackingList} from '../factories/e2eCoreFactory';
import {commandHeadersForE2E, createResourceViaForm, entitySettingsHeadersForE2E, loginForE2E} from '../keywords/e2eCoreKeywords';
import {createFinancePoolFixture, financeFixtureRequest, submitFinanceInvoiceFixture} from '../keywords/frontendFinanceE2EKeywords';
import type {components} from '../../src/types/api/v1';

test('canonical public pages hydrate without retired route aliases', async ({page, request}) => {
    await page.goto('/');
    await expect(page.locator('[data-frontend-hydrated="true"]')).toBeAttached();
    await expect(page.getByRole('link', {name: 'Home', exact: true})).toHaveAttribute('href', '/');

    for (const path of ['/frontend-pilot/help?doc=packing_lists&locale=de', '/home']) {
        const retired = await request.get(path, {maxRedirects: 0});
        expect(retired.status()).toBe(404);
        expect(retired.headers().location).toBeUndefined();
    }
    await page.goto('/help?doc=packing_lists&locale=de#packlisten');
    await expect(page).toHaveURL(/\/help\?doc=packing_lists&locale=de#packlisten$/u);
    await expect(page.locator('[data-frontend-hydrated="true"]')).toBeAttached();
    await expect(page.locator('html')).toHaveAttribute('lang', 'de');
});

test('archiving preserves saved proof bytes, export access and inherited child state', async ({request, browser, baseURL}) => {
    await loginForE2E(request, createE2ELogin());
    const event = await createResourceViaForm(request, createE2EEvent());
    const poolId = await createFinancePoolFixture(request, event.id, {name: 'Retained archival proofs'});
    const bytes = Buffer.from('%PDF-1.4\nRetained archival receipt\n%%EOF');
    await submitFinanceInvoiceFixture(request, `/api/v1/events/${event.id}/finance/pools/${poolId}/invoices/organizer`,
        {amount: '15', description: 'Retained archived cost'}, {name: 'archival.pdf', mimeType: 'application/pdf', buffer: bytes});
    const view = await financeFixtureRequest(request, 'GET', `/api/v1/events/${event.id}/finance/organizer`);
    const finance = await view.json() as components['schemas']['FinanceView'];
    const invoice = finance.invoices.find(value => value.poolId === poolId)!;
    expect(invoice.proofUrl).toBeTruthy();
    const proofUrl = invoice.proofUrl!;
    const input = createE2EPackingList();
    input.createPath += `?eventId=${event.id}`;
    const child = await createResourceViaForm(request, input);
    const archived = await request.post(`/api/v1/events/${event.id}/archive`,
        {headers: await commandHeadersForE2E(request)});
    expect(archived.status(), await archived.text()).toBe(200);
    const restoreChild = await request.post(`/api/v1/packing-lists/${child.id}/restore`,
        {headers: await commandHeadersForE2E(request)});
    expect(restoreChild.status()).toBe(409);
    expect((await request.get(child.path)).status()).toBe(200);
    // The rendered proof is an ordinary browser link. Its document route must
    // authorize the current actor without JavaScript-only context headers.
    expect(proofUrl).toBe(`/event/${event.id}/invoice-pools/${poolId}/invoices/${invoice.id}/proof`);
    const proof = await request.get(proofUrl);
    expect(proof.status()).toBe(200);
    expect(await proof.body()).toEqual(bytes);
    expect(proof.headers()['cache-control']).toContain('no-store');
    const apiProof = await financeFixtureRequest(request, 'GET',
        `/api/v1/events/${event.id}/finance/pools/${poolId}/invoices/${invoice.id}/proof`);
    expect(apiProof.status()).toBe(200);
    expect(await apiProof.body()).toEqual(bytes);
    const pdf = await request.get(event.path + '/export/participants');
    expect(pdf.status()).toBe(200);
    expect((await pdf.body()).subarray(0, 4).toString()).toBe('%PDF');
    const anonymous = await browser.newContext({baseURL});
    try { expect((await anonymous.request.get(proofUrl)).status()).toBe(401); }
    finally { await anonymous.close(); }
});

test('retired routes cannot redirect or accept writes', async ({request}) => {
    const alias = await request.get('/frontend-pilot//outside.example/path?x=1', {maxRedirects: 0});
    expect(alias.status()).toBe(404);
    expect(alias.headers().location).toBeUndefined();
    const retired = await request.post('/frontend-pilot/users/login', {data: {}, maxRedirects: 0});
    expect(retired.status()).toBe(404);
    expect(retired.headers().location).toBeUndefined();
    expect((await request.get('/api/event/retired/invoice-pools/retired/invoices/retired/proof')).status()).toBe(404);
});

test('missing resources retain real status codes and the current error document', async ({request}) => {
    for (const path of ['/missing-cutover-page', '/packing/00000000-0000-4000-8000-000000000000']) {
        const response = await request.get(path);
        expect(response.status()).toBe(404);
        expect(response.headers()['content-type']).toContain('text/html');
        expect(await response.text()).toContain('surveyor-frontend');
    }
    const asset = await request.get('/app/assets/missing-cutover.js');
    expect(asset.status()).toBe(404);
    expect(asset.headers()['content-type']).toContain('text/plain');
    expect(asset.headers()['cache-control']).toBe('no-store');
    expect(asset.headers()['set-cookie']).toBeUndefined();
    expect(await asset.text()).not.toContain('surveyor-frontend');
});

test('saved image and export URLs retain their authorized document responses', async ({request, browser}) => {
    await loginForE2E(request, createE2ELogin());
    const packing = await createResourceViaForm(request, createE2EPackingList());
    const image = readFileSync('src/public/img/logo.png');
    const uploaded = await request.put(`/api/v1/packing-lists/${packing.id}/header`, {
        headers: await entitySettingsHeadersForE2E(request, 'packing-lists', packing.id),
        multipart: {image: {name: 'header.png', mimeType: 'image/png', buffer: image}},
    });
    expect(uploaded.status(), await uploaded.text()).toBe(200);
    const stored = await request.get(packing.path + '/header');
    expect(stored.status()).toBe(200);
    expect(stored.headers()['content-type']).toContain('image/png');
    expect(await stored.body()).toEqual(image);

    // Output routes reuse existing method grants; neither a document nor a saved
    // image bookmark needs the JavaScript API's compatibility/CSRF headers.
    const activity = await createResourceViaForm(request, createE2EActivityPlan());
    const schedule = await request.get(activity.path + '/export/schedule');
    expect(schedule.status()).toBe(200);
    expect(schedule.headers()['content-type']).toContain('text/html');
    expect(await schedule.text()).toContain('Breakfast help');
    const event = await createResourceViaForm(request, createE2EEvent());
    const participants = await request.get(event.path + '/export/participants');
    expect(participants.status()).toBe(200);
    expect(participants.headers()['content-type']).toContain('application/pdf');
    expect((await participants.body()).subarray(0, 4).toString()).toBe('%PDF');

    const anonymous = await browser.newContext();
    try {
        const entry = await anonymous.request.get(new URL(event.path + '/export/participants', participants.url()).href,
            {maxRedirects: 0});
        expect(entry.status()).toBe(302);
        expect(entry.headers().location).toBe(event.path + '/guest');
    } finally { await anonymous.close(); }
});
