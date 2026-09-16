import {expect, request as playwrightRequest, test, type Locator, type Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {createE2EEvent, createE2ELogin, createE2EPackingList, createE2ESurvey} from '../factories/e2eCoreFactory';
import {createResourceViaForm, loginForE2E} from '../keywords/e2eCoreKeywords';

// Commands acknowledge success briefly before reloading. Register the navigation wait before clicking
// so assertions use the newly projected cards rather than stale state on the previous document.
async function chooseCardAction(page: Page, card: Locator, label: string): Promise<void> {
    await card.getByRole('button', {name: /^Archival and visibility for /}).click();
    await Promise.all([
        page.waitForEvent('load'),
        card.getByRole('button', {name: label, exact: true}).click(),
    ]);
}

async function expectDropdownReachable(menu: Locator): Promise<void> {
    // Visibility alone does not detect clipping: verify viewport bounds and hit-testing of every action.
    // Poll while Bootstrap/Popper finishes placement. One pixel allows fractional layout rounding, not
    // overflow large enough to conceal text or actions at a viewport edge.
    await expect.poll(async function menuFitsViewport() {
        return menu.evaluate(function measureMenu(element) {
            const bounds = element.getBoundingClientRect();
            return bounds.left >= 0 && bounds.top >= 0
                && bounds.right <= window.innerWidth + 1 && bounds.bottom <= window.innerHeight + 1;
        });
    }).toBe(true);

    for (const action of await menu.locator('button, a').all()) {
        // A menu can have valid bounds yet sit under an accordion sibling. Test the actual element at each
        // action's center so overlapping/clipping containers cannot silently make controls unreachable.
        await expect.poll(async function actionReceivesPointer() {
            return action.evaluate(function hitTest(element) {
                const bounds = element.getBoundingClientRect();
                const hit = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
                return !!hit && (hit === element || element.contains(hit));
            });
        }).toBe(true);
    }
}

test('keeps overview dropdowns usable at narrow viewport edges and leaves Delete as permanent deletion', async ({page}) => {
    test.setTimeout(60000);
    await page.setViewportSize({width: 360, height: 640});
    await loginForE2E(page.request, createE2ELogin());
    // Use a unique title to find this archived card among fixtures created by other browser tests. The API
    // arranges archival quickly; the behavior under test is real rendered menus, keyboard access, and Delete.
    const title = `Archive menu edge ${randomUUID()}`;
    const eventCase = createE2EEvent();
    eventCase.title = title;
    eventCase.form.title = title;
    const event = await createResourceViaForm(page.request, eventCase);
    expect((await page.request.post(`/api/event/${event.id}/archive`, {data: {}})).ok()).toBe(true);

    await page.goto('/users/dashboard');
    const owner = page.locator('#sec-own-parts');
    const archived = page.locator('#sec-own-parts-archived');
    await expect(archived).not.toBeVisible();
    await owner.getByRole('button', {name: /^Archived and hidden/}).click();
    await expect(archived).toBeVisible();
    // Bootstrap marks the section visible before its height transition finishes. Keyboard opening
    // must start after expansion, when the menu's placement and viewport scroll use the final layout.
    await expect(archived).toHaveClass(/\bshow\b/);
    await archived.getByRole('searchbox').fill(title);
    const card = archived.locator(`.js-item[data-id="${event.id}"]`);
    const toggle = card.getByRole('button', {name: /^Archival and visibility for /});
    await toggle.scrollIntoViewIfNeeded();
    await toggle.press('ArrowDown');
    const menu = card.locator('.dropdown-menu');
    await expect(menu).toBeVisible();
    await expectDropdownReachable(menu);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

    // Keyboard focus can reach a card before the containing collapse animation has finished.
    // Slow only this animation so the test reliably exercises that timing with real key input.
    await toggle.press('Escape');
    await owner.getByRole('button', {name: /^Archived and hidden/}).click();
    await expect(archived).not.toBeVisible();
    await page.addStyleTag({content: '.entity-overview .collapsing { transition-duration: 2s !important; }'});
    await owner.getByRole('button', {name: /^Archived and hidden/}).click();
    await expect(archived).toHaveClass(/\bcollapsing\b/);
    await toggle.focus();
    await page.keyboard.press('ArrowDown');
    await expect(menu).toBeVisible();
    await expect(archived).toHaveClass(/\bcollapsing\b/);
    await expect(archived).toHaveClass(/\bshow\b/);
    await expectDropdownReachable(menu);

    // The last card's permanent delete form remains separate from all archival/visibility controls.
    await toggle.press('Escape');
    await expect(menu).not.toBeVisible();
    const deleteForm = card.locator(`form[action="${event.path}/delete"]`);
    await expect(deleteForm.getByRole('button', {name: 'Delete', exact: true})).toBeVisible();
    page.once('dialog', async function acceptDelete(dialog) {
        expect(dialog.message()).toBe('Delete this item?');
        await dialog.accept();
    });
    await Promise.all([
        page.waitForEvent('load'),
        deleteForm.getByRole('button', {name: 'Delete', exact: true}).click(),
    ]);
    expect((await page.request.get(event.path)).status()).toBe(404);
    // A deleted entity must also be absent to the restore endpoint; hiding an archived row cannot satisfy
    // this assertion. Service-level tests separately check persisted children and visibility cleanup.
    expect((await page.request.post(`/api/event/${event.id}/restore`, {data: {}})).status()).toBe(404);
});

test('keeps archived cards accessible in collapsed sections and persists personal visibility separately', async ({page}) => {
    test.setTimeout(60000);
    await loginForE2E(page.request, createE2ELogin());
    const eventCase = createE2EEvent({title: 'Archival browser event', form: {...createE2EEvent().form, title: 'Archival browser event'}});
    const event = await createResourceViaForm(page.request, eventCase);
    const childCase = createE2EPackingList({
        title: 'Archival browser packing',
        createPath: `/packing/create?eventId=${event.id}`,
        form: {...createE2EPackingList().form, title: 'Archival browser packing', event_id: event.id} as ReturnType<typeof createE2EPackingList>['form'],
    });
    const child = await createResourceViaForm(page.request, childCase);
    // Make the same event appear in both administration and participation. One saved private preference
    // must affect both appearances, while the attached packing list inherits authoritative event archival.
    expect((await page.request.post(`/api/event/${event.id}/register`, {
        data: {arrivalDate: eventCase.form.startDate, departureDate: eventCase.form.endDate, dietary: ['MEAT']},
    })).ok()).toBe(true);
    page.on('dialog', dialog => dialog.accept());
    await page.goto('/users/dashboard');
    const owner = page.locator('#sec-own-parts');
    const ownerCard = owner.locator(`.js-item[data-id="${event.id}"]`);
    const main = owner.locator('[data-section="sec-own-parts-main"]');
    const archive = page.locator('#sec-own-parts-archived');
    await expect(main.locator(`.js-item[data-id="${event.id}"]`)).toBeVisible();
    await chooseCardAction(page, ownerCard, 'Archive for everyone');
    await expect(archive).not.toBeVisible();
    await expect(ownerCard).not.toBeVisible();
    await expect(page.locator('#sec-parts-archived')).not.toBeVisible();
    await owner.getByRole('button', {name: /^Archived and hidden/}).click();
    await expect(ownerCard).toBeVisible();
    await expect(ownerCard).toContainText('Archived');
    await expect(archive.locator(`.js-item[data-id="${child.id}"]`)).toContainText('Archived with event');
    // The initially collapsed archive retains real, independently searchable cards rather than dead links.
    const search = archive.getByRole('searchbox');
    await search.fill('no archival match');
    await expect(archive.getByText('No entities match your search and filter.')).toBeVisible();
    await search.fill(event.title);
    await expect(ownerCard).toBeVisible();
    await expect(archive.locator('.js-count')).toHaveText('1');
    // "Show for me" changes placement only. The archived badge must remain, proving it did not restore
    // the event globally; returning to default follows the still-archived state again.
    await chooseCardAction(page, ownerCard, 'Show for me');
    await expect(main.locator(`.js-item[data-id="${event.id}"]`)).toBeVisible();
    await expect(ownerCard).toContainText('Archived');
    await expect(page.locator(`#sec-parts .js-item[data-id="${event.id}"]`)).toBeVisible();
    await chooseCardAction(page, ownerCard, 'Use default visibility');
    await expect(ownerCard).not.toBeVisible();
    await owner.getByRole('button', {name: /^Archived and hidden/}).click();
    await chooseCardAction(page, ownerCard, 'Restore for everyone');
    await expect(ownerCard).toBeVisible();
    await expect(ownerCard).toContainText('Automatic archival paused');
    // A restored, active event can still be hidden privately, and navigation must preserve that choice.
    await chooseCardAction(page, ownerCard, 'Hide for me');
    await expect(ownerCard).not.toBeVisible();
    // Personal hiding affects the overview alone; direct access and shared child cards still work.
    await page.goto(event.path);
    await expect(page.locator(`.js-item[data-id="${child.id}"]`)).toBeVisible();
    await expect(page.locator('[data-archive-notice]')).toContainText('Automatic archival paused');
    await page.goto(child.path);
    await expect(page.getByRole('heading', {name: child.title, exact: true})).toBeVisible();
    await page.goto('/users/dashboard');
    await expect(ownerCard).not.toBeVisible();
    await owner.getByRole('button', {name: /^Archived and hidden/}).click();
    await chooseCardAction(page, ownerCard, 'Show for me');
    await expect(ownerCard).toBeVisible();
});

test('enforces metadata authority, owner-only surveys and session-only personal visibility through the APIs', async ({page, baseURL}) => {
    test.setTimeout(60000);
    const request = page.request;
    // Independent cookie jars represent the owner, a subsequently authenticated guest, and a permanently
    // anonymous visitor. Session identity must come from each request context, never a supplied profileId.
    const guest = await playwrightRequest.newContext({baseURL});
    const anonymous = await playwrightRequest.newContext({baseURL});
    try {
        await loginForE2E(request, createE2ELogin());
        const eventCase = createE2EEvent({
            title: 'Archival access rules',
            form: {...createE2EEvent().form, title: 'Archival access rules', startDate: '2099-08-05', endDate: '2099-08-07'},
        });
        Object.assign(eventCase.form, {'defaultPerms[public][0]': 'ACCESS_REGISTRATION', 'defaultPerms[public][1]': 'ACCESS_VIEW'});
        // Future dates keep the event eligible for the ordinary creation picker until archival explicitly
        // removes it. Public view/registration grants let us distinguish access from overview membership.
        const event = await createResourceViaForm(request, eventCase);
        const archiveUrl = `/api/event/${event.id}/archive`;
        const visibilityUrl = `/api/users/overview/event/${event.id}/visibility`;
        expect((await anonymous.post(archiveUrl, {data: {}})).status()).toBe(401);
        expect((await anonymous.post(visibilityUrl, {data: {visibility: 'hidden'}})).status()).toBe(401);
        expect((await guest.post(`${event.path}/guest`, {form: {username: 'Archival guest'}, maxRedirects: 0})).status()).toBe(302);
        // Public view access alone does not make the event a member of an overview.
        expect((await guest.post(visibilityUrl, {data: {visibility: 'hidden'}})).status()).toBe(403);
        expect((await guest.post(`/api/event/${event.id}/register`, {
            data: {arrivalDate: eventCase.form.startDate, departureDate: eventCase.form.endDate, dietary: ['MEAT']},
        })).ok()).toBe(true);
        expect((await guest.post(visibilityUrl, {data: {visibility: 'hidden'}})).ok()).toBe(true);
        expect((await guest.post(archiveUrl, {data: {}})).status()).toBe(403);
        expect((await guest.post(`/api/event/${event.id}/restore`, {data: {}})).status()).toBe(403);
        expect((await guest.post(`${archiveUrl}/automation`, {data: {paused: true}})).status()).toBe(403);

        // Administrative admission and assignment management are insufficient. Only adding EDIT_META
        // enables authoritative archival/restoration, including for a guest with that delegated authority.
        const participants = await request.get(`/api/event/${event.id}/participants`);
        const guestProfile = (await participants.json()).data.participants.find((row: {name: string}) => row.name === 'Archival guest').profileId as string;
        expect((await request.post(`/api/event/${event.id}/admins`, {data: {profileId: guestProfile, perms: ['ACCESS_ADMIN', 'MANAGE_ASSIGNMENTS']}})).ok()).toBe(true);
        expect((await guest.post(archiveUrl, {data: {}})).status()).toBe(403);
        expect((await request.patch(`/api/event/${event.id}/admins/${guestProfile}`, {data: {perms: ['ACCESS_ADMIN', 'EDIT_META']}})).ok()).toBe(true);
        expect((await guest.post(archiveUrl, {data: {}})).ok()).toBe(true);
        expect((await guest.get(event.path)).status()).toBe(200);
        expect((await guest.post(`/api/event/${event.id}/restore`, {data: {}})).ok()).toBe(true);

        // Commands have deliberately narrow payloads: clients cannot supply timestamps, impersonate a
        // profile, coerce strings to booleans, or smuggle fields accepted by a different lifecycle command.
        for (const body of [{archivedAt: '2000-01-01'}, {profileId: guestProfile}, {paused: false}]) {
            expect((await request.post(archiveUrl, {data: body})).status()).toBe(400);
        }
        for (const body of [{paused: 'false'}, {paused: 1}, {paused: false, extra: true}, {}]) {
            expect((await request.post(`${archiveUrl}/automation`, {data: body})).status()).toBe(400);
        }
        for (const body of [{visibility: 'hidden', profileId: guestProfile}, {visibility: 'invalid'}, {visibility: true}, {}]) {
            expect((await request.post(visibilityUrl, {data: body})).status()).toBe(400);
        }
        expect((await request.post(`/api/users/overview/unknown/${event.id}/visibility`, {data: {visibility: 'hidden'}})).status()).toBe(400);
        expect((await request.post(`/api/users/overview/event/${randomUUID()}/visibility`, {data: {visibility: 'hidden'}})).status()).toBe(404);

        // Create a real uploaded proof through the organizer workflow before archival. Exact bytes below
        // protect the file-retention boundary, not merely the existence of an invoice row or download URL.
        const poolCreated = await request.post(`/api/event/${event.id}/invoice-pools`, {data: {
            name: 'Retained archival proofs', distribution: 'EQUAL', assignAll: true,
            subtractPersonalInvoices: true, sendCalculationEmails: false,
        }});
        expect(poolCreated.ok()).toBe(true);
        const poolId = (await poolCreated.json()).data.id;
        const poolEndpoint = `/api/event/${event.id}/invoice-pools/${poolId}`;
        const proofBytes = Buffer.from('%PDF-1.4\nRetained archival receipt\n%%EOF');
        const expenseCreated = await request.post(`${poolEndpoint}/invoices/organizer`, {multipart: {
            amount: '15', description: 'Retained archived cost',
            proof: {name: 'archival-receipt.pdf', mimeType: 'application/pdf', buffer: proofBytes},
        }});
        expect(expenseCreated.ok()).toBe(true);
        const invoiceId = (await expenseCreated.json()).data.id;
        const proofUrl = `${poolEndpoint}/invoices/${invoiceId}/proof`;

        const childCase = createE2EPackingList({
            createPath: `/packing/create?eventId=${event.id}`,
            form: {...createE2EPackingList().form, event_id: event.id} as ReturnType<typeof createE2EPackingList>['form'],
        });
        const child = await createResourceViaForm(request, childCase);
        expect((await request.post(archiveUrl, {data: {}})).ok()).toBe(true);
        // Inherited archival cannot be removed from just the child, but it must not revoke direct access.
        expect((await request.post(`/api/packing/${child.id}/restore`, {data: {}})).status()).toBe(409);
        expect((await request.get(child.path)).status()).toBe(200);
        expect(await (await request.get(child.path)).text()).toContain('Archived with event');

        // Archival preserves downloadable records and their existing access boundaries.
        const retainedProof = await request.get(proofUrl);
        expect(retainedProof.status()).toBe(200);
        expect(await retainedProof.body()).toEqual(proofBytes);
        expect((await guest.get(proofUrl)).status()).toBe(403);
        expect((await anonymous.get(proofUrl)).status()).toBe(401);
        const exportUrl = `${event.path}/export/participants`;
        const exported = await request.get(exportUrl);
        expect(exported.status()).toBe(200);
        expect(exported.headers()['content-type']).toContain('application/pdf');
        expect((await exported.body()).subarray(0, 5).toString()).toBe('%PDF-');
        expect((await guest.get(exportUrl)).status()).toBe(403);

        // An archived future event leaves the general picker, but an explicit,
        // authorized creation context retains its selection and inheritance notice.
        await page.goto('/packing/create');
        await page.locator('#event_id-btn').click();
        await expect(page.locator('#event_id-modal')).toBeVisible();
        await expect(page.locator(`#event_id-list [data-event-id="${event.id}"]`)).toHaveCount(0);
        await page.goto(childCase.createPath);
        await expect(page.locator('#event_id')).toHaveValue(event.id);
        await expect(page.locator('#event_id-btn-label')).toHaveText(event.title);
        await expect(page.locator('[data-archive-notice]')).toContainText('The selected event is archived.');
        const invalidCreate = await request.post(childCase.createPath, {
            form: {title: '', description: '', items: childCase.form.items, event_id: event.id}, maxRedirects: 0,
        });
        // Validation rerenders must carry the selected archived event and its notice through renderer
        // data just like the initial GET; optional request locals must not be required to reconstruct it.
        const validationPage = await invalidCreate.text();
        expect(validationPage).toContain('id="packingForm"');
        expect(validationPage).toContain('data-archive-notice');
        expect(validationPage).toContain('The selected event is archived.');

        // Surveys intentionally retain owner-only archival and have no automatic date schedule. Do not
        // infer the event's delegated-admin or date behavior simply because the API factory is shared.
        const survey = await createResourceViaForm(request, createE2ESurvey({title: 'Archival owner-only survey', form: {...createE2ESurvey().form, title: 'Archival owner-only survey'}}));
        expect((await guest.post(`/api/survey/${survey.id}/archive`, {data: {}})).status()).toBe(403);
        expect((await request.post(`/api/survey/${survey.id}/archive`, {data: {}})).ok()).toBe(true);
        expect((await request.post(`/api/survey/${survey.id}/restore`, {data: {}})).ok()).toBe(true);
        expect((await request.post(`/api/survey/${survey.id}/archive/automation`, {data: {paused: false}})).status()).toBe(409);
    } finally {
        // Always release the isolated session contexts, including when a permission assertion fails.
        await guest.dispose();
        await anonymous.dispose();
    }
});
