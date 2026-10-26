import * as controller from '../controller/surveyController';
import * as service from '../modules/database/services/SurveyService';
import type {Survey} from '../modules/database/entities/surveys/Survey';
import {createGuestFlow, guestFlowResponse} from '../middleware/guestFlowFactory';

/** Survey keeps its standalone ownership/participation model outside general permissions. */
export const surveyFlow = createGuestFlow<'survey', Survey>({
    entityType: 'survey', parameter: 'surveyId', apiPath: '/api/v1/surveys',
    loadRoot: service.getSurveyById,
    async withRoot(id, operation) { return operation(await service.getSurveyById(id)); },
    async pageAdmission(_root, actor) { return actor.profile ? 'render' : 'guest'; },
    detailAddress: 'requested', guestAddress: 'stored',
    profiles: {duplicate: true, header: true},
    formContext() { return {}; },
    requireCreation: controller.requireSurveyCreation,
    create: controller.createSurvey,
    creation: {imageOwnership: 'success', receipt: 'after-success', location: true},
    duplicate: controller.readSurveyDuplicate,
    detail: controller.readSurvey,
    header: controller.readSurveyHeaderPath,
    remove: controller.deleteSurvey,
    deletion: {profile: true, receipt: 'controller'},
    operations: {
        createEntry: guestFlowResponse('getSurveyCreateEntry', 200),
        resourceEntry: guestFlowResponse('getSurveyResourceEntry', 200),
        create: guestFlowResponse('createSurvey', 201),
        duplicate: guestFlowResponse('getSurveyDuplicate', 200),
        detail: guestFlowResponse('getSurvey', 200),
        remove: guestFlowResponse('deleteSurvey', 200),
        guest: guestFlowResponse('getSurveyGuestEntry', 200),
        registerGuest: 'registerSurveyGuest', header: 'getSurveyHeader',
    },
    document: {
        preload: false, admin: false, duplicatePageEntry: true,
        seedCreate(state, result) { state.surveyCreateContext = result.context ?? undefined; },
        seedDuplicate(state, result) { state.surveyDuplicate = result; },
    },
});
