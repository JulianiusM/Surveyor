import type {components} from './api/v1';
import type {MessageKey} from './LocalizationTypes';

/** Native packing admission has its own HTTP outcomes, independently of API problem statuses. */
export type PackingPageError = 'packing.notFound' | 'packing.eventRegistrationRequired' | 'api:errors.FORBIDDEN';

/** Request-safe renderer input. API payload shapes belong exclusively to the generated contract. */
export interface FrontendPilotBootstrap {
    session: components['schemas']['SessionView'];
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
