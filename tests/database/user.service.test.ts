/**
 * Tests for user/guest/SSO service using the mysql (MariaDB/mysql2) DataSource mock.
 * Requires tests/db/mariadb-datasource.mock.ts and a reachable test DB.
 */

jest.mock('../../src/modules/database/dataSource', () =>
    require('../util/db/mariadb-datasource.mock')
);

import {
    activateUser,
    createGuest,
    createGuestLink,
    findOrCreateUserFromOidc,
    generateActivationToken,
    generatePasswordResetToken,
    getGuestByToken,
    getGuestInternal,
    getGuestLinkToken,
    getUserByOidc,
    getUserByUsername,
    registerGuest,
    registerUser,
    resetPassword,
    unlinkOidc,
    verifyActivationToken,
    verifyPassword,
    verifyPasswordResetToken,
} from '../../src/modules/database/services/UserService';
import {AppDataSource, initDataSource} from '../../src/modules/database/dataSource';

// Entities used for setup/cleanup
import {User} from '../../src/modules/database/entities/user/User';
import {Guest} from '../../src/modules/database/entities/user/Guest';
import {GuestLink} from '../../src/modules/database/entities/user/GuestLink';
import {ActivityRole} from '../../src/modules/database/entities/activity/ActivityRole';

// Test data
import {
    activationTokenData,
    guestCreationData,
    guestRegistrationData,
    oidcExactMatchData,
    oidcJitProvisioningData,
    oidcLinkByEmailData,
    oidcNoLinkByEmailData,
    passwordResetData,
    userRegistrationData,
} from '../data/database/userServiceData';

async function truncateAll() {
    await AppDataSource.query('SET FOREIGN_KEY_CHECKS=0');

    await AppDataSource.createQueryBuilder().delete().from(GuestLink).execute();
    await AppDataSource.createQueryBuilder().delete().from(Guest).execute();
    await AppDataSource.createQueryBuilder().delete().from(ActivityRole).execute();
    await AppDataSource.createQueryBuilder().delete().from(User).execute();

    await AppDataSource.query('SET FOREIGN_KEY_CHECKS=1');
}

beforeAll(async () => {
    await initDataSource();
    if ('synchronize' in AppDataSource) {
        await (AppDataSource as any).synchronize(true);
    }
}, 60_000);

afterAll(async () => {
    if (AppDataSource.isInitialized) await AppDataSource.destroy();
});

beforeEach(async () => {
    // nothing required globally; each test sets up what it needs
});

afterEach(async () => {
    await truncateAll();
}, 60_000);

describe('User registration, activation & password reset', () => {
    test.each(userRegistrationData)(
        '$description',
        async ({username, name, password, email, wrongPassword, expectedActive}) => {
            const userId = await registerUser(username, name, password, email);
            expect(typeof userId).toBe('number');

            const fetched = await getUserByUsername(username);
            expect(fetched).toMatchObject({
                id: userId,
                username,
                name,
                email,
                isActive: expectedActive,
            });

            // Password should not be selected by getUserByUsername
            // (TypeORM "select" omits password)
            expect(fetched!.password).toBeUndefined();

            // Verify password using the dedicated helper
            expect(await verifyPassword(userId, password)).toBe(true);
            expect(await verifyPassword(userId, wrongPassword)).toBe(false);
        }
    );

    test.each(activationTokenData)(
        '$description',
        async ({username, name, password, email, expectedActiveAfter}) => {
            const userId = await registerUser(username, name, password, email);

            const token = await generateActivationToken(userId);
            expect(typeof token).toBe('string');
            expect(token.length).toBeGreaterThan(5);

            // Token should be valid now
            const byToken = await verifyActivationToken(token);
            expect(byToken).toMatchObject({
                id: userId,
                username,
                email,
                isActive: 0,
            });

            await activateUser(userId);
            const afterActivation = await getUserByUsername(username);
            expect(afterActivation!.isActive).toBe(expectedActiveAfter);

            // Token should no longer be usable after activation (fields cleared)
            const byTokenAfter = await verifyActivationToken(token);
            expect(byTokenAfter).toBeNull();
        }
    );

    test.each(passwordResetData)(
        '$description',
        async ({username, name, oldPassword, newPassword, email}) => {
            const userId = await registerUser(username, name, oldPassword, email);

            const resetToken = await generatePasswordResetToken(username);
            expect(typeof resetToken).toBe('string');

            const found = await verifyPasswordResetToken(resetToken);
            expect(found).toMatchObject({id: userId, username});

            await resetPassword(username, newPassword);

            // Token should be cleared and new password valid
            const after = await verifyPasswordResetToken(resetToken);
            expect(after).toBeNull();

            expect(await verifyPassword(userId, oldPassword)).toBe(false);
            expect(await verifyPassword(userId, newPassword)).toBe(true);
        }
    );
});

describe('Guests & guest links', () => {
    test.each(guestCreationData)(
        '$description',
        async ({guestUsername, guestEmail, entityType, entityId}) => {
            const guestId = await createGuest(guestUsername, guestEmail);
            expect(typeof guestId).toBe('number');

            const token = await createGuestLink(entityType, entityId, guestId);
            expect(typeof token).toBe('string');

            // get token again via helper
            const token2 = await getGuestLinkToken(entityType, entityId, guestId);
            expect(token2).toBe(token);

            // fetch by token
            const guestByToken = await getGuestByToken(token, entityType, entityId);
            expect(guestByToken).toMatchObject({
                id: guestId,
                username: guestUsername,
                email: guestEmail,
            });

            const internal = await getGuestInternal(guestId);
            expect(internal).toEqual({
                id: guestId,
                username: guestUsername,
                email: guestEmail,
            });
        }
    );

    test.each(guestRegistrationData)(
        '$description',
        async ({entityType, entityId, username, email}) => {
            const {guestId, token} = await registerGuest(entityType, entityId, username, email);
            expect(typeof guestId).toBe('number');
            expect(typeof token).toBe('string');

            const byToken = await getGuestByToken(token, entityType, entityId);
            expect(byToken).toMatchObject({id: guestId, username});
        }
    );
});

describe('OIDC / SSO', () => {
    it('finds by exact OIDC pair, links by email, and JIT-provisions when not found', async () => {
        // 1) Exact match
        const exactData = oidcExactMatchData[0];
        const uExact = AppDataSource.getRepository(User).create({
            username: exactData.username,
            name: exactData.name,
            email: exactData.email,
            password: exactData.password,
            isActive: exactData.isActive,
            oidcIssuer: exactData.oidcIssuer,
            oidcSub: exactData.oidcSub,
        });
        await AppDataSource.getRepository(User).save(uExact);

        const foundExact = await getUserByOidc(exactData.oidcIssuer, exactData.oidcSub);
        expect(foundExact).toMatchObject({username: exactData.username, isActive: exactData.expectedActive});

        // 2) Link-by-email path (existing local account gets linked+activated)
        const linkData = oidcLinkByEmailData[0];
        const localUnlinked = AppDataSource.getRepository(User).create({
            username: linkData.localUsername,
            name: linkData.localName,
            email: linkData.localEmail,
            password: linkData.localPassword,
            isActive: linkData.localIsActive,
        });
        await AppDataSource.getRepository(User).save(localUnlinked);

        const linked = await findOrCreateUserFromOidc(
            linkData.oidcIssuer,
            {
                sub: linkData.oidcSub,
                email: linkData.oidcEmail,
                preferred_username: linkData.oidcUsername,
                name: linkData.oidcName,
            },
            {linkByEmail: linkData.linkByEmail}
        );

        expect(linked.id).toBe(localUnlinked.id);
        expect(linked.oidcIssuer).toBe(linkData.oidcIssuer);
        expect(linked.oidcSub).toBe(linkData.oidcSub);
        expect(linked.isActive).toBe(linkData.expectedActive);

        // 3) JIT-provisioning: ensure unique username is generated when base exists
        const jitData = oidcJitProvisioningData[0];
        await registerUser(jitData.existingUsername, jitData.existingName, jitData.existingPassword, jitData.existingEmail);

        const jitUser = await findOrCreateUserFromOidc(
            jitData.oidcIssuer,
            {
                sub: jitData.oidcSub,
                email: jitData.oidcEmail,
                preferred_username: jitData.oidcPreferredUsername,
                name: jitData.oidcName,
            }
        );

        expect(jitUser.username).toMatch(jitData.expectedUsernamePattern);
        expect(jitUser.username).toBe(jitData.expectedUsername);
        expect(jitUser.isActive).toBe(jitData.expectedActive);
        expect(jitUser.password).toBeNull();

        await unlinkOidc(linked.id);

        // sanity: OIDC pair shouldn't resolve anymore
        const shouldBeGone = await getUserByOidc(linkData.oidcIssuer, linkData.oidcSub);
        expect(shouldBeGone).toBeNull();

        // fetch the row and INCLUDE hidden columns explicitly
        const relinkCheck = await AppDataSource.getRepository(User)
            .createQueryBuilder('u')
            .addSelect(['u.oidcIssuer', 'u.oidcSub'])
            .where('u.id = :id', {id: linked.id})
            .getOneOrFail();

        expect(relinkCheck.oidcIssuer).toBeNull();
        expect(relinkCheck.oidcSub).toBeNull();
    });

    test.each(oidcNoLinkByEmailData)(
        '$description',
        async ({
                   localUsername,
                   localName,
                   localEmail,
                   localPassword,
                   localIsActive,
                   oidcIssuer,
                   oidcSub,
                   oidcEmail,
                   oidcPreferredUsername,
                   oidcName,
                   linkByEmail,
                   expectedActive,
               }) => {
            // Local account with same email, but we disable linkByEmail
            const local = AppDataSource.getRepository(User).create({
                username: localUsername,
                name: localName,
                email: localEmail,
                password: localPassword,
                isActive: localIsActive,
            });
            await AppDataSource.getRepository(User).save(local);

            const created = await findOrCreateUserFromOidc(
                oidcIssuer,
                {
                    sub: oidcSub,
                    email: oidcEmail,
                    preferred_username: oidcPreferredUsername,
                    name: oidcName,
                },
                {linkByEmail}
            );

            expect(created.id).not.toBe(local.id);
            expect(created.oidcIssuer).toBe(oidcIssuer);
            expect(created.oidcSub).toBe(oidcSub);
            expect(created.isActive).toBe(expectedActive);
        }
    );
});
