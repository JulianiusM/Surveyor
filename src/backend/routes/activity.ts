import {Router} from 'express';
import type {Request, Response} from 'express';
import activityController, {readActivityCreateEntry, readActivityDuplicate,
    readActivityResourceEntry, readActivityHeaderPath} from '../controller/activityController';
import {canAccessEntityView} from '../controller/entityAdminController';
import {paramHandler} from '../middleware/paramHandler';
import {requirePermission} from '../middleware/permissionMiddleware';
import * as activityService from '../modules/database/services/ActivityService';
import {ExpectedError} from '../modules/lib/errors';
import {getResource} from '../modules/lib/util';
import {PERM} from '../modules/lib/permissions';
import type {EntityDescriptor} from '../../types/PermissionTypes';
import {asyncHandler} from '../modules/lib/asyncHandler';
import {captureApiActor} from '../modules/api/session';
import {renderFrontend} from '../modules/frontendRenderer';
import {bootstrap, applyPageEntry} from './frontend';
import {createHeaderHandler} from './outputs';

const router = Router();

// Only the independent print route uses this loaded entity. Interactive and
// header reads continue through their existing controller admission.
paramHandler('id', router, activityService.getActivityPlanById, 'activity');

router.get('/create', asyncHandler(renderCreation));
router.get('/:planId/duplicate', asyncHandler(renderDuplicate));
for (const [path, intent] of [['/:planId', 'detail'], ['/:planId/guest', 'guest']] as const) {
    /** The registered detail/guest route owns admission regardless of the
     * equivalent URL spelling accepted by Express. */
    router.get(path, asyncHandler(async function renderPlan(req, res) {
        const state = await bootstrap(req);
        // Keep controller authorization and original return URL unchanged;
        // selecting this presentation never creates a guest identity.
        const result = await readActivityResourceEntry(String(req.params.planId), intent, await captureApiActor(req));
        if (await applyPageEntry(req, res, state, result.entry)) return;
        state.guestEntry = result.guest ?? undefined;
        await renderFrontend(res, req.originalUrl, state);
    }));
}

/** Resolve account admission and the optional Event before seeding a draft. */
async function renderCreation(req: Request, res: Response): Promise<void> {
    const state = await bootstrap(req);
    const form = await readActivityCreateEntry(await captureApiActor(req), req.originalUrl, req.query.eventId);
    if (await applyPageEntry(req, res, state, form.entry)) return;
    state.activityCreateContext = form.context ?? undefined;
    state.activitySelectedEvent = form.selectedEvent ?? null;
    await renderFrontend(res, req.originalUrl, state);
}

/** Duplication copies the existing form projection without assignments/history. */
async function renderDuplicate(req: Request, res: Response): Promise<void> {
    const state = await bootstrap(req);
    state.activityDuplicate = await readActivityDuplicate(String(req.params.planId), await captureApiActor(req), req.query.eventId);
    state.pageEntry = {kind: 'render'};
    await renderFrontend(res, req.originalUrl, state);
}

router.get('/:headerId/header', createHeaderHandler(readActivityHeaderPath));

function activityPermission(req: Request): EntityDescriptor {
    const resource = getResource(req, 'activity');
    return {entityType: 'activity', entityId: resource.id, ownerId: resource.ownerId, eventId: resource.eventId};
}

router.get('/:id/export/schedule', asyncHandler(async function admitSchedule(req, res, next) {
    const plan = getResource(req, 'activity');
    // Preserve document admission before the independent export grant.
    if (plan.event) {
        if (!await canAccessEntityView('activity', {...plan, eventId: plan.event.id}, req.session)) {
            throw new ExpectedError('You must be registered for the event to access this resource');
        }
    } else if (!req.session.profile) {
        res.redirect(`/activity/${encodeURIComponent(plan.id)}/guest`);
        return;
    }
    next();
}), requirePermission(activityPermission, PERM.DATA_EXPORT), asyncHandler(async function exportSchedule(req, res) {
    // Print remains an independent output with its established data and stylesheet.
    const data = await activityController.getScheduleExport(getResource(req, 'activity'));
    res.render('activity/export/schedule', {data});
}));

export default router;
