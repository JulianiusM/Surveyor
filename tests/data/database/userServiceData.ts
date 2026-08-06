/**
 * Test data for user.service.test.ts
 * Data-driven test cases for user registration, activation, password reset, guests, roles, and OIDC/SSO
 */

export const userRegistrationData = [
    {
        description: 'registers a user with hashed password and inactive status',
        username: 'alice',
        name: 'Alice A.',
        password: 'secret123',
        email: 'alice@example.com',
        wrongPassword: 'wrong',
        expectedActive: 0,
    },
];

export const activationTokenData = [
    {
        description: 'generates/validates activation token and activates the user',
        username: 'bob',
        name: 'Bob B.',
        password: 'pw',
        email: 'bob@example.com',
        expectedActiveAfter: 1,
    },
];

export const passwordResetData = [
    {
        description: 'handles password reset token lifecycle and password change',
        username: 'carol',
        name: 'Carol C.',
        oldPassword: 'oldpw',
        newPassword: 'newpw',
        email: 'carol@example.com',
    },
];

export const guestCreationData = [
    {
        description: 'creates a guest, links it to an entity, fetches via token, and reads internals',
        guestUsername: 'guestOne',
        guestEmail: 'g1@example.com',
        entityType: 'drivers-list',
        entityId: 'list-123',
    },
];

export const guestRegistrationData = [
    {
        description: 'registerGuest creates a guest and link in one step',
        entityType: 'activity',
        entityId: 'A-42',
        username: 'walk-in',
        email: 'walkin@example.com',
    },
];

export const rolesData = [
    {
        description: 'returns all roles',
        roles: [
            {id: 1, name: 'Admin'},
            {id: 2, name: 'Member'},
        ],
        expectedNames: ['Admin', 'Member'],
    },
];

export const oidcExactMatchData = [
    {
        description: 'finds by exact OIDC pair',
        username: 'sso-exact',
        name: 'Exact',
        email: 'exact@example.com',
        password: null,
        isActive: true,
        oidcIssuer: 'https://issuer.example',
        oidcSub: 'sub-123',
        expectedActive: 1,
    },
];

export const oidcLinkByEmailData = [
    {
        description: 'links existing local account by email when option enabled',
        localUsername: 'local-only',
        localName: 'Local',
        localEmail: 'linkme@example.com',
        localPassword: 'x',
        localIsActive: false,
        oidcIssuer: 'https://issuer.example',
        oidcSub: 'sub-456',
        oidcEmail: 'linkme@example.com',
        oidcUsername: 'whatever',
        oidcName: 'Linked Name',
        linkByEmail: true,
        expectedActive: true,
    },
];

export const oidcJitProvisioningData = [
    {
        description: 'JIT-provisions new user with unique username when base exists',
        existingUsername: 'alice',
        existingName: 'Alice Local',
        existingPassword: 'pw',
        existingEmail: 'alice.local@example.com',
        oidcIssuer: 'https://issuer.example',
        oidcSub: 'new-sub-999',
        oidcEmail: 'newuser@example.com',
        oidcPreferredUsername: 'alice', // collides with existing
        oidcName: 'Alice OIDC',
        expectedUsernamePattern: /^alice(-\d+)?$/,
        expectedUsername: 'alice-1', // first collision gets -1
        expectedActive: 1,
        expectedPassword: null,
    },
];

export const oidcNoLinkByEmailData = [
    {
        description: 'does not link by email when option disabled; provisions instead',
        localUsername: 'nomatch',
        localName: 'No Match',
        localEmail: 'same@example.com',
        localPassword: 'x',
        localIsActive: false,
        oidcIssuer: 'https://issuer.other',
        oidcSub: 's-1',
        oidcEmail: 'same@example.com',
        oidcPreferredUsername: 'nomatch',
        oidcName: 'OIDC NoLink',
        linkByEmail: false,
        expectedActive: 1,
    },
];
