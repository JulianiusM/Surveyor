import type {Request, Response} from 'express';
import {timingSafeEqual} from 'node:crypto';
import {version} from '../../../package.json';
import type {ApiActor} from '../../types/ApiTypes';
import type {components} from '../../types/api/v1';
import * as userService from '../database/services/UserService';
import {ensureFrontendSessionContext, rotateFrontendSessionContext} from '../lib/frontendSession';
import {persistSession} from '../lib/session';
import {ApiProblem, requestLocale} from './problem';
import settings from '../settings';

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
    await new Promise<void>((resolve, reject) => req.session.reload(error => error ? reject(new ApiProblem('AUTH_REQUIRED')) : resolve()));
}

async function clearInvalidIdentity(req: Request): Promise<never> {
    req.session.auth = undefined;
    req.session.profile = undefined;
    req.session.tokens = undefined;
    rotateFrontendSessionContext(req.session);
    await persistSession(req.session);
    throw new ApiProblem('AUTH_REQUIRED');
}

/** Hydrate audience relations explicitly, never infer identity from an optional serialized ORM relation. */
export async function captureApiActor(req: Request): Promise<ApiActor> {
    if (req.apiActor) return req.apiActor;
    await reloadSession(req);
    if (ensureFrontendSessionContext(req.session)) await persistSession(req.session);
    const context = req.session.frontendContext!;
    const auth = req.session.auth;
    if (auth?.user && auth?.guest) return clearInvalidIdentity(req);
    const user = auth?.user ? await userService.getUserById(auth.user.id) : null;
    const guest = auth?.guest ? await userService.getGuestInternal(auth.guest.id) : null;
    const profile = req.session.profile ? await userService.getProfileById(req.session.profile.id) : null;
    if ((auth?.user && !user) || (auth?.guest && !guest) || (req.session.profile && !profile)) return clearInvalidIdentity(req);
    if (profile && ((!user && !guest) || (user && profile.userId !== user.id) || (guest && profile.guestId !== guest.id))) return clearInvalidIdentity(req);
    if (profile) {
        profile.user = user;
        profile.guest = guest;
    }
    const actor: ApiActor = {context, auth: user || guest ? {user, guest} : undefined, profile};
    req.apiActor = actor;
    return actor;
}

export async function requireApiContext(req: Request, res: Response, requireProfile = false): Promise<ApiActor> {
    const actor = await captureApiActor(req);
    res.set('X-Surveyor-Context', actor.context);
    if (requireProfile && (!actor.profile || !(actor.auth?.user || actor.auth?.guest))) throw new ApiProblem('AUTH_REQUIRED');
    const suppliedContext = req.get('X-Surveyor-Context');
    if (!suppliedContext) throw new ApiProblem('CONTEXT_REQUIRED');
    if (!sameToken(suppliedContext, actor.context)) throw new ApiProblem('SESSION_CONTEXT_CHANGED');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        const fetchSite = req.get('Sec-Fetch-Site');
        const origin = req.get('Origin');
        const expectedOrigin = `${req.protocol}://${req.get('host')}`;
        if ((fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') || (origin && origin !== expectedOrigin)
            || !sameToken(req.get('X-CSRF-Token'), req.session.frontendCsrfToken)) throw new ApiProblem('CSRF_INVALID');
    }
    return actor;
}

export async function sessionView(req: Request): Promise<components['schemas']['SessionView']> {
    const actor = await captureApiActor(req);
    const kind = actor.auth?.user ? 'account' : actor.auth?.guest ? 'guest' : 'anonymous';
    const profiles = actor.auth?.user ? await userService.getProfilesForUser(actor.auth.user.id)
        : actor.profile ? [actor.profile] : [];
    return {
        kind, context: actor.context, csrfToken: req.session.frontendCsrfToken!, locale: requestLocale(req),
        activeProfile: actor.profile ? {id: actor.profile.id, name: actor.profile.name ?? ''} : null,
        profiles: profiles.map(profile => ({id: profile.id, name: profile.name ?? ''})),
        loginUrl: '/users/login', logoutUrl: kind === 'anonymous' ? null : '/users/logout',
        // Preserve the established public shell while keeping credentials, storage paths and
        // all other application settings out of the browser's bootstrap projection.
        shell: {
            version, imprintUrl: settings.value.imprintUrl, privacyPolicyUrl: settings.value.privacyPolicyUrl,
            localLoginEnabled: settings.value.localLoginEnabled, oidcEnabled: settings.value.oidcEnabled,
            oidcName: settings.value.oidcName,
        },
    } as components['schemas']['SessionView'];
}
