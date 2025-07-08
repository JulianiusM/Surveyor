const express = require('express');
const app = express.Router();

const db = require('../../modules/database/db');
const {asyncHandler} = require('../../modules/lib/asyncHandler');
const renderer = require('../../modules/renderer');

const {apiParamHandler} = require("../../middleware/paramHandler");
const {requireManageRight, requireAddRight, requireOwner} = require('../../middleware/permissionMiddleware');
const attachAssignRoutes = require('../../middleware/assignFlowFactory');

const controller = require("../../controller/packingController");

apiParamHandler('id', app, db.getPackingListById, 'packing');

app.post('/:id/description', requireAddRight(req => req.entity), async (req, res) => {
    const msg = await controller.updateDescription(req.entity.id, req.body);
    renderer.respondWithSuccessJson(res, msg);
})

/* Assign / Unassign identical to packing routes … */
/* ───────────────── ASSIGN / UNASSIGN (JSON) ───────────────── */

attachAssignRoutes(app, controller.getAssignmentAccessMapping());

/* ───────────────── REORDER (Owner) ────────────────────────── */

/* ----------- REORDER (nur Owner, JSON-Antwort) ---------------- */
app.post('/:id/reorder', requireManageRight(req => req.entity), asyncHandler(async (req, res) => {
    const msg = await controller.reorderItems(req.entity.id, req.body.orders);
    renderer.respondWithSuccessJson(res, msg);
}));

/* ───────────────── QUICK-ADD ──────────────────────────────── */

app.post('/:id/items', requireAddRight(req => req.entity), asyncHandler(async (req, res) => {
    const msg = await controller.quickAddItem(req.entity, req.body);
    renderer.respondWithSuccessJson(res, msg);
}));

app.post('/:id/item/:itemId/description', requireAddRight(req => req.entity), asyncHandler(async (req, res) => {
    const msg = await controller.updateItemDescription(req.params.itemId, req.body);
    renderer.respondWithSuccessJson(res, msg);
}));

/* ---------- PATCH einzelnes Attribut -------------------------------- */
app.post('/:id/item/:itemId/attr', requireManageRight(req => req.entity), asyncHandler(async (req, res) => {
    const msg = await controller.updateItemAttr(req.params.itemId, req.body);
    renderer.respondWithSuccessJson(res, msg);
}));

/* ---------- Everyone flag -------------------------------- */
app.post('/:id/item/:itemId/required', requireManageRight(req => req.entity), asyncHandler(async (req, res) => {
    const msg = await controller.updateRequired(req.params.itemId, req.body);
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

app.post('/:id/item/:itemId/delete', requireManageRight(req => req.entity), asyncHandler(async (req, res) => {
    const msg = await controller.deleteItem(req.params.itemId);
    renderer.respondWithSuccessJson(res, msg);
}));

module.exports = app;