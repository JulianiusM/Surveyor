import {Router} from 'express';
import type {Request, Response} from 'express';
import {asyncHandler} from '../modules/lib/asyncHandler';
import {captureApiActor, sessionView} from '../modules/api/session';
import {ApiProblem, classifyApiError, validatedProblemBody} from '../modules/api/problem';
import {localeManifest} from '../modules/localization/translator';
import {renderFrontendPilot} from '../modules/frontendPilotRenderer';
import {fetchHelpDoc, fetchHelpIndex, fetchHelpSearch} from '../controller/helpController';
import type {FrontendPilotBootstrap} from '../types/FrontendPilotTypes';
import * as userController from '../controller/userController';
import {safeFrontendReturn} from '../modules/lib/frontendIdentity';
import {persistSession} from '../modules/lib/session';
import {ExpectedError} from '../modules/lib/errors';
import settings from '../modules/settings';

const router = Router();

async function bootstrap(req: Request): Promise<FrontendPilotBootstrap> {
    // Native GET language selection changes only presentation, never business state or authority.
    if (typeof req.query.locale === 'string' && localeManifest.some(locale => locale.locale === req.query.locale)) {
        req.headers['x-surveyor-locale'] = req.query.locale;
    }
    return {session: await sessionView(req)};
}

router.get('/', asyncHandler(async function renderPackingHome(req, res) { await renderFrontendPilot(res, req.originalUrl, await bootstrap(req)); }));

router.get(['/packing/create', '/packing/:listId/duplicate', '/packing/:listId/guest', '/packing/:listId'], asyncHandler(async function renderPackingPilot(req, res) {
    await captureApiActor(req);
    await renderFrontendPilot(res, req.originalUrl, await bootstrap(req));
}));

router.get('/users/oidc/login', asyncHandler(async function startPilotOidc(req, res) {
    if (!settings.value.oidcEnabled) return res.redirect('/frontend-pilot/users/login');
    // Preserve the configured callback and PKCE/state handling; only the final application
    // destination differs. It belongs to the session and is never supplied by the provider.
    req.session.frontendAuthReturn = safeFrontendReturn(req.query.next);
    const redirect = await userController.loginUserWithOidc(req.session);
    await persistSession(req.session);
    res.redirect(redirect);
}));

router.get('/guest/:guestId/login/:token', asyncHandler(async function enterPilotGuest(req, res) {
    try {
        // Emailed capability links have always authenticated on GET. Keep that workflow
        // without an extra confirmation screen or a Pug destination.
        await userController.loginGuest(String(req.params.guestId), String(req.params.token), req.session);
        res.redirect(safeFrontendReturn(req.query.next));
    } catch (error) {
        if (!(error instanceof ExpectedError) || error.cause !== 'TOKEN_INVALID') throw error;
        await renderFrontendPilot(res, req.originalUrl, await bootstrap(req));
    }
}));

router.get('/users/reset-password/:token', asyncHandler(async function renderPasswordResetPilot(req, res) {
    const state = await bootstrap(req);
    try {
        if (!settings.value.localLoginEnabled) throw new ApiProblem('LOCAL_LOGIN_DISABLED');
        // Initial requests and SPA navigation use the same native controller admission.
        // Render a truthful localized denial before hydration, with no password form; the
        // later POST independently checks expiry/consumption rather than trusting this read.
        await userController.checkPasswordForgotToken(String(req.params.token));
        state.passwordReset = {valid: true};
    } catch (error) {
        const problem = classifyApiError(error);
        state.passwordReset = validatedProblemBody(problem, state.session.locale);
        res.status(problem.status);
    }
    await renderFrontendPilot(res, req.originalUrl, state);
}));

router.get(['/users/login', '/users/register', '/users/forgot-password', '/users/activate/:token'],
    asyncHandler(async function renderIdentityPilot(req, res) {
        const state = await bootstrap(req);
        if (!settings.value.localLoginEnabled) {
            const entryPage = req.path === '/users/login' || req.path === '/users/register';
            if (entryPage && settings.value.oidcEnabled) {
                // Match native OIDC-only entry, while retaining the pilot's bounded return
                // destination through the owning OIDC start/callback instead of a form detour.
                return res.redirect(`/frontend-pilot/users/oidc/login?next=${encodeURIComponent(safeFrontendReturn(req.query.next))}`);
            }
            const problem = new ApiProblem('LOCAL_LOGIN_DISABLED');
            state.identityProblem = validatedProblemBody(problem, state.session.locale);
            res.status(problem.status);
        }
        await renderFrontendPilot(res, req.originalUrl, state);
    }));

/** GET forms remain usable with JavaScript disabled and hydrate into the same search page. */
async function renderHelpPilot(req: Request, res: Response): Promise<void> {
    const doc = typeof req.query.doc === 'string' ? req.query.doc : req.params.doc;
    const state = await bootstrap(req);
    const data = typeof req.query.q === 'string' ? fetchHelpSearch(req.query.q, state.session.locale)
        : typeof doc === 'string' ? fetchHelpDoc(doc, state.session.locale) : fetchHelpIndex(state.session.locale);
    state.help = data;
    await renderFrontendPilot(res, req.originalUrl, state);
}
router.get('/help', asyncHandler(renderHelpPilot));
router.get('/help/:doc', asyncHandler(renderHelpPilot));
router.use(function missingPilotRoute(_req, _res, next) {next(new ApiProblem('NOT_FOUND'));});

export default router;
