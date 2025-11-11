/**
 * Tests for src/middleware/permissionMiddleware.ts
 * Uses data-driven and keyword-driven testing approach
 */

import {
    isAuthenticated,
    isEventPermitted,
    isEventPermittedAPI,
    requireAddRight,
    requireEventParticipant,
    requireManageRight,
    requireOwner,
    requireOwnerAPI,
} from '../../src/middleware/permissionMiddleware';

import { isRegisteredForEvent } from '../../src/modules/database/services/EventService';

jest.mock('../../src/modules/database/services/EventService', () => ({
    isRegisteredForEvent: jest.fn(),
}));

// Import test data
import {
    requireOwnerSuccessData,
    requireOwnerFailureData,
    requireOwnerAPIFailureData,
    requireEventParticipantSuccessData,
    requireEventParticipantFailureData,
    requireEventParticipantBypassData,
    requireManageRightSuccessData,
    requireAddRightSuccessData,
    requireRightsFailureData,
    isEventPermittedFalseData,
    isEventPermittedAPIFalseData,
    isEventPermittedTrueData,
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

describe('requireManageRight - Data Driven', () => {
    describe('success scenarios', () => {
        test.each(requireManageRightSuccessData)(
            '$description',
            async ({ session, resource }) => {
                await expectMiddlewareSuccess(requireManageRight(), session, resource);
            }
        );
    });

    describe('failure scenarios', () => {
        test.each(requireRightsFailureData)(
            '$description',
            async ({ session, resource, expectedStatus, expectedErrorType }) => {
                (isRegisteredForEvent as jest.Mock).mockResolvedValue(false);
                await expectMiddlewareFailure(
                    requireManageRight(),
                    session,
                    resource,
                    expectedStatus,
                    expectedErrorType
                );
            }
        );
    });
});

describe('requireAddRight - Data Driven', () => {
    describe('success scenarios', () => {
        test.each(requireAddRightSuccessData)(
            '$description',
            async ({ session, resource }) => {
                await expectMiddlewareSuccess(requireAddRight(), session, resource);
            }
        );
    });

    describe('failure scenarios with no identification', () => {
        test.each(requireRightsFailureData)(
            '$description',
            async ({ session, resource, expectedStatus, expectedErrorType }) => {
                (isRegisteredForEvent as jest.Mock).mockResolvedValue(false);
                await expectMiddlewareFailure(
                    requireAddRight(),
                    session,
                    resource,
                    expectedStatus,
                    expectedErrorType
                );
            }
        );
    });
});

describe('isEventPermitted (useEvent toggle) - Data Driven', () => {
    describe('useEvent=false scenarios', () => {
        test.each(isEventPermittedFalseData)(
            '$description',
            async ({ session, resource, query, expectedStatus, expectedErrorType }) => {
                const app = buildMiddlewareApp(isEventPermitted(false), { session, resource });
                const response = await makeGetRequest(app, '/ok', query);
                verifyMiddlewareBlocks(response, expectedStatus, expectedErrorType);
            }
        );
    });

    describe('useEvent=false with API error', () => {
        test.each(isEventPermittedAPIFalseData)(
            '$description',
            async ({ session, resource, query, expectedStatus, expectedErrorType }) => {
                const app = buildMiddlewareApp(isEventPermittedAPI(false), { session, resource });
                const response = await makeGetRequest(app, '/ok', query);
                verifyMiddlewareBlocks(response, expectedStatus, expectedErrorType);
            }
        );
    });

    describe('useEvent=true scenarios', () => {
        test.each(isEventPermittedTrueData)(
            '$description',
            async ({ session, resource, query }) => {
                const app = buildMiddlewareApp(isEventPermitted(true), { session, resource });
                const response = await makeGetRequest(app, '/ok', query);
                verifyMiddlewareAllows(response);
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
