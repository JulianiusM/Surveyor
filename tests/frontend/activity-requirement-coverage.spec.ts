import {describe, expect, it} from 'vitest';
import {
    calculateLiveRequirementAnalysis,
    calculateLiveRequirementSummary,
    evaluateRequirementCoverage,
} from '../../src/public/js/modules/activity/activity-requirements';
import {calculateParticipantStatusStats} from '../../src/public/js/modules/activity/activity-participants';
import {
    createRequirementConfiguration,
    createRequirementDraft,
    createRequirementParticipantSummary,
} from '../factories/activityRequirementCoverageFactory';

describe('activity requirement live coverage', () => {
    it('treats capacity as a minimum when overfill is allowed', () => {
        expect(evaluateRequirementCoverage(4, 6, true, 'REQUIRED')).toMatchObject({
            state: 'acceptable',
            title: 'Above slot capacity by 2',
        });
        expect(evaluateRequirementCoverage(4, 2, true, 'REQUIRED')).toMatchObject({
            state: 'conflict',
            title: 'Short of slot capacity by 2',
        });
    });

    it('treats capacity as a hard cap when overfill is disabled', () => {
        expect(evaluateRequirementCoverage(4, 6, false, 'REQUIRED')).toMatchObject({
            state: 'conflict',
            title: 'Hard slot capacity exceeded by 2',
        });
        expect(evaluateRequirementCoverage(4, 2, false, 'REQUIRED')).toMatchObject({
            state: 'acceptable',
            title: 'Below hard slot capacity by 2',
        });
    });

    it('marks only matching totals as exact coverage', () => {
        expect(evaluateRequirementCoverage(4, 4, false, 'REQUIRED')).toMatchObject({
            state: 'exact',
            title: 'Exact coverage',
        });
    });

    it('recalculates participant demand from unsaved duration, role, and override values', () => {
        const config = createRequirementConfiguration();

        const [durationResult] = calculateLiveRequirementSummary(
            config,
            createRequirementDraft({stayRequirements: [{stayDays: 3, requiredShifts: 3}]}),
        );
        const [roleResult] = calculateLiveRequirementSummary(
            config,
            createRequirementDraft({
                stayRequirements: [],
                roleRequirements: [{roleId: 7, requiredShifts: 4}],
            }),
        );
        const [overrideResult] = calculateLiveRequirementSummary(
            config,
            createRequirementDraft({
                overrides: [{
                    profileId: '00000000-0000-4000-8000-000000000001',
                    requiredShifts: 1,
                }],
            }),
        );

        expect(durationResult).toMatchObject({requiredShifts: 3, source: 'general'});
        expect(roleResult).toMatchObject({requiredShifts: 4, source: 'role'});
        expect(overrideResult).toMatchObject({requiredShifts: 1, source: 'override'});
    });

    it('keeps a zero-shift role override in the live coverage total', () => {
        const [result] = calculateLiveRequirementSummary(
            createRequirementConfiguration(),
            createRequirementDraft({roleRequirements: [{roleId: 7, requiredShifts: 0}]}),
        );

        expect(result).toMatchObject({requiredShifts: 0, source: 'role'});
    });

    it('recomputes hypothetical open-role coverage from the unsaved draft', () => {
        // Protects the browser preview from subtracting stale role coverage returned for the saved plan.
        const profileId = '00000000-0000-4000-8000-000000000001';
        const config = createRequirementConfiguration({
            participants: [createRequirementParticipantSummary({roleIds: []})],
            calculationContext: {
                participants: [{
                    profileId,
                    arrivalDate: '2027-06-01',
                    departureDate: '2027-06-03',
                    roleIds: [],
                    name: 'Alex Participant',
                }],
                assignedShiftCounts: {[`profile:${profileId}`]: 0},
                slots: [{
                    id: 'role-slot',
                    day: '2027-06-01',
                    maxAssignees: 2,
                    roles: [{roleId: 7, maxQty: 1, assignedQty: 0}],
                }],
            },
        });
        const analysis = calculateLiveRequirementAnalysis(config, createRequirementDraft({
            roleRequirements: [{roleId: 7, requiredShifts: 1}],
            stayRequirements: [{stayDays: 1, requiredShifts: 2}, {stayDays: 2, requiredShifts: 3}, {stayDays: 3, requiredShifts: 4}],
        }));

        expect(analysis).toMatchObject({
            participants: [expect.objectContaining({requiredShifts: 4, source: 'general'})],
            capacitySummary: {
                availableSlots: 2,
                requiredSlots: 1,
                difference: 1,
                hypotheticalRoleCoverage: {filledRoleCount: 1, removedRequiredShifts: 3},
            },
        });
    });

    it('keeps assignment coverage useful when free mode has no shift requirements', () => {
        const config = createRequirementConfiguration();
        const participants = calculateLiveRequirementSummary(
            config,
            createRequirementDraft({assignmentMode: 'FREE', stayRequirements: [], roleRequirements: []}),
        );
        participants[0].assignedShifts = 1;

        expect(participants[0]).toMatchObject({requiredShifts: 0, remainingShifts: 0, source: 'none'});
        expect(calculateParticipantStatusStats(participants)).toEqual({
            total: 1,
            assigned: 1,
            unassigned: 0,
            unstarted: 0,
            needsMore: 0,
            complete: 0,
            noRequirement: 1,
        });
    });

    it('separates participants who have not started from those making partial progress', () => {
        const stats = calculateParticipantStatusStats([
            createRequirementParticipantSummary({assignedShifts: 0, requiredShifts: 3, remainingShifts: 3}),
            createRequirementParticipantSummary({
                participantKey: 'profile:00000000-0000-4000-8000-000000000002',
                assignedShifts: 1,
                requiredShifts: 3,
                remainingShifts: 2,
            }),
        ]);

        expect(stats).toMatchObject({unstarted: 1, needsMore: 1, complete: 0});
    });
});
