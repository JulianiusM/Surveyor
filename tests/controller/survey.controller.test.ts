/**
 * Controller unit tests for surveyController (services mocked).
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
import {ExpectedError, ValidationError} from '../../src/modules/lib/errors';

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
    jest.clearAllMocks();
});

describe('preprocessCreate', () => {
    it('normalizes combos (array) and trims strings; description "" -> null', () => {
        const body = {
            title: '  My Survey  ',
            description: '',
            combinations: [
                {weekday: 'MON', week: 1},
                {weekday: 'FRI', week: 'LAST'},
            ],
        };

        const out = preprocessCreate(body);

        expect(out).toEqual({
            title: 'My Survey',
            description: null,
            combinations: [
                {weekday: 'MON', nthWeek: '1'},
                {weekday: 'FRI', nthWeek: 'LAST'},
            ],
        });
    });

    it('accepts combos object with numeric keys (qs-style) and validates', () => {
        const body = {
            title: 'Weekly',
            description: '  desc ',
            combinations: {
                0: {weekday: 'WED', week: 3},
                1: {weekday: 'SUN', week: 'LAST'},
            },
        };

        const out = preprocessCreate(body);
        expect(out.title).toBe('Weekly');
        expect(out.description).toBe('desc');
        expect(out.combinations).toEqual([
            {weekday: 'WED', nthWeek: '3'},
            {weekday: 'SUN', nthWeek: 'LAST'},
        ]);
    });

    it('throws ValidationError when missing title, empty combos or invalid values', () => {
        // missing title
        expect(() =>
            preprocessCreate({description: '', combinations: [{weekday: 'MON', week: 1}]})
        ).toThrow(ValidationError);

        // empty combos
        expect(() =>
            preprocessCreate({title: 'X', description: '', combinations: []})
        ).toThrow(ValidationError);

        // invalid weekday
        expect(() =>
            preprocessCreate({title: 'X', description: '', combinations: [{weekday: 'XXX', week: 1}]})
        ).toThrow(ValidationError);

        // invalid week
        expect(() =>
            preprocessCreate({title: 'X', description: '', combinations: [{weekday: 'MON', week: 9}]})
        ).toThrow(ValidationError);
    });
});

describe('createEntity', () => {
    it('maps payload to createSurveyTx (uses combinations[].week)', async () => {
        (surveyService.createSurveyTx as jest.Mock).mockResolvedValue('survey-123');

        const payload = {
            title: 'T',
            description: 'D',
            combinations: [
                {weekday: 'MON', nthWeek: '1'},
                {weekday: 'FRI', nthWeek: 'LAST'},
            ],
        };

        const id = await createEntity(42, payload);

        expect(id).toBe('survey-123');
        expect(surveyService.createSurveyTx).toHaveBeenCalledWith(42, 'T', 'D', [
            {weekday: 'MON', week: '1'},
            {weekday: 'FRI', week: 'LAST'},
        ]);
    });
});

describe('afterCreateItems', () => {
    it('is a no-op that resolves', async () => {
        await expect(afterCreateItems()).resolves.toBeUndefined();
    });
});

describe('fetchForView', () => {
    it('returns survey, combinations, responses (delegates to service)', async () => {
        const survey = {id: 's1'};
        const combos = [{id: 1}];
        const responses = [{userId: 7}];

        (surveyService.getCombinationsBySurveyId as jest.Mock).mockResolvedValue(combos);
        (surveyService.getResponsesSorted as jest.Mock).mockResolvedValue(responses);

        const out = await fetchForView(survey as any, {} as any);

        expect(surveyService.getCombinationsBySurveyId).toHaveBeenCalledWith('s1');
        expect(surveyService.getResponsesSorted).toHaveBeenCalledWith('s1');
        expect(out).toEqual({survey, combinations: combos, responses});
    });
});

describe('fetchForDuplicate', () => {
    it('returns combinations by survey id', async () => {
        (surveyService.getCombinationsBySurveyId as jest.Mock).mockResolvedValue([{id: 2}]);

        const out = await fetchForDuplicate({id: 's2'} as any, {} as any);
        expect(surveyService.getCombinationsBySurveyId).toHaveBeenCalledWith('s2');
        expect(out).toEqual([{id: 2}]);
    });
});

describe('deleteEntity', () => {
    it('delegates to deleteSurvey', async () => {
        await deleteEntity({id: 's9'} as any, {} as any);
        expect(surveyService.deleteSurvey).toHaveBeenCalledWith('s9');
    });
});

describe('addCombination', () => {
    it('throws ExpectedError when weekday or nth is missing', async () => {
        await expect(addCombination({id: 's1'} as any, undefined as any, 2 as any))
            .rejects.toBeInstanceOf(ExpectedError);

        await expect(addCombination({id: 's1'} as any, 'MON' as any, undefined as any))
            .rejects.toBeInstanceOf(ExpectedError);
    });

    it('calls service when both provided', async () => {
        await addCombination({id: 's1'} as any, 'MON', 2);
        expect(surveyService.addCombination).toHaveBeenCalledWith('s1', 'MON', 2);
    });
});

describe('submitResponses', () => {
    const answers = {'10': 'YES', '11': 'NO'};

    it('handles USER session: deletes then saves per combination', async () => {
        const survey = {id: 's1'};
        const session = {user: {id: 7}};

        await submitResponses(survey as any, session as any, answers);

        expect(surveyService.deleteResponsesByUserId).toHaveBeenCalledWith(7, 's1');
        expect(surveyService.saveResponseUser).toHaveBeenCalledTimes(2);
        expect(surveyService.saveResponseUser).toHaveBeenNthCalledWith(1, 's1', 7, 10, 'YES');
        expect(surveyService.saveResponseUser).toHaveBeenNthCalledWith(2, 's1', 7, 11, 'NO');
        expect(surveyService.saveResponseGuest).not.toHaveBeenCalled();
    });

    it('handles GUEST session: deletes then saves per combination', async () => {
        const survey = {id: 's1'};
        const session = {guest: {id: 9}};

        await submitResponses(survey as any, session as any, answers);

        expect(surveyService.deleteResponsesByGuestId).toHaveBeenCalledWith(9, 's1');
        expect(surveyService.saveResponseGuest).toHaveBeenCalledTimes(2);
        expect(surveyService.saveResponseGuest).toHaveBeenNthCalledWith(1, 's1', 9, 10, 'YES');
        expect(surveyService.saveResponseGuest).toHaveBeenNthCalledWith(2, 's1', 9, 11, 'NO');
        expect(surveyService.saveResponseUser).not.toHaveBeenCalled();
    });

    it('no-op when session has neither user nor guest', async () => {
        await submitResponses({id: 's1'} as any, {} as any, answers);
        expect(surveyService.deleteResponsesByUserId).not.toHaveBeenCalled();
        expect(surveyService.deleteResponsesByGuestId).not.toHaveBeenCalled();
        expect(surveyService.saveResponseUser).not.toHaveBeenCalled();
        expect(surveyService.saveResponseGuest).not.toHaveBeenCalled();
    });
});
