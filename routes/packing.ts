const express = require('express');
const app = express.Router();

const db = require('../modules/database/db');
const {createGuestFlowRouter} = require("../middleware/guestFlowFactory");
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
    buildRedirect: id => `/packing/${id}`,
    preprocessCreate: controller.preprocessCreate,
    createEntity: controller.createEntity,
    afterCreateItems: controller.afterCreateItems,
    fetchForView: controller.fetchForView,
    fetchForDuplicate: controller.fetchForDuplicate,
    deleteEntity: controller.deleteEntity,
}));

module.exports = app;
