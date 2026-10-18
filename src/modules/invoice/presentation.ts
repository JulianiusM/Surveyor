/*
 * Copyright 2026 Julian Malovanij
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *     http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 */

import {invoiceLabels, invoiceText} from './wording';
import {invoiceAppliedTakeovers, invoiceHasPendingTakeovers, invoiceHasAppliedTakeoverEvidence, invoiceSettledShareImpact} from './coverage';
import type {EventInvoice} from '../database/entities/event/EventInvoice';
import type {ParticipantRow} from '../../types/EventTypes';
import type {InvoiceAdjustmentInput, InvoiceAdjustmentTotals, InvoiceCalculationExplanation,
    InvoiceCalculationShare, InvoiceFinancialColumn, InvoiceFinancialComponent,
    InvoiceSharePresentation, InvoiceCalculationDisplay, InvoiceCalculationOverview, InvoiceCalculationSection,
    InvoiceCalculationTerm, InvoiceCalculationFormula, InvoiceMoneyMetric,
    InvoicePoolSummary, InvoicePoolSummaryInput, InvoiceBalanceAudience, InvoiceAppliedTakeoversInput,
    InvoiceSettledShareNoticePresentation, InvoiceTextKey} from '../../types/InvoicePoolTypes';

/** Identify organizer recording independently from the participant who may have paid the invoice. */
export function isOrganizerInvoice(invoice: Pick<EventInvoice, 'registrationId' | 'recordedByName'
    | 'recordedByProfileId' | 'recordedByProfile'>): boolean {
    // Optional participant attribution must not turn an organizer's optional proof or recorder audit
    // into participant-submission behavior. The saved name still proves origin after profile deletion.
    return invoice.registrationId == null || !!(invoice.recordedByName || invoice.recordedByProfileId || invoice.recordedByProfile);
}

/** Explain the saved balance from the viewer's role without recalculating it or replacing settlement status. */
export function invoiceBalanceCaption(share: Pick<InvoiceCalculationShare, 'shareAmount' | 'isPaid'>,
    audience: InvoiceBalanceAudience = 'organizer'): string {
    // Keep the original caption precedence: a recorded settlement takes priority even for a zero balance.
    if (share.isPaid) return invoiceText('alreadySettled');
    const balance = Number(share.shareAmount);
    // Only the saved balance sign controls payment direction; the displayed signed amount remains unchanged.
    if (balance < 0) return invoiceText(audience === 'organizer' ? 'amountToPayOut' : 'refundToReceive');
    if (balance > 0) return invoiceText(audience === 'organizer' ? 'amountToCollect' : 'amountToPay');
    return invoiceText('noPaymentDue');
}

/** Present retained settlements when the saved calculation exempts or covers their original payer. */
export function invoiceSettledShareNotice(pool: InvoiceAppliedTakeoversInput,
    share: Pick<InvoiceCalculationShare, 'registrationId'>,
    participants: readonly Pick<ParticipantRow, 'id' | 'name'>[] = [],
    audience: InvoiceBalanceAudience = 'organizer'): InvoiceSettledShareNoticePresentation | null {
    if (share.registrationId == null) return null;
    // The pure policy reads frozen transfer membership and applied responsibility only. Pending
    // assignments and takeovers cannot turn an unapplied edit into a settlement-history warning.
    const impact = invoiceSettledShareImpact(pool, share.registrationId);
    if (!impact) return null;
    // Recipient mail addresses the participant directly; shared ledgers keep their neutral third-party explanation.
    if (impact.reason === 'exempt') return audience === 'participant'
        ? {label: invoiceText('settledShareExemptRecipientLabel'), description: invoiceText('settledShareExemptRecipientDescription')}
        : {label: invoiceText('settledShareExemptLabel'), description: invoiceText('settledShareExemptDescription')};
    // A saved payer name belongs to the applied calculation. Current participant data is an explicit
    // fallback for older snapshots; never select a name from a staged takeover mapping.
    const payerId = impact.payerRegistrationId;
    const savedPayer = pool.calculationSnapshot?.explanation?.contributions.find(row => row.registrationId === payerId);
    const currentPayer = participants.find(row => Number(row.id) === payerId);
    const payerName = savedPayer?.name || currentPayer?.name
        || (payerId == null ? invoiceLabels.payer : invoiceText('participant', {id: payerId}));
    return {
        label: invoiceText(audience === 'participant' ? 'settledShareCoveredRecipientLabel' : 'settledShareCoveredLabel', {payerName}),
        description: invoiceText(audience === 'participant' ? 'settledShareCoveredRecipientDescription' : 'settledShareCoveredDescription', {payerName}),
    };
}

/** Address saved financial component labels to a mail recipient without altering the calculation's neutral labels. */
export function invoiceRecipientComponentLabel(key: InvoiceFinancialComponent['key']): string {
    // Numeric component identity selects one complete catalog entry; no renderer rewrites third-party wording.
    const keys: Record<InvoiceFinancialComponent['key'], InvoiceTextKey> = {
        baseShareAmount: 'emailYourBaseShare', extraAmount: 'emailYourAdjustments',
        invoiceCreditAmount: 'emailYourInvoiceCredit', paymentCreditAmount: 'emailYourPreviousSettled',
        shareAmount: 'emailYourCalculatedBalance', redistributedSurcharges: 'emailYourRedistributedSurcharges',
        redistributedRebates: 'emailYourRedistributedRebates', additionalSurcharges: 'emailYourOnTopSurcharges',
        additionalRebates: 'emailYourOnTopRebates',
    };
    return invoiceText(keys[key]);
}

/** Describe the payer's obligation and action without changing the calculated balance. */
export function presentInvoiceSettlement(balance: number, isPaid: boolean, labels = invoiceLabels) {
    // Preserve the established filter keys; translations change the visible wording only.
    const status = isPaid || balance === 0 ? 'settled' : balance < 0 ? 'refund' : 'due';
    // Completed positive payments and negative refunds remain distinguishable from a zero balance.
    const statusLabel = balance === 0 ? labels.settledStatus
        : isPaid ? balance < 0 ? labels.refundCompleted : labels.paymentCompleted
            : balance < 0 ? labels.refund : labels.due;
    const actionLabel = isPaid
        ? balance < 0 ? labels.reverseRefund : labels.reversePayment
        : balance < 0 ? labels.recordRefund : labels.recordPayment;
    return {status, statusLabel, actionLabel} as const;
}

/** Preserve signed money, including completed refunds, without exposing negative zero. */
export function formatInvoiceMoney(amount: number | string | null | undefined): string {
    const cents = Math.round(Number(amount ?? 0) * 100);
    return (cents === 0 ? 0 : cents / 100).toFixed(2);
}

/** Present the saved calculated balance independently from its payment or refund status. */
export function presentInvoiceShare(share: {
    baseShareAmount: number; extraAmount: number; invoiceCreditAmount: number;
    shareAmount: number; isPaid: boolean; paymentCreditAmount?: number;
}): InvoiceSharePresentation {
    // The saved residual is the calculated balance for this calculation, including carried credits.
    // Marking it paid records settlement; it must never replace that visible balance with zero.
    const originalBalance = Number(share.shareAmount);
    const settledAmount = share.isPaid ? originalBalance : 0;
    const remainingAmount = share.isPaid ? 0 : originalBalance;
    // The same status rules drive browser updates, saved views, emails, and exported rows.
    const settlement = presentInvoiceSettlement(originalBalance, share.isPaid);
    return {
        calculatedAmount: Math.round((Number(share.baseShareAmount) + Number(share.extraAmount)
            - Number(share.invoiceCreditAmount)) * 100) / 100,
        originalBalance, settledAmount, remainingAmount, ...settlement,
    };
}

/** Sum signed source categories in cents, preserving opposite adjustments that cancel out. */
export function sumInvoiceAdjustments(adjustments: readonly InvoiceAdjustmentInput[]): InvoiceAdjustmentTotals {
    const cents: InvoiceAdjustmentTotals = {
        redistributedSurcharges: 0, redistributedRebates: 0, additionalSurcharges: 0, additionalRebates: 0,
    };
    // Classification uses the source's mode and sign; neither display nor settlement inverts rebates.
    for (const adjustment of adjustments) {
        const amount = Math.round(Number(adjustment.amount) * 100);
        const key = adjustment.subtractFromPool
            ? amount < 0 ? 'redistributedRebates' : 'redistributedSurcharges'
            : amount < 0 ? 'additionalRebates' : 'additionalSurcharges';
        cents[key] += amount;
    }
    // Keep cent arithmetic internal and expose ordinary decimal amounts to every presentation surface.
    for (const key of Object.keys(cents) as Array<keyof InvoiceAdjustmentTotals>) cents[key] /= 100;
    return cents;
}

/** Display only source categories actually used, in one stable order across the module. */
export function invoiceAdjustmentRows(input?: readonly InvoiceAdjustmentInput[] | InvoiceAdjustmentTotals): InvoiceFinancialComponent[] {
    if (!input) return [];
    const totals = Array.isArray(input) ? sumInvoiceAdjustments(input) : input as InvoiceAdjustmentTotals;
    const rows: InvoiceFinancialComponent[] = [];
    // Do not collapse positive and negative categories into a net amount: both may be important.
    for (const key of ['redistributedSurcharges', 'redistributedRebates', 'additionalSurcharges', 'additionalRebates'] as const) {
        if (Math.round(totals[key] * 100) !== 0) rows.push({key, label: invoiceText(key), amount: totals[key]});
    }
    return rows;
}

/** Select useful common financial columns while keeping the saved balance as the focal point. */
export function invoiceShareColumns(shares: readonly InvoiceCalculationShare[]): InvoiceFinancialColumn[] {
    // One component order and one label per concept govern PDF columns, preview cells, and personal details.
    const candidates: InvoiceFinancialColumn[] = [
        {key: 'baseShareAmount', label: invoiceLabels.base},
        {key: 'extraAmount', label: invoiceLabels.adjustments},
        {key: 'invoiceCreditAmount', label: invoiceLabels.invoiceCredit},
        {key: 'paymentCreditAmount', label: invoiceLabels.previous},
        {key: 'shareAmount', label: invoiceLabels.original},
    ];
    const columns: InvoiceFinancialColumn[] = [];
    // Omit unused components pool-wide, rather than printing a column of zeroes in every row.
    for (const column of candidates) {
        if (column.key === 'shareAmount' || shares.some(share => Math.round(Number(share[column.key] ?? 0) * 100) !== 0)) columns.push(column);
    }
    return columns;
}

/** Attribute frozen adjustments to a payer only when the result agrees with their saved component. */
function payerAdjustmentRows(share: InvoiceCalculationShare, explanation?: InvoiceCalculationExplanation,
    savedAdjustments?: readonly InvoiceAdjustmentInput[]): InvoiceFinancialComponent[] {
    if (!savedAdjustments || share.registrationId == null) return [];
    const beneficiaries = new Set<number>();
    // Saved takeover attribution is authoritative; current assignments must never rewrite old totals.
    if (explanation) {
        for (const contribution of explanation.contributions) {
            if (contribution.payerRegistrationId === share.registrationId) beneficiaries.add(contribution.registrationId);
        }
    } else {
        beneficiaries.add(share.registrationId);
    }
    const adjustments: InvoiceAdjustmentInput[] = [];
    for (const adjustment of savedAdjustments) {
        if (beneficiaries.has(adjustment.registrationId)) adjustments.push(adjustment);
    }
    // Older snapshots may lack takeover provenance. A mismatching net must remain an honest generic adjustment.
    const rows = invoiceAdjustmentRows(adjustments);
    const net = rows.reduce((sum, row) => sum + Math.round(row.amount * 100), 0);
    return net === Math.round(Number(share.extraAmount) * 100) ? rows : [];
}

/** Present each saved component once, expanding reliable adjustment modes only when applicable. */
export function invoiceShareComponents(share: InvoiceCalculationShare, explanation?: InvoiceCalculationExplanation,
    savedAdjustments?: readonly InvoiceAdjustmentInput[]): InvoiceFinancialComponent[] {
    const components: InvoiceFinancialComponent[] = [];
    const adjustmentRows = payerAdjustmentRows(share, explanation, savedAdjustments);
    // Preserve the established base/adjustment/credit order, including opposing signed adjustment sources.
    for (const column of invoiceShareColumns([share])) {
        if (column.key === 'extraAmount') {
            if (adjustmentRows.length) components.push(...adjustmentRows);
            else components.push({...column, amount: Number(share.extraAmount)});
        } else {
            components.push({...column, amount: Number(share[column.key] ?? 0)});
            if (column.key === 'baseShareAmount' && Number(share.extraAmount) === 0) components.push(...adjustmentRows);
        }
    }
    // A zero base and cancelling adjustments still need their two source amounts before the final balance.
    if (Number(share.baseShareAmount) === 0 && Number(share.extraAmount) === 0 && adjustmentRows.length) components.unshift(...adjustmentRows);
    return components;
}

/** Format one labeled formula term independently of its eventual HTML, email, or PDF layout. */
function moneyTerm(amount: number | string, label: string, operator?: InvoiceCalculationTerm['operator']): InvoiceCalculationTerm {
    return {value: formatInvoiceMoney(amount), label, ...(operator ? {operator} : {})};
}

/** Keep attendance and factor values readable without treating them as monetary amounts. */
function weightTerm(amount: number, label: string, operator?: InvoiceCalculationTerm['operator']): InvoiceCalculationTerm {
    return {value: String(amount), label, ...(operator ? {operator} : {})};
}

/** Resolve frozen cost categories once for both the figures overview and its separate arithmetic explanation. */
function calculationCostBasis(explanation: InvoiceCalculationExplanation, savedAdjustments?: readonly InvoiceAdjustmentInput[]) {
    // Only the calculation's own numeric provenance can establish gross categories or the full cost.
    // Current inputs and authored notes cannot fill gaps in an older snapshot.
    const totals = explanation.adjustmentTotals ?? (savedAdjustments ? sumInvoiceAdjustments(savedAdjustments) : undefined);
    const rows = invoiceAdjustmentRows(totals);
    const redistributed = rows.filter(row => row.key === 'redistributedSurcharges' || row.key === 'redistributedRebates');
    const additional = rows.filter(row => row.key === 'additionalSurcharges' || row.key === 'additionalRebates');
    // Both representations use the same cent-based full cost; direct rebates retain their negative sign.
    let fullCents = Math.round(explanation.invoiceAmount * 100);
    for (const row of additional) fullCents += Math.round(row.amount * 100);
    return {totals, rows, redistributed, additional, fullAmount: totals === undefined ? undefined : fullCents / 100};
}

/** Explain the frozen invoice basis and the distinct effects of the adjustment modes actually used. */
function calculationCostSections(explanation: InvoiceCalculationExplanation,
    savedAdjustments?: readonly InvoiceAdjustmentInput[], includeFullTotal = true): InvoiceCalculationSection[] {
    const {totals, redistributed, additional, fullAmount} = calculationCostBasis(explanation, savedAdjustments);
    // Explain cost and allocation as separate scopes. Ordinary invoice labels never change meaning
    // depending on which equation they appear in; the description explains any equality instead.
    // Older snapshots cannot certify that no direct on-top costs existed.
    const equalPoolTotal = includeFullTotal && totals !== undefined && !additional.length;
    const terms = [moneyTerm(explanation.invoiceAmount, invoiceLabels.invoiceCosts)];
    // Subtracting a signed rebate increases the base. Renderers retain the negative value and visible operator.
    for (const row of redistributed) terms.push(moneyTerm(row.amount, row.label, '−'));
    if (!totals && explanation.redistributedAmount !== 0) {
        terms.push(moneyTerm(explanation.redistributedAmount, invoiceLabels.redistributedAdjustments, '−'));
    }
    let redistributionExplanation: string | undefined;
    if (redistributed.length > 1) redistributionExplanation = invoiceText('redistributedExplanation');
    else if (redistributed.length) redistributionExplanation = invoiceText(redistributed[0].key === 'redistributedSurcharges'
        ? 'calculationRedistributedSurcharge' : 'calculationRedistributedRebate');
    else if (explanation.redistributedAmount !== 0) redistributionExplanation = invoiceText('calculationRedistributedLegacy');
    // First explain what is split, then why fixed attribution changes that shared amount.
    // A personal explanation needs this relationship without a separate full-pool cost lesson.
    let description = redistributionExplanation
        ? invoiceText('baseToDistributeExplanation', {redistributionExplanation})
        : invoiceText('personalBaseInvoiceCostsExplanation');
    if (equalPoolTotal) description = redistributionExplanation
        ? invoiceText('poolRedistributedCostsExplanation', {redistributionExplanation})
        : invoiceText('poolCostsEqualTotalExplanation');
    else if (includeFullTotal && totals === undefined) description = redistributionExplanation
        ? invoiceText('poolRedistributedUnknownTotalExplanation', {redistributionExplanation})
        : invoiceText('poolCostsUnknownTotalExplanation');
    else if (includeFullTotal && additional.length && !redistributionExplanation)
        description = invoiceText('baseOnlyInvoiceCostsExplanation');
    // Avoid an identity equation repeating the same amount. The explicit metric still names the
    // saved base; actual redistribution retains its complete signed arithmetic, including cancellation.
    const hasRedistribution = redistributed.length > 0 || explanation.redistributedAmount !== 0;
    const sections: InvoiceCalculationSection[] = [{
        key: 'costs', title: invoiceLabels.distributable, description,
        ...(hasRedistribution || totals === undefined
            ? {formula: {terms, result: {label: invoiceLabels.distributable, value: formatInvoiceMoney(explanation.distributableAmount)}}}
            : {metrics: [{label: equalPoolTotal ? invoiceLabels.invoiceCosts : invoiceLabels.distributable,
                value: formatInvoiceMoney(explanation.distributableAmount)}]}),
    }];
    // On-top adjustments are separate from redistribution; their equation explains the full pool total only.
    if (includeFullTotal && additional.length) {
        const fullTerms = [moneyTerm(explanation.invoiceAmount, invoiceLabels.invoiceCosts)];
        for (const row of additional) {
            fullTerms.push(moneyTerm(row.amount, row.label, '+'));
        }
        const descriptionKey = additional.length > 1 ? 'onTopExplanation'
            : additional[0].key === 'additionalSurcharges' ? 'calculationOnTopSurcharge' : 'calculationOnTopRebate';
        // Start with the whole cost before explaining the smaller (or rebate-adjusted larger) shared base.
        sections.unshift({key: 'on-top', title: invoiceText('fullTotal'), description: invoiceText(descriptionKey),
            formula: {terms: fullTerms, result: {label: invoiceText('fullTotal'), value: formatInvoiceMoney(fullAmount!)}}});
    }
    return sections;
}

/** List the relevant saved costs without interpreting them or inserting arithmetic into the overview. */
function calculationCostMetrics(explanation: InvoiceCalculationExplanation,
    savedAdjustments?: readonly InvoiceAdjustmentInput[]): InvoiceCalculationOverview['sections'][number] {
    const basis = calculationCostBasis(explanation, savedAdjustments);
    const metrics = [{label: invoiceLabels.invoiceCosts, value: formatInvoiceMoney(explanation.invoiceAmount)}];
    // Show used gross categories even when surcharges and rebates cancel. An unknown historic category
    // may expose its saved net value, but never guessed positive/negative or on-top amounts.
    for (const row of basis.rows) metrics.push({label: row.label, value: formatInvoiceMoney(row.amount)});
    if (basis.totals === undefined && explanation.redistributedAmount !== 0) metrics.push({
        label: invoiceLabels.redistributedAdjustments, value: formatInvoiceMoney(explanation.redistributedAmount),
    });
    // Ordinary pools need one cost amount. Adjustments make the shared base an important distinct scope,
    // and legacy snapshots keep the known base alongside an honest unavailable full-total marker.
    if (basis.rows.length || explanation.redistributedAmount !== 0 || basis.totals === undefined) {
        metrics.push({label: invoiceLabels.distributable, value: formatInvoiceMoney(explanation.distributableAmount)});
    }
    if (basis.additional.length || basis.totals === undefined) metrics.push({
        label: invoiceText('fullTotal'), value: basis.fullAmount === undefined ? invoiceText('unavailable') : formatInvoiceMoney(basis.fullAmount),
    });
    return {key: 'costs', title: invoiceText('poolCosts'), metrics};
}

/** List pool-wide calculation numbers, with no prose or formulas; examples explain their relationships separately. */
export function invoicePoolCalculationBreakdown(explanation?: InvoiceCalculationExplanation,
    savedAdjustments?: readonly InvoiceAdjustmentInput[]): InvoiceCalculationOverview {
    // All global views use frozen distribution facts, even when no personal example applies.
    // Personal breakdowns keep their own self-contained basis rather than acquiring another overview.
    const display: InvoiceCalculationOverview = {title: invoiceText('calculationBreakdown'), sections: []};
    if (explanation) {
        display.sections.push(calculationCostMetrics(explanation, savedAdjustments), calculationDistributionMetrics(explanation));
    }
    else display.sections.push({key: 'legacy', title: invoiceLabels.baseCalculation,
        metrics: [{label: invoiceText('savedCalculationInputs'), value: invoiceText('notSaved')}]});
    return display;
}

/** Identify whether saved nonexempt factors affect this pool's distribution. */
function calculationUsesFactors(explanation: InvoiceCalculationExplanation): boolean {
    return explanation.contributions.some(contribution => !contribution.isExempt && contribution.factor !== 1);
}

/** List shared counts and weights independently of the explanation of how those numbers are used. */
function calculationDistributionMetrics(explanation: InvoiceCalculationExplanation): InvoiceCalculationOverview['sections'][number] {
    const equal = explanation.distributionMethod === 'EQUAL';
    const nights = explanation.distributionMethod === 'NIGHTS';
    const hasFactors = calculationUsesFactors(explanation);
    const metrics = [{label: invoiceText('participants'), value: String(explanation.assignedParticipants)}];
    // Participant counts matter even for attendance-based invoices; equal mode already uses that count as its units.
    if (!equal) metrics.push({label: invoiceText(nights ? 'totalNightsLabel' : 'totalDaysLabel'), value: String(explanation.attendanceUnits)});
    if (explanation.attendanceUnits !== explanation.eligibleAttendanceUnits) metrics.push({
        label: invoiceText(equal ? 'eligibleParticipants' : nights ? 'eligibleNights' : 'eligibleDays'),
        value: String(explanation.eligibleAttendanceUnits),
    });
    if (explanation.exemptParticipants) metrics.push({label: invoiceText('exemptParticipantsLabel'), value: String(explanation.exemptParticipants)});
    // A factor-weighted divisor differs from plain attendance; its calculation rule belongs in the example.
    if (hasFactors) metrics.push({label: invoiceText('totalWeightLabel'), value: String(explanation.effectiveWeight)});
    return {key: 'attendance', title: invoiceText('distributionMetrics'), metrics};
}

/** Explain only the weighting rule actually used by these saved participant contributions. */
function calculationWeightExplanation(explanation: InvoiceCalculationExplanation): string | undefined {
    if (!calculationUsesFactors(explanation)) return undefined;
    return invoiceText(explanation.distributionMethod === 'EQUAL' ? 'equalWeightExplanation'
        : explanation.distributionMethod === 'NIGHTS' ? 'nightsWeightExplanation' : 'daysWeightExplanation');
}

/** Keep personal explanations self-contained by combining shared numbers with their applicable weighting rule. */
function calculationAttendanceSection(explanation: InvoiceCalculationExplanation): InvoiceCalculationSection {
    const section = calculationDistributionMetrics(explanation);
    const description = calculationWeightExplanation(explanation);
    return {...section, ...(description ? {description} : {})};
}

/** Explain one saved participant contribution, preserving exemptions and the allocator's actual rounding. */
function calculationContributionSection(explanation: InvoiceCalculationExplanation,
    contribution: InvoiceCalculationExplanation['contributions'][number], name: string): InvoiceCalculationSection {
    const title = invoiceText('baseShareHeading', {name});
    // An exemption explicitly bypasses automatic allocation; fixed adjustments and credits are explained later.
    if (contribution.isExempt) return {
        key: `base-${contribution.registrationId}`, title,
        description: invoiceText('exemptBaseExplanation'),
        metrics: [{label: invoiceLabels.base, value: formatInvoiceMoney(contribution.baseShareAmount)}],
    };
    const equal = explanation.distributionMethod === 'EQUAL';
    const nights = explanation.distributionMethod === 'NIGHTS';
    const hasFactors = calculationUsesFactors(explanation);
    // A valid zero factor or no attendance must remain traceable from its actual saved inputs.
    // Explain the zero numerator without inventing a division when the entire eligible divisor is zero.
    if (contribution.effectiveWeight <= 0 || explanation.effectiveWeight <= 0) {
        const metrics = [];
        if (!equal) metrics.push({label: invoiceText(nights ? 'nightsStayed' : 'daysAttended'), value: String(contribution.attendanceWeight)});
        if (hasFactors) metrics.push({label: invoiceText('shareFactor'), value: String(contribution.factor)});
        metrics.push({label: invoiceText('allocationWeight'), value: String(contribution.effectiveWeight)},
            {label: invoiceLabels.base, value: formatInvoiceMoney(contribution.baseShareAmount)});
        return {key: `base-${contribution.registrationId}`, title, description: invoiceText('zeroAttendanceBase'), metrics};
    }
    const terms = [moneyTerm(explanation.distributableAmount, invoiceLabels.distributable)];
    // Every multiplier and divisor is named. Default factors are omitted only when the entire pool is unweighted.
    if (!equal) terms.push(weightTerm(contribution.attendanceWeight, invoiceText(nights ? 'nightsStayed' : 'daysAttended'), '×'));
    if (hasFactors) terms.push(weightTerm(contribution.factor, invoiceText('shareFactor'), '×'));
    terms.push(weightTerm(explanation.effectiveWeight,
        invoiceText(hasFactors ? 'totalWeightLabel' : equal ? 'eligibleParticipants' : nights ? 'eligibleNights' : 'eligibleDays'), '÷'));
    return {key: `base-${contribution.registrationId}`, title,
        formula: {terms, result: {label: invoiceLabels.base, value: formatInvoiceMoney(contribution.baseShareAmount)},
            note: invoiceText(explanation.roundUpShares ? 'roundingUp' : 'roundingDown')}};
}

/** Resolve this payer's saved label without borrowing a different payer's identity or contribution. */
function calculationPayerName(explanation: InvoiceCalculationExplanation | undefined, share: InvoiceCalculationShare): string {
    if (share.name || share.payerName) return share.name || share.payerName!;
    // A covered contribution is not the payer's identity; use only an actual matching own registration.
    const own = explanation?.contributions.find(contribution => contribution.registrationId === share.registrationId);
    return own?.name || invoiceLabels.payer;
}

/** Introduce the saved beneficiaries before explaining any of their individual base shares. */
function calculationCoverageSummary(contributions: InvoiceCalculationExplanation['contributions'],
    explanation: InvoiceCalculationExplanation, share: InvoiceCalculationShare): InvoiceCalculationSection | undefined {
    const beneficiaries: string[] = [];
    // The payer's own contribution is not a beneficiary. Keep saved names and coverage, including exempt or zero bases.
    for (const contribution of contributions) {
        if (contribution.registrationId !== share.registrationId) beneficiaries.push(contribution.name);
    }
    if (!beneficiaries.length) return undefined;
    // Announce the actual count and names together; current membership edits must not rewrite this saved explanation.
    return {key: 'coverage-summary', title: invoiceText('participantsCoveredBy', {name: calculationPayerName(explanation, share)}),
        description: invoiceText('otherParticipantsCovered', {count: beneficiaries.length}), items: beneficiaries};
}

/** Explain the sum of already-rounded covered bases before applying the payer's fixed components. */
function calculationCoverageSection(contributions: InvoiceCalculationExplanation['contributions'],
    share: InvoiceCalculationShare, anonymized: boolean): InvoiceCalculationSection {
    // A pool example teaches one calculation, rather than expanding a large covering payer's entire roster.
    // Personal explanations still retain every actual contribution and the complete sum.
    if (anonymized && contributions.length > 3) return {key: 'coverage', title: invoiceText('combinedBaseShares'),
        description: invoiceText('combinedBaseExplanation', {count: contributions.length}),
        metrics: [{label: invoiceLabels.base, value: formatInvoiceMoney(share.baseShareAmount)}]};
    const terms: InvoiceCalculationTerm[] = [];
    // Payer coverage combines saved beneficiary results. It must not allocate or round the combined base again.
    for (let index = 0; index < contributions.length; index++) {
        const name = anonymized ? index ? invoiceText('exampleCoveredParticipant', {count: index + 1})
            : invoiceText('exampleParticipant') : contributions[index].name;
        terms.push(moneyTerm(contributions[index].baseShareAmount, invoiceText('baseShareHeading', {name}), index ? '+' : undefined));
    }
    return {key: 'coverage', title: invoiceText('combinedBaseShares'),
        formula: {terms, result: {label: invoiceLabels.base, value: formatInvoiceMoney(share.baseShareAmount)}}};
}

/** Show how the saved base, fixed adjustments, invoice credits, and past settlements form the balance. */
function calculationBalanceSection(explanation: InvoiceCalculationExplanation | undefined,
    share: InvoiceCalculationShare, savedAdjustments: readonly InvoiceAdjustmentInput[] | undefined, name: string): InvoiceCalculationSection {
    const terms: InvoiceCalculationTerm[] = [];
    // The component presenter preserves gross cancelling adjustments and chooses an honest net fallback for old snapshots.
    for (const component of invoiceShareComponents(share, explanation, savedAdjustments)) {
        if (component.key === 'shareAmount') continue;
        const subtract = component.key === 'invoiceCreditAmount' || component.key === 'paymentCreditAmount';
        terms.push(moneyTerm(component.amount, component.label, subtract ? '−' : terms.length ? '+' : undefined));
    }
    // A credit-only former payer has no current base contribution; its signed carried credit still explains the saved balance.
    const result = {label: invoiceLabels.original, value: formatInvoiceMoney(share.shareAmount)};
    return {key: 'balance', title: invoiceText('balanceForPayer', {name}),
        ...(terms.length ? {formula: {terms, result}} : {metrics: [result]})};
}

/** Count actual explanatory features without enriching a saved payer with current or unrelated inputs. */
function calculationExampleFeatureCount(explanation: InvoiceCalculationExplanation,
    contribution: InvoiceCalculationExplanation['contributions'][number], share: InvoiceCalculationShare,
    savedAdjustments?: readonly InvoiceAdjustmentInput[]): number {
    let features = contribution.factor !== 1 ? 1 : 0;
    // Reuse the financial component projection so cancelling source categories and historical fallbacks
    // count exactly as they will appear in the example, rather than duplicating attribution rules here.
    for (const component of invoiceShareComponents(share, explanation, savedAdjustments)) {
        if (component.key !== 'baseShareAmount' && component.key !== 'shareAmount') features++;
    }
    return features;
}

/** Order saved contributions numerically, independent of input order, names, or the current viewer. */
function compareCalculationContributions(first: InvoiceCalculationExplanation['contributions'][number],
    second: InvoiceCalculationExplanation['contributions'][number]): number {
    return first.registrationId - second.registrationId;
}

/** Choose an ordinary positive payer, preferring a useful own redistributed surcharge within that eligible group. */
function calculationExample(explanation: InvoiceCalculationExplanation, shares: readonly InvoiceCalculationShare[],
    savedAdjustments?: readonly InvoiceAdjustmentInput[]) {
    let selected: {share: InvoiceCalculationShare; contribution: InvoiceCalculationExplanation['contributions'][number];
        contributions: InvoiceCalculationExplanation['contributions']; beneficiaryCount: number; features: number;
        ownRedistributedSurcharge: boolean} | undefined;
    // Only supplied payer rows authorize an example. A covered participant, exempt participant, refund,
    // or zero balance must never become the apparent ordinary payment example just because it comes first.
    for (const share of shares) {
        if (share.registrationId == null || Math.round(Number(share.shareAmount) * 100) <= 0) continue;
        const own = explanation.contributions.find(contribution => contribution.registrationId === share.registrationId
            && contribution.payerRegistrationId === share.registrationId && !contribution.isExempt);
        if (!own) continue;
        const contributions = explanation.contributions.filter(contribution => contribution.payerRegistrationId === share.registrationId)
            .sort(compareCalculationContributions);
        const beneficiaryCount = contributions.length - 1;
        const features = calculationExampleFeatureCount(explanation, own, share, savedAdjustments);
        // A participant's own redistributed surcharge demonstrates both the shared-base deduction
        // and the later fixed addition. Do not borrow a beneficiary's adjustment to prefer that payer.
        const ownRedistributedSurcharge = Boolean(savedAdjustments?.some(adjustment => adjustment.registrationId === own.registrationId
            && adjustment.subtractFromPool && Number(adjustment.amount) > 0))
            && payerAdjustmentRows(share, explanation, savedAdjustments).some(row => row.key === 'redistributedSurcharges');
        // Standalone payers teach the usual calculation without introducing somebody else's liability.
        // Within each coverage group, prefer positive base weight, then an own redistributed surcharge,
        // then the most used features. This order keeps the surcharge preference within existing eligibility.
        if (selected) {
            if (Boolean(beneficiaryCount) !== Boolean(selected.beneficiaryCount)) {
                if (beneficiaryCount) continue;
            } else if ((own.effectiveWeight > 0) !== (selected.contribution.effectiveWeight > 0)) {
                if (own.effectiveWeight <= 0) continue;
            } else if (ownRedistributedSurcharge !== selected.ownRedistributedSurcharge) {
                if (!ownRedistributedSurcharge) continue;
            } else if (features !== selected.features) {
                if (features < selected.features) continue;
            } else if (own.registrationId >= selected.contribution.registrationId) continue;
        }
        // The final numeric registration tie-break is stable across renderer ordering and profile changes.
        selected = {share, contribution: own, contributions, beneficiaryCount, features, ownRedistributedSurcharge};
    }
    return selected;
}

/** Explain the pool's total/base arithmetic, followed by a typical anonymous payer when one qualifies. */
export function invoicePoolCalculation(explanation?: InvoiceCalculationExplanation,
    shares: readonly InvoiceCalculationShare[] = [], savedAdjustments?: readonly InvoiceAdjustmentInput[]): InvoiceCalculationDisplay {
    const display: InvoiceCalculationDisplay = {title: invoiceText('poolCalculationExample'),
        description: invoiceText('poolCalculationCostExampleCaption'), sections: []};
    // A numbers-only overview cannot explain relationships. Keep every pool cost equation and explanatory
    // paragraph in this optional example, using the same frozen basis as the overview and personal explanation.
    if (!explanation) return display;
    display.sections.push(...calculationCostSections(explanation, savedAdjustments));
    const weighting = calculationWeightExplanation(explanation);
    if (weighting) display.sections.push({key: 'distribution-rule', title: invoiceText('distributionMetrics'), description: weighting});
    if (explanation.effectiveWeight === 0) display.sections.push({key: 'zero-weight', title: invoiceLabels.base,
        description: invoiceText('calculationZeroBaseWeight')});
    const example = calculationExample(explanation, shares, savedAdjustments);
    if (!example) {
        // Real pool totals can still be explained without inventing a positive, nonexempt example payer.
        return display;
    }
    const {share, contribution, contributions, beneficiaryCount} = example;
    // Introduce the real number of other beneficiaries before any formula when coverage is unavoidable.
    display.description = beneficiaryCount ? invoiceText('poolCalculationCoveringExampleCaption', {count: beneficiaryCount})
        : invoiceText('poolCalculationExampleCaption');
    display.sections.push(calculationContributionSection(explanation, contribution, invoiceText('exampleParticipant')));
    if (beneficiaryCount) {
        // Participant A is always the selected payer's own contribution; anonymous covered aliases stay stable.
        const exampleFirst = [contribution, ...contributions.filter(row => row !== contribution)];
        display.sections.push(calculationCoverageSection(exampleFirst, share, true));
    }
    const balance = calculationBalanceSection(explanation, share, savedAdjustments,
        invoiceText(beneficiaryCount ? 'examplePayer' : 'exampleParticipant'));
    const baseOnly = balance.formula?.terms.every(term => term.label === invoiceLabels.base);
    if (!baseOnly) display.sections.push(balance);
    return display;
}

/** Explain all actual own and covered contributions for one payer, independently of their saved audit notes. */
export function invoicePayerCalculation(explanation: InvoiceCalculationExplanation | undefined,
    share: InvoiceCalculationShare, savedAdjustments?: readonly InvoiceAdjustmentInput[]): InvoiceCalculationDisplay {
    const display: InvoiceCalculationDisplay = {title: invoiceText('payerCalculation'), sections: []};
    if (!explanation) {
        // Legacy amounts can be related to each other, but missing numeric attendance evidence must stay explicit.
        display.sections.push({key: 'legacy', title: invoiceLabels.baseCalculation,
            description: invoiceText('theBaseCalculationInputsWereNotSavedForThis')});
    } else {
        const contributions = explanation.contributions.filter(contribution => contribution.payerRegistrationId === share.registrationId);
        // Exempt and zero-weight people need their exception and fixed balance, rather than an unrelated
        // divisor. A retained former payer with no own/covered contribution needs only their actual credits.
        // Keep the shared basis when this payer covers anyone with a positive automatic contribution.
        const hasAutomaticContribution = contributions.some(contribution => !contribution.isExempt && contribution.effectiveWeight > 0);
        if (hasAutomaticContribution) {
            // A personal calculation needs the shared base equation, not another payer's global on-top total.
            // This payer's applicable on-top components remain in their actual balance equation below.
            display.sections.push(...calculationCostSections(explanation, savedAdjustments, false), calculationAttendanceSection(explanation));
        }
        // Introduce coverage before any individual calculation so each additional person's role is already clear.
        const coverage = calculationCoverageSummary(contributions, explanation, share);
        if (coverage) display.sections.push(coverage);
        // Each covered person keeps their saved name, attendance, factor, exemption, and separately rounded base share.
        for (const contribution of contributions) display.sections.push(calculationContributionSection(explanation, contribution, contribution.name));
        if (contributions.length > 1) display.sections.push(calculationCoverageSection(contributions, share, false));
    }
    // Always explain the personal final balance, including zero and credit-only former payers, without substituting an example.
    const balance = calculationBalanceSection(explanation, share, savedAdjustments, calculationPayerName(explanation, share));
    const onTop = payerAdjustmentRows(share, explanation, savedAdjustments)
        .filter(row => row.key === 'additionalSurcharges' || row.key === 'additionalRebates');
    // Explain only on-top modes attributable to this saved payer, without exposing unrelated global amounts.
    if (onTop.length) balance.description = invoiceText(onTop.length > 1 ? 'payerOnTopAdjustmentsExplanation'
        : onTop[0].key === 'additionalSurcharges' ? 'payerOnTopSurchargeExplanation' : 'payerOnTopRebateExplanation');
    display.sections.push(balance);
    return display;
}

/** Provide a text representation for compatibility consumers without duplicating calculation rules. */
export function invoiceFormulaText(formula: InvoiceCalculationFormula): string {
    let calculation = '';
    // Group negative values in mathematical notation; refund values themselves remain negative everywhere.
    for (const term of formula.terms) {
        const amount = term.value.startsWith('-') ? `(${term.value})` : term.value;
        const value = invoiceText('calculationComponent', {amount, label: term.label});
        calculation += `${term.operator ? `${calculation ? ' ' : ''}${term.operator} ` : ''}${value}`;
    }
    return `${calculation} = ${invoiceText('calculationComponent', {amount: formula.result.value, label: formula.result.label})}`;
}

/** Keep the existing plain-text API field as a compatibility adapter; rich views consume the structured display. */
export function invoiceCalculationLines(explanation?: InvoiceCalculationExplanation,
    shares: readonly InvoiceCalculationShare[] = [], savedAdjustments?: readonly InvoiceAdjustmentInput[]): string[] {
    // The compatibility field retains the complete pool basis even though rich renderers display
    // static facts and the optional example separately. Neither projection derives new numbers here.
    const displays: InvoiceCalculationDisplay[] = [invoicePoolCalculationBreakdown(explanation, savedAdjustments)];
    const example = invoicePoolCalculation(explanation, shares, savedAdjustments);
    if (example.sections.length) displays.push(example);
    const lines: string[] = [];
    // Format each named section in order, preserving actual metrics, signed formulas, and saved rounding notes.
    for (const display of displays) {
        lines.push(display.title);
        if (display.description) lines.push(display.description);
        for (const section of display.sections) {
            lines.push(section.title);
            if (section.description) lines.push(section.description);
            for (const item of section.items || []) lines.push(item);
            for (const metric of section.metrics || []) lines.push(invoiceText('labeledValue', {label: metric.label, value: metric.value}));
            if (section.formula) {
                lines.push(invoiceFormulaText(section.formula));
                if (section.formula.note) lines.push(section.formula.note);
            }
        }
    }
    return lines;
}

/** Summarize saved liabilities, credits, and recorded transfers without claiming a gross historical transaction ledger. */
export function invoiceSettlementRows(shares: readonly InvoiceCalculationShare[]): InvoiceMoneyMetric[] {
    if (!shares.length) return [];
    let due = 0, refund = 0, received = 0, refunded = 0, invoiceCredits = 0, previous = 0;
    let hasPrevious = false;
    // Only paid balances are recorded transfers in this calculation; carried credits are separate, signed net history.
    for (const share of shares) {
        const balance = Math.round(Number(share.shareAmount) * 100);
        const paid = share.isPaid === true || share.isPaid === 1;
        if (paid) {
            received += Math.max(balance, 0);
            refunded += Math.min(balance, 0);
        } else {
            due += Math.max(balance, 0);
            refund += Math.min(balance, 0);
        }
        invoiceCredits += Math.round(Number(share.invoiceCreditAmount) * 100);
        const credit = Math.round(Number(share.paymentCreditAmount ?? 0) * 100);
        previous += credit;
        hasPrevious ||= credit !== 0;
    }
    const rows: InvoiceMoneyMetric[] = [
        {key: 'outstandingAmount', label: invoiceLabels.paymentsDue, amount: due / 100},
        {key: 'creditAmount', label: invoiceLabels.refundsDue, amount: refund / 100},
    ];
    // Keep applicable credits even when opposite prior payments/refunds net to zero across a large roster.
    if (invoiceCredits) rows.push({key: 'invoiceCreditAmount', label: invoiceLabels.invoiceCredit, amount: invoiceCredits / 100});
    if (hasPrevious) rows.push({key: 'paymentCreditAmount', label: invoiceLabels.previous, amount: previous / 100});
    if (received) rows.push({key: 'paymentsReceived', label: invoiceText('paymentsReceived'), amount: received / 100});
    if (refunded) rows.push({key: 'refundsPaid', label: invoiceText('refundsPaid'), amount: refunded / 100});
    return rows;
}

/** Restore useful pool context while keeping current costs separate from the saved settlement's financial evidence. */
export function invoicePoolSummary(pool: InvoicePoolSummaryInput): InvoicePoolSummary {
    const shares = pool.shares || [];
    const sourceRows = invoiceAdjustmentRows(pool.surcharges || []);
    const redistributedUsed = sourceRows.some(row => row.key === 'redistributedSurcharges' || row.key === 'redistributedRebates')
        || Number(pool.surchargeOffsetAmount || 0) !== 0;
    const additionalUsed = sourceRows.some(row => row.key === 'additionalSurcharges' || row.key === 'additionalRebates')
        || Number(pool.additionalAmount || 0) !== 0;
    const primary: InvoiceMoneyMetric[] = [{key: 'totalAmount', label: invoiceText('fullTotal'), amount: Number(pool.totalAmount || 0)}];
    const details: InvoiceMoneyMetric[] = [];
    const saved: InvoiceMoneyMetric[] = [];
    // Fresh saved equations already name each cost category once. Retain a separate current-source list
    // only for open, stale, or legacy pools whose saved cost categories are unavailable.
    const snapshot = pool.calculationSnapshot;
    const hasSavedCostBasis = !!snapshot?.explanation && (snapshot.explanation.adjustmentTotals !== undefined
        || Array.isArray(snapshot.surcharges));
    const showCurrentSources = pool.status !== 'CLOSED' || !!pool.needsRecalculation || !hasSavedCostBasis;
    // Redistributed inputs make the base a distinct concept, even when gross positive and negative amounts cancel.
    if (redistributedUsed) primary.push({key: 'payableAmount', label: invoiceLabels.distributable, amount: Number(pool.payableAmount ?? pool.invoiceAmount ?? 0)});
    if (showCurrentSources) {
        if (redistributedUsed || additionalUsed) details.push({key: 'invoiceAmount', label: invoiceLabels.invoiceCosts, amount: Number(pool.invoiceAmount || 0)});
        details.push(...sourceRows);
    }
    // Accepted-but-not-closed invoice costs describe review workflow, never NEW invoices awaiting approval.
    if (Number(pool.openAmount || 0) !== 0) details.push({key: 'openAmount', label: invoiceText('acceptedInvoiceCosts'), amount: Number(pool.openAmount)});
    if (pool.status === 'CLOSED' && shares.length) {
        for (const row of invoiceSettlementRows(shares)) {
            if (row.key === 'outstandingAmount' || row.key === 'creditAmount') {
                // Persisted aggregates stay authoritative for live settlement updates; saved rows provide a reliable fixture fallback.
                const persisted = row.key === 'outstandingAmount' ? pool.outstandingAmount : pool.creditAmount;
                primary.push({...row, amount: persisted == null ? row.amount : row.key === 'creditAmount' ? -Number(persisted) : Number(persisted)});
            } else saved.push(row);
        }
        // Rounding differences are meaningful only against the saved base, not subsequently edited source costs.
        const explanation = pool.calculationSnapshot?.explanation;
        if (explanation) {
            let allocatedCents = 0;
            for (const share of shares) allocatedCents += Math.round(Number(share.baseShareAmount) * 100);
            const difference = allocatedCents - Math.round(explanation.distributableAmount * 100);
            if (difference) saved.push({key: 'roundingDifference', label: invoiceText('roundingDifference2'), amount: difference / 100});
        }
    }
    return {primary, details, saved};
}

// Passed explicitly through the renderer's data object and Pug mixin arguments. Nothing here mutates
// a pool or reconstructs an old calculation from current registrations, invoices, or takeovers.
export const invoicePresentation = {
    labels: invoiceLabels,
    text: invoiceText,
    money: formatInvoiceMoney,
    share: presentInvoiceShare,
    isOrganizerInvoice,
    balanceCaption: invoiceBalanceCaption,
    settledShareNotice: invoiceSettledShareNotice,
    calculationLines: invoiceCalculationLines,
    calculation: invoicePoolCalculation,
    poolBreakdown: invoicePoolCalculationBreakdown,
    payerCalculation: invoicePayerCalculation,
    appliedTakeovers: invoiceAppliedTakeovers,
    hasPendingTakeovers: invoiceHasPendingTakeovers,
    hasAppliedTakeoverEvidence: invoiceHasAppliedTakeoverEvidence,
    poolSummary: invoicePoolSummary,
    components: invoiceShareComponents,
    columns: invoiceShareColumns,
    adjustmentRows: invoiceAdjustmentRows,
    /** Project the legacy refund magnitude once into the signed display convention. */
    refundTotal(amount: number): number { return -Number(amount || 0); },
};
