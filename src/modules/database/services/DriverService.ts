// src/modules/database/driversService.ts
import {AppDataSource} from '../dataSource';
import {generateUniqueId} from '../../lib/util';
import {DriversList} from '../entities/drivers/DriversList';
import {DriversItem} from '../entities/drivers/DriversItem';
import {DriversAssignment} from '../entities/drivers/DriversAssignment';
import type {DriversItemAssignee, EnrichedDriversItem} from "../../../types/DriversTypes";
import {DeepPartial} from "typeorm";

export async function createDriversList(
    ownerId: number,
    title: string,
    desc: string,
    allowGuestAdd: boolean,
    guestManage: boolean,
    eventId?: string,
    listId: string = generateUniqueId(),
): Promise<string> {
    const repo = AppDataSource.getRepository(DriversList);
    const creator: DeepPartial<DriversList> = {
        id: listId,
        owner: {id: ownerId},
        title,
        description: desc,
        allowGuestAdd,
        guestManage
    };
    if (eventId) creator.event = {id: eventId};
    const list = repo.create(creator);
    await repo.save(list);
    return listId;
}

export async function updateDriversListTitle(listId: string, title: string): Promise<void> {
    await AppDataSource.getRepository(DriversList).update({id: listId}, {title});
}

export async function deleteDriversList(listId: string): Promise<void> {
    await AppDataSource.getRepository(DriversList).delete({id: listId});
}

export async function getDriversListById(listId: string): Promise<DriversList | null> {
    return await AppDataSource.getRepository(DriversList).findOne({where: {id: listId}, relations: ["event"]});
}

export async function getDriversListByUserId(userId: number): Promise<DriversList[]> {
    return await AppDataSource.getRepository(DriversList).find({where: {owner: {id: userId}}});
}

export async function updateDriversListAllow(listId: string, allow: boolean): Promise<void> {
    await AppDataSource.getRepository(DriversList).update({id: listId}, {allowGuestAdd: allow});
}

export async function updateDriversListGuestManage(listId: string, flag: boolean): Promise<void> {
    await AppDataSource.getRepository(DriversList).update({id: listId}, {guestManage: flag});
}

export async function updateDriversListDescription(listId: string, description: string): Promise<void> {
    await AppDataSource.getRepository(DriversList).update({id: listId}, {description});
}

// Drivers Items

export async function createDriversItemUser(listId: string, userId: number, item: Partial<DriversItem>) {
    const repo = AppDataSource.getRepository(DriversItem);
    const list = await AppDataSource.getRepository(DriversList).findOneByOrFail({id: listId});
    const entity = repo.create({...item, list, user: {id: userId}});
    await repo.save(entity);
}

export async function createDriversItemGuest(listId: string, guestId: number, item: Partial<DriversItem>) {
    const repo = AppDataSource.getRepository(DriversItem);
    const list = await AppDataSource.getRepository(DriversList).findOneByOrFail({id: listId});
    const entity = repo.create({...item, list, guest: {id: guestId}});
    await repo.save(entity);
}

export async function updateDriversItem(
    itemId: string,
    fields: Partial<Pick<DriversItem, 'title' | 'description' | 'maxAssignees' | 'pos'>>
): Promise<boolean> {
    if (!Object.keys(fields).length) return false;

    const result = await AppDataSource.getRepository(DriversItem).update(
        {id: itemId},
        fields
    );

    return result.affected === 1;
}

export async function deleteDriversItem(itemId: string): Promise<void> {
    await AppDataSource.getRepository(DriversItem).delete({id: itemId});
}

export async function reorderDriversItems(listId: string, orders: Array<{ itemId: string; position: number }>) {
    const repo = AppDataSource.getRepository(DriversItem);
    await Promise.all(
        orders.map((o) => repo.update({id: o.itemId, list: {id: listId}}, {pos: o.position}))
    );
}

export async function getDriversItems(listId: string): Promise<EnrichedDriversItem[]> {
    const repo = AppDataSource.getRepository(DriversItem);

    const entities = await repo.find({
        where: {list: {id: listId}},
        relations: ['user', 'guest'],             // join user & guest
        loadRelationIds: {relations: ['driversAssignments']}, // get IDs, not full rows
        order: {pos: 'ASC'},
    });

    // `driversAssignments` is now an array of IDs — use its length
    return entities.map((item) => {
        const relIds = (item as any).driversAssignments as unknown[] | undefined;
        const assignedCount = Array.isArray(relIds) ? relIds.length : 0;

        const driverName =
            item.user?.name ??
            item.user?.username ??
            item.guest?.username ??
            '—';

        return {
            ...item,
            assignedCount,
            driverName,
        };
    });
}

export async function getDriversItemById(itemId: string): Promise<EnrichedDriversItem> {
    const repo = AppDataSource.getRepository(DriversItem);

    const item = await repo
        .createQueryBuilder("pi")
        .leftJoinAndSelect("pi.user", "u")
        .leftJoinAndSelect("pi.guest", "g")
        .loadRelationCountAndMap("pi.assignedCount", "pi.driversAssignments")
        .where("pi.id = :itemId", {itemId})
        .getOneOrFail() as DriversItem & { assignedCount: number | null };

    const assignedCount = item.assignedCount ?? 0;

    return {
        ...item,
        assignedCount,
        driverName:
            item.user?.name ??
            item.user?.username ??
            item.guest?.username ??
            "—",
    };
}

export async function getDriversAssignmentCounts(
    listId: string
): Promise<Record<string, number>> {
    const rows = await AppDataSource.getRepository(DriversAssignment)
        .createQueryBuilder("da")
        .select("da.item_id", "itemId")
        .addSelect("COUNT(*)", "cnt")
        .where("da.list = :listId", {listId})
        .groupBy("da.item_id")
        .getRawMany<{ itemId: string; cnt: string }>();

    return Object.fromEntries(rows.map(r => [r.itemId, Number(r.cnt)]));
}


export async function getLastDriversItemNumber(listId: string): Promise<number> {
    return await AppDataSource.getRepository(DriversItem).maximum("pos", {list: {id: listId}}) ?? 0;
}

// Assignments
export async function assignDriversItemToUser(
    itemId: string,
    userId: number
): Promise<void> {
    const repo = AppDataSource.getRepository(DriversAssignment);

    const {listId} = await getDriversItemById(itemId);

    // construct the assignment entity
    const assignment = repo.create({
        item: {id: itemId},
        user: {id: userId},
        list: {id: listId},
    });

    const existing = await repo.findOneBy({item: {id: itemId}, user: {id: userId}});
    if (existing) {
        assignment.id = existing.id;
    }

    // if you want to ignore duplicates, use upsert with conflict paths
    await repo.upsert(assignment, {
        conflictPaths: ["item", "user", "list"], // adjust to your unique constraint
        skipUpdateIfNoValuesChanged: true,
    });
}

export async function unassignDriversItemUser(itemId: string, userId: number): Promise<void> {
    await AppDataSource.getRepository(DriversAssignment).delete({item: {id: itemId}, user: {id: userId}});
}

export async function assignDriversItemToGuest(itemId: string, guestId: number): Promise<void> {
    const repo = AppDataSource.getRepository(DriversAssignment);

    // you still need the listId from the item
    const {listId} = await getDriversItemById(itemId);

    // construct the assignment entity
    const assignment = repo.create({
        item: {id: itemId},
        guest: {id: guestId},
        list: {id: listId},
    });

    const existing = await repo.findOneBy({item: {id: itemId}, guest: {id: guestId}});
    if (existing) {
        assignment.id = existing.id;
    }

    // if you want to ignore duplicates, use upsert with conflict paths
    await repo.upsert(assignment, {
        conflictPaths: ["item", "guest", "list"], // adjust to your unique constraint
        skipUpdateIfNoValuesChanged: true,
    });
}

export async function unassignDriversItemGuest(itemId: string, guestId: number): Promise<void> {
    await AppDataSource.getRepository(DriversAssignment).delete({item: {id: itemId}, guest: {id: guestId}});
}

export async function getDriversAssignmentsForUser(listId: string, userId: number): Promise<string[]> {
    const rows = await AppDataSource.getRepository(DriversAssignment).find({
        where: {list: {id: listId}, user: {id: userId}},
        relations: ['item'],   // this ensures `item` is joined
        select: {
            item: {id: true}   // only fetch the id of item
        }
    });
    return rows.map(r => r.item.id);
}

export async function getDriversAssignmentsForGuest(listId: string, guestId: number): Promise<string[]> {
    const rows = await AppDataSource.getRepository(DriversAssignment).find({
        where: {list: {id: listId}, guest: {id: guestId}},
        relations: ['item'],   // this ensures `item` is joined
        select: {
            item: {id: true}   // only fetch the id of item
        }
    });
    return rows.map(r => r.item.id);
}

export async function getDriversItemAssignees(listId: string) {
    const rows = await AppDataSource.getRepository(DriversAssignment).find({
        where: {list: {id: listId}},  // if `list` is a relation
        relations: ['user', 'guest', 'item'],
    });

    return rows.reduce((map, r) => {
        const key = r.item.id;
        (map[key] = map[key] || []).push({
            id: r.id,
            userId: r.user?.id,
            guestId: r.guest?.id,
            name: r.user?.name ?? r.user?.username ?? r.guest?.username ?? '—'
        });
        return map;
    }, {} as Record<string, DriversItemAssignee[]>);
}

export async function deleteDriversAssignment(assignId: number): Promise<void> {
    await AppDataSource.getRepository(DriversAssignment).delete({id: assignId});
}

export async function updateDriversFlags(listId: string, allowAdd: boolean, guestManage: boolean): Promise<void> {
    await AppDataSource.getRepository(DriversList).update({id: listId}, {allowGuestAdd: allowAdd, guestManage});
}
