const express = require('express');
const app = express.Router();

const db = require("../modules/database/db");
const {asyncHandler} = require("../modules/lib/asyncHandler");

const {createGuestFlowRouter} = require("../middleware/guestFlowFactory");

const controller = require("../controller/surveyController");
const {getResource} = require("../modules/lib/util");

const entityName = 'survey';
resFct = (req) => getResource(req, entityName);

// Helper to DRY up flash + redirect logic
function handleAction(actionFn, successMsg) {
    return asyncHandler(async (req, res) => {
        const surveyId = resFct(req).id;
        try {
            // Execute the provided controller action
            await actionFn(req);
            req.flash('success', successMsg);
        } catch (err) {
            req.flash('error', err.message);
        }
        res.redirect(`/survey/${surveyId}`);
    });
}

app.use('/', createGuestFlowRouter({
    entityType: entityName,
    db: {
        getById: db.getSurveyById,
    },
    templates: {
        create: 'surveyor/survey-create',
        view: 'surveyor/survey-vote',
    },
    buildRedirect: id => `/survey/${id}`,
    preprocessCreate: controller.preprocessCreate,
    createEntity: controller.createEntity,
    afterCreateItems: controller.afterCreateItems,
    fetchForView: controller.fetchForView,
    fetchForDuplicate: controller.fetchForDuplicate,
    deleteEntity: controller.deleteEntity,
}));

/**
 * POST /survey/:id/add-combination
 * Add a weekday/nth combination to the survey
 */
app.post(
    '/:id/add-combination',
    handleAction(
        req => controller.addCombination(resFct(req), req.body.weekday, req.body.nth),
        'Combination successfully added'
    )
);

/**
 * POST /survey/:id/submit
 * Submit or update responses for the survey
 */
app.post(
    '/:id/submit',
    handleAction(
        req => controller.submitResponses(resFct(req), req.session, req.body),
        'Answers updated'
    )
);

module.exports = app;