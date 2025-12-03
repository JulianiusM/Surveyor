// TypeORM-based implementation of the packing list module
import {AppDataSource} from '../dataSource';
import {PackingList} from '../entities/packing/PackingList';
import {PackingItem} from '../entities/packing/PackingItem';
import {PackingAssignment} from '../entities/packing/PackingAssignment';
import {generateUniqueId} from '../../lib/util';
import * as entityAdminService from "./EntityAdminService";
import {In} from "typeorm";

// Packing Lists
export async function createPackingList(listId: string, ownerId: number, title: string, desc: string, eventId?: string,) {
    const repo = AppDataSource.getRepository(PackingList);
    const list = repo.create({
        id: listId,
        owner: {id: ownerId},
        title,
        description: desc,
        ...(eventId !== undefined ? {event: {id: eventId}} : {}),
    });
    await repo.save(list);
}

export async function createPackingListTx(ownerId: number, title: string, desc: string, items: Partial<PackingItem>[], eventId?: string,) {
    return await AppDataSource.transaction(async (manager) => {
        const listId = generateUniqueId();
        const listRepo = manager.getRepository(PackingList);
        const itemRepo = manager.getRepository(PackingItem);

        const list = listRepo.create({
            id: listId,
            owner: {id: ownerId},
            title,
            description: desc,
            ...(eventId !== undefined ? {event: {id: eventId}} : {}),
        });
        await listRepo.save(list);

        if (items.length) {
            const itemEntities = items.map(it => itemRepo.create({
                id: it.id,
                list: {id: listId},
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
    return await AppDataSource.getRepository(PackingList).findOne({where: {id: listId}, relations: ["event"]});
}

export async function getPackingListByUserId(userId: number) {
    return await AppDataSource.getRepository(PackingList).findBy({owner: {id: userId}});
}

export async function updatePackingListDescription(listId: string, description: string) {
    await AppDataSource.getRepository(PackingList).update(listId, {description});
}

export async function getManagedListsForUser(userId: number) {
    const ids = await entityAdminService.getIdsForUser('packing', userId);
    const today = new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'
    return await AppDataSource.getRepository(PackingList).find({
        where: [
            {
                owner: {id: userId},
            },
            {
                id: In(ids),
            }
        ],
    });
}

// Packing Items
export async function createPackingItem(listId: string, item: Partial<PackingItem>) {
    const repo = AppDataSource.getRepository(PackingItem);
    const entity = repo.create({
        id: item.id,
        list: {id: listId},
        title: item.title,
        description: item.description,
        maxAssignees: item.maxAssignees,
        pos: item.pos
    });
    await repo.save(entity);
}

export async function addPackingItems(listId: string, items: Partial<PackingItem>[]) {
    if (!items.length) return;
    const repo = AppDataSource.getRepository(PackingItem);
    const entities = items.map(it => repo.create({
        id: it.id,
        list: {id: listId},
        title: it.title,
        description: it.description,
        maxAssignees: it.maxAssignees,
        pos: it.pos
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
        await repo.update({id: order.itemId, list: {id: listId}}, {pos: order.position});
    }
}

export async function getPackingItems(listId: string): Promise<(PackingItem & { assignedCount: number })[]> {
    const repo = AppDataSource.getRepository(PackingItem);
    const items = await repo.find({where: {list: {id: listId}}, order: {pos: 'ASC'}});

    const assignmentCounts = await getPackingAssignmentCounts(listId);
    return items.map(item => ({...item, assignedCount: assignmentCounts[item.id] || 0}));
}

export async function getPackingAssignmentCounts(listId: string) {
    const repo = AppDataSource.getRepository(PackingAssignment);
    const assignments = await repo.findBy({list: {id: listId}});
    return assignments.reduce((map: Record<string, number>, a) => {
        map[a.itemId] = (map[a.itemId] || 0) + 1;
        return map;
    }, {});
}

export async function getLastPackingItemNumber(listId: string): Promise<number> {
    return await AppDataSource.getRepository(PackingItem).maximum("pos", {list: {id: listId},}) ?? 0;
}

// Assignments
export async function assignPackingItemToUser(itemId: string, userId: number) {
    const itemRepo = AppDataSource.getRepository(PackingItem);
    const item = await itemRepo.findOneBy({id: itemId});
    if (!item) return;
    const repo = AppDataSource.getRepository(PackingAssignment);
    const exists = await repo.findOneBy({item: {id: itemId}, user: {id: userId}});
    if (!exists) {
        await repo.save(repo.create({item: {id: itemId}, user: {id: userId}, list: {id: item.listId}}));
    }
}

export async function unassignPackingItemUser(itemId: string, userId: number) {
    await AppDataSource.getRepository(PackingAssignment).delete({item: {id: itemId}, user: {id: userId}});
}

export async function assignPackingItemToGuest(itemId: string, guestId: number) {
    const itemRepo = AppDataSource.getRepository(PackingItem);
    const item = await itemRepo.findOneBy({id: itemId});
    if (!item) return;
    const repo = AppDataSource.getRepository(PackingAssignment);
    const exists = await repo.findOneBy({item: {id: itemId}, guest: {id: guestId}});
    if (!exists) {
        await repo.save(repo.create({item: {id: itemId}, guest: {id: guestId}, list: {id: item.listId}}));
    }
}

export async function unassignPackingItemGuest(itemId: string, guestId: number) {
    await AppDataSource.getRepository(PackingAssignment).delete({item: {id: itemId}, guest: {id: guestId}});
}

export async function getPackingAssignmentsForUser(listId: string, userId: number) {
    const rows = await AppDataSource.getRepository(PackingAssignment).findBy({list: {id: listId}, user: {id: userId}});
    return rows.map(r => r.itemId);
}

export async function getPackingAssignmentsForGuest(listId: string, guestId: number) {
    const rows = await AppDataSource.getRepository(PackingAssignment).findBy({
        list: {id: listId},
        guest: {id: guestId}
    });
    return rows.map(r => r.itemId);
}

export async function getPackingItemAssignees(listId: string) {
    const rows = await AppDataSource.getRepository(PackingAssignment).find({
        where: {list: {id: listId}},
        relations: ['user', 'guest']
    });
    const map: Record<string, any[]> = {};
    for (const r of rows) {
        const name = r.user?.name || r.user?.username || r.guest?.username || '—';
        if (!map[r.itemId]) map[r.itemId] = [];
        map[r.itemId].push({
            id: r.id,
            user_id: r.userId,
            guest_id: r.guestId,
            name
        });
    }
    return map;
}

export async function getPackingAssignmentById(assignId: number) {
    return await AppDataSource.getRepository(PackingAssignment).findOne({
        where: {id: assignId},
        relations: ['item']
    })
}

export async function deletePackingAssignment(assignId: string) {
    await AppDataSource.getRepository(PackingAssignment).delete(assignId);
}

export async function togglePackingItemRequiredByAll(itemId: string, flag: boolean) {
    await AppDataSource.getRepository(PackingItem).update(itemId, {requiredByAll: flag});
}

