import {normalizeRecommendationInput} from "../../../src/modules/database/services/ActivityRecommendationService";

describe("normalizeRecommendationInput", () => {
    test("requires a slot id", () => {
        expect(() => normalizeRecommendationInput({slotId: ""} as any)).toThrow("slotId");
    });

    test("enforces single participant", () => {
        expect(() => normalizeRecommendationInput({slotId: "slot", userId: 1, guestId: 2})).toThrow("both user and guest");
        expect(() => normalizeRecommendationInput({slotId: "slot"} as any)).toThrow("userId or guestId");
    });

    test("defaults to pending status", () => {
        const normalized = normalizeRecommendationInput({slotId: "slot", userId: 5});
        expect(normalized).toEqual({slotId: "slot", userId: 5, guestId: null, status: "PENDING"});
    });
});
