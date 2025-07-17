// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'Joi'.
const Joi = require('joi');

// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'db'.
const db = require('../modules/database/db');
// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'generateUn... Remove this comment to see the full error message
const {generateUniqueId} = require("../modules/lib/util");
// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'Validation... Remove this comment to see the full error message
const {ValidationError, APIError} = require('../modules/lib/errors');

// Template constant for create errors
// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'CREATE_TEM... Remove this comment to see the full error message
const CREATE_TEMPLATE = 'packing/packing-create';

function preprocessCreate(body: any) {
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
        const msg = error.details.map((d: any) => d.message).join(', ');
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
async function createEntity(ownerId: any, listData: any) {
    return await db.createPackingListTx(
        ownerId,
        listData.title,
        listData.description,
        listData.allow,
        listData.guestManage,
        // @ts-expect-error TS(7006): Parameter 'it' implicitly has an 'any' type.
        listData.items.map((it, i) => ({
            id: generateUniqueId(),
            title: it.title,
            description: it.description || '',
            maxAssignees: Number(it.maxAssignees) || 1,
            requiredByAll: Boolean(it.requiredByAll),
            position: i
        }))
    );
}

// No-op since slots handled in transaction
// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'afterCreat... Remove this comment to see the full error message
async function afterCreateItems() {
}

async function fetchForView(list: any, session: any) {
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

    items.forEach((it: any) => {
        if (it.required_by_all) return;                      // überspringen
        const arr = assigneeLists[it.id] || [];
        arr.forEach((a: any) => {
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

async function fetchForDuplicate(list: any, session: any) {
    return await db.getPackingItems(list.id);
}

async function deleteEntity(list: any, session: any) {
    return await db.deletePackingList(list.id);
}

// ---------- API ----------
// API-specific controllers
async function updateDescription(id: any, body: any) {
    const {description} = body;
    if (description.length > 2000)
        throw new APIError('Description to long', body, 400)
    await db.updatePackingListDescription(id, description);
    return 'Description updated';
}

async function reorderItems(id: any, order: any) {
    await db.reorderPackingItems(id, order);
    return 'Order saved';
}

async function quickAddItem(list: any, body: any) {
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

async function updateItemDescription(itemId: any, body: any) {
    if (!(await db.updatePackingItem(itemId, {description: body.description}))) {
        throw new APIError('Unknown error while saving', body, 500);
    }
    return 'Description updated';
}

async function updateItemAttr(itemId: any, body: any) {
    const {field, value} = body;
    const allowed = {title: 1, description: 1, maxAssignees: 1};
    // @ts-expect-error TS(7053): Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
    if (!allowed[field]) throw new APIError('Invalid field', body, 400);

    if (!(await db.updatePackingItem(itemId, {[field]: value}))) {
        throw new APIError('Unknown error while saving', body, 500);
    }
    return 'Item updated';
}

async function updateRequired(itemId: any, body: any) {
    const {flag} = body;
    await db.togglePackingItemRequiredByAll(itemId, flag);
    return 'Requirement updated';
}

async function deleteAssignment(assignId: any) {
    await db.deletePackingAssignment(assignId);
    return 'Assignment removed';
}

async function updateSettings(id: any, body: any) {
    const {allowAdd, guestManage} = body;
    await db.updatePackingFlags(id, allowAdd, guestManage);
    return 'Settings saved';
}

async function deleteItem(itemId: any) {
    await db.deletePackingItem(itemId);
    return 'Item deleted';
}

function getAssignmentAccessMapping() {
    return {
        assignToUser: (body: any, user: any) => db.assignPackingItemToUser(body.itemId, user),
        assignToGuest: (body: any, user: any) => db.assignPackingItemToGuest(body.itemId, user),
        unassignFromUser: (body: any, user: any) => db.unassignPackingItemUser(body.itemId, user),
        unassignFromGuest: (body: any, user: any) => db.unassignPackingItemGuest(body.itemId, user),
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