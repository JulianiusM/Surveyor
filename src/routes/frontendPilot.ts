import {Router} from 'express';
import type {NextFunction, Request, Response} from 'express';
import {asyncHandler} from '../modules/lib/asyncHandler';
import {captureApiActor, identityTransitionGuard, requireApiContext, sessionView} from '../modules/api/session';
import {ApiProblem, classifyApiError, requestLocale, validatedProblemBody} from '../modules/api/problem';
import {localeManifest} from '../modules/localization/translator';
import {renderFrontendPilot} from '../modules/frontendPilotRenderer';
import {fetchHelpDoc, fetchHelpIndex, fetchHelpSearch} from '../controller/helpController';
import type {FrontendPilotBootstrap} from '../types/FrontendPilotTypes';
import * as userController from '../controller/userController';
import {frontendIdentityFeedback, safeFrontendReturn} from '../modules/lib/frontendIdentity';
import {persistSession} from '../modules/lib/session';
import {ExpectedError} from '../modules/lib/errors';
import settings from '../modules/settings';
import {validateApiInput} from '../modules/api/transport';
import * as packingService from '../modules/database/services/PackingService';
import type {components} from '../types/api/v1';
import type {ApiOperationId} from '../types/ApiTransportTypes';
import {paramHandler} from '../middleware/paramHandler';
import {requirePermission} from '../middleware/permissionMiddleware';
import {canAccessEntityView} from '../controller/entityAdminController';
import {getPermFct, getResource} from '../modules/lib/util';
import {PERM} from '../modules/lib/permissions';
import type {PackingList} from '../modules/database/entities/packing/PackingList';
import {packingFormContext, readPackingDuplicate} from '../modules/packing/api';

const router = Router();

// Reuse the native resource loader: malformed and absent IDs are HTML 404s, and
// every packing URL (including guest entry) resolves the same current parent.
paramHandler('listId', router, packingService.getPackingListById, 'packing');

function packingResource(req: Request): PackingList {
    return getResource(req, 'packing') as PackingList;
}

const packingPermissionSubject = getPermFct(packingResource, 'packing');

function applyNativePresentationLocale(req: Request): void {
    // Native GET language selection changes only presentation, never business state or authority.
    if (typeof req.query.locale === 'string' && localeManifest.some(locale => locale.locale === req.query.locale)) {
        req.headers['x-surveyor-locale'] = req.query.locale;
    }
}

async function bootstrap(req: Request): Promise<FrontendPilotBootstrap> {
    applyNativePresentationLocale(req);
    // Session admission reloads the authoritative store. Consume one-time feedback only
    // afterwards, otherwise that reload would restore already-read messages on every page.
    const session = await sessionView(req);
    // express-flash's declaration disagrees with its one-type getter's array result.
    // Check that boundary and select a known message rather than trusting a cast or stored text.
    const flashes: unknown = req.flash('frontend-pilot');
    const feedback = frontendIdentityFeedback.find(key => Array.isArray(flashes) && flashes.includes(key));
    return {session, ...(feedback ? {identityFeedback: feedback} : {})};
}

router.get('/', asyncHandler(async function renderOverviewPilot(req, res) {
    const state = await bootstrap(req);
    // Interactive Overview sends its authoritative session and shared shell first.
    // Mounted regions read their existing URL state independently through the same
    // authorized API/controller; a slow region cannot delay its siblings or this HTML.
    // Collapsed regions do not perform work until they are opened. Read-only Help
    // retains its complete server projection and disabled-JavaScript contract.
    await renderFrontendPilot(res, req.originalUrl, state);
}));

/** Refresh the ordinary session before native permission middleware reads it. */
async function admitPackingSession(req: Request, _res: Response, next: NextFunction): Promise<void> {
    await captureApiActor(req);
    next();
}

router.get('/packing/create', asyncHandler(async function renderPackingCreatePilot(req, res) {
    const state = await bootstrap(req);
    // Native create GET requires an account; duplicate GET deliberately does not.
    if (state.session.kind !== 'account' || !state.session.activeProfile) {
        return res.redirect(nativeFrontendReturn(req, `/frontend-pilot/users/login?next=${encodeURIComponent(req.originalUrl)}`));
    }
    state.packingCreateContext = packingFormContext();
    await renderFrontendPilot(res, req.originalUrl, state);
}));

router.get('/packing/:listId/duplicate', asyncHandler(admitPackingSession),
    requirePermission(packingPermissionSubject, PERM.DATA_DUPLICATE),
    asyncHandler(async function renderPackingDuplicatePilot(req, res) {
        const state = await bootstrap(req);
        try {
            state.packingDuplicate = await readPackingDuplicate(packingResource(req).id, await captureApiActor(req));
        } catch (error) {
            // The snapshot repeats native duplication admission. If the source
            // disappeared or its grant changed, preserve the same HTML outcome.
            if (error instanceof ApiProblem && ['NOT_FOUND', 'FORBIDDEN'].includes(error.code)) {
                throw new ExpectedError(error.code, 'error', error.status);
            }
            throw error;
        }
        await renderFrontendPilot(res, req.originalUrl, state);
    }));

router.get('/packing/:listId', asyncHandler(async function renderPackingPilot(req, res) {
    const state = await bootstrap(req);
    const list = packingResource(req);
    // Attached-list admission precedes guest entry in the native route. A profile
    // may enter through event membership or an explicit ACCESS_VIEW alternative.
    if (list.eventId) {
        if (!await canAccessEntityView('packing', list, req.session)) {
            throw new ExpectedError('You must be registered for the event to access this resource');
        }
    } else if (!state.session.activeProfile) {
        return res.redirect(nativeFrontendReturn(req, `/frontend-pilot/packing/${list.id}/guest`));
    }
    await renderFrontendPilot(res, req.originalUrl, state);
}));

async function guestBootstrap(req: Request): Promise<FrontendPilotBootstrap> {
    const state = await bootstrap(req);
    const list = packingResource(req);
    // The native guest entry discloses its title before item/view permission, exactly like the API.
    state.guestEntry = {id: list.id, title: list.title};
    return state;
}
router.get('/packing/:listId/guest', asyncHandler(async function renderGuestPilot(req, res) {
    const state = await guestBootstrap(req);
    if (state.session.activeProfile) {
        return res.redirect(nativeFrontendReturn(req, `/frontend-pilot/packing/${packingResource(req).id}`));
    }
    await renderFrontendPilot(res, req.originalUrl, state);
}));

/** Native forms carry the same context/CSRF/compatibility values as fetch headers. Preserve
 * browser origin checks and validate only the operation input, excluding transport controls. */
async function admitNativeIdentity(req: Request, res: Response, operation: ApiOperationId, input?: unknown): Promise<void> {
    if (typeof req.body.locale === 'string' && localeManifest.some(locale => locale.locale === req.body.locale)) {
        req.headers['x-surveyor-locale'] = req.body.locale;
    }
    for (const [field, header] of [['_context', 'x-surveyor-context'], ['_csrf', 'x-csrf-token'],
        ['_compatibility', 'x-surveyor-api-compatibility']] as const) {
        const value = req.body[field];
        if (typeof value !== 'string') throw new ApiProblem('CSRF_INVALID');
        req.headers[header] = value;
    }
    await requireApiContext(req, res);
    // Logout has no business request body in the contract; its hidden transport controls
    // still undergo exactly the same context, origin and CSRF admission as other commands.
    if (input !== undefined) validateApiInput(operation, input);
}

function requireLocalLogin(): void {
    if (!settings.value.localLoginEnabled) throw new ApiProblem('LOCAL_LOGIN_DISABLED');
}

/** A native redirect carries the selected presentation language without mutating identity
 * or treating a GET language hint as a persisted browser preference. */
function nativeFrontendReturn(req: Request, destination: unknown): string {
    const target = new URL(safeFrontendReturn(destination), 'https://surveyor.invalid');
    target.searchParams.set('locale', requestLocale(req));
    return target.pathname + target.search + target.hash;
}

function safeIdentityFields(body: Record<string, unknown>): FrontendPilotBootstrap['identityFields'] {
    const fields: NonNullable<FrontendPilotBootstrap['identityFields']> = {};
    for (const key of ['username', 'displayname', 'email'] as const) {
        if (typeof body[key] === 'string') fields[key] = body[key].slice(0, 100);
    }
    return fields;
}

/** Native and enhanced identity share the owning controllers and generated schemas. Public
 * values survive a rejected submit; credentials stay out of rendered JSON and redisplayed input. */
async function submitNativeIdentity(req: Request, res: Response): Promise<void> {
    const body = req.body as Record<string, unknown>;
    const next = safeFrontendReturn(body.next);
    const inputNext = {next};
    let feedback: typeof frontendIdentityFeedback[number] | undefined;
    try {
        if (req.path === '/users/login' && body._recovery === '1') {
            const input = {email: body.email, ...inputNext};
            await admitNativeIdentity(req, res, 'recoverGuestIdentity', input);
            await userController.recoverGuestAccount(String(input.email).trim().toLowerCase(), {frontend: true, next});
            feedback = 'auth.recoverySent';
        } else if (req.path === '/users/login') {
            const input = {username: body.username, password: body.password, ...inputNext};
            await admitNativeIdentity(req, res, 'loginIdentity', input);
            requireLocalLogin();
            await userController.loginUser(input, req.session, {frontend: true, next, beforeTransition: identityTransitionGuard(req)});
            return res.redirect(303, nativeFrontendReturn(req, next));
        } else if (req.path === '/users/register') {
            const input = {username: body.username, displayname: body.displayname, email: body.email,
                password: body.password, password_repeat: body.password_repeat, ...inputNext};
            await admitNativeIdentity(req, res, 'registerAccount', input);
            requireLocalLogin();
            await userController.registerUser(input, undefined, {frontend: true, next});
            feedback = 'auth.registered';
        } else if (req.path === '/users/forgot-password') {
            const input = {username: body.username, ...inputNext};
            await admitNativeIdentity(req, res, 'requestPasswordReset', input);
            requireLocalLogin();
            await userController.sendPasswordForgotMail(String(input.username), {frontend: true, next});
            feedback = 'auth.resetSent';
        } else {
            const input = {token: String(req.params.token), password: body.password, confirmPassword: body.confirmPassword};
            await admitNativeIdentity(req, res, 'resetAccountPassword', input);
            requireLocalLogin();
            await userController.resetPassword(input.token, input);
            feedback = 'auth.resetDone';
        }
        req.flash('frontend-pilot', feedback);
        await persistSession(req.session);
        const destination = req.path.startsWith('/users/reset-password/') ? '/users/login' : req.path;
        res.redirect(303, `/frontend-pilot${destination}?next=${encodeURIComponent(next)}&locale=${requestLocale(req)}`);
    } catch (error) {
        const problem = classifyApiError(error);
        req.apiActor = undefined;
        const state = await bootstrap(req);
        state.identityFields = safeIdentityFields(body);
        state.identityFormProblem = validatedProblemBody(problem, state.session.locale);
        if (req.path.startsWith('/users/reset-password/')) {
            state.passwordReset = problem.code === 'TOKEN_INVALID' ? state.identityFormProblem : {valid: true};
        }
        res.status(problem.status);
        await renderFrontendPilot(res, req.originalUrl, state);
    }
}
router.post(['/users/login', '/users/register', '/users/forgot-password', '/users/reset-password/:token'],
    asyncHandler(submitNativeIdentity));

router.post('/packing/:listId/guest', asyncHandler(async function submitNativeGuest(req, res) {
    try {
        const input: components['schemas']['GuestRegistrationInput'] = {username: req.body.username,
            email: req.body.email || null};
        await admitNativeIdentity(req, res, 'registerPackingGuest', input);
        const state = await guestBootstrap(req);
        state.personalLink = await userController.registerGuest(input.username, input.email ?? undefined, req.session,
            {frontend: true, next: `/frontend-pilot/packing/${state.guestEntry!.id}`, beforeTransition: identityTransitionGuard(req)});
        req.apiActor = undefined;
        state.session = await sessionView(req);
        await renderFrontendPilot(res, req.originalUrl, state);
    } catch (error) {
        const problem = classifyApiError(error);
        req.apiActor = undefined;
        const state = await guestBootstrap(req);
        state.identityFields = safeIdentityFields(req.body);
        state.identityFormProblem = validatedProblemBody(problem, state.session.locale);
        res.status(problem.status);
        await renderFrontendPilot(res, req.originalUrl, state);
    }
}));

router.post(['/users/profile', '/users/logout'], asyncHandler(async function submitNativeIdentityTransition(req, res) {
    try {
        if (req.path === '/users/profile') {
            const input = {profileId: req.body.profileId};
            await admitNativeIdentity(req, res, 'switchIdentityProfile', input);
            await userController.changeActiveProfile(req.session, input.profileId, identityTransitionGuard(req));
            return res.redirect(303, nativeFrontendReturn(req, req.body.next));
        }
        await admitNativeIdentity(req, res, 'logoutIdentity');
        const destination = await userController.logoutUserOidc(req.session);
        req.flash('frontend-pilot', 'auth.logoutDone');
        await persistSession(req.session);
        res.redirect(303, destination === settings.value.rootUrl ? `/frontend-pilot?locale=${requestLocale(req)}` : destination);
    } catch (error) {
        // A stale tab or rejected native form must stay inside the independent Vue shell.
        // Re-read authority for the error page; never redisplay obsolete profile form values.
        const problem = classifyApiError(error);
        req.apiActor = undefined;
        const state = await bootstrap(req);
        state.identityProblem = validatedProblemBody(problem, state.session.locale);
        res.status(problem.status);
        await renderFrontendPilot(res, req.originalUrl, state);
    }
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
    applyNativePresentationLocale(req);
    try {
        // Emailed capability links have always authenticated on GET. Keep that workflow
        // without an extra confirmation screen or a Pug destination.
        await userController.loginGuest(String(req.params.guestId), String(req.params.token), req.session);
        res.redirect(nativeFrontendReturn(req, req.query.next));
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

router.get('/users/activate/:token', asyncHandler(async function activateNativeIdentity(req, res) {
    applyNativePresentationLocale(req);
    try {
        requireLocalLogin();
        await userController.activateAccount(String(req.params.token));
        req.flash('frontend-pilot', 'auth.activated');
        await persistSession(req.session);
        res.redirect(303, `/frontend-pilot/users/login?next=${encodeURIComponent(safeFrontendReturn(req.query.next))}&locale=${requestLocale(req)}`);
    } catch (error) {
        const state = await bootstrap(req);
        const problem = classifyApiError(error);
        state.identityProblem = validatedProblemBody(problem, state.session.locale);
        res.status(problem.status);
        await renderFrontendPilot(res, req.originalUrl, state);
    }
}));

router.get(['/users/login', '/users/register', '/users/forgot-password'],
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

/** Preserve native packing statuses while rendering only known, localized admission messages. */
router.use(async function renderPackingAdmissionError(error: unknown, req: Request, res: Response, next: NextFunction) {
    if (!req.path.startsWith('/packing/') || !(error instanceof ExpectedError)) return next(error);
    const packingError = error.status === 404 ? 'packing.notFound'
        : error.status === 403 ? 'api:errors.FORBIDDEN'
            : error.message === 'You must be registered for the event to access this resource' ? 'packing.eventRegistrationRequired' : null;
    if (!packingError) return next(error);
    try {
        const state = await bootstrap(req);
        state.packingError = packingError;
        res.status(error.status);
        await renderFrontendPilot(res, req.originalUrl, state);
    } catch (renderError) {
        next(renderError);
    }
});
router.use(function missingPilotRoute(_req, _res, next) {next(new ApiProblem('NOT_FOUND'));});

export default router;
