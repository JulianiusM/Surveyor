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

export async function createPackingListTx(ownerId: string, title: string, desc: string, items: Partial<PackingItem>[], eventId?: string, headerImg?: string | null,) {
    return await AppDataSource.transaction(async (manager) => {
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
    });
}

export async function updatePackingListTitle(listId: string, title: string) {
    await AppDataSource.getRepository(PackingList).update(listId, {title});
}

export async function deletePackingList(listId: string) {
    await AppDataSource.getRepository(PackingList).delete(listId);
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
    await AppDataSource.getRepository(PackingList).update(listId, {description});
}

export async function updateHeaderImage(listId: string, headerImg?: string | null) {
    await AppDataSource.getRepository(PackingList).update(listId, {headerImg});
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
export async function createPackingItem(listId: string, item: Partial<PackingItem>, profileId: string) {
    const repo = AppDataSource.getRepository(PackingItem);
    const entity = repo.create({
        id: item.id,
        entity: {id: listId},
        title: item.title,
        description: item.description,
        maxAssignees: item.maxAssignees,
        pos: item.pos,
        profile: {id: profileId},
    });
    await repo.save(entity);
}

export async function addPackingItems(listId: string, items: Partial<PackingItem>[], profileId: string) {
    if (!items.length) return;
    const repo = AppDataSource.getRepository(PackingItem);
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

export async function getPackingItemById(itemId: string) {
    return await AppDataSource.getRepository(PackingItem).findOneBy({id: itemId});
}

export async function updatePackingItem(itemId: string, fields: Partial<PackingItem>) {
    const repo = AppDataSource.getRepository(PackingItem);

    // Only include fields that are not undefined
    const updateData: Partial<PackingItem> = {};
    if (fields.title !== undefined) updateData.title = fields.title;
    if (fields.description !== undefined) updateData.description = fields.description;
    if (fields.maxAssignees !== undefined) updateData.maxAssignees = fields.maxAssignees;
    if (fields.pos !== undefined) updateData.pos = fields.pos;

    if (Object.keys(updateData).length === 0) return;

    const result = await repo.update(itemId, updateData);
    return result.affected === 1;
}


export async function deletePackingItem(itemId: string) {
    await AppDataSource.getRepository(PackingItem).delete(itemId);
}

export async function reorderPackingItems(listId: string, orders: any[]) {
    const repo = AppDataSource.getRepository(PackingItem);
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

export async function unassignPackingItem(itemId: string, profileId: string) {
    await AppDataSource.getRepository(PackingAssignment).delete({item: {id: itemId}, profile: {id: profileId}});
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

export async function getPackingAssignmentById(assignId: number) {
    return await AppDataSource.getRepository(PackingAssignment).findOne({
        where: {id: assignId},
        relations: {
            item: true
        }
    });
}

export async function deletePackingAssignment(assignId: string) {
    await AppDataSource.getRepository(PackingAssignment).delete(assignId);
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
