/*
 * Copyright 2026 Julian Malovanij
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {Request} from "express";
import {assertEntityPropertyContext, normalizeBasicProperties} from './entityAdminController';
import type {BasicEntityPropertyPatch} from '../types/EntityPropertyTypes';
import Joi from 'joi';
import {DriversItem} from "../modules/database/entities/drivers/DriversItem";
import {DriversList} from "../modules/database/entities/drivers/DriversList";

import * as driverService from '../modules/database/services/DriverService';
import {APIError, ValidationError} from '../modules/lib/errors';
import {performImageSwap} from "../modules/lib/fileCommons";
import {ENTITIES, generateUniqueId} from "../modules/lib/util";
import {saveDefaultPermsFromBody} from "../modules/permissionEngine";
import type {EntityBase} from "../types/UserTypes";

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
    ownerId: string,
    listData: Partial<DriversList>
) {
    return await driverService.createDriversList(
        ownerId,
        listData.title!,
        listData.description!,
        listData.eventId,
        listData.headerImg,
    );
}

async function afterCreateItems(id: string, data: any) {
    await saveDefaultPermsFromBody(ENTITIES.DRIVERS, id, data._body);
}

async function fetchForView(list: DriversList, req: Request) {
    const items = await driverService.getDriversItems(list.id);
    const session = req.session;

    const assignments = await driverService.getDriversAssignments(list.id, session.profile!.id)

    const assigneeLists = await driverService.getDriversItemAssignees(list.id);
    // Teilnehmer- und Offene-Zähler (ohne required_by_all-Items)
    const participantSet = new Set();
    let openCount = 0;
    let emptyCount = 0;

    items.forEach((it) => {                 // überspringen
        const arr = assigneeLists[it.id] || [];
        arr.forEach((a) => {
            let id;
            if (a.profileId) {
                id = `p_${a.profileId}`;
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
async function updateDescription(id: string, body: any, expectedEventId?: string | null) {
    await saveProperties(id, normalizeBasicProperties({description: body.description}), expectedEventId);
    return 'Description updated';
}


async function reorderItems(id: string, order: Array<{ itemId: string; position: number }>) {
    await driverService.reorderDriversItems(id, order);
    return 'Order saved';
}


async function quickAddItem(list: DriversList, body: any, session: Request['session']) {
    const {title = '', description = '', maxAssignees = '1'} = body;
    if (!title) throw new APIError('Title required', body, 400);

    const last = Number(await driverService.getLastDriversItemNumber(list.id,)) || 0;
    const item: Partial<DriversItem> = {
        id: generateUniqueId(),
        title,
        description,
        maxAssignees: Number(maxAssignees) || 1,
        pos: last + 1
    };

    if (session.profile) {
        await driverService.createDriversItem(list.id, session.profile.id, item);
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

async function updateHeaderImg(entity: EntityBase, file?: Express.Multer.File) {
    await performImageSwap(entity, driverService.updateHeaderImage, file);
    return 'Image updated';
}

async function deleteHeaderImg(entity: EntityBase) {
    await performImageSwap(entity, driverService.updateHeaderImage);
    return 'Image deleted';
}

function getAssignmentAccessMapping() {
    return {
        assign: (body: any, profileId: string) => assignItem(body.itemId, profileId),
        unassign: (body: any, profileId: string) => driverService.unassignDriversItem(body.itemId, profileId),
    };
}

/**
 * Assignment policy belongs to the controller. Check the locked DB snapshot in this order:
 * absence is a 404, an existing assignment is an idempotent retry, then capacity constrains
 * a new assignment. The DBAL keeps the item lock until the approved insertion commits.
 */
async function assignItem(itemId: string, profileId: string): Promise<void> {
    await driverService.withDriversAssignmentLock(itemId, profileId, async function assignLocked(manager, item, existing, count) {
        if (!item) throw new APIError('Drivers item not found', {itemId}, 404);
        if (existing) return;
        if (typeof item.maxAssignees === 'number' && count >= item.maxAssignees) {
            throw new APIError('This driver offer is already full', {itemId}, 409);
        }
        await driverService.assignDriversItem(itemId, profileId, manager);
    });
}

/**
 * Both the legacy description route and the property form use this controller boundary.
 * A parent change after route authorization must reject the whole patch, since permissions
 * might have come from registration in the old event. Keep that check under the root lock.
 */
async function saveProperties(id: string, patch: BasicEntityPropertyPatch, expectedEventId?: string | null): Promise<void> {
    await driverService.withDriversListLock(id, async function saveLocked(manager, current) {
        assertEntityPropertyContext(current, expectedEventId);
        await driverService.updateDriversListProperties(id, patch, manager);
    });
}

/** Normalize all submitted fields before acquiring a lock; omitted fields remain unchanged. */
async function updateProperties(entity: EntityBase, body: unknown) {
    await saveProperties(entity.id, normalizeBasicProperties(body), entity.eventId ?? null);
    return 'Properties updated';
}

export default {
    updateProperties,
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

    updateHeaderImg,
    deleteHeaderImg,

    getAssignmentAccessMapping,
}
