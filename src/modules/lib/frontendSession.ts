import {createHmac, randomBytes} from 'node:crypto';
import type {Request} from 'express';
import type {SessionData} from 'express-session';
import type {FrontendSessionMetadata} from '../../types/ApiTypes';
import settings from '../settings';

/**
 * Compare only server identity/generation evidence, without replacing Session
 * objects or interpreting incidental feedback/display changes as actor changes.
 */
export function sameFrontendSessionIdentity(left: Partial<SessionData>, right: Partial<SessionData>): boolean {
    // IDs come from server-loaded session records. Serialized ORM relations and
    // browser-supplied profile/context claims are never inputs to this comparison.
    return left.auth?.user?.id === right.auth?.user?.id && left.auth?.guest?.id === right.auth?.guest?.id
        && left.profile?.id === right.profile?.id && left.frontendContext === right.frontendContext
        && left.frontendCsrfToken === right.frontendCsrfToken;
}

/**
 * Project transport metadata without initializing or saving the Session. Callers
 * validate stored identity/ownership before deriving absent transport metadata.
 * Anonymous visitors receive no invented per-visitor session or authority.
 */
export function readFrontendSessionMetadata(session: Partial<SessionData>, sessionId: string): FrontendSessionMetadata {
    // Existing complete generations remain byte-for-byte compatible. Explicit
    // identity transitions keep rotating and persisting their ordinary random pair.
    if (session.frontendContext && session.frontendCsrfToken) {
        return {context: session.frontendContext, csrfToken: session.frontendCsrfToken};
    }
    const principal = session.auth?.user ?? session.auth?.guest;
    if (!principal) return {context: null, csrfToken: null};

    // An authenticated session may lack explicit generation fields. Bind derived
    // metadata to server-only SID, canonical identity/profile and any known generation;
    // separate labels prevent a public context from serving as its CSRF token.
    const binding = ['surveyor.frontend.legacy.v1', session.auth?.user ? 'account' : 'guest',
        String(principal.id), session.profile?.id ?? null, sessionId, session.frontendContext ?? null];
    function derive(label: 'context' | 'csrf'): string {
        return createHmac('sha256', settings.value.sessionSecret)
            .update(JSON.stringify([label, binding])).digest('base64url');
    }
    return {context: derive('context'), csrfToken: derive('csrf')};
}

/**
 * Rotate both values at every identity transition, including a switch away and back.
 * Keeping these values in the existing session makes other tabs detect the change;
 * neither the context nor a submitted profile ID is an authorization credential.
 */
export function rotateFrontendSessionContext(session: Request['session']): void {
    session.frontendContext = randomBytes(32).toString('base64url');
    session.frontendCsrfToken = randomBytes(32).toString('base64url');
}
