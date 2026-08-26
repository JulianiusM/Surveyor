import {describe, expect, it} from 'vitest';
import {
    buildProportionalStayRequirements,
    calculateParticipantRequirement,
    calculateRequirementCapacitySummary,
    summarizeParticipantRequirements,
} from '../../src/modules/activity/requirements';
import {
    createParticipantAttendance,
    createRequirementCapacitySlots,
    createRequirementPlan,
    createRequirementSlotRoles,
    createStayRequirement,
} from '../factories/activityRequirementFactory';

describe('activity plan stay-duration requirements', () => {
    it('builds one rounded proportional default for every stay length', () => {
        // Protects baseline calculation for multi-week plans without requiring one-off UI defaults.
        const requirements = buildProportionalStayRequirements(21, 7, 'CEIL');

        expect(requirements).toHaveLength(21);
        expect(requirements[0]).toEqual({stayDays: 1, requiredShifts: 1});
        expect(requirements[20]).toEqual({stayDays: 21, requiredShifts: 7});
    });

    it('uses the saved stay-duration value instead of the rounded proportional share', () => {
        // Protects the admin-edited value as the authoritative general requirement.
        const result = calculateParticipantRequirement(
            createRequirementPlan(),
            createParticipantAttendance(),
            [],
            [],
            [createStayRequirement(3, 4)],
        );

        expect(result.requiredShifts).toBe(4);
        expect(result.breakdown.proportionalRequirement).toBe(1.5);
        expect(result.breakdown.stayDurationRequirement).toBe(4);
    });

    it('retains proportional behavior for plans without a saved duration schedule', () => {
        // Protects existing plans until an administrator saves the new duration values.
        const result = calculateParticipantRequirement(
            createRequirementPlan(),
            createParticipantAttendance(),
            [],
            [],
        );

        expect(result.requiredShifts).toBe(2);
    });

    it('compares role-limited slot capacity with attendance-aware participant demand', () => {
        // Protects the coverage headline from counting unusable role positions or full-stay demand for short stays.
        const plan = createRequirementPlan();
        const summary = calculateRequirementCapacitySummary(
            plan,
            [
                createParticipantAttendance(),
                createParticipantAttendance({
                    profileId: '00000000-0000-4000-8000-000000000002',
                    departureDate: '2027-06-10',
                }),
            ],
            [],
            [],
            [createStayRequirement(3, 4), createStayRequirement(10, 5)],
            createRequirementCapacitySlots(),
            createRequirementSlotRoles(),
        );

        expect(summary).toEqual({availableSlots: 5, requiredSlots: 9, difference: -4});
    });

    it('includes the clamped stay length in each participant summary', () => {
        // Protects the attendance column's explicit day-count display.
        const [summary] = summarizeParticipantRequirements(
            createRequirementPlan(),
            [createParticipantAttendance({
                arrivalDate: '2027-05-30',
                departureDate: '2027-06-03',
                roleIds: [7],
            })],
            [],
            [],
            {},
            [createStayRequirement(3, 4)],
        );

        expect(summary.attendanceDays).toBe(3);
        expect(summary.roleIds).toEqual([7]);
    });
});
