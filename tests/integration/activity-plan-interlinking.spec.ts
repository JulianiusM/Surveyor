import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {Request} from 'express';
import {randomUUID} from 'node:crypto';
import activityController, {buildPlanRecommendationContext, saveGeneratedRecommendations} from '../../src/controller/activityController';
import {changeEntityEvent} from '../../src/controller/entityAdminController';
import {generateFairRecommendations} from '../../src/modules/activity/fairAssignment';
import {fingerprintRecommendationContext} from '../../src/modules/activity/recommendationJobs';
import {AppDataSource} from '../../src/modules/database/dataSource';
import {ActivityPlan} from '../../src/modules/database/entities/activity/ActivityPlan';
import {ActivitySlot} from '../../src/modules/database/entities/activity/ActivitySlot';
import {Profile} from '../../src/modules/database/entities/user/Profile';
import * as activityService from '../../src/modules/database/services/ActivityService';
import * as recommendationService from '../../src/modules/database/services/ActivityRecommendationService';
import type {RecommendationInput} from '../../src/types/ActivityTypes';
import {createActivitySlotEntity} from '../factories/integrationEntityFactory';
import {createStayRequirementSchedule} from '../factories/activityRequirementFactory';
import {createIntegrationEvent, persistIntegrationProfile, registerEventAttendance} from '../keywords/coreDomainKeywords';
import {closeIntegrationDatabase, initializeIntegrationDatabase} from '../support/database';

let owner: Profile;
let participant: Profile;
beforeAll(async function prepareDatabase() {
    await initializeIntegrationDatabase();
    owner = await persistIntegrationProfile();
    participant = await persistIntegrationProfile();
});
afterAll(closeIntegrationDatabase);

/** Fresh relationships isolate each observable workflow while using real controller and TypeORM boundaries. */
async function createLinkedFixture() {
    const eventId = await createIntegrationEvent(owner.id, 'Interlinked activity event');
    await registerEventAttendance(eventId, participant, {arrivalDate: '2027-06-01', departureDate: '2027-06-03'});
    async function createPlan(title: string) {
        const slot = createActivitySlotEntity({id: randomUUID(), day: '2027-06-02', startTime: '09:00', endTime: '10:00'});
        const input = activityController.preprocessCreate({
            title, description: 'Interlinked participant commitments', startDate: '2027-06-01', endDate: '2027-06-03', event_id: eventId,
            slots: JSON.stringify({'2027-06-02': [slot]}),
        });
        const planId = await activityController.createEntity(owner.id, input);
        return {id: planId, slot: (await activityService.getActivitySlotsFlat(planId))[0]};
    }
    return {eventId, first: await createPlan('Required duties'), second: await createPlan('Optional activity')};
}

function participantSession(): Request['session'] {
    return ({session: {profile: participant}} as Request).session;
}
function ownerSession() { return {profile: owner}; }

async function assign(slotId: string, overlapConfirmation?: string): Promise<void> {
    await activityController.getAssignmentAccessMapping().assign({itemId: slotId, overlapConfirmation}, participant.id);
}

async function requireOneShift(planId: string): Promise<void> {
    await activityController.updateRequirements(planId, {
        assignmentMode: 'REQUIRED', stayRequirements: createStayRequirementSchedule(3, 1),
        roleRequirements: [], overrides: [],
    });
}

function approvedManual(slotId: string): RecommendationInput {
    return {itemId: slotId, profileId: participant.id, status: 'APPROVED', operation: 'ASSIGN', manual: true};
}

describe('activity plan interlinking', () => {
    it('warns for participant signups and requires confirmation without removing either assignment', async () => {
        const {first, second} = await createLinkedFixture();
        await assign(second.slot.id);
        const preview = await activityController.getAssignmentWarningPreview(first.id, first.slot.id, participantSession());
        expect(preview.warnings).toContainEqual(expect.objectContaining({type: 'overlap', confirmable: true}));
        expect(preview.overlapConfirmation).toMatch(/^[a-f0-9]{64}$/);
        await expect(assign(first.slot.id)).rejects.toMatchObject({status: 409});
        expect(await activityService.getActivitySlotAssignments(first.id, participant.id)).toEqual([]);
        await assign(first.slot.id, preview.overlapConfirmation);
        expect(await activityService.getActivitySlotAssignments(first.id, participant.id)).toEqual([first.slot.id]);
        expect(await activityService.getActivitySlotAssignments(second.id, participant.id)).toEqual([second.slot.id]);
        // Existing assignment/role additions remain idempotent and need no fresh placement acknowledgement.
        await assign(first.slot.id);
    });

    it('confirms a newly taken named role through the same collision checks', async () => {
        const {first, second} = await createLinkedFixture();
        await assign(second.slot.id);
        const plan = (await activityService.getActivityPlanById(first.id))!;
        const [role] = await activityController.addActivityRole(plan, {name: 'Coordinator'});
        await activityController.addSlotRole(first.slot.id, {roles: [role.id]});
        await expect(activityController.getRoleAccessMapping().assign({itemId: first.slot.id, role: 'Coordinator'}, participant.id))
            .rejects.toMatchObject({status: 409});
        const preview = await activityController.getAssignmentWarningPreview(first.id, first.slot.id, participantSession());
        await activityController.getRoleAccessMapping().assign({
            itemId: first.slot.id, role: 'Coordinator', overlapConfirmation: preview.overlapConfirmation,
        }, participant.id);
        expect((await activityService.getParticipantRolesForPlan(first.id))[0].roleIds).toContain(role.id);
    });

    it('warns for active proposals but excludes rejected, applied-history-only and removal proposals', async () => {
        const {first, second} = await createLinkedFixture();
        for (const status of ['PENDING', 'APPROVED', 'REJECTED', 'APPLIED'] as const) {
            await recommendationService.replaceRecommendations(second.id, [{itemId: second.slot.id, profileId: participant.id, status}]);
            const preview = await activityController.getAssignmentWarningPreview(first.id, first.slot.id, participantSession());
            expect(preview.warnings.some((warning) => warning.type === 'overlap')).toBe(status === 'PENDING' || status === 'APPROVED');
        }
        await recommendationService.replaceRecommendations(second.id, [{
            itemId: second.slot.id, profileId: participant.id, status: 'PENDING', operation: 'UNASSIGN', manual: true,
        }]);
        expect((await activityController.getAssignmentWarningPreview(first.id, first.slot.id, participantSession())).overlapConfirmation).toBeUndefined();
    });

    it('keeps manual recommendation overlaps confirmable in Required plans and preserves provenance/history', async () => {
        const {first, second} = await createLinkedFixture();
        await requireOneShift(second.id);
        await assign(second.slot.id);
        const body = {recommendations: [approvedManual(first.slot.id)]};
        const preview = await activityController.getRecommendationWarningPreview(first.id, body, ownerSession());
        expect(preview.warnings[0].warnings).toContainEqual(expect.objectContaining({
            type: 'overlap', confirmable: true, requiredPriority: false,
            overlapDetails: expect.arrayContaining([expect.objectContaining({planId: second.id, title: second.slot.title})]),
        }));
        await expect(activityController.applyRecommendations(first.id, body)).rejects.toMatchObject({status: 409});
        expect(await recommendationService.getRecommendations(first.id)).toEqual([]);
        const applied = await activityController.applyRecommendations(first.id, {...body, overlapConfirmation: preview.overlapConfirmation}, ownerSession());
        expect(applied).toMatchObject({applied: 1, skipped: 0});
        expect(await recommendationService.getRecommendations(first.id)).toEqual([expect.objectContaining({manual: true, status: 'APPLIED'})]);
        expect(await activityService.getActivitySlotAssignments(second.id, participant.id)).toEqual([second.slot.id]);
    });

    it('keeps foreign removal sources occupied and reserves foreign reassignment targets until application', async () => {
        const {first, second} = await createLinkedFixture();
        await assign(second.slot.id);
        await recommendationService.replaceRecommendations(second.id, [{
            itemId: second.slot.id, profileId: participant.id, status: 'APPROVED', operation: 'UNASSIGN', manual: true,
        }]);
        expect((await activityController.getAssignmentWarningPreview(first.id, first.slot.id, participantSession())).overlapConfirmation).toBeDefined();
        const plan = (await activityService.getActivityPlanById(second.id))!;
        await activityController.quickAddSlot(plan, {
            date: '2027-06-02', title: 'Proposed destination', startTime: '11:00', endTime: '12:00',
        }, {profile: owner} as never);
        const target = (await activityService.getActivitySlotsFlat(second.id)).find((slot) => slot.title === 'Proposed destination')!;
        await recommendationService.replaceRecommendations(second.id, [{
            itemId: target.id, profileId: participant.id, sourceItemId: second.slot.id,
            status: 'PENDING', operation: 'REASSIGN', manual: true,
        }]);
        await activityService.updateActivitySlot(first.slot.id, {startTime: '11:00', endTime: '12:00'});
        const preview = await activityController.getRecommendationWarningPreview(first.id, {
            recommendations: [approvedManual(first.slot.id)],
        }, ownerSession());
        expect(preview.warnings[0].warnings).toContainEqual(expect.objectContaining({
            type: 'overlap', overlapDetails: [expect.objectContaining({id: target.id, operation: 'REASSIGN'})],
        }));
        expect(await activityService.getActivitySlotAssignments(second.id, participant.id)).toEqual([second.slot.id]);
    });

    it('generates Required-over-Free fallback with a mandatory confirmable warning and local counts only', async () => {
        const {first, second} = await createLinkedFixture();
        await requireOneShift(first.id);
        await assign(second.slot.id);
        const context = await buildPlanRecommendationContext(first.id);
        expect(context.existingAssignments).toEqual({});
        expect(context.linkedPlans?.commitments['profile:' + participant.id]).toHaveLength(1);
        const generated = generateFairRecommendations(context);
        expect(generated).toHaveLength(1);
        await saveGeneratedRecommendations(first.id, generated);
        const saved = (await recommendationService.getRecommendations(first.id))[0];
        const body = {recommendations: [{...generated[0], id: saved.id, status: 'APPROVED' as const}]};
        const preview = await activityController.getRecommendationWarningPreview(first.id, body, ownerSession());
        expect(preview.warnings[0].warnings).toContainEqual(expect.objectContaining({type: 'overlap', requiredPriority: true, confirmable: true}));
        await expect(activityController.applyRecommendations(first.id, body)).rejects.toMatchObject({status: 409});
        const applied = await activityController.applyRecommendations(first.id, {...body, overlapConfirmation: preview.overlapConfirmation});
        expect(applied).toMatchObject({applied: 1, skipped: 0});
        expect(await activityService.getActivitySlotAssignments(second.id, participant.id)).toEqual([second.slot.id]);
    });

    it('blocks generated Required-over-Required work even if a client claims manual provenance', async () => {
        const {first, second} = await createLinkedFixture();
        await requireOneShift(first.id);
        await requireOneShift(second.id);
        await assign(second.slot.id);
        expect(generateFairRecommendations(await buildPlanRecommendationContext(first.id))).toEqual([]);
        // A previously computed proposal may encounter a sibling conflict only at review time.
        await recommendationService.replaceRecommendations(first.id, [{
            itemId: first.slot.id, profileId: participant.id, status: 'PENDING', manual: false,
        }]);
        const [saved] = await recommendationService.getRecommendations(first.id);
        const body = {recommendations: [{id: saved.id, ...approvedManual(first.slot.id)}]};
        const preview = await activityController.getRecommendationWarningPreview(first.id, body);
        expect(preview.overlapConfirmation).toBeUndefined();
        expect(preview.warnings[0].warnings).toContainEqual(expect.objectContaining({type: 'overlap', confirmable: false}));
        expect(await activityController.applyRecommendations(first.id, body)).toMatchObject({applied: 0, skipped: 1});
        expect((await recommendationService.getRecommendations(first.id))[0]).toMatchObject({manual: false, status: 'APPROVED'});
    });

    it('rejects stale overlap confirmation before any review, assignment or history write', async () => {
        const {first, second} = await createLinkedFixture();
        await assign(second.slot.id);
        const body = {recommendations: [approvedManual(first.slot.id)]};
        const preview = await activityController.getRecommendationWarningPreview(first.id, body);
        await activityService.updateActivitySlot(first.slot.id, {endTime: '10:30'});
        await expect(activityController.applyRecommendations(first.id, {...body, overlapConfirmation: preview.overlapConfirmation}))
            .rejects.toMatchObject({status: 409});
        expect(await recommendationService.getRecommendations(first.id)).toEqual([]);
        expect(await activityService.getActivitySlotAssignments(first.id, participant.id)).toEqual([]);
        const fresh = await activityController.getRecommendationWarningPreview(first.id, body);
        expect(fresh.overlapConfirmation).not.toBe(preview.overlapConfirmation);
        await activityController.applyRecommendations(first.id, {...body, overlapConfirmation: fresh.overlapConfirmation});
    });

    it('includes archived siblings while disclosing foreign details only through their permissions', async () => {
        const {first, second} = await createLinkedFixture();
        await assign(second.slot.id);
        await AppDataSource.getRepository(ActivityPlan).update(second.id, {archivedAt: new Date()});
        const body = {recommendations: [approvedManual(first.slot.id)]};
        const generic = await activityController.getRecommendationWarningPreview(first.id, body);
        const viewer = await persistIntegrationProfile();
        const denied = await activityController.getRecommendationWarningPreview(first.id, body, {profile: viewer});
        const specific = await activityController.getRecommendationWarningPreview(first.id, body, ownerSession());
        const warning = generic.warnings[0].warnings.find((entry) => entry.type === 'overlap')!;
        expect(warning).toMatchObject({confirmable: true, conflicts: [], overlapDetails: []});
        expect(JSON.stringify(generic)).not.toContain(second.id);
        expect(JSON.stringify(generic)).not.toContain(second.slot.id);
        expect(denied).toEqual(generic);
        expect(specific.warnings[0].warnings).toContainEqual(expect.objectContaining({
            overlapDetails: expect.arrayContaining([expect.objectContaining({planId: second.id, planTitle: 'Optional activity'})]),
        }));
        expect(generic.overlapConfirmation).toBe(specific.overlapConfirmation);
    });

    it('updates the interlinking scope immediately when a plan moves to another event', async () => {
        const {eventId, first, second} = await createLinkedFixture();
        await assign(second.slot.id);
        expect((await activityController.getAssignmentWarningPreview(first.id, first.slot.id, participantSession())).overlapConfirmation).toBeDefined();
        const destination = await createIntegrationEvent(owner.id, 'Other activity event');
        const plan = (await activityService.getActivityPlanById(second.id))!;
        await changeEntityEvent('activity', plan, {eventId: destination, expectedEventId: eventId}, {profile: owner, auth: {user: owner.user!}});
        expect((await activityController.getAssignmentWarningPreview(first.id, first.slot.id, participantSession())).overlapConfirmation).toBeUndefined();
        expect(await activityService.getActivitySlotAssignments(second.id, participant.id)).toEqual([second.slot.id]);
    });

    it('serializes simultaneous signups to different plans so the second writer observes the first', async () => {
        const {first, second} = await createLinkedFixture();
        const attempts = await Promise.allSettled([assign(first.slot.id), assign(second.slot.id)]);
        expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1);
        const rejected = attempts.find((attempt) => attempt.status === 'rejected') as PromiseRejectedResult;
        expect(rejected.reason).toMatchObject({status: 409});
        const firstAssignments = await activityService.getActivitySlotAssignments(first.id, participant.id);
        const secondAssignments = await activityService.getActivitySlotAssignments(second.id, participant.id);
        expect(firstAssignments.length + secondAssignments.length).toBe(1);
    });

    it('rejects worker output when sibling inputs change while it waits for the event lock', async () => {
        const {first, second} = await createLinkedFixture();
        await requireOneShift(first.id);
        await assign(second.slot.id);
        const context = await buildPlanRecommendationContext(first.id);
        let announceLocked!: () => void;
        let releaseWrite!: () => void;
        const locked = new Promise<void>(function captureLocked(resolve) { announceLocked = resolve; });
        const release = new Promise<void>(function captureRelease(resolve) { releaseWrite = resolve; });
        const changing = activityService.withActivityTransaction(async function changeSibling(manager) {
            await activityService.lockActivityContext(manager, second.id);
            announceLocked();
            await release;
            await manager.getRepository(ActivitySlot).update(second.slot.id, {endTime: '11:00'});
        });
        await locked;
        const stale = saveGeneratedRecommendations(first.id, generateFairRecommendations(context), {
            eventId: context.plan.eventId ?? null, startDate: context.plan.startDate, endDate: context.plan.endDate,
            inputFingerprint: fingerprintRecommendationContext(context),
        });
        const rejected = expect(stale).rejects.toMatchObject({status: 409, data: {reason: 'activity-context-changed'}});
        releaseWrite();
        await changing;
        await rejected;
        expect(await recommendationService.getRecommendations(first.id)).toEqual([]);
    });
});
