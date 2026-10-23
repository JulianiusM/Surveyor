import type {MessageKey} from '../../types/LocalizationTypes';
import type {components} from '../../types/api/v1';
import type {FrontendIdentityOperation, IdentityLoginSettings} from '../../types/IdentityTypes';
import type {FrontendGuestLinkHandoff} from '../../types/FrontendPilotTypes';

type IdentityProblemCode = components['schemas']['Problem']['code'];

/** Mirror the native personal dashboard without replacing the public landing route.
 * Navigation, identity fallbacks and confirmed removal delivery share this destination. */
export const frontendOverviewPath = '/frontend-pilot/users/dashboard';

/**
 * Decode the existing guest-link flash boundary without carrying another identity's
 * private recovery link into a newly admitted document. Old unscoped strings and
 * malformed records provide no matching context and are deliberately discarded.
 */
export function readGuestLinkHandoff(value: unknown, context: string): FrontendGuestLinkHandoff | undefined {
    if (typeof value !== 'string') return;
    try {
        // Flash storage is untyped. Preserve the existing actor-global first-GET
        // feedback while requiring this link's committed identity context.
        const data = JSON.parse(value) as Partial<FrontendGuestLinkHandoff> | null;
        if (!data || data.context !== context || typeof data.personalLink !== 'string') return;
        return {context, personalLink: data.personalLink};
    } catch {
        // A legacy or damaged flash is not document authority or an error state.
        return;
    }
}

/**
 * Pilot registration projects the native password criteria without importing its
 * jQuery/alert module. Preserve UTF-16 length and the established character classes;
 * this is presentation guidance, while the identity controller owns submission checks.
 */
export function passwordCriteria(password: string): {length: boolean; letter: boolean; digit: boolean} {
    return {length: password.length >= 8, letter: /[a-z,A-Z]/u.test(password), digit: /\d/u.test(password)};
}

export function isRegistrationPasswordValid(password?: string): boolean {
    if (!password) return false;
    const criteria = passwordCriteria(password);
    return criteria.length && criteria.letter && criteria.digit;
}

/** API problems describe transport outcomes, while native forms retain operation-specific
 * presentation. This explicit mapping never parses controller prose or exposes submitted
 * credentials. Other problems keep their existing validated API presentation. */
const identityProblemKeys: Partial<Record<FrontendIdentityOperation, Partial<Record<IdentityProblemCode, MessageKey>>>> = {
    login: {
        INVALID_CREDENTIALS: 'auth.invalidCredentials',
        ACCOUNT_INACTIVE: 'auth.accountInactive',
        ACTIVATION_RESENT: 'auth.activationResent',
    },
    register: {
        PASSWORD_MISMATCH: 'auth.registrationPasswordMismatch',
        USERNAME_TAKEN: 'api:errors.USERNAME_TAKEN',
    },
    reset: {PASSWORD_MISMATCH: 'auth.passwordMismatch', TOKEN_INVALID: 'auth.invalidToken'},
    activate: {TOKEN_INVALID: 'auth.invalidToken'},
};

/** Select only a known operation/code pair. Browser consumers first validate the
 * Problem; native controllers supply their own authored operation/cause. Safe future
 * problems retain the server's bounded detail instead of using this projection. */
export function frontendIdentityProblemKey(operation: FrontendIdentityOperation, code: IdentityProblemCode): MessageKey | undefined {
    if (code === 'LOCAL_LOGIN_DISABLED' && ['login', 'register', 'forgot', 'reset', 'activate'].includes(operation)) {
        return 'auth.localLoginDisabled';
    }
    return identityProblemKeys[operation]?.[code];
}

/**
 * Project the existing native configuration journey independently of API problem statuses.
 * Login/Register GET always enters OIDC when local login is disabled, even if that provider
 * subsequently denies entry. Native POST and the remaining local pages instead finish on
 * the established Error 500. Documents and mounted navigation share these exact outcomes;
 * credential commands still enforce their own server setting and retain authored API 403.
 */
export function frontendIdentityPageEntry(operation: FrontendIdentityOperation, login: IdentityLoginSettings,
    next?: unknown, method: 'GET' | 'POST' = 'GET'): components['schemas']['PageEntryOutcome'] {
    if (operation === 'oidc') {
        // Mounted navigation must enter the existing document handler. That handler
        // starts the provider directly; it never applies this application redirect again.
        return login.oidcEnabled ? {kind: 'redirect', url: oidcEntryUrl(next), notice: null}
            : {kind: 'denied', status: 500, messageKey: 'auth.oidcDisabled'};
    }
    if (login.localLoginEnabled || ['guest-login', 'recovery', 'error'].includes(operation)) return {kind: 'render'};
    if (method === 'GET' && (operation === 'login' || operation === 'register')) {
        return {kind: 'redirect', url: oidcEntryUrl(next), notice: null};
    }
    return {kind: 'denied', status: 500, messageKey: 'auth.localLoginDisabled'};
}

/** Keep the native provider handoff and its bounded return serialization in one owner. */
function oidcEntryUrl(next: unknown): string {
    return `/frontend-pilot/users/oidc/login?next=${encodeURIComponent(safeFrontendReturn(next))}`;
}

/** These confirmed identity operations finish on a complete message instead of another form.
 * The view and document fallback must agree so no-JavaScript clients can read that outcome. */
export const frontendIdentityMessageFeedback: readonly MessageKey[] = [
    'auth.registered', 'auth.resetSent', 'auth.resetDone',
];

/** Native post/redirect/get feedback contains catalog keys only, never HTML or submitted values. */
export const frontendIdentityFeedback: readonly MessageKey[] = [
    ...frontendIdentityMessageFeedback, 'auth.activated', 'auth.recoverySent', 'auth.logoutDone',
];

/** A fragment selects content in the current document and is never sent to Express.
 * Native admission, confirmed messages and transient flashes share this visit boundary;
 * a changed path/query is a new request, while anchor movement retains presentation. */
export function frontendDocumentUrl(url: string): string {
    return url.split('#', 1)[0];
}

/** Only application-owned relative destinations can complete a pilot identity transition. */
export function safeFrontendReturn(input: unknown): string {
    const fallback = frontendOverviewPath;
    if (typeof input !== 'string' || /[\\\u0000-\u001f\u007f]/u.test(input)) return fallback;
    try {
        const base = new URL('https://surveyor.invalid');
        const target = new URL(input, base);
        if (target.origin !== base.origin || !input.startsWith('/') || input.startsWith('//')
            || !/^\/frontend-pilot(?:\/|$)/u.test(target.pathname)) return fallback;
        return target.pathname + target.search + target.hash;
    } catch { return fallback; }
}
