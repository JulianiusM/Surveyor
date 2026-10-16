import type {FrontendPilotBootstrap, PackingPageError} from '../../types/FrontendPilotTypes';
import {validateSessionView} from '../../../.generated/api/v1/browser/validateSessionView.mjs';
import {validateProblem} from '../../../.generated/api/v1/browser/validateProblem.mjs';
import {validatePageEntryOutcome} from '../../../.generated/api/v1/browser/validatePageEntryOutcome.mjs';
import {validateEntryNotice} from '../../../.generated/api/v1/browser/validateEntryNotice.mjs';
import {frontendIdentityFeedback} from '../../modules/lib/frontendIdentity';
import {isPlainMessageKey} from '../../modules/localization/translator';

/** Every declared field has one validation owner. The required mapped keys deliberately
 * include optional bootstrap properties: a new renderer field must also define its browser
 * boundary here. Decoding preserves the validated object instead of maintaining a second
 * reconstruction whitelist that can silently discard a server-owned outcome. */
const bootstrapValidators = {
    session: validateSessionView,
    landing: validateLanding,
    commonPage: validateCommonPage,
    profileWorkflow: validateProfileWorkflow,
    pageEntry: validatePageEntryOutcome,
    pageNotice: validateEntryNotice,
    pageCompletion: validateCompletion,
    help: validateHelp,
    passwordReset: validateReset,
    identityProblem: validateProblem,
    identityFeedback: validateIdentityFeedback,
    guestEntry: validateGuest,
    packingError: validatePackingError,
    packingCreateContext: validatePackingCreate,
    packingSelectedEvent: validatePackingSelectedEvent,
    packingDuplicate: validatePackingDuplicate,
    eventEntry: validateEventEntry,
    eventCreateContext: validateEventCreateContext,
    eventDuplicate: validateEventDuplicate,
    personalLink: validateString,
    overview: validateOverview,
    initialUrl: validateString,
} satisfies {[Field in keyof FrontendPilotBootstrap]-?: (value: unknown) => boolean | Promise<boolean>};

/** Validate the complete wire object before it enters reactive application state. Unknown
 * fields fail closed, and feature validators load only when their initial data is present. */
export async function decodeBootstrap(value: unknown): Promise<FrontendPilotBootstrap> {
    if (!isRecord(value) || !Object.hasOwn(value, 'session')) throw new Error('Invalid pilot bootstrap.');

    for (const [field, payload] of Object.entries(value)) {
        if (!Object.hasOwn(bootstrapValidators, field)) throw new Error('Invalid pilot bootstrap field.');
        const validate = bootstrapValidators[field as keyof FrontendPilotBootstrap];
        if (!await validate(payload)) throw new Error(`Invalid pilot bootstrap field: ${field}.`);
    }

    // All declared values have crossed their runtime validator; preserving them together
    // keeps native admission, feedback and confirmed completion intact during hydration.
    return value as unknown as FrontendPilotBootstrap;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateString(value: unknown): boolean {
    return typeof value === 'string';
}

/** Landing randomness is presentation only; require a known feature before using it as a link target. */
function validateLanding(value: unknown): boolean {
    return isRecord(value) && Object.keys(value).length === 1
        && typeof value.quickCreate === 'string'
        && ['survey', 'event', 'activity', 'packing', 'drivers'].includes(value.quickCreate);
}

/** Admit the exact private document projection, never a serialized profile/account row. */
function validateProfileWorkflow(value: unknown): boolean {
    if (!isRecord(value)) return false;
    // Each variant owns only its native presentation fields. In particular, an
    // input form cannot acquire another variant's preview, token or error identity.
    if (value.kind === 'entry') return Object.keys(value).length === 1;
    if (value.kind === 'token') return typeof value.token === 'string' && Object.keys(value).length === 2;
    if (value.kind !== 'deactivate' && value.kind !== 'delete-account' || typeof value.value !== 'string') return false;
    return Object.keys(value).every(key => ['kind', 'value'].includes(key));
}

/** Validate every readable server outcome without admitting URL-selected HTML or diagnostic objects. */
function validateCommonPage(value: unknown): boolean {
    // Both variants render escaped text. Explicit fields keep error stacks out of
    // message data and bound status to the document's HTTP presentation range.
    if (!isRecord(value) || typeof value.message !== 'string'
        || value.messageKey !== undefined && !isPlainMessageKey(value.messageKey)) return false;
    const validStatus = Number.isInteger(value.status) && Number(value.status) >= 100 && Number(value.status) <= 599;
    if (value.kind === 'error') {
        return validStatus && (value.stack === undefined || typeof value.stack === 'string')
            && Object.keys(value).every(key => ['kind', 'message', 'messageKey', 'status', 'stack'].includes(key));
    }
    return value.kind === 'message' && typeof value.severity === 'string'
        && ['info', 'success', 'warning', 'error'].includes(value.severity)
        && (value.status === undefined || validStatus)
        && Object.keys(value).every(key => ['kind', 'severity', 'message', 'messageKey', 'status'].includes(key));
}

/** Completion is application presentation, not an API result. Its actor and destination
 * are checked again by the context/view owner; only known parameter-free labels can render. */
function validateCompletion(value: unknown): boolean {
    if (!isRecord(value)) return false;
    return Object.keys(value).length === 4 && (value.context === null || typeof value.context === 'string')
        && typeof value.destination === 'string' && isPlainMessageKey(value.messageKey)
        && (value.kind === 'success' || value.kind === 'info');
}

function validateIdentityFeedback(value: unknown): boolean {
    return typeof value === 'string' && frontendIdentityFeedback.includes(value as typeof frontendIdentityFeedback[number]);
}

// Require every declared native admission label at the browser boundary. An added
// server outcome must update this owner too, instead of silently failing hydration.
const packingPageErrors = {
    'packing.notFound': true,
    'packing.eventRegistrationRequired': true,
    'common.notAllowed': true,
} satisfies Record<PackingPageError, true>;

function validatePackingError(value: unknown): boolean {
    return typeof value === 'string' && Object.hasOwn(packingPageErrors, value);
}

async function validateHelp(value: unknown): Promise<boolean> {
    const {validateHelpPageData} = await import('../../../.generated/api/v1/browser/validateHelpPageData.mjs');
    return validateHelpPageData(value);
}

async function validateReset(value: unknown): Promise<boolean> {
    const {validatePasswordResetCheck} = await import('../../../.generated/api/v1/browser/validatePasswordResetCheck.mjs');
    return validatePasswordResetCheck(value) || validateProblem(value);
}

async function validateGuest(value: unknown): Promise<boolean> {
    const {validateGuestEntry} = await import('../../../.generated/api/v1/browser/validateGuestEntry.mjs');
    return validateGuestEntry(value);
}

async function validatePackingCreate(value: unknown): Promise<boolean> {
    const {validatePackingCreateContext} = await import('../../../.generated/api/v1/browser/validatePackingCreateContext.mjs');
    return validatePackingCreateContext(value);
}

/** Initial selection uses the same generated option contract as API discovery.
 * Null is a confirmed absence, including a rejected contextual URL selection. */
async function validatePackingSelectedEvent(value: unknown): Promise<boolean> {
    if (value === null) return true;
    const {validateEventPickerOption} = await import('../../../.generated/api/v1/browser/validateEventPickerOption.mjs');
    return validateEventPickerOption(value);
}

async function validatePackingDuplicate(value: unknown): Promise<boolean> {
    const {validatePackingDuplicate: validatePayload} = await import('../../../.generated/api/v1/browser/validatePackingDuplicate.mjs');
    return validatePayload(value);
}

async function validateEventEntry(value: unknown): Promise<boolean> {
    const {validateEventResourceEntry} = await import('../../../.generated/api/v1/browser/validateEventResourceEntry.mjs');
    return validateEventResourceEntry(value);
}

async function validateEventCreateContext(value: unknown): Promise<boolean> {
    const {validateEventCreateContext: validate} = await import('../../../.generated/api/v1/browser/validateEventCreateContext.mjs');
    return validate(value);
}

async function validateEventDuplicate(value: unknown): Promise<boolean> {
    const {validateEventDuplicate: validate} = await import('../../../.generated/api/v1/browser/validateEventDuplicate.mjs');
    return validate(value);
}


async function validateOverview(value: unknown): Promise<boolean> {
    const {validateOverviewRegion} = await import('../../../.generated/api/v1/browser/validateOverviewRegion.mjs');
    return Array.isArray(value) && value.every(validateOverviewRegion);
}

/** Keep bootstrap JSON inert inside an HTML script element, including translated or help text. */
export function serializeBootstrap(bootstrap: FrontendPilotBootstrap): string {
    return JSON.stringify(bootstrap).replace(/</gu, '\\u003c').replace(/>/gu, '\\u003e')
        .replace(/&/gu, '\\u0026').replace(/\u2028/gu, '\\u2028').replace(/\u2029/gu, '\\u2029');
}
