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
import {assertEntityPropertyContext} from './entityAdminController';
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
} from "../modules/activity/recommendationJobs";
import {
    calculateBaselineRequirementForPlan,
    calculateParticipantRequirement,
    calculateRequirementAnalysis,
    countInclusiveDays,
    hasCompleteStayRequirements,
    ParticipantAttendance,
    RequirementOverrideInput,
    toParticipantKey,
    toParticipantName
} from "../modules/activity/requirements";
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
import {evaluateEntities, saveDefaultPermsFromBody} from "../modules/permissionEngine";
import type {
    ActivityLinkedPlanContext, ActivityPropertyPatch, ActivityRecommendationContext,
    ActivityRecommendationOperationInput, ActivityRecommendationPersistenceContext,
    AssignmentCandidate, AssignmentWarning, AssignmentWarningPreview,
    RecommendationWarningResult, RecommendationWarningPreview, SlotAssignee,
} from "../types/ActivityTypes";
import type {PermBundle, SessionLike} from "../types/PermissionTypes";
import type {EntityBase} from "../types/UserTypes";

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
        throw new APIError('Activity plan context changed; reload and try again', {reason: 'activity-context-changed'}, 409);
    }
    return plan;
}

// The controller wires background persistence to the same command boundary as HTTP edits.
// The coordinator performs scheduling/cache work and never chooses a database write policy.
const recommendationJobCoordinator = new RecommendationJobCoordinator({
    loadContext: loadRecommendationJobContext,
    persist: saveGeneratedRecommendations,
});

async function loadRecommendationJobContext(planId: string): Promise<AutoAssignmentContext> {
    const context = await buildPlanRecommendationContext(planId);
    if (context.plan.assignmentMode === 'FREE') {
        throw new APIError('Automatic recommendations are disabled in free assignment mode', {planId}, 409);
    }
    return context;
}

// Template constant for create errors
const CREATE_TEMPLATE = 'activity/activity-create';

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
    planData: Partial<ActivityPlan> & { slots: Partial<ActivitySlot>[] }
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
    );
}

// No-op since slots handled in transaction
const afterCreateItems = async (id: string, data: any) => {
    await saveDefaultPermsFromBody(ENTITIES.ACTIVITY, id, data._body);
};

/**
 * Assemble data for the view.
 */

async function fetchForView(plan: ActivityPlan, req: Request) {
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
        arrivalDate?: string | null;
        departureDate?: string | null;
        assignedShifts: number;
        roleIds: Set<number>;
        roles: Set<string>;
    }

    const participantStatusMap = new Map<string, ParticipantStatusAccumulator>();
    const ensureParticipantStatus = (
        participantKey: string,
        profileId: string | null | undefined,
        name?: string | null,
    ): ParticipantStatusAccumulator => {
        const existing = participantStatusMap.get(participantKey);
        if (existing) {
            if (name) existing.name = name;
            return existing;
        }
        const created: ParticipantStatusAccumulator = {
            participantKey,
            profileId: profileId ?? undefined,
            name: name || 'Participant',
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
async function saveActivityProperties(planId: string, patch: ActivityPropertyPatch, expectedEventId?: string | null): Promise<void> {
    async function saveProperties(manager: EntityManager): Promise<void> {
        const plan = await requireRecommendationContext(manager, planId);
        assertEntityPropertyContext(plan, expectedEventId);
        const startDate = patch.startDate ?? plan.startDate;
        const endDate = patch.endDate ?? plan.endDate;
        if (startDate > endDate) throw new APIError('Start date must be before end date', {}, 400);
        if (startDate !== plan.startDate || endDate !== plan.endDate) {
            if (await activityService.hasActivitySlotsOutsideRange(manager, planId, startDate, endDate)) {
                throw new APIError('The activity date range must include every saved slot', {}, 409);
            }
            // Cancel while holding the lock: even a change back to the original dates
            // must invalidate a waiting job. Cancellation after rollback is conservative.
            invalidateEventContext(planId);
            await recommendationService.invalidateGeneratedRecommendations(manager, planId);
        }
        await activityService.updateActivityPlanProperties(planId, patch, manager);
    }
    await activityService.withActivityTransaction(saveProperties);
}

function validateSlotDate(plan: ActivityPlan, day?: string): void {
    if (!day || day < plan.startDate || day > plan.endDate) {
        throw new APIError('Slot date must be within the activity plan date range', {}, 400);
    }
}

/** Serialize edits with narrowing the parent range; missing snapshots become controller errors. */
async function saveActivitySlot(slotId: string, fields: Partial<ActivitySlot>): Promise<boolean | undefined> {
    const current = await activityService.getActivitySlotById(slotId);
    if (!current) throw new APIError('Activity slot not found', {slotId}, 404);
    const planId = current.entityId;
    async function saveSlot(manager: EntityManager): Promise<boolean | undefined> {
        const plan = await requireRecommendationContext(manager, planId);
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

async function quickAddSlot(plan: ActivityPlan, body: any, session: SessionLike) {
    const {date, title = '', description = '', startTime, endTime, maxAssignees = 1, roles = []} = body;
    const d = fromISOtoLocal(date);
    if (d < fromISOtoLocal(plan.startDate) || d > fromISOtoLocal(plan.endDate))
        throw new APIError('Date outside range', body, 400);

    if (!title) throw new APIError('Title required', body, 400);

    const timePattern = /^\d{2}:\d{2}(?::\d{2})?$/;
    if (startTime && !timePattern.test(startTime)) {
        throw new APIError('Invalid start time', body, 400);
    }
    if (endTime && !timePattern.test(endTime)) {
        throw new APIError('Invalid end time', body, 400);
    }
    if (startTime && endTime && startTime >= endTime) {
        throw new APIError('End time must be after start time', body, 400);
    }

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

    async function saveSlot(manager: EntityManager): Promise<void> {
        const currentPlan = await requireRecommendationContext(manager, plan.id);
        validateSlotDate(currentPlan, slot.day);
        await activityService.addActivitySlots(plan.id, [slot], session.profile!.id, manager);
    }
    await activityService.withActivityTransaction(saveSlot);

    if (normalizedRoles.length > 0) {
        await activityService.addActivitySlotRoles(slot.id!, normalizedRoles);
    }
    return 'Slot added';
}

async function updateSlotDescription(slotId: string, body: any) {
    if (!(await saveActivitySlot(slotId, {description: body.description}))) {
        throw new APIError('Unknown error while saving', body, 500);
    }
    return 'Description updated';
}

async function updateSlotAttr(slotId: string, body: any, permData?: PermBundle) {
    const {field, value} = body;
    if (field !== undefined && value !== undefined) body[field] = value;
    // Permission check
    if (!permData ||
        ((body.startTime !== undefined || body.endTime !== undefined) && !permData.itemAllow(slotId, "EDIT_META", ["ITEM_EDIT", "ITEM_EDIT_META"]))
        || (body.title !== undefined && !permData.itemAllow(slotId, "EDIT_TITLE", "ITEM_EDIT"))
        || (body.description !== undefined && !permData.itemAllow(slotId, "EDIT_DESC", ["ITEM_EDIT", "ITEM_EDIT_DESC"]))
        || (body.maxAssignees !== undefined && !permData.itemAllow(slotId, "EDIT_CAPACITY", "ITEM_EDIT"))
        || (body.roles !== undefined && !permData.itemAllow(slotId, "MANAGE_ASSIGNMENTS", "MANAGE_ASSIGNMENTS"))
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

    if (!(await saveActivitySlot(slotId, staged))) {
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

async function getRequirements(planId: string) {
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
 * Their existence never authorizes a new target or a changed override for a nonparticipant.
 */
async function mergeRequirementOverrides(
    manager: EntityManager,
    plan: ActivityPlan,
    submitted: RequirementOverrideInput[],
): Promise<RequirementOverrideInput[]> {
    const {overrides: saved} = await requireRequirementConfiguration(plan.id, manager);
    const savedById = new Map(saved.map((override) => [override.id, override]));
    const registered = new Set(plan.eventId ? await activityService.getRegisteredProfileIds(manager, plan.eventId) : []);
    const result: RequirementOverrideInput[] = [];
    const submittedIds = new Set<number>();
    const targetKeys = new Set<string>();
    for (const input of submitted) {
        const override = {...input, roleId: input.roleId ?? null};
        const previous = override.id == null ? undefined : savedById.get(override.id);
        if (override.id != null && (!previous || submittedIds.has(override.id))) {
            throw new APIError('Override does not belong to this activity plan or is duplicated', {}, 400);
        }
        const unchanged = previous && previous.profileId === override.profileId
            && (previous.roleId ?? null) === (override.roleId ?? null)
            && previous.requiredShifts === override.requiredShifts;
        if (!unchanged && (!override.profileId || !registered.has(override.profileId))) {
            throw new APIError('Overrides must target participants registered for this event', {}, 400);
        }
        const key = `${override.profileId}:${override.roleId ?? ''}`;
        if (targetKeys.has(key)) throw new APIError('An override target may only appear once', {}, 400);
        targetKeys.add(key);
        if (override.id != null) submittedIds.add(override.id);
        result.push(override);
    }
    // Omission still removes a current participant's override, as in the existing editor.
    // A former participant is absent from that editor's choices, so omission must retain
    // the original row instead of turning an unrelated settings save into data deletion.
    for (const previous of saved) {
        if (registered.has(previous.profileId) || submittedIds.has(previous.id)) continue;
        result.push({
            id: previous.id,
            profileId: previous.profileId,
            roleId: previous.roleId ?? null,
            requiredShifts: previous.requiredShifts,
        });
    }
    return result;
}

async function updateRequirements(planId: string, body: any) {
    const {roleRequirements, stayRequirements, overrides, ...planSettings} = preprocessRequirementUpdate(body);
    const expectedPlan = await activityService.getActivityPlanById(planId);
    async function saveRequirements(manager: EntityManager): Promise<void> {
        const plan = await requireRecommendationContext(manager, planId);
        if (expectedPlan && (expectedPlan.eventId ?? null) !== (plan.eventId ?? null)) {
            throw new APIError('Activity plan event changed; reload the requirements', {}, 409);
        }

        if (!plan.eventId) {
            throw new APIError('Event is required to configure participant overrides', {planId}, 400);
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
            );
        }

        const planDays = countInclusiveDays(plan.startDate, plan.endDate);
        const invalidStayRequirement = stayRequirements.find((requirement) => requirement.stayDays > planDays);
        if (invalidStayRequirement) {
            throw new APIError('Stay duration cannot exceed the activity plan duration', invalidStayRequirement, 400);
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

        const retainedOverrides = await mergeRequirementOverrides(manager, plan, overrides);
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

function requireOverlapConfirmation(expected: string | undefined, submitted: unknown): void {
    if (expected && submitted !== expected) {
        throw new APIError('Review the current overlap warnings and confirm again before applying this assignment',
            {reason: 'activity-overlap-confirmation-required'}, 409);
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

async function validateRecommendationTargets(planId: string, recommendations: {
    itemId: string;
    profileId?: string | null;
    status?: RecommendationStatus;
    operation?: RecommendationOperation;
    sourceItemId?: string | null;
}[], validateAssignmentState = false, manager?: EntityManager) {
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
        throw new APIError('Recommendation slot does not belong to this activity plan', invalidSlot, 400);
    }
    const invalidSourceSlot = recommendations.find(
        (recommendation) => recommendation.sourceItemId && !allowedSlotIds.has(recommendation.sourceItemId),
    );
    if (invalidSourceSlot) {
        throw new APIError('Recommendation source slot does not belong to this activity plan', invalidSourceSlot, 400);
    }

    if (validateAssignmentState) {
        const targetPairs = new Set<string>();
        const sourcePairs = new Set<string>();
        for (const recommendation of recommendations) {
            if (["APPLIED", "REJECTED"].includes(recommendation.status ?? "PENDING")) continue;
            const operation = recommendation.operation ?? "ASSIGN";
            const targetPair = `${recommendation.itemId}:${recommendation.profileId}`;
            if (operation !== "UNASSIGN") {
                if (targetPairs.has(targetPair)) {
                    throw new APIError('Duplicate recommendation target', recommendation, 409);
                }
                targetPairs.add(targetPair);
            }
            const targetAssignees = assignees[recommendation.itemId] ?? [];
            const targetAssignment = targetAssignees.find(
                (assignee) => assignee.profileId === recommendation.profileId,
            );
            if (operation === "ASSIGN" && targetAssignment) {
                throw new APIError('Participant is already assigned to the recommendation slot', recommendation, 409);
            }
            const sourceItemId = operation === "REASSIGN"
                ? recommendation.sourceItemId
                : operation === "UNASSIGN"
                    ? recommendation.itemId
                    : null;
            if (sourceItemId) {
                const sourcePair = `${sourceItemId}:${recommendation.profileId}`;
                if (sourcePairs.has(sourcePair)) {
                    throw new APIError('An assignment can only be changed once per recommendation batch', recommendation, 409);
                }
                sourcePairs.add(sourcePair);
                const sourceAssignment = (assignees[sourceItemId] ?? []).find(
                    (assignee) => assignee.profileId === recommendation.profileId,
                );
                if (!sourceAssignment) {
                    throw new APIError('Recommendation source assignment no longer exists', recommendation, 409);
                }
                if (
                    operation === "REASSIGN"
                    && sourceAssignment.roles.some((role) => role !== "default")
                ) {
                    throw new APIError(
                        'Assignments with named roles cannot be automatically reassigned',
                        recommendation,
                        409,
                    );
                }
            }
            if (operation === "REASSIGN" && targetAssignment) {
                throw new APIError('Participant is already assigned to the recommendation slot', recommendation, 409);
            }
        }
    }

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
        throw new APIError('Recommendations must target participants registered for this event', invalidProfile, 400);
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
            throw new APIError('Activity role is required', {slotId, roleName}, 400);
        }
        const slotRoles = await activityService.getActivitySlotRoles(planId);
        requestedRole = slotRoles[slotId]?.find((role) => role.name === roleName);
        if (!requestedRole) {
            throw new APIError('Activity role is not available for this slot', {slotId, roleName}, 400);
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
        throw new APIError('This activity slot is already full', {planId, slotId}, 409);
    }

    if (requestedRole && requestedRole.maxQty > 0) {
        const alreadyHasRole = existingAssignee?.roles.includes(requestedRole.name);
        const roleCount = assignees.filter((assignee) => assignee.roles.includes(requestedRole!.name)).length;
        if (!alreadyHasRole && roleCount >= requestedRole.maxQty) {
            throw new APIError('This activity role is already full', {planId, slotId, roleName}, 409);
        }
    }
}

async function getRecommendations(planId: string, session?: SessionLike) {
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
    const recommendations = initialRecommendations.filter(
        (recommendation) => !obsoletePendingIds.includes(recommendation.id),
    );
    const visibleRecommendations = recommendations.filter(
        (recommendation) => !recommendation.hidden && recommendation.status !== "APPLIED",
    );
    let autoGenerationJob;

    // If the binding deadline passed and no recommendations exist, seed them automatically
    if (shouldAutoGenerateRecommendations(plan, recommendations)) {
        const queued = await queueAutoGenerateRecommendations(planId);
        autoGenerationJob = queued.job;
    }

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
        throw new APIError('Reassignment requires a different source slot', input, 400);
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
                throw new APIError('Activity plan inputs changed; generate recommendations again', {reason: 'activity-context-changed'}, 409);
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
        throw new APIError('Plan inputs changed while recommendations were being calculated', {}, 409);
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
        throw new APIError('Automatic recommendations are disabled in free assignment mode', {planId}, 409);
    }
    const requirementConfig = await requireRequirementConfiguration(planId);
    const planDays = countInclusiveDays(plan.startDate, plan.endDate);
    if (!hasCompleteStayRequirements(planDays, requirementConfig.stayRequirements)) {
        throw new APIError(
            `Automatic recommendations need saved stay-duration requirements for days 1 through ${planDays}`,
            {planId},
            409,
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

async function queueAutoGenerateRecommendations(planId: string) {
    const plan = await activityService.getActivityPlanById(planId);
    if (!plan) throw new APIError('Activity plan not found', {planId}, 404);
    if (plan.assignmentMode === "FREE") {
        throw new APIError('Automatic recommendations are disabled in free assignment mode', {planId}, 409);
    }
    const requirementConfig = await requireRequirementConfiguration(planId);
    const planDays = countInclusiveDays(plan.startDate, plan.endDate);
    if (!hasCompleteStayRequirements(planDays, requirementConfig.stayRequirements)) {
        throw new APIError(
            `Automatic recommendations need saved stay-duration requirements for days 1 through ${planDays}`,
            {planId},
            409,
        );
    }

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

async function validatePlanRoleIds(planId: string, roles: unknown, body: unknown): Promise<number[]> {
    if (!Array.isArray(roles)) throw new APIError('Invalid roles', {body}, 400);
    const normalized = roles.map(Number);
    if (normalized.some((roleId) => !Number.isInteger(roleId) || roleId <= 0)) {
        throw new APIError('Invalid roles', {body}, 400);
    }

    const allowed = new Set((await activityService.getAllRoles(planId)).map((role) => role.id));
    if (normalized.some((roleId) => !allowed.has(roleId))) {
        throw new APIError('Roles must belong to this activity plan', {body}, 400);
    }
    return [...new Set(normalized)];
}

async function addActivityRole(plan: ActivityPlan, body: any) {
    const {name, description, isDefault} = body;
    if (!name || name === "default") throw new APIError('Missing name', body, 400);
    return activityService.ensureRoleId(plan.id, name, isDefault === 'on', description);
}

/** Role quotas and assignment ownership are checked before replacing any role links. */
async function updateRoleAssignments(slotId: string, body: any) {
    const {assignments} = body;
    if (!Array.isArray(assignments)) throw new APIError('Not an array', body, 400);
    const current = await activityService.getActivitySlotById(slotId);
    if (!current) throw new APIError('Activity slot not found', {slotId}, 404);
    const planId = current.entityId;
    async function saveRoles(manager: EntityManager): Promise<void> {
        await requireRecommendationContext(manager, planId);
        const [slot] = await activityService.getLockedActivitySlots(manager, [slotId]);
        if (!slot) throw new APIError('Activity slot not found', {slotId}, 404);
        const configured = await activityService.getConfiguredSlotRoles(manager, slotId);
        const byName = new Map(configured.map((entry) => [entry.role.title, entry]));
        const currentAssignments = await activityService.getLockedPlanAssignments(manager, planId, slotId);
        const assignmentIds = new Set(currentAssignments.map((assignment) => assignment.id));
        const requestedCounts = new Map<string, number>();
        const rows: {assignmentId: number; roleId: number}[] = [];
        for (const entry of assignments) {
            const role = entry && byName.get(entry.role);
            if (!role) throw new APIError('Roles must be configured for this activity slot', body, 400);
            const assignmentId = entry.assignmentId === null ? null : Number.parseInt(entry.assignmentId) || null;
            if (assignmentId === null) continue;
            if (!assignmentIds.has(assignmentId)) throw new APIError('Assignment not found in this slot', body, 400);
            const count = (requestedCounts.get(entry.role) ?? 0) + 1;
            if (entry.role !== 'default' && count > (role.maxQty ?? 0)) {
                throw new APIError('This activity role is already full', {slotId, role: entry.role}, 409);
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
async function assignActivityAssignmentRole(itemId: string, profileId: string, roleName = 'default', confirmation?: unknown): Promise<void> {
    const current = await activityService.getActivitySlotById(itemId);
    if (!current) throw new APIError('Activity slot not found', {itemId}, 404);
    const planId = current.entityId;
    async function assignParticipant(manager: EntityManager): Promise<void> {
        const plan = await requireRecommendationContext(manager, planId);
        const [slot] = await activityService.getLockedActivitySlots(manager, [itemId]);
        if (!slot) throw new APIError('Activity slot not found', {itemId}, 404);
        const assignments = await activityService.getLockedPlanAssignments(manager, planId, itemId);
        const existing = assignments.find((assignment) => assignment.profile.id === profileId);
        if (!existing && !plan.allowOverfillAfterFull && slot.maxAssignees != null && assignments.length >= slot.maxAssignees) {
            throw new APIError('This activity slot is already full', {itemId}, 409);
        }
        let role = await activityService.getActivityRoleByName(manager, planId, roleName);
        if (!role && roleName !== 'default') {
            throw new APIError('Activity role is not available for this plan', {itemId, roleName}, 400);
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
            if (!slotRole) throw new APIError('Activity role is not available for this slot', {itemId, roleName}, 400);
            let roleCount = 0;
            for (const assignment of assignments) {
                if (assignmentHasRole(assignment, roleId)) roleCount++;
            }
            // Slot overfill does not relax the independently configured named-role quota.
            if (slotRole.maxQty != null && roleCount >= slotRole.maxQty) {
                throw new APIError('This activity role is already full', {itemId, roleName}, 409);
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
async function unassignActivityAssignmentRole(itemId: string, profileId: string, roleName = 'default'): Promise<void> {
    const current = await activityService.getActivitySlotById(itemId);
    if (!current) return;
    const planId = current.entityId;
    async function unassignParticipant(manager: EntityManager): Promise<void> {
        await requireRecommendationContext(manager, planId);
        await activityService.getLockedActivitySlots(manager, [itemId]);
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
            throw new APIError("Recommendation slot does not belong to this activity plan", {planId}, 400);
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
                    throw new APIError('Recommendations must target participants registered for this event', operation, 400);
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
                    throw new APIError("Participant is already assigned to the recommendation slot", operation, 409);
                }
                additionPairs.add(targetPair);
                additions.push(operation);
                continue;
            }

            const sourceItemId = operation.operation === "REASSIGN"
                ? operation.sourceItemId
                : operation.itemId;
            if (!sourceItemId) {
                throw new APIError("Reassignment requires a source slot", operation, 400);
            }
            const source = assignmentByPair.get(pairKey(sourceItemId, operation.profileId));
            if (!source) {
                throw new APIError("Recommendation source assignment no longer exists", operation, 409);
            }
            if (removals.has(source.id)) {
                throw new APIError("An assignment can only be changed once per recommendation batch", operation, 409);
            }

            if (operation.operation === "REASSIGN") {
                if (sourceItemId === operation.itemId) {
                    throw new APIError("Reassignment target must differ from its source", operation, 400);
                }
                if (source.activityAssignmentRoles.some(({role}) => !role.isDefault)) {
                    throw new APIError("Assignments with named roles cannot be automatically reassigned", operation, 409);
                }
                if (assignmentByPair.has(targetPair) || additionPairs.has(targetPair)) {
                    throw new APIError("Participant is already assigned to the recommendation slot", operation, 409);
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
                throw new APIError("This activity slot is already full", addition, 409);
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
