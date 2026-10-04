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

// Browser and server consumers share this numeric evidence policy. Keep persistence and notification
// effects in their owning operations; this module must remain safe to emit directly into the browser graph.
import type {InvoiceAppliedTakeover, InvoiceAppliedTakeoversInput, InvoiceTakeoverChanges,
    InvoiceSettledShareImpact} from '../../types/InvoicePoolTypes';

/** Sort coverage pairs without depending on persistence order, current names, or mutable row identifiers. */
function compareInvoiceTakeovers(first: InvoiceAppliedTakeover, second: InvoiceAppliedTakeover): number {
    return first.payerRegistrationId - second.payerRegistrationId || first.beneficiaryRegistrationId - second.beneficiaryRegistrationId;
}

/** Copy and normalize numeric coverage evidence without exposing mutable persistence objects. */
function normalizedInvoiceTakeovers(takeovers: readonly InvoiceAppliedTakeover[]): InvoiceAppliedTakeover[] {
    const pairs: InvoiceAppliedTakeover[] = [];
    const seen = new Set<string>();
    // Repeated pairs or query order cannot represent a change in payment responsibility.
    for (const takeover of takeovers) {
        const key = `${takeover.payerRegistrationId}:${takeover.beneficiaryRegistrationId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        pairs.push({payerRegistrationId: takeover.payerRegistrationId, beneficiaryRegistrationId: takeover.beneficiaryRegistrationId});
    }
    return pairs.sort(compareInvoiceTakeovers);
}

/** Distinguish known applied responsibility from legacy calculations without coverage provenance. */
export function invoiceHasAppliedTakeoverEvidence(pool: InvoiceAppliedTakeoversInput): boolean {
    // Uncalculated pools use their current planning inputs; no historical saved baseline is required.
    if (pool.status !== 'CLOSED') return true;
    const snapshot = pool.calculationSnapshot;
    // An explicitly stored empty list is evidence too. Missing or malformed lists may still have
    // frozen beneficiary-to-payer attribution, while an absent source must remain unknown.
    return Array.isArray(snapshot?.takeovers) || Array.isArray(snapshot?.explanation?.contributions);
}

/** Select applied coverage from frozen evidence; current inputs describe only uncalculated planning. */
export function invoiceAppliedTakeovers(pool: InvoiceAppliedTakeoversInput): InvoiceAppliedTakeover[] {
    if (pool.status !== 'CLOSED') return normalizedInvoiceTakeovers(pool.takeovers || []);
    if (!invoiceHasAppliedTakeoverEvidence(pool)) return [];
    const snapshot = pool.calculationSnapshot;
    // A saved list, including [], is authoritative and must never be replaced by pending edits.
    if (Array.isArray(snapshot?.takeovers)) return normalizedInvoiceTakeovers(snapshot.takeovers);
    const pairs: InvoiceAppliedTakeover[] = [];
    // Older numeric explanations can certify coverage without an explicit pair list. Select only
    // contributions attributed to another payer; a person's own contribution is never a takeover.
    for (const contribution of snapshot?.explanation?.contributions || []) {
        if (contribution.registrationId !== contribution.payerRegistrationId) {
            pairs.push({payerRegistrationId: contribution.payerRegistrationId, beneficiaryRegistrationId: contribution.registrationId});
        }
    }
    return normalizedInvoiceTakeovers(pairs);
}

/** Compare pending inputs with known applied coverage without inventing a baseline for legacy pools. */
export function invoiceHasPendingTakeovers(pool: InvoiceAppliedTakeoversInput): boolean {
    if (pool.status !== 'CLOSED' || !invoiceHasAppliedTakeoverEvidence(pool)) return false;
    const applied = invoiceAppliedTakeovers(pool);
    const pending = normalizedInvoiceTakeovers(pool.takeovers || []);
    // Stable numeric pair identity makes duplicate and reordered input a no-op.
    if (applied.length !== pending.length) return true;
    for (let index = 0; index < applied.length; index++) {
        if (compareInvoiceTakeovers(applied[index], pending[index]) !== 0) return true;
    }
    return false;
}

/** Resolve an active carried settlement's applied exemption or coverage without consulting pending inputs. */
export function invoiceSettledShareImpact(pool: InvoiceAppliedTakeoversInput, registrationId: number): InvoiceSettledShareImpact | null {
    const snapshot = pool.calculationSnapshot;
    // Active carried-settlement identity is frozen until recalculation consumes it; pending edits do not clear it.
    if (pool.status !== 'CLOSED' || !snapshot?.settledRegistrationIds?.includes(registrationId)) return null;
    const covered = invoiceAppliedTakeovers(pool).find(takeover => takeover.beneficiaryRegistrationId === registrationId);
    // Coverage identifies the current payer even if the retained participant is also exempt from their own base.
    if (covered) return {registrationId, reason: 'covered', payerRegistrationId: covered.payerRegistrationId};
    // Saved contributions are the actual allocated evidence; older snapshots may certify exemptions in assignments.
    const contribution = snapshot.explanation?.contributions.find(row => row.registrationId === registrationId);
    const isExempt = contribution ? contribution.isExempt
        : snapshot.assignments?.find(assignment => assignment.registrationId === registrationId)?.isExempt;
    return isExempt ? {registrationId, reason: 'exempt'} : null;
}

/** Compare applied snapshots independently of intermediate edits and database takeover identifiers. */
export function comparePoolTakeovers(previous: readonly InvoiceAppliedTakeover[],
    current: readonly InvoiceAppliedTakeover[]): InvoiceTakeoverChanges {
    const previousPayers = new Map<number, number>();
    const currentPayers = new Map<number, number>();
    // Each beneficiary has one payer. Duplicate saved attribution must not notify either recipient twice.
    for (const takeover of previous) previousPayers.set(takeover.beneficiaryRegistrationId, takeover.payerRegistrationId);
    for (const takeover of current) currentPayers.set(takeover.beneficiaryRegistrationId, takeover.payerRegistrationId);
    const changes: InvoiceTakeoverChanges = {added: [], removed: []};
    // Reassignment removes the prior responsibility and adds only its final replacement.
    for (const [beneficiaryId, payerId] of previousPayers) {
        if (currentPayers.get(beneficiaryId) !== payerId) changes.removed.push({payerId, beneficiaryId});
    }
    for (const [beneficiaryId, payerId] of currentPayers) {
        if (previousPayers.get(beneficiaryId) !== payerId) changes.added.push({payerId, beneficiaryId});
    }
    return changes;
}
