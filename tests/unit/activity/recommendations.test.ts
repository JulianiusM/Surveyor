import {normalizeRecommendationInput} from "../../../src/modules/database/services/ActivityRecommendationService";
import {buildRecommendationWarnings} from "../../../src/modules/activity/recommendations";
import {ActivitySlot} from "../../../src/modules/database/entities/activity/ActivitySlot";

describe("normalizeRecommendationInput", () => {
    test("requires a slot id", () => {
        expect(() => normalizeRecommendationInput({slotId: ""} as any)).toThrow("slotId");
    });

    test("enforces single participant", () => {
        expect(() => normalizeRecommendationInput({slotId: "slot", userId: 1, guestId: 2})).toThrow("both user and guest");
        expect(() => normalizeRecommendationInput({slotId: "slot"} as any)).toThrow("userId or guestId");
    });

    test("defaults to pending status", () => {
        const normalized = normalizeRecommendationInput({id: "abc", slotId: "slot", userId: 5});
        expect(normalized).toEqual({id: "abc", slotId: "slot", userId: 5, guestId: null, status: "PENDING"});
    });
});

describe("buildRecommendationWarnings", () => {
    const slots: ActivitySlot[] = [
        {id: "a", day: "2024-05-01", startTime: "08:00", endTime: "09:00", pos: 1} as ActivitySlot,
        {id: "b", day: "2024-05-01", startTime: "08:30", endTime: "10:00", pos: 2} as ActivitySlot,
        {id: "c", day: "2024-05-02", startTime: "07:00", endTime: "08:00", pos: 1} as ActivitySlot,
    ];

    test("returns no warnings when assignments do not conflict", () => {
        const warnings = buildRecommendationWarnings({
            slots,
            recommendations: [
                {slotId: "a", userId: 1},
                {slotId: "c", userId: 1},
            ],
        });

        expect(warnings.every((w) => w.warnings.length === 0)).toBe(true);
    });

    test("flags overlap when recommendations share a timebox", () => {
        const warnings = buildRecommendationWarnings({
            slots,
            recommendations: [
                {slotId: "a", userId: 1},
                {slotId: "b", userId: 1},
            ],
        });

        expect(warnings[1].warnings).toEqual([
            {type: "overlap", conflicts: ["a"]},
        ]);
    });

    test("flags over-capacity assignments when the slot is full", () => {
        const warnings = buildRecommendationWarnings({
            slots,
            recommendations: [
                {slotId: "a", userId: 1},
                {slotId: "a", userId: 2},
            ],
            slotCapacities: {a: 1},
        });

        expect(warnings[1].warnings).toEqual([{type: "over_capacity"}]);
    });

    test("honors arrival-day evening restriction when provided", () => {
        const warnings = buildRecommendationWarnings({
            slots,
            recommendations: [
                {slotId: "a", userId: 1},
            ],
            participantAttendance: {
                "user:1": {userId: 1, arrivalDate: "2024-05-01", departureDate: "2024-05-03"},
            },
            attendancePolicy: {allowArrivalDayEvening: false},
        });

        expect(warnings[0].warnings).toEqual([
            {type: "arrival_day"},
            {type: "arrival_time_restricted"},
        ]);
    });
});
