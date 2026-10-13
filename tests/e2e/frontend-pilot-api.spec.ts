import {expect, test, type APIRequestContext, type APIResponse} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import type {components} from '../../src/types/api/v1';
import type {FrontendPilotBootstrap} from '../../src/types/FrontendPilotTypes';
import {createE2EEvent, createE2ELogin, createE2EPackingList} from '../factories/e2eCoreFactory';
import {createResourceViaForm, loginForE2E} from '../keywords/e2eCoreKeywords';
import {waitForPilotHydration} from '../keywords/frontendDynamicKeywords';

/** Exercise cookie/session admission through the built application, without a test-only identity shortcut. */
async function bootstrap(request: APIRequestContext): Promise<components['schemas']['SessionView']> {
    const response = await request.get('/api/v1/session');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('application/json');
    expect(response.headers()['cache-control']).toContain('no-store');
    const body = await response.json() as components['schemas']['SessionView'];
    expect(body.context).toBeTruthy();
    expect(body.csrfToken).toBeTruthy();
    expect(response.headers()['x-surveyor-context']).toBe(body.context);
    return body;
}

function headersFor(session: components['schemas']['SessionView']): Record<string, string> {
    return {'X-Surveyor-Context': session.context, 'X-CSRF-Token': session.csrfToken};
}

/** Run inside the browser against detached response documents. The native alert
 * is the wording oracle, so localized pilot tests cannot silently bless an English
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
function pilotDocumentState(html: string): FrontendPilotBootstrap {
    const serialized = html.match(/<script id="surveyor-pilot-state" type="application\/json">([^<]+)<\/script>/u)?.[1];
    expect(serialized).toBeTruthy();
    return JSON.parse(serialized!) as FrontendPilotBootstrap;
}

/** Compare the real document and API boundaries after serialized login/profile/guest transitions.
 * Rich controller fixtures cannot prove that inverse owner relations survive session storage. */
async function expectDuplicateEntry(request: APIRequestContext, id: string, title: string, allowed: boolean): Promise<void> {
    const current = await bootstrap(request);
    const document = await request.get(`/frontend-pilot/packing/${id}/duplicate?locale=en`, {maxRedirects: 0});
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
        expect(pilotDocumentState(html).packingDuplicate).toMatchObject({title});
        expect(html).not.toContain(`value="${title}"`);
    } else {
        await expectProblem(api, 403, 'FORBIDDEN');
        expect(html).not.toContain(`value="${title}"`);
        expect(html).toContain('>Not allowed<');
        expect(html).not.toContain('You do not have permission for this action.');
    }
}

test('preserves native packing HTML 404s, standalone guest entry and public duplicate GET admission', async ({page, browser, baseURL}) => {
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
                const pilot = await request.get(`/frontend-pilot/packing/${id}${suffix}?locale=de`, {maxRedirects: 0});
                const english = await request.get(`/frontend-pilot/packing/${id}${suffix}?locale=en`, {maxRedirects: 0});
                expect(native.status()).toBe(404);
                expect(pilot.status()).toBe(native.status());
                expect(english.status()).toBe(native.status());
                const messages = await page.evaluate(readAdmissionMessages, [await native.text(), await english.text()]);
                expect(messages[0]).toBeTruthy();
                expect(messages[1]).toBe(messages[0]);
                expect(pilot.headers()['content-type']).toContain('text/html');
                const html = await pilot.text();
                expect(html).toContain('Packliste nicht gefunden.');
                expect(html).toContain('class="card-header text-center bg-dark text-light"');
                // Check the error card's actual Home action, rather than a shell
                // navigation link that happens to reach the same overview URL.
                expect(html).toMatch(/<a\b(?=[^>]*class="btn btn-primary")(?=[^>]*href="\/frontend-pilot")[^>]*>/);
            }
        }
        const create = await request.get('/frontend-pilot/packing/create?locale=de', {maxRedirects: 0});
        expect(create.status()).toBe(302);
        expect(create.headers().location).toContain('/frontend-pilot/users/login?');
        expect(create.headers().location).toContain('locale=de');
        const nativeDetail = await request.get(list.path, {maxRedirects: 0});
        const detail = await request.get(`/frontend-pilot/packing/${list.id}?locale=de`, {maxRedirects: 0});
        expect(detail.status()).toBe(nativeDetail.status());
        expect(detail.headers().location).toBe(`/frontend-pilot/packing/${list.id}/guest?locale=de`);
        const guestPage = await request.get(detail.headers().location!);
        const guestHtml = await guestPage.text();
        expect(guestHtml).toContain(list.title);
        expect(guestHtml).not.toContain('Two person tent');
        expect(guestHtml).toContain('data-pilot-initial-loading');
        expect(guestHtml).not.toContain('id="guest-name"');

        // DATA_DUPLICATE is a separate GET grant: public readers need neither a
        // profile nor detail admission, while creation remains account-only.
        const nativeDuplicate = await request.get(`${list.path}/duplicate`);
        const duplicate = await request.get(`/frontend-pilot/packing/${list.id}/duplicate?locale=de`);
        expect(duplicate.status()).toBe(nativeDuplicate.status());
        expect(duplicate.status()).toBe(200);
        const duplicateHtml = await duplicate.text();
        expect(pilotDocumentState(duplicateHtml).packingDuplicate).toMatchObject({title: list.title});
        expect(duplicateHtml).not.toContain('id="create-title"');
        expect(duplicateHtml).toContain('Two person tent');
        expect(duplicateHtml).toContain('Interaktive Funktionen dieser Website benötigen JavaScript.');
        expect(duplicateHtml).toContain('id="surveyor-pilot-javascript-required"');
        const anonymous = await bootstrap(request);
        expect((await request.get(`/api/v1/packing-lists/${list.id}/duplicate`, {headers: headersFor(anonymous)})).status()).toBe(200);
        const detailEntry = await request.get(`/api/v1/packing-lists/${list.id}/entry?view=detail`, {headers: headersFor(anonymous)});
        expect(await detailEntry.json()).toEqual({entry: {kind: 'redirect', url: `/frontend-pilot/packing/${list.id}/guest`, notice: null}, guest: null});
        const guestEntry = await request.get(`/api/v1/packing-lists/${list.id}/entry?view=guest`, {headers: headersFor(anonymous)});
        expect(await guestEntry.json()).toEqual({entry: {kind: 'render'}, guest: {id: list.id, title: list.title}});
        const duplicateReturn = `/frontend-pilot/packing/${list.id}/duplicate?locale=de`;
        const createEntry = await request.get('/api/v1/packing-lists/create-entry', {
            headers: headersFor(anonymous), params: {returnTo: duplicateReturn},
        });
        expect(await createEntry.json()).toEqual({entry: {kind: 'redirect',
            url: `/frontend-pilot/users/login?next=${encodeURIComponent(duplicateReturn)}`,
            notice: {kind: 'info', messageKey: 'auth.accountRequired'}}, context: null});
        await expectProblem(await request.get('/api/v1/packing-lists/create-context', {headers: headersFor(anonymous)}), 401, 'AUTH_REQUIRED');
        const ownerGuest = await page.request.get(`/frontend-pilot/packing/${list.id}/guest?locale=en`, {maxRedirects: 0});
        expect(ownerGuest.status()).toBe(302);
        expect(ownerGuest.headers().location).toBe(`/frontend-pilot/packing/${list.id}?locale=en`);
        expect((await page.request.get('/frontend-pilot/packing/create')).status()).toBe(200);
    } finally {
        await anonymousContext.close();
    }
});

test('native and pilot creation/duplicate entries drop missing or forbidden initial events before standalone submission', async ({page}) => {
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
            const native = await page.request.get(`${path}?eventId=${eventId}`);
            expect(native.status()).toBe(200);
            const nativeInput = (await native.text()).match(/<input[^>]*name="event_id"[^>]*>/u)?.[0];
            expect(nativeInput).toContain(`value="${expectedId ?? ''}"`);

            const pilot = await page.request.get(`/frontend-pilot${path}?eventId=${eventId}&locale=en`);
            expect(pilot.status()).toBe(native.status());
            const state = pilotDocumentState(await pilot.text());
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
    expect((await page.request.post('/users/profile/create', {form: {name: profileName}, maxRedirects: 0})).status()).toBe(302);
    const profiles = await bootstrap(page.request);
    const profile = profiles.profiles.find(candidate => candidate.name === profileName)!;
    expect(profile).toBeTruthy();
    expect((await page.request.get(`/users/profile/change/${profile.id}`, {maxRedirects: 0})).status()).toBe(302);
    await expectSelection(event.id, null);
    await expectSelection(randomUUID(), null);

    const nativeEntry = await page.request.get(`/packing/create?eventId=${event.id}`);
    const nativeAction = (await nativeEntry.text()).match(/<form[^>]*id="packingForm"[^>]*action="([^"]+)"/u)?.[1];
    expect(nativeAction).toBe('/packing/create');
    const nativeForm = createE2EPackingList().form;
    const nativeCreated = await page.request.post(nativeAction!, {
        // An absent persistence description is the native text input's empty value.
        form: {...nativeForm, description: nativeForm.description ?? '',
            title: `Native standalone ${randomUUID().slice(0, 8)}`, event_id: ''}, maxRedirects: 0,
    });
    expect(nativeCreated.status()).toBe(302);
    const nativeId = new URL(nativeCreated.headers().location!, 'https://surveyor.invalid').pathname.split('/').at(-1)!;
    const current = await bootstrap(page.request);
    const nativeView = await page.request.get(`/api/v1/packing-lists/${nativeId}`, {headers: headersFor(current)});
    expect((await nativeView.json()).currentEventId).toBeNull();

    await page.goto(`/frontend-pilot/packing/create?eventId=${event.id}&locale=en`);
    await waitForPilotHydration(page);
    await expect(page.locator('#pilot-locale')).toBeEnabled();
    await expect(page.locator('#create-event-button')).toHaveText('No event');
    await page.locator('#create-title').fill(`Pilot standalone ${randomUUID().slice(0, 8)}`);
    await page.locator('tbody tr').first().locator('input').first().fill('Tent');
    const submitted = page.waitForResponse(response => response.request().method() === 'POST'
        && new URL(response.url()).pathname === '/api/v1/packing-lists');
    await page.getByRole('button', {name: 'Create list', exact: true}).click();
    const created = await submitted;
    expect(created.status()).toBe(201);
    const pilotId = (await created.json()).id as string;
    const pilotView = await page.request.get(`/api/v1/packing-lists/${pilotId}`, {headers: headersFor(current)});
    expect((await pilotView.json()).currentEventId).toBeNull();
});

test('uses one duplicate admission for serialized account login, profile switch, guest return and anonymous audience grants', async ({request, browser, baseURL}) => {
    await loginForE2E(request, createE2ELogin());
    const suffix = randomUUID().slice(0, 8);
    const ownerName = `Audience owner ${suffix}`;
    expect((await request.post('/users/profile/create', {form: {name: ownerName}, maxRedirects: 0})).status()).toBe(302);
    const ownerSession = await bootstrap(request);
    const ownerProfile = ownerSession.profiles.find(profile => profile.name === ownerName)!;
    expect(ownerProfile).toBeTruthy();
    expect((await request.get(`/users/profile/change/${ownerProfile.id}`, {maxRedirects: 0})).status()).toBe(302);
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
        expect((await accountSwitch.request.post('/users/profile/create', {form: {name: readerName}, maxRedirects: 0})).status()).toBe(302);
        const reader = (await bootstrap(accountSwitch.request)).profiles.find(profile => profile.name === readerName)!;
        expect((await accountSwitch.request.get(`/users/profile/change/${reader.id}`, {maxRedirects: 0})).status()).toBe(302);

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
            expect((await request.post(`/api/packing/${list.id}/settings`, {data: {defaultPerms: defaults}})).ok()).toBe(true);

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
        expect((await guestContext.request.post(`${list.path}/guest`, {
            form: {username: `HTML guest ${randomUUID().slice(0, 8)}`}, maxRedirects: 0,
        })).status()).toBe(302);
        const guest = await bootstrap(guestContext.request);
        expect((await page.request.post(`/api/packing/${list.id}/event`, {data: {eventId: event.id, expectedEventId: null}})).ok()).toBe(true);
        expect((await page.request.post(`/api/packing/${list.id}/settings`, {data: {
            defaultPerms: {public: [], guest: [], authenticated: [], participant: []},
        }})).ok()).toBe(true);
        const nativeDenied = await guestContext.request.get(list.path, {maxRedirects: 0});
        const pilotDenied = await guestContext.request.get(`/frontend-pilot/packing/${list.id}?locale=de`, {maxRedirects: 0});
        const englishDenied = await guestContext.request.get(`/frontend-pilot/packing/${list.id}?locale=en`, {maxRedirects: 0});
        expect(nativeDenied.status()).toBe(400);
        expect(pilotDenied.status()).toBe(nativeDenied.status());
        expect(englishDenied.status()).toBe(nativeDenied.status());
        const messages = await page.evaluate(readAdmissionMessages, [await nativeDenied.text(), await englishDenied.text()]);
        expect(messages[0]).toBeTruthy();
        expect(messages[1]).toBe(messages[0]);
        const deniedHtml = await pilotDenied.text();
        expect(deniedHtml).toContain('Du musst für die Veranstaltung angemeldet sein');
        expect(deniedHtml).not.toContain(list.title);
        expect(deniedHtml).not.toContain('Two person tent');
        const entryPath = `/api/v1/packing-lists/${list.id}/entry?view=detail`;
        expect(await (await guestContext.request.get(entryPath, {headers: headersFor(guest)})).json())
            .toEqual({entry: {kind: 'denied', status: 400, messageKey: 'packing.eventRegistrationRequired'}, guest: null});
        // The event owner counts as an event participant under the native admission owner.
        expect((await page.request.get(`/frontend-pilot/packing/${list.id}`)).status()).toBe(200);
        expect((await page.request.post(`/api/packing/${list.id}/admins`, {
            data: {profileId: guest.activeProfile!.id, perms: ['ACCESS_VIEW']},
        })).ok()).toBe(true);
        expect((await guestContext.request.get(`/frontend-pilot/packing/${list.id}`)).status()).toBe(200);
        expect(await (await guestContext.request.get(entryPath, {headers: headersFor(guest)})).json())
            .toEqual({entry: {kind: 'render'}, guest: null});
        expect((await page.request.patch(`/api/packing/${list.id}/admins/${guest.activeProfile!.id}`, {
            data: {perms: ['DATA_DUPLICATE']},
        })).ok()).toBe(true);
        expect((await guestContext.request.get(`/frontend-pilot/packing/${list.id}`)).status()).toBe(400);
        expect((await guestContext.request.get(`${list.path}/duplicate`)).status()).toBe(200);
        expect((await guestContext.request.get(`/frontend-pilot/packing/${list.id}/duplicate`)).status()).toBe(200);
        expect((await guestContext.request.get(`/api/v1/packing-lists/${list.id}/duplicate`, {headers: headersFor(guest)})).status()).toBe(200);
        const create = await guestContext.request.get('/frontend-pilot/packing/create', {maxRedirects: 0});
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

test('keeps exact native and SPA duplicate destinations including query context through account-only submission', async ({request, browser, baseURL}) => {
    await loginForE2E(request, createE2ELogin());
    const input = createE2EPackingList();
    Object.assign(input.form, {'defaultPerms[public][0]': 'DATA_DUPLICATE'});
    const list = await createResourceViaForm(request, input);
    const event = await createResourceViaForm(request, createE2EEvent());
    const anonymous = await browser.newContext({baseURL});
    try {
        const nativeReturn = `${list.path}/duplicate?eventId=${event.id}&locale=en`;
        const native = await anonymous.request.get(nativeReturn);
        expect(native.status()).toBe(200);
        const html = await native.text();
        const action = html.match(/<form[^>]*id="packingForm"[^>]*action="([^"]+)"/)?.[1]?.replaceAll('&amp;', '&');
        expect(action).toBeTruthy();
        expect(new URL(action!, baseURL).searchParams.get('next')).toBe(nativeReturn);
        const rejected = await anonymous.request.post(action!, {
            form: {...input.form, description: input.form.description ?? ''}, maxRedirects: 0,
        });
        expect(rejected.status()).toBe(302);
        const login = new URL(rejected.headers().location!, baseURL);
        expect(login.pathname).toBe('/users/login');
        expect(login.searchParams.get('next')).toBe(nativeReturn);
        const resumed = await anonymous.request.post(login.pathname + login.search, {form: {...createE2ELogin()}, maxRedirects: 0});
        expect(resumed.status()).toBe(302);
        expect(resumed.headers().location).toBe(nativeReturn);

        // A fresh anonymous SPA receives the same account decision; its exact pilot
        // source URL is bounded by the existing frontend return owner rather than inferred.
        await anonymous.clearCookies();
        const session = await bootstrap(anonymous.request);
        const pilotReturn = `/frontend-pilot/packing/${list.id}/duplicate?eventId=${event.id}&locale=de`;
        const entry = await anonymous.request.get('/api/v1/packing-lists/create-entry', {
            headers: headersFor(session), params: {returnTo: pilotReturn},
        });
        expect((await entry.json()).entry).toMatchObject({kind: 'redirect',
            url: `/frontend-pilot/users/login?next=${encodeURIComponent(pilotReturn)}`,
            notice: {kind: 'info', messageKey: 'auth.accountRequired'}});
        const forbidden = await anonymous.request.get('/api/v1/packing-lists/create-entry', {
            headers: headersFor(session), params: {returnTo: 'https://outside.invalid/duplicate'},
        });
        expect(new URL((await forbidden.json()).entry.url, baseURL).searchParams.get('next')).toBe('/frontend-pilot');

        // Use the actual mounted identity owner: the declared API command
        // returns the prepared identity, and the client retains its exact next/notice.
        const nativePage = await anonymous.newPage();
        await nativePage.goto(`/frontend-pilot/users/login?next=${encodeURIComponent(pilotReturn)}&locale=de`);
        await waitForPilotHydration(nativePage);
        const credentials = createE2ELogin();
        await nativePage.locator('#username').fill(credentials.username);
        await nativePage.locator('#password').fill(credentials.password);
        const signedIn = nativePage.waitForResponse(response => response.request().method() === 'POST'
            && new URL(response.url()).pathname === '/api/v1/auth/login');
        await nativePage.locator('#pilot-main form').first().locator('button[type="submit"]').click();
        const loginResponse = await signedIn;
        expect(loginResponse.status()).toBe(200);
        const loginResult = await loginResponse.json() as components['schemas']['IdentityResult'];
        expect(loginResult.session.locale).toBe(loginResponse.request().headers()['x-surveyor-locale']);
        await expect(nativePage).toHaveURL(new URL(pilotReturn, baseURL).href);

        // The command receipt uses its explicit presentation header. Identity
        // adoption then reads the authoritative cookie session without an old
        // locale header, so that read owns the settled notice's selected language.
        const loggedIn = await bootstrap(anonymous.request);
        expect(loggedIn).toMatchObject({kind: 'account', context: loginResult.session.context, locale: 'en'});
        await expect(nativePage.locator('#pilot-locale')).toHaveValue(loggedIn.locale);
        await expect(nativePage.getByText('Login successful', {exact: true})).toBeVisible();
        await nativePage.locator('#pilot-locale').selectOption('de');
        await expect(nativePage.getByText('Erfolgreich angemeldet.', {exact: true})).toBeVisible();
        await nativePage.locator('#pilot-locale').selectOption('en');
        await expect(nativePage.getByText('Login successful', {exact: true})).toBeVisible();

        const logoutReturn = '/frontend-pilot/help?doc=packing_lists&locale=en';
        await nativePage.goto(logoutReturn);
        await waitForPilotHydration(nativePage);
        await nativePage.locator('header .dropdown-toggle').filter({hasText: loggedIn.activeProfile!.name}).click();
        const loggedOut = nativePage.waitForResponse(response => response.request().method() === 'POST'
            && new URL(response.url()).pathname === '/api/v1/auth/logout');
        await nativePage.getByRole('button', {name: 'Logout', exact: true}).click();
        expect((await loggedOut).status()).toBe(200);
        await expect(nativePage).toHaveURL(new URL(logoutReturn, baseURL).href);
        await expect(nativePage.getByText('Logout successful', {exact: true})).toBeVisible();
        expect((await bootstrap(anonymous.request)).kind).toBe('anonymous');
    } finally {
        await anonymous.close();
    }
});

test('renders invalid guest capability links as native 401 HTML with guest-specific wording', async ({page}) => {
    const id = randomUUID();
    const token = randomUUID();
    const native = await page.request.get(`/guest/${id}/login/${token}`, {maxRedirects: 0});
    const pilot = await page.request.get(`/frontend-pilot/guest/${id}/login/${token}?locale=en`, {maxRedirects: 0});
    expect(native.status()).toBe(401);
    expect(pilot.status()).toBe(native.status());
    expect(pilot.headers()['content-type']).toContain('text/html');
    const html = await pilot.text();
    expect(html).toContain('Invalid or mismatched token');
    expect(html).not.toContain('Your session has expired');
    expect(html).toContain('"pageEntry":{"kind":"denied","status":401,"messageKey":"auth.invalidGuestLink"}');
    await page.goto(`/frontend-pilot/guest/${id}/login/${token}?locale=en`);
    await waitForPilotHydration(page);
    await expect(page.locator('#pilot-locale')).toBeEnabled();
    // A reactive locale change proves this is the hydrated error surface, not merely the
    // server's initial Error card before the production decoder and route owner run.
    await page.locator('#pilot-locale').selectOption('de');
    await expect(page.locator('#pilot-main h1')).toHaveText('Fehler');
    await expect(page.locator('#pilot-main')).toContainText('Ungültiger oder nicht passender Token');
    await expect(page.locator('#pilot-main form')).toHaveCount(0);
});

test('runs the native expiry/logout document journey before invalid stored identity becomes an API problem', async ({request, browser, baseURL}) => {
    await loginForE2E(request, createE2ELogin());
    const original = await bootstrap(request);
    const profileName = `Expiry profile ${randomUUID().slice(0, 8)}`;
    expect((await request.post('/users/profile/create', {form: {name: profileName}, maxRedirects: 0})).status()).toBe(302);
    const profile = (await bootstrap(request)).profiles.find(value => value.name === profileName)!;
    expect(profile).toBeTruthy();
    const documentContext = await browser.newContext({baseURL});
    const apiContext = await browser.newContext({baseURL});
    try {
        for (const request of [documentContext.request, apiContext.request]) {
            await loginForE2E(request, createE2ELogin());
            expect((await request.get(`/users/profile/change/${profile.id}`, {maxRedirects: 0})).status()).toBe(302);
            expect((await bootstrap(request)).activeProfile!.id).toBe(profile.id);
        }
        // Detach the profile through its real owner workflow while the two other
        // sessions retain the old serialized profile. No session fixture or DB mutation
        // bypasses middleware, persistence or the application's identity ownership check.
        expect((await request.get(`/users/profile/change/${profile.id}`, {maxRedirects: 0})).status()).toBe(302);
        expect((await request.post('/users/profile/delete', {form: {name: profileName}, maxRedirects: 0})).status()).toBe(302);
        const expiredDocument = await documentContext.request.get('/frontend-pilot/help', {maxRedirects: 0});
        expect(expiredDocument.status()).toBe(302);
        expect(expiredDocument.headers()['content-type']).not.toContain('application/json');
        const expiryPage = await documentContext.request.get(expiredDocument.headers().location!);
        expect(expiryPage.headers()['content-type']).toContain('text/html');
        expect(await expiryPage.text()).toContain('Session has expired');
        expect((await bootstrap(documentContext.request)).kind).toBe('anonymous');
        await expectProblem(await apiContext.request.get('/api/v1/session'), 401, 'AUTH_REQUIRED');
        expect((await bootstrap(apiContext.request)).kind).toBe('anonymous');
    } finally {
        await documentContext.close();
        await apiContext.close();
        await request.get(`/users/profile/change/${original.activeProfile!.id}`, {maxRedirects: 0});
    }
});

test('JavaScript-disabled interactive pages expose skeletons and notices while static Help navigation and GET search stay usable', async ({browser, baseURL}) => {
    const context = await browser.newContext({baseURL, javaScriptEnabled: false});
    try {
        await loginForE2E(context.request, createE2ELogin());
        const page = await context.newPage();
        for (const locale of ['en', 'de']) {
            await page.goto(`/frontend-pilot/packing/create?locale=${locale}`);
            await expect(page.locator('#surveyor-pilot-javascript-required')).toContainText(locale === 'de'
                ? 'Interaktive Funktionen dieser Website benötigen JavaScript.' : 'Interactive features on this site require JavaScript.');
            await expect(page.locator('[data-pilot-initial-loading]')).toBeHidden();
            await expect(page.locator('#create-title')).toHaveCount(0);
            await expect(page.locator('#pilot-locale')).toBeDisabled();
            await expect(page.locator('header button[type="submit"]')).toHaveCount(0);

            // This is real anchor navigation on the built application. Static Help
            // also submits its real GET form without a client-side API substitute.
            await page.locator('#surveyor-pilot-javascript-required').getByRole('link',
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
            await expect(page.locator('#pilot-locale')).toBeDisabled();

            await page.goto(`/frontend-pilot/users/login?locale=${locale}`);
            await expect(page.locator('#surveyor-pilot-javascript-required')).toBeVisible();
            await expect(page.locator('[data-pilot-initial-loading]')).toBeHidden();
            await expect(page.locator('#pilot-main form')).toHaveCount(0);
        }
    } finally {
        await context.close();
    }
});

test('keeps native Help path aliases authoritative while retaining authored pilot root query links', async ({request}) => {
    // Assert selection metadata rather than maintained guide wording. The real SSR
    // route must project the same search/article decision as the shared browser owner.
    const cases = [
        ['/frontend-pilot/help/search?doc=events', 'search', ''],
        ['/frontend-pilot/help/search?q=packing&doc=events', 'search', 'packing'],
        ['/frontend-pilot/help/packing_lists?q=ignored&doc=events', 'packing_lists', undefined],
        ['/frontend-pilot/help/readme?q=ignored&doc=events', 'readme', undefined],
        ['/frontend-pilot/help?q=packing&doc=events', 'search', 'packing'],
        ['/frontend-pilot/help?doc=packing_lists', 'packing_lists', undefined],
    ] as const;
    for (const [path, currentDoc, searchQuery] of cases) {
        const response = await request.get(path);
        expect(response.status()).toBe(200);
        const html = await response.text();
        const serialized = html.match(/<script id="surveyor-pilot-state" type="application\/json">([^<]+)<\/script>/u)?.[1];
        expect(serialized).toBeTruthy();
        const state = JSON.parse(serialized!) as {help: components['schemas']['HelpPageData']};
        expect(state.help.currentDoc).toBe(currentDoc);
        expect(state.help.searchQuery).toBe(searchQuery);
        expect(html).toContain(searchQuery === undefined ? 'card-body help-content' : 'card-body help-search-results');
    }

    // A nonexistent synthetic slug crosses the real controller/HTTP boundary without
    // depending on maintained guide prose. Native and pilot documents retain their
    // complete Error card, while the API reports its authored structured rejection.
    const missing = `missing-${randomUUID()}`;
    for (const path of [`/help/${missing}`, `/frontend-pilot/help/${missing}`, `/frontend-pilot/help?doc=${missing}`]) {
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
        expect((await guestContext.request.post(`${list.path}/guest`, {form: {username: guestName}, maxRedirects: 0})).status()).toBe(302);
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
    await expectProblem(await request.patch(path, {headers: {'X-Surveyor-Context': session.context}, data: {title: 'No CSRF'}}), 403, 'CSRF_INVALID');
    await expectProblem(await request.patch(path, {headers: {...patchHeaders, Origin: 'https://other.example'}, data: {title: 'Foreign origin'}}), 403, 'CSRF_INVALID');
    await expectProblem(await request.patch(path, {headers: {...patchHeaders, 'Sec-Fetch-Site': 'cross-site'}, data: {title: 'Cross site'}}), 403, 'CSRF_INVALID');
    await expectProblem(await request.get('/api/v1/packing-lists/not-a-uuid', {headers}), 400, 'VALIDATION_FAILED');
    await expectProblem(await request.patch(path, {headers: patchHeaders, data: {title: false}}), 400, 'VALIDATION_FAILED');
    await expectProblem(await request.patch(path, {headers: patchHeaders, data: {title: 'Forged', profileId: session.activeProfile!.id}}), 400, 'VALIDATION_FAILED');
    await expectProblem(await request.patch(path, {headers: patchHeaders, form: {title: 'Wrong media'}}), 415, 'UNSUPPORTED_MEDIA_TYPE');
    await expectProblem(await request.patch(path, {headers: {...patchHeaders, 'Content-Type': 'application/json'}, data: '{invalid'}), 400, 'INVALID_JSON');

    // The two HTTP generations share normalization and authored constraints, while the
    // original native envelope keeps its precise field diagnostics. Literal oracles
    // prevent a shared catalog/adapter regression from passing a native/pilot comparison.
    const invalidNativeProperties = [
        {body: {title: '   '}, message: '"title" is not allowed to be empty'},
        {body: {description: 'D'.repeat(16001)}, message: '"description" length must be less than or equal to 16000 characters long'},
        {body: {}, message: '"value" must have at least 1 key'},
    ];
    for (const invalid of invalidNativeProperties) {
        const native = await request.post(`/api/packing/${list.id}/update`, {data: invalid.body});
        expect(native.status()).toBe(400);
        expect(await native.json()).toEqual({status: 'error', message: invalid.message, data: {}});
        const versioned = await request.patch(path, {headers: patchHeaders, data: invalid.body});
        await expectProblem(versioned, 400, 'VALIDATION_FAILED');
        expect(await versioned.json()).toMatchObject({detail: 'Check the submitted values.'});
    }
    const nativeDescription = await request.post(`/api/packing/${list.id}/description`, {data: {description: 'D'.repeat(16001)}});
    expect(nativeDescription.status()).toBe(400);
    expect(await nativeDescription.json()).toEqual({status: 'error',
        message: '"description" length must be less than or equal to 16000 characters long', data: {}});

    // The original description adapter supplied an optional own key even when omitted.
    // TypeORM performs its tracking-only update: the native operation succeeds without
    // clearing either property. This accepted native input must not weaken v1's empty-patch rule.
    const missingNativeDescription = await request.post(`/api/packing/${list.id}/description`, {data: {}});
    expect(missingNativeDescription.status()).toBe(200);
    expect(await missingNativeDescription.json()).toEqual({status: 'success', message: 'Description updated', data: null});
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
    expect((await request.post(`/api/packing/${list.id}/description`, {
        data: {description: 'Legacy tab edit', expectedValue: 'Independent description'},
    })).ok()).toBe(true);
    await expectProblem(await request.patch(path, {headers: {...headers, 'If-Match': currentTag}, data: {description: 'Would overwrite description'}}), 412, 'PRECONDITION_FAILED');
    const latest = await request.get(path, {headers});
    expect(await latest.json()).toMatchObject({values: {title, description: 'Legacy tab edit'}});
    const staleNative = await request.post(`/api/packing/${list.id}/description`, {
        data: {description: 'Stale native edit', expectedValue: 'Independent description'},
    });
    // Original native description requests ignore extra comparison evidence;
    // only v1 requires its reviewed If-Match token. Keep that compatibility gap
    // explicit rather than changing the existing native endpoint to fix it.
    expect(staleNative.status()).toBe(200);
    expect(await staleNative.json()).toMatchObject({status: 'success'});
    await expectProblem(await request.patch(path, {headers: {...headers, 'If-Match': latest.headers().etag},
        data: {description: 'Stale versioned edit'}}), 412, 'PRECONDITION_FAILED');
    const staleSetup = await request.post(`/api/packing/${list.id}/update`, {
        data: {description: 'Stale native setup', expectedValues: {description: 'Shared equipment'}},
    });
    expect(staleSetup.status()).toBe(400);
    expect(await staleSetup.json()).toMatchObject({status: 'error', message: 'Unknown entity property.', data: {field: 'expectedValues'}});

    // Native Joi and HTML maxlength count UTF-16 units; the authored v1 JSON Schema
    // counts code points. Preserve both existing transport meanings instead of silently
    // accepting longer native forms or tightening the compatible versioned contract.
    const nativeUnicodeFailures = [
        {body: {title: '\u{1F600}'.repeat(128)}, message: '"title" length must be less than or equal to 255 characters long'},
        {body: {description: '\u{1F600}'.repeat(8001)}, message: '"description" length must be less than or equal to 16000 characters long'},
    ];
    for (const invalid of nativeUnicodeFailures) {
        const native = await request.post(`/api/packing/${list.id}/update`, {data: invalid.body});
        expect(native.status()).toBe(400);
        expect(await native.json()).toEqual({status: 'error', message: invalid.message, data: {}});
    }
    const nativeUnicodeTitle = '\u{1F600}'.repeat(127);
    expect((await request.post(`/api/packing/${list.id}/update`, {data: {title: nativeUnicodeTitle}})).status()).toBe(200);
    const unicodeBaseline = await request.get(path, {headers});
    expect((await unicodeBaseline.json()).values.title).toBe(nativeUnicodeTitle);
    const codePointValues = {title: '\u{1F600}'.repeat(128), description: '\u{1F600}'.repeat(8001)};
    const unicodeVersioned = await request.patch(path, {
        headers: {...headers, 'If-Match': unicodeBaseline.headers().etag}, data: codePointValues,
    });
    expect(unicodeVersioned.status()).toBe(200);
    expect((await unicodeVersioned.json()).values).toEqual(codePointValues);
});

test('preserves harmless event-link no-ops through native and versioned HTTP without weakening changed commands', async ({request}) => {
    await loginForE2E(request, createE2ELogin());
    const list = await createApiPackingList(request);
    const event = await createResourceViaForm(request, createE2EEvent());
    const actor = await bootstrap(request);
    const headers = headersFor(actor);
    const root = `/api/v1/packing-lists/${list.id}`;

    try {
        // Both adapters retain the native unchanged branch after current authorization.
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
        expect((await request.post(`/api/packing/${list.id}/event`, {
            data: {eventId: null, expectedEventId: null},
        })).status()).toBe(200);
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
        await request.post(`/packing/${list.id}/delete`);
        await request.post(`/event/${event.id}/delete`);
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
    expect((await request.post('/users/profile/create', {form: {name: profileName}, maxRedirects: 0})).status()).toBe(302);
    const profiles = await bootstrap(request);
    const editor = profiles.profiles.find(profile => profile.name === profileName)!;
    expect(editor).toBeTruthy();
    expect((await request.get(`/users/profile/change/${editor.id}`, {maxRedirects: 0})).status()).toBe(302);
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

    // Change authority through the unchanged native settings API, then capture a
    // fresh actor context. Reorder receives only the IDs/positions it needs; neither
    // edit baseline inherits the detail page's assignment names or parent metadata.
    expect((await request.get(`/users/profile/change/${owner.activeProfile!.id}`, {maxRedirects: 0})).status()).toBe(302);
    expect((await request.post(`/api/packing/${list.id}/settings`, {
        data: {defaultPerms: {public: ['ITEM_EDIT']}},
    })).ok()).toBe(true);
    expect((await request.get(`/users/profile/change/${editor.id}`, {maxRedirects: 0})).status()).toBe(302);
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
    // baselines, revoke the only method grant through native settings, then use
    // the editor's fresh context with those still-matching private validators.
    const confirmedItem = await request.get(itemPath, {headers: orderHeaders});
    const confirmedOrder = await request.get(`${listPath}/item-order`, {headers: orderHeaders});
    expect(confirmedItem.status()).toBe(200);
    expect(confirmedOrder.status()).toBe(200);
    expect((await request.get(`/users/profile/change/${owner.activeProfile!.id}`, {maxRedirects: 0})).status()).toBe(302);
    expect((await request.post(`/api/packing/${list.id}/settings`, {
        data: {defaultPerms: {public: []}},
    })).ok()).toBe(true);
    expect((await request.get(`/users/profile/change/${editor.id}`, {maxRedirects: 0})).status()).toBe(302);
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
    expect((await request.post('/users/profile/create', {form: {name: targetName}, maxRedirects: 0})).status()).toBe(302);
    const target = (await bootstrap(request)).profiles.find(profile => profile.name === targetName)!;
    expect(target).toBeTruthy();
    expect((await request.get(`/users/profile/change/${owner.activeProfile!.id}`, {maxRedirects: 0})).status()).toBe(302);

    const firstContext = await browser.newContext({baseURL});
    const secondContext = await browser.newContext({baseURL});
    try {
        const first = firstContext.request;
        const second = secondContext.request;
        const firstSession = await bootstrap(first);
        const secondSession = await bootstrap(second);
        expect(firstSession.kind).toBe('anonymous');
        expect(firstSession.activeProfile).toBeNull();
        expect(secondSession.context).not.toBe(firstSession.context);
        const publicHeaders = headersFor(firstSession);
        const itemPath = `${rootPath}/items/${item.id}`;

        // Default access bits do not authorize editing. Public actions become
        // available only after the owner explicitly selects the native method grants.
        await expectProblem(await first.get(`${itemPath}/edit-baseline`, {headers: publicHeaders}), 403, 'FORBIDDEN');
        await expectProblem(await first.get(`${rootPath}/description`, {headers: publicHeaders}), 403, 'FORBIDDEN');
        expect((await request.post(`/api/packing/${list.id}/settings`, {data: {defaultPerms: {public: [
            'EDIT_DESC', 'EDIT_META', 'ITEM_EDIT', 'ITEM_DELETE', 'MANAGE_ASSIGNMENTS', 'MANAGE_PERMISSIONS',
        ]}}})).ok()).toBe(true);

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
        await expectProblem(await second.patch(itemPath, {headers: {...headersFor(secondSession), 'If-Match': itemBaseline.editToken},
            data: {title: 'Another anonymous context'}}), 412, 'PRECONDITION_FAILED');
        await expectProblem(await first.patch(itemPath, {headers: {...itemHeaders, 'X-CSRF-Token': 'invalid'}, data: {title: 'Missing CSRF'}}), 403, 'CSRF_INVALID');
        await expectProblem(await first.patch(itemPath, {headers: {...itemHeaders, Origin: 'https://other.example'}, data: {title: 'Cross origin'}}), 403, 'CSRF_INVALID');
        await expectProblem(await first.patch(itemPath, {headers: itemHeaders, data: {title: 'Forged actor', profileId: owner.activeProfile!.id}}), 400, 'VALIDATION_FAILED');
        expect((await first.patch(itemPath, {headers: itemHeaders, data: {title: 'Explicit public edit'}})).status()).toBe(200);
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
        const nativeSearch = await first.get('/api/users/search', {params: {q: searchQuery}});
        const profileSearch = await first.get(`${rootPath}/profiles`, {headers: publicHeaders, params: {q: searchQuery}});
        expect(nativeSearch.status()).toBe(200);
        expect(profileSearch.status()).toBe(200);
        expect(profileSearch.headers()['ratelimit-limit']).toBe(nativeSearch.headers()['ratelimit-limit']);
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

        // Revoke all explicit Public powers through the same native owner API.
        // Old comparison evidence cannot turn a current denial into a 304 or a save.
        const confirmed = await first.get(`${itemPath}/edit-baseline`, {headers: publicHeaders});
        expect((await request.post(`/api/packing/${list.id}/settings`, {data: {defaultPerms: {public: []}}})).ok()).toBe(true);
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
    expect((await context.request.post('/users/profile/create', {form: {name: profileName}, maxRedirects: 0})).status()).toBe(302);
    const withProfiles = await bootstrap(context.request);
    const alternate = withProfiles.profiles.find(profile => profile.name === profileName)!;
    expect(alternate).toBeTruthy();
    expect((await context.request.get(`/users/profile/change/${alternate.id}`, {maxRedirects: 0})).status()).toBe(302);
    await expectProblem(await context.request.get(`/api/v1/packing-lists/${list.id}`, {headers: headersFor(original)}), 409, 'SESSION_CONTEXT_CHANGED');
    await expectProblem(await context.request.patch(`/api/v1/packing-lists/${list.id}/metadata`, {
        headers: {...headersFor(original), 'If-Match': '"old"'}, data: {title: 'Old profile command'},
    }), 409, 'SESSION_CONTEXT_CHANGED');
    const switched = await bootstrap(context.request);
    expect(switched.activeProfile!.id).toBe(alternate.id);
    expect(switched.context).not.toBe(original.context);
    expect(switched.csrfToken).not.toBe(original.csrfToken);
    expect((await context.request.get(`/users/profile/change/${original.activeProfile!.id}`, {maxRedirects: 0})).status()).toBe(302);
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
        expect((await guestContext.request.post(`${list.path}/guest`, {form: {username: `Cache guest ${randomUUID().slice(0, 8)}`}, maxRedirects: 0})).status()).toBe(302);
        const guest = await bootstrap(guestContext.request);
        expect((await request.post(`/api/packing/${list.id}/event`, {data: {eventId: event.id, expectedEventId: null}})).ok()).toBe(true);
        expect((await request.post(`/api/packing/${list.id}/settings`, {data: {
            defaultPerms: {public: [], guest: [], authenticated: [], participant: []},
        }})).ok()).toBe(true);
        expect((await request.post(`/api/packing/${list.id}/admins`, {data: {profileId: guest.activeProfile!.id, perms: ['ACCESS_VIEW']}})).ok()).toBe(true);
        const path = `/api/v1/packing-lists/${list.id}`;
        const initial = await guestContext.request.get(path, {headers: headersFor(guest)});
        expect(initial.status()).toBe(200);
        const conditionalHeaders = {...headersFor(guest), 'If-None-Match': initial.headers().etag};
        const unchanged = await guestContext.request.get(path, {headers: conditionalHeaders});
        expect(unchanged.status()).toBe(304);
        expect(await unchanged.body()).toHaveLength(0);
        expect(unchanged.headers()['x-surveyor-context']).toBe(guest.context);
        expect((await request.delete(`/api/packing/${list.id}/admins/${guest.activeProfile!.id}`)).ok()).toBe(true);
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
        expect((await guestContext.request.post(`${list.path}/guest`, {form: {username: `Assign guest ${randomUUID().slice(0, 8)}`}, maxRedirects: 0})).status()).toBe(302);
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
        const nativeFull = await request.post(`/api/packing/${list.id}/assign`, {data: {itemId: item.id}});
        expect(nativeFull.status()).toBe(409);
        expect(await nativeFull.json()).toEqual({status: 'error',
            message: 'This packing item is already fully assigned', data: {itemId: item.id}});
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
        {title: 'Native capacity', maxAssignees: 1, requiredByAll: false},
        {title: 'Versioned capacity', maxAssignees: 1, requiredByAll: false},
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
            expect(before).toHaveLength(2);
            const nativeItem = before[0];
            const versionedItem = before[1];
            const native = await request.post(`/api/packing/${list.id}/item/${nativeItem.id}/attr`, {
                data: {field: 'maxAssignees', value: scenario.value},
            });
            const versioned = await request.patch(`${path}/items/${versionedItem.id}`, {
                headers: {...headers, 'If-Match': versionedItem.editToken}, data: {maxAssignees: scenario.value},
            });
            expect(native.status()).toBe(scenario.status);
            if (scenario.status === 200) {
                expect(await native.json()).toEqual({status: 'success', message: 'Item updated', data: null});
                expect(versioned.status()).toBe(200);
                expect(await versioned.json()).toMatchObject({changed: expect.any(Boolean)});
            } else {
                expect(await native.json()).toMatchObject({status: 'error', message: expect.any(String)});
                // Preserve native rejection without exposing its SQL message/schema in
                // v1. A failed persistence attempt remains a safe typed 500, not a new
                // browser/client validation rule or an automatic command replay.
                await expectProblem(versioned, 500, 'INTERNAL_ERROR');
                const problem = await versioned.json();
                expect(problem.params).toEqual({});
                expect(JSON.stringify(problem)).not.toMatch(/packing_items|max_assignees|integer value|Out of range/u);
            }
            const after = await readItems();
            const expected = scenario.status === 200 ? scenario.saved : nativeItem.maxAssignees;
            expect(after[0].maxAssignees).toBe(expected);
            expect(after[1].maxAssignees).toBe(expected);
            expect(after[0].assignedCount).toBe(0);
            expect(after[1].assignedCount).toBe(0);
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
    await expectProblem(await request.post('/api/v1/packing-lists', {headers, multipart: {data: '{bad-json'}}), 400, 'VALIDATION_FAILED');
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
    // Undefined-only native item edits historically report this exact known failure
    // after admission; root-description omission above is a distinct accepted input.
    // Exercise the real route and legacy data envelope without changing v1's closed patch.
    const missingNativeItemValues = [
        {suffix: 'description', body: {}},
        {suffix: 'attr', body: {field: 'title'}},
    ];
    for (const missing of missingNativeItemValues) {
        const native = await request.post(`/api/packing/${id}/item/${first.id}/${missing.suffix}`, {data: missing.body});
        expect(native.status()).toBe(500);
        expect(await native.json()).toEqual({status: 'error', message: 'Unknown error while saving', data: missing.body});
    }
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
