// TypeORM-based implementation of the packing list module
import {AppDataSource} from '../dataSource';
import {PackingList} from '../entities/packing/PackingList';
import {PackingItem} from '../entities/packing/PackingItem';
import {PackingAssignment} from '../entities/packing/PackingAssignment';
import {generateUniqueId} from '../../lib/util';

// Packing Lists
export async function createPackingList(listId: string, ownerId: number, title: string, desc: string, allowGuestAdd: boolean, guestManage: boolean) {
    const repo = AppDataSource.getRepository(PackingList);
    const list = repo.create({
        id: listId,
        ownerId,
        title,
        description: desc,
        allowGuestAdd,
        guestManage
    });
    await repo.save(list);
}

export async function createPackingListTx(ownerId: number, title: string, desc: string, allowGuestAdd: boolean, guestManage: boolean, items: Partial<PackingItem>[]) {
    return await AppDataSource.transaction(async (manager) => {
        const listId = generateUniqueId();
        const listRepo = manager.getRepository(PackingList);
        const itemRepo = manager.getRepository(PackingItem);

        const list = listRepo.create({
            id: listId,
            ownerId,
            title,
            description: desc,
            allowGuestAdd,
            guestManage
        });
        await listRepo.save(list);

        if (items.length) {
            const itemEntities = items.map(it => itemRepo.create({
                id: it.id,
                listId,
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
    return await AppDataSource.getRepository(PackingList).findOneBy({id: listId});
}

export async function getPackingListByUserId(userId: number) {
    return await AppDataSource.getRepository(PackingList).findBy({ownerId: userId});
}

export async function updatePackingListAllow(listId: string, allow: boolean) {
    await AppDataSource.getRepository(PackingList).update(listId, {allowGuestAdd: allow});
}

export async function updatePackingListGuestManage(listId: string, flag: boolean) {
    await AppDataSource.getRepository(PackingList).update(listId, {guestManage: flag});
}

export async function updatePackingListDescription(listId: string, description: string) {
    await AppDataSource.getRepository(PackingList).update(listId, {description});
}

// Packing Items
export async function createPackingItem(listId: string, item: Partial<PackingItem>) {
    const repo = AppDataSource.getRepository(PackingItem);
    const entity = repo.create({
        id: item.id,
        listId,
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
        listId,
        title: it.title,
        description: it.description,
        maxAssignees: it.maxAssignees,
        pos: it.pos
    }));
    await repo.save(entities);
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
        await repo.update({id: order.itemId, listId}, {pos: order.position});
    }
}

export async function getPackingItems(listId: string): Promise<(PackingItem & { assignedCount: number })[]> {
    const repo = AppDataSource.getRepository(PackingItem);
    const items = await repo.find({where: {listId}, order: {pos: 'ASC'}});

    const assignmentCounts = await getPackingAssignmentCounts(listId);
    return items.map(item => ({...item, assignedCount: assignmentCounts[item.id] || 0}));
}

export async function getPackingAssignmentCounts(listId: string) {
    const repo = AppDataSource.getRepository(PackingAssignment);
    const assignments = await repo.findBy({listId});
    return assignments.reduce((map: Record<string, number>, a) => {
        map[a.itemId] = (map[a.itemId] || 0) + 1;
        return map;
    }, {});
}

export async function getLastPackingItemNumber(listId: string): Promise<number> {
    return await AppDataSource.getRepository(PackingItem).maximum("pos", {listId}) ?? 0;
}

// Assignments
export async function assignPackingItemToUser(itemId: string, userId: number) {
    const itemRepo = AppDataSource.getRepository(PackingItem);
    const item = await itemRepo.findOneBy({id: itemId});
    if (!item) return;
    const repo = AppDataSource.getRepository(PackingAssignment);
    const exists = await repo.findOneBy({itemId, userId});
    if (!exists) {
        await repo.save(repo.create({itemId, userId, listId: item.listId}));
    }
}

export async function unassignPackingItemUser(itemId: string, userId: number) {
    await AppDataSource.getRepository(PackingAssignment).delete({itemId, userId});
}

export async function assignPackingItemToGuest(itemId: string, guestId: number) {
    const itemRepo = AppDataSource.getRepository(PackingItem);
    const item = await itemRepo.findOneBy({id: itemId});
    if (!item) return;
    const repo = AppDataSource.getRepository(PackingAssignment);
    const exists = await repo.findOneBy({itemId, guestId});
    if (!exists) {
        await repo.save(repo.create({itemId, guestId, listId: item.listId}));
    }
}

export async function unassignPackingItemGuest(itemId: string, guestId: number) {
    await AppDataSource.getRepository(PackingAssignment).delete({itemId, guestId});
}

export async function getPackingAssignmentsForUser(listId: string, userId: number) {
    const rows = await AppDataSource.getRepository(PackingAssignment).findBy({listId, userId});
    return rows.map(r => r.itemId);
}

export async function getPackingAssignmentsForGuest(listId: string, guestId: number) {
    const rows = await AppDataSource.getRepository(PackingAssignment).findBy({listId, guestId});
    return rows.map(r => r.itemId);
}

export async function getPackingItemAssignees(listId: string) {
    const rows = await AppDataSource.getRepository(PackingAssignment).find({
        where: {listId},
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

export async function deletePackingAssignment(assignId: string) {
    await AppDataSource.getRepository(PackingAssignment).delete(assignId);
}

export async function togglePackingItemRequiredByAll(itemId: string, flag: boolean) {
    await AppDataSource.getRepository(PackingItem).update(itemId, {requiredByAll: flag});
}

export async function updatePackingFlags(listId: string, allowAdd: boolean, guestManage: boolean) {
    await AppDataSource.getRepository(PackingList).update(listId, {
        allowGuestAdd: allowAdd,
        guestManage
    });
}
