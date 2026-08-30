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

import {ActivitySlot} from "../database/entities/activity/ActivitySlot";
import {normalizeRecommendationInput, RecommendationInput} from "../database/services/ActivityRecommendationService";
import {AssignmentCandidate, AttendancePolicy, collectAssignmentWarnings, toAssignmentCandidate} from "./availability";
import {ParticipantAttendance, toParticipantKey} from "./requirements";

/**
 * Shared helpers for staging and validating assignment recommendations. The functions here
 * normalize recommendation payloads, attach warnings for overlaps/attendance/capacity, and
 * keep per-participant queues consistent across the UI and controller layers.
 */

export interface RecommendationWarningResult {
    recommendation: RecommendationInput;
    warnings: ReturnType<typeof collectAssignmentWarnings>;
}

export interface RecommendationWarningOptions {
    slots: ActivitySlot[];
    recommendations: RecommendationInput[];
    existingAssignments?: Record<string, AssignmentCandidate[]>;
    participantAttendance?: Record<string, ParticipantAttendance>;
    slotCapacities?: Record<string, number>;
    allowOverfill?: boolean;
    attendancePolicy?: AttendancePolicy;
}

export function buildRecommendationWarnings({
                                                slots,
                                                recommendations,
                                                existingAssignments = {},
                                                participantAttendance = {},
                                                slotCapacities = {},
                                                allowOverfill = false,
                                                attendancePolicy,
                                            }: RecommendationWarningOptions): RecommendationWarningResult[] {
    const slotMap = new Map<string, ActivitySlot>();
    for (const slot of slots) {
        slotMap.set(slot.id, slot);
    }

    const participantQueue = new Map<string, AssignmentCandidate[]>();
    const slotUsage = new Map<string, number>();
    const results: RecommendationWarningResult[] = [];
    const normalizedRecommendations = recommendations.map(normalizeRecommendationInput);
    const releasedCapacity = new Map<string, number>();

    for (const recommendation of normalizedRecommendations) {
        const releasedSlotId = recommendation.operation === "REASSIGN"
            ? recommendation.sourceItemId
            : recommendation.operation === "UNASSIGN"
                ? recommendation.itemId
                : null;
        if (releasedSlotId) {
            releasedCapacity.set(releasedSlotId, (releasedCapacity.get(releasedSlotId) ?? 0) + 1);
        }
    }

    for (const rec of normalizedRecommendations) {
        const slot = slotMap.get(rec.itemId);
        if (!slot) {
            throw new Error(`Slot ${rec.itemId} not found for recommendation warnings`);
        }

        const participantKey = toParticipantKey({profileId: rec.profileId});
        const attendance = participantAttendance[participantKey] ?? {profileId: rec.profileId};
        const existing = existingAssignments[participantKey] ?? [];
        const prior = participantQueue.get(participantKey) ?? existing;

        if (rec.operation === "UNASSIGN") {
            results.push({recommendation: rec, warnings: []});
            participantQueue.set(
                participantKey,
                prior.filter((assignment) => assignment.id !== rec.itemId),
            );
            continue;
        }

        const projected = rec.operation === "REASSIGN"
            ? prior.filter((assignment) => assignment.id !== rec.sourceItemId)
            : prior;

        const candidate = toAssignmentCandidate(slot);
        const warnings = collectAssignmentWarnings(candidate, attendance, projected, attendancePolicy);

        if (!allowOverfill) {
            const capacity = slotCapacities[slot.id];
            if (capacity !== undefined) {
                const used = slotUsage.get(slot.id) ?? 0;
                const available = capacity + (releasedCapacity.get(slot.id) ?? 0);
                if (used >= available) {
                    warnings.push({type: "over_capacity"});
                }
                slotUsage.set(slot.id, used + 1);
            }
        }

        results.push({recommendation: rec, warnings});

        participantQueue.set(participantKey, [...projected, candidate]);
    }

    return results;
}
