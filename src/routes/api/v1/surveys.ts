/*
 * Copyright 2026 Julian Malovanij
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy at http://www.apache.org/licenses/LICENSE-2.0
 */

import {Router, type Request, type Response} from 'express';
import * as surveyApi from '../../../controller/surveyController';
import type {components} from '../../../types/api/v1';
import type {PreparedApiJsonResponse} from '../../../types/ApiTransportTypes';
import type {SurveyMutationOperation, SurveyMutationPreparation} from '../../../types/SurveyTypes';
import {ApiProblem} from '../../../modules/api/problem';
import {requireApiContext} from '../../../modules/api/session';
import {decodeApiMultipartData, decodeApiMultipartImage, prepareValidatedJson, receiveApiUpload, sendPreparedJson, sendStoredApiBinary, sendValidatedJson, validateOperationRequest} from '../../../modules/api/transport';
import {asyncHandler} from '../../../modules/lib/asyncHandler';
import {prepareFileUploader, removeImage} from '../../../modules/lib/fileCommons';
import settings from '../../../modules/settings';

const router = Router();
const uploadHeader = prepareFileUploader(settings.value.headerImgDir).single('image');

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

router.get('/create-entry', asyncHandler(async function getSurveyCreateEntry(req, res) {
    const actor = await requireApiContext(req, res);
    validateOperationRequest(req, 'getSurveyCreateEntry');
    sendValidatedJson(req, res, 'getSurveyCreateEntry', 200, surveyApi.readSurveyCreateEntry(actor, req.query.returnTo));
}));

router.get('/:surveyId/entry', asyncHandler(async function getSurveyResourceEntry(req, res) {
    const actor = await requireApiContext(req, res);
    validateOperationRequest(req, 'getSurveyResourceEntry');
    sendValidatedJson(req, res, 'getSurveyResourceEntry', 200,
        await surveyApi.readSurveyResourceEntry(String(req.params.surveyId), req.query.view as 'detail' | 'guest', actor));
}));

router.post('/', asyncHandler(async function createSurvey(req, res) {
    const actor = await requireApiContext(req, res, true);
    surveyApi.requireSurveyCreation(actor);
    let committed = false;
    try {
        // Reject a nonaccount before storing bytes. The existing creator retains
        // its own transaction, and the adapter never replays an uncertain command.
        await receiveApiUpload(req, res, uploadHeader);
        validateOperationRequest(req, 'createSurvey', body => decodeApiMultipartData(body, req.file));
        const form = req.body as components['schemas']['SurveyCreateForm'];
        const result = await surveyApi.createSurvey(form.data, req.file, actor);
        committed = true;
        res.location(`/api/v1/surveys/${encodeURIComponent(result.id)}`);
        sendValidatedJson(req, res, 'createSurvey', 201, result);
    } finally {
        // Delivery failure cannot discard an image already owned by a committed
        // survey. Rejected uploads retain the established best-effort cleanup.
        if (!committed && req.file) removeImage(req.file.path);
    }
}));

router.get('/:surveyId', asyncHandler(async function getSurvey(req, res) {
    const actor = await requireApiContext(req, res, true);
    validateOperationRequest(req, 'getSurvey');
    const result = await surveyApi.readSurvey(String(req.params.surveyId), actor);
    sendValidatedJson(req, res, 'getSurvey', 200, result.data, result.etag);
}));

router.get('/:surveyId/duplicate', asyncHandler(async function getSurveyDuplicate(req, res) {
    const actor = await requireApiContext(req, res, true);
    validateOperationRequest(req, 'getSurveyDuplicate');
    sendValidatedJson(req, res, 'getSurveyDuplicate', 200, await surveyApi.readSurveyDuplicate(String(req.params.surveyId), actor));
}));

router.get('/:surveyId/settings', asyncHandler(async function getSurveySettings(req, res) {
    const actor = await requireApiContext(req, res, true);
    validateOperationRequest(req, 'getSurveySettings');
    sendValidatedJson(req, res, 'getSurveySettings', 200, await surveyApi.readSurveySettings(String(req.params.surveyId), actor));
}));

router.get('/:surveyId/metadata', asyncHandler(async function getSurveyMetadata(req, res) {
    const actor = await requireApiContext(req, res, true);
    validateOperationRequest(req, 'getSurveyMetadata');
    const result = await surveyApi.readSurveyMetadata(String(req.params.surveyId), actor);
    sendValidatedJson(req, res, 'getSurveyMetadata', 200, result.data, result.etag);
}));

router.patch('/:surveyId/metadata', asyncHandler(async function updateSurveyMetadata(req, res) {
    const actor = await requireApiContext(req, res, true);
    validateOperationRequest(req, 'updateSurveyMetadata', surveyApi.normalizeSurveyMetadataPatch);
    const result = await surveyApi.patchSurveyMetadata(String(req.params.surveyId), req.body, actor);
    sendValidatedJson(req, res, 'updateSurveyMetadata', 200, result.data, result.etag);
}));

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

router.put('/:surveyId/header', asyncHandler(async function uploadSurveyHeader(req, res) {
    const actor = await requireApiContext(req, res, true);
    const id = String(req.params.surveyId);
    await surveyApi.requireSurveyHeaderWrite(id, actor);
    let committed = false;
    try {
        // Owner admission precedes disk storage; the controller independently
        // rechecks the captured actor before invoking the shared image operation.
        await receiveApiUpload(req, res, uploadHeader);
        validateOperationRequest(req, 'uploadSurveyHeader', body => decodeApiMultipartImage(body, req.file));
        if (!req.file) throw new ApiProblem('UPLOAD_INVALID');
        let prepared: PreparedApiJsonResponse;
        function prepareHeader(result: components['schemas']['MutationResult']): void {
            prepared = prepareValidatedJson(req, 'uploadSurveyHeader', 200, result);
        }
        await surveyApi.setSurveyHeader(id, req.file, actor, prepareHeader);
        committed = true;
        sendPreparedJson(req, res, prepared!);
    } finally {
        if (!committed && req.file) removeImage(req.file.path);
    }
}));

/** Remove the image through its original swap and postwrite cleanup operation. */
router.delete('/:surveyId/header', asyncHandler(async function deleteSurveyHeader(req, res) {
    const actor = await requireApiContext(req, res, true);
    validateOperationRequest(req, 'deleteSurveyHeader');
    // The controller prepares its actual prewrite image-presence acknowledgement.
    await sendSurveyCommand(req, res, 'deleteSurveyHeader', prepare => surveyApi.setSurveyHeader(String(req.params.surveyId), undefined, actor, prepare));
}));

/** Resolve stored bytes only after profile/detail admission. Files stay confined
 * to the configured image directory and failures disclose no filesystem details. */
router.get('/:surveyId/header', asyncHandler(async function getSurveyHeader(req, res) {
    const actor = await requireApiContext(req, res, true);
    validateOperationRequest(req, 'getSurveyHeader');
    const storedPath = await surveyApi.readSurveyHeaderPath(String(req.params.surveyId), actor);

    await sendStoredApiBinary(req, res, 'getSurveyHeader', 200, settings.value.headerImgDir, storedPath);
}));

/** Archive remains a shared owner command, separate from permanent removal. */
router.post('/:surveyId/archive', asyncHandler(async function archiveSurvey(req, res) {
    const actor = await requireApiContext(req, res, true);
    validateOperationRequest(req, 'archiveSurvey');
    // Shared lifecycle authorization runs independently of this prepared receipt.
    await sendSurveyCommand(req, res, 'archiveSurvey', prepare => surveyApi.setSurveyArchived(String(req.params.surveyId), true, actor, prepare));
}));

/** Restore through the lifecycle owner without recreating files or ballots. */
router.post('/:surveyId/restore', asyncHandler(async function restoreSurvey(req, res) {
    const actor = await requireApiContext(req, res, true);
    validateOperationRequest(req, 'restoreSurvey');
    // The existing desired-state operation remains authoritative and retry-safe.
    await sendSurveyCommand(req, res, 'restoreSurvey', prepare => surveyApi.setSurveyArchived(String(req.params.surveyId), false, actor, prepare));
}));

/** Permanently remove an owned survey through its existing simple operation. */
router.delete('/:surveyId', asyncHandler(async function deleteSurvey(req, res) {
    const actor = await requireApiContext(req, res, true);
    validateOperationRequest(req, 'deleteSurvey');
    // Result validation cannot fail after records and their header are retired.
    await sendSurveyCommand(req, res, 'deleteSurvey', prepare => surveyApi.deleteSurvey(String(req.params.surveyId), actor, prepare));
}));

export default router;
