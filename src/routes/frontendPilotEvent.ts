import {Router} from 'express';
import type {Request, Response} from 'express';
import type {FrontendEntityDocumentHooks} from '../types/FrontendEntityDocumentTypes';
import {asyncHandler} from '../modules/lib/asyncHandler';
import {captureApiActor} from '../modules/api/session';
import {renderFrontendPilot} from '../modules/frontendPilotRenderer';
import {readEventCreateEntry, readEventDuplicate, readEventResourceEntry} from '../controller/eventController';

/**
 * Keep initial Event GET admission and same-tree SSR with its feature. Vue
 * commands use the generated JSON/multipart API; there is no second ordinary
 * browser POST creation path beside that captured command owner.
 */
export function createEventPilotRouter(hooks: FrontendEntityDocumentHooks): Router {
    const router = Router();
    router.get('/create', asyncHandler(renderCreation));
    router.get('/:eventId/duplicate', asyncHandler(renderDuplicate));
    router.get('/:eventId/register', function registerAlias(req, res) {
        const query = typeof req.query.regToken === 'string' ? `?${new URLSearchParams({regToken: req.query.regToken})}` : '';
        res.redirect(`/frontend-pilot/event/${encodeURIComponent(String(req.params.eventId))}${query}`);
    });
    for (const [path, view] of [['/:eventId', 'detail'], ['/:eventId/guest', 'guest'], ['/:eventId/admin', 'admin']] as const) {
        /** Detail, guest and administration retain their registered intent even
         * when Express accepts a different case or trailing-slash spelling. */
        router.get(path, asyncHandler(async function renderEvent(req, res) {
            const state = await hooks.bootstrap(req);
            // Controller admission remains independent for every view. Query
            // capabilities are forwarded unchanged and never select the view.
            const token = typeof req.query.regToken === 'string' ? req.query.regToken : undefined;
            const entry = await readEventResourceEntry(String(req.params.eventId), view, await captureApiActor(req), token);
            state.eventEntry = entry;
            if (await hooks.applyPageEntry(req, res, state, entry.entry)) return;
            await renderFrontendPilot(res, req.originalUrl, state);
        }));
    }

    /** Native account-only creation carries its exact return URL through login. */
    async function renderCreation(req: Request, res: Response): Promise<void> {
        const state = await hooks.bootstrap(req);
        const form = readEventCreateEntry(await captureApiActor(req), req.originalUrl);
        if (await hooks.applyPageEntry(req, res, state, form.entry)) return;
        if (form.context) state.eventCreateContext = form.context;
        await renderFrontendPilot(res, req.originalUrl, state);
    }

    /** Duplication reads only source form values under its independent grant. */
    async function renderDuplicate(req: Request, res: Response): Promise<void> {
        const state = await hooks.bootstrap(req);
        state.eventDuplicate = await readEventDuplicate(String(req.params.eventId), await captureApiActor(req));
        state.pageEntry = {kind: 'render'};
        await renderFrontendPilot(res, req.originalUrl, state);
    }

    return router;
}
