import {Router} from 'express';
import type {NextFunction, Request, Response} from 'express';
import {asyncHandler} from '../modules/lib/asyncHandler';
import {captureApiActor, identityTransitionGuard, requireApiContext, sessionView} from '../modules/api/session';
import {ApiProblem, classifyApiError, requestLocale, validatedProblemBody} from '../modules/api/problem';
import {isPlainMessageKey, localeManifest} from '../modules/localization/translator';
import {renderFrontendPilot} from '../modules/frontendPilotRenderer';
import {fetchHelpDoc, fetchHelpIndex, fetchHelpSearch} from '../controller/helpController';
import type {FrontendPilotBootstrap} from '../types/FrontendPilotTypes';
import * as userController from '../controller/userController';
import {frontendIdentityFeedback, frontendIdentityPageEntry, safeFrontendReturn} from '../modules/lib/frontendIdentity';
import type {FrontendIdentityOperation} from '../types/IdentityTypes';
import {persistSession} from '../modules/lib/session';
import {APIError, ExpectedError, ValidationError} from '../modules/lib/errors';
import settings from '../modules/settings';
import {validateApiInput} from '../modules/api/transport';
import * as packingService from '../modules/database/services/PackingService';
import type {components} from '../types/api/v1';
import type {ApiOperationId} from '../types/ApiTransportTypes';
import {paramHandler} from '../middleware/paramHandler';
import {getResource} from '../modules/lib/util';
import type {PackingList} from '../modules/database/entities/packing/PackingList';
import {readPackingCreateEntry, readPackingDuplicate, readPackingResourceEntry} from '../modules/packing/api';
import {resolvePilotHelpQuery} from '../modules/lib/helpNavigation';

const router = Router();

/**
 * Document admission reloads and validates stored identity before API-style clearing
 * can discard OIDC logout evidence. Expiry follows native flash/logout; store failures
 * retain their ordinary operational error instead of being treated as false expiry.
 */
router.use(asyncHandler(async function admitPilotDocument(req, res, next) {
    applyNativePresentationLocale(req);
    try {
        await captureApiActor(req, true);
        next();
    } catch (error) {
        if (!(error instanceof ApiProblem) || error.code !== 'AUTH_REQUIRED') throw error;
        req.flash('error', 'Session has expired');
        const destination = await userController.logoutUserOidc(req.session);
        req.flash('frontend-pilot-notice', JSON.stringify({kind: 'error', messageKey: 'auth.sessionExpired'}));
        await persistSession(req.session);
        res.redirect(destination);
    }
}));

// Reuse the native resource loader: malformed and absent IDs are HTML 404s, and
// every packing URL (including guest entry) resolves the same current parent.
paramHandler('listId', router, packingService.getPackingListById, 'packing');

function packingResource(req: Request): PackingList {
    return getResource(req, 'packing') as PackingList;
}

function applyNativePresentationLocale(req: Request): void {
    // Native form and GET language hints select presentation before a configuration
    // denial, never business state or authority. POST retains its existing body precedence.
    const locale = req.method === 'POST' && typeof req.body?.locale === 'string' ? req.body.locale : req.query.locale;
    if (typeof locale === 'string' && localeManifest.some(entry => entry.locale === locale)) {
        req.headers['x-surveyor-locale'] = locale;
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
    const state: FrontendPilotBootstrap = {session, ...(feedback ? {identityFeedback: feedback} : {})};
    // Flash storage remains an untyped boundary. Accept only a known plain catalog
    // message, never submitted text or interpolation/options through this channel.
    const notices: unknown = req.flash('frontend-pilot-notice');
    if (Array.isArray(notices)) {
        for (const notice of notices) {
            if (typeof notice !== 'string') continue;
            try {
                const value = JSON.parse(notice) as {kind?: unknown; messageKey?: unknown};
                if (['info', 'error', 'success'].includes(String(value.kind)) && isPlainMessageKey(value.messageKey)) {
                    state.pageNotice = value as components['schemas']['EntryNotice'];
                }
            } catch { /* Ignore malformed stored feedback rather than treating it as page authority. */ }
        }
    }
    const links: unknown = req.flash('frontend-pilot-link');
    if (Array.isArray(links) && typeof links[0] === 'string') state.personalLink = links[0];
    return state;
}

/** Apply shared admission at the native HTTP boundary; Vue consumes this same declaration. */
async function applyPageEntry(req: Request, res: Response, state: FrontendPilotBootstrap,
    entry: components['schemas']['PageEntryOutcome']): Promise<boolean> {
    state.pageEntry = entry;
    if (entry.kind === 'denied') res.status(entry.status);
    if (entry.kind !== 'redirect') return false;
    // Bootstrap consumed document feedback before admission chose another canonical URL.
    // Carry it to the first rendered destination instead of losing a successful transition.
    const notice = entry.notice ?? state.pageNotice;
    if (notice) flashPageNotice(req, notice);
    await persistSession(req.session);
    res.redirect(nativeFrontendReturn(req, entry.url));
    return true;
}

/** Use one typed flash channel for native redirects and hydrated admission feedback. The
 * destination consumes it once; session persistence remains explicit at the transition owner. */
function flashPageNotice(req: Request, notice: components['schemas']['EntryNotice']): void {
    req.flash('frontend-pilot-notice', JSON.stringify(notice));
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

router.get('/packing/create', asyncHandler(async function renderPackingCreatePilot(req, res) {
    const state = await bootstrap(req);
    const result = await readPackingCreateEntry(await captureApiActor(req), req.originalUrl, req.query.eventId);
    if (await applyPageEntry(req, res, state, result.entry)) return;
    state.packingCreateContext = result.context ?? undefined;
    state.packingSelectedEvent = result.selectedEvent ?? null;
    await renderFrontendPilot(res, req.originalUrl, state);
}));

router.get('/packing/:listId/duplicate', asyncHandler(async function renderPackingDuplicatePilot(req, res) {
    const state = await bootstrap(req);
    try {
        // HTML and SPA entry use this same snapshot and freshly admitted actor. A
        // serialized session profile need not contain inverse account/guest relations;
        // repeating native middleware here would evaluate different audience evidence.
        state.packingDuplicate = await readPackingDuplicate(packingResource(req).id, await captureApiActor(req), req.query.eventId);
    } catch (error) {
        // The snapshot owns DATA_DUPLICATE admission. A missing source or denied
        // grant retains the established HTML error presentation and status.
        if (error instanceof ApiProblem && ['NOT_FOUND', 'FORBIDDEN'].includes(error.code)) {
            throw new ExpectedError(error.code === 'FORBIDDEN' ? 'Not allowed' : error.code, 'error', error.status);
        }
        throw error;
    }
    await renderFrontendPilot(res, req.originalUrl, state);
}));

router.get('/packing/:listId', asyncHandler(async function renderPackingPilot(req, res) {
    const state = await bootstrap(req);
    const result = await readPackingResourceEntry(packingResource(req).id, 'detail', await captureApiActor(req));
    if (await applyPageEntry(req, res, state, result.entry)) return;
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
    const state = await bootstrap(req);
    const result = await readPackingResourceEntry(packingResource(req).id, 'guest', await captureApiActor(req));
    if (await applyPageEntry(req, res, state, result.entry)) return;
    state.guestEntry = result.guest ?? undefined;
    await renderFrontendPilot(res, req.originalUrl, state);
}));

/** Native forms carry the same context/CSRF/compatibility values as fetch headers. Preserve
 * browser origin checks and validate only the operation input, excluding transport controls. */
async function admitNativeIdentity(req: Request, res: Response, operation: ApiOperationId, input?: unknown): Promise<void> {
    applyNativePresentationLocale(req);
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

/** Resolve only the native form URLs registered below; token-bearing reset has its own prefix. */
function nativeIdentityOperation(req: Request): FrontendIdentityOperation {
    if (req.path === '/guest/recovery') return 'recovery';
    if (req.path === '/users/login') return 'login';
    if (req.path === '/users/register') return 'register';
    if (req.path === '/users/forgot-password') return 'forgot';
    return 'reset';
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

/**
 * A document retains the status of its owning native renderer error. ValidationError
 * has no explicit status and the native generic handler renders it as Error 500; its
 * stable API cause may independently classify as 400, 401, 403 or 409. The embedded
 * Problem remains that authored wire projection, while the HTML response preserves
 * native behavior. Security/admission errors already own their typed status and pass
 * through unchanged; this never turns a CSRF or generated-input rejection into 500.
 */
function nativeDocumentErrorStatus(error: unknown, problem: ApiProblem): number {
    if (error instanceof ValidationError) return 500;
    if (error instanceof ExpectedError || error instanceof APIError) return error.status;
    return problem.status;
}

/**
 * Render a confirmed native POST at its submitted message destination. The shared page
 * owner consumes this actor/URL receipt once and retires it on departure. A later GET
 * performs its normal admission again; a consumed password token cannot be reopened
 * merely because the earlier POST completed successfully.
 */
async function renderNativeIdentityCompletion(req: Request, res: Response,
    messageKey: typeof frontendIdentityFeedback[number]): Promise<void> {
    const state = await bootstrap(req);
    state.pageCompletion = {context: state.session.context, destination: req.originalUrl,
        messageKey, kind: 'success'};
    await renderFrontendPilot(res, req.originalUrl, state);
}

/** Native and enhanced identity share the owning controllers and generated schemas. Public
 * values survive a rejected submit; credentials stay out of rendered JSON and redisplayed input. */
async function submitNativeIdentity(req: Request, res: Response): Promise<void> {
    const body = req.body as Record<string, unknown>;
    const next = safeFrontendReturn(body.next);
    const inputNext = {next};
    let feedback: typeof frontendIdentityFeedback[number] | undefined;
    try {
        // Native routes check local-login configuration before credential admission.
        // The document Error 500 is presentation only: enhanced commands retain the
        // authored LOCAL_LOGIN_DISABLED 403 without changing its public wire contract.
        const entry = frontendIdentityPageEntry(nativeIdentityOperation(req), settings.value, next, 'POST');
        if (entry.kind === 'denied') {
            const state = await bootstrap(req);
            await applyPageEntry(req, res, state, entry);
            return renderFrontendPilot(res, req.originalUrl, state);
        }
        if (req.path === '/guest/recovery') {
            const input = {email: body.email, ...inputNext};
            await admitNativeIdentity(req, res, 'recoverGuestIdentity', input);
            await userController.recoverGuestAccount(String(input.email).trim().toLowerCase(), {frontend: true, next});
            return renderNativeIdentityCompletion(req, res, 'auth.recoverySent');
        } else if (req.path === '/users/login') {
            const input = {username: body.username, password: body.password, ...inputNext};
            await admitNativeIdentity(req, res, 'loginIdentity', input);
            await userController.loginUser(input, req.session, {frontend: true, next, beforeTransition: identityTransitionGuard(req)});
            flashPageNotice(req, {kind: 'success', messageKey: 'auth.loginDone'});
            await persistSession(req.session);
            return res.redirect(303, nativeFrontendReturn(req, next));
        } else if (req.path === '/users/register') {
            const input = {username: body.username, displayname: body.displayname, email: body.email,
                password: body.password, password_repeat: body.password_repeat, ...inputNext};
            await admitNativeIdentity(req, res, 'registerAccount', input);
            await userController.registerUser(input, undefined, {frontend: true, next});
            feedback = 'auth.registered';
        } else if (req.path === '/users/forgot-password') {
            const input = {username: body.username, ...inputNext};
            await admitNativeIdentity(req, res, 'requestPasswordReset', input);
            await userController.sendPasswordForgotMail(String(input.username), {frontend: true, next});
            feedback = 'auth.resetSent';
        } else {
            const input = {token: String(req.params.token), password: body.password, confirmPassword: body.confirmPassword};
            await admitNativeIdentity(req, res, 'resetAccountPassword', input);
            await userController.resetPassword(input.token, input);
            return renderNativeIdentityCompletion(req, res, 'auth.resetDone');
        }
        req.flash('frontend-pilot', feedback);
        await persistSession(req.session);
        res.redirect(303, `/frontend-pilot${req.path}?next=${encodeURIComponent(next)}&locale=${requestLocale(req)}`);
    } catch (error) {
        const problem = classifyApiError(error);
        req.apiActor = undefined;
        const state = await bootstrap(req);
        state.identityFields = safeIdentityFields(body);
        const message = validatedProblemBody(problem, state.session.locale);
        if (req.path === '/guest/recovery') {
            // Recovery owns a complete native message page rather than a redisplayed
            // standalone form. Preserve its known Error/status before and after hydration.
            state.identityProblem = message;
        } else {
            state.identityFormProblem = message;
        }
        if (req.path.startsWith('/users/reset-password/')) {
            state.passwordReset = problem.code === 'TOKEN_INVALID' ? state.identityFormProblem : {valid: true};
        }
        res.status(nativeDocumentErrorStatus(error, problem));
        await renderFrontendPilot(res, req.originalUrl, state);
    }
}
router.post(['/users/login', '/users/register', '/users/forgot-password', '/users/reset-password/:token', '/guest/recovery'],
    asyncHandler(submitNativeIdentity));

/** Native recovery has no standalone GET form; the login page owns its existing form. */
router.get('/guest/recovery', function redirectGuestRecovery(req, res) {
    res.redirect(nativeFrontendReturn(req, '/frontend-pilot/users/login'));
});

router.post('/packing/:listId/guest', asyncHandler(async function submitNativeGuest(req, res) {
    try {
        const input: components['schemas']['GuestRegistrationInput'] = {username: req.body.username,
            email: req.body.email || null};
        await admitNativeIdentity(req, res, 'registerPackingGuest', input);
        const state = await guestBootstrap(req);
        const personalLink = await userController.registerGuest(input.username, input.email ?? undefined, req.session,
            {frontend: true, next: `/frontend-pilot/packing/${state.guestEntry!.id}`, beforeTransition: identityTransitionGuard(req)});
        // Preserve native POST/redirect/GET and retain the private link only in the
        // newly authenticated session's one-time feedback for its canonical detail page.
        req.flash('frontend-pilot-link', personalLink);
        await persistSession(req.session);
        res.redirect(303, nativeFrontendReturn(req, `/frontend-pilot/packing/${state.guestEntry!.id}`));
    } catch (error) {
        const problem = classifyApiError(error);
        req.apiActor = undefined;
        const state = await guestBootstrap(req);
        state.identityFields = safeIdentityFields(req.body);
        state.identityFormProblem = validatedProblemBody(problem, state.session.locale);
        res.status(nativeDocumentErrorStatus(error, problem));
        await renderFrontendPilot(res, req.originalUrl, state);
    }
}));

router.post(['/users/profile', '/users/logout'], asyncHandler(async function submitNativeIdentityTransition(req, res) {
    try {
        if (req.path === '/users/profile') {
            const input = {profileId: req.body.profileId};
            await admitNativeIdentity(req, res, 'switchIdentityProfile', input);
            await userController.changeActiveProfile(req.session, input.profileId, identityTransitionGuard(req));
            // Native profile activation returns to Overview rather than reopening the
            // previous profile's feature page. Its legacy profile screens remain native.
            return res.redirect(303, nativeFrontendReturn(req, '/frontend-pilot'));
        }
        await admitNativeIdentity(req, res, 'logoutIdentity');
        const destination = await userController.logoutUserOidc(req.session);
        flashPageNotice(req, {kind: 'success', messageKey: 'auth.logoutDone'});
        await persistSession(req.session);
        // Like native logout, an explicit bounded next takes precedence over the controller's
        // provider destination. With no return supplied, keep that server-owned fallback.
        const suppliedNext = req.body?.next ?? req.query.next;
        const redirect = suppliedNext !== undefined ? nativeFrontendReturn(req, suppliedNext)
            : destination === settings.value.rootUrl ? `/frontend-pilot?locale=${requestLocale(req)}` : destination;
        res.redirect(303, redirect);
    } catch (error) {
        // A stale tab or rejected native form must stay inside the independent Vue shell.
        // Re-read authority for the error page; never redisplay obsolete profile form values.
        const problem = classifyApiError(error);
        req.apiActor = undefined;
        const state = await bootstrap(req);
        state.identityProblem = validatedProblemBody(problem, state.session.locale);
        res.status(nativeDocumentErrorStatus(error, problem));
        await renderFrontendPilot(res, req.originalUrl, state);
    }
}));

router.get('/users/oidc/login', asyncHandler(async function startPilotOidc(req, res) {
    const entry = frontendIdentityPageEntry('oidc', settings.value, req.query.next);
    if (entry.kind === 'denied') {
        const state = await bootstrap(req);
        await applyPageEntry(req, res, state, entry);
        return renderFrontendPilot(res, req.originalUrl, state);
    }
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
        flashPageNotice(req, {kind: 'success', messageKey: 'auth.loginDone'});
        await persistSession(req.session);
        res.redirect(nativeFrontendReturn(req, req.query.next));
    } catch (error) {
        if (!(error instanceof ExpectedError) || error.cause !== 'TOKEN_INVALID') throw error;
        const state = await bootstrap(req);
        state.pageEntry = {kind: 'denied', status: 401, messageKey: 'auth.invalidGuestLink'};
        res.status(401);
        await renderFrontendPilot(res, req.originalUrl, state);
    }
}));

router.get('/users/reset-password/:token', asyncHandler(async function renderPasswordResetPilot(req, res) {
    const state = await bootstrap(req);
    const entry = frontendIdentityPageEntry('reset', settings.value);
    if (await applyPageEntry(req, res, state, entry)) return;
    if (entry.kind === 'denied') return renderFrontendPilot(res, req.originalUrl, state);
    try {
        // Initial requests and SPA navigation use the same native controller admission.
        // Render a truthful localized denial before hydration, with no password form; the
        // later POST independently checks expiry/consumption rather than trusting this read.
        await userController.checkPasswordForgotToken(String(req.params.token));
        state.passwordReset = {valid: true};
    } catch (error) {
        const problem = classifyApiError(error);
        state.passwordReset = validatedProblemBody(problem, state.session.locale);
        res.status(nativeDocumentErrorStatus(error, problem));
    }
    await renderFrontendPilot(res, req.originalUrl, state);
}));

router.get('/users/activate/:token', asyncHandler(async function activateNativeIdentity(req, res) {
    applyNativePresentationLocale(req);
    const entry = frontendIdentityPageEntry('activate', settings.value);
    if (entry.kind === 'denied') {
        const state = await bootstrap(req);
        await applyPageEntry(req, res, state, entry);
        return renderFrontendPilot(res, req.originalUrl, state);
    }
    try {
        await userController.activateAccount(String(req.params.token));
        req.flash('frontend-pilot', 'auth.activated');
        await persistSession(req.session);
        res.redirect(303, `/frontend-pilot/users/login?next=${encodeURIComponent(safeFrontendReturn(req.query.next))}&locale=${requestLocale(req)}`);
    } catch (error) {
        const state = await bootstrap(req);
        const problem = classifyApiError(error);
        state.identityProblem = validatedProblemBody(problem, state.session.locale);
        res.status(nativeDocumentErrorStatus(error, problem));
        await renderFrontendPilot(res, req.originalUrl, state);
    }
}));

router.get(['/users/login', '/users/register', '/users/forgot-password'],
    asyncHandler(async function renderIdentityPilot(req, res) {
        const state = await bootstrap(req);
        const entry = frontendIdentityPageEntry(nativeIdentityOperation(req), settings.value, req.query.next);
        if (await applyPageEntry(req, res, state, entry)) return;
        await renderFrontendPilot(res, req.originalUrl, state);
    }));

/** GET forms remain usable with JavaScript disabled and hydrate into the same search page. */
async function renderHelpPilot(req: Request, res: Response): Promise<void> {
    const query = resolvePilotHelpQuery(req.params.doc, req.query);
    const state = await bootstrap(req);
    // The browser uses this exact path/query selection. In particular, native search
    // without q is its prompt, and article aliases ignore conflicting query selectors.
    const data = query.q !== undefined ? fetchHelpSearch(query.q, state.session.locale)
        : query.doc !== undefined ? fetchHelpDoc(query.doc, state.session.locale) : fetchHelpIndex(state.session.locale);
    state.help = data;
    await renderFrontendPilot(res, req.originalUrl, state);
}
router.get('/help', asyncHandler(renderHelpPilot));
router.get('/help/:doc', asyncHandler(renderHelpPilot));

/** Preserve native packing statuses while rendering only known, localized admission messages. */
router.use(async function renderPackingAdmissionError(error: unknown, req: Request, res: Response, next: NextFunction) {
    if (!req.path.startsWith('/packing/') || !(error instanceof ExpectedError)) return next(error);
    const packingError = error.status === 404 ? 'packing.notFound'
        : error.status === 403 ? 'common.notAllowed'
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
