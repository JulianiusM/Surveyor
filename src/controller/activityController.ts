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
// Business logic for the Activity routes
import Joi from 'joi';
import {generatePlanRecommendations} from "../modules/activity/autoAssignment";
import {collectAssignmentWarnings, toAssignmentCandidate} from "../modules/activity/availability";
import {buildRecommendationWarnings} from "../modules/activity/recommendations";
import {
    calculateBaselineRequirementForPlan,
    calculateParticipantRequirement,
    calculateRequirementCapacitySummary,
    buildProportionalStayRequirements,
    countInclusiveDays,
    ParticipantAttendance,
    summarizeParticipantRequirements,
    toParticipantKey,
    toParticipantName
} from "../modules/activity/requirements";
import {
    ActivityAssignmentRecommendation,
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
import {saveDefaultPermsFromBody} from "../modules/permissionEngine";
import type {SlotAssignee} from "../types/ActivityTypes";
import type {PermBundle, SessionLike} from "../types/PermissionTypes";
import type {EntityBase} from "../types/UserTypes";

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
        description: Joi.string().max(2000).allow('').required(),
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
                    itemId: Joi.string().uuid().required(),
                    profileId: Joi.string().uuid().required(),
                    status: Joi.string().valid("PENDING", "APPROVED", "APPLIED", "REJECTED").optional(),
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
            itemId: string;
            profileId: string;
            status?: RecommendationStatus
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
        requirementService.getRequirementConfiguration(plan.id),
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

async function updateDescription(planId: string, body: any) {
    const {description} = body;
    if (description.length > 2000)
        throw new APIError('Description to long', body, 400)
    await activityService.updateActivityPlanDescription(planId, description);
    return 'Description updated';
}

async function createTextField(planId: string, body: any) {
    const {title = '', text = ''} = body;
    if (!title.trim()) throw new APIError('Title required', body, 400);
    if (title.length > 255) throw new APIError('Title too long', body, 400);
    if (text.length > 5000) throw new APIError('Text too long', body, 400);
    return await activityService.createActivityPlanTextField(planId, title.trim(), text);
}

async function updateTextField(planId: string, textFieldId: string, body: any, permData?: PermBundle) {
    const field = await activityService.getActivityPlanTextFieldById(textFieldId);
    if (field?.entityId !== planId) {
        throw new APIError('Text field not found', {planId, textFieldId}, 404);
    }
    const {title, text = ''} = body;
    if (title !== undefined && title.length > 255) throw new APIError('Title too long', body, 400);
    if (text.length > 5000) throw new APIError('Text too long', body, 400);

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

    await activityService.addActivitySlot(plan.id, slot, session.profile!.id);

    if (normalizedRoles.length > 0) {
        await activityService.addActivitySlotRoles(slot.id!, normalizedRoles);
    }
    return 'Slot added';
}

async function updateSlotDescription(slotId: string, body: any) {
    if (!(await activityService.updateActivitySlot(slotId, {description: body.description}))) {
        throw new APIError('Unknown error while saving', body, 500);
    }
    return 'Description updated';
}

async function updateSlotAttr(slotId: string, body: any, permData?: PermBundle) {
    const {field, value} = body;
    if (field !== undefined && value !== undefined) body[field] = value;
    // Permission check
    if (!permData ||
        ((body.startTime !== undefined || body.endTime !== undefined) && !permData.itemAllow(slotId, "EDIT_META", "ITEM_EDIT"))
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

    if (!(await activityService.updateActivitySlot(slotId, staged))) {
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
    const [plan, requirementConfig, assignments, slots, slotRoles, allRoles] = await Promise.all([
        activityService.getActivityPlanById(planId),
        requirementService.getRequirementConfiguration(planId),
        activityService.getParticipantAssignmentsWithSlots(planId),
        activityService.getActivitySlotsFlat(planId),
        activityService.getActivitySlotRoles(planId),
        activityService.getAllRoles(planId),
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

    const roleTitles = new Map(allRoles.map((role) => [Number(role.id), role.title]));
    const participants = summarizeParticipantRequirements(
        plan,
        Object.values(attendance),
        requirementConfig.roleRequirements,
        requirementConfig.overrides,
        assignments,
        requirementConfig.stayRequirements,
    ).map((participant) => ({
        ...participant,
        roles: (participant.roleIds || [])
            .map((roleId) => roleTitles.get(roleId))
            .filter((title): title is string => Boolean(title && title !== 'default')),
        assignmentMode: requirementConfig.plan.assignmentMode,
    }));

    const capacitySummary = calculateRequirementCapacitySummary(
        plan,
        Object.values(attendance),
        requirementConfig.roleRequirements,
        requirementConfig.overrides,
        requirementConfig.stayRequirements,
        slots,
        slotRoles,
    );

    const overrideTargets = eventParticipants.map((participant) => ({
        key: toParticipantKey(participant),
        profileId: participant.profileId ?? null,
        label: toParticipantName(participant),
        arrivalDate: participant.arrivalDate ?? null,
        departureDate: participant.departureDate ?? null,
    }));

    return {...requirementConfig, participants, capacitySummary, overrideTargets};
}

async function calculateBaselineRequirement(planId: string) {
    const [plan, requirementConfig, slots, assignments] = await Promise.all([
        activityService.getActivityPlanById(planId),
        requirementService.getRequirementConfiguration(planId),
        activityService.getActivitySlotsFlat(planId),
        activityService.getParticipantAssignmentsWithSlots(planId),
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

    const baseline = calculateBaselineRequirementForPlan({
        plan,
        slots,
        participants: Object.values(attendance),
        roleRequirements: requirementConfig.roleRequirements,
        overrides: requirementConfig.overrides,
    });

    return {
        ...baseline,
        stayRequirements: buildProportionalStayRequirements(
            countInclusiveDays(plan.startDate, plan.endDate),
            baseline.baseline,
            plan.roundingMode ?? "CEIL",
        ),
    };
}

async function updateRequirements(planId: string, body: any) {
    const {roleRequirements, stayRequirements, overrides, ...planSettings} = preprocessRequirementUpdate(body);
    const plan = await activityService.getActivityPlanById(planId);

    if (!plan) {
        throw new APIError('Activity plan not found', {planId}, 404);
    }
    if (!plan.event?.id) {
        throw new APIError('Event is required to configure participant overrides', {planId}, 400);
    }

    const eventParticipants = await eventService.getEventParticipants(plan.event.id);
    const allowed = new Set(eventParticipants.map((p) => p.profileId).filter((id): id is string => id != null));

    const invalidOverride = overrides.find((override) => {
        if (override.profileId) return !allowed.has(override.profileId);
        return false;
    });

    if (invalidOverride) {
        throw new APIError('Overrides must target participants registered for this event', invalidOverride, 400);
    }

    const allowedRoleIds = new Set((await activityService.getAllRoles(planId)).map((role) => role.id));
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

    await requirementService.replaceRequirements(planId, roleRequirements, overrides, normalizedSettings, stayRequirements);
    return 'Requirements updated';
}

async function collectRecommendationWarnings(planId: string, recommendations: {
    itemId: string;
    profileId?: string | null;
    status?: RecommendationStatus
}[]) {
    await validateRecommendationTargets(planId, recommendations);
    const [plan, slots, existingAssignments] = await Promise.all([
        activityService.getActivityPlanById(planId),
        activityService.getActivitySlotsFlat(planId),
        activityService.getParticipantAssignmentsWithSlots(planId),
    ]);

    const slotCapacities: Record<string, number> = {};
    if (plan && !plan.allowOverfillAfterFull) {
        const assignedCounts: Record<string, number> = {};
        Object.values(existingAssignments).forEach((assignments) => {
            assignments.forEach((assignment) => {
                assignedCounts[assignment.id] = (assignedCounts[assignment.id] ?? 0) + 1;
            });
        });

        slots.forEach((slot) => {
            if (slot.maxAssignees != null) {
                slotCapacities[slot.id] = Math.max((slot.maxAssignees ?? 0) - (assignedCounts[slot.id] ?? 0), 0);
            }
        });
    }

    return buildRecommendationWarnings({
        slots,
        recommendations,
        existingAssignments,
        slotCapacities,
        allowOverfill: Boolean(plan?.allowOverfillAfterFull),
        attendancePolicy: {
            allowArrivalDayEvening: plan?.allowArrivalDayEvening,
            allowDepartureDayMorning: plan?.allowDepartureDayMorning,
        },
    });
}

async function validateRecommendationTargets(planId: string, recommendations: {
    itemId: string;
    profileId?: string | null;
}[]) {
    const [plan, slots] = await Promise.all([
        activityService.getActivityPlanById(planId),
        activityService.getActivitySlotsFlat(planId),
    ]);
    if (!plan) {
        throw new APIError('Activity plan not found', {planId}, 404);
    }

    const allowedSlotIds = new Set(slots.map((slot) => slot.id));
    const invalidSlot = recommendations.find((recommendation) => !allowedSlotIds.has(recommendation.itemId));
    if (invalidSlot) {
        throw new APIError('Recommendation slot does not belong to this activity plan', invalidSlot, 400);
    }

    if (!plan.event?.id) return;

    const eventParticipants = await eventService.getEventParticipants(plan.event.id);
    const allowedProfileIds = new Set(
        eventParticipants.map((participant) => participant.profileId).filter((id): id is string => Boolean(id)),
    );
    const invalidProfile = recommendations.find(
        (recommendation) => recommendation.profileId && !allowedProfileIds.has(recommendation.profileId),
    );
    if (invalidProfile) {
        throw new APIError('Recommendations must target participants registered for this event', invalidProfile, 400);
    }
}

async function buildParticipantAttendanceMap(
    plan: ActivityPlan,
    overrides: Awaited<ReturnType<typeof requirementService.getRequirementConfiguration>>["overrides"],
    existingAssignments: Record<string, {
        id: string;
        day: string;
        startTime?: string | null;
        endTime?: string | null;
        pos?: number | null
    }[]>,
    recommendations: { itemId: string; profileId: string }[],
    eventParticipants: Awaited<ReturnType<typeof eventService.getEventParticipants>> = [],
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

    for (const override of overrides) {
        upsert({
            profileId: override.profile.id ?? undefined,
            roleIds: override.roleId ? [override.roleId] : undefined,
            name: override.profile.name ?? undefined,
        });
    }

    Object.keys(existingAssignments).forEach((key) => {
        const [type, id] = key.split(":");
        if (type === "profile") {
            upsert({profileId: String(id)});
        }
    });

    for (const rec of recommendations) {
        upsert({profileId: rec.profileId ?? undefined});
    }

    const unnamedProfileIds = Object.values(attendance)
        .filter((participant) => participant.profileId && !participant.name)
        .map((participant) => participant.profileId as string);
    const profiles = await userService.getProfilesByIds(unnamedProfileIds);
    profiles.forEach((profile) => upsert({profileId: profile.id, name: profile.name}));

    // Load roleIds from ActivityAssignmentRole for each participant
    const participantRoles = await activityService.getParticipantRolesForPlan(plan.id);
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
    if (!plan.bindingDeadline || recommendations.length > 0) {
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
    const target = resolveWarningTarget(session, permData, body);
    const participantKey = toParticipantKey(target);
    if (!participantKey) {
        throw new APIError("Unable to resolve participant", body, 400);
    }

    const [plan, slot, requirementConfig, assignments, assignees] = await Promise.all([
        activityService.getActivityPlanById(planId),
        activityService.getActivitySlotById(slotId),
        requirementService.getRequirementConfiguration(planId),
        activityService.getParticipantAssignmentsWithSlots(planId),
        activityService.getActivitySlotAssignees(planId),
    ]);

    if (!plan || !slot) {
        throw new APIError("Activity plan or slot not found", {planId, slotId}, 404);
    }
    if (slot.entityId !== planId) {
        throw new APIError("Activity slot not found in this plan", {planId, slotId}, 404);
    }

    const eventParticipants = plan.event ? await eventService.getEventParticipants(plan.event.id) : [];
    const attendance = await buildParticipantAttendanceMap(plan, requirementConfig.overrides, assignments, [], eventParticipants);

    const warnings = collectAssignmentWarnings(
        toAssignmentCandidate(slot),
        attendance[participantKey] ?? target,
        assignments[participantKey] ?? [],
        {
            allowArrivalDayEvening: plan.allowArrivalDayEvening,
            allowDepartureDayMorning: plan.allowDepartureDayMorning,
        },
    );

    if (!plan.allowOverfillAfterFull && typeof slot.maxAssignees === "number") {
        const currentCount = assignees[slot.id]?.length ?? 0;
        if (currentCount >= slot.maxAssignees) {
            warnings.push({type: "over_capacity"});
        }
    }

    return warnings;
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

    if (plan.allowOverfillAfterFull) return;

    const assignees = (await activityService.getActivitySlotAssignees(planId))[slotId] ?? [];
    const existingAssignee = assignees.find((assignee) => assignee.profileId === profileId);
    if (!existingAssignee && typeof slot.maxAssignees === 'number' && assignees.length >= slot.maxAssignees) {
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

async function getRecommendations(planId: string) {
    const [plan, requirementConfig, initialRecommendations, slots, assignments] = await Promise.all([
        activityService.getActivityPlanById(planId),
        requirementService.getRequirementConfiguration(planId),
        recommendationService.getRecommendations(planId),
        activityService.getActivitySlotsFlat(planId),
        activityService.getParticipantAssignmentsWithSlots(planId),
    ]);

    if (!plan) {
        throw new APIError('Activity plan not found', {planId}, 404);
    }

    let recommendations = initialRecommendations;
    let autoGenerated = false;

    // If the binding deadline passed and no recommendations exist, seed them automatically
    if (shouldAutoGenerateRecommendations(plan, recommendations)) {
        await autoGenerateRecommendations(planId);
        recommendations = await recommendationService.getRecommendations(planId);
        autoGenerated = true;
    }

    const normalized = recommendations.map((rec) => ({
        itemId: rec.item.id,
        profileId: rec.profileId ?? null,
        status: rec.status,
    }));

    const warnings = await collectRecommendationWarnings(planId, normalized);
    const eventParticipants = plan.event ? await eventService.getEventParticipants(plan.event.id) : [];
    const attendance = await buildParticipantAttendanceMap(
        plan,
        requirementConfig.overrides,
        assignments,
        normalized,
        eventParticipants,
    );

    const participants = Object.values(attendance).map((participant) => ({
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

    return {
        recommendations,
        warnings,
        participantOptions: participants, // Frontend expects participantOptions
        slots: slotOptions,
        autoGenerated
    };
}

async function updateRecommendations(planId: string, body: any) {
    const {recommendations} = preprocessRecommendationUpdate(body);
    await validateRecommendationTargets(planId, recommendations);
    await recommendationService.replaceRecommendations(planId, recommendations);
    const warnings = await collectRecommendationWarnings(planId, recommendations);
    return {message: 'Recommendations updated', warnings};
}

async function autoGenerateRecommendations(planId: string) {
    // IMPORTANT: Load existing recommendations BEFORE generating
    // This preserves rejection memory for the algorithm
    const existingRecommendations = await recommendationService.getRecommendations(planId);

    // Generate with rejection memory
    const recommendations = await generatePlanRecommendations(planId, existingRecommendations);

    // Now replace with new recommendations that respect rejection memory
    await recommendationService.replaceRecommendations(planId, recommendations);

    const warnings = await collectRecommendationWarnings(planId, recommendations);
    return {message: 'Recommendations generated', warnings};
}

async function applyRecommendations(planId: string, body?: any) {
    const [plan, requirementConfig, slots, recommendations, existingAssignments] = await Promise.all([
        activityService.getActivityPlanById(planId),
        requirementService.getRequirementConfiguration(planId),
        activityService.getActivitySlotsFlat(planId),
        recommendationService.getRecommendations(planId),
        activityService.getParticipantAssignmentsWithSlots(planId),
    ]);

    if (!plan) {
        throw new APIError('Activity plan not found', {planId}, 404);
    }

    // If body contains recommendations array with statuses, use that (new format)
    // Otherwise fall back to filtering database recommendations for APPROVED (legacy)
    let approved: ActivityAssignmentRecommendation[];
    let statusUpdates: {
        pending: ActivityAssignmentRecommendation[],
        rejected: ActivityAssignmentRecommendation[],
        approved: ActivityAssignmentRecommendation[]
    } = {pending: [], rejected: [], approved: []};

    if (body?.recommendations && Array.isArray(body.recommendations)) {
        // New format: {recommendations: [{itemId, profileId, status}]}
        const withStatus = preprocessRecommendationUpdate(body).recommendations;
        await validateRecommendationTargets(planId, withStatus);

        // Group by status
        withStatus.forEach((r: any) => {
            if (r.status === 'APPROVED') statusUpdates.approved.push(r);
            else if (r.status === 'REJECTED') statusUpdates.rejected.push(r);
            else if (r.status === 'PENDING') statusUpdates.pending.push(r);
        });

        // Update recommendation statuses in database
        // Create new input array from current recommendations, updating statuses from body
        const updatedRecommendations: RecommendationInput[] = withStatus.map((r: any) => ({
            itemId: r.itemId,
            profileId: r.profileId || null,
            status: r.status as RecommendationStatus,
        }));

        // Replace all recommendations with updated statuses
        await recommendationService.replaceRecommendations(planId, updatedRecommendations);

        // Get approved ones for processing
        approved = statusUpdates.approved.map((r) => {
            // Find full recommendation data from database
            const dbRec = recommendations.find(rec =>
                rec.item.id === r.itemId &&
                rec.profile.id === r.profileId
            );
            return dbRec || r; // Fallback to body data if not in DB
        });
    } else {
        // Legacy format: filter database recommendations
        approved = recommendations.filter((rec) => rec.status === "APPROVED");
    }

    // Proceed even if no approved recommendations - we still want to regenerate
    const normalized = approved.map((rec) => ({
        id: rec.id ?? undefined,
        itemId: rec.itemId ?? rec.item?.id,
        profileId: rec.profileId ?? rec.profile?.id,
        status: rec.status ?? 'APPROVED',
    }));
    await validateRecommendationTargets(planId, normalized);

    const eventParticipants = plan.event ? await eventService.getEventParticipants(plan.event.id) : [];

    const slotCapacity: Record<string, number> = {};
    if (!plan.allowOverfillAfterFull) {
        const assignedCounts: Record<string, number> = {};
        Object.values(existingAssignments).forEach((assignments) => {
            assignments.forEach((assignment) => {
                assignedCounts[assignment.id] = (assignedCounts[assignment.id] ?? 0) + 1;
            });
        });

        slots.forEach((slot) => {
            if (slot.maxAssignees != null) {
                const remaining = Math.max((slot.maxAssignees ?? 0) - (assignedCounts[slot.id] ?? 0), 0);
                slotCapacity[slot.id] = remaining;
            }
        });
    }

    const participantAttendance = await buildParticipantAttendanceMap(
        plan,
        requirementConfig.overrides,
        existingAssignments,
        normalized,
        eventParticipants,
    );

    const warnings = buildRecommendationWarnings({
        slots,
        recommendations: normalized,
        existingAssignments,
        participantAttendance,
        slotCapacities: slotCapacity,
        allowOverfill: Boolean(plan.allowOverfillAfterFull),
    });

    const blockedIds = new Set(
        warnings
            .filter((warning) =>
                warning.warnings.some(
                    (w) => w.type === "outside_attendance" || w.type === "overlap" || w.type === "over_capacity",
                ),
            )
            .map((warning) => warning.recommendation.id)
            .filter(Boolean) as string[],
    );

    const applicable = normalized.filter((rec) => !rec.id || !blockedIds.has(rec.id));
    for (const rec of applicable) {
        if (rec.profileId) {
            await activityService.assignActivityAssignmentRole(rec.itemId, rec.profileId);
        }
    }

    // Mark recommendations as applied (changes status to APPLIED)
    if (applicable.length > 0) {
        // Load existing recommendations to preserve rejection memory
        const existingForRejectionMemory = await recommendationService.getRecommendations(planId);

        // Generate fresh recommendations with rejection memory
        const freshRecommendations = await generatePlanRecommendations(planId, existingForRejectionMemory);

        // Replace all recommendations with fresh ones
        await recommendationService.replaceRecommendations(planId, freshRecommendations);
    }

    return {
        message: `Applied ${applicable.length} recommendation${applicable.length === 1 ? '' : 's'}`,
        applied: applicable.length,
        skipped: blockedIds.size,
        warnings,
    };
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

async function updateRoleAssignments(slotId: string, body: any) {
    const {assignments} = body
    if (!Array.isArray(assignments)) throw new APIError('Not an array', body, 400);
    const slot = await activityService.getActivitySlotById(slotId);
    if (!slot) throw new APIError('Activity slot not found', {slotId}, 404);
    const allowedRoles = new Set(
        ((await activityService.getActivitySlotRoles(slot.entityId))[slotId] ?? []).map((role) => role.name),
    );
    if (assignments.some((assignment) => !assignment || !allowedRoles.has(assignment.role))) {
        throw new APIError('Roles must be configured for this activity slot', body, 400);
    }
    const parsed: { assignmentId: number | null, role: string }[] = assignments.map(v => {
        v.assignmentId = v.assignmentId !== null ? Number.parseInt(v.assignmentId) || null : null;
        return v
    });
    await activityService.updateRoleAssignments(slotId, parsed);
    return "Assignments updated";
}

async function updateHeaderImg(entity: EntityBase, file?: Express.Multer.File) {
    await performImageSwap(entity, activityService.updateHeaderImage, file);
    return 'Image updated';
}

async function deleteHeaderImg(entity: EntityBase) {
    await performImageSwap(entity, activityService.updateHeaderImage);
    return 'Image deleted';
}

function getAssignmentAccessMapping() {
    return {
        assign: (body: any, profileId: string) => activityService.assignActivityAssignmentRole(body.itemId, profileId),
        unassign: (body: any, profileId: string) => activityService.unassignActivityAssignmentRole(body.itemId, profileId),
    };
}

function getRoleAccessMapping() {
    return {
        assign: (body: any, profileId: string) => activityService.assignActivityAssignmentRole(body.itemId, profileId, body.role),
        unassign: (body: any, profileId: string) => activityService.unassignActivityAssignmentRole(body.itemId, profileId, body.role),
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
    applyRecommendations,
    deleteSlot,
    addSlotRole,
    addActivityRole,
    updateRoleAssignments,

    updateHeaderImg,
    deleteHeaderImg,

    getAssignmentWarnings,
    authorizeSelfAssignment,
    getAssignmentAccessMapping,
    getRoleAccessMapping,
};
