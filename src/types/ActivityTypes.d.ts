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

export type SlotAssignmentRow = {
    assignmentId: number;
    itemId: string;
    name: string;
    profileId: string;
    roles: string | null;
};

export type SlotAssignee = {
    id: number;
    profileId: string;
    name: string;
    roles: string[];
};

export type PlanParticipantRow = {
    name: string;
    count: number;
    roles: string;
}

export type PlanParticipant = {
    name: string;
    count: number;
    roles: string[];
};

export type SlotAssignmentMap = Record<string, SlotAssignee[]>;

/** Only root properties accepted by the activity property editor; omission preserves saved values. */
export interface ActivityPropertyPatch {
    title?: string;
    description?: string | null;
    startDate?: string;
    endDate?: string;
}

/** Relationship and dates used when computing work that must be checked under the plan write lock. */
export interface ActivityRecommendationContext {
    eventId: string | null;
    startDate: string;
    endDate: string;
}

/** Optional in-process freshness check for a job invalidated while it waited for the database lock. */
export interface ActivityRecommendationPersistenceContext extends ActivityRecommendationContext {
    isCurrent?: () => boolean;
    /** Compare every calculation input again after the event/plan locks have been acquired. */
    inputFingerprint?: string;
}

export interface ActivityRecommendationOperationInput {
    itemId: string;
    profileId: string;
    operation: import("../modules/database/entities/activity/ActivityAssignmentRecommendation").RecommendationOperation;
    sourceItemId?: string | null;
}


export interface RecommendationInput {
    id?: string;
    itemId: string;
    profileId?: string | null;
    status?: import("../modules/database/entities/activity/ActivityAssignmentRecommendation").RecommendationStatus;
    operation?: import("../modules/database/entities/activity/ActivityAssignmentRecommendation").RecommendationOperation;
    sourceItemId?: string | null;
    manual?: boolean;
    hidden?: boolean;
}

/** A time commitment. Linked-plan provenance never contributes to the current plan's shift count. */
export interface AssignmentCandidate {
    id: string;
    day: string;
    startTime?: string | null;
    endTime?: string | null;
    pos?: number | null;
    isArrivalEvening?: boolean | null;
    isDepartureMorning?: boolean | null;
    hasNamedRole?: boolean;
    planId?: string;
    planTitle?: string;
    title?: string;
    assignmentMode?: 'FREE' | 'REQUIRED';
    recommendationId?: string;
    recommendationStatus?: RecommendationInput['status'];
    operation?: RecommendationInput['operation'];
    sourceItemId?: string | null;
}

/** All saved sibling commitments, including active proposals, in the requested plan's event. */
export interface ActivityLinkedPlanContext {
    plans: Array<{id: string; assignmentMode: 'FREE' | 'REQUIRED'; startDate: string; endDate: string}>;
    commitments: Record<string, AssignmentCandidate[]>;
}

export type AssignmentWarningType =
    | 'ineligible_participant'
    | 'outside_attendance'
    | 'arrival_day'
    | 'departure_day'
    | 'arrival_time_restricted'
    | 'departure_time_restricted'
    | 'overlap'
    | 'over_capacity';

/** Controllers redact foreign-slot details before this shared contract crosses the HTTP boundary. */
export interface AssignmentWarning {
    type: AssignmentWarningType;
    conflicts?: string[];
    overlapDetails?: AssignmentCandidate[];
    /** The local timebox binds acknowledgement to the placement the organizer reviewed. */
    overlapTarget?: AssignmentCandidate;
    confirmable?: boolean;
    requiredPriority?: boolean;
}

export interface RecommendationWarningResult {
    recommendation: RecommendationInput;
    warnings: AssignmentWarning[];
}

/** The opaque confirmation describes the observed overlaps, not a blanket permission to bypass checks. */
export interface AssignmentWarningPreview {
    warnings: AssignmentWarning[];
    overlapConfirmation?: string;
}

export interface RecommendationWarningPreview {
    warnings: RecommendationWarningResult[];
    overlapConfirmation?: string;
}

/** A manual operation selected in the existing recommendation modal. */
export interface RecommendationModalRequest {
    targetSlotId: string;
    operation: 'ASSIGN' | 'REASSIGN' | 'SWAP';
    profileId: string;
    sourceItemId?: string;
    swapProfileId?: string;
}
