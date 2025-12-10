import express, {Request, Response} from 'express';
import * as driverService from '../../modules/database/services/DriverService';
import {asyncHandler} from '../../modules/lib/asyncHandler';
import renderer from '../../modules/renderer';
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

import {apiParamHandler} from "../../middleware/paramHandler";
import {attachPermBundle, requireItemPermissionApi, requirePermissionApi} from '../../middleware/permissionMiddleware';
import {attachAssignRoutes} from '../../middleware/assignFlowFactory';

import controller from "../../controller/driversController";
import {PERM} from "../../modules/lib/permissions";
import type {EntityItemType, EntityType} from "../../types/UtilTypes";
import {createEntityAdminApiRouter} from "../../middleware/adminApiFactory";
import type {ItemGetter} from "../../types/PermissionTypes";

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

apiParamHandler('id', app, driverService.getDriversListById, entityName);
apiParamHandler('itemId', app, driverService.getDriversItemById, entityItemName);
apiParamHandler('assignId', app, driverService.getDriversAssignmentById, assignName);
app.use("/:id", attachPermBundle(permFct, itemPermFct))

createEntityAdminApiRouter(app, entityName, permFct)

app.post('/:id/description', requirePermissionApi(permFct, PERM.EDIT_DESC), async (req: Request, res: Response) => {
    const msg = await controller.updateDescription(resFct(req).id, req.body);
    renderer.respondWithSuccessJson(res, msg);
})

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
    const msg = await controller.quickAddItem(resFct(req), req.body, req.session);
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

app.post('/:id/assignment/:assignId/delete', requireItemPermissionApi(permFctAssign, PERM.MANAGE_ASSIGNMENTS), asyncHandler(async (req: Request, res: Response) => {
    const msg = await controller.deleteAssignment(Number(req.params.assignId));
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