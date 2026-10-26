import {Router} from 'express';
import {asyncHandler} from '../modules/lib/asyncHandler';
import {renderFrontend} from '../modules/frontendRenderer';
import {createTranslator, isPlainMessageKey} from '../../common/localization/translator';
import {ENTITIES} from '../modules/lib/util';
import type {FrontendLandingQuickCreate} from '../../types/FrontendTypes';
import {bootstrap} from '../middleware/frontendDocuments';

const router = Router();

/** The public landing page selects one quick-create shortcut per document. */
router.get('/', asyncHandler(async function renderLandingFrontend(req, res) {
    const state = await bootstrap(req);
    // Existing landing selects one uniform quick-create shortcut per document.
    // Send that choice with SSR so hydration cannot choose a different href.
    const choices = Object.values(ENTITIES) as FrontendLandingQuickCreate[];
    state.landing = {quickCreate: choices[Math.floor(Math.random() * choices.length)]};
    await renderFrontend(res, req.originalUrl, state);
}));

/** Message content comes only from admitted feedback, never request-supplied text. */
router.get('/message', asyncHandler(async function renderMessageFrontend(req, res) {
    const state = await bootstrap(req);
    const notice = state.pageNotice;
    const messageKey = notice && isPlainMessageKey(notice.messageKey) ? notice.messageKey : 'common.infoTitle';
    state.commonPage = {kind: 'message', severity: notice?.kind ?? 'info', messageKey,
        message: createTranslator(state.session.locale).t(messageKey)};
    // This is a complete message, rather than a duplicate transient shell alert.
    state.pageNotice = undefined;
    await renderFrontend(res, req.originalUrl, state);
}));

export default router;
