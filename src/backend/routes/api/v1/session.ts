import {Router} from 'express';
import type {components} from '../../../../types/api/v1';
import {asyncHandler} from '../../../modules/lib/asyncHandler';
import {ApiProblem} from '../../../modules/api/problem';
import {requireApiContext, sessionView} from '../../../modules/api/session';
import {sendValidatedJson, validateOperationRequest} from '../../../modules/api/transport';
import {localeManifest} from '../../../../common/localization/translator';

const router = Router();

router.get('/session', asyncHandler(async function getSession(req, res) {
    validateOperationRequest(req, 'getSession');
    sendValidatedJson(req, res, 'getSession', 200, await sessionView(req));
}));

router.put('/locale', asyncHandler(async function updateLocale(req, res) {
    await requireApiContext(req, res);
    validateOperationRequest(req, 'setLocale');
    const body = req.body as components['schemas']['LocaleUpdate'];
    const locale = localeManifest.find(candidate => candidate.locale === body.locale)?.locale;
    if (!locale) throw new ApiProblem('VALIDATION_FAILED');
    // Persist the browser preference without saving an old admitted session over
    // a concurrent profile switch. Account/guest records remain untouched.
    res.cookie('surveyor_locale', locale, {httpOnly: true, sameSite: 'lax', secure: req.secure, path: '/', maxAge: 365 * 24 * 60 * 60 * 1000});
    req.headers['x-surveyor-locale'] = locale;
    sendValidatedJson(req, res, 'setLocale', 200, await sessionView(req));
}));

export default router;
