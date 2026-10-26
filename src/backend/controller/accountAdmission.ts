import type {components} from '../../types/api/v1';
import type {SessionLike} from '../../types/PermissionTypes';

/** Account-only workflows require an account and its selected active profile. */
export function hasAccountProfile(session: SessionLike): boolean {
    return Boolean(session.auth?.user && session.profile);
}

/**
 * Project established account-only admission without reading mutable request state.
 * Callers supply their login/return URLs; commands independently enforce admission.
 */
export function getAccountPageEntry(session: SessionLike, loginUrl: string,
    returnTo: string): components['schemas']['PageEntryOutcome'] {
    // Page admission never creates a guest identity or persists an anonymous session.
    if (hasAccountProfile(session)) return {kind: 'render'};
    return {kind: 'redirect', url: `${loginUrl}?next=${encodeURIComponent(returnTo)}`,
        notice: {kind: 'info', messageKey: 'auth.accountRequired'}};
}
