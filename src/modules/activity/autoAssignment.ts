/*
 * Copyright 2026 Julian Malovanij
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */

import type {ActivityAssignmentRecommendation} from "../database/entities/activity/ActivityAssignmentRecommendation";
import type {ActivityPlan} from "../database/entities/activity/ActivityPlan";
import type {ActivityPlanRequirement} from "../database/entities/activity/ActivityPlanRequirement";
import type {ActivityPlanRequirementOverride} from "../database/entities/activity/ActivityPlanRequirementOverride";
import type {ActivityPlanStayRequirement} from "../database/entities/activity/ActivityPlanStayRequirement";
import type {ActivitySlot} from "../database/entities/activity/ActivitySlot";
import type {RecommendationInput} from "../database/services/ActivityRecommendationService";
import * as recommendationService from "../database/services/ActivityRecommendationService";
import * as requirementService from "../database/services/ActivityRequirementService";
import * as activityService from "../database/services/ActivityService";
import * as eventService from "../database/services/EventService";
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

function mergeParticipants(...groups: ParticipantAttendance[][]): ParticipantAttendance[] {
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

function participantsFromAssignments(assignments: Record<string, AssignmentCandidate[]>): ParticipantAttendance[] {
    return Object.keys(assignments).flatMap((key) => {
        const [type, id] = key.split(":");
        return type === "profile" ? [{profileId: id}] : [];
    });
}

export async function buildPlanRecommendationContext(
    planId: string,
    existingRecommendations?: ActivityAssignmentRecommendation[],
): Promise<AutoAssignmentContext> {
    const [requirementConfig, plan, slots, existingAssignments, participantRoles] = await Promise.all([
        requirementService.getRequirementConfiguration(planId),
        activityService.getActivityPlanById(planId),
        activityService.getActivitySlotsFlat(planId) as Promise<AutoAssignmentSlot[]>,
        activityService.getParticipantAssignmentsWithSlots(planId),
        activityService.getParticipantRolesForPlan(planId),
    ]);
    if (!plan) throw new Error(`Activity plan ${planId} not found`);

    existingRecommendations ??= await recommendationService
        .getRecommendations(planId)
        .catch(() => [] as ActivityAssignmentRecommendation[]);
    const recommendationMemory: RecommendationInput[] = existingRecommendations.map((recommendation) => ({
        itemId: recommendation.item.id,
        profileId: recommendation.profile.id,
        status: recommendation.status,
    }));
    const eventParticipants = plan.event
        ? await eventService.getEventParticipants(plan.event.id)
        : [];
    const participants = mergeParticipants(
        eventParticipants.map((participant) => ({
            profileId: participant.profileId ?? undefined,
            arrivalDate: participant.arrivalDate ?? undefined,
            departureDate: participant.departureDate ?? undefined,
            name: participant.name ?? undefined,
        })),
        participantsFromAssignments(existingAssignments),
        requirementConfig.overrides.map((override) => ({
            profileId: override.profile.id ?? undefined,
            name: override.profile.name ?? undefined,
        })),
    );
    const participantByKey = new Map(participants.map((participant) => [toParticipantKey(participant), participant]));
    for (const participantRole of participantRoles) {
        const participant = participantByKey.get(participantRole.participantKey);
        if (participant) participant.roleIds = participantRole.roleIds;
    }

    return {
        plan: {
            assignmentMode: plan.assignmentMode,
            generalRequiredShifts: plan.generalRequiredShifts,
            roundingMode: plan.roundingMode,
            startDate: plan.startDate,
            endDate: plan.endDate,
            allowOverfillAfterFull: plan.allowOverfillAfterFull,
            allowArrivalDayEvening: plan.allowArrivalDayEvening,
            allowDepartureDayMorning: plan.allowDepartureDayMorning,
        },
        slots,
        participants,
        roleRequirements: requirementConfig.roleRequirements,
        overrides: requirementConfig.overrides,
        stayRequirements: requirementConfig.stayRequirements,
        existingAssignments,
        existingRecommendations: recommendationMemory,
    };
}

export async function generatePlanRecommendations(
    planId: string,
    existingRecommendations?: ActivityAssignmentRecommendation[],
): Promise<RecommendationInput[]> {
    return generateAutoRecommendations(await buildPlanRecommendationContext(planId, existingRecommendations));
}
