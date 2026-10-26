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

import {generateAndSaveRecommendations, queueAutoGenerateRecommendations} from './recommendationExecution';
import {toRecommendationInput, normalizeRecommendationForPersistence, saveReviewedRecommendations, recommendationContext, applyActivityRecommendationOperations} from './recommendationPersistence';
import {overlapConfirmation, requireOverlapConfirmation, presentRecommendationWarnings, collectRecommendationWarnings, validateRecommendationTargets, recommendationInputKey} from './warningOperations';
import {requireRequirementConfiguration, requireRecommendationContext, buildParticipantAttendanceMap} from './context';
import type {RecommendationOperation, RecommendationStatus, RecommendationInput} from '../../../types/ActivityTypes';
import type {EntityManager} from 'typeorm';
import Joi from 'joi';
import type {ParticipantAttendance} from '../../../types/ActivityRequirementTypes';
import {toParticipantKey, toParticipantName} from '../../../common/activity/requirements';
import {ActivityAssignmentRecommendation} from '../database/entities/activity/ActivityAssignmentRecommendation';
import {ActivityPlan} from '../database/entities/activity/ActivityPlan';
import * as recommendationService from '../database/services/ActivityRecommendationService';
import * as activityService from '../database/services/ActivityService';
import * as eventService from '../database/services/EventService';
import {APIError} from '../lib/errors';
import type {ActivityRecommendationOperationInput, RecommendationWarningResult, RecommendationWarningPreview} from '../../../types/ActivityTypes';
import type {SessionLike} from '../../../types/PermissionTypes';

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
                        && (!recommendation.sourceItemId || recommendation.sourceItemId === recommendation.itemId)
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

    return value as {
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
    const submittedIds = new Set(submitted.map((recommendation) => recommendation.id).filter(Boolean));
    const submittedKeys = new Set(submitted.map(recommendationInputKey));
    const hiddenHistory = existing
        .filter((recommendation) =>
            recommendation.status === "APPLIED"
            || (recommendation.status === "REJECTED" && !recommendation.manual))
        .filter((recommendation) => !submittedIds.has(recommendation.id))
        .map(recommendation => toRecommendationInput(recommendation))
        .filter((recommendation) => !submittedKeys.has(recommendationInputKey(recommendation)));
    return [...submitted, ...hiddenHistory];
}

/**
 * Existing provenance wins over client input. Rejected manual work is equivalent to deleting it;
 * rejected generated work remains as hidden allocation memory.
 */
function reconcileSubmittedRecommendations(
    existing: ActivityAssignmentRecommendation[],
    submitted: RecommendationInput[],
): RecommendationInput[] {
    // Index persisted identities and semantic operations before selecting authoritative provenance for each submitted row.
    const byId = new Map(existing.map((recommendation) => [recommendation.id, recommendation]));
    const byKey = new Map(existing.map((recommendation) => [
        recommendationInputKey(toRecommendationInput(recommendation)),
        recommendation,
    ]));

    const resolved = submitted.map((recommendation): RecommendationInput => {
        const persisted = recommendation.id
            ? byId.get(recommendation.id)
            : byKey.get(recommendationInputKey(recommendation));
        const manual = persisted?.manual ?? Boolean(recommendation.manual);
        return {
            ...recommendation,
            id: persisted?.id ?? recommendation.id,
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
            && candidate.itemId === recommendation.sourceItemId
            && candidate.sourceItemId === recommendation.itemId);
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
        activityService.getActivitySlotAssignees(planId),
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
            const hasTarget = (assignees[recommendation.item.id] ?? [])
                .some((assignee) => assignee.profileId === recommendation.profile.id);
            const sourceSlotId = operation === "REASSIGN"
                ? recommendation.sourceItem?.id
                : operation === "UNASSIGN"
                    ? recommendation.item.id
                    : undefined;
            const hasSource = sourceSlotId
                ? (assignees[sourceSlotId] ?? []).some((assignee) => assignee.profileId === recommendation.profile.id)
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
        profileId: rec.profileId ?? null,
        status: rec.status,
        operation: rec.operation,
        sourceItemId: rec.sourceItem?.id ?? null,
        manual: rec.manual,
    }));

    const warnings = await collectRecommendationWarnings(planId, normalized, false);
    const eventParticipants = plan.event ? await eventService.getEventParticipants(plan.event.id) : [];
    const attendance = await buildParticipantAttendanceMap(
        plan,
        requirementConfig.overrides,
        assignments,
        normalized,
        eventParticipants,
    );

    // Attendance also describes committed historical work. Restrict the manual picker
    // to the same current-event policy used by validation and automatic generation.
    const registeredProfileIds = new Set(eventParticipants.map((participant) => participant.profileId));
    const restrictToRegistered = Boolean(plan.eventId) && !plan.allowExternalAssignees;
    function isSelectableParticipant(participant: ParticipantAttendance): boolean {
        return !restrictToRegistered || Boolean(participant.profileId && registeredProfileIds.has(participant.profileId));
    }
    const participants = Object.values(attendance).filter(isSelectableParticipant).map((participant) => ({
        key: toParticipantKey(participant),
        profileId: participant.profileId ?? null,
        label: toParticipantName(participant),
        ...(includeNameProvenance ? {nameIsFallback: !participant.name} : {}),
        arrivalDate: participant.arrivalDate ?? null,
        departureDate: participant.departureDate ?? null,
    }));

    const slotOptions = slots.map((slot) => ({
        id: slot.id,
        title: slot.title,
        day: slot.day,
        startTime: slot.startTime,
        endTime: slot.endTime,
    }));
    const slotById = new Map(slotOptions.map((slot) => [slot.id, slot]));
    const existingAssignmentOptions = Object.entries(assignees).flatMap(([slotId, slotAssignees]) => {
        // A concurrently absent slot cannot provide an actionable assignment option.
        const item = slotById.get(slotId);
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
 * Resolve provenance and review states once for preview and application. Existing generated
 * rows cannot become manual merely because a submitted payload changes its manual flag.
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
            && candidate.operation === 'REASSIGN' && candidate.itemId === recommendation.sourceItemId
            && candidate.sourceItemId === recommendation.itemId);
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

