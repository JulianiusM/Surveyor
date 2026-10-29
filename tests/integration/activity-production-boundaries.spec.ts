import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import * as activityController from '../../src/backend/controller/activityController';
import {calculateBaselineRequirement} from '../../src/backend/modules/activity/autoAssignment';

import {applyRecommendations, updateRecommendations} from '../../src/backend/modules/activity/recommendations';
import * as activityService from '../../src/backend/modules/database/services/ActivityService';
import * as recommendationService from '../../src/backend/modules/database/services/ActivityRecommendationService';
import {AppDataSource} from '../../src/backend/modules/database/dataSource';
import {ActivityPlanStayRequirement} from '../../src/backend/modules/database/entities/activity/ActivityPlanStayRequirement';
import {ActivityAssignmentRecommendation} from '../../src/backend/modules/database/entities/activity/ActivityAssignmentRecommendation';
import {AddActivityRecommendationPairing1793232000000} from '../../src/backend/migrations/1793232000000-AddActivityRecommendationPairing';
import settings from '../../src/backend/modules/settings';
import {assignActivitySlot, createEventActivityPlan, createIntegrationEvent, persistIntegrationProfile,
    registerEventAttendance} from '../keywords/coreDomainKeywords';
import {closeIntegrationDatabase, initializeIntegrationDatabase} from '../support/database';

beforeAll(initializeIntegrationDatabase);
afterAll(closeIntegrationDatabase);

describe('Activity production boundaries', () => {
    it('migrates saved legacy operations without guessing pairing and remains repeatable', async () => {
        const owner = await persistIntegrationProfile();
        const eventId = await createIntegrationEvent(owner.id, 'Legacy pairing schema');
        const planId = await createEventActivityPlan(owner.id, eventId);
        const [first, second] = await activityService.getActivitySlotsFlat(planId);
        const repository = AppDataSource.getRepository(ActivityAssignmentRecommendation);
        const legacy = await repository.save(repository.create({entity: {id: planId}, item: {id: second.id}, sourceItem: {id: first.id},
            profile: {id: owner.id}, operation: 'REASSIGN', status: 'PENDING', manual: true}));
        const runner = AppDataSource.createQueryRunner();
        const migration = new AddActivityRecommendationPairing1793232000000();
        try {
            // Remove only the new columns on the guarded disposable schema,
            // reproducing a real pre-upgrade recommendation table with saved data.
            await migration.down(runner);
            await migration.up(runner);
            await migration.up(runner);
            expect(await repository.findOneByOrFail({id: legacy.id})).toMatchObject({
                id: legacy.id, pairingKnown: false, swapGroup: null, operation: 'REASSIGN', status: 'PENDING', manual: true,
            });
        } finally {
            await migration.up(runner);
            await runner.release();
        }
    });

    it('enforces the configured new-plan limit before writes while retaining oversized saved data in bounded windows/pages', async () => {
        const owner = await persistIntegrationProfile();
        const eventId = await createIntegrationEvent(owner.id, 'Oversized saved plan');
        const planId = await createEventActivityPlan(owner.id, eventId);
        const originalMaximum = settings.value.activityMaxDurationDays;
        try {
            settings.value.activityMaxDurationDays = 30;
            expect(() => activityController.preprocessCreate({startDate: '2027-01-01', endDate: '2027-02-01', slots: '{}'}))
                .toThrowError(expect.objectContaining({cause: 'ACTIVITY_DURATION_LIMIT'}));
            // Seed an existing long range through DBAL, never through newly restricted admission.
            await activityService.updateActivityPlanProperties(planId, {startDate: '2027-06-01', endDate: '2028-06-01'});
            const repository = AppDataSource.getRepository(ActivityPlanStayRequirement);
            await repository.save(Array.from({length: 205}, (_, index) => repository.create({
                entity: {id: planId}, stayDays: index + 1, requiredShifts: index % 5,
            })));
            await registerEventAttendance(eventId, owner, {arrivalDate: '2027-06-01', departureDate: '2027-06-03'});
            const dinner = (await activityService.getActivitySlotsFlat(planId)).find(slot => slot.title === 'Dinner cleanup')!;
            await activityController.setActivityAssignment(planId, dinner.id, {assigned: true}, {profile: owner});
            expect(await activityService.getActivitySlotAssignments(planId, owner.id)).toEqual([dinner.id]);
            const plan = (await activityService.getActivityPlanById(planId))!;
            const view = await activityController.readActivityPlan(planId, {profile: owner}, undefined, {windowStart: '2028-01-01'});
            expect(view.data.weeks.flatMap(week => week.days)).toHaveLength(42);
            expect(view.data.slots).toEqual([]);
            expect(view.data.startDate).toBe('2027-06-01');
            expect(view.data.endDate).toBe('2028-06-01');
            const print = await activityController.getScheduleExport(plan, '2028-06-01');
            expect(print.days).toHaveLength(1);
            const first = await activityController.readActivityRequirements(planId, {profile: owner});
            const last = await activityController.readActivityRequirements(planId, {profile: owner}, 3);
            expect(first.paging).toMatchObject({readOnly: true, page: 1, pages: 3, total: 205, maxDurationDays: 30});
            expect(first.stayRequirements).toHaveLength(100);
            expect(last.stayRequirements).toHaveLength(5);
            expect(last.stayRequirements[0]!.stayDays).toBe(201);
            await expect(calculateBaselineRequirement(planId)).rejects.toMatchObject({cause: 'ACTIVITY_REQUIREMENTS_OVERSIZED'});
            await expect(activityController.updateRequirements(planId, {stayRequirements: []})).rejects.toMatchObject({cause: 'ACTIVITY_REQUIREMENTS_OVERSIZED'});
            // Rejected editing/calculation and bounded reads must preserve every saved duration.
            expect(await repository.countBy({entity: {id: planId}})).toBe(205);
            await expect(activityController.updateProperties(plan, {endDate: '2029-06-01'})).rejects.toMatchObject({cause: 'ACTIVITY_DURATION_LIMIT'});
            await expect(activityController.updateProperties(plan, {endDate: '2028-05-01'})).resolves.toBe('Activity plan updated');
            await activityController.updateProperties(plan, {endDate: '2027-06-10'});
            await activityController.updateRequirements(planId, {stayRequirements: [{stayDays: 1, requiredShifts: 4}]});
            expect(await repository.countBy({entity: {id: planId}})).toBe(196);
            expect(await repository.findOneBy({entity: {id: planId}, stayDays: 201})).toMatchObject({requiredShifts: 0});
            const shortened = (await activityService.getActivityPlanById(planId))!;
            await activityController.updateProperties(shortened, {endDate: '2027-06-20'});
            const restored = await activityController.readActivityRequirements(planId, {profile: owner});
            expect(restored.stayRequirements).toContainEqual({stayDays: 20, requiredShifts: 4});
            expect(restored.stayRequirements.some(row => row.stayDays > 20)).toBe(false);
        } finally {
            settings.value.activityMaxDurationDays = originalMaximum;
        }
    });

    it('requires explicit legacy move intent and preserves stored pairing through review and application', async () => {
        const owner = await persistIntegrationProfile();
        const person = await persistIntegrationProfile();
        const eventId = await createIntegrationEvent(owner.id, 'Legacy pairing intent');
        await registerEventAttendance(eventId, person, {arrivalDate: '2027-06-01', departureDate: '2027-06-03'});
        const planId = await createEventActivityPlan(owner.id, eventId);
        const [first, second] = await activityService.getActivitySlotsFlat(planId);
        await assignActivitySlot(first.id, person.id);
        const repository = AppDataSource.getRepository(ActivityAssignmentRecommendation);
        const legacy = await repository.save(repository.create({entity: {id: planId}, item: {id: second.id}, sourceItem: {id: first.id},
            profile: {id: person.id}, operation: 'REASSIGN', status: 'APPROVED', manual: true}));
        expect(legacy.pairingKnown).toBe(false);
        await expect(applyRecommendations(planId)).rejects.toMatchObject({cause: 'ACTIVITY_SWAP_PAIR_REQUIRED'});
        expect(await activityService.getActivitySlotAssignments(planId, person.id)).toEqual([first.id]);
        await updateRecommendations(planId, {recommendations: [{id: legacy.id, itemId: second.id, sourceItemId: first.id,
                profileId: person.id, status: 'APPROVED', operation: 'REASSIGN', manual: true, swapGroup: null}]});
        const saved = await recommendationService.getRecommendations(planId);
        expect(saved).toHaveLength(1);
        expect(saved[0]).toMatchObject({pairingKnown: true, swapGroup: null});
        expect((await applyRecommendations(planId)).applied).toBe(1);
        expect(await activityService.getActivitySlotAssignments(planId, person.id)).toEqual([second.id]);
    });

    it('does not block independent reciprocal moves when one participant cannot attend its target', async () => {
        // Reproduce against public backend operations and real persisted assignments.
        // These are four explicitly independent moves, not two inferred swaps.
        const owner = await persistIntegrationProfile();
        const people = await Promise.all(Array.from({length: 4}, () => persistIntegrationProfile()));
        const eventId = await createIntegrationEvent(owner.id, 'Independent reciprocal moves');
        for (const [index, person] of people.entries()) {
            await registerEventAttendance(eventId, person, {
                arrivalDate: '2027-06-01', departureDate: index === 0 ? '2027-06-02' : '2027-06-03',
            });
        }
        const planId = await createEventActivityPlan(owner.id, eventId);
        const [first, second] = await activityService.getActivitySlotsFlat(planId);
        // Arrival-day mornings are independently forbidden. Use an admitted
        // evening source so only the first person's departure-evening target blocks.
        await activityService.updateActivitySlot(first.id, {maxAssignees: 3, startTime: '18:00', endTime: '19:00'});
        await activityService.updateActivitySlot(second.id, {maxAssignees: 3});
        await assignActivitySlot(first.id, people[0]!.id);
        await assignActivitySlot(second.id, people[1]!.id);
        await assignActivitySlot(first.id, people[2]!.id);
        await assignActivitySlot(second.id, people[3]!.id);

        const result = await applyRecommendations(planId, {recommendations: people.map((person, index) => ({
                itemId: index % 2 === 0 ? second.id : first.id,
                sourceItemId: index % 2 === 0 ? first.id : second.id,
                profileId: person.id, status: 'APPROVED', operation: 'REASSIGN', manual: true, swapGroup: null,
            }))});

        // The first target is a forbidden departure evening. Other independent moves
        // fit after projection; reciprocal endpoints cannot supply pair intent.
        expect(result.applied).toBe(3);
        expect(result.skipped).toBe(1);
        expect(await activityService.getActivitySlotAssignments(planId, people[0]!.id)).toEqual([first.id]);
        expect(await activityService.getActivitySlotAssignments(planId, people[2]!.id)).toEqual([second.id]);
    });

    it.each([false, true])('blocks only the explicitly paired swap regardless of payload order (%s)', async reverse => {
        const owner = await persistIntegrationProfile();
        const people = await Promise.all(Array.from({length: 4}, () => persistIntegrationProfile()));
        const eventId = await createIntegrationEvent(owner.id, 'Distinct persisted swap pairs');
        for (const [index, person] of people.entries()) {
            await registerEventAttendance(eventId, person, {
                arrivalDate: '2027-06-01', departureDate: index === 0 ? '2027-06-02' : '2027-06-03',
            });
        }
        const planId = await createEventActivityPlan(owner.id, eventId);
        const [first, second] = await activityService.getActivitySlotsFlat(planId);
        await activityService.updateActivitySlot(first.id, {maxAssignees: 2, startTime: '18:00', endTime: '19:00'});
        await activityService.updateActivitySlot(second.id, {maxAssignees: 2});
        for (const [index, person] of people.entries()) await assignActivitySlot(index % 2 ? second.id : first.id, person.id);
        const recommendations = people.map((person, index) => ({
            itemId: index % 2 === 0 ? second.id : first.id, sourceItemId: index % 2 === 0 ? first.id : second.id,
            profileId: person.id, status: 'APPROVED', operation: 'REASSIGN', manual: true,
            swapGroup: index < 2 ? 'first-pair' : 'second-pair',
        }));
        const result = await applyRecommendations(planId, {recommendations: reverse ? recommendations.reverse() : recommendations});
        expect(result).toMatchObject({applied: 2, skipped: 2});
        expect(await activityService.getActivitySlotAssignments(planId, people[0]!.id)).toEqual([first.id]);
        expect(await activityService.getActivitySlotAssignments(planId, people[1]!.id)).toEqual([second.id]);
        expect(await activityService.getActivitySlotAssignments(planId, people[2]!.id)).toEqual([second.id]);
        expect(await activityService.getActivitySlotAssignments(planId, people[3]!.id)).toEqual([first.id]);
        expect((await recommendationService.getRecommendations(planId)).filter(row => row.swapGroup === 'second-pair'))
            .toEqual(expect.arrayContaining([expect.objectContaining({pairingKnown: true, status: 'APPLIED'})]));
    });

    it('refuses pairing rollback before dropping either column when reviewed intent exists', async () => {
        const owner = await persistIntegrationProfile();
        const eventId = await createIntegrationEvent(owner.id, 'Reviewed pairing rollback safety');
        const planId = await createEventActivityPlan(owner.id, eventId);
        const [slot] = await activityService.getActivitySlotsFlat(planId);
        await recommendationService.saveRecommendations(planId, [{itemId: slot.id, profileId: owner.id,
            operation: 'ASSIGN', status: 'PENDING', swapGroup: null}]);
        const runner = AppDataSource.createQueryRunner();
        try {
            await expect(new AddActivityRecommendationPairing1793232000000().down(runner))
                .rejects.toThrow('restore the paired database backup');
            expect(await runner.hasColumn('activity_assignment_recommendations', 'pairing_known')).toBe(true);
            expect(await runner.hasColumn('activity_assignment_recommendations', 'swap_group')).toBe(true);
            expect((await recommendationService.getRecommendations(planId))[0]).toMatchObject({pairingKnown: true, swapGroup: null});
        } finally {
            await runner.release();
        }
    });
});
