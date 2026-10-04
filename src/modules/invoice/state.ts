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
import type {EntityManager} from 'typeorm';
import type {EventInvoicePool} from '../database/entities/event/EventInvoicePool';
import * as invoiceService from '../database/services/EventInvoiceService';
import {APIError} from '../lib/errors';

/** Business checks execute inside the service-owned transaction, including after concurrent edits. */
export function requireLockedPool(pool: EventInvoicePool | null): EventInvoicePool {
    if (!pool) throw new APIError(invoiceText('poolNotFound'), {}, 404);
    return pool;
}

/** Check event and pool membership using the current transaction’s rows. */
export async function assertLockedParticipant(manager: EntityManager, pool: EventInvoicePool, registrationId: number): Promise<void> {
    // Read both event membership and explicit pool membership through the transaction-scoped DBAL.
    const {registration, assignment} = await invoiceService.getPoolMembership(manager, pool, registrationId);
    // assignAll broadens pool membership only; it never permits a registration from another event.
    if (!registration || (!pool.assignAll && !assignment)) throw new APIError(invoiceText('participantNotAssignedToThisPool'), {}, 400);
}

/** Advancing the revision invalidates previews; only changed inputs make a saved calculation stale. */
export async function savePoolChange(manager: EntityManager, pool: EventInvoicePool, inputsChanged = true): Promise<void> {
    // Every mutation invalidates previews, including settlement edits that do not change allocation inputs.
    pool.calculationRevision++;
    if (inputsChanged) pool.needsRecalculation = pool.status === 'CLOSED';
    // Save lifecycle flags before refreshing the derived aggregate columns in the same transaction.
    await invoiceService.savePool(pool, manager);
    await invoiceService.refreshPoolTotals(manager, pool.id);
}
