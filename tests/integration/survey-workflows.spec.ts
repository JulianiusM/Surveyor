import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {Request} from 'express';
import activityController from '../../src/controller/activityController';
import driversController from '../../src/controller/driversController';
import * as entityAdminController from '../../src/controller/entityAdminController';
import eventPoolController from '../../src/controller/eventPoolController';
import * as helpController from '../../src/controller/helpController';
import eventController from '../../src/controller/eventController';
import packingController from '../../src/controller/packingController';
import surveyController from '../../src/controller/surveyController';
import * as userController from '../../src/controller/userController';
import {Profile} from '../../src/modules/database/entities/user/Profile';
import {PERM} from '../../src/modules/lib/permissions';
import * as activityService from '../../src/modules/database/services/ActivityService';
import * as driverService from '../../src/modules/database/services/DriverService';
import * as adminService from '../../src/modules/database/services/EntityAdminService';
import * as eventService from '../../src/modules/database/services/EventService';
import * as invoiceService from '../../src/modules/database/services/EventInvoiceService';
import * as packingService from '../../src/modules/database/services/PackingService';
import * as surveyService from '../../src/modules/database/services/SurveyService';
import * as userService from '../../src/modules/database/services/UserService';
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
    });

    it('rejects a survey without a participant-visible date choice', async () => {
        expect(() => surveyController.preprocessCreate({
            title: 'Camp date survey', description: 'Choose dates', combinations: [],
        })).toThrow('combinations');
    });

    it('orders persisted choices predictably', async () => {
        const [, combinations] = await createSurveyWithCombinations(owner.id);

        expect(combinations.map((combination) => combination.weekday)).toEqual(['MON', 'FRI']);
    });

    it('stores a yes response from a participant', async () => {
        const [surveyId, combinations] = await createSurveyWithCombinations(owner.id);

        const answer = 'yes';
        await submitSurveyResponses(surveyId, participant, {[combinations[0].id]: answer});
        expect(await surveyService.getResponsesByProfileId(participant.id)).toContainEqual(expect.objectContaining({entityId: surveyId, answer}));
    });

    it('stores a maybe response from a participant', async () => {
        const [surveyId, combinations] = await createSurveyWithCombinations(owner.id);

        const answer = 'maybe';
        await submitSurveyResponses(surveyId, participant, {[combinations[0].id]: answer});
        expect(await surveyService.getResponsesByProfileId(participant.id)).toContainEqual(expect.objectContaining({entityId: surveyId, answer}));
    });

    it('defaults an empty submitted answer to no', async () => {
        const [surveyId, combinations] = await createSurveyWithCombinations(owner.id);

        await submitSurveyResponses(surveyId, participant, {[combinations[0].id]: '' as never});
        expect(await surveyService.getResponsesByProfileId(participant.id)).toContainEqual(expect.objectContaining({entityId: surveyId, answer: 'no'}));
    });

    it('stores answers from multiple participants', async () => {
        const [surveyId, combinations] = await createSurveyWithCombinations(owner.id);

        await submitSurveyResponses(surveyId, participant, {[combinations[0].id]: 'yes'});
        await submitSurveyResponses(surveyId, secondParticipant, {[combinations[1].id]: 'maybe'});
        expect(Object.keys(await surveyService.getResponsesSorted(surveyId))).toEqual(expect.arrayContaining([participant.id, secondParticipant.id]));
    });

    it('groups results by participant with names and choices', async () => {
        const [surveyId, combinations] = await createSurveyWithCombinations(owner.id);

        await submitSurveyResponses(surveyId, participant, {[combinations[0].id]: 'yes'});
        expect(await surveyService.getResponsesSorted(surveyId)).toEqual({
            [participant.id]: [expect.objectContaining({name: participant.name, combinationId: combinations[0].id, answer: 'yes'})],
        });
    });

    it('lists surveys answered by a participant', async () => {
        const [surveyId, combinations] = await createSurveyWithCombinations(owner.id);

        await submitSurveyResponses(surveyId, participant, {[combinations[0].id]: 'yes'});
        expect((await surveyService.getSurveysByParticipant(participant.id)).map((survey) => survey.id)).toContain(surveyId);
    });

    it('replaces a submitted ballot without stale answers', async () => {
        const [surveyId, combinations] = await createSurveyWithCombinations(owner.id);

        await submitSurveyResponses(surveyId, participant, {[combinations[0].id]: 'yes'});
        await surveyService.deleteResponsesByProfileId(participant.id, surveyId);
        await submitSurveyResponses(surveyId, participant, {[combinations[1].id]: 'maybe'});
        expect((await surveyService.getResponsesSorted(surveyId))[participant.id]).toMatchObject([{combinationId: combinations[1].id, answer: 'maybe'}]);
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

    it('deletes all responses for one participant', async () => {
        const [surveyId, combinations] = await createSurveyWithCombinations(owner.id);

        await submitSurveyResponses(surveyId, participant, {[combinations[0].id]: 'yes'});
        await submitSurveyResponses(surveyId, participant, {[combinations[1].id]: 'maybe'});
        await surveyService.deleteResponsesByProfileId(participant.id, surveyId);
        expect(await surveyService.getResponsesSorted(surveyId)).toEqual({});
    });

    it('deletes a survey from the owner dashboard', async () => {
        const [surveyId] = await createSurveyWithCombinations(owner.id);

        const survey = await surveyService.getSurveyById(surveyId);
        await surveyController.deleteEntity(survey!, {} as never);
        expect((await surveyService.getSurveysByProfileId(owner.id)).map((survey) => survey.id)).not.toContain(surveyId);
    });

});
