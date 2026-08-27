/*
 * Copyright 2026 Julian Malovanij
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type {ActivitySlot} from "../database/entities/activity/ActivitySlot";
import type {ParticipantAttendance} from "./requirements";
import {parseTimeToMinutes, slotsOverlap, SlotTimeboxCandidate} from "./timebox";

/**
 * Availability helpers for assignment warnings. These utilities normalize slot assignments
 * into candidate structures, check attendance and overlap policies, and surface structured
 * warnings that the UI and recommendation engine can reuse.
 */

export interface AttendanceCheck {
    allowed: boolean;
    boundary?: "arrival" | "departure" | "before" | "after";
}

export type AssignmentWarningType =
    | "outside_attendance"
    | "arrival_day"
    | "departure_day"
    | "arrival_time_restricted"
    | "departure_time_restricted"
    | "overlap"
    | "over_capacity";

export interface AssignmentWarning {
    type: AssignmentWarningType;
    conflicts?: string[];
}

export interface AssignmentCandidate extends SlotTimeboxCandidate {
    id: string;
    isArrivalEvening?: boolean | null;
    isDepartureMorning?: boolean | null;
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

export interface AttendancePolicy {
    allowArrivalDayEvening?: boolean;
    allowDepartureDayMorning?: boolean;
}

const DEFAULT_POLICY: Required<AttendancePolicy> = {
    allowArrivalDayEvening: true,
    allowDepartureDayMorning: true,
};

function isEveningSlot(slot: SlotTimeboxCandidate): boolean {
    const startMinutes = parseTimeToMinutes(slot.startTime);
    if (startMinutes === null) return false;
    // Treat slots beginning after noon as "evening" for arrival-day gating to
    // keep the heuristic predictable without requiring additional user input.
    return startMinutes >= 12 * 60;
}

function isMorningSlot(slot: SlotTimeboxCandidate): boolean {
    const startMinutes = parseTimeToMinutes(slot.startTime);
    if (startMinutes === null) return false;
    // Consider slots starting before noon as "morning" to align with the
    // departure-day restriction toggle.
    return startMinutes < 12 * 60;
}

export function collectAssignmentWarnings(
    slot: AssignmentCandidate,
    participant: ParticipantAttendance,
    existingAssignments: AssignmentCandidate[],
    policy: AttendancePolicy = DEFAULT_POLICY,
): AssignmentWarning[] {
    const warnings: AssignmentWarning[] = [];
    const attendancePolicy = {...DEFAULT_POLICY, ...policy};

    const attendance = checkAttendanceForDay(slot.day, participant.arrivalDate ?? null, participant.departureDate ?? null);
    if (!attendance.allowed) {
        warnings.push({type: "outside_attendance"});
    } else if (attendance.boundary === "arrival") {
        warnings.push({type: "arrival_day"});
        // Check explicit slot flag first, fall back to time-based heuristic
        const isEvening = slot.isArrivalEvening ?? isEveningSlot(slot);
        if (!attendancePolicy.allowArrivalDayEvening && isEvening) {
            warnings.push({type: "arrival_time_restricted"});
        }
    } else if (attendance.boundary === "departure") {
        warnings.push({type: "departure_day"});
        // Check explicit slot flag first, fall back to time-based heuristic
        const isMorning = slot.isDepartureMorning ?? isMorningSlot(slot);
        if (!attendancePolicy.allowDepartureDayMorning && isMorning) {
            warnings.push({type: "departure_time_restricted"});
        }
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
        isArrivalEvening: slot.isArrivalEvening,
        isDepartureMorning: slot.isDepartureMorning,
    };
}
