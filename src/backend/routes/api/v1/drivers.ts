/*
 * Copyright 2026 Julian Malovanij
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy at http://www.apache.org/licenses/LICENSE-2.0
 */

import {Router, type Request, type Response} from 'express';
import type {components} from '../../../../types/api/v1';
import type {ApiOperationId, ApiResponseBody, ApiSuccessStatus, PreparedApiJsonResponse} from '../../../../types/ApiTransportTypes';
import * as driversApi from '../../../controller/driversController';
import {createGuestFlowApiRouter, createGuestFlowGuestRouter} from '../../../middleware/guestFlowFactory';
import {driversFlow} from '../../driversFlow';
import {asyncHandler} from '../../../modules/lib/asyncHandler';
import {requireApiContext} from '../../../modules/api/session';
import {createEntityAdminApiRouter, createEntityArchiveApiRouter, createEntityPropertyApiRouter,
    createUserSearchApiRouter} from '../../../middleware/adminApiFactory';
import {attachAssignRoutes} from '../../../middleware/assignFlowFactory';
import {createEntityHeaderUpdateRouter} from '../../../middleware/entityHeaderUpdateHandler';
import {prepareValidatedJson, sendPreparedJson, sendValidatedJson, validateOperationRequest} from '../../../modules/api/transport';
import {patchDriversMetadata, normalizeDriversMetadataPatch, readDriversMetadata, setDriversSelfAssignment} from '../../../controller/driversController';

const router = Router();
router.use(createGuestFlowApiRouter(driversFlow));

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

createEntityPropertyApiRouter<'drivers'>(router, {
    entityType: 'drivers', parameter: 'listId',
    read: {operation: 'getDriversMetadata', requireProfile: true,
        read: ({id, actor}) => readDriversMetadata(id, actor)},
    update: {operation: 'updateDriversMetadata', requireProfile: true, delivery: 'controller',
        normalize: normalizeDriversMetadataPatch,
        async execute({id, body, actor, ifMatch}, prepare) {
            // The controller prepares the metadata body under its existing lock;
            // deliver its matching ETag only after that same command completes.
            const result = await patchDriversMetadata(id, body, ifMatch, actor, result => prepare(result.data));
            return {etag: result.etag};
        }},
    event: {operation: 'changeDriversEvent', requireProfile: true, delivery: 'controller',
        async execute({id, body, actor, ifMatch}, prepare) {
            await driversApi.changeDriversEvent(id, body, actor, ifMatch, prepare);
        }},
});

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

attachAssignRoutes(router, {
    path: '/:listId/items/:itemId/self-assignment',
    entityParameter: 'listId', itemParameter: 'itemId', requireProfile: true,
    // The existing membership operation invokes preparation before its current
    // transaction commits; the factory then delivers that completed response.
    assign: {operation: 'assignDriversItem', delivery: 'transaction',
        execute: ({entityId, itemId, actor}, prepare) => setDriversSelfAssignment(entityId, itemId, true, actor, prepare)},
    unassign: {operation: 'unassignDriversItem', delivery: 'transaction',
        execute: ({entityId, itemId, actor}, prepare) => setDriversSelfAssignment(entityId, itemId, false, actor, prepare)},
});

router.get('/:listId/settings', asyncHandler(async function getDriversSettings(req, res) {
    const actor = await requireApiContext(req, res, true);
    validateOperationRequest(req, 'getDriversSettings');
    sendValidatedJson(req, res, 'getDriversSettings', 200, await driversApi.readDriversSettings(String(req.params.listId), actor));
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

createEntityAdminApiRouter<'drivers'>(router, {
    entityType: 'drivers', parameter: 'listId',
    baseline: {operation: 'getDriversAdminBaseline', requireProfile: false,
        async read({id, profileId, actor}) {
            const data = await driversApi.readDriversAdminBaseline(id, profileId, actor);
            return {data, etag: data.editToken};
        }},
    add: {operation: 'addDriversAdmin', requireProfile: false, delivery: 'controller',
        async execute({id, body, actor, ifMatch}, prepare) {
            await driversApi.setDriversAdmin(id, body.profileId, body.mask, actor, ifMatch, prepare);
        }},
    update: {operation: 'updateDriversAdmin', requireProfile: false, delivery: 'controller',
        async execute({id, profileId, body, actor, ifMatch}, prepare) {
            await driversApi.setDriversAdmin(id, profileId, body.mask, actor, ifMatch, prepare);
        }},
    remove: {operation: 'deleteDriversAdmin', requireProfile: false, delivery: 'controller',
        async execute({id, profileId, actor, ifMatch}, prepare) {
            await driversApi.setDriversAdmin(id, profileId, null, actor, ifMatch, prepare);
        }},
});

createUserSearchApiRouter<'drivers'>(router, {
    entityType: 'drivers', parameter: 'listId',
    search: {operation: 'searchDriversProfiles', requireProfile: false,
        async read({id, query, actor}) {
            return {data: await driversApi.searchDriversProfiles(id, String(query.q ?? ''), actor)};
        }},
});

router.get('/:listId/header/edit-baseline', asyncHandler(async function getDriversHeaderBaseline(req, res) {
    const actor = await requireApiContext(req, res);
    validateOperationRequest(req, 'getDriversHeaderBaseline');
    const baseline = await driversApi.readDriversHeaderBaseline(String(req.params.listId), actor);
    sendValidatedJson(req, res, 'getDriversHeaderBaseline', 200, baseline, baseline.editToken);
}));

createEntityHeaderUpdateRouter(router, {
    parameter: 'listId', uploadOperation: 'uploadDriversHeader', deleteOperation: 'deleteDriversHeader',
    requireProfile: false, admitUpload: driversApi.readDriversHeaderBaseline,
    command: {
        receipt: 'controller',
        execute({id, file, actor, ifMatch}, prepare) {
            return driversApi.setDriversHeader(id, file, actor, ifMatch, prepare);
        },
    },
});

createEntityArchiveApiRouter<'drivers'>(router, {
    entityType: 'drivers', parameter: 'listId',
    archive: {operation: 'archiveDriversList', requireProfile: true, delivery: 'controller',
        async execute({id, actor}, prepare) { await driversApi.setDriversArchived(id, true, actor, prepare); }},
    restore: {operation: 'restoreDriversList', requireProfile: true, delivery: 'controller',
        async execute({id, actor}, prepare) { await driversApi.setDriversArchived(id, false, actor, prepare); }},
});

router.use(createGuestFlowGuestRouter(driversFlow));

export default router;
