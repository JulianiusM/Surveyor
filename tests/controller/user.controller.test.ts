/**
 * Unit tests for src/controller/userController.ts - Data Driven
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
    getManagedPlansForUser: jest.fn(),
    getActivityPlansByParticipantUserId: jest.fn(),
    getActivityPlansByParticipantGuestId: jest.fn(),
}));

jest.mock('../../src/modules/database/services/DriverService', () => ({
    getDriversListByUserId: jest.fn(),
    getManagedListsForUser: jest.fn(),
    getDriversListByParticipantUserId: jest.fn(),
    getDriversListByParticipantGuestId: jest.fn(),
}));

jest.mock('../../src/modules/database/services/EventService', () => ({
    getEventsByOwnerId: jest.fn(),
    getActiveManagedEventsForUser: jest.fn(),
    getRegisteredEventsFor: jest.fn(),
}));

jest.mock('../../src/modules/database/services/PackingService', () => ({
    getPackingListByUserId: jest.fn(),
    getManagedListsForUser: jest.fn(),
    getPackingListByParticipantUserId: jest.fn(),
    getPackingListByParticipantGuestId: jest.fn(),
}));

jest.mock('../../src/modules/database/services/SurveyService', () => ({
    getSurveysByUserId: jest.fn(),
    getSurveysByParticipantUserId: jest.fn(),
    getSurveysByParticipantGuestId: jest.fn(),
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
import * as activityService from '../../src/modules/database/services/ActivityService';
import * as driverService from '../../src/modules/database/services/DriverService';
import * as eventService from '../../src/modules/database/services/EventService';
import * as packingService from '../../src/modules/database/services/PackingService';
import * as surveyService from '../../src/modules/database/services/SurveyService';

import * as userService from '../../src/modules/database/services/UserService';
import {ExpectedError, ValidationError} from '../../src/modules/lib/errors';
import * as oidc from '../../src/modules/oidc';
import {
    activateAccountData,
    dashboardEntityData,
    loginUserData,
    oidcWrapperData,
    passwordResetData,
    registerUserData,
} from '../data/controller/userData';

beforeEach(() => {
    jest.clearAllMocks();
});

describe('registerUser - Data Driven', () => {
    test.each(registerUserData)('$description', async (testCase) => {
        // Setup mocks
        if (testCase.mockUserExists !== undefined) {
            (userService.getUserByUsername as jest.Mock).mockResolvedValue(
                testCase.mockUserExists ? {id: 1} : null
            );
        }
        if (testCase.mockUserId) {
            (userService.registerUser as jest.Mock).mockResolvedValue(testCase.mockUserId);
        }
        if (testCase.mockToken) {
            (userService.generateActivationToken as jest.Mock).mockResolvedValue(testCase.mockToken);
        }

        // Execute and verify
        if (testCase.shouldThrow) {
            await expect(registerUser(testCase.body as any)).rejects.toBeInstanceOf(
                testCase.errorType === 'ValidationError' ? ValidationError : ExpectedError
            );
        } else {
            await expect(registerUser(testCase.body as any)).resolves.toBeUndefined();

            if (testCase.expectedRegisterCall) {
                expect(userService.registerUser).toHaveBeenCalledWith(...testCase.expectedRegisterCall);
            }
            if (testCase.expectedTokenCall) {
                expect(userService.generateActivationToken).toHaveBeenCalledWith(...testCase.expectedTokenCall);
            }
            if (testCase.expectedEmailCall) {
                expect(sendActivationEmail).toHaveBeenCalledWith(...testCase.expectedEmailCall);
            }
        }
    });
});

describe('loginUser - Data Driven', () => {
    test.each(loginUserData)('$description', async (testCase) => {
        const session: any = {};

        // Setup mocks
        if (testCase.mockUser !== undefined) {
            (userService.getUserByUsername as jest.Mock).mockResolvedValue(testCase.mockUser);
        }
        if (testCase.mockPasswordValid !== undefined) {
            (userService.verifyPassword as jest.Mock).mockResolvedValue(testCase.mockPasswordValid);
        }
        if (testCase.mockToken) {
            (userService.generateActivationToken as jest.Mock).mockResolvedValue(testCase.mockToken);
        }

        // Execute and verify
        if (testCase.shouldThrow) {
            await expect(loginUser(testCase.body as any, session)).rejects.toBeInstanceOf(
                testCase.errorType === 'ValidationError' ? ValidationError : ExpectedError
            );

            if (testCase.expectsTokenGeneration) {
                expect(userService.generateActivationToken).toHaveBeenCalled();
            } else if (testCase.expectsTokenGeneration === false) {
                expect(userService.generateActivationToken).not.toHaveBeenCalled();
            }

            if (testCase.expectsEmail) {
                expect(sendActivationEmail).toHaveBeenCalled();
            } else if (testCase.expectsEmail === false) {
                expect(sendActivationEmail).not.toHaveBeenCalled();
            }
        } else {
            await loginUser(testCase.body as any, session);
            if (testCase.expectedSessionUser) {
                expect(session.user).toEqual(testCase.expectedSessionUser);
            }
        }
    });
});

describe('dashboard entity loaders - Data Driven', () => {
    test.each(dashboardEntityData)('$description', async (testCase) => {
        if (testCase.type === 'user') {
            // Mock all user dashboard services
            (surveyService.getSurveysByUserId as jest.Mock).mockResolvedValue(testCase.mockData.surveys);
            (surveyService.getSurveysByParticipantUserId as jest.Mock).mockResolvedValue(testCase.mockData.partSurveys);
            (packingService.getPackingListByUserId as jest.Mock).mockResolvedValue(testCase.mockData.ownPacklists);
            (packingService.getManagedListsForUser as jest.Mock).mockResolvedValue(testCase.mockData.adminPacklists);
            (packingService.getPackingListByParticipantUserId as jest.Mock).mockResolvedValue(testCase.mockData.partPacklists);
            (activityService.getActivityPlansByUserId as jest.Mock).mockResolvedValue(testCase.mockData.ownActivityplans);
            (activityService.getManagedPlansForUser as jest.Mock).mockResolvedValue(testCase.mockData.adminActivityplans);
            (activityService.getActivityPlansByParticipantUserId as jest.Mock).mockResolvedValue(testCase.mockData.partActivityplans);
            (driverService.getDriversListByUserId as jest.Mock).mockResolvedValue(testCase.mockData.ownDriverslists);
            (driverService.getManagedListsForUser as jest.Mock).mockResolvedValue(testCase.mockData.adminDriverslists);
            (driverService.getDriversListByParticipantUserId as jest.Mock).mockResolvedValue(testCase.mockData.partDriverslists);
            (eventService.getEventsByOwnerId as jest.Mock).mockResolvedValue(testCase.mockData.ownEvents);
            (eventService.getActiveManagedEventsForUser as jest.Mock).mockResolvedValue(testCase.mockData.adminEvents);
            (eventService.getRegisteredEventsFor as jest.Mock).mockResolvedValue(testCase.mockData.registeredEvents);

            const result = await getUserDashboardEntities({id: testCase.userId} as any);
            expect(result).toEqual(testCase.expected);
        } else if (testCase.type === 'guest') {
            (eventService.getRegisteredEventsFor as jest.Mock).mockResolvedValue(testCase.mockData.registeredEvents);
            (surveyService.getSurveysByParticipantGuestId as jest.Mock).mockResolvedValue(testCase.mockData.partSurveys);
            (packingService.getPackingListByParticipantGuestId as jest.Mock).mockResolvedValue(testCase.mockData.partPacklists);
            (activityService.getActivityPlansByParticipantGuestId as jest.Mock).mockResolvedValue(testCase.mockData.partActivityplans);
            (driverService.getDriversListByParticipantGuestId as jest.Mock).mockResolvedValue(testCase.mockData.partDriverslists);

            const result = await getGuestDashboardEntities({id: testCase.userId} as any);
            expect(result).toEqual(testCase.expected);
        }
    });
});

describe('password reset flow - Data Driven', () => {
    test.each(passwordResetData)('$description', async (testCase) => {
        // Setup mocks based on action
        if (testCase.mockUser !== undefined) {
            (userService.getUserByUsername as jest.Mock).mockResolvedValue(testCase.mockUser);
        }
        if (testCase.mockToken) {
            (userService.generatePasswordResetToken as jest.Mock).mockResolvedValue(testCase.mockToken);
        }
        if (testCase.mockVerifyResult !== undefined) {
            (userService.verifyPasswordResetToken as jest.Mock).mockResolvedValue(testCase.mockVerifyResult);
        }

        // Execute based on action
        if (testCase.action === 'sendPasswordForgotMail') {
            await sendPasswordForgotMail(testCase.username!);

            if (testCase.expectsToken) {
                expect(userService.generatePasswordResetToken).toHaveBeenCalled();
            }
            if (testCase.expectsEmail && testCase.expectedEmailCall) {
                expect(sendPasswordResetEmail).toHaveBeenCalledWith(...testCase.expectedEmailCall);
            }
        } else if (testCase.action === 'checkPasswordForgotToken') {
            if (testCase.shouldThrow) {
                await expect(checkPasswordForgotToken(testCase.token!)).rejects.toBeInstanceOf(ExpectedError);
            } else {
                await checkPasswordForgotToken(testCase.token!);
            }
        } else if (testCase.action === 'resetPassword') {
            if (testCase.shouldThrow) {
                await expect(
                    resetPassword(testCase.token!, testCase.body!)
                ).rejects.toBeInstanceOf(
                    testCase.errorType === 'ValidationError' ? ValidationError : ExpectedError
                );
            } else {
                await resetPassword(testCase.token!, testCase.body!);
                if (testCase.expectedResetCall) {
                    expect(userService.resetPassword).toHaveBeenCalledWith(...testCase.expectedResetCall);
                }
            }
        }
    });
});

describe('activateAccount - Data Driven', () => {
    test.each(activateAccountData)('$description', async (testCase) => {
        (userService.verifyActivationToken as jest.Mock).mockResolvedValue(testCase.mockVerifyResult);

        if (testCase.shouldThrow) {
            await expect(activateAccount(testCase.token)).rejects.toBeInstanceOf(ExpectedError);
        } else {
            await activateAccount(testCase.token);
            if (testCase.expectedActivateCall) {
                expect(userService.activateUser).toHaveBeenCalledWith(...testCase.expectedActivateCall);
            }
        }
    });
});

describe('OIDC wrappers - Data Driven', () => {
    test.each(oidcWrapperData)('$description', async (testCase) => {
        const session = testCase.mockRequest as any;

        if (testCase.method === 'loginUserWithOidc') {
            (oidc.startLogin as jest.Mock).mockResolvedValue(testCase.mockReturnValue);
            const res = await loginUserWithOidc(session);
            expect(oidc.startLogin).toHaveBeenCalledWith(session);
            expect(res).toBe(testCase.expectedResult);
        } else if (testCase.method === 'loginUserWithOidcCallback') {
            (oidc.callback as jest.Mock).mockResolvedValue(testCase.mockReturnValue);
            const res = await loginUserWithOidcCallback(session);
            expect(oidc.callback).toHaveBeenCalledWith(session);
            expect(res).toEqual(testCase.expectedResult);
        } else if (testCase.method === 'logoutUserOidc') {
            (oidc.logout as jest.Mock).mockResolvedValue(testCase.mockReturnValue);
            const res = await logoutUserOidc(session);
            expect(oidc.logout).toHaveBeenCalledWith(session);
            expect(res).toBe(testCase.expectedResult);
        }
    });
});
