import {test, expect, type APIRequestContext, type APIResponse} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import type {components} from '../../src/types/api/v1';
import {createE2ELogin, createE2EPackingList} from '../factories/e2eCoreFactory';
import {createResourceViaForm, loginForE2E} from '../keywords/e2eCoreKeywords';

type SessionView = components['schemas']['SessionView'];

async function session(request: APIRequestContext): Promise<SessionView> {
    const response = await request.get('/api/v1/session');
    expect(response.status()).toBe(200);
    const view = await response.json() as SessionView;
    expect(response.headers()['x-surveyor-context']).toBe(view.context);
    return view;
}

function headers(view: SessionView): Record<string, string> {
    return {'X-Surveyor-Context': view.context, 'X-CSRF-Token': view.csrfToken, 'X-Surveyor-Locale': 'de'};
}

async function identity(response: APIResponse, previous: SessionView): Promise<components['schemas']['IdentityResult']> {
    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toContain('no-store');
    const result = await response.json() as components['schemas']['IdentityResult'];
    expect(response.headers()['x-surveyor-context']).toBe(result.session.context);
    expect(result.session.context).not.toBe(previous.context);
    expect(result.session.csrfToken).not.toBe(previous.csrfToken);
    return result;
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
    const logout = await identity(await page.request.post('/api/v1/auth/logout', {headers: headers(switched.session)}), switched.session);
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
            const landing = await recovered.request.get(link.pathname + link.search, {maxRedirects: 0});
            expect(landing.status()).toBe(302);
            expect(landing.headers().location).toBe(`/frontend-pilot/packing/${list.id}`);
            const after = await session(recovered.request);
            expect(after).toMatchObject({kind: 'guest', activeProfile: created.session.activeProfile});
            expect(after.context).not.toBe(before.context);
            expect((await recovered.request.get(link.pathname + '?next=https%3A%2F%2Foutside.invalid', {maxRedirects: 0})).headers().location).toBe('/frontend-pilot');
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
        await expect(resetPage.getByText(problem.detail, {exact: true})).toBeVisible();
        await expect(resetPage.locator('input[type="password"]')).toHaveCount(0);
    } finally { await noScript.close(); }
});
