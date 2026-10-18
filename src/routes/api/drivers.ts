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

import express, {Request, Response} from 'express';

import controller from "../../controller/driversController";
import {driversMethodPermission} from '../../controller/driversController';
import type {DriversMethod} from '../../types/DriversTypes';
import {createEntityAdminApiRouter, createEntityArchiveApiRouter, createEntityPropertyApiRouter} from "../../middleware/adminApiFactory";
import {attachAssignRoutes} from '../../middleware/assignFlowFactory';
import {createEntityHeaderUpdateRouter} from "../../middleware/entityHeaderUpdateHandler";

import {apiParamHandler} from "../../middleware/paramHandler";
import {attachPermBundle, requireItemPermissionApi, requirePermissionApi} from '../../middleware/permissionMiddleware';
import * as driverService from '../../modules/database/services/DriverService';
import {asyncHandler} from '../../modules/lib/asyncHandler';
import {PERM} from "../../modules/lib/permissions";
import {
    ENTITIES,
    ENTITY_ITEMS,
    getAdditional,
    getItemFromEntityPermFct,
    getPermFct,
    getPermFctAssign,
    getPermFctItems,
    getResource
} from "../../modules/lib/util";
import renderer from '../../modules/renderer';
import type {ItemGetter} from "../../types/PermissionTypes";
import type {EntityItemType, EntityType} from "../../types/UtilTypes";

const app = express.Router();

const entityName: EntityType = ENTITIES.DRIVERS;
const entityItemName: EntityItemType = ENTITY_ITEMS.DRIVERS;
const assignName = "assignment"
const resFct = (req: Request) => getResource(req, entityName);
const resFctItems = (req: Request) => getAdditional(req, entityItemName);
const resFctAssign = (req: Request) => getAdditional(req, assignName);
const permFct = getPermFct(resFct, entityName);
const permFctItems = getPermFctItems(resFct, resFctItems, entityName, entityItemName);
const permFctAssign = getPermFctAssign(resFct, resFctAssign, entityName, entityItemName);
const itemPermFct: ItemGetter = getItemFromEntityPermFct(driverService.getDriversItems, resFct, entityItemName);

/** Translate the existing controller method rule into native route admission. */
function requireDriversPermission(method: DriversMethod) {
    return requirePermissionApi(permFct, PERM[driversMethodPermission(method).permission]);
}

/** Item and assignment routes retain their current parent fallbacks through
 * the same declaration used by versioned commands and visible capabilities. */
function requireDriversItemPermission(method: DriversMethod, assignment = false) {
    const rule = driversMethodPermission(method);
    const parent = Array.isArray(rule.parent) ? rule.parent.map(key => PERM[key])
        : rule.parent ? PERM[rule.parent] : undefined;
    return requireItemPermissionApi(assignment ? permFctAssign : permFctItems, PERM[rule.permission], parent);
}

apiParamHandler('id', app, driverService.getDriversListById, entityName);
apiParamHandler('itemId', app, driverService.getDriversItemById, entityItemName);
apiParamHandler('assignId', app, driverService.getDriversAssignmentById, assignName);
app.use("/:id", attachPermBundle(permFct, itemPermFct))

createEntityAdminApiRouter(app, entityName, permFct)
// Pass the root resolved by :id so lifecycle commands cannot substitute a payload target.
// The shared archival controller applies EDIT_META and event-inheritance rules to this list.
createEntityArchiveApiRouter(app, entityName, resFct);
createEntityPropertyApiRouter(app, entityName, resFct, controller.updateProperties);

app.post('/:id/description', requireDriversPermission('editDescription'), async (req: Request, res: Response) => {
    const msg = await controller.updateDescription(resFct(req).id, req.body, resFct(req).eventId ?? null);
    renderer.respondWithSuccessJson(res, msg);
})

/* Assign / Unassign identical to packing routes … */
/* ───────────────── ASSIGN / UNASSIGN (JSON) ───────────────── */

attachAssignRoutes(app, controller.getAssignmentAccessMapping(), {
    middleware: [requireDriversPermission('selfAssignment')],
    resolveItemEntityId: async (itemId) => (await driverService.getDriversItemById(itemId))?.entityId,
});
createEntityHeaderUpdateRouter(app, permFct, resFct, controller.updateHeaderImg, controller.deleteHeaderImg);

/* ───────────────── REORDER (Owner) ────────────────────────── */

/* ----------- REORDER (nur Owner, JSON-Antwort) ---------------- */
app.post('/:id/reorder', requireDriversPermission('reorderItems'), asyncHandler(async (req: Request, res: Response) => {
    const msg = await controller.reorderItems(resFct(req).id, req.body.orders);
    renderer.respondWithSuccessJson(res, msg);
}));

/* ───────────────── QUICK-ADD ──────────────────────────────── */

app.post('/:id/items', requireDriversPermission('addItem'), asyncHandler(async (req: Request, res: Response) => {
    const msg = await controller.quickAddItem(resFct(req), req.body, req.session);
    renderer.respondWithSuccessJson(res, msg);
}));

app.post('/:id/item/:itemId/description', requireDriversItemPermission('editItemDescription'), asyncHandler(async (req: Request, res: Response) => {
    const msg = await controller.updateItemDescription(req.params.itemId as string, req.body);
    renderer.respondWithSuccessJson(res, msg);
}));

/* ---------- PATCH einzelnes Attribut -------------------------------- */
app.post('/:id/item/:itemId/attr', requireDriversItemPermission('editItemAttr'), asyncHandler(async (req: Request, res: Response) => {
    const msg = await controller.updateItemAttr(req.params.itemId as string, req.body);
    renderer.respondWithSuccessJson(res, msg);
}));

app.post('/:id/assignment/:assignId/delete', requireDriversItemPermission('deleteAssignment', true), asyncHandler(async (req: Request, res: Response) => {
    const msg = await controller.deleteAssignment(Number(req.params.assignId));
    renderer.respondWithSuccessJson(res, msg);
}));

/* Owner-Settings ändern (AJAX) -------------------------------------- */
app.post('/:id/settings', requireDriversPermission('managePermissions'), asyncHandler(async (req: Request, res: Response) => {
    const msg = await controller.updateSettings(resFct(req).id, req.body);
    renderer.respondWithSuccessJson(res, msg);
}));

app.post('/:id/item/:itemId/delete', requireDriversItemPermission('deleteItem'), asyncHandler(async (req: Request, res: Response) => {
    const msg = await controller.deleteItem(req.params.itemId as string);
    renderer.respondWithSuccessJson(res, msg);
}));

export default app;
