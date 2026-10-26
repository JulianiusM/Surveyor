/** Presentation follows the operation, independently of stable API problem codes.
 * Password mismatch intentionally differs between account registration and password reset. */
export type FrontendIdentityOperation = 'login' | 'register' | 'forgot' | 'reset' | 'activate'
    | 'guest-login' | 'recovery' | 'oidc' | 'error';

/** Public login configuration selects the identity page journey, never credential authority. */
export interface IdentityLoginSettings {
    localLoginEnabled: boolean;
    oidcEnabled: boolean;
}
