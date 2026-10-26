import {Router} from 'express';
import {asyncHandler} from '../../../modules/lib/asyncHandler';
import {requestLocale} from '../../../modules/lib/http';
import {requireApiContext} from '../../../modules/api/session';
import {sendValidatedJson, validateOperationRequest} from '../../../modules/api/transport';
import {fetchHelpDoc, fetchHelpIndex, fetchHelpSearch} from '../../../controller/helpController';

const router = Router();

router.get('/', asyncHandler(async function getHelpPage(req, res) {
    await requireApiContext(req, res);
    validateOperationRequest(req, 'getHelpPage');
    const locale = requestLocale(req);
    const data = typeof req.query.q === 'string' ? fetchHelpSearch(req.query.q, locale)
        : typeof req.query.doc === 'string' ? fetchHelpDoc(req.query.doc, locale) : fetchHelpIndex(locale);
    sendValidatedJson(req, res, 'getHelpPage', 200, data);
}));

export default router;
