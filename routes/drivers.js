const express = require('express');
const app = express.Router();

const db = require('../modules/database/db');
const {createGuestFlowRouter} = require("../middleware/guestFlowFactory");
const controller = require("../controller/driversController");

app.use("/", createGuestFlowRouter({
    entityType: 'drivers',
    db: {
        getById: db.getDriversListById,
    },
    templates: {
        create: 'drivers/drivers-create',
        view: 'drivers/drivers-view',
    },
    buildRedirect: id => `/drivers/${id}`,
    preprocessCreate: controller.preprocessCreate,
    createEntity: controller.createEntity,
    afterCreateItems: controller.afterCreateItems,
    fetchForView: controller.fetchForView,
    fetchForDuplicate: controller.fetchForDuplicate,
    deleteEntity: controller.deleteEntity,
}));

module.exports = app;
