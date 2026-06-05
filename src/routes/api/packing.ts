import express, {Request, Response} from 'express';

import controller from "../../controller/packingController";
import {createEntityAdminApiRouter} from "../../middleware/adminApiFactory";
import {attachAssignRoutes} from '../../middleware/assignFlowFactory';

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
import type {ItemGetter} from "../../types/PermissionTypes";
import type {EntityItemType, EntityType} from "../../types/UtilTypes";

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

app.post('/:id/description', requirePermissionApi(permFct, PERM.EDIT_DESC), asyncHandler(async (req: Request, res: Response) => {
    const msg = await controller.updateDescription(resFct(req).id, req.body);
    renderer.respondWithSuccessJson(res, msg);
}))

/* Assign / Unassign identical to packing routes … */
/* ───────────────── ASSIGN / UNASSIGN (JSON) ───────────────── */

attachAssignRoutes(app, controller.getAssignmentAccessMapping());

/* ───────────────── REORDER (Owner) ────────────────────────── */

/* ----------- REORDER (nur Owner, JSON-Antwort) ---------------- */
app.post('/:id/reorder', requirePermissionApi(permFct, PERM.ITEM_EDIT), asyncHandler(async (req: Request, res: Response) => {
    const msg = await controller.reorderItems(resFct(req).id, req.body.orders);
    renderer.respondWithSuccessJson(res, msg);
}));

/* ───────────────── QUICK-ADD ──────────────────────────────── */

app.post('/:id/items', requirePermissionApi(permFct, PERM.ITEM_ADD), asyncHandler(async (req: Request, res: Response) => {
    const msg = await controller.quickAddItem(resFct(req), req.body);
    renderer.respondWithSuccessJson(res, msg);
}));

app.post('/:id/item/:itemId/description', requireItemPermissionApi(permFctItems, PERM.EDIT_DESC, [PERM.ITEM_EDIT, PERM.ITEM_EDIT_DESC]), asyncHandler(async (req: Request, res: Response) => {
    const msg = await controller.updateItemDescription(req.params.itemId, req.body);
    renderer.respondWithSuccessJson(res, msg);
}));

/* ---------- PATCH einzelnes Attribut -------------------------------- */
app.post('/:id/item/:itemId/attr', requireItemPermissionApi(permFctItems, PERM.EDIT_META, PERM.ITEM_EDIT), asyncHandler(async (req: Request, res: Response) => {
    const msg = await controller.updateItemAttr(req.params.itemId, req.body);
    renderer.respondWithSuccessJson(res, msg);
}));

/* ---------- Everyone flag -------------------------------- */
app.post('/:id/item/:itemId/required', requireItemPermissionApi(permFctItems, PERM.EDIT_META, PERM.ITEM_EDIT), asyncHandler(async (req: Request, res: Response) => {
    const msg = await controller.updateRequired(req.params.itemId, req.body);
    renderer.respondWithSuccessJson(res, msg);
}));

app.post('/:id/assignment/:assignId/delete', requireItemPermissionApi(permFctAssign, PERM.MANAGE_ASSIGNMENTS), asyncHandler(async (req: Request, res: Response) => {
    const msg = await controller.deleteAssignment(req.params.assignId);
    renderer.respondWithSuccessJson(res, msg);
}));

/* Owner-Settings ändern (AJAX) -------------------------------------- */
app.post('/:id/settings', requirePermissionApi(permFct, PERM.MANAGE_PERMISSIONS), asyncHandler(async (req: Request, res: Response) => {
    const msg = await controller.updateSettings(resFct(req).id, req.body);
    renderer.respondWithSuccessJson(res, msg);
}));

app.post('/:id/item/:itemId/delete', requireItemPermissionApi(permFctItems, PERM.ITEM_DELETE, PERM.ITEM_DELETE), asyncHandler(async (req: Request, res: Response) => {
    const msg = await controller.deleteItem(req.params.itemId);
    renderer.respondWithSuccessJson(res, msg);
}));

export default app;