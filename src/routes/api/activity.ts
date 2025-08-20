import express from 'express';
import * as activityService from '../../modules/database/services/ActivityService';
import {asyncHandler} from '../../modules/lib/asyncHandler';
import renderer from '../../modules/renderer';
import {getResource} from "../../modules/lib/util";

import {apiParamHandler} from "../../middleware/paramHandler";
import {requireAddRight, requireManageRight, requireOwner} from '../../middleware/permissionMiddleware';
import {attachAssignRoutes} from '../../middleware/assignFlowFactory';
import {attachAssignRoleRoutes} from '../../middleware/assignRoleFlowFactory';

import controller from '../../controller/activityController';

const app = express.Router();
const entityName = 'activity';
const resFct = (req: any) => getResource(req, entityName);
apiParamHandler('id', app, activityService.getActivityPlanById, entityName);

app.post('/:id/description', requireAddRight(resFct), async (req: any, res: any) => {
    const msg = await controller.updateDescription(resFct(req).id, req.body);
    renderer.respondWithSuccessJson(res, msg);
})

/* Assign / Unassign identical to packing routes … */
/* ───────────────── ASSIGN / UNASSIGN (JSON) ───────────────── */

attachAssignRoutes(app, controller.getAssignmentAccessMapping());
attachAssignRoleRoutes(app, controller.getRoleAccessMapping());

/* ───────────────── REORDER (Owner) ────────────────────────── */

/* ----------- REORDER (nur Owner, JSON-Antwort) ---------------- */
app.post('/:id/slot/reorder', requireManageRight(resFct), asyncHandler(async (req: any, res: any) => {
    const msg = await controller.reorderSlots(resFct(req).id, req.body.order);
    renderer.respondWithSuccessJson(res, msg);
}));

/* ───────────────── QUICK-ADD ──────────────────────────────── */

app.post('/:id/slot/add', requireAddRight(resFct), asyncHandler(async (req: any, res: any) => {
    const msg = await controller.quickAddSlot(resFct(req), req.body);
    renderer.respondWithSuccessJson(res, msg);
}));

app.post('/:id/slot/:slotId/description', requireAddRight(resFct), asyncHandler(async (req: any, res: any) => {
    const msg = await controller.updateSlotDescription(req.params.slotId, req.body);
    renderer.respondWithSuccessJson(res, msg);
}));

/* ---------- PATCH einzelnes Attribut -------------------------------- */
app.post('/:id/slot/:slotId/attr', requireManageRight(resFct), asyncHandler(async (req: any, res: any) => {
    const msg = await controller.updateSlotAttr(req.params.slotId, req.body);
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

app.post('/:id/slot/:slotId/delete', requireManageRight(resFct), asyncHandler(async (req: any, res: any) => {
    const msg = await controller.deleteSlot(req.params.slotId);
    renderer.respondWithSuccessJson(res, msg);
}));

app.post('/:id/slot/:slotId/addRole', requireManageRight(resFct), asyncHandler(async (req: any, res: any) => {
    const msg = await controller.addSlotRole(req.params.slotId, req.body);
    renderer.respondWithSuccessJson(res, msg);
}));

export default app;