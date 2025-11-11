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
 * Test cases for requireManageRight - success scenarios
 */
export const requireManageRightSuccessData = [
    {
        description: 'guestManage grants access when identified (user)',
        session: { user: { id: 4 } },
        resource: { guestManage: true },
    },
    {
        description: 'guestManage grants access when identified (guest)',
        session: { guest: { id: 8 } },
        resource: { guestManage: true },
    },
    {
        description: 'owner can manage even without guestManage',
        session: { user: { id: 1 } },
        resource: { ownerId: 1, guestManage: false },
    },
];

/**
 * Test cases for requireAddRight - success scenarios
 */
export const requireAddRightSuccessData = [
    {
        description: 'guestAdd grants access when identified (user)',
        session: { user: { id: 4 } },
        resource: { allowGuestAdd: true },
    },
    {
        description: 'guestAdd grants access when identified (guest)',
        session: { guest: { id: 55 } },
        resource: { allowGuestAdd: true },
    },
    {
        description: 'owner can add even without guestAdd',
        session: { user: { id: 2 } },
        resource: { ownerId: 2, allowGuestAdd: false },
    },
];

/**
 * Test cases for requireManageRight/requireAddRight - failure scenarios
 */
export const requireRightsFailureData = [
    {
        description: 'no identification -> guestManage/guestAdd do not grant',
        session: {},
        resource: { allowGuestAdd: true, guestManage: true },
        expectedStatus: 403,
        expectedErrorType: 'expected',
    },
    {
        description: 'guestManage false and not owner',
        session: { user: { id: 5 } },
        resource: { ownerId: 1, guestManage: false },
        expectedStatus: 403,
        expectedErrorType: 'expected',
    },
];

/**
 * Test cases for isEventPermitted - useEvent=false scenarios
 */
export const isEventPermittedFalseData = [
    {
        description: 'useEvent=false + eventId query -> 400',
        session: { user: { id: 1 } },
        resource: { ownerId: 1 },
        query: { eventId: 'E123' },
        expectedStatus: 400,
        expectedErrorType: 'expected',
    },
    {
        description: 'useEvent=false + different eventId',
        session: { user: { id: 2 } },
        resource: { ownerId: 2 },
        query: { eventId: 'E999' },
        expectedStatus: 400,
        expectedErrorType: 'expected',
    },
];

/**
 * Test cases for isEventPermittedAPI - useEvent=false scenarios  
 */
export const isEventPermittedAPIFalseData = [
    {
        description: 'returns API error when useEvent=false + eventId',
        session: { user: { id: 1 } },
        resource: { ownerId: 1 },
        query: { eventId: 'E123' },
        expectedStatus: 400,
        expectedErrorType: 'api',
    },
];

/**
 * Test cases for isEventPermitted - useEvent=true scenarios
 */
export const isEventPermittedTrueData = [
    {
        description: 'useEvent=true does not 400 when eventId present',
        session: { user: { id: 1 } },
        resource: { ownerId: 1 },
        query: { eventId: 'E123' },
    },
    {
        description: 'useEvent=true allows different eventId',
        session: { user: { id: 2 } },
        resource: { ownerId: 2 },
        query: { eventId: 'E456' },
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
