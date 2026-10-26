import {Router, type Request} from 'express';
import {asyncHandler} from '../modules/lib/asyncHandler';
import {captureApiActor} from '../modules/api/session';
import {renderFrontend} from '../modules/frontendRenderer';
import type {IdentityCompletionReceipt} from '../../types/IdentityTypes';
import * as userController from '../controller/userController';
import {ExpectedError} from '../modules/lib/errors';
import {bootstrap, applyPresentationLocale, flashPageNotice, frontendReturn} from './frontend';

const router = Router();

/** Existing recovery has no standalone GET form; the login page owns its existing form. */
router.get('/recovery', function redirectGuestRecovery(req, res) {
    res.redirect(frontendReturn(req, '/users/login'));
});

/** Preserve capability-link GET login and its 302, preparing notice/authority together without request rollback leaks. */
router.get('/:guestId/login/:token', asyncHandler(async function enterFrontendGuest(req, res) {
    applyPresentationLocale(req);
    const destination = frontendReturn(req, req.query.next);
    let committed: IdentityCompletionReceipt<string>;
    try {
        // Emailed capability links have always authenticated on GET. Keep that workflow
        // with its established completion and destination.
        /** Prepare feedback after token admission on isolated staging, preserving the existing 302. */
        function prepareGuestCompletion(staged: Request['session']): string {
            flashPageNotice(req, {kind: 'success', messageKey: 'auth.loginDone'}, staged);
            return destination;
        }
        const actor = await captureApiActor(req);
        committed = await userController.loginGuestWithSession(String(req.params.guestId), String(req.params.token), req,
            {context: actor.context, prepareResult: prepareGuestCompletion});
    } catch (error) {
        if (!(error instanceof ExpectedError) || error.cause !== 'TOKEN_INVALID') throw error;
        const state = await bootstrap(req);
        state.pageEntry = {kind: 'denied', status: 401, messageKey: 'auth.invalidGuestLink'};
        res.status(401);
        await renderFrontend(res, req.originalUrl, state);
        return;
    }
    // The admitted identity and notice are already durable; do not resave a
    // possibly superseded actor or classify redirect delivery as token rejection.
    req.session = committed.session;
    res.redirect(committed.result);
}));

export default router;
