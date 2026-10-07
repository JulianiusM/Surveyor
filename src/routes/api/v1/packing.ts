/*
 * Copyright 2026 Julian Malovanij
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy at http://www.apache.org/licenses/LICENSE-2.0
 */

import {Router, type Request, type Response} from 'express';
import path from 'node:path';
import fs from 'node:fs/promises';
import type {components, operations} from '../../../types/api/v1';
import {ApiProblem} from '../../../modules/api/problem';
import {prepareFileUploader, removeImage} from '../../../modules/lib/fileCommons';
import settings from '../../../modules/settings';
import * as packingApi from '../../../modules/packing/api';
import {asyncHandler} from '../../../modules/lib/asyncHandler';
import {requireApiContext} from '../../../modules/api/session';
import {sendValidatedJson, validateOperationRequest} from '../../../modules/api/transport';
import {patchPackingMetadata, preparePackingMetadataPatch, readPackingList, readPackingMetadata, setPackingSelfAssignment} from '../../../modules/packing/api';

const router = Router();
const uploadHeader = prepareFileUploader(settings.value.headerImgDir).single('image');

/** Multer owns byte/file limits; the generated schema validates decoded multipart metadata. */
async function readImageUpload(req: Request, res: Response): Promise<void> {
    await new Promise<void>((resolve, reject) => uploadHeader(req, res, error => {
        if (!error) resolve();
        else reject(new ApiProblem(error.code === 'LIMIT_FILE_SIZE' ? 'PAYLOAD_TOO_LARGE' : 'UPLOAD_INVALID'));
    }));
}

router.get('/overview', asyncHandler(async function getPackingOverview(req, res) {
    const actor = await requireApiContext(req, res, true);
    validateOperationRequest(req, 'getPackingOverview');
    const query = req.query as operations['getPackingOverview']['parameters']['query'];
    sendValidatedJson(req, res, 'getPackingOverview', 200, await packingApi.readPackingOverview(query, actor));
}));

router.put('/overview/:entityType/:entityId/visibility', asyncHandler(async function setPackingVisibility(req, res) {
    const actor = await requireApiContext(req, res, true);
    validateOperationRequest(req, 'setPackingVisibility');
    sendValidatedJson(req, res, 'setPackingVisibility', 200, await packingApi.setPackingVisibility(
        req.params.entityType as components['schemas']['PackingOverviewCard']['type'], String(req.params.entityId), req.body, actor));
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
    packingApi.requirePackingCreation(actor);
    let committed = false;
    try {
        await readImageUpload(req, res);
        validateOperationRequest(req, 'createPackingList', function decodeCreateForm(body) {
            const form = body as Record<string, unknown>;
            if (Object.hasOwn(form, 'image') && !req.file) throw new ApiProblem('UPLOAD_INVALID');
            let data: unknown;
            try { data = typeof form.data === 'string' ? JSON.parse(form.data) : form.data; }
            catch { throw new ApiProblem('VALIDATION_FAILED'); }
            return {...form, data, ...(req.file ? {image: req.file.originalname} : {})};
        });
        const form = req.body as components['schemas']['PackingCreateForm'];
        const result = await packingApi.createPackingList(form.data, req.file, actor);
        committed = true;
        sendValidatedJson(req, res, 'createPackingList', 200, result);
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
    validateOperationRequest(req, 'updatePackingMetadata', preparePackingMetadataPatch);
    const result = await patchPackingMetadata(String(req.params.listId), req.body as unknown, req.get('If-Match'), actor);
    sendValidatedJson(req, res, 'updatePackingMetadata', 200, result.data, result.etag);
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
    const actor = await requireApiContext(req, res, true);
    validateOperationRequest(req, 'getPackingDuplicate');
    sendValidatedJson(req, res, 'getPackingDuplicate', 200, await packingApi.readPackingDuplicate(String(req.params.listId), actor));
}));

router.post('/:listId/items', asyncHandler(async function createPackingItem(req, res) {
    const actor = await requireApiContext(req, res, true);
    validateOperationRequest(req, 'createPackingItem');
    sendValidatedJson(req, res, 'createPackingItem', 200, await packingApi.createPackingItem(String(req.params.listId), req.body, actor));
}));

router.patch('/:listId/items/:itemId', asyncHandler(async function updatePackingItem(req, res) {
    const actor = await requireApiContext(req, res, true);
    validateOperationRequest(req, 'updatePackingItem');
    sendValidatedJson(req, res, 'updatePackingItem', 200, await packingApi.updatePackingItem(String(req.params.listId), String(req.params.itemId), req.body, req.get('If-Match'), actor));
}));

router.delete('/:listId/items/:itemId', asyncHandler(async function deletePackingItem(req, res) {
    const actor = await requireApiContext(req, res, true);
    validateOperationRequest(req, 'deletePackingItem');
    sendValidatedJson(req, res, 'deletePackingItem', 200, await packingApi.deletePackingItem(String(req.params.listId), String(req.params.itemId), actor));
}));

router.put('/:listId/item-order', asyncHandler(async function reorderPackingItems(req, res) {
    const actor = await requireApiContext(req, res, true);
    validateOperationRequest(req, 'reorderPackingItems');
    sendValidatedJson(req, res, 'reorderPackingItems', 200, await packingApi.reorderPackingItems(String(req.params.listId), req.body, req.get('If-Match'), actor));
}));

router.delete('/:listId/assignments/:assignmentId', asyncHandler(async function deletePackingAssignment(req, res) {
    const actor = await requireApiContext(req, res, true);
    validateOperationRequest(req, 'deletePackingAssignment');
    sendValidatedJson(req, res, 'deletePackingAssignment', 200, await packingApi.deletePackingAssignment(String(req.params.listId), Number(req.params.assignmentId), actor));
}));

router.put('/:listId/event', asyncHandler(async function changePackingEvent(req, res) {
    const actor = await requireApiContext(req, res, true);
    validateOperationRequest(req, 'changePackingEvent');
    sendValidatedJson(req, res, 'changePackingEvent', 200, await packingApi.changePackingEvent(String(req.params.listId), req.body, actor, req.get('If-Match')));
}));

router.put('/:listId/default-permissions', asyncHandler(async function updatePackingDefaults(req, res) {
    const actor = await requireApiContext(req, res, true);
    validateOperationRequest(req, 'updatePackingDefaults');
    sendValidatedJson(req, res, 'updatePackingDefaults', 200, await packingApi.updatePackingDefaults(String(req.params.listId), req.body, actor, req.get('If-Match')));
}));

router.post('/:listId/admins', asyncHandler(async function addPackingAdmin(req, res) {
    const actor = await requireApiContext(req, res, true);
    validateOperationRequest(req, 'addPackingAdmin');
    const body = req.body as components['schemas']['PackingAdminInput'];
    sendValidatedJson(req, res, 'addPackingAdmin', 200, await packingApi.setPackingAdmin(String(req.params.listId), body.profileId, body.mask, actor, req.get('If-Match')));
}));

router.patch('/:listId/admins/:profileId', asyncHandler(async function updatePackingAdmin(req, res) {
    const actor = await requireApiContext(req, res, true);
    validateOperationRequest(req, 'updatePackingAdmin');
    sendValidatedJson(req, res, 'updatePackingAdmin', 200, await packingApi.setPackingAdmin(String(req.params.listId), String(req.params.profileId), req.body.mask, actor, req.get('If-Match')));
}));

router.delete('/:listId/admins/:profileId', asyncHandler(async function deletePackingAdmin(req, res) {
    const actor = await requireApiContext(req, res, true);
    validateOperationRequest(req, 'deletePackingAdmin');
    sendValidatedJson(req, res, 'deletePackingAdmin', 200, await packingApi.setPackingAdmin(String(req.params.listId), String(req.params.profileId), null, actor, req.get('If-Match')));
}));

router.get('/:listId/profiles', asyncHandler(async function searchPackingProfiles(req, res) {
    const actor = await requireApiContext(req, res, true);
    validateOperationRequest(req, 'searchPackingProfiles');
    sendValidatedJson(req, res, 'searchPackingProfiles', 200, await packingApi.searchPackingProfiles(String(req.params.listId), String(req.query.q ?? ''), actor));
}));

router.put('/:listId/header', asyncHandler(async function uploadPackingHeader(req, res) {
    const actor = await requireApiContext(req, res, true);
    // Reject an unprivileged upload before writing bytes, and check again under the root lock.
    if (!(await packingApi.readPackingSettings(String(req.params.listId), actor)).capabilities.editHeader) throw new ApiProblem('FORBIDDEN');
    let committed = false;
    try {
        await readImageUpload(req, res);
        validateOperationRequest(req, 'uploadPackingHeader', body => ({...body as object, ...(req.file ? {image: req.file.originalname} : {})}));
        if (!req.file) throw new ApiProblem('UPLOAD_INVALID');
        const result = await packingApi.setPackingHeader(String(req.params.listId), req.file, actor, req.get('If-Match'));
        committed = true;
        sendValidatedJson(req, res, 'uploadPackingHeader', 200, result);
    } finally {
        if (!committed && req.file) removeImage(req.file.path);
    }
}));

router.delete('/:listId/header', asyncHandler(async function deletePackingHeader(req, res) {
    const actor = await requireApiContext(req, res, true);
    validateOperationRequest(req, 'deletePackingHeader');
    sendValidatedJson(req, res, 'deletePackingHeader', 200, await packingApi.setPackingHeader(String(req.params.listId), undefined, actor, req.get('If-Match')));
}));

router.get('/:listId/header', asyncHandler(async function getPackingHeader(req, res) {
    const actor = await requireApiContext(req, res, true);
    validateOperationRequest(req, 'getPackingHeader');
    const storedPath = await packingApi.readPackingHeaderPath(String(req.params.listId), actor);
    const directory = path.resolve(process.cwd(), settings.value.headerImgDir);
    const fullPath = path.resolve(process.cwd(), storedPath);
    const relative = path.relative(directory, fullPath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new ApiProblem('NOT_FOUND');
    let bytes: Buffer;
    try { bytes = await fs.readFile(fullPath); }
    catch { throw new ApiProblem('NOT_FOUND'); }
    res.set('Cache-Control', 'private, no-store').set('X-Surveyor-Context', actor.context).vary('Cookie').vary('X-Surveyor-Context');
    res.type('application/octet-stream').send(bytes);
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
