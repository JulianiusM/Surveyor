import {expect, test, type APIRequestContext, type APIResponse} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import type {components} from '../../src/types/api/v1';
import {createE2EEvent, createE2ELogin, createE2EPackingList} from '../factories/e2eCoreFactory';
import {createResourceViaForm, loginForE2E, waitForPilotHydration} from '../keywords/e2eCoreKeywords';

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
                expect(native.status()).toBe(404);
                expect(pilot.status()).toBe(native.status());
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
        expect(guestHtml).toContain('<noscript>');
        expect(guestHtml).toContain('#surveyor-pilot{display:none!important}');

        // DATA_DUPLICATE is a separate GET grant: public readers need neither a
        // profile nor detail admission, while creation remains account-only.
        const nativeDuplicate = await request.get(`${list.path}/duplicate`);
        const duplicate = await request.get(`/frontend-pilot/packing/${list.id}/duplicate?locale=de`);
        expect(duplicate.status()).toBe(nativeDuplicate.status());
        expect(duplicate.status()).toBe(200);
        const duplicateHtml = await duplicate.text();
        expect(duplicateHtml).toContain('value="E2E Core Packing List"');
        expect(duplicateHtml).toContain('Two person tent');
        expect(duplicateHtml).toContain('Für diese Seite ist JavaScript erforderlich.');
        expect(duplicateHtml.indexOf('</noscript>')).toBeLessThan(duplicateHtml.indexOf('<div id="surveyor-pilot">'));
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
        expect(nativeDenied.status()).toBe(400);
        expect(pilotDenied.status()).toBe(nativeDenied.status());
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

test('keeps exact native and SPA duplicate destinations including query context through account-only submission', async ({page, browser, baseURL}) => {
    await loginForE2E(page.request, createE2ELogin());
    const input = createE2EPackingList();
    Object.assign(input.form, {'defaultPerms[public][0]': 'DATA_DUPLICATE'});
    const list = await createResourceViaForm(page.request, input);
    const event = await createResourceViaForm(page.request, createE2EEvent());
    const anonymous = await browser.newContext({baseURL});
    try {
        const nativeReturn = `${list.path}/duplicate?eventId=${event.id}&locale=en`;
        const native = await anonymous.request.get(nativeReturn);
        expect(native.status()).toBe(200);
        const html = await native.text();
        const action = html.match(/<form[^>]*id="packingForm"[^>]*action="([^"]+)"/)?.[1]?.replaceAll('&amp;', '&');
        expect(action).toBeTruthy();
        expect(new URL(action!, baseURL).searchParams.get('next')).toBe(nativeReturn);
        const rejected = await anonymous.request.post(action!, {form: input.form, maxRedirects: 0});
        expect(rejected.status()).toBe(302);
        const login = new URL(rejected.headers().location!, baseURL);
        expect(login.pathname).toBe('/users/login');
        expect(login.searchParams.get('next')).toBe(nativeReturn);
        const resumed = await anonymous.request.post(login.pathname + login.search, {form: createE2ELogin(), maxRedirects: 0});
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

        // Exercise native POST/redirect/GET through the actual client entry. SSR-only notice
        // assertions miss a browser decoder that discards the consumed one-time feedback.
        const signedIn = await anonymous.request.post('/frontend-pilot/users/login', {maxRedirects: 0, form: {
            ...createE2ELogin(), next: pilotReturn, locale: 'de', _context: session.context,
            _csrf: session.csrfToken, _compatibility: session.deployment.apiCompatibility,
        }});
        expect(signedIn.status()).toBe(303);
        const returned = new URL(signedIn.headers().location!, baseURL);
        expect(returned.pathname + returned.search).toBe(pilotReturn);
        const nativePage = await anonymous.newPage();
        const document = await nativePage.goto(returned.pathname + returned.search);
        expect(await document!.text()).toContain('"pageNotice":{"kind":"success","messageKey":"auth.loginDone"}');
        await waitForPilotHydration(nativePage);
        await expect(nativePage.locator('#pilot-locale')).toBeEnabled();
        await expect(nativePage.getByText('Erfolgreich angemeldet.', {exact: true})).toBeVisible();
        await nativePage.locator('#pilot-locale').selectOption('en');
        await expect(nativePage.getByText('Login successful', {exact: true})).toBeVisible();

        const loggedIn = await bootstrap(anonymous.request);
        const logoutReturn = '/frontend-pilot/help?doc=packing_lists';
        const loggedOut = await anonymous.request.post('/frontend-pilot/users/logout', {maxRedirects: 0, form: {
            next: logoutReturn, locale: 'en', _context: loggedIn.context,
            _csrf: loggedIn.csrfToken, _compatibility: loggedIn.deployment.apiCompatibility,
        }});
        expect(loggedOut.status()).toBe(303);
        const logoutDestination = new URL(loggedOut.headers().location!, baseURL);
        expect(logoutDestination.pathname).toBe('/frontend-pilot/help');
        expect(logoutDestination.searchParams.get('doc')).toBe('packing_lists');
        await nativePage.goto(logoutDestination.pathname + logoutDestination.search);
        await waitForPilotHydration(nativePage);
        await expect(nativePage.locator('#pilot-locale')).toBeEnabled();
        await expect(nativePage.getByText('Logout successful.', {exact: true})).toBeVisible();
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

test('runs the native expiry/logout document journey before invalid stored identity becomes an API problem', async ({page, browser, baseURL}) => {
    await loginForE2E(page.request, createE2ELogin());
    const original = await bootstrap(page.request);
    const profileName = `Expiry profile ${randomUUID().slice(0, 8)}`;
    expect((await page.request.post('/users/profile/create', {form: {name: profileName}, maxRedirects: 0})).status()).toBe(302);
    const profile = (await bootstrap(page.request)).profiles.find(value => value.name === profileName)!;
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
        expect((await page.request.get(`/users/profile/change/${profile.id}`, {maxRedirects: 0})).status()).toBe(302);
        expect((await page.request.post('/users/profile/delete', {form: {name: profileName}, maxRedirects: 0})).status()).toBe(302);
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
        await page.request.get(`/users/profile/change/${original.activeProfile!.id}`, {maxRedirects: 0});
    }
});

test('shows the localized JavaScript fallback outside hidden interactive controls while keeping help readable', async ({browser, baseURL}) => {
    const context = await browser.newContext({baseURL, javaScriptEnabled: false});
    try {
        await loginForE2E(context.request, createE2ELogin());
        const page = await context.newPage();
        for (const locale of ['en', 'de']) {
            await page.goto(`/frontend-pilot/packing/create?locale=${locale}`);
            await expect(page.locator('noscript [role="alert"]')).toContainText(locale === 'de'
                ? 'Für diese Seite ist JavaScript erforderlich.' : 'JavaScript is required to use this page.');
            await expect(page.locator('#surveyor-pilot')).toBeHidden();
            await page.getByRole('link', {name: locale === 'de' ? 'Hilfe' : 'Help', exact: true}).click();
            await expect(page.locator('#surveyor-pilot')).toBeVisible();
            await expect(page.locator('.help-content')).toBeVisible();
            await page.goto(`/frontend-pilot/users/login?locale=${locale}`);
            await expect(page.locator('noscript [role="alert"]')).toBeVisible();
            await expect(page.locator('#surveyor-pilot')).toBeHidden();
            await expect(page.locator('#surveyor-pilot main form:visible')).toHaveCount(0);
        }
    } finally {
        await context.close();
    }
});

test('bootstraps account and guest scopes while projecting only public session and packing fields', async ({page, browser, baseURL}) => {
    await loginForE2E(page.request, createE2ELogin());
    const list = await createApiPackingList(page.request);
    const account = await bootstrap(page.request);
    expect(account.kind).toBe('account');
    expect(account.activeProfile).toEqual({id: expect.any(String), name: expect.any(String)});
    expect(Object.keys(account).sort()).toEqual(['activeProfile', 'context', 'csrfToken', 'deployment', 'kind', 'locale', 'loginUrl', 'logoutUrl', 'profiles', 'shell']);
    expect(account.deployment).toEqual({buildId: expect.any(String), apiCompatibility: expect.any(String)});
    expect(Object.keys(account.shell).sort()).toEqual(['imprintUrl', 'localLoginEnabled', 'oidcEnabled', 'oidcName', 'privacyPolicyUrl', 'version']);
    for (const profile of account.profiles) expect(Object.keys(profile).sort()).toEqual(['id', 'name']);
    await expectProblem(await page.request.get(`/api/v1/packing-lists/${list.id}`), 400, 'CONTEXT_REQUIRED');

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

test('enforces CSRF, media types, UUIDs and closed payloads before a conditional metadata save', async ({page}) => {
    await loginForE2E(page.request, createE2ELogin());
    const list = await createApiPackingList(page.request);
    const session = await bootstrap(page.request);
    const headers = headersFor(session);
    const path = `/api/v1/packing-lists/${list.id}/metadata`;
    const baseline = await page.request.get(path, {headers});
    expect(baseline.status()).toBe(200);
    const tag = baseline.headers().etag;
    expect(tag).toMatch(/^"edit-[A-Za-z0-9_-]+"$/);
    const conditionalHeaders = {...headers, 'If-None-Match': tag};
    expect((await page.request.get(path, {headers: conditionalHeaders})).status()).toBe(304);
    await expectProblem(await page.request.get(path, {
        headers: {...headers, 'If-None-Match': 'a'.repeat(4097)},
    }), 400, 'VALIDATION_FAILED');
    const patchHeaders = {...headers, 'If-Match': tag};
    await expectProblem(await page.request.patch(path, {headers: {'X-Surveyor-Context': session.context}, data: {title: 'No CSRF'}}), 403, 'CSRF_INVALID');
    await expectProblem(await page.request.patch(path, {headers: {...patchHeaders, Origin: 'https://other.example'}, data: {title: 'Foreign origin'}}), 403, 'CSRF_INVALID');
    await expectProblem(await page.request.patch(path, {headers: {...patchHeaders, 'Sec-Fetch-Site': 'cross-site'}, data: {title: 'Cross site'}}), 403, 'CSRF_INVALID');
    await expectProblem(await page.request.get('/api/v1/packing-lists/not-a-uuid', {headers}), 400, 'VALIDATION_FAILED');
    await expectProblem(await page.request.patch(path, {headers: patchHeaders, data: {title: false}}), 400, 'VALIDATION_FAILED');
    await expectProblem(await page.request.patch(path, {headers: patchHeaders, data: {title: 'Forged', profileId: session.activeProfile!.id}}), 400, 'VALIDATION_FAILED');
    await expectProblem(await page.request.patch(path, {headers: patchHeaders, form: {title: 'Wrong media'}}), 415, 'UNSUPPORTED_MEDIA_TYPE');
    await expectProblem(await page.request.patch(path, {headers: {...patchHeaders, 'Content-Type': 'application/json'}, data: '{invalid'}), 400, 'INVALID_JSON');
    await expectProblem(await page.request.patch(path, {headers, data: {title: 'Missing review'}}), 428, 'PRECONDITION_REQUIRED');
    await expectProblem(await page.request.patch(path, {headers: {...headers, 'If-Match': `W/${tag}`}, data: {title: 'Weak review'}}), 412, 'PRECONDITION_FAILED');

    // Transport normalization must match native forms: surrounding spaces do not count
    // toward the persisted title limit, and all failed requests above left this tag valid.
    const title = 'T'.repeat(255);
    const saved = await page.request.patch(path, {headers: patchHeaders, data: {title: `  ${title}  `}});
    expect(saved.status()).toBe(200);
    expect(await saved.json()).toMatchObject({values: {title, description: 'Shared equipment'}});
    expect(saved.headers().etag).not.toBe(tag);
    const refreshed = await page.request.get(path, {headers: conditionalHeaders});
    expect(refreshed.status()).toBe(200);
    expect(await refreshed.json()).toMatchObject({values: {title, description: 'Shared equipment'}});
    await expectProblem(await page.request.patch(path, {headers: patchHeaders, data: {title: 'Stale overwrite'}}), 412, 'PRECONDITION_FAILED');
    const independent = await page.request.patch(path, {headers: patchHeaders, data: {description: 'Independent description'}});
    expect(independent.status()).toBe(200);

    const currentTag = independent.headers().etag;
    expect((await page.request.post(`/api/packing/${list.id}/description`, {
        data: {description: 'Legacy tab edit', expectedValue: 'Independent description'},
    })).ok()).toBe(true);
    await expectProblem(await page.request.patch(path, {headers: {...headers, 'If-Match': currentTag}, data: {description: 'Would overwrite description'}}), 412, 'PRECONDITION_FAILED');
    const latest = await page.request.get(path, {headers});
    expect(await latest.json()).toMatchObject({values: {title, description: 'Legacy tab edit'}});
    const staleNative = await page.request.post(`/api/packing/${list.id}/description`, {
        data: {description: 'Stale native edit', expectedValue: 'Independent description'},
    });
    expect(staleNative.status()).toBe(412);
    expect(await staleNative.json()).toMatchObject({status: 'error'});
    const staleSetup = await page.request.post(`/api/packing/${list.id}/update`, {
        data: {description: 'Stale native setup', expectedValues: {description: 'Shared equipment'}},
    });
    expect(staleSetup.status()).toBe(412);
});

test('rejects old profile scopes and returns structured authentication loss after the cookie disappears', async ({page, context}) => {
    await loginForE2E(page.request, createE2ELogin());
    const list = await createApiPackingList(page.request);
    const original = await bootstrap(page.request);
    const profileName = `API alternate ${randomUUID()}`;
    expect((await page.request.post('/users/profile/create', {form: {name: profileName}, maxRedirects: 0})).status()).toBe(302);
    const withProfiles = await bootstrap(page.request);
    const alternate = withProfiles.profiles.find(profile => profile.name === profileName)!;
    expect(alternate).toBeTruthy();
    expect((await page.request.get(`/users/profile/change/${alternate.id}`, {maxRedirects: 0})).status()).toBe(302);
    await expectProblem(await page.request.get(`/api/v1/packing-lists/${list.id}`, {headers: headersFor(original)}), 409, 'SESSION_CONTEXT_CHANGED');
    await expectProblem(await page.request.patch(`/api/v1/packing-lists/${list.id}/metadata`, {
        headers: {...headersFor(original), 'If-Match': '"old"'}, data: {title: 'Old profile command'},
    }), 409, 'SESSION_CONTEXT_CHANGED');
    const switched = await bootstrap(page.request);
    expect(switched.activeProfile!.id).toBe(alternate.id);
    expect(switched.context).not.toBe(original.context);
    expect(switched.csrfToken).not.toBe(original.csrfToken);
    expect((await page.request.get(`/users/profile/change/${original.activeProfile!.id}`, {maxRedirects: 0})).status()).toBe(302);
    const restored = await bootstrap(page.request);
    expect(restored.context).not.toBe(original.context);
    await expectProblem(await page.request.get(`/api/v1/packing-lists/${list.id}`, {headers: headersFor(original)}), 409, 'SESSION_CONTEXT_CHANGED');

    // Expiry removes the cookie from subsequent requests. Preserve the old browser headers
    // to verify that private endpoints return a Problem rather than a login redirect or HTML.
    await context.clearCookies();
    await expectProblem(await page.request.get(`/api/v1/packing-lists/${list.id}`, {headers: headersFor(restored)}), 401, 'AUTH_REQUIRED');
    const anonymous = await bootstrap(page.request);
    expect(anonymous).toMatchObject({kind: 'anonymous', activeProfile: null, profiles: []});
    await expectProblem(await page.request.get(`/api/v1/packing-lists/${list.id}`, {headers: headersFor(anonymous)}), 401, 'AUTH_REQUIRED');
});

test('reauthorizes a conditional read before returning 304 or private content', async ({page, browser, baseURL}) => {
    await loginForE2E(page.request, createE2ELogin());
    const list = await createApiPackingList(page.request);
    const event = await createResourceViaForm(page.request, createE2EEvent());
    const guestContext = await browser.newContext({baseURL});
    try {
        expect((await guestContext.request.post(`${list.path}/guest`, {form: {username: `Cache guest ${randomUUID().slice(0, 8)}`}, maxRedirects: 0})).status()).toBe(302);
        const guest = await bootstrap(guestContext.request);
        expect((await page.request.post(`/api/packing/${list.id}/event`, {data: {eventId: event.id, expectedEventId: null}})).ok()).toBe(true);
        expect((await page.request.post(`/api/packing/${list.id}/settings`, {data: {
            defaultPerms: {public: [], guest: [], authenticated: [], participant: []},
        }})).ok()).toBe(true);
        expect((await page.request.post(`/api/packing/${list.id}/admins`, {data: {profileId: guest.activeProfile!.id, perms: ['ACCESS_VIEW']}})).ok()).toBe(true);
        const path = `/api/v1/packing-lists/${list.id}`;
        const initial = await guestContext.request.get(path, {headers: headersFor(guest)});
        expect(initial.status()).toBe(200);
        const conditionalHeaders = {...headersFor(guest), 'If-None-Match': initial.headers().etag};
        const unchanged = await guestContext.request.get(path, {headers: conditionalHeaders});
        expect(unchanged.status()).toBe(304);
        expect(await unchanged.body()).toHaveLength(0);
        expect(unchanged.headers()['x-surveyor-context']).toBe(guest.context);
        expect((await page.request.delete(`/api/packing/${list.id}/admins/${guest.activeProfile!.id}`)).ok()).toBe(true);
        const revoked = await guestContext.request.get(path, {headers: conditionalHeaders});
        await expectProblem(revoked, 403, 'FORBIDDEN');
        expect(await revoked.text()).not.toContain(list.title);
    } finally {
        await guestContext.close();
    }
});

test('applies captured self-membership idempotently and reports capacity without accepting a body actor', async ({page, browser, baseURL}) => {
    await loginForE2E(page.request, createE2ELogin());
    const list = await createApiPackingList(page.request);
    const owner = await bootstrap(page.request);
    const listResponse = await page.request.get(`/api/v1/packing-lists/${list.id}`, {headers: headersFor(owner)});
    const item = (await listResponse.json()).items[0];
    const path = `/api/v1/packing-lists/${list.id}/items/${item.id}/self-assignment`;
    const guestContext = await browser.newContext({baseURL});
    try {
        expect((await guestContext.request.post(`${list.path}/guest`, {form: {username: `Assign guest ${randomUUID().slice(0, 8)}`}, maxRedirects: 0})).status()).toBe(302);
        const guest = await bootstrap(guestContext.request);
        await expectProblem(await page.request.put(path, {headers: headersFor(owner), data: {profileId: guest.activeProfile!.id}}), 400, 'VALIDATION_FAILED');
        await expectProblem(await page.request.put(path, {headers: {...headersFor(owner), 'Content-Type': 'text/plain'}, data: 'unexpected'}), 400, 'VALIDATION_FAILED');
        for (let retry = 0; retry < 2; retry++) {
            const assigned = await guestContext.request.put(path, {headers: headersFor(guest)});
            expect(assigned.status()).toBe(200);
            expect(await assigned.json()).toEqual({listId: list.id, itemId: item.id, selfAssigned: true, assignedCount: 1, maxAssignees: 1});
        }
        await expectProblem(await page.request.put(path, {headers: headersFor(owner)}), 409, 'PACKING_ITEM_FULL');
        const ownView = await page.request.get(`/api/v1/packing-lists/${list.id}`, {headers: headersFor(owner)});
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

test('uses typed multipart, item/settings drafts and scoped binary transport for the complete packing workflow', async ({page}) => {
    await loginForE2E(page.request, createE2ELogin());
    const session = await bootstrap(page.request);
    const headers = headersFor(session);
    const creationContext = await page.request.get('/api/v1/packing-lists/create-context', {headers});
    expect(creationContext.status()).toBe(200);
    const creation = {title: `Typed packing ${randomUUID()}`, description: null, eventId: null,
        defaultPermissions: (await creationContext.json()).defaults,
        items: [{title: 'Tent', description: null, maxAssignees: 2, requiredByAll: false},
            {title: 'Water', description: 'Drink bottle', maxAssignees: 1, requiredByAll: true}]};
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX2kAAAAASUVORK5CYII=', 'base64');
    await expectProblem(await page.request.post('/api/v1/packing-lists', {headers, data: creation}), 415, 'UNSUPPORTED_MEDIA_TYPE');
    await expectProblem(await page.request.post('/api/v1/packing-lists', {headers, multipart: {data: '{bad-json'}}), 400, 'VALIDATION_FAILED');
    await expectProblem(await page.request.post('/api/v1/packing-lists', {headers, multipart: {
        data: JSON.stringify({...creation, items: [{...creation.items[0], maxAssignees: false}]}),
    }}), 400, 'VALIDATION_FAILED');
    const created = await page.request.post('/api/v1/packing-lists', {headers, multipart: {
        data: JSON.stringify(creation), image: {name: 'header.png', mimeType: 'image/png', buffer: png},
    }});
    expect(created.status()).toBe(201);
    const id = (await created.json()).id as string;
    const root = `/api/v1/packing-lists/${id}`;
    expect(created.headers().location).toBe(root);
    async function view(): Promise<components['schemas']['PackingListView']> {
        const response = await page.request.get(root, {headers});
        expect(response.status()).toBe(200);
        return response.json();
    }
    async function settings(): Promise<components['schemas']['PackingSettings']> {
        const response = await page.request.get(`${root}/settings`, {headers});
        expect(response.status()).toBe(200);
        return response.json();
    }
    let current = await view();
    expect(current.items.map(item => item.position)).toEqual([0, 1]);
    expect(current.headerUrl).toBe(`${root}/header`);
    const binary = await page.request.get(current.headerUrl!, {headers});
    expect(binary.status()).toBe(200);
    expect(binary.headers()['x-surveyor-context']).toBe(session.context);
    expect(await binary.body()).toEqual(png);
    await expectProblem(await page.request.get(current.headerUrl!), 400, 'CONTEXT_REQUIRED');
    const first = current.items[0];
    await expectProblem(await page.request.patch(`${root}/items/${first.id}`, {headers, data: {title: 'No token'}}), 428, 'PRECONDITION_REQUIRED');
    expect((await page.request.patch(`${root}/items/${first.id}`, {headers: {...headers, 'If-Match': first.editToken}, data: {title: 'Updated tent'}})).status()).toBe(200);
    await expectProblem(await page.request.patch(`${root}/items/${first.id}`, {headers: {...headers, 'If-Match': first.editToken}, data: {title: 'Stale'}}), 412, 'PRECONDITION_FAILED');
    const createdItem = await page.request.post(`${root}/items`, {headers, data: {title: 'Towels', description: null, maxAssignees: 1, requiredByAll: false}});
    expect(createdItem.status()).toBe(201);
    expect(createdItem.headers().location).toBe(`${root}#${(await createdItem.json()).id}`);
    current = await view();
    const reversed = current.items.map(item => item.id).reverse();
    expect((await page.request.put(`${root}/item-order`, {headers: {...headers, 'If-Match': current.orderToken}, data: {itemIds: reversed}})).status()).toBe(200);
    expect((await view()).items.map(item => item.id)).toEqual(reversed);
    const beforeHeader = await settings();
    expect((await page.request.put(`${root}/header`, {headers: {...headers, 'If-Match': beforeHeader.settingsToken}, multipart: {
        image: {name: 'replacement.png', mimeType: 'image/png', buffer: png},
    }})).status()).toBe(200);
    const afterHeader = await settings();
    expect(afterHeader.headerVersion).not.toBe(beforeHeader.headerVersion);
    // A changed image does not invalidate an independently reviewed audience mask.
    expect((await page.request.put(`${root}/default-permissions`, {headers: {...headers, 'If-Match': beforeHeader.settingsToken}, data: {guest: 16}})).status()).toBe(200);
    await expectProblem(await page.request.put(`${root}/default-permissions`, {headers: {...headers, 'If-Match': beforeHeader.settingsToken}, data: {guest: 0}}), 412, 'PRECONDITION_FAILED');
    const adminProfile = session.activeProfile!.id;
    expect((await page.request.post(`${root}/admins`, {headers: {...headers, 'If-Match': beforeHeader.settingsToken}, data: {profileId: adminProfile, mask: 1}})).status()).toBe(200);
    const adminBaseline = (await settings()).access!.admins.find(admin => admin.profileId === adminProfile)!;
    expect((await page.request.patch(`${root}/admins/${adminProfile}`, {headers: {...headers, 'If-Match': adminBaseline.editToken}, data: {mask: 2}})).status()).toBe(200);
    await expectProblem(await page.request.patch(`${root}/admins/${adminProfile}`, {headers: {...headers, 'If-Match': adminBaseline.editToken}, data: {mask: 1}}), 412, 'PRECONDITION_FAILED');
    const freshAdmin = (await settings()).access!.admins.find(admin => admin.profileId === adminProfile)!;
    expect((await page.request.delete(`${root}/admins/${adminProfile}`, {headers: {...headers, 'If-Match': freshAdmin.editToken}})).status()).toBe(200);
    expect((await page.request.delete(`${root}/header`, {headers: {...headers, 'If-Match': afterHeader.settingsToken}})).status()).toBe(200);
    await expectProblem(await page.request.get(`${root}/header`, {headers}), 404, 'NOT_FOUND');
    expect((await page.request.post(`${root}/archive`, {headers})).status()).toBe(200);
    expect((await view()).archived).toBe(true);
    expect((await page.request.post(`${root}/restore`, {headers})).status()).toBe(200);
    const duplicate = await page.request.get(`${root}/duplicate`, {headers});
    expect(duplicate.status()).toBe(200);
    expect(await duplicate.json()).toMatchObject({eventId: null, title: creation.title, items: expect.any(Array)});
    const overviewQuery = {collection: 'owner', region: 'main', q: creation.title};
    const overview = await page.request.get('/api/v1/overview', {headers, params: overviewQuery});
    expect(overview.status()).toBe(200);
    expect((await overview.json()).items.map((card: {id: string}) => card.id)).toEqual([id]);
    await expectProblem(await page.request.get('/api/v1/overview', {headers, params: {...overviewQuery, profileId: session.activeProfile!.id}}), 400, 'VALIDATION_FAILED');
    const visibilityPath = `/api/v1/overview/packing/${id}/visibility`;
    expect((await page.request.put(visibilityPath, {headers, data: {visibility: 'hidden'}})).status()).toBe(200);
    const hidden = await page.request.get('/api/v1/overview', {headers, params: {...overviewQuery, region: 'hidden'}});
    expect((await hidden.json()).items.map((card: {id: string}) => card.id)).toEqual([id]);
    expect((await view()).archived).toBe(false);
    expect((await page.request.delete(root, {headers})).status()).toBe(200);
    await expectProblem(await page.request.get(root, {headers}), 404, 'NOT_FOUND');
});
