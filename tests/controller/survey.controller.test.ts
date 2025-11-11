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
    afterCreateItemsData,
    fetchForViewData,
    fetchForDuplicateData,
    deleteEntityData,
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
    test.each(afterCreateItemsData)('$description', async ({ expected }) => {
        const result = await afterCreateItems();
        expect(result).toBe(expected);
    });
});

describe('fetchForView - Data Driven', () => {
    test.each(fetchForViewData)(
        '$description',
        async ({ survey, mockCombos, mockResponses, expected }) => {
            setupMock(surveyService.getCombinationsBySurveyId as jest.Mock, mockCombos);
            setupMock(surveyService.getResponsesSorted as jest.Mock, mockResponses);

            const result = await fetchForView(survey as any, {} as any);

            verifyMockCall(surveyService.getCombinationsBySurveyId as jest.Mock, survey.id);
            verifyMockCall(surveyService.getResponsesSorted as jest.Mock, survey.id);
            verifyResult(result, expected);
        }
    );
});

describe('fetchForDuplicate - Data Driven', () => {
    test.each(fetchForDuplicateData)(
        '$description',
        async ({ survey, mockCombos, expectedSurveyId }) => {
            setupMock(surveyService.getCombinationsBySurveyId as jest.Mock, mockCombos);

            const result = await fetchForDuplicate(survey as any, {} as any);

            verifyMockCall(surveyService.getCombinationsBySurveyId as jest.Mock, expectedSurveyId);
            verifyResult(result, mockCombos);
        }
    );
});

describe('deleteEntity - Data Driven', () => {
    test.each(deleteEntityData)(
        '$description',
        async ({ survey, expectedSurveyId }) => {
            await deleteEntity(survey as any, {} as any);
            verifyMockCall(surveyService.deleteSurvey as jest.Mock, expectedSurveyId);
        }
    );
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
