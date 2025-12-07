import {
    calculateParticipantRequirement,
} from "../../../src/modules/activity/requirements";
import {ActivityPlanRequirement} from "../../../src/modules/database/entities/activity/ActivityPlanRequirement";
import {ActivityPlanRequirementOverride} from "../../../src/modules/database/entities/activity/ActivityPlanRequirementOverride";

const basePlan = {
    assignmentMode: "REQUIRED" as const,
    generalRequiredShifts: 4,
    roundingMode: "CEIL" as const,
    startDate: "2025-06-01",
    endDate: "2025-06-04",
};

function makeOverride(data: Partial<ActivityPlanRequirementOverride>): ActivityPlanRequirementOverride {
    return {
        id: 1,
        requiredShifts: 0,
        createdAt: null,
        updatedAt: null,
        planId: "plan-1",
        ...data,
    } as ActivityPlanRequirementOverride;
}

function makeRequirement(data: Partial<ActivityPlanRequirement>): ActivityPlanRequirement {
    return {
        id: 1,
        roleId: 99,
        planId: "plan-1",
        requiredShifts: 2,
        plan: undefined as never,
        role: undefined as never,
        ...data,
    } as ActivityPlanRequirement;
}

describe("activity requirements - new priority logic", () => {
    test("uses override over role requirement", () => {
        const participant = {userId: 1, arrivalDate: "2025-06-01", departureDate: "2025-06-04", roleIds: [5]};
        const roleRequirements = [makeRequirement({roleId: 5, requiredShifts: 10})];
        const overrides = [makeOverride({userId: 1, requiredShifts: 2})];
        
        const result = calculateParticipantRequirement(basePlan, participant, roleRequirements, overrides);
        expect(result.requiredShifts).toBe(2);
        expect(result.source).toBe("override");
    });

    test("uses role requirement over general requirement", () => {
        const participant = {userId: 1, arrivalDate: "2025-06-01", departureDate: "2025-06-04", roleIds: [5]};
        const roleRequirements = [makeRequirement({roleId: 5, requiredShifts: 3})];
        
        const result = calculateParticipantRequirement(basePlan, participant, roleRequirements, []);
        expect(result.requiredShifts).toBe(3);
        expect(result.source).toBe("role");
    });

    test("uses role requirement even when lower than general", () => {
        const participant = {userId: 1, arrivalDate: "2025-06-01", departureDate: "2025-06-04", roleIds: [5]};
        const roleRequirements = [makeRequirement({roleId: 5, requiredShifts: 2})];
        
        const result = calculateParticipantRequirement(basePlan, participant, roleRequirements, []);
        expect(result.requiredShifts).toBe(2); // Uses role requirement (2) not general (4)
        expect(result.source).toBe("role");
    });

    test("uses minimum of multiple role requirements", () => {
        const participant = {userId: 1, arrivalDate: "2025-06-01", departureDate: "2025-06-04", roleIds: [5, 6]};
        const roleRequirements = [
            makeRequirement({roleId: 5, requiredShifts: 3}),
            makeRequirement({roleId: 6, requiredShifts: 5}),
        ];
        
        const result = calculateParticipantRequirement(basePlan, participant, roleRequirements, []);
        expect(result.requiredShifts).toBe(3); // Minimum of [3, 5]
        expect(result.source).toBe("role");
    });

    test("uses general requirement when participant has no roles", () => {
        const participant = {userId: 1, arrivalDate: "2025-06-01", departureDate: "2025-06-04", roleIds: []};
        
        const result = calculateParticipantRequirement(basePlan, participant, [], []);
        expect(result.requiredShifts).toBe(4);
        expect(result.source).toBe("general");
    });

    test("uses general requirement when participant roles don't match any requirements", () => {
        const participant = {userId: 1, arrivalDate: "2025-06-01", departureDate: "2025-06-04", roleIds: [7]};
        const roleRequirements = [makeRequirement({roleId: 5, requiredShifts: 3})];
        
        const result = calculateParticipantRequirement(basePlan, participant, roleRequirements, []);
        expect(result.requiredShifts).toBe(4);
        expect(result.source).toBe("general");
    });

    test("returns zero when in FREE mode and no override", () => {
        const participant = {userId: 1, arrivalDate: "2025-06-01", departureDate: "2025-06-04", roleIds: [5]};
        const roleRequirements = [makeRequirement({roleId: 5, requiredShifts: 3})];
        
        const result = calculateParticipantRequirement(
            {...basePlan, assignmentMode: "FREE"},
            participant,
            roleRequirements,
            []
        );
        expect(result.requiredShifts).toBe(0);
        expect(result.source).toBe("none");
    });

    test("applies rounding to minimum role requirement", () => {
        const participant = {userId: 1, arrivalDate: "2025-06-01", departureDate: "2025-06-02", roleIds: [5, 6]};
        const roleRequirements = [
            makeRequirement({roleId: 5, requiredShifts: 7}), // 7 * 0.5 = 3.5 -> ceil = 4
            makeRequirement({roleId: 6, requiredShifts: 5}), // 5 * 0.5 = 2.5 -> ceil = 3
        ];
        
        const result = calculateParticipantRequirement(basePlan, participant, roleRequirements, []);
        expect(result.requiredShifts).toBe(3); // Minimum of [4, 3] after rounding
        expect(result.source).toBe("role");
    });
});
