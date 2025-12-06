// controllers/activityController.js
// Business logic for the Activity routes
import Joi from 'joi';

import {ENTITIES, fromISOtoLocal, generateUniqueId} from '../modules/lib/util';
import {APIError, ValidationError} from '../modules/lib/errors';
import * as activityService from "../modules/database/services/ActivityService";
import * as userService from "../modules/database/services/UserService";
import * as requirementService from "../modules/database/services/ActivityRequirementService";
import * as recommendationService from "../modules/database/services/ActivityRecommendationService";
import * as eventService from "../modules/database/services/EventService";
import {ActivitySlot} from "../modules/database/entities/activity/ActivitySlot";
import {ActivityPlan} from "../modules/database/entities/activity/ActivityPlan";
import {Request} from "express";
import {saveDefaultPermsFromBody} from "../modules/permissionEngine";
import type {PermBundle} from "../types/PermissionTypes";
import {buildRecommendationWarnings} from "../modules/activity/recommendations";
import {generatePlanRecommendations} from "../modules/activity/autoAssignment";
import {ParticipantAttendance, summarizeParticipantRequirements, toParticipantKey} from "../modules/activity/requirements";
import {collectAssignmentWarnings, toAssignmentCandidate} from "../modules/activity/availability";
import {PERM} from "../modules/lib/permissions";

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
        day: Joi.string().pattern(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/).required(),
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
        startDate: Joi.string().pattern(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/).required(),
        endDate: Joi.string().pattern(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/).required(),
        description: Joi.string().max(2000).allow('').required(),
        slots: Joi.object().pattern(
            /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/, Joi.array().items(slotSchema)
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

    const overrideSchema = Joi.object({
        id: Joi.number().integer().positive().optional(),
        roleId: Joi.number().integer().positive().allow(null),
        userId: Joi.number().integer().positive().allow(null),
        guestId: Joi.number().integer().positive().allow(null),
        requiredShifts: Joi.number().integer().min(0).required(),
    }).custom((value, helpers) => {
        if (!value.userId && !value.guestId) {
            return helpers.error("any.custom", {message: "Override requires a userId or guestId"});
        }
        return value;
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
        allowArrivalDayEvening: Joi.boolean().optional(),
        allowDepartureDayMorning: Joi.boolean().optional(),
        roleRequirements: Joi.array().items(roleRequirementSchema).default([]),
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
        allowArrivalDayEvening?: boolean;
        allowDepartureDayMorning?: boolean;
        roleRequirements: {roleId: number; requiredShifts: number}[];
        overrides: any[];
    };
}

function preprocessRecommendationUpdate(body: any) {
    const schema = Joi.object({
        recommendations: Joi.array()
            .items(
                Joi.object({
                    slotId: Joi.string().uuid().required(),
                    userId: Joi.number().integer().positive().allow(null),
                    guestId: Joi.number().integer().positive().allow(null),
                    status: Joi.string().valid("PENDING", "APPROVED", "REJECTED", "APPLIED").optional(),
                }).custom((value, helpers) => {
                    if (!value.userId && !value.guestId) {
                        return helpers.error("any.custom", {message: "Recommendation requires a userId or guestId"});
                    }
                    if (value.userId && value.guestId) {
                        return helpers.error("any.custom", {message: "Recommendation cannot target both user and guest"});
                    }
                    return value;
                })
            )
            .default([]),
    });

    const {error, value} = schema.validate(body, {abortEarly: false, allowUnknown: true});
    if (error) {
        const msg = error.details.map((d: any) => d.message).join(', ');
        throw new APIError(msg, body, 400);
    }

    return value as {recommendations: {slotId: string; userId?: number | null; guestId?: number | null; status?: "PENDING" | "APPROVED" | "REJECTED" | "APPLIED"}[]};
}

/**
 * Create activity plan and slots in a transaction.
 * @returns {Promise<string>} plan ID
 */

async function createEntity(
    ownerId: number,
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

    const assignPromise: Promise<string[]> = session.user
        ? activityService.getActivitySlotAssignmentsForUser(plan.id, session.user.id)
        : session.guest
            ? activityService.getActivitySlotAssignmentsForGuest(plan.id, session.guest.id)
            : Promise.resolve([]);
    const [assignments, assigneeLists, participantList, allRoles, slotRoles] = await Promise.all([
        assignPromise,
        activityService.getActivitySlotAssignees(plan.id),
        activityService.getActivityPlanParticipants(plan.id),
        userService.getAllRoles(),
        activityService.getActivitySlotRoles(plan.id)
    ]);

    let empty = 0, open = 0;

    for (const slot of slotList) {
        if (!slot) continue;
        if (slot.assignedCount === 0) empty++;
        if (slot.assignedCount < (slot.maxAssignees ?? 0)) open++;
    }

    return {
        plan,
        slots: slotsByDate,
        assignments,
        assigneeLists,
        participantList,
        roles: {allRoles, slotRoles},
        counters: {participants: participantList.length, open, empty}
    };
}

/**
 * Provide data for duplication form.
 */

async function fetchForDuplicate(plan: ActivityPlan, session: Request['session']) {
    return await activityService.getActivitySlots(plan.id);
}

/**
 * Delete plan if owned by current user.
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

async function reorderSlots(id: string, order: { slotId: string, pos: number }[]) {
    await activityService.reorderActivitySlots(id, order);
    return 'Order saved';
}

async function quickAddSlot(plan: ActivityPlan, body: any) {
    const {date, title = '', description = '', startTime, endTime, maxAssignees = 1} = body;
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

    await activityService.addActivitySlot(plan.id, slot);
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
    const allowed: Record<string, boolean> = {title: true, description: true, maxAssignees: true};

    if (!allowed[field]) throw new APIError('Invalid field', body, 400);

    // Permission check
    if (!permData ||
        ((body.location !== undefined || body.start !== undefined || body.end !== undefined || body.deadlineTz !== undefined) && !permData.entity.has("EDIT_META"))
        || (body.title !== undefined && !permData.entity.has("EDIT_TITLE"))
        || (body.description !== undefined && !permData.entity.has("EDIT_DESC"))
        || (body.requireDietaryInfo !== undefined && !permData.entity.has("MANAGE_REQUIREMENTS"))
        || (body.maxParticipants !== undefined && !permData.entity.has("EDIT_CAPACITY"))
    ) {
        throw new APIError("Not allowed", body, 403);
    }

    if (!(await activityService.updateActivitySlot(slotId, {[field]: value}))) {
        throw new APIError('Unknown error while saving', body, 500);
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
    const [plan, requirementConfig, assignments] = await Promise.all([
        activityService.getActivityPlanById(planId),
        requirementService.getRequirementConfiguration(planId),
        activityService.getParticipantAssignmentsWithSlots(planId),
    ]);

    if (!plan) {
        throw new APIError('Activity plan not found', {planId}, 404);
    }

    const eventParticipants = plan.event ? await eventService.getEventParticipants(plan.event.id) : [];

    const attendance = buildParticipantAttendanceMap(
        plan,
        requirementConfig.overrides,
        assignments,
        [],
        eventParticipants,
    );

    const participants = summarizeParticipantRequirements(
        plan,
        Object.values(attendance),
        requirementConfig.roleRequirements,
        requirementConfig.overrides,
        assignments,
    );

    return {...requirementConfig, participants};
}

async function updateRequirements(planId: string, body: any) {
    const {roleRequirements, overrides, ...planSettings} = preprocessRequirementUpdate(body);
    // Convert bindingDeadline string to Date if present
    const normalizedSettings: Partial<Pick<ActivityPlan, "assignmentMode" | "generalRequiredShifts" | "roundingMode" | "bindingDeadline" | "allowOverfillAfterFull" | "allowArrivalDayEvening" | "allowDepartureDayMorning">> = {
        assignmentMode: planSettings.assignmentMode,
        generalRequiredShifts: planSettings.generalRequiredShifts,
        roundingMode: planSettings.roundingMode,
        allowOverfillAfterFull: planSettings.allowOverfillAfterFull,
        allowArrivalDayEvening: planSettings.allowArrivalDayEvening,
        allowDepartureDayMorning: planSettings.allowDepartureDayMorning,
    };
    
    if (planSettings.bindingDeadline !== undefined) {
        normalizedSettings.bindingDeadline = planSettings.bindingDeadline === null 
            ? null 
            : (typeof planSettings.bindingDeadline === 'string' ? new Date(planSettings.bindingDeadline) : planSettings.bindingDeadline);
    }
    
    await requirementService.replaceRequirements(planId, roleRequirements, overrides, normalizedSettings);
    return 'Requirements updated';
}

async function collectRecommendationWarnings(planId: string, recommendations: {slotId: string; userId?: number | null; guestId?: number | null; status?: "PENDING" | "APPROVED" | "REJECTED" | "APPLIED"}[]) {
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

function buildParticipantAttendanceMap(
    plan: ActivityPlan,
    overrides: Awaited<ReturnType<typeof requirementService.getRequirementConfiguration>>["overrides"],
    existingAssignments: Record<string, {id: string; day: string; startTime?: string | null; endTime?: string | null; pos?: number | null}[]>,
    recommendations: {slotId: string; userId?: number | null; guestId?: number | null}[],
    eventParticipants: Awaited<ReturnType<typeof eventService.getEventParticipants>> = [],
): Record<string, ParticipantAttendance> {
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
            userId: participant.userId ?? undefined,
            guestId: participant.guestId ?? undefined,
            arrivalDate: participant.arrivalDate ?? undefined,
            departureDate: participant.departureDate ?? undefined,
            name: participant.name ?? undefined,
        });
    });

    for (const override of overrides) {
        upsert({
            userId: override.userId ?? undefined,
            guestId: override.guestId ?? undefined,
            roleIds: override.roleId ? [override.roleId] : undefined,
            name: override.user?.username ?? override.guest?.username ?? undefined,
        });
    }

    Object.keys(existingAssignments).forEach((key) => {
        const [type, id] = key.split(":");
        if (type === "user") {
            upsert({userId: Number(id)});
        }
        if (type === "guest") {
            upsert({guestId: Number(id)});
        }
    });

    for (const rec of recommendations) {
        upsert({userId: rec.userId ?? undefined, guestId: rec.guestId ?? undefined});
    }

    return attendance;
}

function resolveWarningTarget(
    session: Request["session"],
    permData: PermBundle | undefined,
    body: {userId?: number | null; guestId?: number | null} = {},
) {
    if (body.userId || body.guestId) {
        const isManager = permData?.entity?.has('MANAGE_ASSIGNMENTS');
        if (!isManager) {
            throw new APIError("Insufficient permissions to view warnings for other participants", body, 403);
        }
        return {userId: body.userId ?? undefined, guestId: body.guestId ?? undefined};
    }

    if (session?.user?.id) return {userId: session.user.id};
    if (session?.guest?.id) return {guestId: session.guest.id};

    throw new APIError("Unknown user", body, 401);
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
    body?: {userId?: number | null; guestId?: number | null},
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

    const eventParticipants = plan.event ? await eventService.getEventParticipants(plan.event.id) : [];
    const attendance = buildParticipantAttendanceMap(plan, requirementConfig.overrides, assignments, [], eventParticipants);

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
        slotId: rec.slot.id,
        userId: rec.user?.id ?? null,
        guestId: rec.guest?.id ?? null,
        status: rec.status,
    }));

    const warnings = await collectRecommendationWarnings(planId, normalized);
    const eventParticipants = plan.event ? await eventService.getEventParticipants(plan.event.id) : [];
    const attendance = buildParticipantAttendanceMap(
        plan,
        requirementConfig.overrides,
        assignments,
        normalized,
        eventParticipants,
    );

    const participants = Object.values(attendance).map((participant) => ({
        key: toParticipantKey(participant),
        userId: participant.userId ?? null,
        guestId: participant.guestId ?? null,
        label: participant.name
            || (participant.userId ? `User #${participant.userId}` : participant.guestId ? `Guest #${participant.guestId}` : 'Participant'),
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

    return {recommendations, warnings, participants, slots: slotOptions, autoGenerated};
}

async function updateRecommendations(planId: string, body: any) {
    const {recommendations} = preprocessRecommendationUpdate(body);
    await recommendationService.replaceRecommendations(planId, recommendations);
    const warnings = await collectRecommendationWarnings(planId, recommendations);
    return {message: 'Recommendations updated', warnings};
}

async function autoGenerateRecommendations(planId: string) {
    const recommendations = await generatePlanRecommendations(planId);
    await recommendationService.replaceRecommendations(planId, recommendations);
    const warnings = await collectRecommendationWarnings(planId, recommendations);
    return {message: 'Recommendations generated', warnings};
}

async function applyRecommendations(planId: string) {
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

    const approved = recommendations.filter((rec) => rec.status === "APPROVED");
    if (!approved.length) {
        return {message: 'No approved recommendations to apply', applied: 0, warnings: []};
    }

    const normalized = approved.map((rec) => ({
        id: rec.id,
        slotId: rec.slot.id,
        userId: rec.user?.id ?? null,
        guestId: rec.guest?.id ?? null,
        status: rec.status,
    }));

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

    const participantAttendance = buildParticipantAttendanceMap(
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
        if (rec.userId) {
            await activityService.assignActivitySlotToUser(rec.slotId, rec.userId);
        } else if (rec.guestId) {
            await activityService.assignActivitySlotToGuest(rec.slotId, rec.guestId);
        }
    }

    const appliedIds = applicable.map((rec) => rec.id).filter(Boolean) as string[];
    await recommendationService.markRecommendationsApplied(planId, appliedIds);

    return {
        message: `Applied ${appliedIds.length} recommendation${appliedIds.length === 1 ? '' : 's'}`,
        applied: appliedIds.length,
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
    if (!roles || !Array.isArray(roles) || roles.length < 1) {
        throw new APIError('Invalid roles', body, 400);
    }

    await activityService.addActivitySlotRoles(slotId, roles);
    return 'Roles added';
}


function getAssignmentAccessMapping() {
    return {
        assignToUser: (body: any, userId: number) => activityService.assignActivitySlotToUser(body.slotId, userId),
        assignToGuest: (body: any, guestId: number) => activityService.assignActivitySlotToGuest(body.slotId, guestId),
        unassignFromUser: (body: any, userId: number) => activityService.unassignActivitySlotUser(body.slotId, userId),
        unassignFromGuest: (body: any, guestId: number) => activityService.unassignActivitySlotGuest(body.slotId, guestId),
    };
}

function getRoleAccessMapping() {
    return {
        assignToUser: (body: any, userId: number) => activityService.assignActivityAssignmentRoleToUser(body.slotId, userId, body.role),
        assignToGuest: (body: any, guestId: number) => activityService.assignActivityAssignmentRoleToGuest(body.slotId, guestId, body.role),
        unassignFromUser: (body: any, userId: number) => activityService.unassignActivityAssignmentRoleFromUser(body.slotId, userId, body.role),
        unassignFromGuest: (body: any, guestId: number) => activityService.unassignActivityAssignmentRoleFromGuest(body.slotId, guestId, body.role),
    };
}


export default {
    preprocessCreate,
    createEntity,
    afterCreateItems,
    fetchForView,
    fetchForDuplicate,
    deleteEntity,

    updateDescription,
    reorderSlots,
    quickAddSlot,
    updateSlotDescription,
    updateSlotAttr,
    deleteAssignment,
    updateSettings,
    getRequirements,
    updateRequirements,
    getRecommendations,
    updateRecommendations,
    autoGenerateRecommendations,
    applyRecommendations,
    deleteSlot,
    addSlotRole,

    getAssignmentWarnings,
    getAssignmentAccessMapping,
    getRoleAccessMapping,
};
