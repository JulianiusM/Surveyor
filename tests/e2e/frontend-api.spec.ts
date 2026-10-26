import {expect, test, type APIRequestContext, type APIResponse} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import type {components} from '../../src/types/api/v1';
import type {FrontendBootstrap} from '../../src/types/FrontendTypes';
import {createE2EEvent, createE2ELogin, createE2EPackingList} from '../factories/e2eCoreFactory';
import {addEntityAdministratorForE2E, commandHeadersForE2E, createProfileForE2E, createResourceViaForm,
    entitySettingsHeadersForE2E, loginForE2E, registerGuestForE2E, selectProfileForE2E, updateEntityAdministratorForE2E,
    updateEntityDefaultKeysForE2E, updateEntityDefaultsForE2E, updateEntityEventForE2E, updateEntityMetadataForE2E} from '../keywords/e2eCoreKeywords';
import {PERM} from '../../src/backend/modules/lib/permissions';
import {waitForFrontendHydration} from '../keywords/frontendDynamicKeywords';
import {apiCompatibility} from '../../.generated/api/v1/policy.mjs';

/** Exercise cookie/session admission through the built application, without a test-only identity shortcut. */
async function bootstrap(request: APIRequestContext): Promise<components['schemas']['SessionView']> {
    const response = await request.get('/api/v1/session');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('application/json');
    expect(response.headers()['cache-control']).toContain('no-store');
    const body = await response.json() as components['schemas']['SessionView'];
    if (body.context === null) {
        expect(body.kind).toBe('anonymous');
        expect(body.csrfToken).toBeNull();
    } else {
        expect(body.context).toBeTruthy();
        expect(body.csrfToken).toBeTruthy();
    }
    expect(response.headers()['x-surveyor-context']).toBe(body.context ?? undefined);
    return body;
}

/** Reproduce browser mutation protections while preserving absent initial session evidence. */
function headersFor(session: components['schemas']['SessionView']): Record<string, string> {
    const baseUrl = test.info().project.use.baseURL;
    if (!baseUrl) throw new Error('The built API fixture requires its configured application origin.');
    // Sessionless requests use the same origin/custom-header protections as the
    // client. Only actual stored evidence becomes context/CSRF request headers.
    return {Origin: new URL(baseUrl).origin, 'X-Surveyor-Api-Compatibility': apiCompatibility,
        ...(session.context === null ? {} : {'X-Surveyor-Context': session.context, 'X-CSRF-Token': session.csrfToken})};
}

/** Run inside the browser against detached response documents. The native alert
 * is the wording oracle, so localized frontend tests cannot silently bless an English
 * paraphrase, capitalization change or additional punctuation on an admission page. */
function readAdmissionMessages(documents: readonly string[]): (string | null)[] {
    const messages: (string | null)[] = [];
    for (const html of documents) {
        const document = new DOMParser().parseFromString(html, 'text/html');
        messages.push(document.querySelector('main .alert-danger[role="alert"]')?.textContent?.trim() ?? null);
    }
    return messages;
}

/** Submit the same public view/assignment checkbox as the normal creation form. */
async function createApiPackingList(request: APIRequestContext) {
    const input = createE2EPackingList();
    Object.assign(input.form, {'defaultPerms[public][0]': 'ACCESS_VIEW'});
    return createResourceViaForm(request, input);
}

async function expectProblem(response: APIResponse, status: number, code: string): Promise<void> {
    expect(response.status()).toBe(status);
    expect(response.headers()['content-type']).toContain('application/problem+json');
    expect(response.headers().location).toBeUndefined();
    expect(response.headers()['cache-control']).toContain('no-store');
    expect(await response.json()).toMatchObject({status, code, requestId: expect.any(String), messageKey: expect.any(String)});
}

/** Inspect the actual document projection rather than manufacturing a successful
 * creation bootstrap. Browser hydration is asserted separately in the same journey. */
function frontendDocumentState(html: string): FrontendBootstrap {
    const serialized = html.match(/<script id="surveyor-frontend-state" type="application\/json">([^<]+)<\/script>/u)?.[1];
    expect(serialized).toBeTruthy();
    return JSON.parse(serialized!) as FrontendBootstrap;
}

/** Compare the real document and API boundaries after serialized login/profile/guest transitions.
 * Rich controller fixtures cannot prove that inverse owner relations survive session storage. */
async function expectDuplicateEntry(request: APIRequestContext, id: string, title: string, allowed: boolean): Promise<void> {
    const current = await bootstrap(request);
    const document = await request.get(`/packing/${id}/duplicate?locale=en`, {maxRedirects: 0});
    const api = await request.get(`/api/v1/packing-lists/${id}/duplicate`, {headers: headersFor(current)});
    const status = allowed ? 200 : 403;
    expect(document.status()).toBe(status);
    expect(api.status()).toBe(status);
    expect(document.headers().location).toBeUndefined();
    const html = await document.text();
    if (allowed) {
        const projection = await api.json();
        expect(projection).toMatchObject({title});
        expect(Object.hasOwn(projection, 'selectedEvent')).toBe(false);
        expect(frontendDocumentState(html).packingDuplicate).toMatchObject({title});
        expect(html).not.toContain(`value="${title}"`);
    } else {
        await expectProblem(api, 403, 'FORBIDDEN');
        expect(html).not.toContain(`value="${title}"`);
        expect(html).toContain('>Not allowed<');
        expect(html).not.toContain('You do not have permission for this action.');
    }
}

test('preserves canonical packing HTML 404s, standalone guest entry and public duplicate GET admission', async ({page, browser, baseURL}) => {
    await loginForE2E(page.request, createE2ELogin());
    const input = createE2EPackingList();
    Object.assign(input.form, {'defaultPerms[public][0]': 'DATA_DUPLICATE'});
    const list = await createResourceViaForm(page.request, input);
    const anonymousContext = await browser.newContext({baseURL});
    try {
        const request = anonymousContext.request;
        for (const id of ['not-a-uuid', randomUUID()]) {
            for (const suffix of ['', '/guest', '/duplicate']) {
                const native = await request.get(`/packing/${id}${suffix}`, {maxRedirects: 0});
                const frontend = await request.get(`/packing/${id}${suffix}?locale=de`, {maxRedirects: 0});
                const english = await request.get(`/packing/${id}${suffix}?locale=en`, {maxRedirects: 0});
                expect(native.status()).toBe(404);
                expect(frontend.status()).toBe(native.status());
                expect(english.status()).toBe(native.status());
                const messages = await page.evaluate(readAdmissionMessages, [await native.text(), await english.text()]);
                expect(messages[0]).toBeTruthy();
                expect(messages[1]).toBe(messages[0]);
                expect(frontend.headers()['content-type']).toContain('text/html');
                const html = await frontend.text();
                expect(html).toContain('Packliste nicht gefunden.');
                expect(html).toContain('class="card-header text-center bg-dark text-light"');
                // Check the error card's actual Home action, rather than a shell
                // navigation link that happens to reach the same overview URL.
                expect(html).toMatch(/<a\b(?=[^>]*class="btn btn-primary")(?=[^>]*href="\/")[^>]*>/);
            }
        }
        const create = await request.get('/packing/create?locale=de', {maxRedirects: 0});
        expect(create.status()).toBe(302);
        expect(create.headers().location).toContain('/users/login?');
        expect(create.headers().location).toContain('locale=de');
        const nativeDetail = await request.get(list.path, {maxRedirects: 0});
        const detail = await request.get(`/packing/${list.id}?locale=de`, {maxRedirects: 0});
        expect(detail.status()).toBe(nativeDetail.status());
        expect(detail.headers().location).toBe(`/packing/${list.id}/guest?locale=de`);
        const guestPage = await request.get(detail.headers().location!);
        const guestHtml = await guestPage.text();
        expect(guestHtml).toContain(list.title);
        expect(guestHtml).not.toContain('Two person tent');
        expect(guestHtml).toContain('data-frontend-initial-loading');
        expect(guestHtml).not.toContain('id="guest-name"');

        // DATA_DUPLICATE is a separate GET grant: public readers need neither a
        // profile nor detail admission, while creation remains account-only.
        const nativeDuplicate = await request.get(`${list.path}/duplicate`);
        const duplicate = await request.get(`/packing/${list.id}/duplicate?locale=de`);
        expect(duplicate.status()).toBe(nativeDuplicate.status());
        expect(duplicate.status()).toBe(200);
        const duplicateHtml = await duplicate.text();
        expect(frontendDocumentState(duplicateHtml).packingDuplicate).toMatchObject({title: list.title});
        expect(duplicateHtml).not.toContain('id="create-title"');
        expect(duplicateHtml).toContain('Two person tent');
        expect(duplicateHtml).toContain('Interaktive Funktionen dieser Website benötigen JavaScript.');
        expect(duplicateHtml).toContain('id="surveyor-frontend-javascript-required"');
        const anonymous = await bootstrap(request);
        expect((await request.get(`/api/v1/packing-lists/${list.id}/duplicate`, {headers: headersFor(anonymous)})).status()).toBe(200);
        const detailEntry = await request.get(`/api/v1/packing-lists/${list.id}/entry?view=detail`, {headers: headersFor(anonymous)});
        expect(await detailEntry.json()).toEqual({entry: {kind: 'redirect', url: `/packing/${list.id}/guest`, notice: null}, guest: null});
        const guestEntry = await request.get(`/api/v1/packing-lists/${list.id}/entry?view=guest`, {headers: headersFor(anonymous)});
        expect(await guestEntry.json()).toEqual({entry: {kind: 'render'}, guest: {id: list.id, title: list.title}});
        const duplicateReturn = `/packing/${list.id}/duplicate?locale=de`;
        const createEntry = await request.get('/api/v1/packing-lists/create-entry', {
            headers: headersFor(anonymous), params: {returnTo: duplicateReturn},
        });
        expect(await createEntry.json()).toEqual({entry: {kind: 'redirect',
            url: `/users/login?next=${encodeURIComponent(duplicateReturn)}`,
            notice: {kind: 'info', messageKey: 'auth.accountRequired'}}, context: null});
        await expectProblem(await request.get('/api/v1/packing-lists/create-context', {headers: headersFor(anonymous)}), 401, 'AUTH_REQUIRED');
        const ownerGuest = await page.request.get(`/packing/${list.id}/guest?locale=en`, {maxRedirects: 0});
        expect(ownerGuest.status()).toBe(302);
        expect(ownerGuest.headers().location).toBe(`/packing/${list.id}?locale=en`);
        expect((await page.request.get('/packing/create')).status()).toBe(200);
    } finally {
        await anonymousContext.close();
    }
});

test('creation and duplicate entries drop missing or forbidden initial events before standalone submission', async ({page}) => {
    await loginForE2E(page.request, createE2ELogin());
    const event = await createResourceViaForm(page.request, createE2EEvent());
    const input = createE2EPackingList();
    Object.assign(input.form, {'defaultPerms[public][0]': 'DATA_DUPLICATE'});
    const list = await createResourceViaForm(page.request, input);

    /** Both document adapters and the authored API read must seed the same admitted
     * event. The duplicate source's own membership is never a destination default. */
    async function expectSelection(eventId: string, expectedId: string | null): Promise<void> {
        const current = await bootstrap(page.request);
        for (const duplicate of [false, true]) {
            const path = duplicate ? `/packing/${list.id}/duplicate` : '/packing/create';
            const frontend = await page.request.get(`${path}?eventId=${eventId}&locale=en`);
            expect(frontend.status()).toBe(200);
            const state = frontendDocumentState(await frontend.text());
            const selection = duplicate ? state.packingDuplicate?.selectedEvent : state.packingSelectedEvent;
            expect(selection?.id ?? null).toBe(expectedId);
            const apiPath = duplicate ? `/api/v1/packing-lists/${list.id}/duplicate` : '/api/v1/packing-lists/create-entry';
            const api = await page.request.get(apiPath, {headers: headersFor(current), params: {eventId}});
            expect(api.status()).toBe(200);
            expect((await api.json()).selectedEvent?.id ?? null).toBe(expectedId);
        }
    }

    await expectSelection(event.id, event.id);
    // A different active profile has no attachment grant to the first profile's
    // event. Public duplication of the source remains independently permitted.
    const profileName = `Selection ${randomUUID().slice(0, 8)}`;
    await createProfileForE2E(page.request, profileName);
    const profiles = await bootstrap(page.request);
    const profile = profiles.profiles.find(candidate => candidate.name === profileName)!;
    expect(profile).toBeTruthy();
    await selectProfileForE2E(page.request, profile.id);
    await expectSelection(event.id, null);
    await expectSelection(randomUUID(), null);

    const current = await bootstrap(page.request);

    await page.goto(`/packing/create?eventId=${event.id}&locale=en`);
    await waitForFrontendHydration(page);
    await expect(page.locator('#frontend-locale')).toBeEnabled();
    await expect(page.locator('#create-event-button')).toHaveText('No event');
    await page.locator('#create-title').fill(`Frontend standalone ${randomUUID().slice(0, 8)}`);
    await page.locator('tbody tr').first().locator('input').first().fill('Tent');
    const submitted = page.waitForResponse(response => response.request().method() === 'POST'
        && new URL(response.url()).pathname === '/api/v1/packing-lists');
    await page.getByRole('button', {name: 'Create list', exact: true}).click();
    const created = await submitted;
    expect(created.status()).toBe(201);
    const frontendId = (await created.json()).id as string;
    const frontendView = await page.request.get(`/api/v1/packing-lists/${frontendId}`, {headers: headersFor(current)});
    expect((await frontendView.json()).currentEventId).toBeNull();
});

test('uses one duplicate admission for serialized account login, profile switch, guest return and anonymous audience grants', async ({request, browser, baseURL}) => {
    await loginForE2E(request, createE2ELogin());
    const suffix = randomUUID().slice(0, 8);
    const ownerName = `Audience owner ${suffix}`;
    await createProfileForE2E(request, ownerName);
    const ownerSession = await bootstrap(request);
    const ownerProfile = ownerSession.profiles.find(profile => profile.name === ownerName)!;
    expect(ownerProfile).toBeTruthy();
    await selectProfileForE2E(request, ownerProfile.id);
    const input = createE2EPackingList();
    input.form.title = `Audience-only duplicate ${suffix}`;
    const list = await createResourceViaForm(request, input);

    const accountLogin = await browser.newContext({baseURL});
    const accountSwitch = await browser.newContext({baseURL});
    const guestReturn = await browser.newContext({baseURL});
    const anonymous = await browser.newContext({baseURL});
    try {
        // Neither account reader owns this list: ordinary login selects the seeded
        // default profile, and a native profile change reloads a distinct third profile.
        await loginForE2E(accountLogin.request, createE2ELogin());
        expect((await bootstrap(accountLogin.request)).activeProfile!.id).not.toBe(ownerProfile.id);
        await loginForE2E(accountSwitch.request, createE2ELogin());
        const readerName = `Audience reader ${suffix}`;
        await createProfileForE2E(accountSwitch.request, readerName);
        const reader = (await bootstrap(accountSwitch.request)).profiles.find(profile => profile.name === readerName)!;
        await selectProfileForE2E(accountSwitch.request, reader.id);

        // The emailed capability path reloads a stored guest profile without relying
        // on the richer object returned during initial registration. No mailbox is used.
        const beforeGuest = await bootstrap(guestReturn.request);
        const registered = await guestReturn.request.post(`/api/v1/packing-lists/${list.id}/guest`, {
            headers: {...headersFor(beforeGuest), 'X-Surveyor-Api-Compatibility': beforeGuest.deployment.apiCompatibility},
            data: {username: `Audience guest ${suffix}`, email: null},
        });
        expect(registered.status()).toBe(200);
        const guestIdentity = await registered.json() as components['schemas']['IdentityResult'];
        expect(guestIdentity.personalLink).toBeTruthy();
        await guestReturn.clearCookies();
        const personal = new URL(guestIdentity.personalLink!, baseURL);
        expect((await guestReturn.request.get(personal.pathname + personal.search, {maxRedirects: 0})).status()).toBe(302);

        for (const audience of ['authenticated', 'guest', 'public', 'none'] as const) {
            const defaults: Record<string, string[]> = {public: [], guest: [], authenticated: [], participant: []};
            if (audience !== 'none') defaults[audience] = ['DATA_DUPLICATE'];
            await updateEntityDefaultKeysForE2E(request, 'packing-lists', list.id, defaults);

            await expectDuplicateEntry(accountLogin.request, list.id, input.form.title, audience !== 'none');
            await expectDuplicateEntry(accountSwitch.request, list.id, input.form.title, audience !== 'none');
            await expectDuplicateEntry(guestReturn.request, list.id, input.form.title, audience === 'guest' || audience === 'public');
            await expectDuplicateEntry(anonymous.request, list.id, input.form.title, audience === 'public');
        }
    } finally {
        await accountLogin.close();
        await accountSwitch.close();
        await guestReturn.close();
        await anonymous.close();
    }
});

test('preserves attached packing HTML membership and explicit view alternatives independently of duplicate grants', async ({page, browser, baseURL}) => {
    await loginForE2E(page.request, createE2ELogin());
    const list = await createApiPackingList(page.request);
    const event = await createResourceViaForm(page.request, createE2EEvent());
    const guestContext = await browser.newContext({baseURL});
    try {
        await registerGuestForE2E(guestContext.request, 'packing-lists', list.id, {username: `HTML guest ${randomUUID().slice(0, 8)}`, email: null});
        const guest = await bootstrap(guestContext.request);
        await updateEntityEventForE2E(page.request, 'packing-lists', list.id, {eventId: event.id, expectedEventId: null});
        await updateEntityDefaultKeysForE2E(page.request, 'packing-lists', list.id, {public: [], guest: [], authenticated: [], participant: []});
        const nativeDenied = await guestContext.request.get(list.path, {maxRedirects: 0});
        const frontendDenied = await guestContext.request.get(`/packing/${list.id}?locale=de`, {maxRedirects: 0});
        const englishDenied = await guestContext.request.get(`/packing/${list.id}?locale=en`, {maxRedirects: 0});
        expect(nativeDenied.status()).toBe(400);
        expect(frontendDenied.status()).toBe(nativeDenied.status());
        expect(englishDenied.status()).toBe(nativeDenied.status());
        const messages = await page.evaluate(readAdmissionMessages, [await nativeDenied.text(), await englishDenied.text()]);
        expect(messages[0]).toBeTruthy();
        expect(messages[1]).toBe(messages[0]);
        const deniedHtml = await frontendDenied.text();
        expect(deniedHtml).toContain('Du musst für die Veranstaltung angemeldet sein');
        expect(deniedHtml).not.toContain(list.title);
        expect(deniedHtml).not.toContain('Two person tent');
        const entryPath = `/api/v1/packing-lists/${list.id}/entry?view=detail`;
        expect(await (await guestContext.request.get(entryPath, {headers: headersFor(guest)})).json())
            .toEqual({entry: {kind: 'denied', status: 400, messageKey: 'packing.eventRegistrationRequired'}, guest: null});
        // The event owner counts as an event participant under the native admission owner.
        expect((await page.request.get(`/packing/${list.id}`)).status()).toBe(200);
        await addEntityAdministratorForE2E(page.request, 'packing-lists', list.id, guest.activeProfile!.id, PERM.ACCESS_VIEW);
        expect((await guestContext.request.get(`/packing/${list.id}`)).status()).toBe(200);
        expect(await (await guestContext.request.get(entryPath, {headers: headersFor(guest)})).json())
            .toEqual({entry: {kind: 'render'}, guest: null});
        await updateEntityAdministratorForE2E(page.request, 'packing-lists', list.id, guest.activeProfile!.id, PERM.DATA_DUPLICATE);
        expect((await guestContext.request.get(`/packing/${list.id}`)).status()).toBe(400);
        expect((await guestContext.request.get(`${list.path}/duplicate`)).status()).toBe(200);
        expect((await guestContext.request.get(`/packing/${list.id}/duplicate`)).status()).toBe(200);
        expect((await guestContext.request.get(`/api/v1/packing-lists/${list.id}/duplicate`, {headers: headersFor(guest)})).status()).toBe(200);
        const create = await guestContext.request.get('/packing/create', {maxRedirects: 0});
        expect(create.status()).toBe(302);
        const creation = {title: 'Guest copy', description: null, eventId: null,
            defaultPermissions: {public: 0, guest: 0, authenticated: 0, participant: 0},
            items: [{title: 'Tent', description: null, maxAssignees: 1, requiredByAll: false}]};
        await expectProblem(await guestContext.request.post('/api/v1/packing-lists', {
            headers: {...headersFor(guest), 'X-Surveyor-Api-Compatibility': guest.deployment.apiCompatibility}, data: creation,
        }), 403, 'FORBIDDEN');
    } finally {
        await guestContext.close();
    }
});

test('keeps exact duplicate destinations including query context through account-only submission', async ({request, browser, baseURL}) => {
    await loginForE2E(request, createE2ELogin());
    const input = createE2EPackingList();
    Object.assign(input.form, {'defaultPerms[public][0]': 'DATA_DUPLICATE'});
    const list = await createResourceViaForm(request, input);
    const event = await createResourceViaForm(request, createE2EEvent());
    const anonymous = await browser.newContext({baseURL});
    try {
        // A fresh anonymous SPA receives the same account decision; its exact frontend
        // source URL is bounded by the existing frontend return owner rather than inferred.
        await anonymous.clearCookies();
        const session = await bootstrap(anonymous.request);
        const frontendReturn = `/packing/${list.id}/duplicate?eventId=${event.id}&locale=de`;
        const entry = await anonymous.request.get('/api/v1/packing-lists/create-entry', {
            headers: headersFor(session), params: {returnTo: frontendReturn},
        });
        expect((await entry.json()).entry).toMatchObject({kind: 'redirect',
            url: `/users/login?next=${encodeURIComponent(frontendReturn)}`,
            notice: {kind: 'info', messageKey: 'auth.accountRequired'}});
        const forbidden = await anonymous.request.get('/api/v1/packing-lists/create-entry', {
            headers: headersFor(session), params: {returnTo: 'https://outside.invalid/duplicate'},
        });
        expect(new URL((await forbidden.json()).entry.url, baseURL).searchParams.get('next')).toBe('/users/dashboard');

        // Use the actual mounted identity owner: the declared API command
        // returns the prepared identity, and the client retains its exact next/notice.
        const identityPage = await anonymous.newPage();
        await identityPage.goto(`/users/login?next=${encodeURIComponent(frontendReturn)}&locale=de`);
        await waitForFrontendHydration(identityPage);
        const credentials = createE2ELogin();
        await identityPage.locator('#username').fill(credentials.username);
        await identityPage.locator('#password').fill(credentials.password);
        const signedIn = identityPage.waitForResponse(response => response.request().method() === 'POST'
            && new URL(response.url()).pathname === '/api/v1/auth/login');
        await identityPage.locator('#frontend-main form').first().locator('button[type="submit"]').click();
        const loginResponse = await signedIn;
        expect(loginResponse.status()).toBe(200);
        const loginResult = await loginResponse.json() as components['schemas']['IdentityResult'];
        expect(loginResult.session.locale).toBe(loginResponse.request().headers()['x-surveyor-locale']);
        await expect(identityPage).toHaveURL(new URL(frontendReturn, baseURL).href);

        // The command receipt uses its explicit presentation header. Identity
        // adoption then reads the authoritative cookie session without an old
        // locale header, so that read owns the settled notice's selected language.
        const loggedIn = await bootstrap(anonymous.request);
        expect(loggedIn).toMatchObject({kind: 'account', context: loginResult.session.context, locale: 'en'});
        await expect(identityPage.locator('#frontend-locale')).toHaveValue(loggedIn.locale);
        await expect(identityPage.getByText('Login successful', {exact: true})).toBeVisible();
        await identityPage.locator('#frontend-locale').selectOption('de');
        await expect(identityPage.getByText('Erfolgreich angemeldet.', {exact: true})).toBeVisible();
        await identityPage.locator('#frontend-locale').selectOption('en');
        await expect(identityPage.getByText('Login successful', {exact: true})).toBeVisible();

        const logoutReturn = '/help?doc=packing_lists&locale=en';
        await identityPage.goto(logoutReturn);
        await waitForFrontendHydration(identityPage);
        await identityPage.locator('header .dropdown-toggle').filter({hasText: loggedIn.activeProfile!.name}).click();
        const loggedOut = identityPage.waitForResponse(response => response.request().method() === 'POST'
            && new URL(response.url()).pathname === '/api/v1/auth/logout');
        await identityPage.getByRole('button', {name: 'Logout', exact: true}).click();
        expect((await loggedOut).status()).toBe(200);
        await expect(identityPage).toHaveURL(new URL(logoutReturn, baseURL).href);
        await expect(identityPage.getByText('Logout successful', {exact: true})).toBeVisible();
        expect((await bootstrap(anonymous.request)).kind).toBe('anonymous');
    } finally {
        await anonymous.close();
    }
});

test('renders invalid guest capability links as 401 HTML with guest-specific wording', async ({page}) => {
    const id = randomUUID();
    const token = randomUUID();
    const native = await page.request.get(`/guest/${id}/login/${token}`, {maxRedirects: 0});
    const frontend = await page.request.get(`/guest/${id}/login/${token}?locale=en`, {maxRedirects: 0});
    expect(native.status()).toBe(401);
    expect(frontend.status()).toBe(native.status());
    expect(frontend.headers()['content-type']).toContain('text/html');
    const html = await frontend.text();
    expect(html).toContain('Invalid or mismatched token');
    expect(html).not.toContain('Your session has expired');
    expect(html).toContain('"pageEntry":{"kind":"denied","status":401,"messageKey":"auth.invalidGuestLink"}');
    await page.goto(`/guest/${id}/login/${token}?locale=en`);
    await waitForFrontendHydration(page);
    await expect(page.locator('#frontend-locale')).toBeEnabled();
    // A reactive locale change proves this is the hydrated error surface, not merely the
    // server's initial Error card before the production decoder and route owner run.
    await page.locator('#frontend-locale').selectOption('de');
    await expect(page.locator('#frontend-main h1')).toHaveText('Fehler');
    await expect(page.locator('#frontend-main')).toContainText('Ungültiger oder nicht passender Token');
    await expect(page.locator('#frontend-main form')).toHaveCount(0);
});

test('runs the expiry/logout document journey before invalid stored identity becomes an API problem', async ({request, browser, baseURL}) => {
    await loginForE2E(request, createE2ELogin());
    const original = await bootstrap(request);
    const profileName = `Expiry profile ${randomUUID().slice(0, 8)}`;
    await createProfileForE2E(request, profileName);
    const profile = (await bootstrap(request)).profiles.find(value => value.name === profileName)!;
    expect(profile).toBeTruthy();
    const documentContext = await browser.newContext({baseURL});
    const apiContext = await browser.newContext({baseURL});
    try {
        for (const request of [documentContext.request, apiContext.request]) {
            await loginForE2E(request, createE2ELogin());
            await selectProfileForE2E(request, profile.id);
            expect((await bootstrap(request)).activeProfile!.id).toBe(profile.id);
        }
        // Detach the profile through its real owner workflow while the two other
        // sessions retain the old serialized profile. No session fixture or DB mutation
        // bypasses middleware, persistence or the application's identity ownership check.
        await selectProfileForE2E(request, profile.id);
        expect((await request.post('/api/v1/profiles/current/deactivate', {headers: await commandHeadersForE2E(request), data: {name: profileName}})).status()).toBe(200);
        const expiredDocument = await documentContext.request.get('/help', {maxRedirects: 0});
        expect(expiredDocument.status()).toBe(302);
        expect(expiredDocument.headers()['content-type']).not.toContain('application/json');
        const expiryPage = await documentContext.request.get(expiredDocument.headers().location!);
        expect(expiryPage.headers()['content-type']).toContain('text/html');
        expect(await expiryPage.text()).toContain('Session has expired');
        expect((await bootstrap(documentContext.request)).kind).toBe('anonymous');
        await expectProblem(await apiContext.request.get('/api/v1/session'), 401, 'AUTH_REQUIRED');
        // API admission is read-only, including invalid stored identity. The
        // existing native logout owner deliberately clears it before reuse.
        await expectProblem(await apiContext.request.get('/api/v1/session'), 401, 'AUTH_REQUIRED');
        expect((await apiContext.request.get('/users/logout', {maxRedirects: 0})).status()).toBe(302);
        expect((await bootstrap(apiContext.request)).kind).toBe('anonymous');
    } finally {
        await documentContext.close();
        await apiContext.close();
        await selectProfileForE2E(request, original.activeProfile!.id);
    }
});

test('JavaScript-disabled interactive pages expose skeletons and notices while static Help navigation and GET search stay usable', async ({browser, baseURL}) => {
    const context = await browser.newContext({baseURL, javaScriptEnabled: false});
    try {
        await loginForE2E(context.request, createE2ELogin());
        const page = await context.newPage();
        for (const locale of ['en', 'de']) {
            await page.goto(`/packing/create?locale=${locale}`);
            await expect(page.locator('#surveyor-frontend-javascript-required')).toContainText(locale === 'de'
                ? 'Interaktive Funktionen dieser Website benötigen JavaScript.' : 'Interactive features on this site require JavaScript.');
            await expect(page.locator('[data-frontend-initial-loading]')).toBeHidden();
            await expect(page.locator('#create-title')).toHaveCount(0);
            await expect(page.locator('#frontend-locale')).toBeDisabled();
            await expect(page.locator('header button[type="submit"]')).toHaveCount(0);

            // This is real anchor navigation on the built application. Static Help
            // also submits its real GET form without a client-side API substitute.
            await page.locator('#surveyor-frontend-javascript-required').getByRole('link',
                {name: locale === 'de' ? 'Hilfe' : 'Help', exact: true}).click();
            await expect(page.locator('.help-content')).toBeVisible();
            const article = page.locator('main a[href*="doc="]').first();
            const target = new URL((await article.getAttribute('href'))!, baseURL);
            await article.click();
            await expect(page).toHaveURL(target.href);
            await expect(page.locator('.help-content')).toBeVisible();
            const query = `absent-${randomUUID()}`;
            await page.getByRole('searchbox').fill(query);
            await page.getByRole('button', {name: locale === 'de' ? 'Hilfe durchsuchen' : 'Search help', exact: true}).click();
            expect(new URL(page.url()).searchParams.get('q')).toBe(query);
            await expect(page.getByRole('searchbox')).toHaveValue(query);
            await expect(page.locator('#frontend-locale')).toBeDisabled();

            await page.goto(`/users/login?locale=${locale}`);
            await expect(page.locator('#surveyor-frontend-javascript-required')).toBeVisible();
            await expect(page.locator('[data-frontend-initial-loading]')).toBeHidden();
            await expect(page.locator('#frontend-main form')).toHaveCount(0);
        }
    } finally {
        await context.close();
    }
});

test('keeps saved Help path aliases authoritative alongside canonical query links', async ({request}) => {
    // Assert selection metadata rather than maintained guide wording. The real SSR
    // route must project the same search/article decision as the shared browser owner.
    const cases = [
        ['/help/search?doc=events', 'search', ''],
        ['/help/search?q=packing&doc=events', 'search', 'packing'],
        ['/help/packing_lists?q=ignored&doc=events', 'packing_lists', undefined],
        ['/help/readme?q=ignored&doc=events', 'readme', undefined],
        ['/help?q=packing&doc=events', 'search', 'packing'],
        ['/help?doc=packing_lists', 'packing_lists', undefined],
    ] as const;
    for (const [path, currentDoc, searchQuery] of cases) {
        const response = await request.get(path);
        expect(response.status()).toBe(200);
        const html = await response.text();
        const serialized = html.match(/<script id="surveyor-frontend-state" type="application\/json">([^<]+)<\/script>/u)?.[1];
        expect(serialized).toBeTruthy();
        const state = JSON.parse(serialized!) as {help: components['schemas']['HelpPageData']};
        expect(state.help.currentDoc).toBe(currentDoc);
        expect(state.help.searchQuery).toBe(searchQuery);
        expect(html).toContain(searchQuery === undefined ? 'card-body help-content' : 'card-body help-search-results');
    }

    // A nonexistent synthetic slug crosses the real controller/HTTP boundary without
    // depending on maintained guide prose. Native and frontend documents retain their
    // complete Error card, while the API reports its authored structured rejection.
    const missing = `missing-${randomUUID()}`;
    for (const path of [`/help/${missing}`, `/help/${missing}`, `/help?doc=${missing}`]) {
        const response = await request.get(path);
        expect(response.status()).toBe(404);
        expect(response.headers()['content-type']).toContain('text/html');
        const html = await response.text();
        expect(html).toContain('card-header text-center bg-dark text-light');
        expect(html).not.toContain('card-body help-content');
    }
    const current = await bootstrap(request);
    await expectProblem(await request.get('/api/v1/help', {params: {doc: missing}, headers: headersFor(current)}), 404, 'NOT_FOUND');
});

test('keeps initial public documents and API reads free of anonymous session cookies', async ({request, browser, baseURL}) => {
    await loginForE2E(request, createE2ELogin());
    const list = await createApiPackingList(request);
    const visitor = await browser.newContext({baseURL});
    try {
        // These are the real built routes and database-backed public grants. No
        // intercepted bootstrap, prepared session row or native render precedes them.
        expect((await visitor.storageState()).cookies).toEqual([]);
        const initial = await bootstrap(visitor.request);
        expect(initial).toMatchObject({kind: 'anonymous', context: null, csrfToken: null});
        for (const path of ['/api/v1/session', '/api/v1/help', `/api/v1/packing-lists/${list.id}/guest`,
            '/', '/help', `/packing/${list.id}/guest`]) {
            const result = await visitor.request.get(path, {maxRedirects: 0});
            expect(result.status(), path).toBe(200);
            expect(result.headers()['set-cookie'], path).toBeUndefined();
            expect(result.headers()['x-surveyor-context'], path).toBeUndefined();
            if (!path.startsWith('/api/')) {
                expect(frontendDocumentState(await result.text()).session).toMatchObject({
                    kind: 'anonymous', context: null, csrfToken: null,
                });
            }
        }
        expect((await visitor.storageState()).cookies).toEqual([]);
        expect(await bootstrap(visitor.request)).toMatchObject({kind: 'anonymous', context: null, csrfToken: null});
        expect((await visitor.storageState()).cookies).toEqual([]);
    } finally { await visitor.close(); }
});

test('bootstraps account and guest scopes while projecting only public session and packing fields', async ({request, browser, baseURL}) => {
    await loginForE2E(request, createE2ELogin());
    const list = await createApiPackingList(request);
    const account = await bootstrap(request);
    expect(account.kind).toBe('account');
    expect(account.activeProfile).toEqual({id: expect.any(String), name: expect.any(String)});
    expect(Object.keys(account).sort()).toEqual(['activeProfile', 'context', 'csrfToken', 'deployment', 'kind', 'locale', 'loginUrl', 'logoutUrl', 'profiles', 'shell']);
    expect(account.deployment).toEqual({buildId: expect.any(String), apiCompatibility: expect.any(String)});
    expect(Object.keys(account.shell).sort()).toEqual(['imprintUrl', 'localLoginEnabled', 'oidcEnabled', 'oidcName', 'privacyPolicyUrl', 'version']);
    for (const profile of account.profiles) expect(Object.keys(profile).sort()).toEqual(['id', 'name']);
    await expectProblem(await request.get(`/api/v1/packing-lists/${list.id}`), 400, 'CONTEXT_REQUIRED');

    const guestContext = await browser.newContext({baseURL});
    try {
        const anonymous = await bootstrap(guestContext.request);
        const guestName = `API guest ${randomUUID().slice(0, 8)}`;
        await registerGuestForE2E(guestContext.request, 'packing-lists', list.id, {username: guestName, email: null});
        const guest = await bootstrap(guestContext.request);
        expect(guest).toMatchObject({kind: 'guest', activeProfile: {name: guestName}});
        expect(guest.context).not.toBe(anonymous.context);
        expect(guest.csrfToken).not.toBe(anonymous.csrfToken);
        expect(guest.profiles).toEqual([guest.activeProfile]);
        for (const hidden of ['email', 'username', 'password', 'token', 'userId', 'guestId']) {
            expect(Object.hasOwn(guest, hidden)).toBe(false);
            expect(Object.hasOwn(guest.activeProfile!, hidden)).toBe(false);
        }
        const response = await guestContext.request.get(`/api/v1/packing-lists/${list.id}`, {headers: headersFor(guest)});
        expect(response.status()).toBe(200);
        expect(response.headers()['x-surveyor-context']).toBe(guest.context);
        const body = await response.json();
        expect(body).toMatchObject({id: list.id, capabilities: {editTitle: false, editDescription: false, selfAssign: true}});
        expect(body.items).toHaveLength(1);
        const serialized = JSON.stringify(body);
        for (const hidden of ['ownerId', 'profileId', 'userId', 'guestId', 'metadataRevision', 'headerImg', 'email']) {
            expect(serialized).not.toContain(`"${hidden}"`);
        }
        const metadata = await guestContext.request.get(`/api/v1/packing-lists/${list.id}/metadata`, {headers: headersFor(guest)});
        expect(await metadata.json()).toMatchObject({values: {}, editableFields: []});
        await expectProblem(await guestContext.request.patch(`/api/v1/packing-lists/${list.id}/metadata`, {
            headers: {...headersFor(guest), 'If-Match': metadata.headers().etag}, data: {title: 'Forged title'},
        }), 403, 'FORBIDDEN');
    } finally {
        await guestContext.close();
    }
});

test('enforces CSRF, media types, UUIDs and closed payloads before a conditional metadata save', async ({request}) => {
    await loginForE2E(request, createE2ELogin());
    const list = await createApiPackingList(request);
    const session = await bootstrap(request);
    const headers = headersFor(session);
    const path = `/api/v1/packing-lists/${list.id}/metadata`;
    const baseline = await request.get(path, {headers});
    expect(baseline.status()).toBe(200);
    const tag = baseline.headers().etag;
    expect(tag).toMatch(/^"edit-[A-Za-z0-9_-]+"$/);
    const conditionalHeaders = {...headers, 'If-None-Match': tag};
    expect((await request.get(path, {headers: conditionalHeaders})).status()).toBe(304);
    await expectProblem(await request.get(path, {
        headers: {...headers, 'If-None-Match': 'a'.repeat(4097)},
    }), 400, 'VALIDATION_FAILED');
    const patchHeaders = {...headers, 'If-Match': tag};
    const missingCsrf = headersFor(session);
    delete missingCsrf['X-CSRF-Token'];
    await expectProblem(await request.patch(path, {headers: missingCsrf, data: {title: 'No CSRF'}}), 403, 'CSRF_INVALID');
    await expectProblem(await request.patch(path, {headers: {...patchHeaders, Origin: 'https://other.example'}, data: {title: 'Foreign origin'}}), 403, 'CSRF_INVALID');
    await expectProblem(await request.patch(path, {headers: {...patchHeaders, 'Sec-Fetch-Site': 'cross-site'}, data: {title: 'Cross site'}}), 403, 'CSRF_INVALID');
    await expectProblem(await request.get('/api/v1/packing-lists/not-a-uuid', {headers}), 400, 'VALIDATION_FAILED');
    await expectProblem(await request.patch(path, {headers: patchHeaders, data: {title: false}}), 400, 'VALIDATION_FAILED');
    await expectProblem(await request.patch(path, {headers: patchHeaders, data: {title: 'Forged', profileId: session.activeProfile!.id}}), 400, 'VALIDATION_FAILED');
    await expectProblem(await request.patch(path, {headers: patchHeaders, form: {title: 'Wrong media'}}), 415, 'UNSUPPORTED_MEDIA_TYPE');
    await expectProblem(await request.patch(path, {headers: {...patchHeaders, 'Content-Type': 'application/json'}, data: '{invalid'}), 400, 'INVALID_JSON');

    // The two HTTP generations share normalization and authored constraints, while the
    // original native envelope keeps its precise field diagnostics. Literal oracles
    // prevent a shared catalog/adapter regression from passing a native/frontend comparison.
    const invalidNativeProperties = [
        {body: {title: '   '}, message: '"title" is not allowed to be empty', code: 'VALIDATION_FAILED',
            detail: 'Title: Enter a value.', fieldErrors: [
                {pointer: '/title', code: 'invalid', diagnostic: {field: 'title', rule: 'minLength', limit: 1}},
                {pointer: '/title', code: 'invalid', diagnostic: {field: 'title', rule: 'nonBlank'}},
            ]},
        {body: {description: 'D'.repeat(16001)}, message: '"description" length must be less than or equal to 16000 characters long',
            code: 'VALIDATION_FAILED', detail: 'Description: Use no more than 16000 characters.',
            fieldErrors: [{pointer: '/description', code: 'invalid', diagnostic: {field: 'description', rule: 'maxLength', limit: 16000}}]},
        {body: {}, message: '"value" must have at least 1 key', code: 'VALIDATION_FAILED',
            detail: 'Form: Change at least one field before saving.',
            fieldErrors: [{pointer: '', code: 'invalid', diagnostic: {field: 'request', rule: 'minProperties', limit: 1}}]},
    ];
    for (const invalid of invalidNativeProperties) {
        const versioned = await request.patch(path, {headers: patchHeaders, data: invalid.body});
        await expectProblem(versioned, 400, invalid.code);
        const problem = await versioned.json();
        expect(problem).toMatchObject({detail: invalid.detail, fieldErrors: invalid.fieldErrors});
        expect(JSON.stringify(problem)).not.toContain('D'.repeat(100));
        expect(JSON.stringify(problem)).not.toContain('must NOT');
    }
    const afterNativeNoOp = await request.get(path, {headers});
    expect((await afterNativeNoOp.json()).values).toEqual((await baseline.json()).values);
    await expectProblem(await request.patch(path, {headers: patchHeaders, data: {}}), 400, 'VALIDATION_FAILED');

    await expectProblem(await request.patch(path, {headers, data: {title: 'Missing review'}}), 428, 'PRECONDITION_REQUIRED');
    await expectProblem(await request.patch(path, {headers: {...headers, 'If-Match': `W/${tag}`}, data: {title: 'Weak review'}}), 412, 'PRECONDITION_FAILED');

    // Transport normalization must match native forms: surrounding spaces do not count
    // toward the persisted title limit, and all failed requests above left this tag valid.
    const title = 'T'.repeat(255);
    const saved = await request.patch(path, {headers: patchHeaders, data: {title: `  ${title}  `}});
    expect(saved.status()).toBe(200);
    expect(await saved.json()).toMatchObject({values: {title, description: 'Shared equipment'}});
    expect(saved.headers().etag).not.toBe(tag);
    const refreshed = await request.get(path, {headers: conditionalHeaders});
    expect(refreshed.status()).toBe(200);
    expect(await refreshed.json()).toMatchObject({values: {title, description: 'Shared equipment'}});
    await expectProblem(await request.patch(path, {headers: patchHeaders, data: {title: 'Stale overwrite'}}), 412, 'PRECONDITION_FAILED');
    const independent = await request.patch(path, {headers: patchHeaders, data: {description: 'Independent description'}});
    expect(independent.status()).toBe(200);

    const currentTag = independent.headers().etag;
    await updateEntityMetadataForE2E(request, 'packing-lists', list.id, {description: 'Another tab edit'});
    await expectProblem(await request.patch(path, {headers: {...headers, 'If-Match': currentTag}, data: {description: 'Would overwrite description'}}), 412, 'PRECONDITION_FAILED');
    const latest = await request.get(path, {headers});
    expect(await latest.json()).toMatchObject({values: {title, description: 'Another tab edit'}});
    await updateEntityMetadataForE2E(request, 'packing-lists', list.id, {description: 'A later tab edit'});
    await expectProblem(await request.patch(path, {headers: {...headers, 'If-Match': latest.headers().etag},
        data: {description: 'Stale versioned edit'}}), 412, 'PRECONDITION_FAILED');

    // The authored JSON Schema counts code points. Preserve Unicode acceptance
    // through the real command and subsequent saved-data projection.
    const unicodeTitle = '\u{1F600}'.repeat(127);
    await updateEntityMetadataForE2E(request, 'packing-lists', list.id, {title: unicodeTitle});
    const unicodeBaseline = await request.get(path, {headers});
    expect((await unicodeBaseline.json()).values.title).toBe(unicodeTitle);
    const codePointValues = {title: '\u{1F600}'.repeat(128), description: '\u{1F600}'.repeat(8001)};
    const unicodeVersioned = await request.patch(path, {
        headers: {...headers, 'If-Match': unicodeBaseline.headers().etag}, data: codePointValues,
    });
    expect(unicodeVersioned.status()).toBe(200);
    expect((await unicodeVersioned.json()).values).toEqual(codePointValues);
});

test('preserves harmless event-link no-ops without weakening changed commands', async ({request}) => {
    await loginForE2E(request, createE2ELogin());
    const list = await createApiPackingList(request);
    const event = await createResourceViaForm(request, createE2EEvent());
    const actor = await bootstrap(request);
    const headers = headersFor(actor);
    const root = `/api/v1/packing-lists/${list.id}`;

    try {
        // The current adapter retains the shared unchanged branch after authorization.
        // Required context/CSRF still applies; no missing or obsolete comparison writes data.
        const initial = await request.get(`${root}/settings`, {headers});
        const settings = await initial.json() as components['schemas']['PackingSettings'];
        const oversized = '"edit-' + 'a'.repeat(5000) + '"';
        for (const token of [undefined, '', '"obsolete"', 'W/"obsolete"', '*', oversized]) {
            const unchanged = await request.put(`${root}/event`, {
                headers: token === undefined ? headers : {...headers, 'If-Match': token},
                data: {eventId: null, expectedEventId: null},
            });
            expect(unchanged.status()).toBe(200);
            expect(await unchanged.json()).toMatchObject({changed: false});
        }
        await updateEntityEventForE2E(request, 'packing-lists', list.id, {eventId: null, expectedEventId: null});
        const afterNoOps = await request.get(`${root}/settings`, {headers});
        expect(await afterNoOps.json()).toEqual(settings);

        // A real relationship change still needs reviewed current values. Once it commits,
        // repeating that choice is harmless even with the previous now-stale token.
        const change = {eventId: event.id, expectedEventId: null};
        await expectProblem(await request.put(`${root}/event`, {headers, data: change}), 428, 'PRECONDITION_REQUIRED');
        await expectProblem(await request.put(`${root}/event`, {
            headers: {...headers, 'If-Match': oversized}, data: change,
        }), 412, 'PRECONDITION_FAILED');
        expect((await request.put(`${root}/event`, {
            headers: {...headers, 'If-Match': settings.settingsToken}, data: change,
        })).status()).toBe(200);
        const repeated = await request.put(`${root}/event`, {
            headers: {...headers, 'If-Match': settings.settingsToken}, data: change,
        });
        expect(repeated.status()).toBe(200);
        expect(await repeated.json()).toMatchObject({changed: false});
        await expectProblem(await request.put(`${root}/event`, {
            headers: {...headers, 'If-Match': settings.settingsToken},
            data: {eventId: null, expectedEventId: event.id},
        }), 412, 'PRECONDITION_FAILED');
    } finally {
        expect((await request.delete(`/api/v1/packing-lists/${list.id}`, {headers})).status()).toBe(200);
        expect((await request.delete(`/api/v1/events/${event.id}`, {headers})).status()).toBe(200);
    }
});

test('serves usable item and order edit baselines independently of linked detail admission', async ({request}) => {
    await loginForE2E(request, createE2ELogin());
    const owner = await bootstrap(request);
    const event = await createResourceViaForm(request, createE2EEvent());
    const input = createE2EPackingList();
    Object.assign(input.form, {event_id: event.id, 'defaultPerms[public][0]': 'ITEM_EDIT_DESC',
        items: JSON.stringify([
            {title: 'Tent', description: 'Two person tent', maxAssignees: 1, requiredByAll: false},
            {title: 'Stove', description: 'Shared stove', maxAssignees: 1, requiredByAll: false},
        ])});
    const list = await createResourceViaForm(request, input);
    const listPath = `/api/v1/packing-lists/${list.id}`;
    const ownerRead = await request.get(listPath, {headers: headersFor(owner)});
    expect(ownerRead.status()).toBe(200);
    const original = await ownerRead.json() as components['schemas']['PackingListView'];
    const item = original.items[0];
    expect((await request.put(`${listPath}/items/${item.id}/self-assignment`, {headers: headersFor(owner)})).status()).toBe(200);

    // This active profile has only the explicit public editing grant. It was never
    // admitted to the linked detail page and cannot borrow a token from that page.
    const profileName = `Baseline editor ${randomUUID().slice(0, 8)}`;
    await createProfileForE2E(request, profileName);
    const profiles = await bootstrap(request);
    const editor = profiles.profiles.find(profile => profile.name === profileName)!;
    expect(editor).toBeTruthy();
    await selectProfileForE2E(request, editor.id);
    const editorHeaders = headersFor(await bootstrap(request));
    await expectProblem(await request.get(listPath, {headers: editorHeaders}), 403, 'FORBIDDEN');

    const itemPath = `${listPath}/items/${item.id}/edit-baseline`;
    const baselineRead = await request.get(itemPath, {headers: editorHeaders});
    expect(baselineRead.status()).toBe(200);
    const baseline = await baselineRead.json() as components['schemas']['PackingItemEditBaseline'];
    expect(Object.keys(baseline).sort()).toEqual(['editToken', 'editableFields', 'id', 'values']);
    expect(baseline.values).toEqual({description: item.description});
    expect(baseline.editableFields).toEqual(['description']);
    expect(baselineRead.headers().etag).toBe(baseline.editToken);
    await expectProblem(await request.get(`${listPath}/item-order`, {headers: editorHeaders}), 403, 'FORBIDDEN');

    const editHeaders = {...editorHeaders, 'If-Match': baseline.editToken};
    await expectProblem(await request.patch(`${listPath}/items/${item.id}`, {
        headers: editHeaders, data: {title: 'Unauthorized title'},
    }), 403, 'FORBIDDEN');
    expect((await request.patch(`${listPath}/items/${item.id}`, {
        headers: editHeaders, data: {description: 'Permitted description from its own baseline'},
    })).status()).toBe(200);
    await expectProblem(await request.patch(`${listPath}/items/${item.id}`, {
        headers: editHeaders, data: {description: 'Stale description'},
    }), 412, 'PRECONDITION_FAILED');
    const current = await request.get(itemPath, {headers: editorHeaders});
    expect(current.status()).toBe(200);
    expect((await request.get(itemPath, {
        headers: {...editorHeaders, 'If-None-Match': current.headers().etag},
    })).status()).toBe(304);

    // Change authority through the current settings API, then capture a
    // fresh actor context. Reorder receives only the IDs/positions it needs; neither
    // edit baseline inherits the detail page's assignment names or parent metadata.
    await selectProfileForE2E(request, owner.activeProfile!.id);
    await updateEntityDefaultKeysForE2E(request, 'packing-lists', list.id, {public: ['ITEM_EDIT']});
    await selectProfileForE2E(request, editor.id);
    const orderHeaders = headersFor(await bootstrap(request));
    await expectProblem(await request.get(listPath, {headers: orderHeaders}), 403, 'FORBIDDEN');
    const orderRead = await request.get(`${listPath}/item-order`, {headers: orderHeaders});
    expect(orderRead.status()).toBe(200);
    const order = await orderRead.json() as components['schemas']['PackingOrderEditBaseline'];
    expect(Object.keys(order).sort()).toEqual(['items', 'orderToken']);
    expect(order.items).toHaveLength(original.items.length);
    for (const row of order.items) expect(Object.keys(row).sort()).toEqual(['id', 'position']);
    const itemIds = order.items.map(row => row.id).reverse();
    const reorderHeaders = {...orderHeaders, 'If-Match': order.orderToken};
    expect((await request.put(`${listPath}/item-order`, {headers: reorderHeaders, data: {itemIds}})).status()).toBe(200);
    await expectProblem(await request.put(`${listPath}/item-order`, {headers: reorderHeaders, data: {itemIds}}), 412, 'PRECONDITION_FAILED');

    // Matching validators never replace current authorization. Capture the saved
    // baselines, revoke the only method grant through current settings, then use
    // the editor's fresh context with those still-matching private validators.
    const confirmedItem = await request.get(itemPath, {headers: orderHeaders});
    const confirmedOrder = await request.get(`${listPath}/item-order`, {headers: orderHeaders});
    expect(confirmedItem.status()).toBe(200);
    expect(confirmedOrder.status()).toBe(200);
    await selectProfileForE2E(request, owner.activeProfile!.id);
    await updateEntityDefaultKeysForE2E(request, 'packing-lists', list.id, {public: []});
    await selectProfileForE2E(request, editor.id);
    const revokedHeaders = headersFor(await bootstrap(request));
    await expectProblem(await request.get(itemPath, {
        headers: {...revokedHeaders, 'If-None-Match': confirmedItem.headers().etag},
    }), 403, 'FORBIDDEN');
    await expectProblem(await request.get(`${listPath}/item-order`, {
        headers: {...revokedHeaders, 'If-None-Match': confirmedOrder.headers().etag},
    }), 403, 'FORBIDDEN');
});

test('honors native public method grants without disclosing protected packing projections', async ({request, browser, baseURL}) => {
    await loginForE2E(request, createE2ELogin());
    const owner = await bootstrap(request);
    const event = await createResourceViaForm(request, createE2EEvent());
    const input = createE2EPackingList();
    Object.assign(input.form, {event_id: event.id, items: JSON.stringify([
        {title: 'Tent', description: 'Private baseline fixture', maxAssignees: 2, requiredByAll: false},
        {title: 'Stove', description: 'Shared stove', maxAssignees: 1, requiredByAll: false},
        {title: 'Spare item', description: '', maxAssignees: 1, requiredByAll: false},
    ])});
    const list = await createResourceViaForm(request, input);
    const rootPath = `/api/v1/packing-lists/${list.id}`;
    const ownerRead = await request.get(rootPath, {headers: headersFor(owner)});
    expect(ownerRead.status()).toBe(200);
    const original = await ownerRead.json() as components['schemas']['PackingListView'];
    const item = original.items[0];
    expect((await request.put(`${rootPath}/items/${item.id}/self-assignment`, {headers: headersFor(owner)})).status()).toBe(200);
    const assigned = await request.get(rootPath, {headers: headersFor(owner)});
    const assignmentId = (await assigned.json() as components['schemas']['PackingListView']).items[0].assignees[0].assignmentId!;
    const targetName = `Public admin target ${randomUUID().slice(0, 8)}`;
    await createProfileForE2E(request, targetName);
    const target = (await bootstrap(request)).profiles.find(profile => profile.name === targetName)!;
    expect(target).toBeTruthy();
    await selectProfileForE2E(request, owner.activeProfile!.id);

    const firstContext = await browser.newContext({baseURL});
    const secondContext = await browser.newContext({baseURL});
    try {
        const first = firstContext.request;
        const second = secondContext.request;
        const firstSession = await bootstrap(first);
        const secondSession = await bootstrap(second);
        expect(firstSession.kind).toBe('anonymous');
        expect(firstSession.activeProfile).toBeNull();
        expect(firstSession.context).toBeNull();
        expect(secondSession.context).toBeNull();
        const publicHeaders = headersFor(firstSession);
        const itemPath = `${rootPath}/items/${item.id}`;

        // Default access bits do not authorize editing. Public actions become
        // available only after the owner explicitly selects the native method grants.
        await expectProblem(await first.get(`${itemPath}/edit-baseline`, {headers: publicHeaders}), 403, 'FORBIDDEN');
        await expectProblem(await first.get(`${rootPath}/description`, {headers: publicHeaders}), 403, 'FORBIDDEN');
        await updateEntityDefaultKeysForE2E(request, 'packing-lists', list.id, {public: [
            'EDIT_DESC', 'EDIT_META', 'ITEM_EDIT', 'ITEM_DELETE', 'MANAGE_ASSIGNMENTS', 'MANAGE_PERMISSIONS',
        ]});

        // A method grant does not admit full page/settings/image reads or replace
        // profile-owned creation, self-assignment, property, lifecycle or deletion rules.
        for (const suffix of ['', '/metadata', '/settings', '/header']) {
            await expectProblem(await first.get(rootPath + suffix, {headers: publicHeaders}), 401, 'AUTH_REQUIRED');
        }
        await expectProblem(await first.patch(`${rootPath}/metadata`, {headers: publicHeaders, data: {description: 'Protected property route'}}), 401, 'AUTH_REQUIRED');
        await expectProblem(await first.put(`${itemPath}/self-assignment`, {headers: publicHeaders}), 401, 'AUTH_REQUIRED');
        await expectProblem(await first.post(`${rootPath}/archive`, {headers: publicHeaders}), 401, 'AUTH_REQUIRED');
        await expectProblem(await first.delete(rootPath, {headers: publicHeaders}), 401, 'AUTH_REQUIRED');

        const itemRead = await first.get(`${itemPath}/edit-baseline`, {headers: publicHeaders});
        expect(itemRead.status()).toBe(200);
        const itemBaseline = await itemRead.json() as components['schemas']['PackingItemEditBaseline'];
        expect(Object.keys(itemBaseline).sort()).toEqual(['editToken', 'editableFields', 'id', 'values']);
        const itemHeaders = {...publicHeaders, 'If-Match': itemBaseline.editToken};
        // Public comparisons bind resource, method and reviewed values, with no
        // synthetic shared identity. Another stateless visitor has the same
        // effective public scope; this token still cannot edit another item.
        const secondRead = await second.get(`${itemPath}/edit-baseline`, {headers: headersFor(secondSession)});
        expect(secondRead.status()).toBe(200);
        expect((await secondRead.json()).editToken).toBe(itemBaseline.editToken);
        await expectProblem(await second.patch(`${rootPath}/items/${original.items[1].id}`, {
            headers: {...headersFor(secondSession), 'If-Match': itemBaseline.editToken}, data: {title: 'Another item'},
        }), 412, 'PRECONDITION_FAILED');
        const missingCompatibility: Record<string, string> = {...itemHeaders};
        delete missingCompatibility['X-Surveyor-Api-Compatibility'];
        await expectProblem(await first.patch(itemPath, {headers: missingCompatibility, data: {title: 'Missing request protection'}}), 403, 'CSRF_INVALID');
        await expectProblem(await first.patch(itemPath, {headers: {...itemHeaders, Origin: 'https://other.example'}, data: {title: 'Cross origin'}}), 403, 'CSRF_INVALID');
        await expectProblem(await first.patch(itemPath, {headers: itemHeaders, data: {title: 'Forged actor', profileId: owner.activeProfile!.id}}), 400, 'VALIDATION_FAILED');
        const publicSave = await first.patch(itemPath, {headers: itemHeaders, data: {title: 'Explicit public edit'}});
        expect(publicSave.status()).toBe(200);
        expect(publicSave.headers()['set-cookie']).toBeUndefined();
        expect(publicSave.headers()['x-surveyor-context']).toBeUndefined();
        expect((await firstContext.storageState()).cookies).toEqual([]);
        expect((await first.delete(`${rootPath}/assignments/${assignmentId}`, {headers: publicHeaders})).status()).toBe(200);

        const orderRead = await first.get(`${rootPath}/item-order`, {headers: publicHeaders});
        expect(orderRead.status()).toBe(200);
        const order = await orderRead.json() as components['schemas']['PackingOrderEditBaseline'];
        expect(Object.keys(order).sort()).toEqual(['items', 'orderToken']);
        const itemIds = order.items.map(row => row.id).reverse();
        expect((await first.put(`${rootPath}/item-order`, {headers: {...publicHeaders, 'If-Match': order.orderToken}, data: {itemIds}})).status()).toBe(200);
        expect((await first.delete(`${rootPath}/items/${original.items[2].id}`, {headers: publicHeaders})).status()).toBe(200);

        const descriptionRead = await first.get(`${rootPath}/description`, {headers: publicHeaders});
        expect(descriptionRead.status()).toBe(200);
        const description = await descriptionRead.json() as components['schemas']['PackingDescriptionBaseline'];
        expect(Object.keys(description).sort()).toEqual(['description', 'editToken']);
        const descriptionHeaders = {...publicHeaders, 'If-Match': description.editToken};
        await expectProblem(await first.patch(`${rootPath}/description`, {headers: descriptionHeaders, data: {}}), 400, 'VALIDATION_FAILED');
        await expectProblem(await first.patch(`${rootPath}/description`, {headers: descriptionHeaders, data: {description: 'Wrong field', title: 'Protected'}}), 400, 'VALIDATION_FAILED');
        expect((await first.patch(`${rootPath}/description`, {headers: descriptionHeaders, data: {description: 'Explicit public description'}})).status()).toBe(200);

        const defaultsRead = await first.get(`${rootPath}/default-permissions`, {headers: publicHeaders});
        expect(defaultsRead.status()).toBe(200);
        const defaults = await defaultsRead.json() as components['schemas']['PackingDefaultsBaseline'];
        expect(Object.keys(defaults).sort()).toEqual(['defaultPermissions', 'editToken']);
        expect((await first.put(`${rootPath}/default-permissions`, {headers: {...publicHeaders, 'If-Match': defaults.editToken}, data: {guest: 0}})).status()).toBe(200);
        const searchQuery = createE2ELogin().username;
        const profileSearch = await first.get(`${rootPath}/profiles`, {headers: publicHeaders, params: {q: searchQuery}});
        expect(profileSearch.status()).toBe(200);
        expect(profileSearch.headers()['ratelimit-limit']).toBe('120');
        const profiles = await profileSearch.json() as components['schemas']['PackingProfileOptions'];
        expect(profiles.length).toBeGreaterThan(0);
        for (const profile of profiles) {
            expect(Object.keys(profile).sort()).toEqual(['isGuest', 'name', 'profileId', 'username']);
            expect(profile.isGuest).toBe(false);
        }
        const adminPath = `${rootPath}/admins/${target.id}`;
        const absentRead = await first.get(`${adminPath}/edit-baseline`, {headers: publicHeaders});
        expect(absentRead.status()).toBe(200);
        const absent = await absentRead.json() as components['schemas']['PackingAdminBaseline'];
        expect(Object.keys(absent).sort()).toEqual(['editToken', 'mask']);
        expect(absent.mask).toBeNull();
        expect((await first.post(`${rootPath}/admins`, {headers: {...publicHeaders, 'If-Match': absent.editToken}, data: {profileId: target.id, mask: 0}})).status()).toBe(200);
        const savedAdmin = await first.get(`${adminPath}/edit-baseline`, {headers: publicHeaders});
        const admin = await savedAdmin.json() as components['schemas']['PackingAdminBaseline'];
        expect(admin.mask).toBe(0);
        expect((await first.patch(adminPath, {headers: {...publicHeaders, 'If-Match': admin.editToken}, data: {mask: 1}})).status()).toBe(200);
        const updatedAdmin = await first.get(`${adminPath}/edit-baseline`, {headers: publicHeaders});
        expect((await first.delete(adminPath, {headers: {...publicHeaders, 'If-Match': updatedAdmin.headers().etag}})).status()).toBe(200);

        // The header baseline supplies only a comparison token. Even a successful
        // public upload does not grant the protected header-byte read.
        const headerRead = await first.get(`${rootPath}/header/edit-baseline`, {headers: publicHeaders});
        expect(headerRead.status()).toBe(200);
        const header = await headerRead.json() as components['schemas']['PackingHeaderBaseline'];
        expect(Object.keys(header)).toEqual(['editToken']);
        const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
        expect((await first.put(`${rootPath}/header`, {headers: {...publicHeaders, 'If-Match': header.editToken},
            multipart: {image: {name: 'public-header.png', mimeType: 'image/png', buffer: image}}})).status()).toBe(200);
        await expectProblem(await first.get(`${rootPath}/header`, {headers: publicHeaders}), 401, 'AUTH_REQUIRED');
        const savedHeader = await first.get(`${rootPath}/header/edit-baseline`, {headers: publicHeaders});
        expect((await first.delete(`${rootPath}/header`, {headers: {...publicHeaders, 'If-Match': savedHeader.headers().etag}})).status()).toBe(200);

        // Revoke all explicit Public powers through the same current owner API.
        // Old comparison evidence cannot turn a current denial into a 304 or a save.
        const confirmed = await first.get(`${itemPath}/edit-baseline`, {headers: publicHeaders});
        await updateEntityDefaultKeysForE2E(request, 'packing-lists', list.id, {public: []});
        await expectProblem(await first.get(`${itemPath}/edit-baseline`, {headers: {...publicHeaders, 'If-None-Match': confirmed.headers().etag}}), 403, 'FORBIDDEN');
        await expectProblem(await first.patch(itemPath, {headers: {...publicHeaders, 'If-Match': confirmed.headers().etag}, data: {title: 'Revoked public edit'}}), 403, 'FORBIDDEN');
    } finally {
        await firstContext.close();
        await secondContext.close();
    }
});

test('rejects old profile scopes and returns structured authentication loss after the cookie disappears', async ({context}) => {
    await loginForE2E(context.request, createE2ELogin());
    const list = await createApiPackingList(context.request);
    const original = await bootstrap(context.request);
    const profileName = `API alternate ${randomUUID()}`;
    await createProfileForE2E(context.request, profileName);
    const withProfiles = await bootstrap(context.request);
    const alternate = withProfiles.profiles.find(profile => profile.name === profileName)!;
    expect(alternate).toBeTruthy();
    await selectProfileForE2E(context.request, alternate.id);
    await expectProblem(await context.request.get(`/api/v1/packing-lists/${list.id}`, {headers: headersFor(original)}), 409, 'SESSION_CONTEXT_CHANGED');
    await expectProblem(await context.request.patch(`/api/v1/packing-lists/${list.id}/metadata`, {
        headers: {...headersFor(original), 'If-Match': '"old"'}, data: {title: 'Old profile command'},
    }), 409, 'SESSION_CONTEXT_CHANGED');
    const switched = await bootstrap(context.request);
    expect(switched.activeProfile!.id).toBe(alternate.id);
    expect(switched.context).not.toBe(original.context);
    expect(switched.csrfToken).not.toBe(original.csrfToken);
    await selectProfileForE2E(context.request, original.activeProfile!.id);
    const restored = await bootstrap(context.request);
    expect(restored.context).not.toBe(original.context);
    await expectProblem(await context.request.get(`/api/v1/packing-lists/${list.id}`, {headers: headersFor(original)}), 409, 'SESSION_CONTEXT_CHANGED');

    // Expiry removes the cookie from subsequent requests. Preserve the old browser headers
    // to verify that private endpoints return a Problem rather than a login redirect or HTML.
    await context.clearCookies();
    await expectProblem(await context.request.get(`/api/v1/packing-lists/${list.id}`, {headers: headersFor(restored)}), 401, 'AUTH_REQUIRED');
    const anonymous = await bootstrap(context.request);
    expect(anonymous).toMatchObject({kind: 'anonymous', activeProfile: null, profiles: []});
    await expectProblem(await context.request.get(`/api/v1/packing-lists/${list.id}`, {headers: headersFor(anonymous)}), 401, 'AUTH_REQUIRED');
});

test('reauthorizes a conditional read before returning 304 or private content', async ({request, browser, baseURL}) => {
    await loginForE2E(request, createE2ELogin());
    const list = await createApiPackingList(request);
    const event = await createResourceViaForm(request, createE2EEvent());
    const guestContext = await browser.newContext({baseURL});
    try {
        await registerGuestForE2E(guestContext.request, 'packing-lists', list.id, {username: `Cache guest ${randomUUID().slice(0, 8)}`, email: null});
        const guest = await bootstrap(guestContext.request);
        await updateEntityEventForE2E(request, 'packing-lists', list.id, {eventId: event.id, expectedEventId: null});
        await updateEntityDefaultKeysForE2E(request, 'packing-lists', list.id, {public: [], guest: [], authenticated: [], participant: []});
        await addEntityAdministratorForE2E(request, 'packing-lists', list.id, guest.activeProfile!.id, PERM.ACCESS_VIEW);
        const path = `/api/v1/packing-lists/${list.id}`;
        const initial = await guestContext.request.get(path, {headers: headersFor(guest)});
        expect(initial.status()).toBe(200);
        const conditionalHeaders = {...headersFor(guest), 'If-None-Match': initial.headers().etag};
        const unchanged = await guestContext.request.get(path, {headers: conditionalHeaders});
        expect(unchanged.status()).toBe(304);
        expect(await unchanged.body()).toHaveLength(0);
        expect(unchanged.headers()['x-surveyor-context']).toBe(guest.context);
        const adminPath = `/api/v1/packing-lists/${list.id}/admins/${guest.activeProfile!.id}`;
        const adminBaseline = await request.get(adminPath + '/edit-baseline', {headers: await commandHeadersForE2E(request)});
        expect(adminBaseline.status()).toBe(200);
        expect((await request.delete(adminPath, {headers: {...await commandHeadersForE2E(request),
            'If-Match': (await adminBaseline.json()).editToken}})).status()).toBe(200);
        const revoked = await guestContext.request.get(path, {headers: conditionalHeaders});
        await expectProblem(revoked, 403, 'FORBIDDEN');
        expect(await revoked.text()).not.toContain(list.title);
    } finally {
        await guestContext.close();
    }
});

test('applies captured self-membership idempotently and reports capacity without accepting a body actor', async ({request, browser, baseURL}) => {
    await loginForE2E(request, createE2ELogin());
    const list = await createApiPackingList(request);
    const owner = await bootstrap(request);
    const listResponse = await request.get(`/api/v1/packing-lists/${list.id}`, {headers: headersFor(owner)});
    const item = (await listResponse.json()).items[0];
    const path = `/api/v1/packing-lists/${list.id}/items/${item.id}/self-assignment`;
    const guestContext = await browser.newContext({baseURL});
    try {
        await registerGuestForE2E(guestContext.request, 'packing-lists', list.id, {username: `Assign guest ${randomUUID().slice(0, 8)}`, email: null});
        const guest = await bootstrap(guestContext.request);
        await expectProblem(await request.put(path, {headers: headersFor(owner), data: {profileId: guest.activeProfile!.id}}), 400, 'VALIDATION_FAILED');
        await expectProblem(await request.put(path, {headers: {...headersFor(owner), 'Content-Type': 'text/plain'}, data: 'unexpected'}), 400, 'VALIDATION_FAILED');
        for (let retry = 0; retry < 2; retry++) {
            const assigned = await guestContext.request.put(path, {headers: headersFor(guest)});
            expect(assigned.status()).toBe(200);
            expect(await assigned.json()).toEqual({listId: list.id, itemId: item.id, selfAssigned: true, assignedCount: 1, maxAssignees: 1});
        }
        const versionedFull = await request.put(path, {headers: headersFor(owner)});
        await expectProblem(versionedFull, 409, 'PACKING_ITEM_FULL');
        expect(await versionedFull.json()).toMatchObject({detail: 'This packing item is already fully assigned', params: {itemId: item.id}});
        const ownView = await request.get(`/api/v1/packing-lists/${list.id}`, {headers: headersFor(owner)});
        expect((await ownView.json()).items[0]).toMatchObject({selfAssigned: false, assignedCount: 1, assignees: [{name: guest.activeProfile!.name}]});
        for (let retry = 0; retry < 2; retry++) {
            const unassigned = await guestContext.request.delete(path, {headers: headersFor(guest)});
            expect(unassigned.status()).toBe(200);
            expect(await unassigned.json()).toMatchObject({selfAssigned: false, assignedCount: 0});
        }
    } finally {
        await guestContext.close();
    }
});

test('preserves native signed capacity edits and SQL rounding through the versioned locked operation', async ({request}) => {
    await loginForE2E(request, createE2ELogin());
    const input = createE2EPackingList();
    const title = `Capacity transport ${randomUUID().slice(0, 8)}`;
    Object.assign(input, {title, expectedViewText: title});
    Object.assign(input.form, {title, items: JSON.stringify([
        {title: 'Versioned capacity', description: '', maxAssignees: 1, requiredByAll: false},
    ])});
    const list = await createResourceViaForm(request, input);
    const session = await bootstrap(request);
    const headers = headersFor(session);
    const path = `/api/v1/packing-lists/${list.id}`;

    async function readItems(): Promise<components['schemas']['PackingItemView'][]> {
        const response = await request.get(path, {headers});
        expect(response.status()).toBe(200);
        const body = await response.json() as components['schemas']['PackingListView'];
        return body.items;
    }

    // The full signed/decimal/integer-boundary matrix belongs at the real MariaDB
    // integration boundary. These representatives protect HTTP parsing, native/v1
    // envelopes, safe SQL failures and unchanged persisted values after a rejection.
    // Blank/overflow rejection uses the supported strict-SQL environment; changing
    // server SQL mode changes native persistence too, not the frontend's wire policy.
    const cases: {value: number | string | null; status: number; saved?: number | null}[] = [
        {value: '0', status: 200, saved: 0},
        {value: '-1.5', status: 200, saved: -2},
        {value: null, status: 200, saved: null},
        {value: '', status: 500},
        {value: '2147483648', status: 500},
        {value: -1.5, status: 200, saved: -2},
    ];
    try {
        for (const scenario of cases) {
            const before = await readItems();
            expect(before).toHaveLength(1);
            const versionedItem = before[0];
            const versioned = await request.patch(`${path}/items/${versionedItem.id}`, {
                headers: {...headers, 'If-Match': versionedItem.editToken}, data: {maxAssignees: scenario.value},
            });
            if (scenario.status === 200) {
                expect(versioned.status()).toBe(200);
                expect(await versioned.json()).toMatchObject({changed: expect.any(Boolean)});
            } else {
                // Preserve native rejection without exposing its SQL message/schema in
                // v1. A failed persistence attempt remains a safe typed 500, not a new
                // browser/client validation rule or an automatic command replay.
                await expectProblem(versioned, 500, 'INTERNAL_ERROR');
                const problem = await versioned.json();
                expect(problem.params).toEqual({});
                expect(JSON.stringify(problem)).not.toMatch(/packing_items|max_assignees|integer value|Out of range/u);
            }
            const after = await readItems();
            const expected = scenario.status === 200 ? scenario.saved : versionedItem.maxAssignees;
            expect(after[0].maxAssignees).toBe(expected);
            expect(after[0].assignedCount).toBe(0);
        }
    } finally {
        expect((await request.delete(path, {headers})).status()).toBe(200);
    }
});

test('uses typed multipart, item/settings drafts and scoped binary transport for the complete packing workflow', async ({request}) => {
    await loginForE2E(request, createE2ELogin());
    const session = await bootstrap(request);
    const headers = headersFor(session);
    const creationContext = await request.get('/api/v1/packing-lists/create-context', {headers});
    expect(creationContext.status()).toBe(200);
    const creation = {title: `Typed packing ${randomUUID()}`, description: null, eventId: null,
        defaultPermissions: (await creationContext.json()).defaults,
        items: [{title: 'Tent', description: null, maxAssignees: 2, requiredByAll: false},
            {title: 'Water', description: 'Drink bottle', maxAssignees: 1, requiredByAll: true}]};
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX2kAAAAASUVORK5CYII=', 'base64');
    await expectProblem(await request.post('/api/v1/packing-lists', {headers, data: creation}), 415, 'UNSUPPORTED_MEDIA_TYPE');
    await expectProblem(await request.post('/api/v1/packing-lists', {headers, multipart: {data: '{bad-json'}}), 400, 'INVALID_JSON');
    await expectProblem(await request.post('/api/v1/packing-lists', {headers, multipart: {
        data: JSON.stringify({...creation, items: [{...creation.items[0], maxAssignees: false}]}),
    }}), 400, 'VALIDATION_FAILED');
    const created = await request.post('/api/v1/packing-lists', {headers, multipart: {
        data: JSON.stringify(creation), image: {name: 'header.png', mimeType: 'image/png', buffer: png},
    }});
    expect(created.status()).toBe(201);
    const id = (await created.json()).id as string;
    const root = `/api/v1/packing-lists/${id}`;
    expect(created.headers().location).toBe(root);
    async function view(): Promise<components['schemas']['PackingListView']> {
        const response = await request.get(root, {headers});
        expect(response.status()).toBe(200);
        return response.json();
    }
    async function settings(): Promise<components['schemas']['PackingSettings']> {
        const response = await request.get(`${root}/settings`, {headers});
        expect(response.status()).toBe(200);
        return response.json();
    }
    let current = await view();
    expect(current.items.map(item => item.position)).toEqual([0, 1]);
    expect(current.headerUrl).toBe(`${root}/header`);
    const binary = await request.get(current.headerUrl!, {headers});
    expect(binary.status()).toBe(200);
    expect(binary.headers()['x-surveyor-context']).toBe(session.context);
    expect(await binary.body()).toEqual(png);
    await expectProblem(await request.get(current.headerUrl!), 400, 'CONTEXT_REQUIRED');
    const first = current.items[0];
    expect((await view()).items[0]).toEqual(first);
    await expectProblem(await request.patch(`${root}/items/${first.id}`, {
        headers: {...headers, 'If-Match': first.editToken}, data: {},
    }), 400, 'VALIDATION_FAILED');
    await expectProblem(await request.patch(`${root}/items/${first.id}`, {headers, data: {title: 'No token'}}), 428, 'PRECONDITION_REQUIRED');
    expect((await request.patch(`${root}/items/${first.id}`, {headers: {...headers, 'If-Match': first.editToken}, data: {title: 'Updated tent'}})).status()).toBe(200);
    await expectProblem(await request.patch(`${root}/items/${first.id}`, {headers: {...headers, 'If-Match': first.editToken}, data: {title: 'Stale'}}), 412, 'PRECONDITION_FAILED');
    const createdItem = await request.post(`${root}/items`, {headers, data: {title: 'Towels', description: null, maxAssignees: 1, requiredByAll: false}});
    expect(createdItem.status()).toBe(201);
    expect(createdItem.headers().location).toBe(`${root}#${(await createdItem.json()).id}`);
    current = await view();
    const reversed = current.items.map(item => item.id).reverse();
    expect((await request.put(`${root}/item-order`, {headers: {...headers, 'If-Match': current.orderToken}, data: {itemIds: reversed}})).status()).toBe(200);
    expect((await view()).items.map(item => item.id)).toEqual(reversed);
    const beforeHeader = await settings();
    expect((await request.put(`${root}/header`, {headers: {...headers, 'If-Match': beforeHeader.settingsToken}, multipart: {
        image: {name: 'replacement.png', mimeType: 'image/png', buffer: png},
    }})).status()).toBe(200);
    const afterHeader = await settings();
    expect(afterHeader.headerVersion).not.toBe(beforeHeader.headerVersion);
    // A changed image does not invalidate an independently reviewed audience mask.
    expect((await request.put(`${root}/default-permissions`, {headers: {...headers, 'If-Match': beforeHeader.settingsToken}, data: {guest: 16}})).status()).toBe(200);
    await expectProblem(await request.put(`${root}/default-permissions`, {headers: {...headers, 'If-Match': beforeHeader.settingsToken}, data: {guest: 0}}), 412, 'PRECONDITION_FAILED');
    const adminProfile = session.activeProfile!.id;
    expect((await request.post(`${root}/admins`, {headers: {...headers, 'If-Match': beforeHeader.settingsToken}, data: {profileId: adminProfile, mask: 1}})).status()).toBe(200);
    const adminBaseline = (await settings()).access!.admins.find(admin => admin.profileId === adminProfile)!;
    expect((await request.patch(`${root}/admins/${adminProfile}`, {headers: {...headers, 'If-Match': adminBaseline.editToken}, data: {mask: 2}})).status()).toBe(200);
    await expectProblem(await request.patch(`${root}/admins/${adminProfile}`, {headers: {...headers, 'If-Match': adminBaseline.editToken}, data: {mask: 1}}), 412, 'PRECONDITION_FAILED');
    const freshAdmin = (await settings()).access!.admins.find(admin => admin.profileId === adminProfile)!;
    expect((await request.delete(`${root}/admins/${adminProfile}`, {headers: {...headers, 'If-Match': freshAdmin.editToken}})).status()).toBe(200);
    expect((await request.delete(`${root}/header`, {headers: {...headers, 'If-Match': afterHeader.settingsToken}})).status()).toBe(200);
    await expectProblem(await request.get(`${root}/header`, {headers}), 404, 'NOT_FOUND');
    expect((await request.post(`${root}/archive`, {headers})).status()).toBe(200);
    expect((await view()).archived).toBe(true);
    expect((await request.post(`${root}/restore`, {headers})).status()).toBe(200);
    const duplicate = await request.get(`${root}/duplicate`, {headers});
    expect(duplicate.status()).toBe(200);
    expect(await duplicate.json()).toMatchObject({eventId: null, title: creation.title, items: expect.any(Array)});
    const overviewQuery = {collection: 'owner', region: 'main', q: creation.title};
    const overview = await request.get('/api/v1/overview', {headers, params: overviewQuery});
    expect(overview.status()).toBe(200);
    expect((await overview.json()).items.map((card: {id: string}) => card.id)).toEqual([id]);
    await expectProblem(await request.get('/api/v1/overview', {headers, params: {...overviewQuery, profileId: session.activeProfile!.id}}), 400, 'VALIDATION_FAILED');
    const visibilityPath = `/api/v1/overview/packing/${id}/visibility`;
    expect((await request.put(visibilityPath, {headers, data: {visibility: 'hidden'}})).status()).toBe(200);
    const hidden = await request.get('/api/v1/overview', {headers, params: {...overviewQuery, region: 'hidden'}});
    expect((await hidden.json()).items.map((card: {id: string}) => card.id)).toEqual([id]);
    expect((await view()).archived).toBe(false);
    expect((await request.delete(root, {headers})).status()).toBe(200);
    await expectProblem(await request.get(root, {headers}), 404, 'NOT_FOUND');
});
