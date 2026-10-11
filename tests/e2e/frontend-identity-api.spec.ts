import {test, expect, type APIRequestContext, type APIResponse, type Response, type Request} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import type {components} from '../../src/types/api/v1';
import {createE2ELogin, createE2EPackingList} from '../factories/e2eCoreFactory';
import {createResourceViaForm, loginForE2E, waitForPilotHydration, withPasswordResetAccountForE2E} from '../keywords/e2eCoreKeywords';

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

/** Native document commands carry exactly the admitted session's transport controls. */
function nativeIdentityControls(view: SessionView): Record<string, string> {
    return {_context: view.context, _csrf: view.csrfToken,
        _compatibility: view.deployment.apiCompatibility, locale: 'en', next: '/frontend-pilot'};
}

/** Browser validity evidence contains counts/flags only, never the entered credential. */
function passwordInputValidity(input: HTMLElement) {
    const field = input as HTMLInputElement;
    return {length: field.value.length, minimum: field.minLength,
        tooShort: field.validity.tooShort, valid: field.checkValidity()};
}

test('disabled authentication configuration preserves native document outcomes and authored API problems', async ({page}) => {
    const view = await session(page.request);
    test.skip(view.shell.localLoginEnabled, 'This boundary requires an effective local-login-disabled server configuration.');
    const options = {headers: {'Accept-Language': 'en', 'X-Surveyor-Locale': 'en'}, maxRedirects: 0};

    // Inspect the first hop without discovering a real provider. Native Login/Register
    // enters OIDC even when that endpoint subsequently reports its disabled setting.
    for (const form of ['login', 'register']) {
        const nativeEntry = await page.request.get(`/users/${form}`, options);
        const pilotEntry = await page.request.get(`/frontend-pilot/users/${form}`, options);
        expect(nativeEntry.status()).toBe(302);
        expect(nativeEntry.headers().location).toBe('/users/oidc/login');
        expect(pilotEntry.status()).toBe(302);
        expect(new URL(pilotEntry.headers().location, 'http://fixture').pathname).toBe('/frontend-pilot/users/oidc/login');
        if (!view.shell.oidcEnabled) {
            for (const url of [nativeEntry.headers().location, pilotEntry.headers().location]) {
                const denial = await page.request.get(url, options);
                expect(denial.status()).toBe(500);
                const html = await denial.text();
                expect(renderedIdentityError(html)).toBe('OIDC provider is not enabled!');
                expect(html).not.toContain('<form');
            }
        }
    }

    for (const suffix of ['forgot-password', 'reset-password/unread-token', 'activate/unread-token']) {
        for (const prefix of ['/users', '/frontend-pilot/users']) {
            const denial = await page.request.get(`${prefix}/${suffix}`, options);
            expect(denial.status()).toBe(500);
            const html = await denial.text();
            expect(renderedIdentityError(html)).toBe('Login is not enabled!');
            expect(html).not.toContain('<form');
        }
    }

    // Invalid bodies deliberately lack context/CSRF/required fields. Configuration has
    // the same native precedence and cannot accidentally expose a credential form.
    for (const suffix of ['login', 'register', 'forgot-password', 'reset-password/unread-token']) {
        for (const prefix of ['/users', '/frontend-pilot/users']) {
            const denial = await page.request.post(`${prefix}/${suffix}`, {...options, form: {password: 'untrusted secret'}});
            expect(denial.status()).toBe(500);
            const html = await denial.text();
            expect(renderedIdentityError(html)).toBe('Login is not enabled!');
            expect(html).not.toContain('untrusted secret');
            expect(html).not.toContain('<form');
        }
    }

    const api = await page.request.post('/api/v1/auth/login', {headers: headers(view),
        data: {username: 'configuration-fixture', password: 'unsubmitted password'}});
    expect(api.status()).toBe(403);
    expect(await api.json()).toMatchObject({status: 403, code: 'LOCAL_LOGIN_DISABLED', messageKey: 'api:errors.LOCAL_LOGIN_DISABLED'});
});

function headers(view: SessionView): Record<string, string> {
    return {'X-Surveyor-Context': view.context, 'X-CSRF-Token': view.csrfToken, 'X-Surveyor-Locale': 'de'};
}

test('native and pilot controller form rejections retain native document statuses and independent typed API problems', async ({page}) => {
    const before = await session(page.request);
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
        for (const prefix of ['', '/frontend-pilot']) {
            const entry = await page.request.get(`${prefix}${path}?locale=en`);
            expect(entry.status()).toBe(200);
            const html = await entry.text();
            const input = renderedIdentityInput(html, 'password');
            expect(input).toBeDefined();
            expect(input).toContain('minlength="8"');
            expect(input).not.toContain('maxlength=');
            if (path.endsWith('/register')) expect(renderedIdentityInput(html, 'password_repeat')).not.toContain('maxlength=');
        }
    }

    // Fully valid input reaches the native controller. The long credential must not
    // become a schema failure, and a mismatch/taken username must create no account.
    for (const testCase of cases) {
        const native = await page.request.post(testCase.path, {form: testCase.form, maxRedirects: 0});
        const pilot = await page.request.post(`/frontend-pilot${testCase.path}`, {
            form: {...testCase.form, ...nativeIdentityControls(before)}, maxRedirects: 0,
        });
        expect(native.status()).toBe(500);
        expect(pilot.status()).toBe(native.status());
        const nativeHtml = await native.text();
        const pilotHtml = await pilot.text();
        expect(renderedIdentityError(nativeHtml)).toBe(testCase.message);
        expect(renderedIdentityError(pilotHtml)).toBe(renderedIdentityError(nativeHtml));
        expect(pilotHtml).toContain(`"code":"${testCase.code}"`);
        expect(pilotHtml).not.toContain(testCase.form.password);

        const api = await page.request.post(testCase.apiPath, {data: testCase.form,
            headers: {...headers(before), 'X-Surveyor-Locale': 'en'}, maxRedirects: 0});
        expect(api.status()).toBe(testCase.apiStatus);
        expect(await api.json()).toMatchObject({code: testCase.code, status: testCase.apiStatus, params: {}});
    }

    // Document projection recognizes controller renderer errors only. Missing CSRF
    // and generated-input rejection retain their typed admission statuses and codes.
    const admission = await page.request.post('/frontend-pilot/users/login', {
        form: {username, password, _context: before.context, _compatibility: before.deployment.apiCompatibility}, maxRedirects: 0,
    });
    expect(admission.status()).toBe(403);
    expect(await admission.text()).toContain('"code":"CSRF_INVALID"');
    const invalidInput = await page.request.post('/frontend-pilot/users/login', {
        form: {username, password: '', ...nativeIdentityControls(before)}, maxRedirects: 0,
    });
    expect(invalidInput.status()).toBe(400);
    expect(await invalidInput.text()).toContain('"code":"VALIDATION_FAILED"');
});

test('native and pilot standalone recovery retain unbounded inputs and privacy-preserving completion', async ({page}) => {
    const before = await session(page.request);
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
        for (const prefix of ['', '/frontend-pilot']) {
            const entry = await page.request.get(`${prefix}${testCase.entryPath}?locale=en`);
            expect(entry.status()).toBe(200);
            const input = renderedIdentityInput(await entry.text(), testCase.field);
            expect(input).toBeDefined();
            expect(input).not.toContain('maxlength=');
        }

        const form = {[testCase.field]: testCase.input};
        const native = await page.request.post(testCase.path, {form});
        const pilot = await page.request.post(`/frontend-pilot${testCase.path}`, {
            form: {...form, ...nativeIdentityControls(before)},
        });
        expect(native.status()).toBe(200);
        expect(pilot.status()).toBe(native.status());
        expect(await native.text()).toContain(testCase.message);
        expect(await pilot.text()).toContain(testCase.message);
        const api = await page.request.post(testCase.apiPath, {data: form, headers: headers(before)});
        expect(api.status()).toBe(200);
        expect(await api.json()).toMatchObject({changed: true});
    }
});

async function identity(response: APIResponse, previous: SessionView): Promise<components['schemas']['IdentityResult']> {
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

test('identity commands bind old admission and new results while retaining localized credential distinctions', async ({page}) => {
    const anonymous = await session(page.request);
    const credentials = createE2ELogin();
    const denied = await page.request.post('/api/v1/auth/login', {data: credentials,
        headers: {'X-Surveyor-Context': anonymous.context}});
    expect(denied.status()).toBe(403);
    expect(await denied.json()).toMatchObject({code: 'CSRF_INVALID'});
    const invalid = await page.request.post('/api/v1/auth/login', {headers: headers(anonymous),
        data: {...credentials, password: 'deliberately-wrong-password'}});
    expect(invalid.status()).toBe(401);
    expect(invalid.headers()['content-language']).toBe('de');
    expect(await invalid.json()).toMatchObject({code: 'INVALID_CREDENTIALS', messageKey: 'api:errors.INVALID_CREDENTIALS'});
    expect((await session(page.request)).context).toBe(anonymous.context);

    const login = await identity(await page.request.post('/api/v1/auth/login', {headers: headers(anonymous), data: credentials}), anonymous);
    expect(login).toMatchObject({session: {kind: 'account'}, personalLink: null, redirect: null});
    const obsolete = await page.request.post('/api/v1/auth/logout', {headers: headers(anonymous)});
    expect(obsolete.status()).toBe(409);
    expect(await obsolete.json()).toMatchObject({code: 'SESSION_CONTEXT_CHANGED'});

    const name = `Identity alternate ${randomUUID().slice(0, 8)}`;
    expect((await page.request.post('/users/profile/create', {form: {name}, maxRedirects: 0})).status()).toBe(302);
    const beforeSwitch = await session(page.request);
    const target = beforeSwitch.profiles.find(profile => profile.name === name)!;
    expect(target).toBeTruthy();
    const invalidProfile = await page.request.put('/api/v1/auth/profile', {headers: headers(beforeSwitch), data: {profileId: randomUUID()}});
    expect(invalidProfile.status()).toBe(400);
    const switched = await identity(await page.request.put('/api/v1/auth/profile', {headers: headers(beforeSwitch), data: {profileId: target.id}}), beforeSwitch);
    expect(switched.session.activeProfile).toEqual(target);
    // The retained native transport operation follows native profile activation back
    // to Overview. A supplied previous-page next must not reopen the old actor's page.
    const originalProfile = switched.session.profiles.find(profile => profile.id !== target.id)!;
    const nativeSwitch = await page.request.post('/frontend-pilot/users/profile', {form: {
        profileId: originalProfile.id, next: `/frontend-pilot/packing/${randomUUID()}`, locale: 'de',
        _context: switched.session.context, _csrf: switched.session.csrfToken,
        _compatibility: switched.session.deployment.apiCompatibility,
    }, maxRedirects: 0});
    expect(nativeSwitch.status()).toBe(303);
    expect(nativeSwitch.headers().location).toBe('/frontend-pilot?locale=de');
    const afterNative = await session(page.request);
    expect(afterNative.activeProfile).toEqual(originalProfile);
    expect(afterNative.context).not.toBe(switched.session.context);

    const logout = await identity(await page.request.post('/api/v1/auth/logout', {headers: headers(afterNative)}), afterNative);
    expect(logout).toMatchObject({session: {kind: 'anonymous', activeProfile: null, profiles: []}, personalLink: null, redirect: null});
    expect((await session(page.request)).context).toBe(logout.session.context);
});

test('guest creation and emailed personal URLs stay in the frontend and authenticate on their initial GET', async ({page, browser, baseURL}) => {
    await loginForE2E(page.request, createE2ELogin());
    const input = createE2EPackingList();
    Object.assign(input.form, {'defaultPerms[public][0]': 'ACCESS_VIEW'});
    const list = await createResourceViaForm(page.request, input);
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

test('invalid password-reset links are denied before rendering a form, with scoped localized uncached preflight', async ({page, browser, baseURL}) => {
    const anonymous = await session(page.request);
    const path = '/api/v1/auth/reset-password?token=not-a-valid-reset-token';
    expect((await page.request.get(path)).status()).toBe(400);
    const stale = await page.request.get(path, {headers: {'X-Surveyor-Context': 'obsolete-context'}});
    expect(stale.status()).toBe(409);
    expect(await stale.json()).toMatchObject({code: 'SESSION_CONTEXT_CHANGED'});
    const denied = await page.request.get(path, {headers: {
        'X-Surveyor-Context': anonymous.context, 'X-Surveyor-Locale': 'de',
    }});
    expect(denied.status()).toBe(401);
    expect(denied.headers()['content-type']).toContain('application/problem+json');
    expect(denied.headers()['content-language']).toBe('de');
    expect(denied.headers()['cache-control']).toContain('no-store');
    expect(denied.headers()['x-surveyor-context']).toBe(anonymous.context);
    const problem = await denied.json() as components['schemas']['Problem'];
    expect(problem).toMatchObject({code: 'TOKEN_INVALID', status: 401, messageKey: 'api:errors.TOKEN_INVALID'});
    expect((await session(page.request)).context).toBe(anonymous.context);

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

for (const surface of ['native', 'pilot'] as const) {
    test(`successful ${surface} password-reset POST retains the canonical Success destination while fresh token reuse is denied`, async ({page}) => {
        await withPasswordResetAccountForE2E(async function exerciseReset(username, previousPassword, token) {
            const path = `${surface === 'pilot' ? '/frontend-pilot' : ''}/users/reset-password/${token}?locale=en`;
            const before = await session(page.request);
            const admission = await page.request.get(path);
            expect(admission.status()).toBe(200);
            const admissionHtml = await admission.text();
            expect(admissionHtml).toContain('name="confirmPassword"');
            for (const name of ['password', 'confirmPassword']) {
                const input = renderedIdentityInput(admissionHtml, name);
                expect(input).toContain('minlength="8"');
                expect(input).not.toContain('maxlength=');
            }
            // These isolated accounts prove a complete long credential can be reset
            // and subsequently submitted, without changing the shared seed account.
            const password = `Replacement-password!A1${'x'.repeat(1001)}`;
            const form = {password, confirmPassword: password,
                ...(surface === 'pilot' ? {_context: before.context, _csrf: before.csrfToken,
                    _compatibility: before.deployment.apiCompatibility, locale: 'en', next: '/frontend-pilot'} : {})};

            // A valid token does not change native mismatch redisplay/status, and a
            // rejected attempt must leave the same token available for the real save.
            const mismatch = await page.request.post(path, {form: {...form, confirmPassword: 'Different-password!A1'}, maxRedirects: 0});
            expect(mismatch.status()).toBe(500);
            const mismatchHtml = await mismatch.text();
            expect(renderedIdentityError(mismatchHtml)).toBe('Passwords do not match!');
            expect(mismatchHtml).not.toContain(password);
            expect(mismatchHtml).not.toContain('Different-password!A1');
            if (surface === 'pilot') {
                expect(mismatchHtml).toContain('"code":"PASSWORD_MISMATCH"');
                const apiMismatch = await page.request.post('/api/v1/auth/reset-password', {
                    data: {token, password, confirmPassword: 'Different-password!A1'}, headers: headers(before),
                });
                expect(apiMismatch.status()).toBe(400);
                expect(await apiMismatch.json()).toMatchObject({code: 'PASSWORD_MISMATCH', status: 400});
            }

            // Exercise the real route/session/render boundary. A synthetic resetDone
            // bootstrap can render Success while concealing a wrong POST redirect.
            const completion = await page.request.post(path, {form, maxRedirects: 0});
            expect(completion.status()).toBe(200);
            expect(completion.headers().location).toBeUndefined();
            expect(new URL(completion.url()).pathname).toBe(new URL(path, 'https://surveyor.invalid').pathname);
            const html = await completion.text();
            expect(html).toContain('Success');
            expect(html).toContain('Your password has been successfully reset');
            expect(html).not.toContain('name="confirmPassword"');
            if (surface === 'pilot') {
                expect(html).toContain(`"destination":"${path}"`);
                expect(html).toContain('"messageKey":"auth.resetDone","kind":"success"');
                expect(html).not.toContain('"identityFeedback":"auth.resetDone"');
            }

            // The successful POST receipt grants no future token admission. Both a
            // fresh GET and a replayed POST must independently reject the consumed token.
            expect((await page.request.get(path)).status()).toBe(401);
            expect((await page.request.post(path, {form, maxRedirects: 0})).status()).toBe(401);
            const oldLogin = await page.request.post('/users/login', {form: {username, password: previousPassword}, maxRedirects: 0});
            expect(oldLogin.status()).toBe(500);
            await loginForE2E(page.request, {username, password});
            const account = await session(page.request);
            expect(account.kind).toBe('account');
            const enhancedLogin = await identity(await page.request.post('/api/v1/auth/login', {
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

            // Capture the actual completed document, not a synthetic successful bootstrap.
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

test('native pilot recovery GET redirects to login while rejected and confirmed POSTs retain their full message at the recovery URL', async ({page}) => {
    const native = await page.request.get('/guest/recovery', {maxRedirects: 0});
    expect(native.status()).toBe(302);
    expect(native.headers().location).toBe('/users/login');
    const pilot = await page.request.get('/frontend-pilot/guest/recovery?locale=en', {maxRedirects: 0});
    expect(pilot.status()).toBe(native.status());
    expect(pilot.headers().location).toBe('/frontend-pilot/users/login?locale=en');
    const current = await session(page.request);

    // Login has no recovery override in the native product contract. Extra controls
    // must not reinterpret ordinary credential admission as a different identity action.
    const loginFields = {...createE2ELogin(), password: 'deliberately-wrong-password', _recovery: '1', email: 'not-an-email-address'};
    const nativeLogin = await page.request.post('/users/login', {form: loginFields, maxRedirects: 0});
    const login = await page.request.post('/frontend-pilot/users/login', {form: {
        ...loginFields,
        next: '/frontend-pilot', locale: 'en', _context: current.context,
        _csrf: current.csrfToken, _compatibility: current.deployment.apiCompatibility,
    }, maxRedirects: 0});
    expect(nativeLogin.status()).toBe(500);
    expect(login.status()).toBe(nativeLogin.status());
    const loginHtml = await login.text();
    expect(renderedIdentityError(loginHtml)).toBe(renderedIdentityError(await nativeLogin.text()));
    expect(loginHtml).toContain('"code":"INVALID_CREDENTIALS"');
    expect(loginHtml).toContain('"status":401');

    // A rejected recovery submission owns a complete Error page at this URL. It
    // cannot be projected as a form error because recovery has no standalone form.
    const rejected = await page.request.post('/frontend-pilot/guest/recovery', {form: {
        email: 'not-an-email-address', next: '/frontend-pilot', locale: 'en',
        _context: current.context, _csrf: current.csrfToken, _compatibility: current.deployment.apiCompatibility,
    }, maxRedirects: 0});
    expect(rejected.status()).toBe(400);
    expect(rejected.headers().location).toBeUndefined();
    expect(new URL(rejected.url()).pathname).toBe('/frontend-pilot/guest/recovery');
    expect(rejected.headers()['content-type']).toContain('text/html');
    const errorHtml = await rejected.text();
    expect(errorHtml).toContain('Error');
    expect(errorHtml).toContain('"identityProblem":');
    expect(errorHtml).toContain('"code":"VALIDATION_FAILED"');
    expect(errorHtml).not.toContain('"identityFormProblem":');
    expect(errorHtml).not.toContain('<input id="email"');
    expect(errorHtml).not.toContain('"identityFeedback":"auth.recoverySent"');
    // A nonexistent address completes the same privacy-preserving recovery workflow
    // without requiring an external mailbox or inspecting whether a guest exists.
    const completion = await page.request.post('/frontend-pilot/guest/recovery', {form: {
        email: `no-existing-guest-${randomUUID()}@example.invalid`, next: '/frontend-pilot', locale: 'en',
        _context: current.context, _csrf: current.csrfToken, _compatibility: current.deployment.apiCompatibility,
    }, maxRedirects: 0});
    expect(completion.status()).toBe(200);
    expect(completion.headers().location).toBeUndefined();
    expect(new URL(completion.url()).pathname).toBe('/frontend-pilot/guest/recovery');
    expect(completion.headers()['content-type']).toContain('text/html');
    const html = await completion.text();
    expect(html).toContain('Success');
    expect(html).toContain('The link(s) to your guest account(s) have been sent to your email address.');
    expect(html).toContain('"pageCompletion":');
    expect(html).toContain(`"context":"${current.context}","destination":"/frontend-pilot/guest/recovery"`);
    expect(html).toContain('"messageKey":"auth.recoverySent","kind":"success"');
    expect(html).not.toContain('"identityFeedback":"auth.recoverySent"');
    expect(html).not.toContain('<input id="username"');
    expect((await page.request.get('/frontend-pilot/guest/recovery', {maxRedirects: 0})).status()).toBe(302);
});
