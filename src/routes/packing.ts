import {Router, type NextFunction, type Request, type Response} from 'express';
import {asyncHandler} from '../modules/lib/asyncHandler';
import {captureApiActor} from '../modules/api/session';
import {ApiProblem} from '../modules/api/problem';
import {renderFrontend} from '../modules/frontendRenderer';
import {ExpectedError} from '../modules/lib/errors';
import * as packingService from '../modules/database/services/PackingService';
import {paramHandler} from '../middleware/paramHandler';
import {getResource} from '../modules/lib/util';
import type {PackingList} from '../modules/database/entities/packing/PackingList';
import {readPackingCreateEntry, readPackingDuplicate, readPackingResourceEntry, readPackingHeaderPath} from '../controller/packingController';
import {bootstrap, applyPageEntry} from './frontend';
import {createHeaderHandler} from './outputs';

const router = Router();

// Reuse the existing resource loader: malformed and absent IDs are HTML 404s, and
// every packing URL (including guest entry) resolves the same current parent.
paramHandler('listId', router, packingService.getPackingListById, 'packing');

function packingResource(req: Request): PackingList {
    return getResource(req, 'packing') as PackingList;
}

router.get('/create', asyncHandler(async function renderPackingCreateFrontend(req, res) {
    const state = await bootstrap(req);
    const result = await readPackingCreateEntry(await captureApiActor(req), req.originalUrl, req.query.eventId);
    if (await applyPageEntry(req, res, state, result.entry)) return;
    state.packingCreateContext = result.context ?? undefined;
    state.packingSelectedEvent = result.selectedEvent ?? null;
    await renderFrontend(res, req.originalUrl, state);
}));

router.get('/:listId/duplicate', asyncHandler(async function renderPackingDuplicateFrontend(req, res) {
    const state = await bootstrap(req);
    try {
        // HTML and SPA entry use this same snapshot and freshly admitted actor. A
        // serialized session profile need not contain inverse account/guest relations;
        // repeating existing middleware here would evaluate different audience evidence.
        state.packingDuplicate = await readPackingDuplicate(packingResource(req).id, await captureApiActor(req), req.query.eventId);
    } catch (error) {
        // The snapshot owns DATA_DUPLICATE admission. A missing source or denied
        // grant retains the established HTML error presentation and status.
        if (error instanceof ApiProblem && ['NOT_FOUND', 'FORBIDDEN'].includes(error.code)) {
            throw new ExpectedError(error.code === 'FORBIDDEN' ? 'Not allowed' : error.code, 'error', error.status);
        }
        throw error;
    }
    await renderFrontend(res, req.originalUrl, state);
}));

router.get('/:listId', asyncHandler(async function renderPackingFrontend(req, res) {
    const state = await bootstrap(req);
    const result = await readPackingResourceEntry(packingResource(req).id, 'detail', await captureApiActor(req));
    if (await applyPageEntry(req, res, state, result.entry)) return;
    await renderFrontend(res, req.originalUrl, state);
}));

router.get('/:listId/guest', asyncHandler(async function renderGuestFrontend(req, res) {
    const state = await bootstrap(req);
    const result = await readPackingResourceEntry(packingResource(req).id, 'guest', await captureApiActor(req));
    if (await applyPageEntry(req, res, state, result.entry)) return;
    state.guestEntry = result.guest ?? undefined;
    await renderFrontend(res, req.originalUrl, state);
}));

/** Preserve existing packing statuses while rendering only known, localized admission messages. */
router.use(async function renderPackingAdmissionError(error: unknown, req: Request, res: Response, next: NextFunction) {
    // This router owns Packing admission outcomes, including errors from its
    // parameter loader. Other error categories retain the common boundary.
    if (!(error instanceof ExpectedError)) return next(error);
    const packingError = error.status === 404 ? 'packing.notFound'
        : error.status === 403 ? 'common.notAllowed'
            : error.message === 'You must be registered for the event to access this resource' ? 'packing.eventRegistrationRequired' : null;
    if (!packingError) return next(error);

    try {
        // Render the admitted session's localized catalog message with the existing
        // status, never arbitrary error text or protected Packing page content.
        const state = await bootstrap(req);
        state.packingError = packingError;
        res.status(error.status);
        await renderFrontend(res, req.originalUrl, state);
    } catch (renderError) {
        // A failure to render this known denial remains a real rendering failure;
        // pass it to the outer chain instead of presenting a misleading success.
        next(renderError);
    }
});

router.get('/:headerId/header', createHeaderHandler(readPackingHeaderPath));

export default router;
