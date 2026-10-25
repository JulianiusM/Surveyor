import {Router} from 'express';
import type {Request, Response} from 'express';
import {asyncHandler} from '../modules/lib/asyncHandler';
import {captureApiActor} from '../modules/api/session';
import {renderFrontend} from '../modules/frontendRenderer';
import {readDriversCreateEntry, readDriversDuplicate, readDriversResourceEntry} from '../controller/driversController';
import {bootstrap, applyPageEntry} from './frontend';
import {createHeaderHandler} from './outputs';
import {readDriversHeaderPath} from '../controller/driversController';

const router = Router();
router.get('/create', asyncHandler(renderCreation));
router.get('/:listId/duplicate', asyncHandler(renderDuplicate));
for (const [path, intent] of [['/:listId', 'detail'], ['/:listId/guest', 'guest']] as const) {
    /** The registered detail/guest route owns admission regardless of the
     * equivalent URL spelling accepted by Express. */
    router.get(path, asyncHandler(async function renderList(req, res) {
        const state = await bootstrap(req);
        // Keep controller authorization and original return URL unchanged;
        // selecting this presentation never creates a guest identity.
        const result = await readDriversResourceEntry(String(req.params.listId), intent, await captureApiActor(req));
        if (await applyPageEntry(req, res, state, result.entry)) return;
        state.guestEntry = result.guest ?? undefined;
        await renderFrontend(res, req.originalUrl, state);
    }));
}

/** Capture account admission and optional event selection before rendering. */
async function renderCreation(req: Request, res: Response): Promise<void> {
    const state = await bootstrap(req);
    const form = await readDriversCreateEntry(await captureApiActor(req), req.originalUrl, req.query.eventId);
    if (await applyPageEntry(req, res, state, form.entry)) return;
    state.driversCreateContext = form.context ?? undefined;
    state.driversSelectedEvent = form.selectedEvent ?? null;
    await renderFrontend(res, req.originalUrl, state);
}

/** Duplication reads form values under its independent grant, without copying rides. */
async function renderDuplicate(req: Request, res: Response): Promise<void> {
    const state = await bootstrap(req);
    state.driversDuplicate = await readDriversDuplicate(String(req.params.listId), await captureApiActor(req), req.query.eventId);
    state.pageEntry = {kind: 'render'};
    await renderFrontend(res, req.originalUrl, state);
}

router.get('/:headerId/header', createHeaderHandler(readDriversHeaderPath));

export default router;
