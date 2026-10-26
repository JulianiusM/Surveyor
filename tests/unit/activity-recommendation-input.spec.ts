import {describe, expect, it} from 'vitest';
import type {ActivityAssignmentRecommendation} from '../../src/backend/modules/database/entities/activity/ActivityAssignmentRecommendation';
import {toRecommendationInput} from '../../src/backend/modules/activity/recommendationPersistence';

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
});
