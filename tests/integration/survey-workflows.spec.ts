import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {Request} from 'express';
import * as activityController from '../../src/backend/controller/activityController';
import * as driversController from '../../src/backend/controller/driversController';
import * as entityAdminController from '../../src/backend/controller/entityAdminController';
import * as eventPoolController from '../../src/backend/controller/eventPoolController';
import * as helpController from '../../src/backend/controller/helpController';
import * as eventController from '../../src/backend/controller/eventController';
import * as packingController from '../../src/backend/controller/packingController';
import * as surveyController from '../../src/backend/controller/surveyController';
import {submitResponses} from '../../src/backend/modules/survey';
import * as userController from '../../src/backend/controller/userController';
import {Profile} from '../../src/backend/modules/database/entities/user/Profile';
import {PERM} from '../../src/backend/modules/lib/permissions';
import * as activityService from '../../src/backend/modules/database/services/ActivityService';
import * as driverService from '../../src/backend/modules/database/services/DriverService';
import * as adminService from '../../src/backend/modules/database/services/EntityAdminService';
import * as eventService from '../../src/backend/modules/database/services/EventService';
import * as invoiceService from '../../src/backend/modules/database/services/EventInvoiceService';
import * as packingService from '../../src/backend/modules/database/services/PackingService';
import * as surveyService from '../../src/backend/modules/database/services/SurveyService';
import * as userService from '../../src/backend/modules/database/services/UserService';
import {
    createActivitySlotEntity,
    createDriversItemEntity,
    createPackingItemEntity,
} from '../factories/integrationEntityFactory';
import {
    assignActivitySlot,
    assignDriversItem,
    assignPackingItem,
    createActivityPlanWithSlot,
    createDriversListWithItem,
    createIntegrationEvent,
    createPackingListWithItem,
    createSurveyWithCombinations,
    persistIntegrationProfile,
    registerEventAttendance,
    registerLocalAccount,
    submitSurveyResponses,
    unassignDriversItem,
    unassignPackingItem,
} from '../keywords/coreDomainKeywords';
import {closeIntegrationDatabase, initializeIntegrationDatabase} from '../support/database';

let owner: Profile;
let participant: Profile;
let secondParticipant: Profile;

beforeAll(async () => {
    await initializeIntegrationDatabase();
    owner = await persistIntegrationProfile();
    participant = await persistIntegrationProfile();
    secondParticipant = await persistIntegrationProfile();
});

afterAll(async () => {
    await closeIntegrationDatabase();
});

describe('survey user stories', () => {
    it('creates a survey and all date choices transactionally', async () => {
        const [surveyId, combinations] = await createSurveyWithCombinations(owner.id);

        expect(await surveyService.getSurveyById(surveyId)).toMatchObject({title: 'Camp date survey', ownerId: owner.id});
        expect(combinations).toHaveLength(2);
        expect(combinations).toMatchObject([
            {weekday: 'MON', nthWeek: '1'},
            {weekday: 'FRI', nthWeek: 'LAST'},
        ]);
    });

    it('rejects a survey without a participant-visible date choice', async () => {
        expect(() => surveyController.preprocessCreate({
            title: 'Camp date survey', description: 'Choose dates', combinations: [],
        })).toThrow('combinations');
    });

    it('stores yes and maybe responses for their respective persisted choices', async () => {
        const [surveyId, combinations] = await createSurveyWithCombinations(owner.id);

        await submitSurveyResponses(surveyId, participant, {
            [combinations[0].id]: 'yes', [combinations[1].id]: 'maybe',
        });
        expect(await surveyService.getResponsesByProfileId(participant.id)).toEqual(expect.arrayContaining([
            expect.objectContaining({entityId: surveyId, itemId: combinations[0].id, answer: 'yes'}),
            expect.objectContaining({entityId: surveyId, itemId: combinations[1].id, answer: 'maybe'}),
        ]));
    });

    it('rejects a date choice taken from another survey', async () => {
        const [surveyId] = await createSurveyWithCombinations(owner.id);
        const [, otherCombinations] = await createSurveyWithCombinations(owner.id);
        const survey = await surveyService.getSurveyById(surveyId);

        await expect(submitResponses(
            survey!,
            {profile: participant} as Request['session'],
            {[otherCombinations[0].id]: 'yes'},
        )).rejects.toMatchObject({status: 400});
        expect(await surveyService.getResponsesSorted(surveyId)).toEqual({});
    });

    it('defaults an empty submitted answer to no', async () => {
        const [surveyId, combinations] = await createSurveyWithCombinations(owner.id);

        await submitSurveyResponses(surveyId, participant, {[combinations[0].id]: '' as never});
        expect(await surveyService.getResponsesByProfileId(participant.id)).toContainEqual(expect.objectContaining({entityId: surveyId, answer: 'no'}));
    });

    it('groups multiple participant results with their names, choices, and answers', async () => {
        const [surveyId, combinations] = await createSurveyWithCombinations(owner.id);

        await submitSurveyResponses(surveyId, participant, {[combinations[0].id]: 'yes'});
        await submitSurveyResponses(surveyId, secondParticipant, {[combinations[1].id]: 'maybe'});
        expect(await surveyService.getResponsesSorted(surveyId)).toEqual({
            [participant.id]: [expect.objectContaining({profileId: participant.id, name: participant.name, combinationId: combinations[0].id, answer: 'yes'})],
            [secondParticipant.id]: [expect.objectContaining({profileId: secondParticipant.id, name: secondParticipant.name, combinationId: combinations[1].id, answer: 'maybe'})],
        });
    });

    it('lists surveys answered by a participant', async () => {
        const [surveyId, combinations] = await createSurveyWithCombinations(owner.id);

        await submitSurveyResponses(surveyId, participant, {[combinations[0].id]: 'yes'});
        expect((await surveyService.getSurveysByParticipant(participant.id)).map((survey) => survey.id)).toContain(surveyId);
    });

    it('replaces a submitted ballot without stale answers and deletes the remaining ballot', async () => {
        const [surveyId, combinations] = await createSurveyWithCombinations(owner.id);

        // A complete first ballot ensures replacement removes an omitted choice,
        // rather than merely overwriting one answer. Deletion then clears the result.
        await submitSurveyResponses(surveyId, participant, {
            [combinations[0].id]: 'yes', [combinations[1].id]: 'yes',
        });
        await submitSurveyResponses(surveyId, participant, {[combinations[1].id]: 'maybe'});
        expect((await surveyService.getResponsesSorted(surveyId))[participant.id]).toMatchObject([{combinationId: combinations[1].id, answer: 'maybe'}]);
        await surveyService.deleteResponsesByProfileId(participant.id, surveyId);
        expect(await surveyService.getResponsesSorted(surveyId)).toEqual({});
    });

    it('keeps one participant ballot isolated from another', async () => {
        const [surveyId, combinations] = await createSurveyWithCombinations(owner.id);

        await submitSurveyResponses(surveyId, participant, {[combinations[0].id]: 'yes'});
        await submitSurveyResponses(surveyId, secondParticipant, {[combinations[1].id]: 'no'});
        await surveyService.deleteResponsesByProfileId(participant.id, surveyId);
        expect(await surveyService.getResponsesSorted(surveyId)).toEqual({
            [secondParticipant.id]: [expect.objectContaining({answer: 'no'})],
        });
    });

    it('lists only surveys owned by the requested profile', async () => {
        const [surveyId] = await createSurveyWithCombinations(owner.id);

        expect((await surveyService.getSurveysByProfileId(owner.id)).map((survey) => survey.id)).toContain(surveyId);
        expect((await surveyService.getSurveysByProfileId(participant.id)).map((survey) => survey.id)).not.toContain(surveyId);
    });

    it('updates and clears a survey header image', async () => {
        const [surveyId] = await createSurveyWithCombinations(owner.id);

        await surveyService.updateHeaderImage(surveyId, 'survey.jpg');
        expect(await surveyService.getSurveyById(surveyId)).toMatchObject({headerImg: 'survey.jpg'});
        await surveyService.updateHeaderImage(surveyId, null);
        expect(await surveyService.getSurveyById(surveyId)).toMatchObject({headerImg: null});
    });

    it('deletes a survey from the owner dashboard', async () => {
        const [surveyId] = await createSurveyWithCombinations(owner.id);

        const survey = await surveyService.getSurveyById(surveyId);
        await surveyController.deleteEntity(survey!);
        expect((await surveyService.getSurveysByProfileId(owner.id)).map((survey) => survey.id)).not.toContain(surveyId);
    });

});
