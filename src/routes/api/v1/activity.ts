/*
 * Copyright 2026 Julian Malovanij
 * Licensed under the Apache License, Version 2.0.
 */

import {Router, type ErrorRequestHandler, type Request, type Response} from 'express';
import * as activityApi from '../../../controller/activityController';
import type {components} from '../../../types/api/v1';
import type {PreparedApiJsonResponse} from '../../../types/ApiTransportTypes';
import type {ActivitySimpleMutationOperation} from '../../../types/ActivityV1Types';
import {ApiProblem, declaredApiProblem} from '../../../modules/api/problem';
import {APIError} from '../../../modules/lib/errors';
import {RecommendationQueueFullError} from '../../../modules/activity/recommendationJobs';
import {requireApiContext} from '../../../modules/api/session';
import {decodeApiMultipartData, decodeApiMultipartImage, prepareValidatedJson, receiveApiUpload, sendPreparedJson, sendStoredApiBinary, sendValidatedJson, validateOperationRequest} from '../../../modules/api/transport';
import {asyncHandler} from '../../../modules/lib/asyncHandler';
import {prepareFileUploader, removeImage} from '../../../modules/lib/fileCommons';
import {searchLimiter} from '../../../middleware/adminApiFactory';
import settings from '../../../modules/settings';

const router = Router();
const uploadHeader = prepareFileUploader(settings.value.headerImgDir).single('image');

/** Existing basic operations keep their existing transaction/order guarantees.
 * Prepare their invariant receipt before invoking the business owner; delivery
 * performs no mutable-session admission, projection read or automatic replay. */
async function sendActivityMutation(req: Request, res: Response, operation: ActivitySimpleMutationOperation,
    execute: () => Promise<void>): Promise<void> {
    const prepared = prepareValidatedJson(req, operation, 200, {changed: true});
    await execute();
    sendPreparedJson(req, res, prepared);
}

router.get('/create-entry', asyncHandler(async function getActivityCreateEntry(req, res) {
    const actor = await requireApiContext(req, res);
    validateOperationRequest(req, 'getActivityCreateEntry');
    sendValidatedJson(req, res, 'getActivityCreateEntry', 200, await activityApi.readActivityCreateEntry(actor, req.query.returnTo, req.query.eventId));
}));

router.get('/create-context', asyncHandler(async function getActivityCreateContext(req, res) {
    const actor = await requireApiContext(req, res, true);
    validateOperationRequest(req, 'getActivityCreateContext');
    sendValidatedJson(req, res, 'getActivityCreateContext', 200, activityApi.readActivityCreateContext(actor));
}));

router.get('/events', asyncHandler(async function searchActivityEvents(req, res) {
    const actor = await requireApiContext(req, res, true);
    validateOperationRequest(req, 'searchActivityEvents');
    sendValidatedJson(req, res, 'searchActivityEvents', 200, await activityApi.searchActivityEvents(req.query, actor));
}));

router.post('/', asyncHandler(async function createActivityPlan(req, res) {
    const actor = await requireApiContext(req, res, true);
    activityApi.readActivityCreateContext(actor);
    let committed = false;
    let prepared: PreparedApiJsonResponse;
    try {
        await receiveApiUpload(req, res, uploadHeader);
        validateOperationRequest(req, 'createActivityPlan', body => decodeApiMultipartData(body, req.file));
        function retainPersistedImage(): void { committed = true; }
        function prepareCreated(data: components['schemas']['ActivityCreated']): void {
            prepared = prepareValidatedJson(req, 'createActivityPlan', 201, data);
        }
        await activityApi.createActivityPlan(req.body.data as components['schemas']['ActivityCreateInput'], req.file, actor, prepareCreated, retainPersistedImage);
        sendPreparedJson(req, res, prepared!);
    } finally {
        // A persisted upload belongs to the plan even when delivery is interrupted.
        if (!committed && req.file) removeImage(req.file.path);
    }
}));

router.get('/:planId/entry', asyncHandler(async function getActivityResourceEntry(req, res) {
    const actor = await requireApiContext(req, res);
    validateOperationRequest(req, 'getActivityResourceEntry');
    sendValidatedJson(req, res, 'getActivityResourceEntry', 200,
        await activityApi.readActivityResourceEntry(String(req.params.planId), req.query.view as 'detail' | 'guest', actor));
}));

router.get('/:planId', asyncHandler(async function getActivityPlan(req, res) {
    const actor = await requireApiContext(req, res, true);
    validateOperationRequest(req, 'getActivityPlan');
    const result = await activityApi.readActivityPlan(String(req.params.planId), actor);
    sendValidatedJson(req, res, 'getActivityPlan', 200, result.data, result.etag);
}));

router.get('/:planId/duplicate', asyncHandler(async function getActivityDuplicate(req, res) {
    const actor = await requireApiContext(req, res);
    validateOperationRequest(req, 'getActivityDuplicate');
    sendValidatedJson(req, res, 'getActivityDuplicate', 200, await activityApi.readActivityDuplicate(String(req.params.planId), actor, req.query.eventId));
}));

router.get('/:planId/metadata', asyncHandler(async function getActivityMetadata(req, res) {
    const actor = await requireApiContext(req, res);
    validateOperationRequest(req, 'getActivityMetadata');
    const result = await activityApi.readActivityMetadata(String(req.params.planId), actor);
    sendValidatedJson(req, res, 'getActivityMetadata', 200, result.data, result.etag);
}));

router.patch('/:planId/metadata', asyncHandler(async function updateActivityMetadata(req, res) {
    const actor = await requireApiContext(req, res);
    // Apply granted metadata and prepare its DTO inside the existing root transaction.
    validateOperationRequest(req, 'updateActivityMetadata');
    let prepared: PreparedApiJsonResponse;
    function prepareMetadata(data: components['schemas']['ActivityMetadata']): void {
        prepared = prepareValidatedJson(req, 'updateActivityMetadata', 200, data);
    }
    const result = await activityApi.patchActivityMetadata(String(req.params.planId), req.body, actor, req.get('If-Match'), prepareMetadata);
    res.set('ETag', result.etag);
    sendPreparedJson(req, res, prepared!);
}));

router.get('/:planId/settings', asyncHandler(async function getActivitySettings(req, res) {
    const actor = await requireApiContext(req, res, true);
    validateOperationRequest(req, 'getActivitySettings');
    sendValidatedJson(req, res, 'getActivitySettings', 200, await activityApi.readActivitySettings(String(req.params.planId), actor));
}));

router.put('/:planId/event', asyncHandler(async function updateActivityEvent(req, res) {
    const actor = await requireApiContext(req, res, true);
    // Delegate current parent authority and prepare the admission result inside the shared relink transaction.
    validateOperationRequest(req, 'updateActivityEvent');
    let prepared: PreparedApiJsonResponse;
    function prepareEvent(data: components['schemas']['ActivityEventChanged']): void {
        prepared = prepareValidatedJson(req, 'updateActivityEvent', 200, data);
    }
    await activityApi.changeActivityEvent(String(req.params.planId), req.body, actor, req.get('If-Match'), prepareEvent);
    sendPreparedJson(req, res, prepared!);
}));

router.get('/:planId/default-permissions', asyncHandler(async function getActivityDefaultsBaseline(req, res) {
    const actor = await requireApiContext(req, res);
    validateOperationRequest(req, 'getActivityDefaultsBaseline');
    const result = await activityApi.readActivityDefaultsBaseline(String(req.params.planId), actor);
    sendValidatedJson(req, res, 'getActivityDefaultsBaseline', 200, result, result.editToken);
}));

router.get('/:planId/admins/:profileId/edit-baseline', asyncHandler(async function getActivityAdminBaseline(req, res) {
    const actor = await requireApiContext(req, res);
    validateOperationRequest(req, 'getActivityAdminBaseline');
    const result = await activityApi.readActivityAdminBaseline(String(req.params.planId), String(req.params.profileId), actor);
    sendValidatedJson(req, res, 'getActivityAdminBaseline', 200, result, result.editToken);
}));

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

router.post('/:planId/admins', asyncHandler(async function addActivityAdmin(req, res) {
    const actor = await requireApiContext(req, res);
    // Check the reviewed grant before the shared administrator owner adds it.
    validateOperationRequest(req, 'addActivityAdmin');
    await sendActivityMutation(req, res, 'addActivityAdmin', async function performMutation() {
        await activityApi.setActivityAdmin(String(req.params.planId), req.body.profileId, req.body.mask, actor, req.get('If-Match'));
    });
}));

router.patch('/:planId/admins/:profileId', asyncHandler(async function updateActivityAdmin(req, res) {
    const actor = await requireApiContext(req, res);
    // Compare this administrator mask before the shared update operation.
    validateOperationRequest(req, 'updateActivityAdmin');
    await sendActivityMutation(req, res, 'updateActivityAdmin', async function performMutation() {
        await activityApi.setActivityAdmin(String(req.params.planId), String(req.params.profileId), req.body.mask, actor, req.get('If-Match'));
    });
}));

router.delete('/:planId/admins/:profileId', asyncHandler(async function deleteActivityAdmin(req, res) {
    const actor = await requireApiContext(req, res);
    // Remove only the reviewed scoped administrator grant.
    validateOperationRequest(req, 'deleteActivityAdmin');
    await sendActivityMutation(req, res, 'deleteActivityAdmin', async function performMutation() {
        await activityApi.setActivityAdmin(String(req.params.planId), String(req.params.profileId), null, actor, req.get('If-Match'));
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

router.put('/:planId/slots/:slotId/self-assignment', asyncHandler(async function setActivityAssignment(req, res) {
    const actor = await requireApiContext(req, res);
    // Delegate desired self membership, named roles and exact warning confirmation.
    validateOperationRequest(req, 'setActivityAssignment');
    await sendActivityMutation(req, res, 'setActivityAssignment', async function performMutation() {
        await activityApi.setActivityAssignment(String(req.params.planId), String(req.params.slotId), req.body, actor);
    });
}));

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

router.post('/:planId/archive', asyncHandler(async function archiveActivityPlan(req, res) {
    const actor = await requireApiContext(req, res);
    // Archive through the shared lifecycle owner while retaining records and files.
    validateOperationRequest(req, 'archiveActivityPlan');
    await sendActivityMutation(req, res, 'archiveActivityPlan', async function performMutation() {
        await activityApi.setActivityArchived(String(req.params.planId), true, actor);
    });
}));

router.put('/:planId/automatic-archive', asyncHandler(async function setActivityAutomaticArchival(req, res) {
    const actor = await requireApiContext(req, res, true);
    // Scheduling remains distinct from archive/restore: only the existing shared
    // owner decides whether this root has an independent automatic schedule.
    validateOperationRequest(req, 'setActivityAutomaticArchival');
    await sendActivityMutation(req, res, 'setActivityAutomaticArchival', async function setSchedule() {
        await activityApi.setActivityAutomaticArchival(String(req.params.planId), req.body, actor);
    });
}));

router.post('/:planId/restore', asyncHandler(async function restoreActivityPlan(req, res) {
    const actor = await requireApiContext(req, res);
    // Restore through the shared lifecycle owner and preserve inherited event state.
    validateOperationRequest(req, 'restoreActivityPlan');
    await sendActivityMutation(req, res, 'restoreActivityPlan', async function performMutation() {
        await activityApi.setActivityArchived(String(req.params.planId), false, actor);
    });
}));

router.delete('/:planId', asyncHandler(async function deleteActivityPlan(req, res) {
    const actor = await requireApiContext(req, res);
    // Require profile ownership before existing permanent deletion.
    validateOperationRequest(req, 'deleteActivityPlan');
    await sendActivityMutation(req, res, 'deleteActivityPlan', async function performMutation() {
        await activityApi.deleteActivityPlan(String(req.params.planId), actor);
    });
}));

router.delete('/:planId/header', asyncHandler(async function deleteActivityHeader(req, res) {
    const actor = await requireApiContext(req, res);
    // Compare the reviewed header before image removal and cleanup.
    validateOperationRequest(req, 'deleteActivityHeader');
    await sendActivityMutation(req, res, 'deleteActivityHeader', async function performMutation() {
        await activityApi.setActivityHeader(String(req.params.planId), undefined, actor, req.get('If-Match'));
    });
}));

/** Profile discovery retains the existing per-IP limiter after authoritative context admission. */
async function admitProfileSearch(req: Request, res: Response, next: import('express').NextFunction): Promise<void> {
    await requireApiContext(req, res);
    validateOperationRequest(req, 'searchActivityProfiles');
    next();
}

router.get('/:planId/profiles', asyncHandler(admitProfileSearch), searchLimiter, asyncHandler(async function searchActivityProfiles(req, res) {
    sendValidatedJson(req, res, 'searchActivityProfiles', 200,
        await activityApi.searchActivityProfiles(String(req.params.planId), String(req.query.q ?? ''), req.apiActor!));
}));

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

router.put('/:planId/header', asyncHandler(async function uploadActivityHeader(req, res) {
    const actor = await requireApiContext(req, res);
    // Reject forbidden upload callers before writing bytes; the feature owner
    // independently authorizes its existing image operation after decoding.
    await activityApi.readActivityHeaderBaseline(String(req.params.planId), actor);
    let committed = false;
    try {
        await receiveApiUpload(req, res, uploadHeader);
        validateOperationRequest(req, 'uploadActivityHeader', body => decodeApiMultipartImage(body, req.file));
        if (!req.file) throw new ApiProblem('UPLOAD_INVALID');
        await sendActivityMutation(req, res, 'uploadActivityHeader', async function replaceHeader() {
            await activityApi.setActivityHeader(String(req.params.planId), req.file, actor, req.get('If-Match'));
            committed = true;
        });
    } finally {
        // Delivery failure after persistence does not delete the plan's new image.
        if (!committed && req.file) removeImage(req.file.path);
    }
}));

router.get('/:planId/header', asyncHandler(async function getActivityHeader(req, res) {
    const actor = await requireApiContext(req, res, true);
    validateOperationRequest(req, 'getActivityHeader');
    const storedPath = await activityApi.readActivityHeaderPath(String(req.params.planId), actor);
    // Resolve and confine the stored reference before accessing its bytes.
    await sendStoredApiBinary(req, res, 'getActivityHeader', 200, settings.value.headerImgDir, storedPath);
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
