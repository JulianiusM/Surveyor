import {describe, expect, it} from 'vitest';
import {ActivityRecommendationsState} from '../../src/public/js/modules/activity/activity-recommendations-state';
import {RecommendationsLogic} from '../../src/public/js/modules/activity/activity-recommendations-logic';
import {describeWarning} from '../../src/public/js/modules/activity/activity-assignments';
import type {RecommendationRow} from '../../src/public/js/modules/activity/activity-types';

function row(overrides: Partial<RecommendationRow> = {}): RecommendationRow {
    return {item: {id: 'target', title: 'Duty'}, profile: {id: 'profile', name: 'Participant'},
        status: 'APPROVED', operation: 'REASSIGN', sourceItem: {id: 'source', title: 'Earlier duty'}, manual: true, ...overrides};
}

describe('activity recommendation warning review', () => {
    it('retains overlap warnings through approval/reversion and hides them only when the row is rejected', () => {
        const state = new ActivityRecommendationsState();
        const recommendation = row();
        state.setRecommendations([recommendation]);
        state.setWarnings([{recommendation: {
            itemId: 'target', sourceItemId: 'source', profileId: 'profile', operation: 'REASSIGN',
        }, warnings: [{type: 'overlap', confirmable: true}]}]);
        expect(state.getWarningsForRecommendation(recommendation)).toEqual([{type: 'overlap', confirmable: true}]);
        state.updateRecommendationStatus(recommendation, 'PENDING');
        expect(state.getWarningsForRecommendation(recommendation)).toHaveLength(1);
        state.updateRecommendationStatus(recommendation, 'REJECTED');
        expect(state.getWarningsForRecommendation(recommendation)).toEqual([]);
        state.updateRecommendationStatus(recommendation, 'APPROVED');
        expect(state.getWarningsForRecommendation(recommendation)).toHaveLength(1);
        expect(state.getWarningsForRecommendation(row({operation: 'ASSIGN', sourceItem: null}))).toEqual([]);
    });

    it('serializes exactly the same complete operation for preview and application without staging hypothetical rows', () => {
        const state = new ActivityRecommendationsState();
        const logic = new RecommendationsLogic(state);
        state.setRecommendations([row(), row({id: 'deleted', status: 'REJECTED'}),
            row({id: 'rejection-memory', manual: false, status: 'REJECTED'})]);
        const staged = row({item: {id: 'other', title: 'Other duty'}, operation: 'ASSIGN', sourceItem: null});
        const draft = logic.createReviewPayload();
        expect(draft).toHaveLength(2);
        expect(draft[0]).toMatchObject({itemId: 'target', profileId: 'profile', operation: 'REASSIGN',
            sourceItemId: 'source', status: 'APPROVED', manual: true});
        expect(logic.createReviewPayload([staged])).toHaveLength(3);
        expect(logic.createReviewPayload()).toEqual(draft);
    });

    it('keeps hidden-plan warnings useful and describes the mandatory discussion before Required-over-Free confirmation', () => {
        function describeSlot(id: string) { return 'Visible ' + id; }
        const generic = describeWarning({type: 'overlap', confirmable: true, conflicts: [], overlapDetails: []}, describeSlot);
        expect(generic).toContain('another assignment or recommendation');
        expect(generic).toContain('before confirming');
        const specific = describeWarning({type: 'overlap', confirmable: true, requiredPriority: true,
            overlapDetails: [{id: 'foreign', planTitle: 'Free plan', title: 'Optional activity', day: '2027-06-02',
                startTime: '09:00:00', endTime: '10:00:00'}]}, describeSlot);
        expect(specific).toContain('Free plan: Optional activity');
        expect(specific).toContain('Required takes precedence over Free');
        expect(specific).toContain('Discuss this conflict with the participant before confirming');
    });
});
