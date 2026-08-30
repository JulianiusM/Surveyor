import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {Request} from 'express';
import activityController from '../../src/controller/activityController';
import driversController from '../../src/controller/driversController';
import * as entityAdminController from '../../src/controller/entityAdminController';
import eventPoolController from '../../src/controller/eventPoolController';
import * as helpController from '../../src/controller/helpController';
import eventController from '../../src/controller/eventController';
import packingController from '../../src/controller/packingController';
import surveyController from '../../src/controller/surveyController';
import * as userController from '../../src/controller/userController';
import {Profile} from '../../src/modules/database/entities/user/Profile';
import {AddActivityPlanStayRequirements1787688000000} from '../../src/migrations/1787688000000-AddActivityPlanStayRequirements';
import {AddActivityPlanExternalAssignees1787688100000} from '../../src/migrations/1787688100000-AddActivityPlanExternalAssignees';
import {AddActivityRecommendationOperations1788134500000} from '../../src/migrations/1788134500000-AddActivityRecommendationOperations';
import {AddActivityRecommendationReviewState1788134600000} from '../../src/migrations/1788134600000-AddActivityRecommendationReviewState';
import {AppDataSource} from '../../src/modules/database/dataSource';
import {PERM} from '../../src/modules/lib/permissions';
import * as activityService from '../../src/modules/database/services/ActivityService';
import * as recommendationService from '../../src/modules/database/services/ActivityRecommendationService';
import * as driverService from '../../src/modules/database/services/DriverService';
import * as adminService from '../../src/modules/database/services/EntityAdminService';
import * as eventService from '../../src/modules/database/services/EventService';
import * as invoiceService from '../../src/modules/database/services/EventInvoiceService';
import * as packingService from '../../src/modules/database/services/PackingService';
import * as surveyService from '../../src/modules/database/services/SurveyService';
import * as userService from '../../src/modules/database/services/UserService';
import {
    createActivitySlotEntity,
    createDriversItemEntity,
    createPackingItemEntity,
} from '../factories/integrationEntityFactory';
import {createStayRequirementSchedule} from '../factories/activityRequirementFactory';
import {
    assignActivitySlot,
    assignDriversItem,
    assignPackingItem,
    createActivityPlanWithSlot,
    createDriversListWithItem,
    createEventActivityPlan,
    createIntegrationEvent,
    createPackingListWithItem,
    createSurveyWithCombinations,
    persistIntegrationProfile,
    registerEventAttendance,
    registerLocalAccount,
    submitSurveyResponses,
    unassignDriversItem,
    unassignPackingItem,
} from '../keywords/coreDomainKeywords';
import {closeIntegrationDatabase, initializeIntegrationDatabase} from '../support/database';

let owner: Profile;
let participant: Profile;
let secondParticipant: Profile;

beforeAll(async () => {
    await initializeIntegrationDatabase();
    owner = await persistIntegrationProfile();
    participant = await persistIntegrationProfile();
    secondParticipant = await persistIntegrationProfile();
});

afterAll(async () => {
    await closeIntegrationDatabase();
});

describe('activity plan user stories', () => {
    it('creates a plan and its schedule transactionally', async () => {
        const planId = await createActivityPlanWithSlot(owner.id);

        expect(await activityService.getActivityPlanById(planId)).toMatchObject({title: 'Camp activity plan', ownerId: owner.id});
        expect(await activityService.getActivitySlotsFlat(planId)).toHaveLength(1);
    });

    it('rejects an activity plan without a participant-visible slot', async () => {
        expect(() => activityController.preprocessCreate({
            title: 'Camp activity plan', description: 'Shared schedule',
            startDate: '2027-06-01', endDate: '2027-06-03', slots: '{}',
        })).toThrow('slots');
    });

    it('adds several organizer-authored slots at once', async () => {
        const planId = await createActivityPlanWithSlot(owner.id);

        const plan = await activityService.getActivityPlanById(planId);
        await activityController.quickAddSlot(plan!, {date: '2027-06-01', title: 'Lunch'}, {profile: owner} as never);
        await activityController.quickAddSlot(plan!, {date: '2027-06-01', title: 'Dinner'}, {profile: owner} as never);
        expect((await activityService.getActivitySlotsFlat(planId)).map((slot) => slot.title)).toEqual(['Morning activity', 'Lunch', 'Dinner']);
    });

    it('orders a daily schedule by time and position', async () => {
        const planId = await createActivityPlanWithSlot(owner.id);

        const plan = await activityService.getActivityPlanById(planId);
        await activityController.quickAddSlot(plan!, {date: '2027-06-01', title: 'Late', startTime: '18:00'}, {profile: owner} as never);
        await activityController.quickAddSlot(plan!, {date: '2027-06-01', title: 'Middle', startTime: '12:00'}, {profile: owner} as never);
        expect((await activityService.getActivitySlotsFlat(planId)).map((slot) => slot.title)).toEqual(['Morning activity', 'Middle', 'Late']);
    });

    it('groups schedule slots by day for the plan view', async () => {
        const planId = await createActivityPlanWithSlot(owner.id);

        const plan = await activityService.getActivityPlanById(planId);
        await activityController.quickAddSlot(plan!, {date: '2027-06-02', title: 'Second day'}, {profile: owner} as never);
        expect(Object.keys(await activityService.getActivitySlots(planId))).toEqual(['2027-06-01', '2027-06-02']);
    });

    it('updates the participant-visible slot details', async () => {
        const planId = await createActivityPlanWithSlot(owner.id);

        const [slot] = await activityService.getActivitySlotsFlat(planId);
        const permissions = {itemAllow: () => true} as never;
        await activityController.updateSlotAttr(slot.id, {field: 'title', value: 'Updated activity'}, permissions);
        await activityController.updateSlotAttr(slot.id, {field: 'maxAssignees', value: 8}, permissions);
        expect(await activityService.getActivitySlotById(slot.id)).toMatchObject({title: 'Updated activity', maxAssignees: 8});
    });

    it('reorders slots without recreating assignments', async () => {
        const planId = await createActivityPlanWithSlot(owner.id);

        const plan = await activityService.getActivityPlanById(planId);
        await activityController.quickAddSlot(plan!, {
            date: '2027-06-01', title: 'First after reorder', startTime: '08:00', endTime: '09:00',
        }, {profile: owner} as never);
        const slots = await activityService.getActivitySlotsFlat(planId);
        await assignActivitySlot(slots[0].id, participant.id);
        const assignmentId = (await activityService.getActivitySlotAssignees(planId))[slots[0].id][0].id;
        await activityController.reorderSlots(planId, [{slotId: slots[0].id, pos: 2}, {slotId: slots[1].id, pos: 1}]);
        expect((await activityService.getActivitySlotsFlat(planId))[0].title).toBe('First after reorder');
        expect((await activityService.getActivitySlotAssignmentById(assignmentId))?.id).toBe(assignmentId);
    });

    it('deletes a slot from the shared schedule', async () => {
        const planId = await createActivityPlanWithSlot(owner.id);

        const [slot] = await activityService.getActivitySlotsFlat(planId);
        await activityController.deleteSlot(slot.id);
        expect(await activityService.getActivitySlotsFlat(planId)).toEqual([]);
    });

    it('assigns a participant idempotently', async () => {
        const planId = await createActivityPlanWithSlot(owner.id);

        const [slot] = await activityService.getActivitySlotsFlat(planId);
        await assignActivitySlot(slot.id, participant.id);
        await assignActivitySlot(slot.id, participant.id);
        expect(await activityService.getActivitySlotAssignments(planId, participant.id)).toHaveLength(1);
    });

    it('shows assignment counts and participant plans', async () => {
        const planId = await createActivityPlanWithSlot(owner.id);

        const [slot] = await activityService.getActivitySlotsFlat(planId);
        await assignActivitySlot(slot.id, participant.id);
        expect((await activityService.getActivitySlotsFlat(planId))[0].assignedCount).toBe(1);
        expect((await activityService.getActivityPlansByParticipant(participant.id)).map((plan) => plan.id)).toContain(planId);
    });

    it('removes an activity assignment', async () => {
        const planId = await createActivityPlanWithSlot(owner.id);

        const [slot] = await activityService.getActivitySlotsFlat(planId);
        await assignActivitySlot(slot.id, participant.id);
        const assignmentId = (await activityService.getActivitySlotAssignees(planId))[slot.id][0].id;
        await activityController.deleteAssignment(assignmentId);
        expect(await activityService.getActivitySlotAssignments(planId, participant.id)).toEqual([]);
    });

    it('adds, edits, and removes a plan information field', async () => {
        const planId = await createActivityPlanWithSlot(owner.id);

        const field = await activityController.createTextField(planId, {title: 'Meeting point', text: 'Main entrance'});
        await activityController.updateTextField(planId, field.id, {text: 'Side entrance', title: 'Updated point'}, {entity: new Set(['MANAGE_REQUIREMENTS'])} as never);
        expect(await activityService.getActivityPlanTextFieldById(field.id)).toMatchObject({title: 'Updated point', text: 'Side entrance'});
        await activityController.deleteTextField(planId, field.id);
        expect(await activityService.getActivityPlanTextFields(planId)).toEqual([]);
    });

    it('creates and assigns a reusable activity role', async () => {
        const planId = await createActivityPlanWithSlot(owner.id);

        const [slot] = await activityService.getActivitySlotsFlat(planId);
        await assignActivitySlot(slot.id, participant.id);
        const plan = await activityService.getActivityPlanById(planId);
        const [role] = await activityController.addActivityRole(plan!, {name: 'Coordinator'});
        await activityController.addSlotRole(slot.id, {roles: [role.id]});
        await activityController.getRoleAccessMapping().assign({itemId: slot.id, role: 'Coordinator'}, participant.id);
        const [participantRoles] = await activityService.getParticipantRolesForPlan(planId);
        expect(participantRoles.participantKey).toBe(`profile:${participant.id}`);
        expect(participantRoles.roleIds).toContain(role.id);
    });

    it('updates the plan description and header image', async () => {
        const planId = await createActivityPlanWithSlot(owner.id);

        await activityController.updateDescription(planId, {description: 'Updated schedule'});
        await activityService.updateHeaderImage(planId, 'activity-header.jpg');
        expect(await activityService.getActivityPlanById(planId)).toMatchObject({description: 'Updated schedule', headerImg: 'activity-header.jpg'});
    });

    it('deletes a plan and removes it from the owner dashboard', async () => {
        const planId = await createActivityPlanWithSlot(owner.id);

        const plan = await activityService.getActivityPlanById(planId);
        await activityController.deleteEntity(plan!, {} as never);
        expect((await activityService.getActivityPlansByProfileId(owner.id)).map((plan) => plan.id)).not.toContain(planId);
    });

});

describe('automatic activity assignment user stories', () => {
    it('uses the profile name for an assignee who is not registered for the linked event', async () => {
        const eventId = await createIntegrationEvent(owner.id, 'External provider activity event');
        const planId = await createEventActivityPlan(owner.id, eventId);
        const [slot] = await activityService.getActivitySlotsFlat(planId);
        await assignActivitySlot(slot.id, owner.id);

        const requirements = await activityController.getRequirements(planId);

        expect(requirements.participants).toEqual([
            expect.objectContaining({
                participantKey: `profile:${owner.id}`,
                name: owner.name,
                assignedShifts: 1,
            }),
        ]);
    });

    it('blocks self-assignment by profiles who are not registered for the linked event', async () => {
        const eventId = await createIntegrationEvent(owner.id, 'Participant-only activity event');
        const planId = await createEventActivityPlan(owner.id, eventId);
        const [slot] = await activityService.getActivitySlotsFlat(planId);

        await expect(activityController.authorizeSelfAssignment(
            planId,
            slot.id,
            owner.id,
            'assign',
        )).rejects.toMatchObject({status: 403});
    });

    it('allows explicitly enabled external profiles to take linked-plan slots', async () => {
        const eventId = await createIntegrationEvent(owner.id, 'External provider opt-in event');
        const planId = await createEventActivityPlan(owner.id, eventId);
        const [slot] = await activityService.getActivitySlotsFlat(planId);
        await activityController.updateRequirements(planId, {
            allowExternalAssignees: true,
            roleRequirements: [],
            stayRequirements: [],
            overrides: [],
        });

        await expect(activityController.authorizeSelfAssignment(
            planId,
            slot.id,
            owner.id,
            'assign',
        )).resolves.toBeUndefined();
        expect(Boolean((await activityController.getRequirements(planId)).plan.allowExternalAssignees)).toBe(true);
    });

    it('rejects slots from another activity plan and unconfigured role names', async () => {
        const firstPlanId = await createActivityPlanWithSlot(owner.id);
        const secondPlanId = await createActivityPlanWithSlot(owner.id);
        const [firstSlot] = await activityService.getActivitySlotsFlat(firstPlanId);
        const [secondSlot] = await activityService.getActivitySlotsFlat(secondPlanId);

        await expect(activityController.authorizeSelfAssignment(
            firstPlanId,
            secondSlot.id,
            participant.id,
            'assign',
        )).rejects.toMatchObject({status: 404});
        await expect(activityController.authorizeSelfAssignment(
            firstPlanId,
            firstSlot.id,
            participant.id,
            'assign',
            'Injected role',
        )).rejects.toMatchObject({status: 400});
    });

    it('rejects tampered recommendations that target another plan or a non-participant', async () => {
        const eventId = await createIntegrationEvent(owner.id, 'Scoped recommendation event');
        await registerEventAttendance(eventId, participant, {arrivalDate: '2027-06-01', departureDate: '2027-06-03'});
        const planId = await createEventActivityPlan(owner.id, eventId);
        const otherPlanId = await createActivityPlanWithSlot(owner.id);
        const [slot] = await activityService.getActivitySlotsFlat(planId);
        const [otherSlot] = await activityService.getActivitySlotsFlat(otherPlanId);

        await expect(activityController.updateRecommendations(planId, {recommendations: [{
            itemId: otherSlot.id,
            profileId: participant.id,
        }]})).rejects.toMatchObject({status: 400});
        await expect(activityController.updateRecommendations(planId, {recommendations: [{
            itemId: slot.id,
            profileId: owner.id,
        }]})).rejects.toMatchObject({status: 400});
    });

    it('enforces a full activity slot as a hard cap when overfill is disabled', async () => {
        const planId = await createActivityPlanWithSlot(owner.id);
        const [slot] = await activityService.getActivitySlotsFlat(planId);
        await activityService.updateActivitySlot(slot.id, {maxAssignees: 1});
        await assignActivitySlot(slot.id, participant.id);

        await expect(activityController.authorizeSelfAssignment(
            planId,
            slot.id,
            secondParticipant.id,
            'assign',
        )).rejects.toMatchObject({status: 409});
        await expect(assignActivitySlot(slot.id, secondParticipant.id)).rejects.toMatchObject({status: 409});
    });

    it('warns before allowing a participant to overfill an activity slot', async () => {
        const eventId = await createIntegrationEvent(owner.id, 'Overfill warning event');
        await registerEventAttendance(eventId, participant, {arrivalDate: '2027-06-01', departureDate: '2027-06-03'});
        await registerEventAttendance(eventId, secondParticipant, {arrivalDate: '2027-06-01', departureDate: '2027-06-03'});
        const planId = await createEventActivityPlan(owner.id, eventId);
        const [slot] = await activityService.getActivitySlotsFlat(planId);
        await activityService.updateActivitySlot(slot.id, {maxAssignees: 1});
        await assignActivitySlot(slot.id, participant.id);
        await activityController.updateRequirements(planId, {
            allowOverfillAfterFull: true,
            roleRequirements: [],
            stayRequirements: [],
            overrides: [],
        });

        const session = ({session: {profile: secondParticipant}} as Request).session;
        const warnings = await activityController.getAssignmentWarnings(planId, slot.id, session);

        // Canary: the override keeps joining possible, but only after the participant sees the capacity risk.
        expect(warnings).toContainEqual({type: 'over_capacity'});
        await expect(activityController.authorizeSelfAssignment(
            planId,
            slot.id,
            secondParticipant.id,
            'assign',
        )).resolves.toBeUndefined();
        await assignActivitySlot(slot.id, secondParticipant.id);
        expect((await activityService.getActivitySlotAssignees(planId))[slot.id]).toHaveLength(2);
    });

    it('shows required progress before a participant takes their first slot', async () => {
        const eventId = await createIntegrationEvent(owner.id, 'Required progress event');
        await registerEventAttendance(eventId, participant, {arrivalDate: '2027-06-01', departureDate: '2027-06-03'});
        const planId = await createEventActivityPlan(owner.id, eventId);
        await activityController.updateRequirements(planId, {
            assignmentMode: 'REQUIRED',
            generalRequiredShifts: 2,
            stayRequirements: createStayRequirementSchedule(3, 2),
            roleRequirements: [],
            overrides: [],
        });

        const plan = await activityService.getActivityPlanById(planId);
        const participantView = await activityController.fetchForView(
            plan!,
            {session: {profile: participant}} as Request,
        );

        expect(participantView.requirementProgress).toEqual({
            assignedShifts: 0,
            requiredShifts: 2,
            remainingShifts: 2,
            complete: false,
        });
    });

    it('rejects incomplete stay-duration tables in required mode', async () => {
        // Protects runtime calculations from silently rounding a missing attendance duration.
        const eventId = await createIntegrationEvent(owner.id, 'Incomplete duties event');
        const planId = await createEventActivityPlan(owner.id, eventId);

        await expect(activityController.updateRequirements(planId, {
            assignmentMode: 'REQUIRED',
            stayRequirements: [{stayDays: 3, requiredShifts: 2}],
            roleRequirements: [],
            overrides: [],
        })).rejects.toMatchObject({status: 400});
    });

    it('rejects automatic recommendations in free mode', async () => {
        // Protects FREE mode as a no-optimization path in controller workflows.
        const eventId = await createIntegrationEvent(owner.id, 'Free duties event');
        const planId = await createEventActivityPlan(owner.id, eventId);

        await expect(activityController.autoGenerateRecommendations(planId)).rejects.toMatchObject({status: 409});
    });

    it('calculates a realistic baseline requirement for registered participants', async () => {
        const eventId = await createIntegrationEvent(owner.id, 'Automatic duties event');
        await registerEventAttendance(eventId, participant, {arrivalDate: '2027-06-01', departureDate: '2027-06-03'});
        await registerEventAttendance(eventId, secondParticipant, {arrivalDate: '2027-06-01', departureDate: '2027-06-03'});
        const planId = await createEventActivityPlan(owner.id, eventId);
        await activityController.updateRequirements(planId, {
            assignmentMode: 'REQUIRED', generalRequiredShifts: 1, roundingMode: 'CEIL',
            stayRequirements: createStayRequirementSchedule(3, 1),
            roleRequirements: [], overrides: [],
        });

        const baseline = await activityController.calculateBaselineRequirement(planId);

        expect(baseline).toMatchObject({feasible: true, totalRequiredShifts: 4, remainingShifts: 4});
        expect(baseline.participants).toHaveLength(2);
        expect(baseline.stayRequirements).toEqual([
            {stayDays: 1, requiredShifts: 1},
            {stayDays: 2, requiredShifts: 2},
            {stayDays: 3, requiredShifts: 2},
        ]);
    });

    it('persists an adjusted stay-duration requirement and uses it for recommendations', async () => {
        const eventId = await createIntegrationEvent(owner.id, 'Adjusted duties event');
        await registerEventAttendance(eventId, participant, {arrivalDate: '2027-06-01', departureDate: '2027-06-02'});
        const planId = await createEventActivityPlan(owner.id, eventId);
        const [arrivalSlot] = await activityService.getActivitySlotsFlat(planId);
        await activityService.updateActivitySlot(arrivalSlot.id, {startTime: '12:00', endTime: '13:00'});

        await activityController.updateRequirements(planId, {
            assignmentMode: 'REQUIRED', generalRequiredShifts: 6, roundingMode: 'CEIL',
            allowArrivalDayEvening: true,
            stayRequirements: [
                {stayDays: 1, requiredShifts: 1},
                {stayDays: 2, requiredShifts: 1},
                {stayDays: 3, requiredShifts: 6},
            ],
            roleRequirements: [], overrides: [],
        });

        const requirements = await activityController.getRequirements(planId);
        expect(requirements.stayRequirements.map(({stayDays, requiredShifts}) => ({stayDays, requiredShifts}))).toEqual([
            {stayDays: 1, requiredShifts: 1},
            {stayDays: 2, requiredShifts: 1},
            {stayDays: 3, requiredShifts: 6},
        ]);
        expect(requirements.participants[0].requiredShifts).toBe(1);
        expect(requirements.participants[0].attendanceDays).toBe(2);
        expect(requirements.capacitySummary).toMatchObject({
            availableSlots: 4,
            requiredSlots: 1,
            difference: 3,
            configurationComplete: true,
        });

        const plan = await activityService.getActivityPlanById(planId);
        const participantView = await activityController.fetchForView(
            plan!,
            {session: {profile: participant}} as Request,
        );
        expect(participantView.requirementProgress).toEqual({
            assignedShifts: 0,
            requiredShifts: 1,
            remainingShifts: 1,
            complete: false,
        });
        expect(participantView.participantList).toEqual([
            expect.objectContaining({
                name: participant.name,
                assignedShifts: 0,
                requiredShifts: 1,
                remainingShifts: 1,
                attendanceDays: 2,
                roles: [],
                assignmentMode: 'REQUIRED',
            }),
        ]);

        await activityController.autoGenerateRecommendations(planId);
        expect((await activityController.getRecommendations(planId)).recommendations).toHaveLength(1);

        const [slot] = await activityService.getActivitySlotsFlat(planId);
        await assignActivitySlot(slot.id, participant.id);
        const completedView = await activityController.fetchForView(
            plan!,
            {session: {profile: participant}} as Request,
        );
        expect(completedView.requirementProgress).toEqual({
            assignedShifts: 1,
            requiredShifts: 1,
            remainingShifts: 0,
            complete: true,
        });
        expect(completedView.participantList[0]).toMatchObject({
            assignedShifts: 1,
            requiredShifts: 1,
            remainingShifts: 0,
        });
    });

    it('automatically recommends available participants for open activity slots', async () => {
        const eventId = await createIntegrationEvent(owner.id, 'Recommendation event');
        await registerEventAttendance(eventId, participant, {arrivalDate: '2027-06-01', departureDate: '2027-06-03'});
        await registerEventAttendance(eventId, secondParticipant, {arrivalDate: '2027-06-01', departureDate: '2027-06-03'});
        const planId = await createEventActivityPlan(owner.id, eventId);
        await activityController.updateRequirements(planId, {
            assignmentMode: 'REQUIRED', generalRequiredShifts: 1,
            stayRequirements: createStayRequirementSchedule(3, 1),
            roleRequirements: [], overrides: [],
        });

        await activityController.autoGenerateRecommendations(planId);
        const result = await activityController.getRecommendations(planId);

        expect(result.recommendations).toHaveLength(2);
        expect(result.recommendations.map((recommendation) => recommendation.profileId)).toEqual(
            expect.arrayContaining([participant.id, secondParticipant.id]),
        );
        expect(result.warnings.every((entry) => entry.warnings.length === 0)).toBe(true);
    });

    it('applies approved recommendations as participant assignments', async () => {
        const eventId = await createIntegrationEvent(owner.id, 'Approved duties event');
        await registerEventAttendance(eventId, participant, {arrivalDate: '2027-06-01', departureDate: '2027-06-03'});
        const planId = await createEventActivityPlan(owner.id, eventId);
        await activityController.updateRequirements(planId, {
            assignmentMode: 'REQUIRED', generalRequiredShifts: 1,
            stayRequirements: createStayRequirementSchedule(3, 1),
            roleRequirements: [], overrides: [],
        });
        await activityController.autoGenerateRecommendations(planId);
        const generated = await activityController.getRecommendations(planId);
        const recommendation = generated.recommendations[0];

        const result = await activityController.applyRecommendations(planId, {recommendations: [{
            itemId: recommendation.item.id,
            profileId: recommendation.profileId,
            status: 'APPROVED',
        }]});

        expect(await activityService.getActivitySlotAssignments(planId, participant.id)).toContain(recommendation.item.id);
        expect(result.message).toContain('Applied 1 recommendation');
    });

    it('keeps rejected recommendations out of participant schedules', async () => {
        const eventId = await createIntegrationEvent(owner.id, 'Rejected duties event');
        await registerEventAttendance(eventId, participant, {arrivalDate: '2027-06-01', departureDate: '2027-06-03'});
        const planId = await createEventActivityPlan(owner.id, eventId);
        await activityController.updateRequirements(planId, {
            assignmentMode: 'REQUIRED', generalRequiredShifts: 1,
            stayRequirements: createStayRequirementSchedule(3, 1),
            roleRequirements: [], overrides: [],
        });
        await activityController.autoGenerateRecommendations(planId);
        const generated = await activityController.getRecommendations(planId);
        const recommendation = generated.recommendations[0];

        await activityController.applyRecommendations(planId, {recommendations: [{
            id: recommendation.id,
            itemId: recommendation.item.id,
            profileId: recommendation.profileId,
            status: 'REJECTED',
        }]});

        expect(await activityService.getActivitySlotAssignments(planId, participant.id)).toEqual([]);
        expect((await activityController.getRecommendations(planId)).recommendations).toEqual([]);
        expect(await recommendationService.getRecommendations(planId)).toEqual([
            expect.objectContaining({status: 'REJECTED', hidden: true, manual: false}),
        ]);

        // Simulates an in-flight generation result that was calculated before the rejection was saved.
        await recommendationService.replacePendingRecommendations(planId, [{
            itemId: recommendation.item.id,
            profileId: recommendation.profileId,
            status: 'PENDING',
            operation: 'ASSIGN',
        }]);
        expect((await activityController.getRecommendations(planId)).recommendations).toEqual([
            expect.objectContaining({status: 'REJECTED', hidden: false, manual: false}),
        ]);
    });

    it('discards a persisted manual operation when it is submitted as rejected', async () => {
        // Protects manual work from becoming automatic rejection memory when an organizer declines it.
        const eventId = await createIntegrationEvent(owner.id, 'Rejected manual recommendation event');
        await registerEventAttendance(eventId, participant, {arrivalDate: '2027-06-01', departureDate: '2027-06-03'});
        const planId = await createEventActivityPlan(owner.id, eventId);
        const dinner = (await activityService.getActivitySlotsFlat(planId))
            .find((slot) => slot.title === 'Dinner cleanup')!;
        await activityController.updateRecommendations(planId, {recommendations: [{
            itemId: dinner.id,
            profileId: participant.id,
            status: 'PENDING',
            operation: 'ASSIGN',
            manual: true,
        }]});
        const [manualRecommendation] = (await activityController.getRecommendations(planId)).recommendations;
        expect(manualRecommendation).toMatchObject({manual: true, status: 'PENDING'});

        await activityController.applyRecommendations(planId, {recommendations: [{
            id: manualRecommendation.id,
            itemId: dinner.id,
            profileId: participant.id,
            status: 'REJECTED',
            operation: 'ASSIGN',
            manual: false,
        }]});

        expect(await recommendationService.getRecommendations(planId)).toEqual([]);
        expect(await activityService.getActivitySlotAssignments(planId, participant.id)).toEqual([]);
    });

    it('discards both manual swap legs when either leg is submitted as rejected', async () => {
        // Protects the server from applying a half-swap submitted by a stale or tampered client.
        const eventId = await createIntegrationEvent(owner.id, 'Rejected manual swap event');
        await registerEventAttendance(eventId, participant, {arrivalDate: '2027-06-01', departureDate: '2027-06-03'});
        await registerEventAttendance(eventId, secondParticipant, {arrivalDate: '2027-06-01', departureDate: '2027-06-03'});
        const planId = await createEventActivityPlan(owner.id, eventId);
        const plan = await activityService.getActivityPlanById(planId);
        await activityController.quickAddSlot(plan!, {
            date: '2027-06-02', title: 'Lunch cleanup', startTime: '12:00', endTime: '13:00', maxAssignees: 1,
        }, {profile: owner} as never);
        const slots = await activityService.getActivitySlotsFlat(planId);
        const dinner = slots.find((slot) => slot.title === 'Dinner cleanup')!;
        const lunch = slots.find((slot) => slot.title === 'Lunch cleanup')!;
        await activityService.updateActivitySlot(dinner.id, {maxAssignees: 1});
        await assignActivitySlot(dinner.id, participant.id);
        await assignActivitySlot(lunch.id, secondParticipant.id);
        await activityController.updateRecommendations(planId, {recommendations: [
            {
                itemId: lunch.id,
                sourceItemId: dinner.id,
                profileId: participant.id,
                status: 'PENDING',
                operation: 'REASSIGN',
                manual: true,
            },
            {
                itemId: dinner.id,
                sourceItemId: lunch.id,
                profileId: secondParticipant.id,
                status: 'PENDING',
                operation: 'REASSIGN',
                manual: true,
            },
        ]});
        const staged = (await activityController.getRecommendations(planId)).recommendations;

        await activityController.applyRecommendations(planId, {recommendations: staged.map((recommendation, index) => ({
            id: recommendation.id,
            itemId: recommendation.item.id,
            sourceItemId: recommendation.sourceItem?.id,
            profileId: recommendation.profile.id,
            status: index === 0 ? 'REJECTED' : 'APPROVED',
            operation: 'REASSIGN',
            manual: false,
        }))});

        expect(await activityService.getActivitySlotAssignments(planId, participant.id)).toEqual([dinner.id]);
        expect(await activityService.getActivitySlotAssignments(planId, secondParticipant.id)).toEqual([lunch.id]);
        expect(await recommendationService.getRecommendations(planId)).toEqual([]);
    });

    it('does not regenerate after a manual approval before the binding deadline', async () => {
        // Protects organizers from receiving surprise automatic work while manual review is still open.
        const eventId = await createIntegrationEvent(owner.id, 'Future recommendation deadline event');
        await registerEventAttendance(eventId, participant, {arrivalDate: '2027-06-01', departureDate: '2027-06-03'});
        const planId = await createEventActivityPlan(owner.id, eventId);
        const plan = await activityService.getActivityPlanById(planId);
        await activityController.quickAddSlot(plan!, {
            date: '2027-06-02', title: 'Lunch cleanup', startTime: '12:00', endTime: '13:00',
        }, {profile: owner} as never);
        await activityController.updateRequirements(planId, {
            assignmentMode: 'REQUIRED', generalRequiredShifts: 2,
            bindingDeadline: '2037-06-01T00:00:00.000Z',
            stayRequirements: createStayRequirementSchedule(3, 2),
            roleRequirements: [], overrides: [],
        });
        const dinner = (await activityService.getActivitySlotsFlat(planId))
            .find((slot) => slot.title === 'Dinner cleanup')!;

        await activityController.applyRecommendations(planId, {recommendations: [{
            itemId: dinner.id,
            profileId: participant.id,
            status: 'APPROVED',
            operation: 'ASSIGN',
        }]});

        const recommendations = (await activityController.getRecommendations(planId)).recommendations;
        expect(recommendations).toEqual([]);
        expect(await recommendationService.getRecommendations(planId)).toEqual([
            expect.objectContaining({status: 'APPLIED', operation: 'ASSIGN'}),
        ]);
    });

    it('persists cancellation of a staged unassignment without removing the assignment', async () => {
        // Protects the review GUI's remove-then-save workflow for manual unassignments.
        const eventId = await createIntegrationEvent(owner.id, 'Canceled unassignment event');
        await registerEventAttendance(eventId, participant, {arrivalDate: '2027-06-01', departureDate: '2027-06-03'});
        const planId = await createEventActivityPlan(owner.id, eventId);
        const dinner = (await activityService.getActivitySlotsFlat(planId))
            .find((slot) => slot.title === 'Dinner cleanup')!;
        await assignActivitySlot(dinner.id, participant.id);
        await activityController.updateRecommendations(planId, {recommendations: [{
            itemId: dinner.id,
            profileId: participant.id,
            status: 'APPROVED',
            operation: 'UNASSIGN',
        }]});

        expect((await activityController.getRecommendations(planId)).recommendations).toHaveLength(1);

        await activityController.applyRecommendations(planId, {recommendations: []});

        expect(await activityService.getActivitySlotAssignments(planId, participant.id)).toEqual([dinner.id]);
        expect((await activityController.getRecommendations(planId)).recommendations).toEqual([]);
        expect(await recommendationService.getRecommendations(planId)).toEqual([]);
    });

    it('applies staged swaps and unassignments atomically', async () => {
        // Protects recommendation-GUI operations from capacity ordering failures or partial participant moves.
        const eventId = await createIntegrationEvent(owner.id, 'Recommendation operation event');
        await registerEventAttendance(eventId, participant, {arrivalDate: '2027-06-01', departureDate: '2027-06-03'});
        await registerEventAttendance(eventId, secondParticipant, {arrivalDate: '2027-06-01', departureDate: '2027-06-03'});
        const planId = await createEventActivityPlan(owner.id, eventId);
        const plan = await activityService.getActivityPlanById(planId);
        await activityController.quickAddSlot(plan!, {
            date: '2027-06-02', title: 'Lunch cleanup', startTime: '12:00', endTime: '13:00', maxAssignees: 1,
        }, {profile: owner} as never);
        const slots = await activityService.getActivitySlotsFlat(planId);
        const dinner = slots.find((slot) => slot.title === 'Dinner cleanup')!;
        const lunch = slots.find((slot) => slot.title === 'Lunch cleanup')!;
        await activityService.updateActivitySlot(dinner.id, {maxAssignees: 1});
        await assignActivitySlot(dinner.id, participant.id);
        await assignActivitySlot(lunch.id, secondParticipant.id);

        await activityController.applyRecommendations(planId, {recommendations: [
            {
                itemId: lunch.id,
                sourceItemId: dinner.id,
                profileId: participant.id,
                status: 'APPROVED',
                operation: 'REASSIGN',
            },
            {
                itemId: dinner.id,
                sourceItemId: lunch.id,
                profileId: secondParticipant.id,
                status: 'APPROVED',
                operation: 'REASSIGN',
            },
        ]});

        expect(await activityService.getActivitySlotAssignments(planId, participant.id)).toEqual([lunch.id]);
        expect(await activityService.getActivitySlotAssignments(planId, secondParticipant.id)).toEqual([dinner.id]);

        await activityController.applyRecommendations(planId, {recommendations: [{
            itemId: lunch.id,
            profileId: participant.id,
            status: 'APPROVED',
            operation: 'UNASSIGN',
        }]});

        expect(await activityService.getActivitySlotAssignments(planId, participant.id)).toEqual([]);
        expect(await activityService.getActivitySlotAssignments(planId, secondParticipant.id)).toEqual([dinner.id]);
    });

    it('rejects an assignment recommendation for an already assigned slot', async () => {
        // Protects both manual and stale automatic payloads from duplicating an existing assignment.
        const eventId = await createIntegrationEvent(owner.id, 'Duplicate recommendation event');
        await registerEventAttendance(eventId, participant, {arrivalDate: '2027-06-01', departureDate: '2027-06-03'});
        const planId = await createEventActivityPlan(owner.id, eventId);
        const dinner = (await activityService.getActivitySlotsFlat(planId))
            .find((slot) => slot.title === 'Dinner cleanup')!;
        await assignActivitySlot(dinner.id, participant.id);

        await expect(activityController.updateRecommendations(planId, {recommendations: [{
            itemId: dinner.id,
            profileId: participant.id,
            status: 'PENDING',
            operation: 'ASSIGN',
        }]})).rejects.toMatchObject({status: 409});
    });
});

describe('activity stay requirement migration', () => {
    it('can run up and down repeatedly while restoring the entity table', async () => {
        const migration = new AddActivityPlanStayRequirements1787688000000();
        const queryRunner = AppDataSource.createQueryRunner();
        await queryRunner.connect();

        try {
            await migration.up(queryRunner);
            await migration.up(queryRunner);
            await migration.down(queryRunner);
            await migration.down(queryRunner);
            await migration.up(queryRunner);

            expect(await queryRunner.hasTable('activity_plan_stay_requirements')).toBe(true);
        } finally {
            await queryRunner.release();
        }
    });
});

describe('activity external assignee migration', () => {
    it('can run up and down repeatedly while restoring the policy column', async () => {
        const migration = new AddActivityPlanExternalAssignees1787688100000();
        const queryRunner = AppDataSource.createQueryRunner();
        await queryRunner.connect();

        try {
            await migration.up(queryRunner);
            await migration.up(queryRunner);
            await migration.down(queryRunner);
            await migration.down(queryRunner);
            await migration.up(queryRunner);

            expect(await queryRunner.hasColumn('activity_plans', 'allow_external_assignees')).toBe(true);
        } finally {
            await queryRunner.release();
        }
    });
});

describe('activity recommendation operation migration', () => {
    it('can run up and down repeatedly while restoring operation metadata', async () => {
        const migration = new AddActivityRecommendationOperations1788134500000();
        const queryRunner = AppDataSource.createQueryRunner();
        await queryRunner.connect();

        try {
            await migration.up(queryRunner);
            await migration.up(queryRunner);
            await migration.down(queryRunner);
            await migration.down(queryRunner);
            await migration.up(queryRunner);

            expect(await queryRunner.hasColumn('activity_assignment_recommendations', 'operation')).toBe(true);
            expect(await queryRunner.hasColumn('activity_assignment_recommendations', 'source_item_id')).toBe(true);
        } finally {
            await queryRunner.release();
        }
    }, 30_000);
});

describe('activity recommendation review-state migration', () => {
    it('can run up and down repeatedly while restoring review metadata', async () => {
        const migration = new AddActivityRecommendationReviewState1788134600000();
        const queryRunner = AppDataSource.createQueryRunner();
        await queryRunner.connect();

        try {
            await migration.up(queryRunner);
            await migration.up(queryRunner);
            await migration.down(queryRunner);
            await migration.down(queryRunner);
            await migration.up(queryRunner);

            expect(await queryRunner.hasColumn('activity_assignment_recommendations', 'is_manual')).toBe(true);
            expect(await queryRunner.hasColumn('activity_assignment_recommendations', 'is_hidden')).toBe(true);
        } finally {
            await queryRunner.release();
        }
    }, 30_000);
});
