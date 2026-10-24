import {Router} from 'express';
import type {Request, Response} from 'express';
import type {FrontendEntityDocumentHooks} from '../types/FrontendEntityDocumentTypes';
import {asyncHandler} from '../modules/lib/asyncHandler';
import {captureApiActor} from '../modules/api/session';
import {renderFrontendPilot} from '../modules/frontendPilotRenderer';
import {readSurveyCreateEntry, readSurveyDuplicate, readSurveyResourceEntry} from '../controller/surveyController';

/** Survey documents share read-only controller admission with warm navigation.
 * Ballots, combination creation and management use generated SPA commands; these
 * routes only admit the shell and prepare standalone creation/duplicate values. */
export function createSurveysPilotRouter(hooks: FrontendEntityDocumentHooks): Router {
    const router = Router();
    router.get('/create', asyncHandler(renderCreation));
    router.get('/:surveyId/duplicate', asyncHandler(renderDuplicate));
    for (const [path, intent] of [['/:surveyId', 'detail'], ['/:surveyId/guest', 'guest']] as const) {
        /** The registered detail/guest route owns admission regardless of the
         * equivalent URL spelling accepted by Express. */
        router.get(path, asyncHandler(async function renderSurvey(req, res) {
            const state = await hooks.bootstrap(req);
            // Keep controller authorization and original return URL unchanged;
            // selecting this presentation never creates a guest identity.
            const result = await readSurveyResourceEntry(String(req.params.surveyId), intent, await captureApiActor(req));
            if (await hooks.applyPageEntry(req, res, state, result.entry)) return;
            state.guestEntry = result.guest ?? undefined;
            await renderFrontendPilot(res, req.originalUrl, state);
        }));
    }

    /** Preserve account-only creation and the exact login return destination. */
    async function renderCreation(req: Request, res: Response): Promise<void> {
        const state = await hooks.bootstrap(req);
        const form = await readSurveyCreateEntry(await captureApiActor(req), req.originalUrl);
        if (await hooks.applyPageEntry(req, res, state, form.entry)) return;
        state.surveyCreateContext = form.context ?? undefined;
        await renderFrontendPilot(res, req.originalUrl, state);
    }

    /** A copy is an editable form seed, never a write or a copied ballot/image. */
    async function renderDuplicate(req: Request, res: Response): Promise<void> {
        const state = await hooks.bootstrap(req);
        const actor = await captureApiActor(req);
        // Native duplication admits the current owner independently of account
        // creation. A guest owner may inspect the copy; submission separately
        // follows the established account-only creation journey.
        state.surveyDuplicate = await readSurveyDuplicate(String(req.params.surveyId), actor);
        state.pageEntry = {kind: 'render'};
        await renderFrontendPilot(res, req.originalUrl, state);
    }

    return router;
}
