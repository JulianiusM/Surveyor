import {describe, expect, it} from 'vitest';
import {
    buildProportionalStayRequirements,
    calculateBaselineRequirementForPlan,
    calculateParticipantRequirement,
    calculateHypotheticalRoleCoverage,
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

    it('does not invent a rounded runtime value when the saved duration is missing', () => {
        // Protects exact requirements from silently falling back to a second rounding calculation.
        const result = calculateParticipantRequirement(
            createRequirementPlan(),
            createParticipantAttendance(),
            [],
            [],
        );

        expect(result).toMatchObject({requiredShifts: 0, source: 'unconfigured'});
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

        expect(summary).toMatchObject({
            availableSlots: 8,
            requiredSlots: 13,
            difference: -5,
            configurationComplete: false,
        });
    });

    it('uses a role requirement verbatim regardless of attendance duration', () => {
        // Protects manually configured role demand from runtime proportional scaling.
        const result = calculateParticipantRequirement(
            createRequirementPlan(),
            createParticipantAttendance({roleIds: [7]}),
            [createRoleRequirement(7, 6)],
            [],
            [createStayRequirement(3, 2)],
        );

        expect(result).toMatchObject({requiredShifts: 6, source: 'role'});
    });

    it('chooses the minimum matching role-scoped override before the participant-wide override', () => {
        // Protects exact override precedence when one participant holds several configured roles.
        const profileId = '00000000-0000-4000-8000-000000000001';
        const result = calculateParticipantRequirement(
            createRequirementPlan(),
            createParticipantAttendance({profileId, roleIds: [7, 8]}),
            [createRoleRequirement(7, 6), createRoleRequirement(8, 5)],
            [
                createParticipantRequirementOverride(profileId, 4),
                createParticipantRequirementOverride(profileId, 3, 7),
                createParticipantRequirementOverride(profileId, 1, 8),
            ],
            [createStayRequirement(3, 2)],
        );

        expect(result).toMatchObject({requiredShifts: 1, source: 'override'});
    });

    it('globally matches open roles instead of losing coverage to a greedy first choice', () => {
        // Protects the hypothetical worst case where the flexible participant must cover the constrained role.
        const plan = createRequirementPlan({startDate: '2027-06-01', endDate: '2027-06-02'});
        const flexibleId = '00000000-0000-4000-8000-000000000001';
        const constrainedId = '00000000-0000-4000-8000-000000000002';
        const result = calculateHypotheticalRoleCoverage({
            plan,
            participants: [
                createParticipantAttendance({profileId: flexibleId, departureDate: '2027-06-02'}),
                createParticipantAttendance({profileId: constrainedId, departureDate: '2027-06-01'}),
            ],
            roleRequirements: [createRoleRequirement(7, 0), createRoleRequirement(8, 0)],
            overrides: [],
            stayRequirements: [createStayRequirement(1, 4), createStayRequirement(2, 5)],
            slots: [
                {id: 'day-one', day: '2027-06-01', maxAssignees: 1, roles: [{roleId: 7, maxQty: 1}]},
                {id: 'day-two', day: '2027-06-02', maxAssignees: 1, roles: [{roleId: 8, maxQty: 1}]},
            ],
        });

        expect(result).toMatchObject({
            openRoleCount: 2,
            filledRoleCount: 2,
            unfilledRoleCount: 0,
            removedRequiredShifts: 9,
        });
        expect(result.matches).toEqual(expect.arrayContaining([
            expect.objectContaining({participantKey: `profile:${constrainedId}`, slotId: 'day-one'}),
            expect.objectContaining({participantKey: `profile:${flexibleId}`, slotId: 'day-two'}),
        ]));
        expect(new Set(result.matches.map((match) => match.participantKey)).size).toBe(result.matches.length);
    });

    it('removes the maximum exact demand from capacity for a hypothetically filled open role', () => {
        // Protects open role capacity from being omitted from the overall requirement total.
        const plan = createRequirementPlan({startDate: '2027-06-01', endDate: '2027-06-02'});
        const longStayId = '00000000-0000-4000-8000-000000000001';
        const shortStayId = '00000000-0000-4000-8000-000000000002';
        const summary = calculateRequirementCapacitySummary(
            plan,
            [
                createParticipantAttendance({profileId: longStayId, departureDate: '2027-06-02'}),
                createParticipantAttendance({profileId: shortStayId, departureDate: '2027-06-01'}),
            ],
            [createRoleRequirement(7, 0)],
            [],
            [createStayRequirement(1, 4), createStayRequirement(2, 5)],
            [{
                id: 'role-slot',
                day: '2027-06-01',
                maxAssignees: 2,
                roles: [{roleId: 7, maxQty: 1}],
            }],
        );

        expect(summary).toMatchObject({
            availableSlots: 2,
            requiredSlots: 4,
            difference: -2,
            configurationComplete: true,
            hypotheticalRoleCoverage: {
                openRoleCount: 1,
                filledRoleCount: 1,
                removedRequiredShifts: 5,
                matches: [expect.objectContaining({participantKey: `profile:${longStayId}`})],
            },
        });
    });

    it('removes a matched configured role from the general baseline pool', () => {
        // Protects baseline generation from counting one participant as both a hypothetical role holder and general labor.
        const plan = createRequirementPlan({startDate: '2027-06-01', endDate: '2027-06-02'});
        const result = calculateBaselineRequirementForPlan({
            plan,
            slots: [{
                id: 'four-person-slot',
                day: '2027-06-01',
                maxAssignees: 4,
                roles: [{roleId: 7, maxQty: 1}],
            }],
            participants: [
                createParticipantAttendance({profileId: '00000000-0000-4000-8000-000000000001', departureDate: '2027-06-02'}),
                createParticipantAttendance({profileId: '00000000-0000-4000-8000-000000000002', departureDate: '2027-06-02'}),
            ],
            roleRequirements: [createRoleRequirement(7, 1)],
            overrides: [],
        });

        expect(result).toMatchObject({
            totalRequiredShifts: 4,
            totalFixedShifts: 1,
            remainingShifts: 3,
            baseline: 3,
            sumRequiredShifts: 4,
            hypotheticalRoleCoverage: {filledRoleCount: 1},
        });
        expect(result.participants.map((participant) => participant.group).sort()).toEqual(['baseline', 'role-fixed']);
    });

    it('does not use participants with personal overrides as hypothetical role fillers', () => {
        // Protects verbatim personal overrides from being replaced by a hypothetical role requirement.
        const overriddenProfileId = '00000000-0000-4000-8000-000000000001';
        const generalProfileId = '00000000-0000-4000-8000-000000000002';
        const result = calculateBaselineRequirementForPlan({
            plan: createRequirementPlan({startDate: '2027-06-01', endDate: '2027-06-02'}),
            slots: [{
                id: 'role-slot',
                day: '2027-06-01',
                maxAssignees: 4,
                roles: [{roleId: 7, maxQty: 1}],
            }],
            participants: [
                createParticipantAttendance({profileId: overriddenProfileId}),
                createParticipantAttendance({profileId: generalProfileId}),
            ],
            roleRequirements: [createRoleRequirement(7, 1)],
            overrides: [createParticipantRequirementOverride(overriddenProfileId, 4)],
        });

        expect(result).toMatchObject({
            baseline: 0,
            projectedRequiredShifts: 5,
            hypotheticalRoleCoverage: {
                matches: [expect.objectContaining({participantKey: `profile:${generalProfileId}`})],
            },
        });
        expect(result.participants.find((participant) => participant.participantKey === `profile:${overriddenProfileId}`))
            .toMatchObject({group: 'explicit', requiredShifts: 4});
    });

    it('finds a nonzero integer baseline by evaluating the generated stay table', () => {
        // Protects baseline calculation from collapsing to zero when attendance-based demand can fill capacity.
        const result = calculateBaselineRequirementForPlan({
            plan: createRequirementPlan({endDate: '2027-06-03'}),
            slots: [{id: 'shared', day: '2027-06-01', maxAssignees: 4}],
            participants: [
                createParticipantAttendance({profileId: '00000000-0000-4000-8000-000000000001'}),
                createParticipantAttendance({profileId: '00000000-0000-4000-8000-000000000002'}),
            ],
            roleRequirements: [],
            overrides: [],
        });

        expect(result).toMatchObject({
            baseline: 2,
            projectedRequiredShifts: 4,
            projectedDifference: 0,
            diagnostics: {exact: true, baselineInfluencesRequirements: true, stayBasedParticipantCount: 2},
        });
    });

    it('explains zero when fixed requirements already consume capacity', () => {
        // Protects a mathematically correct zero from being presented as an unexplained successful baseline.
        const fixedProfileId = '00000000-0000-4000-8000-000000000001';
        const result = calculateBaselineRequirementForPlan({
            plan: createRequirementPlan(),
            slots: [{id: 'fixed', day: '2027-06-01', maxAssignees: 2}],
            participants: [
                createParticipantAttendance({profileId: fixedProfileId}),
                createParticipantAttendance({profileId: '00000000-0000-4000-8000-000000000002'}),
            ],
            roleRequirements: [],
            overrides: [createParticipantRequirementOverride(fixedProfileId, 2)],
        });

        expect(result).toMatchObject({
            baseline: 0,
            projectedDifference: 0,
            diagnostics: {
                exact: true,
                baselineInfluencesRequirements: true,
                fixedRequiredShifts: 2,
                reason: 'fixed-requirements-fill-capacity',
            },
        });
    });

    it('reports when every participant is fixed by hypothetical open roles', () => {
        // Protects fixed-only plans from pretending that a positive stay baseline could change their total.
        const result = calculateBaselineRequirementForPlan({
            plan: createRequirementPlan(),
            slots: [{
                id: 'roles-only',
                day: '2027-06-01',
                maxAssignees: 3,
                roles: [{roleId: 7, maxQty: 2}],
            }],
            participants: [
                createParticipantAttendance({profileId: '00000000-0000-4000-8000-000000000001'}),
                createParticipantAttendance({profileId: '00000000-0000-4000-8000-000000000002'}),
            ],
            roleRequirements: [createRoleRequirement(7, 1)],
            overrides: [],
        });

        expect(result).toMatchObject({
            baseline: 0,
            projectedRequiredShifts: 2,
            projectedDifference: 1,
            diagnostics: {
                exact: false,
                baselineInfluencesRequirements: false,
                stayBasedParticipantCount: 0,
                reason: 'no-stay-based-participants',
            },
        });
    });

    it('chooses the lower baseline and reports an integer rounding gap on an equal tie', () => {
        // Protects discrete baseline selection when no rounded duration table can hit odd capacity exactly.
        const result = calculateBaselineRequirementForPlan({
            plan: createRequirementPlan({endDate: '2027-06-03'}),
            slots: [{id: 'odd-capacity', day: '2027-06-01', maxAssignees: 1}],
            participants: [
                createParticipantAttendance({profileId: '00000000-0000-4000-8000-000000000001'}),
                createParticipantAttendance({profileId: '00000000-0000-4000-8000-000000000002'}),
            ],
            roleRequirements: [],
            overrides: [],
        });

        expect(result).toMatchObject({
            baseline: 0,
            projectedRequiredShifts: 0,
            projectedDifference: 1,
            diagnostics: {exact: false, baselineInfluencesRequirements: true, reason: 'integer-rounding-gap'},
        });
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
