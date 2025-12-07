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
        
        // User 3 has limited availability (only day 1), so should be prioritized and assigned first
        // Users 1 and 2 have broader availability (both days)
        const user3Assignments = recommendations.filter(r => r.userId === 3);
        const user1Assignments = recommendations.filter(r => r.userId === 1);
        const user2Assignments = recommendations.filter(r => r.userId === 2);
        
        // User 3 should get at least one assignment on their only available day
        expect(user3Assignments.length).toBeGreaterThan(0);
        
        // All users should get some assignments to meet requirements fairly
        expect(user1Assignments.length).toBeGreaterThan(0);
        expect(user2Assignments.length).toBeGreaterThan(0);
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

    // F3: Only affect participants with deficit
    it('only assigns to participants with deficit > 0', () => {
        const existing: Record<string, AssignmentCandidate[]> = {
            'user:1': [
                {id: 'slot-1', day: '2024-01-01', startTime: '09:00', endTime: '10:00', pos: 1},
                {id: 'slot-2', day: '2024-01-01', startTime: '10:00', endTime: '11:00', pos: 2},
            ],
        };

        const context = buildContext({
            participants: [
                {userId: 1, arrivalDate: '2024-01-01', departureDate: '2024-01-02'}, // requires 2, has 2
                {userId: 2, arrivalDate: '2024-01-01', departureDate: '2024-01-02'}, // requires 2, has 0
            ],
            existingAssignments: existing,
        });

        const recommendations = generateAutoRecommendations(context);

        // User 1 should get no recommendations (deficit = 0)
        // User 2 should get recommendations (deficit = 2)
        expect(recommendations.every(r => r.userId === 2)).toBe(true);
    });

    // F4: Capacity constraint (normal mode)
    it('respects slot capacity in normal mode', () => {
        const context = buildContext({
            plan: {...basePlan, allowOverfillAfterFull: false},
            participants: [
                {userId: 1, arrivalDate: '2024-01-01', departureDate: '2024-01-02'},
                {userId: 2, arrivalDate: '2024-01-01', departureDate: '2024-01-02'},
                {userId: 3, arrivalDate: '2024-01-01', departureDate: '2024-01-02'},
            ],
            slots: [
                {id: 'slot-1', day: '2024-01-01', startTime: '09:00', endTime: '10:00', pos: 1, maxAssignees: 1} as any,
            ],
        });

        const recommendations = generateAutoRecommendations(context);

        // Should only assign 1 participant to slot with capacity 1
        const slot1Assignments = recommendations.filter(r => r.slotId === 'slot-1');
        expect(slot1Assignments).toHaveLength(1);
    });

    // F5: Two-phase capacity handling (overfill mode)
    it('allows overcapacity in overfill mode after free capacity is filled', () => {
        const context = buildContext({
            plan: {...basePlan, allowOverfillAfterFull: true},
            participants: [
                {userId: 1, arrivalDate: '2024-01-01', departureDate: '2024-01-02'},
                {userId: 2, arrivalDate: '2024-01-01', departureDate: '2024-01-02'},
                {userId: 3, arrivalDate: '2024-01-01', departureDate: '2024-01-02'},
            ],
            slots: [
                {id: 'slot-1', day: '2024-01-01', startTime: '09:00', endTime: '10:00', pos: 1, maxAssignees: 1, assignedCount: 0} as any,
                {id: 'slot-2', day: '2024-01-01', startTime: '10:00', endTime: '11:00', pos: 2, maxAssignees: 1, assignedCount: 0} as any,
            ],
        });

        const recommendations = generateAutoRecommendations(context);

        // Phase 1: Fill 2 free slots (capacity 1 each)
        // Phase 2: Continue assigning to meet deficit (3 participants need 2 shifts each = 6 total)
        expect(recommendations.length).toBeGreaterThan(2);
        
        // Each participant should get closer to their requirement
        const user1Assignments = recommendations.filter(r => r.userId === 1).length;
        const user2Assignments = recommendations.filter(r => r.userId === 2).length;
        const user3Assignments = recommendations.filter(r => r.userId === 3).length;
        
        expect(user1Assignments).toBeGreaterThan(0);
        expect(user2Assignments).toBeGreaterThan(0);
        expect(user3Assignments).toBeGreaterThan(0);
    });

    // F9: Fair distribution - lowest ratio first
    it('prioritizes participants with lowest assigned/required ratio', () => {
        const existing: Record<string, AssignmentCandidate[]> = {
            'user:1': [{id: 'existing-1', day: '2024-01-01', startTime: '08:00', endTime: '08:30', pos: 0}],
        };

        const context = buildContext({
            plan: {...basePlan, generalRequiredShifts: 4},
            participants: [
                {userId: 1, arrivalDate: '2024-01-01', departureDate: '2024-01-02'}, // 1/4 = 0.25 ratio
                {userId: 2, arrivalDate: '2024-01-01', departureDate: '2024-01-02'}, // 0/4 = 0 ratio
            ],
            slots: [
                {id: 'slot-1', day: '2024-01-01', startTime: '09:00', endTime: '10:00', pos: 1, maxAssignees: 1} as any,
            ],
            existingAssignments: existing,
        });

        const recommendations = generateAutoRecommendations(context);

        // User 2 has lower ratio (0 < 0.25), so should be assigned first
        expect(recommendations[0]?.userId).toBe(2);
    });

    // F9: Limited availability prioritization
    it('prioritizes participants with limited availability first', () => {
        const context = buildContext({
            plan: {...basePlan, generalRequiredShifts: 2},
            participants: [
                {userId: 1, arrivalDate: '2024-01-01', departureDate: '2024-01-02'}, // Can attend both days
                {userId: 2, arrivalDate: '2024-01-01', departureDate: '2024-01-01'}, // Only day 1 - limited
            ],
            slots: [
                {id: 'slot-1', day: '2024-01-01', startTime: '09:00', endTime: '10:00', pos: 1, maxAssignees: 1} as any,
                {id: 'slot-2', day: '2024-01-02', startTime: '09:00', endTime: '10:00', pos: 1, maxAssignees: 1} as any,
            ],
        });

        const recommendations = generateAutoRecommendations(context);

        // User 2 has more limited availability, so should be assigned first to slot-1
        const firstAssignment = recommendations[0];
        expect(firstAssignment?.userId).toBe(2);
        expect(firstAssignment?.slotId).toBe('slot-1');
    });

    // F9: Fair distribution - largest deficit on tie
    it('uses largest deficit as tiebreaker when ratios are equal', () => {
        const existing: Record<string, AssignmentCandidate[]> = {
            'user:1': [{id: 'existing-1', day: '2024-01-01', startTime: '08:00', endTime: '08:30', pos: 0}],
            'user:2': [{id: 'existing-2', day: '2024-01-01', startTime: '08:00', endTime: '08:30', pos: 0}],
        };

        const context = buildContext({
            participants: [
                {userId: 1, arrivalDate: '2024-01-01', departureDate: '2024-01-02'}, // requires 2, has 1, deficit 1, ratio 0.5
                {userId: 2, arrivalDate: '2024-01-01', departureDate: '2024-01-02'}, // requires 2, has 1, deficit 1, ratio 0.5
            ],
            roleRequirements: [],
            overrides: [
                {id: 1, planId: 'plan-1', userId: 1, guestId: null, roleId: null, requiredShifts: 4, createdAt: null, updatedAt: null} as any, // deficit 3
            ],
            slots: [
                {id: 'slot-1', day: '2024-01-01', startTime: '09:00', endTime: '10:00', pos: 1, maxAssignees: 1} as any,
            ],
            existingAssignments: existing,
        });

        const recommendations = generateAutoRecommendations(context);

        // User 1 has larger deficit (3 > 1), so should be assigned first
        expect(recommendations[0]?.userId).toBe(1);
    });
});
