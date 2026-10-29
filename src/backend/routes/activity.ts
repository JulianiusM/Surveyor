import type {Request} from 'express';
import * as activityController from '../controller/activityController';
import {canAccessEntityView} from '../modules/event/linkage';
import {paramHandler} from '../middleware/paramHandler';
import {requirePermission} from '../middleware/permissionMiddleware';
import * as activityService from '../modules/database/services/ActivityService';
import {ExpectedError} from '../modules/lib/errors';
import {getResource} from '../modules/lib/util';
import {PERM} from '../modules/lib/permissions';
import type {EntityDescriptor} from '../../types/PermissionTypes';
import {asyncHandler} from '../modules/lib/asyncHandler';
import {createGuestFlowHeaderRouter, createGuestFlowRouter} from '../middleware/guestFlowFactory';
import {activityFlow} from './activityFlow';
import {captureApiActor} from '../modules/api/session';
import {renderNativeDocument} from '../middleware/frontendDocuments';

const router = createGuestFlowRouter(activityFlow);

// Only the independent print route uses this loaded entity. Interactive and
// header reads continue through their existing controller admission.
paramHandler('id', router, activityService.getActivityPlanById, 'activity');

router.use(createGuestFlowHeaderRouter(activityFlow));

function activityPermission(req: Request): EntityDescriptor {
    const resource = getResource(req, 'activity');
    return {entityType: 'activity', entityId: resource.id, ownerId: resource.ownerId, eventId: resource.eventId};
}

router.get('/:id/export/schedule', asyncHandler(async function admitSchedule(req, res, next) {
    const plan = getResource(req, 'activity');
    const actor = await captureApiActor(req);
    // Preserve document admission before the independent export grant.
    if (plan.event) {
        if (!await canAccessEntityView('activity', {...plan, eventId: plan.event.id}, actor)) {
            throw new ExpectedError('You must be registered for the event to access this resource');
        }
    } else if (!actor.profile) {
        res.redirect(`/activity/${encodeURIComponent(plan.id)}/guest`);
        return;
    }
    next();
}), requirePermission(activityPermission, PERM.DATA_EXPORT), asyncHandler(async function exportSchedule(req, res) {
    // Print remains an independent output with its established data and stylesheet.
    const data = await activityController.getScheduleExport(getResource(req, 'activity'), req.query.windowStart);
    await renderNativeDocument(req, res, 'activity/export/schedule', {data});
}));

export default router;
