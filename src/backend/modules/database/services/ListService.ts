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

import type {EntityManager} from 'typeorm';
import type {ListPersistenceType, ListRootRows, ListItemRows, ListAssignmentRows} from '../../../../types/ListPersistenceTypes';
import {AppDataSource} from '../dataSource';
import {PackingList} from '../entities/packing/PackingList';
import {PackingItem} from '../entities/packing/PackingItem';
import {PackingAssignment} from '../entities/packing/PackingAssignment';
import {DriversList} from '../entities/drivers/DriversList';
import {DriversItem} from '../entities/drivers/DriversItem';
import {DriversAssignment} from '../entities/drivers/DriversAssignment';
import {Event} from '../entities/event/Event';

const rootTargets = {packing: PackingList, drivers: DriversList};
const itemTargets = {packing: PackingItem, drivers: DriversItem};
const assignmentTargets = {packing: PackingAssignment, drivers: DriversAssignment};

/** Keep the original root-only lock and READ COMMITTED transaction around the caller's operation. */
export async function withListRootLock<Type extends ListPersistenceType, Result>(type: Type, id: string,
    operation: (manager: EntityManager, root: ListRootRows[Type] | null) => Promise<Result>): Promise<Result> {
    async function readLocked(manager: EntityManager): Promise<Result> {
        // This lock covers only the selected root; the caller decides absence and writes.
        const root = await manager.getRepository<PackingList | DriversList>(rootTargets[type])
            .findOne({where: {id}, lock: {mode: 'pessimistic_write'}});
        return operation(manager, root as ListRootRows[Type] | null);
    }
    return AppDataSource.transaction('READ COMMITTED', readLocked);
}

/** Read capacity and personal membership under the existing exclusive item lock without deciding policy. */
export async function getLockedListAssignment<Type extends ListPersistenceType>(type: Type,
    manager: EntityManager, itemId: string, profileId?: string) {
    // Outer Packing/Drivers wrappers retain their different parent lock coordination.
    const item = await manager.getRepository<PackingItem | DriversItem>(itemTargets[type])
        .findOne({where: {id: itemId}, lock: {mode: 'pessimistic_write'}});
    const repository = manager.getRepository<PackingAssignment | DriversAssignment>(assignmentTargets[type]);
    const existing = profileId ? await repository.findOneBy({item: {id: itemId}, profile: {id: profileId}}) : null;
    const count = await repository.countBy({item: {id: itemId}});
    return {item: item as ListItemRows[Type] | null, existing: existing as ListAssignmentRows[Type] | null, count};
}

/** Insert the controller-approved relationship and retain native missing-row/constraint diagnostics. */
export async function insertListAssignment(type: ListPersistenceType, itemId: string, profileId: string,
    manager: EntityManager = AppDataSource.manager): Promise<void> {
    // Resolve the original parent FK before creating this assignment's unchanged tuple.
    const item = await manager.getRepository<PackingItem | DriversItem>(itemTargets[type]).findOneByOrFail({id: itemId});
    const repository = manager.getRepository<PackingAssignment | DriversAssignment>(assignmentTargets[type]);
    await repository.save(repository.create({item: {id: itemId}, profile: {id: profileId}, entity: {id: item.entityId}}));
}

/** Hold the selected parent through the existing creation/default/receipt operation; standalone remains nullable. */
export async function withListCreationTransaction<Result>(eventId: string | null,
    operation: (manager: EntityManager, event: Event | null) => Promise<Result>): Promise<Result> {
    async function createLocked(manager: EntityManager): Promise<Result> {
        // Take the same optional parent lock before invoking any caller-owned creation.
        const event = eventId ? await manager.getRepository(Event)
            .findOne({where: {id: eventId}, lock: {mode: 'pessimistic_write'}}) : null;
        return operation(manager, event);
    }
    return AppDataSource.transaction('READ COMMITTED', createLocked);
}
