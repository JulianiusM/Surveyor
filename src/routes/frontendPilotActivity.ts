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
    for (const [path, intent] of [['/:planId', 'detail'], ['/:planId/guest', 'guest']] as const) {
        /** The registered detail/guest route owns admission regardless of the
         * equivalent URL spelling accepted by Express. */
        router.get(path, asyncHandler(async function renderPlan(req, res) {
            const state = await hooks.bootstrap(req);
            // Keep controller authorization and original return URL unchanged;
            // selecting this presentation never creates a guest identity.
            const result = await readActivityResourceEntry(String(req.params.planId), intent, await captureApiActor(req));
            if (await hooks.applyPageEntry(req, res, state, result.entry)) return;
            state.guestEntry = result.guest ?? undefined;
            await renderFrontendPilot(res, req.originalUrl, state);
        }));
    }

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

    return router;
}
