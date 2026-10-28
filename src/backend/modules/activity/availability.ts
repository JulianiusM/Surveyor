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

import type {
    SlotTimeboxCandidate, AttendanceCheck, AttendancePolicy, RecommendationWarningOptions,
    RecommendationInput, RecommendationWarningResult, AssignmentCandidate, AssignmentWarning,
} from '../../../types/ActivityTypes';
import {toParticipantKey} from '../../../common/activity/requirements';
import {uuidKey, sameUuid, indexByUuid} from '../lib/util';

import type {ParticipantAttendance} from "../../../types/ActivityRequirementTypes";
import {parseTimeToMinutes, slotsOverlap} from './timebox';

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
        if (sameUuid(slot.id, candidate.id)) continue;
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

/** Collect attendance-boundary, restricted-time and overlap warnings using the
 * supplied policy over its defaults. This pure engine retains overlap provenance;
 * callers separately decide blocking, confirmation and identity redaction. */
export function collectAssignmentWarnings(
    slot: AssignmentCandidate,
    participant: ParticipantAttendance,
    existingAssignments: AssignmentCandidate[],
    policy: AttendancePolicy = DEFAULT_POLICY,
): AssignmentWarning[] {
    const warnings: AssignmentWarning[] = [];
    const attendancePolicy = {...DEFAULT_POLICY, ...policy};

    // Date admission precedes time-of-day policy; an admitted same-day stay can
    // still receive both its arrival and departure boundary warnings.
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

/** Supply recommendation defaults while preserving presented references; calculations explicitly request shared UUID keys. */
export function normalizeRecommendationInput(input: RecommendationInput, referenceMode: 'preserve' | 'canonical' = 'preserve'): RecommendationInput {
    const operation = input.operation ?? "ASSIGN";
    const sourceItemId = input.sourceItemId == null ? null : String(input.sourceItemId);

    return {
        // Row identity retains its stored spelling. Only internal calculations change reference spellings to lookup keys.
        id: input.id,
        itemId: referenceMode === 'canonical' ? uuidKey(input.itemId) : input.itemId,
        profileId: referenceMode === 'canonical' ? uuidKey(String(input.profileId)) : String(input.profileId),
        status: input.status ?? "PENDING",
        operation,
        sourceItemId: operation === "REASSIGN" && sourceItemId !== null
            ? referenceMode === 'canonical' ? uuidKey(sourceItemId) : sourceItemId
            : null,
        manual: Boolean(input.manual),
        hidden: Boolean(input.hidden),
        ...(input.swapGroup === undefined ? {} : {swapGroup: input.swapGroup}),
    };
}

/** Identify the complete operation independently of UUID spelling; rejection memory intentionally uses a narrower target key. */
export function recommendationInputKey(recommendation: RecommendationInput): string {
    const source = recommendation.sourceItemId ? uuidKey(recommendation.sourceItemId) : "";
    const profile = recommendation.profileId ? uuidKey(recommendation.profileId) : recommendation.profileId;
    return `${recommendation.operation ?? "ASSIGN"}:${source}:${uuidKey(recommendation.itemId)}:${profile}`;
}

/** Evaluate the complete selected batch against attendance, projected commitments
 * and supplied capacities. Releases are applied before targets so swaps do not
 * depend on payload order; foreign work remains reserved. Missing slots throw,
 * and callers retain admission, disclosure and persistence ownership. */
export function buildRecommendationWarnings({
                                                slots,
                                                recommendations,
                                                existingAssignments = {},
                                                linkedAssignments = {},
                                                participantAttendance = {},
                                                slotCapacities = {},
                                                allowOverfill = false,
                                                attendancePolicy,
                                            }: RecommendationWarningOptions): RecommendationWarningResult[] {
    // Resolve targets once and normalize every operation before projecting any
    // participant's releases or additions from this batch.
    const slotMap = indexByUuid(slots, (slot) => slot.id);

    const slotUsage = new Map<string, number>();
    const results: RecommendationWarningResult[] = [];
    const normalizedRecommendations = recommendations.map((input) => normalizeRecommendationInput(input, 'canonical'));
    const releasedCapacity = new Map<string, number>();
    const releasedByParticipant = new Map<string, Set<string>>();
    const proposedByParticipant = new Map<string, AssignmentCandidate[]>();

    // Collect the whole batch's local releases and proposed targets first.
    // An UNASSIGN releases its current slot but adds no replacement commitment.
    for (const recommendation of normalizedRecommendations) {
        const releasedSlotId = recommendation.operation === "REASSIGN"
            ? recommendation.sourceItemId
            : recommendation.operation === "UNASSIGN"
                ? recommendation.itemId
                : null;
        if (releasedSlotId) {
            releasedCapacity.set(releasedSlotId, (releasedCapacity.get(releasedSlotId) ?? 0) + 1);
            const key = toParticipantKey({profileId: recommendation.profileId});
            const released = releasedByParticipant.get(key) ?? new Set<string>();
            released.add(releasedSlotId);
            releasedByParticipant.set(key, released);
        }
        if (recommendation.operation !== 'UNASSIGN') {
            const slot = slotMap.get(recommendation.itemId);
            if (!slot) throw new Error(`Slot ${recommendation.itemId} not found for recommendation warnings`);
            const key = toParticipantKey({profileId: recommendation.profileId});
            const proposed = proposedByParticipant.get(key) ?? [];
            proposed.push({...toAssignmentCandidate(slot), title: slot.title});
            proposedByParticipant.set(key, proposed);
        }
    }

    // Emit warnings in submitted order against the same complete projection.
    for (const [index, rec] of normalizedRecommendations.entries()) {
        const slot = slotMap.get(rec.itemId);
        if (!slot) {
            throw new Error(`Slot ${rec.itemId} not found for recommendation warnings`);
        }

        const participantKey = toParticipantKey({profileId: rec.profileId});
        const attendance = participantAttendance[participantKey] ?? {profileId: rec.profileId};
        // Warnings return the submitted/loaded spellings used by mounted review rows;
        // canonical calculation keys must not become a different presentation identity.
        const presented = normalizeRecommendationInput(recommendations[index]!);
        if (rec.operation === "UNASSIGN") {
            results.push({recommendation: presented, warnings: []});
            continue;
        }

        // Project the complete selected batch before checking any target, making swaps
        // and paired removals independent of payload order. Foreign sources are never
        // released by this plan's proposals: their own application has not committed.
        const released = releasedByParticipant.get(participantKey);
        const local = (existingAssignments[participantKey] ?? []).filter((assignment) => !released?.has(uuidKey(assignment.id)));
        const projected = [
            ...local,
            ...(linkedAssignments[participantKey] ?? []),
            ...(proposedByParticipant.get(participantKey) ?? []),
        ];

        const candidate = toAssignmentCandidate(slot);
        const warnings = collectAssignmentWarnings(candidate, attendance, projected, attendancePolicy);

        // Count selected targets against the supplied capacity plus this batch's
        // released local places; explicit overfill bypasses only this warning.
        if (!allowOverfill) {
            const capacity = slotCapacities[uuidKey(slot.id)];
            if (capacity !== undefined) {
                const slotKey = uuidKey(slot.id);
                const used = slotUsage.get(slotKey) ?? 0;
                const available = capacity + (releasedCapacity.get(slotKey) ?? 0);
                if (used >= available) {
                    warnings.push({type: "over_capacity"});
                }
                slotUsage.set(slotKey, used + 1);
            }
        }

        results.push({recommendation: presented, warnings});

    }

    return results;
}
