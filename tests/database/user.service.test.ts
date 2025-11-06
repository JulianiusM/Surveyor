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
    getAllRoles,
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
} from '../../src/modules/database/services/UserService'; // <- adjust if your filename differs
import {AppDataSource, initDataSource} from '../../src/modules/database/dataSource';

// Entities used for setup/cleanup
import {User} from '../../src/modules/database/entities/user/User';
import {Guest} from '../../src/modules/database/entities/user/Guest';
import {GuestLink} from '../../src/modules/database/entities/user/GuestLink';
import {Role} from '../../src/modules/database/entities/user/Role';

async function truncateAll() {
    await AppDataSource.query('SET FOREIGN_KEY_CHECKS=0');

    await AppDataSource.createQueryBuilder().delete().from(GuestLink).execute();
    await AppDataSource.createQueryBuilder().delete().from(Guest).execute();
    await AppDataSource.createQueryBuilder().delete().from(Role).execute();
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
    it('registers a user with hashed password and inactive status', async () => {
        const userId = await registerUser('alice', 'Alice A.', 'secret123', 'alice@example.com');
        expect(typeof userId).toBe('number');

        const fetched = await getUserByUsername('alice');
        expect(fetched).toMatchObject({
            id: userId,
            username: 'alice',
            name: 'Alice A.',
            email: 'alice@example.com',
            isActive: 0,
        });

        // Password should not be selected by getUserByUsername
        // (TypeORM "select" omits password)
        expect(fetched!.password).toBeUndefined();

        // Verify password using the dedicated helper
        expect(await verifyPassword(userId, 'secret123')).toBe(true);
        expect(await verifyPassword(userId, 'wrong')).toBe(false);
    });

    it('generates/validates activation token and activates the user', async () => {
        const userId = await registerUser('bob', 'Bob B.', 'pw', 'bob@example.com');

        const token = await generateActivationToken(userId);
        expect(typeof token).toBe('string');
        expect(token.length).toBeGreaterThan(5);

        // Token should be valid now
        const byToken = await verifyActivationToken(token);
        expect(byToken).toMatchObject({
            id: userId,
            username: 'bob',
            email: 'bob@example.com',
            isActive: 0,
        });

        await activateUser(userId);
        const afterActivation = await getUserByUsername('bob');
        expect(afterActivation!.isActive).toBe(1);

        // Token should no longer be usable after activation (fields cleared)
        const byTokenAfter = await verifyActivationToken(token);
        expect(byTokenAfter).toBeNull();
    });

    it('handles password reset token lifecycle and password change', async () => {
        const userId = await registerUser('carol', 'Carol C.', 'oldpw', 'carol@example.com');

        const resetToken = await generatePasswordResetToken('carol');
        expect(typeof resetToken).toBe('string');

        const found = await verifyPasswordResetToken(resetToken);
        expect(found).toMatchObject({id: userId, username: 'carol'});

        await resetPassword('carol', 'newpw');

        // Token should be cleared and new password valid
        const after = await verifyPasswordResetToken(resetToken);
        expect(after).toBeNull();

        expect(await verifyPassword(userId, 'oldpw')).toBe(false);
        expect(await verifyPassword(userId, 'newpw')).toBe(true);
    });
});

describe('Guests & guest links', () => {
    it('creates a guest, links it to an entity, fetches via token, and reads internals', async () => {
        const guestId = await createGuest('guestOne', 'g1@example.com');
        expect(typeof guestId).toBe('number');

        const token = await createGuestLink('drivers-list', 'list-123', guestId);
        expect(typeof token).toBe('string');

        // get token again via helper
        const token2 = await getGuestLinkToken('drivers-list', 'list-123', guestId);
        expect(token2).toBe(token);

        // fetch by token
        const guestByToken = await getGuestByToken(token, 'drivers-list', 'list-123');
        expect(guestByToken).toMatchObject({
            id: guestId,
            username: 'guestOne',
            email: 'g1@example.com',
        });

        const internal = await getGuestInternal(guestId);
        expect(internal).toEqual({
            id: guestId,
            username: 'guestOne',
            email: 'g1@example.com',
        });
    });

    it('registerGuest creates a guest and link in one step', async () => {
        const {guestId, token} = await registerGuest(
            'activity',
            'A-42',
            'walk-in',
            'walkin@example.com'
        );
        expect(typeof guestId).toBe('number');
        expect(typeof token).toBe('string');

        const byToken = await getGuestByToken(token, 'activity', 'A-42');
        expect(byToken).toMatchObject({id: guestId, username: 'walk-in'});
    });
});

describe('Roles', () => {
    it('returns all roles', async () => {
        const r1 = AppDataSource.getRepository(Role).create({id: 1, name: 'Admin'});
        const r2 = AppDataSource.getRepository(Role).create({id: 2, name: 'Member'});
        await AppDataSource.getRepository(Role).save([r1, r2]);

        const roles = await getAllRoles();
        const titles = roles.map(r => r.name).sort();
        expect(titles).toEqual(['Admin', 'Member']);
    });
});

describe('OIDC / SSO', () => {
    it('finds by exact OIDC pair, links by email, and JIT-provisions when not found', async () => {
        // 1) Exact match
        const uExact = AppDataSource.getRepository(User).create({
            username: 'sso-exact',
            name: 'Exact',
            email: 'exact@example.com',
            password: null,
            isActive: true,
            oidcIssuer: 'https://issuer.example',
            oidcSub: 'sub-123',
        });
        await AppDataSource.getRepository(User).save(uExact);

        const foundExact = await getUserByOidc('https://issuer.example', 'sub-123');
        expect(foundExact).toMatchObject({username: 'sso-exact', isActive: 1});

        // 2) Link-by-email path (existing local account gets linked+activated)
        const localUnlinked = AppDataSource.getRepository(User).create({
            username: 'local-only',
            name: 'Local',
            email: 'linkme@example.com',
            password: 'x',
            isActive: false,
        });
        await AppDataSource.getRepository(User).save(localUnlinked);

        const linked = await findOrCreateUserFromOidc(
            'https://issuer.example',
            {
                sub: 'sub-456',
                email: 'linkme@example.com',
                preferred_username: 'whatever',
                name: 'Linked Name',
            },
            {linkByEmail: true}
        );

        expect(linked.id).toBe(localUnlinked.id);
        expect(linked.oidcIssuer).toBe('https://issuer.example');
        expect(linked.oidcSub).toBe('sub-456');
        expect(linked.isActive).toBe(true);

        // 3) JIT-provisioning: ensure unique username is generated when base exists
        // Create an existing user "alice" so the JIT user should become "alice-1"
        await registerUser('alice', 'Alice Local', 'pw', 'alice.local@example.com');

        const jitUser = await findOrCreateUserFromOidc(
            'https://issuer.example',
            {
                sub: 'new-sub-999',
                email: 'newuser@example.com',
                preferred_username: 'alice', // collides with existing 'alice'
                name: 'Alice OIDC',
            }
        );

        expect(jitUser.username).toMatch(/^alice(-\d+)?$/);
        expect(jitUser.username).toBe('alice-1'); // first collision should get -1
        expect(jitUser.isActive).toBe(1);
        expect(jitUser.password).toBeNull();

        await unlinkOidc(linked.id);

        // sanity: OIDC pair shouldn’t resolve anymore
        const shouldBeGone = await getUserByOidc('https://issuer.example', 'sub-456');
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

    it('does not link by email when option disabled; provisions instead', async () => {
        // Local account with same email, but we disable linkByEmail
        const local = AppDataSource.getRepository(User).create({
            username: 'nomatch',
            name: 'No Match',
            email: 'same@example.com',
            password: 'x',
            isActive: false,
        });
        await AppDataSource.getRepository(User).save(local);

        const created = await findOrCreateUserFromOidc(
            'https://issuer.other',
            {
                sub: 's-1',
                email: 'same@example.com',
                preferred_username: 'nomatch',
                name: 'OIDC NoLink',
            },
            {linkByEmail: false}
        );

        expect(created.id).not.toBe(local.id);
        expect(created.oidcIssuer).toBe('https://issuer.other');
        expect(created.oidcSub).toBe('s-1');
        expect(created.isActive).toBe(1);
    });
});
