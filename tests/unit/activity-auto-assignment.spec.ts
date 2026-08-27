import {describe, expect, it} from 'vitest';
import {generateFairRecommendations} from '../../src/modules/activity/fairAssignment';
import {
    createAutoAssignmentContext,
    createAutoAssignmentParticipant,
    createAutoAssignmentSlot,
} from '../factories/activityAutoAssignmentFactory';
import {createStayRequirement} from '../factories/activityRequirementFactory';

describe('activity recommendation allocation', () => {
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
            departureDate: '2027-06-02',
        });
        const context = createAutoAssignmentContext({
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
});
