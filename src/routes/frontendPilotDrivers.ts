import {Router} from 'express';
import type {Request, Response} from 'express';
import type {FrontendEntityDocumentHooks} from '../types/FrontendEntityDocumentTypes';
import {asyncHandler} from '../modules/lib/asyncHandler';
import {captureApiActor} from '../modules/api/session';
import {renderFrontendPilot} from '../modules/frontendPilotRenderer';
import {readDriversCreateEntry, readDriversDuplicate, readDriversResourceEntry} from '../controller/driversController';

/** Initial Drivers documents use the same controller admission as warm SPA visits.
 * Ordinary creation and ride commands belong to their generated API operations;
 * these routes only prepare the admitted shell and existing form seed. */
export function createDriversPilotRouter(hooks: FrontendEntityDocumentHooks): Router {
    const router = Router();
    router.get('/create', asyncHandler(renderCreation));
    router.get('/:listId/duplicate', asyncHandler(renderDuplicate));
    router.get(['/:listId', '/:listId/guest'], asyncHandler(renderList));

    /** Capture account admission and optional event selection before rendering. */
    async function renderCreation(req: Request, res: Response): Promise<void> {
        const state = await hooks.bootstrap(req);
        const form = await readDriversCreateEntry(await captureApiActor(req), req.originalUrl, req.query.eventId);
        if (await hooks.applyPageEntry(req, res, state, form.entry)) return;
        state.driversCreateContext = form.context ?? undefined;
        state.driversSelectedEvent = form.selectedEvent ?? null;
        await renderFrontendPilot(res, req.originalUrl, state);
    }

    /** Duplication reads form values under its independent grant, without copying rides. */
    async function renderDuplicate(req: Request, res: Response): Promise<void> {
        const state = await hooks.bootstrap(req);
        state.driversDuplicate = await readDriversDuplicate(String(req.params.listId), await captureApiActor(req), req.query.eventId);
        state.pageEntry = {kind: 'render'};
        await renderFrontendPilot(res, req.originalUrl, state);
    }

    /** Guest and detail visits share read-only admission without creating identity. */
    async function renderList(req: Request, res: Response): Promise<void> {
        const state = await hooks.bootstrap(req);
        const intent = req.path.endsWith('/guest') ? 'guest' : 'detail';
        const result = await readDriversResourceEntry(String(req.params.listId), intent, await captureApiActor(req));
        if (await hooks.applyPageEntry(req, res, state, result.entry)) return;
        state.guestEntry = result.guest ?? undefined;
        await renderFrontendPilot(res, req.originalUrl, state);
    }

    return router;
}
