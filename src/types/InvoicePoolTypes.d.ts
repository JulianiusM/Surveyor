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

import {InvoicePoolDistributions} from "../modules/database/entities/event/EventInvoicePool";
import type {EventInvoiceShare} from "../modules/database/entities/event/EventInvoiceShare";
import type {Event} from '../modules/database/entities/event/Event';
import type {EventInvoicePool} from '../modules/database/entities/event/EventInvoicePool';

export type InvoicePoolStatus = 'OPEN' | 'ORGANIZER_ONLY' | 'CLOSED';

/** Pools may start with organizer invoices alone or participant submissions; either state can close directly. */
export type InvoicePoolSubmissionState = Exclude<InvoicePoolStatus, 'CLOSED'>;

export type InvoicePoolDistribution = (typeof InvoicePoolDistributions)[number];

export interface InvoicePoolCalculationSnapshot {
    version: 1;
    settings: {
        distributionMethod: InvoicePoolDistribution;
        description: string | null;
        isDefault: boolean;
        assignAll: boolean;
        subtractPersonalInvoices: boolean;
        sendCalculationEmails: boolean;
        // Older snapshots predate configurable rounding and cannot certify the new calculation.
        roundUpShares?: boolean;
    };
    assignments: {registrationId: number; isExempt: boolean; factor: number}[];
    surcharges: {registrationId: number; amount: number; note: string; subtractFromPool: boolean}[];
    takeovers: InvoiceAppliedTakeover[];
    externalFingerprint: string;
    externalRegistrationIds: number[];
    // Numeric provenance belongs to the saved calculation, never to subsequently edited inputs.
    // Optional for installations whose existing calculations predate explainable base shares.
    explanation?: InvoiceCalculationExplanation;
    // Identify actual payers whose signed carried settlement is nonzero in this saved calculation.
    // Recalculation clears consumed credits and their IDs; no gross historical transfer amounts are inferred.
    settledRegistrationIds?: number[];
}

/** Applied coverage uses saved registration pairs rather than mutable database takeover row identifiers. */
export interface InvoiceAppliedTakeover {
    payerRegistrationId: number;
    beneficiaryRegistrationId: number;
}

/** Closed views select saved coverage; uncalculated views retain their current planning inputs. */
export interface InvoiceAppliedTakeoversInput {
    status?: string;
    takeovers?: readonly InvoiceAppliedTakeover[];
    calculationSnapshot?: {takeovers?: readonly InvoiceAppliedTakeover[]; explanation?: InvoiceCalculationExplanation;
        assignments?: readonly {registrationId: number; isExempt: boolean}[]; settledRegistrationIds?: readonly number[]} | null;
}

/** A payer with a nonzero carried settlement has restricted responsibility only from their frozen calculation. */
export interface InvoiceSettledShareImpact {
    registrationId: number;
    reason: 'exempt' | 'covered';
    payerRegistrationId?: number;
}

/** Compact state and its full explanation are formatted once for views, emails, and exports. */
export interface InvoiceSettledShareNoticePresentation {label: string; description: string}

export type InvoiceBalanceAudience = 'organizer' | 'participant';

/** Coverage notifications describe applied registration pairs without exposing database takeover identifiers. */
export interface InvoiceTakeoverChange {
    payerId: number;
    beneficiaryId: number;
}

export interface InvoiceTakeoverChanges {
    added: InvoiceTakeoverChange[];
    removed: InvoiceTakeoverChange[];
}

/** Closed-pool edits stage inputs; their locked result decides whether recipients may be notified immediately. */
export interface InvoiceTakeoverSaveResult extends InvoiceTakeoverChanges {
    applied: boolean;
}

/** The calculation transaction returns the actual applied delta only after shares and snapshot commit together. */
export interface InvoicePoolCalculationCommit {
    shares: EventInvoiceShare[];
    takeoverChanges: InvoiceTakeoverChanges;
    settledShareImpacts: InvoiceSettledShareImpact[];
    calculationSnapshot: InvoicePoolCalculationSnapshot;
}

/** Explicit responsibility notices select affected payers; optional bulk notices exclude those same recipients. */
export interface InvoiceSettlementNotificationSelection {
    registrationIds?: readonly number[];
    excludedRegistrationIds?: readonly number[];
}

export interface InvoiceCorrections {
    correctedAmount?: number | null;
    correctedDescription?: string | null;
}

export interface ConfirmedInvoiceChange {
    confirmed: boolean;
    expectedRevision: number;
}

export interface InvoiceRevision {
    correctedAmount: number | null;
    correctedDescription: string | null;
}

export interface InvoiceSharePayload {
    registrationId: number;
    baseShareAmount: number;
    extraAmount: number;
    invoiceCreditAmount: number;
    shareAmount: number;
    note?: string | null;
}

export interface ProjectedInvoiceShare extends InvoiceSharePayload {
    paymentCreditAmount: number;
    isPaid: boolean;
    paidAt: Date | null;
}

export type PreviousInvoiceShare = Pick<EventInvoiceShare, 'registrationId' | 'shareAmount' | 'isPaid'>
    & Partial<Pick<EventInvoiceShare, 'paymentCreditAmount' | 'paidAt'>>;

/** The same exact integer ratios drive rounding and its explanation; BigInts serialize as strings. */
export interface InvoiceDistributionResult {
    amounts: Map<number, number>;
    totalWeight: string;
    weights: Map<number, string>;
}

export interface InvoiceBaseContribution {
    registrationId: number;
    payerRegistrationId: number;
    name: string;
    attendanceWeight: number;
    factor: number;
    isExempt: boolean;
    effectiveWeight: number;
    weightNumerator: string;
    baseShareAmount: number;
}

/** Signed source categories remain distinct even when surcharges and rebates cancel out. */
export interface InvoiceAdjustmentTotals {
    redistributedSurcharges: number;
    redistributedRebates: number;
    additionalSurcharges: number;
    additionalRebates: number;
}

/** Numeric adjustment provenance; saved views receive snapshot inputs, never editable adjustments. */
export interface InvoiceAdjustmentInput {
    registrationId: number;
    amount: number | string;
    subtractFromPool: boolean;
}

export type InvoiceFinancialKey = 'baseShareAmount' | 'extraAmount' | 'invoiceCreditAmount' | 'paymentCreditAmount' | 'shareAmount';
export interface InvoiceFinancialColumn {key: InvoiceFinancialKey; label: string}
export interface InvoiceFinancialComponent {
    key: InvoiceFinancialKey | keyof InvoiceAdjustmentTotals;
    label: string;
    amount: number;
}

/** The presenter accepts persisted numeric shares and the existing decimal-string preview contract. */
export interface InvoiceCalculationShare {
    registrationId?: number;
    name?: string;
    payerName?: string;
    isPaid?: boolean | number;
    baseShareAmount: number | string;
    extraAmount: number | string;
    invoiceCreditAmount: number | string;
    paymentCreditAmount?: number | string;
    shareAmount: number | string;
}

/** Plain presentation values keep formula rendering consistent without embedding HTML or PDF details. */
export interface InvoiceCalculationMetric {label: string; value: string}
export interface InvoiceCalculationTerm extends InvoiceCalculationMetric {
    operator?: '+' | '−' | '×' | '÷';
}
export interface InvoiceCalculationFormula {
    terms: InvoiceCalculationTerm[];
    result: InvoiceCalculationMetric;
    note?: string;
}
export interface InvoiceCalculationSection {
    key: string;
    title: string;
    description?: string;
    items?: string[];
    metrics?: InvoiceCalculationMetric[];
    formula?: InvoiceCalculationFormula;
}
export interface InvoiceCalculationDisplay {
    title: string;
    description?: string;
    sections: InvoiceCalculationSection[];
}
/** A factual overview lists the saved inputs and results; explanations and equations belong to the example. */
export interface InvoiceCalculationOverview {
    title: string;
    sections: Array<Pick<InvoiceCalculationSection, 'key' | 'title'> & {metrics: InvoiceCalculationMetric[]}>;
}
export interface InvoiceMoneyMetric {key: string; label: string; amount: number}
export interface InvoicePoolSummary {
    primary: InvoiceMoneyMetric[];
    details: InvoiceMoneyMetric[];
    saved: InvoiceMoneyMetric[];
}
/** Current-source amounts and saved shares are deliberately separate presentation inputs. */
export interface InvoicePoolSummaryInput {
    status?: string;
    needsRecalculation?: boolean;
    totalAmount?: number | string;
    invoiceAmount?: number | string;
    payableAmount?: number | string;
    openAmount?: number | string;
    outstandingAmount?: number | string;
    creditAmount?: number | string;
    additionalAmount?: number | string;
    surchargeOffsetAmount?: number | string;
    surcharges?: readonly InvoiceAdjustmentInput[];
    shares?: readonly InvoiceCalculationShare[];
    calculationSnapshot?: {explanation?: InvoiceCalculationExplanation; surcharges?: readonly InvoiceAdjustmentInput[]} | null;
}

/** One selected personal row is rendered lazily in the existing shared breakdown dialog. */
export interface InvoiceShareBreakdownData {
    components: InvoiceFinancialComponent[];
    calculation: InvoiceCalculationDisplay;
    notes: string[];
    statusLabel: string;
    needsRecalculation?: boolean;
    settledShareNotice?: InvoiceSettledShareNoticePresentation | null;
}

/** Minimal numeric evidence: no receipt contents, proof paths, or additional attendance dates. */
export interface InvoiceCalculationExplanation {
    version: 1;
    distributionMethod: InvoicePoolDistribution;
    roundUpShares: boolean;
    invoiceAmount: number;
    redistributedAmount: number;
    distributableAmount: number;
    assignedParticipants: number;
    exemptParticipants: number;
    attendanceUnits: number;
    eligibleAttendanceUnits: number;
    effectiveWeight: number;
    weightDenominator: string;
    contributions: InvoiceBaseContribution[];
    // Optional for older saved explanations. The frozen snapshot's adjustments are their fallback.
    adjustmentTotals?: InvoiceAdjustmentTotals;
}

export type InvoiceSettlementStatus = 'due' | 'refund' | 'settled';

export interface InvoiceSharePresentation {
    calculatedAmount: number;
    originalBalance: number;
    settledAmount: number;
    remainingAmount: number;
    status: InvoiceSettlementStatus;
    statusLabel: string;
    actionLabel: string;
}

export interface InvoiceSettlementNotice {
    eventTitle: string;
    poolName: string;
    eventUrl: string;
    actor: string;
    reason: 'closed' | 'recalculated' | 'requested' | 'responsibility-changed';
    needsRecalculation: boolean;
    explanation?: InvoiceCalculationExplanation;
    savedAdjustments?: readonly InvoiceAdjustmentInput[];
    payerName?: string;
    settledShareNotice?: InvoiceSettledShareNoticePresentation | null;
    share: Pick<EventInvoiceShare, 'baseShareAmount' | 'extraAmount' | 'invoiceCreditAmount'
        | 'paymentCreditAmount' | 'shareAmount' | 'isPaid' | 'note'> & {registrationId?: number};
}

/** Read-only export preferences affect presentation only; omitting the example never changes saved financial data. */
export interface InvoiceSharesPdfOptions {
    includeExampleCalculation?: boolean;
}

export interface InvoiceSharesPdfData {
    event: Pick<Event, 'title' | 'timezone'>;
    pool: Pick<EventInvoicePool, 'id' | 'name' | 'closedAt' | 'needsRecalculation'>;
    explanation?: InvoiceCalculationExplanation;
    savedAdjustments?: readonly InvoiceAdjustmentInput[];
    shares: Array<Pick<EventInvoiceShare, 'registrationId' | 'baseShareAmount' | 'extraAmount' | 'invoiceCreditAmount'
        | 'paymentCreditAmount' | 'shareAmount' | 'isPaid' | 'paidAt' | 'note'> & {name: string;
        settledShareNotice?: InvoiceSettledShareNoticePresentation | null}>;
    generatedAt: string;
    pdfOptions?: InvoiceSharesPdfOptions;
}

export type InvoiceLabels = ReturnType<typeof import('../modules/invoice/wording').getInvoiceLabels>;

export interface PoolCalculationShare {
    registrationId: number;
    payerName: string;
    baseShareAmount: number | string;
    extraAmount: number | string;
    invoiceCreditAmount: number | string;
    paymentCreditAmount: number | string;
    shareAmount: number | string;
    isPaid: boolean;
    note?: string | null;
    baseCalculationLines?: string[];
    calculation?: InvoiceCalculationDisplay;
}

export interface PoolCalculationPreview {
    revision: number;
    shares: PoolCalculationShare[];
    labels?: InvoiceLabels;
    explanation?: InvoiceCalculationExplanation;
    settledRegistrationIds?: number[];
    basisLines?: string[];
    calculation?: InvoiceCalculationDisplay;
    totals?: {
        invoiceAmount: number;
        redistributedAmount: number;
        distributableAmount: number;
        allocatedBaseAmount: number;
        roundingDifference: number;
        adjustmentAmount: number;
        grossAmount: number;
        invoiceCreditAmount: number;
        expectedNetAmount: number;
        calculatedAmount: number;
        paymentCreditAmount: number;
        outstandingAmount: number;
        creditAmount: number;
    };
}

export type InvoiceProof = {path: string; originalName: string; mimeType: string} | null;

/** Organizer entry keeps its recorder audit separate from an optional participant who paid the invoice. */
export interface InvoiceOrganizerRequest {
    amount: number;
    description: string;
    registrationId?: number;
}

/** Locale catalogs retain the same stable keys while translated values remain unrestricted strings. */
export type InvoiceTextKey = keyof typeof import('../modules/invoice/locales/en').englishInvoiceCatalog;
export type InvoicePluralText = Readonly<{other: string} & Partial<Record<Intl.LDMLPluralRule, string>>>;
export type InvoiceCatalog = Readonly<Record<InvoiceTextKey, string | InvoicePluralText>>;
export type InvoiceTextParameters = Readonly<Record<string, string | number>>;
