import express, {Request, Response} from 'express';
import * as packingService from '../../modules/database/services/PackingService';
import {asyncHandler} from '../../modules/lib/asyncHandler';
import renderer from '../../modules/renderer';
import {getResource} from "../../modules/lib/util";

import {apiParamHandler} from "../../middleware/paramHandler";
import {requireAddRightAPI, requireManageRightAPI, requireOwnerAPI} from '../../middleware/permissionMiddleware';
import {attachAssignRoutes} from '../../middleware/assignFlowFactory';

import controller from "../../controller/packingController";

const app = express.Router();

const entityName = 'packing';
const resFct = (req: Request) => getResource(req, entityName);
apiParamHandler('id', app, packingService.getPackingListById, entityName);

app.post('/:id/description', requireAddRightAPI(resFct), async (req: Request, res: Response) => {
    const msg = await controller.updateDescription(resFct(req).id, req.body);
    renderer.respondWithSuccessJson(res, msg);
})

/* Assign / Unassign identical to packing routes … */
/* ───────────────── ASSIGN / UNASSIGN (JSON) ───────────────── */

attachAssignRoutes(app, controller.getAssignmentAccessMapping());

/* ───────────────── REORDER (Owner) ────────────────────────── */

/* ----------- REORDER (nur Owner, JSON-Antwort) ---------------- */
app.post('/:id/reorder', requireManageRightAPI(resFct), asyncHandler(async (req: Request, res: Response) => {
    const msg = await controller.reorderItems(resFct(req).id, req.body.orders);
    renderer.respondWithSuccessJson(res, msg);
}));

/* ───────────────── QUICK-ADD ──────────────────────────────── */

app.post('/:id/items', requireAddRightAPI(resFct), asyncHandler(async (req: Request, res: Response) => {
    const msg = await controller.quickAddItem(resFct(req), req.body);
    renderer.respondWithSuccessJson(res, msg);
}));

app.post('/:id/item/:itemId/description', requireAddRightAPI(resFct), asyncHandler(async (req: Request, res: Response) => {
    const msg = await controller.updateItemDescription(req.params.itemId, req.body);
    renderer.respondWithSuccessJson(res, msg);
}));

/* ---------- PATCH einzelnes Attribut -------------------------------- */
app.post('/:id/item/:itemId/attr', requireManageRightAPI(resFct), asyncHandler(async (req: Request, res: Response) => {
    const msg = await controller.updateItemAttr(req.params.itemId, req.body);
    renderer.respondWithSuccessJson(res, msg);
}));

/* ---------- Everyone flag -------------------------------- */
app.post('/:id/item/:itemId/required', requireManageRightAPI(resFct), asyncHandler(async (req: Request, res: Response) => {
    const msg = await controller.updateRequired(req.params.itemId, req.body);
    renderer.respondWithSuccessJson(res, msg);
}));

app.post('/:id/assignment/:assignId/delete', requireManageRightAPI(resFct), asyncHandler(async (req: Request, res: Response) => {
    const msg = await controller.deleteAssignment(req.params.assignId);
    renderer.respondWithSuccessJson(res, msg);
}));

/* Owner-Settings ändern (AJAX) -------------------------------------- */
app.post('/:id/settings', requireOwnerAPI(resFct), asyncHandler(async (req: Request, res: Response) => {
    const msg = await controller.updateSettings(resFct(req).id, req.body);
    renderer.respondWithSuccessJson(res, msg);
}));

app.post('/:id/item/:itemId/delete', requireManageRightAPI(resFct), asyncHandler(async (req: Request, res: Response) => {
    const msg = await controller.deleteItem(req.params.itemId);
    renderer.respondWithSuccessJson(res, msg);
}));

export default app;