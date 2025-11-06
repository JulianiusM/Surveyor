export {}; // make module

// Ensure the service and tests share the same DataSource
jest.mock('../../src/modules/database/dataSource', () => require('../util/db/mariadb-datasource.mock'));

import {
    addActivitySlot,
    addActivitySlots,
    assignActivityAssignmentRoleToGuest,
    assignActivityAssignmentRoleToUser,
    assignRole,
    createActivityPlan,
    deleteActivityPlan,
    deleteActivitySlot,
    ensureAssignment,
    ensureRoleId,
    getActivityPlanById,
    getActivityPlansByUserId,
    getActivitySlotAssignmentsForGuest,
    getActivitySlotAssignmentsForUser,
    getActivitySlots,
    getLastActivitySlotNumber,
    reorderActivitySlots,
    unassignActivityAssignmentRoleFromGuest,
    unassignActivityAssignmentRoleFromUser,
    updateActivityPlanDescription,
    updateActivityPlanFlags,
    updateActivitySlot,
} from '../../src/modules/database/services/ActivityService';

import {AppDataSource, initDataSource} from '../../src/modules/database/dataSource';
import {ActivityPlan} from '../../src/modules/database/entities/activity/ActivityPlan';
import {ActivitySlot} from '../../src/modules/database/entities/activity/ActivitySlot';
import {ActivityAssignment} from '../../src/modules/database/entities/activity/ActivityAssignment';
import {ActivityAssignmentRole} from '../../src/modules/database/entities/activity/ActivityAssignmentRole';
import {Role} from '../../src/modules/database/entities/user/Role';
import {User} from '../../src/modules/database/entities/user/User';
import {Guest} from '../../src/modules/database/entities/user/Guest';
import {ActivitySlotRole} from '../../src/modules/database/entities/activity/ActivitySlotRole';

async function truncateAll() {
    await AppDataSource.query('SET FOREIGN_KEY_CHECKS=0');

    await AppDataSource.createQueryBuilder().delete().from(ActivityAssignmentRole).execute();
    await AppDataSource.createQueryBuilder().delete().from(ActivitySlotRole).execute();
    await AppDataSource.createQueryBuilder().delete().from(ActivityAssignment).execute();
    await AppDataSource.createQueryBuilder().delete().from(ActivitySlot).execute();
    await AppDataSource.createQueryBuilder().delete().from(ActivityPlan).execute();
    await AppDataSource.createQueryBuilder().delete().from(Role).execute();
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
    const user = AppDataSource.getRepository(User).create({id: 1, username: '', name: '', email: ''});
    await AppDataSource.getRepository(User).save(user);
});

afterEach(async () => {
    await truncateAll();
}, 60_000);

describe('Plan CRUD: get/update/delete/list', () => {
    test('create/get/update flags & description / list by owner / delete', async () => {
        await createActivityPlan('planZ', 1, 'TitleZ', 'DescZ', '2025-02-01', '2025-02-02', true, false);

        // get by id
        const got = await getActivityPlanById('planZ');
        expect(got).toEqual(expect.objectContaining({
            id: 'planZ',
            ownerId: 1,
            title: 'TitleZ',
            description: 'DescZ',
            allowGuestAdd: 1,
            guestManage: 0,
        }));

        // update flags
        await updateActivityPlanFlags('planZ', false, true);
        const got2 = await getActivityPlanById('planZ');
        expect(got2).toEqual(expect.objectContaining({allowGuestAdd: 0, guestManage: 1}));

        // update description
        await updateActivityPlanDescription('planZ', 'DescZ+');
        const got3 = await getActivityPlanById('planZ');
        expect(got3?.description).toBe('DescZ+');

        // list by owner
        const list = await getActivityPlansByUserId(1);
        expect(list.map(p => p.id)).toContain('planZ');

        // delete
        await deleteActivityPlan('planZ');
        const gone = await AppDataSource.getRepository(ActivityPlan).findOneBy({id: 'planZ'});
        expect(gone).toBeNull();
    });
});

describe('Slot CRUD: add/list/update/reorder/delete/lastNumber', () => {
    test('addActivitySlots + getActivitySlots groups by day and counts assignments', async () => {
        await createActivityPlan('planS', 1, 'T', 'D', '2025-01-01', '2025-01-03', true, true);
        await addActivitySlots('planS', [
            {id: 's1', title: 'A', day: '2025-01-01', pos: 1, maxAssignees: 2},
            {id: 's2', title: 'B', day: '2025-01-02', pos: 1, maxAssignees: 3},
        ]);

        // Add one assignment to s1 so assignedCount = 1
        const user = await AppDataSource.getRepository(User).save(AppDataSource.getRepository(User).create({
            username: 'bob', email: 'b@b',
        }));
        await ensureRoleId('default');
        const assignId = await ensureAssignment('s1', user.id, null);
        await assignRole(assignId, 'default');

        const grouped = await getActivitySlots('planS');
        expect(Object.keys(grouped).sort()).toEqual(['2025-01-01', '2025-01-02']);
        const s1 = (grouped['2025-01-01']![0] as any);
        expect(s1.id).toBe('s1');
        expect(s1.assignedCount).toBe(1);
    });

    test('updateActivitySlot returns undefined for empty input; true for changes and persists them', async () => {
        await createActivityPlan('planU', 1, 'T', 'D', '2025-01-01', '2025-01-02', true, true);
        await addActivitySlot('planU', {id: 'sx', title: 'X', day: '2025-01-01', pos: 1, maxAssignees: 1});

        const noChange = await updateActivitySlot('sx', {});
        expect(noChange).toBeUndefined();

        const ok = await updateActivitySlot('sx', {title: 'X+', maxAssignees: 5, pos: 3, description: 'New'});
        expect(ok).toBe(true);

        const sx = await AppDataSource.getRepository(ActivitySlot).findOneByOrFail({id: 'sx'});
        expect(sx).toEqual(expect.objectContaining({title: 'X+', maxAssignees: 5, pos: 3, description: 'New'}));
    });

    test('reorderActivitySlots updates per-slot pos and getLastActivitySlotNumber works per day', async () => {
        await createActivityPlan('planR', 1, 'T', 'D', '2025-01-01', '2025-01-02', true, true);
        await addActivitySlots('planR', [
            {id: 'a', title: 'A', day: '2025-01-01', pos: 1, maxAssignees: 1},
            {id: 'b', title: 'B', day: '2025-01-01', pos: 2, maxAssignees: 1},
            {id: 'c', title: 'C', day: '2025-01-02', pos: 1, maxAssignees: 1},
        ]);

        await reorderActivitySlots('planR', [
            {slotId: 'a', pos: 2},
            {slotId: 'b', pos: 1},
        ]);

        const day1 = await AppDataSource.getRepository(ActivitySlot).find({
            where: {planId: 'planR', day: '2025-01-01'},
            order: {pos: 'ASC'}
        });
        expect(day1.map(s => s.id)).toEqual(['b', 'a']); // swapped

        const maxDay1 = await getLastActivitySlotNumber('planR', '2025-01-01');
        const maxDay2 = await getLastActivitySlotNumber('planR', '2025-01-02');
        expect(maxDay1).toBe(2);
        expect(maxDay2).toBe(1);
    });

    test('deleteActivitySlot removes slot', async () => {
        await createActivityPlan('planD', 1, 'T', 'D', '2025-01-01', '2025-01-02', true, true);
        await addActivitySlot('planD', {id: 'toDel', title: 'X', day: '2025-01-01', pos: 1, maxAssignees: 1});
        await deleteActivitySlot('toDel');
        const gone = await AppDataSource.getRepository(ActivitySlot).findOneBy({id: 'toDel'});
        expect(gone).toBeNull();
    });

    test('ensureAssignment throws when slotId missing', async () => {
        await expect(ensureAssignment('', 1, null)).rejects.toThrow('slotId is required');
    });
});

describe('Assignment wrapper helpers + lookups', () => {
    test('assign/unassign for user and guest + slot assignment lookups', async () => {
        await createActivityPlan('planW', 1, 'T', 'D', '2025-01-01', '2025-01-02', true, true);
        await addActivitySlot('planW', {id: 's1', title: 'S', day: '2025-01-01', pos: 1, maxAssignees: 2});

        // Role setup
        await ensureRoleId('helper');
        await ensureRoleId('default');

        // User assignment via wrapper
        await assignActivityAssignmentRoleToUser('s1', 1, 'helper');
        let assignmentsU = await getActivitySlotAssignmentsForUser('planW', 1);
        expect(assignmentsU).toEqual(['s1']);

        const guest = AppDataSource.getRepository(Guest).create({id: 77, username: ""});
        await AppDataSource.getRepository(Guest).save(guest);

        // Guest assignment via wrapper
        await assignActivityAssignmentRoleToGuest('s1', 77, 'default');
        let assignmentsG = await getActivitySlotAssignmentsForGuest('planW', 77);
        expect(assignmentsG).toEqual(['s1']);

        // Unassign user 'helper' -> assignment gets removed (no remaining roles)
        await unassignActivityAssignmentRoleFromUser('s1', 1, 'helper');
        assignmentsU = await getActivitySlotAssignmentsForUser('planW', 1);
        expect(assignmentsU).toEqual([]);

        // Unassign guest 'default' -> assignment removed (special-case default)
        await unassignActivityAssignmentRoleFromGuest('s1', 77, 'default');
        assignmentsG = await getActivitySlotAssignmentsForGuest('planW', 77);
        expect(assignmentsG).toEqual([]);
    });
});
