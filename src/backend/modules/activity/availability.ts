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

import type {SlotTimeboxCandidate, AttendanceCheck, AttendancePolicy} from '../../../types/ActivityTypes';



import type {ParticipantAttendance} from "../../../types/ActivityRequirementTypes";
import {parseTimeToMinutes, slotsOverlap} from './timebox';
import type {AssignmentCandidate, AssignmentWarning} from '../../../types/ActivityTypes';


function isBefore(a: string, b: string): boolean {
    return a < b;
}

function isAfter(a: string, b: string): boolean {
    return a > b;
}

/** Classify a saved civil day against the supplied optional attendance bounds.
 * Outside days are rejected first; an arrival/departure match stays admitted
 * with its boundary marker, preserving arrival precedence for a same-day stay. */
export function checkAttendanceForDay(
    day: string,
    arrival?: string | null,
    departure?: string | null,
): AttendanceCheck {
    // Saved ISO-day ordering supplies the existing inclusive range comparison.
    if (arrival && isBefore(day, arrival)) {
        return {allowed: false, boundary: "before"};
    }
    if (departure && isAfter(day, departure)) {
        return {allowed: false, boundary: "after"};
    }
    // Boundary labels are separate from later time-of-day attendance policy.
    if (arrival && day === arrival) {
        return {allowed: true, boundary: "arrival"};
    }
    if (departure && day === departure) {
        return {allowed: true, boundary: "departure"};
    }
    return {allowed: true};
}

/** Return conflicting saved slot IDs using the shared timebox overlap rule.
 * A slot does not conflict with itself; result ordering follows the supplied
 * commitments and disclosure remains the controller's separate responsibility. */
export function findOverlapConflicts(candidate: AssignmentCandidate, existing: AssignmentCandidate[]): string[] {
    // Retain the caller's order and exclude only this same slot identity before
    // applying the established date/time overlap semantics.
    const conflicts: string[] = [];
    for (const slot of existing) {
        if (slot.id === candidate.id) continue;
        if (slotsOverlap(candidate, slot)) {
            conflicts.push(slot.id);
        }
    }
    return conflicts;
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
    } else {
        if (participant.arrivalDate && slot.day === participant.arrivalDate) {
            warnings.push({type: "arrival_day"});
            // Arrival mornings are never eligible. Later arrival-day slots require
            // the corresponding plan setting.
            const isEvening = parseTimeToMinutes(slot.startTime) == null
                ? slot.isArrivalEvening === true
                : isEveningSlot(slot);
            if (!isEvening || !attendancePolicy.allowArrivalDayEvening) {
                warnings.push({type: "arrival_time_restricted"});
            }
        }
        if (participant.departureDate && slot.day === participant.departureDate) {
            warnings.push({type: "departure_day"});
            // Departure afternoons/evenings are never eligible. Morning slots
            // require the corresponding plan setting.
            const isMorning = parseTimeToMinutes(slot.startTime) == null
                ? slot.isDepartureMorning === true
                : isMorningSlot(slot);
            if (!isMorning || !attendancePolicy.allowDepartureDayMorning) {
                warnings.push({type: "departure_time_restricted"});
            }
        }
    }

    const conflicts = findOverlapConflicts(slot, existingAssignments);
    if (conflicts.length) {
        // Preserve provenance for the controller's priority decision and confirmation digest.
        // Display permissions are deliberately handled later, at the HTTP boundary.
        const overlapDetails = existingAssignments.filter((assignment) => conflicts.includes(assignment.id));
        warnings.push({type: "overlap", conflicts, overlapDetails, overlapTarget: slot});
    }

    return warnings;
}

export function toAssignmentCandidate(slot: Pick<AssignmentCandidate,
    'id' | 'day' | 'startTime' | 'endTime' | 'pos' | 'isArrivalEvening' | 'isDepartureMorning'>): AssignmentCandidate {
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
