import {
    applyRounding,
    calculateParticipantRequirement,
    calculateRequirementsForParticipants,
    clampAttendanceWindow,
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

describe("activity requirements utilities", () => {
    test("clamps attendance window within plan", () => {
        expect(clampAttendanceWindow("2025-01-01", "2025-01-05", "2025-01-02", "2025-01-06")).toEqual({
            start: "2025-01-02",
            end: "2025-01-05",
            days: 4,
        });
        expect(clampAttendanceWindow("2025-01-01", "2025-01-05", "2024-12-30", "2025-01-03")?.days).toBe(3);
        expect(clampAttendanceWindow("2025-01-01", "2025-01-05", "2025-01-07", "2025-01-09")).toBeNull();
    });

    test("applies rounding modes consistently", () => {
        expect(applyRounding(1.2, "CEIL")).toBe(2);
        expect(applyRounding(1.6, "ROUND")).toBe(2);
        expect(applyRounding(1.6, "FLOOR")).toBe(1);
    });

    test("calculates proportional requirement with rounding", () => {
        const participant = {
            userId: 10,
            arrivalDate: "2025-06-01",
            departureDate: "2025-06-02",
            roleIds: [],
        };

        const result = calculateParticipantRequirement(basePlan, participant, [], []);
        expect(result.requiredShifts).toBe(2); // 4 required over 4 days -> 2 days stay => ceil(2)
        expect(result.source).toBe("general");
    });

    test("uses role requirement when higher than general", () => {
        const participant = {userId: 11, arrivalDate: "2025-06-01", departureDate: "2025-06-04", roleIds: [5]};
        const roleRequirements = [makeRequirement({roleId: 5, requiredShifts: 5})];
        const result = calculateParticipantRequirement(basePlan, participant, roleRequirements, []);
        expect(result.requiredShifts).toBe(5);
        expect(result.source).toBe("role");
    });

    test("applies proportional role requirement", () => {
        const participant = {guestId: 15, arrivalDate: "2025-06-01", departureDate: "2025-06-02", roleIds: [3]};
        const roleRequirements = [makeRequirement({roleId: 3, requiredShifts: 6})];
        const result = calculateParticipantRequirement(basePlan, participant, roleRequirements, []);
        expect(result.requiredShifts).toBe(3); // half the stay, ceil(3)
    });

    test("honors most specific override even in free mode", () => {
        const participant = {userId: 23, arrivalDate: "2025-06-01", departureDate: "2025-06-04", roleIds: [2]};
        const overrides = [
            makeOverride({requiredShifts: 2, userId: 23, roleId: null}),
            makeOverride({requiredShifts: 1, userId: 23, roleId: 2}),
        ];

        const result = calculateParticipantRequirement(
            {...basePlan, assignmentMode: "FREE", generalRequiredShifts: null},
            participant,
            [],
            overrides
        );

        expect(result.requiredShifts).toBe(1);
        expect(result.source).toBe("override");
    });

    test("builds a keyed requirement map for participants", () => {
        const participants = [
            {userId: 1, arrivalDate: "2025-06-01", departureDate: "2025-06-04", roleIds: []},
            {guestId: 9, arrivalDate: "2025-06-02", departureDate: "2025-06-04", roleIds: [10]},
        ];
        const overrides = [makeOverride({requiredShifts: 5, guestId: 9, roleId: null})];
        const requirements = calculateRequirementsForParticipants(basePlan, participants, [], overrides);

        expect(requirements["user:1"].requiredShifts).toBe(4);
        expect(requirements["guest:9"].requiredShifts).toBe(5);
        expect(requirements["guest:9"].source).toBe("override");
    });

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
