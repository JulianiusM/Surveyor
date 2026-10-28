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

// src/backend/modules/database/driversService.ts
import {Brackets, DeepPartial, EntityNotFoundError, type EntityManager} from "typeorm";
import {getLockedListAssignment} from './ListService';
import type {BasicEntityPropertyPatch} from '../../../../types/EntityPropertyTypes';
import type {DriversItemAssignee, EnrichedDriversItem} from "../../../../types/DriversTypes";
import {generateUniqueId, groupByUuid} from '../../lib/util';
import {AppDataSource} from '../dataSource';
import {DriversAssignment} from '../entities/drivers/DriversAssignment';
import {DriversItem} from '../entities/drivers/DriversItem';
import {DriversList} from '../entities/drivers/DriversList';

import * as entityAdminService from "./EntityAdminService";

/** Persist a controller-approved root through the supplied manager. Direct
 * creation retains its existing standalone write; v1 supplies its transaction. */
export async function createDriversList(
    ownerId: string,
    title: string,
    desc: string,
    eventId?: string,
    headerImg?: string | null,
    listId: string = generateUniqueId(),
    manager: EntityManager = AppDataSource.manager,
): Promise<string> {
    const repo = manager.getRepository(DriversList);
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

/** Delete the root directly; existing foreign-key cascades retain their role. */
export async function deleteDriversList(listId: string, manager: EntityManager = AppDataSource.manager): Promise<void> {
    await manager.getRepository(DriversList).delete({id: listId});
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

/** Persist the approved header reference; file lifecycle remains outside DBAL. */
export async function updateHeaderImage(listId: string, headerImg?: string | null, manager: EntityManager = AppDataSource.manager) {
    await manager.getRepository(DriversList).update(listId, {headerImg});
}

export async function getManagedListsForProfile(profileId: string) {
    // Use the same ownership/administration predicate as personal visibility writes.
    return entityAdminService.createManagedEntityQuery(AppDataSource.getRepository(DriversList), 'drivers', profileId).getMany();
}

export async function getDriversListByParticipant(profileId: string) {
    return getDriversParticipationQuery(profileId).getMany();
}

/**
 * A profile participates by offering a ride or holding a passenger assignment.
 * Both alternatives share this one predicate for overview discovery and personal
 * visibility admission. EXISTS preserves one list row even when both roles match.
 */
export function getDriversParticipationQuery(profileId: string, manager: EntityManager = AppDataSource.manager) {
    const passenger = manager.getRepository(DriversAssignment).createQueryBuilder('ass')
        .select('1').where('ass.entity_id = list.id').andWhere('ass.profile_id = :userId');
    const driver = manager.getRepository(DriversItem).createQueryBuilder('item')
        .select('1').where('item.entity_id = list.id').andWhere('item.profile_id = :userId');
    return manager.getRepository(DriversList).createQueryBuilder('list')
        .where(new Brackets(function participationRoles(query) {
            // Group the alternatives so callers can add a target/search predicate
            // without allowing the first role to bypass that additional scope.
            // Values remain bound parameters on the root; only ORM-built SQL is composed.
            query.where(`EXISTS (${passenger.getQuery()})`).orWhere(`EXISTS (${driver.getQuery()})`);
        })).setParameter('userId', profileId);
}

// Drivers Items

/** Persist an offered ride with its admitted driver profile. Both adapters use
 * this existing relationship write and preserve the controller's stored position. */
export async function createDriversItem(listId: string, profileId: string, item: Partial<DriversItem>, manager: EntityManager = AppDataSource.manager) {
    const repo = manager.getRepository(DriversItem);
    const list = await manager.getRepository(DriversList).findOneByOrFail({id: listId});
    const entity = repo.create({...item, entity: list, profile: {id: profileId}});
    await repo.save(entity);
}

export async function updateDriversItem(
    itemId: string,
    fields: Partial<Pick<DriversItem, 'title' | 'description' | 'maxAssignees' | 'pos'>>,
    manager: EntityManager = AppDataSource.manager,
): Promise<boolean> {
    // Preserve the original sparse field write and affected-row evidence. This
    // update never removes passengers when a new maximum is below occupancy.
    if (!Object.keys(fields).length) return false;

    const result = await manager.getRepository(DriversItem).update(
        {id: itemId},
        fields
    );

    return result.affected === 1;
}

/** Remove the selected ride; database cascades remove its passenger assignments. */
export async function deleteDriversItem(itemId: string, manager: EntityManager = AppDataSource.manager): Promise<void> {
    await manager.getRepository(DriversItem).delete({id: itemId});
}

/** Preserve the scoped per-row order writes. A versioned caller supplies
 * its transaction after reviewing the complete current order in the controller. */
export async function reorderDriversItems(listId: string, orders: Array<{ itemId: string; position: number }>, manager: EntityManager = AppDataSource.manager) {
    const repo = manager.getRepository(DriversItem);
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

/** Preserve the enriched lookup and ORM missing-row diagnostic. Versioned
 * method baselines use the separate nullable snapshot evidence below. */
export async function getDriversItemById(itemId: string): Promise<EnrichedDriversItem> {
    const repo = AppDataSource.getRepository(DriversItem);

    // Driver identity comes from the profile relation; passenger occupancy comes
    // from persisted assignments, independently of the hidden historical title.
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

/** Read passenger-assignment counts per ride without loading profile rows.
 * The projection preserves raw COUNT conversion and omits rides with no rows;
 * feature controllers retain capacity and driver/passenger interpretation. */
export async function getDriversAssignmentCounts(
    listId: string
): Promise<Record<string, number>> {
    // Group only this list's stored assignment rows by their owning item.
    const rows = await AppDataSource.getRepository(DriversAssignment)
        .createQueryBuilder("da")
        .select("da.item_id", "itemId")
        .addSelect("COUNT(*)", "cnt")
        .where("da.entity_id = :listId", {listId})
        .groupBy("da.item_id")
        .getRawMany<{ itemId: string; cnt: string }>();

    // MariaDB returns COUNT as text; preserve the established numeric projection.
    return Object.fromEntries(rows.map(r => [r.itemId, Number(r.cnt)]));
}


/** Return stored order evidence without interpreting admission or driver identity. */
export async function getLastDriversItemNumber(listId: string, manager: EntityManager = AppDataSource.manager): Promise<number> {
    return (await manager.getRepository(DriversItem).maximum("pos", {entity: {id: listId}})) ?? 0;
}

/**
 * Hold the item row while the controller evaluates assignment policy. Every assignment write
 * through the controller acquires this lock, so its existing/count snapshot cannot become stale
 * before the transaction commits. Missing records remain nullable; the caller chooses the error.
 */
export async function withDriversAssignmentLock<T>(
    itemId: string, profileId: string,
    action: (manager: EntityManager, item: DriversItem | null, existing: DriversAssignment | null, count: number) => Promise<T>,
): Promise<T> {
    async function readLocked(manager: EntityManager): Promise<T> {
        // Both adapters read capacity and personal membership under the same
        // existing item lock before their shared controller decision runs.
        const {item, existing, count} = await getLockedListAssignment('drivers', manager, itemId, profileId);
        return action(manager, item, existing, count);
    }
    return AppDataSource.transaction('READ COMMITTED', readLocked);
}


/** Delete all historical memberships for this profile/ride. Direct callers ignore
 * affected-row evidence; the versioned receipt uses it inside its locked snapshot. */
export async function unassignDriversItem(itemId: string, profileId: string, manager: EntityManager = AppDataSource.manager): Promise<number> {
    const result = await manager.getRepository(DriversAssignment).delete({
        item: {id: itemId},
        profile: {id: profileId}
    });
    return result.affected ?? 0;
}

/** Read one assignment and its actual ride for the controller's root-scope check. */
export async function getDriversAssignmentById(assignId: number, manager: EntityManager = AppDataSource.manager) {
    return await manager.getRepository(DriversAssignment).findOne({
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

/** Group one list's assignment/profile display data by shared item UUID identity.
 * Preserve stored handles, profile references, names and row order for the admitted caller. */
export async function getDriversItemAssignees(listId: string): Promise<Record<string, DriversItemAssignee[]>> {
    // Keep the existing scoped query and relation loading before grouping its result.
    const rows = await AppDataSource.getRepository(DriversAssignment).find({
        where: {entity: {id: listId}},  // if `list` is a relation
        relations: {
            profile: true,
            item: true
        },
    });

    // Merge UUID aliases before projection rather than overwriting an earlier bucket.
    const groups = groupByUuid(rows, row => row.item.id);
    return Object.fromEntries([...groups].map(([id, assignments]) => [id, assignments.map(assignment => ({
        id: assignment.id, profileId: assignment.profile.id, name: assignment.profile.name,
    }))]));
}

/** Delete an approved assignment handle through the existing simple operation. */
export async function deleteDriversAssignment(assignId: number, manager: EntityManager = AppDataSource.manager): Promise<void> {
    await manager.getRepository(DriversAssignment).delete({id: assignId});
}


/** Persist only the normalized fields supplied by the controller in its existing transaction. */
export async function updateDriversListProperties(id: string, patch: BasicEntityPropertyPatch, manager: EntityManager): Promise<void> {
    await manager.getRepository(DriversList).update(id, patch);
}

/** Read the current root and parent on the caller's snapshot connection. */
export async function getDriversSnapshotRoot(manager: EntityManager, id: string): Promise<DriversList | null> {
    return manager.getRepository(DriversList).findOne({where: {id}, relations: {event: true}});
}

/** Read nullable item evidence for a method-only baseline. The enriched
 * lookup keeps its original ORM missing-row diagnostic and driver/count joins. */
export async function getDriversSnapshotItem(manager: EntityManager, itemId: string): Promise<DriversItem | null> {
    return manager.getRepository(DriversItem).findOneBy({id: itemId});
}

/** Keep displayed names, assignments and their permission evidence in one read
 * snapshot. This DBAL callback supplies evidence without choosing page admission. */
export async function withDriversReadSnapshot<T>(id: string, read: (manager: EntityManager, list: DriversList | null) => Promise<T>): Promise<T> {
    async function readSnapshot(manager: EntityManager): Promise<T> {
        // The root, its parent and all delegated reads share this connection.
        return read(manager, await getDriversSnapshotRoot(manager, id));
    }
    return AppDataSource.transaction('REPEATABLE READ', readSnapshot);
}

/** Read offered rides in their stored order with visible driver profiles. The
 * optional row locks retain a reviewed order until the caller's writes commit. */
export async function getDriversSnapshotItems(manager: EntityManager, listId: string, lockItems = false): Promise<DriversItem[]> {
    // Preserve the feature's stored position order; the joined profile is the
    // visible driver identity rather than the ride's historical hidden title.
    return manager.getRepository(DriversItem).find({
        where: {entity: {id: listId}}, relations: {profile: true},
        order: {pos: 'ASC'},
        ...(lockItems ? {lock: {mode: 'pessimistic_write' as const}} : {}),
    });
}

/** Full detail additionally needs passenger names/counts. Method-only baselines
 * use the bounded root/item reads above without loading this assignment roster. */
export async function getDriversSnapshotRows(manager: EntityManager, listId: string) {
    // Minimal baselines omit this roster; only the admitted full view needs names.
    const items = await getDriversSnapshotItems(manager, listId);
    const assignments = await manager.getRepository(DriversAssignment).find({
        where: {entity: {id: listId}}, relations: {profile: true}, order: {id: 'ASC'},
    });
    return {items, assignments};
}
