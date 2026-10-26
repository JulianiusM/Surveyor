/*
 * Copyright 2026 Julian Malovanij
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy at http://www.apache.org/licenses/LICENSE-2.0
 */

import {Router, type NextFunction, type Request, type Response} from 'express';
import type {components} from '../../../../types/api/v1';
import {ApiProblem} from '../../../modules/api/problem';
import {prepareFileUploader, removeImage} from '../../../modules/lib/fileCommons';
import settings from '../../../modules/settings';
import * as packingApi from '../../../controller/packingController';
import {requireEntityCreation} from '../../../controller/entityAdminController';
import {asyncHandler} from '../../../modules/lib/asyncHandler';
import {requireApiContext} from '../../../modules/api/session';
import {searchLimiter} from '../../../middleware/adminApiFactory';
import {decodeApiMultipartData, decodeApiMultipartImage, receiveApiUpload, sendStoredApiBinary, sendValidatedJson, validateOperationRequest} from '../../../modules/api/transport';
import {patchPackingMetadata, normalizePackingMetadataPatch, readPackingList, readPackingMetadata, setPackingSelfAssignment} from '../../../controller/packingController';

const router = Router();
const uploadHeader = prepareFileUploader(settings.value.headerImgDir).single('image');

router.get('/create-entry', asyncHandler(async function getPackingCreateEntry(req, res) {
    const actor = await requireApiContext(req, res);
    validateOperationRequest(req, 'getPackingCreateEntry');
    sendValidatedJson(req, res, 'getPackingCreateEntry', 200,
        await packingApi.readPackingCreateEntry(actor, req.query.returnTo, req.query.eventId));
}));

router.get('/:listId/entry', asyncHandler(async function getPackingResourceEntry(req, res) {
    const actor = await requireApiContext(req, res);
    validateOperationRequest(req, 'getPackingResourceEntry');
    const view = req.query.view as 'detail' | 'guest';
    sendValidatedJson(req, res, 'getPackingResourceEntry', 200,
        await packingApi.readPackingResourceEntry(String(req.params.listId), view, actor));
}));

router.get('/create-context', asyncHandler(async function getPackingCreateContext(req, res) {
    const actor = await requireApiContext(req, res, true);
    validateOperationRequest(req, 'getPackingCreateContext');
    sendValidatedJson(req, res, 'getPackingCreateContext', 200, packingApi.readPackingCreateContext(actor));
}));

router.get('/events', asyncHandler(async function searchPackingEvents(req, res) {
    const actor = await requireApiContext(req, res, true);
    validateOperationRequest(req, 'searchPackingEvents');
    sendValidatedJson(req, res, 'searchPackingEvents', 200, await packingApi.searchPackingEvents(req.query, actor));
}));

router.post('/', asyncHandler(async function createPackingList(req, res) {
    const actor = await requireApiContext(req, res, true);
    requireEntityCreation('packing', actor);
    let committed = false;
    try {
        await receiveApiUpload(req, res, uploadHeader);
        validateOperationRequest(req, 'createPackingList', body => decodeApiMultipartData(body, req.file));
        const form = req.body as components['schemas']['PackingCreateForm'];
        const result = await packingApi.createPackingList(form.data, req.file, actor);
        committed = true;
        res.location(`/api/v1/packing-lists/${encodeURIComponent(result.id)}`);
        sendValidatedJson(req, res, 'createPackingList', 201, result);
    } finally {
        // A response serialization/network failure after commit must not remove the committed image.
        if (!committed && req.file) removeImage(req.file.path);
    }
}));

// Context admission happens once at the HTTP boundary. Controllers retain that actor through locks and commits.
router.get('/:listId', asyncHandler(async function getPackingList(req, res) {
    const actor = await requireApiContext(req, res, true);
    validateOperationRequest(req, 'getPackingList');
    const result = await readPackingList(String(req.params.listId), actor);
    sendValidatedJson(req, res, 'getPackingList', 200, result.data, result.etag);
}));

router.get('/:listId/metadata', asyncHandler(async function getPackingMetadata(req, res) {
    const actor = await requireApiContext(req, res, true);
    validateOperationRequest(req, 'getPackingMetadata');
    const result = await readPackingMetadata(String(req.params.listId), actor);
    sendValidatedJson(req, res, 'getPackingMetadata', 200, result.data, result.etag);
}));

router.patch('/:listId/metadata', asyncHandler(async function updatePackingMetadata(req, res) {
    const actor = await requireApiContext(req, res, true);
    // Preserve trim-before-length-check behavior after the common media/parameter admission.
    validateOperationRequest(req, 'updatePackingMetadata', normalizePackingMetadataPatch);
    const result = await patchPackingMetadata(String(req.params.listId), req.body as components['schemas']['PackingMetadataPatch'], req.get('If-Match'), actor);
    sendValidatedJson(req, res, 'updatePackingMetadata', 200, result.data, result.etag);
}));

// The existing description method is publicly grantable. Its separate adapter keeps
// the mixed root-property endpoint and its event/archive projection profile-only.
router.get('/:listId/description', asyncHandler(async function getPackingDescription(req, res) {
    const actor = await requireApiContext(req, res);
    validateOperationRequest(req, 'getPackingDescription');
    const baseline = await packingApi.readPackingDescription(String(req.params.listId), actor);
    sendValidatedJson(req, res, 'getPackingDescription', 200, baseline, baseline.editToken);
}));

router.patch('/:listId/description', asyncHandler(async function updatePackingDescription(req, res) {
    const actor = await requireApiContext(req, res);
    validateOperationRequest(req, 'updatePackingDescription', normalizePackingMetadataPatch);
    const baseline = await packingApi.patchPackingDescription(String(req.params.listId), req.body, req.get('If-Match'), actor);
    sendValidatedJson(req, res, 'updatePackingDescription', 200, baseline, baseline.editToken);
}));

router.put('/:listId/items/:itemId/self-assignment', asyncHandler(async function assignSelf(req, res) {
    const actor = await requireApiContext(req, res, true);
    validateOperationRequest(req, 'assignPackingItem');
    const result = await setPackingSelfAssignment(String(req.params.listId), String(req.params.itemId), true, actor);
    sendValidatedJson(req, res, 'assignPackingItem', 200, result);
}));

router.delete('/:listId/items/:itemId/self-assignment', asyncHandler(async function unassignSelf(req, res) {
    const actor = await requireApiContext(req, res, true);
    validateOperationRequest(req, 'unassignPackingItem');
    const result = await setPackingSelfAssignment(String(req.params.listId), String(req.params.itemId), false, actor);
    sendValidatedJson(req, res, 'unassignPackingItem', 200, result);
}));

router.get('/:listId/settings', asyncHandler(async function getPackingSettings(req, res) {
    const actor = await requireApiContext(req, res, true);
    validateOperationRequest(req, 'getPackingSettings');
    sendValidatedJson(req, res, 'getPackingSettings', 200, await packingApi.readPackingSettings(String(req.params.listId), actor));
}));

router.get('/:listId/duplicate', asyncHandler(async function getPackingDuplicate(req, res) {
    // Existing duplicate GET can be granted publicly; only the later creation POST needs an account.
    const actor = await requireApiContext(req, res);
    validateOperationRequest(req, 'getPackingDuplicate');
    sendValidatedJson(req, res, 'getPackingDuplicate', 200,
        await packingApi.readPackingDuplicate(String(req.params.listId), actor, req.query.eventId));
}));

router.post('/:listId/items', asyncHandler(async function createPackingItem(req, res) {
    const actor = await requireApiContext(req, res, true);
    validateOperationRequest(req, 'createPackingItem');
    const id = String(req.params.listId);
    const result = await packingApi.createPackingItem(id, req.body, actor);
    // The ordered parent representation is authoritative for item reads. The fragment identifies
    // its newly created row without promising an unsupported single-item GET endpoint.
    res.location(`/api/v1/packing-lists/${encodeURIComponent(id)}#${encodeURIComponent(result.id)}`);
    sendValidatedJson(req, res, 'createPackingItem', 201, result);
}));

// Independently granted methods need reviewable baselines without revealing the
// linked detail page, assignments, parent context or unrelated edit fields.
router.get('/:listId/items/:itemId/edit-baseline', asyncHandler(async function getPackingItemEditBaseline(req, res) {
    const actor = await requireApiContext(req, res);
    validateOperationRequest(req, 'getPackingItemEditBaseline');
    const baseline = await packingApi.readPackingItemEditBaseline(String(req.params.listId), String(req.params.itemId), actor);
    sendValidatedJson(req, res, 'getPackingItemEditBaseline', 200, baseline, baseline.editToken);
}));

router.patch('/:listId/items/:itemId', asyncHandler(async function updatePackingItem(req, res) {
    const actor = await requireApiContext(req, res);
    validateOperationRequest(req, 'updatePackingItem');
    sendValidatedJson(req, res, 'updatePackingItem', 200, await packingApi.updatePackingItem(String(req.params.listId), String(req.params.itemId), req.body, req.get('If-Match'), actor));
}));

router.delete('/:listId/items/:itemId', asyncHandler(async function deletePackingItem(req, res) {
    const actor = await requireApiContext(req, res);
    validateOperationRequest(req, 'deletePackingItem');
    sendValidatedJson(req, res, 'deletePackingItem', 200, await packingApi.deletePackingItem(String(req.params.listId), String(req.params.itemId), actor));
}));

router.get('/:listId/item-order', asyncHandler(async function getPackingItemOrderBaseline(req, res) {
    const actor = await requireApiContext(req, res);
    validateOperationRequest(req, 'getPackingItemOrderBaseline');
    const baseline = await packingApi.readPackingItemOrderBaseline(String(req.params.listId), actor);
    sendValidatedJson(req, res, 'getPackingItemOrderBaseline', 200, baseline, baseline.orderToken);
}));

router.put('/:listId/item-order', asyncHandler(async function reorderPackingItems(req, res) {
    const actor = await requireApiContext(req, res);
    validateOperationRequest(req, 'reorderPackingItems');
    sendValidatedJson(req, res, 'reorderPackingItems', 200, await packingApi.reorderPackingItems(String(req.params.listId), req.body, req.get('If-Match'), actor));
}));

router.delete('/:listId/assignments/:assignmentId', asyncHandler(async function deletePackingAssignment(req, res) {
    const actor = await requireApiContext(req, res);
    validateOperationRequest(req, 'deletePackingAssignment');
    sendValidatedJson(req, res, 'deletePackingAssignment', 200, await packingApi.deletePackingAssignment(String(req.params.listId), String(req.params.assignmentId), actor));
}));

router.put('/:listId/event', asyncHandler(async function changePackingEvent(req, res) {
    const actor = await requireApiContext(req, res, true);
    validateOperationRequest(req, 'changePackingEvent');
    sendValidatedJson(req, res, 'changePackingEvent', 200, await packingApi.changePackingEvent(String(req.params.listId), req.body, actor, req.get('If-Match')));
}));

router.get('/:listId/default-permissions', asyncHandler(async function getPackingDefaultsBaseline(req, res) {
    const actor = await requireApiContext(req, res);
    validateOperationRequest(req, 'getPackingDefaultsBaseline');
    const baseline = await packingApi.readPackingDefaultsBaseline(String(req.params.listId), actor);
    sendValidatedJson(req, res, 'getPackingDefaultsBaseline', 200, baseline, baseline.editToken);
}));

router.put('/:listId/default-permissions', asyncHandler(async function updatePackingDefaults(req, res) {
    const actor = await requireApiContext(req, res);
    validateOperationRequest(req, 'updatePackingDefaults');
    sendValidatedJson(req, res, 'updatePackingDefaults', 200, await packingApi.updatePackingDefaults(String(req.params.listId), req.body, actor, req.get('If-Match')));
}));

router.post('/:listId/admins', asyncHandler(async function addPackingAdmin(req, res) {
    const actor = await requireApiContext(req, res);
    validateOperationRequest(req, 'addPackingAdmin');
    const body = req.body as components['schemas']['PackingAdminInput'];
    sendValidatedJson(req, res, 'addPackingAdmin', 200, await packingApi.setPackingAdmin(String(req.params.listId), body.profileId, body.mask, actor, req.get('If-Match')));
}));

router.get('/:listId/admins/:profileId/edit-baseline', asyncHandler(async function getPackingAdminBaseline(req, res) {
    const actor = await requireApiContext(req, res);
    validateOperationRequest(req, 'getPackingAdminBaseline');
    const baseline = await packingApi.readPackingAdminBaseline(String(req.params.listId), String(req.params.profileId), actor);
    sendValidatedJson(req, res, 'getPackingAdminBaseline', 200, baseline, baseline.editToken);
}));

router.patch('/:listId/admins/:profileId', asyncHandler(async function updatePackingAdmin(req, res) {
    const actor = await requireApiContext(req, res);
    validateOperationRequest(req, 'updatePackingAdmin');
    sendValidatedJson(req, res, 'updatePackingAdmin', 200, await packingApi.setPackingAdmin(String(req.params.listId), String(req.params.profileId), req.body.mask, actor, req.get('If-Match')));
}));

router.delete('/:listId/admins/:profileId', asyncHandler(async function deletePackingAdmin(req, res) {
    const actor = await requireApiContext(req, res);
    validateOperationRequest(req, 'deletePackingAdmin');
    sendValidatedJson(req, res, 'deletePackingAdmin', 200, await packingApi.setPackingAdmin(String(req.params.listId), String(req.params.profileId), null, actor, req.get('If-Match')));
}));

/** Admit the authoritative context before the limiter can emit a versioned
 * Problem. The final controller still evaluates current management grants. */
async function admitPackingProfileSearch(req: Request, res: Response, next: NextFunction): Promise<void> {
    await requireApiContext(req, res);
    validateOperationRequest(req, 'searchPackingProfiles');
    next();
}

router.get('/:listId/profiles', asyncHandler(admitPackingProfileSearch), searchLimiter, asyncHandler(async function searchPackingProfiles(req, res) {
    sendValidatedJson(req, res, 'searchPackingProfiles', 200, await packingApi.searchPackingProfiles(String(req.params.listId), String(req.query.q ?? ''), req.apiActor!));
}));

router.get('/:listId/header/edit-baseline', asyncHandler(async function getPackingHeaderBaseline(req, res) {
    const actor = await requireApiContext(req, res);
    validateOperationRequest(req, 'getPackingHeaderBaseline');
    const baseline = await packingApi.readPackingHeaderBaseline(String(req.params.listId), actor);
    sendValidatedJson(req, res, 'getPackingHeaderBaseline', 200, baseline, baseline.editToken);
}));

router.put('/:listId/header', asyncHandler(async function uploadPackingHeader(req, res) {
    const actor = await requireApiContext(req, res);
    // Reject an unprivileged upload before writing bytes, and check again under the root lock.
    await packingApi.readPackingHeaderBaseline(String(req.params.listId), actor);
    let committed = false;
    try {
        await receiveApiUpload(req, res, uploadHeader);
        validateOperationRequest(req, 'uploadPackingHeader', body => decodeApiMultipartImage(body, req.file));
        if (!req.file) throw new ApiProblem('UPLOAD_INVALID');
        const result = await packingApi.setPackingHeader(String(req.params.listId), req.file, actor, req.get('If-Match'));
        committed = true;
        sendValidatedJson(req, res, 'uploadPackingHeader', 200, result);
    } finally {
        if (!committed && req.file) removeImage(req.file.path);
    }
}));

router.delete('/:listId/header', asyncHandler(async function deletePackingHeader(req, res) {
    const actor = await requireApiContext(req, res);
    validateOperationRequest(req, 'deletePackingHeader');
    sendValidatedJson(req, res, 'deletePackingHeader', 200, await packingApi.setPackingHeader(String(req.params.listId), undefined, actor, req.get('If-Match')));
}));

/** Serve header bytes only after current full-detail admission. Stored references
 * stay server-side, are confined to the configured image directory, and retain
 * the established missing-file response and generated binary transport policy. */
router.get('/:listId/header', asyncHandler(async function getPackingHeader(req, res) {
    // A method-only upload grant is insufficient for image disclosure. The
    // controller applies the current detail policy before returning a stored path.
    const actor = await requireApiContext(req, res, true);
    validateOperationRequest(req, 'getPackingHeader');
    const storedPath = await packingApi.readPackingHeaderPath(String(req.params.listId), actor);

    await sendStoredApiBinary(req, res, 'getPackingHeader', 200, settings.value.headerImgDir, storedPath);
}));

router.post('/:listId/archive', asyncHandler(async function archivePackingList(req, res) {
    const actor = await requireApiContext(req, res, true);
    validateOperationRequest(req, 'archivePackingList');
    sendValidatedJson(req, res, 'archivePackingList', 200, await packingApi.setPackingArchived(String(req.params.listId), true, actor));
}));

router.post('/:listId/restore', asyncHandler(async function restorePackingList(req, res) {
    const actor = await requireApiContext(req, res, true);
    validateOperationRequest(req, 'restorePackingList');
    sendValidatedJson(req, res, 'restorePackingList', 200, await packingApi.setPackingArchived(String(req.params.listId), false, actor));
}));

router.delete('/:listId', asyncHandler(async function deletePackingList(req, res) {
    const actor = await requireApiContext(req, res, true);
    validateOperationRequest(req, 'deletePackingList');
    sendValidatedJson(req, res, 'deletePackingList', 200, await packingApi.deletePackingList(String(req.params.listId), actor));
}));

export default router;
