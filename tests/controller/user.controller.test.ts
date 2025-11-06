/**
 * Unit tests for src/controller/userController.ts
 * Focus on validation, orchestration, side effects, and delegation.
 */

jest.mock('../../src/modules/database/services/UserService', () => ({
    getUserByUsername: jest.fn(),
    registerUser: jest.fn(),
    generateActivationToken: jest.fn(),
    verifyPassword: jest.fn(),
    generatePasswordResetToken: jest.fn(),
    verifyPasswordResetToken: jest.fn(),
    resetPassword: jest.fn(),
    verifyActivationToken: jest.fn(),
    activateUser: jest.fn(),
}));

jest.mock('../../src/modules/database/services/ActivityService', () => ({
    getActivityPlansByUserId: jest.fn(),
}));

jest.mock('../../src/modules/database/services/DriverService', () => ({
    getDriversListByUserId: jest.fn(),
}));

jest.mock('../../src/modules/database/services/EventService', () => ({
    getEventsByOwnerId: jest.fn(),
    getRegisteredEventsFor: jest.fn(),
}));

jest.mock('../../src/modules/database/services/PackingService', () => ({
    getPackingListByUserId: jest.fn(),
}));

jest.mock('../../src/modules/database/services/SurveyService', () => ({
    getSurveysByUserId: jest.fn(),
}));

jest.mock('../../src/modules/settings', () => ({
    __esModule: true,
    default: {value: {rootUrl: 'http://test.local'}},
}));

const sendActivationEmail = jest.fn();
const sendPasswordResetEmail = jest.fn();
jest.mock('../../src/modules/email', () => ({
    __esModule: true,
    default: {
        sendActivationEmail: (...args: any[]) => sendActivationEmail(...args),
        sendPasswordResetEmail: (...args: any[]) => sendPasswordResetEmail(...args),
    },
}));

jest.mock('../../src/modules/oidc', () => ({
    startLogin: jest.fn(),
    callback: jest.fn(),
    logout: jest.fn(),
}));

import {
    activateAccount,
    checkPasswordForgotToken,
    getGuestDashboardEntities,
    getUserDashboardEntities,
    loginUser,
    loginUserWithOidc,
    loginUserWithOidcCallback,
    logoutUserOidc,
    registerUser,
    resetPassword,
    sendPasswordForgotMail,
} from '../../src/controller/userController';

import * as userService from '../../src/modules/database/services/UserService';
import * as activityService from '../../src/modules/database/services/ActivityService';
import * as driverService from '../../src/modules/database/services/DriverService';
import * as eventService from '../../src/modules/database/services/EventService';
import * as packingService from '../../src/modules/database/services/PackingService';
import * as surveyService from '../../src/modules/database/services/SurveyService';
import * as oidc from '../../src/modules/oidc';
import {ExpectedError, ValidationError} from '../../src/modules/lib/errors';

beforeEach(() => {
    jest.clearAllMocks();
});

describe('registerUser', () => {
    it('throws when required fields missing', async () => {
        await expect(registerUser({username: 'u'} as any))
            .rejects.toBeInstanceOf(ValidationError);
    });

    it('throws when passwords mismatch', async () => {
        await expect(registerUser({
            username: 'u', displayname: 'U', password: 'a', password_repeat: 'b', email: 'e@x'
        })).rejects.toBeInstanceOf(ValidationError);
    });

    it('throws when username taken', async () => {
        (userService.getUserByUsername as jest.Mock).mockResolvedValue({id: 1});
        await expect(registerUser({
            username: 'u', displayname: 'U', password: 'a', password_repeat: 'a', email: 'e@x'
        })).rejects.toBeInstanceOf(ValidationError);
    });

    it('registers, creates activation token, and emails link', async () => {
        (userService.getUserByUsername as jest.Mock).mockResolvedValue(null);
        (userService.registerUser as jest.Mock).mockResolvedValue(42);
        (userService.generateActivationToken as jest.Mock).mockResolvedValue('tok123');

        await expect(registerUser({
            username: 'u', displayname: 'U', password: 'a', password_repeat: 'a', email: 'e@x'
        })).resolves.toBeUndefined();

        expect(userService.registerUser).toHaveBeenCalledWith('u', 'U', 'a', 'e@x');
        expect(userService.generateActivationToken).toHaveBeenCalledWith(42);
        expect(sendActivationEmail).toHaveBeenCalledWith('e@x', 'http://test.local/users/activate/tok123');
    });
});

describe('loginUser', () => {
    const baseUser = {id: 7, username: 'u', email: 'e@x', isActive: true};

    it('throws when username/password missing', async () => {
        await expect(loginUser({username: 'u'} as any, {} as any)).rejects.toBeInstanceOf(ValidationError);
    });

    it('throws when user not found', async () => {
        (userService.getUserByUsername as jest.Mock).mockResolvedValue(null);
        await expect(loginUser({username: 'u', password: 'p'}, {} as any)).rejects.toBeInstanceOf(ValidationError);
    });

    it('throws when password invalid', async () => {
        (userService.getUserByUsername as jest.Mock).mockResolvedValue(baseUser);
        (userService.verifyPassword as jest.Mock).mockResolvedValue(false);
        await expect(loginUser({username: 'u', password: 'p'}, {} as any)).rejects.toBeInstanceOf(ValidationError);
    });

    it('sets session.user when active and password valid', async () => {
        const session: any = {};
        (userService.getUserByUsername as jest.Mock).mockResolvedValue(baseUser);
        (userService.verifyPassword as jest.Mock).mockResolvedValue(true);

        await loginUser({username: 'u', password: 'p'}, session);
        expect(session.user).toEqual(baseUser);
    });

    it('inactive user: expired activation triggers resend and throws', async () => {
        const inactive = {
            ...baseUser,
            isActive: false,
            activationTokenExpiration: new Date('2000-01-01'),
        };
        (userService.getUserByUsername as jest.Mock).mockResolvedValue(inactive);
        (userService.verifyPassword as jest.Mock).mockResolvedValue(true);
        (userService.generateActivationToken as jest.Mock).mockResolvedValue('tokX');

        await expect(loginUser({username: 'u', password: 'p'}, {} as any))
            .rejects.toBeInstanceOf(ValidationError);

        expect(userService.generateActivationToken).toHaveBeenCalledWith(7);
        expect(sendActivationEmail).toHaveBeenCalledWith('e@x', 'http://test.local/users/activate/tokX');
    });

    it('inactive user: not expired does not resend, still throws', async () => {
        const inactive = {
            ...baseUser,
            isActive: false,
            activationTokenExpiration: new Date(Date.now() + 86400_000),
        };
        (userService.getUserByUsername as jest.Mock).mockResolvedValue(inactive);
        (userService.verifyPassword as jest.Mock).mockResolvedValue(true);

        await expect(loginUser({username: 'u', password: 'p'}, {} as any))
            .rejects.toBeInstanceOf(ValidationError);

        expect(userService.generateActivationToken).not.toHaveBeenCalled();
        expect(sendActivationEmail).not.toHaveBeenCalled();
    });
});

describe('dashboard entity loaders', () => {
    it('getUserDashboardEntities aggregates all lists', async () => {
        (surveyService.getSurveysByUserId as jest.Mock).mockResolvedValue(['s']);
        (packingService.getPackingListByUserId as jest.Mock).mockResolvedValue(['p']);
        (activityService.getActivityPlansByUserId as jest.Mock).mockResolvedValue(['a']);
        (driverService.getDriversListByUserId as jest.Mock).mockResolvedValue(['d']);
        (eventService.getEventsByOwnerId as jest.Mock).mockResolvedValue(['e']);
        (eventService.getRegisteredEventsFor as jest.Mock).mockResolvedValue(['re']);

        const out = await getUserDashboardEntities({id: 9} as any);
        expect(out).toEqual({
            surveys: ['s'],
            packlists: ['p'],
            activityplans: ['a'],
            driverslists: ['d'],
            events: ['e'],
            registeredEvents: ['re'],
        });

        expect(surveyService.getSurveysByUserId).toHaveBeenCalledWith(9);
        expect(eventService.getRegisteredEventsFor).toHaveBeenCalledWith({userId: 9});
    });

    it('getGuestDashboardEntities returns only registered events', async () => {
        (eventService.getRegisteredEventsFor as jest.Mock).mockResolvedValue(['ge']);
        const out = await getGuestDashboardEntities({id: 5} as any);
        expect(out).toEqual({registeredEvents: ['ge']});
        expect(eventService.getRegisteredEventsFor).toHaveBeenCalledWith({guestId: 5});
    });
});

describe('password reset flow', () => {
    it('sendPasswordForgotMail: no-op when user not found', async () => {
        (userService.getUserByUsername as jest.Mock).mockResolvedValue(null);
        await sendPasswordForgotMail('nobody');
        expect(userService.generatePasswordResetToken).not.toHaveBeenCalled();
        expect(sendPasswordResetEmail).not.toHaveBeenCalled();
    });

    it('sendPasswordForgotMail: generates token and emails link', async () => {
        (userService.getUserByUsername as jest.Mock).mockResolvedValue({email: 'e@x'});
        (userService.generatePasswordResetToken as jest.Mock).mockResolvedValue('rtok');
        await sendPasswordForgotMail('u');
        expect(userService.generatePasswordResetToken).toHaveBeenCalledWith('u');
        expect(sendPasswordResetEmail).toHaveBeenCalledWith('e@x', 'http://test.local/users/reset-password/rtok');
    });

    it('checkPasswordForgotToken: throws on invalid token', async () => {
        (userService.verifyPasswordResetToken as jest.Mock).mockResolvedValue(null);
        await expect(checkPasswordForgotToken('bad')).rejects.toBeInstanceOf(ExpectedError);
    });

    it('resetPassword: rejects mismatched passwords', async () => {
        await expect(resetPassword('tok', {password: 'a', confirmPassword: 'b'}))
            .rejects.toBeInstanceOf(ValidationError);
    });

    it('resetPassword: invalid token -> ExpectedError', async () => {
        (userService.verifyPasswordResetToken as jest.Mock).mockResolvedValue(null);
        await expect(resetPassword('tok', {password: 'a', confirmPassword: 'a'}))
            .rejects.toBeInstanceOf(ExpectedError);
    });

    it('resetPassword: valid token resets password', async () => {
        (userService.verifyPasswordResetToken as jest.Mock).mockResolvedValue({username: 'u'});
        await resetPassword('tok', {password: 'a', confirmPassword: 'a'});
        expect(userService.resetPassword).toHaveBeenCalledWith('u', 'a');
    });
});

describe('activateAccount', () => {
    it('throws on invalid token', async () => {
        (userService.verifyActivationToken as jest.Mock).mockResolvedValue(null);
        await expect(activateAccount('bad')).rejects.toBeInstanceOf(ExpectedError);
    });

    it('activates user on valid token', async () => {
        (userService.verifyActivationToken as jest.Mock).mockResolvedValue({id: 77});
        await activateAccount('good');
        expect(userService.activateUser).toHaveBeenCalledWith(77);
    });
});

describe('OIDC wrappers', () => {
    it('loginUserWithOidc delegates to startLogin', async () => {
        (oidc.startLogin as jest.Mock).mockResolvedValue('redir');
        const session: any = {};
        const res = await loginUserWithOidc(session);
        expect(oidc.startLogin).toHaveBeenCalledWith(session);
        expect(res).toBe('redir');
    });

    it('loginUserWithOidcCallback delegates to callback', async () => {
        (oidc.callback as jest.Mock).mockResolvedValue('done');
        const req: any = {session: {}};
        const res = await loginUserWithOidcCallback(req as any);
        expect(oidc.callback).toHaveBeenCalledWith(req);
        expect(res).toBe('done');
    });

    it('logoutUserOidc delegates to logout', async () => {
        (oidc.logout as jest.Mock).mockResolvedValue('bye');
        const session: any = {};
        const res = await logoutUserOidc(session);
        expect(oidc.logout).toHaveBeenCalledWith(session);
        expect(res).toBe('bye');
    });
});
