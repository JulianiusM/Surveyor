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

import express, {Request, Response, type NextFunction} from 'express';

import controller from "../../controller/packingController";
import {createEntityAdminApiRouter, createEntityArchiveApiRouter, createEntityPropertyApiRouter} from "../../middleware/adminApiFactory";
import {attachAssignRoutes} from '../../middleware/assignFlowFactory';
import {createEntityHeaderUpdateRouter} from "../../middleware/entityHeaderUpdateHandler";

import {apiParamHandler} from "../../middleware/paramHandler";
import {attachPermBundle, requireItemPermissionApi, requirePermissionApi} from '../../middleware/permissionMiddleware';
import * as packingService from '../../modules/database/services/PackingService';
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
import {APIError} from '../../modules/lib/errors';
import type {ItemGetter} from "../../types/PermissionTypes";
import type {EntityItemType, EntityType} from "../../types/UtilTypes";
import {packingItemFieldPermission} from '../../modules/packing/api';
import {entityPropertyPermission} from '../../controller/entityAdminController';
import type {components} from '../../types/api/v1';

const app = express.Router();

const entityName: EntityType = ENTITIES.PACKING;
const entityItemName: EntityItemType = ENTITY_ITEMS.PACKING;
const assignName = "assignment"
const resFct = (req: Request) => getResource(req, entityName);
const resFctItems = (req: Request) => getAdditional(req, entityItemName);
const resFctAssign = (req: Request) => getAdditional(req, assignName);
const permFct = getPermFct(resFct, entityName);
const permFctItems = getPermFctItems(resFct, resFctItems, entityName, entityItemName);
const permFctAssign = getPermFctAssign(resFct, resFctAssign, entityName, entityItemName);
const itemPermFct: ItemGetter = getItemFromEntityPermFct(packingService.getPackingItems, resFct, entityItemName);

apiParamHandler('id', app, packingService.getPackingListById, entityName);
apiParamHandler('itemId', app, packingService.getPackingItemById, entityItemName);
apiParamHandler('assignId', app, packingService.getPackingAssignmentById, assignName);
app.use("/:id", attachPermBundle(permFct, itemPermFct));

createEntityAdminApiRouter(app, entityName, permFct)
// Undated lists still support manual archival and event inheritance. Resolve the target
// through the existing :id loader and leave lifecycle authorization to the shared controller.
createEntityArchiveApiRouter(app, entityName, resFct);
createEntityPropertyApiRouter(app, entityName, resFct, controller.updateProperties);

app.post('/:id/description', requirePermissionApi(permFct, PERM[entityPropertyPermission('packing', 'description')!]), asyncHandler(async (req: Request, res: Response) => {
    const msg = await controller.updateDescription(resFct(req).id, req.body, resFct(req).eventId ?? null, req.session);
    renderer.respondWithSuccessJson(res, msg);
}))

/* Assign / Unassign identical to packing routes … */
/* ───────────────── ASSIGN / UNASSIGN (JSON) ───────────────── */

attachAssignRoutes(app, controller.getAssignmentAccessMapping(), {
    middleware: [requirePermissionApi(permFct, PERM.ACCESS_VIEW)],
    resolveItemEntityId: async (itemId) => (await packingService.getPackingItemById(itemId))?.entityId,
});
createEntityHeaderUpdateRouter(app, permFct, resFct, controller.updateHeaderImg, controller.deleteHeaderImg);

/* ───────────────── REORDER (Owner) ────────────────────────── */

/* ----------- REORDER (nur Owner, JSON-Antwort) ---------------- */
app.post('/:id/reorder', requirePermissionApi(permFct, PERM.ITEM_EDIT), asyncHandler(async (req: Request, res: Response) => {
    const msg = await controller.reorderItems(resFct(req).id, req.body.orders, req.session);
    renderer.respondWithSuccessJson(res, msg);
}));

/* ───────────────── QUICK-ADD ──────────────────────────────── */

app.post('/:id/items', requirePermissionApi(permFct, PERM.ITEM_ADD), asyncHandler(async (req: Request, res: Response) => {
    const msg = await controller.quickAddItem(resFct(req), req.body, req.session);
    renderer.respondWithSuccessJson(res, msg);
}));

/** Translate the existing field declaration to the native middleware's numeric permission contract. */
function requireItemFieldPermission(field: keyof components['schemas']['PackingItemPatch']) {
    const rule = packingItemFieldPermission(field);
    const parent = Array.isArray(rule.parent) ? rule.parent.map(key => PERM[key])
        : rule.parent ? PERM[rule.parent] : undefined;
    return requireItemPermissionApi(permFctItems, PERM[rule.permission], parent);
}

app.post('/:id/item/:itemId/description', requireItemFieldPermission('description'), asyncHandler(async (req: Request, res: Response) => {
    const msg = await controller.updateItemDescription(req.params.itemId as string, req.body, resFct(req).id, req.session);
    renderer.respondWithSuccessJson(res, msg);
}));

/* ---------- PATCH einzelnes Attribut -------------------------------- */
// The inline title/capacity controls use their field grants, as the separate description route does.
function requireAttributePermission(req: Request, res: Response, next: NextFunction) {
    const field = req.body?.field;
    if (!['title', 'description', 'maxAssignees'].includes(field)) return next(new APIError('Invalid field', {}, 400));
    return requireItemFieldPermission(field)(req, res, next);
}
app.post('/:id/item/:itemId/attr', requireAttributePermission, asyncHandler(async (req: Request, res: Response) => {
    const msg = await controller.updateItemAttr(req.params.itemId as string, req.body, resFct(req).id, req.session);
    renderer.respondWithSuccessJson(res, msg);
}));

/* ---------- Everyone flag -------------------------------- */
app.post('/:id/item/:itemId/required', requireItemFieldPermission('requiredByAll'), asyncHandler(async (req: Request, res: Response) => {
    const msg = await controller.updateRequired(req.params.itemId as string, req.body, resFct(req).id, req.session);
    renderer.respondWithSuccessJson(res, msg);
}));

app.post('/:id/assignment/:assignId/delete', requireItemPermissionApi(permFctAssign, PERM.MANAGE_ASSIGNMENTS), asyncHandler(async (req: Request, res: Response) => {
    const msg = await controller.deleteAssignment(req.params.assignId as string, resFct(req).id, req.session);
    renderer.respondWithSuccessJson(res, msg);
}));

/* Owner-Settings ändern (AJAX) -------------------------------------- */
app.post('/:id/settings', requirePermissionApi(permFct, PERM.MANAGE_PERMISSIONS), asyncHandler(async (req: Request, res: Response) => {
    const msg = await controller.updateSettings(resFct(req).id, req.body, req.session);
    renderer.respondWithSuccessJson(res, msg);
}));

app.post('/:id/item/:itemId/delete', requireItemPermissionApi(permFctItems, PERM.ITEM_DELETE, PERM.ITEM_DELETE), asyncHandler(async (req: Request, res: Response) => {
    const msg = await controller.deleteItem(req.params.itemId as string, resFct(req).id, req.session);
    renderer.respondWithSuccessJson(res, msg);
}));

export default app;
