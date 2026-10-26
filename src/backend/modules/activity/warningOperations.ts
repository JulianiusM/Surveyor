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

import {requireRequirementConfiguration, buildParticipantAttendanceMap, buildLinkedPlanContext} from './context';
import type {RecommendationOperation, RecommendationStatus, RecommendationInput} from '../../../types/ActivityTypes';
import {Request} from 'express';
import crypto from 'node:crypto';
import type {EntityManager} from 'typeorm';
import {collectAssignmentWarnings, toAssignmentCandidate} from './availability';
import {buildRecommendationWarnings} from './recommendations';
import {toParticipantKey} from '../../../common/activity/requirements';
import {ActivityPlan} from '../database/entities/activity/ActivityPlan';
import {ActivitySlot} from '../database/entities/activity/ActivitySlot';
import * as recommendationService from '../database/services/ActivityRecommendationService';
import * as activityService from '../database/services/ActivityService';
import * as eventService from '../database/services/EventService';
import {APIError} from '../lib/errors';
import {ENTITIES} from '../lib/util';
import {evaluateEntities} from '../permissionEngine';
import type {AssignmentCandidate, AssignmentWarning, AssignmentWarningPreview, RecommendationWarningResult} from '../../../types/ActivityTypes';
import type {PermBundle, SessionLike} from '../../../types/PermissionTypes';

/** Application policy belongs to the controller; overlap detection remains a pure calculation. */
function classifyRecommendationOverlaps(plan: ActivityPlan, results: RecommendationWarningResult[]): void {
    for (const result of results) {
        for (const warning of result.warnings) {
            if (warning.type !== 'overlap') continue;
            const details = warning.overlapDetails ?? [];
            // Required-plan priority applies only when every observed conflict belongs to a foreign free plan.
            // Manual proposals may also be confirmed; neither exception changes the collision evidence.
            const requiredPriority = plan.assignmentMode === 'REQUIRED' && details.length > 0
                && details.every((conflict) => conflict.planId && conflict.planId !== plan.id && conflict.assignmentMode === 'FREE');
            warning.requiredPriority = requiredPriority;
            warning.confirmable = Boolean(result.recommendation.manual) || requiredPriority;
            if (warning.overlapTarget) {
                warning.overlapTarget = {...warning.overlapTarget, planId: plan.id, assignmentMode: plan.assignmentMode};
            }
        }
    }
}

/**
 * Bind confirmation to the operation and complete observed collision state. The browser receives
 * only an opaque digest; changing a sibling's mode, timebox, proposal or assignment revokes it.
 * This is acknowledgement, not authorization: all ownership/eligibility checks still run.
 */
export function overlapConfirmation(planId: string, results: RecommendationWarningResult[]): string | undefined {
    const collisions: string[] = [];
    // Normalize every confirmable collision with its complete foreign assignment/proposal state.
    for (const result of results) {
        for (const warning of result.warnings) {
            if (warning.type !== 'overlap' || !warning.confirmable) continue;
            const details: string[] = [];
            for (const conflict of warning.overlapDetails ?? []) {
                details.push(JSON.stringify([
                    conflict.planId, conflict.id, conflict.day, conflict.startTime, conflict.endTime,
                    conflict.assignmentMode, conflict.recommendationId, conflict.recommendationStatus,
                    conflict.operation, conflict.sourceItemId,
                ]));
            }
            collisions.push(JSON.stringify([recommendationInputKey(result.recommendation), warning.overlapTarget,
                warning.requiredPriority, details.sort()]));
        }
    }
    if (!collisions.length) return undefined;
    // Stable ordering makes the digest independent of query order while binding it to this plan and review.
    return crypto.createHash('sha256').update(JSON.stringify([planId, collisions.sort()])).digest('hex');
}

/** Require deliberate confirmation of the current overlap review when one exists. */
export function requireOverlapConfirmation(expected: string | undefined, submitted: unknown): void {
    // An older review digest cannot approve changed or newly discovered collisions.
    if (expected && submitted !== expected) {
        throw new APIError('Review the current overlap warnings and confirm again before applying this assignment',
            {reason: 'activity-overlap-confirmation-required'}, 409, {cause: 'ACTIVITY_OVERLAP_CONFIRMATION_REQUIRED'});
    }
}

/**
 * Detection includes every sibling, while disclosure follows the existing permission engine.
 * Do not expose hidden foreign IDs, titles or proposal state through warning details. The generic
 * warning remains useful, and the already-computed opaque confirmation still covers hidden data.
 */
export async function presentRecommendationWarnings(
    planId: string, results: RecommendationWarningResult[], session?: SessionLike, manager?: EntityManager,
): Promise<RecommendationWarningResult[]> {
    // Determine which sibling plans may disclose their details before projecting any warning content.
    const plan = await activityService.getActivityPlanById(planId, manager);
    const siblings = plan?.eventId ? await activityService.getLinkedActivityPlans(plan.eventId, planId, manager) : [];
    const visible = new Set<string>();
    if (session) {
        const descriptors = siblings.map((sibling) => ({
            entityType: ENTITIES.ACTIVITY, entityId: sibling.id, ownerId: sibling.ownerId, eventId: sibling.eventId,
        }));
        const permissions = await evaluateEntities(descriptors, session, manager);
        for (const sibling of siblings) {
            const permission = permissions.get(`activity:${sibling.id}`);
            if (permission?.has('ACCESS_VIEW') && permission.has('ACCESS_PARTICIPANTS')) visible.add(sibling.id);
        }
    }
    const presented: RecommendationWarningResult[] = [];
    for (const result of results) {
        const warnings: AssignmentWarning[] = [];
        for (const warning of result.warnings) {
            if (warning.type !== 'overlap') {
                warnings.push(warning);
                continue;
            }
            const details: AssignmentCandidate[] = [];
            for (const conflict of warning.overlapDetails ?? []) {
                if (!conflict.planId || conflict.planId === planId || visible.has(conflict.planId)) details.push(conflict);
            }
            warnings.push({...warning, conflicts: details.map((conflict) => conflict.id), overlapDetails: details});
        }
        presented.push({recommendation: result.recommendation, warnings});
    }
    return presented;
}

/** Build one projected warning set from current saved context and the supplied candidate batch. */
export async function collectRecommendationWarnings(
    planId: string, recommendations: RecommendationInput[], validateTargets = true, manager?: EntityManager,
    otherProposals: RecommendationInput[] = [],
): Promise<RecommendationWarningResult[]> {
    // Read and validate the candidate targets before combining local and linked-plan commitments.
    if (!manager) {
        async function readWarnings(snapshot: EntityManager): Promise<RecommendationWarningResult[]> {
            return collectRecommendationWarnings(planId, recommendations, validateTargets, snapshot, otherProposals);
        }
        return activityService.withActivityReadSnapshot(readWarnings);
    }
    if (validateTargets) await validateRecommendationTargets(planId, recommendations, false, manager);
    const activeRecommendations = recommendations.filter(
        (recommendation) => recommendation.status == null
            || recommendation.status === "PENDING"
            || recommendation.status === "APPROVED",
    );
    const [plan, requirementConfig, slots, existingAssignments] = await Promise.all([
        activityService.getActivityPlanById(planId, manager),
        requireRequirementConfiguration(planId, manager),
        activityService.getActivitySlotsFlat(planId, manager),
        activityService.getParticipantAssignmentsWithSlots(planId, manager),
    ]);

    const slotCapacities: Record<string, number> = {};
    if (plan && !plan.allowOverfillAfterFull) {
        const assignedCounts: Record<string, number> = {};
        for (const assignments of Object.values(existingAssignments)) {
            for (const assignment of assignments) {
                assignedCounts[assignment.id] = (assignedCounts[assignment.id] ?? 0) + 1;
            }
        }

        for (const slot of slots) {
            if (slot.maxAssignees != null) {
                slotCapacities[slot.id] = Math.max((slot.maxAssignees ?? 0) - (assignedCounts[slot.id] ?? 0), 0);
            }
        }
    }

    const eventParticipants = plan?.event ? await eventService.getEventParticipants(plan.event.id, manager) : [];
    const participantAttendance = plan
        ? await buildParticipantAttendanceMap(
            plan,
            requirementConfig.overrides,
            existingAssignments,
            activeRecommendations.map((recommendation) => ({
                itemId: recommendation.itemId,
                profileId: recommendation.profileId!,
            })),
            eventParticipants,
            manager,
        )
        : {};

    const linkedAssignments = plan ? (await buildLinkedPlanContext(plan, manager)).commitments : {};
    // Unselected local proposals reserve their targets for diagnostics, but never release
    // their sources or consume ordinary capacity in the batch that is actually being applied.
    const slotsById = new Map(slots.map((slot) => [slot.id, slot]));
    for (const proposal of otherProposals) {
        if (!['PENDING', 'APPROVED'].includes(proposal.status ?? 'PENDING') || proposal.operation === 'UNASSIGN') continue;
        const slot = slotsById.get(proposal.itemId);
        if (!slot) continue;
        const key = toParticipantKey({profileId: proposal.profileId});
        linkedAssignments[key] ??= [];
        linkedAssignments[key].push({...toAssignmentCandidate(slot), title: slot.title, planId,
            assignmentMode: plan?.assignmentMode, recommendationId: proposal.id, recommendationStatus: proposal.status});
    }
    const warnings = buildRecommendationWarnings({
        slots,
        recommendations: activeRecommendations,
        existingAssignments,
        linkedAssignments,
        participantAttendance,
        slotCapacities,
        allowOverfill: Boolean(plan?.allowOverfillAfterFull),
        attendancePolicy: {
            allowArrivalDayEvening: plan?.allowArrivalDayEvening,
            allowDepartureDayMorning: plan?.allowDepartureDayMorning,
        },
    });
    // The review read must remain available after relinking. Keep old drafts/history
    // visible with a precise warning, while mutation paths still reject ineligible targets.
    if (!validateTargets && plan?.eventId) {
        const eligible = new Set(eventParticipants.map((participant) => participant.profileId));
        if (plan.allowExternalAssignees) {
            for (const participantKey of Object.keys(existingAssignments)) {
                eligible.add(participantKey.replace(/^profile:/, ''));
            }
        }
        for (const warning of warnings) {
            if (warning.recommendation.profileId && !eligible.has(warning.recommendation.profileId)) {
                warning.warnings.push({type: 'ineligible_participant'});
            }
        }
    }
    if (plan) classifyRecommendationOverlaps(plan, warnings);
    return warnings;
}

/** Validate referenced activities, optional assignment state and participant eligibility
 * through the supplied transaction's current plan snapshot, without writing proposals. */
export async function validateRecommendationTargets(planId: string, recommendations: {
    itemId: string;
    profileId?: string | null;
    status?: RecommendationStatus;
    operation?: RecommendationOperation;
    sourceItemId?: string | null;
}[], validateAssignmentState = false, manager?: EntityManager) {
    // Read only this plan's current activities and commitments through the DBAL.
    const [plan, slots, assignees] = await Promise.all([
        activityService.getActivityPlanById(planId, manager),
        activityService.getActivitySlotsFlat(planId, manager),
        activityService.getActivitySlotAssignees(planId, manager),
    ]);
    if (!plan) {
        throw new APIError('Activity plan not found', {planId}, 404);
    }

    const allowedSlotIds = new Set(slots.map((slot) => slot.id));
    const invalidSlot = recommendations.find((recommendation) => !allowedSlotIds.has(recommendation.itemId));
    if (invalidSlot) {
        throw new APIError('Recommendation slot does not belong to this activity plan', invalidSlot, 400, {cause: 'ACTIVITY_RECOMMENDATION_TARGET_INVALID'});
    }
    const invalidSourceSlot = recommendations.find(
        (recommendation) => recommendation.sourceItemId && !allowedSlotIds.has(recommendation.sourceItemId),
    );
    if (invalidSourceSlot) {
        throw new APIError('Recommendation source slot does not belong to this activity plan', invalidSourceSlot, 400, {cause: 'ACTIVITY_RECOMMENDATION_TARGET_INVALID'});
    }

    // Applying a batch additionally requires consistent source/target pairs;
    // history rows already applied or rejected are not pending assignment intents.
    if (validateAssignmentState) {
        const targetPairs = new Set<string>();
        const sourcePairs = new Set<string>();
        for (const recommendation of recommendations) {
            if (["APPLIED", "REJECTED"].includes(recommendation.status ?? "PENDING")) continue;
            const operation = recommendation.operation ?? "ASSIGN";
            const targetPair = `${recommendation.itemId}:${recommendation.profileId}`;
            if (operation !== "UNASSIGN") {
                if (targetPairs.has(targetPair)) {
                    throw new APIError('Duplicate recommendation target', recommendation, 409, {cause: 'ACTIVITY_RECOMMENDATION_DUPLICATE'});
                }
                targetPairs.add(targetPair);
            }
            const targetAssignees = assignees[recommendation.itemId] ?? [];
            const targetAssignment = targetAssignees.find(
                (assignee) => assignee.profileId === recommendation.profileId,
            );
            if (operation === "ASSIGN" && targetAssignment) {
                throw new APIError('Participant is already assigned to the recommendation slot', recommendation, 409, {cause: 'ACTIVITY_RECOMMENDATION_ALREADY_ASSIGNED'});
            }
            const sourceItemId = operation === "REASSIGN"
                ? recommendation.sourceItemId
                : operation === "UNASSIGN"
                    ? recommendation.itemId
                    : null;
            if (sourceItemId) {
                const sourcePair = `${sourceItemId}:${recommendation.profileId}`;
                if (sourcePairs.has(sourcePair)) {
                    throw new APIError('An assignment can only be changed once per recommendation batch', recommendation, 409, {cause: 'ACTIVITY_RECOMMENDATION_CHANGE_DUPLICATE'});
                }
                sourcePairs.add(sourcePair);
                const sourceAssignment = (assignees[sourceItemId] ?? []).find(
                    (assignee) => assignee.profileId === recommendation.profileId,
                );
                if (!sourceAssignment) {
                    throw new APIError('Recommendation source assignment no longer exists', recommendation, 409, {cause: 'ACTIVITY_RECOMMENDATION_SOURCE_MISSING'});
                }
                if (
                    operation === "REASSIGN"
                    && sourceAssignment.roles.some((role) => role !== "default")
                ) {
                    throw new APIError(
                        'Assignments with named roles cannot be automatically reassigned',
                        recommendation,
                        409,
                        {cause: 'ACTIVITY_RECOMMENDATION_NAMED_ROLE'},
                    );
                }
            }
            if (operation === "REASSIGN" && targetAssignment) {
                throw new APIError('Participant is already assigned to the recommendation slot', recommendation, 409, {cause: 'ACTIVITY_RECOMMENDATION_ALREADY_ASSIGNED'});
            }
        }
    }

    // Linked-event membership constrains new recommendations. Existing assignees
    // remain eligible only through the plan's explicit external-assignee setting.
    if (!plan.event?.id) return;

    const eventParticipants = await eventService.getEventParticipants(plan.event.id, manager);
    const allowedProfileIds = new Set(
        eventParticipants.map((participant) => participant.profileId).filter((id): id is string => Boolean(id)),
    );
    if (plan.allowExternalAssignees) {
        Object.values(assignees).flat().forEach((assignee) => allowedProfileIds.add(assignee.profileId));
    }
    const invalidProfile = recommendations.find(
        (recommendation) => !['APPLIED', 'REJECTED'].includes(recommendation.status ?? 'PENDING')
            && recommendation.profileId && !allowedProfileIds.has(recommendation.profileId),
    );
    if (invalidProfile) {
        throw new APIError('Recommendations must target participants registered for this event', invalidProfile, 400, {cause: 'ACTIVITY_RECOMMENDATION_PARTICIPANT_REQUIRED'});
    }
}

/** Select self by default; an explicit other profile requires the existing assignment-management grant. */
function resolveWarningTarget(
    session: Request["session"],
    permData: PermBundle | undefined,
    body: { profileId?: string | null } = {},
) {
    // Check delegated authority before accepting a submitted identity; anonymous self selection remains an error.
    if (body.profileId) {
        const isManager = permData?.entity?.has('MANAGE_ASSIGNMENTS');
        if (!isManager) {
            throw new APIError("Insufficient permissions to view warnings for other participants", body, 403);
        }
        return {profileId: body.profileId};
    }

    if (session?.profile?.id) return {profileId: session.profile.id};

    throw new APIError("Unknown profile", body, 401);
}

export async function getAssignmentWarnings(
    planId: string,
    slotId: string,
    session: Request["session"],
    permData?: PermBundle,
    body?: { profileId?: string | null },
) {
    return (await getAssignmentWarningPreview(planId, slotId, session, permData, body)).warnings;
}

/** The existing warning read remains available; HTTP clients also receive its confirmation digest. */
export async function getAssignmentWarningPreview(
    planId: string, slotId: string, session: Request['session'], permData?: PermBundle,
    body?: {profileId?: string | null},
): Promise<AssignmentWarningPreview> {
    const target = resolveWarningTarget(session, permData, body);
    /** Read one target/slot snapshot, compute its confirmation evidence, then redact hidden sibling details. */
    async function previewAssignment(manager: EntityManager): Promise<AssignmentWarningPreview> {
        // Resolve actual slot ownership before any collision evidence is returned.
        const plan = await activityService.getActivityPlanById(planId, manager);
        const slot = await activityService.getActivitySlotById(slotId, manager);
        if (!plan || !slot || slot.entityId !== planId) {
            throw new APIError('Activity slot not found in this plan', {planId, slotId}, 404);
        }
        const warnings = await collectManualAssignmentWarnings(plan, slot, target.profileId!, manager);
        const raw = [{recommendation: {itemId: slotId, profileId: target.profileId, manual: true}, warnings}];
        // The digest covers full collisions before presentation removes private foreign-plan fields.
        const confirmation = overlapConfirmation(planId, raw);
        const presented = await presentRecommendationWarnings(planId, raw, session, manager);
        return {warnings: presented[0].warnings, overlapConfirmation: confirmation};
    }
    return activityService.withActivityReadSnapshot(previewAssignment);
}

/** Shared by the participant preview and the still-locked signup command, including role signups. */
export async function collectManualAssignmentWarnings(
    plan: ActivityPlan, slot: ActivitySlot, profileId: string, manager: EntityManager,
): Promise<AssignmentWarning[]> {
    // Gather attendance and all saved commitments through the caller manager before evaluating this participant.
    const participantKey = toParticipantKey({profileId});
    const [configuration, assignments, assignees, recommendations, linked, eventParticipants] = await Promise.all([
        requireRequirementConfiguration(plan.id, manager),
        activityService.getParticipantAssignmentsWithSlots(plan.id, manager),
        activityService.getActivitySlotAssignees(plan.id, manager),
        recommendationService.getRecommendations(plan.id, manager),
        buildLinkedPlanContext(plan, manager),
        plan.eventId ? eventService.getEventParticipants(plan.eventId, manager) : Promise.resolve([]),
    ]);
    const attendance = await buildParticipantAttendanceMap(plan, configuration.overrides, assignments, [], eventParticipants, manager);
    const commitments = [...(assignments[participantKey] ?? []), ...(linked.commitments[participantKey] ?? [])];
    for (const recommendation of recommendations) {
        if (recommendation.profile.id === profileId && ['PENDING', 'APPROVED'].includes(recommendation.status)
            && recommendation.operation !== 'UNASSIGN') {
            commitments.push({...toAssignmentCandidate(recommendation.item), title: recommendation.item.title,
                recommendationId: recommendation.id, recommendationStatus: recommendation.status});
        }
    }
    const warnings = collectAssignmentWarnings(
        toAssignmentCandidate(slot),
        attendance[participantKey] ?? {profileId},
        commitments,
        {
            allowArrivalDayEvening: plan.allowArrivalDayEvening,
            allowDepartureDayMorning: plan.allowDepartureDayMorning,
        },
    );

    if (typeof slot.maxAssignees === "number") {
        const currentCount = assignees[slot.id]?.length ?? 0;
        if (currentCount >= slot.maxAssignees) {
            warnings.push({type: "over_capacity"});
        }
    }

    for (const warning of warnings) {
        if (warning.type === 'overlap') {
            warning.confirmable = true;
            if (warning.overlapTarget) {
                warning.overlapTarget = {...warning.overlapTarget, planId: plan.id, assignmentMode: plan.assignmentMode};
            }
        }
    }
    return warnings;
}

export function recommendationInputKey(recommendation: RecommendationInput): string {
    return `${recommendation.operation ?? "ASSIGN"}:${recommendation.sourceItemId ?? ""}:${recommendation.itemId}:${recommendation.profileId}`;
}

