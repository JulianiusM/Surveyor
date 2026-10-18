import type {components} from './api/v1';
import type {MessageKey} from './LocalizationTypes';

/** Native packing admission has its own HTTP outcomes, independently of API problem statuses. */
export type PackingPageError = 'packing.notFound' | 'packing.eventRegistrationRequired' | 'common.notAllowed';

/** A confirmed message result belongs to one actor and canonical destination;
 * it scopes the in-memory SPA completion receipt independently of later admission. */
export interface FrontendPageCompletion {
    context: components['schemas']['SessionView']['context'];
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

/** A request chooses the native landing shortcut once; hydration reuses that choice. */
export type FrontendLandingQuickCreate = 'survey' | 'event' | 'activity' | 'packing' | 'drivers';

/** Initial private identity presentation shares the mounted workflow's markup.
 * Tokens never enter URL/query caches and cannot confer backend authority. */
export type FrontendProfileWorkflow = {
    kind: 'token';
    token: string;
} | {
    kind: 'entry';
} | {
    kind: 'deactivate';
    value: string;
} | {
    kind: 'delete-account';
    value: string;
};

/** Escaped document presentation, supplied by the server's outcome owner rather than URL text. */
export type FrontendCommonPage = {
    /** Known parameter-free outcomes retranslate without treating arbitrary detail as a key. */
    messageKey?: MessageKey;
} & ({
    kind: 'message';
    severity: 'info' | 'success' | 'warning' | 'error';
    message: string;
    status?: number;
} | {
    kind: 'error';
    message: string;
    status: number;
    /** The document adapter admits diagnostics only in development. */
    stack?: string;
});

/** Request-safe renderer input. API payload shapes belong exclusively to the generated contract. */
export interface FrontendPilotBootstrap {
    session: components['schemas']['SessionView'];
    landing?: {quickCreate: FrontendLandingQuickCreate};
    commonPage?: FrontendCommonPage;
    /** One initial document/actor owns its private token or empty workflow form. */
    profileWorkflow?: FrontendProfileWorkflow;
    /** The initial document and SPA navigation consume the same server-owned admission decision. */
    pageEntry?: components['schemas']['PageEntryOutcome'];
    /** One-time native redirect feedback, rendered before and after hydration. */
    pageNotice?: components['schemas']['EntryNotice'];
    /** An explicitly supplied completion is consumed once by the shared context owner. */
    pageCompletion?: FrontendPageCompletion;
    help?: components['schemas']['HelpPageData'];
    /** Initial reset-link admission shares its successful or denied API contract with Vue navigation. */
    passwordReset?: components['schemas']['PasswordResetCheck'] | components['schemas']['Problem'];
    /** Local-account setting denials on initial identity pages use the same localized API errors. */
    identityProblem?: components['schemas']['Problem'];
    identityFeedback?: MessageKey;
    guestEntry?: components['schemas']['GuestEntry'];
    packingError?: PackingPageError;
    /** Only admitted creation/duplication forms receive these public form definitions and copied values. */
    packingCreateContext?: components['schemas']['PackingCreateContext'];
    /** An initial event query is resolved by the shared native selection owner before drafting. */
    packingSelectedEvent?: components['schemas']['EventPickerOption'] | null;
    packingDuplicate?: components['schemas']['PackingDuplicate'];
    /** Drivers shares guest admission and form definitions; copied lists contain no rides. */
    driversCreateContext?: components['schemas']['DriversCreateContext'];
    driversSelectedEvent?: components['schemas']['EventPickerOption'] | null;
    driversDuplicate?: components['schemas']['DriversDuplicate'];
    /** Event document admission never carries the complete native invoice aggregate. */
    eventEntry?: components['schemas']['EventResourceEntry'];
    eventCreateContext?: components['schemas']['EventCreateContext'];
    eventDuplicate?: components['schemas']['EventDuplicate'];
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
    /** Shared route/admission classification identifies content awaiting client initialization. */
    javascriptRequired: boolean;
}

/** The complete SSR document already exists; its owning response only sends these immutable bytes. */
export interface FrontendPreparedDocument {
    readonly html: string;
}
