/*
 * Copyright 2026 Julian Malovanij
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import Joi from 'joi';
import type {EventInvoicePool} from '../database/entities/event/EventInvoicePool';
import {InvoicePoolDistributions} from '../database/entities/event/EventInvoicePool';
import type {EventRegistration} from '../database/entities/event/EventRegistration';
import type {InvoiceSharesPdfOptions, InvoicePoolSubmissionState, InvoiceOrganizerRequest} from '../../types/InvoicePoolTypes';
import {normalizeToArray} from '../lib/util';
import {APIError} from '../lib/errors';
import {invoiceText, getInvoiceValidationMessages} from './wording';

// Creation and later state changes share the same two uncalculated pool states; neither is a prerequisite for closure.
const invoicePoolSubmissionStates: InvoicePoolSubmissionState[] = ['OPEN', 'ORGANIZER_ONLY'];

/** Reject excess factor precision rather than letting validation round the financial input. */
function validateFactorPrecision(factor: number, helpers: Joi.CustomHelpers): number | Joi.ErrorReport {
    const scaled = factor * 10000;
    return Math.abs(scaled - Math.round(scaled)) < 0.0000001
        ? factor : helpers.error('number.precision', {limit: 4});
}

/** Validate creation fields and resolve the requested membership against this event's registrations. */
export function preparePoolCreation(body: any, registrations: EventRegistration[]) {
    // Validate the existing form/API fields without changing their names or accepted checkbox encodings.
    const schema = Joi.object({
        name: Joi.string().max(255).required(),
        status: Joi.string().valid(...invoicePoolSubmissionStates).default('OPEN'),
        description: Joi.string().allow('').optional(),
        isDefault: Joi.alternatives().try(Joi.boolean(), Joi.string().valid('on', '')).default(false),
        assignAll: Joi.alternatives().try(Joi.boolean(), Joi.string().valid('on', '')).default(false),
        subtractPersonalInvoices: Joi.alternatives().try(Joi.boolean(), Joi.string().valid('on', '')).default(true),
        sendCalculationEmails: Joi.alternatives().try(Joi.boolean(), Joi.string().valid('on', '')).default(true),
        roundUpShares: Joi.alternatives().try(Joi.boolean(), Joi.string().valid('on', '')).default(true),
        registrations: Joi.alternatives().try(
            Joi.array().items(Joi.number().integer()),
            Joi.number().integer(),
        ).optional(),
        distribution: Joi.string().valid(...InvoicePoolDistributions).required(),
    });
    const {error, value} = schema.validate(body, {messages: getInvoiceValidationMessages(), abortEarly: false, allowUnknown: true});
    if (error) throw new APIError(error.message, body, 400);

    // Default pools auto-attach to future participants without forcing current pools to be "assign all".
    const isDefault = value.isDefault === true || value.isDefault === 'on';
    const assignAll = value.assignAll === true || value.assignAll === 'on';
    const subtractPersonalInvoices = value.subtractPersonalInvoices === true || value.subtractPersonalInvoices === 'on';
    // Filter requested membership through the event list; assign-all is independent of the default-pool flag.
    const regIdsRaw = normalizeToArray(value.registrations);
    const allowedIds = registrations.map((r) => r.id);
    const regIds = assignAll ? allowedIds : regIdsRaw.filter((id: number) => allowedIds.includes(Number(id))).map(Number);

    // Return normalized data only; the controller chooses the persistence operation.
    return {name: value.name, description: value.description, distribution: value.distribution, status: value.status as InvoicePoolSubmissionState,
        isDefault, assignAll, subtractPersonalInvoices, registrationIds: regIds,
        sendCalculationEmails: value.sendCalculationEmails === true || value.sendCalculationEmails === 'on',
        roundUpShares: value.roundUpShares === true || value.roundUpShares === 'on'};
}

/** Normalize assignment edits without applying them or rebuilding existing calculated shares. */
export function preparePoolAssignments(pool: EventInvoicePool, body: any, registrations: EventRegistration[]) {
    // Enforce precision without silently rounding factors supplied by API clients.
    const {error, value} = Joi.object({
        participantFactors: Joi.object().pattern(/^[1-9]\d*$/, Joi.number().min(0).max(1000).custom(validateFactorPrecision)).default({}),
    }).validate(body, {messages: getInvoiceValidationMessages(), abortEarly: false, allowUnknown: true});
    if (error) throw new APIError(error.message, body, 400);
    // Preserve an omitted reimbursement flag and normalize each explicit membership/exemption selection.
    const isDefault = body.isDefault === true || body.isDefault === 'on';
    const assignAll = body.assignAll === true || body.assignAll === 'on';
    const subtractPersonalInvoices = body.subtractPersonalInvoices === undefined
        ? pool.subtractPersonalInvoices
        : body.subtractPersonalInvoices === true || body.subtractPersonalInvoices === 'on';
    const regIdsRaw = normalizeToArray(body.registrations);
    const exemptIdsRaw = normalizeToArray(body.exemptions);
    const allowedIds = registrations.map((r) => r.id);
    const regIds = assignAll ? allowedIds : regIdsRaw.map(Number).filter((id: number) => allowedIds.includes(id));
    const exemptIds = exemptIdsRaw.map(Number).filter((id: number) => allowedIds.includes(id));
    const participantFactors = value.participantFactors as Record<number, number>;
    // A factor for a removed or foreign registration is a rejected edit, never an ignored assignment.
    if (Object.keys(participantFactors).some((id) => !regIds.includes(Number(id)))) {
        throw new APIError(invoiceText('factorsCanOnlyBeSetForParticipantsAssignedTo'), body, 400);
    }

    return {isDefault, assignAll, subtractPersonalInvoices, registrationIds: regIds, exemptIds, participantFactors};
}

/** Preserve participant versus organizer takeover authority while normalizing requested beneficiaries. */
export function prepareTakeoverRequest(pool: EventInvoicePool, body: any, registrations: EventRegistration[], actorRegistrationId: number | undefined, allowReassign: boolean) {
    const schema = Joi.object({
        payerId: Joi.number().integer().optional(),
        beneficiaries: Joi.alternatives().try(Joi.array().items(Joi.number().integer()), Joi.number().integer()).default([]),
    });
    const {error, value} = schema.validate(body, {messages: getInvoiceValidationMessages(), abortEarly: false, allowUnknown: true});
    if (error) throw new APIError(error.message, body, 400);

    // Participants can edit only their own payer row; organizers may explicitly select a different payer.
    const payerId = value.payerId ? Number(value.payerId) : actorRegistrationId;
    if (!payerId) throw new APIError(invoiceText('mustBeRegisteredToManageTakeovers'), body, 401);
    if (!allowReassign && actorRegistrationId && payerId !== actorRegistrationId) {
        throw new APIError(invoiceText('notAllowedToAssignTakeoversForOtherParticipants'), body, 403);
    }

    // Normalize one or many beneficiaries, then keep only assigned members other than the payer.
    let beneficiaries: number[] = [];
    if (Array.isArray(value.beneficiaries)) {
        beneficiaries = value.beneficiaries.map(Number);
    } else if (value.beneficiaries) {
        beneficiaries = [Number(value.beneficiaries)];
    }

    const allowedIds = pool.assignAll
        ? registrations.map((r) => r.id)
        : pool.assignments.map((a) => a.registration.id);
    if (!allowedIds.includes(payerId)) throw new APIError(invoiceText('payerIsNotPartOfThisPool'), body, 400);

    const normalizedBeneficiaries: number[] = Array.from(new Set(beneficiaries)).filter(
        (id) => allowedIds.includes(id) && id !== payerId,
    );
    // Coverage is one level deep: a covered participant cannot become a payer, or cover another participant.
    const existing = pool.takeovers || [];
    const payerCovered = existing.some((t) => t.beneficiaryRegistrationId === payerId);
    if (payerCovered && normalizedBeneficiaries.length) {
        throw new APIError(invoiceText('participantsWhoseShareIsTakenOverCannotCoverOthers'), body, 400);
    }

    const blockedBeneficiaries = existing.filter((t) => normalizedBeneficiaries.includes(t.payerRegistrationId));
    if (blockedBeneficiaries.length) {
        throw new APIError(invoiceText('aParticipantBeingCoveredCannotTakeOverOtherShares'), body, 400);
    }

    // Reassignment is organizer-only. The locked operation repeats these checks against current saved coverage.
    const conflicting = existing.filter(
        (t) => normalizedBeneficiaries.includes(t.beneficiaryRegistrationId) && t.payerRegistrationId !== payerId,
    );
    if (conflicting.length && !allowReassign) {
        throw new APIError(invoiceText('oneOrMoreParticipantsAreAlreadyCoveredBySomeone'), body, 400);
    }

    return {payerId, beneficiaryIds: normalizedBeneficiaries};
}

/** Normalize editable pool settings while preserving optional-field and checkbox behavior. */
export function preparePoolSettings(body: any) {
    const schema = Joi.object({
        description: Joi.string().allow('').optional(),
        distribution: Joi.string().valid(...InvoicePoolDistributions).required(),
        sendCalculationEmails: Joi.alternatives().try(Joi.boolean(), Joi.string().valid('on', '')).optional(),
        roundUpShares: Joi.alternatives().try(Joi.boolean(), Joi.string().valid('on', '')).optional(),
    });
    const {error, value} = schema.validate(body, {messages: getInvoiceValidationMessages(), abortEarly: false, allowUnknown: true});
    if (error) throw new APIError(error.message, body, 400);
    return value;
}

/** Validate a nonzero signed adjustment, keeping the existing two-decimal request contract. */
export function prepareSurchargeRequest(body: any) {
    // Reject excessive precision and zero amounts instead of silently normalizing financial edits.
    const schema = Joi.object({
        registrationId: Joi.number().integer().positive().required(),
        amount: Joi.number().min(-99999999.99).max(99999999.99).invalid(0).custom(validateMoneyPrecision).required(),
        note: Joi.string().trim().max(4000).required(),
        subtractFromPool: Joi.alternatives().try(Joi.boolean(), Joi.string().valid('on', '')).default(true),
    });
    // Return the validated signed request; membership and locked persistence belong to the orchestration flow.
    const {error, value} = schema.validate(body, {messages: getInvoiceValidationMessages(), abortEarly: false, allowUnknown: true});
    if (error) throw new APIError(error.message, body, 400);
    return value;
}

/** Validate submitted invoice fields before the controller resolves pool eligibility and proof. */
export function prepareSubmittedInvoice(body: any) {
    const schema = Joi.object({
        amount: Joi.number().positive().required(),
        description: Joi.string().allow('').optional(),
    });
    const {error, value} = schema.validate(body, {messages: getInvoiceValidationMessages(), abortEarly: false, allowUnknown: true});
    if (error) throw new APIError(error.message, body, 400);
    return value;
}

/** Validate organizer entry and optional paid-by attribution without creating or changing participant membership. */
export function prepareOrganizerInvoice(body: any): InvoiceOrganizerRequest {
    // An empty form selection preserves existing shared costs. An explicit selection must be a single positive ID.
    const {error, value} = Joi.object({
        amount: Joi.number().positive().max(99999999.99).required(),
        description: Joi.string().trim().max(4000).required(),
        registrationId: Joi.number().integer().positive().empty('').optional(),
    }).validate(body || {}, {messages: getInvoiceValidationMessages(), abortEarly: false, allowUnknown: true});
    if (error) throw new APIError(error.message, {}, 400);
    // Membership is checked against current event and pool rows under the creation transaction's lock.
    return value;
}

/** Normalize optional acceptance corrections while keeping the submitted evidence separate. */
export function prepareInvoiceAcceptance(body: any) {
    // Acceptance permits optional overrides while retaining the original submitted amount and description.
    const schema = Joi.object({
        correctedAmount: Joi.number().positive().allow(null, '').optional(),
        correctedDescription: Joi.string().max(4000).allow('').optional(),
    });
    const {error, value} = schema.validate(body || {}, {messages: getInvoiceValidationMessages(), abortEarly: false, allowUnknown: true});
    if (error) throw new APIError(error.message, body, 400);
    // Empty optional corrections restore submitted values rather than saving a second competing amount.
    const correctedAmount = value.correctedAmount === '' || value.correctedAmount === null || value.correctedAmount === undefined
        ? null
        : value.correctedAmount;
    const correctedDescription = value.correctedDescription?.trim() || null;
    return {correctedAmount, correctedDescription};
}

/** Require a bounded rejection reason before saving an unreviewed invoice decision. */
export function prepareInvoiceRejection(body: any) {
    const schema = Joi.object({
        rejectionReason: Joi.string().trim().min(1).max(4000).required(),
    });
    const {error, value} = schema.validate(body || {}, {messages: getInvoiceValidationMessages(), abortEarly: false, allowUnknown: true});
    if (error) throw new APIError(error.message, body, 400);
    return value;
}

/** Preserve the existing revision/confirmation fields for accepted-invoice changes and retraction. */
export function prepareConfirmedInvoiceChange(body: unknown, fields: Joi.SchemaMap = {}) {
    // These fields already belong to correction/retraction APIs; new frontend gates do not extend other commands.
    const {error, value} = Joi.object({
        ...fields,
        confirmed: Joi.boolean().valid(true).strict().required(),
        expectedRevision: Joi.number().integer().min(0).required(),
    }).validate(body || {}, {messages: getInvoiceValidationMessages(), abortEarly: false, allowUnknown: true});
    if (error) throw new APIError(error.message, {}, 400);
    return value;
}

/** Interpret optional calculation notification and revision fields without adding new API requirements. */
export function prepareCalculationOptions(body: unknown) {
    const {error, value} = Joi.object({
        sendEmails: Joi.alternatives().try(Joi.boolean(), Joi.string().valid('on', '')).optional(),
        expectedRevision: Joi.number().integer().min(0).optional(),
    }).validate(body, {messages: getInvoiceValidationMessages(), allowUnknown: true});
    if (error) throw new APIError(error.message, {}, 400);
    return value as {sendEmails?: boolean | 'on' | ''; expectedRevision?: number};
}

/** Normalize the optional PDF example toggle while preserving the existing export's default contents. */
export function prepareSharesPdfOptions(query: unknown = {}): InvoiceSharesPdfOptions {
    // Accept one explicit boolean query value; arrays or nested objects must not silently select an export variant.
    const {error, value} = Joi.object({example: Joi.boolean().default(true)}).validate(query, {
        messages: getInvoiceValidationMessages(), allowUnknown: true,
    });
    if (error) throw new APIError(error.message, {}, 400);
    // This preference is presentation-only: every variant uses identical authorized saved share records.
    return {includeExampleCalculation: value.example};
}

/** Normalize a submission-access transition without accepting a financial close through this operation. */
export function preparePoolSubmissionState(body: unknown): {status: InvoicePoolSubmissionState; expectedRevision: number} {
    // The existing close/calculation command remains the only route to saved CLOSED shares.
    const {error, value} = Joi.object({
        status: Joi.string().valid(...invoicePoolSubmissionStates).required(),
        expectedRevision: Joi.number().integer().min(0).required(),
    }).validate(body, {messages: getInvoiceValidationMessages(), allowUnknown: true});
    if (error) throw new APIError(error.message, {}, 400);
    // Return only the validated independent state and revision; frontend confirmation is not an API requirement.
    return value;
}

/** Normalize a revision-checked correction of an accepted or closed invoice. */
export function prepareInvoiceRevision(body: unknown) {
    // Null explicitly restores original evidence; the locked mutation checks the revision and lifecycle state.
    return prepareConfirmedInvoiceChange(body, {
        correctedAmount: Joi.number().positive().max(99999999.99).allow(null).required(),
        correctedDescription: Joi.string().trim().max(4000).allow('', null).required(),
    });
}

/** Normalize a revision-checked rejection of a counted invoice. */
export function prepareAcceptedInvoiceRejection(body: unknown) {
    return prepareConfirmedInvoiceChange(body, {rejectionReason: Joi.string().trim().max(4000).required()});
}

/** Preserve the existing two-decimal tolerance for signed adjustment requests. */
function validateMoneyPrecision(amount: number, helpers: Joi.CustomHelpers): number | Joi.ErrorReport {
    const cents = amount * 100;
    return Math.abs(cents - Math.round(cents)) < 0.00001
        ? amount : helpers.error('number.precision', {limit: 2});
}
