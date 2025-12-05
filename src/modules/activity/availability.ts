import {ActivitySlot} from "../database/entities/activity/ActivitySlot";
import {slotsOverlap, SlotTimeboxCandidate} from "./timebox";
import {ParticipantAttendance} from "./requirements";

export interface AttendanceCheck {
    allowed: boolean;
    boundary?: "arrival" | "departure" | "before" | "after";
}

export interface AssignmentWarning {
    type: "outside_attendance" | "arrival_day" | "departure_day" | "overlap";
    conflicts?: string[];
}

export interface AssignmentCandidate extends SlotTimeboxCandidate {
    id: string;
}

function isBefore(a: string, b: string): boolean {
    return a < b;
}

function isAfter(a: string, b: string): boolean {
    return a > b;
}

export function checkAttendanceForDay(
    day: string,
    arrival?: string | null,
    departure?: string | null,
): AttendanceCheck {
    if (arrival && isBefore(day, arrival)) {
        return {allowed: false, boundary: "before"};
    }
    if (departure && isAfter(day, departure)) {
        return {allowed: false, boundary: "after"};
    }
    if (arrival && day === arrival) {
        return {allowed: true, boundary: "arrival"};
    }
    if (departure && day === departure) {
        return {allowed: true, boundary: "departure"};
    }
    return {allowed: true};
}

export function findOverlapConflicts(candidate: AssignmentCandidate, existing: AssignmentCandidate[]): string[] {
    const conflicts: string[] = [];
    for (const slot of existing) {
        if (slot.id === candidate.id) continue;
        if (slotsOverlap(candidate, slot)) {
            conflicts.push(slot.id);
        }
    }
    return conflicts;
}

export function collectAssignmentWarnings(
    slot: AssignmentCandidate,
    participant: ParticipantAttendance,
    existingAssignments: AssignmentCandidate[],
): AssignmentWarning[] {
    const warnings: AssignmentWarning[] = [];

    const attendance = checkAttendanceForDay(slot.day, participant.arrivalDate ?? null, participant.departureDate ?? null);
    if (!attendance.allowed) {
        warnings.push({type: "outside_attendance"});
    } else if (attendance.boundary === "arrival") {
        warnings.push({type: "arrival_day"});
    } else if (attendance.boundary === "departure") {
        warnings.push({type: "departure_day"});
    }

    const conflicts = findOverlapConflicts(slot, existingAssignments);
    if (conflicts.length) {
        warnings.push({type: "overlap", conflicts});
    }

    return warnings;
}

export function toAssignmentCandidate(slot: ActivitySlot): AssignmentCandidate {
    return {
        id: slot.id,
        day: slot.day,
        startTime: slot.startTime,
        endTime: slot.endTime,
        pos: slot.pos,
    };
}
