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

import * as invoiceService from './database/services/EventInvoiceService';
import settings from './settings';

const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
let retentionTimer: NodeJS.Timeout | undefined;

export async function runInvoiceRetentionCleanup(now: Date = new Date()): Promise<number> {
    const deleted = await invoiceService.purgeExpiredInvoices(settings.value.invoiceRetentionMonths, now);
    if (deleted > 0) {
        console.log(`[invoice-retention] Deleted ${deleted} expired invoice${deleted === 1 ? '' : 's'}.`);
    }
    return deleted;
}

export async function startInvoiceRetentionJob(): Promise<void> {
    await runInvoiceRetentionCleanup();
    if (retentionTimer) return;

    retentionTimer = setInterval(() => {
        void runInvoiceRetentionCleanup().catch((error) => {
            console.error('[invoice-retention] Cleanup failed:', error);
        });
    }, CLEANUP_INTERVAL_MS);
    retentionTimer.unref();
}
