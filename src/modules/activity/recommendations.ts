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
import type {RecommendationInput, RecommendationWarningResult} from "../../types/ActivityTypes";
export type {RecommendationWarningResult} from '../../types/ActivityTypes';
import {AssignmentCandidate, AttendancePolicy, collectAssignmentWarnings, toAssignmentCandidate} from "./availability";
import {ParticipantAttendance, toParticipantKey} from "./requirements";

/**
 * Shared helpers for staging and validating assignment recommendations. The functions here
 * normalize recommendation payloads, attach warnings for overlaps/attendance/capacity, and
 * keep per-participant queues consistent across the UI and controller layers.
 */

export interface RecommendationWarningOptions {
    slots: ActivitySlot[];
    recommendations: RecommendationInput[];
    existingAssignments?: Record<string, AssignmentCandidate[]>;
    linkedAssignments?: Record<string, AssignmentCandidate[]>;
    participantAttendance?: Record<string, ParticipantAttendance>;
    slotCapacities?: Record<string, number>;
    allowOverfill?: boolean;
    attendancePolicy?: AttendancePolicy;
}

/** Supply canonical defaults for pure recommendation calculations; controllers validate inputs. */
export function normalizeRecommendationInput(input: RecommendationInput): RecommendationInput {
    const operation = input.operation ?? "ASSIGN";
    const sourceItemId = input.sourceItemId == null ? null : String(input.sourceItemId);

    return {
        id: input.id,
        itemId: input.itemId,
        profileId: String(input.profileId),
        status: input.status ?? "PENDING",
        operation,
        sourceItemId: operation === "REASSIGN" ? sourceItemId : null,
        manual: Boolean(input.manual),
        hidden: Boolean(input.hidden),
    };
}

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
    const slotMap = new Map<string, ActivitySlot>();
    for (const slot of slots) {
        slotMap.set(slot.id, slot);
    }

    const slotUsage = new Map<string, number>();
    const results: RecommendationWarningResult[] = [];
    const normalizedRecommendations = recommendations.map(normalizeRecommendationInput);
    const releasedCapacity = new Map<string, number>();
    const releasedByParticipant = new Map<string, Set<string>>();
    const proposedByParticipant = new Map<string, AssignmentCandidate[]>();

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

    for (const rec of normalizedRecommendations) {
        const slot = slotMap.get(rec.itemId);
        if (!slot) {
            throw new Error(`Slot ${rec.itemId} not found for recommendation warnings`);
        }

        const participantKey = toParticipantKey({profileId: rec.profileId});
        const attendance = participantAttendance[participantKey] ?? {profileId: rec.profileId};
        if (rec.operation === "UNASSIGN") {
            results.push({recommendation: rec, warnings: []});
            continue;
        }

        // Project the complete selected batch before checking any target, making swaps
        // and paired removals independent of payload order. Foreign sources are never
        // released by this plan's proposals: their own application has not committed.
        const released = releasedByParticipant.get(participantKey);
        const local = (existingAssignments[participantKey] ?? []).filter((assignment) => !released?.has(assignment.id));
        const projected = [
            ...local,
            ...(linkedAssignments[participantKey] ?? []),
            ...(proposedByParticipant.get(participantKey) ?? []),
        ];

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

    }

    return results;
}
