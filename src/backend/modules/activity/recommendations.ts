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

import type {AssignmentCandidate} from '../../../types/ActivityTypes';
import {generateAndSaveRecommendations, queueAutoGenerateRecommendations, toRecommendationInput, normalizeRecommendationForPersistence, saveReviewedRecommendations, recommendationContext, applyActivityRecommendationOperations, requireRequirementConfiguration, requireRecommendationContext, buildParticipantAttendanceMap, buildLinkedPlanContext, projectActivityAssignees} from './autoAssignment';
import type {RecommendationOperation, RecommendationStatus, ActivityRecommendationOperationInput, RecommendationWarningPreview, AssignmentWarning, AssignmentWarningPreview} from '../../../types/ActivityTypes';
import type {EntityManager} from 'typeorm';
import Joi from 'joi';
import {projectEventParticipants, ENTITIES, uuidKey, sameUuid, indexByUuid} from '../lib/util';
import type {ParticipantAttendance} from '../../../types/ActivityRequirementTypes';
import {toParticipantName} from '../../../common/activity/requirements';
import {ActivityAssignmentRecommendation} from '../database/entities/activity/ActivityAssignmentRecommendation';
import {ActivityPlan} from '../database/entities/activity/ActivityPlan';
import * as recommendationService from '../database/services/ActivityRecommendationService';
import * as activityService from '../database/services/ActivityService';
import * as eventService from '../database/services/EventService';
import {APIError} from '../lib/errors';
import type {SessionLike, PermBundle} from '../../../types/PermissionTypes';
import {Request} from 'express';
import crypto from 'node:crypto';
import {buildRecommendationWarnings} from './availability';
import {evaluateEntities, entityPermissionKey} from '../permissionEngine';

import {ActivitySlot} from "../database/entities/activity/ActivitySlot";
import type {RecommendationInput, RecommendationWarningResult} from "../../../types/ActivityTypes";

import {collectAssignmentWarnings, toAssignmentCandidate, normalizeRecommendationInput, recommendationInputKey} from './availability';

import {toParticipantKey} from "../../../common/activity/requirements";

/** Decode review rows while preserving legacy statuses, operation defaults and collected form diagnostics. */
function preprocessRecommendationUpdate(body: any) {
    // Validate row shape and reassignment source semantics before returning normalized review input.
    const schema = Joi.object({
        recommendations: Joi.array()
            .items(
                Joi.object({
                    id: Joi.string().uuid().optional(),
                    itemId: Joi.string().uuid().required(),
                    profileId: Joi.string().uuid().required(),
                    status: Joi.string().valid("PENDING", "APPROVED", "APPLIED", "REJECTED").optional(),
                    operation: Joi.string().valid("ASSIGN", "REASSIGN", "UNASSIGN").default("ASSIGN"),
                    sourceItemId: Joi.string().uuid().allow(null).optional(),
                    manual: Joi.boolean().optional(),
                }).custom((recommendation, helpers) => {
                    // A reassignment needs a distinct source; normal assignment/removal retain their existing shapes.
                    if (
                        recommendation.operation === "REASSIGN"
                        && (!recommendation.sourceItemId || sameUuid(recommendation.sourceItemId, recommendation.itemId))
                    ) {
                        return helpers.error("any.custom", {
                            message: "Reassignment requires a different source slot",
                        });
                    }
                    return recommendation;
                })
            )
            .default([]),
    });

    const {error, value} = schema.validate(body, {abortEarly: false, allowUnknown: true});
    if (error) {
        const msg = error.details.map((d: any) => d.message).join(', ');
        throw new APIError(msg, body, 400);
    }

    const validated = value as {
        recommendations: {
            id?: string;
            itemId: string;
            profileId: string;
            status?: RecommendationStatus;
            operation: RecommendationOperation;
            sourceItemId?: string | null;
            manual?: boolean;
        }[]
    };
    return {recommendations: validated.recommendations.map((recommendation) => normalizeRecommendationInput(recommendation))};
}

/** Allow automatic generation only for an empty Required-mode workspace with a valid reached deadline. */
function shouldAutoGenerateRecommendations(plan: ActivityPlan, recommendations: unknown[]): boolean {
    // Free mode, absent deadline and existing rows bypass generation; only then interpret the saved instant.
    if (plan.assignmentMode === "FREE" || !plan.bindingDeadline || recommendations.length > 0) {
        return false;
    }

    const deadline = new Date(plan.bindingDeadline);
    if (Number.isNaN(deadline.getTime())) return false;

    return deadline.getTime() <= Date.now();
}

/**
 * Applied rows and automatic rejection restrictions are intentionally absent from the review
 * GUI. A subsequent save must merge that history back instead of treating omission as deletion.
 */
function preserveRecommendationHistory(
    existing: ActivityAssignmentRecommendation[],
    submitted: RecommendationInput[],
): RecommendationInput[] {
    // Retain omitted applied/generated-rejection history, deduplicating by saved identity and operation key.
    const submittedIds = new Set(submitted.flatMap((recommendation) => recommendation.id ? [uuidKey(recommendation.id)] : []));
    const submittedKeys = new Set(submitted.map(recommendationInputKey));
    const hiddenHistory = existing
        .filter((recommendation) =>
            recommendation.status === "APPLIED"
            || (recommendation.status === "REJECTED" && !recommendation.manual))
        .filter((recommendation) => !submittedIds.has(uuidKey(recommendation.id)))
        .map(recommendation => toRecommendationInput(recommendation))
        .filter((recommendation) => !submittedKeys.has(recommendationInputKey(recommendation)));
    return [...submitted, ...hiddenHistory];
}

/**
 * Preserve current-plan provenance by saved ID, then assignment details when that ID is absent or stale.
 * A new proposal receives a server-owned row identity. Rejected manual work is equivalent to deletion;
 * rejected generated work remains as hidden allocation memory.
 */
function reconcileSubmittedRecommendations(
    existing: ActivityAssignmentRecommendation[],
    submitted: RecommendationInput[],
): RecommendationInput[] {
    // A known current-plan row keeps priority when its assignment details are edited.
    // A stale or foreign ID cannot suppress the existing assignment-detail provenance lookup.
    const byId = indexByUuid(existing, (recommendation) => recommendation.id);
    const byKey = new Map(existing.map((recommendation) => [
        recommendationInputKey(toRecommendationInput(recommendation)),
        recommendation,
    ]));

    const resolved = submitted.map((recommendation): RecommendationInput => {
        const persisted = (recommendation.id ? byId.get(uuidKey(recommendation.id)) : undefined)
            ?? byKey.get(recommendationInputKey(recommendation));
        const manual = persisted?.manual ?? Boolean(recommendation.manual);
        return {
            ...recommendation,
            // Unknown client IDs cannot select saved rows outside this plan; genuine new manual work remains valid.
            id: persisted?.id,
            manual,
            hidden: recommendation.status === "REJECTED" || recommendation.status === "APPLIED",
        };
    });

    return resolved.filter((recommendation) => {
        // Remove rejected manual work and its reciprocal move together, retaining generated rejection memory.
        if (recommendation.manual && recommendation.status === "REJECTED") return false;
        if (!recommendation.manual || recommendation.operation !== "REASSIGN" || !recommendation.sourceItemId) {
            return true;
        }
        const rejectedReciprocal = resolved.some((candidate) =>
            candidate.manual
            && candidate.status === "REJECTED"
            && candidate.operation === "REASSIGN"
            && sameUuid(candidate.itemId, recommendation.sourceItemId)
            && sameUuid(candidate.sourceItemId, recommendation.itemId));
        return !rejectedReciprocal;
    });
}

/** Retain the existing post-application generation gate for Required plans after their deadline. */
function shouldRegenerateRecommendationsAfterApply(plan: ActivityPlan): boolean {
    // A missing or malformed deadline never enables follow-up generation.
    if (plan.assignmentMode === "FREE" || !plan.bindingDeadline) return false;
    const deadline = new Date(plan.bindingDeadline);
    return !Number.isNaN(deadline.getTime()) && deadline.getTime() <= Date.now();
}

/** Workspace entry maintains saved proposals; the versioned recovery read
 * explicitly disables those effects while sharing the same safe presentation inputs.
 * Optional name provenance belongs only to versioned presentation, not standard JSON. */
export async function getRecommendations(planId: string, session?: SessionLike, maintain = true, includeNameProvenance = false) {
    // Both entry and recovery use existing feature reads rather than a second domain model.
    const [plan, requirementConfig, initialRecommendations, slots, assignments, assignees] = await Promise.all([
        activityService.getActivityPlanById(planId),
        requireRequirementConfiguration(planId),
        recommendationService.getRecommendations(planId),
        activityService.getActivitySlotsFlat(planId),
        activityService.getParticipantAssignmentsWithSlots(planId),
        activityService.getActivitySlotAssigneeRows(planId).then(projectActivityAssignees),
    ]);

    if (!plan) {
        throw new APIError('Activity plan not found', {planId}, 404);
    }

    const fulfilledIds: string[] = [];
    const obsoletePendingIds: string[] = [];
    const obsoleteApprovedIds: string[] = [];
    // Only deliberate workspace entry performs fulfilled/obsolete-row maintenance.
    if (maintain) {
        for (const recommendation of initialRecommendations) {
            if (!["PENDING", "APPROVED"].includes(recommendation.status)) continue;
            const operation = recommendation.operation ?? "ASSIGN";
            const hasTarget = (assignees[uuidKey(recommendation.item.id)] ?? [])
                .some((assignee) => sameUuid(assignee.profileId, recommendation.profile.id));
            const sourceSlotId = operation === "REASSIGN"
                ? recommendation.sourceItem?.id
                : operation === "UNASSIGN"
                    ? recommendation.item.id
                    : undefined;
            const hasSource = sourceSlotId
                ? (assignees[uuidKey(sourceSlotId)] ?? []).some((assignee) => sameUuid(assignee.profileId, recommendation.profile.id))
                : false;
            const fulfilled = (operation === "ASSIGN" && hasTarget)
                || (operation === "REASSIGN" && hasTarget && !hasSource)
                || (operation === "UNASSIGN" && !hasSource);
            if (fulfilled) {
                fulfilledIds.push(recommendation.id);
                recommendation.status = "APPLIED";
            } else if (operation === "REASSIGN" && (!hasSource || hasTarget)) {
                if (recommendation.status === "PENDING") obsoletePendingIds.push(recommendation.id);
                else {
                    obsoleteApprovedIds.push(recommendation.id);
                    recommendation.status = "REJECTED";
                }
            }
        }
        await Promise.all([
            recommendationService.markRecommendationsApplied(planId, fulfilledIds),
            recommendationService.deleteRecommendations(planId, obsoletePendingIds),
            recommendationService.markRecommendationsRejected(planId, obsoleteApprovedIds),
        ]);
    }
    const recommendations = initialRecommendations.filter(
        (recommendation) => !obsoletePendingIds.includes(recommendation.id),
    );
    const visibleRecommendations = recommendations.filter(
        (recommendation) => !recommendation.hidden && recommendation.status !== "APPLIED",
    );
    let autoGenerationJob;

    // If the binding deadline passed and no recommendations exist, seed them automatically
    if (maintain && shouldAutoGenerateRecommendations(plan, recommendations)) {
        const queued = await queueAutoGenerateRecommendations(planId);
        autoGenerationJob = queued.job;
    }

    // Warnings retain their existing server projection and sibling privacy filtering.
    const normalized = visibleRecommendations.map((rec) => ({
        itemId: rec.item.id,
        profileId: rec.profile.id,
        status: rec.status,
        operation: rec.operation,
        sourceItemId: rec.sourceItem?.id ?? null,
        manual: rec.manual,
    }));

    const warnings = await collectRecommendationWarnings(planId, normalized, false);
    const eventParticipants = plan.event ? await eventService.getEventParticipantRows(plan.event.id).then(projectEventParticipants) : [];
    const attendance = await buildParticipantAttendanceMap(
        plan,
        requirementConfig.overrides,
        assignments,
        normalized,
        eventParticipants,
    );

    // Attendance also describes committed historical work. Restrict the manual picker
    // to the same current-event policy used by validation and automatic generation.
    const registeredProfileIds = new Set(eventParticipants.map((participant) => participant.profileId ? uuidKey(participant.profileId) : participant.profileId));
    const restrictToRegistered = Boolean(plan.eventId) && !plan.allowExternalAssignees;
    function isSelectableParticipant(participant: ParticipantAttendance): boolean {
        return !restrictToRegistered || Boolean(participant.profileId && registeredProfileIds.has(uuidKey(participant.profileId)));
    }
    // Calculation keys are canonical; the workspace's selectors and saved rows
    // share the actual loaded profile spelling. Reuse already loaded references without another query.
    const profileReferences = indexByUuid([
        ...eventParticipants.flatMap((participant) => participant.profileId ? [{profileId: participant.profileId}] : []),
        ...recommendations.map((recommendation) => ({profileId: recommendation.profile.id})),
        ...Object.values(assignees).flat(),
    ], (participant) => participant.profileId);
    const participants = Object.values(attendance).filter(isSelectableParticipant).map((participant) => {
        const profileId = participant.profileId
            ? profileReferences.get(uuidKey(participant.profileId))?.profileId ?? participant.profileId
            : null;
        return {
            key: toParticipantKey({profileId}),
            profileId,
            label: toParticipantName({...participant, profileId}),
            ...(includeNameProvenance ? {nameIsFallback: !participant.name} : {}),
            arrivalDate: participant.arrivalDate ?? null,
            departureDate: participant.departureDate ?? null,
        };
    });

    const slotOptions = slots.map((slot) => ({
        id: slot.id,
        title: slot.title,
        day: slot.day,
        startTime: slot.startTime,
        endTime: slot.endTime,
    }));
    const slotById = indexByUuid(slotOptions, (slot) => slot.id);
    const existingAssignmentOptions = Object.entries(assignees).flatMap(([slotId, slotAssignees]) => {
        // A concurrently absent slot cannot provide an actionable assignment option.
        const item = slotById.get(uuidKey(slotId));
        if (!item) return [];
        return slotAssignees.map((assignee) => ({
            item,
            profile: {id: assignee.profileId, name: assignee.name},
            roles: assignee.roles,
        }));
    });

    return {
        recommendations: visibleRecommendations,
        warnings: await presentRecommendationWarnings(planId, warnings, session),
        participantOptions: participants, // Frontend expects participantOptions
        slots: slotOptions,
        existingAssignments: existingAssignmentOptions,
        autoGenerationJob,
    };
}

/** Reconcile submitted review provenance, persist the validated history and return current safe warnings. */
export async function updateRecommendations(planId: string, body: any, session?: SessionLike) {
    // Load the owning plan and existing rows before resolving client intent against persisted provenance.
    const plan = await activityService.getActivityPlanById(planId);
    if (!plan) throw new APIError('Activity plan not found', {planId}, 404);
    const submitted = preprocessRecommendationUpdate(body).recommendations;
    const existingRecommendations = await recommendationService.getRecommendations(planId);
    const recommendations = reconcileSubmittedRecommendations(existingRecommendations, submitted);
    await validateRecommendationTargets(planId, recommendations, true);
    await saveReviewedRecommendations(
        planId,
        preserveRecommendationHistory(existingRecommendations, recommendations),
        recommendationContext(plan),
    );
    const warnings = await collectRecommendationWarnings(planId, recommendations);
    return {message: 'Recommendations updated', warnings: await presentRecommendationWarnings(planId, warnings, session)};
}

/**
 * Resolve owned identity, assignment-detail provenance and review states once for preview and application.
 * New manual rows remain valid without granting unknown client IDs authority over saved rows.
 */
async function loadRecommendationReview(planId: string, body: any, manager: EntityManager) {
    // Use either the submitted review or current saved rows, then validate and normalize within the supplied snapshot.
    const existing = await recommendationService.getRecommendations(planId, manager);
    const reviewed = body?.recommendations !== undefined
        ? reconcileSubmittedRecommendations(existing, preprocessRecommendationUpdate(body).recommendations)
        : existing.map(recommendation => toRecommendationInput(recommendation));
    await validateRecommendationTargets(planId, reviewed, true, manager);
    return {existing, reviewed: reviewed.map(normalizeRecommendationForPersistence)};
}

/** Block the same pair of reciprocal moves together, preserving the existing swap contract. */
function includeBlockedSwapLegs(recommendations: RecommendationInput[], blocked: Set<string>): void {
    // Find reverse source/target moves in the same batch so one blocked leg cannot leave half a swap applicable.
    for (const recommendation of recommendations) {
        if (recommendation.operation !== 'REASSIGN' || !recommendation.sourceItemId) continue;
        const reciprocal = recommendations.find((candidate) => candidate !== recommendation
            && candidate.operation === 'REASSIGN' && sameUuid(candidate.itemId, recommendation.sourceItemId)
            && sameUuid(candidate.sourceItemId, recommendation.itemId));
        if (reciprocal && (blocked.has(recommendationInputKey(recommendation)) || blocked.has(recommendationInputKey(reciprocal)))) {
            blocked.add(recommendationInputKey(recommendation));
            blocked.add(recommendationInputKey(reciprocal));
        }
    }
}

/** Separate hard eligibility/capacity failures from overlap warnings that may be acknowledged. */
function hasBlockingRecommendationWarning(result: RecommendationWarningResult): boolean {
    // Only confirmable overlaps may proceed; all named hard constraints block the candidate.
    for (const warning of result.warnings) {
        if (warning.type === 'overlap') {
            if (!warning.confirmable) return true;
        } else if (['ineligible_participant', 'outside_attendance', 'arrival_time_restricted',
            'departure_time_restricted', 'over_capacity'].includes(warning.type)) return true;
    }
    return false;
}

/**
 * Recompute the projected schedule whenever a blocked operation is removed. Its source then
 * remains occupied, so another operation cannot rely on a removal that will never commit.
 * All overlap exceptions require a separate acknowledgement of the resulting final conflicts.
 */
async function prepareRecommendationApplication(planId: string, reviewed: RecommendationInput[], manager: EntityManager) {
    // Start from approved rows and repeatedly remove blocked operations until the projected occupancy is stable.
    const approved = reviewed.filter((recommendation) => recommendation.status === 'APPROVED');
    let applicable = approved;
    const blocked = new Set<string>();
    const resultsByKey = new Map<string, RecommendationWarningResult>();
    while (applicable.length > 0) {
        const selected = new Set(applicable.map(recommendationInputKey));
        const otherProposals = reviewed.filter((recommendation) => !selected.has(recommendationInputKey(recommendation)));
        const results = await collectRecommendationWarnings(planId, applicable, false, manager, otherProposals);
        const newlyBlocked = new Set<string>();
        for (const result of results) {
            const key = recommendationInputKey(result.recommendation);
            resultsByKey.set(key, result);
            if (hasBlockingRecommendationWarning(result)) newlyBlocked.add(key);
        }
        includeBlockedSwapLegs(applicable, newlyBlocked);
        if (newlyBlocked.size === 0) break;
        for (const key of newlyBlocked) blocked.add(key);
        applicable = applicable.filter((recommendation) => !blocked.has(recommendationInputKey(recommendation)));
    }
    const warnings: RecommendationWarningResult[] = [];
    const confirmable: RecommendationWarningResult[] = [];
    for (const recommendation of approved) {
        const result = resultsByKey.get(recommendationInputKey(recommendation));
        if (!result) continue;
        warnings.push(result);
        if (!blocked.has(recommendationInputKey(recommendation))) confirmable.push(result);
    }
    return {applicable, warnings, skipped: blocked.size, overlapConfirmation: overlapConfirmation(planId, confirmable)};
}

/** Read-only draft preview: staging and confirmation share the server's full event collision model. */
export async function getRecommendationWarningPreview(
    planId: string, body: any, session?: SessionLike,
): Promise<RecommendationWarningPreview> {
    /** Prepare draft warnings on one read snapshot without persisting review or assignment changes. */
    async function previewReview(manager: EntityManager): Promise<RecommendationWarningPreview> {
        // Resolve current review rows and the actual application projection before selecting visible warnings.
        const {reviewed} = await loadRecommendationReview(planId, body, manager);
        const prepared = await prepareRecommendationApplication(planId, reviewed, manager);
        const warnings = await collectRecommendationWarnings(planId, reviewed, false, manager);
        // Approved rows show the actual application projection, including blocked-source effects.
        const byKey = new Map(prepared.warnings.map((result) => [recommendationInputKey(result.recommendation), result]));
        const combined = warnings.map((result) => byKey.get(recommendationInputKey(result.recommendation)) ?? result);
        return {warnings: await presentRecommendationWarnings(planId, combined, session, manager),
            overlapConfirmation: prepared.overlapConfirmation};
    }
    return activityService.withActivityReadSnapshot(previewReview);
}

/**
 * Persist review state, validated assignments and applied history under the same event/plan
 * locks. Confirmation is checked before any write; a changed conflict leaves the draft intact.
 */
export async function applyRecommendations(planId: string, body?: any, session?: SessionLike) {
    /** Validate and apply one reviewed batch on the service-supplied locked transaction. */
    async function applyReviewed(manager: EntityManager) {
        // Lock and recheck plan context before calculating the final applicable set or persisting review state.
        const plan = await requireRecommendationContext(manager, planId);
        const {existing, reviewed} = await loadRecommendationReview(planId, body, manager);
        const prepared = await prepareRecommendationApplication(planId, reviewed, manager);
        requireOverlapConfirmation(prepared.overlapConfirmation, body?.overlapConfirmation);
        // Review replacement and assignment changes occur only after the final collision acknowledgement passes.
        if (body?.recommendations !== undefined) {
            await recommendationService.replaceRecommendations(planId, preserveRecommendationHistory(existing, reviewed), manager);
        }
        const operations: ActivityRecommendationOperationInput[] = [];
        const appliedKeys = new Set<string>();
        for (const recommendation of prepared.applicable) {
            operations.push({itemId: recommendation.itemId, profileId: recommendation.profileId!,
                operation: recommendation.operation ?? 'ASSIGN', sourceItemId: recommendation.sourceItemId});
            appliedKeys.add(recommendationInputKey(recommendation));
        }
        await applyActivityRecommendationOperations(planId, operations, recommendationContext(plan), manager);
        // Mark only the persisted rows actually applied in this same transaction before projecting safe warnings.
        const persisted = await recommendationService.getRecommendations(planId, manager);
        const appliedIds: string[] = [];
        for (const recommendation of persisted) {
            if (recommendation.status === 'APPROVED' && appliedKeys.has(recommendationInputKey(toRecommendationInput(recommendation)))) {
                appliedIds.push(recommendation.id);
            }
        }
        await recommendationService.markRecommendationsApplied(planId, appliedIds, manager);
        return {plan, applied: operations.length, skipped: prepared.skipped,
            warnings: await presentRecommendationWarnings(planId, prepared.warnings, session, manager)};
    }
    const result = await activityService.withActivityTransaction(applyReviewed);
    if (result.applied > 0 && shouldRegenerateRecommendationsAfterApply(result.plan)) {
        const history = await recommendationService.getRecommendations(planId);
        await generateAndSaveRecommendations(planId, history);
    }
    return {message: 'Applied ' + result.applied + ' recommendation' + (result.applied === 1 ? '' : 's'),
        applied: result.applied, skipped: result.skipped, warnings: result.warnings};
}

/** Application policy belongs to the controller; overlap detection remains a pure calculation. */
function classifyRecommendationOverlaps(plan: ActivityPlan, results: RecommendationWarningResult[]): void {
    for (const result of results) {
        for (const warning of result.warnings) {
            if (warning.type !== 'overlap') continue;
            const details = warning.overlapDetails ?? [];
            // Required-plan priority applies only when every observed conflict belongs to a foreign free plan.
            // Manual proposals may also be confirmed; neither exception changes the collision evidence.
            const requiredPriority = plan.assignmentMode === 'REQUIRED' && details.length > 0
                && details.every((conflict) => conflict.planId && !sameUuid(conflict.planId, plan.id) && conflict.assignmentMode === 'FREE');
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
                    conflict.planId ? uuidKey(conflict.planId) : conflict.planId, uuidKey(conflict.id),
                    conflict.day, conflict.startTime, conflict.endTime, conflict.assignmentMode,
                    conflict.recommendationId ? uuidKey(conflict.recommendationId) : conflict.recommendationId,
                    conflict.recommendationStatus, conflict.operation,
                    conflict.sourceItemId ? uuidKey(conflict.sourceItemId) : conflict.sourceItemId,
                ]));
            }
            const target = warning.overlapTarget;
            const targetIdentity = target ? {...target, id: uuidKey(target.id),
                planId: target.planId ? uuidKey(target.planId) : target.planId,
                recommendationId: target.recommendationId ? uuidKey(target.recommendationId) : target.recommendationId,
                sourceItemId: target.sourceItemId ? uuidKey(target.sourceItemId) : target.sourceItemId} : target;
            collisions.push(JSON.stringify([recommendationInputKey(result.recommendation), targetIdentity,
                warning.requiredPriority, details.sort()]));
        }
    }
    if (!collisions.length) return undefined;
    // Stable ordering makes the digest independent of query order while binding it to this plan and review.
    return crypto.createHash('sha256').update(JSON.stringify([uuidKey(planId), collisions.sort()])).digest('hex');
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
            const permission = permissions.get(entityPermissionKey('activity', sibling.id));
            if (permission?.has('ACCESS_VIEW') && permission.has('ACCESS_PARTICIPANTS')) visible.add(uuidKey(sibling.id));
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
                if (!conflict.planId || sameUuid(conflict.planId, planId) || visible.has(uuidKey(conflict.planId))) details.push(conflict);
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
                const key = uuidKey(assignment.id);
                assignedCounts[key] = (assignedCounts[key] ?? 0) + 1;
            }
        }

        for (const slot of slots) {
            if (slot.maxAssignees != null) {
                const key = uuidKey(slot.id);
                slotCapacities[key] = Math.max((slot.maxAssignees ?? 0) - (assignedCounts[key] ?? 0), 0);
            }
        }
    }

    const eventParticipants = plan?.event ? await eventService.getEventParticipantRows(plan.event.id, manager).then(projectEventParticipants) : [];
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
    const slotsById = indexByUuid(slots, (slot) => slot.id);
    for (const proposal of otherProposals) {
        if (!['PENDING', 'APPROVED'].includes(proposal.status ?? 'PENDING') || proposal.operation === 'UNASSIGN') continue;
        const slot = slotsById.get(uuidKey(proposal.itemId));
        if (!slot) continue;
        const key = toParticipantKey({profileId: proposal.profileId ? uuidKey(proposal.profileId) : proposal.profileId});
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
        const eligible = new Set(eventParticipants.map((participant) => participant.profileId ? uuidKey(participant.profileId) : participant.profileId));
        if (plan.allowExternalAssignees) {
            for (const participantKey of Object.keys(existingAssignments)) {
                eligible.add(uuidKey(participantKey.replace(/^profile:/, '')));
            }
        }
        for (const warning of warnings) {
            if (warning.recommendation.profileId && !eligible.has(uuidKey(warning.recommendation.profileId))) {
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
        activityService.getActivitySlotAssigneeRows(planId, manager).then(projectActivityAssignees),
    ]);
    if (!plan) {
        throw new APIError('Activity plan not found', {planId}, 404);
    }

    const allowedSlotIds = new Set(slots.map((slot) => uuidKey(slot.id)));
    const invalidSlot = recommendations.find((recommendation) => !allowedSlotIds.has(uuidKey(recommendation.itemId)));
    if (invalidSlot) {
        throw new APIError('Recommendation slot does not belong to this activity plan', invalidSlot, 400, {cause: 'ACTIVITY_RECOMMENDATION_TARGET_INVALID'});
    }
    const invalidSourceSlot = recommendations.find(
        (recommendation) => recommendation.sourceItemId && !allowedSlotIds.has(uuidKey(recommendation.sourceItemId)),
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
            const targetPair = `${uuidKey(recommendation.itemId)}:${recommendation.profileId ? uuidKey(recommendation.profileId) : recommendation.profileId}`;
            if (operation !== "UNASSIGN") {
                if (targetPairs.has(targetPair)) {
                    throw new APIError('Duplicate recommendation target', recommendation, 409, {cause: 'ACTIVITY_RECOMMENDATION_DUPLICATE'});
                }
                targetPairs.add(targetPair);
            }
            const targetAssignees = assignees[uuidKey(recommendation.itemId)] ?? [];
            const targetAssignment = targetAssignees.find(
                (assignee) => sameUuid(assignee.profileId, recommendation.profileId),
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
                const sourcePair = `${uuidKey(sourceItemId)}:${recommendation.profileId ? uuidKey(recommendation.profileId) : recommendation.profileId}`;
                if (sourcePairs.has(sourcePair)) {
                    throw new APIError('An assignment can only be changed once per recommendation batch', recommendation, 409, {cause: 'ACTIVITY_RECOMMENDATION_CHANGE_DUPLICATE'});
                }
                sourcePairs.add(sourcePair);
                const sourceAssignment = (assignees[uuidKey(sourceItemId)] ?? []).find(
                    (assignee) => sameUuid(assignee.profileId, recommendation.profileId),
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

    const eventParticipants = await eventService.getEventParticipantRows(plan.event.id, manager).then(projectEventParticipants);
    const allowedProfileIds = new Set(
        eventParticipants.flatMap((participant) => participant.profileId ? [uuidKey(participant.profileId)] : []),
    );
    if (plan.allowExternalAssignees) {
        Object.values(assignees).flat().forEach((assignee) => allowedProfileIds.add(uuidKey(assignee.profileId)));
    }
    const invalidProfile = recommendations.find(
        (recommendation) => !['APPLIED', 'REJECTED'].includes(recommendation.status ?? 'PENDING')
            && recommendation.profileId && !allowedProfileIds.has(uuidKey(recommendation.profileId)),
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
        return {profileId: uuidKey(body.profileId)};
    }

    if (session?.profile?.id) return {profileId: uuidKey(session.profile.id)};

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
        if (!plan || !slot || !sameUuid(slot.entityId, planId)) {
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
    const participantKey = toParticipantKey({profileId: uuidKey(profileId)});
    const [configuration, assignments, assignees, recommendations, linked, eventParticipants] = await Promise.all([
        requireRequirementConfiguration(plan.id, manager),
        activityService.getParticipantAssignmentsWithSlots(plan.id, manager),
        activityService.getActivitySlotAssigneeRows(plan.id, manager).then(projectActivityAssignees),
        recommendationService.getRecommendations(plan.id, manager),
        buildLinkedPlanContext(plan, manager),
        plan.eventId ? eventService.getEventParticipantRows(plan.eventId, manager).then(projectEventParticipants) : Promise.resolve([]),
    ]);
    const attendance = await buildParticipantAttendanceMap(plan, configuration.overrides, assignments, [], eventParticipants, manager);
    const commitments = [...(assignments[participantKey] ?? []), ...(linked.commitments[participantKey] ?? [])];
    for (const recommendation of recommendations) {
        if (sameUuid(recommendation.profile.id, profileId) && ['PENDING', 'APPROVED'].includes(recommendation.status)
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
        const currentCount = assignees[uuidKey(slot.id)]?.length ?? 0;
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
