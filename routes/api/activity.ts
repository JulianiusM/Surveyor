// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'express'.
const express = require('express');
// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'app'.
const app = express.Router();

// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'db'.
const db = require('../../modules/database/db');
// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'asyncHandl... Remove this comment to see the full error message
const {asyncHandler} = require('../../modules/lib/asyncHandler');
// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'renderer'.
const renderer = require('../../modules/renderer');

// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'apiParamHa... Remove this comment to see the full error message
const {apiParamHandler} = require("../../middleware/paramHandler");
// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'requireMan... Remove this comment to see the full error message
const {requireManageRight, requireAddRight, requireOwner} = require('../../middleware/permissionMiddleware');
// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'attachAssi... Remove this comment to see the full error message
const attachAssignRoutes = require('../../middleware/assignFlowFactory');
// @ts-expect-error TS(2580): Cannot find name 'require'. Do you need to install... Remove this comment to see the full error message
const attachAssignRoleRoutes = require('../../middleware/assignRoleFlowFactory');
// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'controller... Remove this comment to see the full error message
const controller = require('../../controller/activityController');
// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'getResourc... Remove this comment to see the full error message
const {getResource} = require("../../modules/lib/util");

// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'entityName... Remove this comment to see the full error message
const entityName = 'activity';
// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'resFct'.
const resFct = (req: any) => getResource(req, entityName);
apiParamHandler('id', app, db.getActivityPlanById, entityName);

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
}))

// @ts-expect-error TS(2580): Cannot find name 'module'. Do you need to install ... Remove this comment to see the full error message
module.exports = app;