/**
 * Controller unit tests for surveyController (services mocked).
 * Uses data-driven and keyword-driven testing approach.
 * Focus: validation, orchestration, and error mapping — no DB involved.
 */

jest.mock('../../src/modules/database/services/SurveyService', () => ({
    createSurveyTx: jest.fn(),
    getCombinationsBySurveyId: jest.fn(),
    getResponsesSorted: jest.fn(),
    deleteSurvey: jest.fn(),
    addCombination: jest.fn(),
    deleteResponsesByUserId: jest.fn(),
    deleteResponsesByGuestId: jest.fn(),
    saveResponseUser: jest.fn(),
    saveResponseGuest: jest.fn(),
}));

import controller from '../../src/controller/surveyController';
import * as surveyService from '../../src/modules/database/services/SurveyService';
import { ExpectedError, ValidationError } from '../../src/modules/lib/errors';

// Import test data
import {
    preprocessCreateData,
    preprocessCreateErrorData,
    createEntityData,
    submitResponsesData,
    addCombinationData,
    addCombinationErrorData,
} from '../data/controller/surveyData';

// Import test keywords
import {
    clearAllMocks,
    setupMock,
    verifyMockCall,
    verifyMockNthCall,
    verifyMockNotCalled,
    verifyMockCallCount,
    verifyResult,
    expectSyncToThrowError,
    executeControllerFunction,
    expectToThrowError,
} from '../keywords/common/controllerKeywords';

const {
    preprocessCreate,
    createEntity,
    afterCreateItems,
    fetchForView,
    fetchForDuplicate,
    deleteEntity,
    addCombination,
    submitResponses,
} = controller as any;

beforeEach(() => {
    clearAllMocks();
});

describe('preprocessCreate - Data Driven', () => {
    // Run data-driven tests for valid inputs
    test.each(preprocessCreateData)(
        '$description',
        ({ input, expected }) => {
            const result = preprocessCreate(input);
            verifyResult(result, expected);
        }
    );

    // Run data-driven tests for error cases
    test.each(preprocessCreateErrorData)(
        'throws ValidationError: $description',
        ({ input, errorType }) => {
            expectSyncToThrowError(() => preprocessCreate(input), ValidationError);
        }
    );
});

describe('createEntity - Data Driven', () => {
    test.each(createEntityData)(
        '$description',
        async ({ userId, payload, expectedServiceCall, mockReturnValue }) => {
            // Setup mock
            setupMock(surveyService.createSurveyTx as jest.Mock, mockReturnValue);

            // Execute
            const result = await executeControllerFunction(createEntity, userId, payload);

            // Verify result
            verifyResult(result, mockReturnValue);

            // Verify service was called correctly
            const { userId: expUserId, title, description, combinations } = expectedServiceCall;
            verifyMockCall(
                surveyService.createSurveyTx as jest.Mock,
                expUserId,
                title,
                description,
                combinations
            );
        }
    );
});

describe('afterCreateItems', () => {
    it('is a no-op that resolves', async () => {
        const result = await afterCreateItems();
        expect(result).toBeUndefined();
    });
});

describe('fetchForView', () => {
    it('returns survey, combinations, responses (delegates to service)', async () => {
        const survey = { id: 's1' };
        const combos = [{ id: 1 }];
        const responses = [{ userId: 7 }];

        setupMock(surveyService.getCombinationsBySurveyId as jest.Mock, combos);
        setupMock(surveyService.getResponsesSorted as jest.Mock, responses);

        const result = await fetchForView(survey as any, {} as any);

        verifyMockCall(surveyService.getCombinationsBySurveyId as jest.Mock, 's1');
        verifyMockCall(surveyService.getResponsesSorted as jest.Mock, 's1');
        verifyResult(result, { survey, combinations: combos, responses });
    });
});

describe('fetchForDuplicate', () => {
    it('returns combinations by survey id', async () => {
        const combos = [{ id: 2 }];
        setupMock(surveyService.getCombinationsBySurveyId as jest.Mock, combos);

        const result = await fetchForDuplicate({ id: 's2' } as any, {} as any);

        verifyMockCall(surveyService.getCombinationsBySurveyId as jest.Mock, 's2');
        verifyResult(result, combos);
    });
});

describe('deleteEntity', () => {
    it('delegates to deleteSurvey', async () => {
        await deleteEntity({ id: 's9' } as any, {} as any);
        verifyMockCall(surveyService.deleteSurvey as jest.Mock, 's9');
    });
});

describe('addCombination - Data Driven', () => {
    // Run data-driven tests for valid inputs
    test.each(addCombinationData)(
        '$description',
        async ({ survey, weekday, nth }) => {
            await addCombination(survey as any, weekday, nth);
            verifyMockCall(surveyService.addCombination as jest.Mock, survey.id, weekday, nth);
        }
    );

    // Run data-driven tests for error cases
    test.each(addCombinationErrorData)(
        'throws ExpectedError: $description',
        async ({ survey, weekday, nth }) => {
            await expectToThrowError(
                () => addCombination(survey as any, weekday as any, nth as any),
                ExpectedError
            );
        }
    );
});

describe('submitResponses - Data Driven', () => {
    test.each(submitResponsesData)(
        '$description',
        async ({ survey, session, answers, expected }) => {
            await submitResponses(survey as any, session as any, answers);

            // Verify delete call
            if (expected.deleteCall) {
                if (expected.deleteCall.type === 'user') {
                    verifyMockCall(
                        surveyService.deleteResponsesByUserId as jest.Mock,
                        expected.deleteCall.id,
                        expected.deleteCall.surveyId
                    );
                    verifyMockNotCalled(surveyService.deleteResponsesByGuestId as jest.Mock);
                } else if (expected.deleteCall.type === 'guest') {
                    verifyMockCall(
                        surveyService.deleteResponsesByGuestId as jest.Mock,
                        expected.deleteCall.id,
                        expected.deleteCall.surveyId
                    );
                    verifyMockNotCalled(surveyService.deleteResponsesByUserId as jest.Mock);
                }
            } else {
                verifyMockNotCalled(surveyService.deleteResponsesByUserId as jest.Mock);
                verifyMockNotCalled(surveyService.deleteResponsesByGuestId as jest.Mock);
            }

            // Verify save calls
            if (expected.saveCalls.length > 0) {
                verifyMockCallCount(
                    expected.saveCalls[0].type === 'user'
                        ? (surveyService.saveResponseUser as jest.Mock)
                        : (surveyService.saveResponseGuest as jest.Mock),
                    expected.saveCalls.length
                );

                expected.saveCalls.forEach((saveCall, index) => {
                    if (saveCall.type === 'user') {
                        verifyMockNthCall(
                            surveyService.saveResponseUser as jest.Mock,
                            index + 1,
                            saveCall.surveyId,
                            saveCall.userId,
                            saveCall.combinationId,
                            saveCall.response
                        );
                    } else if (saveCall.type === 'guest') {
                        verifyMockNthCall(
                            surveyService.saveResponseGuest as jest.Mock,
                            index + 1,
                            saveCall.surveyId,
                            saveCall.guestId,
                            saveCall.combinationId,
                            saveCall.response
                        );
                    }
                });
            } else {
                verifyMockNotCalled(surveyService.saveResponseUser as jest.Mock);
                verifyMockNotCalled(surveyService.saveResponseGuest as jest.Mock);
            }
        }
    );
});
