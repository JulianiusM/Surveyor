import type {Request, Response} from 'express';
import type {EntityManager} from 'typeorm';
import {timingSafeEqual} from 'node:crypto';
import {version} from '../../../package.json';
import type {ApiActor} from '../../types/ApiTypes';
import type {components} from '../../types/api/v1';
import type {RegistrationEmailDelivery} from '../../types/IdentityTypes';
import type {PreparedApiJsonResponse} from '../../types/ApiTransportTypes';
import {prepareValidatedJson} from './transport';
import * as userService from '../database/services/UserService';
import {ensureFrontendSessionContext, rotateFrontendSessionContext} from '../lib/frontendSession';
import {persistSession} from '../lib/session';
import {ApiProblem, requestLocale} from './problem';
import settings from '../settings';
import {compatibleApiClient, deploymentView} from './deployment';

function sameToken(left: string | undefined, right: string | undefined): boolean {
    if (!left || !right) return false;
    const leftBytes = Buffer.from(left);
    const rightBytes = Buffer.from(right);
    return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

/**
 * Reload the authoritative store before admitting a request. Express may have loaded its session
 * before another tab finished switching profiles. Once admitted, the returned actor stays fixed.
 */
async function reloadSession(req: Request): Promise<void> {
    if (!req.session.auth && !req.session.frontendContext) return;
    await new Promise<void>(function reloadStoredSession(resolve, reject) {
        req.sessionStore.get(req.sessionID, function finishSessionReload(error, stored) {
            // An unavailable store is an operational error, not proof that an account
            // expired. Preserve that error rather than logging out a valid identity.
            if (error) return reject(error);
            if (!stored) return reject(new ApiProblem('AUTH_REQUIRED'));
            // Use Express Session's reload boundary directly. A single store read
            // distinguishes absence from failure without a racing preliminary probe.
            req.sessionStore.createSession(req, stored);
            resolve();
        });
    });
}

async function clearInvalidIdentity(req: Request, preserveForNativeLogout: boolean): Promise<never> {
    // Documents must run OIDC logout before token evidence is discarded. APIs retain
    // their structured expiry response and clear invalid authority immediately.
    if (preserveForNativeLogout) throw new ApiProblem('AUTH_REQUIRED');
    req.session.auth = undefined;
    req.session.profile = undefined;
    req.session.tokens = undefined;
    rotateFrontendSessionContext(req.session);
    await persistSession(req.session);
    throw new ApiProblem('AUTH_REQUIRED');
}

/** Hydrate audience relations explicitly, never infer identity from an optional serialized ORM relation. */
export async function captureApiActor(req: Request, preserveForNativeLogout = false): Promise<ApiActor> {
    if (req.apiActor) return req.apiActor;

    // Refresh once, then keep this request's context and identity evidence fixed.
    await reloadSession(req);
    if (ensureFrontendSessionContext(req.session)) await persistSession(req.session);
    const context = req.session.frontendContext!;
    const auth = req.session.auth;
    if (auth?.user && auth?.guest) return clearInvalidIdentity(req, preserveForNativeLogout);

    // Load the explicit account/guest/profile relations before checking ownership.
    // Their presence in a serialized session alone is not authoritative evidence.
    const user = auth?.user ? await userService.getUserById(auth.user.id) : null;
    const guest = auth?.guest ? await userService.getGuestInternal(auth.guest.id) : null;
    const profile = req.session.profile ? await userService.getProfileById(req.session.profile.id) : null;
    if ((auth?.user && !user) || (auth?.guest && !guest) || (req.session.profile && !profile)) return clearInvalidIdentity(req, preserveForNativeLogout);
    if (profile && ((!user && !guest) || (user && profile.userId !== user.id) || (guest && profile.guestId !== guest.id))) return clearInvalidIdentity(req, preserveForNativeLogout);

    if (profile) {
        profile.user = user;
        profile.guest = guest;
    }

    const actor: ApiActor = {context, auth: user || guest ? {user, guest} : undefined, profile};
    req.apiActor = actor;
    return actor;
}

/** Admit the operation's identity/context, then apply the existing mutation-only transport protections. */
export async function requireApiContext(req: Request, res: Response, requireProfile = false): Promise<ApiActor> {
    const actor = await captureApiActor(req);
    res.set('X-Surveyor-Context', actor.context);
    if (requireProfile && (!actor.profile || !(actor.auth?.user || actor.auth?.guest))) throw new ApiProblem('AUTH_REQUIRED');

    const suppliedContext = req.get('X-Surveyor-Context');
    if (!suppliedContext) throw new ApiProblem('CONTEXT_REQUIRED');
    if (!sameToken(suppliedContext, actor.context)) throw new ApiProblem('SESSION_CONTEXT_CHANGED');

    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        // Reject an incompatible loaded client before controller admission or any side effect.
        if (!compatibleApiClient(req.get('X-Surveyor-Api-Compatibility'))) throw new ApiProblem('CLIENT_UPDATE_REQUIRED');
        const fetchSite = req.get('Sec-Fetch-Site');
        const origin = req.get('Origin');
        const expectedOrigin = `${req.protocol}://${req.get('host')}`;
        if ((fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') || (origin && origin !== expectedOrigin)
            || !sameToken(req.get('X-CSRF-Token'), req.session.frontendCsrfToken)) throw new ApiProblem('CSRF_INVALID');
    }
    return actor;
}

/** Project the admitted actor into public identity choices and the established common shell. */
export async function sessionView(req: Request): Promise<components['schemas']['SessionView']> {
    const actor = await captureApiActor(req);
    const profiles = actor.auth?.user ? await userService.getProfilesForUser(actor.auth.user.id)
        : actor.profile ? [actor.profile] : [];

    return projectSessionView(actor, req.session.frontendCsrfToken!, requestLocale(req), profiles);
}

/** Project an actor-preserving completion from admitted authority and manager-bound roster reads. */
export async function stagedSessionView(req: Request, staged: Request['session'], manager: EntityManager): Promise<components['schemas']['SessionView']> {
    // The enclosing controller locked/rechecked this exact context. Reuse its
    // already validated actor instead of reloading the globally mutable store.
    const actor = req.apiActor!;
    const profiles = actor.auth?.user ? await userService.getProfilesForUser(actor.auth.user.id, manager)
        : actor.profile ? [actor.profile] : [];
    return projectSessionView({...actor, context: staged.frontendContext!}, staged.frontendCsrfToken!, requestLocale(req), profiles);
}

/** Project explicit admitted session evidence without reading a mutable store or serializing ORM objects. */
export function projectSessionView(actor: ApiActor, csrfToken: string, locale: string,
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
 * reply must not reload a later tab's identity. Other pilot transitions prepare
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
    const actor: ApiActor = {context: staged.frontendContext!, auth: auth ? {user: account, guest: auth.guest} : undefined,
        profile: staged.profile};
    const profiles = account?.profiles ?? (actor.profile ? [actor.profile] : []);
    return projectSessionView(actor, staged.frontendCsrfToken!, requestLocale(req), profiles);
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
export function prepareGuestIdentityReplies(req: Request, staged: Request['session'], personalLink: string):
    Record<RegistrationEmailDelivery, PreparedApiJsonResponse> {
    // Only the new guest/profile supplied by this transaction contributes data.
    // Neither the original actor nor a later session-store generation is a source.
    const session = projectSessionView({context: staged.frontendContext!, auth: staged.auth, profile: staged.profile},
        staged.frontendCsrfToken!, requestLocale(req), staged.profile ? [staged.profile] : []);
    const result: components['schemas']['IdentityResult'] = {session, personalLink, redirect: null};

    // Validate/serialize all alternatives now; delivery only chooses their key.
    return Object.freeze({
        'not-requested': prepareValidatedJson(req, 'registerPackingGuest', 200, {...result, emailDelivery: 'not-requested'}, session.context),
        sent: prepareValidatedJson(req, 'registerPackingGuest', 200, {...result, emailDelivery: 'sent'}, session.context),
        failed: prepareValidatedJson(req, 'registerPackingGuest', 200, {...result, emailDelivery: 'failed'}, session.context),
    });
}

/** Prepare signup delivery variants without exposing an activation token/link or changing the actor. */
export function prepareAccountRegistrationReplies(req: Request, staged: Request['session']):
    Record<RegistrationEmailDelivery, PreparedApiJsonResponse> {
    // Signup returns only creation/delivery confirmation. Its captured context
    // is unchanged; private activation material remains inside the email owner.
    const result: components['schemas']['RegistrationResult'] = {changed: true};
    return Object.freeze({
        'not-requested': prepareValidatedJson(req, 'registerAccount', 200, result, staged.frontendContext),
        sent: prepareValidatedJson(req, 'registerAccount', 200, {...result, emailDelivery: 'sent'}, staged.frontendContext),
        failed: prepareValidatedJson(req, 'registerAccount', 200, {...result, emailDelivery: 'failed'}, staged.frontendContext),
    });
}
