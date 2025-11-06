import express, {Request, Response} from 'express';
import * as activityService from '../../modules/database/services/ActivityService';
import {asyncHandler} from '../../modules/lib/asyncHandler';
import renderer from '../../modules/renderer';
import {getResource} from "../../modules/lib/util";

import {apiParamHandler} from "../../middleware/paramHandler";
import {requireAddRightAPI, requireManageRightAPI, requireOwnerAPI} from '../../middleware/permissionMiddleware';
import {attachAssignRoleRoutes, attachAssignRoutes} from '../../middleware/assignFlowFactory';

import controller from '../../controller/activityController';

const app = express.Router();
const entityName = 'activity';
const resFct = (req: Request) => getResource(req, entityName);
apiParamHandler('id', app, activityService.getActivityPlanById, entityName);

app.post('/:id/description', requireAddRightAPI(resFct), async (req: Request, res: Response) => {
    const msg = await controller.updateDescription(resFct(req).id, req.body);
    renderer.respondWithSuccessJson(res, msg);
})

/* Assign / Unassign identical to packing routes … */
/* ───────────────── ASSIGN / UNASSIGN (JSON) ───────────────── */

attachAssignRoutes(app, controller.getAssignmentAccessMapping());
attachAssignRoleRoutes(app, controller.getRoleAccessMapping());

/* ───────────────── REORDER (Owner) ────────────────────────── */

/* ----------- REORDER (nur Owner, JSON-Antwort) ---------------- */
app.post('/:id/slot/reorder', requireManageRightAPI(resFct), asyncHandler(async (req: Request, res: Response) => {
    const msg = await controller.reorderSlots(resFct(req).id, req.body.order);
    renderer.respondWithSuccessJson(res, msg);
}));

/* ───────────────── QUICK-ADD ──────────────────────────────── */

app.post('/:id/slot/add', requireAddRightAPI(resFct), asyncHandler(async (req: Request, res: Response) => {
    const msg = await controller.quickAddSlot(resFct(req), req.body);
    renderer.respondWithSuccessJson(res, msg);
}));

app.post('/:id/slot/:slotId/description', requireAddRightAPI(resFct), asyncHandler(async (req: Request, res: Response) => {
    const msg = await controller.updateSlotDescription(req.params.slotId, req.body);
    renderer.respondWithSuccessJson(res, msg);
}));

/* ---------- PATCH einzelnes Attribut -------------------------------- */
app.post('/:id/slot/:slotId/attr', requireManageRightAPI(resFct), asyncHandler(async (req: Request, res: Response) => {
    const msg = await controller.updateSlotAttr(req.params.slotId, req.body);
    renderer.respondWithSuccessJson(res, msg);
}));

app.post('/:id/assignment/:assignId/delete', requireManageRightAPI(resFct), asyncHandler(async (req: Request, res: Response) => {
    const msg = await controller.deleteAssignment(Number(req.params.assignId));
    renderer.respondWithSuccessJson(res, msg);
}));

/* Owner-Settings ändern (AJAX) -------------------------------------- */
app.post('/:id/settings', requireOwnerAPI(resFct), asyncHandler(async (req: Request, res: Response) => {
    const msg = await controller.updateSettings(resFct(req).id, req.body);
    renderer.respondWithSuccessJson(res, msg);
}));

app.post('/:id/slot/:slotId/delete', requireManageRightAPI(resFct), asyncHandler(async (req: Request, res: Response) => {
    const msg = await controller.deleteSlot(req.params.slotId);
    renderer.respondWithSuccessJson(res, msg);
}));

app.post('/:id/slot/:slotId/addRole', requireManageRightAPI(resFct), asyncHandler(async (req: Request, res: Response) => {
    const msg = await controller.addSlotRole(req.params.slotId, req.body);
    renderer.respondWithSuccessJson(res, msg);
}));

export default app;