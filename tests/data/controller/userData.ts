/**
 * Test data for user controller tests
 */

/**
 * Test cases for registerUser function
 */
export const registerUserData = [
    {
        description: 'throws when required fields missing',
        body: { username: 'u' },
        shouldThrow: true,
        errorType: 'ValidationError',
    },
    {
        description: 'throws when passwords mismatch',
        body: {
            username: 'u',
            displayname: 'U',
            password: 'a',
            password_repeat: 'b',
            email: 'e@x'
        },
        shouldThrow: true,
        errorType: 'ValidationError',
    },
    {
        description: 'throws when username taken',
        body: {
            username: 'u',
            displayname: 'U',
            password: 'a',
            password_repeat: 'a',
            email: 'e@x'
        },
        mockUserExists: true,
        shouldThrow: true,
        errorType: 'ValidationError',
    },
    {
        description: 'registers, creates activation token, and emails link',
        body: {
            username: 'u',
            displayname: 'U',
            password: 'a',
            password_repeat: 'a',
            email: 'e@x'
        },
        mockUserExists: false,
        mockUserId: 42,
        mockToken: 'tok123',
        expectedRegisterCall: ['u', 'U', 'a', 'e@x'],
        expectedTokenCall: [42],
        expectedEmailCall: ['e@x', 'http://test.local/users/activate/tok123'],
        shouldThrow: false,
    },
];

/**
 * Test cases for loginUser function
 */
export const loginUserData = [
    {
        description: 'throws when username/password missing',
        body: { username: 'u' },
        shouldThrow: true,
        errorType: 'ValidationError',
    },
    {
        description: 'throws when user not found',
        body: { username: 'u', password: 'p' },
        mockUser: null,
        shouldThrow: true,
        errorType: 'ValidationError',
    },
    {
        description: 'throws when password invalid',
        body: { username: 'u', password: 'p' },
        mockUser: { id: 7, username: 'u', email: 'e@x', isActive: true },
        mockPasswordValid: false,
        shouldThrow: true,
        errorType: 'ValidationError',
    },
    {
        description: 'sets session.user when active and password valid',
        body: { username: 'u', password: 'p' },
        mockUser: { id: 7, username: 'u', email: 'e@x', isActive: true },
        mockPasswordValid: true,
        shouldThrow: false,
        expectedSessionUser: { id: 7, username: 'u', email: 'e@x', isActive: true },
    },
    {
        description: 'inactive user: expired activation triggers resend and throws',
        body: { username: 'u', password: 'p' },
        mockUser: {
            id: 7,
            username: 'u',
            email: 'e@x',
            isActive: false,
            activationTokenExpiration: new Date('2000-01-01'),
        },
        mockPasswordValid: true,
        mockToken: 'tokX',
        shouldThrow: true,
        errorType: 'ValidationError',
        expectsTokenGeneration: true,
        expectsEmail: true,
    },
    {
        description: 'inactive user: not expired does not resend, still throws',
        body: { username: 'u', password: 'p' },
        mockUser: {
            id: 7,
            username: 'u',
            email: 'e@x',
            isActive: false,
            activationTokenExpiration: new Date(Date.now() + 86400_000),
        },
        mockPasswordValid: true,
        shouldThrow: true,
        errorType: 'ValidationError',
        expectsTokenGeneration: false,
        expectsEmail: false,
    },
];

/**
 * Test cases for dashboard entity loaders
 */
export const dashboardEntityData = [
    {
        description: 'getUserDashboardEntities aggregates all lists',
        type: 'user',
        userId: 9,
        mockData: {
            surveys: ['s'],
            packlists: ['p'],
            activityplans: ['a'],
            driverslists: ['d'],
            events: ['e'],
            registeredEvents: ['re'],
        },
        expected: {
            surveys: ['s'],
            packlists: ['p'],
            activityplans: ['a'],
            driverslists: ['d'],
            events: ['e'],
            registeredEvents: ['re'],
        },
    },
    {
        description: 'getGuestDashboardEntities returns only registered events',
        type: 'guest',
        userId: 5,
        mockData: {
            registeredEvents: ['evt1', 'evt2'],
        },
        expected: {
            registeredEvents: ['evt1', 'evt2'],
        },
    },
];

/**
 * Test cases for password reset flow
 */
export const passwordResetData = [
    {
        description: 'sendPasswordForgotMail: no-op when user not found',
        action: 'sendPasswordForgotMail',
        username: 'nonexist',
        mockUser: null,
        expectsToken: false,
        expectsEmail: false,
    },
    {
        description: 'sendPasswordForgotMail: generates token and emails link',
        action: 'sendPasswordForgotMail',
        username: 'u',
        mockUser: { id: 10, email: 'u@x' },
        mockToken: 'reset-tok',
        expectsToken: true,
        expectsEmail: true,
        expectedEmailCall: ['u@x', 'http://test.local/users/reset-password/reset-tok'],
    },
    {
        description: 'checkPasswordForgotToken: throws on invalid token',
        action: 'checkPasswordForgotToken',
        token: 'bad',
        mockVerifyResult: null,
        shouldThrow: true,
        errorType: 'ExpectedError',
    },
    {
        description: 'resetPassword: rejects mismatched passwords',
        action: 'resetPassword',
        token: 'tok',
        body: { password: 'a', confirmPassword: 'b' },
        shouldThrow: true,
        errorType: 'ValidationError',
    },
    {
        description: 'resetPassword: invalid token -> ExpectedError',
        action: 'resetPassword',
        token: 'bad',
        body: { password: 'a', confirmPassword: 'a' },
        mockVerifyResult: null,
        shouldThrow: true,
        errorType: 'ExpectedError',
    },
    {
        description: 'resetPassword: valid token resets password',
        action: 'resetPassword',
        token: 'valid',
        body: { password: 'newpass', confirmPassword: 'newpass' },
        mockVerifyResult: { username: 'testuser' },
        shouldThrow: false,
        expectedResetCall: ['testuser', 'newpass'],
    },
];

/**
 * Test cases for activateAccount
 */
export const activateAccountData = [
    {
        description: 'throws on invalid token',
        token: 'bad',
        mockVerifyResult: null,
        shouldThrow: true,
        errorType: 'ExpectedError',
    },
    {
        description: 'activates user on valid token',
        token: 'valid',
        mockVerifyResult: { id: 77 },
        shouldThrow: false,
        expectedActivateCall: [77],
    },
];

/**
 * Test cases for OIDC wrappers
 */
export const oidcWrapperData = [
    {
        description: 'loginUserWithOidc delegates to startLogin',
        method: 'loginUserWithOidc',
        mockRequest: { query: { returnTo: '/dash' } },
        mockResponse: {},
        delegateTo: 'startLogin',
        mockReturnValue: 'redir',
        expectedResult: 'redir',
    },
    {
        description: 'loginUserWithOidcCallback delegates to callback',
        method: 'loginUserWithOidcCallback',
        mockRequest: {},
        mockResponse: {},
        delegateTo: 'callback',
        mockReturnValue: { user: { id: 1 } },
        expectedResult: { user: { id: 1 } },
    },
    {
        description: 'logoutUserOidc delegates to logout',
        method: 'logoutUserOidc',
        mockRequest: {},
        mockResponse: {},
        delegateTo: 'logout',
        mockReturnValue: 'logoutUrl',
        expectedResult: 'logoutUrl',
    },
];
