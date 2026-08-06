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

import mailer from '../modules/email';
import {APIError} from '../modules/lib/errors';
import {formatAmount, normalizeToArray, resolveActorLabel, sanitizeForEmail, toAmount} from '../modules/lib/util';
import type {ParticipantRow} from "../types/EventTypes";
import type {InvoicePoolDistribution} from "../types/InvoicePoolTypes";
import type {PermBundle} from '../types/PermissionTypes';

// Remove stored invoice proofs once the event has been finished for more than six months.
export async function purgeExpiredProofs(pool: Awaited<ReturnType<typeof invoiceService.getPoolWithInvoices>> | null) {
    if (!pool?.event?.endDate || !pool.invoices?.length) return;
    // Parse endDate and add 6 months for expiry check
    const endDate = new Date(pool.event.endDate);
    if (Number.isNaN(endDate.getTime())) return; // Invalid date format, skip expiry logic
    const expiry = new Date(endDate);
    expiry.setMonth(expiry.getMonth() + 6);
    if (new Date() < expiry) return;
    const expiredInvoices = pool.invoices.filter((inv) => !!inv.proofPath);
    if (!expiredInvoices.length) return;
    await invoiceService.clearInvoiceProofs(expiredInvoices);
}

// Resolve the registration ID for the current actor so validation stays localized.
async function getActorRegistrationId(event: Event, session: Request['session']) {
    if (!session.profile) return undefined;

    const registration = await eventService.getRegistrationFor(session.profile.id, event.id);
    return registration?.id;
}

// Pull the pool and ensure it belongs to the current event, purging expired proofs on access.
async function ensurePool(event: Event, poolId: string) {
    const pool = await invoiceService.getPoolWithInvoices(poolId);
    if (pool?.event.id !== event.id) {
        throw new APIError('Pool not found', {}, 404);
    }
    await purgeExpiredProofs(pool);
    return pool;
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
    );
}

async function updatePoolSettings(event: Event, poolId: string, body: any) {
    await ensurePool(event, poolId);

    const schema = Joi.object({
        description: Joi.string().allow('').optional(),
        distribution: Joi.string().valid(...InvoicePoolDistributions).required(),
    });
    const {error, value} = schema.validate(body, {abortEarly: false, allowUnknown: true});
    if (error) throw new APIError(error.message, body, 400);

    await invoiceService.updatePoolSettings(poolId, value.distribution, value.description);
}

// Update pool assignments before closure, respecting default/assign-all toggles and allowed participants.
async function updatePoolAssignments(event: Event, poolId: string, body: any, allowClosed = false) {
    const pool = await ensurePool(event, poolId);
    if (pool.status === 'CLOSED' && !allowClosed) throw new APIError('Pool is closed', body, 400);
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
    await invoiceService.updateAssignments(poolId, isDefault, assignAll, subtractPersonalInvoices, regIds, exemptIds);
}

// Create a participant-specific surcharge that will be factored in during pool closure.
async function addPoolSurcharge(event: Event, poolId: string, body: any, allowClosed = false) {
    const pool = await ensurePool(event, poolId);
    if (pool.status === 'CLOSED' && !allowClosed) throw new APIError('Pool is closed', body, 400);
    const schema = Joi.object({
        registrationId: Joi.number().integer().required(),
        amount: Joi.number().positive().required(),
        note: Joi.string().required(),
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

// Remove a surcharge so admins can correct mistakes before the pool closes.
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
    const map = new Map(participants.map((p) => [p.id, p]));
    const queue = new Map<string, string[]>();
    const enqueue = (email?: string | null, message?: string) => {
        if (!email || email === '—' || !message) return;
        const existing = queue.get(email) || [];
        existing.push(message);
        queue.set(email, existing);
    };

    for (const add of changes.added || []) {
        const payer = map.get(add.payerId);
        const beneficiary = map.get(add.beneficiaryId);
        const beneficiaryName = beneficiary?.name || `participant #${add.beneficiaryId}`;
        const payerName = payer?.name || `Participant #${add.payerId}`;
        enqueue(
            payer?.email,
            `You are now covering ${beneficiaryName} in pool "${pool.name}" (set by ${actorLabel}).`,
        );
        enqueue(
            beneficiary?.email,
            `${payerName} will now pay your share in pool "${pool.name}" (set by ${actorLabel}).`,
        );
    }

    for (const remove of changes.removed || []) {
        const payer = map.get(remove.payerId);
        const beneficiary = map.get(remove.beneficiaryId);
        const beneficiaryName = beneficiary?.name || `participant #${remove.beneficiaryId}`;
        const payerName = payer?.name || `Participant #${remove.payerId}`;
        enqueue(
            payer?.email,
            `You are no longer covering ${beneficiaryName} in pool "${pool.name}" (updated by ${actorLabel}).`,
        );
        enqueue(
            beneficiary?.email,
            `${payerName} will no longer pay your share in pool "${pool.name}" (updated by ${actorLabel}).`,
        );
    }

    queue.forEach((messages, email) => {
        void mailer.sendEmail(email, 'Invoice takeovers updated', messages.join('\n'));
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
    await notifyTakeoverChanges(event, pool, changes, resolveActorLabel(session));
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
    const isAssigned = pool.assignAll || pool.isDefault || pool.assignments?.some((a) => a.registration.id === regId);
    if (!isAssigned) throw new APIError('Not allowed for this pool', body, 403);
    if (!file) throw new APIError('A proof image or PDF is required', body, 400);
    const isValidProof = file.mimetype === 'application/pdf' || file.mimetype.startsWith('image/');
    if (!isValidProof) {
        // Clean up unexpected uploads immediately to avoid orphan files
        void fs.promises.unlink(file.path).catch(() => undefined);
        throw new APIError('Unsupported proof type', body, 400);
    }
    const proofPath = path.relative(process.cwd(), file.path);
    await invoiceService.submitInvoice(poolId, regId, value.amount, value.description || null, {
        path: proofPath,
        originalName: file.originalname,
        mimeType: file.mimetype,
    });
}

// Approve an invoice and notify the submitter with actor context.
async function approveInvoice(event: Event, poolId: string, invoiceId: string, session: Request['session']) {
    const pool = await ensurePool(event, poolId);
    const invoice = await invoiceService.getInvoiceWithRegistration(poolId, Number(invoiceId));
    if (!invoice) throw new APIError('Invoice not found', {}, 404);
    await invoiceService.approveInvoice(poolId, Number(invoiceId));
    const email = invoice.registration.profile.user?.email || invoice.registration.profile.guest?.email;
    if (email) {
        const actor = resolveActorLabel(session);
        void mailer.sendEmail(
            email,
            'Invoice approved',
            `Your invoice for pool "${sanitizeForEmail(pool.name)}" has been approved by ${actor}.`,
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
    const actorRegId = await getActorRegistrationId(event, session);
    const canManage = allowManageOverride && (permData?.entity?.has('MANAGE_ASSIGNMENTS') ?? false);
    const isSubmitter = actorRegId === invoice.registration.id;
    if (!canManage && !isSubmitter) {
        throw new APIError('You can only close your own approved invoices, unless you are an administrator.', {}, 403);
    }
    if (!canManage && invoice.status !== 'APPROVED') {
        throw new APIError('Invoices must be approved before closing', {}, 400);
    }

    await invoiceService.closeInvoice(poolId, Number(invoiceId));
    const email = invoice.registration.profile.user?.email || invoice.registration.profile.guest?.email;
    if (email) {
        const actor = resolveActorLabel(session);
        void mailer.sendEmail(
            email,
            'Invoice closed',
            `Your invoice for pool "${sanitizeForEmail(pool.name)}" has been marked as closed by ${actor}.`,
        );
    }
}

// Decline an invoice and include actor attribution in the notification.
async function declineInvoice(event: Event, poolId: string, invoiceId: string, session: Request['session']) {
    await ensurePool(event, poolId);
    // Delete and then notify from the controller to keep business rules centralized
    const email = await invoiceService.declineInvoice(poolId, Number(invoiceId));
    if (email) {
        const actor = resolveActorLabel(session);
        void mailer.sendEmail(
            email,
            'Invoice declined',
            `Your invoice submission was declined by ${actor}.`,
        );
    }
}

type CalculationDto = {
    pool: EventInvoicePool,
    targetRegistrations: EventRegistration[],
    individualCosts: Map<number, { total: number, days?: number }>,
    exemptIds: Set<number>,
    surchargeMap: Map<number, { amount: number; note: string }[]>,
    invoiceCreditMap: Map<number, number>,
    takeoverMap: Map<number, number>,
    participantMap: Map<string | number, ParticipantRow>
}

// Close a pool by distributing approved invoice totals, surcharges, and takeovers into payer shares.
async function closePool(event: Event, poolId: string, body: any = {}, session?: Request['session']) {
    const pool = await ensurePool(event, poolId);
    if (pool.status === 'CLOSED') return;

    // Include all invoices whose status is not 'NEW' (APPROVED, CLOSED, etc.)
    // This is required for pool closing logic, as all non-NEW invoices must be processed.
    const approvedInvoices = (pool.invoices || []).filter((inv) => inv.status !== 'NEW');

    // Pull full participant list once so we can reuse it for lookups and notifications
    const participants = await eventService.getEventParticipants(event.id);
    const participantMap = new Map(participants.map((p) => [p.id, p]));

    // Gather target registrations before handing persistence back to the service
    const targetRegistrations = pool.assignAll
        ? await eventService.getRegistrationsForEvent(event.id)
        : pool.assignments.map((a) => a.registration);
    if (!targetRegistrations.length) throw new APIError('No participants assigned to this pool', {}, 400);

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
        const baseShareAmount = toAmount(data.base);
        const extraAmount = toAmount(data.surcharges);
        const invoiceCreditAmount = toAmount(data.invoiceCredits);
        const shareValue = data.base + data.surcharges - data.invoiceCredits;
        const shareAmount = toAmount(shareValue);
        const note = data.detailNotes.filter(Boolean).join(' • ') || undefined;
        return {registrationId, baseShareAmount, extraAmount, invoiceCreditAmount, shareAmount, note};
    });

    await invoiceService.closePool(poolId, approvedInvoices.map((inv) => inv.id), sharePayloads);

    // Notify payers so they know what they owe and whether they are covering someone else
    const actor = resolveActorLabel(session ?? undefined);
    for (const [payerId, data] of payerShares.entries()) {
        const recipient = participantMap.get(payerId);
        const email = recipient?.email && recipient.email !== '—' ? recipient.email : null;
        if (!email) continue;
        const coverageNames = data.beneficiaries
            .map((id) => participantMap.get(id)?.name || `Participant #${id}`)
            .join(', ');
        const detailLines = data.detailNotes.map((n) => `- ${n}`).join('\n');
        const noteText = data.detailNotes.length ? `\nBreakdown:\n${detailLines}` : '';
        const totalDue = data.base + data.surcharges - data.invoiceCredits;
        const verb = totalDue < 0 ? 'are owed' : 'owe';
        const formattedTotal = formatAmount(Math.abs(totalDue));
        const coverageStr = coverageNames ? ` (covering ${coverageNames})` : '';
        void mailer.sendEmail(
            email,
            'Invoice pool closed',
            `You ${verb} ${formattedTotal} for pool "${sanitizeForEmail(pool.name)}"${coverageStr}.\nActioned by ${actor}.${noteText}`
        );
    }
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
        if (!targetIds.has(invoice.registrationId)) continue;
        const running = invoiceCreditMap.get(invoice.registrationId) || 0;
        invoiceCreditMap.set(invoice.registrationId, running + toAmount(invoice.amount));
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
    const total = toAmount(pool.payableAmount);
    let individualCosts = new Map<number, { total: number, days?: number }>();
    if (pool.distributionMethod === "TIME_BASED" || pool.distributionMethod === "NIGHTS") {
        const baseDayCount = pool.distributionMethod === "NIGHTS" ? 0 : 1;
        const individualDays = billableRegistrations.reduce((acc, reg) => {
            acc.set(reg.id, differenceInCalendarDays(reg.departureDate, reg.arrivalDate) + baseDayCount);
            return acc;
        }, new Map<number, number>());
        const totalDays = Array.from(individualDays.values()).reduce((total, val) => total + val, 0);
        const costPerDay = totalDays ? total / totalDays : 0;
        individualCosts = Array.from(individualDays.entries()).reduce((acc, reg) => {
            acc.set(reg[0], {total: costPerDay * reg[1], days: reg[1]});
            return acc;
        }, new Map<number, { total: number, days?: number }>());
    } else if (pool.distributionMethod === ("EQUAL" as InvoicePoolDistribution)) {
        const perPerson = billableRegistrations.length ? total / billableRegistrations.length : 0;
        individualCosts = billableRegistrations.reduce((acc, reg) => {
            acc.set(reg.id, {total: perPerson});
            return acc;
        }, new Map<number, { total: number, days?: number }>())
    }
    return individualCosts;
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
        const personalCost: { total?: number, days?: number } = dto.individualCosts.get(registration.id) || {};
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
            bucket.detailNotes.push(`Surcharge for ${detailLabel}: ${formatAmount(entry.amount)}`);
            if (entry.note) bucket.notes.push(`Surcharge for ${adjustmentTarget}: ${entry.note}`);
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
    days?: number
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
        void mailer.sendEmail(
            email,
            'Share status changed',
            `Your share for pool ${sanitizeForEmail(pool.name)} was ${statusText} by ${actor}.`,
        );
    }
}

// Serve invoice proof files securely with authentication and permission checks
export async function serveInvoiceProof(event: Event, poolId: string, invoiceId: string, session: Request['session'], permData?: PermBundle) {
    await ensurePool(event, poolId);
    const invoice = await invoiceService.getInvoiceWithRegistration(poolId, Number(invoiceId));
    if (!invoice?.proofPath) {
        throw new APIError('Invoice proof not found', {}, 404);
    }

    // Verify user has permission: either has MANAGE_ASSIGNMENTS permission or is the invoice submitter
    const actorRegId = await getActorRegistrationId(event, session);
    const hasManagePermission = permData?.entity?.has('MANAGE_ASSIGNMENTS') ?? false;
    const isSubmitter = actorRegId === invoice.registration.id;

    if (!hasManagePermission && !isSubmitter) {
        throw new APIError('You do not have permission to view this proof', {}, 403);
    }

    // Sanitize and validate the proof path to prevent directory traversal
    const uploadsDir = path.resolve(process.cwd(), 'uploads');
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

// Recalculate a closed pool by deleting existing shares and re-running the closePool logic
// This allows admins to adjust pool settings after closure and recalculate shares
// The reopenPool and closePool operations use transactions with locks to prevent race conditions
async function recalculatePool(event: Event, poolId: string, body: any = {}, session?: Request['session']) {
    const pool = await ensurePool(event, poolId);
    if (pool.status !== 'CLOSED') {
        throw new APIError('Only closed pools can be recalculated', {}, 400);
    }

    // Persist any pending assignment or surcharge updates submitted with the recalculation request
    if (body.assignments) {
        await updatePoolAssignments(event, poolId, body.assignments, true);
    }

    if (body.surcharge) {
        await addPoolSurcharge(event, poolId, body.surcharge, true);
    }

    // Reopen the pool (uses SERIALIZABLE transaction with pessimistic write lock)
    await invoiceService.reopenPool(poolId);

    // Re-run the close pool logic which will recalculate all shares
    // closePool also uses transactions (READ COMMITTED) for share deletion and creation
    await closePool(event, poolId, body, session);
}

export default {
    purgeExpiredProofs,
    createInvoicePool,
    updatePoolSettings,
    updatePoolAssignments,
    addPoolSurcharge,
    removePoolSurcharge,
    submitInvoice,
    approveInvoice,
    closeInvoice,
    declineInvoice,
    closePool,
    recalculatePool,
    markSharePaid,
    updateTakeovers,
    serveInvoiceProof
};
