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

import {invoiceText, invoiceRejectionCause} from './wording';
import type {EntityManager} from 'typeorm';
import type {EventInvoicePool} from '../database/entities/event/EventInvoicePool';
import * as invoiceService from '../database/services/EventInvoiceService';
import {APIError} from '../lib/errors';
import {ApiProblem} from '../api/problem';
import type {InvoiceManagementContext} from '../../../types/InvoicePoolTypes';
import type {Event} from '../database/entities/event/Event';
import * as eventService from '../database/services/EventService';
import {evaluateSubject} from '../permissionEngine';
import {sameUuid} from '../lib/util';
import type {SessionLike} from '../../../types/PermissionTypes';

/** Resolve authenticated event membership before an invoice operation selects
 * its ownership policy. Missing profiles remain an absent registration. */
export async function getInvoiceActorRegistrationId(event: Event, session: SessionLike) {
    if (!session.profile) return undefined;
    const registration = await eventService.getRegistrationFor(session.profile.id, event.id);
    return registration?.id;
}

/** Load the requested event's pool without admitting a same-ID foreign scope. */
export async function requireEventPool(event: Event, poolId: string) {
    const pool = await invoiceService.getPoolWithInvoices(poolId);
    if (pool?.event.id !== event.id) {
        throw new APIError(invoiceText('poolNotFound'), {}, 404);
    }
    return pool;
}

/** Retain the request's early membership preflight before the locked adjustment
 * operation repeats its current event and pool membership checks. */
export async function assertPoolRegistrationAllowed(pool: EventInvoicePool, registrationId: number): Promise<void> {
    // The loaded assignment snapshot and all-event membership are deliberately
    // selected here; the write still uses fresh transaction-scoped rows later.
    const assignedIds = pool.assignAll
        ? (await eventService.getRegistrationsForEvent(pool.event.id)).map((r) => r.id)
        : pool.assignments.map((a) => a.registrationId);
    if (!assignedIds.includes(registrationId)) throw new APIError(invoiceText('participantNotAssignedToThisPool'), {}, 400, {cause: invoiceRejectionCause('participantNotAssignedToThisPool')});
}

/** Recheck the captured actor's current method grant on the fenced Event using
 * this write's manager. Public method grants remain valid independently from
 * organizer-page admission; no request-level permission cache is consulted. */
async function requireInvoiceManagement(manager: EntityManager, context: InvoiceManagementContext,
    event: Event | null): Promise<void> {
    if (!event || !sameUuid(event.id, context.eventId)) throw new ApiProblem('NOT_FOUND');
    // Event ACL/default writers retain this same root fence, so authority cannot
    // change between this fresh evaluation and the write transaction's commit.
    const permissions = await evaluateSubject({kind: 'entity', entity: {
            entityType: 'event', entityId: event.id, ownerId: event.ownerId, eventId: event.id,
        }}, context.actor, undefined, manager);
    if (!permissions.has('MANAGE_ASSIGNMENTS')) throw new ApiProblem('FORBIDDEN');
}

/** Own shared locked Finance admission before the existing operation's domain
 * decisions. DBAL acquires Event before pool on one transaction; participant
 * operations and trusted internal callers retain their original pool-only path. */
export async function withInvoicePoolOperation<Result>(poolId: string,
    operation: (manager: EntityManager, pool: EventInvoicePool | null) => Promise<Result>,
    management?: InvoiceManagementContext): Promise<Result> {
    /** Apply fresh management scope only after the DBAL has retained its locks. */
    async function operateLocked(manager: EntityManager, pool: EventInvoicePool | null): Promise<Result> {
        if (management) {
            if (!pool || !sameUuid(pool.eventId, management.eventId)) throw new ApiProblem('NOT_FOUND');
            await requireInvoiceManagement(manager, management, await eventService.getEventById(management.eventId, manager));
        }
        return operation(manager, pool);
    }
    return invoiceService.withLockedPool(poolId, operateLocked, management?.eventId);
}

/** Fence Event-only management work such as pool creation or notification
 * admission. The callback must reuse this manager for required persistence;
 * external delivery follows this transaction rather than extending its lock. */
export function withInvoiceManagementEvent(management: InvoiceManagementContext): Promise<void>;
export function withInvoiceManagementEvent<Result>(management: InvoiceManagementContext,
    operation: (manager: EntityManager) => Promise<Result>): Promise<Result>;
export async function withInvoiceManagementEvent<Result>(management: InvoiceManagementContext,
    operation?: (manager: EntityManager) => Promise<Result>): Promise<Result | void> {
    /** Event lookup and uncached authority remain on this transaction connection. */
    async function operateLocked(manager: EntityManager): Promise<Result | void> {
        const event = await eventService.lockEvent(manager, management.eventId);
        await requireInvoiceManagement(manager, management, event);
        return operation?.(manager);
    }
    return eventService.withEventTransaction(operateLocked);
}

/** Business checks execute inside the service-owned transaction, including after concurrent edits. */
export function requireLockedPool(pool: EventInvoicePool | null): EventInvoicePool {
    if (!pool) throw new APIError(invoiceText('poolNotFound'), {}, 404);
    return pool;
}

/** Select participant submission choices from the caller's already loaded pool
 * snapshot. This pure read policy retains no pool data across requests; command
 * owners still check current enrollment and lifecycle under their existing lock. */
export function isParticipantSubmissionPool(
    pool: Pick<EventInvoicePool, 'status' | 'assignAll' | 'assignments'>,
    registrationId: number,
): boolean {
    // Default enrollment is separate from eligibility: only an open pool with
    // all-participant enrollment or this explicit assignment is a current choice.
    return pool.status === 'OPEN' && (Boolean(pool.assignAll)
        || pool.assignments.some(assignment => assignment.registrationId === registrationId));
}

/** Check event and pool membership using the current transaction’s rows. */
export async function assertLockedParticipant(manager: EntityManager, pool: EventInvoicePool, registrationId: number): Promise<void> {
    // Read both event membership and explicit pool membership through the transaction-scoped DBAL.
    const {registration, assignment} = await invoiceService.getPoolMembership(manager, pool, registrationId);
    // assignAll broadens pool membership only; it never permits a registration from another event.
    if (!registration || (!pool.assignAll && !assignment)) throw new APIError(invoiceText('participantNotAssignedToThisPool'), {}, 400, {cause: invoiceRejectionCause('participantNotAssignedToThisPool')});
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
