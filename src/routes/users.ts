import {Router, type Request, type Response} from 'express';
import {asyncHandler} from '../modules/lib/asyncHandler';
import {captureApiActor} from '../modules/api/session';
import {classifyApiError, requestLocale, validatedProblemBody} from '../modules/api/problem';
import {renderFrontend} from '../modules/frontendRenderer';
import type {FrontendBootstrap, FrontendIdentityRedirect} from '../types/FrontendTypes';
import type {IdentityCompletionReceipt} from '../types/IdentityTypes';
import * as userController from '../controller/userController';
import {frontendIdentityPageEntry, frontendOverviewPageEntry, safeFrontendReturn} from '../modules/lib/frontendIdentity';
import {persistSession} from '../modules/lib/session';
import {ExpectedError} from '../modules/lib/errors';
import settings from '../modules/settings';
import {bootstrap, applyPageEntry, applyPresentationLocale, documentErrorStatus} from './frontend';

const router = Router();

router.get('/', function redirectUserHome(_req, res) {res.redirect('/users/dashboard');});

router.get('/dashboard', asyncHandler(async function renderOverviewFrontend(req, res) {
    const state = await bootstrap(req);
    // Match existing Dashboard admission before emitting a personal-page shell.
    // Existing redirect feedback owns its intentional anonymous-session save.
    const entry = frontendOverviewPageEntry(state.session, typeof req.query.next === 'string' ? req.query.next : req.originalUrl);
    if (await applyPageEntry(req, res, state, entry)) return;
    // Interactive Overview sends its authoritative session and shared shell first.
    // Mounted regions read their existing URL state independently through the same
    // authorized API/controller; a slow region cannot delay its siblings or this HTML.
    // Collapsed regions do not perform work until they are opened. Read-only Help
    // retains its complete server projection and disabled-JavaScript contract.
    await renderFrontend(res, req.originalUrl, state);
}));

/** Preserve existing account/guest admission before sending administration's progressive shell. */
for (const [path, view] of [['/profile', 'edit'], ['/profile/manage', 'manage'], ['/profile/create', 'create']] as const) {
    // Capture the declaration's intent. Express can match different case or a
    // trailing slash without changing account-only versus guest admission.
    router.get(path, asyncHandler(async function renderProfileAdministration(req, res) {
        const state = await bootstrap(req);
        const actor = await captureApiActor(req);
        // Guests edit their active profile, while creating/managing profiles is
        // the established full-account workflow. Login retains this exact return.
        const entry = userController.getProfileAdministrationEntry(actor, view, req.originalUrl);
        if (await applyPageEntry(req, res, state, entry)) return;
        await renderFrontend(res, req.originalUrl, state);
    }));
}

/**
 * Keep the established initial-document token issuance for direct arrivals.
 * Warm Vue navigation admits this page read-only, then issues a token through
 * its explicit generated command. Neither path retries issuance automatically.
 */
router.get('/profile/migrate/request', asyncHandler(async function renderMigrationToken(req, res) {
    const state = await admitProfileWorkflow(req, res, false);
    if (!state) return;

    // Existing entry issues/replaces a token on GET. Invoke that existing operation
    // once per document, never from a refresh query, hydration or automatic retry.
    const actor = await captureApiActor(req);
    state.profileWorkflow = {kind: 'token', token: await userController.getMigrationToken(actor.profile!.id)};
    await renderFrontend(res, req.originalUrl, state);
}));

/** Admit the existing full-account token-entry form without resolving or generating a token. */
router.get('/profile/migrate/show', asyncHandler(async function renderMigrationEntry(req, res) {
    const state = await admitProfileWorkflow(req, res, true);
    if (!state) return;
    state.profileWorkflow = {kind: 'entry'};
    await renderFrontend(res, req.originalUrl, state);
}));

/** Admit account-only deactivation or account/guest deletion with an initially empty confirmation. */
for (const [path, kind] of [['/profile/delete', 'deactivate'], ['/account/delete', 'delete-account']] as const) {
    // The registered operation owns its confirmation and admission; visitor
    // spelling must never select the sibling destructive workflow.
    router.get(path, asyncHandler(async function renderIdentityDeletion(req, res) {
        const state = await admitProfileWorkflow(req, res, kind === 'deactivate');
        if (!state) return;
        state.profileWorkflow = {kind, value: ''};
        await renderFrontend(res, req.originalUrl, state);
    }));
}

/** Use existing account/guest admission for private documents without a second business rule. */
async function admitProfileWorkflow(req: Request, res: Response, accountOnly: boolean): Promise<FrontendBootstrap | null> {
    const state = await bootstrap(req);
    // The existing administration entry already shares existing full-account versus
    // account/guest distinctions. A redirect never receives the private projection.
    const entry = userController.getProfileAdministrationEntry(await captureApiActor(req), accountOnly ? 'manage' : 'edit', req.originalUrl);
    return await applyPageEntry(req, res, state, entry) ? null : state;
}

router.get('/oidc/login', asyncHandler(async function startFrontendOidc(req, res) {
    const entry = frontendIdentityPageEntry('oidc', settings.value, req.query.next);
    if (entry.kind === 'denied') {
        const state = await bootstrap(req);
        await applyPageEntry(req, res, state, entry);
        return renderFrontend(res, req.originalUrl, state);
    }
    // Preserve the configured callback and PKCE/state handling; only the final application
    // destination differs. It belongs to the session and is never supplied by the provider.
    const session = req.session;
    session.frontendAuthReturn = safeFrontendReturn(req.query.next);
    const redirect = await userController.loginUserWithOidc(session);
    await persistSession(session);
    res.redirect(redirect);
}));

/** Preserve the registered provider callback and its existing controller order.
 * The stored return destination is bounded before delivering the current page. */
router.get('/oidc/callback', asyncHandler(async function completeOidc(req, res) {
    if (!settings.value.oidcEnabled) throw new ExpectedError('OIDC provider is not enabled!', 'error', 500);
    // Consume the application-owned return once; provider parameters never select
    // a destination. The identity controller still owns state/PKCE validation.
    const destination = safeFrontendReturn(req.session.frontendAuthReturn);
    req.session.frontendAuthReturn = undefined;
    await userController.loginUserWithOidcCallback(req);
    res.redirect(destination);
}));

/** Existing logout bookmarks keep their explicit identity transition. */
router.get('/logout', asyncHandler(async function logoutDocument(req, res) {
    const destination = await userController.logoutUserOidc(req.session);
    // Saved logout bookmarks keep the existing confirmation in the current
    // catalog-backed flash channel after the identity owner has completed.
    req.flash('frontend-notice', JSON.stringify({kind: 'success', messageKey: 'auth.logoutDone'}));
    // Provider logout may leave the application; an explicit application return
    // still passes through the same bounded destination owner as SPA logout.
    res.redirect(typeof req.query.next === 'string' ? safeFrontendReturn(req.query.next) : destination);
}));

router.get('/reset-password/:token', asyncHandler(async function renderPasswordResetFrontend(req, res) {
    const state = await bootstrap(req);
    const entry = frontendIdentityPageEntry('reset', settings.value);
    if (await applyPageEntry(req, res, state, entry)) return;
    if (entry.kind === 'denied') return renderFrontend(res, req.originalUrl, state);
    try {
        // Initial requests and SPA navigation use the same existing controller admission.
        // Render a truthful localized denial before hydration, with no password form; the
        // later API command independently checks expiry/consumption rather than trusting this read.
        await userController.checkPasswordForgotToken(String(req.params.token));
        state.passwordReset = {valid: true};
    } catch (error) {
        const problem = classifyApiError(error);
        state.passwordReset = validatedProblemBody(problem, state.session.locale);
        res.status(documentErrorStatus(error, problem));
    }
    await renderFrontend(res, req.originalUrl, state);
}));

/** Complete account activation through the shared identity controller. Document
 * configuration/admission precedes the token operation; success retains the
 * login handoff and failures retain their existing document status/presentation. */
router.get('/activate/:token', asyncHandler(async function activateIdentity(req, res) {
    // Resolve the request's presentation and local-login configuration before
    // attempting token activation, matching the existing document-entry owner.
    applyPresentationLocale(req);
    const entry = frontendIdentityPageEntry('activate', settings.value);
    if (entry.kind === 'denied') {
        const state = await bootstrap(req);
        await applyPageEntry(req, res, state, entry);
        return renderFrontend(res, req.originalUrl, state);
    }

    let committed: IdentityCompletionReceipt<FrontendIdentityRedirect>;
    try {
        const actor = await captureApiActor(req);
        const destination = `/users/login?next=${encodeURIComponent(safeFrontendReturn(req.query.next))}&locale=${requestLocale(req)}`;
        /** Stage existing public activation feedback inside its token/session transaction. */
        function prepareActivationRedirect(staged: Request['session']) {
            req.flash.call({session: staged} as Request, 'frontend', 'auth.activated');
            return Object.freeze({status: 303 as const, destination});
        }
        committed = await userController.activateAccountWithSession(String(req.params.token), req,
            {context: actor.context, persistCompletion: true, prepareResult: prepareActivationRedirect});
    } catch (error) {
        // Rebootstrap the current identity before projecting a safe typed problem;
        // the document status still follows the shared error contract.
        req.apiActor = undefined;
        const state = await bootstrap(req);
        const problem = classifyApiError(error);
        state.identityProblem = validatedProblemBody(problem, state.session.locale);
        res.status(documentErrorStatus(error, problem));
        await renderFrontend(res, req.originalUrl, state);
        return;
    }
    // The token write and existing flash are already durable. Adopt their
    // acknowledgement session; redirect delivery cannot trigger another save.
    req.session = committed.session;
    res.redirect(committed.result.status, committed.result.destination);
}));

for (const [path, operation] of [['/login', 'login'], ['/register', 'register'], ['/forgot-password', 'forgot']] as const) {
    // Configuration follows the registered operation, including Express's
    // equivalent case/trailing-slash matches; return destinations stay exact.
    router.get(path, asyncHandler(async function renderIdentityFrontend(req, res) {
        const state = await bootstrap(req);
        const entry = frontendIdentityPageEntry(operation, settings.value, req.query.next);
        if (await applyPageEntry(req, res, state, entry)) return;
        await renderFrontend(res, req.originalUrl, state);
    }));
}

export default router;
