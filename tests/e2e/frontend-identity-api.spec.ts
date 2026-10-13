import {test, expect, type APIRequestContext, type APIResponse, type Response, type Request} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import type {components} from '../../src/types/api/v1';
import type {FrontendPilotBootstrap} from '../../src/types/FrontendPilotTypes';
import {createE2ELogin, createE2EPackingList} from '../factories/e2eCoreFactory';
import {createResourceViaForm, loginForE2E, readAccountRegistrationCountsForE2E, readGuestRegistrationCountsForE2E, withPasswordResetAccountForE2E} from '../keywords/e2eCoreKeywords';
import {waitForPilotHydration} from '../keywords/frontendDynamicKeywords';

type SessionView = components['schemas']['SessionView'];

async function session(request: APIRequestContext): Promise<SessionView> {
    const response = await request.get('/api/v1/session');
    expect(response.status()).toBe(200);
    const view = await response.json() as SessionView;
    expect(response.headers()['x-surveyor-context']).toBe(view.context);
    return view;
}

/** Native and Vue slot comments differ; they never change the visible alert sentence. */
function renderedIdentityError(html: string): string | undefined {
    const content = html.match(/<div class="[^"]*alert-danger[^"]*"[^>]*>(.*?)<\/div>/u)?.[1];
    return content?.replace(/<!--[\s\S]*?-->/gu, '');
}

/** Match actual rendered fields rather than inferring browser constraints from the schema. */
function renderedIdentityInput(html: string, name: string): string | undefined {
    const inputs = html.match(/<input\b[^>]*>/gu) ?? [];
    for (const input of inputs) {
        if (input.includes(`name="${name}"`)) return input;
    }
    return undefined;
}

/** Browser validity evidence contains counts/flags only, never the entered credential. */
function passwordInputValidity(input: HTMLElement) {
    const field = input as HTMLInputElement;
    return {length: field.value.length, minimum: field.minLength,
        tooShort: field.validity.tooShort, valid: field.checkValidity()};
}

/** Use the ordinary native creation route to supply a publicly readable guest-entry list. */
async function createGuestEntryList(request: APIRequestContext) {
    await loginForE2E(request, createE2ELogin());
    const input = createE2EPackingList();
    Object.assign(input.form, {'defaultPerms[public][0]': 'ACCESS_VIEW'});
    return createResourceViaForm(request, input);
}

/** Select the actual rendered document's bootstrap, without a synthetic success fixture. */
function documentBootstrap(html: string): FrontendPilotBootstrap {
    const serialized = html.match(/<script id="surveyor-pilot-state" type="application\/json">([^<]+)<\/script>/u)?.[1];
    expect(serialized).toBeTruthy();
    return JSON.parse(serialized!) as FrontendPilotBootstrap;
}

test('disabled authentication configuration preserves native document outcomes and authored API problems', async ({request}) => {
    const view = await session(request);
    test.skip(view.shell.localLoginEnabled, 'This boundary requires an effective local-login-disabled server configuration.');
    const options = {headers: {'Accept-Language': 'en', 'X-Surveyor-Locale': 'en'}, maxRedirects: 0};

    // Inspect the first hop without discovering a real provider. Native Login/Register
    // enters OIDC even when that endpoint subsequently reports its disabled setting.
    for (const form of ['login', 'register']) {
        const nativeEntry = await request.get(`/users/${form}`, options);
        const pilotEntry = await request.get(`/frontend-pilot/users/${form}`, options);
        expect(nativeEntry.status()).toBe(302);
        expect(nativeEntry.headers().location).toBe('/users/oidc/login');
        expect(pilotEntry.status()).toBe(302);
        expect(new URL(pilotEntry.headers().location, 'http://fixture').pathname).toBe('/frontend-pilot/users/oidc/login');
        if (!view.shell.oidcEnabled) {
            for (const url of [nativeEntry.headers().location, pilotEntry.headers().location]) {
                const denial = await request.get(url, options);
                expect(denial.status()).toBe(500);
                const html = await denial.text();
                expect(renderedIdentityError(html)).toBe('OIDC provider is not enabled!');
                expect(html).not.toContain('<form');
            }
        }
    }

    for (const suffix of ['forgot-password', 'reset-password/unread-token', 'activate/unread-token']) {
        for (const prefix of ['/users', '/frontend-pilot/users']) {
            const denial = await request.get(`${prefix}/${suffix}`, options);
            expect(denial.status()).toBe(500);
            const html = await denial.text();
            expect(renderedIdentityError(html)).toBe('Login is not enabled!');
            expect(html).not.toContain('<form');
        }
    }

    // Invalid bodies deliberately lack context/CSRF/required fields. Configuration has
    // the same native precedence and cannot accidentally expose a credential form.
    for (const suffix of ['login', 'register', 'forgot-password', 'reset-password/unread-token']) {
        for (const prefix of ['/users']) {
            const denial = await request.post(`${prefix}/${suffix}`, {...options, form: {password: 'untrusted secret'}});
            expect(denial.status()).toBe(500);
            const html = await denial.text();
            expect(renderedIdentityError(html)).toBe('Login is not enabled!');
            expect(html).not.toContain('untrusted secret');
            expect(html).not.toContain('<form');
        }
    }

    const api = await request.post('/api/v1/auth/login', {headers: headers(view),
        data: {username: 'configuration-fixture', password: 'unsubmitted password'}});
    expect(api.status()).toBe(403);
    expect(await api.json()).toMatchObject({status: 403, code: 'LOCAL_LOGIN_DISABLED', messageKey: 'api:errors.LOCAL_LOGIN_DISABLED'});
});

function headers(view: SessionView): Record<string, string> {
    return {'X-Surveyor-Context': view.context, 'X-CSRF-Token': view.csrfToken, 'X-Surveyor-Locale': 'de'};
}

test('native form rejections and mounted pilot constraints retain the shared typed API problems', async ({request, page}) => {
    const before = await session(request);
    const password = 'A1'.repeat(501);
    const username = `unmatched-${randomUUID()}`;
    const registration = {username: `mismatch-${randomUUID()}`, displayname: 'Unsubmitted account',
        email: `mismatch-${randomUUID()}@example.invalid`, password: 'First-password!A1', password_repeat: 'Second-password!A1'};
    const cases: Array<{path: string; apiPath: string; form: Record<string, string>;
        code: string; apiStatus: number; message: string}> = [
        {path: '/users/login', apiPath: '/api/v1/auth/login', form: {username, password},
            code: 'INVALID_CREDENTIALS', apiStatus: 401, message: 'Invalid username/email or password'},
        {path: '/users/register', apiPath: '/api/v1/auth/register', form: registration,
            code: 'PASSWORD_MISMATCH', apiStatus: 400, message: 'Passwords do not match.'},
        {path: '/users/register', apiPath: '/api/v1/auth/register',
            form: {...registration, username: createE2ELogin().username, password_repeat: registration.password},
            code: 'USERNAME_TAKEN', apiStatus: 409, message: 'This username is already taken.'},
    ];

    for (const path of ['/users/login', '/users/register']) {
        const entry = await request.get(`${path}?locale=en`);
        expect(entry.status()).toBe(200);
        const html = await entry.text();
        const input = renderedIdentityInput(html, 'password');
        expect(input).toContain('minlength="8"');
        expect(input).not.toContain('maxlength=');

        // Interactive controls exist only after the real built client initializes.
        await page.goto(`/frontend-pilot${path}?locale=en`);
        await waitForPilotHydration(page);
        await expect(page.locator('input[name="password"]')).toHaveAttribute('minlength', '8');
        await expect(page.locator('input[name="password"]')).not.toHaveAttribute('maxlength');
        if (path.endsWith('/register')) {
            expect(renderedIdentityInput(html, 'password_repeat')).not.toContain('maxlength=');
            await expect(page.locator('input[name="password_repeat"]')).not.toHaveAttribute('maxlength');
        }
    }

    // Fully valid input reaches the native controller. The long credential must not
    // become a schema failure, and a mismatch/taken username must create no account.
    for (const testCase of cases) {
        const native = await request.post(testCase.path, {form: testCase.form, maxRedirects: 0});
        expect(native.status()).toBe(500);
        expect(renderedIdentityError(await native.text())).toBe(testCase.message);

        const api = await request.post(testCase.apiPath, {data: testCase.form,
            headers: {...headers(before), 'X-Surveyor-Locale': 'en'}, maxRedirects: 0});
        expect(api.status()).toBe(testCase.apiStatus);
        expect(await api.json()).toMatchObject({code: testCase.code, status: testCase.apiStatus, params: {}});
    }

    // The enhanced transport owns context/CSRF and generated input admission;
    // no ordinary HTML POST adapter remains in the pilot namespace.
    const admission = await request.post('/api/v1/auth/login', {
        data: {username, password}, headers: {'X-Surveyor-Context': before.context},
    });
    expect(admission.status()).toBe(403);
    expect(await admission.json()).toMatchObject({code: 'CSRF_INVALID'});
    const invalidInput = await request.post('/api/v1/auth/login', {
        data: {username, password: ''}, headers: headers(before),
    });
    expect(invalidInput.status()).toBe(400);
    expect(await invalidInput.json()).toMatchObject({code: 'VALIDATION_FAILED'});
});

test('native and mounted pilot recovery retain unbounded inputs and privacy-preserving API completion', async ({request, page}) => {
    const before = await session(request);
    const cases = [
        {path: '/users/forgot-password', entryPath: '/users/forgot-password', field: 'username',
            input: `no-existing-account-${'x'.repeat(100)}`, apiPath: '/api/v1/auth/forgot-password',
            message: 'A link has been sent to the email corresponding to this account (if present).'},
        {path: '/guest/recovery', entryPath: '/users/login', field: 'email',
            input: `no-existing-guest@${'subdomain.'.repeat(9)}example.invalid`, apiPath: '/api/v1/auth/guest-recovery',
            message: 'The link(s) to your guest account(s) have been sent to your email address.'},
    ];

    for (const testCase of cases) {
        expect(testCase.input.length).toBeGreaterThan(100);
        const entry = await request.get(`${testCase.entryPath}?locale=en`);
        expect(entry.status()).toBe(200);
        expect(renderedIdentityInput(await entry.text(), testCase.field)).not.toContain('maxlength=');
        await page.goto(`/frontend-pilot${testCase.entryPath}?locale=en`);
        await waitForPilotHydration(page);
        await expect(page.locator(`input[name="${testCase.field}"]`)).not.toHaveAttribute('maxlength');

        const form = {[testCase.field]: testCase.input};
        const native = await request.post(testCase.path, {form});
        expect(native.status()).toBe(200);
        expect(await native.text()).toContain(testCase.message);
        const api = await request.post(testCase.apiPath, {data: form, headers: headers(before)});
        expect(api.status()).toBe(200);
        expect(await api.json()).toMatchObject({changed: true});
    }
});

async function identity(response: APIResponse | Response, previous: SessionView): Promise<components['schemas']['IdentityResult']> {
    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toContain('no-store');
    const result = await response.json() as components['schemas']['IdentityResult'];
    expect(response.headers()['x-surveyor-context']).toBe(result.session.context);
    expect(result.session.context).not.toBe(previous.context);
    expect(result.session.csrfToken).not.toBe(previous.csrfToken);
    return result;
}

/** Read the actual styled completion, after fonts have loaded in the browser. */
function resetPresentation() {
    const message = document.querySelector<HTMLElement>('main .alert-success')!;
    const card = message.closest<HTMLElement>('.card')!;
    const style = getComputedStyle(message);
    const messageBounds = message.getBoundingClientRect();
    const cardBounds = card.getBoundingClientRect();

    return {
        text: message.textContent!.trim(),
        typography: {fontFamily: style.fontFamily, fontSize: style.fontSize,
            fontWeight: style.fontWeight, lineHeight: style.lineHeight, letterSpacing: style.letterSpacing},
        message: {width: messageBounds.width, height: messageBounds.height},
        card: {x: cardBounds.x, y: cardBounds.y, width: cardBounds.width, height: cardBounds.height},
        fonts: {status: document.fonts.status, iconsLoaded: document.fonts.check('16px bootstrap-icons')},
        stylesheets: Array.from(document.styleSheets, stylesheet => stylesheet.href),
    };
}

test('identity commands bind old admission and new results while retaining localized credential distinctions', async ({request}) => {
    const anonymous = await session(request);
    const credentials = createE2ELogin();
    const denied = await request.post('/api/v1/auth/login', {data: credentials,
        headers: {'X-Surveyor-Context': anonymous.context}});
    expect(denied.status()).toBe(403);
    expect(await denied.json()).toMatchObject({code: 'CSRF_INVALID'});
    const invalid = await request.post('/api/v1/auth/login', {headers: headers(anonymous),
        data: {...credentials, password: 'deliberately-wrong-password'}});
    expect(invalid.status()).toBe(401);
    expect(invalid.headers()['content-language']).toBe('de');
    expect(await invalid.json()).toMatchObject({code: 'INVALID_CREDENTIALS', messageKey: 'api:errors.INVALID_CREDENTIALS'});
    expect((await session(request)).context).toBe(anonymous.context);

    const login = await identity(await request.post('/api/v1/auth/login', {headers: headers(anonymous), data: credentials}), anonymous);
    expect(login).toMatchObject({session: {kind: 'account'}, personalLink: null, redirect: null});
    const obsolete = await request.post('/api/v1/auth/logout', {headers: headers(anonymous)});
    expect(obsolete.status()).toBe(409);
    expect(await obsolete.json()).toMatchObject({code: 'SESSION_CONTEXT_CHANGED'});

    const name = `Identity alternate ${randomUUID().slice(0, 8)}`;
    expect((await request.post('/users/profile/create', {form: {name}, maxRedirects: 0})).status()).toBe(302);
    const beforeSwitch = await session(request);
    const target = beforeSwitch.profiles.find(profile => profile.name === name)!;
    expect(target).toBeTruthy();
    const invalidProfile = await request.put('/api/v1/auth/profile', {headers: headers(beforeSwitch), data: {profileId: randomUUID()}});
    expect(invalidProfile.status()).toBe(400);
    const switched = await identity(await request.put('/api/v1/auth/profile', {headers: headers(beforeSwitch), data: {profileId: target.id}}), beforeSwitch);
    expect(switched.session.activeProfile).toEqual(target);
    // Returning to the original profile uses the same declared command and
    // receives a new admitted context, without a separate document transition.
    const originalProfile = switched.session.profiles.find(profile => profile.id !== target.id)!;
    const restored = await identity(await request.put('/api/v1/auth/profile', {
        headers: headers(switched.session), data: {profileId: originalProfile.id},
    }), switched.session);
    expect(restored.session.activeProfile).toEqual(originalProfile);
    const afterRestore = await session(request);
    expect(afterRestore.context).toBe(restored.session.context);

    const logout = await identity(await request.post('/api/v1/auth/logout', {headers: headers(afterRestore)}), afterRestore);
    expect(logout).toMatchObject({session: {kind: 'anonymous', activeProfile: null, profiles: []}, personalLink: null, redirect: null});
    expect((await session(request)).context).toBe(logout.session.context);
});

test('guest creation and emailed personal URLs stay in the frontend and authenticate on their initial GET', async ({request, browser, baseURL}) => {
    const list = await createGuestEntryList(request);
    const guestBrowser = await browser.newContext({baseURL});
    try {
        const anonymous = await session(guestBrowser.request);
        const entry = await guestBrowser.request.get(`/api/v1/packing-lists/${list.id}/guest`, {headers: headers(anonymous)});
        expect(entry.status()).toBe(200);
        expect(await entry.json()).toEqual({id: list.id, title: list.title});
        const username = `Own guest ${randomUUID().slice(0, 8)}`;
        const created = await identity(await guestBrowser.request.post(`/api/v1/packing-lists/${list.id}/guest`, {
            headers: headers(anonymous), data: {username, email: null},
        }), anonymous);
        expect(created.session).toMatchObject({kind: 'guest', activeProfile: {name: username}});
        const link = new URL(created.personalLink!);
        expect(link.pathname).toMatch(/^\/frontend-pilot\/guest\/[^/]+\/login\/[^/]+$/);
        expect(link.searchParams.get('next')).toBe(`/frontend-pilot/packing/${list.id}`);
        const recovered = await browser.newContext({baseURL});
        try {
            const before = await session(recovered.request);
            // Request the link path against the guarded server rather than its configured
            // deployment origin. No extra JavaScript, login button or confirmation is required.
            const landing = await recovered.request.get(link.pathname + link.search + '&locale=de', {maxRedirects: 0});
            expect(landing.status()).toBe(302);
            expect(landing.headers().location).toBe(`/frontend-pilot/packing/${list.id}?locale=de`);
            const after = await session(recovered.request);
            expect(after).toMatchObject({kind: 'guest', activeProfile: created.session.activeProfile});
            expect(after.context).not.toBe(before.context);
            expect((await recovered.request.get(link.pathname + '?next=https%3A%2F%2Foutside.invalid', {maxRedirects: 0})).headers().location).toBe('/frontend-pilot?locale=en');
        } finally { await recovered.close(); }
    } finally { await guestBrowser.close(); }
});

test('parallel guest registrations commit exactly one identity and restore its persisted profile from the winning link',
    async function concurrentGuestFinality({request, browser, baseURL}) {
        const list = await createGuestEntryList(request);
        const guest = await browser.newContext({baseURL});
        const suffix = randomUUID().slice(0, 12);
        const usernames = [`Final guest A ${suffix}`, `Final guest B ${suffix}`];
        try {
            const anonymous = await session(guest.request);
            expect(anonymous.kind).toBe('anonymous');
            expect(await readGuestRegistrationCountsForE2E(usernames)).toEqual({guests: 0, profiles: 0});

            // Both writes carry the same originally admitted cookie/context. No
            // SMTP address, request retry or test-only persistence shortcut is used.
            const path = `/api/v1/packing-lists/${list.id}/guest`;
            const responses = await Promise.all([
                guest.request.post(path, {headers: headers(anonymous), data: {username: usernames[0], email: null}}),
                guest.request.post(path, {headers: headers(anonymous), data: {username: usernames[1], email: null}}),
            ]);
            const statuses = [];
            for (const response of responses) statuses.push(response.status());
            expect([...statuses].sort()).toEqual([200, 409]);
            const winnerIndex = statuses.indexOf(200);
            const created = await identity(responses[winnerIndex], anonymous);
            const rejected = responses[1 - winnerIndex];
            expect(await rejected.json()).toMatchObject({status: 409, code: 'SESSION_CONTEXT_CHANGED'});
            expect(created).toMatchObject({emailDelivery: 'not-requested', redirect: null,
                session: {kind: 'guest', activeProfile: {name: usernames[winnerIndex]}}});

            // Independent real Guest/Profile counts reveal duplicate or orphan
            // rows even when a stale HTTP response alone looks correctly rejected.
            expect(await readGuestRegistrationCountsForE2E(usernames)).toEqual({guests: 1, profiles: 1});
            const stored = await session(guest.request);
            expect(stored).toMatchObject({kind: 'guest', context: created.session.context,
                activeProfile: created.session.activeProfile});
            const personalLink = new URL(created.personalLink!);
            expect(personalLink.pathname).toMatch(/^\/frontend-pilot\/guest\/[^/]+\/login\/[^/]+$/u);
            expect(personalLink.searchParams.get('next')).toBe(`/frontend-pilot/packing/${list.id}`);

            const restored = await browser.newContext({baseURL});
            try {
                const before = await session(restored.request);
                const login = await restored.request.get(personalLink.pathname + personalLink.search, {maxRedirects: 0});
                expect(login.status()).toBe(302);
                expect(new URL(login.headers().location, 'http://fixture').pathname).toBe(`/frontend-pilot/packing/${list.id}`);
                const after = await session(restored.request);
                expect(after).toMatchObject({kind: 'guest', activeProfile: created.session.activeProfile});
                expect(after.context).not.toBe(before.context);
            } finally {
                await restored.close();
            }
        } finally {
            await guest.close();
        }
    });

test('mounted guest creation exposes its committed personal link only to the matching identity',
    async function mountedGuestFinality({request, browser, baseURL}) {
        const list = await createGuestEntryList(request);
        const username = `Mounted guest ${randomUUID().slice(0, 12)}`;
        expect(await readGuestRegistrationCountsForE2E([username])).toEqual({guests: 0, profiles: 0});
        const guest = await browser.newContext({baseURL});
        try {
            const page = await guest.newPage();
            const anonymous = await session(guest.request);
            await page.goto(`/frontend-pilot/packing/${list.id}/guest?locale=en`);
            await waitForPilotHydration(page);
            await page.locator('#guest-name').fill(username);
            const submitted = page.waitForResponse(response => response.request().method() === 'POST'
                && new URL(response.url()).pathname === `/api/v1/packing-lists/${list.id}/guest`);
            await page.getByRole('button', {name: 'Continue as guest', exact: true}).click();
            const created = await identity(await submitted, anonymous);
            expect(created.session).toMatchObject({kind: 'guest', activeProfile: {name: username}});
            const personalLink = created.personalLink!;
            await expect(page.locator('.alert-success')).toHaveText(`Login successful. Use ${personalLink} to edit later.`);
            expect(new URL(personalLink).searchParams.get('next')).toBe(`/frontend-pilot/packing/${list.id}`);
            await expect(page.getByText('Your guest account was created, but the email could not be sent.', {exact: false})).toHaveCount(0);

            // A real account transition retires the guest's private confirmation.
            // Reloading a document may not reconstruct an API-only personal link.
            await loginForE2E(guest.request, createE2ELogin());
            await page.reload();
            await waitForPilotHydration(page);
            await expect(page.locator('#surveyor-pilot')).not.toContainText(personalLink);
            const landing = await guest.request.get('/frontend-pilot?locale=en');
            const rendered = documentBootstrap(await landing.text());
            expect(rendered.session.kind).toBe('account');
            expect(rendered.personalLink).toBeUndefined();
            expect(await readGuestRegistrationCountsForE2E([username])).toEqual({guests: 1, profiles: 1});
        } finally {
            await guest.close();
        }
    });

test('retired pilot HTML POST adapters reject without creating rows or changing the admitted actor', async ({request, browser, baseURL}) => {
    const list = await createGuestEntryList(request);
    const anonymous = await browser.newContext({baseURL});
    const username = `retired-form-${randomUUID().slice(0, 12)}`;
    try {
        const before = await session(anonymous.request);
        const paths = ['/users/login', '/users/register', '/users/forgot-password',
            `/users/reset-password/${randomUUID()}`, '/guest/recovery',
            `/packing/${list.id}/guest`, '/users/profile', '/users/logout'];
        const form = {username, displayname: username, email: `${username}@example.invalid`,
            password: 'Retired-form!A1', password_repeat: 'Retired-form!A1',
            confirmPassword: 'Retired-form!A1', profileId: randomUUID(),
            _context: before.context, _csrf: before.csrfToken,
            _compatibility: before.deployment.apiCompatibility, next: '/frontend-pilot'};
        expect(await readAccountRegistrationCountsForE2E([username])).toEqual({accounts: 0, profiles: 0, activationReady: 0});
        expect(await readGuestRegistrationCountsForE2E([username])).toEqual({guests: 0, profiles: 0});
        for (const path of paths) {
            const retired = await anonymous.request.post(`/frontend-pilot${path}`, {form, maxRedirects: 0});
            expect(retired.status()).toBe(404);
            expect(retired.headers().location).toBeUndefined();
        }
        const after = await session(anonymous.request);
        expect(after).toMatchObject({kind: 'anonymous', context: before.context, csrfToken: before.csrfToken});
        expect(await readAccountRegistrationCountsForE2E([username])).toEqual({accounts: 0, profiles: 0, activationReady: 0});
        expect(await readGuestRegistrationCountsForE2E([username])).toEqual({guests: 0, profiles: 0});
    } finally { await anonymous.close(); }
});

test('account signup commits its profile and activation token before controlled SMTP failure without exposing the token or changing identity',
    async function accountSignupFinality({request}) {
        const before = await session(request);
        expect(before.kind).toBe('anonymous');
        const suffix = randomUUID().slice(0, 12);
        const username = `final-account-${suffix}`;
        const rejectedUsername = `rejected-account-${suffix}`;
        const usernames = [username, rejectedUsername];
        const password = 'Signup-finality!A1';
        expect(await readAccountRegistrationCountsForE2E(usernames)).toEqual({accounts: 0, profiles: 0, activationReady: 0});

        // The managed E2E server owns the built mailer and an explicitly refused
        // local SMTP socket. No interceptor, external mailbox or backend mock
        // turns a mail-delivery failure into a synthetic registration result.
        const completed = await request.post('/api/v1/auth/register', {
            headers: {...headers(before), 'X-Surveyor-Locale': 'en'},
            data: {username, displayname: username, email: `${username}@example.invalid`,
                password, password_repeat: password, next: '/frontend-pilot'},
        });
        expect(completed.status()).toBe(200);
        expect(completed.headers()['cache-control']).toContain('no-store');
        expect(completed.headers()['x-surveyor-context']).toBe(before.context);
        expect(await completed.json()).toEqual({changed: true, emailDelivery: 'failed'});
        const after = await session(request);
        expect(after).toMatchObject({kind: 'anonymous', context: before.context, csrfToken: before.csrfToken});
        expect(await readAccountRegistrationCountsForE2E(usernames)).toEqual({accounts: 1, profiles: 1, activationReady: 1});

        // Native business rejection still happens before persistence. Counts for
        // both names distinguish a finalized account from an accidental partial
        // account/profile/token left by the deliberately mismatched submission.
        const rejected = await request.post('/api/v1/auth/register', {
            headers: {...headers(after), 'X-Surveyor-Locale': 'en'},
            data: {username: rejectedUsername, displayname: rejectedUsername,
                email: `${rejectedUsername}@example.invalid`, password, password_repeat: 'Different-password!A1'},
        });
        expect(rejected.status()).toBe(400);
        expect(await rejected.json()).toMatchObject({code: 'PASSWORD_MISMATCH'});
        expect(await readAccountRegistrationCountsForE2E(usernames)).toEqual({accounts: 1, profiles: 1, activationReady: 1});
        expect((await session(request)).context).toBe(before.context);
    });

test('invalid password-reset links are denied before rendering a form, with scoped localized uncached preflight', async ({request, browser, baseURL}) => {
    const anonymous = await session(request);
    const path = '/api/v1/auth/reset-password?token=not-a-valid-reset-token';
    expect((await request.get(path)).status()).toBe(400);
    const stale = await request.get(path, {headers: {'X-Surveyor-Context': 'obsolete-context'}});
    expect(stale.status()).toBe(409);
    expect(await stale.json()).toMatchObject({code: 'SESSION_CONTEXT_CHANGED'});
    const denied = await request.get(path, {headers: {
        'X-Surveyor-Context': anonymous.context, 'X-Surveyor-Locale': 'de',
    }});
    expect(denied.status()).toBe(401);
    expect(denied.headers()['content-type']).toContain('application/problem+json');
    expect(denied.headers()['content-language']).toBe('de');
    expect(denied.headers()['cache-control']).toContain('no-store');
    expect(denied.headers()['x-surveyor-context']).toBe(anonymous.context);
    const problem = await denied.json() as components['schemas']['Problem'];
    expect(problem).toMatchObject({code: 'TOKEN_INVALID', status: 401, messageKey: 'api:errors.TOKEN_INVALID'});
    expect((await session(request)).context).toBe(anonymous.context);

    const noScript = await browser.newContext({baseURL, javaScriptEnabled: false});
    try {
        const resetPage = await noScript.newPage();
        const response = await resetPage.goto('/frontend-pilot/users/reset-password/not-a-valid-reset-token?locale=de');
        expect(response?.status()).toBe(401);
        expect(response?.headers()['content-language']).toBe('de');
        expect(response?.headers()['cache-control']).toContain('no-store');
        // API detail remains the stable transport message. The identity page
        // presents the native operation's localized invalid-token wording.
        await expect(resetPage.getByText('Ungültiger oder abgelaufener Token', {exact: true})).toBeVisible();
        await expect(resetPage.locator('input[type="password"]')).toHaveCount(0);
    } finally { await noScript.close(); }
});

test('native and pilot known identity denials preserve the exact English message before and after hydration', async ({page}) => {
    for (const operation of ['reset-password', 'activate'] as const) {
        const path = `/users/${operation}/${randomUUID()}`;
        const native = await page.goto(path);
        expect(native?.status()).toBe(401);
        const message = await page.locator('.alert-danger').innerText();
        expect(message).toBe('Invalid or expired token');
        const pilot = await page.goto(`/frontend-pilot${path}?locale=en`);
        expect(pilot?.status()).toBe(native?.status());
        await expect(page.locator('#pilot-main .alert-danger')).toHaveText(message);
        await waitForPilotHydration(page);
        await expect(page.locator('#pilot-locale')).toBeEnabled();
        await expect(page.locator('#pilot-main .alert-danger')).toHaveText(message);
        await expect(page.locator('#pilot-main form')).toHaveCount(0);
        await expect(page.locator('#pilot-main a.btn')).toHaveAttribute('href', '/frontend-pilot');
    }
});

for (const surface of ['native', 'api'] as const) {
    test(`successful ${surface} password reset consumes the link and preserves unchanged identity`, async ({request}) => {
        await withPasswordResetAccountForE2E(async function exerciseReset(username, previousPassword, token) {
            const pagePath = `${surface === 'api' ? '/frontend-pilot' : ''}/users/reset-password/${token}?locale=en`;
            const commandPath = surface === 'api' ? '/api/v1/auth/reset-password' : pagePath;
            const before = await session(request);
            const admission = await request.get(pagePath);
            expect(admission.status()).toBe(200);
            const admissionHtml = await admission.text();
            if (surface === 'api') {
                // GET still admits the token before the skeleton boot. Form constraints
                // are exercised through the real mounted browser in the next cases.
                expect(documentBootstrap(admissionHtml).passwordReset).toEqual({valid: true});
            } else {
                for (const name of ['password', 'confirmPassword']) {
                    expect(renderedIdentityInput(admissionHtml, name)).toContain('minlength="8"');
                    expect(renderedIdentityInput(admissionHtml, name)).not.toContain('maxlength=');
                }
            }

            const password = `Replacement-password!A1${'x'.repeat(1001)}`;
            const input = {password, confirmPassword: password};
            const mismatchInput = {...input, confirmPassword: 'Different-password!A1'};
            const mismatch = surface === 'api'
                ? await request.post(commandPath, {data: {...mismatchInput, token}, headers: headers(before)})
                : await request.post(commandPath, {form: mismatchInput, maxRedirects: 0});
            expect(mismatch.status()).toBe(surface === 'api' ? 400 : 500);
            if (surface === 'api') {
                expect(await mismatch.json()).toMatchObject({code: 'PASSWORD_MISMATCH', status: 400});
            } else {
                expect(renderedIdentityError(await mismatch.text())).toBe('Passwords do not match!');
            }
            expect(await mismatch.text()).not.toContain(password);

            // Both real transports invoke their existing shared controller. The API
            // commits its prepared scalar receipt; native keeps its document Success.
            const completion = surface === 'api'
                ? await request.post(commandPath, {data: {...input, token}, headers: headers(before)})
                : await request.post(commandPath, {form: input, maxRedirects: 0});
            expect(completion.status()).toBe(200);
            expect(completion.headers().location).toBeUndefined();
            if (surface === 'api') {
                expect(await completion.json()).toEqual({changed: true});
            } else {
                const html = await completion.text();
                expect(html).toContain('Success');
                expect(html).toContain('Your password has been successfully reset');
                expect(html).not.toContain('name="confirmPassword"');
            }
            expect((await session(request)).context).toBe(before.context);
            expect((await request.get(pagePath)).status()).toBe(401);
            const replay = surface === 'api'
                ? await request.post(commandPath, {data: {...input, token}, headers: headers(before)})
                : await request.post(commandPath, {form: input, maxRedirects: 0});
            expect(replay.status()).toBe(401);
            const oldLogin = await request.post('/users/login', {form: {username, password: previousPassword}, maxRedirects: 0});
            expect(oldLogin.status()).toBe(500);
            await loginForE2E(request, {username, password});
            const account = await session(request);
            const enhancedLogin = await identity(await request.post('/api/v1/auth/login', {
                data: {username, password}, headers: headers(account),
            }), account);
            expect(enhancedLogin.session.kind).toBe('account');
        });
    });
}

for (const surface of ['native', 'pilot'] as const) {
    test(`${surface} browser reset accepts the native UTF-16 minimum and the complete credential subsequently logs in`, async ({page}) => {
        await withPasswordResetAccountForE2E(async function exerciseUnicodeReset(username, _previousPassword, token) {
            const path = `${surface === 'pilot' ? '/frontend-pilot' : ''}/users/reset-password/${token}?locale=en`;
            expect((await page.goto(path))?.status()).toBe(200);
            if (surface === 'pilot') await waitForPilotHydration(page);
            const passwordField = page.locator('input[name="password"]');
            const repetition = page.locator('input[name="confirmPassword"]');
            const password = 'A1😀😀😀';

            // Use actual browser input, not programmatic value assignment: native
            // minlength validity is user-input-sensitive and counts UTF-16 units.
            await passwordField.fill('A1😀😀x');
            expect(await passwordField.evaluate(passwordInputValidity))
                .toEqual({length: 7, minimum: 8, tooShort: true, valid: false});
            await passwordField.fill(password);
            await repetition.fill(password);
            for (const field of [passwordField, repetition]) {
                expect(await field.evaluate(passwordInputValidity))
                    .toEqual({length: 8, minimum: 8, tooShort: false, valid: true});
            }

            function isResetCommand(response: Response): boolean {
                const expected = surface === 'pilot' ? '/api/v1/auth/reset-password' : `/users/reset-password/${token}`;
                return response.request().method() === 'POST' && new URL(response.url()).pathname === expected;
            }
            const confirmation = page.waitForResponse(isResetCommand);
            await page.locator('form button[type="submit"]').click();
            const response = await confirmation;
            expect(response.status()).toBe(200);
            if (surface === 'pilot') expect(await response.json()).toMatchObject({changed: true});
            await expect(page.locator('main .alert-success')).toHaveText('Your password has been successfully reset');
            expect(new URL(page.url()).pathname).toBe(new URL(path, 'https://surveyor.invalid').pathname);
            await expect(page.locator('input[name="confirmPassword"]')).toHaveCount(0);

            // This is a real isolated account, not a seed mutation or a validation-only
            // probe. Both transports must accept the same full Unicode credential.
            await loginForE2E(page.request, {username, password});
            const account = await session(page.request);
            const enhanced = await identity(await page.request.post('/api/v1/auth/login', {
                data: {username, password}, headers: headers(account),
            }), account);
            expect(enhanced.session.kind).toBe('account');
        });
    });
}

test('native and pilot password-reset forms retain the same canonical Success presentation at desktop and mobile widths', async ({page}, testInfo) => {
    const presentations: Array<{surface: 'native' | 'pilot'; size: string; presentation: ReturnType<typeof resetPresentation>}> = [];
    const assets: Array<{surface: string; url: string; status?: number; failure?: string}> = [];
    let currentSurface = '';

    // Keep real asset evidence alongside the paired screenshots. A successful DOM
    // assertion with a missing stylesheet or font cannot establish visual parity.
    function recordAsset(response: Response): void {
        if (!['stylesheet', 'script', 'font', 'image'].includes(response.request().resourceType())) return;
        const url = new URL(response.url());
        assets.push({surface: currentSurface, url: url.host + url.pathname, status: response.status()});
    }

    function recordFailedAsset(request: Request): void {
        if (!['stylesheet', 'script', 'font', 'image'].includes(request.resourceType())) return;
        const url = new URL(request.url());
        assets.push({surface: currentSurface, url: url.host + url.pathname, failure: request.failure()?.errorText});
    }

    page.on('response', recordAsset);
    page.on('requestfailed', recordFailedAsset);
    for (const surface of ['native', 'pilot'] as const) {
        currentSurface = surface;
        await withPasswordResetAccountForE2E(async function submitResetForm(_username, _previousPassword, token) {
            const path = `${surface === 'pilot' ? '/frontend-pilot' : ''}/users/reset-password/${token}`;
            await page.setViewportSize({width: 1440, height: 1000});
            await page.goto(`${path}?locale=en`, {waitUntil: 'domcontentloaded'});
            if (surface === 'pilot') await waitForPilotHydration(page);
            await page.locator('[name="password"]').fill('Browser-replacement!A1');
            await page.locator('[name="confirmPassword"]').fill('Browser-replacement!A1');
            // Native Pug includes its icon glyph in the accessible name; Vue hides the
            // decorative icon. Preserve that existing native evidence in the locator.
            await page.getByRole('button', {name: surface === 'native' ? /Change password/u : 'Change password', exact: surface === 'pilot'}).click();
            await expect(page.getByRole('heading', {name: surface === 'native' ? /Success/u : 'Success', exact: surface === 'pilot'})).toBeVisible();
            expect(new URL(page.url()).pathname).toBe(path);
            await expect(page.locator('[name="confirmPassword"]')).toHaveCount(0);

            // Capture the actual completed native document or mounted API result.
            // Changing the viewport preserves the consumed-token completion in this page;
            // a reload would correctly perform fresh admission and deny the used token.
            for (const [size, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]] as const) {
                await page.setViewportSize({width, height});
                await page.evaluate(() => document.fonts.ready);
                expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
                presentations.push({surface, size, presentation: await page.evaluate(resetPresentation)});
                const screenshot = testInfo.outputPath(`${surface}-reset-completion-${size}.png`);
                await page.screenshot({path: screenshot, fullPage: true, animations: 'disabled'});
                await testInfo.attach(`${surface}-reset-completion-${size}`, {path: screenshot, contentType: 'image/png'});
            }
        });
    }

    await testInfo.attach('reset-presentation-and-assets', {
        body: JSON.stringify({presentations, assets}, null, 2), contentType: 'application/json',
    });
    expect(assets.filter(asset => asset.failure || (asset.status ?? 200) >= 400)).toEqual([]);
    for (const size of ['desktop', 'mobile']) {
        const native = presentations.find(entry => entry.surface === 'native' && entry.size === size)!.presentation;
        const pilot = presentations.find(entry => entry.surface === 'pilot' && entry.size === size)!.presentation;
        expect(native.fonts).toEqual({status: 'loaded', iconsLoaded: true});
        expect(pilot.fonts).toEqual(native.fonts);
        expect(pilot.text).toBe(native.text);
        expect(pilot.typography).toEqual(native.typography);

        // Compare stable geometry within the same Chromium run and viewport. The
        // message and full card reveal a wrapping regression that overflow checks miss.
        for (const dimension of ['width', 'height'] as const) {
            expect(Math.abs(pilot.message[dimension] - native.message[dimension])).toBeLessThanOrEqual(1);
        }
        for (const dimension of ['x', 'y', 'width', 'height'] as const) {
            expect(Math.abs(pilot.card[dimension] - native.card[dimension])).toBeLessThanOrEqual(1);
        }
    }
});

test('recovery GET redirects remain native while the declared API preserves privacy and rejects invalid controls', async ({request}) => {
    const native = await request.get('/guest/recovery', {maxRedirects: 0});
    expect(native.status()).toBe(302);
    expect(native.headers().location).toBe('/users/login');
    const pilot = await request.get('/frontend-pilot/guest/recovery?locale=en', {maxRedirects: 0});
    expect(pilot.status()).toBe(native.status());
    expect(pilot.headers().location).toBe('/frontend-pilot/users/login?locale=en');
    const current = await session(request);

    // Native ignores the old recovery override on an ordinary credential request.
    // The authored API independently rejects extra controls rather than changing operations.
    const loginFields = {...createE2ELogin(), password: 'deliberately-wrong-password', _recovery: '1', email: 'not-an-email-address'};
    const nativeLogin = await request.post('/users/login', {form: loginFields, maxRedirects: 0});
    expect(nativeLogin.status()).toBe(500);
    expect(renderedIdentityError(await nativeLogin.text())).toBe('Invalid username/email or password');
    const overriddenLogin = await request.post('/api/v1/auth/login', {data: loginFields, headers: headers(current)});
    expect(overriddenLogin.status()).toBe(400);
    expect(await overriddenLogin.json()).toMatchObject({code: 'VALIDATION_FAILED'});

    const rejected = await request.post('/api/v1/auth/guest-recovery', {
        data: {email: 'not-an-email-address'}, headers: headers(current),
    });
    expect(rejected.status()).toBe(400);
    expect(await rejected.json()).toMatchObject({code: 'VALIDATION_FAILED'});
    const completion = await request.post('/api/v1/auth/guest-recovery', {
        data: {email: `no-existing-guest-${randomUUID()}@example.invalid`}, headers: headers(current),
    });
    expect(completion.status()).toBe(200);
    expect(await completion.json()).toEqual({changed: true});
    expect((await session(request)).context).toBe(current.context);
    expect((await request.get('/frontend-pilot/guest/recovery', {maxRedirects: 0})).status()).toBe(302);
});
