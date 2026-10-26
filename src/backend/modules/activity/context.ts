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

import type {EntityManager} from 'typeorm';
import type {ActivityPlan} from '../database/entities/activity/ActivityPlan';
import type {ActivitySlot} from '../database/entities/activity/ActivitySlot';
import type {ActivityAssignmentRecommendation} from '../database/entities/activity/ActivityAssignmentRecommendation';
import type {RequirementConfiguration, ActivityRecommendationPersistenceContext, ActivityLinkedPlanContext} from '../../../types/ActivityTypes';
import type {ParticipantAttendance} from '../../../types/ActivityRequirementTypes';
import * as activityService from '../database/services/ActivityService';
import * as requirementService from '../database/services/ActivityRequirementService';
import * as eventService from '../database/services/EventService';
import * as userService from '../database/services/UserService';
import * as recommendationService from '../database/services/ActivityRecommendationService';
import {APIError} from '../lib/errors';
import {toParticipantKey} from '../../../common/activity/requirements';
import {toAssignmentCandidate} from './availability';

/** Controllers translate a missing DBAL snapshot into the established API response. */
export async function requireRequirementConfiguration(planId: string, manager?: EntityManager): Promise<RequirementConfiguration> {
    const configuration = await requirementService.getRequirementConfiguration(planId, manager);
    if (!configuration) throw new APIError('Activity plan not found', {planId}, 404);
    return configuration;
}

/**
 * Decisions are made after acquiring the root lock, not between separate service transactions.
 * The process-local callback detects jobs invalidated while they wait for that lock.
 */
export async function requireRecommendationContext(
    manager: EntityManager, planId: string, expected?: ActivityRecommendationPersistenceContext,
): Promise<ActivityPlan> {
    const {initialEventId, plan} = await activityService.lockActivityContext(manager, planId);
    if (!plan) throw new APIError('Activity plan not found', {planId}, 404);
    if ((plan.eventId ?? null) !== initialEventId || (expected && (expected.isCurrent?.() === false || (plan.eventId ?? null) !== expected.eventId
        || plan.startDate !== expected.startDate || plan.endDate !== expected.endDate))) {
        throw new APIError('Activity plan context changed; reload and try again', {reason: 'activity-context-changed'}, 409, {cause: 'ACTIVITY_CONTEXT_CHANGED'});
    }
    return plan;
}

/**
 * Assemble foreign commitments once from the saved relationship. Sibling roles, counts and
 * requirements deliberately stay out of the local participant projection. An active move
 * reserves its target but cannot release a commitment owned by a different plan's transaction.
 */
export async function buildLinkedPlanContext(plan: ActivityPlan, manager?: EntityManager): Promise<ActivityLinkedPlanContext> {
    const context: ActivityLinkedPlanContext = {plans: [], commitments: {}};
    if (!plan.eventId) return context;
    // Resolve siblings from the saved event relationship before reading their assignment/proposal evidence.
    const siblings = await activityService.getLinkedActivityPlans(plan.eventId, plan.id, manager);
    const byId = new Map(siblings.map((sibling) => [sibling.id, sibling]));
    const ids = siblings.map((sibling) => sibling.id);
    const [assignments, recommendations] = await Promise.all([
        activityService.getAssignmentsForPlans(ids, manager),
        recommendationService.getRecommendationsForPlans(ids, manager),
    ]);
    for (const sibling of siblings) {
        context.plans.push({id: sibling.id, assignmentMode: sibling.assignmentMode, startDate: sibling.startDate, endDate: sibling.endDate});
    }
    /** Reserve only commitments falling within this plan's date range, retaining their foreign provenance. */
    function addCommitment(profileId: string, slot: ActivitySlot, sibling: ActivityPlan, recommendation?: ActivityAssignmentRecommendation): void {
        if (slot.day < plan.startDate || slot.day > plan.endDate) return;
        const key = toParticipantKey({profileId});
        context.commitments[key] ??= [];
        context.commitments[key].push({
            ...toAssignmentCandidate(slot), title: slot.title, planId: sibling.id,
            planTitle: sibling.title, assignmentMode: sibling.assignmentMode,
            recommendationId: recommendation?.id, recommendationStatus: recommendation?.status,
            operation: recommendation?.operation, sourceItemId: recommendation?.sourceItem?.id ?? null,
        });
    }
    // Saved assignments always reserve time; active non-removal proposals additionally reserve their targets.
    for (const assignment of assignments) {
        const sibling = byId.get(assignment.entityId);
        if (sibling) addCommitment(assignment.profile.id, assignment.item, sibling);
    }
    for (const recommendation of recommendations) {
        if (!['PENDING', 'APPROVED'].includes(recommendation.status) || recommendation.operation === 'UNASSIGN') continue;
        const sibling = byId.get(recommendation.entityId);
        if (sibling) addCommitment(recommendation.profile.id, recommendation.item, sibling, recommendation);
    }
    return context;
}

/** Merge admitted registration, assignment and proposal sources by stable profile identity, then enrich missing data. */
export async function buildParticipantAttendanceMap(
    plan: ActivityPlan,
    overrides: RequirementConfiguration["overrides"],
    existingAssignments: Record<string, {
        id: string;
        day: string;
        startTime?: string | null;
        endTime?: string | null;
        pos?: number | null
    }[]>,
    recommendations: { itemId: string; profileId: string }[],
    eventParticipants: Awaited<ReturnType<typeof eventService.getEventParticipants>> = [],
    manager?: EntityManager,
): Promise<Record<string, ParticipantAttendance>> {
    const attendance: Record<string, ParticipantAttendance> = {};

    /** Enrich one identity without replacing known attendance, roles or names with absent values. */
    const upsert = (participant: ParticipantAttendance) => {
        // Preserve earlier evidence when the later source omits a field.
        const key = toParticipantKey(participant);
        if (!key) return;
        if (!attendance[key]) {
            attendance[key] = participant;
            return;
        }

        const existing = attendance[key];
        attendance[key] = {
            ...existing,
            arrivalDate: participant.arrivalDate ?? existing.arrivalDate,
            departureDate: participant.departureDate ?? existing.departureDate,
            roleIds: participant.roleIds ?? existing.roleIds,
            name: participant.name ?? existing.name,
        };
    };

    eventParticipants.forEach((participant) => {
        upsert({
            profileId: participant.profileId ?? undefined,
            arrivalDate: participant.arrivalDate ?? undefined,
            departureDate: participant.departureDate ?? undefined,
            name: participant.name ?? undefined,
        });
    });

    // Committed assignees remain part of the read projection after relinking or an
    // external-assignee policy change. Their names and recorded work must stay visible;
    // recommendation selection and persistence enforce eligibility independently.
    Object.keys(existingAssignments).forEach((key) => {
        // Only persisted profile-backed assignment identities enter this attendance map.
        const [type, id] = key.split(":");
        if (type === "profile") {
            upsert({profileId: String(id)});
        }
    });

    // Retained overrides can enrich a registered or already assigned profile's name,
    // but an override alone never adds a participant or grants recommendation eligibility.
    for (const override of overrides) {
        if (attendance[toParticipantKey({profileId: override.profileId})]) {
            upsert({profileId: override.profileId, name: override.profile.name});
        }
    }
    for (const rec of recommendations) {
        if (!plan.eventId || attendance[toParticipantKey({profileId: rec.profileId})]) {
            upsert({profileId: rec.profileId ?? undefined});
        }
    }

    // Resolve only missing display names in one DBAL read, on the caller's manager when supplied.
    const unnamedProfileIds = Object.values(attendance)
        .filter((participant) => participant.profileId && !participant.name)
        .map((participant) => participant.profileId as string);
    const profiles = await userService.getProfilesByIds(unnamedProfileIds, manager);
    profiles.forEach((profile) => upsert({profileId: profile.id, name: profile.name}));

    // Load roleIds from ActivityAssignmentRole for each participant
    const participantRoles = await activityService.getParticipantRolesForPlan(plan.id, manager);
    for (const {participantKey, roleIds} of participantRoles) {
        if (attendance[participantKey] && roleIds.length > 0) {
            attendance[participantKey].roleIds = [...new Set([...(attendance[participantKey].roleIds || []), ...roleIds])];
        }
    }

    return attendance;
}

