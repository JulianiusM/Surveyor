/*
 * Copyright 2026 Julian Malovanij
 * Licensed under the Apache License, Version 2.0.
 */

import {Router, type ErrorRequestHandler, type Request, type Response} from 'express';
import * as activityApi from '../../../controller/activityController';
import type {ActivitySimpleMutationOperation} from '../../../../types/ActivityV1Types';
import {ApiProblem, declaredApiProblem} from '../../../modules/api/problem';
import {APIError} from '../../../modules/lib/errors';
import {RecommendationQueueFullError} from '../../../modules/activity/recommendationJobs';
import {requireApiContext} from '../../../modules/api/session';
import {prepareValidatedJson, sendPreparedJson, sendValidatedJson, validateOperationRequest} from '../../../modules/api/transport';
import {asyncHandler} from '../../../modules/lib/asyncHandler';
import {createEntityAdminApiRouter, createEntityArchiveApiRouter, createEntityPropertyApiRouter,
    createUserSearchApiRouter} from '../../../middleware/adminApiFactory';
import {createGuestFlowApiRouter} from '../../../middleware/guestFlowFactory';
import {activityFlow} from '../../activityFlow';
import {createEntityHeaderUpdateRouter} from '../../../middleware/entityHeaderUpdateHandler';
import {attachAssignRoleRoutes} from '../../../middleware/assignFlowFactory';

const router = Router();
router.use(createGuestFlowApiRouter(activityFlow));

/** Existing basic operations keep their existing transaction/order guarantees.
 * Prepare their invariant receipt before invoking the business owner; delivery
 * performs no mutable-session admission, projection read or automatic replay. */
async function sendActivityMutation(req: Request, res: Response, operation: ActivitySimpleMutationOperation,
    execute: () => Promise<void>): Promise<void> {
    const prepared = prepareValidatedJson(req, operation, 200, {changed: true});
    await execute();
    sendPreparedJson(req, res, prepared);
}

createEntityPropertyApiRouter<'activity'>(router, {
    entityType: 'activity', parameter: 'planId',
    read: {operation: 'getActivityMetadata', requireProfile: false,
        read: ({id, actor}) => activityApi.readActivityMetadata(id, actor)},
    update: {operation: 'updateActivityMetadata', requireProfile: false, delivery: 'controller',
        async execute({id, body, actor, ifMatch}, prepare) {
            const result = await activityApi.patchActivityMetadata(id, body, actor, ifMatch, prepare);
            return {etag: result.etag};
        }},
    event: {operation: 'updateActivityEvent', requireProfile: true, delivery: 'controller',
        async execute({id, body, actor, ifMatch}, prepare) {
            await activityApi.changeActivityEvent(id, body, actor, ifMatch, prepare);
        }},
});

router.get('/:planId/settings', asyncHandler(async function getActivitySettings(req, res) {
    const actor = await requireApiContext(req, res, true);
    validateOperationRequest(req, 'getActivitySettings');
    sendValidatedJson(req, res, 'getActivitySettings', 200, await activityApi.readActivitySettings(String(req.params.planId), actor));
}));

router.get('/:planId/default-permissions', asyncHandler(async function getActivityDefaultsBaseline(req, res) {
    const actor = await requireApiContext(req, res);
    validateOperationRequest(req, 'getActivityDefaultsBaseline');
    const result = await activityApi.readActivityDefaultsBaseline(String(req.params.planId), actor);
    sendValidatedJson(req, res, 'getActivityDefaultsBaseline', 200, result, result.editToken);
}));

createEntityAdminApiRouter<'activity'>(router, {
    entityType: 'activity', parameter: 'planId',
    baseline: {operation: 'getActivityAdminBaseline', requireProfile: false,
        async read({id, profileId, actor}) {
            const data = await activityApi.readActivityAdminBaseline(id, profileId, actor);
            return {data, etag: data.editToken};
        }},
    add: {operation: 'addActivityAdmin', requireProfile: false, delivery: 'invariant', result: {changed: true},
        execute: ({id, body, actor, ifMatch}) => activityApi.setActivityAdmin(id, body.profileId, body.mask, actor, ifMatch)},
    update: {operation: 'updateActivityAdmin', requireProfile: false, delivery: 'invariant', result: {changed: true},
        execute: ({id, profileId, body, actor, ifMatch}) => activityApi.setActivityAdmin(id, profileId, body.mask, actor, ifMatch)},
    remove: {operation: 'deleteActivityAdmin', requireProfile: false, delivery: 'invariant', result: {changed: true},
        execute: ({id, profileId, actor, ifMatch}) => activityApi.setActivityAdmin(id, profileId, null, actor, ifMatch)},
});

router.get('/:planId/header/edit-baseline', asyncHandler(async function getActivityHeaderBaseline(req, res) {
    const actor = await requireApiContext(req, res);
    validateOperationRequest(req, 'getActivityHeaderBaseline');
    const result = await activityApi.readActivityHeaderBaseline(String(req.params.planId), actor);
    sendValidatedJson(req, res, 'getActivityHeaderBaseline', 200, result, result.editToken);
}));

router.get('/:planId/slots/:slotId/edit-baseline', asyncHandler(async function getActivitySlotBaseline(req, res) {
    const actor = await requireApiContext(req, res);
    validateOperationRequest(req, 'getActivitySlotBaseline');
    const result = await activityApi.readActivitySlotBaseline(String(req.params.planId), String(req.params.slotId), actor);
    sendValidatedJson(req, res, 'getActivitySlotBaseline', 200, result, result.editToken);
}));

router.get('/:planId/slot-order', asyncHandler(async function getActivityOrderBaseline(req, res) {
    const actor = await requireApiContext(req, res);
    validateOperationRequest(req, 'getActivityOrderBaseline');
    const result = await activityApi.readActivityOrderBaseline(String(req.params.planId), actor);
    sendValidatedJson(req, res, 'getActivityOrderBaseline', 200, result, result.editToken);
}));

router.put('/:planId/default-permissions', asyncHandler(async function updateActivityDefaults(req, res) {
    const actor = await requireApiContext(req, res);
    // Compare reviewed audience masks before existing permission persistence.
    validateOperationRequest(req, 'updateActivityDefaults');
    await sendActivityMutation(req, res, 'updateActivityDefaults', async function performMutation() {
        await activityApi.setActivityDefaults(String(req.params.planId), req.body, actor, req.get('If-Match'));
    });
}));

router.post('/:planId/slots', asyncHandler(async function addActivitySlot(req, res) {
    const actor = await requireApiContext(req, res);
    // Delegate admitted day, role choices and fields to the existing Quick Add operation.
    validateOperationRequest(req, 'addActivitySlot');
    await sendActivityMutation(req, res, 'addActivitySlot', async function performMutation() {
        await activityApi.createActivitySlot(String(req.params.planId), req.body, actor);
    });
}));

router.patch('/:planId/slots/:slotId', asyncHandler(async function updateActivitySlot(req, res) {
    const actor = await requireApiContext(req, res);
    // Apply sparse granted slot fields with their reviewed token.
    validateOperationRequest(req, 'updateActivitySlot');
    await sendActivityMutation(req, res, 'updateActivitySlot', async function performMutation() {
        await activityApi.patchActivitySlot(String(req.params.planId), String(req.params.slotId), req.body, actor, req.get('If-Match'));
    });
}));

router.delete('/:planId/slots/:slotId', asyncHandler(async function deleteActivitySlot(req, res) {
    const actor = await requireApiContext(req, res);
    // Scope the selected slot before its authorized deletion.
    validateOperationRequest(req, 'deleteActivitySlot');
    await sendActivityMutation(req, res, 'deleteActivitySlot', async function performMutation() {
        await activityApi.removeActivitySlot(String(req.params.planId), String(req.params.slotId), actor);
    });
}));

router.put('/:planId/slot-order', asyncHandler(async function updateActivityOrder(req, res) {
    const actor = await requireApiContext(req, res);
    // Compare reviewed schedule order before persisting submitted positions.
    validateOperationRequest(req, 'updateActivityOrder');
    await sendActivityMutation(req, res, 'updateActivityOrder', async function performMutation() {
        await activityApi.setActivityOrder(String(req.params.planId), req.body, actor, req.get('If-Match'));
    });
}));

attachAssignRoleRoutes(router, {
    path: '/:planId/slots/:slotId/self-assignment',
    entityParameter: 'planId', itemParameter: 'slotId', requireProfile: false,
    // The combined command retains named-role choice, warning confirmation and
    // the original invariant acknowledgement prepared before its business call.
    command: {operation: 'setActivityAssignment', delivery: 'invariant', result: {changed: true},
        execute: ({entityId, itemId, actor, body}) => activityApi.setActivityAssignment(entityId, itemId, body, actor)},
});

router.delete('/:planId/assignments/:assignmentId', asyncHandler(async function removeActivityAssignment(req, res) {
    const actor = await requireApiContext(req, res);
    // Scope the assignment and retain the organizer removal grant.
    validateOperationRequest(req, 'removeActivityAssignment');
    await sendActivityMutation(req, res, 'removeActivityAssignment', async function performMutation() {
        await activityApi.removeActivityAssignment(String(req.params.planId), String(req.params.assignmentId), actor);
    });
}));

router.post('/:planId/roles', asyncHandler(async function addActivityRole(req, res) {
    const actor = await requireApiContext(req, res);
    // Create the named plan role through its existing management policy.
    validateOperationRequest(req, 'addActivityRole');
    await sendActivityMutation(req, res, 'addActivityRole', async function performMutation() {
        await activityApi.createActivityRole(String(req.params.planId), req.body, actor);
    });
}));

router.put('/:planId/slots/:slotId/role-assignments', asyncHandler(async function updateActivityRoleAssignments(req, res) {
    const actor = await requireApiContext(req, res);
    // Replace role holders among current slot assignees through the quota transaction.
    validateOperationRequest(req, 'updateActivityRoleAssignments');
    await sendActivityMutation(req, res, 'updateActivityRoleAssignments', async function performMutation() {
        await activityApi.setActivityRoleAssignments(String(req.params.planId), String(req.params.slotId), req.body, actor);
    });
}));

router.put('/:planId/text-fields/:textFieldId', asyncHandler(async function updateActivityTextField(req, res) {
    const actor = await requireApiContext(req, res);
    // Compare the shared text draft and retain separate text/title permissions.
    validateOperationRequest(req, 'updateActivityTextField');
    await sendActivityMutation(req, res, 'updateActivityTextField', async function performMutation() {
        await activityApi.patchActivityTextField(String(req.params.planId), String(req.params.textFieldId), req.body, actor, req.get('If-Match'));
    });
}));

router.delete('/:planId/text-fields/:textFieldId', asyncHandler(async function deleteActivityTextField(req, res) {
    const actor = await requireApiContext(req, res);
    // Scope the shared field before management-only removal.
    validateOperationRequest(req, 'deleteActivityTextField');
    await sendActivityMutation(req, res, 'deleteActivityTextField', async function performMutation() {
        await activityApi.removeActivityTextField(String(req.params.planId), String(req.params.textFieldId), actor);
    });
}));

createEntityArchiveApiRouter<'activity'>(router, {
    entityType: 'activity', parameter: 'planId',
    archive: {operation: 'archiveActivityPlan', requireProfile: false, delivery: 'invariant', result: {changed: true},
        execute: ({id, actor}) => activityApi.setActivityArchived(id, true, actor)},
    restore: {operation: 'restoreActivityPlan', requireProfile: false, delivery: 'invariant', result: {changed: true},
        execute: ({id, actor}) => activityApi.setActivityArchived(id, false, actor)},
    automatic: {operation: 'setActivityAutomaticArchival', requireProfile: true, delivery: 'invariant', result: {changed: true},
        execute: ({id, body, actor}) => activityApi.setActivityAutomaticArchival(id, body, actor)},
});

createEntityHeaderUpdateRouter(router, {
    parameter: 'planId', uploadOperation: 'uploadActivityHeader', deleteOperation: 'deleteActivityHeader',
    requireProfile: false, admitUpload: activityApi.readActivityHeaderBaseline,
    command: {
        receipt: 'before-write',
        execute({id, file, actor, ifMatch}) {
            return activityApi.setActivityHeader(id, file, actor, ifMatch);
        },
    },
});

createUserSearchApiRouter<'activity'>(router, {
    entityType: 'activity', parameter: 'planId',
    search: {operation: 'searchActivityProfiles', requireProfile: false,
        async read({id, query, actor}) {
            return {data: await activityApi.searchActivityProfiles(id, String(query.q ?? ''), actor)};
        }},
});

router.post('/:planId/slots/:slotId/warnings', asyncHandler(async function previewActivityAssignment(req, res) {
    const actor = await requireApiContext(req, res, true);
    validateOperationRequest(req, 'previewActivityAssignment');
    sendValidatedJson(req, res, 'previewActivityAssignment', 200,
        await activityApi.previewActivityAssignment(String(req.params.planId), String(req.params.slotId), req.body, actor));
}));

router.post('/:planId/text-fields', asyncHandler(async function addActivityTextField(req, res) {
    const actor = await requireApiContext(req, res);
    // Create shared plan text through its existing management operation.
    validateOperationRequest(req, 'addActivityTextField');
    await sendActivityMutation(req, res, 'addActivityTextField', async function createText() {
        await activityApi.createActivityTextField(String(req.params.planId), req.body, actor);
    });
}));

router.get('/:planId/requirements', asyncHandler(async function getActivityRequirements(req, res) {
    const actor = await requireApiContext(req, res);
    // Requirements remain a private management projection with generated scalar validation.
    validateOperationRequest(req, 'getActivityRequirements');
    sendValidatedJson(req, res, 'getActivityRequirements', 200,
        await activityApi.readActivityRequirements(String(req.params.planId), actor));
}));

router.put('/:planId/requirements', asyncHandler(async function updateActivityRequirements(req, res) {
    const actor = await requireApiContext(req, res);
    // Prepare the invariant receipt before the existing shared settings transaction.
    validateOperationRequest(req, 'updateActivityRequirements');
    await sendActivityMutation(req, res, 'updateActivityRequirements', async function saveRequirements() {
        await activityApi.saveActivityRequirements(String(req.params.planId), req.body, actor);
    });
}));

router.get('/:planId/recommendations', asyncHandler(async function getActivityRecommendations(req, res) {
    const actor = await requireApiContext(req, res);
    // This recovery snapshot cannot maintain proposals or enqueue automatic work.
    validateOperationRequest(req, 'getActivityRecommendations');
    sendValidatedJson(req, res, 'getActivityRecommendations', 200,
        await activityApi.readActivityRecommendations(String(req.params.planId), actor));
}));

router.post('/:planId/recommendations/entry', asyncHandler(async function enterActivityRecommendations(req, res) {
    const actor = await requireApiContext(req, res);
    // Deliberate existing-equivalent workspace entry retains maintenance and possible enqueue.
    validateOperationRequest(req, 'enterActivityRecommendations');
    sendValidatedJson(req, res, 'enterActivityRecommendations', 200,
        await activityApi.readActivityRecommendations(String(req.params.planId), actor, true));
}));

router.post('/:planId/recommendations/warnings', asyncHandler(async function previewActivityRecommendations(req, res) {
    const actor = await requireApiContext(req, res);
    // Preview is read-only but carries the exact draft and captured actor's CSRF context.
    validateOperationRequest(req, 'previewActivityRecommendations');
    sendValidatedJson(req, res, 'previewActivityRecommendations', 200,
        await activityApi.previewActivityRecommendations(String(req.params.planId), req.body, actor));
}));

router.post('/:planId/recommendations/apply', asyncHandler(async function applyActivityRecommendations(req, res) {
    const actor = await requireApiContext(req, res);
    // Apply once through the existing controller; no postcommit read renews admission.
    validateOperationRequest(req, 'applyActivityRecommendations');
    sendValidatedJson(req, res, 'applyActivityRecommendations', 200,
        await activityApi.applyActivityRecommendations(String(req.params.planId), req.body, actor));
}));

router.post('/:planId/recommendations/auto', asyncHandler(async function generateActivityRecommendations(req, res) {
    const actor = await requireApiContext(req, res);
    // Explicit dispatch returns the coordinator's identity, including coalesced work.
    validateOperationRequest(req, 'generateActivityRecommendations');
    sendValidatedJson(req, res, 'generateActivityRecommendations', 202,
        await activityApi.generateActivityRecommendations(String(req.params.planId), actor));
}));

router.get('/:planId/recommendations/auto/:jobId', asyncHandler(async function getActivityRecommendationJob(req, res) {
    const actor = await requireApiContext(req, res);
    // Poll only the specified domain job; this endpoint cannot dispatch recommendations.
    validateOperationRequest(req, 'getActivityRecommendationJob');
    sendValidatedJson(req, res, 'getActivityRecommendationJob', 200,
        await activityApi.readActivityRecommendationJob(String(req.params.planId), String(req.params.jobId), actor));
}));

/** Existing Activity owners report stale warning reviews, full slots and other
 * domain conflicts as existing APIError(409). Adapt that trusted class/status at
 * this feature boundary; never expose existing prose/data or reinterpret an
 * arbitrary status-shaped exception. Existing declared Problems keep their code. */
const activityConflict: ErrorRequestHandler = function activityConflict(error, _req, res, next) {
    // Only the existing queue's trusted cause supplies the existing bounded retry advice.
    if (error instanceof APIError && error.cause instanceof RecommendationQueueFullError) {
        res.set('Retry-After', '5');
        next(new ApiProblem('RECOMMENDATION_QUEUE_FULL'));
        return;
    }
    // Shared controller causes identify the actual failed requirement. Preserve
    // that declared status/message before the generic conflict fallback.
    const declared = declaredApiProblem(error);
    if (declared) {
        next(declared);
        return;
    }
    // The shared versioned classifier cannot infer each feature's generic 409.
    // Activity's existing conflict result maps to its stable safe contract here.
    next(error instanceof APIError && !(error instanceof ApiProblem) && error.status === 409
        ? new ApiProblem('RESOURCE_CONFLICT') : error);
};
router.use(activityConflict);

export default router;
