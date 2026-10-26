import type {NextFunction, Request, Response} from 'express';
import {asyncHandler} from '../modules/lib/asyncHandler';
import {captureApiActor, sessionView} from '../modules/api/session';
import {ApiProblem, classifyApiError, requestLocale, validatedProblemBody} from '../modules/api/problem';
import {isPlainMessageKey, localeManifest} from '../../common/localization/translator';
import {renderFrontend} from '../modules/frontendRenderer';
import type {FrontendBootstrap} from '../../types/FrontendTypes';
import * as userController from '../controller/userController';
import {frontendIdentityFeedback, safeFrontendReturn} from '../../common/lib/frontendIdentity';
import {readGuestLinkHandoff} from '../modules/lib/frontendSession';
import {persistSession} from '../modules/lib/session';
import {APIError, ExpectedError, ValidationError} from '../modules/lib/errors';
import type {components} from '../../types/api/v1';

/**
 * Validate the ordinary Express request session without replacing or saving it.
 * Confirmed expiry follows the existing logout owner; operational failures do not
 * clear server identity or provider evidence merely because a read failed.
 */
export const admitFrontendDocument = asyncHandler(async function admitFrontendDocument(req, res, next) {
    // Select presentation language before identity admission so any ensuing
    // document outcome uses this request's existing locale precedence.
    applyPresentationLocale(req);
    try {
        // Retain provider-token evidence until the ordinary logout owner can
        // finish its existing handoff; only a successfully captured actor continues.
        await captureApiActor(req);
        next();
    } catch (error) {
        // A store outage or other error remains an operational failure. Only
        // confirmed expired/invalid identity enters the established logout journey.
        if (!(error instanceof ApiProblem) || error.code !== 'AUTH_REQUIRED') throw error;
        const session = req.session;
        req.flash('error', 'Session has expired');
        const destination = await userController.logoutUserOidc(session);

        // Persist the bounded frontend notice after logout, then deliver its chosen
        // destination. No submitted text or provider evidence enters the notice.
        req.flash('frontend-notice', JSON.stringify({kind: 'error', messageKey: 'auth.sessionExpired'}));
        await persistCompletedWorkflowFeedback(req);
        res.redirect(destination);
    }
});

export function applyPresentationLocale(req: Request): void {
    // Document language hints select presentation before configuration denial;
    // they never change business state or identity authority.
    const locale = req.query.locale;
    if (typeof locale === 'string' && localeManifest.some(entry => entry.locale === locale)) {
        req.headers['x-surveyor-locale'] = locale;
    }
}

/**
 * Project the admitted Express session and its established one-time feedback.
 * Reading absent feedback must leave a fresh anonymous session unmodified, so
 * ordinary documents do not create a stored session or cookie as a side effect.
 */
export async function bootstrap(req: Request): Promise<FrontendBootstrap> {
    applyPresentationLocale(req);
    const session = await sessionView(req);
    const flashes = readFrontendFlash(req, 'frontend');
    const feedback = frontendIdentityFeedback.find(key => Array.isArray(flashes) && flashes.includes(key));
    const state: FrontendBootstrap = {session, ...(feedback ? {identityFeedback: feedback} : {})};
    // Flash storage remains an untyped boundary. Accept only a known plain catalog
    // message, never submitted text or interpolation/options through this channel.
    const notices = readFrontendFlash(req, 'frontend-notice');
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
    const links = readFrontendFlash(req, 'frontend-link');
    if (session.context && Array.isArray(links)) {
        // A different tab can change identity between the committed redirect and
        // this GET. Only its admitted matching context receives that private link.
        for (const link of links) {
            const handoff = readGuestLinkHandoff(link, session.context);
            if (handoff) state.personalLink = handoff.personalLink;
        }
    }
    return state;
}

/**
 * Consume only an existing nonempty flash channel through the existing library.
 * Its getter creates `session.flash` even when no message exists; avoid that
 * mutation on public first visits while preserving actual one-time consumption.
 */
function readFrontendFlash(req: Request, channel: string): unknown[] {
    const flash = (req.session as Request['session'] & {flash?: Record<string, unknown>}).flash;
    const values = flash?.[channel];
    if (!Array.isArray(values) || !values.length) return [];

    // The installed getter returns arrays although its declaration differs.
    // Keep the established library as the owner of consuming stored messages.
    const readFlash: (this: Request, type: string) => unknown = req.flash;
    const consumed = readFlash.call(req, channel);
    return Array.isArray(consumed) ? consumed : [];
}

/** Apply shared admission at the existing HTTP boundary; Vue consumes this same declaration. */
export async function applyPageEntry(req: Request, res: Response, state: FrontendBootstrap,
    entry: components['schemas']['PageEntryOutcome']): Promise<boolean> {
    state.pageEntry = entry;
    if (entry.kind === 'denied') res.status(entry.status);
    if (entry.kind !== 'redirect') return false;
    // Bootstrap consumed document feedback before admission chose another canonical URL.
    // Carry it to the first rendered destination instead of losing a successful transition.
    const notice = entry.notice ?? state.pageNotice;
    if (notice) {
        // Match existing flash delivery even for a previously sessionless visitor:
        // this notice deliberately creates an anonymous Session before redirect.
        flashPageNotice(req, notice);
        await persistSession(req.session);
    }
    res.redirect(frontendReturn(req, entry.url));
    return true;
}

/** Use one typed flash channel for existing redirects and hydrated admission feedback. The
 * destination consumes it once; session persistence remains explicit at the transition owner. */
export function flashPageNotice(req: Request, notice: components['schemas']['EntryNotice'], session = req.session): void {
    req.flash.call({session} as Request, 'frontend-notice', JSON.stringify(notice));
}

/**
 * Feedback delivery after a shared existing operation cannot reject or interrupt
 * that operation's completed business work. Its existing outcome/redirect wins;
 * storage failure is logged without exposing identity or replaying the command.
 */
async function persistCompletedWorkflowFeedback(req: Request): Promise<void> {
    // Keep this normal Express save after required business continuations. It
    // acknowledges the exact operation's feedback, without a second persistence
    // protocol or a lock/merge of some independently loaded Session snapshot.
    try {
        await persistSession(req.session);
    } catch {
        // The bounded category is operational evidence, never submitted data,
        // private session contents or an exception that may include SQL values.
        console.error('[frontend]', {code: 'WORKFLOW_FEEDBACK_UNAVAILABLE'});
    }
}

/** A document redirect carries the selected presentation language without mutating identity
 * or treating a GET language hint as a persisted browser preference. */
export function frontendReturn(req: Request, destination: unknown): string {
    const target = new URL(safeFrontendReturn(destination), 'https://surveyor.invalid');
    target.searchParams.set('locale', requestLocale(req));
    return target.pathname + target.search + target.hash;
}

/**
 * A document retains the status selected by its error owner. ValidationError
 * has no explicit status and the existing generic handler renders it as Error 500; its
 * stable API cause may independently classify as 400, 401, 403 or 409. The embedded
 * Problem remains that authored wire projection, while the HTML response preserves
 * existing behavior. Security/admission errors already own their typed status and pass
 * through unchanged; this never turns a CSRF or generated-input rejection into 500.
 */
export function documentErrorStatus(error: unknown, problem: ApiProblem): number {
    if (error instanceof ValidationError) return 500;
    if (error instanceof ExpectedError || error instanceof APIError) return error.status;
    return problem.status;
}

/** Keep document errors within the same Vue presentation and their actual HTTP status. */
export async function renderFrontendError(error: unknown, req: Request, res: Response, next: NextFunction) {
    if (res.headersSent) return next(error);
    try {
        // Fresh admission prevents an error document from embedding obsolete
        // private authority. A store/renderer outage still reaches the outer owner.
        const state = await bootstrap(req);
        // Express reports malformed path escapes as its own URIError/400. Keep
        // that transport outcome without trusting arbitrary status-shaped data.
        const problem = error instanceof URIError && 'status' in error && error.status === 400
            ? new ApiProblem('VALIDATION_FAILED') : classifyApiError(error);
        const status = documentErrorStatus(error, problem);
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
        await renderFrontend(res, req.originalUrl, state);
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
}
