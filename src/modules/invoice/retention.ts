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
import {format, subMonths} from 'date-fns';
import type {EntityManager} from 'typeorm';
import type {EventInvoicePool} from '../database/entities/event/EventInvoicePool';
import * as invoiceService from '../database/services/EventInvoiceService';
import settings from '../settings';
import {requireLockedPool, savePoolChange} from './state';
import {deleteInvoiceProof} from './proofs';

/** Select expired invoices, enforce the proof directory boundary, and delete records under each pool lock. */
export async function purgeExpiredInvoices(retentionMonths: number, now: Date = new Date()): Promise<number> {
    // Validate the retention setting before deriving the existing calendar-date cutoff.
    if (!Number.isInteger(retentionMonths) || retentionMonths < 0) throw new Error(invoiceText('invoiceRetentionMonthsMustBeANonNegativeInteger'));
    const cutoffDate = format(subMonths(now, retentionMonths), 'yyyy-MM-dd');
    // The DBAL selects candidates; filesystem deletion obeys the configured invoice-directory boundary.
    const expired = await invoiceService.getExpiredInvoices(cutoffDate);
    for (const invoice of expired) await deleteInvoiceProof(invoice.proofPath);
    // Group deletions by their owning pool so each mutation shares the same lock as invoice workflows.
    const groups = new Map<string, number[]>();
    for (const invoice of expired) {
        const ids = groups.get(invoice.pool.id) || [];
        ids.push(invoice.id);
        groups.set(invoice.pool.id, ids);
    }
    for (const [poolId, ids] of groups) {
        /** Evaluate this operation and apply its writes while the DBAL holds the pool’s root lock. */
        async function purgeLocked(manager: EntityManager, row: EventInvoicePool | null): Promise<void> {
            // Retention removes only selected records; saved shares and numeric provenance remain intact.
            const pool = requireLockedPool(row);
            await invoiceService.deleteInvoices(ids, manager);
            await savePoolChange(manager, pool, false);
        }
        await invoiceService.withLockedPool(poolId, purgeLocked);
    }
    return expired.length;
}

const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
let retentionTimer: NodeJS.Timeout | undefined;

/** Apply the configured calendar retention policy and report a nonempty cleanup. */
export async function runInvoiceRetentionCleanup(now: Date = new Date()): Promise<number> {
    const deleted = await purgeExpiredInvoices(settings.value.invoiceRetentionMonths, now);
    if (deleted > 0) {
        console.log(invoiceText('retentionDeleted', {count: deleted}));
    }
    return deleted;
}

/** Run startup cleanup and install the existing process-local hourly retention timer. */
export async function startInvoiceRetentionJob(): Promise<void> {
    // Startup performs one cleanup before installing a single process-local timer.
    await runInvoiceRetentionCleanup();
    if (retentionTimer) return;

    // Background failures are reported without crashing the process or keeping shutdown alive.
    /** Report a post-commit delivery or background failure without changing the saved financial result. */
    function reportFailure(error: unknown): void { console.error(invoiceText('retentionCleanupFailed'), error); }
    /** Schedule best-effort cleanup while reporting background errors. */
    function cleanExpiredInvoices(): void { void runInvoiceRetentionCleanup().catch(reportFailure); }
    retentionTimer = setInterval(cleanExpiredInvoices, CLEANUP_INTERVAL_MS);
    retentionTimer.unref();
}
