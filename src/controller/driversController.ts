import Joi from 'joi';

import * as driverService from '../modules/database/services/DriverService';
import {generateUniqueId} from "../modules/lib/util";
import {APIError, ValidationError} from '../modules/lib/errors';
import {DriversItem} from "../modules/database/entities/drivers/DriversItem";

// Template constant for create errors
const CREATE_TEMPLATE = 'drivers/drivers-create';

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
    return await driverService.createDriversListTx(
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
            position: i
        }))
    );
}

// No-op since slots handled in transaction

async function afterCreateItems() {
}

async function fetchForView(list: any, session: any) {
    const items = await driverService.getDriversItems(list.id);

    const assignments = session.user
        ? await driverService.getDriversAssignmentsForUser(list.id, session.user.id)
        : session.guest
            ? await driverService.getDriversAssignmentsForGuest(list.id, session.guest.id)
            : [];

    const assigneeLists = await driverService.getDriversItemAssignees(list.id);
    // Teilnehmer- und Offene-Zähler (ohne required_by_all-Items)
    const participantSet = new Set();
    let openCount = 0;
    let emptyCount = 0;

    items.forEach((it: any) => {                 // überspringen
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
    return await driverService.getDriversItems(list.id);
}

async function deleteEntity(list: any, session: any) {
    return await driverService.deleteDriversList(list.id);
}

// ---------- API ----------
// API-specific controllers
async function updateDescription(id: any, body: any) {
    const {description} = body;
    if (description.length > 2000)
        throw new APIError('Description to long', body, 400)
    await driverService.updateDriversListDescription(id, description);
    return 'Description updated';
}


async function reorderItems(id: any, order: any) {
    await driverService.reorderDriversItems(id, order);
    return 'Order saved';
}


async function quickAddItem(list: any, body: any, session: any) {
    const {title = '', description = '', max = 1} = body;
    if (!title) throw new APIError('Title required', body, 400);

    const last = Number(await driverService.getLastDriversItemNumber(list.id,)) || 0;
    const item: Partial<DriversItem> = {
        id: generateUniqueId(),
        title,
        description,
        maxAssignees: Number(max) || 1,
        pos: last + 1
    };

    if (session.user) {
        await driverService.createDriversItemUser(list.id, session.user.id, item);
    } else if (session.guest) {
        await driverService.createDriversItemGuest(list.id, session.guest.id, item);
    } else {
        throw new APIError('Not logged in', body, 400);
    }

    return 'Item added';
}


async function updateItemDescription(itemId: any, body: any) {
    if (!(await driverService.updateDriversItem(itemId, {description: body.description}))) {
        throw new APIError('Unknown error while saving', body, 500);
    }
    return 'Description updated';
}


async function updateItemAttr(itemId: any, body: any) {
    const {field, value} = body;
    const allowed: any = {title: 1, description: 1, maxAssignees: 1};

    if (!allowed[field]) throw new APIError('Invalid field', body, 400);

    if (!(await driverService.updateDriversItem(itemId, {[field]: value}))) {
        throw new APIError('Unknown error while saving', body, 500);
    }
    return 'Item updated';
}

async function deleteAssignment(assignId: any) {
    await driverService.deleteDriversAssignment(assignId);
    return 'Assignment removed';
}

async function updateSettings(id: any, body: any) {
    const {allowAdd, guestManage} = body;
    await driverService.updateDriversFlags(id, allowAdd, guestManage);
    return 'Settings saved';
}


async function deleteItem(itemId: any) {
    await driverService.deleteDriversItem(itemId);
    return 'Item deleted';
}

function getAssignmentAccessMapping() {
    return {
        assignToUser: (body: any, user: any) => driverService.assignDriversItemToUser(body.itemId, user),
        assignToGuest: (body: any, user: any) => driverService.assignDriversItemToGuest(body.itemId, user),
        unassignFromUser: (body: any, user: any) => driverService.unassignDriversItemUser(body.itemId, user),
        unassignFromGuest: (body: any, user: any) => driverService.unassignDriversItemGuest(body.itemId, user),
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
    reorderItems,
    quickAddItem,
    updateItemDescription,
    updateItemAttr,
    deleteAssignment,
    updateSettings,
    deleteItem,

    getAssignmentAccessMapping,
}