import type {components} from './api/v1';

/** Request-safe renderer input. API payload shapes belong exclusively to the generated contract. */
export interface FrontendPilotBootstrap {
    session: components['schemas']['SessionView'];
    help?: components['schemas']['HelpPageData'];
    /** Initial reset-link admission shares its successful or denied API contract with Vue navigation. */
    passwordReset?: components['schemas']['PasswordResetCheck'] | components['schemas']['Problem'];
    /** Local-account setting denials on initial identity pages use the same localized API errors. */
    identityProblem?: components['schemas']['Problem'];
    initialUrl?: string;
}

export interface FrontendPilotRenderResult {
    html: string;
    /** Escaped for the contents of an application/json script element. */
    state: string;
}
