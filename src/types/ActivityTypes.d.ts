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

import type {ActivityPlan} from '../backend/modules/database/entities/activity/ActivityPlan';
import type {ActivityPlanRequirement} from '../backend/modules/database/entities/activity/ActivityPlanRequirement';
import type {ActivityPlanRequirementOverride} from '../backend/modules/database/entities/activity/ActivityPlanRequirementOverride';
import type {ActivityPlanStayRequirement} from '../backend/modules/database/entities/activity/ActivityPlanStayRequirement';
import type {ActivitySlot} from '../backend/modules/database/entities/activity/ActivitySlot';
import type {ParticipantAttendance} from './ActivityRequirementTypes';
import type {components} from './api/v1';


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

export type SlotAssignmentMap = Record<string, SlotAssignee[]>;

/** The existing print-only slot projection; assigned count and attached roles remain required. */
export type ActivityPrintSlot = ActivitySlot & {
    assignedCount: number;
    assignees: SlotAssignee[];
    roles: {id: number; name: string}[];
};

/** One printed UTC day and its admitted schedule rows. */
export interface ActivityPrintDay {
    date: string;
    dayIndex: number;
    slots: ActivityPrintSlot[];
}

/** Monday-based print grouping without changing the original included-day range. */
export interface ActivityPrintWeek {
    start: string;
    days: ActivityPrintDay[];
}

/** Optional completion is prepared while the existing creation transaction can still roll back. */
export type ActivityCreationCompletion = (id: string) => void;

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
    operation: RecommendationOperation;
    sourceItemId?: string | null;
}


export interface RecommendationInput {
    id?: string;
    itemId: string;
    profileId?: string | null;
    status?: RecommendationStatus;
    operation?: RecommendationOperation;
    sourceItemId?: string | null;
    manual?: boolean;
    hidden?: boolean;
    /** Null is an explicit independent move; absent retains unknown legacy provenance. */
    swapGroup?: string | null;
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

/** The authored optional wire field supplies the finite completion identities. */
export type RecommendationGenerationOutcome = NonNullable<components['schemas']['ActivityRecommendationApplyResult']['generationOutcome']>;

/** Committed assignment evidence is projected before its transaction completes. */
export interface RecommendationApplicationSummary {
    message: string;
    applied: number;
    skipped: number;
    warnings: RecommendationWarningResult[];
}

/** Generation is a separate follow-up; its failure cannot reject this application. */
export interface RecommendationApplicationResult extends RecommendationApplicationSummary {
    generationOutcome: RecommendationGenerationOutcome;
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
    /** Availability only: these shifts belong to other plans and cannot satisfy local requirements. */
    linkedPlans?: ActivityLinkedPlanContext;
}

/** Attendance eligibility and boundary evidence shared by assignment warnings and allocation. */

export interface AttendanceCheck {
    allowed: boolean;
    boundary?: "arrival" | "departure" | "before" | "after";
}

export interface AttendancePolicy {
    allowArrivalDayEvening?: boolean;
    allowDepartureDayMorning?: boolean;
}

export interface FairAssignmentSlot {
    id: string;
    day: string;
    startTime?: string | null;
    endTime?: string | null;
    pos?: number | null;
    isArrivalEvening?: boolean | null;
    isDepartureMorning?: boolean | null;
    maxAssignees?: number | null;
    assignedCount?: number;
}

export interface FairAssignmentContext {
    plan: {
        assignmentMode: "FREE" | "REQUIRED";
        generalRequiredShifts?: number | null;
        roundingMode?: "CEIL" | "ROUND" | "FLOOR" | null;
        startDate: string;
        endDate: string;
        allowOverfillAfterFull?: boolean;
        allowArrivalDayEvening?: boolean;
        allowDepartureDayMorning?: boolean;
    };
    slots: FairAssignmentSlot[];
    participants: ParticipantAttendance[];
    roleRequirements: ActivityPlanRequirement[];
    overrides: ActivityPlanRequirementOverride[];
    stayRequirements: ActivityPlanStayRequirement[];
    existingAssignments: Record<string, AssignmentCandidate[]>;
    existingRecommendations?: RecommendationInput[];
    linkedPlans?: ActivityLinkedPlanContext;
}

export type RecommendationJobStatus = "QUEUED" | "RUNNING" | "COMPLETE" | "FAILED" | "STALE";

export interface RecommendationJobView {
    id: string;
    planId: string;
    status: RecommendationJobStatus;
    createdAt: string;
    updatedAt: string;
    recommendationCount?: number;
    error?: string;
}

export interface RecommendationJobCoordinatorOptions {
    loadContext: (planId: string) => Promise<AutoAssignmentContext>;
    execute?: (context: AutoAssignmentContext) => Promise<RecommendationInput[]>;
    persist: (planId: string, recommendations: RecommendationInput[], expected: ActivityRecommendationPersistenceContext) => Promise<void>;
    maxQueueSize?: number;
    maxCachedJobs?: number;
    cacheTtlMs?: number;
}

/** Plain inputs for recommendation warnings, shared by controllers and allocation. */

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

export interface SlotTimeboxCandidate {
    day: string;
    startTime?: string | null;
    endTime?: string | null;
    pos?: number | null;
}

export interface SlotTimebox {
    startMinutes: number | null;
    endMinutes: number | null;
}

/** Supported stored requirement settings; business admission stays with its operation owner. */

export type PlanRequirementSettings = Partial<Pick<
    ActivityPlan,
    |
    "assignmentMode"
    | "generalRequiredShifts"
    | "roundingMode"
    | "bindingDeadline"
    | "allowOverfillAfterFull"
    | "allowExternalAssignees"
    | "allowArrivalDayEvening"
    | "allowDepartureDayMorning"
>>;

export interface RequirementConfiguration {
    plan: Pick<
        ActivityPlan,
        | "id"
        | "assignmentMode"
        | "generalRequiredShifts"
        | "roundingMode"
        | "startDate"
        | "endDate"
        | "bindingDeadline"
        | "allowOverfillAfterFull"
        | "allowExternalAssignees"
        | "allowArrivalDayEvening"
        | "allowDepartureDayMorning"
    >;
    roleRequirements: ActivityPlanRequirement[];
    overrides: ActivityPlanRequirementOverride[];
    stayRequirements: ActivityPlanStayRequirement[];
}

/** Already loaded inputs for the shared asynchronous requirement context.
 * Each controller retains its own initial read set and supplies its manager explicitly. */
export interface ActivityRequirementPreparationInputs {
    plan: ActivityPlan;
    configuration: RequirementConfiguration;
    assignments: Record<string, AssignmentCandidate[]>;
    slots: ActivitySlot[];
    slotRoles: Record<string, {id: number; maxQty: number; assignedQty: number}[]>;
}

export type RecommendationStatus = "PENDING" | "APPROVED" | "APPLIED" | "REJECTED";

export type RecommendationOperation = "ASSIGN" | "REASSIGN" | "UNASSIGN";
