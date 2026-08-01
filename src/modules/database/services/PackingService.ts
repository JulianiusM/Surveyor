// TypeORM-based implementation of the packing list module
import {In} from "typeorm";
import type {Agent} from "../../../types/UtilTypes";
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
    const ids = await entityAdminService.getIdsForUser('packing', profileId);
    return await AppDataSource.getRepository(PackingList).find({
        where: [
            {
                owner: {id: profileId},
            },
            {
                id: In(ids),
            }
        ],
    });
}

export async function getPackingListByParticipant(profileId: string) {
    return await AppDataSource.getRepository(PackingList).createQueryBuilder('list')
        .whereExists(AppDataSource.getRepository(PackingAssignment)
            .createQueryBuilder("ass")
            .where("ass.entity_id = list.id")
            .andWhere("ass.profile_id = :userId", {profileId})
        ).getMany();
}

// Packing Items
export async function createPackingItem(listId: string, item: Partial<PackingItem>, agent: Agent) {
    const repo = AppDataSource.getRepository(PackingItem);
    const entity = repo.create({
        id: item.id,
        entity: {id: listId},
        title: item.title,
        description: item.description,
        maxAssignees: item.maxAssignees,
        pos: item.pos,
        ...agent
    });
    await repo.save(entity);
}

export async function addPackingItems(listId: string, items: Partial<PackingItem>[], agent: Agent) {
    if (!items.length) return;
    const repo = AppDataSource.getRepository(PackingItem);
    const entities = items.map(it => repo.create({
        id: it.id,
        entity: {id: listId},
        title: it.title,
        description: it.description,
        maxAssignees: it.maxAssignees,
        pos: it.pos,
        ...agent
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
    const items = await repo.find({where: {entity: {id: listId}}, order: {pos: 'ASC'}});

    const assignmentCounts = await getPackingAssignmentCounts(listId);
    return items.map(item => ({...item, assignedCount: assignmentCounts[item.id] || 0}));
}

export async function getPackingAssignmentCounts(listId: string) {
    const repo = AppDataSource.getRepository(PackingAssignment);
    const assignments = await repo.findBy({entity: {id: listId}});
    return assignments.reduce((map: Record<string, number>, a) => {
        map[a.item.id] = (map[a.item.id] || 0) + 1;
        return map;
    }, {});
}

export async function getLastPackingItemNumber(listId: string): Promise<number> {
    return (await AppDataSource.getRepository(PackingItem).maximum("pos", {entity: {id: listId},})) ?? 0;
}

// Assignments
export async function assignPackingItem(itemId: string, profileId: string) {
    const itemRepo = AppDataSource.getRepository(PackingItem);
    const item = await itemRepo.findOneBy({id: itemId});
    if (!item) return;
    const repo = AppDataSource.getRepository(PackingAssignment);
    const exists = await repo.findOneBy({item: {id: itemId}, profile: {id: profileId}});
    if (!exists) {
        await repo.save(repo.create({
            item: {id: itemId},
            profile: {id: profileId},
            entity: {id: item.entity.id}
        }));
    }
}

export async function unassignPackingItemUser(itemId: string, profileId: string) {
    await AppDataSource.getRepository(PackingAssignment).delete({item: {id: itemId}, profile: {id: profileId}});
}

export async function getPackingAssignments(listId: string, profileId: string) {
    const rows = await AppDataSource.getRepository(PackingAssignment).findBy({
        entity: {id: listId},
        profile: {id: profileId},
    });
    return rows.map(r => r.item.id);
}

export async function getPackingItemAssignees(listId: string) {
    const rows = await AppDataSource.getRepository(PackingAssignment).find({
        where: {entity: {id: listId}},
        relations: {
            profile: true
        }
    });
    const map: Record<string, any[]> = {};
    for (const r of rows) {
        const name = r.profile.name || '—';
        if (!map[r.item.id]) map[r.item.id] = [];
        map[r.item.id].push({
            id: r.id,
            user_id: r.profile.userId,
            guest_id: r.profile.guestId,
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

