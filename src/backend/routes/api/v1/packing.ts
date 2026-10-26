/*
 * Copyright 2026 Julian Malovanij
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy at http://www.apache.org/licenses/LICENSE-2.0
 */

import {Router} from 'express';
import * as packingApi from '../../../controller/packingController';
import {createGuestFlowApiRouter} from '../../../middleware/guestFlowFactory';
import {packingFlow} from '../../packingFlow';
import {asyncHandler} from '../../../modules/lib/asyncHandler';
import {requireApiContext} from '../../../modules/api/session';
import {createEntityAdminApiRouter, createEntityArchiveApiRouter, createEntityPropertyApiRouter,
    createUserSearchApiRouter} from '../../../middleware/adminApiFactory';
import {attachAssignRoutes} from '../../../middleware/assignFlowFactory';
import {createEntityHeaderUpdateRouter} from '../../../middleware/entityHeaderUpdateHandler';
import {sendValidatedJson, validateOperationRequest} from '../../../modules/api/transport';
import {patchPackingMetadata, normalizePackingMetadataPatch, readPackingMetadata, setPackingSelfAssignment} from '../../../controller/packingController';

const router = Router();
router.use(createGuestFlowApiRouter(packingFlow));

createEntityPropertyApiRouter<'packing'>(router, {
    entityType: 'packing', parameter: 'listId',
    read: {operation: 'getPackingMetadata', requireProfile: true,
        read: ({id, actor}) => readPackingMetadata(id, actor)},
    update: {operation: 'updatePackingMetadata', requireProfile: true, delivery: 'result',
        normalize: normalizePackingMetadataPatch,
        execute: ({id, body, ifMatch, actor}) => patchPackingMetadata(id, body, ifMatch, actor)},
    event: {operation: 'changePackingEvent', requireProfile: true, delivery: 'result',
        async execute({id, body, actor, ifMatch}) {
            return {data: await packingApi.changePackingEvent(id, body, actor, ifMatch)};
        }},
});

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

attachAssignRoutes(router, {
    path: '/:listId/items/:itemId/self-assignment',
    entityParameter: 'listId', itemParameter: 'itemId', requireProfile: true,
    assign: {operation: 'assignPackingItem', delivery: 'result',
        execute: ({entityId, itemId, actor}) => setPackingSelfAssignment(entityId, itemId, true, actor)},
    unassign: {operation: 'unassignPackingItem', delivery: 'result',
        execute: ({entityId, itemId, actor}) => setPackingSelfAssignment(entityId, itemId, false, actor)},
});

router.get('/:listId/settings', asyncHandler(async function getPackingSettings(req, res) {
    const actor = await requireApiContext(req, res, true);
    validateOperationRequest(req, 'getPackingSettings');
    sendValidatedJson(req, res, 'getPackingSettings', 200, await packingApi.readPackingSettings(String(req.params.listId), actor));
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

createEntityAdminApiRouter<'packing'>(router, {
    entityType: 'packing', parameter: 'listId',
    baseline: {operation: 'getPackingAdminBaseline', requireProfile: false,
        async read({id, profileId, actor}) {
            const data = await packingApi.readPackingAdminBaseline(id, profileId, actor);
            return {data, etag: data.editToken};
        }},
    add: {operation: 'addPackingAdmin', requireProfile: false, delivery: 'result',
        async execute({id, body, actor, ifMatch}) {
            return {data: await packingApi.setPackingAdmin(id, body.profileId, body.mask, actor, ifMatch)};
        }},
    update: {operation: 'updatePackingAdmin', requireProfile: false, delivery: 'result',
        async execute({id, profileId, body, actor, ifMatch}) {
            return {data: await packingApi.setPackingAdmin(id, profileId, body.mask, actor, ifMatch)};
        }},
    remove: {operation: 'deletePackingAdmin', requireProfile: false, delivery: 'result',
        async execute({id, profileId, actor, ifMatch}) {
            return {data: await packingApi.setPackingAdmin(id, profileId, null, actor, ifMatch)};
        }},
});

createUserSearchApiRouter<'packing'>(router, {
    entityType: 'packing', parameter: 'listId',
    search: {operation: 'searchPackingProfiles', requireProfile: false,
        async read({id, query, actor}) {
            return {data: await packingApi.searchPackingProfiles(id, String(query.q ?? ''), actor)};
        }},
});

router.get('/:listId/header/edit-baseline', asyncHandler(async function getPackingHeaderBaseline(req, res) {
    const actor = await requireApiContext(req, res);
    validateOperationRequest(req, 'getPackingHeaderBaseline');
    const baseline = await packingApi.readPackingHeaderBaseline(String(req.params.listId), actor);
    sendValidatedJson(req, res, 'getPackingHeaderBaseline', 200, baseline, baseline.editToken);
}));

createEntityHeaderUpdateRouter(router, {
    parameter: 'listId', uploadOperation: 'uploadPackingHeader', deleteOperation: 'deletePackingHeader',
    requireProfile: false, admitUpload: packingApi.readPackingHeaderBaseline,
    command: {
        receipt: 'after-write',
        execute({id, file, actor, ifMatch}) {
            return packingApi.setPackingHeader(id, file, actor, ifMatch);
        },
    },
});

createEntityArchiveApiRouter<'packing'>(router, {
    entityType: 'packing', parameter: 'listId',
    archive: {operation: 'archivePackingList', requireProfile: true, delivery: 'result',
        async execute({id, actor}) { return {data: await packingApi.setPackingArchived(id, true, actor)}; }},
    restore: {operation: 'restorePackingList', requireProfile: true, delivery: 'result',
        async execute({id, actor}) { return {data: await packingApi.setPackingArchived(id, false, actor)}; }},
});

export default router;
