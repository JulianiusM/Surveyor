import {v4 as uuidv4} from "uuid";
import {
    addActivitySlot,
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
    getLastActivitySlotNumber,
    reorderActivitySlots,
    updateActivitySlot,
} from '../../src/modules/database/services/ActivityService';

import {AppDataSource, initDataSource} from '../../src/modules/database/dataSource';
import {ActivityPlan} from '../../src/modules/database/entities/activity/ActivityPlan';
import {ActivitySlot} from '../../src/modules/database/entities/activity/ActivitySlot';
import {ActivityAssignment} from '../../src/modules/database/entities/activity/ActivityAssignment';
import {ActivityAssignmentRole} from '../../src/modules/database/entities/activity/ActivityAssignmentRole';
import {ActivitySlotRole} from '../../src/modules/database/entities/activity/ActivitySlotRole';
import {Role} from '../../src/modules/database/entities/user/Role';
import {User} from '../../src/modules/database/entities/user/User';
import {Guest} from '../../src/modules/database/entities/user/Guest';

export {}; // make module

// Share same DataSource instance with the service
jest.mock('../../src/modules/database/dataSource', () => require('../util/db/mariadb-datasource.mock'));

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

describe('Edge cases & additional scenarios', () => {
    test('ensureRoleId for non-default marks isDefault=false', async () => {
        const rid = await ensureRoleId('helper');
        const role = await AppDataSource.getRepository(Role).findOneByOrFail({id: rid});
        expect(role).toEqual(expect.objectContaining({name: 'helper', isDefault: 0}));
    });

    test('ensureAssignment reuses existing assignment for same slot/user and for guest', async () => {
        const planId = uuidv4()
        const slotId = uuidv4()
        await createActivityPlan(planId, 1, 'T', 'D', '2025-01-01', '2025-01-02', true, true);
        await addActivitySlot(planId, {id: slotId, title: 'S1', day: '2025-01-01', pos: 1, maxAssignees: 2});

        const u1 = await ensureAssignment(slotId, 1, undefined);
        const u2 = await ensureAssignment(slotId, 1, undefined);
        expect(u2).toBe(u1); // reused

        const guest = AppDataSource.getRepository(Guest).create({id: 1, username: ''});
        await AppDataSource.getRepository(Guest).save(guest);

        const g1 = await ensureAssignment(slotId, undefined, 1);
        const g2 = await ensureAssignment(slotId, undefined, 1);
        expect(g2).toBe(g1); // reused

        const count = await AppDataSource.getRepository(ActivityAssignment).count();
        expect(count).toBe(2); // one user + one guest
    });

    test('assignRole is idempotent for same (assignment, role)', async () => {
        const planId = uuidv4()
        const slotId = uuidv4()
        await createActivityPlan(planId, 1, 'T', 'D', '2025-01-01', '2025-01-02', true, true);
        await addActivitySlot(planId, {id: slotId, title: 'S', day: '2025-01-01', pos: 1, maxAssignees: 2});
        await ensureRoleId('lead');
        const aid = await ensureAssignment(slotId, 1, undefined);

        await assignRole(aid, 'lead');
        await assignRole(aid, 'lead'); // idempotent

        const role = await AppDataSource.getRepository(Role).findOneByOrFail({name: 'lead'});
        const cnt = await AppDataSource.getRepository(ActivityAssignmentRole).count({
            where: {
                assignment: {id: aid},
                role: {id: role.id}
            }
        });
        expect(cnt).toBe(1);
    });

    test('doUnassignRole returns false for unknown role; removing one of multiple roles preserves assignment', async () => {
        const planId = uuidv4()
        const slotId = uuidv4()
        await createActivityPlan(planId, 1, 'T', 'D', '2025-01-01', '2025-01-02', true, true);
        await addActivitySlot(planId, {id: slotId, title: 'S', day: '2025-01-01', pos: 1, maxAssignees: 2});
        await ensureRoleId('lead');
        await ensureRoleId('helper');
        const aid = await ensureAssignment(slotId, 1, undefined);
        await assignRole(aid, 'lead');
        await assignRole(aid, 'helper');

        const unknown = await doUnassignRole(aid, 'does-not-exist');
        expect(unknown).toBe(false); // role not found

        const ok = await doUnassignRole(aid, 'lead');
        expect(ok).toBe(true);

        // assignment should still exist (one role remains)
        const still = await AppDataSource.getRepository(ActivityAssignment).findOneBy({id: aid});
        expect(still).not.toBeNull();

        const roles = await AppDataSource.getRepository(ActivityAssignmentRole).find({where: {assignment: {id: aid}}});
        expect(roles).toHaveLength(1);
    });

    test('createActivityPlanTx with empty slots inserts only the plan', async () => {
        const id = await createActivityPlanTx(1, 'OnlyPlan', 'D', '2025-01-01', '2025-01-02', false, false, []);
        expect(id).toBeTruthy();

        const plan = await AppDataSource.getRepository(ActivityPlan).findOneBy({id});
        expect(plan).toBeTruthy();

        const slotCount = await AppDataSource.getRepository(ActivitySlot).count({where: {plan: {id}}});
        expect(slotCount).toBe(0);
    });

    test('reorderActivitySlots does not affect slots from other plans', async () => {
        const planIdA = uuidv4()
        const slotIdA = uuidv4()
        const planIdB = uuidv4()
        const slotIdB = uuidv4()
        await createActivityPlan(planIdA, 1, 'T', 'D', '2025-01-01', '2025-01-01', true, true);
        await createActivityPlan(planIdB, 1, 'T', 'D', '2025-01-01', '2025-01-01', true, true);

        await addActivitySlot(planIdA, {id: slotIdA, title: 'A1', day: '2025-01-01', pos: 1, maxAssignees: 1});
        await addActivitySlot(planIdB, {id: slotIdB, title: 'B1', day: '2025-01-01', pos: 1, maxAssignees: 1});

        // Try to update b1 via reorder on plan A: should be ignored
        await reorderActivitySlots(planIdA, [{slotId: slotIdB, pos: 5}]);

        const a1 = await AppDataSource.getRepository(ActivitySlot).findOneByOrFail({id: slotIdA});
        const b1 = await AppDataSource.getRepository(ActivitySlot).findOneByOrFail({id: slotIdB});
        expect(a1.pos).toBe(1);
        expect(b1.pos).toBe(1);
    });

    test('getLastActivitySlotNumber returns 0 when none exist for that day', async () => {
        const planId = uuidv4()
        await createActivityPlan(planId, 1, 'T', 'D', '2025-01-01', '2025-01-02', true, true);
        const max = await getLastActivitySlotNumber(planId, '2025-01-01');
        expect(max).toBe(0);
    });

    test('updateActivitySlot can update just one field (pos) without touching others', async () => {
        const planId = uuidv4()
        const slotId = uuidv4()
        await createActivityPlan(planId, 1, 'T', 'D', '2025-01-01', '2025-01-02', true, true);
        await addActivitySlot(planId, {
            id: slotId,
            title: 'Title',
            description: 'Desc',
            day: '2025-01-01',
            pos: 1,
            maxAssignees: 2
        });

        const ok = await updateActivitySlot(slotId, {pos: 10});
        expect(ok).toBe(true);

        const s1 = await AppDataSource.getRepository(ActivitySlot).findOneByOrFail({id: slotId});
        expect(s1.pos).toBe(10);
        expect(s1.title).toBe('Title');
        expect(s1.description).toBe('Desc');
        expect(s1.maxAssignees).toBe(2);
    });

    test('getActivitySlotAssignees returns both user and guest entries with their roles', async () => {
        const planId = uuidv4()
        const slotId = uuidv4()
        await createActivityPlan(planId, 1, 'T', 'D', '2025-01-01', '2025-01-02', true, true);
        await addActivitySlot(planId, {id: slotId, title: 'S', day: '2025-01-01', pos: 1, maxAssignees: 3});

        const user = await AppDataSource.getRepository(User).save(AppDataSource.getRepository(User).create({
            username: 'userA',
            email: 'a@a'
        }));
        const guest = await AppDataSource.getRepository(Guest).save(AppDataSource.getRepository(Guest).create({username: 'guestB'}));

        await ensureRoleId('lead');
        await ensureRoleId('helper');

        const aUser = await ensureAssignment(slotId, user.id, undefined);
        await assignRole(aUser, 'lead');
        const aGuest = await ensureAssignment(slotId, undefined, guest.id);
        await assignRole(aGuest, 'helper');

        const map = await getActivitySlotAssignees(planId);
        expect(map[slotId]).toHaveLength(2);
        const names = map[slotId].map(x => x.name).sort();
        expect(names).toEqual(['guestB', 'userA']);
    });

    test('getActivityPlanParticipants groups by COALESCE(user.username, guest.username)', async () => {
        const planId = uuidv4()
        const slotIdA = uuidv4()
        const slotIdB = uuidv4()
        await createActivityPlan(planId, 1, 'T', 'D', '2025-01-01', '2025-01-02', true, true);
        await addActivitySlots(planId, [
            {id: slotIdA, title: 'A', day: '2025-01-01', pos: 1, maxAssignees: 1},
            {id: slotIdB, title: 'B', day: '2025-01-02', pos: 1, maxAssignees: 1},
        ]);

        const user = await AppDataSource.getRepository(User).save(AppDataSource.getRepository(User).create({
            username: 'sam',
            email: 'sam@x'
        }));
        const guest = await AppDataSource.getRepository(Guest).save(AppDataSource.getRepository(Guest).create({username: 'sam'}));

        await ensureRoleId('alpha');
        await ensureRoleId('beta');

        const a1 = await ensureAssignment(slotIdA, user.id, undefined);
        await assignRole(a1, 'alpha');
        const a2 = await ensureAssignment(slotIdB, undefined, guest.id);
        await assignRole(a2, 'beta');

        const rows = await getActivityPlanParticipants(planId);
        expect(rows).toHaveLength(1);           // grouped by same "name" ('sam')
        expect(rows[0].name).toBe('sam');
        expect(rows[0].count).toBe(2);          // two assignments
        expect(rows[0].roles.sort()).toEqual(['alpha', 'beta']);
    });

    test('deleteActivitySlotAssignment returns DeleteResult with affected=1', async () => {
        const planId = uuidv4()
        const slotId = uuidv4()
        await createActivityPlan(planId, 1, 'T', 'D', '2025-01-01', '2025-01-02', true, true);
        await addActivitySlot(planId, {id: slotId, title: 'S', day: '2025-01-01', pos: 1, maxAssignees: 1});
        const id = await ensureAssignment(slotId, 1, undefined);

        const result = await deleteActivitySlotAssignment(id);
        expect(result).toHaveProperty('affected');
        expect((result as any).affected).toBe(1);
    });
});
