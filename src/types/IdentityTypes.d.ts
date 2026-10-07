/** Select the application-owned email/link destination without accepting arbitrary route prefixes. */
export interface IdentityLinkOptions {
    frontend?: boolean;
    next?: string;
}

/** Optional transport admission check immediately before an asynchronous identity operation commits. */
export interface IdentityTransitionOptions extends IdentityLinkOptions {
    beforeTransition?: () => Promise<void>;
}
