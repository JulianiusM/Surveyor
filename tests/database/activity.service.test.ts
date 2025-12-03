import { v4 as uuidv4 } from 'uuid';
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

import { AppDataSource, initDataSource } from '../../src/modules/database/dataSource';

// Entities used to set up data quickly
import { Role } from '../../src/modules/database/entities/user/Role';
import { ActivityPlan } from '../../src/modules/database/entities/activity/ActivityPlan';
import { ActivitySlot } from '../../src/modules/database/entities/activity/ActivitySlot';
import { ActivityAssignment } from '../../src/modules/database/entities/activity/ActivityAssignment';
import { ActivityAssignmentRole } from '../../src/modules/database/entities/activity/ActivityAssignmentRole';
import { ActivitySlotRole } from '../../src/modules/database/entities/activity/ActivitySlotRole';
import { User } from '../../src/modules/database/entities/user/User';
import { Guest } from '../../src/modules/database/entities/user/Guest';

// Test data and keywords
import {
    roleTestData,
    assignmentLifecycleTestData,
    createPlanTxTestData,
    slotAssigneesTestData,
    planParticipantsTestData,
    slotRolesTestData,
    deleteAssignmentTestData,
} from '../data/database/activityServiceData';
import { createTestUser } from '../keywords/database/databaseKeywords';

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
    await createTestUser({ id: 1, username: '', name: '', email: '' });
});

afterEach(async () => {
    await truncateAll();
}, 60_000);

describe('Roles and assignments', () => {
    test.each(roleTestData)('$description', async ({ roleName, expectedCreations }) => {
        const id1 = await ensureRoleId(roleName);
        const id2 = await ensureRoleId(roleName);
        expect(id1).toBe(id2);

        const roles = await AppDataSource.getRepository(Role).find();
        expect(roles).toHaveLength(expectedCreations);
        expect(roles[0]).toEqual(expect.objectContaining({ name: roleName, isDefault: 1 }));
    });

    test.each(assignmentLifecycleTestData)(
        '$description',
        async ({ plan, slot, userId, guestId, roleName, expectDeletion }) => {
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
            await addActivitySlot(planId, { id: slotId, ...slot });

            // Create assignment
            const assignId = await ensureAssignment(slotId, userId, guestId);
            const aBefore = await AppDataSource.getRepository(ActivityAssignment).findOneByOrFail({
                id: assignId,
            });
            expect(aBefore).toEqual(expect.objectContaining({ slotId, planId, userId }));

            // Assign role
            await assignRole(assignId, roleName);
            const aar = await AppDataSource.getRepository(ActivityAssignmentRole).findOneBy({
                assignment: { id: assignId },
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
    test.each(createPlanTxTestData)('$description', async ({ plan, slots }) => {
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

        const planEntity = await AppDataSource.getRepository(ActivityPlan).findOneByOrFail({ id });
        expect(planEntity).toEqual(
            expect.objectContaining({
                ownerId: plan.ownerId,
                title: plan.title,
                description: plan.description,
            })
        );

        const slotEntities = await AppDataSource.getRepository(ActivitySlot).find({
            where: { plan: { id } },
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
        async ({ plan, slot, user, roleName, expectedSlotCount }) => {
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
            await addActivitySlot(planId, { id: slotId, ...slot });

            // Create user
            const userEntity = await AppDataSource.getRepository(User).save(
                AppDataSource.getRepository(User).create(user)
            );

            await ensureRoleId(roleName);

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
        async ({ plan, slots, user, roles, expectedCount, expectedRoles }) => {
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
                slots.map((slot, i) => ({ id: slotIds[i], ...slot }))
            );

            const userEntity = await AppDataSource.getRepository(User).save(
                AppDataSource.getRepository(User).create(user)
            );

            // Ensure all roles exist
            for (const roleName of roles) {
                await ensureRoleId(roleName);
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
        async ({ plan, slot, roleNames, expectedRoleNames }) => {
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
            await addActivitySlot(planId, { id: slotId, ...slot });

            // Ensure roles and get IDs
            const roleIds = [];
            for (const roleName of roleNames) {
                const roleId = await ensureRoleId(roleName);
                roleIds.push(roleId);
            }

            await addActivitySlotRoles(slotId, roleIds);

            const map = await getActivitySlotRoles(planId);
            expect(Object.keys(map)).toEqual([slotId]);

            const names = map[slotId].map(r => r.name).sort();
            expect(names).toEqual(expectedRoleNames.sort());
        }
    );

    test.each(deleteAssignmentTestData)('$description', async ({ plan, slot, userId }) => {
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
        await addActivitySlot(planId, { id: slotId, ...slot });

        const id = await ensureAssignment(slotId, userId, undefined);
        const before = await AppDataSource.getRepository(ActivityAssignment).findOneBy({ id });
        expect(before).toBeTruthy();

        await deleteActivitySlotAssignment(id);
        const after = await AppDataSource.getRepository(ActivityAssignment).findOneBy({ id });
        expect(after).toBeNull();
    });
});

