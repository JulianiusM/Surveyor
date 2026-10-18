import {describe, expect, it} from 'vitest';
import {generateFairRecommendations} from '../../src/modules/activity/fairAssignment';
import {buildRecommendationWarnings} from '../../src/modules/activity/recommendations';
import {fingerprintRecommendationContext} from '../../src/modules/activity/recommendationJobs';
import type {AutoAssignmentContext} from '../../src/modules/activity/autoAssignment';
import type {ActivityLinkedPlanContext, AssignmentCandidate} from '../../src/types/ActivityTypes';
import {createAutoAssignmentContext, createAutoAssignmentParticipant, createAutoAssignmentSlot} from '../factories/activityAutoAssignmentFactory';
import {createParticipantRequirementOverride} from '../factories/activityRequirementFactory';
import {createActivitySlotEntity} from '../factories/integrationEntityFactory';

const participant = createAutoAssignmentParticipant('1');
const participantKey = 'profile:' + participant.profileId;

/** Foreign counts, roles and temporal anchors are deliberately absent from the local requirement fixture. */
function linkedContext(mode: 'FREE' | 'REQUIRED' = 'REQUIRED', overrides: Partial<AssignmentCandidate> = {}): ActivityLinkedPlanContext {
    return {
        plans: [{id: 'sibling', assignmentMode: mode, startDate: '2027-06-01', endDate: '2027-06-02'}],
        commitments: {[participantKey]: [{
            id: 'foreign-slot', planId: 'sibling', assignmentMode: mode,
            day: '2027-06-01', startTime: '09:00:00', endTime: '10:00:00', ...overrides,
        }]},
    };
}

describe('linked activity recommendation allocation', () => {
    it('avoids sibling commitments without counting their shifts toward the local requirement', () => {
        const context = createAutoAssignmentContext({participants: [participant], linkedPlans: linkedContext()});
        expect(generateFairRecommendations(context)).toEqual([
            expect.objectContaining({itemId: 'slot-b', profileId: participant.profileId}),
        ]);
        expect(generateFairRecommendations(context)).toEqual(generateFairRecommendations(context));
    });

    it('chooses an overlap-free placement before Required-over-Free fallback', () => {
        const context = createAutoAssignmentContext({participants: [participant], linkedPlans: linkedContext('FREE')});
        expect(generateFairRecommendations(context)).toEqual([expect.objectContaining({itemId: 'slot-b'})]);
    });

    it('uses permitted overlap-free overfill before overlapping a Free commitment', () => {
        const context = createAutoAssignmentContext({
            participants: [participant], linkedPlans: linkedContext('FREE'),
            slots: [createAutoAssignmentSlot('slot-a', '2027-06-01'),
                createAutoAssignmentSlot('slot-b', '2027-06-02', {assignedCount: 1})],
        });
        context.plan.allowOverfillAfterFull = true;
        expect(generateFairRecommendations(context)).toEqual([expect.objectContaining({itemId: 'slot-b'})]);
    });

    it('places otherwise unresolvable Required work over a Free commitment without moving it', () => {
        const context = createAutoAssignmentContext({
            participants: [participant], slots: [createAutoAssignmentSlot('slot-a', '2027-06-01')],
            linkedPlans: linkedContext('FREE', {recommendationId: 'foreign-review', recommendationStatus: 'PENDING', operation: 'REASSIGN'}),
        });
        expect(generateFairRecommendations(context)).toEqual([
            expect.objectContaining({itemId: 'slot-a', operation: 'ASSIGN', sourceItemId: null}),
        ]);
        expect(context.linkedPlans?.commitments[participantKey][0].id).toBe('foreign-slot');
    });

    it.each(['REQUIRED', undefined] as const)('does not relax sibling commitments with mode %s', (mode) => {
        const context = createAutoAssignmentContext({
            participants: [participant], slots: [createAutoAssignmentSlot('slot-a', '2027-06-01')],
            linkedPlans: linkedContext('FREE', {assignmentMode: mode}),
        });
        expect(generateFairRecommendations(context)).toEqual([]);
    });

    it.each([
        {name: 'capacity', slot: {assignedCount: 1}, participant: {}, history: []},
        {name: 'attendance', slot: {}, participant: {arrivalDate: '2027-06-02'}, history: []},
        {name: 'rejection memory', slot: {}, participant: {}, history: [{itemId: 'slot-a', profileId: participant.profileId, status: 'REJECTED' as const}]},
    ])('preserves $name during priority fallback', (example) => {
        expect(generateFairRecommendations(createAutoAssignmentContext({
            participants: [{...participant, ...example.participant}],
            slots: [createAutoAssignmentSlot('slot-a', '2027-06-01', example.slot)],
            existingRecommendations: example.history, linkedPlans: linkedContext('FREE'),
        }))).toEqual([]);
    });

    it('keeps same-plan overlaps strict during priority fallback', () => {
        expect(generateFairRecommendations(createAutoAssignmentContext({
            participants: [participant], slots: [createAutoAssignmentSlot('slot-a', '2027-06-01')],
            overrides: [createParticipantRequirementOverride(participant.profileId!, 2)],
            existingAssignments: {[participantKey]: [{
                id: 'local', day: '2027-06-01', startTime: '09:00', endTime: '10:00', hasNamedRole: true,
            }]}, linkedPlans: linkedContext('FREE'),
        }))).toEqual([]);
    });

    it('reserves retained manual targets without treating generated pending output as immutable', () => {
        expect(generateFairRecommendations(createAutoAssignmentContext({
            participants: [participant], slots: [createAutoAssignmentSlot('slot-a', '2027-06-01')],
            existingRecommendations: [{itemId: 'slot-a', profileId: participant.profileId, status: 'PENDING', manual: true}],
        }))).toEqual([]);
    });

    it.each([
        {endTime: '09:00:00'}, {day: '2027-06-02'}, {startTime: null},
    ])('preserves the established touching/day/incomplete-timebox rules: %j', (overrides) => {
        expect(generateFairRecommendations(createAutoAssignmentContext({
            participants: [participant], slots: [createAutoAssignmentSlot('slot-a', '2027-06-01')],
            linkedPlans: linkedContext('REQUIRED', overrides),
        }))).toHaveLength(1);
    });
});

describe('recommendation schedule projection', () => {
    const first = createActivitySlotEntity({id: 'first', day: '2027-06-01', startTime: '09:00', endTime: '10:00'});
    const second = createActivitySlotEntity({id: 'second', day: first.day, startTime: first.startTime, endTime: first.endTime});
    const source = {id: first.id, day: first.day, startTime: first.startTime, endTime: first.endTime};

    it('reports overlapping targets symmetrically regardless of review order', () => {
        const recommendations = [
            {itemId: first.id, profileId: participant.profileId},
            {itemId: second.id, profileId: participant.profileId},
        ];
        for (const batch of [recommendations, [...recommendations].reverse()]) {
            const results = buildRecommendationWarnings({slots: [first, second], recommendations: batch});
            expect(results).toHaveLength(2);
            for (const result of results) expect(result.warnings).toContainEqual(expect.objectContaining({type: 'overlap'}));
        }
    });

    it('releases selected sources before checking moves and removals', () => {
        const recommendations = [
            {itemId: first.id, profileId: participant.profileId, operation: 'UNASSIGN' as const},
            {itemId: second.id, profileId: participant.profileId},
        ];
        for (const batch of [recommendations, [...recommendations].reverse()]) {
            const results = buildRecommendationWarnings({
                slots: [first, second], recommendations: batch, existingAssignments: {[participantKey]: [source]},
                slotCapacities: {[first.id]: 0, [second.id]: 1},
            });
            expect(results.every((result) => result.warnings.length === 0)).toBe(true);
        }
    });

    it('never releases a foreign commitment because a local proposal moves or removes its own source', () => {
        const results = buildRecommendationWarnings({
            slots: [first, second],
            recommendations: [{itemId: second.id, sourceItemId: first.id, profileId: participant.profileId, operation: 'REASSIGN'}],
            existingAssignments: {[participantKey]: [source]}, linkedAssignments: linkedContext('FREE').commitments,
        });
        expect(results[0].warnings).toContainEqual(expect.objectContaining({
            type: 'overlap', conflicts: ['foreign-slot'],
            overlapTarget: expect.objectContaining({id: second.id}),
        }));
    });
});

describe('linked recommendation input freshness', () => {
    it('fingerprints sibling priority, timeboxes, membership and active proposal state independently of display order', () => {
        const original = createAutoAssignmentContext({linkedPlans: linkedContext('FREE')}) as AutoAssignmentContext;
        const originalFingerprint = fingerprintRecommendationContext(original);
        const alternatives = [
            linkedContext('REQUIRED'), linkedContext('FREE', {endTime: '11:00'}),
            linkedContext('FREE', {recommendationId: 'proposal', recommendationStatus: 'PENDING'}),
            linkedContext('FREE', {recommendationId: 'proposal', recommendationStatus: 'APPROVED'}),
            {plans: [], commitments: {}},
        ];
        for (const linkedPlans of alternatives) {
            expect(fingerprintRecommendationContext({...original, linkedPlans})).not.toBe(originalFingerprint);
        }
        const pending = {...original, existingRecommendations: [{itemId: 'slot-a', profileId: participant.profileId, status: 'PENDING' as const}]};
        expect(fingerprintRecommendationContext(pending)).toBe(originalFingerprint);
    });
});
