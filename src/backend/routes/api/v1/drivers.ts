/*
 * Copyright 2026 Julian Malovanij
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy at http://www.apache.org/licenses/LICENSE-2.0
 */

import {Router, type NextFunction, type Request, type Response} from 'express';
import type {components} from '../../../../types/api/v1';
import type {ApiOperationId, ApiResponseBody, ApiSuccessStatus, PreparedApiJsonResponse} from '../../../../types/ApiTransportTypes';
import {ApiProblem} from '../../../modules/api/problem';
import {prepareFileUploader, removeImage} from '../../../modules/lib/fileCommons';
import settings from '../../../modules/settings';
import * as driversApi from '../../../controller/driversController';
import {requireEntityCreation} from '../../../controller/entityAdminController';
import {asyncHandler} from '../../../modules/lib/asyncHandler';
import {requireApiContext} from '../../../modules/api/session';
import {searchLimiter} from '../../../middleware/adminApiFactory';
import {decodeApiMultipartData, decodeApiMultipartImage, prepareValidatedJson, receiveApiUpload, sendPreparedJson, sendStoredApiBinary, sendValidatedJson, validateOperationRequest} from '../../../modules/api/transport';
import {patchDriversMetadata, normalizeDriversMetadataPatch, readDriversList, readDriversMetadata, setDriversSelfAssignment} from '../../../controller/driversController';

const router = Router();
const uploadHeader = prepareFileUploader(settings.value.headerImgDir).single('image');

/** Prepare declared success bytes inside the controller's command transaction.
 * After it commits, the HTTP adapter only delivers that immutable receipt; network
 * failure remains an unknown delivery outcome and cannot trigger another write. */
async function sendDriversCommand<Operation extends ApiOperationId, Status extends ApiSuccessStatus<Operation>>(
    req: Request, res: Response, operation: Operation, status: Status,
    execute: (prepare: (data: ApiResponseBody<Operation, Status>) => void) => Promise<unknown>): Promise<void> {
    let prepared: PreparedApiJsonResponse;
    // The selected operation calls this while its existing DBAL transaction is
    // still open. Validation/serialization failure therefore rejects that write.
    function prepareResult(data: ApiResponseBody<Operation, Status>): void {
        prepared = prepareValidatedJson(req, operation, status, data);
    }
    await execute(prepareResult);
    sendPreparedJson(req, res, prepared!);
}

router.get('/create-entry', asyncHandler(async function getDriversCreateEntry(req, res) {
    const actor = await requireApiContext(req, res);
    validateOperationRequest(req, 'getDriversCreateEntry');
    sendValidatedJson(req, res, 'getDriversCreateEntry', 200,
        await driversApi.readDriversCreateEntry(actor, req.query.returnTo, req.query.eventId));
}));

router.get('/:listId/entry', asyncHandler(async function getDriversResourceEntry(req, res) {
    const actor = await requireApiContext(req, res);
    validateOperationRequest(req, 'getDriversResourceEntry');
    const view = req.query.view as 'detail' | 'guest';
    sendValidatedJson(req, res, 'getDriversResourceEntry', 200,
        await driversApi.readDriversResourceEntry(String(req.params.listId), view, actor));
}));

router.get('/create-context', asyncHandler(async function getDriversCreateContext(req, res) {
    const actor = await requireApiContext(req, res, true);
    validateOperationRequest(req, 'getDriversCreateContext');
    sendValidatedJson(req, res, 'getDriversCreateContext', 200, driversApi.readDriversCreateContext(actor));
}));

router.get('/events', asyncHandler(async function searchDriversEvents(req, res) {
    const actor = await requireApiContext(req, res, true);
    validateOperationRequest(req, 'searchDriversEvents');
    sendValidatedJson(req, res, 'searchDriversEvents', 200, await driversApi.searchDriversEvents(req.query, actor));
}));

router.post('/', asyncHandler(async function createDriversList(req, res) {
    const actor = await requireApiContext(req, res, true);
    requireEntityCreation('drivers', actor);
    let committed = false;
    try {
        await receiveApiUpload(req, res, uploadHeader);
        validateOperationRequest(req, 'createDriversList', body => decodeApiMultipartData(body, req.file));
        const form = req.body as components['schemas']['DriversCreateForm'];
        let prepared: PreparedApiJsonResponse;
        function prepareCreation(data: components['schemas']['DriversCreated']): void {
            prepared = prepareValidatedJson(req, 'createDriversList', 201, data);
        }
        const result = await driversApi.createDriversList(form.data, req.file, actor, prepareCreation);
        committed = true;
        res.location(`/api/v1/drivers-lists/${encodeURIComponent(result.id)}`);
        sendPreparedJson(req, res, prepared!);
    } finally {
        // A response serialization/network failure after commit must not remove the committed image.
        if (!committed && req.file) removeImage(req.file.path);
    }
}));

// Context admission happens once at the HTTP boundary. Controllers retain that actor through locks and commits.
router.get('/:listId', asyncHandler(async function getDriversList(req, res) {
    const actor = await requireApiContext(req, res, true);
    validateOperationRequest(req, 'getDriversList');
    const result = await readDriversList(String(req.params.listId), actor);
    sendValidatedJson(req, res, 'getDriversList', 200, result.data, result.etag);
}));

router.get('/:listId/metadata', asyncHandler(async function getDriversMetadata(req, res) {
    const actor = await requireApiContext(req, res, true);
    validateOperationRequest(req, 'getDriversMetadata');
    const result = await readDriversMetadata(String(req.params.listId), actor);
    sendValidatedJson(req, res, 'getDriversMetadata', 200, result.data, result.etag);
}));

router.patch('/:listId/metadata', asyncHandler(async function updateDriversMetadata(req, res) {
    const actor = await requireApiContext(req, res, true);
    // Preserve trim-before-length-check behavior after the common media/parameter admission.
    validateOperationRequest(req, 'updateDriversMetadata', normalizeDriversMetadataPatch);
    let prepared: PreparedApiJsonResponse;
    function prepareMetadata(result: Awaited<ReturnType<typeof patchDriversMetadata>>): void {
        prepared = prepareValidatedJson(req, 'updateDriversMetadata', 200, result.data);
    }
    const result = await patchDriversMetadata(String(req.params.listId), req.body as components['schemas']['DriversMetadataPatch'], req.get('If-Match'), actor, prepareMetadata);
    res.set('ETag', result.etag);
    sendPreparedJson(req, res, prepared!);
}));

// The existing description method is publicly grantable. Its separate adapter keeps
// the mixed root-property endpoint and its event/archive projection profile-only.
router.get('/:listId/description', asyncHandler(async function getDriversDescription(req, res) {
    const actor = await requireApiContext(req, res);
    validateOperationRequest(req, 'getDriversDescription');
    const baseline = await driversApi.readDriversDescription(String(req.params.listId), actor);
    sendValidatedJson(req, res, 'getDriversDescription', 200, baseline, baseline.editToken);
}));

router.patch('/:listId/description', asyncHandler(async function updateDriversDescription(req, res) {
    // Admit the independently granted description command and prepare its narrow receipt under the controller lock.
    const actor = await requireApiContext(req, res);
    validateOperationRequest(req, 'updateDriversDescription', normalizeDriversMetadataPatch);
    let prepared: PreparedApiJsonResponse;
    function prepareDescription(data: components['schemas']['DriversDescriptionBaseline']): void {
        prepared = prepareValidatedJson(req, 'updateDriversDescription', 200, data);
    }
    const baseline = await driversApi.patchDriversDescription(String(req.params.listId), req.body, req.get('If-Match'), actor, prepareDescription);
    res.set('ETag', baseline.editToken);
    sendPreparedJson(req, res, prepared!);
}));

router.put('/:listId/items/:itemId/self-assignment', asyncHandler(async function assignSelf(req, res) {
    // Take a passenger place for the captured profile through the shared locked capacity operation.
    const actor = await requireApiContext(req, res, true);
    validateOperationRequest(req, 'assignDriversItem');
    await sendDriversCommand(req, res, 'assignDriversItem', 200, function executeAssignment(prepare) {
        return setDriversSelfAssignment(String(req.params.listId), String(req.params.itemId), true, actor, prepare);
    });
}));

router.delete('/:listId/items/:itemId/self-assignment', asyncHandler(async function unassignSelf(req, res) {
    // Release the captured profile's passenger commitment without selecting an actor from request data.
    const actor = await requireApiContext(req, res, true);
    validateOperationRequest(req, 'unassignDriversItem');
    await sendDriversCommand(req, res, 'unassignDriversItem', 200, function executeAssignment(prepare) {
        return setDriversSelfAssignment(String(req.params.listId), String(req.params.itemId), false, actor, prepare);
    });
}));

router.get('/:listId/settings', asyncHandler(async function getDriversSettings(req, res) {
    const actor = await requireApiContext(req, res, true);
    validateOperationRequest(req, 'getDriversSettings');
    sendValidatedJson(req, res, 'getDriversSettings', 200, await driversApi.readDriversSettings(String(req.params.listId), actor));
}));

router.get('/:listId/duplicate', asyncHandler(async function getDriversDuplicate(req, res) {
    // Existing duplicate GET can be granted publicly; only the later creation POST needs an account.
    const actor = await requireApiContext(req, res);
    validateOperationRequest(req, 'getDriversDuplicate');
    sendValidatedJson(req, res, 'getDriversDuplicate', 200,
        await driversApi.readDriversDuplicate(String(req.params.listId), actor, req.query.eventId));
}));

router.post('/:listId/items', asyncHandler(async function createDriversItem(req, res) {
    const actor = await requireApiContext(req, res, true);
    validateOperationRequest(req, 'createDriversItem');
    const id = String(req.params.listId);
    let prepared: PreparedApiJsonResponse;
    function prepareItem(data: components['schemas']['DriversCreated']): void {
        prepared = prepareValidatedJson(req, 'createDriversItem', 201, data);
    }
    const result = await driversApi.createDriversItem(id, req.body, actor, prepareItem);
    // The ordered parent representation is authoritative for item reads. The fragment identifies
    // its newly created row without promising an unsupported single-item GET endpoint.
    res.location(`/api/v1/drivers-lists/${encodeURIComponent(id)}#${encodeURIComponent(result.id)}`);
    sendPreparedJson(req, res, prepared!);
}));

// Independently granted methods need reviewable baselines without revealing the
// linked detail page, assignments, parent context or unrelated edit fields.
router.get('/:listId/items/:itemId/edit-baseline', asyncHandler(async function getDriversItemEditBaseline(req, res) {
    const actor = await requireApiContext(req, res);
    validateOperationRequest(req, 'getDriversItemEditBaseline');
    const baseline = await driversApi.readDriversItemEditBaseline(String(req.params.listId), String(req.params.itemId), actor);
    sendValidatedJson(req, res, 'getDriversItemEditBaseline', 200, baseline, baseline.editToken);
}));

router.patch('/:listId/items/:itemId', asyncHandler(async function updateDriversItem(req, res) {
    // Apply only reviewed ride fields; the controller prepares success before its sparse write commits.
    const actor = await requireApiContext(req, res);
    validateOperationRequest(req, 'updateDriversItem');
    await sendDriversCommand(req, res, 'updateDriversItem', 200, function executeCommand(prepare) {
        return driversApi.updateDriversItem(String(req.params.listId), String(req.params.itemId), req.body, req.get('If-Match'), actor, prepare);
    });
}));

router.delete('/:listId/items/:itemId', asyncHandler(async function deleteDriversItem(req, res) {
    // Remove a currently scoped ride through its existing hard-delete owner and cascade behavior.
    const actor = await requireApiContext(req, res);
    validateOperationRequest(req, 'deleteDriversItem');
    await sendDriversCommand(req, res, 'deleteDriversItem', 200, function executeCommand(prepare) {
        return driversApi.deleteDriversItem(String(req.params.listId), String(req.params.itemId), actor, prepare);
    });
}));

router.get('/:listId/item-order', asyncHandler(async function getDriversItemOrderBaseline(req, res) {
    const actor = await requireApiContext(req, res);
    validateOperationRequest(req, 'getDriversItemOrderBaseline');
    const baseline = await driversApi.readDriversItemOrderBaseline(String(req.params.listId), actor);
    sendValidatedJson(req, res, 'getDriversItemOrderBaseline', 200, baseline, baseline.orderToken);
}));

router.put('/:listId/item-order', asyncHandler(async function reorderDriversItems(req, res) {
    // Submit the complete reviewed ride order without replaying an uncertain command.
    const actor = await requireApiContext(req, res);
    validateOperationRequest(req, 'reorderDriversItems');
    await sendDriversCommand(req, res, 'reorderDriversItems', 200, function executeCommand(prepare) {
        return driversApi.reorderDriversItems(String(req.params.listId), req.body, req.get('If-Match'), actor, prepare);
    });
}));

router.delete('/:listId/assignments/:assignmentId', asyncHandler(async function deleteDriversAssignment(req, res) {
    // Remove one scoped passenger handle through the existing assignment owner.
    const actor = await requireApiContext(req, res);
    validateOperationRequest(req, 'deleteDriversAssignment');
    await sendDriversCommand(req, res, 'deleteDriversAssignment', 200, function executeCommand(prepare) {
        return driversApi.deleteDriversAssignment(String(req.params.listId), String(req.params.assignmentId), actor, prepare);
    });
}));

router.put('/:listId/event', asyncHandler(async function changeDriversEvent(req, res) {
    // Relink through the shared relationship owner and prepare its resulting admission receipt inside that operation.
    const actor = await requireApiContext(req, res, true);
    validateOperationRequest(req, 'changeDriversEvent');
    await sendDriversCommand(req, res, 'changeDriversEvent', 200, function executeCommand(prepare) {
        return driversApi.changeDriversEvent(String(req.params.listId), req.body, actor, req.get('If-Match'), prepare);
    });
}));

router.get('/:listId/default-permissions', asyncHandler(async function getDriversDefaultsBaseline(req, res) {
    const actor = await requireApiContext(req, res);
    validateOperationRequest(req, 'getDriversDefaultsBaseline');
    const baseline = await driversApi.readDriversDefaultsBaseline(String(req.params.listId), actor);
    sendValidatedJson(req, res, 'getDriversDefaultsBaseline', 200, baseline, baseline.editToken);
}));

router.put('/:listId/default-permissions', asyncHandler(async function updateDriversDefaults(req, res) {
    // Submit sparse audience masks against their reviewed field hashes before committing shared permission persistence.
    const actor = await requireApiContext(req, res);
    validateOperationRequest(req, 'updateDriversDefaults');
    await sendDriversCommand(req, res, 'updateDriversDefaults', 200, function executeCommand(prepare) {
        return driversApi.updateDriversDefaults(String(req.params.listId), req.body, actor, req.get('If-Match'), prepare);
    });
}));

router.post('/:listId/admins', asyncHandler(async function addDriversAdmin(req, res) {
    // Add the reviewed profile grant through the shared administrator operation.
    const actor = await requireApiContext(req, res);
    validateOperationRequest(req, 'addDriversAdmin');
    const body = req.body as components['schemas']['DriversAdminInput'];
    await sendDriversCommand(req, res, 'addDriversAdmin', 200, function executeCommand(prepare) {
        return driversApi.setDriversAdmin(String(req.params.listId), body.profileId, body.mask, actor, req.get('If-Match'), prepare);
    });
}));

router.get('/:listId/admins/:profileId/edit-baseline', asyncHandler(async function getDriversAdminBaseline(req, res) {
    const actor = await requireApiContext(req, res);
    validateOperationRequest(req, 'getDriversAdminBaseline');
    const baseline = await driversApi.readDriversAdminBaseline(String(req.params.listId), String(req.params.profileId), actor);
    sendValidatedJson(req, res, 'getDriversAdminBaseline', 200, baseline, baseline.editToken);
}));

router.patch('/:listId/admins/:profileId', asyncHandler(async function updateDriversAdmin(req, res) {
    // Update only the selected administrator mask under its existing current-value comparison.
    const actor = await requireApiContext(req, res);
    validateOperationRequest(req, 'updateDriversAdmin');
    await sendDriversCommand(req, res, 'updateDriversAdmin', 200, function executeCommand(prepare) {
        return driversApi.setDriversAdmin(String(req.params.listId), String(req.params.profileId), req.body.mask, actor, req.get('If-Match'), prepare);
    });
}));

router.delete('/:listId/admins/:profileId', asyncHandler(async function deleteDriversAdmin(req, res) {
    // Remove the selected administrator grant without disclosing another profile or roster.
    const actor = await requireApiContext(req, res);
    validateOperationRequest(req, 'deleteDriversAdmin');
    await sendDriversCommand(req, res, 'deleteDriversAdmin', 200, function executeCommand(prepare) {
        return driversApi.setDriversAdmin(String(req.params.listId), String(req.params.profileId), null, actor, req.get('If-Match'), prepare);
    });
}));

/** Admit the authoritative context before the limiter can emit a versioned
 * Problem. The final controller still evaluates current management grants. */
async function admitDriversProfileSearch(req: Request, res: Response, next: NextFunction): Promise<void> {
    await requireApiContext(req, res);
    validateOperationRequest(req, 'searchDriversProfiles');
    next();
}

router.get('/:listId/profiles', asyncHandler(admitDriversProfileSearch), searchLimiter, asyncHandler(async function searchDriversProfiles(req, res) {
    sendValidatedJson(req, res, 'searchDriversProfiles', 200, await driversApi.searchDriversProfiles(String(req.params.listId), String(req.query.q ?? ''), req.apiActor!));
}));

router.get('/:listId/header/edit-baseline', asyncHandler(async function getDriversHeaderBaseline(req, res) {
    const actor = await requireApiContext(req, res);
    validateOperationRequest(req, 'getDriversHeaderBaseline');
    const baseline = await driversApi.readDriversHeaderBaseline(String(req.params.listId), actor);
    sendValidatedJson(req, res, 'getDriversHeaderBaseline', 200, baseline, baseline.editToken);
}));

router.put('/:listId/header', asyncHandler(async function uploadDriversHeader(req, res) {
    const actor = await requireApiContext(req, res);
    // Reject an unprivileged upload before writing bytes, and check again under the root lock.
    await driversApi.readDriversHeaderBaseline(String(req.params.listId), actor);
    let committed = false;
    try {
        await receiveApiUpload(req, res, uploadHeader);
        validateOperationRequest(req, 'uploadDriversHeader', body => decodeApiMultipartImage(body, req.file));
        if (!req.file) throw new ApiProblem('UPLOAD_INVALID');
        let prepared: PreparedApiJsonResponse;
        function prepareHeader(data: components['schemas']['MutationResult']): void {
            prepared = prepareValidatedJson(req, 'uploadDriversHeader', 200, data);
        }
        await driversApi.setDriversHeader(String(req.params.listId), req.file, actor, req.get('If-Match'), prepareHeader);
        committed = true;
        sendPreparedJson(req, res, prepared!);
    } finally {
        if (!committed && req.file) removeImage(req.file.path);
    }
}));

router.delete('/:listId/header', asyncHandler(async function deleteDriversHeader(req, res) {
    // Clear the reviewed header through the shared image-swap owner; old bytes are removed only after commit.
    const actor = await requireApiContext(req, res);
    validateOperationRequest(req, 'deleteDriversHeader');
    await sendDriversCommand(req, res, 'deleteDriversHeader', 200, function executeCommand(prepare) {
        return driversApi.setDriversHeader(String(req.params.listId), undefined, actor, req.get('If-Match'), prepare);
    });
}));

/** Serve header bytes only after current full-detail admission. Stored references
 * stay server-side, are confined to the configured image directory, and retain
 * the established missing-file response and generated binary transport policy. */
router.get('/:listId/header', asyncHandler(async function getDriversHeader(req, res) {
    // A method-only upload grant is insufficient for image disclosure. The
    // controller applies the current detail policy before returning a stored path.
    const actor = await requireApiContext(req, res, true);
    validateOperationRequest(req, 'getDriversHeader');
    const storedPath = await driversApi.readDriversHeaderPath(String(req.params.listId), actor);

    await sendStoredApiBinary(req, res, 'getDriversHeader', 200, settings.value.headerImgDir, storedPath);
}));

router.post('/:listId/archive', asyncHandler(async function archiveDriversList(req, res) {
    // Archive the root through the existing lifecycle controller and prepare its bounded acknowledgement before commit.
    const actor = await requireApiContext(req, res, true);
    validateOperationRequest(req, 'archiveDriversList');
    await sendDriversCommand(req, res, 'archiveDriversList', 200, function executeCommand(prepare) {
        return driversApi.setDriversArchived(String(req.params.listId), true, actor, prepare);
    });
}));

router.post('/:listId/restore', asyncHandler(async function restoreDriversList(req, res) {
    // Restore the root through the shared lifecycle operation, retaining inherited event restrictions.
    const actor = await requireApiContext(req, res, true);
    validateOperationRequest(req, 'restoreDriversList');
    await sendDriversCommand(req, res, 'restoreDriversList', 200, function executeCommand(prepare) {
        return driversApi.setDriversArchived(String(req.params.listId), false, actor, prepare);
    });
}));

router.delete('/:listId', asyncHandler(async function deleteDriversList(req, res) {
    // Hard-delete the profile-owned list through its existing feature operation after current locked ownership checks.
    const actor = await requireApiContext(req, res, true);
    validateOperationRequest(req, 'deleteDriversList');
    await sendDriversCommand(req, res, 'deleteDriversList', 200, function executeCommand(prepare) {
        return driversApi.deleteDriversList(String(req.params.listId), actor, undefined, prepare);
    });
}));

export default router;
