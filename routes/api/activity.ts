const express = require('express');
const app = express.Router();

const db = require('../../modules/database/db');
const {asyncHandler} = require('../../modules/lib/asyncHandler');
const renderer = require('../../modules/renderer');

const {apiParamHandler} = require("../../middleware/paramHandler");
const {requireManageRight, requireAddRight, requireOwner} = require('../../middleware/permissionMiddleware');
const attachAssignRoutes = require('../../middleware/assignFlowFactory');
const attachAssignRoleRoutes = require('../../middleware/assignRoleFlowFactory');
const controller = require('../../controller/activityController');
const {getResource} = require("../../modules/lib/util");

const entityName = 'activity';
const resFct = (req) => getResource(req, entityName);
apiParamHandler('id', app, db.getActivityPlanById, entityName);

app.post('/:id/description', requireAddRight(resFct), async (req, res) => {
    const msg = await controller.updateDescription(resFct(req).id, req.body);
    renderer.respondWithSuccessJson(res, msg);
})

/* Assign / Unassign identical to packing routes … */
/* ───────────────── ASSIGN / UNASSIGN (JSON) ───────────────── */

attachAssignRoutes(app, controller.getAssignmentAccessMapping());
attachAssignRoleRoutes(app, controller.getRoleAccessMapping());

/* ───────────────── REORDER (Owner) ────────────────────────── */

/* ----------- REORDER (nur Owner, JSON-Antwort) ---------------- */
app.post('/:id/slot/reorder', requireManageRight(resFct), asyncHandler(async (req, res) => {
    const msg = await controller.reorderSlots(resFct(req).id, req.body.order);
    renderer.respondWithSuccessJson(res, msg);
}));

/* ───────────────── QUICK-ADD ──────────────────────────────── */

app.post('/:id/slot/add', requireAddRight(resFct), asyncHandler(async (req, res) => {
    const msg = await controller.quickAddSlot(resFct(req), req.body);
    renderer.respondWithSuccessJson(res, msg);
}));

app.post('/:id/slot/:slotId/description', requireAddRight(resFct), asyncHandler(async (req, res) => {
    const msg = await controller.updateSlotDescription(req.params.slotId, req.body);
    renderer.respondWithSuccessJson(res, msg);
}));

/* ---------- PATCH einzelnes Attribut -------------------------------- */
app.post('/:id/slot/:slotId/attr', requireManageRight(resFct), asyncHandler(async (req, res) => {
    const msg = await controller.updateSlotAttr(req.params.slotId, req.body);
    renderer.respondWithSuccessJson(res, msg);
}));

app.post('/:id/assignment/:assignId/delete', requireManageRight(resFct), asyncHandler(async (req, res) => {
    const msg = await controller.deleteAssignment(req.params.assignId);
    renderer.respondWithSuccessJson(res, msg);
}));

/* Owner-Settings ändern (AJAX) -------------------------------------- */
app.post('/:id/settings', requireOwner(resFct), asyncHandler(async (req, res) => {
    const msg = await controller.updateSettings(resFct(req).id, req.body);
    renderer.respondWithSuccessJson(res, msg);
}));

app.post('/:id/slot/:slotId/delete', requireManageRight(resFct), asyncHandler(async (req, res) => {
    const msg = await controller.deleteSlot(req.params.slotId);
    renderer.respondWithSuccessJson(res, msg);
}));

app.post('/:id/slot/:slotId/addRole', requireManageRight(resFct), asyncHandler(async (req, res) => {
    const msg = await controller.addSlotRole(req.params.slotId, req.body);
    renderer.respondWithSuccessJson(res, msg);
}))

module.exports = app;