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

// TypeORM-based implementation of the packing list module
import {type EntityManager} from 'typeorm';
import {getLockedListAssignment} from './ListService';
import type {BasicEntityPropertyPatch} from '../../../../types/EntityPropertyTypes';
import {generateUniqueId, groupByUuid} from '../../lib/util';
import {AppDataSource} from '../dataSource';
import {PackingAssignment} from '../entities/packing/PackingAssignment';
import {PackingItem} from '../entities/packing/PackingItem';
import {PackingList} from '../entities/packing/PackingList';

import * as entityAdminService from './EntityAdminService';

// Packing Lists
export async function createPackingList(listId: string, ownerId: string, title: string, desc: string, eventId?: string, headerImg?: string | null,) {
    const repo = AppDataSource.getRepository(PackingList);
    const list = repo.create({
        id: listId,
        owner: {id: ownerId},
        title,
        description: desc,
        headerImg,
        ...(eventId !== undefined ? {event: {id: eventId}} : {}),
    });
    await repo.save(list);
}

/** Persist the root and initial items atomically. A supplied manager joins the
 * caller's parent/defaults transaction; standalone creation retains its own transaction.
 * Decoding, grant checks and item/default choices remain controller responsibilities. */
export async function createPackingListTx(
    ownerId: string,
    title: string,
    desc: string | null,
    items: Partial<PackingItem>[],
    eventId?: string | null,
    headerImg?: string | null,
    manager?: EntityManager
) {
    /** Save a new Packing root before its caller-selected item identities on this transaction. */
    async function persist(manager: EntityManager) {
        const listId = generateUniqueId();
        const listRepo = manager.getRepository(PackingList);
        const itemRepo = manager.getRepository(PackingItem);

        // Persist the root before any child can refer to it; an absent parent
        // stays omitted from the new row rather than introducing a relation object.
        const list = listRepo.create({
            id: listId,
            owner: {id: ownerId},
            title,
            description: desc,
            headerImg,
            // This is a new row: omitting an absent parent keeps the
            // original persisted NULL without inventing a nullable Event ID/relation.
            ...(eventId !== undefined && eventId !== null ? {event: {id: eventId}} : {}),
        });
        await listRepo.save(list);

        // Empty input creates only the root. Supplied item IDs and values stay
        // with the controller's selection and share its parent/default transaction.
        if (items.length) {
            const itemEntities = items.map(it => itemRepo.create({
                id: it.id,
                entity: {id: listId},
                title: it.title,
                description: it.description,
                maxAssignees: it.maxAssignees,
                requiredByAll: it.requiredByAll,
                pos: it.pos
            }));
            await itemRepo.save(itemEntities);
        }

        return listId;
    }
    return manager ? persist(manager) : AppDataSource.transaction(persist);
}

export async function updatePackingListTitle(listId: string, title: string) {
    await updatePackingListProperties(listId, {title}, AppDataSource.manager);
}

/** Keep permanent deletion the existing repository operation. A caller-owned
 * transaction can retain its root lock; archival never selects this operation. */
export async function deletePackingList(listId: string, manager: EntityManager = AppDataSource.manager) {
    await manager.getRepository(PackingList).delete(listId);
}

export async function getPackingListById(listId: string) {
    return await AppDataSource.getRepository(PackingList).findOne({
        where: {id: listId}, relations: {
            event: true
        }
    });
}

export async function getPackingListByProfileId(profileId: string) {
    return await AppDataSource.getRepository(PackingList).findBy({owner: {id: profileId}});
}

export async function updatePackingListDescription(listId: string, description: string) {
    await updatePackingListProperties(listId, {description}, AppDataSource.manager);
}

/** Store only the controller-selected image reference in its supplied manager.
 * Filesystem validation/unlink and after-commit receipts belong to the image owner. */
export async function updateHeaderImage(listId: string, headerImg?: string | null, manager: EntityManager = AppDataSource.manager): Promise<void> {
    await manager.getRepository(PackingList).update(listId, {headerImg});
}

export async function getManagedLists(profileId: string) {
    // Use the same ownership/administration predicate as personal visibility writes.
    return entityAdminService.createManagedEntityQuery(AppDataSource.getRepository(PackingList), 'packing', profileId).getMany();
}

export async function getPackingListByParticipant(profileId: string) {
    return getPackingParticipationQuery(profileId).getMany();
}

/**
 * An assignment makes the profile a participant in this packing list.
 * Share the query between full overview discovery and the transaction-scoped check
 * for one visibility change. EXISTS avoids duplicate lists for multiple assignments.
 */
export function getPackingParticipationQuery(profileId: string, manager: EntityManager = AppDataSource.manager) {
    return manager.getRepository(PackingList).createQueryBuilder('list')
        .whereExists(manager.getRepository(PackingAssignment)
            .createQueryBuilder("ass")
            .where("ass.entity_id = list.id")
            .andWhere("ass.profile_id = :profileId", {profileId: profileId})
        );
}

// Packing Items
/** Persist the supported item fields and admitted creator relationship. Optional
 * values retain database defaults; this DBAL neither decodes forms nor grants access. */
export async function createPackingItem(listId: string, item: Partial<PackingItem>, profileId: string, manager: EntityManager = AppDataSource.manager): Promise<void> {
    const repo = manager.getRepository(PackingItem);
    const entity = repo.create({
        id: item.id,
        entity: {id: listId},
        title: item.title,
        description: item.description,
        maxAssignees: item.maxAssignees,
        pos: item.pos,
        requiredByAll: item.requiredByAll,
        profile: {id: profileId},
    });
    await repo.save(entity);
}

/** Persist the bulk collector's supported item fields and creator relation
 * in the supplied manager. Empty input is a no-op; validation, resource authority
 * and any transaction surrounding this batch belong to the calling controller. */
export async function addPackingItems(listId: string, items: Partial<PackingItem>[], profileId: string, manager: EntityManager = AppDataSource.manager): Promise<void> {
    if (!items.length) return;
    const repo = manager.getRepository(PackingItem);
    const entities = items.map(it => repo.create({
        id: it.id,
        entity: {id: listId},
        title: it.title,
        description: it.description,
        maxAssignees: it.maxAssignees,
        pos: it.pos,
        profile: {id: profileId}
    }));
    await repo.save(entities);
}

/** Return nullable current item evidence through the caller's manager. Callers
 * choose missing-row diagnostics and separately validate the requested root scope. */
export async function getPackingItemById(itemId: string, manager: EntityManager = AppDataSource.manager) {
    return await manager.getRepository(PackingItem).findOneBy({id: itemId});
}

/** Persist the supported sparse fields: undefined is omitted, while null, zero
 * and false remain authored values. Return update evidence without choosing a
 * direct/versioned error; capacity changes never delete assignment records. */
export async function updatePackingItem(itemId: string, fields: Partial<PackingItem>, manager: EntityManager = AppDataSource.manager) {
    const repo = manager.getRepository(PackingItem);

    // Only include fields that are not undefined
    const updateData: Partial<PackingItem> = {};
    if (fields.title !== undefined) updateData.title = fields.title;
    if (fields.description !== undefined) updateData.description = fields.description;
    if (fields.maxAssignees !== undefined) updateData.maxAssignees = fields.maxAssignees;
    if (fields.pos !== undefined) updateData.pos = fields.pos;
    if (fields.requiredByAll !== undefined) updateData.requiredByAll = fields.requiredByAll;

    if (Object.keys(updateData).length === 0) return;

    // Sparse field persistence deliberately leaves related assignments untouched.
    const result = await repo.update(itemId, updateData);
    return result.affected === 1;
}


/** Delete the selected item directly; existing foreign-key cascades handle its
 * assignments. Authorization and root relationship checks belong to the controller. */
export async function deletePackingItem(itemId: string, manager: EntityManager = AppDataSource.manager) {
    await manager.getRepository(PackingItem).delete(itemId);
}

/** Apply each supplied position only within the requested list. Direct callers
 * retain their partial-order writes; v1 supplies a complete reviewed order and
 * its existing transaction rather than making this DBAL own order policy. */
export async function reorderPackingItems(listId: string, orders: any[], manager: EntityManager = AppDataSource.manager): Promise<void> {
    const repo = manager.getRepository(PackingItem);
    for (const order of orders) {
        await repo.update({id: order.itemId, entity: {id: listId}}, {pos: order.position});
    }
}

export async function getPackingItems(listId: string): Promise<(PackingItem & { assignedCount: number })[]> {
    const repo = AppDataSource.getRepository(PackingItem);

    const entities = await repo.find({
        where: {entity: {id: listId}},
        relations: {
            profile: true
        },
        loadRelationIds: {relations: ['assignments']}, // get IDs, not full rows
        order: {pos: 'ASC'},
    });

    return entities.map((item) => {
        const assignedCount = item.assignments?.length ?? 0;

        return {
            ...item,
            assignedCount,
        };
    });
}

/** Count stored memberships per item within the selected packing list.
 * Items without assignment rows remain absent; feature policy decides how those
 * counts interact with capacity and Everyone rows. */
export async function getPackingAssignmentCounts(listId: string) {
    // Read the same list-scoped rows before reducing their item identifiers.
    const repo = AppDataSource.getRepository(PackingAssignment);
    const assignments = await repo.findBy({entity: {id: listId}});
    // Accumulate memberships without loading profiles or changing assignment data.
    return assignments.reduce((map: Record<string, number>, a) => {
        map[a.itemId] = (map[a.itemId] || 0) + 1;
        return map;
    }, {});
}

/** Read the stored maximum position in the caller's transaction. The controller
 * decides the next position and preserves Quick Add's separate behavior. */
export async function getLastPackingItemNumber(listId: string, manager: EntityManager = AppDataSource.manager): Promise<number> {
    return (await manager.getRepository(PackingItem).maximum("pos", {entity: {id: listId},})) ?? 0;
}

/**
 * Discover the immutable item-to-list relationship, then hold the owning list's
 * shared row lock before the item's exclusive row lock. Assignment insertion takes
 * a shared list FK lock too; acquiring it in this order prevents a cycle with v1's
 * root-before-item writers. A shared root permits direct assignments on different
 * items to proceed together, while v1 retains its exclusive root/order protection.
 *
 * Direct unassignment and administrator removal keep their original unlocked
 * DELETEs. Missing/deleted rows remain nullable for the controller's existing
 * missing-item, idempotency and capacity decisions; this DBAL does not own errors.
 */
export async function withPackingAssignmentLock<T>(
    itemId: string, profileId: string,
    action: (manager: EntityManager, item: PackingItem | null, existing: PackingAssignment | null, count: number) => Promise<T>,
): Promise<T> {
    async function readLocked(manager: EntityManager): Promise<T> {
        // Packing items are never reparented. The initial discovery chooses only
        // the root lock; current item values are loaded again after both locks.
        // A deletion between these reads is an ordinary missing-item outcome.
        const discovered = await getPackingItemById(itemId, manager);
        if (!discovered) return action(manager, null, null, 0);

        const root = await manager.getRepository(PackingList).findOne({
            select: {id: true}, where: {id: discovered.entityId}, lock: {mode: 'pessimistic_read'},
        });
        if (!root) return action(manager, null, null, 0);

        const {item, existing, count} = await getLockedListAssignment('packing', manager, itemId, profileId);
        return action(manager, item, existing, count);
    }
    return AppDataSource.transaction('READ COMMITTED', readLocked);
}


/** Remove all stored memberships for this item/profile and return the affected
 * count. Direct removal stays direct; locked v1 callers reuse their own manager. */
export async function unassignPackingItem(itemId: string, profileId: string, manager: EntityManager = AppDataSource.manager) {
    const result = await manager.getRepository(PackingAssignment).delete({item: {id: itemId}, profile: {id: profileId}});
    return result.affected ?? 0;
}

/** Project the selected profile's stored membership item identifiers.
 * Both list and profile predicates remain query constraints; no participation
 * or assignment permission is inferred by this persistence read. */
export async function getPackingAssignments(listId: string, profileId: string) {
    // Restrict both ownership dimensions before projecting the matching IDs.
    const rows = await AppDataSource.getRepository(PackingAssignment).findBy({
        entity: {id: listId},
        profile: {id: profileId},
    });
    return rows.map(r => r.itemId);
}

/** Group stored assignment/profile display data by packing item.
 * Preserve assignment IDs, profile IDs and the existing absent-name fallback;
 * the caller owns admission and decides which groups may be disclosed. */
export async function getPackingItemAssignees(listId: string) {
    // Hydrate profiles only for assignments belonging to this selected list.
    const rows = await AppDataSource.getRepository(PackingAssignment).find({
        where: {entity: {id: listId}},
        relations: {
            profile: true
        }
    });
    // Merge UUID aliases before projection, preserving every assignment and its stored references.
    const groups = groupByUuid(rows, row => row.itemId);
    return Object.fromEntries([...groups].map(([id, assignments]) => [id, assignments.map(assignment => ({
        id: assignment.id, profileId: assignment.profileId, name: assignment.profile.name || '—',
    }))]));
}

/** Load the selected assignment with its owning item so the controller can
 * check resource scope before choosing method authority or missing-row errors. */
export async function getPackingAssignmentById(assignId: number, manager: EntityManager = AppDataSource.manager) {
    return await manager.getRepository(PackingAssignment).findOne({
        where: {id: assignId},
        relations: {
            item: true
        }
    });
}

/** Keep administrator removal the direct row deletion after caller admission;
 * this operation does not infer personal membership or alter archival state. */
export async function deletePackingAssignment(assignId: string, manager: EntityManager = AppDataSource.manager) {
    await manager.getRepository(PackingAssignment).delete(assignId);
}

export async function togglePackingItemRequiredByAll(itemId: string, flag: boolean) {
    await AppDataSource.getRepository(PackingItem).update(itemId, {requiredByAll: flag});
}



/** Persist only the normalized fields supplied by the controller in its existing transaction. */
export async function updatePackingListProperties(id: string, patch: BasicEntityPropertyPatch, manager: EntityManager): Promise<void> {
    await manager.getRepository(PackingList).update(id, patch);
}

/** Read the root and parent through the caller's snapshot/transaction, without choosing an access policy. */
export async function getPackingSnapshotRoot(manager: EntityManager, id: string): Promise<PackingList | null> {
    return manager.getRepository(PackingList).findOne({where: {id}, relations: {event: true}});
}

/** Keep root, membership, ACL evaluation, items and assignment counts in one repeatable read snapshot. */
export async function withPackingReadSnapshot<T>(id: string, read: (manager: EntityManager, list: PackingList | null) => Promise<T>): Promise<T> {
    async function readSnapshot(manager: EntityManager): Promise<T> {
        return read(manager, await getPackingSnapshotRoot(manager, id));
    }
    return AppDataSource.transaction('REPEATABLE READ', readSnapshot);
}

/**
 * Load ordered rows without exposing repositories to a projector. Versioned reorder
 * additionally locks the compared item values until its transaction commits; direct
 * reorder keeps its original per-row writes and does not acquire a new root transaction.
 */
export async function getPackingSnapshotItems(manager: EntityManager, listId: string, lockItems = false): Promise<PackingItem[]> {
    return manager.getRepository(PackingItem).find({
        where: {entity: {id: listId}},
        order: {pos: 'ASC', id: 'ASC'},
        ...(lockItems ? {lock: {mode: 'pessimistic_write' as const}} : {})
    });
}

/** Full detail reads additionally load assignment evidence. Minimal order baselines
 * reuse the ordered-item query above without querying the private assignment roster. */
export async function getPackingSnapshotRows(manager: EntityManager, listId: string, lockItems = false) {
    const items = await getPackingSnapshotItems(manager, listId, lockItems);
    const assignments = await manager.getRepository(PackingAssignment).find({
        where: {entity: {id: listId}}, relations: {profile: true}, order: {id: 'ASC'},
    });
    return {items, assignments};
}
