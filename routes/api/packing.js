const express = require('express');
const app = express.Router();

const db = require('../../modules/database/db');
const {asyncHandler} = require('../../modules/lib/asyncHandler');
const renderer = require('../../modules/renderer');

const {apiParamHandler} = require("../../middleware/paramHandler");
const {requireManageRight, requireAddRight, requireOwner} = require('../../middleware/permissionMiddleware');
const attachAssignRoutes = require('../../middleware/assignFlowFactory');

const controller = require("../../controller/packingController");
const {getResource} = require("../../modules/lib/util");

const entityName = 'packing';
const resFct = (req) => getResource(req, entityName);
apiParamHandler('id', app, db.getPackingListById, entityName);

app.post('/:id/description', requireAddRight(resFct), async (req, res) => {
    const msg = await controller.updateDescription(resFct(req).id, req.body);
    renderer.respondWithSuccessJson(res, msg);
})

/* Assign / Unassign identical to packing routes … */
/* ───────────────── ASSIGN / UNASSIGN (JSON) ───────────────── */

attachAssignRoutes(app, controller.getAssignmentAccessMapping());

/* ───────────────── REORDER (Owner) ────────────────────────── */

/* ----------- REORDER (nur Owner, JSON-Antwort) ---------------- */
app.post('/:id/reorder', requireManageRight(resFct), asyncHandler(async (req, res) => {
    const msg = await controller.reorderItems(resFct(req).id, req.body.orders);
    renderer.respondWithSuccessJson(res, msg);
}));

/* ───────────────── QUICK-ADD ──────────────────────────────── */

app.post('/:id/items', requireAddRight(resFct), asyncHandler(async (req, res) => {
    const msg = await controller.quickAddItem(resFct(req), req.body);
    renderer.respondWithSuccessJson(res, msg);
}));

app.post('/:id/item/:itemId/description', requireAddRight(resFct), asyncHandler(async (req, res) => {
    const msg = await controller.updateItemDescription(req.params.itemId, req.body);
    renderer.respondWithSuccessJson(res, msg);
}));

/* ---------- PATCH einzelnes Attribut -------------------------------- */
app.post('/:id/item/:itemId/attr', requireManageRight(resFct), asyncHandler(async (req, res) => {
    const msg = await controller.updateItemAttr(req.params.itemId, req.body);
    renderer.respondWithSuccessJson(res, msg);
}));

/* ---------- Everyone flag -------------------------------- */
app.post('/:id/item/:itemId/required', requireManageRight(resFct), asyncHandler(async (req, res) => {
    const msg = await controller.updateRequired(req.params.itemId, req.body);
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

app.post('/:id/item/:itemId/delete', requireManageRight(resFct), asyncHandler(async (req, res) => {
    const msg = await controller.deleteItem(req.params.itemId);
    renderer.respondWithSuccessJson(res, msg);
}));

module.exports = app;