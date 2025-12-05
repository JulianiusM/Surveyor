// controllers/activityController.js
// Business logic for the Activity routes
import Joi from 'joi';

import {ENTITIES, fromISOtoLocal, generateUniqueId} from '../modules/lib/util';
import {APIError, ValidationError} from '../modules/lib/errors';
import * as activityService from "../modules/database/services/ActivityService";
import * as userService from "../modules/database/services/UserService";
import * as requirementService from "../modules/database/services/ActivityRequirementService";
import {ActivitySlot} from "../modules/database/entities/activity/ActivitySlot";
import {ActivityPlan} from "../modules/database/entities/activity/ActivityPlan";
import {Request} from "express";
import {saveDefaultPermsFromBody} from "../modules/permissionEngine";
import type {PermBundle} from "../types/PermissionTypes";

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
        roleRequirements: Joi.array().items(roleRequirementSchema).default([]),
        overrides: Joi.array().items(overrideSchema).default([]),
    });

    const {error, value} = schema.validate(body, {abortEarly: false, allowUnknown: true});
    if (error) {
        const msg = error.details.map((d: any) => d.message).join(', ');
        throw new APIError(msg, body, 400);
    }

    return value as {roleRequirements: {roleId: number; requiredShifts: number}[]; overrides: any[]};
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
    const {date, title = '', description = '', maxAssignees = 1} = body;
    const d = fromISOtoLocal(date);
    if (d < fromISOtoLocal(plan.startDate) || d > fromISOtoLocal(plan.endDate))
        throw new APIError('Date outside range', body, 400);

    if (!title) throw new APIError('Title required', body, 400);

    const last = Number(await activityService.getLastActivitySlotNumber(plan.id, date)) || 0;
    const slot: Partial<ActivitySlot> = {
        id: generateUniqueId(),
        day: date,
        title,
        description,
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
    return await requirementService.getRequirementConfiguration(planId);
}

async function updateRequirements(planId: string, body: any) {
    const {roleRequirements, overrides} = preprocessRequirementUpdate(body);
    await requirementService.replaceRequirements(planId, roleRequirements, overrides);
    return 'Requirements updated';
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
    deleteSlot,
    addSlotRole,

    getAssignmentAccessMapping,
    getRoleAccessMapping,
};
