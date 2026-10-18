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
import {requireLockedPool, assertLockedParticipant, savePoolChange} from './state';
import type {InvoiceTakeoverChange, InvoiceTakeoverSaveResult} from '../../types/InvoicePoolTypes';

/** Serialize coverage decisions so concurrent requests cannot assign the same beneficiary twice. */
export async function savePoolTakeovers(poolId: string, payerRegistrationId: number, beneficiaryIds: number[], allowReassign: boolean): Promise<InvoiceTakeoverSaveResult> {
    /** Evaluate this operation and apply its writes while the DBAL holds the pool’s root lock. */
    async function updateLocked(manager: EntityManager, row: EventInvoicePool | null): Promise<InvoiceTakeoverSaveResult> {
        // Read current coverage under the root lock so competing edits cannot claim the same beneficiary.
        const pool = requireLockedPool(row);
        if (!allowReassign && pool.status !== 'OPEN') throw new APIError(invoiceText('participantTakeoversUnavailable'), {}, 409);
        const existing = await invoiceService.getTakeovers(poolId, manager);
        // Validate every endpoint against current membership before evaluating the one-level coverage rule.
        const beneficiaries = Array.from(new Set(beneficiaryIds.map(Number)));
        await assertLockedParticipant(manager, pool, payerRegistrationId);
        for (const beneficiaryId of beneficiaries) {
            if (beneficiaryId === payerRegistrationId) throw new APIError(invoiceText('participantsCannotCoverThemselves'), {}, 400);
            await assertLockedParticipant(manager, pool, beneficiaryId);
        }
        // Coverage is one level deep: a beneficiary cannot also be a payer. Organizers may move
        // an existing beneficiary between payers; participant requests must respect its current owner.
        if (beneficiaries.length && existing.some(takeover => takeover.beneficiaryRegistrationId === payerRegistrationId)) {
            throw new APIError(invoiceText('participantsWhoseShareIsTakenOverCannotCoverOthers'), {}, 400);
        }
        if (existing.some(takeover => beneficiaries.includes(takeover.payerRegistrationId))) {
            throw new APIError(invoiceText('clearAParticipantSExistingTakeoversBeforeCoveringTheir'), {}, 400);
        }
        if (!allowReassign && existing.some(takeover => beneficiaries.includes(takeover.beneficiaryRegistrationId)
            && takeover.payerRegistrationId !== payerRegistrationId)) {
            throw new APIError(invoiceText('oneOrMoreParticipantsAreAlreadyCoveredBySomeone'), {}, 409);
        }
        // Build a minimal diff: remove obsolete or reassigned links, retaining unchanged coverage records.
        const removed: InvoiceTakeoverChange[] = [];
        const added: InvoiceTakeoverChange[] = [];
        const deletedIds = new Set<number>();
        for (const takeover of existing) {
            const isPayer = takeover.payerRegistrationId === payerRegistrationId;
            const desired = beneficiaries.includes(takeover.beneficiaryRegistrationId);
            if ((isPayer && !desired) || (allowReassign && desired && !isPayer)) {
                deletedIds.add(takeover.id);
                removed.push({payerId: takeover.payerRegistrationId, beneficiaryId: takeover.beneficiaryRegistrationId});
            }
        }
        // Add only missing links after accounting for the selected removals.
        for (const beneficiaryId of beneficiaries) {
            if (!existing.some(takeover => !deletedIds.has(takeover.id) && takeover.payerRegistrationId === payerRegistrationId
                && takeover.beneficiaryRegistrationId === beneficiaryId)) {
                added.push({payerId: payerRegistrationId, beneficiaryId});
            }
        }
        // Persist allocation inputs and revision together, retaining every saved share and applied snapshot.
        // Uncalculated pools apply planning inputs immediately; a closed pool's coverage stays pending until recalculation.
        await invoiceService.deleteTakeovers(Array.from(deletedIds), manager);
        await invoiceService.insertTakeovers(poolId, added, manager);
        if (added.length || removed.length) await savePoolChange(manager, pool);
        return {added, removed, applied: pool.status !== 'CLOSED'};
    }
    return invoiceService.withLockedPool(poolId, updateLocked);
}
