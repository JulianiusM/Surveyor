/**
 * Tests for driversService using the mysql (MariaDB/mysql2) DataSource mock.
 * Requires tests/db/mariadb-datasource.mock.ts and a reachable test DB.
 */

jest.mock('../../src/modules/database/dataSource', () =>
    require('../util/db/mariadb-datasource.mock')
);

import {v4 as uuidv4} from 'uuid';

import {
    assignDriversItemToGuest,
    assignDriversItemToUser,
    createDriversItemGuest,
    createDriversItemUser,
    createDriversList,
    deleteDriversAssignment,
    deleteDriversItem,
    deleteDriversList,
    getDriversAssignmentCounts,
    getDriversAssignmentsForGuest,
    getDriversAssignmentsForUser,
    getDriversItemAssignees,
    getDriversItemById,
    getDriversItems,
    getDriversListById,
    getDriversListByUserId,
    getLastDriversItemNumber,
    reorderDriversItems,
    unassignDriversItemGuest,
    unassignDriversItemUser,
    updateDriversItem,
    updateDriversListDescription,
    updateDriversListTitle,
} from '../../src/modules/database/services/DriverService';

import {AppDataSource, initDataSource} from '../../src/modules/database/dataSource';

// Entities used for quick setup/cleanup
import {DriversList} from '../../src/modules/database/entities/drivers/DriversList';
import {DriversItem} from '../../src/modules/database/entities/drivers/DriversItem';
import {DriversAssignment} from '../../src/modules/database/entities/drivers/DriversAssignment';
import {User} from '../../src/modules/database/entities/user/User';
import {Guest} from '../../src/modules/database/entities/user/Guest';

// Test data
import {
    driversListCrudData,
    driversItemsData,
    driversAssignmentsData,
} from '../data/database/driversServiceData';

// Helper to clear relevant tables between tests (order matters due to FKs)
async function truncateAll() {
    await AppDataSource.query('SET FOREIGN_KEY_CHECKS=0');

    await AppDataSource.createQueryBuilder().delete().from(DriversAssignment).execute();
    await AppDataSource.createQueryBuilder().delete().from(DriversItem).execute();
    await AppDataSource.createQueryBuilder().delete().from(DriversList).execute();
    await AppDataSource.createQueryBuilder().delete().from(User).execute();
    await AppDataSource.createQueryBuilder().delete().from(Guest).execute();

    await AppDataSource.query('SET FOREIGN_KEY_CHECKS=1');
}

beforeAll(async () => {
    await initDataSource();
    if ('synchronize' in AppDataSource) {
        await (AppDataSource as any).synchronize(true);
    }
}, 60_000);

afterAll(async () => {
    if (AppDataSource.isInitialized) await AppDataSource.destroy();
});

beforeEach(async () => {
    // Base owner for lists
    const owner = AppDataSource.getRepository(User).create({
        id: 1,
        username: 'owner',
        name: 'Owner One',
        email: 'owner@example.com',
    });
    await AppDataSource.getRepository(User).save(owner);
});

afterEach(async () => {
    await truncateAll();
}, 60_000);

describe('driversService (mysql)', () => {
    test.each(driversListCrudData)('$description', async (testCase) => {
        const listId = uuidv4();

        await createDriversList(
            testCase.userId,
            testCase.initialData.title,
            testCase.initialData.description,
            testCase.initialData.allowGuestAdd,
            testCase.initialData.guestManage,
            listId
        );

        // By id
        const byId = await getDriversListById(listId);
        expect(byId).toBeTruthy();
        expect(byId!.id).toBe(listId);
        expect(byId!.title).toBe(testCase.expectedInitial.title);
        expect(byId!.description).toBe(testCase.expectedInitial.description);

        // By user
        const byUser = await getDriversListByUserId(testCase.userId);
        expect(byUser.map((l) => l.id)).toContain(listId);

        // Update fields individually
        await updateDriversListTitle(listId, testCase.updates.title);
        await updateDriversListDescription(listId, testCase.updates.description);

        const afterSingleUpdates = await getDriversListById(listId);
        expect(afterSingleUpdates!.title).toBe(testCase.expectedAfterUpdates.title);
        expect(afterSingleUpdates!.description).toBe(testCase.expectedAfterUpdates.description);

        // Delete
        await deleteDriversList(listId);
        const deleted = await getDriversListById(listId);
        expect(deleted).toBeNull();
    });

    test.each(driversItemsData)('$description', async (testCase) => {
        const listId = uuidv4();
        await createDriversList(
            testCase.userId,
            testCase.listData.title,
            testCase.listData.description,
            testCase.listData.allowGuestAdd,
            testCase.listData.guestManage,
            listId
        );

        // Additional principals
        const user2 = AppDataSource.getRepository(User).create(testCase.testUser);
        await AppDataSource.getRepository(User).save(user2);

        const guest1 = AppDataSource.getRepository(Guest).create(testCase.testGuest);
        await AppDataSource.getRepository(Guest).save(guest1);

        // Generate UUIDs for items at runtime
        const itemIdMap = new Map<string, string>();
        itemIdMap.set(testCase.userItem.id, uuidv4());
        itemIdMap.set(testCase.guestItem.id, uuidv4());
        
        const itemId1 = itemIdMap.get(testCase.userItem.id)!;
        const itemId2 = itemIdMap.get(testCase.guestItem.id)!;
        
        // Create two items
        await createDriversItemUser(listId, testCase.testUser.id, {...testCase.userItem, id: itemId1});
        await createDriversItemGuest(listId, testCase.testGuest.id, {...testCase.guestItem, id: itemId2});

        // Enriched list read
        const itemsInitial = await getDriversItems(listId);
        expect(itemsInitial).toHaveLength(2);
        expect(itemsInitial[0].id).toBe(itemId1);
        expect(itemsInitial[0].assignedCount).toBe(0);
        expect(itemsInitial[0].driverName).toBe(testCase.expectedUserItemName);

        expect(itemsInitial[1].id).toBe(itemId2);
        expect(itemsInitial[1].driverName).toBe(testCase.expectedGuestItemName);

        // Update item
        const updateItemId = itemIdMap.get(testCase.itemUpdate.itemId)!;
        const updated = await updateDriversItem(updateItemId, testCase.itemUpdate.updates);
        expect(updated).toBe(true);

        // No-op update returns false
        const noOp = await updateDriversItem(updateItemId, {});
        expect(noOp).toBe(false);

        // Reorder
        const reorderMapped = testCase.reorder.map(r => ({
            itemId: itemIdMap.get(r.itemId)!,
            position: r.position
        }));
        await reorderDriversItems(listId, reorderMapped);

        const itemsReordered = await getDriversItems(listId);
        const expectedAfterReorder = testCase.expectedAfterReorder.map(id => itemIdMap.get(id)!);
        expect(itemsReordered.map((i) => i.id)).toEqual(expectedAfterReorder);

        // Last number
        const last = await getLastDriversItemNumber(listId);
        expect(last).toBe(testCase.expectedLastNumber);

        // Delete one item
        const deleteItemId = itemIdMap.get(testCase.deleteItemId)!;
        await deleteDriversItem(deleteItemId);
        const afterDelete = await getDriversItems(listId);
        const expectedAfterDelete = testCase.expectedAfterDelete.map(id => itemIdMap.get(id)!);
        expect(afterDelete.map((i) => i.id)).toEqual(expectedAfterDelete);
    });

    test.each(driversAssignmentsData)('$description', async (testCase) => {
        const listId = uuidv4();
        // Generate UUIDs for items at runtime
        const itemIdMap = new Map<string, string>();
        itemIdMap.set(testCase.userItem.id, uuidv4());
        itemIdMap.set(testCase.guestItem.id, uuidv4());
        
        const itemId1 = itemIdMap.get(testCase.userItem.id)!;
        const itemId2 = itemIdMap.get(testCase.guestItem.id)!;
        
        await createDriversList(
            testCase.userId,
            testCase.listData.title,
            testCase.listData.description,
            testCase.listData.allowGuestAdd,
            testCase.listData.guestManage,
            listId
        );

        // Principals
        const user2 = AppDataSource.getRepository(User).create(testCase.testUser);
        await AppDataSource.getRepository(User).save(user2);

        const guest1 = AppDataSource.getRepository(Guest).create(testCase.testGuest);
        await AppDataSource.getRepository(Guest).save(guest1);

        // Items
        await createDriversItemUser(listId, testCase.testUser.id, {...testCase.userItem, id: itemId1});
        await createDriversItemGuest(listId, testCase.testGuest.id, {...testCase.guestItem, id: itemId2});

        // Assign (idempotent/upsert)
        await assignDriversItemToUser(itemId1, testCase.testUser.id);
        await assignDriversItemToUser(itemId1, testCase.testUser.id); // duplicate
        await assignDriversItemToGuest(itemId2, testCase.testGuest.id);
        await assignDriversItemToGuest(itemId2, testCase.testGuest.id); // duplicate

        // Counts by item
        const counts = await getDriversAssignmentCounts(listId);
        expect(counts[itemId1]).toBe(testCase.expectedCounts[testCase.userItem.id]);
        expect(counts[itemId2]).toBe(testCase.expectedCounts[testCase.guestItem.id]);

        // Enriched single fetch shows assignedCount
        const enrichedU = await getDriversItemById(itemId1);
        expect(enrichedU.assignedCount).toBe(testCase.expectedCounts[testCase.userItem.id]);
        expect(enrichedU.driverName).toBe(testCase.expectedAssigneeNames[testCase.userItem.id]);

        // Lists of assigned item ids
        const userItems = await getDriversAssignmentsForUser(listId, testCase.testUser.id);
        expect(userItems).toEqual([itemId1]);

        const guestItems = await getDriversAssignmentsForGuest(listId, testCase.testGuest.id);
        expect(guestItems).toEqual([itemId2]);

        // Map of assignees per item
        const assigneesMap = await getDriversItemAssignees(listId);
        expect(Object.keys(assigneesMap).sort()).toEqual([itemId2, itemId1].sort());
        expect(assigneesMap[itemId1]).toHaveLength(1);
        expect(assigneesMap[itemId1][0].name).toBe(testCase.expectedAssigneeNames[testCase.userItem.id]);
        expect(assigneesMap[itemId2][0].name).toBe(testCase.expectedAssigneeNames[testCase.guestItem.id]);

        // Delete one assignment by id
        const guestAssignId = assigneesMap[itemId2][0].id!;
        await deleteDriversAssignment(guestAssignId);

        const countsAfterDelete = await getDriversAssignmentCounts(listId);
        expect(countsAfterDelete[itemId2] ?? 0).toBe(testCase.expectedCountsAfterGuestDelete[testCase.guestItem.id]);
        expect(countsAfterDelete[itemId1]).toBe(testCase.expectedCountsAfterGuestDelete[testCase.userItem.id]);

        // Unassign the user via (itemId,userId)
        await unassignDriversItemUser(itemId1, testCase.testUser.id);

        const finalCounts = await getDriversAssignmentCounts(listId);
        expect(finalCounts[itemId1] ?? 0).toBe(testCase.expectedFinalCounts[testCase.userItem.id]);

        // Also test guest unassign path again for completeness (no-op now)
        await unassignDriversItemGuest(itemId2, testCase.testGuest.id);

        const emptyMap = await getDriversItemAssignees(listId);
        expect(emptyMap[itemId1] ?? []).toHaveLength(0);
        expect(emptyMap[itemId2] ?? []).toHaveLength(0);
    });
});
