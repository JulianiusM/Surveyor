import type {Request, Response} from 'express';
import {timingSafeEqual} from 'node:crypto';
import {version} from '../../../../package.json';
import type {ApiActor} from '../../../types/ApiTypes';
import type {components} from '../../../types/api/v1';
import type {RegistrationEmailDelivery} from '../../../types/IdentityTypes';
import type {PreparedApiJsonResponse} from '../../../types/ApiTransportTypes';
import {prepareValidatedJson} from './transport';
import * as userService from '../database/services/UserService';
import {readFrontendSessionMetadata, sameFrontendSessionIdentity} from '../lib/frontendSession';
import {readStoredSession} from '../lib/session';
import {ApiProblem, requestLocale} from './problem';
import settings from '../settings';
import {compatibleApiClient, deploymentView} from './deployment';

/** Compare submitted tokens without making their contents authorization evidence. */
function sameToken(left: string | undefined, right: string | null | undefined): boolean {
    if (!left || !right) return false;
    const leftBytes = Buffer.from(left);
    const rightBytes = Buffer.from(right);
    return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

/**
 * Check current stored generation without changing Express's request Session.
 * A delayed request must reject changed authority rather than install a newer
 * snapshot that Express would subsequently write back at response completion.
 */
async function checkStoredAdmission(req: Request): Promise<void> {
    const session = req.session;
    const recognized = Boolean(session.auth || session.profile || session.tokens || session.oidc
        || session.frontendContext || session.frontendCsrfToken);

    // Cookie-free, empty middleware sessions are already uninitialized server
    // candidates. Ordinary anonymous visits need neither another read nor a row.
    if (!recognized && !req.headers?.cookie) {
        req.apiSessionStored = false;
        return;
    }

    // Operational store failures propagate unchanged. An already recognized
    // identity/context cannot become a new anonymous candidate after expiry.
    const stored = await readStoredSession(req.sessionStore, req.sessionID);
    req.apiSessionStored = Boolean(stored);
    if (!stored) {
        if (recognized) throw new ApiProblem('AUTH_REQUIRED');
        return;
    }
    if (!sameFrontendSessionIdentity(session, stored)) throw new ApiProblem('SESSION_CONTEXT_CHANGED');
}

/** Hydrate audience relations explicitly, never infer identity from an optional serialized ORM relation. */
export async function captureApiActor(req: Request): Promise<ApiActor> {
    if (req.apiActor) return req.apiActor;

    // Express already loaded this server-owned session. A second store check can
    // reject stale authority, but never replaces or mutates its lifecycle object.
    await checkStoredAdmission(req);
    const session = req.session;
    const auth = session.auth;
    if (auth?.user && auth?.guest) throw new ApiProblem('AUTH_REQUIRED');

    // Load the explicit account/guest/profile relations before checking ownership.
    // Their presence in a serialized session alone is not authoritative evidence.
    const user = auth?.user ? await userService.getUserById(auth.user.id) : null;
    const guest = auth?.guest ? await userService.getGuestInternal(auth.guest.id) : null;
    const profile = session.profile ? await userService.getProfileById(session.profile.id) : null;
    if ((auth?.user && !user) || (auth?.guest && !guest) || (session.profile && !profile)) throw new ApiProblem('AUTH_REQUIRED');
    if (profile && ((!user && !guest) || (user && profile.userId !== user.id) || (guest && profile.guestId !== guest.id))) throw new ApiProblem('AUTH_REQUIRED');

    if (profile) {
        profile.user = user;
        profile.guest = guest;
    }

    // Hydrated relations belong only to this plain actor. Do not assign them to
    // the stored Session or incidentally dirty its serialized ORM graph on GET.
    const metadata = readFrontendSessionMetadata(session, req.sessionID);
    const actor: ApiActor = {context: metadata.context, auth: user || guest ? {user, guest} : undefined, profile};
    req.apiActor = actor;
    return actor;
}

/** Admit the operation's identity/context, then apply the existing mutation-only transport protections. */
export async function requireApiContext(req: Request, res: Response, requireProfile = false): Promise<ApiActor> {
    return requireContextEvidence(req, res, requireProfile, {context: req.get('X-Surveyor-Context'),
        csrf: req.get('X-CSRF-Token'), compatibility: req.get('X-Surveyor-Api-Compatibility')});
}

/** Private transport evidence has no business authority independent of the stored session. */
interface ContextEvidence {
    context?: string;
    csrf?: string;
    compatibility?: string;
}

/** Verify browser request origin without interpreting any header as identity or permission. */
function requireRequestOrigin(req: Request, requireEvidence: boolean): void {
    // Configuration supplies the public origin even behind a proxy. Neither an
    // arbitrary Host nor client-supplied forwarded headers select the allowlist.
    const expectedOrigin = new URL(settings.value.rootUrl).origin;
    const fetchSite = req.get('Sec-Fetch-Site');
    const origin = req.get('Origin');
    if ((fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') || (origin && origin !== expectedOrigin)) {
        throw new ApiProblem('CSRF_INVALID');
    }

    // A token-free anonymous command needs affirmative browser evidence. Older
    // clients without Fetch Metadata must supply the matching Origin instead;
    // `none`, missing headers and an opaque `null` origin never prove that alone.
    if (requireEvidence && fetchSite !== 'same-origin' && origin !== expectedOrigin) throw new ApiProblem('CSRF_INVALID');
}

/** Verify captured header evidence without changing the admitted business workflow. */
async function requireContextEvidence(req: Request, res: Response, requireProfile: boolean,
    evidence: ContextEvidence): Promise<ApiActor> {
    // Capture once after the read-only stored generation check. Later workflow failures must
    // not be reinterpreted by validating an already changed/deleted identity again.
    const actor = await captureApiActor(req);
    if (actor.context) res.set('X-Surveyor-Context', actor.context);
    if (requireProfile && (!actor.profile || !(actor.auth?.user || actor.auth?.guest))) throw new ApiProblem('AUTH_REQUIRED');

    const suppliedContext = evidence.context;
    if (actor.context && !suppliedContext) throw new ApiProblem('CONTEXT_REQUIRED');
    if (suppliedContext && !sameToken(suppliedContext, actor.context)) throw new ApiProblem('SESSION_CONTEXT_CHANGED');

    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        // Reject an incompatible loaded client before controller admission or any side effect.
        if (!compatibleApiClient(evidence.compatibility)) throw new ApiProblem('CLIENT_UPDATE_REQUIRED');
        requireRequestOrigin(req, actor.context === null);
        if (actor.context) {
            // Both stored and read-only legacy metadata are bound to this exact
            // server session. Omitting browser fields cannot select anonymous admission.
            const metadata = readFrontendSessionMetadata(req.session, req.sessionID);
            if (!sameToken(evidence.csrf, metadata.csrfToken)) throw new ApiProblem('CSRF_INVALID');
        } else {
            // The required compatibility header is also a non-simple browser
            // header: an untrusted origin cannot attach it without CORS approval.
            // This proof applies only to browser CSRF; controllers still decide grants.
            const compatibilityHeader = req.get('X-Surveyor-Api-Compatibility');
            if (!compatibilityHeader || !compatibleApiClient(compatibilityHeader)) throw new ApiProblem('CSRF_INVALID');
            const contentType = req.get('Content-Type')?.split(';', 1)[0]?.trim().toLowerCase();
            if (contentType && contentType !== 'application/json' && contentType !== 'multipart/form-data') {
                throw new ApiProblem('UNSUPPORTED_MEDIA_TYPE');
            }
            // The generated operation validator subsequently admits its exact
            // JSON/multipart/no-body contract before any controller operation.
        }
    }
    return actor;
}

/** Project the admitted actor into public identity choices and the established common shell. */
export async function sessionView(req: Request): Promise<components['schemas']['SessionView']> {
    const actor = await captureApiActor(req);
    const profiles = actor.auth?.user ? await userService.getProfilesForUser(actor.auth.user.id)
        : actor.profile ? [actor.profile] : [];

    const metadata = readFrontendSessionMetadata(req.session, req.sessionID);
    return projectSessionView(actor, metadata.csrfToken, requestLocale(req), profiles);
}

/** Project explicit admitted session evidence without reading a mutable store or serializing ORM objects. */
export function projectSessionView(actor: ApiActor, csrfToken: string | null, locale: string,
    profiles: NonNullable<ApiActor['profile']>[]): components['schemas']['SessionView'] {
    // Admission/transaction owners supply these rows and the corresponding token.
    // This common projection selects only browser-needed identity and shell data.
    const kind = actor.auth?.user ? 'account' : actor.auth?.guest ? 'guest' : 'anonymous';
    return {
        kind, context: actor.context, csrfToken, locale,
        activeProfile: actor.profile ? {id: actor.profile.id, name: actor.profile.name ?? ''} : null,
        profiles: profiles.map(profile => ({id: profile.id, name: profile.name ?? ''})),
        loginUrl: '/users/login', logoutUrl: kind === 'anonymous' ? null : '/users/logout',
        deployment: deploymentView(),
        // Preserve the established public shell while keeping credentials, storage paths and
        // all other application settings out of the browser's bootstrap projection.
        shell: {
            version, imprintUrl: settings.value.imprintUrl, privacyPolicyUrl: settings.value.privacyPolicyUrl,
            localLoginEnabled: settings.value.localLoginEnabled, oidcEnabled: settings.value.oidcEnabled,
            oidcName: settings.value.oidcName,
        },
    } as components['schemas']['SessionView'];
}

/**
 * Capture the current provider-logout adapter's own completed evidence. Its
 * reply must not reload a later tab's identity. Other identity transitions prepare
 * this same projection before their locked completion commits.
 */
export function committedSessionView(req: Request): components['schemas']['SessionView'] {
    return transitionSessionView(req, req.session);
}

/** Project the same admitted roster from detached staging or a completed ordinary session. */
function transitionSessionView(req: Request, staged: Request['session']): components['schemas']['SessionView'] {
    // Login supplies its newly checked account; a same-account profile selection
    // reuses the authoritative account/profile roster captured at request admission.
    const auth = staged.auth;
    const account = auth?.user && req.apiActor?.auth?.user?.id === auth.user.id
        ? req.apiActor.auth.user : auth?.user;
    // An explicit transition owns a freshly rotated stored generation. Project
    // its actual fields: legacy read compatibility must not repair malformed
    // staged metadata or acknowledge values different from the impending write.
    const actor: ApiActor = {context: staged.frontendContext ?? null, auth: auth ? {user: account, guest: auth.guest} : undefined,
        profile: staged.profile};
    const profiles = account?.profiles ?? (actor.profile ? [actor.profile] : []);
    return projectSessionView(actor, staged.frontendCsrfToken ?? null, requestLocale(req), profiles);
}

/** Prepare ordinary identity confirmation before its sole locked session write and commit. */
export function prepareIdentityReply(req: Request, staged: Request['session'],
    operation: 'loginIdentity' | 'loginGuestIdentity' | 'switchIdentityProfile' | 'logoutIdentity'): PreparedApiJsonResponse {
    // Explicit public projection excludes ORM credentials/capabilities. Validate
    // and serialize this resulting scope before any durable identity transition.
    const session = transitionSessionView(req, staged);
    const result: components['schemas']['IdentityResult'] = {session, personalLink: null, redirect: null};
    return prepareValidatedJson(req, operation, 200, result, session.context);
}

/**
 * Prepare every mail-delivery outcome from the same isolated guest identity.
 * The controller calls this before its guest/profile/session transaction commits;
 * postcommit SMTP work selects a finished immutable string without projecting again.
 */
export function prepareGuestIdentityReplies(req: Request, staged: Request['session'], personalLink: string,
    operation: 'registerPackingGuest' | 'registerEventGuest' | 'registerDriversGuest' | 'registerSurveyGuest' | 'registerActivityGuest' = 'registerPackingGuest'):
    Record<RegistrationEmailDelivery, PreparedApiJsonResponse> {
    // Only the new guest/profile supplied by this transaction contributes data.
    // Neither the original actor nor a later session-store generation is a source.
    const session = projectSessionView({context: staged.frontendContext!, auth: staged.auth, profile: staged.profile},
        staged.frontendCsrfToken!, requestLocale(req), staged.profile ? [staged.profile] : []);
    const result: components['schemas']['IdentityResult'] = {session, personalLink, redirect: null};

    // Validate/serialize all alternatives now; delivery only chooses their key.
    return Object.freeze({
        'not-requested': prepareValidatedJson(req, operation, 200, {...result, emailDelivery: 'not-requested'}, session.context),
        sent: prepareValidatedJson(req, operation, 200, {...result, emailDelivery: 'sent'}, session.context),
        failed: prepareValidatedJson(req, operation, 200, {...result, emailDelivery: 'failed'}, session.context),
    });
}

/** Prepare signup delivery variants without exposing an activation token/link or changing the actor. */
export function prepareAccountRegistrationReplies(req: Request):
    Record<RegistrationEmailDelivery, PreparedApiJsonResponse> {
    // Signup returns only creation/delivery confirmation. Its captured context
    // is unchanged, including a read-only derived legacy generation. Raw partial
    // stored metadata is not this actor's scope. Activation material stays private.
    const result: components['schemas']['RegistrationResult'] = {changed: true};
    return Object.freeze({
        'not-requested': prepareValidatedJson(req, 'registerAccount', 200, result),
        sent: prepareValidatedJson(req, 'registerAccount', 200, {...result, emailDelivery: 'sent'}),
        failed: prepareValidatedJson(req, 'registerAccount', 200, {...result, emailDelivery: 'failed'}),
    });
}
