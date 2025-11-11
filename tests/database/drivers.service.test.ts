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
    updateDriversFlags,
    updateDriversItem,
    updateDriversListAllow,
    updateDriversListDescription,
    updateDriversListGuestManage,
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
    await truncateAll();
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
        expect(byId!.allowGuestAdd).toBe(testCase.expectedInitial.allowGuestAdd);
        expect(byId!.guestManage).toBe(testCase.expectedInitial.guestManage);

        // By user
        const byUser = await getDriversListByUserId(testCase.userId);
        expect(byUser.map((l) => l.id)).toContain(listId);

        // Update fields individually
        await updateDriversListTitle(listId, testCase.updates.title);
        await updateDriversListDescription(listId, testCase.updates.description);
        await updateDriversListAllow(listId, testCase.updates.allowGuestAdd);
        await updateDriversListGuestManage(listId, testCase.updates.guestManage);

        const afterSingleUpdates = await getDriversListById(listId);
        expect(afterSingleUpdates!.title).toBe(testCase.expectedAfterUpdates.title);
        expect(afterSingleUpdates!.description).toBe(testCase.expectedAfterUpdates.description);
        expect(afterSingleUpdates!.allowGuestAdd).toBe(testCase.expectedAfterUpdates.allowGuestAdd);
        expect(afterSingleUpdates!.guestManage).toBe(testCase.expectedAfterUpdates.guestManage);

        // Update flags together
        await updateDriversFlags(listId, testCase.flagsUpdate.allowGuestAdd, testCase.flagsUpdate.guestManage);
        const afterFlags = await getDriversListById(listId);
        expect(afterFlags!.allowGuestAdd).toBe(testCase.expectedAfterFlags.allowGuestAdd);
        expect(afterFlags!.guestManage).toBe(testCase.expectedAfterFlags.guestManage);

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

        const itemId1 = testCase.userItem.id;
        const itemId2 = testCase.guestItem.id;
        
        // Create two items
        await createDriversItemUser(listId, testCase.testUser.id, testCase.userItem);
        await createDriversItemGuest(listId, testCase.testGuest.id, testCase.guestItem);

        // Enriched list read
        const itemsInitial = await getDriversItems(listId);
        expect(itemsInitial).toHaveLength(2);
        expect(itemsInitial[0].id).toBe(itemId1);
        expect(itemsInitial[0].assignedCount).toBe(0);
        expect(itemsInitial[0].driverName).toBe(testCase.expectedUserItemName);

        expect(itemsInitial[1].id).toBe(itemId2);
        expect(itemsInitial[1].driverName).toBe(testCase.expectedGuestItemName);

        // Update item
        const updated = await updateDriversItem(testCase.itemUpdate.itemId, testCase.itemUpdate.updates);
        expect(updated).toBe(true);

        // No-op update returns false
        const noOp = await updateDriversItem(testCase.itemUpdate.itemId, {});
        expect(noOp).toBe(false);

        // Reorder
        await reorderDriversItems(listId, testCase.reorder);

        const itemsReordered = await getDriversItems(listId);
        expect(itemsReordered.map((i) => i.id)).toEqual(testCase.expectedAfterReorder);

        // Last number
        const last = await getLastDriversItemNumber(listId);
        expect(last).toBe(testCase.expectedLastNumber);

        // Delete one item
        await deleteDriversItem(testCase.deleteItemId);
        const afterDelete = await getDriversItems(listId);
        expect(afterDelete.map((i) => i.id)).toEqual(testCase.expectedAfterDelete);
    });

    test.each(driversAssignmentsData)('$description', async (testCase) => {
        const listId = uuidv4();
        const itemId1 = testCase.userItem.id;
        const itemId2 = testCase.guestItem.id;
        
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
        await createDriversItemUser(listId, testCase.testUser.id, testCase.userItem);
        await createDriversItemGuest(listId, testCase.testGuest.id, testCase.guestItem);

        // Assign (idempotent/upsert)
        await assignDriversItemToUser(itemId1, testCase.testUser.id);
        await assignDriversItemToUser(itemId1, testCase.testUser.id); // duplicate
        await assignDriversItemToGuest(itemId2, testCase.testGuest.id);
        await assignDriversItemToGuest(itemId2, testCase.testGuest.id); // duplicate

        // Counts by item
        const counts = await getDriversAssignmentCounts(listId);
        expect(counts[itemId1]).toBe(testCase.expectedCounts[itemId1]);
        expect(counts[itemId2]).toBe(testCase.expectedCounts[itemId2]);

        // Enriched single fetch shows assignedCount
        const enrichedU = await getDriversItemById(itemId1);
        expect(enrichedU.assignedCount).toBe(testCase.expectedCounts[itemId1]);
        expect(enrichedU.driverName).toBe(testCase.expectedAssigneeNames[itemId1]);

        // Lists of assigned item ids
        const userItems = await getDriversAssignmentsForUser(listId, testCase.testUser.id);
        expect(userItems).toEqual(testCase.expectedUserItems);

        const guestItems = await getDriversAssignmentsForGuest(listId, testCase.testGuest.id);
        expect(guestItems).toEqual(testCase.expectedGuestItems);

        // Map of assignees per item
        const assigneesMap = await getDriversItemAssignees(listId);
        expect(Object.keys(assigneesMap).sort()).toEqual([itemId2, itemId1].sort());
        expect(assigneesMap[itemId1]).toHaveLength(1);
        expect(assigneesMap[itemId1][0].name).toBe(testCase.expectedAssigneeNames[itemId1]);
        expect(assigneesMap[itemId2][0].name).toBe(testCase.expectedAssigneeNames[itemId2]);

        // Delete one assignment by id
        const guestAssignId = assigneesMap[itemId2][0].id!;
        await deleteDriversAssignment(guestAssignId);

        const countsAfterDelete = await getDriversAssignmentCounts(listId);
        expect(countsAfterDelete[itemId2] ?? 0).toBe(testCase.expectedCountsAfterGuestDelete[itemId2]);
        expect(countsAfterDelete[itemId1]).toBe(testCase.expectedCountsAfterGuestDelete[itemId1]);

        // Unassign the user via (itemId,userId)
        await unassignDriversItemUser(itemId1, testCase.testUser.id);

        const finalCounts = await getDriversAssignmentCounts(listId);
        expect(finalCounts[itemId1] ?? 0).toBe(testCase.expectedFinalCounts[itemId1]);

        // Also test guest unassign path again for completeness (no-op now)
        await unassignDriversItemGuest(itemId2, testCase.testGuest.id);

        const emptyMap = await getDriversItemAssignees(listId);
        expect(emptyMap[itemId1] ?? []).toHaveLength(0);
        expect(emptyMap[itemId2] ?? []).toHaveLength(0);
    });
});
