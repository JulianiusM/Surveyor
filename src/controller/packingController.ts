import {Request} from "express";
import Joi from 'joi';
import {PackingItem} from "../modules/database/entities/packing/PackingItem";
import {PackingList} from "../modules/database/entities/packing/PackingList";

import * as packingService from '../modules/database/services/PackingService';
import {APIError, ValidationError} from '../modules/lib/errors';
import {ENTITIES, generateUniqueId} from "../modules/lib/util";
import {saveDefaultPermsFromBody} from "../modules/permissionEngine";

// Template constant for create errors
const CREATE_TEMPLATE = 'packing/packing-create';

function preprocessCreate(body: any): Partial<PackingList> & { items: Partial<PackingItem>[] } {
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
        description: Joi.string().allow('').optional(),
        items: Joi.array().items(itemSchema).min(1).required(),
        event_id: Joi.string().uuid().allow('').optional(),
    });

    const {error, value} = schema.validate(
        {
            title: body.title,
            description: body.description,
            items,
            event_id: body.event_id,
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
        items: value.items,
        eventId: value.event_id || null,
    };
}

/*  ---- NEU: alles in einer Transaktion ---- */
async function createEntity(
    ownerId: number,
    listData: Partial<PackingList> & { items: Partial<PackingItem>[] },
) {
    return await packingService.createPackingListTx(
        ownerId,
        listData.title!,
        listData.description!,

        listData.items.map((it, i) => ({
            id: generateUniqueId(),
            title: it.title!,
            description: it.description || '',
            maxAssignees: Number(it.maxAssignees) || 1,
            requiredByAll: Boolean(it.requiredByAll),
            position: i
        })),
        listData.eventId,
    );
}

// No-op since slots handled in transaction
async function afterCreateItems(id: string, data: any) {
    await saveDefaultPermsFromBody(ENTITIES.PACKING, id, data._body);
}

async function fetchForView(list: PackingList, req: Request) {
    const items = await packingService.getPackingItems(list.id);
    const session = req.session;

    const assignments = session.user
        ? await packingService.getPackingAssignmentsForUser(list.id, session.user.id)
        : session.guest
            ? await packingService.getPackingAssignmentsForGuest(list.id, session.guest.id)
            : [];

    const assigneeLists = await packingService.getPackingItemAssignees(list.id);
    // Teilnehmer- und Offene-Zähler (ohne required_by_all-Items)
    const participantSet = new Set();
    let openCount = 0;
    let emptyCount = 0;

    items.forEach((it) => {
        if (it.requiredByAll) return;                      // überspringen
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

async function fetchForDuplicate(list: PackingList, session: Request['session']) {
    return await packingService.getPackingItems(list.id);
}

async function deleteEntity(list: PackingList, session: Request['session']) {
    return await packingService.deletePackingList(list.id);
}

// ---------- API ----------
// API-specific controllers
async function updateDescription(id: string, body: any) {
    const {description} = body;
    if (description.length > 2000)
        throw new APIError('Description to long', body, 400)
    await packingService.updatePackingListDescription(id, description);
    return 'Description updated';
}

async function reorderItems(id: string, order: any) {
    await packingService.reorderPackingItems(id, order);
    return 'Order saved';
}

async function quickAddItem(list: PackingList, body: any) {
    const {title = '', description = '', max = 1} = body;
    if (!title) throw new APIError('Title required', body, 400);

    const last = await packingService.getLastPackingItemNumber(list.id,) || 0;
    const item = {
        id: generateUniqueId(),
        title,
        description,
        maxAssignees: Number(max) || 1,
        position: last + 1
    };

    await packingService.addPackingItems(list.id, [item]);
    return 'Item added';
}

async function updateItemDescription(itemId: string, body: any) {
    if (!(await packingService.updatePackingItem(itemId, {description: body.description}))) {
        throw new APIError('Unknown error while saving', body, 500);
    }
    return 'Description updated';
}

async function updateItemAttr(itemId: string, body: any) {
    const {field, value} = body;
    const allowed: Record<string, boolean> = {title: true, description: true, maxAssignees: true};

    if (!allowed[field]) throw new APIError('Invalid field', body, 400);

    if (!(await packingService.updatePackingItem(itemId, {[field]: value}))) {
        throw new APIError('Unknown error while saving', body, 500);
    }
    return 'Item updated';
}

async function updateRequired(itemId: string, body: any) {
    const {flag} = body;
    await packingService.togglePackingItemRequiredByAll(itemId, flag);
    return 'Requirement updated';
}

async function deleteAssignment(assignId: string) {
    await packingService.deletePackingAssignment(assignId);
    return 'Assignment removed';
}

async function updateSettings(id: string, body: any) {
    await saveDefaultPermsFromBody(ENTITIES.PACKING, id, body);
    return 'Settings saved';
}

async function deleteItem(itemId: string) {
    await packingService.deletePackingItem(itemId);
    return 'Item deleted';
}

function getAssignmentAccessMapping() {
    return {
        assignToUser: (body: any, userId: number) => packingService.assignPackingItemToUser(body.itemId, userId),
        assignToGuest: (body: any, guestId: string) => packingService.assignPackingItemToGuest(body.itemId, guestId),
        unassignFromUser: (body: any, userId: number) => packingService.unassignPackingItemUser(body.itemId, userId),
        unassignFromGuest: (body: any, guestId: string) => packingService.unassignPackingItemGuest(body.itemId, guestId),
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
    updateRequired,

    getAssignmentAccessMapping,
}