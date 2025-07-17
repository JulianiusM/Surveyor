const express = require('express');
const app = express.Router();

const db = require('../modules/database/db');

const {createGuestFlowRouter} = require('../middleware/guestFlowFactory')
const controller = require('../controller/activityController')

app.use("/", createGuestFlowRouter({
    entityType: 'activity',
    db: {
        getById: db.getActivityPlanById,
    },
    templates: {
        create: 'activity/activity-create',
        view: 'activity/activity-view',
    },
    buildRedirect: id => `/activity/${id}`,
    preprocessCreate: controller.preprocessCreate,
    createEntity: controller.createEntity,
    afterCreateItems: controller.afterCreateItems,
    fetchForView: controller.fetchForView,
    fetchForDuplicate: controller.fetchForDuplicate,
    deleteEntity: controller.deleteEntity,
}));

module.exports = app;
