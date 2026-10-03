/*
 * Copyright 2026 Julian Malovanij
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import type {ActivityPlan} from "../database/entities/activity/ActivityPlan";
import type {ActivityPlanRequirement} from "../database/entities/activity/ActivityPlanRequirement";
import type {ActivityPlanRequirementOverride} from "../database/entities/activity/ActivityPlanRequirementOverride";
import type {ActivityPlanStayRequirement} from "../database/entities/activity/ActivityPlanStayRequirement";
import type {ActivitySlot} from "../database/entities/activity/ActivitySlot";
import type {RecommendationInput} from "../database/services/ActivityRecommendationService";
import type {AssignmentCandidate} from "./availability";
import {generateFairRecommendations} from "./fairAssignment";
import {ParticipantAttendance, toParticipantKey} from "./requirements";

interface AutoAssignmentPlan
    extends Pick<
        ActivityPlan,
        |
        "assignmentMode"
        | "generalRequiredShifts"
        | "roundingMode"
        | "startDate"
        | "endDate"
        | "allowOverfillAfterFull"
        | "allowArrivalDayEvening"
        | "allowDepartureDayMorning"
    > {
    /** Include relationship identity even when two events happen to have identical participants. */
    eventId?: string | null;
    allowExternalAssignees?: boolean;
}

export interface AutoAssignmentSlot extends ActivitySlot {
    assignedCount?: number;
}

export interface AutoAssignmentContext {
    plan: AutoAssignmentPlan;
    slots: AutoAssignmentSlot[];
    participants: ParticipantAttendance[];
    roleRequirements: ActivityPlanRequirement[];
    overrides: ActivityPlanRequirementOverride[];
    stayRequirements: ActivityPlanStayRequirement[];
    existingAssignments: Record<string, AssignmentCandidate[]>;
    existingRecommendations?: RecommendationInput[];
}

export function generateAutoRecommendations(context: AutoAssignmentContext): RecommendationInput[] {
    return generateFairRecommendations(context);
}

export function mergeParticipants(...groups: ParticipantAttendance[][]): ParticipantAttendance[] {
    const participants = new Map<string, ParticipantAttendance>();
    for (const group of groups) {
        for (const participant of group) {
            const key = toParticipantKey(participant);
            if (key === "participant:unknown") continue;
            const existing = participants.get(key);
            participants.set(key, existing ? {
                ...existing,
                arrivalDate: participant.arrivalDate ?? existing.arrivalDate,
                departureDate: participant.departureDate ?? existing.departureDate,
                name: participant.name ?? existing.name,
                roleIds: participant.roleIds ?? existing.roleIds,
            } : participant);
        }
    }
    return [...participants.values()].sort((a, b) => toParticipantKey(a).localeCompare(toParticipantKey(b)));
}

export function participantsFromAssignments(assignments: Record<string, AssignmentCandidate[]>): ParticipantAttendance[] {
    return Object.keys(assignments).flatMap((key) => {
        const [type, id] = key.split(":");
        return type === "profile" ? [{profileId: id}] : [];
    });
}
