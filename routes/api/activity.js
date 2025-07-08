const express = require('express');
const app = express.Router();

const db = require('../../modules/database/db');
const {asyncHandler} = require('../../modules/lib/asyncHandler');
const renderer = require('../../modules/renderer');

const {apiParamHandler} = require("../../middleware/paramHandler");
const {requireManageRight, requireAddRight, requireOwner} = require('../../middleware/permissionMiddleware');
const attachAssignRoutes = require('../../middleware/assignFlowFactory');
const controller = require('../../controller/activityController');

apiParamHandler('id', app, db.getActivityPlanById, 'activity');

app.post('/:id/description', requireAddRight(req => req.entity), async (req, res) => {
    const msg = await controller.updateDescription(req.entity.id, req.body);
    renderer.respondWithSuccessJson(res, msg);
})

/* Assign / Unassign identical to packing routes … */
/* ───────────────── ASSIGN / UNASSIGN (JSON) ───────────────── */

attachAssignRoutes(app, controller.getAssignmentAccessMapping());

/* ───────────────── REORDER (Owner) ────────────────────────── */

/* ----------- REORDER (nur Owner, JSON-Antwort) ---------------- */
app.post('/:id/slot/reorder', requireManageRight(req => req.entity), asyncHandler(async (req, res) => {
    const msg = await controller.reorderSlots(req.entity.id, req.body.order);
    renderer.respondWithSuccessJson(res, msg);
}));

/* ───────────────── QUICK-ADD ──────────────────────────────── */

app.post('/:id/slot/add', requireAddRight(req => req.entity), asyncHandler(async (req, res) => {
    const msg = await controller.quickAddSlot(req.entity, req.body);
    renderer.respondWithSuccessJson(res, msg);
}));

app.post('/:id/slot/:slotId/description', requireAddRight(req => req.entity), asyncHandler(async (req, res) => {
    const msg = await controller.updateSlotDescription(req.params.slotId, req.body);
    renderer.respondWithSuccessJson(res, msg);
}));

/* ---------- PATCH einzelnes Attribut -------------------------------- */
app.post('/:id/slot/:slotId/attr', requireManageRight(req => req.entity), asyncHandler(async (req, res) => {
    const msg = await controller.updateSlotAttr(req.params.slotId, req.body);
    renderer.respondWithSuccessJson(res, msg);
}));

app.post('/:id/assignment/:assignId/delete', requireManageRight(req => req.entity), asyncHandler(async (req, res) => {
    const msg = await controller.deleteAssignment(req.params.assignId);
    renderer.respondWithSuccessJson(res, msg);
}));

/* Owner-Settings ändern (AJAX) -------------------------------------- */
app.post('/:id/settings', requireOwner(req => req.entity), asyncHandler(async (req, res) => {
    const msg = await controller.updateSettings(req.entity.id, req.body);
    renderer.respondWithSuccessJson(res, msg);
}));

app.post('/:id/slot/:slotId/delete', requireManageRight(req => req.entity), asyncHandler(async (req, res) => {
    const msg = await controller.deleteSlot(req.params.slotId);
    renderer.respondWithSuccessJson(res, msg);
}));

module.exports = app;