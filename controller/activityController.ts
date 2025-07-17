// controllers/activityController.js
// Business logic for the Activity routes
// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'Joi'.
const Joi = require('joi');

// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'db'.
const db = require('../modules/database/db');
// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'fromISOtoL... Remove this comment to see the full error message
const {fromISOtoLocal, generateUniqueId} = require('../modules/lib/util');

// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'Validation... Remove this comment to see the full error message
const {ValidationError, APIError} = require('../modules/lib/errors');

// Template constant for create errors
// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'CREATE_TEM... Remove this comment to see the full error message
const CREATE_TEMPLATE = 'activity/activity-create';

/**
 * Validate and sanitize creation payload.
 * Throws ValidationError on failure; returns sanitized plan data on success.
 */
// @ts-expect-error TS(2393): Duplicate function implementation.
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
    // @ts-expect-error TS(2550): Property 'values' does not exist on type 'ObjectCo... Remove this comment to see the full error message
    const flattenedSlots = Object.values(value.slots).flat();
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
        allow: value.allowGuestAdd,
        guestManage: value.guestManage,
        slots: flattenedSlots
    };
}

/**
 * Create activity plan and slots in a transaction.
 * @returns {Promise<number>} plan ID
 */
// @ts-expect-error TS(2393): Duplicate function implementation.
async function createEntity(ownerId: any, planData: any) {
    return await db.createActivityPlanTx(
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
// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'afterCreat... Remove this comment to see the full error message
const afterCreateItems = async () => {
};

/**
 * Assemble data for the view.
 */
// @ts-expect-error TS(2393): Duplicate function implementation.
async function fetchForView(plan: any, session: any) {
    const slotsByDate = await db.getActivitySlots(plan.id);
    // @ts-expect-error TS(2550): Property 'values' does not exist on type 'ObjectCo... Remove this comment to see the full error message
    const slotList = Object.values(slotsByDate).flat();

    const assignPromise = session.user
        ? db.getActivitySlotAssignmentsForUser(plan.id, session.user.id)
        : session.guest
            ? db.getActivitySlotAssignmentsForGuest(plan.id, session.guest.id)
            : Promise.resolve([]);
    const [assignments, assigneeLists, participantList, allRoles, slotRoles] = await Promise.all([
        assignPromise,
        db.getActivitySlotAssignees(plan.id),
        db.getActivityPlanParticipants(plan.id),
        db.getAllRoles(),
        db.getActivitySlotRoles(plan.id)
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
// @ts-expect-error TS(2393): Duplicate function implementation.
async function fetchForDuplicate(plan: any, session: any) {
    return await db.getActivitySlots(plan.id);
}

/**
 * Delete plan if owned by current user.
 */
// @ts-expect-error TS(2393): Duplicate function implementation.
async function deleteEntity(plan: any, session: any) {
    return await db.deleteActivityPlan(plan.id);
}

// ---------- API ----------
// API-specific controllers
// @ts-expect-error TS(2393): Duplicate function implementation.
async function updateDescription(planId: any, body: any) {
    const {description} = body;
    if (description.length > 2000)
        throw new APIError('Description to long', body, 400)
    await db.updateActivityPlanDescription(planId, description);
    return 'Description updated';
}

async function reorderSlots(id: any, order: any) {
    await db.reorderActivitySlots(id, order);
    return 'Order saved';
}

async function quickAddSlot(plan: any, body: any) {
    const {date, title = '', description = '', maxAssignees = 1} = body;
    const d = fromISOtoLocal(date);
    if (d < fromISOtoLocal(plan.start_date) || d > fromISOtoLocal(plan.end_date))
        throw new APIError('Date outside range', body, 400);

    if (!title) throw new APIError('Title required', body, 400);

    const last = Number(await db.getLastActivitySlotNumber(plan.id, d)) || 0;
    const slot = {
        id: generateUniqueId(),
        date: d,
        title,
        description,
        maxAssignees: Number(maxAssignees) || 1,
        position: last + 1
    };

    await db.addActivitySlot(plan.id, slot);
    return 'Slot added';
}

async function updateSlotDescription(slotId: any, body: any) {
    if (!(await db.updateActivitySlot(slotId, {description: body.description}))) {
        throw new APIError('Unknown error while saving', body, 500);
    }
    return 'Description updated';
}

async function updateSlotAttr(slotId: any, body: any) {
    const {field, value} = body;
    const allowed = {title: 1, description: 1, maxAssignees: 1};
    // @ts-expect-error TS(7053): Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
    if (!allowed[field]) throw new APIError('Invalid field', body, 400);

    if (!(await db.updateActivitySlot(slotId, {[field]: value}))) {
        throw new APIError('Unknown error while saving', body, 500);
    }
    return 'Slot updated';
}

// @ts-expect-error TS(2393): Duplicate function implementation.
async function deleteAssignment(assignId: any) {
    await db.deleteActivitySlotAssignment(assignId);
    return 'Assignment removed';
}

// @ts-expect-error TS(2393): Duplicate function implementation.
async function updateSettings(id: any, body: any) {
    const {allowAdd, guestManage} = body;
    await db.updateActivityPlanFlags(id, allowAdd, guestManage);
    return 'Settings saved';
}

async function deleteSlot(slotId: any) {
    await db.deleteActivitySlot(slotId);
    return 'Slot deleted';
}

async function addSlotRole(slotId: any, body: any) {
    const {roles} = body;
    if (!roles || !Array.isArray(roles) || roles.length < 1) {
        throw new APIError('Invalid roles', body, 400);
    }

    await db.addActivitySlotRoles(slotId, roles);
    return 'Roles added';
}

// @ts-expect-error TS(2393): Duplicate function implementation.
function getAssignmentAccessMapping() {
    return {
        assignToUser: (body: any, user: any) => db.assignActivitySlotToUser(body.slotId, user),
        assignToGuest: (body: any, user: any) => db.assignActivitySlotToGuest(body.slotId, user),
        unassignFromUser: (body: any, user: any) => db.unassignActivitySlotUser(body.slotId, user),
        unassignFromGuest: (body: any, user: any) => db.unassignActivitySlotGuest(body.slotId, user),
    };
}

function getRoleAccessMapping() {
    return {
        assignToUser: (body: any, user: any) => db.assignActivityAssignmentRoleToUser(body.slotId, user, body.role),
        assignToGuest: (body: any, user: any) => db.assignActivityAssignmentRoleToGuest(body.slotId, user, body.role),
        unassignFromUser: (body: any, user: any) => db.unassignActivityAssignmentRoleFromUser(body.slotId, user, body.role),
        unassignFromGuest: (body: any, user: any) => db.unassignActivityAssignmentRoleFromGuest(body.slotId, user, body.role),
    };
}

// @ts-expect-error TS(2552): Cannot find name 'module'. Did you mean 'modules'?
module.exports = {
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
