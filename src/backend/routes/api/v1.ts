import {Router} from 'express';
import type {components} from '../../../types/api/v1';
import {asyncHandler} from '../../modules/lib/asyncHandler';
import {ApiProblem, handleApiProblem, requestLocale} from '../../modules/api/problem';
import {requireApiContext, sessionView} from '../../modules/api/session';
import {sendValidatedJson, validateOperationRequest} from '../../modules/api/transport';
import {localeManifest} from '../../../common/localization/translator';
import {fetchHelpDoc, fetchHelpIndex, fetchHelpSearch} from '../../controller/helpController';
import packingRouter from './v1/packing';
import driversRouter from './v1/drivers';
import surveysRouter from './v1/surveys';
import activityRouter from './v1/activity';
import authRouter from './v1/auth';
import overviewRouter from './v1/overview';
import eventRouter from './v1/events';

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

router.get('/help', asyncHandler(async function getHelpPage(req, res) {
    await requireApiContext(req, res);
    validateOperationRequest(req, 'getHelpPage');
    const locale = requestLocale(req);
    const data = typeof req.query.q === 'string' ? fetchHelpSearch(req.query.q, locale)
        : typeof req.query.doc === 'string' ? fetchHelpDoc(req.query.doc, locale) : fetchHelpIndex(locale);
    sendValidatedJson(req, res, 'getHelpPage', 200, data);
}));

router.use(authRouter);
router.use('/overview', overviewRouter);
router.use('/packing-lists', packingRouter);
router.use('/drivers-lists', driversRouter);
router.use('/surveys', surveysRouter);
router.use('/activity-plans', activityRouter);
router.use('/events', eventRouter);
router.use(function missingOperation(_req, _res, next) {next(new ApiProblem('NOT_FOUND'));});
router.use(handleApiProblem);

export default router;
