/**
 * Tests for packingService using the mysql (MariaDB/mysql2) DataSource mock.
 * Requires tests/db/mariadb-datasource.mock.ts and a reachable test DB.
 */

jest.mock('../../src/modules/database/dataSource', () =>
    require('../util/db/mariadb-datasource.mock')
);

import {v4 as uuidv4} from 'uuid';

import {
    addPackingItems,
    assignPackingItemToGuest,
    assignPackingItemToUser,
    createPackingItem,
    createPackingList,
    createPackingListTx,
    deletePackingAssignment,
    deletePackingItem,
    deletePackingList,
    getLastPackingItemNumber,
    getPackingAssignmentCounts,
    getPackingAssignmentsForGuest,
    getPackingAssignmentsForUser,
    getPackingItemAssignees,
    getPackingItems,
    getPackingListById,
    getPackingListByUserId,
    reorderPackingItems,
    togglePackingItemRequiredByAll,
    unassignPackingItemGuest,
    unassignPackingItemUser,
    updatePackingFlags,
    updatePackingItem,
    updatePackingListAllow,
    updatePackingListDescription,
    updatePackingListGuestManage,
    updatePackingListTitle,
} from '../../src/modules/database/services/PackingService';

import {AppDataSource, initDataSource} from '../../src/modules/database/dataSource';

// Entities for setup/cleanup
import {PackingList} from '../../src/modules/database/entities/packing/PackingList';
import {PackingItem} from '../../src/modules/database/entities/packing/PackingItem';
import {PackingAssignment} from '../../src/modules/database/entities/packing/PackingAssignment';
import {User} from '../../src/modules/database/entities/user/User';
import {Guest} from '../../src/modules/database/entities/user/Guest';

// Test data
import {
    packingListCrudData,
    packingItemsTransactionalData,
    packingAssignmentsData,
} from '../data/database/packingServiceData';

// Helper to clear tables between tests (order matters due to FKs)
async function truncateAll() {
    await AppDataSource.query('SET FOREIGN_KEY_CHECKS=0');

    await AppDataSource.createQueryBuilder().delete().from(PackingAssignment).execute();
    await AppDataSource.createQueryBuilder().delete().from(PackingItem).execute();
    await AppDataSource.createQueryBuilder().delete().from(PackingList).execute();
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

describe('packingService (mysql)', () => {
    test.each(packingListCrudData)('$description', async (testCase) => {
        const listId = uuidv4();

        await createPackingList(
            listId,
            testCase.userId,
            testCase.initialData.title,
            testCase.initialData.description,
            testCase.initialData.allowGuestAdd,
            testCase.initialData.guestManage
        );

        // By id
        const byId = await getPackingListById(listId);
        expect(byId).toBeTruthy();
        expect(byId!.id).toBe(listId);
        expect(byId!.title).toBe(testCase.expectedInitial.title);
        expect(byId!.description).toBe(testCase.expectedInitial.description);
        expect(byId!.allowGuestAdd).toBe(testCase.expectedInitial.allowGuestAdd);
        expect(byId!.guestManage).toBe(testCase.expectedInitial.guestManage);

        // By user
        const byUser = await getPackingListByUserId(testCase.userId);
        expect(byUser.map((l) => l.id)).toContain(listId);

        // Field updates
        await updatePackingListTitle(listId, testCase.updates.title);
        await updatePackingListDescription(listId, testCase.updates.description);
        await updatePackingListAllow(listId, testCase.updates.allowGuestAdd);
        await updatePackingListGuestManage(listId, testCase.updates.guestManage);

        const afterSingles = await getPackingListById(listId);
        expect(afterSingles!.title).toBe(testCase.expectedAfterUpdates.title);
        expect(afterSingles!.description).toBe(testCase.expectedAfterUpdates.description);
        expect(afterSingles!.allowGuestAdd).toBe(testCase.expectedAfterUpdates.allowGuestAdd);
        expect(afterSingles!.guestManage).toBe(testCase.expectedAfterUpdates.guestManage);

        // Combined flags
        await updatePackingFlags(listId, testCase.flagsUpdate.allowGuestAdd, testCase.flagsUpdate.guestManage);
        const afterFlags = await getPackingListById(listId);
        expect(afterFlags!.allowGuestAdd).toBe(testCase.expectedAfterFlags.allowGuestAdd);
        expect(afterFlags!.guestManage).toBe(testCase.expectedAfterFlags.guestManage);

        // Delete
        await deletePackingList(listId);
        const deleted = await getPackingListById(listId);
        expect(deleted).toBeNull();
    });

    test.each(packingItemsTransactionalData)('$description', async (testCase) => {
        // Generate UUIDs for items at runtime
        const itemIdMap = new Map<string, string>();
        testCase.initialItems.forEach(item => {
            itemIdMap.set(item.id, uuidv4());
        });
        testCase.additionalItems.forEach(item => {
            itemIdMap.set(item.id, uuidv4());
        });
        itemIdMap.set(testCase.singleItem.id, uuidv4());
        
        // Map items to use real UUIDs
        const initialItems = testCase.initialItems.map(item => ({
            ...item,
            id: itemIdMap.get(item.id)!
        }));
        const additionalItems = testCase.additionalItems.map(item => ({
            ...item,
            id: itemIdMap.get(item.id)!
        }));
        const singleItem = {
            ...testCase.singleItem,
            id: itemIdMap.get(testCase.singleItem.id)!
        };
        
        const txListId = await createPackingListTx(
            testCase.userId,
            testCase.listData.title,
            testCase.listData.description,
            testCase.listData.allowGuestAdd,
            testCase.listData.guestManage,
            initialItems
        );
        expect(typeof txListId).toBe('string');
        expect(txListId.length).toBeGreaterThan(0);

        // Items initially (assignedCount from counts map)
        let items = await getPackingItems(txListId);
        const expectedInitialIds = testCase.expectedInitialIds.map(id => itemIdMap.get(id)!);
        expect(items.map(i => i.id)).toEqual(expectedInitialIds);
        expect(items.every(i => i.assignedCount === 0)).toBe(true);

        // Add more items
        await addPackingItems(txListId, additionalItems);
        items = await getPackingItems(txListId);
        const expectedAfterAdd = testCase.expectedAfterAdd.map(id => itemIdMap.get(id)!);
        expect(items.map(i => i.id)).toEqual(expectedAfterAdd);

        // Single create
        await createPackingItem(txListId, singleItem);
        items = await getPackingItems(txListId);
        const expectedAfterSingle = testCase.expectedAfterSingle.map(id => itemIdMap.get(id)!);
        expect(items.map(i => i.id)).toEqual(expectedAfterSingle);

        // Update item
        const itemUpdateId = itemIdMap.get(testCase.itemUpdate.itemId)!;
        const changed = await updatePackingItem(itemUpdateId, testCase.itemUpdate.updates);
        expect(changed).toBe(true);

        // No-op update returns undefined
        const noop = await updatePackingItem(itemUpdateId, {});
        expect(noop).toBeUndefined();

        // Reorder
        const reorderMapped = testCase.reorder.map(r => ({
            itemId: itemIdMap.get(r.itemId)!,
            position: r.position
        }));
        await reorderPackingItems(txListId, reorderMapped);
        items = await getPackingItems(txListId);
        const expectedAfterReorder = testCase.expectedAfterReorder.map(id => itemIdMap.get(id)!);
        expect(items.slice(0, 2).map(i => i.id)).toEqual(expectedAfterReorder);

        // RequiredByAll toggle
        const toggleItemId = itemIdMap.get(testCase.requiredByAllToggle.itemId)!;
        await togglePackingItemRequiredByAll(toggleItemId, testCase.requiredByAllToggle.value);
        const pi1 = await AppDataSource.getRepository(PackingItem).findOneBy({id: toggleItemId});
        expect(pi1!.requiredByAll).toBe(1);

        // Last number (max pos)
        const last = await getLastPackingItemNumber(txListId);
        expect(last).toBe(testCase.expectedLastNumberInitial);

        // Delete one item
        const deleteItemId = itemIdMap.get(testCase.deleteItemId)!;
        await deletePackingItem(deleteItemId);
        items = await getPackingItems(txListId);
        expect(items.find(i => i.id === deleteItemId)).toBeFalsy();
        const lastAfterDelete = await getLastPackingItemNumber(txListId);
        expect(lastAfterDelete).toBe(testCase.expectedLastNumberAfterDelete);
    });

    test.each(packingAssignmentsData)('$description', async (testCase) => {
        const listId = uuidv4();
        // Generate UUIDs for items at runtime
        const itemIdMap = new Map<string, string>();
        testCase.items.forEach(item => {
            itemIdMap.set(item.id, uuidv4());
        });
        
        const itemId1 = itemIdMap.get(testCase.items[0].id)!;
        const itemId2 = itemIdMap.get(testCase.items[1].id)!;
        
        await createPackingList(
            listId,
            testCase.userId,
            testCase.listData.title,
            testCase.listData.description,
            testCase.listData.allowGuestAdd,
            testCase.listData.guestManage
        );

        // Principals
        const user2 = AppDataSource.getRepository(User).create(testCase.testUser);
        await AppDataSource.getRepository(User).save(user2);

        const guest1 = AppDataSource.getRepository(Guest).create(testCase.testGuest);
        await AppDataSource.getRepository(Guest).save(guest1);

        // Items
        await createPackingItem(listId, {...testCase.items[0], id: itemId1});
        await createPackingItem(listId, {...testCase.items[1], id: itemId2});

        // Assign (idempotent)
        const userItemId = itemIdMap.get(testCase.assignments.userItemId)!;
        const guestItemId = itemIdMap.get(testCase.assignments.guestItemId)!;
        await assignPackingItemToUser(userItemId, testCase.assignments.userId);
        await assignPackingItemToUser(userItemId, testCase.assignments.userId); // duplicate ignored
        await assignPackingItemToGuest(guestItemId, testCase.assignments.guestId);
        await assignPackingItemToGuest(guestItemId, testCase.assignments.guestId); // duplicate ignored

        // Counts
        const counts = await getPackingAssignmentCounts(listId);
        expect(counts[itemId1]).toBe(testCase.expectedCounts[testCase.items[0].id]);
        expect(counts[itemId2]).toBe(testCase.expectedCounts[testCase.items[1].id]);

        // Lists of item ids
        const userItems = await getPackingAssignmentsForUser(listId, testCase.assignments.userId);
        expect(userItems).toEqual([userItemId]);
        const guestItems = await getPackingAssignmentsForGuest(listId, testCase.assignments.guestId);
        expect(guestItems).toEqual([guestItemId]);

        // Assignees map (names resolved)
        const map = await getPackingItemAssignees(listId);
        expect(Object.keys(map).sort()).toEqual([itemId1, itemId2].sort());
        expect(map[itemId1][0].name).toBe(testCase.expectedAssigneeNames[testCase.items[0].id]);
        expect(map[itemId2][0].name).toBe(testCase.expectedAssigneeNames[testCase.items[1].id]);

        // Delete one assignment by ID
        const guestAssignId = map[itemId2][0].id!;
        await deletePackingAssignment(guestAssignId);

        const countsAfterDelete = await getPackingAssignmentCounts(listId);
        expect(countsAfterDelete[itemId2] ?? 0).toBe(testCase.expectedCountsAfterGuestDelete[testCase.items[1].id]);
        expect(countsAfterDelete[itemId1]).toBe(testCase.expectedCountsAfterGuestDelete[testCase.items[0].id]);

        // Unassign user path
        await unassignPackingItemUser(userItemId, testCase.assignments.userId);
        const finalCounts = await getPackingAssignmentCounts(listId);
        expect(finalCounts[itemId1] ?? 0).toBe(testCase.expectedFinalCounts[testCase.items[0].id]);

        // Guest unassign no-op (already deleted)
        await unassignPackingItemGuest(guestItemId, testCase.assignments.guestId);

        // Items list reflects assignedCount=0
        const items = await getPackingItems(listId);
        const byId: Record<string, number> = Object.fromEntries(items.map(i => [i.id, i.assignedCount]));
        expect(byId[itemId1]).toBe(testCase.expectedFinalCounts[testCase.items[0].id]);
        expect(byId[itemId2]).toBe(testCase.expectedFinalCounts[testCase.items[1].id]);
    });
});
