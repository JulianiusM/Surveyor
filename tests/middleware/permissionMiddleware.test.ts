/**
 * Tests for src/middleware/permissionMiddleware.ts
 * Uses data-driven and keyword-driven testing approach
 */

import {
    isAuthenticated,
    requireEventParticipant,
    requireOwner,
    requireOwnerAPI,
    requirePermission,
    requirePermissionApi,
} from '../../src/middleware/permissionMiddleware';

import { isRegisteredForEvent } from '../../src/modules/database/services/EventService';
import { can } from '../../src/modules/permissionEngine';

jest.mock('../../src/modules/database/services/EventService', () => ({
    isRegisteredForEvent: jest.fn(),
}));

jest.mock('../../src/modules/permissionEngine', () => ({
    can: jest.fn(),
}));

// Import test data
import {
    requireOwnerSuccessData,
    requireOwnerFailureData,
    requireOwnerAPIFailureData,
    requireEventParticipantSuccessData,
    requireEventParticipantFailureData,
    requireEventParticipantBypassData,
    requirePermissionSuccessData,
    requirePermissionFailureData,
    requirePermissionApiFailureData,
    isAuthenticatedData,
} from '../data/middleware/permissionData';

// Import test keywords
import {
    expectMiddlewareSuccess,
    expectMiddlewareFailure,
    buildMiddlewareApp,
    makeGetRequest,
    verifyMiddlewareAllows,
    verifyMiddlewareBlocks,
    createMockRequest,
    createMockResponse,
    createMockNext,
    executeMiddleware,
    verifyNextCalled,
    verifyNextNotCalled,
    verifyRedirect,
    verifyFlash,
} from '../keywords/middleware/middlewareKeywords';

beforeEach(() => {
    jest.clearAllMocks();
});

describe('requireOwner / requireOwnerAPI - Data Driven', () => {
    describe('success scenarios', () => {
        test.each(requireOwnerSuccessData)(
            '$description',
            async ({ session, resource, additional }) => {
                await expectMiddlewareSuccess(requireOwner(), session, resource, additional);
            }
        );
    });

    describe('failure scenarios (ExpectedError)', () => {
        test.each(requireOwnerFailureData)(
            '$description',
            async ({ session, resource, additional, expectedStatus, expectedErrorType }) => {
                await expectMiddlewareFailure(
                    requireOwner(),
                    session,
                    resource,
                    expectedStatus,
                    expectedErrorType,
                    additional
                );
            }
        );
    });

    describe('failure scenarios (APIError)', () => {
        test.each(requireOwnerAPIFailureData)(
            '$description',
            async ({ session, resource, additional, expectedStatus, expectedErrorType }) => {
                await expectMiddlewareFailure(
                    requireOwnerAPI(),
                    session,
                    resource,
                    expectedStatus,
                    expectedErrorType,
                    additional
                );
            }
        );
    });
});

describe('requireEventParticipant - Data Driven', () => {
    describe('success scenarios', () => {
        test.each(requireEventParticipantSuccessData)(
            '$description',
            async ({ session, resource, isRegistered }) => {
                (isRegisteredForEvent as jest.Mock).mockResolvedValue(isRegistered);
                await expectMiddlewareSuccess(requireEventParticipant(), session, resource);
                
                if (resource.eventId && !resource.ownerId) {
                    expect(isRegisteredForEvent).toHaveBeenCalled();
                }
            }
        );
    });

    describe('failure scenarios', () => {
        test.each(requireEventParticipantFailureData)(
            '$description',
            async ({ session, resource, isRegistered, expectedStatus, expectedErrorType }) => {
                (isRegisteredForEvent as jest.Mock).mockResolvedValue(isRegistered);
                await expectMiddlewareFailure(
                    requireEventParticipant(),
                    session,
                    resource,
                    expectedStatus,
                    expectedErrorType
                );
            }
        );
    });

    describe('bypass scenarios', () => {
        test.each(requireEventParticipantBypassData)(
            '$description',
            async ({ session, resource }) => {
                (isRegisteredForEvent as jest.Mock).mockClear();
                await expectMiddlewareSuccess(requireEventParticipant(), session, resource);
                expect(isRegisteredForEvent).not.toHaveBeenCalled();
            }
        );
    });
});

// Tests for requireManageRight, requireAddRight, isEventPermitted, and isEventPermittedAPI 
// removed as these functions were removed in the permission system rework

describe('requirePermission - Data Driven', () => {
    describe('success scenarios', () => {
        test.each(requirePermissionSuccessData)(
            '$description',
            async ({ session, entityDescriptor, requiredPerm, userPerms, guestPerms }) => {
                // Mock the can function to return true for success scenarios
                (can as jest.Mock).mockResolvedValue(true);

                const getEntity = () => entityDescriptor;
                const middleware = requirePermission(getEntity, requiredPerm);
                
                await expectMiddlewareSuccess(middleware, session, {});
                
                expect(can).toHaveBeenCalled();
            }
        );
    });

    describe('failure scenarios (ExpectedError)', () => {
        test.each(requirePermissionFailureData)(
            '$description',
            async ({ session, entityDescriptor, requiredPerm, userPerms, guestPerms, expectedStatus, expectedErrorType }) => {
                // Mock the can function to return false for failure scenarios
                (can as jest.Mock).mockResolvedValue(false);

                const getEntity = () => entityDescriptor;
                const middleware = requirePermission(getEntity, requiredPerm);
                
                await expectMiddlewareFailure(
                    middleware,
                    session,
                    {},
                    expectedStatus,
                    expectedErrorType
                );
                
                expect(can).toHaveBeenCalled();
            }
        );
    });

    describe('API error scenarios', () => {
        test.each(requirePermissionApiFailureData)(
            '$description',
            async ({ session, entityDescriptor, requiredPerm, userPerms, expectedStatus, expectedErrorType }) => {
                // Mock the can function to return false for failure scenarios
                (can as jest.Mock).mockResolvedValue(false);

                const getEntity = () => entityDescriptor;
                const middleware = requirePermissionApi(getEntity, requiredPerm);
                
                await expectMiddlewareFailure(
                    middleware,
                    session,
                    {},
                    expectedStatus,
                    expectedErrorType
                );
                
                expect(can).toHaveBeenCalled();
            }
        );
    });
});

describe('isAuthenticated - Data Driven', () => {
    test.each(isAuthenticatedData)(
        '$description',
        ({ session, shouldPass, expectedRedirect, expectedFlashMessage }) => {
            const req = createMockRequest({ session });
            const res = createMockResponse();
            const next = createMockNext();

            executeMiddleware(isAuthenticated, req, res, next);

            if (shouldPass) {
                verifyNextCalled(next);
                expect(res.redirect).not.toHaveBeenCalled();
            } else {
                verifyNextNotCalled(next);
                verifyRedirect(res, expectedRedirect!);
                verifyFlash(req, 'info', expectedFlashMessage!);
            }
        }
    );
});
