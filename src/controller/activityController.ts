// controllers/activityController.js
// Business logic for the Activity routes
import Joi from 'joi';

import {fromISOtoLocal, generateUniqueId} from '../modules/lib/util';
import {APIError, ValidationError} from '../modules/lib/errors';
import * as activityService from "../modules/database/services/ActivityService";
import * as userService from "../modules/database/services/UserService";
import {ActivitySlot} from "../modules/database/entities/activity/ActivitySlot";

// Template constant for create errors
const CREATE_TEMPLATE = 'activity/activity-create';

/**
 * Validate and sanitize creation payload.
 * Throws ValidationError on failure; returns sanitized plan data on success.
 */

function preprocessCreate(body: any) {
    // Parse JSON slots object
    let slotsByDate;
    try {
        slotsByDate = JSON.parse(body.slots || '{}');
    } catch {
        throw new ValidationError(CREATE_TEMPLATE, 'Invalid slots JSON', {body});
    }

    // Define Joi schema for body & slots
    const slotSchema = Joi.object({
        id: Joi.string().guid({version: ['uuidv4', 'uuidv5']}).required(),
        date: Joi.string().pattern(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/).required(),
        position: Joi.number().integer().required(),
        title: Joi.string().max(255).required(),
        description: Joi.string().allow(''),
        maxAssignees: Joi.number().integer().min(1).required()
    });

    const schema = Joi.object({
        title: Joi.string().required(),
        start: Joi.string().pattern(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/).required(),
        end: Joi.string().pattern(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/).required(),
        allowGuestAdd: Joi.allow('').allow('on'),
        guestManage: Joi.allow('').allow('on'),
        description: Joi.string().max(2000).allow('').required(),
        slots: Joi.object().pattern(
            /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/, Joi.array().items(slotSchema).min(1)
        ).min(1).required()
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
    const flattenedSlots: any[] = Object.values(value.slots).flat();

    // Ensure each slot date is within the start/end range
    const startDate = fromISOtoLocal(value.start);
    const endDate = fromISOtoLocal(value.end);
    for (const slot of flattenedSlots) {
        const slotDate = fromISOtoLocal(slot.date);
        if (slotDate < startDate || slotDate > endDate) {
            throw new ValidationError(CREATE_TEMPLATE, `Slot date ${slot.date} outside range`, {body});
        }
    }
    return {
        title: value.title,
        description: value.description || null,
        start: value.start,
        end: value.end,
        allow: value.allowGuestAdd === 'on',
        guestManage: value.guestManage === 'on',
        slots: flattenedSlots
    };
}

/**
 * Create activity plan and slots in a transaction.
 * @returns {Promise<string>} plan ID
 */

async function createEntity(ownerId: any, planData: any): Promise<string> {
    return await activityService.createActivityPlanTx(
        ownerId,
        planData.title,
        planData.description,
        planData.start,
        planData.end,
        planData.allow,
        planData.guestManage,
        planData.slots
    );
}

// No-op since slots handled in transaction
const afterCreateItems = async () => {
};

/**
 * Assemble data for the view.
 */

async function fetchForView(plan: any, session: any) {
    const slotsByDate = await activityService.getActivitySlots(plan.id);

    const slotList: any[] = Object.values(slotsByDate).flat();

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
        if (slot.assigned_count === 0) empty++;
        if (slot.assigned_count < slot.max_assignees) open++;
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

async function fetchForDuplicate(plan: any, session: any) {
    return await activityService.getActivitySlots(plan.id);
}

/**
 * Delete plan if owned by current user.
 */

async function deleteEntity(plan: any, session: any) {
    return await activityService.deleteActivityPlan(plan.id);
}

// ---------- API ----------
// API-specific controllers

async function updateDescription(planId: any, body: any) {
    const {description} = body;
    if (description.length > 2000)
        throw new APIError('Description to long', body, 400)
    await activityService.updateActivityPlanDescription(planId, description);
    return 'Description updated';
}

async function reorderSlots(id: any, order: any) {
    await activityService.reorderActivitySlots(id, order);
    return 'Order saved';
}

async function quickAddSlot(plan: any, body: any) {
    const {date, title = '', description = '', maxAssignees = 1} = body;
    const d = fromISOtoLocal(date);
    if (d < fromISOtoLocal(plan.start_date) || d > fromISOtoLocal(plan.end_date))
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

async function updateSlotDescription(slotId: any, body: any) {
    if (!(await activityService.updateActivitySlot(slotId, {description: body.description}))) {
        throw new APIError('Unknown error while saving', body, 500);
    }
    return 'Description updated';
}

async function updateSlotAttr(slotId: any, body: any) {
    const {field, value} = body;
    const allowed = {title: 1, description: 1, maxAssignees: 1};

    // @ts-expect-error TS(7053): Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
    if (!allowed[field]) throw new APIError('Invalid field', body, 400);

    if (!(await activityService.updateActivitySlot(slotId, {[field]: value}))) {
        throw new APIError('Unknown error while saving', body, 500);
    }
    return 'Slot updated';
}


async function deleteAssignment(assignId: any) {
    await activityService.deleteActivitySlotAssignment(assignId);
    return 'Assignment removed';
}


async function updateSettings(id: any, body: any) {
    const {allowAdd, guestManage} = body;
    await activityService.updateActivityPlanFlags(id, allowAdd, guestManage);
    return 'Settings saved';
}

async function deleteSlot(slotId: any) {
    await activityService.deleteActivitySlot(slotId);
    return 'Slot deleted';
}

async function addSlotRole(slotId: any, body: any) {
    const {roles} = body;
    if (!roles || !Array.isArray(roles) || roles.length < 1) {
        throw new APIError('Invalid roles', body, 400);
    }

    await activityService.addActivitySlotRoles(slotId, roles);
    return 'Roles added';
}


function getAssignmentAccessMapping() {
    return {
        assignToUser: (body: any, user: any) => activityService.assignActivitySlotToUser(body.slotId, user),
        assignToGuest: (body: any, user: any) => activityService.assignActivitySlotToGuest(body.slotId, user),
        unassignFromUser: (body: any, user: any) => activityService.unassignActivitySlotUser(body.slotId, user),
        unassignFromGuest: (body: any, user: any) => activityService.unassignActivitySlotGuest(body.slotId, user),
    };
}

function getRoleAccessMapping() {
    return {
        assignToUser: (body: any, user: any) => activityService.assignActivityAssignmentRoleToUser(body.slotId, user, body.role),
        assignToGuest: (body: any, user: any) => activityService.assignActivityAssignmentRoleToGuest(body.slotId, user, body.role),
        unassignFromUser: (body: any, user: any) => activityService.unassignActivityAssignmentRoleFromUser(body.slotId, user, body.role),
        unassignFromGuest: (body: any, user: any) => activityService.unassignActivityAssignmentRoleFromGuest(body.slotId, user, body.role),
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
    deleteSlot,
    addSlotRole,

    getAssignmentAccessMapping,
    getRoleAccessMapping,
};
