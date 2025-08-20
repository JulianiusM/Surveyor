import express from 'express';
import * as driverService from '../../modules/database/services/DriverService';
import {asyncHandler} from '../../modules/lib/asyncHandler';
import renderer from '../../modules/renderer';
import {getAdditional, getResource} from "../../modules/lib/util";

import {apiParamHandler} from "../../middleware/paramHandler";
import {requireAddRight, requireManageRight, requireOwner} from '../../middleware/permissionMiddleware';
import {attachAssignRoutes} from '../../middleware/assignFlowFactory';

import controller from "../../controller/driversController";

const app = express.Router();

const entityName = 'drivers';
const entityItemName = 'driversItem';
const resFct = (req: any) => getResource(req, entityName);
const resFctItems = (req: any) => getAdditional(req, entityItemName);

apiParamHandler('id', app, driverService.getDriversListById, entityName);
apiParamHandler('itemId', app, driverService.getDriversItemById, entityItemName);

app.post('/:id/description', requireAddRight(resFct), async (req: any, res: any) => {
    const msg = await controller.updateDescription(resFct(req).id, req.body);
    renderer.respondWithSuccessJson(res, msg);
})

/* Assign / Unassign identical to packing routes … */
/* ───────────────── ASSIGN / UNASSIGN (JSON) ───────────────── */

attachAssignRoutes(app, controller.getAssignmentAccessMapping());

/* ───────────────── REORDER (Owner) ────────────────────────── */

/* ----------- REORDER (nur Owner, JSON-Antwort) ---------------- */
app.post('/:id/reorder', requireManageRight(resFct), asyncHandler(async (req: any, res: any) => {
    const msg = await controller.reorderItems(resFct(req).id, req.body.orders);
    renderer.respondWithSuccessJson(res, msg);
}));

/* ───────────────── QUICK-ADD ──────────────────────────────── */

app.post('/:id/items', requireAddRight(resFct), asyncHandler(async (req: any, res: any) => {
    const msg = await controller.quickAddItem(resFct(req), req.body, req.session);
    renderer.respondWithSuccessJson(res, msg);
}));

app.post('/:id/item/:itemId/description', requireAddRight(resFct, resFctItems), asyncHandler(async (req: any, res: any) => {
    const msg = await controller.updateItemDescription(req.params.itemId, req.body);
    renderer.respondWithSuccessJson(res, msg);
}));

/* ---------- PATCH einzelnes Attribut -------------------------------- */
app.post('/:id/item/:itemId/attr', requireManageRight(resFct, resFctItems), asyncHandler(async (req: any, res: any) => {
    const msg = await controller.updateItemAttr(req.params.itemId, req.body);
    renderer.respondWithSuccessJson(res, msg);
}));

app.post('/:id/assignment/:assignId/delete', requireManageRight(resFct), asyncHandler(async (req: any, res: any) => {
    const msg = await controller.deleteAssignment(req.params.assignId);
    renderer.respondWithSuccessJson(res, msg);
}));

/* Owner-Settings ändern (AJAX) -------------------------------------- */
app.post('/:id/settings', requireOwner(resFct), asyncHandler(async (req: any, res: any) => {
    const msg = await controller.updateSettings(resFct(req).id, req.body);
    renderer.respondWithSuccessJson(res, msg);
}));

app.post('/:id/item/:itemId/delete', requireManageRight(resFct, resFctItems), asyncHandler(async (req: any, res: any) => {
    const msg = await controller.deleteItem(req.params.itemId);
    renderer.respondWithSuccessJson(res, msg);
}));

export default app;