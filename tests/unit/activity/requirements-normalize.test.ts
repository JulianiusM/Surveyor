import {normalizeOverrideInput} from "../../../src/modules/activity/requirements";

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
});
