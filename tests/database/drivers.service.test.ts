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
    it('creates and updates a DriversList; fetch by id and user', async () => {
        const listId = uuidv4();

        await createDriversList(1, 'Initial Title', 'Initial Desc', true, false, listId);

        // By id
        const byId = await getDriversListById(listId);
        expect(byId).toBeTruthy();
        expect(byId!.id).toBe(listId);
        expect(byId!.title).toBe('Initial Title');
        expect(byId!.description).toBe('Initial Desc');
        expect(byId!.allowGuestAdd).toBe(1);
        expect(byId!.guestManage).toBe(0);

        // By user
        const byUser = await getDriversListByUserId(1);
        expect(byUser.map((l) => l.id)).toContain(listId);

        // Update fields individually
        await updateDriversListTitle(listId, 'New Title');
        await updateDriversListDescription(listId, 'New Desc');
        await updateDriversListAllow(listId, false);
        await updateDriversListGuestManage(listId, true);

        const afterSingleUpdates = await getDriversListById(listId);
        expect(afterSingleUpdates!.title).toBe('New Title');
        expect(afterSingleUpdates!.description).toBe('New Desc');
        expect(afterSingleUpdates!.allowGuestAdd).toBe(0);
        expect(afterSingleUpdates!.guestManage).toBe(1);

        // Update flags together
        await updateDriversFlags(listId, true, false);
        const afterFlags = await getDriversListById(listId);
        expect(afterFlags!.allowGuestAdd).toBe(1);
        expect(afterFlags!.guestManage).toBe(0);

        // Delete
        await deleteDriversList(listId);
        const deleted = await getDriversListById(listId);
        expect(deleted).toBeNull();
    });

    it('creates items (user+guest), enriches, reorders, updates, and computes last item number', async () => {
        const listId = uuidv4();
        await createDriversList(1, 'Drivers', 'desc', true, false, listId);

        // Additional principals
        const user2 = AppDataSource.getRepository(User).create({
            id: 2,
            username: 'u2',
            name: 'User Two',
            email: 'u2@example.com',
        });
        await AppDataSource.getRepository(User).save(user2);

        const guest1 = AppDataSource.getRepository(Guest).create({
            id: 10,
            username: 'guestOne',
        });
        await AppDataSource.getRepository(Guest).save(guest1);

        const itemId1 = uuidv4()
        const itemId2 = uuidv4()
        // Create two items; explicit ids/pos for determinism
        await createDriversItemUser(listId, 2, {
            id: itemId1,
            title: 'Pick up wood',
            description: '',
            maxAssignees: 2,
            pos: 1,
        });

        await createDriversItemGuest(listId, 10, {
            id: itemId2,
            title: 'Bring nails',
            description: 'galvanized',
            maxAssignees: 1,
            pos: 2,
        });

        // Enriched list read
        const itemsInitial = await getDriversItems(listId);
        expect(itemsInitial).toHaveLength(2);
        expect(itemsInitial[0].id).toBe(itemId1);
        expect(itemsInitial[0].assignedCount).toBe(0);
        expect(itemsInitial[0].driverName).toBe('User Two');

        expect(itemsInitial[1].id).toBe(itemId2);
        expect(itemsInitial[1].driverName).toBe('guestOne');

        // Update item
        const updated = await updateDriversItem(itemId1, {
            title: 'Pick up timber',
            description: 'oak',
            maxAssignees: 3,
            pos: 5,
        });
        expect(updated).toBe(true);

        // No-op update returns false
        const noOp = await updateDriversItem(itemId1, {});
        expect(noOp).toBe(false);

        // Reorder: item-2 first, item-1 second
        await reorderDriversItems(listId, [
            {itemId: itemId2, position: 1},
            {itemId: itemId1, position: 2},
        ]);

        const itemsReordered = await getDriversItems(listId);
        expect(itemsReordered.map((i) => i.id)).toEqual([itemId2, itemId1]);

        // Last number
        const last = await getLastDriversItemNumber(listId);
        expect(last).toBe(2);

        // Delete one item
        await deleteDriversItem(itemId2);
        const afterDelete = await getDriversItems(listId);
        expect(afterDelete.map((i) => i.id)).toEqual([itemId1]);
    });

    it('assigns/unassigns items (user + guest), counts, maps assignees, and deletes assignments', async () => {
        const listId = uuidv4();
        const itemId1 = uuidv4()
        const itemId2 = uuidv4()
        await createDriversList(1, 'Drivers', 'desc', true, true, listId);

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
        await createDriversItemUser(listId, 2, {
            id: itemId1,
            title: 'Drive van',
            pos: 1,
            maxAssignees: 2,
        });
        await createDriversItemGuest(listId, 11, {
            id: itemId2,
            title: 'Drive truck',
            pos: 2,
            maxAssignees: 1,
        });

        // Assign (idempotent/upsert)
        await assignDriversItemToUser(itemId1, 2);
        await assignDriversItemToUser(itemId1, 2); // duplicate
        await assignDriversItemToGuest(itemId2, 11);
        await assignDriversItemToGuest(itemId2, 11); // duplicate

        // Counts by item
        const counts = await getDriversAssignmentCounts(listId);
        expect(counts[itemId1]).toBe(1);
        expect(counts[itemId2]).toBe(1);

        // Enriched single fetch shows assignedCount
        const enrichedU = await getDriversItemById(itemId1);
        expect(enrichedU.assignedCount).toBe(1);
        expect(enrichedU.driverName).toBe('User Two');

        // Lists of assigned item ids
        const userItems = await getDriversAssignmentsForUser(listId, 2);
        expect(userItems).toEqual([itemId1]);

        const guestItems = await getDriversAssignmentsForGuest(listId, 11);
        expect(guestItems).toEqual([itemId2]);

        // Map of assignees per item
        const assigneesMap = await getDriversItemAssignees(listId);
        expect(Object.keys(assigneesMap).sort()).toEqual([itemId2, itemId1].sort());
        expect(assigneesMap[itemId1]).toHaveLength(1);
        expect(assigneesMap[itemId1][0].name).toBe('User Two');
        expect(assigneesMap[itemId2][0].name).toBe('guestOne');

        // Delete one assignment by id
        const guestAssignId = assigneesMap[itemId2][0].id!;
        await deleteDriversAssignment(guestAssignId);

        const countsAfterDelete = await getDriversAssignmentCounts(listId);
        expect(countsAfterDelete[itemId2] ?? 0).toBe(0);
        expect(countsAfterDelete[itemId1]).toBe(1);

        // Unassign the user via (itemId,userId)
        await unassignDriversItemUser(itemId1, 2);

        const finalCounts = await getDriversAssignmentCounts(listId);
        expect(finalCounts[itemId1] ?? 0).toBe(0);

        // Also test guest unassign path again for completeness (no-op now)
        await unassignDriversItemGuest(itemId2, 11);

        const emptyMap = await getDriversItemAssignees(listId);
        expect(emptyMap[itemId1] ?? []).toHaveLength(0);
        expect(emptyMap[itemId2] ?? []).toHaveLength(0);
    });
});
