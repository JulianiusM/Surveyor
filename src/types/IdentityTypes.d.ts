/** Presentation follows the native operation, independently of stable API problem codes.
 * Password mismatch intentionally differs between account registration and password reset. */
export type FrontendIdentityOperation = 'login' | 'register' | 'forgot' | 'reset' | 'activate'
    | 'guest-login' | 'recovery' | 'oidc' | 'error';

/** Public login configuration selects the native identity page journey, never credential authority. */
export interface IdentityLoginSettings {
    localLoginEnabled: boolean;
    oidcEnabled: boolean;
}

/** Select the application-owned email/link destination without accepting arbitrary route prefixes. */
export interface IdentityLinkOptions {
    frontend?: boolean;
    next?: string;
}

/** Optional transport admission check immediately before an asynchronous identity operation commits. */
export interface IdentityTransitionOptions extends IdentityLinkOptions {
    beforeTransition?: () => Promise<void>;
}
