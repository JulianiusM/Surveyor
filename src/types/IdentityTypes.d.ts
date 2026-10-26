import type {Request} from 'express';
import type {EntityManager} from 'typeorm';
import type {components} from './api/v1';

/** The existing transfer/deactivation flow reports only completed former-owner
 * cleanup. Controller prose and localized API notices project the same facts; this
 * result does not promise atomicity or change the workflow's operation order. */
export type ProfileOwnerCleanup = 'none' | 'account-deleted' | 'guest-deleted';

/** Select the application-owned email/link destination without accepting arbitrary route prefixes. */
export interface IdentityLinkOptions {
    frontend?: boolean;
    next?: string;
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
