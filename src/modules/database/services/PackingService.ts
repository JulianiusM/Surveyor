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
import {type EntityManager} from "typeorm";
import type {BasicEntityPropertyPatch} from '../../../types/EntityPropertyTypes';
import {generateUniqueId} from '../../lib/util';
import {AppDataSource} from '../dataSource';
import {PackingAssignment} from '../entities/packing/PackingAssignment';
import {PackingItem} from '../entities/packing/PackingItem';
import {PackingList} from '../entities/packing/PackingList';
import {EventRegistration} from '../entities/event/EventRegistration';
import {Event} from '../entities/event/Event';
import * as entityAdminService from "./EntityAdminService";

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

export async function createPackingListTx(ownerId: string, title: string, desc: string | null, items: Partial<PackingItem>[], eventId?: string, headerImg?: string | null, manager?: EntityManager) {
    async function persist(manager: EntityManager) {
        const listId = generateUniqueId();
        const listRepo = manager.getRepository(PackingList);
        const itemRepo = manager.getRepository(PackingItem);

        const list = listRepo.create({
            id: listId,
            owner: {id: ownerId},
            title,
            description: desc,
            headerImg,
            ...(eventId !== undefined ? {event: {id: eventId}} : {}),
        });
        await listRepo.save(list);

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

export async function updateHeaderImage(listId: string, headerImg?: string | null, manager: EntityManager = AppDataSource.manager): Promise<void> {
    if (!manager.queryRunner?.isTransactionActive) {
        return withPackingListLock(listId, transaction => updateHeaderImage(listId, headerImg, transaction));
    }
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
export async function createPackingItem(listId: string, item: Partial<PackingItem>, profileId: string, manager: EntityManager = AppDataSource.manager): Promise<void> {
    if (!manager.queryRunner?.isTransactionActive) {
        return withPackingListLock(listId, transaction => createPackingItem(listId, item, profileId, transaction));
    }
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

export async function addPackingItems(listId: string, items: Partial<PackingItem>[], profileId: string, manager: EntityManager = AppDataSource.manager): Promise<void> {
    if (!manager.queryRunner?.isTransactionActive) {
        return withPackingListLock(listId, transaction => addPackingItems(listId, items, profileId, transaction));
    }
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

export async function getPackingItemById(itemId: string, manager: EntityManager = AppDataSource.manager) {
    return await manager.getRepository(PackingItem).findOneBy({id: itemId});
}

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

    const result = await repo.update(itemId, updateData);
    return result.affected === 1;
}


export async function deletePackingItem(itemId: string, manager: EntityManager = AppDataSource.manager) {
    await manager.getRepository(PackingItem).delete(itemId);
}

export async function reorderPackingItems(listId: string, orders: any[], manager: EntityManager = AppDataSource.manager): Promise<void> {
    if (!manager.queryRunner?.isTransactionActive) {
        return withPackingListLock(listId, transaction => reorderPackingItems(listId, orders, transaction));
    }
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

export async function getPackingAssignmentCounts(listId: string) {
    const repo = AppDataSource.getRepository(PackingAssignment);
    const assignments = await repo.findBy({entity: {id: listId}});
    return assignments.reduce((map: Record<string, number>, a) => {
        map[a.itemId] = (map[a.itemId] || 0) + 1;
        return map;
    }, {});
}

export async function getLastPackingItemNumber(listId: string): Promise<number> {
    return (await AppDataSource.getRepository(PackingItem).maximum("pos", {entity: {id: listId},})) ?? 0;
}

/**
 * Hold the item row while the controller evaluates assignment policy. Every assignment write
 * through the controller acquires this lock, so its existing/count snapshot cannot become stale
 * before the transaction commits. Missing records remain nullable; the caller chooses the error.
 */
export async function withPackingAssignmentLock<T>(
    itemId: string, profileId: string,
    action: (manager: EntityManager, item: PackingItem | null, existing: PackingAssignment | null, count: number) => Promise<T>,
): Promise<T> {
    async function readLocked(manager: EntityManager): Promise<T> {
        const item = await manager.getRepository(PackingItem).findOne({where: {id: itemId}, lock: {mode: 'pessimistic_write'}});
        const repo = manager.getRepository(PackingAssignment);
        const existing = await repo.findOneBy({item: {id: itemId}, profile: {id: profileId}});
        const count = await repo.countBy({item: {id: itemId}});
        return action(manager, item, existing, count);
    }
    return AppDataSource.transaction('READ COMMITTED', readLocked);
}

/** Insert a controller-approved assignment. TypeORM reports missing foreign records as DB errors. */
export async function assignPackingItem(itemId: string, profileId: string, manager: EntityManager = AppDataSource.manager): Promise<void> {
    const item = await manager.getRepository(PackingItem).findOneByOrFail({id: itemId});
    const repo = manager.getRepository(PackingAssignment);
    await repo.save(repo.create({item: {id: itemId}, profile: {id: profileId}, entity: {id: item.entityId}}));
}

export async function unassignPackingItem(itemId: string, profileId: string, manager: EntityManager = AppDataSource.manager) {
    const result = await manager.getRepository(PackingAssignment).delete({item: {id: itemId}, profile: {id: profileId}});
    return result.affected ?? 0;
}

export async function getPackingAssignments(listId: string, profileId: string) {
    const rows = await AppDataSource.getRepository(PackingAssignment).findBy({
        entity: {id: listId},
        profile: {id: profileId},
    });
    return rows.map(r => r.itemId);
}

export async function getPackingItemAssignees(listId: string) {
    const rows = await AppDataSource.getRepository(PackingAssignment).find({
        where: {entity: {id: listId}},
        relations: {
            profile: true
        }
    });
    const map: Record<string, { id: number, profileId: string, name: string }[]> = {};
    for (const r of rows) {
        const name = r.profile.name || '—';
        if (!map[r.itemId]) map[r.itemId] = [];
        map[r.itemId].push({
            id: r.id,
            profileId: r.profileId,
            name
        });
    }
    return map;
}

export async function getPackingAssignmentById(assignId: number, manager: EntityManager = AppDataSource.manager) {
    return await manager.getRepository(PackingAssignment).findOne({
        where: {id: assignId},
        relations: {
            item: true
        }
    });
}

export async function deletePackingAssignment(assignId: string, manager: EntityManager = AppDataSource.manager) {
    await manager.getRepository(PackingAssignment).delete(assignId);
}

export async function togglePackingItemRequiredByAll(itemId: string, flag: boolean) {
    await AppDataSource.getRepository(PackingItem).update(itemId, {requiredByAll: flag});
}


/**
 * Serialize root property writes with relinking by locking the same root row. Transaction and
 * repository details stay in the DBAL; the controller validates existence and the parent snapshot
 * before calling updatePackingListProperties with this transaction's manager.
 */
export async function withPackingListLock<T>(id: string, action: (manager: EntityManager, current: PackingList | null) => Promise<T>): Promise<T> {
    async function readLocked(manager: EntityManager): Promise<T> {
        const current = await manager.getRepository(PackingList).findOne({where: {id}, lock: {mode: 'pessimistic_write'}});
        return action(manager, current);
    }
    return AppDataSource.transaction('READ COMMITTED', readLocked);
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

/** Return only persistence evidence used by the controller's admission decision. */
export async function getPackingEventRegistration(manager: EntityManager, eventId: string, profileId: string): Promise<EventRegistration | null> {
    return manager.getRepository(EventRegistration).findOne({
        where: {event: {id: eventId}, profile: {id: profileId}}, select: {id: true},
    });
}

/** Load ordered items and their assignments without exposing the repositories to a DTO projector. */
export async function getPackingSnapshotRows(manager: EntityManager, listId: string) {
    const items = await manager.getRepository(PackingItem).find({where: {entity: {id: listId}}, order: {pos: 'ASC', id: 'ASC'}});
    const assignments = await manager.getRepository(PackingAssignment).find({
        where: {entity: {id: listId}}, relations: {profile: true}, order: {id: 'ASC'},
    });
    return {items, assignments};
}

/** Acquire the item after the owning root/parent locks, then return assignment evidence to the controller. */
export async function getLockedPackingAssignment(manager: EntityManager, itemId: string, profileId: string) {
    const item = await manager.getRepository(PackingItem).findOne({where: {id: itemId}, lock: {mode: 'pessimistic_write'}});
    const repository = manager.getRepository(PackingAssignment);
    const existing = await repository.findOneBy({item: {id: itemId}, profile: {id: profileId}});
    const count = await repository.countBy({item: {id: itemId}});
    return {item, existing, count};
}

/** Lock a selected parent before creation; the controller evaluates eligibility within this transaction. */
export async function withPackingCreationTransaction<T>(eventId: string | null, action: (manager: EntityManager, event: Event | null) => Promise<T>): Promise<T> {
    async function createLocked(manager: EntityManager): Promise<T> {
        const event = eventId ? await manager.getRepository(Event).findOne({where: {id: eventId}, lock: {mode: 'pessimistic_write'}}) : null;
        return action(manager, event);
    }
    return AppDataSource.transaction('READ COMMITTED', createLocked);
}
