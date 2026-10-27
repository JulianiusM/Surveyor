import type {NextFunction, Request, Response} from 'express';
import {renderFrontend} from '../modules/frontendRenderer';
import {ExpectedError} from '../modules/lib/errors';
import {createGuestFlowHeaderRouter, createGuestFlowRouter} from '../middleware/guestFlowFactory';
import {packingFlow} from './packingFlow';
import {bootstrap} from '../middleware/frontendDocuments';

const router = createGuestFlowRouter(packingFlow);

/** Preserve existing packing statuses while rendering only known, localized admission messages. */
router.use(/** Render only recognized Packing admission failures with their
 * existing status and localized safe message. Other errors and rendering failures
 * keep the outer boundary, without exposing the protected page. */
async function renderPackingAdmissionError(error: unknown, req: Request, res: Response, next: NextFunction) {
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

router.use(createGuestFlowHeaderRouter(packingFlow));

export default router;
