import type {FrontendPilotBootstrap} from '../../types/FrontendPilotTypes';
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
    pageEntry: validatePageEntryOutcome,
    pageNotice: validateEntryNotice,
    pageCompletion: validateCompletion,
    help: validateHelp,
    passwordReset: validateReset,
    identityProblem: validateProblem,
    identityFields: validateIdentityFields,
    identityFormProblem: validateProblem,
    identityFeedback: validateIdentityFeedback,
    guestEntry: validateGuest,
    packingError: validatePackingError,
    packingCreateContext: validatePackingCreate,
    packingDuplicate: validatePackingDuplicate,
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

/** Completion is application presentation, not an API result. Its actor and destination
 * are checked again by the context/view owner; only known parameter-free labels can render. */
function validateCompletion(value: unknown): boolean {
    if (!isRecord(value)) return false;
    return Object.keys(value).length === 4 && typeof value.context === 'string'
        && typeof value.destination === 'string' && isPlainMessageKey(value.messageKey)
        && (value.kind === 'success' || value.kind === 'info');
}

function validateIdentityFields(value: unknown): boolean {
    if (!isRecord(value)) return false;
    for (const [field, payload] of Object.entries(value)) {
        if (!['username', 'displayname', 'email'].includes(field) || typeof payload !== 'string') return false;
    }
    return true;
}

function validateIdentityFeedback(value: unknown): boolean {
    return typeof value === 'string' && frontendIdentityFeedback.includes(value as typeof frontendIdentityFeedback[number]);
}

function validatePackingError(value: unknown): boolean {
    return typeof value === 'string'
        && ['packing.notFound', 'packing.eventRegistrationRequired', 'api:errors.FORBIDDEN'].includes(value);
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

async function validatePackingDuplicate(value: unknown): Promise<boolean> {
    const {validatePackingDuplicate: validatePayload} = await import('../../../.generated/api/v1/browser/validatePackingDuplicate.mjs');
    return validatePayload(value);
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
