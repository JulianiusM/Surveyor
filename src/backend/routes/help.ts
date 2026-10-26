import {Router, type Request, type Response} from 'express';
import {asyncHandler} from '../modules/lib/asyncHandler';
import {requestLocale} from '../modules/api/problem';
import {createTranslator} from '../../common/localization/translator';
import {renderFrontend} from '../modules/frontendRenderer';
import {fetchHelpDoc, fetchHelpIndex, fetchHelpSearch, resolveHelpAssetSource} from '../controller/helpController';
import {ExpectedError} from '../modules/lib/errors';
import {resolveFrontendHelpQuery} from '../../common/lib/helpNavigation';
import {bootstrap} from './frontend';

const router = Router();

/** GET forms remain usable with JavaScript disabled and hydrate into the same search page. */
async function renderHelpFrontend(req: Request, res: Response): Promise<void> {
    const query = resolveFrontendHelpQuery(req.params.doc, req.query);
    const state = await bootstrap(req);
    // The browser uses this exact path/query selection. In particular, existing search
    // without q is its prompt, and article aliases ignore conflicting query selectors.
    const data = query.q !== undefined ? fetchHelpSearch(query.q, state.session.locale)
        : query.doc !== undefined ? fetchHelpDoc(query.doc, state.session.locale) : fetchHelpIndex(state.session.locale);
    state.help = data;
    await renderFrontend(res, req.originalUrl, state);
}

router.get('/', asyncHandler(renderHelpFrontend));

// Each localized visual stays within the article's selected reviewed corpus.
router.get('/assets/:assetName', asyncHandler(async function readFrontendHelpAsset(req, res) {
    const locale = requestLocale(req);
    const source = resolveHelpAssetSource(String(req.params.assetName), locale);
    if (!source) throw new ExpectedError(createTranslator(locale).t('help.notFound'), 'error', 404, {}, {messageKey: 'help.notFound'});
    // The article has already selected one complete language bundle. Asset requests
    // stay in that exact corpus; an absent file is 404 rather than an English figure
    // substituted into translated text. Whole-article fallback emits English URLs.
    res.set('Content-Language', source.locale ?? 'en').set('X-Content-Type-Options', 'nosniff');
    res.sendFile(source.filePath);
}));

router.get('/:doc', asyncHandler(renderHelpFrontend));

export default router;
