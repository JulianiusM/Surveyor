import {describe, expect, it} from 'vitest';
import {
    buildProportionalStayRequirements,
    calculateParticipantRequirement,
    calculateRequirementCapacitySummary,
    summarizeParticipantRequirements,
} from '../../src/modules/activity/requirements';
import {
    createParticipantAttendance,
    createParticipantRequirementOverride,
    createRequirementCapacitySlots,
    createRequirementPlan,
    createRoleRequirement,
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

    it('honors a zero-shift role override instead of falling back to the stay requirement', () => {
        // Protects an explicit role exemption as a real requirement value rather than a missing rule.
        const result = calculateParticipantRequirement(
            createRequirementPlan(),
            createParticipantAttendance({roleIds: [7]}),
            [createRoleRequirement(7, 0)],
            [],
            [createStayRequirement(3, 4)],
        );

        expect(result).toMatchObject({requiredShifts: 0, source: 'role'});
    });

    it('compares whole slot capacity with attendance, role-scoped, and participant-specific demand', () => {
        // Protects the total from omitting stay-duration, single-role, role-scoped, or participant override requirements.
        const plan = createRequirementPlan();
        const overriddenProfileId = '00000000-0000-4000-8000-000000000003';
        const roleOverrideProfileId = '00000000-0000-4000-8000-000000000004';
        const summary = calculateRequirementCapacitySummary(
            plan,
            [
                createParticipantAttendance(),
                createParticipantAttendance({
                    profileId: '00000000-0000-4000-8000-000000000002',
                    departureDate: '2027-06-05',
                    roleIds: [7],
                }),
                createParticipantAttendance({
                    profileId: overriddenProfileId,
                    departureDate: '2027-06-10',
                }),
                createParticipantAttendance({
                    profileId: roleOverrideProfileId,
                    departureDate: '2027-06-10',
                    roleIds: [8],
                }),
            ],
            [createRoleRequirement(7, 6)],
            [
                createParticipantRequirementOverride(overriddenProfileId, 2),
                createParticipantRequirementOverride(roleOverrideProfileId, 1, 8),
            ],
            [
                createStayRequirement(3, 4),
                createStayRequirement(5, 7),
                createStayRequirement(10, 5),
            ],
            createRequirementCapacitySlots(),
        );

        expect(summary).toEqual({availableSlots: 8, requiredSlots: 10, difference: -2});
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
