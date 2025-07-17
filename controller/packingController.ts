const Joi = require('joi');

const db = require('../modules/database/db');
const {generateUniqueId} = require("../modules/lib/util");
const {ValidationError, APIError} = require('../modules/lib/errors');

// Template constant for create errors
const CREATE_TEMPLATE = 'packing/packing-create';

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
        maxAssignees: Joi.number().integer().min(1).required(),
        requiredByAll: Joi.boolean().required()
    });

    const schema = Joi.object({
        title: Joi.string().required(),
        allowGuestAdd: Joi.boolean(),
        guestManage: Joi.boolean(),
        items: Joi.array().items(itemSchema).min(1).required()
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
    return await db.createPackingListTx(
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
            requiredByAll: Boolean(it.requiredByAll),
            position: i,
        }))
    );
}

// No-op since slots handled in transaction
async function afterCreateItems() {
}

async function fetchForView(list, session) {
    const items = await db.getPackingItems(list.id);

    const assignments = session.user
        ? await db.getPackingAssignmentsForUser(list.id, session.user.id)
        : session.guest
            ? await db.getPackingAssignmentsForGuest(list.id, session.guest.id)
            : [];

    const assigneeLists = await db.getPackingItemAssignees(list.id);
    // Teilnehmer- und Offene-Zähler (ohne required_by_all-Items)
    const participantSet = new Set();
    let openCount = 0;
    let emptyCount = 0;

    items.forEach(it => {
        if (it.required_by_all) return;                      // überspringen
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
    return await db.getPackingItems(list.id);
}

async function deleteEntity(list, session) {
    return await db.deletePackingList(list.id);
}

// ---------- API ----------
// API-specific controllers
async function updateDescription(id, body) {
    const {description} = body;
    if (description.length > 2000)
        throw new APIError('Description to long', body, 400)
    await db.updatePackingListDescription(id, description);
    return 'Description updated';
}

async function reorderItems(id, order) {
    await db.reorderPackingItems(id, order);
    return 'Order saved';
}

async function quickAddItem(list, body) {
    const {title = '', description = '', max = 1} = body;
    if (!title) throw new APIError('Title required', body, 400);

    const last = Number(await db.getLastPackingItemNumber(list.id,)) || 0;
    const item = {
        id: generateUniqueId(),
        title,
        description,
        maxAssignees: Number(max) || 1,
        position: last + 1
    };

    await db.addPackingItems(list.id, [item]);
    return 'Item added';
}

async function updateItemDescription(itemId, body) {
    if (!await db.updatePackingItem(itemId, {description: body.description})) {
        throw new APIError('Unknown error while saving', body, 500);
    }
    return 'Description updated';
}

async function updateItemAttr(itemId, body) {
    const {field, value} = body;
    const allowed = {title: 1, description: 1, maxAssignees: 1};
    if (!allowed[field]) throw new APIError('Invalid field', body, 400);

    if (!await db.updatePackingItem(itemId, {[field]: value})) {
        throw new APIError('Unknown error while saving', body, 500);
    }
    return 'Item updated';
}

async function updateRequired(itemId, body) {
    const {flag} = body;
    await db.togglePackingItemRequiredByAll(itemId, flag);
    return 'Requirement updated';
}

async function deleteAssignment(assignId) {
    await db.deletePackingAssignment(assignId);
    return 'Assignment removed';
}

async function updateSettings(id, body) {
    const {allowAdd, guestManage} = body;
    await db.updatePackingFlags(id, allowAdd, guestManage);
    return 'Settings saved';
}

async function deleteItem(itemId) {
    await db.deletePackingItem(itemId);
    return 'Item deleted';
}

function getAssignmentAccessMapping() {
    return {
        assignToUser: (body, user) => db.assignPackingItemToUser(body.itemId, user),
        assignToGuest: (body, user) => db.assignPackingItemToGuest(body.itemId, user),
        unassignFromUser: (body, user) => db.unassignPackingItemUser(body.itemId, user),
        unassignFromGuest: (body, user) => db.unassignPackingItemGuest(body.itemId, user),
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
    updateRequired,

    getAssignmentAccessMapping,
}