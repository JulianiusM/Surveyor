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

import {generateFairRecommendations} from './fairAssignment';
import {saveGeneratedRecommendations, buildPlanRecommendationContext} from './recommendationPersistence';
import {collectRecommendationWarnings} from './warningOperations';
import {requireRequirementConfiguration} from './context';
import type {AutoAssignmentContext, RecommendationInput} from '../../../types/ActivityTypes';
import {RecommendationJobCoordinator, RecommendationQueueFullError, fingerprintRecommendationContext} from './recommendationJobs';
import {countInclusiveDays, hasCompleteStayRequirements} from '../../../common/activity/requirements';
import {ActivityAssignmentRecommendation} from '../database/entities/activity/ActivityAssignmentRecommendation';
import * as recommendationService from '../database/services/ActivityRecommendationService';
import * as activityService from '../database/services/ActivityService';
import {APIError} from '../lib/errors';

// Background persistence and HTTP edits consume the same locked feature operation.
// The coordinator performs scheduling/cache work and never chooses a database write policy.
const recommendationJobCoordinator = new RecommendationJobCoordinator({
    loadContext: loadRecommendationJobContext,
    persist: saveGeneratedRecommendations,
});

/** Recheck generation eligibility when a queued job actually begins. */
async function loadRecommendationJobContext(planId: string): Promise<AutoAssignmentContext> {
    // Queue waiting does not preserve an earlier assignment mode or input set.
    const context = await buildPlanRecommendationContext(planId);
    if (context.plan.assignmentMode === 'FREE') {
        throw new APIError('Automatic recommendations are disabled in free assignment mode', {planId}, 409, {cause: 'ACTIVITY_RECOMMENDATIONS_DISABLED'});
    }
    return context;
}

/**
 * Used under the plan lock after validation by relationship/date mutations. A later rollback
 * may conservatively cancel an in-flight calculation, but never changes saved assignments.
 */
export function invalidateEventContext(planId: string): void {
    recommendationJobCoordinator.invalidate(planId);
}

/** Shared by synchronous generation and post-application refresh; jobs use the same persistence guard. */
export async function generateAndSaveRecommendations(planId: string, existing: ActivityAssignmentRecommendation[]): Promise<RecommendationInput[]> {
    // Capture the saved input identity before computing recommendations outside the write transaction.
    const context = await buildPlanRecommendationContext(planId, existing);
    const fingerprint = fingerprintRecommendationContext(context);
    const recommendations = generateFairRecommendations(context);
    // Reject stale computation before entering persistence, which repeats this guard under its own locks.
    const freshContext = await buildPlanRecommendationContext(planId);
    if (fingerprintRecommendationContext(freshContext) !== fingerprint) {
        throw new APIError('Plan inputs changed while recommendations were being calculated', {}, 409, {cause: 'ACTIVITY_CONTEXT_CHANGED'});
    }
    // Persist against the exact event/date context and input fingerprint used by this calculation.
    await saveGeneratedRecommendations(planId, recommendations, {
        eventId: context.plan.eventId ?? null,
        startDate: context.plan.startDate,
        endDate: context.plan.endDate,
        inputFingerprint: fingerprint,
    });
    return recommendations;
}

/** Generate immediately from eligible saved requirements, preserving prior rejection memory and warning policy. */
export async function autoGenerateRecommendations(planId: string) {
    // Validate saved mode and complete stay requirements before loading history or running the algorithm.
    const plan = await activityService.getActivityPlanById(planId);
    if (!plan) {
        throw new APIError('Activity plan not found', {planId}, 404);
    }
    if (plan.assignmentMode === "FREE") {
        throw new APIError('Automatic recommendations are disabled in free assignment mode', {planId}, 409, {cause: 'ACTIVITY_RECOMMENDATIONS_DISABLED'});
    }
    const requirementConfig = await requireRequirementConfiguration(planId);
    const planDays = countInclusiveDays(plan.startDate, plan.endDate);
    if (!hasCompleteStayRequirements(planDays, requirementConfig.stayRequirements)) {
        throw new APIError(
            `Automatic recommendations need saved stay-duration requirements for days 1 through ${planDays}`,
            {planId},
            409,
            {cause: 'ACTIVITY_GENERATION_REQUIREMENTS_INCOMPLETE'},
        );
    }

    // IMPORTANT: Load existing recommendations BEFORE generating
    // This preserves rejection memory for the algorithm
    const existingRecommendations = await recommendationService.getRecommendations(planId);

    // Generate with rejection memory
    const recommendations = await generateAndSaveRecommendations(planId, existingRecommendations);

    const warnings = await collectRecommendationWarnings(planId, recommendations);
    return {message: 'Recommendations generated', warnings};
}

/** Admit explicit generation against saved requirements before enqueueing any work. */
export async function queueAutoGenerateRecommendations(planId: string) {
    // Free assignment and incomplete stay requirements cannot start a useful job.
    const plan = await activityService.getActivityPlanById(planId);
    if (!plan) throw new APIError('Activity plan not found', {planId}, 404);
    if (plan.assignmentMode === "FREE") {
        throw new APIError('Automatic recommendations are disabled in free assignment mode', {planId}, 409, {cause: 'ACTIVITY_RECOMMENDATIONS_DISABLED'});
    }
    const requirementConfig = await requireRequirementConfiguration(planId);
    const planDays = countInclusiveDays(plan.startDate, plan.endDate);
    if (!hasCompleteStayRequirements(planDays, requirementConfig.stayRequirements)) {
        throw new APIError(
            `Automatic recommendations need saved stay-duration requirements for days 1 through ${planDays}`,
            {planId},
            409,
            {cause: 'ACTIVITY_GENERATION_REQUIREMENTS_INCOMPLETE'},
        );
    }

    // The coordinator retains coalescing and queue capacity. Its trusted queue
    // failure carries the existing bounded retry advice rather than private text.
    try {
        const queued = recommendationJobCoordinator.enqueue(planId);
        return {
            message: queued.coalesced ? 'Recommendation job already queued' : 'Recommendation job queued',
            job: queued.job,
            coalesced: queued.coalesced,
        };
    } catch (error) {
        if (error instanceof RecommendationQueueFullError) {
            throw new APIError(error.message, {retryAfter: 5}, 503, {cause: error});
        }
        throw error;
    }
}

/** Disclose a process-local job only within its originating Activity plan. */
export async function getAutoRecommendationJob(planId: string, jobId: string) {
    // A cached job identifier never authorizes access to another plan's result.
    const job = recommendationJobCoordinator.get(jobId);
    if (!job || job.planId !== planId) {
        throw new APIError('Recommendation job not found', {planId, jobId}, 404);
    }
    return {job};
}

