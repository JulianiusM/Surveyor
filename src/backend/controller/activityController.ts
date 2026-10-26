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

// controllers/activityController.js
import {Request} from "express";
import crypto from 'node:crypto';
import type {EntityManager} from "typeorm";
import type {ActivityAssignment} from "../modules/database/entities/activity/ActivityAssignment";
import {
    applyEntityAdministrator, archiveEntity, assertEntityPropertyContext, comparisonToken, completeDefaults,
    entityMethodPermission, entityPropertyPermission, entityTag, getArchivePresentations, getAuthorizedEventUrl,
    getEntityPropertyPresentation, getEntityViewAdmission, getEntityResourceEntry, getEntityCreationAdmission,
    getEntityCreationContext, permissionDefaultComparisonValues, readEntityPermissionDefaults,
    updateEntityPermissionDefaults, readEntityAdministratorBaseline, reviewEntityAdministrator,
    requireVersionedAdministratorOutcome, permissionDefinitions, projectCurrentEntityEvent, projectGuestEntry,
    requireEntityCreation, requireFieldComparison, restoreEntity, changeEntityEvent, setAutomaticArchival,
} from './entityAdminController';
import {authorizeEventLink, getEventLinkOptions, readEventLinkSelection} from './eventController';
import {ApiProblem} from '../modules/api/problem';
import {checkNewImage, removeImage} from '../modules/lib/fileCommons';
import * as adminService from '../modules/database/services/EntityAdminService';
import {getHeaderImageVersion} from '../modules/lib/util';
import {civilDateWeeks} from '../../common/lib/civilDate';
import type {components} from '../../types/api/v1';
import type {ActivityCommandPreparation, ActivityPropertyTransportContext, ActivitySlotAdmission} from '../../types/ActivityV1Types';
// Business logic for the Activity routes
import Joi from 'joi';
import {generateAutoRecommendations, mergeParticipants, participantsFromAssignments} from "../modules/activity/autoAssignment";
import type {AutoAssignmentContext, AutoAssignmentSlot} from "../modules/activity/autoAssignment";
import {collectAssignmentWarnings, toAssignmentCandidate} from "../modules/activity/availability";
import {buildRecommendationWarnings, normalizeRecommendationInput} from "../modules/activity/recommendations";
import {
    RecommendationJobCoordinator,
    RecommendationQueueFullError,
    fingerprintRecommendationContext,
    type RecommendationJobView,
} from "../modules/activity/recommendationJobs";
import type {ParticipantAttendance, RequirementOverrideInput} from "../../types/ActivityRequirementTypes";
import {calculateBaselineRequirementForPlan, calculateParticipantRequirement, calculateRequirementAnalysis, countInclusiveDays, hasCompleteStayRequirements, toParticipantKey, toParticipantName} from "../../common/activity/requirements";
import {
    ActivityAssignmentRecommendation,
    RecommendationOperation,
    RecommendationStatus
} from "../modules/database/entities/activity/ActivityAssignmentRecommendation";
import {ActivityPlan} from "../modules/database/entities/activity/ActivityPlan";
import {ActivitySlot} from "../modules/database/entities/activity/ActivitySlot";
import * as recommendationService from "../modules/database/services/ActivityRecommendationService";
import {RecommendationInput} from "../modules/database/services/ActivityRecommendationService";
import * as requirementService from "../modules/database/services/ActivityRequirementService";
import * as activityService from "../modules/database/services/ActivityService";
import * as eventService from "../modules/database/services/EventService";
import * as userService from "../modules/database/services/UserService";
import {APIError, ValidationError} from '../modules/lib/errors';
import {performImageSwap} from "../modules/lib/fileCommons";

import {ENTITIES, fromISOtoLocal, generateUniqueId} from '../modules/lib/util';
import {buildPermBundle, evaluateEntities, evaluateSubject, isOwner, saveDefaultPermsFromBody} from "../modules/permissionEngine";
import type {
    ActivityCreationCompletion, ActivityLinkedPlanContext, ActivityPropertyPatch, ActivityRecommendationContext,
    ActivityRecommendationOperationInput, ActivityRecommendationPersistenceContext,
    AssignmentCandidate, AssignmentWarning, AssignmentWarningPreview,
    RecommendationWarningResult, RecommendationWarningPreview, SlotAssignee,
} from "../../types/ActivityTypes";
import type {PermBundle, PermView, PermType, PermissionFieldRule, SessionLike} from "../../types/PermissionTypes";
import type {EntityBase} from "../../types/UserTypes";

/** Controllers translate a missing DBAL snapshot into the established API response. */
async function requireRequirementConfiguration(planId: string, manager?: EntityManager): Promise<requirementService.RequirementConfiguration> {
    const configuration = await requirementService.getRequirementConfiguration(planId, manager);
    if (!configuration) throw new APIError('Activity plan not found', {planId}, 404);
    return configuration;
}

/**
 * Decisions are made after acquiring the root lock, not between separate service transactions.
 * The process-local callback detects jobs invalidated while they wait for that lock.
 */
async function requireRecommendationContext(
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

// The controller wires background persistence to the same command boundary as HTTP edits.
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

// Template constant for create errors
const CREATE_TEMPLATE = 'activity/activity-create';

// The accepted shared field grants/fallbacks have one controller-owned
// declaration. Direct writes and the new baseline/capability projections adopt it.
const activitySlotFieldPermissions: Record<keyof components['schemas']['ActivitySlotPatch'], PermissionFieldRule> = {
    startTime: {permission: 'EDIT_META', parent: ['ITEM_EDIT', 'ITEM_EDIT_META']},
    endTime: {permission: 'EDIT_META', parent: ['ITEM_EDIT', 'ITEM_EDIT_META']},
    title: {permission: 'EDIT_TITLE', parent: 'ITEM_EDIT'},
    description: {permission: 'EDIT_DESC', parent: ['ITEM_EDIT', 'ITEM_EDIT_DESC']},
    maxAssignees: {permission: 'EDIT_CAPACITY', parent: 'ITEM_EDIT'},
    roles: {permission: 'MANAGE_ASSIGNMENTS', parent: 'MANAGE_ASSIGNMENTS'},
};

/**
 * Validate and sanitize creation payload.
 * Throws ValidationError on failure; returns sanitized plan data on success.
 */

function preprocessCreate(body: any): Partial<ActivityPlan> & { slots: Partial<ActivitySlot>[] } {
    // Parse JSON slots object
    let slotsByDate = {};
    try {
        slotsByDate = JSON.parse(body.slots || '{}');
    } catch {
        throw new ValidationError(CREATE_TEMPLATE, 'Invalid slots JSON', {body});
    }

    // Define Joi schema for body & slots
    const timePattern = /^\d{2}:\d{2}(?::\d{2})?$/;

    const slotSchema = Joi.object({
        id: Joi.string().guid({version: ['uuidv4', 'uuidv5']}).required(),
        day: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
        pos: Joi.number().integer().required(),
        title: Joi.string().max(255).required(),
        description: Joi.string().allow(''),
        startTime: Joi.string().pattern(timePattern).allow(null),
        endTime: Joi.string().pattern(timePattern).allow(null),
        maxAssignees: Joi.number().integer().min(1).required()
    }).custom((value, helpers) => {
        if (value.startTime && value.endTime && value.startTime >= value.endTime) {
            return helpers.error('any.custom', {message: 'Slot end time must be after start time'});
        }
        return value;
    });

    const schema = Joi.object({
        title: Joi.string().required(),
        startDate: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
        endDate: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
        description: Joi.string().max(16000).allow('').required(),
        slots: Joi.object().pattern(
            /^\d{4}-\d{2}-\d{2}$/, Joi.array().items(slotSchema)
        ).min(1).required(),
        event_id: Joi.string().uuid().allow('').optional(),
    });

    // Validate combined payload
    const {error, value} = schema.validate(
        {...body, slots: slotsByDate},
        {abortEarly: false, allowUnknown: true}
    );
    if (error) {
        const msg = error.details.map((d: any) => d.message).join(', ');
        throw new ValidationError(CREATE_TEMPLATE, msg, {body});
    }

    // Flatten slots arrays and return sanitized data
    const flattenedSlots: Partial<ActivitySlot>[] = Object.values(value.slots).flat().map((slot: any) => ({
        id: slot.id,
        day: slot.day,
        pos: slot.pos,
        title: slot.title,
        description: slot.description ?? null,
        maxAssignees: slot.maxAssignees,
        startTime: slot.startTime ?? null,
        endTime: slot.endTime ?? null,
    }));

    // Ensure each slot date is within the start/end range
    const startDate = fromISOtoLocal(value.startDate);
    const endDate = fromISOtoLocal(value.endDate);
    for (const slot of flattenedSlots) {
        const slotDate = fromISOtoLocal(slot.day!);
        if (slotDate < startDate || slotDate > endDate) {
            throw new ValidationError(CREATE_TEMPLATE, `Slot date ${slot.day} outside range`, {body});
        }
    }

    return {
        title: value.title,
        description: value.description || null,
        startDate: value.startDate,
        endDate: value.endDate,
        slots: flattenedSlots,
        eventId: value.event_id || null,
    };
}

function preprocessRequirementUpdate(body: any) {
    const roleRequirementSchema = Joi.object({
        roleId: Joi.number().integer().positive().required(),
        requiredShifts: Joi.number().integer().min(0).required(),
    });

    const stayRequirementSchema = Joi.object({
        stayDays: Joi.number().integer().positive().required(),
        requiredShifts: Joi.number().integer().min(0).required(),
    });

    const overrideSchema = Joi.object({
        id: Joi.number().integer().positive().optional(),
        roleId: Joi.number().integer().positive().allow(null),
        profileId: Joi.string().uuid().required(),
        requiredShifts: Joi.number().integer().min(0).required(),
    });

    const schema = Joi.object({
        assignmentMode: Joi.string().valid("FREE", "REQUIRED").optional(),
        generalRequiredShifts: Joi.number().integer().min(0).allow(null).optional(),
        roundingMode: Joi.string().valid("CEIL", "ROUND", "FLOOR").allow(null).optional(),
        bindingDeadline: Joi.alternatives()
            .try(Joi.date().iso(), Joi.string().allow(null, ""))
            .optional()
            .custom((value, helpers) => {
                if (typeof value === "string" && value.trim() === "") {
                    return null;
                }
                return value;
            }),
        allowOverfillAfterFull: Joi.boolean().optional(),
        allowExternalAssignees: Joi.boolean().optional(),
        allowArrivalDayEvening: Joi.boolean().optional(),
        allowDepartureDayMorning: Joi.boolean().optional(),
        roleRequirements: Joi.array().items(roleRequirementSchema).default([]),
        stayRequirements: Joi.array().items(stayRequirementSchema).unique('stayDays').default([]),
        overrides: Joi.array().items(overrideSchema).default([]),
    });

    const {error, value} = schema.validate(body, {abortEarly: false, allowUnknown: true});
    if (error) {
        const msg = error.details.map((d: any) => d.message).join(', ');
        throw new APIError(msg, body, 400);
    }

    return value as {
        assignmentMode?: 'FREE' | 'REQUIRED';
        generalRequiredShifts?: number | null;
        roundingMode?: 'CEIL' | 'ROUND' | 'FLOOR' | null;
        bindingDeadline?: string | Date | null;
        allowOverfillAfterFull?: boolean;
        allowExternalAssignees?: boolean;
        allowArrivalDayEvening?: boolean;
        allowDepartureDayMorning?: boolean;
        roleRequirements: { roleId: number; requiredShifts: number }[];
        stayRequirements: { stayDays: number; requiredShifts: number }[];
        overrides: any[];
    };
}

function preprocessRecommendationUpdate(body: any) {
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

/**
 * Create activity plan and slots in a transaction.
 * @returns {Promise<string>} plan ID
 */

async function createEntity(
    ownerId: string,
    planData: Partial<ActivityPlan> & { slots: Partial<ActivitySlot>[] },
    complete?: ActivityCreationCompletion,
): Promise<string> {
    return await activityService.createActivityPlanTx(
        ownerId,
        planData.title!,
        planData.description!,
        planData.startDate!,
        planData.endDate!,
        planData.slots,
        planData.eventId,
        planData.headerImg,
        complete,
    );
}

// No-op since slots handled in transaction
const afterCreateItems = async (id: string, data: any) => {
    await saveDefaultPermsFromBody(ENTITIES.ACTIVITY, id, data._body);
};

/**
 * Assemble the shared saved schedule and participant analysis. Versioned callers
 * may request presentation provenance; standard projections keep their
 * established fields and English fallbacks without additional reads or effects.
 */

async function fetchForView(plan: ActivityPlan, req: Request, includeNameProvenance = false) {
    // Load the same schedule and independent participant/configuration inputs for
    // both renderers; name provenance never changes authority or membership.
    const slotsByDate = await activityService.getActivitySlots(plan.id);
    const session = req.session;

    const slotList = Object.values(slotsByDate).flat();

    const [
        assignments,
        assigneeLists,
        allRoles,
        slotRoles,
        requirementConfig,
        eventParticipants,
        participantRoles,
    ] = await Promise.all([
        activityService.getActivitySlotAssignments(plan.id, session.profile!.id),
        activityService.getActivitySlotAssignees(plan.id),
        activityService.getAllRoles(plan.id),
        activityService.getActivitySlotRoles(plan.id),
        requireRequirementConfiguration(plan.id),
        plan.event?.id ? eventService.getEventParticipants(plan.event.id) : Promise.resolve([]),
        activityService.getParticipantRolesForPlan(plan.id),
    ]);
    const textFields = await activityService.getActivityPlanTextFields(plan.id);

    let empty = 0, open = 0;

    for (const slot of slotList) {
        if (!slot) continue;
        if (slot.assignedCount === 0) empty++;
        if (slot.assignedCount < (slot.maxAssignees ?? 0)) open++;
    }

    const currentProfileId = session.profile!.id;
    const registration = eventParticipants.find((participant) => participant.profileId === currentProfileId);
    const canSelfAssign = !plan.event?.id || Boolean(registration) || Boolean(plan.allowExternalAssignees);
    const currentRoleIds = participantRoles.find(
        (participant) => participant.participantKey === `profile:${currentProfileId}`,
    )?.roleIds;
    const shouldShowRequirementProgress = canSelfAssign && (
        requirementConfig.plan.assignmentMode === "REQUIRED" || assignments.length > 0
    );

    const requirementProgress = shouldShowRequirementProgress
        ? (() => {
            const requirement = calculateParticipantRequirement(
                requirementConfig.plan,
                {
                    profileId: currentProfileId,
                    arrivalDate: registration?.arrivalDate ?? undefined,
                    departureDate: registration?.departureDate ?? undefined,
                    roleIds: currentRoleIds,
                    name: registration?.name,
                },
                requirementConfig.roleRequirements,
                requirementConfig.overrides,
                requirementConfig.stayRequirements,
            );
            const assignedShifts = assignments.length;
            const remainingShifts = Math.max(requirement.requiredShifts - assignedShifts, 0);
            return {
                assignedShifts,
                requiredShifts: requirement.requiredShifts,
                remainingShifts,
                complete: remainingShifts === 0,
            };
        })()
        : undefined;

    interface ParticipantStatusAccumulator {
        participantKey: string;
        profileId?: string;
        name: string;
        nameIsFallback: boolean;
        arrivalDate?: string | null;
        departureDate?: string | null;
        assignedShifts: number;
        roleIds: Set<number>;
        roles: Set<string>;
    }

    // Record whether a display name was manufactured before its origin is lost.
    // A later genuine assignee name replaces both the text and that provenance.
    const participantStatusMap = new Map<string, ParticipantStatusAccumulator>();
    /** Reuse one accumulator across registration and assignment sources. A real
     * later name replaces a fallback without losing the collected status. */
    const ensureParticipantStatus = (
        participantKey: string,
        profileId: string | null | undefined,
        name?: string | null,
    ): ParticipantStatusAccumulator => {
        const existing = participantStatusMap.get(participantKey);
        if (existing) {
            // Empty source values cannot erase an already known person's name.
            if (name) {
                existing.name = name;
                existing.nameIsFallback = false;
            }
            return existing;
        }

        // Preserve controller wording while retaining its origin for the Vue DTO.
        const created: ParticipantStatusAccumulator = {
            participantKey,
            profileId: profileId ?? undefined,
            name: name || 'Participant',
            nameIsFallback: !name,
            assignedShifts: 0,
            roleIds: new Set<number>(),
            roles: new Set<string>(),
        };
        participantStatusMap.set(participantKey, created);
        return created;
    };

    eventParticipants.forEach((participant) => {
        const participantKey = participant.profileId
            ? `profile:${participant.profileId}`
            : `registration:${participant.id}`;
        const status = ensureParticipantStatus(participantKey, participant.profileId, participant.name);
        status.arrivalDate = participant.arrivalDate;
        status.departureDate = participant.departureDate;
    });

    Object.values(assigneeLists).flat().forEach((assignee) => {
        const participantKey = `profile:${assignee.profileId}`;
        const status = ensureParticipantStatus(participantKey, assignee.profileId, assignee.name);
        status.assignedShifts += 1;
        assignee.roles.forEach((role) => {
            if (role !== 'default') status.roles.add(role);
        });
    });

    const roleTitles = new Map(allRoles.map((role) => [Number(role.id), role.title]));
    participantRoles.forEach(({participantKey, roleIds}) => {
        const status = participantStatusMap.get(participantKey);
        if (!status) return;
        roleIds.forEach((roleId) => {
            status.roleIds.add(roleId);
            const title = roleTitles.get(roleId);
            if (title && title !== 'default') status.roles.add(title);
        });
    });

    const participantList = Array.from(participantStatusMap.values())
        .map((status) => {
            const requirement = calculateParticipantRequirement(
                requirementConfig.plan,
                {
                    profileId: status.profileId,
                    arrivalDate: status.arrivalDate,
                    departureDate: status.departureDate,
                    roleIds: [...status.roleIds],
                    name: status.name,
                },
                requirementConfig.roleRequirements,
                requirementConfig.overrides,
                requirementConfig.stayRequirements,
            );
            return {
                participantKey: status.participantKey,
                name: status.name,
                // Only the new transport needs the origin of this presentation.
                // Standard projections retain their exact established shape.
                ...(includeNameProvenance ? {nameIsFallback: status.nameIsFallback} : {}),
                count: status.assignedShifts,
                assignedShifts: status.assignedShifts,
                roles: [...status.roles].sort((a, b) => a.localeCompare(b)),
                roleIds: [...status.roleIds],
                requiredShifts: requirement.requiredShifts,
                remainingShifts: Math.max(requirement.requiredShifts - status.assignedShifts, 0),
                source: requirement.source,
                attendanceDays: requirement.breakdown.attendanceDays,
                attendance: status.arrivalDate || status.departureDate
                    ? {arrivalDate: status.arrivalDate, departureDate: status.departureDate}
                    : undefined,
                assignmentMode: requirementConfig.plan.assignmentMode,
            };
        })
        .sort((a, b) => a.name.localeCompare(b.name));

    return {
        plan,
        slots: slotsByDate,
        assignments,
        assigneeLists,
        participantList,
        roles: {allRoles, slotRoles},
        counters: {participants: participantList.length, open, empty},
        requirementProgress,
        canSelfAssign,
        textFields,
    };
}

async function getScheduleExport(plan: ActivityPlan) {
    const [slotsByDate, assigneeLists, slotRoles, textFields, participantList] = await Promise.all([
        activityService.getActivitySlots(plan.id),
        activityService.getActivitySlotAssignees(plan.id),
        activityService.getActivitySlotRoles(plan.id),
        activityService.getActivityPlanTextFields(plan.id),
        activityService.getActivityPlanParticipants(plan.id),
    ]);

    const start = new Date(`${plan.startDate}T00:00:00Z`);
    const end = new Date(`${plan.endDate}T00:00:00Z`);

    const mapDayKey = (date: Date) => date.toISOString().slice(0, 10);
    const startOfWeek = (date: Date) => {
        const d = new Date(date);
        const weekday = d.getUTCDay();
        const diff = weekday === 0 ? -6 : 1 - weekday; // shift to Monday
        d.setUTCDate(d.getUTCDate() + diff);
        return d;
    };

    const dayMap = new Map<string, {
        date: string;
        dayIndex: number;
        slots: (ActivitySlot & {
            assignedCount: number;
            assignees: SlotAssignee[];
            roles: { id: number; name: string }[]
        })[]
    }>();

    for (let cur = new Date(start); cur <= end; cur.setUTCDate(cur.getUTCDate() + 1)) {
        const dayKey = mapDayKey(cur);
        const weekday = (cur.getUTCDay() + 6) % 7; // Monday = 0
        const slots = (slotsByDate[dayKey] || []).map((slot) => ({
            ...slot,
            assignees: assigneeLists[slot.id] || [],
            roles: slotRoles[slot.id] || [],
        }));

        dayMap.set(dayKey, {date: dayKey, dayIndex: weekday, slots});
    }

    const weeks: {
        start: string;
        days: {
            date: string;
            dayIndex: number;
            slots: (ActivitySlot & {
                assignedCount: number;
                assignees: SlotAssignee[];
                roles: { id: number; name: string }[]
            })[]
        }[]
    }[] = [];

    for (let weekStart = startOfWeek(start); weekStart <= end; weekStart.setUTCDate(weekStart.getUTCDate() + 7)) {
        const days: {
            date: string;
            dayIndex: number;
            slots: (ActivitySlot & {
                assignedCount: number;
                assignees: SlotAssignee[];
                roles: { id: number; name: string }[]
            })[]
        }[] = [];
        for (let i = 0; i < 7; i++) {
            const current = new Date(weekStart);
            current.setUTCDate(weekStart.getUTCDate() + i);
            const inRange = current >= start && current <= end;
            if (!inRange) continue;
            const dayKey = mapDayKey(current);
            const day = dayMap.get(dayKey) || {date: dayKey, dayIndex: i, slots: []};
            days.push(day);
        }

        if (days.length > 0) {
            weeks.push({start: mapDayKey(weekStart), days});
        }
    }

    const slotList = Array.from(dayMap.values()).flatMap((d) => d.slots);
    let empty = 0, open = 0;

    for (const slot of slotList) {
        if (slot.assignedCount === 0) empty++;
        if (slot.assignedCount < (slot.maxAssignees ?? 0)) open++;
    }

    return {
        plan,
        event: plan.event,
        days: Array.from(dayMap.values()),
        weeks,
        textFields,
        counters: {
            participants: participantList.length,
            slots: slotList.length,
            open,
            empty,
        },
        generatedAt: new Date().toISOString(),
    };
}

/**
 * Provide data for duplication form.
 */

async function fetchForDuplicate(plan: ActivityPlan, session: Request['session']) {
    return await activityService.getActivitySlots(plan.id);
}

/**
 * Delete plan if owned by current profile.
 */

async function deleteEntity(plan: ActivityPlan, session: Request['session']) {
    return await activityService.deleteActivityPlan(plan.id);
}

// ---------- API ----------
// API-specific controllers

/** Calendar dates remain DATE values; reject rollover dates rather than letting JavaScript normalize them. */
function validatePropertyDate(value: string, helpers: Joi.CustomHelpers): string | Joi.ErrorReport {
    const date = new Date(`${value}T00:00:00.000Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value || value < '1000-01-01') {
        return helpers.error('any.invalid');
    }
    return value;
}

/** Schema ownership stays with this feature; the shared API checks each supplied field's permission first. */
function normalizeActivityProperties(body: unknown): ActivityPropertyPatch {
    const date = Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).custom(validatePropertyDate);
    const schema = Joi.object<ActivityPropertyPatch>({
        title: Joi.string().trim().min(1).max(255),
        description: Joi.string().max(16000).allow('', null),
        startDate: date,
        endDate: date,
    }).min(1).unknown(false).required();
    const {error, value} = schema.validate(body, {abortEarly: false});
    if (error) throw new APIError(error.message, {}, 400);
    if (value.description === '') value.description = null;
    return value;
}

/**
 * Used under the plan lock after validation by relationship/date mutations. A later rollback
 * may conservatively cancel an in-flight calculation, but never changes saved assignments.
 */
function invalidateEventContext(planId: string): void {
    recommendationJobCoordinator.invalidate(planId);
}

async function updateProperties(plan: ActivityPlan, body: unknown): Promise<string> {
    const patch = normalizeActivityProperties(body);
    await saveActivityProperties(plan.id, patch, plan.eventId ?? null);
    return 'Activity plan updated';
}

async function updateDescription(planId: string, body: any, expectedEventId?: string | null) {
    const patch = normalizeActivityProperties({description: body?.description});
    if (patch.description === undefined) throw new APIError('Description is required', {}, 400);
    await saveActivityProperties(planId, patch, expectedEventId);
    return 'Description updated';
}

/**
 * Keep semantic date and parent-context checks beside property parsing. The DBAL callback
 * holds the root lock through those checks, generated-work invalidation and the final write;
 * concurrent slot creation takes the same lock before deciding whether its date is allowed.
 */
async function saveActivityProperties(planId: string, patch: ActivityPropertyPatch, expectedEventId?: string | null,
    transport?: ActivityPropertyTransportContext): Promise<components['schemas']['ActivityMetadata'] | void> {
    async function saveProperties(manager: EntityManager): Promise<components['schemas']['ActivityMetadata'] | void> {
        const plan = await requireRecommendationContext(manager, planId);
        assertEntityPropertyContext(plan, expectedEventId);
        // The v1 adapter adds current field authority and its reviewed baseline inside
        // this existing transaction. Direct callers retain their established checks.
        if (transport) {
            const permissions = await activityPermissions(plan, transport.session, manager);
            for (const field of Object.keys(patch) as Array<keyof ActivityPropertyPatch>) {
                if (!permissions.has(entityPropertyPermission('activity', field)!)) throw new ApiProblem('FORBIDDEN');
            }
            const baseline = activityMetadataProjection(plan, permissions);
            requireFieldComparison(transport.token, activityMetadataToken(plan, baseline, transport.session), Object.keys(patch));
        }
        const startDate = patch.startDate ?? plan.startDate;
        const endDate = patch.endDate ?? plan.endDate;
        if (startDate > endDate) throw new APIError('Start date must be before end date', {}, 400, {cause: 'ACTIVITY_DATE_RANGE_INVALID'});
        if (startDate !== plan.startDate || endDate !== plan.endDate) {
            if (await activityService.hasActivitySlotsOutsideRange(manager, planId, startDate, endDate)) {
                throw new APIError('The activity date range must include every saved slot', {}, 409, {cause: 'ACTIVITY_DATE_RANGE_EXCLUDES_ACTIVITIES'});
            }
            // Cancel while holding the lock: even a change back to the original dates
            // must invalidate a waiting job. Cancellation after rollback is conservative.
            invalidateEventContext(planId);
            await recommendationService.invalidateGeneratedRecommendations(manager, planId);
        }
        await activityService.updateActivityPlanProperties(planId, patch, manager);
        if (transport) {
            // Prepare the already-known resulting representation before commit; no
            // later projection or context admission can reject a successful write.
            const saved = Object.assign(plan, patch);
            const result = activityMetadataProjection(saved, await activityPermissions(saved, transport.session, manager));
            transport.prepare?.(result);
            return result;
        }
    }
    return activityService.withActivityTransaction(saveProperties);
}

/** Keep new and moved activities inside their current plan's inclusive date range. */
function validateSlotDate(plan: ActivityPlan, day?: string): void {
    // Callers repeat this comparison under the root lock before persistence.
    if (!day || day < plan.startDate || day > plan.endDate) {
        throw new APIError('Slot date must be within the activity plan date range', {}, 400, {cause: 'ACTIVITY_DATE_OUTSIDE_PLAN'});
    }
}

/** Serialize edits with narrowing the parent range; missing snapshots become controller errors. */
async function saveActivitySlot(slotId: string, fields: Partial<ActivitySlot>, admit?: ActivitySlotAdmission): Promise<boolean | undefined> {
    const current = await activityService.getActivitySlotById(slotId);
    if (!current) throw new APIError('Activity slot not found', {slotId}, 404);
    const planId = current.entityId;
    async function saveSlot(manager: EntityManager): Promise<boolean | undefined> {
        const plan = await requireRecommendationContext(manager, planId);
        // Optional transport authority is evaluated against this locked plan and
        // current slot, independently from the old browser's presentation bundle.
        if (admit) {
            const slot = await activityService.getActivitySlotById(slotId, manager);
            if (!slot || slot.entityId !== plan.id) throw new ApiProblem('NOT_FOUND');
            await admit(manager, plan, slot);
        }
        if (fields.day !== undefined) validateSlotDate(plan, fields.day);
        return activityService.updateActivitySlot(slotId, fields, manager);
    }
    return activityService.withActivityTransaction(saveSlot);
}

async function createTextField(planId: string, body: any) {
    const {title = '', text = ''} = body;
    if (!title.trim()) throw new APIError('Title required', body, 400);
    if (title.length > 255) throw new APIError('Title too long', body, 400);
    if (text.length > 16000) throw new APIError('Text too long', body, 400);
    return await activityService.createActivityPlanTextField(planId, title.trim(), text);
}

async function updateTextField(planId: string, textFieldId: string, body: any, permData?: PermBundle) {
    const field = await activityService.getActivityPlanTextFieldById(textFieldId);
    if (field?.entityId !== planId) {
        throw new APIError('Text field not found', {planId, textFieldId}, 404);
    }
    const {title, text = ''} = body;
    if (title !== undefined && title.length > 255) throw new APIError('Title too long', body, 400);
    if (text.length > 16000) throw new APIError('Text too long', body, 400);

    if (title !== undefined && !permData?.entity.has('MANAGE_REQUIREMENTS')) {
        throw new APIError('Not allowed', body, 403);
    }

    await activityService.updateActivityPlanTextField(textFieldId, text, title?.trim());
    return 'Text field updated';
}

async function deleteTextField(planId: string, textFieldId: string) {
    const field = await activityService.getActivityPlanTextFieldById(textFieldId);
    if (field?.entityId !== planId) {
        throw new APIError('Text field not found', {planId, textFieldId}, 404);
    }
    await activityService.deleteActivityPlanTextField(textFieldId);
    return 'Text field deleted';
}

async function reorderSlots(id: string, order: { slotId: string, pos: number }[]) {
    await activityService.reorderActivitySlots(id, order);
    return 'Order saved';
}

/** Validate an activity draft, then retain the existing slot/role persistence order. */
async function quickAddSlot(plan: ActivityPlan, body: any, session: SessionLike) {
    // Reject unusable draft dates and times before preparing any persistence.
    const {date, title = '', description = '', startTime, endTime, maxAssignees = 1, roles = []} = body;
    const d = fromISOtoLocal(date);
    if (d < fromISOtoLocal(plan.startDate) || d > fromISOtoLocal(plan.endDate))
        throw new APIError('Date outside range', body, 400, {cause: 'ACTIVITY_DATE_OUTSIDE_PLAN'});

    if (!title) throw new APIError('Title required', body, 400);

    const timePattern = /^\d{2}:\d{2}(?::\d{2})?$/;
    if (startTime && !timePattern.test(startTime)) {
        throw new APIError('Invalid start time', body, 400);
    }
    if (endTime && !timePattern.test(endTime)) {
        throw new APIError('Invalid end time', body, 400);
    }
    if (startTime && endTime && startTime >= endTime) {
        throw new APIError('End time must be after start time', body, 400, {cause: 'ACTIVITY_TIME_ORDER_INVALID'});
    }

    // Role membership and the next saved position come from this same plan.
    const normalizedRoles = await validatePlanRoleIds(plan.id, roles, body);
    const last = Number(await activityService.getLastActivitySlotNumber(plan.id, date)) || 0;
    const slot: Partial<ActivitySlot> = {
        id: generateUniqueId(),
        day: date,
        title,
        description,
        startTime: startTime || null,
        endTime: endTime || null,
        maxAssignees: Number(maxAssignees) || 1,
        pos: last + 1
    };

    /** Recheck the current date range under the plan lock before adding the row. */
    async function saveSlot(manager: EntityManager): Promise<void> {
        // A concurrent plan edit cannot make the original unlocked range authoritative.
        const currentPlan = await requireRecommendationContext(manager, plan.id);
        validateSlotDate(currentPlan, slot.day);
        await activityService.addActivitySlots(plan.id, [slot], session.profile!.id, manager);
    }
    await activityService.withActivityTransaction(saveSlot);

    // Preserve the follow-up role write; diagnostics add no new transaction guarantee.
    if (normalizedRoles.length > 0) {
        await activityService.addActivitySlotRoles(slot.id!, normalizedRoles);
    }
    return 'Slot added';
}

/** Share description persistence while optional versioned authority runs under its existing root lock. */
async function updateSlotDescription(slotId: string, body: any, admit?: ActivitySlotAdmission) {
    // The sparse writer retains range/context checks and its vanished-row diagnostic.
    if (!(await saveActivitySlot(slotId, {description: body.description}, admit))) {
        throw new APIError('Unknown error while saving', body, 500);
    }
    return 'Description updated';
}

async function updateSlotAttr(slotId: string, body: any, permData?: PermBundle, admit?: ActivitySlotAdmission) {
    const {field, value} = body;
    if (field !== undefined && value !== undefined) body[field] = value;
    // Preserve diagnostic order and the existing bundle consumer while
    // sharing each field's exact permission declaration with new projections.
    function allowed(field: keyof components['schemas']['ActivitySlotPatch']): boolean {
        const rule = activitySlotFieldPermissions[field];
        return Boolean(permData?.itemAllow(slotId, rule.permission, rule.parent));
    }
    if (!permData ||
        ((body.startTime !== undefined || body.endTime !== undefined) && !allowed('startTime'))
        || (body.title !== undefined && !allowed('title'))
        || (body.description !== undefined && !allowed('description'))
        || (body.maxAssignees !== undefined && !allowed('maxAssignees'))
        || (body.roles !== undefined && !allowed('roles'))
    ) {
        throw new APIError("Not allowed", body, 403);
    }

    let normalizedRoles: number[] | undefined;
    if (body.roles !== undefined) {
        const slot = await activityService.getActivitySlotById(slotId);
        if (!slot) throw new APIError('Activity slot not found', {slotId}, 404);
        normalizedRoles = await validatePlanRoleIds(slot.entityId, body.roles, body);
    }

    const staged: Partial<ActivitySlot> = {};
    if (body.startTime !== undefined) staged.startTime = body.startTime || null;
    if (body.endTime !== undefined) staged.endTime = body.endTime || null;
    if (body.title !== undefined) staged.title = body.title;
    if (body.description !== undefined) staged.description = body.description || null;
    if (body.maxAssignees !== undefined) staged.maxAssignees = Number(body.maxAssignees) || null;

    if (!(await saveActivitySlot(slotId, staged, admit))) {
        throw new APIError('Unknown error while saving', body, 500);
    }

    if (normalizedRoles !== undefined) {
        await activityService.updateActivitySlotRoles(slotId, normalizedRoles);
    }

    return 'Slot updated';
}


async function deleteAssignment(assignId: number) {
    await activityService.deleteActivitySlotAssignment(assignId);
    return 'Assignment removed';
}


async function updateSettings(id: string, body: any) {
    await saveDefaultPermsFromBody(ENTITIES.ACTIVITY, id, body);
    return 'Settings saved';
}

/** Analyze the existing saved requirements and return their shared presentation.
 * The versioned projection may retain missing-name origin for reactive client
 * localization; direct callers keep the exact existing response shape. */
async function getRequirements(planId: string, includeNameProvenance = false) {
    // Reuse the admitted plan's existing configuration, participants and slots.
    const [plan, requirementConfig, assignments, slots, allRoles, slotRoles] = await Promise.all([
        activityService.getActivityPlanById(planId),
        requireRequirementConfiguration(planId),
        activityService.getParticipantAssignmentsWithSlots(planId),
        activityService.getActivitySlotsFlat(planId),
        activityService.getAllRoles(planId),
        activityService.getActivitySlotRoles(planId),
    ]);

    if (!plan) {
        throw new APIError('Activity plan not found', {planId}, 404);
    }

    const eventParticipants = plan.event ? await eventService.getEventParticipants(plan.event.id) : [];

    const attendance = await buildParticipantAttendanceMap(
        plan,
        requirementConfig.overrides,
        assignments,
        [],
        eventParticipants,
    );

    const slotsWithRoles = slots.map((slot) => ({
        id: slot.id,
        day: slot.day,
        startTime: slot.startTime,
        endTime: slot.endTime,
        maxAssignees: slot.maxAssignees,
        roles: (slotRoles[slot.id] ?? []).map((role) => ({
            roleId: Number(role.id),
            maxQty: role.maxQty,
            assignedQty: role.assignedQty,
        })),
    }));
    const assignedShiftCounts = Object.fromEntries(
        Object.entries(assignments).map(([participantKey, participantAssignments]) => [participantKey, participantAssignments.length]),
    );
    // The pure engine remains the sole owner of requirement arithmetic. Optional
    // label provenance below changes neither its inputs nor its saved results.
    const analysis = calculateRequirementAnalysis({
        plan,
        participants: Object.values(attendance),
        roleRequirements: requirementConfig.roleRequirements,
        overrides: requirementConfig.overrides,
        stayRequirements: requirementConfig.stayRequirements,
        slots: slotsWithRoles,
        assignedShiftCounts,
    });
    const roleTitles = new Map(allRoles.map((role) => [Number(role.id), role.title]));
    const participants = analysis.participants.map((participant) => ({
        ...participant,
        roles: (participant.roleIds || [])
            .map((roleId) => roleTitles.get(roleId))
            .filter((title): title is string => Boolean(title && title !== 'default')),
        assignmentMode: requirementConfig.plan.assignmentMode,
    }));

    const overrideTargets = eventParticipants.map((participant) => ({
        key: toParticipantKey(participant),
        profileId: participant.profileId ?? null,
        label: toParticipantName(participant),
        ...(includeNameProvenance ? {nameIsFallback: !participant.name} : {}),
        arrivalDate: participant.arrivalDate ?? null,
        departureDate: participant.departureDate ?? null,
    }));

    return {
        ...requirementConfig,
        participants,
        capacitySummary: analysis.capacitySummary,
        calculationContext: {
            participants: Object.values(attendance),
            assignedShiftCounts,
            slots: slotsWithRoles,
        },
        overrideTargets,
    };
}

async function calculateBaselineRequirement(planId: string) {
    const [plan, requirementConfig, slots, assignments, slotRoles] = await Promise.all([
        activityService.getActivityPlanById(planId),
        requireRequirementConfiguration(planId),
        activityService.getActivitySlotsFlat(planId),
        activityService.getParticipantAssignmentsWithSlots(planId),
        activityService.getActivitySlotRoles(planId),
    ]);

    if (!plan) {
        throw new APIError('Activity plan not found', {planId}, 404);
    }

    const eventParticipants = plan.event ? await eventService.getEventParticipants(plan.event.id) : [];
    const attendance = await buildParticipantAttendanceMap(
        plan,
        requirementConfig.overrides,
        assignments,
        [],
        eventParticipants,
    );

    const slotsWithRoles = slots.map((slot) => ({
        id: slot.id,
        day: slot.day,
        startTime: slot.startTime,
        endTime: slot.endTime,
        maxAssignees: slot.maxAssignees,
        roles: (slotRoles[slot.id] ?? []).map((role) => ({
            roleId: Number(role.id),
            maxQty: role.maxQty,
            assignedQty: role.assignedQty,
        })),
    }));
    const baseline = calculateBaselineRequirementForPlan({
        plan,
        slots: slotsWithRoles,
        participants: Object.values(attendance),
        roleRequirements: requirementConfig.roleRequirements,
        overrides: requirementConfig.overrides,
    });

    return baseline;
}

/**
 * A settings form may no longer list a saved profile after the plan moves to another event.
 * Preserve those unchanged rows, including omitted rows, inside the same locked transaction.
 * Versioned editors can explicitly remove an admitted saved ID without deleting unseen rows.
 * Their existence never authorizes a new target or a changed override for a nonparticipant.
 */
async function mergeRequirementOverrides(
    manager: EntityManager,
    plan: ActivityPlan,
    submitted: RequirementOverrideInput[],
    removedOverrideIds: readonly string[],
): Promise<RequirementOverrideInput[]> {
    const {overrides: saved} = await requireRequirementConfiguration(plan.id, manager);
    const savedById = new Map(saved.map((override) => [override.id, override]));
    // Removal is deliberate and plan-scoped. Omission still means retention for
    // former participants; it must never delete a concurrent unseen override.
    const removedIds = new Set<number>();
    for (const id of removedOverrideIds) {
        const numericId = Number(id);
        if (!Number.isSafeInteger(numericId) || String(numericId) !== id || !savedById.has(numericId) || removedIds.has(numericId)) {
            throw new APIError('Removed override must identify one saved override belonging to this activity plan', {}, 400, {cause: 'ACTIVITY_OVERRIDE_INVALID'});
        }
        removedIds.add(numericId);
    }
    const registered = new Set(plan.eventId ? await activityService.getRegisteredProfileIds(manager, plan.eventId) : []);
    const result: RequirementOverrideInput[] = [];
    const submittedIds = new Set<number>();
    const targetKeys = new Set<string>();
    for (const input of submitted) {
        const override = {...input, roleId: input.roleId ?? null};
        const previous = override.id == null ? undefined : savedById.get(override.id);
        if (override.id != null && (!previous || submittedIds.has(override.id) || removedIds.has(override.id))) {
            throw new APIError('Override does not belong to this activity plan or is duplicated', {}, 400, {cause: 'ACTIVITY_OVERRIDE_INVALID'});
        }
        const unchanged = previous && previous.profileId === override.profileId
            && (previous.roleId ?? null) === (override.roleId ?? null)
            && previous.requiredShifts === override.requiredShifts;
        if (!unchanged && (!override.profileId || !registered.has(override.profileId))) {
            throw new APIError('Overrides must target participants registered for this event', {}, 400, {cause: 'ACTIVITY_OVERRIDE_PARTICIPANT_REQUIRED'});
        }
        const key = `${override.profileId}:${override.roleId ?? ''}`;
        if (targetKeys.has(key)) throw new APIError('An override target may only appear once', {}, 400, {cause: 'ACTIVITY_OVERRIDE_DUPLICATE'});
        targetKeys.add(key);
        if (override.id != null) submittedIds.add(override.id);
        result.push(override);
    }
    // Omission still removes a current participant's override, as in the existing editor.
    // A former participant is absent from that editor's choices, so omission must retain
    // the original row instead of turning an unrelated settings save into data deletion.
    for (const previous of saved) {
        if (registered.has(previous.profileId) || submittedIds.has(previous.id) || removedIds.has(previous.id)) continue;
        result.push({
            id: previous.id,
            profileId: previous.profileId,
            roleId: previous.roleId ?? null,
            requiredShifts: previous.requiredShifts,
        });
    }
    return result;
}

/** Save one coherent requirements configuration under the existing plan lock.
 * Explicit versioned removal IDs supplement the omission-retention rule;
 * permissions, current membership checks and persistence remain with their owners. */
async function updateRequirements(planId: string, body: any, removedOverrideIds: readonly string[] = []) {
    const {roleRequirements, stayRequirements, overrides, ...planSettings} = preprocessRequirementUpdate(body);
    const expectedPlan = await activityService.getActivityPlanById(planId);
    async function saveRequirements(manager: EntityManager): Promise<void> {
        const plan = await requireRecommendationContext(manager, planId);
        if (expectedPlan && (expectedPlan.eventId ?? null) !== (plan.eventId ?? null)) {
            throw new APIError('Activity plan event changed; reload the requirements', {}, 409, {cause: 'ACTIVITY_CONTEXT_CHANGED'});
        }

        if (!plan.eventId) {
            throw new APIError('Event is required to configure participant overrides', {planId}, 400, {cause: 'ACTIVITY_EVENT_REQUIRED'});
        }

        // Membership and saved-override decisions use this same locked transaction.
        // Unchanged targets from a former event are retained; new/changed overrides still
        // require current registration. Checking only the posted rows here would reject a
        // harmless settings save after relinking and encourage the browser to drop history.

        const allowedRoleIds = new Set((await activityService.getAllRoles(planId, manager)).map((role) => role.id));
        const invalidRoleRequirement = roleRequirements.find((requirement) => !allowedRoleIds.has(requirement.roleId));
        const invalidOverrideRole = overrides.find(
            (override) => override.roleId != null && !allowedRoleIds.has(Number(override.roleId)),
        );
        if (invalidRoleRequirement || invalidOverrideRole) {
            throw new APIError(
                'Requirement roles must belong to this activity plan',
                invalidRoleRequirement ?? invalidOverrideRole,
                400,
                {cause: 'ACTIVITY_REQUIREMENT_ROLE_INVALID'},
            );
        }

        const planDays = countInclusiveDays(plan.startDate, plan.endDate);
        const invalidStayRequirement = stayRequirements.find((requirement) => requirement.stayDays > planDays);
        if (invalidStayRequirement) {
            throw new APIError('Stay duration cannot exceed the activity plan duration', invalidStayRequirement, 400, {cause: 'ACTIVITY_STAY_DURATION_INVALID'});
        }
        const targetAssignmentMode = planSettings.assignmentMode ?? plan.assignmentMode;
        const savedStayDays = new Set(stayRequirements.map((requirement) => requirement.stayDays));
        if (
            targetAssignmentMode === "REQUIRED"
            && (stayRequirements.length !== planDays
                || Array.from({length: planDays}, (_, index) => index + 1).some((day) => !savedStayDays.has(day)))
        ) {
            throw new APIError(
                `Required mode needs exactly one saved requirement for every stay duration from 1 to ${planDays} days`,
                {stayRequirements, planDays},
                400,
                {cause: 'ACTIVITY_STAY_REQUIREMENTS_INCOMPLETE'},
            );
        }

        // Convert bindingDeadline string to Date if present
        const normalizedSettings: Partial<Pick<ActivityPlan, "assignmentMode" | "generalRequiredShifts" | "roundingMode" | "bindingDeadline" | "allowOverfillAfterFull" | "allowExternalAssignees" | "allowArrivalDayEvening" | "allowDepartureDayMorning">> = {
            assignmentMode: planSettings.assignmentMode,
            generalRequiredShifts: planSettings.generalRequiredShifts,
            roundingMode: planSettings.roundingMode,
            allowOverfillAfterFull: planSettings.allowOverfillAfterFull,
            allowExternalAssignees: planSettings.allowExternalAssignees,
            allowArrivalDayEvening: planSettings.allowArrivalDayEvening,
            allowDepartureDayMorning: planSettings.allowDepartureDayMorning,
        };

        if (planSettings.bindingDeadline !== undefined) {
            if (planSettings.bindingDeadline === null) {
                normalizedSettings.bindingDeadline = null;
            } else if (typeof planSettings.bindingDeadline === 'string') {
                normalizedSettings.bindingDeadline = new Date(planSettings.bindingDeadline);
            } else {
                normalizedSettings.bindingDeadline = planSettings.bindingDeadline;
            }
        }

        const retainedOverrides = await mergeRequirementOverrides(manager, plan, overrides, removedOverrideIds);
        await requirementService.replaceRequirements(planId, roleRequirements, retainedOverrides, normalizedSettings, stayRequirements, manager);
    }
    await activityService.withActivityTransaction(saveRequirements);
    return 'Requirements updated';
}

/**
 * Assemble foreign commitments once from the saved relationship. Sibling roles, counts and
 * requirements deliberately stay out of the local participant projection. An active move
 * reserves its target but cannot release a commitment owned by a different plan's transaction.
 */
async function buildLinkedPlanContext(plan: ActivityPlan, manager?: EntityManager): Promise<ActivityLinkedPlanContext> {
    const context: ActivityLinkedPlanContext = {plans: [], commitments: {}};
    if (!plan.eventId) return context;
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

/** Application policy belongs to the controller; overlap detection remains a pure calculation. */
function classifyRecommendationOverlaps(plan: ActivityPlan, results: RecommendationWarningResult[]): void {
    for (const result of results) {
        for (const warning of result.warnings) {
            if (warning.type !== 'overlap') continue;
            const details = warning.overlapDetails ?? [];
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
function overlapConfirmation(planId: string, results: RecommendationWarningResult[]): string | undefined {
    const collisions: string[] = [];
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
    return crypto.createHash('sha256').update(JSON.stringify([planId, collisions.sort()])).digest('hex');
}

/** Require deliberate confirmation of the current overlap review when one exists. */
function requireOverlapConfirmation(expected: string | undefined, submitted: unknown): void {
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
async function presentRecommendationWarnings(
    planId: string, results: RecommendationWarningResult[], session?: SessionLike, manager?: EntityManager,
): Promise<RecommendationWarningResult[]> {
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

async function collectRecommendationWarnings(
    planId: string, recommendations: RecommendationInput[], validateTargets = true, manager?: EntityManager,
    otherProposals: RecommendationInput[] = [],
): Promise<RecommendationWarningResult[]> {
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
async function validateRecommendationTargets(planId: string, recommendations: {
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

async function buildParticipantAttendanceMap(
    plan: ActivityPlan,
    overrides: requirementService.RequirementConfiguration["overrides"],
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

    const upsert = (participant: ParticipantAttendance) => {
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

function resolveWarningTarget(
    session: Request["session"],
    permData: PermBundle | undefined,
    body: { profileId?: string | null } = {},
) {
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

function shouldAutoGenerateRecommendations(plan: ActivityPlan, recommendations: unknown[]): boolean {
    if (plan.assignmentMode === "FREE" || !plan.bindingDeadline || recommendations.length > 0) {
        return false;
    }

    const deadline = new Date(plan.bindingDeadline);
    if (Number.isNaN(deadline.getTime())) return false;

    return deadline.getTime() <= Date.now();
}

async function getAssignmentWarnings(
    planId: string,
    slotId: string,
    session: Request["session"],
    permData?: PermBundle,
    body?: { profileId?: string | null },
) {
    return (await getAssignmentWarningPreview(planId, slotId, session, permData, body)).warnings;
}

/** The existing warning read remains available; HTTP clients also receive its confirmation digest. */
async function getAssignmentWarningPreview(
    planId: string, slotId: string, session: Request['session'], permData?: PermBundle,
    body?: {profileId?: string | null},
): Promise<AssignmentWarningPreview> {
    const target = resolveWarningTarget(session, permData, body);
    async function previewAssignment(manager: EntityManager): Promise<AssignmentWarningPreview> {
        const plan = await activityService.getActivityPlanById(planId, manager);
        const slot = await activityService.getActivitySlotById(slotId, manager);
        if (!plan || !slot || slot.entityId !== planId) {
            throw new APIError('Activity slot not found in this plan', {planId, slotId}, 404);
        }
        const warnings = await collectManualAssignmentWarnings(plan, slot, target.profileId!, manager);
        const raw = [{recommendation: {itemId: slotId, profileId: target.profileId, manual: true}, warnings}];
        const confirmation = overlapConfirmation(planId, raw);
        const presented = await presentRecommendationWarnings(planId, raw, session, manager);
        return {warnings: presented[0].warnings, overlapConfirmation: confirmation};
    }
    return activityService.withActivityReadSnapshot(previewAssignment);
}

/** Shared by the participant preview and the still-locked signup command, including role signups. */
async function collectManualAssignmentWarnings(
    plan: ActivityPlan, slot: ActivitySlot, profileId: string, manager: EntityManager,
): Promise<AssignmentWarning[]> {
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

function recommendationInputKey(recommendation: RecommendationInput): string {
    return `${recommendation.operation ?? "ASSIGN"}:${recommendation.sourceItemId ?? ""}:${recommendation.itemId}:${recommendation.profileId}`;
}

function toRecommendationInput(recommendation: ActivityAssignmentRecommendation): RecommendationInput {
    return {
        id: recommendation.id,
        itemId: recommendation.item.id,
        profileId: recommendation.profile.id,
        status: recommendation.status,
        operation: recommendation.operation,
        sourceItemId: recommendation.sourceItem?.id ?? null,
        manual: recommendation.manual,
        hidden: recommendation.hidden,
    };
}

/**
 * Applied rows and automatic rejection restrictions are intentionally absent from the review
 * GUI. A subsequent save must merge that history back instead of treating omission as deletion.
 */
function preserveRecommendationHistory(
    existing: ActivityAssignmentRecommendation[],
    submitted: RecommendationInput[],
): RecommendationInput[] {
    const submittedIds = new Set(submitted.map((recommendation) => recommendation.id).filter(Boolean));
    const submittedKeys = new Set(submitted.map(recommendationInputKey));
    const hiddenHistory = existing
        .filter((recommendation) =>
            recommendation.status === "APPLIED"
            || (recommendation.status === "REJECTED" && !recommendation.manual))
        .filter((recommendation) => !submittedIds.has(recommendation.id))
        .map(toRecommendationInput)
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

function shouldRegenerateRecommendationsAfterApply(plan: ActivityPlan): boolean {
    if (plan.assignmentMode === "FREE" || !plan.bindingDeadline) return false;
    const deadline = new Date(plan.bindingDeadline);
    return !Number.isNaN(deadline.getTime()) && deadline.getTime() <= Date.now();
}

async function authorizeSelfAssignment(
    planId: string,
    slotId: string,
    profileId: string,
    operation: 'assign' | 'unassign',
    roleName?: string,
) {
    const [plan, slot] = await Promise.all([
        activityService.getActivityPlanById(planId),
        activityService.getActivitySlotById(slotId),
    ]);

    if (!plan || !slot || slot.entityId !== planId) {
        throw new APIError('Activity slot not found in this plan', {planId, slotId}, 404);
    }

    let requestedRole: {name: string; maxQty: number} | undefined;
    if (roleName !== undefined) {
        if (typeof roleName !== 'string' || !roleName.trim()) {
            throw new APIError('Activity role is required', {slotId, roleName}, 400, {cause: 'ACTIVITY_ROLE_REQUIRED'});
        }
        const slotRoles = await activityService.getActivitySlotRoles(planId);
        requestedRole = slotRoles[slotId]?.find((role) => role.name === roleName);
        if (!requestedRole) {
            throw new APIError('Activity role is not available for this slot', {slotId, roleName}, 400, {cause: 'ACTIVITY_ROLE_UNAVAILABLE'});
        }
    }

    // A user must always be able to remove an existing commitment, even if registration
    // or plan policy changed after it was created.
    if (operation === 'unassign') return;

    if (plan.event?.id && !plan.allowExternalAssignees) {
        const registration = await eventService.getRegistrationFor(profileId, plan.event.id);
        if (!registration) {
            throw new APIError(
                'Only registered event participants may take slots in this activity plan',
                {planId, slotId},
                403,
                {cause: 'ACTIVITY_PARTICIPANT_REQUIRED'},
            );
        }
    }

    const assignees = (await activityService.getActivitySlotAssignees(planId))[slotId] ?? [];
    const existingAssignee = assignees.find((assignee) => assignee.profileId === profileId);
    if (
        !plan.allowOverfillAfterFull
        && !existingAssignee
        && typeof slot.maxAssignees === 'number'
        && assignees.length >= slot.maxAssignees
    ) {
        throw new APIError('This activity slot is already full', {planId, slotId}, 409, {cause: 'ACTIVITY_FULL'});
    }

    if (requestedRole && requestedRole.maxQty > 0) {
        const alreadyHasRole = existingAssignee?.roles.includes(requestedRole.name);
        const roleCount = assignees.filter((assignee) => assignee.roles.includes(requestedRole!.name)).length;
        if (!alreadyHasRole && roleCount >= requestedRole.maxQty) {
            throw new APIError('This activity role is already full', {planId, slotId, roleName}, 409, {cause: 'ACTIVITY_ROLE_FULL'});
        }
    }
}

/** Workspace entry maintains saved proposals; the versioned recovery read
 * explicitly disables those effects while sharing the same safe presentation inputs.
 * Optional name provenance belongs only to versioned presentation, not standard JSON. */
async function getRecommendations(planId: string, session?: SessionLike, maintain = true, includeNameProvenance = false) {
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

async function updateRecommendations(planId: string, body: any, session?: SessionLike) {
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

/** Validation belongs at the command boundary, including generated internal commands. */
function normalizeRecommendationForPersistence(input: RecommendationInput): RecommendationInput {
    if (!input.itemId || !input.profileId) throw new APIError('Recommendation requires a slot and profile', input, 400);
    if (input.operation === 'REASSIGN' && (!input.sourceItemId || input.sourceItemId === input.itemId)) {
        throw new APIError('Reassignment requires a different source slot', input, 400, {cause: 'ACTIVITY_RECOMMENDATION_SOURCE_INVALID'});
    }
    return normalizeRecommendationInput(input);
}

/** Review commands recheck their original event/date context after acquiring the root lock. */
async function saveReviewedRecommendations(
    planId: string, recommendations: RecommendationInput[], expected: ActivityRecommendationPersistenceContext,
): Promise<void> {
    const normalized = recommendations.map(normalizeRecommendationForPersistence);
    async function saveReviewed(manager: EntityManager): Promise<void> {
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
    async function saveGenerated(manager: EntityManager): Promise<void> {
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
function recommendationContext(plan: Pick<ActivityPlan, 'eventId' | 'startDate' | 'endDate'>): ActivityRecommendationContext {
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
    const recommendationMemory: RecommendationInput[] = existingRecommendations.map((recommendation) => ({
        itemId: recommendation.item.id,
        profileId: recommendation.profile.id,
        status: recommendation.status,
        operation: recommendation.operation,
        sourceItemId: recommendation.sourceItem?.id ?? null,
        manual: recommendation.manual,
        hidden: recommendation.hidden,
    }));
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

/** Shared by synchronous generation and post-application refresh; jobs use the same persistence guard. */
async function generateAndSaveRecommendations(planId: string, existing: ActivityAssignmentRecommendation[]): Promise<RecommendationInput[]> {
    const context = await buildPlanRecommendationContext(planId, existing);
    const fingerprint = fingerprintRecommendationContext(context);
    const recommendations = generateAutoRecommendations(context);
    const freshContext = await buildPlanRecommendationContext(planId);
    if (fingerprintRecommendationContext(freshContext) !== fingerprint) {
        throw new APIError('Plan inputs changed while recommendations were being calculated', {}, 409, {cause: 'ACTIVITY_CONTEXT_CHANGED'});
    }
    await saveGeneratedRecommendations(planId, recommendations, {
        eventId: context.plan.eventId ?? null,
        startDate: context.plan.startDate,
        endDate: context.plan.endDate,
        inputFingerprint: fingerprint,
    });
    return recommendations;
}

async function autoGenerateRecommendations(planId: string) {
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

/**
 * Resolve provenance and review states once for preview and application. Existing generated
 * rows cannot become manual merely because a submitted payload changes its manual flag.
 */
async function loadRecommendationReview(planId: string, body: any, manager: EntityManager) {
    const existing = await recommendationService.getRecommendations(planId, manager);
    const reviewed = body?.recommendations !== undefined
        ? reconcileSubmittedRecommendations(existing, preprocessRecommendationUpdate(body).recommendations)
        : existing.map(toRecommendationInput);
    await validateRecommendationTargets(planId, reviewed, true, manager);
    return {existing, reviewed: reviewed.map(normalizeRecommendationForPersistence)};
}

/** Block the same pair of reciprocal moves together, preserving the existing swap contract. */
function includeBlockedSwapLegs(recommendations: RecommendationInput[], blocked: Set<string>): void {
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

function hasBlockingRecommendationWarning(result: RecommendationWarningResult): boolean {
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
async function getRecommendationWarningPreview(
    planId: string, body: any, session?: SessionLike,
): Promise<RecommendationWarningPreview> {
    async function previewReview(manager: EntityManager): Promise<RecommendationWarningPreview> {
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
async function applyRecommendations(planId: string, body?: any, session?: SessionLike) {
    async function applyReviewed(manager: EntityManager) {
        const plan = await requireRecommendationContext(manager, planId);
        const {existing, reviewed} = await loadRecommendationReview(planId, body, manager);
        const prepared = await prepareRecommendationApplication(planId, reviewed, manager);
        requireOverlapConfirmation(prepared.overlapConfirmation, body?.overlapConfirmation);
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

async function deleteSlot(slotId: string) {
    await activityService.deleteActivitySlot(slotId);
    return 'Slot deleted';
}

async function addSlotRole(slotId: string, body: any) {
    const {roles} = body;
    if (!roles || !Array.isArray(roles) || roles.length < 1 || roles.includes("default")) {
        throw new APIError('Invalid roles', body, 400);
    }

    const slot = await activityService.getActivitySlotById(slotId);
    if (!slot) throw new APIError('Activity slot not found', {slotId}, 404);
    const normalizedRoles = await validatePlanRoleIds(slot.entityId, roles, body);
    await activityService.addActivitySlotRoles(slotId, normalizedRoles);
    return 'Roles added';
}

/** Admit explicit generation against saved requirements before enqueueing any work. */
async function queueAutoGenerateRecommendations(planId: string) {
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

async function getAutoRecommendationJob(planId: string, jobId: string) {
    const job = recommendationJobCoordinator.get(jobId);
    if (!job || job.planId !== planId) {
        throw new APIError('Recommendation job not found', {planId, jobId}, 404);
    }
    return {job};
}

/** Normalize selected role IDs and reject roles outside their activity plan. */
async function validatePlanRoleIds(planId: string, roles: unknown, body: unknown): Promise<number[]> {
    // Numeric conversion retains form values; malformed IDs never reach a query.
    if (!Array.isArray(roles)) throw new APIError('Invalid roles', {body}, 400);
    const normalized = roles.map(Number);
    if (normalized.some((roleId) => !Number.isInteger(roleId) || roleId <= 0)) {
        throw new APIError('Invalid roles', {body}, 400);
    }

    // Membership, rather than a posted role ID alone, authorizes this plan's selection.
    const allowed = new Set((await activityService.getAllRoles(planId)).map((role) => role.id));
    if (normalized.some((roleId) => !allowed.has(roleId))) {
        throw new APIError('Roles must belong to this activity plan', {body}, 400, {cause: 'ACTIVITY_ROLE_UNAVAILABLE'});
    }
    return [...new Set(normalized)];
}

async function addActivityRole(plan: ActivityPlan, body: any) {
    const {name, description, isDefault} = body;
    if (!name || name === "default") throw new APIError('Missing name', body, 400, {cause: 'ACTIVITY_ROLE_NAME_INVALID'});
    return activityService.ensureRoleId(plan.id, name, isDefault === 'on', description);
}

/** Role quotas and assignment ownership are checked before replacing any role links. */
async function updateRoleAssignments(slotId: string, body: any) {
    const {assignments} = body;
    if (!Array.isArray(assignments)) throw new APIError('Not an array', body, 400);
    const current = await activityService.getActivitySlotById(slotId);
    if (!current) throw new APIError('Activity slot not found', {slotId}, 404);
    const planId = current.entityId;
    /** Replace role links only after locked assignment membership and quota checks. */
    async function saveRoles(manager: EntityManager): Promise<void> {
        // The plan and activity locks fence concurrent role/assignment changes.
        await requireRecommendationContext(manager, planId);
        const [slot] = await activityService.getLockedActivitySlots(manager, [slotId]);
        if (!slot) throw new APIError('Activity slot not found', {slotId}, 404);
        const configured = await activityService.getConfiguredSlotRoles(manager, slotId);
        const byName = new Map(configured.map((entry) => [entry.role.title, entry]));
        const currentAssignments = await activityService.getLockedPlanAssignments(manager, planId, slotId);
        const assignmentIds = new Set(currentAssignments.map((assignment) => assignment.id));
        const requestedCounts = new Map<string, number>();
        const rows: {assignmentId: number; roleId: number}[] = [];
        // Validate every requested role and assignee before replacing any links.
        for (const entry of assignments) {
            const role = entry && byName.get(entry.role);
            if (!role) throw new APIError('Roles must be configured for this activity slot', body, 400, {cause: 'ACTIVITY_ROLE_UNAVAILABLE'});
            const assignmentId = entry.assignmentId === null ? null : Number.parseInt(entry.assignmentId) || null;
            if (assignmentId === null) continue;
            if (!assignmentIds.has(assignmentId)) throw new APIError('Assignment not found in this slot', body, 400, {cause: 'ACTIVITY_ASSIGNMENT_INVALID'});
            const count = (requestedCounts.get(entry.role) ?? 0) + 1;
            if (entry.role !== 'default' && count > (role.maxQty ?? 0)) {
                throw new APIError('This activity role is already full', {slotId, role: entry.role}, 409, {cause: 'ACTIVITY_ROLE_FULL'});
            }
            requestedCounts.set(entry.role, count);
            rows.push({assignmentId, roleId: role.role.id});
        }
        await activityService.replaceActivityAssignmentRoles(manager, [...assignmentIds], rows);
    }
    await activityService.withActivityTransaction(saveRoles);
    return 'Assignments updated';
}

/**
 * Slot/role quotas are command policy. Read and validate them after the root and slot locks,
 * then pass only the selected IDs to DBAL. An existing role link is an idempotent no-op.
 */
async function assignActivityAssignmentRole(itemId: string, profileId: string, roleName = 'default', confirmation?: unknown, admit?: ActivitySlotAdmission): Promise<void> {
    const current = await activityService.getActivitySlotById(itemId);
    if (!current) throw new APIError('Activity slot not found', {itemId}, 404);
    const planId = current.entityId;
    async function assignParticipant(manager: EntityManager): Promise<void> {
        const plan = await requireRecommendationContext(manager, planId);
        const [slot] = await activityService.getLockedActivitySlots(manager, [itemId]);
        if (!slot) throw new APIError('Activity slot not found', {itemId}, 404);
        // Versioned admission joins this operation's existing root/slot locks;
        // callers that omit it remain responsible for admission.
        await admit?.(manager, plan, slot);
        const assignments = await activityService.getLockedPlanAssignments(manager, planId, itemId);
        const existing = assignments.find((assignment) => assignment.profile.id === profileId);
        if (!existing && !plan.allowOverfillAfterFull && slot.maxAssignees != null && assignments.length >= slot.maxAssignees) {
            throw new APIError('This activity slot is already full', {itemId}, 409, {cause: 'ACTIVITY_FULL'});
        }
        let role = await activityService.getActivityRoleByName(manager, planId, roleName);
        if (!role && roleName !== 'default') {
            throw new APIError('Activity role is not available for this plan', {itemId, roleName}, 400, {cause: 'ACTIVITY_ROLE_UNAVAILABLE'});
        }
        if (role && existing && assignmentHasRole(existing, role.id)) return;
        if (!existing) {
            const warnings = await collectManualAssignmentWarnings(plan, slot, profileId, manager);
            const observed = [{recommendation: {itemId, profileId, manual: true}, warnings}];
            requireOverlapConfirmation(overlapConfirmation(planId, observed), confirmation);
        }
        if (roleName !== 'default') {
            // A named role must have survived the existence check above; capture its ID
            // once so all quota comparisons use the same selected role snapshot.
            const roleId = role!.id;
            const configured = await activityService.getConfiguredSlotRoles(manager, itemId);
            const slotRole = configured.find((entry) => entry.role.id === roleId);
            if (!slotRole) throw new APIError('Activity role is not available for this slot', {itemId, roleName}, 400, {cause: 'ACTIVITY_ROLE_UNAVAILABLE'});
            let roleCount = 0;
            for (const assignment of assignments) {
                if (assignmentHasRole(assignment, roleId)) roleCount++;
            }
            // Slot overfill does not relax the independently configured named-role quota.
            if (slotRole.maxQty != null && roleCount >= slotRole.maxQty) {
                throw new APIError('This activity role is already full', {itemId, roleName}, 409, {cause: 'ACTIVITY_ROLE_FULL'});
            }
        }
        if (!role) [role] = await activityService.ensureRoleId(planId, 'default', true, undefined, manager);
        await activityService.saveActivityAssignmentRole(manager, planId, itemId, profileId, role.id, existing?.id);
    }
    await activityService.withActivityTransaction(assignParticipant);
}

function assignmentHasRole(assignment: ActivityAssignment, roleId: number): boolean {
    return assignment.activityAssignmentRoles.some((entry) => entry.role.id === roleId);
}

/** Removing the last role ends the signup; the controller owns this domain decision. */
async function unassignActivityAssignmentRole(itemId: string, profileId: string, roleName = 'default', admit?: ActivitySlotAdmission): Promise<void> {
    const current = await activityService.getActivitySlotById(itemId);
    if (!current) return;
    const planId = current.entityId;
    async function unassignParticipant(manager: EntityManager): Promise<void> {
        const plan = await requireRecommendationContext(manager, planId);
        await activityService.getLockedActivitySlots(manager, [itemId]);
        // The optional adapter only adds its captured authority/context checks.
        // Removal of the saved commitment still belongs to this shared operation.
        if (admit) {
            const slot = await activityService.getActivitySlotById(itemId, manager);
            if (!slot) throw new ApiProblem('NOT_FOUND');
            await admit(manager, plan, slot);
        }
        const assignments = await activityService.getLockedPlanAssignments(manager, planId, itemId);
        const assignment = assignments.find((entry) => entry.item.id === itemId && entry.profile.id === profileId);
        if (!assignment) return;
        const role = assignment.activityAssignmentRoles.find((entry) => entry.role.title === roleName);
        if (roleName === 'default' || (role && assignment.activityAssignmentRoles.length === 1)) {
            await activityService.deleteActivitySlotAssignment(assignment.id, manager);
        } else if (role) {
            await activityService.deleteActivityAssignmentRole(manager, role.id);
        }
    }
    await activityService.withActivityTransaction(unassignParticipant);
}

async function updateHeaderImg(entity: EntityBase, file?: Express.Multer.File) {
    await performImageSwap(entity, activityService.updateHeaderImage, file);
    return 'Image updated';
}

async function deleteHeaderImg(entity: EntityBase) {
    await performImageSwap(entity, activityService.updateHeaderImage);
    return 'Image deleted';
}

/**
 * Applies a reviewed recommendation batch atomically. Reassignments release all
 * source slots before capacity is checked for their targets, which also makes a
 * two-row swap safe regardless of row order.
 */
async function applyActivityRecommendationOperations(
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

function getAssignmentAccessMapping() {
    return {
        assign: (body: any, profileId: string) => assignActivityAssignmentRole(body.itemId, profileId, 'default', body.overlapConfirmation),
        unassign: (body: any, profileId: string) => unassignActivityAssignmentRole(body.itemId, profileId),
    };
}

function getRoleAccessMapping() {
    return {
        assign: (body: any, profileId: string) => assignActivityAssignmentRole(body.itemId, profileId, body.role, body.overlapConfirmation),
        unassign: (body: any, profileId: string) => unassignActivityAssignmentRole(body.itemId, profileId, body.role),
    };
}


export default {
    preprocessCreate,
    createEntity,
    afterCreateItems,
    fetchForView,
    getScheduleExport,
    fetchForDuplicate,
    deleteEntity,

    updateDescription,
    updateProperties,
    invalidateEventContext,
    createTextField,
    updateTextField,
    deleteTextField,
    reorderSlots,
    quickAddSlot,
    updateSlotDescription,
    updateSlotAttr,
    deleteAssignment,
    updateSettings,
    getRequirements,
    updateRequirements,
    calculateBaselineRequirement,
    getRecommendations,
    updateRecommendations,
    autoGenerateRecommendations,
    queueAutoGenerateRecommendations,
    getAutoRecommendationJob,
    applyRecommendations,
    deleteSlot,
    addSlotRole,
    addActivityRole,
    updateRoleAssignments,

    updateHeaderImg,
    deleteHeaderImg,

    getAssignmentWarnings,
    getAssignmentWarningPreview,
    getRecommendationWarningPreview,
    authorizeSelfAssignment,
    getAssignmentAccessMapping,
    getRoleAccessMapping,
};

/** Resolve the current feature root without exposing ORM absence or owner data. */
async function requireActivityPlan(id: string, manager?: EntityManager): Promise<ActivityPlan> {
    const plan = await activityService.getActivityPlanById(id, manager);
    if (!plan) throw new ApiProblem('NOT_FOUND');
    return plan;
}

/** Current method authority remains separate from detail-page admission. */
async function activityPermissions(plan: ActivityPlan, session: SessionLike, manager?: EntityManager): Promise<PermView> {
    return evaluateSubject({kind: 'entity', entity: {entityType: 'activity', entityId: plan.id,
        ownerId: plan.ownerId, eventId: plan.eventId}}, session, undefined, manager);
}

/** Match the item method's independent creator grant and parent fallback. */
async function activityItemPermissions(plan: ActivityPlan, slot: ActivitySlot, session: SessionLike, manager?: EntityManager): Promise<PermView> {
    return evaluateSubject({kind: 'item', item: {entityType: 'activitySlot', entityId: slot.id,
        ownerId: slot.profileId, eventId: plan.eventId}, parent: {entityType: 'activity', entityId: plan.id,
        ownerId: plan.ownerId, eventId: plan.eventId}}, session, undefined, manager);
}

/** Capture identity from the admitted actor; posted profile values cannot select self. */
function activityActorId(session: SessionLike): string {
    if (!session.profile?.id) throw new ApiProblem('AUTH_REQUIRED');
    return session.profile.id;
}

/** Root methods authorize independently of page admission, including public grants. */
async function requireActivityMethod(id: string, permission: PermType, session: SessionLike) {
    const plan = await requireActivityPlan(id);
    const permissions = await activityPermissions(plan, session);
    if (!permissions.has(permission)) throw new ApiProblem('FORBIDDEN');
    return {plan, permissions};
}

/** Child identifiers are scoped before any feature mutation or private projection. */
async function requireActivitySlot(id: string, slotId: string, session: SessionLike) {
    const plan = await requireActivityPlan(id);
    const slot = await activityService.getActivitySlotById(slotId);
    if (!slot || slot.entityId !== id) throw new ApiProblem('NOT_FOUND');
    return {plan, slot, permissions: await activityItemPermissions(plan, slot, session)};
}

/** Build the shared permission bundle only for calls which consume that owner. */
async function activityPermissionBundle(plan: ActivityPlan, session: SessionLike): Promise<PermBundle> {
    const slots = await activityService.getActivitySlotsFlat(plan.id);
    return buildPermBundle({entityType: 'activity', entityId: plan.id, ownerId: plan.ownerId, eventId: plan.eventId},
        slots.map(slot => ({entityType: 'activitySlot', entityId: slot.id, ownerId: slot.profileId, eventId: plan.eventId})), session);
}

/** Shared property policy selects values individually rather than leaking a whole root into an editor. */
function activityMetadataProjection(plan: ActivityPlan, permissions: PermView): components['schemas']['ActivityMetadata'] {
    const values: components['schemas']['ActivityMetadata']['values'] = {};
    const editableFields: components['schemas']['ActivityMetadata']['editableFields'] = [];
    for (const field of ['title', 'description', 'startDate', 'endDate'] as const) {
        if (!permissions.has(entityPropertyPermission('activity', field)!)) continue;
        editableFields.push(field);
        if (field === 'description') values.description = plan.description ?? null;
        else values[field] = plan[field];
    }
    return {entityType: 'activity', id: plan.id, values, editableFields, currentEventId: plan.eventId ?? null,
        archived: Boolean(plan.archivedAt), inheritedArchived: Boolean(plan.event?.archivedAt)};
}

/** Metadata refresh and comparisons contain only fields currently visible to this actor. */
function activityMetadataToken(plan: ActivityPlan, data: components['schemas']['ActivityMetadata'], session: SessionLike): string {
    return comparisonToken('activity-meta', plan.id, session, data.values);
}

/** Initial creation retains account-only admission; duplicate GET has its own method grant. */
export function readActivityCreateContext(session: SessionLike): components['schemas']['ActivityCreateContext'] {
    requireEntityCreation('activity', session);
    return getEntityCreationContext('activity');
}

/** Creation entry and event preselection use the same account and event-picker owners. */
export async function readActivityCreateEntry(session: SessionLike, returnTo?: unknown, eventId?: unknown): Promise<components['schemas']['ActivityCreateEntry']> {
    const entry = getEntityCreationAdmission('activity', session, returnTo);
    // URL context does not create or persist a draft, identity, association or plan.
    const selected = entry.kind === 'render' ? await readEventLinkSelection(eventId, session) : null;
    return {entry, context: entry.kind === 'render' ? getEntityCreationContext('activity') : null,
        ...(eventId !== undefined ? {selectedEvent: selected ? {...selected, description: selected.description ?? null} : null} : {})};
}

/** Guest registration reveals only its existing public title and resource identifier. */
export async function readActivityGuestEntry(id: string): Promise<components['schemas']['GuestEntry']> {
    const plan = await requireActivityPlan(id);
    return projectGuestEntry(plan);
}

/** Translate current shared page admission without serializing protected plan content. */
export async function readActivityResourceEntry(id: string, view: 'detail' | 'guest', session: SessionLike): Promise<components['schemas']['ActivityResourceEntry']> {
    const plan = await activityService.getActivityPlanById(id);
    // Preserve the existing read and linked-event admission without loading plan content.
    return getEntityResourceEntry('activity', plan, view, session, {resourceId: id});
}

/** Stored image references remain private; consumers receive only an admitted route and opaque version. */
function activityHeaderProjection(plan: ActivityPlan) {
    return {headerUrl: plan.headerImg ? `/api/v1/activity-plans/${encodeURIComponent(plan.id)}/header` : null,
        headerVersion: getHeaderImageVersion(plan.headerImg)};
}

/** Shared field methods define every slot capability; presentation never grants authority. */
function activitySlotCapabilities(permissions: PermView): components['schemas']['ActivitySlotView']['capabilities'] {
    function allowed(field: keyof components['schemas']['ActivitySlotPatch']): boolean {
        const rule = activitySlotFieldPermissions[field];
        return permissions.allow(rule.permission, rule.parent);
    }
    return {editTitle: allowed('title'), editDescription: allowed('description'), editMeta: allowed('startTime'),
        // The inline title/capacity guard intentionally differs from the
        // modal's meta fallback and the field-specific server authorization.
        inlineMetadataAdmission: permissions.allow('EDIT_META', 'ITEM_EDIT'),
        editCapacity: allowed('maxAssignees'), editRoles: allowed('roles'), manageAssignments: allowed('roles'),
        remove: permissions.allow('ITEM_DELETE', 'ITEM_DELETE')};
}

/** Token values mirror only editable wire fields, including canonical role
 * identities, so the read baseline and conditional write share one projection. */
function activitySlotValues(slot: ActivitySlot, roles: number[], permissions: PermView): components['schemas']['ActivitySlotPatch'] {
    const capabilities = activitySlotCapabilities(permissions);
    return {...(capabilities.editTitle ? {title: slot.title} : {}),
        ...(capabilities.editDescription ? {description: slot.description ?? null} : {}),
        ...(capabilities.editMeta ? {startTime: slot.startTime ?? null, endTime: slot.endTime ?? null} : {}),
        ...(capabilities.editCapacity ? {maxAssignees: slot.maxAssignees ?? null} : {}),
        ...(capabilities.editRoles ? {roles: roles.map(String)} : {})};
}

/** Project the approved Vue civil calendar through the same pure owner used by
 * creation. This versioned presentation adapter performs no reads or writes;
 * shared presentation, domain calculations and printable output keep their owners. */
export function projectActivityScheduleWeeks(startDate: string, endDate: string): components['schemas']['ActivityWeek'][] {
    return civilDateWeeks(startDate, endDate);
}

/** Assemble ACT-01–07 through the existing view/requirements owners, then explicitly redact the wire projection. */
export async function readActivityPlan(id: string, session: SessionLike) {
    const profileId = activityActorId(session);
    const plan = await requireActivityPlan(id);
    const permissions = await activityPermissions(plan, session);
    if (await getEntityViewAdmission('activity', plan, session, undefined, permissions) !== 'render') throw new ApiProblem('FORBIDDEN');
    // Existing production owners calculate counts, attendance and saved requirement progress.
    // The transport never spreads an ORM root, assignment, profile or event into its response.
    const source = await fetchForView(plan, {session} as Request, true);
    const bundle = await activityPermissionBundle(plan, session);
    const slots: components['schemas']['ActivitySlotView'][] = [];
    for (const slot of Object.values(source.slots).flat()) {
        const itemPermissions = bundle.item(slot.id);
        const visible = itemPermissions.allow('ACCESS_PARTICIPANTS', 'ACCESS_PARTICIPANTS');
        const assigned = source.assigneeLists[slot.id] ?? [];
        const own = assigned.find(assignment => assignment.profileId === profileId);
        const configured = source.roles.slotRoles[slot.id] ?? [];
        const values = activitySlotValues(slot, configured.map(role => role.id), itemPermissions);
        const roles = configured.map(role => {
            // A role remains visible while its holder's identity and removable
            // assignment handle follow the independent participant permission.
            const assignee = assigned.find(assignment => assignment.roles.includes(role.name));
            return {id: String(role.id), name: role.name, maxQty: role.maxQty, assignedQty: role.assignedQty,
                assignmentId: visible && assignee ? String(assignee.id) : null,
                assigneeName: visible && assignee ? assignee.name : null, self: assignee?.profileId === profileId};
        });
        slots.push({id: slot.id, day: slot.day, position: slot.pos, title: slot.title, description: slot.description ?? null,
            startTime: slot.startTime ?? null, endTime: slot.endTime ?? null, maxAssignees: slot.maxAssignees ?? null,
            assignedCount: slot.assignedCount, selfAssigned: Boolean(own), selfRoles: own?.roles ?? [], roles,
            assignees: visible ? assigned.map(assignment => ({assignmentId: String(assignment.id), name: assignment.name, roles: assignment.roles})) : [],
            capabilities: activitySlotCapabilities(itemPermissions), editToken: comparisonToken('activity-slot', slot.id, session, values)});
    }
    // Participant privacy is enforced by this new boundary; the shared
    // IMP-018 projection is neither serialized nor silently repaired here.
    const participants: components['schemas']['ActivityParticipant'][] = [];
    if (permissions.has('ACCESS_PARTICIPANTS')) {
        for (const participant of source.participantList) {
            // Whitelist the existing status fields; attendance is bounded rather
            // than exposing a registration/profile row or future source fields.
            participants.push({participantKey: participant.participantKey, name: participant.name,
                nameIsFallback: participant.nameIsFallback === true, count: participant.count,
                assignedShifts: participant.assignedShifts, roles: participant.roles, roleIds: (participant.roleIds ?? []).map(String),
                requiredShifts: participant.requiredShifts, remainingShifts: participant.remainingShifts,
                source: participant.source, attendanceDays: participant.attendanceDays, assignmentMode: participant.assignmentMode,
                attendance: participant.attendance ? {arrivalDate: participant.attendance.arrivalDate ?? null,
                    departureDate: participant.attendance.departureDate ?? null} : null});
        }
    }
    let currentEventUrl: string | null = null;
    if (plan.event) {
        const views = await evaluateEntities([{entityType: 'event', entityId: plan.event.id, ownerId: plan.event.ownerId, eventId: plan.event.id}], session);
        currentEventUrl = getAuthorizedEventUrl(plan.event.id, views.get(`event:${plan.event.id}`)!)?.replace(/^\/event(?=\/|$)/u, '/event') ?? null;
    }
    const metadata = activityMetadataProjection(plan, permissions);
    const data: components['schemas']['ActivityView'] = {
        entityType: 'activity', id, title: plan.title, description: plan.description ?? null,
        startDate: plan.startDate, endDate: plan.endDate, ...activityHeaderProjection(plan),
        currentEventId: plan.eventId ?? null, currentEventUrl, archived: Boolean(plan.archivedAt),
        inheritedArchived: Boolean(plan.event?.archivedAt), assignmentMode: plan.assignmentMode, canSelfAssign: source.canSelfAssign,
        allowOverfillAfterFull: Boolean(plan.allowOverfillAfterFull), bindingDeadline: plan.bindingDeadline?.toISOString() ?? null,
        requirementProgress: source.requirementProgress ?? null, slots, weeks: projectActivityScheduleWeeks(plan.startDate, plan.endDate),
        allRoles: source.roles.allRoles.map(role => ({id: String(role.id), title: role.title, description: role.description ?? null})),
        textFields: source.textFields.map(field => ({id: field.id, title: field.title, text: field.text ?? '',
            editToken: comparisonToken('activity-text', field.id, session, {text: field.text ?? '',
                ...(permissions.has('MANAGE_REQUIREMENTS') ? {title: field.title} : {})}),
            capabilities: {edit: permissions.has('ACCESS_VIEW'), editTitle: permissions.has('MANAGE_REQUIREMENTS'), delete: permissions.has('MANAGE_REQUIREMENTS')}})),
        participants, counters: {participants: permissions.has('ACCESS_PARTICIPANTS') ? source.counters.participants : null,
            open: source.counters.open, empty: source.counters.empty},
        orderToken: comparisonToken('activity-order', id, session, {order: slots.map(slot => ({slotId: slot.id, position: slot.position}))}),
        capabilities: {editTitle: metadata.editableFields.includes('title'), editDescription: metadata.editableFields.includes('description'),
            editDates: metadata.editableFields.includes('startDate') || metadata.editableFields.includes('endDate'),
            addSlot: permissions.has('ITEM_ADD'), reorderSlots: permissions.has('ITEM_EDIT'),
            manageSettings: Boolean(metadata.editableFields.length || permissions.any('MANAGE_PERMISSIONS', 'EDIT_META', 'DATA_DUPLICATE', 'DATA_EXPORT') || isOwner(session, plan.ownerId)),
            // Role creation has a separate browser EDIT_META admission;
            // its unchanged server operation still requires MANAGE_ASSIGNMENTS.
            manageRequirements: permissions.has('MANAGE_REQUIREMENTS'), manageRecommendations: permissions.has('MANAGE_ASSIGNMENTS'),
            roleCreationAdmission: permissions.has('EDIT_META'), exportSchedule: permissions.has('DATA_EXPORT'),
            // The retained advanced destination is a root grant on linked plans;
            // empty schedules and unrelated item grants do not change its visibility.
            rulesWorkspace: Boolean(plan.eventId && permissions.any('MANAGE_REQUIREMENTS', 'MANAGE_ASSIGNMENTS')),
            duplicate: Boolean(session.auth?.user && permissions.has('DATA_DUPLICATE')), remove: isOwner(session, plan.ownerId)},
    };
    return {data, etag: entityTag('activity-view', {profileId, data})};
}

/** Creation reuses existing validation, root/slot transaction and audience persistence in their established order. */
export async function createActivityPlan(body: components['schemas']['ActivityCreateInput'], file: Express.Multer.File | undefined, session: SessionLike,
    prepare?: ActivityCommandPreparation<components['schemas']['ActivityCreated']>, persisted?: ActivityCreationCompletion): Promise<components['schemas']['ActivityCreated']> {
    readActivityCreateContext(session);
    checkNewImage(file);
    await authorizeEventLink(body.eventId, session);
    // Adapt only wire names and grouping; form parsing still owns date/time checks.
    const grouped: Record<string, unknown[]> = {};
    for (const slot of body.slots) (grouped[slot.day] ??= []).push({...slot, pos: slot.position, position: undefined});
    const parsed = preprocessCreate({...body, slots: JSON.stringify(grouped), event_id: body.eventId ?? ''});
    parsed.headerImg = file?.path;
    function prepareCreated(id: string): void { prepare?.({id}); }
    const id = await createEntity(activityActorId(session), parsed, prepareCreated);
    // Root/slot persistence is already final under the inherited creation order.
    // A later defaults failure must never delete that persisted root's image.
    persisted?.(id);
    await saveDefaultPermsFromBody('activity', id, {defaultPerms: body.defaultPermissions}, {inputFormat: 'masks'});
    return {id};
}

/** Duplicate form content without creation constraints: existing edits may need
 * correction in the copied form. Membership, images, history and ACLs are excluded. */
export async function readActivityDuplicate(id: string, session: SessionLike, eventId?: unknown): Promise<components['schemas']['ActivityDuplicate']> {
    const {plan} = await requireActivityMethod(id, 'DATA_DUPLICATE', session);
    const slots = Object.values(await fetchForDuplicate(plan, session as Request['session'])).flat();
    const selected = eventId !== undefined ? await readEventLinkSelection(eventId, session) : null;
    // Match form defaults without hiding signed capacities or blank titles;
    // submitting the copied draft still uses the stricter creation contract.
    return {title: plan.title, description: plan.description ?? null, startDate: plan.startDate, endDate: plan.endDate,
        eventId: null, slots: slots.map(slot => ({id: generateUniqueId(), day: slot.day, position: slot.pos, title: slot.title,
            description: slot.description ?? '', startTime: slot.startTime ?? null, endTime: slot.endTime ?? null, maxAssignees: slot.maxAssignees || 1})),
        defaultPermissions: completeDefaults(await adminService.getDefaultPerms('activity', id)), formContext: getEntityCreationContext('activity'),
        ...(eventId !== undefined ? {selectedEvent: selected ? {...selected, description: selected.description ?? null} : null} : {})};
}

/** Field-only baseline supports independently granted edits without granting the detail page. */
export async function readActivityMetadata(id: string, session: SessionLike) {
    const plan = await requireActivityPlan(id);
    const data = activityMetadataProjection(plan, await activityPermissions(plan, session));
    if (!data.editableFields.length) throw new ApiProblem('FORBIDDEN');
    return {data, etag: activityMetadataToken(plan, data, session)};
}

/** Patch metadata under the existing root lock, preserving dates/assignments and preparing before commit. */
export async function patchActivityMetadata(id: string, body: components['schemas']['ActivityMetadataPatch'], session: SessionLike, token?: string,
    prepare?: ActivityCommandPreparation<components['schemas']['ActivityMetadata']>) {
    const patch = normalizeActivityProperties(body);
    const data = await saveActivityProperties(id, patch, undefined, {session, token, prepare}) as components['schemas']['ActivityMetadata'];
    return {data, etag: comparisonToken('activity-meta', id, session, data.values)};
}

/** Settings compose shared metadata, event, lifecycle and access owners with their existing grants. */
export async function readActivitySettings(id: string, session: SessionLike): Promise<components['schemas']['ActivitySettings']> {
    activityActorId(session);
    const plan = await requireActivityPlan(id);
    const permissions = await activityPermissions(plan, session);
    const metadata = activityMetadataProjection(plan, permissions);
    const owns = isOwner(session, plan.ownerId);
    if (!owns && !metadata.editableFields.length && !permissions.any('EDIT_META', 'MANAGE_PERMISSIONS', 'DATA_DUPLICATE', 'DATA_EXPORT')) throw new ApiProblem('FORBIDDEN');
    const property = await getEntityPropertyPresentation('activity', plan, session);
    const archive = (await getArchivePresentations([{type: 'activity', id}], session)).get(`activity:${id}`)!;
    let access: components['schemas']['PackingAccess'] | null = null;
    if (permissions.has('MANAGE_PERMISSIONS')) {
        const admins = await adminService.listAdmins('activity', id);
        access = {defaults: completeDefaults(await adminService.getDefaultPerms('activity', id)), ...permissionDefinitions(),
            admins: admins.map(admin => ({profileId: admin.profileId, name: admin.profile.name, isGuest: Boolean(admin.profile.guestId),
                mask: admin.perms, editToken: comparisonToken('activity-admin', `${id}:${admin.profileId}`, session, {mask: admin.perms})}))};
    }
    // Parent disclosure follows its independent method grant, not child management.
    const current = property.currentEvent;
    const currentEvent = current ? {id: current.id, title: current.title ?? null, startDate: current.startDate ?? null,
        endDate: current.endDate ?? null, url: current.url?.replace(/^\/event(?=\/|$)/u, '/event') ?? null} : null;
    return {id, title: plan.title, ...activityHeaderProjection(plan),
        editableFields: metadata.editableFields,
        settingsToken: comparisonToken('activity-settings', id, session, {eventId: plan.eventId ?? null, header: plan.headerImg ?? null,
            ...(access ? {...permissionDefaultComparisonValues(access.defaults), newAdmin: null} : {})}),
        capabilities: {editHeader: permissions.has(entityMethodPermission('editHeader')), linkEvent: permissions.has(entityMethodPermission('changeEvent')),
            managePermissions: permissions.has('MANAGE_PERMISSIONS'), duplicate: Boolean(session.auth?.user && permissions.has('DATA_DUPLICATE')),
            remove: owns, manageArchive: archive.canManage, archive: archive.canArchive, restore: archive.canRestore,
            manageAutomation: archive.canManageAutomation, export: permissions.has('DATA_EXPORT')},
        currentEvent, archive: {direct: archive.directArchived, inherited: Boolean(archive.inheritedFromEventId),
            archivedAt: plan.archivedAt?.toISOString() ?? null, autoArchivePaused: archive.autoArchivePaused,
            hasAutomaticSchedule: archive.hasAutomaticSchedule, eventUrl: currentEvent?.url ?? null}, access};
}

/** Event discovery uses event-picker admission and excludes credentials/private parent fields. */
export async function searchActivityEvents(query: unknown, session: SessionLike): Promise<components['schemas']['ActivityEventOptions']> {
    const result = await getEventLinkOptions(query, session);
    return {items: result.items.map(event => ({...event, description: event.description ?? null})),
        selected: result.selected ? {...result.selected, description: result.selected.description ?? null} : null, nextCursor: result.nextCursor};
}

/** Relinking delegates current parent locks, attachment policy and recommendation invalidation to the shared owner. */
export async function changeActivityEvent(id: string, body: components['schemas']['ActivityEventChange'], session: SessionLike, token?: string,
    prepare?: ActivityCommandPreparation<components['schemas']['ActivityEventChanged']>): Promise<components['schemas']['ActivityEventChanged']> {
    const plan = await requireActivityPlan(id);
    /** The existing relink owner invokes this only after its current authority
     * and meaningful-change checks, while retaining its parent/root locks. */
    async function reviewContext(manager: EntityManager): Promise<void> {
        const current = await requireActivityPlan(id, manager);
        requireFieldComparison(token, comparisonToken('activity-settings', id, session, {eventId: current.eventId ?? null}), ['eventId']);
    }
    // Completion is prepared in that owner's transaction and retains existing page-admission semantics.
    async function prepareCompletion(manager: EntityManager, outcome: import('../../types/EntityPropertyTypes').EntityMutationOutcome) {
        const result = {changed: outcome.changed, canView: await getEntityViewAdmission('activity', outcome.root, session, manager) === 'render'};
        prepare?.(result);
        return result;
    }
    return changeEntityEvent('activity', plan, body, session, invalidateEventContext, reviewContext, {prepare: prepareCompletion});
}

/** Permission-only baseline reveals masks solely to current permission managers. */
export async function readActivityDefaultsBaseline(id: string, session: SessionLike): Promise<components['schemas']['ActivityDefaultsBaseline']> {
    await requireActivityMethod(id, 'MANAGE_PERMISSIONS', session);
    return readEntityPermissionDefaults('activity', id, session);
}

/** Existing audience owner receives numeric masks; no copied permission collector or ACL rule is introduced. */
export async function setActivityDefaults(id: string, defaults: components['schemas']['PermissionDefaultsPatch'], session: SessionLike, token?: string): Promise<void> {
    await requireActivityMethod(id, 'MANAGE_PERMISSIONS', session);
    // Preserve the shared owner and its write order; the new transport rejects
    // an already-stale reviewed audience before invoking that unchanged write.
    await updateEntityPermissionDefaults('activity', id, defaults, session, token);
}

/** Administrator-only baseline exposes exactly the requested profile's existing grant. */
export async function readActivityAdminBaseline(id: string, profileId: string, session: SessionLike): Promise<components['schemas']['ActivityAdminBaseline']> {
    await requireActivityMethod(id, 'MANAGE_PERMISSIONS', session);
    return readEntityAdministratorBaseline('activity', id, profileId, session);
}

/** The existing administrator controller retains profile validation and persistence semantics. */
export async function setActivityAdmin(id: string, profileId: string, mask: number | null, session: SessionLike, token?: string): Promise<void> {
    await requireActivityMethod(id, 'MANAGE_PERMISSIONS', session);
    // Existing zero masks remain distinct from absent grants. Validate the same
    // reviewed field before delegating profile validation and actual persistence.
    const reviewed = await reviewEntityAdministrator('activity', id, profileId, mask, session, token);
    const outcome = await applyEntityAdministrator('activity', id, profileId, reviewed.command);
    requireVersionedAdministratorOutcome(outcome);
}

/** Secure profile discovery retains account-only search and permission-management admission. */
export async function searchActivityProfiles(id: string, query: string, session: SessionLike): Promise<components['schemas']['ActivityProfileOptions']> {
    await requireActivityMethod(id, 'MANAGE_PERMISSIONS', session);
    return (await userService.searchUsersSecure(query)).map(profile => ({profileId: profile.id, name: profile.name, username: profile.username, isGuest: false}));
}

/** Method-only header baseline supplies no stored path or protected page fields. */
export async function readActivityHeaderBaseline(id: string, session: SessionLike): Promise<components['schemas']['ActivityHeaderBaseline']> {
    const {plan} = await requireActivityMethod(id, entityMethodPermission('editHeader'), session);
    return {editToken: comparisonToken('activity-settings', id, session, {header: plan.headerImg ?? null})};
}

/** Header bytes retain full detail admission independently of upload authority. */
export async function readActivityHeaderPath(id: string, session: SessionLike): Promise<string> {
    const plan = await requireActivityPlan(id);
    if (await getEntityViewAdmission('activity', plan, session) !== 'render') throw new ApiProblem('FORBIDDEN');
    if (!plan.headerImg) throw new ApiProblem('NOT_FOUND');
    return plan.headerImg;
}

/** Header writes reuse the existing image replacement lifecycle and file cleanup owner. */
export async function setActivityHeader(id: string, file: Express.Multer.File | undefined, session: SessionLike, token?: string): Promise<void> {
    const {plan} = await requireActivityMethod(id, entityMethodPermission('editHeader'), session);
    checkNewImage(file);
    // Header-only callers compare the same field as the full settings dialog;
    // no stored path or unrelated access values leave either baseline.
    requireFieldComparison(token, comparisonToken('activity-settings', id, session, {header: plan.headerImg ?? null}), ['header']);
    if (file) await updateHeaderImg(plan, file);
    else await deleteHeaderImg(plan);
}

/** Archive/restore share existing authorization and retain records, files and assignments. */
export async function setActivityArchived(id: string, archived: boolean, session: SessionLike): Promise<void> {
    activityActorId(session);
    if (archived) await archiveEntity({type: 'activity', id}, {}, session);
    else await restoreEntity({type: 'activity', id}, {}, session);
}

/** Pause/resume only the existing independent schedule through the shared lifecycle owner. */
export async function setActivityAutomaticArchival(id: string, body: components['schemas']['EventAutomaticArchivalInput'], session: SessionLike): Promise<void> {
    activityActorId(session);
    // The shared owner checks current management and standalone scheduling under
    // its existing parent/root locks. Its completion avoids a postcommit read.
    function prepareScheduleCompletion() { return {changed: true}; }
    await setAutomaticArchival({type: 'activity', id}, body, session, {prepare: prepareScheduleCompletion});
}

/** Permanent deletion remains the feature's simple operation and requires the current profile owner. */
export async function deleteActivityPlan(id: string, session: SessionLike): Promise<void> {
    const plan = await requireActivityPlan(id);
    if (!isOwner(session, plan.ownerId)) throw new ApiProblem('FORBIDDEN');
    await deleteEntity(plan, session as Request['session']);
    if (plan.headerImg) removeImage(plan.headerImg);
}

/** Independent slot-edit baseline includes only fields permitted by the existing method grants. */
export async function readActivitySlotBaseline(id: string, slotId: string, session: SessionLike): Promise<components['schemas']['ActivitySlotBaseline']> {
    const {slot, permissions} = await requireActivitySlot(id, slotId, session);
    const configured = await activityService.getActivitySlotRoles(id);
    const values = activitySlotValues(slot, (configured[slotId] ?? []).map(role => role.id), permissions);
    if (!Object.keys(values).length) throw new ApiProblem('FORBIDDEN');
    return {values, editableFields: Object.keys(values) as components['schemas']['ActivitySlotBaseline']['editableFields'],
        editToken: comparisonToken('activity-slot', slotId, session, values)};
}

/** Slot creation delegates range/time/role validation and saved ordering to Quick Add. */
export async function createActivitySlot(id: string, body: components['schemas']['ActivityNewSlot'], session: SessionLike): Promise<void> {
    const {plan} = await requireActivityMethod(id, 'ITEM_ADD', session);
    activityActorId(session);
    await quickAddSlot(plan, {...body, date: body.day}, session);
}

/** Preserve sparse slot writes and role relationship behavior, including the deferred IMP-016 defect. */
export async function patchActivitySlot(id: string, slotId: string, body: components['schemas']['ActivitySlotPatch'], session: SessionLike, token?: string): Promise<void> {
    const {plan, permissions} = await requireActivitySlot(id, slotId, session);
    const bundle = await activityPermissionBundle(plan, session);
    /** Recheck each submitted field against the locked current item rather than
     * treating the initial editor's permission bundle as mutation authority. */
    async function admitSlot(manager: EntityManager, currentPlan: ActivityPlan, currentSlot: ActivitySlot): Promise<void> {
        if (currentPlan.id !== id) throw new ApiProblem('NOT_FOUND');
        const currentPermissions = await activityItemPermissions(currentPlan, currentSlot, session, manager);
        const configured = await activityService.getActivitySlotRoles(id);
        const values = activitySlotValues(currentSlot, (configured[slotId] ?? []).map(role => role.id), currentPermissions);
        for (const field of Object.keys(body)) {
            if (!Object.hasOwn(values, field)) throw new ApiProblem('FORBIDDEN');
        }
        requireFieldComparison(token, comparisonToken('activity-slot', slotId, session, values), Object.keys(body));
    }
    // The attribute operation requires its meta grant even for a mixed editor;
    // description-only saves use their separate shared method and fallback.
    if (Object.keys(body).every(field => field === 'description')) {
        if (!permissions.allow('EDIT_DESC', ['ITEM_EDIT', 'ITEM_EDIT_DESC'])) throw new ApiProblem('FORBIDDEN');
        await updateSlotDescription(slotId, body, admitSlot);
    } else {
        if (!permissions.allow('EDIT_META', ['ITEM_EDIT', 'ITEM_EDIT_META'])) throw new ApiProblem('FORBIDDEN');
        await updateSlotAttr(slotId, {...body}, bundle, admitSlot);
    }
}

/** Item deletion scopes the child and applies the same item/parent deletion grant. */
export async function removeActivitySlot(id: string, slotId: string, session: SessionLike): Promise<void> {
    const {permissions} = await requireActivitySlot(id, slotId, session);
    if (!permissions.allow('ITEM_DELETE', 'ITEM_DELETE')) throw new ApiProblem('FORBIDDEN');
    await deleteSlot(slotId);
}

/** Ordering baseline discloses only slot identifiers/positions to current reorder callers. */
export async function readActivityOrderBaseline(id: string, session: SessionLike): Promise<components['schemas']['ActivityOrderBaseline']> {
    await requireActivityMethod(id, 'ITEM_EDIT', session);
    const order = (await activityService.getActivitySlotsFlat(id)).map(slot => ({slotId: slot.id, position: slot.pos}));
    return {order, editToken: comparisonToken('activity-order', id, session, {order})};
}

/** Direct ordering persists only submitted positions and leaves saved assignments intact. */
export async function setActivityOrder(id: string, body: components['schemas']['ActivityOrderInput'], session: SessionLike, token?: string): Promise<void> {
    await requireActivityMethod(id, 'ITEM_EDIT', session);
    const current = await activityService.getActivitySlotsFlat(id);
    const order = current.map(slot => ({slotId: slot.id, position: slot.pos}));
    requireFieldComparison(token, comparisonToken('activity-order', id, session, {order}), ['order']);
    const slots = new Set(current.map(slot => slot.id));
    if (body.order.some(row => !slots.has(row.slotId))) throw new ApiProblem('NOT_FOUND');
    await reorderSlots(id, body.order.map(row => ({slotId: row.slotId, pos: row.position})));
}

/** Warning previews reuse the existing private sibling projection and opaque exact-overlap acknowledgement. */
export async function previewActivityAssignment(id: string, slotId: string, body: components['schemas']['ActivityWarningTarget'], session: SessionLike): Promise<AssignmentWarningPreview> {
    const {plan} = await requireActivityMethod(id, 'ACCESS_VIEW', session);
    await requireActivitySlot(id, slotId, session);
    return getAssignmentWarningPreview(id, slotId, session as Request['session'], await activityPermissionBundle(plan, session), body);
}

/** Self commands retain distinct whole-slot/named-role behavior, deadline rules and the existing locked warning check. */
export async function setActivityAssignment(id: string, slotId: string, body: components['schemas']['ActivityAssignmentInput'], session: SessionLike): Promise<void> {
    const {plan, permissions} = await requireActivityMethod(id, 'ACCESS_VIEW', session);
    const profileId = activityActorId(session);
    await requireActivitySlot(id, slotId, session);
    // Match the shared binding-deadline admission for both joining and leaving.
    if (plan.bindingDeadline && plan.bindingDeadline.getTime() <= Date.now() && !permissions.has('MANAGE_ASSIGNMENTS')) throw new ApiProblem('FORBIDDEN');
    const operation = body.assigned ? 'assign' : 'unassign';
    await authorizeSelfAssignment(id, slotId, profileId, operation, body.role);
    /** The new transport repeats its own context/method admission inside the
     * shared assignment owner's existing locks, without another write owner. */
    async function admitAssignment(manager: EntityManager, currentPlan: ActivityPlan): Promise<void> {
        if (currentPlan.id !== id) throw new ApiProblem('NOT_FOUND');
        const currentPermissions = await activityPermissions(currentPlan, session, manager);
        if (!currentPermissions.has('ACCESS_VIEW')) throw new ApiProblem('FORBIDDEN');
        if (currentPlan.bindingDeadline && currentPlan.bindingDeadline.getTime() <= Date.now()
            && !currentPermissions.has('MANAGE_ASSIGNMENTS')) throw new ApiProblem('FORBIDDEN');
    }
    if (body.assigned) await assignActivityAssignmentRole(slotId, profileId, body.role ?? 'default', body.overlapConfirmation, admitAssignment);
    else await unassignActivityAssignmentRole(slotId, profileId, body.role, admitAssignment);
}

/** Organizer removal uses the existing assignment owner and its per-item grant. */
export async function removeActivityAssignment(id: string, assignmentId: string, session: SessionLike): Promise<void> {
    const assignment = await activityService.getActivitySlotAssignmentById(Number(assignmentId));
    if (!assignment || assignment.entityId !== id) throw new ApiProblem('NOT_FOUND');
    const {permissions} = await requireActivitySlot(id, assignment.item.id, session);
    if (!permissions.allow('MANAGE_ASSIGNMENTS')) throw new ApiProblem('FORBIDDEN');
    await deleteAssignment(Number(assignmentId));
}

/** Role creation retains the existing controller's name/default semantics and plan ownership. */
export async function createActivityRole(id: string, body: components['schemas']['ActivityRoleInput'], session: SessionLike): Promise<void> {
    const {plan} = await requireActivityMethod(id, 'MANAGE_ASSIGNMENTS', session);
    await addActivityRole(plan, {...body, isDefault: body.isDefault ? 'on' : undefined});
}

/** Organizer role assignment keeps the same signed-up participants, named-role quotas and replacement transaction. */
export async function setActivityRoleAssignments(id: string, slotId: string, body: components['schemas']['ActivityRoleAssignmentsInput'], session: SessionLike): Promise<void> {
    const {permissions} = await requireActivitySlot(id, slotId, session);
    if (!permissions.allow('MANAGE_ASSIGNMENTS', 'MANAGE_ASSIGNMENTS')) throw new ApiProblem('FORBIDDEN');
    await updateRoleAssignments(slotId, body);
}

/** Shared text creation remains distinct from local schedule filters and requires the management grant. */
export async function createActivityTextField(id: string, body: components['schemas']['ActivityTextFieldInput'], session: SessionLike): Promise<void> {
    await requireActivityMethod(id, 'MANAGE_REQUIREMENTS', session);
    await createTextField(id, body);
}

/** Shared text writes retain ACCESS_VIEW for text and the additional MANAGE_REQUIREMENTS title grant. */
export async function patchActivityTextField(id: string, fieldId: string, body: components['schemas']['ActivityTextFieldPatch'], session: SessionLike, token?: string): Promise<void> {
    const {plan} = await requireActivityMethod(id, 'ACCESS_VIEW', session);
    // Text/title baselines are private to their existing method grants; shared
    // persistence remains the unchanged shared controller operation below.
    const field = await activityService.getActivityPlanTextFieldById(fieldId);
    if (!field || field.entityId !== id) throw new ApiProblem('NOT_FOUND');
    const permissions = await activityPermissions(plan, session);
    if (body.title !== undefined && !permissions.has('MANAGE_REQUIREMENTS')) throw new ApiProblem('FORBIDDEN');
    const values = {text: field.text ?? '', ...(permissions.has('MANAGE_REQUIREMENTS') ? {title: field.title} : {})};
    requireFieldComparison(token, comparisonToken('activity-text', fieldId, session, values), Object.keys(body));
    await updateTextField(id, fieldId, body, await activityPermissionBundle(plan, session));
}

/** Text removal keeps its existing child-scope check and management authorization. */
export async function removeActivityTextField(id: string, fieldId: string, session: SessionLike): Promise<void> {
    await requireActivityMethod(id, 'MANAGE_REQUIREMENTS', session);
    await deleteTextField(id, fieldId);
}

/** Project private requirement inputs explicitly, retaining the shared pure engine's
 * saved analysis and calculation inputs without sending ORM relations or profile records. */
export async function readActivityRequirements(id: string, session: SessionLike): Promise<components['schemas']['ActivityRequirements']> {
    // Requirement management has its own method grant, separate from page admission.
    await requireActivityMethod(id, 'MANAGE_REQUIREMENTS', session);
    const [data, allRoles] = await Promise.all([getRequirements(id, true), activityService.getAllRoles(id)]);
    const plan = data.plan;

    // Select scalars from each persistence result before it crosses the versioned
    // boundary. Numeric database handles become strings here; the shared
    // controller, persistence and requirement engines keep their numeric contract.
    return {
        plan: {id: plan.id, assignmentMode: plan.assignmentMode, generalRequiredShifts: plan.generalRequiredShifts ?? null,
            roundingMode: plan.roundingMode ?? null, bindingDeadline: plan.bindingDeadline?.toISOString() ?? null,
            startDate: plan.startDate, endDate: plan.endDate, allowOverfillAfterFull: Boolean(plan.allowOverfillAfterFull),
            allowExternalAssignees: Boolean(plan.allowExternalAssignees), allowArrivalDayEvening: Boolean(plan.allowArrivalDayEvening),
            allowDepartureDayMorning: Boolean(plan.allowDepartureDayMorning)},
        roleRequirements: data.roleRequirements.map(row => ({roleId: String(row.roleId), requiredShifts: row.requiredShifts})),
        stayRequirements: data.stayRequirements.map(row => ({stayDays: row.stayDays, requiredShifts: row.requiredShifts})),
        overrides: data.overrides.map(row => ({id: row.id == null ? undefined : String(row.id), profileId: row.profileId,
            roleId: row.roleId == null ? null : String(row.roleId),
            requiredShifts: row.requiredShifts, profileName: row.profile?.name ?? null})),
        participants: data.participants.map(row => ({participantKey: row.participantKey, name: row.name ?? null,
            roleIds: (row.roleIds ?? []).map(String), requiredShifts: row.requiredShifts, assignedShifts: row.assignedShifts,
            remainingShifts: row.remainingShifts, source: row.source, attendanceDays: row.attendanceDays,
            attendance: {arrivalDate: row.attendance?.arrivalDate ?? null, departureDate: row.attendance?.departureDate ?? null},
            roles: row.roles, assignmentMode: row.assignmentMode})),
        capacitySummary: {availableSlots: data.capacitySummary.availableSlots, requiredSlots: data.capacitySummary.requiredSlots,
            difference: data.capacitySummary.difference, configurationComplete: data.capacitySummary.configurationComplete},
        calculationContext: {
            participants: data.calculationContext.participants.map(row => ({profileId: row.profileId ?? null,
                name: row.name ?? null, arrivalDate: row.arrivalDate ?? null, departureDate: row.departureDate ?? null,
                roleIds: (row.roleIds ?? []).map(String)})),
            assignedShiftCounts: data.calculationContext.assignedShiftCounts,
            slots: data.calculationContext.slots.map(slot => ({id: slot.id, day: slot.day,
                startTime: slot.startTime ?? null, endTime: slot.endTime ?? null, maxAssignees: slot.maxAssignees ?? null,
                roles: slot.roles.map(role => ({...role, roleId: String(role.roleId)}))})),
        },
        overrideTargets: data.overrideTargets.map(row => ({key: row.key, profileId: row.profileId, label: row.label,
            nameIsFallback: row.nameIsFallback === true, arrivalDate: row.arrivalDate, departureDate: row.departureDate})),
        allRoles: allRoles.map(role => ({id: String(role.id), title: role.title, description: role.description ?? null})),
    };
}

/** Preserve the settings transaction and omission retention, with explicit saved-ID removal. */
export async function saveActivityRequirements(id: string, input: components['schemas']['ActivityRequirementsInput'], session: SessionLike): Promise<void> {
    // The existing controller owns all requirement decisions and its transaction lifecycle.
    await requireActivityMethod(id, 'MANAGE_REQUIREMENTS', session);
    const {removedOverrideIds = [], ...settings} = input;
    await updateRequirements(id, settings, removedOverrideIds);
}

/** Recommendations display only their slot labels, never full slot persistence records. */
function activityRecommendationSlot(slot: Pick<ActivitySlot, 'id' | 'title' | 'day' | 'startTime' | 'endTime'>): components['schemas']['ActivityRecommendationSlot'] {
    return {id: slot.id, title: slot.title, day: slot.day, startTime: slot.startTime ?? null, endTime: slot.endTime ?? null};
}

/** Domain job diagnostics remain server-owned; status and identity are sufficient
 * for the localized terminal presentation without exposing worker or database errors. */
function activityRecommendationJob(job: RecommendationJobView): components['schemas']['ActivityRecommendationJob'] {
    return {id: job.id, planId: job.planId, status: job.status, createdAt: job.createdAt, updatedAt: job.updatedAt,
        ...(job.recommendationCount === undefined ? {} : {recommendationCount: job.recommendationCount})};
}

/** Whitelist a warning's operation identity after the shared warning owner redacts sibling details. */
function activityRecommendationWarnings(results: RecommendationWarningResult[]): components['schemas']['ActivityRecommendationWarning'][] {
    // Existing domain warnings are plain scalar projections; normalize their optional profile shape.
    return results.map(result => ({recommendation: {
        ...(result.recommendation.id ? {id: result.recommendation.id} : {}),
        itemId: result.recommendation.itemId, profileId: result.recommendation.profileId ?? undefined,
        status: result.recommendation.status, operation: result.recommendation.operation,
        sourceItemId: result.recommendation.sourceItemId, manual: result.recommendation.manual,
    }, warnings: result.warnings}));
}

/** Entry intentionally retains workspace maintenance/enqueue semantics. Recovery reads and
 * domain-job observation never call that mutation path, so periodic reads cannot start work. */
export async function readActivityRecommendations(id: string, session: SessionLike, enter = false): Promise<components['schemas']['ActivityRecommendations']> {
    // Independently authorize the private recommendation workspace on every invocation.
    await requireActivityMethod(id, 'MANAGE_ASSIGNMENTS', session);
    const data = await getRecommendations(id, session, enter, true);

    // Reuse the existing presentation inputs but exclude ORM timestamps, ownership and relations.
    return {
        recommendations: data.recommendations.map(row => ({id: row.id, item: activityRecommendationSlot(row.item),
            profile: {id: row.profile.id, name: row.profile.name}, sourceItem: row.sourceItem ? activityRecommendationSlot(row.sourceItem) : null,
            status: row.status, operation: row.operation, manual: row.manual})),
        participantOptions: data.participantOptions.map(row => ({key: row.key, profileId: row.profileId, label: row.label,
            nameIsFallback: row.nameIsFallback === true, arrivalDate: row.arrivalDate, departureDate: row.departureDate})),
        slots: data.slots.map(activityRecommendationSlot),
        existingAssignments: data.existingAssignments.map(row => ({item: activityRecommendationSlot(row.item),
            profile: row.profile, roles: row.roles})),
        warnings: activityRecommendationWarnings(data.warnings),
        autoGenerationJob: data.autoGenerationJob ? activityRecommendationJob(data.autoGenerationJob) : null,
    };
}

/** Preview the exact batch with existing source validation and permission-redacted collisions. */
export async function previewActivityRecommendations(id: string, input: components['schemas']['ActivityRecommendationReview'], session: SessionLike): Promise<components['schemas']['ActivityRecommendationPreview']> {
    // Preview remains read-only; its opaque overlap digest grants no broader authority.
    await requireActivityMethod(id, 'MANAGE_ASSIGNMENTS', session);
    const result = await getRecommendationWarningPreview(id, input, session);
    return {warnings: activityRecommendationWarnings(result.warnings), overlapConfirmation: result.overlapConfirmation};
}

/** Apply the submitted batch once, preserving skipped counts, reciprocal moves and
 * inherited postcommit regeneration behavior. No adapter refresh follows the command. */
export async function applyActivityRecommendations(id: string, input: components['schemas']['ActivityRecommendationApplication'], session: SessionLike): Promise<components['schemas']['ActivityRecommendationApplyResult']> {
    // The existing controller rechecks the warning review before its transaction writes.
    await requireActivityMethod(id, 'MANAGE_ASSIGNMENTS', session);
    const result = await applyRecommendations(id, input, session);
    return {applied: result.applied, skipped: result.skipped, warnings: activityRecommendationWarnings(result.warnings)};
}

/** Explicit generation reuses the existing coordinator and coalescing identity. */
export async function generateActivityRecommendations(id: string, session: SessionLike): Promise<components['schemas']['ActivityRecommendationQueued']> {
    // Generation remains a deliberate command; ordinary snapshots cannot dispatch it.
    await requireActivityMethod(id, 'MANAGE_ASSIGNMENTS', session);
    const result = await queueAutoGenerateRecommendations(id);
    return {job: activityRecommendationJob(result.job), coalesced: result.coalesced};
}

/** Observe only the specified domain job, including its current terminal state. */
export async function readActivityRecommendationJob(id: string, jobId: string, session: SessionLike): Promise<components['schemas']['ActivityRecommendationJobResult']> {
    // The existing owner scopes job identity to this plan and returns missing jobs honestly.
    await requireActivityMethod(id, 'MANAGE_ASSIGNMENTS', session);
    const result = await getAutoRecommendationJob(id, jobId);
    return {job: activityRecommendationJob(result.job)};
}
