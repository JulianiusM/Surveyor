const express = require('express');
const app = express.Router();

const db = require('../../modules/database/db');
const {asyncHandler} = require('../../modules/lib/asyncHandler');
const renderer = require('../../modules/renderer');

const {apiParamHandler} = require("../../middleware/paramHandler");
const {requireManageRight, requireAddRight, requireOwner} = require('../../middleware/permissionMiddleware');
const attachAssignRoutes = require('../../middleware/assignFlowFactory');

const controller = require("../../controller/driversController");
const {getResource, getAdditional} = require("../../modules/lib/util");

const entityName = 'drivers';
const entityItemName = 'driversItem';
const resFct = (req) => getResource(req, entityName);
const resFctItems = (req) => getAdditional(req, entityItemName);

apiParamHandler('id', app, db.getDriversListById, entityName);
apiParamHandler('itemId', app, db.getDriversItemById, entityItemName);

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
    const msg = await controller.quickAddItem(resFct(req), req.body, req.session);
    renderer.respondWithSuccessJson(res, msg);
}));

app.post('/:id/item/:itemId/description', requireAddRight(resFct, resFctItems), asyncHandler(async (req, res) => {
    const msg = await controller.updateItemDescription(req.params.itemId, req.body);
    renderer.respondWithSuccessJson(res, msg);
}));

/* ---------- PATCH einzelnes Attribut -------------------------------- */
app.post('/:id/item/:itemId/attr', requireManageRight(resFct, resFctItems), asyncHandler(async (req, res) => {
    const msg = await controller.updateItemAttr(req.params.itemId, req.body);
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

app.post('/:id/item/:itemId/delete', requireManageRight(resFct, resFctItems), asyncHandler(async (req, res) => {
    const msg = await controller.deleteItem(req.params.itemId);
    renderer.respondWithSuccessJson(res, msg);
}));

module.exports = app;