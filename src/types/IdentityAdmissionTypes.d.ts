import type {Request, Response} from 'express';
import type {Settings} from './SettingsTypes';

/** A single credential check owns tentative failure reservations until verification. */
export interface IdentityCredentialAdmission {
    account(accountId: number | null): Promise<void>;
    verified(): Promise<void>;
}

/** Only confirmed login clears the account budget; client failures survive it. */
export interface IdentityLoginAdmission extends IdentityCredentialAdmission {
    succeeded(): Promise<void>;
    finish(error?: unknown): Promise<void>;
}

export type IdentityAdmissionLimits = Pick<Settings,
    'authLoginClientLimit' | 'authLoginFailureClientLimit' | 'authLoginAccountLimit' | 'authLoginWindowMinutes'
    | 'authSignupClientLimit' | 'authSignupWindowMinutes' | 'authGuestCreationClientLimit' | 'authGuestCreationWindowMinutes'
    | 'authMailClientLimit' | 'authMailClientWindowMinutes' | 'authMailRecipientLimit' | 'authMailRecipientWindowMinutes'
    | 'authGuestLookupClientLimit' | 'authGuestLookupWindowMinutes'>;

/** Shared HTTP budgets do not own credentials, identity writes or session state. */
export interface IdentityAdmission {
    login(request: Request, response: Response, submittedIdentifier: string): Promise<IdentityLoginAdmission>;
    signup(request: Request, response: Response): Promise<void>;
    guestCreation(request: Request, response: Response): Promise<void>;
    mail(request: Request, response: Response, recipient: string): Promise<void>;
    guestLookup(request: Request, response: Response): Promise<void>;
    dispose(): void;
}
