import {Router} from 'express';
import type {NextFunction, Request, Response} from 'express';
import type {EntityManager} from 'typeorm';
import {asyncHandler} from '../modules/lib/asyncHandler';
import {captureApiActor, requireApiContext, sessionView, stagedSessionView} from '../modules/api/session';
import {ApiProblem, classifyApiError, requestLocale, validatedProblemBody} from '../modules/api/problem';
import {createTranslator, isPlainMessageKey, localeManifest} from '../modules/localization/translator';
import {prepareFrontendPilot, renderFrontendPilot, sendPreparedFrontendPilot} from '../modules/frontendPilotRenderer';
import {fetchHelpDoc, fetchHelpIndex, fetchHelpSearch, resolveHelpAssetSource} from '../controller/helpController';
import type {FrontendGuestLinkHandoff, FrontendIdentityRedirect, FrontendPilotBootstrap, FrontendPreparedDocument} from '../types/FrontendPilotTypes';
import * as userController from '../controller/userController';
import {frontendIdentityFeedback, frontendIdentityPageEntry, readGuestLinkHandoff, safeFrontendReturn} from '../modules/lib/frontendIdentity';
import type {FrontendIdentityOperation, IdentityCompletionReceipt, RegistrationReceipt} from '../types/IdentityTypes';
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
import {projectPackingGuestEntry, readPackingCreateEntry, readPackingDuplicate, readPackingResourceEntry} from '../controller/packingController';
import {resolvePilotHelpQuery} from '../modules/lib/helpNavigation';

const router = Router();

/**
 * Document admission reloads and validates stored identity before API-style clearing
 * can discard OIDC logout evidence. Expiry follows native flash/logout; store failures
 * retain their ordinary operational error instead of being treated as false expiry.
 */
router.use(asyncHandler(async function admitPilotDocument(req, res, next) {
    // Select presentation language before identity admission so any ensuing
    // document outcome uses this request's existing locale precedence.
    applyNativePresentationLocale(req);
    try {
        // Retain provider-token evidence until the ordinary logout owner can
        // finish its native handoff; only a successfully captured actor continues.
        await captureApiActor(req, true);
        next();
    } catch (error) {
        // A store outage or other error remains an operational failure. Only
        // confirmed expired/invalid identity enters the established logout journey.
        if (!(error instanceof ApiProblem) || error.code !== 'AUTH_REQUIRED') throw error;
        req.flash('error', 'Session has expired');
        const destination = await userController.logoutUserOidc(req.session);

        // Persist the bounded pilot notice after logout, then deliver its chosen
        // destination. No submitted text or provider evidence enters the notice.
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

/**
 * Project ordinary documents after fresh stored-session admission, or prepare a
 * completion from detached staging and same-manager roster reads under its lock.
 * Only the selected session consumes one-time flash; rollback cannot change the
 * original request's authority or lose its pending presentation data.
 */
async function bootstrap(req: Request, preparation?: {session: Request['session']; manager: EntityManager}): Promise<FrontendPilotBootstrap> {
    applyNativePresentationLocale(req);
    // Session admission reloads the authoritative store. Consume one-time feedback only
    // afterwards, otherwise that reload would restore already-read messages on every page.
    const session = preparation ? await stagedSessionView(req, preparation.session, preparation.manager) : await sessionView(req);
    // Ordinary admission may replace req.session. A prepared completion instead
    // consumes flash only on detached staging, so a render failure cannot leak it.
    const flashRequest = {session: preparation?.session ?? req.session} as Request;
    const readFlash: (this: Request, type: string) => unknown = req.flash;
    // express-flash's declaration disagrees with its one-type getter's array result.
    // Check that boundary and select a known message rather than trusting a cast or stored text.
    const flashes = readFlash.call(flashRequest, 'frontend-pilot');
    const feedback = frontendIdentityFeedback.find(key => Array.isArray(flashes) && flashes.includes(key));
    const state: FrontendPilotBootstrap = {session, ...(feedback ? {identityFeedback: feedback} : {})};
    // Flash storage remains an untyped boundary. Accept only a known plain catalog
    // message, never submitted text or interpolation/options through this channel.
    const notices = readFlash.call(flashRequest, 'frontend-pilot-notice');
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
    const links = readFlash.call(flashRequest, 'frontend-pilot-link');
    if (Array.isArray(links)) {
        // A different tab can change identity between the committed redirect and
        // this GET. Only its admitted matching context receives that private link.
        for (const link of links) {
            const handoff = readGuestLinkHandoff(link, session.context);
            if (handoff) state.personalLink = handoff.personalLink;
        }
    }
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
function flashPageNotice(req: Request, notice: components['schemas']['EntryNotice'], session = req.session): void {
    req.flash.call({session} as Request, 'frontend-pilot-notice', JSON.stringify(notice));
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
    // Reuse the public feature projection and the native loader's admitted row when
    // redisplaying a rejected POST. Do not add a query or guest-page redirect here.
    state.guestEntry = projectPackingGuestEntry(packingResource(req));
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

/** Retain only the established bounded public identity fields for document
 * redisplay. Credentials, tokens and other submitted properties never enter
 * bootstrap JSON; this projection does not validate or normalize the command. */
function safeIdentityFields(body: Record<string, unknown>): FrontendPilotBootstrap['identityFields'] {
    const fields: NonNullable<FrontendPilotBootstrap['identityFields']> = {};

    // Keep the existing field allowlist and redisplay bound. Submission validation
    // belongs to each authored operation rather than this presentation collector.
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
    let completedRedirect: string | undefined;
    let completedSession: Request['session'] | undefined;
    let completedDocument: FrontendPreparedDocument | undefined;
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
            const destination = nativeFrontendReturn(req, next);
            /** Prepare document feedback and redirect on isolated staging before its only stored write. */
            function prepareLoginCompletion(staged: Request['session']) {
                flashPageNotice(req, {kind: 'success', messageKey: 'auth.loginDone'}, staged);
                return Object.freeze({status: 303 as const, destination});
            }
            const committed = await userController.loginUserWithSession(input, req,
                {frontend: true, next, context: req.apiActor!.context, prepareResult: prepareLoginCompletion});
            completedSession = committed.session;
            completedRedirect = committed.result.destination;
        } else if (req.path === '/users/register') {
            const input = {username: body.username, displayname: body.displayname, email: body.email,
                password: body.password, password_repeat: body.password_repeat, ...inputNext};
            await admitNativeIdentity(req, res, 'registerAccount', input);
            await userController.registerUser(input, undefined, {frontend: true, next});
            feedback = 'auth.registered';
        } else if (req.path === '/users/forgot-password') {
            const input = {username: body.username, ...inputNext};
            await admitNativeIdentity(req, res, 'requestPasswordReset', input);
            const destination = `/frontend-pilot${req.path}?next=${encodeURIComponent(next)}&locale=${requestLocale(req)}`;
            /** Stage existing generic feedback before token/mail preparation becomes final. */
            function prepareRecoveryRedirect(staged: Request['session']) {
                req.flash.call({session: staged} as Request, 'frontend-pilot', 'auth.resetSent');
                return Object.freeze({status: 303 as const, destination});
            }
            const committed = await userController.requestPasswordResetWithSession(String(input.username), req,
                {frontend: true, next, context: req.apiActor!.context, persistCompletion: true, prepareResult: prepareRecoveryRedirect});
            completedSession = committed.session;
            completedRedirect = committed.result.destination;
        } else {
            const input = {token: String(req.params.token), password: body.password, confirmPassword: body.confirmPassword};
            await admitNativeIdentity(req, res, 'resetAccountPassword', input);
            /** Build the full existing 200 success document before consuming its one-time token. */
            async function prepareResetDocument(staged: Request['session'], manager: EntityManager) {
                const state = await bootstrap(req, {session: staged, manager});
                state.pageCompletion = {context: state.session.context, destination: req.originalUrl,
                    messageKey: 'auth.resetDone', kind: 'success'};
                return prepareFrontendPilot(res, req.originalUrl, state);
            }
            const committed = await userController.resetPasswordWithSession(input.token, input, req,
                {context: req.apiActor!.context, persistCompletion: true, prepareResult: prepareResetDocument});
            completedSession = committed.session;
            completedDocument = committed.result;
        }
        if (feedback) {
            req.flash('frontend-pilot', feedback);
            await persistSession(req.session);
            completedRedirect = `/frontend-pilot${req.path}?next=${encodeURIComponent(next)}&locale=${requestLocale(req)}`;
        }
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
        return;
    }
    // Transport delivery occurs outside the rejection renderer. A completed
    // login must never reopen its form as a rejected command after its save.
    if (completedSession) req.session = completedSession;
    if (completedDocument) {
        res.status(200);
        sendPreparedFrontendPilot(res, completedDocument);
        return;
    }
    if (completedRedirect) res.redirect(303, completedRedirect);
}
router.post(['/users/login', '/users/register', '/users/forgot-password', '/users/reset-password/:token', '/guest/recovery'],
    asyncHandler(submitNativeIdentity));

/** Native recovery has no standalone GET form; the login page owns its existing form. */
router.get('/guest/recovery', function redirectGuestRecovery(req, res) {
    res.redirect(nativeFrontendReturn(req, '/frontend-pilot/users/login'));
});

router.post('/packing/:listId/guest', asyncHandler(async function submitNativeGuest(req, res) {
    let committed: RegistrationReceipt<FrontendIdentityRedirect>;
    try {
        const input: components['schemas']['GuestRegistrationInput'] = {username: req.body.username,
            email: req.body.email || null};
        await admitNativeIdentity(req, res, 'registerPackingGuest', input);
        const state = await guestBootstrap(req);

        /** Finalize the existing redirect and context-bound flash while creation can still roll back. */
        function prepareGuestRedirect(staged: Request['session'], personalLink: string) {
            const destination = nativeFrontendReturn(req, `/frontend-pilot/packing/${state.guestEntry!.id}`);
            const handoff: FrontendGuestLinkHandoff = {context: staged.frontendContext!, personalLink};
            // connect-flash owns its existing encoding/channel. Bind its method
            // to the isolated session rather than mutating the live request.
            req.flash.call({session: staged} as Request, 'frontend-pilot-link', JSON.stringify(handoff));
            const redirect = Object.freeze({status: 303 as const, destination});
            // The existing fallback displays the link without claiming mail was
            // accepted. No postcommit delivery status needs another stored write.
            return Object.freeze({'not-requested': redirect, sent: redirect, failed: redirect});
        }

        committed = await userController.registerGuestWithSession(input.username, input.email ?? undefined, req,
            {frontend: true, next: `/frontend-pilot/packing/${state.guestEntry!.id}`, context: req.apiActor!.context,
                prepareResult: prepareGuestRedirect});
    } catch (error) {
        const problem = classifyApiError(error);
        req.apiActor = undefined;
        const state = await guestBootstrap(req);
        state.identityFields = safeIdentityFields(req.body);
        state.identityFormProblem = validatedProblemBody(problem, state.session.locale);
        res.status(nativeDocumentErrorStatus(error, problem));
        await renderFrontendPilot(res, req.originalUrl, state);
        return;
    }

    // Commit is final. Adopt its acknowledgement session and deliver the already
    // prepared 303 without a later guard, flash write, save or mutable projection.
    req.session = committed.session;
    res.redirect(committed.result.status, committed.result.destination);
}));

/** Profile and ordinary logout documents adopt committed handoffs; provider logout retains its existing path. */
router.post(['/users/profile', '/users/logout'], asyncHandler(async function submitNativeIdentityTransition(req, res) {
    let completed: IdentityCompletionReceipt<FrontendIdentityRedirect>;
    try {
        if (req.path === '/users/profile') {
            const input = {profileId: req.body.profileId};
            await admitNativeIdentity(req, res, 'switchIdentityProfile', input);
            const destination = nativeFrontendReturn(req, '/frontend-pilot');
            /** Prepare the existing overview handoff before committing profile authority. */
            function prepareProfileCompletion() {
                return Object.freeze({status: 303 as const, destination});
            }
            completed = await userController.changeActiveProfileWithSession(input.profileId, req,
                {context: req.apiActor!.context, prepareResult: prepareProfileCompletion});
            // Native profile activation returns to Overview rather than reopening the
            // previous profile's feature page. Its legacy profile screens remain native.
        } else {
            await admitNativeIdentity(req, res, 'logoutIdentity');
            if (!req.session.tokens) {
                // Explicit bounded next retains precedence. With no next, the
                // ordinary owner's application root maps to this locale's pilot root.
                const suppliedNext = req.body?.next ?? req.query.next;
                const destination = suppliedNext !== undefined ? nativeFrontendReturn(req, suppliedNext)
                    : `/frontend-pilot?locale=${requestLocale(req)}`;
                /** Stage the existing success notice/303 before the only stored authority write. */
                function prepareLogoutCompletion(staged: Request['session']) {
                    flashPageNotice(req, {kind: 'success', messageKey: 'auth.logoutDone'}, staged);
                    return Object.freeze({status: 303 as const, destination});
                }
                completed = await userController.logoutUserWithSession(req,
                    {context: req.apiActor!.context, prepareResult: prepareLogoutCompletion});
            } else {
                // Every truthy token object keeps the original provider workflow's
                // preparation, local clearing, feedback persistence and redirect order.
                const destination = await userController.logoutUserOidc(req.session);
                flashPageNotice(req, {kind: 'success', messageKey: 'auth.logoutDone'});
                await persistSession(req.session);

                // Like native logout, an explicit bounded next takes precedence over the controller's
                // provider destination. With no return supplied, keep that server-owned fallback.
                const suppliedNext = req.body?.next ?? req.query.next;
                const redirect = suppliedNext !== undefined ? nativeFrontendReturn(req, suppliedNext)
                    : destination === settings.value.rootUrl ? `/frontend-pilot?locale=${requestLocale(req)}` : destination;
                return res.redirect(303, redirect);
            }
        }
    } catch (error) {
        // A stale tab or rejected native form must stay inside the independent Vue shell.
        // Re-read authority for the error page; never redisplay obsolete profile form values.
        const problem = classifyApiError(error);
        req.apiActor = undefined;
        const state = await bootstrap(req);
        state.identityProblem = validatedProblemBody(problem, state.session.locale);
        res.status(nativeDocumentErrorStatus(error, problem));
        await renderFrontendPilot(res, req.originalUrl, state);
        return;
    }
    // Only a successful prepared profile or ordinary logout commit may replace
    // request authority. Delivery stays outside the business rejection boundary.
    req.session = completed.session;
    res.redirect(completed.result.status, completed.result.destination);
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

/** Preserve capability-link GET login and its 302, preparing notice/authority together without request rollback leaks. */
router.get('/guest/:guestId/login/:token', asyncHandler(async function enterPilotGuest(req, res) {
    applyNativePresentationLocale(req);
    const destination = nativeFrontendReturn(req, req.query.next);
    let committed: IdentityCompletionReceipt<string>;
    try {
        // Emailed capability links have always authenticated on GET. Keep that workflow
        // without an extra confirmation screen or a Pug destination.
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
        await renderFrontendPilot(res, req.originalUrl, state);
        return;
    }
    // The admitted identity and notice are already durable; do not resave a
    // possibly superseded actor or classify redirect delivery as token rejection.
    req.session = committed.session;
    res.redirect(committed.result);
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

/** Complete account activation through the shared identity controller. Document
 * configuration/admission precedes the token operation; success retains the
 * login handoff and failures retain their native document status/presentation. */
router.get('/users/activate/:token', asyncHandler(async function activateNativeIdentity(req, res) {
    // Resolve the request's presentation and local-login configuration before
    // attempting token activation, matching the existing document-entry owner.
    applyNativePresentationLocale(req);
    const entry = frontendIdentityPageEntry('activate', settings.value);
    if (entry.kind === 'denied') {
        const state = await bootstrap(req);
        await applyPageEntry(req, res, state, entry);
        return renderFrontendPilot(res, req.originalUrl, state);
    }

    let committed: IdentityCompletionReceipt<FrontendIdentityRedirect>;
    try {
        const actor = await captureApiActor(req);
        const destination = `/frontend-pilot/users/login?next=${encodeURIComponent(safeFrontendReturn(req.query.next))}&locale=${requestLocale(req)}`;
        /** Stage existing public activation feedback inside its token/session transaction. */
        function prepareActivationRedirect(staged: Request['session']) {
            req.flash.call({session: staged} as Request, 'frontend-pilot', 'auth.activated');
            return Object.freeze({status: 303 as const, destination});
        }
        committed = await userController.activateAccountWithSession(String(req.params.token), req,
            {context: actor.context, persistCompletion: true, prepareResult: prepareActivationRedirect});
    } catch (error) {
        // Rebootstrap the current identity before projecting a safe typed problem;
        // the document status still follows its original native renderer error.
        req.apiActor = undefined;
        const state = await bootstrap(req);
        const problem = classifyApiError(error);
        state.identityProblem = validatedProblemBody(problem, state.session.locale);
        res.status(nativeDocumentErrorStatus(error, problem));
        await renderFrontendPilot(res, req.originalUrl, state);
        return;
    }
    // The token write and existing flash are already durable. Adopt their
    // acknowledgement session; redirect delivery cannot trigger another save.
    req.session = committed.session;
    res.redirect(committed.result.status, committed.result.destination);
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
// Localized visuals stay within the opt-in pilot namespace. The original native
// /help/assets route remains bound to its unchanged English release payload.
router.get('/help/assets/:assetName', asyncHandler(async function readPilotHelpAsset(req, res) {
    const locale = requestLocale(req);
    const source = resolveHelpAssetSource(String(req.params.assetName), locale);
    if (!source) throw new ExpectedError(createTranslator(locale).t('help.notFound'), 'error', 404);
    // The article has already selected one complete language bundle. Asset requests
    // stay in that exact corpus; an absent file is 404 rather than an English figure
    // substituted into translated text. Whole-article fallback emits English URLs.
    res.set('Content-Language', source.locale ?? 'en').set('X-Content-Type-Options', 'nosniff');
    res.sendFile(source.filePath);
}));
router.get('/help/:doc', asyncHandler(renderHelpPilot));

/** Preserve native packing statuses while rendering only known, localized admission messages. */
router.use(async function renderPackingAdmissionError(error: unknown, req: Request, res: Response, next: NextFunction) {
    // This adapter owns only the known native Packing admission outcomes. Other
    // routes and error categories continue through their existing error boundary.
    if (!req.path.startsWith('/packing/') || !(error instanceof ExpectedError)) return next(error);
    const packingError = error.status === 404 ? 'packing.notFound'
        : error.status === 403 ? 'common.notAllowed'
            : error.message === 'You must be registered for the event to access this resource' ? 'packing.eventRegistrationRequired' : null;
    if (!packingError) return next(error);

    try {
        // Render the admitted session's localized catalog message with the native
        // status, never arbitrary error text or protected Packing page content.
        const state = await bootstrap(req);
        state.packingError = packingError;
        res.status(error.status);
        await renderFrontendPilot(res, req.originalUrl, state);
    } catch (renderError) {
        // A failure to render this known denial remains a real rendering failure;
        // pass it to the outer chain instead of presenting a misleading success.
        next(renderError);
    }
});
router.use(function missingPilotRoute(_req, _res, next) {next(new ApiProblem('NOT_FOUND'));});

export default router;
