import {collectAssignmentWarnings, checkAttendanceForDay, findOverlapConflicts} from "../../../src/modules/activity/availability";
import {AssignmentCandidate} from "../../../src/modules/activity/availability";

const baseSlot = (id: string, day = "2024-01-01", start?: string | null, end?: string | null): AssignmentCandidate => ({
    id,
    day,
    startTime: start,
    endTime: end,
});

describe("checkAttendanceForDay", () => {
    test("flags days before arrival", () => {
        expect(checkAttendanceForDay("2024-01-01", "2024-01-02", "2024-01-04")).toEqual({allowed: false, boundary: "before"});
    });

    test("flags days after departure", () => {
        expect(checkAttendanceForDay("2024-01-05", "2024-01-02", "2024-01-04")).toEqual({allowed: false, boundary: "after"});
    });

    test("marks arrival and departure boundaries", () => {
        expect(checkAttendanceForDay("2024-01-02", "2024-01-02", "2024-01-04")).toEqual({allowed: true, boundary: "arrival"});
        expect(checkAttendanceForDay("2024-01-04", "2024-01-02", "2024-01-04")).toEqual({allowed: true, boundary: "departure"});
    });

    test("allows interior days", () => {
        expect(checkAttendanceForDay("2024-01-03", "2024-01-02", "2024-01-04")).toEqual({allowed: true});
    });
});

describe("findOverlapConflicts", () => {
    test("returns ids for overlapping slots", () => {
        const conflicts = findOverlapConflicts(baseSlot("candidate", "2024-01-01", "08:00", "09:00"), [
            baseSlot("a", "2024-01-01", "08:30", "09:30"),
            baseSlot("b", "2024-01-01", "09:00", "10:00"),
        ]);
        expect(conflicts).toEqual(["a"]);
    });

    test("ignores slots on different days or without timeboxes", () => {
        const conflicts = findOverlapConflicts(baseSlot("candidate", "2024-01-01", "08:00", "09:00"), [
            baseSlot("a", "2024-01-02", "08:30", "09:30"),
            baseSlot("b", "2024-01-01", undefined, undefined),
        ]);
        expect(conflicts).toEqual([]);
    });
});

describe("collectAssignmentWarnings", () => {
    test("aggregates attendance and overlap warnings", () => {
        const warnings = collectAssignmentWarnings(
            baseSlot("candidate", "2024-01-02", "08:00", "09:00"),
            {arrivalDate: "2024-01-02", departureDate: "2024-01-03"},
            [baseSlot("a", "2024-01-02", "08:30", "09:30"), baseSlot("b", "2024-01-02", "09:30", "10:30")]
        );

        expect(warnings).toEqual([
            {type: "arrival_day"},
            {type: "overlap", conflicts: ["a"]},
        ]);
    });

    test("flags outside attendance window", () => {
        const warnings = collectAssignmentWarnings(
            baseSlot("candidate", "2024-01-01", "08:00", "09:00"),
            {arrivalDate: "2024-01-02", departureDate: "2024-01-03"},
            []
        );

        expect(warnings).toEqual([{type: "outside_attendance"}]);
    });

    test("respects arrival and departure day time restrictions", () => {
        const arrivalWarnings = collectAssignmentWarnings(
            baseSlot("candidate", "2024-01-02", "18:00", "19:00"),
            {arrivalDate: "2024-01-02", departureDate: "2024-01-04"},
            [],
            {allowArrivalDayEvening: false},
        );

        expect(arrivalWarnings).toEqual([
            {type: "arrival_day"},
            {type: "arrival_time_restricted"},
        ]);

        const departureWarnings = collectAssignmentWarnings(
            baseSlot("candidate", "2024-01-04", "08:00", "09:00"),
            {arrivalDate: "2024-01-02", departureDate: "2024-01-04"},
            [],
            {allowDepartureDayMorning: false},
        );

        expect(departureWarnings).toEqual([
            {type: "departure_day"},
            {type: "departure_time_restricted"},
        ]);
    });
});
