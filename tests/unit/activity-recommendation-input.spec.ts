import {describe, expect, it} from 'vitest';
import type {ActivityAssignmentRecommendation} from '../../src/backend/modules/database/entities/activity/ActivityAssignmentRecommendation';
import {toRecommendationInput} from '../../src/backend/modules/activity/autoAssignment';
import {buildRecommendationWarnings, collectAssignmentWarnings, normalizeRecommendationInput, recommendationInputKey} from '../../src/backend/modules/activity/availability';
import {overlapConfirmation, requireOverlapConfirmation} from '../../src/backend/modules/activity/recommendations';
import {createActivitySlotEntity} from '../factories/integrationEntityFactory';

describe('Activity recommendation review and allocation identity', () => {
    it('retains saved review identity while keeping allocation memory independent of row identity', () => {
        const recommendation = {
            id: 'saved-review-row', item: {id: 'slot'}, profile: {id: 'person'},
            status: 'APPROVED', operation: 'ASSIGN', sourceItem: null, manual: false, hidden: false,
        } as ActivityAssignmentRecommendation;

        const saved = toRecommendationInput(recommendation);
        const memory = toRecommendationInput(recommendation, 'memory');
        const {id, ...content} = saved;

        expect(id).toBe(recommendation.id);
        expect(Object.keys(saved)[0]).toBe('id');
        expect(Object.hasOwn(memory, 'id')).toBe(false);
        expect(memory).toEqual(content);
        expect(memory.sourceItemId).toBeNull();
        expect(toRecommendationInput({...recommendation, id: 'regenerated-review-row'}, 'memory')).toEqual(memory);
    });

    it('normalizes reference components once without replacing saved row spelling or opaque identifiers', () => {
        const input = {id: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA', itemId: 'BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB',
            profileId: 'CCCCCCCC-CCCC-4CCC-8CCC-CCCCCCCCCCCC', sourceItemId: 'DDDDDDDD-DDDD-4DDD-8DDD-DDDDDDDDDDDD',
            operation: 'REASSIGN' as const};
        const result = normalizeRecommendationInput(input, 'canonical');

        expect(normalizeRecommendationInput(input)).toMatchObject(input);
        expect(result).toMatchObject({id: input.id, itemId: input.itemId.toLowerCase(),
            profileId: input.profileId.toLowerCase(), sourceItemId: input.sourceItemId.toLowerCase()});
        expect(input.itemId).toBe('BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB');
        expect(normalizeRecommendationInput({itemId: 'Slot-A', profileId: 'Person-B'}))
            .toMatchObject({itemId: 'Slot-A', profileId: 'Person-B'});
    });

    it('keys equivalent UUID operations together while preserving operation, source and opaque identity distinctions', () => {
        const input = {itemId: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA',
            profileId: 'BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB', sourceItemId: 'CCCCCCCC-CCCC-4CCC-8CCC-CCCCCCCCCCCC',
            operation: 'REASSIGN' as const};
        const lower = {...input, itemId: input.itemId.toLowerCase(), profileId: input.profileId.toLowerCase(),
            sourceItemId: input.sourceItemId.toLowerCase()};

        expect(recommendationInputKey(input)).toBe(recommendationInputKey(lower));
        expect(recommendationInputKey({...lower, operation: 'ASSIGN'})).not.toBe(recommendationInputKey(input));
        expect(recommendationInputKey({...lower, sourceItemId: lower.itemId})).not.toBe(recommendationInputKey(input));
        expect(recommendationInputKey({itemId: 'Slot-A', profileId: 'Person-B'}))
            .not.toBe(recommendationInputKey({itemId: 'slot-a', profileId: 'Person-B'}));
    });

    it('projects mixed stored slot spellings through the same release, overlap and capacity identities', () => {
        const sourceId = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA';
        const targetId = 'BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB';
        const profileId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
        const source = createActivitySlotEntity({id: sourceId, day: '2027-06-01', startTime: '09:00', endTime: '10:00'});
        const target = createActivitySlotEntity({...source, id: targetId});
        const results = buildRecommendationWarnings({slots: [source, target], recommendations: [
            {itemId: targetId.toLowerCase(), sourceItemId: sourceId.toLowerCase(), profileId, operation: 'REASSIGN'},
        ], existingAssignments: {[`profile:${profileId}`]: [source]}, slotCapacities: {[targetId.toLowerCase()]: 0}});

        expect(results[0].warnings).toEqual([{type: 'over_capacity'}]);
        expect(results[0].recommendation.itemId).toBe(targetId.toLowerCase());
        expect(collectAssignmentWarnings({...source, id: sourceId.toLowerCase()}, {profileId}, [source])).toEqual([]);
        expect(source.id).toBe(sourceId);
        expect(target.id).toBe(targetId);
    });

    it('binds overlap acknowledgement to UUID identity while keeping the opaque digest case-sensitive', () => {
        const planId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
        const slotId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
        const foreignPlanId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
        const profileId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
        const foreignSlotId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
        const rowId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
        const results = [{recommendation: {itemId: slotId, profileId, manual: true}, warnings: [{
            type: 'overlap' as const, confirmable: true,
            overlapTarget: {id: slotId, planId, day: '2027-06-01', startTime: '09:00', endTime: '10:00'},
            overlapDetails: [{id: foreignSlotId, planId: foreignPlanId, recommendationId: rowId,
                sourceItemId: slotId, operation: 'REASSIGN' as const, day: '2027-06-01',
                startTime: '09:00', endTime: '10:00'}],
        }]}];
        let uppercase = JSON.stringify(results);
        for (const id of [planId, slotId, foreignPlanId, profileId, foreignSlotId, rowId]) {
            uppercase = uppercase.replaceAll(id, id.toUpperCase());
        }
        const digest = overlapConfirmation(planId, results)!;

        expect(digest).toMatch(/^[a-f0-9]{64}$/);
        expect(overlapConfirmation(planId.toUpperCase(), JSON.parse(uppercase))).toBe(digest);
        expect(() => requireOverlapConfirmation(digest, digest)).not.toThrow();
        expect(() => requireOverlapConfirmation(digest, digest.toUpperCase())).toThrow();
        expect(overlapConfirmation(planId, [{...results[0], warnings: [{...results[0].warnings[0],
            overlapDetails: [{...results[0].warnings[0].overlapDetails[0], endTime: '11:00'}]}]}])).not.toBe(digest);
    });
});
