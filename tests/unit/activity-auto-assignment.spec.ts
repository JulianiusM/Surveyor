import {describe, expect, it, vi} from 'vitest';
import {generateFairRecommendations} from '../../src/backend/modules/activity/fairAssignment';
import {buildLinkedPlanContext, buildPlanRecommendationContext, mergeParticipants, normalizeRecommendationForPersistence, participantsFromAssignments, projectActivityAssignees} from '../../src/backend/modules/activity/autoAssignment';
import {collectAssignmentWarnings, toAssignmentCandidate} from '../../src/backend/modules/activity/availability';
import {fingerprintRecommendationContext} from '../../src/backend/modules/activity/recommendationJobs';
import * as activityService from '../../src/backend/modules/database/services/ActivityService';
import * as requirementService from '../../src/backend/modules/database/services/ActivityRequirementService';
import * as recommendationService from '../../src/backend/modules/database/services/ActivityRecommendationService';
import {ActivityPlan} from '../../src/backend/modules/database/entities/activity/ActivityPlan';
import type {EntityManager} from 'typeorm';
import {ActivityAssignment} from '../../src/backend/modules/database/entities/activity/ActivityAssignment';
import {ActivityAssignmentRecommendation} from '../../src/backend/modules/database/entities/activity/ActivityAssignmentRecommendation';
import {ActivityAssignmentRole} from '../../src/backend/modules/database/entities/activity/ActivityAssignmentRole';
import {ActivityRole} from '../../src/backend/modules/database/entities/activity/ActivityRole';
import {Profile} from '../../src/backend/modules/database/entities/user/Profile';
import {createActivitySlotEntity, createProfileEntity, createUserEntity} from '../factories/integrationEntityFactory';
import {
    createAutoAssignmentContext,
    createAutoAssignmentParticipant,
    createAutoAssignmentSlot,
} from '../factories/activityAutoAssignmentFactory';
import {createStayRequirement} from '../factories/activityRequirementFactory';

describe('activity recommendation allocation', () => {
    it('canonicalizes worker commitments and fingerprints without replacing stored warning-reference spellings', async () => {
        const upperSlotId = 'ABCD1234-ABCD-4ABC-8ABC-ABCDEF123456';
        const upperProfileId = 'BCDE1234-ABCD-4ABC-8ABC-ABCDEF123456';
        const participantKey = 'profile:' + upperProfileId.toLowerCase();
        const base = createAutoAssignmentContext();
        const plan = Object.assign(new ActivityPlan(), base.plan, {id: 'CDEF1234-ABCD-4ABC-8ABC-ABCDEF123456'});
        plan.eventId = 'DEF01234-ABCD-4ABC-8ABC-ABCDEF123456';
        const slot = Object.assign(createActivitySlotEntity({id: upperSlotId, day: '2027-06-01',
            startTime: '09:00', endTime: '10:00', maxAssignees: 2}), {assignedCount: 1});
        const committed = {id: upperSlotId, day: slot.day, startTime: slot.startTime, endTime: slot.endTime};
        const sourceAssignments = {[participantKey]: [committed]};
        const sibling = Object.assign(new ActivityPlan(), base.plan, {id: 'EF011234-ABCD-4ABC-8ABC-ABCDEF123456',
            title: 'Foreign duty', assignmentMode: 'FREE' as const});
        const foreignSlot = createActivitySlotEntity({id: 'F0121234-ABCD-4ABC-8ABC-ABCDEF123456',
            day: slot.day, startTime: '09:30', endTime: '10:30', title: 'Foreign commitment'});
        const sourceSlot = createActivitySlotEntity({id: 'AB121234-ABCD-4ABC-8ABC-ABCDEF123456'});
        const profile = createProfileEntity(createUserEntity(), {id: upperProfileId});
        const foreignAssignment = Object.assign(new ActivityAssignment(), {id: 7, entityId: sibling.id, item: foreignSlot, profile});
        const proposal = Object.assign(new ActivityAssignmentRecommendation(), {id: 'BC121234-ABCD-4ABC-8ABC-ABCDEF123456',
            entityId: sibling.id, item: foreignSlot, sourceItem: sourceSlot, profile, status: 'PENDING' as const,
            operation: 'REASSIGN' as const});
        const spies = [
            vi.spyOn(activityService, 'getActivityPlanById').mockResolvedValue(plan),
            vi.spyOn(activityService, 'getActivitySlotsFlat').mockResolvedValue([slot]),
            vi.spyOn(activityService, 'getParticipantAssignmentsWithSlots').mockResolvedValue(sourceAssignments),
            vi.spyOn(activityService, 'getParticipantRolesForPlan').mockResolvedValue([{participantKey, roleIds: [7]}]),
            vi.spyOn(requirementService, 'getRequirementConfiguration').mockResolvedValue({plan,
                overrides: [], roleRequirements: base.roleRequirements, stayRequirements: base.stayRequirements}),
            vi.spyOn(activityService, 'getLinkedActivityPlans').mockResolvedValue([sibling]),
            vi.spyOn(activityService, 'getAssignmentsForPlans').mockResolvedValue([foreignAssignment]),
            vi.spyOn(recommendationService, 'getRecommendationsForPlans').mockResolvedValue([proposal]),
        ];
        try {
            const linked = await buildLinkedPlanContext(plan, {} as EntityManager);
            expect(linked.plans[0].id).toBe(sibling.id);
            const warning = collectAssignmentWarnings(toAssignmentCandidate(slot), {profileId: upperProfileId.toLowerCase()},
                linked.commitments[participantKey]).find(warning => warning.type === 'overlap')!;
            expect(warning.conflicts).toEqual([foreignSlot.id, foreignSlot.id]);
            expect(warning.overlapDetails![1]).toMatchObject({id: foreignSlot.id, planId: sibling.id,
                recommendationId: proposal.id, sourceItemId: sourceSlot.id});
            const context = await buildPlanRecommendationContext(plan.id, [], {} as EntityManager);
            expect(context.existingAssignments[participantKey][0].id).toBe(upperSlotId.toLowerCase());
            expect(context.slots[0].id).toBe(upperSlotId.toLowerCase());
            expect(context.participants[0]).toMatchObject({profileId: upperProfileId.toLowerCase(), roleIds: [7]});
            expect(slot.id).toBe(upperSlotId);
            expect(committed.id).toBe(upperSlotId);
            expect(context.linkedPlans!.plans[0].id).toBe(sibling.id.toLowerCase());
            expect(context.linkedPlans!.commitments[participantKey][1]).toMatchObject({id: foreignSlot.id.toLowerCase(),
                planId: sibling.id.toLowerCase(), recommendationId: proposal.id.toLowerCase(), sourceItemId: sourceSlot.id.toLowerCase()});
            const fingerprint = fingerprintRecommendationContext(context);
            slot.id = upperSlotId.toLowerCase();
            committed.id = upperSlotId.toLowerCase();
            plan.eventId = plan.eventId.toLowerCase();
            sibling.id = sibling.id.toLowerCase();
            foreignSlot.id = foreignSlot.id.toLowerCase();
            sourceSlot.id = sourceSlot.id.toLowerCase();
            proposal.id = proposal.id.toLowerCase();
            expect(fingerprintRecommendationContext(await buildPlanRecommendationContext(plan.id, [], {} as EntityManager))).toBe(fingerprint);
            // The captured worker projection was independent of the loaded rows.
            expect(context.existingAssignments[participantKey][0]).not.toBe(committed);
            expect(sourceAssignments[participantKey][0]).toBe(committed);
        } finally {
            for (const spy of spies) spy.mockRestore();
        }
    });

    it('merges UUID profile aliases and keys stored uppercase assignments without changing hydrated rows', () => {
        const profileId = 'ABCD1234-ABCD-4ABC-8ABC-ABCDEF123456';
        const slotId = 'BCDE1234-ABCD-4ABC-8ABC-ABCDEF123456';
        const profile = createProfileEntity(createUserEntity(), {id: profileId, name: ''});
        const item = createActivitySlotEntity({id: slotId});
        const row = Object.assign(new ActivityAssignment(), {id: 42, item, profile, activityAssignmentRoles: []});
        expect(projectActivityAssignees([row])).toEqual({[slotId.toLowerCase()]: [
            {id: 42, profileId, name: '', roles: []},
        ]});
        expect(mergeParticipants([{profileId, name: 'First', arrivalDate: '2027-06-01'}], [
            {profileId: profileId.toLowerCase(), name: 'Latest', departureDate: '2027-06-03'},
        ])).toEqual([{profileId: profileId.toLowerCase(), name: 'Latest', arrivalDate: '2027-06-01', departureDate: '2027-06-03'}]);
        expect(participantsFromAssignments({['profile:' + profileId]: []})).toEqual([{profileId: profileId.toLowerCase()}]);
        expect(row.item.id).toBe(slotId);
        expect(row.profile.id).toBe(profileId);
    });

    it('rejects differently spelled references to the same reassignment source before persistence', () => {
        const itemId = 'ABCD1234-ABCD-4ABC-8ABC-ABCDEF123456';
        expect(() => normalizeRecommendationForPersistence({itemId, sourceItemId: itemId.toLowerCase(),
            profileId: 'BCDE1234-ABCD-4ABC-8ABC-ABCDEF123456', operation: 'REASSIGN'})).toThrowError(
            expect.objectContaining({status: 400, cause: 'ACTIVITY_RECOMMENDATION_SOURCE_INVALID'}),
        );
    });

    it('preserves empty names, role order and saved assignment order in the slot display map', () => {
        const profile = createProfileEntity(createUserEntity(), {id: 'profile-first', name: ''});
        const absentName = Object.assign(new Profile(), {id: 'profile-second'});
        const item = createActivitySlotEntity({id: 'slot-one'});
        const roles = ['Second role', 'First role'].map(title => Object.assign(new ActivityAssignmentRole(), {
            role: Object.assign(new ActivityRole(), {title}),
        }));
        const rows = [
            Object.assign(new ActivityAssignment(), {id: 9, item, profile, activityAssignmentRoles: roles}),
            Object.assign(new ActivityAssignment(), {id: 2, item, profile: absentName, activityAssignmentRoles: []}),
        ];
        expect(projectActivityAssignees(rows)).toEqual({'slot-one': [
            {id: 9, profileId: 'profile-first', name: '', roles: ['Second role', 'First role']},
            {id: 2, profileId: 'profile-second', name: '—', roles: []},
        ]});
        expect(rows[0].profile.name).toBe('');
        expect(rows[0].activityAssignmentRoles).toBe(roles);
    });

    it('bypasses all requirement validation and allocation in free mode', () => {
        // Protects FREE mode from spending CPU or inventing recommendations without targets.
        const context = createAutoAssignmentContext({
            plan: {...createAutoAssignmentContext().plan, assignmentMode: 'FREE'},
            stayRequirements: [],
        });

        expect(generateFairRecommendations(context)).toEqual([]);
    });

    it('fills normal capacity fairly and never emits named role choices', () => {
        // Protects participant fairness while keeping skill-based named roles a manual decision.
        const context = createAutoAssignmentContext();
        const first = generateFairRecommendations(context);
        const second = generateFairRecommendations(context);

        expect(first).toEqual(second);
        expect(first).toHaveLength(2);
        expect(new Set(first.map((recommendation) => recommendation.itemId)).size).toBe(2);
        expect(new Set(first.map((recommendation) => recommendation.profileId)).size).toBe(2);
        expect(first.every((recommendation) => !('roleId' in recommendation))).toBe(true);
    });

    it('moves a pending recommendation to repair a constrained empty slot', () => {
        // Protects total fill when retaining an old pending choice would strand a constrained slot.
        const flexible = createAutoAssignmentParticipant('1');
        const dayTwoOnly = createAutoAssignmentParticipant('2', {
            arrivalDate: '2027-06-02',
        });
        const context = createAutoAssignmentContext({
            slots: [
                createAutoAssignmentSlot('slot-a', '2027-06-01'),
                createAutoAssignmentSlot('slot-b', '2027-06-02', {startTime: '13:00:00', endTime: '14:00:00'}),
            ],
            participants: [flexible, dayTwoOnly],
            existingRecommendations: [{
                itemId: 'slot-b',
                profileId: flexible.profileId,
                status: 'PENDING',
            }],
        });

        const recommendations = generateFairRecommendations(context);

        expect(recommendations).toEqual(expect.arrayContaining([
            expect.objectContaining({itemId: 'slot-a', profileId: flexible.profileId}),
            expect.objectContaining({itemId: 'slot-b', profileId: dayTwoOnly.profileId}),
        ]));
    });

    it('treats approved recommendations as locked while recalculating pending work', () => {
        // Protects organizer decisions from being displaced by a later automatic run.
        const context = createAutoAssignmentContext();
        const approvedParticipant = context.participants[0];
        const otherParticipant = context.participants[1];
        context.existingRecommendations = [{
            itemId: 'slot-a',
            profileId: approvedParticipant.profileId,
            status: 'APPROVED',
        }];

        const recommendations = generateFairRecommendations(context);

        expect(recommendations).toEqual([
            expect.objectContaining({itemId: 'slot-b', profileId: otherParticipant.profileId}),
        ]);
    });

    it('does not recreate a recommendation that an organizer rejected', () => {
        // Protects rejection history from being counted as fill and then discarded during persistence.
        const context = createAutoAssignmentContext({
            slots: [createAutoAssignmentSlot('rejected-slot', '2027-06-01')],
            participants: [createAutoAssignmentParticipant('1', {departureDate: '2027-06-01'})],
            existingRecommendations: [{
                itemId: 'rejected-slot',
                profileId: '00000000-0000-4000-8000-000000000001',
                status: 'REJECTED',
            }],
        });

        expect(generateFairRecommendations(context)).toEqual([]);
    });

    it('uses overfill only after all normally fillable capacity is occupied', () => {
        // Protects the explicit overfill flag as a last-resort way to satisfy every participant requirement.
        const fullStay = createAutoAssignmentParticipant('1');
        const dayOneA = createAutoAssignmentParticipant('2', {departureDate: '2027-06-01'});
        const dayOneB = createAutoAssignmentParticipant('3', {departureDate: '2027-06-01'});
        const base = createAutoAssignmentContext({
            participants: [fullStay, dayOneA, dayOneB],
            stayRequirements: [createStayRequirement(1, 1), createStayRequirement(2, 2)],
        });

        const capped = generateFairRecommendations(base);
        const overfilled = generateFairRecommendations({
            ...base,
            plan: {...base.plan, allowOverfillAfterFull: true},
        });

        expect(capped).toHaveLength(2);
        expect(new Set(capped.map((recommendation) => recommendation.itemId))).toEqual(new Set(['slot-a', 'slot-b']));
        expect(overfilled).toHaveLength(4);
        expect(new Set(overfilled.map((recommendation) => recommendation.profileId))).toEqual(
            new Set([fullStay.profileId, dayOneA.profileId, dayOneB.profileId]),
        );
    });

    it('balances fulfillment ratios before giving a participant their second shift', () => {
        // Protects fairness as the primary tie-breaker even when one participant has a larger target.
        const first = createAutoAssignmentParticipant('1');
        const second = createAutoAssignmentParticipant('2', {departureDate: '2027-06-01'});
        const context = createAutoAssignmentContext({
            slots: [createAutoAssignmentSlot('shared', '2027-06-01', {maxAssignees: 2})],
            participants: [first, second],
            stayRequirements: [createStayRequirement(1, 1), createStayRequirement(2, 2)],
        });

        const recommendations = generateFairRecommendations(context);

        expect(recommendations).toHaveLength(2);
        expect(new Set(recommendations.map((recommendation) => recommendation.profileId)).size).toBe(2);
    });

    it('spreads each participant shifts across their full attendance window', () => {
        // Protects recommendations from clustering every participant into the earliest chronological slots.
        const slots = Array.from({length: 4}, (_, index) =>
            createAutoAssignmentSlot(`day-${index + 1}`, `2027-06-0${index + 1}`));
        const participants = [createAutoAssignmentParticipant('1'), createAutoAssignmentParticipant('2')]
            .map((participant) => ({...participant, departureDate: '2027-06-04'}));
        const recommendations = generateFairRecommendations(createAutoAssignmentContext({
            plan: {...createAutoAssignmentContext().plan, endDate: '2027-06-04'},
            slots,
            participants,
            stayRequirements: [1, 2, 3, 4].map((stayDays) => createStayRequirement(stayDays, 2)),
        }));

        for (const participant of participants) {
            const days = recommendations
                .filter((recommendation) => recommendation.profileId === participant.profileId)
                .map((recommendation) => slots.find((slot) => slot.id === recommendation.itemId)!.day)
                .sort();
            expect(days).toHaveLength(2);
            expect(Number(days[1].slice(-2)) - Number(days[0].slice(-2))).toBeGreaterThanOrEqual(2);
        }
    });

    it('uses locked assignments when choosing the next temporal anchor', () => {
        // Protects recalculation from placing a participant's remaining work beside an existing early shift.
        const participant = createAutoAssignmentParticipant('1', {departureDate: '2027-06-04'});
        const slots = Array.from({length: 4}, (_, index) =>
            createAutoAssignmentSlot(`day-${index + 1}`, `2027-06-0${index + 1}`));
        const recommendations = generateFairRecommendations(createAutoAssignmentContext({
            plan: {...createAutoAssignmentContext().plan, endDate: '2027-06-04'},
            slots,
            participants: [participant],
            stayRequirements: [1, 2, 3, 4].map((stayDays) => createStayRequirement(stayDays, 2)),
            existingAssignments: {
                [`profile:${participant.profileId}`]: [{
                    id: 'day-1',
                    day: '2027-06-01',
                    startTime: '09:00:00',
                    endTime: '10:00:00',
                }],
            },
        }));

        expect(recommendations).toEqual([
            expect.objectContaining({itemId: 'day-4', profileId: participant.profileId}),
        ]);
    });

    it('never recommends a participant for a slot they already hold', () => {
        // Protects regeneration after manual assignment changes from duplicating an existing commitment.
        const participant = createAutoAssignmentParticipant('1');
        const recommendations = generateFairRecommendations(createAutoAssignmentContext({
            participants: [participant],
            stayRequirements: [createStayRequirement(1, 1), createStayRequirement(2, 2)],
            existingAssignments: {
                [`profile:${participant.profileId}`]: [{
                    id: 'slot-a',
                    day: '2027-06-01',
                    startTime: '09:00:00',
                    endTime: '10:00:00',
                }],
            },
        }));

        expect(recommendations).toEqual([
            expect.objectContaining({itemId: 'slot-b', profileId: participant.profileId}),
        ]);
    });

    it('uses only allowed arrival and departure boundary slots', () => {
        // Protects hard arrival-morning/departure-evening exclusions and both opt-in boundary settings.
        const participant = createAutoAssignmentParticipant('1', {
            arrivalDate: '2027-06-01',
            departureDate: '2027-06-03',
        });
        const slots = [
            createAutoAssignmentSlot('arrival-morning', '2027-06-01', {startTime: '09:00:00'}),
            createAutoAssignmentSlot('arrival-evening', '2027-06-01', {startTime: '13:00:00', endTime: '14:00:00'}),
            createAutoAssignmentSlot('middle', '2027-06-02', {startTime: '09:00:00'}),
            createAutoAssignmentSlot('departure-morning', '2027-06-03', {startTime: '09:00:00'}),
            createAutoAssignmentSlot('departure-evening', '2027-06-03', {startTime: '13:00:00', endTime: '14:00:00'}),
        ];
        const base = createAutoAssignmentContext({
            plan: {...createAutoAssignmentContext().plan, endDate: '2027-06-03'},
            participants: [participant],
            slots,
            stayRequirements: [1, 2, 3].map((stayDays) => createStayRequirement(stayDays, 5)),
        });

        const enabled = generateFairRecommendations(base);
        const disabled = generateFairRecommendations({
            ...base,
            plan: {
                ...base.plan,
                allowArrivalDayEvening: false,
                allowDepartureDayMorning: false,
            },
        });

        expect(new Set(enabled.map(({itemId}) => itemId))).toEqual(new Set([
            'arrival-evening',
            'middle',
            'departure-morning',
        ]));
        expect(disabled.map(({itemId}) => itemId)).toEqual(['middle']);
    });

    it('reassigns a roleless committed participant to unlock a constrained slot', () => {
        // Protects augmenting repair that clearly moves an existing default-role assignment before filling its source.
        const flexible = createAutoAssignmentParticipant('1');
        const lateArrival = createAutoAssignmentParticipant('2', {arrivalDate: '2027-06-02'});
        const target = createAutoAssignmentSlot('constrained', '2027-06-01');
        const source = createAutoAssignmentSlot('source', '2027-06-02', {
            startTime: '13:00:00',
            endTime: '14:00:00',
        });
        const recommendations = generateFairRecommendations(createAutoAssignmentContext({
            slots: [target, source],
            participants: [flexible, lateArrival],
            existingAssignments: {
                [`profile:${flexible.profileId}`]: [{...source, hasNamedRole: false}],
            },
        }));

        expect(recommendations).toEqual(expect.arrayContaining([
            expect.objectContaining({
                itemId: target.id,
                profileId: flexible.profileId,
                operation: 'REASSIGN',
                sourceItemId: source.id,
            }),
            expect.objectContaining({
                itemId: source.id,
                profileId: lateArrival.profileId,
                operation: 'ASSIGN',
            }),
        ]));
    });

    it('does not reassign a committed participant who holds a named role', () => {
        // Protects named-role commitments from being silently destroyed by automatic repair.
        const flexible = createAutoAssignmentParticipant('1');
        const lateArrival = createAutoAssignmentParticipant('2', {arrivalDate: '2027-06-02'});
        const target = createAutoAssignmentSlot('constrained', '2027-06-01');
        const source = createAutoAssignmentSlot('source', '2027-06-02', {
            startTime: '13:00:00',
            endTime: '14:00:00',
        });

        expect(generateFairRecommendations(createAutoAssignmentContext({
            slots: [target, source],
            participants: [flexible, lateArrival],
            existingAssignments: {
                [`profile:${flexible.profileId}`]: [{...source, hasNamedRole: true}],
            },
        }))).toEqual([]);
    });
});
