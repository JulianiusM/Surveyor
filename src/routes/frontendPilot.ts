import {Router} from 'express';
import type {NextFunction, Request, Response} from 'express';
import {asyncHandler} from '../modules/lib/asyncHandler';
import {captureApiActor, requireFrontendFormContext, sessionView} from '../modules/api/session';
import {ApiProblem, classifyApiError, requestLocale, validatedProblemBody} from '../modules/api/problem';
import {createTranslator, isPlainMessageKey, localeManifest} from '../modules/localization/translator';
import {renderFrontendPilot} from '../modules/frontendPilotRenderer';
import {fetchHelpDoc, fetchHelpIndex, fetchHelpSearch, resolveHelpAssetSource} from '../controller/helpController';
import type {FrontendIdentityRedirect, FrontendPilotBootstrap} from '../types/FrontendPilotTypes';
import * as userController from '../controller/userController';
import {frontendIdentityFeedback, frontendIdentityPageEntry, readGuestLinkHandoff, safeFrontendReturn} from '../modules/lib/frontendIdentity';
import type {FrontendIdentityOperation, IdentityCompletionReceipt} from '../types/IdentityTypes';
import {persistSession} from '../modules/lib/session';
import {APIError, ExpectedError, ValidationError} from '../modules/lib/errors';
import settings from '../modules/settings';
import * as packingService from '../modules/database/services/PackingService';
import type {components} from '../types/api/v1';
import {paramHandler} from '../middleware/paramHandler';
import {ENTITIES, getResource} from '../modules/lib/util';
import type {FrontendLandingQuickCreate} from '../types/FrontendPilotTypes';
import type {PackingList} from '../modules/database/entities/packing/PackingList';
import {readPackingCreateEntry, readPackingDuplicate, readPackingResourceEntry} from '../controller/packingController';
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
    // Document language hints select presentation before configuration denial;
    // they never change business state or identity authority.
    const locale = req.query.locale;
    if (typeof locale === 'string' && localeManifest.some(entry => entry.locale === locale)) {
        req.headers['x-surveyor-locale'] = locale;
    }
}

/**
 * Project documents only after stored-session admission. Consume one-time feedback
 * from that freshly admitted session so reloading authority cannot restore messages
 * which an earlier document already displayed.
 */
async function bootstrap(req: Request): Promise<FrontendPilotBootstrap> {
    applyNativePresentationLocale(req);
    const session = await sessionView(req);
    const flashRequest = {session: req.session} as Request;
    const readFlash: (this: Request, type: string) => unknown = req.flash;
    // express-flash's declaration disagrees with its one-type getter's array result.
    // Check that boundary and select a known message rather than trusting a cast or stored text.
    const flashes = readFlash.call(flashRequest, 'frontend-pilot');
    const feedback = frontendIdentityFeedback.find(key => Array.isArray(flashes) && flashes.includes(key));
    const state: FrontendPilotBootstrap = {session, ...(feedback ? {identityFeedback: feedback} : {})};
    // These are the existing controller's completion words, including its former-
    // owner cleanup result. Do not infer that business outcome again in this adapter.
    // The dedicated internal channel accepts only this admitted actor's receipt.
    const workflowNotices = readFlash.call(flashRequest, 'frontend-pilot-workflow');
    if (Array.isArray(workflowNotices)) {
        for (const notice of workflowNotices) {
            if (typeof notice !== 'string') continue;
            try {
                const value = JSON.parse(notice) as {context?: unknown; message?: unknown};
                if (value.context === session.context && typeof value.message === 'string') state.workflowNotice = value.message;
            } catch { /* A malformed internal receipt cannot supply presentation or authority. */ }
        }
    }
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

/** The landing page is opt-in during coexistence; Overview retains the pilot root. */
router.get('/home', asyncHandler(async function renderLandingPilot(req, res) {
    const state = await bootstrap(req);
    // Native landing selects one uniform quick-create shortcut per document.
    // Send that choice with SSR so hydration cannot choose a different href.
    const choices = Object.values(ENTITIES) as FrontendLandingQuickCreate[];
    state.landing = {quickCreate: choices[Math.floor(Math.random() * choices.length)]};
    await renderFrontendPilot(res, req.originalUrl, state);
}));

/** Message content comes only from admitted feedback, never request-supplied text. */
router.get('/message', asyncHandler(async function renderMessagePilot(req, res) {
    const state = await bootstrap(req);
    const notice = state.pageNotice;
    const messageKey = notice && isPlainMessageKey(notice.messageKey) ? notice.messageKey : 'common.infoTitle';
    state.commonPage = {kind: 'message', severity: notice?.kind ?? 'info', messageKey,
        message: createTranslator(state.session.locale).t(messageKey)};
    // This is a complete message, rather than a duplicate transient shell alert.
    state.pageNotice = undefined;
    await renderFrontendPilot(res, req.originalUrl, state);
}));

/** Preserve native account/guest admission before sending administration's progressive shell. */
router.get(['/users/profile', '/users/profile/manage', '/users/profile/create'],
    asyncHandler(async function renderProfileAdministration(req, res) {
        const state = await bootstrap(req);
        const actor = await captureApiActor(req);
        // Guests edit their active profile, while creating/managing profiles is
        // the established full-account workflow. Login retains this exact return.
        const view = req.path.endsWith('/manage') ? 'manage' : req.path.endsWith('/create') ? 'create' : 'edit';
        const entry = userController.getProfileAdministrationEntry(actor, view, req.originalUrl);
        if (await applyPageEntry(req, res, state, entry)) return;
        await renderFrontendPilot(res, req.originalUrl, state);
    }));

/**
 * Keep inherited mutations on document delivery. Their native controller
 * operations can partially complete before throwing; a JSON command receipt must
 * not claim atomic completion or definite rejection on their behalf. The shared
 * backend defects remain separately backlogged under the parity-only decision.
 * The generated read-only preview separately retains its mounted entry draft.
 */
router.get('/users/profile/migrate/request', asyncHandler(async function renderMigrationToken(req, res) {
    const state = await admitProfileWorkflow(req, res, false);
    if (!state) return;

    // Native entry issues/replaces a token on GET. Invoke that existing operation
    // once per document, never from a refresh query, hydration or automatic retry.
    state.profileWorkflow = {kind: 'token', token: await userController.getMigrationToken(req.session.profile!.id)};
    await renderFrontendPilot(res, req.originalUrl, state);
}));

/** Admit the native full-account token-entry form without resolving or generating a token. */
router.get('/users/profile/migrate/show', asyncHandler(async function renderMigrationEntry(req, res) {
    const state = await admitProfileWorkflow(req, res, true);
    if (!state) return;
    state.profileWorkflow = {kind: 'entry'};
    await renderFrontendPilot(res, req.originalUrl, state);
}));

/** Execute the existing explicitly confirmed transfer and deliver its ordinary document redirect. */
router.post('/users/profile/migrate/execute', asyncHandler(async function executeProfileMigration(req, res) {
    await requireFrontendFormContext(req, res);
    if (!await admitProfileWorkflow(req, res, true)) return;

    // Preserve the exact native operation, including existing token checks,
    // previous-owner cleanup, mail ordering and receiver-profile selection.
    const message = await userController.migrateProfile(req.session.auth!.user!.id, workflowField(req, 'token'));
    flashWorkflowNotice(req, message);
    res.redirect(nativeFrontendReturn(req, '/frontend-pilot/users/profile/manage'));
}));

/** Admit account-only deactivation or account/guest deletion with an initially empty confirmation. */
router.get(['/users/profile/delete', '/users/account/delete'], asyncHandler(async function renderIdentityDeletion(req, res) {
    const profile = req.path === '/users/profile/delete';
    const state = await admitProfileWorkflow(req, res, profile);
    if (!state) return;
    state.profileWorkflow = {kind: profile ? 'deactivate' : 'delete-account', value: ''};
    await renderFrontendPilot(res, req.originalUrl, state);
}));

/**
 * Adapt account-only deactivation and account/guest deletion to the native call
 * sequence, preserving its mail/session/provider and partial-failure outcomes.
 * Only a controller confirmation ValidationError redisplays submitted text at the
 * native 500 status; later operation failures retain their ordinary error result.
 */
router.post(['/users/profile/delete', '/users/account/delete'], asyncHandler(async function submitIdentityDeletion(req, res) {
    await requireFrontendFormContext(req, res);
    const profile = req.path === '/users/profile/delete';
    const state = await admitProfileWorkflow(req, res, profile);
    if (!state) return;

    try {
        // Confirmations and destructive decisions belong to the existing owner.
        // Keep the route sequence, including native final-profile failure, intact.
        if (profile) {
            const message = await userController.deactivateProfile({name: workflowField(req, 'name')}, req.session);
            flashWorkflowNotice(req, message);
            await userController.changeActiveProfile(req.session);
            // Selection rotates the frontend context. Rebind only this transport
            // receipt after success; a native selection failure keeps its earlier flash.
            flashWorkflowNotice(req, message);
            res.redirect(nativeFrontendReturn(req, '/frontend-pilot/users/profile/manage'));
        } else {
            const destination = await userController.deleteAccount({username: workflowField(req, 'username')}, req.session);
            // The existing logout owner supplies provider/root navigation. Do not
            // rewrite it, preflight it, or introduce another session transaction.
            req.flash('success', 'Account successfully deleted');
            res.redirect(destination);
        }
    } catch (error) {
        // Native confirmation failures render the same form and submitted value
        // at status 500. Only this known validation category reopens a form;
        // a later partial-completion failure retains the ordinary error outcome.
        if (!(error instanceof ValidationError)) throw error;
        state.profileWorkflow = profile
            ? {kind: 'deactivate', value: workflowField(req, 'name'), error: 'profile.invalidDeactivation'}
            : {kind: 'delete-account', value: workflowField(req, 'username'), error: 'profile.invalidAccountDeletion'};
        res.status(500);
        await renderFrontendPilot(res, req.originalUrl, state);
    }
}));

/** Use existing account/guest admission for private documents without a second business rule. */
async function admitProfileWorkflow(req: Request, res: Response, accountOnly: boolean): Promise<FrontendPilotBootstrap | null> {
    const state = await bootstrap(req);
    // The existing administration entry already shares native full-account versus
    // account/guest distinctions. A redirect never receives the private projection.
    const entry = userController.getProfileAdministrationEntry(await captureApiActor(req), accountOnly ? 'manage' : 'edit', req.originalUrl);
    return await applyPageEntry(req, res, state, entry) ? null : state;
}

/** URL-encoded fields retain exact native whitespace while excluding duplicate/object parser values. */
function workflowField(req: Request, field: 'name' | 'username' | 'token'): string {
    return typeof req.body?.[field] === 'string' ? req.body[field] : '';
}

/** Keep the shared controller's completion wording scoped to its resulting identity. */
function flashWorkflowNotice(req: Request, message: string): void {
    // Native session persistence/redirect ordering remains unchanged. Flash storage
    // is consumed only by the next matching admitted pilot document.
    req.flash('frontend-pilot-workflow');
    req.flash('frontend-pilot-workflow', JSON.stringify({context: req.session.frontendContext, message}));
}

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

router.get('/packing/:listId/guest', asyncHandler(async function renderGuestPilot(req, res) {
    const state = await bootstrap(req);
    const result = await readPackingResourceEntry(packingResource(req).id, 'guest', await captureApiActor(req));
    if (await applyPageEntry(req, res, state, result.entry)) return;
    state.guestEntry = result.guest ?? undefined;
    await renderFrontendPilot(res, req.originalUrl, state);
}));

/** Resolve configuration admission for the registered identity document entries. */
function nativeIdentityOperation(req: Request): FrontendIdentityOperation {
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

/** Native recovery has no standalone GET form; the login page owns its existing form. */
router.get('/guest/recovery', function redirectGuestRecovery(req, res) {
    res.redirect(nativeFrontendReturn(req, '/frontend-pilot/users/login'));
});

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
        // later API command independently checks expiry/consumption rather than trusting this read.
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
    if (!source) throw new ExpectedError(createTranslator(locale).t('help.notFound'), 'error', 404, {}, {messageKey: 'help.notFound'});
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

/** Keep opt-in document errors within the same Vue presentation and their actual HTTP status. */
router.use(async function renderCommonPilotError(error: unknown, req: Request, res: Response, next: NextFunction) {
    if (res.headersSent) return next(error);
    try {
        // Fresh admission prevents an error document from embedding obsolete
        // private authority. A store/renderer outage still reaches the outer owner.
        const state = await bootstrap(req);
        // Express reports malformed path escapes as its own URIError/400. Keep
        // that transport outcome without trusting arbitrary status-shaped data.
        const problem = error instanceof URIError && 'status' in error && error.status === 400
            ? new ApiProblem('VALIDATION_FAILED') : classifyApiError(error);
        const status = nativeDocumentErrorStatus(error, problem);
        const body = validatedProblemBody(problem, state.session.locale);
        // ExpectedError already owns safe contextual document wording. Preserve
        // it, with its optional source-owned key; API classification owns only
        // other errors and must not replace a Help-specific message with prose
        // for a generic missing resource.
        const message = error instanceof ExpectedError ? error.message : body.detail;
        const key = error instanceof ExpectedError ? error.messageKey : body.messageKey;
        const localizedKey = isPlainMessageKey(key) ? {messageKey: key} : {};
        state.commonPage = error instanceof ExpectedError
            ? {kind: 'message', severity: error.severity, message, status, ...localizedKey}
            : {kind: 'error', message, status, ...localizedKey,
                ...(req.app.get('env') === 'development' && error instanceof Error ? {stack: error.stack} : {})};
        res.status(status);
        await renderFrontendPilot(res, req.originalUrl, state);
        // A handled document no longer reaches the outer error logger. Preserve
        // operational reporting without putting tokens, URLs or error data in it.
        if (status >= 500) {
            const category = error instanceof Error && /^[A-Za-z][A-Za-z0-9]{0,63}$/u.test(error.name)
                ? error.name : 'UnexpectedError';
            console.error('[frontend]', {method: req.method, status, category});
        }
    } catch (renderError) {
        // Error delivery cannot turn a failed rendering/admission into success.
        next(renderError);
    }
});

export default router;
