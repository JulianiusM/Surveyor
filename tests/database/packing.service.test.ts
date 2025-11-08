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
    it('creates/updates/deletes a PackingList; fetch by id and user', async () => {
        const listId = uuidv4();

        await createPackingList(listId, 1, 'Initial Title', 'Initial Desc', true, false);

        // By id
        const byId = await getPackingListById(listId);
        expect(byId).toBeTruthy();
        expect(byId!.id).toBe(listId);
        expect(byId!.title).toBe('Initial Title');
        expect(byId!.description).toBe('Initial Desc');
        expect(byId!.allowGuestAdd).toBe(1);
        expect(byId!.guestManage).toBe(0);

        // By user
        const byUser = await getPackingListByUserId(1);
        expect(byUser.map((l) => l.id)).toContain(listId);

        // Field updates
        await updatePackingListTitle(listId, 'New Title');
        await updatePackingListDescription(listId, 'New Desc');
        await updatePackingListAllow(listId, false);
        await updatePackingListGuestManage(listId, true);

        const afterSingles = await getPackingListById(listId);
        expect(afterSingles!.title).toBe('New Title');
        expect(afterSingles!.description).toBe('New Desc');
        expect(afterSingles!.allowGuestAdd).toBe(0);
        expect(afterSingles!.guestManage).toBe(1);

        // Combined flags
        await updatePackingFlags(listId, true, false);
        const afterFlags = await getPackingListById(listId);
        expect(afterFlags!.allowGuestAdd).toBe(1);
        expect(afterFlags!.guestManage).toBe(0);

        // Delete
        await deletePackingList(listId);
        const deleted = await getPackingListById(listId);
        expect(deleted).toBeNull();
    });

    it('transactional create (list+items), item CRUD, reorder, counts, last number, requiredByAll', async () => {
        const itemId1 = uuidv4()
        const itemId2 = uuidv4()
        const itemId3 = uuidv4()
        const itemId4 = uuidv4()
        const itemId5 = uuidv4()
        const itemId6 = uuidv4()
        const txListId = await createPackingListTx(
            1,
            'Trip to Alps',
            'winter gear',
            true,
            false,
            [
                {id: itemId1, title: 'Backpack', description: '', maxAssignees: 1, requiredByAll: false, pos: 1},
                {id: itemId2, title: 'Stove', description: 'gas', maxAssignees: 2, requiredByAll: false, pos: 2},
                {id: itemId3, title: 'First Aid', description: '', maxAssignees: 1, requiredByAll: true, pos: 3},
            ]
        );
        expect(typeof txListId).toBe('string');
        expect(txListId.length).toBeGreaterThan(0);

        // Items initially (assignedCount from counts map)
        let items = await getPackingItems(txListId);
        expect(items.map(i => i.id)).toEqual([itemId1, itemId2, itemId3]);
        expect(items.every(i => i.assignedCount === 0)).toBe(true);

        // Add more items
        await addPackingItems(txListId, [
            {id: itemId4, title: 'Tent', pos: 10},
            {id: itemId5, title: 'Rope', pos: 20},
        ]);
        items = await getPackingItems(txListId);
        expect(items.map(i => i.id)).toEqual([itemId1, itemId2, itemId3, itemId4, itemId5]);

        // Single create
        await createPackingItem(txListId, {id: itemId6, title: 'Snacks', pos: 15});
        items = await getPackingItems(txListId);
        expect(items.map(i => i.id)).toEqual([itemId1, itemId2, itemId3, itemId4, itemId6, itemId5]);

        // Update item
        const changed = await updatePackingItem(itemId1, {
            title: 'Backpack (65L)',
            description: 'with rain cover',
            pos: 5,
        });
        expect(changed).toBe(true);

        // No-op update returns undefined
        const noop = await updatePackingItem(itemId1, {});
        expect(noop).toBeUndefined();

        // Reorder: pi-2 first, pi-1 second
        await reorderPackingItems(txListId, [
            {itemId: itemId2, position: 1},
            {itemId: itemId1, position: 2},
        ]);
        items = await getPackingItems(txListId);
        expect(items.slice(0, 2).map(i => i.id)).toEqual([itemId2, itemId1]);

        // RequiredByAll toggle
        await togglePackingItemRequiredByAll(itemId1, true);
        const pi1 = await AppDataSource.getRepository(PackingItem).findOneBy({id: itemId1});
        expect(pi1!.requiredByAll).toBe(1);

        // Last number (max pos)
        const last = await getLastPackingItemNumber(txListId);
        expect(last).toBe(20); // pi-5

        // Delete one item
        await deletePackingItem(itemId5);
        items = await getPackingItems(txListId);
        expect(items.find(i => i.id === itemId5)).toBeFalsy();
        const lastAfterDelete = await getLastPackingItemNumber(txListId);
        expect(lastAfterDelete).toBe(15); // pi-6
    });

    it('assigns/unassigns (user+guest), counts, assignees map, and deletion by assignId', async () => {
        const listId = uuidv4();
        const itemId1 = uuidv4()
        const itemId2 = uuidv4()
        await createPackingList(listId, 1, 'AssignTest', '', true, true);

        // Principals
        const user2 = AppDataSource.getRepository(User).create({
            id: 2,
            username: 'u2',
            name: 'User Two',
            email: 'u2@example.com',
        });
        await AppDataSource.getRepository(User).save(user2);

        const guest1 = AppDataSource.getRepository(Guest).create({
            id: 11,
            username: 'guestOne',
        });
        await AppDataSource.getRepository(Guest).save(guest1);

        // Items
        await createPackingItem(listId, {id: itemId1, title: 'Cook set', pos: 1});
        await createPackingItem(listId, {id: itemId2, title: 'Water jugs', pos: 2});

        // Assign (idempotent)
        await assignPackingItemToUser(itemId1, 2);
        await assignPackingItemToUser(itemId1, 2); // duplicate ignored
        await assignPackingItemToGuest(itemId2, 11);
        await assignPackingItemToGuest(itemId2, 11); // duplicate ignored

        // Counts
        const counts = await getPackingAssignmentCounts(listId);
        expect(counts[itemId1]).toBe(1);
        expect(counts[itemId2]).toBe(1);

        // Lists of item ids
        const userItems = await getPackingAssignmentsForUser(listId, 2);
        expect(userItems).toEqual([itemId1]);
        const guestItems = await getPackingAssignmentsForGuest(listId, 11);
        expect(guestItems).toEqual([itemId2]);

        // Assignees map (names resolved)
        const map = await getPackingItemAssignees(listId);
        expect(Object.keys(map).sort()).toEqual([itemId1, itemId2].sort());
        expect(map[itemId1][0].name).toBe('User Two');
        expect(map[itemId2][0].name).toBe('guestOne');

        // Delete one assignment by ID
        const guestAssignId = map[itemId2][0].id!;
        await deletePackingAssignment(guestAssignId);

        const countsAfterDelete = await getPackingAssignmentCounts(listId);
        expect(countsAfterDelete[itemId2] ?? 0).toBe(0);
        expect(countsAfterDelete[itemId1]).toBe(1);

        // Unassign user path
        await unassignPackingItemUser(itemId1, 2);
        const finalCounts = await getPackingAssignmentCounts(listId);
        expect(finalCounts[itemId1] ?? 0).toBe(0);

        // Guest unassign no-op (already deleted)
        await unassignPackingItemGuest(itemId2, 11);

        // Items list reflects assignedCount=0
        const items = await getPackingItems(listId);
        const byId: Record<string, number> = Object.fromEntries(items.map(i => [i.id, i.assignedCount]));
        expect(byId[itemId1]).toBe(0);
        expect(byId[itemId2]).toBe(0);
    });
});
