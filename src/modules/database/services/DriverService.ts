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

// src/modules/database/driversService.ts
import {DeepPartial, EntityNotFoundError, In} from "typeorm";
import type {DriversItemAssignee, EnrichedDriversItem} from "../../../types/DriversTypes";
import {generateUniqueId} from '../../lib/util';
import {AppDataSource} from '../dataSource';
import {DriversAssignment} from '../entities/drivers/DriversAssignment';
import {DriversItem} from '../entities/drivers/DriversItem';
import {DriversList} from '../entities/drivers/DriversList';
import * as entityAdminService from "./EntityAdminService";

export async function createDriversList(
    ownerId: string,
    title: string,
    desc: string,
    eventId?: string,
    headerImg?: string | null,
    listId: string = generateUniqueId(),
): Promise<string> {
    const repo = AppDataSource.getRepository(DriversList);
    const creator: DeepPartial<DriversList> = {
        id: listId,
        owner: {id: ownerId},
        title,
        description: desc,
        headerImg,
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
    return await AppDataSource.getRepository(DriversList).findOne({
        where: {id: listId}, relations: {
            event: true
        }
    });
}

export async function getDriversListByProfileId(profileId: string): Promise<DriversList[]> {
    return await AppDataSource.getRepository(DriversList).find({where: {owner: {id: profileId}}});
}

export async function updateDriversListDescription(listId: string, description: string): Promise<void> {
    await AppDataSource.getRepository(DriversList).update({id: listId}, {description});
}

export async function updateHeaderImage(listId: string, headerImg?: string | null) {
    await AppDataSource.getRepository(DriversList).update(listId, {headerImg});
}

export async function getManagedListsForProfile(profileId: string) {
    const ids = await entityAdminService.getIds('drivers', profileId);
    return await AppDataSource.getRepository(DriversList).find({
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

export async function getDriversListByParticipant(profileId: string) {
    return await AppDataSource.getRepository(DriversList).createQueryBuilder('list')
        .whereExists(AppDataSource.getRepository(DriversAssignment)
            .createQueryBuilder("ass")
            .where("ass.entity_id = list.id")
            .andWhere("ass.profile_id = :userId", {userId: profileId})
        ).andWhereExists(AppDataSource.getRepository(DriversItem)
            .createQueryBuilder("item")
            .where("item.entity_id = list.id")
            .andWhere("item.profile_id = :userId", {userId: profileId})
        ).getMany();
}

// Drivers Items

export async function createDriversItem(listId: string, profileId: string, item: Partial<DriversItem>) {
    const repo = AppDataSource.getRepository(DriversItem);
    const list = await AppDataSource.getRepository(DriversList).findOneByOrFail({id: listId});
    const entity = repo.create({...item, entity: list, profile: {id: profileId}});
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
        orders.map((o) => repo.update({id: o.itemId, entity: {id: listId}}, {pos: o.position}))
    );
}

export async function getDriversItems(listId: string): Promise<EnrichedDriversItem[]> {
    const repo = AppDataSource.getRepository(DriversItem);

    const entities = await repo.find({
        where: {entity: {id: listId}},
        relations: {
            profile: true
        },
        loadRelationIds: {relations: ['assignments']}, // get IDs, not full rows
        order: {pos: 'ASC'},
    });

    // `driversAssignments` is now an array of IDs — use its length
    return entities.map((item) => {
        const assignedCount = item.assignments?.length ?? 0;

        const driverName = item.profile?.name;

        return {
            ...item,
            assignedCount,
            driverName,
        };
    });
}

export async function getDriversItemById(itemId: string): Promise<EnrichedDriversItem> {
    const repo = AppDataSource.getRepository(DriversItem);

    const {entities, raw} = await repo
        .createQueryBuilder("pi")
        .leftJoinAndSelect("pi.profile", "p")
        .addSelect((qb) =>
                qb
                    .select("COUNT(*)")
                    .from("drivers_assignments", "da")
                    .where("da.item_id = pi.id")
            , "pi_assignedCount")
        .where("pi.id = :itemId", {itemId})
        .getRawAndEntities();

    if (entities.length === 0) {
        throw new EntityNotFoundError(DriversItem, `pi.id = ${itemId}`);
    }

    const item = entities[0] as DriversItem & { assignedCount: number | null };
    item.assignedCount = raw[0] ? Number(raw[0].pi_assignedCount) : null;

    const assignedCount = item.assignedCount ?? 0;

    return {
        ...item,
        assignedCount,
        driverName: item.profile.name,
    };
}

export async function getDriversAssignmentCounts(
    listId: string
): Promise<Record<string, number>> {
    const rows = await AppDataSource.getRepository(DriversAssignment)
        .createQueryBuilder("da")
        .select("da.item_id", "itemId")
        .addSelect("COUNT(*)", "cnt")
        .where("da.entity_id = :listId", {listId})
        .groupBy("da.item_id")
        .getRawMany<{ itemId: string; cnt: string }>();

    return Object.fromEntries(rows.map(r => [r.itemId, Number(r.cnt)]));
}


export async function getLastDriversItemNumber(listId: string): Promise<number> {
    return (await AppDataSource.getRepository(DriversItem).maximum("pos", {entity: {id: listId}})) ?? 0;
}

// Assignments
export async function assignDriversItem(
    itemId: string,
    profileId: string
): Promise<void> {
    const repo = AppDataSource.getRepository(DriversAssignment);

    const {entityId: listId} = await getDriversItemById(itemId);

    // construct the assignment entity
    const assignment = repo.create({
        item: {id: itemId},
        profile: {id: profileId},
        entity: {id: listId},
    });

    const existing = await repo.findOneBy({item: {id: itemId}, profile: {id: profileId}});
    if (existing) {
        assignment.id = existing.id;
    }

    // if you want to ignore duplicates, use upsert with conflict paths
    await repo.upsert(assignment, {
        conflictPaths: ["item", "profile", "entity"], // adjust to your unique constraint
        skipUpdateIfNoValuesChanged: true,
    });
}

export async function unassignDriversItem(itemId: string, profileId: string): Promise<void> {
    await AppDataSource.getRepository(DriversAssignment).delete({
        item: {id: itemId},
        profile: {id: profileId}
    });
}

export async function getDriversAssignmentById(assignId: number) {
    return await AppDataSource.getRepository(DriversAssignment).findOne({
        where: {id: assignId},
        relations: {
            item: true
        }
    });
}

export async function getDriversAssignments(listId: string, profileId: string): Promise<string[]> {
    const rows = await AppDataSource.getRepository(DriversAssignment).find({
        where: {entity: {id: listId}, profile: {id: profileId}},
        relations: {
            item: true
        },   // this ensures `item` is joined
        select: {
            item: {id: true}   // only fetch the id of item
        }
    });
    return rows.map(r => r.item.id);
}

export async function getDriversItemAssignees(listId: string) {
    const rows = await AppDataSource.getRepository(DriversAssignment).find({
        where: {entity: {id: listId}},  // if `list` is a relation
        relations: {
            profile: true,
            item: true
        },
    });

    return rows.reduce((map, r) => {
        const key = r.item.id;
        map[key] = map[key] || [];
        map[key].push({
            id: r.id,
            profileId: r.profile.id,
            name: r.profile.name,
        });
        return map;
    }, {} as Record<string, DriversItemAssignee[]>);
}

export async function deleteDriversAssignment(assignId: number): Promise<void> {
    await AppDataSource.getRepository(DriversAssignment).delete({id: assignId});
}
