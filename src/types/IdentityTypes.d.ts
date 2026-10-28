import type {Request} from 'express';
import type {EntityManager} from 'typeorm';
import type {components} from './api/v1';
import type {TokenEndpointResponse} from 'openid-client';
import type {OidcClaims} from './UserTypes';
import type {PreparedIdentityEmail} from './EmailTypes';
import type {IdentityCredentialAdmission} from './IdentityAdmissionTypes';

/** Verified provider evidence; local account selection and session completion remain controller-owned. */
export interface OidcLoginEvidence {
    issuer: string;
    identityClaims: OidcClaims;
    tokens: TokenEndpointResponse;
}

/** Completed former-owner cleanup facts shared by transfer and deactivation.
 * Each operation retains its own approved transaction and completion boundary. */
export type ProfileOwnerCleanup = 'none' | 'account-deleted' | 'guest-deleted';

/** Provider preparation follows confirmed local sign-out; absence preserves ordinary successful handoff. */
export interface ProviderLogoutOutcome {
    redirect: string;
    providerLogout?: 'unconfirmed';
}

/** Private provider handoff evidence captured before committed local deletion.
 * It is never included in a public local-completion or diagnostic projection. */
export interface ProviderLogoutEvidence {
    readonly idTokenHint?: string;
}

/** Validate/serialize scalar completion without queries, writes or authority
 * changes. Business receipts are prepared before commit; a provider delivery
 * URL may be prepared afterward only with an already prepared local fallback. */
export type ProfileWorkflowPreparation<Result> = (completion: components['schemas']['ProfileWorkflowCompletion']) => Result | Promise<Result>;

/** Required former-owner persistence and notification preparation have completed on the supplied manager. */
export interface PreparedOwnerCleanup {
    cleanup: ProfileOwnerCleanup;
    emails: PreparedIdentityEmail[];
}

/** Select the application-owned email/link destination without accepting arbitrary route prefixes. */
export interface IdentityLinkOptions {
    frontend?: boolean;
    next?: string;
    credentialAdmission?: IdentityCredentialAdmission;
    beforeIdentityMail?: (recipient: string) => Promise<void>;
}

/** Optional transport admission check immediately before an asynchronous identity operation commits. */
export interface IdentityTransitionOptions extends IdentityLinkOptions {
    beforeTransition?: () => Promise<void>;
}

/** Delivery belongs to the authored identity response; it never changes creation confirmation. */
export type RegistrationEmailDelivery = components['schemas']['EmailDelivery'];

/** A controller receives the captured context, never a profile/context selected by posted fields. */
export interface IdentityTransactionOptions extends IdentityLinkOptions {
    context: string | null;
}

/** Prepare every possible delivery receipt while the guest/profile/session transaction can still roll back. */
export interface GuestRegistrationTransactionOptions<Result> extends IdentityTransactionOptions {
    prepareResult: (session: Request['session'], personalLink: string) => Record<RegistrationEmailDelivery, Result>
        | Promise<Record<RegistrationEmailDelivery, Result>>;
}

/** Prepare completion on isolated staging. Actor-preserving token/signup operations opt into
 * document feedback persistence; ordinary identity rotations always write their new authority. */
export interface IdentityCompletionOptions<Result> extends IdentityTransactionOptions {
    persistCompletion?: boolean;
    prepareResult: (session: Request['session'], manager: EntityManager) => Result | Promise<Result>;
}

/** Signup prepares all delivery variants through the same captured completion owner. */
export type AccountRegistrationTransactionOptions<Result> = IdentityCompletionOptions<Record<RegistrationEmailDelivery, Result>>;

/** The locked operation and any required document completion have already committed together. */
export interface IdentityCompletionReceipt<Result> {
    readonly session: Request['session'];
    readonly result: Result;
}

/** The transaction has committed; session adoption and mail delivery cannot reopen creation admission. */
export interface RegistrationReceipt<Result> {
    readonly session: Request['session'];
    readonly result: Result;
    readonly emailDelivery: RegistrationEmailDelivery;
}
