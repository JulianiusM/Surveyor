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

import {requireRequirementConfiguration, requireRecommendationContext, buildLinkedPlanContext} from './context';
import type {AutoAssignmentContext, AutoAssignmentSlot, RecommendationInput} from '../../../types/ActivityTypes';
import type {EntityManager} from 'typeorm';
import type {ActivityAssignment} from '../database/entities/activity/ActivityAssignment';
import {mergeParticipants, participantsFromAssignments} from './autoAssignment';
import {normalizeRecommendationInput} from './recommendations';
import {fingerprintRecommendationContext} from './recommendationJobs';
import {toParticipantKey} from '../../../common/activity/requirements';
import {ActivityAssignmentRecommendation} from '../database/entities/activity/ActivityAssignmentRecommendation';
import {ActivityPlan} from '../database/entities/activity/ActivityPlan';
import * as recommendationService from '../database/services/ActivityRecommendationService';
import * as activityService from '../database/services/ActivityService';
import * as eventService from '../database/services/EventService';
import {APIError} from '../lib/errors';
import type {ActivityRecommendationContext, ActivityRecommendationOperationInput, ActivityRecommendationPersistenceContext} from '../../../types/ActivityTypes';

/** Preserve saved row identity for review; context memory deliberately excludes it from allocation fingerprints. */
export function toRecommendationInput(recommendation: ActivityAssignmentRecommendation,
    identity: 'saved' | 'memory' = 'saved'): RecommendationInput {
    // Populate one fresh result in original property order. Memory never reads or inserts a saved row ID.
    const input = (identity === 'memory' ? {} : {id: recommendation.id}) as RecommendationInput;
    input.itemId = recommendation.item.id;
    input.profileId = recommendation.profile.id;
    input.status = recommendation.status;
    input.operation = recommendation.operation;
    input.sourceItemId = recommendation.sourceItem?.id ?? null;
    input.manual = recommendation.manual;
    input.hidden = recommendation.hidden;
    return input;
}

/** Validation belongs at the command boundary, including generated internal commands. */
export function normalizeRecommendationForPersistence(input: RecommendationInput): RecommendationInput {
    if (!input.itemId || !input.profileId) throw new APIError('Recommendation requires a slot and profile', input, 400);
    if (input.operation === 'REASSIGN' && (!input.sourceItemId || input.sourceItemId === input.itemId)) {
        throw new APIError('Reassignment requires a different source slot', input, 400, {cause: 'ACTIVITY_RECOMMENDATION_SOURCE_INVALID'});
    }
    return normalizeRecommendationInput(input);
}

/** Review commands recheck their original event/date context after acquiring the root lock. */
export async function saveReviewedRecommendations(
    planId: string, recommendations: RecommendationInput[], expected: ActivityRecommendationPersistenceContext,
): Promise<void> {
    const normalized = recommendations.map(normalizeRecommendationForPersistence);
    /** Revalidate relationship/date evidence under the owning transaction before replacing reviewed rows. */
    async function saveReviewed(manager: EntityManager): Promise<void> {
        // A concurrent relationship or date change must fail before any existing review history is replaced.
        await requireRecommendationContext(manager, planId, expected);
        await recommendationService.replaceRecommendations(planId, normalized, manager);
    }
    await activityService.withActivityTransaction(saveReviewed);
}

/**
 * Atomically reconciles generated work without erasing manual drafts or review history.
 * Only generated pending rows are replaceable. A participant/slot pair matching rejection memory is
 * re-exposed as rejected instead of being inserted as a new pending recommendation.
 */
export async function saveGeneratedRecommendations(
    planId: string,
    recommendations: RecommendationInput[],
    expected?: ActivityRecommendationPersistenceContext,
): Promise<void> {
    /** Reconcile generated candidates only after the locked context and optional input fingerprint still match. */
    async function saveGenerated(manager: EntityManager): Promise<void> {
        // Lock and validate first; no generated row is invalidated until its original input is confirmed current.
        await requireRecommendationContext(manager, planId, expected);
        if (expected?.inputFingerprint) {
            const current = await buildPlanRecommendationContext(planId, undefined, manager);
            if (fingerprintRecommendationContext(current) !== expected.inputFingerprint) {
                throw new APIError('Activity plan inputs changed; generate recommendations again', {reason: 'activity-context-changed'}, 409, {cause: 'ACTIVITY_CONTEXT_CHANGED'});
            }
        }
        const normalized = recommendations.map(normalizeRecommendationForPersistence);
        await recommendationService.invalidateGeneratedRecommendations(manager, planId);

        if (!normalized.length) return;
        const preserved = await recommendationService.getRecommendations(planId, manager);
        // Accepted/manual work is deduplicated by the complete operation. Rejection memory
        // deliberately uses only participant plus target slot: regenerating another kind of
        // suggestion for that same target must not silently undo the organizer's rejection.
        const preservedKeys = new Set(preserved
            .filter((row) => row.status !== "REJECTED")
            .map((row) => `${row.operation}:${row.sourceItem?.id ?? ""}:${row.item.id}:${row.profile.id}`));
        const rejectedByTarget = new Map(preserved
            .filter((row) => row.status === "REJECTED")
            .map((row) => [`${row.item.id}:${row.profile.id}`, row]));
        const rows: RecommendationInput[] = [];
        for (const recommendation of normalized) {
            const rejectedMemory = rejectedByTarget.get(`${recommendation.itemId}:${recommendation.profileId}`);
            if (rejectedMemory) {
                rows.push({
                    ...toRecommendationInput(rejectedMemory),
                    operation: recommendation.operation ?? "ASSIGN",
                    sourceItemId: recommendation.sourceItemId ?? null,
                    manual: false,
                    hidden: false,
                });
                continue;
            }
            if (preservedKeys.has(
                `${recommendation.operation}:${recommendation.sourceItemId ?? ""}:${recommendation.itemId}:${recommendation.profileId}`,
            )) continue;
            rows.push({...recommendation, id: undefined, status: 'PENDING', manual: false, hidden: false});
        }
        await recommendationService.saveRecommendations(planId, rows, manager);
    }
    await activityService.withActivityTransaction(saveGenerated);
}

/** The final persistence check needs the relationship and dates that this read actually used. */
export function recommendationContext(plan: Pick<ActivityPlan, 'eventId' | 'startDate' | 'endDate'>): ActivityRecommendationContext {
    return {eventId: plan.eventId ?? null, startDate: plan.startDate, endDate: plan.endDate};
}

/**
 * Assemble algorithm input at the controller boundary. Current registration and the explicit
 * external-assignee policy select participants; saved overrides contribute requirements only.
 * The worker receives values, never repositories or an independent authorization decision.
 */
export async function buildPlanRecommendationContext(
    planId: string,
    existingRecommendations?: ActivityAssignmentRecommendation[],
    manager?: EntityManager,
): Promise<AutoAssignmentContext> {
    if (!manager) {
        async function readContext(snapshot: EntityManager): Promise<AutoAssignmentContext> {
            return buildPlanRecommendationContext(planId, existingRecommendations, snapshot);
        }
        return activityService.withActivityReadSnapshot(readContext);
    }
    const [requirementConfig, plan, slots, existingAssignments, participantRoles] = await Promise.all([
        requireRequirementConfiguration(planId, manager),
        activityService.getActivityPlanById(planId, manager),
        activityService.getActivitySlotsFlat(planId, manager) as Promise<AutoAssignmentSlot[]>,
        activityService.getParticipantAssignmentsWithSlots(planId, manager),
        activityService.getParticipantRolesForPlan(planId, manager),
    ]);
    if (!plan) throw new APIError('Activity plan not found', {planId}, 404);

    existingRecommendations ??= await recommendationService.getRecommendations(planId, manager);
    const recommendationMemory = existingRecommendations.map(recommendation => toRecommendationInput(recommendation, 'memory'));
    const eventParticipants = plan.event
        ? await eventService.getEventParticipants(plan.event.id, manager)
        : [];
    const participants = mergeParticipants(
        eventParticipants.map((participant) => ({
            profileId: participant.profileId ?? undefined,
            arrivalDate: participant.arrivalDate ?? undefined,
            departureDate: participant.departureDate ?? undefined,
            name: participant.name ?? undefined,
        })),
        // Existing external assignees remain eligible only under the plan's established
        // external policy (or for a standalone plan). Retained overrides are requirements,
        // never an independent source of participants after a relationship changes.
        !plan.event || plan.allowExternalAssignees ? participantsFromAssignments(existingAssignments) : [],
    );
    const participantByKey = new Map(participants.map((participant) => [toParticipantKey(participant), participant]));
    for (const participantRole of participantRoles) {
        const participant = participantByKey.get(participantRole.participantKey);
        if (participant) participant.roleIds = participantRole.roleIds;
    }

    return {
        plan: {
            eventId: plan.eventId ?? null,
            allowExternalAssignees: plan.allowExternalAssignees,
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
        linkedPlans: await buildLinkedPlanContext(plan, manager),
    };
}

/**
 * Applies a reviewed recommendation batch atomically. Reassignments release all
 * source slots before capacity is checked for their targets, which also makes a
 * two-row swap safe regardless of row order.
 */
export async function applyActivityRecommendationOperations(
    planId: string,
    operations: ActivityRecommendationOperationInput[],
    expected?: ActivityRecommendationContext,
    manager?: EntityManager,
): Promise<void> {
    if (operations.length === 0) return;

    async function applyOperations(manager: EntityManager): Promise<void> {
        const plan = await requireRecommendationContext(manager, planId, expected);

        const referencedSlotIds = [...new Set(operations.flatMap((operation) => [
            operation.itemId,
            ...(operation.sourceItemId ? [operation.sourceItemId] : []),
        ]))];
        const slots = await activityService.getLockedActivitySlots(manager, referencedSlotIds);
        if (slots.length !== referencedSlotIds.length || slots.some((slot) => slot.entityId !== planId)) {
            throw new APIError("Recommendation slot does not belong to this activity plan", {planId}, 400, {cause: 'ACTIVITY_RECOMMENDATION_TARGET_INVALID'});
        }
        const slotById = new Map(slots.map((slot) => [slot.id, slot]));

        const assignments = await activityService.getLockedPlanAssignments(manager, planId);
        function pairKey(itemId: string, profileId: string): string {
            return `${itemId}:${profileId}`;
        }
        const assignmentByPair = new Map(
            assignments.map((assignment) => [pairKey(assignment.item.id, assignment.profile.id), assignment]),
        );
        // Retained drafts can name profiles from a former event. Recheck eligibility using
        // the now-locked relationship; saved overrides alone never authorize an assignment.
        if (plan.eventId) {
            const allowedProfiles = new Set(await activityService.getRegisteredProfileIds(manager, plan.eventId));
            if (plan.allowExternalAssignees) {
                for (const assignment of assignments) allowedProfiles.add(assignment.profile.id);
            }
            for (const operation of operations) {
                if (!allowedProfiles.has(operation.profileId)) {
                    throw new APIError('Recommendations must target participants registered for this event', operation, 400, {cause: 'ACTIVITY_RECOMMENDATION_PARTICIPANT_REQUIRED'});
                }
            }
        }
        const removals = new Map<number, ActivityAssignment>();
        const additions: ActivityRecommendationOperationInput[] = [];
        const additionPairs = new Set<string>();

        for (const operation of operations) {
            const targetPair = pairKey(operation.itemId, operation.profileId);
            if (operation.operation === "ASSIGN") {
                if (assignmentByPair.has(targetPair) || additionPairs.has(targetPair)) {
                    throw new APIError("Participant is already assigned to the recommendation slot", operation, 409, {cause: 'ACTIVITY_RECOMMENDATION_ALREADY_ASSIGNED'});
                }
                additionPairs.add(targetPair);
                additions.push(operation);
                continue;
            }

            const sourceItemId = operation.operation === "REASSIGN"
                ? operation.sourceItemId
                : operation.itemId;
            if (!sourceItemId) {
                throw new APIError("Reassignment requires a source slot", operation, 400, {cause: 'ACTIVITY_RECOMMENDATION_SOURCE_INVALID'});
            }
            const source = assignmentByPair.get(pairKey(sourceItemId, operation.profileId));
            if (!source) {
                throw new APIError("Recommendation source assignment no longer exists", operation, 409, {cause: 'ACTIVITY_RECOMMENDATION_SOURCE_MISSING'});
            }
            if (removals.has(source.id)) {
                throw new APIError("An assignment can only be changed once per recommendation batch", operation, 409, {cause: 'ACTIVITY_RECOMMENDATION_CHANGE_DUPLICATE'});
            }

            if (operation.operation === "REASSIGN") {
                if (sourceItemId === operation.itemId) {
                    throw new APIError("Reassignment target must differ from its source", operation, 400, {cause: 'ACTIVITY_RECOMMENDATION_SOURCE_INVALID'});
                }
                if (source.activityAssignmentRoles.some(({role}) => !role.isDefault)) {
                    throw new APIError("Assignments with named roles cannot be automatically reassigned", operation, 409, {cause: 'ACTIVITY_RECOMMENDATION_NAMED_ROLE'});
                }
                if (assignmentByPair.has(targetPair) || additionPairs.has(targetPair)) {
                    throw new APIError("Participant is already assigned to the recommendation slot", operation, 409, {cause: 'ACTIVITY_RECOMMENDATION_ALREADY_ASSIGNED'});
                }
                additionPairs.add(targetPair);
                additions.push(operation);
            }
            removals.set(source.id, source);
        }

        const projectedCounts = new Map<string, number>();
        // Calculate final occupancy before any write. Removing every source first permits
        // reciprocal moves between full slots; validating additions against the original
        // occupancy would wrongly reject those swaps or make the result depend on row order.
        for (const assignment of assignments) {
            if (!removals.has(assignment.id)) {
                projectedCounts.set(assignment.item.id, (projectedCounts.get(assignment.item.id) ?? 0) + 1);
            }
        }
        for (const addition of additions) {
            const target = slotById.get(addition.itemId)!;
            const count = projectedCounts.get(target.id) ?? 0;
            if (!plan.allowOverfillAfterFull && target.maxAssignees != null && count >= target.maxAssignees) {
                throw new APIError("This activity slot is already full", addition, 409, {cause: 'ACTIVITY_FULL'});
            }
            projectedCounts.set(target.id, count + 1);
        }

        // Only the controller decides which removals/additions are valid. The DBAL receives
        // the resulting write set and applies it in this still-locked transaction.
        const rows: {itemId: string; profileId: string; roleId: number}[] = [];
        if (additions.length) {
            const [defaultRole] = await activityService.ensureRoleId(planId, 'default', true, undefined, manager);
            for (const addition of additions) rows.push({...addition, roleId: defaultRole.id});
        }
        await activityService.writeAssignmentChanges(manager, planId, [...removals.keys()], rows);
    }
    if (manager) await applyOperations(manager);
    else await activityService.withActivityTransaction(applyOperations);
}

