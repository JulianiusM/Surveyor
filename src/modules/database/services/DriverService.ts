// src/modules/database/driversService.ts
import {AppDataSource} from '../dataSource';
import {generateUniqueId} from '../../lib/util';
import {DriversList} from '../entities/drivers/DriversList';
import {DriversItem} from '../entities/drivers/DriversItem';
import {DriversAssignment} from '../entities/drivers/DriversAssignment';
import {EnrichedDriversItem} from "../../../types/DriversTypes";

export async function createDriversList(
    listId: string,
    ownerId: number,
    title: string,
    desc: string,
    allowGuestAdd: boolean,
    guestManage: boolean
): Promise<void> {
    const repo = AppDataSource.getRepository(DriversList);
    const list = repo.create({id: listId, ownerId, title, description: desc, allowGuestAdd, guestManage});
    await repo.save(list);
}

export async function createDriversListTx(
    ownerId: number,
    title: string,
    desc: string,
    allowGuestAdd: boolean,
    guestManage: boolean,
    items: Array<{ id: string; title: string; description?: string; maxAssignees: number; position: number }>
): Promise<string> {
    return await AppDataSource.manager.transaction(async (m) => {
        const listId = generateUniqueId();
        const list = m.create(DriversList, {
            id: listId,
            ownerId,
            title,
            description: desc,
            allowGuestAdd,
            guestManage
        });
        await m.save(list);

        if (items.length) {
            const itemEntities = items.map((it) =>
                m.create(DriversItem, {
                    id: it.id,
                    list,
                    title: it.title,
                    description: it.description,
                    user: undefined,
                    guest: undefined,
                    maxAssignees: it.maxAssignees,
                    pos: it.position
                })
            );
            await m.save(itemEntities);
        }

        return listId;
    });
}

export async function updateDriversListTitle(listId: string, title: string): Promise<void> {
    await AppDataSource.getRepository(DriversList).update({id: listId}, {title});
}

export async function deleteDriversList(listId: string): Promise<void> {
    await AppDataSource.getRepository(DriversList).delete({id: listId});
}

export async function getDriversListById(listId: string): Promise<DriversList | null> {
    return await AppDataSource.getRepository(DriversList).findOne({where: {id: listId}});
}

export async function getDriversListByUserId(userId: number): Promise<DriversList[]> {
    return await AppDataSource.getRepository(DriversList).find({where: {ownerId: userId}});
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
    const entity = repo.create({...item, list, user: {id: userId} as any, guest: undefined});
    await repo.save(entity);
}

export async function createDriversItemGuest(listId: string, guestId: number, item: Partial<DriversItem>) {
    const repo = AppDataSource.getRepository(DriversItem);
    const list = await AppDataSource.getRepository(DriversList).findOneByOrFail({id: listId});
    const entity = repo.create({...item, list, user: undefined, guest: {id: guestId} as any});
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
        orders.map((o) => repo.update({id: o.itemId, list: {id: listId} as any}, {pos: o.position}))
    );
}

export async function getDriversItems(listId: string): Promise<EnrichedDriversItem[]> {
    const items = await AppDataSource.getRepository(DriversItem)
        .createQueryBuilder("pi")
        .leftJoinAndSelect("pi.user", "u")
        .leftJoinAndSelect("pi.guest", "g")
        .loadRelationCountAndMap("pi.assignedCount", "pi.driversAssignments")
        .where("pi.list = :listId", {listId})
        .orderBy("pi.pos")
        .getMany();

    return items.map((item) => ({
        ...item,
        assignedCount: (item as any).assignedCount ?? 0,
        driverName: item.user?.username ?? item.guest?.username ?? "—",
    }));
}

export async function getDriversItemById(itemId: string): Promise<EnrichedDriversItem> {
    const item = await AppDataSource.getRepository(DriversItem)
        .createQueryBuilder('pi')
        .leftJoinAndSelect('pi.user', 'u')
        .leftJoinAndSelect('pi.guest', 'g')
        .loadRelationCountAndMap('pi.assignedCount', 'pi.driversAssignments')
        .where('pi.id = :itemId', {itemId})
        .getOneOrFail();

    return {
        ...item,
        assignedCount: (item as any).assignedCount || 0,
        driverName: item.user?.username || item.guest?.username || '—',
    };
}

export async function getDriversAssignmentCounts(listId: string): Promise<Record<string, number>> {
    const rows = await AppDataSource.getRepository(DriversAssignment)
        .createQueryBuilder('da')
        .select('da.itemId', 'itemId')
        .addSelect('COUNT(*)', 'cnt')
        .where('da.list = :listId', {listId})
        .groupBy('da.itemId')
        .getRawMany<{ itemId: string; cnt: string }>();
    return rows.reduce((m, r) => ({...m, [r.itemId]: parseInt(r.cnt)}), {});
}

export async function getLastDriversItemNumber(listId: string): Promise<number | null> {
    const result = await AppDataSource
        .getRepository(DriversItem)
        .createQueryBuilder('item')
        .select('MAX(item.pos)', 'max')
        .where('item.list_id = :listId', {listId})
        .getRawOne();

    return result?.max !== null ? Number(result.max) : null;
}

// Assignments

export async function assignDriversItemToUser(itemId: string, userId: number): Promise<void> {
    await AppDataSource.getRepository(DriversAssignment)
        .createQueryBuilder()
        .insert()
        .values([{
            item: {id: itemId},
            user: {id: userId},
            list: {id: (await getDriversItemById(itemId)).list.id}
        }])
        .orIgnore()
        .execute();
}

export async function unassignDriversItemUser(itemId: string, userId: number): Promise<void> {
    await AppDataSource.getRepository(DriversAssignment)
        .delete({item: {id: itemId} as any, user: {id: userId} as any});
}

export async function assignDriversItemToGuest(itemId: string, guestId: number): Promise<void> {
    await AppDataSource.getRepository(DriversAssignment)
        .createQueryBuilder()
        .insert()
        .values([{
            item: {id: itemId} as any,
            guest: {id: guestId} as any,
            list: {id: (await getDriversItemById(itemId)).list.id} as any
        }])
        .orIgnore()
        .execute();
}

export async function unassignDriversItemGuest(itemId: string, guestId: number): Promise<void> {
    await AppDataSource.getRepository(DriversAssignment)
        .delete({item: {id: itemId} as any, guest: {id: guestId} as any});
}

export async function getDriversAssignmentsForUser(listId: string, userId: number): Promise<string[]> {
    const rows = await AppDataSource.getRepository(DriversAssignment).find({
        where: {list: {id: listId} as any, user: {id: userId} as any},
        select: ['item']
    });
    return rows.map(r => r.item.id);
}

export async function getDriversAssignmentsForGuest(listId: string, guestId: number): Promise<string[]> {
    const rows = await AppDataSource.getRepository(DriversAssignment).find({
        where: {list: {id: listId} as any, guest: {id: guestId} as any},
        select: ['item']
    });
    return rows.map(r => r.item.id);
}

export async function getDriversItemAssignees(listId: string): Promise<Record<string, Array<{
    id: string;
    userId?: number;
    guestId?: number;
    name: string
}>>> {
    const rows = await AppDataSource.getRepository(DriversAssignment)
        .createQueryBuilder('pa')
        .leftJoinAndSelect('pa.user', 'u')
        .leftJoinAndSelect('pa.guest', 'g')
        .where('pa.list = :listId', {listId})
        .getMany();

    return rows.reduce((map, r) => {
        const key = r.item.id;
        (map[key] = map[key] || []).push({
            id: r.id,
            userId: r.user?.id,
            guestId: r.guest?.id,
            name: r.user?.username ?? r.guest?.username ?? '—'
        });
        return map;
    }, {} as Record<string, any[]>);
}

export async function deleteDriversAssignment(assignId: number): Promise<void> {
    await AppDataSource.getRepository(DriversAssignment).delete({id: assignId});
}

export async function updateDriversFlags(listId: string, allowAdd: boolean, guestManage: boolean): Promise<void> {
    await AppDataSource.getRepository(DriversList).update({id: listId}, {allowGuestAdd: allowAdd, guestManage});
}
