// controllers/activityController.js
// Business logic for the Activity routes
const Joi = require('joi');

const db = require('../modules/database/db');
const {fromISOtoLocal, generateUniqueId} = require('../modules/lib/util');

const {ValidationError, APIError} = require('../modules/lib/errors');

// Template constant for create errors
const CREATE_TEMPLATE = 'activity/activity-create';

/**
 * Validate and sanitize creation payload.
 * Throws ValidationError on failure; returns sanitized plan data on success.
 */
function preprocessCreate(body) {
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
        description: Joi.string().max(2000).required(),
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
        const msg = error.details.map(d => d.message).join(', ');
        throw new ValidationError(CREATE_TEMPLATE, msg, {body});
    }

    // Flatten slots arrays and return sanitized data
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
async function createEntity(ownerId, planData) {
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
const afterCreateItems = async () => {
};

/**
 * Assemble data for the view.
 */
async function fetchForView(plan, session) {
    const slotsByDate = await db.getActivitySlots(plan.id);
    const slotList = Object.values(slotsByDate).flat();

    const assignPromise = session.user
        ? db.getActivitySlotAssignmentsForUser(plan.id, session.user.id)
        : session.guest
            ? db.getActivitySlotAssignmentsForGuest(plan.id, session.guest.id)
            : Promise.resolve([]);
    const [assignments, assigneeLists] = await Promise.all([
        assignPromise,
        db.getActivitySlotAssignees(plan.id)
    ]);

    const participants = new Set();
    let empty = 0, open = 0;

    for (const slot of slotList) {
        (assigneeLists[slot.id] || []).forEach(a => {
            const key = a.user_id ? `u_${a.user_id}` : a.guest_id ? `g_${a.guest_id}` : a.name;
            participants.add(key);
        });
        if (slot.assigned_count === 0) empty++;
        if (slot.assigned_count < slot.max_assignees) open++;
    }

    return {
        plan,
        slots: slotsByDate,
        assignments,
        assigneeLists,
        counters: {participants: participants.size, open, empty}
    };
}

/**
 * Provide data for duplication form.
 */
async function fetchForDuplicate(plan, session) {
    return await db.getActivitySlots(plan.id);
}

/**
 * Delete plan if owned by current user.
 */
async function deleteEntity(plan, session) {
    return await db.deleteActivityPlan(plan.id);
}

// ---------- API ----------
// API-specific controllers
async function updateDescription(planId, body) {
    const {description} = body;
    if (description.length > 2000)
        throw new APIError('Description to long', body, 400)
    await db.updateActivityPlanDescription(planId, description);
    return 'Description updated';
}

async function reorderSlots(id, order) {
    await db.reorderActivitySlots(id, order);
    return 'Order saved';
}

async function quickAddSlot(plan, body) {
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

async function updateSlotDescription(slotId, body) {
    if (!await db.updateActivitySlot(slotId, {description: body.description})) {
        throw new APIError('Unknown error while saving', body, 500);
    }
    return 'Description updated';
}

async function updateSlotAttr(slotId, body) {
    const {field, value} = body;
    const allowed = {title: 1, description: 1, maxAssignees: 1};
    if (!allowed[field]) throw new APIError('Invalid field', body, 400);

    if (!await db.updateActivitySlot(slotId, {[field]: value})) {
        throw new APIError('Unknown error while saving', body, 500);
    }
    return 'Slot updated';
}

async function deleteAssignment(assignId) {
    await db.deleteActivitySlotAssignment(assignId);
    return 'Assignment removed';
}

async function updateSettings(id, body) {
    const {allowAdd, guestManage} = body;
    await db.updateActivityPlanFlags(id, allowAdd, guestManage);
    return 'Settings saved';
}

async function deleteSlot(slotId) {
    await db.deleteActivitySlot(slotId);
    return 'Slot deleted';
}

function getAssignmentAccessMapping() {
    return {
        assignToUser: (body, user) => db.assignActivitySlotToUser(body.slotId, user),
        assignToGuest: (body, user) => db.assignActivitySlotToGuest(body.slotId, user),
        unassignFromUser: (body, user) => db.unassignActivitySlotUser(body.slotId, user),
        unassignFromGuest: (body, user) => db.unassignActivitySlotGuest(body.slotId, user),
    }
}

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

    getAssignmentAccessMapping,
};
