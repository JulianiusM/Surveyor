import {generateAutoRecommendations, AutoAssignmentContext} from "../../../src/modules/activity/autoAssignment";
import {AssignmentCandidate} from "../../../src/modules/activity/availability";
import {RecommendationInput} from "../../../src/modules/database/services/ActivityRecommendationService";

describe('generateAutoRecommendations', () => {
    const basePlan = {
        assignmentMode: 'REQUIRED' as const,
        generalRequiredShifts: 2,
        roundingMode: 'CEIL' as const,
        startDate: '2024-01-01',
        endDate: '2024-01-02',
        allowOverfillAfterFull: false,
        allowArrivalDayEvening: true,
        allowDepartureDayMorning: true,
    };

    function buildContext(overrides: Partial<AutoAssignmentContext> = {}): AutoAssignmentContext {
        const slots = overrides.slots ?? [
            {id: 'slot-1', day: '2024-01-01', startTime: '09:00', endTime: '10:00', pos: 1, maxAssignees: 1} as any,
            {id: 'slot-2', day: '2024-01-01', startTime: '10:00', endTime: '11:00', pos: 2, maxAssignees: 1} as any,
            {id: 'slot-3', day: '2024-01-02', startTime: '09:00', endTime: '10:00', pos: 1, maxAssignees: 1} as any,
        ];

        return {
            plan: {...basePlan, ...(overrides.plan ?? {})},
            slots,
            participants: overrides.participants ?? [],
            roleRequirements: overrides.roleRequirements ?? [],
            overrides: overrides.overrides ?? [],
            existingAssignments: overrides.existingAssignments ?? {},
        };
    }

    it('assigns participants fairly based on required shifts and attendance', () => {
        const context = buildContext({
            participants: [
                {userId: 1, arrivalDate: '2024-01-01', departureDate: '2024-01-02'},
                {userId: 2, arrivalDate: '2024-01-01', departureDate: '2024-01-02'},
                {userId: 3, arrivalDate: '2024-01-01', departureDate: '2024-01-01'},
            ],
        });

        const recommendations = generateAutoRecommendations(context);

        expect(recommendations).toHaveLength(3);
        const assignmentsBySlot: Record<string, RecommendationInput | undefined> = {};
        recommendations.forEach((rec) => assignmentsBySlot[rec.slotId] = rec);

        expect(assignmentsBySlot['slot-1']?.userId).toBe(1);
        expect(assignmentsBySlot['slot-2']?.userId).toBe(2);
        expect(assignmentsBySlot['slot-3']?.userId).toBe(3);
    });

    it('skips assignments that fall outside attendance or overlap existing commitments', () => {
        const existing: Record<string, AssignmentCandidate[]> = {
            'user:1': [{id: 'existing', day: '2024-01-02', startTime: '08:00', endTime: '09:00', pos: 0}],
        };

        const context = buildContext({
            participants: [
                {userId: 1, arrivalDate: '2024-01-02', departureDate: '2024-01-02'},
            ],
            slots: [
                {id: 'slot-early', day: '2024-01-01', startTime: '09:00', endTime: '10:00', pos: 1, maxAssignees: 1} as any,
                {id: 'slot-overlap', day: '2024-01-02', startTime: '08:30', endTime: '09:30', pos: 2, maxAssignees: 1} as any,
            ],
            existingAssignments: existing,
        });

        const recommendations = generateAutoRecommendations(context);
        expect(recommendations).toHaveLength(0);
    });

    it('skips arrival-evening slots when the plan disables them', () => {
        const context = buildContext({
            plan: {...basePlan, allowArrivalDayEvening: false},
            participants: [
                {userId: 1, arrivalDate: '2024-01-01', departureDate: '2024-01-02'},
            ],
            slots: [
                {id: 'evening', day: '2024-01-01', startTime: '18:00', endTime: '19:00', pos: 1, maxAssignees: 1} as any,
                {id: 'next-day', day: '2024-01-02', startTime: '08:00', endTime: '09:00', pos: 2, maxAssignees: 1} as any,
            ],
        });

        const recommendations = generateAutoRecommendations(context);

        expect(recommendations).toHaveLength(1);
        expect(recommendations[0]).toMatchObject({slotId: 'next-day', userId: 1});
    });
});
