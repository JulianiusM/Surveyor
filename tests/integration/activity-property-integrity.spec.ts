import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import activityController from '../../src/controller/activityController';
import {changeEntityEvent} from '../../src/controller/entityAdminController';
import {buildPlanRecommendationContext, saveGeneratedRecommendations} from '../../src/controller/activityController';
import {ActivityPlan} from '../../src/modules/database/entities/activity/ActivityPlan';
import {Profile} from '../../src/modules/database/entities/user/Profile';
import {AppDataSource} from '../../src/modules/database/dataSource';
import * as activityService from '../../src/modules/database/services/ActivityService';
import * as lifecycleService from '../../src/modules/database/services/EntityLifecycleService';
import * as recommendationService from '../../src/modules/database/services/ActivityRecommendationService';
import * as requirementService from '../../src/modules/database/services/ActivityRequirementService';
import {createStayRequirementSchedule} from '../factories/activityRequirementFactory';
import {
    assignActivitySlot,
    createActivityPlanWithSlot,
    createEventActivityPlan,
    createIntegrationEvent,
    persistIntegrationProfile,
    registerEventAttendance,
} from '../keywords/coreDomainKeywords';
import {closeIntegrationDatabase, initializeIntegrationDatabase} from '../support/database';

let owner: Profile;
let previousParticipant: Profile;
let currentParticipant: Profile;

beforeAll(async function prepareDatabase() {
    await initializeIntegrationDatabase();
    owner = await persistIntegrationProfile();
    previousParticipant = await persistIntegrationProfile();
    currentParticipant = await persistIntegrationProfile();
});
afterAll(closeIntegrationDatabase);

describe('activity property and relationship integrity', () => {
    it('saves a property patch atomically and refuses dates excluding committed slots', async () => {
        const planId = await createActivityPlanWithSlot(owner.id);
        const plan = (await activityService.getActivityPlanById(planId))!;
        const [slot] = await activityService.getActivitySlotsFlat(planId);
        await assignActivitySlot(slot.id, previousParticipant.id);
        await expect(activityController.updateProperties(plan, {
            title: 'Should not persist', startDate: '2027-06-02',
        })).rejects.toMatchObject({status: 409});
        expect(await activityService.getActivityPlanById(planId)).toMatchObject({title: plan.title, startDate: plan.startDate});
        await expect(activityController.updateProperties(plan, {title: 'Also rejected', endDate: '2027-02-30'}))
            .rejects.toMatchObject({status: 400});
        await activityController.updateProperties(plan, {title: 'Expanded plan', description: '', endDate: '2027-06-04'});
        expect(await activityService.getActivityPlanById(planId)).toMatchObject({
            title: 'Expanded plan', description: null, startDate: plan.startDate, endDate: '2027-06-04',
        });
        expect(await activityService.getActivitySlotsFlat(planId)).toEqual([expect.objectContaining({id: slot.id, day: slot.day})]);
        expect(await activityService.getActivitySlotAssignments(planId, previousParticipant.id)).toEqual([slot.id]);
    });

    it('preserves old-event overrides, assignments, manual drafts and review history while recalculating eligibility', async () => {
        const oldEventId = await createIntegrationEvent(owner.id, 'Original activity event');
        const newEventId = await createIntegrationEvent(owner.id, 'Destination activity event');
        await registerEventAttendance(oldEventId, previousParticipant, {arrivalDate: '2027-06-01', departureDate: '2027-06-03'});
        await registerEventAttendance(newEventId, currentParticipant, {arrivalDate: '2027-06-01', departureDate: '2027-06-03'});
        const planId = await createEventActivityPlan(owner.id, oldEventId);
        const [morning, evening] = await activityService.getActivitySlotsFlat(planId);
        await assignActivitySlot(morning.id, previousParticipant.id);
        const settings = {
            assignmentMode: 'REQUIRED', stayRequirements: createStayRequirementSchedule(3, 1),
            roleRequirements: [], overrides: [{profileId: previousParticipant.id, requiredShifts: 2}],
        };
        await activityController.updateRequirements(planId, settings);
        const savedOverrides = (await requirementService.getRequirementConfiguration(planId))!.overrides;
        await recommendationService.replaceRecommendations(planId, [
            {itemId: morning.id, profileId: currentParticipant.id, status: 'PENDING'},
            {itemId: evening.id, profileId: previousParticipant.id, status: 'PENDING', manual: true},
            {itemId: evening.id, profileId: currentParticipant.id, status: 'APPROVED'},
            {itemId: morning.id, profileId: previousParticipant.id, status: 'APPLIED', hidden: true},
            {itemId: evening.id, profileId: owner.id, status: 'REJECTED', hidden: true},
        ]);
        const plan = (await activityService.getActivityPlanById(planId))!;
        await changeEntityEvent('activity', plan, {eventId: newEventId, expectedEventId: oldEventId}, {profile: owner, auth: {user: owner.user!}});
        expect(await activityService.getActivitySlotAssignments(planId, previousParticipant.id)).toEqual([morning.id]);
        expect(await recommendationService.getRecommendations(planId)).toEqual(expect.arrayContaining([
            expect.objectContaining({status: 'PENDING', manual: true}),
            expect.objectContaining({status: 'APPROVED'}),
            expect.objectContaining({status: 'APPLIED'}),
            expect.objectContaining({status: 'REJECTED'}),
        ]));
        expect(await recommendationService.getRecommendations(planId)).toHaveLength(4);

        // Omitted old-event targets are merged from saved rows, not silently removed by an unrelated save.
        await activityController.updateRequirements(planId, {...settings, overrides: [], allowOverfillAfterFull: true});
        const retained = (await requirementService.getRequirementConfiguration(planId))!.overrides;
        expect(retained).toEqual([expect.objectContaining({id: savedOverrides[0].id, profileId: previousParticipant.id, requiredShifts: 2})]);
        await expect(activityController.updateRequirements(planId, {
            ...settings, overrides: [{id: retained[0].id, profileId: previousParticipant.id, requiredShifts: 3}],
        })).rejects.toMatchObject({status: 400});
        await expect(activityController.updateRequirements(planId, {
            ...settings, overrides: [{profileId: previousParticipant.id, requiredShifts: 2}],
        })).rejects.toMatchObject({status: 400});

        const review = await activityController.getRecommendations(planId);
        expect((await activityController.getRequirements(planId)).participants).toContainEqual(expect.objectContaining({
            participantKey: `profile:${previousParticipant.id}`, name: previousParticipant.name, assignedShifts: 1,
        }));
        expect(review.participantOptions.map(function profileId(participant) { return participant.profileId; }))
            .toEqual([currentParticipant.id]);
        expect(review.warnings).toContainEqual(expect.objectContaining({
            recommendation: expect.objectContaining({profileId: previousParticipant.id}),
            warnings: expect.arrayContaining([{type: 'ineligible_participant'}]),
        }));
        await expect(activityController.applyRecommendations(planId, {recommendations: [{
            itemId: evening.id, profileId: previousParticipant.id, status: 'APPROVED', manual: true,
        }]})).rejects.toMatchObject({status: 400});
        expect((await buildPlanRecommendationContext(planId)).participants.map(function profileId(participant) { return participant.profileId; }))
            .toEqual([currentParticipant.id]);

        // The preserved assignee becomes eligible through the existing external policy, not through its override.
        await activityController.updateRequirements(planId, {...settings, overrides: [], allowExternalAssignees: true});
        expect((await buildPlanRecommendationContext(planId)).participants.map(function profileId(participant) { return participant.profileId; }))
            .toEqual(expect.arrayContaining([previousParticipant.id, currentParticipant.id]));
    });

    it('rejects a generation result queued behind relinking under the same plan lock', async () => {
        const oldEventId = await createIntegrationEvent(owner.id, 'Job original event');
        const newEventId = await createIntegrationEvent(owner.id, 'Job destination event');
        const planId = await createEventActivityPlan(owner.id, oldEventId);
        const plan = (await activityService.getActivityPlanById(planId))!;
        const [slot] = await activityService.getActivitySlotsFlat(planId);
        let releaseLink!: () => void;
        let announceLocked!: () => void;
        const locked = new Promise<void>(function captureLocked(resolve) { announceLocked = resolve; });
        const release = new Promise<void>(function captureRelease(resolve) { releaseLink = resolve; });
        // Hold the same DBAL root lock as the production controller. The earlier relink case
        // exercises the complete command; this fixture isolates a generated result queued
        // behind the write without adding a test hook to production authorization.
        const linking = activityService.withActivityTransaction(async function pauseLink(manager) {
            await activityService.lockActivityPlan(manager, planId);
            announceLocked();
            await release;
            await lifecycleService.updateEventAssociation(manager, {type: 'activity', id: planId}, newEventId);
        });
        await locked;
        const staleWrite = saveGeneratedRecommendations(planId, [{itemId: slot.id, profileId: currentParticipant.id}], {
            eventId: oldEventId, startDate: plan.startDate, endDate: plan.endDate,
        });
        const rejected = expect(staleWrite).rejects.toMatchObject({status: 409, data: {reason: 'activity-context-changed'}});
        releaseLink();
        await linking;
        await rejected;
        expect(await recommendationService.getRecommendations(planId)).toEqual([]);
    });

    it('invalidates generated work on date changes while retaining manual work and lifecycle settings', async () => {
        const planId = await createActivityPlanWithSlot(owner.id);
        const [slot] = await activityService.getActivitySlotsFlat(planId);
        const archivedAt = new Date('2026-08-01T00:00:00Z');
        await AppDataSource.getRepository(ActivityPlan).update(planId, {archivedAt, autoArchivePaused: true});
        await recommendationService.replaceRecommendations(planId, [
            {itemId: slot.id, profileId: previousParticipant.id, status: 'PENDING'},
            {itemId: slot.id, profileId: currentParticipant.id, status: 'PENDING', manual: true},
        ]);
        const plan = (await activityService.getActivityPlanById(planId))!;
        await activityController.updateProperties(plan, {endDate: '2027-06-04'});
        expect(await recommendationService.getRecommendations(planId)).toEqual([expect.objectContaining({manual: true})]);
        expect(await activityService.getActivityPlanById(planId)).toMatchObject({archivedAt, autoArchivePaused: true});
    });

    it('refuses a cancelled job even when its original relationship and dates match again', async () => {
        const planId = await createActivityPlanWithSlot(owner.id);
        const plan = (await activityService.getActivityPlanById(planId))!;
        const [slot] = await activityService.getActivitySlotsFlat(planId);
        await expect(saveGeneratedRecommendations(planId, [
            {itemId: slot.id, profileId: currentParticipant.id},
        ], {
            eventId: null, startDate: plan.startDate, endDate: plan.endDate,
            isCurrent: function cancelledJob() { return false; },
        })).rejects.toMatchObject({status: 409, data: {reason: 'activity-context-changed'}});
        expect(await recommendationService.getRecommendations(planId)).toEqual([]);
    });
});
