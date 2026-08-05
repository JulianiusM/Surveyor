import {expect, type APIRequestContext, type APIResponse} from '@playwright/test';
import type {E2ECreateCase, E2ECreateForm} from '../factories/e2eCoreFactory';

export interface CreatedResource {
    title: string;
    path: string;
    id: string;
}

export async function loginForE2E(request: APIRequestContext, credentials: {username: string; password: string}): Promise<void> {
    // Keep login at the HTTP boundary: it is faster and less brittle than driving the form UI,
    // but still verifies the real Express login route, session cookie, and seeded E2E account.
    const response = await request.post('/users/login', {form: credentials, maxRedirects: 0});
    expect(response.status()).toBe(302);
    expect(response.headers().location).toContain('/users/dashboard');
}

export async function createResourceViaForm(request: APIRequestContext, testCase: E2ECreateCase<E2ECreateForm>): Promise<CreatedResource> {
    // Posting the same form fields the pages submit keeps setup stable without depending on
    // generated client-side table widgets for every workflow smoke check.
    const form = Object.fromEntries(Object.entries(testCase.form)) as {[key: string]: string | number | boolean};
    const response = await request.post(testCase.createPath, {form, maxRedirects: 0});
    expect(response.status()).toBe(302);

    const location = response.headers().location;
    expect(location, `${testCase.title} should redirect to its detail page`).toBeTruthy();
    const path = new URL(location!, 'http://localhost').pathname;
    const id = path.split('/').filter(Boolean).at(-1);
    expect(id, `${testCase.title} redirect should include a resource id`).toBeTruthy();

    return {title: testCase.title, path, id: id!};
}

export async function expectPageContains(responsePromise: Promise<APIResponse>, expectedText: string): Promise<string> {
    const response = await responsePromise;
    expect(response.status()).toBe(200);
    const body = await response.text();
    expect(body).toContain(expectedText);
    return body;
}
