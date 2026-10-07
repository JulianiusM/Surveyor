import {randomBytes} from 'node:crypto';
import type {Request} from 'express';

/**
 * Rotate both values at every identity transition, including a switch away and back.
 * Keeping these values in the existing session makes other tabs detect the change;
 * neither the context nor a submitted profile ID is an authorization credential.
 */
export function rotateFrontendSessionContext(session: Request['session']): void {
    session.frontendContext = randomBytes(32).toString('base64url');
    session.frontendCsrfToken = randomBytes(32).toString('base64url');
}

export function ensureFrontendSessionContext(session: Request['session']): boolean {
    if (session.frontendContext && session.frontendCsrfToken) return false;
    rotateFrontendSessionContext(session);
    return true;
}
