export {}; // make module; avoid global collisions

/**
 * Tests for ActivityService using the mysql (MariaDB/mysql2) DataSource mock.
 * Assumes you already have `tests/db/mariadb-datasource.mock.ts` and Jest configured to load envs.
 *
 * IMPORTANT:
 *  - We explicitly mock AppDataSource import used by the service, so both the test
 *    and ActivityService share the same instance.
 *  - Ensure mysql2 is installed and the test DB is reachable.
 */

// Use the mysql/mariadb DataSource for the service
jest.mock('../../src/modules/database/dataSource', () => require('../util/db/mariadb-datasource.mock'));

import {
    addActivitySlot,
    addActivitySlotRoles,
    addActivitySlots,
    assignRole,
    createActivityPlan,
    createActivityPlanTx,
    deleteActivitySlotAssignment,
    doUnassignRole,
    ensureAssignment,
    ensureRoleId,
    getActivityPlanParticipants,
    getActivitySlotAssignees,
    getActivitySlotRoles,
} from '../../src/modules/database/services/ActivityService';

import {AppDataSource, initDataSource} from '../../src/modules/database/dataSource';

// Entities used to set up data quickly
import {Role} from '../../src/modules/database/entities/user/Role';
import {ActivityPlan} from '../../src/modules/database/entities/activity/ActivityPlan';
import {ActivitySlot} from '../../src/modules/database/entities/activity/ActivitySlot';
import {ActivityAssignment} from '../../src/modules/database/entities/activity/ActivityAssignment';
import {ActivityAssignmentRole} from '../../src/modules/database/entities/activity/ActivityAssignmentRole';
import {ActivitySlotRole} from '../../src/modules/database/entities/activity/ActivitySlotRole';
import {User} from '../../src/modules/database/entities/user/User';
import {Guest} from '../../src/modules/database/entities/user/Guest';

// Helper to clear relevant tables between tests (order matters due to FKs)
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
    // Ensure a clean schema for test run (idempotent across suites)
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

describe('Roles and assignments', () => {
    test('ensureRoleId creates default role once and returns stable id', async () => {
        const id1 = await ensureRoleId('default');
        const id2 = await ensureRoleId('default');
        expect(id1).toBe(id2);

        const roles = await AppDataSource.getRepository(Role).find();
        expect(roles).toHaveLength(1);
        expect(roles[0]).toEqual(expect.objectContaining({name: 'default', isDefault: 1}));
    });

    test('ensureAssignment + assignRole + doUnassignRole lifecycle', async () => {
        // Create plan & slot
        await createActivityPlan('planA', 1, 'T', 'D', '2025-01-01', '2025-01-02', true, true);
        await addActivitySlot('planA', {id: 'slot1', title: 'S1', day: '2025-01-01', pos: 1, maxAssignees: 5});

        // Create assignment for user 10
        const assignId = await ensureAssignment('slot1', 1, null);
        const aBefore = await AppDataSource.getRepository(ActivityAssignment).findOneByOrFail({id: assignId});
        expect(aBefore).toEqual(expect.objectContaining({slotId: 'slot1', planId: 'planA', userId: 1}));

        // Assign default role
        await assignRole(assignId, 'default');
        const aar = await AppDataSource.getRepository(ActivityAssignmentRole).findOneBy({assignmentId: assignId});
        expect(aar).toBeTruthy();

        // Unassign default -> should delete assignment (remaining 0 || roleName === 'default')
        const ok = await doUnassignRole(assignId, 'default');
        expect(ok).toBe(true);
        const aGone = await AppDataSource.getRepository(ActivityAssignment).findOneBy({id: assignId});
        expect(aGone).toBeNull();
    });
});

describe('createActivityPlanTx (with slots)', () => {
    test('inserts plan + slots and returns the new plan id', async () => {
        const id = await createActivityPlanTx(
            1, 'Title', 'Desc', '2025-01-01', '2025-01-02', true, false,
            [
                {title: 'A', day: '2025-01-01', pos: 1, maxAssignees: 2},
                {title: 'B', day: '2025-01-02', pos: 1, maxAssignees: 3},
            ]
        );

        const uuidRegex = new RegExp('^[0-9(a-f|A-F)]{8}-[0-9(a-f|A-F)]{4}-4[0-9(a-f|A-F)]{3}-[89ab][0-9(a-f|A-F)]{3}-[0-9(a-f|A-F)]{12}$');
        expect(id).toMatch(uuidRegex);
        const plan = await AppDataSource.getRepository(ActivityPlan).findOneByOrFail({id});
        expect(plan).toEqual(expect.objectContaining({ownerId: 1, title: 'Title', description: 'Desc'}));
        const slots = await AppDataSource.getRepository(ActivitySlot).find({where: {planId: id}});
        for (let slot of slots) {
            expect(slot.id).toMatch(uuidRegex);
        }
    });
});

describe('Aggregates and lookups', () => {
    test('getActivitySlotAssignees returns map with assignee name and roles', async () => {
        // Setup: plan, user, role, slot, assignment, assignment role
        await createActivityPlan('planC', 1, 'T', 'D', '2025-01-01', '2025-01-02', true, true);
        await addActivitySlot('planC', {id: 'slot1', title: 'S1', day: '2025-01-01', pos: 1, maxAssignees: 5});

        const user = await AppDataSource.getRepository(User).save(AppDataSource.getRepository(User).create({
            username: 'U1',
            email: 'u1@example.com',
        }));

        await ensureRoleId('lead');

        // Create assignment directly
        const assignId = await ensureAssignment('slot1', user.id, null);
        await assignRole(assignId, 'lead');

        const map = await getActivitySlotAssignees('planC');
        expect(Object.keys(map)).toEqual(['slot1']);
        expect(map['slot1']).toHaveLength(1);
        const entry = map['slot1'][0];
        expect(entry).toEqual(expect.objectContaining({
            id: assignId,
            user_id: user.id,
            guest_id: null,
            name: 'U1',
            roles: expect.arrayContaining(['lead']),
        }));
    });

    test('getActivityPlanParticipants aggregates distinct assignments and roles per name', async () => {
        await createActivityPlan('planP', 1, 'T', 'D', '2025-01-01', '2025-01-02', true, true);
        await addActivitySlots('planP', [
            {id: 'sa', title: 'A', day: '2025-01-01', pos: 1, maxAssignees: 1},
            {id: 'sb', title: 'B', day: '2025-01-01', pos: 2, maxAssignees: 1},
        ]);

        const user = await AppDataSource.getRepository(User).save(AppDataSource.getRepository(User).create({
            username: 'alice',
            email: 'alice@example.com',
        }));

        await ensureRoleId('lead');
        await ensureRoleId('helper');

        const a1 = await ensureAssignment('sa', user.id, null);
        await assignRole(a1, 'lead');
        const a2 = await ensureAssignment('sb', user.id, null);
        await assignRole(a2, 'helper');

        const rows = await getActivityPlanParticipants('planP');
        expect(rows).toHaveLength(1);
        expect(rows[0].name).toBe('alice');
        expect(rows[0].count).toBe(2);
        expect(rows[0].roles.sort()).toEqual(['helper', 'lead']);
    });

    test('addActivitySlotRoles + getActivitySlotRoles maps slot->roles', async () => {
        await createActivityPlan('planR', 1, 'T', 'D', '2025-01-01', '2025-01-02', true, true);
        await addActivitySlot('planR', {id: 's1', title: 'S', day: '2025-01-01', pos: 1, maxAssignees: 2});

        const r1 = await ensureRoleId('helper');
        const r2 = await ensureRoleId('lead');

        await addActivitySlotRoles('s1', [r1, r2]);

        const map = await getActivitySlotRoles('planR');
        expect(Object.keys(map)).toEqual(['s1']);
        const names = map['s1'].map(r => r.name).sort();
        expect(names).toEqual(['helper', 'lead']);
    });

    test('deleteActivitySlotAssignment removes assignment', async () => {
        await createActivityPlan('planD', 1, 'T', 'D', '2025-01-01', '2025-01-02', true, true);
        await addActivitySlot('planD', {id: 'slotX', title: 'X', day: '2025-01-01', pos: 1, maxAssignees: 1});

        const id = await ensureAssignment('slotX', 1, null);
        const before = await AppDataSource.getRepository(ActivityAssignment).findOneBy({id});
        expect(before).toBeTruthy();

        await deleteActivitySlotAssignment(id);
        const after = await AppDataSource.getRepository(ActivityAssignment).findOneBy({id});
        expect(after).toBeNull();
    });
});
