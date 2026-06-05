import {Request} from "express";
import Joi from 'joi';
import {DriversItem} from "../modules/database/entities/drivers/DriversItem";
import {DriversList} from "../modules/database/entities/drivers/DriversList";

import * as driverService from '../modules/database/services/DriverService';
import {APIError, ValidationError} from '../modules/lib/errors';
import {ENTITIES, generateUniqueId} from "../modules/lib/util";
import {saveDefaultPermsFromBody} from "../modules/permissionEngine";

// Template constant for create errors
const CREATE_TEMPLATE = 'drivers/drivers-create';

function preprocessCreate(body: any): Partial<DriversList> {
    const schema = Joi.object({
        title: Joi.string().required(),
        description: Joi.string().allow('').optional(),
        event_id: Joi.string().uuid().allow('').optional(),
    });

    const {error, value} = schema.validate(
        {
            title: body.title,
            description: body.description,
            event_id: body.event_id
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
        eventId: value.event_id || null,
    };
}

/*  ---- NEU: alles in einer Transaktion ---- */
async function createEntity(
    ownerId: number,
    listData: Partial<DriversList>
) {
    return await driverService.createDriversList(
        ownerId,
        listData.title!,
        listData.description!,
        listData.eventId,
    );
}

async function afterCreateItems(id: string, data: any) {
    await saveDefaultPermsFromBody(ENTITIES.DRIVERS, id, data._body);
}

async function fetchForView(list: DriversList, req: Request) {
    const items = await driverService.getDriversItems(list.id);
    const session = req.session;

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

    items.forEach((it) => {                 // überspringen
        const arr = assigneeLists[it.id] || [];
        arr.forEach((a) => {
            let id;
            if (a.userId) {
                id = `u_${a.userId}`;
            } else if (a.guestId) {
                id = `g_${a.guestId}`;
            } else {
                id = a.name;
            }
            participantSet.add(id);
        }); // id, fallback name
        if (it.assignedCount === 0) emptyCount++;
        if (it.assignedCount < (it.maxAssignees ?? 0)) openCount++;
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

async function fetchForDuplicate(list: DriversList, session: Request['session']) {
    return await driverService.getDriversItems(list.id);
}

async function deleteEntity(list: DriversList, session: Request['session']) {
    return await driverService.deleteDriversList(list.id);
}

// ---------- API ----------
// API-specific controllers
async function updateDescription(id: string, body: any) {
    const {description} = body;
    if (description.length > 2000)
        throw new APIError('Description to long', body, 400)
    await driverService.updateDriversListDescription(id, description);
    return 'Description updated';
}


async function reorderItems(id: string, order: Array<{ itemId: string; position: number }>) {
    await driverService.reorderDriversItems(id, order);
    return 'Order saved';
}


async function quickAddItem(list: DriversList, body: any, session: Request['session']) {
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


async function updateItemDescription(itemId: string, body: any) {
    if (!(await driverService.updateDriversItem(itemId, {description: body.description}))) {
        throw new APIError('Unknown error while saving', body, 500);
    }
    return 'Description updated';
}


async function updateItemAttr(itemId: string, body: any) {
    const {field, value} = body;
    const allowed: any = {title: 1, description: 1, maxAssignees: 1};

    if (!allowed[field]) throw new APIError('Invalid field', body, 400);

    if (!(await driverService.updateDriversItem(itemId, {[field]: value}))) {
        throw new APIError('Unknown error while saving', body, 500);
    }
    return 'Item updated';
}

async function deleteAssignment(assignId: number) {
    await driverService.deleteDriversAssignment(assignId);
    return 'Assignment removed';
}

async function updateSettings(id: string, body: any) {
    await saveDefaultPermsFromBody(ENTITIES.DRIVERS, id, body);
    return 'Settings saved';
}


async function deleteItem(itemId: string) {
    await driverService.deleteDriversItem(itemId);
    return 'Item deleted';
}

function getAssignmentAccessMapping() {
    return {
        assignToUser: (body: any, userId: number) => driverService.assignDriversItemToUser(body.itemId, userId),
        assignToGuest: (body: any, guestId: string) => driverService.assignDriversItemToGuest(body.itemId, guestId),
        unassignFromUser: (body: any, userId: number) => driverService.unassignDriversItemUser(body.itemId, userId),
        unassignFromGuest: (body: any, guestId: string) => driverService.unassignDriversItemGuest(body.itemId, guestId),
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