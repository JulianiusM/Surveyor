// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'express'.
const express = require('express');
// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'app'.
const app = express.Router();

// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'db'.
const db = require('../modules/database/db');
// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'createGues... Remove this comment to see the full error message
const {createGuestFlowRouter} = require("../middleware/guestFlowFactory");
// @ts-expect-error TS(2451): Cannot redeclare block-scoped variable 'controller... Remove this comment to see the full error message
const controller = require("../controller/packingController");

app.use("/", createGuestFlowRouter({
    entityType: 'packing',
    db: {
        getById: db.getPackingListById,
    },
    templates: {
        create: 'packing/packing-create',
        view: 'packing/packing-view',
    },
    buildRedirect: (id: any) => `/packing/${id}`,
    preprocessCreate: controller.preprocessCreate,
    createEntity: controller.createEntity,
    afterCreateItems: controller.afterCreateItems,
    fetchForView: controller.fetchForView,
    fetchForDuplicate: controller.fetchForDuplicate,
    deleteEntity: controller.deleteEntity,
}));

// @ts-expect-error TS(2552): Cannot find name 'module'. Did you mean 'modules'?
module.exports = app;
