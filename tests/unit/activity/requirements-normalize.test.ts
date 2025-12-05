import {normalizeOverrideInput, normalizeRoleRequirementInput} from "../../../src/modules/activity/requirements";

describe("normalizeOverrideInput", () => {
    it("normalizes nullables and preserves ids", () => {
        const result = normalizeOverrideInput({
            id: 2,
            roleId: undefined,
            userId: 5,
            requiredShifts: 3,
        });

        expect(result).toEqual({
            id: 2,
            roleId: null,
            userId: 5,
            guestId: null,
            requiredShifts: 3,
        });
    });

    it("throws when participant identifiers are missing", () => {
        expect(() => normalizeOverrideInput({requiredShifts: 1} as any)).toThrow(
            "Override requires a userId or guestId"
        );
    });

    it("throws when required shifts is negative", () => {
        expect(() =>
            normalizeOverrideInput({userId: 1, requiredShifts: -2})
        ).toThrow("Override required shifts must be non-negative");
    });

    it("throws when required shifts is missing", () => {
        expect(() => normalizeOverrideInput({userId: 1} as any)).toThrow(
            "Override required shifts must be defined"
        );
    });

    it("throws when required shifts is not an integer", () => {
        expect(() => normalizeOverrideInput({userId: 1, requiredShifts: 1.5} as any)).toThrow(
            "Override required shifts must be an integer"
        );
    });

    it("throws when required shifts is infinite", () => {
        expect(() => normalizeOverrideInput({userId: 1, requiredShifts: Infinity} as any)).toThrow(
            "Override required shifts must be finite"
        );
    });
});

describe("normalizeRoleRequirementInput", () => {
    it("normalizes valid role requirement", () => {
        expect(normalizeRoleRequirementInput({roleId: 2, requiredShifts: 3})).toEqual({
            roleId: 2,
            requiredShifts: 3,
        });
    });

    it("throws when role id is invalid", () => {
        expect(() => normalizeRoleRequirementInput({roleId: 0, requiredShifts: 1} as any)).toThrow(
            "Role id must be a positive integer"
        );
    });

    it("throws when required shifts is negative", () => {
        expect(() => normalizeRoleRequirementInput({roleId: 1, requiredShifts: -1} as any)).toThrow(
            "Role required shifts must be non-negative"
        );
    });
});
