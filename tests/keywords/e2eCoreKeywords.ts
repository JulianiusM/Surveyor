import {expect, type APIRequestContext, type APIResponse, type Locator, type Page} from '@playwright/test';
import type {E2ECreateCase, E2ECreateForm} from '../factories/e2eCoreFactory';
import 'reflect-metadata';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
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
 * datasource or repositories. Verify the actual selected E2E schema before inserting
 * or deleting this fixture's records; dedicated credentials remain a setup responsibility.
 */
export async function withPasswordResetAccountForE2E(
    exercise: (username: string, password: string, token: string) => Promise<void>,
): Promise<void> {
    /** Keep fixture insertion, exercise and exact-row cleanup inside the selected connection owner. */
    async function exerciseAccount(datasource: DataSource, requireBuilt: ReturnType<typeof createRequire>): Promise<void> {
        const {User} = requireBuilt('./dist/modules/database/entities/user/User.js') as typeof import('../../src/modules/database/entities/user/User');
        const {Profile} = requireBuilt('./dist/modules/database/entities/user/Profile.js') as typeof import('../../src/modules/database/entities/user/Profile');
        let userId: number | undefined;

        try {
            // Persist only this factory's isolated account/profile after the wrapper
            // has checked the actual database selected by the test configuration.
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

    await withBuiltE2EDatabase(exerciseAccount);
}

/** These handles identify only this workflow's disposable rows; no ORM owner escapes the fixture. */
export interface E2EProfileWorkflowFixture {
    account: {id: number; username: string; password: string; profileId: string};
    guest: {id: string; username: string; profileId: string; loginPath: string};
}

/** Supply independent account/guest actors for destructive document and migration journeys.
 * Use the existing selected-database checks and built production metadata. Empty
 * account contact can be selected for direct account deletion, while the guest has
 * no contact. No provider credentials or externally deliverable mailbox is installed. */
export async function withProfileWorkflowFixtureForE2E(
    exercise: (fixture: E2EProfileWorkflowFixture) => Promise<void>,
    accountContact: 'ordinary' | 'absent' = 'ordinary',
): Promise<void> {
    async function exerciseWorkflow(datasource: DataSource, requireBuilt: ReturnType<typeof createRequire>): Promise<void> {
        const {User} = requireBuilt('./dist/modules/database/entities/user/User.js') as typeof import('../../src/modules/database/entities/user/User');
        const {Profile} = requireBuilt('./dist/modules/database/entities/user/Profile.js') as typeof import('../../src/modules/database/entities/user/Profile');
        const {Guest} = requireBuilt('./dist/modules/database/entities/user/Guest.js') as typeof import('../../src/modules/database/entities/user/Guest');
        const userService = requireBuilt('./dist/modules/database/services/UserService.js') as typeof import('../../src/modules/database/services/UserService');
        const suffix = randomUUID().slice(0, 8);
        const password = 'Profile-workflow-password!A1';
        let userId: number | undefined;
        let guestId: string | undefined;
        const profileIds: string[] = [];

        try {
            // Use a unique account rather than mutating the shared seeded identity.
            // Direct account deletion skips mail for this existing empty-contact case.
            const user = await datasource.getRepository(User).save({username: `workflow-${suffix}`, name: `Workflow ${suffix}`,
                email: accountContact === 'absent' ? '' : `workflow-${suffix}@example.invalid`,
                password: await bcrypt.hash(password, 10), isActive: true});
            userId = user.id;
            const profile = await datasource.getRepository(Profile).save({name: user.name, defaultForOwner: true, user});
            profileIds.push(profile.id);
            const guest = await userService.createGuest(`Guest workflow ${suffix}`, null, datasource.manager);
            guestId = guest.id;
            profileIds.push(guest.profile.id);
            await exercise({account: {id: user.id, username: user.username, password, profileId: profile.id},
                guest: {id: guest.id, username: guest.username, profileId: guest.profile.id,
                    loginPath: `/guest/${guest.id}/login/${guest.token}`}});
        } finally {
            // Profile deletion/deactivation retains historical rows, and a transfer
            // may replace their owner. Exact captured IDs keep cleanup bounded.
            if (profileIds.length) await datasource.getRepository(Profile).delete({id: In(profileIds)});
            if (guestId !== undefined) await datasource.getRepository(Guest).delete(guestId);
            if (userId !== undefined) await datasource.getRepository(User).delete(userId);
        }
    }

    await withBuiltE2EDatabase(exerciseWorkflow);
}

/** Observe this fixture's actual saved ownership/token state without returning private credentials or relations. */
export async function readProfileWorkflowFixtureForE2E(fixture: E2EProfileWorkflowFixture) {
    async function readWorkflow(datasource: DataSource, requireBuilt: ReturnType<typeof createRequire>) {
        const {User} = requireBuilt('./dist/modules/database/entities/user/User.js') as typeof import('../../src/modules/database/entities/user/User');
        const {Guest} = requireBuilt('./dist/modules/database/entities/user/Guest.js') as typeof import('../../src/modules/database/entities/user/Guest');
        const {Profile} = requireBuilt('./dist/modules/database/entities/user/Profile.js') as typeof import('../../src/modules/database/entities/user/Profile');
        const profiles = await datasource.getRepository(Profile).find({where: {id: In([fixture.account.profileId, fixture.guest.profileId])}});
        const accountCount = await datasource.getRepository(User).countBy({id: fixture.account.id});
        const guestCount = await datasource.getRepository(Guest).countBy({id: fixture.guest.id});

        // Return only observable fixture facts. Browser evidence never carries a
        // password hash, migration token value, guest link token or live repository.
        return {accountCount, guestCount, profiles: profiles.map(function profileState(profile) {
            return {id: profile.id, userId: profile.userId ?? null, guestId: profile.guestId ?? null,
                hasMigrationToken: !!profile.migrationToken};
        })};
    }

    return withBuiltE2EDatabase(readWorkflow);
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

    return withBuiltE2EDatabase(readCounts);
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

    return withBuiltE2EDatabase(readCounts);
}

/** Own one connection to the selected built-server schema, with no synchronization/reset.
 * Read-only observations and mutation fixtures use the same metadata/target boundary.
 * Credential restrictions and database disposability belong to test setup: a fixture-only
 * grant inspection would run after ordinary E2E preparation has already reset the schema. */
async function withBuiltE2EDatabase<Result>(
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

        // Each callback owns its isolated fixture writes/cleanup or bounded observation.
        // Keep the connection here and release it even when the application workflow fails.
        return await exercise(datasource, requireBuilt);
    } finally {
        await datasource.destroy();
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
