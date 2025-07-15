const Joi = require('joi');

const db = require('../modules/database/db');
const {generateUniqueId} = require("../modules/lib/util");
const {ValidationError, APIError} = require('../modules/lib/errors');

// Template constant for create errors
const CREATE_TEMPLATE = 'drivers/drivers-create';

function preprocessCreate(body) {
    let items;
    try {
        items = JSON.parse(body.items || '[]');
    } catch {
        throw new ValidationError(CREATE_TEMPLATE, 'Invalid items JSON', {body});
    }

    const itemSchema = Joi.object({
        title: Joi.string().required(),
        description: Joi.string().allow(''),
        maxAssignees: Joi.number().integer().min(1).required()
    });

    const schema = Joi.object({
        title: Joi.string().required(),
        allowGuestAdd: Joi.boolean(),
        guestManage: Joi.boolean(),
        items: Joi.array().items(itemSchema).min(0).required()
    });

    const {error, value} = schema.validate(
        {
            title: body.title,
            description: body.description,
            allowGuestAdd: Boolean(body.allowGuestAdd),
            guestManage: Boolean(body.guestManage),
            items
        },
        {abortEarly: false, allowUnknown: true}
    );
    if (error) {
        const msg = error.details.map(d => d.message).join(', ');
        throw new ValidationError(CREATE_TEMPLATE, msg, {body});
    }

    return {
        title: value.title,
        description: value.description || null,
        allow: value.allowGuestAdd,
        guestManage: value.guestManage,
        items: value.items
    };
}

/*  ---- NEU: alles in einer Transaktion ---- */
async function createEntity(ownerId, listData) {
    return await db.createDriversListTx(
        ownerId,
        listData.title,
        listData.description,
        listData.allow,
        listData.guestManage,
        listData.items.map((it, i) => ({
            id: generateUniqueId(),
            title: it.title,
            description: it.description || '',
            maxAssignees: Number(it.maxAssignees) || 1,
            position: i,
        }))
    );
}

// No-op since slots handled in transaction
async function afterCreateItems() {
}

async function fetchForView(list, session) {
    const items = await db.getDriversItems(list.id);

    const assignments = session.user
        ? await db.getDriversAssignmentsForUser(list.id, session.user.id)
        : session.guest
            ? await db.getDriversAssignmentsForGuest(list.id, session.guest.id)
            : [];

    const assigneeLists = await db.getDriversItemAssignees(list.id);
    // Teilnehmer- und Offene-Zähler (ohne required_by_all-Items)
    const participantSet = new Set();
    let openCount = 0;
    let emptyCount = 0;

    items.forEach(it => {                 // überspringen
        const arr = assigneeLists[it.id] || [];
        arr.forEach(a => {
            let id;
            if (a.user_id) {
                id = `u_${a.user_id}`;
            } else if (a.guest_id) {
                id = `g_${a.guest_id}`;
            } else {
                id = a.name;
            }
            participantSet.add(id);
        }); // id, fallback name
        if (it.assigned_count === 0) emptyCount++;
        if (it.assigned_count < it.max_assignees) openCount++;
    });

    const participantCount = participantSet.size;

    return {
        list,
        items,
        assignments,
        assigneeLists,
        counters: {participants: participantCount, open: openCount, empty: emptyCount}
    };
}

async function fetchForDuplicate(list, session) {
    return await db.getDriversItems(list.id);
}

async function deleteEntity(list, session) {
    return await db.deleteDriversList(list.id);
}

// ---------- API ----------
// API-specific controllers
async function updateDescription(id, body) {
    const {description} = body;
    if (description.length > 2000)
        throw new APIError('Description to long', body, 400)
    await db.updateDriversListDescription(id, description);
    return 'Description updated';
}

async function reorderItems(id, order) {
    await db.reorderDriversItems(id, order);
    return 'Order saved';
}

async function quickAddItem(list, body, session) {
    const {title = '', description = '', max = 1} = body;
    if (!title) throw new APIError('Title required', body, 400);

    const last = Number(await db.getLastDriversItemNumber(list.id,)) || 0;
    const item = {
        id: generateUniqueId(),
        title,
        description,
        maxAssignees: Number(max) || 1,
        position: last + 1
    };

    if (session.user) {
        await db.createDriversItemUser(list.id, session.user.id, item);
    } else if (session.guest) {
        await db.createDriversItemGuest(list.id, session.guest.id, item);
    } else {
        throw new APIError('Not logged in', body, 400);
    }

    return 'Item added';
}

async function updateItemDescription(itemId, body) {
    if (!await db.updateDriversItem(itemId, {description: body.description})) {
        throw new APIError('Unknown error while saving', body, 500);
    }
    return 'Description updated';
}

async function updateItemAttr(itemId, body) {
    const {field, value} = body;
    const allowed = {title: 1, description: 1, maxAssignees: 1};
    if (!allowed[field]) throw new APIError('Invalid field', body, 400);

    if (!await db.updateDriversItem(itemId, {[field]: value})) {
        throw new APIError('Unknown error while saving', body, 500);
    }
    return 'Item updated';
}

async function deleteAssignment(assignId) {
    await db.deleteDriversAssignment(assignId);
    return 'Assignment removed';
}

async function updateSettings(id, body) {
    const {allowAdd, guestManage} = body;
    await db.updateDriversFlags(id, allowAdd, guestManage);
    return 'Settings saved';
}

async function deleteItem(itemId) {
    await db.deleteDriversItem(itemId);
    return 'Item deleted';
}

function getAssignmentAccessMapping() {
    return {
        assignToUser: (body, user) => db.assignDriversItemToUser(body.itemId, user),
        assignToGuest: (body, user) => db.assignDriversItemToGuest(body.itemId, user),
        unassignFromUser: (body, user) => db.unassignDriversItemUser(body.itemId, user),
        unassignFromGuest: (body, user) => db.unassignDriversItemGuest(body.itemId, user),
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
    reorderItems,
    quickAddItem,
    updateItemDescription,
    updateItemAttr,
    deleteAssignment,
    updateSettings,
    deleteItem,

    getAssignmentAccessMapping,
}