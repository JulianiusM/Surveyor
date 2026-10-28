import type {ListPersistenceType} from '../../../types/ListPersistenceTypes';
import type {ListMembershipSnapshot} from '../../../types/ListMembershipTypes';
import {unassignPackingItem} from '../database/services/PackingService';
import {unassignDriversItem} from '../database/services/DriverService';
import {insertListAssignment} from '../database/services/ListService';
import {ApiProblem} from '../api/problem';
import {APIError} from '../lib/errors';

/**
 * Apply desired Packing/Drivers membership using the caller's existing lock and
 * admission. Direct unassignment retains its unlocked deletion; assignments use
 * a locked snapshot, preserve idempotency before capacity and keep nullable
 * historical capacity unrestricted. DBAL still owns every query and transaction.
 */
export async function applyListMembership<Type extends ListPersistenceType>(type: Type,
    itemId: string, profileId: string, assigned: boolean, snapshot?: ListMembershipSnapshot<Type>,
    transport: 'direct' | 'versioned' = 'direct'): Promise<number> {
    if (!assigned) {
        // Remove every historical duplicate through its original feature DBAL.
        // Only versioned callers need the remaining count from the locked snapshot.
        const removeMembership = type === 'packing' ? unassignPackingItem : unassignDriversItem;
        const removed = await removeMembership(itemId, profileId, snapshot?.manager);
        return (snapshot?.count ?? removed) - removed;
    }

    // Controllers have already admitted the item under their original lock.
    // An existing successful membership stays valid even when the item is full.
    const {manager, item, existing, count} = snapshot!;
    if (existing) return count;
    if (typeof item.maxAssignees === 'number' && count >= item.maxAssignees) {
        if (transport === 'versioned') {
            throw new ApiProblem(type === 'packing' ? 'PACKING_ITEM_FULL' : 'DRIVERS_ITEM_FULL', {itemId});
        }
        const message = type === 'packing' ? 'This packing item is already fully assigned' : 'This driver offer is already full';
        throw new APIError(message, {itemId}, 409);
    }

    // Insertion shares the same manager and preserves the original FK lookup,
    // missing-row diagnostics and commit boundary selected by the lock owner.
    await insertListAssignment(type, itemId, profileId, manager);
    return count + 1;
}
