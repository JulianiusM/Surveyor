import {expect, type APIRequestContext, type Locator, type Page, type Request, type TestInfo} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import type {components} from '../../src/types/api/v1';
import {createE2EDriversList} from '../factories/e2eCoreFactory';
import {createResourceViaForm, readVisiblePresentation, expectUsableFrontendLayout} from './e2eCoreKeywords';
import {createFrontendEventFixture, frontendEventHeaders} from './frontendEventE2EKeywords';
import {waitForFrontendHydration} from './frontendDynamicKeywords';

type SettingsSurface = 'General' | 'General with image controls' | 'Linked event' | 'Access' | 'Administrators' | 'Actions';
type Presentation = Awaited<ReturnType<typeof readVisiblePresentation>>;

/** Seed the persisted root and optional parent through current built commands. */
export async function createDriversSettingsFixture(page: Page, attached = false) {
    const event = await createFrontendEventFixture(page.request);
    const input = createE2EDriversList();
    input.title = input.form.title = `P3 settings ${randomUUID().slice(0, 8)}`;
    input.form.description = 'Airport pickup\nStation pickup';
    Object.assign(input.form, {'defaultPerms[public][0]': 'ACCESS_VIEW', 'defaultPerms[public][1]': 'ITEM_ADD'});
    if (attached) {
        input.createPath += '?eventId=' + event.id;
        Object.assign(input.form, {event_id: event.id});
    }
    return {event, resource: await createResourceViaForm(page.request, input)};
}

/** Open this actor's real settings after canonical document admission. Narrowly
 * delegated editors can omit title/actions; their caller supplies the field
 * whose independently authorized metadata read must have completed. */
export async function openDriversSettingsForE2E(page: Page, path: string, field = 'title'): Promise<Locator> {
    await page.goto(`${path}?locale=en`, {waitUntil: 'domcontentloaded'});
    await waitForFrontendHydration(page);
    const opener = page.getByRole('button', {name: 'Entity settings', exact: true});
    await opener.click();
    const dialog = page.getByRole('dialog', {name: 'Entity settings', exact: true});
    await expect(dialog.locator(`[name="${field}"]`)).toBeVisible();
    // Metadata and settings are independent reads. A title field alone must not
    // let the owner's screenshot race the still-loading permitted settings panels.
    if (field === 'title') await expect(dialog.getByRole('tab', {name: 'Actions', exact: true})).toBeVisible();
    return dialog;
}

/** Wait for the selected pane's actual controls and discovery. Both event
 * searches use the unique fixture title, preserving complete text/order/layout
 * comparison without unrelated first-page fixtures changing the result set. */
export async function selectDriversSettingsSurface(dialog: Locator, page: Page, surface: SettingsSurface,
    event: {id: string; title: string}): Promise<void> {
    const tab = surface.startsWith('General') ? 'General' : surface === 'Administrators' ? 'Access' : surface;
    await dialog.getByRole('tab', {name: tab, exact: true}).click();
    if (surface === 'General with image controls') {
        const disclosure = dialog.locator('summary').filter({hasText: /^Header image$/u});
        await disclosure.focus();
        await disclosure.press('Enter');
        await expect(dialog.locator('input[type="file"]')).toBeVisible();
    }
    if (surface === 'Linked event') {
        // The selected event can already appear in the unfiltered page. Wait
        // for this exact debounced search before checking its rendered result;
        // an old idle page is not readiness for the query just typed.
        const searchReply = page.waitForResponse(function matchEventSearch(response) {
            const url = new URL(response.url());
            return response.request().method() === 'GET' && url.searchParams.get('q') === event.title
                && url.pathname === '/api/v1/drivers-lists/events';
        });
        await dialog.getByLabel('Search events', {exact: true}).fill(event.title);
        const searched = await searchReply;
        expect(searched.status()).toBe(200);
        await searched.finished();
        await expect(dialog.locator(`button[data-event-id="${event.id}"]`)).toHaveCount(1);
        // A result from the preceding page is not completed search evidence.
        await expect(dialog.getByRole('list', {name: 'Available events', exact: true})).toHaveAttribute('aria-busy', 'false');
        await expect(dialog.locator('.entity-picker-content')).toContainText('Page 1');
    }
    if (surface === 'Access') await expect(dialog.locator('.perm-matrix input[type="checkbox"]').first()).toBeVisible();
    if (surface === 'Administrators') {
        await dialog.getByRole('tab', {name: 'Administrators', exact: true}).click();
        await expect(dialog.getByText('No administrators yet.', {exact: true})).toBeVisible();
    }
    if (surface === 'Actions') await expect(dialog.getByRole('button', {name: 'Archive for everyone', exact: true})).toBeVisible();

    // Settle fonts and focus without modifying application data or styles.
    await expectUsableFrontendLayout(dialog);
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(function releaseFocus() {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    });
    await page.mouse.move(0, 0);
}

/** Preserve screenshots and raw content/style/geometry before assertion. The
 * standard comparator remains authoritative; evidence is not rewritten to hide
 * failed comparisons or unapproved differences. */
export async function captureDriversSettingsPresentation(page: Page, info: TestInfo, name: string, dialog: Locator): Promise<Presentation> {
    const screenshot = info.outputPath(name + '.png');
    await page.screenshot({path: screenshot, animations: 'disabled'});
    await info.attach(name, {path: screenshot, contentType: 'image/png'});
    const result = await readVisiblePresentation(dialog, ['h2', 'h3', 'h5', 'p', 'summary', 'label',
        'input:not([type="hidden"])', 'textarea', 'select', 'button', 'a', 'legend']);
    await writeFile(info.outputPath(name + '-presentation.json'), JSON.stringify(result, null, 2));
    await info.attach(name + '-presentation', {body: JSON.stringify(result, null, 2), contentType: 'application/json'});
    return result;
}

/** Read admitted settings through the real versioned boundary for persistence
 * assertions. It returns no ORM entity and cannot bypass feature admission. */
export async function readDriversSettingsForE2E(request: APIRequestContext, id: string): Promise<components['schemas']['DriversSettings']> {
    const response = await request.get(`/api/v1/drivers-lists/${id}/settings`, {headers: await frontendEventHeaders(request)});
    expect(response.status()).toBe(200);
    return response.json() as Promise<components['schemas']['DriversSettings']>;
}

/** Exercise one explicit account-profile grant through discovery and the real
 * Drivers settings controls. The caller owns the isolated target's lifetime;
 * username selection is never assumed to identify the acting profile or every
 * profile of a shared account. Every write verifies its exact persisted target. */
export async function exerciseDriversAdministratorForE2E(page: Page, id: string,
    target: {username: string; profileId: string}): Promise<void> {
    const dialog = page.getByRole('dialog', {name: 'Entity settings', exact: true});
    await dialog.getByRole('tab', {name: 'Administrators', exact: true}).click();
    await dialog.getByRole('button', {name: 'Add', exact: true}).click();
    const add = dialog.locator('[data-entity-section="administrator-add"]');

    // An isolated account has exactly one returned profile. Retain that strong
    // assertion rather than accepting whichever duplicate username appears first.
    await add.locator('#profile-search').fill(target.username);
    await expect(add.locator(`datalist option[value="${target.username}"]`)).toHaveCount(1);
    await add.locator('#initial-preset').selectOption({index: 1});
    const selectedPreset = await add.locator('#initial-preset').inputValue();
    const baseline = await readDriversSettingsForE2E(page.request, id);
    const preset = baseline.access!.presets.find(value => value.key === selectedPreset);
    expect(preset).toBeDefined();
    expect(preset!.mask).toBeGreaterThan(0);

    await observeDriversSettingsCommand(page, id, '/admins', 'POST', async function addAdministrator() {
        await add.getByRole('button', {name: 'Add', exact: true}).click();
    });
    expect((await readDriversSettingsForE2E(page.request, id)).access!.admins).toEqual([
        expect.objectContaining({profileId: target.profileId, mask: preset!.mask}),
    ]);

    // A stored zero remains a real grant for this same profile; removal is a
    // separate deliberately confirmed operation, not an implicit zero-mask delete.
    const admin = dialog.locator('[data-entity-section="administrator"]');
    await admin.locator('.accordion-button').click();
    await admin.getByRole('button', {name: 'None', exact: true}).click();
    await observeDriversSettingsCommand(page, id, `/admins/${target.profileId}`, 'PATCH', async function saveZeroGrant() {
        await admin.getByRole('button', {name: 'Save', exact: true}).click();
    });
    expect((await readDriversSettingsForE2E(page.request, id)).access!.admins).toEqual([
        expect.objectContaining({profileId: target.profileId, mask: 0}),
    ]);
    await observeDriversSettingsCommand(page, id, `/admins/${target.profileId}`, 'DELETE', async function removeAdministrator() {
        await admin.getByRole('button', {name: 'Remove', exact: true}).click();
    });
    expect((await readDriversSettingsForE2E(page.request, id)).access!.admins).toHaveLength(0);
}

/** Observe the generated command and a subsequent admitted settings read. Actions
 * execute once through the UI; there is no interception, substituted response
 * or automatic replay to manufacture a successful integrated workflow. */
export async function observeDriversSettingsCommand(page: Page, id: string, suffix: string, method: string,
    act: () => Promise<unknown>): Promise<void> {
    const path = `/api/v1/drivers-lists/${id}${suffix}`;
    const settingsPath = `/api/v1/drivers-lists/${id}/settings`;
    const subsequentReads = new WeakSet<Request>();
    let commandDelivered = false;
    page.on('request', observeSettingsRead);
    const reply = page.waitForResponse(function matchCommand(response) {
        const matches = response.request().method() === method && new URL(response.url()).pathname === path;
        if (matches) commandDelivered = true;
        return matches;
    });
    const refreshed = page.waitForResponse(function matchSettings(response) {
        return subsequentReads.has(response.request());
    });
    try {
        await act();
        expect((await reply).status()).toBe(200);
        expect((await refreshed).status()).toBe(200);
    } finally {
        page.off('request', observeSettingsRead);
    }

    /** An already-running poll cannot establish a read after command delivery.
     * Persistent-result assertions in the scenario independently verify effects. */
    function observeSettingsRead(request: Request): void {
        if (commandDelivered && request.method() === 'GET' && new URL(request.url()).pathname === settingsPath) {
            subsequentReads.add(request);
        }
    }
}
