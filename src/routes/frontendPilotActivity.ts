import {Router} from 'express';
import type {Request, Response} from 'express';
import type {FrontendEntityDocumentHooks} from '../types/FrontendEntityDocumentTypes';
import {asyncHandler} from '../modules/lib/asyncHandler';
import {captureApiActor} from '../modules/api/session';
import {renderFrontendPilot} from '../modules/frontendPilotRenderer';
import {readActivityCreateEntry, readActivityDuplicate, readActivityResourceEntry} from '../controller/activityController';

/** Activity document arrivals share admission with mounted navigation. The
 * printable schedule keeps its existing independent authorized document route. */
export function createActivityPilotRouter(hooks: FrontendEntityDocumentHooks): Router {
    const router = Router();
    router.get('/create', asyncHandler(renderCreation));
    router.get('/:planId/duplicate', asyncHandler(renderDuplicate));
    router.get(['/:planId', '/:planId/guest'], asyncHandler(renderPlan));

    /** Resolve account admission and the optional Event before seeding a draft. */
    async function renderCreation(req: Request, res: Response): Promise<void> {
        const state = await hooks.bootstrap(req);
        const form = await readActivityCreateEntry(await captureApiActor(req), req.originalUrl, req.query.eventId);
        if (await hooks.applyPageEntry(req, res, state, form.entry)) return;
        state.activityCreateContext = form.context ?? undefined;
        state.activitySelectedEvent = form.selectedEvent ?? null;
        await renderFrontendPilot(res, req.originalUrl, state);
    }

    /** Duplication copies the existing form projection without assignments/history. */
    async function renderDuplicate(req: Request, res: Response): Promise<void> {
        const state = await hooks.bootstrap(req);
        state.activityDuplicate = await readActivityDuplicate(String(req.params.planId), await captureApiActor(req), req.query.eventId);
        state.pageEntry = {kind: 'render'};
        await renderFrontendPilot(res, req.originalUrl, state);
    }

    /** Detail and guest arrivals admit the current actor without creating identity. */
    async function renderPlan(req: Request, res: Response): Promise<void> {
        const state = await hooks.bootstrap(req);
        const intent = req.path.endsWith('/guest') ? 'guest' : 'detail';
        const result = await readActivityResourceEntry(String(req.params.planId), intent, await captureApiActor(req));
        if (await hooks.applyPageEntry(req, res, state, result.entry)) return;
        state.guestEntry = result.guest ?? undefined;
        await renderFrontendPilot(res, req.originalUrl, state);
    }

    return router;
}
