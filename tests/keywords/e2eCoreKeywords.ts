import {expect, type APIRequestContext, type APIResponse, type Locator, type Page} from '@playwright/test';
import type {E2ECreateCase, E2ECreateForm} from '../factories/e2eCoreFactory';
import 'reflect-metadata';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import bcrypt from 'bcryptjs';
import {DataSource} from 'typeorm';
import {createE2EPasswordResetAccount} from '../factories/e2eCoreFactory';

export interface CreatedResource {
    title: string;
    path: string;
    id: string;
}

/** Wait for client event ownership before interacting with server-rendered SPA controls.
 * The completed-hydration marker establishes readiness only; callers still assert observable
 * behavior. Visible SSR content and enabled controls do not establish hydration readiness. */
export async function waitForPilotHydration(page: Page): Promise<void> {
    await page.waitForFunction(pilotMounted);
}

/** Playwright executes this callback in the browser, independently of the test process. */
function pilotMounted(): boolean {
    const container = document.getElementById('surveyor-pilot');
    return container?.getAttribute('data-pilot-hydrated') === 'true';
}

/** Review a frontend invoice gate before the existing action sends its original API payload. */
export async function confirmInvoiceCommand(page: Page, opener: Locator): Promise<void> {
    const review = page.locator('#invoiceCommandConfirmModal');
    // Wait for browser binding after navigation; visible server markup alone is not an interactive review gate.
    await expect(review).toHaveAttribute('data-initialized', 'true');
    await opener.click();
    await expect(review).toBeVisible();
    // Send the original command only through its explicit acknowledgement and complete the modal transition.
    await review.locator('[data-invoice-command-confirm]').click();
    await expect(review).not.toBeVisible();
}

export async function loginForE2E(request: APIRequestContext, credentials: {username: string; password: string}): Promise<void> {
    // Keep login at the HTTP boundary: it is faster and less brittle than driving the form UI,
    // but still verifies the real Express login route, session cookie, and seeded E2E account.
    // Retry only connection resets during session setup; HTTP errors and financial commands remain single attempts.
    const response = await request.post('/users/login', {form: credentials, maxRedirects: 0, maxRetries: 2});
    expect(response.status()).toBe(302);
    expect(response.headers().location).toContain('/users/dashboard');
}

/**
 * Supply an isolated real account/token for HTTP password-reset assertions without SMTP,
 * seed-account mutation, repository mocks, or schema resets. Use production metadata and
 * established entity factories; callers receive only HTTP credentials/token, never the
 * datasource or repositories. Verify the actual selected disposable schema and every
 * grant before inserting or deleting rows.
 */
export async function withPasswordResetAccountForE2E(
    exercise: (username: string, password: string, token: string) => Promise<void>,
): Promise<void> {
    const database = process.env.E2E_DB_NAME ?? '';
    if (!/e2e/i.test(database)) throw new Error('Refusing a password-reset fixture outside an E2E schema.');
    // E2E exercises the built application. Load that same compiled metadata rather than
    // asking Playwright's browser-oriented transform to interpret TypeORM decorators.
    const requireBuilt = createRequire(resolve('package.json'));
    const {entities} = requireBuilt('./dist/modules/database/__index__.js') as typeof import('../../src/modules/database/__index__');
    const {User} = requireBuilt('./dist/modules/database/entities/user/User.js') as typeof import('../../src/modules/database/entities/user/User');
    const {Profile} = requireBuilt('./dist/modules/database/entities/user/Profile.js') as typeof import('../../src/modules/database/entities/user/Profile');
    const datasource = new DataSource({
        type: 'mariadb', host: process.env.E2E_DB_HOST, port: Number(process.env.E2E_DB_PORT ?? '3306'),
        username: process.env.E2E_DB_USER, password: process.env.E2E_DB_PASSWORD, database,
        timezone: 'Z', entities, synchronize: false,
    });
    await datasource.initialize();

    let userId: number | undefined;
    try {
        const [target] = await datasource.query('SELECT DATABASE() AS name') as {name: string}[];
        const grants = await datasource.query('SHOW GRANTS') as Record<string, string>[];
        const quotedDatabase = database.replaceAll('\\', '\\\\').replaceAll('_', '\\_').replaceAll('%', '\\%').replaceAll('`', '``');
        const schemaGrant = `GRANT ALL PRIVILEGES ON \`${quotedDatabase}\`.*`;
        if (target?.name !== database) throw new Error('Refusing an unexpected password-reset fixture database.');
        for (const grant of grants) {
            const prefix = String(Object.values(grant)[0]).split(' TO ')[0];
            if (prefix !== 'GRANT USAGE ON *.*' && prefix !== schemaGrant) {
                throw new Error('Refusing password-reset fixture credentials with privileges outside their E2E schema.');
            }
        }

        const password = 'Previous-password!A1';
        const fixture = createE2EPasswordResetAccount(await bcrypt.hash(password, 10));
        const user = await datasource.getRepository(User).save(fixture.user);
        userId = user.id;
        await datasource.getRepository(Profile).save({...fixture.profile, user});
        await exercise(user.username, password, fixture.user.resetToken!);
    } finally {
        try {
            if (userId !== undefined) {
                // User deletion detaches profiles in the application, so remove this fixture's
                // own profile explicitly before its account rather than leaving an orphan.
                await datasource.getRepository(Profile).delete({user: {id: userId}});
                await datasource.getRepository(User).delete(userId);
            }
        } finally {
            await datasource.destroy();
        }
    }
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
    return await expectPageContainsAll(responsePromise, [expectedText]);
}

export async function expectPageContainsAll(responsePromise: Promise<APIResponse>, expectedTexts: string[], context = 'page'): Promise<string> {
    const response = await responsePromise;
    expect(response.status(), `${context} should load successfully`).toBe(200);
    const body = await response.text();

    for (const expectedText of expectedTexts) {
        expect(body, `${context} should include ${expectedText}`).toContain(expectedText);
    }

    return body;
}

export async function expectCreatedResourceLoaded(request: APIRequestContext, resource: CreatedResource, expectedTexts: string[]): Promise<string> {
    // A useful E2E canary must prove that the redirected entity actually loaded, not only
    // that a generic page responded. These assertions verify the persisted entity fields.
    return await expectPageContainsAll(request.get(resource.path), expectedTexts, resource.title);
}
