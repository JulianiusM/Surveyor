/*
 * Copyright 2026 Julian Malovanij
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy at http://www.apache.org/licenses/LICENSE-2.0
 */

import {Router} from 'express';
import * as surveyApi from '../../../controller/surveyController';
import {createGuestFlowApiRouter, createGuestFlowGuestRouter} from '../../../middleware/guestFlowFactory';
import {surveyFlow} from '../../surveyFlow';
import type {components} from '../../../../types/api/v1';
import {requireApiContext} from '../../../modules/api/session';
import {executePreparedJson, prepareValidatedJson, sendPreparedJson, sendValidatedJson, validateOperationRequest} from '../../../modules/api/transport';
import {asyncHandler} from '../../../modules/lib/asyncHandler';
import {createEntityHeaderUpdateRouter} from '../../../middleware/entityHeaderUpdateHandler';
import {createEntityArchiveApiRouter, createEntityPropertyApiRouter} from '../../../middleware/adminApiFactory';

const router = Router();
router.use(createGuestFlowApiRouter(surveyFlow));

router.get('/:surveyId/settings', asyncHandler(async function getSurveySettings(req, res) {
    const actor = await requireApiContext(req, res, true);
    validateOperationRequest(req, 'getSurveySettings');
    sendValidatedJson(req, res, 'getSurveySettings', 200, await surveyApi.readSurveySettings(String(req.params.surveyId), actor));
}));

createEntityPropertyApiRouter<'survey'>(router, {
    entityType: 'survey', parameter: 'surveyId',
    read: {operation: 'getSurveyMetadata', requireProfile: true,
        read: ({id, actor}) => surveyApi.readSurveyMetadata(id, actor)},
    update: {operation: 'updateSurveyMetadata', requireProfile: true, delivery: 'result',
        normalize: surveyApi.normalizeSurveyMetadataPatch,
        execute: ({id, body, actor}) => surveyApi.patchSurveyMetadata(id, body, actor)},
});

/** Admit one replacement ballot and deliver only its prepared acknowledgement. */
router.put('/:surveyId/ballot', asyncHandler(async function submitSurveyBallot(req, res) {
    const actor = await requireApiContext(req, res, true);
    validateOperationRequest(req, 'submitSurveyBallot');
    // Preparation precedes the existing delete/save sequence; no replay is added.
    const {prepared} = await executePreparedJson(
        (result: components['schemas']['MutationResult']) => prepareValidatedJson(req, 'submitSurveyBallot', 200, result),
        prepare => surveyApi.submitSurveyBallot(String(req.params.surveyId), req.body, actor, prepare));
    sendPreparedJson(req, res, prepared!);
}));

/** Every admitted profile may create a recurring choice through the same owner. */
router.post('/:surveyId/combinations', asyncHandler(async function addSurveyCombination(req, res) {
    const actor = await requireApiContext(req, res, true);
    validateOperationRequest(req, 'addSurveyCombination');
    // Generated weekday/occurrence decoding precedes the shared insertion.
    const {prepared} = await executePreparedJson(
        (result: components['schemas']['MutationResult']) => prepareValidatedJson(req, 'addSurveyCombination', 200, result),
        prepare => surveyApi.addSurveyCombination(String(req.params.surveyId), req.body, actor, prepare));
    sendPreparedJson(req, res, prepared!);
}));

createEntityHeaderUpdateRouter(router, {
    parameter: 'surveyId', uploadOperation: 'uploadSurveyHeader', deleteOperation: 'deleteSurveyHeader',
    requireProfile: true, admitUpload: surveyApi.requireSurveyHeaderWrite,
    command: {
        receipt: 'controller',
        execute({id, file, actor}, prepare) {
            return surveyApi.setSurveyHeader(id, file, actor, prepare);
        },
    },
});

createEntityArchiveApiRouter<'survey'>(router, {
    entityType: 'survey', parameter: 'surveyId',
    archive: {operation: 'archiveSurvey', requireProfile: true, delivery: 'controller',
        async execute({id, actor}, prepare) { await surveyApi.setSurveyArchived(id, true, actor, prepare); }},
    restore: {operation: 'restoreSurvey', requireProfile: true, delivery: 'controller',
        async execute({id, actor}, prepare) { await surveyApi.setSurveyArchived(id, false, actor, prepare); }},
});

router.use(createGuestFlowGuestRouter(surveyFlow));

export default router;
