import type {components} from './api/v1';
import type {MessageKey} from './LocalizationTypes';

/** Native packing admission has its own HTTP outcomes, independently of API problem statuses. */
export type PackingPageError = 'packing.notFound' | 'packing.eventRegistrationRequired' | 'common.notAllowed';

/** A confirmed message result belongs to one actor and canonical destination. The same
 * declaration seeds native POST rendering and scopes in-memory SPA completion receipts. */
export interface FrontendPageCompletion {
    context: string;
    destination: string;
    messageKey: MessageKey;
    kind: 'success' | 'info';
}

/** Existing one-time guest-link flash data is admitted only for its committed identity context. */
export interface FrontendGuestLinkHandoff {
    context: string;
    personalLink: string;
}

/** A document identity command prepares this redirect before its final persistence. */
export interface FrontendIdentityRedirect {
    readonly status: 303;
    readonly destination: string;
}

/** Request-safe renderer input. API payload shapes belong exclusively to the generated contract. */
export interface FrontendPilotBootstrap {
    session: components['schemas']['SessionView'];
    /** The initial document and SPA navigation consume the same server-owned admission decision. */
    pageEntry?: components['schemas']['PageEntryOutcome'];
    /** One-time native redirect feedback, rendered before and after hydration. */
    pageNotice?: components['schemas']['EntryNotice'];
    /** Initial confirmed POST presentation is consumed once by the shared context owner. */
    pageCompletion?: FrontendPageCompletion;
    help?: components['schemas']['HelpPageData'];
    /** Initial reset-link admission shares its successful or denied API contract with Vue navigation. */
    passwordReset?: components['schemas']['PasswordResetCheck'] | components['schemas']['Problem'];
    /** Local-account setting denials on initial identity pages use the same localized API errors. */
    identityProblem?: components['schemas']['Problem'];
    /** Native and hydrated forms share safe redisplay values; passwords are never serialized. */
    identityFields?: Partial<Pick<components['schemas']['RegistrationInput'], 'username' | 'displayname' | 'email'>>;
    identityFormProblem?: components['schemas']['Problem'];
    identityFeedback?: MessageKey;
    guestEntry?: components['schemas']['GuestEntry'];
    packingError?: PackingPageError;
    /** Only admitted creation/duplication forms receive these public form definitions and copied values. */
    packingCreateContext?: components['schemas']['PackingCreateContext'];
    /** An initial event query is resolved by the shared native selection owner before drafting. */
    packingSelectedEvent?: components['schemas']['EventPickerOption'] | null;
    packingDuplicate?: components['schemas']['PackingDuplicate'];
    personalLink?: string;
    /** Controller-projected native regions hydrate under their ordinary identity-scoped query keys. */
    overview?: components['schemas']['OverviewRegion'][];
    initialUrl?: string;
}

export interface FrontendPilotRenderResult {
    html: string;
    title: string;
    /** Escaped for the contents of an application/json script element. */
    state: string;
    /** The renderer supplies an explicit fallback outside the tree that Vue hydrates. */
    javascriptRequired: boolean;
}

/** The complete SSR document already exists; its owning response only sends these immutable bytes. */
export interface FrontendPreparedDocument {
    readonly html: string;
}
