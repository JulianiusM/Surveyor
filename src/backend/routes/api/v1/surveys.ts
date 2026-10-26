/*
 * Copyright 2026 Julian Malovanij
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy at http://www.apache.org/licenses/LICENSE-2.0
 */

import {Router, type Request, type Response} from 'express';
import * as surveyApi from '../../../controller/surveyController';
import {createGuestFlowApiRouter} from '../../../middleware/guestFlowFactory';
import {surveyFlow} from '../../surveyFlow';
import type {components} from '../../../../types/api/v1';
import type {PreparedApiJsonResponse} from '../../../../types/ApiTransportTypes';
import type {SurveyMutationOperation, SurveyMutationPreparation} from '../../../../types/SurveyTypes';
import {requireApiContext} from '../../../modules/api/session';
import {prepareValidatedJson, sendPreparedJson, sendValidatedJson, validateOperationRequest} from '../../../modules/api/transport';
import {asyncHandler} from '../../../modules/lib/asyncHandler';
import {createEntityHeaderUpdateRouter} from '../../../middleware/entityHeaderUpdateHandler';
import {createEntityArchiveApiRouter, createEntityPropertyApiRouter} from '../../../middleware/adminApiFactory';

const router = Router();
router.use(createGuestFlowApiRouter(surveyFlow));

/** Prepare invariant command bytes before invoking the unchanged business write.
 * Delivery after success never performs another schema check, projection read or
 * mutable-session admission. Failure does not trigger replay or rollback claims. */
async function sendSurveyCommand(req: Request, res: Response, operation: SurveyMutationOperation,
    execute: (prepare: SurveyMutationPreparation) => Promise<unknown>): Promise<void> {
    let prepared: PreparedApiJsonResponse;
    function prepareResult(result: components['schemas']['MutationResult']): void {
        prepared = prepareValidatedJson(req, operation, 200, result);
    }
    await execute(prepareResult);
    sendPreparedJson(req, res, prepared!);
}

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
    await sendSurveyCommand(req, res, 'submitSurveyBallot', prepare => surveyApi.submitSurveyBallot(String(req.params.surveyId), req.body, actor, prepare));
}));

/** Every admitted profile may create a recurring choice through the same owner. */
router.post('/:surveyId/combinations', asyncHandler(async function addSurveyCombination(req, res) {
    const actor = await requireApiContext(req, res, true);
    validateOperationRequest(req, 'addSurveyCombination');
    // Generated weekday/occurrence decoding precedes the shared insertion.
    await sendSurveyCommand(req, res, 'addSurveyCombination', prepare => surveyApi.addSurveyCombination(String(req.params.surveyId), req.body, actor, prepare));
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

export default router;
