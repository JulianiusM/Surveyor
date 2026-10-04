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

import {invoiceText} from './wording';
import {differenceInCalendarDays} from 'date-fns';
import type {EventInvoicePool} from '../database/entities/event/EventInvoicePool';
import type {EventInvoice} from '../database/entities/event/EventInvoice';
import type {EventRegistration} from '../database/entities/event/EventRegistration';
import type {ParticipantRow} from '../../types/EventTypes';
import type {InvoiceCalculationExplanation} from '../../types/InvoicePoolTypes';
import {APIError} from '../lib/errors';
import {formatAmount, resolveInvoiceAmount, toAmount} from '../lib/util';
import {collectSettledRegistrationIds, projectInvoiceShares} from './settlements';
import {invoiceLabels} from './wording';
import {invoiceCalculationLines, invoicePoolCalculation, invoicePayerCalculation, sumInvoiceAdjustments} from './presentation';
import {explainInvoiceDistribution} from './distribution';

// Build the same gross shares for the read-only preview and the committed calculation.
/** Build gross allocations and numeric provenance once for both preview and committed calculation. */
export function preparePoolCalculation(pool: EventInvoicePool, participants: ParticipantRow[], registrations: EventRegistration[]) {

    // Select only costs that contribute to this calculation; review history stays outside the arithmetic.
    const approvedInvoices = (pool.invoices || []).filter(
        (invoice) => invoice.status === 'APPROVED' || invoice.status === 'CLOSED',
    );

    // Build one name lookup for contribution provenance and takeover attribution.
    const participantMap = new Map(participants.map((p) => [p.id, p]));

    // Gather target registrations before handing persistence back to the service
    const targetRegistrations = pool.assignAll
        ? registrations
        : Array.from(new Map(pool.assignments.map((assignment) => [assignment.registrationId, assignment.registration])).values());
    if (!targetRegistrations.length && pool.status !== 'CLOSED') throw new APIError(invoiceText('noParticipantsAssignedToThisPool'), {}, 400);

    const targetIds = new Set(targetRegistrations.map((r) => r.id));
    const exemptIds = new Set((pool.assignments || []).filter((a) => a.isExempt).map((a) => a.registrationId));
    const billableRegistrations = targetRegistrations.filter((reg) => !exemptIds.has(reg.id));

    // Bucket surcharges per participant so we can attribute them to a single payer later.
    const surchargeMap = bucketSurcharges(pool, targetIds);

    // Aggregate the total approved invoice amounts submitted by each participant.
    // This will later be deducted from their calculated share if pool.subtractPersonalInvoices is enabled.
    const invoiceCreditMap = bucketInvoiceCredit(approvedInvoices, targetIds);

    // Respect saved one-level takeovers; the takeover module validates who may cover each beneficiary.
    const takeoverMap = calculateTakeovers(pool, targetIds);

    // Calculate the individual base costs
    const baseCalculation = calculateIndividualCosts(pool, billableRegistrations);
    const individualCosts = baseCalculation.costs;
    const factors = new Map((pool.assignments || []).map(assignment => [assignment.registrationId, assignment.factor ?? 1]));
    const explanation: InvoiceCalculationExplanation = {
        version: 1, distributionMethod: pool.distributionMethod,
        roundUpShares: pool.roundUpShares == null || !!pool.roundUpShares,
        invoiceAmount: baseCalculation.invoiceAmount,
        redistributedAmount: baseCalculation.redistributedAmount,
        distributableAmount: baseCalculation.distributableAmount,
        assignedParticipants: targetRegistrations.length,
        exemptParticipants: targetRegistrations.filter(registration => exemptIds.has(registration.id)).length,
        attendanceUnits: 0, eligibleAttendanceUnits: 0, effectiveWeight: baseCalculation.effectiveWeight,
        weightDenominator: baseCalculation.ratios.totalWeight,
        contributions: [],
        // Preserve gross signed categories, including offsetting adjustments, for adaptive explanations.
        adjustmentTotals: sumInvoiceAdjustments(pool.surcharges || []),
    };
    // Retain only numeric provenance and the already visible participant labels. Never infer the
    // denominator later from editable attendance or parse human-readable notes as calculation data.
    for (const registration of targetRegistrations) {
        const attendanceWeight = invoiceAttendanceWeight(pool, registration);
        const factor = factors.get(registration.id) ?? 1;
        const isExempt = exemptIds.has(registration.id);
        explanation.attendanceUnits += attendanceWeight;
        if (!isExempt) explanation.eligibleAttendanceUnits += attendanceWeight;
        explanation.contributions.push({
            registrationId: registration.id, payerRegistrationId: takeoverMap.get(registration.id) ?? registration.id,
            name: participantMap.get(registration.id)?.name || invoiceText('participant', {id: registration.id}),
            attendanceWeight, factor, isExempt, effectiveWeight: isExempt ? 0 : attendanceWeight * factor,
            weightNumerator: baseCalculation.ratios.weights.get(registration.id) ?? '0',
            baseShareAmount: individualCosts.get(registration.id)?.total ?? 0,
        });
    }

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

    // Round combined payer components to cents only after each beneficiary's base was allocated independently.
    const sharePayloads = Array.from(payerShares.entries()).map(([registrationId, data]) => {
        const baseShareAmount = Math.round(data.base * 100) / 100;
        const extraAmount = Math.round(data.surcharges * 100) / 100;
        const invoiceCreditAmount = Math.round(data.invoiceCredits * 100) / 100;
        const shareAmount = Math.round((baseShareAmount + extraAmount - invoiceCreditAmount) * 100) / 100;
        const note = data.detailNotes.filter(Boolean).join(' • ') || undefined;
        return {registrationId, baseShareAmount, extraAmount, invoiceCreditAmount, shareAmount, note};
    });

    return {pool, participants, sharePayloads, explanation, approvedInvoiceIds: approvedInvoices.map((invoice) => invoice.id)};
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

/** Group current members’ signed adjustments without moving their beneficiary attribution. */
function bucketSurcharges(pool: EventInvoicePool, targetIds: Set<number>) {
    const surchargeMap = new Map<number, { amount: number; note: string }[]>();
    // Group signed adjustments only for current targets; a takeover later attributes the complete personal result.
    for (const surcharge of pool.surcharges || []) {
        if (!targetIds.has(surcharge.registrationId)) continue;
        const existing = surchargeMap.get(surcharge.registrationId) || [];
        existing.push({amount: toAmount(surcharge.amount), note: surcharge.note});
        surchargeMap.set(surcharge.registrationId, existing);
    }
    return surchargeMap;
}

/** Group effective participant invoice credits, excluding organizer-only costs. */
function bucketInvoiceCredit(approvedInvoices: EventInvoice[], targetIds: Set<number>) {
    const invoiceCreditMap = new Map<number, number>();
    // Organizer costs have no registration and therefore never create a personal invoice credit.
    for (const invoice of approvedInvoices) {
        if (invoice.registrationId == null) continue;
        if (!targetIds.has(invoice.registrationId)) continue;
        // Accepted corrections replace the effective cost; each participant's original evidence remains untouched.
        const running = invoiceCreditMap.get(invoice.registrationId) || 0;
        invoiceCreditMap.set(
            invoice.registrationId,
            running + resolveInvoiceAmount(invoice.amount, invoice.correctedAmount),
        );
    }
    return invoiceCreditMap;
}

/** Select saved one-level coverage links whose payer and beneficiary are current targets. */
function calculateTakeovers(pool: EventInvoicePool, targetIds: Set<number>) {
    const takeoverMap = new Map<number, number>();
    // Ignore links outside the current assignment set; valid links preserve the beneficiary's own calculation inputs.
    for (const takeover of pool.takeovers || []) {
        if (!targetIds.has(takeover.beneficiaryRegistrationId) || !targetIds.has(takeover.payerRegistrationId)) continue;
        takeoverMap.set(takeover.beneficiaryRegistrationId, takeover.payerRegistrationId);
    }
    return takeoverMap;
}

/** Resolve the pool’s participant, inclusive-day, or night-based attendance units. */
function invoiceAttendanceWeight(pool: EventInvoicePool, registration: EventRegistration): number {
    return pool.distributionMethod === 'EQUAL' ? 1
        : differenceInCalendarDays(registration.departureDate, registration.arrivalDate)
            + (pool.distributionMethod === 'NIGHTS' ? 0 : 1);
}

/** Derive the shared base and allocate it through the exact weighted rounding implementation. */
function calculateIndividualCosts(pool: EventInvoicePool, billableRegistrations: EventRegistration[]) {
    // Separate accepted invoice costs from redistributed adjustments to derive the base amount.
    const invoiceTotal = pool.invoices.filter((invoice) => invoice.status === 'APPROVED' || invoice.status === 'CLOSED')
        .reduce((sum, invoice) => sum + resolveInvoiceAmount(invoice.amount, invoice.correctedAmount), 0);
    const offset = (pool.surcharges || []).filter((adjustment) => adjustment.subtractFromPool)
        .reduce((sum, adjustment) => sum + toAmount(adjustment.amount), 0);
    const factors = new Map((pool.assignments || []).map((assignment) => [assignment.registrationId, assignment.factor ?? 1]));
    // Attendance units and each registration's factor form the exact distribution weight.
    const weights = billableRegistrations.map((registration) => {
        const days = pool.distributionMethod === 'EQUAL' ? undefined : invoiceAttendanceWeight(pool, registration);
        return {registrationId: registration.id, weight: days ?? 1, factor: factors.get(registration.id) ?? 1, days};
    });
    // One allocator returns both rounded amounts and exact ratios for the saved numerical explanation.
    try {
        const ratios = explainInvoiceDistribution(invoiceTotal - offset, weights, pool.roundUpShares == null || !!pool.roundUpShares);
        const costs = new Map(weights.map((participant) => [participant.registrationId, {
            total: ratios.amounts.get(participant.registrationId) ?? 0,
            days: participant.days,
            factor: participant.factor,
        }]));
        return {costs, ratios, invoiceAmount: Math.round(invoiceTotal * 100) / 100,
            redistributedAmount: Math.round(offset * 100) / 100,
            distributableAmount: Math.round((invoiceTotal - offset) * 100) / 100,
            // Attendance units are integers and factors have at most four decimal places. Keep
            // the displayed divisor free of binary floating-point artifacts; ratios remain exact.
            effectiveWeight: Math.round(weights.reduce((sum, participant) => sum + participant.weight * participant.factor, 0) * 10000) / 10000};
    } catch (error) {
        throw new APIError(error instanceof Error ? error.message : invoiceText('cannotCalculateInvoiceShares'), {}, 400);
    }
}

/** Combine each participant’s complete financial result into their assigned covering payer. */
function calculatePayerShares(dto: CalculationDto) {
    const payerShares = new Map<number, {
        base: number;
        surcharges: number;
        invoiceCredits: number;
        notes: string[];
        beneficiaries: number[];
        detailNotes: string[]
    }>();
    // Calculate each person's components before combining them into the payer chosen by coverage.
    for (const registration of dto.targetRegistrations) {
        const personalCost: { total?: number, days?: number, factor?: number } = dto.individualCosts.get(registration.id) || {};
        const baseShare = dto.exemptIds.has(registration.id) ? 0 : (personalCost.total || 0);
        const extras = dto.surchargeMap.get(registration.id) || [];
        const extraTotal = extras.reduce((sum, entry) => sum + entry.amount, 0);
        // If subtractPersonalInvoices is enabled, participants receive credit for their submitted invoices.
        // This reduces their share by the amount they've already contributed via invoices.
        const invoiceCredit = dto.pool.subtractPersonalInvoices ? (dto.invoiceCreditMap.get(registration.id) || 0) : 0;
        const payerId = dto.takeoverMap.get(registration.id) ?? registration.id;
        const participantLabel = dto.participantMap.get(registration.id)?.name || invoiceText('participant', {id: registration.id});
        const beneficiaryName = payerId !== registration.id ? participantLabel : null;
        const bucket = payerShares.get(payerId) || {
            base: 0,
            surcharges: 0,
            invoiceCredits: 0,
            notes: [],
            beneficiaries: [],
            detailNotes: []
        };
        // A takeover moves the complete personal result; factors never scale fixed adjustments or invoice credits.
        bucket.base += baseShare;
        bucket.surcharges += extraTotal;
        bucket.invoiceCredits += invoiceCredit;
        calculatePayerSharesInitialNotes(dto, registration, beneficiaryName, baseShare, personalCost, bucket);
        // Preserve signed adjustments and their attribution in saved, human-readable calculation notes.
        for (const entry of extras) {
            const adjustmentTarget = beneficiaryName || participantLabel;
            const detailLabel = entry.note ? invoiceText('namedNote', {name: adjustmentTarget, note: entry.note}) : adjustmentTarget;
            const label = entry.amount < 0 ? invoiceText('rebate') : invoiceText('surcharge');
            bucket.detailNotes.push(invoiceText('adjustmentDetail', {kind: label, name: detailLabel, amount: formatAmount(entry.amount)}));
            if (entry.note) bucket.notes.push(invoiceText('adjustmentNote', {kind: label, name: adjustmentTarget, note: entry.note}));
        }
        if (invoiceCredit) {
            bucket.detailNotes.push(invoiceText('invoiceCreditFor', {name: participantLabel, amount: formatAmount(-invoiceCredit)}));
        }
        payerShares.set(payerId, bucket);
    }
    return payerShares;
}

/** Record base, factor, attendance, exemption, and coverage facts alongside allocated amounts. */
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
    // Explain base allocation, non-default factors, exemption, and attendance as separate saved facts.
    const participantLabel = dto.participantMap.get(registration.id)?.name || invoiceText('participant', {id: registration.id});
    bucket.detailNotes.push(invoiceText('baseShareFor', {name: participantLabel, amount: formatAmount(baseShare)}));
    if (personalCost.factor !== undefined && personalCost.factor !== 1) {
        bucket.detailNotes.push(invoiceText('shareFactorFor', {name: participantLabel, factor: personalCost.factor}));
    }
    if (dto.exemptIds.has(registration.id)) bucket.detailNotes.push(invoiceText('exemptFromAutomaticShare'));
    // Exempt people are absent from billable costs, but still have their actual saved attendance.
    // Read the same registration evidence as the numeric explanation, rather than mislabel absent cost metadata as zero nights.
    const attendance = dto.pool.distributionMethod === 'EQUAL' ? undefined : invoiceAttendanceWeight(dto.pool, registration);
    if (attendance) {
        bucket.detailNotes.push(invoiceText(dto.pool.distributionMethod === 'NIGHTS' ? 'attendanceNightsNote' : 'attendanceDaysNote', {count: attendance}));
    } else if (dto.pool.distributionMethod === "NIGHTS") {
        bucket.detailNotes.push(invoiceText('noNightsStayed'));
    }
    // Mark covered contributions explicitly; settlement credits remain with the payer independently of these notes.
    if (beneficiaryName) {
        bucket.beneficiaries.push(registration.id);
        bucket.notes.push(invoiceText('covering', {beneficiaryName: beneficiaryName}));
    }
}

/** Build read-only reconciliation and explanatory data using exactly the committed calculation rules. */
export function buildPoolCalculationPreview(pool: EventInvoicePool, participants: ParticipantRow[], registrations: EventRegistration[]) {
    // Use the same gross allocation builder that the controller passes to the commit operation.
    const {sharePayloads, explanation} = preparePoolCalculation(pool, participants, registrations);
    const participantMap = new Map(participants.map((participant) => [Number(participant.id), participant]));
    // Preview cumulative settlement credits with the same projection that the locked commit uses.
    const registrationIds = registrations.map(registration => registration.id);
    const settledRegistrationIds = collectSettledRegistrationIds(pool.shares || [], registrationIds);
    const projected = projectInvoiceShares(pool.shares || [], sharePayloads, registrationIds);
    /** Add the actual payer's display name before explaining their own and covered projected contributions. */
    function previewShare(share: typeof projected[number]) {
        // A former payer may only have a carried credit, so resolve identity independently of the new attendance inputs.
        const payerShare = {...share, payerName: participantMap.get(share.registrationId)?.name || invoiceText('participant', {id: share.registrationId})};
        return {
            ...payerShare,
            calculation: invoicePayerCalculation(explanation, payerShare, pool.surcharges || []),
            calculatedAmount: Math.round((share.baseShareAmount + share.extraAmount - share.invoiceCreditAmount) * 100) / 100,
        };
    }
    const shares = projected.map(previewShare);
    /** Round an aggregate of calculated amount components to the established cent precision. */
    function sum(amounts: number[]): number {
        return Math.round(amounts.reduce((total, amount) => total + amount, 0) * 100) / 100;
    }
    // Use the base calculator's saved numeric inputs for reconciliation as well as explanations.
    const {invoiceAmount, redistributedAmount, distributableAmount} = explanation;
    const additionalAmount = sum((pool.surcharges || []).filter((adjustment) => !adjustment.subtractFromPool)
        .map((adjustment) => toAmount(adjustment.amount)));
    const allocatedBaseAmount = sum(shares.map((share) => share.baseShareAmount));
    const adjustmentAmount = sum(shares.map((share) => share.extraAmount));
    const invoiceCreditAmount = sum(shares.map((share) => share.invoiceCreditAmount));
    // Reconcile gross costs, invoice credits, and carried settlements separately; no data is written by preview.
    return {
        revision: pool.calculationRevision,
        roundUpShares: pool.roundUpShares == null || !!pool.roundUpShares,
        explanation,
        settledRegistrationIds,
        basisLines: invoiceCalculationLines(explanation, shares, pool.surcharges || []),
        calculation: invoicePoolCalculation(explanation, shares, pool.surcharges || []),
        labels: invoiceLabels,
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
