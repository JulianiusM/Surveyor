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

// controller/eventPoolController.ts
import {differenceInCalendarDays} from "date-fns";
import {Request} from 'express';
import Joi from 'joi';
// Invoice pool and invoice workflow handlers extracted from the event controller for clarity and reuse.
import fs from 'node:fs';
import path from 'node:path';
import {Event} from '../modules/database/entities/event/Event';
import {EventInvoice} from "../modules/database/entities/event/EventInvoice";
import {EventInvoicePool, InvoicePoolDistributions} from "../modules/database/entities/event/EventInvoicePool";
import {EventRegistration} from "../modules/database/entities/event/EventRegistration";
import * as invoiceService from '../modules/database/services/EventInvoiceService';
import * as eventService from '../modules/database/services/EventService';

import mailer, {type EmailContent, type EmailRecipient, resolveEmailRecipientName} from '../modules/email';
import type {Profile} from '../modules/database/entities/user/Profile';
import {buildInvoiceSettlementEmail} from '../modules/lib/invoiceSettlementEmail';
import {APIError} from '../modules/lib/errors';
import {distributeInvoiceAmount} from '../modules/lib/invoiceDistribution';
import {
    formatAmount,
    normalizeToArray,
    resolveActorLabel,
    resolveInvoiceAmount,
    toAmount,
} from '../modules/lib/util';
import settings from '../modules/settings';
import type {ParticipantRow} from "../types/EventTypes";
import type {InvoicePoolDistribution} from "../types/InvoicePoolTypes";
import type {PermBundle} from '../types/PermissionTypes';

// Resolve the registration ID for the current actor so validation stays localized.
async function getActorRegistrationId(event: Event, session: Request['session']) {
    if (!session.profile) return undefined;

    const registration = await eventService.getRegistrationFor(session.profile.id, event.id);
    return registration?.id;
}

// Pull the pool and ensure it belongs to the current event.
async function ensurePool(event: Event, poolId: string) {
    const pool = await invoiceService.getPoolWithInvoices(poolId);
    if (pool?.event.id !== event.id) {
        throw new APIError('Pool not found', {}, 404);
    }
    return pool;
}

function eventPageUrl(event: Event): string {
    return `${settings.value.rootUrl.replace(/\/$/, '')}/event/${encodeURIComponent(event.id)}`;
}

// Financial mutations must finish before this is called. Delivery never changes their outcome.
function queueInvoiceEmail(recipient: EmailRecipient, subject: string, content: EmailContent): void {
    const reportFailure = (error: unknown) => console.error('[invoice-pool] Saved change, but email delivery failed', error);
    try {
        void mailer.sendEmail(recipient, subject, content).catch(reportFailure);
    } catch (error) {
        reportFailure(error);
    }
}

function invoiceEmailRecipient(profile: Profile, address: string): EmailRecipient {
    return {name: resolveEmailRecipientName(profile.name, profile.user?.name, profile.user?.username, profile.guest?.username), address};
}

function invoiceContactProfile(invoice: EventInvoice): Profile | null | undefined {
    return invoice.registration?.profile ?? invoice.recordedByProfile;
}

// Verify a registration is currently allowed in the pool so surcharge updates cannot target removed participants.
async function assertRegistrationAllowed(pool: Awaited<ReturnType<typeof ensurePool>>, registrationId: number) {
    const assignedIds = pool.assignAll
        ? (await eventService.getRegistrationsForEvent(pool.event.id)).map((r) => r.id)
        : pool.assignments.map((a) => a.registrationId);
    if (!assignedIds.includes(registrationId)) throw new APIError('Participant not assigned to this pool', {}, 400);
}

// Create a new invoice pool with optional default/assign-all behavior and explicit participant list.
async function createInvoicePool(event: Event, body: any) {
    const schema = Joi.object({
        name: Joi.string().max(255).required(),
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
    const {error, value} = schema.validate(body, {abortEarly: false, allowUnknown: true});
    if (error) throw new APIError(error.message, body, 400);

    // Default pools auto-attach to future participants without forcing current pools to be "assign all".
    const isDefault = value.isDefault === true || value.isDefault === 'on';
    const assignAll = value.assignAll === true || value.assignAll === 'on';
    const subtractPersonalInvoices = value.subtractPersonalInvoices === true || value.subtractPersonalInvoices === 'on';
    const regIdsRaw = normalizeToArray(value.registrations);
    const allowedIds = (await eventService.getRegistrationsForEvent(event.id)).map((r) => r.id);
    const regIds = assignAll ? allowedIds : regIdsRaw.filter((id: number) => allowedIds.includes(Number(id))).map(Number);

    return invoiceService.createPool(
        event.id,
        value.name,
        value.description,
        value.distribution,
        isDefault,
        assignAll,
        subtractPersonalInvoices,
        regIds,
        value.sendCalculationEmails === true || value.sendCalculationEmails === 'on',
        value.roundUpShares === true || value.roundUpShares === 'on',
    );
}

async function updatePoolSettings(event: Event, poolId: string, body: any) {
    await ensurePool(event, poolId);

    const schema = Joi.object({
        description: Joi.string().allow('').optional(),
        distribution: Joi.string().valid(...InvoicePoolDistributions).required(),
        sendCalculationEmails: Joi.alternatives().try(Joi.boolean(), Joi.string().valid('on', '')).optional(),
        roundUpShares: Joi.alternatives().try(Joi.boolean(), Joi.string().valid('on', '')).optional(),
    });
    const {error, value} = schema.validate(body, {abortEarly: false, allowUnknown: true});
    if (error) throw new APIError(error.message, body, 400);

    await invoiceService.updatePoolSettings(poolId, value.distribution, value.description,
        value.sendCalculationEmails === undefined ? undefined : value.sendCalculationEmails === true || value.sendCalculationEmails === 'on',
        value.roundUpShares === undefined ? undefined : value.roundUpShares === true || value.roundUpShares === 'on');
}

// Save calculation inputs independently; closed pools keep their shares until recalculation.
async function updatePoolAssignments(event: Event, poolId: string, body: any) {
    const pool = await ensurePool(event, poolId);
    const {error, value} = Joi.object({
        participantFactors: Joi.object().pattern(/^[1-9]\d*$/, Joi.number().min(0).max(1000).custom((factor, helpers) => {
            const scaled = factor * 10000;
            return Math.abs(scaled - Math.round(scaled)) < 0.0000001
                ? factor : helpers.error('number.precision', {limit: 4});
        })).default({}),
    }).validate(body, {abortEarly: false, allowUnknown: true});
    if (error) throw new APIError(error.message, body, 400);
    const isDefault = body.isDefault === true || body.isDefault === 'on';
    const assignAll = body.assignAll === true || body.assignAll === 'on';
    const subtractPersonalInvoices = body.subtractPersonalInvoices === undefined
        ? pool.subtractPersonalInvoices
        : body.subtractPersonalInvoices === true || body.subtractPersonalInvoices === 'on';
    const regIdsRaw = normalizeToArray(body.registrations);
    const exemptIdsRaw = normalizeToArray(body.exemptions);
    const allowedIds = (await eventService.getRegistrationsForEvent(event.id)).map((r) => r.id);
    const regIds = assignAll ? allowedIds : regIdsRaw.map(Number).filter((id: number) => allowedIds.includes(id));
    const exemptIds = exemptIdsRaw.map(Number).filter((id: number) => allowedIds.includes(id));
    const participantFactors = value.participantFactors as Record<number, number>;
    if (Object.keys(participantFactors).some((id) => !regIds.includes(Number(id)))) {
        throw new APIError('Factors can only be set for participants assigned to this pool', body, 400);
    }
    await invoiceService.updateAssignments(poolId, isDefault, assignAll, subtractPersonalInvoices, regIds, exemptIds, participantFactors);
}

// Signed adjustments are applied after the weighted base split.
async function addPoolSurcharge(event: Event, poolId: string, body: any) {
    const pool = await ensurePool(event, poolId);
    const schema = Joi.object({
        registrationId: Joi.number().integer().positive().required(),
        amount: Joi.number().min(-99999999.99).max(99999999.99).invalid(0).custom((amount, helpers) => {
            const cents = amount * 100;
            return Math.abs(cents - Math.round(cents)) < 0.00001
                ? amount : helpers.error('number.precision', {limit: 2});
        }).required(),
        note: Joi.string().trim().max(4000).required(),
        subtractFromPool: Joi.alternatives().try(Joi.boolean(), Joi.string().valid('on', '')).default(true),
    });
    const {error, value} = schema.validate(body, {abortEarly: false, allowUnknown: true});
    if (error) throw new APIError(error.message, body, 400);

    const registrationId = Number(value.registrationId);
    const cleanedNote = (value.note as string).trim();
    if (!cleanedNote) throw new APIError('Note is required', body, 400);
    await assertRegistrationAllowed(pool, registrationId);
    const subtractFromPool = value.subtractFromPool === true || value.subtractFromPool === 'on';
    await invoiceService.addSurcharge(poolId, registrationId, Number(value.amount), cleanedNote, subtractFromPool);
}

// Remove an adjustment, invalidating previously calculated shares when necessary.
async function removePoolSurcharge(event: Event, poolId: string, surchargeId: string) {
    await ensurePool(event, poolId);
    await invoiceService.removeSurcharge(poolId, Number(surchargeId));
}

// Send both payer and beneficiary emails when takeover mappings change, including the actor for traceability.
async function notifyTakeoverChanges(
    event: Event,
    pool: Awaited<ReturnType<typeof ensurePool>>,
    changes: {
        added: { payerId: number; beneficiaryId: number }[];
        removed: { payerId: number; beneficiaryId: number }[]
    },
    actorLabel: string,
) {
    if ((!changes.added?.length) && (!changes.removed?.length)) return;
    const participants = await eventService.getEventParticipants(event.id);
    const map = new Map(participants.map((p) => [Number(p.id), p]));
    const queue = new Map<number, {recipient: EmailRecipient; messages: string[]}>();
    const enqueue = (participant: ParticipantRow | undefined, message: string) => {
        if (!participant?.email || participant.email === '—') return;
        const id = Number(participant.id);
        const existing = queue.get(id) || {recipient: {name: participant.name, address: participant.email}, messages: []};
        existing.messages.push(message);
        queue.set(id, existing);
    };

    for (const add of changes.added || []) {
        const payer = map.get(add.payerId);
        const beneficiary = map.get(add.beneficiaryId);
        const beneficiaryName = beneficiary?.name || `participant #${add.beneficiaryId}`;
        const payerName = payer?.name || `Participant #${add.payerId}`;
        enqueue(
            payer,
            `You are now covering ${beneficiaryName}.`,
        );
        enqueue(
            beneficiary,
            `${payerName} will now pay your share.`,
        );
    }

    for (const remove of changes.removed || []) {
        const payer = map.get(remove.payerId);
        const beneficiary = map.get(remove.beneficiaryId);
        const beneficiaryName = beneficiary?.name || `participant #${remove.beneficiaryId}`;
        const payerName = payer?.name || `Participant #${remove.payerId}`;
        enqueue(
            payer,
            `You are no longer covering ${beneficiaryName}.`,
        );
        enqueue(
            beneficiary,
            `${payerName} will no longer pay your share.`,
        );
    }

    queue.forEach(({messages, recipient}) => {
        queueInvoiceEmail(recipient, 'Invoice takeovers updated', {
            eyebrow: 'Invoice pool',
            heading: 'Payment coverage was updated',
            preheader: `Payment coverage changed for ${pool.name}.`,
            paragraphs: ['The payment responsibilities in an invoice pool have changed.'],
            details: [
                {label: 'Event', value: event.title},
                {label: 'Pool', value: pool.name},
                {label: 'Updated by', value: actorLabel},
            ],
            sections: [{title: 'What changed', items: messages}],
            action: {label: 'View invoice pool', url: eventPageUrl(event)},
        });
    });
}

// Update takeover mappings from either participants or administrators, respecting the "covered participants cannot cover others" rule.
async function updateTakeovers(event: Event, poolId: string, body: any, session: Request['session'], allowReassign: boolean) {
    const pool = await ensurePool(event, poolId);
    const schema = Joi.object({
        payerId: Joi.number().integer().optional(),
        beneficiaries: Joi.alternatives().try(Joi.array().items(Joi.number().integer()), Joi.number().integer()).default([]),
    });
    const {error, value} = schema.validate(body, {abortEarly: false, allowUnknown: true});
    if (error) throw new APIError(error.message, body, 400);

    const actorRegistrationId = await getActorRegistrationId(event, session);
    const payerId = value.payerId ? Number(value.payerId) : actorRegistrationId;
    if (!payerId) throw new APIError('Must be registered to manage takeovers', body, 401);
    if (!allowReassign && actorRegistrationId && payerId !== actorRegistrationId) {
        throw new APIError('Not allowed to assign takeovers for other participants', body, 403);
    }

    let beneficiaries: number[] = [];
    if (Array.isArray(value.beneficiaries)) {
        beneficiaries = value.beneficiaries.map(Number);
    } else if (value.beneficiaries) {
        beneficiaries = [Number(value.beneficiaries)];
    }

    const allowedIds = pool.assignAll
        ? (await eventService.getRegistrationsForEvent(event.id)).map((r) => r.id)
        : pool.assignments.map((a) => a.registration.id);
    if (!allowedIds.includes(payerId)) throw new APIError('Payer is not part of this pool', body, 400);

    const normalizedBeneficiaries: number[] = Array.from(new Set(beneficiaries)).filter(
        (id) => allowedIds.includes(id) && id !== payerId,
    );
    const existing = pool.takeovers || [];
    const payerCovered = existing.some((t) => t.beneficiaryRegistrationId === payerId);
    if (payerCovered && normalizedBeneficiaries.length) {
        throw new APIError('Participants whose share is taken over cannot cover others', body, 400);
    }

    const blockedBeneficiaries = existing.filter((t) => normalizedBeneficiaries.includes(t.payerRegistrationId));
    if (blockedBeneficiaries.length) {
        throw new APIError('A participant being covered cannot take over other shares. Clear their takeovers first.', body, 400);
    }

    const conflicting = existing.filter(
        (t) => normalizedBeneficiaries.includes(t.beneficiaryRegistrationId) && t.payerRegistrationId !== payerId,
    );
    if (conflicting.length && !allowReassign) {
        throw new APIError('One or more participants are already covered by someone else', body, 400);
    }

    const changes = await invoiceService.updateTakeovers(poolId, payerId, normalizedBeneficiaries, allowReassign);
    try {
        await notifyTakeoverChanges(event, pool, changes, resolveActorLabel(session));
    } catch (error) {
        console.error('[invoice-pool] Takeovers saved, but notification preparation failed', error);
    }
}

// Validate and submit a new invoice with its proof file attached.
async function submitInvoice(event: Event, poolId: string, body: any, session: Request['session'], file?: Express.Multer.File | undefined) {
    const regId = await getActorRegistrationId(event, session);
    if (!regId) throw new APIError('Must be registered to submit', body, 401);
    const schema = Joi.object({
        amount: Joi.number().positive().required(),
        description: Joi.string().allow('').optional(),
    });
    const {error, value} = schema.validate(body, {abortEarly: false, allowUnknown: true});
    if (error) throw new APIError(error.message, body, 400);
    const pool = await ensurePool(event, poolId);
    if (pool.status === 'CLOSED') throw new APIError('Pool is closed', body, 400);
    const isAssigned = pool.assignAll || pool.assignments?.some((a) => a.registration.id === regId);
    if (!isAssigned) throw new APIError('Not allowed for this pool', body, 403);
    if (!file) throw new APIError('A proof image or PDF is required', body, 400);
    const isValidProof = file.mimetype === 'application/pdf' || file.mimetype.startsWith('image/');
    if (!isValidProof) {
        // Clean up unexpected uploads immediately to avoid orphan files
        void fs.promises.unlink(file.path).catch(() => undefined);
        throw new APIError('Unsupported proof type', body, 400);
    }
    const proofPath = path.relative(process.cwd(), file.path);
    const invoiceId = await invoiceService.submitInvoice(poolId, regId, value.amount, value.description || null, {
        path: proofPath,
        originalName: file.originalname,
        mimeType: file.mimetype,
    });
    try {
        const invoice = await invoiceService.getInvoiceWithRegistration(poolId, invoiceId);
        const email = invoice?.registration?.profile.user?.email || invoice?.registration?.profile.guest?.email;
        if (email && invoice?.registration) {
            // Receipt delivery must not hold the successful upload response open for SMTP.
            queueInvoiceEmail(
                invoiceEmailRecipient(invoice.registration.profile, email),
                'Invoice submitted',
                {
                    eyebrow: 'Invoice received',
                    heading: 'Your invoice was submitted',
                    preheader: `Invoice #${invoiceId} is awaiting organizer review.`,
                    paragraphs: ['We received your invoice successfully. An organizer will review it before it is included in the pool.'],
                    details: [
                        {label: 'Invoice', value: `#${invoiceId}`},
                        {label: 'Event', value: event.title},
                        {label: 'Pool', value: pool.name},
                        {label: 'Amount', value: formatAmount(Number(value.amount))},
                        {label: 'Status', value: 'Awaiting review'},
                        ...(value.description ? [{label: 'Description', value: String(value.description)}] : []),
                    ],
                    action: {label: 'View invoice history', url: eventPageUrl(event)},
                    notice: 'You will receive another email when an organizer accepts or rejects this invoice.',
                },
            );
        }
    } catch (error) {
        console.error('[invoice-pool] Invoice saved, but receipt preparation failed', error);
    }
}

// Organizers can enter a shared pool cost without becoming an event participant.
async function addOrganizerInvoice(event: Event, poolId: string, body: any, session: Request['session'], file?: Express.Multer.File) {
    try {
        if (!session.profile?.id) throw new APIError('Log in to record a pool cost', {}, 401);
        await ensurePool(event, poolId);
        const {error, value} = Joi.object({
            amount: Joi.number().positive().max(99999999.99).required(),
            description: Joi.string().trim().max(4000).required(),
        }).validate(body || {}, {abortEarly: false, allowUnknown: true});
        if (error) throw new APIError(error.message, {}, 400);
        if (file && !['application/pdf', 'image/jpeg', 'image/png', 'image/gif'].includes(file.mimetype)) {
            throw new APIError('Unsupported proof type', {}, 400);
        }
        return await invoiceService.addOrganizerInvoice(poolId, session.profile.id, value.amount, value.description, file ? {
            path: path.relative(process.cwd(), file.path), originalName: file.originalname, mimeType: file.mimetype,
        } : null);
    } catch (error) {
        if (file) await fs.promises.unlink(file.path).catch(() => undefined);
        throw error;
    }
}

// Accept an invoice, preserve optional organizer corrections, and notify the submitter.
async function approveInvoice(
    event: Event,
    poolId: string,
    invoiceId: string,
    body: any,
    session: Request['session'],
) {
    const pool = await ensurePool(event, poolId);
    const invoice = await invoiceService.getInvoiceWithRegistration(poolId, Number(invoiceId));
    if (!invoice) throw new APIError('Invoice not found', {}, 404);
    if (invoice.status !== 'NEW') throw new APIError('Only new invoices can be accepted', body, 409);
    const schema = Joi.object({
        correctedAmount: Joi.number().positive().allow(null, '').optional(),
        correctedDescription: Joi.string().max(4000).allow('').optional(),
    });
    const {error, value} = schema.validate(body || {}, {abortEarly: false, allowUnknown: true});
    if (error) throw new APIError(error.message, body, 400);
    const correctedAmount = value.correctedAmount === '' || value.correctedAmount === null || value.correctedAmount === undefined
        ? null
        : value.correctedAmount;
    const correctedDescription = value.correctedDescription?.trim() || null;
    const accepted = await invoiceService.approveInvoice(poolId, Number(invoiceId), {correctedAmount, correctedDescription});
    if (!accepted) throw new APIError('Invoice was already reviewed. Reload to see the saved decision.', {}, 409);
    const contact = invoiceContactProfile(invoice);
    const email = contact?.user?.email || contact?.guest?.email;
    if (email && contact) {
        const actor = resolveActorLabel(session);
        const acceptedAmount = formatAmount(resolveInvoiceAmount(invoice.amount, correctedAmount));
        const correctionDetails = [
            ...(correctedAmount !== null
                ? [{label: 'Submitted amount', value: formatAmount(Number(invoice.amount))}]
                : []),
            ...(correctedDescription
                ? [{label: 'Organizer correction', value: correctedDescription}]
                : []),
        ];
        queueInvoiceEmail(
            invoiceEmailRecipient(contact, email),
            'Invoice accepted',
            {
                eyebrow: 'Invoice accepted',
                heading: 'Your invoice was accepted',
                preheader: `Invoice #${invoice.id} was accepted for ${acceptedAmount}.`,
                paragraphs: ['An organizer reviewed and accepted your invoice. It will now be included in the invoice pool.'],
                details: [
                    {label: 'Invoice', value: `#${invoice.id}`},
                    {label: 'Event', value: event.title},
                    {label: 'Pool', value: pool.name},
                    {label: 'Accepted amount', value: acceptedAmount},
                    {label: 'Reviewed by', value: actor},
                    ...correctionDetails,
                ],
                action: {label: 'View invoice history', url: eventPageUrl(event)},
            },
        );
    }
}

// Close an approved invoice and inform the creator who performed the action.
async function closeInvoice(
    event: Event,
    poolId: string,
    invoiceId: string,
    session: Request['session'],
    permData?: PermBundle,
    allowManageOverride = true,
) {
    const pool = await ensurePool(event, poolId);
    const invoice = await invoiceService.getInvoiceWithRegistration(poolId, Number(invoiceId));
    if (!invoice) throw new APIError('Invoice not found', {}, 404);
    if (invoice.status === 'CLOSED') return;
    if (invoice.status !== 'APPROVED') {
        throw new APIError('Invoices must be accepted before closing', {}, 400);
    }
    const actorRegId = await getActorRegistrationId(event, session);
    const canManage = allowManageOverride && (permData?.entity?.has('MANAGE_ASSIGNMENTS') ?? false);
    const isSubmitter = actorRegId !== undefined && actorRegId === invoice.registrationId;
    if (!canManage && !isSubmitter) {
        throw new APIError('You can only close your own approved invoices, unless you are an administrator.', {}, 403);
    }
    const closed = await invoiceService.closeInvoice(poolId, Number(invoiceId));
    if (!closed) return;
    const contact = invoiceContactProfile(invoice);
    const email = contact?.user?.email || contact?.guest?.email;
    if (email) {
        const actor = resolveActorLabel(session);
        queueInvoiceEmail(
            invoiceEmailRecipient(contact!, email),
            'Invoice closed',
            {
                eyebrow: 'Invoice update',
                heading: 'Your invoice was closed',
                preheader: `Invoice #${invoice.id} was marked as closed.`,
                paragraphs: ['Your accepted invoice has been marked as closed. It remains available in your invoice history.'],
                details: [
                    {label: 'Invoice', value: `#${invoice.id}`},
                    {label: 'Event', value: event.title},
                    {label: 'Pool', value: pool.name},
                    {label: 'Updated by', value: actor},
                ],
                action: {label: 'View invoice history', url: eventPageUrl(event)},
            },
        );
    }
}

// Reject an invoice without deleting its audit history or proof.
async function declineInvoice(
    event: Event,
    poolId: string,
    invoiceId: string,
    body: any,
    session: Request['session'],
) {
    const pool = await ensurePool(event, poolId);
    const invoice = await invoiceService.getInvoiceWithRegistration(poolId, Number(invoiceId));
    if (!invoice) throw new APIError('Invoice not found', {}, 404);
    if (invoice.status !== 'NEW') throw new APIError('Only new invoices can be rejected', body, 409);
    const schema = Joi.object({
        rejectionReason: Joi.string().trim().min(1).max(4000).required(),
    });
    const {error, value} = schema.validate(body || {}, {abortEarly: false, allowUnknown: true});
    if (error) throw new APIError(error.message, body, 400);
    const declined = await invoiceService.declineInvoice(poolId, Number(invoiceId), value.rejectionReason);
    if (!declined) throw new APIError('Invoice was already reviewed. Reload to see the saved decision.', {}, 409);
    const contact = invoiceContactProfile(invoice);
    const email = contact?.user?.email || contact?.guest?.email;
    if (email) {
        const actor = resolveActorLabel(session);
        queueInvoiceEmail(
            invoiceEmailRecipient(contact!, email),
            'Invoice rejected',
            {
                eyebrow: 'Invoice rejected',
                heading: 'Your invoice needs attention',
                preheader: `Invoice #${invoice.id} was rejected by an organizer.`,
                paragraphs: ['An organizer could not accept this invoice. The invoice and proof remain visible in your history for reference.'],
                details: [
                    {label: 'Invoice', value: `#${invoice.id}`},
                    {label: 'Event', value: event.title},
                    {label: 'Pool', value: pool.name},
                    {label: 'Reviewed by', value: actor},
                    {label: 'Rejection reason', value: value.rejectionReason},
                ],
                action: {label: 'View invoice history', url: eventPageUrl(event)},
                notice: 'If you need clarification, contact an event organizer before submitting a replacement invoice.',
            },
        );
    }
}

function confirmedInvoiceChange(body: unknown, fields: Joi.SchemaMap = {}) {
    const {error, value} = Joi.object({
        ...fields,
        confirmed: Joi.boolean().valid(true).strict().required(),
        expectedRevision: Joi.number().integer().min(0).required(),
    }).validate(body || {}, {abortEarly: false, allowUnknown: true});
    if (error) throw new APIError(error.message, {}, 400);
    return value;
}

function notifySavedInvoiceChange(event: Event, pool: EventInvoicePool, before: EventInvoice, saved: EventInvoice,
    action: 'corrected' | 'rejected' | 'retracted', session: Request['session']): void {
    const contact = invoiceContactProfile(before);
    const email = contact?.user?.email || contact?.guest?.email;
    if (!contact || !email) return;
    queueInvoiceEmail(invoiceEmailRecipient(contact, email), `Invoice ${action}`, {
        eyebrow: 'Invoice history',
        heading: `Your invoice was ${action}`,
        paragraphs: [action === 'corrected'
            ? 'An organizer changed the accepted details used for the next pool calculation.'
            : action === 'rejected'
                ? 'An organizer removed this invoice from the costs and personal invoice credits used for the next calculation.'
                : 'Your invoice was withdrawn before organizer review. It remains in your history and will not be included in pool costs.'],
        details: [
            {label: 'Invoice', value: `#${saved.id}`},
            {label: 'Event', value: event.title},
            {label: 'Pool', value: pool.name},
            {label: 'Original amount', value: formatAmount(toAmount(saved.amount))},
            ...(action === 'corrected' ? [
                {label: 'Previous counted amount', value: formatAmount(resolveInvoiceAmount(before.amount, before.correctedAmount))},
                {label: 'Updated counted amount', value: formatAmount(resolveInvoiceAmount(saved.amount, saved.correctedAmount))},
                {label: 'Updated description', value: saved.correctedDescription ?? saved.description ?? '—'},
            ] : []),
            ...(action === 'rejected' ? [{label: 'Rejection reason', value: saved.rejectionReason || '—'}] : []),
            {label: 'Updated by', value: resolveActorLabel(session)},
        ],
        action: {label: 'View invoice history', url: eventPageUrl(event)},
        notice: action === 'retracted'
            ? 'This invoice was never counted in shares. Retraction does not change saved shares or recorded payments.'
            : 'Saved shares and recorded payments stay unchanged until the pool is recalculated.',
    });
}

async function reviseInvoice(event: Event, poolId: string, invoiceId: string, body: any, session: Request['session']) {
    const value = confirmedInvoiceChange(body, {
        correctedAmount: Joi.number().positive().max(99999999.99).allow(null).required(),
        correctedDescription: Joi.string().trim().max(4000).allow('', null).required(),
    });
    const pool = await ensurePool(event, poolId);
    const invoice = await invoiceService.getInvoiceWithRegistration(poolId, Number(invoiceId));
    if (!invoice) throw new APIError('Invoice not found', {}, 404);
    const saved = await invoiceService.reviseInvoice(poolId, Number(invoiceId), {
        correctedAmount: value.correctedAmount, correctedDescription: value.correctedDescription || null,
    }, value);
    notifySavedInvoiceChange(event, pool, invoice, saved, 'corrected', session);
}

async function rejectAcceptedInvoice(event: Event, poolId: string, invoiceId: string, body: any, session: Request['session']) {
    const value = confirmedInvoiceChange(body, {rejectionReason: Joi.string().trim().max(4000).required()});
    const pool = await ensurePool(event, poolId);
    const invoice = await invoiceService.getInvoiceWithRegistration(poolId, Number(invoiceId));
    if (!invoice) throw new APIError('Invoice not found', {}, 404);
    const saved = await invoiceService.rejectAcceptedInvoice(poolId, Number(invoiceId), value.rejectionReason, value);
    notifySavedInvoiceChange(event, pool, invoice, saved, 'rejected', session);
}

async function retractInvoice(event: Event, poolId: string, invoiceId: string, body: any, session: Request['session']) {
    if (!session.profile?.id) throw new APIError('Log in to retract your invoice', {}, 401);
    const value = confirmedInvoiceChange(body);
    const pool = await ensurePool(event, poolId);
    const invoice = await invoiceService.getInvoiceWithRegistration(poolId, Number(invoiceId));
    if (!invoice) throw new APIError('Invoice not found', {}, 404);
    const saved = await invoiceService.retractInvoice(poolId, Number(invoiceId), session.profile.id, value);
    notifySavedInvoiceChange(event, pool, invoice, saved, 'retracted', session);
}

type CalculationDto = {
    pool: EventInvoicePool,
    targetRegistrations: EventRegistration[],
    individualCosts: Map<number, { total: number, days?: number, factor?: number }>,
    exemptIds: Set<number>,
    surchargeMap: Map<number, { amount: number; note: string }[]>,
    invoiceCreditMap: Map<number, number>,
    takeoverMap: Map<number, number>,
    participantMap: Map<string | number, ParticipantRow>
}

// Build the same gross shares for the read-only preview and the committed calculation.
async function preparePoolCalculation(event: Event, poolId: string) {
    const pool = await ensurePool(event, poolId);

    const approvedInvoices = (pool.invoices || []).filter(
        (invoice) => invoice.status === 'APPROVED' || invoice.status === 'CLOSED',
    );

    // Pull full participant list once so we can reuse it for lookups and notifications
    const participants = await eventService.getEventParticipants(event.id);
    const participantMap = new Map(participants.map((p) => [p.id, p]));

    // Gather target registrations before handing persistence back to the service
    const targetRegistrations = pool.assignAll
        ? await eventService.getRegistrationsForEvent(event.id)
        : Array.from(new Map(pool.assignments.map((assignment) => [assignment.registrationId, assignment.registration])).values());
    if (!targetRegistrations.length && pool.status !== 'CLOSED') throw new APIError('No participants assigned to this pool', {}, 400);

    const targetIds = new Set(targetRegistrations.map((r) => r.id));
    const exemptIds = new Set((pool.assignments || []).filter((a) => a.isExempt).map((a) => a.registrationId));
    const billableRegistrations = targetRegistrations.filter((reg) => !exemptIds.has(reg.id));

    // Bucket surcharges per participant so we can attribute them to a single payer later.
    const surchargeMap = bucketSurcharges(pool, targetIds);

    // Aggregate the total approved invoice amounts submitted by each participant.
    // This will later be deducted from their calculated share if pool.subtractPersonalInvoices is enabled.
    const invoiceCreditMap = bucketInvoiceCredit(approvedInvoices, targetIds);

    // Respect pre-agreed takeovers; beneficiaries cannot also cover others by service validation
    const takeoverMap = calculateTakeovers(pool, targetIds);

    // Calculate the individual base costs
    const individualCosts = calculateIndividualCosts(pool, billableRegistrations);

    const calcDto: CalculationDto = {
        pool,
        targetRegistrations,
        individualCosts,
        exemptIds,
        surchargeMap,
        invoiceCreditMap,
        takeoverMap,
        participantMap
    }

    // Track payer totals alongside detailed notes so breakdowns include amounts for covered beneficiaries and surcharges.
    const payerShares = calculatePayerShares(calcDto);

    const sharePayloads = Array.from(payerShares.entries()).map(([registrationId, data]) => {
        const baseShareAmount = Math.round(data.base * 100) / 100;
        const extraAmount = Math.round(data.surcharges * 100) / 100;
        const invoiceCreditAmount = Math.round(data.invoiceCredits * 100) / 100;
        const shareAmount = Math.round((baseShareAmount + extraAmount - invoiceCreditAmount) * 100) / 100;
        const note = data.detailNotes.filter(Boolean).join(' • ') || undefined;
        return {registrationId, baseShareAmount, extraAmount, invoiceCreditAmount, shareAmount, note};
    });

    return {pool, participants, sharePayloads, approvedInvoiceIds: approvedInvoices.map((invoice) => invoice.id)};
}

function calculationOptions(body: unknown) {
    const {error, value} = Joi.object({
        sendEmails: Joi.alternatives().try(Joi.boolean(), Joi.string().valid('on', '')).optional(),
        expectedRevision: Joi.number().integer().min(0).optional(),
    }).validate(body, {allowUnknown: true});
    if (error) throw new APIError(error.message, {}, 400);
    return value as {sendEmails?: boolean | 'on' | ''; expectedRevision?: number};
}

async function previewPool(event: Event, poolId: string) {
    const {pool, participants, sharePayloads} = await preparePoolCalculation(event, poolId);
    const participantMap = new Map(participants.map((participant) => [Number(participant.id), participant]));
    const projected = invoiceService.projectInvoiceShares(pool.shares || [], sharePayloads, participants.map((participant) => Number(participant.id)));
    const shares = projected.map((share) => ({
        ...share,
        payerName: participantMap.get(share.registrationId)?.name || `Participant #${share.registrationId}`,
        calculatedAmount: Math.round((share.baseShareAmount + share.extraAmount - share.invoiceCreditAmount) * 100) / 100,
    }));
    const sum = (amounts: number[]) => Math.round(amounts.reduce((total, amount) => total + amount, 0) * 100) / 100;
    const invoiceAmount = sum((pool.invoices || [])
        .filter((invoice) => invoice.status === 'APPROVED' || invoice.status === 'CLOSED')
        .map((invoice) => resolveInvoiceAmount(invoice.amount, invoice.correctedAmount)));
    const redistributedAmount = sum((pool.surcharges || []).filter((adjustment) => adjustment.subtractFromPool)
        .map((adjustment) => toAmount(adjustment.amount)));
    const additionalAmount = sum((pool.surcharges || []).filter((adjustment) => !adjustment.subtractFromPool)
        .map((adjustment) => toAmount(adjustment.amount)));
    const distributableAmount = sum([invoiceAmount, -redistributedAmount]);
    const allocatedBaseAmount = sum(shares.map((share) => share.baseShareAmount));
    const adjustmentAmount = sum(shares.map((share) => share.extraAmount));
    const invoiceCreditAmount = sum(shares.map((share) => share.invoiceCreditAmount));
    return {
        revision: pool.calculationRevision,
        roundUpShares: pool.roundUpShares == null || !!pool.roundUpShares,
        shares,
        totals: {
            invoiceAmount,
            redistributedAmount,
            distributableAmount,
            allocatedBaseAmount,
            roundingDifference: sum([allocatedBaseAmount, -distributableAmount]),
            adjustmentAmount,
            grossAmount: sum([allocatedBaseAmount, adjustmentAmount]),
            invoiceCreditAmount,
            expectedNetAmount: sum([invoiceAmount, additionalAmount, -invoiceCreditAmount]),
            calculatedAmount: sum(shares.map((share) => share.calculatedAmount)),
            paymentCreditAmount: sum(shares.map((share) => share.paymentCreditAmount)),
            outstandingAmount: sum(shares.map((share) => share.isPaid ? 0 : Math.max(share.shareAmount, 0))),
            creditAmount: sum(shares.map((share) => share.isPaid ? 0 : Math.max(-share.shareAmount, 0))),
        },
    };
}

async function closePool(event: Event, poolId: string, body: any = {}, session?: Request['session'], recalculate = false) {
    const options = calculationOptions(body);
    const {pool, sharePayloads, approvedInvoiceIds} = await preparePoolCalculation(event, poolId);
    if (options.expectedRevision !== undefined && options.expectedRevision !== pool.calculationRevision) {
        throw new APIError('The preview is out of date. Preview the calculation again before applying it.', {}, 409);
    }
    await invoiceService.closePool(poolId, approvedInvoiceIds, sharePayloads, recalculate, pool.calculationRevision);
    const sendEmails = options.sendEmails === undefined ? pool.sendCalculationEmails : options.sendEmails === true || options.sendEmails === 'on';
    if (sendEmails) {
        try {
            await notifyPoolShares(event, poolId, {expectedRevision: pool.calculationRevision + 1}, session, recalculate ? 'recalculated' : 'closed');
        } catch (error) {
            console.error('[invoice-pool] Calculation saved but settlement notification could not be queued', error);
        }
    }
}

async function rollbackPoolChanges(event: Event, poolId: string, body: any = {}) {
    await ensurePool(event, poolId);
    const options = calculationOptions(body);
    return invoiceService.rollbackPoolChanges(poolId, options.expectedRevision);
}

async function notifyPoolShares(event: Event, poolId: string, body: any = {}, session?: Request['session'], reason: 'closed' | 'recalculated' | 'requested' = 'requested') {
    const options = calculationOptions(body);
    const participants = new Map((await eventService.getEventParticipants(event.id)).map((participant) => [Number(participant.id), participant]));
    const pool = await ensurePool(event, poolId);
    if (pool.status !== 'CLOSED') throw new APIError('Close the pool before sending settlement emails', {}, 400);
    if (options.expectedRevision !== undefined && options.expectedRevision !== pool.calculationRevision) {
        throw new APIError('The settlement changed. Reload before sending emails.', {}, 409);
    }
    let count = 0;
    for (const share of pool.shares || []) {
        const participant = participants.get(share.registrationId);
        const email = participant?.email;
        if (!email || email === '—') continue;
        const content = buildInvoiceSettlementEmail({
            eventTitle: event.title,
            poolName: pool.name,
            eventUrl: eventPageUrl(event),
            actor: resolveActorLabel(session),
            reason,
            needsRecalculation: !!pool.needsRecalculation,
            share,
        });
        // Queue delivery without making SMTP availability part of calculation success.
        queueInvoiceEmail({name: participant!.name, address: email}, reason === 'closed' ? 'Invoice pool closed' : reason === 'recalculated' ? 'Invoice pool recalculated' : 'Invoice pool settlement', content);
        count++;
    }
    return {count};
}

function bucketSurcharges(pool: EventInvoicePool, targetIds: Set<number>) {
    const surchargeMap = new Map<number, { amount: number; note: string }[]>();
    for (const surcharge of pool.surcharges || []) {
        if (!targetIds.has(surcharge.registrationId)) continue;
        const existing = surchargeMap.get(surcharge.registrationId) || [];
        existing.push({amount: toAmount(surcharge.amount), note: surcharge.note});
        surchargeMap.set(surcharge.registrationId, existing);
    }
    return surchargeMap;
}

function bucketInvoiceCredit(approvedInvoices: EventInvoice[], targetIds: Set<number>) {
    const invoiceCreditMap = new Map<number, number>();
    for (const invoice of approvedInvoices) {
        if (invoice.registrationId == null) continue;
        if (!targetIds.has(invoice.registrationId)) continue;
        const running = invoiceCreditMap.get(invoice.registrationId) || 0;
        invoiceCreditMap.set(
            invoice.registrationId,
            running + resolveInvoiceAmount(invoice.amount, invoice.correctedAmount),
        );
    }
    return invoiceCreditMap;
}

function calculateTakeovers(pool: EventInvoicePool, targetIds: Set<number>) {
    const takeoverMap = new Map<number, number>();
    for (const takeover of pool.takeovers || []) {
        if (!targetIds.has(takeover.beneficiaryRegistrationId) || !targetIds.has(takeover.payerRegistrationId)) continue;
        takeoverMap.set(takeover.beneficiaryRegistrationId, takeover.payerRegistrationId);
    }
    return takeoverMap;
}

function calculateIndividualCosts(pool: EventInvoicePool, billableRegistrations: EventRegistration[]) {
    const invoiceTotal = pool.invoices.filter((invoice) => invoice.status === 'APPROVED' || invoice.status === 'CLOSED')
        .reduce((sum, invoice) => sum + resolveInvoiceAmount(invoice.amount, invoice.correctedAmount), 0);
    const offset = (pool.surcharges || []).filter((adjustment) => adjustment.subtractFromPool)
        .reduce((sum, adjustment) => sum + toAmount(adjustment.amount), 0);
    const factors = new Map((pool.assignments || []).map((assignment) => [assignment.registrationId, assignment.factor ?? 1]));
    const weights = billableRegistrations.map((registration) => {
        const days = pool.distributionMethod === 'EQUAL' ? undefined
            : differenceInCalendarDays(registration.departureDate, registration.arrivalDate)
                + (pool.distributionMethod === 'NIGHTS' ? 0 : 1);
        return {registrationId: registration.id, weight: days ?? 1, factor: factors.get(registration.id) ?? 1, days};
    });
    try {
        const amounts = distributeInvoiceAmount(invoiceTotal - offset, weights, pool.roundUpShares == null || !!pool.roundUpShares);
        return new Map(weights.map((participant) => [participant.registrationId, {
            total: amounts.get(participant.registrationId) ?? 0,
            days: participant.days,
            factor: participant.factor,
        }]));
    } catch (error) {
        throw new APIError(error instanceof Error ? error.message : 'Cannot calculate invoice shares', {}, 400);
    }
}

function calculatePayerShares(dto: CalculationDto) {
    const payerShares = new Map<number, {
        base: number;
        surcharges: number;
        invoiceCredits: number;
        notes: string[];
        beneficiaries: number[];
        detailNotes: string[]
    }>();
    for (const registration of dto.targetRegistrations) {
        const personalCost: { total?: number, days?: number, factor?: number } = dto.individualCosts.get(registration.id) || {};
        const baseShare = dto.exemptIds.has(registration.id) ? 0 : (personalCost.total || 0);
        const extras = dto.surchargeMap.get(registration.id) || [];
        const extraTotal = extras.reduce((sum, entry) => sum + entry.amount, 0);
        // If subtractPersonalInvoices is enabled, participants receive credit for their submitted invoices.
        // This reduces their share by the amount they've already contributed via invoices.
        const invoiceCredit = dto.pool.subtractPersonalInvoices ? (dto.invoiceCreditMap.get(registration.id) || 0) : 0;
        const payerId = dto.takeoverMap.get(registration.id) ?? registration.id;
        const participantLabel = dto.participantMap.get(registration.id)?.name || `Participant #${registration.id}`;
        const beneficiaryName = payerId !== registration.id ? participantLabel : null;
        const bucket = payerShares.get(payerId) || {
            base: 0,
            surcharges: 0,
            invoiceCredits: 0,
            notes: [],
            beneficiaries: [],
            detailNotes: []
        };
        bucket.base += baseShare;
        bucket.surcharges += extraTotal;
        bucket.invoiceCredits += invoiceCredit;
        calculatePayerSharesInitialNotes(dto, registration, beneficiaryName, baseShare, personalCost, bucket);
        extras.forEach((entry) => {
            const adjustmentTarget = beneficiaryName || participantLabel;
            const detailLabel = entry.note ? `${adjustmentTarget} — ${entry.note}` : adjustmentTarget;
            const label = entry.amount < 0 ? 'Rebate' : 'Surcharge';
            bucket.detailNotes.push(`${label} for ${detailLabel}: ${formatAmount(entry.amount)}`);
            if (entry.note) bucket.notes.push(`${label} for ${adjustmentTarget}: ${entry.note}`);
        });
        if (invoiceCredit) {
            bucket.detailNotes.push(`Invoice credit for ${beneficiaryName || 'self'}: -${formatAmount(invoiceCredit)}`);
        }
        payerShares.set(payerId, bucket);
    }
    return payerShares;
}

function calculatePayerSharesInitialNotes(dto: CalculationDto, registration: EventRegistration, beneficiaryName: string | null, baseShare: number, personalCost: {
    total?: number;
    days?: number;
    factor?: number;
}, bucket: {
    base: number;
    surcharges: number;
    invoiceCredits: number;
    notes: string[];
    beneficiaries: number[];
    detailNotes: string[]
}) {
    const dayLabel = dto.pool.distributionMethod === "NIGHTS" ? "nights" : "days";
    bucket.detailNotes.push(`Base share for ${beneficiaryName || 'self'}: ${formatAmount(baseShare)}`);
    if (personalCost.factor !== undefined && personalCost.factor !== 1) {
        bucket.detailNotes.push(`Share factor for ${beneficiaryName || 'self'}: ${personalCost.factor}`);
    }
    if (dto.exemptIds.has(registration.id)) bucket.detailNotes.push('Exempt from automatic share');
    if (personalCost.days) {
        bucket.detailNotes.push(`(for ${personalCost.days} ${dayLabel})`);
    } else if (dto.pool.distributionMethod === "NIGHTS") {
        bucket.detailNotes.push('(no nights stayed)')
    }
    if (beneficiaryName) {
        bucket.beneficiaries.push(registration.id);
        bucket.notes.push(`Covering ${beneficiaryName}`);
    }
}

// Toggle payment state of a share and inform the participant with actor attribution.
async function markSharePaid(event: Event, poolId: string, shareId: string, isPaid: boolean, session: Request['session']) {
    const pool = await ensurePool(event, poolId);
    const share = await invoiceService.getShareWithRegistration(poolId, Number(shareId));
    if (!share) throw new APIError('Share not found', {}, 404);
    await invoiceService.setSharePaid(poolId, Number(shareId), isPaid);
    const email = share.registration.profile.user?.email || share.registration.profile.guest?.email;
    if (email) {
        const statusText = isPaid ? 'marked as paid' : 'marked as unpaid';
        const actor = resolveActorLabel(session);
        queueInvoiceEmail(
            invoiceEmailRecipient(share.registration.profile, email),
            'Share status changed',
            {
                eyebrow: 'Payment status',
                heading: `Your share was ${statusText}`,
                preheader: `The payment status for ${pool.name} changed.`,
                paragraphs: ['The payment status of your invoice-pool share has been updated.'],
                details: [
                    {label: 'Event', value: event.title},
                    {label: 'Pool', value: pool.name},
                    {label: 'Status', value: isPaid ? 'Paid' : 'Unpaid'},
                    {label: 'Updated by', value: actor},
                ],
                action: {label: 'View invoice pool', url: eventPageUrl(event)},
            },
        );
    }
}

// Serve invoice proof files securely with authentication and permission checks
export async function serveInvoiceProof(event: Event, poolId: string, invoiceId: string, session: Request['session'], permData?: PermBundle) {
    if (!session.profile) throw new APIError('Log in to view invoice proofs', {}, 401);
    await ensurePool(event, poolId);
    const invoice = await invoiceService.getInvoiceWithRegistration(poolId, Number(invoiceId));
    if (!invoice?.proofPath) {
        throw new APIError('Invoice proof not found', {}, 404);
    }

    // Verify user has permission: either has MANAGE_ASSIGNMENTS permission or is the invoice submitter
    const actorRegId = await getActorRegistrationId(event, session);
    const hasManagePermission = permData?.entity?.has('MANAGE_ASSIGNMENTS') ?? false;
    const isSubmitter = actorRegId !== undefined && actorRegId === invoice.registrationId;

    if (!hasManagePermission && !isSubmitter) {
        throw new APIError('You do not have permission to view this proof', {}, 403);
    }

    // Sanitize and validate the proof path to prevent directory traversal
    const uploadsDir = path.resolve(process.cwd(), settings.value.invoiceDir);
    const fullPath = path.resolve(process.cwd(), invoice.proofPath);

    // Use path.relative to ensure the resolved path is within uploads directory
    const relativePath = path.relative(uploadsDir, fullPath);
    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
        throw new APIError('Invalid proof path', {}, 400);
    }

    // Check if file exists (async)
    try {
        await fs.promises.access(fullPath, fs.constants.R_OK);
    } catch {
        throw new APIError('Proof file not found', {}, 404);
    }

    return fullPath;
}

// Replace the saved calculation atomically while the pool remains closed to new uploads.
async function recalculatePool(event: Event, poolId: string, body: any = {}, session?: Request['session']) {
    const pool = await ensurePool(event, poolId);
    if (pool.status !== 'CLOSED') {
        throw new APIError('Only closed pools can be recalculated', {}, 400);
    }

    await closePool(event, poolId, body, session, true);
}

export default {
    createInvoicePool,
    updatePoolSettings,
    updatePoolAssignments,
    addPoolSurcharge,
    removePoolSurcharge,
    submitInvoice,
    addOrganizerInvoice,
    reviseInvoice,
    rejectAcceptedInvoice,
    retractInvoice,
    approveInvoice,
    closeInvoice,
    declineInvoice,
    closePool,
    recalculatePool,
    previewPool,
    rollbackPoolChanges,
    notifyPoolShares,
    markSharePaid,
    updateTakeovers,
    serveInvoiceProof
};
