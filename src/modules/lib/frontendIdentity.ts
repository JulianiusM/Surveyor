import type {MessageKey} from '../../types/LocalizationTypes';

/** These confirmed identity operations finish on a complete message instead of another form.
 * The view and document fallback must agree so no-JavaScript clients can read that outcome. */
export const frontendIdentityMessageFeedback: readonly MessageKey[] = [
    'auth.registered', 'auth.resetSent', 'auth.resetDone',
];

/** Native post/redirect/get feedback contains catalog keys only, never HTML or submitted values. */
export const frontendIdentityFeedback: readonly MessageKey[] = [
    ...frontendIdentityMessageFeedback, 'auth.activated', 'auth.recoverySent', 'auth.logoutDone',
];

/** Only application-owned relative destinations can complete a pilot identity transition. */
export function safeFrontendReturn(input: unknown): string {
    const fallback = '/frontend-pilot';
    if (typeof input !== 'string' || /[\\\u0000-\u001f\u007f]/u.test(input)) return fallback;
    try {
        const base = new URL('https://surveyor.invalid');
        const target = new URL(input, base);
        if (target.origin !== base.origin || !input.startsWith('/') || input.startsWith('//')
            || !/^\/frontend-pilot(?:\/|$)/u.test(target.pathname)) return fallback;
        return target.pathname + target.search + target.hash;
    } catch { return fallback; }
}
