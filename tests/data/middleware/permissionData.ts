/**
 * Test data for permission middleware tests
 * Data-driven test cases for authentication and authorization middleware
 */

/**
 * Test cases for requireOwner middleware - success scenarios
 */
export const requireOwnerSuccessData = [
    {
        description: 'allows when session user owns resource',
        session: { user: { id: 1 } },
        resource: { ownerId: 1 },
        additional: undefined,
    },
    {
        description: 'allows when ownership via additional (userId)',
        session: { user: { id: 5 } },
        resource: { ownerId: 99 },
        additional: [{ userId: 5 }],
    },
    {
        description: 'allows when ownership via additional (guestId)',
        session: { guest: { id: 7 } },
        resource: { ownerId: 99 },
        additional: [{ guestId: 7 }],
    },
    {
        description: 'allows when user owns via multiple additional entries',
        session: { user: { id: 10 } },
        resource: { ownerId: 1 },
        additional: [{ userId: 2 }, { userId: 10 }],
    },
];

/**
 * Test cases for requireOwner middleware - failure scenarios
 */
export const requireOwnerFailureData = [
    {
        description: 'forbids when not owner',
        session: { user: { id: 2 } },
        resource: { ownerId: 1 },
        additional: undefined,
        expectedStatus: 403,
        expectedErrorType: 'expected',
    },
    {
        description: 'forbids when user not in additional',
        session: { user: { id: 5 } },
        resource: { ownerId: 1 },
        additional: [{ userId: 3 }],
        expectedStatus: 403,
        expectedErrorType: 'expected',
    },
    {
        description: 'forbids when no session',
        session: {},
        resource: { ownerId: 1 },
        additional: undefined,
        expectedStatus: 403,
        expectedErrorType: 'expected',
    },
];

/**
 * Test cases for requireOwnerAPI middleware - failure scenarios
 */
export const requireOwnerAPIFailureData = [
    {
        description: 'returns API error when not owner',
        session: { user: { id: 2 } },
        resource: { ownerId: 1 },
        additional: undefined,
        expectedStatus: 403,
        expectedErrorType: 'api',
    },
];

/**
 * Test cases for requireEventParticipant - success scenarios
 */
export const requireEventParticipantSuccessData = [
    {
        description: 'allows when registered for event',
        session: { user: { id: 10 } },
        resource: { eventId: 'E1' },
        isRegistered: true,
    },
    {
        description: 'allows when owner of event resource',
        session: { user: { id: 5 } },
        resource: { eventId: 'E2', ownerId: 5 },
        isRegistered: false, // not registered but owns the resource
    },
    {
        description: 'allows guest when registered',
        session: { guest: { id: 3 } },
        resource: { eventId: 'E3' },
        isRegistered: true,
    },
];

/**
 * Test cases for requireEventParticipant - failure scenarios
 */
export const requireEventParticipantFailureData = [
    {
        description: 'forbids when not registered and not owner',
        session: { user: { id: 11 } },
        resource: { eventId: 'E2', ownerId: 99 },
        isRegistered: false,
        expectedStatus: 403,
        expectedErrorType: 'expected',
    },
    {
        description: 'forbids guest when not registered and not owner',
        session: { guest: { id: 5 } },
        resource: { eventId: 'E4', ownerId: 1 },
        isRegistered: false,
        expectedStatus: 403,
        expectedErrorType: 'expected',
    },
];

/**
 * Test cases for requireEventParticipant - bypass scenarios
 */
export const requireEventParticipantBypassData = [
    {
        description: 'non-event resources bypass event check (allowed)',
        session: { user: { id: 1 } },
        resource: { ownerId: 999 }, // no eventId
        isRegistered: false, // shouldn't be checked
    },
    {
        description: 'resource without eventId passes through',
        session: { guest: { id: 2 } },
        resource: { ownerId: 1 },
        isRegistered: false,
    },
];

/**
 * Test cases for isAuthenticated middleware
 */
export const isAuthenticatedData = [
    {
        description: 'passes through when user in session',
        session: { user: { id: 1 } },
        shouldPass: true,
    },
    {
        description: 'passes through with different user',
        session: { user: { id: 999 } },
        shouldPass: true,
    },
    {
        description: 'redirects when not authenticated',
        session: {},
        shouldPass: false,
        expectedRedirect: '/users/login',
        expectedFlashMessage: 'You must be logged in to access this site.',
    },
];

/**
 * Test cases for requirePermission - success scenarios
 * Tests the new permission system that replaced requireManageRight/requireAddRight
 */
export const requirePermissionSuccessData = [
    {
        description: 'allows owner with any permission check',
        session: { user: { id: 1 } },
        entityDescriptor: { entityType: 'activity', entityId: 'a1', ownerUserId: 1 },
        requiredPerm: 1 << 0, // EDIT_TITLE permission
    },
    {
        description: 'allows user with specific permission granted',
        session: { user: { id: 2 } },
        entityDescriptor: { entityType: 'drivers', entityId: 'd1', ownerUserId: 1 },
        requiredPerm: 1 << 13, // ACCESS_VIEW permission
        userPerms: 1 << 13, // User has ACCESS_VIEW
    },
    {
        description: 'allows guest with permission granted',
        session: { guest: { id: 3 } },
        entityDescriptor: { entityType: 'packing', entityId: 'p1', ownerUserId: 1 },
        requiredPerm: 1 << 13, // ACCESS_VIEW permission
        guestPerms: 1 << 13, // Guest has ACCESS_VIEW
    },
];

/**
 * Test cases for requirePermission - failure scenarios
 */
export const requirePermissionFailureData = [
    {
        description: 'forbids user without required permission',
        session: { user: { id: 2 } },
        entityDescriptor: { entityType: 'activity', entityId: 'a1', ownerUserId: 1 },
        requiredPerm: 1 << 0, // EDIT_TITLE permission
        userPerms: 0, // User has no permissions
        expectedStatus: 403,
        expectedErrorType: 'expected',
    },
    {
        description: 'forbids guest without required permission',
        session: { guest: { id: 3 } },
        entityDescriptor: { entityType: 'drivers', entityId: 'd1', ownerUserId: 1 },
        requiredPerm: 1 << 4, // ITEM_ADD permission
        guestPerms: 1 << 13, // Guest only has ACCESS_VIEW
        expectedStatus: 403,
        expectedErrorType: 'expected',
    },
    {
        description: 'forbids when no session',
        session: {},
        entityDescriptor: { entityType: 'packing', entityId: 'p1', ownerUserId: 1 },
        requiredPerm: 1 << 13, // ACCESS_VIEW permission
        expectedStatus: 403,
        expectedErrorType: 'expected',
    },
];

/**
 * Test cases for requirePermissionApi - failure scenarios (API error variant)
 */
export const requirePermissionApiFailureData = [
    {
        description: 'returns API error when permission denied',
        session: { user: { id: 2 } },
        entityDescriptor: { entityType: 'activity', entityId: 'a1', ownerUserId: 1 },
        requiredPerm: 1 << 0, // EDIT_TITLE permission
        userPerms: 0,
        expectedStatus: 403,
        expectedErrorType: 'api',
    },
];
