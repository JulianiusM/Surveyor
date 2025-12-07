import {v4 as uuidv4} from 'uuid';
import {
    addActivitySlot,
    addActivitySlotRoles,
    addActivitySlots,
    assignActivityAssignmentRoleToGuest,
    assignActivityAssignmentRoleToUser,
    assignRole,
    createActivityPlan,
    createActivityPlanTx,
    deleteActivityPlan,
    deleteActivitySlot,
    deleteActivitySlotAssignment,
    doUnassignRole,
    ensureAssignment,
    ensureRoleId,
    getAllRoles,
    getActivityPlanById,
    getActivityPlanParticipants,
    getActivityPlansByUserId,
    getActivitySlotAssignees,
    getActivitySlotAssignmentsForGuest,
    getActivitySlotAssignmentsForUser,
    getActivitySlotRoles,
    getActivitySlots,
    getLastActivitySlotNumber,
    reorderActivitySlots,
    unassignActivityAssignmentRoleFromGuest,
    unassignActivityAssignmentRoleFromUser,
    updateActivityPlanDescription,
    updateActivitySlot,
} from '../../src/modules/database/services/ActivityService';

import {AppDataSource, initDataSource} from '../../src/modules/database/dataSource';

// Entities used to set up data quickly
import {ActivityRole} from '../../src/modules/database/entities/activity/ActivityRole';
import {ActivityPlan} from '../../src/modules/database/entities/activity/ActivityPlan';
import {ActivitySlot} from '../../src/modules/database/entities/activity/ActivitySlot';
import {ActivityAssignment} from '../../src/modules/database/entities/activity/ActivityAssignment';
import {ActivityAssignmentRole} from '../../src/modules/database/entities/activity/ActivityAssignmentRole';
import {ActivitySlotRole} from '../../src/modules/database/entities/activity/ActivitySlotRole';
import {User} from '../../src/modules/database/entities/user/User';
import {Guest} from '../../src/modules/database/entities/user/Guest';

// Test data and keywords
import {
    assignmentLifecycleTestData,
    createPlanTxTestData,
    deleteAssignmentTestData,
    planParticipantsTestData,
    roleTestData,
    slotAssigneesTestData,
    slotRolesTestData,
} from '../data/database/activityServiceData';
import {createTestUser} from '../keywords/database/databaseKeywords';


export {}; // make module; avoid global collisions

/**
 * Tests for ActivityService using the mysql (MariaDB/mysql2) DataSource mock.
 * Migrated to data-driven approach with externalized test data.
 */

// Use the mysql/mariadb DataSource for the service
jest.mock('../../src/modules/database/dataSource', () => require('../util/db/mariadb-datasource.mock'));

// Helper to clear relevant tables between tests (order matters due to FKs)
async function truncateAll() {
    await AppDataSource.query('SET FOREIGN_KEY_CHECKS=0');

    await AppDataSource.createQueryBuilder().delete().from(ActivityAssignmentRole).execute();
    await AppDataSource.createQueryBuilder().delete().from(ActivitySlotRole).execute();
    await AppDataSource.createQueryBuilder().delete().from(ActivityAssignment).execute();
    await AppDataSource.createQueryBuilder().delete().from(ActivitySlot).execute();
    await AppDataSource.createQueryBuilder().delete().from(ActivityPlan).execute();
    await AppDataSource.createQueryBuilder().delete().from(ActivityRole).execute();
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
    await createTestUser({id: 1, username: '', name: '', email: ''});
});

afterEach(async () => {
    await truncateAll();
}, 60_000);


// Core functionality tests
describe('Roles and assignments', () => {
    test.each(roleTestData)('$description', async ({roleName, expectedCreations}) => {
        // Create a test plan
        const planId = uuidv4();
        await createActivityPlan(planId, 1, 'Test Plan', 'desc', '2025-01-01', '2025-01-02');
        
        const roles1 = await ensureRoleId(planId, roleName);
        const roles2 = await ensureRoleId(planId, roleName);
        expect(roles1[0].id).toBe(roles2[0].id);

        const roles = await AppDataSource.getRepository(ActivityRole).find({where: {plan: {id: planId}}});
        expect(roles).toHaveLength(expectedCreations);
        expect(roles[0]).toEqual(expect.objectContaining({name: roleName, isDefault: 1}));
    });

    test.each(assignmentLifecycleTestData)(
        '$description',
        async ({plan, slot, userId, guestId, roleName, expectDeletion}) => {
            // Create plan & slot
            const planId = uuidv4();
            const slotId = uuidv4();
            await createActivityPlan(
                planId,
                plan.ownerId,
                plan.title,
                plan.description,
                plan.from,
                plan.to,
            );
            await addActivitySlot(planId, {id: slotId, ...slot});

            // Create assignment
            const assignId = await ensureAssignment(slotId, userId, guestId);
            const aBefore = await AppDataSource.getRepository(ActivityAssignment).findOneByOrFail({
                id: assignId,
            });
            expect(aBefore).toEqual(expect.objectContaining({slotId, planId, userId}));

            // Assign role
            await assignRole(assignId, roleName);
            const aar = await AppDataSource.getRepository(ActivityAssignmentRole).findOneBy({
                assignment: {id: assignId},
            });
            expect(aar).toBeTruthy();

            // Unassign role
            const ok = await doUnassignRole(assignId, roleName);
            expect(ok).toBe(true);

            if (expectDeletion) {
                const aGone = await AppDataSource.getRepository(ActivityAssignment).findOneBy({
                    id: assignId,
                });
                expect(aGone).toBeNull();
            }
        }
    );
});

describe('createActivityPlanTx (with slots)', () => {
    test.each(createPlanTxTestData)('$description', async ({plan, slots}) => {
        const id = await createActivityPlanTx(
            plan.ownerId,
            plan.title,
            plan.description,
            plan.from,
            plan.to,
            slots
        );

        const uuidRegex = new RegExp(
            '^[0-9(a-f|A-F)]{8}-[0-9(a-f|A-F)]{4}-4[0-9(a-f|A-F)]{3}-[89ab][0-9(a-f|A-F)]{3}-[0-9(a-f|A-F)]{12}$'
        );
        expect(id).toMatch(uuidRegex);

        const planEntity = await AppDataSource.getRepository(ActivityPlan).findOneByOrFail({id});
        expect(planEntity).toEqual(
            expect.objectContaining({
                ownerId: plan.ownerId,
                title: plan.title,
                description: plan.description,
            })
        );

        const slotEntities = await AppDataSource.getRepository(ActivitySlot).find({
            where: {plan: {id}},
        });
        expect(slotEntities).toHaveLength(slots.length);
        for (let slot of slotEntities) {
            expect(slot.id).toMatch(uuidRegex);
        }
    });
});

describe('Aggregates and lookups', () => {
    test.each(slotAssigneesTestData)(
        '$description',
        async ({plan, slot, user, roleName, expectedSlotCount}) => {
            // Setup: plan, slot
            const planId = uuidv4();
            const slotId = uuidv4();
            await createActivityPlan(
                planId,
                plan.ownerId,
                plan.title,
                plan.description,
                plan.from,
                plan.to,
            );
            await addActivitySlot(planId, {id: slotId, ...slot});

            // Create user
            const userEntity = await AppDataSource.getRepository(User).save(
                AppDataSource.getRepository(User).create(user)
            );

            await ensureRoleId(planId, roleName);

            // Create assignment
            const assignId = await ensureAssignment(slotId, userEntity.id, undefined);
            await assignRole(assignId, roleName);

            const map = await getActivitySlotAssignees(planId);
            expect(Object.keys(map)).toEqual([slotId]);
            expect(map[slotId]).toHaveLength(expectedSlotCount);

            const entry = map[slotId][0];
            expect(entry).toEqual(
                expect.objectContaining({
                    id: assignId,
                    user_id: userEntity.id,
                    guest_id: null,
                    name: user.username,
                    roles: expect.arrayContaining([roleName]),
                })
            );
        }
    );

    test.each(planParticipantsTestData)(
        '$description',
        async ({plan, slots, user, roles, expectedCount, expectedRoles}) => {
            const planId = uuidv4();
            const slotIds = slots.map(() => uuidv4());

            await createActivityPlan(
                planId,
                plan.ownerId,
                plan.title,
                plan.description,
                plan.from,
                plan.to,
            );

            await addActivitySlots(
                planId,
                slots.map((slot, i) => ({id: slotIds[i], ...slot}))
            );

            const userEntity = await AppDataSource.getRepository(User).save(
                AppDataSource.getRepository(User).create(user)
            );

            // Ensure all roles exist
            for (const roleName of roles) {
                await ensureRoleId(planId, roleName);
            }

            // Create assignments with roles
            for (let i = 0; i < slotIds.length; i++) {
                const assignId = await ensureAssignment(slotIds[i], userEntity.id, undefined);
                await assignRole(assignId, roles[i]);
            }

            const rows = await getActivityPlanParticipants(planId);
            expect(rows).toHaveLength(1);
            expect(rows[0].name).toBe(user.username);
            expect(rows[0].count).toBe(expectedCount);
            expect(rows[0].roles.sort()).toEqual(expectedRoles);
        }
    );

    test.each(slotRolesTestData)(
        '$description',
        async ({plan, slot, roleNames, expectedRoleNames}) => {
            const planId = uuidv4();
            const slotId = uuidv4();

            await createActivityPlan(
                planId,
                plan.ownerId,
                plan.title,
                plan.description,
                plan.from,
                plan.to,
            );
            await addActivitySlot(planId, {id: slotId, ...slot});

            // Ensure roles and get IDs
            const roleIds = [];
            for (const roleName of roleNames) {
                const roles = await ensureRoleId(planId, roleName);
                roleIds.push(roles[0].id);
            }

            await addActivitySlotRoles(slotId, roleIds);

            const map = await getActivitySlotRoles(planId);
            expect(Object.keys(map)).toEqual([slotId]);

            const names = map[slotId].map(r => r.name).sort();
            expect(names).toEqual(expectedRoleNames.sort());
        }
    );

    test.each(deleteAssignmentTestData)('$description', async ({plan, slot, userId}) => {
        const planId = uuidv4();
        const slotId = uuidv4();

        await createActivityPlan(
            planId,
            plan.ownerId,
            plan.title,
            plan.description,
            plan.from,
            plan.to,
        );
        await addActivitySlot(planId, {id: slotId, ...slot});

        const id = await ensureAssignment(slotId, userId, undefined);
        const before = await AppDataSource.getRepository(ActivityAssignment).findOneBy({id});
        expect(before).toBeTruthy();

        await deleteActivitySlotAssignment(id);
        const after = await AppDataSource.getRepository(ActivityAssignment).findOneBy({id});
        expect(after).toBeNull();
    });
});

// Additional CRUD and helper tests
describe('Plan CRUD: get/update/delete/list', () => {
    test('create/get/update flags & description / list by owner / delete', async () => {
        const planId = uuidv4()
        await createActivityPlan(planId, 1, 'TitleZ', 'DescZ', '2025-02-01', '2025-02-02');

        // get by id
        const got = await getActivityPlanById(planId);
        expect(got).toEqual(expect.objectContaining({
            id: planId,
            ownerId: 1,
            title: 'TitleZ',
            description: 'DescZ',
        }));

        // update description
        await updateActivityPlanDescription(planId, 'DescZ+');
        const got3 = await getActivityPlanById(planId);
        expect(got3?.description).toBe('DescZ+');

        // list by owner
        const list = await getActivityPlansByUserId(1);
        expect(list.map(p => p.id)).toContain(planId);

        // delete
        await deleteActivityPlan(planId);
        const gone = await AppDataSource.getRepository(ActivityPlan).findOneBy({id: planId});
        expect(gone).toBeNull();
    });
});

describe('Slot CRUD: add/list/update/reorder/delete/lastNumber', () => {
    test('addActivitySlots + getActivitySlots groups by day and counts assignments', async () => {
        const planId = uuidv4()
        const slotIdA = uuidv4()
        const slotIdB = uuidv4()
        await createActivityPlan(planId, 1, 'T', 'D', '2025-01-01', '2025-01-03');
        await addActivitySlots(planId, [
            {id: slotIdA, title: 'A', day: '2025-01-01', pos: 1, maxAssignees: 2},
            {id: slotIdB, title: 'B', day: '2025-01-02', pos: 1, maxAssignees: 3},
        ]);

        // Add one assignment to s1 so assignedCount = 1
        const user = await AppDataSource.getRepository(User).save(AppDataSource.getRepository(User).create({
            username: 'bob', email: 'b@b',
        }));
        await ensureRoleId(planId, 'default');
        const assignId = await ensureAssignment(slotIdA, user.id);
        await assignRole(assignId, 'default');

        const grouped = await getActivitySlots(planId);
        expect(Object.keys(grouped).sort()).toEqual(['2025-01-01', '2025-01-02']);
        const s1 = (grouped['2025-01-01']![0] as any);
        expect(s1.id).toBe(slotIdA);
        expect(s1.assignedCount).toBe(1);
    });

    test('updateActivitySlot returns undefined for empty input; true for changes and persists them', async () => {
        const planId = uuidv4()
        const slotId = uuidv4()
        await createActivityPlan(planId, 1, 'T', 'D', '2025-01-01', '2025-01-02');
        await addActivitySlot(planId, {id: slotId, title: 'X', day: '2025-01-01', pos: 1, maxAssignees: 1});

        const noChange = await updateActivitySlot(slotId, {});
        expect(noChange).toBeUndefined();

        const ok = await updateActivitySlot(slotId, {title: 'X+', maxAssignees: 5, pos: 3, description: 'New'});
        expect(ok).toBe(true);

        const sx = await AppDataSource.getRepository(ActivitySlot).findOneByOrFail({id: slotId});
        expect(sx).toEqual(expect.objectContaining({title: 'X+', maxAssignees: 5, pos: 3, description: 'New'}));
    });

    test('reorderActivitySlots updates per-slot pos and getLastActivitySlotNumber works per day', async () => {
        const planId = uuidv4()
        const slotIdA = uuidv4()
        const slotIdB = uuidv4()
        const slotIdC = uuidv4()
        await createActivityPlan(planId, 1, 'T', 'D', '2025-01-01', '2025-01-02');
        await addActivitySlots(planId, [
            {id: slotIdA, title: 'A', day: '2025-01-01', pos: 1, maxAssignees: 1},
            {id: slotIdB, title: 'B', day: '2025-01-01', pos: 2, maxAssignees: 1},
            {id: slotIdC, title: 'C', day: '2025-01-02', pos: 1, maxAssignees: 1},
        ]);

        await reorderActivitySlots(planId, [
            {slotId: slotIdA, pos: 2},
            {slotId: slotIdB, pos: 1},
        ]);

        const day1 = await AppDataSource.getRepository(ActivitySlot).find({
            where: {plan: {id: planId}, day: '2025-01-01'},
            order: {pos: 'ASC'}
        });
        expect(day1.map(s => s.id)).toEqual([slotIdB, slotIdA]); // swapped

        const maxDay1 = await getLastActivitySlotNumber(planId, '2025-01-01');
        const maxDay2 = await getLastActivitySlotNumber(planId, '2025-01-02');
        expect(maxDay1).toBe(2);
        expect(maxDay2).toBe(1);
    });

    test('deleteActivitySlot removes slot', async () => {
        const planId = uuidv4()
        const slotId = uuidv4()
        await createActivityPlan(planId, 1, 'T', 'D', '2025-01-01', '2025-01-02');
        await addActivitySlot(planId, {id: slotId, title: 'X', day: '2025-01-01', pos: 1, maxAssignees: 1});
        await deleteActivitySlot(slotId);
        const gone = await AppDataSource.getRepository(ActivitySlot).findOneBy({id: slotId});
        expect(gone).toBeNull();
    });

    test('ensureAssignment throws when slotId missing', async () => {
        await expect(ensureAssignment('', 1, undefined)).rejects.toThrow('slotId is required');
    });
});

describe('Assignment wrapper helpers + lookups', () => {
    test('assign/unassign for user and guest + slot assignment lookups', async () => {
        const planId = uuidv4()
        const slotId = uuidv4()
        await createActivityPlan(planId, 1, 'T', 'D', '2025-01-01', '2025-01-02');
        await addActivitySlot(planId, {id: slotId, title: 'S', day: '2025-01-01', pos: 1, maxAssignees: 2});

        // Role setup
        await ensureRoleId(planId, 'helper');
        await ensureRoleId(planId, 'default');

        // User assignment via wrapper
        await assignActivityAssignmentRoleToUser(slotId, 1, 'helper');
        let assignmentsU = await getActivitySlotAssignmentsForUser(planId, 1);
        expect(assignmentsU).toEqual([slotId]);

        const guest = AppDataSource.getRepository(Guest).create({id: 77, username: ""});
        await AppDataSource.getRepository(Guest).save(guest);

        // Guest assignment via wrapper
        await assignActivityAssignmentRoleToGuest(slotId, 77, 'default');
        let assignmentsG = await getActivitySlotAssignmentsForGuest(planId, 77);
        expect(assignmentsG).toEqual([slotId]);

        // Unassign user 'helper' -> assignment gets removed (no remaining roles)
        await unassignActivityAssignmentRoleFromUser(slotId, 1, 'helper');
        assignmentsU = await getActivitySlotAssignmentsForUser(planId, 1);
        expect(assignmentsU).toEqual([]);

        // Unassign guest 'default' -> assignment removed (special-case default)
        await unassignActivityAssignmentRoleFromGuest(slotId, 77, 'default');
        assignmentsG = await getActivitySlotAssignmentsForGuest(planId, 77);
        expect(assignmentsG).toEqual([]);
    });
});

// Edge cases and additional scenarios
describe('Edge cases & additional scenarios', () => {
    test('ensureRoleId for non-default marks isDefault=false', async () => {
        const planId = uuidv4();
        await createActivityPlan(planId, 1, 'Test Plan', 'desc', '2025-01-01', '2025-01-02');
        const roles = await ensureRoleId(planId, 'helper');
        const role = await AppDataSource.getRepository(ActivityRole).findOneByOrFail({id: roles[0].id});
        expect(role).toEqual(expect.objectContaining({name: 'helper', isDefault: 0}));
    });

    test('ensureAssignment reuses existing assignment for same slot/user and for guest', async () => {
        const planId = uuidv4()
        const slotId = uuidv4()
        await createActivityPlan(planId, 1, 'T', 'D', '2025-01-01', '2025-01-02');
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
        await createActivityPlan(planId, 1, 'T', 'D', '2025-01-01', '2025-01-02');
        await addActivitySlot(planId, {id: slotId, title: 'S', day: '2025-01-01', pos: 1, maxAssignees: 2});
        await ensureRoleId(planId, 'lead');
        const aid = await ensureAssignment(slotId, 1, undefined);

        await assignRole(aid, 'lead');
        await assignRole(aid, 'lead'); // idempotent

        const role = await AppDataSource.getRepository(ActivityRole).findOneByOrFail({name: 'lead'});
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
        await createActivityPlan(planId, 1, 'T', 'D', '2025-01-01', '2025-01-02');
        await addActivitySlot(planId, {id: slotId, title: 'S', day: '2025-01-01', pos: 1, maxAssignees: 2});
        await ensureRoleId(planId, 'lead');
        await ensureRoleId(planId, 'helper');
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
        const id = await createActivityPlanTx(1, 'OnlyPlan', 'D', '2025-01-01', '2025-01-02', []);
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
        await createActivityPlan(planIdA, 1, 'T', 'D', '2025-01-01', '2025-01-01');
        await createActivityPlan(planIdB, 1, 'T', 'D', '2025-01-01', '2025-01-01');

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
        await createActivityPlan(planId, 1, 'T', 'D', '2025-01-01', '2025-01-02');
        const max = await getLastActivitySlotNumber(planId, '2025-01-01');
        expect(max).toBe(0);
    });

    test('updateActivitySlot can update just one field (pos) without touching others', async () => {
        const planId = uuidv4()
        const slotId = uuidv4()
        await createActivityPlan(planId, 1, 'T', 'D', '2025-01-01', '2025-01-02');
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
        await createActivityPlan(planId, 1, 'T', 'D', '2025-01-01', '2025-01-02');
        await addActivitySlot(planId, {id: slotId, title: 'S', day: '2025-01-01', pos: 1, maxAssignees: 3});

        const user = await AppDataSource.getRepository(User).save(AppDataSource.getRepository(User).create({
            username: 'userA',
            email: 'a@a'
        }));
        const guest = await AppDataSource.getRepository(Guest).save(AppDataSource.getRepository(Guest).create({username: 'guestB'}));

        await ensureRoleId(planId, 'lead');
        await ensureRoleId(planId, 'helper');

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
        await createActivityPlan(planId, 1, 'T', 'D', '2025-01-01', '2025-01-02');
        await addActivitySlots(planId, [
            {id: slotIdA, title: 'A', day: '2025-01-01', pos: 1, maxAssignees: 1},
            {id: slotIdB, title: 'B', day: '2025-01-02', pos: 1, maxAssignees: 1},
        ]);

        const user = await AppDataSource.getRepository(User).save(AppDataSource.getRepository(User).create({
            username: 'sam',
            email: 'sam@x'
        }));
        const guest = await AppDataSource.getRepository(Guest).save(AppDataSource.getRepository(Guest).create({username: 'sam'}));

        await ensureRoleId(planId, 'alpha');
        await ensureRoleId(planId, 'beta');

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
        await createActivityPlan(planId, 1, 'T', 'D', '2025-01-01', '2025-01-02');
        await addActivitySlot(planId, {id: slotId, title: 'S', day: '2025-01-01', pos: 1, maxAssignees: 1});
        const id = await ensureAssignment(slotId, 1, undefined);

        const result = await deleteActivitySlotAssignment(id);
        expect(result).toHaveProperty('affected');
        expect((result as any).affected).toBe(1);
    });

    test('getAllRoles returns all roles for a plan', async () => {
        const planId = uuidv4();
        await createActivityPlan(planId, 1, 'Test Plan', 'desc', '2025-01-01', '2025-01-02');
        
        // Create some roles
        await ensureRoleId(planId, 'Admin');
        await ensureRoleId(planId, 'Member');
        
        const allRoles = await getAllRoles(planId);
        const roleNames = allRoles.map(r => r.name).sort();
        expect(roleNames).toEqual(['Admin', 'Member']);
    });
});

