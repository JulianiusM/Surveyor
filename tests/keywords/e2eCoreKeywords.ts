import {expect, type APIRequestContext, type APIResponse, type Locator, type Page} from '@playwright/test';
import type {E2ECreateCase, E2ECreateForm} from '../factories/e2eCoreFactory';
import 'reflect-metadata';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import bcrypt from 'bcryptjs';
import {DataSource, In} from 'typeorm';
import {createE2EPasswordResetAccount} from '../factories/e2eCoreFactory';

export interface CreatedResource {
    title: string;
    path: string;
    id: string;
}

/** Complete the native opening transition before assertions can lead to another modal command. */
export async function openModalForE2E(modal: Locator, opener: Locator): Promise<void> {
    // Visibility begins before Bootstrap accepts a hide command. Its public lifecycle event,
    // rather than a fixed delay or private state, establishes when the dialog is ready to close.
    await Promise.all([modal.evaluate(waitForModalTransition, 'shown.bs.modal' as const), opener.click()]);
}

/** Close an already opened native modal and wait until its lifecycle releases the next interaction. */
export async function closeModalForE2E(modal: Locator): Promise<void> {
    // Register before clicking: the next interaction must follow the completed transition,
    // not merely a disappearing dialog whose backdrop or transition still owns the page.
    await Promise.all([
        modal.evaluate(waitForModalTransition, 'hidden.bs.modal' as const),
        modal.locator('.modal-header .btn-close').click(),
    ]);
}

/** Playwright executes this listener in the browser; it cannot reference test-process state. */
function waitForModalTransition(element: HTMLElement, event: 'shown.bs.modal' | 'hidden.bs.modal'): Promise<void> {
    return new Promise(function awaitTransition(resolve) {
        element.addEventListener(event, function resolveCompleted() { resolve(); }, {once: true});
    });
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
    /** Keep fixture insertion, exercise and exact-row cleanup inside the guarded connection owner. */
    async function exerciseAccount(datasource: DataSource, requireBuilt: ReturnType<typeof createRequire>): Promise<void> {
        const {User} = requireBuilt('./dist/modules/database/entities/user/User.js') as typeof import('../../src/modules/database/entities/user/User');
        const {Profile} = requireBuilt('./dist/modules/database/entities/user/Profile.js') as typeof import('../../src/modules/database/entities/user/Profile');
        let userId: number | undefined;

        try {
            // Persist only this factory's isolated account/profile after the wrapper
            // has checked the actual database and every mutating credential grant.
            const password = 'Previous-password!A1';
            const fixture = createE2EPasswordResetAccount(await bcrypt.hash(password, 10));
            const user = await datasource.getRepository(User).save(fixture.user);
            userId = user.id;
            await datasource.getRepository(Profile).save({...fixture.profile, user});
            await exercise(user.username, password, fixture.user.resetToken!);
        } finally {
            if (userId !== undefined) {
                // User deletion detaches profiles in the application, so remove this fixture's
                // own profile explicitly before its account rather than leaving an orphan.
                await datasource.getRepository(Profile).delete({user: {id: userId}});
                await datasource.getRepository(User).delete(userId);
            }
        }
    }

    await withBuiltE2EDatabase('fixture', exerciseAccount);
}

/** Read only this test's unique guest/profile names through the built entity metadata.
 * Independent name counts also reveal a failed creation's orphan profile; no repository,
 * connection, persistence operation or cleanup capability escapes this keyword. */
export async function readGuestRegistrationCountsForE2E(usernames: readonly string[]): Promise<{guests: number; profiles: number}> {
    if (!usernames.length || usernames.some(username => !username)) throw new Error('Guest counts require explicit nonempty test names.');

    async function readCounts(datasource: DataSource, requireBuilt: ReturnType<typeof createRequire>) {
        const {Guest} = requireBuilt('./dist/modules/database/entities/user/Guest.js') as typeof import('../../src/modules/database/entities/user/Guest');
        const {Profile} = requireBuilt('./dist/modules/database/entities/user/Profile.js') as typeof import('../../src/modules/database/entities/user/Profile');

        // Count the related production rows independently. A join to a surviving
        // guest would hide a profile left behind by a rejected guest operation.
        const [guests, profiles] = await Promise.all([
            datasource.getRepository(Guest).countBy({username: In([...usernames])}),
            datasource.getRepository(Profile).countBy({name: In([...usernames])}),
        ]);
        return {guests, profiles};
    }

    return withBuiltE2EDatabase('read', readCounts);
}

/** Observe signup completeness without returning the account's activation secret or password hash.
 * Names belong to this test alone; independent profile counts also expose partial/orphan rows. */
export async function readAccountRegistrationCountsForE2E(usernames: readonly string[]):
    Promise<{accounts: number; profiles: number; activationReady: number}> {
    if (!usernames.length || usernames.some(username => !username)) throw new Error('Account counts require explicit nonempty test names.');

    async function readCounts(datasource: DataSource, requireBuilt: ReturnType<typeof createRequire>) {
        const {User} = requireBuilt('./dist/modules/database/entities/user/User.js') as typeof import('../../src/modules/database/entities/user/User');
        const {Profile} = requireBuilt('./dist/modules/database/entities/user/Profile.js') as typeof import('../../src/modules/database/entities/user/Profile');
        const [accounts, profiles] = await Promise.all([
            datasource.getRepository(User).find({where: {username: In([...usernames])},
                select: {password: true, isActive: true, activationToken: true, activationTokenExpiration: true}}),
            datasource.getRepository(Profile).countBy({name: In([...usernames])}),
        ]);

        // Export completeness only. Neither trace/assertion output nor another
        // helper caller receives a reusable token, link or credential hash.
        let activationReady = 0;
        for (const account of accounts) {
            if (!account.isActive && account.password && account.activationToken
                && account.activationTokenExpiration && account.activationTokenExpiration.getTime() > Date.now()) activationReady++;
        }
        return {accounts: accounts.length, profiles, activationReady};
    }

    return withBuiltE2EDatabase('read', readCounts);
}

/** Own one connection to the selected built-server schema, with no synchronization/reset.
 * Read-only observations use the same metadata/target boundary; fixture callbacks additionally
 * require the exact restricted grant proof before any insertion or cleanup can run. */
async function withBuiltE2EDatabase<Result>(access: 'read' | 'fixture',
    exercise: (datasource: DataSource, requireBuilt: ReturnType<typeof createRequire>) => Promise<Result>): Promise<Result> {
    const database = process.env.E2E_DB_NAME ?? '';
    if (!/e2e/i.test(database)) throw new Error('Refusing fixture access outside the selected E2E schema.');

    // E2E exercises the built application. Load that same compiled metadata rather than
    // asking Playwright's browser-oriented transform to interpret TypeORM decorators.
    const requireBuilt = createRequire(resolve('package.json'));
    const {entities} = requireBuilt('./dist/modules/database/__index__.js') as typeof import('../../src/modules/database/__index__');
    const datasource = new DataSource({
        type: 'mariadb', host: process.env.E2E_DB_HOST, port: Number(process.env.E2E_DB_PORT ?? '3306'),
        username: process.env.E2E_DB_USER, password: process.env.E2E_DB_PASSWORD, database,
        timezone: 'Z', entities, synchronize: false,
    });
    await datasource.initialize();

    try {
        const [target] = await datasource.query('SELECT DATABASE() AS name') as {name: string}[];
        if (target?.name !== database) throw new Error('Refusing an unexpected E2E fixture database.');
        if (access === 'fixture') await requireE2EFixtureGrants(datasource, database);

        // Private read callbacks issue SELECTs for their own unique test names
        // and return counts only; no connection or private credential leaves this owner.
        return await exercise(datasource, requireBuilt);
    } finally {
        await datasource.destroy();
    }
}

/** Prove mutating fixture credentials are limited to explicitly configured dedicated schemas.
 * CI uses the same account for E2E and integration; arbitrary extra schemas, role grants,
 * table patterns and global privileges remain refused rather than inferred from their names. */
async function requireE2EFixtureGrants(datasource: DataSource, database: string): Promise<void> {
    const permitted = new Set(schemaGrantPrefixes(database));
    const integrationDatabase = process.env.TEST_DB_NAME;
    if (integrationDatabase) {
        if (!/test/i.test(integrationDatabase)) throw new Error('Refusing an unverified configured integration schema.');
        for (const prefix of schemaGrantPrefixes(integrationDatabase)) permitted.add(prefix);
    }

    // The effective integration name must be supplied explicitly; importing another
    // environment loader could redirect DB_* or silently infer a local schema.
    const grants = await datasource.query('SHOW GRANTS') as Record<string, string>[];
    for (const grant of grants) {
        const prefix = String(Object.values(grant)[0]).split(' TO ')[0];
        if (prefix !== 'GRANT USAGE ON *.*' && !permitted.has(prefix)) {
            throw new Error('Refusing password-reset fixture credentials with privileges outside configured test schemas.');
        }
    }
}

/** Match only the configured name's exact quoted SHOW GRANTS representations.
 * MariaDB can report underscores directly or use the escaped-literal spelling;
 * accepting both must not admit a different schema, table or wildcard prefix. */
function schemaGrantPrefixes(database: string): string[] {
    const raw = database.replaceAll('`', '``');
    const escaped = database.replaceAll('\\', '\\\\').replaceAll('_', '\\_').replaceAll('%', '\\%').replaceAll('`', '``');
    const prefixes = [];
    for (const quoted of new Set([raw, escaped])) prefixes.push(`GRANT ALL PRIVILEGES ON \`${quoted}\`.*`);
    return prefixes;
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
