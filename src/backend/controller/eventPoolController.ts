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

import {Request} from 'express';
import {isProofMimeType} from '../../common/lib/fileMedia';
import path from 'node:path';
import {Event} from '../modules/database/entities/event/Event';
import * as invoiceService from '../modules/database/services/EventInvoiceService';
import * as eventService from '../modules/database/services/EventService';

import {APIError} from '../modules/lib/errors';
import {resolveActorLabel, projectEventParticipants} from '../modules/lib/util';
import * as poolOperations from '../modules/invoice/poolOperations';
import * as invoiceOperations from '../modules/invoice/invoiceOperations';
import {savePoolTakeovers} from '../modules/invoice/takeovers';
import {isParticipantSubmissionPool, withInvoiceManagementEvent} from '../modules/invoice/state';
import type {EntityManager} from 'typeorm';
import {
    preparePoolCreation, preparePoolAssignments, prepareTakeoverRequest, preparePoolSettings,
    prepareSurchargeRequest, prepareSubmittedInvoice, prepareOrganizerInvoice, prepareInvoiceAcceptance,
    prepareInvoiceRejection, prepareConfirmedInvoiceChange, prepareCalculationOptions,
    prepareInvoiceRevision, prepareAcceptedInvoiceRejection, prepareSharesPdfOptions, preparePoolSubmissionState,
} from '../modules/invoice/requests';
import {preparePoolCalculation as calculatePoolInputs, buildPoolCalculationPreview} from '../modules/invoice/calculation';
import {
    notifyTakeoverChanges, notifySavedInvoiceChange, notifyAcceptedInvoice, notifyClosedInvoice,
    notifyRejectedInvoice, notifyShareSettlement, notifySubmittedInvoice, notifyPoolShareSettlements,
} from '../modules/invoice/notifications';
import {getInvoiceProofPath, withInvoiceProofUpload} from '../modules/invoice/proofs';
import {assertInvoiceSharesExportable} from '../modules/invoice/validation';
import {invoiceText, invoiceRejectionCause} from '../modules/invoice/wording';
import {
    invoiceSettledShareNotice, invoiceBalanceCaption, invoicePoolSummary, invoiceShareComponents,
    invoicePayerCalculation, invoicePoolCalculationBreakdown, invoicePoolCalculation, isOrganizerInvoice, presentInvoiceShare,
    formatInvoiceMoney, invoiceShareColumns,
} from '../modules/invoice/presentation';
import {invoiceAppliedTakeovers, invoiceHasAppliedTakeoverEvidence, invoiceHasPendingTakeovers} from '../modules/invoice/coverage';
import {evaluateSubject} from '../modules/permissionEngine';
import {ApiProblem, declaredApiProblem} from '../modules/api/problem';
import {createTranslator} from '../../common/localization/translator';
import type {EventInvoicePool} from '../modules/database/entities/event/EventInvoicePool';
import type {EventInvoice} from '../modules/database/entities/event/EventInvoice';
import type {EventInvoiceShare} from '../modules/database/entities/event/EventInvoiceShare';
import type {components} from '../../types/api/v1';
import type {ParticipantRow} from '../../types/EventTypes';
import type {InvoiceSharesPdfData, InvoiceTextFormatter, InvoiceAppliedTakeover, InvoiceMoneyMetric, InvoiceManagementContext} from '../../types/InvoicePoolTypes';
import type {MessageKey, MessageParameters} from '../../types/LocalizationTypes';
import type {PermBundle, SessionLike} from '../../types/PermissionTypes';

/** Bind the shared financial presentation to this request without changing the English default. */
function financeFormatter(locale?: string): InvoiceTextFormatter {
    if (!locale) return invoiceText;
    const translator = createTranslator(locale);
    // The presenter selects catalog keys dynamically; the translator checks their exact runtime parameters.
    return (key, parameters = {}) => translator.t(`finance.${key}` as MessageKey, parameters as MessageParameters[MessageKey]);
}

/** Load the event and current method grants without admitting a private finance audience. */
async function loadFinanceSubject(eventId: string, session: SessionLike) {
    const event = await eventService.getEventById(eventId);
    if (!event) throw new ApiProblem('NOT_FOUND');

    // Management grants may include public audiences independently of profile or page admission.
    const permissions = await evaluateSubject({kind: 'entity', entity: {
        entityType: 'event', entityId: event.id, ownerId: event.ownerId, eventId: event.id,
    }}, session);
    return {event, permissions};
}

/** Admit one finance audience before loading any invoice or settlement collections. */
async function admitFinance(eventId: string, session: SessionLike, audience?: components['schemas']['FinanceView']['audience']) {
    if (!session.profile?.id) throw new ApiProblem('AUTH_REQUIRED');
    const {event, permissions} = await loadFinanceSubject(eventId, session);

    // Page admission does not grant access to organizer finance or someone else's proof.
    const registration = await eventService.getRegistrationFor(session.profile.id, eventId);
    if (audience === 'organizer' && (!permissions.has('ACCESS_ADMIN') || !permissions.has('MANAGE_ASSIGNMENTS'))) {
        throw new ApiProblem('FORBIDDEN');
    }
    if (audience === 'participant' && !registration) throw new ApiProblem('FORBIDDEN');
    return {event, permissions, registration};
}

/** Keep recorder and participant attribution distinct, with contact details restricted to the organizer audience. */
function projectFinanceInvoice(eventId: string, pool: EventInvoicePool, invoice: EventInvoice,
    participants: readonly ParticipantRow[], audience: components['schemas']['FinanceView']['audience'],
    registrationId?: number): components['schemas']['FinanceInvoice'] {
    const participant = participants.find(row => row.id === invoice.registrationId);
    const ownsInvoice = registrationId !== undefined && invoice.registrationId === registrationId;
    // A proof link retains exactly the invoice's existing ownership, independently of its review state.
    return {id: String(invoice.id), poolId: pool.id, poolName: pool.name, revision: pool.calculationRevision,
        status: invoice.status, amount: formatInvoiceMoney(invoice.amount), description: invoice.description ?? null,
        correctedAmount: invoice.correctedAmount == null ? null : formatInvoiceMoney(invoice.correctedAmount),
        correctedDescription: invoice.correctedDescription ?? null, rejectionReason: invoice.rejectionReason ?? null,
        createdAt: invoice.track?.createdAt?.toISOString() ?? null, organizerRecorded: isOrganizerInvoice(invoice),
        recordedByName: invoice.recordedByName || invoice.recordedByProfile?.name || null,
        participantName: participant?.name ?? null, participantEmail: audience === 'organizer' ? participant?.email ?? null : null,
        proofOriginalName: invoice.proofOriginalName ?? null,
        proofUrl: invoice.proofPath ? `/event/${encodeURIComponent(eventId)}/invoice-pools/${encodeURIComponent(pool.id)}/invoices/${invoice.id}/proof` : null,
        canRetract: ownsInvoice && invoice.status === 'NEW', canClose: ownsInvoice && invoice.status === 'APPROVED'};
}

/** Project saved payer rows using the shared settlement and applied-coverage presentation owners. */
function projectFinanceShare(pool: EventInvoicePool, share: EventInvoiceShare,
    participants: readonly ParticipantRow[], audience: components['schemas']['FinanceView']['audience'],
    text: InvoiceTextFormatter): components['schemas']['FinanceShare'] {
    const payerName = participants.find(row => row.id === share.registrationId)?.name
        || text('participant', {id: share.registrationId});
    // Decimal persistence values are normalized before the shared pure presenter receives this saved row.
    const values = financeShareValues(share);
    const presentation = presentInvoiceShare(values, text);
    const coveredNames = invoiceAppliedTakeovers(pool).filter(row => row.payerRegistrationId === share.registrationId)
        .map(row => participants.find(person => person.id === row.beneficiaryRegistrationId)?.name
            || text('participant', {id: row.beneficiaryRegistrationId}));
    return {id: String(share.id), poolId: pool.id, poolName: pool.name, payerName,
        notes: (share.note ?? '').split(' • ').filter(Boolean), needsRecalculation: Boolean(pool.needsRecalculation),
        amount: formatInvoiceMoney(share.shareAmount), status: presentation.status, statusLabel: presentation.statusLabel, isPaid: Boolean(share.isPaid),
        caption: invoiceBalanceCaption(values, audience, text),
        settledShareNotice: invoiceSettledShareNotice(pool, share, participants, 'organizer', text),
        coveredNames, coverageKnown: invoiceHasAppliedTakeoverEvidence(pool)};
}

/** Normalize persisted decimal columns once for every read-only financial presenter. */
function financeShareValues(share: EventInvoiceShare) {
    return {registrationId: share.registrationId, baseShareAmount: Number(share.baseShareAmount),
        extraAmount: Number(share.extraAmount), invoiceCreditAmount: Number(share.invoiceCreditAmount),
        paymentCreditAmount: Number(share.paymentCreditAmount), shareAmount: Number(share.shareAmount), isPaid: Boolean(share.isPaid)};
}

/** Group an already selected applied or pending roster, retaining only admitted display names and registration identities. */
function projectFinanceCoverage(takeovers: readonly InvoiceAppliedTakeover[], participants: readonly ParticipantRow[],
    text: InvoiceTextFormatter): components['schemas']['FinanceCoverageGroup'][] {
    const names = new Map(participants.map(participant => [participant.id, participant.name]));
    const groups = new Map<number, components['schemas']['FinanceCoverageGroup']>();
    // Selection of applied versus pending responsibility stays with the existing coverage owner and its caller.
    for (const takeover of takeovers) {
        const payerId = takeover.payerRegistrationId;
        let group = groups.get(payerId);
        if (!group) {
            group = {payerId: String(payerId), payerName: names.get(payerId) || text('participant', {id: payerId}), beneficiaries: []};
            groups.set(payerId, group);
        }
        const id = takeover.beneficiaryRegistrationId;
        group.beneficiaries.push({id: String(id), name: names.get(id) || text('participant', {id})});
    }
    // Coverage projections complete payer groups sorted by their visible names; presentation does not alter responsibility.
    const result = [...groups.values()].sort((left, right) => left.payerName.localeCompare(right.payerName));
    for (const group of result) group.beneficiaries.sort((left, right) => left.name.localeCompare(right.name));
    return result;
}

/** Project only the participant contact fields already shown by the organizer and eligible coverage choosers. */
function projectFinanceParticipant(participant: ParticipantRow): components['schemas']['FinanceParticipant'] {
    return {id: String(participant.id), name: participant.name, email: participant.email ?? null};
}

/** Project accounting totals and distinct saved/future coverage only for the admitted pool audience. */
function projectFinancePool(pool: EventInvoicePool, participants: readonly ParticipantRow[],
    audience: components['schemas']['FinanceView']['audience'], canSubmit: boolean,
    text: InvoiceTextFormatter): components['schemas']['FinancePool'] {
    const organizer = audience === 'organizer';
    const showCoverage = organizer || canSubmit;
    const coverageKnown = showCoverage && invoiceHasAppliedTakeoverEvidence(pool);
    const hasPendingTakeovers = organizer && invoiceHasPendingTakeovers(pool);
    const hasSavedShares = organizer && pool.status === 'CLOSED' && pool.shares.length > 0;
    const assignedCount = pool.assignAll ? participants.length : pool.assignments.length;
    const assignedIds = new Set(pool.assignAll ? participants.map(row => Number(row.id)) : pool.assignments.map(row => row.registrationId));
    const snapshot = pool.calculationSnapshot;
    // Personal coverage receives only eligible OPEN pools. History/share-only pool metadata cannot widen its roster.
    const coverageGroups = showCoverage ? projectFinanceCoverage(invoiceAppliedTakeovers(pool), participants, text) : [];
    const pendingCoverageGroups = organizer && pool.status === 'CLOSED' && (!coverageKnown || hasPendingTakeovers)
        ? projectFinanceCoverage(pool.takeovers, participants, text) : [];
    return {id: pool.id, name: pool.name, description: pool.description ?? null, status: pool.status,
        isDefault: Boolean(pool.isDefault), needsRecalculation: Boolean(pool.needsRecalculation),
        hasPendingTakeovers, coverageKnown, coverageGroups, pendingCoverageGroups,
        assignedCount: showCoverage ? assignedCount : 0,
        assignAll: showCoverage && Boolean(pool.assignAll), revision: pool.calculationRevision, canSubmit,
        settings: organizer ? {distribution: pool.distributionMethod as components['schemas']['FinancePoolSettings']['distribution'],
            subtractPersonalInvoices: Boolean(pool.subtractPersonalInvoices),
            sendCalculationEmails: Boolean(pool.sendCalculationEmails), roundUpShares: Boolean(pool.roundUpShares)} : null,
        ...(organizer ? {canRollback: Boolean(pool.calculationSnapshot)} : {}),
        registrationIds: organizer ? [...assignedIds].map(String) : [],
        assignments: organizer ? pool.assignments.map(row => ({registrationId: String(row.registrationId),
            factor: Number(row.factor).toFixed(4), isExempt: Boolean(row.isExempt)})) : [],
        surcharges: organizer ? pool.surcharges.map(row => ({id: String(row.id), registrationId: String(row.registrationId),
            amount: formatInvoiceMoney(row.amount), note: row.note, subtractFromPool: Boolean(row.subtractFromPool)})) : [],
        // Participant contacts belong only to assigned choices in an eligible OPEN pool, never history-only pool metadata.
        coverageChoices: showCoverage ? participants.filter(row => assignedIds.has(Number(row.id))).map(projectFinanceParticipant) : [],
        currentCoverageGroups: showCoverage ? projectFinanceCoverage(pool.takeovers, participants, text) : [],
        // Personal rows never expose pool-wide accounting or another payer's calculation example.
        summary: organizer ? financeSummary(pool, text) : null,
        calculation: hasSavedShares ? invoicePoolCalculationBreakdown(snapshot?.explanation, snapshot?.surcharges, text) : null,
        exampleCalculation: hasSavedShares ? invoicePoolCalculation(snapshot?.explanation, pool.shares, snapshot?.surcharges, text) : null};
}

/** Adapt the existing saved summary once; its shared presenter remains the sole accounting owner. */
function financeSummary(pool: EventInvoicePool, text: InvoiceTextFormatter): components['schemas']['FinanceSummary'] {
    const summary = invoicePoolSummary(pool, text);
    // Only the wire scalar changes. Labels, ordering and all accounting decisions
    // remain those of the presenter also used by documents, email and exports.
    return {primary: summary.primary.map(financeMetric), details: summary.details.map(financeMetric), saved: summary.saved.map(financeMetric)};
}

/** Serialize a presenter metric without introducing another calculation or rounding rule. */
function financeMetric(metric: InvoiceMoneyMetric): components['schemas']['FinanceMetric'] {
    return {...metric, amount: formatInvoiceMoney(metric.amount)};
}

/** Read saved finance only, with separate organizer and personal disclosure boundaries and no maintenance writes. */
export async function readEventFinance(eventId: string, session: SessionLike,
    audience: components['schemas']['FinanceView']['audience'] = 'participant', locale?: string): Promise<components['schemas']['FinanceView']> {
    const {registration} = await admitFinance(eventId, session, audience);
    const text = financeFormatter(locale);
    const [pools, participants] = await Promise.all([
        invoiceService.listPools(eventId), eventService.getEventParticipantRows(eventId).then(projectEventParticipants),
    ]);
    // Eligibility and displayed pool values use this request's same hydrated
    // snapshot. Keep only eligible IDs, without copying or loading another graph.
    const eligiblePoolIds = new Set<string>();
    if (registration) {
        for (const pool of pools) {
            if (isParticipantSubmissionPool(pool, registration.id)) eligiblePoolIds.add(pool.id);
        }
    }
    // Organizers receive the existing accounting view; participants receive own invoices and own payer rows only.
    const invoices = pools.flatMap(pool => pool.invoices.filter(invoice => audience === 'organizer'
        || invoice.registrationId === registration!.id).map(invoice => projectFinanceInvoice(eventId, pool, invoice, participants, audience, registration?.id)));
    const shares = pools.flatMap(pool => pool.shares.filter(share => audience === 'organizer'
        || share.registrationId === registration!.id).map(share => projectFinanceShare(pool, share, participants, audience, text)));
    invoices.sort((left, right) => (right.createdAt ?? '').localeCompare(left.createdAt ?? '') || Number(right.id) - Number(left.id));
    // The participant projection uses other pool metadata only to name an own invoice/share; unrelated pools stay private.
    const visiblePools = audience === 'organizer' ? pools : pools.filter(pool => eligiblePoolIds.has(pool.id)
        || invoices.some(invoice => invoice.poolId === pool.id) || shares.some(share => share.poolId === pool.id));
    return {audience, registrationId: registration ? String(registration.id) : null, invoices, shares,
        participants: audience === 'organizer' ? participants.map(projectFinanceParticipant) : [],
        pools: visiblePools.map(pool => projectFinancePool(pool, participants, audience, eligiblePoolIds.has(pool.id), text))};
}

/** Load only the selected saved payer explanation after rechecking its audience and event/pool ownership. */
export async function readEventFinanceBreakdown(eventId: string, poolId: string, shareId: string,
    session: SessionLike, audience: components['schemas']['FinanceView']['audience'], locale?: string): Promise<components['schemas']['FinanceBreakdown']> {
    const {event, registration} = await admitFinance(eventId, session, audience);
    const text = financeFormatter(locale);
    const pool = await ensurePool(event, poolId);
    const share = pool.shares.find(row => String(row.id) === shareId);
    if (!share) throw new ApiProblem('NOT_FOUND');
    if (audience === 'participant' && share.registrationId !== registration!.id) throw new ApiProblem('FORBIDDEN');

    // The existing pure presentation owner selects only this payer's frozen contributions and coverage.
    const participants = await eventService.getEventParticipantRows(eventId).then(projectEventParticipants);
    const payerName = participants.find(row => row.id === share.registrationId)?.name;
    const snapshot = pool.calculationSnapshot;
    const values = financeShareValues(share);
    return {components: invoiceShareComponents(values, snapshot?.explanation, snapshot?.surcharges, text).map(financeMetric),
        calculation: invoicePayerCalculation(snapshot?.explanation, {...values, payerName}, snapshot?.surcharges, text),
        notes: (share.note ?? '').split(' • ').filter(Boolean), statusLabel: presentInvoiceShare(values, text).statusLabel,
        needsRecalculation: Boolean(pool.needsRecalculation), settledShareNotice: invoiceSettledShareNotice(pool, share, participants, 'organizer', text)};
}

/** Match participant document admission before accepting any uploaded proof bytes. */
export async function admitEventInvoiceSubmission(eventId: string, session: SessionLike): Promise<Event> {
    return (await admitFinance(eventId, session, 'participant')).event;
}

/** Bound participant-only command adapters to an own saved invoice before entering its unchanged business operation. */
async function admitOwnFinanceInvoice(eventId: string, poolId: string, invoiceId: string, session: SessionLike): Promise<Event> {
    const {event, registration} = await admitFinance(eventId, session, 'participant');
    const pool = await ensurePool(event, poolId);
    // In particular, a terminal CLOSED row must not bypass this adapter's own-invoice boundary.
    const invoice = pool.invoices.find(row => String(row.id) === invoiceId);
    if (!invoice) throw new ApiProblem('NOT_FOUND');
    if (invoice.registrationId !== registration!.id) throw new ApiProblem('FORBIDDEN');
    return event;
}

/** Adapt revision-checked retraction to the existing invoice owner without introducing another mutation. */
export async function retractEventInvoice(eventId: string, poolId: string, invoiceId: string, body: unknown, session: SessionLike): Promise<void> {
    const event = await admitOwnFinanceInvoice(eventId, poolId, invoiceId, session);
    // The shared operation's explicit precommit conflict remains a definite rejection in the generated transport.
    try {
        await retractInvoice(event, poolId, invoiceId, body, session as Request['session']);
    } catch (error) {
        if (error instanceof APIError && error.status === 409) throw declaredApiProblem(error) ?? new ApiProblem('RESOURCE_CONFLICT');
        throw error;
    }
}

/** Retain participant close admission and explicitly disable the organizer override. */
export async function closeEventInvoice(eventId: string, poolId: string, invoiceId: string, session: SessionLike): Promise<void> {
    const event = await admitOwnFinanceInvoice(eventId, poolId, invoiceId, session);
    await closeInvoice(event, poolId, invoiceId, session as Request['session'], undefined, false);
}

/** Reuse proof ownership independently from page audience, invoice status and proof retention. */
export async function readEventInvoiceProof(eventId: string, poolId: string, invoiceId: string, session: SessionLike): Promise<string> {
    const {event, permissions} = await admitFinance(eventId, session);
    // The proof policy admits an attributed participant or the independent manage-assignment method grant.
    return serveInvoiceProof(event, poolId, invoiceId, session as Request['session'], {entity: permissions} as PermBundle);
}

/** Admit only the management method, retaining explicit identity requirements for attributed invoice changes. */
async function admitFinanceManagement(eventId: string, session: SessionLike, requireProfile: boolean) {
    if (requireProfile && !session.profile?.id) throw new ApiProblem('AUTH_REQUIRED');
    const {event, permissions} = await loadFinanceSubject(eventId, session);
    // Commands follow MANAGE_ASSIGNMENTS alone; this does not admit any private organizer projection.
    if (!permissions.has('MANAGE_ASSIGNMENTS')) throw new ApiProblem('FORBIDDEN');
    return {event, permissions};
}

/** Preserve the organizer method grant independently from organizer-page admission. */
export async function admitEventFinanceOrganizer(eventId: string, session: SessionLike, requireProfile = false): Promise<Event> {
    const {event} = await admitFinanceManagement(eventId, session, requireProfile);
    return event;
}

/** Map only an existing precommit conflict, retaining its definite rejection across the versioned boundary. */
async function runFinanceOperation<T>(operation: () => Promise<T>): Promise<T> {
    try {
        return await operation();
    } catch (error) {
        // Controller prose stays private; no mutable admission or response preparation runs after a successful write.
        if (error instanceof APIError && error.status === 409) throw declaredApiProblem(error) ?? new ApiProblem('RESOURCE_CONFLICT');
        throw error;
    }
}

/** Create a pool through the existing validated controller owner after matching its shared method grant. */
export async function createEventFinancePool(eventId: string, body: unknown, session: SessionLike): Promise<string> {
    const event = await admitEventFinanceOrganizer(eventId, session);
    return runFinanceOperation(() => createInvoicePool(event, body, {eventId: event.id, actor: session}));
}

/** Adapt settings transport without altering saved shares or existing recalculation behavior. */
export async function updateEventFinanceSettings(eventId: string, poolId: string, body: unknown, session: SessionLike): Promise<void> {
    const event = await admitEventFinanceOrganizer(eventId, session);
    await runFinanceOperation(() => updatePoolSettings(event, poolId, body, {eventId: event.id, actor: session}));
}

/** Keep submission access separate from calculation, reusing the existing revision-checked operation. */
export async function changeEventFinanceSubmissionState(eventId: string, poolId: string, body: unknown, session: SessionLike): Promise<void> {
    const event = await admitEventFinanceOrganizer(eventId, session);
    await runFinanceOperation(() => changePoolSubmissionState(event, poolId, body, {eventId: event.id, actor: session}));
}

/** Record optional proof only after the route has admitted the organizer before receiving upload bytes. */
export async function recordEventOrganizerInvoice(event: Event, poolId: string, body: unknown, session: SessionLike,
    file?: Express.Multer.File): Promise<void> {
    // The existing owner validates attribution, locked pool membership, proof types and rejected-upload cleanup.
    await runFinanceOperation(() => addOrganizerInvoice(event, poolId, body, session as Request['session'], file,
        {eventId: event.id, actor: session}));
}

/** Dispatch one admitted invoice review to its existing owner, preserving evidence and revision requirements. */
export async function reviewEventFinanceInvoice(eventId: string, poolId: string, invoiceId: string,
    action: 'approve' | 'decline' | 'close' | 'revise' | 'reject', body: unknown, session: SessionLike): Promise<void> {
    // Retroactive changes retain the actor requirement; initial review follows the independent method grant.
    const {event, permissions} = await admitFinanceManagement(eventId, session, action === 'revise' || action === 'reject');
    const actor = session as Request['session'];
    const management: InvoiceManagementContext = {eventId: event.id, actor: session};
    // Every operation still validates event/pool ownership and lifecycle itself; this adapter supplies only method admission.
    await runFinanceOperation(async function reviewSavedInvoice() {
        switch (action) {
            case 'approve': return approveInvoice(event, poolId, invoiceId, body, actor, management);
            case 'decline': return declineInvoice(event, poolId, invoiceId, body, actor, management);
            case 'revise': return reviseInvoice(event, poolId, invoiceId, body, actor, management);
            case 'reject': return rejectAcceptedInvoice(event, poolId, invoiceId, body, actor, management);
            case 'close': {
                // Capture the already admitted method grant before the write instead of performing postcommit permission reads.
                return closeInvoice(event, poolId, invoiceId, actor, {entity: permissions} as PermBundle, true, management);
            }
        }
    });
}

/** Save enrollment, exemptions and factors through the existing assignment owner without recalculating shares. */
export async function updateEventFinanceAssignments(eventId: string, poolId: string, body: unknown, session: SessionLike): Promise<void> {
    const event = await admitEventFinanceOrganizer(eventId, session);
    await runFinanceOperation(() => updatePoolAssignments(event, poolId, body, {eventId: event.id, actor: session}));
}

/** Add a signed surcharge or rebate using the shared membership, precision and note checks. */
export async function addEventFinanceAdjustment(eventId: string, poolId: string, body: unknown, session: SessionLike): Promise<void> {
    const event = await admitEventFinanceOrganizer(eventId, session);
    await runFinanceOperation(() => addPoolSurcharge(event, poolId, body, {eventId: event.id, actor: session}));
}

/** Remove an adjustment through the existing event-scoped controller, retaining its idempotent behavior. */
export async function removeEventFinanceAdjustment(eventId: string, poolId: string, surchargeId: string, session: SessionLike): Promise<void> {
    const event = await admitEventFinanceOrganizer(eventId, session);
    await runFinanceOperation(() => removePoolSurcharge(event, poolId, surchargeId, {eventId: event.id, actor: session}));
}

/** Preserve participant self-coverage and the distinct organizer reassignment method in one transport adapter. */
export async function updateEventFinanceTakeovers(eventId: string, poolId: string, body: unknown, session: SessionLike,
    organizer: boolean): Promise<void> {
    const event = organizer ? await admitEventFinanceOrganizer(eventId, session)
        : (await admitFinance(eventId, session, 'participant')).event;
    // The shared operation repeats OPEN, assigned-payer, one-level and reassignment checks under its existing lock.
    await runFinanceOperation(() => updateTakeovers(event, poolId, body, session as Request['session'], organizer,
        organizer ? {eventId: event.id, actor: session} : undefined));
}

/** Present the shared read-only calculation with decimal wire values and request-local explanations. */
export async function previewEventFinancePool(eventId: string, poolId: string, session: SessionLike,
    locale?: string): Promise<components['schemas']['FinancePreview']> {
    const event = await admitEventFinanceOrganizer(eventId, session);
    const text = financeFormatter(locale);
    // The same preview engine projects carried settlements and arithmetic for interactive review and committed calculations.
    const {pool, preview} = await runFinanceOperation(() => loadPoolPreview(event, poolId));
    // Re-present numeric provenance in the chosen interface language; saved notes retain their original authored content.
    const shares = preview.shares.map(share => {
        const presentation = presentInvoiceShare(share, text);
        return {registrationId: String(share.registrationId), payerName: share.payerName,
            baseShareAmount: formatInvoiceMoney(share.baseShareAmount), extraAmount: formatInvoiceMoney(share.extraAmount),
            invoiceCreditAmount: formatInvoiceMoney(share.invoiceCreditAmount), paymentCreditAmount: formatInvoiceMoney(share.paymentCreditAmount),
            shareAmount: formatInvoiceMoney(share.shareAmount), calculatedAmount: formatInvoiceMoney(share.calculatedAmount),
            isPaid: Boolean(share.isPaid), notes: (share.note ?? '').split(' • ').filter(Boolean), statusLabel: presentation.statusLabel};
    });
    const totals = Object.fromEntries(
        Object.entries(preview.totals).map(([key, amount]) => [key, formatInvoiceMoney(amount)]),
    ) as components['schemas']['FinancePreviewTotals'];
    return {revision: preview.revision, roundUpShares: preview.roundUpShares, shares, columns: invoiceShareColumns(preview.shares, text),
        calculation: invoicePoolCalculationBreakdown(preview.explanation, pool.surcharges, text),
        exampleCalculation: invoicePoolCalculation(preview.explanation, preview.shares, pool.surcharges, text),
        totals};
}

/** Confirm the captured preview through the original close/recalculate owner, retaining its locked revision check. */
export async function calculateEventFinancePool(eventId: string, poolId: string, body: unknown,
    session: SessionLike, recalculate: boolean): Promise<void> {
    const event = await admitEventFinanceOrganizer(eventId, session);
    // The adapter chooses the existing operation once; notifications and carried credits remain owned by that operation.
    const management: InvoiceManagementContext = {eventId: event.id, actor: session};
    await runFinanceOperation(() => recalculate ? recalculatePool(event, poolId, body, session as Request['session'], management)
        : closePool(event, poolId, body, session as Request['session'], false, management));
}

/** Restore the saved local inputs without changing existing shares or recorded transfers. */
export async function rollbackEventFinancePool(eventId: string, poolId: string, body: unknown,
    session: SessionLike): Promise<components['schemas']['FinanceRollbackResult']> {
    const event = await admitEventFinanceOrganizer(eventId, session);
    return runFinanceOperation(() => rollbackPoolChanges(event, poolId, body, {eventId: event.id, actor: session}));
}

/** Queue the existing reachable-payer notices from saved shares, independently of current browser filters. */
export async function notifyEventFinancePool(eventId: string, poolId: string, body: unknown,
    session: SessionLike): Promise<components['schemas']['FinanceNotificationResult']> {
    const event = await admitEventFinanceOrganizer(eventId, session);
    return runFinanceOperation(() => notifyPoolShares(event, poolId, body, session as Request['session'], 'requested', [],
        {eventId: event.id, actor: session}));
}

/** Record or reverse the signed saved balance through the existing settlement owner, including stale calculations. */
export async function settleEventFinanceShare(eventId: string, poolId: string, shareId: string,
    isPaid: boolean, session: SessionLike): Promise<void> {
    const event = await admitEventFinanceOrganizer(eventId, session);
    // Confirmation belongs to the frontend; this transport deliberately adds no new revision or comparison protocol.
    await runFinanceOperation(() => markSharePaid(event, poolId, shareId, isPaid, session as Request['session'],
        {eventId: event.id, actor: session}));
}

// Resolve the registration ID for the current actor so validation stays localized.
/** Resolve authenticated event membership for ownership-sensitive invoice operations. */
async function getActorRegistrationId(event: Event, session: SessionLike) {
    if (!session.profile) return undefined;

    const registration = await eventService.getRegistrationFor(session.profile.id, event.id);
    return registration?.id;
}

// Pull the pool and ensure it belongs to the current event.
/** Load a pool within the current event before invoking any feature operation. */
async function ensurePool(event: Event, poolId: string) {
    const pool = await invoiceService.getPoolWithInvoices(poolId);
    if (pool?.event.id !== event.id) {
        throw new APIError(invoiceText('poolNotFound'), {}, 404);
    }
    return pool;
}

// Verify a registration is currently allowed in the pool so surcharge updates cannot target removed participants.
/** Reject an adjustment for a registration outside the requested pool. */
async function assertRegistrationAllowed(pool: Awaited<ReturnType<typeof ensurePool>>, registrationId: number) {
    const assignedIds = pool.assignAll
        ? (await eventService.getRegistrationsForEvent(pool.event.id)).map((r) => r.id)
        : pool.assignments.map((a) => a.registrationId);
    if (!assignedIds.includes(registrationId)) throw new APIError(invoiceText('participantNotAssignedToThisPool'), {}, 400, {cause: invoiceRejectionCause('participantNotAssignedToThisPool')});
}

// Create a new invoice pool with optional default/assign-all behavior and explicit participant list.
/** Orchestrate validated pool creation using current event registrations and the existing DBAL. */
async function createInvoicePool(event: Event, body: unknown, management?: InvoiceManagementContext) {
    // Load event membership once; the request module normalizes only registrations from that event.
    const registrations = await eventService.getRegistrationsForEvent(event.id);
    const value = preparePoolCreation(body, registrations);
    // Persist the validated creation plan through the existing DBAL entry point.
    /** Reuse the creation DBAL on the supplied Event-fenced connection when an
     * admitted management command requires fresh write-time authority. */
    function persistCreation(manager?: EntityManager) {
        return invoiceService.createPool(event.id, value.name, value.description, value.distribution,
            value.isDefault, value.assignAll, value.subtractPersonalInvoices, value.registrationIds,
            value.sendCalculationEmails, value.roundUpShares, value.status, manager);
    }
    return management ? withInvoiceManagementEvent(management, persistCreation) : persistCreation();
}

/** Normalize pool settings and delegate the locked input update. */
async function updatePoolSettings(event: Event, poolId: string, body: any, management?: InvoiceManagementContext) {
    await ensurePool(event, poolId);

    const value = preparePoolSettings(body);

    await poolOperations.saveInvoicePoolSettings(poolId, value.distribution, value.description,
        value.sendCalculationEmails === undefined ? undefined : value.sendCalculationEmails === true || value.sendCalculationEmails === 'on',
        value.roundUpShares === undefined ? undefined : value.roundUpShares === true || value.roundUpShares === 'on', management);
}

/** Orchestrate an explicit change between the two uncalculated pool states within the requested event. */
async function changePoolSubmissionState(event: Event, poolId: string, body: unknown, management?: InvoiceManagementContext): Promise<void> {
    // Resolve event ownership before delegating any lifecycle write; UI confirmation is not an authorization boundary.
    await ensurePool(event, poolId);
    const value = preparePoolSubmissionState(body);
    // The operation repeats lifecycle and revision checks under the same pool lock used by submissions and calculation.
    await poolOperations.savePoolSubmissionState(poolId, value.status, value.expectedRevision, management);
}

// Save calculation inputs independently; closed pools keep their shares until recalculation.
/** Normalize current event membership and delegate assignment, factor, and exemption changes. */
async function updatePoolAssignments(event: Event, poolId: string, body: any, management?: InvoiceManagementContext) {
    // Confirm event ownership before using current registration data to interpret assignment fields.
    const pool = await ensurePool(event, poolId);
    const registrations = await eventService.getRegistrationsForEvent(event.id);
    const value = preparePoolAssignments(pool, body, registrations);
    // Membership-dependent checks repeat under the root lock inside the domain operation.
    await poolOperations.saveInvoicePoolAssignments(poolId, value.isDefault, value.assignAll,
        value.subtractPersonalInvoices, value.registrationIds, value.exemptIds, value.participantFactors, management);
}

// Signed adjustments are applied after the weighted base split.
/** Validate a signed adjustment and delegate its locked persistence. */
async function addPoolSurcharge(event: Event, poolId: string, body: any, management?: InvoiceManagementContext) {
    const pool = await ensurePool(event, poolId);
    const value = prepareSurchargeRequest(body);

    const registrationId = Number(value.registrationId);
    const cleanedNote = (value.note as string).trim();
    if (!cleanedNote) throw new APIError(invoiceText('noteIsRequired'), body, 400, {cause: invoiceRejectionCause('noteIsRequired')});
    await assertRegistrationAllowed(pool, registrationId);
    const subtractFromPool = value.subtractFromPool === true || value.subtractFromPool === 'on';
    await poolOperations.savePoolSurcharge(poolId, registrationId, Number(value.amount), cleanedNote, subtractFromPool, management);
}

// Remove an adjustment, invalidating previously calculated shares when necessary.
/** Check event ownership before delegating an idempotent adjustment deletion. */
async function removePoolSurcharge(event: Event, poolId: string, surchargeId: string, management?: InvoiceManagementContext) {
    await ensurePool(event, poolId);
    await poolOperations.deletePoolSurcharge(poolId, Number(surchargeId), management);
}

// Update takeover mappings from either participants or administrators, respecting the "covered participants cannot cover others" rule.
/** Save authorized coverage inputs, notifying immediately only while no calculation has been saved. */
async function updateTakeovers(event: Event, poolId: string, body: any, session: Request['session'], allowReassign: boolean, management?: InvoiceManagementContext) {
    // Request authorization and membership are explicit inputs to the takeover business module.
    const pool = await ensurePool(event, poolId);
    const registrations = await eventService.getRegistrationsForEvent(event.id);
    const actorId = await getActorRegistrationId(event, session);
    const value = prepareTakeoverRequest(pool, body, registrations, actorId, allowReassign);
    // Commit the input diff first. The locked result distinguishes applied planning changes from
    // closed-pool edits, which leave the saved shares and applied coverage pending recalculation.
    const changes = await savePoolTakeovers(poolId, value.payerId, value.beneficiaryIds, allowReassign, management);
    if (!changes.applied || (!changes.added.length && !changes.removed.length)) return;
    // Notify only applied changes after commit; mail failures cannot undo their persisted inputs.
    try {
        const participants = await eventService.getEventParticipantRows(event.id).then(projectEventParticipants);
        await notifyTakeoverChanges(event, pool, changes, resolveActorLabel(session), participants);
    } catch (error) {
        console.error(invoiceText('takeoverNotificationFailed'), error);
    }
}

// Validate and submit a new invoice with its proof file attached.
/** Coordinate participant eligibility, proof attribution, locked submission, and a post-commit receipt. */
async function submitInvoice(event: Event, poolId: string, body: any, session: SessionLike, file?: Express.Multer.File | undefined) {
    /** Retain upload ownership through all admission, persistence and receipt work. */
    return withInvoiceProofUpload(file, async function persistOwnedProof() {
        // Resolve authenticated membership before normalizing invoice fields and checking this pool's eligibility.
        const regId = await getActorRegistrationId(event, session);
        if (!regId) throw new APIError(invoiceText('mustBeRegisteredToSubmit'), body, 401);
        const value = prepareSubmittedInvoice(body);

        const pool = await ensurePool(event, poolId);
        if (pool.status !== 'OPEN') throw new APIError(invoiceText('poolIsClosedForInvoiceSubmissions'), body, 400, {cause: invoiceRejectionCause('poolIsClosedForInvoiceSubmissions')});
        const isAssigned = pool.assignAll || pool.assignments?.some((a) => a.registration.id === regId);
        if (!isAssigned) throw new APIError(invoiceText('notAllowedForThisPool'), body, 403);
        // Participant uploads keep their established mandatory proof and accepted MIME types.
        if (!file) throw new APIError(invoiceText('proofRequired'), body, 400, {cause: invoiceRejectionCause('proofRequired')});
        const isValidProof = file.mimetype === 'application/pdf' || file.mimetype.startsWith('image/');
        if (!isValidProof) {
            throw new APIError(invoiceText('unsupportedProofType'), body, 400, {cause: invoiceRejectionCause('unsupportedProofType')});
        }
        // Give the locked operation a portable proof descriptor; only a successful save can produce a receipt.
        const proofPath = path.relative(process.cwd(), file.path);
        const invoiceId = await invoiceOperations.persistSubmittedInvoice(poolId, regId, value.amount, value.description || null, {
            path: proofPath,
            originalName: file.originalname,
            mimeType: file.mimetype,
        });
        // Load persisted attribution after commit and prepare the receipt independently of SMTP delivery.
        try {
            const invoice = await invoiceService.getInvoiceWithRegistration(poolId, invoiceId);
            notifySubmittedInvoice(event, pool, invoice, value);
        } catch (error) {
            console.error(invoiceText('receiptPreparationFailed'), error);
        }
    });
}

// Organizers can enter a shared pool cost without becoming an event participant.
/** Coordinate an accepted organizer expense and clean a rejected request’s optional upload. */
async function addOrganizerInvoice(event: Event, poolId: string, body: any, session: Request['session'], file?: Express.Multer.File, management?: InvoiceManagementContext) {
    /** Retain upload ownership through all admission, persistence and receipt work. */
    return withInvoiceProofUpload(file, async function persistOwnedProof() {
        // Organizers may record an accepted pool cost without registering, using optional bounded proof input.
        if (!session.profile?.id) throw new APIError(invoiceText('logInToRecordAPoolCost'), {}, 401);
        await ensurePool(event, poolId);
        const value = prepareOrganizerInvoice(body);
        if (file && !isProofMimeType(file.mimetype)) {
            throw new APIError(invoiceText('unsupportedProofType'), {}, 400, {cause: invoiceRejectionCause('unsupportedProofType')});
        }
        // Preserve the organizer recorder separately from optional paid-by attribution. The existing domain operation
        // repeats participant eligibility under the pool lock; absent attribution retains the shared-cost behavior.
        return await invoiceOperations.persistOrganizerInvoice(poolId, session.profile.id, value.amount, value.description, file ? {
            path: path.relative(process.cwd(), file.path), originalName: file.originalname, mimeType: file.mimetype,
        } : null, value.registrationId, management);
    });
}

// Accept an invoice, preserve optional organizer corrections, and notify the submitter.
/** Normalize organizer corrections and notify only a successfully committed acceptance. */
async function approveInvoice(
    event: Event,
    poolId: string,
    invoiceId: string,
    body: any,
    session: Request['session'],
    management?: InvoiceManagementContext,
) {
    const pool = await ensurePool(event, poolId);
    // Load the pool-scoped record for ownership checks and the post-commit notification context.
    const invoice = await invoiceService.getInvoiceWithRegistration(poolId, Number(invoiceId));
    if (!invoice) throw new APIError(invoiceText('invoiceNotFound'), {}, 404);
    if (invoice.status !== 'NEW') throw new APIError(invoiceText('onlyInvoicesAwaitingReviewCanBeAccepted'), body, 409, {cause: invoiceRejectionCause('onlyInvoicesAwaitingReviewCanBeAccepted', 409)});
    const {correctedAmount, correctedDescription} = prepareInvoiceAcceptance(body);
    // Repeat the review decision under the root lock; notify only the request that wins the transition.
    const accepted = await invoiceOperations.acceptSavedInvoice(poolId, Number(invoiceId), {correctedAmount, correctedDescription}, management);
    if (!accepted) throw new APIError(invoiceText('invoiceWasAlreadyReviewedReloadToSeeTheSaved'), {}, 409, {cause: invoiceRejectionCause('invoiceWasAlreadyReviewedReloadToSeeTheSaved', 409)});
    notifyAcceptedInvoice(event, pool, invoice, correctedAmount, correctedDescription, session);
}

// Close an approved invoice and inform the creator who performed the action.
/** Authorize invoice closure by its submitter or an organizer and notify after the locked transition. */
async function closeInvoice(
    event: Event,
    poolId: string,
    invoiceId: string,
    session: Request['session'],
    permData?: PermBundle,
    allowManageOverride = true,
    management?: InvoiceManagementContext,
) {
    const pool = await ensurePool(event, poolId);
    // Load the pool-scoped record for ownership checks and the post-commit notification context.
    const invoice = await invoiceService.getInvoiceWithRegistration(poolId, Number(invoiceId));
    if (!invoice) throw new APIError(invoiceText('invoiceNotFound'), {}, 404);
    if (invoice.status === 'CLOSED') return;
    if (invoice.status !== 'APPROVED') {
        throw new APIError(invoiceText('invoicesMustBeAcceptedBeforeClosing'), {}, 400, {cause: invoiceRejectionCause('invoicesMustBeAcceptedBeforeClosing')});
    }
    // Closing may be performed by the submitter or an authorized organizer; self-close forbids the override.
    const actorRegId = await getActorRegistrationId(event, session);
    const canManage = allowManageOverride && (permData?.entity?.has('MANAGE_ASSIGNMENTS') ?? false);
    const isSubmitter = actorRegId !== undefined && actorRegId === invoice.registrationId;
    if (!canManage && !isSubmitter) {
        throw new APIError(invoiceText('youCanOnlyCloseYourOwnAcceptedInvoicesUnless'), {}, 403);
    }
    // The domain retains the accepted cost and treats an already closed row idempotently.
    const closed = await invoiceOperations.closeSavedInvoice(poolId, Number(invoiceId), management);
    if (!closed) return;
    notifyClosedInvoice(event, pool, invoice, session);
}

// Reject an invoice without deleting its audit history or proof.
/** Normalize a rejection reason and notify only a successfully committed review decision. */
async function declineInvoice(
    event: Event,
    poolId: string,
    invoiceId: string,
    body: any,
    session: Request['session'],
    management?: InvoiceManagementContext,
) {
    const pool = await ensurePool(event, poolId);
    // Load the pool-scoped record for ownership checks and the post-commit notification context.
    const invoice = await invoiceService.getInvoiceWithRegistration(poolId, Number(invoiceId));
    if (!invoice) throw new APIError(invoiceText('invoiceNotFound'), {}, 404);
    if (invoice.status !== 'NEW') throw new APIError(invoiceText('onlyInvoicesAwaitingReviewCanBeRejected'), body, 409, {cause: invoiceRejectionCause('onlyInvoicesAwaitingReviewCanBeRejected', 409)});
    const value = prepareInvoiceRejection(body);

    // The locked decision retains invoice evidence and excludes this cost; notification follows successful commit.
    const declined = await invoiceOperations.rejectSavedInvoice(poolId, Number(invoiceId), value.rejectionReason, management);
    if (!declined) throw new APIError(invoiceText('invoiceWasAlreadyReviewedReloadToSeeTheSaved'), {}, 409, {cause: invoiceRejectionCause('invoiceWasAlreadyReviewedReloadToSeeTheSaved', 409)});
    notifyRejectedInvoice(event, pool, invoice, value.rejectionReason, session);
}

/** Coordinate a revision-checked correction while retaining submitted invoice evidence. */
async function reviseInvoice(event: Event, poolId: string, invoiceId: string, body: any, session: Request['session'], management?: InvoiceManagementContext) {
    const value = prepareInvoiceRevision(body);
    const pool = await ensurePool(event, poolId);
    // Load the pool-scoped record for ownership checks and the post-commit notification context.
    const invoice = await invoiceService.getInvoiceWithRegistration(poolId, Number(invoiceId));
    if (!invoice) throw new APIError(invoiceText('invoiceNotFound'), {}, 404);
    // Delegate the revision-checked mutation, then describe its committed result to the saved contact.
    const saved = await invoiceOperations.reviseSavedInvoice(poolId, Number(invoiceId), {
        correctedAmount: value.correctedAmount, correctedDescription: value.correctedDescription || null,
    }, value, management);
    notifySavedInvoiceChange(event, pool, invoice, saved, 'corrected', session);
}

/** Coordinate a revision-checked removal from calculated costs without deleting history. */
async function rejectAcceptedInvoice(event: Event, poolId: string, invoiceId: string, body: any, session: Request['session'], management?: InvoiceManagementContext) {
    const value = prepareAcceptedInvoiceRejection(body);
    const pool = await ensurePool(event, poolId);
    // Load the pool-scoped record for ownership checks and the post-commit notification context.
    const invoice = await invoiceService.getInvoiceWithRegistration(poolId, Number(invoiceId));
    if (!invoice) throw new APIError(invoiceText('invoiceNotFound'), {}, 404);
    // Delegate the revision-checked mutation, then describe its committed result to the saved contact.
    const saved = await invoiceOperations.rejectAcceptedSavedInvoice(poolId, Number(invoiceId), value.rejectionReason, value, management);
    notifySavedInvoiceChange(event, pool, invoice, saved, 'rejected', session);
}

/** Coordinate an authenticated submitter’s revision-checked withdrawal before review. */
async function retractInvoice(event: Event, poolId: string, invoiceId: string, body: any, session: Request['session']) {
    if (!session.profile?.id) throw new APIError(invoiceText('logInToRetractYourInvoice'), {}, 401);
    const value = prepareConfirmedInvoiceChange(body);
    const pool = await ensurePool(event, poolId);
    // Load the pool-scoped record for ownership checks and the post-commit notification context.
    const invoice = await invoiceService.getInvoiceWithRegistration(poolId, Number(invoiceId));
    if (!invoice) throw new APIError(invoiceText('invoiceNotFound'), {}, 404);
    // Delegate the revision-checked mutation, then describe its committed result to the saved contact.
    const saved = await invoiceOperations.retractSavedInvoice(poolId, Number(invoiceId), session.profile.id, value);
    notifySavedInvoiceChange(event, pool, invoice, saved, 'retracted', session);
}

/** Hydrate common preview inputs and retain their pool context for both transports' presentation. */
async function loadPoolPreview(event: Event, poolId: string) {
    // Hydrate one authorized pool and its event participants, then return the domain's read-only DTO.
    const pool = await ensurePool(event, poolId);
    const participants = await eventService.getEventParticipantRows(event.id).then(projectEventParticipants);
    const registrations = await eventService.getRegistrationsForEvent(event.id);
    return {pool, preview: buildPoolCalculationPreview(pool, participants, registrations)};
}

/** Return the shared preview shape through the shared calculation-input owner. */
async function previewPool(event: Event, poolId: string) {
    return (await loadPoolPreview(event, poolId)).preview;
}

/** Apply allocation inputs atomically, then notify applied coverage and optional settlement results. */
async function closePool(event: Event, poolId: string, body: any = {}, session?: Request['session'], recalculate = false, management?: InvoiceManagementContext) {
    const options = prepareCalculationOptions(body);
    // Fetch authorized source data once, then let the calculation module build allocations and provenance.
    const pool = await ensurePool(event, poolId);
    const participants = await eventService.getEventParticipantRows(event.id).then(projectEventParticipants);
    const registrations = await eventService.getRegistrationsForEvent(event.id);
    const {sharePayloads, approvedInvoiceIds, explanation} = calculatePoolInputs(pool, participants, registrations);
    // A preview must still match its input revision; the commit repeats the comparison under its lock.
    if (options.expectedRevision !== undefined && options.expectedRevision !== pool.calculationRevision) {
        throw new APIError(invoiceText('thePreviewIsOutOfDatePreviewTheCalculation'), {}, 409, {cause: invoiceRejectionCause('thePreviewIsOutOfDatePreviewTheCalculation', 409)});
    }
    // Persist shares, cumulative settlement credits, and saved calculation inputs in one locked transaction.
    const committed = await poolOperations.commitPoolCalculation(poolId, approvedInvoiceIds, sharePayloads, recalculate, pool.calculationRevision, explanation, management);
    // Capture this exact committed calculation for mandatory history notices, even if another request edits the pool afterward.
    const committedPool = {...pool, status: 'CLOSED' as const, needsRecalculation: false,
        shares: committed.shares, calculationSnapshot: committed.calculationSnapshot};
    const affectedRegistrationIds = committed.settledShareImpacts.map(impact => impact.registrationId);
    // Coverage notices describe the old-to-new applied snapshot, never the intermediate staged edits.
    // They remain independent of the calculation-email preference, matching immediate planning notices.
    try {
        await notifyTakeoverChanges(event, pool, committed.takeoverChanges, resolveActorLabel(session), participants);
    } catch (error) {
        console.error(invoiceText('takeoverNotificationFailed'), error);
    }
    // Historic payers must hear that exemption or coverage changed their saved responsibility, independently of bulk preferences.
    // Delivery is post-commit and cannot erase their retained payment/refund row or roll back the allocation.
    if (affectedRegistrationIds.length) {
        try {
            const contacts = new Map(participants.map(participant => [Number(participant.id), participant]));
            notifyPoolShareSettlements(event, committedPool, contacts, 'responsibility-changed', session,
                {registrationIds: affectedRegistrationIds});
        } catch (error) {
            console.error(invoiceText('settlementNotificationFailed'), error);
        }
    }
    // The settlement preference applies only after commit; delivery failures cannot undo calculation.
    const sendEmails = options.sendEmails === undefined ? pool.sendCalculationEmails : options.sendEmails === true || options.sendEmails === 'on';
    if (sendEmails) {
        try {
            await notifyPoolShares(event, poolId, {expectedRevision: pool.calculationRevision + 1}, session,
                recalculate ? 'recalculated' : 'closed', affectedRegistrationIds);
        } catch (error) {
            console.error(invoiceText('settlementNotificationFailed'), error);
        }
    }
}

/** Delegate restoration of saved pool inputs while retaining shares and settlements. */
async function rollbackPoolChanges(event: Event, poolId: string, body: any = {}, management?: InvoiceManagementContext) {
    await ensurePool(event, poolId);
    const options = prepareCalculationOptions(body);
    return poolOperations.restorePoolCalculationInputs(poolId, options.expectedRevision, management);
}

/** Resolve saved share and contact data before requesting settlement notices. */
async function notifyPoolShares(event: Event, poolId: string, body: any = {}, session?: Request['session'],
    reason: 'closed' | 'recalculated' | 'requested' = 'requested', excludedRegistrationIds: readonly number[] = [], management?: InvoiceManagementContext) {
    const options = prepareCalculationOptions(body);
    // Notifications describe the saved calculation; load contact data without recalculating any shares.
    const participants = new Map((await eventService.getEventParticipantRows(event.id).then(projectEventParticipants)).map((participant) => [Number(participant.id), participant]));
    const pool = await ensurePool(event, poolId);
    if (pool.status !== 'CLOSED') throw new APIError(invoiceText('closeThePoolBeforeSendingSettlementEmails'), {}, 400, {cause: invoiceRejectionCause('closeThePoolBeforeSendingSettlementEmails')});
    if (options.expectedRevision !== undefined && options.expectedRevision !== pool.calculationRevision) {
        throw new APIError(invoiceText('theSettlementChangedReloadBeforeSendingEmails'), {}, 409, {cause: invoiceRejectionCause('theSettlementChangedReloadBeforeSendingEmails', 409)});
    }
    // Explicit management dispatch receives fresh authority on the Event fence.
    // External notification delivery follows that admitted transaction; automatic
    // notices from an already committed calculation keep their original path.
    if (management) await withInvoiceManagementEvent(management);
    // The notification module owns message construction and non-blocking delivery for reachable payers.
    return notifyPoolShareSettlements(event, pool, participants, reason, session, {excludedRegistrationIds});
}

// Toggle payment state of a share and inform the participant with actor attribution.
/** Delegate a settlement-status change and describe the signed saved balance to its payer. */
async function markSharePaid(event: Event, poolId: string, shareId: string, isPaid: boolean, session: Request['session'], management?: InvoiceManagementContext) {
    const pool = await ensurePool(event, poolId);
    const share = await invoiceService.getShareWithRegistration(poolId, Number(shareId));
    if (!share) throw new APIError(invoiceText('shareNotFound'), {}, 404);
    // The domain updates status and date only, retaining the original signed calculated balance.
    await poolOperations.recordShareSettlement(poolId, Number(shareId), isPaid, management);
    notifyShareSettlement(event, pool, share, isPaid, session);
}

// Serve invoice proof files securely with authentication and permission checks
/** Resolve authenticated request context before delegating proof ownership and filesystem checks. */
export async function serveInvoiceProof(event: Event, poolId: string, invoiceId: string, session: Request['session'], permData?: PermBundle) {
    if (!session.profile) throw new APIError(invoiceText('logInToViewInvoiceProofs'), {}, 401);
    await ensurePool(event, poolId);
    // Load the pool-scoped record for ownership checks and the post-commit notification context.
    const invoice = await invoiceService.getInvoiceWithRegistration(poolId, Number(invoiceId));
    // Delegate ownership and file-boundary policy after collecting the authenticated request context.
    const actorRegId = await getActorRegistrationId(event, session);
    return getInvoiceProofPath(invoice, actorRegId, permData?.entity?.has('MANAGE_ASSIGNMENTS') ?? false);
}

/** Load a saved share export through DBAL and the invoice feature's export policy. */
async function getInvoiceSharesPdfData(event: Event, poolId: string, query: unknown = {}): Promise<InvoiceSharesPdfData> {
    // Normalize layout preferences in the existing request module before loading the authorized saved data.
    const pdfOptions = prepareSharesPdfOptions(query);
    // Validate the event boundary and frozen calculation before loading any participant names.
    const pool = await invoiceService.getPoolWithInvoices(poolId);
    assertInvoiceSharesExportable(pool, event.id);
    // Current names decorate saved rows only; every amount and calculation input stays frozen.
    const participants = await eventService.getEventParticipantRows(event.id).then(projectEventParticipants);
    const names = new Map(participants.map(participant => [participant.id, participant.name]));
    const shares = pool.shares.map(share => ({
        ...share, name: names.get(share.registrationId) ?? invoiceText('participant', {id: share.registrationId}),
        // Preserve the same frozen responsibility/history notice shown in both in-app share ledgers.
        settledShareNotice: invoiceSettledShareNotice(pool, share, participants),
    })).sort((left, right) => left.name.localeCompare(right.name) || left.registrationId - right.registrationId);
    // Pass the saved explanation explicitly, retaining the missing-input fallback for historical snapshots.
    // The exporter receives frozen adjustment modes alongside the saved explanation, including older snapshots.
    return {event, pool, shares, explanation: pool.calculationSnapshot?.explanation,
      savedAdjustments: pool.calculationSnapshot?.surcharges, generatedAt: new Date().toISOString(), pdfOptions};
}

// Replace the saved calculation atomically while the pool remains closed to new uploads.
/** Coordinate replacement of a closed pool’s saved calculation through the shared commit flow. */
async function recalculatePool(event: Event, poolId: string, body: any = {}, session?: Request['session'], management?: InvoiceManagementContext) {
    const pool = await ensurePool(event, poolId);
    if (pool.status !== 'CLOSED') {
        throw new APIError(invoiceText('onlyClosedPoolsCanBeRecalculated'), {}, 400, {cause: invoiceRejectionCause('onlyClosedPoolsCanBeRecalculated')});
    }

    await closePool(event, poolId, body, session, true, management);
}

export default {
    createInvoicePool,
    updatePoolSettings,
    changePoolSubmissionState,
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
    getInvoiceSharesPdfData,
    updateTakeovers,
    serveInvoiceProof
};
